(function(){
  const M=window.AttendanceStaffModule={};
  const esc=s=>window.escapeHtml?window.escapeHtml(s):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const KEY='handover-attendance-offline-v2';
  let state={rules:{},locations:[],routes:[],communities:[],activeCommunityId:null,box:null,scanner:null,stream:null,activeRouteId:null};
  const readQueue=()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}};
  const saveQueue=q=>{try{localStorage.setItem(KEY,JSON.stringify(q))}catch{}};
  const uid=()=>`C-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  const activeCommunity=()=>Number(state.activeCommunityId||0)||Number(window.__attendanceActiveCommunityId||0)||0;
  const patrolEnabled=()=>!!state.patrol_access?.[activeCommunity()];
  async function load(){state=Object.assign(state,await api('/api/staff/attendance/bootstrap'));state.activeCommunityId=state.activeCommunityId||state.communities?.[0]?.id||0;try{window.__attendanceActiveCommunityId=state.activeCommunityId;localStorage.setItem('handover-attendance-community',String(state.activeCommunityId))}catch{};return state}
  function currentCommunityName(){return (state.communities||[]).find(c=>Number(c.id)===Number(activeCommunity()))?.name||'目前案場'}
  function routes(){return patrolEnabled()?(state.routes||[]).filter(x=>Number(x.community_id)===Number(activeCommunity())&&x.is_active):[]}
  function routeById(id){return routes().find(x=>Number(x.id)===Number(id))||null}
  function locations(type){if(type==='patrol'&&!patrolEnabled())return [];return (state.locations||[]).filter(x=>Number(x.community_id)===Number(activeCommunity())&&x.is_active&&(!type||x.location_type===type))}
  function online(){return navigator.onLine!==false}
  async function getPosition(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('此裝置不支援定位'));navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy_m:p.coords.accuracy}),e=>reject(new Error(`無法取得定位：${e.message}`)),{enableHighAccuracy:true,timeout:12000,maximumAge:0})})}
  async function submitRecord(record){
    try{const d=await api('/api/staff/attendance/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});return d}catch(e){if(state.rules?.offline_queue_enabled!==false){const q=readQueue();q.push({...record,source:'offline'});saveQueue(q);render();return {success:true,offline:true}}throw e}
  }
  async function syncQueue(){if(!online()||state.rules?.offline_sync_enabled===false)return;const q=readQueue();if(!q.length)return;try{const d=await api('/api/staff/attendance/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:q})});const failed=(d.results||[]).filter(x=>!x.success);saveQueue(q.filter(x=>failed.some(f=>f.client_record_id===x.client_record_id)));render()}catch{}}
  async function checkInOut(type){
    const points=locations('attendance');if(!points.length)return alert('公司尚未設定目前案場的出勤打卡點。');
    let pos=null;try{if(state.rules?.gps_checkin_enabled!==false)pos=await getPosition()}catch(e){return alert(e.message)}
    const loc=points[0];
    try{const d=await submitRecord({community_id:activeCommunity(),location_id:loc.id,record_type:type,lat:pos?.lat??null,lng:pos?.lng??null,accuracy_m:pos?.accuracy_m??null,recorded_at:new Date().toISOString(),client_record_id:uid(),source:'online'});alert(d.offline?'📡 目前沒有網路，已先暫存；恢復網路後會自動同步。':`✅ ${type==='checkin'?'上班':'下班'}打卡完成`)}catch(e){alert(e.message)}
  }
  async function submitPatrol(token){
    token=String(token||'').trim();if(!token)return alert('請掃描 QR Code 或輸入巡邏點代碼。');
    const loc=locations('patrol').find(x=>x.qr_token===token);if(!loc)return alert('這張 QR Code 不是目前案場的有效巡邏點，或目前沒有網路可驗證。');
    const routeId=Number(state.activeRouteId||0)||null;
    const route=routeId?routeById(routeId):null;
    if(routeId&&!route)return alert('目前選取的巡邏動線已不存在，請重新選擇。');
    if(route&&!route.points.some(p=>Number(p.id)===Number(loc.id)))return alert(`「${loc.name}」不在目前選取的「${route.name}」動線內，請依動線順序巡邏。`);
    try{const d=await submitRecord({community_id:activeCommunity(),record_type:'patrol',qr_token:token,location_id:loc.id,patrol_route_id:routeId,recorded_at:new Date().toISOString(),client_record_id:uid(),source:'online'});alert(d.offline?'📡 無網路，巡邏紀錄已暫存。':`✅ 已完成「${loc.name}」${route?`｜${route.name}`:''} 巡邏打卡`);render()}catch(e){alert(e.message)}
  }
  async function startScanner(){
    const box=state.box, video=box?.querySelector('#attVideo');if(!video)return;
    if(!('BarcodeDetector' in window))return alert('目前瀏覽器未提供原生 QR 掃描功能，請改用下方「輸入巡邏點代碼」，或使用支援 BarcodeDetector 的新版手機瀏覽器。');
    try{state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});video.srcObject=state.stream;await video.play();const detector=new BarcodeDetector({formats:['qr_code']});state.scanner=true;const tick=async()=>{if(!state.scanner)return;try{const codes=await detector.detect(video);if(codes?.[0]?.rawValue){state.scanner=false;stopScanner();await submitPatrol(codes[0].rawValue);return}}catch{}requestAnimationFrame(tick)};requestAnimationFrame(tick)}catch(e){alert(`無法啟動相機：${e.message}`)}
  }
  function stopScanner(){state.scanner=false;if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}const v=state.box?.querySelector('#attVideo');if(v)v.srcObject=null}
  async function renderManagerPatrolPanel(el){
    if(!state.can_manage_patrol)return;
    const cid=activeCommunity(),mount=el.querySelector('#attManagerPatrolMount'); if(!mount)return;
    mount.innerHTML='<div class="panel patrol-manager-panel"><div class="profile-loading">載入現場巡邏管理…</div></div>';
    const panel=mount.firstElementChild;
    try{
      const [m,status]=await Promise.all([api(`/api/staff/attendance/patrol-management?community_id=${encodeURIComponent(cid)}`),api(`/api/staff/attendance/patrol-status?community_id=${encodeURIComponent(cid)}`)]);
      panel.innerHTML=`<div class="section-title">🧭 駐點巡邏管理</div><p class="hint">您是本案場經理，可以查看今日巡邏狀況，也可以依現場狀況新增或停用巡邏點。已有歷史紀錄的巡邏點不會直接刪除。</p><div class="attendance-summary"><div><strong>${status.summary.people}</strong><span>今日巡邏人員</span></div><div><strong>${status.summary.scans}</strong><span>今日已掃 QR</span></div><div><strong>${status.summary.points}</strong><span>目前巡邏點</span></div></div><div class="editor-grid"><div><label>新增巡邏點名稱</label><input id="mgrPatrolName" placeholder="例如：B1 機房"></div><div><label>位置說明</label><input id="mgrPatrolAddress" placeholder="例如：機房鐵門旁"></div><div><label>緯度</label><input id="mgrPatrolLat" placeholder="可留空"></div><div><label>經度</label><input id="mgrPatrolLng" placeholder="可留空"></div></div><div class="form-actions"><button type="button" id="mgrPatrolGps" class="secondary">📍 取得目前 GPS</button><button type="button" id="mgrPatrolAdd">＋ 新增巡邏點</button></div><div class="table-wrap"><table><thead><tr><th>巡邏點</th><th>位置</th><th>狀態</th><th>操作</th></tr></thead><tbody>${(m.locations||[]).map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.address||'—')}</td><td>${x.is_active?'<span class="tag success">啟用</span>':'<span class="tag">停用</span>'}</td><td>${x.is_active?`<button type="button" class="danger mgr-patrol-delete" data-id="${x.id}">停用／刪除</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="4">目前尚無巡邏點。</td></tr>'}</tbody></table></div><div class="section-title" style="margin-top:18px">📊 今日巡邏紀錄</div><div class="table-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>動線</th><th>巡邏點</th></tr></thead><tbody>${(status.records||[]).map(r=>`<tr><td>${esc(fmtDate(r.recorded_at))}</td><td>${esc(r.staff_name||r.employee_id||'')}</td><td>${esc(r.patrol_route_name||'一般巡邏')}</td><td>${esc(r.location_name||'—')}</td></tr>`).join('')||'<tr><td colspan="4">今天尚無巡邏紀錄。</td></tr>'}</tbody></table></div>`;
      panel.querySelector('#mgrPatrolGps').addEventListener('click',async()=>{try{const p=await getPosition();panel.querySelector('#mgrPatrolLat').value=p.lat.toFixed(7);panel.querySelector('#mgrPatrolLng').value=p.lng.toFixed(7);}catch(e){alert(e.message)}});
      panel.querySelector('#mgrPatrolAdd').addEventListener('click',async()=>{try{const name=panel.querySelector('#mgrPatrolName').value.trim();if(!name)throw new Error('請輸入巡邏點名稱');const d=await api('/api/staff/attendance/patrol-management/locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({community_id:cid,name,address:panel.querySelector('#mgrPatrolAddress').value.trim(),lat:panel.querySelector('#mgrPatrolLat').value.trim(),lng:panel.querySelector('#mgrPatrolLng').value.trim()})});alert('巡邏點已新增；如需加入既有巡邏動線，請由公司後台調整動線。');state.locations=(state.locations||[]).concat(d.location);await renderManagerPatrolPanel(el);}catch(e){alert(e.message)}});
      panel.querySelectorAll('.mgr-patrol-delete').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('確定要停用這個巡邏點嗎？已有歷史紀錄時只會停用，不會刪除歷史資料。'))return;try{const d=await api(`/api/staff/attendance/patrol-management/locations/${btn.dataset.id}?community_id=${encodeURIComponent(cid)}`,{method:'DELETE'});alert(d.message||'處理完成。');await load();render()}catch(e){alert(e.message)}}));
    }catch(e){panel.innerHTML=`<div class="msg error">${esc(e.message)}</div>`}
  }
  function fmtDate(v){try{return new Date(v).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return v||''}}
  function render(){
    const el=state.box?.querySelector('#attendanceStaffRoot');if(!el)return;
    const points=locations('attendance'), patrol=locations('patrol'), queue=readQueue();
    el.innerHTML=`<div class="attendance-staff-head"><div><div class="eyebrow">${esc(currentCommunityName())}</div><h2>📍 出勤與巡邏</h2><p class="hint">出勤使用 GPS；地下室巡邏使用 QR Code。${online()?'目前網路正常。':'目前離線，紀錄會暫存手機。'}</p></div><span class="tag ${online()?'success':''}">${online()?'🟢 在線':'🔴 離線'}</span></div>
      <div class="attendance-staff-grid"><div class="panel-lite"><div class="section-title">🕐 出勤打卡</div>${points.length?`<p class="hint">打卡點：${esc(points[0].name)}｜有效範圍 ${points[0].radius_m} 公尺</p><div class="attendance-actions"><button id="attCheckin">🟢 上班打卡</button><button class="secondary" id="attCheckout">🔴 下班打卡</button></div>`:'<div class="empty">公司尚未設定出勤打卡點。</div>'}</div>
      <div class="panel-lite"><div class="section-title">🚨 巡邏打卡</div>${patrolEnabled()?`<p class="hint">已設定 ${patrol.length} 個巡邏點。地下室可完全不依賴 GPS。${routes().length?'先選擇巡邏動線，再依順序掃描 QR Code。':''}</p>${routes().length?`<div class="field"><label>今日巡邏動線</label><select id="attRouteSelect"><option value="">不指定動線（一般巡邏）</option>${routes().map(r=>`<option value="${r.id}" ${Number(r.id)===Number(state.activeRouteId)?'selected':''}>${esc(r.name)}${r.time_label?'｜參考 '+esc(r.time_label):''}</option>`).join('')}</select><p class="hint">⏱️ 動線時間只作為提示，不會因超過時間而禁止打卡。</p></div>`:''}<div id="attRoutePreview"></div><div class="attendance-actions"><button id="attScan">📷 掃描 QR Code</button></div><div class="editor-grid"><div class="wide"><label>沒有相機時可輸入巡邏點代碼</label><input id="attManualToken" placeholder="例如 P-ABC123..."></div></div><button class="secondary" id="attManualSubmit">完成巡邏打卡</button><div id="attScanner" style="display:none;margin-top:12px"><video id="attVideo" playsinline style="width:100%;max-height:320px;border-radius:12px;background:#111"></video><button class="secondary" id="attStopScan">停止掃描</button></div>`:'<div class="info-box purple"><strong>🔒 尚未開通巡邏工作</strong><p>目前由公司後台設定巡邏人員。若您需要執行巡邏，請聯絡公司經理／內勤勤務開通。</p></div>'}</div></div>`;
    el.querySelector('#attCheckin')?.addEventListener('click',()=>checkInOut('checkin'));
    el.querySelector('#attCheckout')?.addEventListener('click',()=>checkInOut('checkout'));
    el.querySelector('#attScan')?.addEventListener('click',()=>{const x=el.querySelector('#attScanner');x.style.display='block';startScanner()});
    el.querySelector('#attStopScan')?.addEventListener('click',()=>{stopScanner();el.querySelector('#attScanner').style.display='none'});
    el.querySelector('#attManualSubmit')?.addEventListener('click',()=>submitPatrol(el.querySelector('#attManualToken').value));
    el.querySelector('#attRouteSelect')?.addEventListener('change',e=>{state.activeRouteId=Number(e.target.value||0)||null;render()});
    const rp=el.querySelector('#attRoutePreview');if(rp&&state.activeRouteId){const route=routeById(state.activeRouteId);if(route)rp.innerHTML=`<div class="staff-route-preview"><strong>🧭 ${esc(route.name)}</strong><div>${route.points.map((p,i)=>`<span>${i+1}. ${esc(p.name)}</span>`).join('')}</div></div>`;}
    loadRecent();
    renderManagerPatrolPanel(el);
  }
  async function loadRecent(){try{const d=await api(`/api/staff/attendance/records?community_id=${encodeURIComponent(activeCommunity())}`);const el=state.box?.querySelector('#attRecent');if(!el)return;el.innerHTML=(d.rows||[]).length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>類型</th><th>地點</th><th>來源</th></tr></thead><tbody>${d.rows.slice(0,30).map(r=>`<tr><td>${esc(new Date(r.recorded_at).toLocaleString('zh-TW'))}</td><td>${r.record_type==='checkin'?'上班':r.record_type==='checkout'?'下班':'巡邏'}</td><td>${esc(r.location_name||'—')}${r.patrol_route_name?`<div class="muted">🧭 ${esc(r.patrol_route_name)}</div>`:''}</td><td>${r.source==='offline'?'<span class="tag">離線同步</span>':'<span class="tag success">即時</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前尚無紀錄。</div>'}catch(e){state.box.querySelector('#attRecent').innerHTML=`<div class="hint">目前無法載入最近紀錄；離線時仍可使用已快取的巡邏 QR。</div>`}}
  M.render=async function(){
    await load();
    try{const cached=Number(localStorage.getItem('handover-attendance-community')||0);if(cached&&state.communities.some(c=>Number(c.id)===cached))state.activeCommunityId=cached}catch{}
    const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true"><button class="modal-close" type="button" aria-label="關閉">×</button><div id="attendanceStaffRoot"></div></div>`;document.body.appendChild(box);document.body.classList.add('modal-open');state.box=box;box.querySelector('.modal-close').addEventListener('click',()=>{stopScanner();box.remove();document.body.classList.remove('modal-open');state.box=null});render();await syncQueue();
  };
  window.addEventListener('online',syncQueue);
})();
