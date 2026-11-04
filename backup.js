// 異地加密備份：每天自動把「資料庫＋上傳檔案＋設定檔」打包、壓縮、用 AES-256-GCM 加密後，
// 上傳到另一個雲端儲存空間（S3 相容：Cloudflare R2、Backblaze B2、AWS S3 等），並保留最近 N 天。
// 主機壞掉、資料被誤刪或被勒索病毒加密時，可以用備份還原（scripts/restore-backup.js）。
//
// 環境變數：
//   DATA_ENCRYPTION_KEY       加密金鑰（和個資欄位加密同一組；沒有金鑰就不上傳，避免明文外流）
//   BACKUP_S3_ENDPOINT        例：https://<帳號>.r2.cloudflarestorage.com
//   BACKUP_S3_BUCKET          儲存桶名稱
//   BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY
//   BACKUP_S3_REGION          預設 auto（R2）；AWS 填 ap-northeast-1 等
//   BACKUP_S3_PREFIX          預設 hesi-backups/
//   BACKUP_HOUR               每天幾點備份（台灣時間，預設 3）
//   BACKUP_KEEP_DAYS          保留天數（預設 30）
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

const MAGIC = Buffer.from('HESIBK1\n');
function backupKey() { const m = process.env.DATA_ENCRYPTION_KEY || ''; return m.length >= 32 ? Buffer.from(crypto.hkdfSync('sha256', Buffer.from(m), Buffer.from('hesi-backup'), Buffer.from('aes-256-gcm'), 32)) : null; }

// ---------- 簡易 tar（ustar）打包 ----------
function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512); const w = (s, o, l) => h.write(String(s), o, l, 'utf8');
  let prefix = ''; let nm = name; if (Buffer.byteLength(nm) > 100) { const i = nm.lastIndexOf('/', 154); prefix = nm.slice(0, i); nm = nm.slice(i + 1); }
  w(nm, 0, 100); w('0000644\0', 100, 8); w('0000000\0', 108, 8); w('0000000\0', 116, 8);
  w(size.toString(8).padStart(11, '0') + '\0', 124, 12); w(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  w('        ', 148, 8); w('0', 156, 1); w('ustar\0', 257, 6); w('00', 263, 2); w(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b; w(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8); return h;
}
async function* tarStream(entries) {
  for (const e of entries) {
    let st; try { st = fs.statSync(e.file); } catch { continue; } if (!st.isFile()) continue;
    yield tarHeader(e.name, st.size, st.mtimeMs);
    let n = 0; for await (const chunk of fs.createReadStream(e.file)) { n += chunk.length; yield chunk; }
    if (n !== st.size) throw new Error(`檔案在備份時被修改：${e.name}`);
    const pad = (512 - (st.size % 512)) % 512; if (pad) yield Buffer.alloc(pad);
  }
  yield Buffer.alloc(1024);
}
function walk(dir, base, out, skip) { let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; } for (const d of list) { const f = path.join(dir, d.name); const rel = path.posix.join(base, d.name); if (skip(rel)) continue; if (d.isDirectory()) walk(f, rel, out, skip); else if (d.isFile()) out.push({ file: f, name: rel }); } return out; }

