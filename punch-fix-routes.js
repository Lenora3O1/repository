// 補打卡：現場人員忘記打卡時提出申請 → 依總後台為各公司設定的關卡審核 → 核准後寫入出勤紀錄（來源標示「補打卡」）
// 各公司可設定：是否開放、每月可申請幾次（0＝不限）、可以補幾天內的卡、審核關卡（直屬主管／現場主管／職務主管／區域督導／指定職位）
'use strict';
const LP = require('./leave-policy');

module.exports = function registerPunchFixRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaff, requireCompanyAdmin, getSiteAssignments, org, effectivePermissions } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS punch_fix_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, community_id INTEGER NOT NULL,
    record_type TEXT NOT NULL, fix_date TEXT NOT NULL, fix_time TEXT NOT NULL, fix_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', step_index INTEGER NOT NULL DEFAULT 0, steps_json TEXT NOT NULL DEFAULT '[]',
    record_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT, decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_punch_fix_staff ON punch_fix_requests(tenant_id,staff_id,fix_date);
  CREATE INDEX IF NOT EXISTS idx_punch_fix_status ON punch_fix_requests(tenant_id,status);
  CREATE TABLE IF NOT EXISTS punch_fix_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, step_index INTEGER, step_name TEXT DEFAULT '', actor_id INTEGER, actor_name TEXT DEFAULT '', action TEXT NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 300) => String(v ?? '').trim().slice(0, m);
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const TYPE = { checkin: '上班', checkout: '下班' };

  function settingsFor(tid) {
    const r = db.prepare('SELECT config_json FROM leave_policies WHERE tenant_id=?').get(tid);
    return LP.normalize(r ? parse(r.config_json, null) : null).policy.punch_fix;
  }
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1 ORDER BY id").all(tid).map(x => x.id);
  const nameOf = (tid, id) => staffRow(tid, id)?.name || '';

  // 審核關卡：依組織架構找審核人；找不到的關卡略過；全部都找不到時由公司管理員審核
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
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, '補打卡通知', body, 'text', '', now());
      } catch (e) { console.warn('punch-fix message failed', e.message); }
    }
  }

  // 通知審核人去哪裡審：駐點人員在現場工作台，內勤主管在公司內勤工作台
  function askReview(tid, from, ids, text) {
    const site = [], office = [];
    for (const id of ids) { const x = staffRow(tid, id); if (!x) continue; (x.role !== 'company_admin' && getSiteAssignments(x).length ? site : office).push(id); }
    if (site.length) notify(tid, from, site, `${text}\n請到現場工作台「出勤與巡邏 → 補打卡」審核。`);
    if (office.length) notify(tid, from, office, `${text}\n請到公司內勤工作台首頁的「待我審核的補打卡」（或「出勤與巡邏 → 補打卡審核」）處理。`);
  }
  function used(tid, staffId, month) {
    return db.prepare("SELECT COUNT(*) c FROM punch_fix_requests WHERE tenant_id=? AND staff_id=? AND substr(fix_date,1,7)=? AND status IN ('pending','approved')").get(tid, staffId, month).c;
  }
  function out(r, viewer) {
    const steps = parse(r.steps_json, []); const tid = r.tenant_id;
    const acts = db.prepare('SELECT * FROM punch_fix_actions WHERE request_id=? ORDER BY id').all(r.id);
    return {
      id: r.id, staff_id: r.staff_id, staff_name: nameOf(tid, r.staff_id), community_id: r.community_id,
      community_name: db.prepare('SELECT name FROM communities WHERE id=?').get(r.community_id)?.name || '',
      record_type: r.record_type, type_name: TYPE[r.record_type], fix_date: r.fix_date, fix_time: r.fix_time, reason: r.reason, status: r.status,
      current_step: r.status === 'pending' ? steps[r.step_index]?.name || '' : '',
      steps: steps.map((s, i) => ({ name: s.name, skipped: s.skipped, note: s.note || '', approvers: s.approvers.map(x => nameOf(tid, x)).filter(Boolean), state: s.skipped ? 'skipped' : r.status === 'pending' ? (i < r.step_index ? 'done' : i === r.step_index ? 'current' : 'waiting') : r.status === 'approved' ? 'done' : (i < r.step_index ? 'done' : i === r.step_index ? r.status : 'waiting') })),
      actions: acts.map(a => ({ step: a.step_name, actor: a.actor_name, action: a.action, comment: a.comment, at: a.created_at })),
      created_at: r.created_at, decided_at: r.decided_at, can_decide: canDecide(r, viewer), can_cancel: !!viewer && r.staff_id === viewer.id && r.status === 'pending',
    };
  }

  // ================= 現場人員 =================
  app.get('/api/staff/punch-fix', requireStaff, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req), s = settingsFor(tid), month = /^\d{4}-\d{2}$/.test(String(req.query?.month || '')) ? req.query.month : todayTW().slice(0, 7);
    const mine = db.prepare('SELECT * FROM punch_fix_requests WHERE tenant_id=? AND staff_id=? ORDER BY fix_date DESC,id DESC LIMIT 60').all(tid, u.id).map(r => out(r, u));
    const review = db.prepare("SELECT * FROM punch_fix_requests WHERE tenant_id=? AND status='pending' ORDER BY fix_date,id").all(tid).filter(r => canDecide(r, u) && (u.role !== 'company_admin' || isApproverOf(r, u))).map(r => out(r, u));
    const n = used(tid, u.id, month);
    res.json({ settings: { enabled: s.enabled, monthly_limit: s.monthly_limit, days_back: s.days_back, flow: s.flow.map(x => x.name) }, month, used: n, remaining: s.monthly_limit ? Math.max(0, s.monthly_limit - n) : null, earliest: addDays(todayTW(), -s.days_back), today: todayTW(), mine, review });
  }));
  app.post('/api/staff/punch-fix', requireStaff, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req), s = settingsFor(tid), b = req.body || {};
    if (!s.enabled) throw err('公司目前沒有開放補打卡，請洽主管');
    const type = TYPE[b.record_type] ? b.record_type : ''; if (!type) throw err('請選擇補上班卡或下班卡');
    const date = str(b.date, 10), time = str(b.time, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw err('請選擇日期');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw err('請填寫時間');
    const fixAt = new Date(Date.parse(`${date}T${time}:00+08:00`)).toISOString();
    if (Date.parse(fixAt) > Date.now()) throw err('不能補未來的打卡');
    if (date < addDays(todayTW(), -s.days_back)) throw err(`只能補 ${s.days_back} 天內的打卡，更早的請洽主管`);
    const cid = Number(b.community_id || 0); const ids = getSiteAssignments(u).map(x => Number(x.community_id));
    if (!cid || !ids.includes(cid)) throw err('請選擇您派駐的案場');
    const reason = str(b.reason, 200); if (reason.length < 2) throw err('請填寫忘記打卡的原因');
    if (db.prepare("SELECT 1 FROM punch_fix_requests WHERE tenant_id=? AND staff_id=? AND fix_date=? AND record_type=? AND status IN ('pending','approved')").get(tid, u.id, date, type)) throw err(`這天的${TYPE[type]}卡已經申請過補打卡`);
    if (db.prepare("SELECT 1 FROM attendance_records WHERE tenant_id=? AND staff_id=? AND record_type=? AND substr(datetime(recorded_at,'+8 hours'),1,10)=?").get(tid, u.id, type, date)) throw err(`這天已經有${TYPE[type]}打卡紀錄，不需要補打卡`);
    const month = date.slice(0, 7);
    if (s.monthly_limit && used(tid, u.id, month) >= s.monthly_limit) throw err(`${Number(month.slice(5))} 月的補打卡已達公司上限 ${s.monthly_limit} 次，請洽主管`);
    const steps = resolveSteps(tid, u, s.flow); const first = nextStep(steps, 0);
    const t = now();
    const info = db.prepare('INSERT INTO punch_fix_requests (tenant_id,staff_id,community_id,record_type,fix_date,fix_time,fix_at,reason,status,step_index,steps_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tid, u.id, cid, type, date, time, fixAt, reason, first < 0 ? 'approved' : 'pending', Math.max(0, first), JSON.stringify(steps), t, t);
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO punch_fix_actions (request_id,tenant_id,step_index,step_name,actor_id,actor_name,action,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, tid, null, '', u.id, u.name, 'submit', reason, t);
    const r = db.prepare('SELECT * FROM punch_fix_requests WHERE id=?').get(id);
    if (first < 0) approveFinal(r, u); else askReview(tid, u, steps[first].approvers, `🕒 ${u.name} 申請補打卡：${date} ${time} ${TYPE[type]}卡（${steps[first].name}）\n原因：${reason}`);
    res.json({ success: true, request: out(db.prepare('SELECT * FROM punch_fix_requests WHERE id=?').get(id), u) });
  }));
  app.post('/api/staff/punch-fix/:id/cancel', requireStaff, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req), r = db.prepare('SELECT * FROM punch_fix_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid);
    if (!r || r.staff_id !== u.id) throw err('找不到申請', 404); if (r.status !== 'pending') throw err('只能取消審核中的申請');
    db.prepare("UPDATE punch_fix_requests SET status='cancelled',updated_at=?,decided_at=? WHERE id=?").run(now(), now(), r.id);
    db.prepare('INSERT INTO punch_fix_actions (request_id,tenant_id,step_index,step_name,actor_id,actor_name,action,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(r.id, tid, r.step_index, '', u.id, u.name, 'cancel', '', now());
    res.json({ success: true });
  }));

  function approveFinal(r, u) {
    const t = now();
    const info = db.prepare('INSERT INTO attendance_records (tenant_id,staff_id,community_id,location_id,record_type,qr_token,lat,lng,accuracy_m,recorded_at,received_at,source,client_record_id,metadata_json) VALUES (?,?,?,NULL,?,?,NULL,NULL,NULL,?,?,?,?,?)')
      .run(r.tenant_id, r.staff_id, r.community_id, r.record_type, '', r.fix_at, t, 'fix', `FIX-${r.id}`, JSON.stringify({ punch_fix_id: r.id, approved_by: u?.name || '', reason: r.reason }));
    db.prepare("UPDATE punch_fix_requests SET status='approved',record_id=?,updated_at=?,decided_at=? WHERE id=?").run(Number(info.lastInsertRowid), t, t, r.id);
  }
  function decide(req, res) {
    const u = getUser(req), tid = tenantId(req), r = db.prepare('SELECT * FROM punch_fix_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid);
    if (!r) throw err('找不到申請', 404); if (!canDecide(r, u)) throw err('這張申請目前不是由您審核', 403);
    const action = req.body?.action === 'reject' ? 'reject' : req.body?.action === 'approve' ? 'approve' : ''; if (!action) throw err('請選擇核准或退回');
    const comment = str(req.body?.comment, 200); if (action === 'reject' && !comment) throw err('退回請填寫原因');
    const steps = parse(r.steps_json, []); const step = steps[r.step_index]; const asAdmin = u.role === 'company_admin' && !step?.approvers.includes(u.id);
    db.prepare('INSERT INTO punch_fix_actions (request_id,tenant_id,step_index,step_name,actor_id,actor_name,action,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(r.id, tid, r.step_index, (step?.name || '') + (asAdmin ? '（公司管理員）' : ''), u.id, u.name, action, comment, now());
    const who = staffRow(tid, r.staff_id); const label = `${r.fix_date} ${r.fix_time} ${TYPE[r.record_type]}卡`;
    if (action === 'reject') {
      db.prepare("UPDATE punch_fix_requests SET status='rejected',updated_at=?,decided_at=? WHERE id=?").run(now(), now(), r.id);
      notify(tid, u, [r.staff_id], `❌ 您的補打卡申請（${label}）被退回：${comment}`);
    } else {
      const nx = asAdmin ? -1 : nextStep(steps, r.step_index + 1);
      if (nx < 0) { approveFinal(r, u); notify(tid, u, [r.staff_id], `✅ 您的補打卡申請（${label}）已核准，出勤紀錄已補上。`); }
      else { db.prepare('UPDATE punch_fix_requests SET step_index=?,updated_at=? WHERE id=?').run(nx, now(), r.id); askReview(tid, u, steps[nx].approvers, `🕒 ${who?.name || ''} 申請補打卡：${label}\n原因：${r.reason}\n${step?.name || ''}已核准，換您審核（${steps[nx].name}）。`); }
    }
    res.json({ success: true, request: out(db.prepare('SELECT * FROM punch_fix_requests WHERE id=?').get(r.id), u) });
  }
  app.post('/api/staff/punch-fix/:id/decide', requireStaff, wrap(decide));

  // ================= 公司內勤：查看全部、公司管理員可直接審核 =================
  // 有出勤權限的內勤（勤務）看全部；其他內勤主管只看輪到自己審核過或要審核的申請
  const seesAll = u => u.role === 'company_admin' || (effectivePermissions ? effectivePermissions(u).includes('attendance') : false);
  app.get('/api/company/punch-fix', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req), tid = tenantId(req), st = String(req.query?.status || '');
    const rows = db.prepare(`SELECT * FROM punch_fix_requests WHERE tenant_id=? ${['pending', 'approved', 'rejected', 'cancelled'].includes(st) ? 'AND status=?' : ''} ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, fix_date DESC, id DESC LIMIT 300`).all(...(['pending', 'approved', 'rejected', 'cancelled'].includes(st) ? [tid, st] : [tid]));
    res.json({ settings: settingsFor(tid), rows: rows.filter(r => seesAll(u) || isApproverOf(r, u)).map(r => out(r, u)) });
  }));
  app.post('/api/company/punch-fix/:id/decide', requireCompanyAdmin, wrap(decide));

  return { settingsFor, pendingFor: (tid, u) => db.prepare("SELECT * FROM punch_fix_requests WHERE tenant_id=? AND status='pending'").all(tid).filter(r => canDecide(r, u) && (u.role !== 'company_admin' || isApproverOf(r, u))).length };
};
