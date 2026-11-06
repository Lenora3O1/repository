// 出勤工時：依班別時段與打卡紀錄，每天自動算出正常工時、排定加班（保全 8＋4）、遲到早退、缺卡，
// 超時與休假日出勤列為「待核定」，由主管核定後轉成加班紀錄（依公司加班方式：加班費、補貼或補休）。
// 另提供：出勤工時報表（年月、社區、職務、人員）下載 Excel／列印 PDF、補打卡標示、打卡紀錄防竄改驗證、補休餘額與期限。
'use strict';
const crypto = require('crypto');
const { buildXlsx } = require('./xlsx-writer');

const DEFAULT_SHIFTS = [
  { id: 'a0817', name: '行政 08:00–17:00', start: '08:00', end: '17:00', break_min: 60, group: 'admin' },
  { id: 'a0918', name: '行政 09:00–18:00', start: '09:00', end: '18:00', break_min: 60, group: 'admin' },
  { id: 'a1019', name: '行政 10:00–19:00', start: '10:00', end: '19:00', break_min: 60, group: 'admin' },
  { id: 'a1120', name: '行政 11:00–20:00', start: '11:00', end: '20:00', break_min: 60, group: 'admin' },
  { id: 'a1321', name: '行政 13:00–21:00', start: '13:00', end: '21:00', break_min: 0, group: 'admin' },
  { id: 'a1322', name: '行政 13:00–22:00', start: '13:00', end: '22:00', break_min: 60, group: 'admin' },
  { id: 'g_day', name: '保全日班 07:00–19:00', start: '07:00', end: '19:00', break_min: 0, group: 'guard' },
  { id: 'g_night', name: '保全夜班 19:00–07:00', start: '19:00', end: '07:00', break_min: 0, group: 'guard' },
  { id: 't1', name: '三班制 07:00–15:00', start: '07:00', end: '15:00', break_min: 0, group: 'guard' },
  { id: 't2', name: '三班制 15:00–23:00', start: '15:00', end: '23:00', break_min: 0, group: 'guard' },
  { id: 't3', name: '三班制 23:00–07:00', start: '23:00', end: '07:00', break_min: 0, group: 'guard' },
];
const DEFAULTS = {
  shifts: DEFAULT_SHIFTS,
  normal_hours: 8,                 // 每日正常工時上限；超過的排定時數列為「排定加班」（例：保全 12 小時班＝8＋4）
  admin_shift: 'a0918', guard_day_shift: 'g_day', guard_night_shift: 'g_night',
  person_shift: {},                // { staff_id: shift_id } 個人固定班別
  remind_min: 30,                  // 下班後超過幾分鐘列入「待核定」
  unit_min: 30,                    // 加班計算單位（分鐘），不足一單位不計
  comp_expiry: 'year_end',         // 補休期限：year_end 當年度底、6m 六個月、1y 一年
  late_mode: 'none',               // 遲到早退：none 不扣薪也不影響全勤、attendance 只影響全勤獎金、prorate 依分鐘比例扣薪
  late_grace_min: 0,               // 寬限分鐘（在寬限內不算遲到早退）
  wage_basis_admin: 'month30',     // 行政職日薪：month30 月薪÷30、workdays 月薪÷當月應出勤日
  wage_basis_guard: 'scheduled',   // 保全日薪：scheduled 月薪÷當月排班天數、month30 月薪÷30
};
const hm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const pad = n => String(n).padStart(2, '0');
const r2 = n => Math.round(n * 100) / 100;

