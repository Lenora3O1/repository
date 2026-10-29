// 借支申請（預支薪資）：本人申請 → 依總後台為各公司設定的關卡審核 → 會計勾選「確認撥款」
// → 建立借資（當月薪資一次扣回）＋ 公司應支「員工借支」待付款
// 可借額度：本月已賺薪資（依班表已上班天數、扣除已核准請假）− 勞健保／勞退自提／公司保險費／代扣款／請假扣款
//          − 本月要扣回的借資與審核中的借支；公司規定最多借 1/N 時再取較小值；有固定級距時只能選級距
'use strict';
const LP = require('./leave-policy');

module.exports = function registerAdvanceRequestRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaff, requireCompanyAdmin, getSiteAssignments, org, effectivePermissions, payroll, ap } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS advance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, month TEXT NOT NULL, amount INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', step_index INTEGER NOT NULL DEFAULT 0, steps_json TEXT NOT NULL DEFAULT '[]',
    estimate_json TEXT NOT NULL DEFAULT '{}', on_behalf_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT, decided_at TEXT,
    disbursed_at TEXT, disbursed_by TEXT DEFAULT '', advance_id INTEGER, ap_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_adv_req_staff ON advance_requests(tenant_id,staff_id,month);
  CREATE INDEX IF NOT EXISTS idx_adv_req_status ON advance_requests(tenant_id,status);
  CREATE TABLE IF NOT EXISTS advance_request_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, step_name TEXT DEFAULT '', actor_id INTEGER, actor_name TEXT DEFAULT '', action TEXT NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 300) => String(v ?? '').trim().slice(0, m);
  const int = v => { const n = Math.round(Number(String(v ?? '').replace(/[,\s元]/g, ''))); return Number.isFinite(n) ? n : 0; };
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const daysIn = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const money = v => Number(v || 0).toLocaleString('en-US');
  const ACTIVE = "('pending','approved','disbursed')";

  function settingsFor(tid) { const r = db.prepare('SELECT config_json FROM leave_policies WHERE tenant_id=?').get(tid); return LP.normalize(r ? parse(r.config_json, null) : null).policy.advance; }
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1 ORDER BY id").all(tid).map(x => x.id);
  const nameOf = (tid, id) => staffRow(tid, id)?.name || '';
  const canPay = u => u?.role === 'company_admin' || (effectivePermissions ? effectivePermissions(u).includes('payroll') : false);

  // ---------- 可借額度 ----------
  function workedDays(tid, sid, month, today) {
    const rows = db.prepare('SELECT work_date,shift_code FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND month=?').all(tid, sid, month);
    const byDate = new Map(); for (const r of rows) { const w = !['off', 'leave'].includes(String(r.shift_code)); byDate.set(r.work_date, (byDate.get(r.work_date) || false) || w); }
    // 已核准的整天請假不算上班
    const leave = new Set(); try { for (const r of db.prepare("SELECT entries_json FROM leave_requests WHERE tenant_id=? AND staff_id=? AND status='approved' AND start_date<=? AND end_date>=?").all(tid, sid, `${month}-31`, `${month}-01`)) for (const e of parse(r.entries_json, [])) if (String(e.d).startsWith(month) && Number(e.h) >= 8) leave.add(e.d); } catch {}
    const work = [...byDate.entries()].filter(([dt, w]) => w && !leave.has(dt));
    return { total: work.length, worked: work.filter(([dt]) => dt <= today).length, scheduled: rows.length > 0, leave_days: [...leave].filter(dt => dt <= today).length };
  }
  function estimate(tid, u, s, today = todayTW()) {
    const month = today.slice(0, 7); const B = payroll.advanceBasis(tid, u, month);
    const out = { month, today, hire_date: B.hire_date, trial_end_date: B.trial_end_date, monthly: B.monthly, configured: B.configured, blocked: '', notes: [] };
    if (!s.enabled) return { ...out, blocked: '公司目前沒有開放借支申請' };
    if (!B.configured || !B.payroll_enabled) return { ...out, blocked: '您的薪資資料尚未設定完成，請洽公司會計' };
    if (B.hire_date) out.tenure_days = dayDiff(B.hire_date, today) + 1;
    if (s.min_days) { if (!B.hire_date) return { ...out, blocked: '人事資料還沒有登記到職日，請洽公司人事' }; if (out.tenure_days < s.min_days) return { ...out, blocked: `公司規定到職滿 ${s.min_days} 天才能借支（您目前到職第 ${out.tenure_days} 天）` }; }
    if (s.after_trial && B.trial_end_date && B.trial_end_date >= today) return { ...out, blocked: `試用期內不能借支（試用期到 ${B.trial_end_date}）` };
    if (s.deadline_day && Number(today.slice(8, 10)) > s.deadline_day) return { ...out, blocked: `本月借支申請已截止（公司規定每月 ${s.deadline_day} 號前申請），下個月再申請` };
    const mine = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM advance_requests WHERE tenant_id=? AND staff_id=? AND month=? AND status IN ${ACTIVE} AND status<>'disbursed'`).get(tid, u.id, month);
    const times = db.prepare(`SELECT COUNT(*) c FROM advance_requests WHERE tenant_id=? AND staff_id=? AND month=? AND status IN ${ACTIVE}`).get(tid, u.id, month).c;
    out.times_used = times;
    if (s.monthly_limit && times >= s.monthly_limit) return { ...out, blocked: `本月已申請 ${times} 次，公司規定每月最多 ${s.monthly_limit} 次` };
    // 本月已賺薪資：依班表（已上班天數／本月排班天數）；沒有班表時依日曆天數
    const W = workedDays(tid, u.id, month, today); const dim = daysIn(month);
    const startDay = B.hire_date && B.hire_date.startsWith(month) ? Number(B.hire_date.slice(8, 10)) : 1;
    let earned;
    if (W.scheduled && W.total) { earned = Math.floor(B.monthly * W.worked / W.total); out.basis = `依班表：本月排班 ${W.total} 天，到今天已上班 ${W.worked} 天${W.leave_days ? `（已扣除請假 ${W.leave_days} 天）` : ''}`; out.worked_days = W.worked; out.scheduled_days = W.total; }
    else { const days = Math.max(0, Number(today.slice(8, 10)) - startDay + 1); earned = Math.floor(B.monthly * days / dim); out.basis = `本月班表尚未排定，依日曆天數估算：到今天 ${days} 天／本月 ${dim} 天`; out.worked_days = days; out.notes.push('班表排定後，可借金額可能會變動'); }
    const must = B.ins_ee + B.company_ins_ee + B.deductions + B.leave_deduct;
    const already = B.advances_due + int(mine.s);
    out.earned = earned; out.must_deduct = must; out.breakdown = { ins: B.ins_ee, company_ins: B.company_ins_ee, deductions: B.deductions, leave: B.leave_deduct }; out.already = already;
    let cap = earned - must - already;
    if (s.ratio_den) { const byRatio = Math.floor(earned / s.ratio_den) - already; out.ratio_cap = Math.floor(earned / s.ratio_den); cap = Math.min(cap, byRatio); }
    cap = Math.max(0, Math.floor(cap / 100) * 100);
    out.available = cap;
    out.options = s.amounts.length ? s.amounts.filter(a => a <= cap) : [];
    if (s.amounts.length && !out.options.length) out.blocked = `目前可借 ${money(cap)} 元，未達公司規定的最低借支金額 ${money(s.amounts[0])} 元`;
    else if (!cap) out.blocked = '目前沒有可以借支的額度';
    return out;
  }

  // ---------- 審核關卡（與補打卡相同：依組織架構找審核人） ----------
  function resolveSteps(tid, applicant, flow) {
    const prefs = org?.prefsFor ? org.prefsFor(tid) : null;
    const steps = flow.map(s => {
      const r = (org?.resolveLeaveStep && org.resolveLeaveStep(tid, applicant, s, prefs)) || { approvers: [] };
      let ids = (r.approvers || []).filter(x => x !== applicant.id); let note = r.note || '';
      if (!ids.length && s.by === 'position') { ids = adminIds(tid).filter(x => x !== applicant.id); note = '沒有人擔任這個職位，由公司管理員審核'; }
      return { id: s.id, name: s.name, by: s.by, approvers: ids, note, skipped: !ids.length };
    });
    let last = '';
    for (const st of steps) { if (st.skipped) continue; const key = [...st.approvers].sort().join(','); if (key === last) { st.skipped = true; st.note = '與上一關審核人相同'; } else last = key; }
    if (!steps.some(s => !s.skipped)) { const ids = adminIds(tid).filter(x => x !== applicant.id); steps.push({ id: 'admin', name: '公司管理員', by: 'admin', approvers: ids, skipped: !ids.length }); }
    return steps;
  }
  const nextStep = (steps, from) => { for (let i = from; i < steps.length; i++) if (!steps[i].skipped) return i; return -1; };
  const canDecide = (r, u) => { if (!u || r.status !== 'pending' || r.staff_id === u.id) return false; if (u.role === 'company_admin') return true; return !!parse(r.steps_json, [])[r.step_index]?.approvers.includes(u.id); };
  const isApproverOf = (r, u) => parse(r.steps_json, []).some(s => s.approvers.includes(u.id));

  function notify(tid, from, toIds, body) {
    for (const toId of [...new Set(toIds)]) {
      try {
        const to = staffRow(tid, toId); if (!to) continue;
        let sender = from && from.id !== to.id ? from : null;
        if (!sender) { const a = adminIds(tid).find(x => x !== to.id); sender = a ? staffRow(tid, a) : null; }
        if (!sender) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, '借支通知', body, 'text', '', now());
      } catch (e) { console.warn('advance message failed', e.message); }
    }
  }
  function askReview(tid, from, ids, text) {
    const site = [], office = [];
    for (const id of ids) { const x = staffRow(tid, id); if (!x) continue; (x.role !== 'company_admin' && getSiteAssignments(x).length ? site : office).push(id); }
    if (site.length) notify(tid, from, site, `${text}\n請到現場工作台右上角「職員資料 → 借支申請」審核。`);
    if (office.length) notify(tid, from, office, `${text}\n請到公司內勤工作台首頁的「待我審核的借支」處理（會計也可以在「借資」頁處理）。`);
  }
  const act = (r, u, step, action, comment = '') => db.prepare('INSERT INTO advance_request_actions (request_id,tenant_id,step_name,actor_id,actor_name,action,comment,created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.id, r.tenant_id, step || '', u?.id || null, u?.name || '', action, comment, now());

  const ST = { pending: '審核中', approved: '待撥款', disbursed: '已撥款', rejected: '已退回', cancelled: '已取消' };
  function out(r, viewer) {
    const steps = parse(r.steps_json, []); const tid = r.tenant_id; const u = staffRow(tid, r.staff_id);
    const acts = db.prepare('SELECT * FROM advance_request_actions WHERE request_id=? ORDER BY id').all(r.id);
    return {
      id: r.id, staff_id: r.staff_id, staff_name: u?.name || '', employee_id: u?.employee_id || '', month: r.month, amount: r.amount, reason: r.reason,
      status: r.status, status_label: ST[r.status] || r.status, current_step: r.status === 'pending' ? steps[r.step_index]?.name || '' : '',
      steps: steps.map((s, i) => ({ name: s.name, skipped: s.skipped, note: s.note || '', approvers: s.approvers.map(x => nameOf(tid, x)).filter(Boolean), state: s.skipped ? 'skipped' : r.status === 'pending' ? (i < r.step_index ? 'done' : i === r.step_index ? 'current' : 'waiting') : ['approved', 'disbursed'].includes(r.status) ? 'done' : (i < r.step_index ? 'done' : i === r.step_index ? r.status : 'waiting') })),
      actions: acts.map(a => ({ step: a.step_name, actor: a.actor_name, action: a.action, comment: a.comment, at: a.created_at })),
      estimate: parse(r.estimate_json, {}), on_behalf_by: r.on_behalf_by || '', created_at: r.created_at, decided_at: r.decided_at, disbursed_at: r.disbursed_at, disbursed_by: r.disbursed_by,
      can_decide: canDecide(r, viewer), can_cancel: !!viewer && r.staff_id === viewer.id && r.status === 'pending',
    };
  }
  function create(tid, applicant, b, actor, onBehalf) {
    const s = settingsFor(tid); const est = estimate(tid, applicant, s);
    const amount = int(b.amount); const reason = str(b.reason, 200);
    if (!onBehalf) {
      if (est.blocked) throw err(est.blocked);
      if (amount <= 0) throw err('請選擇或填寫借支金額');
      if (s.amounts.length && !est.options.includes(amount)) throw err(`借支金額只能選：${est.options.map(money).join('、')} 元`);
      if (amount > est.available) throw err(`目前最多可借 ${money(est.available)} 元`);
    } else if (amount <= 0) throw err('請填寫借支金額');
    const steps = onBehalf ? [] : resolveSteps(tid, applicant, s.flow); const first = onBehalf ? -1 : nextStep(steps, 0);
    const t = now();
    const info = db.prepare('INSERT INTO advance_requests (tenant_id,staff_id,month,amount,reason,status,step_index,steps_json,estimate_json,on_behalf_by,created_at,updated_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tid, applicant.id, est.month, amount, reason, first < 0 ? 'approved' : 'pending', Math.max(0, first), JSON.stringify(steps), JSON.stringify(est), onBehalf ? (actor?.name || '') : '', t, t, first < 0 ? t : null);
    const r = db.prepare('SELECT * FROM advance_requests WHERE id=?').get(Number(info.lastInsertRowid));
    act(r, actor, '', onBehalf ? 'on_behalf' : 'submit', onBehalf ? `會計代為登記${reason ? `：${reason}` : ''}` : reason);
    if (first >= 0) askReview(tid, applicant, steps[first].approvers, `💰 ${applicant.name} 申請借支 ${money(amount)} 元（${steps[first].name}）${reason ? `\n事由：${reason}` : ''}`);
    return r;
  }
  function decide(req, res) {
    const u = getUser(req), tid = tenantId(req), r = db.prepare('SELECT * FROM advance_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid);
    if (!r) throw err('找不到申請', 404); if (!canDecide(r, u)) throw err('這張申請目前不是由您審核', 403);
    const action = req.body?.action === 'reject' ? 'reject' : req.body?.action === 'approve' ? 'approve' : ''; if (!action) throw err('請選擇核准或退回');
    const comment = str(req.body?.comment, 200); if (action === 'reject' && !comment) throw err('退回請填寫原因');
    const steps = parse(r.steps_json, []); const step = steps[r.step_index]; const asAdmin = u.role === 'company_admin' && !step?.approvers.includes(u.id);
    act(r, u, (step?.name || '') + (asAdmin ? '（公司管理員）' : ''), action, comment);
    const who = staffRow(tid, r.staff_id); const label = `借支 ${money(r.amount)} 元`;
    if (action === 'reject') { db.prepare("UPDATE advance_requests SET status='rejected',updated_at=?,decided_at=? WHERE id=?").run(now(), now(), r.id); notify(tid, u, [r.staff_id], `❌ 您的${label}申請被退回：${comment}`); }
    else {
      const nx = asAdmin ? -1 : nextStep(steps, r.step_index + 1);
      if (nx < 0) { db.prepare("UPDATE advance_requests SET status='approved',updated_at=?,decided_at=? WHERE id=?").run(now(), now(), r.id); notify(tid, u, [r.staff_id], `✅ 您的${label}申請已核准，等待會計撥款；撥款後會從 ${Number(r.month.slice(5))} 月薪資一次扣回。`); }
      else { db.prepare('UPDATE advance_requests SET step_index=?,updated_at=? WHERE id=?').run(nx, now(), r.id); askReview(tid, u, steps[nx].approvers, `💰 ${who?.name || ''} 申請借支 ${money(r.amount)} 元，${step?.name || ''}已核准，換您審核（${steps[nx].name}）。${r.reason ? `\n事由：${r.reason}` : ''}`); }
    }
    res.json({ success: true, request: out(db.prepare('SELECT * FROM advance_requests WHERE id=?').get(r.id), u) });
  }

  // ================= 本人（現場與內勤都可以） =================
  function mine(req, res) {
    const u = getUser(req), tid = tenantId(req), s = settingsFor(tid);
    const list = db.prepare('SELECT * FROM advance_requests WHERE tenant_id=? AND staff_id=? ORDER BY id DESC LIMIT 36').all(tid, u.id).map(r => out(r, u));
    const review = db.prepare("SELECT * FROM advance_requests WHERE tenant_id=? AND status='pending' ORDER BY id").all(tid).filter(r => canDecide(r, u) && (u.role !== 'company_admin' || isApproverOf(r, u))).map(r => out(r, u));
    res.set('Cache-Control', 'no-store');
    res.json({ settings: { enabled: s.enabled, ratio_den: s.ratio_den, amounts: s.amounts, monthly_limit: s.monthly_limit, min_days: s.min_days, after_trial: s.after_trial, deadline_day: s.deadline_day, flow: s.flow.map(x => x.name) }, estimate: estimate(tid, u, s), mine: list, review });
  }
  function submit(req, res) { const u = getUser(req); const r = create(tenantId(req), u, req.body || {}, u, false); res.json({ success: true, request: out(r, u) }); }
  function cancel(req, res) {
    const u = getUser(req), tid = tenantId(req), r = db.prepare('SELECT * FROM advance_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid);
    if (!r || r.staff_id !== u.id) throw err('找不到申請', 404); if (r.status !== 'pending') throw err('只能取消審核中的申請');
    db.prepare("UPDATE advance_requests SET status='cancelled',updated_at=?,decided_at=? WHERE id=?").run(now(), now(), r.id); act(r, u, '', 'cancel'); res.json({ success: true });
  }
  for (const [base, mw] of [['/api/staff', requireStaff], ['/api/company/my', requireCompanyAdmin]]) {
    app.get(`${base}/advance-requests`, mw, wrap(mine));
    app.post(`${base}/advance-requests`, mw, wrap(submit));
    app.post(`${base}/advance-requests/:id/cancel`, mw, wrap(cancel));
    app.post(`${base}/advance-requests/:id/decide`, mw, wrap(decide));
  }

  // ================= 公司：會計（全部、代為登記、確認撥款）；其他主管只看輪到自己的 =================
  app.get('/api/company/advance-requests', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req), all = canPay(u);
    const rows = db.prepare("SELECT * FROM advance_requests WHERE tenant_id=? ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id DESC LIMIT 300").all(tid).filter(r => all || isApproverOf(r, u));
    res.set('Cache-Control', 'no-store');
    res.json({ can_disburse: all, settings: settingsFor(tid), rows: rows.map(r => out(r, u)) });
  }));
  app.post('/api/company/advance-requests/:id/decide', requireCompanyAdmin, wrap(decide));
  // 會計代為登記（特殊狀況）：不走審核，直接成為待撥款，並留下代登記紀錄
  app.post('/api/company/advance-requests', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req); if (!canPay(u)) throw err('只有會計（薪資權限）可以代為登記', 403);
    const who = staffRow(tid, Number(req.body?.staff_id)); if (!who) throw err('請選擇人員');
    if (!str(req.body?.reason)) throw err('代為登記請填寫原因（會留下紀錄）');
    const r = create(tid, who, req.body || {}, u, true); notify(tid, u, [who.id], `💰 會計 ${u.name} 已代您登記借支 ${money(r.amount)} 元，撥款後會從 ${Number(r.month.slice(5))} 月薪資一次扣回。`);
    res.json({ success: true, request: out(r, u) });
  }));
  // 確認撥款：勾選的「待撥款」申請 → 建立借資（撥款月份的薪資一次扣回）＋ 公司應支「員工借支」
  app.post('/api/company/advance-requests/disburse', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req); if (!canPay(u)) throw err('只有會計（薪資權限）可以確認撥款', 403);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? req.body.date : todayTW();
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean))]; if (!ids.length) throw err('請勾選要撥款的借支');
    const rows = ids.map(id => db.prepare('SELECT * FROM advance_requests WHERE id=? AND tenant_id=?').get(id, tid));
    if (rows.some(r => !r || r.status !== 'approved')) throw err('只有「待撥款」的借支可以確認撥款');
    const month = date.slice(0, 7); let apRow = null;
    const doIt = db.transaction(() => {
      for (const r of rows) {
        const who = staffRow(tid, r.staff_id);
        const aid = payroll.createAdvance(tid, r.staff_id, { date, amount: r.amount, start_month: month, reason: `借支申請 #${r.id}${r.reason ? `：${r.reason}` : ''}`, by: u.name });
        db.prepare("UPDATE advance_requests SET status='disbursed',disbursed_at=?,disbursed_by=?,advance_id=?,updated_at=? WHERE id=?").run(date, u.name, aid, now(), r.id);
        act(r, u, '', 'disburse', date);
        notify(tid, u, [r.staff_id], `💵 您的借支 ${money(r.amount)} 元已於 ${date} 撥款，會從 ${Number(month.slice(5))} 月薪資一次扣回。`);
        void who;
      }
    });
    doIt();
    // 公司應支：同一批撥款合成一筆「員工借支」待付款（沒有開通會計模組時略過）
    let apNote = '';
    try {
      if (ap?.createAdvancePayable) {
        const total = rows.reduce((a, r) => a + r.amount, 0);
        apRow = ap.createAdvancePayable(tid, { payee: rows.length === 1 ? nameOf(tid, rows[0].staff_id) : `員工借支（${rows.length} 人）`, title: `員工借支 ${date}（${rows.length} 人）`, date, items: rows.map(r => ({ desc: `${nameOf(tid, r.staff_id)} 借支（申請 #${r.id}）`, amount: r.amount })), note: `合計 ${money(total)} 元`, log: `借支撥款 ${rows.length} 筆` }, u);
        if (apRow) db.prepare(`UPDATE advance_requests SET ap_id=? WHERE id IN (${rows.map(() => '?').join(',')})`).run(apRow.id, ...rows.map(r => r.id));
      }
    } catch (e) { apNote = `（公司應支未建立：${e.message}）`; console.warn('advance AP failed', e.message); }
    res.json({ success: true, count: rows.length, total: rows.reduce((a, r) => a + r.amount, 0), ap: apRow, note: apNote });
  }));

  const pendingFor = (tid, u) => db.prepare("SELECT * FROM advance_requests WHERE tenant_id=? AND status='pending'").all(tid).filter(r => r.staff_id !== u.id && (u.role === 'company_admin' || (parse(r.steps_json, [])[r.step_index]?.approvers || []).includes(u.id))).length;
  return { estimate: (tid, u) => estimate(tid, u, settingsFor(tid)), pendingFor };
};
