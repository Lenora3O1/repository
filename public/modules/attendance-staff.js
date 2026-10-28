(function(){
  const M=window.AttendanceStaffModule={};
  const esc=s=>window.escapeHtml?window.escapeHtml(s):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 網路斷線（fetch 失敗）和伺服器拒絕（例如超出打卡範圍）要分開：只有斷線才暫存，被拒絕要直接告訴本人
  async function api(url,options={}){let r;try{r=await fetch(url,{credentials:'same-origin',...options});}catch(e){const x=new Error('目前沒有網路');x.network=true;throw x;}let d={};try{d=await r.json()}catch{}if(!r.ok){const x=new Error(d.error||'操作失敗');x.status=r.status;if(r.status>=500||r.status===0)x.network=true;throw x;}return d;}
  const BOOT_KEY='handover-attendance-boot-v1';
  const KEY='handover-attendance-offline-v2';
  let state={rules:{},locations:[],routes:[],communities:[],activeCommunityId:null,box:null,scanner:null,stream:null,activeRouteId:null};
  const readQueue=()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}};
  const saveQueue=q=>{try{localStorage.setItem(KEY,JSON.stringify(q))}catch{}};
  const uid=()=>`C-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  const activeCommunity=()=>Number(state.activeCommunityId||0)||Number(window.__attendanceActiveCommunityId||0)||0;
  const patrolEnabled=()=>!!state.patrol_access?.[activeCommunity()];
  async function load(){let boot;try{boot=await api('/api/staff/attendance/bootstrap');try{localStorage.setItem(BOOT_KEY,JSON.stringify({at:Date.now(),boot}))}catch{}}catch(e){if(!e.network)throw e;let c=null;try{c=JSON.parse(localStorage.getItem(BOOT_KEY)||'null')}catch{}if(!c?.boot)throw new Error('目前沒有網路，而且這支手機還沒有下載過巡邏點資料。請先在有網路的地方打開一次本頁。');boot=c.boot;state.fromCache=true;}state=Object.assign(state,boot);state.activeCommunityId=state.activeCommunityId||state.communities?.[0]?.id||0;try{window.__attendanceActiveCommunityId=state.activeCommunityId;localStorage.setItem('handover-attendance-community',String(state.activeCommunityId))}catch{};return state}
  function currentCommunityName(){return (state.communities||[]).find(c=>Number(c.id)===Number(activeCommunity()))?.name||'目前案場'}
  function routes(){return patrolEnabled()?(state.routes||[]).filter(x=>Number(x.community_id)===Number(activeCommunity())&&x.is_active):[]}
  function routeById(id){return routes().find(x=>Number(x.id)===Number(id))||null}
  function locations(type){if(type==='patrol'&&!patrolEnabled())return [];return (state.locations||[]).filter(x=>Number(x.community_id)===Number(activeCommunity())&&x.is_active&&(!type||x.location_type===type))}
  function online(){return navigator.onLine!==false}
  function dist(a,b,c,d){const R=6371000,r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));}
  async function getPosition(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('此裝置不支援定位'));navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy_m:p.coords.accuracy}),e=>reject(new Error(`無法取得定位：${e.message}`)),{enableHighAccuracy:true,timeout:12000,maximumAge:0})})}
  async function submitRecord(record){
    try{const d=await api('/api/staff/attendance/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});return d}catch(e){if(e.network&&state.rules?.offline_queue_enabled!==false){const q=readQueue();q.push({...record,source:'offline'});saveQueue(q);render();return {success:true,offline:true}}throw e}
  }
  async function syncQueue(){if(!online()||state.rules?.offline_sync_enabled===false)return;const q=readQueue();if(!q.length)return;try{const d=await api('/api/staff/attendance/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:q})});const failed=(d.results||[]).filter(x=>!x.success);saveQueue([]);render();if(failed.length)alert(`有 ${failed.length} 筆離線紀錄無法補登：\n${failed.slice(0,5).map(f=>'・'+(f.error||'補登失敗')).join('\n')}\n\n請告知主管協助處理。`)}catch(e){/* 還是沒網路就留著下次再送 */}}
  async function checkInOut(type){
    const points=locations('attendance');if(!points.length)return alert('公司尚未設定目前案場的出勤打卡點。');
    let pos=null;try{if(state.rules?.gps_checkin_enabled!==false)pos=await getPosition()}catch(e){return alert(e.message)}
    const near=pos?points.map(p=>({p,d:(p.lat!=null&&p.lng!=null)?dist(pos.lat,pos.lng,p.lat,p.lng):1e12})).sort((a,b)=>a.d-b.d)[0].p:points[0];const loc=near;
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
    // Android Chrome 有內建 BarcodeDetector；iPhone Safari 沒有，改用本機的 jsQR 解析相機畫面
    let detect=null;
    if('BarcodeDetector' in window){try{const det=new BarcodeDetector({formats:['qr_code']});detect=async v=>(await det.detect(v))?.[0]?.rawValue||'';}catch{}}
    if(!detect){try{await loadJsQR();}catch{return alert('無法載入 QR 掃描元件，請改用下方「輸入巡邏點代碼」。');}const cv=document.createElement('canvas');const cx=cv.getContext('2d',{willReadFrequently:true});detect=async v=>{const w=v.videoWidth,h=v.videoHeight;if(!w||!h)return '';const sc=Math.min(1,640/Math.max(w,h));cv.width=Math.round(w*sc);cv.height=Math.round(h*sc);cx.drawImage(v,0,0,cv.width,cv.height);const img=cx.getImageData(0,0,cv.width,cv.height);const r=window.jsQR(img.data,cv.width,cv.height,{inversionAttempts:'dontInvert'});return r?.data||'';};}
    if(!navigator.mediaDevices?.getUserMedia)return alert('這支手機的瀏覽器不允許開啟相機，請改用下方「輸入巡邏點代碼」。');
    try{state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.setAttribute('playsinline','');video.muted=true;video.srcObject=state.stream;await video.play();state.scanner=true;let last=0;const tick=async t=>{if(!state.scanner)return;if(t-last>180){last=t;try{const code=await detect(video);if(code){state.scanner=false;stopScanner();state.box?.querySelector('#attScanner')&&(state.box.querySelector('#attScanner').style.display='none');try{navigator.vibrate?.(80)}catch{}await submitPatrol(code);return}}catch{}}requestAnimationFrame(tick)};requestAnimationFrame(tick)}catch(e){alert(e.name==='NotAllowedError'?'相機權限被拒絕。請到手機的瀏覽器設定允許使用相機，或改用下方「輸入巡邏點代碼」。':`無法啟動相機：${e.message}`)}
  }
  let jsqrPromise=null;
  function loadJsQR(){if(window.jsQR)return Promise.resolve();if(!jsqrPromise)jsqrPromise=new Promise((ok,no)=>{const sc=document.createElement('script');sc.src='vendor/jsQR.js';sc.onload=()=>ok();sc.onerror=()=>{jsqrPromise=null;no(new Error('load'))};document.head.appendChild(sc);});return jsqrPromise;}
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
  const SECTION_BY_ACTION={'staff-attendance':'all','staff-attendance-checkin':'checkin','staff-patrol':'patrol','staff-patrol-records':'records'};
  function sectionTitle(){return ({checkin:'出勤打卡',patrol:'巡邏巡檢',records:'巡邏紀錄'})[state.section]||'出勤與巡邏';}
  function applySection(el){
    const sec=state.section||'all';
    el.querySelectorAll('[data-att-section]').forEach(node=>{const list=String(node.dataset.attSection).split(' ');node.hidden=!(sec==='all'||list.includes(sec));});
    const grid=el.querySelector('.attendance-staff-grid');if(grid)grid.classList.toggle('is-single',sec!=='all');
  }
  function communitySwitcher(){const list=state.communities||[];if(list.length<2)return '';return `<div class="field attendance-community-switch"><label>目前案場</label><select id="attCommunitySelect">${list.map(c=>`<option value="${Number(c.id)}" ${Number(c.id)===activeCommunity()?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>`;}
  function render(){
    const el=state.box?.querySelector('#attendanceStaffRoot');if(!el)return;
    const points=locations('attendance'), patrol=locations('patrol'), queue=readQueue();
    el.innerHTML=`<div class="attendance-staff-head"><div><div class="eyebrow">📍 出勤與巡邏｜${esc(currentCommunityName())}</div><h1>${esc(sectionTitle())}</h1><p class="hint">出勤使用 GPS；地下室巡邏使用 QR Code。${online()?'目前網路正常。':'目前離線，紀錄會暫存手機。'}${state.fromCache?'（使用這支手機先前下載的巡邏點資料）':''}${queue.length?`<br><b>還有 ${queue.length} 筆離線紀錄等待上傳</b>，恢復網路後會自動補登。`:''}</p></div><span class="tag ${online()?'success':''}">${online()?'🟢 在線':'🔴 離線'}</span></div>
      ${communitySwitcher()}<div class="attendance-staff-grid"><div class="panel-lite" data-att-section="checkin"><div class="section-title">🕐 出勤打卡</div>${points.length?`<p class="hint">打卡點：${points.map(p=>`${esc(p.name)}（${p.radius_m} 公尺內）`).join('、')}${points.length>1?'，在任一點範圍內都可以打卡':''}</p><div class="attendance-actions"><button id="attCheckin">🟢 上班打卡</button><button class="secondary" id="attCheckout">🔴 下班打卡</button></div>`:'<div class="empty">公司尚未設定出勤打卡點。</div>'}</div>
      <div class="panel-lite" data-att-section="patrol"><div class="section-title">🚨 巡邏巡檢</div>${patrolEnabled()?`<p class="hint">已設定 ${patrol.length} 個巡邏點。地下室可完全不依賴 GPS。${routes().length?'先選擇巡邏動線，再依順序掃描 QR Code。':''}</p>${routes().length?`<div class="field"><label>今日巡邏動線</label><select id="attRouteSelect"><option value="">不指定動線（一般巡邏）</option>${routes().map(r=>`<option value="${r.id}" ${Number(r.id)===Number(state.activeRouteId)?'selected':''}>${esc(r.name)}${r.time_label?'｜參考 '+esc(r.time_label):''}</option>`).join('')}</select><p class="hint">⏱️ 動線時間只作為提示，不會因超過時間而禁止打卡。</p></div>`:''}<div id="attRoutePreview"></div><div class="attendance-actions"><button id="attScan">📷 掃描 QR Code</button></div><div class="editor-grid"><div class="wide"><label>沒有相機時可輸入巡邏點代碼</label><input id="attManualToken" placeholder="例如 P-ABC123..."></div></div><button class="secondary" id="attManualSubmit">完成巡邏打卡</button><div id="attScanner" style="display:none;margin-top:12px"><video id="attVideo" playsinline style="width:100%;max-height:320px;border-radius:12px;background:#111"></video><button class="secondary" id="attStopScan">停止掃描</button></div>`:'<div class="info-box purple"><strong>🔒 尚未開通巡邏工作</strong><p>目前由公司後台設定巡邏人員。若您需要執行巡邏，請聯絡公司經理／內勤勤務開通。</p></div>'}</div></div><div class="panel-lite attendance-records-panel" data-att-section="records"><div class="section-title">🗂️ ${state.section==='records'?'巡邏與出勤紀錄':'最近紀錄'}</div><div id="attRecent"><div class="hint">載入中…</div></div></div><div id="attManagerPatrolMount" data-att-section="patrol"></div>`;applySection(el);el.querySelector('#attCommunitySelect')?.addEventListener('change',e=>{state.activeCommunityId=Number(e.target.value)||state.activeCommunityId;try{window.__attendanceActiveCommunityId=state.activeCommunityId;localStorage.setItem('handover-attendance-community',String(state.activeCommunityId))}catch{};state.activeRouteId=null;render()});
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
  // 直接在右側工作區展開（不再使用彈出視窗）。container 預設為現場工作台的 #staffHome。
  M.render=async function(options={}){
    const host=options.container||document.getElementById('staffHome');
    if(!host)throw new Error('找不到工作區');
    stopScanner();
    state.section=SECTION_BY_ACTION[options.action]||'all';
    await load();
    try{const cached=Number(localStorage.getItem('handover-attendance-community')||0);if(cached&&state.communities.some(c=>Number(c.id)===cached))state.activeCommunityId=cached}catch{}
    host.innerHTML='<div class="panel attendance-staff-workspace"><div id="attendanceStaffRoot"></div></div>';
    state.box=host.firstElementChild;
    render();await syncQueue();
    if(!('BarcodeDetector' in window))loadJsQR().catch(()=>{});
  };
  M.stop=function(){stopScanner();state.box=null;};
  // 切換到其他工作目錄時關閉相機，避免背景持續使用鏡頭。
  document.addEventListener('workspace-menu',e=>{const a=String(e.detail?.action||'');if(!SECTION_BY_ACTION[a])M.stop();});
  (function injectStyle(){if(document.getElementById('attendanceStaffInlineStyle'))return;const st=document.createElement('style');st.id='attendanceStaffInlineStyle';st.textContent='.attendance-staff-workspace .attendance-staff-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}.attendance-staff-workspace .attendance-staff-head h1{margin:4px 0 6px}.attendance-staff-workspace .attendance-staff-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-bottom:18px}.attendance-staff-workspace .attendance-staff-grid.is-single{grid-template-columns:minmax(0,1fr)}.attendance-staff-workspace .attendance-staff-grid>[hidden]{display:none}.attendance-staff-workspace .panel-lite{border:1px solid #E6E0DD;border-radius:12px;padding:18px;background:#FDFCFB}.attendance-staff-workspace .attendance-records-panel{margin-bottom:18px}.attendance-staff-workspace .attendance-actions{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.attendance-community-switch{max-width:360px;margin:0 0 18px}.attendance-staff-workspace [data-att-section=\"patrol\"]>.editor-grid{display:block;margin:14px 0 10px}.attendance-staff-workspace [data-att-section=\"patrol\"]>.editor-grid label{display:block;font-weight:700;margin-bottom:8px}.attendance-staff-workspace .attendance-staff-head .tag{white-space:nowrap;flex:0 0 auto}.attendance-staff-workspace #attManualToken{width:100%;max-width:420px;box-sizing:border-box;padding:10px 12px;border:1px solid #D8CECB;border-radius:8px;font:inherit}.attendance-staff-workspace #attManagerPatrolMount>.panel{margin-top:0}@media(max-width:800px){.attendance-staff-workspace .attendance-staff-grid{grid-template-columns:minmax(0,1fr)}}';document.head.appendChild(st);})();
  window.addEventListener('online',syncQueue);
})();
