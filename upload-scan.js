// 上傳檔案安全檢查（防木馬、巨集病毒、偽裝檔案）：所有上傳在存檔後、交給功能使用前先檢查，不合格的立即刪除並拒絕。
// 檢查項目：
//   1. 執行檔與腳本：exe、bat、ps1、vbs、js、msi、scr、lnk、apk…（看副檔名，也看檔案內容的「MZ／ELF／#!」開頭）
//   2. 含巨集的 Office 檔：docm、xlsm、pptm，以及偽裝成 docx/xlsx/doc/xls 但內含 VBA 巨集的檔案
//   3. 偽裝副檔名：例如 .pdf 其實不是 PDF、.jpg 其實是執行檔
//   4. 會自動執行程式的 PDF（/Launch、開啟時自動執行的 JavaScript）
//   5. 壓縮檔內含執行檔、或加密無法檢查的壓縮檔
//   6. 含程式碼的 SVG／HTML（可用來竊取登入狀態）
//   7. EICAR 防毒測試碼（可用來測試這個機制是否運作）
//   8. （選用）VirusTotal 病毒資料庫比對：設定 VIRUSTOTAL_API_KEY 後，以檔案指紋查詢 70 多家防毒引擎的結果（不上傳檔案內容）
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const DANGER_EXT = new Set(('exe dll com bat cmd ps1 psm1 vbs vbe js jse mjs wsf wsh msi msp mst scr pif cpl hta jar class lnk reg app apk ipa deb rpm dmg pkg iso img vhd vhdx ' +
  'docm dotm xlsm xltm xlam xlsb pptm potm ppam ppsm sldm chm url scf inf gadget msc ade adp sct shb sys drv ocx ws ' +
  'html htm xhtml shtml mht mhtml php asp aspx jsp cgi pl py rb sh bash zsh command').split(' '));
