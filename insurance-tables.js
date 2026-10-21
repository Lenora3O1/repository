// 台灣勞保／就保／職災／健保／勞退 投保級距與費率，以及每月保費計算。
// - 內建 115 年（2026-01-01 起）官方級距與費率。
// - 依薪資月份自動選用當年度的表；新年度的表可由總後台新增，或由系統自動檢查勞保局公告後產生「待確認」版本。
'use strict';

const BUILTIN = {
  2026: {
    year: 2026, effective: '2026-01-01', min_wage: 29500,
    source: '勞動部勞工保險局、衛生福利部中央健康保險署 115 年 1 月 1 日起適用之分級表',
    // 勞工保險投保薪資分級表（全時）
    labor: [29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800],
    // 勞工職業災害保險投保薪資分級表
    occupational: [29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800, 48200, 50600, 53000, 55400, 57800, 60800, 63800, 66800, 69800, 72800],
    // 全民健康保險投保金額分等級表
    health: [29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800, 48200, 50600, 53000, 55400, 57800, 60800, 63800, 66800, 69800, 72800, 76500, 80200, 83900, 87600, 92100, 96600, 101100, 105600, 110100, 115500, 120900, 126300, 131700, 137100, 142500, 147900, 150000, 156400, 162800, 169200, 175600, 182000, 189500, 197000, 204500, 212000, 219500, 228200, 236900, 245600, 254300, 263000, 273000, 283000, 293000, 303000, 313000],
    // 勞工退休金月提繳工資分級表
    pension: [1500, 3000, 4500, 6000, 7500, 8700, 9900, 11100, 12540, 13500, 15840, 16500, 17280, 17880, 19047, 20008, 21009, 22000, 23100, 24000, 25250, 26400, 27600, 29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800, 48200, 50600, 53000, 55400, 57800, 60800, 63800, 66800, 69800, 72800, 76500, 80200, 83900, 87600, 92100, 96600, 101100, 105600, 110100, 115500, 120900, 126300, 131700, 137100, 142500, 147900, 150000],
    rates: {
      labor_ordinary: 0.115,    // 勞保普通事故保險費率
      employment: 0.01,         // 就業保險費率
      labor_employee: 0.2,      // 勞保、就保：勞工負擔 20%
      labor_employer: 0.7,      //              雇主負擔 70%
      occupational: 0.0021,     // 職災保險（行業別＋通勤，平均 0.21%，各公司可自行設定）
      health: 0.0517,           // 健保費率
      health_employee: 0.3,     // 健保：本人負擔 30%
      health_employer: 0.6,     //       投保單位負擔 60%
      health_avg_dependents: 0.56, // 投保單位負擔的平均眷口數
      health_max_dependents: 3, // 眷屬最多計 3 口
      pension_employer: 0.06,   // 勞退雇主提繳 6%
    },
  },
};

const r0 = n => Math.round(Number(n) || 0);
// 依薪資找級距：取第一個 ≥ 薪資的級距；超過最高級以最高級計
function gradeFor(table, salary) {
  const s = Number(salary) || 0; if (!table?.length) return 0;
  return table.find(g => g >= s) ?? table[table.length - 1];
}
function snapToTable(table, amount) {
  const a = Number(amount) || 0; if (!a || !table?.length) return 0;
  return table.includes(a) ? a : gradeFor(table, a);
}

// 每月保費（員工自付與公司負擔），四捨五入方式與勞保局、健保署分擔金額表相同
function computeInsurance(p, t, opts = {}) {
  const R = { ...t.rates, ...(opts.rates || {}) };
  const labor = p.labor_insured ? snapToTable(t.labor, p.labor_grade) : 0;
  const occ = (p.occupational_insured ?? p.labor_insured) ? snapToTable(t.occupational, p.occupational_grade || p.labor_grade) : 0;
  const health = p.health_insured ? snapToTable(t.health, p.health_grade) : 0;
  const pension = p.pension_enabled !== false && p.pension_enabled !== 0 ? snapToTable(t.pension, p.pension_grade) : 0;
  const emp = p.labor_insured && p.employment_insured !== false && p.employment_insured !== 0;
  const deps = Math.max(0, Math.min(Number(p.health_dependents) || 0, R.health_max_dependents));
  const healthPerson = r0(health * R.health * R.health_employee);
  const selfRate = Math.max(0, Math.min(Number(p.pension_self_rate) || 0, 6)) / 100;
  const out = {
    grades: { labor, occupational: occ, health, pension },
    employee: {
      labor: labor ? r0(labor * (R.labor_ordinary + (emp ? R.employment : 0)) * R.labor_employee) : 0,
      health: health ? healthPerson * (1 + deps) : 0,
      pension_self: pension ? r0(pension * selfRate) : 0,
    },
    employer: {
      labor: labor ? r0(labor * (R.labor_ordinary + (emp ? R.employment : 0)) * R.labor_employer) : 0,
      occupational: occ ? r0(occ * R.occupational) : 0,
      health: health ? r0(health * R.health * R.health_employer * (1 + R.health_avg_dependents)) : 0,
      pension: pension ? r0(pension * R.pension_employer) : 0,
    },
  };
  return out;
}
function suggestGrades(t, monthlySalary) {
  return { labor_grade: gradeFor(t.labor, monthlySalary), occupational_grade: gradeFor(t.occupational, monthlySalary), health_grade: gradeFor(t.health, monthlySalary), pension_grade: gradeFor(t.pension, monthlySalary) };
}

