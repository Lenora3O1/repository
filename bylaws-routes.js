// 社區資訊 → 規約：上傳目前版本（Word／PDF／純文字）、自動拆成章、條，全文搜尋，
// 線上逐條修改（每次儲存保留一個版本），下載 Word（.docx）；PDF 由前端列印另存。
// 規約屬於社區的資料：只看得到目前所在社區的規約；經理、秘書可以上傳與修改。
'use strict';
const { readZip, writeZip } = require('./mini-zip');

const NUMS = '零〇一二三四五六七八九十百千0-9０-９';
const RE_CHAPTER = new RegExp(`^第\\s*[${NUMS}]+\\s*章\\s*[、：:．.]?\\s*(.*)$`);
const RE_ARTICLE = new RegExp(`^(第\\s*[${NUMS}]+\\s*條(?:\\s*之\\s*[${NUMS}]+)?)\\s*[、：:．.]?\\s*(.*)$`);

// 文字 → 條文結構：[{ type: 'title'|'chapter'|'article'|'text', no, title, body }]
function parseBylaws(text) {
  const lines = String(text || '').replace(/\r/g, '').replace(/　+$/gm, '').split('\n').map(s => s.replace(/\s+$/, ''));
  const items = []; let cur = null; let title = '';
  const push = it => { items.push(it); cur = it; };
  for (const raw of lines) {
    const line = raw.trim(); if (!line) { if (cur && cur.body && !cur.body.endsWith('\n')) cur.body += '\n'; continue; }
    let m;
    if ((m = line.match(RE_CHAPTER))) { push({ type: 'chapter', no: line.slice(0, line.length - m[1].length).replace(/[、：:．.\s]+$/, '').replace(/\s+/g, ''), title: m[1].trim(), body: '' }); continue; }
    if ((m = line.match(/^附\s*則\s*[：:　\s]*(.*)$/))) { push({ type: 'chapter', no: '附則', title: '', body: '' }); if (m[1].trim()) push({ type: 'text', no: '', title: '', body: m[1].trim() }); continue; }
    if ((m = line.match(RE_ARTICLE))) {
      let rest = m[2].trim(), t = '';
      const tm = rest.match(/^[（(]([^）)]{1,30})[）)]\s*(.*)$/); if (tm) { t = tm[1]; rest = tm[2]; }
      push({ type: 'article', no: m[1].replace(/\s+/g, ''), title: t, body: rest }); continue;
    }
    // 條名寫在下一行：「（名稱）」
    if (cur?.type === 'article' && !cur.title && !cur.body && /^[（(][^）)]{1,30}[）)]$/.test(line)) { cur.title = line.slice(1, -1); continue; }
    if (!cur) { if (!title && /規約|章程|辦法|公約/.test(line) && line.length <= 60) { title = line; continue; } push({ type: 'text', no: '', title: '', body: line }); continue; }
    cur.body = cur.body ? `${cur.body.replace(/\n+$/, '')}\n${line}` : line;
  }
  for (const it of items) it.body = String(it.body || '').replace(/\n{3,}/g, '\n\n').trim();
  return { title, items: items.filter(it => it.type !== 'text' || it.body) };
}

// .docx → 純文字（段落換行；表格每格以全形空白隔開）
function docxText(buf) {
  const files = readZip(buf); const xml = files.get('word/document.xml');
  if (!xml) throw new Error('這不是 Word（.docx）檔');
  const s = xml.toString('utf8');
  const dec = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
  const out = [];
  for (const p of s.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) || []) {
    let t = '';
    for (const tok of p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g) || []) {
      if (tok === '<w:tab/>') t += '　'; else if (tok === '<w:br/>' || tok === '<w:cr/>') t += '\n'; else t += dec(tok.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, ''));
    }
    out.push(t);
  }
  return out.join('\n');
}

