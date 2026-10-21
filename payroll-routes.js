// 人事管理／借資／人員薪資統計表／人員薪資單
// 流程：人事管理建立每位人員的薪資與投保資料 → 會計「產生本月薪資」自動計算（勞健保、勞退、借資扣回）
// → 調整加班、請假等項目 → 「發布」後每位人員收到薪資單（內部訊息通知），可在職員資料查看並確認。
'use strict';
const INS = require('./insurance-tables');

module.exports = function registerPayrollRoutes(app, d) {
  const { db, fs, path, DATA_DIR, XLSX, getUser, tenantId, now, effectivePermissions, requireStaff, requireCompanyAdmin, requireSuperAdmin, getSiteAssignments } = d;
  const tables = INS({ fs, path, DATA_DIR, XLSX });

  db.exec(`
  CREATE TABLE IF NOT EXISTS hr_profiles (
    tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, payroll_enabled INTEGER, hire_date TEXT DEFAULT '', trial_end_date TEXT DEFAULT '',
    base_salary INTEGER DEFAULT 0, allowances_json TEXT DEFAULT '[]', labor_insured INTEGER DEFAULT 1, employment_insured INTEGER DEFAULT 1,
    occupational_insured INTEGER DEFAULT 1, health_insured INTEGER DEFAULT 1, pension_enabled INTEGER DEFAULT 1, auto_grade INTEGER DEFAULT 1,
    labor_grade INTEGER DEFAULT 0, occupational_grade INTEGER DEFAULT 0, health_grade INTEGER DEFAULT 0, pension_grade INTEGER DEFAULT 0,
    health_dependents INTEGER DEFAULT 0, pension_self_rate REAL DEFAULT 0, bank_account TEXT DEFAULT '', note TEXT DEFAULT '',
    updated_at TEXT, updated_by TEXT DEFAULT '', PRIMARY KEY (tenant_id,staff_id)
  );
  CREATE TABLE IF NOT EXISTS payroll_settings (tenant_id INTEGER PRIMARY KEY, occupational_rate REAL, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS payroll_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, month TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    table_year INTEGER, rates_json TEXT DEFAULT '{}', created_at TEXT NOT NULL, created_by TEXT DEFAULT '', updated_at TEXT,
    published_at TEXT, published_by TEXT DEFAULT '', UNIQUE (tenant_id,month)
  );
  CREATE TABLE IF NOT EXISTS payroll_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL,
    employee_id TEXT DEFAULT '', name TEXT DEFAULT '', position TEXT DEFAULT '', data_json TEXT NOT NULL DEFAULT '{}',
    gross INTEGER DEFAULT 0, net INTEGER DEFAULT 0, employer_cost INTEGER DEFAULT 0, viewed_at TEXT, confirmed_at TEXT,
    UNIQUE (run_id,staff_id)
  );
  CREATE INDEX IF NOT EXISTS idx_payroll_items_staff ON payroll_items(tenant_id,staff_id);
  CREATE TABLE IF NOT EXISTS salary_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, advance_date TEXT NOT NULL,
    amount INTEGER NOT NULL, monthly_deduct INTEGER NOT NULL, start_month TEXT NOT NULL, reason TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, created_by TEXT DEFAULT '', updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS advance_repayments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, advance_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, run_id INTEGER, month TEXT NOT NULL,
    amount INTEGER NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  `);

  // 人事基本資料（人事／總務）與薪資設定（會計）分開維護，同一張表不同欄位
  { const cols = db.prepare('PRAGMA table_info(hr_profiles)').all().map(c => c.name);
    for (const [c, def] of [['trial_salary', 'INTEGER DEFAULT 0'], ['pay_method', "TEXT DEFAULT 'transfer'"], ['bank_name', "TEXT DEFAULT ''"], ['annual_used', 'REAL DEFAULT 0'], ['deductions_json', "TEXT DEFAULT '[]'"], ['birthday', "TEXT DEFAULT ''"], ['mobile', "TEXT DEFAULT ''"], ['address', "TEXT DEFAULT ''"], ['emergency_name', "TEXT DEFAULT ''"], ['emergency_relation', "TEXT DEFAULT ''"], ['emergency_phone', "TEXT DEFAULT ''"], ['insured_date', "TEXT DEFAULT ''"], ['salary_note', "TEXT DEFAULT ''"], ['hr_updated_at', 'TEXT'], ['hr_updated_by', "TEXT DEFAULT ''"], ['salary_updated_at', 'TEXT'], ['salary_updated_by', "TEXT DEFAULT ''"]])
      if (!cols.includes(c)) db.exec(`ALTER TABLE hr_profiles ADD COLUMN ${c} ${def}`); }

  // ---------- 小工具 ----------
  const int = v => { const n = Math.round(Number(String(v ?? '').replace(/[,\s元]/g, ''))); return Number.isFinite(n) ? n : 0; };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const tx = fn => (db.transaction ? db.transaction(fn) : fn);
  const monthTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const by = u => u?.name || u?.employee_id || '';
  const has = (u, keys) => u?.role === 'company_admin' || (effectivePermissions(u) || []).some(k => keys.includes(k));
  // 敏感權限：只有公司管理員可以授予（見 server.js guardSensitivePermissions）
  const canPayroll = u => has(u, ['payroll']);
  // 職務區分：人事資料由人事／總務維護；薪資由會計維護（公司管理員兩者皆可）
  const canHR = u => has(u, ['hr-records']);
  // 特休（勞基法第 38 條，週年制）：滿 6 個月 3 日、1 年 7 日、2 年 10 日、3～4 年 14 日、5～9 年 15 日、10 年起每年加 1 日至 30 日
  function annualLeave(hire, today) {
    if (!isDate(hire)) return null;
    const add = (d, m) => { const x = new Date(`${d}T00:00:00Z`); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
    const byYears = y => y < 1 ? 3 : y === 1 ? 7 : y === 2 ? 10 : y <= 4 ? 14 : y <= 9 ? 15 : Math.min(30, 15 + (y - 9));
    let months = 0; while (months < 1200 && add(hire, months + 1) <= today) months++;
    if (months < 6) return { days: 0, start: '', end: '', next_date: add(hire, 6), next_days: 3, service_months: months };
    if (months < 12) return { days: 3, start: add(hire, 6), end: add(hire, 12), next_date: add(hire, 12), next_days: 7, service_months: months };
    const y = Math.floor(months / 12);
    return { days: byYears(y), start: add(hire, y * 12), end: add(hire, (y + 1) * 12), next_date: add(hire, (y + 1) * 12), next_days: byYears(y + 1), service_months: months };
  }
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const monthDiff = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
  const daysIn = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const cleanDeductions = list => (Array.isArray(list) ? list : []).map(x => ({ id: str(x?.id, 20).replace(/[^\w-]/g, '') || Math.random().toString(36).slice(2, 10), name: str(x?.name, 20), amount: Math.max(0, int(x?.amount)), start_month: isMonth(x?.start_month) ? x.start_month : monthTW(), months: x?.once ? 1 : Math.max(0, Math.min(int(x?.months), 120)), once: !!x?.once, note: str(x?.note, 100) })).filter(x => x.name && x.amount).slice(0, 20);
  // 某月份適用的定期代扣款（制服費等）：開始月份起，期數 0 表示每月持續
  function deductionsFor(list, month) {
    return (list || []).map(d => { const k = monthDiff(d.start_month, month); return k >= 0 && (!d.months || k < d.months) ? { id: d.id, name: d.name, amount: int(d.amount), period: d.once ? '當月扣款' : d.months ? `第 ${k + 1}/${d.months} 期` : '每月', once: !!d.once, note: d.note || '' } : null; }).filter(Boolean);
  }
  // 試用期薪資：整月在試用期內用試用期薪資；試用期在當月結束時依日數比例計算
  function baseForMonth(prof, month) {
    const formal = int(prof.base_salary), trial = int(prof.trial_salary), end = prof.trial_end_date;
    if (!trial || !end) return { base: formal, base_note: '' };
    const first = `${month}-01`, days = daysIn(month), last = `${month}-${String(days).padStart(2, '0')}`;
    if (end < first) return { base: formal, base_note: '' };
    if (end >= last) return { base: trial, base_note: '試用期薪資', trial: true };
    const d = Number(end.slice(8, 10));
    return { base: Math.round(trial * d / days + formal * (days - d) / days), base_note: `試用期 1～${d} 日 ${trial.toLocaleString('en-US')}、正式 ${d + 1}～${days} 日 ${formal.toLocaleString('en-US')}（依日數比例）`, trial: true };
  }
  const guard = check => (req, res, next) => { const u = getUser(req); if (!check(u)) return bad(res, '您沒有這項功能的權限（需要人事或會計權限）', 403); next(); };
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); }); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };

  function occupationalRate(tid, t) { const r = db.prepare('SELECT occupational_rate FROM payroll_settings WHERE tenant_id=?').get(tid); return r && r.occupational_rate != null ? Number(r.occupational_rate) : t.rates.occupational; }
  function staffList(tid) {
    return db.prepare(`SELECT id,employee_id,name,role,position,job_level,work_type,is_active,COALESCE(person_status,'active') person_status FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY role='company_admin' DESC,employee_id`).all(tid);
  }
  function profileRow(tid, sid) { return db.prepare('SELECT * FROM hr_profiles WHERE tenant_id=? AND staff_id=?').get(tid, sid) || null; }
  function profileOut(u, r, t) {
    const p = r || {};
    const allowances = parse(p.allowances_json, []);
    const monthly = int(p.base_salary) + allowances.reduce((a, x) => a + int(x.amount), 0);
    const auto = p.auto_grade == null ? true : !!p.auto_grade;
    const sug = INS.suggestGrades(t, monthly);
    const prof = {
      staff_id: u.id, employee_id: u.employee_id, name: u.name, position: u.position || u.job_level || '', role: u.role, work_type: u.work_type || 'site',
      payroll_enabled: p.payroll_enabled == null ? u.role !== 'company_admin' : !!p.payroll_enabled,
      hire_date: p.hire_date || '', trial_end_date: p.trial_end_date || '', base_salary: int(p.base_salary), allowances, monthly_salary: monthly,
      labor_insured: p.labor_insured == null ? true : !!p.labor_insured, employment_insured: p.employment_insured == null ? true : !!p.employment_insured,
      occupational_insured: p.occupational_insured == null ? true : !!p.occupational_insured, health_insured: p.health_insured == null ? true : !!p.health_insured,
      pension_enabled: p.pension_enabled == null ? true : !!p.pension_enabled, auto_grade: auto,
      labor_grade: auto ? sug.labor_grade : int(p.labor_grade) || sug.labor_grade, occupational_grade: auto ? sug.occupational_grade : int(p.occupational_grade) || sug.occupational_grade,
      health_grade: auto ? sug.health_grade : int(p.health_grade) || sug.health_grade, pension_grade: auto ? sug.pension_grade : int(p.pension_grade) || sug.pension_grade,
      health_dependents: int(p.health_dependents), pension_self_rate: Number(p.pension_self_rate) || 0, bank_account: p.bank_account || '', note: p.note || '',
      configured: !!r && int(p.base_salary) > 0, updated_at: p.updated_at || '', updated_by: p.updated_by || '',
      trial_salary: int(p.trial_salary), deductions: parse(p.deductions_json, []), salary_note: p.salary_note || '',
      pay_method: p.pay_method === 'cash' ? 'cash' : 'transfer', bank_name: p.bank_name || '', annual_used: Number(p.annual_used) || 0,
      birthday: p.birthday || '', mobile: p.mobile || '', address: p.address || '', emergency_name: p.emergency_name || '', emergency_relation: p.emergency_relation || '', emergency_phone: p.emergency_phone || '', insured_date: p.insured_date || '',
      hr_updated_at: p.hr_updated_at || '', hr_updated_by: p.hr_updated_by || '', salary_updated_at: p.salary_updated_at || '', salary_updated_by: p.salary_updated_by || '',
    };
    return prof;
  }
  function insuranceFor(prof, t, tid) {
    return INS.computeInsurance({ ...prof, occupational_insured: prof.labor_insured && prof.occupational_insured }, t, { rates: { occupational: occupationalRate(tid, t) } });
  }

  // ---------- 借資 ----------
  function advanceBalance(a, excludeRunId = null) {
    const paid = db.prepare(`SELECT COALESCE(SUM(r.amount),0) s FROM advance_repayments r LEFT JOIN payroll_runs pr ON pr.id=r.run_id WHERE r.advance_id=? AND (r.run_id IS NULL OR (pr.status='published' AND r.run_id<>COALESCE(?,-1)))`).get(a.id, excludeRunId).s;
    return Math.max(0, int(a.amount) - int(paid));
  }
  function advancesOut(tid, staffId = null) {
    const rows = staffId ? db.prepare('SELECT a.*,u.name,u.employee_id FROM salary_advances a JOIN staff_users u ON u.id=a.staff_id WHERE a.tenant_id=? AND a.staff_id=? ORDER BY a.advance_date DESC,a.id DESC').all(tid, staffId)
      : db.prepare('SELECT a.*,u.name,u.employee_id FROM salary_advances a JOIN staff_users u ON u.id=a.staff_id WHERE a.tenant_id=? ORDER BY a.status=\'active\' DESC,a.advance_date DESC,a.id DESC').all(tid);
    const rep = db.prepare(`SELECT r.month,r.amount,r.note,r.run_id,COALESCE(pr.status,'manual') run_status FROM advance_repayments r LEFT JOIN payroll_runs pr ON pr.id=r.run_id WHERE r.advance_id=? ORDER BY r.month,r.id`);
    return rows.map(a => ({ ...a, balance: advanceBalance(a), repayments: rep.all(a.id).filter(x => x.run_status !== 'draft') }));
  }

  // ---------- 薪資計算 ----------
  function calcItem(data) {
    const allowances = (data.allowances || []).reduce((a, x) => a + int(x.amount), 0);
    const gross = int(data.base) + allowances + int(data.overtime) + int(data.other_add);
    const ee = data.ins?.employee || {};
    const deductionsTotal = (data.deductions || []).reduce((a, x) => a + int(x.amount), 0);
    const deduct = int(ee.labor) + int(ee.health) + int(ee.pension_self) + int(data.leave_deduct) + int(data.advance_deduct) + deductionsTotal + int(data.other_deduct);
    const er = data.ins?.employer || {};
    const employer = int(er.labor) + int(er.occupational) + int(er.health) + int(er.pension);
    return { ...data, deductions_total: deductionsTotal, gross, deduct_total: deduct, net: gross - deduct, employer_total: employer, employer_cost: gross + employer };
  }
  function buildItem(tid, run, u, prof, t, prev) {
    const keep = prev ? parse(prev.data_json, {}) : {};
    const bm = baseForMonth(prof, run.month);
    const baseNow = keep.base_manual ? int(keep.base) : bm.base;
    // 自動級距：依「當月」薪資（試用期用試用期薪資）
    const monthly = baseNow + prof.allowances.reduce((a, x) => a + int(x.amount), 0);
    const ins = insuranceFor(prof.auto_grade ? { ...prof, ...INS.suggestGrades(t, monthly) } : prof, t, tid);
    // 借資扣回：每筆借資扣「每月扣回金額」，不超過剩餘餘額
    const advances = db.prepare("SELECT * FROM salary_advances WHERE tenant_id=? AND staff_id=? AND status='active' AND start_month<=? ORDER BY advance_date,id").all(tid, u.id, run.month)
      .map(a => ({ id: a.id, reason: a.reason, amount: Math.min(int(a.monthly_deduct), advanceBalance(a, run.id)) })).filter(a => a.amount > 0);
    const data = {
      base: baseNow, base_manual: !!keep.base_manual, base_note: keep.base_manual ? '本月手動調整' : bm.base_note,
      deductions: deductionsFor(prof.deductions, run.month),
      allowances: prof.allowances,
      overtime: int(keep.overtime), leave_deduct: int(keep.leave_deduct),
      other_add: int(keep.other_add), other_add_note: keep.other_add_note || '', other_deduct: int(keep.other_deduct), other_deduct_note: keep.other_deduct_note || '',
      advances, advance_deduct: keep.advance_manual ? int(keep.advance_deduct) : advances.reduce((a, x) => a + x.amount, 0), advance_manual: !!keep.advance_manual,
      ins: { grades: ins.grades, employee: ins.employee, employer: ins.employer, health_dependents: prof.health_dependents, pension_self_rate: prof.pension_self_rate },
      note: keep.note || '', bank_account: prof.bank_account, hire_date: prof.hire_date, configured: prof.configured,
    };
    return calcItem(data);
  }
  function saveItem(run, u, prof, data, prevId) {
    if (prevId) db.prepare('UPDATE payroll_items SET employee_id=?,name=?,position=?,data_json=?,gross=?,net=?,employer_cost=? WHERE id=?').run(u.employee_id, u.name, prof.position, JSON.stringify(data), data.gross, data.net, data.employer_cost, prevId);
    else db.prepare('INSERT INTO payroll_items (run_id,tenant_id,staff_id,employee_id,name,position,data_json,gross,net,employer_cost) VALUES (?,?,?,?,?,?,?,?,?,?)').run(run.id, run.tenant_id, u.id, u.employee_id, u.name, prof.position, JSON.stringify(data), data.gross, data.net, data.employer_cost);
  }
  function generate(tid, month, user) {
    let run = db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tid, month);
    if (run && run.status === 'published') { const e = new Error('這個月份的薪資已經發布，請先「撤回發布」才能重新計算'); e.status = 409; throw e; }
    const t = tables.forMonth(month);
    const rates = { ...t.rates, occupational: occupationalRate(tid, t) };
    if (!run) { const info = db.prepare('INSERT INTO payroll_runs (tenant_id,month,status,table_year,rates_json,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(tid, month, 'draft', t.year, JSON.stringify(rates), now(), by(user), now()); run = db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(Number(info.lastInsertRowid)); }
    else db.prepare('UPDATE payroll_runs SET table_year=?,rates_json=?,updated_at=? WHERE id=?').run(t.year, JSON.stringify(rates), now(), run.id);
    const staff = staffList(tid);
    const existing = new Map(db.prepare('SELECT * FROM payroll_items WHERE run_id=?').all(run.id).map(x => [x.staff_id, x]));
    tx(() => {
      const included = new Set();
      for (const u of staff) {
        const prof = profileOut(u, profileRow(tid, u.id), t);
        if (!prof.payroll_enabled) continue;
        included.add(u.id);
        const prev = existing.get(u.id);
        saveItem(run, u, prof, buildItem(tid, run, u, prof, t, prev), prev?.id);
      }
      for (const [sid, it] of existing) if (!included.has(sid)) db.prepare('DELETE FROM payroll_items WHERE id=?').run(it.id);
    })();
    return run.id;
  }
  function runOut(run) {
    if (!run) return null;
    const items = db.prepare('SELECT * FROM payroll_items WHERE run_id=? ORDER BY employee_id').all(run.id).map(x => ({ id: x.id, staff_id: x.staff_id, employee_id: x.employee_id, name: x.name, position: x.position, ...parse(x.data_json, {}), viewed_at: x.viewed_at, confirmed_at: x.confirmed_at }));
    const sum = k => items.reduce((a, x) => a + int(typeof k === 'function' ? k(x) : x[k]), 0);
    const totals = {
      base: sum('base'), allowances: sum(x => (x.allowances || []).reduce((a, y) => a + int(y.amount), 0)), overtime: sum('overtime'), other_add: sum('other_add'), gross: sum('gross'),
      labor_ee: sum(x => x.ins?.employee?.labor), health_ee: sum(x => x.ins?.employee?.health), pension_self: sum(x => x.ins?.employee?.pension_self),
      leave_deduct: sum('leave_deduct'), advance_deduct: sum('advance_deduct'), deductions: sum('deductions_total'), other_deduct: sum('other_deduct'), deduct_total: sum('deduct_total'), net: sum('net'),
      labor_er: sum(x => x.ins?.employer?.labor), occupational_er: sum(x => x.ins?.employer?.occupational), health_er: sum(x => x.ins?.employer?.health), pension_er: sum(x => x.ins?.employer?.pension),
      employer_total: sum('employer_total'), employer_cost: sum('employer_cost'),
    };
    return { id: run.id, month: run.month, status: run.status, table_year: run.table_year, rates: parse(run.rates_json, {}), created_at: run.created_at, created_by: run.created_by, updated_at: run.updated_at, published_at: run.published_at, published_by: run.published_by, items, totals, confirmed: items.filter(x => x.confirmed_at).length, viewed: items.filter(x => x.viewed_at).length };
  }
  function sendMessage(tid, from, toId, body) {
    try {
      const to = db.prepare('SELECT id,employee_id,name FROM staff_users WHERE id=? AND tenant_id=?').get(toId, tid);
      if (!to || !from || to.id === from.id) return;
      db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
        .run(tid, from.id, to.id, from.employee_id, from.name, to.employee_id, to.name, '薪資單通知', body, 'text', '', now());
    } catch (e) { console.warn('payroll message failed', e.message); }
  }
  const monthLabel = m => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;

  // ================= 公司：人事管理 =================
  const C = '/api/company';
  // 目前月份的投保級距（試用期中依試用期薪資自動對應）
  const gradesNow = (p, t) => { const inTrial = p.trial_salary && p.trial_end_date && p.trial_end_date >= `${monthTW()}-01`; const monthly = (inTrial ? p.trial_salary : p.base_salary) + p.allowances.reduce((a, x) => a + int(x.amount), 0); return { ...p, ...(p.auto_grade ? INS.suggestGrades(t, monthly) : {}), in_trial: !!inTrial }; };
  const hrView0 = p => ({ staff_id: p.staff_id, employee_id: p.employee_id, name: p.name, position: p.position, role: p.role, work_type: p.work_type, hire_date: p.hire_date, trial_end_date: p.trial_end_date, birthday: p.birthday, mobile: p.mobile, address: p.address, emergency_name: p.emergency_name, emergency_relation: p.emergency_relation, emergency_phone: p.emergency_phone, insured_date: p.insured_date, labor_insured: p.labor_insured, employment_insured: p.employment_insured, health_insured: p.health_insured, pension_enabled: p.pension_enabled, health_dependents: p.health_dependents, note: p.note, hr_updated_at: p.hr_updated_at, hr_updated_by: p.hr_updated_by });
  const hrView = (p, t) => { const g = gradesNow(p, t); const al = annualLeave(p.hire_date, todayTW()); return { ...hrView0(p), auto_grade: p.auto_grade, salary_set: p.configured, labor_grade: g.labor_grade, health_grade: g.health_grade, pension_grade: g.pension_grade, occupational_grade: g.occupational_grade, pay_method: p.pay_method, bank_name: p.bank_name, bank_account: p.bank_account, annual_leave: al, annual_used: p.annual_used, annual_left: al ? Math.max(0, al.days - p.annual_used) : 0 }; };
  const ensureRow = (tid, sid) => db.prepare('INSERT OR IGNORE INTO hr_profiles (tenant_id,staff_id,updated_at) VALUES (?,?,?)').run(tid, sid, now());
  const findStaff = (tid, sid) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid);
  const tableOut = (tid, t) => ({ year: t.year, exact: t.exact, labor: t.labor, occupational: t.occupational, health: t.health, pension: t.pension, rates: { ...t.rates, occupational: occupationalRate(tid, t) } });

  // ---------- 人事管理（人事／總務）：基本資料、到職與試用期、加保狀態、眷屬 ----------
  app.get(`${C}/hr/profiles`, requireCompanyAdmin, guard(canHR), wrap((req, res) => {
    const tid = tenantId(req); const t = tables.forMonth(monthTW());
    res.set('Cache-Control', 'no-store');
    res.json({ profiles: staffList(tid).map(u => hrView(profileOut(u, profileRow(tid, u.id), t), t)), table: tableOut(tid, t), can_payroll: canPayroll(getUser(req)) });
  }));
  app.put(`${C}/hr/profiles/:staffId`, requireCompanyAdmin, guard(canHR), wrap((req, res) => {
    const tid = tenantId(req); const sid = Number(req.params.staffId); const u = findStaff(tid, sid); if (!u) return bad(res, '找不到人員', 404);
    const b = req.body || {};
    for (const k of ['hire_date', 'trial_end_date', 'birthday', 'insured_date']) if (b[k] && !isDate(b[k])) return bad(res, '日期格式不正確');
    if (b.hire_date && b.trial_end_date && b.trial_end_date < b.hire_date) return bad(res, '試用期到期日不能早於到職日');
    const t = tables.forMonth(monthTW()); const auto = b.auto_grade !== false;
    const g = (k, list) => { const v = int(b[k]); if (auto || !v) return 0; if (!list.includes(v)) throw Object.assign(new Error('投保級距必須是級距表中的金額'), { status: 400 }); return v; };
    const lg = g('labor_grade', t.labor);
    const grades = [lg, auto ? 0 : INS.gradeFor(t.occupational, lg), g('health_grade', t.health), g('pension_grade', t.pension)];
    ensureRow(tid, sid);
    db.prepare('UPDATE hr_profiles SET auto_grade=?,labor_grade=?,occupational_grade=?,health_grade=?,pension_grade=?,pay_method=?,bank_name=?,bank_account=?,annual_used=? WHERE tenant_id=? AND staff_id=?')
      .run(auto ? 1 : 0, ...grades, b.pay_method === 'cash' ? 'cash' : 'transfer', str(b.bank_name, 40), b.pay_method === 'cash' ? '' : str(b.bank_account, 60), Math.max(0, Math.min(Number(b.annual_used) || 0, 60)), tid, sid);
    db.prepare('UPDATE hr_profiles SET hire_date=?,trial_end_date=?,birthday=?,mobile=?,address=?,emergency_name=?,emergency_relation=?,emergency_phone=?,insured_date=?,labor_insured=?,employment_insured=?,occupational_insured=?,health_insured=?,pension_enabled=?,health_dependents=?,note=?,hr_updated_at=?,hr_updated_by=?,updated_at=? WHERE tenant_id=? AND staff_id=?')
      .run(b.hire_date || '', b.trial_end_date || '', b.birthday || '', str(b.mobile, 30), str(b.address, 200), str(b.emergency_name, 30), str(b.emergency_relation, 20), str(b.emergency_phone, 30), b.insured_date || '', b.labor_insured === false ? 0 : 1, b.employment_insured === false ? 0 : 1, b.labor_insured === false ? 0 : 1, b.health_insured === false ? 0 : 1, b.pension_enabled === false ? 0 : 1, Math.max(0, Math.min(int(b.health_dependents), 20)), str(b.note, 500), now(), by(getUser(req)), now(), tid, sid);
    try { db.prepare('UPDATE staff_users SET trial_end_date=?,health_dependents=? WHERE id=?').run(b.trial_end_date || '', Math.max(0, int(b.health_dependents)), sid); } catch {}
    res.json({ success: true, profile: hrView(profileOut(u, profileRow(tid, sid), t), t) });
  }));

  // ---------- 人員薪資設定（會計）：正式／試用期薪資、加給、定期代扣款、投保級距、勞退自提 ----------
  const salaryView = (p, t, tid) => {
    const trialMonthly = p.trial_salary ? p.trial_salary + p.allowances.reduce((a, x) => a + int(x.amount), 0) : 0;
    const now_ = monthTW(); const inTrial = p.trial_salary && p.trial_end_date && p.trial_end_date >= `${now_}-01`;
    const cur = gradesNow(p, t);
    return { staff_id: p.staff_id, employee_id: p.employee_id, name: p.name, position: p.position, role: p.role, hire_date: p.hire_date, trial_end_date: p.trial_end_date, in_trial: !!inTrial,
      labor_insured: p.labor_insured, employment_insured: p.employment_insured, health_insured: p.health_insured, pension_enabled: p.pension_enabled, health_dependents: p.health_dependents,
      payroll_enabled: p.payroll_enabled, base_salary: p.base_salary, trial_salary: p.trial_salary, allowances: p.allowances, monthly_salary: p.monthly_salary, trial_monthly: trialMonthly,
      deductions: p.deductions, deductions_now: deductionsFor(p.deductions, now_), auto_grade: p.auto_grade, labor_grade: cur.labor_grade, occupational_grade: cur.occupational_grade, health_grade: cur.health_grade, pension_grade: cur.pension_grade,
      pension_self_rate: p.pension_self_rate, pay_method: p.pay_method, bank_name: p.bank_name, bank_account: p.bank_account, insured_date: p.insured_date, salary_note: p.salary_note, configured: p.configured, salary_updated_at: p.salary_updated_at, salary_updated_by: p.salary_updated_by,
      insurance: insuranceFor(cur, t, tid) };
  };
  app.get(`${C}/payroll/salaries`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const t = tables.forMonth(monthTW());
    res.set('Cache-Control', 'no-store');
    res.json({ salaries: staffList(tid).map(u => salaryView(profileOut(u, profileRow(tid, u.id), t), t, tid)), table: tableOut(tid, t), month: monthTW() });
  }));
  app.put(`${C}/payroll/salaries/:staffId`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const sid = Number(req.params.staffId); const u = findStaff(tid, sid); if (!u) return bad(res, '找不到人員', 404);
    const b = req.body || {}; const t = tables.forMonth(monthTW());
    const allowances = (Array.isArray(b.allowances) ? b.allowances : []).map(x => ({ name: str(x?.name, 20), amount: int(x?.amount) })).filter(x => x.name && x.amount).slice(0, 10);
    ensureRow(tid, sid);
    // 投保級距、薪轉帳號屬於人事資料，這裡不修改
    db.prepare('UPDATE hr_profiles SET payroll_enabled=?,base_salary=?,trial_salary=?,allowances_json=?,deductions_json=?,pension_self_rate=?,salary_note=?,salary_updated_at=?,salary_updated_by=?,updated_at=? WHERE tenant_id=? AND staff_id=?')
      .run(b.payroll_enabled === false ? 0 : 1, Math.max(0, int(b.base_salary)), Math.max(0, int(b.trial_salary)), JSON.stringify(allowances), JSON.stringify(cleanDeductions(b.deductions)), Math.max(0, Math.min(Number(b.pension_self_rate) || 0, 6)), str(b.salary_note, 500), now(), by(getUser(req)), now(), tid, sid);
    try { db.prepare('UPDATE staff_users SET formal_salary=? WHERE id=?').run(String(int(b.base_salary) || ''), sid); } catch {}
    res.json({ success: true, salary: salaryView(profileOut(u, profileRow(tid, sid), t), t, tid) });
  }));
  // 只改定期代扣款（借資頁的「代扣款項」使用）
  app.put(`${C}/payroll/salaries/:staffId/deductions`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const sid = Number(req.params.staffId); if (!findStaff(tid, sid)) return bad(res, '找不到人員', 404);
    ensureRow(tid, sid);
    db.prepare('UPDATE hr_profiles SET deductions_json=?,salary_updated_at=?,salary_updated_by=? WHERE tenant_id=? AND staff_id=?').run(JSON.stringify(cleanDeductions(req.body?.deductions)), now(), by(getUser(req)), tid, sid);
    res.json({ success: true });
  }));
  app.put(`${C}/payroll/settings`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const r = Number(req.body?.occupational_rate); if (!(r >= 0 && r < 0.05)) return bad(res, '職災費率請輸入 0～5% 之間');
    db.prepare('INSERT INTO payroll_settings (tenant_id,occupational_rate,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET occupational_rate=excluded.occupational_rate,updated_at=excluded.updated_at').run(tenantId(req), r, now());
    res.json({ success: true });
  }));

  // ================= 公司：借資 =================
  app.get(`${C}/payroll/advances`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req);
    const t = tables.forMonth(monthTW());
    const deductions = staffList(tid).flatMap(u => { const p = profileOut(u, profileRow(tid, u.id), t); return p.deductions.map(d => ({ ...d, staff_id: u.id, name_staff: u.name, employee_id: u.employee_id, active_now: deductionsFor([d], monthTW()).length > 0, ended: d.months ? monthDiff(d.start_month, monthTW()) >= d.months : false })); });
    res.json({ advances: advancesOut(tid), deductions, month: monthTW(), staff: staffList(tid).map(u => ({ id: u.id, employee_id: u.employee_id, name: u.name })) });
  }));
  const advFields = b => {
    const amount = int(b.amount), monthly = int(b.monthly_deduct);
    if (amount <= 0) throw Object.assign(new Error('請輸入借資金額'), { status: 400 });
    if (monthly <= 0) throw Object.assign(new Error('請輸入每月扣回金額'), { status: 400 });
    if (!isDate(b.advance_date)) throw Object.assign(new Error('請輸入借資日期'), { status: 400 });
    if (!isMonth(b.start_month)) throw Object.assign(new Error('請選擇開始扣回的月份'), { status: 400 });
    return { amount, monthly: Math.min(monthly, amount), date: b.advance_date, start: b.start_month, reason: str(b.reason, 200) };
  };
  app.post(`${C}/payroll/advances`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const f = advFields(req.body || {}); const sid = Number(req.body?.staff_id);
    if (!db.prepare('SELECT id FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid)) return bad(res, '請選擇人員');
    const info = db.prepare('INSERT INTO salary_advances (tenant_id,staff_id,advance_date,amount,monthly_deduct,start_month,reason,status,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(tid, sid, f.date, f.amount, f.monthly, f.start, f.reason, 'active', now(), by(getUser(req)), now());
    res.json({ success: true, id: Number(info.lastInsertRowid) });
  }));
  app.put(`${C}/payroll/advances/:id`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const a = db.prepare('SELECT * FROM salary_advances WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!a) return bad(res, '找不到這筆借資', 404);
    if (req.body?.status) {
      const st = req.body.status === 'closed' ? 'closed' : 'active';
      // 結清：剩餘餘額以「現金還款」登記
      if (st === 'closed' && req.body.settle) { const bal = advanceBalance(a); if (bal > 0) db.prepare('INSERT INTO advance_repayments (advance_id,tenant_id,run_id,month,amount,note,created_at) VALUES (?,?,NULL,?,?,?,?)').run(a.id, tid, monthTW(), bal, '現金還款／結清', now()); }
      db.prepare('UPDATE salary_advances SET status=?,updated_at=? WHERE id=?').run(st, now(), a.id);
      return res.json({ success: true });
    }
    const f = advFields({ ...a, ...req.body });
    db.prepare('UPDATE salary_advances SET advance_date=?,amount=?,monthly_deduct=?,start_month=?,reason=?,updated_at=? WHERE id=?').run(f.date, f.amount, f.monthly, f.start, f.reason, now(), a.id);
    res.json({ success: true });
  }));
  app.delete(`${C}/payroll/advances/:id`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const a = db.prepare('SELECT * FROM salary_advances WHERE id=? AND tenant_id=?').get(Number(req.params.id), tid); if (!a) return bad(res, '找不到這筆借資', 404);
    const paid = db.prepare(`SELECT COUNT(*) c FROM advance_repayments r LEFT JOIN payroll_runs pr ON pr.id=r.run_id WHERE r.advance_id=? AND (r.run_id IS NULL OR pr.status='published')`).get(a.id).c;
    if (paid) return bad(res, '這筆借資已經有扣回紀錄，不能刪除；如已還清請按「結清」');
    db.prepare('DELETE FROM advance_repayments WHERE advance_id=?').run(a.id); db.prepare('DELETE FROM salary_advances WHERE id=?').run(a.id);
    res.json({ success: true });
  }));

  // ================= 公司：人員薪資統計表 =================
  app.get(`${C}/payroll/runs`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req);
    const runs = db.prepare(`SELECT r.id,r.month,r.status,r.published_at,r.published_by,(SELECT COUNT(*) FROM payroll_items i WHERE i.run_id=r.id) people,(SELECT COALESCE(SUM(net),0) FROM payroll_items i WHERE i.run_id=r.id) net,(SELECT COALESCE(SUM(employer_cost),0) FROM payroll_items i WHERE i.run_id=r.id) cost FROM payroll_runs r WHERE r.tenant_id=? ORDER BY r.month DESC LIMIT 36`).all(tid);
    const t = tables.forMonth(monthTW());
    res.json({ runs, today_month: monthTW(), table: { year: t.year, exact: t.exact }, occupational_rate: occupationalRate(tid, t) });
  }));
  app.get(`${C}/payroll/runs/:month`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    if (!isMonth(req.params.month)) return bad(res, '月份格式不正確');
    const run = db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tenantId(req), req.params.month);
    res.set('Cache-Control', 'no-store'); res.json({ run: runOut(run) });
  }));
  app.post(`${C}/payroll/runs/:month/generate`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    if (!isMonth(req.params.month)) return bad(res, '月份格式不正確');
    const id = generate(tenantId(req), req.params.month, getUser(req));
    res.json({ success: true, run: runOut(db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(id)) });
  }));
  app.put(`${C}/payroll/items/:id`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const it = db.prepare('SELECT i.*,r.status FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.id=? AND i.tenant_id=?').get(Number(req.params.id), tid);
    if (!it) return bad(res, '找不到這筆薪資', 404); if (it.status === 'published') return bad(res, '已發布的薪資不能修改，請先撤回發布', 409);
    const data = parse(it.data_json, {}); const b = req.body || {};
    for (const k of ['overtime', 'leave_deduct', 'other_add', 'other_deduct']) if (b[k] !== undefined) data[k] = Math.max(0, int(b[k]));
    for (const k of ['other_add_note', 'other_deduct_note', 'note']) if (b[k] !== undefined) data[k] = str(b[k], 200);
    if (b.base !== undefined) { data.base = Math.max(0, int(b.base)); data.base_manual = true; }
    if (b.advance_deduct !== undefined) { data.advance_deduct = Math.max(0, int(b.advance_deduct)); data.advance_manual = true; }
    if (b.reset) { data.base_manual = false; data.advance_manual = false; }
    const out = calcItem(data);
    db.prepare('UPDATE payroll_items SET data_json=?,gross=?,net=?,employer_cost=? WHERE id=?').run(JSON.stringify(out), out.gross, out.net, out.employer_cost, it.id);
    db.prepare('UPDATE payroll_runs SET updated_at=? WHERE id=?').run(now(), it.run_id);
    if (b.reset) generate(tid, db.prepare('SELECT month FROM payroll_runs WHERE id=?').get(it.run_id).month, getUser(req));
    res.json({ success: true, run: runOut(db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(it.run_id)) });
  }));
  app.post(`${C}/payroll/runs/:month/publish`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const u = getUser(req);
    const run = db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tid, req.params.month);
    if (!run) return bad(res, '請先產生這個月份的薪資'); if (run.status === 'published') return bad(res, '已經發布過了');
    const items = db.prepare('SELECT * FROM payroll_items WHERE run_id=?').all(run.id);
    if (!items.length) return bad(res, '沒有任何人員的薪資資料');
    tx(() => {
      db.prepare('DELETE FROM advance_repayments WHERE run_id=?').run(run.id);
      for (const it of items) {
        const data = parse(it.data_json, {});
        // 借資扣回：依各筆借資分配實際扣回金額（手動調整時依序扣）
        let left = int(data.advance_deduct);
        const list = db.prepare("SELECT * FROM salary_advances WHERE tenant_id=? AND staff_id=? AND status='active' ORDER BY advance_date,id").all(tid, it.staff_id);
        for (const a of list) { if (left <= 0) break; const amt = Math.min(left, advanceBalance(a, run.id)); if (amt > 0) { db.prepare('INSERT INTO advance_repayments (advance_id,tenant_id,run_id,month,amount,note,created_at) VALUES (?,?,?,?,?,?,?)').run(a.id, tid, run.id, run.month, amt, '薪資扣回', now()); left -= amt; } }
      }
      db.prepare("UPDATE payroll_runs SET status='published',published_at=?,published_by=?,updated_at=? WHERE id=?").run(now(), by(u), now(), run.id);
      // 餘額歸零的借資自動結清
      for (const a of db.prepare("SELECT * FROM salary_advances WHERE tenant_id=? AND status='active'").all(tid)) if (advanceBalance(a) <= 0) db.prepare("UPDATE salary_advances SET status='closed',updated_at=? WHERE id=?").run(now(), a.id);
    })();
    for (const it of items) sendMessage(tid, u, it.staff_id, `📄 ${monthLabel(run.month)}薪資單已發布，實發金額 ${int(it.net).toLocaleString('en-US')} 元。\n請到「職員資料 → 本月薪資單」查看明細，確認無誤後按「已確認」。`);
    res.json({ success: true, run: runOut(db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(run.id)) });
  }));
  app.post(`${C}/payroll/runs/:month/unpublish`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const run = db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tid, req.params.month);
    if (!run || run.status !== 'published') return bad(res, '這個月份尚未發布');
    tx(() => {
      const ids = db.prepare('SELECT DISTINCT advance_id FROM advance_repayments WHERE run_id=?').all(run.id).map(x => x.advance_id);
      db.prepare('DELETE FROM advance_repayments WHERE run_id=?').run(run.id);
      for (const id of ids) { const a = db.prepare('SELECT * FROM salary_advances WHERE id=?').get(id); if (a && advanceBalance(a) > 0) db.prepare("UPDATE salary_advances SET status='active',updated_at=? WHERE id=?").run(now(), id); }
      db.prepare("UPDATE payroll_runs SET status='draft',published_at=NULL,published_by='',updated_at=? WHERE id=?").run(now(), run.id);
      db.prepare('UPDATE payroll_items SET viewed_at=NULL,confirmed_at=NULL WHERE run_id=?').run(run.id);
    })();
    res.json({ success: true, run: runOut(db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(run.id)) });
  }));
  app.delete(`${C}/payroll/runs/:month`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const tid = tenantId(req); const run = db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tid, req.params.month);
    if (!run) return bad(res, '找不到', 404); if (run.status === 'published') return bad(res, '已發布的薪資不能刪除，請先撤回發布');
    db.prepare('DELETE FROM payroll_items WHERE run_id=?').run(run.id); db.prepare('DELETE FROM advance_repayments WHERE run_id=?').run(run.id); db.prepare('DELETE FROM payroll_runs WHERE id=?').run(run.id);
    res.json({ success: true });
  }));
  // 匯出 Excel（給會計、老闆）
  app.get(`${C}/payroll/runs/:month/export`, requireCompanyAdmin, guard(canPayroll), wrap((req, res) => {
    const run = runOut(db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? AND month=?').get(tenantId(req), req.params.month)); if (!run) return bad(res, '找不到', 404);
    const head = ['員編', '姓名', '職務', '底薪', '固定加給', '加班費', '其他加項', '應發合計', '勞保自付', '健保自付', '勞退自提', '請假扣款', '借資扣回', '代扣款', '其他扣項', '應扣合計', '實發金額', '勞保(公司)', '職災(公司)', '健保(公司)', '勞退6%(公司)', '公司負擔合計', '人事成本', '勞保級距', '健保級距', '勞退級距', '健保眷屬', '備註'];
    const rows = run.items.map(x => [x.employee_id, x.name, x.position, x.base, (x.allowances || []).reduce((a, y) => a + int(y.amount), 0), x.overtime, x.other_add, x.gross, x.ins?.employee?.labor, x.ins?.employee?.health, x.ins?.employee?.pension_self, x.leave_deduct, x.advance_deduct, x.deductions_total, x.other_deduct, x.deduct_total, x.net, x.ins?.employer?.labor, x.ins?.employer?.occupational, x.ins?.employer?.health, x.ins?.employer?.pension, x.employer_total, x.employer_cost, x.ins?.grades?.labor, x.ins?.grades?.health, x.ins?.grades?.pension, x.ins?.health_dependents, [x.base_note, ...(x.deductions || []).map(d => `${d.name}${d.period}`), x.other_add_note, x.other_deduct_note, x.note].filter(Boolean).join('；')]);
    const T = run.totals; rows.push(['合計', '', '', T.base, T.allowances, T.overtime, T.other_add, T.gross, T.labor_ee, T.health_ee, T.pension_self, T.leave_deduct, T.advance_deduct, T.deductions, T.other_deduct, T.deduct_total, T.net, T.labor_er, T.occupational_er, T.health_er, T.pension_er, T.employer_total, T.employer_cost]);
    const ws = XLSX.utils.aoa_to_sheet([[`人員薪資統計表 ${monthLabel(run.month)}（${run.status === 'published' ? '已發布' : '草稿'}）`], head, ...rows]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, run.month);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`人員薪資統計表_${run.month}.xlsx`)}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  }));

  // ================= 本人：薪資單 =================
  function myPayslips(req, res) {
    const u = getUser(req); if (!u) return bad(res, '尚未登入', 401);
    const rows = db.prepare("SELECT i.id,r.month,i.net,i.gross,i.viewed_at,i.confirmed_at,r.published_at FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.tenant_id=? AND i.staff_id=? AND r.status='published' ORDER BY r.month DESC LIMIT 24").all(u.tenant_id, u.id);
    res.set('Cache-Control', 'no-store'); res.json({ payslips: rows });
  }
  function myPayslip(req, res) {
    const u = getUser(req); if (!u) return bad(res, '尚未登入', 401);
    const it = db.prepare("SELECT i.*,r.month,r.published_at,r.table_year FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.id=? AND i.tenant_id=? AND i.staff_id=? AND r.status='published'").get(Number(req.params.id), u.tenant_id, u.id);
    if (!it) return bad(res, '找不到這份薪資單', 404);
    if (!it.viewed_at) db.prepare('UPDATE payroll_items SET viewed_at=? WHERE id=?').run(now(), it.id);
    const data = parse(it.data_json, {}); delete data.bank_account;
    res.json({ payslip: { id: it.id, month: it.month, published_at: it.published_at, employee_id: it.employee_id, name: it.name, position: it.position, confirmed_at: it.confirmed_at, ...data } });
  }
  function confirmPayslip(req, res) {
    const u = getUser(req); if (!u) return bad(res, '尚未登入', 401);
    const it = db.prepare("SELECT i.id FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.id=? AND i.tenant_id=? AND i.staff_id=? AND r.status='published'").get(Number(req.params.id), u.tenant_id, u.id);
    if (!it) return bad(res, '找不到這份薪資單', 404);
    db.prepare('UPDATE payroll_items SET confirmed_at=COALESCE(confirmed_at,?) WHERE id=?').run(now(), it.id);
    res.json({ success: true });
  }
  for (const [base, mw] of [['/api/staff', requireStaff], ['/api/company/my', requireCompanyAdmin]]) {
    app.get(`${base}/payslips`, mw, wrap(myPayslips));
    app.get(`${base}/payslips/:id`, mw, wrap(myPayslip));
    app.post(`${base}/payslips/:id/confirm`, mw, wrap(confirmPayslip));
  }
  // 職員資料「薪資相關」用
  function profileExtras(u) {
    const t = tables.forMonth(monthTW());
    const p0 = profileOut(u, profileRow(u.tenant_id, u.id), t);
    // 試用期中：級距與保費依試用期薪資
    const inTrial = p0.trial_salary && p0.trial_end_date && p0.trial_end_date >= `${monthTW()}-01`;
    const p = inTrial && p0.auto_grade ? { ...p0, ...INS.suggestGrades(t, p0.trial_salary + p0.allowances.reduce((a, x) => a + int(x.amount), 0)) } : p0;
    const ins = insuranceFor(p, t, u.tenant_id);
    const latest = db.prepare("SELECT i.id,r.month,i.net,i.confirmed_at FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.tenant_id=? AND i.staff_id=? AND r.status='published' ORDER BY r.month DESC LIMIT 1").get(u.tenant_id, u.id);
    const advances = advancesOut(u.tenant_id, u.id).filter(a => a.status === 'active').map(a => ({ advance_date: a.advance_date, amount: a.amount, balance: a.balance, monthly_deduct: a.monthly_deduct }));
    return {
      salary: { hire_date: p.hire_date, trial_end_date: p.trial_end_date, formal_salary: p.base_salary ? p.base_salary : '', trial_salary: p.trial_salary || '', allowances: p.allowances, deductions: deductionsFor(p.deductions, monthTW()), labor_insured: p.labor_insured, employment_insured: p.employment_insured, health_insured: p.health_insured, pension_enabled: p.pension_enabled, insurance_level: p.labor_insured ? p.labor_grade : '', health_grade: p.health_insured ? p.health_grade : '', pension_grade: p.pension_enabled ? p.pension_grade : '', health_dependents: p.health_dependents, pension_self_rate: p.pension_self_rate, employee_insurance: ins.employee, configured: p.configured },
      annual_leave: annualLeave(p0.hire_date, todayTW()), annual_used: p0.annual_used,
      pay_method: p0.pay_method,
      payslip: latest ? { available: true, id: latest.id, month: latest.month, net: latest.net, confirmed: !!latest.confirmed_at } : { available: false, message: '本月薪資單尚未發布' },
      advances,
    };
  }

  // ================= 總後台：投保級距表 =================
  if (requireSuperAdmin) {
    app.get('/api/admin/insurance-tables', requireSuperAdmin, wrap((req, res) => { const tabs = tables.all(); res.json({ tables: tabs, status: tables.status() }); }));
    app.put('/api/admin/insurance-tables/:year', requireSuperAdmin, wrap((req, res) => { const t = { ...(req.body || {}), year: Number(req.params.year) }; res.json({ success: true, table: tables.saveTable(t, '總後台') }); }));
    app.post('/api/admin/insurance-tables/derive', requireSuperAdmin, wrap((req, res) => { const y = Number(req.body?.year), mw = int(req.body?.min_wage); if (!(y > 2020) || mw < 10000) return bad(res, '請輸入年度與基本工資'); res.json({ table: tables.derive(y, mw) }); }));
    app.post('/api/admin/insurance-tables/check', requireSuperAdmin, wrap(async (req, res) => { const r = await tables.autoCheck({ force: true }); res.json({ result: r, status: tables.status() }); }));
    app.post('/api/admin/insurance-tables/confirm', requireSuperAdmin, wrap((req, res) => { res.json({ success: true, table: tables.confirmPending('總後台') }); }));
    app.delete('/api/admin/insurance-tables/:year', requireSuperAdmin, wrap((req, res) => { if (INS.BUILTIN[req.params.year] && !tables.all()[req.params.year]?.updated_at) return bad(res, '內建年度不能刪除'); tables.removeTable(req.params.year); res.json({ success: true }); }));
  }
  tables.startScheduler();
  return { profileExtras, canPayroll, canHR };
};
