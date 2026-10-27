// 公司內勤：開通／設定人員（選職位）、組織圖、舊資料對應職位、區域管理、重設密碼
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok){if(d.must_change_password)window.PasswordModule?.force('/api/company/my');throw new Error(d.error||'操作失敗');}return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={org:null};
  const load=async()=>(S.org=await api('/api/company/org'));
  function injectStyle(){
    if(document.getElementById('orgStyle'))return;
    const s=document.createElement('style');s.id='orgStyle';
    s.textContent=`
.og-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.og-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.88rem;margin:0}
.og-form input,.og-form select{margin:0;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.og-form .wide{grid-column:1/-1}
.og-info{background:#F8F6F4;border:1px solid #E6E0DD;border-radius:10px;padding:9px 12px;font-size:.85rem;line-height:1.7}
.og-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:4px 12px;max-height:220px;overflow:auto;border:1px solid #E9E3E1;border-radius:10px;padding:8px 10px}
.og-checks label{flex-direction:row;align-items:center;gap:6px;font-weight:500}.og-checks input{width:auto}
.og-radio{display:flex;gap:16px}.og-radio label{flex-direction:row;align-items:center;gap:6px;font-weight:600}.og-radio input{width:auto}
.og-adv{grid-column:1/-1;border:1px solid #E9E3E1;border-radius:10px;padding:8px 12px}.og-adv summary{cursor:pointer;font-weight:800;color:#4E312D}
.og-dept{border:1px solid #E9E3E1;border-radius:14px;margin:10px 0;overflow:hidden;background:#fff}
.og-dept>h4{margin:0;padding:9px 14px;background:#F6F4F2;font-size:.95rem}
.og-pos{padding:8px 14px;border-top:1px solid #F2EFEE;display:grid;grid-template-columns:180px 1fr;gap:10px}
.og-pos>b{font-size:.88rem}.og-pos small{color:#8A7E7A}
.og-people{display:flex;flex-wrap:wrap;gap:6px}
.og-person{border:1px solid #E6E0DD;border-radius:10px;padding:5px 10px;font-size:.84rem;background:#FDFCFB;cursor:pointer}
.og-person:hover{border-color:#4E312D}.og-person small{display:block;color:#7A6E6A;font-size:.74rem}
.og-warn{background:#fff7e5;border:1px solid #efd99c;border-radius:10px;padding:10px 14px;margin:8px 0;color:#7a5200}
.og-table{border-collapse:collapse;width:100%;font-size:.86rem}.og-table th,.og-table td{padding:7px 9px;border-bottom:1px solid #F2EFEE;text-align:left;vertical-align:middle}.og-table th{background:#F6F4F2;font-size:.78rem}
.og-table select,.og-table input{margin:0;padding:6px 8px;width:auto;max-width:100%}
@media(max-width:700px){.og-form{grid-template-columns:1fr}.og-pos{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }
  function modal(title,body,wide=true){
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-width:${wide?760:520}px;width:min(${wide?760:520}px,96vw);max-height:92vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button><h2>${title}</h2>${body}</div>`;
    document.body.appendChild(box);document.body.classList.add('modal-open');
    const close=()=>{box.remove();document.body.classList.remove('modal-open');};
    box.querySelector('.modal-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    return {box,close};
  }
  const deptName=(o,id)=>o.config.departments.find(d=>d.id===id)?.name||'';
  const posOptions=(o,sel)=>{const groups=[['',o.config.positions.filter(p=>!p.dept)],...o.config.departments.map(d=>[d.name,o.config.positions.filter(p=>p.dept===d.id)])];return '<option value="">請選擇職位</option>'+groups.filter(g=>g[1].length).map(([g,list])=>`${g?`<optgroup label="${esc(g)}">`:''}${list.map(p=>`<option value="${esc(p.id)}" ${p.id===sel?'selected':''}>${esc(p.name)}</option>`).join('')}${g?'</optgroup>':''}`).join('');};
  const shiftText=(o,s)=>o.shifts[s]||'';

  // ================= 開通／設定人員 =================
  async function openStaffForm(staffId,{onDone}={}){
    injectStyle();const o=await load();
    const m=staffId?o.members.find(x=>x.staff_id===Number(staffId)):null;
    if(staffId&&!m)throw new Error('找不到人員');
    const isAdminAcc=m?.role==='company_admin';
    const catalog=typeof loadPermissionCatalog==='function'?await loadPermissionCatalog():{company:[],site:[]};
    const pid0=m?.position_id||m?.suggestion?.position_id||'';
    const mobileMode=o.login_mode==='mobile';
    const {box,close}=modal(staffId?`👤 ${esc(m.name)}｜職位與工作設定`:'👤 開通人員',`<form class="og-form" id="ogForm">
      ${staffId?`<label>員編<input value="${esc(m.employee_id)}" disabled></label><label>姓名<input name="name" value="${esc(m.name)}" ${isAdminAcc?'disabled':''}></label>`:(mobileMode?`<label>員編（可不填）<input name="employee_id" placeholder="不填會自動編號"></label>`:`<label>員編<input name="employee_id" required placeholder="例如 A002"></label>`)+`<label>姓名<input name="name" required placeholder="例如 王小明"></label>`}
      <label>手機${mobileMode?'（登入帳號）':''}<input name="mobile" inputmode="tel" value="${esc(m?.mobile||'')}" placeholder="0912345678" ${mobileMode?'required':''}><small class="muted" style="font-weight:400">${mobileMode?'本公司以手機號碼登入':'可以用手機號碼登入'}</small></label>
      ${staffId?'':`<label>初始密碼<span style="display:flex;gap:6px"><input name="password" required minlength="4" placeholder="至少 4 碼"><button type="button" class="secondary" id="ogGen" style="padding:6px 10px;min-height:0;margin:0;white-space:nowrap">產生</button></span><small class="muted" style="font-weight:400">第一次登入時會要求本人改密碼</small></label>`}
      <label class="wide">職位<select name="position_id" required>${posOptions(o,pid0)}</select></label>
      ${m&&!m.position_id&&m.suggestion?`<div class="wide og-warn" style="margin:0">原本的設定：${esc(m.legacy_position||'未設定')}，系統建議對應為「${esc(m.suggestion.position_name)}」，請確認。</div>`:''}
      <div class="wide og-info" id="ogInfo"></div>
      <div class="wide" id="ogWhere"></div>
      ${isAdminAcc?'':`<details class="og-adv"><summary>進階：個別調整工作台權限（一般不用改，依職位自動帶入）</summary><p class="hint" style="margin:6px 0">勾選後只影響這個人。換職位時會重新帶入該職位的預設權限。</p><div class="workspace-permission-group" id="ogCo"><div class="workspace-permission-title">🏢 內勤工作項目</div><div class="check-list">${permissionOptionsHtml(catalog.company,new Set(),'org')}</div>${sensitivePermHtml(new Set(),'org')}</div><div class="workspace-permission-group" id="ogSite"><div class="workspace-permission-title">🏠 駐點工作項目</div><div class="check-list">${permissionOptionsHtml(catalog.site,new Set(),'org')}</div></div></details>`}
      <div id="ogMsg" class="wide"></div>
      <div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">${staffId?'💾 儲存':'✓ 開通人員'}</button></div></form>`);
    const f=box.querySelector('#ogForm');box.querySelector('[data-cancel]').onclick=close;
    box.querySelector('#ogGen')?.addEventListener('click',()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';f.elements.password.value=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>a[b%a.length]).join('');f.elements.password.type='text';});
    let lastPid=null;
    const setPerms=list=>{const set=new Set(list);box.querySelectorAll('[data-org-perm]').forEach(c=>{if(!c.disabled||['hr-records','payroll'].includes(c.dataset.orgPerm))c.checked=set.has(c.dataset.orgPerm);});};
    function draw(){
      const p=o.config.positions.find(x=>x.id===f.elements.position_id.value);const where=box.querySelector('#ogWhere');const info=box.querySelector('#ogInfo');
      if(!p){info.innerHTML='選擇職位後，系統會自動帶入工作地點、排班方式與預設權限。';where.innerHTML='';return;}
      const K=o.kinds[p.kind];
      info.innerHTML=`<b>${esc(p.name)}</b>${p.dept?`｜${esc(deptName(o,p.dept))}`:''}｜${esc(K.label)}<br>管轄：${esc(K.scope)}｜排班：${esc(o.schedules[p.schedule]||'')}${p.shift?`（${shiftText(o,p.shift)}）`:''}`;
      const curSites=new Set(where.querySelectorAll('[name=cid]').length?[...where.querySelectorAll('[name=cid]:checked,[name=cid] option:checked')].map(x=>Number(x.value)):(m?.community_ids||[]));
      const active=o.communities.filter(c=>c.status==='active');
      const regName=id=>o.regions.find(r=>r.id===id)?.name||'未分區';
      let html='';
      if(K.sites==='one')html+=`<label>所屬社區<select name="cid"><option value="">請選擇</option>${active.map(c=>`<option value="${c.id}" ${curSites.has(c.id)?'selected':''}>${esc(c.name)}（${esc(regName(c.region_id))}）</option>`).join('')}</select></label>`;
      if(K.sites==='many')html+=`<div><div style="font-weight:700;font-size:.88rem;margin-bottom:5px">支援的社區（可複選）</div><div class="og-checks">${active.map(c=>`<label><input type="checkbox" name="cid" value="${c.id}" ${curSites.has(c.id)?'checked':''}> ${esc(c.name)}</label>`).join('')}</div></div>`;
      if(K.regions){const cur=new Set(where.querySelectorAll('[name=rid]').length?[...where.querySelectorAll('[name=rid]:checked')].map(x=>Number(x.value)):(m?.region_ids||[]));html+=o.regions.length?`<div><div style="font-weight:700;font-size:.88rem;margin-bottom:5px">負責區域（可複選）</div><div class="og-checks">${o.regions.map(r=>`<label><input type="checkbox" name="rid" value="${r.id}" ${cur.has(r.id)?'checked':''}> ${esc(r.name)}<small class="muted">（${esc(active.filter(c=>c.region_id===r.id).map(c=>c.name).join('、')||'尚無社區')}）</small></label>`).join('')}</div><small class="muted">可以查看負責區域內所有社區與人員的資料。</small></div>`:'<div class="og-warn">還沒有建立區域。請先到「社區管理 → 區域」把社區分區，再設定督導。</div>';}
      if(K.shift&&!p.shift){const cur=where.querySelector('[name=shift]:checked')?.value||m?.member_shift||'';html+=`<div><div style="font-weight:700;font-size:.88rem;margin-bottom:5px">班別${p.schedule==='security'?'':'（可不選）'}</div><div class="og-radio"><label><input type="radio" name="shift" value="day" ${cur==='day'?'checked':''}> 日班</label><label><input type="radio" name="shift" value="night" ${cur==='night'?'checked':''}> 夜班</label>${p.schedule==='security'?'':`<label><input type="radio" name="shift" value="" ${!cur?'checked':''}> 不分</label>`}</div></div>`;}
      if(!K.sites&&!K.regions)html+='<div class="hint" style="margin:0">內勤職位：不駐點，依國定假日見紅休，不排班（加班依公司設定另計）。</div>';
      where.innerHTML=html;
      if(p.id!==lastPid){const initial=lastPid===null&&m&&m.position_id===p.id?m.permissions:p.perms;const keepSensitive=(m?.permissions||[]).filter(k=>['hr-records','payroll'].includes(k));setPerms([...initial,...(lastPid===null?keepSensitive:[])]);lastPid=p.id;
        const co=box.querySelector('#ogCo'),si=box.querySelector('#ogSite');if(co)co.style.display=K.work==='site'?'none':'';if(si)si.style.display=K.work==='internal'?'none':'';}
    }
    f.elements.position_id.addEventListener('change',draw);draw();
    f.addEventListener('submit',async e=>{e.preventDefault();const msg=box.querySelector('#ogMsg');
      const where=box.querySelector('#ogWhere');const cids=[...where.querySelectorAll('select[name=cid]')].map(s=>Number(s.value)).filter(Boolean).concat([...where.querySelectorAll('input[name=cid]:checked')].map(x=>Number(x.value)));
      const body={name:f.elements.name?.value,mobile:f.elements.mobile.value,position_id:f.elements.position_id.value,community_ids:cids,region_ids:[...where.querySelectorAll('[name=rid]:checked')].map(x=>Number(x.value)),shift:where.querySelector('[name=shift]:checked')?.value||''};
      if(!isAdminAcc)body.permissions=[...box.querySelectorAll('[data-org-perm]:checked')].map(x=>x.dataset.orgPerm);
      if(!staffId){body.employee_id=f.elements.employee_id.value;body.password=f.elements.password.value;}
      try{const r=await api(staffId?`/api/company/org/staff/${staffId}`:'/api/company/org/staff',J(staffId?'PUT':'POST',body));close();
        if(!staffId)alert(`已開通 ${body.name}。\n登入帳號：${mobileMode?`手機 ${body.mobile}`:`員編 ${r.employee_id||body.employee_id}${body.mobile?` 或手機 ${body.mobile}`:''}`}\n初始密碼：${body.password}\n第一次登入會要求本人修改密碼。`);
        onDone&&onDone();}catch(err){msg.innerHTML=`<div class="msg error">${esc(err.message)}</div>`;}});
  }

  async function resetPassword(staffId,name){
    if(!confirm(`要重設「${name||''}」的密碼嗎？\n系統會產生一組臨時密碼，對方下次登入時必須改成自己的密碼。`))return;
    const r=await api(`/api/company/staff/${staffId}/reset-password`,{method:'POST'});
    const {box}=modal('🔑 臨時密碼',`<p>請把這組臨時密碼交給 <b>${esc(r.name)}</b>（員編 ${esc(r.employee_id)}）。這個畫面關閉後就看不到了。</p><div style="font-size:1.6rem;font-weight:800;letter-spacing:.12em;background:#F8F6F4;border-radius:12px;padding:14px;text-align:center;margin:10px 0" id="tmpPw">${esc(r.temp_password)}</div><div class="modal-actions"><button type="button" id="cpPw">📋 複製</button></div>`,false);
    box.querySelector('#cpPw').onclick=async()=>{try{await navigator.clipboard.writeText(r.temp_password);box.querySelector('#cpPw').textContent='✓ 已複製';}catch{}};
  }

  // ================= 人員管理上方：組織圖＋舊資料對應 =================
  async function renderPanel(el,{onChange}={}){
    injectStyle();if(!el)return;
    let o;try{o=await load();}catch(e){el.innerHTML='';return;}
    const unmapped=o.members.filter(m=>!m.position_id);
    const byPos=new Map();for(const m of o.members.filter(x=>x.position_id)){if(!byPos.has(m.position_id))byPos.set(m.position_id,[]);byPos.get(m.position_id).push(m);}
    const cname=id=>o.communities.find(c=>c.id===id)?.name||'';const rname=id=>o.regions.find(r=>r.id===id)?.name||'';
    const person=m=>`<div class="og-person" data-og-edit="${m.staff_id}" title="點選設定">${esc(m.name)} <small class="muted">${esc(m.employee_id)}</small><small>${esc([m.kind==='region'?m.region_ids.map(rname).join('、'):m.community_ids.map(cname).join('、'),m.shift?shiftText(o,m.shift):''].filter(Boolean).join('｜'))}${m.supervisors?.direct?.length?`<br>直屬：${esc(m.supervisors.direct.join('、'))}`:''}</small></div>`;
    const posBlock=p=>`<div class="og-pos"><b>${esc(p.name)}<br><small>${esc(o.kinds[p.kind].label)}</small></b><div class="og-people">${(byPos.get(p.id)||[]).map(person).join('')||'<small class="muted">尚無人員</small>'}</div></div>`;
    const top=o.config.positions.filter(p=>!p.dept);
    el.innerHTML=`<div class="panel"><div class="section-title">🏢 組織圖</div><p class="hint">依職位自動形成上下級：現場人員歸社區主管、社區主管歸該區督導，同時也歸所屬部門（例如保全歸日／夜班勤務經理、秘書歸秘書部）。職位名稱由平台依貴公司習慣設定。點人員可以修改職位。</p>
      ${unmapped.length?`<div class="og-warn">⚠ 有 ${unmapped.length} 位人員還沒有設定職位（舊資料）。<button type="button" id="ogMap" style="margin-left:8px;padding:5px 12px;min-height:0">🪄 一鍵對應職位</button></div>`:''}
      ${top.length?`<div class="og-dept"><h4>公司</h4>${top.map(posBlock).join('')}</div>`:''}
      ${o.config.departments.map(d=>{const list=o.config.positions.filter(p=>p.dept===d.id);return list.length?`<details class="og-dept" ${list.some(p=>byPos.get(p.id)?.length)?'open':''}><summary style="list-style:none"><h4 style="margin:0;padding:9px 14px;background:#F6F4F2;font-size:.95rem;cursor:pointer">${esc(d.name)} <small class="muted">${list.reduce((a,p)=>a+(byPos.get(p.id)?.length||0),0)} 人</small></h4></summary>${list.map(posBlock).join('')}</details>`:'';}).join('')}</div>`;
    el.querySelectorAll('[data-og-edit]').forEach(b=>b.addEventListener('click',()=>openStaffForm(Number(b.dataset.ogEdit),{onDone:onChange}).catch(e=>alert(e.message))));
    el.querySelector('#ogMap')?.addEventListener('click',()=>openMapping(o,onChange));
  }
  function openMapping(o,onChange){
    const list=o.members.filter(m=>!m.position_id);
    const cname=id=>o.communities.find(c=>c.id===id)?.name||'';
    const {box,close}=modal('🪄 舊資料對應職位',`<p class="hint">系統依原本的「人員類型、職務類別、位階」建議職位，請確認或修改後套用。原本的案場與工作台權限會保留；只能駐一個社區的職位，會取原本第一個社區。區域督導請之後個別設定負責區域。</p>
      <div style="overflow:auto"><table class="og-table"><thead><tr><th>人員</th><th>原本設定</th><th>案場</th><th>對應職位</th><th>班別</th><th>套用</th></tr></thead><tbody>${list.map(m=>`<tr data-sid="${m.staff_id}"><td><b>${esc(m.name)}</b><br><small class="muted">${esc(m.employee_id)}${m.role==='company_admin'?'・公司管理員':''}</small></td><td>${esc(m.legacy_position||'—')}</td><td>${esc(m.community_ids.map(cname).join('、')||'—')}</td><td><select data-p>${posOptions(o,m.suggestion?.position_id||'')}</select></td><td><select data-sh><option value="">—</option><option value="day" ${m.suggestion?.shift==='day'?'selected':''}>日班</option><option value="night" ${m.suggestion?.shift==='night'?'selected':''}>夜班</option></select></td><td><input type="checkbox" data-on ${m.suggestion?'checked':''} style="width:auto"></td></tr>`).join('')}</tbody></table></div>
      <div id="mapMsg"></div><div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" id="mapGo">✓ 套用勾選的人員</button></div>`);
    box.querySelector('[data-cancel]').onclick=close;
    box.querySelector('#mapGo').onclick=async()=>{const items=[...box.querySelectorAll('tr[data-sid]')].filter(tr=>tr.querySelector('[data-on]').checked&&tr.querySelector('[data-p]').value).map(tr=>({staff_id:Number(tr.dataset.sid),position_id:tr.querySelector('[data-p]').value,shift:tr.querySelector('[data-sh]').value}));
      if(!items.length){alert('請至少勾選一位並選擇職位');return;}
      try{const r=await api('/api/company/org/apply-suggestions',J('POST',{items}));if(r.failed.length){box.querySelector('#mapMsg').innerHTML=`<div class="og-warn">已套用 ${r.done} 位；以下需要個別設定：<br>${r.failed.map(x=>`${esc(x.name)}：${esc(x.error)}`).join('<br>')}</div>`;onChange&&onChange();}else{close();alert(`已套用 ${r.done} 位人員的職位。`);onChange&&onChange();}}catch(e){alert(e.message);}};
  }

  // ================= 社區管理：區域 =================
  async function renderRegions(el,{onChange}={}){
    injectStyle();if(!el)return;
    let o;try{o=await load();}catch(e){el.innerHTML='';return;}
    const active=o.communities.filter(c=>c.status==='active');
    el.innerHTML=`<div class="panel"><div class="section-title">🗺 區域（督導負責範圍）</div><p class="hint">把社區分成區域，例如 A 區＝A 社區＋AB 社區。社區主管會自動歸到負責該區的督導底下，督導也可以查看區內所有人員與資料。</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><input id="rgName" placeholder="新區域名稱，例如 A區" style="max-width:220px;margin:0"><button type="button" id="rgAdd" style="margin:0">＋ 新增區域</button></div>
      ${o.regions.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${o.regions.map(r=>`<span class="tag success" style="display:inline-flex;gap:6px;align-items:center">${esc(r.name)}（${active.filter(c=>c.region_id===r.id).length}）<button type="button" class="lnk" data-rg-ren="${r.id}" style="border:0;background:none;padding:0;min-height:0;cursor:pointer">✎</button><button type="button" data-rg-del="${r.id}" style="border:0;background:none;padding:0;min-height:0;cursor:pointer;color:#a8322a">×</button></span>`).join('')}</div>`:''}
      <div class="table-wrap"><table class="og-table"><thead><tr><th>社區</th><th>所屬區域</th><th>督導</th></tr></thead><tbody>${active.map(c=>{const sup=o.members.filter(m=>m.kind==='region'&&m.region_ids.includes(c.region_id)).map(m=>m.name);return `<tr><td>${esc(c.name)}</td><td><select data-rg-c="${c.id}"><option value="">未分區</option>${o.regions.map(r=>`<option value="${r.id}" ${c.region_id===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></td><td>${esc(sup.join('、')||'—')}</td></tr>`;}).join('')||'<tr><td colspan="3" class="muted">尚無服務中的社區</td></tr>'}</tbody></table></div></div>`;
    const again=()=>renderRegions(el,{onChange}).then(()=>onChange&&onChange());
    el.querySelector('#rgAdd').onclick=async()=>{const name=el.querySelector('#rgName').value.trim();if(!name)return;try{await api('/api/company/org/regions',J('POST',{name}));again();}catch(e){alert(e.message);}};
    el.querySelectorAll('[data-rg-ren]').forEach(b=>b.onclick=async()=>{const r=o.regions.find(x=>x.id===Number(b.dataset.rgRen));const name=prompt('區域名稱',r?.name||'');if(!name)return;try{await api(`/api/company/org/regions/${r.id}`,J('PUT',{name}));again();}catch(e){alert(e.message);}});
    el.querySelectorAll('[data-rg-del]').forEach(b=>b.onclick=async()=>{if(!confirm('刪除這個區域？區內社區會變成「未分區」。'))return;try{await api(`/api/company/org/regions/${b.dataset.rgDel}`,{method:'DELETE'});again();}catch(e){alert(e.message);}});
    el.querySelectorAll('[data-rg-c]').forEach(s=>s.onchange=async()=>{try{await api(`/api/company/org/communities/${s.dataset.rgC}/region`,J('PUT',{region_id:s.value?Number(s.value):null}));again();}catch(e){alert(e.message);}});
  }

  window.OrgCompanyModule={openStaffForm,resetPassword,renderPanel,renderRegions,load};
})();
