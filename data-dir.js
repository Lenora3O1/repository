'use strict';
// 資料夾位置（SQLite 資料庫、上傳檔案、備份都放這裡）
// - 正式環境請設定環境變數 DATA_DIR，並掛上「持久磁碟」（Render：Disk 掛在 /data；Zeabur：Volume 掛在 /data）
// - 設定的資料夾無法寫入時預設停止啟動（保護正式資料）；測試環境設 ALLOW_EPHEMERAL_DATA=1 才改用程式目錄下的 data/，
//   這種情況重新部署或重開機後資料會消失。
const fs = require('fs');
const path = require('path');

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

let DATA_DIR = process.env.DATA_DIR || __dirname;
let ephemeral = false;
if (!writable(DATA_DIR)) {
  // 預設直接停止啟動：正式環境如果磁碟沒掛上，寧可網站打不開，也不要開出一個空的資料庫讓大家以為資料不見、
  // 或在暫存區輸入新資料後又消失。只有測試環境明確設定 ALLOW_EPHEMERAL_DATA=1 才改用暫存資料夾。
  if (process.env.ALLOW_EPHEMERAL_DATA !== '1') {
    console.error(`[資料夾] DATA_DIR=${DATA_DIR} 無法寫入（沒有掛上持久磁碟，或權限不足），系統停止啟動以保護資料。`);
    console.error('[資料夾] 正式環境：請在主機加上持久磁碟並掛在這個路徑（Render → Disks，Mount Path 填 /data）。');
    console.error('[資料夾] 只是測試（資料可以消失）：設定環境變數 ALLOW_EPHEMERAL_DATA=1。');
    process.exit(1);
  }
  const fallback = path.join(__dirname, 'data');
  console.error('==================================================================');
  console.error(`[資料夾] DATA_DIR=${DATA_DIR} 無法寫入（沒有掛上持久磁碟，或權限不足）。`);
  console.error(`[資料夾] 暫時改用 ${fallback}。注意：重新部署或重開機後，資料庫與上傳檔案都會消失！`);
  console.error('[資料夾] 正式上線請在主機加上持久磁碟（Render → Disks，Mount Path 填 /data）。');
  console.error('==================================================================');
  DATA_DIR = fallback; ephemeral = true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
module.exports = { DATA_DIR, ephemeral };
