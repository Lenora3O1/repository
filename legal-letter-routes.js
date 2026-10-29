// 存證信函：依郵局存證信函用紙格式（每頁 10 行 × 20 格，每格一字）自動排版。
// - 現場（管理委員會 → 存證信函）：經理、秘書以社區管理委員會名義寄出；收件人可從住戶名冊挑選（沿用名冊權限）。
// - 公司（總務管理 → 存證信函）：以公司名義寄出（寄件人帶入公司資料的名稱、負責人、地址）。
// - 社區的信件只有該社區的經理、秘書看得到；公司的信件只在公司端。兩邊互不相通。
'use strict';

module.exports = function registerLegalLetterRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaffFiller, requireCompanyAdmin, residentActiveCommunity, residentCanEdit, effectivePermissions } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS legal_letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER, scope TEXT NOT NULL DEFAULT 'site',
    title TEXT DEFAULT '', sender_json TEXT NOT NULL DEFAULT '{}', recipients_json TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', pages INTEGER DEFAULT 0, sent_date TEXT DEFAULT '', post_no TEXT DEFAULT '', note TEXT DEFAULT '',
    created_by TEXT DEFAULT '', created_by_id INTEGER, created_at TEXT NOT NULL, updated_by TEXT DEFAULT '', updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_legal_letters ON legal_letters(tenant_id, scope, community_id);
  CREATE TABLE IF NOT EXISTS legal_letter_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, letter_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);

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
    const out = (Array.isArray(list) ? list : []).slice(0, 12).map(r => ({ name: str(r?.name, 80), address: str(r?.address, 120), cc: !!r?.cc, unit: str(r?.unit, 40), source: str(r?.source, 20) })).filter(r => r.name || r.address);
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
    const o = { id: r.id, scope: r.scope, community_id: r.community_id, title: r.title, sender, recipients, body: r.body, status: r.status, pages: r.pages, sent_date: r.sent_date, post_no: r.post_no, note: r.note, created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at,
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
      if (q) { where.push('(title LIKE ? OR recipients_json LIKE ? OR body LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      const rows = db.prepare(`SELECT * FROM legal_letters WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`).all(...args).map(r => { const o = out(r); delete o.body; return o; });
      res.json({ rows, scope: t.scope, community: t.community ? { id: t.community.id, name: t.community.name, address: t.community.address } : null, default_sender: defaultSender(t), entities: t.scope === 'company' ? entities(t.tid) : [] });
    }));
    app.get(`${base}/legal-letters/:id`, mw, wrap((req, res) => { const t = ctxOf(req); res.json({ letter: out(find(t, req.params.id), true) }); }));
    app.post(`${base}/legal-letters`, mw, wrap((req, res) => {
      const t = ctxOf(req); const b = req.body || {};
      const L = { title: str(b.title, 60), sender: cleanSender(b.sender), recipients: cleanRecipients(b.recipients), body: str(b.body, 20000) };
      validate(L, false);
      const lay = layout(L.body);
      const info = db.prepare('INSERT INTO legal_letters (tenant_id,community_id,scope,title,sender_json,recipients_json,body,status,pages,created_by,created_by_id,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(t.tid, t.cid, t.scope, L.title, JSON.stringify(L.sender), JSON.stringify(L.recipients), L.body, 'draft', lay.pages, t.u.name || '', t.u.id, now(), t.u.name || '', now());
      const id = Number(info.lastInsertRowid); log(id, t.tid, t.u.name, 'create', L.title);
      res.json({ letter: out(find(t, id), true) });
    }));
    app.put(`${base}/legal-letters/:id`, mw, wrap((req, res) => {
      const t = ctxOf(req); const r = find(t, req.params.id); const b = req.body || {};
      if (r.status === 'sent') throw err('已寄出的信函不能修改；如需更正請另建一封');
      const L = { title: str(b.title, 60), sender: cleanSender(b.sender), recipients: cleanRecipients(b.recipients), body: str(b.body, 20000) };
      validate(L, false);
      db.prepare('UPDATE legal_letters SET title=?,sender_json=?,recipients_json=?,body=?,pages=?,status=\'draft\',updated_by=?,updated_at=? WHERE id=?').run(L.title, JSON.stringify(L.sender), JSON.stringify(L.recipients), L.body, layout(L.body).pages, t.u.name || '', now(), r.id);
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
  routes('/api/staff', requireStaffFiller, siteCtx);
  routes('/api/company', requireCompanyAdmin, companyCtx);
  return { layout };
};