module.exports = function registerWorkHours(app, d) {
  const { db, getUser, tenantId, now, requireCompanyAdmin, requireCompanyPermission, requireStaff, getOrg, getLeave, redDates, scopeOf, hasPermission } = d;
  db.exec(`
  CREATE TABLE IF NOT EXISTS work_time_settings (tenant_id INTEGER PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT, updated_by TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS attendance_ot_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, work_date TEXT NOT NULL, kind TEXT NOT NULL,
    status TEXT NOT NULL, hours REAL NOT NULL DEFAULT 0, ot_type TEXT DEFAULT '', comp_choice TEXT DEFAULT '', reason TEXT DEFAULT '', overtime_id INTEGER, community_id INTEGER,
    decided_by TEXT DEFAULT '', decided_at TEXT NOT NULL, UNIQUE(tenant_id,staff_id,work_date,kind));
  CREATE TABLE IF NOT EXISTS attendance_resolutions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, work_date TEXT NOT NULL, issue TEXT NOT NULL, action TEXT NOT NULL, reason TEXT DEFAULT '', decided_by TEXT DEFAULT '', decided_at TEXT NOT NULL, UNIQUE(tenant_id,staff_id,work_date));
  CREATE TABLE IF NOT EXISTS comp_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, credit_id INTEGER, hours REAL NOT NULL, overtime_id INTEGER, note TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT NOT NULL);
  `);
  { const cols = db.prepare('PRAGMA table_info(attendance_records)').all().map(c => c.name); if (cols.length && !cols.includes('chain_hash')) db.exec("ALTER TABLE attendance_records ADD COLUMN chain_hash TEXT DEFAULT ''"); }
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { console.error('[work-hours]', e); if (!res.headersSent) bad(res, e.status ? e.message : '處理失敗', e.status || 500); }); } catch (e) { if (!e.status) console.error('[work-hours]', e); if (!res.headersSent) bad(res, e.status ? e.message : '處理失敗', e.status || 500); } };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const by = u => u?.name || u?.employee_id || '';
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const daysOf = m => { const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${pad(i + 1)}`); };
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  // 台灣時間 → UTC 毫秒
  const twMs = (date, min) => Date.parse(`${date}T00:00:00Z`) - 8 * 3600e3 + min * 60e3;
  const twLocal = ms => { const x = new Date(ms + 8 * 3600e3); return { date: x.toISOString().slice(0, 10), time: x.toISOString().slice(11, 16) }; };
  const isoMs = s => Date.parse(String(s || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || '')) ? '' : 'Z'));

  // ---------- 設定 ----------
  function settings(tid) {
    const r = db.prepare('SELECT config_json,updated_at,updated_by FROM work_time_settings WHERE tenant_id=?').get(tid); const c = parse(r?.config_json, {}) || {};
    const shifts = Array.isArray(c.shifts) && c.shifts.length ? c.shifts : DEFAULTS.shifts;
    return { ...DEFAULTS, ...c, shifts, person_shift: c.person_shift || {}, updated_at: r?.updated_at || '', updated_by: r?.updated_by || '' };
  }
  function cleanSettings(b, cur) {
    const ids = new Set(); const shifts = (Array.isArray(b.shifts) ? b.shifts : cur.shifts).slice(0, 40).map((s, i) => {
      const start = hm(s.start), end = hm(s.end); if (start === null || end === null) throw err(`第 ${i + 1} 個班別的時間格式不正確（例如 08:00）`);
      if (start === end) throw err(`第 ${i + 1} 個班別上下班時間不能相同`);
      const span = ((end - start + 1440) % 1440); const br = Math.max(0, Math.min(240, Math.round(Number(s.break_min) || 0)));
      if (br >= span) throw err(`「${s.name || '班別'}」的休息時間比上班時間還長`);
      let id = str(s.id, 20).replace(/[^\w-]/g, '') || `s${Date.now().toString(36)}${i}`; while (ids.has(id)) id += 'x'; ids.add(id);
      return { id, name: str(s.name, 30) || `${s.start}–${s.end}`, start: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`, end: `${pad(Math.floor(end / 60))}:${pad(end % 60)}`, break_min: br, group: s.group === 'guard' ? 'guard' : 'admin' };
    });
    if (!shifts.length) throw err('至少要有一個班別');
    const has = id => shifts.some(s => s.id === id);
    const pick = (k) => { const v = str(b[k] ?? cur[k], 20); if (!has(v)) throw err('預設班別不存在，請重新選擇'); return v; };
    const ps = {}; // 個人時段改在「人員開通管理」設定（個人例外）
    return {
      shifts, admin_shift: pick('admin_shift'), guard_day_shift: pick('guard_day_shift'), guard_night_shift: pick('guard_night_shift'), person_shift: ps,
      normal_hours: Math.max(4, Math.min(12, Number(b.normal_hours ?? cur.normal_hours) || 8)),
      remind_min: Math.max(1, Math.min(240, Math.round(Number(b.remind_min ?? cur.remind_min) || 30))),
      unit_min: [1, 15, 30, 60].includes(Number(b.unit_min ?? cur.unit_min)) ? Number(b.unit_min ?? cur.unit_min) : 30,
      comp_expiry: ['year_end', '6m', '1y'].includes(b.comp_expiry ?? cur.comp_expiry) ? (b.comp_expiry ?? cur.comp_expiry) : 'year_end',
      late_mode: ['none', 'attendance', 'prorate', 'both'].includes(b.late_mode ?? cur.late_mode) ? (b.late_mode ?? cur.late_mode) : 'none',
      late_grace_min: Math.max(0, Math.min(60, Math.round(Number(b.late_grace_min ?? cur.late_grace_min) || 0))),
      wage_basis_admin: ['month30', 'workdays'].includes(b.wage_basis_admin ?? cur.wage_basis_admin) ? (b.wage_basis_admin ?? cur.wage_basis_admin) : 'month30',
      wage_basis_guard: ['scheduled', 'month30'].includes(b.wage_basis_guard ?? cur.wage_basis_guard) ? (b.wage_basis_guard ?? cur.wage_basis_guard) : 'scheduled',
    };
  }

  // ---------- 打卡紀錄防竄改：每筆紀錄以 HMAC 串成鏈；改動或刪除任何一筆都驗證得出來 ----------
  const chainKey = (() => { const m = process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'hesi-attendance'; return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(m), Buffer.from('hesi-attendance-chain'), Buffer.from('v1'), 32)); })();
  const canon = r => [r.id, r.staff_id, r.community_id, r.location_id ?? '', r.record_type, r.recorded_at, r.received_at, r.source, r.client_record_id, r.metadata_json || '{}', r.qr_token || '', r.lat ?? '', r.lng ?? ''].join('|');
  const chainOf = (prev, r) => crypto.createHmac('sha256', chainKey).update(`${prev || ''}#${canon(r)}`).digest('hex').slice(0, 32);
  function seal() {
    try {
      const rows = db.prepare("SELECT * FROM attendance_records WHERE COALESCE(chain_hash,'')='' ORDER BY id LIMIT 5000").all(); if (!rows.length) return 0;
      const last = new Map(); const upd = db.prepare('UPDATE attendance_records SET chain_hash=? WHERE id=?');
      const t = db.transaction(() => { for (const r of rows) { let prev = last.get(r.tenant_id); if (prev === undefined) prev = db.prepare("SELECT chain_hash FROM attendance_records WHERE tenant_id=? AND id<? ORDER BY id DESC LIMIT 1").get(r.tenant_id, r.id)?.chain_hash || ''; const h = chainOf(prev, r); upd.run(h, r.id); last.set(r.tenant_id, h); } });
      t(); return rows.length;
    } catch (e) { console.error('[打卡鏈]', e.message); return 0; }
  }
  setTimeout(() => { let n; do { n = seal(); } while (n === 5000); }, 3000).unref?.();
  setInterval(seal, 20e3).unref?.();
  // 驗證一批紀錄：回傳 Map(id → 'ok' | 'changed' | 'gap' | 'unsealed')
  function verify(tid, ids) {
    const out = new Map(); if (!ids.length) return out;
    for (const id of ids) {
      const r = db.prepare('SELECT * FROM attendance_records WHERE id=? AND tenant_id=?').get(id, tid); if (!r) continue;
      if (!r.chain_hash) { out.set(id, 'unsealed'); continue; }
      const prev = db.prepare("SELECT chain_hash FROM attendance_records WHERE tenant_id=? AND id<? ORDER BY id DESC LIMIT 1").get(tid, id)?.chain_hash || '';
      out.set(id, chainOf(prev, r) === r.chain_hash ? 'ok' : 'changed');
    }
    return out;
  }

  // ---------- 人員分組與班別 ----------
  function groupOf(m) {
    if (!m) return 'admin';
    const sched = m.position?.schedule || m.schedule || '';
    if (sched === 'security' || (m.dept === 'duty' && ['site_staff', 'mobile'].includes(m.kind))) return 'guard';
    return 'admin';
  }
  const shiftById = (cfg, id) => cfg.shifts.find(s => s.id === id) || null;
  // ---------- 某人某天的上下班時段 ----------
  // 順序：① 個人例外（公司內勤、督導、主管或特殊情況）② 當天所在社區的合約「派駐配置」時段（依職位）③ 公司預設班別
  db.exec(`CREATE TABLE IF NOT EXISTS staff_shift_exceptions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, break_min INTEGER NOT NULL DEFAULT 0,
    from_date TEXT NOT NULL, to_date TEXT DEFAULT '', reason TEXT NOT NULL DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT NOT NULL, removed_at TEXT DEFAULT '', removed_by TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS idx_shift_exc ON staff_shift_exceptions(tenant_id,staff_id);`);
  // 舊版「工時設定 → 個人固定班別」轉成個人例外（只做一次）
  try { for (const r of db.prepare('SELECT tenant_id,config_json FROM work_time_settings').all()) { const c = parse(r.config_json, {}); const ps = c.person_shift || {}; if (!Object.keys(ps).length) continue; const shifts = Array.isArray(c.shifts) && c.shifts.length ? c.shifts : DEFAULTS.shifts;
    for (const [sid, id] of Object.entries(ps)) { const sh = shifts.find(x => x.id === id); if (sh) db.prepare('INSERT INTO staff_shift_exceptions (tenant_id,staff_id,start,end,break_min,from_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(r.tenant_id, Number(sid), sh.start, sh.end, sh.break_min || 0, '2000-01-01', '由「工時設定 → 個人固定班別」轉入', '系統', now()); }
    c.person_shift = {}; db.prepare('UPDATE work_time_settings SET config_json=? WHERE tenant_id=?').run(JSON.stringify(c), r.tenant_id); } } catch (e) { console.error('[個人班別轉換]', e.message); }
  function shiftContext(tid) {
    const exc = new Map(); for (const x of db.prepare("SELECT * FROM staff_shift_exceptions WHERE tenant_id=? AND COALESCE(removed_at,'')='' ORDER BY from_date").all(tid)) { if (!exc.has(x.staff_id)) exc.set(x.staff_id, []); exc.get(x.staff_id).push(x); }
    const con = new Map(); try { for (const c of db.prepare("SELECT community_id,staffing_json,start_date,end_date FROM community_contracts WHERE tenant_id=? AND status NOT IN ('terminated','draft')").all(tid)) for (const r of parse(c.staffing_json, [])) if (Array.isArray(r.times) && r.times.length) { if (!con.has(c.community_id)) con.set(c.community_id, []); con.get(c.community_id).push({ ...r, c_start: c.start_date, c_end: c.end_date }); } } catch {}
    return { exc, con };
  }
  const asShift = (t, name, source, group) => ({ id: `${source}:${t.start}-${t.end}`, name, start: t.start, end: t.end, break_min: Number(t.break_min) || 0, group, source });
  function shiftFor(cfg, sid, m, code, date = todayTW(), cid = 0, ctx = null) {
    const g = groupOf(m);
    const ex = ctx?.exc.get(sid)?.filter(x => x.from_date <= date && (!x.to_date || x.to_date >= date)).pop();
    if (ex) return asShift(ex, `個人時段 ${ex.start}–${ex.end}`, 'person', g);
    const site = cid || Number((m?.sites || [])[0]) || 0;
    if (site && ctx) {
      const rows = (ctx.con.get(site) || []).filter(r => (!r.c_start || r.c_start <= date) && (!r.c_end || r.c_end >= date));
      let hit = rows.filter(r => r.position_id && r.position_id === m?.position?.id);
      if (hit.length > 1 && (code === 'day' || code === 'night')) { const by = hit.filter(r => r.shift === code); if (by.length) hit = by; }
      if (!hit.length && (code === 'day' || code === 'night')) hit = rows.filter(r => r.shift === code);
      const t = hit[0]?.times.filter(x => x.from <= date).pop();
      if (t) return asShift(t, `${hit[0].position_name || '合約'} ${t.start}–${t.end}`, 'contract', g);
    }
    if (code === 'night') return shiftById(cfg, cfg.guard_night_shift);
    if (code === 'day') return shiftById(cfg, cfg.guard_day_shift);
    if (g === 'guard') return shiftById(cfg, m?.shift === 'night' ? cfg.guard_night_shift : cfg.guard_day_shift);
    return shiftById(cfg, cfg.admin_shift);
  }


  // ---------- 每日計算 ----------
  function compute(tid, month, { communityId = 0, group = '', staffId = 0, scope = null } = {}) {
    const cfg = settings(tid); const days = daysOf(month); const y = Number(month.slice(0, 4));
    const red = new Set([...(redDates(y) || []), ...(month.endsWith('12') ? redDates(y + 1) || [] : [])]);
    const org = getOrg(); const ocfg = org.configFor(tid);
    const people = org.people(tid, ocfg).filter(x => x.u.role !== 'company_admin' || x.m);
    const comms = new Map(db.prepare('SELECT id,name FROM communities WHERE tenant_id=?').all(tid).map(c => [c.id, c.name]));
    const locs = new Map(db.prepare('SELECT id,name FROM attendance_locations WHERE tenant_id=?').all(tid).map(l => [l.id, l.name]));
    const from = twMs(days[0], -24 * 60), to = twMs(days[days.length - 1], 48 * 60);
    const recs = db.prepare(`SELECT * FROM attendance_records WHERE tenant_id=? AND record_type IN ('checkin','checkout') AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at`).all(tid, new Date(from).toISOString(), new Date(to).toISOString());
    const recBy = new Map(); for (const r of recs) { r._ms = isoMs(r.recorded_at); if (!recBy.has(r.staff_id)) recBy.set(r.staff_id, []); recBy.get(r.staff_id).push(r); }
    const entries = db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND work_date BETWEEN ? AND ?').all(tid, addDays(days[0], -1), days[days.length - 1]);
    const entBy = new Map(); for (const e of entries) { const k = `${e.staff_id}|${e.work_date}`; const cur = entBy.get(k); if (!cur || (!['off', 'leave'].includes(e.shift_code) && ['off', 'leave'].includes(cur.shift_code))) entBy.set(k, e); }
    const hasSched = new Set(entries.filter(e => e.work_date.startsWith(month)).map(e => e.staff_id));
    const leaveApi = getLeave(); let types = new Map(); try { types = new Map(leaveApi.typesFor(leaveApi.policyFor(tid)).map(t => [t.key, t.name])); } catch {}
    const leaves = db.prepare("SELECT * FROM leave_requests WHERE tenant_id=? AND status='approved'").all(tid);
    const leaveBy = new Map(); for (const l of leaves) for (const e of parse(l.entries_json, [])) if (String(e.d || '').startsWith(month)) { const k = `${l.staff_id}|${e.d}`; const x = leaveBy.get(k) || { h: 0, names: [] }; x.h += Number(e.h) || 0; const nm = types.get(l.leave_type) || l.type_name || '請假'; if (!x.names.includes(nm)) x.names.push(nm); leaveBy.set(k, x); }
    const reviews = new Map(db.prepare('SELECT * FROM attendance_ot_reviews WHERE tenant_id=? AND work_date BETWEEN ? AND ?').all(tid, days[0], days[days.length - 1]).map(r => [`${r.staff_id}|${r.work_date}|${r.kind}`, r]));
    const unit = cfg.unit_min, remind = cfg.remind_min, NORMAL = cfg.normal_hours * 60;
    const hires = new Map(db.prepare('SELECT staff_id,hire_date FROM hr_profiles WHERE tenant_id=?').all(tid).map(r => [r.staff_id, r.hire_date || '']));
    const sctx = shiftContext(tid);
    // 只有「有在用打卡」的人才會產生出勤異常：近 3 個月打過卡，或駐點社區有設定出勤打卡點（沒在用打卡的公司不會被擋住發薪）
    const recentPunch = new Set(db.prepare("SELECT DISTINCT staff_id FROM attendance_records WHERE tenant_id=? AND record_type IN ('checkin','checkout') AND recorded_at>=?").all(tid, new Date(twMs(days[0], 0) - 62 * 864e5).toISOString()).map(r => r.staff_id));
    const punchSites = new Set(db.prepare("SELECT DISTINCT community_id FROM attendance_locations WHERE tenant_id=? AND location_type='attendance' AND is_active=1").all(tid).map(r => r.community_id));
    // 休假日的種類：週日＝例假日、週六＝休息日、平日的紅字＝國定假日（排班制的人以班表的休假為準，一律視為休息日，除非是國定假日）
    const dayKind = (date, isRed) => { const w = new Date(`${date}T00:00:00Z`).getUTCDay(); if (isRed && w !== 0 && w !== 6) return 'holiday'; if (w === 0) return 'regular'; if (w === 6) return 'rest'; return isRed ? 'holiday' : 'rest'; };
    const KIND_LABEL = { holiday: '國定假日', regular: '例假日', rest: '休息日' };
    const floorUnit = min => Math.floor(min / unit) * unit;
    const out = [];
    for (const { u, m } of people) {
      if (staffId && u.id !== staffId) continue;
      const g = groupOf(m); if (group && g !== group) continue;
      const sites = (m?.sites || []).map(Number);
      if (communityId && !sites.includes(communityId) && !(recBy.get(u.id) || []).some(r => r.community_id === communityId) && !entries.some(e => e.staff_id === u.id && e.community_id === communityId)) continue;
      if (scope && !sites.some(c => scope.has(c)) && !(recBy.get(u.id) || []).some(r => scope.has(r.community_id))) continue;
      const mine = recBy.get(u.id) || []; const used = new Set();
      const startDay = hires.get(u.id) || ''; const acctDay = String(u.created_at || '').slice(0, 10);
      const usesPunch = recentPunch.has(u.id) || (m?.sites || []).some(c => punchSites.has(Number(c)));
      const rows = []; const T = { work_days: 0, normal_min: 0, sched_ot_min: 0, approved_ot_h: 0, pending_ot_min: 0, late_count: 0, late_min: 0, early_count: 0, early_min: 0, missing: 0, absent: 0, leave_h: 0, rest_work_days: 0, fix_count: 0 };
      for (const date of days) {
        const e = entBy.get(`${u.id}|${date}`); const lv = leaveBy.get(`${u.id}|${date}`);
        let plan;
        if (e) plan = ['off', 'leave'].includes(e.shift_code) ? (e.shift_code === 'leave' ? 'leave' : 'rest') : 'work';
        else if (hasSched.has(u.id)) plan = 'rest';
        else plan = g === 'admin' ? (red.has(date) ? 'rest' : 'work') : 'none';
        if (startDay && date < startDay) plan = 'before';
        const isRed = red.has(date);

        const sh = plan === 'work' || plan === 'none' ? shiftFor(cfg, u.id, m, e?.shift_code, date, Number(e?.community_id) || 0, sctx) : null;
        let S = null, E = null, spanMin = 0;
        if (sh) { const st = hm(sh.start), en = hm(sh.end); spanMin = (en - st + 1440) % 1440; S = twMs(date, st); E = S + spanMin * 60e3; }
        // 找這一天的上下班卡
        let ci = null, co = null;
        // 沒有排班的保全：當天有在班別時段打上班卡就當作上班日，否則當作休假（不算未打卡）
        let unscheduled = false;
        if (plan === 'none' && S !== null) { const hit = mine.some(r => !used.has(r.id) && r.record_type === 'checkin' && r._ms >= S - 4 * 3600e3 && r._ms < E - 30 * 60e3); if (hit) { plan = 'work'; unscheduled = true; } else plan = 'rest'; }
        if (plan === 'work' && S !== null) {
          ci = mine.find(r => !used.has(r.id) && r.record_type === 'checkin' && r._ms >= S - 4 * 3600e3 && r._ms < E - 30 * 60e3) || null;
          const base = ci ? ci._ms : S; const nextIn = mine.find(r => r.record_type === 'checkin' && r._ms > base && !used.has(r.id) && r !== ci && r._ms > S + 60 * 60e3)?._ms || Infinity;
          const outs = mine.filter(r => !used.has(r.id) && r.record_type === 'checkout' && r._ms > base && r._ms <= E + 8 * 3600e3 && r._ms < nextIn);
          co = outs.length ? outs[outs.length - 1] : null;
        } else {
          const dayStart = twMs(date, 0), dayEnd = twMs(date, 24 * 60);
          ci = mine.find(r => !used.has(r.id) && r.record_type === 'checkin' && r._ms >= dayStart && r._ms < dayEnd) || null;
          if (ci) { const nextIn = mine.find(r => r.record_type === 'checkin' && r._ms > ci._ms && !used.has(r.id))?._ms || Infinity; const outs = mine.filter(r => !used.has(r.id) && r.record_type === 'checkout' && r._ms > ci._ms && r._ms <= ci._ms + 18 * 3600e3 && r._ms < nextIn); co = outs.length ? outs[outs.length - 1] : null; }
          else co = mine.find(r => !used.has(r.id) && r.record_type === 'checkout' && r._ms >= dayStart + 6 * 3600e3 && r._ms < dayEnd) || null;
        }
        if (ci) used.add(ci.id); if (co) used.add(co.id);
        const punches = [ci, co].filter(Boolean);
        // 計算
        const row = { date, weekday: '日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()], red: isRed, plan, shift: sh && plan === 'work' ? { id: sh.id, name: sh.name, start: sh.start, end: sh.end, break_min: sh.break_min } : null,
          community: comms.get(ci?.community_id || co?.community_id || e?.community_id) || '', in: ci ? punchOut(ci, locs) : null, out: co ? punchOut(co, locs) : null,
          leave: lv ? { hours: r2(lv.h), names: lv.names } : null, normal_min: 0, sched_ot_min: 0, late_min: 0, early_min: 0, over_min: 0, rest_work_min: 0, status: [], ot: null };
        if (lv) { T.leave_h += lv.h; }
        const fullLeave = lv && lv.h >= cfg.normal_hours - 0.01;
        if (plan === 'work' && sh) {
          const netSched = spanMin - sh.break_min; const normalCap = Math.min(NORMAL, netSched); const schedOt = Math.max(0, netSched - normalCap);
          if (ci && co) {
            const a = Math.max(ci._ms, S), b = Math.min(co._ms, E); let inShift = Math.max(0, (b - a) / 60e3); if (inShift > 5 * 60) inShift -= Math.min(sh.break_min, Math.max(0, inShift - 5 * 60));
            row.normal_min = Math.round(Math.min(normalCap, inShift)); row.sched_ot_min = Math.round(Math.max(0, Math.min(schedOt, inShift - normalCap)));
            row.late_min = Math.max(0, Math.round((ci._ms - S) / 60e3)); row.early_min = Math.max(0, Math.round((E - co._ms) / 60e3));
            row.over_min = Math.max(0, Math.round((co._ms - E) / 60e3));
            T.work_days++;
            if (row.late_min > 0 && !lv) { row.status.push(`遲到 ${row.late_min} 分`); T.late_count++; T.late_min += row.late_min; }
            if (row.early_min > 0 && !lv) { row.status.push(`早退 ${row.early_min} 分`); T.early_count++; T.early_min += row.early_min; }
            if (row.over_min >= remind) row.ot = otState(reviews.get(`${u.id}|${date}|after`), 'after', floorUnit(row.over_min), co, sh);
          } else if (ci || co) { row.status.push(ci ? '缺下班卡' : '缺上班卡'); T.missing++; if (date <= todayTW() && usesPunch) row.issue = 'missing'; }
          else if (fullLeave) row.status.push('請假');
          else if (acctDay && date < acctDay) row.status.push('帳號尚未建立');
          else if (date <= todayTW()) { row.status.push(lv ? '部分請假・未打卡' : '未打卡'); if (!lv) T.absent++; if (usesPunch) row.issue = 'absent'; }
          if (unscheduled) row.status.push('未排班');
        } else {
          // 休假日（含國定假日）有打卡：列為休假日出勤，待主管核定
          const dk = hasSched.has(u.id) || g === 'guard' ? (isRed && ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 'holiday' : 'rest') : dayKind(date, isRed);
          if (plan === 'before') row.status.push('尚未到職');
          else if (ci && co) { let w = Math.round((co._ms - ci._ms) / 60e3); if (w > 5 * 60) w -= 60; row.rest_work_min = Math.max(0, w); T.rest_work_days++; row.status.push(`${KIND_LABEL[dk]}出勤`); row.ot = otState(reviews.get(`${u.id}|${date}|rest`), 'rest', floorUnit(row.rest_work_min), co, null, dk !== 'rest'); }
          else if (ci || co) { row.status.push(`${KIND_LABEL[dk]}打卡（${ci ? '缺下班卡' : '缺上班卡'}）`); T.missing++; }
          else row.status.push(plan === 'leave' ? '請假' : `休（${KIND_LABEL[dk]}）`);
        }
        if (row.ot) { if (row.ot.status === 'approved') T.approved_ot_h += row.ot.hours; else if (row.ot.status === 'pending') T.pending_ot_min += row.ot.minutes; }
        T.normal_min += row.normal_min; T.sched_ot_min += row.sched_ot_min; T.fix_count += punches.filter(p => p.source === 'fix').length;
        if (!row.status.length && plan === 'work') row.status.push('正常');
        rows.push(row);
      }
      // 沒有被配對到的打卡（例如重複打卡）也列出，避免遺漏
      const extra = mine.filter(r => !used.has(r.id) && twLocal(r._ms).date.startsWith(month)).map(r => ({ date: twLocal(r._ms).date, ...punchOut(r, locs) }));
      out.push({ staff_id: u.id, employee_id: u.employee_id, name: u.name, position: m?.position?.name || '', group: g, scheduled: hasSched.has(u.id), group_name: g === 'guard' ? '保全' : '行政',
        communities: [...new Set((m?.sites || []).map(c => comms.get(Number(c))).filter(Boolean))], default_shift: shiftFor(cfg, u.id, m, '', todayTW() < days[days.length - 1] ? todayTW() : days[days.length - 1], 0, sctx)?.name || '',
        totals: { ...T, normal_h: r2(T.normal_min / 60), sched_ot_h: r2(T.sched_ot_min / 60), approved_ot_h: r2(T.approved_ot_h), pending_ot_h: r2(T.pending_ot_min / 60), leave_h: r2(T.leave_h) }, days: rows, extra_punches: extra });
    }
    return { cfg, people: out };
    function otState(rv, kind, minutes, co, sh, isRed) {
      const base = { kind, minutes, hours: r2(minutes / 60), suggested_type: kind === 'rest' ? (isRed ? 'holiday' : 'rest_day') : '', end: co ? twLocal(co._ms).time : '', shift_end: sh?.end || '' };
      if (!rv) return minutes > 0 ? { ...base, status: 'pending' } : null;
      return { ...base, status: rv.status, hours: rv.status === 'approved' ? Number(rv.hours) : 0, reason: rv.reason, comp_choice: rv.comp_choice, ot_type: rv.ot_type, decided_by: rv.decided_by, decided_at: rv.decided_at, review_id: rv.id };
    }
  }
  function punchOut(r, locs) {
    const meta = parse(r.metadata_json, {}); const L = twLocal(r._ms ?? isoMs(r.recorded_at)); const R = twLocal(isoMs(r.received_at));
    return { id: r.id, type: r.record_type, date: L.date, time: L.time, source: r.source, location: locs.get(r.location_id) || (r.source === 'fix' ? '補打卡' : ''), received: `${R.date} ${R.time}`,
      delayed_min: Math.max(0, Math.round((isoMs(r.received_at) - isoMs(r.recorded_at)) / 60e3)), fix: r.source === 'fix' ? { reason: meta.reason || '', approved_by: meta.approved_by || '', approved_at: `${R.date} ${R.time}` } : null, sealed: !!r.chain_hash };
  }

  // ---------- 權限與範圍 ----------
  const canView = u => !!u && (u.role === 'company_admin' || hasPermission(u, 'attendance') || hasPermission(u, 'attendance-records'));
  const canSettings = u => { if (!u) return false; if (u.role === 'company_admin') return true; try { const m = getOrg().memberInfo(u); return ['owner', 'gm', 'dept_head'].includes(m?.kind); } catch { return false; } };
  const C = '/api/company/work-hours';
  const filters = (req) => { const q = req.query || {}; const month = isMonth(q.month) ? q.month : todayTW().slice(0, 7); return { month, communityId: Number(q.community_id) || 0, group: ['admin', 'guard'].includes(q.group) ? q.group : '', staffId: Number(q.staff_id) || 0, scope: scopeOf(getUser(req)) }; };

  app.get(`${C}/settings`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req);
    const people = getOrg().people(tid).map(({ u: p, m }) => ({ id: p.id, employee_id: p.employee_id, name: p.name, position: m?.position?.name || '', group: groupOf(m) }));
    res.json({ settings: settings(tid), people, can_edit: canSettings(u) });
  }));
  app.put(`${C}/settings`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canSettings(u)) throw err('只有公司負責人、總經理或部門主管可以修改工時設定', 403);
    const tid = tenantId(req); const cfg = cleanSettings(req.body || {}, settings(tid));
    db.prepare('INSERT INTO work_time_settings (tenant_id,config_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(cfg), now(), by(u));
    res.json({ success: true, settings: settings(tid) });
  }));
  app.get(`${C}/report`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const f = filters(req);
    seal(); const r = compute(tid, f.month, f);
    const ids = r.people.flatMap(p => p.days.flatMap(x => [x.in?.id, x.out?.id]).concat(p.extra_punches.map(x => x.id))).filter(Boolean);
    const v = verify(tid, ids); let changed = 0; for (const p of r.people) { for (const x of p.days) for (const k of ['in', 'out']) if (x[k]) { x[k].integrity = v.get(x[k].id) || 'unsealed'; if (x[k].integrity === 'changed') changed++; } for (const x of p.extra_punches) { x.integrity = v.get(x.id) || 'unsealed'; if (x.integrity === 'changed') changed++; } }
    const comms = db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid).filter(c => !f.scope || f.scope.has(c.id));
    let mode = 'pay'; try { mode = getLeave().policyFor(tid).overtime_mode || 'pay'; } catch {}
    res.set('Cache-Control', 'no-store');
    res.json({ month: f.month, people: r.people, communities: comms, settings: { normal_hours: r.cfg.normal_hours, remind_min: r.cfg.remind_min, unit_min: r.cfg.unit_min }, integrity: { checked: v.size, changed }, overtime_mode: mode, can_review: canView(u), today: todayTW() });
  }));

  // ---------- 匯出 Excel ----------
  const fmtH = min => min ? r2(min / 60) : '';
  const punchTxt = p => p ? `${p.time}${p.source === 'fix' ? '（補打卡）' : p.source === 'offline' ? '（離線補傳）' : ''}` : '';
  app.get(`${C}/export`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const f = filters(req);
    seal(); const r = compute(tid, f.month, f);
    const ids = r.people.flatMap(p => p.days.flatMap(x => [x.in?.id, x.out?.id])).filter(Boolean); const v = verify(tid, ids);
    const tName = db.prepare('SELECT name FROM tenants WHERE id=?').get(tid)?.name || '';
    const sum = [['員編', '姓名', '職務', '類別', '駐點社區', '出勤天數', '正常工時（時）', '排定加班（時）', '已核定加班（時）', '待核定加班（時）', '休假日出勤（天）', '請假（時）', '遲到（次）', '遲到（分）', '早退（次）', '缺卡（次）', '未打卡（天）', '補打卡（筆）']];
    for (const p of r.people) { const t = p.totals; sum.push([p.employee_id, p.name, p.position, p.group_name, p.communities.join('、'), t.work_days, t.normal_h, t.sched_ot_h, t.approved_ot_h, t.pending_ot_h, t.rest_work_days, t.leave_h, t.late_count, t.late_min, t.early_count, t.missing, t.absent, t.fix_count]); }
    const det = [['員編', '姓名', '日期', '星期', '班別', '社區', '上班打卡', '上班打卡點', '下班打卡', '下班打卡點', '正常工時', '排定加班', '超時／休假日出勤（時）', '加班核定', '請假', '狀態', '補打卡原因／核准人', '紀錄驗證']];
    for (const p of r.people) for (const x of p.days) {
      const fx = [x.in, x.out].filter(y => y?.fix).map(y => `${y.type === 'checkin' ? '上班' : '下班'}：${y.fix.reason}（${y.fix.approved_by} 核准）`).join('；');
      const integ = [x.in, x.out].filter(Boolean).map(y => v.get(y.id)).some(s => s === 'changed') ? '⚠ 紀錄被改動' : [x.in, x.out].some(Boolean) ? '✓' : '';
      const ot = x.ot ? (x.ot.status === 'approved' ? `已核定 ${x.ot.hours} 時（${x.ot.decided_by}）` : x.ot.status === 'dismissed' ? `不列加班：${x.ot.reason}` : '待核定') : '';
      det.push([p.employee_id, p.name, x.date, x.weekday, x.shift?.name || (x.plan === 'rest' ? '休' : ''), x.community, punchTxt(x.in), x.in?.location || '', punchTxt(x.out), x.out?.location || '', fmtH(x.normal_min), fmtH(x.sched_ot_min), x.ot ? r2(x.ot.minutes / 60) : '', ot, x.leave ? `${x.leave.names.join('、')} ${x.leave.hours} 時` : '', x.status.join('、'), fx, integ]);
    }
    const raw = [['員編', '姓名', '類型', '打卡時間', '系統收到時間', '方式', '打卡點／社區', '補打卡原因', '核准人', '紀錄驗證']];
    const recs = db.prepare(`SELECT * FROM attendance_records WHERE tenant_id=? AND record_type IN ('checkin','checkout') AND recorded_at>=? AND recorded_at<? ORDER BY staff_id,recorded_at`).all(tid, new Date(twMs(`${f.month}-01`, 0)).toISOString(), new Date(twMs(addDays(daysOf(f.month).slice(-1)[0], 1), 0)).toISOString());
    const allow = new Set(r.people.map(p => p.staff_id)); const nameOf = new Map(r.people.map(p => [p.staff_id, p])); const locs = new Map(db.prepare('SELECT id,name FROM attendance_locations WHERE tenant_id=?').all(tid).map(l => [l.id, l.name])); const comms = new Map(db.prepare('SELECT id,name FROM communities WHERE tenant_id=?').all(tid).map(c => [c.id, c.name]));
    const rv = verify(tid, recs.filter(x => allow.has(x.staff_id)).map(x => x.id));
    for (const x of recs) { if (!allow.has(x.staff_id)) continue; const p = nameOf.get(x.staff_id); const o = punchOut(x, locs); raw.push([p.employee_id, p.name, x.record_type === 'checkin' ? '上班' : '下班', `${o.date} ${o.time}`, o.received, x.source === 'fix' ? '補打卡' : x.source === 'offline' ? '離線補傳' : '即時打卡', `${o.location || ''}${comms.get(x.community_id) ? `／${comms.get(x.community_id)}` : ''}`, o.fix?.reason || '', o.fix?.approved_by || '', rv.get(x.id) === 'changed' ? '⚠ 紀錄被改動' : rv.get(x.id) === 'ok' ? '✓' : '尚未封存']); }
    const info = [[`${tName} 出勤工時報表 ${f.month}`], [''], [`正常工時上限每日 ${r.cfg.normal_hours} 小時；超過排定時數的部分為「排定加班」（例如保全 12 小時班＝正常 8 小時＋排定加班 4 小時）。`], [`下班後超過 ${r.cfg.remind_min} 分鐘、或休假日出勤，列為待核定，由主管核定後才計入加班（以 ${r.cfg.unit_min} 分鐘為單位）。`], ['「補打卡」為事後申請並經核准新增的紀錄；「離線補傳」為打卡當下沒有網路、之後自動上傳的紀錄。'], ['「紀錄驗證」：每筆打卡紀錄都以加密方式串連封存，若事後被改動會顯示「⚠ 紀錄被改動」。'], [''], [`匯出時間：${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}　匯出人：${by(u)}`]];
    const buf = buildXlsx([
      { name: '彙總', header: true, freeze: 1, rows: sum, widths: [10, 10, 12, 6, 18, 8, 10, 10, 10, 10, 10, 8, 8, 8, 8, 8, 8, 8] },
      { name: '每日明細', header: true, freeze: 1, rows: det, widths: [10, 10, 11, 5, 18, 14, 14, 12, 14, 12, 8, 8, 10, 22, 14, 16, 30, 10] },
      { name: '打卡原始紀錄', header: true, freeze: 1, rows: raw, widths: [10, 10, 6, 17, 17, 10, 22, 24, 10, 12] },
      { name: '說明', rows: info, widths: [110], rowStyles: { 0: 4 } },
    ]);
    try { db.prepare('INSERT INTO data_access_logs (tenant_id,staff_id,employee_id,name,category,what,path,ip,at) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, u.id, u.employee_id, u.name, '出勤紀錄', `下載出勤工時報表 ${f.month}`, req.path, String(req.ip || ''), now()); } catch {}
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${f.month}.xlsx"; filename*=UTF-8''${encodeURIComponent(`出勤工時報表_${f.month}.xlsx`)}`);
    res.setHeader('Cache-Control', 'no-store'); res.end(buf);
  }));

  // ---------- 核定加班 ----------
  const payrollLocked = (tid, date) => { try { return db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status IN ('published','closed','locked')").get(tid, date.slice(0, 7)); } catch { return null; } };
  app.post(`${C}/ot-review`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const b = req.body || {};
    const sid = Number(b.staff_id), date = str(b.date, 10), kind = b.kind === 'rest' ? 'rest' : 'after';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw err('日期不正確');
    const staff = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid); if (!staff) throw err('找不到人員', 404);
    if (payrollLocked(tid, date)) throw err('這個月份的薪資已經發布，不能再變更加班核定');
    const scope = scopeOf(u); const r = compute(tid, date.slice(0, 7), { staffId: sid, scope });
    const day = r.people[0]?.days.find(x => x.date === date); if (!day || !day.ot || day.ot.kind !== kind) throw err('這一天沒有需要核定的超時紀錄');
    if (day.ot.status !== 'pending') throw err('這筆已經處理過了，如要修改請先「撤回」');
    const action = b.action === 'dismiss' ? 'dismiss' : 'approve';
    const t = now(); const cid = db.prepare("SELECT community_id FROM attendance_records WHERE id=?").get(day.out?.id || day.in?.id)?.community_id || null;
    if (action === 'dismiss') {
      const reason = str(b.reason, 200); if (!reason) throw err('請填寫不列加班的原因（例如：個人逗留、私事）');
      db.prepare('INSERT INTO attendance_ot_reviews (tenant_id,staff_id,work_date,kind,status,hours,reason,community_id,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(tid, sid, date, kind, 'dismissed', 0, reason, cid, by(u), t);
      return res.json({ success: true });
    }
    const max = day.ot.minutes / 60; let hours = Number(b.hours); if (!Number.isFinite(hours) || hours <= 0) hours = max;
    const unitH = r.cfg.unit_min / 60; hours = Math.floor(hours / unitH + 1e-9) * unitH; if (hours <= 0) throw err(`加班時數至少 ${r.cfg.unit_min} 分鐘`); if (hours > max + 1e-9) throw err(`核定時數不能超過實際超時 ${r2(max)} 小時`);
    const ot_type = kind === 'rest' ? (['rest_day', 'holiday'].includes(b.ot_type) ? b.ot_type : day.ot.suggested_type) : '';
    const comp_choice = ['comp', 'pay'].includes(b.comp_choice) ? b.comp_choice : '';
    const reason = str(b.reason, 200) || (kind === 'rest' ? '休假日出勤（依打卡紀錄核定）' : `下班後超時（班別 ${day.shift?.end || ''} 下班，打卡 ${day.ot.end}）`);
    const tx = db.transaction(() => {
      const info = db.prepare("INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at,ot_type,start_time,end_time,comp_choice,source,needs_approval) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(tid, sid, cid, date, r2(hours), 'attendance', '', reason, 'approved', u.id, t, t, ot_type, kind === 'after' ? (day.shift?.end || '') : (day.in?.time || ''), day.out?.time || '', comp_choice, 'attendance', 0);
      db.prepare('INSERT INTO attendance_ot_reviews (tenant_id,staff_id,work_date,kind,status,hours,ot_type,comp_choice,reason,overtime_id,community_id,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tid, sid, date, kind, 'approved', r2(hours), ot_type, comp_choice, reason, Number(info.lastInsertRowid), cid, by(u), t);
    });
    tx(); res.json({ success: true });
  }));
  app.post(`${C}/ot-review/:id/undo`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req);
    const rv = db.prepare('SELECT * FROM attendance_ot_reviews WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!rv) throw err('找不到紀錄', 404);
    if (payrollLocked(tid, rv.work_date)) throw err('這個月份的薪資已經發布，不能撤回');
    db.transaction(() => { if (rv.overtime_id) db.prepare('DELETE FROM schedule_overtime WHERE id=? AND tenant_id=?').run(rv.overtime_id, tid); db.prepare('DELETE FROM attendance_ot_reviews WHERE id=?').run(rv.id); })();
    res.json({ success: true });
  }));

  // ---------- 補休：可用時數、期限、紀錄 ----------
  // 每筆「換補休」的加班各自有期限，請補休時先用最早到期的（先進先出）；到期沒休完的時數列為「應折發加班費」
  function expiryOf(date, mode) { if (mode === '6m') { const x = new Date(`${date}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 6); return x.toISOString().slice(0, 10); } if (mode === '1y') { const x = new Date(`${date}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + 1); return x.toISOString().slice(0, 10); } return `${date.slice(0, 4)}-12-31`; }
  function compLedger(tid, sid, { asOf = todayTW(), excludeLeave = 0 } = {}) {
    const cfg = settings(tid); const L = getLeave(); const p = L.policyFor(tid);
    const credits = L.compCredits(tid, sid).map(o => ({ id: o.id, date: o.work_date, hours: Number(o.hours) || 0, left: Number(o.hours) || 0, expires: expiryOf(o.work_date, cfg.comp_expiry), reason: o.reason || '', source: o.source || '', ot_type: o.ot_type || '' })).sort((a, b) => a.expires.localeCompare(b.expires) || a.date.localeCompare(b.date));
    const uses = L.compUses(tid, sid, excludeLeave).sort((a, b) => a.d.localeCompare(b.d));
    const usage = [];
    for (const e of uses) { let need = e.h; for (const c of credits) { if (need <= 0) break; if (c.left <= 0 || c.date > e.d || c.expires < e.d) continue; const take = Math.min(c.left, need); c.left -= take; need -= take; } usage.push({ ...e, unmatched: r2(need) }); }
    const available = credits.filter(c => c.expires >= asOf).reduce((a, c) => a + c.left, 0);
    const paidBy = new Map(db.prepare('SELECT credit_id,SUM(hours) h FROM comp_payouts WHERE tenant_id=? AND staff_id=? GROUP BY credit_id').all(tid, sid).map(r => [r.credit_id, r.h]));
    for (const c of credits) c.unpaid = c.expires < asOf ? Math.max(0, c.left - (paidBy.get(c.id) || 0)) : 0;
    const expired = credits.reduce((a, c) => a + c.unpaid, 0);
    const paid = [...paidBy.values()].reduce((a, h) => a + h, 0);
    const soon = credits.filter(c => c.left > 0 && c.expires >= asOf && c.expires <= addDays(asOf, 30)).reduce((a, c) => a + c.left, 0);
    return { expiry: cfg.comp_expiry, available: r2(available), expired_unpaid: r2(expired), paid_out: r2(paid), expiring_30d: r2(soon), credits: credits.map(c => ({ ...c, left: r2(c.left), unpaid: r2(c.unpaid) })), uses: usage, hpd: p.hours_per_day };
  }
  // 給請假檢查用：某一天可用的補休時數
  function compAvailableOn(tid, sid, date, excludeLeave = 0) { return compLedger(tid, sid, { asOf: date, excludeLeave }).available; }
  app.get('/api/staff/comp-time', requireStaff, wrap((req, res) => {
    const u = getUser(req); const tid = u.tenant_id; const L = compLedger(tid, u.id);
    const ot = db.prepare("SELECT work_date,hours,reason,ot_type,comp_choice,source,status,start_time,end_time FROM schedule_overtime WHERE tenant_id=? AND staff_id=? AND status<>'rejected' ORDER BY work_date DESC LIMIT 200").all(tid, u.id);
    let p = {}; try { p = getLeave().policyFor(tid); } catch {}
    const choice = o => { try { return getLeave().otChoice(o, p); } catch { return 'pay'; } };
    res.set('Cache-Control', 'no-store');
    res.json({ ...L, overtime: ot.map(o => ({ ...o, as: choice(o) })), overtime_mode: p.overtime_mode || 'pay', expiry_label: { year_end: '當年度 12/31 前', '6m': '加班日起 6 個月內', '1y': '加班日起 1 年內' }[L.expiry] });
  }));
  app.get(`${C}/comp`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const scope = scopeOf(u);
    const rows = getOrg().people(tid).filter(({ m }) => !scope || (m?.sites || []).some(c => scope.has(Number(c)))).map(({ u: p, m }) => { const L = compLedger(tid, p.id); return { staff_id: p.id, employee_id: p.employee_id, name: p.name, position: m?.position?.name || '', available: L.available, expiring_30d: L.expiring_30d, expired_unpaid: L.expired_unpaid, paid_out: L.paid_out, earned: r2(L.credits.reduce((a, c) => a + c.hours, 0)) }; }).filter(r => r.earned || r.paid_out);
    res.json({ rows, expiry: settings(tid).comp_expiry });
  }));
  // 到期未休的補休折發加班費：建立一筆「給加班費」的加班紀錄，併入當月薪資
  app.post(`${C}/comp/:staffId/payout`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const sid = Number(req.params.staffId);
    const L = compLedger(tid, sid); if (L.expired_unpaid <= 0) throw err('沒有到期未休的補休時數');
    const t = now(); const date = todayTW();
    // 依每筆原本加班的種類（平日、休息日、國定假日）分別折發，費率才會正確
    db.transaction(() => { for (const c of L.credits.filter(c => c.unpaid > 0)) {
      const info = db.prepare("INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at,ot_type,comp_choice,source,needs_approval) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(tid, sid, null, date, c.unpaid, 'comp_payout', '', `補休到期未休折發（${c.date} 加班 ${c.hours} 小時，剩 ${c.unpaid} 小時未休）`, 'approved', u.id, t, t, c.ot_type || '', 'pay', 'comp_payout', 0);
      db.prepare('INSERT INTO comp_payouts (tenant_id,staff_id,credit_id,hours,overtime_id,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(tid, sid, c.id, c.unpaid, Number(info.lastInsertRowid), '補休到期折發', by(u), t);
    } })();
    res.json({ success: true, hours: L.expired_unpaid });
  }));

  // ---------- 出勤異常（未打卡、缺卡）：主管處理後才能發布薪資 ----------
  // 處理方式：absent 確認曠職（扣當天日薪、取消全勤）、excused 不扣薪（有上班但忘了打卡、公出等，需填原因）
  // 員工補打卡或補請假核准後，這一天就不再是異常，會自動從清單消失
  // 薪資一次算全公司時會逐人呼叫：整個月的計算結果暫存 3 秒，避免重複讀取
  const memo = new Map();
  function computeAll(tid, month) { const k = `${tid}|${month}`; const m = memo.get(k); if (m && Date.now() - m.at < 3000) return m.r; const r = compute(tid, month); memo.set(k, { at: Date.now(), r }); if (memo.size > 50) memo.delete(memo.keys().next().value); return r; }
  function exceptions(tid, month, opts = {}) {
        const r = opts.useMemo ? computeAll(tid, month) : compute(tid, month, opts);
    const res = new Map(db.prepare('SELECT * FROM attendance_resolutions WHERE tenant_id=? AND work_date BETWEEN ? AND ?').all(tid, `${month}-01`, `${month}-31`).map(x => [`${x.staff_id}|${x.work_date}`, x]));
    const out = [];
    for (const p of r.people) { if (opts.useMemo && opts.staffId && p.staff_id !== opts.staffId) continue; for (const x of p.days) if (x.issue) {
      const rv = res.get(`${p.staff_id}|${x.date}`);
      out.push({ staff_id: p.staff_id, employee_id: p.employee_id, name: p.name, position: p.position, group: p.group, date: x.date, weekday: x.weekday, issue: x.issue, issue_label: x.issue === 'missing' ? (x.in ? '缺下班卡' : '缺上班卡') : '排班日沒有打卡、也沒有請假', shift: x.shift?.name || '', in: x.in, out: x.out, leave: x.leave,
        status: rv ? rv.action : 'pending', reason: rv?.reason || '', decided_by: rv?.decided_by || '', decided_at: rv?.decided_at || '', resolution_id: rv?.id || null });
    } }
    return { cfg: r.cfg, people: opts.useMemo && opts.staffId ? r.people.filter(p => p.staff_id === opts.staffId) : r.people, items: out };
  }
  const payrollPublished = (tid, month) => { try { return !!db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status='published'").get(tid, month); } catch { return false; } };
  app.get(`${C}/exceptions`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const f = filters(req);
    const e = exceptions(tid, f.month, f); res.set('Cache-Control', 'no-store');
    res.json({ month: f.month, items: e.items, pending: e.items.filter(x => x.status === 'pending').length, published: payrollPublished(tid, f.month) });
  }));
  app.post(`${C}/exceptions`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req); const b = req.body || {};
    const sid = Number(b.staff_id), date = str(b.date, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw err('日期不正確');
    if (payrollPublished(tid, date.slice(0, 7))) throw err('這個月份的薪資已經發布，請先撤回發布再處理');
    const e = exceptions(tid, date.slice(0, 7), { staffId: sid, scope: scopeOf(u) }).items.find(x => x.date === date); if (!e) throw err('這一天沒有出勤異常（可能已補打卡或補請假）');
    const action = b.action === 'absent' ? 'absent' : b.action === 'excused' ? 'excused' : ''; if (!action) throw err('請選擇處理方式');
    const reason = str(b.reason, 200); if (action === 'excused' && !reason) throw err('「不扣薪」請填寫原因（例如：有上班但忘了打卡、公出）');
    db.prepare('INSERT INTO attendance_resolutions (tenant_id,staff_id,work_date,issue,action,reason,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,staff_id,work_date) DO UPDATE SET issue=excluded.issue,action=excluded.action,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=excluded.decided_at').run(tid, sid, date, e.issue, action, reason, by(u), now()); memo.clear();
    res.json({ success: true });
  }));
  app.post(`${C}/exceptions/:id/undo`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canView(u)) throw err('沒有權限', 403); const tid = tenantId(req);
    const r = db.prepare('SELECT * FROM attendance_resolutions WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!r) throw err('找不到紀錄', 404);
    if (payrollPublished(tid, r.work_date.slice(0, 7))) throw err('這個月份的薪資已經發布，請先撤回發布');
    db.prepare('DELETE FROM attendance_resolutions WHERE id=?').run(r.id); memo.clear(); res.json({ success: true });
  }));
  // 給薪資計算用：某人某月的曠職、遲到早退、日薪基準
  function payrollIssues(tid, u, month) {
    const e = exceptions(tid, month, { staffId: u.id, useMemo: true }); const p = e.people[0]; if (!p) return null; const cfg = e.cfg;
    const workDays = p.days.filter(x => x.plan === 'work' && x.shift).length;
    // 保全用「當月排班天數」需要有排班表；沒有排班的人改用月薪÷30
    const basis = p.group === 'guard' ? (cfg.wage_basis_guard === 'scheduled' && p.scheduled && workDays ? 'scheduled' : 'month30') : cfg.wage_basis_admin;
    const g = cfg.late_grace_min; let lateCount = 0, lateMin = 0; const lateDates = [];
    for (const x of p.days) { const m = (x.late_min > g ? x.late_min : 0) + (x.early_min > g ? x.early_min : 0); if (m > 0 && !x.leave) { lateCount++; lateMin += m; lateDates.push(x.date.slice(5)); } }
    const shiftMin = (() => { const x = p.days.find(d => d.shift); if (!x) return cfg.normal_hours * 60; const s = x.shift; const [a, b] = [s.start, s.end].map(t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))); return ((b - a + 1440) % 1440) - s.break_min; })();
    return { group: p.group, basis, scheduled_days: workDays, absent: e.items.filter(x => x.staff_id === u.id && x.status === 'absent').map(x => x.date), pending: e.items.filter(x => x.staff_id === u.id && x.status === 'pending').map(x => x.date), late_mode: cfg.late_mode, late_count: lateCount, late_min: lateMin, late_dates: lateDates, day_minutes: shiftMin };
  }
  // 給薪資發布前檢查：這個月還沒處理的出勤異常
  function pendingFor(tid, month) { const e = exceptions(tid, month); const items = e.items.filter(x => x.status === 'pending'); return { count: items.length, people: [...new Set(items.map(x => x.name))] }; }

  // ---------- 個人例外時段（人員開通管理） ----------
  const canStaffEdit = u => !!u && (u.role === 'company_admin' || hasPermission(u, 'manage-staff') || canView(u));
  const hmOk = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  app.get(`${C}/person-shifts/:staffId`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canStaffEdit(u)) throw err('沒有權限', 403); const tid = tenantId(req); const sid = Number(req.params.staffId);
    const p = db.prepare('SELECT id,name,employee_id FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid); if (!p) throw err('找不到人員', 404);
    const rows = db.prepare('SELECT * FROM staff_shift_exceptions WHERE tenant_id=? AND staff_id=? ORDER BY from_date DESC,id DESC').all(tid, sid);
    let m = null; try { m = getOrg().memberInfo(db.prepare('SELECT * FROM staff_users WHERE id=?').get(sid)); } catch {}
    const cur = shiftFor(settings(tid), sid, m, '', todayTW(), 0, shiftContext(tid));
    res.json({ person: p, current: cur ? { name: cur.name, start: cur.start, end: cur.end, break_min: cur.break_min, source: cur.source } : null, rows });
  }));
  app.post(`${C}/person-shifts/:staffId`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canStaffEdit(u)) throw err('沒有權限', 403); const tid = tenantId(req); const sid = Number(req.params.staffId); const b = req.body || {};
    if (!db.prepare('SELECT 1 FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid)) throw err('找不到人員', 404);
    if (!hmOk(b.start) || !hmOk(b.end) || b.start === b.end) throw err('請填寫正確的上下班時間');
    const br = Math.max(0, Math.min(240, Math.round(Number(b.break_min) || 0)));
    const from = isDate(b.from_date) ? b.from_date : todayTW(); const to = isDate(b.to_date) ? b.to_date : ''; if (to && to < from) throw err('結束日不能早於開始日');
    const reason = str(b.reason, 200); if (!reason) throw err('請填寫原因（例如：公司內勤統一時段、督導巡區時段、經公司同意的個人時段）');
    db.prepare('INSERT INTO staff_shift_exceptions (tenant_id,staff_id,start,end,break_min,from_date,to_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(tid, sid, b.start, b.end, br, from, to, reason, by(u), now());
    memo.clear(); res.json({ success: true });
  }));
  app.post(`${C}/person-shifts/:staffId/:id/remove`, requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canStaffEdit(u)) throw err('沒有權限', 403); const tid = tenantId(req);
    const r = db.prepare('SELECT * FROM staff_shift_exceptions WHERE id=? AND tenant_id=? AND staff_id=?').get(Number(req.params.id), tid, Number(req.params.staffId)); if (!r) throw err('找不到紀錄', 404);
    // 已經開始的例外不刪除，改成「到昨天為止」，過去的出勤仍依當時的時段計算
    const y = addDays(todayTW(), -1);
    if (r.from_date <= y) db.prepare("UPDATE staff_shift_exceptions SET to_date=? WHERE id=?").run(r.to_date && r.to_date < y ? r.to_date : y, r.id);
    else db.prepare("UPDATE staff_shift_exceptions SET removed_at=?,removed_by=? WHERE id=?").run(now(), by(u), r.id);
    memo.clear(); res.json({ success: true });
  }));

  // ---------- 上下班時段（現場）與社區經理申請變更 ----------
  db.exec(`CREATE TABLE IF NOT EXISTS shift_change_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, contract_id INTEGER NOT NULL, row_index INTEGER NOT NULL,
    position_id TEXT DEFAULT '', position_name TEXT DEFAULT '', shift TEXT DEFAULT '', old_json TEXT DEFAULT '{}', start TEXT NOT NULL, end TEXT NOT NULL, break_min INTEGER NOT NULL DEFAULT 0, effective_from TEXT NOT NULL,
    basis TEXT NOT NULL DEFAULT '', reason TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', requested_by INTEGER, requester_name TEXT DEFAULT '', created_at TEXT NOT NULL,
    decided_by TEXT DEFAULT '', decided_at TEXT, comment TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS idx_shift_req ON shift_change_requests(tenant_id,status);`);
  const SHIFT_LABEL = { day: '日班', night: '夜班', h24: '24 小時', office: '行政班', '': '' };
  function communityTimes(tid, cid, date = todayTW()) {
    const out = [];
    for (const c of db.prepare("SELECT id,entity_id,staffing_json,start_date,end_date,status FROM community_contracts WHERE tenant_id=? AND community_id=? AND status NOT IN ('terminated','draft')").all(tid, cid)) {
      if (c.end_date && c.end_date < date) continue;
      parse(c.staffing_json, []).forEach((r, i) => { const times = Array.isArray(r.times) ? r.times : []; const cur = times.filter(t => t.from <= date).pop() || null; const next = times.filter(t => t.from > date);
        out.push({ contract_id: c.id, row_index: i, position_id: r.position_id || '', position_name: r.position_name || '', shift: r.shift || '', shift_label: SHIFT_LABEL[r.shift] || '', count: r.count, current: cur, upcoming: next }); });
    }
    return out;
  }
  const memberOf = u => { try { return getOrg().memberInfo(u); } catch { return null; } };
  // 可以申請變更的人：該社區的社區主管／副主管、負責該區域的督導
  function canRequest(u, cid) { const m = memberOf(u); if (!m) return false; if (['site_manager', 'site_deputy'].includes(m.kind)) return (m.sites || []).map(Number).includes(cid); if (m.kind === 'region') { const sc = scopeOf(u); return !sc || sc.has(cid); } return false; }
  app.get('/api/staff/shift-times', requireStaff, wrap((req, res) => {
    const u = getUser(req); const tid = u.tenant_id; const m = memberOf(u);
    let cids = (m?.sites || []).map(Number); if (m?.kind === 'region') { const sc = scopeOf(u); if (sc) cids = [...sc]; }
    const comms = cids.length ? db.prepare(`SELECT id,name FROM communities WHERE tenant_id=? AND id IN (${cids.map(() => '?').join(',')}) ORDER BY name`).all(tid, ...cids) : [];
    const mine = shiftFor(settings(tid), u.id, m, '', todayTW(), 0, shiftContext(tid));
    const reqs = db.prepare('SELECT * FROM shift_change_requests WHERE tenant_id=? AND requested_by=? ORDER BY id DESC LIMIT 50').all(tid, u.id);
    res.set('Cache-Control', 'no-store');
    res.json({ mine: mine ? { name: mine.name, start: mine.start, end: mine.end, break_min: mine.break_min, source: mine.source } : null,
      communities: comms.map(c => ({ ...c, rows: communityTimes(tid, c.id), can_request: canRequest(u, c.id) })), requests: reqs.map(r => ({ ...r, community_name: comms.find(c => c.id === r.community_id)?.name || '', old: parse(r.old_json, {}) })) });
  }));
  app.post('/api/staff/shift-requests', requireStaff, wrap((req, res) => {
    const u = getUser(req); const tid = u.tenant_id; const b = req.body || {}; const cid = Number(b.community_id);
    if (!canRequest(u, cid)) throw err('只有這個社區的社區主管、副主管或區域督導可以申請變更上下班時段', 403);
    const row = communityTimes(tid, cid).find(r => r.contract_id === Number(b.contract_id) && r.row_index === Number(b.row_index)); if (!row) throw err('找不到這個職位的合約時段，請重新整理');
    if (!hmOk(b.start) || !hmOk(b.end) || b.start === b.end) throw err('請填寫正確的上下班時間');
    const br = Math.max(0, Math.min(240, Math.round(Number(b.break_min) || 0)));
    const from = str(b.effective_from, 10); if (!isDate(from) || from < todayTW()) throw err('生效日不能早於今天');
    const basis = str(b.basis, 300); if (!basis) throw err('請填寫社區同意的依據（例如：11/3 管委會會議決議、主委書面同意）');
    if (db.prepare("SELECT 1 FROM shift_change_requests WHERE tenant_id=? AND contract_id=? AND row_index=? AND status='pending'").get(tid, row.contract_id, row.row_index)) throw err('這個職位已經有一筆申請在審核中');
    const info = db.prepare('INSERT INTO shift_change_requests (tenant_id,community_id,contract_id,row_index,position_id,position_name,shift,old_json,start,end,break_min,effective_from,basis,reason,requested_by,requester_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tid, cid, row.contract_id, row.row_index, row.position_id, row.position_name, row.shift, JSON.stringify(row.current || {}), b.start, b.end, br, from, basis, str(b.reason, 300), u.id, u.name, now());
    res.json({ success: true, id: Number(info.lastInsertRowid) });
  }));
  app.post('/api/staff/shift-requests/:id/cancel', requireStaff, wrap((req, res) => {
    const u = getUser(req); const r = db.prepare('SELECT * FROM shift_change_requests WHERE id=? AND tenant_id=? AND requested_by=?').get(Number(req.params.id), u.tenant_id, u.id);
    if (!r) throw err('找不到申請', 404); if (r.status !== 'pending') throw err('只能取消審核中的申請');
    db.prepare("UPDATE shift_change_requests SET status='cancelled',decided_at=? WHERE id=?").run(now(), r.id); res.json({ success: true });
  }));
  // 公司內勤審核：核准後直接寫入社區合約的派駐配置（從生效日起套用），並留下合約異動紀錄
  const canApprove = u => !!u && (u.role === 'company_admin' || hasPermission(u, 'company-general-affairs') || (() => { const m = memberOf(u); return ['owner', 'gm'].includes(m?.kind); })());
  app.get('/api/company/shift-requests', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canApprove(u) && !canView(u)) throw err('沒有權限', 403); const tid = tenantId(req);
    const rows = db.prepare("SELECT r.*,c.name community_name FROM shift_change_requests r LEFT JOIN communities c ON c.id=r.community_id WHERE r.tenant_id=? AND (r.status='pending' OR r.created_at>=?) ORDER BY r.status='pending' DESC, r.id DESC LIMIT 100").all(tid, new Date(Date.now() - 90 * 864e5).toISOString());
    res.set('Cache-Control', 'no-store'); res.json({ rows: rows.map(r => ({ ...r, old: parse(r.old_json, {}) })), pending: rows.filter(r => r.status === 'pending').length, can_approve: canApprove(u) });
  }));
  app.post('/api/company/shift-requests/:id/decide', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canApprove(u)) throw err('只有總務、總經理或公司管理員可以審核', 403); const tid = tenantId(req);
    const r = db.prepare('SELECT * FROM shift_change_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!r) throw err('找不到申請', 404); if (r.status !== 'pending') throw err('這筆申請已經處理過了');
    const ok = req.body?.action === 'approve'; const comment = str(req.body?.comment, 300); if (!ok && !comment) throw err('退回請填寫原因');
    db.transaction(() => {
      if (ok) {
        const c = db.prepare('SELECT * FROM community_contracts WHERE id=? AND tenant_id=?').get(r.contract_id, tid); if (!c) throw err('合約已不存在');
        const st = parse(c.staffing_json, []); let i = r.row_index; if (!st[i] || (r.position_id && st[i].position_id !== r.position_id)) i = st.findIndex(x => x.position_id === r.position_id && (x.shift || '') === (r.shift || '')); if (i < 0) throw err('合約的派駐配置已經變更，找不到這個職位，請退回後重新申請');
        const hist = (Array.isArray(st[i].times) ? st[i].times : []).filter(t => t.from < r.effective_from); hist.push({ from: r.effective_from, start: r.start, end: r.end, break_min: r.break_min }); st[i] = { ...st[i], times: hist };
        db.prepare('UPDATE community_contracts SET staffing_json=?,updated_at=? WHERE id=?').run(JSON.stringify(st), now(), c.id);
        try { db.prepare('INSERT INTO contract_logs (tenant_id,contract_id,action,note,actor,created_at) VALUES (?,?,?,?,?,?)').run(tid, c.id, 'update', `上下班時段：${r.position_name || ''} ${r.start}–${r.end}（${r.effective_from} 起生效，${r.requester_name} 申請，依據：${r.basis}）`, by(u), now()); } catch {}
      }
      db.prepare('UPDATE shift_change_requests SET status=?,decided_by=?,decided_at=?,comment=? WHERE id=?').run(ok ? 'approved' : 'rejected', by(u), now(), comment, r.id);
    })();
    memo.clear(); res.json({ success: true });
  }));

  return { compute, settings, compLedger, compAvailableOn, seal, verify, payrollIssues, pendingFor, shiftFor, shiftContext };
};
