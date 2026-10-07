(function(){
  const M=window.AttendanceStaffModule={};
  const esc=s=>window.escapeHtml?window.escapeHtml(s):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=window.api;
  const KEY='handover-attendance-offline-v2';
  let state={rules:{},locations:[],communities:[],activeCommunityId:null,box:null,scanner:null,stream:null};
  const readQueue=()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}};
  const saveQueue=q=>{try{localStorage.setItem(KEY,JSON.stringify(q))}catch{}};
  const uid=()=>`C-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  const activeCommunity=()=>Number(state.activeCommunityId||0)||Number(window.__attendanceActiveCommunityId||0)||0;
  async function load(){state=Object.assign(state,await api('/api/staff/attendance/bootstrap'));state.activeCommunityId=state.activeCommunityId||state.communities?.[0]?.id||0;try{window.__attendanceActiveCommunityId=state.activeCommunityId;localStorage.setItem('handover-attendance-community',String(state.activeCommunityId))}catch{};return state}
  function currentCommunityName(){return (state.communities||[]).find(c=>Number(c.id)===Number(activeCommunity()))?.name||'目前案場'}
  function locations(type){return (state.locations||[]).filter(x=>Number(x.community_id)===Number(activeCommunity())&&x.is_active&&(!type||x.location_type===type))}
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
    try{const d=await submitRecord({community_id:activeCommunity(),record_type:'patrol',qr_token:token,location_id:loc.id,recorded_at:new Date().toISOString(),client_record_id:uid(),source:'online'});alert(d.offline?'📡 無網路，巡邏紀錄已暫存。':`✅ 已完成「${loc.name}」巡邏打卡`);render()}catch(e){alert(e.message)}
  }
  async function startScanner(){
    const box=state.box, video=box?.querySelector('#attVideo');if(!video)return;
    if(!('BarcodeDetector' in window))return alert('目前瀏覽器未提供原生 QR 掃描功能，請改用下方「輸入巡邏點代碼」，或使用支援 BarcodeDetector 的新版手機瀏覽器。');
    try{state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});video.srcObject=state.stream;await video.play();const detector=new BarcodeDetector({formats:['qr_code']});state.scanner=true;const tick=async()=>{if(!state.scanner)return;try{const codes=await detector.detect(video);if(codes?.[0]?.rawValue){state.scanner=false;stopScanner();await submitPatrol(codes[0].rawValue);return}}catch{}requestAnimationFrame(tick)};requestAnimationFrame(tick)}catch(e){alert(`無法啟動相機：${e.message}`)}
  }
  function stopScanner(){state.scanner=false;if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}const v=state.box?.querySelector('#attVideo');if(v)v.srcObject=null}
  function render(){
    const el=state.box?.querySelector('#attendanceStaffRoot');if(!el)return;
    const points=locations('attendance'), patrol=locations('patrol'), queue=readQueue();
    el.innerHTML=`<div class="attendance-staff-head"><div><div class="eyebrow">${esc(currentCommunityName())}</div><h2>📍 出勤與巡邏</h2><p class="hint">出勤使用 GPS；地下室巡邏使用 QR Code。${online()?'目前網路正常。':'目前離線，紀錄會暫存手機。'}</p></div><span class="tag ${online()?'success':''}">${online()?'🟢 在線':'🔴 離線'}</span></div>
      <div class="attendance-staff-grid"><div class="panel-lite"><div class="section-title">🕐 出勤打卡</div>${points.length?`<p class="hint">打卡點：${esc(points[0].name)}｜有效範圍 ${points[0].radius_m} 公尺</p><div class="attendance-actions"><button id="attCheckin">🟢 上班打卡</button><button class="secondary" id="attCheckout">🔴 下班打卡</button></div>`:'<div class="empty">公司尚未設定出勤打卡點。</div>'}</div>
      <div class="panel-lite"><div class="section-title">🚨 巡邏打卡</div><p class="hint">已設定 ${patrol.length} 個巡邏點。地下室可完全不依賴 GPS。</p><div class="attendance-actions"><button id="attScan">📷 掃描 QR Code</button></div><div class="editor-grid"><div class="wide"><label>沒有相機時可輸入巡邏點代碼</label><input id="attManualToken" placeholder="例如 P-ABC123..."></div></div><button class="secondary" id="attManualSubmit">完成巡邏打卡</button><div id="attScanner" style="display:none;margin-top:12px"><video id="attVideo" playsinline style="width:100%;max-height:320px;border-radius:12px;background:#111"></video><button class="secondary" id="attStopScan">停止掃描</button></div></div></div>
      <div class="panel"><div class="section-title">📋 今日／最近紀錄 ${queue.length?`<span class="tag">待同步 ${queue.length}</span>`:''}</div><div id="attRecent"><div class="profile-loading">載入中…</div></div></div>`;
    el.querySelector('#attCheckin')?.addEventListener('click',()=>checkInOut('checkin'));
    el.querySelector('#attCheckout')?.addEventListener('click',()=>checkInOut('checkout'));
    el.querySelector('#attScan')?.addEventListener('click',()=>{const x=el.querySelector('#attScanner');x.style.display='block';startScanner()});
    el.querySelector('#attStopScan')?.addEventListener('click',()=>{stopScanner();el.querySelector('#attScanner').style.display='none'});
    el.querySelector('#attManualSubmit')?.addEventListener('click',()=>submitPatrol(el.querySelector('#attManualToken').value));
    loadRecent();
  }
  async function loadRecent(){try{const d=await api(`/api/staff/attendance/records?community_id=${encodeURIComponent(activeCommunity())}`);const el=state.box?.querySelector('#attRecent');if(!el)return;el.innerHTML=(d.rows||[]).length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>類型</th><th>地點</th><th>來源</th></tr></thead><tbody>${d.rows.slice(0,30).map(r=>`<tr><td>${esc(new Date(r.recorded_at).toLocaleString('zh-TW'))}</td><td>${r.record_type==='checkin'?'上班':r.record_type==='checkout'?'下班':'巡邏'}</td><td>${esc(r.location_name||'—')}</td><td>${r.source==='offline'?'<span class="tag">離線同步</span>':'<span class="tag success">即時</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前尚無紀錄。</div>'}catch(e){state.box.querySelector('#attRecent').innerHTML=`<div class="hint">目前無法載入最近紀錄；離線時仍可使用已快取的巡邏 QR。</div>`}}
  M.render=async function(){
    await load();
    try{const cached=Number(localStorage.getItem('handover-attendance-community')||0);if(cached&&state.communities.some(c=>Number(c.id)===cached))state.activeCommunityId=cached}catch{}
    const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true"><button class="modal-close" type="button" aria-label="關閉">×</button><div id="attendanceStaffRoot"></div></div>`;document.body.appendChild(box);document.body.classList.add('modal-open');state.box=box;box.querySelector('.modal-close').addEventListener('click',()=>{stopScanner();box.remove();document.body.classList.remove('modal-open');state.box=null});render();await syncQueue();
  };
  window.addEventListener('online',syncQueue);
})();
