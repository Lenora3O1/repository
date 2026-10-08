(function(){
  const A=window.AttendanceCompanyModule={};
  const q=s=>document.querySelector(s);
  const esc=s=>window.escapeHtml?window.escapeHtml(s):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  let cache={rules:{},communities:[],locations:[]};
  function qrUrl(token,size=420){return `https://quickchart.io/qr?text=${encodeURIComponent(token)}&size=${size}&margin=2`;}
  let googlePlacesPromise=null;
  async function loadGooglePlaces(){
    if(googlePlacesPromise)return googlePlacesPromise;
    googlePlacesPromise=(async()=>{
      const cfg=await api('/api/company/attendance/maps-config');
      if(!cfg.configured||!cfg.key)throw new Error('尚未設定 Google Maps API Key，請先到 Zeabur 環境變數設定 GOOGLE_MAPS_API_KEY。');
      if(!window.google?.maps){
        await new Promise((resolve,reject)=>{
          const existing=document.querySelector('script[data-google-maps-loader]');
          if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('Google Maps 載入失敗，請檢查 API 限制與網域設定。')),{once:true});return;}
          const script=document.createElement('script');
          script.dataset.googleMapsLoader='1';
          script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.key)}&v=weekly&loading=async`;
          script.async=true;script.defer=true;
          script.onload=resolve;
          script.onerror=()=>reject(new Error('Google Maps 載入失敗，請檢查 Maps JavaScript API 是否已啟用，以及網站限制是否包含 https://handover.zeabur.app/*。'));
          document.head.appendChild(script);
        });
      }
      await google.maps.importLibrary('places');
      return true;
    })().catch(err=>{googlePlacesPromise=null;throw err;});
    return googlePlacesPromise;
  }
  function placeLatLng(location){
    if(!location)return {lat:null,lng:null};
    const lat=typeof location.lat==='function'?location.lat():location.lat;
    const lng=typeof location.lng==='function'?location.lng():location.lng;
    return {lat:Number.isFinite(Number(lat))?Number(lat):null,lng:Number.isFinite(Number(lng))?Number(lng):null};
  }
  async function setupGooglePlaceAutocomplete(box){
    const host=box.querySelector('#attPlaceAutocomplete');
    const status=box.querySelector('#attPlaceSearchStatus');
    if(!host)return;
    try{
      if(status)status.textContent='正在載入 Google 地圖搜尋…';
      await loadGooglePlaces();
      const {PlaceAutocompleteElement}=await google.maps.importLibrary('places');
      const autocomplete=new PlaceAutocompleteElement();
      autocomplete.placeholder='輸入社區、地址或地點名稱';
      autocomplete.includedRegionCodes=['tw'];
      host.replaceChildren(autocomplete);
      autocomplete.addEventListener('gmp-select',async({placePrediction})=>{
        try{
          if(status)status.textContent='正在取得地點座標…';
          const place=placePrediction.toPlace();
          await place.fetchFields({fields:['id','displayName','formattedAddress','location']});
          const pos=placeLatLng(place.location);
          if(pos.lat===null||pos.lng===null)throw new Error('這個地點沒有可用的座標，請選擇其他搜尋結果。');
          box.querySelector('#attLat').value=pos.lat.toFixed(7);
          box.querySelector('#attLng').value=pos.lng.toFixed(7);
          box.querySelector('#attAddress').value=place.formattedAddress||'';
          if(!box.querySelector('#attName').value.trim())box.querySelector('#attName').value=place.displayName||'';
          const selectedBox=box.querySelector('#attSelectedPlace');
          if(selectedBox)selectedBox.innerHTML=`<strong>📍 已選擇位置</strong><div>${esc(place.formattedAddress||place.displayName||'')}</div><div class="muted">座標：${pos.lat.toFixed(7)}, ${pos.lng.toFixed(7)}</div>`;
          box.dataset.googlePlaceId=place.id||'';
          if(status)status.textContent='✓ 已選擇 Google 地點，可直接儲存。';
        }catch(e){if(status)status.textContent=e.message||'無法取得地點資料。';}
      });
      if(status)status.textContent='輸入後請從 Google 下拉選單選擇正確地點。';
    }catch(e){
      if(status)status.innerHTML=`<span class="msg error inline-msg">${esc(e.message||'Google 地圖搜尋載入失敗。')}</span>`;
    }
  }
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
    box.innerHTML=pageShell(`${existing?'✏️ 編輯':'＋ 新增'}${type==='patrol'?'巡邏點':'出勤打卡點'}`,`先設定基本資料，再選擇 Google 地圖位置。${type==='patrol'?'巡邏以 QR Code 為主要驗證方式。':'出勤打卡使用 GPS 判斷是否在有效範圍內。'}`,`<div class="attendance-form-card"><div class="attendance-form-columns"><section><div class="form-section-title">① 基本資料</div><div class="field-stack"><div><label>社區</label><select id="attCommunityEdit">${communityOptions(communityId||r.community_id||'')}</select></div><div><label>地點類型</label><div class="attendance-type-choice"><button type="button" class="${type==='attendance'?'selected':''}" data-type="attendance">📍 出勤打卡點</button><button type="button" class="${type==='patrol'?'selected':''}" data-type="patrol">🚨 巡邏點</button></div></div><div><label>地點名稱</label><input id="attName" value="${esc(r.name||'')}" placeholder="例如：社區大門／B1 機房" required></div></div></section><section><div class="form-section-title">② 地點位置</div><label>Google 地圖搜尋</label><div id="attPlaceAutocomplete" class="attendance-place-autocomplete"></div><div id="attPlaceSearchStatus" class="hint-inline">準備載入 Google 地圖搜尋…</div><div class="selected-place-box" id="attSelectedPlace">${r.address?`<strong>📍 目前位置</strong><div>${esc(r.address)}</div>${r.lat!=null&&r.lng!=null?`<div class="muted">座標：${Number(r.lat).toFixed(7)}, ${Number(r.lng).toFixed(7)}</div>`:''}`:'尚未選擇位置'}</div><details class="advanced-location"><summary>進階位置資訊（地址／緯度／經度）</summary><div class="three-fields"><div><label>地址／位置說明</label><input id="attAddress" value="${esc(r.address||'')}" placeholder="可由 Google 地圖搜尋帶入"></div><div><label>緯度</label><input id="attLat" value="${r.lat??''}" placeholder="自動帶入"></div><div><label>經度</label><input id="attLng" value="${r.lng??''}" placeholder="自動帶入"></div></div></details><button type="button" class="secondary" id="attUseGps">📍 使用目前位置取得 GPS</button><span id="attGpsHint" class="hint-inline"></span></section><section><div class="form-section-title">③ ${type==='patrol'?'巡邏設定':'出勤打卡設定'}</div>${type==='attendance'?`<div><label>有效範圍（公尺）</label><input id="attRadius" type="number" min="5" max="1000" value="${Number(r.radius_m||cache.rules?.default_checkin_radius_m||100)}"><p class="hint">人員必須在此範圍內才可完成出勤打卡。</p></div>`:`<div class="info-box purple"><strong>🚨 巡邏使用 QR Code</strong><p>建立後系統會自動產生專屬 QR Code，現場人員掃描後完成巡邏紀錄。</p></div><div><label>位置說明</label><input id="attPatrolNote" value="${esc(r.address||'')}" placeholder="例如：B1 停車場入口右側、機房鐵門旁"></div>`}</section></div><div class="form-actions"><button type="button" class="secondary" id="attCancel">取消</button><button type="button" id="attSave">${existing?'💾 儲存':'＋ 建立地點'}</button></div></div>`);
    let currentType=type;
    const selectedBox=box.querySelector('#attSelectedPlace');
    box.querySelectorAll('.attendance-type-choice button').forEach(b=>b.addEventListener('click',()=>{currentType=b.dataset.type;box.querySelectorAll('.attendance-type-choice button').forEach(x=>x.classList.toggle('selected',x===b));renderLocationEditor(box,communityId,currentType,existing)}));
    box.querySelector('#attCancel').addEventListener('click',()=>renderLocationCommunityPage(box,communityId,currentType));
    box.querySelector('#attUseGps').addEventListener('click',()=>navigator.geolocation?.getCurrentPosition(pos=>{box.querySelector('#attLat').value=pos.coords.latitude.toFixed(7);box.querySelector('#attLng').value=pos.coords.longitude.toFixed(7);selectedBox.innerHTML='<strong>📍 已使用目前位置</strong><div>座標已帶入，可在進階位置資訊查看。</div>';box.querySelector('#attGpsHint').textContent=`精度約 ${Math.round(pos.coords.accuracy||0)} 公尺`},err=>alert(`無法取得目前位置：${err.message}`),{enableHighAccuracy:true,timeout:10000,maximumAge:0}));
    setupGooglePlaceAutocomplete(box);
    box.querySelector('#attSave').addEventListener('click',async()=>{try{const address=(box.querySelector('#attAddress')?.value||box.querySelector('#attPatrolNote')?.value||'').trim();const body={community_id:Number(box.querySelector('#attCommunityEdit').value),location_type:currentType,name:box.querySelector('#attName').value.trim(),radius_m:Number(box.querySelector('#attRadius')?.value||cache.rules?.default_checkin_radius_m||100),lat:box.querySelector('#attLat').value,lng:box.querySelector('#attLng').value,address,place_id:box.dataset.googlePlaceId||''};if(!body.name)throw new Error('請輸入地點名稱');const url=existing?`/api/company/attendance/locations/${existing.id}`:'/api/company/attendance/locations';const d=await api(url,{method:existing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});cache.locations=existing?cache.locations.map(x=>x.id===existing.id?d.location:x).concat([]):cache.locations.concat(d.location);alert(existing?'地點已更新。':'地點已建立。');renderLocationCommunityPage(box,body.community_id,currentType)}catch(e){alert(e.message)}});
  }
  function patrolPointOptionsHtml(communityId){
    return (cache.locations||[]).filter(x=>String(x.community_id)===String(communityId)&&x.location_type==='patrol'&&x.is_active).map(x=>`<div class="patrol-route-point-row" data-point-id="${x.id}"><label><input type="checkbox" class="route-point-check" value="${x.id}"> <strong>${esc(x.name)}</strong></label><span class="muted">${esc(x.address||'')}</span><span class="route-order" data-order-for="${x.id}"></span><span class="route-move"><button type="button" class="secondary route-up" data-id="${x.id}">↑</button><button type="button" class="secondary route-down" data-id="${x.id}">↓</button></span></div>`).join('');
  }
  function renderRouteList(communityId){
    const routes=(cache.routes||[]).filter(x=>String(x.community_id)===String(communityId));
    if(!routes.length)return `<div class="attendance-empty-state compact"><div class="empty-icon">🧭</div><h3>目前尚未建立巡邏動線</h3><p>先建立巡邏點，再把巡邏點依照實際巡邏順序組成動線。</p><button type="button" id="patrolRouteEmptyAdd">＋ 新增巡邏動線</button></div>`;
    return `<div class="patrol-route-list">${routes.map(r=>`<div class="patrol-route-card"><div class="patrol-route-main"><div><strong>🧭 ${esc(r.name)}</strong>${r.time_label?`<span class="tag">參考 ${esc(r.time_label)}</span>`:''}<span class="route-soft-note">時間僅供參考，不強制打卡</span></div><div class="muted">${r.points.length} 個巡邏點${r.note?`｜${esc(r.note)}`:''}</div></div><div class="patrol-route-points">${r.points.map((p,i)=>`<span>${i+1}. ${esc(p.name)}</span>`).join('')}</div><div class="patrol-route-actions"><button type="button" class="secondary patrol-route-edit" data-id="${r.id}">編輯動線</button><button type="button" class="danger patrol-route-delete" data-id="${r.id}">${r.is_active?'刪除':'永久刪除'}</button></div></div>`).join('')}</div>`;
  }
  function refreshRouteOrder(box){
    const selected=[...box.querySelectorAll('.route-point-check:checked')].map(x=>Number(x.value));
    box.querySelectorAll('.patrol-route-point-row').forEach(row=>{const id=Number(row.dataset.pointId),idx=selected.indexOf(id),order=row.querySelector('.route-order');if(order)order.textContent=idx>=0?`第 ${idx+1} 站`:'';row.classList.toggle('selected',idx>=0)});
    box.querySelectorAll('.route-up,.route-down').forEach(btn=>{const id=Number(btn.dataset.id),idx=selected.indexOf(id);btn.disabled=idx<0||(btn.classList.contains('route-up')?idx===0:idx===selected.length-1)});
  }
  function renderPatrolRouteEditor(box,communityId,existing=null){
    const r=existing||{};let selected=(r.points||[]).map(x=>Number(x.id));
    box.innerHTML=pageShell(`${existing?'✏️ 編輯':'＋ 新增'}巡邏動線`,`巡邏動線是「一組有順序的巡邏點」。名稱可直接使用「2100~2200巡邏」這類現場習慣；時間只作為提示，不會強迫人員一定要在該時段完成。`, `<div class="patrol-route-editor"><section class="panel-lite"><div class="form-section-title">① 動線基本資料</div><div class="editor-grid"><div><label>巡邏動線名稱</label><input id="routeName" value="${esc(r.name||'')}" placeholder="例如：2100~2200巡邏" required></div><div><label>參考時間（可不填）</label><input id="routeTime" value="${esc(r.time_label||'')}" placeholder="例如：21:00～22:00"></div><div class="wide"><label>備註（可不填）</label><input id="routeNote" value="${esc(r.note||'')}" placeholder="例如：依現場狀況彈性巡邏，不強制時間"></div></div><div class="info-box purple"><strong>🧭 動線機制</strong><p>人員先選擇今天要執行的動線，再依序掃描 QR Code。系統記錄每一個巡邏點；不以時間作為硬性遲到判定。</p></div></section><section class="panel-lite"><div class="form-section-title">② 設定巡邏順序</div><p class="hint">勾選巡邏點後，可使用 ↑ ↓ 調整順序。順序就是現場建議的巡邏路線。</p><div id="routePointEditor" class="patrol-route-point-editor">${patrolPointOptionsHtml(communityId)}</div></section><div class="form-actions"><button type="button" class="secondary" id="routeCancel">取消</button><button type="button" id="routeSave">${existing?'💾 儲存動線':'＋ 建立巡邏動線'}</button></div></div>`);
    box.querySelectorAll('.route-point-check').forEach(ch=>{if(selected.includes(Number(ch.value)))ch.checked=true;ch.addEventListener('change',()=>{const id=Number(ch.value);if(ch.checked){if(!selected.includes(id))selected.push(id)}else selected=selected.filter(x=>x!==id);refreshRouteOrder(box)})});
    refreshRouteOrder(box);
    box.querySelectorAll('.route-up,.route-down').forEach(btn=>btn.addEventListener('click',()=>{const id=Number(btn.dataset.id),idx=selected.indexOf(id);if(idx<0)return;const dir=btn.classList.contains('route-up')?-1:1;if(idx+dir<0||idx+dir>=selected.length)return;[selected[idx],selected[idx+dir]]=[selected[idx+dir],selected[idx]];refreshRouteOrder(box)}));
    box.querySelector('#routeCancel').addEventListener('click',()=>renderPatrolCommunityPage(box,communityId));
    box.querySelector('#routeSave').addEventListener('click',async()=>{try{const name=box.querySelector('#routeName').value.trim();if(!name)throw new Error('請輸入巡邏動線名稱');if(!selected.length)throw new Error('請至少選擇一個巡邏點');const body={community_id:Number(communityId),name,time_label:box.querySelector('#routeTime').value.trim(),note:box.querySelector('#routeNote').value.trim(),point_ids:selected};const url=existing?`/api/company/attendance/routes/${existing.id}`:'/api/company/attendance/routes';const d=await api(url,{method:existing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});cache.routes=existing?cache.routes.map(x=>x.id===existing.id?d.route:x):cache.routes.concat(d.route);alert(existing?'巡邏動線已更新。':'巡邏動線已建立。');renderPatrolCommunityPage(box,communityId)}catch(e){alert(e.message)}});
  }
  async function renderPatrolStaffPanel(box,communityId){
    const host=box.querySelector('#patrolStaffPanel'); if(!host)return;
    host.innerHTML='<div class="profile-loading">載入巡邏人員中…</div>';
    try{
      const d=await api(`/api/company/attendance/patrol-staff?community_id=${encodeURIComponent(communityId)}`);
      host.innerHTML=`<div class="patrol-staff-head"><div><strong>👥 巡邏人員開通</strong><p class="hint">由公司經理／內勤勤務決定哪些駐點人員可以執行這個社區的巡邏。未開通人員不會看到巡邏動線，也無法掃描巡邏 QR。</p></div><button type="button" id="patrolStaffSave">💾 儲存開通人員</button></div><div class="patrol-staff-grid">${(d.staff||[]).map(st=>`<label class="patrol-staff-item"><input type="checkbox" class="patrol-staff-check" value="${st.id}" ${st.enabled?'checked':''}><span><strong>${esc(st.name||st.employee_id||'')}</strong><small>${esc(st.employee_id||'')}${st.position?'｜'+esc(st.position):''}</small></span></label>`).join('')||'<div class="empty">這個社區目前沒有可開通的駐點人員。</div>'}</div>`;
      host.querySelector('#patrolStaffSave').addEventListener('click',async()=>{
        const ids=[...host.querySelectorAll('.patrol-staff-check:checked')].map(x=>Number(x.value));
        try{await api('/api/company/attendance/patrol-staff',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({community_id:Number(communityId),staff_ids:ids})});alert('巡邏人員開通設定已儲存。');await renderPatrolStaffPanel(box,communityId);}catch(e){alert(e.message)}
      });
    }catch(e){host.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;}
  }
  function renderPatrolCommunityPage(box,communityId){
    const c=cache.communities.find(x=>String(x.id)===String(communityId));
    box.innerHTML=pageShell(`🚨 ${esc(c?.name||'巡邏管理')}`,'巡邏點負責「地點」，巡邏動線負責「順序」。時間只是動線名稱／提示，不會硬性限制現場巡邏。',`<div class="attendance-community-toolbar"><div><label>社區</label><select id="attCommunityView">${communityOptions(communityId)}</select></div></div><div class="patrol-management-grid"><section><div class="patrol-management-head"><div><h3>☷ 巡邏點列表</h3><p class="hint">先建立各個 QR 巡邏點，再組成右側動線。</p></div><div class="attendance-list-actions"><button type="button" class="secondary" id="patrolBatchPrint">🖨️ 列印巡邏點 QR Code</button><button type="button" id="patrolPointAdd">＋ 新增</button></div></div><div id="patrolPointList">${renderLocationsList('patrol',communityId)}</div></section><section><div class="patrol-management-head"><div><h3>🧭 巡邏動線列表</h3><p class="hint">例如「2100~2200巡邏」；可設定多個巡邏點與順序。</p></div><button type="button" id="patrolRouteAdd">＋ 新增</button></div><div id="patrolRouteList">${renderRouteList(communityId)}</div></section></div><section class="panel-lite patrol-staff-panel" id="patrolStaffPanel"><div class="profile-loading">載入巡邏人員設定…</div></section>`);
    box.querySelector('#attCommunityView').addEventListener('change',e=>renderPatrolCommunityPage(box,e.target.value));
    const pointAdd=box.querySelector('#patrolPointAdd');pointAdd.addEventListener('click',()=>renderLocationEditor(box,communityId,'patrol'));
    box.querySelector('#patrolRouteAdd').addEventListener('click',()=>renderPatrolRouteEditor(box,communityId));
    box.querySelector('#patrolRouteEmptyAdd')?.addEventListener('click',()=>renderPatrolRouteEditor(box,communityId));
    box.querySelector('#patrolBatchPrint').addEventListener('click',()=>{const ids=selectedIds(box);if(!ids.length){alert('請先在左側勾選要列印的巡邏點。');return;}printBatch(ids)});
    bindBatch(box);bindRowActions(box);renderPatrolStaffPanel(box,communityId);
    box.querySelectorAll('.patrol-route-edit').forEach(btn=>btn.addEventListener('click',()=>{const r=cache.routes.find(x=>x.id===Number(btn.dataset.id));if(r)renderPatrolRouteEditor(box,communityId,r)}));
    box.querySelectorAll('.patrol-route-delete').forEach(btn=>btn.addEventListener('click',async()=>{const r=cache.routes.find(x=>x.id===Number(btn.dataset.id));if(!r||!confirm(`確定要${r.is_active?'刪除':'永久刪除'}「${r.name}」嗎？`))return;try{const d=await api(`/api/company/attendance/routes/${r.id}`,{method:'DELETE'});cache=await api('/api/company/attendance/bootstrap');alert(d.message||'處理完成。');renderPatrolCommunityPage(box,communityId)}catch(e){alert(e.message)}}));
  }
  function renderLocationCommunityPage(box,communityId,type='patrol'){
    if(type==='patrol')return renderPatrolCommunityPage(box,communityId);
    const c=cache.communities.find(x=>String(x.id)===String(communityId));
    box.innerHTML=pageShell(`📍 ${esc(c?.name||'打卡／巡邏點')}`,'先查看這個社區目前的打卡與巡邏點；沒有資料時，再建立第一個地點。',`<div class="attendance-community-toolbar"><div><label>社區</label><select id="attCommunityView">${communityOptions(communityId)}</select></div><div class="attendance-type-tabs"><button type="button" class="${type==='attendance'?'active':''}" data-t="attendance">📍 出勤打卡點</button><button type="button" class="${type==='patrol'?'active':''}" data-t="patrol">🚨 巡邏點</button></div></div><div id="attLocationList">${renderLocationsList(type,communityId)}</div>`);
    box.querySelector('#attCommunityView').addEventListener('change',e=>renderLocationCommunityPage(box,e.target.value,type));
    box.querySelectorAll('.attendance-type-tabs button').forEach(b=>b.addEventListener('click',()=>renderLocationCommunityPage(box,communityId,b.dataset.t)));
    const add=box.querySelector('#attAddFromList')||box.querySelector('#attEmptyAdd');if(add)add.addEventListener('click',()=>renderLocationEditor(box,communityId,type));
    bindBatch(box);bindRowActions(box);
  }
  function renderAttendanceLocationsPage(){
    const box=workspace();
    box.innerHTML=pageShell('📍 出勤打卡','這裡只管理「出勤打卡點」。巡邏點、巡邏動線與巡邏人員請到「巡邏管理」設定，兩套功能彼此獨立。',`<div class="attendance-community-select-card"><div class="form-section-title">請先選擇社區</div><div class="attendance-community-select-row">${communityPicker()}<button type="button" id="attEnterCommunity">進入管理</button></div></div>`);
    const go=()=>{const cid=box.querySelector('#attendanceCommunityPick').value;if(!cid){alert('請先選擇社區。');return;}renderLocationCommunityPage(box,cid,'attendance')};
    box.querySelector('#attEnterCommunity').addEventListener('click',go);box.querySelector('#attendanceCommunityPick').addEventListener('change',e=>{if(e.target.value)go()});
  }
  function renderPatrolManagementPage(){
    const box=workspace();
    box.innerHTML=pageShell('🚨 巡邏管理','這裡只管理「巡邏點、巡邏動線、巡邏人員」。時間僅作為動線名稱／提示，不會硬性限制現場巡邏。',`<div class="attendance-community-select-card"><div class="form-section-title">請先選擇社區</div><div class="attendance-community-select-row">${communityPicker('patrolCommunityPick')}<button type="button" id="patrolEnterCommunity">進入管理</button></div></div>`);
    const go=()=>{const cid=box.querySelector('#patrolCommunityPick').value;if(!cid){alert('請先選擇社區。');return;}renderPatrolCommunityPage(box,cid)};
    box.querySelector('#patrolEnterCommunity').addEventListener('click',go);box.querySelector('#patrolCommunityPick').addEventListener('change',e=>{if(e.target.value)go()});
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
  async function fetchRecords(cid,from='',to='',type='',shift=''){
    const q=new URLSearchParams({community_id:String(cid||'')});if(from)q.set('from',from);if(to)q.set('to',to);if(type)q.set('record_type',type);if(shift)q.set('shift',shift);return api(`/api/company/attendance/records?${q.toString()}`)
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
  async function renderPatrolHistory(box,cid){const from=box.querySelector('#patrolFrom').value,to=box.querySelector('#patrolTo').value,person=box.querySelector('#patrolPerson')?.value||'',point=box.querySelector('#patrolPoint')?.value||'',shift=box.querySelector('#patrolShift')?.value||'';box.querySelector('#patrolHistoryBody').innerHTML='<div class="profile-loading">查詢中…</div>';try{const d=await fetchRecords(cid,from,to,'patrol',shift);let rows=d.rows||[];if(person)rows=rows.filter(r=>String(r.staff_id)===person);if(point)rows=rows.filter(r=>String(r.location_id)===point);if(shift)rows=rows.filter(r=>String(r.shift_code||'')===shift);box.querySelector('#patrolHistoryBody').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>巡邏動線</th><th>巡邏點</th><th>來源</th><th>狀態</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmtDate(r.recorded_at)}</td><td><strong>${esc(r.staff_name)}</strong><div class="muted">${esc(r.employee_id||'')}</div></td><td>${r.patrol_route_name?`🧭 ${esc(r.patrol_route_name)}${r.patrol_route_time?`<div class="muted">參考 ${esc(r.patrol_route_time)}</div>`:''}`:'—'}</td><td>🚨 ${esc(r.location_name||'—')}</td><td>${r.source==='offline'?'<span class="tag">離線同步</span>':'<span class="tag success">即時</span>'}</td><td><span class="tag success">完成</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">查無符合條件的巡邏紀錄。</div>'}catch(e){box.querySelector('#patrolHistoryBody').innerHTML=`<div class="msg error">${esc(e.message)}</div>`}}
  function renderPatrolPage(){const box=workspace();box.innerHTML=pageShell('🚨 巡邏紀錄','先選擇社區，先看今天的巡邏狀況；需要追查時，再使用巡邏紀錄與日期區間搜尋。',`<div class="attendance-community-select-card"><div class="form-section-title">請先選擇社區</div>${communityPicker('attPatrolCommunity')}</div><div id="attPatrolArea" style="display:none"><div class="attendance-subtabs"><button class="active" data-tab="today">今日巡邏狀況</button><button data-tab="history">巡邏紀錄</button></div><section id="patrolTodayPanel"><div class="section-title">📅 今日巡邏</div><div id="patrolTodayBody"></div></section><section id="patrolHistoryPanel" style="display:none"><div class="attendance-searchbar"><div><label>開始日期</label><input id="patrolFrom" type="date" value="${todayDate()}"></div><div><label>結束日期</label><input id="patrolTo" type="date" value="${todayDate()}"></div><div><label>班別</label><select id="patrolShift"><option value="">全部班別</option><option value="day">日班</option><option value="night">夜班</option><option value="work">機動</option></select></div><div><label>巡邏人員</label><select id="patrolPerson"><option value="">全部人員</option></select></div><div><label>巡邏點</label><select id="patrolPoint"><option value="">全部巡邏點</option></select></div><button id="patrolHistorySearch">🔎 搜尋</button></div><div id="patrolHistoryBody"></div></section></div>`);const sel=box.querySelector('#attPatrolCommunity');const open=async()=>{if(!sel.value)return;box.querySelector('#attPatrolArea').style.display='block';const cid=sel.value;const people=cache.locations;const psel=box.querySelector('#patrolPerson');const staffNames=new Map();try{const d=await api('/api/company/schedule/staff');(d.staff||[]).filter(s=>s.site_assignments?.some(a=>Number(a.community_id)===Number(cid))).forEach(s=>staffNames.set(s.id,s));}catch{}psel.innerHTML='<option value="">全部人員</option>'+[...staffNames.values()].map(s=>`<option value="${s.id}">${esc(s.name)}${s.employee_id?'｜'+esc(s.employee_id):''}</option>`).join('');box.querySelector('#patrolPoint').innerHTML='<option value="">全部巡邏點</option>'+cache.locations.filter(x=>Number(x.community_id)===Number(cid)&&x.location_type==='patrol').map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');await renderPatrolToday(box,cid)};sel.addEventListener('change',open);box.querySelectorAll('.attendance-subtabs button').forEach(b=>b.addEventListener('click',async()=>{box.querySelectorAll('.attendance-subtabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const today=b.dataset.tab==='today';box.querySelector('#patrolTodayPanel').style.display=today?'block':'none';box.querySelector('#patrolHistoryPanel').style.display=today?'none':'block';if(!today&&sel.value)await renderPatrolHistory(box,sel.value)}));box.querySelector('#patrolHistorySearch').addEventListener('click',()=>{if(sel.value)renderPatrolHistory(box,sel.value)});}

  A.render=async function(action,label){await load();if(action==='patrol-records')return renderPatrolPage();if(action==='patrol-management')return renderPatrolManagementPage();if(action==='attendance-records')return renderAttendancePage();return renderAttendanceLocationsPage();};
})();