// 新年度：基本工資調整時，所有低於新基本工資的級距改成新基本工資（與 115 年刪除 28,800 級的做法相同）
function deriveForMinWage(prev, year, minWage) {
  const lift = list => [...new Set([minWage, ...list.filter(g => g > minWage)])].sort((a, b) => a - b);
  // 勞退低級距給部分工時使用，只調整「原本基本工資那一級」
  const pension = [...new Set(prev.pension.map(g => (g >= prev.min_wage && g < minWage) ? minWage : g))].sort((a, b) => a - b);
  return { ...JSON.parse(JSON.stringify(prev)), year, effective: `${year}-01-01`, min_wage: minWage, labor: lift(prev.labor), occupational: lift(prev.occupational), health: lift(prev.health), pension, source: `依 ${year} 年基本工資 ${minWage} 元自動推算（請核對官方公告）` };
}
// 從勞保局「保險費分擔金額表」Excel 內容（二維陣列）找出投保薪資級距：取 2 萬～5 萬之間、百元整數的金額
function parseLaborGradesFromSheet(rows) {
  const nums = new Set();
  for (const row of rows || []) for (const cell of row || []) {
    const n = Number(String(cell ?? '').replace(/[,\s元]/g, ''));
    if (Number.isFinite(n) && n >= 20000 && n <= 50000 && n % 100 === 0) nums.add(n);
  }
  const list = [...nums].sort((a, b) => a - b);
  if (list.length < 8 || list.length > 20) return null;
  return list;
}
function validateTable(t) {
  const errs = [];
  for (const k of ['labor', 'occupational', 'health', 'pension']) {
    const l = t[k];
    if (!Array.isArray(l) || l.length < 3) { errs.push(`${k} 級距數量不足`); continue; }
    if (l.some((g, i) => !Number.isFinite(g) || g <= 0 || (i && g <= l[i - 1]))) errs.push(`${k} 級距必須由小到大`);
  }
  if (!(t.year >= 2020 && t.year <= 2100)) errs.push('年度不正確');
  const r = t.rates || {};
  for (const k of ['labor_ordinary', 'employment', 'labor_employee', 'labor_employer', 'occupational', 'health', 'health_employee', 'health_employer', 'health_avg_dependents', 'pension_employer']) if (!(Number(r[k]) >= 0 && Number(r[k]) < 2)) errs.push(`費率 ${k} 不正確`);
  return errs;
}

