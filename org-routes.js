// 組織架構：職位、區域、人員歸屬與上下級關係。
// - 總後台：各公司的部門與職位（名稱自訂，類型由系統決定）
// - 公司：社區分區域、開通人員（選職位 → 社區／區域／班別）、組織圖、副主管代理設定
// - 其他模組（請假審核、班表、SOP）透過 relations() / memberInfo() 取得「誰是誰的主管」
'use strict';
const OM = require('./org-model');

module.exports = function registerOrgRoutes(app, d) {
  const { db, getUser, tenantId, now, requireCompanyAdmin, requireCompanyPermission, requireSuperAdmin, getSiteAssignments, syncWorkAssignments, guardSensitivePermissions, parsePermissions, PERMISSION_LABELS, COMPANY_KEYS, SITE_KEYS } = d;

  db.exec(`
  CREATE TABLE IF NOT EXISTS org_settings (tenant_id INTEGER PRIMARY KEY, config_json TEXT, prefs_json TEXT DEFAULT '{}', updated_at TEXT, updated_by TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS org_regions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0, created_at TEXT);
  CREATE TABLE IF NOT EXISTS org_members (tenant_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, position_id TEXT NOT NULL, shift TEXT DEFAULT '', region_ids_json TEXT DEFAULT '[]', updated_at TEXT, PRIMARY KEY (tenant_id,staff_id));
  `);
  { const cols = db.prepare('PRAGMA table_info(staff_users)').all().map(c => c.name); if (!cols.includes('must_change_password')) db.exec('ALTER TABLE staff_users ADD COLUMN must_change_password INTEGER DEFAULT 0'); }
  { const cols = db.prepare('PRAGMA table_info(communities)').all().map(c => c.name); if (!cols.includes('region_id')) db.exec('ALTER TABLE communities ADD COLUMN region_id INTEGER'); }

  const parse = (v, f) => { try { const x = JSON.parse(v || ''); return x ?? f; } catch { return f; } };
  const str = (v, m = 60) => String(v ?? '').trim().slice(0, m);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); }); } catch (e) { if (!res.headersSent) bad(res, e.message || '操作失敗', e.status || 400); } };
  const tx = fn => (db.transaction ? db.transaction(fn) : fn);
  const digits = v => String(v || '').replace(/\D/g, '');

  // ---------- 設定 ----------
  function configFor(tid) { const r = db.prepare('SELECT config_json FROM org_settings WHERE tenant_id=?').get(tid); return OM.normalize(r?.config_json ? parse(r.config_json, null) : null); }
  function prefsFor(tid) { const r = db.prepare('SELECT prefs_json FROM org_settings WHERE tenant_id=?').get(tid); const p = parse(r?.prefs_json, {}) || {}; return { deputy_proxy: ['none', 'absent', 'always', 'dept_notify'].includes(p.deputy_proxy) ? p.deputy_proxy : 'none' }; }
  const posOf = (cfg, id) => cfg.positions.find(p => p.id === id) || null;

  // ---------- 人員歸屬 ----------
  function memberRow(tid, sid) { return db.prepare('SELECT * FROM org_members WHERE tenant_id=? AND staff_id=?').get(tid, sid) || null; }
  function memberInfo(u, cfg) {
    if (!u) return null; const m = memberRow(u.tenant_id, u.id); if (!m) return null;
    cfg = cfg || configFor(u.tenant_id); const p = posOf(cfg, m.position_id); if (!p) return null;
    const regions = parse(m.region_ids_json, []).map(Number);
    const sites = p.kind === 'region' ? [] : getSiteAssignments(u).map(a => Number(a.community_id)).filter(Boolean);
    return { position: p, kind: p.kind, dept: p.dept, shift: p.shift || m.shift || '', schedule: p.schedule, regions, sites };
  }
  function people(tid, cfg) {
    cfg = cfg || configFor(tid);
    const rows = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active'").all(tid);
    return rows.map(u => ({ u, m: memberInfo(u, cfg) })).filter(x => x.m);
  }
  const regionOf = cid => db.prepare('SELECT region_id FROM communities WHERE id=?').get(cid)?.region_id || null;
  const ids = list => [...new Set(list.map(x => x.u.id))];

  // 上級關係：現場主管、副主管、區域督導、職務主管（部門線）、部門主管、直屬主管
  function relations(tid, sid, cfg) {
    cfg = cfg || configFor(tid);
    const me = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid); const mi = memberInfo(me, cfg);
    const all = people(tid, cfg).filter(x => x.u.id !== sid);
    const out = { site: [], deputies: [], region: [], dept: [], dept_head: [], gm: [], owner: [], direct: [] };
    out.gm = ids(all.filter(x => x.m.kind === 'gm')); out.owner = ids(all.filter(x => x.m.kind === 'owner'));
    if (!mi) { out.direct = out.gm.length ? out.gm : out.owner; return { ...out, member: null }; }
    const k = mi.kind, sites = new Set(mi.sites);
    const atSite = x => x.m.sites.some(c => sites.has(c));
    if (['site_deputy', 'site_staff'].includes(k)) out.site = ids(all.filter(x => x.m.kind === 'site_manager' && atSite(x)));
    if (k === 'site_staff') out.deputies = ids(all.filter(x => x.m.kind === 'site_deputy' && atSite(x) && x.m.dept === mi.dept));
    else if (k === 'site_manager') out.deputies = [];
    const myRegions = new Set(k === 'region' ? [] : mi.sites.map(regionOf).filter(Boolean));
    if (myRegions.size) out.region = ids(all.filter(x => x.m.kind === 'region' && x.m.regions.some(r => myRegions.has(r))));
    if (mi.dept) out.dept_head = ids(all.filter(x => x.m.kind === 'dept_head' && x.m.dept === mi.dept));
    const top = out.gm.length ? out.gm : out.owner;
    if (k === 'dept_head') out.dept = top;
    else if (k === 'dept_manager') out.dept = out.dept_head.length ? out.dept_head : top;
    else if (k === 'gm') out.dept = out.owner;
    else if (k !== 'owner') {
      const lines = mi.dept ? ids(all.filter(x => x.m.kind === 'dept_manager' && x.m.dept === mi.dept && (!x.m.shift || !mi.shift || x.m.shift === mi.shift))) : [];
      out.dept = lines.length ? lines : out.dept_head.length ? out.dept_head : top;
    }
    // 直屬主管：沒有現場主管時往上找
    const chain = { site_staff: [out.deputies, out.site, out.region, out.dept], site_deputy: [out.site, out.region, out.dept], site_manager: [out.region, out.dept_head], mobile: [out.dept], region: [out.dept_head, out.gm], dept_manager: [out.dept_head, out.gm], dept_head: [out.gm, out.owner], office: [out.dept_head, out.gm], gm: [out.owner], owner: [] }[k] || [out.gm];
    out.direct = (chain.find(l => l && l.length) || []).slice();
    return { ...out, member: mi };
  }

  // 請假審核用：依關卡類型找審核人
  function resolveLeaveStep(tid, applicant, step, prefs) {
    const cfg = configFor(tid); const r = relations(tid, applicant.id, cfg); prefs = prefs || prefsFor(tid);
    const by = step.by;
    if (by === 'site') {
      if (!r.member) return { approvers: [], skipped: true, note: '沒有設定職位' };
      if (r.site.length) {
        if (prefs.deputy_proxy === 'dept_notify') return { approvers: [], skipped: true, notify: r.site, note: '由部門直接審核並知會現場主管' };
        const deputies = ids(people(tid, cfg).filter(x => x.m.kind === 'site_deputy' && x.m.sites.some(c => r.member.sites.includes(c)) && x.u.id !== applicant.id));
        if (prefs.deputy_proxy === 'always') return { approvers: [...new Set([...r.site, ...deputies])] };
        if (prefs.deputy_proxy === 'absent') return { approvers: r.site, proxies: deputies };
        return { approvers: r.site };
      }
      return { approvers: r.direct, note: '沒有現場主管，由直屬主管審核' };
    }
    if (by === 'dept') return { approvers: r.dept };
    if (by === 'region') return { approvers: r.region };
    if (by === 'direct') return { approvers: r.direct };
    if (by === 'position') return { approvers: ids(people(tid, cfg).filter(x => x.m.position.id === step.position && x.u.id !== applicant.id)), company: true };
    return null; // people：由請假模組自己處理
  }

  // ---------- 寫入人員：職位 → 舊欄位（工作類型、職務類別、位階、權限、案場） ----------
  function legacyFor(p, perms) {
    const K = OM.KINDS[p.kind];
    const level = p.kind === 'site_manager' ? '經理' : p.kind === 'site_deputy' ? '副理' : ['owner', 'gm', 'dept_head', 'dept_manager', 'region'].includes(p.kind) ? '主管' : '一般';
    let cats;
    if (p.schedule === 'security') cats = ['保全'];
    else if (p.kind === 'mobile') cats = ['機動', p.dept === 'secretary' ? '秘書' : '保全'];
    else if (p.kind === 'site_manager' || (p.kind === 'site_deputy' && p.dept !== 'secretary')) cats = ['社區管理'];
    else if (['site_deputy', 'site_staff'].includes(p.kind)) cats = ['秘書'];
    else cats = [perms.includes('company-accounting') || perms.includes('company-finance') ? '會計' : perms.includes('company-hr') ? '人事' : perms.includes('company-general-affairs') ? '總務' : p.dept === 'duty' ? '勤務' : '其他'];
    return { work_type: K.work, job_level: level, job_categories: cats };
  }
  function regionCommunities(tid, regionIds) { if (!regionIds.length) return []; return db.prepare(`SELECT id FROM communities WHERE tenant_id=? AND status='active' AND region_id IN (${regionIds.map(() => '?').join(',')})`).all(tid, ...regionIds).map(x => x.id); }
  function applyMember(tid, staffId, b, actor) {
    const cfg = configFor(tid); const p = posOf(cfg, b.position_id); if (!p) throw err('請選擇職位');
    const K = OM.KINDS[p.kind]; const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(staffId, tid); if (!u) throw err('找不到人員', 404);
    const valid = new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tid).map(x => x.id));
    let sites = [...new Set((Array.isArray(b.community_ids) ? b.community_ids : []).map(Number).filter(x => valid.has(x)))];
    const regionIds = [...new Set((Array.isArray(b.region_ids) ? b.region_ids : []).map(Number))].filter(x => db.prepare('SELECT 1 FROM org_regions WHERE id=? AND tenant_id=?').get(x, tid));
    if (K.sites === 'one' && sites.length !== 1) throw err(`「${p.name}」要選擇一個所屬社區`);
    if (K.sites === 'many' && !sites.length) throw err(`「${p.name}」至少要選擇一個支援的社區`);
    if (K.regions && !regionIds.length) throw err(`「${p.name}」要選擇負責的區域`);
    if (!K.sites && !K.regions) sites = [];
    if (K.regions) sites = regionCommunities(tid, regionIds);
    const shift = K.shift && !p.shift ? (['day', 'night'].includes(b.shift) ? b.shift : '') : '';
    if (p.schedule === 'security' && !p.shift && !shift) throw err('請選擇日班或夜班');
    db.prepare('INSERT INTO org_members (tenant_id,staff_id,position_id,shift,region_ids_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,staff_id) DO UPDATE SET position_id=excluded.position_id,shift=excluded.shift,region_ids_json=excluded.region_ids_json,updated_at=excluded.updated_at').run(tid, staffId, p.id, shift, JSON.stringify(regionIds), now());
    if (u.role === 'company_admin') return; // 公司管理員只記錄組織位置，權限不變
    const prev = parsePermissions(u);
    let perms = Array.isArray(b.permissions) ? b.permissions.map(String) : p.perms.slice();
    perms = guardSensitivePermissions(actor, perms, prev);
    const L = legacyFor(p, perms);
    db.prepare("UPDATE staff_users SET position=?,work_type=?,job_category=?,job_level=?,job_categories_json=?,permission_json=?,updated_at=? WHERE id=?").run(p.name, L.work_type, L.job_categories[0], L.job_level, JSON.stringify(L.job_categories), JSON.stringify(perms), now(), staffId);
    syncWorkAssignments(staffId, tid, L.work_type, sites, L.job_categories, L.job_level, perms);
    const sh = p.shift || shift;
    if (sh && p.schedule === 'security') try { db.prepare("UPDATE schedule_profiles SET default_shift=?,updated_at=? WHERE tenant_id=? AND staff_id=?").run(sh, now(), tid, staffId); } catch {}
  }
  // 區域的社區異動後：督導可查看的社區跟著更新
  function syncRegionAccess(tid) {
    const cfg = configFor(tid);
    for (const m of db.prepare('SELECT * FROM org_members WHERE tenant_id=?').all(tid)) {
      const p = posOf(cfg, m.position_id); if (!p || p.kind !== 'region') continue;
      const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(m.staff_id, tid); if (!u || u.role === 'company_admin') continue;
      const perms = parsePermissions(u); const L = legacyFor(p, perms);
      syncWorkAssignments(u.id, tid, L.work_type, regionCommunities(tid, parse(m.region_ids_json, []).map(Number)), L.job_categories, L.job_level, perms);
    }
  }

  // ---------- 舊資料自動對應職位 ----------
  function suggestFor(u, cfg) {
    const cats = (() => { try { const a = JSON.parse(u.job_categories_json || '[]'); return Array.isArray(a) && a.length ? a : (u.job_category ? [u.job_category] : []); } catch { return []; } })().join(' ');
    const lv = String(u.job_level || ''); const has = t => cats.includes(t);
    const byKind = (k, dept) => cfg.positions.find(p => p.kind === k && (!dept || p.dept === dept));
    let p = null, shift = '';
    if (u.role === 'company_admin') p = u.admin_level === 'owner' ? byKind('owner') : byKind('gm');
    else if (has('機動')) p = byKind('mobile', has('秘書') ? 'secretary' : 'duty') || byKind('mobile');
    else if (has('保全')) { let sh = ''; try { sh = db.prepare('SELECT default_shift FROM schedule_profiles WHERE tenant_id=? AND staff_id=?').get(u.tenant_id, u.id)?.default_shift || ''; } catch {} shift = sh === 'night' ? 'night' : 'day'; p = cfg.positions.find(x => x.kind === 'site_staff' && x.schedule === 'security' && x.shift === shift) || cfg.positions.find(x => x.kind === 'site_staff' && x.schedule === 'security'); if (p?.shift) shift = ''; }
    else if (u.work_type !== 'internal' && (lv.includes('經理') || has('社區管理') && !has('秘書'))) p = byKind('site_manager');
    else if (u.work_type !== 'internal' && lv.includes('副理')) p = has('秘書') ? byKind('site_deputy', 'secretary') : byKind('site_deputy');
    else if (u.work_type !== 'internal' && has('秘書')) p = byKind('site_staff', 'secretary');
    else if (has('會計') || has('財務')) p = cfg.positions.find(x => x.kind === 'office' && x.perms.includes('company-accounting'));
    else if (has('人事')) p = cfg.positions.find(x => x.kind === 'office' && x.perms.includes('company-hr'));
    else if (has('總務')) p = cfg.positions.find(x => x.kind === 'office' && x.perms.includes('company-general-affairs'));
    return p ? { position_id: p.id, position_name: p.name, shift } : null;
  }

  // ---------- 輸出 ----------
  function orgOut(tid, viewer) {
    const cfg = configFor(tid);
    const regions = db.prepare('SELECT id,name FROM org_regions WHERE tenant_id=? ORDER BY sort,id').all(tid);
    const communities = db.prepare("SELECT id,name,status,region_id FROM communities WHERE tenant_id=? ORDER BY status='active' DESC,name").all(tid);
    const staff = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY role='company_admin' DESC,employee_id").all(tid);
    const names = new Map(staff.map(u => [u.id, u.name]));
    const nm = l => l.map(x => names.get(x)).filter(Boolean);
    const mobile = new Map(); try { for (const r of db.prepare('SELECT staff_id,mobile FROM hr_profiles WHERE tenant_id=?').all(tid)) mobile.set(r.staff_id, r.mobile || ''); } catch {}
    const members = staff.map(u => {
      const m = memberRow(tid, u.id); const mi = memberInfo(u, cfg); const rel = mi ? relations(tid, u.id, cfg) : null;
      return { staff_id: u.id, employee_id: u.employee_id, name: u.name, role: u.role, admin_level: u.admin_level || '', mobile: mobile.get(u.id) || '', position_id: mi ? m.position_id : '', position_name: mi?.position.name || '', legacy_position: u.position || '', kind: mi?.kind || '', dept: mi?.dept || '', shift: mi?.shift || '', member_shift: m?.shift || '', region_ids: mi?.regions || [], community_ids: mi ? (mi.kind === 'region' ? [] : mi.sites) : getSiteAssignments(u).map(a => Number(a.community_id)), permissions: parsePermissions(u), must_change_password: !!u.must_change_password,
        supervisors: rel ? { site: nm(rel.site), deputies: nm(rel.deputies), region: nm(rel.region), dept: nm(rel.dept), direct: nm(rel.direct) } : null,
        suggestion: mi ? null : suggestFor(u, cfg) };
    });
    return { config: cfg, kinds: OM.KINDS, schedules: OM.SCHEDULES, shifts: OM.SHIFTS, regions, communities, members, prefs: prefsFor(tid), permission_labels: PERMISSION_LABELS, company_keys: [...COMPANY_KEYS], site_keys: [...SITE_KEYS], viewer: { is_admin: viewer?.role === 'company_admin' } };
  }

  // ================= 公司 =================
  const C = '/api/company/org';
  app.get(C, requireCompanyAdmin, wrap((req, res) => { res.set('Cache-Control', 'no-store'); res.json(orgOut(tenantId(req), getUser(req))); }));
  const checkMobile = (tid, mobile, exceptId) => {
    const dg = digits(mobile); if (!dg) return '';
    if (!/^0?9\d{8}$/.test(dg) && dg.length < 8) throw err('手機號碼格式不正確');
    let rows = []; try { rows = db.prepare("SELECT h.staff_id,h.mobile FROM hr_profiles h JOIN staff_users u ON u.id=h.staff_id WHERE h.tenant_id=? AND u.is_active=1 AND h.staff_id<>?").all(tid, exceptId || 0); } catch {}
    if (rows.some(r => digits(r.mobile) === dg)) throw err('這個手機號碼已經有其他人員使用');
    return str(mobile, 30);
  };
  const saveMobile = (tid, sid, mobile) => { try { db.prepare('INSERT OR IGNORE INTO hr_profiles (tenant_id,staff_id,updated_at) VALUES (?,?,?)').run(tid, sid, now()); db.prepare('UPDATE hr_profiles SET mobile=? WHERE tenant_id=? AND staff_id=?').run(mobile, tid, sid); } catch (e) { console.warn('mobile save failed', e.message); } };
  app.post(`${C}/staff`, requireCompanyAdmin, requireCompanyPermission('manage-staff'), wrap((req, res) => {
    const tid = tenantId(req); const b = req.body || {}; const actor = getUser(req);
    const employeeId = str(b.employee_id, 30), name = str(b.name, 60), password = String(b.password || '');
    if (!employeeId) return bad(res, '請填寫員編'); if (!name) return bad(res, '請填寫姓名'); if (password.length < 4) return bad(res, '初始密碼至少 4 碼');
    if (db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tid, employeeId)) return bad(res, '這家公司已有相同員編的帳號');
    const mobile = checkMobile(tid, b.mobile, 0);
    if (!posOf(configFor(tid), b.position_id)) return bad(res, '請選擇職位');
    let id;
    tx(() => {
      const p = db.makePassword(password);
      const info = db.prepare("INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,position,work_type,job_category,job_level,job_categories_json,permission_json,person_uid,person_status,must_change_password) VALUES (?,?,?,?,1,?,?,'staff',?,?,?,?,?,?,?,?,'active',1)")
        .run(employeeId, name, p.hash, p.salt, now(), now(), tid, '', 'site', '', '', '[]', '[]', 'P' + String(Date.now()));
      id = Number(info.lastInsertRowid);
      applyMember(tid, id, b, actor);
      if (mobile) saveMobile(tid, id, mobile);
    })();
    res.json({ success: true, id });
  }));
  app.put(`${C}/staff/:id`, requireCompanyAdmin, requireCompanyPermission('manage-staff'), wrap((req, res) => {
    const tid = tenantId(req); const sid = Number(req.params.id); const b = req.body || {}; const actor = getUser(req);
    const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(sid, tid); if (!u) return bad(res, '找不到人員', 404);
    if (u.role === 'company_admin' && actor.role !== 'company_admin') return bad(res, '公司管理員的職位只能由公司管理員設定', 403);
    const mobile = b.mobile !== undefined ? checkMobile(tid, b.mobile, sid) : null;
    tx(() => {
      if (b.name && u.role !== 'company_admin') db.prepare('UPDATE staff_users SET name=? WHERE id=?').run(str(b.name, 60), sid);
      applyMember(tid, sid, b, actor);
      if (mobile !== null) saveMobile(tid, sid, mobile);
    })();
    res.json({ success: true });
  }));
  app.post(`${C}/apply-suggestions`, requireCompanyAdmin, requireCompanyPermission('manage-staff'), wrap((req, res) => {
    const tid = tenantId(req); const actor = getUser(req); const done = [], failed = [];
    for (const it of (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 500)) {
      const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(Number(it.staff_id), tid); if (!u) continue;
      try {
        const cur = getSiteAssignments(u).map(a => Number(a.community_id));
        const p = posOf(configFor(tid), it.position_id); const K = p && OM.KINDS[p.kind];
        // 舊資料：駐點保留原有社區（單一社區職位取第一個），權限保留原設定
        tx(() => applyMember(tid, u.id, { position_id: it.position_id, shift: it.shift, community_ids: K?.sites === 'one' ? cur.slice(0, 1) : cur, region_ids: it.region_ids || [], permissions: u.role === 'company_admin' ? undefined : (parsePermissions(u).length ? parsePermissions(u) : undefined) }, actor))();
        done.push(u.id);
      } catch (e) { failed.push({ staff_id: u.id, name: u.name, error: e.message }); }
    }
    res.json({ success: true, done: done.length, failed });
  }));
  // 區域
  app.post(`${C}/regions`, requireCompanyAdmin, requireCompanyPermission('manage-communities'), wrap((req, res) => {
    const name = str(req.body?.name, 30); if (!name) return bad(res, '請輸入區域名稱');
    const info = db.prepare('INSERT INTO org_regions (tenant_id,name,sort,created_at) VALUES (?,?,?,?)').run(tenantId(req), name, Date.now() % 1e9, now()); res.json({ success: true, id: Number(info.lastInsertRowid) });
  }));
  app.put(`${C}/regions/:id`, requireCompanyAdmin, requireCompanyPermission('manage-communities'), wrap((req, res) => {
    const name = str(req.body?.name, 30); if (!name) return bad(res, '請輸入區域名稱');
    const r = db.prepare('UPDATE org_regions SET name=? WHERE id=? AND tenant_id=?').run(name, Number(req.params.id), tenantId(req)); if (!r.changes) return bad(res, '找不到區域', 404); res.json({ success: true });
  }));
  app.delete(`${C}/regions/:id`, requireCompanyAdmin, requireCompanyPermission('manage-communities'), wrap((req, res) => {
    const tid = tenantId(req); const id = Number(req.params.id);
    const used = db.prepare('SELECT staff_id,region_ids_json FROM org_members WHERE tenant_id=?').all(tid).filter(m => parse(m.region_ids_json, []).map(Number).includes(id));
    if (used.length) return bad(res, `還有 ${used.length} 位督導負責這個區域，請先調整他們的區域`);
    db.prepare('UPDATE communities SET region_id=NULL WHERE tenant_id=? AND region_id=?').run(tid, id); db.prepare('DELETE FROM org_regions WHERE id=? AND tenant_id=?').run(id, tid); res.json({ success: true });
  }));
  app.put(`${C}/communities/:cid/region`, requireCompanyAdmin, requireCompanyPermission('manage-communities'), wrap((req, res) => {
    const tid = tenantId(req); const rid_ = req.body?.region_id ? Number(req.body.region_id) : null;
    if (rid_ && !db.prepare('SELECT 1 FROM org_regions WHERE id=? AND tenant_id=?').get(rid_, tid)) return bad(res, '找不到區域');
    const r = db.prepare('UPDATE communities SET region_id=?,updated_at=? WHERE id=? AND tenant_id=?').run(rid_, now(), Number(req.params.cid), tid); if (!r.changes) return bad(res, '找不到社區', 404);
    syncRegionAccess(tid); res.json({ success: true });
  }));
  app.put(`${C}/prefs`, requireCompanyAdmin, wrap((req, res) => {
    if (getUser(req).role !== 'company_admin') return bad(res, '只有公司管理員可以設定', 403);
    const tid = tenantId(req); const p = { ...prefsFor(tid), ...(req.body || {}) }; const clean = { deputy_proxy: ['none', 'absent', 'always', 'dept_notify'].includes(p.deputy_proxy) ? p.deputy_proxy : 'none' };
    db.prepare('INSERT INTO org_settings (tenant_id,config_json,prefs_json,updated_at) VALUES (?,NULL,?,?) ON CONFLICT(tenant_id) DO UPDATE SET prefs_json=excluded.prefs_json,updated_at=excluded.updated_at').run(tid, JSON.stringify(clean), now());
    res.json({ success: true, prefs: clean });
  }));

  // ================= 總後台：各公司組織架構 =================
  if (requireSuperAdmin) {
    const usage = tid => { const m = new Map(); for (const r of db.prepare('SELECT position_id,COUNT(*) c FROM org_members o JOIN staff_users u ON u.id=o.staff_id WHERE o.tenant_id=? GROUP BY position_id').all(tid)) m.set(r.position_id, r.c); return m; };
    app.get('/api/admin/org/:tid', requireSuperAdmin, wrap((req, res) => {
      const tid = Number(req.params.tid); if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)) return bad(res, '找不到公司', 404);
      const r = db.prepare('SELECT config_json,updated_at FROM org_settings WHERE tenant_id=?').get(tid); const u = usage(tid);
      res.json({ config: configFor(tid), customized: !!r?.config_json, updated_at: r?.updated_at || '', usage: Object.fromEntries(u), kinds: OM.KINDS, kind_order: OM.KIND_ORDER, schedules: OM.SCHEDULES, shifts: OM.SHIFTS, permission_labels: PERMISSION_LABELS, company_keys: [...COMPANY_KEYS], site_keys: [...SITE_KEYS], tenants: db.prepare('SELECT id,name,code FROM tenants ORDER BY id').all() });
    }));
    app.put('/api/admin/org/:tid', requireSuperAdmin, wrap((req, res) => {
      const tid = Number(req.params.tid); if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)) return bad(res, '找不到公司', 404);
      const cfg = OM.normalize(req.body?.config || req.body); if (!cfg.positions.length) return bad(res, '至少要有一個職位');
      const u = usage(tid); const missing = [...u.keys()].filter(id => !cfg.positions.some(p => p.id === id));
      if (missing.length) { const old = configFor(tid); return bad(res, `以下職位還有人員使用，不能刪除：${missing.map(id => `${posOf(old, id)?.name || id}（${u.get(id)} 人）`).join('、')}`); }
      db.prepare('INSERT INTO org_settings (tenant_id,config_json,prefs_json,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(tid, JSON.stringify(cfg), '{}', now(), '總後台');
      // 職位名稱或預設權限改了：已在這個職位的人員同步名稱（權限保留個別調整）
      for (const m of db.prepare('SELECT staff_id,position_id FROM org_members WHERE tenant_id=?').all(tid)) { const p = posOf(cfg, m.position_id); if (p) db.prepare("UPDATE staff_users SET position=? WHERE id=? AND tenant_id=? AND role='staff'").run(p.name, m.staff_id, tid); }
      res.json({ success: true, config: cfg });
    }));
    app.delete('/api/admin/org/:tid', requireSuperAdmin, wrap((req, res) => {
      const tid = Number(req.params.tid); const u = usage(tid); const def = OM.defaults();
      const missing = [...u.keys()].filter(id => !def.positions.some(p => p.id === id));
      if (missing.length) return bad(res, '有人員使用平台預設沒有的職位，請先把人員改到其他職位');
      db.prepare('UPDATE org_settings SET config_json=NULL,updated_at=? WHERE tenant_id=?').run(now(), tid); res.json({ success: true });
    }));
  }

  return { configFor, prefsFor, memberInfo, relations, resolveLeaveStep, syncRegionAccess };
};
