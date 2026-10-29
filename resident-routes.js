// 住戶名冊（智慧版）：住戶聯繫表／區分所有權人／承租人
// - 三份格式相同（棟別、戶號、樓層、姓名、電話、門牌、其他資料），承租人多了租約起訖。
// - 每份都可以上傳 Excel 整批更新，也可以逐筆新增／修改（過戶、登錄租約、退租）。
// - 住戶聯繫表可以「從區分所有權人＋承租人自動更新」：
//   有有效租約的戶別 → 聯繫人是承租人；沒有 → 聯繫人是所有權人。上傳檔裡其他戶別保持不動。
// - 每次異動都留下紀錄（誰、何時、改了什麼）。
'use strict';

const LABELS = { 'residents-contact': '住戶聯繫表', 'residents-owners': '區分所有權人', 'residents-tenants': '承租人' };
// 上傳範本欄位（欄名, 欄寬）——上傳時用欄名自動辨識
const TEMPLATE_COLS = {
  'residents-contact': [['棟別', 8], ['樓層', 6], ['戶別', 9], ['姓名', 16], ['電話', 26], ['緊急聯絡人', 12], ['緊急聯絡電話', 16], ['汽車位', 14], ['汽車車牌', 14], ['機車位', 10], ['機車車牌', 14], ['承租戶', 8], ['戶況', 9], ['備註', 30]],
  'residents-owners': [['棟別', 8], ['樓層', 6], ['戶別', 9], ['所有權人', 16], ['電話', 26], ['門牌地址', 44], ['戶籍／通訊地址', 44], ['其他資料（居住人、寵物等）', 40]],
  'residents-tenants': [['棟別', 8], ['樓層', 6], ['戶別', 9], ['承租人', 16], ['電話', 26], ['起租日', 12], ['租約到期日', 12], ['其他資料（居住人、寵物等）', 40]],
};
const HELP_COMMON = [['欄位', '說明'], ['棟別、樓層', '參考用。系統以「戶別」對到社區的棟別、樓層與門牌（社區設定好棟別門牌後，下載的範本會自動帶好全社區的戶別）。'], ['戶別', '必填。例如 2A1（2 樓 A 棟之 1）、店1。也可以只填完整門牌地址，系統會反推戶別。']];
const TEMPLATE_HELP = {
  'residents-contact': [...HELP_COMMON,
    ['姓名', '聯絡人；同一戶有兩位以上，用頓號分開（例如：王大明、王美麗）。'], ['電話', '可以填多支，用頓號分開；關係可以寫在括號裡，例如 0912-345-678、0922-111-222(妻)。'],
    ['緊急聯絡人／電話', '例如：王小華、0933-222-111。'], ['汽車位／汽車車牌', '例如 B1-312、ABC-1234；多個用頓號分開，順序對應（第一個車位對第一個車牌）。沒有車輛留空。'],
    ['機車位／機車車牌', '例如 143、MAB-1234；沒有車輛留空。'], ['承租戶', '這一戶是租屋的話填「是」。第一次上傳時，系統會依這一欄自動建立「承租人」名單，之後再到承租人補登租約期間。'],
    ['戶況', '已入住（可留空）、未入住、未交屋。聯繫一覽表會用黃底、紅字標示。'], ['備註', '其他需要櫃檯知道的事項。'],
    ['範例', '戶別 2A1｜姓名 王大明、王美麗｜電話 0912-345-678、0922-111-222(妻)｜汽車位 B1-312｜汽車車牌 ABC-1234｜機車位 143｜承租戶 （空白）'],
    ['注意', '上傳後會先顯示檢查結果（找不到的戶別、地址對不起來的資料），確認後才匯入；匯入會取代目前的住戶聯繫表。']],
  'residents-owners': [...HELP_COMMON,
    ['所有權人', '區分所有權人姓名；共有人用頓號分開，或同一戶別複製一列分別填寫。'], ['電話', '可以填多支，用頓號分開。'],
    ['門牌地址', '可留空：社區設定好棟別門牌後，系統依戶別自動帶入完整地址；有填的話會檢查和戶別是否一致。'],
    ['戶籍／通訊地址', '所有權人的戶籍地或通訊地址（含郵遞區號）。房子出租、所有權人不住社區時，寄存證信函、開會通知會寄到這個地址；自住可留空。'],
    ['其他資料', '居住人、寵物、身分（例如：管委、屋主自住）等。'],
    ['範例', '戶別 2A1｜所有權人 王大明｜電話 0912-345-678｜其他資料 居住人：王大明、王美麗；寵物：貓 1 隻'],
    ['注意', '房屋買賣請在系統用「過戶」，舊所有權人會留在異動紀錄。上傳會取代目前的區分所有權人資料。']],
  'residents-tenants': [...HELP_COMMON,
    ['承租人', '承租人姓名。'], ['電話', '可以填多支，用頓號分開。'], ['起租日／租約到期日', '2026/1/31、115/1/31 都可以；到期前 30 天系統會提醒。'], ['其他資料', '居住人、寵物等。']],
};
const FIELDS = ['building', 'unit', 'floor', 'name', 'phone', 'address', 'extra', 'emergency_name', 'emergency_phone', 'mail_address'];

