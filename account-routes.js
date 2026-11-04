// 帳號與密碼：第一次登入強制修改、職員自行修改、管理員重設臨時密碼
'use strict';
const crypto = require('crypto');

module.exports = function registerAccountRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaff, requireCompanyAdmin, requireCompanyPermission } = d;
  { const cols = db.prepare('PRAGMA table_info(staff_users)').all().map(c => c.name); if (!cols.includes('must_change_password')) db.exec('ALTER TABLE staff_users ADD COLUMN must_change_password INTEGER DEFAULT 0'); }
  // 所有新開的帳號（公司管理員、一般人員）初始密碼都是別人設定的，第一次登入一律要改
  db.exec('CREATE TRIGGER IF NOT EXISTS trg_staff_users_must_change AFTER INSERT ON staff_users BEGIN UPDATE staff_users SET must_change_password=1 WHERE id=NEW.id; END;');

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const security = require('./security');
  const mobileOf = u => { try { return db.prepare('SELECT mobile FROM hr_profiles WHERE staff_id=?').get(u.id)?.mobile || ''; } catch { return ''; } };
  const rule = (pw, u) => security.passwordProblem(pw, { account: u.employee_id, mobile: mobileOf(u) });
  // 登入成功時檢查：原本的密碼不符合新規則（例如 123456、pass1234），下一步就要求本人改密碼
  d.checkWeakOnLogin = (u, pw) => { if (!u || u.must_change_password) return; if (rule(pw, u)) db.prepare('UPDATE staff_users SET must_change_password=1 WHERE id=?').run(u.id); };
  function change(req, res) {
    const u = getUser(req); if (!u) return bad(res, '尚未登入', 401);
    const cur = String(req.body?.current_password || ''), next = String(req.body?.new_password || '');
    if (!db.verifyPassword(cur, u.password_salt, u.password_hash)) return bad(res, '目前的密碼不正確');
    if (cur === next) return bad(res, '新密碼不能和目前的密碼相同');
    const why = rule(next, u); if (why) return bad(res, why);
    const p = db.makePassword(next);
    db.prepare('UPDATE staff_users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?').run(p.hash, p.salt, now(), u.id);
    res.json({ success: true });
  }
  // requireStaff／requireCompanyAdmin 會放行 /password（見 server.js PASSWORD_FREE_PATH）
  app.post('/api/staff/password', requireStaff, change);
  app.post('/api/company/my/password', requireCompanyAdmin, change);

  // 管理員重設：產生臨時密碼（只顯示一次），對方下次登入要改密碼
  app.post('/api/company/staff/:id/reset-password', requireCompanyAdmin, requireCompanyPermission('manage-staff'), (req, res) => {
    const me = getUser(req); const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req));
    if (!u) return bad(res, '找不到人員', 404);
    if (u.id === me.id) return bad(res, '自己的密碼請用「修改密碼」');
    if (u.role === 'company_admin' && (me.role !== 'company_admin' || (me.admin_level || 'admin') !== 'owner' || u.admin_level === 'owner')) return bad(res, '公司管理員的密碼只能由公司負責人重設', 403);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const temp = Array.from(crypto.randomBytes(8), b => alphabet[b % alphabet.length]).join('');
    const p = db.makePassword(temp);
    db.prepare("UPDATE staff_users SET password_hash=?,password_salt=?,must_change_password=1,failed_logins=0,locked_at='',updated_at=? WHERE id=?").run(p.hash, p.salt, now(), u.id);
    try { db.prepare('DELETE FROM trusted_devices WHERE user_key=?').run(`s${u.id}`); } catch {} // 重設密碼：已信任的裝置也要重新驗證
    res.json({ success: true, temp_password: temp, employee_id: u.employee_id, name: u.name });
  });
  // 解鎖：密碼連續錯 5 次被鎖的帳號，由有「人員管理」權限的主管解鎖（公司負責人只能由總後台重發密碼）
  app.post('/api/company/staff/:id/unlock', requireCompanyAdmin, requireCompanyPermission('manage-staff'), (req, res) => {
    const me = getUser(req); const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req));
    if (!u) return bad(res, '找不到人員', 404);
    if (u.role === 'company_admin' && (u.admin_level || 'admin') === 'owner') return bad(res, '公司負責人帳號請聯絡系統服務商（總後台）重新核發密碼', 403);
    if (u.role === 'company_admin' && (me.role !== 'company_admin' || (me.admin_level || 'admin') !== 'owner')) return bad(res, '公司管理員帳號只能由公司負責人解鎖', 403);
    db.prepare("UPDATE staff_users SET failed_logins=0,locked_at='',updated_at=? WHERE id=?").run(now(), u.id);
    try { db.prepare('INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(u.tenant_id, me.employee_id, me.name, 'account_unlocked', 'security', 'staff_user', String(u.id), `解鎖 ${u.name}（${u.employee_id}）`, now()); } catch {}
    res.json({ success: true });
  });
};
