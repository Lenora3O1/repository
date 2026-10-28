'use strict';
// 資料夾位置（SQLite 資料庫、上傳檔案、備份都放這裡）
// - 正式環境請設定環境變數 DATA_DIR，並掛上「持久磁碟」（Render：Disk 掛在 /data；Zeabur：Volume 掛在 /data）
// - 設定的資料夾無法寫入時（例如 Render 免費方案沒有掛磁碟卻設了 DATA_DIR=/data），改用程式目錄下的 data/，
//   讓網站先能開起來，並在記錄裡大聲提醒：這種情況重新部署或重開機後資料會消失。
const fs = require('fs');
const path = require('path');

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

let DATA_DIR = process.env.DATA_DIR || __dirname;
let ephemeral = false;
if (!writable(DATA_DIR)) {
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