module.exports = function createInsuranceTables({ fs, path, DATA_DIR, XLSX }) {
  const FILE = path.join(DATA_DIR, 'insurance-tables.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')) || {}; } catch { return {}; } };
  const write = d => fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf-8');
  // 已啟用的表：內建＋總後台確認過的
  function all() {
    const saved = read(); const out = { ...BUILTIN };
    for (const [y, t] of Object.entries(saved.tables || {})) out[y] = t;
    return out;
  }
  function forMonth(ym) {
    const year = Number(String(ym || '').slice(0, 4)) || new Date().getFullYear();
    const tabs = all(); const years = Object.keys(tabs).map(Number).sort((a, b) => a - b);
    const y = [...years].reverse().find(x => x <= year) ?? years[0];
    return { ...tabs[y], exact: y === year };
  }
  function saveTable(t, by) {
    const errs = validateTable(t); if (errs.length) { const e = new Error(errs.join('；')); e.status = 400; throw e; }
    const d = read(); d.tables = d.tables || {};
    d.tables[t.year] = { ...t, updated_at: new Date().toISOString(), updated_by: by || '' };
    if (d.pending && Number(d.pending.year) === Number(t.year)) delete d.pending;
    d.log = [{ at: new Date().toISOString(), by: by || '', text: `套用 ${t.year} 年級距表` }, ...(d.log || [])].slice(0, 50);
    write(d); return d.tables[t.year];
  }
  function removeTable(year) { const d = read(); if (d.tables) delete d.tables[year]; write(d); }
  function status() {
    const d = read(); const tabs = all(); const now = new Date(Date.now() + 8 * 3600e3); const y = now.getUTCFullYear();
    const nextNeeded = now.getUTCMonth() >= 10 && !tabs[y + 1]; // 11、12 月提醒準備明年度
    return { years: Object.keys(tabs).map(Number).sort((a, b) => b - a), current: forMonth(`${y}-01`), current_exact: !!tabs[y], next_needed: nextNeeded, pending: d.pending || null, log: d.log || [], last_check: d.last_check || null };
  }
  // 自動檢查：到勞保局下載最新「一般單位保險費分擔金額表」，讀出新年度的基本工資級距；
  // 找到後建立「待確認」版本（健保、勞退、職災依基本工資推算），由總後台確認套用。
  async function autoCheck({ force = false } = {}) {
    const d = read(); const now = new Date(Date.now() + 8 * 3600e3); const y = now.getUTCFullYear();
    const target = now.getUTCMonth() >= 10 ? y + 1 : y; // 11 月起找明年度
    const tabs = all();
    if (!force && (tabs[target] || (d.pending && Number(d.pending.year) === target))) return { skipped: true, reason: '已有該年度級距表' };
    const result = { at: new Date().toISOString(), target };
    try {
      if (typeof fetch !== 'function') throw new Error('伺服器不支援網路下載');
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
      const page = await (await fetch('https://www.bli.gov.tw/0011588.html', { signal: ctl.signal })).text();
      const roc = target - 1911;
      const m = page.match(new RegExp(`${roc}年1月1日[^<]{0,80}[\\s\\S]{0,1500}?href="([^"]+\\.xlsx?)"`));
      if (!m) throw new Error(`勞保局尚未公告 ${roc} 年分擔金額表`);
      const url = new URL(m[1].replace(/&amp;/g, '&'), 'https://www.bli.gov.tw/').toString();
      const buf = Buffer.from(await (await fetch(url, { signal: ctl.signal })).arrayBuffer());
      clearTimeout(timer);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      const labor = parseLaborGradesFromSheet(rows);
      if (!labor) throw new Error('無法從官方檔案辨識級距，請手動輸入');
      const prevYear = Object.keys(tabs).map(Number).filter(x => x < target).sort((a, b) => b - a)[0];
      const prev = tabs[prevYear] || BUILTIN[2026];
      const cand = deriveForMinWage(prev, target, labor[0]);
      cand.labor = labor; cand.source = `勞保局 ${roc} 年分擔金額表自動讀取（${url}）；健保、勞退、職災依基本工資 ${labor[0]} 元推算，請核對`;
      if (validateTable(cand).length) throw new Error('自動讀取的級距格式不正確');
      d.pending = cand; result.ok = true; result.text = `找到 ${target} 年級距（基本工資 ${labor[0]} 元），等待確認`;
    } catch (e) { result.ok = false; result.text = e.name === 'AbortError' ? '連線逾時' : (e.message || '自動檢查失敗'); }
    d.last_check = result; write(d);
    return result;
  }
  function confirmPending(by) { const d = read(); if (!d.pending) { const e = new Error('沒有待確認的級距表'); e.status = 400; throw e; } return saveTable(d.pending, by); }
  function derive(year, minWage) {
    const tabs = all(); const prevYear = Object.keys(tabs).map(Number).filter(x => x < year).sort((a, b) => b - a)[0];
    return deriveForMinWage(tabs[prevYear] || BUILTIN[2026], year, minWage);
  }
  // 每天檢查一次（11 月～2 月），伺服器啟動 1 分鐘後先跑一次
  function startScheduler() {
    const tick = () => { const m = new Date(Date.now() + 8 * 3600e3).getUTCMonth(); if (m >= 10 || m <= 1) autoCheck().catch(() => {}); };
    setTimeout(tick, 60 * 1000).unref?.(); setInterval(tick, 24 * 3600 * 1000).unref?.();
  }
  return { all, forMonth, saveTable, removeTable, status, autoCheck, confirmPending, derive, startScheduler };
};
Object.assign(module.exports, { BUILTIN, gradeFor, computeInsurance, suggestGrades, deriveForMinWage, parseLaborGradesFromSheet, validateTable });
