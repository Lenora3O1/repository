// 請假規則：法定最低標準（勞基法、勞工請假規則、性別平等工作法）與各公司客製化設定。
// 公司設定只能「優於」法定（給薪比例、天數不得低於法定），存檔時會自動補足並回報。
'use strict';

// pay：給薪比例（1 全薪、0.5 半薪、0 不給薪）；quota：天數上限（per：year 每年、event 每次事由、month 每月）
// proof：none 不需證明、optional 可附、required 需要證明；att：全勤獎金 none 不得扣、prorate 按比例、all 整筆、company 由公司決定
const TYPES = {
  annual:    { name: '特休', pay: 1, quota: null, per: 'period', proof: 'none', reason: false, att: 'none', hint: '依年資自動計算（勞基法第 38 條）' },
  personal:  { name: '事假', pay: 0, quota: 14, per: 'year', proof: 'optional', reason: true, att: 'company', hint: '一年合計 14 日（含家庭照顧假），不給薪' },
  family:    { name: '家庭照顧假', pay: 0, quota: 7, per: 'year', proof: 'optional', reason: true, att: 'none', hourly: true, hint: '一年 7 日，併入事假計算，可以小時請假，不得扣全勤' },
  sick:      { name: '病假', pay: 0.5, quota: 30, per: 'year', proof: 'required', reason: true, att: 'prorate', subs: [['outpatient', '未住院'], ['hospital', '住院']], hint: '未住院一年 30 日內半薪；全勤獎金只能按比例扣' },
  menstrual: { name: '生理假', pay: 0.5, quota: 1, per: 'month', proof: 'none', proofLocked: true, reason: false, att: 'none', female: true, hint: '每月 1 日，半薪，不需證明；全年前 3 日不併入病假' },
  marriage:  { name: '婚假', pay: 1, quota: 8, per: 'event', proof: 'required', reason: false, att: 'none', event: '結婚日期', hint: '8 日全薪' },
  funeral:   { name: '喪假', pay: 1, quota: null, per: 'event', proof: 'required', reason: false, att: 'none', event: '死亡日期', hint: '依親屬關係 8／6／3 日，全薪，可分次請' },
  official:  { name: '公假', pay: 1, quota: null, per: null, proof: 'required', reason: true, att: 'none', hint: '依實際需要，全薪' },
  injury:    { name: '公傷病假', pay: 1, quota: null, per: null, proof: 'required', reason: true, att: 'none', hint: '職業災害醫療期間，公司補償原領工資' },
  maternity: { name: '產假', pay: 1, quota: null, per: 'event', proof: 'required', reason: false, att: 'none', female: true, calendar: true, event: '分娩／流產日期', hint: '年資滿 6 個月全薪，未滿半薪；產假依日曆天連續計算' },
  prenatal:  { name: '產檢假', pay: 1, quota: 7, per: 'event', proof: 'required', reason: false, att: 'none', female: true, event: '預產期', hint: '妊娠期間 7 日，全薪' },
  paternity: { name: '陪產檢及陪產假', pay: 1, quota: 7, per: 'event', proof: 'required', reason: false, att: 'none', event: '預產期／分娩日', hint: '7 日，全薪' },
  comp:      { name: '補休', pay: 1, quota: null, per: null, proof: 'none', reason: false, att: 'none', hint: '使用加班換得的補休時數（公司選擇「加班換補休」時開放）' },
};
// 勞工請假規則第 3 條
const FUNERAL = [
  ['parent', '父母、養父母、繼父母、配偶', 8],
  ['grand', '祖父母、子女、配偶之父母、配偶之養父母或繼父母', 6],
  ['great', '曾祖父母、兄弟姊妹、配偶之祖父母', 3],
];
// 性別平等工作法第 15 條
const MATERNITY = [
  ['birth', '分娩（產假 8 週）', 56],
  ['m3', '妊娠 3 個月以上流產（4 週）', 28],
  ['m2', '妊娠 2 個月以上未滿 3 個月流產（1 週）', 7],
  ['m1', '妊娠未滿 2 個月流產（5 日）', 5],
];
const LEGAL_ORDER = Object.keys(TYPES);
// 加班種類（平台預設，總後台可依公司修改）
// calc：law_rest 休息日倍率、law_holiday 國定假日加倍、law_weekday 平日倍率、hourly 時薪、daily 日薪比例、allowance_time 每次固定金額、allowance_hour 每小時固定金額
// comp：pay 給錢、comp 換補休、choose 由本人選擇（依法以補休代替須本人同意）
const OT_CALC = { law_rest: '休息日加班費（前 2 小時 1.34 倍、3～8 小時 1.67 倍、9 小時起 2.67 倍）', law_holiday: '國定假日出勤（加倍發給）', law_weekday: '平日加班費（前 2 小時 1.34 倍、之後 1.67 倍）', hourly: '依時薪計算', daily: '依日薪計算（以時數比例）', allowance_time: '每次固定支援費', allowance_hour: '每小時固定支援費' };
const OT_DEFAULTS = [
  { id: 'rest_day', name: '休假日被請回', calc: 'law_rest', comp: 'choose', amount: 0, enabled: true, hint: '休假日被公司請回來上班或幫忙代班' },
  { id: 'holiday', name: '國定假日出勤', calc: 'law_holiday', comp: 'choose', amount: 0, enabled: true, hint: '國定假日被請回來上班' },
  { id: 'meeting', name: '社區夜間會議', calc: 'law_weekday', comp: 'choose', amount: 0, enabled: true, hint: '區權會、月例會等下班後的會議，依時數' },
  { id: 'voluntary', name: '自願加班', calc: 'daily', comp: 'pay', amount: 0, enabled: true, hint: '本人想多上班（例如保全多上幾天），需主管核准' },
];

