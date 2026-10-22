// 公司內勤首頁儀表板：依職位與權限組合卡片（老闆／總經理、會計、人事、總務、部門主管、督導）
// 每張卡片：{ id, title, icon, size(sm|md|lg), value, sub, stats[], items[], action{action,label,tab} }
'use strict';

module.exports = function registerDashboardRoutes(app, d) {
  const { db, getUser, tenantId, effectivePermissions, requireCompanyAdmin, getSiteAssignments, org, payroll, equip, contracts, acct, ar, ap, interview, plans } = d;
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const twNow = () => new Date(Date.now() + 8 * 3600e3);
  const todayTW = () => twNow().toISOString().slice(0, 10);
  const monthTW = () => todayTW().slice(0, 7);
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const money = v => Math.round(Number(v) || 0).toLocaleString('en-US');
  const safe = (fn, f) => { try { return fn(); } catch (e) { return f; } };
  const has = (u, k) => u.role === 'company_admin' || (effectivePermissions(u) || []).includes(k);

  function staffOf(tid) { return db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active'").all(tid); }
  // 今天整天或部分請假（已核准）
  function leaveToday(tid) {
    const t = todayTW();
    return safe(() => db.prepare("SELECT r.*,u.name FROM leave_requests r JOIN staff_users u ON u.id=r.staff_id WHERE r.tenant_id=? AND r.status='approved' AND r.start_date<=? AND r.end_date>=?").all(tid, t, t)
      .map(r => ({ ...r, today: parse(r.entries_json, []).find(e => e.d === t) })).filter(r => r.today), []);
  }
  function pendingFor(tid, u) {
    return safe(() => db.prepare("SELECT * FROM leave_requests WHERE tenant_id=? AND status='pending'").all(tid).filter(r => {
      if (r.staff_id === u.id) return false; if (u.role === 'company_admin') return true;
      const s = parse(r.steps_json, [])[r.step_index]; return !!s && ((s.approvers || []).includes(u.id) || (s.proxies || []).includes(u.id));
    }), []);
  }
  // 今天的班表（上班中、休假）與打卡
  function scheduleToday(tid) { return safe(() => db.prepare("SELECT staff_id,community_id,shift_code FROM schedule_entries WHERE tenant_id=? AND work_date=?").all(tid, todayTW()), []); }
  function fullLeaveIds(tid) { return new Set(leaveToday(tid).filter(r => Number(r.today.h) >= 8).map(r => r.staff_id)); }
  function checkedToday(tid) {
    const t = todayTW(); const from = `${addDays(t, -1)}T16:00:00`, to = `${t}T16:00:00`;
    return new Set(safe(() => db.prepare("SELECT DISTINCT staff_id FROM attendance_records WHERE tenant_id=? AND record_type='checkin' AND recorded_at>=? AND recorded_at<?").all(tid, from, to).map(x => x.staff_id), []));
  }
  const lenText = (h) => { const v = Number(h) || 0; return v >= 8 ? '整天' : `${v} 小時`; };

  app.get('/api/company/dashboard', requireCompanyAdmin, (req, res) => {
    const u = getUser(req); const tid = tenantId(req); const cards = [];
    const mi = safe(() => org?.memberInfo(u), null); const cfg = safe(() => org?.configFor(tid), null);
    const kind = mi?.kind || (u.role === 'company_admin' ? (u.admin_level === 'owner' ? 'owner' : 'gm') : '');
    const boss = u.role === 'company_admin' || ['owner', 'gm'].includes(kind);
    const canPay = safe(() => payroll.canPayroll(u), false), canHR = safe(() => payroll.canHR(u), false);
    const deptName = mi?.dept && cfg ? (cfg.departments.find(x => x.id === mi.dept)?.name || '') : '';
    const staff = staffOf(tid); const nameOf = new Map(staff.map(s => [s.id, s.name]));
    const t = todayTW(), m = monthTW();
    const modOn = k => !plans || safe(() => plans.isOn(tid, k), true);

    // ---------- 每個人都有：我的待辦 ----------
    const pend = pendingFor(tid, u);
    cards.push({ id: 'me_approvals', size: 'sm', icon: '✅', title: '待我審核的假單', value: pend.length, sub: pend.length ? `最早 ${pend.map(r => r.start_date).sort()[0]}` : '目前沒有', tone: pend.length ? 'alert' : '', action: { action: 'leave', label: '請假管理', tab: 'approve' } });
    const unread = safe(() => db.prepare('SELECT COUNT(*) c FROM messages WHERE tenant_id=? AND recipient_id=? AND read_at IS NULL').get(tid, u.id).c, 0);
    cards.push({ id: 'me_messages', size: 'sm', icon: '💬', title: '未讀訊息', value: unread, sub: unread ? '點選開啟訊息' : '都看過了', action: { special: 'messages' } });
    const hr = safe(() => db.prepare('SELECT hire_date,annual_used FROM hr_profiles WHERE tenant_id=? AND staff_id=?').get(tid, u.id), null) || {};
    const al = hr.hire_date && payroll?.annualLeave ? payroll.annualLeave(hr.hire_date, t) : null;
    const myPending = safe(() => db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE tenant_id=? AND staff_id=? AND status='pending'").get(tid, u.id).c, 0);
    let annualLeft = null;
    if (al && al.days) { const used = safe(() => db.prepare("SELECT entries_json FROM leave_requests WHERE tenant_id=? AND staff_id=? AND leave_type='annual' AND status IN ('approved','pending')").all(tid, u.id).flatMap(r => parse(r.entries_json, [])).filter(e => e.d < al.end).reduce((a, e) => a + (Number(e.h) || 0), 0) / 8, 0); annualLeft = Math.max(0, Math.round((al.days - (Number(hr.annual_used) || 0) - used) * 10) / 10); }
    cards.push({ id: 'me_leave', size: 'sm', icon: '🌴', title: '我的特休', value: annualLeft === null ? '—' : `${annualLeft} 天`, sub: al ? (al.days ? `至 ${al.end}${myPending ? `｜審核中假單 ${myPending} 張` : ''}` : `${al.next_date} 起 ${al.next_days} 天`) : '人事尚未登記到職日', action: { action: 'leave', label: '請假管理', tab: 'mine' } });
    const slip = safe(() => db.prepare("SELECT r.month,i.net,i.confirmed_at FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.tenant_id=? AND i.staff_id=? AND r.status='published' ORDER BY r.month DESC LIMIT 1").get(tid, u.id), null);
    cards.push({ id: 'me_payslip', size: 'sm', icon: '📄', title: '我的薪資單', value: slip ? `${Number(slip.month.slice(5, 7))} 月` : '—', sub: slip ? `實發 ${money(slip.net)}${slip.confirmed_at ? '' : '・待確認'}` : '尚未發布', tone: slip && !slip.confirmed_at ? 'alert' : '', action: { special: 'payslip' } });

    // ---------- 老闆／總經理：公司總覽 ----------
    const todayLeave = leaveToday(tid);
    if (boss) {
      const off = fullLeaveIds(tid); const sched = scheduleToday(tid); const working = new Set(sched.filter(x => !['off', 'leave'].includes(x.shift_code) && !off.has(x.staff_id)).map(x => x.staff_id)); const checked = checkedToday(tid);
      const pendAll = safe(() => db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE tenant_id=? AND status='pending'").get(tid).c, 0);
      const comm = safe(() => db.prepare("SELECT COUNT(*) c FROM communities WHERE tenant_id=? AND status='active'").get(tid).c, 0);
      cards.push({ id: 'co_overview', size: 'lg', icon: '🏢', title: '公司今日概況', stats: [
        { label: '在職人員', value: staff.filter(s => s.role === 'staff').length },
        { label: '服務社區', value: comm },
        { label: '今日排班上班', value: working.size },
        { label: '已打卡', value: [...working].filter(x => checked.has(x)).length, warn: working.size && [...working].filter(x => !checked.has(x)).length ? `${[...working].filter(x => !checked.has(x)).length} 人未打卡` : '' },
        { label: '今日請假', value: todayLeave.length },
        { label: '審核中假單', value: pendAll },
      ], action: { action: 'attendance-records', label: '出勤紀錄' } });
      if (cfg) {
        const members = safe(() => db.prepare('SELECT staff_id,position_id FROM org_members WHERE tenant_id=?').all(tid), []);
        const active = new Set(staff.map(s => s.id));
        const byDept = cfg.departments.map(dp => ({ name: dp.name, n: members.filter(x => active.has(x.staff_id) && cfg.positions.find(p => p.id === x.position_id)?.dept === dp.id).length }));
        const unmapped = staff.filter(s => !members.some(x => x.staff_id === s.id)).length;
        cards.push({ id: 'co_depts', size: 'md', icon: '🧭', title: '各部門人數', items: [...byDept.map(x => ({ text: x.name, value: `${x.n} 人` })), ...(unmapped ? [{ text: '尚未設定職位', value: `${unmapped} 人`, tone: 'alert' }] : [])], action: { action: 'manage-staff', label: '組織圖' } });
      }
      if (canPay) {
        const last = safe(() => db.prepare("SELECT r.month,(SELECT COALESCE(SUM(employer_cost),0) FROM payroll_items i WHERE i.run_id=r.id) cost,(SELECT COALESCE(SUM(net),0) FROM payroll_items i WHERE i.run_id=r.id) net,(SELECT COUNT(*) FROM payroll_items i WHERE i.run_id=r.id) n FROM payroll_runs r WHERE r.tenant_id=? AND r.status='published' ORDER BY r.month DESC LIMIT 1").get(tid), null);
        if (last) cards.push({ id: 'co_cost', size: 'sm', icon: '💰', title: `${Number(last.month.slice(5, 7))} 月人事成本`, value: `$${money(last.cost)}`, sub: `${last.n} 人・實發 $${money(last.net)}`, action: { action: 'payroll-stats', label: '人員薪資統計表' } });
      }
    }
    // 今日請假名單（老闆、人事、部門主管）：只顯示「請假」，假別只給人事看
    if (boss || canHR || ['dept_head', 'dept_manager', 'region'].includes(kind)) {
      let list = todayLeave;
      if (!boss && !canHR && mi) {
        const scope = new Set(scopeStaff(tid, u, mi, cfg)); list = list.filter(r => scope.has(r.staff_id));
      }
      cards.push({ id: 'co_leave_today', size: 'md', icon: '🗓', title: `今日請假（${list.length}）`, items: list.slice(0, 12).map(r => ({ text: r.name, value: `${canHR ? r.type_name + '・' : ''}${lenText(r.today.h)}` })), empty: '今天沒有人請假', action: { action: 'leave', label: '請假管理', tab: canHR ? 'all' : 'approve' } });
    }

    // ---------- 會計 ----------
    if (canPay) {
      const run = safe(() => db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tid, m), null);
      const items = run ? safe(() => db.prepare('SELECT gross,net,confirmed_at,viewed_at,data_json FROM payroll_items WHERE run_id=?').all(run.id), []) : [];
      cards.push({ id: 'pay_month', size: 'md', icon: '📊', title: `${Number(m.slice(5, 7))} 月薪資`, value: !run ? '尚未產生' : run.status === 'published' ? '已發布' : '草稿', tone: !run ? 'alert' : '', stats: run ? [{ label: '人數', value: items.length }, { label: '實發合計', value: `$${money(items.reduce((a, x) => a + (x.net || 0), 0))}` }, ...(run.status === 'published' ? [{ label: '已確認', value: `${items.filter(x => x.confirmed_at).length}/${items.length}` }] : [{ label: '請假扣款', value: `$${money(items.reduce((a, x) => a + (parse(x.data_json, {}).leave_deduct || 0), 0))}` }])] : [], action: { action: 'payroll-stats', label: '人員薪資統計表' } });
      const adv = safe(() => db.prepare("SELECT a.* FROM salary_advances a WHERE a.tenant_id=? AND a.status='active'").all(tid), []);
      const paid = id => safe(() => db.prepare("SELECT COALESCE(SUM(r.amount),0) s FROM advance_repayments r LEFT JOIN payroll_runs pr ON pr.id=r.run_id WHERE r.advance_id=? AND (r.run_id IS NULL OR pr.status='published')").get(id).s, 0);
      const advLeft = adv.reduce((a, x) => a + Math.max(0, x.amount - paid(x.id)), 0);
      const absent = safe(() => db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE tenant_id=? AND absent=1 AND status='approved' AND substr(start_date,1,7)<=? AND substr(end_date,1,7)>=?").get(tid, m, m).c, 0);
      const ot = safe(() => db.prepare("SELECT COUNT(*) c,COALESCE(SUM(hours),0) h FROM schedule_overtime WHERE tenant_id=? AND status<>'rejected' AND substr(work_date,1,7)=?").get(tid, m), { c: 0, h: 0 });
      cards.push({ id: 'pay_todo', size: 'md', icon: '🧾', title: '會計待處理', items: [
        { text: '借資未扣回', value: adv.length ? `$${money(advLeft)}（${adv.length} 筆）` : '無', action: { action: 'payroll-advances', label: '借資' } },
        { text: '本月證明逾期列曠職', value: `${absent} 張`, tone: absent ? 'alert' : '', action: { action: 'leave', label: '請假管理', tab: 'all' } },
        { text: '本月加班紀錄', value: `${ot.c} 筆・${Math.round(ot.h * 10) / 10} 小時`, action: { action: 'schedule-overtime', label: '加班' } },
      ] });
    }

    // ---------- 人事 ----------
    if (canHR) {
      const profs = safe(() => db.prepare('SELECT * FROM hr_profiles WHERE tenant_id=?').all(tid), []); const P = new Map(profs.map(p => [p.staff_id, p]));
      const soon = addDays(t, 14); const list = staff.filter(s => s.role === 'staff');
      const trial = list.filter(s => { const p = P.get(s.id); return p?.trial_end_date && p.trial_end_date >= t && p.trial_end_date <= soon; });
      const grant = list.filter(s => { const p = P.get(s.id); const a = p?.hire_date && payroll?.annualLeave ? payroll.annualLeave(p.hire_date, t) : null; return a?.next_date && a.next_date >= t && a.next_date <= soon; });
      const miss = k => list.filter(s => !P.get(s.id)?.[k]).length;
      const mm = m.slice(5, 7); const bday = list.filter(s => (P.get(s.id)?.birthday || '').slice(5, 7) === mm);
      cards.push({ id: 'hr_alerts', size: 'md', icon: '👥', title: '人事提醒', items: [
        { text: '試用期 14 天內到期', value: trial.length ? trial.map(s => `${s.name}（${P.get(s.id).trial_end_date.slice(5)}）`).join('、') : '無', tone: trial.length ? 'alert' : '' },
        { text: '14 天內取得新年度特休', value: grant.length ? grant.map(s => s.name).join('、') : '無' },
        { text: '資料未補齊', value: [miss('hire_date') && `到職日 ${miss('hire_date')} 人`, miss('gender') && `性別 ${miss('gender')} 人`, miss('mobile') && `手機 ${miss('mobile')} 人`].filter(Boolean).join('、') || '都已登記', tone: miss('hire_date') ? 'alert' : '' },
        { text: `${Number(mm)} 月壽星`, value: bday.length ? bday.map(s => `${s.name} ${P.get(s.id).birthday.slice(5)}`).join('、') : '無' },
      ], action: { action: 'hr-records', label: '人事管理' } });
      const pr = safe(() => db.prepare("SELECT proof_status,COUNT(*) c FROM leave_requests WHERE tenant_id=? AND status IN ('pending','approved') AND proof_status IN ('pending','submitted','overdue') GROUP BY proof_status").all(tid), []);
      const pc = k => pr.find(x => x.proof_status === k)?.c || 0;
      cards.push({ id: 'hr_proofs', size: 'sm', icon: '📎', title: '假單證明', value: pc('submitted'), sub: `待確認｜待補 ${pc('pending')}・逾期 ${pc('overdue')}`, tone: pc('overdue') ? 'alert' : '', action: { action: 'leave', label: '請假管理', tab: 'all' } });
    }

    // ---------- 總務 ----------
    if (!boss && (has(u, 'company-general-affairs') || has(u, 'manage-templates')) && u.role !== 'company_admin') {
      cards.push({ id: 'ga', size: 'md', icon: '📦', title: '總務常用', items: [
        { text: '設備清冊', value: '開啟', action: { action: 'equip-inventory', label: '設備清冊' } },
        { text: '社區進駐設備', value: '開啟', action: { action: 'equip-sites', label: '社區進駐設備' } },
        { text: '公司制式文件', value: '開啟', action: { action: 'manage-templates', label: '公司制式文件' } },
        { text: '禮品推放', value: '開啟', action: { action: 'gifts', label: '禮品推放' } },
      ] });
    }

    // ---------- 面試 ----------
    if (interview) { const iv = safe(() => interview.dashboard(tid, u), null); if (iv && iv.open) cards.push({ id: 'interviews', size: 'sm', icon: '📝', title: '面試待審核', value: iv.open, sub: '位面試人員', tone: 'alert', action: { action: 'interviews', label: '面試管理' } }); }

    // ---------- 請款審核／待付款 ----------
    if (ap) {
      const p = safe(() => ap.dashboard(tid, u), null);
      if (p && p.todo) cards.push({ id: 'ap_todo', size: 'sm', icon: '💸', title: '請款待我審核', value: p.todo, sub: '張請款單', tone: 'alert', action: { action: 'ap-my', label: '請款', tab: 'todo' } });
      if (p && acct && modOn('accounting') && safe(() => acct.canAcct(u), false)) cards.push({ id: 'ap_unpaid', size: 'sm', icon: '💰', title: '公司應支', value: `$${money(p.unpaid_amount)}`, sub: `待付款 ${p.unpaid} 張${p.overdue ? `・逾期 ${p.overdue} 張` : ''}`, tone: p.overdue ? 'alert' : '', action: { action: 'acct-ap', label: '公司應支' } });
    }

    // ---------- 公司應收（會計）----------
    if (ar && acct && modOn('accounting') && safe(() => acct.canAcct(u), false)) {
      const a = safe(() => ar.dashboard(tid), null);
      if (a) cards.push({ id: 'ar', size: 'sm', icon: '🧾', title: '公司應收', value: `$${money(a.outstanding)}`, sub: `未收款｜${a.overdue ? `逾期 ${a.overdue} 張 $${money(a.overdue_amount)}` : '沒有逾期'}${a.drafts ? `・未開立 ${a.drafts} 張` : ''}`, tone: a.overdue ? 'alert' : '', action: { action: 'acct-ar', label: '公司應收' } });
    }

    // ---------- 社區合約到期 ----------
    if (contracts && safe(() => contracts.canEdit(u), false)) {
      const c = safe(() => contracts.dashboard(tid), null);
      if (c && (c.expiring.length || (!boss && u.role !== 'company_admin'))) cards.push({ id: 'contracts', size: 'sm', icon: '📄', title: '社區合約', value: c.expiring.length, sub: c.expiring.length ? `即將到期：${c.expiring.slice(0, 3).map(x => `${x.community}（${x.days} 天）`).join('、')}` : `履約中 ${c.current} 份`, tone: c.expiring.some(x => x.days <= 30) ? 'alert' : '', action: { action: 'contracts', label: '社區合約' } });
    }

    // ---------- 設備借用（總務）----------
    if (equip && modOn('equip_apply') && safe(() => equip.isGA(u), false)) {
      const e = safe(() => equip.dashboard(tid), null);
      const todo = e ? e.pending_ga + e.approved + e.returning : 0;
      if (e && (todo || e.overdue || (!boss && u.role !== 'company_admin'))) cards.push({ id: 'equip', size: 'sm', icon: '🧰', title: '設備借用', value: todo, sub: `待處理｜出借中 ${e.lent}${e.overdue ? `・逾期 ${e.overdue}` : ''}${e.repair ? `・維修中 ${e.repair}` : ''}`, tone: e.overdue ? 'alert' : '', action: { action: 'equip-requests', label: '設備申請紀錄' } });
    }

    // ---------- 部門主管／部門經理：我的部門今天 ----------
    if (mi && ['dept_head', 'dept_manager'].includes(kind)) {
      const scope = scopeStaff(tid, u, mi, cfg); const S = new Set(scope);
      const off = fullLeaveIds(tid); const sched = scheduleToday(tid).filter(x => S.has(x.staff_id)); const working = new Set(sched.filter(x => !['off', 'leave'].includes(x.shift_code) && !off.has(x.staff_id)).map(x => x.staff_id));
      const checked = checkedToday(tid); const lv = todayLeave.filter(r => S.has(r.staff_id));
      const notIn = [...working].filter(x => !checked.has(x));
      const ot = safe(() => db.prepare(`SELECT COUNT(*) c FROM schedule_overtime WHERE tenant_id=? AND status<>'rejected' AND substr(work_date,1,7)=? AND staff_id IN (${scope.map(() => '?').join(',') || 'NULL'})`).get(tid, m, ...scope).c, 0);
      cards.push({ id: 'dept_today', size: 'lg', icon: '👮', title: `${deptName || '我的部門'}${mi.shift ? `（${mi.shift === 'day' ? '日班' : '夜班'}）` : ''}今天`, stats: [
        { label: '部門人數', value: scope.length }, { label: '今日上班', value: working.size }, { label: '已打卡', value: working.size - notIn.length, warn: notIn.length ? `${notIn.length} 人未打卡` : '' }, { label: '請假', value: lv.length }, { label: '本月加班', value: `${ot} 筆` },
      ], items: [...notIn.slice(0, 8).map(id => ({ text: nameOf.get(id), value: '尚未打卡', tone: 'alert' })), ...lv.slice(0, 8).map(r => ({ text: r.name, value: `請假・${lenText(r.today.h)}` }))], action: { action: 'schedule-month', label: '月班表' } });
    }

    // ---------- 社區狀況：督導（自己的區域）、老闆與部門主管（全部社區） ----------
    if (boss || kind === 'region' || ['dept_head', 'dept_manager'].includes(kind)) {
      let comms = safe(() => db.prepare("SELECT id,name,region_id FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid), []);
      if (kind === 'region' && mi) comms = comms.filter(c => mi.regions.includes(c.region_id));
      if (comms.length) {
        const sched = scheduleToday(tid); const checked = checkedToday(tid); const offAll = fullLeaveIds(tid);
        const jr = new Map(safe(() => db.prepare("SELECT community_id,status FROM journals WHERE tenant_id=? AND kind='daily' AND period_date=?").all(tid, t), []).map(x => [x.community_id, x.status]));
        const rows = comms.slice(0, 40).map(c => {
          const w = sched.filter(x => x.community_id === c.id && !['off', 'leave'].includes(x.shift_code) && !offAll.has(x.staff_id)); const ids = [...new Set(w.map(x => x.staff_id))];
          const lv = todayLeave.filter(r => sched.some(x => x.staff_id === r.staff_id && x.community_id === c.id));
          const j = jr.get(c.id);
          return { name: c.name, working: ids.length, checked: ids.filter(x => checked.has(x)).length, leave: lv.length, journal: j === 'submitted' ? '已送出' : j ? '填寫中' : '未填', journal_ok: j === 'submitted' };
        });
        cards.push({ id: 'sites', size: 'lg', icon: '🏘', title: kind === 'region' ? '我負責的社區今天' : '各社區今天', table: { head: ['社區', '上班', '已打卡', '請假', '今日日誌'], rows: rows.map(r => [r.name, r.working, r.working ? `${r.checked}/${r.working}` : '—', r.leave || '—', r.journal]), alerts: rows.map(r => [...(r.working && r.checked < r.working ? [2] : []), ...(!r.journal_ok ? [4] : [])]) }, action: { action: 'work-journal', label: '工作日誌管理' } });
      }
    }

    // ---------- 方案提醒（公司高層）：用量接近上限、即將到期、寬限期、試用即將結束 ----------
    if (plans) { const pl = safe(() => plans.dashboard(tid, u), null); if (pl) cards.unshift({ id: 'plan', size: 'md', icon: '💳', title: '方案提醒', tone: pl.alert ? 'alert' : '', items: pl.warnings.map(w => ({ text: w.text, value: '', tone: w.tone })), action: { action: 'plan-billing', label: '方案與費用' } }); }

    res.set('Cache-Control', 'no-store');
    res.json({
      user: { name: u.name, position: mi?.position?.name || (u.role === 'company_admin' ? (u.admin_level === 'owner' ? '公司負責人' : '公司管理員') : (u.position || '')), dept: deptName, kind },
      today: { date: t, weekday: '日一二三四五六'[twNow().getUTCDay()], hour: twNow().getUTCHours() },
      cards,
    });
  });

  // 部門主管：部門內所有人；部門經理：同部門（有班別就同班別）
  function scopeStaff(tid, u, mi, cfg) {
    if (!cfg) return [];
    const rows = safe(() => db.prepare('SELECT o.staff_id,o.position_id,o.shift,o.region_ids_json FROM org_members o JOIN staff_users s ON s.id=o.staff_id WHERE o.tenant_id=? AND s.is_active=1').all(tid), []);
    return rows.filter(r => {
      if (r.staff_id === u.id) return false; const p = cfg.positions.find(x => x.id === r.position_id); if (!p) return false;
      if (mi.kind === 'region') { const s = db.prepare('SELECT * FROM staff_users WHERE id=?').get(r.staff_id); const cids = getSiteAssignments(s).map(a => Number(a.community_id)); const regs = new Set(cids.map(c => db.prepare('SELECT region_id FROM communities WHERE id=?').get(c)?.region_id)); return mi.regions.some(x => regs.has(x)) && p.kind !== 'region'; }
      if (p.dept !== mi.dept || ['dept_head', 'owner', 'gm'].includes(p.kind) || (mi.kind === 'dept_manager' && p.kind === 'dept_manager')) return false;
      if (mi.kind === 'dept_manager' && mi.shift) { const sh = p.shift || r.shift; return !sh || sh === mi.shift; }
      return true;
    }).map(r => r.staff_id);
  }
};
