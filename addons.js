// 加值功能：由系統總後台依公司開通（可設定到期日，供日後另外收費）
'use strict';

const CATALOG = {
  interview: { name: '面試人員線上履歷＋職務考核', desc: '面試電腦填寫履歷與考核題目、面試管理、錄取後帶入人事資料', default: false },
};

module.exports = function registerAddons(app, d) {
  const { db, now, requireSuperAdmin } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS tenant_addons (tenant_id INTEGER NOT NULL, key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, expires_at TEXT DEFAULT '', note TEXT DEFAULT '', updated_at TEXT, updated_by TEXT DEFAULT '', PRIMARY KEY (tenant_id, key))`);
  const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  function row(tid, key) { return db.prepare('SELECT * FROM tenant_addons WHERE tenant_id=? AND key=?').get(tid, key) || null; }
  function status(tid, key) {
    const c = CATALOG[key]; if (!c) return { enabled: false };
    const r = row(tid, key); const on = r ? !!r.enabled : c.default; const expired = !!(on && r?.expires_at && r.expires_at < todayTW());
    return { key, name: c.name, enabled: on && !expired, switched_on: on, expired, expires_at: r?.expires_at || '', note: r?.note || '', updated_at: r?.updated_at || '', updated_by: r?.updated_by || '' };
  }
  const isOn = (tid, key) => status(Number(tid), key).enabled;

  app.get('/api/admin/addons', requireSuperAdmin, (req, res) => {
    const tenants = db.prepare('SELECT id,name,code,status FROM tenants ORDER BY id').all();
    res.json({ catalog: CATALOG, tenants: tenants.map(t => ({ ...t, addons: Object.fromEntries(Object.keys(CATALOG).map(k => [k, status(t.id, k)])) })) });
  });
  app.put('/api/admin/addons/:tid/:key', requireSuperAdmin, (req, res) => {
    const tid = Number(req.params.tid), key = req.params.key; if (!CATALOG[key]) return res.status(404).json({ error: '沒有這個加值功能' });
    if (!db.prepare('SELECT 1 FROM tenants WHERE id=?').get(tid)) return res.status(404).json({ error: '找不到公司' });
    const b = req.body || {}; const exp = /^\d{4}-\d{2}-\d{2}$/.test(b.expires_at || '') ? b.expires_at : '';
    db.prepare('INSERT INTO tenant_addons (tenant_id,key,enabled,expires_at,note,updated_at,updated_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET enabled=excluded.enabled,expires_at=excluded.expires_at,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by')
      .run(tid, key, b.enabled ? 1 : 0, exp, str(b.note, 200), now(), '系統總後台');
    res.json({ success: true, addon: status(tid, key) });
  });
  return { isOn, status, CATALOG };
};
