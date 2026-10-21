// 代班／調假／加班
// - 假單核准後自動建立代班需求：保全（24 小時）一定要代班；社區主管／副主管由申請人決定是否需要；
//   其他排班人員（例如櫃台秘書）由部門主管調度，也可以標記不需要。
// - 系統列出可以代班的人（同社區同職務、當天休假、不違反連續上班上限；機動人員有固定輪值的日子反灰）。
// - 人員可以按「我可以代班」，調度主管（職務主管）確認後班表自動更新；休假日代班自動產生加班紀錄。
// - 調假：排休人員把某天的班和自己的休假日對調，不扣薪，現場主管核准。
// - 加班：休假日被請回、國定假日出勤、夜間會議、自願加班（種類與計算方式由總後台依公司設定）。
'use strict';

module.exports = function registerCoverRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaff, requireCompanyAdmin, getSiteAssignments, org, leave, sched } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS cover_needs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, leave_id INTEGER, staff_id INTEGER NOT NULL, community_id INTEGER, work_date TEXT NOT NULL,
    shift TEXT DEFAULT '', category TEXT DEFAULT '', hours REAL DEFAULT 8, required INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
    dispatcher_ids_json TEXT DEFAULT '[]', assignee_id INTEGER, assigned_by TEXT DEFAULT '', assigned_at TEXT, overtime_id INTEGER, backup_json TEXT DEFAULT '',
    note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cover_needs ON cover_needs(tenant_id,status,work_date);
  CREATE TABLE IF NOT EXISTS cover_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, need_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL, UNIQUE(need_id,staff_id));
  CREATE TABLE IF NOT EXISTS rest_swaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, community_id INTEGER, off_date TEXT NOT NULL, work_date TEXT NOT NULL,
    reason TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', approver_ids_json TEXT DEFAULT '[]', decided_by TEXT DEFAULT '', decided_at TEXT, comment TEXT DEFAULT '', backup_json TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  `);
  { const cols = db.prepare('PRAGMA table_info(schedule_overtime)').all().map(c => c.name);
    for (const [c, def] of [['ot_type', "TEXT DEFAULT ''"], ['start_time', "TEXT DEFAULT ''"], ['end_time', "TEXT DEFAULT ''"], ['comp_choice', "TEXT DEFAULT ''"], ['source', "TEXT DEFAULT 'manual'"], ['cover_id', 'INTEGER'], ['needs_approval', 'INTEGER DEFAULT 0'], ['approver_ids_json', "TEXT DEFAULT '[]'"], ['decided_by', "TEXT DEFAULT ''"], ['decided_at', 'TEXT'], ['comment', "TEXT DEFAULT ''"]])
      if (cols.length && !cols.includes(c)) db.exec(`ALTER TABLE schedule_overtime ADD COLUMN ${c} ${def}`); }

  // ---------- 小工具 ----------
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 300) => String(v ?? '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); }); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => (db.transaction ? db.transaction(fn) : fn);
  const by = u => u?.name || u?.employee_id || '';
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1").all(tid).map(x => x.id);
  const nameOf = (tid, id) => staffRow(tid, id)?.name || '';
  const commName = id => id ? (db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '') : '';
  const SHIFT = { day: '日班', night: '夜班' };
  const WORK = c => c && !['off', 'leave'].includes(c);
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const rel = (tid, id) => { try { return org?.relations(tid, id) || null; } catch { return null; } };
  function notify(tid, from, toIds, subject, body) {
    for (const toId of [...new Set(toIds)].filter(Boolean)) {
      try {
        const to = staffRow(tid, toId); if (!to) continue;
        let sender = from && from.id !== to.id ? from : null; if (!sender) { const a = adminIds(tid).find(x => x !== to.id); sender = a ? staffRow(tid, a) : null; } if (!sender) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, subject, body, 'text', '', now());
      } catch (e) { console.warn('cover message failed', e.message); }
    }
  }
  const entriesOn = (tid, sid, date) => db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date=?').all(tid, sid, date);
  const isRed = date => { try { return new Set(sched.redDates(Number(date.slice(0, 4)))).has(date); } catch { return false; } };
  const maxConsecutive = () => { try { return Math.max(1, Number(sched.platformRules().max_consecutive || 6)); } catch { return 6; } };
  // 如果這天也上班，前後連續上班會有幾天
  function streakIfWork(tid, sid, date) {
    const work = d0 => entriesOn(tid, sid, d0).some(x => WORK(x.shift_code));
    let n = 1; for (let x = addDays(date, -1), i = 0; i < 31 && work(x); x = addDays(x, -1), i++) n++; for (let x = addDays(date, 1), i = 0; i < 31 && work(x); x = addDays(x, 1), i++) n++;
    return n;
  }
  const onLeave = (tid, sid, date) => { try { return db.prepare("SELECT entries_json FROM leave_requests WHERE tenant_id=? AND staff_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?").all(tid, sid, date, date).some(r => parse(r.entries_json, []).some(e => e.d === date)); } catch { return false; } };

  // ================= 代班需求 =================
  // 誰負責調度：職務主管（保全 → 勤務經理／主管；秘書 → 秘書部）＋ 公司管理員
  function dispatchersFor(tid, sid) { const r = rel(tid, sid); return [...new Set([...(r?.dept || []), ...(r?.dept_head || []), ...adminIds(tid)])].filter(x => x !== sid); }
  function categoryOf(u) { const m = mi(u); if (m) return { kind: m.kind, schedule: m.schedule, dept: m.dept, shift: m.shift }; let role = ''; try { role = sched.defaultRole(u); } catch {} return { kind: '', schedule: role, dept: '', shift: '' }; }
  function onApproved(r, actor) {
    const tid = r.tenant_id; const u = staffRow(tid, r.staff_id); if (!u) return;
    const c = categoryOf(u); if (!c.schedule || c.schedule === 'office') return;
    let required = 0, open = true;
    if (c.schedule === 'security' || (c.kind === 'mobile' && c.dept && c.schedule !== 'admin' && c.schedule !== 'mobile')) required = 1;
    if (c.schedule === 'security') required = 1;
    if (['site_manager', 'site_deputy'].includes(c.kind)) open = r.need_cover === 1;
    if (!open) return;
    const disp = dispatchersFor(tid, u.id);
    const mine = getSiteAssignments(u).map(a => Number(a.community_id));
    for (const e of parse(r.entries_json, [])) {
      const rows = entriesOn(tid, u.id, e.d); const row = rows[0];
      const shift = row && ['day', 'night'].includes(row.shift_code) ? row.shift_code : (c.shift || '');
      if (db.prepare("SELECT 1 FROM cover_needs WHERE tenant_id=? AND leave_id=? AND work_date=? AND status IN ('open','filled')").get(tid, r.id, e.d)) continue;
      db.prepare('INSERT INTO cover_needs (tenant_id,leave_id,staff_id,community_id,work_date,shift,category,hours,required,status,dispatcher_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(tid, r.id, u.id, row?.community_id ?? mine[0] ?? null, e.d, shift, c.schedule, Number(e.h) || 8, required, 'open', JSON.stringify(disp), now(), now());
    }
    const n = db.prepare("SELECT COUNT(*) c FROM cover_needs WHERE leave_id=? AND status='open'").get(r.id).c;
    if (n) notify(tid, actor, disp, '代班需求', `🤝 ${u.name} 的假單已核准（${r.start_date === r.end_date ? r.start_date : `${r.start_date}～${r.end_date}`}），有 ${n} 個班${required ? '一定要' : '可能需要'}安排代班。\n請到「班表 → 請假／代班 → 代班」調度。`);
  }
  function revertAssign(n) {
    const b = parse(n.backup_json, null);
    try {
      if (b?.created) db.prepare('DELETE FROM schedule_entries WHERE id=?').run(b.created);
      for (const x of b?.entries || []) db.prepare('UPDATE schedule_entries SET shift_code=?,note=?,source=?,updated_at=? WHERE id=?').run(x.shift_code, x.note || '', x.source || 'manual', now(), x.id);
      if (b?.request) db.prepare('DELETE FROM schedule_requests WHERE id=?').run(b.request);
      if (n.overtime_id) db.prepare('DELETE FROM schedule_overtime WHERE id=?').run(n.overtime_id);
    } catch (e) { console.warn('cover revert failed', e.message); }
  }
  function onCancelled(r, actor) {
    for (const n of db.prepare("SELECT * FROM cover_needs WHERE tenant_id=? AND leave_id=? AND status IN ('open','filled')").all(r.tenant_id, r.id)) {
      if (n.status === 'filled') { revertAssign(n); notify(r.tenant_id, actor, [n.assignee_id], '代班取消', `↩ ${nameOf(r.tenant_id, n.staff_id)} 的假單已取消，您 ${n.work_date} 的代班也取消了，班表已還原。`); }
      db.prepare("UPDATE cover_needs SET status='cancelled',updated_at=? WHERE id=?").run(now(), n.id);
    }
  }
  function coverInfo(leaveId) {
    const rows = db.prepare("SELECT * FROM cover_needs WHERE leave_id=? AND status IN ('open','filled','not_needed')").all(leaveId); if (!rows.length) return null;
    const filled = rows.filter(n => n.status === 'filled'); const tid = rows[0].tenant_id;
    return { total: rows.filter(n => n.status !== 'not_needed').length, filled: filled.length, open: rows.filter(n => n.status === 'open').length, names: [...new Set(filled.map(n => nameOf(tid, n.assignee_id)))] };
  }
  if (leave?.setHooks) leave.setHooks({ onApproved, onCancelled, coverInfo });

  // 可以代班的人：同職務（保全找保全、秘書找秘書）、同社區，或機動人員
  function candidates(n) {
    const tid = n.tenant_id; const absent = staffRow(tid, n.staff_id); const ac = categoryOf(absent || {});
    const rows = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' AND role='staff' AND id<>?").all(tid, n.staff_id);
    const max = maxConsecutive(); const offers = new Set(db.prepare('SELECT staff_id FROM cover_offers WHERE need_id=?').all(n.id).map(x => x.staff_id));
    const out = [];
    for (const s of rows) {
      const c = categoryOf(s); if (!c.schedule || c.schedule === 'office') continue;
      const sameJob = ac.dept ? c.dept === ac.dept : (c.schedule === ac.schedule || (c.schedule === 'mobile' && ['security', 'mobile'].includes(ac.schedule)));
      if (!sameJob) continue;
      const sites = getSiteAssignments(s).map(a => Number(a.community_id)); const mobile = c.kind === 'mobile' || c.schedule === 'mobile';
      if (!mobile && n.community_id && !sites.includes(Number(n.community_id))) continue;
      if (['site_manager', 'region', 'dept_head', 'dept_manager'].includes(c.kind) && ac.kind !== 'site_manager') continue;
      const day = entriesOn(tid, s.id, n.work_date); const working = day.some(x => WORK(x.shift_code));
      let ok = true, reason = '';
      if (onLeave(tid, s.id, n.work_date)) { ok = false; reason = '當天請假'; }
      else if (working && mobile) { ok = false; reason = '當天有固定輪值'; }
      else if (working) { ok = false; reason = `當天上班（${day.map(x => commName(x.community_id) || '').filter(Boolean).join('、') || '已排班'}）`; }
      else { const st = streakIfWork(tid, s.id, n.work_date); if (st > max) { ok = false; reason = `會連續上班 ${st} 天（上限 ${max} 天）`; } }
      const sameShift = !n.shift || !c.shift || c.shift === n.shift;
      out.push({ staff_id: s.id, name: s.name, employee_id: s.employee_id, position: mi(s)?.position?.name || s.position || '', mobile, same_shift: sameShift, available: ok, reason: ok ? (day.length ? '當天休假（算休假日加班）' : '當天沒有排班') : reason, offered: offers.has(s.id) });
    }
    return out.sort((a, b) => (b.offered - a.offered) || (b.available - a.available) || (b.same_shift - a.same_shift) || (a.mobile - b.mobile));
  }
  function needOut(n, viewer, { withCandidates = false } = {}) {
    const tid = n.tenant_id; const disp = parse(n.dispatcher_ids_json, []);
    const o = { id: n.id, leave_id: n.leave_id, staff_id: n.staff_id, name: nameOf(tid, n.staff_id), community_id: n.community_id, community: commName(n.community_id), work_date: n.work_date, shift: n.shift, shift_label: SHIFT[n.shift] || '', category: n.category, hours: n.hours, required: !!n.required, status: n.status, assignee_id: n.assignee_id, assignee: n.assignee_id ? nameOf(tid, n.assignee_id) : '', assigned_by: n.assigned_by, note: n.note,
      offers: db.prepare('SELECT o.staff_id,u.name FROM cover_offers o JOIN staff_users u ON u.id=o.staff_id WHERE o.need_id=?').all(n.id), can_dispatch: !!viewer && (viewer.role === 'company_admin' || disp.includes(viewer.id)) };
    if (withCandidates) o.candidates = candidates(n);
    return o;
  }

  // ================= 調假 =================
  function swapApprovers(tid, sid) { const r = rel(tid, sid); return [...new Set([...(r?.site?.length ? r.site : r?.direct || []), ...adminIds(tid)])].filter(x => x !== sid); }
  function swapOut(s, viewer) {
    const tid = s.tenant_id; const ap = parse(s.approver_ids_json, []);
    return { id: s.id, staff_id: s.staff_id, name: nameOf(tid, s.staff_id), community: commName(s.community_id), off_date: s.off_date, work_date: s.work_date, reason: s.reason, status: s.status, decided_by: s.decided_by, comment: s.comment, created_at: s.created_at, can_decide: !!viewer && s.status === 'pending' && s.staff_id !== viewer.id && (viewer.role === 'company_admin' || ap.includes(viewer.id)), can_cancel: !!viewer && s.status === 'pending' && s.staff_id === viewer.id };
  }

  // ================= 加班 =================
  function otPolicy(tid) { try { return leave.policyFor(tid); } catch { return { overtime_types: [] }; } }
  function otApprovers(tid, sid) { const r = rel(tid, sid); return [...new Set([...(r?.site?.length ? r.site : r?.direct || []), ...adminIds(tid)])].filter(x => x !== sid); }
  const hoursBetween = (a, b) => { if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) return 0; let m = (Number(b.slice(0, 2)) * 60 + Number(b.slice(3))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3))); if (m <= 0) m += 1440; return Math.round(m / 30) / 2; };
  function otOut(o, viewer, p) {
    const T = (p.overtime_types || []).find(x => x.id === o.ot_type); const ap = parse(o.approver_ids_json, []);
    return { id: o.id, staff_id: o.staff_id, name: nameOf(o.tenant_id, o.staff_id), community: commName(o.community_id), work_date: o.work_date, start_time: o.start_time || '', end_time: o.end_time || '', hours: o.hours, ot_type: o.ot_type || '', type_name: T?.name || o.category || '加班', reason: o.reason, status: o.status, needs_approval: !!o.needs_approval, source: o.source || 'manual', comp_choice: o.comp_choice || '', comp_rule: T?.comp || (p.overtime_mode === 'comp' ? 'comp' : 'pay'), decided_by: o.decided_by, comment: o.comment,
      can_decide: !!viewer && o.status === 'pending' && o.staff_id !== viewer.id && (viewer.role === 'company_admin' || ap.includes(viewer.id)),
      can_choose: !!viewer && o.staff_id === viewer.id && T?.comp === 'choose' && o.status !== 'rejected', can_cancel: !!viewer && o.staff_id === viewer.id && o.status === 'pending' };
  }

  // ================= 我的休假制度 =================
  const MODE = { red_holiday: '見紅休', rotation: '輪排休', fixed_monthly: '固定月休' };
  function myRule(u, month) {
    const tid = u.tenant_id; const m = mi(u); const role = (() => { try { return sched.defaultRole(u); } catch { return ''; } })();
    const sites = getSiteAssignments(u); const cid = sites[0]?.community_id || null; const cname = sites[0]?.community_name || '';
    const days = (() => { const [y, mm] = month.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).getUTCDate(); })();
    const reds = (() => { try { return sched.redDates(Number(month.slice(0, 4))).filter(x => x.startsWith(month)); } catch { return []; } })();
    const prof = (() => { try { return sched.getProfile(tid, u.id) || {}; } catch { return {}; } })();
    const posName = m?.position?.name || u.position || '';
    const base = { month, community: cname, position: posName, red_days: reds, red_count: reds.length, days_in_month: days };
    if (!role || role === 'office' || m?.schedule === 'office') return { ...base, role: 'office', mode: 'red_holiday', mode_label: '見紅休', rest_days: reds.length, self_select_days: 0, text: `您是內勤職位，依政府行事曆「見紅休」：週末、國定假日與補假都休假。${Number(month.slice(5))} 月共休 ${reds.length} 天。假日如被請回上班，依公司規定另計加班。` };
    let rule = {}; try { rule = sched.effectiveRule(tid, cid, role) || {}; } catch {}
    if (role === 'admin') {
      const isMgr = ['site_manager'].includes(m?.kind) || (m?.kind === 'site_deputy' && m?.dept !== 'secretary') || (!m && String(u.job_level || '').includes('經理'));
      const sub = (isMgr ? rule.manager : rule.secretary) || {}; const mode = sub.mode || 'rotation';
      const rest = mode === 'fixed_monthly' ? Number(sub.rest_days || prof.rest_days || 8) : reds.length;
      const who = isMgr ? '社區主管' : '秘書';
      const text = mode === 'red_holiday' ? `依「${cname || '社區'}」合約，${posName || who}的排休制度為「見紅休」：依政府行事曆，週末、國定假日與補假都休假，不用另外排休。${Number(month.slice(5))} 月共休 ${rest} 天。`
        : mode === 'rotation' ? `依「${cname || '社區'}」合約，${posName || who}的排休制度為「輪排休」：休假天數＝當月週末與國定假日天數（${Number(month.slice(5))} 月 ${rest} 天），由主管和同事輪流排休，確保社區每天都有人。`
        : `依「${cname || '社區'}」合約，${posName || who}的排休制度為「固定月休」：每月休 ${rest} 天，其中 ${Number(prof.self_select_days || 0)} 天可以到「自選休假」自己選。`;
      return { ...base, role, mode, mode_label: MODE[mode] || mode, rest_days: rest, self_select_days: mode === 'red_holiday' ? 0 : Number(prof.self_select_days || 0), text };
    }
    const rest = Number(prof.rest_days || rule.rest_days || 6), self = Number(prof.self_select_days ?? rule.self_select_days ?? 2), max = Number(rule.max_consecutive || maxConsecutive());
    const shift = SHIFT[prof.default_shift] || SHIFT[m?.shift] || '';
    return { ...base, role, mode: 'fixed_monthly', mode_label: '排休', rest_days: rest, self_select_days: self, max_consecutive: max, shift, text: role === 'mobile' ? `機動人員：每月休 ${rest} 天（其中 ${self} 天可以自選），最多連續上班 ${max} 天。支援社區依調度安排。` : `${shift ? `${shift}` : ''}保全（24 小時勤務）：每月休 ${rest} 天，其中 ${self} 天可以到「自選休假」自己選；最多連續上班 ${max} 天。請假一定會安排代班。` };
  }

  // ================= 路由（現場 /api/staff、內勤 /api/company/my） =================
  for (const [base, mw] of [['/api/staff', requireStaff], ['/api/company/my', requireCompanyAdmin]]) {
    app.get(`${base}/schedule/my-rule`, mw, wrap((req, res) => { const m = /^\d{4}-\d{2}$/.test(req.query?.month || '') ? req.query.month : todayTW().slice(0, 7); res.json(myRule(getUser(req), m)); }));

    // ---- 代班 ----
    app.get(`${base}/cover/needs`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const from = addDays(todayTW(), -7);
      const rows = db.prepare("SELECT * FROM cover_needs WHERE tenant_id=? AND work_date>=? AND status IN ('open','filled') ORDER BY work_date,id").all(tid, from);
      const dispatch = rows.filter(n => u.role === 'company_admin' || parse(n.dispatcher_ids_json, []).includes(u.id)).map(n => needOut(n, u, { withCandidates: n.status === 'open' }));
      const forMe = rows.filter(n => n.status === 'open' && n.staff_id !== u.id && n.work_date >= todayTW()).map(n => ({ n, c: candidates(n).find(x => x.staff_id === u.id) })).filter(x => x.c).map(x => ({ ...needOut(x.n, u), me: x.c }));
      const mine = rows.filter(n => n.assignee_id === u.id).map(n => needOut(n, u));
      const myLeave = rows.filter(n => n.staff_id === u.id).map(n => needOut(n, u));
      res.set('Cache-Control', 'no-store'); res.json({ dispatch, for_me: forMe, my_assignments: mine, my_leave: myLeave, is_dispatcher: u.role === 'company_admin' || dispatch.length > 0 });
    }));
    app.post(`${base}/cover/needs/:id/offer`, mw, wrap((req, res) => {
      const u = getUser(req); const n = db.prepare('SELECT * FROM cover_needs WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req)); if (!n) return bad(res, '找不到代班需求', 404);
      if (n.status !== 'open') return bad(res, '這個班已經有人代了');
      const c = candidates(n).find(x => x.staff_id === u.id); if (!c) return bad(res, '這個班不在您可以代班的範圍');
      if (!c.available) return bad(res, `目前無法代這個班：${c.reason}`);
      if (req.body?.withdraw) { db.prepare('DELETE FROM cover_offers WHERE need_id=? AND staff_id=?').run(n.id, u.id); return res.json({ success: true }); }
      db.prepare('INSERT OR IGNORE INTO cover_offers (need_id,tenant_id,staff_id,note,created_at) VALUES (?,?,?,?,?)').run(n.id, n.tenant_id, u.id, str(req.body?.note, 200), now());
      notify(n.tenant_id, u, parse(n.dispatcher_ids_json, []), '代班意願', `🙋 ${u.name} 可以代 ${n.work_date}${SHIFT[n.shift] ? ` ${SHIFT[n.shift]}` : ''}（${commName(n.community_id)}，${nameOf(n.tenant_id, n.staff_id)} 請假）的班，請到「代班」確認。`);
      res.json({ success: true });
    }));
    app.post(`${base}/cover/needs/:id/assign`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const n = db.prepare('SELECT * FROM cover_needs WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!n) return bad(res, '找不到代班需求', 404);
      if (!(u.role === 'company_admin' || parse(n.dispatcher_ids_json, []).includes(u.id))) return bad(res, '只有負責調度的主管可以指派代班', 403);
      if (n.status !== 'open') return bad(res, '這個班已經處理過了');
      const sid = Number(req.body?.staff_id); const c = candidates(n).find(x => x.staff_id === sid);
      if (!c) return bad(res, '這位人員不在可以代班的範圍');
      if (!c.available && !req.body?.force) return bad(res, `${c.name}：${c.reason}。如果確定還是要指派，請勾選「仍要指派」。`);
      tx(() => {
        const backup = { entries: [] }; const day = entriesOn(tid, sid, n.work_date); const wasOff = day.length > 0 && !day.some(x => WORK(x.shift_code));
        const shift = n.shift || 'work'; const note = `代班：${nameOf(tid, n.staff_id)}`;
        const same = day.find(x => Number(x.community_id) === Number(n.community_id));
        if (same) { backup.entries.push({ id: same.id, shift_code: same.shift_code, note: same.note, source: same.source }); db.prepare("UPDATE schedule_entries SET shift_code=?,note=?,source='cover',updated_at=? WHERE id=?").run(shift, note, now(), same.id); }
        else { const absentRow = entriesOn(tid, n.staff_id, n.work_date)[0]; const info = db.prepare("INSERT INTO schedule_entries (tenant_id,month,work_date,staff_id,community_id,category,shift_code,status,source,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(tid, n.work_date.slice(0, 7), n.work_date, sid, n.community_id, absentRow?.category || n.category || 'security', shift, 'planned', 'cover', note, u.id, now(), now()); backup.created = Number(info.lastInsertRowid); }
        const reqInfo = db.prepare('INSERT INTO schedule_requests (tenant_id,staff_id,community_id,work_date,request_type,target_staff_id,reason,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(tid, n.staff_id, n.community_id, n.work_date, 'cover', sid, `代班（假單 #${n.leave_id || ''}）`, 'approved', u.id, now(), now()); backup.request = Number(reqInfo.lastInsertRowid);
        // 休假日（或沒有排班的日子）來代班：自動產生加班紀錄
        let otId = null;
        if (wasOff || !day.length) {
          const p = otPolicy(tid); const type = isRed(n.work_date) && (p.overtime_types || []).some(x => x.id === 'holiday' && x.enabled) ? 'holiday' : ((p.overtime_types || []).find(x => x.id === 'rest_day') ? 'rest_day' : '');
          const T = (p.overtime_types || []).find(x => x.id === type);
          const info = db.prepare("INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at,ot_type,source,cover_id,needs_approval,comp_choice,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(tid, sid, n.community_id, n.work_date, n.hours || 8, T?.name || '代班', shift, `代班：${nameOf(tid, n.staff_id)} 請假`, 'approved', u.id, now(), now(), type, 'cover', n.id, 0, T?.comp === 'comp' ? 'comp' : T?.comp === 'pay' ? 'pay' : '', by(u), now());
          otId = Number(info.lastInsertRowid);
        }
        db.prepare("UPDATE cover_needs SET status='filled',assignee_id=?,assigned_by=?,assigned_at=?,overtime_id=?,backup_json=?,updated_at=? WHERE id=?").run(sid, by(u), now(), otId, JSON.stringify(backup), now(), n.id);
      })();
      const T = (otPolicy(tid).overtime_types || []).find(x => x.id === (isRed(n.work_date) ? 'holiday' : 'rest_day'));
      notify(tid, u, [sid], '代班確認', `✅ 已安排您 ${n.work_date}${SHIFT[n.shift] ? ` ${SHIFT[n.shift]}` : ''} 在 ${commName(n.community_id)} 代 ${nameOf(tid, n.staff_id)} 的班，班表已更新。${T?.comp === 'choose' ? '\n這天原本是您的休假，請到「班表 → 加班」選擇要領加班費或換補休。' : ''}`);
      notify(tid, u, [n.staff_id], '代班確認', `🤝 您 ${n.work_date} 的班已由 ${nameOf(tid, sid)} 代班。`);
      res.json({ success: true, need: needOut(db.prepare('SELECT * FROM cover_needs WHERE id=?').get(n.id), u) });
    }));
    app.post(`${base}/cover/needs/:id/unassign`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const n = db.prepare('SELECT * FROM cover_needs WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!n) return bad(res, '找不到代班需求', 404);
      if (!(u.role === 'company_admin' || parse(n.dispatcher_ids_json, []).includes(u.id))) return bad(res, '只有負責調度的主管可以改派', 403);
      if (n.status !== 'filled') return bad(res, '這個班還沒有指派');
      tx(() => { revertAssign(n); db.prepare("UPDATE cover_needs SET status='open',assignee_id=NULL,assigned_by='',assigned_at=NULL,overtime_id=NULL,backup_json='',updated_at=? WHERE id=?").run(now(), n.id); })();
      notify(tid, u, [n.assignee_id], '代班取消', `↩ 您 ${n.work_date} 的代班已取消，班表已還原。`);
      res.json({ success: true });
    }));
    app.post(`${base}/cover/needs/:id/close`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const n = db.prepare('SELECT * FROM cover_needs WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!n) return bad(res, '找不到代班需求', 404);
      if (!(u.role === 'company_admin' || parse(n.dispatcher_ids_json, []).includes(u.id))) return bad(res, '只有負責調度的主管可以處理', 403);
      if (n.status !== 'open') return bad(res, '這個班已經處理過了');
      if (n.required && !req.body?.force) return bad(res, '保全是 24 小時勤務，這個班一定要有人代班');
      db.prepare("UPDATE cover_needs SET status='not_needed',note=?,assigned_by=?,updated_at=? WHERE id=?").run(str(req.body?.note, 200) || '不需要代班', by(u), now(), n.id);
      res.json({ success: true });
    }));

    // ---- 調假 ----
    app.get(`${base}/cover/swaps`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req);
      const mine = db.prepare('SELECT * FROM rest_swaps WHERE tenant_id=? AND staff_id=? ORDER BY id DESC LIMIT 50').all(tid, u.id).map(s => swapOut(s, u));
      const todo = db.prepare("SELECT * FROM rest_swaps WHERE tenant_id=? AND status='pending' ORDER BY off_date").all(tid).map(s => swapOut(s, u)).filter(s => s.can_decide);
      // 可以調的日子：本月與下月我的休假日、上班日
      const from = todayTW(), to = addDays(from, 45);
      const days = db.prepare('SELECT work_date,shift_code,community_id FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date').all(tid, u.id, from, to);
      res.set('Cache-Control', 'no-store'); res.json({ mine, todo, work_days: days.filter(x => WORK(x.shift_code)).map(x => x.work_date), off_days: days.filter(x => x.shift_code === 'off').map(x => x.work_date) });
    }));
    app.post(`${base}/cover/swaps`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const b = req.body || {};
      if (!isDate(b.off_date) || !isDate(b.work_date)) return bad(res, '請選擇想休的日子和要改上班的休假日');
      if (b.off_date < todayTW() || b.work_date < todayTW()) return bad(res, '只能調今天以後的日子');
      const offRow = entriesOn(tid, u.id, b.off_date).find(x => WORK(x.shift_code)); const workRow = entriesOn(tid, u.id, b.work_date).find(x => x.shift_code === 'off');
      if (!offRow) return bad(res, `${b.off_date} 不是您的上班日`); if (!workRow) return bad(res, `${b.work_date} 不是您的休假日`);
      if (Math.abs(new Date(b.off_date) - new Date(b.work_date)) > 31 * 864e5) return bad(res, '調假的兩天要在一個月內');
      if (db.prepare("SELECT 1 FROM rest_swaps WHERE tenant_id=? AND staff_id=? AND status='pending' AND (off_date IN (?,?) OR work_date IN (?,?))").get(tid, u.id, b.off_date, b.work_date, b.off_date, b.work_date)) return bad(res, '這兩天已經有審核中的調假');
      const ap = swapApprovers(tid, u.id);
      const info = db.prepare('INSERT INTO rest_swaps (tenant_id,staff_id,community_id,off_date,work_date,reason,status,approver_ids_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, u.id, offRow.community_id, b.off_date, b.work_date, str(b.reason, 300), 'pending', JSON.stringify(ap), now());
      notify(tid, u, ap.filter(x => !adminIds(tid).includes(x) || ap.length === adminIds(tid).length), '調假申請', `🔄 ${u.name} 申請調假：${b.off_date} 休假，改 ${b.work_date} 上班（不扣薪）。\n請到「班表 → 請假／代班 → 調假」審核。`);
      res.json({ success: true, id: Number(info.lastInsertRowid) });
    }));
    app.post(`${base}/cover/swaps/:id/decide`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const s = db.prepare('SELECT * FROM rest_swaps WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!s) return bad(res, '找不到調假申請', 404);
      if (!swapOut(s, u).can_decide) return bad(res, '目前不是由您審核', 403);
      const approve = req.body?.action !== 'reject'; const comment = str(req.body?.comment, 300);
      if (!approve && !comment) return bad(res, '退回時請填寫原因');
      if (approve) {
        const offRow = entriesOn(tid, s.staff_id, s.off_date).find(x => WORK(x.shift_code)); const workRow = entriesOn(tid, s.staff_id, s.work_date).find(x => x.shift_code === 'off');
        if (!offRow || !workRow) return bad(res, '班表已經變動，這筆調假無法套用，請退回');
        if (streakIfWork(tid, s.staff_id, s.work_date) > maxConsecutive()) return bad(res, `調假後會連續上班超過 ${maxConsecutive()} 天，請退回`);
        tx(() => {
          db.prepare("UPDATE schedule_entries SET shift_code='off',note=?,source='swap',updated_at=? WHERE id=?").run(`調假（改 ${s.work_date} 上班）`, now(), offRow.id);
          db.prepare("UPDATE schedule_entries SET shift_code=?,note=?,source='swap',updated_at=? WHERE id=?").run(offRow.shift_code, `調假（${s.off_date} 休）`, now(), workRow.id);
          db.prepare("UPDATE rest_swaps SET status='approved',decided_by=?,decided_at=?,comment=?,backup_json=? WHERE id=?").run(by(u), now(), comment, JSON.stringify({ off: { id: offRow.id, shift_code: offRow.shift_code, note: offRow.note }, work: { id: workRow.id, shift_code: workRow.shift_code, note: workRow.note } }), s.id);
        })();
      } else db.prepare("UPDATE rest_swaps SET status='rejected',decided_by=?,decided_at=?,comment=? WHERE id=?").run(by(u), now(), comment, s.id);
      notify(tid, u, [s.staff_id], '調假結果', approve ? `✅ 調假已核准：${s.off_date} 休假，改 ${s.work_date} 上班，班表已更新。` : `❌ 調假被退回（${s.off_date} ↔ ${s.work_date}）。\n原因：${comment}`);
      res.json({ success: true });
    }));
    app.post(`${base}/cover/swaps/:id/cancel`, mw, wrap((req, res) => {
      const u = getUser(req); const s = db.prepare('SELECT * FROM rest_swaps WHERE id=? AND tenant_id=? AND staff_id=?').get(Number(req.params.id), tenantId(req), u.id); if (!s) return bad(res, '找不到調假申請', 404);
      if (s.status !== 'pending') return bad(res, '已經處理過了，請洽主管');
      db.prepare("UPDATE rest_swaps SET status='cancelled' WHERE id=?").run(s.id); res.json({ success: true });
    }));

    // ---- 加班 ----
    app.get(`${base}/overtime`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const p = otPolicy(tid);
      const mine = db.prepare('SELECT * FROM schedule_overtime WHERE tenant_id=? AND staff_id=? ORDER BY work_date DESC,id DESC LIMIT 100').all(tid, u.id).map(o => otOut(o, u, p));
      const todo = db.prepare("SELECT * FROM schedule_overtime WHERE tenant_id=? AND status='pending' AND COALESCE(needs_approval,0)=1 ORDER BY work_date").all(tid).map(o => otOut(o, u, p)).filter(o => o.can_decide);
      res.set('Cache-Control', 'no-store');
      res.json({ types: (p.overtime_types || []).filter(x => x.enabled), mine, todo, communities: getSiteAssignments(u).map(a => ({ id: Number(a.community_id), name: a.community_name })) });
    }));
    app.post(`${base}/overtime`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const b = req.body || {}; const p = otPolicy(tid);
      const T = (p.overtime_types || []).find(x => x.id === b.ot_type && x.enabled); if (!T) return bad(res, '請選擇加班種類');
      if (!isDate(b.work_date)) return bad(res, '請選擇日期');
      let hours = Number(b.hours) || 0; if (b.start_time && b.end_time) hours = hoursBetween(b.start_time, b.end_time);
      if (!(hours > 0 && hours <= 24)) return bad(res, '請填寫加班時間（開始與結束，或時數）');
      const reason = str(b.reason, 300); if (!reason) return bad(res, '請填寫加班事由');
      const cids = getSiteAssignments(u).map(a => Number(a.community_id)); const cid = b.community_id && cids.includes(Number(b.community_id)) ? Number(b.community_id) : (cids[0] || null);
      const ap = otApprovers(tid, u.id); const choice = T.comp === 'choose' ? (['pay', 'comp'].includes(b.comp_choice) ? b.comp_choice : '') : (T.comp === 'comp' ? 'comp' : 'pay');
      const info = db.prepare("INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at,ot_type,start_time,end_time,comp_choice,source,needs_approval,approver_ids_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(tid, u.id, cid, b.work_date, hours, T.name, '', reason, 'pending', u.id, now(), now(), T.id, str(b.start_time, 5), str(b.end_time, 5), choice, 'request', 1, JSON.stringify(ap));
      notify(tid, u, ap, '加班申請', `⏱ ${u.name} 申請加班：${b.work_date} ${T.name} ${hours} 小時。\n事由：${reason}\n請到「班表 → 加班」審核。`);
      res.json({ success: true, id: Number(info.lastInsertRowid) });
    }));
    app.post(`${base}/overtime/:id/decide`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const p = otPolicy(tid); const o = db.prepare('SELECT * FROM schedule_overtime WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!o) return bad(res, '找不到加班紀錄', 404);
      if (!otOut(o, u, p).can_decide) return bad(res, '目前不是由您審核', 403);
      const approve = req.body?.action !== 'reject'; const comment = str(req.body?.comment, 300); if (!approve && !comment) return bad(res, '退回時請填寫原因');
      db.prepare('UPDATE schedule_overtime SET status=?,decided_by=?,decided_at=?,comment=?,updated_at=? WHERE id=?').run(approve ? 'approved' : 'rejected', by(u), now(), comment, now(), o.id);
      notify(tid, u, [o.staff_id], '加班審核', approve ? `✅ 您 ${o.work_date} 的加班（${o.hours} 小時）已核准。` : `❌ 您 ${o.work_date} 的加班被退回。\n原因：${comment}`);
      res.json({ success: true });
    }));
    app.post(`${base}/overtime/:id/choice`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const p = otPolicy(tid); const o = db.prepare('SELECT * FROM schedule_overtime WHERE id=? AND tenant_id=? AND staff_id=?').get(Number(req.params.id), tid, u.id); if (!o) return bad(res, '找不到加班紀錄', 404);
      if (!otOut(o, u, p).can_choose) return bad(res, '這筆加班依公司規定，不能自己選擇');
      const c = req.body?.comp_choice; if (!['pay', 'comp'].includes(c)) return bad(res, '請選擇加班費或換補休');
      const paid = (() => { try { return db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status='published'").get(tid, o.work_date.slice(0, 7)); } catch { return null; } })();
      if (paid) return bad(res, '這個月的薪資已經發布，不能再更改，請洽會計');
      db.prepare('UPDATE schedule_overtime SET comp_choice=?,updated_at=? WHERE id=?').run(c, now(), o.id); res.json({ success: true });
    }));
    app.post(`${base}/overtime/:id/cancel`, mw, wrap((req, res) => {
      const u = getUser(req); const o = db.prepare('SELECT * FROM schedule_overtime WHERE id=? AND tenant_id=? AND staff_id=?').get(Number(req.params.id), tenantId(req), u.id); if (!o) return bad(res, '找不到加班紀錄', 404);
      if (o.status !== 'pending') return bad(res, '已經處理過了，請洽主管');
      db.prepare("UPDATE schedule_overtime SET status='cancelled' WHERE id=?").run(o.id); res.json({ success: true });
    }));
  }

  // 公司：全部加班紀錄、直接登錄加班（公司管理員或班表權限）
  const canSchedule = u => u?.role === 'company_admin' || parse(u?.permission_json, []).includes('schedule');
  app.post('/api/company/overtime', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canSchedule(u)) return bad(res, '需要班表權限', 403);
    const tid = tenantId(req); const b = req.body || {}; const p = otPolicy(tid); const s0 = staffRow(tid, Number(b.staff_id)); if (!s0) return bad(res, '請選擇人員');
    const T = (p.overtime_types || []).find(x => x.id === b.ot_type && x.enabled); if (!T) return bad(res, '請選擇加班種類');
    if (!isDate(b.work_date)) return bad(res, '請選擇日期');
    let hours = Number(b.hours) || 0; if (b.start_time && b.end_time) hours = hoursBetween(b.start_time, b.end_time); if (!(hours > 0 && hours <= 24)) return bad(res, '請填寫加班時間');
    const choice = T.comp === 'choose' ? '' : (T.comp === 'comp' ? 'comp' : 'pay');
    const info = db.prepare("INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at,ot_type,start_time,end_time,comp_choice,source,needs_approval,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(tid, s0.id, b.community_id ? Number(b.community_id) : null, b.work_date, hours, T.name, '', str(b.reason, 300), 'approved', u.id, now(), now(), T.id, str(b.start_time, 5), str(b.end_time, 5), choice, 'company', 0, by(u), now());
    notify(tid, u, [s0.id], '加班登錄', `⏱ 公司已登錄您 ${b.work_date} 的${T.name} ${hours} 小時。${T.comp === 'choose' ? '\n請到「班表 → 加班」選擇要領加班費或換補休。' : ''}`);
    res.json({ success: true, id: Number(info.lastInsertRowid) });
  }));
  app.get('/api/company/overtime/all', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canSchedule(u)) return bad(res, '需要班表權限', 403); const tid = tenantId(req); const p = otPolicy(tid); const m = /^\d{4}-\d{2}$/.test(req.query?.month || '') ? req.query.month : todayTW().slice(0, 7);
    const rows = db.prepare("SELECT * FROM schedule_overtime WHERE tenant_id=? AND substr(work_date,1,7)=? AND status<>'cancelled' ORDER BY work_date DESC,id DESC").all(tid, m).map(o => otOut(o, u, p));
    res.json({ month: m, rows, types: (p.overtime_types || []).filter(x => x.enabled) });
  }));
  return { candidates, myRule };
};
