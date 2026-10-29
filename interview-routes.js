// 面試人員線上履歷＋職務考核
// - 面試電腦（公司內）：選職務類別（行政／勤務）→ 個資告知同意 → 履歷 → 有無經驗 → 考核題目；只限電腦操作，並記錄操作情形。
// - 面試結果只給該職務的主管與人事（總後台可設定）看：選擇題自動計分，情境題由主管評分；錄取後可轉成員工資料。
// - 未錄取者的資料保存期限屆滿自動刪除（個資法）。
'use strict';
const BANK = require('./interview-bank');

module.exports = function registerInterviewRoutes(app, d) {
  const { db, crypto, getUser, tenantId, now, requireCompanyAdmin, requireSuperAdmin, org, acct, addons } = d;
  // 加值功能：總後台開通的公司才能使用
  const addonOn = tid => !addons || addons.isOn(tid, 'interview');
  const OFF = '這家公司尚未開通線上面試功能，請洽系統管理者';

  db.exec(`
  CREATE TABLE IF NOT EXISTS interview_settings (tenant_id INTEGER PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}', bank_json TEXT, updated_at TEXT, updated_by TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS interview_applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, token TEXT NOT NULL, category TEXT NOT NULL, position TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'filling',
    name TEXT DEFAULT '', resume_json TEXT DEFAULT '{}', experienced INTEGER DEFAULT 0, exp_years REAL DEFAULT 0, questions_json TEXT DEFAULT '[]', answers_json TEXT DEFAULT '{}',
    auto_score REAL DEFAULT 0, auto_max REAL DEFAULT 0, manual_json TEXT DEFAULT '{}', manual_score REAL, manual_max REAL DEFAULT 0, metrics_json TEXT DEFAULT '{}',
    rating INTEGER, decision TEXT DEFAULT '', comments_json TEXT DEFAULT '[]', reviewed_by TEXT DEFAULT '', staff_id INTEGER, ip TEXT DEFAULT '', user_agent TEXT DEFAULT '',
    consent_at TEXT, started_at TEXT NOT NULL, resume_at TEXT, submitted_at TEXT, decided_at TEXT, expires_at TEXT, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_interview ON interview_applicants(tenant_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_token ON interview_applicants(token);
  CREATE TABLE IF NOT EXISTS interview_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, applicant_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, actor_id INTEGER, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_interview_logs ON interview_logs(applicant_id);
  CREATE TABLE IF NOT EXISTS interview_kiosk (tenant_id INTEGER PRIMARY KEY, pw_hash TEXT, pw_salt TEXT, must_change INTEGER DEFAULT 1, created_at TEXT, reset_at TEXT, changed_at TEXT, fails INTEGER DEFAULT 0, locked_until TEXT);
  CREATE TABLE IF NOT EXISTS interview_kiosk_sessions (token TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ua TEXT DEFAULT '', ip TEXT DEFAULT '');
  `);
  { const cols = db.prepare('PRAGMA table_info(interview_applicants)').all().map(c => c.name);
    for (const [c, d0] of [['option_id', "TEXT DEFAULT ''"], ['assignees', "TEXT DEFAULT ','"], ['first_viewed_at', 'TEXT'], ['escalated_at', 'TEXT'], ['typing_json', "TEXT DEFAULT ''"]]) if (!cols.includes(c)) db.exec(`ALTER TABLE interview_applicants ADD COLUMN ${c} ${d0}`); }

  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const by = u => u?.name || u?.employee_id || '';
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1").all(tid).map(x => x.id);
  function notify(tid, toIds, subject, body) {
    for (const toId of [...new Set(toIds)].filter(Boolean)) {
      try {
        const to = staffRow(tid, toId); if (!to) continue; const a = adminIds(tid).find(x => x !== to.id) || adminIds(tid)[0]; const sender = a ? staffRow(tid, a) : null; if (!sender || sender.id === to.id) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, subject, body, 'text', '', now());
      } catch (e) { console.warn('interview message failed', e.message); }
    }
  }

  // ---------- 設定與題庫 ----------
  function normCat(c, def) {
    const list = (v, m = 30, n = 30) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map(x => str(x, m)).filter(Boolean))].slice(0, n);
    return { id: def.id, name: str(c?.name, 10) || def.name, hint: str(c?.hint ?? def.hint, 60), positions: c?.positions ? list(c.positions) : def.positions.slice(), reviewer_positions: c?.reviewer_positions ? list(c.reviewer_positions, 40) : def.reviewer_positions.slice(), licenses: c?.licenses ? list(c.licenses, 40) : def.licenses.slice() };
  }
  function normalize(c) {
    c = c && typeof c === 'object' ? c : {}; const D = BANK.DEFAULT_SETTINGS;
    return { enabled: c.enabled === undefined ? D.enabled : !!c.enabled, retention_months: Math.max(1, Math.min(36, Math.round(Number(c.retention_months) || D.retention_months))), hr_view: c.hr_view === undefined ? D.hr_view : !!c.hr_view,
      consent: str(c.consent || D.consent, 2000), categories: D.categories.map(def => normCat((c.categories || []).find(x => x?.id === def.id), def)),
      options: D.options.map(def => normOpt((c.options || []).find(x => x?.id === def.id), def)),
      escalate_minutes: Math.max(1, Math.min(1440, Math.round(Number(c.escalate_minutes) || D.escalate_minutes))),
      typing: { enabled: c.typing?.enabled === undefined ? D.typing.enabled : !!c.typing.enabled, seconds: Math.max(60, Math.min(900, Math.round(Number(c.typing?.seconds) || D.typing.seconds))), text: str(c.typing?.text || D.typing.text, 600) } };
  }
  function normOpt(o, def) {
    const list = (v, d, m = 40) => Array.isArray(v) ? [...new Set(v.map(x => str(x, m)).filter(Boolean))].slice(0, 20) : d.slice();
    return { id: def.id, name: str(o?.name, 12) || def.name, category: def.category, hint: str(o?.hint ?? def.hint, 60), enabled: o?.enabled === undefined ? true : !!o.enabled,
      positions: list(o?.positions, def.positions, 30), primary: list(o?.primary, def.primary), backup: list(o?.backup, def.backup) };
  }
  function normQ(q, i) {
    const type = ['single', 'multi', 'text'].includes(q?.type) ? q.type : 'single'; const options = type === 'text' ? [] : (Array.isArray(q?.options) ? q.options : []).map(x => str(x, 200)).filter(Boolean).slice(0, 8);
    let answer = null; if (type === 'single') { answer = Math.round(Number(q?.answer)); if (!(answer >= 0 && answer < options.length)) throw err(`第 ${i + 1} 題：請設定正確答案`); }
    if (type === 'multi') { answer = [...new Set((Array.isArray(q?.answer) ? q.answer : []).map(Number).filter(n => n >= 0 && n < options.length))].sort(); if (!answer.length) throw err(`第 ${i + 1} 題：請設定正確答案`); }
    if (type !== 'text' && options.length < 2) throw err(`第 ${i + 1} 題：選擇題至少要 2 個選項`);
    const text = str(q?.text, 500); if (!text) throw err(`第 ${i + 1} 題：請填寫題目`);
    return { id: /^[a-z0-9_]{1,20}$/i.test(q?.id || '') ? q.id : `c${Date.now().toString(36)}${i}`, category: ['admin', 'duty'].includes(q?.category) ? q.category : 'admin', level: ['all', 'experienced', 'novice'].includes(q?.level) ? q.level : 'all', type, text, options, answer, points: Math.max(1, Math.min(50, Math.round(Number(q?.points) || 5))), explain: str(q?.explain, 300) };
  }
  function settingsFor(tid) { const r = db.prepare('SELECT config_json FROM interview_settings WHERE tenant_id=?').get(tid); return normalize(r ? parse(r.config_json, {}) : null); }
  function bankFor(tid) { const r = db.prepare('SELECT bank_json FROM interview_settings WHERE tenant_id=?').get(tid); const b = r?.bank_json ? parse(r.bank_json, null) : null; return Array.isArray(b) ? b : BANK.DEFAULT_BANK.map(x => ({ ...x })); }

  // ---------- 誰可以看 ----------
  // 老闆／總經理／公司管理員：全部；人事（總後台設定）：全部；應徵職務的主管（primary）：該職務全部；
  // 督導（backup）或被轉交的人：只看得到轉交給自己的那幾份。
  const optOf = a => a.option_id || (a.category === 'duty' ? 'duty' : 'admin_secretary');
  const assignees = a => String(a.assignees || ',').split(',').filter(Boolean).map(Number);
  function roleOf(u) {
    if (!u || !addonOn(u.tenant_id)) return null; const s = settingsFor(u.tenant_id); const m = mi(u);
    if (u.role === 'company_admin' || ['owner', 'gm'].includes(m?.kind)) return { all: true, boss: true, primary: new Set(s.options.map(o => o.id)), backup: new Set() };
    let hr = false; try { hr = acct.perms(u).has('company-hr') || acct.perms(u).has('hr-records'); } catch {}
    const pid = m?.position?.id;
    const primary = new Set(s.options.filter(o => pid && o.primary.includes(pid)).map(o => o.id));
    const backup = new Set(s.options.filter(o => pid && o.backup.includes(pid)).map(o => o.id));
    return { all: !!(s.hr_view && hr), boss: false, primary, backup };
  }
  const canSee = (u, a, R = roleOf(u)) => !!R && (R.all || R.primary.has(optOf(a)) || assignees(a).includes(u.id));
  function isReviewer(u) {
    const R = roleOf(u); if (!R) return false;
    if (R.all || R.primary.size || R.backup.size) return true;
    return !!db.prepare("SELECT 1 FROM interview_applicants WHERE tenant_id=? AND assignees LIKE ? LIMIT 1").get(u.tenant_id, `%,${u.id},%`);
  }
  const reviewerCats = u => { const R = roleOf(u); if (!R) return []; return R.all ? settingsFor(u.tenant_id).categories.map(c => c.id) : []; };
  const activeStaff = tid => db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active'").all(tid);
  const holders = (tid, posIds) => activeStaff(tid).filter(u => { const p = mi(u)?.position?.id; return p && posIds.includes(p); });
  const bosses = tid => { const b = activeStaff(tid).filter(u => ['owner', 'gm'].includes(mi(u)?.kind)).map(u => u.id); return b.length ? b : adminIds(tid); };
  function ilog(a, u, action, note = '') { db.prepare('INSERT INTO interview_logs (applicant_id,tenant_id,actor_id,actor,action,note,at) VALUES (?,?,?,?,?,?,?)').run(a.id, a.tenant_id, u?.id || null, u ? by(u) : '系統', action, str(note, 300), now()); }
  const LOGL = { submitted: '完成填寫，交給主管', viewed: '查看資料', scored: '評分／評語', decision: '決定', transfer: '轉交', auto_transfer: '逾時自動轉給督導', linked: '帶入人事資料' };

  // 主管 N 分鐘沒有查看 → 自動轉給同職務督導，並通知上級主管
  function escalate() {
    let rows = [];
    try { rows = db.prepare("SELECT * FROM interview_applicants WHERE status='submitted' AND first_viewed_at IS NULL AND escalated_at IS NULL").all(); } catch { return; }
    for (const a of rows) {
      try {
        if (!addonOn(a.tenant_id)) continue; const s = settingsFor(a.tenant_id);
        if (Date.parse(a.submitted_at) > Date.now() - s.escalate_minutes * 60e3) continue;
        const o = s.options.find(x => x.id === optOf(a)) || {}; const back = holders(a.tenant_id, o.backup || []).map(u => u.id);
        const list = [...new Set([...assignees(a), ...back])];
        db.prepare('UPDATE interview_applicants SET assignees=?,escalated_at=?,updated_at=? WHERE id=?').run(`,${list.join(',')},`, now(), now(), a.id);
        const names = back.map(id => staffRow(a.tenant_id, id)?.name).filter(Boolean).join('、');
        ilog(a, null, 'auto_transfer', back.length ? `轉給 ${names}` : '沒有設定督導，只通知上級主管');
        if (back.length) notify(a.tenant_id, back, '面試資料轉給您', `📝 ${a.name}（應徵：${o.name || ''}${a.position ? ` ${a.position}` : ''}）的面試資料，主管 ${s.escalate_minutes} 分鐘內沒有回應，已轉給您協助面試。\n請到「面試管理」查看。`);
        notify(a.tenant_id, bosses(a.tenant_id), '面試資料逾時未處理', `⏰ ${a.name}（應徵：${o.name || ''}）完成面試填寫後 ${s.escalate_minutes} 分鐘，職務主管還沒有查看。${back.length ? `已自動轉給督導：${names}。` : '這個職務沒有設定督導，請協助安排面試。'}`);
      } catch (e) { console.warn('interview escalate', e.message); }
    }
  }
  // 取消面試服務的公司：面試帳號直接刪除、所有面試電腦登出（重新訂閱時由總後台重新產生密碼）
  function dropUnsubscribed() { try { for (const r of db.prepare('SELECT tenant_id FROM interview_kiosk').all()) if (!addonOn(r.tenant_id)) { db.prepare('DELETE FROM interview_kiosk WHERE tenant_id=?').run(r.tenant_id); db.prepare('DELETE FROM interview_kiosk_sessions WHERE tenant_id=?').run(r.tenant_id); } } catch {} }
  const timer = setInterval(() => { escalate(); dropUnsubscribed(); }, 60e3); if (timer.unref) timer.unref();

  // 保存期限：未錄取／未完成者到期刪除
  function sweep(tid) {
    const s = settingsFor(tid); const cut = new Date(Date.now() - s.retention_months * 30.5 * 864e5).toISOString();
    db.prepare("DELETE FROM interview_applicants WHERE tenant_id=? AND status IN ('rejected','submitted','reviewing','filling','hold') AND COALESCE(submitted_at,started_at)<? AND staff_id IS NULL").run(tid, cut);
    db.prepare("DELETE FROM interview_applicants WHERE tenant_id=? AND status='filling' AND started_at<?").run(tid, new Date(Date.now() - 2 * 864e5).toISOString());
  }

  // ---------- 面試電腦（公開頁面） ----------
  const hits = new Map();
  function limit(req, max = 300) { const k = req.ip || 'x'; const t = Date.now(); const a = (hits.get(k) || []).filter(x => t - x < 3600e3); a.push(t); hits.set(k, a); if (a.length > max) throw err('操作太頻繁，請稍後再試', 429); }

  // ---------- 面試專用帳號（每家公司一組，由總後台建立；公司取消面試服務就不能再登入） ----------
  // 同一組帳號可以在多台面試電腦同時登入，每台電腦、每位面試者各自一份資料，互不影響。
  const KIOSK_HOURS = 12;
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const cookieOf = (req, name) => { for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); } return ''; };
  const secure = req => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const setCookie = (req, res, v, maxAge) => res.set('Set-Cookie', `ivk=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
  function killKiosk(tid) { db.prepare('DELETE FROM interview_kiosk_sessions WHERE tenant_id=?').run(tid); }
  function kiosk(req, { allowMustChange = false } = {}) {
    const tok = cookieOf(req, 'ivk'); if (!tok) throw err('請先用面試帳號登入', 401);
    const ses = db.prepare('SELECT * FROM interview_kiosk_sessions WHERE token=?').get(tok); if (!ses) throw err('請先用面試帳號登入', 401);
    if (Date.parse(ses.last_seen) < Date.now() - KIOSK_HOURS * 3600e3) { db.prepare('DELETE FROM interview_kiosk_sessions WHERE token=?').run(tok); throw err('面試帳號已登出，請重新登入', 401); }
    const t = db.prepare('SELECT id,name,code,status FROM tenants WHERE id=?').get(ses.tenant_id);
    if (!t || t.status !== 'active' || !addonOn(t.id)) { killKiosk(ses.tenant_id); if (t && !addonOn(t.id)) db.prepare('DELETE FROM interview_kiosk WHERE tenant_id=?').run(t.id); throw err(OFF, 401); }
    const k = db.prepare('SELECT * FROM interview_kiosk WHERE tenant_id=?').get(t.id); if (!k?.pw_hash) { killKiosk(t.id); throw err('面試帳號已停用', 401); }
    if (k.must_change && !allowMustChange) throw err('第一次登入請先修改密碼', 428);
    db.prepare('UPDATE interview_kiosk_sessions SET last_seen=? WHERE token=?').run(new Date().toISOString(), tok);
    return { t, k, tok };
  }
  const K = '/api/interview-kiosk';
  app.post(`${K}/login`, wrap((req, res) => {
    limit(req, 120); const b = req.body || {};
    const t = db.prepare('SELECT id,name,code,status FROM tenants WHERE code=?').get(str(b.code, 60));
    if (!t || t.status !== 'active') throw err('公司代碼或密碼不正確', 401);
    if (!addonOn(t.id)) throw err(OFF, 403);
    const k = db.prepare('SELECT * FROM interview_kiosk WHERE tenant_id=?').get(t.id);
    if (!k?.pw_hash) throw err('這家公司還沒有面試帳號，請洽系統管理者', 403);
    if (k.locked_until && Date.parse(k.locked_until) > Date.now()) throw err('密碼錯誤太多次，請 15 分鐘後再試', 429);
    const ok = (() => { try { return crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ''), k.pw_salt), 'hex'), Buffer.from(k.pw_hash, 'hex')); } catch { return false; } })();
    if (!ok) { const f = (k.fails || 0) + 1; db.prepare('UPDATE interview_kiosk SET fails=?,locked_until=? WHERE tenant_id=?').run(f >= 5 ? 0 : f, f >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null, t.id); throw err('公司代碼或密碼不正確', 401); }
    db.prepare('UPDATE interview_kiosk SET fails=0,locked_until=NULL WHERE tenant_id=?').run(t.id);
    const tok = crypto.randomBytes(32).toString('hex'); const at = new Date().toISOString();
    db.prepare('INSERT INTO interview_kiosk_sessions (token,tenant_id,created_at,last_seen,ua,ip) VALUES (?,?,?,?,?,?)').run(tok, t.id, at, at, str(req.headers['user-agent'], 200), str(req.ip, 60));
    setCookie(req, res, tok, KIOSK_HOURS * 3600); res.json({ success: true, company: t.name, must_change: !!k.must_change });
  }));
  app.post(`${K}/logout`, wrap((req, res) => { const tok = cookieOf(req, 'ivk'); if (tok) db.prepare('DELETE FROM interview_kiosk_sessions WHERE token=?').run(tok); setCookie(req, res, '', 0); res.json({ success: true }); }));
  app.post(`${K}/password`, wrap((req, res) => {
    const { t, k } = kiosk(req, { allowMustChange: true }); const b = req.body || {}; const pw = String(b.password || '');
    if (!k.must_change) { const ok = (() => { try { return crypto.timingSafeEqual(Buffer.from(hashPw(String(b.current || ''), k.pw_salt), 'hex'), Buffer.from(k.pw_hash, 'hex')); } catch { return false; } })(); if (!ok) throw err('目前密碼不正確'); }
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw err('新密碼至少 8 碼，而且要同時有英文字母和數字');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE interview_kiosk SET pw_hash=?,pw_salt=?,must_change=0,changed_at=? WHERE tenant_id=?').run(hashPw(pw, salt), salt, now(), t.id);
    res.json({ success: true });
  }));
  app.get(`${K}/meta`, wrap((req, res) => {
    let ctx; try { ctx = kiosk(req, { allowMustChange: true }); } catch (e) { if (e.status === 401) return res.status(401).json({ error: e.message, login: true }); throw e; }
    const { t, k } = ctx; const s = settingsFor(t.id);
    res.set('Cache-Control', 'no-store');
    res.json({ company: t.name, code: t.code, must_change: !!k.must_change, enabled: s.enabled, consent: s.consent, typing: { enabled: s.typing.enabled, seconds: s.typing.seconds, text: s.typing.text },
      options: s.options.filter(o => o.enabled).map(o => { const c = s.categories.find(x => x.id === o.category); return { id: o.id, name: o.name, hint: o.hint, category: o.category, positions: o.positions, licenses: c?.licenses || [] }; }) });
  }));
  function app0(req) {
    const { t } = kiosk(req); const token = str(req.body?.token || req.query?.token, 80);
    const a = db.prepare("SELECT * FROM interview_applicants WHERE tenant_id=? AND token=?").get(t.id, token);
    if (!a) throw err('填寫已逾時或已送出，請重新開始', 410); if (a.status !== 'filling') throw err('這份資料已經送出了', 410);
    if (a.expires_at < new Date().toISOString()) throw err('填寫時間已超過 3 小時，請重新開始', 410);
    return { t, a };
  }
  app.post(`${K}/start`, wrap((req, res) => {
    limit(req); const { t } = kiosk(req); const s = settingsFor(t.id); if (!s.enabled) throw err('這家公司目前沒有開放線上面試填寫', 403);
    const b = req.body || {}; const o = s.options.find(x => x.id === b.option && x.enabled); if (!o) throw err('請選擇應徵職務');
    if (!b.consent) throw err('請先閱讀並同意個人資料蒐集告知');
    const ua = str(req.headers['user-agent'], 300); if (/Mobi|Android|iPhone|iPad/i.test(ua)) throw err('請使用公司的電腦填寫');
    sweep(t.id);
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO interview_applicants (tenant_id,token,category,option_id,position,status,ip,user_agent,consent_at,started_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.id, token, o.category, o.id, str(b.position, 30), 'filling', str(req.ip, 60), ua, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 3 * 3600e3).toISOString(), now());
    res.json({ success: true, token });
  }));
  // 舊的公開網址（只要知道公司代碼就能填）停用，改用面試帳號登入
  app.all('/api/interview/:code/*', (req, res) => res.status(410).json({ error: '面試填寫已改為「面試登入」：請從內勤登入頁右下角的「面試登入」，用公司的面試帳號登入。' }));
  function readResume(b, cat) {
    const r = b && typeof b === 'object' ? b : {};
    const name = str(r.name, 30); if (!name) throw err('請填寫姓名');
    const phone = str(r.phone, 20); if (!/^09\d{8}$/.test(phone.replace(/[-\s]/g, '')) && !/^\+?\d{8,15}$/.test(phone.replace(/[-\s]/g, ''))) throw err('請填寫正確的手機號碼（例如 0912345678）');
    if (!isDate(r.birthday)) throw err('請填寫生日');
    const idType = ['national', 'arc', 'passport'].includes(r.id_type) ? r.id_type : 'national'; const idNo = str(r.id_no, 20).toUpperCase().replace(/\s/g, '');
    if (!idNo) throw err('請填寫身分證字號或居留證號碼');
    if (idType !== 'passport' && !idValid(idNo)) throw err('身分證字號或居留證號碼格式不正確，請再檢查');
    const rows = (v, keys, n) => (Array.isArray(v) ? v : []).map(x => Object.fromEntries(keys.map(k => [k, str(x?.[k], 60)]))).filter(x => x[keys[0]]).slice(0, n);
    const edu = rows(r.education, ['school', 'major', 'degree', 'status'], 5);
    const work = rows(r.work, ['company', 'title', 'start', 'end', 'duty', 'reason'], 10);
    return { name, gender: ['F', 'M'].includes(r.gender) ? r.gender : '', birthday: r.birthday, id_type: idType, id_no: idNo, nationality: str(r.nationality, 30), phone, email: str(r.email, 80), address: str(r.address, 120),
      emergency_name: str(r.emergency_name, 30), emergency_relation: str(r.emergency_relation, 20), emergency_phone: str(r.emergency_phone, 20), education: edu, work,
      licenses: (Array.isArray(r.licenses) ? r.licenses : []).map(x => str(x, 40)).filter(Boolean).slice(0, 20), other_license: str(r.other_license, 200), available_date: isDate(r.available_date) ? r.available_date : '',
      expected_salary: Math.max(0, Math.round(Number(r.expected_salary) || 0)), shift_pref: str(r.shift_pref, 20), transport: str(r.transport, 20), intro: str(r.intro, 2000), position: str(r.position, 30), category: cat };
  }
  const ID_LETTER = { A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33 };
  function idValid(s) { let dg; if (/^[A-Z][1289]\d{8}$/.test(s)) dg = s.slice(1); else if (/^[A-Z][A-D]\d{8}$/.test(s)) dg = String(ID_LETTER[s[1]] % 10) + s.slice(2); else return false; const n = ID_LETTER[s[0]]; let sum = Math.floor(n / 10) + (n % 10) * 9; for (let i = 0; i < 8; i++) sum += Number(dg[i]) * (8 - i); return (sum + Number(dg[8])) % 10 === 0; }
  app.post(`${K}/resume`, wrap((req, res) => {
    limit(req); const { t, a } = app0(req); const r = readResume(req.body?.resume, a.category);
    db.prepare('UPDATE interview_applicants SET name=?,position=?,resume_json=?,resume_at=?,updated_at=? WHERE id=?').run(r.name, r.position || a.position, JSON.stringify(r), new Date().toISOString(), now(), a.id);
    void t; res.json({ success: true });
  }));
  // 依有無經驗出題（題目不含答案）
  // 中文打字測驗：照著範文打，伺服器計算正確字數、正確率、每分鐘字數
  function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
  app.post(`${K}/typing`, wrap((req, res) => {
    limit(req); const { t, a } = app0(req); if (!a.resume_at) throw err('請先填寫履歷'); const s = settingsFor(t.id);
    const target = [...s.typing.text.replace(/\s+/g, '')]; const typed = [...str(req.body?.typed, 2000).replace(/\s+/g, '')];
    const seconds = Math.max(1, Math.min(s.typing.seconds + 30, Math.round(Number(req.body?.seconds) || s.typing.seconds)));
    const ref = target.slice(0, Math.min(target.length, typed.length + 2)); const errs = typed.length ? lev(typed, ref.slice(0, typed.length)) : 0;
    const correct = Math.max(0, typed.length - errs);
    const r = { chars: typed.length, correct, accuracy: typed.length ? Math.round(correct / typed.length * 1000) / 10 : 0, cpm: Math.round(correct / (seconds / 60)), seconds, target_chars: target.length, completed: typed.length >= target.length * 0.95, typed: typed.join('') };
    db.prepare('UPDATE interview_applicants SET typing_json=?,updated_at=? WHERE id=?').run(JSON.stringify(r), now(), a.id);
    res.json({ success: true });
  }));
  app.post(`${K}/questions`, wrap((req, res) => {
    limit(req); const { t, a } = app0(req); if (!a.resume_at) throw err('請先填寫履歷');
    const exp = !!req.body?.experienced; const years = Math.max(0, Math.min(60, Number(req.body?.years) || 0));
    const qs = bankFor(t.id).filter(q => q.category === a.category && (q.level === 'all' || q.level === (exp ? 'experienced' : 'novice')));
    if (!qs.length) throw err('這個職務還沒有設定考核題目，請通知面試主管');
    db.prepare('UPDATE interview_applicants SET experienced=?,exp_years=?,questions_json=?,updated_at=? WHERE id=?').run(exp ? 1 : 0, years, JSON.stringify(qs), now(), a.id);
    res.json({ questions: qs.map(q => ({ id: q.id, type: q.type, text: q.text, options: q.options, points: q.points })) });
  }));
  app.post(`${K}/submit`, wrap((req, res) => {
    limit(req); const { t, a } = app0(req); const qs = parse(a.questions_json, []); if (!qs.length) throw err('請先作答');
    const ans = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {}; const clean = {};
    let score = 0, max = 0, mmax = 0;
    for (const q of qs) {
      const v = ans[q.id];
      if (q.type === 'text') { clean[q.id] = str(v, 3000); mmax += q.points; continue; }
      max += q.points;
      if (q.type === 'single') { const n = Number.isInteger(Number(v)) && v !== '' && v !== null ? Number(v) : null; clean[q.id] = n; if (n === q.answer) score += q.points; }
      else { const sel = [...new Set((Array.isArray(v) ? v : []).map(Number))].sort(); clean[q.id] = sel; if (JSON.stringify(sel) === JSON.stringify(q.answer)) score += q.points; }
    }
    const m = req.body?.metrics && typeof req.body.metrics === 'object' ? req.body.metrics : {};
    const metrics = Object.fromEntries(['resume_seconds', 'quiz_seconds', 'total_seconds', 'keys', 'chars', 'paste_blocked', 'blur', 'clicks', 'screen_w', 'screen_h', 'touch'].map(k => [k, Math.max(0, Math.min(1e7, Math.round(Number(m[k]) || 0)))]));
    db.prepare("UPDATE interview_applicants SET status='submitted',answers_json=?,auto_score=?,auto_max=?,manual_max=?,metrics_json=?,submitted_at=?,token=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(clean), score, max, mmax, JSON.stringify(metrics), new Date().toISOString(), `done-${a.id}-${crypto.randomBytes(8).toString('hex')}`, now(), a.id);
    // 依應徵職務交給主管（primary）；沒有主管就直接交給督導
    const s = settingsFor(t.id); const o = s.options.find(x => x.id === optOf(a)) || {};
    let to = holders(t.id, o.primary || []).map(u => u.id); let note = '';
    if (!to.length) { to = holders(t.id, o.backup || []).map(u => u.id); note = '（沒有設定主管，直接交給督導）'; }
    db.prepare('UPDATE interview_applicants SET assignees=?,escalated_at=? WHERE id=?').run(`,${to.join(',')},`, note ? now() : null, a.id);
    const fresh = db.prepare('SELECT * FROM interview_applicants WHERE id=?').get(a.id);
    ilog(fresh, null, 'submitted', `交給 ${to.map(id => staffRow(t.id, id)?.name).filter(Boolean).join('、') || '（沒有對應的主管）'}${note}`);
    notify(t.id, to.length ? to : bosses(t.id), '新的面試資料', `📝 ${fresh.name} 已完成線上履歷、打字與考核（應徵：${o.name || ''}${fresh.position ? ` ${fresh.position}` : ''}）。\n請到「面試管理」查看並安排面談；${s.escalate_minutes} 分鐘內沒有查看，會自動轉給督導。`);
    res.json({ success: true });
  }));

  // ================= 公司：面試管理 =================
  const STATUS = { submitted: '待審核', reviewing: '審核中', hold: '備取', hired: '錄取', rejected: '不錄取' };
  const needRev = (req, res, next) => { const u = getUser(req); if (u && !addonOn(u.tenant_id)) return bad(res, OFF, 403); if (!isReviewer(u)) return bad(res, '您沒有查看面試資料的權限', 403); next(); };
  function out(a, { detail = false } = {}) {
    const r = parse(a.resume_json, {}); const s = settingsFor(a.tenant_id); const cat = s.categories.find(c => c.id === a.category); const man = parse(a.manual_json, {}); const op = s.options.find(x => x.id === optOf(a));
    const ty = parse(a.typing_json, null);
    const o = { id: a.id, name: a.name || r.name || '（未填姓名）', category: a.category, category_name: op?.name || cat?.name || a.category, option_id: optOf(a), assignees: assignees(a).map(id => ({ id, name: staffRow(a.tenant_id, id)?.name || '' })), escalated: !!a.escalated_at, first_viewed_at: a.first_viewed_at, typing: ty ? { cpm: ty.cpm, accuracy: ty.accuracy, chars: ty.chars, correct: ty.correct, seconds: ty.seconds, target_chars: ty.target_chars, completed: ty.completed } : null, position: a.position, status: a.status, status_label: STATUS[a.status] || a.status, experienced: !!a.experienced, exp_years: a.exp_years,
      auto_score: a.auto_score, auto_max: a.auto_max, manual_score: a.manual_score, manual_max: a.manual_max, manual_done: a.manual_score !== null && a.manual_score !== undefined, rating: a.rating, decision: a.decision, reviewed_by: a.reviewed_by,
      phone: r.phone || '', age: r.birthday ? Math.floor((Date.now() - Date.parse(r.birthday)) / (365.25 * 864e5)) : null, submitted_at: a.submitted_at, decided_at: a.decided_at, staff_id: a.staff_id, metrics: parse(a.metrics_json, {}) };
    if (detail) {
      o.resume = r; o.comments = parse(a.comments_json, []); if (ty) o.typing.typed = ty.typed;
      o.logs = db.prepare('SELECT actor,action,note,at FROM interview_logs WHERE applicant_id=? ORDER BY id').all(a.id).map(x => ({ ...x, label: LOGL[x.action] || x.action }));
      const ans = parse(a.answers_json, {});
      o.questions = parse(a.questions_json, []).map(q => ({ ...q, response: ans[q.id], correct: q.type === 'text' ? null : (q.type === 'single' ? ans[q.id] === q.answer : JSON.stringify(ans[q.id] || []) === JSON.stringify(q.answer)), manual: man[q.id] ?? null }));
    }
    return o;
  }
  const getA = req => { const u = getUser(req); const a = db.prepare("SELECT * FROM interview_applicants WHERE id=? AND tenant_id=? AND status<>'filling'").get(Number(req.params.id), tenantId(req)); if (!a) throw err('找不到這位面試人員', 404); if (!canSee(u, a)) throw err('這位面試人員沒有交給您', 403); return a; };
  app.get('/api/company/interviews', requireCompanyAdmin, needRev, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); sweep(tid); const R = roleOf(u); const q = req.query || {};
    let rows = db.prepare("SELECT * FROM interview_applicants WHERE tenant_id=? AND status<>'filling' ORDER BY submitted_at DESC LIMIT 1000").all(tid).filter(a => canSee(u, a, R));
    if (STATUS[q.status]) rows = rows.filter(a => a.status === q.status); else if (q.status === 'open') rows = rows.filter(a => ['submitted', 'reviewing', 'hold'].includes(a.status));
    if (q.option) rows = rows.filter(a => optOf(a) === q.option);
    const s = settingsFor(tid);
    res.set('Cache-Control', 'no-store'); res.json({ rows: rows.map(a => out(a)), status: STATUS, options: s.options.map(o => ({ id: o.id, name: o.name })), enabled: s.enabled, retention_months: s.retention_months, escalate_minutes: s.escalate_minutes, scope: R.all ? 'all' : R.primary.size ? 'primary' : 'assigned' });
  }));
  app.get('/api/company/interviews/:id', requireCompanyAdmin, needRev, wrap((req, res) => {
    const u = getUser(req); const a = getA(req); const R = roleOf(u);
    // 主管、老闆或被轉交的人打開 → 算已回應（不再自動轉派）；每次查看都留紀錄
    if (!a.first_viewed_at && (R.boss || R.primary.has(optOf(a)) || assignees(a).includes(u.id))) db.prepare('UPDATE interview_applicants SET first_viewed_at=? WHERE id=?').run(now(), a.id);
    const last = db.prepare("SELECT at FROM interview_logs WHERE applicant_id=? AND actor_id=? AND action='viewed' ORDER BY id DESC LIMIT 1").get(a.id, u.id);
    if (!last || Date.parse(last.at) < Date.now() - 30 * 60e3) ilog(a, u, 'viewed');
    res.set('Cache-Control', 'no-store'); res.json({ applicant: out(db.prepare('SELECT * FROM interview_applicants WHERE id=?').get(a.id), { detail: true }), can_transfer: true });
  }));
  // 轉交：主管沒空時交給同職務督導（或其他審核人）；被轉交的人只看得到這一份
  app.get('/api/company/interviews/:id/transfer-targets', requireCompanyAdmin, needRev, wrap((req, res) => {
    const u = getUser(req); const a = getA(req); const s = settingsFor(a.tenant_id); const o = s.options.find(x => x.id === optOf(a)) || { primary: [], backup: [] };
    const cur = new Set(assignees(a)); const pos = id => mi(staffRow(a.tenant_id, id))?.position?.name || '';
    const list = [...holders(a.tenant_id, o.backup).map(x => ({ id: x.id, name: x.name, role: '督導' })), ...holders(a.tenant_id, o.primary).map(x => ({ id: x.id, name: x.name, role: '主管' }))].filter((x, i, arr) => x.id !== u.id && arr.findIndex(y => y.id === x.id) === i).map(x => ({ ...x, position: pos(x.id), assigned: cur.has(x.id) }));
    res.json({ targets: list });
  }));
  app.post('/api/company/interviews/:id/transfer', requireCompanyAdmin, needRev, wrap((req, res) => {
    const u = getUser(req); const a = getA(req); const b = req.body || {}; const to = staffRow(a.tenant_id, Number(b.to));
    if (!to || !to.is_active) throw err('請選擇要轉交的人');
    const reason = str(b.reason, 300); if (!reason) throw err('請填寫轉交原因');
    const s = settingsFor(a.tenant_id); const o = s.options.find(x => x.id === optOf(a)) || { primary: [], backup: [] };
    const p = mi(to)?.position?.id; if (!p || ![...o.primary, ...o.backup].includes(p)) throw err('只能轉交給這個職務的主管或督導');
    const list = [...new Set([...assignees(a), to.id])];
    db.prepare('UPDATE interview_applicants SET assignees=?,first_viewed_at=COALESCE(first_viewed_at,?),updated_at=? WHERE id=?').run(`,${list.join(',')},`, now(), now(), a.id);
    ilog(a, u, 'transfer', `轉給 ${to.name}：${reason}`);
    notify(a.tenant_id, [to.id], '面試資料轉給您', `📝 ${by(u)} 把 ${a.name}（應徵：${o.name || ''}${a.position ? ` ${a.position}` : ''}）的面試資料轉給您。\n原因：${reason}\n請到「面試管理」查看並協助面試。`);
    res.json({ success: true, applicant: out(db.prepare('SELECT * FROM interview_applicants WHERE id=?').get(a.id), { detail: true }) });
  }));
  app.post('/api/company/interviews/:id/review', requireCompanyAdmin, needRev, wrap((req, res) => {
    const u = getUser(req); const a = getA(req); const b = req.body || {}; const qs = parse(a.questions_json, []); const man = parse(a.manual_json, {});
    if (b.manual && typeof b.manual === 'object') for (const q of qs.filter(x => x.type === 'text')) if (b.manual[q.id] !== undefined && b.manual[q.id] !== '' && b.manual[q.id] !== null) man[q.id] = Math.max(0, Math.min(q.points, Math.round(Number(b.manual[q.id]) || 0)));
    const textQs = qs.filter(x => x.type === 'text'); const all = textQs.length && textQs.every(q => man[q.id] !== undefined);
    const ms = all ? textQs.reduce((s, q) => s + man[q.id], 0) : null;
    const comments = parse(a.comments_json, []); if (str(b.comment, 1000)) comments.push({ by: by(u), at: now(), text: str(b.comment, 1000) });
    const rating = b.rating !== undefined && b.rating !== null && b.rating !== '' ? Math.max(1, Math.min(5, Math.round(Number(b.rating)))) : a.rating;
    let status = a.status === 'submitted' ? 'reviewing' : a.status; let decided = a.decided_at;
    if (['hired', 'rejected', 'hold'].includes(b.decision)) { status = b.decision; decided = now(); }
    ilog(a, u, ['hired', 'rejected', 'hold'].includes(b.decision) ? 'decision' : 'scored', ['hired', 'rejected', 'hold'].includes(b.decision) ? STATUS[b.decision] : [ms !== null ? `情境題 ${ms} 分` : '', rating ? `評等 ${rating} 星` : '', str(b.comment, 1000) ? '加評語' : ''].filter(Boolean).join('、'));
    db.prepare('UPDATE interview_applicants SET manual_json=?,manual_score=?,comments_json=?,rating=?,status=?,decision=?,decided_at=?,reviewed_by=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(man), ms, JSON.stringify(comments), rating ?? null, status, ['hired', 'rejected', 'hold'].includes(b.decision) ? b.decision : a.decision, decided, by(u), now(), a.id);
    res.json({ success: true, applicant: out(db.prepare('SELECT * FROM interview_applicants WHERE id=?').get(a.id), { detail: true }) });
  }));
  // 錄取後：把履歷資料帶進人事資料（身分證、生日、性別、手機、地址、緊急聯絡人）
  app.post('/api/company/interviews/:id/link', requireCompanyAdmin, needRev, wrap((req, res) => {
    const u = getUser(req); const a = getA(req); const tid = a.tenant_id; let sid = Number(req.body?.staff_id); if (!sid && req.body?.employee_id) sid = db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tid, str(req.body.employee_id, 40))?.id; const s0 = sid ? staffRow(tid, sid) : null; if (!s0) throw err('找不到這個員編的人員，請先在「公司人員管理」開通帳號');
    const r = parse(a.resume_json, {});
    db.prepare('INSERT OR IGNORE INTO hr_profiles (tenant_id,staff_id,updated_at) VALUES (?,?,?)').run(tid, sid, now());
    const cols = db.prepare('PRAGMA table_info(hr_profiles)').all().map(c => c.name);
    const set = { gender: r.gender, birthday: r.birthday, mobile: r.phone, address: r.address, emergency_name: r.emergency_name, emergency_relation: r.emergency_relation, emergency_phone: r.emergency_phone, id_type: r.id_type, id_no: r.id_no, nationality: r.nationality };
    const keys = Object.keys(set).filter(k => cols.includes(k) && set[k]);
    if (keys.includes('id_no') && db.prepare('SELECT 1 FROM hr_profiles WHERE tenant_id=? AND id_no=? AND staff_id<>?').get(tid, set.id_no, sid)) throw err('這個證號已經登記在其他人員的資料上');
    if (keys.length) db.prepare(`UPDATE hr_profiles SET ${keys.map(k => `${k}=?`).join(',')},hr_updated_at=?,hr_updated_by=? WHERE tenant_id=? AND staff_id=?`).run(...keys.map(k => set[k]), now(), by(u), tid, sid);
    db.prepare("UPDATE interview_applicants SET staff_id=?,status='hired',decision='hired',decided_at=COALESCE(decided_at,?),updated_at=? WHERE id=?").run(sid, now(), now(), a.id);
    ilog(a, u, 'linked', `員編 ${s0.employee_id}`);
    res.json({ success: true });
  }));
  app.delete('/api/company/interviews/:id', requireCompanyAdmin, needRev, wrap((req, res) => { const u = getUser(req); const a = getA(req); const R = roleOf(u); if (!R.all && !R.primary.has(optOf(a))) throw err('只有職務主管或人事可以刪除面試資料', 403); db.prepare('DELETE FROM interview_applicants WHERE id=?').run(a.id); db.prepare('DELETE FROM interview_logs WHERE applicant_id=?').run(a.id); res.json({ success: true }); }));

  // ================= 總後台：面試設定與題庫 =================
  app.get('/api/admin/interview-settings', requireSuperAdmin, wrap((req, res) => {
    const custom = new Set(db.prepare('SELECT tenant_id FROM interview_settings').all().map(x => x.tenant_id));
    res.json({ tenants: db.prepare('SELECT id,name,code FROM tenants ORDER BY id').all().map(t => ({ ...t, customized: custom.has(t.id) })) });
  }));
  app.get('/api/admin/interview-settings/:tid', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); let positions = []; try { positions = org.configFor(tid).positions.map(p => ({ id: p.id, name: p.name, kind: p.kind })); } catch {}
    const r = db.prepare('SELECT bank_json,updated_at FROM interview_settings WHERE tenant_id=?').get(tid);
    res.json({ settings: settingsFor(tid), bank: bankFor(tid), bank_custom: !!r?.bank_json, updated_at: r?.updated_at || '', positions, addon: addons ? addons.status(tid, 'interview') : { enabled: true } });
  }));
  app.put('/api/admin/interview-settings/:tid', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); const b = req.body || {}; const cur = db.prepare('SELECT * FROM interview_settings WHERE tenant_id=?').get(tid);
    const cfg = b.settings ? normalize(b.settings) : settingsFor(tid);
    let bank = cur?.bank_json || null; if (Array.isArray(b.bank)) bank = JSON.stringify(b.bank.slice(0, 200).map(normQ)); if (b.reset_bank) bank = null;
    db.prepare('INSERT INTO interview_settings (tenant_id,config_json,bank_json,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,bank_json=excluded.bank_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(cfg), bank, now(), '系統總後台');
    res.json({ success: true, settings: settingsFor(tid), bank: bankFor(tid), bank_custom: !!bank });
  }));

  // ================= 總後台：面試專用帳號 =================
  // 只有開通「面試」服務的公司可以建立；取消服務後所有面試電腦立即登出、不能再登入。
  // 忘記密碼由總後台重新產生隨機密碼（公司第一次登入要強制修改）。
  function kioskInfo(tid) {
    const t = db.prepare('SELECT id,name,code FROM tenants WHERE id=?').get(tid); if (!t) throw err('找不到公司', 404);
    const on = addonOn(tid); if (!on) { killKiosk(tid); db.prepare('DELETE FROM interview_kiosk WHERE tenant_id=?').run(tid); }
    const k = db.prepare('SELECT * FROM interview_kiosk WHERE tenant_id=?').get(tid);
    const cut = new Date(Date.now() - KIOSK_HOURS * 3600e3).toISOString();
    return { company: t.name, login_code: t.code, addon_on: on, exists: !!k?.pw_hash, active: on && !!k?.pw_hash, must_change: !!k?.must_change, created_at: k?.created_at || '', reset_at: k?.reset_at || '', changed_at: k?.changed_at || '',
      sessions: db.prepare('SELECT COUNT(*) c FROM interview_kiosk_sessions WHERE tenant_id=? AND last_seen>=?').get(tid, cut).c };
  }
  app.get('/api/admin/interview-kiosk/:tid', requireSuperAdmin, wrap((req, res) => { res.set('Cache-Control', 'no-store'); res.json(kioskInfo(Number(req.params.tid))); }));
  app.post('/api/admin/interview-kiosk/:tid/reset', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); if (!addonOn(tid)) throw err('這家公司還沒有開通面試服務，不能建立面試帳號');
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; let pw = ''; const rnd = crypto.randomBytes(12); for (let i = 0; i < 10; i++) pw += A[rnd[i] % A.length];
    if (!/\d/.test(pw)) pw = pw.slice(0, 9) + '7'; if (!/[A-Za-z]/.test(pw)) pw = 'K' + pw.slice(1);
    const salt = crypto.randomBytes(16).toString('hex'); const at = now(); const exists = db.prepare('SELECT 1 FROM interview_kiosk WHERE tenant_id=?').get(tid);
    if (exists) db.prepare('UPDATE interview_kiosk SET pw_hash=?,pw_salt=?,must_change=1,reset_at=?,fails=0,locked_until=NULL WHERE tenant_id=?').run(hashPw(pw, salt), salt, at, tid);
    else db.prepare('INSERT INTO interview_kiosk (tenant_id,pw_hash,pw_salt,must_change,created_at,reset_at) VALUES (?,?,?,?,?,?)').run(tid, hashPw(pw, salt), salt, 1, at, at);
    killKiosk(tid);
    res.json({ ...kioskInfo(tid), password: pw });
  }));
  app.post('/api/admin/interview-escalate-now', requireSuperAdmin, wrap((req, res) => { escalate(); dropUnsubscribed(); res.json({ success: true }); }));
  app.delete('/api/admin/interview-kiosk/:tid', requireSuperAdmin, wrap((req, res) => { const tid = Number(req.params.tid); db.prepare('DELETE FROM interview_kiosk WHERE tenant_id=?').run(tid); killKiosk(tid); res.json(kioskInfo(tid)); }));

  function dashboard(tid, u) { const R = roleOf(u); if (!R || !isReviewer(u)) return null; const rows = db.prepare("SELECT * FROM interview_applicants WHERE tenant_id=? AND status IN ('submitted','reviewing')").all(tid).filter(a => canSee(u, a, R)); const mine = rows.filter(a => assignees(a).includes(u.id) && a.status === 'submitted').length; return { open: rows.length, mine }; }
  return { isReviewer, dashboard, settingsFor };
};