function defaults() {
  return {
    unit: 'day',               // 最小請假單位：day 一日、half 半日、hour 一小時
    hours_per_day: 8,
    proof_days: 7,             // 證明補交期限（請假結束或送出後幾日內）
    overdue_action: 'absent',  // 逾期未補：absent 視為曠職、remind 只提醒
    daily_wage_mode: 'month30', // month30 月薪÷30；workdays 月薪÷當月應出勤日（扣除例假、國定假日）
    wage_includes_allowances: true, // 日薪是否含固定加給（經常性給與）
    overtime_mode: 'pay',      // pay 時數加班費、allowance 車馬費／支援費、comp 加班換補休
    overtime_allowance: { name: '支援費', unit: 'time', amount: 0 }, // allowance：每次或每小時固定金額
    overtime_auto: true,       // 依加班紀錄自動計算加班費（平日費率）
    overtime_types: OT_DEFAULTS.map(x => ({ ...x })),
    attendance: { enabled: false, name: '全勤獎金', personal: 'prorate' },
    types: {},                 // 各法定假別的優於法定設定
    custom: [],                // 公司自訂假別（例如生日假）
    // by：site 現場主管（沒有則直屬主管）、dept 職務主管、region 區域督導、direct 直屬主管、position 指定職位、people 指定人員
    // 補打卡：每月上限（0＝不限）、可以補幾天內的卡、審核流程（依組織架構自動找審核人）
    punch_fix: { enabled: true, monthly_limit: 3, days_back: 7, flow: [{ id: 'pf_direct', name: '直屬主管', by: 'direct' }] },
    // 借支（預支薪資）：本人申請 → 審核 → 會計確認撥款 → 當月薪資一次扣回
    // ratio_den：最多借本月已賺薪資的 1/N（0＝不限）；amounts：只能選的金額（空＝不限）；monthly_limit：每月幾次（0＝不限）
    advance: { enabled: true, ratio_den: 0, amounts: [], monthly_limit: 1, min_days: 0, after_trial: false, deadline_day: 0, flow: [{ id: 'adv_direct', name: '直屬主管', by: 'direct' }, { id: 'adv_acct', name: '會計', by: 'position', position: 'accountant' }] },
    flow: [
      { id: 'site', name: '現場主管', by: 'site', min_days: 0 },
      { id: 'dept', name: '職務主管', by: 'dept', min_days: 0 },
      { id: 'acct', name: '會計', by: 'position', position: 'accountant', min_days: 0 },
      { id: 'gm', name: '總經理', by: 'position', position: 'gm', min_days: 0 },
    ],
  };
}

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clampRatio = v => Math.max(0, Math.min(1, Math.round(num(v) * 100) / 100));
const str = (v, m = 30) => String(v ?? '').trim().slice(0, m);
const id = () => Math.random().toString(36).slice(2, 9);

