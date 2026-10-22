// 會計基礎資料：預設會計科目（依商業會計處理準則常用科目簡化）、傳票匯出格式、統編檢查
'use strict';

// type: asset 資產、liability 負債、equity 權益、revenue 收入、cost 營業成本、expense 營業費用、other_income 營業外收入、other_expense 營業外支出、tax 所得稅
// key: 系統自動入帳時使用（公司可以改代號、名稱，但 key 不變）
const ACCOUNTS = [
  ['1101', '現金', 'asset', 'cash'], ['1102', '零用金', 'asset', 'petty_cash'], ['1103', '銀行存款', 'asset', 'bank'],
  ['1151', '應收票據', 'asset', 'notes_receivable'], ['1171', '應收帳款', 'asset', 'ar'], ['1172', '備抵損失－應收帳款', 'asset', 'ar_allowance'],
  ['1191', '其他應收款', 'asset', 'other_receivable'], ['1251', '預付費用', 'asset', 'prepaid_expense'], ['1261', '預付款項', 'asset', 'prepayment'],
  ['1268', '進項稅額', 'asset', 'input_vat'], ['1269', '留抵稅額', 'asset', 'vat_credit'], ['1281', '暫付款', 'asset', 'temp_payment'], ['1291', '員工借支', 'asset', 'staff_advance'],
  ['1411', '辦公設備', 'asset', 'office_equipment'], ['1412', '累計折舊－辦公設備', 'asset', 'accum_dep_office'],
  ['1421', '機器設備', 'asset', 'machinery'], ['1422', '累計折舊－機器設備', 'asset', 'accum_dep_machinery'],
  ['1431', '運輸設備', 'asset', 'vehicles'], ['1432', '累計折舊－運輸設備', 'asset', 'accum_dep_vehicles'],
  ['1531', '存出保證金', 'asset', 'deposit_out'],
  ['2101', '短期借款', 'liability', 'short_loan'], ['2141', '應付票據', 'liability', 'notes_payable'], ['2171', '應付帳款', 'liability', 'ap'],
  ['2191', '應付費用', 'liability', 'accrued_expense'], ['2192', '應付薪資', 'liability', 'salary_payable'], ['2193', '應付勞健保', 'liability', 'insurance_payable'],
  ['2194', '應付勞退提撥', 'liability', 'pension_payable'], ['2195', '應付社區回饋金', 'liability', 'feedback_payable'],
  ['2204', '銷項稅額', 'liability', 'output_vat'], ['2205', '應付營業稅', 'liability', 'vat_payable'], ['2261', '預收款項', 'liability', 'advance_receipt'],
  ['2281', '代收款', 'liability', 'collections_for_others'], ['2282', '代扣款項', 'liability', 'withholding'], ['2291', '暫收款', 'liability', 'temp_receipt'], ['2341', '存入保證金', 'liability', 'deposit_in'],
  ['3101', '資本（股本）', 'equity', 'capital'], ['3351', '累積盈虧', 'equity', 'retained_earnings'], ['3353', '本期損益', 'equity', 'current_pl'],
  ['4101', '物業管理服務收入', 'revenue', 'rev_property'], ['4102', '保全服務收入', 'revenue', 'rev_security'], ['4103', '清潔服務收入', 'revenue', 'rev_cleaning'],
  ['4104', '工程維修收入', 'revenue', 'rev_maintenance'], ['4109', '其他營業收入', 'revenue', 'rev_other'], ['4171', '服務收入折讓', 'revenue', 'rev_allowance'],
  ['5101', '勞務成本－派駐人員薪資', 'cost', 'cost_salary'], ['5102', '勞務成本－外包清潔', 'cost', 'cost_cleaning_outsource'], ['5103', '勞務成本－外包保全', 'cost', 'cost_security_outsource'],
  ['5104', '勞務成本－勞健保', 'cost', 'cost_insurance'], ['5105', '勞務成本－勞退提撥', 'cost', 'cost_pension'], ['5106', '勞務成本－加班費', 'cost', 'cost_overtime'],
  ['5111', '社區回饋支出', 'cost', 'cost_feedback'], ['5121', '耗材物料', 'cost', 'cost_supplies'], ['5131', '工程維修成本', 'cost', 'cost_maintenance'],
  ['6101', '薪資支出', 'expense', 'exp_salary'], ['6102', '租金支出', 'expense', 'exp_rent'], ['6103', '文具用品', 'expense', 'exp_stationery'], ['6104', '旅費', 'expense', 'exp_travel'],
  ['6105', '運費', 'expense', 'exp_freight'], ['6106', '郵電費', 'expense', 'exp_telecom'], ['6107', '修繕費', 'expense', 'exp_repair'], ['6108', '廣告費', 'expense', 'exp_ads'],
  ['6109', '水電瓦斯費', 'expense', 'exp_utilities'], ['6110', '保險費', 'expense', 'exp_insurance'], ['6111', '交際費', 'expense', 'exp_entertainment'], ['6112', '捐贈', 'expense', 'exp_donation'],
  ['6113', '稅捐', 'expense', 'exp_tax'], ['6114', '預期信用減損損失', 'expense', 'exp_bad_debt'], ['6115', '折舊', 'expense', 'exp_depreciation'], ['6116', '各項攤提', 'expense', 'exp_amortization'],
  ['6117', '伙食費', 'expense', 'exp_meals'], ['6118', '職工福利', 'expense', 'exp_welfare'], ['6119', '勞務費', 'expense', 'exp_professional'], ['6120', '訓練費', 'expense', 'exp_training'],
  ['6121', '退休金（勞退提撥）', 'expense', 'exp_pension'], ['6122', '加班費', 'expense', 'exp_overtime'], ['6123', '勞健保費', 'expense', 'exp_labor_insurance'], ['6199', '其他費用', 'expense', 'exp_other'],
  ['7101', '利息收入', 'other_income', 'interest_income'], ['7191', '其他收入', 'other_income', 'other_income'],
  ['7501', '利息支出', 'other_expense', 'interest_expense'], ['7891', '其他損失', 'other_expense', 'other_loss'],
  ['8101', '所得稅費用', 'tax', 'income_tax'],
];
const TYPES = { asset: '資產', liability: '負債', equity: '權益', revenue: '營業收入', cost: '營業成本', expense: '營業費用', other_income: '營業外收入', other_expense: '營業外支出', tax: '所得稅' };
// 借方餘額為正的類型
const DEBIT_NORMAL = new Set(['asset', 'cost', 'expense', 'other_expense', 'tax']);
// 備抵、累計折舊屬於資產的減項（貸方餘額）
const CONTRA = new Set(['ar_allowance', 'accum_dep_office', 'accum_dep_machinery', 'accum_dep_vehicles', 'rev_allowance']);

