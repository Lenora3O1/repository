// 面試人員線上履歷＋職務考核
// - 面試電腦（公司內）：選職務類別（行政／勤務）→ 個資告知同意 → 履歷 → 有無經驗 → 考核題目；只限電腦操作，並記錄操作情形。
// - 面試結果只給該職務的主管與人事（總後台可設定）看：選擇題自動計分，情境題由主管評分；錄取後可轉成員工資料。
// - 未錄取者的資料保存期限屆滿自動刪除（個資法）。
'use strict';
const BANK = require('./interview-bank');

module.exports = function registerInterviewRoutes(app, d) {
  const { db, crypto, getUser, tenantId, now, requireCompanyAdmin, requireSuperAdmin, org, acct } = d;

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
  `);

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
      consent: str(c.consent || D.consent, 2000), categories: D.categories.map(def => normCat((c.categories || []).find(x => x?.id === def.id), def)) };
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

  // ---------- 誰可以看：職務主管（依總後台設定的職位）＋人事＋老闆／總經理＋公司管理員 ----------
  function reviewerCats(u) {
    if (!u) return []; const s = settingsFor(u.tenant_id); const m = mi(u);
    if (u.role === 'company_admin' || ['owner', 'gm'].includes(m?.kind)) return s.categories.map(c => c.id);
    let hr = false; try { hr = acct.perms(u).has('company-hr') || acct.perms(u).has('hr-records'); } catch {}
    if (s.hr_view && hr) return s.categories.map(c => c.id);
    return s.categories.filter(c => m?.position && c.reviewer_positions.includes(m.position.id)).map(c => c.id);
  }
  const isReviewer = u => reviewerCats(u).length > 0;
  function reviewersOf(tid, cat) { return db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active'").all(tid).filter(u => reviewerCats(u).includes(cat)).map(u => u.id); }

  // 保存期限：未錄取／未完成者到期刪除
  function sweep(tid) {
    const s = settingsFor(tid); const cut = new Date(Date.now() - s.retention_months * 30.5 * 864e5).toISOString();
    db.prepare("DELETE FROM interview_applicants WHERE tenant_id=? AND status IN ('rejected','submitted','reviewing','filling','hold') AND COALESCE(submitted_at,started_at)<? AND staff_id IS NULL").run(tid, cut);
    db.prepare("DELETE FROM interview_applicants WHERE tenant_id=? AND status='filling' AND started_at<?").run(tid, new Date(Date.now() - 2 * 864e5).toISOString());
  }

  // ---------- 面試電腦（公開頁面） ----------
  const hits = new Map();
  function limit(req) { const k = req.ip || 'x'; const t = Date.now(); const a = (hits.get(k) || []).filter(x => t - x < 3600e3); a.push(t); hits.set(k, a); if (a.length > 120) throw err('操作太頻繁，請稍後再試', 429); }
  function tenantByCode(code) { const t = db.prepare("SELECT id,name,code,status FROM tenants WHERE code=?").get(str(code, 60)); if (!t || t.status !== 'active') throw err('找不到這家公司，請確認公司代碼', 404); return t; }
  function app0(req) {
    const t = tenantByCode(req.params.code); const token = str(req.body?.token || req.query?.token, 80);
    const a = db.prepare("SELECT * FROM interview_applicants WHERE tenant_id=? AND token=?").get(t.id, token);
    if (!a) throw err('填寫已逾時或已送出，請重新開始', 410); if (a.status !== 'filling') throw err('這份資料已經送出了', 410);
    if (a.expires_at < new Date().toISOString()) throw err('填寫時間已超過 3 小時，請重新開始', 410);
    return { t, a };
  }
  const P = '/api/interview/:code';
  app.get(`${P}/meta`, wrap((req, res) => {
    limit(req); const t = tenantByCode(req.params.code); const s = settingsFor(t.id); if (!s.enabled) throw err('這家公司目前沒有開放線上面試填寫', 403);
    res.set('Cache-Control', 'no-store'); res.json({ company: t.name, consent: s.consent, categories: s.categories.map(c => ({ id: c.id, name: c.name, hint: c.hint, positions: c.positions, licenses: c.licenses })) });
  }));
  app.post(`${P}/start`, wrap((req, res) => {
    limit(req); const t = tenantByCode(req.params.code); const s = settingsFor(t.id); if (!s.enabled) throw err('這家公司目前沒有開放線上面試填寫', 403);
    const b = req.body || {}; const cat = s.categories.find(c => c.id === b.category); if (!cat) throw err('請選擇應徵類別');
    if (!b.consent) throw err('請先閱讀並同意個人資料蒐集告知');
    const ua = str(req.headers['user-agent'], 300); if (/Mobi|Android|iPhone|iPad/i.test(ua)) throw err('請使用公司的電腦填寫');
    sweep(t.id);
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO interview_applicants (tenant_id,token,category,position,status,ip,user_agent,consent_at,started_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.id, token, cat.id, str(b.position, 30), 'filling', str(req.ip, 60), ua, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 3 * 3600e3).toISOString(), now());
    res.json({ success: true, token });
  }));
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
  app.post(`${P}/resume`, wrap((req, res) => {
    limit(req); const { t, a } = app0(req); const r = readResume(req.body?.resume, a.category);
    db.prepare('UPDATE interview_applicants SET name=?,position=?,resume_json=?,resume_at=?,updated_at=? WHERE id=?').run(r.name, r.position || a.position, JSON.stringify(r), new Date().toISOString(), now(), a.id);
    void t; res.json({ success: true });
  }));
  // 依有無經驗出題（題目不含答案）
  app.post(`${P}/questions`, wrap((req, res) => {
    limit(req); const { t, a } = app0(req); if (!a.resume_at) throw err('請先填寫履歷');
    const exp = !!req.body?.experienced; const years = Math.max(0, Math.min(60, Number(req.body?.years) || 0));
    const qs = bankFor(t.id).filter(q => q.category === a.category && (q.level === 'all' || q.level === (exp ? 'experienced' : 'novice')));
    if (!qs.length) throw err('這個職務還沒有設定考核題目，請通知面試主管');
    db.prepare('UPDATE interview_applicants SET experienced=?,exp_years=?,questions_json=?,updated_at=? WHERE id=?').run(exp ? 1 : 0, years, JSON.stringify(qs), now(), a.id);
    res.json({ questions: qs.map(q => ({ id: q.id, type: q.type, text: q.text, options: q.options, points: q.points })) });
  }));
  app.post(`${P}/submit`, wrap((req, res) => {
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
    const s = settingsFor(t.id); const cat = s.categories.find(c => c.id === a.category);
    notify(t.id, reviewersOf(t.id, a.category), '新的面試資料', `📝 ${a.name} 已完成線上履歷與考核（應徵：${cat?.name || ''}${a.position ? ` ${a.position}` : ''}）。\n請到「面試管理」查看並評分。`);
    res.json({ success: true });
  }));

  // ================= 公司：面試管理 =================
  const STATUS = { submitted: '待審核', reviewing: '審核中', hold: '備取', hired: '錄取', rejected: '不錄取' };
  const needRev = (req, res, next) => { if (!isReviewer(getUser(req))) return bad(res, '您沒有查看面試資料的權限', 403); next(); };
  function out(a, { detail = false } = {}) {
    const r = parse(a.resume_json, {}); const s = settingsFor(a.tenant_id); const cat = s.categories.find(c => c.id === a.category); const man = parse(a.manual_json, {});
    const o = { id: a.id, name: a.name || r.name || '（未填姓名）', category: a.category, category_name: cat?.name || a.category, position: a.position, status: a.status, status_label: STATUS[a.status] || a.status, experienced: !!a.experienced, exp_years: a.exp_years,
      auto_score: a.auto_score, auto_max: a.auto_max, manual_score: a.manual_score, manual_max: a.manual_max, manual_done: a.manual_score !== null && a.manual_score !== undefined, rating: a.rating, decision: a.decision, reviewed_by: a.reviewed_by,
      phone: r.phone || '', age: r.birthday ? Math.floor((Date.now() - Date.parse(r.birthday)) / (365.25 * 864e5)) : null, submitted_at: a.submitted_at, decided_at: a.decided_at, staff_id: a.staff_id, metrics: parse(a.metrics_json, {}) };
    if (detail) {
      o.resume = r; o.comments = parse(a.comments_json, []);
      const ans = parse(a.answers_json, {});
      o.questions = parse(a.questions_json, []).map(q => ({ ...q, response: ans[q.id], correct: q.type === 'text' ? null : (q.type === 'single' ? ans[q.id] === q.answer : JSON.stringify(ans[q.id] || []) === JSON.stringify(q.answer)), manual: man[q.id] ?? null }));
    }
    return o;
  }
  const getA = req => { const u = getUser(req); const a = db.prepare("SELECT * FROM interview_applicants WHERE id=? AND tenant_id=? AND status<>'filling'").get(Number(req.params.id), tenantId(req)); if (!a) throw err('找不到這位面試人員', 404); if (!reviewerCats(u).includes(a.category)) throw err('這位人員不是您負責的職務', 403); return a; };
  app.get('/api/company/interviews', requireCompanyAdmin, needRev, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); sweep(tid); const cats = reviewerCats(u); const q = req.query || {};
    let rows = db.prepare(`SELECT * FROM interview_applicants WHERE tenant_id=? AND status<>'filling' AND category IN (${cats.map(() => '?').join(',')}) ORDER BY submitted_at DESC LIMIT 500`).all(tid, ...cats);
    if (STATUS[q.status]) rows = rows.filter(a => a.status === q.status); else if (q.status === 'open') rows = rows.filter(a => ['submitted', 'reviewing', 'hold'].includes(a.status));
    if (q.category) rows = rows.filter(a => a.category === q.category);
    const t = db.prepare('SELECT code FROM tenants WHERE id=?').get(tid)?.code || '';
    const s = settingsFor(tid);
    res.set('Cache-Control', 'no-store'); res.json({ rows: rows.map(a => out(a)), status: STATUS, categories: s.categories.filter(c => cats.includes(c.id)).map(c => ({ id: c.id, name: c.name })), tenant_code: t, enabled: s.enabled, retention_months: s.retention_months });
  }));
  app.get('/api/company/interviews/:id', requireCompanyAdmin, needRev, wrap((req, res) => res.json({ applicant: out(getA(req), { detail: true }) })));
  app.post('/api/company/interviews/:id/review', requireCompanyAdmin, needRev, wrap((req, res) => {
    const u = getUser(req); const a = getA(req); const b = req.body || {}; const qs = parse(a.questions_json, []); const man = parse(a.manual_json, {});
    if (b.manual && typeof b.manual === 'object') for (const q of qs.filter(x => x.type === 'text')) if (b.manual[q.id] !== undefined && b.manual[q.id] !== '' && b.manual[q.id] !== null) man[q.id] = Math.max(0, Math.min(q.points, Math.round(Number(b.manual[q.id]) || 0)));
    const textQs = qs.filter(x => x.type === 'text'); const all = textQs.length && textQs.every(q => man[q.id] !== undefined);
    const ms = all ? textQs.reduce((s, q) => s + man[q.id], 0) : null;
    const comments = parse(a.comments_json, []); if (str(b.comment, 1000)) comments.push({ by: by(u), at: now(), text: str(b.comment, 1000) });
    const rating = b.rating !== undefined && b.rating !== null && b.rating !== '' ? Math.max(1, Math.min(5, Math.round(Number(b.rating)))) : a.rating;
    let status = a.status === 'submitted' ? 'reviewing' : a.status; let decided = a.decided_at;
    if (['hired', 'rejected', 'hold'].includes(b.decision)) { status = b.decision; decided = now(); }
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
    res.json({ success: true });
  }));
  app.delete('/api/company/interviews/:id', requireCompanyAdmin, needRev, wrap((req, res) => { const a = getA(req); db.prepare('DELETE FROM interview_applicants WHERE id=?').run(a.id); res.json({ success: true }); }));

  // ================= 總後台：面試設定與題庫 =================
  app.get('/api/admin/interview-settings', requireSuperAdmin, wrap((req, res) => {
    const custom = new Set(db.prepare('SELECT tenant_id FROM interview_settings').all().map(x => x.tenant_id));
    res.json({ tenants: db.prepare('SELECT id,name,code FROM tenants ORDER BY id').all().map(t => ({ ...t, customized: custom.has(t.id) })) });
  }));
  app.get('/api/admin/interview-settings/:tid', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); let positions = []; try { positions = org.configFor(tid).positions.map(p => ({ id: p.id, name: p.name, kind: p.kind })); } catch {}
    const r = db.prepare('SELECT bank_json,updated_at FROM interview_settings WHERE tenant_id=?').get(tid);
    res.json({ settings: settingsFor(tid), bank: bankFor(tid), bank_custom: !!r?.bank_json, updated_at: r?.updated_at || '', positions });
  }));
  app.put('/api/admin/interview-settings/:tid', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); const b = req.body || {}; const cur = db.prepare('SELECT * FROM interview_settings WHERE tenant_id=?').get(tid);
    const cfg = b.settings ? normalize(b.settings) : settingsFor(tid);
    let bank = cur?.bank_json || null; if (Array.isArray(b.bank)) bank = JSON.stringify(b.bank.slice(0, 200).map(normQ)); if (b.reset_bank) bank = null;
    db.prepare('INSERT INTO interview_settings (tenant_id,config_json,bank_json,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,bank_json=excluded.bank_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(cfg), bank, now(), '系統總後台');
    res.json({ success: true, settings: settingsFor(tid), bank: bankFor(tid), bank_custom: !!bank });
  }));

  function dashboard(tid, u) { const cats = reviewerCats(u); if (!cats.length) return null; return { open: db.prepare(`SELECT COUNT(*) c FROM interview_applicants WHERE tenant_id=? AND status IN ('submitted','reviewing') AND category IN (${cats.map(() => '?').join(',')})`).get(tid, ...cats).c }; }
  return { isReviewer, dashboard, settingsFor };
};
