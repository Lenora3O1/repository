// 工作日誌：平台預設範本（總後台「中央表單設計中心 → 工作日誌設計」）。
// 範本決定：預設日誌類型、每日／每週要記錄的區塊（開關、名稱、順序）、抄表項目、記事職務、
// 待辦追蹤分類、自訂紀錄項目。各社區沒有自行調整的部分一律沿用這份範本。
'use strict';

const DEFAULT_METERS = [
  { key: 'water', label: '自來水表' }, { key: 'public_power', label: '大公電表' },
  { key: 'a_power', label: 'A棟小公電表' }, { key: 'b_power', label: 'B棟小公電表' }, { key: 'door', label: '鐵捲門次數表' },
];
const DEFAULT_ROLES = ['總幹事', '秘書'];
const DEFAULT_CATEGORIES = [
  { key: 'committee', label: '管理委員會' }, { key: 'resident', label: '住戶交辦事項與問題處置' },
  { key: 'center', label: '管理中心待辦事項' }, { key: 'facility', label: '公共設施相關修繕' },
];
// 區塊：key 對應程式內建的內容；parts 是區塊內可以個別開關的小項目
const DAILY_SECTIONS = [
  { key: 'notes', label: '案場重要記事', hint: '依職務各自填寫本日工作內容' },
  { key: 'construction', label: '施工管制', parts: { stats: '專有戶／公共區域施工統計', renovations: '裝潢戶清單（保證金、清潔費、消防探測器）' } },
  { key: 'staffing', label: '人員管制', hint: '依班表自動帶入當日出勤' },
  { key: 'meters', label: '社區巡檢狀況', hint: '水電表抄表，自動計算使用量' },
  { key: 'record', label: '本日工作記錄與交辦事項', parts: { overview: '社區概況說明（戶數、車位）', packages: '包裹／掛號／寄物未領統計' } },
  { key: 'tracking', label: '待辦追蹤事項及住戶反映事項', hint: '未結案事項會自動延續' },
  { key: 'custom', label: '其他紀錄項目', hint: '下方「自訂紀錄項目」中設定為每日使用的項目' },
  { key: 'extra', label: '其他事項', hint: '自由填寫' },
];
const WEEKLY_SECTIONS = [
  { key: 'summary', label: '本週重點摘要', hint: '給管委會快速掌握的 3～5 點' },
  { key: 'construction', label: '施工管制週統計', hint: '由每日日誌自動彙整' },
  { key: 'meters', label: '社區巡檢（水電用量）週報', hint: '本週與上週用量比較' },
  { key: 'tracking', label: '待辦追蹤週報', hint: '新增、結案、逾 30 天未結' },
  { key: 'staffing', label: '人員出勤週統計', hint: '依班表自動統計' },
  { key: 'custom', label: '其他紀錄項目', hint: '下方「自訂紀錄項目」中設定為每週使用的項目' },
  { key: 'committee', label: '需管委會決議／協助事項' },
  { key: 'next_week', label: '下週工作計畫' },
  { key: 'extra', label: '其他事項', hint: '自由填寫' },
];
const CUSTOM_TYPES = ['text', 'textarea', 'number', 'yesno', 'select', 'checklist'];

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const clone = x => JSON.parse(JSON.stringify(x));

