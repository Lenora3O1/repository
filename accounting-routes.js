// 公司會計基礎：簽約公司（公司別／統編）、會計科目、傳票（複式簿記）、月結關帳、帳冊報表、傳票匯出
// - 應收、應支、薪資等模組透過 post() 自動產生傳票；會計也可以手動開立。
// - 總後台：各公司的傳票匯出格式（配合會計師事務所的軟體）、發票模式與加值中心串接、應支審核關卡。
'use strict';
const C = require('./accounting-coa');

module.exports = function registerAccountingRoutes(app, d) {
  const { db, getUser, tenantId, now, requireCompanyAdmin, requireSuperAdmin, effectivePermissions, org } = d;
  let iconv = null; try { iconv = require('iconv-lite'); } catch {}
  const XLSX = d.XLSX || (() => { try { return require('xlsx'); } catch { return null; } })();

  db.exec(`
  CREATE TABLE IF NOT EXISTS acct_settings (tenant_id INTEGER PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT, updated_by TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS acct_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, short_name TEXT DEFAULT '', tax_id TEXT DEFAULT '', tax_reg_no TEXT DEFAULT '',
    owner TEXT DEFAULT '', address TEXT DEFAULT '', phone TEXT DEFAULT '', bank_json TEXT DEFAULT '[]', is_default INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS acct_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, sys_key TEXT DEFAULT '', note TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT, UNIQUE(tenant_id, code)
  );
  CREATE TABLE IF NOT EXISTS acct_vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, period TEXT NOT NULL, seq INTEGER NOT NULL, no TEXT NOT NULL, date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'transfer', summary TEXT DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', source_id INTEGER, status TEXT NOT NULL DEFAULT 'posted',
    total REAL NOT NULL DEFAULT 0, created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_by TEXT DEFAULT '', updated_at TEXT, void_by TEXT DEFAULT '', void_at TEXT, void_reason TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_acct_vouchers ON acct_vouchers(tenant_id, entity_id, date);
  CREATE INDEX IF NOT EXISTS idx_acct_vouchers_src ON acct_vouchers(tenant_id, source, source_id);
  CREATE TABLE IF NOT EXISTS acct_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, line_no INTEGER NOT NULL, account_id INTEGER NOT NULL,
    debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, memo TEXT DEFAULT '', community_id INTEGER, party TEXT DEFAULT '', party_tax_id TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_acct_lines ON acct_lines(voucher_id);
  CREATE INDEX IF NOT EXISTS idx_acct_lines_acc ON acct_lines(tenant_id, account_id);
  CREATE TABLE IF NOT EXISTS acct_periods (tenant_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, period TEXT NOT NULL, closed_at TEXT, closed_by TEXT DEFAULT '', PRIMARY KEY(tenant_id, entity_id, period));
  CREATE TABLE IF NOT EXISTS acct_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, actor TEXT DEFAULT '', action TEXT NOT NULL, target TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);

  // ---------- 小工具 ----------
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const money = v => Math.round((Number(v) || 0) * 100) / 100;
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => db.transaction(fn);
  const by = u => u?.name || u?.employee_id || '';
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const log = (tid, u, action, target, note = '') => db.prepare('INSERT INTO acct_logs (tenant_id,actor,action,target,note,created_at) VALUES (?,?,?,?,?,?)').run(tid, typeof u === 'string' ? u : by(u), action, String(target || ''), str(note, 300), now());
  const commName = id => id ? (db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '') : '';

  // ---------- 權限 ----------
  function perms(u) { const s = new Set(); try { for (const k of effectivePermissions(u) || []) s.add(k); } catch {} const m = mi(u); for (const k of m?.position?.perms || []) s.add(k); return s; }
  const isBoss = u => u?.role === 'company_admin' || ['owner', 'gm'].includes(mi(u)?.kind);
  function canAcct(u) { if (!u) return false; if (isBoss(u)) return true; const p = perms(u); return p.has('company-accounting') || p.has('company-finance'); }
  const needAcct = (req, res, next) => { if (!canAcct(getUser(req))) return bad(res, '需要「會計」權限', 403); next(); };

  // ---------- 總後台設定 ----------
  const DEFAULT_FLOW = [
    { name: '總經理', by: 'kind', value: 'gm', min_amount: 0 },
    { name: '老闆', by: 'kind', value: 'owner', min_amount: 50000 },
  ];
  const PROVIDERS = { ecpay: '綠界科技 ECPay', amego: '光貿 Amego', ezpay: '藍新 ezPay', other: '其他加值中心' };
  function normFormat(key, x) {
    const p = C.PRESETS[key] || C.PRESETS.generic; x = x && typeof x === 'object' ? x : {};
    const columns = (Array.isArray(x.columns) ? x.columns : p.columns).filter(k => C.FIELDS[k]).slice(0, 30);
    const map = {}; for (const [a, b] of Object.entries(x.code_map && typeof x.code_map === 'object' ? x.code_map : {})) { const k = str(a, 20), v = str(b, 30); if (k && v) map[k] = v; }
    return { name: str(x.name, 30) || p.name, columns: columns.length ? columns : p.columns, date: C.DATE_FORMATS[x.date] ? x.date : p.date, dc_style: C.DC_STYLES[x.dc_style] ? x.dc_style : p.dc_style,
      encoding: C.ENCODINGS[x.encoding] ? x.encoding : p.encoding, file: ['csv', 'xlsx'].includes(x.file) ? x.file : p.file, header: x.header === undefined ? p.header : !!x.header, code_map: map };
  }
  function normalize(c) {
    c = c && typeof c === 'object' ? c : {};
    const f = c.formats && typeof c.formats === 'object' ? c.formats : {};
    const enabled = [...new Set((Array.isArray(f.enabled) ? f.enabled : ['generic', 'excel']).filter(k => C.PRESETS[k]))];
    const custom = {}; for (const k of Object.keys(C.PRESETS)) custom[k] = normFormat(k, f.custom?.[k]);
    const inv = c.invoice && typeof c.invoice === 'object' ? c.invoice : {};
    const flow = (Array.isArray(c.ap_flow) ? c.ap_flow : DEFAULT_FLOW).map(s => ({ name: str(s?.name, 20), by: ['perm', 'kind', 'position'].includes(s?.by) ? s.by : 'kind', value: str(s?.value, 40), min_amount: Math.max(0, Math.round(Number(s?.min_amount) || 0)) })).filter(s => s.name && s.value).slice(0, 8);
    return {
      formats: { enabled: enabled.length ? enabled : ['generic'], default: enabled.includes(f.default) ? f.default : (enabled[0] || 'generic'), custom },
      invoice: { mode: ['manual', 'einvoice', 'both'].includes(inv.mode) ? inv.mode : 'manual', einvoice_enabled: !!inv.einvoice_enabled, provider: PROVIDERS[inv.provider] ? inv.provider : '', test_mode: inv.test_mode === undefined ? true : !!inv.test_mode,
        merchant_id: str(inv.merchant_id, 40), hash_key: str(inv.hash_key, 80), hash_iv: str(inv.hash_iv, 80), app_key: str(inv.app_key, 120), tax_rate: 5 },
      ap_flow: flow.length ? flow : DEFAULT_FLOW.map(x => ({ ...x })),
      ap_require_tax_id: c.ap_require_tax_id === undefined ? true : !!c.ap_require_tax_id,
    };
  }
  function settingsFor(tid) { const r = db.prepare('SELECT config_json FROM acct_settings WHERE tenant_id=?').get(tid); return normalize(r ? parse(r.config_json, {}) : null); }
  const mask = v => v ? `${'•'.repeat(Math.max(0, Math.min(8, v.length - 4)))}${v.slice(-4)}` : '';
  function publicSettings(s, { secrets = false } = {}) {
    const inv = { ...s.invoice }; if (!secrets) { inv.hash_key = mask(inv.hash_key); inv.hash_iv = mask(inv.hash_iv); inv.app_key = mask(inv.app_key); }
    return { ...s, invoice: inv };
  }

  // ---------- 簽約公司（公司別） ----------
  function entities(tid, { all = false } = {}) {
    let rows = db.prepare(`SELECT * FROM acct_entities WHERE tenant_id=? ${all ? '' : 'AND is_active=1'} ORDER BY is_default DESC, id`).all(tid);
    if (!rows.length && !all) {
      const t = db.prepare('SELECT name FROM tenants WHERE id=?').get(tid);
      db.prepare('INSERT INTO acct_entities (tenant_id,name,is_default,created_at,updated_at) VALUES (?,?,1,?,?)').run(tid, t?.name || '本公司', now(), now());
      rows = db.prepare('SELECT * FROM acct_entities WHERE tenant_id=? AND is_active=1 ORDER BY is_default DESC, id').all(tid);
    }
    return rows.map(e => ({ id: e.id, name: e.name, short_name: e.short_name, tax_id: e.tax_id, tax_reg_no: e.tax_reg_no, owner: e.owner, address: e.address, phone: e.phone, banks: parse(e.bank_json, []), is_default: !!e.is_default, is_active: !!e.is_active }));
  }
  function entityOf(tid, id) { const e = entities(tid).find(x => x.id === Number(id)); if (!e) throw err('請選擇簽約公司'); return e; }

  // ---------- 會計科目 ----------
  function ensureAccounts(tid) {
    if (db.prepare('SELECT 1 FROM acct_accounts WHERE tenant_id=? LIMIT 1').get(tid)) return;
    const ins = db.prepare('INSERT OR IGNORE INTO acct_accounts (tenant_id,code,name,type,sys_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
    tx(() => { for (const [code, name, type, key] of C.ACCOUNTS) ins.run(tid, code, name, type, key, now(), now()); })();
  }
  function accounts(tid, { all = true } = {}) { ensureAccounts(tid); return db.prepare(`SELECT * FROM acct_accounts WHERE tenant_id=? ${all ? '' : 'AND is_active=1'} ORDER BY code`).all(tid); }
  function accountBy(tid, ref) {
    ensureAccounts(tid); const r = String(ref || '');
    return db.prepare('SELECT * FROM acct_accounts WHERE tenant_id=? AND (code=? OR (sys_key<>\'\' AND sys_key=?))').get(tid, r, r) || (Number(ref) ? db.prepare('SELECT * FROM acct_accounts WHERE tenant_id=? AND id=?').get(tid, Number(ref)) : null);
  }

  // ---------- 月結 ----------
  const isClosed = (tid, eid, period) => !!db.prepare('SELECT closed_at FROM acct_periods WHERE tenant_id=? AND entity_id=? AND period=? AND closed_at IS NOT NULL').get(tid, eid, period);
  function assertOpen(tid, eid, date) { const p = String(date).slice(0, 7); if (isClosed(tid, eid, p)) throw err(`${p} 已經月結關帳，不能新增或修改傳票（請開調整傳票到下個月，或請公司管理員重新開帳）`); }

  // ---------- 傳票 ----------
  const TYPE = { receipt: '收入傳票', payment: '支出傳票', transfer: '轉帳傳票' };
  const SOURCE = { manual: '手動開立', ar: '公司應收', ar_receipt: '應收收款', ap: '公司應支', ap_payment: '應支付款', payroll: '薪資', feedback: '社區回饋金', adjust: '調整' };
  function readLines(tid, lines) {
    if (!Array.isArray(lines) || lines.length < 2) throw err('傳票至少要有兩筆分錄（借方和貸方）');
    if (lines.length > 200) throw err('分錄太多了');
    const out = []; let dr = 0, cr = 0;
    for (const [i, l] of lines.entries()) {
      const a = accountBy(tid, l.account_id || l.code || l.key); if (!a) throw err(`第 ${i + 1} 筆分錄的會計科目不存在（${l.code || l.key || l.account_id || '空白'}）`);
      if (!a.is_active) throw err(`會計科目 ${a.code} ${a.name} 已停用`);
      const debit = money(l.debit), credit = money(l.credit);
      if (debit < 0 || credit < 0) throw err('金額不能是負數'); if (debit && credit) throw err(`第 ${i + 1} 筆分錄同時有借方和貸方，請分成兩筆`);
      if (!debit && !credit) continue;
      dr += debit; cr += credit;
      out.push({ account_id: a.id, code: a.code, sys_key: a.sys_key, debit, credit, memo: str(l.memo, 120), community_id: Number(l.community_id) || null, party: str(l.party, 60), party_tax_id: str(l.party_tax_id, 10) });
    }
    if (out.length < 2) throw err('傳票至少要有兩筆有金額的分錄');
    if (Math.abs(money(dr) - money(cr)) > 0.004) throw err(`借貸不平衡：借方 ${money(dr).toLocaleString()}、貸方 ${money(cr).toLocaleString()}`);
    return { lines: out, total: money(dr) };
  }
  // 收入／支出／轉帳傳票：只有現金（銀行）在借方 → 收入；只有在貸方 → 支出；其他 → 轉帳
  function typeOf(lines) {
    const cash = l => ['cash', 'petty_cash', 'bank'].includes(l.sys_key);
    const cd = lines.some(l => cash(l) && l.debit), cc = lines.some(l => cash(l) && l.credit);
    if (cd && !cc && lines.filter(l => l.debit).every(cash)) return 'receipt';
    if (cc && !cd && lines.filter(l => l.credit).every(cash)) return 'payment';
    return 'transfer';
  }
  function nextNo(tid, eid, period) { const r = db.prepare('SELECT MAX(seq) m FROM acct_vouchers WHERE tenant_id=? AND entity_id=? AND period=?').get(tid, eid, period); const seq = (r?.m || 0) + 1; return { seq, no: `${period.replace('-', '')}${String(seq).padStart(4, '0')}` }; }
  function writeLines(vid, tid, lines) {
    const ins = db.prepare('INSERT INTO acct_lines (voucher_id,tenant_id,line_no,account_id,debit,credit,memo,community_id,party,party_tax_id) VALUES (?,?,?,?,?,?,?,?,?,?)');
    lines.forEach((l, i) => ins.run(vid, tid, i + 1, l.account_id, l.debit, l.credit, l.memo, l.community_id, l.party, l.party_tax_id));
  }
  // 其他模組自動入帳用：post(tid, { entity_id, date, summary, source, source_id, lines:[{key|code, debit, credit, memo, community_id, party}] }, actor)
  function post(tid, v, actor) {
    const e = entityOf(tid, v.entity_id); if (!isDate(v.date)) throw err('請填寫傳票日期'); assertOpen(tid, e.id, v.date);
    const { lines, total } = readLines(tid, v.lines); const period = v.date.slice(0, 7);
    let id;
    tx(() => {
      const n = nextNo(tid, e.id, period);
      id = Number(db.prepare('INSERT INTO acct_vouchers (tenant_id,entity_id,period,seq,no,date,type,summary,source,source_id,status,total,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(tid, e.id, period, n.seq, n.no, v.date, typeOf(lines), str(v.summary, 200), SOURCE[v.source] ? v.source : 'manual', v.source_id || null, 'posted', total, typeof actor === 'string' ? actor : by(actor), now(), now()).lastInsertRowid);
      writeLines(id, tid, lines);
    })();
    return voucher(tid, id);
  }
  // 來源單據作廢時，對應的傳票一起作廢（已關帳的月份改開沖銷傳票）
  function voidBySource(tid, source, sourceId, actor, reason) {
    const rows = db.prepare("SELECT * FROM acct_vouchers WHERE tenant_id=? AND source=? AND source_id=? AND status='posted'").all(tid, source, sourceId);
    for (const v of rows) {
      if (!isClosed(tid, v.entity_id, v.period)) { db.prepare("UPDATE acct_vouchers SET status='void',void_by=?,void_at=?,void_reason=? WHERE id=?").run(typeof actor === 'string' ? actor : by(actor), now(), str(reason, 200), v.id); continue; }
      const lines = db.prepare('SELECT * FROM acct_lines WHERE voucher_id=? ORDER BY line_no').all(v.id).map(l => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo, community_id: l.community_id, party: l.party, party_tax_id: l.party_tax_id }));
      post(tid, { entity_id: v.entity_id, date: todayTW(), summary: `沖銷 ${v.no}：${reason || ''}`.slice(0, 200), source: 'adjust', source_id: v.id, lines }, actor);
    }
  }
  function voucher(tid, id) {
    const v = db.prepare('SELECT * FROM acct_vouchers WHERE id=? AND tenant_id=?').get(id, tid); if (!v) return null;
    const lines = db.prepare('SELECT l.*,a.code,a.name account_name,a.type account_type FROM acct_lines l JOIN acct_accounts a ON a.id=l.account_id WHERE l.voucher_id=? ORDER BY l.line_no').all(id)
      .map(l => ({ line_no: l.line_no, account_id: l.account_id, code: l.code, account_name: l.account_name, debit: l.debit, credit: l.credit, memo: l.memo, community_id: l.community_id, community_name: commName(l.community_id), party: l.party, party_tax_id: l.party_tax_id }));
    return { id: v.id, entity_id: v.entity_id, no: v.no, date: v.date, period: v.period, type: v.type, type_label: TYPE[v.type], summary: v.summary, source: v.source, source_label: SOURCE[v.source] || v.source, source_id: v.source_id,
      status: v.status, total: v.total, created_by: v.created_by, created_at: v.created_at, updated_by: v.updated_by, updated_at: v.updated_at, void_by: v.void_by, void_at: v.void_at, void_reason: v.void_reason,
      closed: isClosed(tid, v.entity_id, v.period), editable: v.source === 'manual' && v.status === 'posted' && !isClosed(tid, v.entity_id, v.period), lines };
  }

  // ---------- 報表 ----------
  // 科目在期間內的借貸合計（已過帳、未作廢）
  function sums(tid, eid, from, to, { byCommunity = false } = {}) {
    const args = [tid, eid]; let w = "v.tenant_id=? AND v.entity_id=? AND v.status='posted'";
    if (from) { w += ' AND v.date>=?'; args.push(from); } if (to) { w += ' AND v.date<=?'; args.push(to); }
    return db.prepare(`SELECT l.account_id${byCommunity ? ',l.community_id' : ''}, SUM(l.debit) dr, SUM(l.credit) cr FROM acct_lines l JOIN acct_vouchers v ON v.id=l.voucher_id WHERE ${w} GROUP BY l.account_id${byCommunity ? ',l.community_id' : ''}`).all(...args);
  }
  const dayBefore = s => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const signed = (a, dr, cr) => C.DEBIT_NORMAL.has(a.type) ? money(dr - cr) : money(cr - dr);
  const PL_TYPES = ['revenue', 'cost', 'expense', 'other_income', 'other_expense', 'tax'];
  function trial(tid, eid, from, to) {
    const accs = accounts(tid); const open = new Map(sums(tid, eid, null, dayBefore(from)).map(r => [r.account_id, r])); const cur = new Map(sums(tid, eid, from, to).map(r => [r.account_id, r]));
    const yearStart = `${from.slice(0, 4)}-01-01`; const yopen = new Map(from > yearStart ? sums(tid, eid, yearStart, dayBefore(from)).map(r => [r.account_id, r]) : []);
    const rows = accs.map(a => {
      // 損益科目的期初只從當年度 1/1 起算
      const o = PL_TYPES.includes(a.type) ? yopen.get(a.id) : open.get(a.id);
      const odr = o?.dr || 0, ocr = o?.cr || 0, dr = cur.get(a.id)?.dr || 0, cr = cur.get(a.id)?.cr || 0;
      const opening = signed(a, odr, ocr), closing = signed(a, odr + dr, ocr + cr);
      return { account_id: a.id, code: a.code, name: a.name, type: a.type, type_label: C.TYPES[a.type], opening, debit: money(dr), credit: money(cr), closing, active: !!a.is_active };
    }).filter(r => r.opening || r.debit || r.credit || r.closing);
    const tot = rows.reduce((s, r) => ({ debit: money(s.debit + r.debit), credit: money(s.credit + r.credit) }), { debit: 0, credit: 0 });
    return { from, to, rows, total: tot, balanced: Math.abs(tot.debit - tot.credit) < 0.01 };
  }
  function ledger(tid, eid, accountId, from, to) {
    const a = db.prepare('SELECT * FROM acct_accounts WHERE id=? AND tenant_id=?').get(Number(accountId), tid); if (!a) throw err('找不到會計科目', 404);
    const ostart = PL_TYPES.includes(a.type) ? `${from.slice(0, 4)}-01-01` : null;
    const o = sums(tid, eid, ostart, dayBefore(from)).find(r => r.account_id === a.id); let bal = signed(a, o?.dr || 0, o?.cr || 0); const opening = bal;
    const rows = db.prepare("SELECT v.id vid,v.no,v.date,v.summary,v.source,l.debit,l.credit,l.memo,l.community_id,l.party FROM acct_lines l JOIN acct_vouchers v ON v.id=l.voucher_id WHERE l.tenant_id=? AND l.account_id=? AND v.entity_id=? AND v.status='posted' AND v.date>=? AND v.date<=? ORDER BY v.date,v.no,l.line_no")
      .all(tid, a.id, eid, from, to).map(r => { bal = money(bal + (C.DEBIT_NORMAL.has(a.type) ? r.debit - r.credit : r.credit - r.debit)); return { voucher_id: r.vid, no: r.no, date: r.date, summary: r.memo || r.summary, community_name: commName(r.community_id), party: r.party, debit: r.debit, credit: r.credit, balance: bal }; });
    return { account: { id: a.id, code: a.code, name: a.name, type: a.type, type_label: C.TYPES[a.type] }, from, to, opening, rows, closing: bal, debit: money(rows.reduce((s, r) => s + r.debit, 0)), credit: money(rows.reduce((s, r) => s + r.credit, 0)) };
  }
  function income(tid, eid, from, to, byCommunity) {
    const accs = new Map(accounts(tid).map(a => [a.id, a])); const rows = sums(tid, eid, from, to, { byCommunity: true });
    const cols = byCommunity ? [...new Set(rows.map(r => r.community_id || 0))].sort((a, b) => a - b) : [];
    const sec = {}; for (const t of PL_TYPES) sec[t] = new Map();
    for (const r of rows) { const a = accs.get(r.account_id); if (!a || !PL_TYPES.includes(a.type)) continue; const m = sec[a.type]; const x = m.get(a.id) || { code: a.code, name: a.name, total: 0, by: {} }; const v = signed(a, r.dr, r.cr); x.total = money(x.total + v); const k = r.community_id || 0; x.by[k] = money((x.by[k] || 0) + v); m.set(a.id, x); }
    const list = t => [...sec[t].values()].sort((a, b) => a.code.localeCompare(b.code));
    const sum = (t, k) => money(list(t).reduce((s, x) => s + (k === undefined ? x.total : (x.by[k] || 0)), 0));
    const calc = k => { const rev = sum('revenue', k), cost = sum('cost', k), exp = sum('expense', k), oi = sum('other_income', k), oe = sum('other_expense', k), tax = sum('tax', k); const gross = money(rev - cost), op = money(gross - exp), pre = money(op + oi - oe); return { revenue: rev, cost, gross, expense: exp, operating: op, other_income: oi, other_expense: oe, pretax: pre, tax, net: money(pre - tax) }; };
    return { from, to, sections: Object.fromEntries(PL_TYPES.map(t => [t, list(t)])), totals: calc(), columns: cols.map(k => ({ id: k, name: k ? commName(k) : '公司（未分社區）', totals: calc(k) })), by_community: !!byCommunity };
  }
  function balance(tid, eid, date) {
    const accs = new Map(accounts(tid).map(a => [a.id, a])); const all = sums(tid, eid, null, date); const yearStart = `${date.slice(0, 4)}-01-01`;
    const out = { asset: [], liability: [], equity: [] }; let plAll = 0, plYear = 0;
    const yr = new Map(sums(tid, eid, yearStart, date).map(r => [r.account_id, r]));
    for (const r of all) {
      const a = accs.get(r.account_id); if (!a) continue;
      if (PL_TYPES.includes(a.type)) { const v = money(r.cr - r.dr); plAll += v; const y = yr.get(a.id); if (y) plYear += money(y.cr - y.dr); continue; }
      const v = signed(a, r.dr, r.cr); if (v) out[a.type].push({ code: a.code, name: a.name, amount: v });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.code.localeCompare(b.code));
    const prior = money(plAll - plYear);
    if (prior) out.equity.push({ code: '', name: '累積盈虧（以前年度損益）', amount: prior, computed: true });
    out.equity.push({ code: '', name: '本期損益', amount: money(plYear), computed: true });
    const t = k => money(out[k].reduce((s, x) => s + x.amount, 0));
    return { date, ...out, total_asset: t('asset'), total_liability: t('liability'), total_equity: t('equity'), balanced: Math.abs(t('asset') - t('liability') - t('equity')) < 0.01 };
  }

  // ---------- 傳票匯出 ----------
  function exportRows(tid, eid, from, to, fmt) {
    const e = entityOf(tid, eid); const dmap = fmt.code_map || {};
    const vs = db.prepare("SELECT id FROM acct_vouchers WHERE tenant_id=? AND entity_id=? AND status='posted' AND date>=? AND date<=? ORDER BY date,no").all(tid, e.id, from, to).map(x => voucher(tid, x.id));
    const rows = [];
    for (const v of vs) for (const l of v.lines) {
      const isD = l.debit > 0; const amt = isD ? l.debit : l.credit;
      const F = { date: C.fmtDate(v.date, fmt.date), no: v.no, type: v.type_label, seq: l.line_no, code: dmap[l.code] || l.code, name: l.account_name, summary: v.summary, memo: l.memo || v.summary,
        debit: fmt.dc_style === 'columns' ? (l.debit || '') : '', credit: fmt.dc_style === 'columns' ? (l.credit || '') : '',
        dc: { flag12: isD ? '1' : '2', flag_cn: isD ? '借' : '貸', flag_dc: isD ? 'D' : 'C', signed: '', columns: isD ? '借' : '貸' }[fmt.dc_style],
        amount: fmt.dc_style === 'signed' ? (isD ? amt : -amt) : amt, dept: l.community_id ? String(l.community_id) : '', dept_name: l.community_name, party: l.party, party_tax_id: l.party_tax_id, entity_tax_id: e.tax_id };
      rows.push(fmt.columns.map(k => F[k] ?? ''));
    }
    return { entity: e, count: vs.length, header: fmt.columns.map(k => C.FIELDS[k]), rows };
  }
  const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  // ================= 路由：公司會計 =================
  const B = '/api/company/acct';
  app.get(`${B}/meta`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const s = settingsFor(tid);
    res.set('Cache-Control', 'no-store');
    res.json({ entities: entities(tid), accounts: accounts(tid).map(a => ({ id: a.id, code: a.code, name: a.name, type: a.type, sys_key: a.sys_key, is_active: !!a.is_active, note: a.note })), types: C.TYPES,
      communities: db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid),
      formats: s.formats.enabled.map(k => ({ key: k, name: s.formats.custom[k].name, file: s.formats.custom[k].file })), default_format: s.formats.default,
      invoice_mode: s.invoice.mode, sources: SOURCE, voucher_types: TYPE, today: todayTW(), is_admin: u.role === 'company_admin' });
  }));
  // 簽約公司
  function readEntity(b) {
    const name = str(b.name, 60); if (!name) throw err('請填寫公司名稱');
    const tax = str(b.tax_id, 8); if (tax && !C.validTaxId(tax)) throw err('統一編號格式不正確，請再確認');
    const banks = (Array.isArray(b.banks) ? b.banks : []).map(x => ({ bank: str(x?.bank, 40), branch: str(x?.branch, 40), account: str(x?.account, 30), name: str(x?.name, 60), code: str(x?.code, 10) })).filter(x => x.bank || x.account).slice(0, 10);
    return { name, short_name: str(b.short_name, 20), tax_id: tax, tax_reg_no: str(b.tax_reg_no, 20), owner: str(b.owner, 30), address: str(b.address, 120), phone: str(b.phone, 30), banks };
  }
  app.get(`${B}/entities`, requireCompanyAdmin, needAcct, wrap((req, res) => res.json({ rows: entities(tenantId(req), { all: true }) })));
  app.post(`${B}/entities`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const x = readEntity(req.body || {});
    if (x.tax_id && db.prepare('SELECT 1 FROM acct_entities WHERE tenant_id=? AND tax_id=? AND is_active=1').get(tid, x.tax_id)) throw err('已經有相同統編的公司');
    const id = Number(db.prepare('INSERT INTO acct_entities (tenant_id,name,short_name,tax_id,tax_reg_no,owner,address,phone,bank_json,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tid, x.name, x.short_name, x.tax_id, x.tax_reg_no, x.owner, x.address, x.phone, JSON.stringify(x.banks), db.prepare('SELECT 1 FROM acct_entities WHERE tenant_id=?').get(tid) ? 0 : 1, now(), now()).lastInsertRowid);
    log(tid, getUser(req), 'entity_add', id, x.name); res.json({ success: true, id });
  }));
  app.put(`${B}/entities/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const e = db.prepare('SELECT * FROM acct_entities WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!e) throw err('找不到這家公司', 404);
    const b = req.body || {};
    if (b.is_active === false) {
      if (e.is_default) throw err('預設公司不能停用，請先把別家設為預設');
      e.is_active = 0; db.prepare('UPDATE acct_entities SET is_active=0,updated_at=? WHERE id=?').run(now(), e.id); return res.json({ success: true });
    }
    const x = readEntity({ ...e, banks: parse(e.bank_json, []), ...b });
    if (x.tax_id && db.prepare('SELECT 1 FROM acct_entities WHERE tenant_id=? AND tax_id=? AND is_active=1 AND id<>?').get(tid, x.tax_id, e.id)) throw err('已經有相同統編的公司');
    tx(() => {
      db.prepare('UPDATE acct_entities SET name=?,short_name=?,tax_id=?,tax_reg_no=?,owner=?,address=?,phone=?,bank_json=?,is_active=1,updated_at=? WHERE id=?').run(x.name, x.short_name, x.tax_id, x.tax_reg_no, x.owner, x.address, x.phone, JSON.stringify(x.banks), now(), e.id);
      if (b.is_default) { db.prepare('UPDATE acct_entities SET is_default=0 WHERE tenant_id=?').run(tid); db.prepare('UPDATE acct_entities SET is_default=1 WHERE id=?').run(e.id); }
    })();
    log(tid, getUser(req), 'entity_edit', e.id, x.name); res.json({ success: true });
  }));
  // 會計科目
  app.post(`${B}/accounts`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); ensureAccounts(tid); const b = req.body || {};
    const code = str(b.code, 12), name = str(b.name, 40); if (!/^[0-9A-Za-z-]{2,12}$/.test(code)) throw err('科目代號請用 2～12 碼數字或英文'); if (!name) throw err('請填寫科目名稱');
    if (!C.TYPES[b.type]) throw err('請選擇科目類別');
    if (db.prepare('SELECT 1 FROM acct_accounts WHERE tenant_id=? AND code=?').get(tid, code)) throw err(`科目代號 ${code} 已經有了`);
    const id = Number(db.prepare('INSERT INTO acct_accounts (tenant_id,code,name,type,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(tid, code, name, b.type, str(b.note, 100), now(), now()).lastInsertRowid);
    log(tid, getUser(req), 'account_add', code, name); res.json({ success: true, id });
  }));
  app.put(`${B}/accounts/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const a = db.prepare('SELECT * FROM acct_accounts WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!a) throw err('找不到會計科目', 404);
    const b = req.body || {}; const used = !!db.prepare('SELECT 1 FROM acct_lines WHERE account_id=? LIMIT 1').get(a.id);
    const code = b.code !== undefined ? str(b.code, 12) : a.code, name = b.name !== undefined ? str(b.name, 40) : a.name, type = b.type !== undefined ? b.type : a.type;
    if (!/^[0-9A-Za-z-]{2,12}$/.test(code)) throw err('科目代號請用 2～12 碼數字或英文'); if (!name) throw err('請填寫科目名稱'); if (!C.TYPES[type]) throw err('請選擇科目類別');
    if (type !== a.type && used) throw err('這個科目已經有傳票使用，不能改類別（可以停用後另開新科目）');
    if (code !== a.code && db.prepare('SELECT 1 FROM acct_accounts WHERE tenant_id=? AND code=? AND id<>?').get(tid, code, a.id)) throw err(`科目代號 ${code} 已經有了`);
    const active = b.is_active === undefined ? a.is_active : (b.is_active ? 1 : 0);
    if (!active && a.sys_key && ['ar', 'ap', 'bank', 'cash', 'output_vat', 'input_vat'].includes(a.sys_key)) throw err('這是系統自動入帳要用的科目，不能停用');
    db.prepare('UPDATE acct_accounts SET code=?,name=?,type=?,note=?,is_active=?,updated_at=? WHERE id=?').run(code, name, type, b.note !== undefined ? str(b.note, 100) : a.note, active, now(), a.id);
    log(tid, getUser(req), 'account_edit', code, `${a.code} ${a.name} → ${code} ${name}${active ? '' : '（停用）'}`); res.json({ success: true });
  }));
  // 傳票
  app.get(`${B}/vouchers`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const e = entityOf(tid, q.entity_id || entities(tid)[0]?.id);
    const args = [tid, e.id]; let w = 'tenant_id=? AND entity_id=?';
    if (isDate(q.from)) { w += ' AND date>=?'; args.push(q.from); } if (isDate(q.to)) { w += ' AND date<=?'; args.push(q.to); }
    if (SOURCE[q.source]) { w += ' AND source=?'; args.push(q.source); } if (q.status === 'void') w += " AND status='void'"; else if (q.status !== 'all') w += " AND status='posted'";
    if (q.q) { w += ' AND (no LIKE ? OR summary LIKE ? OR id IN (SELECT voucher_id FROM acct_lines WHERE tenant_id=? AND (memo LIKE ? OR party LIKE ?)))'; const k = `%${str(q.q, 40)}%`; args.push(k, k, tid, k, k); }
    const rows = db.prepare(`SELECT id FROM acct_vouchers WHERE ${w} ORDER BY date DESC, no DESC LIMIT 500`).all(...args).map(x => voucher(tid, x.id));
    res.set('Cache-Control', 'no-store'); res.json({ entity_id: e.id, rows });
  }));
  app.get(`${B}/vouchers/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => { const v = voucher(tenantId(req), Number(req.params.id)); if (!v) throw err('找不到傳票', 404); res.json({ voucher: v, logs: db.prepare("SELECT actor,action,note,created_at FROM acct_logs WHERE tenant_id=? AND target=? AND action LIKE 'voucher%' ORDER BY id").all(tenantId(req), `v${v.id}`) }); }));
  app.post(`${B}/vouchers`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {};
    const v = post(tid, { entity_id: b.entity_id, date: b.date, summary: b.summary, source: 'manual', lines: b.lines }, u);
    log(tid, u, 'voucher_add', `v${v.id}`, `${v.no} ${v.summary} ${v.total}`); res.json({ success: true, voucher: v });
  }));
  app.put(`${B}/vouchers/:id`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const v0 = voucher(tid, Number(req.params.id)); if (!v0) throw err('找不到傳票', 404);
    if (v0.source !== 'manual') throw err(`這張傳票是「${v0.source_label}」自動產生的，請到原單據修改`);
    if (v0.status !== 'posted') throw err('已作廢的傳票不能修改');
    const b = req.body || {}; const date = isDate(b.date) ? b.date : v0.date;
    assertOpen(tid, v0.entity_id, v0.date); assertOpen(tid, v0.entity_id, date);
    if (date.slice(0, 7) !== v0.period) throw err('不能改到其他月份，請作廢後重新開立');
    const { lines, total } = readLines(tid, b.lines || v0.lines);
    tx(() => {
      db.prepare('UPDATE acct_vouchers SET date=?,summary=?,type=?,total=?,updated_by=?,updated_at=? WHERE id=?').run(date, b.summary !== undefined ? str(b.summary, 200) : v0.summary, typeOf(lines), total, by(u), now(), v0.id);
      db.prepare('DELETE FROM acct_lines WHERE voucher_id=?').run(v0.id); writeLines(v0.id, tid, lines);
    })();
    log(tid, u, 'voucher_edit', `v${v0.id}`, `${v0.no} 金額 ${v0.total} → ${total}`); res.json({ success: true, voucher: voucher(tid, v0.id) });
  }));
  app.post(`${B}/vouchers/:id/void`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const v = voucher(tid, Number(req.params.id)); if (!v) throw err('找不到傳票', 404);
    if (v.source !== 'manual' && v.source !== 'adjust') throw err(`這張傳票是「${v.source_label}」自動產生的，請到原單據作廢或沖銷`);
    if (v.status !== 'posted') throw err('已經作廢了'); assertOpen(tid, v.entity_id, v.date);
    const reason = str(req.body?.reason, 200); if (!reason) throw err('請寫作廢原因');
    db.prepare("UPDATE acct_vouchers SET status='void',void_by=?,void_at=?,void_reason=? WHERE id=?").run(by(u), now(), reason, v.id);
    log(tid, u, 'voucher_void', `v${v.id}`, `${v.no}：${reason}`); res.json({ success: true });
  }));
  // 月結
  app.get(`${B}/periods`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const e = entityOf(tid, req.query?.entity_id || entities(tid)[0]?.id); const y = /^\d{4}$/.test(req.query?.year || '') ? req.query.year : todayTW().slice(0, 4);
    const rows = []; for (let m = 1; m <= 12; m++) { const p = `${y}-${String(m).padStart(2, '0')}`; const c = db.prepare('SELECT * FROM acct_periods WHERE tenant_id=? AND entity_id=? AND period=?').get(tid, e.id, p); const n = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM acct_vouchers WHERE tenant_id=? AND entity_id=? AND period=? AND status='posted'").get(tid, e.id, p); rows.push({ period: p, closed: !!c?.closed_at, closed_at: c?.closed_at || '', closed_by: c?.closed_by || '', vouchers: n.c, total: n.t }); }
    res.json({ entity_id: e.id, year: y, rows });
  }));
  app.post(`${B}/periods/close`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const e = entityOf(tid, b.entity_id); if (!isMonth(b.period)) throw err('請選擇月份');
    if (b.reopen) {
      if (u.role !== 'company_admin') throw err('重新開帳只有公司管理員可以操作', 403);
      const later = db.prepare('SELECT period FROM acct_periods WHERE tenant_id=? AND entity_id=? AND period>? AND closed_at IS NOT NULL ORDER BY period LIMIT 1').get(tid, e.id, b.period);
      if (later) throw err(`${later.period} 也已經關帳，請從最後關帳的月份開始重新開帳`);
      db.prepare('UPDATE acct_periods SET closed_at=NULL,closed_by=? WHERE tenant_id=? AND entity_id=? AND period=?').run(by(u), tid, e.id, b.period);
      log(tid, u, 'period_reopen', `${e.id}:${b.period}`, str(b.reason, 200)); return res.json({ success: true });
    }
    const earlier = db.prepare('SELECT MIN(period) p FROM acct_vouchers WHERE tenant_id=? AND entity_id=? AND period<? AND status=\'posted\'').get(tid, e.id, b.period)?.p;
    if (earlier) { for (let p = earlier; p < b.period;) { if (!isClosed(tid, e.id, p) && db.prepare("SELECT 1 FROM acct_vouchers WHERE tenant_id=? AND entity_id=? AND period=? AND status='posted' LIMIT 1").get(tid, e.id, p)) throw err(`${p} 還沒有關帳，請依序關帳`); const [y, m] = p.split('-').map(Number); p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; } }
    const t = trial(tid, e.id, `${b.period}-01`, `${b.period}-31`); if (!t.balanced) throw err('試算表借貸不平衡，請先檢查傳票');
    db.prepare('INSERT INTO acct_periods (tenant_id,entity_id,period,closed_at,closed_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,entity_id,period) DO UPDATE SET closed_at=excluded.closed_at,closed_by=excluded.closed_by').run(tid, e.id, b.period, now(), by(u));
    log(tid, u, 'period_close', `${e.id}:${b.period}`); res.json({ success: true });
  }));
  // 報表
  const range = q => { const t = todayTW(); const from = isDate(q.from) ? q.from : `${t.slice(0, 7)}-01`; const to = isDate(q.to) ? q.to : t; if (to < from) throw err('結束日不能早於開始日'); return { from, to }; };
  app.get(`${B}/reports/:kind`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const e = entityOf(tid, q.entity_id || entities(tid)[0]?.id); const { from, to } = range(q);
    res.set('Cache-Control', 'no-store');
    if (req.params.kind === 'trial') return res.json({ entity: e, ...trial(tid, e.id, from, to) });
    if (req.params.kind === 'ledger') return res.json({ entity: e, ...ledger(tid, e.id, q.account_id, from, to) });
    if (req.params.kind === 'income') return res.json({ entity: e, ...income(tid, e.id, from, to, q.by === 'community') });
    if (req.params.kind === 'balance') return res.json({ entity: e, ...balance(tid, e.id, to) });
    throw err('沒有這種報表', 404);
  }));
  // 匯出
  app.get(`${B}/export`, requireCompanyAdmin, needAcct, wrap((req, res) => {
    const tid = tenantId(req); const q = req.query || {}; const s = settingsFor(tid); const { from, to } = range(q);
    const key = s.formats.enabled.includes(q.format) ? q.format : s.formats.default; const fmt = s.formats.custom[key];
    const x = exportRows(tid, q.entity_id || entities(tid)[0]?.id, from, to, fmt);
    const base = `傳票_${x.entity.short_name || x.entity.name}_${from.replace(/-/g, '')}-${to.replace(/-/g, '')}_${fmt.name}`;
    log(tid, getUser(req), 'export', key, `${from}～${to} ${x.count} 張`);
    if (fmt.file === 'xlsx' && XLSX) {
      const ws = XLSX.utils.aoa_to_sheet(fmt.header ? [x.header, ...x.rows] : x.rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '傳票');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`); return res.send(buf);
    }
    const text = (fmt.header ? [x.header, ...x.rows] : x.rows).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    let buf, charset = 'utf-8';
    if (fmt.encoding === 'big5' && iconv) { buf = iconv.encode(text, 'big5'); charset = 'big5'; }
    else buf = Buffer.concat([fmt.encoding === 'utf8' ? Buffer.alloc(0) : Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
    res.setHeader('Content-Type', `text/csv; charset=${charset}`); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv`);
    res.setHeader('X-Export-Count', String(x.count)); if (fmt.encoding === 'big5' && !iconv) res.setHeader('X-Export-Note', 'big5-unavailable');
    res.send(buf);
  }));

  // ================= 總後台：會計設定 =================
  app.get('/api/admin/acct-settings', requireSuperAdmin, wrap((req, res) => {
    const custom = new Set(db.prepare('SELECT tenant_id FROM acct_settings').all().map(x => x.tenant_id));
    res.json({ tenants: db.prepare('SELECT id,name,code FROM tenants ORDER BY id').all().map(t => ({ ...t, customized: custom.has(t.id) })), presets: C.PRESETS, fields: C.FIELDS, date_formats: C.DATE_FORMATS, dc_styles: C.DC_STYLES, encodings: C.ENCODINGS, providers: PROVIDERS, big5: !!iconv });
  }));
  app.get('/api/admin/acct-settings/:tid', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); const r = db.prepare('SELECT updated_at,updated_by FROM acct_settings WHERE tenant_id=?').get(tid);
    let positions = []; try { positions = org?.configFor(tid)?.positions?.map(p => ({ id: p.id, name: p.name, kind: p.kind })) || []; } catch {}
    res.json({ settings: publicSettings(settingsFor(tid)), customized: !!r, updated_at: r?.updated_at || '', updated_by: r?.updated_by || '', positions, entities: entities(tid, { all: true }) });
  }));
  app.put('/api/admin/acct-settings/:tid', requireSuperAdmin, wrap((req, res) => {
    const tid = Number(req.params.tid); const cur = settingsFor(tid); const b = req.body || {};
    // 金鑰欄位：送回的是遮罩值（沒有修改）時保留原值
    const inv = { ...(b.invoice || {}) }; for (const k of ['hash_key', 'hash_iv', 'app_key']) if (inv[k] === undefined || /•/.test(String(inv[k]))) inv[k] = cur.invoice[k];
    const next = normalize({ ...cur, ...b, invoice: { ...cur.invoice, ...inv } });
    if (next.invoice.einvoice_enabled && !next.invoice.provider) throw err('開啟電子發票串接前，請選擇加值中心');
    db.prepare('INSERT INTO acct_settings (tenant_id,config_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(next), now(), '系統總後台');
    log(tid, '系統總後台', 'settings', '', `匯出格式 ${next.formats.enabled.join('、')}；發票 ${next.invoice.mode}${next.invoice.einvoice_enabled ? `＋${next.invoice.provider}` : ''}`);
    res.json({ success: true, settings: publicSettings(next) });
  }));
  app.delete('/api/admin/acct-settings/:tid', requireSuperAdmin, wrap((req, res) => { db.prepare('DELETE FROM acct_settings WHERE tenant_id=?').run(Number(req.params.tid)); res.json({ success: true, settings: publicSettings(normalize(null)) }); }));

  return { post, voidBySource, voucher, entities, entityOf, accountBy, settingsFor, canAcct, isBoss, perms, validTaxId: C.validTaxId, isClosed };
};
