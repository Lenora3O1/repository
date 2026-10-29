// 社區資訊 → 規約：上傳目前版本（Word／PDF／純文字）、自動拆成章、條，全文搜尋，
// 線上逐條修改（每次儲存保留一個版本），下載 Word（.docx）；PDF 由前端列印另存。
// 規約屬於社區的資料：只看得到目前所在社區的規約；經理、秘書可以上傳與修改。
'use strict';
const { readZip, writeZip } = require('./mini-zip');

const { parseBylaws, docxText, committeeFromBylaws } = require('./bylaws-parse');

// 條文 → .docx（標楷體、A4）
function buildDocx({ title, items, footer }) {
  const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (t, { b = false, sz = 24 } = {}) => String(t).split('\n').map((ln, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/>${b ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${x(ln)}</w:t></w:r>`).join('');
  const para = (inner, { center = false, before = 0, after = 120, ind = 0 } = {}) => `<w:p><w:pPr>${center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:before="${before}" w:after="${after}" w:line="400" w:lineRule="auto"/>${ind ? `<w:ind w:left="${ind}"/>` : ''}</w:pPr>${inner}</w:p>`;
  let body = '';
  if (title) body += para(run(title, { b: true, sz: 36 }), { center: true, after: 360 });
  for (const it of items) {
    if (it.type === 'chapter') body += para(run([it.no, it.title].filter(Boolean).join('　'), { b: true, sz: 28 }), { center: true, before: 240, after: 160 });
    else if (it.type === 'article') { body += para(run(`${it.no}${it.title ? (/、$/.test(it.no) ? it.title : `（${it.title}）`) : ''}`, { b: true }), { before: 120, after: 60 }); if (it.body) body += para(run(it.body), { ind: 480 }); }
    else if (it.body) body += para(run(it.body));
  }
  if (footer) body += para(run(footer, { sz: 20 }), { before: 360 });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', doc],
  ]);
}

module.exports = function registerBylawsRoutes(app, d) {
  const { db, fs, path, crypto, multer, DATA_DIR, getUser, tenantId, now, requireStaffFiller, residentActiveCommunity, residentCanEdit, staffMenuAllows } = d;
  const DIR = path.join(DATA_DIR, 'uploads', 'bylaws'); try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS community_bylaws (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, version_no INTEGER NOT NULL, title TEXT DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]',
    amend_date TEXT DEFAULT '', amend_note TEXT DEFAULT '', source TEXT DEFAULT 'edit', file_name TEXT DEFAULT '', file_original TEXT DEFAULT '', file_mime TEXT DEFAULT '', file_size INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bylaws ON community_bylaws(tenant_id, community_id, version_no);`);
  { const cols = db.prepare('PRAGMA table_info(community_bylaws)').all().map(c => c.name); if (!cols.includes('kind')) db.exec("ALTER TABLE community_bylaws ADD COLUMN kind TEXT NOT NULL DEFAULT 'bylaws'"); }
  // 規約（區分所有權人會議訂定）與管理辦法（管理委員會訂定）分開保存、分開編版本
  const KINDS = { bylaws: '規約', rules: '管理辦法' };
  const kindOf = req => (KINDS[req.query?.kind] ? req.query.kind : KINDS[req.body?.kind] ? req.body.kind : 'bylaws');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { res.set('Cache-Control', 'no-store'); fn(req, res); } catch (e) { if (!res.headersSent) res.status(e.status || 400).json({ error: e.message || '操作失敗' }); } };
  const str = (v, m) => String(v ?? '').replace(/\r/g, '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  function ctx(req, edit) {
    const u = getUser(req);
    if (!u || !u.is_active || u.role === 'company_admin' || ['left', 'blacklist', 'disabled'].includes(String(u.person_status || ''))) throw err('這個帳號沒有權限', 403);
    const kind = kindOf(req); const action = kind === 'rules' ? 'mgmt-rules' : 'bylaws';
    if (staffMenuAllows && !staffMenuAllows(u, action) && !staffMenuAllows(u, 'community-info')) throw err(`目前帳號沒有開通「${KINDS[kind]}」，請洽公司內勤`, 403);
    if (edit && !residentCanEdit(u)) throw err(`${KINDS[kind]}由經理、秘書上傳與修改`, 403);
    const c = residentActiveCommunity(req); if (!c) throw err('請先選擇社區');
    return { u, tid: tenantId(req), cid: c.id, community: c, kind, by: u.name || u.employee_id || '' };
  }
  const meta = r => ({ id: r.id, kind: r.kind || 'bylaws', version_no: r.version_no, title: r.title, amend_date: r.amend_date, amend_note: r.amend_note, source: r.source, has_file: !!r.file_name, file_original: r.file_original, created_by: r.created_by, created_at: r.created_at });
  const full = r => ({ ...meta(r), items: JSON.parse(r.items_json || '[]') });
  const current = t => db.prepare('SELECT * FROM community_bylaws WHERE tenant_id=? AND community_id=? AND kind=? ORDER BY version_no DESC LIMIT 1').get(t.tid, t.cid, t.kind);
  const find = (t, id) => { const r = db.prepare('SELECT * FROM community_bylaws WHERE id=? AND tenant_id=? AND community_id=? AND kind=?').get(Number(id), t.tid, t.cid, t.kind); if (!r) throw err('找不到這個版本', 404); return r; };
  function cleanItems(list) {
    if (!Array.isArray(list)) throw err('條文格式不正確');
    const out = list.slice(0, 1500).map(it => ({ type: ['chapter', 'article', 'text'].includes(it?.type) ? it.type : 'article', no: str(it?.no, 30), title: str(it?.title, 60), body: str(it?.body, 20000) })).filter(it => it.no || it.title || it.body);
    if (!out.length) throw err('規約內容是空的');
    if (JSON.stringify(out).length > 2_000_000) throw err('規約內容太長');
    return out;
  }

  app.get('/api/staff/bylaws', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, false); const r = current(t);
    const versions = db.prepare('SELECT * FROM community_bylaws WHERE tenant_id=? AND community_id=? AND kind=? ORDER BY version_no DESC').all(t.tid, t.cid, t.kind).map(meta);
    res.json({ community: t.community, kind: t.kind, kind_label: KINDS[t.kind], current: r ? full(r) : null, versions, can_edit: residentCanEdit(t.u) });
  }));
  app.get('/api/staff/bylaws/versions/:id', requireStaffFiller, wrap((req, res) => { const t = ctx(req, false); res.json({ version: full(find(t, req.params.id)) }); }));

  // 上傳 → 解析預覽（還沒存）。Word 由伺服器讀；PDF 由瀏覽器先抽出文字一併送來；也可以直接貼文字。
  app.post('/api/staff/bylaws/parse', requireStaffFiller, upload.single('file'), wrap((req, res) => {
    const t = ctx(req, true); const f = req.file; let text = String(req.body?.text || ''); let token = '';
    if (f) {
      const ext = path.extname(f.originalname || '').toLowerCase();
      if (!['.docx', '.pdf', '.txt'].includes(ext)) throw err('請上傳 Word（.docx）、PDF 或純文字檔；舊版 .doc 請先另存成 .docx');
      if (ext === '.docx') text = docxText(f.buffer); else if (ext === '.txt') text = f.buffer.toString('utf8');
      token = `${t.tid}-${t.cid}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(DIR, token), f.buffer);
      fs.writeFileSync(path.join(DIR, `${token}.json`), JSON.stringify({ original: String(f.originalname || ''), mime: f.mimetype || '', size: f.size || 0 }));
      if (ext === '.pdf' && text.trim()) fs.writeFileSync(path.join(DIR, `${token}.txt`), text);
    }
    if (!text.trim()) throw err(f && /\.pdf$/i.test(f.originalname || '') ? '這份 PDF 讀不到文字（可能是掃描檔）。請改上傳 Word 檔，或把文字貼上。' : '沒有讀到任何文字');
    res.json(preview(text, !(f && /\.docx$/i.test(f.originalname || '')), token));
  }));
  function preview(text, wrapped, token) {
    const p = parseBylaws(text, { wrapped });
    return { title: p.title, items: p.items, stats: { chapters: p.items.filter(i => i.type === 'chapter').length, articles: p.items.filter(i => i.type === 'article').length, chars: text.length }, token };
  }
  // 用已保存的原始檔重新解析（解析規則改良後，舊上傳不必重傳）
  app.post('/api/staff/bylaws/versions/:id/reparse', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, true); const r = find(t, req.params.id); if (!r.file_name) throw err('這個版本沒有原始檔，無法重新解析');
    const p = path.join(DIR, r.file_name); if (!fs.existsSync(p)) throw err('原始檔已不存在', 404);
    const ext = path.extname(r.file_name).toLowerCase(); let text = '';
    if (ext === '.docx') text = docxText(fs.readFileSync(p)); else if (ext === '.txt') text = fs.readFileSync(p, 'utf8'); else if (fs.existsSync(`${p}.txt`)) text = fs.readFileSync(`${p}.txt`, 'utf8');
    if (!text.trim()) throw err('這份 PDF 沒有保存文字，請重新上傳一次');
    res.json({ ...preview(text, ext !== '.docx', r.file_name), title_hint: r.title, amend_date: r.amend_date, amend_note: r.amend_note });
  }));

  // 儲存成新版本（上傳或線上修改都會產生新版本，舊版本保留）
  app.post('/api/staff/bylaws', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, true); const b = req.body || {}; const items = cleanItems(b.items);
    const amend_date = isDate(b.amend_date) ? b.amend_date : ''; const amend_note = str(b.amend_note, 200); const title = str(b.title, 80) || `${t.community.name}${KINDS[t.kind]}`;
    let file = { name: '', original: '', mime: '', size: 0 };
    if (b.token) {
      const token = String(b.token); if (!/^[0-9]+-[0-9]+-[0-9a-f]{16}\.(docx|pdf|txt)$/.test(token) || !token.startsWith(`${t.tid}-${t.cid}-`)) throw err('上傳檔案已失效，請重新上傳');
      const p = path.join(DIR, token); if (!fs.existsSync(p)) throw err('上傳檔案已失效，請重新上傳');
      let m = {}; try { m = JSON.parse(fs.readFileSync(`${p}.json`, 'utf8')); } catch {}
      file = { name: token, original: m.original || token, mime: m.mime || '', size: m.size || 0 };
    }
    const no = (current(t)?.version_no || 0) + 1;
    const info = db.prepare('INSERT INTO community_bylaws (tenant_id,community_id,kind,version_no,title,items_json,amend_date,amend_note,source,file_name,file_original,file_mime,file_size,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.tid, t.cid, t.kind, no, title, JSON.stringify(items), amend_date, amend_note, b.token ? 'upload' : 'edit', file.name, file.original, file.mime, file.size, t.by, now());
    res.json({ current: full(find(t, info.lastInsertRowid)) });
  }));

  // 原始檔下載
  app.get('/api/staff/bylaws/versions/:id/file', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, false); const r = find(t, req.params.id); if (!r.file_name) throw err('這個版本沒有上傳原始檔', 404);
    const p = path.join(DIR, r.file_name); if (!fs.existsSync(p)) throw err('原始檔已不存在', 404);
    res.set('Content-Type', r.file_mime || 'application/octet-stream'); res.set('Content-Disposition', `attachment; filename="bylaws${path.extname(r.file_name)}"; filename*=UTF-8''${encodeURIComponent(r.file_original || r.file_name)}`);
    res.send(fs.readFileSync(p));
  }));
  // 產生 Word
  app.get('/api/staff/bylaws/versions/:id/docx', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, false); const r = full(find(t, req.params.id));
    const footer = `第 ${r.version_no} 版${r.amend_date ? `｜修正日期 ${r.amend_date}` : ''}${r.amend_note ? `｜${r.amend_note}` : ''}`;
    const buf = buildDocx({ title: r.title, items: r.items, footer });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="bylaws.docx"; filename*=UTF-8''${encodeURIComponent(`${r.title || '規約'}（第${r.version_no}版）.docx`)}`);
    res.send(buf);
  }));
  // 本屆委員：依目前規約找出委員會組成（職務與人數）、任期
  app.get('/api/staff/committee/bylaws-suggest', requireStaffFiller, wrap((req, res) => {
    req.query.kind = 'bylaws'; const t = ctx(req, true); const r = current(t);
    if (!r) return res.json({ found: false, reason: '尚未上傳規約' });
    const c = committeeFromBylaws(JSON.parse(r.items_json || '[]'));
    if (!c) return res.json({ found: false, reason: '規約裡沒有找到委員人數或職務的規定' });
    let term = null;
    if (c.term && c.term.from.every(Boolean) && c.term.to.every(Boolean)) {
      const tw = new Date(Date.now() + 8 * 3600e3); const y = tw.getUTCFullYear(); const md = (tw.getUTCMonth() + 1) * 100 + tw.getUTCDate();
      const [fm, fd] = c.term.from, [tm, td] = c.term.to; const sy = md >= fm * 100 + fd ? y : y - 1; const p2 = n => String(n).padStart(2, '0');
      term = { start: `${sy}-${p2(fm)}-${p2(fd)}`, end: `${sy + 1}-${p2(tm)}-${p2(td)}`, text: c.term.text, no: c.term.no };
    }
    res.json({ found: true, version: { id: r.id, version_no: r.version_no, title: r.title }, roles: c.roles, generic: c.generic, total: c.total, source: c.source, term });
  }));
  return { parseBylaws, docxText, buildDocx };
};
module.exports.parseBylaws = parseBylaws;
module.exports.docxText = docxText;
module.exports.buildDocx = buildDocx;
