// 效能：靜態檔 gzip 與快取、API 回應 gzip、請求耗時統計（不需額外套件，使用 Node 內建 zlib）
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEXT = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8' };
const LONG = 'public, max-age=31536000, immutable';
const WEEK = 'public, max-age=604800';

const acceptsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

// 依網址決定快取：HTML 每次驗證；帶 ?v= 版本號的檔案長期快取（改版時版本號會變）；圖片字型等一週
function cacheFor(req, file) {
  if (file.endsWith('.html')) return 'no-cache';
  if (/[?&]v=/.test(req.originalUrl || req.url)) return LONG;
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf)$/i.test(file)) return WEEK;
  return 'no-cache';
}

function staticGzip(root) {
  const rootAbs = path.resolve(root);
  const cache = new Map(); // file -> { mtime, size, gz, etag, wait }
  // 同一個檔案只壓縮一次：壓縮期間其他人的請求排隊等結果，不重複計算
  function getGz(file, st, cb) {
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.gz ? cb(null, hit) : hit.wait.push(cb);
    const c = { mtime: st.mtimeMs, size: st.size, gz: null, etag: `W/"g${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`, wait: [cb] };
    cache.set(file, c);
    const done = (e, v) => { if (e) cache.delete(file); const w = c.wait; c.wait = []; w.forEach(f => f(e, v)); };
    fs.readFile(file, (e2, buf) => { if (e2) return done(e2); zlib.gzip(buf, { level: 9 }, (e3, gz) => { if (e3) return done(e3); c.gz = gz; done(null, c); }); });
  }
  const mw = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!acceptsGzip(req)) return next();
    let rel; try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const ext = path.extname(rel).toLowerCase(); const type = TEXT[ext]; if (!type) return next();
    const file = path.resolve(rootAbs, '.' + rel); if (!file.startsWith(rootAbs + path.sep)) return next();
    fs.stat(file, (e, st) => {
      if (e || !st.isFile() || st.size < 1024) return next();
      getGz(file, st, (e2, c) => {
        if (e2) return next();
        res.setHeader('Content-Type', type); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Cache-Control', cacheFor(req, file)); res.setHeader('ETag', c.etag);
        if (req.headers['if-none-match'] === c.etag) { res.statusCode = 304; return res.end(); }
        res.setHeader('Content-Length', c.gz.length); if (req.method === 'HEAD') return res.end(); res.end(c.gz);
      });
    });
  };
  // 啟動後在背景先把網頁檔壓縮好，部署後第一批使用者不必等
  mw.warm = () => {
    const files = []; const walk = d => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (TEXT[path.extname(n.name).toLowerCase()]) files.push(f); } };
    try { walk(rootAbs); } catch { return; }
    let i = 0; const step = () => { if (i >= files.length) return; const f = files[i++]; fs.stat(f, (e, st) => { if (e || st.size < 1024) return setImmediate(step); getGz(f, st, () => setImmediate(step)); }); };
    step();
  };
  return mw;
}

// express.static 的 setHeaders（沒有 gzip 時、或圖片等二進位檔）
function staticHeaders(res, file) { res.setHeader('Cache-Control', res.req ? cacheFor(res.req, file) : 'no-cache'); }

// API JSON 回應超過 2KB 時以 gzip 傳送（非同步壓縮，不卡住其他請求）
function jsonGzip(req, res, next) {
  if (!acceptsGzip(req)) return next();
  const orig = res.json.bind(res);
  res.json = function (obj) {
    let body; try { body = JSON.stringify(obj); } catch { return orig(obj); }
    if (body === undefined || Buffer.byteLength(body) < 2048 || res.headersSent) return orig(obj);
    zlib.gzip(body, { level: 6 }, (e, gz) => {
      if (e || res.headersSent) return orig(obj);
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('Content-Length', gz.length);
      res.end(gz);
    });
    return res;
  };
  next();
}

// 請求耗時統計：依路由彙整次數、平均、P95、最大值；超過 1 秒的請求寫入 log
const stats = new Map();
const started = Date.now();
function timing(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const route = req.route ? `${req.method} ${req.baseUrl || ''}${req.route.path}` : (req.path.startsWith('/api/') ? `${req.method} ${req.path.replace(/\/\d+(?=\/|$)/g, '/:id')}` : 'static');
    let s = stats.get(route); if (!s) { s = { n: 0, total: 0, max: 0, last: [] }; stats.set(route, s); }
    s.n++; s.total += ms; if (ms > s.max) s.max = ms; s.last.push(ms); if (s.last.length > 200) s.last.shift();
    if (ms > 1000) console.warn(`[slow] ${route} ${Math.round(ms)}ms status=${res.statusCode}`);
  });
  next();
}
function report() {
  const rows = [...stats.entries()].map(([route, s]) => {
    const sorted = [...s.last].sort((a, b) => a - b);
    return { route, count: s.n, avg_ms: +(s.total / s.n).toFixed(1), p95_ms: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(1), max_ms: +s.max.toFixed(1) };
  }).sort((a, b) => b.p95_ms - a.p95_ms);
  const m = process.memoryUsage();
  return { since: new Date(started).toISOString(), uptime_min: Math.round((Date.now() - started) / 60000), memory_mb: { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) }, routes: rows };
}

module.exports = { staticGzip, staticHeaders, jsonGzip, timing, report };
