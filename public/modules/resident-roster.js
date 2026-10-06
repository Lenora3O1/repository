(function(){
  const labels={
    'residents-contact':'住戶聯繫表',
    'residents-owners':'區分所有權人',
    'residents-tenants':'承租人'
  };
  const esc=v=>window.escapeHtml?window.escapeHtml(v==null?'':String(v)):String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const api=window.staffApi||async function(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;};
  function fileAccept(){return '.xlsx,.xls,.csv,.txt';}
  function sortLabel(k){return {building:'棟別 → 戶號',unit:'戶號 → 棟別',floor:'樓層 → 棟別 → 戶號'}[k]||'棟別 → 戶號';}
  function num(v){const m=String(v??'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):Infinity;}
  function renderRows(rows,sort){
    const copy=[...rows];
    copy.sort((a,b)=>{
      const key=sort||'building';
      const seq=key==='floor'?['floor','building','unit']:key==='unit'?['unit','building','floor']:['building','unit','floor'];
      for(const k of seq){const an=num(a[k]),bn=num(b[k]); if(an!==Infinity||bn!==Infinity){if(an!==bn)return an-bn;} const as=String(a[k]||''),bs=String(b[k]||''); const c=as.localeCompare(bs,'zh-Hant',{numeric:true});if(c)return c;}
      return String(a.name||'').localeCompare(String(b.name||''),'zh-Hant');
    });
    return copy;
  }
  function table(rows){
    if(!rows.length)return '<div class="empty">目前尚無資料。請先上傳原有住戶資料。</div>';
    return `<div class="resident-table-wrap"><table class="resident-table"><thead><tr><th>棟別</th><th>戶號</th><th>樓層</th><th>姓名</th><th>電話</th><th>門牌／地址</th><th>其他資料</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.building)}</td><td>${esc(r.unit)}</td><td>${esc(r.floor)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.phone)}</td><td>${esc(r.address)}</td><td>${esc(r.extra||'')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function render(action,label){
    const el=document.getElementById('staffHome');if(!el)throw new Error('找不到工作區');
    const category=labels[action]?action:'residents-contact';
    const d=await api(`/api/staff/residents?category=${encodeURIComponent(category)}`);
    const sort=d.preference?.sort||'building';
    const rows=renderRows(d.records||[],sort);
    const canUpload=!!d.viewer?.can_upload;
    const assignment=d.community||{};
    el.innerHTML=`<div class="panel resident-module"><div class="eyebrow">🏠 住戶名冊</div><h1>${esc(label||labels[category])}</h1><p>目前案場：<strong>${esc(assignment.name||'尚未選擇案場')}</strong>。可直接上傳既有 Excel／CSV 資料，系統會自動辨識棟別、戶號、樓層、姓名等欄位，再依您的排序習慣整理。</p>
      <div class="resident-toolbar"><label>排序方式<select id="residentSort"><option value="building" ${sort==='building'?'selected':''}>棟別 → 戶號</option><option value="unit" ${sort==='unit'?'selected':''}>戶號 → 棟別</option><option value="floor" ${sort==='floor'?'selected':''}>樓層 → 棟別 → 戶號</option></select></label>${canUpload?`<label class="resident-upload"><span>📤 上傳原有資料</span><input id="residentFile" type="file" accept="${fileAccept()}" hidden><button type="button" id="residentUploadBtn">選擇檔案</button></label>`:''}</div>
      <div class="resident-meta"><span>共 ${rows.length} 筆</span>${d.last_import?`<span>最近匯入：${esc(d.last_import.original_filename||'')}</span>`:''}</div>
      <div id="residentTable">${table(rows)}</div></div>`;
    const sortEl=document.getElementById('residentSort');sortEl?.addEventListener('change',async()=>{try{await api('/api/staff/residents/preference',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,sort:sortEl.value})});await render(action,label)}catch(e){alert(e.message)}});
    document.getElementById('residentUploadBtn')?.addEventListener('click',()=>document.getElementById('residentFile').click());
    document.getElementById('residentFile')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const btn=document.getElementById('residentUploadBtn');btn.disabled=true;btn.textContent='匯入中…';try{const fd=new FormData();fd.append('file',file);fd.append('category',category);const r=await api('/api/staff/residents/import',{method:'POST',body:fd});alert(`✅ ${r.message||'匯入完成'}\n自動辨識欄位：${(r.detected_fields||[]).join('、')||'未辨識'}\n共 ${r.imported||0} 筆`);await render(action,label)}catch(err){alert(err.message||'匯入失敗')}finally{btn.disabled=false;btn.textContent='選擇檔案';e.target.value='';}});
  }
  window.ResidentRosterModule={render};
})();