function builtinSections(kind) { return kind === 'weekly' ? WEEKLY_SECTIONS : DAILY_SECTIONS; }
function defaultSections(kind) {
  return builtinSections(kind).map(s => ({ key: s.key, label: s.label, on: true, ...(s.parts ? { parts: Object.fromEntries(Object.keys(s.parts).map(k => [k, true])) } : {}) }));
}
function defaultTemplate() {
  return { mode: 'daily', meters: clone(DEFAULT_METERS), roles: clone(DEFAULT_ROLES), daily_sections: defaultSections('daily'), weekly_sections: defaultSections('weekly'), tracking_categories: clone(DEFAULT_CATEGORIES), custom_items: [] };
}
function slugKey(prefix, used) {
  let k; do { k = `${prefix}_${Math.random().toString(36).slice(2, 8)}`; } while (used.has(k));
  used.add(k); return k;
}
function cleanSections(list, kind) {
  const builtins = builtinSections(kind); const byKey = Object.fromEntries(builtins.map(s => [s.key, s]));
  const out = []; const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const b = byKey[s?.key]; if (!b || seen.has(b.key)) continue; seen.add(b.key);
    const item = { key: b.key, label: str(s.label, 40) || b.label, on: s.on !== false };
    if (b.parts) item.parts = Object.fromEntries(Object.keys(b.parts).map(k => [k, s.parts?.[k] !== false]));
    out.push(item);
  }
  // 之後新增的內建區塊自動補在最後（預設開啟），避免舊範本少了區塊
  for (const d of defaultSections(kind)) if (!seen.has(d.key)) out.push(d);
  return out;
}
function cleanMeters(list) {
  const used = new Set(); const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const label = str(m?.label, 40); if (!label) continue;
    let key = str(m?.key, 40).replace(/[^\w-]/g, '');
    if (!key || used.has(key)) key = slugKey('m', used); else used.add(key);
    out.push({ key, label });
  }
  return out.slice(0, 20);
}
function cleanRoles(list) { return [...new Set((Array.isArray(list) ? list : []).map(x => str(x, 20)).filter(Boolean))].slice(0, 10); }
function cleanCategories(list) {
  const used = new Set(); const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const label = str(c?.label, 40); if (!label) continue;
    let key = str(c?.key, 40).replace(/[^\w-]/g, '');
    if (!key || used.has(key)) key = slugKey('t', used); else used.add(key);
    out.push({ key, label });
  }
  return out.slice(0, 12);
}
function cleanCustomItems(list) {
  const used = new Set(); const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const label = str(c?.label, 60); if (!label) continue;
    let id = str(c?.id, 40).replace(/[^\w-]/g, '');
    if (!id || used.has(id)) id = slugKey('c', used); else used.add(id);
    const type = CUSTOM_TYPES.includes(c?.type) ? c.type : 'text';
    const item = { id, label, type, scope: ['daily', 'weekly', 'both'].includes(c?.scope) ? c.scope : 'daily' };
    const hint = str(c?.hint, 120); if (hint) item.hint = hint;
    if (type === 'select' || type === 'checklist') {
      const opts = (Array.isArray(c.options) ? c.options : String(c.options || '').split(/\r?\n/)).map(x => str(x, 40)).filter(Boolean);
      item.options = [...new Set(opts)].slice(0, 30);
      if (!item.options.length) item.options = ['已完成'];
    }
    out.push(item);
  }
  return out.slice(0, 40);
}
function normalizeTemplate(t) {
  const d = defaultTemplate(); t = t && typeof t === 'object' ? t : {};
  const meters = Array.isArray(t.meters) ? cleanMeters(t.meters) : d.meters;
  const roles = Array.isArray(t.roles) ? cleanRoles(t.roles) : d.roles;
  const cats = Array.isArray(t.tracking_categories) ? cleanCategories(t.tracking_categories) : d.tracking_categories;
  return {
    mode: t.mode === 'weekly' ? 'weekly' : 'daily',
    meters,
    roles: roles.length ? roles : d.roles,
    daily_sections: cleanSections(t.daily_sections || d.daily_sections, 'daily'),
    weekly_sections: cleanSections(t.weekly_sections || d.weekly_sections, 'weekly'),
    tracking_categories: cats.length ? cats : d.tracking_categories,
    custom_items: cleanCustomItems(t.custom_items),
    updated_at: str(t.updated_at, 40),
  };
}
function validateTemplate(t) {
  if (!t || typeof t !== 'object') return '範本格式錯誤';
  if (Array.isArray(t.roles) && !cleanRoles(t.roles).length) return '「案場重要記事」至少要有一個職務';
  if (Array.isArray(t.tracking_categories) && !cleanCategories(t.tracking_categories).length) return '待辦追蹤至少要有一個分類';
  const on = l => (Array.isArray(l) ? l : []).some(s => s && s.on !== false);
  if (Array.isArray(t.daily_sections) && !on(t.daily_sections)) return '每日日誌至少要開啟一個區塊';
  if (Array.isArray(t.weekly_sections) && !on(t.weekly_sections)) return '每週日誌至少要開啟一個區塊';
  return null;
}

module.exports = function createJournalTemplate({ fs, path, DATA_DIR }) {
  const FILE = path.join(DATA_DIR || __dirname, 'journal-template.json');
  let cache = null, cacheMtime = 0;
  function read() {
    try {
      if (!fs.existsSync(FILE)) return normalizeTemplate(null);
      const mtime = fs.statSync(FILE).mtimeMs;
      if (cache && mtime === cacheMtime) return clone(cache);
      cache = normalizeTemplate(JSON.parse(fs.readFileSync(FILE, 'utf-8'))); cacheMtime = mtime;
      return clone(cache);
    } catch (e) { console.error('journal template read error', e); return normalizeTemplate(null); }
  }
  function write(t) {
    const err = validateTemplate(t); if (err) { const e = new Error(err); e.status = 400; throw e; }
    const clean = normalizeTemplate({ ...t, updated_at: new Date().toISOString() });
    fs.writeFileSync(FILE, JSON.stringify(clean, null, 2), 'utf-8'); cache = null;
    return clean;
  }
  function reset() { try { if (fs.existsSync(FILE)) fs.unlinkSync(FILE); } catch {} cache = null; return read(); }
  return { read, write, reset, FILE };
};
Object.assign(module.exports, { DEFAULT_METERS, DEFAULT_ROLES, DEFAULT_CATEGORIES, DAILY_SECTIONS, WEEKLY_SECTIONS, CUSTOM_TYPES, defaultTemplate, normalizeTemplate, validateTemplate, cleanMeters, cleanRoles });
