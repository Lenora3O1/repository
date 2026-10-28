// 帳號與密碼：第一次登入強制修改、職員自行修改、管理員重設臨時密碼
'use strict';
const crypto = require('crypto');

module.exports = function registerAccountRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaff, requireCompanyAdmin, requireCompanyPermission } = d;
  { const cols = db.prepare('PRAGMA table_info(staff_users)').all().map(c => c.name); if (!cols.includes('must_change_password')) db.exec('ALTER TABLE staff_users ADD COLUMN must_change_password INTEGER DEFAULT 0'); }
  // 所有新開的帳號（公司管理員、一般人員）初始密碼都是別人設定的，第一次登入一律要改
  db.exec('CREATE TRIGGER IF NOT EXISTS trg_staff_users_must_change AFTER INSERT ON staff_users BEGIN UPDATE staff_users SET must_change_password=1 WHERE id=NEW.id; END;');

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  function rule(pw, u) {
    if (pw.length < 6) return '新密碼至少 6 碼';
    if (pw.length > 64) return '新密碼太長';
    if (pw === u.employee_id) return '新密碼不能與帳號相同';
    { const dg = s => String(s || '').replace(/\D/g, ''); let m = ''; try { m = db.prepare('SELECT mobile FROM hr_profiles WHERE staff_id=?').get(u.id)?.mobile || ''; } catch {} if (m && dg(pw).length >= 9 && dg(pw).slice(-9) === dg(m).slice(-9) && pw.replace(/[\d\s+-]/g, '') === '') return '新密碼不能與帳號（手機號碼）相同'; }
    if (/^(\d)\1+$/.test(pw) || ['123456', '1234567', '12345678', '000000', '111111', 'password'].includes(pw.toLowerCase())) return '這個密碼太容易被猜到，請換一個';
    return '';
  }
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
    db.prepare('UPDATE staff_users SET password_hash=?,password_salt=?,must_change_password=1,updated_at=? WHERE id=?').run(p.hash, p.salt, now(), u.id);
    res.json({ success: true, temp_password: temp, employee_id: u.employee_id, name: u.name });
  });
};