// 整理並驗證設定；回傳 { policy, notes }，notes 是被自動補足到法定標準的項目
function normalize(input) {
  const d = defaults(); const b = input && typeof input === 'object' ? input : {}; const notes = [];
  const p = {
    unit: ['day', 'half', 'hour'].includes(b.unit) ? b.unit : d.unit,
    hours_per_day: Math.max(1, Math.min(12, Math.round(num(b.hours_per_day, 8) * 2) / 2)) || 8,
    proof_days: Math.max(1, Math.min(60, Math.round(num(b.proof_days, 7)))) || 7,
    overdue_action: b.overdue_action === 'remind' ? 'remind' : 'absent',
    daily_wage_mode: b.daily_wage_mode === 'workdays' ? 'workdays' : 'month30',
    wage_includes_allowances: b.wage_includes_allowances !== false,
    overtime_mode: ['comp', 'allowance'].includes(b.overtime_mode) ? b.overtime_mode : 'pay',
    overtime_allowance: { name: str(b.overtime_allowance?.name, 12) || '支援費', unit: b.overtime_allowance?.unit === 'hour' ? 'hour' : 'time', amount: Math.max(0, Math.min(100000, Math.round(num(b.overtime_allowance?.amount)))) },
    overtime_auto: b.overtime_auto !== false,
    overtime_types: (() => { const src = Array.isArray(b.overtime_types) && b.overtime_types.length ? b.overtime_types : OT_DEFAULTS; const seen = new Set(); const out = [];
      for (const x of src.slice(0, 12)) { const name = str(x?.name, 16); if (!name) continue; let oid = typeof x?.id === 'string' && /^[a-z0-9_]{2,20}$/.test(x.id) ? x.id : `o_${id()}`; while (seen.has(oid)) oid = `o_${id()}`; seen.add(oid);
        out.push({ id: oid, name, calc: OT_CALC[x?.calc] ? x.calc : 'law_weekday', comp: ['pay', 'comp', 'choose'].includes(x?.comp) ? x.comp : 'pay', amount: Math.max(0, Math.min(100000, Math.round(num(x?.amount)))), enabled: x?.enabled !== false, hint: str(x?.hint, 60) }); }
      return out; })(),
    attendance: { enabled: !!b.attendance?.enabled, name: str(b.attendance?.name, 20) || '全勤獎金', personal: b.attendance?.personal === 'all' ? 'all' : 'prorate' },
    types: {}, custom: [], flow: [],
  };
  for (const k of LEGAL_ORDER) {
    const L = TYPES[k]; const x = (b.types && b.types[k]) || {}; const o = {};
    if (x.pay !== undefined && x.pay !== null && x.pay !== '') { let v = clampRatio(x.pay); if (v < L.pay) { notes.push(`${L.name}給薪比例不得低於法定 ${L.pay * 100}%，已改回法定`); v = L.pay; } if (v !== L.pay) o.pay = v; }
    if (L.quota && x.quota !== undefined && x.quota !== null && x.quota !== '') { let v = Math.max(0, Math.round(num(x.quota) * 2) / 2); if (v < L.quota) { notes.push(`${L.name}天數不得少於法定 ${L.quota} 日，已改回法定`); v = L.quota; } if (v !== L.quota) o.quota = Math.min(v, 365); }
    if (!L.proofLocked && ['none', 'optional', 'required'].includes(x.proof) && x.proof !== L.proof) o.proof = x.proof;
    if (L.reason === false && x.reason === true) o.reason = true; // 法定必填原因的假別不能取消
    if (k === 'sick') { const f = Math.max(0, Math.min(30, Math.round(num(x.full_pay_days)))); if (f) o.full_pay_days = f; }
    if (Object.keys(o).length) p.types[k] = o;
  }
  for (const c of (Array.isArray(b.custom) ? b.custom : []).slice(0, 12)) {
    const name = str(c?.name, 12); if (!name) continue;
    p.custom.push({ id: typeof c?.id === 'string' && /^c_[a-z0-9]{3,12}$/.test(c.id) ? c.id : `c_${id()}`, name, pay: clampRatio(c?.pay ?? 1), quota: Math.max(0, Math.min(365, Math.round(num(c?.quota) * 2) / 2)), per: c?.per === 'event' ? 'event' : 'year', proof: ['none', 'optional', 'required'].includes(c?.proof) ? c.proof : 'none', reason: !!c?.reason, att: ['none', 'prorate', 'all'].includes(c?.att) ? c.att : 'none', enabled: c?.enabled !== false, hint: str(c?.hint, 60) });
  }
  const seen = new Set();
  for (const s of (Array.isArray(b.flow) ? b.flow : d.flow).slice(0, 8)) {
    const name = str(s?.name, 12); if (!name) continue;
    let sid = typeof s?.id === 'string' && /^[a-z0-9_]{2,16}$/.test(s.id) ? s.id : `s_${id()}`; while (seen.has(sid)) sid = `s_${id()}`; seen.add(sid);
    const by = ['site', 'dept', 'region', 'direct', 'position', 'people'].includes(s?.by) ? s.by : 'people'; // 舊設定（只有 scope）視為指定人員
    p.flow.push({ id: sid, name, by, position: by === 'position' ? str(s?.position, 24) : '', scope: s?.scope === 'community' ? 'community' : 'company', min_days: Math.max(0, Math.min(60, Math.round(num(s?.min_days) * 2) / 2)) });
  }
  { const x = b.punch_fix && typeof b.punch_fix === 'object' ? b.punch_fix : d.punch_fix; const pf = { enabled: x.enabled !== false, monthly_limit: Math.max(0, Math.min(31, Math.round(num(x.monthly_limit, 3)))), days_back: Math.max(1, Math.min(31, Math.round(num(x.days_back, 7)))) || 7, flow: [] };
    const seen2 = new Set();
    for (const s of (Array.isArray(x.flow) ? x.flow : d.punch_fix.flow).slice(0, 5)) {
      const name = str(s?.name, 12); if (!name) continue;
      let sid = typeof s?.id === 'string' && /^[a-z0-9_]{2,16}$/.test(s.id) ? s.id : `pf_${id()}`; while (seen2.has(sid)) sid = `pf_${id()}`; seen2.add(sid);
      const by = ['site', 'dept', 'region', 'direct', 'position'].includes(s?.by) ? s.by : 'direct';
      pf.flow.push({ id: sid, name, by, position: by === 'position' ? str(s?.position, 24) : '' });
    }
    if (!pf.flow.length) pf.flow = d.punch_fix.flow.map(s => ({ ...s, position: '' }));
    p.punch_fix = pf; }
  { const x = b.advance && typeof b.advance === 'object' ? b.advance : d.advance;
    const amounts = (Array.isArray(x.amounts) ? x.amounts : String(x.amounts || '').split(/[,，、\s]+/)).map(v => Math.round(num(v))).filter(v => v > 0 && v <= 1000000);
    const adv = { enabled: x.enabled !== false, ratio_den: [0, 2, 3, 4, 5].includes(Math.round(num(x.ratio_den))) ? Math.round(num(x.ratio_den)) : 0, amounts: [...new Set(amounts)].sort((a, c) => a - c).slice(0, 10),
      monthly_limit: Math.max(0, Math.min(10, Math.round(num(x.monthly_limit, 1)))), min_days: Math.max(0, Math.min(365, Math.round(num(x.min_days)))), after_trial: !!x.after_trial,
      deadline_day: Math.max(0, Math.min(28, Math.round(num(x.deadline_day)))), flow: [] };
    const seen3 = new Set();
    for (const s of (Array.isArray(x.flow) ? x.flow : d.advance.flow).slice(0, 5)) {
      const name = str(s?.name, 12); if (!name) continue;
      let sid = typeof s?.id === 'string' && /^[a-z0-9_]{2,16}$/.test(s.id) ? s.id : `adv_${id()}`; while (seen3.has(sid)) sid = `adv_${id()}`; seen3.add(sid);
      const by = ['site', 'dept', 'region', 'direct', 'position'].includes(s?.by) ? s.by : 'direct';
      adv.flow.push({ id: sid, name, by, position: by === 'position' ? str(s?.position, 24) : '' });
    }
    if (!adv.flow.length) adv.flow = d.advance.flow.map(s => ({ ...s, position: s.position || '' }));
    p.advance = adv; }
  return { policy: p, notes };
}

