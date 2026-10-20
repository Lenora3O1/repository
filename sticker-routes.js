// 內部訊息貼圖：
// - 內建文字貼圖（MESSAGE_STICKERS）：總後台可以隱藏不要的。
// - 平台貼圖：總後台上傳圖片／GIF，所有公司的人員都能使用。
// - 我的貼圖：內勤或現場人員自己上傳的圖片／GIF，只出現在自己的貼圖面板；對方收到時一樣看得到。
// 貼圖刪除只是停用，已傳出的訊息仍然看得到圖片。
'use strict';

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const MAX_PERSONAL = 60;

module.exports = function registerStickerRoutes(app, d) {
  const { db, fs, path, crypto, multer, DATA_DIR, getUser, tenantId, now, requireMessageUser, requireSuperAdmin, BUILTIN, imageLooksValid } = d;
  const DIR = path.join(DATA_DIR, 'uploads', 'stickers');
  fs.mkdirSync(DIR, { recursive: true });
  const SETTINGS = path.join(DATA_DIR, 'sticker-settings.json');

  db.exec(`CREATE TABLE IF NOT EXISTS message_stickers (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'platform', tenant_id INTEGER, owner_id INTEGER,
    text TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', size INTEGER DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_message_stickers_owner ON message_stickers(scope,tenant_id,owner_id,is_active);`);

  const upload = (maxMb) => multer({
    storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, DIR), filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${TYPES[file.mimetype] || '.img'}`) }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => TYPES[file.mimetype] ? cb(null, true) : cb(new Error('貼圖只能上傳 GIF、PNG、JPG 或 WEBP 圖片')),
  }).single('image');
  const runUpload = (mw, req, res) => new Promise(resolve => mw(req, res, err => {
    if (err) { res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '圖片太大了' : (err.message || '上傳失敗') }); return resolve(false); }
    if (!req.file) { res.status(400).json({ error: '請選擇圖片' }); return resolve(false); }
    const file = path.join(DIR, req.file.filename);
    if (!imageLooksValid(file)) { try { fs.unlinkSync(file); } catch {} res.status(400).json({ error: '這個檔案不是有效的圖片' }); return resolve(false); }
    resolve(true);
  }));
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf-8')) || {}; } catch { return {}; } };
  const hiddenBuiltins = () => new Set(Array.isArray(readSettings().hidden_builtin) ? readSettings().hidden_builtin : []);
  const imageUrl = id => `/api/messages/stickers/${encodeURIComponent(id)}/image`;
  const pub = r => ({ id: r.id, text: r.text, image: imageUrl(r.id), scope: r.scope, mime: r.mime, is_active: !!r.is_active, sort_order: r.sort_order, created_at: r.created_at, created_by: r.created_by });
  const text = v => String(v ?? '').trim().slice(0, 20);

  // ---------- 給訊息模組用 ----------
  function findForSend(id, user) {
    const b = BUILTIN.find(x => x.id === id);
    if (b) return hiddenBuiltins().has(b.id) ? null : { kind: 'builtin', sticker: b };
    const r = db.prepare('SELECT * FROM message_stickers WHERE id=? AND is_active=1').get(String(id || ''));
    if (!r) return null;
    if (r.scope === 'platform') return { kind: 'custom', sticker: r };
    if (r.scope === 'personal' && Number(r.owner_id) === Number(user.id) && Number(r.tenant_id) === Number(user.tenant_id)) return { kind: 'custom', sticker: r };
    return null;
  }
  function attachmentFor(stickerId, body) {
    const b = BUILTIN.find(x => x.id === stickerId);
    if (b) return { ...b };
    const r = db.prepare('SELECT id,text FROM message_stickers WHERE id=?').get(String(stickerId || ''));
    if (r) return { id: r.id, text: r.text, image: imageUrl(r.id), emoji: '🖼', tone: 'gray' };
    return { id: stickerId, emoji: '💬', text: String(body || '').replace(/^\[貼圖\]\s*/, ''), tone: 'gray' };
  }

  // ---------- 人員 ----------
  app.get('/api/messages/stickers', requireMessageUser, (req, res) => {
    const u = getUser(req); const hidden = hiddenBuiltins();
    const platform = db.prepare("SELECT * FROM message_stickers WHERE scope='platform' AND is_active=1 ORDER BY sort_order,created_at").all().map(pub);
    const mine = db.prepare("SELECT * FROM message_stickers WHERE scope='personal' AND tenant_id=? AND owner_id=? AND is_active=1 ORDER BY created_at DESC").all(tenantId(req), u.id).map(pub);
    res.set('Cache-Control', 'no-store');
    res.json({ stickers: [...BUILTIN.filter(x => !hidden.has(x.id)), ...platform], platform, mine, limits: { personal_max: MAX_PERSONAL, personal_mb: 2 } });
  });
  app.post('/api/messages/stickers', requireMessageUser, async (req, res) => {
    const u = getUser(req);
    const count = db.prepare("SELECT COUNT(*) c FROM message_stickers WHERE scope='personal' AND tenant_id=? AND owner_id=? AND is_active=1").get(tenantId(req), u.id).c;
    if (count >= MAX_PERSONAL) return res.status(400).json({ error: `我的貼圖最多 ${MAX_PERSONAL} 張，請先刪除不用的` });
    if (!(await runUpload(upload(2), req, res))) return;
    const id = `p_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare('INSERT INTO message_stickers (id,scope,tenant_id,owner_id,text,filename,mime,size,sort_order,is_active,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)')
      .run(id, 'personal', tenantId(req), u.id, text(req.body?.text) || '貼圖', req.file.filename, req.file.mimetype, req.file.size || 0, 0, u.name || u.employee_id || '', now());
    res.json({ success: true, sticker: pub(db.prepare('SELECT * FROM message_stickers WHERE id=?').get(id)) });
  });
  app.delete('/api/messages/stickers/:id', requireMessageUser, (req, res) => {
    const u = getUser(req);
    const r = db.prepare("SELECT * FROM message_stickers WHERE id=? AND scope='personal' AND tenant_id=? AND owner_id=?").get(req.params.id, tenantId(req), u.id);
    if (!r) return res.status(404).json({ error: '找不到這張貼圖' });
    db.prepare('UPDATE message_stickers SET is_active=0 WHERE id=?').run(r.id);
    res.json({ success: true });
  });
  // 圖片：平台貼圖任何登入者可看；個人貼圖限同公司（訊息對方需要看得到）
  app.get('/api/messages/stickers/:id/image', (req, res) => {
    const r = db.prepare('SELECT * FROM message_stickers WHERE id=?').get(req.params.id);
    if (!r) return res.status(404).end();
    const u = getUser(req); const admin = !!req.session?.isAdmin;
    if (!admin) {
      if (!u) return res.status(401).end();
      if (r.scope === 'personal' && Number(r.tenant_id) !== Number(u.tenant_id)) return res.status(404).end();
    }
    const file = path.join(DIR, path.basename(r.filename));
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader('Content-Type', r.mime || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file);
  });

  // ---------- 總後台 ----------
  app.get('/api/admin/stickers', requireSuperAdmin, (req, res) => {
    const hidden = hiddenBuiltins();
    const rows = db.prepare("SELECT * FROM message_stickers WHERE scope='platform' AND is_active=1 ORDER BY sort_order,created_at").all().map(pub);
    const personal = db.prepare("SELECT COUNT(*) c FROM message_stickers WHERE scope='personal' AND is_active=1").get().c;
    res.json({ builtin: BUILTIN.map(b => ({ ...b, hidden: hidden.has(b.id) })), platform: rows, personal_count: personal });
  });
  app.post('/api/admin/stickers', requireSuperAdmin, async (req, res) => {
    if (!(await runUpload(upload(5), req, res))) return;
    const id = `s_${crypto.randomBytes(8).toString('hex')}`;
    const max = db.prepare("SELECT COALESCE(MAX(sort_order),0) m FROM message_stickers WHERE scope='platform'").get().m;
    db.prepare('INSERT INTO message_stickers (id,scope,tenant_id,owner_id,text,filename,mime,size,sort_order,is_active,created_by,created_at) VALUES (?,?,NULL,NULL,?,?,?,?,?,1,?,?)')
      .run(id, 'platform', text(req.body?.text) || '貼圖', req.file.filename, req.file.mimetype, req.file.size || 0, Number(max) + 1, '總後台', now());
    res.json({ success: true, sticker: pub(db.prepare('SELECT * FROM message_stickers WHERE id=?').get(id)) });
  });
  app.put('/api/admin/stickers/order', requireSuperAdmin, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const st = db.prepare("UPDATE message_stickers SET sort_order=? WHERE id=? AND scope='platform'");
    ids.forEach((id, i) => st.run(i + 1, id));
    res.json({ success: true });
  });
  app.put('/api/admin/stickers/builtin', requireSuperAdmin, (req, res) => {
    const valid = new Set(BUILTIN.map(b => b.id));
    const hidden = (Array.isArray(req.body?.hidden) ? req.body.hidden : []).map(String).filter(x => valid.has(x));
    fs.writeFileSync(SETTINGS, JSON.stringify({ ...readSettings(), hidden_builtin: hidden }, null, 2), 'utf-8');
    res.json({ success: true, hidden });
  });
  app.put('/api/admin/stickers/:id', requireSuperAdmin, (req, res) => {
    const r = db.prepare("SELECT * FROM message_stickers WHERE id=? AND scope='platform'").get(req.params.id);
    if (!r) return res.status(404).json({ error: '找不到這張貼圖' });
    db.prepare('UPDATE message_stickers SET text=? WHERE id=?').run(text(req.body?.text) || r.text, r.id);
    res.json({ success: true });
  });
  app.delete('/api/admin/stickers/:id', requireSuperAdmin, (req, res) => {
    const r = db.prepare("SELECT * FROM message_stickers WHERE id=? AND scope='platform'").get(req.params.id);
    if (!r) return res.status(404).json({ error: '找不到這張貼圖' });
    db.prepare('UPDATE message_stickers SET is_active=0 WHERE id=?').run(r.id);
    res.json({ success: true });
  });

  return { findForSend, attachmentFor };
};
