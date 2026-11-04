// 公司內勤：資安中心（老闆、總經理、公司管理員）：被鎖住的帳號、兩步驟驗證、敏感資料查看紀錄、資安事件
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',...o});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const post=u=>api(u,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const tw=s=>{if(!s)return '';const d=new Date(s);if(isNaN(d))return esc(s);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;};
  const EV={account_locked:'🔒 帳號上鎖',account_unlocked:'🔓 解鎖',['2fa_enabled']:'🔐 完成兩步驟設定',['2fa_reset']:'♻️ 重設兩步驟',['2fa_recovery_used']:'🧾 使用備用碼登入',['2fa_trust_device']:'💻 信任裝置',['2fa_untrust']:'🚫 取消信任裝置'};
  function css(){if(document.getElementById('secCss'))return;const s=document.createElement('style');s.id='secCss';s.textContent=`
  .sec-sec{border:1px solid #E8DCD5;border-radius:14px;padding:16px;margin:14px 0;background:#fff}.sec-sec h3{margin:0 0 4px;font-size:1.05rem}.sec-sec>p{margin:0 0 10px;color:#7A5F58;font-size:.9rem}
  .sec-t{width:100%;border-collapse:collapse;min-width:0!important;font-size:.92rem}.sec-t th,.sec-t td{padding:8px 10px;border-bottom:1px solid #F0E7E2;text-align:left;vertical-align:middle}.sec-t th{background:#F7F1EC;font-size:.82rem;color:#6E5650}
  .sec-ok{color:#2F6B3A;font-weight:700}.sec-no{color:#A52828;font-weight:700}.sec-muted{color:#8B7770;font-size:.85rem}
  .sec-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.sec-bar select{width:auto;min-width:120px}
  .sec-wrap{overflow:auto;max-height:520px}`;document.head.appendChild(s);}
  const S={category:'',days:30};
  async function render(el,label){
    css();
    const q=new URLSearchParams({days:S.days});if(S.category)q.set('category',S.category);
    const d=await api(`/api/company/security?${q}`);
    el.innerHTML=`<div class="eyebrow">🔐 資安</div><h1>${esc(label||'資安中心')}</h1>
      <p class="hint">保護公司與客戶資料：帳號連續輸錯密碼 5 次會自動上鎖；公司管理員、老闆、會計登入內勤後台需要手機兩步驟驗證；誰看過住戶名冊、薪資與人事資料都有紀錄。</p>
      <div class="sec-sec"><h3>🔒 被鎖住的帳號</h3><p>密碼連續錯 5 次的帳號。確認是本人後再解鎖；忘記密碼請到「人員管理」按「重設密碼」（會一併解鎖）。</p>
        ${d.locked.length?`<table class="sec-t"><thead><tr><th>員編</th><th>姓名</th><th>上鎖時間</th><th></th></tr></thead><tbody>${d.locked.map(u=>`<tr><td>${esc(u.employee_id)}</td><td>${esc(u.name)}</td><td>${tw(u.locked_at)}</td><td>${u.owner?'<span class="sec-muted">公司負責人請聯絡系統服務商重發密碼</span>':`<button type="button" data-unlock="${u.id}">🔓 解鎖</button>`}</td></tr>`).join('')}</tbody></table>`:'<div class="sec-ok">目前沒有被鎖住的帳號 ✓</div>'}</div>
      <div class="sec-sec"><h3>🔐 兩步驟驗證</h3><p>${d.required?'這些人登入內勤後台時，除了密碼還要輸入手機驗證 App 的 6 位數。第一次登入時系統會引導設定。':'（測試環境未強制；正式主機上會自動要求）'}登入時可勾選「信任這台裝置」，30 天內同一台電腦／手機不用再輸入驗證碼。換手機或手機遺失時可在這裡重設；電腦遺失或交接時可取消信任的裝置。</p>
        ${d.twofa.length?`<table class="sec-t"><thead><tr><th>員編</th><th>姓名</th><th>狀態</th><th>備用碼</th><th>信任的裝置</th><th></th></tr></thead><tbody>${d.twofa.map(u=>`<tr><td>${esc(u.employee_id)}</td><td>${esc(u.name)}</td><td>${u.enabled?'<span class="sec-ok">已設定</span>':'<span class="sec-no">尚未設定</span><br><span class="sec-muted">下次登入時設定</span>'}</td><td>${u.enabled?`剩 ${u.recovery_left} 組`:'—'}</td><td>${u.trusted?`${u.trusted} 台 <button type="button" class="secondary" data-untrust="${u.id}" data-name="${esc(u.name)}" style="padding:3px 8px;font-size:.8rem">取消</button>`:'<span class="sec-muted">—</span>'}</td><td>${u.enabled?(u.owner?'<span class="sec-muted">負責人請洽系統服務商重設</span>':`<button type="button" class="secondary" data-reset="${u.id}" data-name="${esc(u.name)}">重設</button>`):''}</td></tr>`).join('')}</tbody></table>`:'<div class="sec-muted">沒有需要兩步驟驗證的帳號</div>'}</div>
      <div class="sec-sec"><h3>👁 敏感資料查看紀錄</h3><p>誰在什麼時候看過或匯出住戶名冊、薪資、人事資料、面試者履歷（同一個人 10 分鐘內重複查看只記一次）。</p>
        <div class="sec-bar"><select id="secCat"><option value="">全部類別</option>${d.categories.map(c=>`<option ${S.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
        <select id="secDays">${[7,30,90,365].map(n=>`<option value="${n}" ${S.days===n?'selected':''}>最近 ${n} 天</option>`).join('')}</select><span class="sec-muted">共 ${d.logs.length} 筆${d.logs.length>=500?'（只顯示最近 500 筆）':''}</span></div>
        ${d.logs.length?`<div class="sec-wrap"><table class="sec-t"><thead><tr><th>時間</th><th>人員</th><th>類別</th><th>內容</th><th>IP</th></tr></thead><tbody>${d.logs.map(l=>`<tr><td>${tw(l.at)}</td><td>${esc(l.name)}<br><span class="sec-muted">${esc(l.employee_id)}</span></td><td>${esc(l.category)}</td><td>${esc(l.what)}</td><td class="sec-muted">${esc(l.ip)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="sec-muted">這段期間沒有紀錄</div>'}</div>
      <div class="sec-sec"><h3>📜 資安事件</h3><p>帳號上鎖、解鎖、兩步驟驗證設定與重設（最近 100 筆）。</p>
        ${d.events.length?`<div class="sec-wrap"><table class="sec-t"><thead><tr><th>時間</th><th>事件</th><th>說明</th></tr></thead><tbody>${d.events.map(e=>`<tr><td>${tw(e.created_at)}</td><td>${EV[e.action]||esc(e.action)}</td><td>${esc(e.detail)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="sec-muted">沒有紀錄</div>'}</div>`;
    const again=()=>render(el,label).catch(e=>alert(e.message));
    el.querySelector('#secCat').onchange=e=>{S.category=e.target.value;again();};
    el.querySelector('#secDays').onchange=e=>{S.days=Number(e.target.value);again();};
    el.querySelectorAll('[data-unlock]').forEach(b=>b.onclick=async()=>{if(!confirm('確認是本人後再解鎖。要解鎖這個帳號嗎？'))return;try{await post(`/api/company/staff/${b.dataset.unlock}/unlock`);again();}catch(e){alert(e.message);}});
    el.querySelectorAll('[data-untrust]').forEach(b=>b.onclick=async()=>{if(!confirm(`要取消「${b.dataset.name}」所有信任的裝置嗎？\n下次登入每台裝置都要重新輸入驗證碼。`))return;try{await post(`/api/company/security/untrust/${b.dataset.untrust}`);again();}catch(e){alert(e.message);}});
    el.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm(`要重設「${b.dataset.name}」的兩步驟驗證嗎？\n對方下次登入時要重新用手機掃描設定。`))return;try{await post(`/api/company/security/2fa-reset/${b.dataset.reset}`);again();}catch(e){alert(e.message);}});
  }
  window.SecurityCompanyModule={render};
})();
