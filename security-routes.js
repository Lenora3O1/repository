// 資安中心：兩步驟驗證登入、敏感資料查看紀錄、公司端（帳號安全／查看紀錄）、總後台（資安狀態）
'use strict';

module.exports = function registerSecurityRoutes(app, d) {
  const { db, getUser, tenantId, now, requireCompanyAdmin, requireSuperAdmin, twofa, security, fieldCrypto, effectivePermissions, getOrg, finishStaffLogin, recordLoginFail, lockMessage, isOwnerAccount, backup, uploadScan } = d;
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const PENDING_MS = 10 * 60 * 1000, MAX_TRIES = 5;
  const orgKind = u => { try { return getOrg()?.memberInfo(u)?.kind || ''; } catch { return ''; } };
  const needs2fa = u => twofa.required() && twofa.needsFor(u, { orgKind: orgKind(u), perms: effectivePermissions(u) || [] });
  const isBoss = u => !!u && (u.role === 'company_admin' || ['owner', 'gm'].includes(orgKind(u)));
  const log = (u, action, detail) => { try { db.prepare('INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(u.tenant_id, u.employee_id, u.name, action, 'security', 'staff_user', String(u.id), detail, now()); } catch {} };

  // ================= 信任的裝置：勾選後 30 天內這台電腦／手機不用再輸入驗證碼 =================
  // 瀏覽器只存一組隨機代碼（Cookie，網頁程式讀不到）；伺服器只存代碼的雜湊。重設兩步驟驗證或密碼時一併取消。
  const crypto = require('crypto');
  const TRUST_DAYS = 30;
  db.exec(`CREATE TABLE IF NOT EXISTS trusted_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, user_key TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, device TEXT DEFAULT '', ip TEXT DEFAULT '', created_at TEXT NOT NULL, last_used_at TEXT, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_trusted_user ON trusted_devices(user_key);`);
  const hashTok = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  const cookieName = key => 'hs_td_' + key.replace(/[^a-z0-9]/gi, '');
  const readCookie = (req, name) => { const m = new RegExp('(?:^|;\\s*)' + name + '=([A-Za-z0-9_-]{20,})').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
  const addCookie = (res, v) => { const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [].concat(prev || [], v)); };
  const deviceName = ua => { ua = String(ua || ''); const os = /iPhone|iPad/.test(ua) ? 'iPhone／iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : '其他'; const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '瀏覽器'; return `${os}｜${br}`; };
  function isTrusted(req, key) {
    const t = readCookie(req, cookieName(key)); if (!t) return false;
    const r = db.prepare('SELECT id,expires_at FROM trusted_devices WHERE user_key=? AND token_hash=?').get(key, hashTok(t));
    if (!r || r.expires_at < Date.now()) return false;
    db.prepare('UPDATE trusted_devices SET last_used_at=?,ip=? WHERE id=?').run(now(), String(req.ip || ''), r.id); return true;
  }
  function trustDevice(req, res, key) {
    const t = crypto.randomBytes(32).toString('base64url'); const exp = Date.now() + TRUST_DAYS * 864e5;
    db.prepare('INSERT INTO trusted_devices (user_key,token_hash,device,ip,created_at,expires_at) VALUES (?,?,?,?,?,?)').run(key, hashTok(t), deviceName(req.headers['user-agent']), String(req.ip || ''), now(), exp);
    addCookie(res, `${cookieName(key)}=${t}; Path=/; Max-Age=${TRUST_DAYS * 86400}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  }
  const untrustAll = key => db.prepare('DELETE FROM trusted_devices WHERE user_key=?').run(key).changes;
  const trustedCount = key => db.prepare('SELECT COUNT(*) n FROM trusted_devices WHERE user_key=? AND expires_at>?').get(key, Date.now()).n;
  try { db.prepare('DELETE FROM trusted_devices WHERE expires_at<?').run(Date.now()); } catch {}

  // ================= 兩步驟驗證：內勤入口 =================
  // 由 server.js 的登入流程呼叫：密碼正確後，需要兩步驟的人先不登入，改回傳 need_2fa／setup_2fa
  function startIfNeeded(req, res, user, entry) {
    if (entry !== 'company' || !needs2fa(user)) return false;
    if (twofa.state(user).enabled && isTrusted(req, `s${user.id}`)) return false; // 信任的裝置：直接登入
    req.session.pending2fa = { uid: user.id, entry, at: Date.now(), tries: 0 };
    const s = twofa.state(user);
    if (s.enabled) { res.json({ need_2fa: true, name: user.name }); return true; }
    const setup = twofa.beginSetup(user, `${user.tenant_name || ''} ${user.name || user.employee_id}`.trim());
    res.json({ setup_2fa: true, name: user.name, secret: setup.secret, otpauth: setup.otpauth });
    return true;
  }
  app.post('/api/staff/login-2fa', (req, res) => {
    const p = req.session?.pending2fa; if (!p || Date.now() - p.at > PENDING_MS) { if (req.session) delete req.session.pending2fa; return bad(res, '驗證逾時，請重新輸入帳號密碼登入', 401); }
    const user = db.prepare(`SELECT u.*,t.name AS tenant_name,t.status AS tenant_status,t.code AS tenant_code,COALESCE(t.login_mode,'both') AS login_mode FROM staff_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=?`).get(p.uid);
    if (!user || !user.is_active || user.tenant_status !== 'active') { delete req.session.pending2fa; return bad(res, '帳號已停用', 401); }
    if (user.locked_at) { delete req.session.pending2fa; return bad(res, lockMessage(user), 401); }
    const code = String(req.body?.code || '').trim(); const s = twofa.state(user);
    let codes = null;
    if (!s.enabled) { codes = twofa.finishSetup(user, code); if (!codes) return fail(); log(user, '2fa_enabled', '完成兩步驟驗證設定'); }
    else { const how = twofa.check(user, code); if (!how) return fail(); if (how === 'recovery') log(user, '2fa_recovery_used', '使用備用碼登入'); }
    delete req.session.pending2fa;
    if (req.body?.trust) { trustDevice(req, res, `s${user.id}`); log(user, '2fa_trust_device', `信任裝置 ${TRUST_DAYS} 天：${deviceName(req.headers['user-agent'])}`); }
    return finishStaffLogin(req, res, user, p.entry, codes ? { recovery_codes: codes } : {});
    function fail() {
      p.tries++;
      if (p.tries >= MAX_TRIES) { delete req.session.pending2fa; const r = recordLoginFail([{ ...user, failed_logins: Math.max(Number(user.failed_logins) || 0, 4) }]); return bad(res, r[0]?.lock ? lockMessage(user) : '驗證碼錯誤次數過多，請重新登入', 401); }
      return bad(res, `驗證碼不正確（還可以再試 ${MAX_TRIES - p.tries} 次）。請確認手機時間正確，並輸入 App 上「目前」顯示的 6 位數。`, 401);
    }
  });

  // ================= 兩步驟驗證：系統總後台 =================
  function adminStart(req, res) {
    if (!twofa.required()) return false;
    if (twofa.admin.state().enabled && isTrusted(req, 'admin')) return false;
    req.session.adminPending = { at: Date.now(), tries: 0 };
    if (twofa.admin.state().enabled) { res.json({ need_2fa: true }); return true; }
    const s = twofa.admin.beginSetup(); res.json({ setup_2fa: true, secret: s.secret, otpauth: s.otpauth }); return true;
  }
  app.post('/api/admin/login-2fa', (req, res) => {
    const p = req.session?.adminPending; if (!p || Date.now() - p.at > PENDING_MS) { if (req.session) delete req.session.adminPending; return bad(res, '驗證逾時，請重新輸入帳號密碼登入', 401); }
    const code = String(req.body?.code || '').trim(); let codes = null;
    if (!twofa.admin.state().enabled) { codes = twofa.admin.finishSetup(code); if (!codes) return fail(); }
    else if (!twofa.admin.check(code)) return fail();
    delete req.session.adminPending;
    req.session.isAdmin = true; req.session.employeeId = null; req.session.tenantId = null; req.session.role = 'super_admin'; req.session.adminAt = Date.now();
    if (req.body?.trust) trustDevice(req, res, 'admin');
    return res.json({ success: true, ...(codes ? { recovery_codes: codes } : {}) });
    function fail() { p.tries++; if (p.tries >= MAX_TRIES) { delete req.session.adminPending; return bad(res, '驗證碼錯誤次數過多，請重新登入', 401); } return bad(res, `驗證碼不正確（還可以再試 ${MAX_TRIES - p.tries} 次）`, 401); }
  });

  // ================= 敏感資料查看紀錄 =================
  db.exec(`CREATE TABLE IF NOT EXISTS data_access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER, employee_id TEXT DEFAULT '', name TEXT DEFAULT '', category TEXT NOT NULL, what TEXT DEFAULT '', path TEXT DEFAULT '', ip TEXT DEFAULT '', at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_data_access ON data_access_logs(tenant_id, at);`);
  const WATCH = [
    [/^\/api\/staff\/residents(\/(export|contact-sheet|history|parking))?$/, '住戶名冊', p => /export/.test(p) ? '匯出住戶名冊' : /contact-sheet/.test(p) ? '住戶聯絡表' : /history/.test(p) ? '住戶名冊歷史版本' : /parking/.test(p) ? '車位與車牌' : '查看住戶名冊'],
    [/^\/api\/company\/payroll\/(salaries|runs(\/[^/]+(\/export)?)?|items\/\d+|advances)$/, '薪資', p => /export/.test(p) ? '匯出薪資表' : /salaries/.test(p) ? '人員薪資設定' : /advances/.test(p) ? '借資紀錄' : /items/.test(p) ? '個人薪資明細' : '人員薪資統計表'],
    [/^\/api\/company\/hr\/profiles(\/\d+)?$/, '人事資料', () => '人事資料（身分證、銀行帳號、聯絡方式）'],
    [/^\/api\/company\/interviews\/\d+$/, '面試者資料', () => '面試者履歷'],
  ];
  const recent = new Map();
  function accessLog(req, res, next) {
    if (req.method !== 'GET') return next();
    const w = WATCH.find(([re]) => re.test(req.path)); if (!w) return next();
    res.on('finish', () => {
      if (res.statusCode !== 200) return;
      let u; try { u = getUser(req); } catch { return; } if (!u || !u.tenant_id) return;
      const cid = req.query?.community_id || req.query?.communityId || req.query?.cid || '';
      let what = w[2](req.path); if (cid) { try { const c = db.prepare('SELECT name FROM communities WHERE id=? AND tenant_id=?').get(Number(cid), u.tenant_id); if (c) what += `｜${c.name}`; } catch {} }
      // 同一個人 10 分鐘內重複看同一份資料只記一次
      const key = `${u.id}|${w[1]}|${what}`; const t = Date.now(); if (recent.get(key) > t - 600000) return; recent.set(key, t);
      if (recent.size > 5000) for (const [k, v] of recent) if (v < t - 600000) recent.delete(k);
      try { db.prepare('INSERT INTO data_access_logs (tenant_id,staff_id,employee_id,name,category,what,path,ip,at) VALUES (?,?,?,?,?,?,?,?,?)').run(u.tenant_id, u.id, u.employee_id || '', u.name || '', w[1], what, req.path, String(req.ip || ''), now()); } catch {}
    });
    next();
  }

  // ================= 公司端：資安中心（老闆、總經理、公司管理員） =================
  const C = '/api/company/security';
  const needBoss = (req, res, next) => isBoss(getUser(req)) ? next() : bad(res, '只有公司負責人、總經理或公司管理員可以查看', 403);
  app.get(C, requireCompanyAdmin, needBoss, (req, res) => {
    const tid = tenantId(req);
    const users = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 ORDER BY role DESC, employee_id").all(tid);
    const locked = users.filter(u => u.locked_at).map(u => ({ id: u.id, employee_id: u.employee_id, name: u.name, locked_at: u.locked_at, owner: isOwnerAccount(u) }));
    const twofaRows = users.filter(u => twofa.needsFor(u, { orgKind: orgKind(u), perms: effectivePermissions(u) || [] })).map(u => { const s = twofa.state(u); return { id: u.id, employee_id: u.employee_id, name: u.name, enabled: s.enabled, recovery_left: s.recovery.length, owner: isOwnerAccount(u), trusted: trustedCount(`s${u.id}`) }; });
    const q = req.query || {}; const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const args = [tid, since]; let where = 'tenant_id=? AND at>=?';
    if (q.category) { where += ' AND category=?'; args.push(String(q.category)); }
    if (q.staff_id) { where += ' AND staff_id=?'; args.push(Number(q.staff_id)); }
    const logs = db.prepare(`SELECT staff_id,employee_id,name,category,what,ip,at FROM data_access_logs WHERE ${where} ORDER BY at DESC LIMIT 500`).all(...args);
    const events = db.prepare("SELECT employee_id,employee_name,action,detail,created_at FROM audit_logs WHERE tenant_id=? AND module='security' ORDER BY created_at DESC LIMIT 100").all(tid);
    res.set('Cache-Control', 'no-store');
    res.json({ required: twofa.required(), locked, twofa: twofaRows, logs, events, categories: ['住戶名冊', '薪資', '人事資料', '面試者資料'], days });
  });
  // 重設某人的兩步驟驗證（換手機、手機遺失）：公司負責人的由總後台重設
  app.post(`${C}/2fa-reset/:id`, requireCompanyAdmin, needBoss, (req, res) => {
    const me = getUser(req); const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req));
    if (!u) return bad(res, '找不到人員', 404);
    if (u.id === me.id) return bad(res, '不能重設自己的兩步驟驗證，請由公司負責人或系統服務商處理');
    if (isOwnerAccount(u)) return bad(res, '公司負責人的兩步驟驗證請聯絡系統服務商（總後台）重設', 403);
    twofa.reset(u.id); untrustAll(`s${u.id}`); log(me, '2fa_reset', `重設 ${u.name}（${u.employee_id}）的兩步驟驗證`);
    res.json({ success: true });
  });

  // 取消某人所有「信任的裝置」（電腦遺失、離職交接、懷疑被別人使用時）
  app.post(`${C}/untrust/:id`, requireCompanyAdmin, needBoss, (req, res) => {
    const me = getUser(req); const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req));
    if (!u) return bad(res, '找不到人員', 404);
    const n = untrustAll(`s${u.id}`); log(me, '2fa_untrust', `取消 ${u.name}（${u.employee_id}）的 ${n} 台信任裝置`);
    res.json({ success: true, removed: n });
  });

  // ================= 總後台：資安狀態 =================
  app.get('/api/admin/security', requireSuperAdmin, (req, res) => {
    const fc = fieldCrypto.status();
    res.set('Cache-Control', 'no-store');
    res.json({
      hosted: security.isHosted(),
      admin_pass_ok: !security.adminPasswordProblem(process.env.ADMIN_PASS || 'admin123') || !security.isHosted(),
      admin_pass_set: !!process.env.ADMIN_PASS,
      session_secret_set: !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16),
      twofa_required: twofa.required(), admin_2fa: { enabled: twofa.admin.state().enabled, recovery_left: twofa.admin.state().recovery.length },
      field_crypto: fc,
      backup: backup ? backup.status() : null,
      upload_scan: uploadScan ? uploadScan.status() : null,
      locked_owners: db.prepare("SELECT u.id,u.employee_id,u.name,t.name tenant_name,t.id tenant_id FROM staff_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.role='company_admin' AND u.admin_level='owner' AND COALESCE(u.locked_at,'')<>''").all(),
    });
  });
  app.post('/api/admin/tenants/:id/admin/reset-2fa', requireSuperAdmin, (req, res) => {
    const u = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND role='company_admin' AND admin_level='owner' ORDER BY id LIMIT 1").get(Number(req.params.id));
    if (!u) return bad(res, '找不到公司負責人', 404);
    twofa.reset(u.id); untrustAll(`s${u.id}`); log({ tenant_id: u.tenant_id, employee_id: 'super_admin', name: '系統總後台' }, '2fa_reset', `總後台重設公司負責人 ${u.name}（${u.employee_id}）的兩步驟驗證`);
    res.json({ success: true });
  });

  return { startIfNeeded, adminStart, needs2fa, accessLog, untrustAll, trustedCount };
};
