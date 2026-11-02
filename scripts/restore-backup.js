#!/usr/bin/env node
// 還原加密備份：node scripts/restore-backup.js <備份檔 hesi-xxxx.tar.gz.enc> <要解開到的資料夾>
// 需要和備份時相同的 DATA_ENCRYPTION_KEY（環境變數）。解開後把資料夾內容放回主機的 /data 即可。
'use strict';
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const crypto = require('crypto');
const { MAGIC, backupKey } = require('../backup');
const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) { console.error('用法：DATA_ENCRYPTION_KEY=... node scripts/restore-backup.js <備份檔> <輸出資料夾>'); process.exit(1); }
const key = backupKey(); if (!key) { console.error('請先設定 DATA_ENCRYPTION_KEY（備份時使用的那一組）'); process.exit(1); }
const buf = fs.readFileSync(src);
if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) { console.error('這不是本系統的備份檔'); process.exit(1); }
const iv = buf.subarray(MAGIC.length, MAGIC.length + 12), tag = buf.subarray(buf.length - 16), ct = buf.subarray(MAGIC.length + 12, buf.length - 16);
let tar; try { const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); tar = zlib.gunzipSync(Buffer.concat([d.update(ct), d.final()])); }
catch { console.error('解密失敗：金鑰不對，或檔案已損壞'); process.exit(1); }
const root = path.resolve(outDir); let n = 0;
for (let o = 0; o + 512 <= tar.length;) {
  const h = tar.subarray(o, o + 512); if (h.every(b => b === 0)) break;
  const str = (a, l) => h.subarray(a, a + l).toString('utf8').replace(/\0.*$/s, '');
  const name = (str(345, 155) ? str(345, 155) + '/' : '') + str(0, 100); const size = parseInt(str(124, 12).trim(), 8) || 0;
  const f = path.resolve(root, name); if (!f.startsWith(root + path.sep)) throw new Error('備份檔內容不正確');
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, tar.subarray(o + 512, o + 512 + size)); n++;
  o += 512 + Math.ceil(size / 512) * 512;
}
console.log(`已還原 ${n} 個檔案到 ${root}`);