// ---------- AWS Signature V4（S3 相容） ----------
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const uriEnc = (s, slash) => { const e = encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); return slash ? e.replace(/%2F/g, '/') : e; };
function sign({ method, host, pathname, query = {}, headers = {}, payloadHash, accessKey, secretKey, region, date }) {
  const amzDate = (date || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, ''); const day = amzDate.slice(0, 8);
  const h = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const keys = Object.keys(h).map(k => k.toLowerCase()).sort(); const hl = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const qs = Object.keys(query).sort().map(k => `${uriEnc(k)}=${uriEnc(query[k])}`).join('&');
  const canon = [method, uriEnc(pathname, true), qs, keys.map(k => `${k}:${hl[k]}\n`).join(''), keys.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canon)].join('\n');
  const kSig = hmac(hmac(hmac(hmac('AWS4' + secretKey, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSig).update(sts).digest('hex');
  return { headers: { ...h, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${keys.join(';')}, Signature=${signature}` }, signature, qs };
}
function s3conf() {
  const e = process.env; if (!e.BACKUP_S3_ENDPOINT || !e.BACKUP_S3_BUCKET || !e.BACKUP_S3_ACCESS_KEY || !e.BACKUP_S3_SECRET_KEY) return null;
  const u = new URL(e.BACKUP_S3_ENDPOINT);
  return { u, bucket: e.BACKUP_S3_BUCKET, accessKey: e.BACKUP_S3_ACCESS_KEY, secretKey: e.BACKUP_S3_SECRET_KEY, region: e.BACKUP_S3_REGION || 'auto', prefix: (e.BACKUP_S3_PREFIX || 'hesi-backups/').replace(/^\/+/, '') };
}
function s3request(c, method, key, { query = {}, body = null, file = null, size = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const pathname = `${c.u.pathname.replace(/\/$/, '')}/${c.bucket}${key ? '/' + key : ''}`;
    const extra = {}; if (file || body) extra['content-length'] = file ? size : Buffer.byteLength(body);
    const s = sign({ method, host: c.u.host, pathname, query, headers: extra, payloadHash: file ? 'UNSIGNED-PAYLOAD' : sha256(body || ''), accessKey: c.accessKey, secretKey: c.secretKey, region: c.region });
    const mod = c.u.protocol === 'http:' ? http : https;
    const req = mod.request({ method, host: c.u.hostname, port: c.u.port || undefined, path: uriEnc(pathname, true) + (s.qs ? '?' + s.qs : ''), headers: s.headers, timeout: 15 * 60 * 1000 }, res => {
      const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); if (res.statusCode >= 300) reject(new Error(`S3 ${method} ${res.statusCode}：${(text.match(/<Message>([^<]*)/) || [])[1] || text.slice(0, 200)}`)); else resolve(text); });
    });
    req.on('timeout', () => req.destroy(new Error('上傳逾時'))); req.on('error', reject);
    if (file) fs.createReadStream(file).pipe(req); else req.end(body || undefined);
  });
}

module.exports = function createBackup({ db, DATA_DIR }) {
  const dir = path.join(DATA_DIR, 'backups'); try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const STATE = path.join(dir, 'state.json');
  const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
  const saveState = s => { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); } catch {} };
  let running = null;

  async function makeArchive() {
    const key = backupKey(); if (!key) throw new Error('沒有設定 DATA_ENCRYPTION_KEY，無法加密備份');
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
    const snap = path.join(dir, `snapshot-${process.pid}.sqlite`); try { fs.unlinkSync(snap); } catch {}
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // 一致的資料庫快照（不中斷服務）
    const entries = [{ file: snap, name: 'data.sqlite' }];
    walk(DATA_DIR, '', entries, rel => rel === 'backups' || rel.startsWith('backups/') || /^data\.sqlite(-wal|-shm)?$/.test(rel) || rel === '.session-secret' || /\.tmp$/.test(rel));
    const out = path.join(dir, `hesi-${stamp}.tar.gz.enc`), tmp = out + '.part';
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ws = fs.createWriteStream(tmp); ws.write(MAGIC); ws.write(iv);
    await pipeline(Readable.from(tarStream(entries)), zlib.createGzip({ level: 6 }), cipher, new Transform({ transform(c, e, cb) { cb(null, c); }, flush(cb) { this.push(cipher.getAuthTag()); cb(); } }), ws);
    fs.renameSync(tmp, out); try { fs.unlinkSync(snap); } catch {}
    return { file: out, name: path.basename(out), size: fs.statSync(out).size, files: entries.length };
  }
  // 本機只留最近 2 份（同一顆硬碟，主要靠異地那份）
  function pruneLocal() { const list = fs.readdirSync(dir).filter(n => /^hesi-.*\.enc$/.test(n)).sort(); for (const n of list.slice(0, -2)) try { fs.unlinkSync(path.join(dir, n)); } catch {} }
  async function pruneRemote(c, keepKey) {
    const keep = Math.max(Number(process.env.BACKUP_KEEP_DAYS) || 30, 3); const cut = Date.now() - keep * 864e5; let removed = 0;
    const xml = await s3request(c, 'GET', '', { query: { 'list-type': '2', prefix: c.prefix } });
    for (const m of xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<\/Contents>/g)) {
      if (m[1] !== keepKey && new Date(m[2]).getTime() < cut && /hesi-.*\.enc$/.test(m[1])) { await s3request(c, 'DELETE', m[1]); removed++; }
    }
    return removed;
  }
  async function run(reason = 'schedule') {
    if (running) return running;
    running = (async () => {
      const st = readState(); st.last_try_at = new Date().toISOString(); st.reason = reason;
      try {
        const a = await makeArchive(); pruneLocal();
        const c = s3conf(); let remote = '';
        if (c) { const key = c.prefix + a.name; await s3request(c, 'PUT', key, { file: a.file, size: a.size }); remote = key; try { st.removed = await pruneRemote(c, key); } catch (e) { st.prune_error = e.message; } }
        Object.assign(st, { last_ok_at: new Date().toISOString(), last_file: a.name, last_size: a.size, last_files: a.files, last_remote: remote, last_error: c ? '' : '尚未設定異地儲存（BACKUP_S3_*），目前只有本機備份' });
        console.log(`[備份] 完成 ${a.name}（${(a.size / 1048576).toFixed(1)} MB${remote ? '，已上傳異地' : '，僅本機'}）`);
      } catch (e) { st.last_error = e.message; console.error('[備份] 失敗：', e.message); }
      saveState(st); running = null; return st;
    })();
    return running;
  }
  // 排程：每 10 分鐘檢查一次，到了設定的時間且今天還沒備份就執行
  function schedule() {
    const hour = Math.min(Math.max(Number(process.env.BACKUP_HOUR ?? 3), 0), 23);
    const tick = () => {
      if (!backupKey()) return; const tw = new Date(Date.now() + 8 * 3600e3); const today = tw.toISOString().slice(0, 10);
      const st = readState(); const lastDay = st.last_ok_at ? new Date(new Date(st.last_ok_at).getTime() + 8 * 3600e3).toISOString().slice(0, 10) : '';
      if (tw.getUTCHours() >= hour && lastDay !== today && !(st.last_try_at && Date.now() - new Date(st.last_try_at).getTime() < 3600e3)) run('schedule');
    };
    setTimeout(tick, 60 * 1000).unref?.(); setInterval(tick, 10 * 60 * 1000).unref?.();
  }
  function status() {
    const c = s3conf(); const st = readState();
    return { configured: !!c && !!backupKey(), key_set: !!backupKey(), target: c ? `${c.u.host}/${c.bucket}/${c.prefix}` : '', hour: Number(process.env.BACKUP_HOUR ?? 3), keep_days: Number(process.env.BACKUP_KEEP_DAYS) || 30, running: !!running, ...st,
      local: (() => { try { return fs.readdirSync(dir).filter(n => /^hesi-.*\.enc$/.test(n)).sort().reverse().map(n => ({ name: n, size: fs.statSync(path.join(dir, n)).size })); } catch { return []; } })() };
  }
  return { run, schedule, status, dir, _sign: sign };
};
module.exports.sign = sign;
module.exports.MAGIC = MAGIC;
module.exports.backupKey = backupKey;
