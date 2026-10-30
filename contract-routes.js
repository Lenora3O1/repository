// 社區合約（總務管理）：社區、簽約公司、合約期間、派駐配置、合約金額（物業／保全／清潔）、回饋項目、附件、到期提醒
// 公司應收（依合約每月請款）與社區回饋金會使用這裡的資料。
'use strict';

module.exports = function registerContractRoutes(app, d) {
  const { db, fs, path, crypto, multer, DATA_DIR, getUser, tenantId, now, requireCompanyAdmin, getSiteAssignments, org, acct } = d;
  const DIR = path.join(DATA_DIR, 'uploads', 'contracts'); try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  db.exec(`
  CREATE TABLE IF NOT EXISTS community_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, entity_id INTEGER, contract_no TEXT DEFAULT '', title TEXT DEFAULT '',
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', terminated_at TEXT, terminate_reason TEXT DEFAULT '',
    tax_type TEXT NOT NULL DEFAULT 'exclusive', items_json TEXT NOT NULL DEFAULT '[]', staffing_json TEXT NOT NULL DEFAULT '[]', feedback_json TEXT NOT NULL DEFAULT '[]',
    client_json TEXT NOT NULL DEFAULT '{}', billing_json TEXT NOT NULL DEFAULT '{}', remind_days INTEGER DEFAULT 60, reminded_at TEXT, note TEXT DEFAULT '',
    created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_by TEXT DEFAULT '', updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_contracts ON community_contracts(tenant_id, community_id);
  CREATE TABLE IF NOT EXISTS contract_files (id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, filename TEXT NOT NULL, original TEXT DEFAULT '', mime TEXT DEFAULT '', size INTEGER DEFAULT 0, uploaded_by TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS contract_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);
  // 同一社區、不同簽約公司的合約可以合成「一組」：一次填寫，依簽約公司拆成各自的合約（各自請款、開發票）
  try { db.exec('ALTER TABLE community_contracts ADD COLUMN group_id INTEGER'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_contracts_group ON community_contracts(tenant_id, group_id)'); } catch {}

  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const int = (v, lo, hi, f) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : f; };
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => db.transaction(fn);
  const by = u => u?.name || u?.employee_id || '';
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const commName = id => id ? (db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '') : '';
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1").all(tid).map(x => x.id);
  const log = (c, u, action, note = '') => db.prepare('INSERT INTO contract_logs (contract_id,tenant_id,actor,action,note,created_at) VALUES (?,?,?,?,?,?)').run(c.id, c.tenant_id, by(u), action, str(note, 400), now());
  function notify(tid, toIds, subject, body) {
    for (const toId of [...new Set(toIds)].filter(Boolean)) {
      try {
        const to = staffRow(tid, toId); if (!to) continue; const a = adminIds(tid).find(x => x !== to.id); const sender = a ? staffRow(tid, a) : null; if (!sender) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, subject, body, 'text', '', now());
      } catch (e) { console.warn('contract message failed', e.message); }
    }
  }

  // ---------- 權限：總務、老闆／總經理可以編輯；會計、部門主管、督導可以查看 ----------
  const P = u => acct.perms(u);
  const isGA = u => u?.role === 'company_admin' || P(u).has('company-general-affairs');
  const canEdit = u => isGA(u) || acct.isBoss(u);
  const canView = u => canEdit(u) || acct.canAcct(u) || ['dept_head', 'region'].includes(mi(u)?.kind);
  function scopeCommunities(u) { // 督導只看自己區域
    const m = mi(u); if (m?.kind === 'region' && !canEdit(u) && !acct.canAcct(u)) return new Set(db.prepare(`SELECT id FROM communities WHERE tenant_id=? AND region_id IN (${(m.regions || []).map(() => '?').join(',') || 'NULL'})`).all(u.tenant_id, ...(m.regions || [])).map(x => x.id));
    return null;
  }
  const needView = (req, res, next) => { if (!canView(getUser(req))) return bad(res, '您沒有查看社區合約的權限', 403); next(); };
  const needEdit = (req, res, next) => { if (!canEdit(getUser(req))) return bad(res, '只有總務、總經理或公司管理員可以編輯社區合約', 403); next(); };

  // ---------- 資料 ----------
  const KINDS = { property: '物業管理服務費', security: '保全服務費', cleaning: '清潔服務費', maintenance: '機電／工程維護費', other: '其他' };
  const FREQ = { monthly: '每月', quarterly: '每季', half: '每半年', yearly: '每年', once: '一次' };
  const SHIFT = { day: '日班', night: '夜班', h24: '24 小時', office: '行政班', '': '' };
  function readContract(tid, b, cur = {}) {
    const cid = Number(b.community_id ?? cur.community_id); if (!db.prepare('SELECT 1 FROM communities WHERE id=? AND tenant_id=?').get(cid, tid)) throw err('請選擇社區');
    const entity = acct.entityOf(tid, b.entity_id ?? cur.entity_id);
    const start = b.start_date ?? cur.start_date, end = b.end_date ?? cur.end_date; if (!isDate(start) || !isDate(end) || end < start) throw err('請填寫正確的合約期間');
    const items = (Array.isArray(b.items) ? b.items : parse(cur.items_json, [])).map(x => ({ kind: KINDS[x?.kind] ? x.kind : 'other', name: str(x?.name, 40) || KINDS[x?.kind] || '其他', amount: Math.max(0, Math.round(Number(x?.amount) || 0)), note: str(x?.note, 100) })).filter(x => x.amount > 0 || x.name).slice(0, 20);
    if (!items.some(x => x.amount > 0)) throw err('請至少填一項合約金額');
    const staffing = (Array.isArray(b.staffing) ? b.staffing : parse(cur.staffing_json, [])).map(x => ({ position_id: str(x?.position_id, 30), position_name: str(x?.position_name, 30), count: int(x?.count, 0, 99, 1), shift: SHIFT[x?.shift] !== undefined ? x.shift : '', note: str(x?.note, 100) })).filter(x => x.position_id || x.position_name).slice(0, 30);
    const feedback = (Array.isArray(b.feedback) ? b.feedback : parse(cur.feedback_json, [])).map(x => ({ type: x?.type === 'service' ? 'service' : 'cash', name: str(x?.name, 40), amount: x?.type === 'service' ? 0 : Math.max(0, Math.round(Number(x?.amount) || 0)), frequency: FREQ[x?.frequency] ? x.frequency : 'monthly', times: int(x?.times, 0, 99, 0), note: str(x?.note, 120) })).filter(x => x.name).slice(0, 20);
    const c0 = b.client && typeof b.client === 'object' ? b.client : parse(cur.client_json, {});
    const client = { name: str(c0.name, 60), tax_id: str(c0.tax_id, 8), contact: str(c0.contact, 30), phone: str(c0.phone, 30), email: str(c0.email, 80), address: str(c0.address, 120) };
    if (client.tax_id && !acct.validTaxId(client.tax_id)) throw err('買受人（管委會）統一編號格式不正確');
    const b0 = b.billing && typeof b.billing === 'object' ? b.billing : parse(cur.billing_json, {});
    const billing = { day: int(b0.day, 1, 28, 1), terms_days: int(b0.terms_days, 0, 120, 30), invoice_kind: ['b2b', 'b2c', 'none'].includes(b0.invoice_kind) ? b0.invoice_kind : (client.tax_id ? 'b2b' : 'b2c'), in_advance: b0.in_advance === undefined ? true : !!b0.in_advance };
    return { community_id: cid, entity_id: entity.id, contract_no: str(b.contract_no ?? cur.contract_no, 40), title: str(b.title ?? cur.title, 60), start_date: start, end_date: end,
      tax_type: (b.tax_type ?? cur.tax_type) === 'inclusive' ? 'inclusive' : 'exclusive', items, staffing, feedback, client, billing, remind_days: int(b.remind_days ?? cur.remind_days, 0, 365, 60), note: str(b.note ?? cur.note, 500) };
  }
  // 金額：未稅、稅額、含稅（月）
  function amounts(c) {
    const items = parse(c.items_json, []); const sum = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    if (c.tax_type === 'inclusive') { const net = Math.round(sum / 1.05); return { net, tax: sum - net, gross: sum }; }
    const tax = Math.round(sum * 0.05); return { net: sum, tax, gross: sum + tax };
  }
  function statusOf(c) {
    const t = todayTW(); if (c.status === 'terminated') return 'terminated'; if (c.status === 'draft') return 'draft';
    if (c.end_date < t) return 'expired'; if (c.start_date > t) return 'upcoming';
    if (diffDays(t, c.end_date) <= (c.remind_days ?? 60)) return 'expiring'; return 'active';
  }
  const STATUS = { active: '履約中', expiring: '即將到期', upcoming: '尚未開始', expired: '已到期', terminated: '已解約', draft: '草稿' };
  // 派駐配置對照：合約要求 vs. 實際派駐（組織架構中掛在這個社區的人）
  function actualStaff(tid, cid) {
    const ids = new Set(db.prepare("SELECT staff_id FROM staff_work_assignments WHERE tenant_id=? AND community_id=? AND scope_type='site'").all(tid, cid).map(x => x.staff_id));
    const out = {};
    for (const id of ids) { const u = staffRow(tid, id); if (!u || !u.is_active || (u.person_status && u.person_status !== 'active')) continue; const m = mi(u); if (['mobile', 'region'].includes(m?.kind)) continue; const k = m?.position?.id || `legacy:${u.position || u.job_level || '未設定'}`; (out[k] ||= { position_id: m?.position?.id || '', name: m?.position?.name || u.position || u.job_level || '未設定職位', count: 0, people: [] }); out[k].count++; out[k].people.push(u.name); }
    return Object.values(out);
  }
  function out(c, { detail = false } = {}) {
    const ent = (() => { try { return acct.entities(c.tenant_id, { all: true }).find(e => e.id === c.entity_id) || null; } catch { return null; } })();
    const st = statusOf(c); const o = {
      id: c.id, group_id: c.group_id || c.id, community_id: c.community_id, community_name: commName(c.community_id), entity_id: c.entity_id, entity_name: ent?.short_name || ent?.name || '', entity_tax_id: ent?.tax_id || '',
      contract_no: c.contract_no, title: c.title, start_date: c.start_date, end_date: c.end_date, days_left: diffDays(todayTW(), c.end_date), status: st, status_label: STATUS[st],
      tax_type: c.tax_type, items: parse(c.items_json, []), staffing: parse(c.staffing_json, []), feedback: parse(c.feedback_json, []), client: parse(c.client_json, {}), billing: parse(c.billing_json, {}),
      remind_days: c.remind_days, note: c.note, terminated_at: c.terminated_at, terminate_reason: c.terminate_reason, amounts: amounts(c), created_by: c.created_by, updated_by: c.updated_by, updated_at: c.updated_at,
      files: db.prepare('SELECT id,original,mime,size,uploaded_by,created_at FROM contract_files WHERE contract_id=? ORDER BY id').all(c.id),
    };
    if (detail) { o.actual_staff = actualStaff(c.tenant_id, c.community_id); o.logs = db.prepare('SELECT actor,action,note,created_at FROM contract_logs WHERE contract_id=? ORDER BY id DESC LIMIT 50').all(c.id); }
    return o;
  }
  // 到期提醒（每份合約提醒一次；續約或修改期間後會重新提醒）
  function sweep(tid) {
    const t = todayTW();
    for (const c of db.prepare("SELECT * FROM community_contracts WHERE tenant_id=? AND status='active' AND reminded_at IS NULL AND end_date>=?").all(tid, t)) {
      const left = diffDays(t, c.end_date); if (left > (c.remind_days ?? 60) || !c.remind_days) continue;
      db.prepare('UPDATE community_contracts SET reminded_at=? WHERE id=?').run(now(), c.id);
      const rows = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1").all(tid).filter(u => u.role !== 'company_admin' && (isGA(u) || acct.isBoss(u)));
      notify(tid, [...rows.map(x => x.id), ...adminIds(tid)], '社區合約即將到期', `📄 ${commName(c.community_id)} 的合約${c.contract_no ? `（${c.contract_no}）` : ''}將在 ${c.end_date} 到期（剩 ${left} 天），請準備續約或撤場作業。\n請到「總務管理 → 社區合約」查看。`);
    }
  }
  const getC = req => { const c = db.prepare('SELECT * FROM community_contracts WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req)); if (!c) throw err('找不到這份合約', 404); const s = scopeCommunities(getUser(req)); if (s && !s.has(c.community_id)) throw err('您沒有這個社區的權限', 403); return c; };

  // ================= 路由 =================
  const B = '/api/company/contracts';
  app.get(`${B}/meta`, requireCompanyAdmin, needView, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); sweep(tid);
    let positions = []; try { positions = org.configFor(tid).positions.filter(p => !['owner', 'gm', 'dept_head', 'office'].includes(p.kind)).map(p => ({ id: p.id, name: p.name, kind: p.kind, shift: p.shift, dept: p.dept || '' })); } catch {}
    const s = scopeCommunities(u);
    res.set('Cache-Control', 'no-store');
    res.json({ communities: db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid).filter(c => !s || s.has(c.id)), entities: acct.entities(tid), positions, kinds: KINDS, freq: FREQ, shifts: SHIFT, status: STATUS, can_edit: canEdit(u), today: todayTW() });
  }));
  app.get(B, requireCompanyAdmin, needView, wrap((req, res) => {
    const tid = tenantId(req); sweep(tid); const q = req.query || {}; const s = scopeCommunities(getUser(req));
    let rows = db.prepare('SELECT * FROM community_contracts WHERE tenant_id=? ORDER BY end_date DESC, id DESC').all(tid).filter(c => !s || s.has(c.community_id));
    if (Number(q.community_id)) rows = rows.filter(c => c.community_id === Number(q.community_id));
    let list = rows.map(c => out(c)); if (q.status && q.status !== 'all') list = list.filter(c => q.status === 'current' ? ['active', 'expiring', 'upcoming'].includes(c.status) : c.status === q.status);
    const cur = list.filter(c => ['active', 'expiring'].includes(c.status));
    res.set('Cache-Control', 'no-store');
    res.json({ rows: list, summary: { current: cur.length, expiring: cur.filter(c => c.status === 'expiring').length, monthly_net: cur.reduce((a, c) => a + c.amounts.net, 0), monthly_gross: cur.reduce((a, c) => a + c.amounts.gross, 0) } });
  }));
  app.get(`${B}/:id`, requireCompanyAdmin, needView, wrap((req, res) => res.json({ contract: out(getC(req), { detail: true }) })));
  app.post(B, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const x = readContract(tid, req.body || {});
    const ov = overlapOf(tid, x); if (ov && !req.body?.allow_overlap) return res.status(409).json({ error: ov.msg, overlap_id: ov.id });
    const id = Number(db.prepare(`INSERT INTO community_contracts (tenant_id,community_id,entity_id,contract_no,title,start_date,end_date,status,tax_type,items_json,staffing_json,feedback_json,client_json,billing_json,remind_days,note,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tid, x.community_id, x.entity_id, x.contract_no, x.title, x.start_date, x.end_date, req.body?.draft ? 'draft' : 'active', x.tax_type, JSON.stringify(x.items), JSON.stringify(x.staffing), JSON.stringify(x.feedback), JSON.stringify(x.client), JSON.stringify(x.billing), x.remind_days, x.note, by(u), now(), by(u), now()).lastInsertRowid);
    const c = db.prepare('SELECT * FROM community_contracts WHERE id=?').get(id); log(c, u, 'create', `${x.start_date}～${x.end_date}，每月 ${amounts(c).gross.toLocaleString()}（含稅）`);
    db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(id, id);
    res.json({ success: true, contract: out(db.prepare('SELECT * FROM community_contracts WHERE id=?').get(id), { detail: true }) });
  }));
  app.put(`${B}/:id`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const c = getC(req); if (c.status === 'terminated') throw err('已解約的合約不能修改');
    const before = out(c); const x = readContract(tid, req.body || {}, c);
    const changes = [];
    if (before.start_date !== x.start_date || before.end_date !== x.end_date) changes.push(`期間 ${before.start_date}～${before.end_date} → ${x.start_date}～${x.end_date}`);
    const sum = l => l.reduce((s, i) => s + i.amount, 0); if (sum(before.items) !== sum(x.items) || before.tax_type !== x.tax_type) changes.push(`月費 ${sum(before.items).toLocaleString()} → ${sum(x.items).toLocaleString()}（${x.tax_type === 'inclusive' ? '含稅' : '未稅'}）`);
    if (JSON.stringify(before.staffing) !== JSON.stringify(x.staffing)) changes.push('派駐配置');
    if (JSON.stringify(before.feedback) !== JSON.stringify(x.feedback)) changes.push('回饋項目');
    if (before.entity_id !== x.entity_id) changes.push('簽約公司');
    db.prepare(`UPDATE community_contracts SET community_id=?,entity_id=?,contract_no=?,title=?,start_date=?,end_date=?,status=?,tax_type=?,items_json=?,staffing_json=?,feedback_json=?,client_json=?,billing_json=?,remind_days=?,note=?,updated_by=?,updated_at=?${before.end_date !== x.end_date || before.remind_days !== x.remind_days ? ',reminded_at=NULL' : ''} WHERE id=?`)
      .run(x.community_id, x.entity_id, x.contract_no, x.title, x.start_date, x.end_date, req.body?.draft === false || c.status !== 'draft' ? 'active' : 'draft', x.tax_type, JSON.stringify(x.items), JSON.stringify(x.staffing), JSON.stringify(x.feedback), JSON.stringify(x.client), JSON.stringify(x.billing), x.remind_days, x.note, by(u), now(), c.id);
    log(c, u, 'update', changes.join('；') || '修改資料');
    res.json({ success: true, contract: out(db.prepare('SELECT * FROM community_contracts WHERE id=?').get(c.id), { detail: true }) });
  }));
  // 續約：複製一份新合約（期間接在原合約之後）
  app.post(`${B}/:id/renew`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const c = getC(req); const b = req.body || {};
    const start = isDate(b.start_date) ? b.start_date : (() => { const x = new Date(`${c.end_date}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })();
    const months = int(b.months, 1, 120, 12); const e = new Date(`${start}T00:00:00Z`); e.setUTCMonth(e.getUTCMonth() + months); e.setUTCDate(e.getUTCDate() - 1); const end = isDate(b.end_date) ? b.end_date : e.toISOString().slice(0, 10);
    const x = readContract(tid, { ...out(c), ...b, start_date: start, end_date: end, contract_no: b.contract_no ?? '' }, c);
    if (x.start_date <= c.end_date) throw err('續約的開始日要在原合約到期之後');
    const id = Number(db.prepare(`INSERT INTO community_contracts (tenant_id,community_id,entity_id,contract_no,title,start_date,end_date,status,tax_type,items_json,staffing_json,feedback_json,client_json,billing_json,remind_days,note,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tid, x.community_id, x.entity_id, x.contract_no, x.title, x.start_date, x.end_date, x.tax_type, JSON.stringify(x.items), JSON.stringify(x.staffing), JSON.stringify(x.feedback), JSON.stringify(x.client), JSON.stringify(x.billing), x.remind_days, x.note, by(u), now(), by(u), now()).lastInsertRowid);
    db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(id, id);
    log(c, u, 'renew', `續約：新合約 ${x.start_date}～${x.end_date}`); const n = db.prepare('SELECT * FROM community_contracts WHERE id=?').get(id); log(n, u, 'create', `由合約 #${c.id} 續約`);
    res.json({ success: true, contract: out(n, { detail: true }) });
  }));
  app.post(`${B}/:id/terminate`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const u = getUser(req); const c = getC(req); const b = req.body || {}; if (c.status === 'terminated') throw err('已經解約了');
    const date = isDate(b.date) ? b.date : todayTW(); const reason = str(b.reason, 300); if (!reason) throw err('請寫解約原因');
    db.prepare("UPDATE community_contracts SET status='terminated',terminated_at=?,terminate_reason=?,end_date=CASE WHEN end_date>? THEN ? ELSE end_date END,updated_by=?,updated_at=? WHERE id=?").run(date, reason, date, date, by(u), now(), c.id);
    log(c, u, 'terminate', `${date} 解約：${reason}`); res.json({ success: true });
  }));
  app.delete(`${B}/:id`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const c = getC(req); if (c.status !== 'draft') throw err('只有草稿可以刪除；正式合約請用「解約」');
    db.prepare('DELETE FROM community_contracts WHERE id=?').run(c.id); res.json({ success: true });
  }));
  // ================= 合約組（同社區多家簽約公司） =================
  function overlapOf(tid, x, exclude = []) {
    const o = db.prepare(`SELECT * FROM community_contracts WHERE tenant_id=? AND community_id=? AND entity_id=? AND status IN ('active','draft') AND start_date<=? AND end_date>=?${exclude.length ? ` AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`).get(tid, x.community_id, x.entity_id, x.end_date, x.start_date, ...exclude);
    if (!o) return null; const e = entName(tid, x.entity_id);
    return { id: o.id, msg: `${commName(x.community_id)} 與「${e}」在 ${o.start_date}～${o.end_date} 已經有合約，期間重疊。若是續約請把新合約的開始日設在舊合約到期之後。` };
  }
  const entName = (tid, eid) => { try { const e = acct.entities(tid, { all: true }).find(x => x.id === Number(eid)); return e?.short_name || e?.name || ''; } catch { return ''; } };
  const members = (tid, gid) => db.prepare('SELECT * FROM community_contracts WHERE tenant_id=? AND (group_id=? OR (group_id IS NULL AND id=?)) ORDER BY id').all(tid, gid, gid);
  // 把一次填寫的內容依簽約公司拆開；每一列都帶 entity_id
  function splitGroup(tid, b) {
    const ents = acct.entities(tid); const ok = id => ents.some(e => e.id === Number(id));
    const def = ents[0]?.id; const eidOf = r => ok(r?.entity_id) ? Number(r.entity_id) : def;
    const items = (Array.isArray(b.items) ? b.items : []).filter(x => Number(x?.amount) > 0 || str(x?.name)); const order = [];
    for (const it of items) { const e = eidOf(it); if (Number(it.amount) > 0 && !order.includes(e)) order.push(e); }
    if (!order.length) throw err('請至少填一項合約金額');
    const staffing = Array.isArray(b.staffing) ? b.staffing : [], feedback = Array.isArray(b.feedback) ? b.feedback : [];
    for (const r of [...staffing, ...feedback]) { const e = eidOf(r); if ((r?.position_id || r?.position_name || r?.name) && !order.includes(e)) throw err(`「${entName(tid, e)}」沒有填合約金額，派駐配置或回饋項目不能掛在這家公司`); }
    const nos = b.contract_nos && typeof b.contract_nos === 'object' ? b.contract_nos : {};
    const firstNo = str(b.contract_no, 40);
    return order.map((e, i) => readContract(tid, { ...b, entity_id: e, contract_no: i === 0 ? firstNo : (str(nos[e], 40) || firstNo),
      items: items.filter(x => eidOf(x) === e), staffing: staffing.filter(x => eidOf(x) === e), feedback: feedback.filter(x => eidOf(x) === e) }));
  }
  const INS = `INSERT INTO community_contracts (tenant_id,community_id,entity_id,contract_no,title,start_date,end_date,status,tax_type,items_json,staffing_json,feedback_json,client_json,billing_json,remind_days,note,created_by,created_at,updated_by,updated_at,group_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const insert = (tid, x, status, u, gid) => Number(db.prepare(INS).run(tid, x.community_id, x.entity_id, x.contract_no, x.title, x.start_date, x.end_date, status, x.tax_type, JSON.stringify(x.items), JSON.stringify(x.staffing), JSON.stringify(x.feedback), JSON.stringify(x.client), JSON.stringify(x.billing), x.remind_days, x.note, by(u), now(), by(u), now(), gid).lastInsertRowid);
  function groupOut(tid, gid) {
    const ms = members(tid, gid); if (!ms.length) throw err('找不到這組合約', 404);
    const list = ms.map(c => out(c, { detail: true }));
    const cur = list.filter(c => !['terminated', 'expired'].includes(c.status));
    const sum = k => (cur.length ? cur : list).reduce((a, c) => a + c.amounts[k], 0);
    const files = list.flatMap(c => c.files.map(f => ({ ...f, entity_name: c.entity_name })));
    const logs = list.flatMap(c => c.logs.map(l => ({ ...l, entity_name: c.entity_name }))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 80);
    return { group_id: gid, community_id: list[0].community_id, community_name: list[0].community_name, members: list, amounts: { net: sum('net'), tax: sum('tax'), gross: sum('gross') }, actual_staff: list[0].actual_staff, files, logs };
  }
  const getG = req => { const tid = tenantId(req); const gid = Number(req.params.gid); const ms = members(tid, gid); if (!ms.length) throw err('找不到這組合約', 404); const s = scopeCommunities(getUser(req)); if (s && !s.has(ms[0].community_id)) throw err('您沒有這個社區的權限', 403); return ms; };

  app.get(`${B}/group/:gid`, requireCompanyAdmin, needView, wrap((req, res) => { getG(req); res.set('Cache-Control', 'no-store'); res.json({ group: groupOut(tenantId(req), Number(req.params.gid)) }); }));
  app.post(`${B}/group`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const xs = splitGroup(tid, b);
    if (!b.allow_overlap) for (const x of xs) { const ov = overlapOf(tid, x); if (ov) return res.status(409).json({ error: ov.msg, overlap_id: ov.id }); }
    let gid = 0;
    tx(() => { for (const x of xs) { const id = insert(tid, x, b.draft ? 'draft' : 'active', u, gid || null); if (!gid) { gid = id; db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(id, id); } const c = db.prepare('SELECT * FROM community_contracts WHERE id=?').get(id); log(c, u, 'create', `${x.start_date}～${x.end_date}，每月 ${amounts(c).gross.toLocaleString()}（含稅）${xs.length > 1 ? `；同組 ${xs.length} 家簽約公司` : ''}`); } })();
    res.json({ success: true, group: groupOut(tid, gid) });
  }));
  // 整組修改：已存在的公司更新、新加的公司新增；拿掉的公司若是草稿就刪除，正式合約請先個別解約
  app.put(`${B}/group/:gid`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const ms = getG(req).filter(c => c.status !== 'terminated'); const gid = Number(req.params.gid);
    const xs = splitGroup(tid, { ...b, community_id: ms[0]?.community_id ?? b.community_id });
    const removed = ms.filter(c => !xs.some(x => x.entity_id === c.entity_id));
    const live = removed.filter(c => c.status !== 'draft'); if (live.length) throw err(`「${live.map(c => entName(tid, c.entity_id)).join('、')}」的合約仍在履約中，不能直接從這組拿掉；請先在該公司的合約按「解約」`);
    if (!b.allow_overlap) for (const x of xs) { const ov = overlapOf(tid, x, ms.map(c => c.id)); if (ov) return res.status(409).json({ error: ov.msg, overlap_id: ov.id }); }
    tx(() => {
      for (const c of removed) db.prepare('DELETE FROM community_contracts WHERE id=?').run(c.id);
      for (const x of xs) {
        const c = ms.find(m => m.entity_id === x.entity_id);
        if (!c) { const id = insert(tid, x, ms[0]?.status === 'draft' && b.draft !== false ? 'draft' : 'active', u, gid); log(db.prepare('SELECT * FROM community_contracts WHERE id=?').get(id), u, 'create', '加入合約組'); continue; }
        const before = out(c); const ch = [];
        if (before.start_date !== x.start_date || before.end_date !== x.end_date) ch.push(`期間 ${before.start_date}～${before.end_date} → ${x.start_date}～${x.end_date}`);
        const sum = l => l.reduce((s, i) => s + i.amount, 0); if (sum(before.items) !== sum(x.items) || before.tax_type !== x.tax_type) ch.push(`月費 ${sum(before.items).toLocaleString()} → ${sum(x.items).toLocaleString()}（${x.tax_type === 'inclusive' ? '含稅' : '未稅'}）`);
        if (JSON.stringify(before.staffing) !== JSON.stringify(x.staffing)) ch.push('派駐配置'); if (JSON.stringify(before.feedback) !== JSON.stringify(x.feedback)) ch.push('回饋項目');
        db.prepare(`UPDATE community_contracts SET contract_no=?,start_date=?,end_date=?,status=?,tax_type=?,items_json=?,staffing_json=?,feedback_json=?,client_json=?,billing_json=?,remind_days=?,note=?,group_id=?,updated_by=?,updated_at=?${before.end_date !== x.end_date || before.remind_days !== x.remind_days ? ',reminded_at=NULL' : ''} WHERE id=?`)
          .run(x.contract_no, x.start_date, x.end_date, b.draft === false || c.status !== 'draft' ? 'active' : 'draft', x.tax_type, JSON.stringify(x.items), JSON.stringify(x.staffing), JSON.stringify(x.feedback), JSON.stringify(x.client), JSON.stringify(x.billing), x.remind_days, x.note, gid, by(u), now(), c.id);
        log(c, u, 'update', `整組修改：${ch.join('；') || '修改資料'}`);
      }
    })();
    res.json({ success: true, group: groupOut(tid, gid) });
  }));
  // 把同一社區已經分開登記的合約合成一組
  app.post(`${B}/group/merge`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const ids = [...new Set((req.body?.ids || []).map(Number).filter(Boolean))];
    const rows = ids.map(id => db.prepare('SELECT * FROM community_contracts WHERE id=? AND tenant_id=?').get(id, tid)).filter(Boolean);
    if (rows.length < 2) throw err('請至少選兩份合約');
    if (new Set(rows.map(c => c.community_id)).size > 1) throw err('只能合併同一個社區的合約');
    const s = scopeCommunities(u); if (s && !s.has(rows[0].community_id)) throw err('您沒有這個社區的權限', 403);
    const all = rows.flatMap(c => members(tid, c.group_id || c.id)); const uniq = [...new Map(all.map(c => [c.id, c])).values()];
    const live = uniq.filter(c => c.status !== 'terminated'); const dup = live.find((c, i) => live.some((d, j) => j < i && d.entity_id === c.entity_id && d.start_date <= c.end_date && d.end_date >= c.start_date));
    if (dup) throw err(`「${entName(tid, dup.entity_id)}」有兩份期間重疊的合約，不能放在同一組`);
    const gid = Math.min(...uniq.map(c => c.id));
    tx(() => { for (const c of uniq) { db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(gid, c.id); log(c, u, 'group', `合併成同一組（${uniq.length} 份）`); } })();
    res.json({ success: true, group: groupOut(tid, gid) });
  }));
  app.post(`${B}/:id/ungroup`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const u = getUser(req); const c = getC(req); const gid = c.group_id || c.id; const ms = members(c.tenant_id, gid); if (ms.length < 2) throw err('這份合約沒有跟其他合約同組');
    tx(() => { if (c.id === gid) { const rest = ms.filter(m => m.id !== c.id); const ng = rest[0].id; for (const m of rest) db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(ng, m.id); } db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(c.id, c.id); log(c, u, 'group', '移出合約組'); })();
    res.json({ success: true });
  }));
  // 整組續約：每一家都接在原合約之後，金額與配置沿用
  app.post(`${B}/group/:gid/renew`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const ms = getG(req).filter(c => c.status !== 'terminated'); if (!ms.length) throw err('這組合約都已解約');
    const months = int(b.months, 1, 120, 12); let gid = 0;
    tx(() => { for (const c of ms) {
      const s0 = new Date(`${c.end_date}T00:00:00Z`); s0.setUTCDate(s0.getUTCDate() + 1); const start = s0.toISOString().slice(0, 10);
      const e = new Date(`${start}T00:00:00Z`); e.setUTCMonth(e.getUTCMonth() + months); e.setUTCDate(e.getUTCDate() - 1);
      const x = readContract(tid, { ...out(c), start_date: start, end_date: e.toISOString().slice(0, 10), contract_no: '' }, c);
      const id = insert(tid, x, 'active', u, gid || null); if (!gid) { gid = id; db.prepare('UPDATE community_contracts SET group_id=? WHERE id=?').run(id, id); }
      log(c, u, 'renew', `續約：新合約 ${x.start_date}～${x.end_date}`); log(db.prepare('SELECT * FROM community_contracts WHERE id=?').get(id), u, 'create', `由合約 #${c.id} 續約`);
    } })();
    res.json({ success: true, group: groupOut(tid, gid) });
  }));

  // 附件
  const upload = multer({
    storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, DIR), filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${({ 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[file.mimetype] || '.bin'}`) }),
    limits: { fileSize: 20 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => (/^image\//.test(file.mimetype) || file.mimetype === 'application/pdf') ? cb(null, true) : cb(new Error('合約附件請上傳 PDF 或照片')),
  }).array('files', 5);
  app.post(`${B}/:id/files`, requireCompanyAdmin, needEdit, (req, res) => {
    let c; try { c = getC(req); } catch (e) { return bad(res, e.message, e.status); }
    upload(req, res, e => {
      if (e) return bad(res, e.code === 'LIMIT_FILE_SIZE' ? '檔案太大了（每個最多 20MB）' : e.message || '上傳失敗');
      const files = req.files || (req.file ? [req.file] : []); if (!files.length) return bad(res, '請選擇檔案'); const u = getUser(req);
      for (const f of files) db.prepare('INSERT INTO contract_files (contract_id,tenant_id,filename,original,mime,size,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(c.id, c.tenant_id, f.filename, str(f.originalname, 120), f.mimetype, f.size || 0, by(u), now());
      log(c, u, 'file', files.map(f => f.originalname).join('、')); res.json({ success: true });
    });
  });
  app.get(`${B}/files/:fid`, requireCompanyAdmin, needView, wrap((req, res) => {
    const f = db.prepare('SELECT * FROM contract_files WHERE id=? AND tenant_id=?').get(Number(req.params.fid), tenantId(req)); if (!f) throw err('找不到檔案', 404);
    const c = db.prepare('SELECT * FROM community_contracts WHERE id=?').get(f.contract_id); const s = scopeCommunities(getUser(req)); if (s && !s.has(c.community_id)) throw err('您沒有這個社區的權限', 403);
    const file = path.join(DIR, path.basename(f.filename)); if (!fs.existsSync(file)) throw err('檔案不存在', 404);
    res.setHeader('Content-Type', f.mime || 'application/octet-stream'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original || 'contract')}`); res.sendFile(file);
  }));
  app.delete(`${B}/files/:fid`, requireCompanyAdmin, needEdit, wrap((req, res) => {
    const f = db.prepare('SELECT * FROM contract_files WHERE id=? AND tenant_id=?').get(Number(req.params.fid), tenantId(req)); if (!f) throw err('找不到檔案', 404);
    db.prepare('DELETE FROM contract_files WHERE id=?').run(f.id); try { fs.unlinkSync(path.join(DIR, path.basename(f.filename))); } catch {}
    log({ id: f.contract_id, tenant_id: f.tenant_id }, getUser(req), 'file_delete', f.original); res.json({ success: true });
  }));

  // 給其他模組用：某社區某天有效的合約
  // 同一社區可能同時有多家簽約公司的合約：有給職位時，優先找派駐配置裡有這個職位的那一份
  function activeFor(tid, cid, date, positionId) {
    const rows = db.prepare("SELECT * FROM community_contracts WHERE tenant_id=? AND community_id=? AND status='active' AND start_date<=? AND end_date>=? ORDER BY start_date DESC, id").all(tid, cid, date, date);
    if (positionId) { const hit = rows.find(c => parse(c.staffing_json, []).some(p => p.position_id === positionId)); if (hit) return hit; }
    return rows[0] || null;
  }
  function dashboard(tid) { sweep(tid); const t = todayTW(); const rows = db.prepare("SELECT * FROM community_contracts WHERE tenant_id=? AND status='active' AND end_date>=?").all(tid, t); return { current: rows.filter(c => c.start_date <= t).length, expiring: rows.filter(c => statusOf(c) === 'expiring').map(c => ({ community: commName(c.community_id), end_date: c.end_date, days: diffDays(t, c.end_date) })) }; }
  return { activeFor, amounts, out, dashboard, canView, canEdit, KINDS };
};