// 公司可用的假別（合併法定與公司設定）
function typeList(policy) {
  const out = [];
  for (const k of LEGAL_ORDER) {
    if (k === 'comp' && policy.overtime_mode !== 'comp' && !(policy.overtime_types || []).some(o => o.enabled && o.comp !== 'pay')) continue;
    const L = TYPES[k]; const o = policy.types[k] || {};
    out.push({ key: k, name: L.name, legal: true, pay: o.pay ?? L.pay, legal_pay: L.pay, quota: o.quota ?? L.quota, legal_quota: L.quota, per: L.per, proof: L.proofLocked ? 'none' : (o.proof || L.proof), proof_locked: !!L.proofLocked, reason: L.reason || !!o.reason, reason_locked: !!L.reason, att: L.att === 'company' ? policy.attendance.personal : L.att, female: !!L.female, calendar: !!L.calendar, event: L.event || '', hourly: !!L.hourly, subs: k === 'funeral' ? FUNERAL.map(([v, l, n]) => ({ value: v, label: `${l}（${n} 日）`, days: n })) : k === 'maternity' ? MATERNITY.map(([v, l, n]) => ({ value: v, label: l, days: n })) : (L.subs || []).map(([v, l]) => ({ value: v, label: l })), full_pay_days: k === 'sick' ? (o.full_pay_days || 0) : 0, hint: L.hint });
  }
  for (const c of policy.custom) if (c.enabled) out.push({ key: c.id, name: c.name, legal: false, pay: c.pay, legal_pay: 0, quota: c.quota || null, legal_quota: null, per: c.quota ? c.per : null, proof: c.proof, reason: c.reason, att: c.att, female: false, calendar: false, event: c.per === 'event' && c.quota ? '事由日期' : '', hourly: false, subs: [], hint: c.hint || '公司福利假' });
  return out;
}

module.exports = { OT_CALC, OT_DEFAULTS, TYPES, FUNERAL, MATERNITY, LEGAL_ORDER, defaults, normalize, typeList };
