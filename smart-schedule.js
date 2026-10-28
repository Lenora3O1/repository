// 智慧月班表：依「每班需要幾個人」、每個人的休假制度、自選休假、已核准假單、連續上班上限，
// 自動排出整個月（全公司一次排，機動人員才能跨社區補位），標出每天每班的缺人，並建議補位人選。
// 主管可以點格子微調（手動調整的格子會鎖定，重新排班不會被蓋掉），確認後發布通知所有人。
'use strict';

const GROUPS = [
  ['manager', '社區主管', 'admin'], ['secretary', '秘書', 'admin'], ['guard_day', '日班保全', 'security'], ['guard_night', '夜班保全', 'security'],
];
const GROUP_LABEL = Object.fromEntries(GROUPS.map(g => [g[0], g[1]]));
const LOCKED = new Set(['manual', 'cover', 'swap', 'leave', 'self-select', 'fill']);

module.exports = function registerSmartSchedule(app, d) {
  const { db, getUser, tenantId, now, requireCompanyAdmin, requireCompanyPermission, getSiteAssignments, org, S } = d;
  db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_staffing (tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, config_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT, updated_by TEXT DEFAULT '', PRIMARY KEY (tenant_id,community_id));
  CREATE TABLE IF NOT EXISTS schedule_publish (tenant_id INTEGER NOT NULL, month TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', generated_at TEXT, generated_by TEXT DEFAULT '', published_at TEXT, published_by TEXT DEFAULT '', PRIMARY KEY (tenant_id,month));
  `);
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); }); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => (db.transaction ? db.transaction(fn) : fn);
  const by = u => u?.name || u?.employee_id || '';
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const daysOf = m => { const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const WORK = c => c && !['off', 'leave'].includes(c);
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const canStaffing = u => { if (u?.role === 'company_admin') return true; const m = mi(u); return !!m && ['owner', 'gm', 'dept_head'].includes(m.kind); };

  // ---------- 人力需求（每個社區每班要幾個人；總經理或部門主管設定） ----------
  const DEFAULT_NEED = { manager: { weekday: 1, holiday: 0 }, secretary: { weekday: 1, holiday: 1 }, guard_day: { weekday: 1, holiday: 1 }, guard_night: { weekday: 1, holiday: 1 } };
  function staffingFor(tid, cid) {
    const r = db.prepare('SELECT config_json,updated_at,updated_by FROM schedule_staffing WHERE tenant_id=? AND community_id=?').get(tid, cid);
    const c = parse(r?.config_json, {}) || {}; const out = {};
    // 還沒設定人力需求：只對「有派駐人員」的班別套用預設值
    const has = r ? null : new Set(people(tid).filter(p => p.group !== 'mobile' && p.home === cid).map(p => p.group));
    for (const [g] of GROUPS) { const dflt = has && !has.has(g) ? { weekday: 0, holiday: 0 } : DEFAULT_NEED[g]; out[g] = { weekday: Math.max(0, Math.min(20, Number(c[g]?.weekday ?? dflt.weekday))), holiday: Math.max(0, Math.min(20, Number(c[g]?.holiday ?? dflt.holiday))) }; }
    return { need: out, custom: !!r, updated_at: r?.updated_at || '', updated_by: r?.updated_by || '' };
  }

  // ---------- 人員分組 ----------
  function people(tid) {
    const rows = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND role='staff' AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY employee_id").all(tid);
    const out = [];
    for (const u of rows) {
      const p = S.getProfile(tid, u.id) || {}; const m = mi(u);
      const role = m ? (m.schedule === 'office' ? '' : m.schedule) : (p.schedule_role || '');
      if (!role) continue;
      // 只排實際派駐的案場（舊的班表身分可能留著已經調離的社區，例如改當內勤的人）
      const real = getSiteAssignments(u).map(a => Number(a.community_id));
      const sites = (m && m.kind !== 'region' ? m.sites : null) || (p.community_ids?.length ? p.community_ids.map(Number).filter(c => real.includes(c)) : real);
      if (!sites.length) continue;
      let group;
      if (role === 'mobile') group = 'mobile';
      else if (role === 'security') group = (p.default_shift || m?.shift) === 'night' ? 'guard_night' : 'guard_day';
      else { const mgr = m ? (m.kind === 'site_manager' || (m.kind === 'site_deputy' && m.dept !== 'secretary')) : String(u.job_level || '').includes('經理'); group = mgr ? 'manager' : 'secretary'; }
      const mobileKind = role === 'mobile' ? ((m?.dept === 'secretary') ? 'secretary' : 'guard') : '';
      out.push({ id: u.id, name: u.name, employee_id: u.employee_id, position: m?.position?.name || u.position || '', role, group, sites, home: sites[0], mobileKind, profile: p });
    }
    return out;
  }
  // 每個人當月要休幾天、休假方式
  function restPlan(tid, p, month, reds) {
    if (p.role === 'admin') {
      const rule = S.effectiveRule(tid, p.home, 'admin') || {}; const sub = (p.group === 'manager' ? rule.manager : rule.secretary) || {}; const mode = sub.mode || 'rotation';
      if (mode === 'red_holiday') return { mode, fixed: reds.slice(), target: reds.length };
      if (mode === 'rotation') return { mode, target: reds.length };
      return { mode: 'fixed_monthly', target: Number(sub.rest_days || p.profile.rest_days || 8) };
    }
    const rule = S.effectiveRule(tid, p.home, p.role === 'mobile' ? 'mobile' : 'security') || {};
    return { mode: 'fixed_monthly', target: Number(p.profile.rest_days || rule.rest_days || 6) };
  }

  // ---------- 排班 ----------
  async function generate(tid, month, user) {
    const pub = db.prepare('SELECT * FROM schedule_publish WHERE tenant_id=? AND month=?').get(tid, month);
    if (pub?.status === 'published') throw Object.assign(new Error('這個月的班表已經發布，請先「撤回發布」才能重新排班'), { status: 409 });
    const days = daysOf(month); const reds = (await S.holidays(Number(month.slice(0, 4)))).filter(x => x.startsWith(month)); const red = new Set(reds);
    const max = Math.max(1, Number(S.platformRules().max_consecutive || 6));
    const ppl = people(tid);
    const comms = db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active'").all(tid);
    // 鎖定的格子：手動調整、代班、調假、自選休假、請假
    const existing = db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND month=?').all(tid, month);
    const lock = new Map(); for (const e of existing) if (LOCKED.has(e.source)) { const k = `${e.staff_id}|${e.work_date}`; if (!lock.has(k) || WORK(e.shift_code)) lock.set(k, e); }
    const leave = new Map(); try { for (const r of db.prepare("SELECT staff_id,entries_json FROM leave_requests WHERE tenant_id=? AND status='approved' AND start_date<=? AND end_date>=?").all(tid, days[days.length - 1], days[0])) for (const e of parse(r.entries_json, [])) if (e.d.startsWith(month) && Number(e.h) >= 8) leave.set(`${r.staff_id}|${e.d}`, true); } catch {}
    // 每個人的計畫：date -> {code, community_id, locked}
    const plan = new Map();
    for (const p of ppl) {
      const rp = restPlan(tid, p, month, reds); p.rest = rp; const map = new Map();
      for (const dt of days) {
        const k = `${p.id}|${dt}`; const l = lock.get(k);
        if (leave.has(k)) map.set(dt, { code: 'leave', cid: l?.community_id ?? p.home, locked: true });
        else if (l) map.set(dt, { code: l.shift_code, cid: l.community_id ?? p.home, locked: true, source: l.source });
      }
      if (rp.fixed) for (const dt of rp.fixed) if (!map.has(dt)) map.set(dt, { code: 'off', cid: p.home, locked: false });
      plan.set(p.id, map);
    }
    const workCode = p => p.group === 'guard_night' ? 'night' : p.group === 'guard_day' ? 'day' : 'work';
    const need = new Map(comms.map(c => [c.id, staffingFor(tid, c.id).need]));
    const needOf = (cid, g, dt) => { const n = need.get(cid)?.[g]; if (!n) return 0; return red.has(dt) ? n.holiday : n.weekday; };
    // 某社區某班某天，已確定上班（含鎖定）與尚未決定的人數
    const groupPeople = (cid, g) => ppl.filter(p => p.group === g && p.home === cid);
    const workingCount = (cid, g, dt) => { let n = 0; for (const p of ppl) { const e = plan.get(p.id).get(dt); if (!e) { if (p.group === g && p.home === cid) n++; continue; } if (WORK(e.code) && Number(e.cid) === Number(cid) && (p.group === g || (p.group === 'mobile' && e.group === g))) n++; } return n; };
    const offCount = p => [...plan.get(p.id).values()].filter(e => e.code === 'off').length;
    // 1) 一般人員：輪流挑休假日，優先挑「人力有餘裕」的日子
    for (const c of comms) for (const [g] of GROUPS) {
      const list = groupPeople(c.id, g).filter(p => !p.rest.fixed); if (!list.length) continue;
      const remaining = new Map(list.map(p => [p.id, Math.max(0, p.rest.target - offCount(p))]));
      // 先確保不會連續上班超過上限：每段太長的上班區間，挑人力最有餘裕的一天排休
      for (const p of list) {
        const mp = plan.get(p.id); let loop = 0;
        while (loop++ < 20 && remaining.get(p.id) > 0) {
          let run = [], longRun = null; for (const dt of days) { const e = mp.get(dt); if (!e || WORK(e.code)) { run.push(dt); if (run.length > max && !longRun) longRun = run.slice(); } else run = []; }
          if (!longRun) break;
          const win = longRun.slice(-(max + 1)).filter(dt => !mp.has(dt)); if (!win.length) break;
          const pick = win.sort((a2, b2) => ((workingCount(c.id, g, b2) - needOf(c.id, g, b2)) - (workingCount(c.id, g, a2) - needOf(c.id, g, a2))) || b2.localeCompare(a2))[0];
          mp.set(pick, { code: 'off', cid: p.home, locked: false }); remaining.set(p.id, remaining.get(p.id) - 1);
        }
      }
      let guard = 0;
      while ([...remaining.values()].some(v => v > 0) && guard++ < 1000) {
        for (const p of [...list].sort((a, b) => remaining.get(b.id) - remaining.get(a.id))) {
          if (remaining.get(p.id) <= 0) continue;
          const mp = plan.get(p.id); const myOffs = days.filter(dt => mp.get(dt)?.code === 'off');
          let best = null, bestScore = -Infinity;
          for (const dt of days) {
            if (mp.has(dt)) continue;
            const surplus = workingCount(c.id, g, dt) - needOf(c.id, g, dt);
            const spacing = myOffs.length ? Math.min(4, ...myOffs.map(o => Math.abs((new Date(o) - new Date(dt)) / 864e5))) : 4;
            const score = (surplus > 0 ? 100 : surplus === 0 ? -50 : -200) + surplus * 5 + spacing * 6 + (p.rest.mode === 'rotation' && red.has(dt) ? 8 : 0) + (red.has(dt) ? 1 : 0);
            if (score > bestScore) { bestScore = score; best = dt; }
          }
          if (!best) { remaining.set(p.id, 0); continue; }
          mp.set(best, { code: 'off', cid: p.home, locked: false }); remaining.set(p.id, remaining.get(p.id) - 1);
        }
      }
    }
    // 2) 其餘日子上班；連續上班超過上限時，在這段中挑人力最有餘裕的一天改休
    const extraOff = [];
    for (const p of ppl.filter(x => x.group !== 'mobile')) {
      const mp = plan.get(p.id);
      for (const dt of days) if (!mp.has(dt)) mp.set(dt, { code: workCode(p), cid: p.home, locked: false });
      let streak = []; for (const dt of days) {
        const e = mp.get(dt); if (WORK(e.code)) streak.push(dt); else streak = [];
        if (streak.length > max) { const cand = streak.slice(-(max + 1)).filter(x => !mp.get(x).locked).sort((a, b) => ((workingCount(p.home, p.group, b) - needOf(p.home, p.group, b)) - (workingCount(p.home, p.group, a) - needOf(p.home, p.group, a))) || b.localeCompare(a))[0]; if (cand) { mp.set(cand, { code: 'off', cid: p.home, locked: false }); extraOff.push({ staff_id: p.id, date: cand }); streak = streak.slice(streak.indexOf(cand) + 1); } }
      }
    }
    // 3) 機動人員：一天一天排，哪裡缺人就去哪裡（缺口越少人能補的越先補）；不缺人的日子排休；不超過連續上班上限
    const mobiles = ppl.filter(p => p.group === 'mobile');
    const fitG = (p, g) => p.mobileKind === 'secretary' ? g === 'secretary' : g.startsWith('guard');
    const offsLeft = new Map(mobiles.map(p => [p.id, Math.max(0, p.rest.target - offCount(p))])); const streak = new Map(mobiles.map(p => [p.id, 0])); const rTotal = new Map(offsLeft);
    days.forEach((dt, di) => {
      const free = mobiles.filter(p => !plan.get(p.id).has(dt));
      for (const p of mobiles) if (plan.get(p.id).has(dt)) streak.set(p.id, WORK(plan.get(p.id).get(dt).code) ? streak.get(p.id) + 1 : 0);
      const gaps = []; for (const c of comms) for (const [g] of GROUPS) { const sN = needOf(c.id, g, dt) - workingCount(c.id, g, dt); if (sN > 0) gaps.push({ cid: c.id, g, s: sN, who: free.filter(p => p.sites.includes(c.id) && fitG(p, g)) }); }
      gaps.sort((a, b) => a.who.length - b.who.length);
      const used = new Set();
      for (const gp of gaps) for (const p of gp.who) { if (gp.s <= 0) break; if (used.has(p.id) || streak.get(p.id) >= max) continue; const left = days.length - di; if (offsLeft.get(p.id) >= left) continue;
        plan.get(p.id).set(dt, { code: gp.g === 'guard_night' ? 'night' : gp.g === 'guard_day' ? 'day' : 'work', cid: gp.cid, group: gp.g, locked: false }); used.add(p.id); gp.s--; streak.set(p.id, streak.get(p.id) + 1); }
      for (const p of free) { if (used.has(p.id)) continue; const left = days.length - di;
        const total = rTotal.get(p.id), taken = total - offsLeft.get(p.id); if (offsLeft.get(p.id) > 0 && (streak.get(p.id) >= max || offsLeft.get(p.id) >= left || taken < Math.ceil(total * (di + 1) / days.length))) { plan.get(p.id).set(dt, { code: 'off', cid: p.home, locked: false }); offsLeft.set(p.id, offsLeft.get(p.id) - 1); streak.set(p.id, 0); }
        else if (streak.get(p.id) >= max) { plan.get(p.id).set(dt, { code: 'off', cid: p.home, locked: false }); streak.set(p.id, 0); extraOff.push({ staff_id: p.id, date: dt }); }
        else { plan.get(p.id).set(dt, { code: 'work', cid: p.home, group: 'standby', locked: false }); streak.set(p.id, streak.get(p.id) + 1); } }
    });
    // 4) 寫入（只覆蓋自動排的格子）
    tx(() => {
      db.prepare("DELETE FROM schedule_entries WHERE tenant_id=? AND month=? AND source IN ('auto','smart')").run(tid, month);
      const ins = db.prepare("INSERT INTO schedule_entries (tenant_id,month,work_date,staff_id,community_id,category,shift_code,status,source,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,work_date,staff_id,community_id) DO NOTHING");
      for (const p of ppl) for (const [dt, e] of plan.get(p.id)) {
        if (e.locked) continue;
        const cat = p.role === 'mobile' ? 'mobile' : p.role;
        ins.run(tid, month, dt, p.id, e.cid, cat, e.code, 'planned', 'smart', e.group === 'standby' ? '機動待命' : '', user?.id || null, now(), now());
      }
      db.prepare("INSERT INTO schedule_publish (tenant_id,month,status,generated_at,generated_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,month) DO UPDATE SET status='draft',generated_at=excluded.generated_at,generated_by=excluded.generated_by").run(tid, month, 'draft', now(), by(user));
    })();
    return { people: ppl.length, extra_off: extraOff.length };
  }

  // ---------- 檢視：每天每班的人力、缺人與補位建議 ----------
  function view(tid, month, cid) {
    const days = daysOf(month); const reds = new Set(S.redDatesSync(Number(month.slice(0, 4))).filter(x => x.startsWith(month)));
    const max = Math.max(1, Number(S.platformRules().max_consecutive || 6));
    const comms = db.prepare("SELECT id,name,region_id FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid);
    const c = comms.find(x => x.id === cid) || comms[0]; if (!c) return { month, communities: [], days: [] };
    const ppl = people(tid);
    const entries = db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND month=?').all(tid, month);
    const byStaff = new Map(); for (const e of entries) { if (!byStaff.has(e.staff_id)) byStaff.set(e.staff_id, new Map()); const m = byStaff.get(e.staff_id); const cur = m.get(e.work_date); if (!cur || WORK(e.shift_code) || (Number(e.community_id) === Number(c.id) && !WORK(cur.shift_code))) m.set(e.work_date, e); }
    const st = staffingFor(tid, c.id); const needOf = (g, dt) => reds.has(dt) ? st.need[g].holiday : st.need[g].weekday;
    const groupOfEntry = (p, e) => p.group !== 'mobile' ? p.group : (e.shift_code === 'night' ? 'guard_night' : e.shift_code === 'day' ? 'guard_day' : (p.mobileKind === 'secretary' ? 'secretary' : 'standby'));
    const rows = []; const cover = {};
    for (const [g] of GROUPS) cover[g] = days.map(dt => ({ date: dt, need: needOf(g, dt), have: 0 }));
    const streakAt = (m, dt) => { let n = 0; for (let x = dt; m.get(x) && WORK(m.get(x).shift_code); x = addDays(x, -1)) n++; return n; };
    for (const p of ppl) {
      const m = byStaff.get(p.id) || new Map();
      const here = p.group === 'mobile' ? p.sites.includes(c.id) : p.home === c.id; if (!here) continue;
      const cells = days.map(dt => { const e = m.get(dt); if (!e) return { date: dt, code: '' }; const inC = Number(e.community_id) === Number(c.id); const g = groupOfEntry(p, e);
        if (WORK(e.shift_code) && inC && cover[g]) cover[g][days.indexOf(dt)].have++;
        return { date: dt, code: e.shift_code, here: inC, community: inC ? '' : (comms.find(x => x.id === e.community_id)?.name || ''), source: e.source, locked: LOCKED.has(e.source), note: e.note || '', streak_warn: WORK(e.shift_code) && streakAt(m, dt) > max }; });
      const rp = restPlan(tid, p, month, [...reds]);
      rows.push({ staff_id: p.id, name: p.name, employee_id: p.employee_id, position: p.position, group: p.group, rest_mode: rp.mode, rest_target: rp.target, work: cells.filter(x => WORK(x.code)).length, off: cells.filter(x => x.code === 'off').length, leave: cells.filter(x => x.code === 'leave').length, cells });
    }
    // 缺人與補位建議
    const shortages = [];
    for (const [g] of GROUPS) for (const cv of cover[g]) if (cv.have < cv.need) {
      const dt = cv.date; const sug = [];
      for (const p of ppl) {
        const m = byStaff.get(p.id) || new Map(); const e = m.get(dt);
        const fits = p.group === g || (p.group === 'mobile' && (p.mobileKind === 'secretary' ? g === 'secretary' : g.startsWith('guard')));
        if (!fits) continue;
        const near = p.group === 'mobile' ? p.sites.includes(c.id) : true;
        if (e && WORK(e.shift_code) && !(p.group === 'mobile' && e.note === '機動待命')) continue; if (e?.shift_code === 'leave') continue;
        // 連續上班檢查
        let n = 1; for (let x = addDays(dt, -1); m.get(x) && WORK(m.get(x).shift_code); x = addDays(x, -1)) n++; for (let x = addDays(dt, 1); m.get(x) && WORK(m.get(x).shift_code); x = addDays(x, 1)) n++;
        if (n > max) continue;
        const kind = p.group === 'mobile' ? (e?.note === '機動待命' ? 'mobile' : 'mobile_off') : (p.home === c.id ? 'overtime' : 'transfer');
        if (kind === 'transfer' && !(comms.find(x => x.id === p.home)?.region_id && comms.find(x => x.id === p.home)?.region_id === c.region_id)) continue;
        if (!near && p.group === 'mobile') continue;
        sug.push({ staff_id: p.id, name: p.name, kind, label: { mobile: '機動待命，可直接支援', mobile_off: '機動人員（當天休假，算加班）', overtime: '同社區同班別，當天休假（算休假日加班）', transfer: `同區域其他社區（${comms.find(x => x.id === p.home)?.name || ''}）調派，當天休假` }[kind] });
      }
      const order = { mobile: 0, overtime: 1, mobile_off: 2, transfer: 3 }; sug.sort((a, b) => order[a.kind] - order[b.kind]);
      shortages.push({ date: dt, group: g, group_label: GROUP_LABEL[g], need: cv.need, have: cv.have, short: cv.need - cv.have, suggestions: sug.slice(0, 6) });
    }
    const pub = db.prepare('SELECT * FROM schedule_publish WHERE tenant_id=? AND month=?').get(tid, month);
    return { month, community: c, communities: comms.map(x => ({ id: x.id, name: x.name })), days: days.map(dt => ({ date: dt, red: reds.has(dt), wd: '日一二三四五六'[new Date(`${dt}T12:00:00Z`).getUTCDay()] })), groups: GROUPS.map(([k, l]) => ({ key: k, label: l })), rows, cover, shortages, staffing: st, publish: pub ? { status: pub.status, generated_at: pub.generated_at, generated_by: pub.generated_by, published_at: pub.published_at, published_by: pub.published_by } : null, max_consecutive: max };
  }

  // ---------- 路由 ----------
  const P = requireCompanyPermission('schedule');
  const notify = (tid, from, toIds, subject, body) => { for (const toId of [...new Set(toIds)]) { try { const to = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(toId, tid); if (!to || to.id === from.id) continue; db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)').run(tid, from.id, to.id, from.employee_id, from.name, to.employee_id, to.name, subject, body, 'text', '', now()); } catch {} } };
  app.get('/api/company/schedule/smart', requireCompanyAdmin, P, wrap(async (req, res) => {
    const tid = tenantId(req); const month = isMonth(req.query.month) ? req.query.month : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
    await S.holidays(Number(month.slice(0, 4))).catch(() => {});
    res.set('Cache-Control', 'no-store'); res.json({ ...view(tid, month, Number(req.query.community_id) || 0), can_staffing: canStaffing(getUser(req)) });
  }));
  app.post('/api/company/schedule/smart/generate', requireCompanyAdmin, P, wrap(async (req, res) => {
    const month = req.body?.month; if (!isMonth(month)) return bad(res, '月份格式不正確');
    const r = await generate(tenantId(req), month, getUser(req)); res.json({ success: true, ...r });
  }));
  app.put('/api/company/schedule/smart/staffing/:cid', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canStaffing(u)) return bad(res, '人力需求由公司管理員、總經理或部門主管設定', 403);
    const tid = tenantId(req); const cid = Number(req.params.cid); if (!db.prepare('SELECT 1 FROM communities WHERE id=? AND tenant_id=?').get(cid, tid)) return bad(res, '找不到社區', 404);
    const b = req.body?.need || {}; const clean = {}; for (const [g] of GROUPS) clean[g] = { weekday: Math.max(0, Math.min(20, Math.round(Number(b[g]?.weekday) || 0))), holiday: Math.max(0, Math.min(20, Math.round(Number(b[g]?.holiday) || 0))) };
    db.prepare('INSERT INTO schedule_staffing (tenant_id,community_id,config_json,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,community_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, cid, JSON.stringify(clean), now(), by(u));
    res.json({ success: true, staffing: staffingFor(tid, cid) });
  }));
  // 點格子調整（鎖定，重新排班不會蓋掉）
  app.post('/api/company/schedule/smart/cell', requireCompanyAdmin, P, wrap((req, res) => {
    const tid = tenantId(req); const b = req.body || {}; const sid = Number(b.staff_id), cid = Number(b.community_id); const dt = String(b.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return bad(res, '日期不正確');
    if (!['work', 'day', 'night', 'off', ''].includes(b.code)) return bad(res, '班別不正確');
    const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid); if (!u) return bad(res, '找不到人員', 404);
    const pub = db.prepare('SELECT status FROM schedule_publish WHERE tenant_id=? AND month=?').get(tid, dt.slice(0, 7));
    const rows = db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date=?').all(tid, sid, dt);
    if (rows.some(x => x.shift_code === 'leave')) return bad(res, '這天已經核准請假，請從請假／代班處理');
    tx(() => {
      db.prepare('DELETE FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date=?').run(tid, sid, dt);
      if (b.code) { const p = S.getProfile(tid, sid) || {}; db.prepare("INSERT INTO schedule_entries (tenant_id,month,work_date,staff_id,community_id,category,shift_code,status,source,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(tid, dt.slice(0, 7), dt, sid, cid || null, p.schedule_role || 'security', b.code, 'planned', 'manual', pub?.status === 'published' ? '發布後調整' : '', getUser(req).id, now(), now()); }
    })();
    if (pub?.status === 'published') notify(tid, getUser(req), [sid], '班表異動', `📅 您 ${dt} 的班表已調整為「${{ work: '上班', day: '日班', night: '夜班', off: '休假', '': '未排' }[b.code]}」。`);
    res.json({ success: true });
  }));
  // 缺人補位：指派後如果對方當天休假，自動記一筆休假日加班
  app.post('/api/company/schedule/smart/fill', requireCompanyAdmin, P, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const b = req.body || {}; const sid = Number(b.staff_id), cid = Number(b.community_id); const dt = String(b.date || ''); const g = b.group;
    if (!GROUP_LABEL[g]) return bad(res, '班別不正確');
    const code = g === 'guard_night' ? 'night' : g === 'guard_day' ? 'day' : 'work';
    const rows = db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date=?').all(tid, sid, dt);
    if (rows.some(x => x.shift_code === 'leave')) return bad(res, '這位人員當天請假');
    const wasOff = !rows.length || rows.every(x => x.shift_code === 'off') ; const standby = rows.some(x => x.note === '機動待命');
    let otId = null;
    tx(() => {
      db.prepare('DELETE FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND work_date=?').run(tid, sid, dt);
      const p = S.getProfile(tid, sid) || {};
      db.prepare("INSERT INTO schedule_entries (tenant_id,month,work_date,staff_id,community_id,category,shift_code,status,source,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(tid, dt.slice(0, 7), dt, sid, cid, p.schedule_role || 'security', code, 'planned', 'fill', `補位：${GROUP_LABEL[g]}`, u.id, now(), now());
      if (wasOff && !standby) {
        let pol = {}; try { pol = S.leavePolicy(tid) || {}; } catch {}
        const red = new Set(S.redDatesSync(Number(dt.slice(0, 4)))).has(dt); const type = red && (pol.overtime_types || []).some(x => x.id === 'holiday' && x.enabled) ? 'holiday' : 'rest_day'; const T = (pol.overtime_types || []).find(x => x.id === type);
        try { const info = db.prepare("INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at,ot_type,source,needs_approval,comp_choice,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(tid, sid, cid, dt, 8, T?.name || '補位', code, `班表補位（${GROUP_LABEL[g]}）`, 'approved', u.id, now(), now(), T ? type : '', 'fill', 0, T?.comp === 'comp' ? 'comp' : T?.comp === 'pay' ? 'pay' : '', by(u), now()); otId = Number(info.lastInsertRowid); } catch (e) { console.warn('fill overtime failed', e.message); }
      }
    })();
    const cname = db.prepare('SELECT name FROM communities WHERE id=?').get(cid)?.name || '';
    notify(tid, u, [sid], '班表補位', `📅 已安排您 ${dt} 到 ${cname} 支援（${GROUP_LABEL[g]}）。${otId ? '\n這天原本是您的休假，會記為加班，請到「班表 → 加班」確認領加班費或換補休。' : ''}`);
    res.json({ success: true, overtime_id: otId });
  }));
  app.post('/api/company/schedule/smart/publish', requireCompanyAdmin, P, wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req); const month = req.body?.month; if (!isMonth(month)) return bad(res, '月份格式不正確');
    const unpublish = !!req.body?.unpublish;
    db.prepare("INSERT INTO schedule_publish (tenant_id,month,status,published_at,published_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,month) DO UPDATE SET status=excluded.status,published_at=excluded.published_at,published_by=excluded.published_by").run(tid, month, unpublish ? 'draft' : 'published', unpublish ? null : now(), unpublish ? '' : by(u));
    if (!unpublish) { const ids = db.prepare('SELECT DISTINCT staff_id FROM schedule_entries WHERE tenant_id=? AND month=?').all(tid, month).map(x => x.staff_id); notify(tid, u, ids, '班表發布', `📅 ${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月班表已發布，請到「班表 → 案場全班班表」查看。如需調整請用「調假」或「請假／代班」。`); }
    res.json({ success: true });
  }));
  // 給現場：這個月是否還在排班（草稿中不給看）
  function isDraft(tid, month) { const r = db.prepare('SELECT status FROM schedule_publish WHERE tenant_id=? AND month=?').get(tid, month); return r?.status === 'draft'; }
  return { generate, view, isDraft };
};