function todayTW() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// 支援 2026-01-31、2026/1/31、115/1/31（民國）、1/31/26（Excel 文字格式）、20260131
function normalizeDate(v) {
  const s = String(v ?? '').trim().replace(/[年月.]/g, '/').replace(/日/g, '');
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{8})$/))) return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
  if ((m = s.match(/^(\d{2,4})[-/](\d{1,2})[-/](\d{1,2})/))) {
    let y = Number(m[1]); if (y < 1911) y += 1911;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  return '';
}
// 「2026/1/1-2026/12/31」「115.1.1~116.12.31」這種租期欄位
function splitLeaseRange(v) {
  const parts = String(v ?? '').split(/\s*(?:~|～|至|到|－|—|–|\s-\s)\s*/).filter(Boolean);
  if (parts.length === 2) return [normalizeDate(parts[0]), normalizeDate(parts[1])];
  const m = String(v ?? '').match(/^(\S+?)-(\d{2,4}[/.]\S+)$/);
  if (m) return [normalizeDate(m[1]), normalizeDate(m[2])];
  return ['', ''];
}
function normPart(v) { return String(v ?? '').toUpperCase().replace(/[\s　]/g, '').replace(/[棟號樓FＦ之]+$/g, '').replace(/[Ａ-Ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); }
function unitKey(r) { const u = normPart(r.unit); if (!u) return ''; const b = normPart(r.building); return `${b}|${u}`; }
function unitLabel(r) { const u = String(r.unit || '').trim(), b = String(r.building || '').trim(); if (u && b && u.includes(b)) return u; return [b, u].filter(Boolean).join(' ') || '（未填戶號）'; }
function cleanText(v, max = 200) { return String(v ?? '').trim().slice(0, max); }

module.exports = function registerResidentRoutes(app, d) {
  const { db, getUser, tenantId, now, requireStaffFiller, residentCategory, residentActiveCommunity, residentCanEdit, residentParseFile, residentUpload, RESIDENT_IMPORTS_DIR, path, XLSX, layoutApi, fs } = d;
  const CL = layoutApi;

  // ---------- 資料表 ----------
  const cols = db.prepare('PRAGMA table_info(resident_records)').all().map(c => c.name);
  for (const [c, def] of [['lease_start', "TEXT DEFAULT ''"], ['lease_end', "TEXT DEFAULT ''"], ['status', "TEXT DEFAULT 'active'"], ['source', "TEXT DEFAULT 'import'"], ['updated_at', "TEXT DEFAULT ''"], ['updated_by', "TEXT DEFAULT ''"], ['emergency_name', "TEXT DEFAULT ''"], ['mail_address', "TEXT DEFAULT ''"], ['emergency_phone', "TEXT DEFAULT ''"]]) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE resident_records ADD COLUMN ${c} ${def}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS resident_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, category TEXT NOT NULL,
      record_id INTEGER, unit_label TEXT DEFAULT '', action TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      before_json TEXT DEFAULT '', after_json TEXT DEFAULT '', by_name TEXT DEFAULT '', at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resident_changes ON resident_changes(tenant_id,community_id,category,id);
    CREATE TABLE IF NOT EXISTS resident_settings (
      tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, auto_sync INTEGER NOT NULL DEFAULT 1, updated_at TEXT,
      PRIMARY KEY (tenant_id,community_id)
    );
  `);
  const tx = fn => (db.transaction ? db.transaction(fn) : fn);
  db.exec(`CREATE TABLE IF NOT EXISTS resident_acks (tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, version INTEGER NOT NULL, at TEXT NOT NULL, user_agent TEXT DEFAULT '', PRIMARY KEY (tenant_id,staff_id,version))`);

  // ---------- 個資保護 ----------
  // - 只有在職、啟用中、而且目前駐點在該社區的人員看得到（每次讀取都重新檢查；離職、停用、調離社區立即失效）。
  // - 公司管理員帳號與系統總後台都沒有住戶名冊的讀取介面：系統服務商不接觸各公司、各社區的住戶資料。
  // - 第一次查看前要先同意保密聲明（留存同意紀錄，屬公司內部資料）。
  const NOTICE_VERSION = 1;
  const NOTICE = [
    '住戶名冊含有住戶的姓名、電話、地址等個人資料，受《個人資料保護法》保護。',
    '僅限為執行本社區職務（例如櫃檯聯繫、通知、收發包裹）時查看與使用，不得提供給無關的人，也不得用於其他目的。',
    '請勿截圖、翻拍、複製或私下傳送住戶資料。畫面會顯示您的姓名與時間，下載檔案也會留下紀錄。',
    '離職、停用帳號或調離本社區後，將立即無法再查看任何住戶資料。',
    '本系統服務商不查看、不取得各公司與各社區的住戶資料；因使用者個人行為造成的資料外洩，由行為人自行負責。',
  ];
  // 社區資訊（基本資料）與管理委員會（本屆委員）：存證信函、公告會自動帶入
  db.exec(`CREATE TABLE IF NOT EXISTS community_profiles (tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, committee_name TEXT DEFAULT '', phone TEXT DEFAULT '', chair_name TEXT DEFAULT '', term_start TEXT DEFAULT '', term_end TEXT DEFAULT '', tax_id TEXT DEFAULT '', updated_by TEXT DEFAULT '', updated_at TEXT, PRIMARY KEY (tenant_id, community_id))`);
  { const cols = db.prepare('PRAGMA table_info(community_profiles)').all().map(c => c.name);
    for (const [c, def] of [['fax', "TEXT DEFAULT ''"], ['email', "TEXT DEFAULT ''"], ['units_total', 'INTEGER'], ['floors_up', 'INTEGER'], ['floors_down', 'INTEGER'], ['car_spaces', 'INTEGER'], ['moto_spaces', 'INTEGER'], ['tenant_eligible', 'INTEGER DEFAULT 0'], ['landlord_eligible', 'INTEGER DEFAULT 1'], ['members_json', "TEXT DEFAULT '[]'"], ['committee_updated_by', "TEXT DEFAULT ''"], ['committee_updated_at', 'TEXT']])
      if (!cols.includes(c)) db.exec(`ALTER TABLE community_profiles ADD COLUMN ${c} ${def}`); }
  const FIXED_ROLES = ['主任委員', '監察委員', '財務委員'];
  function membersOf(p) {
    let list = []; try { list = JSON.parse(p.members_json || '[]'); } catch {}
    if (!Array.isArray(list)) list = [];
    // 三個固定職務一定在最前面（舊資料只有主委姓名時帶入）
    const fixed = FIXED_ROLES.map(role => { const m = list.find(x => x.fixed && x.role === role) || (role === '主任委員' && p.chair_name ? { role, name: p.chair_name, source: 'manual' } : { role, name: '' }); return { ...m, role, fixed: true }; });
    return [...fixed, ...list.filter(x => !x.fixed)];
  }
  function profileOf(tid, cid) {
    const c = db.prepare('SELECT id,name,COALESCE(main_address,\'\') AS main_address FROM communities WHERE id=? AND tenant_id=?').get(cid, tid) || {};
    const p = db.prepare('SELECT * FROM community_profiles WHERE tenant_id=? AND community_id=?').get(tid, cid) || {};
    const members = membersOf(p); const chair = members.find(m => m.role === '主任委員')?.name || '';
    const layoutUnits = (() => { try { return CL.units(tid, cid).length; } catch { return 0; } })();
    return { community_id: cid, name: c.name || '', main_address: c.main_address || '', phone: p.phone || '', fax: p.fax || '', email: p.email || '',
      units_total: p.units_total ?? null, layout_units: layoutUnits, floors_up: p.floors_up ?? null, floors_down: p.floors_down ?? null, car_spaces: p.car_spaces ?? null, moto_spaces: p.moto_spaces ?? null,
      tenant_eligible: !!p.tenant_eligible, landlord_eligible: p.landlord_eligible === undefined || p.landlord_eligible === null ? true : !!p.landlord_eligible,
      committee_name: p.committee_name || '', committee_title: p.committee_name || (c.name ? `${c.name}管理委員會` : ''), chair_name: chair, members, term_start: p.term_start || '', term_end: p.term_end || '', tax_id: p.tax_id || '',
      updated_by: p.updated_by || '', updated_at: p.updated_at || '', committee_updated_by: p.committee_updated_by || '', committee_updated_at: p.committee_updated_at || '' };
  }
  function ensureProfile(tid, cid) { db.prepare('INSERT OR IGNORE INTO community_profiles (tenant_id,community_id) VALUES (?,?)').run(tid, cid); }
  const ackOf = (tid, uid) => db.prepare('SELECT at FROM resident_acks WHERE tenant_id=? AND staff_id=? AND version=?').get(tid, uid, NOTICE_VERSION) || null;

  // ---------- 共用 ----------
  function ctx(req, res, { edit = false } = {}) {
    let category; try { category = residentCategory(req); } catch (e) { res.status(400).json({ error: e.message }); return null; }
    const c = residentActiveCommunity(req);
    if (!c) { res.status(400).json({ error: '請先選擇目前要操作的案場' }); return null; }
    const u = getUser(req);
    if (!u || !u.is_active || u.role === 'company_admin' || ['left', 'blacklist', 'disabled'].includes(String(u.person_status || ''))) { res.status(403).json({ error: '這個帳號已沒有查看住戶名冊的權限', revoked: true }); return null; }
    if (d.staffMenuAllows && !d.staffMenuAllows(u, category)) { res.status(403).json({ error: '目前帳號沒有開通這個住戶名冊項目，請洽公司內勤' }); return null; }
    if (edit && !residentCanEdit(u)) { res.status(403).json({ error: '目前帳號沒有修改住戶名冊的權限（經理、秘書可以修改）' }); return null; }
    return { tid: tenantId(req), cid: c.id, community: c, category, u, by: u?.name || u?.employee_id || '' };
  }
  function activeImport(tid, cid, category) { return db.prepare('SELECT * FROM resident_imports WHERE tenant_id=? AND community_id=? AND category=? AND is_active=1 ORDER BY id DESC LIMIT 1').get(tid, cid, category) || null; }
  function ensureImport(tid, cid, category, by, uid, note) {
    const cur = activeImport(tid, cid, category); if (cur) return cur;
    const info = db.prepare('INSERT INTO resident_imports(tenant_id,community_id,category,original_filename,imported_at,imported_by,imported_by_name,row_count,detected_fields_json,is_active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(tid, cid, category, note || '手動建立', now(), uid || null, by || '', 0, '[]');
    return db.prepare('SELECT * FROM resident_imports WHERE id=?').get(Number(info.lastInsertRowid));
  }
  function records(tid, cid, category, { includeEnded = true } = {}) {
    const imp = activeImport(tid, cid, category); if (!imp) return [];
    const rows = db.prepare('SELECT id,building,unit,floor,name,phone,address,extra,lease_start,lease_end,status,source,updated_at,updated_by,emergency_name,emergency_phone,mail_address FROM resident_records WHERE import_id=? ORDER BY id').all(imp.id);
    return rows.map(r => ({ ...r, status: r.status || 'active', source: r.source || 'import' })).filter(r => includeEnded || r.status !== 'ended');
  }
  function log(t, { category, record_id = null, unit = '', action, summary, before = null, after = null }) {
    db.prepare('INSERT INTO resident_changes(tenant_id,community_id,category,record_id,unit_label,action,summary,before_json,after_json,by_name,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.tid, t.cid, category, record_id, unit, action, summary, before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', t.by, now());
  }
  function settings(tid, cid) { const r = db.prepare('SELECT auto_sync FROM resident_settings WHERE tenant_id=? AND community_id=?').get(tid, cid); return { auto_sync: r ? !!r.auto_sync : true }; }
  function cleanRecord(b, category) {
    const out = {}; for (const f of FIELDS) out[f] = cleanText(b?.[f], f === 'extra' || f === 'address' || f === 'mail_address' ? 500 : 100);
    if (category === 'residents-tenants') { out.lease_start = normalizeDate(b?.lease_start); out.lease_end = normalizeDate(b?.lease_end); }
    return out;
  }
  // ---------- 戶別清單（社區棟別門牌設定）----------
  const TENANT_RE = /^(承租戶|是否承租|是否為承租戶|出租)$/; const PLATE_RE = /車牌|車號/; const OCC_RE = /戶況|入住狀態|交屋/; const CAR_RE = /^(?!.*機).*(車位|停車)/; const MOTO_RE = /機車(?!.*(牌|號))/; const SEQ_RE = /^(序|序號|編號|no\.?|#)$/i;
  // 上傳的一列資料：對到戶別、整理車位欄、把（租蝦皮）這類註記留在其他資料
  function normalizeRows(t, rows) {
    const resolve = CL.resolver(t.tid, t.cid); const warnings = []; const parking = new Map(); let matched = 0;
    const out = rows.map((r, i) => {
      const raw = r.raw && typeof r.raw === 'object' ? r.raw : {}; let extra = String(r.extra || ''); const cars = [], motos = [], plates = [], motoPlates = []; let occ; let isTenant = /[（(]租|承租/.test(`${r.unit || ''}；${r.relation || ''}`);
      for (const [k, v] of Object.entries(raw)) {
        const val = String(v ?? '').trim(); if (!val) continue; const drop = () => { extra = extra.split('；').filter(x => x !== `${k}：${val}`).join('；'); };
        if (TENANT_RE.test(String(k).trim())) { isTenant = /^(是|y|yes|v|租|承租|○|◯|✓|✔)/i.test(val); drop(); } else if (PLATE_RE.test(k)) { (/機/.test(k) ? motoPlates : plates).push(...CL.splitSpaces(val)); drop(); } else if (OCC_RE.test(k)) { occ = /未交屋/.test(val) ? 'undelivered' : /未入住|空/.test(val) ? 'vacant' : ''; drop(); } else if (MOTO_RE.test(k)) { motos.push(...CL.splitSpaces(val)); drop(); } else if (CAR_RE.test(k)) { cars.push(...CL.splitSpaces(val)); drop(); } else if (SEQ_RE.test(String(k).trim())) drop();
      }
      const fromText = CL.parseParking(`${extra}；${r.unit || ''}`); if (!cars.length) cars.push(...fromText.cars); if (!motos.length) motos.push(...fromText.motos); if (!plates.length) plates.push(...fromText.plates); if (!motoPlates.length) motoPlates.push(...fromText.moto_plates); if (occ === undefined && fromText.occupancy) occ = fromText.occupancy;
      let en = String(r.emergency_name || '').trim(), ep = String(r.emergency_phone || '').trim();
      if (en && !ep) { const m = en.match(/^(.*?)[\s:：,，]*((?:\+?886|0)[\d\-\s()]{7,})$/); if (m) { en = m[1].trim(); ep = m[2].trim(); } }
      extra = extra.split('；').map(v => v.replace(/^(其他資料[^：]*|備註)：/, '')).filter(Boolean).join('；');
      const x = resolve(r); const row = { ...r, extra, emergency_name: en, emergency_phone: ep, is_tenant: isTenant };
      if (x.unit) { matched++; row.unit = x.unit.code; row.building = x.unit.building; row.floor = String(x.unit.floor); row.address = x.unit.address; if (x.note && !extra.includes(x.note)) row.extra = [x.note, extra].filter(Boolean).join('；');
        if (cars.length || motos.length || plates.length || motoPlates.length || occ !== undefined) { const p = parking.get(x.unit.code) || { cars: [], motos: [], plates: [], moto_plates: [] }; p.cars = [...new Set([...p.cars, ...cars])]; p.motos = [...new Set([...p.motos, ...motos])]; p.plates = [...new Set([...p.plates, ...plates])]; p.moto_plates = [...new Set([...p.moto_plates, ...motoPlates])]; if (occ !== undefined && !p.occupancy) p.occupancy = occ; parking.set(x.unit.code, p); } }
      for (const w of x.warn) warnings.push({ row: i + 1, name: r.name || '', msg: w });
      return row;
    });
    const seen = new Map(); for (const r of out) { if (!r.unit) continue; seen.set(r.unit, (seen.get(r.unit) || 0) + 1); }
    for (const [code, n] of seen) if (n > 1 && t.category !== 'residents-contact') warnings.push({ row: 0, name: '', msg: `戶別 ${code} 出現 ${n} 筆（多位共有人或多份租約請確認）` });
    return { rows: out, warnings, parking, matched };
  }
  // 逐筆新增／修改：戶別要在清單裡；車位存在「戶」上
  function fixUnit(t, r) {
    if (!CL.layout(t.tid, t.cid).configured) return '';
    const x = CL.resolver(t.tid, t.cid)({ unit: r.unit, address: '', building: r.building, floor: r.floor });
    if (!x.unit) return `找不到戶別「${r.unit || '（空白）'}」，請從清單選擇社區的戶別`;
    r.unit = x.unit.code; r.building = x.unit.building; r.floor = String(x.unit.floor); r.address = x.unit.address; return '';
  }
  function saveParking(t, code, p) {
    if (!p || typeof p !== 'object' || !code) return false;
    const list = v => v === undefined ? undefined : CL.splitSpaces(Array.isArray(v) ? v.join(',') : v);
    return CL.setParking(t.tid, t.cid, code, list(p.cars), list(p.motos), t.by, { plates: list(p.plates), moto_plates: list(p.moto_plates), occupancy: p.occupancy });
  }
  const unitMap = (tid, cid) => new Map(CL.units(tid, cid).map(u => [u.code, u]));
  const withUnit = (r, M) => { const u = M.get(r.unit); return u ? { ...r, u: { code: u.code, building: u.building, building_name: u.building_name, zone: u.zone, floor: u.floor, short: u.short, address: u.address, cars: u.cars, motos: u.motos, plates: u.plates, moto_plates: u.moto_plates, occupancy: u.occupancy, sort: u.sort } } : r; };
  // 還沒設定棟別門牌時：車位、車牌從其他資料裡解析出來顯示
  const withPk = r => r.u ? r : { ...r, pk: (({ cars, motos, plates, moto_plates }) => ({ cars, motos, plates, moto_plates }))(CL.parseParking(r.extra || '')) };

  // 租約狀態：active（有效）、expiring（30 天內到期）、expired（已過期但還沒辦退租）、ended（已退租）
  function leaseState(r, today = todayTW()) {
    if (r.status === 'ended') return 'ended';
    if (!r.lease_start && !r.lease_end) return 'unset';
    if (r.lease_end && r.lease_end < today) return 'expired';
    if (r.lease_end && r.lease_end <= addDays(today, 30)) return 'expiring';
    if (r.lease_start && r.lease_start > today) return 'upcoming';
    return 'active';
  }

  // ---------- 住戶聯繫表 自動更新 ----------
  // 依所有權人＋有效租約，算出每一戶「應該」的聯繫人
  function desiredContacts(tid, cid) {
    const today = todayTW();
    const owners = records(tid, cid, 'residents-owners', { includeEnded: false });
    const tenants = records(tid, cid, 'residents-tenants', { includeEnded: false }).filter(r => { const s = leaseState(r, today); return s === 'active' || s === 'expiring' || s === 'unset'; });
    const byKey = new Map();
    const slot = r => { const k = unitKey(r); if (!k) return null; if (!byKey.has(k)) byKey.set(k, { key: k, owners: [], tenants: [], base: r }); return byKey.get(k); };
    for (const o of owners) slot(o)?.owners.push(o);
    for (const t of tenants) slot(t)?.tenants.push(t);
    const out = new Map();
    for (const s of byKey.values()) {
      const pick = s.tenants.length ? s.tenants : s.owners;
      const ref = { ...s.base, ...(s.owners[0] || {}), ...(pick[0] || {}) };
      const join = (list, f) => [...new Set(list.map(x => String(x[f] || '').trim()).filter(Boolean))].join('、');
      const ownerTxt = s.owners.length ? `所有權人：${join(s.owners, 'name')}${join(s.owners, 'phone') ? ` ${join(s.owners, 'phone')}` : ''}` : '';
      const extra = s.tenants.length
        ? [`承租人${s.tenants[0].lease_end ? `（租約至 ${s.tenants[0].lease_end}）` : ''}`, ownerTxt].filter(Boolean).join('；')
        : '所有權人';
      out.set(s.key, {
        building: ref.building || '', unit: ref.unit || '', floor: ref.floor || s.owners[0]?.floor || '',
        name: join(pick, 'name'), phone: join(pick, 'phone'), address: ref.address || s.owners[0]?.address || '', extra,
        source: s.tenants.length ? 'sync-tenant' : 'sync-owner',
      });
    }
    return out;
  }
  // 比對聯繫表現況，算出要新增／更新的戶別；onlyKeys 只處理指定戶別（單筆異動時用）
  function syncPlan(tid, cid, onlyKeys = null) {
    const want = desiredContacts(tid, cid);
    const contacts = records(tid, cid, 'residents-contact', { includeEnded: false });
    const byKey = new Map();
    for (const r of contacts) { const k = unitKey(r); if (!k) continue; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
    const add = [], update = []; let same = 0;
    for (const [k, w] of want) {
      if (onlyKeys && !onlyKeys.has(k)) continue;
      const list = byKey.get(k) || [];
      const target = list.find(r => String(r.source || '').startsWith('sync')) || list[0];
      if (!target) { add.push({ key: k, after: w }); continue; }
      const changed = ['name', 'phone', 'extra'].some(f => String(target[f] || '') !== String(w[f] || ''));
      if (!changed) { same++; continue; }
      update.push({ key: k, id: target.id, before: { building: target.building, unit: target.unit, name: target.name, phone: target.phone, extra: target.extra }, after: { ...w, floor: target.floor || w.floor, address: target.address || w.address } });
    }
    return { add, update, unchanged: same, total_units: want.size };
  }
  function applySync(t, plan, reason) {
    if (!plan.add.length && !plan.update.length) return 0;
    const imp = ensureImport(t.tid, t.cid, 'residents-contact', t.by, t.u?.id, '由區分所有權人／承租人自動建立');
    const ins = db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json,source,status,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const upd = db.prepare('UPDATE resident_records SET floor=?,name=?,phone=?,address=?,extra=?,source=?,updated_at=?,updated_by=? WHERE id=?');
    tx(() => {
      for (const a of plan.add) { const w = a.after; const info = ins.run(imp.id, t.tid, t.cid, 'residents-contact', w.building, w.unit, w.floor, w.name, w.phone, w.address, w.extra, '{}', w.source, 'active', now(), t.by); log(t, { category: 'residents-contact', record_id: Number(info.lastInsertRowid), unit: unitLabel(w), action: 'sync-add', summary: `自動新增：${w.name || '—'}${w.phone ? ` ${w.phone}` : ''}（${w.source === 'sync-tenant' ? '承租人' : '所有權人'}）`, after: w }); }
      for (const u of plan.update) { const w = u.after; upd.run(w.floor, w.name, w.phone, w.address, w.extra, w.source, now(), t.by, u.id); log(t, { category: 'residents-contact', record_id: u.id, unit: unitLabel(w), action: 'sync-update', summary: `自動更新：${u.before.name || '—'} → ${w.name || '—'}${w.source === 'sync-tenant' ? '（承租人）' : '（所有權人）'}${reason ? `｜${reason}` : ''}`, before: u.before, after: w }); }
      db.prepare('UPDATE resident_imports SET row_count=(SELECT COUNT(*) FROM resident_records WHERE import_id=?) WHERE id=?').run(imp.id, imp.id);
    })();
    return plan.add.length + plan.update.length;
  }
  // 所有權人／承租人有異動時，若開啟自動同步就更新聯繫表對應的戶別
  function autoSync(t, keys, reason) {
    if (!settings(t.tid, t.cid).auto_sync) return 0;
    const ks = new Set([...keys].filter(Boolean));
    if (!ks.size) return 0;
    return applySync(t, syncPlan(t.tid, t.cid, ks), reason);
  }

  // ---------- API ----------
  app.get('/api/staff/residents', requireStaffFiller, (req, res) => {
    const t = ctx(req, res); if (!t) return;
    res.set('Cache-Control', 'no-store');
    if (!ackOf(t.tid, t.u.id)) return res.json({ ack_required: true, notice: { version: NOTICE_VERSION, items: NOTICE }, community: t.community, category: t.category, records: [] });
    try {
      const imp = activeImport(t.tid, t.cid, t.category);
      const today = todayTW();
      const UM = unitMap(t.tid, t.cid); const L = CL.layout(t.tid, t.cid);
      const rows = records(t.tid, t.cid, t.category).map(r => withPk(withUnit(t.category === 'residents-tenants' ? { ...r, lease_state: leaseState(r, today) } : r, UM)));
      const pref = db.prepare('SELECT sort_key FROM resident_sort_preferences WHERE staff_id=? AND tenant_id=? AND community_id=? AND category=?').get(t.u.id, t.tid, t.cid, t.category);
      const out = { community: t.community, category: t.category, records: rows, preference: { sort: pref?.sort_key || 'building' }, last_import: imp || null, viewer: { can_upload: residentCanEdit(t.u), can_edit: residentCanEdit(t.u), name: t.u.name || '', employee_id: t.u.employee_id || '' }, settings: settings(t.tid, t.cid), today, layout: { configured: L.configured, buildings: L.buildings.map(b => ({ code: b.code, name: b.name, zone: b.zone })), units: L.configured ? [...UM.values()].map(u => ({ code: u.code, building_name: u.building_name, short: u.short })) : [] } };
      if (t.category === 'residents-contact') {
        const plan = syncPlan(t.tid, t.cid);
        out.sync = { pending: plan.add.length + plan.update.length, add: plan.add.length, update: plan.update.length, units: plan.total_units, owners: records(t.tid, t.cid, 'residents-owners', { includeEnded: false }).length, tenants: records(t.tid, t.cid, 'residents-tenants', { includeEnded: false }).filter(r => ['active', 'expiring'].includes(leaseState(r, today))).length };
      }
      if (t.category === 'residents-tenants') out.lease_summary = ['active', 'expiring', 'expired', 'upcoming', 'unset', 'ended'].reduce((a, k) => ({ ...a, [k]: rows.filter(r => r.lease_state === k).length }), {});
      if (t.category === 'residents-owners' || t.category === 'residents-tenants') {
        // 給表單用：戶別清單（從所有權人＋聯繫表），方便登錄租約時選戶別、自動帶入所有權人
        const units = new Map();
        for (const cat of ['residents-owners', 'residents-contact']) for (const r of records(t.tid, t.cid, cat, { includeEnded: false })) { const k = unitKey(r); if (k && !units.has(k)) units.set(k, { building: r.building, unit: r.unit, floor: r.floor, address: r.address, owner: cat === 'residents-owners' ? r.name : '', owner_phone: cat === 'residents-owners' ? r.phone : '' }); else if (k && cat === 'residents-owners') { const u = units.get(k); if (u && !u.owner.includes(r.name)) u.owner = [u.owner, r.name].filter(Boolean).join('、'); } }
        out.units = [...units.values()];
      }
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) { console.error('residents load', e); res.status(400).json({ error: e.message || '無法載入住戶資料' }); }
  });

  app.post('/api/staff/residents/import', requireStaffFiller, residentUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '請選擇 Excel／CSV 檔案' });
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const file = path.join(RESIDENT_IMPORTS_DIR, req.file.filename); const drop = () => { try { fs.unlinkSync(file); } catch {} };
    if (!CL.layout(t.tid, t.cid).configured) { drop(); return res.status(400).json({ error: '請先完成「社區棟別門牌設定」，再上傳名冊', need_layout: true }); }
    try {
      const parsed0 = residentParseFile(file, t.category);
      const N = normalizeRows(t, parsed0.rows); const parsed = { ...parsed0, rows: N.rows };
      // 系統初次登錄：還沒有任何承租人資料時，依住戶聯繫表標示的承租戶自動建立承租人（租約期間之後手動補登）
      const firstTenants = t.category === 'residents-contact' && !records(t.tid, t.cid, 'residents-tenants').length;
      const tenantRows = firstTenants ? N.rows.filter(r => r.is_tenant && r.name) : [];
      if (String(req.body?.preview || '') === '1') {
        drop();
        return res.json({ preview: true, tenants_detected: tenantRows.length, tenants_first: firstTenants, total: N.rows.length, matched: N.matched, unmatched: N.rows.length - N.matched, warnings: N.warnings.slice(0, 300), warning_count: N.warnings.length, parking_units: N.parking.size, detected_fields: parsed.detected });
      }
      const at = now();
      const info = db.prepare('INSERT INTO resident_imports(tenant_id,community_id,category,original_filename,imported_at,imported_by,imported_by_name,row_count,detected_fields_json,is_active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(t.tid, t.cid, t.category, req.file.originalname, at, t.u.id, t.by, parsed.rows.length, JSON.stringify(parsed.detected));
      const importId = Number(info.lastInsertRowid);
      db.prepare('UPDATE resident_imports SET is_active=0 WHERE tenant_id=? AND community_id=? AND category=? AND id<>?').run(t.tid, t.cid, t.category, importId);
      const ins = db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json,lease_start,lease_end,status,source,updated_at,updated_by,emergency_name,emergency_phone,mail_address) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      tx(rows => { for (const r of rows) ins.run(importId, t.tid, t.cid, t.category, r.building, r.unit, r.floor, r.name, r.phone, r.address, [r.relation, r.extra].filter(Boolean).join('；'), JSON.stringify(r.raw), r.lease_start || '', r.lease_end || '', 'active', 'import', at, t.by, r.emergency_name || '', r.emergency_phone || '', r.mail_address || ''); })(parsed.rows);
      const or = v => (v && v.length ? v : undefined);
      for (const [code, p] of N.parking) CL.setParking(t.tid, t.cid, code, or(p.cars), or(p.motos), t.by, { plates: or(p.plates), moto_plates: or(p.moto_plates), occupancy: p.occupancy });
      log(t, { category: t.category, action: 'import', summary: `上傳檔案「${req.file.originalname}」，共 ${parsed.rows.length} 筆（取代原本資料）${N.parking.size ? `，更新 ${N.parking.size} 戶車位` : ''}${N.warnings.length ? `，${N.warnings.length} 個提醒` : ''}` });
      let tenantsMade = 0;
      if (tenantRows.length) {
        const ti = ensureImport(t.tid, t.cid, 'residents-tenants', t.by, t.u.id, '依住戶聯繫表自動判讀');
        const tins = db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json,lease_start,lease_end,status,source,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        tx(rows => { for (const r of rows) tins.run(ti.id, t.tid, t.cid, 'residents-tenants', r.building, r.unit, r.floor, r.name, r.phone, r.address, '由住戶聯繫表自動判讀，請補登租約期間', '{}', '', '', 'active', 'from-contact', at, t.by); })(tenantRows);
        db.prepare('UPDATE resident_imports SET row_count=(SELECT COUNT(*) FROM resident_records WHERE import_id=?) WHERE id=?').run(ti.id, ti.id);
        tenantsMade = tenantRows.length;
        log({ ...t, category: 'residents-tenants' }, { category: 'residents-tenants', action: 'import', summary: `依住戶聯繫表標示的承租戶，自動建立 ${tenantsMade} 筆承租人（租約期間待補登）` });
      }
      let synced = 0;
      if (t.category !== 'residents-contact') synced = autoSync(t, new Set(desiredContacts(t.tid, t.cid).keys()), `${LABELS[t.category]}上傳更新`);
      res.json({ success: true, imported: parsed.rows.length, detected_fields: parsed.detected, synced, warnings: N.warnings.slice(0, 300), tenants_made: tenantsMade, parking_units: N.parking.size, message: `已匯入 ${parsed.rows.length} 筆，並成為目前這個案場的最新${LABELS[t.category]}。${synced ? `住戶聯繫表已自動更新 ${synced} 戶。` : ''}${tenantsMade ? `\n已依「承租戶」欄自動建立 ${tenantsMade} 筆承租人，請到「承租人」補登租約期間。` : ''}` });
    } catch (e) { res.status(400).json({ error: e.message || '匯入失敗' }); }
  });

  app.post('/api/staff/residents/records', requireStaffFiller, (req, res) => {
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const r = cleanRecord(req.body?.record, t.category);
    if (!r.unit && !r.name) return res.status(400).json({ error: '請至少填寫戶號與姓名' });
    { const e = fixUnit(t, r); if (e) return res.status(400).json({ error: e }); }
    if (t.category === 'residents-tenants' && r.lease_start && r.lease_end && r.lease_end < r.lease_start) return res.status(400).json({ error: '租約到期日不能早於起租日' });
    const imp = ensureImport(t.tid, t.cid, t.category, t.by, t.u.id);
    const info = db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json,lease_start,lease_end,status,source,updated_at,updated_by,emergency_name,emergency_phone,mail_address) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(imp.id, t.tid, t.cid, t.category, r.building, r.unit, r.floor, r.name, r.phone, r.address, r.extra, '{}', r.lease_start || '', r.lease_end || '', 'active', 'manual', now(), t.by, r.emergency_name || '', r.emergency_phone || '', r.mail_address || '');
    db.prepare('UPDATE resident_imports SET row_count=row_count+1 WHERE id=?').run(imp.id);
    const id = Number(info.lastInsertRowid); if (saveParking(t, r.unit, req.body?.parking)) log(t, { category: t.category, record_id: id, unit: unitLabel(r), action: 'parking', summary: `更新車位：${r.unit}` });
    const summary = t.category === 'residents-tenants' ? `登錄租約：${r.name}${r.lease_start || r.lease_end ? `（${r.lease_start || '—'}～${r.lease_end || '—'}）` : ''}` : t.category === 'residents-owners' ? `新增所有權人：${r.name}` : `新增聯繫人：${r.name}`;
    log(t, { category: t.category, record_id: id, unit: unitLabel(r), action: 'add', summary, after: r });
    const synced = t.category === 'residents-contact' ? 0 : autoSync(t, new Set([unitKey(r)]), summary);
    res.json({ success: true, id, synced });
  });

  app.put('/api/staff/residents/records/:id', requireStaffFiller, (req, res) => {
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const cur = db.prepare('SELECT * FROM resident_records WHERE id=? AND tenant_id=? AND community_id=? AND category=?').get(Number(req.params.id), t.tid, t.cid, t.category);
    if (!cur) return res.status(404).json({ error: '找不到這筆資料' });
    const r = cleanRecord({ ...cur, ...(req.body?.record || {}) }, t.category);
    if (req.body?.record?.unit !== undefined && req.body.record.unit !== cur.unit) { const e = fixUnit(t, r); if (e) return res.status(400).json({ error: e }); }
    if (saveParking(t, r.unit, req.body?.parking)) log(t, { category: t.category, record_id: cur.id, unit: unitLabel(r), action: 'parking', summary: `更新車位：${r.unit}` });
    if (t.category === 'residents-tenants' && r.lease_start && r.lease_end && r.lease_end < r.lease_start) return res.status(400).json({ error: '租約到期日不能早於起租日' });
    const transfer = t.category === 'residents-owners' && req.body?.transfer && r.name !== cur.name;
    const status = req.body?.status === 'ended' ? 'ended' : req.body?.status === 'active' ? 'active' : (cur.status || 'active');
    db.prepare('UPDATE resident_records SET building=?,unit=?,floor=?,name=?,phone=?,address=?,extra=?,lease_start=?,lease_end=?,status=?,source=?,updated_at=?,updated_by=?,emergency_name=?,emergency_phone=?,mail_address=? WHERE id=?')
      .run(r.building, r.unit, r.floor, r.name, r.phone, r.address, r.extra, r.lease_start ?? cur.lease_start ?? '', r.lease_end ?? cur.lease_end ?? '', status, cur.source === 'import' ? 'import-edited' : (cur.source || 'manual'), now(), t.by, r.emergency_name || '', r.emergency_phone || '', r.mail_address || '', cur.id);
    const changes = FIELDS.concat(t.category === 'residents-tenants' ? ['lease_start', 'lease_end'] : []).filter(f => String(cur[f] || '') !== String(r[f] || ''));
    const names = { building: '棟別', unit: '戶號', floor: '樓層', name: '姓名', phone: '電話', address: '門牌', extra: '其他資料', lease_start: '起租日', lease_end: '租約到期日', emergency_name: '緊急聯絡人', emergency_phone: '緊急聯絡電話', mail_address: '戶籍／通訊地址' };
    let action = 'update', summary;
    if (transfer) { action = 'transfer'; summary = `過戶：${cur.name || '—'} → ${r.name}${req.body.transfer_date ? `（${normalizeDate(req.body.transfer_date) || req.body.transfer_date}）` : ''}`; }
    else if (status === 'ended' && cur.status !== 'ended') { action = 'end'; summary = `退租：${cur.name || '—'}${req.body?.end_date ? `（${normalizeDate(req.body.end_date)}）` : ''}`; if (req.body?.end_date) db.prepare('UPDATE resident_records SET lease_end=? WHERE id=?').run(normalizeDate(req.body.end_date) || r.lease_end || '', cur.id); }
    else if (t.category === 'residents-tenants' && changes.includes('lease_end') && cur.lease_end && r.lease_end > cur.lease_end) { action = 'renew'; summary = `續約：${r.name} 租約延長至 ${r.lease_end}`; }
    else summary = changes.length ? `修改${changes.map(f => names[f]).join('、')}${changes.includes('name') ? `：${cur.name || '—'} → ${r.name}` : changes.includes('phone') ? `：${cur.phone || '—'} → ${r.phone}` : ''}` : '確認資料（無變更）';
    log(t, { category: t.category, record_id: cur.id, unit: unitLabel(r), action, summary, before: cur, after: { ...r, status } });
    const synced = t.category === 'residents-contact' ? 0 : autoSync(t, new Set([unitKey(cur), unitKey(r)]), summary);
    res.json({ success: true, synced });
  });

  app.delete('/api/staff/residents/records/:id', requireStaffFiller, (req, res) => {
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const cur = db.prepare('SELECT * FROM resident_records WHERE id=? AND tenant_id=? AND community_id=? AND category=?').get(Number(req.params.id), t.tid, t.cid, t.category);
    if (!cur) return res.status(404).json({ error: '找不到這筆資料' });
    db.prepare('DELETE FROM resident_records WHERE id=?').run(cur.id);
    db.prepare('UPDATE resident_imports SET row_count=MAX(row_count-1,0) WHERE id=?').run(cur.import_id);
    const summary = `刪除：${cur.name || '—'}`;
    log(t, { category: t.category, record_id: cur.id, unit: unitLabel(cur), action: 'delete', summary, before: cur });
    const synced = t.category === 'residents-contact' ? 0 : autoSync(t, new Set([unitKey(cur)]), summary);
    res.json({ success: true, synced });
  });

  app.get('/api/staff/residents/history', requireStaffFiller, (req, res) => {
    const t = ctx(req, res); if (!t) return;
    if (!ackOf(t.tid, t.u.id)) return res.status(403).json({ error: '請先同意住戶個資保密聲明', ack_required: true });
    const rows = db.prepare('SELECT id,unit_label,action,summary,by_name,at FROM resident_changes WHERE tenant_id=? AND community_id=? AND category=? ORDER BY id DESC LIMIT 200').all(t.tid, t.cid, t.category);
    res.json({ rows });
  });

  // 住戶聯繫表：預覽／執行「從所有權人＋承租人更新」
  app.get('/api/staff/residents/sync-preview', requireStaffFiller, (req, res) => {
    req.query.category = 'residents-contact';
    const t = ctx(req, res); if (!t) return;
    const p = syncPlan(t.tid, t.cid);
    res.json({ add: p.add.map(x => x.after), update: p.update.map(x => ({ before: x.before, after: x.after })), unchanged: p.unchanged, units: p.total_units });
  });
  app.post('/api/staff/residents/sync', requireStaffFiller, (req, res) => {
    req.body = { ...(req.body || {}), category: 'residents-contact' };
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const n = applySync(t, syncPlan(t.tid, t.cid), '手動執行同步');
    res.json({ success: true, synced: n });
  });
  app.put('/api/staff/residents/settings', requireStaffFiller, (req, res) => {
    req.body = { ...(req.body || {}), category: req.body?.category || 'residents-contact' };
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const on = req.body.auto_sync ? 1 : 0;
    db.prepare('INSERT INTO resident_settings(tenant_id,community_id,auto_sync,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,community_id) DO UPDATE SET auto_sync=excluded.auto_sync,updated_at=excluded.updated_at').run(t.tid, t.cid, on, now());
    log(t, { category: 'residents-contact', action: 'settings', summary: on ? '開啟自動同步' : '關閉自動同步' });
    res.json({ success: true, settings: settings(t.tid, t.cid) });
  });

  // 上傳範本：依社區戶別清單產生（已有資料一起帶出來，改完直接上傳）
  app.get('/api/staff/residents/template', requireStaffFiller, (req, res) => {
    const t = ctx(req, res, { edit: true }); if (!t) return;
    if (!ackOf(t.tid, t.u.id)) return res.status(403).json({ error: '請先同意住戶個資保密聲明', ack_required: true });
    const configured = CL.layout(t.tid, t.cid).configured; const blank = req.query.blank === '1' || !configured;
    const cols = TEMPLATE_COLS[t.category]; const head = cols.map(c => c[0]); const rows = [];
    if (!blank) {
      const today = todayTW(); const byUnit = new Map(); for (const r of records(t.tid, t.cid, t.category, { includeEnded: false })) { if (!byUnit.has(r.unit)) byUnit.set(r.unit, []); byUnit.get(r.unit).push(r); }
      const tenantUnits = new Set(records(t.tid, t.cid, 'residents-tenants', { includeEnded: false }).filter(r => ['active', 'expiring', 'unset'].includes(leaseState(r, today))).map(r => r.unit));
      for (const u of CL.units(t.tid, t.cid)) for (const r of (byUnit.get(u.code) || [null])) {
        const base = [u.building_name, u.floor, u.code, r?.name || '', r?.phone || ''];
        if (t.category === 'residents-contact') rows.push([...base, r?.emergency_name || '', r?.emergency_phone || '', u.cars.join('、'), u.plates.join('、'), u.motos.join('、'), u.moto_plates.join('、'), tenantUnits.has(u.code) ? '是' : '', u.occupancy ? CL.OCC[u.occupancy] : '', r?.extra || '']);
        else if (t.category === 'residents-owners') rows.push([...base, u.address, r?.mail_address || '', r?.extra || '']);
        else rows.push([...base, r?.lease_start || '', r?.lease_end || '', r?.extra || '']);
      }
    }
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([head, ...rows]); ws['!cols'] = cols.map(c => ({ wch: c[1] }));
    XLSX.utils.book_append_sheet(wb, ws, LABELS[t.category].slice(0, 31));
    const help = XLSX.utils.aoa_to_sheet(TEMPLATE_HELP[t.category]); help['!cols'] = [{ wch: 16 }, { wch: 70 }]; XLSX.utils.book_append_sheet(wb, help, '填寫說明');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    log(t, { category: t.category, action: 'export', summary: blank ? '下載空白上傳範本' : `下載上傳範本（含目前資料，共 ${rows.length} 列）` });
    const fn = `${t.community.name}-${LABELS[t.category]}-上傳範本.xlsx`;
    res.set('Cache-Control', 'no-store'); res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(fn)}`); res.send(buf);
  });
  // 住戶聯繫一覽表（列印／PDF）：像櫃檯常用的「各棟樓層 × 戶號」對照表；給櫃檯、保全電話聯繫用，不含門牌地址
  app.get('/api/staff/residents/contact-sheet', requireStaffFiller, (req, res) => {
    req.query.category = 'residents-contact'; const t = ctx(req, res, { edit: true }); if (!t) return;
    if (!ackOf(t.tid, t.u.id)) return res.status(403).json({ error: '請先同意住戶個資保密聲明', ack_required: true });
    const recs = records(t.tid, t.cid, 'residents-contact', { includeEnded: false }); const byUnit = new Map();
    for (const r of recs) { const k = r.unit || ''; if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k).push(r); }
    const today = todayTW(); const tenantUnits = new Set(records(t.tid, t.cid, 'residents-tenants', { includeEnded: false }).filter(r => ['active', 'expiring', 'unset'].includes(leaseState(r, today))).map(r => r.unit));
    const split = v => String(v || '').split(/[；;、\n]+|\s{2,}/).map(x => x.trim()).filter(Boolean);
    function cell(code, list) {
      const names = [], phones = [], emergency = [];
      for (const r of list) {
        if (r.name) names.push(...split(r.name));
        const other = (String(r.extra || '').match(/其他聯絡人[:：]\s*([^；;]+)/) || [])[1]; if (other) names.push(...split(other));
        phones.push(...split(String(r.phone || '').replace(/\s+(?=(?:\+?886|0)\d)/g, '；'))); const e = [r.emergency_name, r.emergency_phone].filter(Boolean).join(' '); if (e) emergency.push(e);
      }
      const tenant = tenantUnits.has(code) || list.some(r => /(^|[；;（(])租|承租/.test(String(r.extra || '')) || /[（(]租/.test(String(r.unit || '')) || r.source === 'sync-tenant');
      return { names: [...new Set(names)].slice(0, 4), phones: [...new Set(phones)].slice(0, 5), emergency: emergency.slice(0, 2), tenant };
    }
    const L = CL.layout(t.tid, t.cid); const U = CL.units(t.tid, t.cid); const used = new Set(); const groups = [];
    for (const b of L.buildings) {
      const list = U.filter(u => u.building === b.code); if (!list.length) continue;
      const units = list.map(u => { used.add(u.code); return { code: u.code, floor: u.floor, no: u.no, cars: u.cars, motos: u.motos, plates: u.plates, moto_plates: u.moto_plates, occupancy: u.occupancy, ...cell(u.code, byUnit.get(u.code) || []) }; });
      const g = { code: b.code, name: b.name, zone: b.zone, type: b.type === 'list' ? 'list' : 'tower', units };
      if (g.type === 'tower') { g.cols = [...new Set(units.map(u => String(u.no)))].sort((x, y) => Number(x) - Number(y)); g.floors = [...new Set(units.map(u => u.floor))].sort((x, y) => y - x); }
      groups.push(g);
    }
    const rest = recs.filter(r => !used.has(r.unit || ''));
    // 還沒設定棟別門牌（或對不到戶別）的資料：依原本的棟別分組
    const byB = new Map(); for (const r of rest) { const b = String(r.building || '').trim() || '住戶'; if (!byB.has(b)) byB.set(b, []); byB.get(b).push(r); }
    for (const [bname, part] of byB) { const m = new Map(); for (const r of part) { const k = r.unit || `#${r.id}`; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      groups.push({ code: '_', name: U.length ? `${bname}（未對應戶別）` : bname, zone: '', type: 'list', units: [...m.entries()].map(([k, list]) => { const pk = CL.parseParking(list.map(r => r.extra || '').join('；')); return { code: list[0].unit || '', floor: list[0].floor || '', no: '', cars: pk.cars, motos: pk.motos, plates: pk.plates, moto_plates: pk.moto_plates, occupancy: pk.occupancy, ...cell(k, list) }; }) }); }
    log(t, { category: 'residents-contact', action: 'export', summary: `列印住戶聯繫一覽表（${groups.reduce((s, g) => s + g.units.length, 0)} 戶）` });
    res.set('Cache-Control', 'no-store');
    res.json({ community: t.community.name, printed_at: now(), printed_by: t.by, groups });
  });
  // 社區棟別門牌設定（經理、秘書）
  app.get('/api/staff/residents/layout', requireStaffFiller, (req, res) => {
    req.query.category = req.query.category || 'residents-contact'; const t = ctx(req, res); if (!t) return;
    const c = db.prepare('SELECT id,name,main_address FROM communities WHERE id=?').get(t.cid); const U = CL.units(t.tid, t.cid);
    const per = {}; for (const u of U) per[u.building] = (per[u.building] || 0) + 1;
    res.set('Cache-Control', 'no-store');
    res.json({ community: c, profile: profileOf(t.tid, t.cid), layout: CL.layout(t.tid, t.cid), formats: Object.fromEntries(Object.entries(CL.FORMATS).map(([k, v]) => [k, v.label])), counts: per, total: U.length, can_edit: residentCanEdit(t.u),
      sample: U.slice(0, 3).concat(U.slice(-2)).map(u => ({ code: u.code, address: u.address })) });
  });
  // 社區基本資料（經理、秘書）
  app.put('/api/staff/residents/profile', requireStaffFiller, (req, res) => {
    req.body = { ...(req.body || {}), category: 'residents-contact' }; const t = ctx(req, res, { edit: true }); if (!t) return;
    const before0 = profileOf(t.tid, t.cid); const b = { ...before0, ...Object.fromEntries(Object.entries(req.body).filter(([, x]) => x !== undefined)) }; const s = (v, m) => String(v ?? '').trim().slice(0, m);
    const n = (v, max) => { if (v === '' || v === null || v === undefined) return null; const x = Math.round(Number(v)); if (!Number.isFinite(x) || x < 0 || x > max) throw new Error('數量請填 0 以上的整數'); return x; };
    let v; try { v = { main_address: s(b.main_address, 120), phone: s(b.phone, 40), fax: s(b.fax, 40), email: s(b.email, 120), units_total: n(b.units_total, 100000), floors_up: n(b.floors_up, 200), floors_down: n(b.floors_down, 30), car_spaces: n(b.car_spaces, 100000), moto_spaces: n(b.moto_spaces, 100000), tenant_eligible: b.tenant_eligible ? 1 : 0, landlord_eligible: b.landlord_eligible === false || b.landlord_eligible === 0 ? 0 : 1 }; }
    catch (e) { return res.status(400).json({ error: e.message }); }
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return res.status(400).json({ error: '電子信箱格式不正確' });
    const before = profileOf(t.tid, t.cid); ensureProfile(t.tid, t.cid);
    db.prepare('UPDATE community_profiles SET phone=?,fax=?,email=?,units_total=?,floors_up=?,floors_down=?,car_spaces=?,moto_spaces=?,tenant_eligible=?,landlord_eligible=?,updated_by=?,updated_at=? WHERE tenant_id=? AND community_id=?')
      .run(v.phone, v.fax, v.email, v.units_total, v.floors_up, v.floors_down, v.car_spaces, v.moto_spaces, v.tenant_eligible, v.landlord_eligible, t.by, now(), t.tid, t.cid);
    if (req.body.main_address !== undefined) db.prepare('UPDATE communities SET main_address=?,updated_at=? WHERE id=? AND tenant_id=?').run(v.main_address, now(), t.cid, t.tid);
    const names = { main_address: '地址', phone: '電話', fax: '傳真', email: '電子信箱', units_total: '總戶數', floors_up: '地上樓層', floors_down: '地下樓層', car_spaces: '汽車位', moto_spaces: '機車位', tenant_eligible: '承租人擔任委員', landlord_eligible: '出租戶擔任委員' };
    const ch = Object.keys(names).filter(k => k !== 'main_address' || req.body.main_address !== undefined).filter(k => String(before[k] ?? '') !== String(typeof before[k] === 'boolean' ? !!v[k] : (v[k] ?? '')));
    if (ch.length) log(t, { category: 'residents-contact', action: 'settings', summary: `更新社區資訊：${ch.map(k => names[k]).join('、')}` });
    res.json({ success: true, profile: profileOf(t.tid, t.cid) });
  });
  // ---------- 管理委員會：本屆委員 ----------
  function committeeCtx(req, res, edit) {
    const c = residentActiveCommunity(req); if (!c) { res.status(400).json({ error: '請先選擇目前要操作的案場' }); return null; }
    const u = getUser(req);
    if (!u || !u.is_active || u.role === 'company_admin' || ['left', 'blacklist', 'disabled'].includes(String(u.person_status || ''))) { res.status(403).json({ error: '這個帳號沒有權限' }); return null; }
    if (d.staffMenuAllows && !d.staffMenuAllows(u, 'committee-current')) { res.status(403).json({ error: '目前帳號沒有開通「本屆委員」，請洽公司內勤' }); return null; }
    if (edit && !residentCanEdit(u)) { res.status(403).json({ error: '本屆委員由經理、秘書維護' }); return null; }
    return { tid: tenantId(req), cid: c.id, community: c, u, by: u.name || u.employee_id || '', category: 'residents-contact' };
  }
  // 可擔任委員的住戶：區分所有權人（自住／出租）、承租人；依社區資訊的設定判斷能不能選
  function candidates(tid, cid) {
    const P = profileOf(tid, cid); const today = todayTW(); const UM = unitMap(tid, cid);
    const leases = records(tid, cid, 'residents-tenants', { includeEnded: false }).filter(r => ['active', 'expiring', 'unset'].includes(leaseState(r, today)));
    const rented = new Set(leases.map(unitKey).filter(Boolean));
    const label = r => { const u = UM.get(r.unit); return u ? u.code : unitLabel(r); };
    const out = [];
    for (const o of records(tid, cid, 'residents-owners', { includeEnded: false })) for (const name of String(o.name || '').split(/[、,，;；]/).map(x => x.trim()).filter(Boolean)) {
      const isRented = rented.has(unitKey(o));
      out.push({ source: 'owner', ref_id: o.id, unit: label(o), name, phone: String(o.phone || '').split(/[、,，]/)[0].trim(), kind: isRented ? '所有權人（出租中）' : '所有權人', eligible: isRented ? P.landlord_eligible : true, reason: isRented && !P.landlord_eligible ? '社區設定：出租戶不能擔任委員' : '' });
    }
    for (const r of leases) for (const name of String(r.name || '').split(/[、,，;；]/).map(x => x.trim()).filter(Boolean))
      out.push({ source: 'tenant', ref_id: r.id, unit: label(r), name, phone: String(r.phone || '').split(/[、,，]/)[0].trim(), kind: '承租人', eligible: P.tenant_eligible, reason: P.tenant_eligible ? '' : '社區設定：承租人不能擔任委員' });
    return out.sort((a, b) => String(a.unit).localeCompare(String(b.unit), 'zh-Hant', { numeric: true }));
  }
  app.get('/api/staff/committee', requireStaffFiller, (req, res) => {
    const t = committeeCtx(req, res, false); if (!t) return;
    res.set('Cache-Control', 'no-store'); res.json({ community: t.community, profile: profileOf(t.tid, t.cid), fixed_roles: FIXED_ROLES, can_edit: residentCanEdit(t.u) });
  });
  app.get('/api/staff/committee/candidates', requireStaffFiller, (req, res) => {
    const t = committeeCtx(req, res, true); if (!t) return; res.set('Cache-Control', 'no-store');
    if (!ackOf(t.tid, t.u.id)) return res.json({ ack_required: true, rows: [] });
    res.json({ rows: candidates(t.tid, t.cid) });
  });
  app.put('/api/staff/committee', requireStaffFiller, (req, res) => {
    const t = committeeCtx(req, res, true); if (!t) return;
    const prev = profileOf(t.tid, t.cid); const b = { committee_name: prev.committee_name, term_start: prev.term_start, term_end: prev.term_end, tax_id: prev.tax_id, members: prev.members, ...Object.fromEntries(Object.entries(req.body || {}).filter(([, x]) => x !== undefined)) }; const s = (v, m) => String(v ?? '').trim().slice(0, m); const dt = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : '';
    const head = { committee_name: s(b.committee_name, 60), term_start: dt(b.term_start), term_end: dt(b.term_end), tax_id: s(b.tax_id, 8) };
    if (head.tax_id && !/^\d{8}$/.test(head.tax_id)) return res.status(400).json({ error: '統一編號是 8 位數字' });
    if (head.term_start && head.term_end && head.term_end < head.term_start) return res.status(400).json({ error: '任期結束日不能早於開始日' });
    const raw = Array.isArray(b.members) ? b.members.slice(0, 60) : [];
    const cand = new Map(candidates(t.tid, t.cid).map(c => [`${c.source}|${c.ref_id}|${c.name}`, c]));
    const members = [];
    for (const role of FIXED_ROLES) { const m = raw.find(x => x?.fixed && x.role === role) || { role }; members.push({ ...m, role, fixed: true }); }
    for (const m of raw) if (m && !m.fixed) { const role = s(m.role, 20); if (!role) return res.status(400).json({ error: '請填寫職稱' }); members.push({ ...m, role, fixed: false }); }
    const clean = [];
    for (const m of members) {
      const x = { role: m.role, fixed: m.fixed, name: s(m.name, 40), unit: s(m.unit, 40), phone: s(m.phone, 40), source: ['owner', 'tenant', 'manual'].includes(m.source) ? m.source : 'manual', ref_id: Number(m.ref_id) || null, note: s(m.note, 100) };
      if (x.source !== 'manual' && x.name) {
        const c = cand.get(`${x.source}|${x.ref_id}|${x.name}`);
        if (!c) return res.status(400).json({ error: `「${x.name}」已不在住戶名冊中，請重新選擇` });
        if (!c.eligible) return res.status(400).json({ error: `${x.name}（${c.kind}）不能擔任委員：${c.reason}` });
      }
      if (!x.fixed && !x.name) continue;
      clean.push(x);
    }
    const before = profileOf(t.tid, t.cid); ensureProfile(t.tid, t.cid);
    const chair = clean.find(m => m.role === '主任委員')?.name || '';
    db.prepare('UPDATE community_profiles SET committee_name=?,term_start=?,term_end=?,tax_id=?,members_json=?,chair_name=?,committee_updated_by=?,committee_updated_at=? WHERE tenant_id=? AND community_id=?')
      .run(head.committee_name, head.term_start, head.term_end, head.tax_id, JSON.stringify(clean), chair, t.by, now(), t.tid, t.cid);
    const diff = [];
    for (const m of clean) { const o = before.members.find(x => x.role === m.role && (m.fixed ? x.fixed : x.name === m.name)); if (m.fixed && (o?.name || '') !== m.name) diff.push(`${m.role} ${o?.name || '—'} → ${m.name || '—'}`); else if (!m.fixed && !o) diff.push(`新增${m.role} ${m.name}`); }
    for (const o of before.members.filter(x => !x.fixed)) if (!clean.some(m => !m.fixed && m.role === o.role && m.name === o.name)) diff.push(`移除${o.role} ${o.name}`);
    log(t, { category: 'residents-contact', action: 'settings', summary: `更新本屆委員${diff.length ? `：${diff.slice(0, 6).join('；')}` : ''}` });
    res.json({ success: true, profile: profileOf(t.tid, t.cid) });
  });
  app.put('/api/staff/residents/layout', requireStaffFiller, (req, res) => {
    req.body = { ...(req.body || {}), category: 'residents-contact' }; const t = ctx(req, res, { edit: true }); if (!t) return;
    try { const r = CL.save(t.tid, t.cid, req.body.layout || {}, t.by); log(t, { category: 'residents-contact', action: 'settings', summary: `更新社區棟別門牌設定（${r.units} 戶）` }); res.json({ success: true, ...r }); }
    catch (e) { res.status(e.status || 400).json({ error: e.message || '儲存失敗' }); }
  });
  app.post('/api/staff/residents/layout/preview', requireStaffFiller, (req, res) => {
    req.body = { ...(req.body || {}), category: 'residents-contact' }; const t = ctx(req, res, { edit: true }); if (!t) return;
    try { const raw = CL.generate(CL.clean(req.body.layout || {}));
      const dup = raw.map(u => u.code).filter((c, i, a) => a.indexOf(c) !== i);
      res.json({ total: raw.length, sample: raw.slice(0, 4).concat(raw.slice(-2)).map(u => ({ code: u.code, address: u.address })), duplicates: [...new Set(dup)].slice(0, 10) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  // 車位查詢（櫃檯：輸入車位號碼找戶別）
  app.get('/api/staff/residents/parking', requireStaffFiller, (req, res) => {
    req.query.category = 'residents-contact'; const t = ctx(req, res); if (!t) return;
    if (!ackOf(t.tid, t.u.id)) return res.status(403).json({ error: '請先同意住戶個資保密聲明', ack_required: true });
    res.json({ units: CL.units(t.tid, t.cid).filter(u => u.cars.length || u.motos.length).map(u => ({ code: u.code, building_name: u.building_name, short: u.short, cars: u.cars, motos: u.motos })) });
  });

  // 保密聲明同意
  app.post('/api/staff/residents/ack', requireStaffFiller, (req, res) => {
    const t = ctx(req, res); if (!t) return;
    if (Number(req.body?.version) !== NOTICE_VERSION) return res.status(400).json({ error: '保密聲明已更新，請重新整理後再同意' });
    db.prepare('INSERT OR IGNORE INTO resident_acks (tenant_id,staff_id,version,at,user_agent) VALUES (?,?,?,?,?)').run(t.tid, t.u.id, NOTICE_VERSION, now(), String(req.headers?.['user-agent'] || '').slice(0, 200));
    res.json({ success: true });
  });
  // 畫面回到前景時確認權限還在（離職、停用、調離社區後立即清除畫面）
  app.get('/api/staff/residents/access', requireStaffFiller, (req, res) => {
    const t = ctx(req, res); if (!t) return;
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, community_id: t.cid, acked: !!ackOf(t.tid, t.u.id) });
  });
  // 下載 Excel（經理、秘書）：給櫃檯使用；留下下載紀錄
  app.get('/api/staff/residents/export', requireStaffFiller, (req, res) => {
    const t = ctx(req, res, { edit: true }); if (!t) return;
    if (!ackOf(t.tid, t.u.id)) return res.status(403).json({ error: '請先同意住戶個資保密聲明', ack_required: true });
    if (!XLSX) return res.status(500).json({ error: '伺服器沒有安裝 Excel 元件' });
    const lease = t.category === 'residents-tenants'; const today = todayTW(); const UM = unitMap(t.tid, t.cid);
    const contact = t.category === 'residents-contact';
    const head = ['戶別', '棟別', '位置', '樓層', '姓名', '電話', ...(contact ? ['緊急聯絡人', '緊急聯絡電話'] : []), ...(lease ? ['起租日', '租約到期日', '狀態'] : []), '汽車位', ...(contact ? ['汽車車牌'] : []), '機車位', ...(contact ? ['機車車牌'] : []), '門牌地址', ...(t.category === 'residents-owners' ? ['戶籍／通訊地址'] : []), '其他資料'];
    const recs = records(t.tid, t.cid, t.category, { includeEnded: false }).map(r => withUnit(r, UM)).sort((x, y) => (x.u?.sort ?? 1e9) - (y.u?.sort ?? 1e9));
    const rows = recs.map(r => [r.unit || '', r.u?.building_name || r.building || '', r.u?.zone || '', r.floor || '', r.name || '', r.phone || '', ...(contact ? [r.emergency_name || '', r.emergency_phone || ''] : []),
      ...(lease ? [r.lease_start || '', r.lease_end || '', { active: '有效', expiring: '30 天內到期', expired: '已到期', upcoming: '尚未起租', unset: '未登錄租約期間', ended: '已退租' }[leaseState(r, today)] || ''] : []),
      (r.u?.cars || []).join('、'), ...(contact ? [(r.u?.plates || []).join('、')] : []), (r.u?.motos || []).join('、'), ...(contact ? [(r.u?.moto_plates || []).join('、')] : []), r.u?.address || r.address || '', ...(t.category === 'residents-owners' ? [r.mail_address || ''] : []), r.extra || '']);
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(h => ({ wch: /地址/.test(h) ? 42 : h === '其他資料' ? 30 : ['汽車位', '電話'].includes(h) ? 16 : 9 }));
    XLSX.utils.book_append_sheet(wb, ws, LABELS[t.category].slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    log(t, { category: t.category, action: 'export', summary: `下載 Excel（${rows.length} 筆）` });
    const fn = `${t.community.name}-${LABELS[t.category]}-${today}.xlsx`;
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="residents.xlsx"; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.send(buf);
  });

  // 存證信函／開會通知用：所有權人寄送地址。出租中（有有效租約）的戶別寄戶籍／通訊地址，自住寄門牌地址
  function ownerMailing(tid, cid) {
    const today = todayTW(); const UM = unitMap(tid, cid);
    const rented = new Set(records(tid, cid, 'residents-tenants', { includeEnded: false }).filter(r => ['active', 'expiring', 'unset'].includes(leaseState(r, today))).map(unitKey).filter(Boolean));
    const out = [];
    for (const o of records(tid, cid, 'residents-owners', { includeEnded: false })) {
      const u = UM.get(o.unit); const isRented = rented.has(unitKey(o)); const unitAddr = u?.address || o.address || '';
      const address = isRented ? (o.mail_address || '') : (unitAddr || o.mail_address || '');
      for (const name of String(o.name || '').split(/[、,，;；]/).map(x => x.trim()).filter(Boolean))
        out.push({ record_id: o.id, unit: u?.code || o.unit || '', unit_label: u ? [u.building_name, u.code].filter(Boolean).join(' ') : unitLabel(o), sort: u?.sort ?? 1e9, name, rented: isRented, unit_address: unitAddr, mail_address: o.mail_address || '', address, address_source: isRented ? (o.mail_address ? 'mail' : 'missing') : (unitAddr ? 'unit' : (o.mail_address ? 'mail' : 'missing')) });
    }
    return out.sort((a, b) => a.sort - b.sort || String(a.unit).localeCompare(String(b.unit)));
  }
  const acked = (tid, uid) => !!ackOf(tid, uid);
  return { desiredContacts, syncPlan, ownerMailing, acked, profileOf };
};
Object.assign(module.exports, { normalizeDate, splitLeaseRange, unitKey });
