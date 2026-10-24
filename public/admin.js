let state={submissions:[],templates:[],platformResources:[],staff:[],tenants:[],config:null,brandingTenantId:null,branding:null,customization:{mode:'platform',tenantId:null,scope:'company',global:[],items:[],overrides:{}},messageAudit:{tenantId:null,enabled:false,auditor_ids:[],staff:[]},platformRules:null,platformRuleHistory:[]};
const $=id=>document.getElementById(id);
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
async function checkSession(){try{const r=await api('/api/admin/session');if(r.isAdmin){showMain();await loadAll();restoreAdminTab()}else{$('loginView').style.display='block'}}catch(err){$('loginView').style.display='block';$('loginMsg').innerHTML=`<div class="msg error">${escapeHtml(err.message||'無法讀取登入狀態，請重新整理。')}</div>`}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password:$('password').value})});showMain();await loadAll()}catch(err){$('loginMsg').innerHTML=`<div class="msg error">${escapeHtml(err.message)}</div>`}});
$('logoutBtn').addEventListener('click',async()=>{await api('/api/admin/logout',{method:'POST'});location.reload()});
function showMain(){$('loginView').style.display='none';$('mainView').style.display='block';$('logoutWrap').style.display='block'}
// 企業客製化：母目錄（工作目錄、平台規則、訊息稽核、禮品、貼圖、投保級距、組織、請假、設備、會計設定）
(function(){const g=$('navCustomGroup'),box=$('navCustomChildren');if(!g||!box)return;const set=open=>{g.setAttribute('aria-expanded',String(open));box.classList.toggle('is-collapsed',!open);};g.addEventListener('click',()=>set(g.getAttribute('aria-expanded')!=='true'));window.__openAdminGroup=b=>{if(box.contains(b))set(true);};})();
for(const b of document.querySelectorAll('.nav-tabs button[data-tab]'))b.addEventListener('click',async()=>{document.querySelectorAll('.nav-tabs button[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');window.__openAdminGroup?.(b);for(const id of ['tenants','submissions','staff','templates','form','branding','customization','platformRules','messageAudit','gifts','stickers','insurance','org','leave','equip','acct','addons','interview','moduleTest'])$(`tab-${id}`).style.display=b.dataset.tab===id?'block':'none';if(b.dataset.tab==='customization'){await loadCustomization();renderCustomization();}if(b.dataset.tab==='platformRules'){await loadPlatformRules();renderPlatformRules();}if(b.dataset.tab==='messageAudit'){await loadMessageAudit();renderMessageAudit();}if(b.dataset.tab==='moduleTest'){renderModuleTest();}if(b.dataset.tab==='gifts'){loadGiftsAdmin();}if(b.dataset.tab==='stickers'){loadStickersAdmin();}if(b.dataset.tab==='insurance'){loadInsuranceAdmin();}if(b.dataset.tab==='leave'&&window.LeaveAdminModule){window.LeaveAdminModule.load($('tab-leave'));}if(b.dataset.tab==='org'&&window.OrgAdminModule){window.OrgAdminModule.load($('tab-org'));}if(b.dataset.tab==='equip'&&window.EquipmentAdminModule){window.EquipmentAdminModule.load($('tab-equip'));}if(b.dataset.tab==='acct'&&window.AccountingAdminModule){window.AccountingAdminModule.load($('tab-acct'));}if(b.dataset.tab==='addons'&&window.PlansAdminModule){window.PlansAdminModule.load($('tab-addons'));}if(b.dataset.tab==='interview'&&window.InterviewAdminModule){window.InterviewAdminModule.load($('tab-interview'));}try{localStorage.setItem('admin-last-tab',b.dataset.tab)}catch{}document.body.classList.remove('sidebar-open');window.scrollTo({top:0});});
async function loadAll(){
  const jobs=[['tenants',loadTenants,renderTenants],['submissions',loadSubmissions,renderSubmissions],['staff',loadStaff,renderStaff],['templates',loadTemplates,renderTemplates],['form',loadConfig,renderFormDesigner],['branding',loadBranding,renderBranding]];
  for(const [key] of jobs){const el=$(`tab-${key}`);if(el)el.innerHTML='<div class="panel"><div class="hint">⏳ 正在讀取資料…</div></div>';}
  for(const [key,loader,renderer] of jobs){
    try{await loader();renderer()}catch(err){
      const el=$(`tab-${key}`); if(el) el.innerHTML=`<div class="panel"><div class="msg error">${escapeHtml(err.message||'讀取資料失敗')}</div><p class="hint">此區塊讀取失敗，不會影響其他後臺功能。請重新整理後再試。</p></div>`;
      console.error('Admin load failed:',key,err);
    }
  }
}
// ===== 模組測試中心：依指定公司的實際目錄，以示意資料預覽真正的模組畫面 =====
let modulePreview={tenantId:null,scope:'staff',items:[],activeId:null,hasOverride:false,loading:false,error:''};
function modulePreviewUrl(){const q=new URLSearchParams({scope:modulePreview.scope});if(modulePreview.tenantId)q.set('tenant_id',modulePreview.tenantId);return `/admin-preview.html?${q}`;}
async function loadModulePreviewMenu(){
 modulePreview.loading=true;modulePreview.error='';
 try{
  if(!state.tenants.length)state.tenants=await api('/api/admin/tenants');
  if(modulePreview.tenantId===null){const t=state.tenants.find(x=>x.status==='active')||state.tenants[0];modulePreview.tenantId=t?Number(t.id):0;}
  const q=modulePreview.tenantId?`tenant_id=${modulePreview.tenantId}&`:'';
  const d=await api(`/api/admin/menu-preview?${q}scope=${modulePreview.scope}`);
  modulePreview.items=d.items||[];modulePreview.hasOverride=!!d.has_override;
 }catch(e){modulePreview.items=[];modulePreview.error=e.message;}
 modulePreview.loading=false;
}
async function renderModuleTest(reload=true){
 const el=$('tab-moduleTest');if(!el)return;
 if(reload){el.innerHTML='<div class="panel"><div class="profile-loading">正在讀取公司目錄…</div></div>';await loadModulePreviewMenu();}
 const tenantOptions=[`<option value="0" ${!modulePreview.tenantId?'selected':''}>🧩 平台預設目錄（不指定公司）</option>`].concat(state.tenants.map(t=>`<option value="${t.id}" ${Number(t.id)===Number(modulePreview.tenantId)?'selected':''}>${t.status==='active'?'🏢':'⏸️'} ${escapeHtml(t.name)}${t.status==='active'?'':'（停用）'}</option>`)).join('');
 const roots=modulePreview.items.filter(x=>!x.parentId);
 const kids=id=>modulePreview.items.filter(x=>String(x.parentId)===String(id));
 const chip=(x,child)=>`<button type="button" class="module-chip${child?' is-child':''}${String(modulePreview.activeId)===String(x.id)?' is-active':''}" data-preview-id="${escapeAttr(String(x.id))}">${escapeHtml(x.label||'未命名')}</button>`;
 const menuHtml=roots.length?roots.map(r=>{const c=kids(r.id);return `<div class="module-chip-group">${chip(r,false)}${c.length?`<div class="module-chip-children">${c.map(x=>chip(x,true)).join('')}</div>`:''}</div>`;}).join(''):`<div class="empty">${modulePreview.error?escapeHtml(modulePreview.error):'這個工作空間目前沒有啟用的目錄項目。'}</div>`;
 const tenantName=modulePreview.tenantId?(state.tenants.find(t=>Number(t.id)===Number(modulePreview.tenantId))?.name||''):'平台預設';
 el.innerHTML=`<div class="panel"><div class="section-title">🧪 模組測試中心</div>
  <p class="hint">選擇公司與工作空間後，下方會載入<strong>真正的現場／內勤畫面</strong>，目錄依該公司目前的實際設定顯示。畫面中的人員、住戶、班表等都是示意資料；任何新增、修改、刪除都只在預覽中模擬，不會寫入正式資料。</p>
  <div class="module-test-controls"><div class="field"><label for="modulePreviewTenant">預覽公司</label><select id="modulePreviewTenant">${tenantOptions}</select></div>
  <div class="field"><label for="modulePreviewScope">工作空間</label><select id="modulePreviewScope"><option value="staff" ${modulePreview.scope==='staff'?'selected':''}>🏠 社區駐點／現場人員</option><option value="company" ${modulePreview.scope==='company'?'selected':''}>🏢 公司內勤</option></select></div>
  <div class="module-test-actions"><button type="button" class="secondary" id="modulePreviewReload">↻ 重新載入</button><a class="top-link module-test-open" href="${modulePreviewUrl()}" target="_blank" rel="noopener">↗ 新分頁開啟</a></div></div>
  <div class="module-test-status">${modulePreview.tenantId?(modulePreview.hasOverride?`<span class="tag">此公司使用企業客製目錄</span>`:`<span class="tag success">此公司直接繼承平台預設目錄</span>`):'<span class="tag">平台預設目錄</span>'}<span class="hint">${modulePreview.items.length} 個目錄項目</span></div></div>
 <div class="panel"><div class="section-title">📚 目錄快速切換 <span class="hint">（${escapeHtml(tenantName)}）</span></div><div class="module-chip-list">${menuHtml}</div></div>
 <div class="panel module-preview-frame-panel"><iframe id="modulePreviewFrame" title="模組預覽" src="${modulePreviewUrl()}" loading="lazy"></iframe></div>`;
 $('modulePreviewTenant').addEventListener('change',e=>{modulePreview.tenantId=Number(e.target.value)||0;modulePreview.activeId=null;renderModuleTest(true);});
 $('modulePreviewScope').addEventListener('change',e=>{modulePreview.scope=e.target.value;modulePreview.activeId=null;renderModuleTest(true);});
 $('modulePreviewReload').addEventListener('click',()=>renderModuleTest(true));
 el.querySelectorAll('[data-preview-id]').forEach(b=>b.addEventListener('click',()=>{
  const item=modulePreview.items.find(x=>String(x.id)===b.dataset.previewId);if(!item)return;
  modulePreview.activeId=item.id;el.querySelectorAll('.module-chip').forEach(x=>x.classList.toggle('is-active',x===b));
  const frame=$('modulePreviewFrame');try{frame.contentWindow.postMessage({type:'admin-preview-open',action:item.action,id:item.id,label:item.label},location.origin);}catch{}
  frame.scrollIntoView({behavior:'smooth',block:'start'});
 }));
}
async function loadTenants(){state.tenants=await api('/api/admin/tenants')}
async function loadSubmissions(){const r=await api('/api/admin/submissions');state.submissions=r.submissions}
async function loadTemplates(){state.templates=await api('/api/admin/templates');state.platformResources=await api('/api/admin/platform-resources')}
async function loadStaff(){state.staff=await api('/api/admin/staff')}
async function loadConfig(){state.config=await api('/api/admin/form-config');const ho=await api('/api/admin/handover-forms').catch(()=>null);state.handoverForms={manager:state.config,secretary:ho?.forms?.secretary||{title:'秘書交接清冊',pages:[],questions:[]}};state.hoRole=state.hoRole||'manager';if(!state.config||!Array.isArray(state.config.pages)||!Array.isArray(state.config.questions)){throw new Error('中央表單設定格式不完整，請檢查 /data/form-config.json。')}}
function renderTenants(){
 const el=$('tab-tenants');
 const rows=state.tenants.map(t=>{
  const active=t.status==='active';
  const status=active?'<span class="tag success">合作中</span>':'<span class="tag">已停用</span>';
  const action=active
   ? `<button class="secondary" onclick="saveTenant(${t.id})">儲存</button> <button class="secondary" onclick="resetCompanyAdmin(${t.id},'${escapeAttr(t.admin_employee_id||'')}')">重設負責人密碼</button> <button class="danger" onclick="toggleTenantStatus(${t.id},false)">停用公司</button>`
   : `<button class="secondary" onclick="toggleTenantStatus(${t.id},true)">重新啟用</button>`;
  return `<tr><td><input id="tenant-name-${t.id}" value="${escapeAttr(t.name)}"></td><td><span class="muted">${escapeHtml(t.code)}</span></td><td><strong>${escapeHtml(t.admin_employee_id||'—')}</strong><br><span class="muted">負責人</span></td><td>${escapeHtml(t.admin_name||'—')}<br><span class="muted">公司管理員 ${t.admin_count||0} 人</span></td><td>${t.admin_employee_id?(t.admin_is_active?'<span class="tag success">帳號啟用</span>':'<span class="tag">帳號停用</span>'):'<span class="muted">未建立</span>'}<br><span class="muted">最後登入：${t.admin_last_login_at?formatDate(t.admin_last_login_at):'尚未登入'}</span></td><td>${t.staff_count}</td><td>${t.community_count}</td><td>${status}</td><td>${action}<br><button class="secondary" onclick="manageTenantAdmins(${t.id},'${escapeAttr(t.name)}')">管理公司管理員</button></td></tr>`;
 }).join('');
 el.innerHTML=`<div id="adminDashboard"><div class="panel"><div class="profile-loading">正在整理平台總覽…</div></div></div><div class="panel designer-intro"><div class="section-title">🏢 公司／租戶管理</div><p><strong>這裡是系統總後臺。</strong> 每建立一家公司，就可以產生一個獨立的公司管理後臺；公司管理員只會看到自己的公司資料。</p><p class="hint">公司停止合作時請使用「停用公司」而不是刪除。停用會立即禁止該公司的管理員與一般人員登入，但完整保留既有交接、草稿、社區與文件資料；日後恢復合作時可直接「重新啟用」。</p></div><div class="panel"><div class="section-title">＋ 建立新物業管理公司</div><form id="addTenantForm"><div class="editor-grid"><div class="wide"><label>公司名稱</label><input id="newTenantName" placeholder="例如：○○物業管理有限公司" required></div><div><label>公司代碼（可留白自動產生）</label><input id="newTenantCode" placeholder="例如 abc-property"></div><div><label>公司負責人員編</label><input id="newTenantAdminId" placeholder="例如 CA1001" required></div><div><label>負責人姓名</label><input id="newTenantAdminName" placeholder="例如 王小明" required></div><div><label>初始密碼</label><input id="newTenantAdminPass" type="password" placeholder="至少 4 碼" required></div></div><button type="submit">＋ 建立公司與負責人帳號</button></form></div><div class="panel"><div class="section-title">已建立公司（${state.tenants.length} 家）</div><p class="hint">每家公司可以有多位公司管理員。第一位建立的帳號為「公司負責人」；公司負責人可在公司後台新增／管理其他公司管理員。這樣老闆忙碌時，可授權總經理等主管代為管理總務、會計與現場人員帳號，不需要重複建立公司。</p><div class="table-wrap"><table><thead><tr><th>公司</th><th>公司代碼</th><th>負責人帳號</th><th>負責人／管理員</th><th>負責人登入狀態</th><th>一般人員</th><th>社區</th><th>合作狀態</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="9" class="empty">目前尚未建立公司。</td></tr>'}</tbody></table></div></div>`;
 $('addTenantForm').addEventListener('submit',addTenant);
 loadDashboard();
}
// ===== 平台總覽儀表板 =====
async function loadDashboard(){
 const box=$('adminDashboard');if(!box)return;
 try{state.dashboard=await api('/api/admin/dashboard');renderDashboard();}
 catch(e){box.innerHTML=`<div class="panel"><div class="msg error">平台總覽讀取失敗：${escapeHtml(e.message)}</div></div>`;}
}
function renderDashboard(){
 const box=$('adminDashboard'),d=state.dashboard;if(!box||!d)return;
 const t=d.totals||{};
 const tile=(icon,label,value,note,tone='')=>`<div class="dash-tile ${tone}"><span class="dash-tile-label">${icon} ${label}</span><strong>${Number(value||0).toLocaleString('zh-TW')}</strong>${note?`<small>${note}</small>`:''}</div>`;
 const rel=v=>{if(!v)return '尚無紀錄';const days=Math.floor((Date.now()-new Date(v).getTime())/86400000);return days<=0?'今天':days===1?'昨天':`${days} 天前`;};
 const list=(d.tenants||[]).slice().sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1)||b.alerts.filter(x=>x.level==='warn').length-a.alerts.filter(x=>x.level==='warn').length||a.name.localeCompare(b.name,'zh-Hant'));
 const filter=state.dashboardFilter||'all';
 const shown=list.filter(r=>filter==='all'||(filter==='alerts'?r.alerts.some(x=>x.level==='warn'):r.status!=='active'));
 const rows=shown.map(r=>`<tr class="${r.status==='active'?'':'is-inactive'}"><td><strong>${escapeHtml(r.name)}</strong><div class="muted">${escapeHtml(r.code||'')}</div></td>
  <td class="num">${r.staff}</td><td class="num">${r.communities}</td><td class="num">${r.active7}</td><td class="num">${r.submissions30}</td><td class="num">${r.attendance7}</td>
  <td>${rel(r.last_login_at)}</td>
  <td>${r.alerts.length?r.alerts.map(a=>`<span class="dash-alert ${a.level}">${escapeHtml(a.text)}</span>`).join(''):'<span class="dash-alert ok">正常</span>'}</td>
  <td class="dash-actions">${r.status==='active'?`<button type="button" class="secondary" onclick="openTenantPreview(${r.id})">預覽</button><button type="button" class="secondary" onclick="openTenantCustomization(${r.id})">目錄</button>`:''}</td></tr>`).join('');
 box.innerHTML=`<div class="panel dash-panel"><div class="dash-head"><div><div class="section-title">📊 平台總覽</div><p class="hint">更新時間：${formatDate(d.generated_at)}；只統計合作中的公司。</p></div><button type="button" class="secondary" onclick="loadDashboard()">↻ 更新</button></div>
  <div class="dash-tiles">${tile('🏢','合作中公司',t.tenants,t.inactive_tenants?`另有 ${t.inactive_tenants} 家已停用`:'')}${tile('🏠','啟用中社區',t.communities)}${tile('👥','在職人員',t.staff,`公司管理員 ${t.admins||0} 人`)}${tile('🟢','近 7 天登入',t.active7,'人次（依最後登入）')}${tile('📋','近 30 天交接',t.submissions30,'份正式交接')}${tile('📍','近 7 天打卡',t.attendance7,'筆出勤／巡邏')}${tile('⚠️','需要處理',t.alerts,'項提醒',t.alerts?'is-warn':'is-ok')}</div>
  <div class="dash-filter" role="tablist">${[['all','全部公司'],['alerts','只看需要處理'],['inactive','已停用']].map(([k,l])=>`<button type="button" class="${filter===k?'active':''}" onclick="state.dashboardFilter='${k}';renderDashboard()">${l}</button>`).join('')}</div>
  <div class="table-wrap"><table class="dash-table"><thead><tr><th>公司</th><th class="num">人員</th><th class="num">社區</th><th class="num">7 天登入</th><th class="num">30 天交接</th><th class="num">7 天打卡</th><th>最後登入</th><th>狀態提醒</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="9" class="empty">沒有符合條件的公司。</td></tr>'}</tbody></table></div></div>`;
}
function switchAdminTab(tab){const b=document.querySelector(`.nav-tabs button[data-tab="${tab}"]`);if(b)b.click();}
function openTenantPreview(id){modulePreview.tenantId=Number(id);modulePreview.activeId=null;switchAdminTab('moduleTest');}
function openTenantCustomization(id){state.customization.mode='company';state.customization.tenantId=Number(id);state.customization.scope='staff';switchAdminTab('customization');}
async function addTenant(e){e.preventDefault();try{const employeeId=$('newTenantAdminId').value.trim();const r=await api('/api/admin/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('newTenantName').value,code:$('newTenantCode').value,admin_employee_id:employeeId,admin_name:$('newTenantAdminName').value,admin_password:$('newTenantAdminPass').value})});await loadTenants();renderTenants();alert(`公司已建立！公司負責人員編：${employeeId}`)}catch(err){alert(err.message)}}
async function saveTenant(id){const t=state.tenants.find(x=>Number(x.id)===Number(id));try{await api(`/api/admin/tenants/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$(`tenant-name-${id}`).value,status:t?.status==='active'})});await loadTenants();renderTenants();alert('公司資料已儲存。')}catch(err){alert(err.message)}}
async function toggleTenantStatus(id,active){const t=state.tenants.find(x=>Number(x.id)===Number(id));if(!t)return;const message=active?`確定重新啟用「${t.name}」嗎？公司管理員與一般人員將可以重新登入。`:`確定停用「${t.name}」嗎？這不會刪除資料，但會立即禁止該公司的管理員與一般人員登入。`;if(!confirm(message))return;try{await api(`/api/admin/tenants/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:t.name,status:active})});await loadTenants();renderTenants()}catch(err){alert(err.message)}}
async function resetCompanyAdmin(id,employeeId){const password=prompt(`請為公司負責人 ${employeeId||''} 設定新密碼（至少 4 碼）：`);if(password===null)return;if(password.length<4){alert('新密碼至少 4 碼');return}if(!confirm(`確定要重設 ${employeeId||'公司負責人'} 的密碼嗎？`))return;try{await api(`/api/admin/tenants/${id}/admin/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});alert('公司負責人密碼已重設。')}catch(err){alert(err.message)}}
async function manageTenantAdmins(id,name){try{const rows=await api(`/api/admin/tenants/${id}/admins`);const html=rows.map(u=>`<div class="admin-manage-row"><div><strong>${escapeHtml(u.name)}</strong> <span class="tag ${u.admin_level==='owner'?'gold':'success'}">${u.admin_level==='owner'?'公司負責人':'公司管理員'}</span><br><span class="muted">${escapeHtml(u.employee_id)}｜${u.is_active?'啟用':'停用'}｜最後登入：${u.last_login_at?formatDate(u.last_login_at):'尚未登入'}</span></div><div><button class="secondary" onclick="superEditCompanyAdmin(${u.id},'${escapeAttr(u.name)}',${u.is_active?'true':'false'})">編輯</button></div></div>`).join('');const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<div class="modal"><h2>🏢 ${escapeHtml(name)}｜公司管理員</h2><p class="hint">公司可以有多位管理員。平台總後臺可以協助管理，但公司日常新增管理員可由「公司負責人」在公司後台處理。</p><div class="check-list">${html||'<div class="empty">目前沒有公司管理員。</div>'}</div><hr><h3>＋ 直接新增公司管理員</h3><div class="editor-grid"><div><label>員編</label><input id="superNewAdminId" placeholder="例如 CA1002"></div><div><label>姓名</label><input id="superNewAdminName" placeholder="例如 王小明"></div><div><label>初始密碼</label><input id="superNewAdminPass" type="password" placeholder="至少 4 碼"></div></div><div class="form-nav"><button class="secondary" onclick="this.closest('.modal-backdrop').remove()">關閉</button><button onclick="superAddCompanyAdmin(${id},this)">建立公司管理員</button></div></div>`;document.body.appendChild(box)}catch(err){alert(err.message)}}
async function superAddCompanyAdmin(tenantIdValue,btn){const box=btn.closest('.modal');const employeeId=box.querySelector('#superNewAdminId').value.trim(),name=box.querySelector('#superNewAdminName').value.trim(),password=box.querySelector('#superNewAdminPass').value;if(!employeeId||!name||password.length<4){alert('請填寫員編、姓名，且密碼至少 4 碼');return}try{await api(`/api/admin/tenants/${tenantIdValue}/admins`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_id:employeeId,name,password})});alert('公司管理員已建立。');box.closest('.modal-backdrop').remove();await loadTenants();renderTenants()}catch(err){alert(err.message)}}
async function superEditCompanyAdmin(id,currentName,currentActive){const name=prompt('公司管理員姓名：',currentName);if(name===null)return;const active=confirm('按「確定」代表啟用帳號；按「取消」代表停用帳號。若是公司負責人則不能停用。');const password=prompt('如需重設密碼請輸入新密碼；不需要請直接按取消：');if(password!==null&&password.length<4){alert('新密碼至少 4 碼');return}try{await api(`/api/admin/company-admins/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim(),is_active:active,password:password||''})});alert('公司管理員資料已更新。')}catch(err){alert(err.message)}}

async function loadBranding(){state.brandingTenantId=state.tenants[0]?.id||null;state.branding=null;if(state.brandingTenantId)state.branding=await api(`/api/admin/tenants/${state.brandingTenantId}/branding`)}
function renderBranding(){const el=$('tab-branding');if(!state.tenants.length){el.innerHTML='<div class="panel empty">請先建立公司，再設定各公司的系統美編。</div>';return}const t=state.tenants.find(x=>Number(x.id)===Number(state.brandingTenantId))||state.tenants[0];if(!state.branding||Number(state.branding.tenant_id)!==Number(t.id))state.branding={tenant_id:t.id,title:t.name,subtitle:'物業管理公司',loginTitle:'公司管理員登入',loginHint:'這裡是公司專屬管理後台。',intro:'這裡只管理您所屬公司的資料。',logoText:'',accent:'#61423D',accentDark:'#442E2B',bg:'#F7F7F4',panel:'#FFFFFF'};const b=state.branding;el.innerHTML=`<div class="panel designer-intro"><div class="section-title">🎨 各公司後台系統美編區</div><p><strong>依照「公司管理」中的公司逐一設定。</strong> 每家公司都有自己的系統名稱、登入文字與視覺色系；修改只會套用到選定的公司，不會影響其他公司。</p><div class="field"><label>選擇公司</label><select id="brandingTenantSelect">${state.tenants.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(t.id)?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></div></div><div class="panel"><div class="section-title">① 系統名稱與品牌識別</div><div class="editor-grid"><div class="wide"><label>系統主標題</label><input id="brandTitle" value="${escapeAttr(b.title)}" placeholder="例如：○○物業管理服務平台"></div><div><label>系統副標題</label><input id="brandSubtitle" value="${escapeAttr(b.subtitle)}" placeholder="例如：物業管理部門"></div><div><label>品牌識別文字／Logo</label><input id="brandLogoText" value="${escapeAttr(b.logoText)}" placeholder="例如：○○物業"></div></div></div><div class="panel"><div class="section-title">② 登入頁與公司後台文字</div><div class="editor-grid"><div><label>公司管理員登入標題</label><input id="brandLoginTitle" value="${escapeAttr(b.loginTitle)}"></div><div class="wide"><label>公司管理員登入說明</label><textarea id="brandLoginHint">${escapeHtml(b.loginHint)}</textarea></div><div class="wide"><label>公司後台首頁說明</label><textarea id="brandIntro">${escapeHtml(b.intro)}</textarea></div></div></div><div class="panel"><div class="section-title">③ 頁面視覺美化</div><p class="hint">目前提供品牌主色、深色主色、頁面背景與內容卡片背景；未來可以再加入 Logo 圖片、更多版型等功能。</p><div class="editor-grid"><div><label>主色</label><div class="color-row"><input type="color" id="brandAccent" value="${escapeAttr(b.accent)}"><input id="brandAccentText" value="${escapeAttr(b.accent)}" class="code-input"></div></div><div><label>主色深色版</label><div class="color-row"><input type="color" id="brandAccentDark" value="${escapeAttr(b.accentDark)}"><input id="brandAccentDarkText" value="${escapeAttr(b.accentDark)}" class="code-input"></div></div><div><label>頁面背景</label><div class="color-row"><input type="color" id="brandBg" value="${escapeAttr(b.bg)}"><input id="brandBgText" value="${escapeAttr(b.bg)}" class="code-input"></div></div><div><label>內容卡片背景</label><div class="color-row"><input type="color" id="brandPanel" value="${escapeAttr(b.panel)}"><input id="brandPanelText" value="${escapeAttr(b.panel)}" class="code-input"></div></div></div><div id="brandingPreview" class="brand-preview"><div class="brand-preview-top"><strong id="previewTitle">${escapeHtml(b.logoText||b.title)}</strong><span id="previewSubtitle">${escapeHtml(b.subtitle)}</span></div><div class="brand-preview-body"><h3 id="previewLogin">${escapeHtml(b.loginTitle)}</h3><p id="previewHint">${escapeHtml(b.loginHint)}</p><button type="button" id="previewButton">登入</button></div></div></div><div class="save-bar"><button onclick="saveBranding()">💾 儲存此公司美編設定</button><span id="brandingSaveMsg"></span></div>`;wireBrandingInputs();}
function wireBrandingInputs(){const pairs=[['brandAccent','brandAccentText'],['brandAccentDark','brandAccentDarkText'],['brandBg','brandBgText'],['brandPanel','brandPanelText']];for(const [a,b] of pairs){$(a).addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test($(a).value))$(b).value=$(a).value;updateBrandPreview()});$(b).addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test($(b).value))$(a).value=$(b).value;updateBrandPreview()})}['brandTitle','brandSubtitle','brandLogoText','brandLoginTitle','brandLoginHint'].forEach(id=>$(id).addEventListener('input',updateBrandPreview));$('brandingTenantSelect').addEventListener('change',async()=>{state.brandingTenantId=Number($('brandingTenantSelect').value);try{state.branding=await api(`/api/admin/tenants/${state.brandingTenantId}/branding`);renderBranding()}catch(e){alert(e.message)}});updateBrandPreview()}
function updateBrandPreview(){const root=$('brandingPreview');if(!root)return;root.style.setProperty('--preview-accent',$('brandAccentText').value);root.style.setProperty('--preview-dark',$('brandAccentDarkText').value);root.style.setProperty('--preview-bg',$('brandBgText').value);root.style.setProperty('--preview-panel',$('brandPanelText').value);$('previewTitle').textContent=$('brandLogoText').value||$('brandTitle').value;$('previewSubtitle').textContent=$('brandSubtitle').value;$('previewLogin').textContent=$('brandLoginTitle').value;$('previewHint').textContent=$('brandLoginHint').value}
async function saveBranding(){const msg=$('brandingSaveMsg');const body={title:$('brandTitle').value,subtitle:$('brandSubtitle').value,logoText:$('brandLogoText').value,loginTitle:$('brandLoginTitle').value,loginHint:$('brandLoginHint').value,intro:$('brandIntro').value,accent:$('brandAccentText').value,accentDark:$('brandAccentDarkText').value,bg:$('brandBgText').value,panel:$('brandPanelText').value};try{const r=await api(`/api/admin/tenants/${state.brandingTenantId}/branding`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});state.branding=r.branding;msg.innerHTML='<span class="msg success inline-msg">✓ 已儲存，此設定只套用於這家公司。</span>';setTimeout(()=>msg.innerHTML='',4500)}catch(e){msg.innerHTML=`<span class="msg error inline-msg">${escapeHtml(e.message)}</span>`}}

function renderSubmissions(){const el=$('tab-submissions');if(!state.submissions.length){el.innerHTML='<div class="panel empty">目前還沒有正式送出的填答紀錄。</div>';return}const opts=state.templates.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}${t.is_active?'（預設）':''}</option>`).join('');el.innerHTML=`<div class="panel"><div class="section-title">📋 正式填答紀錄（共 ${state.submissions.length} 筆）</div><p class="hint">這裡只顯示已正式送出的交接清冊。填寫中的草稿會由員工登入後自己繼續。</p><div class="table-wrap"><table><thead><tr><th>編號</th><th>類型</th><th>送出時間</th><th>公司</th><th>填寫人員</th><th>社區</th><th>交接人員</th><th>操作</th></tr></thead><tbody>${state.submissions.map(s=>{const d=s.data;return `<tr><td>${s.id}</td><td>${s.form_type==='secretary'?'🗂 秘書':'👔 經理'}</td><td>${formatDate(s.created_at)}</td><td>${escapeHtml(s.tenant_name||'')}</td><td>${escapeHtml(s.employee_name||'')}<br><span class="muted">${escapeHtml(s.employee_id||'')}</span></td><td>${escapeHtml(s.community_name||d.community_name||'')}</td><td>${escapeHtml((s.form_type==='secretary'?d.outgoing_secretary:d.outgoing_manager)||'')} → ${escapeHtml((s.form_type==='secretary'?d.incoming_secretary:d.incoming_manager)||'')}</td><td><select id="tpl-${s.id}" ${!state.templates.length?'disabled':''}>${opts||'<option>尚未上傳範本</option>'}</select> <button class="secondary" onclick="downloadDocx(${s.id})" ${!state.templates.length?'disabled':''}>產生 Word</button> <button class="danger" onclick="deleteSubmission(${s.id})">刪除</button></td></tr>`}).join('')}</tbody></table></div></div>`}
async function downloadDocx(id){const v=$(`tpl-${id}`)?.value||'';window.open(`/api/admin/generate/${id}?templateId=${encodeURIComponent(v)}`,'_blank')}
async function deleteSubmission(id){if(!confirm('確定刪除這筆正式紀錄嗎？'))return;await api(`/api/admin/submissions/${id}`,{method:'DELETE'});await loadSubmissions();renderSubmissions()}
function renderStaff(){const el=$('tab-staff');el.innerHTML=`<div class="panel"><div class="section-title">👥 全系統人員</div><p class="hint">總後臺可以查看所有公司的人員與角色；日常開通一般人員請交給各公司的公司管理員。</p><div class="table-wrap"><table><thead><tr><th>員編</th><th>姓名</th><th>公司</th><th>角色</th><th>狀態</th><th>密碼重設</th><th>操作</th></tr></thead><tbody>${state.staff.map(u=>`<tr><td><strong>${escapeHtml(u.employee_id)}</strong></td><td><input id="staff-name-${u.id}" value="${escapeAttr(u.name)}"></td><td><select id="staff-tenant-${u.id}">${state.tenants.map(t=>`<option value="${t.id}" ${Number(u.tenant_id)===Number(t.id)?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></td><td><select id="staff-role-${u.id}"><option value="staff" ${u.role==='staff'?'selected':''}>一般人員</option><option value="company_admin" ${u.role==='company_admin'?'selected':''}>公司管理員</option></select></td><td><select id="staff-active-${u.id}"><option value="1" ${u.is_active?'selected':''}>啟用</option><option value="0" ${!u.is_active?'selected':''}>停用</option></select></td><td><input id="staff-pass-${u.id}" type="password" placeholder="留白＝不修改"></td><td><button class="secondary" onclick="saveStaff(${u.id})">儲存</button></td></tr>`).join('')}</tbody></table></div></div>`}
async function addStaff(e){e.preventDefault();try{await api('/api/admin/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_id:$('newEmployeeId').value,name:$('newStaffName').value,password:$('newStaffPass').value})});await loadStaff();renderStaff();alert('已新增人員。')}catch(err){alert(err.message)}}
async function saveStaff(id){try{await api(`/api/admin/staff/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$(`staff-name-${id}`).value,is_active:$(`staff-active-${id}`).value==='1',password:$(`staff-pass-${id}`).value,role:$(`staff-role-${id}`).value,tenant_id:Number($(`staff-tenant-${id}`).value)})});await loadStaff();renderStaff()}catch(err){alert(err.message)}}
async function deleteStaff(id){if(!confirm('刪除人員後，他的未完成草稿也會被刪除；正式紀錄不會刪除。確定嗎？'))return;try{await api(`/api/admin/staff/${id}`,{method:'DELETE'});await loadStaff();renderStaff()}catch(err){alert(err.message)}}
function renderTemplates(){
  const el=$('tab-templates');
  const global=state.templates.filter(t=>t.tenant_id===null);
  const company=state.templates.filter(t=>t.tenant_id!==null);
  const globalRows=global.map(t=>`<tr><td><strong>${escapeHtml(t.name)}</strong></td><td>${t.is_active?'<span class="tag gold">平台預設</span>':'未啟用'}</td><td>${formatDate(t.created_at)}</td><td>${t.is_active?'':`<button class="secondary" onclick="activateTemplate(${t.id})">設為平台預設</button>`} <button class="danger" onclick="deleteTemplate(${t.id})">刪除</button></td></tr>`).join('');
  const companyRows=company.map(t=>`<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.tenant_name||'—')}</td><td>${t.is_active?'<span class="tag success">公司預設</span>':'未啟用'}</td><td>${formatDate(t.created_at)}</td></tr>`).join('');
  el.innerHTML=`
  <div class="panel"><div class="section-title">🏛 平台制式範本</div><p class="hint">這裡由系統總管理員提供「雛型」。各公司管理員可以自行選擇使用，系統會複製成該公司的版本；公司後續可以自行修改、更新或刪除，不會影響平台原始範本。</p>
  <form id="uploadGlobalTemplate"><div class="row"><input type="text" id="globalTplName" placeholder="例如：平台標準交接清冊 2026" required><input type="file" id="globalTplFile" accept=".docx" required></div><button type="submit">＋ 上傳平台制式範本</button></form></div>
  <div class="panel"><div class="section-title">📄 平台範本清單（${global.length} 份）</div>${global.length?`<div class="table-wrap"><table><thead><tr><th>名稱</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody>${globalRows}</tbody></table></div>`:'<div class="empty">目前沒有平台制式範本。你可以從這裡上傳第一份雛型。</div>'}</div>
  <div class="panel"><div class="section-title">📚 平台公版文件（一般文書）</div><p class="hint">這裡不是交接 Word 範本。平台公版可放住戶名冊 Excel、PDF、一般 Word、PowerPoint、TXT、CSV 等公司／現場工作會使用的文件。公司可以看到並自行採用；不會改動原本的交接 Word 產生功能。</p>
  <form id="uploadPlatformResource"><div class="row"><input type="text" id="platformResourceName" placeholder="例如：住戶名冊平台公版 V2" required><select id="platformResourceModule" required><option value="住戶名冊">住戶名冊</option><option value="公司資源">公司資源</option><option value="現場工作">現場工作</option><option value="公家單位">公家單位</option><option value="其他">其他</option></select></div><div class="row"><input type="file" id="platformResourceFile" accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.txt,.csv" required><input type="text" id="platformResourceDescription" placeholder="用途說明（可留白）"></div><button type="submit">＋ 上傳平台公版文件</button></form></div>
  <div class="panel"><div class="section-title">📚 平台公版文件清單（${state.platformResources.length} 份）</div>${state.platformResources.length?`<div class="table-wrap"><table><thead><tr><th>名稱</th><th>分類</th><th>格式</th><th>說明</th><th>建立時間</th><th>操作</th></tr></thead><tbody>${state.platformResources.map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${escapeHtml(r.category||'')}</td><td>${escapeHtml(r.extension||'')}</td><td>${escapeHtml(r.description||'')}</td><td>${formatDate(r.created_at)}</td><td><button class="secondary" onclick="downloadPlatformResource(${r.id})">下載</button> <button class="danger" onclick="deletePlatformResource(${r.id})">刪除</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前沒有平台公版文件。</div>'}</div>
  <div class="panel"><div class="section-title">🏢 各公司已建立的範本（${company.length} 份）</div><p class="hint">這些是公司管理員從平台範本建立或自行上傳的版本。總後臺可以查看，但內容與管理權仍屬各公司。</p>${company.length?`<div class="table-wrap"><table><thead><tr><th>名稱</th><th>公司</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>${companyRows}</tbody></table></div>`:'<div class="empty">目前還沒有公司自己的範本。</div>'}</div>`;
  $('uploadGlobalTemplate').addEventListener('submit',async e=>{e.preventDefault();try{const fd=new FormData();fd.append('name',$('globalTplName').value);fd.append('template',$('globalTplFile').files[0]);await api('/api/admin/templates',{method:'POST',body:fd});await loadTemplates();renderTemplates();alert('平台制式範本已上傳。')}catch(err){alert(err.message)}})
  $('uploadPlatformResource').addEventListener('submit',async e=>{e.preventDefault();try{const category=$('platformResourceModule').value;const fd=new FormData();fd.append('name',$('platformResourceName').value);fd.append('category',category);fd.append('description',$('platformResourceDescription').value);fd.append('file',$('platformResourceFile').files[0]);await api('/api/admin/platform-resources',{method:'POST',body:fd});await loadTemplates();renderTemplates();alert(`平台公版文件已上傳。\n分類：${category}`)}catch(err){alert(err.message)}})
}
async function activateTemplate(id){try{await api(`/api/admin/templates/${id}/activate`,{method:'POST'});await loadTemplates();renderTemplates()}catch(err){alert(err.message)}}
async function deleteTemplate(id){if(!confirm('確定刪除這份平台制式範本嗎？已經複製到各公司的版本不會受影響。'))return;try{await api(`/api/admin/templates/${id}`,{method:'DELETE'});await loadTemplates();renderTemplates()}catch(err){alert(err.message)}}
// ===== 中央表單設計中心：交接清冊（經理版／秘書版）＋工作日誌平台預設範本 =====
const HO_ROLES={manager:{label:'經理交接清冊',icon:'👔'},secretary:{label:'秘書交接清冊',icon:'🗂'}};
const HO_TYPES=[['text','單行文字'],['textarea','多行文字'],['number','數字'],['money','金額（元）'],['date','日期'],['tel','電話'],['yesno','是／否'],['radio','單選（按鈕）'],['select','單選（下拉）'],['checkbox','複選']];
const HO_OPTION_TYPES=['radio','select','checkbox'];
const HO_PREFILL=[['','不自動帶入'],['community','社區名稱'],['today','今天日期'],['user','填寫人姓名'],['user_position','填寫人職稱'],['last','沿用上次交接的答案']];
function dz(){return state.hoRole==='secretary'?state.handoverForms.secretary:state.config}
function renderFormDesigner(){
  const el=$('tab-form'),c=state.config||{},u=c.uiTexts||{};
  const role=state.hoRole||'manager',f=dz()||{pages:[],questions:[]};
  const open=state.designerOpen||'';
  el.innerHTML=`
  <div class="panel designer-intro">
    <div class="section-title">🛠 中央表單設計中心</div>
    <p><strong>這裡是平台提供標準雛型的地方。</strong> 交接清冊分成「經理版」與「秘書版」兩份獨立表單；工作日誌則在這裡設定平台預設範本，各社區會自動沿用。</p>
  </div>

  <div class="module-card-grid">
    <div class="panel module-card">
      <div class="module-card-icon">📋</div>
      <div class="module-card-body">
        <div class="section-title">交接清冊</div>
        <p><strong>經理版、秘書版各一份。</strong><br>題目、草稿與送出紀錄都分開；可以設定自動帶入、條件題與選項題。</p>
        <button class="secondary" onclick="toggleDesigner('checklistDesigner','checklistBtn')" id="checklistBtn">${open==='checklistDesigner'?'收起交接清冊設計':'進入交接清冊設計'}</button>
      </div>
    </div>

    <div class="panel module-card">
      <div class="module-card-icon">📝</div>
      <div class="module-card-body">
        <div class="section-title">工作日誌</div>
        <p><strong>平台預設範本。</strong><br>設定預設每日／每週、要記錄的區塊、電表項目、填寫人員與自訂項目；各社區可再自行調整。</p>
        <button class="secondary" onclick="toggleDesigner('journalDesigner','journalBtn')" id="journalBtn">${open==='journalDesigner'?'收起工作日誌設計':'進入工作日誌設計'}</button>
      </div>
    </div>

    <div class="panel module-card">
      <div class="module-card-icon">📄</div>
      <div class="module-card-body">
        <div class="section-title">公司內部制式表格</div>
        <p><strong>平台提供文件雛型。</strong><br>各公司管理員可以自行採用、修改、更新或刪除，成為自己的公司制式文件。</p>
        <button class="secondary" onclick="document.querySelector('[data-tab=templates]').click()">前往制式範本管理</button>
      </div>
    </div>
  </div>

  <div id="journalDesigner" class="designer-collapsible" style="display:${open==='journalDesigner'?'block':'none'}">
    <div id="journalTemplateEditor"><div class="panel">讀取工作日誌範本中…</div></div>
  </div>

  <div id="checklistDesigner" class="designer-collapsible" style="display:${open==='checklistDesigner'?'block':'none'}">
    <div class="panel">
      <div class="section-title">⚙️ 交接清冊設計</div>
      <p class="hint">請先選擇要編輯哪一份。兩份表單完全分開：經理在「經理交接清冊」填寫，秘書在「秘書交接清冊」填寫，草稿不會互相混在一起。</p>
      <div class="ho-role-tabs" role="tablist">${Object.entries(HO_ROLES).map(([k,m])=>`<button type="button" role="tab" aria-selected="${k===role}" class="${k===role?'':'secondary'}" onclick="switchHandoverRole('${k}')">${m.icon} ${m.label}<small>${(state.handoverForms?.[k]?.pages||[]).length} 頁・${(state.handoverForms?.[k]?.questions||[]).length} 題</small></button>`).join('')}</div>
      <div class="ho-smart-guide"><strong>💡 智慧題目怎麼用</strong><ul><li><b>自動帶入</b>：社區名稱、今天日期、填寫人姓名會自動填好；選「沿用上次交接的答案」的題目，會帶入這個社區上一份同類清冊的答案（例如鑰匙數量、聯絡窗口）。</li><li><b>條件題</b>：例如「是否有欠繳住戶？」選「是」，才出現「欠繳戶別與金額」。被隱藏的題目不會要求必填。</li><li><b>選項題</b>：是／否、單選、複選，讓現場人員用點的就能完成。</li></ul></div>
    </div>
    ${role==='manager'?`
    <div class="panel">
      <div class="section-title">① 網站基本名稱</div>
      <div class="field"><label>網站標題</label><input id="siteTitle" value="${escapeAttr(c.title||'社區交接清冊')}"></div>
      <div class="field"><label>副標題</label><input id="siteSubtitle" value="${escapeAttr(c.subtitle||'')}"></div>
    </div>
    <div class="panel">
      <div class="section-title">② 公司管理後台／登入頁顯示文字</div>
      <p class="hint">這些就是公司管理員畫面上看到的標題與說明文字。修改後按最下面的儲存即可套用。</p>
      <div class="editor-grid">
        <div><label>公司後台標題</label><input id="companyTitle" value="${escapeAttr(u.companyTitle||'公司管理後台')}"></div>
        <div><label>公司後台副標題</label><input id="companySubtitle" value="${escapeAttr(u.companySubtitle||'物業管理公司')}"></div>
        <div class="wide"><label>公司後台首頁說明</label><textarea id="companyIntro">${escapeHtml(u.companyIntro||'')}</textarea></div>
        <div><label>公司管理員登入標題</label><input id="companyLoginTitle" value="${escapeAttr(u.companyLoginTitle||'公司管理員登入')}"></div>
        <div><label>公司管理員登入說明</label><textarea id="companyLoginHint">${escapeHtml(u.companyLoginHint||'')}</textarea></div>
        <div><label>一般人員登入標題</label><input id="staffLoginTitle" value="${escapeAttr(u.staffLoginTitle||'物業人員登入')}"></div>
        <div><label>一般人員登入說明</label><textarea id="staffLoginHint">${escapeHtml(u.staffLoginHint||'')}</textarea></div>
      </div>
    </div>`:`
    <div class="panel">
      <div class="section-title">① 秘書版說明</div>
      <div class="editor-grid">
        <div><label>表單名稱</label><input id="hoFormTitle" value="${escapeAttr(f.title||'秘書交接清冊')}"></div>
        <div><label>副標題</label><input id="hoFormSubtitle" value="${escapeAttr(f.subtitle||'')}"></div>
      </div>
      <p class="hint">秘書版有平台預設題目（行政文書、帳務收費、住戶資料、印鑑文件、櫃台收發、系統帳號）。改壞了可以按最下面「還原平台預設題目」。</p>
    </div>`}
    <div class="panel">
      <div class="section-title">${role==='manager'?'③':'②'} ${HO_ROLES[role].label}｜頁面／母標題管理</div>
      <div id="pagesEditor"></div>
      <button class="secondary" onclick="addPage()">＋ 新增頁面</button>
    </div>
    <div class="panel">
      <div class="section-title">${role==='manager'?'④':'③'} ${HO_ROLES[role].label}｜題目／子標題管理</div>
      <p class="hint">題目會依「所在頁面＋子標題」自動分組顯示。題目 ↑↓ 只調整同一子標題內的順序。欄位代碼會用在 Word 範本的 {{欄位代碼}}。</p>
      <div id="questionsEditor"></div>
      <button class="secondary" onclick="addQuestion()">＋ 新增題目</button>
    </div>
    <div class="save-bar"><button onclick="saveFormConfig()">💾 儲存${HO_ROLES[role].label}</button>${role==='secretary'?'<button type="button" class="secondary" onclick="resetHandoverForm()">↺ 還原平台預設題目</button>':''}<span id="formSaveMsg"></span></div>
  </div>`;
  renderPagesEditor();renderQuestionsEditor();
  if(open==='journalDesigner')renderJournalDesigner();
}
function renderJournalDesigner(){
  const box=$('journalTemplateEditor');if(!box)return;
  if(!window.JournalTemplateAdmin){box.innerHTML='<div class="panel msg error">工作日誌設計模組尚未載入，請重新整理頁面。</div>';return;}
  window.JournalTemplateAdmin.render(box).catch(err=>{box.innerHTML=`<div class="panel msg error">${escapeHtml(err.message)}</div>`;});
}
function switchHandoverRole(role){
  if(!HO_ROLES[role]||role===state.hoRole)return;
  if(state.hoDirty&&!confirm('目前這份表單有尚未儲存的修改，確定要切換嗎？（未儲存的修改會保留在畫面上，切回來還在，但重新整理就會消失）'))return;
  if((state.hoRole||'manager')==='manager')captureManagerTexts();
  state.hoRole=role;renderFormDesigner();
}
function toggleDesigner(id,buttonId){
  const box=$(id);if(!box)return;
  const opening=box.style.display==='none'||!box.style.display;
  state.designerOpen=opening?id:'';
  document.querySelectorAll('.designer-collapsible').forEach(x=>{x.style.display=x.id===state.designerOpen?'block':'none'});
  $('checklistBtn').textContent=state.designerOpen==='checklistDesigner'?'收起交接清冊設計':'進入交接清冊設計';
  $('journalBtn').textContent=state.designerOpen==='journalDesigner'?'收起工作日誌設計':'進入工作日誌設計';
  if(opening&&id==='journalDesigner')renderJournalDesigner();
  if(opening)box.scrollIntoView({behavior:'smooth',block:'start'});
}
function hoMark(){state.hoDirty=true}
function renderPagesEditor(){const w=$('pagesEditor');const pages=dz().pages;w.innerHTML=pages.map((p,i)=>`<div class="page-card"><div class="move-buttons"><button class="icon-btn" onclick="movePage(${i},-1)" ${i===0?'disabled':''}>↑</button><button class="icon-btn" onclick="movePage(${i},1)" ${i===pages.length-1?'disabled':''}>↓</button></div><div class="page-number">第 ${i+1} 頁</div><div class="grow"><label>頁面／母標題</label><input value="${escapeAttr(p.title)}" oninput="dz().pages[${i}].title=this.value;hoMark()"><label>頁面說明</label><input value="${escapeAttr(p.description||'')}" oninput="dz().pages[${i}].description=this.value;hoMark()"></div><button class="danger" onclick="removePage(${i})">刪除頁面</button></div>`).join('')}
function groupNamesForPage(pageId){const seen=[];for(const q of dz().questions){if(q.pageId===pageId){const g=q.group||'填寫資料';if(!seen.includes(g))seen.push(g)}}return seen}
function renderQuestionsEditor(){const w=$('questionsEditor');const pages=dz().pages;w.innerHTML=pages.map((p,pi)=>{const groups=groupNamesForPage(p.id);const qs=groups.flatMap(g=>dz().questions.map((q,i)=>({q,i})).filter(x=>x.q.pageId===p.id&&(x.q.group||'填寫資料')===g));return `<div class="designer-page-block"><h3>第 ${pi+1} 頁｜${escapeHtml(p.title)}</h3>${groups.map(g=>`<div class="group-block"><div class="group-heading"><strong>▰ ${escapeHtml(g)}</strong><span>${qs.filter(x=>(x.q.group||'填寫資料')===g).length} 題</span></div>${qs.filter(x=>(x.q.group||'填寫資料')===g).map(x=>questionCard(x.i,x.q,qs.filter(y=>(y.q.group||'填寫資料')===g).map(y=>y.i))).join('')}</div>`).join('')||'<div class="empty">這一頁目前沒有題目。</div>'}</div>`}).join('')}
function hoQuestionLabel(q){return `${q.label||q.id}（${q.id}）`}
function questionCard(i,q,groupIndexes){
  const f=dz(),pos=groupIndexes.indexOf(i),type=q.type||'text',hasOpts=HO_OPTION_TYPES.includes(type);
  const cond=q.showIf&&q.showIf.q?q.showIf:null;const src=cond?f.questions.find(x=>x.id===cond.q):null;
  const srcOpts=src?(src.type==='yesno'?['是','否']:(HO_OPTION_TYPES.includes(src.type)?(src.options||[]):null)):null;
  const chips=[q.prefill?`<span class="ho-chip">⚡ ${escapeHtml((HO_PREFILL.find(x=>x[0]===q.prefill)||[])[1]||'')}</span>`:'',cond?`<span class="ho-chip cond">🔀 條件題</span>`:'',q.required?'<span class="ho-chip req">必填</span>':''].join('');
  const valueInput=cond&&cond.op!=='filled'?(srcOpts&&srcOpts.length?`<select onchange="dz().questions[${i}].showIf.value=this.value;hoMark()">${srcOpts.map(o=>`<option value="${escapeAttr(o)}" ${String(cond.value)===String(o)?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select>`:`<input value="${escapeAttr(cond.value||'')}" placeholder="答案等於…" oninput="dz().questions[${i}].showIf.value=this.value;hoMark()">`):'';
  return `<div class="question-card"><div class="move-buttons"><button class="icon-btn" onclick="moveQuestionWithinGroup(${i},-1)" ${pos<=0?'disabled':''}>↑</button><button class="icon-btn" onclick="moveQuestionWithinGroup(${i},1)" ${pos===groupIndexes.length-1?'disabled':''}>↓</button></div><div class="q-no">${pos+1}</div><div class="grow">${chips?`<div class="ho-chips">${chips}</div>`:''}<div class="editor-grid">
    <div><label>所在頁面</label><select onchange="changeQuestionPage(${i},this.value)">${f.pages.map(p=>`<option value="${escapeAttr(p.id)}" ${q.pageId===p.id?'selected':''}>${escapeHtml(p.title)}</option>`).join('')}</select></div>
    <div><label>子標題／小分類</label><input value="${escapeAttr(q.group||'填寫資料')}" oninput="dz().questions[${i}].group=this.value;hoMark()" onchange="renderQuestionsEditor()"></div>
    <div class="wide"><label>題目文字</label><input value="${escapeAttr(q.label)}" oninput="dz().questions[${i}].label=this.value;hoMark()"></div>
    <div><label>回答格式</label><select onchange="setQuestionType(${i},this.value)">${HO_TYPES.map(([v,l])=>`<option value="${v}" ${type===v?'selected':''}>${l}</option>`).join('')}</select></div>
    <div><label>是否必填</label><select onchange="dz().questions[${i}].required=this.value==='true';hoMark();renderQuestionsEditor()"><option value="true" ${q.required?'selected':''}>必填</option><option value="false" ${!q.required?'selected':''}>非必填</option></select></div>
    ${hasOpts?`<div class="wide"><label>選項（一行一個）</label><textarea rows="3" oninput="dz().questions[${i}].options=this.value.split(/\\n/).map(x=>x.trim()).filter(Boolean);hoMark()">${escapeHtml((q.options||[]).join('\n'))}</textarea></div>`:''}
    <div class="wide"><label>填寫提示（顯示在題目下方，可留白）</label><input value="${escapeAttr(q.help||'')}" placeholder="例如：最後使用的號碼、剩餘本數" oninput="dz().questions[${i}].help=this.value;hoMark()"></div>
    <div><label>⚡ 自動帶入</label><select onchange="dz().questions[${i}].prefill=this.value;hoMark();renderQuestionsEditor()">${HO_PREFILL.map(([v,l])=>`<option value="${v}" ${(q.prefill||'')===v?'selected':''}>${l}</option>`).join('')}</select></div>
    <div><label>🔀 只在這個條件成立時顯示</label><select onchange="setQuestionCondition(${i},this.value)"><option value="">一律顯示</option>${f.questions.filter(x=>x.id&&x.id!==q.id).map(x=>`<option value="${escapeAttr(x.id)}" ${cond&&cond.q===x.id?'selected':''}>${escapeHtml(hoQuestionLabel(x))}</option>`).join('')}</select></div>
    ${cond?`<div class="wide ho-cond-row"><label>條件</label><div><select onchange="dz().questions[${i}].showIf.op=this.value;hoMark();renderQuestionsEditor()"><option value="eq" ${cond.op==='eq'||!cond.op?'selected':''}>答案等於</option><option value="neq" ${cond.op==='neq'?'selected':''}>答案不等於</option><option value="filled" ${cond.op==='filled'?'selected':''}>有填寫任何答案</option></select>${valueInput}</div></div>`:''}
    <div class="wide"><label>欄位代碼（Word 範本使用）</label><input class="code-input" value="${escapeAttr(q.id)}" oninput="renameQuestionId(${i},this.value.replace(/[^A-Za-z0-9_]/g,'_'))" onchange="renderQuestionsEditor()"></div>
  </div></div><button class="danger" onclick="removeQuestion(${i})">刪除</button></div>`;
}
function setQuestionType(i,type){const q=dz().questions[i];q.type=type;if(HO_OPTION_TYPES.includes(type)&&!(q.options||[]).length)q.options=['選項一','選項二'];if(!HO_OPTION_TYPES.includes(type))delete q.options;hoMark();renderQuestionsEditor()}
function setQuestionCondition(i,srcId){const f=dz(),q=f.questions[i];if(!srcId){delete q.showIf;}else{const src=f.questions.find(x=>x.id===srcId);const first=src?.type==='yesno'?'是':(src?.options||[])[0]||'';q.showIf={q:srcId,op:'eq',value:first};}hoMark();renderQuestionsEditor()}
function renameQuestionId(i,next){const f=dz(),prev=f.questions[i].id;f.questions[i].id=next;for(const x of f.questions){if(x.showIf&&x.showIf.q===prev)x.showIf.q=next;}hoMark()}
function addPage(){captureManagerTexts();dz().pages.push({id:'page_'+Date.now(),title:'新頁面',description:''});hoMark();renderFormDesigner()}
function removePage(i){const f=dz(),p=f.pages[i];if(f.questions.some(q=>q.pageId===p.id)){alert('請先把這一頁的題目移到其他頁面。');return}if(f.pages.length<=1){alert('至少要保留一個頁面。');return}captureManagerTexts();f.pages.splice(i,1);hoMark();renderFormDesigner()}
function movePage(i,d){const f=dz(),j=i+d;if(j<0||j>=f.pages.length)return;[f.pages[i],f.pages[j]]=[f.pages[j],f.pages[i]];hoMark();renderPagesEditor();renderQuestionsEditor()}
function addQuestion(){const f=dz();if(!f.pages.length)return;const p=f.pages[0];const groups=groupNamesForPage(p.id);f.questions.push({id:'new_field_'+Date.now(),label:'新題目',type:'text',required:false,pageId:p.id,group:groups[0]||'填寫資料'});hoMark();renderQuestionsEditor()}
function changeQuestionPage(i,pageId){const f=dz();f.questions[i].pageId=pageId;const groups=groupNamesForPage(pageId);if(!groups.includes(f.questions[i].group))f.questions[i].group=groups[0]||'填寫資料';hoMark();renderQuestionsEditor()}
function moveQuestionWithinGroup(i,d){const f=dz(),q=f.questions[i],same=f.questions.map((x,idx)=>({x,idx})).filter(o=>o.x.pageId===q.pageId&&(o.x.group||'填寫資料')===(q.group||'填寫資料')).map(o=>o.idx);const pos=same.indexOf(i),j=pos+d;if(j<0||j>=same.length)return;const target=same[j];[f.questions[i],f.questions[target]]=[f.questions[target],f.questions[i]];hoMark();renderQuestionsEditor()}
function removeQuestion(i){const f=dz(),id=f.questions[i].id;const deps=f.questions.filter(x=>x.showIf&&x.showIf.q===id);if(deps.length&&!confirm(`有 ${deps.length} 題的顯示條件依賴這一題，刪除後那些題目會改成一律顯示。確定刪除嗎？`))return;for(const x of deps)delete x.showIf;f.questions.splice(i,1);hoMark();renderQuestionsEditor()}
function captureManagerTexts(){if((state.hoRole||'manager')!=='manager'||!$('siteTitle'))return;state.config.title=$('siteTitle').value;state.config.subtitle=$('siteSubtitle').value;state.config.uiTexts={...(state.config.uiTexts||{}),companyTitle:$('companyTitle').value,companySubtitle:$('companySubtitle').value,companyIntro:$('companyIntro').value,companyLoginTitle:$('companyLoginTitle').value,companyLoginHint:$('companyLoginHint').value,staffLoginTitle:$('staffLoginTitle').value,staffLoginHint:$('staffLoginHint').value};}
async function saveFormConfig(){
  const msg=$('formSaveMsg'),role=state.hoRole||'manager',f=dz();
  if(role==='manager')captureManagerTexts();else{f.title=$('hoFormTitle')?.value||f.title;f.subtitle=$('hoFormSubtitle')?.value??f.subtitle;}
  const ids=f.questions.map(q=>String(q.id||'').trim());if(ids.some(x=>!x)||new Set(ids).size!==ids.length){msg.innerHTML='<span class="msg error inline-msg">欄位代碼不可空白或重複。</span>';return}
  try{
    if(role==='manager')await api('/api/admin/form-config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.config)});
    else{const r=await api('/api/admin/handover-forms/secretary',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});state.handoverForms.secretary=r.form||f;}
    state.hoDirty=false;msg.innerHTML=`<span class="msg success inline-msg">✓ ${HO_ROLES[role].label}已儲存！現場人員重新開啟就會套用。</span>`;setTimeout(()=>{if(msg)msg.innerHTML=''},5000)
  }catch(err){msg.innerHTML=`<span class="msg error inline-msg">${escapeHtml(err.message)}</span>`}
}
async function resetHandoverForm(){
  if(!confirm('確定要把秘書交接清冊還原成平台預設題目嗎？目前的秘書版題目設定會被覆蓋（已送出的紀錄不受影響）。'))return;
  try{const r=await api('/api/admin/handover-forms/secretary/reset',{method:'POST'});state.handoverForms.secretary=r.form;state.hoDirty=false;renderFormDesigner();const msg=$('formSaveMsg');if(msg)msg.innerHTML='<span class="msg success inline-msg">✓ 已還原平台預設題目</span>';}catch(err){alert(err.message)}
}

async function loadCustomization(){
  if(!state.tenants.length) state.tenants=await api('/api/admin/tenants');
  const c=state.customization;
  // mode: platform = 平台標準預設；company = 指定企業客製
  if(c.mode==='platform'){
    const d=await api('/api/admin/menu-config');
    c.tenantId=null;
    c.global=(d?.[c.scope]||[]).map(x=>({...x}));
    c.overrides={};
    c.items=c.global.map(x=>({...x}));
    c.openIds=[];
    c.savedSnapshot=customMenuSnapshot(c.items);
    return;
  }
  const active=c.tenantId||state.tenants.find(t=>t.status==='active')?.id||state.tenants[0]?.id;
  c.tenantId=active?Number(active):null;
  if(!active){c.global=[];c.items=[];c.overrides={};return;}
  const d=await api(`/api/admin/menu-config?tenant_id=${encodeURIComponent(active)}`);
  c.global=(d.global?.[c.scope]||[]).map(x=>({...x}));
  c.overrides=d.overrides||{};
  c.items=(d.overrides?.[c.scope]||d.global?.[c.scope]||[]).map(x=>({...x}));
  c.openIds=[];
  c.savedSnapshot=customMenuSnapshot(c.items);
}
function customMenuChildren(items,parentId){
  return items.filter(x=>String(x.parentId||'')===String(parentId||''));
}
function customMenuDescendantIds(items,id){
  const out=[];
  const walk=(pid)=>{for(const child of customMenuChildren(items,pid)){out.push(child.id);walk(child.id)}};
  walk(id);return out;
}
function normalizeCustomMenuTree(items){
  const byParent=new Map();
  for(const item of items){const key=String(item.parentId||'');if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(item)}
  const out=[];
  const walk=(parentId)=>{for(const item of byParent.get(String(parentId||''))||[]){out.push(item);walk(item.id)}};
  walk('');
  for(const item of items) if(!out.includes(item)) out.push(item);
  return out;
}
function customMenuTreeRows(items,parentId=null,depth=0,openIds=new Set(),ancestorsVisible=true){
  const nodes=customMenuChildren(items,parentId);
  return nodes.map((item)=>{
    const children=customMenuChildren(items,item.id);
    const hasChildren=children.length>0;
    const open=openIds.has(String(item.id));
    const pos=nodes.findIndex(x=>String(x.id)===String(item.id));
    const visible=ancestorsVisible;
    const childRows=customMenuTreeRows(items,item.id,depth+1,openIds,visible&&open);
    const childButton=`<button type="button" class="menu-tree-add-child secondary" onclick="addCustomChild('${escapeAttr(String(item.id))}')">＋ 子目錄</button>`;
    const toggle=hasChildren
      ? `<button type="button" class="menu-tree-toggle" onclick="toggleCustomMenuNode('${escapeAttr(String(item.id))}')" aria-expanded="${open?'true':'false'}" title="${open?'收合子目錄':'展開子目錄'}">${open?'−':'＋'}</button>`
      : '<span class="menu-tree-toggle-placeholder"></span>';
    const editButton=`<button type="button" class="secondary menu-tree-edit" onclick="openCustomMenuEditor('${escapeAttr(String(item.id))}')">編輯</button>`;
    const nodeClass=`custom-menu-node custom-menu-node-v588${visible?' is-v588-visible':''}`;
    return `<div class="${nodeClass}" data-menu-id="${escapeAttr(String(item.id))}" data-parent-id="${escapeAttr(String(item.parentId||''))}" data-depth="${depth}">
      <div class="custom-menu-node-head" style="padding-left:${10+depth*18}px">
        ${toggle}<span class="custom-menu-tree-icon">${escapeHtml(item.icon||'•')}</span><strong>${escapeHtml(item.label||'未命名')}</strong>${hasChildren?`<span class="custom-menu-child-count">${children.length} 個子目錄</span>`:''}
        <div class="custom-menu-node-actions">
          ${editButton}
          <button type="button" class="icon-btn" onclick="moveCustomMenuTree('${escapeAttr(String(item.id))}',-1)" ${pos===0?'disabled':''} title="同層上移">↑</button>
          <button type="button" class="icon-btn" onclick="moveCustomMenuTree('${escapeAttr(String(item.id))}',1)" ${pos===nodes.length-1?'disabled':''} title="同層下移">↓</button>
          ${childButton}
        </div>
      </div>
    </div>${childRows}`;
  }).join('');
}

function renderCustomizationBase(){
  const el=$('tab-customization'); if(!el)return;
  const c=state.customization;
  c.items=normalizeCustomMenuTree(c.items||[]);
  const isPlatform=c.mode==='platform';
  const t=state.tenants.find(x=>Number(x.id)===Number(c.tenantId));
  const targetOptions=`<option value="platform" ${isPlatform?'selected':''}>🌐 平台預設（所有企業的標準目錄）</option>${state.tenants.map(x=>`<option value="tenant:${x.id}" ${!isPlatform&&Number(x.id)===Number(c.tenantId)?'selected':''}>🏢 ${escapeHtml(x.name)}（${escapeHtml(x.code)}）</option>`).join('')}`;
  const scopeOptions=`<option value="company" ${c.scope==='company'?'selected':''}>🏢 公司內勤工作目錄</option><option value="staff" ${c.scope==='staff'?'selected':''}>🏠 社區駐點工作目錄</option>`;
  const roots=customMenuChildren(c.items,null);
  const openIds=new Set((c.openIds||[]).map(String));
  const rootRows=customMenuTreeRows(c.items,null,0,openIds);
  const overrideItems=!isPlatform && Array.isArray(c.overrides?.[c.scope])?c.overrides[c.scope]:null;
  const globalItems=Array.isArray(c.global)?c.global:[];
  // 與後端一致：先把平台新增項目補入，再判斷實際生效目錄是否仍有企業差異。
  const mergeMenu=(base,custom)=>{
    if(!Array.isArray(custom))return base||[];
    const byId=new Map(custom.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const semanticKey=x=>`${String(x?.parentId??'')}::${String(x?.action??'')}`;
    const bySemantic=new Map();
    for(const x of custom)if(x&&x.id!=null&&x.action)bySemantic.set(semanticKey(x),x);
    const used=new Set();
    const baseIds=new Set((base||[]).filter(x=>x&&x.id!=null).map(x=>String(x.id)));
    const merged=(base||[]).map(x=>{
      let item=byId.get(String(x.id));
      if(!item&&x?.action)item=bySemantic.get(semanticKey(x));
      if(item&&item.id!=null)used.add(String(item.id));
      return item?{...x,...item,id:x.id}:x;
    });
    for(const x of custom)if(x&&x.id!=null&&!baseIds.has(String(x.id))&&!used.has(String(x.id)))merged.push(x);
    return merged;
  };
  const canonicalMenu=items=>JSON.stringify((items||[]).map(x=>({
    id:String(x.id??''),parentId:x.parentId==null?null:String(x.parentId),
    icon:String(x.icon??''),label:String(x.label??''),action:String(x.action??''),
    enabled:x.enabled!==false,sortOrder:Number(x.sortOrder??x.sort_order??0)
  })).sort((a,b)=>a.id.localeCompare(b.id)));
  const hasOverride=!!overrideItems;
  const effectiveTenantItems=hasOverride?mergeMenu(globalItems,overrideItems):globalItems;
  const effectiveMatchesPlatform=canonicalMenu(effectiveTenantItems)===canonicalMenu(globalItems);
  const title=isPlatform?'🌐 平台標準工作目錄':'🧩 企業客製化工作目錄';
  const intro=isPlatform?'這裡是整個平台的「基本標準目錄」。所有沒有另外客製的企業都會使用這套目錄；企業客製化不會反過來修改這裡。':'這裡只調整指定企業的工作目錄。只有該企業會受到影響，不會改變其他企業。';
  const status=isPlatform?'目前正在編輯：平台預設｜這套目錄會作為所有企業的基準。':`目前：${escapeHtml(t?.name||'尚未選擇公司')}｜${!hasOverride?'目前沿用平台預設目錄':effectiveMatchesPlatform?'目前目錄內容與平台預設一致（舊覆寫仍存在）':'已使用企業客製目錄'}`;
  el.innerHTML=`<div class="panel"><div class="section-title">${title}</div><p>${intro}</p><div class="editor-grid"><div><label>設定對象</label><select id="customTargetSelect">${targetOptions}</select></div><div><label>工作空間</label><select id="customScopeSelect">${scopeOptions}</select></div></div><p class="hint">${status}</p></div><div class="panel"><div class="section-title">📂 ${c.scope==='company'?'公司內勤':'社區駐點'}工作目錄</div><p class="hint">母目錄與子目錄會自動整理成樹狀結構。新增子目錄後會直接掛在母目錄下方；點「＋／−」可展開或收合。上下箭頭只會調整同一層級的順序。</p><div class="custom-menu-tree">${rootRows||'<div class="empty">目前沒有目錄項目。</div>'}</div><div class="form-nav"><button class="secondary" onclick="addCustomMenu()">＋ 新增母目錄</button>${isPlatform?'':'<button class="secondary" onclick="resetCustomMenu()">↩ 此工作空間恢復平台預設</button><button class="secondary" onclick="resetAllCustomMenus()">⚠️ 清除這家公司兩份舊目錄覆寫</button>'}<button onclick="saveCustomMenu()">💾 ${isPlatform?'儲存平台預設':'儲存這家公司設定'}</button><span id="customSaveMsg"></span></div></div><div class="panel"><div class="section-title">🔐 權限分流說明</div><div class="guide-grid"><div><strong>🏢 內勤</strong><br>公司財務、會計、總務、人事、公司資源等內勤工作。</div><div><strong>🏠 駐點</strong><br>代辦、工作日誌、管理委員會、住戶、廠商、交接等社區工作。</div><div><strong>🏢＋🏠 內勤＋兼任駐點</strong><br>同一人可同時擁有兩個工作空間的可處理項目。</div><div><strong>🧩 企業客製</strong><br>企業若有特殊需求，可在「設定對象」選擇公司後獨立調整，不影響其他企業。</div></div></div>`;
  $('customTargetSelect').addEventListener('change',async e=>{const v=e.target.value;if(v==='platform'){c.mode='platform';c.tenantId=null;}else{c.mode='company';c.tenantId=Number(v.split(':')[1]);}c.openIds=[];await loadCustomization();renderCustomization();});
  $('customScopeSelect').addEventListener('change',async e=>{c.scope=e.target.value;c.openIds=[];await loadCustomization();renderCustomization();});
}
// ===== 目錄編輯器強化：拖拉排序、快速顯示／隱藏、即時預覽、未儲存提醒 =====
function customMenuSnapshot(items){return JSON.stringify(normalizeCustomMenuTree((items||[]).map(x=>({...x}))).map(x=>[String(x.id),x.parentId==null?null:String(x.parentId),x.icon||'',x.label||'',x.action||'',x.enabled!==false]));}
function customMenuDirty(){const c=state.customization;return c.savedSnapshot!==undefined&&customMenuSnapshot(c.items)!==c.savedSnapshot;}
function renderCustomization(){
  renderCustomizationBase();
  const c=state.customization,tree=document.querySelector('#tab-customization .custom-menu-tree');if(!tree)return;
  const panel=tree.closest('.panel');
  // 兩欄：左邊編輯、右邊即時預覽
  const wrap=document.createElement('div');wrap.className='custom-menu-workbench';
  panel.parentNode.insertBefore(wrap,panel);wrap.appendChild(panel);
  const aside=document.createElement('aside');aside.className='panel custom-menu-live';wrap.appendChild(aside);
  const hint=panel.querySelector('p.hint');if(hint)hint.textContent='拖拉左側「⠿」可調整同一層的順序；點「👁」可快速顯示／隱藏。修改後記得按「儲存」，右側會即時顯示目前的樣子。';
  tree.querySelectorAll('.custom-menu-node').forEach(node=>{
    const id=node.dataset.menuId,item=c.items.find(x=>String(x.id)===String(id));if(!item)return;
    const head=node.querySelector('.custom-menu-node-head');
    const grip=document.createElement('span');grip.className='custom-menu-grip';grip.textContent='⠿';grip.title='拖拉調整順序';grip.setAttribute('aria-hidden','true');head.prepend(grip);
    head.draggable=true;node.classList.toggle('is-hidden-item',item.enabled===false);
    const eye=document.createElement('button');eye.type='button';eye.className='icon-btn custom-menu-eye';eye.textContent=item.enabled===false?'🚫':'👁';eye.title=item.enabled===false?'目前隱藏，點一下改為顯示':'目前顯示，點一下改為隱藏';
    eye.addEventListener('click',()=>{item.enabled=item.enabled===false;renderCustomization();});
    head.querySelector('.custom-menu-node-actions')?.prepend(eye);
    head.addEventListener('dragstart',e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(id));tree.dataset.dragId=String(id);tree.dataset.dragParent=String(item.parentId||'');node.classList.add('is-dragging');});
    head.addEventListener('dragend',()=>{node.classList.remove('is-dragging');tree.querySelectorAll('.drop-before,.drop-after').forEach(x=>x.classList.remove('drop-before','drop-after'));});
    head.addEventListener('dragover',e=>{if(tree.dataset.dragParent!==String(item.parentId||'')||tree.dataset.dragId===String(id))return;e.preventDefault();const r=head.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;head.classList.toggle('drop-after',after);head.classList.toggle('drop-before',!after);});
    head.addEventListener('dragleave',()=>head.classList.remove('drop-before','drop-after'));
    head.addEventListener('drop',e=>{e.preventDefault();const after=head.classList.contains('drop-after');head.classList.remove('drop-before','drop-after');const dragId=tree.dataset.dragId;if(dragId&&tree.dataset.dragParent===String(item.parentId||''))reorderCustomMenuSibling(dragId,id,after);});
  });
  // 即時預覽
  const visible=c.items.filter(x=>x.enabled!==false);
  const vIds=new Set(visible.map(x=>String(x.id)));
  const roots=visible.filter(x=>!x.parentId||!vIds.has(String(x.parentId)));
  const kids=pid=>visible.filter(x=>String(x.parentId||'')===String(pid));
  const scopeName=c.scope==='company'?'公司內勤':'現場人員';
  const tenantName=c.mode==='platform'?'平台預設':(state.tenants.find(x=>Number(x.id)===Number(c.tenantId))?.name||'');
  const dirty=customMenuDirty();
  aside.innerHTML=`<div class="section-title">👀 ${scopeName}看到的目錄</div><p class="hint">${escapeHtml(tenantName)}｜依左側目前內容即時顯示（隱藏項目不列出）。實際人員還會依個人工作權限再過濾。</p>
   ${dirty?'<div class="custom-menu-dirty">● 有尚未儲存的變更</div>':'<div class="custom-menu-clean">✓ 與已儲存內容一致</div>'}
   <div class="live-sidebar"><div class="live-sidebar-head">${c.scope==='company'?'公司管理後台':'人員工作台'}</div>${roots.map(r=>{const ch=kids(r.id);return `<div class="live-item">● ${escapeHtml(r.label||'未命名')}${ch.length?'<span>›</span>':''}</div>${ch.map(x=>`<div class="live-item is-child">· ${escapeHtml(x.label||'未命名')}</div>`).join('')}`;}).join('')||'<div class="empty">沒有顯示中的目錄</div>'}</div>
   ${c.mode!=='platform'&&c.tenantId?`<button type="button" class="secondary live-preview-btn" onclick="openTenantPreviewFromCustom()">🧪 在模組測試中心看實際畫面${dirty?'（顯示已儲存版本）':''}</button>`:''}`;
  // 儲存按鈕旁的提醒
  const saveMsg=$('customSaveMsg');if(saveMsg&&dirty&&!saveMsg.textContent)saveMsg.innerHTML='<span class="hint">尚未儲存</span>';
}
function reorderCustomMenuSibling(dragId,targetId,after){
  const items=normalizeCustomMenuTree(state.customization.items);
  const drag=items.find(x=>String(x.id)===String(dragId));if(!drag)return;
  const siblings=customMenuChildren(items,drag.parentId||null);
  const order=siblings.filter(x=>String(x.id)!==String(dragId));
  let idx=order.findIndex(x=>String(x.id)===String(targetId));if(idx<0)return;
  order.splice(after?idx+1:idx,0,drag);
  const block=id=>[items.find(x=>String(x.id)===String(id)),...customMenuDescendantIds(items,id).map(d=>items.find(x=>x.id===d))].filter(Boolean);
  const moving=new Set();for(const s of siblings){for(const x of block(s.id))moving.add(x);}
  const first=items.findIndex(x=>moving.has(x));
  const rest=items.filter(x=>!moving.has(x));
  const before=items.slice(0,first).filter(x=>!moving.has(x)).length;
  rest.splice(before,0,...order.flatMap(s=>block(s.id)));
  state.customization.items=normalizeCustomMenuTree(rest);
  renderCustomization();
}
function openTenantPreviewFromCustom(){const c=state.customization;modulePreview.tenantId=Number(c.tenantId)||0;modulePreview.scope=c.scope;modulePreview.activeId=null;switchAdminTab('moduleTest');}
window.addEventListener('beforeunload',e=>{if(customMenuDirty()&&$('tab-customization')?.style.display!=='none'){e.preventDefault();e.returnValue='';}});
function toggleCustomMenuNode(id){
  const c=state.customization;
  const key=String(id);
  const open=new Set((c.openIds||[]).map(String));
  if(open.has(key)) open.delete(key); else open.add(key);
  c.openIds=[...open];
  // V5.8.8：不重新渲染整棵樹；直接依照 parentId 更新所有後代的可見狀態，避免舊版 nested container/CSS 互相干擾。
  const root=document.querySelector('.custom-menu-tree');
  if(!root)return;
  const nodes=[...root.querySelectorAll('.custom-menu-node-v588')];
  const isOpen=(x)=>open.has(String(x));
  const byId=new Map(nodes.map(n=>[String(n.dataset.menuId),n]));
  const visibleCache=new Map();
  const calcVisible=(node)=>{
    const id=String(node.dataset.menuId);
    if(visibleCache.has(id))return visibleCache.get(id);
    const parent=String(node.dataset.parentId||'');
    if(!parent){visibleCache.set(id,true);return true;}
    const p=byId.get(parent);
    const value=!!p && isOpen(parent) && calcVisible(p);
    visibleCache.set(id,value);return value;
  };
  nodes.forEach(node=>{
    const visible=calcVisible(node);
    node.classList.toggle('is-v588-visible',visible);
  });
  const button=byId.get(key)?.querySelector('.menu-tree-toggle');
  if(button){button.textContent=isOpen(key)?'−':'＋';button.setAttribute('aria-expanded',isOpen(key)?'true':'false');button.title=isOpen(key)?'收合子目錄':'展開子目錄';}
}

function ensureCustomMenuModal(){
  let modal=document.getElementById('customMenuEditorModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.id='customMenuEditorModal';modal.className='modal-backdrop';modal.style.display='none';
  modal.innerHTML=`<div class="modal custom-menu-editor-modal" role="dialog" aria-modal="true" aria-labelledby="customMenuEditorTitle">
    <button type="button" class="modal-close" onclick="closeCustomMenuEditor()" aria-label="關閉">×</button>
    <h2 id="customMenuEditorTitle">📂 編輯目錄</h2>
    <p id="customMenuEditorNote" class="modal-note">新增後會自動依母目錄整理；不會立即展開整棵目錄。</p>
    <div class="editor-grid custom-menu-modal-grid">
      <div><label>圖示</label><input id="customMenuModalIcon" placeholder="例如 📄"></div>
      <div><label>名稱</label><input id="customMenuModalLabel" placeholder="例如 公司制式文件"></div>
      <div><label>動作代碼</label><input id="customMenuModalAction" placeholder="例如 manage-templates"></div>
      <div><label>上層目錄</label><select id="customMenuModalParent"></select></div>
      <div><label>啟用</label><select id="customMenuModalEnabled"><option value="1">顯示</option><option value="0">隱藏</option></select></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="secondary" onclick="closeCustomMenuEditor()">取消</button>
      <button type="button" id="customMenuModalDelete" class="danger" style="display:none" onclick="deleteCustomMenuFromModal()">刪除</button>
      <button type="button" onclick="saveCustomMenuFromModal()">💾 儲存</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)closeCustomMenuEditor()});
  return modal;
}
let customMenuEditorState={id:null,parentId:null,mode:'add'};
function fillCustomMenuParentOptions(selectedId,parentId){
  const select=document.getElementById('customMenuModalParent');if(!select)return;
  const items=state.customization.items||[];
  const descendants=selectedId?new Set(customMenuDescendantIds(items,selectedId)):new Set();
  const roots=normalizeCustomMenuTree(items);
  const options=['<option value="">最上層（母目錄）</option>'];
  const add=(pid,depth)=>{
    const children=customMenuChildren(items,pid);
    for(const x of children){
      if(String(x.id)===String(selectedId)||descendants.has(x.id))continue;
      options.push(`<option value="${escapeAttr(String(x.id))}" ${String(parentId||'')===String(x.id)?'selected':''}>${'　'.repeat(depth)}${escapeHtml(x.icon||'•')} ${escapeHtml(x.label||'未命名')}</option>`);
      add(x.id,depth+1);
    }
  };
  add(null,0);select.innerHTML=options.join('');
}
function openCustomMenuEditor(id=null,parentId=null){
  const modal=ensureCustomMenuModal();
  const item=id?state.customization.items.find(x=>String(x.id)===String(id)):null;
  customMenuEditorState={id:item?item.id:null,parentId:item?item.parentId:(parentId||null),mode:item?'edit':'add'};
  document.getElementById('customMenuEditorTitle').textContent=item?'📂 編輯目錄':'＋ 新增目錄';
  document.getElementById('customMenuEditorNote').textContent=item?'修改後只會改變目前這一筆目錄。子目錄會維持在它的母目錄下面。':'新增後會依你選擇的母目錄自動歸位；儲存後預設收合，不會把整棵目錄攤開。';
  document.getElementById('customMenuModalIcon').value=item?.icon||'📄';
  document.getElementById('customMenuModalLabel').value=item?.label||'新目錄';
  document.getElementById('customMenuModalAction').value=item?.action||'placeholder';
  document.getElementById('customMenuModalEnabled').value=item?.enabled===false?'0':'1';
  fillCustomMenuParentOptions(item?.id||null,item?.parentId??parentId??null);
  document.getElementById('customMenuModalDelete').style.display=item?'inline-flex':'none';
  modal.style.display='flex';setTimeout(()=>document.getElementById('customMenuModalLabel').focus(),0);
}
function closeCustomMenuEditor(){const modal=document.getElementById('customMenuEditorModal');if(modal)modal.style.display='none';}
function saveCustomMenuFromModal(){
  const label=document.getElementById('customMenuModalLabel').value.trim();
  if(!label){alert('請輸入目錄名稱。');return;}
  const item=customMenuEditorState.id?state.customization.items.find(x=>String(x.id)===String(customMenuEditorState.id)):null;
  const data={icon:document.getElementById('customMenuModalIcon').value.trim()||'📄',label,action:document.getElementById('customMenuModalAction').value.trim()||'placeholder',parentId:document.getElementById('customMenuModalParent').value||null,enabled:document.getElementById('customMenuModalEnabled').value==='1'};
  if(item)Object.assign(item,data);else state.customization.items.push({id:'custom_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),...data});
  if(data.parentId){const open=new Set((state.customization.openIds||[]).map(String));open.add(String(data.parentId));state.customization.openIds=[...open];}
  closeCustomMenuEditor();renderCustomization();
}
function deleteCustomMenuFromModal(){
  const id=customMenuEditorState.id;if(!id)return;
  const item=state.customization.items.find(x=>String(x.id)===String(id));if(!item)return;
  const descendants=new Set(customMenuDescendantIds(state.customization.items,item.id));
  const count=descendants.size;
  if(count&&!confirm(`「${item.label||'未命名'}」底下還有 ${count} 個子目錄，刪除後會一併刪除。確定嗎？`))return;
  state.customization.items=state.customization.items.filter(x=>String(x.id)!==String(id)&&!descendants.has(x.id));
  state.customization.openIds=(state.customization.openIds||[]).filter(x=>String(x)!==String(id)&&!descendants.has(x));
  closeCustomMenuEditor();renderCustomization();
}
function setCustomMenuField(id,key,value){const item=state.customization.items.find(x=>String(x.id)===String(id));if(!item)return;item[key]=value;}
function addCustomMenu(){openCustomMenuEditor(null,null)}
function addCustomChild(parentId){openCustomMenuEditor(null,parentId)}
function removeCustomMenuById(id){
  const item=state.customization.items.find(x=>String(x.id)===String(id));if(!item)return;
  const descendants=new Set(customMenuDescendantIds(state.customization.items,item.id));
  const count=1+descendants.size;
  if(count>1&&!confirm(`「${item.label||'未命名'}」底下還有 ${count-1} 個子目錄，刪除後會一併刪除。確定嗎？`))return;
  state.customization.items=state.customization.items.filter(x=>String(x.id)!==String(id)&&!descendants.has(x.id));
  state.customization.openIds=(state.customization.openIds||[]).filter(x=>String(x)!==String(id)&&!descendants.has(x));
  renderCustomization();
}
function removeCustomMenu(i){const item=state.customization.items[i];if(item)removeCustomMenuById(item.id)}
function moveCustomMenuTree(id,d){
  const items=normalizeCustomMenuTree(state.customization.items);
  const item=items.find(x=>String(x.id)===String(id));if(!item)return;
  const siblings=customMenuChildren(items,item.parentId||null);
  const pos=siblings.findIndex(x=>String(x.id)===String(id));
  const targetPos=pos+d;if(targetPos<0||targetPos>=siblings.length)return;
  const newSiblingOrder=siblings.slice();
  [newSiblingOrder[pos],newSiblingOrder[targetPos]]=[newSiblingOrder[targetPos],newSiblingOrder[pos]];
  const byId=new Map(items.map(x=>[x.id,x]));
  const siblingSet=new Set(siblings.map(x=>x.id));
  const insertAt=items.findIndex(x=>siblingSet.has(x.id));
  const removedIds=new Set();
  for(const s of siblings){removedIds.add(s.id);for(const did of customMenuDescendantIds(items,s.id))removedIds.add(did);}
  const remaining=items.filter(x=>!removedIds.has(x.id));
  let removedBefore=0;
  for(let i=0;i<insertAt;i++){if(removedIds.has(items[i].id))removedBefore++;}
  const adjustedInsertAt=insertAt-removedBefore;
  const newBlocks=[];
  for(const s of newSiblingOrder){
    newBlocks.push(byId.get(s.id));
    for(const did of customMenuDescendantIds(items,s.id))newBlocks.push(byId.get(did));
  }
  remaining.splice(adjustedInsertAt,0,...newBlocks);
  state.customization.items=normalizeCustomMenuTree(remaining);
  renderCustomization();
}
async function saveCustomMenu(){
  try{
    state.customization.items=normalizeCustomMenuTree(state.customization.items);
    const body={scope:state.customization.scope,items:state.customization.items};
    if(state.customization.mode!=='platform') body.tenant_id=state.customization.tenantId;
    await api('/api/admin/menu-config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    $('customSaveMsg').innerHTML=`<span class="msg success inline-msg">✓ 已儲存${state.customization.mode==='platform'?'平台預設':'這家公司'}目錄</span>`;
    await loadCustomization();renderCustomization();
  }catch(err){$('customSaveMsg').innerHTML=`<span class="msg error inline-msg">${escapeHtml(err.message)}</span>`}
}
async function resetCustomMenu(){if(!confirm('確定移除這家公司目前工作空間的客製目錄覆寫，改為直接繼承平台預設嗎？之後平台預設更新時，這家公司也會同步更新。此操作只影響所選工作目錄，不會刪除人員、住戶名冊或其他業務資料。'))return;try{await api('/api/admin/menu-config/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:state.customization.scope,tenant_id:state.customization.tenantId})});await loadCustomization();renderCustomization();}catch(err){alert(err.message)}}
async function resetAllCustomMenus(){
  const tenantId=state.customization.tenantId;
  const tenant=state.tenants.find(x=>Number(x.id)===Number(tenantId));
  if(!tenantId||!tenant){alert('請先選擇要清理的公司。');return;}
  const ok=confirm(`⚠️ 最後確認：要清除「${tenant.name}」的公司內勤與社區駐點兩份舊目錄覆寫嗎？\n\n這會讓兩個工作空間改為使用平台預設目錄。若有自訂項目，這些自訂目錄設定會被移除；不會刪除員工、住戶、社區、班表或其他業務資料。此操作無法從此按鈕復原，請先確認已備份 /data/menu-config.json。`);
  if(!ok)return;
  try{
    await api('/api/admin/menu-config/reset-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant_id:tenantId})});
    state.customization.openIds=[];
    await loadCustomization();
    renderCustomization();
    alert('已清除這家公司的兩份舊目錄覆寫。請再切換到另一個工作空間確認。');
  }catch(err){alert(err.message||'清除目錄覆寫失敗');}
}
async function loadMessageAudit(){
  if(!state.tenants.length) state.tenants=await api('/api/admin/tenants');
  const active=state.messageAudit.tenantId||state.tenants.find(t=>t.status==='active')?.id||state.tenants[0]?.id;
  state.messageAudit.tenantId=active?Number(active):null;
  if(!active){state.messageAudit={...state.messageAudit,staff:[],enabled:false,auditor_ids:[]};return;}
  const d=await api(`/api/admin/message-audit-settings?tenant_id=${encodeURIComponent(active)}`);
  state.messageAudit={tenantId:active,enabled:!!d.cfg?.enabled,auditor_ids:d.cfg?.auditor_ids||[],staff:d.staff||[]};
}
function renderMessageAudit(){
  const el=$('tab-messageAudit');if(!el)return;const c=state.messageAudit;
  const tenantOptions=state.tenants.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(c.tenantId)?'selected':''}>${escapeHtml(x.name)}（${escapeHtml(x.code)}）</option>`).join('');
  const rows=c.staff.map(p=>`<label class="audit-person-row"><input type="checkbox" class="audit-person" value="${p.id}" ${c.auditor_ids.includes(Number(p.id))?'checked':''}><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.employee_id)} · ${escapeHtml(p.position||p.job_category|| (p.role==='company_admin'?'公司管理員':''))}</small></span></label>`).join('');
  el.innerHTML=`<div class="panel designer-intro"><div class="section-title">🔐 企業訊息稽核</div><p>這項功能預設關閉。啟用後，由公司自行指定具有稽核權限的人員；總後臺只負責「開關＋授權」，不直接查看員工聊天內容。</p><div class="editor-grid"><div><label>企業</label><select id="auditTenantSelect">${tenantOptions}</select></div><div><label>稽核功能</label><select id="auditEnabled"><option value="0" ${!c.enabled?'selected':''}>關閉</option><option value="1" ${c.enabled?'selected':''}>啟用</option></select></div></div></div><div class="panel"><div class="section-title">👤 指定可查看對話的人員</div><p class="hint">建議只授權公司負責人、總經理或公司指定的稽核／管理職務。所有查看行為都會留下稽核紀錄。</p><div class="audit-people-grid">${rows||'<div class="empty">目前沒有可授權的人員。</div>'}</div><div class="form-nav"><button onclick="saveMessageAudit()">💾 儲存稽核設定</button><span id="auditSaveMsg"></span></div></div>`;
  $('auditTenantSelect').addEventListener('change',async e=>{c.tenantId=Number(e.target.value);await loadMessageAudit();renderMessageAudit();});
}
async function saveMessageAudit(){try{const ids=[...document.querySelectorAll('.audit-person:checked')].map(x=>Number(x.value));const enabled=$('auditEnabled').value==='1';await api('/api/admin/message-audit-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant_id:state.messageAudit.tenantId,enabled,auditor_ids:ids})});$('auditSaveMsg').innerHTML='<span class="msg success inline-msg">✓ 已儲存企業訊息稽核設定</span>';await loadMessageAudit();renderMessageAudit();}catch(err){$('auditSaveMsg').innerHTML=`<span class="msg error inline-msg">${escapeHtml(err.message)}</span>`}}


async function loadPlatformRules(){
  const d=await api('/api/admin/platform-rules');
  state.platformRules=d.rules||{};
  try{const h=await api('/api/admin/platform-rules/history');state.platformRuleHistory=h.history||[];}catch{state.platformRuleHistory=[];}
}
function platformField(id,label,value,min=0,max=31){
  return `<div class="field"><label>${escapeHtml(label)}</label><input id="${id}" type="number" min="${min}" max="${max}" value="${Number(value??0)}"></div>`;
}
function renderPlatformRules(){
 const el=$('tab-platformRules'); if(!el)return;
 const r=state.platformRules||{}; const s=r.schedule||{};
 const sec=s.security||{}, mob=s.mobile||{}, adm=s.admin||{};
 el.innerHTML=`
 <div class="panel designer-intro">
   <div class="section-title">⚙️ 平台規則與設定</div>
   <p><strong>這裡是工作平台的母規則。</strong> 新公司／社區可以直接使用平台預設；公司若有特殊合約需求，可以在公司端覆寫。這裡只控制平台行為，不直接查看或修改客戶公司的營運內容。</p>
   <div class="msg warning">🔒 資料邊界：總後臺控制的是「規則與系統行為」，不是客戶公司的住戶、員工、財務、SOP 等營運資料。</div>
   <div class="form-nav" style="margin-top:14px"><button class="secondary platform-subtab active" data-view="rules">📅 班表與排班規則</button><button class="secondary platform-subtab" data-view="history">🕘 規則變更紀錄</button></div>
 </div>
 <div id="platform-rules-view">
   <div class="panel">
    <div class="section-title">📅 班表與排班規則 <span class="tag success">平台母規則</span></div>
    <p class="hint">以下設定會作為新公司／新社區的預設值；已經在公司端自訂的規則不會因你修改平台預設而被強制覆蓋。</p>
    <div class="editor-grid">
      ${platformField('prMax','全平台最多連續工作天數',s.max_consecutive??6,1,31)}
      <div class="field"><label>跨月份連續工作檢查</label><label class="switch"><input id="prCross" type="checkbox" ${s.cross_month_check!==false?'checked':''}> 檢查月底接到下月月初的連續工作</label></div>
      <div class="field"><label>超過連續工作限制時</label><select id="prOverflow"><option value="auto_reschedule" ${(s.overflow_action||'auto_reschedule')==='auto_reschedule'?'selected':''}>自動重新排休</option><option value="warn_only" ${s.overflow_action==='warn_only'?'selected':''}>只警告，不自動重排</option><option value="block_generation" ${s.overflow_action==='block_generation'?'selected':''}>禁止產生班表</option></select></div>
    </div>
   </div>
   <div class="panel"><div class="section-title">🛡️ 保全</div><div class="editor-grid">
     ${platformField('prSecRest','預設月休天數',sec.rest_days??6)}${platformField('prSecSelf','預設自選休假天數',sec.self_select_days??2)}${platformField('prSecMax','保全最多連續工作天數',sec.max_consecutive??6,1,31)}
     <div class="field"><label>預設班別</label><select id="prSecShift"><option value="day" ${sec.shift==='day'?'selected':''}>日班</option><option value="night" ${sec.shift==='night'?'selected':''}>夜班</option></select></div>
   </div></div>
   <div class="panel"><div class="section-title">🚗 機動</div><div class="editor-grid">
     ${platformField('prMobRest','預設月休天數',mob.rest_days??6)}${platformField('prMobSelf','預設自選休假天數',mob.self_select_days??2)}${platformField('prMobMax','機動最多連續工作天數',mob.max_consecutive??6,1,31)}
   </div></div>
   <div class="panel"><div class="section-title">🏢 行政</div><div class="editor-grid">
     <div class="field"><label>經理預設排休方式</label><select id="prMgrMode"><option value="red_holiday" ${adm.manager?.mode==='red_holiday'?'selected':''}>見紅休</option><option value="rotation" ${adm.manager?.mode==='rotation'?'selected':''}>輪排休</option><option value="fixed_monthly" ${adm.manager?.mode==='fixed_monthly'?'selected':''}>固定月休</option></select></div>
     ${platformField('prMgrRest','經理預設月休天數',adm.manager?.rest_days??8)}
     <div class="field"><label>秘書預設排休方式</label><select id="prSecMode"><option value="red_holiday" ${adm.secretary?.mode==='red_holiday'?'selected':''}>見紅休</option><option value="rotation" ${adm.secretary?.mode==='rotation'?'selected':''}>輪排休</option><option value="fixed_monthly" ${adm.secretary?.mode==='fixed_monthly'?'selected':''}>固定月休</option></select></div>
     ${platformField('prAdminSecRest','秘書預設月休天數',adm.secretary?.rest_days??8)}
   </div></div>
   <div class="panel"><div class="section-title">🇹🇼 國定假日</div><p class="hint">智慧班表使用台灣年度政府辦公日曆資料作為國定假日基準；取得不到資料時使用系統年度備援。這是排班基準，不等同於替公司判定所有勞動法令。</p><span class="tag">台灣政府年度辦公日曆</span></div>
   <div class="panel"><div class="section-title">📍 出勤與巡邏規則 <span class="tag success">平台母規則</span></div><p class="hint">出勤可使用 GPS 判定指定打卡範圍；巡邏以 QR Code 為主，支援地下室／無網路情境的離線暫存與恢復網路後同步。</p><div class="editor-grid">
     <div class="field"><label>出勤／巡邏模組</label><label class="switch"><input id="attEnabled" type="checkbox" ${r.attendance?.enabled!==false?'checked':''}> 啟用</label></div>
     <div class="field"><label>出勤 GPS</label><label class="switch"><input id="attGps" type="checkbox" ${r.attendance?.gps_checkin_enabled!==false?'checked':''}> 出勤需在指定範圍</label></div>
     <div class="field"><label>預設出勤有效半徑（公尺）</label><input id="attRadius" type="number" min="20" max="1000" value="${Number(r.attendance?.default_checkin_radius_m??100)}"></div>
     <div class="field"><label>GPS 最大允許誤差（公尺）</label><input id="attAccuracy" type="number" min="10" max="500" value="${Number(r.attendance?.max_gps_accuracy_m??150)}"></div>
     <div class="field"><label>巡邏 QR</label><label class="switch"><input id="attPatrol" type="checkbox" ${r.attendance?.patrol_qr_enabled!==false?'checked':''}> 啟用 QR 巡邏</label></div>
     <div class="field"><label>離線暫存</label><label class="switch"><input id="attOffline" type="checkbox" ${r.attendance?.offline_queue_enabled!==false?'checked':''}> 無網路先暫存手機</label></div>
     <div class="field"><label>恢復網路自動同步</label><label class="switch"><input id="attSync" type="checkbox" ${r.attendance?.offline_sync_enabled!==false?'checked':''}> 自動同步</label></div>
     <div class="field"><label>GPS 紀錄</label><label class="switch"><input id="attGpsLog" type="checkbox" ${r.attendance?.gps_log_enabled!==false?'checked':''}> 保存出勤 GPS</label></div>
   </div></div>
   <div class="form-nav"><button onclick="savePlatformRules()">💾 儲存平台規則</button><span id="platformSaveMsg"></span></div>
 </div>
 <div id="platform-history-view" style="display:none"></div>`;
 el.querySelectorAll('.platform-subtab').forEach(btn=>btn.addEventListener('click',()=>{
   el.querySelectorAll('.platform-subtab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
   const history=btn.dataset.view==='history';$('platform-rules-view').style.display=history?'none':'block';$('platform-history-view').style.display=history?'block':'none';
   if(history) renderPlatformHistory();
 }));
}
function renderPlatformHistory(){
 const el=$('platform-history-view');if(!el)return;
 const list=state.platformRuleHistory||[];
 el.innerHTML=`<div class="panel"><div class="section-title">🕘 規則變更紀錄</div><p class="hint">每次儲存平台規則都會留下版本，方便追查「什麼時候改了什麼」。</p>${list.length?list.map((h,i)=>`<details ${i===0?'open':''} style="padding:12px 0;border-top:1px solid #ddd"><summary>版本 ${h.version||i+1}｜${escapeHtml(h.updated_at||'')}｜${escapeHtml(h.updated_by||'')}</summary><pre style="white-space:pre-wrap;overflow:auto">${escapeHtml(JSON.stringify(h.rules||{},null,2))}</pre></details>`).join(''):'<div class="empty">目前尚無變更紀錄。</div>'}</div>`;
}
async function savePlatformRules(){
 const body={schedule:{max_consecutive:Number($('prMax').value),cross_month_check:$('prCross').checked,overflow_action:$('prOverflow').value,security:{rest_days:Number($('prSecRest').value),self_select_days:Number($('prSecSelf').value),max_consecutive:Number($('prSecMax').value),shift:$('prSecShift').value},mobile:{rest_days:Number($('prMobRest').value),self_select_days:Number($('prMobSelf').value),max_consecutive:Number($('prMobMax').value)},admin:{manager:{mode:$('prMgrMode').value,rest_days:Number($('prMgrRest').value)},secretary:{mode:$('prSecMode').value,rest_days:Number($('prAdminSecRest').value)}}},attendance:{enabled:$('attEnabled').checked,gps_checkin_enabled:$('attGps').checked,default_checkin_radius_m:Number($('attRadius').value),max_gps_accuracy_m:Number($('attAccuracy').value),patrol_enabled:$('attPatrol').checked,patrol_qr_enabled:$('attPatrol').checked,patrol_qr_radius_m:Number(state.platformRules?.attendance?.patrol_qr_radius_m??30),gps_log_enabled:$('attGpsLog').checked,offline_queue_enabled:$('attOffline').checked,offline_sync_enabled:$('attSync').checked}};
 try{const d=await api('/api/admin/platform-rules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});state.platformRules=d.rules;const h=await api('/api/admin/platform-rules/history');state.platformRuleHistory=h.history||[];renderPlatformRules();const msg=$('platformSaveMsg');if(msg)msg.innerHTML='<span class="msg success inline-msg">✓ 已儲存平台規則並建立新版本</span>';}catch(err){const msg=$('platformSaveMsg');if(msg)msg.innerHTML=`<span class="msg error inline-msg">${escapeHtml(err.message)}</span>`;}
}

function formatDate(s){return new Date(s).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function escapeAttr(s){return escapeHtml(s)}
checkSession();

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCustomMenuEditor()});

async function downloadPlatformResource(id){window.open(`/api/admin/platform-resources/${id}/download`,'_blank')}
async function deletePlatformResource(id){if(!confirm('確定刪除這份平台公版文件嗎？已經被公司採用的複本不會受影響。'))return;try{await api(`/api/admin/platform-resources/${id}`,{method:'DELETE'});await loadTemplates();renderTemplates()}catch(e){alert(e.message)}}

// 重新整理後回到上次使用的分頁
function restoreAdminTab(){let t='';try{t=localStorage.getItem('admin-last-tab')||''}catch{}if(t&&t!=='tenants')switchAdminTab(t);}

// ===== 禮品推放（總後台登記，內勤與現場人員瀏覽） =====
state.gifts=[];
async function loadGiftsAdmin(){
 const el=$('tab-gifts');if(!el)return;
 el.innerHTML='<div class="panel"><div class="profile-loading">正在讀取禮品…</div></div>';
 try{const d=await api('/api/admin/gifts');state.gifts=d.gifts||[];renderGiftsAdmin();}
 catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${escapeHtml(e.message)}</div></div>`;}
}
function renderGiftsAdmin(){
 const el=$('tab-gifts');if(!el)return;
 const list=state.gifts;const active=list.filter(g=>g.is_active).length;
 const link=(u,label,cls)=>u?`<a class="gift-admin-link ${cls}" href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(u)}">${label}</a>`:`<span class="gift-admin-link is-empty">${label}：未設定</span>`;
 const rows=list.map((g,i)=>`<div class="gift-admin-row ${g.is_active?'':'is-off'}">
   <div class="gift-admin-logo">${g.logo_url?`<img src="${escapeAttr(g.logo_url)}" alt="">`:'🎁'}</div>
   <div class="gift-admin-info"><strong>${escapeHtml(g.name)}</strong>${g.description?`<span class="muted">${escapeHtml(g.description)}</span>`:''}<div class="gift-admin-links">${link(g.website_url,'🌐 禮品網頁','web')}${link(g.line_url,'💬 官方 LINE','line')}</div></div>
   <div class="gift-admin-status">${g.is_active?'<span class="tag success">上架中</span>':'<span class="tag">已下架</span>'}</div>
   <div class="gift-admin-actions">
     <button type="button" class="icon-btn" onclick="moveGift(${g.id},-1)" ${i===0?'disabled':''} title="往前" aria-label="往前">↑</button>
     <button type="button" class="icon-btn" onclick="moveGift(${g.id},1)" ${i===list.length-1?'disabled':''} title="往後" aria-label="往後">↓</button>
     <button type="button" class="secondary" onclick="toggleGift(${g.id})">${g.is_active?'下架':'上架'}</button>
     <button type="button" class="secondary" onclick="openGiftEditor(${g.id})">編輯</button>
     <button type="button" class="danger" onclick="deleteGift(${g.id})">刪除</button>
   </div></div>`).join('');
 el.innerHTML=`<div class="panel"><div class="dash-head"><div><div class="section-title">🎁 禮品推放</div><p class="hint">在這裡登記的禮品，會出現在所有公司內勤與現場人員的「禮品推放」目錄。每個禮品顯示 LOGO，並提供禮品網頁與官方 LINE 連結。排序就是前台顯示的順序。</p></div><button type="button" onclick="openGiftEditor()">＋ 新增禮品</button></div>
   <div class="gift-admin-summary"><span>共 ${list.length} 個禮品</span><span>上架中 ${active} 個</span></div>
   <div class="gift-admin-list">${rows||'<div class="empty">目前還沒有禮品。按右上角「新增禮品」開始登記。</div>'}</div></div>`;
}
function openGiftEditor(id){
 const g=id?state.gifts.find(x=>x.id===id):null;
 const box=document.createElement('div');box.className='modal-backdrop';box.id='giftEditor';
 box.innerHTML=`<div class="modal gift-editor" role="dialog" aria-modal="true" aria-labelledby="giftEditorTitle"><button type="button" class="modal-close" aria-label="關閉">×</button>
  <h2 id="giftEditorTitle">${g?'編輯禮品':'＋ 新增禮品'}</h2>
  <form id="giftForm" class="gift-form">
   <div class="gift-form-logo"><div class="gift-logo-preview" id="giftLogoPreview">${g?.logo_url?`<img src="${escapeAttr(g.logo_url)}" alt="">`:'<span>尚未上傳 LOGO</span>'}</div>
     <label class="secondary gift-logo-pick">${g?'更換 LOGO':'上傳 LOGO'}<input type="file" id="giftLogo" accept="image/jpeg,image/png,image/gif,image/webp" hidden></label><p class="hint">JPG／PNG／GIF／WEBP，最多 3MB。建議使用去背 PNG 或正方形圖片。</p></div>
   <div class="gift-form-fields">
     <label>禮品名稱<input id="giftName" type="text" maxlength="80" required value="${escapeAttr(g?.name||'')}" placeholder="例如：中秋禮盒"></label>
     <label>簡短說明（選填）<textarea id="giftDesc" maxlength="300" rows="2" placeholder="例如：企業團購 9 折，可客製卡片">${escapeHtml(g?.description||'')}</textarea></label>
     <label>禮品網頁連結<input id="giftWeb" type="text" inputmode="url" autocomplete="url" value="${escapeAttr(g?.website_url||'')}" placeholder="https://"></label>
     <label>官方 LINE 連結<input id="giftLine" type="text" inputmode="url" autocomplete="url" value="${escapeAttr(g?.line_url||'')}" placeholder="https://lin.ee/… 或 https://line.me/R/ti/p/@…"></label>
     <label class="check-row"><input type="checkbox" id="giftActive" ${!g||g.is_active?'checked':''}> 上架（內勤與現場人員看得到）</label>
   </div>
   <div class="modal-actions"><span id="giftFormMsg"></span><button type="button" class="secondary" data-close>取消</button><button type="submit" id="giftSave">💾 儲存</button></div>
  </form></div>`;
 document.body.appendChild(box);
 const close=()=>box.remove();
 box.querySelector('.modal-close').onclick=close;box.querySelector('[data-close]').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
 box.querySelector('#giftLogo').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;if(f.size>3*1024*1024){alert('LOGO 圖片最多 3MB');e.target.value='';return;}const url=URL.createObjectURL(f);box.querySelector('#giftLogoPreview').innerHTML=`<img src="${url}" alt="">`;});
 box.querySelector('#giftForm').addEventListener('submit',async e=>{
  e.preventDefault();const msg=box.querySelector('#giftFormMsg'),btn=box.querySelector('#giftSave');
  const fd=new FormData();fd.append('name',box.querySelector('#giftName').value.trim());fd.append('description',box.querySelector('#giftDesc').value.trim());fd.append('website_url',box.querySelector('#giftWeb').value.trim());fd.append('line_url',box.querySelector('#giftLine').value.trim());fd.append('is_active',box.querySelector('#giftActive').checked?'1':'0');
  const file=box.querySelector('#giftLogo').files[0];if(file)fd.append('logo',file);
  if(!g&&!file){msg.innerHTML='<span class="msg error inline-msg">請上傳禮品 LOGO</span>';return;}
  if(!box.querySelector('#giftWeb').value.trim()&&!box.querySelector('#giftLine').value.trim()&&!confirm('還沒有填禮品網頁或官方 LINE 連結，前台只會顯示 LOGO。確定要儲存嗎？'))return;
  btn.disabled=true;msg.innerHTML='<span class="hint">儲存中…</span>';
  try{await api(g?`/api/admin/gifts/${g.id}`:'/api/admin/gifts',{method:g?'PUT':'POST',body:fd});close();await loadGiftsAdmin();}
  catch(err){msg.innerHTML=`<span class="msg error inline-msg">${escapeHtml(err.message)}</span>`;btn.disabled=false;}
 });
 setTimeout(()=>box.querySelector('#giftName').focus(),0);
}
async function toggleGift(id){const g=state.gifts.find(x=>x.id===id);if(!g)return;const fd=new FormData();fd.append('name',g.name);fd.append('description',g.description||'');fd.append('website_url',g.website_url||'');fd.append('line_url',g.line_url||'');fd.append('is_active',g.is_active?'0':'1');try{await api(`/api/admin/gifts/${id}`,{method:'PUT',body:fd});await loadGiftsAdmin();}catch(e){alert(e.message)}}
async function moveGift(id,d){const list=state.gifts.slice();const i=list.findIndex(x=>x.id===id),j=i+d;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];state.gifts=list;renderGiftsAdmin();try{await api('/api/admin/gifts-order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:list.map(x=>x.id)})});}catch(e){alert(e.message);await loadGiftsAdmin();}}
async function deleteGift(id){const g=state.gifts.find(x=>x.id===id);if(!g)return;if(!confirm(`確定刪除「${g.name}」嗎？刪除後內勤與現場人員就看不到，LOGO 也會一併刪除。\n\n如果只是暫時不想顯示，可以改用「下架」。`))return;try{await api(`/api/admin/gifts/${id}`,{method:'DELETE'});await loadGiftsAdmin();}catch(e){alert(e.message)}}


// ===== 貼圖管理：平台貼圖（上傳 GIF／圖片）＋內建文字貼圖開關 =====
state.stickers={builtin:[],platform:[],personal_count:0};
async function loadStickersAdmin(){
 const el=$('tab-stickers');if(!el)return;
 el.innerHTML='<div class="panel"><div class="profile-loading">正在讀取貼圖…</div></div>';
 try{state.stickers=await api('/api/admin/stickers');renderStickersAdmin();}
 catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${escapeHtml(e.message)}</div></div>`;}
}
function renderStickersAdmin(){
 const el=$('tab-stickers');if(!el)return;const st=state.stickers;
 el.innerHTML=`<div class="panel"><div class="section-title">😊 貼圖管理</div><p class="hint">這裡上傳的「平台貼圖」所有公司的內勤與現場人員都能在訊息裡使用，支援 GIF 動圖、PNG、JPG、WEBP（每張 5MB 以內，建議正方形、240×240 左右）。<br>人員也可以在訊息的「我的貼圖」自己上傳 GIF，只有自己的貼圖面板看得到（目前共 ${st.personal_count||0} 張）。</p>
  <form id="stkUpload" class="stk-upload"><label class="stk-drop"><input type="file" id="stkFile" accept="image/gif,image/png,image/jpeg,image/webp" multiple hidden><span>＋</span><b>選擇圖片／GIF</b><small>可一次選多張</small></label><label class="stk-name">貼圖名稱（選填，多張時用檔名）<input id="stkText" maxlength="20" placeholder="例如：收到、辛苦了"></label><span id="stkMsg"></span></form></div>
 <div class="panel"><div class="section-title">平台貼圖（${st.platform.length} 張）</div>${st.platform.length?`<div class="stk-grid">${st.platform.map((s,i)=>`<div class="stk-card"><img src="${escapeAttr(s.image)}" alt="${escapeAttr(s.text)}" loading="lazy"><input value="${escapeAttr(s.text)}" maxlength="20" data-stk-text="${escapeAttr(s.id)}" aria-label="貼圖名稱"><div class="stk-actions"><button type="button" class="icon-btn" data-stk-move="${i}" data-d="-1" ${i===0?'disabled':''} title="往前">←</button><button type="button" class="icon-btn" data-stk-move="${i}" data-d="1" ${i===st.platform.length-1?'disabled':''} title="往後">→</button><button type="button" class="danger" data-stk-del="${escapeAttr(s.id)}">刪除</button></div></div>`).join('')}</div>`:'<div class="empty">還沒有上傳平台貼圖。</div>'}</div>
 <div class="panel"><div class="section-title">內建文字貼圖</div><p class="hint">取消勾選的貼圖就不會出現在人員的貼圖面板（已傳出的訊息不受影響）。</p><div class="stk-builtin">${st.builtin.map(b=>`<label class="stk-b tone-${escapeAttr(b.tone)}"><input type="checkbox" data-stk-b="${escapeAttr(b.id)}" ${b.hidden?'':'checked'}><span class="stk-b-emoji">${escapeHtml(b.emoji)}</span><span>${escapeHtml(b.text)}</span></label>`).join('')}</div></div>`;
 const msg=t=>{const m=$('stkMsg');if(m)m.innerHTML=t;};
 $('stkFile').addEventListener('change',async e=>{const files=[...(e.target.files||[])];if(!files.length)return;let ok=0;const errs=[];
  for(const [i,f] of files.entries()){msg(`<span class="muted">上傳中 ${i+1}/${files.length}…</span>`);const fd=new FormData();fd.append('image',f);fd.append('text',files.length===1&&$('stkText').value.trim()?$('stkText').value.trim():f.name.replace(/\.[^.]+$/,'').slice(0,20));try{await api('/api/admin/stickers',{method:'POST',body:fd});ok++;}catch(err){errs.push(`${f.name}：${err.message}`);}}
  e.target.value='';$('stkText').value='';await loadStickersAdmin();msg(`<span class="msg ${errs.length?'error':'success'} inline-msg">已上傳 ${ok} 張${errs.length?`；失敗 ${errs.length} 張：${escapeHtml(errs.join('、'))}`:''}</span>`);});
 el.querySelectorAll('[data-stk-text]').forEach(inp=>inp.addEventListener('change',async()=>{try{await api(`/api/admin/stickers/${encodeURIComponent(inp.dataset.stkText)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:inp.value})});}catch(err){alert(err.message);}}));
 el.querySelectorAll('[data-stk-del]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('刪除這張平台貼圖？人員就不能再選用，已傳出的訊息仍看得到。'))return;try{await api(`/api/admin/stickers/${encodeURIComponent(b.dataset.stkDel)}`,{method:'DELETE'});await loadStickersAdmin();}catch(err){alert(err.message);}}));
 el.querySelectorAll('[data-stk-move]').forEach(b=>b.addEventListener('click',async()=>{const list=state.stickers.platform.slice();const i=Number(b.dataset.stkMove),j=i+Number(b.dataset.d);[list[i],list[j]]=[list[j],list[i]];state.stickers.platform=list;renderStickersAdmin();try{await api('/api/admin/stickers/order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:list.map(x=>x.id)})});}catch(err){alert(err.message);}}));
 el.querySelectorAll('[data-stk-b]').forEach(c=>c.addEventListener('change',async()=>{const hidden=[...el.querySelectorAll('[data-stk-b]')].filter(x=>!x.checked).map(x=>x.dataset.stkB);try{await api('/api/admin/stickers/builtin',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({hidden})});state.stickers.builtin.forEach(x=>x.hidden=hidden.includes(x.id));}catch(err){alert(err.message);}}));
}


// ===== 投保級距表（勞保、職災、健保、勞退）=====
const INS_LABELS={labor:'勞工保險投保薪資',occupational:'職業災害保險投保薪資',health:'全民健保投保金額',pension:'勞退月提繳工資'};
const INS_RATES=[['labor_ordinary','勞保普通事故費率'],['employment','就業保險費率'],['labor_employee','勞保勞工負擔比例'],['labor_employer','勞保雇主負擔比例'],['occupational','職災費率（預設，各公司可改）'],['health','健保費率'],['health_employee','健保本人負擔比例'],['health_employer','健保投保單位負擔比例'],['health_avg_dependents','健保平均眷口數'],['pension_employer','勞退雇主提繳率']];
async function loadInsuranceAdmin(){
 const el=$('tab-insurance');if(!el)return;el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
 try{state.ins=await api('/api/admin/insurance-tables');state.insYear=state.insYear||state.ins.status.current.year;renderInsuranceAdmin();}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${escapeHtml(e.message)}</div></div>`;}
}
function renderInsuranceAdmin(){
 const el=$('tab-insurance');const {tables,status}=state.ins;const y=state.insYear;const t=tables[y];const st=status;const money=v=>Number(v||0).toLocaleString('en-US');
 el.innerHTML=`<div class="panel"><div class="section-title">🧾 投保級距表</div><p class="hint">各公司「人事管理」與「人員薪資統計表」計算勞保、就保、職災、健保、勞退時使用。薪資月份會自動對應當年度的表（每年 1 月 1 日自動換用）。<br>系統每年 11 月～2 月每天自動到勞保局檢查新年度的「保險費分擔金額表」，找到後會產生「待確認」版本，請在這裡核對後按「確認套用」。</p>
  <div class="ins-status">${st.current_exact?`<span class="tag success">今年度（${st.current.year}）級距表已啟用</span>`:`<span class="tag" style="background:#fdecec;color:#b3261e">尚未建立今年度級距表，暫用 ${st.current.year} 年</span>`}${st.next_needed?`<span class="tag" style="background:#fff3e0;color:#a35a00">明年度級距表尚未建立</span>`:''}${st.last_check?`<span class="muted">上次自動檢查：${escapeHtml(new Date(st.last_check.at).toLocaleString('zh-TW'))}｜${escapeHtml(st.last_check.text||'')}</span>`:''}</div>
  <div class="save-bar" style="position:static;margin-top:10px"><button type="button" id="insCheck">🔎 立即檢查勞保局公告</button><button type="button" class="secondary" id="insNew">＋ 新增年度（輸入基本工資自動推算）</button></div>
  ${st.pending?`<div class="msg" style="margin-top:12px;background:#fff7e5;border:1px solid #efd99c"><b>待確認：${st.pending.year} 年級距表</b>（基本工資 ${money(st.pending.min_wage)} 元）<br><small>${escapeHtml(st.pending.source||'')}</small><br>勞保：${st.pending.labor.map(money).join('、')}<div style="margin-top:8px"><button type="button" id="insConfirm">✅ 確認套用</button> <button type="button" class="secondary" id="insEditPending">先修改再套用</button></div></div>`:''}</div>
 <div class="panel"><div class="section-title">年度</div><div style="display:flex;gap:8px;flex-wrap:wrap">${st.years.map(x=>`<button type="button" class="${String(x)===String(y)?'':'secondary'}" data-ins-year="${x}">${x} 年</button>`).join('')}</div>
  ${t?`<p class="hint" style="margin-top:10px">${escapeHtml(t.effective||'')} 起適用｜基本工資 ${money(t.min_wage)} 元｜${escapeHtml(t.source||'')}${t.updated_at?`｜${escapeHtml(t.updated_by||'')} 更新於 ${escapeHtml(new Date(t.updated_at).toLocaleString('zh-TW'))}`:''}</p>
  <div class="ins-grid">${Object.entries(INS_LABELS).map(([k,l])=>`<div class="ins-card"><h4>${l}（${t[k].length} 級）</h4><div class="ins-list">${t[k].map((g,i)=>`<span><small>${i+1}</small>${money(g)}</span>`).join('')}</div></div>`).join('')}</div>
  <div class="ins-card" style="margin-top:12px"><h4>費率</h4><div class="ins-rates">${INS_RATES.map(([k,l])=>`<div><span>${l}</span><b>${k==='health_avg_dependents'?t.rates[k]:(Number(t.rates[k])*100).toFixed(2)+'%'}</b></div>`).join('')}</div></div>
  <div style="margin-top:12px"><button type="button" class="secondary" id="insEdit">✏️ 修改 ${y} 年級距表</button></div>`:''}</div>`;
 el.querySelectorAll('[data-ins-year]').forEach(b=>b.addEventListener('click',()=>{state.insYear=b.dataset.insYear;renderInsuranceAdmin();}));
 $('insCheck').addEventListener('click',async e=>{e.target.disabled=true;e.target.textContent='檢查中…';try{const r=await api('/api/admin/insurance-tables/check',{method:'POST'});alert(r.result.text||'完成');await loadInsuranceAdmin();}catch(err){alert(err.message);e.target.disabled=false;}});
 $('insNew').addEventListener('click',async()=>{const year=prompt('新增哪一個年度？（西元）',String(new Date().getFullYear()+1));if(!year)return;const mw=prompt(`${year} 年的基本工資（月薪，元）？\n系統會把低於基本工資的級距改成基本工資，其餘沿用上一年度，請再核對官方公告。`,'');if(!mw)return;try{const r=await api('/api/admin/insurance-tables/derive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:Number(year),min_wage:Number(mw)})});editInsTable(r.table,true);}catch(err){alert(err.message);}});
 $('insConfirm')?.addEventListener('click',async()=>{if(!confirm(`確認套用 ${st.pending.year} 年級距表？`))return;try{await api('/api/admin/insurance-tables/confirm',{method:'POST'});state.insYear=st.pending.year;await loadInsuranceAdmin();}catch(err){alert(err.message);}});
 $('insEditPending')?.addEventListener('click',()=>editInsTable(st.pending,true));
 $('insEdit')?.addEventListener('click',()=>editInsTable(t,false));
}
function editInsTable(t,isNew){
 const box=document.createElement('div');box.className='modal-backdrop';
 box.innerHTML=`<div class="modal" style="max-width:860px;width:min(860px,96vw);max-height:92vh;overflow:auto"><button type="button" class="modal-close">×</button><h2>${isNew?'新增':'修改'} ${t.year} 年級距表</h2><p class="hint">每個級距用逗號或換行分隔，金額由小到大。費率請填小數（例如 11.5% 填 0.115）。</p><div class="editor-grid"><div><label>生效日</label><input id="insEff" value="${escapeAttr(t.effective||`${t.year}-01-01`)}"></div><div><label>基本工資</label><input id="insMw" value="${escapeAttr(t.min_wage||'')}"></div>${Object.entries(INS_LABELS).map(([k,l])=>`<div class="wide"><label>${l}</label><textarea id="insL_${k}" rows="3">${escapeHtml((t[k]||[]).join(', '))}</textarea></div>`).join('')}${INS_RATES.map(([k,l])=>`<div><label>${l}</label><input id="insR_${k}" value="${escapeAttr(t.rates?.[k]??'')}"></div>`).join('')}<div class="wide"><label>來源說明</label><input id="insSrc" value="${escapeAttr(t.source||'')}"></div></div><div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" id="insSave">💾 儲存並套用</button></div></div>`;
 document.body.appendChild(box);const close=()=>box.remove();box.querySelector('.modal-close').onclick=close;box.querySelector('[data-cancel]').onclick=close;
 box.querySelector('#insSave').onclick=async()=>{const list=k=>box.querySelector(`#insL_${k}`).value.split(/[\s,，、]+/).map(x=>Number(x.replace(/[^\d.]/g,''))).filter(x=>x>0);const rates={};for(const [k] of INS_RATES)rates[k]=Number(box.querySelector(`#insR_${k}`).value);rates.health_max_dependents=t.rates?.health_max_dependents||3;
  const body={effective:box.querySelector('#insEff').value,min_wage:Number(box.querySelector('#insMw').value),labor:list('labor'),occupational:list('occupational'),health:list('health'),pension:list('pension'),rates,source:box.querySelector('#insSrc').value};
  try{await api(`/api/admin/insurance-tables/${t.year}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});close();state.insYear=t.year;await loadInsuranceAdmin();}catch(err){alert(err.message);}};
}
