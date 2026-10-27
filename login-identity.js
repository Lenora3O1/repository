'use strict';
// 登入身分：手機號碼登入、各公司登入方式、跨公司兼職的同號碼提醒。
// 原則：同一支手機可以在不同公司各有一個帳號（密碼各自設定）；
// 提醒時只說「已有帳號使用中」，不透露是哪一家公司。

const SHARED_MOBILE_MSG = '該號碼已有帳號使用中，是否繼續開通該人員（才可使用本公司開通之社區）';
const MODES = ['mobile', 'both'];

module.exports = function createLoginIdentity(db) {
  try { db.prepare("ALTER TABLE tenants ADD COLUMN login_mode TEXT DEFAULT 'both'").run(); } catch {}

  // 統一成 09xxxxxxxx；+886 / 886 / 少了開頭 0 都可以
  function normMobile(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (/^8869\d{8}$/.test(d)) d = '0' + d.slice(3);
    if (/^9\d{8}$/.test(d)) d = '0' + d;
    return d;
  }
  const isMobile = v => /^09\d{8}$/.test(normMobile(v));

  function loginMode(tenantId) {
    try { const r = db.prepare('SELECT login_mode FROM tenants WHERE id=?').get(tenantId); return MODES.includes(r?.login_mode) ? r.login_mode : 'both'; } catch { return 'both'; }
  }

  // 所有公司中，手機號碼相同的帳號 id（只看人事資料登記的手機）
  function staffIdsByMobile(mobile) {
    const m = normMobile(mobile); if (!m) return [];
    try { return db.prepare("SELECT staff_id,mobile FROM hr_profiles WHERE mobile<>''").all().filter(h => normMobile(h.mobile) === m).map(h => h.staff_id); } catch { return []; }
  }

  // 這支手機在「其他公司」是否已有啟用中的帳號
  function usedByOtherTenant(tenantId, mobile) {
    const ids = staffIdsByMobile(mobile); if (!ids.length) return false;
    const rows = db.prepare(`SELECT id FROM staff_users WHERE id IN (${ids.map(() => '?').join(',')}) AND tenant_id<>? AND is_active=1`).all(...ids, tenantId);
    return rows.length > 0;
  }

  function mobileOf(staffId) {
    try { return db.prepare('SELECT mobile FROM hr_profiles WHERE staff_id=?').get(staffId)?.mobile || ''; } catch { return ''; }
  }

  // 開通／改手機前的檢查。回傳 null 表示可以繼續；否則回傳 {status, body} 給前端。
  // opts.previous：原本的手機（沒改就不再提醒）
  function checkForAccount(tenantId, mobile, body, opts = {}) {
    const m = normMobile(mobile);
    if (!m) {
      if (opts.requireForMode && loginMode(tenantId) === 'mobile') return { status: 400, body: { error: '本公司使用手機號碼登入，請填寫人員手機號碼' } };
      return null;
    }
    if (!isMobile(m)) return { status: 400, body: { error: '手機號碼格式不正確（例如 0912345678）' } };
    if (opts.previous !== undefined && normMobile(opts.previous) === m) return null;
    const same = staffIdsByMobile(m).filter(id => id !== Number(opts.exceptId || 0));
    if (same.length && db.prepare(`SELECT 1 FROM staff_users WHERE id IN (${same.map(() => '?').join(',')}) AND tenant_id=? AND is_active=1`).get(...same, tenantId)) return { status: 400, body: { error: '這個手機號碼已經有本公司其他人員使用' } };
    if (usedByOtherTenant(tenantId, m) && !(body && (body.confirm_shared_mobile === true || body.confirm_shared_mobile === '1'))) {
      return { status: 409, body: { error: SHARED_MOBILE_MSG, needs_confirm: 'shared_mobile' } };
    }
    return null;
  }

  // 手機登入的公司，員編可以不填：自動編一個內部員編
  function autoEmployeeId(tenantId) {
    const rows = db.prepare("SELECT employee_id FROM staff_users WHERE tenant_id=? AND employee_id LIKE 'U%'").all(tenantId);
    let n = rows.reduce((mx, r) => Math.max(mx, Number(String(r.employee_id).slice(1)) || 0), 0) + 1;
    while (db.prepare('SELECT 1 FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tenantId, 'U' + String(n).padStart(4, '0'))) n++;
    return 'U' + String(n).padStart(4, '0');
  }

  function saveMobile(tenantId, staffId, mobile) {
    const m = normMobile(mobile); if (!m) return;
    try {
      db.prepare('INSERT OR IGNORE INTO hr_profiles (tenant_id,staff_id,updated_at) VALUES (?,?,?)').run(tenantId, staffId, new Date().toISOString());
      db.prepare('UPDATE hr_profiles SET mobile=? WHERE tenant_id=? AND staff_id=?').run(m, tenantId, staffId);
    } catch (e) { console.warn('mobile save failed', e.message); }
  }

  return { SHARED_MOBILE_MSG, MODES, normMobile, isMobile, loginMode, staffIdsByMobile, usedByOtherTenant, mobileOf, checkForAccount, autoEmployeeId, saveMobile };
};
