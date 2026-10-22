// 公司應支：請款（內勤人員都可以提出）→ 依總後台設定的關卡審核 → 入帳 → 付款；廠商；進項明細（401）
// 社區回饋金：依合約的現金回饋產生請款、服務回饋（例如特清）執行紀錄
// 薪資入帳：已發布的薪資自動產生傳票（依社區、簽約公司）；發薪付款
// 會計分錄：
//   核准：借 費用／成本（未稅，依社區）＋ 進項稅額（可扣抵發票）／ 貸 應付帳款（廠商）、應付費用（員工代墊）、應付社區回饋金
//   付款：借 應付… ／ 貸 銀行存款（＋手續費）
'use strict';

module.exports = function registerApRoutes(app, d) {
  const { db, fs, path, crypto, multer, DATA_DIR, getUser, tenantId, now, requireCompanyAdmin, getSiteAssignments, org, acct, contracts } = d;
  const DIR = path.join(DATA_DIR, 'uploads', 'ap'); try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  db.exec(`
  CREATE TABLE IF NOT EXISTS ap_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, tax_id TEXT DEFAULT '', category TEXT DEFAULT '', contact TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    address TEXT DEFAULT '', bank_json TEXT DEFAULT '{}', default_account TEXT DEFAULT '', terms_days INTEGER DEFAULT 30, note TEXT DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS ap_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, seq INTEGER NOT NULL, no TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'vendor', applicant_id INTEGER,
    vendor_id INTEGER, payee TEXT DEFAULT '', payee_tax_id TEXT DEFAULT '', bank_json TEXT DEFAULT '{}', community_id INTEGER, contract_id INTEGER, feedback_key TEXT DEFAULT '',
    title TEXT DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]', amount REAL NOT NULL DEFAULT 0, net REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
    invoice_kind TEXT DEFAULT 'tri', invoice_no TEXT DEFAULT '', invoice_date TEXT DEFAULT '', buyer_tax_id TEXT DEFAULT '', deductible INTEGER DEFAULT 0,
    request_date TEXT NOT NULL, due_date TEXT DEFAULT '', pay_method TEXT DEFAULT 'transfer', status TEXT NOT NULL DEFAULT 'draft', steps_json TEXT DEFAULT '[]', step_index INTEGER DEFAULT 0,
    liability_key TEXT DEFAULT 'ap', voucher_id INTEGER, payment_id INTEGER, note TEXT DEFAULT '', reject_reason TEXT DEFAULT '', void_reason TEXT DEFAULT '',
    created_by TEXT DEFAULT '', created_at TEXT NOT NULL, submitted_at TEXT, approved_at TEXT, paid_at TEXT, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ap_requests ON ap_requests(tenant_id, status);
  CREATE TABLE IF NOT EXISTS ap_files (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, filename TEXT NOT NULL, original TEXT DEFAULT '', mime TEXT DEFAULT '', size INTEGER DEFAULT 0, uploaded_by TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ap_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, request_id INTEGER, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ap_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, date TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'transfer', amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0,
    ref TEXT DEFAULT '', note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'posted', voucher_id INTEGER, created_by TEXT DEFAULT '', created_at TEXT NOT NULL, void_by TEXT DEFAULT '', void_at TEXT, void_reason TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS ap_payment_items (payment_id INTEGER NOT NULL, request_id INTEGER NOT NULL, amount REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS feedback_service_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, contract_id INTEGER NOT NULL, item TEXT NOT NULL, date TEXT NOT NULL, note TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payroll_postings (tenant_id INTEGER NOT NULL, run_id INTEGER NOT NULL, month TEXT NOT NULL, posted_at TEXT, posted_by TEXT DEFAULT '', paid_at TEXT, paid_by TEXT DEFAULT '', PRIMARY KEY (tenant_id, run_id));
  `);

  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const monthEnd = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const r0 = v => Math.round(Number(v) || 0);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => db.transaction(fn);
  const by = u => u?.name || u?.employee_id || '';
  const commName = id => id ? (db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '') : '';
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const nameOf = (tid, id) => staffRow(tid, id)?.name || '';
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1").all(tid).map(x => x.id);
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const log = (tid, rid, u, action, note = '') => db.prepare('INSERT INTO ap_logs (tenant_id,request_id,actor,action,note,created_at) VALUES (?,?,?,?,?,?)').run(tid, rid, typeof u === 'string' ? u : by(u), action, str(note, 300), now());
  function notify(tid, from, toIds, subject, body) {
    for (const toId of [...new Set(toIds)].filter(Boolean)) {
      try {
        const to = staffRow(tid, toId); if (!to) continue;
        let sender = from && from.id !== to.id ? from : null; if (!sender) { const a = adminIds(tid).find(x => x !== to.id); sender = a ? staffRow(tid, a) : null; } if (!sender) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, subject, body, 'text', '', now());
      } catch (e) { console.warn('ap message failed', e.message); }
    }
  }
  const needAcct = (req, res, next) => { if (!acct.canAcct(getUser(req))) return bad(res, '需要「會計」權限', 403); next(); };

  const KIND = { vendor: '廠商請款', reimburse: '員工代墊', feedback: '社區回饋金', other: '其他' };
  const LIAB = { vendor: 'ap', reimburse: 'accrued_expense', feedback: 'feedback_payable', other: 'accrued_expense' };
  const INV = { tri: '三聯式發票', e: '電子發票（有統編）', bi: '二聯式／收銀機發票（無統編）', receipt: '收據', none: '無憑證' };
  const STATUS = { draft: '草稿', pending: '審核中', approved: '待付款', rejected: '退回', paid: '已付款', void: '已作廢' };
  const METHOD = { transfer: '匯款', cash: '現金', check: '支票', other: '其他' };
  const INV_NO = /^[A-Z]{2}\d{8}$/;

  // ---------- 審核關卡 ----------
  function peopleOf(tid) { return db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active'").all(tid); }
  function resolveStep(tid, s, applicantId) {
    const P = peopleOf(tid); let ids = [];
    if (s.by === 'perm') {
      // 「有某項權限的人」：老闆、總經理通常有全部權限，有其他承辦人時不列入這一關
      const holders = P.filter(u => u.role !== 'company_admin' && acct.perms(u).has(s.value)); const staff = holders.filter(u => !['owner', 'gm'].includes(mi(u)?.kind));
      ids = (staff.length ? staff : holders).map(u => u.id);
    }
    if (s.by === 'kind') ids = P.filter(u => mi(u)?.kind === s.value).map(u => u.id);
    if (s.by === 'position') ids = P.filter(u => mi(u)?.position?.id === s.value).map(u => u.id);
    return ids.filter(id => id !== applicantId);
  }
  function buildSteps(tid, amount, applicantId) {
    const flow = acct.settingsFor(tid).ap_flow; const out = [];
    for (const s of flow) { if (amount < s.min_amount) continue; const ids = resolveStep(tid, s, applicantId); out.push({ name: s.name, approvers: ids, min_amount: s.min_amount, status: ids.length ? 'waiting' : 'skipped', note: ids.length ? '' : '沒有可以審核的人，自動略過' }); }
    if (!out.some(s => s.status === 'waiting')) out.push({ name: '公司管理員', approvers: adminIds(tid).filter(x => x !== applicantId), status: 'waiting', note: '沒有設定審核人，由公司管理員審核' });
    return out;
  }
  const curStep = r => parse(r.steps_json, [])[r.step_index] || null;
  // 只有這一關的審核人可以審（公司管理員也不能跳過會計直接核准）；沒有任何審核人時才由公司管理員審
const canDecide = (r, u) => { if (r.status !== 'pending' || r.applicant_id === u.id) return false; const ap = curStep(r)?.approvers || []; return ap.includes(u.id) || (!ap.length && u.role === 'company_admin'); };

  // ---------- 金額 ----------
  function calc(items, kind, taxOverride) {
    const L = items.map(x => ({ ...x, amount: r0(x.amount) })).filter(x => x.amount);
    const gross = L.reduce((s, x) => s + x.amount, 0); const deduct = ['tri', 'e'].includes(kind);
    let tax = deduct ? (taxOverride !== undefined && taxOverride !== null && taxOverride !== '' ? r0(taxOverride) : gross - Math.round(gross / 1.05)) : 0;
    if (tax < 0 || tax > gross) throw err('稅額不正確');
    const net = gross - tax; let an = 0;
    const lines = L.map((x, i) => { const n = i === L.length - 1 ? net - an : Math.round(x.amount * net / (gross || 1)); an += n; return { ...x, net: n }; });
    return { lines, gross, net, tax };
  }
  function readItems(tid, arr) {
    const items = (Array.isArray(arr) ? arr : []).map(x => ({ account: str(x?.account, 12), desc: str(x?.desc, 100), amount: r0(x?.amount), community_id: Number(x?.community_id) || null })).filter(x => x.amount || x.desc);
    if (!items.length || !items.some(x => x.amount > 0)) throw err('請至少填一個有金額的項目');
    if (items.some(x => x.amount < 0)) throw err('金額不能是負數');
    for (const x of items) { if (x.account) { const a = acct.accountBy(tid, x.account); if (!a || !a.is_active) throw err(`會計科目 ${x.account} 不存在或已停用`); if (!['cost', 'expense', 'asset', 'other_expense'].includes(a.type)) throw err(`請款項目不能用「${a.name}」科目`); } }
    return items.slice(0, 50);
  }
  function nextNo(tid, eid, date) { const r = db.prepare('SELECT MAX(seq) s FROM ap_requests WHERE tenant_id=? AND entity_id=? AND substr(request_date,1,7)=?').get(tid, eid, date.slice(0, 7)); const seq = (r?.s || 0) + 1; return { seq, no: `AP${date.slice(0, 7).replace('-', '')}${String(seq).padStart(4, '0')}` }; }

  function out(r, u, { detail = false } = {}) {
    const ent = acct.entities(r.tenant_id, { all: true }).find(e => e.id === r.entity_id); const steps = parse(r.steps_json, []); const t = todayTW();
    const o = { id: r.id, no: r.no, kind: r.kind, kind_label: KIND[r.kind], entity_id: r.entity_id, entity_name: ent?.short_name || ent?.name || '', applicant_id: r.applicant_id, applicant: nameOf(r.tenant_id, r.applicant_id) || r.created_by,
      vendor_id: r.vendor_id, payee: r.payee, payee_tax_id: r.payee_tax_id, bank: parse(r.bank_json, {}), community_id: r.community_id, community_name: commName(r.community_id), title: r.title, items: parse(r.items_json, []),
      amount: r.amount, net: r.net, tax: r.tax, invoice_kind: r.invoice_kind, invoice_label: INV[r.invoice_kind], invoice_no: r.invoice_no, invoice_date: r.invoice_date, buyer_tax_id: r.buyer_tax_id, deductible: !!r.deductible,
      request_date: r.request_date, due_date: r.due_date, overdue: r.status === 'approved' && r.due_date && r.due_date < t, pay_method: r.pay_method, status: r.status, status_label: STATUS[r.status], steps, step_index: r.step_index,
      current_step: r.status === 'pending' ? steps[r.step_index]?.name || '' : '', waiting_for: r.status === 'pending' ? (steps[r.step_index]?.approvers || []).map(id => nameOf(r.tenant_id, id)).filter(Boolean) : [],
      note: r.note, reject_reason: r.reject_reason, void_reason: r.void_reason, voucher_id: r.voucher_id, payment_id: r.payment_id, created_at: r.created_at, approved_at: r.approved_at, paid_at: r.paid_at,
      can: u ? { edit: ['draft', 'rejected'].includes(r.status) && (r.applicant_id === u.id || acct.canAcct(u)), submit: ['draft', 'rejected'].includes(r.status) && (r.applicant_id === u.id || acct.canAcct(u)), decide: canDecide(r, u), classify: r.status === 'pending' && acct.canAcct(u), void: ['draft', 'pending', 'rejected', 'approved'].includes(r.status) && (acct.canAcct(u) || (r.applicant_id === u.id && r.status !== 'approved')), pay: r.status === 'approved' && acct.canAcct(u) } : {},
      files: db.prepare('SELECT id,original,mime,size,uploaded_by,created_at FROM ap_files WHERE request_id=? ORDER BY id').all(r.id) };
    if (detail) o.logs = db.prepare('SELECT actor,action,note,created_at FROM ap_logs WHERE request_id=? ORDER BY id').all(r.id);
    return o;
  }
  const getReq = req => { const r = db.prepare('SELECT * FROM ap_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req)); if (!r) throw err('找不到請款單', 404); return r; };
  const canView = (r, u) => r.applicant_id === u.id || acct.canAcct(u) || parse(r.steps_json, []).some(s => (s.approvers || []).includes(u.id));

  // ---------- 建立／修改 ----------
  function readRequest(tid, b, cur = {}) {
    const e = acct.entityOf(tid, b.entity_id ?? cur.entity_id ?? (acct.entities(tid).find(x => x.is_default) || acct.entities(tid)[0])?.id); const kind = KIND[b.kind] ? b.kind : (cur.kind || 'vendor');
    const items = readItems(tid, b.items ?? parse(cur.items_json, []));
    let vendor = null; const vid = Number(b.vendor_id ?? cur.vendor_id) || null;
    if (vid) { vendor = db.prepare('SELECT * FROM ap_vendors WHERE id=? AND tenant_id=?').get(vid, tid); if (!vendor) throw err('找不到廠商'); }
    const payee = str(b.payee ?? cur.payee, 60) || vendor?.name || ''; if (!payee) throw err(kind === 'reimburse' ? '請填寫收款人' : '請選擇或填寫廠商');
    const payeeTax = str(b.payee_tax_id ?? cur.payee_tax_id, 8) || vendor?.tax_id || ''; if (payeeTax && !acct.validTaxId(payeeTax)) throw err('廠商統一編號格式不正確');
    const invKind = INV[b.invoice_kind] ? b.invoice_kind : (cur.invoice_kind || 'tri');
    const invNo = str(b.invoice_no ?? cur.invoice_no, 10).toUpperCase(); if (invNo && ['tri', 'e', 'bi'].includes(invKind) && !INV_NO.test(invNo)) throw err('發票號碼格式是 2 個英文字母加 8 位數字');
    const buyer = ['tri', 'e'].includes(invKind) ? (str(b.buyer_tax_id ?? cur.buyer_tax_id, 8) || e.tax_id || '') : '';
    const s = acct.settingsFor(tid);
    if (s.ap_require_tax_id && kind !== 'feedback') {
      if (invKind === 'bi') throw err('公司規定請款發票必須有本公司統編（三聯式或電子發票打統編），二聯式發票不能請款；沒有發票請選「收據」並說明');
      if (['tri', 'e'].includes(invKind) && e.tax_id && buyer !== e.tax_id) throw err(`發票上的買受人統編必須是本公司（${e.short_name || e.name}）的統編 ${e.tax_id}`);
    }
    const k = calc(items, invKind, b.tax ?? (cur.tax ?? undefined));
    const date = isDate(b.request_date) ? b.request_date : (cur.request_date || todayTW());
    const bank = b.bank && typeof b.bank === 'object' ? { bank: str(b.bank.bank, 40), code: str(b.bank.code, 10), branch: str(b.bank.branch, 40), account: str(b.bank.account, 30), name: str(b.bank.name, 60) } : (cur.bank_json ? parse(cur.bank_json, {}) : (vendor ? parse(vendor.bank_json, {}) : {}));
    return { entity_id: e.id, kind, items, vendor_id: vendor?.id || null, payee, payee_tax_id: payeeTax, bank, community_id: Number(b.community_id ?? cur.community_id) || null, title: str(b.title ?? cur.title, 80) || items[0].desc || KIND[kind],
      amount: k.gross, net: k.net, tax: k.tax, invoice_kind: invKind, invoice_no: invNo, invoice_date: isDate(b.invoice_date) ? b.invoice_date : (cur.invoice_date || ''), buyer_tax_id: buyer, deductible: ['tri', 'e'].includes(invKind) && k.tax > 0 ? 1 : 0,
      request_date: date, due_date: isDate(b.due_date) ? b.due_date : (cur.due_date || addDays(date, vendor?.terms_days ?? 30)), pay_method: METHOD[b.pay_method] ? b.pay_method : (cur.pay_method || 'transfer'), note: str(b.note ?? cur.note, 300), liability_key: LIAB[kind] };
  }
  function insert(tid, x, u, extra = {}) {
    const n = nextNo(tid, x.entity_id, x.request_date);
    return Number(db.prepare(`INSERT INTO ap_requests (tenant_id,entity_id,seq,no,kind,applicant_id,vendor_id,payee,payee_tax_id,bank_json,community_id,contract_id,feedback_key,title,items_json,amount,net,tax,invoice_kind,invoice_no,invoice_date,buyer_tax_id,deductible,request_date,due_date,pay_method,status,liability_key,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tid, x.entity_id, n.seq, n.no, x.kind, u.id, x.vendor_id, x.payee, x.payee_tax_id, JSON.stringify(x.bank), x.community_id, extra.contract_id || null, extra.feedback_key || '', x.title, JSON.stringify(x.items), x.amount, x.net, x.tax, x.invoice_kind, x.invoice_no, x.invoice_date, x.buyer_tax_id, x.deductible, x.request_date, x.due_date, x.pay_method, 'draft', x.liability_key, x.note, by(u), now(), now()).lastInsertRowid);
  }
  function submit(r, u) {
    const tid = r.tenant_id; const steps = buildSteps(tid, r.amount, r.applicant_id); const first = steps.findIndex(s => s.status === 'waiting');
    db.prepare("UPDATE ap_requests SET status='pending',steps_json=?,step_index=?,submitted_at=?,reject_reason='',updated_at=? WHERE id=?").run(JSON.stringify(steps), first, now(), now(), r.id);
    log(tid, r.id, u, 'submit', `${steps.filter(s => s.status === 'waiting').map(s => s.name).join(' → ')}`);
    notify(tid, u, steps[first].approvers, '請款審核', `💸 ${nameOf(tid, r.applicant_id) || r.created_by} 提出請款 ${r.no}：${r.title}　$${Number(r.amount).toLocaleString()}（${r.payee}）\n請到「請款 → 待我審核」處理。`);
  }
  // 核准後入帳（應付）
  function postAccrual(r, u) {
    const items = parse(r.items_json, []); const k = calc(items, r.invoice_kind, r.tax); const lines = [];
    const defaultKey = r.kind === 'feedback' ? 'cost_feedback' : 'exp_other';
    for (const x of k.lines) lines.push({ code: x.account || undefined, key: x.account ? undefined : defaultKey, debit: x.net, memo: x.desc, community_id: x.community_id || r.community_id, party: r.payee, party_tax_id: r.payee_tax_id });
    if (k.tax) lines.push({ key: 'input_vat', debit: k.tax, memo: `進項稅額 ${r.invoice_no || ''}`.trim(), party: r.payee, party_tax_id: r.payee_tax_id });
    lines.push({ key: r.liability_key || 'ap', credit: k.gross, memo: `${r.no} ${r.payee}`, community_id: r.community_id, party: r.payee, party_tax_id: r.payee_tax_id });
    let date = r.invoice_date && r.invoice_date <= todayTW() ? r.invoice_date : r.request_date; if (acct.isClosed(r.tenant_id, r.entity_id, date.slice(0, 7))) date = todayTW();
    return acct.post(r.tenant_id, { entity_id: r.entity_id, date, summary: `${KIND[r.kind]} ${r.no} ${r.title}`.slice(0, 200), source: 'ap', source_id: r.id, lines }, u).id;
  }

  // ================= 路由：請款（所有內勤人員） =================
  const B = '/api/company/ap';
  app.get(`${B}/meta`, requireCompanyAdmin, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const s = acct.settingsFor(tid);
    const accts = (() => { try { return db.prepare("SELECT code,name,type FROM acct_accounts WHERE tenant_id=? AND is_active=1 AND type IN ('cost','expense','asset','other_expense') ORDER BY code").all(tid); } catch { return []; } })();
    const comm = (() => { try { return getSiteAssignments(u).map(a => Number(a.community_id)); } catch { return []; } })();
    const todo = db.prepare("SELECT * FROM ap_requests WHERE tenant_id=? AND status='pending'").all(tid).filter(r => canDecide(r, u)).length;
    res.set('Cache-Control', 'no-store');
    res.json({ entities: acct.entities(tid), communities: db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid), my_communities: comm,
      vendors: db.prepare('SELECT id,name,tax_id,category,default_account,terms_days,bank_json FROM ap_vendors WHERE tenant_id=? AND is_active=1 ORDER BY name').all(tid).map(v => ({ ...v, bank: parse(v.bank_json, {}) })),
      accounts: accts, kinds: KIND, invoice_kinds: INV, status: STATUS, methods: METHOD, require_tax_id: s.ap_require_tax_id, flow: s.ap_flow, is_acct: acct.canAcct(u), todo, today: todayTW() });
  }));
  app.get(`${B}/requests`, requireCompanyAdmin, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const q = req.query || {}; let rows;
    if (q.scope === 'todo') rows = db.prepare("SELECT * FROM ap_requests WHERE tenant_id=? AND status='pending' ORDER BY id").all(tid).filter(r => canDecide(r, u));
    else if (q.scope === 'all') {
      if (!acct.canAcct(u)) throw err('需要「會計」權限', 403);
      const args = [tid]; let w = 'tenant_id=?';
      if (Number(q.entity_id)) { w += ' AND entity_id=?'; args.push(Number(q.entity_id)); }
      if (STATUS[q.status]) { w += ' AND status=?'; args.push(q.status); }
      if (KIND[q.kind]) { w += ' AND kind=?'; args.push(q.kind); }
      if (Number(q.community_id)) { w += ' AND community_id=?'; args.push(Number(q.community_id)); }
      if (isMonth(q.month)) { w += ' AND substr(request_date,1,7)=?'; args.push(q.month); }
      if (q.q) { w += ' AND (no LIKE ? OR payee LIKE ? OR title LIKE ? OR invoice_no LIKE ?)'; const k = `%${str(q.q, 40)}%`; args.push(k, k, k, k); }
      rows = db.prepare(`SELECT * FROM ap_requests WHERE ${w} ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, due_date, id DESC LIMIT 800`).all(...args);
    } else rows = db.prepare('SELECT * FROM ap_requests WHERE tenant_id=? AND applicant_id=? ORDER BY id DESC LIMIT 300').all(tid, u.id);
    const list = rows.map(r => out(r, u)); const sum = k => list.filter(r => r.status === k).reduce((s, r) => s + r.amount, 0);
    res.set('Cache-Control', 'no-store'); res.json({ rows: list, total: { pending: sum('pending'), approved: sum('approved'), paid: sum('paid') } });
  }));
  app.get(`${B}/requests/:id`, requireCompanyAdmin, wrap((req, res) => { const u = getUser(req); const r = getReq(req); if (!canView(r, u)) throw err('您沒有權限查看這張請款單', 403); res.json({ request: out(r, u, { detail: true }) }); }));
  app.post(`${B}/requests`, requireCompanyAdmin, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const x = readRequest(tid, b);
    if (x.kind === 'feedback' && !acct.canAcct(u)) throw err('社區回饋金請款由會計建立', 403);
    let id; tx(() => { id = insert(tid, x, u); log(tid, id, u, 'create', `${x.title} $${x.amount}`); if (b.submit) submit(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(id), u); })();
    res.json({ success: true, request: out(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(id), u, { detail: true }) });
  }));
  app.put(`${B}/requests/:id`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (!out(r, u).can.edit) throw err('這張請款單目前不能修改');
    const x = readRequest(r.tenant_id, req.body || {}, r);
    db.prepare('UPDATE ap_requests SET entity_id=?,kind=?,vendor_id=?,payee=?,payee_tax_id=?,bank_json=?,community_id=?,title=?,items_json=?,amount=?,net=?,tax=?,invoice_kind=?,invoice_no=?,invoice_date=?,buyer_tax_id=?,deductible=?,request_date=?,due_date=?,pay_method=?,note=?,liability_key=?,updated_at=? WHERE id=?')
      .run(x.entity_id, x.kind, x.vendor_id, x.payee, x.payee_tax_id, JSON.stringify(x.bank), x.community_id, x.title, JSON.stringify(x.items), x.amount, x.net, x.tax, x.invoice_kind, x.invoice_no, x.invoice_date, x.buyer_tax_id, x.deductible, x.request_date, x.due_date, x.pay_method, x.note, x.liability_key, now(), r.id);
    log(r.tenant_id, r.id, u, 'edit', `金額 ${r.amount} → ${x.amount}`);
    if (req.body?.submit) submit(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u);
    res.json({ success: true, request: out(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u, { detail: true }) });
  }));
  app.post(`${B}/requests/:id/submit`, requireCompanyAdmin, wrap((req, res) => { const u = getUser(req); const r = getReq(req); if (!out(r, u).can.submit) throw err('這張請款單目前不能送出'); submit(r, u); res.json({ success: true, request: out(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u, { detail: true }) }); }));
  // 會計審核時調整會計科目、社區、稅額（不改金額）
  app.post(`${B}/requests/:id/classify`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (r.status !== 'pending') throw err('只有審核中的請款單可以調整科目');
    const items = parse(r.items_json, []); const nx = Array.isArray(req.body?.items) ? req.body.items : [];
    if (nx.length !== items.length) throw err('項目數量不符');
    const merged = items.map((x, i) => ({ ...x, account: str(nx[i]?.account, 12) || x.account, community_id: nx[i]?.community_id !== undefined ? (Number(nx[i].community_id) || null) : x.community_id }));
    readItems(r.tenant_id, merged); if (merged.reduce((s, x) => s + x.amount, 0) !== r.amount) throw err('不能改金額');
    const k = calc(merged, r.invoice_kind, req.body?.tax ?? r.tax);
    db.prepare('UPDATE ap_requests SET items_json=?,net=?,tax=?,deductible=?,updated_at=? WHERE id=?').run(JSON.stringify(merged), k.net, k.tax, ['tri', 'e'].includes(r.invoice_kind) && k.tax > 0 ? 1 : 0, now(), r.id);
    log(r.tenant_id, r.id, u, 'classify', merged.map(x => `${x.desc}→${x.account || '未指定'}`).join('；'));
    res.json({ success: true, request: out(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u, { detail: true }) });
  }));
  app.post(`${B}/requests/:id/decide`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (!canDecide(r, u)) throw err('這張請款單目前不是由您審核', 403);
    const approve = !!req.body?.approve; const comment = str(req.body?.comment, 300); const tid = r.tenant_id; const steps = parse(r.steps_json, []); const s = steps[r.step_index];
    if (!approve) {
      if (!comment) throw err('退回請寫原因');
      s.status = 'rejected'; s.by = by(u); s.at = now(); s.comment = comment;
      db.prepare("UPDATE ap_requests SET status='rejected',steps_json=?,reject_reason=?,updated_at=? WHERE id=?").run(JSON.stringify(steps), comment, now(), r.id);
      log(tid, r.id, u, 'reject', `${s.name}：${comment}`);
      notify(tid, u, [r.applicant_id], '請款退回', `❌ 您的請款 ${r.no}（${r.title} $${Number(r.amount).toLocaleString()}）被${s.name} ${u.name} 退回。\n原因：${comment}\n可以修改後再送出。`);
      return res.json({ success: true, request: out(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u, { detail: true }) });
    }
    s.status = 'approved'; s.by = by(u); s.at = now(); s.comment = comment;
    let next = -1; for (let i = r.step_index + 1; i < steps.length; i++) if (steps[i].status === 'waiting') { next = i; break; }
    if (next >= 0) {
      db.prepare('UPDATE ap_requests SET steps_json=?,step_index=?,updated_at=? WHERE id=?').run(JSON.stringify(steps), next, now(), r.id); log(tid, r.id, u, 'approve', `${s.name}${comment ? `：${comment}` : ''}`);
      notify(tid, u, steps[next].approvers, '請款審核', `💸 請款 ${r.no}：${r.title}　$${Number(r.amount).toLocaleString()}（${r.payee}），${s.name}已核准，請您審核。`);
    } else {
      let vid; tx(() => {
        db.prepare("UPDATE ap_requests SET status='approved',steps_json=?,approved_at=?,updated_at=? WHERE id=?").run(JSON.stringify(steps), now(), now(), r.id);
        vid = postAccrual(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u); db.prepare('UPDATE ap_requests SET voucher_id=? WHERE id=?').run(vid, r.id);
      })();
      log(tid, r.id, u, 'approve', `${s.name}（最後一關）${comment ? `：${comment}` : ''}；入帳傳票 #${vid}`);
      const accts = peopleOf(tid).filter(x => x.role !== 'company_admin' && acct.canAcct(x) && acct.perms(x).has('company-accounting')).map(x => x.id);
      notify(tid, u, [r.applicant_id], '請款核准', `✅ 您的請款 ${r.no}（${r.title} $${Number(r.amount).toLocaleString()}）已核准，等待會計付款。`);
      notify(tid, u, accts, '請款待付款', `💰 請款 ${r.no}（${r.payee} $${Number(r.amount).toLocaleString()}）已核准，付款期限 ${r.due_date}。`);
    }
    res.json({ success: true, request: out(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(r.id), u, { detail: true }) });
  }));
  app.post(`${B}/requests/:id/void`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (!out(r, u).can.void) throw err('這張請款單目前不能作廢'); const reason = str(req.body?.reason, 200); if (!reason) throw err('請寫作廢原因');
    tx(() => { if (r.status === 'approved') acct.voidBySource(r.tenant_id, 'ap', r.id, u, `請款作廢：${reason}`); db.prepare("UPDATE ap_requests SET status='void',void_reason=?,updated_at=? WHERE id=?").run(reason, now(), r.id); })();
    log(r.tenant_id, r.id, u, 'void', reason); res.json({ success: true });
  }));
  // 附件（發票、收據照片）
  const upload = multer({
    storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, DIR), filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' })[file.mimetype] || '.bin'}`) }),
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => (/^image\//.test(file.mimetype) || file.mimetype === 'application/pdf') ? cb(null, true) : cb(new Error('請上傳照片或 PDF')),
  }).array('files', 5);
  app.post(`${B}/requests/:id/files`, requireCompanyAdmin, (req, res) => {
    let r; const u = getUser(req); try { r = getReq(req); } catch (e) { return bad(res, e.message, e.status); }
    if (!(r.applicant_id === u.id || acct.canAcct(u))) return bad(res, '您沒有權限上傳', 403); if (['paid', 'void'].includes(r.status)) return bad(res, '這張請款單已經結案');
    upload(req, res, e => {
      if (e) return bad(res, e.code === 'LIMIT_FILE_SIZE' ? '檔案太大了（最多 10MB）' : e.message || '上傳失敗');
      const files = req.files || (req.file ? [req.file] : []); if (!files.length) return bad(res, '請選擇檔案');
      for (const f of files) db.prepare('INSERT INTO ap_files (request_id,tenant_id,filename,original,mime,size,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.id, r.tenant_id, f.filename, str(f.originalname, 120), f.mimetype, f.size || 0, by(u), now());
      log(r.tenant_id, r.id, u, 'file', files.map(f => f.originalname).join('、')); res.json({ success: true });
    });
  });
  app.get(`${B}/files/:fid`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); const f = db.prepare('SELECT * FROM ap_files WHERE id=? AND tenant_id=?').get(Number(req.params.fid), tenantId(req)); if (!f) throw err('找不到檔案', 404);
    const r = db.prepare('SELECT * FROM ap_requests WHERE id=?').get(f.request_id); if (!canView(r, u)) throw err('您沒有權限查看', 403);
    const file = path.join(DIR, path.basename(f.filename)); if (!fs.existsSync(file)) throw err('檔案不存在', 404);
    res.setHeader('Content-Type', f.mime || 'application/octet-stream'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original || 'file')}`); res.sendFile(file);
  }));

  // ================= 會計：付款 =================
  app.post(`${B}/payments`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const ids = [...new Set((b.request_ids || []).map(Number))]; if (!ids.length) throw err('請選擇要付款的請款單');
    const rows = ids.map(id => db.prepare('SELECT * FROM ap_requests WHERE id=? AND tenant_id=?').get(id, tid)); if (rows.some(r => !r)) throw err('找不到請款單');
    if (rows.some(r => r.status !== 'approved')) throw err('只有「待付款」的請款單可以付款'); const eid = rows[0].entity_id; if (rows.some(r => r.entity_id !== eid)) throw err('一次付款只能選同一家公司的請款單');
    const date = isDate(b.date) ? b.date : todayTW(); const method = METHOD[b.method] ? b.method : 'transfer'; const fee = Math.max(0, r0(b.fee)); const total = rows.reduce((s, r) => s + r.amount, 0);
    let pid;
    tx(() => {
      pid = Number(db.prepare('INSERT INTO ap_payments (tenant_id,entity_id,date,method,amount,fee,ref,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(tid, eid, date, method, total, fee, str(b.ref, 40), str(b.note, 200), by(u), now()).lastInsertRowid);
      const cashKey = method === 'cash' ? 'cash' : method === 'check' ? 'notes_payable' : 'bank'; const lines = [];
      for (const r of rows) { db.prepare('INSERT INTO ap_payment_items (payment_id,request_id,amount) VALUES (?,?,?)').run(pid, r.id, r.amount); lines.push({ key: r.liability_key || 'ap', debit: r.amount, memo: `付 ${r.no} ${r.payee}`, community_id: r.community_id, party: r.payee, party_tax_id: r.payee_tax_id }); }
      if (fee) lines.push({ key: 'exp_other', debit: fee, memo: '匯款手續費' });
      lines.push({ key: cashKey, credit: total + fee, memo: `${METHOD[method]}付款${b.ref ? ` ${str(b.ref, 40)}` : ''}` });
      const v = acct.post(tid, { entity_id: eid, date, summary: `付款 ${rows.length === 1 ? `${rows[0].payee} ${rows[0].no}` : `${rows.length} 筆請款`}`, source: 'ap_payment', source_id: pid, lines }, u);
      db.prepare('UPDATE ap_payments SET voucher_id=? WHERE id=?').run(v.id, pid);
      for (const r of rows) { db.prepare("UPDATE ap_requests SET status='paid',payment_id=?,paid_at=?,updated_at=? WHERE id=?").run(pid, date, now(), r.id); log(tid, r.id, u, 'pay', `${METHOD[method]} ${date}`); }
    })();
    for (const r of rows) notify(tid, u, [r.applicant_id], '請款已付款', `💰 您的請款 ${r.no}（${r.title} $${Number(r.amount).toLocaleString()}）已在 ${date} ${METHOD[method]}付款。`);
    res.json({ success: true, id: pid, total });
  }));
  app.get(`${B}/payments`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const args = [tid]; let w = 'tenant_id=?';
    if (Number(q.entity_id)) { w += ' AND entity_id=?'; args.push(Number(q.entity_id)); } if (isDate(q.from)) { w += ' AND date>=?'; args.push(q.from); } if (isDate(q.to)) { w += ' AND date<=?'; args.push(q.to); }
    res.json({ rows: db.prepare(`SELECT * FROM ap_payments WHERE ${w} ORDER BY date DESC, id DESC LIMIT 300`).all(...args).map(p => ({ ...p, method_label: METHOD[p.method], items: db.prepare('SELECT i.amount,r.id,r.no,r.payee,r.title FROM ap_payment_items i JOIN ap_requests r ON r.id=i.request_id WHERE i.payment_id=?').all(p.id) })) });
  }));
  app.post(`${B}/payments/:id/void`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const p = db.prepare('SELECT * FROM ap_payments WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!p) throw err('找不到付款', 404);
    if (p.status !== 'posted') throw err('已經作廢了'); const reason = str(req.body?.reason, 200); if (!reason) throw err('請寫作廢原因');
    tx(() => {
      acct.voidBySource(tid, 'ap_payment', p.id, u, `付款作廢：${reason}`);
      db.prepare("UPDATE ap_payments SET status='void',void_by=?,void_at=?,void_reason=? WHERE id=?").run(by(u), now(), reason, p.id);
      for (const i of db.prepare('SELECT request_id FROM ap_payment_items WHERE payment_id=?').all(p.id)) { db.prepare("UPDATE ap_requests SET status='approved',payment_id=NULL,paid_at=NULL,updated_at=? WHERE id=? AND status='paid'").run(now(), i.request_id); log(tid, i.request_id, u, 'pay_void', reason); }
    })();
    res.json({ success: true });
  }));
  // 廠商
  function readVendor(b, cur = {}) {
    const name = str(b.name ?? cur.name, 60); if (!name) throw err('請填寫廠商名稱'); const tax = str(b.tax_id ?? cur.tax_id, 8); if (tax && !acct.validTaxId(tax)) throw err('廠商統一編號格式不正確');
    const bk = b.bank && typeof b.bank === 'object' ? b.bank : parse(cur.bank_json, {});
    return { name, tax_id: tax, category: str(b.category ?? cur.category, 20), contact: str(b.contact ?? cur.contact, 30), phone: str(b.phone ?? cur.phone, 30), email: str(b.email ?? cur.email, 80), address: str(b.address ?? cur.address, 120),
      bank: { bank: str(bk.bank, 40), code: str(bk.code, 10), branch: str(bk.branch, 40), account: str(bk.account, 30), name: str(bk.name, 60) }, default_account: str(b.default_account ?? cur.default_account, 12), terms_days: Math.max(0, Math.min(180, r0(b.terms_days ?? cur.terms_days ?? 30))), note: str(b.note ?? cur.note, 200) };
  }
  app.get(`${B}/vendors`, requireCompanyAdmin, needAcct, wrap((req, res) => { const tid = tenantId(req); res.json({ rows: db.prepare('SELECT * FROM ap_vendors WHERE tenant_id=? ORDER BY is_active DESC, name').all(tid).map(v => ({ ...v, bank: parse(v.bank_json, {}), unpaid: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ap_requests WHERE vendor_id=? AND status='approved'").get(v.id).s, ytd: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ap_requests WHERE vendor_id=? AND status IN ('approved','paid') AND substr(request_date,1,4)=?").get(v.id, todayTW().slice(0, 4)).s })) }); }));
  app.post(`${B}/vendors`, requireCompanyAdmin, wrap((req, res) => {
    const tid = tenantId(req); const x = readVendor(req.body || {}); if (x.tax_id && db.prepare('SELECT 1 FROM ap_vendors WHERE tenant_id=? AND tax_id=? AND is_active=1').get(tid, x.tax_id)) throw err('已經有相同統編的廠商');
    const id = Number(db.prepare('INSERT INTO ap_vendors (tenant_id,name,tax_id,category,contact,phone,email,address,bank_json,default_account,terms_days,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tid, x.name, x.tax_id, x.category, x.contact, x.phone, x.email, x.address, JSON.stringify(x.bank), x.default_account, x.terms_days, x.note, now(), now()).lastInsertRowid);
    res.json({ success: true, id });
  }));
  app.put(`${B}/vendors/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const v = db.prepare('SELECT * FROM ap_vendors WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!v) throw err('找不到廠商', 404);
    const x = readVendor(req.body || {}, v); const active = req.body?.is_active === undefined ? v.is_active : (req.body.is_active ? 1 : 0);
    db.prepare('UPDATE ap_vendors SET name=?,tax_id=?,category=?,contact=?,phone=?,email=?,address=?,bank_json=?,default_account=?,terms_days=?,note=?,is_active=?,updated_at=? WHERE id=?').run(x.name, x.tax_id, x.category, x.contact, x.phone, x.email, x.address, JSON.stringify(x.bank), x.default_account, x.terms_days, x.note, active, now(), v.id);
    res.json({ success: true });
  }));
  // 進項明細（401）
  app.get(`${B}/purchases`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const e = acct.entityOf(tid, q.entity_id || acct.entities(tid)[0]?.id);
    const from = isDate(q.from) ? q.from : `${todayTW().slice(0, 7)}-01`, to = isDate(q.to) ? q.to : todayTW();
    const rows = db.prepare("SELECT * FROM ap_requests WHERE tenant_id=? AND entity_id=? AND status IN ('approved','paid') AND deductible=1 AND COALESCE(NULLIF(invoice_date,''),request_date)>=? AND COALESCE(NULLIF(invoice_date,''),request_date)<=? ORDER BY invoice_date, invoice_no").all(tid, e.id, from, to)
      .map(r => ({ id: r.id, format: r.invoice_kind === 'e' ? '25' : '21', invoice_date: r.invoice_date || r.request_date, invoice_no: r.invoice_no, seller_tax_id: r.payee_tax_id, seller: r.payee, net: r.net, tax: r.tax, no: r.no, title: r.title }));
    const missing = rows.filter(r => !r.invoice_no || !r.seller_tax_id).map(r => r.no);
    const total = rows.reduce((s, r) => ({ net: s.net + r.net, tax: s.tax + r.tax }), { net: 0, tax: 0 });
    if (q.format === 'csv') {
      const csv = [['格式代號', '發票日期', '發票號碼', '賣方統編', '賣方', '金額', '稅額', '請款單號', '摘要'], ...rows.map(r => [r.format, r.invoice_date, r.invoice_no, r.seller_tax_id, r.seller, r.net, r.tax, r.no, r.title])].map(x => x.map(v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`進項明細_${e.short_name || e.name}_${from}_${to}`)}.csv`);
      return res.send(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(csv + '\r\n', 'utf8')]));
    }
    res.json({ entity: e, from, to, rows, total, missing });
  }));

  // ================= 社區回饋金 =================
  const FREQ_N = { monthly: 1, quarterly: 3, half: 6, yearly: 12, once: 0 };
  const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  function feedbackDue(tid, period) {
    const first = `${period}-01`, last = monthEnd(period); const outRows = [];
    for (const c of db.prepare("SELECT * FROM community_contracts WHERE tenant_id=? AND status='active' AND start_date<=? AND end_date>=?").all(tid, last, first)) {
      const diff = monthsBetween(c.start_date.slice(0, 7), period);
      for (const f of parse(c.feedback_json, [])) {
        if (f.type !== 'cash' || !(f.amount > 0)) continue; const n = FREQ_N[f.frequency] ?? 1;
        const due = n === 0 ? diff === 0 : (diff + 1) % n === 0; if (!due) continue;
        const key = `${c.id}:${f.name}:${period}`; const done = db.prepare("SELECT id,no,status FROM ap_requests WHERE tenant_id=? AND feedback_key=? AND status<>'void'").get(tid, key);
        outRows.push({ contract_id: c.id, community_id: c.community_id, community_name: commName(c.community_id), entity_id: c.entity_id, client: parse(c.client_json, {}), name: f.name, amount: f.amount, frequency: f.frequency, key, request: done || null });
      }
    }
    return outRows;
  }
  app.get(`${B}/feedback`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const period = isMonth(req.query?.period) ? req.query.period : todayTW().slice(0, 7);
    const rows = db.prepare("SELECT * FROM ap_requests WHERE tenant_id=? AND kind='feedback' ORDER BY request_date DESC, id DESC LIMIT 300").all(tid).map(r => out(r, getUser(req)));
    res.set('Cache-Control', 'no-store'); res.json({ period, due: feedbackDue(tid, period), rows });
  }));
  app.post(`${B}/feedback/generate`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const period = req.body?.period; if (!isMonth(period)) throw err('請選擇月份');
    const made = []; const t = todayTW(); const first = `${period}-01`, last = monthEnd(period); const reqDate = t < first ? first : t > last ? last : t;
    tx(() => {
      for (const f of feedbackDue(tid, period)) {
        if (f.request) continue;
        const x = readRequest(tid, { entity_id: f.entity_id, kind: 'feedback', payee: f.client.name || `${f.community_name}管理委員會`, payee_tax_id: f.client.tax_id || '', community_id: f.community_id, title: `${f.community_name} ${f.name}（${period}）`, items: [{ account: '', desc: `${f.name}（${period}）`, amount: f.amount, community_id: f.community_id }], invoice_kind: 'receipt', request_date: reqDate, due_date: monthEnd(period) });
        const id = insert(tid, x, u, { contract_id: f.contract_id, feedback_key: f.key }); log(tid, id, u, 'create', `依合約產生 ${period} 回饋金`); submit(db.prepare('SELECT * FROM ap_requests WHERE id=?').get(id), u); made.push(id);
      }
    })();
    res.json({ success: true, made });
  }));
  // 服務回饋（例如特清）：依合約列出今年應執行次數與已執行紀錄
  app.get(`${B}/feedback/services`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const y = /^\d{4}$/.test(req.query?.year || '') ? req.query.year : todayTW().slice(0, 4);
    const rows = [];
    for (const c of db.prepare("SELECT * FROM community_contracts WHERE tenant_id=? AND status='active' AND start_date<=? AND end_date>=?").all(tid, `${y}-12-31`, `${y}-01-01`)) {
      for (const f of parse(c.feedback_json, [])) {
        if (f.type !== 'service') continue;
        const logs = db.prepare("SELECT id,date,note,created_by FROM feedback_service_logs WHERE tenant_id=? AND contract_id=? AND item=? AND substr(date,1,4)=? ORDER BY date").all(tid, c.id, f.name, y);
        const per = f.times || ({ monthly: 12, quarterly: 4, half: 2, yearly: 1, once: 1 })[f.frequency] || 1;
        rows.push({ contract_id: c.id, community_id: c.community_id, community_name: commName(c.community_id), name: f.name, frequency: f.frequency, times: per, value: f.amount || 0, done: logs.length, logs, note: f.note || '' });
      }
    }
    res.json({ year: y, rows });
  }));
  app.post(`${B}/feedback/services`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const c = db.prepare('SELECT * FROM community_contracts WHERE id=? AND tenant_id=?').get(Number(b.contract_id), tid); if (!c) throw err('找不到合約');
    const item = str(b.item, 40); if (!parse(c.feedback_json, []).some(f => f.type === 'service' && f.name === item)) throw err('合約沒有這個回饋項目');
    if (!isDate(b.date)) throw err('請填寫執行日期');
    db.prepare('INSERT INTO feedback_service_logs (tenant_id,contract_id,item,date,note,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(tid, c.id, item, b.date, str(b.note, 200), by(u), now()); res.json({ success: true });
  }));
  app.delete(`${B}/feedback/services/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => { db.prepare('DELETE FROM feedback_service_logs WHERE id=? AND tenant_id=?').run(Number(req.params.id), tenantId(req)); res.json({ success: true }); }));

  // ================= 薪資入帳 =================
  const int = v => Math.round(Number(v) || 0);
  function payrollPlan(tid, run) {
    const ents = acct.entities(tid); const def = ents.find(e => e.is_default) || ents[0];
    const groups = new Map(); // entity -> Map(account|community -> {key,debit,credit,community_id})
    const add = (eid, key, side, amount, cid, memo) => { if (!amount) return; const g = groups.get(eid) || new Map(); groups.set(eid, g); const k = `${key}|${side}|${cid || 0}`; const x = g.get(k) || { key, side, amount: 0, community_id: cid || null, memo }; x.amount += amount; g.set(k, x); };
    const people = [];
    for (const it of db.prepare('SELECT * FROM payroll_items WHERE run_id=?').all(run.id)) {
      const dd = parse(it.data_json, {}); const u = staffRow(tid, it.staff_id); const m = u ? mi(u) : null;
      let cid = null; try { cid = u ? (getSiteAssignments(u)[0]?.community_id || null) : null; } catch {}
      const site = !!cid || ['site_manager', 'site_deputy', 'site_staff', 'mobile'].includes(m?.kind); if (m?.kind === 'mobile') cid = null;
      const c = cid && contracts ? contracts.activeFor(tid, cid, monthEnd(run.month)) : null; const eid = c?.entity_id && ents.some(e => e.id === c.entity_id) ? c.entity_id : def.id;
      const ee = dd.ins?.employee || {}, er = dd.ins?.employer || {};
      const salary = int(dd.gross) - int(dd.leave_deduct) - int(dd.attendance_deduct);
      const erIns = int(er.labor) + int(er.occupational) + int(er.health), erPen = int(er.pension);
      const eeIns = int(ee.labor) + int(ee.health), eePen = int(ee.pension_self); const adv = int(dd.advance_deduct); const other = int(dd.deductions_total ?? (dd.deductions || []).reduce((s, x) => s + int(x.amount), 0)) + int(dd.other_deduct);
      const net = salary - eeIns - eePen - adv - other;
      add(eid, site ? 'cost_salary' : 'exp_salary', 'debit', salary, cid, '薪資');
      add(eid, site ? 'cost_insurance' : 'exp_labor_insurance', 'debit', erIns, cid, '勞健保（公司負擔）');
      add(eid, site ? 'cost_pension' : 'exp_pension', 'debit', erPen, cid, '勞退提撥（公司 6%）');
      add(eid, 'salary_payable', 'credit', net, null, '應付薪資'); add(eid, 'insurance_payable', 'credit', eeIns + erIns, null, '應付勞健保'); add(eid, 'pension_payable', 'credit', eePen + erPen, null, '應付勞退');
      add(eid, 'staff_advance', 'credit', adv, null, '借資扣回'); add(eid, 'withholding', 'credit', other, null, '代扣款項');
      people.push({ name: it.name, entity_id: eid, community: commName(cid), site, salary, net });
    }
    return { groups, people, default_entity: def.id };
  }
  app.get(`${B}/payroll`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const runs = db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? ORDER BY month DESC LIMIT 24").all(tid);
    res.set('Cache-Control', 'no-store');
    res.json({ rows: runs.map(r => { const p = db.prepare('SELECT * FROM payroll_postings WHERE tenant_id=? AND run_id=?').get(tid, r.id); const plan = payrollPlan(tid, r); const ents = acct.entities(tid);
      const per = [...plan.groups.entries()].map(([eid, g]) => { const L = [...g.values()]; return { entity_id: eid, entity_name: ents.find(e => e.id === eid)?.short_name || ents.find(e => e.id === eid)?.name || '', debit: L.filter(x => x.side === 'debit').reduce((s, x) => s + x.amount, 0), net: L.filter(x => x.key === 'salary_payable').reduce((s, x) => s + x.amount, 0), people: plan.people.filter(x => x.entity_id === eid).length }; });
      return { run_id: r.id, month: r.month, status: r.status, published_at: r.published_at, posted_at: p?.posted_at || '', posted_by: p?.posted_by || '', paid_at: p?.paid_at || '', paid_by: p?.paid_by || '', entities: per, warning: p?.posted_at && r.status !== 'published' ? '薪資已撤回發布，請取消入帳後重新入帳' : '' }; }) });
  }));
  app.post(`${B}/payroll/:runId/post`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const run = db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(Number(req.params.runId), tid); if (!run) throw err('找不到薪資月份', 404);
    if (run.status !== 'published') throw err('薪資發布後才能入帳'); if (db.prepare('SELECT posted_at FROM payroll_postings WHERE tenant_id=? AND run_id=? AND posted_at IS NOT NULL').get(tid, run.id)) throw err('這個月份的薪資已經入帳');
    const plan = payrollPlan(tid, run); const date = monthEnd(run.month); const ids = [];
    tx(() => {
      for (const [eid, g] of plan.groups) { const lines = [...g.values()].filter(x => x.amount).map(x => ({ key: x.key, [x.side]: x.amount, memo: x.memo, community_id: x.community_id })); if (lines.length < 2) continue; ids.push(acct.post(tid, { entity_id: eid, date, summary: `${run.month} 薪資`, source: 'payroll', source_id: run.id, lines }, u).id); }
      db.prepare('INSERT INTO payroll_postings (tenant_id,run_id,month,posted_at,posted_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,run_id) DO UPDATE SET posted_at=excluded.posted_at,posted_by=excluded.posted_by,paid_at=NULL,paid_by=\'\'').run(tid, run.id, run.month, now(), by(u));
    })();
    res.json({ success: true, vouchers: ids });
  }));
  app.post(`${B}/payroll/:runId/pay`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const run = db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(Number(req.params.runId), tid); if (!run) throw err('找不到薪資月份', 404);
    const p = db.prepare('SELECT * FROM payroll_postings WHERE tenant_id=? AND run_id=?').get(tid, run.id); if (!p?.posted_at) throw err('請先入帳'); if (p.paid_at) throw err('已經登錄發薪了');
    const date = isDate(req.body?.date) ? req.body.date : todayTW(); const plan = payrollPlan(tid, run);
    tx(() => {
      for (const [eid, g] of plan.groups) { const net = [...g.values()].filter(x => x.key === 'salary_payable').reduce((s, x) => s + x.amount, 0); if (!net) continue; acct.post(tid, { entity_id: eid, date, summary: `${run.month} 發薪`, source: 'payroll', source_id: run.id, lines: [{ key: 'salary_payable', debit: net, memo: '發放薪資' }, { key: 'bank', credit: net, memo: '薪資轉帳' }] }, u); }
      db.prepare('UPDATE payroll_postings SET paid_at=?,paid_by=? WHERE tenant_id=? AND run_id=?').run(date, by(u), tid, run.id);
    })();
    res.json({ success: true });
  }));
  app.post(`${B}/payroll/:runId/unpost`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const run = db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(Number(req.params.runId), tid); if (!run) throw err('找不到薪資月份', 404);
    tx(() => { acct.voidBySource(tid, 'payroll', run.id, u, str(req.body?.reason, 200) || '取消薪資入帳'); db.prepare('DELETE FROM payroll_postings WHERE tenant_id=? AND run_id=?').run(tid, run.id); })();
    res.json({ success: true });
  }));

  function dashboard(tid, u) {
    const todo = db.prepare("SELECT * FROM ap_requests WHERE tenant_id=? AND status='pending'").all(tid).filter(r => canDecide(r, u)).length;
    const t = todayTW(); const ap = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s, COALESCE(SUM(CASE WHEN due_date<? THEN 1 ELSE 0 END),0) o FROM ap_requests WHERE tenant_id=? AND status='approved'").get(t, tid);
    return { todo, unpaid: ap.c, unpaid_amount: ap.s, overdue: ap.o };
  }
  return { dashboard };
};
