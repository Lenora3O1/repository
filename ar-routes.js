// 公司應收：依社區合約每月產生請款單、手動加開；開立（入帳＋發票）；收款沖帳；帳齡；銷項明細（401）
// 會計分錄：
//   開立：借 應收帳款（含稅） ／ 貸 各類服務收入（未稅，依社區）＋ 銷項稅額
//   收款：借 銀行存款（或現金、應收票據）＋ 手續費 ／ 貸 應收帳款（＋ 多收的記預收款項）
'use strict';
const EI = require('./einvoice');

module.exports = function registerArRoutes(app, d) {
  const { db, getUser, tenantId, now, requireCompanyAdmin, acct, contracts } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS ar_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, community_id INTEGER, contract_id INTEGER, period TEXT DEFAULT '', seq INTEGER NOT NULL, bill_no TEXT NOT NULL,
    bill_date TEXT NOT NULL, due_date TEXT NOT NULL, client_json TEXT NOT NULL DEFAULT '{}', tax_type TEXT NOT NULL DEFAULT 'exclusive', items_json TEXT NOT NULL DEFAULT '[]',
    net REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, gross REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', note TEXT DEFAULT '', prorate TEXT DEFAULT '',
    invoice_type TEXT DEFAULT '', invoice_no TEXT DEFAULT '', invoice_date TEXT DEFAULT '', invoice_random TEXT DEFAULT '', invoice_status TEXT DEFAULT '', invoice_raw TEXT DEFAULT '', invoice_void_reason TEXT DEFAULT '',
    voucher_id INTEGER, issued_by TEXT DEFAULT '', issued_at TEXT, void_by TEXT DEFAULT '', void_at TEXT, void_reason TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ar_bills ON ar_bills(tenant_id, entity_id, status);
  CREATE INDEX IF NOT EXISTS idx_ar_bills_c ON ar_bills(tenant_id, contract_id, period);
  CREATE TABLE IF NOT EXISTS ar_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, date TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'transfer', amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0,
    payer TEXT DEFAULT '', community_id INTEGER, ref TEXT DEFAULT '', note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'posted', voucher_id INTEGER, created_by TEXT DEFAULT '', created_at TEXT NOT NULL,
    void_by TEXT DEFAULT '', void_at TEXT, void_reason TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS ar_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, receipt_id INTEGER NOT NULL, bill_id INTEGER NOT NULL, amount REAL NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_ar_alloc ON ar_allocations(bill_id);
  CREATE TABLE IF NOT EXISTS ar_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, bill_id INTEGER, receipt_id INTEGER, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);

  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const monthDays = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const nextMonth = m => { const [y, mm] = m.split('-').map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; };
  const r0 = v => Math.round(Number(v) || 0);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { const p = fn(req, res); if (p && p.catch) p.catch(e => { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); }); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => db.transaction(fn);
  const by = u => u?.name || u?.employee_id || '';
  const commName = id => id ? (db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '') : '';
  const log = (tid, u, action, { bill, receipt, note = '' }) => db.prepare('INSERT INTO ar_logs (tenant_id,bill_id,receipt_id,actor,action,note,created_at) VALUES (?,?,?,?,?,?,?)').run(tid, bill || null, receipt || null, typeof u === 'string' ? u : by(u), action, str(note, 300), now());
  const needAcct = (req, res, next) => { if (!acct.canAcct(getUser(req))) return bad(res, '需要「會計」權限', 403); next(); };

  const KIND_KEY = { property: 'rev_property', security: 'rev_security', cleaning: 'rev_cleaning', maintenance: 'rev_maintenance', other: 'rev_other' };
  const KINDS = { property: '物業管理服務費', security: '保全服務費', cleaning: '清潔服務費', maintenance: '機電／工程維護費', other: '其他' };
  const STATUS = { draft: '未開立', issued: '待收款', partial: '部分收款', paid: '已收款', void: '已作廢' };
  const INV = { paper: '手開發票', e_manual: '電子發票（外部開立）', e_api: '電子發票（系統開立）', none: '不開發票' };
  const METHOD = { transfer: '匯款', cash: '現金', check: '支票', other: '其他' };

  // 金額：依稅別計算每個項目的未稅與含稅（尾差放最後一項）
  function calc(items, taxType) {
    const L = items.map(x => ({ ...x, amount: r0(x.amount) })).filter(x => x.amount);
    const sum = L.reduce((s, x) => s + x.amount, 0);
    let net, tax, gross;
    if (taxType === 'exempt') { net = sum; tax = 0; gross = sum; }
    else if (taxType === 'inclusive') { gross = sum; net = Math.round(sum / 1.05); tax = gross - net; }
    else { net = sum; tax = Math.round(sum * 0.05); gross = net + tax; }
    let an = 0, ag = 0;
    const lines = L.map((x, i) => {
      const last = i === L.length - 1;
      const n = last ? net - an : (taxType === 'inclusive' ? Math.round(x.amount / 1.05) : x.amount);
      const g = last ? gross - ag : (taxType === 'exclusive' ? Math.round(x.amount * 1.05) : x.amount);
      an += n; ag += g; return { ...x, net: n, gross: g };
    });
    return { lines, net, tax, gross };
  }
  function readItems(arr) {
    const items = (Array.isArray(arr) ? arr : []).map(x => ({ kind: KINDS[x?.kind] ? x.kind : 'other', name: str(x?.name, 60) || KINDS[x?.kind] || '其他', amount: r0(x?.amount), note: str(x?.note, 100) })).filter(x => x.amount).slice(0, 30);
    if (!items.length) throw err('請至少填一個有金額的項目');
    if (items.some(x => x.amount < 0)) throw err('金額不能是負數（折讓請另開折讓單）');
    return items;
  }
  function nextNo(tid, eid, date) { const m = date.slice(0, 7).replace('-', ''); const r = db.prepare('SELECT MAX(seq) s FROM ar_bills WHERE tenant_id=? AND entity_id=? AND substr(bill_date,1,7)=?').get(tid, eid, date.slice(0, 7)); const seq = (r?.s || 0) + 1; return { seq, no: `AR${m}${String(seq).padStart(4, '0')}` }; }
  const paidOf = id => db.prepare("SELECT COALESCE(SUM(a.amount),0) s FROM ar_allocations a JOIN ar_receipts r ON r.id=a.receipt_id WHERE a.bill_id=? AND r.status='posted'").get(id).s;
  function refresh(id) {
    const b = db.prepare('SELECT * FROM ar_bills WHERE id=?').get(id); if (!b || ['draft', 'void'].includes(b.status)) return;
    const p = paidOf(id); const st = p >= b.gross - 0.004 ? 'paid' : p > 0 ? 'partial' : 'issued';
    if (st !== b.status) db.prepare('UPDATE ar_bills SET status=?,updated_at=? WHERE id=?').run(st, now(), id);
  }
  function billOut(b, { detail = false } = {}) {
    const t = todayTW(); const paid = ['draft', 'void'].includes(b.status) ? 0 : paidOf(b.id); const out = Math.max(0, b.gross - paid);
    const ent = acct.entities(b.tenant_id, { all: true }).find(e => e.id === b.entity_id);
    const o = { id: b.id, entity_id: b.entity_id, entity_name: ent?.short_name || ent?.name || '', bill_no: b.bill_no, community_id: b.community_id, community_name: commName(b.community_id), contract_id: b.contract_id, period: b.period,
      bill_date: b.bill_date, due_date: b.due_date, client: parse(b.client_json, {}), tax_type: b.tax_type, items: parse(b.items_json, []), net: b.net, tax: b.tax, gross: b.gross, paid, outstanding: out,
      status: b.status, status_label: STATUS[b.status], overdue: ['issued', 'partial'].includes(b.status) && b.due_date < t ? diffDays(b.due_date, t) : 0, note: b.note, prorate: b.prorate,
      invoice_type: b.invoice_type, invoice_label: INV[b.invoice_type] || '', invoice_no: b.invoice_no, invoice_date: b.invoice_date, invoice_random: b.invoice_random, invoice_status: b.invoice_status, invoice_void_reason: b.invoice_void_reason,
      voucher_id: b.voucher_id, issued_by: b.issued_by, issued_at: b.issued_at, void_reason: b.void_reason, void_by: b.void_by, created_by: b.created_by, created_at: b.created_at };
    if (detail) {
      o.receipts = db.prepare("SELECT r.id,r.date,r.method,r.status,a.amount FROM ar_allocations a JOIN ar_receipts r ON r.id=a.receipt_id WHERE a.bill_id=? ORDER BY r.date").all(b.id).map(x => ({ ...x, method_label: METHOD[x.method] }));
      o.logs = db.prepare('SELECT actor,action,note,created_at FROM ar_logs WHERE bill_id=? ORDER BY id').all(b.id);
      o.entity = ent || null;
    }
    return o;
  }
  const getBill = req => { const b = db.prepare('SELECT * FROM ar_bills WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req)); if (!b) throw err('找不到請款單', 404); return b; };

  // ---------- 依合約產生請款單 ----------
  function generate(tid, period, u, entityId) {
    const first = `${period}-01`, last = `${period}-${String(monthDays(period)).padStart(2, '0')}`;
    const rows = db.prepare("SELECT * FROM community_contracts WHERE tenant_id=? AND status='active' AND start_date<=? AND end_date>=?").all(tid, last, first);
    const made = [], skipped = [];
    for (const c of rows) {
      if (entityId && c.entity_id !== Number(entityId)) continue;
      if (db.prepare("SELECT 1 FROM ar_bills WHERE tenant_id=? AND contract_id=? AND period=? AND status<>'void'").get(tid, c.id, period)) { skipped.push({ community: commName(c.community_id), reason: '已經有請款單' }); continue; }
      const billing = parse(c.billing_json, {}); const s = c.start_date > first ? c.start_date : first, e = c.end_date < last ? c.end_date : last;
      const days = diffDays(s, e) + 1, full = monthDays(period); const ratio = days / full;
      const items = parse(c.items_json, []).filter(x => x.amount > 0).map(x => ({ kind: x.kind, name: `${x.name}（${Number(period.slice(5))} 月）`, amount: ratio < 1 ? Math.round(x.amount * ratio) : x.amount, note: x.note || '' }));
      if (!items.length) continue;
      const day = String(Math.min(Number(billing.day) || 1, 28)).padStart(2, '0');
      const billDate = billing.in_advance === false ? `${nextMonth(period)}-${day}` : `${period}-${day}`;
      const kind = billing.invoice_kind || 'b2b'; const taxType = c.tax_type === 'inclusive' ? 'inclusive' : 'exclusive';
      const k = calc(items, taxType); const n = nextNo(tid, c.entity_id, billDate);
      const id = Number(db.prepare('INSERT INTO ar_bills (tenant_id,entity_id,community_id,contract_id,period,seq,bill_no,bill_date,due_date,client_json,tax_type,items_json,net,tax,gross,status,note,prorate,invoice_type,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(tid, c.entity_id, c.community_id, c.id, period, n.seq, n.no, billDate, addDays(billDate, Number(billing.terms_days ?? 30)), c.client_json, taxType, JSON.stringify(items), k.net, k.tax, k.gross, 'draft', '', ratio < 1 ? `${s}～${e}，${days}/${full} 天` : '', kind === 'none' ? 'none' : '', by(u), now(), now()).lastInsertRowid);
      log(tid, u, 'generate', { bill: id, note: `依合約產生 ${period}` }); made.push(id);
    }
    return { made, skipped, contracts: rows.length };
  }

  // ---------- 開立（入帳＋發票） ----------
  function postBill(b, u) {
    const items = parse(b.items_json, []); const k = calc(items, b.tax_type); const c = parse(b.client_json, {});
    const lines = [{ key: 'ar', debit: k.gross, memo: `${b.bill_no} ${c.name || ''}`, community_id: b.community_id, party: c.name || '', party_tax_id: c.tax_id || '' }];
    for (const x of k.lines) lines.push({ key: KIND_KEY[x.kind] || 'rev_other', credit: x.net, memo: x.name, community_id: b.community_id, party: c.name || '' });
    if (k.tax) lines.push({ key: 'output_vat', credit: k.tax, memo: `銷項稅額 ${b.invoice_no || b.bill_no}`, community_id: b.community_id, party: c.name || '', party_tax_id: c.tax_id || '' });
    const v = acct.post(b.tenant_id, { entity_id: b.entity_id, date: b.bill_date, summary: `${commName(b.community_id)} ${b.period ? `${b.period} ` : ''}請款 ${b.bill_no}`, source: 'ar', source_id: b.id, lines }, u);
    return v.id;
  }
  const INV_NO = /^[A-Z]{2}\d{8}$/;
  function allowedInvoice(tid) { const s = acct.settingsFor(tid).invoice; const out = ['none']; if (s.mode !== 'einvoice') out.push('paper'); if (s.mode !== 'manual') { out.push('e_manual'); if (s.einvoice_enabled && s.provider) out.push('e_api'); } return { list: out, mode: s.mode, api: s.einvoice_enabled ? s.provider : '', test: s.test_mode }; }
  async function issue(b, u, inv) {
    const tid = b.tenant_id; const allow = allowedInvoice(tid); const type = inv.type || b.invoice_type || (allow.list.includes('e_api') ? 'e_api' : allow.list.includes('paper') ? 'paper' : 'e_manual');
    if (!allow.list.includes(type)) throw err(`這家公司的發票設定不支援「${INV[type] || type}」`);
    if (b.status !== 'draft') throw err('這張請款單已經開立');
    if (acct.isClosed(tid, b.entity_id, b.bill_date.slice(0, 7))) throw err(`${b.bill_date.slice(0, 7)} 已經關帳，請把請款日改到未關帳的月份`);
    let no = '', date = '', random = '', raw = '';
    if (type === 'paper' || type === 'e_manual') {
      no = str(inv.no, 10).toUpperCase(); date = isDate(inv.date) ? inv.date : b.bill_date;
      if (no && !INV_NO.test(no)) throw err('發票號碼格式是 2 個英文字母加 8 位數字，例如 AB12345678');
      if (no && db.prepare("SELECT 1 FROM ar_bills WHERE tenant_id=? AND entity_id=? AND invoice_no=? AND id<>?").get(tid, b.entity_id, no, b.id)) throw err(`發票號碼 ${no} 已經用過了`);
    }
    if (type === 'e_api') {
      const items = calc(parse(b.items_json, []), b.tax_type).lines.map(x => ({ name: x.name, gross: x.gross }));
      const r = await EI.issue(acct.settingsFor(tid).invoice, { id: b.id, tenant_id: tid, client: parse(b.client_json, {}), items, gross: b.gross, tax_exempt: b.tax_type === 'exempt', remark: `${commName(b.community_id)} ${b.bill_no}` });
      no = r.invoice_no; date = r.invoice_date || todayTW(); random = r.random; raw = JSON.stringify(r.raw);
    }
    // 發票開出後才入帳；入帳失敗（例如科目停用）時保留發票資料並回報
    db.prepare('UPDATE ar_bills SET invoice_type=?,invoice_no=?,invoice_date=?,invoice_random=?,invoice_raw=?,invoice_status=?,updated_at=? WHERE id=?').run(type, no, no ? date : '', random, raw, no ? 'issued' : (type === 'none' ? '' : 'pending'), now(), b.id);
    let vid;
    tx(() => {
      vid = postBill({ ...b, invoice_no: no }, u);
      db.prepare("UPDATE ar_bills SET status='issued',voucher_id=?,issued_by=?,issued_at=?,updated_at=? WHERE id=?").run(vid, by(u), now(), now(), b.id);
    })();
    log(tid, u, 'issue', { bill: b.id, note: `${INV[type]}${no ? ` ${no}` : ''}，傳票 #${vid}` });
    return db.prepare('SELECT * FROM ar_bills WHERE id=?').get(b.id);
  }

  // ---------- 收款 ----------
  function postReceipt(tid, rc, allocs, u) {
    const cashKey = rc.method === 'cash' ? 'cash' : rc.method === 'check' ? 'notes_receivable' : 'bank';
    const lines = [{ key: cashKey, debit: rc.amount - rc.fee, memo: `${METHOD[rc.method]}收款${rc.ref ? ` ${rc.ref}` : ''}`, community_id: rc.community_id, party: rc.payer }];
    if (rc.fee) lines.push({ key: 'exp_other', debit: rc.fee, memo: '匯款手續費', community_id: rc.community_id });
    let used = 0;
    for (const a of allocs) { const b = db.prepare('SELECT * FROM ar_bills WHERE id=?').get(a.bill_id); const c = parse(b.client_json, {}); lines.push({ key: 'ar', credit: a.amount, memo: `沖 ${b.bill_no}`, community_id: b.community_id, party: c.name || rc.payer, party_tax_id: c.tax_id || '' }); used += a.amount; }
    if (rc.amount - used > 0.004) lines.push({ key: 'advance_receipt', credit: Math.round((rc.amount - used) * 100) / 100, memo: '多收（預收款）', community_id: rc.community_id, party: rc.payer });
    return acct.post(tid, { entity_id: rc.entity_id, date: rc.date, summary: `收款 ${rc.payer || ''}`.trim(), source: 'ar_receipt', source_id: rc.id, lines }, u).id;
  }

  // ================= 路由 =================
  const B = '/api/company/ar';
  app.get(`${B}/meta`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const a = allowedInvoice(tid);
    res.set('Cache-Control', 'no-store');
    res.json({ entities: acct.entities(tid), communities: db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid), kinds: KINDS, status: STATUS, invoice_types: Object.fromEntries(a.list.map(k => [k, INV[k]])), invoice_mode: a.mode, einvoice_provider: a.api, einvoice_test: a.test, methods: METHOD, today: todayTW() });
  }));
  app.post(`${B}/generate`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const b = req.body || {}; if (!isMonth(b.period)) throw err('請選擇服務月份');
    let r; tx(() => { r = generate(tid, b.period, getUser(req), b.entity_id); })(); res.json({ success: true, ...r });
  }));
  app.get(`${B}/bills`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const args = [tid]; let w = 'tenant_id=?';
    if (Number(q.entity_id)) { w += ' AND entity_id=?'; args.push(Number(q.entity_id)); }
    if (Number(q.community_id)) { w += ' AND community_id=?'; args.push(Number(q.community_id)); }
    if (isMonth(q.period)) { w += ' AND (period=? OR (period=\'\' AND substr(bill_date,1,7)=?))'; args.push(q.period, q.period); }
    const G = { draft: ['draft'], open: ['issued', 'partial'], paid: ['paid'], void: ['void'] };
    if (G[q.status]) { w += ` AND status IN (${G[q.status].map(() => '?').join(',')})`; args.push(...G[q.status]); }
    if (q.q) { w += ' AND (bill_no LIKE ? OR invoice_no LIKE ? OR client_json LIKE ?)'; const k = `%${str(q.q, 40)}%`; args.push(k, k, k); }
    let rows = db.prepare(`SELECT * FROM ar_bills WHERE ${w} ORDER BY bill_date DESC, id DESC LIMIT 800`).all(...args).map(b => billOut(b));
    if (q.status === 'overdue') rows = rows.filter(b => b.overdue);
    const sum = k => rows.filter(b => b.status !== 'void').reduce((s, b) => s + b[k], 0);
    res.set('Cache-Control', 'no-store'); res.json({ rows, total: { gross: sum('gross'), paid: sum('paid'), outstanding: sum('outstanding') } });
  }));
  app.get(`${B}/bills/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => res.json({ bill: billOut(getBill(req), { detail: true }) })));
  // 手動加開（例如工程維修、臨時人力）
  app.post(`${B}/bills`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const e = acct.entityOf(tid, b.entity_id);
    const cid = Number(b.community_id) || null; if (cid && !db.prepare('SELECT 1 FROM communities WHERE id=? AND tenant_id=?').get(cid, tid)) throw err('找不到社區');
    const date = isDate(b.bill_date) ? b.bill_date : todayTW(); const items = readItems(b.items); const taxType = ['exclusive', 'inclusive', 'exempt'].includes(b.tax_type) ? b.tax_type : 'exclusive';
    let client = b.client && typeof b.client === 'object' ? b.client : null;
    if (!client || !client.name) { const c = cid ? contracts.activeFor(tid, cid, date) : null; client = c ? parse(c.client_json, {}) : { name: '' }; }
    client = { name: str(client.name, 60), tax_id: str(client.tax_id, 8), contact: str(client.contact, 30), phone: str(client.phone, 30), email: str(client.email, 80), address: str(client.address, 120) };
    if (!client.name) throw err('請填寫買受人'); if (client.tax_id && !acct.validTaxId(client.tax_id)) throw err('買受人統一編號格式不正確');
    const k = calc(items, taxType); const n = nextNo(tid, e.id, date);
    const id = Number(db.prepare('INSERT INTO ar_bills (tenant_id,entity_id,community_id,period,seq,bill_no,bill_date,due_date,client_json,tax_type,items_json,net,tax,gross,status,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tid, e.id, cid, isMonth(b.period) ? b.period : '', n.seq, n.no, date, isDate(b.due_date) ? b.due_date : addDays(date, 30), JSON.stringify(client), taxType, JSON.stringify(items), k.net, k.tax, k.gross, 'draft', str(b.note, 300), by(u), now(), now()).lastInsertRowid);
    log(tid, u, 'create', { bill: id, note: '手動加開' }); res.json({ success: true, bill: billOut(db.prepare('SELECT * FROM ar_bills WHERE id=?').get(id), { detail: true }) });
  }));
  app.put(`${B}/bills/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const u = getUser(req); const b0 = getBill(req); if (b0.status !== 'draft') throw err('已開立的請款單不能修改，請作廢後重開'); const b = req.body || {};
    const items = b.items ? readItems(b.items) : parse(b0.items_json, []); const taxType = ['exclusive', 'inclusive', 'exempt'].includes(b.tax_type) ? b.tax_type : b0.tax_type; const k = calc(items, taxType);
    const c0 = parse(b0.client_json, {}); const cl = b.client && typeof b.client === 'object' ? { ...c0, ...b.client } : c0; if (cl.tax_id && !acct.validTaxId(cl.tax_id)) throw err('買受人統一編號格式不正確');
    const date = isDate(b.bill_date) ? b.bill_date : b0.bill_date;
    db.prepare('UPDATE ar_bills SET bill_date=?,due_date=?,client_json=?,tax_type=?,items_json=?,net=?,tax=?,gross=?,note=?,invoice_type=?,updated_at=? WHERE id=?')
      .run(date, isDate(b.due_date) ? b.due_date : b0.due_date, JSON.stringify(cl), taxType, JSON.stringify(items), k.net, k.tax, k.gross, b.note !== undefined ? str(b.note, 300) : b0.note, INV[b.invoice_type] ? b.invoice_type : b0.invoice_type, now(), b0.id);
    log(b0.tenant_id, u, 'edit', { bill: b0.id, note: `含稅 ${b0.gross} → ${k.gross}` }); res.json({ success: true, bill: billOut(db.prepare('SELECT * FROM ar_bills WHERE id=?').get(b0.id), { detail: true }) });
  }));
  app.delete(`${B}/bills/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => { const b = getBill(req); if (b.status !== 'draft') throw err('已開立的請款單請用作廢'); db.prepare('DELETE FROM ar_bills WHERE id=?').run(b.id); res.json({ success: true }); }));
  app.post(`${B}/bills/:id/issue`, requireCompanyAdmin, needAcct, wrap(async (req, res) => {
    const b = getBill(req); const r = await issue(b, getUser(req), req.body || {}); res.json({ success: true, bill: billOut(r, { detail: true }) });
  }));
  // 批次開立（未開立的請款單）
  app.post(`${B}/bills/issue-batch`, requireCompanyAdmin, needAcct, wrap(async (req, res) => {
    const tid = tenantId(req); const u = getUser(req); const ids = (req.body?.ids || []).map(Number).slice(0, 200); const ok = [], fail = [];
    for (const id of ids) { const b = db.prepare("SELECT * FROM ar_bills WHERE id=? AND tenant_id=? AND status='draft'").get(id, tid); if (!b) continue; try { await issue(b, u, { type: req.body?.type }); ok.push(id); } catch (e) { fail.push({ id, bill_no: b.bill_no, community: commName(b.community_id), error: e.message }); } }
    res.json({ success: true, ok, fail });
  }));
  // 補登發票號碼（手開／外部電子發票）
  app.post(`${B}/bills/:id/invoice`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const u = getUser(req); const b = getBill(req); if (['draft', 'void'].includes(b.status)) throw err('請先開立請款單');
    if (!['paper', 'e_manual'].includes(b.invoice_type)) throw err('系統開立的電子發票不能手動修改');
    const no = str(req.body?.no, 10).toUpperCase(); if (!INV_NO.test(no)) throw err('發票號碼格式是 2 個英文字母加 8 位數字');
    if (db.prepare('SELECT 1 FROM ar_bills WHERE tenant_id=? AND entity_id=? AND invoice_no=? AND id<>?').get(b.tenant_id, b.entity_id, no, b.id)) throw err(`發票號碼 ${no} 已經用過了`);
    const date = isDate(req.body?.date) ? req.body.date : b.bill_date;
    db.prepare("UPDATE ar_bills SET invoice_no=?,invoice_date=?,invoice_status='issued',updated_at=? WHERE id=?").run(no, date, now(), b.id);
    log(b.tenant_id, u, 'invoice', { bill: b.id, note: `${no}（${date}）${b.invoice_no ? `，原 ${b.invoice_no}` : ''}` }); res.json({ success: true, bill: billOut(db.prepare('SELECT * FROM ar_bills WHERE id=?').get(b.id), { detail: true }) });
  }));
  app.post(`${B}/bills/:id/void`, requireCompanyAdmin, needAcct, wrap(async (req, res) => {
    const u = getUser(req); const b = getBill(req); const reason = str(req.body?.reason, 200); if (!reason) throw err('請寫作廢原因');
    if (b.status === 'void') throw err('已經作廢了'); if (b.status === 'draft') throw err('未開立的請款單直接刪除就可以');
    if (paidOf(b.id) > 0) throw err('這張請款單已經有收款，請先作廢收款');
    if (b.invoice_type === 'e_api' && b.invoice_no && b.invoice_status === 'issued') await EI.invalid(acct.settingsFor(b.tenant_id).invoice, { invoice_no: b.invoice_no, invoice_date: b.invoice_date }, reason);
    tx(() => {
      acct.voidBySource(b.tenant_id, 'ar', b.id, u, `請款單作廢：${reason}`);
      db.prepare("UPDATE ar_bills SET status='void',void_by=?,void_at=?,void_reason=?,invoice_status=CASE WHEN invoice_no<>'' THEN 'void' ELSE invoice_status END,invoice_void_reason=CASE WHEN invoice_no<>'' THEN ? ELSE '' END,updated_at=? WHERE id=?").run(by(u), now(), reason, reason, now(), b.id);
    })();
    log(b.tenant_id, u, 'void', { bill: b.id, note: `${reason}${b.invoice_no ? `；發票 ${b.invoice_no} 作廢${b.invoice_type === 'e_api' ? '（已通知加值中心）' : '（紙本請收回）'}` : ''}` });
    res.json({ success: true, bill: billOut(db.prepare('SELECT * FROM ar_bills WHERE id=?').get(b.id), { detail: true }) });
  }));

  // 收款
  app.get(`${B}/receipts`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const args = [tid]; let w = 'tenant_id=?';
    if (Number(q.entity_id)) { w += ' AND entity_id=?'; args.push(Number(q.entity_id)); } if (isDate(q.from)) { w += ' AND date>=?'; args.push(q.from); } if (isDate(q.to)) { w += ' AND date<=?'; args.push(q.to); }
    const rows = db.prepare(`SELECT * FROM ar_receipts WHERE ${w} ORDER BY date DESC, id DESC LIMIT 500`).all(...args).map(r => ({ ...r, method_label: METHOD[r.method], community_name: commName(r.community_id),
      allocations: db.prepare('SELECT a.amount,b.id bill_id,b.bill_no,b.community_id FROM ar_allocations a JOIN ar_bills b ON b.id=a.bill_id WHERE a.receipt_id=?').all(r.id).map(a => ({ ...a, community_name: commName(a.community_id) })) }));
    res.set('Cache-Control', 'no-store'); res.json({ rows });
  }));
  app.post(`${B}/receipts`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const e = acct.entityOf(tid, b.entity_id);
    const date = isDate(b.date) ? b.date : todayTW(); const amount = Math.round((Number(b.amount) || 0) * 100) / 100; const fee = Math.max(0, Math.round((Number(b.fee) || 0) * 100) / 100);
    if (amount <= 0) throw err('請填寫收款金額'); if (fee >= amount) throw err('手續費不能大於收款金額');
    const method = METHOD[b.method] ? b.method : 'transfer';
    const allocs = (Array.isArray(b.allocations) ? b.allocations : []).map(a => ({ bill_id: Number(a.bill_id), amount: Math.round((Number(a.amount) || 0) * 100) / 100 })).filter(a => a.bill_id && a.amount > 0);
    const total = allocs.reduce((s, a) => s + a.amount, 0); if (total - amount > 0.004) throw err('沖帳金額合計不能超過收款金額');
    let cid = Number(b.community_id) || null;
    for (const a of allocs) {
      const bl = db.prepare('SELECT * FROM ar_bills WHERE id=? AND tenant_id=?').get(a.bill_id, tid); if (!bl) throw err('找不到要沖帳的請款單');
      if (bl.entity_id !== e.id) throw err(`${bl.bill_no} 不是這家公司的請款單`); if (!['issued', 'partial'].includes(bl.status)) throw err(`${bl.bill_no} 目前不能沖帳（${STATUS[bl.status]}）`);
      const out = bl.gross - paidOf(bl.id); if (a.amount - out > 0.004) throw err(`${bl.bill_no} 只剩 ${out.toLocaleString()} 未收`);
      if (!cid) cid = bl.community_id;
    }
    let id;
    tx(() => {
      id = Number(db.prepare('INSERT INTO ar_receipts (tenant_id,entity_id,date,method,amount,fee,payer,community_id,ref,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(tid, e.id, date, method, amount, fee, str(b.payer, 60), cid, str(b.ref, 40), str(b.note, 200), by(u), now()).lastInsertRowid);
      for (const a of allocs) db.prepare('INSERT INTO ar_allocations (tenant_id,receipt_id,bill_id,amount) VALUES (?,?,?,?)').run(tid, id, a.bill_id, a.amount);
      const vid = postReceipt(tid, { id, entity_id: e.id, date, method, amount, fee, payer: str(b.payer, 60), community_id: cid, ref: str(b.ref, 40) }, allocs, u);
      db.prepare('UPDATE ar_receipts SET voucher_id=? WHERE id=?').run(vid, id);
      for (const a of allocs) { refresh(a.bill_id); log(tid, u, 'receipt', { bill: a.bill_id, receipt: id, note: `收款 ${a.amount.toLocaleString()}（${METHOD[method]} ${date}）` }); }
    })();
    res.json({ success: true, id, unallocated: Math.round((amount - total) * 100) / 100 });
  }));
  app.post(`${B}/receipts/:id/void`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const u = getUser(req); const tid = tenantId(req); const r = db.prepare('SELECT * FROM ar_receipts WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!r) throw err('找不到收款', 404);
    if (r.status !== 'posted') throw err('已經作廢了'); const reason = str(req.body?.reason, 200); if (!reason) throw err('請寫作廢原因');
    const bills = db.prepare('SELECT bill_id FROM ar_allocations WHERE receipt_id=?').all(r.id).map(x => x.bill_id);
    tx(() => {
      acct.voidBySource(tid, 'ar_receipt', r.id, u, `收款作廢：${reason}`);
      db.prepare("UPDATE ar_receipts SET status='void',void_by=?,void_at=?,void_reason=? WHERE id=?").run(by(u), now(), reason, r.id);
      for (const id of bills) { const b = db.prepare('SELECT * FROM ar_bills WHERE id=?').get(id); if (b && b.status !== 'void') { db.prepare("UPDATE ar_bills SET status='issued' WHERE id=?").run(id); refresh(id); } log(tid, u, 'receipt_void', { bill: id, receipt: r.id, note: reason }); }
    })();
    res.json({ success: true });
  }));

  // 帳齡
  app.get(`${B}/aging`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const date = isDate(q.date) ? q.date : todayTW();
    const args = [tid, date]; let w = "tenant_id=? AND status IN ('issued','partial','paid') AND bill_date<=?"; if (Number(q.entity_id)) { w += ' AND entity_id=?'; args.push(Number(q.entity_id)); }
    const rows = {}; const tot = { current: 0, d30: 0, d60: 0, d90: 0, over: 0, total: 0 };
    for (const b of db.prepare(`SELECT * FROM ar_bills WHERE ${w}`).all(...args)) {
      const paid = db.prepare("SELECT COALESCE(SUM(a.amount),0) s FROM ar_allocations a JOIN ar_receipts r ON r.id=a.receipt_id WHERE a.bill_id=? AND r.status='posted' AND r.date<=?").get(b.id, date).s;
      const out = Math.round((b.gross - paid) * 100) / 100; if (out <= 0.004) continue;
      const late = diffDays(b.due_date, date); const k = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over';
      const key = b.community_id || 0; const c = parse(b.client_json, {});
      const r = rows[key] ||= { community_id: b.community_id, community_name: commName(b.community_id) || c.name || '（未指定社區）', client: c.name || '', current: 0, d30: 0, d60: 0, d90: 0, over: 0, total: 0, bills: [] };
      r[k] += out; r.total += out; tot[k] += out; tot.total += out; r.bills.push({ id: b.id, bill_no: b.bill_no, due_date: b.due_date, outstanding: out, late: Math.max(0, late) });
    }
    res.json({ date, rows: Object.values(rows).sort((a, b) => b.total - a.total), total: tot });
  }));
  // 銷項明細（401 申報用：兩個月一期）
  const FMT = { paper: kind => kind === 'b2b' ? '31' : '32', e_manual: () => '35', e_api: () => '35' };
  function sales(tid, eid, from, to) {
    const rows = db.prepare("SELECT * FROM ar_bills WHERE tenant_id=? AND entity_id=? AND invoice_no<>'' AND invoice_date>=? AND invoice_date<=? ORDER BY invoice_date, invoice_no").all(tid, eid, from, to).map(b => {
      const c = parse(b.client_json, {}); const voided = b.invoice_status === 'void';
      return { id: b.id, format: (FMT[b.invoice_type] || (() => ''))(c.tax_id ? 'b2b' : 'b2c'), invoice_date: b.invoice_date, invoice_no: b.invoice_no, buyer_tax_id: c.tax_id || '', buyer: c.name || '', net: voided ? 0 : b.net, tax: voided ? 0 : b.tax, tax_kind: b.tax_type === 'exempt' ? '3' : '1', void: voided, bill_no: b.bill_no, community_name: commName(b.community_id) };
    });
    const sum = rows.filter(r => !r.void).reduce((s, r) => ({ net: s.net + r.net, tax: s.tax + r.tax }), { net: 0, tax: 0 });
    const byFmt = {}; for (const r of rows) { const k = r.format || '?'; byFmt[k] ||= { count: 0, void: 0, net: 0, tax: 0 }; byFmt[k].count++; if (r.void) byFmt[k].void++; byFmt[k].net += r.net; byFmt[k].tax += r.tax; }
    const missing = db.prepare("SELECT bill_no,bill_date FROM ar_bills WHERE tenant_id=? AND entity_id=? AND status IN ('issued','partial','paid') AND invoice_type IN ('paper','e_manual') AND invoice_no='' AND bill_date>=? AND bill_date<=?").all(tid, eid, from, to);
    return { from, to, rows, total: sum, by_format: byFmt, missing };
  }
  app.get(`${B}/sales`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const e = acct.entityOf(tid, q.entity_id || acct.entities(tid)[0]?.id);
    const from = isDate(q.from) ? q.from : `${todayTW().slice(0, 7)}-01`, to = isDate(q.to) ? q.to : todayTW(); const s = sales(tid, e.id, from, to);
    if (q.format === 'csv') {
      const head = ['格式代號', '發票日期', '發票號碼', '買受人統編', '買受人', '銷售額', '稅額', '課稅別', '作廢', '請款單號', '社區'];
      const csv = [head, ...s.rows.map(r => [r.format, r.invoice_date, r.invoice_no, r.buyer_tax_id, r.buyer, r.net, r.tax, r.tax_kind, r.void ? 'Y' : '', r.bill_no, r.community_name])].map(r => r.map(v => { const x = String(v ?? ''); return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`銷項明細_${e.short_name || e.name}_${from}_${to}`)}.csv`);
      return res.send(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(csv + '\r\n', 'utf8')]));
    }
    res.json({ entity: e, ...s });
  }));

  function dashboard(tid) {
    const t = todayTW(); const open = db.prepare("SELECT * FROM ar_bills WHERE tenant_id=? AND status IN ('issued','partial')").all(tid);
    let out = 0, overdue = 0, overdueAmt = 0; for (const b of open) { const o = b.gross - paidOf(b.id); out += o; if (b.due_date < t) { overdue++; overdueAmt += o; } }
    return { outstanding: Math.round(out), overdue, overdue_amount: Math.round(overdueAmt), drafts: db.prepare("SELECT COUNT(*) c FROM ar_bills WHERE tenant_id=? AND status='draft'").get(tid).c };
  }
  return { dashboard, calc };
};