// 條文 → .docx（標楷體、A4）
function buildDocx({ title, items, footer }) {
  const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (t, { b = false, sz = 24 } = {}) => String(t).split('\n').map((ln, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/>${b ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${x(ln)}</w:t></w:r>`).join('');
  const para = (inner, { center = false, before = 0, after = 120, ind = 0 } = {}) => `<w:p><w:pPr>${center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:before="${before}" w:after="${after}" w:line="400" w:lineRule="auto"/>${ind ? `<w:ind w:left="${ind}"/>` : ''}</w:pPr>${inner}</w:p>`;
  let body = '';
  if (title) body += para(run(title, { b: true, sz: 36 }), { center: true, after: 360 });
  for (const it of items) {
    if (it.type === 'chapter') body += para(run(`${it.no}${it.title ? `　${it.title}` : ''}`, { b: true, sz: 28 }), { center: true, before: 240, after: 160 });
    else if (it.type === 'article') { body += para(run(`${it.no}${it.title ? `（${it.title}）` : ''}`, { b: true }), { before: 120, after: 60 }); if (it.body) body += para(run(it.body), { ind: 480 }); }
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
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const wrap = fn => (req, res) => { try { res.set('Cache-Control', 'no-store'); fn(req, res); } catch (e) { if (!res.headersSent) res.status(e.status || 400).json({ error: e.message || '操作失敗' }); } };
  const str = (v, m) => String(v ?? '').replace(/\r/g, '').trim().slice(0, m);
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  function ctx(req, edit) {
    const u = getUser(req);
    if (!u || !u.is_active || u.role === 'company_admin' || ['left', 'blacklist', 'disabled'].includes(String(u.person_status || ''))) throw err('這個帳號沒有權限', 403);
    if (staffMenuAllows && !staffMenuAllows(u, 'bylaws') && !staffMenuAllows(u, 'community-info')) throw err('目前帳號沒有開通「規約」，請洽公司內勤', 403);
    if (edit && !residentCanEdit(u)) throw err('規約由經理、秘書上傳與修改', 403);
    const c = residentActiveCommunity(req); if (!c) throw err('請先選擇社區');
    return { u, tid: tenantId(req), cid: c.id, community: c, by: u.name || u.employee_id || '' };
  }
  const meta = r => ({ id: r.id, version_no: r.version_no, title: r.title, amend_date: r.amend_date, amend_note: r.amend_note, source: r.source, has_file: !!r.file_name, file_original: r.file_original, created_by: r.created_by, created_at: r.created_at });
  const full = r => ({ ...meta(r), items: JSON.parse(r.items_json || '[]') });
  const current = t => db.prepare('SELECT * FROM community_bylaws WHERE tenant_id=? AND community_id=? ORDER BY version_no DESC LIMIT 1').get(t.tid, t.cid);
  const find = (t, id) => { const r = db.prepare('SELECT * FROM community_bylaws WHERE id=? AND tenant_id=? AND community_id=?').get(Number(id), t.tid, t.cid); if (!r) throw err('找不到這個版本', 404); return r; };
  function cleanItems(list) {
    if (!Array.isArray(list)) throw err('條文格式不正確');
    const out = list.slice(0, 1500).map(it => ({ type: ['chapter', 'article', 'text'].includes(it?.type) ? it.type : 'article', no: str(it?.no, 30), title: str(it?.title, 60), body: str(it?.body, 20000) })).filter(it => it.no || it.title || it.body);
    if (!out.length) throw err('規約內容是空的');
    if (JSON.stringify(out).length > 2_000_000) throw err('規約內容太長');
    return out;
  }

  app.get('/api/staff/bylaws', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, false); const r = current(t);
    const versions = db.prepare('SELECT * FROM community_bylaws WHERE tenant_id=? AND community_id=? ORDER BY version_no DESC').all(t.tid, t.cid).map(meta);
    res.json({ community: t.community, current: r ? full(r) : null, versions, can_edit: residentCanEdit(t.u) });
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
    }
    if (!text.trim()) throw err(f && /\.pdf$/i.test(f.originalname || '') ? '這份 PDF 讀不到文字（可能是掃描檔）。請改上傳 Word 檔，或把文字貼上。' : '沒有讀到任何文字');
    const p = parseBylaws(text);
    res.json({ title: p.title, items: p.items, stats: { chapters: p.items.filter(i => i.type === 'chapter').length, articles: p.items.filter(i => i.type === 'article').length, chars: text.length }, token });
  }));

  // 儲存成新版本（上傳或線上修改都會產生新版本，舊版本保留）
  app.post('/api/staff/bylaws', requireStaffFiller, wrap((req, res) => {
    const t = ctx(req, true); const b = req.body || {}; const items = cleanItems(b.items);
    const amend_date = isDate(b.amend_date) ? b.amend_date : ''; const amend_note = str(b.amend_note, 200); const title = str(b.title, 80) || `${t.community.name}規約`;
    let file = { name: '', original: '', mime: '', size: 0 };
    if (b.token) {
      const token = String(b.token); if (!/^[0-9]+-[0-9]+-[0-9a-f]{16}\.(docx|pdf|txt)$/.test(token) || !token.startsWith(`${t.tid}-${t.cid}-`)) throw err('上傳檔案已失效，請重新上傳');
      const p = path.join(DIR, token); if (!fs.existsSync(p)) throw err('上傳檔案已失效，請重新上傳');
      let m = {}; try { m = JSON.parse(fs.readFileSync(`${p}.json`, 'utf8')); } catch {}
      file = { name: token, original: m.original || token, mime: m.mime || '', size: m.size || 0 };
    }
    const no = (current(t)?.version_no || 0) + 1;
    const info = db.prepare('INSERT INTO community_bylaws (tenant_id,community_id,version_no,title,items_json,amend_date,amend_note,source,file_name,file_original,file_mime,file_size,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.tid, t.cid, no, title, JSON.stringify(items), amend_date, amend_note, b.token ? 'upload' : 'edit', file.name, file.original, file.mime, file.size, t.by, now());
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
  return { parseBylaws, docxText, buildDocx };
};
module.exports.parseBylaws = parseBylaws;
module.exports.docxText = docxText;
module.exports.buildDocx = buildDocx;
