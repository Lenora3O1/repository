// 總務設備管理
// - 設備清冊：分類由公司自訂；可「逐台登記」（每台有財產編號）或「依數量登記」。
// - 設備申請（現場）：選借用期間，看得到總數／已借出，借滿的日子反灰，系統算出最早可借日期。
//   流程：案場主管同意 → 總務核准 → 總務出借 → 申請人歸還 → 總務點收（數量恢復、歸檔）。
// - 設備申請紀錄（公司）：依社區查詢歷史紀錄。
// - 社區進駐設備：進駐時帶進社區的設備；借用出借／歸還時自動更新；撤場時列印點交清單。
// - 總後台：各公司的分類預設、是否需要案場主管同意、借用天數上限、可預約天數。
'use strict';

module.exports = function registerEquipmentRoutes(app, d) {
  const { db, fs, path, crypto, multer, DATA_DIR, getUser, tenantId, now, requireStaff, requireCompanyAdmin, requireSuperAdmin, getSiteAssignments, effectivePermissions, org, plans } = d;
  const applyOn = tid => !plans || plans.isOn(tid, 'equip_apply');
  const DIR = path.join(DATA_DIR, 'uploads', 'equipment');
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  db.exec(`
  CREATE TABLE IF NOT EXISTS equip_settings (tenant_id INTEGER PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT, updated_by TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS equip_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, gkey TEXT NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT '', brand_model TEXT DEFAULT '',
    asset_no TEXT DEFAULT '', track_mode TEXT NOT NULL DEFAULT 'qty', quantity INTEGER NOT NULL DEFAULT 1, purchase_date TEXT DEFAULT '', price REAL DEFAULT 0,
    location TEXT DEFAULT '', photo TEXT DEFAULT '', photo_mime TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'normal', note TEXT DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_equip_items ON equip_items(tenant_id,gkey);
  CREATE TABLE IF NOT EXISTS equip_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER, applicant_id INTEGER NOT NULL, gkey TEXT NOT NULL, item_name TEXT DEFAULT '', category TEXT DEFAULT '',
    qty INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT NOT NULL, purpose TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_site',
    site_approver_ids_json TEXT DEFAULT '[]', site_by TEXT DEFAULT '', site_at TEXT, ga_by TEXT DEFAULT '', ga_at TEXT, units_json TEXT DEFAULT '[]',
    lent_by TEXT DEFAULT '', lent_at TEXT, returned_by TEXT DEFAULT '', returned_at TEXT, return_note TEXT DEFAULT '', checked_by TEXT DEFAULT '', checked_at TEXT,
    check_result TEXT DEFAULT '', check_note TEXT DEFAULT '', comment TEXT DEFAULT '', overdue_notified INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_equip_requests ON equip_requests(tenant_id,status,gkey);
  CREATE TABLE IF NOT EXISTS equip_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, request_id INTEGER, actor TEXT DEFAULT '', action TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS equip_site_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, item_id INTEGER, gkey TEXT DEFAULT '', name TEXT NOT NULL, category TEXT DEFAULT '',
    brand_model TEXT DEFAULT '', asset_no TEXT DEFAULT '', qty INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'move_in', owner TEXT NOT NULL DEFAULT 'company', request_id INTEGER,
    note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'present', placed_at TEXT NOT NULL, placed_by TEXT DEFAULT '', removed_at TEXT, removed_by TEXT DEFAULT '', removed_note TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_equip_site ON equip_site_items(tenant_id,community_id,status);
  `);

  // ---------- 小工具 ----------
  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const int = (v, lo, hi, f) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : f; };
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ error: msg, ...extra });
  const err = (msg, status = 400, extra) => Object.assign(new Error(msg), { status, extra });
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400, e.extra || {}); } };
  const tx = fn => db.transaction(fn);
  const by = u => u?.name || u?.employee_id || '';
  const staffRow = (tid, id) => db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid);
  const nameOf = (tid, id) => staffRow(tid, id)?.name || '';
  const commName = id => id ? (db.prepare('SELECT name FROM communities WHERE id=?').get(id)?.name || '') : '';
  const adminIds = tid => db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND is_active=1").all(tid).map(x => x.id);
  const mi = u => { try { return org?.memberInfo(u) || null; } catch { return null; } };
  const gkeyOf = x => [x.category, x.name, x.brand_model].map(v => String(v || '').trim().toLowerCase()).join('|');
  const log = (tid, rid, u, action, note = '') => db.prepare('INSERT INTO equip_logs (tenant_id,request_id,actor,action,note,created_at) VALUES (?,?,?,?,?,?)').run(tid, rid, by(u), action, str(note, 300), now());

  function notify(tid, from, toIds, subject, body) {
    for (const toId of [...new Set(toIds)].filter(Boolean)) {
      try {
        const to = staffRow(tid, toId); if (!to) continue;
        let sender = from && from.id !== to.id ? from : null; if (!sender) { const a = adminIds(tid).find(x => x !== to.id); sender = a ? staffRow(tid, a) : null; } if (!sender) continue;
        db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,message_type,attachment_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
          .run(tid, sender.id, to.id, sender.employee_id, sender.name, to.employee_id, to.name, subject, body, 'text', '', now());
      } catch (e) { console.warn('equipment message failed', e.message); }
    }
  }

  // ---------- 公司設定（總後台可客製化） ----------
  const DEFAULTS = { categories: ['消防設備', '清潔設備', '工具', '電子設備', '活動用品', '其他'], site_approval: true, max_days: 30, horizon_days: 90, return_check: true };
  function normalize(c) {
    c = c && typeof c === 'object' ? c : {};
    const cats = [...new Set((Array.isArray(c.categories) ? c.categories : DEFAULTS.categories).map(x => str(x, 20)).filter(Boolean))].slice(0, 40);
    return {
      categories: cats.length ? cats : DEFAULTS.categories.slice(),
      site_approval: c.site_approval === undefined ? DEFAULTS.site_approval : !!c.site_approval,
      max_days: int(c.max_days, 1, 365, DEFAULTS.max_days),
      horizon_days: int(c.horizon_days, 14, 365, DEFAULTS.horizon_days),
      return_check: c.return_check === undefined ? DEFAULTS.return_check : !!c.return_check,
    };
  }
  function settingsFor(tid) { const r = db.prepare('SELECT config_json FROM equip_settings WHERE tenant_id=?').get(tid); return normalize(r ? parse(r.config_json, {}) : null); }
  function saveSettings(tid, cfg, u) {
    const c = normalize(cfg);
    db.prepare('INSERT INTO equip_settings (tenant_id,config_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(c), now(), u || '');
    return c;
  }

  // ---------- 權限 ----------
  function isGA(u) {
    if (!u) return false; if (u.role === 'company_admin') return true;
    try { if ((effectivePermissions(u) || []).includes('company-general-affairs')) return true; } catch {}
    const m = mi(u); return !!m?.position?.perms?.includes('company-general-affairs');
  }
  function gaIds(tid) {
    const rows = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND role<>'company_admin' AND COALESCE(person_status,'active')='active'").all(tid);
    const ids = rows.filter(isGA).map(x => x.id);
    return ids.length ? ids : adminIds(tid);
  }
  function staffAt(tid, cid) {
    const ids = new Set();
    for (const r of db.prepare("SELECT staff_id FROM staff_work_assignments WHERE tenant_id=? AND community_id=? AND scope_type='site'").all(tid, cid)) ids.add(r.staff_id);
    try { for (const r of db.prepare('SELECT staff_id FROM staff_communities WHERE community_id=?').all(cid)) ids.add(r.staff_id); } catch {}
    return [...ids].map(id => staffRow(tid, id)).filter(u => u && u.is_active);
  }
  // 案場主管：該社區的社區主管；沒有時找副主管；申請人自己就是主管時跳過
  function siteApprovers(tid, cid, applicantId) {
    const people = staffAt(tid, cid).map(u => ({ u, m: mi(u) }));
    let mgr = people.filter(x => x.m?.kind === 'site_manager');
    if (!mgr.length) mgr = people.filter(x => x.m?.kind === 'site_deputy');
    if (!mgr.length) mgr = people.filter(x => !x.m && /經理|總幹事|主任/.test(String(x.u.job_level || x.u.position || '')));
    const ids = mgr.map(x => x.u.id);
    if (ids.includes(applicantId)) return [];
    return ids;
  }
  function myCommunities(u) {
    const tid = u.tenant_id;
    const own = (() => { try { return getSiteAssignments(u).map(a => ({ id: Number(a.community_id), name: a.community_name })); } catch { return []; } })();
    const m = mi(u);
    if (m?.kind === 'region' && m.regions?.length) {
      const rows = db.prepare(`SELECT id,name FROM communities WHERE tenant_id=? AND status='active' AND region_id IN (${m.regions.map(() => '?').join(',')}) ORDER BY name`).all(tid, ...m.regions);
      for (const r of rows) if (!own.some(x => x.id === r.id)) own.push(r);
    }
    if (!own.length && (isGA(u) || u.role === 'company_admin' || ['owner', 'gm', 'dept_head'].includes(m?.kind))) return db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid);
    return own;
  }
  const allCommunities = tid => db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid);

  // ---------- 庫存與可借數量 ----------
  const BLOCKING = ['pending_site', 'pending_ga', 'approved', 'lent'];
  const STATUS = { pending_site: '待案場主管同意', pending_ga: '待總務核准', approved: '已核准，待出借', lent: '出借中', returning: '已歸還，待總務點收', closed: '已歸檔', rejected: '已退回', cancelled: '已取消' };
  const ITEM_STATUS = { normal: '正常', repair: '維修中', scrapped: '報廢', lost: '遺失' };
  const itemsOf = (tid, gkey) => db.prepare('SELECT * FROM equip_items WHERE tenant_id=? AND gkey=? AND is_active=1 ORDER BY asset_no,id').all(tid, gkey);
  // 進駐在社區的公司設備（長期放在社區，不能借）
  function deployed(tid, gkey) {
    const rows = db.prepare("SELECT * FROM equip_site_items WHERE tenant_id=? AND gkey=? AND status='present' AND owner='company' AND source='move_in'").all(tid, gkey);
    const units = new Set(rows.filter(r => r.item_id).map(r => r.item_id));
    const qtyByItem = new Map(); for (const r of rows) if (r.item_id) qtyByItem.set(r.item_id, (qtyByItem.get(r.item_id) || 0) + r.qty);
    return { rows, units, qtyByItem, loose: rows.filter(r => !r.item_id).reduce((s, r) => s + r.qty, 0) };
  }
  function stock(tid, gkey) {
    const items = itemsOf(tid, gkey); const dep = deployed(tid, gkey);
    let owned = 0, normal = 0, repair = 0, atSites = 0;
    for (const it of items) {
      owned += it.quantity;
      if (it.status === 'normal') { const q = Math.min(it.quantity, dep.qtyByItem.get(it.id) || 0); normal += it.quantity - q; atSites += q; }
      else if (it.status === 'repair') repair += it.quantity;
    }
    const loose = Math.min(dep.loose, normal); normal -= loose; atSites += loose;
    return { owned, total: normal, repair, at_sites: atSites, items };
  }
  function reservations(tid, gkey, excludeId) {
    const t = todayTW();
    return db.prepare(`SELECT * FROM equip_requests WHERE tenant_id=? AND gkey=? AND status IN (${BLOCKING.map(() => '?').join(',')}) AND id<>?`).all(tid, gkey, ...BLOCKING, excludeId || 0)
      .map(r => ({ ...r, eff_end: r.status === 'lent' && r.end_date < t ? t : r.end_date }));
  }
  function usedOn(res_, date) { let n = 0; for (const r of res_) if (r.start_date <= date && r.eff_end >= date) n += r.qty; return n; }
  function availability(tid, gkey, from, days, excludeId) {
    const s = stock(tid, gkey); const res_ = reservations(tid, gkey, excludeId); const out = [];
    for (let i = 0; i < days; i++) { const dd = addDays(from, i); const used = usedOn(res_, dd); out.push({ d: dd, used, avail: Math.max(0, s.total - used) }); }
    return { stock: s, days: out, res: res_ };
  }
  function earliest(tid, gkey, qty, dur, horizon, excludeId) {
    const t = todayTW(); const a = availability(tid, gkey, t, horizon + dur, excludeId);
    if (a.stock.total < qty) return null;
    for (let i = 0; i + dur <= a.days.length && i <= horizon; i++) { let ok = true; for (let j = 0; j < dur; j++) if (a.days[i + j].avail < qty) { ok = false; i += j; break; } if (ok) return a.days[i].d; }
    return null;
  }
  function catalog(tid) {
    const rows = db.prepare('SELECT * FROM equip_items WHERE tenant_id=? AND is_active=1 ORDER BY category,name,brand_model,asset_no,id').all(tid);
    const groups = new Map();
    for (const it of rows) { if (!groups.has(it.gkey)) groups.set(it.gkey, { gkey: it.gkey, name: it.name, category: it.category, brand_model: it.brand_model, track_mode: it.track_mode, location: it.location, photo_id: null, price: it.price }); const g = groups.get(it.gkey); if (!g.photo_id && it.photo) g.photo_id = it.id; }
    const t = todayTW();
    return [...groups.values()].map(g => { const s = stock(tid, g.gkey); const used = usedOn(reservations(tid, g.gkey), t); return { ...g, owned: s.owned, total: s.total, repair: s.repair, at_sites: s.at_sites, lent_today: Math.min(used, s.total), avail_today: Math.max(0, s.total - used) }; });
  }

  // ---------- 申請單輸出 ----------
  const reload = id => db.prepare('SELECT * FROM equip_requests WHERE id=?').get(id);
  function canView(r, u) {
    if (!u || r.tenant_id !== u.tenant_id) return false;
    if (r.applicant_id === u.id || isGA(u)) return true;
    if (parse(r.site_approver_ids_json, []).includes(u.id)) return true;
    return myCommunities(u).some(c => c.id === r.community_id) && !!['site_manager', 'site_deputy', 'region'].includes(mi(u)?.kind);
  }
  function out(r, u, { logs = false } = {}) {
    const t = todayTW(); const siteIds = parse(r.site_approver_ids_json, []); const ga = isGA(u); const mine = r.applicant_id === u.id;
    const o = {
      id: r.id, community_id: r.community_id, community_name: commName(r.community_id), applicant_id: r.applicant_id, applicant_name: nameOf(r.tenant_id, r.applicant_id),
      gkey: r.gkey, item_name: r.item_name, category: r.category, qty: r.qty, start_date: r.start_date, end_date: r.end_date, days: diffDays(r.start_date, r.end_date) + 1, purpose: r.purpose,
      status: r.status, status_label: STATUS[r.status] || r.status, overdue: r.status === 'lent' && r.end_date < t,
      site_approvers: siteIds.map(id => nameOf(r.tenant_id, id)).filter(Boolean), site_by: r.site_by, site_at: r.site_at, ga_by: r.ga_by, ga_at: r.ga_at,
      lent_by: r.lent_by, lent_at: r.lent_at, returned_by: r.returned_by, returned_at: r.returned_at, return_note: r.return_note, checked_by: r.checked_by, checked_at: r.checked_at,
      check_result: r.check_result, check_note: r.check_note, comment: r.comment, created_at: r.created_at,
      units: parse(r.units_json, []),
      can: {
        cancel: mine && ['pending_site', 'pending_ga', 'approved'].includes(r.status),
        site_decide: r.status === 'pending_site' && (siteIds.includes(u.id) || u.role === 'company_admin'),
        ga_decide: r.status === 'pending_ga' && ga,
        lend: r.status === 'approved' && ga,
        ret: r.status === 'lent' && (mine || ga),
        check: ['lent', 'returning'].includes(r.status) && ga,
      },
    };
    if (logs) o.logs = db.prepare('SELECT actor,action,note,created_at FROM equip_logs WHERE request_id=? ORDER BY id').all(r.id);
    return o;
  }
  // 逾期未還：提醒一次
  function sweep(tid) {
    const rows = db.prepare("SELECT * FROM equip_requests WHERE tenant_id=? AND status='lent' AND end_date<? AND COALESCE(overdue_notified,0)=0").all(tid, todayTW());
    for (const r of rows) {
      db.prepare('UPDATE equip_requests SET overdue_notified=1 WHERE id=?').run(r.id);
      notify(tid, null, [r.applicant_id, ...gaIds(tid)], '設備逾期未還', `⏰ ${r.item_name} ×${r.qty}（${commName(r.community_id)}，${nameOf(tid, r.applicant_id)} 借用）應於 ${r.end_date} 歸還，目前還沒有歸還，請盡快處理。`);
    }
  }

  // ---------- 出借時分配實際的設備（逐台：財產編號；依數量：分配到各筆） ----------
  function lentUnits(tid, gkey, excludeId) {
    const used = new Map();
    for (const r of db.prepare("SELECT units_json FROM equip_requests WHERE tenant_id=? AND gkey=? AND status IN ('lent','returning') AND id<>?").all(tid, gkey, excludeId || 0))
      for (const x of parse(r.units_json, [])) used.set(x.id, (used.get(x.id) || 0) + Number(x.qty || 1));
    return used;
  }
  function freeUnits(tid, gkey, excludeId) {
    const dep = deployed(tid, gkey); const used = lentUnits(tid, gkey, excludeId);
    return itemsOf(tid, gkey).filter(it => it.status === 'normal').map(it => ({ it, free: it.quantity - (dep.qtyByItem.get(it.id) || 0) - (used.get(it.id) || 0) })).filter(x => x.free > 0);
  }
  function allocate(tid, r, pick) {
    const free = freeUnits(tid, r.gkey, r.id); let need = r.qty; const units = [];
    const order = Array.isArray(pick) && pick.length ? [...free.filter(x => pick.includes(x.it.id)), ...free.filter(x => !pick.includes(x.it.id))] : free;
    for (const x of order) { if (need <= 0) break; const q = Math.min(need, x.free); units.push({ id: x.it.id, qty: q, asset_no: x.it.asset_no, name: x.it.name, track_mode: x.it.track_mode }); need -= q; }
    if (need > 0) throw err(`目前倉庫可出借的 ${r.item_name} 只有 ${r.qty - need} 個（可能還有人沒歸還或送修中）`);
    return units;
  }
  // 部分數量改狀態：數量比較多時拆成兩筆
  function splitStatus(it, n, status) {
    if (n <= 0) return; if (n >= it.quantity) { db.prepare('UPDATE equip_items SET status=?,updated_at=? WHERE id=?').run(status, now(), it.id); return; }
    db.prepare('UPDATE equip_items SET quantity=quantity-?,updated_at=? WHERE id=?').run(n, now(), it.id);
    db.prepare('INSERT INTO equip_items (tenant_id,gkey,name,category,brand_model,asset_no,track_mode,quantity,purchase_date,price,location,photo,photo_mime,status,note,is_active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)')
      .run(it.tenant_id, it.gkey, it.name, it.category, it.brand_model, it.asset_no, it.track_mode, n, it.purchase_date, it.price, it.location, it.photo, it.photo_mime, status, it.note, '系統拆分', now(), now());
  }

  // ---------- 社區進駐設備 ----------
  function siteItemOut(x) { return { id: x.id, community_id: x.community_id, item_id: x.item_id, gkey: x.gkey, name: x.name, category: x.category, brand_model: x.brand_model, asset_no: x.asset_no, qty: x.qty, source: x.source, owner: x.owner, request_id: x.request_id, note: x.note, status: x.status, placed_at: x.placed_at, placed_by: x.placed_by, removed_at: x.removed_at, removed_by: x.removed_by, removed_note: x.removed_note }; }
  function siteItems(tid, cid, withHistory) {
    const rows = db.prepare(`SELECT * FROM equip_site_items WHERE tenant_id=? AND community_id=? ${withHistory ? '' : "AND status='present'"} ORDER BY status DESC,category,name,asset_no,id`).all(tid, cid);
    return rows.map(siteItemOut);
  }

  // ---------- 申請 ----------
  function createRequest(u, b) {
    const tid = u.tenant_id; const cfg = settingsFor(tid);
    const cid = Number(b.community_id); if (!myCommunities(u).some(c => c.id === cid)) throw err('請選擇您所屬的社區');
    const gkey = str(b.gkey, 200); const items = itemsOf(tid, gkey); if (!items.length) throw err('找不到這項設備');
    const qty = int(b.qty, 1, 999, 1); const s = b.start_date, e = b.end_date;
    if (!isDate(s) || !isDate(e) || e < s) throw err('請選擇正確的借用期間');
    const t = todayTW(); if (s < t) throw err('借用開始日不能早於今天');
    if (diffDays(t, s) > cfg.horizon_days) throw err(`最多只能預約 ${cfg.horizon_days} 天內的日期`);
    const dur = diffDays(s, e) + 1; if (dur > cfg.max_days) throw err(`每次最多借 ${cfg.max_days} 天`);
    const a = availability(tid, gkey, s, dur);
    if (a.stock.total < qty) throw err(`${items[0].name} 可借用的總數只有 ${a.stock.total} 個`);
    const short = a.days.find(x => x.avail < qty);
    if (short) { const ea = earliest(tid, gkey, qty, dur, cfg.horizon_days); throw err(`${short.d} 只剩 ${short.avail} 個可以借${ea ? `，最早可以從 ${ea} 開始借 ${dur} 天` : ''}`, 409, { earliest: ea }); }
    const site = cfg.site_approval ? siteApprovers(tid, cid, u.id) : [];
    const status = site.length ? 'pending_site' : 'pending_ga';
    const info = db.prepare('INSERT INTO equip_requests (tenant_id,community_id,applicant_id,gkey,item_name,category,qty,start_date,end_date,purpose,status,site_approver_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tid, cid, u.id, gkey, items[0].name, items[0].category, qty, s, e, str(b.purpose, 300), status, JSON.stringify(site), now(), now());
    const id = Number(info.lastInsertRowid); log(tid, id, u, 'apply', `${items[0].name} ×${qty}，${s}～${e}`);
    const when = s === e ? s : `${s}～${e}`;
    if (status === 'pending_site') notify(tid, u, site, '設備借用申請', `🧰 ${u.name} 申請借用 ${items[0].name} ×${qty}（${commName(cid)}，${when}）。\n用途：${str(b.purpose, 300) || '—'}\n請到「設備申請 → 待我審核」同意或退回。`);
    else notify(tid, u, gaIds(tid), '設備借用申請', `🧰 ${u.name} 申請借用 ${items[0].name} ×${qty}（${commName(cid)}，${when}），請到「總務管理 → 設備申請紀錄」核准。`);
    return reload(id);
  }
  function getReq(req) { const r = db.prepare('SELECT * FROM equip_requests WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req)); if (!r) throw err('找不到這張申請', 404); return r; }

  // ================= 路由：申請人（現場 /api/staff、內勤 /api/company/my） =================
  for (const [base, mw] of [['/api/staff', requireStaff], ['/api/company/my', requireCompanyAdmin]]) {
    app.get(`${base}/equip/meta`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); sweep(tid); const cfg = settingsFor(tid);
      const comms = myCommunities(u);
      const approver = db.prepare("SELECT site_approver_ids_json FROM equip_requests WHERE tenant_id=? AND site_approver_ids_json<>'[]'").all(tid).some(r => parse(r.site_approver_ids_json, []).includes(u.id))
        || comms.some(c => siteApprovers(tid, c.id, -1).includes(u.id));
      const waiting = db.prepare("SELECT site_approver_ids_json FROM equip_requests WHERE tenant_id=? AND status='pending_site'").all(tid).filter(r => parse(r.site_approver_ids_json, []).includes(u.id)).length;
      res.set('Cache-Control', 'no-store');
      res.json({ settings: cfg, communities: comms, catalog: catalog(tid), is_site_approver: approver, waiting, is_ga: isGA(u), today: todayTW(), addon_apply: applyOn(tid) });
    }));
    app.get(`${base}/equip/availability`, mw, wrap((req, res) => {
      const tid = tenantId(req); const cfg = settingsFor(tid); const q = req.query || {};
      const gkey = str(q.gkey, 200); if (!itemsOf(tid, gkey).length) throw err('找不到這項設備', 404);
      const from = isDate(q.from) && q.from >= todayTW() ? q.from : todayTW();
      const days = int(q.days, 7, 120, 42); const qty = int(q.qty, 1, 999, 1); const dur = int(q.dur, 1, cfg.max_days, 1);
      const a = availability(tid, gkey, from, days, Number(q.exclude) || 0);
      const limit = addDays(todayTW(), cfg.horizon_days);
      res.json({ stock: { owned: a.stock.owned, total: a.stock.total, repair: a.stock.repair, at_sites: a.stock.at_sites }, days: a.days.map(x => ({ ...x, beyond: x.d > limit })), earliest: earliest(tid, gkey, qty, dur, cfg.horizon_days, Number(q.exclude) || 0), max_days: cfg.max_days, horizon_days: cfg.horizon_days });
    }));
    app.post(`${base}/equip/requests`, mw, wrap((req, res) => {
      const u = getUser(req); let r; tx(() => { r = createRequest(u, req.body || {}); })();
      res.json({ success: true, request: out(r, u) });
    }));
    app.get(`${base}/equip/requests`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); sweep(tid); const scope = String(req.query?.scope || 'mine');
      let rows;
      if (scope === 'approve') rows = db.prepare('SELECT * FROM equip_requests WHERE tenant_id=? ORDER BY id DESC LIMIT 500').all(tid).filter(r => parse(r.site_approver_ids_json, []).includes(u.id));
      else rows = db.prepare('SELECT * FROM equip_requests WHERE tenant_id=? AND applicant_id=? ORDER BY id DESC LIMIT 300').all(tid, u.id);
      res.set('Cache-Control', 'no-store'); res.json({ rows: rows.map(r => out(r, u)) });
    }));
    app.get(`${base}/equip/requests/:id`, mw, wrap((req, res) => { const u = getUser(req); const r = getReq(req); if (!canView(r, u)) throw err('您沒有權限查看這張申請', 403); res.json({ request: out(r, u, { logs: true }) }); }));
    app.post(`${base}/equip/requests/:id/site-decide`, mw, wrap((req, res) => {
      const u = getUser(req); const r = getReq(req); const o = out(r, u); if (!o.can.site_decide) throw err('這張申請目前不是由您審核', 403);
      const approve = !!req.body?.approve; const comment = str(req.body?.comment, 300); if (!approve && !comment) throw err('退回請寫原因');
      const tid = r.tenant_id;
      if (approve) {
        db.prepare("UPDATE equip_requests SET status='pending_ga',site_by=?,site_at=?,updated_at=? WHERE id=?").run(by(u), now(), now(), r.id); log(tid, r.id, u, 'site_approve', comment);
        notify(tid, u, gaIds(tid), '設備借用申請', `🧰 ${nameOf(tid, r.applicant_id)} 申請借用 ${r.item_name} ×${r.qty}（${commName(r.community_id)}，${r.start_date}～${r.end_date}），案場主管 ${u.name} 已同意，請到「總務管理 → 設備申請紀錄」核准。`);
      } else {
        db.prepare("UPDATE equip_requests SET status='rejected',site_by=?,site_at=?,comment=?,updated_at=? WHERE id=?").run(by(u), now(), comment, now(), r.id); log(tid, r.id, u, 'site_reject', comment);
        notify(tid, u, [r.applicant_id], '設備借用退回', `❌ 您借用 ${r.item_name} ×${r.qty}（${r.start_date}～${r.end_date}）的申請被案場主管退回。\n原因：${comment}`);
      }
      res.json({ success: true, request: out(reload(r.id), u) });
    }));
    app.post(`${base}/equip/requests/:id/cancel`, mw, wrap((req, res) => {
      const u = getUser(req); const r = getReq(req); if (!out(r, u).can.cancel) throw err('這張申請不能取消');
      db.prepare("UPDATE equip_requests SET status='cancelled',updated_at=? WHERE id=?").run(now(), r.id); log(r.tenant_id, r.id, u, 'cancel');
      if (r.status === 'pending_site') notify(r.tenant_id, u, parse(r.site_approver_ids_json, []), '設備借用取消', `↩ ${u.name} 取消了 ${r.item_name} ×${r.qty} 的借用申請。`);
      else notify(r.tenant_id, u, gaIds(r.tenant_id), '設備借用取消', `↩ ${u.name} 取消了 ${r.item_name} ×${r.qty}（${r.start_date}～${r.end_date}）的借用申請。`);
      res.json({ success: true });
    }));
    app.post(`${base}/equip/requests/:id/return`, mw, wrap((req, res) => {
      const u = getUser(req); const r = getReq(req); if (!out(r, u).can.ret) throw err('這張申請目前不能歸還');
      const note = str(req.body?.note, 300); const cfg = settingsFor(r.tenant_id);
      if (!cfg.return_check) { checkIn(r, u, { lines: [], note: note || '歸還（不需點收）' }); return res.json({ success: true, request: out(reload(r.id), u) }); }
      db.prepare("UPDATE equip_requests SET status='returning',returned_by=?,returned_at=?,return_note=?,updated_at=? WHERE id=?").run(by(u), now(), note, now(), r.id); log(r.tenant_id, r.id, u, 'return', note);
      notify(r.tenant_id, u, gaIds(r.tenant_id), '設備歸還', `📦 ${u.name} 已歸還 ${r.item_name} ×${r.qty}（${commName(r.community_id)}）${note ? `\n備註：${note}` : ''}\n請到「總務管理 → 設備申請紀錄」點收。`);
      res.json({ success: true, request: out(reload(r.id), u) });
    }));
    app.get(`${base}/equip/site-items`, mw, wrap((req, res) => {
      const u = getUser(req); const tid = tenantId(req); const cid = Number(req.query?.community_id);
      if (!isGA(u) && !myCommunities(u).some(c => c.id === cid)) throw err('您沒有這個社區的權限', 403);
      res.json({ community: { id: cid, name: commName(cid) }, rows: siteItems(tid, cid, false) });
    }));
    app.get(`${base}/equip/photo/:id`, mw, wrap((req, res) => {
      const it = db.prepare('SELECT * FROM equip_items WHERE id=? AND tenant_id=?').get(Number(req.params.id), tenantId(req)); if (!it?.photo) throw err('沒有照片', 404);
      const file = path.join(DIR, path.basename(it.photo)); if (!fs.existsSync(file)) throw err('照片不存在', 404);
      res.setHeader('Content-Type', it.photo_mime || 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=3600'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(file);
    }));
  }

  // 點收（歸檔）：數量恢復；損壞改「維修中」、遺失改「遺失」
  function checkIn(r, u, b) {
    const tid = r.tenant_id; const units = parse(r.units_json, []); const lines = Array.isArray(b.lines) ? b.lines : [];
    let damaged = 0, missing = 0; const notes = [];
    for (const un of units) {
      const ln = lines.find(x => Number(x.id) === un.id) || {}; const it = db.prepare('SELECT * FROM equip_items WHERE id=? AND tenant_id=?').get(un.id, tid); if (!it) continue;
      const dmg = int(ln.damaged, 0, un.qty, 0); const mis = int(ln.missing, 0, un.qty - dmg, 0);
      if (dmg) { splitStatus(it, dmg, 'repair'); damaged += dmg; notes.push(`${it.asset_no || it.name} 損壞 ${dmg}`); }
      const it2 = db.prepare('SELECT * FROM equip_items WHERE id=?').get(un.id);
      if (mis && it2) { splitStatus(it2, mis, 'lost'); missing += mis; notes.push(`${it.asset_no || it.name} 遺失 ${mis}`); }
    }
    const result = missing ? 'missing' : damaged ? 'damaged' : 'ok'; const note = [str(b.note, 300), ...notes].filter(Boolean).join('；');
    db.prepare("UPDATE equip_requests SET status='closed',checked_by=?,checked_at=?,check_result=?,check_note=?,returned_at=COALESCE(returned_at,?),returned_by=CASE WHEN COALESCE(returned_by,'')='' THEN ? ELSE returned_by END,updated_at=? WHERE id=?")
      .run(by(u), now(), result, note, now(), by(u), now(), r.id);
    db.prepare("UPDATE equip_site_items SET status='removed',removed_at=?,removed_by=?,removed_note='借用歸還' WHERE tenant_id=? AND request_id=? AND status='present'").run(now(), by(u), tid, r.id);
    log(tid, r.id, u, 'check', note || '點收無誤');
    notify(tid, u, [r.applicant_id], '設備點收完成', `✅ ${r.item_name} ×${r.qty} 已點收歸檔${result === 'ok' ? '，謝謝！' : `。\n點收結果：${note}`}`);
  }

  // ================= 路由：公司總務 =================
  const needGA = (req, res, next) => { if (!isGA(getUser(req))) return bad(res, '需要「總務管理」權限', 403); next(); };
  const upload = multer({
    storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, DIR), filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' })[file.mimetype] || '.img'}`) }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => /^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error('設備照片請上傳圖片')),
  }).single('photo');
  const withUpload = fn => (req, res) => upload(req, res, e => { if (e) return bad(res, e.code === 'LIMIT_FILE_SIZE' ? '照片太大了（最多 8MB）' : e.message || '上傳失敗'); wrap(fn)(req, res); });
  const fileOf = req => req.file || (Array.isArray(req.files) ? req.files[0] : null);

  app.get('/api/company/equip/meta', requireCompanyAdmin, needGA, wrap((req, res) => {
    const tid = tenantId(req); sweep(tid);
    const cnt = s => db.prepare('SELECT COUNT(*) c FROM equip_requests WHERE tenant_id=? AND status=?').get(tid, s).c;
    const overdue = db.prepare("SELECT COUNT(*) c FROM equip_requests WHERE tenant_id=? AND status='lent' AND end_date<?").get(tid, todayTW()).c;
    res.set('Cache-Control', 'no-store');
    res.json({ addon_apply: applyOn(tid), settings: settingsFor(tid), communities: allCommunities(tid), item_status: ITEM_STATUS, status: STATUS, counts: { pending_site: cnt('pending_site'), pending_ga: cnt('pending_ga'), approved: cnt('approved'), lent: cnt('lent'), returning: cnt('returning'), overdue }, is_admin: getUser(req).role === 'company_admin', today: todayTW() });
  }));
  app.put('/api/company/equip/categories', requireCompanyAdmin, needGA, wrap((req, res) => {
    const tid = tenantId(req); const cur = settingsFor(tid); const cats = Array.isArray(req.body?.categories) ? req.body.categories : [];
    res.json({ success: true, settings: saveSettings(tid, { ...cur, categories: cats }, by(getUser(req))) });
  }));

  // ---- 設備清冊 ----
  function itemOut(it, extra = {}) { return { id: it.id, gkey: it.gkey, name: it.name, category: it.category, brand_model: it.brand_model, asset_no: it.asset_no, track_mode: it.track_mode, quantity: it.quantity, purchase_date: it.purchase_date, price: it.price, location: it.location, has_photo: !!it.photo, status: it.status, status_label: ITEM_STATUS[it.status] || it.status, note: it.note, created_at: it.created_at, updated_at: it.updated_at, ...extra }; }
  app.get('/api/company/equip/items', requireCompanyAdmin, needGA, wrap((req, res) => {
    const tid = tenantId(req); const rows = db.prepare('SELECT * FROM equip_items WHERE tenant_id=? AND is_active=1 ORDER BY category,name,brand_model,asset_no,id').all(tid);
    const t = todayTW(); const cache = new Map();
    const where = new Map(); // 物品目前在哪裡
    for (const r of db.prepare("SELECT * FROM equip_site_items WHERE tenant_id=? AND status='present' AND item_id IS NOT NULL").all(tid)) { const l = where.get(r.item_id) || []; l.push({ community: commName(r.community_id), qty: r.qty, source: r.source }); where.set(r.item_id, l); }
    for (const r of db.prepare("SELECT * FROM equip_requests WHERE tenant_id=? AND status IN ('lent','returning')").all(tid)) for (const un of parse(r.units_json, [])) { const l = where.get(un.id) || []; if (!l.some(x => x.request_id === r.id)) l.push({ community: commName(r.community_id), qty: un.qty, source: 'loan', request_id: r.id, until: r.end_date, overdue: r.status === 'lent' && r.end_date < t }); where.set(un.id, l); }
    const groups = new Map();
    for (const it of rows) { if (!cache.has(it.gkey)) { const s = stock(tid, it.gkey); const used = usedOn(reservations(tid, it.gkey), t); cache.set(it.gkey, { total: s.total, owned: s.owned, repair: s.repair, at_sites: s.at_sites, lent_today: Math.min(used, s.total), avail_today: Math.max(0, s.total - used) }); } }
    for (const it of rows) { if (!groups.has(it.gkey)) groups.set(it.gkey, { gkey: it.gkey, name: it.name, category: it.category, brand_model: it.brand_model, ...cache.get(it.gkey), items: [] }); groups.get(it.gkey).items.push(itemOut(it, { where: where.get(it.id) || [] })); }
    res.set('Cache-Control', 'no-store'); res.json({ groups: [...groups.values()] });
  }));
  function readItem(b, cfg) {
    const name = str(b.name, 60); if (!name) throw err('請填寫設備名稱');
    const category = str(b.category, 20); if (category && !cfg.categories.includes(category)) throw err('請選擇公司設定的分類');
    const price = Math.max(0, Math.round(Number(b.price) || 0)); const pd = isDate(b.purchase_date) ? b.purchase_date : '';
    const status = ITEM_STATUS[b.status] ? b.status : 'normal';
    return { name, category, brand_model: str(b.brand_model, 80), purchase_date: pd, price, location: str(b.location, 80), status, note: str(b.note, 300) };
  }
  app.post('/api/company/equip/items', requireCompanyAdmin, needGA, withUpload((req, res) => {
    const u = getUser(req); const tid = tenantId(req); const cfg = settingsFor(tid); const b = req.body || {}; const f = fileOf(req);
    const x = readItem(b, cfg); const mode = b.track_mode === 'unit' ? 'unit' : 'qty'; const qty = int(b.quantity, 1, 9999, 1); const gkey = gkeyOf(x);
    const ins = db.prepare('INSERT INTO equip_items (tenant_id,gkey,name,category,brand_model,asset_no,track_mode,quantity,purchase_date,price,location,photo,photo_mime,status,note,is_active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)');
    const ids = [];
    tx(() => {
      if (mode === 'unit') {
        if (qty > 200) throw err('逐台登記一次最多 200 台');
        const list = String(b.asset_nos || '').split(/[\s,，、]+/).map(s => str(s, 40)).filter(Boolean);
        const prefix = str(b.asset_prefix, 30); const start = int(b.asset_start, 1, 99999, 1); const width = Math.max(3, String(start + qty - 1).length);
        for (let i = 0; i < qty; i++) {
          const no = list[i] || (prefix ? `${prefix}-${String(start + i).padStart(width, '0')}` : qty === 1 ? str(b.asset_no, 40) : '');
          if (no && db.prepare('SELECT 1 FROM equip_items WHERE tenant_id=? AND asset_no=? AND is_active=1').get(tid, no)) throw err(`財產編號 ${no} 已經用過了`);
          ids.push(Number(ins.run(tid, gkey, x.name, x.category, x.brand_model, no, 'unit', 1, x.purchase_date, x.price, x.location, f?.filename || '', f?.mimetype || '', x.status, x.note, by(u), now(), now()).lastInsertRowid));
        }
      } else ids.push(Number(ins.run(tid, gkey, x.name, x.category, x.brand_model, str(b.asset_no, 40), 'qty', qty, x.purchase_date, x.price, x.location, f?.filename || '', f?.mimetype || '', x.status, x.note, by(u), now(), now()).lastInsertRowid));
    })();
    res.json({ success: true, ids, gkey });
  }));
  app.put('/api/company/equip/items/:id', requireCompanyAdmin, needGA, withUpload((req, res) => {
    const tid = tenantId(req); const cfg = settingsFor(tid); const it = db.prepare('SELECT * FROM equip_items WHERE id=? AND tenant_id=? AND is_active=1').get(Number(req.params.id), tid); if (!it) throw err('找不到這筆設備', 404);
    const b = req.body || {}; const f = fileOf(req); const x = readItem({ ...itemOut(it), ...b }, cfg); const gkey = gkeyOf(x);
    let qty = it.quantity; if (it.track_mode === 'qty' && b.quantity !== undefined) qty = int(b.quantity, 0, 99999, it.quantity);
    const asset = b.asset_no !== undefined ? str(b.asset_no, 40) : it.asset_no;
    if (asset && asset !== it.asset_no && db.prepare('SELECT 1 FROM equip_items WHERE tenant_id=? AND asset_no=? AND is_active=1 AND id<>?').get(tid, asset, it.id)) throw err(`財產編號 ${asset} 已經用過了`);
    const busy = lentUnits(tid, it.gkey).get(it.id) || 0;
    if (gkey !== it.gkey && busy) throw err('這筆設備目前借出中，歸還後才能改名稱、分類或型號');
    if (qty < busy) throw err(`目前有 ${busy} 個借出中，數量不能少於 ${busy}`);
    if (x.status !== 'normal' && busy) throw err('這筆設備目前借出中，歸還點收後再改狀態');
    tx(() => {
      db.prepare('UPDATE equip_items SET gkey=?,name=?,category=?,brand_model=?,asset_no=?,quantity=?,purchase_date=?,price=?,location=?,status=?,note=?,updated_at=? WHERE id=?')
        .run(gkey, x.name, x.category, x.brand_model, asset, qty, x.purchase_date, x.price, x.location, x.status, x.note, now(), it.id);
      if (f) db.prepare('UPDATE equip_items SET photo=?,photo_mime=? WHERE id=?').run(f.filename, f.mimetype, it.id);
      // 同一組的其他設備套用同一張照片（逐台登記時通常同款）
      if (f && b.photo_all) db.prepare("UPDATE equip_items SET photo=?,photo_mime=? WHERE tenant_id=? AND gkey=? AND COALESCE(photo,'')=''").run(f.filename, f.mimetype, tid, gkey);
      if (gkey !== it.gkey && b.apply_group) db.prepare('UPDATE equip_items SET gkey=?,name=?,category=?,brand_model=?,updated_at=? WHERE tenant_id=? AND gkey=? AND is_active=1').run(gkey, x.name, x.category, x.brand_model, now(), tid, it.gkey);
    })();
    res.json({ success: true });
  }));
  app.delete('/api/company/equip/items/:id', requireCompanyAdmin, needGA, wrap((req, res) => {
    const tid = tenantId(req); const it = db.prepare('SELECT * FROM equip_items WHERE id=? AND tenant_id=? AND is_active=1').get(Number(req.params.id), tid); if (!it) throw err('找不到這筆設備', 404);
    if (lentUnits(tid, it.gkey).get(it.id)) throw err('這筆設備目前借出中，不能刪除');
    if (db.prepare("SELECT 1 FROM equip_site_items WHERE item_id=? AND status='present'").get(it.id)) throw err('這筆設備目前進駐在社區，請先撤回');
    db.prepare('UPDATE equip_items SET is_active=0,updated_at=? WHERE id=?').run(now(), it.id);
    res.json({ success: true });
  }));

  // ---- 設備申請紀錄（依社區查詢）----
  app.get('/api/company/equip/requests', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const tid = tenantId(req); sweep(tid); const q = req.query || {}; const args = [tid]; let where = 'tenant_id=?';
    if (Number(q.community_id)) { where += ' AND community_id=?'; args.push(Number(q.community_id)); }
    const G = { todo: ['pending_site', 'pending_ga', 'approved', 'returning'], open: ['pending_site', 'pending_ga', 'approved', 'lent', 'returning'], lent: ['lent'], done: ['closed', 'rejected', 'cancelled'] };
    if (G[q.group]) { where += ` AND status IN (${G[q.group].map(() => '?').join(',')})`; args.push(...G[q.group]); }
    else if (STATUS[q.status]) { where += ' AND status=?'; args.push(q.status); }
    if (/^\d{4}-\d{2}$/.test(q.month || '')) { where += ' AND start_date<=? AND end_date>=?'; args.push(`${q.month}-31`, `${q.month}-01`); }
    if (q.gkey) { where += ' AND gkey=?'; args.push(str(q.gkey, 200)); }
    const rows = db.prepare(`SELECT * FROM equip_requests WHERE ${where} ORDER BY CASE status WHEN 'pending_ga' THEN 0 WHEN 'returning' THEN 1 WHEN 'approved' THEN 2 WHEN 'lent' THEN 3 WHEN 'pending_site' THEN 4 ELSE 5 END, start_date DESC, id DESC LIMIT 800`).all(...args);
    res.set('Cache-Control', 'no-store'); res.json({ rows: rows.map(r => out(r, u)) });
  }));
  app.get('/api/company/equip/requests/:id', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); const o = out(r, u, { logs: true });
    if (r.status === 'approved') o.free_units = freeUnits(r.tenant_id, r.gkey, r.id).map(x => ({ id: x.it.id, asset_no: x.it.asset_no, name: x.it.name, track_mode: x.it.track_mode, free: x.free, location: x.it.location }));
    res.json({ request: o });
  }));
  app.post('/api/company/equip/requests/:id/ga-decide', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (r.status !== 'pending_ga') throw err('這張申請目前不是待總務核准');
    const approve = !!req.body?.approve; const comment = str(req.body?.comment, 300); const tid = r.tenant_id;
    if (approve) {
      // 核准前再檢查一次數量（期間內有人報修／撤回時）
      const a = availability(tid, r.gkey, r.start_date, diffDays(r.start_date, r.end_date) + 1, r.id); const short = a.days.find(x => x.avail < r.qty);
      if (short) throw err(`${short.d} 只剩 ${short.avail} 個可以借，無法核准（請退回或調整清冊）`);
      db.prepare("UPDATE equip_requests SET status='approved',ga_by=?,ga_at=?,comment=?,updated_at=? WHERE id=?").run(by(u), now(), comment, now(), r.id); log(tid, r.id, u, 'ga_approve', comment);
      notify(tid, u, [r.applicant_id], '設備借用核准', `✅ 您借用 ${r.item_name} ×${r.qty}（${r.start_date}～${r.end_date}）的申請已核准，總務出借後會再通知您。${comment ? `\n備註：${comment}` : ''}`);
    } else {
      if (!comment) throw err('退回請寫原因');
      db.prepare("UPDATE equip_requests SET status='rejected',ga_by=?,ga_at=?,comment=?,updated_at=? WHERE id=?").run(by(u), now(), comment, now(), r.id); log(tid, r.id, u, 'ga_reject', comment);
      notify(tid, u, [r.applicant_id, ...parse(r.site_approver_ids_json, [])], '設備借用退回', `❌ ${nameOf(tid, r.applicant_id)} 借用 ${r.item_name} ×${r.qty}（${r.start_date}～${r.end_date}）的申請被總務退回。\n原因：${comment}`);
    }
    res.json({ success: true, request: out(reload(r.id), u) });
  }));
  app.post('/api/company/equip/requests/:id/lend', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (r.status !== 'approved') throw err('這張申請還沒核准或已經出借');
    const tid = r.tenant_id; let units;
    tx(() => {
      units = allocate(tid, r, (req.body?.unit_ids || []).map(Number));
      db.prepare("UPDATE equip_requests SET status='lent',units_json=?,lent_by=?,lent_at=?,updated_at=? WHERE id=?").run(JSON.stringify(units), by(u), now(), now(), r.id);
      const ins = db.prepare("INSERT INTO equip_site_items (tenant_id,community_id,item_id,gkey,name,category,brand_model,asset_no,qty,source,owner,request_id,note,status,placed_at,placed_by) VALUES (?,?,?,?,?,?,?,?,?,'loan','company',?,?,'present',?,?)");
      for (const un of units) { const it = db.prepare('SELECT * FROM equip_items WHERE id=?').get(un.id); ins.run(tid, r.community_id, un.id, r.gkey, it.name, it.category, it.brand_model, it.asset_no, un.qty, r.id, `借用至 ${r.end_date}`, now(), by(u)); }
      log(tid, r.id, u, 'lend', units.map(x => x.asset_no ? x.asset_no : `${x.name} ×${x.qty}`).join('、'));
    })();
    notify(tid, u, [r.applicant_id], '設備已出借', `📦 ${r.item_name} ×${r.qty} 已出借給您（${commName(r.community_id)}）${units.some(x => x.asset_no) ? `\n財產編號：${units.map(x => x.asset_no).filter(Boolean).join('、')}` : ''}\n請在 ${r.end_date} 前歸還，歸還後到「設備申請 → 我的申請」按「已歸還」。`);
    res.json({ success: true, request: out(reload(r.id), u) });
  }));
  app.post('/api/company/equip/requests/:id/check', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const r = getReq(req); if (!['lent', 'returning'].includes(r.status)) throw err('這張申請目前不能點收');
    tx(() => checkIn(r, u, req.body || {}))();
    res.json({ success: true, request: out(reload(r.id), u) });
  }));

  // ---- 社區進駐設備 ----
  app.get('/api/company/equip/sites', requireCompanyAdmin, needGA, wrap((req, res) => {
    const tid = tenantId(req); const rows = db.prepare("SELECT community_id, COUNT(*) n, SUM(qty) q, SUM(CASE WHEN source='loan' THEN qty ELSE 0 END) loan FROM equip_site_items WHERE tenant_id=? AND status='present' GROUP BY community_id").all(tid);
    res.json({ rows: allCommunities(tid).map(c => { const x = rows.find(r => r.community_id === c.id); return { id: c.id, name: c.name, lines: x?.n || 0, qty: x?.q || 0, loan: x?.loan || 0 }; }) });
  }));
  app.get('/api/company/equip/sites/:cid', requireCompanyAdmin, needGA, wrap((req, res) => {
    const tid = tenantId(req); const cid = Number(req.params.cid); if (!db.prepare('SELECT 1 FROM communities WHERE id=? AND tenant_id=?').get(cid, tid)) throw err('找不到社區', 404);
    const tenant = db.prepare('SELECT name FROM tenants WHERE id=?').get(tid)?.name || '';
    res.json({ community: { id: cid, name: commName(cid) }, tenant, rows: siteItems(tid, cid, true) });
  }));
  // 進駐：從設備清冊帶進社區（公司財產），或登記社區自有的設備
  app.post('/api/company/equip/sites/:cid/items', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const tid = tenantId(req); const cid = Number(req.params.cid); if (!db.prepare('SELECT 1 FROM communities WHERE id=? AND tenant_id=?').get(cid, tid)) throw err('找不到社區', 404);
    const b = req.body || {}; const note = str(b.note, 200); const t = now();
    const ins = db.prepare("INSERT INTO equip_site_items (tenant_id,community_id,item_id,gkey,name,category,brand_model,asset_no,qty,source,owner,note,status,placed_at,placed_by) VALUES (?,?,?,?,?,?,?,?,?,'move_in',?,?,'present',?,?)");
    let added = 0;
    tx(() => {
      if (b.gkey) {
        const gkey = str(b.gkey, 200); const qty = int(b.qty, 1, 9999, 1);
        const free = freeUnits(tid, gkey); const pick = (b.unit_ids || []).map(Number);
        // 從現在起被預約的數量也要保留，避免進駐後別人的借用不夠
        const a = availability(tid, gkey, todayTW(), 180); const can = Math.min(free.reduce((s, x) => s + x.free, 0), a.stock.total - Math.max(0, ...a.days.map(x => x.used)));
        if (qty > can) throw err(`倉庫可進駐的數量只有 ${Math.max(0, can)} 個（其他已借出、預約或進駐在別的社區）`);
        let need = qty; const order = pick.length ? [...free.filter(x => pick.includes(x.it.id)), ...free.filter(x => !pick.includes(x.it.id))] : free;
        for (const x of order) { if (need <= 0) break; const q = Math.min(need, x.free); ins.run(tid, cid, x.it.id, gkey, x.it.name, x.it.category, x.it.brand_model, x.it.asset_no, q, 'company', note, t, by(u)); need -= q; added++; }
      } else {
        const name = str(b.name, 60); if (!name) throw err('請填寫設備名稱');
        const owner = b.owner === 'company' ? 'company' : 'community';
        ins.run(tid, cid, null, '', name, str(b.category, 20), str(b.brand_model, 80), str(b.asset_no, 40), int(b.qty, 1, 9999, 1), owner, note, t, by(u)); added++;
      }
    })();
    res.json({ success: true, added });
  }));
  app.post('/api/company/equip/sites/:cid/items/:id/remove', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const tid = tenantId(req); const x = db.prepare("SELECT * FROM equip_site_items WHERE id=? AND tenant_id=? AND community_id=? AND status='present'").get(Number(req.params.id), tid, Number(req.params.cid));
    if (!x) throw err('找不到這筆進駐設備', 404); if (x.source === 'loan') throw err('借用的設備請到「設備申請紀錄」點收歸還');
    db.prepare("UPDATE equip_site_items SET status='removed',removed_at=?,removed_by=?,removed_note=? WHERE id=?").run(now(), by(u), str(req.body?.note, 200) || '撤回', x.id);
    res.json({ success: true });
  }));
  // 撤場：社區所有進駐設備一次撤回（借用中的設備仍需走歸還點收）
  app.post('/api/company/equip/sites/:cid/move-out', requireCompanyAdmin, needGA, wrap((req, res) => {
    const u = getUser(req); const tid = tenantId(req); const cid = Number(req.params.cid);
    const loans = db.prepare("SELECT COUNT(*) c FROM equip_site_items WHERE tenant_id=? AND community_id=? AND status='present' AND source='loan'").get(tid, cid).c;
    const info = db.prepare("UPDATE equip_site_items SET status='removed',removed_at=?,removed_by=?,removed_note=? WHERE tenant_id=? AND community_id=? AND status='present' AND source='move_in'").run(now(), by(u), str(req.body?.note, 200) || '撤場點交', tid, cid);
    res.json({ success: true, removed: info.changes, loans_left: loans });
  }));

  // ================= 總後台：各公司設備管理設定 =================
  if (requireSuperAdmin) {
    app.get('/api/admin/equip-settings', requireSuperAdmin, wrap((req, res) => {
      const custom = new Set(db.prepare('SELECT tenant_id FROM equip_settings').all().map(x => x.tenant_id));
      res.json({ tenants: db.prepare('SELECT id,name,code FROM tenants ORDER BY id').all().map(t => ({ ...t, customized: custom.has(t.id) })), defaults: DEFAULTS });
    }));
    app.get('/api/admin/equip-settings/:tid', requireSuperAdmin, wrap((req, res) => {
      const tid = Number(req.params.tid); const r = db.prepare('SELECT updated_at,updated_by FROM equip_settings WHERE tenant_id=?').get(tid);
      const stats = { items: db.prepare('SELECT COUNT(*) c FROM equip_items WHERE tenant_id=? AND is_active=1').get(tid).c, requests: db.prepare('SELECT COUNT(*) c FROM equip_requests WHERE tenant_id=?').get(tid).c };
      res.json({ settings: settingsFor(tid), customized: !!r, updated_at: r?.updated_at || '', updated_by: r?.updated_by || '', stats, defaults: DEFAULTS });
    }));
    app.put('/api/admin/equip-settings/:tid', requireSuperAdmin, wrap((req, res) => { res.json({ success: true, settings: saveSettings(Number(req.params.tid), req.body || {}, '系統總後台') }); }));
    app.delete('/api/admin/equip-settings/:tid', requireSuperAdmin, wrap((req, res) => { db.prepare('DELETE FROM equip_settings WHERE tenant_id=?').run(Number(req.params.tid)); res.json({ success: true, settings: normalize(null) }); }));
  }

  // 首頁儀表板用
  function dashboard(tid) {
    sweep(tid); const cnt = s => db.prepare('SELECT COUNT(*) c FROM equip_requests WHERE tenant_id=? AND status=?').get(tid, s).c;
    return { pending_ga: cnt('pending_ga'), approved: cnt('approved'), lent: cnt('lent'), returning: cnt('returning'), overdue: db.prepare("SELECT COUNT(*) c FROM equip_requests WHERE tenant_id=? AND status='lent' AND end_date<?").get(tid, todayTW()).c, repair: db.prepare("SELECT COALESCE(SUM(quantity),0) c FROM equip_items WHERE tenant_id=? AND is_active=1 AND status='repair'").get(tid).c };
  }
  return { dashboard, isGA, settingsFor };
};
