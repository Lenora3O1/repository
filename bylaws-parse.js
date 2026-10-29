// 規約／管理辦法解析：
// 1. Word（.docx）：還原 Word「自動編號」（第%1章、第%1條、一、（一）…），並把表格每列合成一行。
// 2. PDF／貼上文字：移除目錄、頁碼、每頁重複的頁首，接回 PDF 斷行。
// 3. 拆成段落：章／辦法名稱（chapter）、條（article）、說明文字（text）。
//    規約用「第○條」；管理辦法常常只有「一、二、」，同一辦法沒有「第○條」時就用「一、」當一條。
'use strict';
const { readZip } = require('./mini-zip');

// ---------- 數字格式（Word numFmt） ----------
const CN = '〇一二三四五六七八九';
function cnCount(n) {
  if (n <= 0) return String(n);
  if (n < 10) return CN[n];
  if (n < 20) return `十${n % 10 ? CN[n % 10] : ''}`;
  if (n < 100) return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`;
  if (n < 1000) { const h = Math.floor(n / 100), r = n % 100; return `${CN[h]}百${r ? (r < 10 ? `〇${CN[r]}` : r < 20 ? `一${cnCount(r)}` : cnCount(r)) : ''}`; }
  return String(n);
}
const roman = n => { const v = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [k, r] of v) while (n >= k) { s += r; n -= k; } return s; };
const letters = n => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
function fmtNum(n, f) {
  switch (f) {
    case 'decimal': case 'decimalHalfWidth': return String(n);
    case 'decimalZero': return String(n).padStart(2, '0');
    case 'decimalFullWidth': case 'decimalFullWidth2': return String(n).replace(/\d/g, d => String.fromCharCode(0xFF10 + Number(d)));
    case 'upperLetter': return letters(n); case 'lowerLetter': return letters(n).toLowerCase();
    case 'upperRoman': return roman(n); case 'lowerRoman': return roman(n).toLowerCase();
    case 'taiwaneseCountingThousand': case 'taiwaneseCounting': case 'chineseCounting': case 'chineseCountingThousand': case 'japaneseCounting': case 'koreanCounting': return cnCount(n);
    case 'ideographDigital': case 'taiwaneseDigital': case 'japaneseDigitalTenThousand': return String(n).replace(/\d/g, d => CN[d]);
    case 'ideographTraditional': return '甲乙丙丁戊己庚辛壬癸'[(n - 1) % 10];
    case 'ideographZodiac': return '子丑寅卯辰巳午未申酉戌亥'[(n - 1) % 12];
    case 'chineseLegalSimplified': case 'ideographLegalTraditional': return cnCount(n).replace(/[一二三四五六七八九十百〇]/g, c => ({ 一: '壹', 二: '貳', 三: '參', 四: '肆', 五: '伍', 六: '陸', 七: '柒', 八: '捌', 九: '玖', 十: '拾', 百: '佰', 〇: '零' })[c]);
    case 'decimalEnclosedCircle': case 'decimalEnclosedCircleChinese': return n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
    case 'decimalEnclosedParen': return n <= 20 ? String.fromCharCode(0x2474 + n - 1) : `(${n})`;
    case 'decimalEnclosedFullstop': return `${n}.`;
    case 'none': return '';
    default: return String(n);
  }
}

// ---------- Word ----------
const dec = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const attr = (s, tag, a = 'w:val') => { const m = s.match(new RegExp(`<${tag}\\b[^>]*\\b${a}="([^"]*)"`)); return m ? m[1] : null; };
function loadNumbering(files) {
  const xml = files.get('word/numbering.xml')?.toString('utf8') || '';
  const abs = {}, nums = {};
  const parseLvls = body => { const L = {}; for (const m of body.matchAll(/<w:lvl\b[^>]*w:ilvl="(\d)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) L[m[1]] = { start: Number(attr(m[2], 'w:start') ?? 1), fmt: attr(m[2], 'w:numFmt') || 'decimal', text: dec(attr(m[2], 'w:lvlText') ?? ''), suff: attr(m[2], 'w:suff') || 'tab', restart: attr(m[2], 'w:lvlRestart') }; return L; };
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) abs[m[1]] = { lvls: parseLvls(m[2]), link: attr(m[2], 'w:numStyleLink') || attr(m[2], 'w:styleLink') };
  for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const ov = {}; for (const o of m[2].matchAll(/<w:lvlOverride\b[^>]*w:ilvl="(\d)"[^>]*>([\s\S]*?)<\/w:lvlOverride>/g)) { const so = attr(o[2], 'w:startOverride'); const lv = parseLvls(o[2]); ov[o[1]] = { start: so !== null ? Number(so) : null, lvl: lv[o[1]] || null }; }
    nums[m[1]] = { abs: attr(m[2], 'w:abstractNumId'), ov };
  }
  return { abs, nums };
}
function loadStyles(files) {
  const xml = files.get('word/styles.xml')?.toString('utf8') || ''; const st = {};
  for (const m of xml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const np = m[2].match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
    st[m[1]] = { basedOn: attr(m[2], 'w:basedOn'), numId: np ? attr(np[1], 'w:numId') : null, ilvl: np ? attr(np[1], 'w:ilvl') : null, outline: attr(m[2], 'w:outlineLvl') };
  }
  return st;
}
function docxText(buf) {
  const files = readZip(buf); const xml = files.get('word/document.xml');
  if (!xml) throw new Error('這不是 Word（.docx）檔');
  const N = loadNumbering(files), ST = loadStyles(files);
  const styleNum = id => { let s = ST[id], g = 0; while (s && g++ < 10) { if (s.numId !== null) return s; s = ST[s.basedOn]; } return null; };
  const counters = {};
  function prefix(numId, ilvl) {
    const num = N.nums[numId]; if (!num) return '';
    let a = N.abs[num.abs]; if (!a) return '';
    if (!Object.keys(a.lvls).length && a.link) { const s = ST[a.link]; const n2 = s && N.nums[s.numId]; if (n2 && N.abs[n2.abs]) a = N.abs[n2.abs]; }
    const lvlOf = i => num.ov[i]?.lvl || a.lvls[i];
    const L = lvlOf(ilvl); if (!L) return '';
    const hasOv = Object.values(num.ov).some(o => o.start !== null);
    const key = hasOv ? `n${numId}` : `a${num.abs}`;
    const c = counters[key] || (counters[key] = { v: [], seen: false });
    if (hasOv && !c.seen) { c.seen = true; for (const [i, o] of Object.entries(num.ov)) if (o.start !== null) c.v[i] = o.start - 1; }
    for (let i = 0; i < ilvl; i++) if (c.v[i] === undefined) c.v[i] = (lvlOf(i)?.start ?? 1);
    c.v[ilvl] = (c.v[ilvl] === undefined ? L.start - 1 : c.v[ilvl]) + 1;
    for (let i = ilvl + 1; i < 9; i++) if (!lvlOf(i) || lvlOf(i).restart !== '0') c.v[i] = undefined;
    if (L.fmt === 'bullet') return '・';
    const txt = L.text.replace(/%(\d)/g, (_, k) => { const i = Number(k) - 1; return fmtNum(c.v[i] ?? lvlOf(i)?.start ?? 1, lvlOf(i)?.fmt || 'decimal'); });
    return txt + (L.suff === 'nothing' || /[、，,．.）)：:]$/.test(txt) ? '' : L.suff === 'space' ? ' ' : '　');
  }
  const runText = p => { let t = ''; for (const tok of p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\/>|<w:cr\/>|<w:noBreakHyphen\/>/g) || []) { if (tok === '<w:tab/>') t += '　'; else if (tok === '<w:br/>' || tok === '<w:cr/>') t += '\n'; else if (tok === '<w:noBreakHyphen/>') t += '-'; else if (tok !== '<w:t/>') t += dec(tok.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '')); } return t; };
  const para = p => {
    const pPr = (p.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || '';
    const np = (pPr.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/) || [])[1];
    const sid = attr(pPr, 'w:pStyle'); const sn = sid ? styleNum(sid) : null;
    let numId = np ? attr(np, 'w:numId') : sn?.numId; let ilvl = Number((np && attr(np, 'w:ilvl')) ?? sn?.ilvl ?? 0);
    const body = runText(p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ''));
    if (!body.trim() || !numId || numId === '0') return body;
    return prefix(numId, ilvl) + body.replace(/^\s+/, '');
  };
  const s = xml.toString('utf8'); const bodyXml = (s.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || s;
  const out = [];
  for (const m of bodyXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const blk = m[0];
    if (blk.startsWith('<w:tbl>')) { for (const tr of blk.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []) { const cells = (tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(tc => (tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(para).join(' ').replace(/\s+/g, ' ').trim()); if (cells.some(Boolean)) out.push(`｜${cells.join('｜')}｜`); } }
    else if (blk.endsWith('/>')) out.push(''); else out.push(para(blk));
  }
  return out.join('\n');
}

// ---------- 文字整理 ----------
const NUMS = '零〇一二三四五六七八九十百千0-9０-９';
const RE_CHAPTER = new RegExp(`^第\\s*[${NUMS}]+\\s*[章篇編]\\s*[、：:．.　\\s]*(.*)$`);
const RE_SECTION = new RegExp(`^第\\s*[${NUMS}]+\\s*節\\s*[、：:．.　\\s]*(.*)$`);
const RE_ARTICLE = new RegExp(`^(第\\s*[${NUMS}]+\\s*條(?:\\s*之\\s*[${NUMS}]+)?)\\s*[、：:．.　\\s]*(.*)$`);
const RE_POINT = /^([一二三四五六七八九十百]+)\s*[、．.]\s*(.*)$/;
const RE_LIST = new RegExp(`^(第\\s*[${NUMS}]+\\s*[章篇編節條款項目]|[一二三四五六七八九十百]+\\s*[、．.]|[（(][一二三四五六七八九十百\\d０-９]+[）)]|\\d+\\s*[\\.、．)]|[０-９]+[．、]|[a-zA-Z][\\.、)]|[甲乙丙丁戊己庚辛壬癸][、.．]|[①-⑳⑴-⒇・•●○◎■□▲△※＊*-]|附\\s*則|附\\s*件|附\\s*表|｜)`);
const TITLE_WORDS = '(規約|章程|辦法|規則|規定|要點|須知|細則|公約|規範|標準|守則|準則)';
const RE_DOC_TITLE = new RegExp(`^[^，。；：、0-9（(）)]{2,28}${TITLE_WORDS}$`);
const RE_TOC = /(\.{4,}|…{2,}|．{4,}|·{4,}|-{6,})\s*[\d０-９]+(\s*[~～\-－]\s*[\d０-９]+)?\s*$/;
const RE_PAGE = /^(第\s*[\d０-９]+\s*頁[，,\s]*共\s*[\d０-９]+\s*頁|[-－—–]?\s*[\d０-９]+\s*[-－—–]?|[\d０-９]+\s*\/\s*[\d０-９]+|page\s*\d+(\s*of\s*\d+)?)$/i;
const END_PUNCT = /[。：:；;！!？?」』）)】]$/;

function cleanLines(text, { wrapped = false } = {}) {
  let lines = String(text || '').replace(/\r/g, '').replace(/\t/g, '　').replace(/ /g, ' ').split('\n').map(s => s.replace(/[\s　]+$/, ''));
  // 目錄（記下「第○章 名稱」對照）、頁碼
  const toc = new Map();
  const tocLine = t => { if (RE_TOC.test(t)) return t.replace(RE_TOC, '').trim(); const m = t.match(/^(.*?)[\s　.…·．]*[\d０-９]+(\s*[~～\-－]\s*[\d０-９]+)?$/); if (m && m[1] && (RE_CHAPTER.test(m[1].trim()) || RE_DOC_TITLE.test(m[1].trim().replace(/^第\s*[零〇一二三四五六七八九十百]+\s*章\s*/, '')))) return m[1].trim(); return null; };
  lines = lines.filter(l => { const t = l.trim(); if (!t) return true; if (/^目\s*錄$/.test(t) || RE_PAGE.test(t)) return false; const h = tocLine(t); if (h !== null) { const m = h.match(RE_CHAPTER); if (m && m[1]) toc.set(m[1].trim(), h.slice(0, h.length - m[1].length).replace(/[、：:．.\s　]+$/, '').replace(/\s+/g, '')); return false; } return true; });
  // 每頁重複出現的短頁首／頁尾（出現 3 次以上，而且不是條文或標題格式）
  const cnt = new Map(); for (const l of lines) { const t = l.trim(); if (t && t.length <= 30) cnt.set(t, (cnt.get(t) || 0) + 1); }
  const pages = Math.max(1, (String(text).match(/\f/g) || []).length);
  const header = new Set([...cnt].filter(([t, n]) => n >= 3 && n >= pages * 0.5 && !RE_LIST.test(t) && !/^附\s*則$/.test(t)).map(([t]) => t));
  let firstHeader = '';
  lines = lines.filter(l => { const t = l.trim(); if (header.has(t)) { if (!firstHeader) firstHeader = t; return false; } return true; });
  if (!wrapped) {
    // Word 檔裡用 Enter 手動換行的句子（上一段寫到一半、有逗號、沒有句尾標點，下一段不是編號）接回同一段
    const out = [];
    for (const l of lines) { const t = l.trim(); const prev = out.length ? out[out.length - 1] : '';
      if (t && prev && [...prev].length >= 28 && /[，：]/.test(prev) && !END_PUNCT.test(prev) && !RE_LIST.test(t) && !RE_DOC_TITLE.test(t) && !RE_CHAPTER.test(t)) out[out.length - 1] = prev + t; else out.push(t); }
    return { lines: out, header: firstHeader, toc };
  }
  // PDF 斷行接回：上一行沒有句尾標點、下一行不是編號開頭，就接在一起
  // 一般行寬：只有「上一行寫滿」才視為斷行接續（標題、條名這種短行不接）
  const lens = lines.map(l => [...l.trim()].length).filter(n => n > 0).sort((x, y) => x - y);
  const full = lens.length ? lens[Math.floor(lens.length * 0.85)] : 0;
  const out = []; let lastLen = 0;
  for (const l of lines) {
    const t = l.trim();
    if (!t) { out.push(''); lastLen = 0; continue; }
    const prev = out.length ? out[out.length - 1] : '';
    if (prev && lastLen >= Math.max(12, full * 0.8) && !END_PUNCT.test(prev) && !RE_LIST.test(t) && !RE_DOC_TITLE.test(t)) out[out.length - 1] = prev + t;
    else out.push(t);
    lastLen = [...t].length;
  }
  return { lines: out, header: firstHeader, toc };
}

function parseBylaws(text, opts = {}) {
  const { lines, header, toc } = cleanLines(text, opts);
  // 第一輪：切成「區段」（章、辦法名稱），判斷每段有沒有「第○條」
  const items = []; let cur = null; let title = '';
  const push = it => { items.push(it); cur = it; return it; };
  const isHeading = t => RE_CHAPTER.test(t) || /^附\s*則/.test(t) || (RE_DOC_TITLE.test(t) && !RE_ARTICLE.test(t));
  // 每一區段是否用「第○條」
  const segUsesArticle = []; { let seg = 0, has = false; for (const t of lines) { if (!t) continue; if (isHeading(t)) { segUsesArticle[seg] = has; seg++; has = false; } else if (RE_ARTICLE.test(t)) has = true; } segUsesArticle[seg] = has; }
  let seg = 0;
  const looksTitle = r => r && r.length <= 40 && !END_PUNCT.test(r) && !/[，,。]/.test(r);
  for (const t of lines) {
    if (!t) { if (cur && cur.body && !cur.body.endsWith('\n')) cur.body += '\n'; continue; }
    let m;
    if ((m = t.match(RE_CHAPTER))) { seg++; push({ type: 'chapter', no: t.slice(0, t.length - m[1].length).replace(/[、：:．.\s　]+$/, '').replace(/\s+/g, ''), title: m[1].trim(), body: '' }); continue; }
    if ((m = t.match(/^附\s*則\s*[：:　\s]*(.*)$/))) { seg++; push({ type: 'chapter', no: '附則', title: '', body: '' }); if (m[1].trim()) push({ type: 'text', no: '', title: '', body: m[1].trim() }); continue; }
    if (RE_DOC_TITLE.test(t) && !RE_ARTICLE.test(t)) {
      seg++;
      if (!title && !items.some(i => i.type === 'article' || i.type === 'chapter')) { title = t; continue; }
      push({ type: 'chapter', no: toc.get(t) || '', title: t, body: '' }); continue;
    }
    if ((m = t.match(RE_SECTION))) { push({ type: 'text', no: '', title: '', body: t }); continue; }
    if ((m = t.match(RE_ARTICLE))) {
      let rest = m[2].trim(), ti = '';
      const tm = rest.match(/^[（(]([^）)]{1,30})[）)]\s*(.*)$/); if (tm) { ti = tm[1]; rest = tm[2]; }
      else if (looksTitle(rest)) { ti = rest; rest = ''; }
      push({ type: 'article', no: m[1].replace(/\s+/g, ''), title: ti, body: rest }); continue;
    }
    // 沒有「第○條」的辦法：「一、」當一條
    if (!segUsesArticle[seg] && (m = t.match(RE_POINT))) { push({ type: 'article', no: `${m[1]}、`, title: '', body: m[2].trim() }); continue; }
    if (cur?.type === 'article' && !cur.title && !cur.body && /^[（(][^）)]{1,30}[）)]$/.test(t)) { cur.title = t.slice(1, -1); continue; }
    if (!cur || cur.type === 'chapter') { push({ type: 'text', no: '', title: '', body: t }); continue; }
    cur.body = cur.body ? `${cur.body.replace(/\n+$/, '')}\n${t}` : t;
  }
  for (const it of items) {
    it.body = String(it.body || '').replace(/\n{3,}/g, '\n\n').trim();
    // 條名在內文第一行（例如「一、目的」「第十六條 債權行使：」）
    if (it.type === 'article' && !it.title && it.body.includes('\n')) { const [first, ...rest] = it.body.split('\n'); const f = first.trim().replace(/[：:]$/, ''); if (f && f.length <= 24 && !/[，,。；;]/.test(f) && (f === '附則' || !RE_LIST.test(f))) { it.title = f; it.body = rest.join('\n').trim(); } }
  }
  // 相鄰的說明文字合併成一段
  const merged = [];
  for (const it of items) { const prev = merged[merged.length - 1]; if (it.type === 'text' && prev?.type === 'text') prev.body += `\n${it.body}`; else if (it.type !== 'text' || it.body) merged.push(it); }
  return { title: title || header, items: merged };
}

