// 保全勤務日誌＋交接點收（日班、夜班各一份）
// - 接班先點收：包裹／掛號／寄放物件數、現金（先點再看應有金額）、鑰匙等物品；對不上要寫原因並通知經理與勤務主管
// - 當班記錄：勤務紀錄、訪客／廠商進出、異常狀況、交辦下一班；現金收、領；物品借出、歸還
// - 交班送出：鎖定內容，公司內勤與社區經理各收到一份不能修改的副本
// - 代收管理費、停車費只有財務秘書或經理能領取；領取時填收據號碼，自動帶入現場「財務報表 → 收入報表」
'use strict';

module.exports = function registerDutyRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaff, requireCompanyAdmin, isSiteManager, effectivePermissions, staffCommunityRows, org } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS duty_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, date TEXT NOT NULL, shift TEXT NOT NULL,
    staff_id INTEGER, staff_name TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', data_json TEXT NOT NULL DEFAULT '{}',
    takeover_json TEXT, handover_json TEXT, prev_log_id INTEGER, flagged INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT, submitted_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_duty_logs ON duty_logs(tenant_id, community_id, date, shift);
  CREATE TABLE IF NOT EXISTS duty_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, name TEXT NOT NULL, note TEXT DEFAULT '', sort INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS duty_item_loans (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, item_id INTEGER NOT NULL, vendor TEXT NOT NULL, note TEXT DEFAULT '', out_by TEXT DEFAULT '', out_at TEXT NOT NULL, back_by TEXT DEFAULT '', back_at TEXT);
  CREATE TABLE IF NOT EXISTS duty_cash (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, kind TEXT NOT NULL, unit TEXT DEFAULT '', amount INTEGER NOT NULL,
    fee_type TEXT DEFAULT '', depositor TEXT DEFAULT '', recipient TEXT DEFAULT '', receipt_no TEXT DEFAULT '', note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'held', received_by TEXT DEFAULT '', received_by_id INTEGER, received_at TEXT NOT NULL,
    taken_by TEXT DEFAULT '', taken_by_id INTEGER, taken_to TEXT DEFAULT '', taken_at TEXT, void_reason TEXT DEFAULT '', voided_by TEXT DEFAULT '', voided_at TEXT, income_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_duty_cash ON duty_cash(tenant_id, community_id, status);
  CREATE TABLE IF NOT EXISTS site_income (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, date TEXT NOT NULL, category TEXT NOT NULL, unit TEXT DEFAULT '',
    amount INTEGER NOT NULL, receipt_no TEXT DEFAULT '', note TEXT DEFAULT '', source TEXT DEFAULT 'manual', source_id INTEGER, created_by TEXT DEFAULT '', created_at TEXT NOT NULL, voided_at TEXT, void_reason TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_site_income ON site_income(tenant_id, community_id, date);
  `);

  const PKG = { parcel: '包裹', registered: '掛號', deposit: '寄放物' };
  const FEE = ['管理費', '停車費', '其他'];
  const DENOM = [2000, 1000, 500, 200, 100, 50, 10, 5, 1];
  const SHIFT = { day: '日班', night: '夜班' };
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const int = v => Math.max(0, Math.round(Number(v) || 0));
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) res.status(e.status || 400).json({ error: e.message || '操作失敗' }); } };
  const tx = fn => db.transaction(fn)();
  const by = u => u?.name || u?.employee_id || '';
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };

  // ---------- 身分 ----------
  const isManager = u => { try { return isSiteManager(u); } catch { return false; } };
  function isFinance(u) {
    const m = mi(u); if (m?.position?.id === 'finance_secretary' || (m?.position?.perms || []).includes('finance')) return true;
    return /財務/.test(String(u?.position || '')) || /財務/.test(String(m?.position?.name || ''));
  }
  const canTakeFee = u => isManager(u) || isFinance(u);
  function isGuard(u) {
    const m = mi(u); if (m) return m.dept === 'duty' && ['site_staff', 'mobile', 'site_deputy'].includes(m.kind);
    return /保全|勤務|警衛|機動/.test(`${u?.position || ''}${u?.job_category || ''}${u?.job_level || ''}`);
  }
  function ctx(req, cidRaw) {
    const u = getUser(req); if (!u || !u.is_active || u.role === 'company_admin') throw err('這個帳號沒有權限', 403);
    const list = staffCommunityRows(u); if (!list.length) throw err('您目前沒有派駐的社區', 403);
    const cid = Number(cidRaw || req.session?.activeCommunityId || 0); const c = cid ? list.find(x => Number(x.id) === cid) : list[0];
    if (!c) throw err('您沒有這個社區的權限', 403);
    return { u, tid: tenantId(req), cid: Number(c.id), community: c, by: by(u) };
  }
  function companyCtx(req) {
    const u = getUser(req); if (!u) throw err('請先登入', 401);
    if (u.role !== 'company_admin') { const p = effectivePermissions(u) || []; if (!p.includes('work-journal') && !p.includes('company-work-journal')) throw err('您沒有勤務日誌管理權限', 403); }
    return { u, tid: tenantId(req) };
  }

  // ---------- 通知：社區經理＋勤務主管／勤務經理 ----------
  function recipients(tid, cid) {
    const ids = new Set();
    try { for (const { u, m } of org.people(tid)) { if ((m.kind === 'site_manager' && (m.sites || []).includes(Number(cid))) || (m.dept === 'duty' && ['dept_head', 'dept_manager'].includes(m.kind))) ids.add(u.id); } } catch {}
    return [...ids];
  }
  function notify(tid, cid, subject, body) {
    const admin = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1 ORDER BY id LIMIT 1").get(tid); if (!admin) return;
    for (const id of recipients(tid, cid)) {
      try { const to = db.prepare('SELECT * FROM staff_users WHERE id=?').get(id); if (!to) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, admin.id, to.id, admin.employee_id, '勤務日誌', to.employee_id, to.name, subject, body, 'text', '', now());
      } catch (e) { console.warn('duty notify', e.message); }
    }
  }
  const commName = id => db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '';

  // ---------- 資料 ----------
  const held = (tid, cid) => db.prepare("SELECT * FROM duty_cash WHERE tenant_id=? AND community_id=? AND status='held' ORDER BY received_at,id").all(tid, cid);
  const cashOut = r => ({ id: r.id, kind: r.kind, kind_label: r.kind === 'fee' ? '代收款' : '住戶寄放', unit: r.unit, amount: r.amount, fee_type: r.fee_type, depositor: r.depositor, recipient: r.recipient, receipt_no: r.receipt_no, note: r.note, status: r.status,
    received_by: r.received_by, received_at: r.received_at, taken_by: r.taken_by, taken_to: r.taken_to, taken_at: r.taken_at, void_reason: r.void_reason, voided_by: r.voided_by, voided_at: r.voided_at });
  function items(tid, cid) {
    return db.prepare('SELECT * FROM duty_items WHERE tenant_id=? AND community_id=? AND is_active=1 ORDER BY sort,id').all(tid, cid).map(i => {
      const loan = db.prepare('SELECT * FROM duty_item_loans WHERE item_id=? AND back_at IS NULL ORDER BY id DESC LIMIT 1').get(i.id);
      return { id: i.id, name: i.name, note: i.note, out: loan ? { id: loan.id, vendor: loan.vendor, note: loan.note, out_by: loan.out_by, out_at: loan.out_at } : null };
    });
  }
  const sumCash = rows => rows.reduce((s, r) => s + r.amount, 0);
  const countDenoms = o => DENOM.reduce((s, v) => s + v * int(o?.[v]), 0);
  // 班別順序：同一天日班在前；前一班＝這一班之前最後一份已送出的
  const order = l => `${l.date}${l.shift === 'day' ? 'A' : 'B'}`;
  function prevLog(tid, cid, date, shift) {
    const key = `${date}${shift === 'day' ? 'A' : 'B'}`;
    return db.prepare("SELECT * FROM duty_logs WHERE tenant_id=? AND community_id=? AND status='submitted' ORDER BY date DESC, CASE shift WHEN 'night' THEN 1 ELSE 0 END DESC").all(tid, cid).find(l => order(l) < key) || null;
  }
  function logOut(l, { full = true } = {}) {
    const o = { id: l.id, community_id: l.community_id, community_name: commName(l.community_id), date: l.date, shift: l.shift, shift_label: SHIFT[l.shift], staff_name: l.staff_name, status: l.status, flagged: !!l.flagged, submitted_at: l.submitted_at, updated_at: l.updated_at };
    if (full) { o.data = parse(l.data_json, {}); o.takeover = parse(l.takeover_json, null); o.handover = parse(l.handover_json, null); }
    return o;
  }

  // ================= 現場 =================
  const S = '/api/staff/duty';
  app.get(`${S}/context`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.query.community_id); const date = isDate(req.query.date) ? req.query.date : todayTW(); const shift = req.query.shift === 'night' ? 'night' : 'day';
    const log = db.prepare('SELECT * FROM duty_logs WHERE tenant_id=? AND community_id=? AND date=? AND shift=?').get(c.tid, c.cid, date, shift);
    const prev = prevLog(c.tid, c.cid, date, shift); const took = log && parse(log.takeover_json, null);
    const h = held(c.tid, c.cid);
    let vendors = []; try { vendors = db.prepare('SELECT name FROM community_vendors WHERE tenant_id=? AND community_id=? AND is_active=1 ORDER BY name').all(c.tid, c.cid).map(v => v.name); } catch {}
    res.set('Cache-Control', 'no-store');
    res.json({
      community: { id: c.cid, name: c.community.name }, date, shift, me: c.by, today: todayTW(), denoms: DENOM, pkg: PKG, fee_types: FEE,
      role: { guard: isGuard(c.u), manager: isManager(c.u), finance: isFinance(c.u), take_fee: canTakeFee(c.u) },
      log: log ? logOut(log) : null,
      // 先點再看：還沒點收前，不給上一班的件數與應有金額
      prev: prev ? { id: prev.id, date: prev.date, shift: prev.shift, shift_label: SHIFT[prev.shift], staff_name: prev.staff_name, todo: parse(prev.data_json, {}).next_todo || '', handover: took ? parse(prev.handover_json, null) : null } : null,
      cash: took || !prev ? { rows: h.map(cashOut), total: sumCash(h) } : { rows: [], total: null, hidden: true, count: h.length },
      items: items(c.tid, c.cid), vendors,
    });
  }));
  function ensureLog(c, date, shift) {
    let l = db.prepare('SELECT * FROM duty_logs WHERE tenant_id=? AND community_id=? AND date=? AND shift=?').get(c.tid, c.cid, date, shift);
    if (!l) { db.prepare('INSERT INTO duty_logs (tenant_id,community_id,date,shift,staff_id,staff_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(c.tid, c.cid, date, shift, c.u.id, c.by, now(), now()); l = db.prepare('SELECT * FROM duty_logs WHERE tenant_id=? AND community_id=? AND date=? AND shift=?').get(c.tid, c.cid, date, shift); }
    return l;
  }
  const dateShift = b => { if (!isDate(b?.date)) throw err('日期格式不正確'); return [b.date, b.shift === 'night' ? 'night' : 'day']; };
  // 接班點收
  app.post(`${S}/takeover`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const [date, shift] = dateShift(req.body); const b = req.body || {};
    const l = ensureLog(c, date, shift); if (l.status === 'submitted') throw err('這一班已經交班送出了');
    if (parse(l.takeover_json, null)) throw err('這一班已經點收過了');
    const prev = prevLog(c.tid, c.cid, date, shift); const ph = prev ? parse(prev.handover_json, {}) : null;
    const pk = Object.fromEntries(Object.keys(PKG).map(k => [k, int(b.packages?.[k])]));
    const counted = countDenoms(b.denoms); const h = held(c.tid, c.cid); const expect = sumCash(h);
    const diffs = [];
    if (ph) for (const k of Object.keys(PKG)) if (pk[k] !== int(ph.packages?.[k])) diffs.push(`${PKG[k]}：點到 ${pk[k]} 件，上一班移交 ${int(ph.packages?.[k])} 件`);
    if (counted !== expect) diffs.push(`現金：點到 $${money(counted)}，應有 $${money(expect)}（差 ${counted - expect > 0 ? '+' : ''}${money(counted - expect)}）`);
    const reason = str(b.reason, 500);
    if (diffs.length && !reason) return res.status(409).json({ error: '點收數量與應有數量不同，請寫下差異原因', diffs, expected: { packages: ph?.packages || null, cash: expect } });
    const t = { at: now(), by: c.by, packages: pk, denoms: Object.fromEntries(DENOM.map(v => [v, int(b.denoms?.[v])])), cash_counted: counted, cash_expected: expect, diffs, reason, prev_log_id: prev?.id || null, prev_staff: prev?.staff_name || '', handover_absent: !!b.handover_absent, first_time: !prev };
    db.prepare('UPDATE duty_logs SET takeover_json=?,prev_log_id=?,flagged=?,staff_id=COALESCE(staff_id,?),staff_name=CASE WHEN staff_name=\'\' THEN ? ELSE staff_name END,updated_at=? WHERE id=?').run(JSON.stringify(t), prev?.id || null, diffs.length || b.handover_absent ? 1 : 0, c.u.id, c.by, now(), l.id);
    if (diffs.length) notify(c.tid, c.cid, `⚠️ 交接點收有差異｜${commName(c.cid)}`, `${date} ${SHIFT[shift]} ${c.by} 接班點收時發現：\n${diffs.join('\n')}\n原因：${reason}\n上一班：${prev?.staff_name || '—'}（${prev ? `${prev.date} ${SHIFT[prev.shift]}` : ''}）\n請到「勤務日誌」查看。`);
    else if (b.handover_absent) notify(c.tid, c.cid, `交接時交班人不在場｜${commName(c.cid)}`, `${date} ${SHIFT[shift]} ${c.by} 接班時，上一班（${prev?.staff_name || '—'}）不在場；點收數量相符。`);
    res.json({ success: true, takeover: t });
  }));
  // 日誌內容（草稿自動儲存）
  app.put(`${S}/log`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const [date, shift] = dateShift(req.body); const l = ensureLog(c, date, shift);
    if (l.status === 'submitted') throw err('已經送出，內容已鎖定');
    const x = req.body?.data || {}; const rows = (v, keys, n) => (Array.isArray(v) ? v : []).map(r => Object.fromEntries(keys.map(k => [k, str(r?.[k], 300)]))).filter(r => keys.some(k => r[k])).slice(0, n);
    const data = { records: rows(x.records, ['time', 'content'], 80), visitors: rows(x.visitors, ['time', 'who', 'purpose', 'out'], 80), incidents: str(x.incidents, 3000), next_todo: str(x.next_todo, 2000), note: str(x.note, 2000) };
    db.prepare('UPDATE duty_logs SET data_json=?,updated_at=? WHERE id=?').run(JSON.stringify(data), now(), l.id);
    res.json({ success: true });
  }));
  // 交班送出：再點一次現金、寄物件數；內容鎖定，公司與社區經理收到副本
  app.post(`${S}/submit`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const [date, shift] = dateShift(req.body); const b = req.body || {}; const l = ensureLog(c, date, shift);
    if (l.status === 'submitted') throw err('已經送出了');
    const prev = prevLog(c.tid, c.cid, date, shift); if (prev && !parse(l.takeover_json, null)) throw err('請先完成接班點收');
    const pk = Object.fromEntries(Object.keys(PKG).map(k => [k, int(b.packages?.[k])]));
    const h = held(c.tid, c.cid); const expect = sumCash(h); const counted = countDenoms(b.denoms);
    const reason = str(b.reason, 500);
    if (counted !== expect && !reason) return res.status(409).json({ error: `現金點到 $${money(counted)}，帳上應有 $${money(expect)}，請重新點算；確定有差異請寫下原因`, expected: expect });
    const hv = { at: now(), by: c.by, packages: pk, denoms: Object.fromEntries(DENOM.map(v => [v, int(b.denoms?.[v])])), cash_counted: counted, cash_expected: expect, cash: h.map(cashOut), items: items(c.tid, c.cid), reason };
    const flag = counted !== expect;
    db.prepare("UPDATE duty_logs SET status='submitted',handover_json=?,submitted_at=?,updated_at=?,flagged=CASE WHEN ? THEN 1 ELSE flagged END,staff_name=CASE WHEN staff_name='' THEN ? ELSE staff_name END WHERE id=?").run(JSON.stringify(hv), now(), now(), flag ? 1 : 0, c.by, l.id);
    if (flag) notify(c.tid, c.cid, `⚠️ 交班現金有差異｜${commName(c.cid)}`, `${date} ${SHIFT[shift]} ${c.by} 交班：現金點到 $${money(counted)}，帳上應有 $${money(expect)}。\n原因：${reason}`);
    res.json({ success: true, log: logOut(db.prepare('SELECT * FROM duty_logs WHERE id=?').get(l.id)) });
  }));
  // 歷史（同社區已送出的日誌，唯讀）
  app.get(`${S}/logs`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.query.community_id); const from = isDate(req.query.from) ? req.query.from : '0000-00-00', to = isDate(req.query.to) ? req.query.to : '9999-12-31';
    res.set('Cache-Control', 'no-store');
    res.json({ rows: db.prepare("SELECT * FROM duty_logs WHERE tenant_id=? AND community_id=? AND status='submitted' AND date BETWEEN ? AND ? ORDER BY date DESC, shift DESC LIMIT 200").all(c.tid, c.cid, from, to).map(l => logOut(l, { full: false })) });
  }));
  app.get(`${S}/logs/:id`, requireStaff, wrap((req, res) => {
    const u = getUser(req); const l = db.prepare("SELECT * FROM duty_logs WHERE id=? AND tenant_id=? AND status='submitted'").get(Number(req.params.id), tenantId(req)); if (!l) throw err('找不到這份勤務日誌', 404);
    if (!staffCommunityRows(u).some(x => Number(x.id) === l.community_id)) throw err('您沒有這個社區的權限', 403);
    res.json({ log: logOut(l) });
  }));

  // ---------- 現金 ----------
  app.get(`${S}/cash`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.query.community_id); const st = ['held', 'taken', 'void'].includes(req.query.status) ? req.query.status : null;
    // 保全的「目前保管中」只能從接班點收後的畫面看到（先點再看）；經理、財務秘書隨時可查
    if ((!st || st === 'held') && !isManager(c.u) && !canTakeFee(c.u)) throw err('目前保管中的現金請在完成接班點收後查看', 403);
    res.set('Cache-Control', 'no-store');
    res.json({ rows: db.prepare(`SELECT * FROM duty_cash WHERE tenant_id=? AND community_id=? ${st ? 'AND status=?' : ''} ORDER BY id DESC LIMIT 300`).all(...[c.tid, c.cid, ...(st ? [st] : [])]).map(cashOut) });
  }));
  app.post(`${S}/cash`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const b = req.body || {}; const kind = b.kind === 'fee' ? 'fee' : 'deposit'; const amount = int(b.amount);
    if (!amount) throw err('請輸入金額'); const unit = str(b.unit, 30); if (!unit) throw err('請填寫戶別');
    if (kind === 'deposit' && !str(b.recipient, 30)) throw err('請填寫要交給誰（收件人）');
    const feeType = kind === 'fee' ? (FEE.includes(b.fee_type) ? b.fee_type : '管理費') : '';
    const id = Number(db.prepare('INSERT INTO duty_cash (tenant_id,community_id,kind,unit,amount,fee_type,depositor,recipient,receipt_no,note,received_by,received_by_id,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(c.tid, c.cid, kind, unit, amount, feeType, str(b.depositor, 30), str(b.recipient, 30), str(b.receipt_no, 40), str(b.note, 200), c.by, c.u.id, now()).lastInsertRowid);
    res.json({ success: true, row: cashOut(db.prepare('SELECT * FROM duty_cash WHERE id=?').get(id)) });
  }));
  const getCash = (c, id) => { const r = db.prepare('SELECT * FROM duty_cash WHERE id=? AND tenant_id=? AND community_id=?').get(Number(id), c.tid, c.cid); if (!r) throw err('找不到這筆現金紀錄', 404); if (r.status !== 'held') throw err('這筆已經領取或作廢了'); return r; };
  // 領取：住戶寄放＝保全登記交給誰；代收款＝只有財務秘書或經理，收據號碼必填，並帶入收入報表
  app.post(`${S}/cash/:id/take`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const r = getCash(c, req.params.id); const b = req.body || {};
    if (r.kind === 'fee') {
      if (!canTakeFee(c.u)) throw err('代收的管理費、停車費只能由財務秘書或經理領取；保全只能清點交接', 403);
      const receipt = str(b.receipt_no, 40) || r.receipt_no; if (!receipt) throw err('請填寫收據號碼，填完會自動帶入收入報表');
      tx(() => {
        const inc = Number(db.prepare("INSERT INTO site_income (tenant_id,community_id,date,category,unit,amount,receipt_no,note,source,source_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,'duty_fee',?,?,?)")
          .run(c.tid, c.cid, todayTW(), r.fee_type || '其他', r.unit, r.amount, receipt, `保全代收（${r.received_by}，${String(r.received_at).slice(0, 10)}）${r.note ? `；${r.note}` : ''}`, r.id, c.by, now()).lastInsertRowid);
        db.prepare("UPDATE duty_cash SET status='taken',taken_by=?,taken_by_id=?,taken_to=?,taken_at=?,receipt_no=?,income_id=? WHERE id=?").run(c.by, c.u.id, c.by, now(), receipt, inc, r.id);
      });
    } else {
      const to = str(b.taken_to, 30) || r.recipient; if (!to) throw err('請填寫領取人姓名');
      db.prepare("UPDATE duty_cash SET status='taken',taken_by=?,taken_by_id=?,taken_to=?,taken_at=? WHERE id=?").run(c.by, c.u.id, to, now(), r.id);
    }
    res.json({ success: true, row: cashOut(db.prepare('SELECT * FROM duty_cash WHERE id=?').get(r.id)) });
  }));
  // 作廢（登記錯誤時）：不能修改金額，只能作廢重登；一定要寫原因並通知經理
  app.post(`${S}/cash/:id/void`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const r = getCash(c, req.params.id); const reason = str(req.body?.reason, 300); if (!reason) throw err('請寫作廢原因');
    db.prepare("UPDATE duty_cash SET status='void',void_reason=?,voided_by=?,voided_at=? WHERE id=?").run(reason, c.by, now(), r.id);
    notify(c.tid, c.cid, `現金紀錄作廢｜${commName(c.cid)}`, `${c.by} 作廢了一筆現金紀錄：${r.kind === 'fee' ? `代收${r.fee_type}` : '住戶寄放'} ${r.unit} $${money(r.amount)}（${r.received_by} 登記）\n原因：${reason}`);
    res.json({ success: true });
  }));

  // ---------- 物品（鑰匙、門禁卡、對講機…） ----------
  app.post(`${S}/items`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); if (!isManager(c.u)) throw err('物品清單由社區經理設定', 403);
    const names = (Array.isArray(req.body?.names) ? req.body.names : [req.body?.name]).map(x => str(x, 40)).filter(Boolean); if (!names.length) throw err('請輸入物品名稱');
    const max = db.prepare('SELECT MAX(sort) m FROM duty_items WHERE tenant_id=? AND community_id=?').get(c.tid, c.cid)?.m || 0;
    names.forEach((n, i) => db.prepare('INSERT INTO duty_items (tenant_id,community_id,name,note,sort,created_at) VALUES (?,?,?,?,?,?)').run(c.tid, c.cid, n, str(req.body?.note, 100), max + i + 1, now()));
    res.json({ success: true, items: items(c.tid, c.cid) });
  }));
  app.delete(`${S}/items/:id`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.query.community_id); if (!isManager(c.u)) throw err('物品清單由社區經理設定', 403);
    const i = db.prepare('SELECT * FROM duty_items WHERE id=? AND tenant_id=? AND community_id=?').get(Number(req.params.id), c.tid, c.cid); if (!i) throw err('找不到物品', 404);
    if (db.prepare('SELECT 1 FROM duty_item_loans WHERE item_id=? AND back_at IS NULL').get(i.id)) throw err('這個物品借出中，歸還後才能移除');
    db.prepare('UPDATE duty_items SET is_active=0 WHERE id=?').run(i.id); res.json({ success: true, items: items(c.tid, c.cid) });
  }));
  app.post(`${S}/items/:id/lend`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const i = db.prepare('SELECT * FROM duty_items WHERE id=? AND tenant_id=? AND community_id=? AND is_active=1').get(Number(req.params.id), c.tid, c.cid); if (!i) throw err('找不到物品', 404);
    const vendor = str(req.body?.vendor, 60); if (!vendor) throw err('請填寫借用的廠商');
    if (db.prepare('SELECT 1 FROM duty_item_loans WHERE item_id=? AND back_at IS NULL').get(i.id)) throw err('這個物品已經借出了');
    db.prepare('INSERT INTO duty_item_loans (tenant_id,item_id,vendor,note,out_by,out_at) VALUES (?,?,?,?,?,?)').run(c.tid, i.id, vendor, str(req.body?.note, 100), c.by, now());
    res.json({ success: true, items: items(c.tid, c.cid) });
  }));
  app.post(`${S}/items/:id/return`, requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); const loan = db.prepare('SELECT l.* FROM duty_item_loans l JOIN duty_items i ON i.id=l.item_id WHERE l.item_id=? AND l.tenant_id=? AND i.community_id=? AND l.back_at IS NULL').get(Number(req.params.id), c.tid, c.cid);
    if (!loan) throw err('這個物品沒有借出');
    db.prepare('UPDATE duty_item_loans SET back_by=?,back_at=? WHERE id=?').run(c.by, now(), loan.id); res.json({ success: true, items: items(c.tid, c.cid) });
  }));

  // ---------- 收入報表（現場財務） ----------
  const canIncome = u => canTakeFee(u) || (effectivePermissions(u) || []).includes('finance');
  app.get('/api/staff/income', requireStaff, wrap((req, res) => {
    const c = ctx(req, req.query.community_id); if (!canIncome(c.u)) throw err('您沒有查看收入報表的權限', 403);
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayTW().slice(0, 7);
    const rows = db.prepare("SELECT * FROM site_income WHERE tenant_id=? AND community_id=? AND date LIKE ? ORDER BY date DESC,id DESC").all(c.tid, c.cid, `${m}-%`);
    const live = rows.filter(r => !r.voided_at); const by = {}; for (const r of live) by[r.category] = (by[r.category] || 0) + r.amount;
    res.set('Cache-Control', 'no-store');
    res.json({ month: m, community: c.community.name, can_edit: canTakeFee(c.u), categories: FEE, rows, total: live.reduce((s, r) => s + r.amount, 0), by_category: by });
  }));
  app.post('/api/staff/income', requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); if (!canTakeFee(c.u)) throw err('收入由財務秘書或經理登記', 403); const b = req.body || {};
    const amount = int(b.amount); if (!amount) throw err('請輸入金額'); if (!isDate(b.date)) throw err('請選擇日期');
    db.prepare("INSERT INTO site_income (tenant_id,community_id,date,category,unit,amount,receipt_no,note,source,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,'manual',?,?)").run(c.tid, c.cid, b.date, str(b.category, 20) || '其他', str(b.unit, 30), amount, str(b.receipt_no, 40), str(b.note, 200), c.by, now());
    res.json({ success: true });
  }));
  app.post('/api/staff/income/:id/void', requireStaff, wrap((req, res) => {
    const c = ctx(req, req.body?.community_id); if (!canTakeFee(c.u)) throw err('收入由財務秘書或經理登記', 403);
    const r = db.prepare('SELECT * FROM site_income WHERE id=? AND tenant_id=? AND community_id=? AND voided_at IS NULL').get(Number(req.params.id), c.tid, c.cid); if (!r) throw err('找不到這筆收入', 404);
    const reason = str(req.body?.reason, 200); if (!reason) throw err('請寫作廢原因');
    db.prepare('UPDATE site_income SET voided_at=?,void_reason=? WHERE id=?').run(now(), `${reason}（${c.by}）`, r.id); res.json({ success: true });
  }));

  // ================= 公司內勤（唯讀） =================
  app.get('/api/company/duty-logs', requireCompanyAdmin, wrap((req, res) => {
    const c = companyCtx(req); const q = req.query || {}; const from = isDate(q.from) ? q.from : '0000-00-00', to = isDate(q.to) ? q.to : '9999-12-31';
    const cid = Number(q.community_id || 0);
    const sc = d.companyCommunityScope ? d.companyCommunityScope(c.u) : null; // 區域督導只看負責區域
    const rows = db.prepare(`SELECT * FROM duty_logs WHERE tenant_id=? AND status='submitted' AND date BETWEEN ? AND ? ${cid ? 'AND community_id=?' : ''} ${q.flagged === '1' ? 'AND flagged=1' : ''} ORDER BY date DESC, shift DESC LIMIT 500`).all(...[c.tid, from, to, ...(cid ? [cid] : [])]).filter(l => !sc || sc.has(l.community_id));
    res.set('Cache-Control', 'no-store');
    res.json({ communities: db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(c.tid).filter(x => !sc || sc.has(x.id)), rows: rows.map(l => logOut(l, { full: false })) });
  }));
  app.get('/api/company/duty-logs/:id', requireCompanyAdmin, wrap((req, res) => {
    const c = companyCtx(req); const l = db.prepare("SELECT * FROM duty_logs WHERE id=? AND tenant_id=? AND status='submitted'").get(Number(req.params.id), c.tid); if (!l) throw err('找不到這份勤務日誌', 404);
    { const sc = d.companyCommunityScope ? d.companyCommunityScope(c.u) : null; if (sc && !sc.has(l.community_id)) throw err('這個社區不在您負責的區域', 403); }
    res.json({ log: logOut(l) });
  }));

  return { PKG, DENOM };
};