const OFFICE_ZIP = new Set(['docx', 'xlsx', 'pptx', 'dotx', 'xltx', 'potx', 'ppsx', 'odt', 'ods', 'odp']);
const OLE_EXT = new Set(['doc', 'xls', 'ppt', 'dot', 'xlt', 'pot', 'pps', 'msg']);
const SIG = {
  pdf: b => b.subarray(0, 1024).includes('%PDF-'),
  png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: b => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')),
  webp: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  bmp: b => b.subarray(0, 2).toString('latin1') === 'BM',
  heic: b => b.subarray(4, 8).toString('latin1') === 'ftyp', heif: b => b.subarray(4, 8).toString('latin1') === 'ftyp',
  zip: b => b[0] === 0x50 && b[1] === 0x4b,
};
const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
const isOle = b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const isExecutable = b => (b[0] === 0x4d && b[1] === 0x5a) || b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0) || (b[0] === 0x23 && b[1] === 0x21);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const extOf = n => (String(n || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

// ZIP 目錄：列出檔名、是否加密
function zipEntries(b) {
  let eocd = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10); let off = b.readUInt32LE(eocd + 16); const out = [];
  if (off === 0xffffffff) return null; // zip64：交給其他檢查
  for (let i = 0; i < count && off + 46 <= b.length; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const flags = b.readUInt16LE(off + 8), nl = b.readUInt16LE(off + 28), el = b.readUInt16LE(off + 30), cl = b.readUInt16LE(off + 32);
    out.push({ name: b.subarray(off + 46, off + 46 + nl).toString('utf8'), encrypted: !!(flags & 1) }); off += 46 + nl + el + cl;
  }
  return out;
}
const UTF16 = s => Buffer.from(s, 'utf16le');

function inspect(buf, name) {
  const ext = extOf(name);
  if (buf.includes(EICAR)) return '偵測到病毒測試碼（EICAR）';
  if (DANGER_EXT.has(ext)) return ['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xlsb', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm'].includes(ext) ? '含巨集的 Office 檔案不能上傳，請另存成 docx／xlsx／pptx 或 PDF' : `不允許上傳 .${ext} 檔案（可能是程式或網頁）`;
  if (isExecutable(buf)) return '檔案內容是程式（執行檔或腳本），不能上傳';
  const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif'];
  // 圖片：手機有時會把 HEIC 存成 .jpg，只要內容是任一種圖片就接受
  if (IMG.includes(ext) && !IMG.some(k => SIG[k](buf))) return `檔案內容不是圖片（副檔名可能被改過）`;
  if (ext === 'pdf' && !SIG.pdf(buf)) return '檔案內容不是真正的 PDF（副檔名可能被改過）';
  if (OFFICE_ZIP.has(ext) && !isZip(buf)) return `檔案內容不是真正的 .${ext}（副檔名可能被改過）`;
  if (OLE_EXT.has(ext) && !isOle(buf) && !isZip(buf)) return `檔案內容不是真正的 .${ext}（副檔名可能被改過）`;
  if (isOle(buf) && (buf.includes(UTF16('_VBA_PROJECT')) || buf.includes(UTF16('VBA')) && buf.includes(UTF16('PROJECT')) && buf.includes('Attribute VB_'))) return '檔案含有巨集（VBA），可能有病毒風險。請另存成不含巨集的格式或 PDF 後再上傳';
  if (isZip(buf)) {
    const list = zipEntries(buf);
    if (list) {
      if (list.some(e => e.encrypted)) return '有密碼保護的壓縮檔無法檢查內容，請解壓縮後上傳';
      const bad = list.find(e => /(^|\/)vbaProject\.bin$/i.test(e.name)); if (bad) return '檔案含有巨集（VBA），可能有病毒風險。請另存成不含巨集的格式或 PDF 後再上傳';
      const exe = list.find(e => DANGER_EXT.has(extOf(e.name)) && !/\.(xml|rels)$/i.test(e.name)); if (exe) return `壓縮檔裡有不允許的檔案：${path.basename(exe.name)}`;
      if (list.some(e => /\.(zip|rar|7z)$/i.test(e.name)) && ext === 'zip') return '壓縮檔裡又包著壓縮檔，請解開後再上傳';
    }
  }
  if (ext === 'pdf' || SIG.pdf(buf)) {
    const s = buf.toString('latin1');
    if (/\/Launch\b/.test(s)) return 'PDF 含有「開啟時執行外部程式」的指令，可能有病毒風險';
    if (/\/(JavaScript|JS)\b/.test(s) && /\/(OpenAction|AA)\b/.test(s)) return 'PDF 含有「開啟時自動執行」的程式碼，可能有病毒風險。請用「列印成 PDF」另存後再上傳';
    if (/\/EmbeddedFile\b/.test(s) && /\.(exe|bat|cmd|js|vbs|scr|ps1|msi)\b/i.test(s)) return 'PDF 裡夾帶了程式檔案，可能有病毒風險';
  }
  if (ext === 'svg' || /^\s*<\?xml[^>]*>\s*<svg|^\s*<svg/i.test(buf.subarray(0, 512).toString('utf8'))) {
    const s = buf.toString('utf8'); if (/<script|javascript:|\son[a-z]+\s*=|<foreignObject|<iframe|<embed|<object/i.test(s)) return 'SVG 圖檔裡含有程式碼，不能上傳';
  }
  return '';
}

function vtLookup(sha, key) {
  return new Promise(resolve => {
    const req = https.request({ host: 'www.virustotal.com', path: `/api/v3/files/${sha}`, headers: { 'x-apikey': key }, timeout: 4000 }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => { if (res.statusCode !== 200) return resolve(null); try { const s = JSON.parse(Buffer.concat(c).toString()).data.attributes.last_analysis_stats; resolve(s); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null)); req.end();
  });
}

module.exports = function createUploadScan() {
  const stats = { checked: 0, blocked: 0, recent: [] };
  const vtKey = process.env.VIRUSTOTAL_API_KEY || '';
  async function checkFile(f) {
    let buf; try { buf = f.buffer || fs.readFileSync(f.path); } catch { return ''; }
    stats.checked++;
    let why = inspect(buf, f.originalname);
    if (!why && vtKey) { const s = await vtLookup(crypto.createHash('sha256').update(buf).digest('hex'), vtKey); if (s && (s.malicious || 0) >= 2) why = `防毒資料庫判定為惡意檔案（${s.malicious} 家防毒引擎）`; }
    if (why) { stats.blocked++; stats.recent.unshift({ at: new Date().toISOString(), name: String(f.originalname || '').slice(0, 80), why }); stats.recent.length = Math.min(stats.recent.length, 20); console.warn(`[上傳檢查] 已攔下 ${f.originalname}：${why}`); }
    return why;
  }
  // 包裝 multer：上傳完成後檢查每個檔案，不合格就刪除並回覆錯誤
  function wrapInstance(inst) {
    for (const m of ['single', 'array', 'fields', 'any']) {
      if (typeof inst[m] !== 'function') continue; const orig = inst[m].bind(inst);
      inst[m] = (...args) => { const mw = orig(...args); return (req, res, next) => mw(req, res, async err => {
        if (err) return next(err);
        const files = [].concat(req.file ? [req.file] : [], Array.isArray(req.files) ? req.files : req.files && typeof req.files === 'object' ? Object.values(req.files).flat() : []);
        if (!files.length) return next();
        let why = ''; try { for (const f of files) { why = await checkFile(f); if (why) break; } } catch { why = ''; }
        if (!why) return next();
        for (const f of files) if (f.path) try { fs.unlinkSync(f.path); } catch {}
        req.file = undefined; req.files = undefined;
        res.status(400).json({ error: `檔案未通過安全檢查：${why}。` });
      }); };
    }
    return inst;
  }
  return { wrapInstance, inspect, checkFile, status: () => ({ checked: stats.checked, blocked: stats.blocked, recent: stats.recent, virustotal: !!vtKey }) };
};
module.exports.inspect = inspect;
