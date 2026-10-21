// 請假系統：申請 → 多層審核（依總後台設定的流程，公司管理員指定各關審核人員）→ 核准後自動寫入班表、
// 特休剩餘天數、當月薪資統計表的請假扣款／全勤獎金扣減。證明逾期未補依公司設定視為曠職。
'use strict';
const LP = require('./leave-policy');

module.exports = function registerLeaveRoutes(app, d) {
  const { db, fs, path, crypto, multer, DATA_DIR, getUser, tenantId, now, requireStaff, requireCompanyAdmin, requireSuperAdmin, getSiteAssignments, payroll, redDates } = d;
  const DIR = path.join(DATA_DIR, 'uploads', 'leave');
  fs.mkdirSync(DIR, { recursive: true });

  db.exec(`
  CREATE TABLE IF NOT EXISTS leave_policies (tenant_id INTEGER PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT, updated_by TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS leave_approvers (tenant_id INTEGER NOT NULL, step_id TEXT NOT NULL, staff_id INTEGER NOT NULL, PRIMARY KEY (tenant_id,step_id,staff_id));
  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, leave_type TEXT NOT NULL, sub TEXT DEFAULT '', event_date TEXT DEFAULT '',
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, hours REAL NOT NULL DEFAULT 0, days REAL NOT NULL DEFAULT 0, entries_json TEXT NOT NULL DEFAULT '[]', reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', step_index INTEGER NOT NULL DEFAULT 0, steps_json TEXT NOT NULL DEFAULT '[]', pay_ratio REAL NOT NULL DEFAULT 0,
    proof_req TEXT NOT NULL DEFAULT 'none', proof_due TEXT DEFAULT '', proof_status TEXT NOT NULL DEFAULT 'none', absent INTEGER NOT NULL DEFAULT 0, reminded INTEGER NOT NULL DEFAULT 0,
    schedule_json TEXT DEFAULT '', type_name TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT, decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_leave_requests_staff ON leave_requests(tenant_id,staff_id,status);
  CREATE TABLE IF NOT EXISTS leave_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, step_index INTEGER, step_name TEXT DEFAULT '', actor_id INTEGER, actor_name TEXT DEFAULT '', action TEXT NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_leave_actions_req ON leave_actions(request_id);
  CREATE TABLE IF NOT EXISTS leave_files (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, filename TEXT NOT NULL, original TEXT DEFAULT '', mime TEXT DEFAULT '', size INTEGER DEFAULT 0, uploaded_by TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);
  { const cols = db.prepare('PRAGMA table_info(hr_profiles)').all().map(c => c.name); if (cols.length && !cols.includes('gender')) db.exec("ALTER TABLE hr_profiles ADD COLUMN gender TEXT DEFAULT ''"); }

  // ---------- 小工具 ----------
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const range = (a, b) => { const out = []; for (let x = a; x <= b && out.length < 400; x = addDays(x, 1)) out.push(x); return out; };
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const str = (v, m = 300) => String(v ?? '').trim().slice(0, m);
  const r2 = v => Math.round(v * 100) / 100;
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); }); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => (db.transaction ? db.transaction(fn) : fn);
  const by = u => u?.name || u?.employee_id || '';
  const ACTIVE = "('pending','approved')";
  const STATUS = { pending: '審核中', approved: '已核准', rejected: '已退回', cancelled: '已取消' };
  const PROOF = { none: '', pending: '待補證明', submitted: '已上傳證明', verified: '證明已確認', waived: '免附證明', overdue: '逾期未補' };
  const canHR = u => payroll?.canHR ? payroll.canHR(u) : u?.role === 'company_admin';

  // ---------- 規則 ----------
  function policyFor(tid) { const r = db.prepare('SELECT config_json FROM leave_policies WHERE tenant_id=?').get(tid); return LP.normalize(r ? parse(r.config_json, null) : null).policy; }
  const typesFor = p => LP.typeList(p);
  const fmt = (h, hpd) => { const v = r2(h); if (v < hpd) return `${v} 小時`; const dd = r2(v / hpd); return Number.isInteger(dd) ? `${dd} 日` : `${dd} 日（${v} 小時）`; };
  function genderOf(tid, sid) { try { return db.prepare('SELECT gender FROM hr_profiles WHERE tenant_id=? AND staff_id=?').get(tid, sid)?.gender || ''; } catch { return ''; } }
  function hireOf(tid, sid) { try { return db.prepare('SELECT hire_date,annual_used FROM hr_profiles WHERE tenant_id=? AND staff_id=?').get(tid, sid) || {}; } catch { return {}; } }
  const redCache = new Map();
  function redSet(y) { if (!redCache.has(y) || redCache.get(y).at < Date.now() - 6 * 3600e3) { let list = []; try { list = redDates(Number(y)) || []; } catch {} redCache.set(y, { at: Date.now(), set: new Set(list) }); } return redCache.get(y).set; }
  // 需要上班的日子：有班表依班表（休假日不算），沒有班表時扣除例假日與國定假日
  function workDates(tid, sid, start, end, calendar) {
    const ds = range(start, end); if (calendar) return ds;
    let rows = []; try { rows = db.prepare('SELECT work_date,shift_code FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date BETWEEN ? AND ?').all(tid, sid, start, end); } catch {}
    const m = new Map(); for (const r of rows) (m.get(r.work_date) || m.set(r.work_date, []).get(r.work_date)).push(r.shift_code);
    return ds.filter(x => m.has(x) ? m.get(x).some(s => s !== 'off') : !redSet(x.slice(0, 4)).has(x));
  }
  // 某人有效（審核中＋已核准）假單的每日明細
  function activeEntries(tid, sid, { exclude = 0, statuses = ACTIVE } = {}) {
    return db.prepare(`SELECT * FROM leave_requests WHERE tenant_id=? AND staff_id=? AND status IN ${statuses} AND id<>?`).all(tid, sid, exclude || 0)
      .flatMap(r => parse(r.entries_json, []).map(e => ({ d: e.d, h: Number(e.h) || 0, type: r.leave_type, sub: r.sub, event: r.event_date, id: r.id, status: r.status })));
  }
  const sumH = list => list.reduce((a, e) => a + e.h, 0);
  // 生理假全年前 3 日不併入病假；超過的部分併入病假
  function menstrualMerged(list, hpd) { let acc = 0, merged = 0; for (const e of [...list].sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id)) { const free = Math.max(0, 3 * hpd - acc); merged += Math.max(0, e.h - free); acc += e.h; } return merged; }
  function annualWindow(tid, sid) { const h = hireOf(tid, sid); const al = payroll?.annualLeave ? payroll.annualLeave(h.hire_date, todayTW()) : null; return { al, manual: Number(h.annual_used) || 0 }; }
  function compBalance(tid, sid, year, hpd, exclude = 0) {
    let ot = 0; try { ot = db.prepare("SELECT COALESCE(SUM(hours),0) h FROM schedule_overtime WHERE tenant_id=? AND staff_id=? AND status<>'rejected' AND substr(work_date,1,4)=?").get(tid, sid, String(year)).h; } catch {}
    const used = sumH(activeEntries(tid, sid, { exclude }).filter(e => e.type === 'comp' && e.d.startsWith(String(year))));
    return Math.max(0, r2(Number(ot) - used));
  }

  // ---------- 額度檢查 ----------
  function checkQuota(tid, user, T, b, entries, policy, exclude) {
    const hpd = policy.hours_per_day; const others = activeEntries(tid, user.id, { exclude }); const warnings = [];
    const years = [...new Set(entries.map(e => e.d.slice(0, 4)))];
    const inYear = (list, y, types) => list.filter(e => e.d.startsWith(y) && types.includes(e.type));
    const q = k => { const t = typesFor(policy).find(x => x.key === k); return t?.quota || 0; };
    if (T.key === 'annual') {
      const { al, manual } = annualWindow(tid, user.id);
      if (!al) throw err('人事尚未登記您的到職日，系統無法計算特休，請洽人事');
      const mine = others.filter(e => e.type === 'annual');
      let win;
      if (al.days) win = [{ test: x => x < al.end, cap: (al.days - manual) * hpd, label: '本期' }, { test: x => x >= al.end && x < addDays(al.end, 365), cap: al.next_days * hpd, label: `${al.end} 起的下一期` }];
      else { if (entries.some(e => e.d < al.next_date)) throw err(`年資未滿 6 個月，${al.next_date} 起才有 ${al.next_days} 天特休`); win = [{ test: x => x >= al.next_date && x < addDays(al.next_date, 183), cap: al.next_days * hpd, label: `${al.next_date} 起` }]; }
      const miss = entries.find(e => !win.some(w => w.test(e.d))); if (miss) throw err(`${miss.d} 超出特休可預排的期間`);
      for (const w of win) { const need = sumH(entries.filter(e => w.test(e.d))); if (!need) continue; const left = w.cap - sumH(mine.filter(e => w.test(e.d))); if (need > left + 1e-9) throw err(`特休不足：${w.label}剩 ${fmt(Math.max(0, left), hpd)}，這次要請 ${fmt(need, hpd)}`); }
    }
    if (T.key === 'personal' || T.key === 'family') for (const y of years) {
      const need = sumH(entries.filter(e => e.d.startsWith(y)));
      const both = sumH(inYear(others, y, ['personal', 'family'])); const cap = q('personal') * hpd;
      if (both + need > cap + 1e-9) throw err(`${y} 年事假（含家庭照顧假）合計不得超過 ${q('personal')} 日，已請 ${fmt(both, hpd)}`);
      if (T.key === 'family') { const fam = sumH(inYear(others, y, ['family'])); if (fam + need > q('family') * hpd + 1e-9) throw err(`${y} 年家庭照顧假不得超過 ${q('family')} 日，已請 ${fmt(fam, hpd)}；超過可改請事假`); }
    }
    if (T.key === 'sick' && (b.sub || 'outpatient') === 'outpatient') for (const y of years) {
      const need = sumH(entries.filter(e => e.d.startsWith(y)));
      const used = sumH(inYear(others, y, ['sick']).filter(e => (e.sub || 'outpatient') === 'outpatient')) + menstrualMerged(inYear(others, y, ['menstrual']), hpd);
      if (used + need > q('sick') * hpd + 1e-9) throw err(`${y} 年未住院病假（含併入的生理假）不得超過 ${q('sick')} 日，已請 ${fmt(used, hpd)}；超過可改請事假或特休`);
      if (used <= 10 * hpd && used + need > 10 * hpd) warnings.push(`請完這次，${y} 年病假將超過 10 日（10 日以內公司不得做不利處分）`);
    }
    if (T.key === 'menstrual') for (const m of [...new Set(entries.map(e => e.d.slice(0, 7)))]) {
      const need = sumH(entries.filter(e => e.d.startsWith(m))); const used = sumH(others.filter(e => e.type === 'menstrual' && e.d.startsWith(m)));
      if (used + need > q('menstrual') * hpd + 1e-9) throw err(`生理假每月 ${q('menstrual')} 日，${Number(m.slice(5, 7))} 月已經請過了`);
      const yUsed = sumH(inYear(others, m.slice(0, 4), ['menstrual']));
      if (yUsed + need > 3 * hpd) warnings.push('今年生理假已超過 3 日，超過的部分會併入病假天數計算（一樣半薪）');
    }
    if (T.per === 'event') {
      let cap = (T.quota || 0) * hpd, same = others.filter(e => e.type === T.key && e.event === b.event_date);
      if (T.key === 'funeral') { const f = LP.FUNERAL.find(x => x[0] === b.sub); cap = f[2] * hpd; same = same.filter(e => e.sub === b.sub); if (b.start_date > addDays(b.event_date, 100)) warnings.push('喪假一般在百日內請畢，超過期限請先與人事確認'); }
      if (T.key === 'maternity') { const m = LP.MATERNITY.find(x => x[0] === b.sub); cap = m[2] * hpd; same = same.filter(e => e.sub === b.sub); }
      const need = sumH(entries);
      if (cap && sumH(same) + need > cap + 1e-9) throw err(`${T.name}（同一事由）最多 ${fmt(cap, hpd)}，已請 ${fmt(sumH(same), hpd)}`);
    } else if (!T.legal && T.quota) for (const y of years) {
      const used = sumH(inYear(others, y, [T.key])); const need = sumH(entries.filter(e => e.d.startsWith(y)));
      if (used + need > T.quota * hpd + 1e-9) throw err(`${T.name}一年最多 ${T.quota} 日，${y} 年已請 ${fmt(used, hpd)}`);
    }
    if (T.key === 'comp') { const y = entries[0].d.slice(0, 4); const bal = compBalance(tid, user.id, y, hpd, exclude); if (sumH(entries) > bal + 1e-9) throw err(`補休時數不足：剩 ${bal} 小時`); }
    return warnings;
  }

  // 依輸入算出假單內容（試算與送出共用）
  function build(tid, user, body, policy, exclude = 0) {
    const b = body || {}; const hpd = policy.hours_per_day;
    const T = typesFor(policy).find(t => t.key === b.type); if (!T) throw err('請選擇假別');
    const gender = genderOf(tid, user.id);
    if (T.female && gender !== 'F') throw err(gender ? `${T.name}限女性同仁申請` : `${T.name}限女性同仁申請；人事資料尚未登記您的性別，請洽人事`);
    if (!isDate(b.start_date)) throw err('請選擇開始日期');
    const end = isDate(b.end_date) ? b.end_date : b.start_date;
    if (end < b.start_date) throw err('結束日期不能早於開始日期');
    if (range(b.start_date, end).length > 120) throw err('一張假單最長 120 天，請分開申請');
    let sub = str(b.sub, 20);
    if (T.subs.length) { if (!sub && T.key === 'sick') sub = 'outpatient'; if (!T.subs.some(s => s.value === sub)) throw err(T.key === 'funeral' ? '請選擇親屬關係' : T.key === 'maternity' ? '請選擇產假類型' : '請選擇類別'); } else sub = '';
    const eventDate = T.per === 'event' ? b.event_date : '';
    if (T.per === 'event' && !isDate(eventDate)) throw err(`請填寫${T.event || '事由日期'}`);
    const reason = str(b.reason, 500);
    if (T.reason && !reason) throw err(`請填寫${T.name}的原因說明`);
    const dates = workDates(tid, user.id, b.start_date, end, T.calendar);
    if (!dates.length) throw err('這段期間沒有需要上班的日子（依班表或例假、國定假日），不需要請假');
    const unit = T.hourly || T.key === 'comp' ? 'hour' : policy.unit;
    let hours = hpd;
    if (b.hours !== undefined && b.hours !== null && b.hours !== '' && Number(b.hours) !== hpd) {
      if (dates.length > 1 || b.start_date !== end) throw err('以小時請假時，開始與結束要同一天');
      hours = Number(b.hours);
      if (unit === 'day') throw err('公司規定請假以「日」為單位');
      if (unit === 'half' && ![hpd / 2, hpd].includes(hours)) throw err(`公司規定請假以「半日」為單位（${hpd / 2} 小時）`);
      if (unit === 'hour' && !(Number.isInteger(hours) && hours >= 1 && hours <= hpd)) throw err(`請輸入 1～${hpd} 的整數小時`);
    }
    const entries = dates.map(x => ({ d: x, h: hours }));
    // 同一天已有假單：合計不能超過一天的工時
    const taken = new Map(); for (const e of activeEntries(tid, user.id, { exclude })) taken.set(e.d, (taken.get(e.d) || 0) + e.h);
    const clash = entries.find(e => (taken.get(e.d) || 0) + e.h > hpd + 1e-9); if (clash) throw err(`${clash.d} 已經有其他假單`);
    const warnings = checkQuota(tid, user, T, { ...b, end_date: end, sub, event_date: eventDate }, entries, policy, exclude);
    let pay = T.pay;
    if (T.key === 'maternity') { const h = hireOf(tid, user.id).hire_date; const al = h && payroll?.annualLeave ? payroll.annualLeave(h, b.start_date) : null; pay = al && al.service_months >= 6 ? 1 : 0.5; if (pay < 1) warnings.push('到職未滿 6 個月，產假期間工資減半發給'); }
    const total = sumH(entries);
    const proofDue = T.proof === 'required' ? addDays(end > todayTW() ? end : todayTW(), policy.proof_days) : '';
    if (b.start_date < todayTW()) warnings.push('這是補請假（日期已過），審核人員會一併確認');
    return { T, type: T.key, sub, event_date: eventDate, start_date: b.start_date, end_date: end, entries, hours: r2(total), days: r2(total / hpd), reason, pay_ratio: pay, proof_req: T.proof, proof_due: proofDue, warnings, unit, hpd };
  }

  // ---------- 審核流程 ----------
  const communitiesOf = u => new Set(getSiteAssignments(u).map(x => Number(x.community_id)).filter(Boolean));
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1 ORDER BY id").all(tid).map(x => x.id);
  function resolveSteps(tid, applicant, days, policy) {
    const mine = communitiesOf(applicant);
    const steps = policy.flow.filter(s => !s.min_days || days >= s.min_days).map(s => {
      let ids = db.prepare('SELECT a.staff_id FROM leave_approvers a JOIN staff_users u ON u.id=a.staff_id WHERE a.tenant_id=? AND a.step_id=? AND u.is_active=1').all(tid, s.id).map(x => x.staff_id).filter(x => x !== applicant.id);
      if (s.scope === 'community') { ids = ids.filter(x => { const u = staffRow(tid, x); return u && [...communitiesOf(u)].some(c => mine.has(c)); }); return { id: s.id, name: s.name, scope: s.scope, approvers: ids, skipped: !ids.length }; }
      // 全公司關卡沒有指定人員時，由公司管理員審核（不會被略過）
      if (!ids.length) { ids = adminIds(tid).filter(x => x !== applicant.id); return { id: s.id, name: s.name, scope: s.scope, approvers: ids, skipped: !ids.length, by_admin: true }; }
      return { id: s.id, name: s.name, scope: s.scope, approvers: ids, skipped: false };
    });
    if (!steps.some(s => !s.skipped)) { const ids = adminIds(tid).filter(x => x !== applicant.id); steps.push({ id: 'admin', name: '公司管理員', scope: 'company', approvers: ids, skipped: !ids.length }); }
    return steps;
  }
  const nextStep = (steps, from) => { for (let i = from; i < steps.length; i++) if (!steps[i].skipped) return i; return -1; };
  const canDecide = (r, u) => { if (r.status !== 'pending' || !u || r.staff_id === u.id) return false; if (u.role === 'company_admin') return true; const s = parse(r.steps_json, [])[r.step_index]; return !!s && s.approvers.includes(u.id); };
  const isApproverOf = (r, u) => parse(r.steps_json, []).some(s => s.approvers.includes(u.id));
  const canView = (r, u) => u && (r.staff_id === u.id || u.role === 'company_admin' || canHR(u) || isApproverOf(r, u));

  // ---------- 通知（內部訊息） ----------
  function notify(tid, from, toIds, body) {
    for (const toId of [...new Set(toIds)]) {
      try {
        const to = staffRow(tid, toId); if (!to) continue;
        let sender = from && from.id !== to.id ? from : null;
        if (!sender) { const a = adminIds(tid).find(x => x !== to.id); sender = a ? staffRow(tid, a) : null; }
        if (!sender) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, '請假通知', body, 'text', '', now());
      } catch (e) { console.warn('leave message failed', e.message); }
    }
  }
  const log = (r, u, action, comment = '', stepName = '') => db.prepare('INSERT INTO leave_actions (request_id,tenant_id,step_index,step_name,actor_id,actor_name,action,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(r.id, r.tenant_id, r.step_index, stepName, u?.id || null, u ? by(u) : '系統', action, str(comment, 500), now());
  const when = r => r.start_date === r.end_date ? r.start_date : `${r.start_date}～${r.end_date}`;

  // ---------- 核准後：寫入班表（班表只顯示「請假」，不顯示假別） ----------
  function applySchedule(r, actor) {
    const hpd = policyFor(r.tenant_id).hours_per_day; const backup = { entries: [], requests: [] };
    try {
      for (const e of parse(r.entries_json, [])) {
        const rows = db.prepare('SELECT id,shift_code,note,source,community_id FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date=?').all(r.tenant_id, r.staff_id, e.d);
        if (e.h >= hpd) for (const x of rows) if (x.shift_code !== 'off' && x.shift_code !== 'leave') { backup.entries.push({ id: x.id, shift_code: x.shift_code, note: x.note, source: x.source }); db.prepare("UPDATE schedule_entries SET shift_code='leave',note=?,source='leave',updated_at=? WHERE id=?").run('請假', now(), x.id); }
        const info = db.prepare('INSERT INTO schedule_requests (tenant_id,staff_id,community_id,work_date,request_type,target_staff_id,reason,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(r.tenant_id, r.staff_id, rows[0]?.community_id ?? null, e.d, 'leave', null, e.h >= hpd ? `請假（假單 #${r.id}）` : `請假 ${e.h} 小時（假單 #${r.id}）`, 'approved', actor?.id || null, now(), now());
        backup.requests.push(Number(info.lastInsertRowid));
      }
    } catch (e) { console.warn('leave schedule sync failed', e.message); }
    db.prepare('UPDATE leave_requests SET schedule_json=? WHERE id=?').run(JSON.stringify(backup), r.id);
  }
  function revertSchedule(r) {
    const b = parse(r.schedule_json, null); if (!b) return;
    try {
      for (const x of b.entries || []) db.prepare("UPDATE schedule_entries SET shift_code=?,note=?,source=?,updated_at=? WHERE id=? AND shift_code='leave'").run(x.shift_code, x.note || '', x.source || 'manual', now(), x.id);
      for (const id of b.requests || []) db.prepare('DELETE FROM schedule_requests WHERE id=?').run(id);
    } catch (e) { console.warn('leave schedule revert failed', e.message); }
    db.prepare("UPDATE leave_requests SET schedule_json='' WHERE id=?").run(r.id);
  }
  const reload = id => db.prepare('SELECT * FROM leave_requests WHERE id=?').get(id);
  function finalize(r, actor) {
    db.prepare("UPDATE leave_requests SET status='approved',decided_at=?,updated_at=? WHERE id=?").run(now(), now(), r.id);
    const x = reload(r.id); applySchedule(x, actor);
    notify(r.tenant_id, actor, [r.staff_id], `✅ 您的${r.type_name}（${when(r)}，${fmt(r.hours, policyFor(r.tenant_id).hours_per_day)}）已核准。${r.proof_status === 'pending' ? `\n請於 ${r.proof_due} 前上傳證明文件，逾期${policyFor(r.tenant_id).overdue_action === 'absent' ? '將視為曠職' : '會再提醒'}。` : ''}`);
  }

  // ---------- 證明逾期 ----------
  function sweep(tid) {
    const today = todayTW(); const where = tid ? 'AND tenant_id=?' : ''; const args = tid ? [tid] : [];
    for (const r of db.prepare(`SELECT * FROM leave_requests WHERE status IN ${ACTIVE} AND proof_status='pending' ${where}`).all(...args)) {
      const p = policyFor(r.tenant_id);
      if (r.proof_due && r.proof_due < today) {
        if (p.overdue_action === 'absent') {
          db.prepare("UPDATE leave_requests SET proof_status='overdue',absent=1,updated_at=? WHERE id=?").run(now(), r.id); log(r, null, 'overdue', '證明逾期未補交，依公司規定視為曠職');
          notify(r.tenant_id, null, [r.staff_id], `⚠ 您的${r.type_name}（${when(r)}）證明文件已超過補交期限（${r.proof_due}），依公司規定視為曠職。\n如已補交或有特殊狀況，請洽人事。`);
        } else if (!r.reminded || r.reminded < 2) { db.prepare('UPDATE leave_requests SET reminded=2 WHERE id=?').run(r.id); notify(r.tenant_id, null, [r.staff_id], `⏰ 您的${r.type_name}（${when(r)}）證明文件已超過補交期限（${r.proof_due}），請盡快上傳。`); }
      } else if (r.proof_due && addDays(today, 2) >= r.proof_due && !r.reminded) {
        db.prepare('UPDATE leave_requests SET reminded=1 WHERE id=?').run(r.id);
        notify(r.tenant_id, null, [r.staff_id], `⏰ 提醒：您的${r.type_name}（${when(r)}）請在 ${r.proof_due} 前上傳證明文件。`);
      }
    }
  }
  const timer = setInterval(() => { try { sweep(); } catch (e) { console.warn('leave sweep failed', e.message); } }, 3600e3); timer.unref?.();
  setTimeout(() => { try { sweep(); } catch {} }, 5000).unref?.();

  // ---------- 輸出 ----------
  function out(r, viewer) {
    const p = policyFor(r.tenant_id); const T = typesFor(p).find(t => t.key === r.leave_type);
    const u = staffRow(r.tenant_id, r.staff_id) || {};
    const steps = parse(r.steps_json, []); const acts = db.prepare('SELECT * FROM leave_actions WHERE request_id=? ORDER BY id').all(r.id);
    const name = id => staffRow(r.tenant_id, id)?.name || '';
    const sub = T?.subs?.find(s => s.value === r.sub)?.label || '';
    return {
      id: r.id, staff_id: r.staff_id, name: u.name || '', employee_id: u.employee_id || '', position: u.position || u.job_level || '',
      type: r.leave_type, type_name: r.type_name || T?.name || r.leave_type, sub: r.sub, sub_label: sub, event_date: r.event_date,
      start_date: r.start_date, end_date: r.end_date, hours: r.hours, days: r.days, length: fmt(r.hours, p.hours_per_day), entries: parse(r.entries_json, []), reason: r.reason,
      status: r.status, status_label: STATUS[r.status] || r.status, pay_ratio: r.pay_ratio,
      steps: steps.map((s, i) => ({ name: s.name, skipped: s.skipped, approvers: s.approvers.map(name).filter(Boolean), state: r.status === 'pending' ? (i < r.step_index ? 'done' : i === r.step_index ? 'current' : 'waiting') : r.status === 'approved' ? 'done' : 'waiting' })),
      current_step: r.status === 'pending' ? steps[r.step_index]?.name || '' : '',
      proof_req: r.proof_req, proof_due: r.proof_due, proof_status: r.proof_status, proof_label: PROOF[r.proof_status] || '', absent: !!r.absent,
      files: db.prepare('SELECT id,original,mime,size,uploaded_by,created_at FROM leave_files WHERE request_id=? ORDER BY id').all(r.id),
      actions: acts.map(a => ({ action: a.action, step_name: a.step_name, actor: a.actor_name, comment: a.comment, at: a.created_at })),
      created_at: r.created_at, decided_at: r.decided_at,
      can: viewer ? { cancel: r.staff_id === viewer.id && (r.status === 'pending' || (r.status === 'approved' && r.start_date > todayTW())), decide: canDecide(r, viewer), upload: (r.staff_id === viewer.id || canHR(viewer)) && r.proof_req !== 'none' && ['pending', 'approved'].includes(r.status), manage: canHR(viewer) || viewer.role === 'company_admin' } : {},
    };
  }
  function balances(tid, u, policy) {
    const hpd = policy.hours_per_day; const y = todayTW().slice(0, 4); const m = todayTW().slice(0, 7);
    const act = activeEntries(tid, u.id); const ap = act.filter(e => e.status === 'approved'), pe = act.filter(e => e.status === 'pending');
    const yr = (l, ks) => l.filter(e => e.d.startsWith(y) && ks.includes(e.type));
    const D = h => r2(h / hpd);
    const out_ = {};
    const { al, manual } = annualWindow(tid, u.id);
    if (al) { const inP = l => l.filter(e => e.type === 'annual' && (!al.days || (e.d < al.end))); out_.annual = { days: al.days, manual, used: r2(manual + D(sumH(inP(ap)))), pending: D(sumH(inP(pe))), left: al.days ? r2(Math.max(0, al.days - manual - D(sumH(inP(act))))) : 0, start: al.start, end: al.end, next_date: al.next_date, next_days: al.next_days }; }
    const q = k => typesFor(policy).find(x => x.key === k)?.quota || 0;
    out_.personal = { quota: q('personal'), used: D(sumH(yr(ap, ['personal', 'family']))), pending: D(sumH(yr(pe, ['personal', 'family']))) };
    out_.family = { quota: q('family'), used: D(sumH(yr(ap, ['family']))), pending: D(sumH(yr(pe, ['family']))) };
    const merged = menstrualMerged(yr(act, ['menstrual']), hpd);
    out_.sick = { quota: q('sick'), used: D(sumH(yr(ap, ['sick']).filter(e => (e.sub || 'outpatient') === 'outpatient')) + menstrualMerged(yr(ap, ['menstrual']), hpd)), pending: D(sumH(yr(pe, ['sick']).filter(e => (e.sub || 'outpatient') === 'outpatient'))), hospital: D(sumH(yr(ap, ['sick']).filter(e => e.sub === 'hospital'))), merged_menstrual: D(merged) };
    out_.menstrual = { quota: q('menstrual'), month_used: D(sumH(act.filter(e => e.type === 'menstrual' && e.d.startsWith(m)))), year_used: D(sumH(yr(act, ['menstrual']))) };
    if (policy.overtime_mode === 'comp') out_.comp = { hours: compBalance(tid, u.id, y, hpd) };
    for (const c of policy.custom.filter(c => c.enabled && c.quota && c.per === 'year')) out_[c.id] = { quota: c.quota, used: D(sumH(yr(ap, [c.id]))), pending: D(sumH(yr(pe, [c.id]))) };
    return out_;
  }

  // ================= 本人：請假申請、審核 =================
  const upload = multer({
    storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, DIR), filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'application/pdf': '.pdf' })[file.mimetype] || '.bin'}`) }),
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => (/^image\//.test(file.mimetype) || file.mimetype === 'application/pdf') ? cb(null, true) : cb(new Error('證明文件請上傳照片或 PDF')),
  }).array('files', 5);
  const getReq = (req, id) => { const r = db.prepare('SELECT * FROM leave_requests WHERE id=? AND tenant_id=?').get(Number(id), tenantId(req)); if (!r) throw err('找不到這張假單', 404); return r; };

  for (const [base, mw] of [['/api/staff', requireStaff], ['/api/company/my', requireCompanyAdmin]]) {
    app.get(`${base}/leave/meta`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const p = policyFor(tid); sweep(tid);
      const gender = genderOf(tid, u.id);
      const types = typesFor(p).filter(t => !t.female || gender === 'F');
      const isApprover = u.role === 'company_admin' || !!db.prepare('SELECT 1 FROM leave_approvers WHERE tenant_id=? AND staff_id=? LIMIT 1').get(tid, u.id);
      const pendingForMe = db.prepare("SELECT * FROM leave_requests WHERE tenant_id=? AND status='pending'").all(tid).filter(r => canDecide(r, u)).length;
      res.set('Cache-Control', 'no-store');
      res.json({ unit: p.unit, hours_per_day: p.hours_per_day, proof_days: p.proof_days, overdue_action: p.overdue_action, types, gender, gender_missing: !gender, flow: p.flow.map(s => ({ name: s.name, min_days: s.min_days })), balances: balances(tid, u, p), is_approver: isApprover, pending_for_me: pendingForMe, can_manage: canHR(u) || u.role === 'company_admin', is_admin: u.role === 'company_admin', today: todayTW() });
    }));
    app.post(`${base}/leave/preview`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const p = policyFor(tid);
      const x = build(tid, u, req.body, p);
      const steps = resolveSteps(tid, u, x.days, p);
      res.json({ ok: true, length: fmt(x.hours, p.hours_per_day), hours: x.hours, days: x.days, dates: x.entries.map(e => e.d), warnings: x.warnings, proof_due: x.proof_due, proof_req: x.proof_req, pay_ratio: x.pay_ratio, steps: steps.filter(s => !s.skipped).map(s => s.name) });
    }));
    app.get(`${base}/leave/requests`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); sweep(tid);
      const rows = db.prepare('SELECT * FROM leave_requests WHERE tenant_id=? AND staff_id=? ORDER BY start_date DESC,id DESC LIMIT 200').all(tid, u.id);
      res.set('Cache-Control', 'no-store'); res.json({ requests: rows.map(r => out(r, u)) });
    }));
    app.post(`${base}/leave/requests`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const p = policyFor(tid);
      let id;
      tx(() => {
        const x = build(tid, u, req.body, p);
        const steps = resolveSteps(tid, u, x.days, p); const first = nextStep(steps, 0);
        const info = db.prepare('INSERT INTO leave_requests (tenant_id,staff_id,leave_type,sub,event_date,start_date,end_date,hours,days,entries_json,reason,status,step_index,steps_json,pay_ratio,proof_req,proof_due,proof_status,type_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(tid, u.id, x.type, x.sub, x.event_date, x.start_date, x.end_date, x.hours, x.days, JSON.stringify(x.entries), x.reason, 'pending', Math.max(0, first), JSON.stringify(steps), x.pay_ratio, x.proof_req, x.proof_due, x.proof_req === 'required' ? 'pending' : 'none', x.T.name, now(), now());
        id = Number(info.lastInsertRowid);
      })();
      const r = reload(id); log(r, u, 'submit', '', '');
      const steps = parse(r.steps_json, []); const first = nextStep(steps, 0);
      if (first < 0) { log(r, null, 'approve', '沒有可審核的人員，系統自動核准'); finalize(r, u); }
      else notify(tid, u, steps[first].approvers, `📝 ${u.name} 申請${r.type_name}：${when(r)}（${fmt(r.hours, p.hours_per_day)}），等待您審核（${steps[first].name}）。\n請到「請假」→「待我審核」處理。`);
      res.json({ success: true, request: out(reload(id), u) });
    }));
    app.get(`${base}/leave/requests/:id`, mw, wrap((req, res) => {
      const u = getUser(req); const r = getReq(req, req.params.id); if (!canView(r, u)) return bad(res, '您沒有權限查看這張假單', 403);
      res.set('Cache-Control', 'no-store'); res.json({ request: out(r, u) });
    }));
    app.post(`${base}/leave/requests/:id/cancel`, mw, wrap((req, res) => {
      const u = getUser(req); const r = getReq(req, req.params.id);
      if (r.staff_id !== u.id) return bad(res, '只能取消自己的假單', 403);
      if (r.status === 'approved' && r.start_date <= todayTW()) return bad(res, '假期已經開始，請洽人事辦理撤銷');
      if (!['pending', 'approved'].includes(r.status)) return bad(res, '這張假單已經結案');
      const wasApproved = r.status === 'approved';
      db.prepare("UPDATE leave_requests SET status='cancelled',updated_at=? WHERE id=?").run(now(), r.id); if (wasApproved) revertSchedule(r);
      log(r, u, 'cancel', str(req.body?.comment, 200));
      const steps = parse(r.steps_json, []);
      notify(r.tenant_id, u, wasApproved ? steps.flatMap(s => s.approvers) : (steps[r.step_index]?.approvers || []), `↩ ${u.name} 已取消${r.type_name}（${when(r)}）。`);
      res.json({ success: true, request: out(reload(r.id), u) });
    }));
    app.post(`${base}/leave/requests/:id/decide`, mw, wrap((req, res) => {
      const u = getUser(req); const r = getReq(req, req.params.id);
      if (!canDecide(r, u)) return bad(res, r.status !== 'pending' ? '這張假單已經處理過了' : '目前不是由您審核這張假單', 403);
      const action = req.body?.action === 'reject' ? 'reject' : 'approve'; const comment = str(req.body?.comment, 500);
      const steps = parse(r.steps_json, []); const step = steps[r.step_index];
      const asAdmin = u.role === 'company_admin' && !step?.approvers.includes(u.id);
      if (action === 'reject') {
        if (!comment) return bad(res, '退回時請填寫原因');
        db.prepare("UPDATE leave_requests SET status='rejected',decided_at=?,updated_at=? WHERE id=?").run(now(), now(), r.id); log(r, u, 'reject', comment, step?.name || '');
        notify(r.tenant_id, u, [r.staff_id], `❌ 您的${r.type_name}（${when(r)}）被退回（${step?.name || ''}：${u.name}）。\n原因：${comment}`);
      } else {
        log(r, u, asAdmin ? 'admin_approve' : 'approve', asAdmin ? `公司管理員直接核准${comment ? `：${comment}` : ''}` : comment, step?.name || '');
        // 公司管理員不是這一關的審核人時，等於直接核准（略過後續關卡）
        const nx = asAdmin ? -1 : nextStep(steps, r.step_index + 1);
        if (nx < 0) finalize(r, u);
        else { db.prepare('UPDATE leave_requests SET step_index=?,updated_at=? WHERE id=?').run(nx, now(), r.id); const s = staffRow(r.tenant_id, r.staff_id); notify(r.tenant_id, u, steps[nx].approvers, `📝 ${s?.name || ''} 申請${r.type_name}：${when(r)}（${fmt(r.hours, policyFor(r.tenant_id).hours_per_day)}），${step?.name || ''}已核准，等待您審核（${steps[nx].name}）。`); }
      }
      res.json({ success: true, request: out(reload(r.id), u) });
    }));
    app.get(`${base}/leave/approvals`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); sweep(tid);
      const pending = db.prepare("SELECT * FROM leave_requests WHERE tenant_id=? AND status='pending' ORDER BY start_date,id").all(tid).filter(r => canDecide(r, u));
      const doneIds = db.prepare("SELECT DISTINCT request_id FROM leave_actions WHERE tenant_id=? AND actor_id=? AND action IN ('approve','reject','admin_approve') ORDER BY id DESC LIMIT 100").all(tid, u.id).map(x => x.request_id);
      const done = doneIds.map(id => reload(id)).filter(Boolean).filter(r => r.staff_id !== u.id);
      res.set('Cache-Control', 'no-store'); res.json({ pending: pending.map(r => out(r, u)), done: done.map(r => out(r, u)) });
    }));
    app.post(`${base}/leave/requests/:id/files`, mw, (req, res) => {
      let r; const u = getUser(req);
      try { r = getReq(req, req.params.id); } catch (e) { return bad(res, e.message, e.status); }
      if (!(r.staff_id === u.id || canHR(u))) return bad(res, '您沒有權限上傳這張假單的證明', 403);
      if (!['pending', 'approved'].includes(r.status)) return bad(res, '這張假單已經結案');
      upload(req, res, e => {
        if (e) return bad(res, e.code === 'LIMIT_FILE_SIZE' ? '檔案太大了（每個最多 10MB）' : e.message || '上傳失敗');
        const files = req.files || (req.file ? [req.file] : []); if (!files.length) return bad(res, '請選擇檔案');
        for (const f of files) db.prepare('INSERT INTO leave_files (request_id,tenant_id,filename,original,mime,size,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.id, r.tenant_id, f.filename, str(f.originalname || '', 120), f.mimetype, f.size || 0, by(u), now());
        if (['pending', 'overdue', 'none'].includes(r.proof_status)) db.prepare("UPDATE leave_requests SET proof_status='submitted',updated_at=? WHERE id=?").run(now(), r.id);
        log(r, u, 'proof_upload', `${files.length} 個檔案`);
        if (r.proof_status === 'overdue') { const hr = db.prepare("SELECT DISTINCT actor_id FROM leave_actions WHERE request_id=? AND actor_id IS NOT NULL AND actor_id<>?").all(r.id, r.staff_id).map(x => x.actor_id); notify(r.tenant_id, u, hr.length ? hr : adminIds(r.tenant_id), `📎 ${staffRow(r.tenant_id, r.staff_id)?.name || ''} 補交了逾期的${r.type_name}證明（${when(r)}），請人事確認是否取消曠職。`); }
        res.json({ success: true, request: out(reload(r.id), u) });
      });
    });
    app.get(`${base}/leave/files/:fid`, mw, wrap((req, res) => {
      const u = getUser(req); const f = db.prepare('SELECT * FROM leave_files WHERE id=? AND tenant_id=?').get(Number(req.params.fid), tenantId(req)); if (!f) return bad(res, '找不到檔案', 404);
      const r = reload(f.request_id); if (!r || !canView(r, u)) return bad(res, '您沒有權限查看這份證明', 403);
      const file = path.join(DIR, path.basename(f.filename)); if (!fs.existsSync(file)) return bad(res, '檔案不存在', 404);
      res.setHeader('Content-Type', f.mime || 'application/octet-stream'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original || 'proof')}`);
      res.sendFile(file);
    }));
  }

  // ================= 公司：請假管理（人事）、審核人員設定（公司管理員） =================
  const needHR = (req, res, next) => { const u = getUser(req); if (!(canHR(u) || u?.role === 'company_admin')) return bad(res, '需要「人事資料設定」權限', 403); next(); };
  const needAdmin = (req, res, next) => { const u = getUser(req); if (u?.role !== 'company_admin') return bad(res, '只有公司管理員可以設定審核人員', 403); next(); };
  app.get('/api/company/leave/requests', requireCompanyAdmin, needHR, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); sweep(tid); const q = req.query || {};
    const args = [tid]; let where = 'tenant_id=?';
    if (['pending', 'approved', 'rejected', 'cancelled'].includes(q.status)) { where += ' AND status=?'; args.push(q.status); }
    if (isMonth(q.month)) { where += ' AND start_date<=? AND end_date>=?'; args.push(`${q.month}-31`, `${q.month}-01`); }
    if (q.staff_id) { where += ' AND staff_id=?'; args.push(Number(q.staff_id)); }
    if (q.proof === 'todo') where += " AND proof_status IN ('pending','submitted','overdue') AND status IN ('pending','approved')";
    const rows = db.prepare(`SELECT * FROM leave_requests WHERE ${where} ORDER BY start_date DESC,id DESC LIMIT 500`).all(...args);
    res.set('Cache-Control', 'no-store'); res.json({ requests: rows.map(r => out(r, u)) });
  }));
  app.get('/api/company/leave/balances', requireCompanyAdmin, needHR, wrap((req, res) => {
    const tid = tenantId(req); const p = policyFor(tid);
    const staff = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY role='company_admin' DESC,employee_id").all(tid);
    res.json({ rows: staff.map(s => ({ staff_id: s.id, name: s.name, employee_id: s.employee_id, gender: genderOf(tid, s.id), balances: balances(tid, s, p) })), policy: { hours_per_day: p.hours_per_day, overtime_mode: p.overtime_mode } });
  }));
  app.post('/api/company/leave/requests/:id/proof', requireCompanyAdmin, needHR, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req, req.params.id); const a = req.body?.action; const comment = str(req.body?.comment, 300);
    if (!['verify', 'waive', 'reject'].includes(a)) return bad(res, '操作不正確');
    if (a === 'reject') { const due = addDays(todayTW(), policyFor(r.tenant_id).proof_days); db.prepare("UPDATE leave_requests SET proof_status='pending',proof_due=?,reminded=0,updated_at=? WHERE id=?").run(due, now(), r.id); notify(r.tenant_id, u, [r.staff_id], `📎 您的${r.type_name}（${when(r)}）證明文件需要重新補交，請在 ${due} 前上傳。${comment ? `\n說明：${comment}` : ''}`); }
    else db.prepare('UPDATE leave_requests SET proof_status=?,absent=0,updated_at=? WHERE id=?').run(a === 'verify' ? 'verified' : 'waived', now(), r.id);
    log(r, u, `proof_${a}`, comment);
    res.json({ success: true, request: out(reload(r.id), u) });
  }));
  app.post('/api/company/leave/requests/:id/revoke', requireCompanyAdmin, needHR, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req, req.params.id); const comment = str(req.body?.comment, 300);
    if (!['pending', 'approved'].includes(r.status)) return bad(res, '這張假單已經結案'); if (!comment) return bad(res, '請填寫撤銷原因');
    const wasApproved = r.status === 'approved';
    db.prepare("UPDATE leave_requests SET status='cancelled',updated_at=? WHERE id=?").run(now(), r.id); if (wasApproved) revertSchedule(r);
    log(r, u, 'revoke', comment);
    notify(r.tenant_id, u, [r.staff_id], `↩ 您的${r.type_name}（${when(r)}）已由人事撤銷。\n原因：${comment}`);
    let warn = ''; try { const months = [...new Set(parse(r.entries_json, []).map(e => e.d.slice(0, 7)))]; const pub = months.filter(m => db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status='published'").get(r.tenant_id, m)); if (pub.length) warn = `${pub.join('、')} 的薪資已經發布，請會計撤回後重新計算。`; } catch {}
    res.json({ success: true, warning: warn, request: out(reload(r.id), u) });
  }));
  app.get('/api/company/leave/approvers', requireCompanyAdmin, wrap((req, res) => {
    const tid = tenantId(req); const p = policyFor(tid);
    const rows = db.prepare('SELECT step_id,staff_id FROM leave_approvers WHERE tenant_id=?').all(tid);
    const staff = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY role='company_admin' DESC,employee_id").all(tid)
      .map(s => ({ id: s.id, name: s.name, employee_id: s.employee_id, role: s.role, position: s.position || s.job_level || '', work_type: s.work_type || '', communities: getSiteAssignments(s).map(a => a.community_name).filter(Boolean) }));
    res.json({ flow: p.flow, approvers: Object.fromEntries(p.flow.map(s => [s.id, rows.filter(x => x.step_id === s.id).map(x => x.staff_id)])), staff, can_edit: getUser(req).role === 'company_admin', policy: { unit: p.unit, hours_per_day: p.hours_per_day, proof_days: p.proof_days, overdue_action: p.overdue_action, daily_wage_mode: p.daily_wage_mode, wage_includes_allowances: p.wage_includes_allowances, overtime_mode: p.overtime_mode, overtime_auto: p.overtime_auto, attendance: p.attendance }, types: typesFor(p) });
  }));
  app.put('/api/company/leave/approvers', requireCompanyAdmin, needAdmin, wrap((req, res) => {
    const tid = tenantId(req); const p = policyFor(tid); const body = req.body?.approvers || {};
    const valid = new Set(db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND is_active=1').all(tid).map(x => x.id));
    tx(() => {
      for (const s of p.flow) {
        db.prepare('DELETE FROM leave_approvers WHERE tenant_id=? AND step_id=?').run(tid, s.id);
        for (const sid of (Array.isArray(body[s.id]) ? body[s.id] : []).map(Number).filter(x => valid.has(x)).slice(0, 50)) db.prepare('INSERT OR IGNORE INTO leave_approvers (tenant_id,step_id,staff_id) VALUES (?,?,?)').run(tid, s.id, sid);
      }
    })();
    res.json({ success: true });
  }));

  // ================= 總後台：各公司請假規則 =================
  if (requireSuperAdmin) {
    app.get('/api/admin/leave-policies', requireSuperAdmin, wrap((req, res) => {
      const saved = new Map(db.prepare('SELECT tenant_id,updated_at,updated_by FROM leave_policies').all().map(x => [x.tenant_id, x]));
      const tenants = db.prepare('SELECT id,name,code,status FROM tenants ORDER BY id').all().map(t => ({ ...t, customized: saved.has(t.id), updated_at: saved.get(t.id)?.updated_at || '' }));
      res.json({ tenants, legal: { types: LP.TYPES, funeral: LP.FUNERAL, maternity: LP.MATERNITY }, defaults: LP.defaults() });
    }));
    app.get('/api/admin/leave-policies/:tid', requireSuperAdmin, wrap((req, res) => {
      const tid = Number(req.params.tid); if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)) return bad(res, '找不到公司', 404);
      const r = db.prepare('SELECT * FROM leave_policies WHERE tenant_id=?').get(tid); const p = policyFor(tid);
      res.json({ policy: p, customized: !!r, updated_at: r?.updated_at || '', updated_by: r?.updated_by || '', types: typesFor({ ...p, overtime_mode: 'comp' }) });
    }));
    app.put('/api/admin/leave-policies/:tid', requireSuperAdmin, wrap((req, res) => {
      const tid = Number(req.params.tid); if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)) return bad(res, '找不到公司', 404);
      const { policy, notes } = LP.normalize(req.body?.policy || req.body);
      if (!policy.flow.length) return bad(res, '審核流程至少要有一關');
      db.prepare('INSERT INTO leave_policies (tenant_id,config_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(policy), now(), '總後台');
      res.json({ success: true, policy, notes });
    }));
    app.delete('/api/admin/leave-policies/:tid', requireSuperAdmin, wrap((req, res) => { db.prepare('DELETE FROM leave_policies WHERE tenant_id=?').run(Number(req.params.tid)); res.json({ success: true, policy: LP.defaults() }); }));
  }

  // ================= 給薪資計算用 =================
  // 某人某月的請假扣款、全勤獎金扣減、加班費（依公司設定的日薪／時薪算法）
  function forMonth(tid, u, month, { base = 0, allowances = [] } = {}) {
    const p = policyFor(tid); const hpd = p.hours_per_day; const first = `${month}-01`; const last = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
    const allowSum = (allowances || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
    const W = Number(base) + (p.wage_includes_allowances ? allowSum : 0);
    const workdays = workDates(tid, u.id, first, last, false).length;
    const denom = p.daily_wage_mode === 'workdays' && workdays ? workdays : 30;
    const daily = W / denom, hourly = daily / hpd;
    const types = typesFor({ ...p, overtime_mode: 'comp' });
    const reqs = db.prepare("SELECT * FROM leave_requests WHERE tenant_id=? AND staff_id=? AND status='approved' AND start_date<=? AND end_date>=?").all(tid, u.id, `${month.slice(0, 4)}-12-31`, `${month.slice(0, 4)}-01-01`);
    // 病假、生理假依全年累計決定半薪或不給薪
    const sickCfg = types.find(t => t.key === 'sick'), menCfg = types.find(t => t.key === 'menstrual');
    const limit = (sickCfg?.quota || 30) * hpd; let pool = 0, men = 0, fullLeft = (sickCfg?.full_pay_days || 0) * hpd;
    const seg = new Map();
    const cum = reqs.filter(r => r.leave_type === 'sick' || r.leave_type === 'menstrual').flatMap(r => parse(r.entries_json, []).map(e => ({ ...e, r }))).filter(e => e.d.slice(0, 4) === month.slice(0, 4)).sort((a, b) => a.d.localeCompare(b.d) || a.r.id - b.r.id);
    for (const e of cum) {
      const parts = []; let h = Number(e.h) || 0;
      if (e.r.leave_type === 'menstrual') { const free = Math.min(h, Math.max(0, 3 * hpd - men)); men += h; if (free) parts.push({ h: free, ratio: Math.max(0.5, menCfg?.pay ?? 0.5), note: '' }); h -= free; if (h > 0) { const inPool = Math.min(h, Math.max(0, limit - pool)); pool += h; if (inPool) parts.push({ h: inPool, ratio: Math.max(0.5, menCfg?.pay ?? 0.5), note: '併入病假' }); if (h - inPool > 0) parts.push({ h: h - inPool, ratio: 0, note: '病假額度已用完' }); } }
      else { const f = Math.min(h, fullLeft); fullLeft -= f; if (f) { parts.push({ h: f, ratio: 1, note: '公司全薪' }); pool += f; } h -= f; if (h > 0) { const inPool = Math.min(h, Math.max(0, limit - pool)); pool += h; if (inPool) parts.push({ h: inPool, ratio: Math.max(0.5, sickCfg?.pay ?? 0.5), note: '' }); if (h - inPool > 0) parts.push({ h: h - inPool, ratio: 0, note: '超過 30 日' }); } }
      seg.set(`${e.r.id}|${e.d}`, parts);
    }
    const lines = new Map(); let leave = 0, attHours = 0, attAll = false;
    for (const r of reqs) {
      const T = types.find(t => t.key === r.leave_type) || { name: r.type_name, att: 'none', pay: r.pay_ratio };
      for (const e of parse(r.entries_json, []).filter(e => e.d >= first && e.d <= last)) {
        const parts = r.absent ? [{ h: Number(e.h) || 0, ratio: 0, note: '證明逾期・曠職' }] : (seg.get(`${r.id}|${e.d}`) || [{ h: Number(e.h) || 0, ratio: Number(r.pay_ratio) || 0, note: '' }]);
        for (const pt of parts) {
          const amt = hourly * pt.h * (1 - pt.ratio);
          const label = `${r.absent ? '曠職' : (r.type_name || T.name)}${pt.ratio >= 1 ? '（全薪）' : pt.ratio > 0 ? `（${Math.round(pt.ratio * 100)}% 給薪）` : '（不給薪）'}${pt.note && !r.absent ? `・${pt.note}` : ''}`;
          const L = lines.get(label) || { label, type: r.leave_type, hours: 0, amount: 0 }; L.hours += pt.h; L.amount += amt; lines.set(label, L);
          leave += amt;
        }
        const att = r.absent ? 'all' : T.att;
        if (att === 'all') attAll = true; else if (att === 'prorate') attHours += Number(e.h) || 0;
      }
    }
    let attendance = 0;
    if (p.attendance.enabled) { const A = (allowances || []).find(a => String(a.name || '').includes(p.attendance.name)); const amt = Number(A?.amount) || 0; if (amt) attendance = attAll ? amt : Math.min(amt, Math.round(amt * attHours / (denom * hpd))); }
    let overtime = 0, otHours = 0;
    try {
      for (const o of db.prepare("SELECT hours FROM schedule_overtime WHERE tenant_id=? AND staff_id=? AND status<>'rejected' AND work_date BETWEEN ? AND ?").all(tid, u.id, first, last)) { const h = Number(o.hours) || 0; otHours += h; overtime += hourly * (Math.min(h, 2) * 4 / 3 + Math.max(0, h - 2) * 5 / 3); }
    } catch {}
    const yearSick = reqs.filter(r => r.leave_type === 'sick' || r.leave_type === 'menstrual').flatMap(r => parse(r.entries_json, []).map(e => ({ ...e, type: r.leave_type, id: r.id }))).filter(e => e.d.startsWith(month.slice(0, 4)) && e.d <= last);
    const sickH = sumH(yearSick.filter(e => e.type === 'sick')) + menstrualMerged(yearSick.filter(e => e.type === 'menstrual'), hpd);
    return {
      leave_deduct: Math.round(leave), attendance_deduct: attendance,
      lines: [...lines.values()].map(l => ({ label: l.label, type: l.type, hours: r2(l.hours), length: fmt(l.hours, hpd), amount: Math.round(l.amount) })),
      wage: { monthly: Math.round(W), daily: r2(daily), hourly: r2(hourly), denom, workdays, mode: p.daily_wage_mode, hours_per_day: hpd },
      overtime_mode: p.overtime_mode, overtime_auto: p.overtime_auto, overtime: p.overtime_mode === 'pay' ? Math.round(overtime) : 0, overtime_hours: r2(otHours),
      sick_days_year: r2(sickH / hpd), attendance_enabled: p.attendance.enabled, attendance_name: p.attendance.name,
    };
  }
  function annualUsed(tid, sid, al) {
    if (!al || !al.days) return { used: 0, pending: 0 };
    const hpd = policyFor(tid).hours_per_day; const l = activeEntries(tid, sid).filter(e => e.type === 'annual' && e.d < al.end);
    return { used: r2(sumH(l.filter(e => e.status === 'approved')) / hpd), pending: r2(sumH(l.filter(e => e.status === 'pending')) / hpd) };
  }
  if (payroll?.setLeaveHooks) payroll.setLeaveHooks({ forMonth, annualUsed });
  return { forMonth, annualUsed, policyFor, sweep };
};