// ---------- 傳票匯出格式 ----------
// 欄位：可以自由排序；日期格式、借貸表示方式、編碼、檔案類型可設定。
// 預設值只是常見的匯入欄位，正式使用前請依各軟體的「傳票匯入」規格確認，總後台可以調整後開通。
const FIELDS = {
  date: '傳票日期', no: '傳票號碼', type: '傳票類別', seq: '分錄序號', code: '科目代號', name: '科目名稱', summary: '摘要', memo: '分錄說明',
  debit: '借方金額', credit: '貸方金額', dc: '借貸別', amount: '金額', dept: '部門（社區）代號', dept_name: '部門（社區）名稱', party: '往來對象', party_tax_id: '對象統編', entity_tax_id: '公司統編',
};
const PRESETS = {
  generic: { name: '通用 CSV（UTF-8）', columns: ['date', 'no', 'type', 'seq', 'code', 'name', 'summary', 'debit', 'credit', 'dept_name', 'party', 'party_tax_id'], date: 'ad_dash', dc_style: 'columns', encoding: 'utf8bom', file: 'csv', header: true },
  excel: { name: 'Excel（xlsx）', columns: ['date', 'no', 'type', 'seq', 'code', 'name', 'summary', 'debit', 'credit', 'dept_name', 'party', 'party_tax_id'], date: 'ad_dash', dc_style: 'columns', encoding: 'utf8bom', file: 'xlsx', header: true },
  wenzhong: { name: '文中', columns: ['date', 'no', 'seq', 'code', 'summary', 'debit', 'credit', 'dept'], date: 'roc_slash', dc_style: 'columns', encoding: 'big5', file: 'csv', header: true },
  digiwin: { name: '鼎新', columns: ['date', 'no', 'seq', 'dc', 'code', 'amount', 'summary', 'dept'], date: 'ad_compact', dc_style: 'flag12', encoding: 'big5', file: 'csv', header: true },
  chiper: { name: '正航', columns: ['date', 'no', 'seq', 'code', 'dc', 'amount', 'summary', 'dept', 'party'], date: 'ad_slash', dc_style: 'flag_cn', encoding: 'big5', file: 'csv', header: true },
  tianxin: { name: '天心', columns: ['date', 'no', 'seq', 'code', 'summary', 'debit', 'credit', 'dept'], date: 'roc_compact', dc_style: 'columns', encoding: 'big5', file: 'csv', header: true },
};
const DATE_FORMATS = { ad_dash: '2026-10-22', ad_slash: '2026/10/22', ad_compact: '20261022', roc_slash: '115/10/22', roc_compact: '1151022' };
const DC_STYLES = { columns: '借方、貸方兩欄', flag12: '借貸別 1＝借、2＝貸＋金額', flag_cn: '借貸別「借／貸」＋金額', flag_dc: '借貸別 D／C＋金額', signed: '金額正負（借正貸負）' };
const ENCODINGS = { utf8bom: 'UTF-8（含 BOM）', utf8: 'UTF-8', big5: 'Big5（舊版 Windows 軟體）' };

function fmtDate(d, f) {
  const [y, m, dd] = String(d).split('-'); const roc = String(Number(y) - 1911);
  return { ad_dash: `${y}-${m}-${dd}`, ad_slash: `${y}/${m}/${dd}`, ad_compact: `${y}${m}${dd}`, roc_slash: `${roc}/${m}/${dd}`, roc_compact: `${roc.padStart(3, '0')}${m}${dd}` }[f] || `${y}-${m}-${dd}`;
}

// 營利事業統一編號檢查（財政部 2023 年起：加權和可被 5 整除；第 7 碼為 7 時另有規則）
function validTaxId(v) {
  const s = String(v || '').trim(); if (!/^\d{8}$/.test(s)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1]; let sum = 0;
  for (let i = 0; i < 8; i++) { const p = Number(s[i]) * w[i]; sum += Math.floor(p / 10) + (p % 10); }
  if (sum % 5 === 0) return true;
  return s[6] === '7' && (sum + 1) % 5 === 0;
}

module.exports = { ACCOUNTS, TYPES, DEBIT_NORMAL, CONTRA, FIELDS, PRESETS, DATE_FORMATS, DC_STYLES, ENCODINGS, fmtDate, validTaxId };
