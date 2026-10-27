// 住戶名冊（智慧版）：住戶聯繫表／區分所有權人／承租人
// 三份格式相同；所有權人可過戶、承租人可登錄租約（到期提醒、續約、退租）；
// 住戶聯繫表可上傳更新，也可以由所有權人＋承租人資料自動更新。
(function(){
  const labels={'residents-contact':'住戶聯繫表','residents-owners':'區分所有權人','residents-tenants':'承租人'};
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function num(v){const m=String(v??'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):Infinity;}
  function sortRows(rows,sort){if(sort==='building'&&rows.some(r=>r.u))return [...rows].sort((a,b)=>(a.u?.sort??1e9)-(b.u?.sort??1e9)||String(a.unit||'').localeCompare(String(b.unit||''),'zh-Hant',{numeric:true}));const copy=[...rows];copy.sort((a,b)=>{const seq=sort==='floor'?['floor','building','unit']:sort==='unit'?['unit','building','floor']:['building','unit','floor'];for(const k of seq){const an=num(a[k]),bn=num(b[k]);if(an!==Infinity||bn!==Infinity){if(an!==bn)return an-bn;}const c=String(a[k]||'').localeCompare(String(b[k]||''),'zh-Hant',{numeric:true});if(c)return c;}return String(a.name||'').localeCompare(String(b.name||''),'zh-Hant');});return copy;}
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
.resident-actions a{border:1px solid #CDC1BD;background:#fff;color:#472823}
.resident-searchbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:10px 0 12px;padding:12px;border:1px solid #E6E0DD;border-radius:12px;background:#FBF9F7}
.resident-searchbar label{display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0}
.resident-searchbar input,.resident-searchbar select{min-width:170px;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit;margin:0}
.resident-searchbar input[type=search]{min-width:260px}
.resident-search-count{margin-left:auto;font-weight:700;color:#4F3430}
.resident-meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:4px 0 12px;color:#5F534F;font-size:.9rem}
.resident-table-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px}
.resident-table{width:100%;border-collapse:collapse;min-width:760px}
.resident-table th{background:#F6F4F2;text-align:left;padding:9px 10px;font-size:.85rem;white-space:nowrap;position:sticky;top:0}
.resident-module .resident-table{min-width:760px;table-layout:auto}
.resident-table td{padding:8px 10px;border-top:1px solid #F2EFEE;vertical-align:top;white-space:nowrap}
.resident-table td.wrap{white-space:normal;min-width:160px;max-width:320px}
.resident-table tr.is-ended td{color:#958D8A;background:#FBFAFA}
.resident-table td.r-act{white-space:nowrap;text-align:right}
.resident-table td.r-act button{padding:5px 10px;min-height:0;font-size:.82rem;margin-left:4px}
.r-tag{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.75rem;font-weight:700;white-space:nowrap;background:#F3EFEE;color:#5A463F}
.r-tag.ok{background:#E8EEDF;color:#3E5328}.r-tag.warn{background:#fff3e0;color:#a35a00}.r-tag.bad{background:#fdecec;color:#b3261e}.r-tag.info{background:#e6f2fb;color:#1e5f8c}.r-tag.off{background:#f0f0ee;color:#777}
.r-sync{border:1px solid #DFD6D3;background:linear-gradient(180deg,#FAF8F5,#fff);border-radius:14px;padding:14px 16px;margin:6px 0 14px;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center}
.r-sync b{color:#3E5328}.r-sync .r-sync-text{flex:1;min-width:260px;line-height:1.7}
.r-sync label{display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:700;font-size:.9rem}
.r-sync label input{width:auto;margin:0}
.r-sync button{padding:10px 16px;min-height:0;margin:0}
.r-alert{border-radius:12px;padding:10px 14px;margin:6px 0 12px;font-weight:700}
.r-alert.warn{background:#fff7e5;border:1px solid #efd99c;color:#7a5200}.r-alert.bad{background:#fdecec;border:1px solid #f2c4c0;color:#8c1d16}
.r-chips{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px}
.r-chips button{padding:6px 12px;min-height:0;font-size:.85rem;border-radius:999px}
.r-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.r-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.88rem;margin:0}
.r-form input,.r-form textarea{margin:0;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.r-form input:focus,.r-form textarea:focus{outline:2px solid rgba(93,64,60,.25);border-color:#5D403C}
.r-form .wide{grid-column:1/-1}
.r-form .r-owner-hint{grid-column:1/-1;background:#F9F7F4;border-radius:10px;padding:8px 12px;font-size:.88rem;color:#4F3835}
.r-hist{max-height:60vh;overflow:auto}
.r-hist li{display:grid;grid-template-columns:110px 110px minmax(0,1fr);gap:10px;padding:8px 0;border-bottom:1px dashed #E9E3E1;font-size:.9rem}
.r-hist ul{list-style:none;margin:0;padding:0}
.r-diff td{padding:6px 8px;border-top:1px solid #F2EFEE;font-size:.88rem}.r-diff th{text-align:left;padding:6px 8px;background:#F8F6F4;font-size:.82rem}
.r-code{font-size:1.02rem;letter-spacing:.02em}.r-zone{margin-top:3px;background:#F3E7E1!important;color:#7E331D!important}.r-park{display:inline-block;padding:1px 8px;margin:1px 0;border-radius:6px;background:#EEF2F7;color:#2F4A6B;font-size:.8rem;font-weight:700;white-space:nowrap}.r-plate{color:#6B5A55;font-size:.78rem}.r-park.m{background:#F1EEE6;color:#6B5A2E}
.r-zones{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.r-zones button{padding:5px 12px;min-height:0;border-radius:999px;font-size:.85rem}
.r-setup{border:1.5px dashed #D9C7C0;border-radius:14px;padding:14px 16px;margin:6px 0 14px;background:#FBF8F6;display:flex;gap:14px;align-items:center;flex-wrap:wrap}.r-setup div{flex:1;min-width:260px;line-height:1.7}
.r-pv-list{max-height:45vh;overflow:auto;border:1px solid #EFE7E3;border-radius:10px;padding:6px 10px;margin:8px 0;font-size:.88rem}.r-pv-list div{padding:4px 0;border-bottom:1px dashed #EFE7E3}
.r-diff del{color:#b3261e}.r-diff ins{color:#3E5328;text-decoration:none;font-weight:700}
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
      if(f.zone&&String(r.u?.zone||'')!==f.zone)return false;
      if(!q)return true;const qq=q.replace(/[\s-]/g,'');return [r.building,r.unit,r.floor,r.name,r.phone,r.address,r.extra,r.lease_start,r.lease_end,r.emergency_name,r.emergency_phone,...(r.u?.plates||[]),r.u?.short,r.u?.address,r.u?.building_name,...(r.u?.cars||[]),...(r.u?.motos||[])].some(v=>{const t=String(v??'').toLowerCase();return t.includes(q)||(qq&&t.replace(/[\s-]/g,'').includes(qq));});
    });
  }
  function table(rows){
    const d=S.d,edit=!!d.viewer?.can_edit,cat=S.category;
    if(!rows.length)return `<div class="empty">${(d.records||[]).length?'沒有符合條件的資料。':`目前還沒有${labels[cat]}資料。${edit?'可以上傳 Excel，或按「＋ 新增」逐筆建立。':''}`}</div>`;
    const lease=cat==='residents-tenants',contact=cat==='residents-contact',src=contact;
    const smart=!!d.layout?.configured;
    const park=r=>`<td>${(r.u?.cars||[]).map(c=>`<span class="r-park">${esc(c)}</span>`).join(' ')}${(r.u?.plates||[]).length?`<br><small class="r-plate">🚗 ${r.u.plates.map(esc).join('、')}</small>`:''}</td><td>${(r.u?.motos||[]).map(c=>`<span class="r-park m">${esc(c)}</span>`).join(' ')}</td>`;
    const emer=r=>`<td>${r.emergency_name||r.emergency_phone?`${esc(r.emergency_name||'')}${r.emergency_phone?`<br><small>${esc(r.emergency_phone)}</small>`:''}`:''}</td>`;
    const miss=r=>`<br><span class="r-tag bad" title="這筆資料的戶別不在社區戶別清單裡，請編輯修正">未對應</span>`;
    // 住戶聯繫表：櫃檯、保全聯繫用（棟別、樓層、戶號、姓名、電話、車位、緊急聯絡人）；門牌與其他資料放在所有權人、承租人
    const head=contact
      ?`<th>棟別</th><th>樓層</th><th>戶號</th><th>姓名</th><th>電話</th>${smart?'<th>汽車位</th><th>機車位</th>':''}<th>緊急聯絡人</th>`
      :`${smart?'<th>戶別</th><th>棟／位置</th><th>門牌</th>':'<th>棟別</th><th>戶號</th><th>樓層</th>'}<th>姓名</th><th>電話</th>${lease?'<th>租約期間</th><th>狀態</th>':''}${smart?'':'<th>門牌／地址</th>'}<th>其他資料（居住人、寵物等）</th>`;
    return `<div class="resident-table-wrap"><table class="resident-table"><thead><tr>${head}${src?'<th>來源</th>':''}${edit?'<th></th>':''}</tr></thead><tbody>${rows.map(r=>{
      const st=LEASE[r.lease_state]||LEASE.active;const so=SOURCE[r.source]||SOURCE.import;
      const acts=!edit?'':cat==='residents-owners'?`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="secondary" data-transfer="${r.id}">過戶</button><button type="button" class="danger" data-del="${r.id}">刪除</button>`
        :cat==='residents-tenants'?(r.lease_state==='ended'?`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="danger" data-del="${r.id}">刪除</button>`:`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="secondary" data-renew="${r.id}">續約</button><button type="button" class="secondary" data-end="${r.id}">退租</button>`)
        :`<button type="button" class="secondary" data-edit="${r.id}">編輯</button><button type="button" class="danger" data-del="${r.id}">刪除</button>`;
      let cells;
      if(contact){
        cells=smart&&r.u?`<td>${esc(r.u.building_name)}${r.u.zone?`<br><span class="r-tag r-zone">${esc(r.u.zone)}</span>`:''}</td><td>${esc(r.u.floor<0?`B${-r.u.floor}`:`${r.u.floor}F`)}</td><td><b class="r-code">${esc(r.u.code)}</b>${r.u.occupancy==='vacant'?'<br><span class="r-tag warn">未入住</span>':r.u.occupancy==='undelivered'?'<br><span class="r-tag bad">未交屋</span>':''}</td>`
          :`<td>${esc(r.building)}</td><td>${esc(r.floor)}</td><td><b>${esc(r.unit)}</b>${smart?miss(r):''}</td>`;
        cells+=`<td><strong>${esc(r.name)}</strong></td><td>${esc(r.phone)}</td>${smart?park(r):''}${emer(r)}`;
      }else{
        cells=(smart?(r.u?`<td><b class="r-code">${esc(r.u.code)}</b></td><td>${esc(r.u.building_name)}${r.u.zone?`<br><span class="r-tag r-zone">${esc(r.u.zone)}</span>`:''}</td><td title="${esc(r.u.address)}">${esc(r.u.short)}</td>`:`<td><b>${esc(r.unit)}</b>${miss(r)}</td><td>${esc(r.building)}</td><td class="wrap">${esc(r.address)}</td>`):`<td>${esc(r.building)}</td><td>${esc(r.unit)}</td><td>${esc(r.floor)}</td>`)
          +`<td><strong>${esc(r.name)}</strong></td><td>${esc(r.phone)}</td>${lease?`<td style="white-space:nowrap">${esc(r.lease_start||'—')}<br>～ ${esc(r.lease_end||'—')}</td><td><span class="r-tag ${st[1]}">${st[0]}</span></td>`:''}${smart?'':`<td class="wrap">${esc(r.address)}</td>`}<td class="wrap">${esc(r.extra||'')}</td>`;
      }
      return `<tr class="${r.lease_state==='ended'?'is-ended':''}">${cells}${src?`<td><span class="r-tag" title="${esc(r.updated_by?`${r.updated_by} 更新`:'')}">${so[0]} ${so[1]}</span></td>`:''}${edit?`<td class="r-act">${acts}</td>`:''}</tr>`;
    }).join('')}</tbody></table></div>`;
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
    const cat=S.category,isNew=!rec,r=rec||{};const lease=cat==='residents-tenants';const smart=!!S.d.layout?.configured;
    const title=isNew?(lease?'🔑 登錄租約（新增承租人）':cat==='residents-owners'?'🏠 新增區分所有權人':'＋ 新增聯繫人'):renew?'🔁 續約':'✏️ 修改資料';
    const {box,close}=modal(title,`<form class="r-form" id="rForm">
      ${smart?`<label>戶別 *<input name="unit" value="${esc(r.unit)}" list="residentCodes" placeholder="例如 2A1" autocomplete="off"></label><datalist id="residentCodes">${(S.d.layout.units||[]).map(u=>`<option value="${esc(u.code)}">${esc(`${u.building_name}｜${u.short}`)}</option>`).join('')}</datalist><div class="r-owner-hint" id="rUnitInfo" hidden></div>`:`<label>棟別<input name="building" value="${esc(r.building)}" placeholder="例如 A"></label>
      <label>戶號 *<input name="unit" value="${esc(r.unit)}" list="residentUnits" placeholder="例如 5F-1"></label>${unitsDatalist()}
      <label>樓層<input name="floor" value="${esc(r.floor)}"></label>`}
      <label>姓名 *<input name="name" value="${esc(r.name)}"></label>
      <label>電話<input name="phone" value="${esc(r.phone)}" inputmode="tel"></label>
      ${cat==='residents-contact'?`<label>緊急聯絡人<input name="emergency_name" value="${esc(r.emergency_name)}"></label><label>緊急聯絡電話<input name="emergency_phone" value="${esc(r.emergency_phone)}" inputmode="tel"></label>`:''}
      ${smart?`<label>汽車位<input name="p_cars" value="${esc((r.u?.cars||[]).join('、'))}" placeholder="例如 B1-313、B1-313-1"></label><label>機車位<input name="p_motos" value="${esc((r.u?.motos||[]).join('、'))}" placeholder="例如 143"></label><label>車牌<input name="p_plates" value="${esc((r.u?.plates||[]).join('、'))}" placeholder="例如 ABC-1234、123-XYZ"></label><label>戶況<select name="p_occ"><option value="" ${!r.u?.occupancy?'selected':''}>已入住</option><option value="vacant" ${r.u?.occupancy==='vacant'?'selected':''}>未入住（一覽表黃底）</option><option value="undelivered" ${r.u?.occupancy==='undelivered'?'selected':''}>未交屋（一覽表紅字）</option></select></label>`:`<label>門牌／地址<input name="address" value="${esc(r.address)}"></label>`}
      ${lease?`<div class="r-owner-hint" id="rOwnerHint" ${S.d.units?.length?'':'hidden'}></div><label>起租日<input type="date" name="lease_start" value="${esc(r.lease_start)}"></label><label>租約到期日<input type="date" name="lease_end" value="${esc(r.lease_end)}"></label>`:''}
      <label class="wide">${cat==='residents-contact'?'備註':'其他資料（居住人、寵物、備註等）'}<textarea name="extra" rows="${cat==='residents-contact'?2:3}">${esc(r.extra)}</textarea></label>
      <div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">💾 儲存</button></div></form>`);
    const f=box.querySelector('#rForm');
    const hint=()=>{if(smart){const ui=box.querySelector('#rUnitInfo');const code=f.unit.value.trim().toUpperCase();const x=(S.d.layout.units||[]).find(u=>u.code===code);if(ui){ui.hidden=!code;ui.innerHTML=x?`📍 ${esc(x.building_name)}｜${esc(x.short)}`:'⚠ 這個戶別不在社區戶別清單裡';}
        if(x&&isNew&&f.p_cars&&!f.p_cars.value){const rec2=(S.d.records||[]).find(y=>y.unit===x.code&&y.u);if(rec2){f.p_cars.value=(rec2.u.cars||[]).join('、');f.p_motos.value=(rec2.u.motos||[]).join('、');}}}
      const h=box.querySelector('#rOwnerHint');if(!h)return;const u=(S.d.units||[]).find(x=>String(x.unit).trim()===f.unit.value.trim()&&(!f.building||!f.building.value.trim()||String(x.building).trim()===f.building.value.trim()));h.hidden=!u;if(u)h.innerHTML=`🏠 這一戶的所有權人：<b>${esc(u.owner||'（尚未登錄）')}</b>${u.owner_phone?` ${esc(u.owner_phone)}`:''}`;};
    // 選了戶號就自動帶入棟別、樓層、門牌
    f.unit.addEventListener('change',()=>{const u=(S.d.units||[]).find(x=>String(x.unit).trim()===f.unit.value.trim());if(u&&!smart){if(!f.building.value)f.building.value=u.building||'';if(!f.floor.value)f.floor.value=u.floor||'';if(!f.address.value)f.address.value=u.address||'';}hint();});
    f.building?.addEventListener('change',hint);hint();
    if(renew&&f.lease_end){f.lease_end.focus();if(r.lease_end){const d=new Date(`${r.lease_end}T00:00:00`);d.setFullYear(d.getFullYear()+1);f.lease_end.value=d.toISOString().slice(0,10);}}else f.unit.focus();
    box.querySelector('[data-cancel]').onclick=close;
    f.addEventListener('submit',async e=>{e.preventDefault();const record=Object.fromEntries(new FormData(f).entries());if(!record.unit.trim()||!record.name.trim()){alert(smart?'請填寫戶別與姓名':'請填寫戶號與姓名');return;}
      let parking;if(smart){parking={cars:record.p_cars||'',motos:record.p_motos||'',plates:record.p_plates||'',occupancy:record.p_occ||''};delete record.p_cars;delete record.p_motos;delete record.p_plates;delete record.p_occ;record.unit=record.unit.trim().toUpperCase();}
      try{const res=isNew?await api('/api/staff/residents/records',J('POST',{category:cat,record,parking})):await api(`/api/staff/residents/records/${r.id}`,J('PUT',{category:cat,record,parking}));close();if(res.synced)alert(`已儲存。${synced(res.synced)}`);await reload();}catch(err){alert(err.message);}});
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

  // ---------- 防截圖模式 ----------
  // 網頁沒辦法百分之百阻止截圖或用手機翻拍；這裡做的是「讓截圖變難、而且截到的畫面看得出是誰」：
  // 畫面浮水印（姓名、員編、時間）、離開視窗就遮住、攔截列印鍵與列印／另存／複製、禁止選取與右鍵、
  // 回到畫面時重新確認權限（離職、停用、調離社區會立刻清空畫面）。
  let guard=null;
  function protectCss(){if(document.getElementById('residentProtectCss'))return;const s=document.createElement('style');s.id='residentProtectCss';s.textContent=`
.resident-module.r-protect{position:relative;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.resident-module.r-protect input,.resident-module.r-protect select,.resident-module.r-protect textarea{-webkit-user-select:text;user-select:text}
.r-wm{position:absolute;inset:0;pointer-events:none;z-index:5;background-repeat:repeat;opacity:1;border-radius:inherit}
.r-shield-cover{display:none;position:absolute;inset:0;z-index:6;background:rgba(251,249,247,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);align-items:center;justify-content:center;text-align:center;font-weight:700;color:#5D403C;border-radius:inherit;padding:20px}
.resident-module.r-shield .r-shield-cover{display:flex}
.resident-module.r-shield #residentTable{filter:blur(16px)}
.r-protect-tag{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;color:#3E5328;background:#EAF1E3;border-radius:999px;padding:3px 10px}
.r-notice{max-width:760px}.r-notice ol{line-height:1.8;padding-left:22px}.r-notice label{display:flex;gap:8px;align-items:center;font-weight:700;margin:12px 0}.r-notice label input{width:auto;margin:0}
@media print{.resident-module{display:none!important}body::after{content:'住戶名冊不提供列印。經理、秘書請使用「下載 Excel」。';display:block;padding:40px;font-size:18px}}
`;document.head.appendChild(s);}
  function wmUrl(text){const t=esc(text);const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="20" y="120" transform="rotate(-22 180 100)" font-family="sans-serif" font-size="15" font-weight="700" fill="rgba(93,64,60,0.13)">${t}</text></svg>`;return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;}
  function stamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;}
  function protect(el,d){
    guard?.abort();const ac=new AbortController();guard=ac;const sig={signal:ac.signal};
    protectCss();const mod=el.querySelector('.resident-module');if(!mod)return;mod.classList.add('r-protect');
    const who=`${d.viewer?.name||''} ${d.viewer?.employee_id||''}`.trim();
    const wm=document.createElement('div');wm.className='r-wm';mod.appendChild(wm);
    const cover=document.createElement('div');cover.className='r-shield-cover';cover.innerHTML='🔒 已隱藏住戶資料<br><small style="font-weight:400">回到這個視窗即可繼續查看</small>';mod.appendChild(cover);
    const paint=()=>{wm.style.backgroundImage=wmUrl(`${who}　${stamp()}　${d.community?.name||''}`);};paint();
    const alive=()=>{if(document.body.contains(mod))return true;ac.abort();if(guard===ac)guard=null;return false;};
    const shield=on=>{if(alive())mod.classList.toggle('r-shield',!!on);};
    const wipe=msg=>{S.d={...S.d,records:[]};mod.classList.remove('r-shield','r-protect');mod.innerHTML=`<div class="eyebrow">🏠 住戶名冊</div><h1>無法查看住戶名冊</h1><div class="msg error">🔒 您已沒有查看住戶名冊的權限，畫面上的住戶資料已清除。</div><p class="muted">${esc(msg)}</p>`;};
    const check=async()=>{if(!alive())return;try{const r=await fetch(`/api/staff/residents/access?category=${encodeURIComponent(S.category)}`,{credentials:'same-origin',cache:'no-store'});if(!r.ok){let j={};try{j=await r.json()}catch{}wipe(j.error||'您已沒有查看住戶名冊的權限');ac.abort();return false;}}catch{}return true;};
    const warn=()=>{const n=document.createElement('div');n.textContent='🔒 住戶名冊不可截圖';n.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:9999;background:#A44528;color:#fff;padding:10px 18px;border-radius:999px;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.2)';document.body.appendChild(n);setTimeout(()=>n.remove(),2200);};
    const inField=e=>/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||'')||e.target?.isContentEditable;
    for(const ev of ['contextmenu','copy','cut','dragstart','selectstart'])mod.addEventListener(ev,e=>{if(!inField(e))e.preventDefault();},sig);
    document.addEventListener('keydown',e=>{if(!alive())return;const k=String(e.key||'').toLowerCase();const mod_=e.ctrlKey||e.metaKey;
      if(k==='printscreen'||(e.metaKey&&e.shiftKey&&['3','4','5','s'].includes(k))||(e.ctrlKey&&e.shiftKey&&k==='s')){shield(true);try{navigator.clipboard?.writeText('');}catch{}warn();setTimeout(()=>shield(document.hasFocus()?false:true),1500);return;}
      if(mod_&&['p','s'].includes(k)){e.preventDefault();warn();return;}
      if(mod_&&['c','x','a'].includes(k)&&!inField(e)){e.preventDefault();}},{...sig,capture:true});
    document.addEventListener('keyup',e=>{if(!alive())return;if(String(e.key||'').toLowerCase()==='printscreen'){try{navigator.clipboard?.writeText('');}catch{}shield(true);warn();setTimeout(()=>shield(false),1500);}},{...sig,capture:true});
    window.addEventListener('blur',()=>shield(true),sig);
    window.addEventListener('focus',async()=>{if(!alive())return;if(await check())shield(false);},sig);
    document.addEventListener('visibilitychange',async()=>{if(!alive())return;if(document.hidden)shield(true);else if(await check()&&document.hasFocus())shield(false);},sig);
    window.addEventListener('beforeprint',()=>shield(true),sig);window.addEventListener('afterprint',()=>shield(false),sig);
    const timer=setInterval(()=>{if(!alive()){clearInterval(timer);return;}paint();if(!document.hidden)check();},60000);ac.signal.addEventListener('abort',()=>clearInterval(timer));
    if(!document.hasFocus())shield(true);
  }
  function noticeView(el,d,label){
    protectCss();
    el.innerHTML=`<div class="panel resident-module r-notice"><div class="eyebrow">🏠 住戶名冊</div><h1>住戶個人資料保密聲明</h1><p>目前案場：<strong>${esc(d.community?.name||'')}</strong>。第一次查看${esc(label||labels[d.category]||'住戶名冊')}前，請先閱讀並同意以下事項：</p>
      <ol>${(d.notice?.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>
      <label><input type="checkbox" id="rAgree"> 我已閱讀並同意遵守以上事項</label><button type="button" id="rAgreeBtn" disabled>同意並查看</button></div>`;
    const cb=document.getElementById('rAgree'),btn=document.getElementById('rAgreeBtn');
    cb.addEventListener('change',()=>{btn.disabled=!cb.checked;});
    btn.addEventListener('click',async()=>{btn.disabled=true;try{await api('/api/staff/residents/ack',J('POST',{category:d.category,version:d.notice?.version}));await reload();}catch(err){alert(err.message);btn.disabled=false;}});
  }
  // ---------- 住戶聯繫一覽表（A4，各棟「樓層 × 戶號」對照表，列印或另存 PDF）----------
  // 戶數多的棟：一棟一頁（樓層太多才分頁，由高樓層往下）；戶數少的棟：多棟合併在同一頁。不含門牌地址。
  const PAGE_MM=246,LINE_MM=3.55;
  function cellLines(u){return 1+Math.max(1,Math.ceil((u.names||[]).length/2))+Math.max(1,(u.phones||[]).length)+(u.emergency||[]).length+Math.max(1,(u.cars||[]).length+((u.motos||[]).length?1:0),(u.plates||[]).length);}
  function sheetBlocks(groups){
    // 每棟拆成「列」：住宅棟一列 = 一個樓層；逐戶指定（店面）每 6 戶一列
    const blocks=[];
    for(const g of groups){
      let rows;
      if(g.type==='tower'){const by=new Map(g.units.map(u=>[`${u.floor}|${u.no}`,u]));rows=g.floors.map(f=>({label:f<0?`B${-f}`:String(f),cells:g.cols.map(c=>by.get(`${f}|${c}`)||null)}));}
      else{const n=Math.min(6,Math.max(1,g.units.length));rows=[];for(let i=0;i<g.units.length;i+=n)rows.push({label:'',cells:Array.from({length:n},(_,k)=>g.units[i+k]||null)});}
      const heads=g.type==='tower'?g.cols:null;const ncol=g.type==='tower'?g.cols.length:Math.min(6,g.units.length);
      rows.forEach(r=>{r.mm=Math.max(...r.cells.map(c=>c?cellLines(c):3))*LINE_MM+2.2;});
      blocks.push({g,rows,heads,ncol});
    }
    const pages=[];let cur=null,left=0;const HEAD=13;
    const newPage=()=>{cur=[];pages.push(cur);left=PAGE_MM;};
    for(const b of blocks){
      const total=b.rows.reduce((x,r)=>x+r.mm,0)+HEAD;
      if(total<=PAGE_MM){if(!cur||total>left)newPage();cur.push({...b,cont:false});left-=total+4;continue;}
      // 一棟要分幾頁：先算頁數，再把樓層平均分到各頁（例如 14 層分成 7＋7），版面比較整齊
      const k=Math.ceil((total-HEAD)/(PAGE_MM-HEAD));const target=(total-HEAD)/k;
      let i=0,first=true;while(i<b.rows.length){newPage();let h=HEAD;const take=[];while(i<b.rows.length&&(!take.length||(h-HEAD+b.rows[i].mm<=target+b.rows[i].mm/2&&h+b.rows[i].mm<=PAGE_MM))){h+=b.rows[i].mm;take.push(b.rows[i]);i++;}cur.push({...b,rows:take,cont:!first});left=PAGE_MM-h-4;first=false;}
    }
    return pages;
  }
  async function printContactSheet(){
    const d=await api('/api/staff/residents/contact-sheet');const pages=sheetBlocks(d.groups);const when=String(d.printed_at||'').slice(0,10);
    const cellHtml=u=>{if(!u)return '<td class="x"></td>';const cls=[u.tenant?'ten':'',u.occupancy==='vacant'?'vac':'',u.occupancy==='undelivered'?'und':''].filter(Boolean).join(' ');
      const names=[];for(let i=0;i<(u.names||[]).length;i+=2)names.push(u.names.slice(i,i+2).map(esc).join('　'));
      return `<td class="${cls}"><div class="cd">${esc(u.code)}${u.tenant?'<i>(租)</i>':''}${u.occupancy==='vacant'?'<i>未入住</i>':u.occupancy==='undelivered'?'<i>未交屋</i>':''}</div>
        <div class="nm">${names.join('<br>')||'&nbsp;'}</div><div class="ph">${(u.phones||[]).map(esc).join('<br>')||'&nbsp;'}</div>${(u.emergency||[]).length?`<div class="em">緊急 ${u.emergency.map(esc).join('<br>緊急 ')}</div>`:''}
        <div class="pk"><span>${[...(u.cars||[]).map(esc),...((u.motos||[]).length?[`機${u.motos.map(esc).join('、')}`]:[])].join('<br>')}</span><span class="pl">${(u.plates||[]).map(esc).join('<br>')}</span></div></td>`;};
    const blockHtml=blk=>`<div class="blk"><div class="bt"><b>${esc(blk.g.name)}</b>${blk.g.zone?`<small>（${esc(blk.g.zone)}）</small>`:''}${blk.cont?'<small>（續）</small>':''}<small>共 ${blk.g.units.length} 戶</small></div>
      <table><colgroup>${blk.heads?'<col style="width:6mm">':''}${Array.from({length:blk.ncol},()=>'<col>').join('')}</colgroup>${blk.heads?`<thead><tr><th></th>${blk.heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>`:''}
      <tbody>${blk.rows.map(r=>`<tr>${blk.heads?`<th class="fl">${esc(r.label)}</th>`:''}${r.cells.map(cellHtml).join('')}</tr>`).join('')}</tbody></table></div>`;
    const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(d.community)}-住戶聯繫一覽表-${when}</title><style>
      @page{size:A4 portrait;margin:9mm 8mm}*{box-sizing:border-box}body{margin:0;font-family:'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif;color:#1D0D0C;font-size:8pt;line-height:1.28}
      .pg{page-break-after:always;height:279mm;display:flex;flex-direction:column}.pg:last-child{page-break-after:auto}
      .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.4pt solid #1D0D0C;padding-bottom:1.6mm;margin-bottom:2mm}.hd b{font-size:13pt}.lg{font-size:8pt}.lg i{font-style:normal;margin-left:3mm}.lg .t{color:#1E56A0}.lg .v{background:#FFF0B3;padding:0 1mm}.lg .u{color:#C0392B}.lg small{color:#666;margin-left:3mm}
      .blk{margin-bottom:3.5mm;page-break-inside:avoid}.bt{font-size:10pt;margin:0 0 1mm}.bt small{font-size:7.8pt;color:#7A5F58;margin-left:1.5mm}
      table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#EEE7E3;font-size:8pt;padding:.8mm;border:.5pt solid #9C8C86;text-align:center}th.fl{font-size:9pt}
      td{border:.5pt solid #9C8C86;vertical-align:top;padding:.8mm 1.1mm;overflow:hidden;word-break:break-all}td.x{background:repeating-linear-gradient(45deg,#fff 0 2mm,#F4F0EE 2mm 4mm)}
      .cd{font-weight:700;font-size:8.2pt;border-bottom:.4pt dotted #B9AAA4;margin-bottom:.5mm}.cd i{font-style:normal;font-weight:400;margin-left:1mm;font-size:7.4pt}
      .nm{font-size:8.4pt;font-weight:600}.ph{font-size:7.6pt}.em{font-size:7pt;color:#6B5A55}.pk{display:flex;justify-content:space-between;gap:1mm;font-size:7.1pt;margin-top:.6mm;color:#333}.pk .pl{text-align:right;color:#555}
      td.ten,td.ten .nm,td.ten .ph,td.ten .cd{color:#1E56A0}td.vac{background:#FFF0B3}td.und,td.und .nm,td.und .ph,td.und .cd{color:#C0392B}
      .ft{margin-top:auto;display:flex;justify-content:space-between;font-size:7.4pt;color:#777;border-top:.5pt solid #ccc;padding-top:1.3mm}
    </style></head><body>${pages.map((p,pi)=>`<section class="pg"><div class="hd"><b>${esc(d.community)}｜住戶聯繫一覽表</b><span class="lg"><i class="t">藍字：承租戶</i><i class="v">黃底：未入住</i><i class="u">紅字：未交屋</i><small>列印 ${esc(when)}</small></span></div>
      ${p.map(blockHtml).join('')}<div class="ft"><span>內部資料：僅供本社區櫃檯、保全聯繫住戶使用，請妥善保管，勿外流。</span><span>第 ${pi+1} 頁／共 ${pages.length} 頁</span></div></section>`).join('')}</body></html>`;
    const fr=document.createElement('iframe');fr.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(fr);
    fr.contentDocument.open();fr.contentDocument.write(html);fr.contentDocument.close();
    alert(`已排版完成：共 ${pages.length} 頁 A4。\n接下來會開啟列印視窗，要存成 PDF 請在「目的地／印表機」選擇「另存為 PDF」。`);
    setTimeout(()=>{try{fr.contentWindow.focus();fr.contentWindow.print();}catch(e){alert('無法開啟列印視窗：'+e.message);}setTimeout(()=>fr.remove(),60000);},300);
    window.__lastContactSheet={pages:pages.length,html};
  }

  // ---------- 頁面 ----------
  async function loadTemplate(){try{const d=await api('/api/staff/platform-resources?category='+encodeURIComponent('住戶名冊'));return (d.platformResources||[])[0]||null;}catch{return null;}}
  async function render(action,label){
    injectStyle();
    const el=document.getElementById('staffHome');if(!el)throw new Error('找不到工作區');
    const category=labels[action]?action:'residents-contact';
    if(S.category!==category)S.filter={q:'',building:'',lease:'',zone:''};
    S.action=action;S.label=label;S.category=category;
    const d=await api(`/api/staff/residents?category=${encodeURIComponent(category)}`);S.d=d;
    if(d.ack_required){guard?.abort();return noticeView(el,d,label);}
    const sort=d.preference?.sort||'building',edit=!!d.viewer?.can_edit,canUpload=!!d.viewer?.can_upload,c=d.community||{};
    const smart=!!d.layout?.configured;
    const buildings=smart?d.layout.buildings.map(b=>[b.code,b.name]):[...new Set((d.records||[]).map(r=>String(r.building||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant',{numeric:true})).map(b=>[b,b]);
    const zones=smart?[...new Set(d.layout.buildings.map(b=>b.zone).filter(Boolean))]:[];
    const template=null;
    const intro={'residents-contact':'社區住戶的聯繫窗口。可以定期上傳 Excel 更新，也可以由「區分所有權人」與「承租人」的資料自動更新。','residents-owners':'各戶的區分所有權人。房屋買賣請用「過戶」，舊所有權人會留在異動紀錄；異動後住戶聯繫表會自動跟著更新。','residents-tenants':'登錄各戶的租約。系統會提醒即將到期或已到期的租約；有效租約的戶別，住戶聯繫表會以承租人為聯繫人。'}[category];
    let banner='';
    if(category==='residents-contact'&&d.sync){const s=d.sync;banner=`<div class="r-sync"><div class="r-sync-text">🔄 <b>智慧同步</b>：區分所有權人 ${s.owners} 筆、有效租約 ${s.tenants} 筆。${s.pending?`目前有 <b>${s.pending}</b> 戶的聯繫人和最新資料不同（更新 ${s.update}、新增 ${s.add}）。`:s.units?'聯繫表已和所有權人／承租人資料一致。':'還沒有登錄所有權人或承租人，請先到「區分所有權人」「承租人」建立資料。'}</div>${edit?`<label title="所有權人或承租人有異動時，自動更新聯繫表對應的戶別"><input type="checkbox" id="rAuto" ${d.settings?.auto_sync?'checked':''}> 異動時自動更新</label>`:''}<button type="button" id="rSync" ${s.units?'':'disabled'}>${s.pending?`預覽並更新 ${s.pending} 戶`:'查看比對結果'}</button></div>`;}
    if(category==='residents-tenants'&&d.lease_summary){const L=d.lease_summary;banner=(L.expired?`<div class="r-alert bad">⚠ 有 ${L.expired} 筆租約已經到期，請確認是續約還是退租。</div>`:'')+(L.expiring?`<div class="r-alert warn">⏰ 有 ${L.expiring} 筆租約將在 30 天內到期。</div>`:'')+`<div class="r-chips">${[['','目前租約',(L.active||0)+(L.expiring||0)+(L.expired||0)+(L.upcoming||0)],['expiring','30 天內到期',L.expiring||0],['expired','已到期',L.expired||0],['upcoming','尚未起租',L.upcoming||0],['ended','已退租',L.ended||0]].map(([k,t,n])=>`<button type="button" class="${S.filter.lease===k?'':'secondary'}" data-lease="${k}">${t}（${n}）</button>`).join('')}</div>`;}
    el.innerHTML=`<div class="panel resident-module"><div class="eyebrow">🏠 住戶名冊</div><h1>${esc(label||labels[category])}</h1><p>目前案場：<strong>${esc(c.name||'尚未選擇案場')}</strong>。${intro}</p>
      <div class="resident-toolbar"><label>排序方式<select id="residentSort"><option value="building" ${sort==='building'?'selected':''}>${smart?'戶別順序（棟別 → 樓層 → 戶號）':'棟別 → 戶號'}</option><option value="unit" ${sort==='unit'?'selected':''}>戶號 → 棟別</option><option value="floor" ${sort==='floor'?'selected':''}>樓層 → 棟別 → 戶號</option></select></label>
      <div class="resident-actions">${edit?`<button type="button" id="rAdd">${category==='residents-tenants'?'🔑 登錄租約':'＋ 新增'}</button>`:''}${canUpload?`<button type="button" class="secondary" id="residentUploadBtn">📤 上傳 Excel 更新</button><input id="residentFile" type="file" accept=".xlsx,.xls,.csv,.txt" hidden>`:''}${edit&&category==='residents-contact'?`<button type="button" class="secondary" id="rSheet" title="給櫃檯、保全電話聯繫用的一覽表（不含門牌地址），依戶數自動排版成 A4">🖨 聯繫一覽表 PDF</button>`:''}${canUpload&&smart?`<a href="/api/staff/residents/template?category=${encodeURIComponent(category)}" title="依社區戶別清單產生，已有的資料會一起帶出來">📥 上傳範本</a>`:''}${edit?`<a href="/api/staff/residents/export?category=${encodeURIComponent(category)}" id="rExport">📥 下載 Excel</a>`:''}<button type="button" class="secondary" id="rHist">📜 異動紀錄</button></div></div>
      ${smart?'':`<div class="r-setup"><div><b>🏗 先完成「社區棟別門牌設定」</b><br><span class="hint">設定每一棟的門牌、位置（前棟／後棟）、樓層和每層戶號後，系統會產生全社區的戶別清單：上傳名冊只要填戶別，門牌地址會自動帶入，也會檢查戶別和地址有沒有對錯。${edit?'':'請經理或秘書設定。'}</span></div>${edit?'<button type="button" id="rSetup">開始設定</button>':''}</div>`}
      ${banner}
      <div class="resident-searchbar"><label>🔎 搜尋<input id="residentSearch" type="search" value="${esc(S.filter.q)}" placeholder="${category==='residents-contact'?'姓名、戶號、電話、車位、緊急聯絡人':'姓名、戶號、電話、門牌、備註'}"></label><label>🏢 棟別<select id="residentBuilding"><option value="">全部棟別</option>${buildings.map(([v,l])=>`<option value="${esc(v)}" ${S.filter.building===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label><button type="button" class="secondary" id="residentClear" style="padding:9px 13px;min-height:0">清除</button><span class="resident-search-count" id="residentSearchCount"></span></div>${zones.length>1?`<div class="r-zones">${[['','全部'],...zones.map(z=>[z,z])].map(([k,l])=>`<button type="button" class="${(S.filter.zone||'')===k?'':'secondary'}" data-zone="${esc(k)}">${esc(l)}</button>`).join('')}</div>`:''}
      <div class="resident-meta"><span class="r-protect-tag" title="畫面顯示您的姓名與時間；離開視窗會自動遮住；不提供列印與複製">🔒 防截圖模式</span><span>資料共 ${(d.records||[]).length} 筆</span>${d.last_import?`<span>最近整批更新：${esc(d.last_import.original_filename||'')}${d.last_import.imported_by_name?`（${esc(d.last_import.imported_by_name)}）`:''}</span>`:''}${!edit?'<span>僅供查詢，修改請洽經理或秘書</span>':''}</div>
      <div id="residentTable"></div></div>`;
    drawTable();
    protect(el,d);
    const $=id=>document.getElementById(id);
    $('residentSort')?.addEventListener('change',async e=>{try{await api('/api/staff/residents/preference',J('PUT',{category,sort:e.target.value}));await reload();}catch(err){alert(err.message)}});
    $('residentSearch')?.addEventListener('input',e=>{S.filter.q=e.target.value;drawTable();});
    $('residentBuilding')?.addEventListener('change',e=>{S.filter.building=e.target.value;drawTable();});
    $('residentClear')?.addEventListener('click',()=>{S.filter.q='';S.filter.building='';$('residentSearch').value='';$('residentBuilding').value='';drawTable();});
    el.querySelectorAll('[data-lease]').forEach(b=>b.addEventListener('click',()=>{S.filter.lease=b.dataset.lease;el.querySelectorAll('[data-lease]').forEach(x=>x.className=x===b?'':'secondary');drawTable();}));
    $('rAdd')?.addEventListener('click',()=>openForm(null));
    $('rSheet')?.addEventListener('click',()=>printContactSheet().catch(err=>alert(err.message)));
    $('rSetup')?.addEventListener('click',()=>{if(!window.CommunityLayout){alert('模組尚未載入，請重新整理頁面');return;}window.CommunityLayout.openEditor({onSaved:reload});});
    el.querySelectorAll('[data-zone]').forEach(b=>b.addEventListener('click',()=>{S.filter.zone=b.dataset.zone;el.querySelectorAll('[data-zone]').forEach(x=>x.className=x===b?'':'secondary');drawTable();}));
    $('rHist')?.addEventListener('click',()=>openHistory().catch(err=>alert(err.message)));
    $('rSync')?.addEventListener('click',()=>openSync().catch(err=>alert(err.message)));
    $('rAuto')?.addEventListener('change',async e=>{try{await api('/api/staff/residents/settings',J('PUT',{category:'residents-contact',auto_sync:e.target.checked}));}catch(err){alert(err.message);e.target.checked=!e.target.checked;}});
    $('residentUploadBtn')?.addEventListener('click',()=>{if(!smart){alert('請先完成「社區棟別門牌設定」，再上傳名冊。');return;}$('residentFile').click();});
    $('residentFile')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const btn=$('residentUploadBtn');const send=async preview=>{const fd=new FormData();fd.append('category',category);if(preview)fd.append('preview','1');fd.append('file',file);return api('/api/staff/residents/import',{method:'POST',body:fd});};
      btn.disabled=true;btn.textContent='檢查中…';
      try{const p=await send(true);btn.disabled=false;btn.textContent='📤 上傳 Excel 更新';
        const {box,close}=modal('📤 上傳前檢查',`<p>檔案「${esc(file.name)}」共 <b>${p.total}</b> 筆：對到社區戶別 <b>${p.matched}</b> 筆${p.unmatched?`，<b style="color:#A44528">${p.unmatched} 筆找不到戶別</b>（仍會匯入，可以之後再修正）`:''}${p.parking_units?`；會更新 <b>${p.parking_units}</b> 戶的車位`:''}。</p>
          ${p.warning_count?`<p><b>⚠ 需要確認的地方（${p.warning_count}）</b></p><div class="r-pv-list">${p.warnings.map(w=>`<div>${w.row?`第 ${w.row} 列 `:''}${w.name?`${esc(w.name)}：`:''}${esc(w.msg)}</div>`).join('')}</div>`:'<p class="hint">✅ 戶別和門牌地址都對得起來。</p>'}
          <p class="hint">${(d.records||[]).length?`匯入會取代目前的 ${(d.records||[]).length} 筆${labels[category]}資料（舊資料仍可在異動紀錄查到上傳時間）。`:''}自動辨識欄位：${esc((p.detected_fields||[]).map(k=>({building:'棟別',unit:'戶別',floor:'樓層',name:'姓名',phone:'電話',address:'門牌地址',relation:'身分',lease_start:'起租日',lease_end:'租約到期日',lease_range:'租期'})[k]||k).join('、')||'未辨識')}</p>
          <div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" data-go>確認匯入</button></div>`,{wide:true});
        box.querySelector('[data-cancel]').onclick=()=>{close();e.target.value='';};
        box.querySelector('[data-go]').onclick=async ev=>{ev.target.disabled=true;ev.target.textContent='匯入中…';try{const r=await send(false);close();alert(`✅ ${r.message||'匯入完成'}${r.parking_units?`\n已更新 ${r.parking_units} 戶車位。`:''}`);await reload();}catch(err){alert(err.message||'匯入失敗');ev.target.disabled=false;ev.target.textContent='確認匯入';}finally{e.target.value='';}};
      }catch(err){alert(err.message||'檢查失敗');btn.disabled=false;btn.textContent='📤 上傳 Excel 更新';e.target.value='';}});
  }
  window.ResidentRosterModule={render};
})();
