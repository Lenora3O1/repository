// 存證信函：依郵局存證信函用紙格式（每頁 10 行 × 20 格，每格一字）自動排版。
// - 現場（管理委員會 → 存證信函）：經理、秘書以社區管理委員會名義寄出；收件人可從住戶名冊挑選（沿用名冊權限）。
// - 公司（總務管理 → 存證信函）：以公司名義寄出（寄件人帶入公司資料的名稱、負責人、地址）。
// - 社區的信件只有該社區的經理、秘書看得到；公司的信件只在公司端。兩邊互不相通。
'use strict';

module.exports = function registerLegalLetterRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaffFiller, requireCompanyAdmin, residentActiveCommunity, residentCanEdit, effectivePermissions, residents } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS legal_letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER, scope TEXT NOT NULL DEFAULT 'site',
    title TEXT DEFAULT '', sender_json TEXT NOT NULL DEFAULT '{}', recipients_json TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', pages INTEGER DEFAULT 0, sent_date TEXT DEFAULT '', post_no TEXT DEFAULT '', note TEXT DEFAULT '',
    created_by TEXT DEFAULT '', created_by_id INTEGER, created_at TEXT NOT NULL, updated_by TEXT DEFAULT '', updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_legal_letters ON legal_letters(tenant_id, scope, community_id);
  CREATE TABLE IF NOT EXISTS community_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'maintenance', name TEXT NOT NULL, service TEXT DEFAULT '',
    tax_id TEXT DEFAULT '', owner TEXT DEFAULT '', contact TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', contract_start TEXT DEFAULT '', contract_end TEXT DEFAULT '', note TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_by TEXT DEFAULT '', updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_community_vendors ON community_vendors(tenant_id, community_id);
  CREATE TABLE IF NOT EXISTS legal_letter_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, letter_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);

  { const cols = db.prepare('PRAGMA table_info(legal_letters)').all().map(c => c.name); if (!cols.includes('kind')) db.exec("ALTER TABLE legal_letters ADD COLUMN kind TEXT DEFAULT 'general'"); }
  const KINDS = { fee: '管理費催繳', other: '其他', general: '一般' };
  const VCAT = { maintenance: '簽約保養廠商', general: '一般廠商', special: '特約廠商' };
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').replace(/\r/g, '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { res.set('Cache-Control', 'no-store'); fn(req, res); } catch (e) { if (!res.headersSent) res.status(e.status || 400).json({ error: e.message || '操作失敗' }); } };
  const ACT = { create: '建立草稿', update: '修改內容', print: '列印', sent: '登記已寄出', unsent: '取消寄出登記', delete: '刪除' };

  // 排版：半形轉全形（一格一字），每段落自動換行，每行 20 格、每頁 10 行
  function layout(text) {
    const full = String(text || '').replace(/\r/g, '').replace(/\t/g, '  ').replace(/[\x21-\x7e]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '　');
    const lines = [];
    for (const para of full.split('\n')) { const cs = [...para]; if (!cs.length) { lines.push(''); continue; } for (let i = 0; i < cs.length; i += 20) lines.push(cs.slice(i, i + 20).join('')); }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return { lines, pages: Math.max(1, Math.ceil(lines.length / 10)) };
  }

  function cleanSender(s) { s = s || {}; return { kind: ['committee', 'company', 'custom'].includes(s.kind) ? s.kind : 'custom', org: str(s.org, 80), rep_title: str(s.rep_title, 20), rep: str(s.rep, 40), address: str(s.address, 120), entity_id: Number(s.entity_id) || null }; }
  function cleanRecipients(list) {
    const out = (Array.isArray(list) ? list : []).slice(0, 12).map(r => ({ name: str(r?.name, 80), address: str(r?.address, 120), cc: !!r?.cc, unit: str(r?.unit, 40), source: str(r?.source, 20), ref_id: Number(r?.ref_id) || null })).filter(r => r.name || r.address);
    return out;
  }
  function validate(L, final) {
    if (!L.sender.org && !L.sender.rep) throw err('請填寫寄件人姓名');
    if (final) {
      if (!L.sender.address) throw err('請填寫寄件人詳細地址');
      const main = L.recipients.filter(r => !r.cc);
      if (!main.length) throw err('請至少填一位收件人');
      for (const r of L.recipients) { if (!r.name) throw err('收件人姓名不能空白'); if (!r.address) throw err(`請填寫「${r.name}」的詳細地址`); }
      if (!String(L.body || '').trim()) throw err('請填寫信函內容');
    }
  }

  function out(r, withLogs) {
    const sender = parse(r.sender_json, {}), recipients = parse(r.recipients_json, []);
    const o = { id: r.id, scope: r.scope, kind: r.kind || 'general', kind_label: KINDS[r.kind] || '一般', community_id: r.community_id, title: r.title, sender, recipients, body: r.body, status: r.status, pages: r.pages, sent_date: r.sent_date, post_no: r.post_no, note: r.note, created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at,
      copies: recipients.length + 2 };
    if (withLogs) o.logs = db.prepare('SELECT actor,action,note,created_at FROM legal_letter_logs WHERE letter_id=? ORDER BY id').all(r.id).map(x => ({ ...x, label: ACT[x.action] || x.action }));
    return o;
  }
  const log = (id, tid, actor, action, note = '') => db.prepare('INSERT INTO legal_letter_logs (letter_id,tenant_id,actor,action,note,created_at) VALUES (?,?,?,?,?,?)').run(id, tid, actor, action, str(note, 300), now());

  // 存取範圍：現場 → 目前社區；公司 → 公司信件
  function siteCtx(req) {
    const u = getUser(req);
    if (!residentCanEdit(u)) throw err('存證信函限社區經理、秘書使用', 403);
    const c = residentActiveCommunity(req); if (!c) throw err('請先選擇社區', 400);
    const row = db.prepare('SELECT id,name,COALESCE(main_address,\'\') AS address FROM communities WHERE id=?').get(c.id);
    return { u, tid: tenantId(req), scope: 'site', cid: c.id, community: row };
  }
  const COMPANY_KEYS = ['company-general-affairs', 'manage-staff', 'hr-records', 'manage-communities'];
  function companyCtx(req) {
    const u = getUser(req);
    if (u?.role !== 'company_admin' && !effectivePermissions(u).some(k => COMPANY_KEYS.includes(k))) throw err('您沒有使用公司存證信函的權限', 403);
    return { u, tid: tenantId(req), scope: 'company', cid: null };
  }
  function find(t, id) {
    const r = db.prepare('SELECT * FROM legal_letters WHERE id=? AND tenant_id=? AND scope=?').get(Number(id), t.tid, t.scope);
    if (!r || (t.scope === 'site' && r.community_id !== t.cid)) throw err('找不到這封信函', 404);
    return r;
  }
  function entities(tid) {
    try { return db.prepare('SELECT id,name,owner,address FROM acct_entities WHERE tenant_id=? AND is_active=1 ORDER BY is_default DESC,id').all(tid); } catch { return []; }
  }
  function defaultSender(t) {
    const last = db.prepare(`SELECT sender_json FROM legal_letters WHERE tenant_id=? AND scope=? AND ${t.scope === 'site' ? 'community_id=?' : 'community_id IS NULL'} ORDER BY id DESC LIMIT 1`).get(...(t.scope === 'site' ? [t.tid, t.scope, t.cid] : [t.tid, t.scope]));
    if (last) return cleanSender(parse(last.sender_json, {}));
    if (t.scope === 'site') return { kind: 'committee', org: `${t.community.name}管理委員會`, rep_title: '主任委員', rep: '', address: t.community.address || '', entity_id: null };
    const e = entities(t.tid)[0]; const tn = db.prepare('SELECT name FROM tenants WHERE id=?').get(t.tid);
    return { kind: 'company', org: e?.name || tn?.name || '', rep_title: '負責人', rep: e?.owner || '', address: e?.address || '', entity_id: e?.id || null };
  }

  function routes(base, mw, ctxOf) {
    app.get(`${base}/legal-letters`, mw, wrap((req, res) => {
      const t = ctxOf(req);
      const q = str(req.query.q, 40), st = str(req.query.status, 10);
      const where = ['tenant_id=?', 'scope=?', t.scope === 'site' ? 'community_id=?' : 'community_id IS NULL']; const args = t.scope === 'site' ? [t.tid, t.scope, t.cid] : [t.tid, t.scope];
      if (['draft', 'printed', 'sent'].includes(st)) { where.push('status=?'); args.push(st); }
      if (KINDS[req.query.kind]) { where.push('kind=?'); args.push(req.query.kind); }
      if (q) { where.push('(title LIKE ? OR recipients_json LIKE ? OR body LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      const rows = db.prepare(`SELECT * FROM legal_letters WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`).all(...args).map(r => { const o = out(r); delete o.body; return o; });
      res.json({ rows, scope: t.scope, community: t.community ? { id: t.community.id, name: t.community.name, address: t.community.address } : null, default_sender: defaultSender(t), entities: t.scope === 'company' ? entities(t.tid) : [] });
    }));
    app.get(`${base}/legal-letters/:id`, mw, wrap((req, res) => { const t = ctxOf(req); res.json({ letter: out(find(t, req.params.id), true) }); }));
    app.post(`${base}/legal-letters`, mw, wrap((req, res) => {
      const t = ctxOf(req); const b = req.body || {};
      const L = { title: str(b.title, 60), sender: cleanSender(b.sender), recipients: cleanRecipients(b.recipients), body: str(b.body, 20000) };
      validate(L, false);
      const lay = layout(L.body); const kind = KINDS[b.kind] ? b.kind : 'general';
      const info = db.prepare('INSERT INTO legal_letters (tenant_id,community_id,scope,kind,title,sender_json,recipients_json,body,status,pages,created_by,created_by_id,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(t.tid, t.cid, t.scope, kind, L.title, JSON.stringify(L.sender), JSON.stringify(L.recipients), L.body, 'draft', lay.pages, t.u.name || '', t.u.id, now(), t.u.name || '', now());
      const id = Number(info.lastInsertRowid); log(id, t.tid, t.u.name, 'create', L.title);
      res.json({ letter: out(find(t, id), true) });
    }));
    app.put(`${base}/legal-letters/:id`, mw, wrap((req, res) => {
      const t = ctxOf(req); const r = find(t, req.params.id); const b = req.body || {};
      if (r.status === 'sent') throw err('已寄出的信函不能修改；如需更正請另建一封');
      const L = { title: str(b.title, 60), sender: cleanSender(b.sender), recipients: cleanRecipients(b.recipients), body: str(b.body, 20000) };
      validate(L, false);
      db.prepare('UPDATE legal_letters SET kind=?,title=?,sender_json=?,recipients_json=?,body=?,pages=?,status=\'draft\',updated_by=?,updated_at=? WHERE id=?').run(KINDS[b.kind] ? b.kind : (r.kind || 'general'), L.title, JSON.stringify(L.sender), JSON.stringify(L.recipients), L.body, layout(L.body).pages, t.u.name || '', now(), r.id);
      log(r.id, t.tid, t.u.name, 'update'); res.json({ letter: out(find(t, r.id), true) });
    }));
    // 列印前檢查必填欄位，記錄列印
    app.post(`${base}/legal-letters/:id/print`, mw, wrap((req, res) => {
      const t = ctxOf(req); const r = find(t, req.params.id); const o = out(r);
      validate({ sender: o.sender, recipients: o.recipients, body: r.body }, true);
      if (r.status === 'draft') db.prepare('UPDATE legal_letters SET status=\'printed\' WHERE id=?').run(r.id);
      log(r.id, t.tid, t.u.name, 'print', `${layout(r.body).pages} 頁 × ${o.copies} 份`);
      res.json({ letter: out(find(t, r.id), true), layout: layout(r.body) });
    }));
    app.post(`${base}/legal-letters/:id/sent`, mw, wrap((req, res) => {
      const t = ctxOf(req); const r = find(t, req.params.id); const b = req.body || {};
      if (b.undo) { if (r.status !== 'sent') throw err('這封信還沒登記寄出'); db.prepare('UPDATE legal_letters SET status=\'printed\',sent_date=\'\',post_no=\'\' WHERE id=?').run(r.id); log(r.id, t.tid, t.u.name, 'unsent', str(b.reason, 200)); return res.json({ letter: out(find(t, r.id), true) }); }
      if (r.status === 'draft') throw err('請先列印再登記寄出');
      if (!isDate(b.sent_date)) throw err('請填寫寄出日期');
      db.prepare('UPDATE legal_letters SET status=\'sent\',sent_date=?,post_no=?,note=? WHERE id=?').run(b.sent_date, str(b.post_no, 40), str(b.note, 300), r.id);
      log(r.id, t.tid, t.u.name, 'sent', `${b.sent_date}${b.post_no ? `｜存證號碼 ${str(b.post_no, 40)}` : ''}`);
      res.json({ letter: out(find(t, r.id), true) });
    }));
    app.delete(`${base}/legal-letters/:id`, mw, wrap((req, res) => {
      const t = ctxOf(req); const r = find(t, req.params.id);
      if (r.status !== 'draft') throw err('只有草稿可以刪除；已列印或寄出的信函會保留紀錄');
      db.prepare('DELETE FROM legal_letters WHERE id=?').run(r.id); log(r.id, t.tid, t.u.name, 'delete', r.title); res.json({ ok: true });
    }));
  }
  // 收件人來源 ----------------------------------------------------------
  // 管理費催繳：區分所有權人（出租中的戶別帶戶籍／通訊地址）
  app.get('/api/staff/legal-letters/owners', requireStaffFiller, wrap((req, res) => {
    const t = siteCtx(req);
    if (!residents) throw err('住戶名冊尚未啟用');
    if (!residents.acked(t.tid, t.u.id)) return res.json({ ack_required: true, rows: [] });
    res.json({ rows: residents.ownerMailing(t.tid, t.cid) });
  }));
  // 社區簽約廠商（廠商聯繫）：存證信函可直接帶入廠商名稱、負責人、地址
  const vOut = r => ({ id: r.id, category: r.category, category_label: VCAT[r.category] || r.category, name: r.name, service: r.service, tax_id: r.tax_id, owner: r.owner, contact: r.contact, phone: r.phone, address: r.address, contract_start: r.contract_start, contract_end: r.contract_end, note: r.note, is_active: !!r.is_active, current: !!r.is_active && (!r.contract_end || r.contract_end >= todayTW()) && (!r.contract_start || r.contract_start <= todayTW()) });
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  function vClean(b) {
    const v = { category: VCAT[b.category] ? b.category : 'maintenance', name: str(b.name, 80), service: str(b.service, 80), tax_id: str(b.tax_id, 8), owner: str(b.owner, 40), contact: str(b.contact, 40), phone: str(b.phone, 40), address: str(b.address, 120), contract_start: isDate(b.contract_start) ? b.contract_start : '', contract_end: isDate(b.contract_end) ? b.contract_end : '', note: str(b.note, 300) };
    if (!v.name) throw err('請填寫廠商名稱');
    if (v.tax_id && !/^\d{8}$/.test(v.tax_id)) throw err('統一編號是 8 位數字');
    if (v.contract_start && v.contract_end && v.contract_end < v.contract_start) throw err('合約到期日不能早於開始日');
    return v;
  }
  app.get('/api/staff/community-vendors', requireStaffFiller, wrap((req, res) => {
    const t = siteCtx(req);
    const rows = db.prepare('SELECT * FROM community_vendors WHERE tenant_id=? AND community_id=? AND is_active=1 ORDER BY category, name').all(t.tid, t.cid).map(vOut);
    res.json({ rows: req.query.current === '1' ? rows.filter(r => r.current) : rows, categories: VCAT });
  }));
  app.post('/api/staff/community-vendors', requireStaffFiller, wrap((req, res) => {
    const t = siteCtx(req); const v = vClean(req.body || {});
    const info = db.prepare('INSERT INTO community_vendors (tenant_id,community_id,category,name,service,tax_id,owner,contact,phone,address,contract_start,contract_end,note,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.tid, t.cid, v.category, v.name, v.service, v.tax_id, v.owner, v.contact, v.phone, v.address, v.contract_start, v.contract_end, v.note, t.u.name || '', now(), t.u.name || '', now());
    res.json({ vendor: vOut(db.prepare('SELECT * FROM community_vendors WHERE id=?').get(Number(info.lastInsertRowid))) });
  }));
  app.put('/api/staff/community-vendors/:id', requireStaffFiller, wrap((req, res) => {
    const t = siteCtx(req); const cur = db.prepare('SELECT * FROM community_vendors WHERE id=? AND tenant_id=? AND community_id=? AND is_active=1').get(Number(req.params.id), t.tid, t.cid);
    if (!cur) throw err('找不到這家廠商', 404);
    const v = vClean({ ...cur, ...(req.body || {}) });
    db.prepare('UPDATE community_vendors SET category=?,name=?,service=?,tax_id=?,owner=?,contact=?,phone=?,address=?,contract_start=?,contract_end=?,note=?,updated_by=?,updated_at=? WHERE id=?')
      .run(v.category, v.name, v.service, v.tax_id, v.owner, v.contact, v.phone, v.address, v.contract_start, v.contract_end, v.note, t.u.name || '', now(), cur.id);
    res.json({ vendor: vOut(db.prepare('SELECT * FROM community_vendors WHERE id=?').get(cur.id)) });
  }));
  app.delete('/api/staff/community-vendors/:id', requireStaffFiller, wrap((req, res) => {
    const t = siteCtx(req); const r = db.prepare('UPDATE community_vendors SET is_active=0,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND community_id=? AND is_active=1').run(t.u.name || '', now(), Number(req.params.id), t.tid, t.cid);
    if (!r.changes) throw err('找不到這家廠商', 404); res.json({ ok: true });
  }));
  // 公司：公司應支的廠商資料（只回傳名稱、統編、聯絡人、地址）
  app.get('/api/company/legal-letters/vendors', requireCompanyAdmin, wrap((req, res) => {
    const t = companyCtx(req); let rows = [];
    try { rows = db.prepare('SELECT id,name,tax_id,contact,phone,address,category FROM ap_vendors WHERE tenant_id=? AND is_active=1 ORDER BY name').all(t.tid).map(v => ({ ...v, owner: '', service: v.category || '', current: true })); } catch {}
    res.json({ rows });
  }));

  routes('/api/staff', requireStaffFiller, siteCtx);
  routes('/api/company', requireCompanyAdmin, companyCtx);
  return { layout };
};
