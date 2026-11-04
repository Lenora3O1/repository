// 兩步驟驗證（TOTP，RFC 6238）：登入時除了密碼，還要輸入手機驗證 App（Google Authenticator、Microsoft Authenticator 等）上的 6 位數。
// 適用：系統總後台、公司管理員／負責人／總經理、有會計權限的人（內勤入口）。
// 遺失手機：每人設定時會拿到 10 組一次性備用碼；一般人員由公司負責人重設，公司負責人由總後台重設，總後台用備用碼或主機環境變數 ADMIN_2FA_RESET=1 重設。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(v << (5 - bits)) & 31]; return out; }
function b32decode(s) { s = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest(); const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30000);
// 驗證：容許前後各 30 秒的時間誤差；同一組驗證碼不能用第二次（lastStep）
function verify(secret, code, lastStep = 0) {
  code = String(code || '').replace(/\D/g, ''); if (code.length !== 6 || !secret) return 0;
  const s = stepNow();
  for (const d of [0, -1, 1]) { const st = s + d; if (st <= lastStep) continue; const c = hotp(secret, st); if (crypto.timingSafeEqual(Buffer.from(c), Buffer.from(code))) return st; }
  return 0;
}
const newSecret = () => b32encode(crypto.randomBytes(20));
const otpauth = (secret, label, issuer = '鶴絲物業管理系統') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
// 備用碼：10 組，各 10 碼（xxxxx-xxxxx），只存雜湊
function newRecovery() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = Array.from({ length: 10 }, () => { const r = crypto.randomBytes(10); const s = Array.from(r, b => A[b % A.length]).join(''); return `${s.slice(0, 5)}-${s.slice(5)}`; });
  return { codes, hashes: codes.map(hashRecovery) };
}
const hashRecovery = c => crypto.createHash('sha256').update(String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function useRecovery(hashes, code) { const h = hashRecovery(code); const i = (hashes || []).indexOf(h); if (i < 0) return null; const rest = hashes.slice(); rest.splice(i, 1); return rest; }

module.exports = function createTwoFactor({ db, DATA_DIR, now, fieldCrypto, security }) {
  const required = () => security.isHosted() || process.env.REQUIRE_2FA === '1';
  // ---------- 公司帳號 ----------
  { const cols = db.prepare('PRAGMA table_info(staff_users)').all().map(c => c.name);
    for (const [c, t] of [['totp_secret', "TEXT DEFAULT ''"], ['totp_enabled', 'INTEGER DEFAULT 0'], ['totp_recovery_json', "TEXT DEFAULT '[]'"], ['totp_last_step', 'INTEGER DEFAULT 0']]) if (!cols.includes(c)) db.exec(`ALTER TABLE staff_users ADD COLUMN ${c} ${t}`); }
  const enc = v => fieldCrypto ? fieldCrypto.enc(v) : v, dec = v => fieldCrypto ? fieldCrypto.dec(v) : v;

  // 哪些人登入內勤後台要兩步驟驗證：公司管理員（含負責人）、組織圖上的負責人／總經理、有會計權限的人
  function needsFor(u, { orgKind = '', perms = [] } = {}) {
    if (!u) return false;
    if (u.role === 'company_admin') return true;
    if (['owner', 'gm'].includes(orgKind)) return true;
    return perms.some(p => ['company-accounting', 'company-finance'].includes(p));
  }
  function state(u) { const r = db.prepare('SELECT totp_secret,totp_enabled,totp_recovery_json,totp_last_step FROM staff_users WHERE id=?').get(u.id) || {}; let rec = []; try { rec = JSON.parse(r.totp_recovery_json || '[]'); } catch {} return { enabled: !!r.totp_enabled, secret: dec(r.totp_secret || ''), recovery: rec, last: Number(r.totp_last_step) || 0 }; }
  // 檢查驗證碼（或備用碼）；成功回傳 true 並記下使用過的時間步，避免重放
  function check(u, code) {
    const s = state(u); if (!s.enabled) return false;
    const st = verify(s.secret, code, s.last);
    if (st) { db.prepare('UPDATE staff_users SET totp_last_step=? WHERE id=?').run(st, u.id); return 'totp'; }
    const rest = useRecovery(s.recovery, code);
    if (rest) { db.prepare('UPDATE staff_users SET totp_recovery_json=? WHERE id=?').run(JSON.stringify(rest), u.id); return 'recovery'; }
    return false;
  }
  function beginSetup(u, label) { const secret = newSecret(); db.prepare('UPDATE staff_users SET totp_secret=?,totp_enabled=0 WHERE id=?').run(enc(secret), u.id); return { secret, otpauth: otpauth(secret, label) }; }
  function finishSetup(u, code) {
    const s = state(u); if (s.enabled || !s.secret) return null;
    const st = verify(s.secret, code, 0); if (!st) return null;
    const r = newRecovery();
    db.prepare('UPDATE staff_users SET totp_enabled=1,totp_last_step=?,totp_recovery_json=? WHERE id=?').run(st, JSON.stringify(r.hashes), u.id);
    return r.codes;
  }
  function reset(userId) { db.prepare("UPDATE staff_users SET totp_secret='',totp_enabled=0,totp_recovery_json='[]',totp_last_step=0 WHERE id=?").run(userId); }

  // ---------- 系統總後台（帳號在環境變數，設定存在資料夾） ----------
  const ADMIN_FILE = path.join(DATA_DIR, 'admin-2fa.json');
  function adminState() { try { const j = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); return { enabled: !!j.enabled, secret: dec(j.secret || ''), recovery: j.recovery || [], last: Number(j.last) || 0 }; } catch { return { enabled: false, secret: '', recovery: [], last: 0 }; } }
  function adminSave(s) { fs.writeFileSync(ADMIN_FILE, JSON.stringify({ enabled: !!s.enabled, secret: enc(s.secret || ''), recovery: s.recovery || [], last: s.last || 0, updated_at: now() }), { mode: 0o600 }); }
  if (process.env.ADMIN_2FA_RESET === '1') { try { fs.unlinkSync(ADMIN_FILE); console.warn('[資安] ADMIN_2FA_RESET=1：已清除總後台兩步驟驗證，下次登入請重新設定，並記得把 ADMIN_2FA_RESET 移除。'); } catch {} }
  const admin = {
    state: adminState,
    check(code) { const s = adminState(); if (!s.enabled) return false; const st = verify(s.secret, code, s.last); if (st) { s.last = st; adminSave(s); return 'totp'; } const rest = useRecovery(s.recovery, code); if (rest) { s.recovery = rest; adminSave(s); return 'recovery'; } return false; },
    beginSetup() { const secret = newSecret(); adminSave({ enabled: false, secret }); return { secret, otpauth: otpauth(secret, '系統總後台') }; },
    finishSetup(code) { const s = adminState(); if (s.enabled || !s.secret) return null; const st = verify(s.secret, code, 0); if (!st) return null; const r = newRecovery(); adminSave({ enabled: true, secret: s.secret, recovery: r.hashes, last: st }); return r.codes; },
  };
  return { required, needsFor, state, check, beginSetup, finishSetup, reset, admin, _totp: { hotp, verify, stepNow, b32decode } };
};
