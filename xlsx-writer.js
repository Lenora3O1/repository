// 產生 Excel（.xlsx）範本：標題列樣式、欄寬、凍結窗格、下拉選單、文字格式欄位（保留手機與帳號開頭的 0）。
// 不需額外套件（自行組 Office Open XML ＋ zip）。
'use strict';
const zlib = require('zlib');

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(files) {
  const parts = [], cd = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8'), raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), comp = zlib.deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, comp); cd.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cdb = Buffer.concat(cd); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// 樣式：0 一般、1 標題、2 必填標題、3 文字格式、4 說明粗體、5 換行文字、6 範例（灰色）
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="12"/><name val="Microsoft JhengHei"/></font><font><i/><sz val="11"/><color rgb="FF8B7770"/><name val="Microsoft JhengHei"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5F403B"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFA44528"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="49" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// sheet：{ name, rows:[[值…]], widths:[欄寬…], header:true（第一列是標題）, required:Set(欄號), textCols:true（全部欄位設成文字格式）, freeze:1, validations:[{ col, list:['男','女'] | ref:"'選項'!$A$2:$A$30", rows:1000, prompt }], rowStyles:{列號:樣式} }
function sheetXml(sh) {
  const n = Math.max(sh.widths?.length || 0, ...sh.rows.map(r => r.length));
  const cols = Array.from({ length: n }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${sh.widths?.[i] || 14}" customWidth="1"${sh.textCols ? ' style="3"' : ''}/>`).join('');
  const rows = sh.rows.map((r, ri) => {
    const st = c => ri === 0 && sh.header ? (sh.required?.has(c) ? 2 : 1) : (sh.rowStyles?.[ri] ?? (sh.textCols ? 3 : 0));
    const cells = r.map((v, ci) => v === '' || v === null || v === undefined ? (sh.textCols ? `<c r="${colName(ci)}${ri + 1}" s="${st(ci)}"/>` : '') :
      typeof v === 'number' ? `<c r="${colName(ci)}${ri + 1}" s="${st(ci)}"><v>${v}</v></c>` :
      `<c r="${colName(ci)}${ri + 1}" s="${st(ci)}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('');
    return `<row r="${ri + 1}"${ri === 0 && sh.header ? ' ht="36" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  const pane = sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const dv = (sh.validations || []).filter(v => v.list?.length || v.ref);
  const dvx = dv.length ? `<dataValidations count="${dv.length}">${dv.map(v => { const c = colName(v.col); const f = v.ref ? esc(v.ref) : `"${esc(v.list.join(','))}"`; return `<dataValidation type="list" allowBlank="1" showInputMessage="${v.prompt ? 1 : 0}" showErrorMessage="${v.strict ? 1 : 0}" errorStyle="warning"${v.prompt ? ` promptTitle="${esc(v.prompt[0])}" prompt="${esc(v.prompt[1])}"` : ''} sqref="${c}2:${c}${v.rows || 1000}"><formula1>${f}</formula1></dataValidation>`; }).join('')}</dataValidations>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pane}<sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${dvx}</worksheet>`;
}

function buildXlsx(sheets) {
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files);
}
module.exports = { buildXlsx, colName };
