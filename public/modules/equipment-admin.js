// 總後台：各公司設備管理設定（分類預設、借用流程、天數）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={tid:null};
  async function load(el){
    el.innerHTML='<div class="panel"><div class="profile-loading">正在讀取資料中，請稍候…</div></div>';
    try{S.list=await api('/api/admin/equip-settings');if(!S.tid)S.tid=S.list.tenants[0]?.id||null;await draw(el);}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;}
  }
  async function draw(el){
    if(!S.tid){el.innerHTML='<div class="panel"><div class="empty">還沒有公司。</div></div>';return;}
    const d=await api(`/api/admin/equip-settings/${S.tid}`);const c=d.settings;
    const row='display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.88rem;margin:0';
    const inp='margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit';
    el.innerHTML=`<div class="panel"><div class="eyebrow">🧰 平台設定</div><h1>設備管理（各公司客製化）</h1>
      <p class="hint">設定各公司的設備分類預設、借用流程與天數。公司總務也可以在「設備清冊 → 分類設定」自行調整分類。</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0"><b>公司</b><select id="eaT" style="width:auto;margin:0">${S.list.tenants.map(t=>`<option value="${t.id}" ${t.id===S.tid?'selected':''}>${esc(t.name)}（${esc(t.code)}）${t.customized?' ✎':''}</option>`).join('')}</select>
        <small class="muted">${d.customized?`已客製化，最後更新 ${esc((d.updated_at||'').slice(0,16).replace('T',' '))}（${esc(d.updated_by)}）`:'目前使用平台預設'}｜設備 ${d.stats.items} 筆、借用申請 ${d.stats.requests} 筆</small></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 18px;margin-top:8px">
        <label style="${row}">設備分類（一行一個）<textarea id="eaCats" rows="8" style="${inp}">${esc(c.categories.join('\n'))}</textarea></label>
        <div style="display:grid;gap:12px;align-content:start">
          <label style="${row};flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="eaSite" ${c.site_approval?'checked':''} style="width:auto;margin:0"> 借用要先經過案場主管同意，再送總務</label>
          <label style="${row};flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="eaCheck" ${c.return_check?'checked':''} style="width:auto;margin:0"> 歸還後要由總務點收才歸檔</label>
          <label style="${row}">每次最多借用天數<input type="number" id="eaMax" min="1" max="365" value="${c.max_days}" style="${inp}"></label>
          <label style="${row}">可以預約多少天內的日期<input type="number" id="eaHz" min="14" max="365" value="${c.horizon_days}" style="${inp}"></label>
        </div>
      </div>
      <div style="background:#F6ECE6;border:1px solid #E2D3CC;border-radius:12px;padding:10px 14px;margin:14px 0;font-size:.88rem;line-height:1.7">借用流程：現場人員申請 → ${c.site_approval?'案場主管（社區經理；沒有時為副理）同意 → ':''}總務核准 → 總務出借 → 申請人歸還 → ${c.return_check?'總務點收（損壞改維修中、遺失改遺失） → ':''}歸檔。申請人自己就是案場主管時，直接送總務。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="eaSave">💾 儲存這家公司設定</button>${d.customized?'<button type="button" class="secondary" id="eaReset">↩ 恢復平台預設</button>':''}<span id="eaMsg" class="muted" style="align-self:center"></span></div></div>`;
    el.querySelector('#eaT').addEventListener('change',e=>{S.tid=Number(e.target.value);draw(el).catch(x=>alert(x.message));});
    el.querySelector('#eaSave').addEventListener('click',async()=>{try{await api(`/api/admin/equip-settings/${S.tid}`,J('PUT',{categories:el.querySelector('#eaCats').value.split('\n').map(s=>s.trim()).filter(Boolean),site_approval:el.querySelector('#eaSite').checked,return_check:el.querySelector('#eaCheck').checked,max_days:Number(el.querySelector('#eaMax').value),horizon_days:Number(el.querySelector('#eaHz').value)}));S.list=await api('/api/admin/equip-settings');await draw(el);el.querySelector('#eaMsg').textContent='✅ 已儲存';}catch(e){alert(e.message);}});
    el.querySelector('#eaReset')?.addEventListener('click',async()=>{if(!confirm('恢復平台預設？'))return;try{await api(`/api/admin/equip-settings/${S.tid}`,{method:'DELETE'});S.list=await api('/api/admin/equip-settings');await draw(el);}catch(e){alert(e.message);}});
  }
  window.EquipmentAdminModule={load};
})();
