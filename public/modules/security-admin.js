// 系統總後台：資安狀態（環境變數、個資加密、兩步驟驗證、備份、上傳檔案檢查、被鎖住的公司負責人）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const ok=(b,y='✓ 已完成',n='✗ 尚未完成')=>b?`<span style="color:#2F6B3A;font-weight:700">${y}</span>`:`<span style="color:#A52828;font-weight:700">${n}</span>`;
  const row=(name,state,note)=>`<tr><td style="font-weight:700">${name}</td><td>${state}</td><td style="color:#7A5F58;font-size:.88rem">${note||''}</td></tr>`;
  const tw=s=>s?new Date(s).toLocaleString('zh-TW',{hour12:false}):'—';
  // 在瀏覽器產生隨機金鑰（不經過伺服器）
  function genKey(){const a=new Uint8Array(36);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/[+/=]/g,c=>({'+':'K','/':'Q','=':''}[c]));}
  async function render(el){
    el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
    let d;try{d=await api('/api/admin/security');}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;return;}
    const fc=d.field_crypto||{},bk=d.backup,us=d.upload_scan;
    el.innerHTML=`<div class="panel"><h2>🛡️ 資安狀態</h2><p class="hint">這裡列出系統的資安設定是否完成。「✗」的項目請依說明到主機（Render／Zeabur）的環境變數設定，存檔後重新部署。</p>
      <div class="table-wrap"><table style="min-width:0"><thead><tr><th>項目</th><th>狀態</th><th>說明</th></tr></thead><tbody>
      ${row('總後台密碼 ADMIN_PASS',ok(d.admin_pass_set&&d.admin_pass_ok),'至少 10 個字元，不可用預設值')}
      ${row('登入金鑰 SESSION_SECRET',ok(d.session_secret_set),'32 個字元以上的亂碼；沒設定時每次部署後大家要重新登入')}
      ${row('個資欄位加密 DATA_ENCRYPTION_KEY',fc.key_set?(fc.key_ok?ok(true,`✓ 已加密 ${fc.encrypted} 筆`):ok(false,'','✗ 金鑰不符')):ok(false,'','✗ 尚未設定'),fc.key_set?(fc.plain?`還有 ${fc.plain} 筆未加密（重新部署後會自動加密）`:'身分證、銀行帳號、手機、地址、緊急聯絡人、住戶名冊、面試履歷、薪資明細'):'設定後，下次部署會自動把既有個資加密')}
      ${row('兩步驟驗證（總後台）',ok(d.admin_2fa?.enabled,`✓ 已設定（備用碼剩 ${d.admin_2fa?.recovery_left} 組）`,d.twofa_required?'✗ 下次登入設定':'— 測試環境未強制'),'公司管理員、老闆、會計登入內勤後台也需要')}
      ${row('異地加密備份',bk?(bk.configured?ok(!bk.last_error,`✓ 最近一次：${tw(bk.last_ok_at)}`,`✗ 失敗：${esc(bk.last_error)}`):ok(false,'','✗ 尚未設定')):'—',bk?.configured?`每天 ${bk.hour}:00 自動備份到 ${esc(bk.target||'')}，保留 ${bk.keep_days} 天`:'需要設定異地儲存空間（BACKUP_S3_* 環境變數，說明見 SECURITY.md）')}
      ${row('上傳檔案檢查',us?ok(true,`✓ 啟用中（已檢查 ${us.checked} 個，攔下 ${us.blocked} 個）`):'—',us?.virustotal?'另外比對 VirusTotal 病毒資料庫（只送檔案指紋，不送檔案內容）':'擋下執行檔、含巨集的 Office 檔、含程式的 PDF、偽裝副檔名')}
      </tbody></table></div>
      ${bk?.key_set?`<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="secondary" id="secBackup">立即備份一次</button><span class="hint" id="secBkMsg">${bk.last_file?`最近的備份檔：${esc(bk.last_file)}（${(bk.last_size/1048576).toFixed(1)} MB）${bk.last_remote?'，已上傳異地':''}`:''}</span></div>`:''}
      ${d.locked_owners?.length?`<h3 style="margin-top:18px">🔒 被鎖住的公司負責人</h3><p class="hint">請確認是本人後，到「總覽與公司管理」按「重設負責人密碼」（會一併解鎖）。</p><ul>${d.locked_owners.map(u=>`<li>${esc(u.tenant_name)}｜${esc(u.name)}（${esc(u.employee_id)}）</li>`).join('')}</ul>`:''}
      <h3 style="margin-top:18px">🔑 產生金鑰</h3><p class="hint">在您的瀏覽器裡產生一組隨機金鑰（不會傳到伺服器）。用於 DATA_ENCRYPTION_KEY 或 SESSION_SECRET。<b>DATA_ENCRYPTION_KEY 一旦開始使用就不能更換，遺失就無法還原個資，請抄在紙上由負責人保管。</b></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" id="secGen">產生一組</button><code id="secKey" style="display:none;font-size:1rem;background:#F3ECE6;padding:8px 10px;border-radius:8px;word-break:break-all"></code><button type="button" class="secondary" id="secCopy" style="display:none">複製</button></div>
    </div>`;
    el.querySelector('#secBackup')?.addEventListener('click',async e=>{e.target.disabled=true;el.querySelector('#secBkMsg').textContent='備份中，資料多時需要幾分鐘…';try{await api('/api/admin/backup/run',{method:'POST'});render(el);}catch(err){el.querySelector('#secBkMsg').textContent=err.message;e.target.disabled=false;}});
    el.querySelector('#secGen').onclick=()=>{el.querySelector('#secKey').textContent=genKey();el.querySelector('#secKey').style.display='';el.querySelector('#secCopy').style.display='';};
    el.querySelector('#secCopy').onclick=async()=>{try{await navigator.clipboard.writeText(el.querySelector('#secKey').textContent);el.querySelector('#secCopy').textContent='✓ 已複製';}catch{}};
  }
  window.SecurityAdminModule={render};
})();
