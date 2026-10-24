// 方案與計費：依「員工規模」或「社區案場規模」分級，基本功能＋加值模組。
// - 系統總後台設定價格、級距、方案範本，並替每家公司設定方案、到期日與加值模組。
// - 超出方案上限：擋住新增（或重新啟用）人員／社區；既有資料不受影響。
// - 到期：寬限期內功能照常並每天提醒；寬限期過後加值模組關閉、基本功能唯讀。
// - 系統只計算費用，實際開立帳單與收款在系統外處理。
// - 沒有設定方案的公司（開發／試用階段）不受限制，加值模組依預設值。
'use strict';

const CATALOG = {
  accounting: { name: '會計模組', desc: '傳票帳冊、公司應收、公司應支付款、社區回饋金、進銷項（401）、電子發票', unplanned: true, order: 1 },
  smart_schedule: { name: '智慧排班', desc: '依社區派駐配置自動排班、缺班補人、發布班表（中階以上方案加購，可先免費試用）', unplanned: true, order: 2 },
  interview: { name: '面試人員線上履歷＋職務考核', desc: '面試電腦填寫履歷與考核題目、面試管理、錄取後帶入人事資料', unplanned: false, order: 3 },
  equip_apply: { name: '現場設備雲端借用申請', desc: '現場人員與內勤線上申請借用公司設備、審核流程與借用紀錄', unplanned: true, order: 4 },
};
const BASE_FEATURES = ['現場人員工作台全部功能', '人員／組織／社區管理', '交接、工作日誌', '班表、請假、出勤巡邏', '薪資與勞健保', '公費款項申請', '公司資源／SOP', '住戶名冊', '社區合約', '總務設備清冊、社區進駐設備'];
const BASIS = { staff: { name: '員工規模', unit: '人' }, community: { name: '社區案場規模', unit: '個社區' } };
const DEFAULT_PRICING = {
  grace_days: 7, warn_ratio: 90, warn_days: 30,
  tiers: {
    staff: [
      { id: 's50', name: '50 人以內', max: 50, price: 3000 },
      { id: 's100', name: '51–100 人', max: 100, price: 5000 },
      { id: 's200', name: '101–200 人', max: 200, price: 8000 },
      { id: 's500', name: '201–500 人', max: 500, price: 15000 },
    ],
    community: [
      { id: 'c10', name: '10 個社區以內', max: 10, price: 3000 },
      { id: 'c30', name: '11–30 個社區', max: 30, price: 6000 },
      { id: 'c60', name: '31–60 個社區', max: 60, price: 10000 },
      { id: 'c100', name: '61–100 個社區', max: 100, price: 15000 },
    ],
  },
  modules: {
    accounting: { price: 2000, percent: 0 },
    smart_schedule: { price: 1500, percent: 0, min_tier: 2, trial_days: 30 },
    interview: { price: 800, percent: 0 },
    equip_apply: { price: 500, percent: 0 },
  },
  templates: [
    { id: 'basic', name: '基本', modules: [] },
    { id: 'pro', name: '進階', modules: ['smart_schedule', 'equip_apply'] },
    { id: 'full', name: '完整', modules: ['accounting', 'smart_schedule', 'interview', 'equip_apply'] },
  ],
};
const PLACEHOLDER_COMMUNITY = '請建立第一個社區';
// API 路徑 → 加值模組（面試系統由 interview-routes 自行檢查）
const GATES = [
  [/^\/api\/company\/schedule\/smart(\/|$)/, 'smart_schedule'],
  [/^\/api\/company\/(acct|ar)\//, 'accounting'],
  [/^\/api\/company\/ap\/(payments|purchases|payroll|feedback|vendors|sales)(\/|$)/, 'accounting'],
  [/^\/api\/company\/ap\/requests\/\d+\/classify$/, 'accounting'],
  [/^\/api\/(staff|company\/my)\/equip\/(requests|availability)(\/|$)/, 'equip_apply'],
  [/^\/api\/company\/equip\/requests(\/|$)/, 'equip_apply'],
];
// 目錄功能代碼 → 加值模組
const MENU_MODULE = { 'acct-ledger': 'accounting', 'acct-ar': 'accounting', 'acct-ap': 'accounting', 'acct-feedback': 'accounting', 'equip-apply': 'equip_apply', 'equip-requests': 'equip_apply' };
const READONLY_FREE = /\/(login|logout|session|password)$/;

module.exports = function registerPlans(app, d) {
  const { db, now, requireSuperAdmin, requireCompanyAdmin, getUser, tenantId, getAcct } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS tenant_addons (tenant_id INTEGER NOT NULL, key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, expires_at TEXT DEFAULT '', note TEXT DEFAULT '', updated_at TEXT, updated_by TEXT DEFAULT '', PRIMARY KEY (tenant_id, key));
    CREATE TABLE IF NOT EXISTS tenant_plans (tenant_id INTEGER PRIMARY KEY, basis TEXT DEFAULT '', tier_id TEXT DEFAULT '', template_id TEXT DEFAULT '', started_at TEXT DEFAULT '', expires_at TEXT DEFAULT '', discount INTEGER DEFAULT 0, note TEXT DEFAULT '', updated_at TEXT, updated_by TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS plan_pricing (id INTEGER PRIMARY KEY CHECK (id=1), json TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS plan_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, action TEXT, note TEXT, created_at TEXT);`);
  const cols = db.prepare('PRAGMA table_info(tenant_addons)').all().map(c => c.name);
  if (!cols.includes('trial_until')) db.exec("ALTER TABLE tenant_addons ADD COLUMN trial_until TEXT DEFAULT ''");

  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const addDays = (s, n) => { const t = new Date(`${s}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const int = (v, min = 0, max = 1e9) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const log = (tid, action, note) => db.prepare('INSERT INTO plan_logs (tenant_id,action,note,created_at) VALUES (?,?,?,?)').run(tid, action, str(note, 500), now());
  const acct = () => { try { return getAcct ? getAcct() : null; } catch { return null; } };

  // ---------- 價格設定 ----------
  function cleanPricing(p) {
    p = p && typeof p === 'object' ? p : {}; const D = DEFAULT_PRICING; const out = { grace_days: int(p.grace_days ?? D.grace_days, 0, 60), warn_ratio: int(p.warn_ratio ?? D.warn_ratio, 50, 100), warn_days: int(p.warn_days ?? D.warn_days, 1, 120), tiers: {}, modules: {}, templates: [] };
    for (const b of Object.keys(BASIS)) {
      const src = Array.isArray(p.tiers?.[b]) ? p.tiers[b] : D.tiers[b]; const seen = new Set();
      out.tiers[b] = src.map((t, i) => ({ id: str(t.id, 20) || `${b[0]}${i + 1}`, name: str(t.name, 40) || `第 ${i + 1} 級`, max: int(t.max, 1, 100000), price: int(t.price, 0, 1e8) }))
        .filter(t => !seen.has(t.id) && seen.add(t.id)).sort((a, b) => a.max - b.max).slice(0, 12);
    }
    for (const k of Object.keys(CATALOG)) {
      const s = { ...D.modules[k], ...(p.modules?.[k] || {}) };
      out.modules[k] = { price: int(s.price, 0, 1e8), percent: int(s.percent, 0, 100) };
      if (k === 'smart_schedule') { out.modules[k].min_tier = int(s.min_tier, 1, 12); out.modules[k].trial_days = int(s.trial_days, 0, 180); }
    }
    const tsrc = Array.isArray(p.templates) ? p.templates : D.templates; const tseen = new Set();
    out.templates = tsrc.map((t, i) => ({ id: str(t.id, 20) || `t${i + 1}`, name: str(t.name, 30) || `方案 ${i + 1}`, modules: (Array.isArray(t.modules) ? t.modules : []).filter(k => CATALOG[k]) }))
      .filter(t => !tseen.has(t.id) && tseen.add(t.id)).slice(0, 10);
    return out;
  }
  function pricing() { const r = db.prepare('SELECT json FROM plan_pricing WHERE id=1').get(); let j = null; try { j = r ? JSON.parse(r.json) : null; } catch {} return cleanPricing(j); }

  // ---------- 用量 ----------
  function usage(tid) {
    const staff = db.prepare("SELECT COUNT(*) c FROM staff_users WHERE tenant_id=? AND is_active=1 AND role<>'company_admin' AND COALESCE(person_status,'active') NOT IN ('left','blacklist','disabled')").get(tid).c;
    const community = db.prepare("SELECT COUNT(*) c FROM communities WHERE tenant_id=? AND status='active' AND name<>?").get(tid, PLACEHOLDER_COMMUNITY).c;
    return { staff, community };
  }

  // ---------- 方案狀態 ----------
  function planRow(tid) { return db.prepare('SELECT * FROM tenant_plans WHERE tenant_id=?').get(tid) || null; }
  function state(tid, P = pricing()) {
    tid = Number(tid); const r = planRow(tid); const u = usage(tid); const today = todayTW();
    if (!r || !BASIS[r.basis]) return { configured: false, phase: 'none', usage: u, readonly: false };
    const tiers = P.tiers[r.basis]; let idx = tiers.findIndex(t => t.id === r.tier_id); if (idx < 0) idx = 0; const tier = tiers[idx] || { id: '', name: '未設定', max: 0, price: 0 };
    let phase = 'active', days_left = null, grace_until = '';
    if (r.expires_at) {
      days_left = daysBetween(today, r.expires_at); grace_until = addDays(r.expires_at, P.grace_days);
      if (today > r.expires_at) phase = today <= grace_until ? 'grace' : 'expired';
    }
    const used = u[r.basis]; const template = P.templates.find(t => t.id === r.template_id) || null;
    return { configured: true, basis: r.basis, basis_name: BASIS[r.basis].name, unit: BASIS[r.basis].unit, tier, tier_rank: idx + 1, template_id: r.template_id || '', template_name: template?.name || '', started_at: r.started_at || '', expires_at: r.expires_at || '', grace_until, days_left, grace_left: phase === 'grace' ? daysBetween(today, grace_until) : null, phase, readonly: phase === 'expired', used, limit: tier.max, ratio: tier.max ? Math.round(used / tier.max * 100) : 0, usage: u, discount: r.discount || 0, note: r.note || '', updated_at: r.updated_at || '' };
  }
  function addonRow(tid, key) { return db.prepare('SELECT * FROM tenant_addons WHERE tenant_id=? AND key=?').get(tid, key) || null; }
  function status(tid, key, S = null, P = null) {
    tid = Number(tid); const c = CATALOG[key]; if (!c) return { enabled: false };
    P = P || pricing(); S = S || state(tid, P); const r = addonRow(tid, key); const today = todayTW();
    const switched_on = r ? !!r.enabled : (S.configured ? false : c.unplanned);
    const expired = !!(switched_on && r?.expires_at && r.expires_at < today);
    const trial_until = r?.trial_until || ''; const trial = !!(trial_until && trial_until >= today);
    const min_tier = key === 'smart_schedule' ? P.modules[key].min_tier : 0;
    const tier_ok = !S.configured || !min_tier || S.tier_rank >= min_tier;
    let enabled = (switched_on && !expired && tier_ok) || trial; let reason = '';
    if (S.readonly) { enabled = false; reason = 'plan_expired'; }
    else if (!enabled) reason = switched_on && expired ? 'expired' : switched_on && !tier_ok ? 'tier' : trial_until ? 'trial_ended' : 'off';
    return { key, name: c.name, desc: c.desc, enabled, switched_on, expired, trial, trial_until, tier_ok, reason, expires_at: r?.expires_at || '', note: r?.note || '', updated_at: r?.updated_at || '', updated_by: r?.updated_by || '' };
  }
  const isOn = (tid, key) => status(tid, key).enabled;
  function modules(tid) { const P = pricing(); const S = state(tid, P); return Object.fromEntries(Object.keys(CATALOG).map(k => [k, status(tid, k, S, P)])); }

  function fee(tid, P = pricing(), S = state(tid, P), M = null) {
    if (!S.configured) return { lines: [], total: 0 };
    M = M || Object.fromEntries(Object.keys(CATALOG).map(k => [k, status(tid, k, S, P)]));
    const base = S.tier.price; const lines = [{ name: `基本方案（${S.basis_name}：${S.tier.name}）`, amount: base }];
    for (const k of Object.keys(CATALOG).sort((a, b) => CATALOG[a].order - CATALOG[b].order)) {
      const m = M[k]; const p = P.modules[k];
      if (m.switched_on && !m.expired && m.tier_ok) lines.push({ name: CATALOG[k].name, amount: p.price + Math.round(base * (p.percent || 0) / 100) });
      else if (m.trial) lines.push({ name: `${CATALOG[k].name}（免費試用至 ${m.trial_until}）`, amount: 0, trial: true });
    }
    if (S.discount) lines.push({ name: S.discount < 0 ? '折扣' : '其他費用', amount: S.discount });
    return { lines, total: Math.max(0, lines.reduce((s, x) => s + x.amount, 0)) };
  }

  // ---------- 上限 ----------
  function canAdd(tid, kind) {
    const S = state(tid); if (!S.configured || S.basis !== kind) return { ok: true };
    if (S.used < S.limit) return { ok: true };
    const what = kind === 'staff' ? '人員帳號' : '社區';
    return { ok: false, error: `已達方案上限（${S.basis_name} ${S.used}／${S.limit} ${S.unit}），無法再新增或啟用${what}。請聯絡系統服務商升級方案${kind === 'staff' ? '，或先停用已離職人員的帳號' : '，或先停用已結束服務的社區'}。` };
  }

  // ---------- 權限 ----------
  function canViewPlan(u) {
    if (!u || !u.tenant_id) return false; if (u.role === 'company_admin') return true;
    const a = acct(); if (a?.isBoss?.(u)) return true;
    return !!(a?.canAcct?.(u) && isOn(u.tenant_id, 'accounting'));
  }
  function menuAllowed(tid, item, u, scope) {
    const a = String(item?.action || '');
    if (scope === 'company' && a === 'plan-billing') return canViewPlan(u);
    const k = scope === 'company' ? MENU_MODULE[a] : null;
    return k ? isOn(tid, k) : true;
  }

  // ---------- 請求檢查（server.js 在 session 之後呼叫）----------
  function guard(req, res, next) {
    const p = String(req.path || ''); if (!/^\/api\/(company|staff)\//.test(p)) return next();
    const tid = Number(tenantId(req) || 0); if (!tid) return next();
    const m = req.method;
    try {
      const S = state(tid);
      if (S.readonly && m !== 'GET' && m !== 'HEAD' && !READONLY_FREE.test(p)) return res.status(403).json({ error: `公司方案已於 ${S.expires_at} 到期，寬限期已過，目前為唯讀模式：可以查看資料，但無法新增或修改。請聯絡系統服務商續約。`, plan_readonly: true });
      for (const [re, key] of GATES) if (re.test(p) && !isOn(tid, key)) return res.status(403).json({ error: `「${CATALOG[key].name}」是加值功能，貴公司目前沒有開通。如需使用請聯絡系統服務商。`, addon: key });
      if (!S.configured) return next();
      let kind = null; const b = req.body || {};
      if (m === 'POST' && (p === '/api/company/staff' || p === '/api/company/org/staff')) kind = 'staff';
      else if (m === 'POST' && p === '/api/company/communities') kind = 'community';
      else if (m === 'POST' && /^\/api\/company\/staff\/\d+\/status$/.test(p) && b.status === 'active') kind = inactiveStaff(tid, p) ? 'staff' : null;
      else if (m === 'PUT' && /^\/api\/company\/staff\/\d+$/.test(p) && b.is_active !== undefined && !!b.is_active) kind = inactiveStaff(tid, p) ? 'staff' : null;
      else if (m === 'PUT' && /^\/api\/company\/communities\/\d+$/.test(p) && b.status !== undefined && !!b.status) { const id = Number(p.split('/').pop()); const c = db.prepare('SELECT status,name FROM communities WHERE id=? AND tenant_id=?').get(id, tid); if (c && c.status !== 'active') kind = 'community'; }
      if (kind) { const r = canAdd(tid, kind); if (!r.ok) return res.status(403).json({ error: r.error, plan_limit: kind }); }
    } catch (e) { console.error('plan guard error', e); }
    next();
  }
  function inactiveStaff(tid, p) { const id = Number(p.split('/')[4]); const u = db.prepare('SELECT is_active,role FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid); return !!(u && u.role !== 'company_admin' && !u.is_active); }

  // ---------- 提醒（首頁卡片）----------
  function warnings(tid, P = pricing(), S = state(tid, P), M = null) {
    const w = []; if (!S.configured) return w; M = M || modules(tid);
    if (S.phase === 'expired') w.push({ tone: 'alert', text: `方案已於 ${S.expires_at} 到期，寬限期已過：加值功能已關閉，基本功能為唯讀。` });
    else if (S.phase === 'grace') w.push({ tone: 'alert', text: `方案已於 ${S.expires_at} 到期，寬限期剩 ${S.grace_left} 天（至 ${S.grace_until}），之後將改為唯讀。` });
    else if (S.days_left !== null && S.days_left <= P.warn_days) w.push({ tone: S.days_left <= 7 ? 'alert' : '', text: `方案將於 ${S.expires_at} 到期（剩 ${S.days_left} 天）。` });
    if (S.limit && S.ratio >= P.warn_ratio) w.push({ tone: S.used >= S.limit ? 'alert' : '', text: S.used >= S.limit ? `${S.basis_name}已達上限（${S.used}／${S.limit} ${S.unit}），無法再新增。` : `${S.basis_name}已使用 ${S.ratio}%（${S.used}／${S.limit} ${S.unit}）。` });
    for (const m of Object.values(M)) if (m.trial) { const left = daysBetween(todayTW(), m.trial_until); if (left <= 7) w.push({ tone: '', text: `「${m.name}」免費試用將於 ${m.trial_until} 結束（剩 ${left} 天）。` }); }
    return w;
  }
  function dashboard(tid, u) {
    if (!canViewPlan(u)) return null; const P = pricing(); const S = state(tid, P); if (!S.configured) return null;
    const w = warnings(tid, P, S); if (!w.length) return null;
    return { warnings: w, alert: w.some(x => x.tone === 'alert'), state: S };
  }

  // ---------- 公司端 ----------
  app.get('/api/company/modules', requireCompanyAdmin, (req, res) => {
    const tid = tenantId(req); const u = getUser(req); const P = pricing(); const S = state(tid, P); const M = modules(tid);
    res.json({ modules: Object.fromEntries(Object.entries(M).map(([k, v]) => [k, v.enabled])), readonly: S.readonly, phase: S.phase, expires_at: S.expires_at || '', grace_until: S.grace_until || '', can_view_plan: canViewPlan(u) });
  });
  app.get('/api/company/plan', requireCompanyAdmin, (req, res) => {
    const u = getUser(req); if (!canViewPlan(u)) return res.status(403).json({ error: '只有公司高層（老闆、總經理、公司管理員）可以查看方案與費用' });
    const tid = tenantId(req); const P = pricing(); const S = state(tid, P); const M = modules(tid);
    const mods = Object.keys(CATALOG).sort((a, b) => CATALOG[a].order - CATALOG[b].order).map(k => ({ ...M[k], price: S.configured ? P.modules[k].price + Math.round((S.tier?.price || 0) * (P.modules[k].percent || 0) / 100) : null, min_tier: P.modules[k].min_tier || 0, min_tier_name: P.modules[k].min_tier && S.configured ? (P.tiers[S.basis][P.modules[k].min_tier - 1]?.name || '') : '' }));
    res.json({ state: S, base_features: BASE_FEATURES, modules: mods, fee: fee(tid, P, S, M), warnings: warnings(tid, P, S, M), grace_days: P.grace_days, tiers: S.configured ? P.tiers[S.basis] : [] });
  });

  // ---------- 總後台 ----------
  function tenantView(t, P) {
    const S = state(t.id, P); const M = Object.fromEntries(Object.keys(CATALOG).map(k => [k, status(t.id, k, S, P)]));
    return { ...t, plan: S, addons: M, fee: fee(t.id, P, S, M), warnings: warnings(t.id, P, S, M) };
  }
  app.get('/api/admin/plans', requireSuperAdmin, (req, res) => {
    const P = pricing(); const tenants = db.prepare('SELECT id,name,code,status FROM tenants ORDER BY id').all();
    res.json({ pricing: P, catalog: CATALOG, basis: BASIS, base_features: BASE_FEATURES, today: todayTW(), tenants: tenants.map(t => tenantView(t, P)) });
  });
  app.put('/api/admin/plans/pricing', requireSuperAdmin, (req, res) => {
    const P = cleanPricing(req.body?.pricing);
    for (const b of Object.keys(BASIS)) if (!P.tiers[b].length) return res.status(400).json({ error: `${BASIS[b].name}至少要有一個級距` });
    db.prepare('INSERT INTO plan_pricing (id,json,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at').run(JSON.stringify(P), now());
    log(0, 'pricing', '更新價格設定'); res.json({ success: true, pricing: P });
  });
  const tenantOr404 = (req, res) => { const t = db.prepare('SELECT id,name,code,status FROM tenants WHERE id=?').get(Number(req.params.tid)); if (!t) res.status(404).json({ error: '找不到公司' }); return t; };
  function setAddon(tid, key, b) {
    const r = addonRow(tid, key);
    db.prepare('INSERT INTO tenant_addons (tenant_id,key,enabled,expires_at,note,trial_until,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET enabled=excluded.enabled,expires_at=excluded.expires_at,note=excluded.note,trial_until=excluded.trial_until,updated_at=excluded.updated_at,updated_by=excluded.updated_by')
      .run(tid, key, b.enabled ? 1 : 0, b.expires_at !== undefined ? (isDate(b.expires_at) ? b.expires_at : '') : (r?.expires_at || ''), b.note !== undefined ? str(b.note, 200) : (r?.note || ''), b.trial_until !== undefined ? b.trial_until : (r?.trial_until || ''), now(), '系統總後台');
  }
  app.put('/api/admin/plans/:tid', requireSuperAdmin, (req, res) => {
    const t = tenantOr404(req, res); if (!t) return; const b = req.body || {}; const P = pricing();
    if (b.basis === '' || b.basis === null) { db.prepare('DELETE FROM tenant_plans WHERE tenant_id=?').run(t.id); db.prepare('DELETE FROM tenant_addons WHERE tenant_id=?').run(t.id); log(t.id, 'plan', '取消方案設定（加值模組恢復預設）'); return res.json({ success: true, tenant: tenantView(t, P) }); }
    if (!BASIS[b.basis]) return res.status(400).json({ error: '請選擇計價依據（員工規模或社區案場規模）' });
    const tier = P.tiers[b.basis].find(x => x.id === b.tier_id); if (!tier) return res.status(400).json({ error: '請選擇方案級距' });
    if (b.expires_at && !isDate(b.expires_at)) return res.status(400).json({ error: '到期日格式不正確' });
    const tpl = b.template_id ? P.templates.find(x => x.id === b.template_id) : null; if (b.template_id && !tpl) return res.status(400).json({ error: '找不到方案範本' });
    const used = usage(t.id)[b.basis];
    const old = planRow(t.id); const ts = now();
    db.transaction(() => {
      db.prepare('INSERT INTO tenant_plans (tenant_id,basis,tier_id,template_id,started_at,expires_at,discount,note,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET basis=excluded.basis,tier_id=excluded.tier_id,template_id=excluded.template_id,started_at=excluded.started_at,expires_at=excluded.expires_at,discount=excluded.discount,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by')
        .run(t.id, b.basis, tier.id, tpl?.id || '', isDate(b.started_at) ? b.started_at : (old?.started_at || todayTW()), b.expires_at || '', int(b.discount ?? 0, -1e8, 1e8), str(b.note, 300), ts, '系統總後台');
      if (tpl && b.apply_template) for (const k of Object.keys(CATALOG)) {
        let on = tpl.modules.includes(k);
        if (k === 'smart_schedule' && on && P.tiers[b.basis].indexOf(tier) + 1 < P.modules[k].min_tier) on = false;
        setAddon(t.id, k, { enabled: on });
      }
    })();
    log(t.id, 'plan', `${BASIS[b.basis].name} ${tier.name}${tpl ? `／範本 ${tpl.name}${b.apply_template ? '（套用模組）' : ''}` : ''}${b.expires_at ? `／到期 ${b.expires_at}` : ''}`);
    res.json({ success: true, tenant: tenantView(t, P), over_limit: used > tier.max ? `目前已使用 ${used} ${BASIS[b.basis].unit}，超過這個級距的上限 ${tier.max}；既有資料不受影響，但無法再新增。` : '' });
  });
  app.put('/api/admin/plans/:tid/modules/:key', requireSuperAdmin, (req, res) => {
    const t = tenantOr404(req, res); if (!t) return; const key = req.params.key; if (!CATALOG[key]) return res.status(404).json({ error: '沒有這個加值功能' });
    const b = req.body || {}; const P = pricing(); const S = state(t.id, P);
    if (b.enabled && key === 'smart_schedule' && S.configured && S.tier_rank < P.modules[key].min_tier) return res.status(400).json({ error: `智慧排班限「${P.tiers[S.basis][P.modules[key].min_tier - 1]?.name || `第 ${P.modules[key].min_tier} 級`}」以上方案加購；這家公司目前是「${S.tier.name}」，可以先開始免費試用。` });
    setAddon(t.id, key, { enabled: !!b.enabled, expires_at: b.expires_at ?? '', note: b.note ?? '' });
    log(t.id, 'addon', `${CATALOG[key].name} ${b.enabled ? '開通' : '關閉'}${isDate(b.expires_at) ? ` 至 ${b.expires_at}` : ''}`);
    res.json({ success: true, addon: status(t.id, key) });
  });
  app.post('/api/admin/plans/:tid/modules/:key/trial', requireSuperAdmin, (req, res) => {
    const t = tenantOr404(req, res); if (!t) return; const key = req.params.key; if (!CATALOG[key]) return res.status(404).json({ error: '沒有這個加值功能' });
    const P = pricing(); const r = addonRow(t.id, key); const stop = req.body?.stop;
    const days = int(req.body?.days ?? (P.modules[key].trial_days || 30), 1, 180);
    const until = stop ? '' : addDays(todayTW(), days - 1);
    setAddon(t.id, key, { enabled: !!r?.enabled, trial_until: until });
    log(t.id, 'trial', `${CATALOG[key].name} ${stop ? '結束試用' : `試用至 ${until}`}`);
    res.json({ success: true, addon: status(t.id, key) });
  });
  app.get('/api/admin/plans/:tid/logs', requireSuperAdmin, (req, res) => res.json({ logs: db.prepare('SELECT action,note,created_at FROM plan_logs WHERE tenant_id=? ORDER BY id DESC LIMIT 50').all(Number(req.params.tid)) }));

  return { CATALOG, isOn, status, modules, state, usage, canAdd, canViewPlan, menuAllowed, guard, dashboard, pricing, fee };
};
