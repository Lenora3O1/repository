// 資安防護：安全標頭、登入防暴力破解、Session 金鑰、總後台密碼檢查（不需額外套件）
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 在正式主機上（Render／Zeabur 或 NODE_ENV=production）
const isHosted = () => !!(process.env.RENDER || process.env.ZEABUR || process.env.ZEABUR_SERVICE_ID || process.env.NODE_ENV === 'production');

// ---------- Session 金鑰 ----------
// 沒有設定 SESSION_SECRET 時，不再使用寫死在程式裡的預設值；改為隨機產生並保存在資料夾（只有主機能讀）。
function sessionSecret(dataDir) {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, '.session-secret');
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s.length >= 32) return s; } catch {}
  const s = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(f, s, { mode: 0o600 }); } catch {}
  if (isHosted()) console.warn('[資安] 未設定 SESSION_SECRET，已自動產生隨機金鑰。建議在主機環境變數設定 SESSION_SECRET（至少 32 個字元）。');
  return s;
}

// ---------- 安全標頭 ----------
// 防止被其他網站嵌入（點擊劫持）、瀏覽器亂猜檔案類型、把網址洩漏給外站；HTTPS 下要求瀏覽器一律走加密連線。
function headers(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', res.getHeader('Cache-Control') || 'no-store');
  next();
}

// ---------- 登入防暴力破解 ----------
// 同一個 IP＋帳號 15 分鐘內錯 5 次 → 鎖 15 分鐘；同一個 IP 15 分鐘內錯 30 次（不分帳號）→ 整個 IP 鎖 15 分鐘。
const WINDOW = 15 * 60 * 1000, PER_ACCOUNT = 5, PER_IP = 30, LOCK = 15 * 60 * 1000;
const fails = new Map(); // key -> { n, first, until }
const LOGIN_PATH = /^\/api\/(?:[a-z0-9-]+\/)*login$/;
const ipOf = req => String(req.ip || req.socket?.remoteAddress || '');
const acctOf = req => { const b = req.body || {}; return String(b.employeeId || b.username || b.phone || b.code || b.loginCode || b.tenantCode || '').trim().toLowerCase().slice(0, 80); };
function hit(key, now) {
  let r = fails.get(key); if (!r || now - r.first > WINDOW) { r = { n: 0, first: now, until: 0 }; fails.set(key, r); }
  r.n++; return r;
}
const lockedUntil = (key, now) => { const r = fails.get(key); return r && r.until > now ? r.until : 0; };
function loginGuard(req, res, next) {
  if (req.method !== 'POST' || !LOGIN_PATH.test(req.path)) return next();
  const now = Date.now(); const ip = ipOf(req); const ka = `a:${ip}:${req.path}:${acctOf(req)}`, ki = `i:${ip}`;
  const until = Math.max(lockedUntil(ka, now), lockedUntil(ki, now));
  if (until) {
    const min = Math.ceil((until - now) / 60000);
    res.setHeader('Retry-After', String(Math.ceil((until - now) / 1000)));
    return res.status(429).json({ error: `登入失敗次數過多，為保護帳號安全已暫停登入，請 ${min} 分鐘後再試。` });
  }
  res.on('finish', () => {
    const t = Date.now();
    if (res.statusCode === 401 || res.statusCode === 403) {
      const a = hit(ka, t), i = hit(ki, t);
      if (a.n >= PER_ACCOUNT) { a.until = t + LOCK; console.warn(`[資安] 登入連續失敗已鎖定 ${LOCK / 60000} 分鐘：${req.path} 帳號=${acctOf(req) || '(空)'} IP=${ip}`); }
      if (i.n >= PER_IP) { i.until = t + LOCK; console.warn(`[資安] 同一 IP 大量登入失敗已鎖定：IP=${ip}`); }
    } else if (res.statusCode === 200) fails.delete(ka);
  });
  next();
}
// 定期清掉過期紀錄，避免記憶體累積
setInterval(() => { const t = Date.now(); for (const [k, r] of fails) if (t - r.first > WINDOW && r.until < t) fails.delete(k); }, 5 * 60 * 1000).unref?.();

// ---------- 比對字串（固定時間，避免從回應時間猜出密碼） ----------
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const y = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------- 總後台密碼 ----------
// 正式主機上若仍是預設密碼，拒絕登入並提示設定 ADMIN_PASS（預設密碼是駭客第一個會試的）。
const WEAK_ADMIN = new Set(['admin123', 'admin', 'password', '12345678', '123456']);
function adminPasswordProblem(pass) {
  if (!isHosted()) return '';
  if (WEAK_ADMIN.has(String(pass)) || String(pass).length < 10) return '總後台密碼仍是預設值或太短，已暫停登入。請到主機的環境變數設定 ADMIN_PASS（至少 10 個字元），重新部署後即可登入。';
  return '';
}

module.exports = { isHosted, sessionSecret, headers, loginGuard, safeEqual, adminPasswordProblem, _fails: fails };
