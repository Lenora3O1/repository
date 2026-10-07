(function(){
  const A=window.AttendanceCompanyModule={};
  const q=s=>document.querySelector(s);
  const esc=s=>window.escapeHtml?window.escapeHtml(s):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  let cache={rules:{},communities:[],locations:[]};
  function qrUrl(token,size=420){return `https://quickchart.io/qr?text=${encodeURIComponent(token)}&size=${size}&margin=2`;}
  function typeName(t){return t==='patrol'?'巡邏點':'出勤打卡點'}
  function open(title,html){return window.openCompanyModal(title,html,true)}
  async function load(){cache=await api('/api/company/attendance/bootstrap');return cache}
  function communityOptions(selected=''){return (cache.communities||[]).map(c=>`<option value="${c.id}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.name)}</option>`).join('')}
  function locationRows(filterType){
    const rows=(cache.locations||[]).filter(x=>!filterType||x.location_type===filterType);
    if(!rows.length)return '<div class="empty">目前尚未建立地點。</div>';
    return `<div class="attendance-batchbar"><label><input type="checkbox" id="attSelectAll"> 全選</label><span id="attSelectedCount">已選 0 個</span><button type="button" class="secondary" id="attBatchPrint">🖨️ 列印選取 QR Code</button></div><div class="table-wrap"><table><thead><tr><th>選取</th><th>社區</th><th>類型</th><th>名稱</th><th>位置</th><th>GPS</th><th>半徑</th><th>狀態</th><th>QR</th><th>操作</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.location_type==='patrol'?`<input type="checkbox" class="att-row-check" data-id="${r.id}">`:'—'}</td><td>${esc((cache.communities.find(c=>c.id===r.community_id)||{}).name||'')}</td><td>${typeName(r.location_type)}</td><td>${esc(r.name)}</td><td>${esc(r.address||'未設定')}</td><td>${r.lat!=null&&r.lng!=null?`${Number(r.lat).toFixed(6)}, ${Number(r.lng).toFixed(6)}`:'未設定'}</td><td>${r.location_type==='attendance'?`${r.radius_m} m`:'—'}</td><td>${r.is_active?'<span class="tag success">啟用</span>':'<span class="tag">停用</span>'}</td><td>${r.location_type==='patrol'?`<button class="secondary attendance-print" data-id="${r.id}">列印 QR</button>`:'—'}</td><td><button class="secondary attendance-edit" data-id="${r.id}">編輯</button> ${r.location_type==='patrol'?`<button class="secondary attendance-regenerate" data-id="${r.id}">換 QR</button>`:''} <button class="danger attendance-delete" data-id="${r.id}">${r.is_active?'刪除':'永久刪除'}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function selectedIds(box){return [...box.querySelectorAll('.att-row-check:checked')].map(x=>Number(x.dataset.id)).filter(Boolean)}
  function bindBatch(box){
    const all=box.querySelector('#attSelectAll');
    const count=box.querySelector('#attSelectedCount');
    const update=()=>{const checks=[...box.querySelectorAll('.att-row-check')];const n=checks.filter(x=>x.checked).length;if(count)count.textContent=`已選 ${n} 個`;if(all){all.checked=checks.length>0&&n===checks.length;all.indeterminate=n>0&&n<checks.length}};
    if(all)all.addEventListener('change',()=>{box.querySelectorAll('.att-row-check').forEach(x=>x.checked=all.checked);update()});
    box.querySelectorAll('.att-row-check').forEach(x=>x.addEventListener('change',update));
    const batch=box.querySelector('#attBatchPrint');
    if(batch)batch.addEventListener('click',()=>{const ids=selectedIds(box);if(!ids.length){alert('請先選取要列印的巡邏點。');return;}printBatch(ids)});
    update();
  }
  function workspace(){
    const el=document.querySelector('#companyWorkspace');
    if(!el) throw new Error('找不到公司工作頁面。');
    ['overview','staff','communities','submissions','templates'].forEach(id=>{const x=document.querySelector('#tab-'+id);if(x)x.style.display='none';});
    el.style.display='block';
    return el;
  }
  function pageShell(title,desc,body){
    return `<div class="attendance-workpage"><div class="attendance-page-head"><div><h1>${title}</h1><p class="hint">${desc}</p></div></div>${body}</div>`;
  }
  function communityPicker(id='attendanceCommunityPick',selected=''){
    return `<label>社區</label><select id="${id}"><option value="">請先選擇社區</option>${communityOptions(selected)}</select>`;
  }
  function renderLocationsList(filterType,communityId){
    const rows=(cache.locations||[]).filter(x=>String(x.community_id)===String(communityId)&&(!filterType||x.location_type===filterType));
    if(!rows.length)return `<div class="attendance-empty-state"><div class="empty-icon">📍</div><h3>目前尚未建立${filterType==='patrol'?'巡邏點':filterType==='attendance'?'出勤打卡點':'地點'}</h3><p>這個社區目前沒有資料，可以從下方按鈕開始新增。</p><button type="button" id="attEmptyAdd">＋ 新增${filterType==='patrol'?'巡邏點':filterType==='attendance'?'出勤打卡點':'地點'}</button></div>`;
    return `<div class="attendance-list-head"><div><strong>目前 ${rows.length} 個${filterType==='patrol'?'巡邏點':filterType==='attendance'?'出勤打卡點':'地點'}</strong><span class="hint">　選取巡邏點後可一次列印 QR Code</span></div><div class="attendance-list-actions">${filterType!=='attendance'?'<label class="inline-check"><input type="checkbox" id="attSelectAll"> 全選</label><span id="attSelectedCount">已選 0 個</span><button type="button" class="secondary" id="attBatchPrint">🖨️ 列印選取 QR Code</button>':''}<button type="button" id="attAddFromList">＋ 新增地點</button></div></div><div class="table-wrap"><table><thead><tr>${filterType!=='attendance'?'<th>選取</th>':''}<th>名稱</th><th>位置</th><th>類型</th><th>狀態</th><th>備註</th><th>操作</th></tr></thead><tbody>${rows.map(r=>`<tr>${filterType!=='attendance'?`<td>${r.location_type==='patrol'?`<input type="checkbox" class="att-row-check" data-id="${r.id}">`:'—'}</td>`:''}<td><strong>${esc(r.name)}</strong><div class="muted">${esc((cache.communities.find(c=>c.id===r.community_id)||{}).name||'')}</div></td><td>📍 ${esc(r.address||'未設定')}</td><td>${r.location_type==='patrol'?'<span class="tag purple">🚨 巡邏點</span>':'<span class="tag success">📍 出勤打卡點</span>'}</td><td>${r.is_active?'<span class="tag success">啟用</span>':'<span class="tag">停用</span>'}</td><td>${r.location_type==='attendance'?`有效範圍 ${Number(r.radius_m||0)} 公尺`:'QR Code 已建立'}</td><td><button class="secondary attendance-edit" data-id="${r.id}">編輯</button> ${r.location_type==='patrol'?`<button class="secondary attendance-print" data-id="${r.id}">列印 QR</button>`:''}<button class="danger attendance-delete" data-id="${r.id}">${r.is_active?'刪除':'永久刪除'}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderLocationEditor(box,communityId,type='patrol',existing=null){
    const r=existing||{};
    box.innerHTML=pageShell(`${existing?'✏️ 編輯':'＋ 新增'}${type==='patrol'?'巡邏點':'出勤打卡點'}`,`先設定基本資料，再選擇 Google 地圖位置。${type==='patrol'?'巡邏以 QR Code 為主要驗證方式。':'出勤打卡使用 GPS 判斷是否在有效範圍內。'}`,`<div class="attendance-form-card"><div class="attendance-form-columns"><section><div class="form-section-title">① 基本資料</div><div class="field-stack"><div><label>社區</label><select id="attCommunityEdit">${communityOptions(communityId||r.community_id||'')}</select></div><div><label>地點類型</label><div class="attendance-type-choice"><button type="button" class="${type==='attendance'?'selected':''}" data-type="attendance">📍 出勤打卡點</button><button type="button" class="${type==='patrol'?'selected':''}" data-type="patrol">🚨 巡邏點</button></div></div><div><label>地點名稱</label><input id="attName" value="${esc(r.name||'')}" placeholder="例如：社區大門／B1 機房" required></div></div></section><section><div class="form-section-title">② 地點位置</div><label>Google 地圖搜尋</label><div class="attendance-place-search"><input id="attPlaceQuery" placeholder="輸入社區、地址或地點名稱"><button type="button" class="secondary" id="attPlaceSearch">🔎 搜尋</button></div><div id="attPlaceResults" class="attendance-place-results"></div><div class="selected-place-box" id="attSelectedPlace">${r.address?`<strong>📍 目前位置</strong><div>${esc(r.address)}</div>`:'尚未選擇位置'}</div><details class="advanced-location"><summary>進階位置資訊（地址／緯度／經度）</summary><div class="three-fields"><div><label>地址／位置說明</label><input id="attAddress" value="${esc(r.address||'')}" placeholder="可由 Google 地圖搜尋帶入"></div><div><label>緯度</label><input id="attLat" value="${r.lat??''}" placeholder="自動帶入"></div><div><label>經度</label><input id="attLng" value="${r.lng??''}" placeholder="自動帶入"></div></div></details><button type="button" class="secondary" id="attUseGps">📍 使用目前位置取得 GPS</button><span id="attGpsHint" class="hint-inline"></span></section><section><div class="form-section-title">③ ${type==='patrol'?'巡邏設定':'出勤打卡設定'}</div>${type==='attendance'?`<div><label>有效範圍（公尺）</label><input id="attRadius" type="number" min="5" max="1000" value="${Number(r.radius_m||cache.rules?.default_checkin_radius_m||100)}"><p class="hint">人員必須在此範圍內才可完成出勤打卡。</p></div>`:`<div class="info-box purple"><strong>🚨 巡邏使用 QR Code</strong><p>建立後系統會自動產生專屬 QR Code，現場人員掃描後完成巡邏紀錄。</p></div><div><label>位置說明</label><input id="attPatrolNote" value="${esc(r.address||'')}" placeholder="例如：B1 停車場入口右側、機房鐵門旁"></div>`}</section></div><div class="form-actions"><button type="button" class="secondary" id="attCancel">取消</button><button type="button" id="attSave">${existing?'💾 儲存':'＋ 建立地點'}</button></div></div>`);
    let currentType=type;
    const selectedBox=box.querySelector('#attSelectedPlace');
    box.querySelectorAll('.attendance-type-choice button').forEach(b=>b.addEventListener('click',()=>{currentType=b.dataset.type;box.querySelectorAll('.attendance-type-choice button').forEach(x=>x.classList.toggle('selected',x===b));renderLocationEditor(box,communityId,currentType,existing)}));
    box.querySelector('#attCancel').addEventListener('click',()=>renderLocationCommunityPage(box,communityId,currentType));
    box.querySelector('#attUseGps').addEventListener('click',()=>navigator.geolocation?.getCurrentPosition(pos=>{box.querySelector('#attLat').value=pos.coords.latitude.toFixed(7);box.querySelector('#attLng').value=pos.coords.longitude.toFixed(7);selectedBox.innerHTML='<strong>📍 已使用目前位置</strong><div>座標已帶入，可在進階位置資訊查看。</div>';box.querySelector('#attGpsHint').textContent=`精度約 ${Math.round(pos.coords.accuracy||0)} 公尺`},err=>alert(`無法取得目前位置：${err.message}`),{enableHighAccuracy:true,timeout:10000,maximumAge:0}));
    box.querySelector('#attPlaceSearch').addEventListener('click',async()=>{const term=box.querySelector('#attPlaceQuery').value.trim();if(!term){alert('請先輸入地點或地址。');return;}const rb=box.querySelector('#attPlaceResults');rb.innerHTML='<div class="profile-loading">搜尋中…</div>';try{const d=await api(`/api/company/attendance/place-search?q=${encodeURIComponent(term)}`);if(!d.configured){rb.innerHTML='<div class="msg warning">尚未設定 Google Maps API Key；也可以先使用「目前位置」取得 GPS。</div>';return;}if(!d.places?.length){rb.innerHTML='<div class="empty">找不到符合的地點，請換關鍵字。</div>';return;}rb.innerHTML=d.places.map((p,i)=>`<button type="button" class="attendance-place-item" data-i="${i}"><strong>${esc(p.name||'未命名地點')}</strong><span>${esc(p.address||'')}</span></button>`).join('');rb.querySelectorAll('.attendance-place-item').forEach(btn=>btn.addEventListener('click',()=>{const p=d.places[Number(btn.dataset.i)];box.querySelector('#attLat').value=Number(p.lat).toFixed(7);box.querySelector('#attLng').value=Number(p.lng).toFixed(7);box.querySelector('#attAddress').value=p.address||'';if(!box.querySelector('#attName').value.trim())box.querySelector('#attName').value=p.name||'';selectedBox.innerHTML=`<strong>📍 已選擇位置</strong><div>${esc(p.address||p.name||'')}</div>`;rb.innerHTML=''}));}catch(e){rb.innerHTML=`<div class="msg error">${esc(e.message)}</div>`}});
    box.querySelector('#attSave').addEventListener('click',async()=>{try{const address=(box.querySelector('#attAddress')?.value||box.querySelector('#attPatrolNote')?.value||'').trim();const body={community_id:Number(box.querySelector('#attCommunityEdit').value),location_type:currentType,name:box.querySelector('#attName').value.trim(),radius_m:Number(box.querySelector('#attRadius')?.value||cache.rules?.default_checkin_radius_m||100),lat:box.querySelector('#attLat').value,lng:box.querySelector('#attLng').value,address};if(!body.name)throw new Error('請輸入地點名稱');const url=existing?`/api/company/attendance/locations/${existing.id}`:'/api/company/attendance/locations';const d=await api(url,{method:existing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});cache.locations=existing?cache.locations.map(x=>x.id===existing.id?d.location:x).concat([]):cache.locations.concat(d.location);alert(existing?'地點已更新。':'地點已建立。');renderLocationCommunityPage(box,body.community_id,currentType)}catch(e){alert(e.message)}});
  }
  function renderLocationCommunityPage(box,communityId,type='patrol'){
    const c=cache.communities.find(x=>String(x.id)===String(communityId));
    box.innerHTML=pageShell(`📍 ${esc(c?.name||'打卡／巡邏點')}`,'先查看這個社區目前的打卡與巡邏點；沒有資料時，再建立第一個地點。',`<div class="attendance-community-toolbar"><div><label>社區</label><select id="attCommunityView">${communityOptions(communityId)}</select></div><div class="attendance-type-tabs"><button type="button" class="${type==='attendance'?'active':''}" data-t="attendance">📍 出勤打卡點</button><button type="button" class="${type==='patrol'?'active':''}" data-t="patrol">🚨 巡邏點</button></div></div><div id="attLocationList">${renderLocationsList(type,communityId)}</div>`);
    box.querySelector('#attCommunityView').addEventListener('change',e=>renderLocationCommunityPage(box,e.target.value,type));
    box.querySelectorAll('.attendance-type-tabs button').forEach(b=>b.addEventListener('click',()=>renderLocationCommunityPage(box,communityId,b.dataset.t)));
    const add=box.querySelector('#attAddFromList')||box.querySelector('#attEmptyAdd');if(add)add.addEventListener('click',()=>renderLocationEditor(box,communityId,type));
    bindBatch(box);bindRowActions(box);
  }
  function renderLocationsPage(){
    const box=workspace();
    box.innerHTML=pageShell('📍 打卡／巡邏點','先選擇社區，再查看目前的打卡點與巡邏點。這樣畫面會更單純，也比較適合日常操作。',`<div class="attendance-community-select-card"><div class="form-section-title">請先選擇社區</div><div class="attendance-community-select-row">${communityPicker()}<button type="button" id="attEnterCommunity">進入管理</button></div></div>`);
    const go=()=>{const cid=box.querySelector('#attendanceCommunityPick').value;if(!cid){alert('請先選擇社區。');return;}renderLocationCommunityPage(box,cid,'patrol')};
    box.querySelector('#attEnterCommunity').addEventListener('click',go);box.querySelector('#attendanceCommunityPick').addEventListener('change',e=>{if(e.target.value)go()});
  }
  function bindRowActions(box){
    box.querySelectorAll('.attendance-edit').forEach(btn=>btn.addEventListener('click',()=>editLocation(box,Number(btn.dataset.id))));
    box.querySelectorAll('.attendance-regenerate').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('換 QR 後，舊 QR 將失效。確定要換嗎？'))return;try{const d=await api(`/api/company/attendance/locations/${btn.dataset.id}/regenerate-qr`,{method:'POST'});cache.locations=cache.locations.map(x=>x.id===d.location.id?d.location:x);alert('QR 已更新，請重新列印。');renderLocationCommunityPage(box,r.community_id,r.location_type)}catch(e){alert(e.message)}}));
    box.querySelectorAll('.attendance-print').forEach(btn=>btn.addEventListener('click',()=>printQr(Number(btn.dataset.id))));
    box.querySelectorAll('.attendance-delete').forEach(btn=>btn.addEventListener('click',async()=>{
      const r=cache.locations.find(x=>x.id===Number(btn.dataset.id)); if(!r)return;
      const action=r.is_active?'刪除':'永久刪除';
      const msg=r.is_active
        ? `確定要${action}「${r.name}」嗎？\n\n若此地點已有歷史出勤／巡邏紀錄，系統會自動改為「停用」並保留歷史紀錄；沒有歷史紀錄才會真正刪除。`
        : `確定要永久刪除「${r.name}」嗎？\n\n此操作僅適用於沒有歷史紀錄的地點。`;
      if(!confirm(msg))return;
      try{const d=await api(`/api/company/attendance/locations/${r.id}`,{method:'DELETE'});cache=await api('/api/company/attendance/bootstrap');alert(d.message||'處理完成。');if(d.action==='deleted')cache.locations=cache.locations.filter(x=>x.id!==r.id);else cache.locations=cache.locations.map(x=>x.id===r.id?{...x,is_active:false}:x);renderLocationCommunityPage(box,r.community_id,r.location_type);}catch(e){alert(e.message)}}));
  }
  async function editLocation(parent,id){
    const r=cache.locations.find(x=>x.id===id);if(!r)return;
    renderLocationEditor(parent,r.community_id,r.location_type,r);
  }
  function qrCardHtml(r,c){return `<div class="qr-card"><div class="qr-community">${esc(c.name||'')}</div><div class="qr-title">🚨 ${esc(r.name)}</div><img src="${qrUrl(r.qr_token,360)}" alt="QR Code"><div class="qr-desc">請使用物業管理系統掃描此 QR Code 完成巡邏。</div><div class="qr-location">位置：${esc(r.address||r.name||'')}</div></div>`}
  function printQr(id){printBatch([id])}
  function printBatch(ids){
    const rows=ids.map(id=>cache.locations.find(x=>x.id===id)).filter(r=>r&&r.location_type==='patrol');
    if(!rows.length)return;
    const w=window.open('','_blank','width=900,height=1000');
    if(!w){alert('瀏覽器阻擋了列印視窗，請允許此網站開啟新視窗。');return;}
    const cardArray=rows.map(r=>{const c=cache.communities.find(x=>x.id===r.community_id)||{};return qrCardHtml(r,c)});
    const sheets=[];
    for(let i=0;i<cardArray.length;i+=12)sheets.push(`<div class="sheet">${cardArray.slice(i,i+12).join('')}</div>`);
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>巡邏 QR Code 批次列印</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,'Microsoft JhengHei',sans-serif;background:#fff}.sheet{width:210mm;height:297mm;display:grid;grid-template-columns:repeat(3,50mm);grid-template-rows:repeat(4,70mm);align-content:center;justify-content:center;page-break-after:always}.qr-card{width:50mm;height:70mm;border:0.35mm solid #222;border-radius:3mm;padding:3mm 2.5mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;overflow:hidden}.qr-community{font-size:3.4mm;color:#666;line-height:1.1;margin-bottom:1mm;white-space:nowrap;max-width:45mm;overflow:hidden;text-overflow:ellipsis}.qr-title{font-size:5mm;font-weight:700;line-height:1.15;height:7mm;white-space:nowrap;max-width:45mm;overflow:hidden;text-overflow:ellipsis;margin-bottom:1mm}.qr-card img{width:35mm;height:35mm;display:block;margin:0 auto 1.5mm}.qr-desc{font-size:2.7mm;line-height:1.25}.qr-location{font-size:2.6mm;line-height:1.2;margin-top:1mm;max-height:7mm;overflow:hidden}@media print{.no-print{display:none}}</style></head><body>${sheets.join('')}</body></html>`);
    w.document.close();w.focus();setTimeout(()=>w.print(),500);
  }

  function fmtDate(v){try{return new Date(v).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return v||''}}
  function isoToday(){return new Date().toISOString().slice(0,10)}
  async function fetchRecords(cid,from='',to='',type=''){
    const q=new URLSearchParams({community_id:String(cid||'')});if(from)q.set('from',from);if(to)q.set('to',to);if(type)q.set('record_type',type);return api(`/api/company/attendance/records?${q.toString()}`)
  }
  async function fetchSchedules(cid,month){
    const cats=['admin','security','mobile'];const all=[];for(const category of cats){try{const d=await api(`/api/company/schedule/month?month=${encodeURIComponent(month)}&category=${category}&community_id=${encodeURIComponent(cid)}`);all.push(...(d.entries||[]))}catch(e){/* 沒有班表權限時仍可查看打卡紀錄 */}}return all;
  }
  function statusTag(status){const map={normal:'<span class="tag success">正常</span>',late:'<span class="tag warning">遲到</span>',missing:'<span class="tag danger">未打卡</span>',off:'<span class="tag">休假／未排班</span>'};return map[status]||'<span class="tag">—</span>'}
  function todayDate(){const d=new Date();const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
  async function renderAttendanceToday(box,cid){
    const date=todayDate();
    const month=date.slice(0,7);
    box.querySelector('#attTodayBody').innerHTML='<div class="profile-loading">正在依班表整理今日出勤…</div>';
    try{
      const [sched,rec]=await Promise.all([fetchSchedules(cid,month),fetchRecords(cid,date,date,'')]);
      const entries=sched.filter(x=>x.work_date===date&&x.shift_code!=='off'&&x.status!=='cancelled');
      const records=rec.rows||[];
      const byStaff=new Map();
      records.forEach(r=>{
        const id=Number(r.staff_id);const a=byStaff.get(id)||{checkin:null,checkout:null};
        if(r.record_type==='checkin'&&!a.checkin)a.checkin=r;
        if(r.record_type==='checkout'&&!a.checkout)a.checkout=r;
        byStaff.set(id,a);
      });
      const rows=entries.map(e=>{
        const a=byStaff.get(Number(e.staff_id))||{};
        return {...e,actual:a.checkin,checkout:a.checkout,status:a.checkin?'normal':'missing'};
      });
      const missing=rows.filter(x=>x.status==='missing').length;
      const normal=rows.length-missing;
      const table=rows.length?`<div class="table-wrap"><table><thead><tr><th>人員</th><th>班別</th><th>應到</th><th>實際打卡</th><th>下班</th><th>狀態</th></tr></thead><tbody>${rows.map(r=>{
        const shift=r.shift_code==='day'?'日班':r.shift_code==='night'?'夜班':r.shift_code==='training'?'訓練':'工作';
        return `<tr><td><strong>${esc(r.staff_name)}</strong><div class="muted">${esc(r.employee_id||'')}</div></td><td>${shift}</td><td>${esc(r.work_date)}</td><td>${r.actual?fmtDate(r.actual.recorded_at):'—'}</td><td>${r.checkout?fmtDate(r.checkout.recorded_at):'—'}</td><td>${statusTag(r.status)}</td></tr>`;
      }).join('')}</tbody></table></div>`:'<div class="attendance-empty-state compact"><div class="empty-icon">📋</div><h3>今天沒有排班資料</h3><p>請先確認這個社區的班表。</p></div>';
      box.querySelector('#attTodayBody').innerHTML=`<div class="attendance-summary"><div><strong>${rows.length}</strong><span>今日應到</span></div><div><strong>${normal}</strong><span>已正常打卡</span></div><div class="danger-card"><strong>${missing}</strong><span>尚未打卡</span></div></div>${table}`;
    }catch(e){box.querySelector('#attTodayBody').innerHTML=`<div class="msg error">${esc(e.message)}</div>`}
  }
  async function renderAttendanceHistory(box,cid){const from=box.querySelector('#attFrom').value,to=box.querySelector('#attTo').value;box.querySelector('#attHistoryBody').innerHTML='<div class="profile-loading">查詢中…</div>';try{const d=await fetchRecords(cid,from,to,'');const rows=d.rows||[];box.querySelector('#attHistoryBody').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>類型</th><th>地點</th><th>來源</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmtDate(r.recorded_at)}</td><td><strong>${esc(r.staff_name)}</strong><div class="muted">${esc(r.employee_id||'')}</div></td><td>${r.record_type==='checkin'?'上班':r.record_type==='checkout'?'下班':'巡邏'}</td><td>${esc(r.location_name||'—')}</td><td>${r.source==='offline'?'<span class="tag">離線同步</span>':'<span class="tag success">即時</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">查無符合條件的出勤紀錄。</div>'}catch(e){box.querySelector('#attHistoryBody').innerHTML=`<div class="msg error">${esc(e.message)}</div>`}}
  function renderAttendancePage(){const box=workspace();box.innerHTML=pageShell('📋 出勤紀錄','先選擇社區，先看今天是否有人漏打卡，再用日期區間查詢歷史出勤。出勤狀況會優先依班表判斷。',`<div class="attendance-community-select-card"><div class="form-section-title">請先選擇社區</div>${communityPicker('attAttendanceCommunity')}</div><div id="attAttendanceArea" style="display:none"><div class="attendance-subtabs"><button class="active" data-tab="today">今日出勤狀況</button><button data-tab="history">出勤紀錄</button></div><section id="attTodayPanel"><div class="section-title">📅 今日出勤</div><div id="attTodayBody"></div></section><section id="attHistoryPanel" style="display:none"><div class="attendance-searchbar"><div><label>開始日期</label><input id="attFrom" type="date" value="${todayDate()}"></div><div><label>結束日期</label><input id="attTo" type="date" value="${todayDate()}"></div><button id="attHistorySearch">🔎 搜尋</button></div><div id="attHistoryBody"></div></section></div>`);const sel=box.querySelector('#attAttendanceCommunity');const open=async()=>{if(!sel.value)return;box.querySelector('#attAttendanceArea').style.display='block';await renderAttendanceToday(box,sel.value)};sel.addEventListener('change',open);box.querySelectorAll('.attendance-subtabs button').forEach(b=>b.addEventListener('click',async()=>{box.querySelectorAll('.attendance-subtabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const today=b.dataset.tab==='today';box.querySelector('#attTodayPanel').style.display=today?'block':'none';box.querySelector('#attHistoryPanel').style.display=today?'none':'block';if(!today&&sel.value)await renderAttendanceHistory(box,sel.value)}));box.querySelector('#attHistorySearch').addEventListener('click',()=>{if(sel.value)renderAttendanceHistory(box,sel.value)});}
  async function renderPatrolToday(box,cid){
    const date=todayDate();
    box.querySelector('#patrolTodayBody').innerHTML='<div class="profile-loading">整理今日巡邏狀況…</div>';
    try{
      const [rec,sched]=await Promise.all([fetchRecords(cid,date,date,'patrol'),fetchSchedules(cid,date.slice(0,7))]);
      const locations=cache.locations.filter(x=>Number(x.community_id)===Number(cid)&&x.location_type==='patrol'&&x.is_active);
      const entries=sched.filter(x=>x.work_date===date&&x.shift_code!=='off');
      const byStaff=new Map();
      (rec.rows||[]).forEach(r=>{const a=byStaff.get(Number(r.staff_id))||[];a.push(r);byStaff.set(Number(r.staff_id),a)});
      const total=entries.length*locations.length,done=rec.rows?.length||0;
      const people=entries.map(e=>{
        const arr=byStaff.get(Number(e.staff_id))||[];
        const shift=e.shift_code==='night'?'夜班':e.shift_code==='day'?'日班':'工作';
        const points=locations.map(l=>{const hit=arr.find(r=>Number(r.location_id)===Number(l.id));return `<span class="patrol-point ${hit?'done':'pending'}" title="${esc(l.name)}">${hit?'✓':'○'} ${esc(l.name)}</span>`}).join('');
        return `<div class="patrol-person-card"><div><strong>${esc(e.staff_name)}</strong><span class="muted">${esc(e.employee_id||'')}｜${shift}</span></div><div class="patrol-progress">${points}</div></div>`;
      }).join('');
      box.querySelector('#patrolTodayBody').innerHTML=`<div class="attendance-summary"><div><strong>${entries.length}</strong><span>今日巡邏人員</span></div><div><strong>${done}</strong><span>今日已掃 QR</span></div><div><strong>${locations.length}</strong><span>巡邏點</span></div><div><strong>${total?Math.min(100,Math.round(done/total*100)):0}%</strong><span>目前完成率</span></div></div>${people||'<div class="attendance-empty-state compact"><div class="empty-icon">🚨</div><h3>今天沒有排班資料</h3><p>請先確認這個社區的班表。</p></div>'}`;
    }catch(e){box.querySelector('#patrolTodayBody').innerHTML=`<div class="msg error">${esc(e.message)}</div>`}
  }
  async function renderPatrolHistory(box,cid){const from=box.querySelector('#patrolFrom').value,to=box.querySelector('#patrolTo').value,person=box.querySelector('#patrolPerson')?.value||'',point=box.querySelector('#patrolPoint')?.value||'';box.querySelector('#patrolHistoryBody').innerHTML='<div class="profile-loading">查詢中…</div>';try{const d=await fetchRecords(cid,from,to,'patrol');let rows=d.rows||[];if(person)rows=rows.filter(r=>String(r.staff_id)===person);if(point)rows=rows.filter(r=>String(r.location_id)===point);box.querySelector('#patrolHistoryBody').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>巡邏點</th><th>來源</th><th>狀態</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmtDate(r.recorded_at)}</td><td><strong>${esc(r.staff_name)}</strong><div class="muted">${esc(r.employee_id||'')}</div></td><td>🚨 ${esc(r.location_name||'—')}</td><td>${r.source==='offline'?'<span class="tag">離線同步</span>':'<span class="tag success">即時</span>'}</td><td><span class="tag success">完成</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">查無符合條件的巡邏紀錄。</div>'}catch(e){box.querySelector('#patrolHistoryBody').innerHTML=`<div class="msg error">${esc(e.message)}</div>`}}
  function renderPatrolPage(){const box=workspace();box.innerHTML=pageShell('🚨 巡邏紀錄','先選擇社區，先看今天的巡邏狀況；需要追查時，再使用巡邏紀錄與日期區間搜尋。',`<div class="attendance-community-select-card"><div class="form-section-title">請先選擇社區</div>${communityPicker('attPatrolCommunity')}</div><div id="attPatrolArea" style="display:none"><div class="attendance-subtabs"><button class="active" data-tab="today">今日巡邏狀況</button><button data-tab="history">巡邏紀錄</button></div><section id="patrolTodayPanel"><div class="section-title">📅 今日巡邏</div><div id="patrolTodayBody"></div></section><section id="patrolHistoryPanel" style="display:none"><div class="attendance-searchbar"><div><label>開始日期</label><input id="patrolFrom" type="date" value="${todayDate()}"></div><div><label>結束日期</label><input id="patrolTo" type="date" value="${todayDate()}"></div><div><label>巡邏人員</label><select id="patrolPerson"><option value="">全部人員</option></select></div><div><label>巡邏點</label><select id="patrolPoint"><option value="">全部巡邏點</option></select></div><button id="patrolHistorySearch">🔎 搜尋</button></div><div id="patrolHistoryBody"></div></section></div>`);const sel=box.querySelector('#attPatrolCommunity');const open=async()=>{if(!sel.value)return;box.querySelector('#attPatrolArea').style.display='block';const cid=sel.value;const people=cache.locations;const psel=box.querySelector('#patrolPerson');const staffNames=new Map();try{const d=await api('/api/company/schedule/staff');(d.staff||[]).filter(s=>s.site_assignments?.some(a=>Number(a.community_id)===Number(cid))).forEach(s=>staffNames.set(s.id,s));}catch{}psel.innerHTML='<option value="">全部人員</option>'+[...staffNames.values()].map(s=>`<option value="${s.id}">${esc(s.name)}${s.employee_id?'｜'+esc(s.employee_id):''}</option>`).join('');box.querySelector('#patrolPoint').innerHTML='<option value="">全部巡邏點</option>'+cache.locations.filter(x=>Number(x.community_id)===Number(cid)&&x.location_type==='patrol').map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');await renderPatrolToday(box,cid)};sel.addEventListener('change',open);box.querySelectorAll('.attendance-subtabs button').forEach(b=>b.addEventListener('click',async()=>{box.querySelectorAll('.attendance-subtabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const today=b.dataset.tab==='today';box.querySelector('#patrolTodayPanel').style.display=today?'block':'none';box.querySelector('#patrolHistoryPanel').style.display=today?'none':'block';if(!today&&sel.value)await renderPatrolHistory(box,sel.value)}));box.querySelector('#patrolHistorySearch').addEventListener('click',()=>{if(sel.value)renderPatrolHistory(box,sel.value)});}

  A.render=async function(action,label){await load();if(action==='patrol-records')return renderPatrolPage();if(action==='attendance-records')return renderAttendancePage();return renderLocationsPage();};
})();
