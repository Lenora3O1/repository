(function(){
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function api(url,opt={}){return fetch(url,{credentials:'same-origin',...opt}).then(async r=>{let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'讀取公司公版失敗');return d;});}
  async function render(mode,label){
    const el=document.getElementById('staffHome'); if(!el)return;
    el.innerHTML=`<div class="panel workspace-loading"><div class="eyebrow">公司資源</div><h1>📦 ${esc(label||'公司資源')}</h1><p>正在讀取可提供給您的公版文件…</p></div>`;
    try{
      const d=await api('/api/staff/company-resources'); const rows=d.resources||[];
      const filtered=mode==='government'?rows.filter(x=>x.resource_type==='government'):mode==='company'?rows.filter(x=>x.resource_type==='company'):rows;
      const company=filtered.filter(x=>x.resource_type==='company'),gov=filtered.filter(x=>x.resource_type==='government');
      const card=r=>`<div class="resource-card"><div><strong>${esc(r.title)}</strong><div class="muted">${r.resource_type==='company'?'📣 公司公版':'🏛 '+esc(r.region)+' 公家單位公版'}${r.description?`｜${esc(r.description)}`:''}</div><small>${esc(r.original_filename||'')}</small></div><button type="button" class="secondary" data-resource-download="${r.id}">📥 開啟／下載</button></div>`;
      el.innerHTML=`<div class="panel"><div class="eyebrow">公司資源</div><h1>📦 ${esc(label||'公司資源')}</h1><p class="hint">公司內勤上傳的公司公版會提供給全公司現場人員；公家單位公版則依您目前派駐社區的縣市自動分流。${d.regions?.length?`目前您的適用區域：${esc(d.regions.join('、'))}`:''}</p></div>${(mode!=='government'&&company.length)?`<div class="panel"><div class="section-title">📣 文件公版</div>${company.map(card).join('')}</div>`:''}${(mode!=='company'&&gov.length)?`<div class="panel"><div class="section-title">🏛 公家單位公版</div>${gov.map(card).join('')}</div>`:''}${!filtered.length?'<div class="panel empty">目前沒有可提供給您的公版文件。</div>':''}`;
      el.querySelectorAll('[data-resource-download]').forEach(btn=>btn.addEventListener('click',()=>window.open(`/api/staff/company-resources/${btn.dataset.resourceDownload}/download`,'_blank')));
    }catch(e){el.innerHTML=`<div class="panel workspace-error"><div class="eyebrow">公司資源</div><h1>目前無法開啟</h1><p>${esc(e.message)}</p><button type="button" class="secondary" onclick="location.reload()">重新整理</button></div>`;}
  }
  window.CompanyResourcesModule={render};
})();
