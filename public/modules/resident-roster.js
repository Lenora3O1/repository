// 住戶名冊（智慧版）：住戶聯繫表／區分所有權人／承租人
// 三份格式相同；所有權人可過戶、承租人可登錄租約（到期提醒、續約、退租）；
// 住戶聯繫表可上傳更新，也可以由所有權人＋承租人資料自動更新。
(function(){
  const labels={'residents-contact':'住戶聯繫表','residents-owners':'區分所有權人','residents-tenants':'承租人'};
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function num(v){const m=String(v??'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):Infinity;}
  function sortRows(rows,sort){const copy=[...rows];copy.sort((a,b)=>{const seq=sort==='floor'?['floor','building','unit']:sort==='unit'?['unit','building','floor']:['building','unit','floor'];for(const k of seq){const an=num(a[k]),bn=num(b[k]);if(an!==Infinity||bn!==Infinity){if(an!==bn)return an-bn;}const c=String(a[k]||'').localeCompare(String(b[k]||''),'zh-Hant',{numeric:true});if(c)return c;}return String(a.name||'').localeCompare(String(b.name||''),'zh-Hant');});return copy;}
  const SOURCE={import:['📤','上傳'],'import-edited':['✏️','上傳後修改'],manual:['✏️','手動'],'sync-owner':['🏠','所有權人'],'sync-tenant':['🔑','承租人']};
  const LEASE={active:['有效','ok'],expiring:['30 天內到期','warn'],expired:['已到期','bad'],upcoming:['尚未起租','info'],ended:['已退租','off']};
  const S={action:'',label:'',category:'',d:null,filter:{q:'',building:'',lease:''}};

  function injectStyle(){
    if(document.getElementById('residentStyleV2'))return;
    const s=document.createElement('style');s.id='residentStyleV2';
    s.textContent=`
.resident-toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 18px;margin:18px 0 14px}
.resident-toolbar>label{display:flex;flex-direction:column;gap:6px;font-weight:700;flex:0 1 260px;min-width:200px;margin:0}
.resident-toolbar>label select{width:100%;margin:0}
.resident-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.resident-actions button,.resident-actions a{margin:0;padding:10px 16px;min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;text-decoration:none;font-weight:700;border-radius:8px}
.resident-actions a{border:1px solid #b8d2c5;background:#fff;color:#14563f}
.resident-searchbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:10px 0 12px;padding:12px;border:1px solid #dbe8e2;border-radius:12px;background:#f7fbf9}
.resident-searchbar label{display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0}
.resident-searchbar input,.resident-searchbar select{min-width:170px;padding:9px 11px;border:1px solid #cbd8d2;border-radius:8px;background:#fff;font:inherit;margin:0}
.resident-searchbar input[type=search]{min-width:260px}
.resident-search-count{margin-left:auto;font-weight:700;color:#245b48}
.resident-meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:4px 0 12px;color:#4f5f59;font-size:.9rem}
.resident-table-wrap{overflow:auto;border:1px solid #e1e9e5;border-radius:12px}
.resident-table{width:100%;border-collapse:collapse;min-width:760px}
.resident-table th{background:#f1f7f3;text-align:left;padding:9px 10px;font-size:.85rem;white-space:nowrap;position:sticky;top:0}
.resident-module .resident-table{min-width:760px;table-layout:auto}
.resident-table td{padding:8px 10px;border-top:1px solid #eef2f0;vertical-align:top;white-space:nowrap}
.resident-table td.wrap{white-space:normal;min-width:160px;max-width:320px}
.resident-table tr.is-ended td{color:#8a958f;background:#fafbfa}
.resident-table td.r-act{white-space:nowrap;text-align:right}
.resident-table td.r-act button{padding:5px 10px;min-height:0;font-size:.82rem;margin-left:4px}
.r-tag{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.75rem;font-weight:700;white-space:nowrap;background:#eef3f0;color:#3f5a4e}
.r-tag.ok{background:#e3f2e9;color:#1f6b43}.r-tag.warn{background:#fff3e0;color:#a35a00}.r-tag.bad{background:#fdecec;color:#b3261e}.r-tag.info{background:#e6f2fb;color:#1e5f8c}.r-tag.off{background:#f0f0ee;color:#777}
.r-sync{border:1px solid #cfe3d8;background:linear-gradient(180deg,#f4fbf7,#fff);border-radius:14px;padding:14px 16px;margin:6px 0 14px;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center}
.r-sync b{color:#1f6b43}.r-sync .r-sync-text{flex:1;min-width:260px;line-height:1.7}
.r-sync label{display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:700;font-size:.9rem}
.r-sync label input{width:auto;margin:0}
.r-sync button{padding:10px 16px;min-height:0;margin:0}
.r-alert{border-radius:12px;padding:10px 14px;margin:6px 0 12px;font-weight:700}
.r-alert.warn{background:#fff7e5;border:1px solid #efd99c;color:#7a5200}.r-alert.bad{background:#fdecec;border:1px solid #f2c4c0;color:#8c1d16}
.r-chips{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px}
.r-chips button{padding:6px 12px;min-height:0;font-size:.85rem;border-radius:999px}
.r-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.r-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.88rem;margin:0}
.r-form input,.r-form textarea{margin:0;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd8d2;border-radius:8px;background:#fff;font:inherit}
.r-form input:focus,.r-form textarea:focus{outline:2px solid rgba(46,107,79,.25);border-color:#2E6B4F}
.r-form .wide{grid-column:1/-1}
.r-form .r-owner-hint{grid-column:1/-1;background:#f4f9f6;border-radius:10px;padding:8px 12px;font-size:.88rem;color:#2f5546}
.r-hist{max-height:60vh;overflow:auto}
.r-hist li{display:grid;grid-template-columns:110px 110px minmax(0,1fr);gap:10px;padding:8px 0;border-bottom:1px dashed #e1e9e5;font-size:.9rem}
.r-hist ul{list-style:none;margin:0;padding:0}
.r-diff td{padding:6px 8px;border-top:1px solid #eef2f0;font-size:.88rem}.r-diff th{text-align:left;padding:6px 8px;background:#f4f8f6;font-size:.82rem}
.r-diff del{color:#b3261e}.r-diff ins{color:#1f6b43;text-decoration:none;font-weight:700}
@media(max-width:700px){.resident-toolbar>label{flex:1 1 100%}.resident-searchbar input[type=search]{min-width:0;width:100%}.resident-searchbar label{flex:1 1 100%}.r-form{grid-template-columns:1fr}.r-hist li{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }
  function modal(title,body,{wide=false}={}){
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="${wide?'max-width:860px;width:min(860px,96vw);':''}max-height:90vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button><h2>${title}</h2>${body}</div>`;
    document.body.appendChild(box);document.body.classList.add('modal-open');
    const close=()=>{box.remove();document.body.classList.remove('modal-open');};
    box.querySelector('.modal-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    return {box,close};
  }
  async function reload(){await render(S.action,S.label);}
  function synced(n){return n?`\n住戶聯繫表已自動更新 ${n} 戶。`:'';}

  // ---------- 表格 ----------
  function rowsFiltered(){
    const d=S.d,f=S.filter,q=f.q.trim().toLowerCase();
    return sortRows(d.records||[],d.preference?.sort||'building').filter(r=>{
      if(S.category==='residents-tenants'){if(f.lease){if(r.lease_state!==f.lease)return false;}else if(r.lease_state==='ended')return false;}
      if(f.building&&String(r.building||'')!==f.building)return false;
      if(!q)return true;return [r.building,r.unit,r.floor,r.name,r.phone,r.address,r.extra,r.lease_start,r.lease_end].some(v=>String(v??'').toLowerCase().includes(q));
    });
  }
  function table(rows){
    const d=S.d,edit=!!d.viewer?.can_edit,cat=S.category;
    if(!rows.length)return `<div class="empty">${(d.records||[]).length?'沒有符合條件的資料。':`目前還沒有${labels[cat]}資料。${edit?'可以上傳 Excel，或按「＋ 新增」逐筆建立。':''}`}</div>`;
    const lease=cat==='residents-tenants',src=cat==='residents-contact';
    return `<div class="resident-table-wrap"><table class="resident-table"><thead><tr><th>棟別</th><th>戶號</th><th>樓層</th><th>姓名</th><th>電話</th>${lease?'<th>租約期間</th><th>狀態</th>':''}<th>門牌／地址</th><th>其他資料</th>${src?'<th>來源</th>':''}${edit?'<th></th>':''}</tr></thead><tbody>${rows.map(r=>{
      const st=LEASE[r.lease_state]||LEASE.active;const so=SOURCE[r.source]||SOURCE.import;
      const acts=!edit?'':cat==='residents-owners'?`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="secondary" data-transfer="${r.id}">過戶</button><button type="button" class="danger" data-del="${r.id}">刪除</button>`
        :cat==='residents-tenants'?(r.lease_state==='ended'?`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="danger" data-del="${r.id}">刪除</button>`:`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="secondary" data-renew="${r.id}">續約</button><button type="button" class="secondary" data-end="${r.id}">退租</button>`)
        :`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="danger" data-del="${r.id}">刪除</button>`;
      return `<tr class="${r.lease_state==='ended'?'is-ended':''}"><td>${esc(r.building)}</td><td>${esc(r.unit)}</td><td>${esc(r.floor)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.phone)}</td>${lease?`<td style="white-space:nowrap">${esc(r.lease_start||'—')}<br>～ ${esc(r.lease_end||'—')}</td><td><span class="r-tag ${st[1]}">${st[0]}</span></td>`:''}<td class="wrap">${esc(r.address)}</td><td class="wrap">${esc(r.extra||'')}</td>${src?`<td><span class="r-tag" title="${esc(r.updated_by?`${r.updated_by} 更新`:'')}">${so[0]} ${so[1]}</span></td>`:''}${edit?`<td class="r-act">${acts}</td>`:''}</tr>`;}).join('')}</tbody></table></div>`;
  }
  function drawTable(){
    const rows=rowsFiltered();const el=document.getElementById('residentTable');if(el)el.innerHTML=table(rows);
    const cnt=document.getElementById('residentSearchCount');if(cnt)cnt.textContent=rows.length===(S.d.records||[]).length?`共 ${rows.length} 筆`:`符合條件 ${rows.length} 筆 / 共 ${(S.d.records||[]).length} 筆`;
    el?.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(find(b.dataset.edit))));
    el?.querySelectorAll('[data-renew]').forEach(b=>b.addEventListener('click',()=>openForm(find(b.dataset.renew),{renew:true})));
    el?.querySelectorAll('[data-transfer]').forEach(b=>b.addEventListener('click',()=>openTransfer(find(b.dataset.transfer))));
    el?.querySelectorAll('[data-end]').forEach(b=>b.addEventListener('click',()=>openEnd(find(b.dataset.end))));
    el?.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>remove(find(b.dataset.del))));
  }
  const find=id=>(S.d.records||[]).find(r=>String(r.id)===String(id));

  // ---------- 表單 ----------
  function unitsDatalist(){return `<datalist id="residentUnits">${(S.d.units||[]).map(u=>`<option value="${esc(u.unit)}">${esc([u.building,u.owner?`所有權人 ${u.owner}`:''].filter(Boolean).join('｜'))}</option>`).join('')}</datalist>`;}
  function openForm(rec,{renew=false}={}){
    const cat=S.category,isNew=!rec,r=rec||{};const lease=cat==='residents-tenants';
    const title=isNew?(lease?'🔑 登錄租約（新增承租人）':cat==='residents-owners'?'🏠 新增區分所有權人':'＋ 新增聯繫人'):renew?'🔁 續約':'✏️ 修改資料';
    const {box,close}=modal(title,`<form class="r-form" id="rForm">
      <label>棟別<input name="building" value="${esc(r.building)}" placeholder="例如 A"></label>
      <label>戶號 *<input name="unit" value="${esc(r.unit)}" list="residentUnits" placeholder="例如 5F-1"></label>${unitsDatalist()}
      <label>樓層<input name="floor" value="${esc(r.floor)}"></label>
      <label>姓名 *<input name="name" value="${esc(r.name)}"></label>
      <label>電話<input name="phone" value="${esc(r.phone)}" inputmode="tel"></label>
      <label>門牌／地址<input name="address" value="${esc(r.address)}"></label>
      ${lease?`<div class="r-owner-hint" id="rOwnerHint" ${S.d.units?.length?'':'hidden'}></div><label>起租日<input type="date" name="lease_start" value="${esc(r.lease_start)}"></label><label>租約到期日<input type="date" name="lease_end" value="${esc(r.lease_end)}"></label>`:''}
      <label class="wide">其他資料<textarea name="extra" rows="2">${esc(r.extra)}</textarea></label>
      <div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">💾 儲存</button></div></form>`);
    const f=box.querySelector('#rForm');
    const hint=()=>{const h=box.querySelector('#rOwnerHint');if(!h)return;const u=(S.d.units||[]).find(x=>String(x.unit).trim()===f.unit.value.trim()&&(!f.building.value.trim()||String(x.building).trim()===f.building.value.trim()));h.hidden=!u;if(u)h.innerHTML=`🏠 這一戶的所有權人：<b>${esc(u.owner||'（尚未登錄）')}</b>${u.owner_phone?` ${esc(u.owner_phone)}`:''}`;};
    // 選了戶號就自動帶入棟別、樓層、門牌
    f.unit.addEventListener('change',()=>{const u=(S.d.units||[]).find(x=>String(x.unit).trim()===f.unit.value.trim());if(u){if(!f.building.value)f.building.value=u.building||'';if(!f.floor.value)f.floor.value=u.floor||'';if(!f.address.value)f.address.value=u.address||'';}hint();});
    f.building.addEventListener('change',hint);hint();
    if(renew&&f.lease_end){f.lease_end.focus();if(r.lease_end){const d=new Date(`${r.lease_end}T00:00:00`);d.setFullYear(d.getFullYear()+1);f.lease_end.value=d.toISOString().slice(0,10);}}else f.unit.focus();
    box.querySelector('[data-cancel]').onclick=close;
    f.addEventListener('submit',async e=>{e.preventDefault();const record=Object.fromEntries(new FormData(f).entries());if(!record.unit.trim()||!record.name.trim()){alert('請填寫戶號與姓名');return;}
      try{const res=isNew?await api('/api/staff/residents/records',J('POST',{category:cat,record})):await api(`/api/staff/residents/records/${r.id}`,J('PUT',{category:cat,record}));close();if(res.synced)alert(`已儲存。${synced(res.synced)}`);await reload();}catch(err){alert(err.message);}});
  }
  function openTransfer(r){
    const {box,close}=modal('🏠 過戶（更換所有權人）',`<p class="hint">${esc([r.building,r.unit].filter(Boolean).join(' '))}　原所有權人：<b>${esc(r.name)}</b> ${esc(r.phone||'')}</p><form class="r-form" id="rForm"><label>新所有權人 *<input name="name" required></label><label>電話<input name="phone" inputmode="tel"></label><label>過戶日期<input type="date" name="date" value="${new Date().toISOString().slice(0,10)}"></label><label class="wide">其他資料<textarea name="extra" rows="2">${esc(r.extra||'')}</textarea></label><div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">確認過戶</button></div></form><p class="hint">原所有權人會保留在「異動紀錄」中。${S.d.settings?.auto_sync?'住戶聯繫表會自動更新這一戶。':''}</p>`);
    box.querySelector('[data-cancel]').onclick=close;box.querySelector('[name=name]').focus();
    box.querySelector('#rForm').addEventListener('submit',async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target).entries());try{const res=await api(`/api/staff/residents/records/${r.id}`,J('PUT',{category:S.category,record:{name:v.name,phone:v.phone,extra:v.extra},transfer:true,transfer_date:v.date}));close();alert(`已完成過戶。${synced(res.synced)}`);await reload();}catch(err){alert(err.message);}});
  }
  function openEnd(r){
    const {box,close}=modal('🚪 退租',`<p>${esc([r.building,r.unit].filter(Boolean).join(' '))}　承租人 <b>${esc(r.name)}</b>（租約 ${esc(r.lease_start||'—')}～${esc(r.lease_end||'—')}）</p><form class="r-form" id="rForm"><label>退租日期<input type="date" name="date" value="${new Date().toISOString().slice(0,10)}"></label><div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit" class="danger">確認退租</button></div></form><p class="hint">退租後資料會保留在「已退租」，不會刪除。${S.d.settings?.auto_sync?'住戶聯繫表會自動改回所有權人。':''}</p>`);
    box.querySelector('[data-cancel]').onclick=close;
    box.querySelector('#rForm').addEventListener('submit',async e=>{e.preventDefault();try{const res=await api(`/api/staff/residents/records/${r.id}`,J('PUT',{category:S.category,record:{},status:'ended',end_date:e.target.date.value}));close();alert(`已辦理退租。${synced(res.synced)}`);await reload();}catch(err){alert(err.message);}});
  }
  async function remove(r){
    if(!confirm(`確定刪除「${[r.building,r.unit].filter(Boolean).join(' ')} ${r.name}」嗎？${S.category==='residents-owners'?'\n（如果是買賣房屋，請改用「過戶」，才會留下紀錄）':''}`))return;
    try{const res=await api(`/api/staff/residents/records/${r.id}?category=${encodeURIComponent(S.category)}`,{method:'DELETE'});if(res.synced)alert(`已刪除。${synced(res.synced)}`);await reload();}catch(err){alert(err.message);}
  }
  async function openHistory(){
    const d=await api(`/api/staff/residents/history?category=${encodeURIComponent(S.category)}`);
    const t=v=>{const x=new Date(v);return Number.isNaN(x.getTime())?'':x.toLocaleString('zh-TW',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
    modal(`📜 ${labels[S.category]}｜異動紀錄`,`<div class="r-hist">${(d.rows||[]).length?`<ul>${d.rows.map(r=>`<li><span class="muted">${esc(t(r.at))}<br>${esc(r.by_name||'')}</span><b>${esc(r.unit_label||'—')}</b><span>${esc(r.summary)}</span></li>`).join('')}</ul>`:'<p class="hint">目前沒有異動紀錄。</p>'}</div>`,{wide:true});
  }
  async function openSync(){
    const p=await api('/api/staff/residents/sync-preview?category=residents-contact');
    const n=p.add.length+p.update.length;
    const rowsHtml=[...p.update.map(u=>`<tr><td>${esc([u.after.building,u.after.unit].filter(Boolean).join(' '))}</td><td><del>${esc(u.before.name||'—')} ${esc(u.before.phone||'')}</del><br><ins>${esc(u.after.name||'—')} ${esc(u.after.phone||'')}</ins></td><td>${esc(u.after.extra)}</td><td>更新</td></tr>`),...p.add.map(a=>`<tr><td>${esc([a.building,a.unit].filter(Boolean).join(' '))}</td><td><ins>${esc(a.name||'—')} ${esc(a.phone||'')}</ins></td><td>${esc(a.extra)}</td><td>新增</td></tr>`)].join('');
    const {box,close}=modal('🔄 從區分所有權人／承租人更新住戶聯繫表',`<p>比對 ${p.units} 戶的所有權人與有效租約：${n?`有 <b>${p.update.length}</b> 戶需要更新、<b>${p.add.length}</b> 戶聯繫表還沒有`:'聯繫表已經是最新的'}${p.unchanged?`，${p.unchanged} 戶不用改`:''}。</p><p class="hint">規則：有有效租約的戶別，聯繫人用承租人；沒有就用所有權人。其他沒登錄的戶別維持上傳檔的內容。</p>${n?`<div class="resident-table-wrap" style="max-height:50vh"><table class="r-diff" style="width:100%"><thead><tr><th>戶別</th><th>聯繫人</th><th>備註</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`:''}<div class="modal-actions"><button type="button" class="secondary" data-cancel>${n?'取消':'關閉'}</button>${n&&S.d.viewer?.can_edit?`<button type="button" id="rSyncGo">✅ 更新 ${n} 戶</button>`:''}</div>`,{wide:true});
    box.querySelector('[data-cancel]').onclick=close;
    box.querySelector('#rSyncGo')?.addEventListener('click',async()=>{try{const r=await api('/api/staff/residents/sync',J('POST',{category:'residents-contact'}));close();alert(`住戶聯繫表已更新 ${r.synced} 戶。`);await reload();}catch(err){alert(err.message);}});
  }

  // ---------- 頁面 ----------
  async function loadTemplate(){try{const d=await api('/api/staff/platform-resources?category='+encodeURIComponent('住戶名冊'));return (d.platformResources||[])[0]||null;}catch{return null;}}
  async function render(action,label){
    injectStyle();
    const el=document.getElementById('staffHome');if(!el)throw new Error('找不到工作區');
    const category=labels[action]?action:'residents-contact';
    if(S.category!==category)S.filter={q:'',building:'',lease:''};
    S.action=action;S.label=label;S.category=category;
    const d=await api(`/api/staff/residents?category=${encodeURIComponent(category)}`);S.d=d;
    const sort=d.preference?.sort||'building',edit=!!d.viewer?.can_edit,canUpload=!!d.viewer?.can_upload,c=d.community||{};
    const buildings=[...new Set((d.records||[]).map(r=>String(r.building||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant',{numeric:true}));
    const template=category==='residents-contact'?await loadTemplate():null;
    const intro={'residents-contact':'社區住戶的聯繫窗口。可以定期上傳 Excel 更新，也可以由「區分所有權人」與「承租人」的資料自動更新。','residents-owners':'各戶的區分所有權人。房屋買賣請用「過戶」，舊所有權人會留在異動紀錄；異動後住戶聯繫表會自動跟著更新。','residents-tenants':'登錄各戶的租約。系統會提醒即將到期或已到期的租約；有效租約的戶別，住戶聯繫表會以承租人為聯繫人。'}[category];
    let banner='';
    if(category==='residents-contact'&&d.sync){const s=d.sync;banner=`<div class="r-sync"><div class="r-sync-text">🔄 <b>智慧同步</b>：區分所有權人 ${s.owners} 筆、有效租約 ${s.tenants} 筆。${s.pending?`目前有 <b>${s.pending}</b> 戶的聯繫人和最新資料不同（更新 ${s.update}、新增 ${s.add}）。`:s.units?'聯繫表已和所有權人／承租人資料一致。':'還沒有登錄所有權人或承租人，請先到「區分所有權人」「承租人」建立資料。'}</div>${edit?`<label title="所有權人或承租人有異動時，自動更新聯繫表對應的戶別"><input type="checkbox" id="rAuto" ${d.settings?.auto_sync?'checked':''}> 異動時自動更新</label>`:''}<button type="button" id="rSync" ${s.units?'':'disabled'}>${s.pending?`預覽並更新 ${s.pending} 戶`:'查看比對結果'}</button></div>`;}
    if(category==='residents-tenants'&&d.lease_summary){const L=d.lease_summary;banner=(L.expired?`<div class="r-alert bad">⚠ 有 ${L.expired} 筆租約已經到期，請確認是續約還是退租。</div>`:'')+(L.expiring?`<div class="r-alert warn">⏰ 有 ${L.expiring} 筆租約將在 30 天內到期。</div>`:'')+`<div class="r-chips">${[['','目前租約',(L.active||0)+(L.expiring||0)+(L.expired||0)+(L.upcoming||0)],['expiring','30 天內到期',L.expiring||0],['expired','已到期',L.expired||0],['upcoming','尚未起租',L.upcoming||0],['ended','已退租',L.ended||0]].map(([k,t,n])=>`<button type="button" class="${S.filter.lease===k?'':'secondary'}" data-lease="${k}">${t}（${n}）</button>`).join('')}</div>`;}
    el.innerHTML=`<div class="panel resident-module"><div class="eyebrow">🏠 住戶名冊</div><h1>${esc(label||labels[category])}</h1><p>目前案場：<strong>${esc(c.name||'尚未選擇案場')}</strong>。${intro}</p>
      <div class="resident-toolbar"><label>排序方式<select id="residentSort"><option value="building" ${sort==='building'?'selected':''}>棟別 → 戶號</option><option value="unit" ${sort==='unit'?'selected':''}>戶號 → 棟別</option><option value="floor" ${sort==='floor'?'selected':''}>樓層 → 棟別 → 戶號</option></select></label>
      <div class="resident-actions">${edit?`<button type="button" id="rAdd">${category==='residents-tenants'?'🔑 登錄租約':'＋ 新增'}</button>`:''}${canUpload?`<button type="button" class="secondary" id="residentUploadBtn">📤 上傳 Excel 更新</button><input id="residentFile" type="file" accept=".xlsx,.xls,.csv,.txt" hidden>`:''}${template?`<a href="/api/staff/platform-resources/${Number(template.id)}/download" target="_blank" rel="noopener">📥 上傳範本</a>`:''}<button type="button" class="secondary" id="rHist">📜 異動紀錄</button></div></div>
      ${banner}
      <div class="resident-searchbar"><label>🔎 搜尋<input id="residentSearch" type="search" value="${esc(S.filter.q)}" placeholder="姓名、戶號、電話、門牌、備註"></label><label>🏢 棟別<select id="residentBuilding"><option value="">全部棟別</option>${buildings.map(b=>`<option value="${esc(b)}" ${S.filter.building===b?'selected':''}>${esc(b)}</option>`).join('')}</select></label><button type="button" class="secondary" id="residentClear" style="padding:9px 13px;min-height:0">清除</button><span class="resident-search-count" id="residentSearchCount"></span></div>
      <div class="resident-meta"><span>資料共 ${(d.records||[]).length} 筆</span>${d.last_import?`<span>最近整批更新：${esc(d.last_import.original_filename||'')}${d.last_import.imported_by_name?`（${esc(d.last_import.imported_by_name)}）`:''}</span>`:''}${!edit?'<span>僅供查詢，修改請洽經理或秘書</span>':''}</div>
      <div id="residentTable"></div></div>`;
    drawTable();
    const $=id=>document.getElementById(id);
    $('residentSort')?.addEventListener('change',async e=>{try{await api('/api/staff/residents/preference',J('PUT',{category,sort:e.target.value}));await reload();}catch(err){alert(err.message)}});
    $('residentSearch')?.addEventListener('input',e=>{S.filter.q=e.target.value;drawTable();});
    $('residentBuilding')?.addEventListener('change',e=>{S.filter.building=e.target.value;drawTable();});
    $('residentClear')?.addEventListener('click',()=>{S.filter.q='';S.filter.building='';$('residentSearch').value='';$('residentBuilding').value='';drawTable();});
    el.querySelectorAll('[data-lease]').forEach(b=>b.addEventListener('click',()=>{S.filter.lease=b.dataset.lease;el.querySelectorAll('[data-lease]').forEach(x=>x.className=x===b?'':'secondary');drawTable();}));
    $('rAdd')?.addEventListener('click',()=>openForm(null));
    $('rHist')?.addEventListener('click',()=>openHistory().catch(err=>alert(err.message)));
    $('rSync')?.addEventListener('click',()=>openSync().catch(err=>alert(err.message)));
    $('rAuto')?.addEventListener('change',async e=>{try{await api('/api/staff/residents/settings',J('PUT',{category:'residents-contact',auto_sync:e.target.checked}));}catch(err){alert(err.message);e.target.checked=!e.target.checked;}});
    $('residentUploadBtn')?.addEventListener('click',()=>$('residentFile').click());
    $('residentFile')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;
      if((d.records||[]).length&&!confirm(`上傳「${file.name}」會取代目前的 ${(d.records||[]).length} 筆${labels[category]}資料（舊資料仍可在異動紀錄查到上傳時間）。確定嗎？`)){e.target.value='';return;}
      const btn=$('residentUploadBtn');btn.disabled=true;btn.textContent='匯入中…';
      try{const fd=new FormData();fd.append('file',file);fd.append('category',category);const r=await api('/api/staff/residents/import',{method:'POST',body:fd});alert(`✅ ${r.message||'匯入完成'}\n自動辨識欄位：${(r.detected_fields||[]).join('、')||'未辨識'}`);await reload();}
      catch(err){alert(err.message||'匯入失敗')}finally{btn.disabled=false;btn.textContent='📤 上傳 Excel 更新';e.target.value='';}});
  }
  window.ResidentRosterModule={render};
})();
