// 住戶名冊（智慧版）：住戶聯繫表／區分所有權人／承租人
// - 三份格式相同（棟別、戶號、樓層、姓名、電話、門牌、其他資料），承租人多了租約起訖。
// - 每份都可以上傳 Excel 整批更新，也可以逐筆新增／修改（過戶、登錄租約、退租）。
// - 住戶聯繫表可以「從區分所有權人＋承租人自動更新」：
//   有有效租約的戶別 → 聯繫人是承租人；沒有 → 聯繫人是所有權人。上傳檔裡其他戶別保持不動。
// - 每次異動都留下紀錄（誰、何時、改了什麼）。
'use strict';

const LABELS = { 'residents-contact': '住戶聯繫表', 'residents-owners': '區分所有權人', 'residents-tenants': '承租人' };
const FIELDS = ['building', 'unit', 'floor', 'name', 'phone', 'address', 'extra'];

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
  for (const [c, def] of [['lease_start', "TEXT DEFAULT ''"], ['lease_end', "TEXT DEFAULT ''"], ['status', "TEXT DEFAULT 'active'"], ['source', "TEXT DEFAULT 'import'"], ['updated_at', "TEXT DEFAULT ''"], ['updated_by', "TEXT DEFAULT ''"]]) {
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
  const ackOf = (tid, uid) => db.prepare('SELECT at FROM resident_acks WHERE tenant_id=? AND staff_id=? AND version=?').get(tid, uid, NOTICE_VERSION) || null;

  // ---------- 共用 ----------
  function ctx(req, res, { edit = false } = {}) {
    let category; try { category = residentCategory(req); } catch (e) { res.status(400).json({ error: e.message }); return null; }
    const c = residentActiveCommunity(req);
    if (!c) { res.status(400).json({ error: '請先選擇目前要操作的案場' }); return null; }
    const u = getUser(req);
    if (!u || !u.is_active || u.role === 'company_admin' || ['left', 'blacklist', 'disabled'].includes(String(u.person_status || ''))) { res.status(403).json({ error: '這個帳號已沒有查看住戶名冊的權限', revoked: true }); return null; }
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
    const rows = db.prepare('SELECT id,building,unit,floor,name,phone,address,extra,lease_start,lease_end,status,source,updated_at,updated_by FROM resident_records WHERE import_id=? ORDER BY id').all(imp.id);
    return rows.map(r => ({ ...r, status: r.status || 'active', source: r.source || 'import' })).filter(r => includeEnded || r.status !== 'ended');
  }
  function log(t, { category, record_id = null, unit = '', action, summary, before = null, after = null }) {
    db.prepare('INSERT INTO resident_changes(tenant_id,community_id,category,record_id,unit_label,action,summary,before_json,after_json,by_name,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.tid, t.cid, category, record_id, unit, action, summary, before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', t.by, now());
  }
  function settings(tid, cid) { const r = db.prepare('SELECT auto_sync FROM resident_settings WHERE tenant_id=? AND community_id=?').get(tid, cid); return { auto_sync: r ? !!r.auto_sync : true }; }
  function cleanRecord(b, category) {
    const out = {}; for (const f of FIELDS) out[f] = cleanText(b?.[f], f === 'extra' || f === 'address' ? 500 : 100);
    if (category === 'residents-tenants') { out.lease_start = normalizeDate(b?.lease_start); out.lease_end = normalizeDate(b?.lease_end); }
    return out;
  }
  // ---------- 戶別清單（社區棟別門牌設定）----------
  const CAR_RE = /^(?!.*機).*(車位|停車)/; const MOTO_RE = /機車/; const SEQ_RE = /^(序|序號|編號|no\.?|#)$/i;
  // 上傳的一列資料：對到戶別、整理車位欄、把（租蝦皮）這類註記留在其他資料
  function normalizeRows(t, rows) {
    const resolve = CL.resolver(t.tid, t.cid); const warnings = []; const parking = new Map(); let matched = 0;
    const out = rows.map((r, i) => {
      const raw = r.raw && typeof r.raw === 'object' ? r.raw : {}; let extra = String(r.extra || ''); const cars = [], motos = [];
      for (const [k, v] of Object.entries(raw)) {
        const val = String(v ?? '').trim(); if (!val) continue; const drop = () => { extra = extra.split('；').filter(x => x !== `${k}：${val}`).join('；'); };
        if (MOTO_RE.test(k)) { motos.push(...CL.splitSpaces(val)); drop(); } else if (CAR_RE.test(k)) { cars.push(...CL.splitSpaces(val)); drop(); } else if (SEQ_RE.test(String(k).trim())) drop();
      }
      const fromText = CL.parseParking(extra); if (!cars.length) cars.push(...fromText.cars); if (!motos.length) motos.push(...fromText.motos);
      const x = resolve(r); const row = { ...r, extra };
      if (x.unit) { matched++; row.unit = x.unit.code; row.building = x.unit.building; row.floor = String(x.unit.floor); row.address = x.unit.address; if (x.note && !extra.includes(x.note)) row.extra = [x.note, extra].filter(Boolean).join('；');
        if (cars.length || motos.length) { const p = parking.get(x.unit.code) || { cars: [], motos: [] }; p.cars = [...new Set([...p.cars, ...cars])]; p.motos = [...new Set([...p.motos, ...motos])]; parking.set(x.unit.code, p); } }
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
    return CL.setParking(t.tid, t.cid, code, CL.splitSpaces(Array.isArray(p.cars) ? p.cars.join(',') : p.cars), CL.splitSpaces(Array.isArray(p.motos) ? p.motos.join(',') : p.motos), t.by);
  }
  const unitMap = (tid, cid) => new Map(CL.units(tid, cid).map(u => [u.code, u]));
  const withUnit = (r, M) => { const u = M.get(r.unit); return u ? { ...r, u: { code: u.code, building: u.building, building_name: u.building_name, zone: u.zone, short: u.short, address: u.address, cars: u.cars, motos: u.motos, sort: u.sort } } : r; };

  // 租約狀態：active（有效）、expiring（30 天內到期）、expired（已過期但還沒辦退租）、ended（已退租）
  function leaseState(r, today = todayTW()) {
    if (r.status === 'ended') return 'ended';
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
    const tenants = records(tid, cid, 'residents-tenants', { includeEnded: false }).filter(r => { const s = leaseState(r, today); return s === 'active' || s === 'expiring'; });
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
      const rows = records(t.tid, t.cid, t.category).map(r => withUnit(t.category === 'residents-tenants' ? { ...r, lease_state: leaseState(r, today) } : r, UM));
      const pref = db.prepare('SELECT sort_key FROM resident_sort_preferences WHERE staff_id=? AND tenant_id=? AND community_id=? AND category=?').get(t.u.id, t.tid, t.cid, t.category);
      const out = { community: t.community, category: t.category, records: rows, preference: { sort: pref?.sort_key || 'building' }, last_import: imp || null, viewer: { can_upload: residentCanEdit(t.u), can_edit: residentCanEdit(t.u), name: t.u.name || '', employee_id: t.u.employee_id || '' }, settings: settings(t.tid, t.cid), today, layout: { configured: L.configured, buildings: L.buildings.map(b => ({ code: b.code, name: b.name, zone: b.zone })), units: L.configured ? [...UM.values()].map(u => ({ code: u.code, building_name: u.building_name, short: u.short })) : [] } };
      if (t.category === 'residents-contact') {
        const plan = syncPlan(t.tid, t.cid);
        out.sync = { pending: plan.add.length + plan.update.length, add: plan.add.length, update: plan.update.length, units: plan.total_units, owners: records(t.tid, t.cid, 'residents-owners', { includeEnded: false }).length, tenants: records(t.tid, t.cid, 'residents-tenants', { includeEnded: false }).filter(r => ['active', 'expiring'].includes(leaseState(r, today))).length };
      }
      if (t.category === 'residents-tenants') out.lease_summary = ['active', 'expiring', 'expired', 'upcoming', 'ended'].reduce((a, k) => ({ ...a, [k]: rows.filter(r => r.lease_state === k).length }), {});
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
      if (String(req.body?.preview || '') === '1') {
        drop();
        return res.json({ preview: true, total: N.rows.length, matched: N.matched, unmatched: N.rows.length - N.matched, warnings: N.warnings.slice(0, 300), warning_count: N.warnings.length, parking_units: N.parking.size, detected_fields: parsed.detected });
      }
      const at = now();
      const info = db.prepare('INSERT INTO resident_imports(tenant_id,community_id,category,original_filename,imported_at,imported_by,imported_by_name,row_count,detected_fields_json,is_active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(t.tid, t.cid, t.category, req.file.originalname, at, t.u.id, t.by, parsed.rows.length, JSON.stringify(parsed.detected));
      const importId = Number(info.lastInsertRowid);
      db.prepare('UPDATE resident_imports SET is_active=0 WHERE tenant_id=? AND community_id=? AND category=? AND id<>?').run(t.tid, t.cid, t.category, importId);
      const ins = db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json,lease_start,lease_end,status,source,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      tx(rows => { for (const r of rows) ins.run(importId, t.tid, t.cid, t.category, r.building, r.unit, r.floor, r.name, r.phone, r.address, [r.relation, r.extra].filter(Boolean).join('；'), JSON.stringify(r.raw), r.lease_start || '', r.lease_end || '', 'active', 'import', at, t.by); })(parsed.rows);
      for (const [code, p] of N.parking) CL.setParking(t.tid, t.cid, code, p.cars, p.motos, t.by);
      log(t, { category: t.category, action: 'import', summary: `上傳檔案「${req.file.originalname}」，共 ${parsed.rows.length} 筆（取代原本資料）${N.parking.size ? `，更新 ${N.parking.size} 戶車位` : ''}${N.warnings.length ? `，${N.warnings.length} 個提醒` : ''}` });
      let synced = 0;
      if (t.category !== 'residents-contact') synced = autoSync(t, new Set(desiredContacts(t.tid, t.cid).keys()), `${LABELS[t.category]}上傳更新`);
      res.json({ success: true, imported: parsed.rows.length, detected_fields: parsed.detected, synced, warnings: N.warnings.slice(0, 300), parking_units: N.parking.size, message: `已匯入 ${parsed.rows.length} 筆，並成為目前這個案場的最新${LABELS[t.category]}。${synced ? `住戶聯繫表已自動更新 ${synced} 戶。` : ''}` });
    } catch (e) { res.status(400).json({ error: e.message || '匯入失敗' }); }
  });

  app.post('/api/staff/residents/records', requireStaffFiller, (req, res) => {
    const t = ctx(req, res, { edit: true }); if (!t) return;
    const r = cleanRecord(req.body?.record, t.category);
    if (!r.unit && !r.name) return res.status(400).json({ error: '請至少填寫戶號與姓名' });
    { const e = fixUnit(t, r); if (e) return res.status(400).json({ error: e }); }
    if (t.category === 'residents-tenants' && r.lease_start && r.lease_end && r.lease_end < r.lease_start) return res.status(400).json({ error: '租約到期日不能早於起租日' });
    const imp = ensureImport(t.tid, t.cid, t.category, t.by, t.u.id);
    const info = db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json,lease_start,lease_end,status,source,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(imp.id, t.tid, t.cid, t.category, r.building, r.unit, r.floor, r.name, r.phone, r.address, r.extra, '{}', r.lease_start || '', r.lease_end || '', 'active', 'manual', now(), t.by);
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
    db.prepare('UPDATE resident_records SET building=?,unit=?,floor=?,name=?,phone=?,address=?,extra=?,lease_start=?,lease_end=?,status=?,source=?,updated_at=?,updated_by=? WHERE id=?')
      .run(r.building, r.unit, r.floor, r.name, r.phone, r.address, r.extra, r.lease_start ?? cur.lease_start ?? '', r.lease_end ?? cur.lease_end ?? '', status, cur.source === 'import' ? 'import-edited' : (cur.source || 'manual'), now(), t.by, cur.id);
    const changes = FIELDS.concat(t.category === 'residents-tenants' ? ['lease_start', 'lease_end'] : []).filter(f => String(cur[f] || '') !== String(r[f] || ''));
    const names = { building: '棟別', unit: '戶號', floor: '樓層', name: '姓名', phone: '電話', address: '門牌', extra: '其他資料', lease_start: '起租日', lease_end: '租約到期日' };
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
    if (!CL.layout(t.tid, t.cid).configured) return res.status(400).json({ error: '請先完成「社區棟別門牌設定」', need_layout: true });
    const lease = t.category === 'residents-tenants'; const blank = req.query.blank === '1';
    const head = ['戶別', '姓名', '電話', ...(lease ? ['起租日', '租約到期日'] : []), '汽車位', '機車位', '其他資料'];
    const byUnit = new Map(); if (!blank) for (const r of records(t.tid, t.cid, t.category, { includeEnded: false })) { if (!byUnit.has(r.unit)) byUnit.set(r.unit, []); byUnit.get(r.unit).push(r); }
    const rows = []; for (const u of CL.units(t.tid, t.cid)) {
      const list = byUnit.get(u.code) || [null];
      for (const r of list) rows.push([u.code, r?.name || '', r?.phone || '', ...(lease ? [r?.lease_start || '', r?.lease_end || ''] : []), u.cars.join('、'), u.motos.join('、'), r?.extra || '']);
    }
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(h => ({ wch: h === '其他資料' ? 36 : ['電話', '汽車位'].includes(h) ? 18 : 10 }));
    XLSX.utils.book_append_sheet(wb, ws, LABELS[t.category].slice(0, 31));
    const help = XLSX.utils.aoa_to_sheet([['填寫說明'], ['1. 「戶別」請不要修改，系統用戶別對到社區的棟別、樓層與門牌地址（完整地址會自動帶入）。'], ['2. 同一戶有多位' + (lease ? '承租人' : '所有權人／聯絡人') + '時，複製一列、戶別相同即可。'], ['3. 汽車位可以填多個，用頓號或逗號分開，例如：B1-313、B1-313-1。'], ['4. 機車位填號碼即可，例如：143。'], ...(lease ? [['5. 日期格式：2026/1/31 或 115/1/31 都可以。']] : []), ['上傳後會先顯示檢查結果（找不到的戶別、地址對不起來的資料），確認後才匯入。']]);
    help['!cols'] = [{ wch: 90 }]; XLSX.utils.book_append_sheet(wb, help, '填寫說明');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    log(t, { category: t.category, action: 'export', summary: blank ? '下載空白上傳範本' : `下載上傳範本（含目前資料 ${byUnit.size} 戶）` });
    const fn = `${t.community.name}-${LABELS[t.category]}-上傳範本.xlsx`;
    res.set('Cache-Control', 'no-store'); res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(fn)}`); res.send(buf);
  });
  // 社區棟別門牌設定（經理、秘書）
  app.get('/api/staff/residents/layout', requireStaffFiller, (req, res) => {
    req.query.category = req.query.category || 'residents-contact'; const t = ctx(req, res); if (!t) return;
    const c = db.prepare('SELECT id,name,main_address FROM communities WHERE id=?').get(t.cid); const U = CL.units(t.tid, t.cid);
    const per = {}; for (const u of U) per[u.building] = (per[u.building] || 0) + 1;
    res.set('Cache-Control', 'no-store');
    res.json({ community: c, layout: CL.layout(t.tid, t.cid), formats: Object.fromEntries(Object.entries(CL.FORMATS).map(([k, v]) => [k, v.label])), counts: per, total: U.length, can_edit: residentCanEdit(t.u),
      sample: U.slice(0, 3).concat(U.slice(-2)).map(u => ({ code: u.code, address: u.address })) });
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
    const head = ['戶別', '棟別', '位置', '樓層', '姓名', '電話', ...(lease ? ['起租日', '租約到期日', '狀態'] : []), '汽車位', '機車位', '門牌地址', '其他資料'];
    const recs = records(t.tid, t.cid, t.category, { includeEnded: false }).map(r => withUnit(r, UM)).sort((x, y) => (x.u?.sort ?? 1e9) - (y.u?.sort ?? 1e9));
    const rows = recs.map(r => [r.unit || '', r.u?.building_name || r.building || '', r.u?.zone || '', r.floor || '', r.name || '', r.phone || '',
      ...(lease ? [r.lease_start || '', r.lease_end || '', { active: '有效', expiring: '30 天內到期', expired: '已到期', upcoming: '尚未起租', ended: '已退租' }[leaseState(r, today)] || ''] : []),
      (r.u?.cars || []).join('、'), (r.u?.motos || []).join('、'), r.u?.address || r.address || '', r.extra || '']);
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(h => ({ wch: h === '門牌地址' ? 42 : h === '其他資料' ? 30 : ['汽車位', '電話'].includes(h) ? 16 : 9 }));
    XLSX.utils.book_append_sheet(wb, ws, LABELS[t.category].slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    log(t, { category: t.category, action: 'export', summary: `下載 Excel（${rows.length} 筆）` });
    const fn = `${t.community.name}-${LABELS[t.category]}-${today}.xlsx`;
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="residents.xlsx"; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.send(buf);
  });

  return { desiredContacts, syncPlan };
};
Object.assign(module.exports, { normalizeDate, splitLeaseRange, unitKey });