// ---------- 從規約找出管理委員會組成（職務、人數、任期） ----------
function cnToNum(t) {
  t = String(t || '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/兩/g, '二').replace(/壹/g, '一').replace(/貳/g, '二').replace(/參/g, '三').replace(/拾/g, '十');
  if (/^\d+$/.test(t)) return Number(t);
  const D = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let n = 0, cur = 0;
  for (const c of t) { if (c in D) cur = D[c]; else if (c === '十') { n += (cur || 1) * 10; cur = 0; } else if (c === '百') { n += (cur || 1) * 100; cur = 0; } else return NaN; }
  return n + cur;
}
const ROLE_SKIP = new Set(['管理委員', '候補委員', '委員會', '各委員', '其餘委員', '其他委員', '前項委員', '該委員', '本屆委員']);
function committeeFromBylaws(items) {
  const NUM = '[一二兩三四五六七八九十〇零壹貳參\\d０-９]+';
  const roleRe = new RegExp(`([\\u4e00-\\u9fa5]{0,6}委員)\\s*(${NUM})\\s*[名人位]`, 'g');
  const totalRes = [new RegExp(`(?:共|計|合計|總計)\\s*(?:選出|選任|設|置)?\\s*(${NUM})\\s*[名人位]\\s*(?:管理)?委員`), new RegExp(`(?:管理)?委員\\s*(?:共|計|合計|總計)\\s*(${NUM})\\s*[名人位]`), new RegExp(`選出\\s*(${NUM})\\s*[名人位]\\s*(?:管理)?委員`)];
  const arts = (items || []).filter(i => i.type === 'article' || i.type === 'text');
  let best = null;
  for (const a of arts) {
    const text = `${a.title || ''}\n${a.body || ''}`; if (!/委員/.test(text)) continue;
    const roles = []; let m; roleRe.lastIndex = 0;
    while ((m = roleRe.exec(text))) {
      const raw = m[1]; const KNOWN = ['副主任委員', '主任委員', '監察委員', '財務委員', '候補委員', '管理委員'];
      let role = KNOWN.find(k => raw.endsWith(k)) || (raw === '委員' || /[設置及與和為、]委員$/.test(raw) || raw.length < 4 ? '委員' : raw.slice(-4));
      const n = cnToNum(m[2]); if (!role || !n || n > 50) continue;
      if (ROLE_SKIP.has(role)) continue;
      if (role.length < 2) continue;
      const hit = roles.find(r => r.role === role); if (hit) continue; roles.push({ role, count: n });
    }
    let total = null; for (const re of totalRes) { const t = text.match(re); if (t) { total = cnToNum(t[1]); break; } }
    const score = roles.filter(r => r.role !== '委員').length * 2 + (total ? 1 : 0);
    if (score >= 3 && (!best || score > best.score)) best = { score, roles, total, no: a.no, title: a.title, excerpt: text.slice(0, 600) };
  }
  // 任期：「每年5月1日起至翌年4月30日止」
  let term = null;
  for (const a of arts) {
    const t = `${a.body || ''}`.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    const m = t.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*日\s*起\s*至\s*(?:翌|次)年\s*(?:度)?\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*日/);
    if (m && /任期/.test(t)) { term = { from: [cnToNum(m[1]), cnToNum(m[2])], to: [cnToNum(m[3]), cnToNum(m[4])], no: a.no, text: m[0] }; break; }
  }
  if (!best && !term) return null;
  const roles = best ? best.roles : [];
  const named = roles.filter(r => r.role !== '委員').reduce((x, r) => x + r.count, 0);
  const generic = roles.find(r => r.role === '委員')?.count || 0;
  const total = best?.total || (named + generic) || null;
  const extra = total && total > named + generic ? total - named - generic : 0;
  return { roles: roles.filter(r => r.role !== '委員'), generic: generic + extra, total, source: best ? { no: best.no, title: best.title, excerpt: best.excerpt } : null, term };
}

module.exports = { parseBylaws, docxText, cleanLines, fmtNum, cnCount, cnToNum, committeeFromBylaws };
