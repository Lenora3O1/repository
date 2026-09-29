let state={submissions:[],templates:[],staff:[],tenants:[],config:null,brandingTenantId:null,branding:null,customization:{mode:'platform',tenantId:null,scope:'company',global:[],items:[],overrides:{}},messageAudit:{tenantId:null,enabled:false,auditor_ids:[],staff:[]}};
const $=id=>document.getElementById(id);
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
async function checkSession(){try{const r=await api('/api/admin/session');if(r.isAdmin){showMain();await loadAll()}else{$('loginView').style.display='block'}}catch(err){$('loginView').style.display='block';$('loginMsg').innerHTML=`<div class="msg error">${escapeHtml(err.message||'無法讀取登入狀態，請重新整理。')}</div>`}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password:$('password').value})});showMain();await loadAll()}catch(err){$('loginMsg').innerHTML=`<div class="msg error">${escapeHtml(err.message)}</div>`}});
$('logoutBtn').addEventListener('click',async()=>{await api('/api/admin/logout',{method:'POST'});location.reload()});
function showMain(){$('loginView').style.display='none';$('mainView').style.display='block';$('logoutWrap').style.display='block'}
for(const b of document.querySelectorAll('.nav-tabs button'))b.addEventListener('click',async()=>{document.querySelectorAll('.nav-tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');for(const id of ['tenants','submissions','staff','templates','form','branding','customization','messageAudit'])$(`tab-${id}`).style.display=b.dataset.tab===id?'block':'none';if(b.dataset.tab==='customization'){await loadCustomization();renderCustomization();}if(b.dataset.tab==='messageAudit'){await loadMessageAudit();renderMessageAudit();}});
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
async function loadTenants(){state.tenants=await api('/api/admin/tenants')}
async function loadSubmissions(){const r=await api('/api/admin/submissions');state.submissions=r.submissions}
async function loadTemplates(){state.templates=await api('/api/admin/templates')}
async function loadStaff(){state.staff=await api('/api/admin/staff')}
async function loadConfig(){state.config=await api('/api/admin/form-config');if(!state.config||!Array.isArray(state.config.pages)||!Array.isArray(state.config.questions)){throw new Error('中央表單設定格式不完整，請檢查 /data/form-config.json。')}}
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
 el.innerHTML=`<div class="panel designer-intro"><div class="section-title">🏢 公司／租戶管理</div><p><strong>這裡是系統總後臺。</strong> 每建立一家公司，就可以產生一個獨立的公司管理後臺；公司管理員只會看到自己的公司資料。</p><p class="hint">公司停止合作時請使用「停用公司」而不是刪除。停用會立即禁止該公司的管理員與一般人員登入，但完整保留既有交接、草稿、社區與文件資料；日後恢復合作時可直接「重新啟用」。</p></div><div class="panel"><div class="section-title">＋ 建立新物業管理公司</div><form id="addTenantForm"><div class="editor-grid"><div class="wide"><label>公司名稱</label><input id="newTenantName" placeholder="例如：○○物業管理有限公司" required></div><div><label>公司代碼（可留白自動產生）</label><input id="newTenantCode" placeholder="例如 abc-property"></div><div><label>公司負責人員編</label><input id="newTenantAdminId" placeholder="例如 CA1001" required></div><div><label>負責人姓名</label><input id="newTenantAdminName" placeholder="例如 王小明" required></div><div><label>初始密碼</label><input id="newTenantAdminPass" type="password" placeholder="至少 4 碼" required></div></div><button type="submit">＋ 建立公司與負責人帳號</button></form></div><div class="panel"><div class="section-title">已建立公司（${state.tenants.length} 家）</div><p class="hint">每家公司可以有多位公司管理員。第一位建立的帳號為「公司負責人」；公司負責人可在公司後台新增／管理其他公司管理員。這樣老闆忙碌時，可授權總經理等主管代為管理總務、會計與現場人員帳號，不需要重複建立公司。</p><div class="table-wrap"><table><thead><tr><th>公司</th><th>公司代碼</th><th>負責人帳號</th><th>負責人／管理員</th><th>負責人登入狀態</th><th>一般人員</th><th>社區</th><th>合作狀態</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="9" class="empty">目前尚未建立公司。</td></tr>'}</tbody></table></div></div>`;
 $('addTenantForm').addEventListener('submit',addTenant)
}
async function addTenant(e){e.preventDefault();try{const employeeId=$('newTenantAdminId').value.trim();const r=await api('/api/admin/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('newTenantName').value,code:$('newTenantCode').value,admin_employee_id:employeeId,admin_name:$('newTenantAdminName').value,admin_password:$('newTenantAdminPass').value})});await loadTenants();renderTenants();alert(`公司已建立！公司負責人員編：${employeeId}`)}catch(err){alert(err.message)}}
async function saveTenant(id){const t=state.tenants.find(x=>Number(x.id)===Number(id));try{await api(`/api/admin/tenants/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$(`tenant-name-${id}`).value,status:t?.status==='active'})});await loadTenants();renderTenants();alert('公司資料已儲存。')}catch(err){alert(err.message)}}
async function toggleTenantStatus(id,active){const t=state.tenants.find(x=>Number(x.id)===Number(id));if(!t)return;const message=active?`確定重新啟用「${t.name}」嗎？公司管理員與一般人員將可以重新登入。`:`確定停用「${t.name}」嗎？這不會刪除資料，但會立即禁止該公司的管理員與一般人員登入。`;if(!confirm(message))return;try{await api(`/api/admin/tenants/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:t.name,status:active})});await loadTenants();renderTenants()}catch(err){alert(err.message)}}
async function resetCompanyAdmin(id,employeeId){const password=prompt(`請為公司負責人 ${employeeId||''} 設定新密碼（至少 4 碼）：`);if(password===null)return;if(password.length<4){alert('新密碼至少 4 碼');return}if(!confirm(`確定要重設 ${employeeId||'公司負責人'} 的密碼嗎？`))return;try{await api(`/api/admin/tenants/${id}/admin/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});alert('公司負責人密碼已重設。')}catch(err){alert(err.message)}}
async function manageTenantAdmins(id,name){try{const rows=await api(`/api/admin/tenants/${id}/admins`);const html=rows.map(u=>`<div class="admin-manage-row"><div><strong>${escapeHtml(u.name)}</strong> <span class="tag ${u.admin_level==='owner'?'gold':'success'}">${u.admin_level==='owner'?'公司負責人':'公司管理員'}</span><br><span class="muted">${escapeHtml(u.employee_id)}｜${u.is_active?'啟用':'停用'}｜最後登入：${u.last_login_at?formatDate(u.last_login_at):'尚未登入'}</span></div><div><button class="secondary" onclick="superEditCompanyAdmin(${u.id},'${escapeAttr(u.name)}',${u.is_active?'true':'false'})">編輯</button></div></div>`).join('');const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<div class="modal"><h2>🏢 ${escapeHtml(name)}｜公司管理員</h2><p class="hint">公司可以有多位管理員。平台總後臺可以協助管理，但公司日常新增管理員可由「公司負責人」在公司後台處理。</p><div class="check-list">${html||'<div class="empty">目前沒有公司管理員。</div>'}</div><hr><h3>＋ 直接新增公司管理員</h3><div class="editor-grid"><div><label>員編</label><input id="superNewAdminId" placeholder="例如 CA1002"></div><div><label>姓名</label><input id="superNewAdminName" placeholder="例如 王小明"></div><div><label>初始密碼</label><input id="superNewAdminPass" type="password" placeholder="至少 4 碼"></div></div><div class="form-nav"><button class="secondary" onclick="this.closest('.modal-backdrop').remove()">關閉</button><button onclick="superAddCompanyAdmin(${id},this)">建立公司管理員</button></div></div>`;document.body.appendChild(box)}catch(err){alert(err.message)}}
async function superAddCompanyAdmin(tenantIdValue,btn){const box=btn.closest('.modal');const employeeId=box.querySelector('#superNewAdminId').value.trim(),name=box.querySelector('#superNewAdminName').value.trim(),password=box.querySelector('#superNewAdminPass').value;if(!employeeId||!name||password.length<4){alert('請填寫員編、姓名，且密碼至少 4 碼');return}try{await api(`/api/admin/tenants/${tenantIdValue}/admins`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_id:employeeId,name,password})});alert('公司管理員已建立。');box.closest('.modal-backdrop').remove();await loadTenants();renderTenants()}catch(err){alert(err.message)}}
async function superEditCompanyAdmin(id,currentName,currentActive){const name=prompt('公司管理員姓名：',currentName);if(name===null)return;const active=confirm('按「確定」代表啟用帳號；按「取消」代表停用帳號。若是公司負責人則不能停用。');const password=prompt('如需重設密碼請輸入新密碼；不需要請直接按取消：');if(password!==null&&password.length<4){alert('新密碼至少 4 碼');return}try{await api(`/api/admin/company-admins/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim(),is_active:active,password:password||''})});alert('公司管理員資料已更新。')}catch(err){alert(err.message)}}

async function loadBranding(){state.brandingTenantId=state.tenants[0]?.id||null;state.branding=null;if(state.brandingTenantId)state.branding=await api(`/api/admin/tenants/${state.brandingTenantId}/branding`)}
function renderBranding(){const el=$('tab-branding');if(!state.tenants.length){el.innerHTML='<div class="panel empty">請先建立公司，再設定各公司的系統美編。</div>';return}const t=state.tenants.find(x=>Number(x.id)===Number(state.brandingTenantId))||state.tenants[0];if(!state.branding||Number(state.branding.tenant_id)!==Number(t.id))state.branding={tenant_id:t.id,title:t.name,subtitle:'物業管理公司',loginTitle:'公司管理員登入',loginHint:'這裡是公司專屬管理後台。',intro:'這裡只管理您所屬公司的資料。',logoText:'',accent:'#2F6F5E',accentDark:'#204F42',bg:'#F7F7F4',panel:'#FFFFFF'};const b=state.branding;el.innerHTML=`<div class="panel designer-intro"><div class="section-title">🎨 各公司後台系統美編區</div><p><strong>依照「公司管理」中的公司逐一設定。</strong> 每家公司都有自己的系統名稱、登入文字與視覺色系；修改只會套用到選定的公司，不會影響其他公司。</p><div class="field"><label>選擇公司</label><select id="brandingTenantSelect">${state.tenants.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(t.id)?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></div></div><div class="panel"><div class="section-title">① 系統名稱與品牌識別</div><div class="editor-grid"><div class="wide"><label>系統主標題</label><input id="brandTitle" value="${escapeAttr(b.title)}" placeholder="例如：○○物業管理服務平台"></div><div><label>系統副標題</label><input id="brandSubtitle" value="${escapeAttr(b.subtitle)}" placeholder="例如：物業管理部門"></div><div><label>品牌識別文字／Logo</label><input id="brandLogoText" value="${escapeAttr(b.logoText)}" placeholder="例如：○○物業"></div></div></div><div class="panel"><div class="section-title">② 登入頁與公司後台文字</div><div class="editor-grid"><div><label>公司管理員登入標題</label><input id="brandLoginTitle" value="${escapeAttr(b.loginTitle)}"></div><div class="wide"><label>公司管理員登入說明</label><textarea id="brandLoginHint">${escapeHtml(b.loginHint)}</textarea></div><div class="wide"><label>公司後台首頁說明</label><textarea id="brandIntro">${escapeHtml(b.intro)}</textarea></div></div></div><div class="panel"><div class="section-title">③ 頁面視覺美化</div><p class="hint">目前提供品牌主色、深色主色、頁面背景與內容卡片背景；未來可以再加入 Logo 圖片、更多版型等功能。</p><div class="editor-grid"><div><label>主色</label><div class="color-row"><input type="color" id="brandAccent" value="${escapeAttr(b.accent)}"><input id="brandAccentText" value="${escapeAttr(b.accent)}" class="code-input"></div></div><div><label>主色深色版</label><div class="color-row"><input type="color" id="brandAccentDark" value="${escapeAttr(b.accentDark)}"><input id="brandAccentDarkText" value="${escapeAttr(b.accentDark)}" class="code-input"></div></div><div><label>頁面背景</label><div class="color-row"><input type="color" id="brandBg" value="${escapeAttr(b.bg)}"><input id="brandBgText" value="${escapeAttr(b.bg)}" class="code-input"></div></div><div><label>內容卡片背景</label><div class="color-row"><input type="color" id="brandPanel" value="${escapeAttr(b.panel)}"><input id="brandPanelText" value="${escapeAttr(b.panel)}" class="code-input"></div></div></div><div id="brandingPreview" class="brand-preview"><div class="brand-preview-top"><strong id="previewTitle">${escapeHtml(b.logoText||b.title)}</strong><span id="previewSubtitle">${escapeHtml(b.subtitle)}</span></div><div class="brand-preview-body"><h3 id="previewLogin">${escapeHtml(b.loginTitle)}</h3><p id="previewHint">${escapeHtml(b.loginHint)}</p><button type="button" id="previewButton">登入</button></div></div></div><div class="save-bar"><button onclick="saveBranding()">💾 儲存此公司美編設定</button><span id="brandingSaveMsg"></span></div>`;wireBrandingInputs();}
function wireBrandingInputs(){const pairs=[['brandAccent','brandAccentText'],['brandAccentDark','brandAccentDarkText'],['brandBg','brandBgText'],['brandPanel','brandPanelText']];for(const [a,b] of pairs){$(a).addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test($(a).value))$(b).value=$(a).value;updateBrandPreview()});$(b).addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test($(b).value))$(a).value=$(b).value;updateBrandPreview()})}['brandTitle','brandSubtitle','brandLogoText','brandLoginTitle','brandLoginHint'].forEach(id=>$(id).addEventListener('input',updateBrandPreview));$('brandingTenantSelect').addEventListener('change',async()=>{state.brandingTenantId=Number($('brandingTenantSelect').value);try{state.branding=await api(`/api/admin/tenants/${state.brandingTenantId}/branding`);renderBranding()}catch(e){alert(e.message)}});updateBrandPreview()}
function updateBrandPreview(){const root=$('brandingPreview');if(!root)return;root.style.setProperty('--preview-accent',$('brandAccentText').value);root.style.setProperty('--preview-dark',$('brandAccentDarkText').value);root.style.setProperty('--preview-bg',$('brandBgText').value);root.style.setProperty('--preview-panel',$('brandPanelText').value);$('previewTitle').textContent=$('brandLogoText').value||$('brandTitle').value;$('previewSubtitle').textContent=$('brandSubtitle').value;$('previewLogin').textContent=$('brandLoginTitle').value;$('previewHint').textContent=$('brandLoginHint').value}
async function saveBranding(){const msg=$('brandingSaveMsg');const body={title:$('brandTitle').value,subtitle:$('brandSubtitle').value,logoText:$('brandLogoText').value,loginTitle:$('brandLoginTitle').value,loginHint:$('brandLoginHint').value,intro:$('brandIntro').value,accent:$('brandAccentText').value,accentDark:$('brandAccentDarkText').value,bg:$('brandBgText').value,panel:$('brandPanelText').value};try{const r=await api(`/api/admin/tenants/${state.brandingTenantId}/branding`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});state.branding=r.branding;msg.innerHTML='<span class="msg success inline-msg">✓ 已儲存，此設定只套用於這家公司。</span>';setTimeout(()=>msg.innerHTML='',4500)}catch(e){msg.innerHTML=`<span class="msg error inline-msg">${escapeHtml(e.message)}</span>`}}

function renderSubmissions(){const el=$('tab-submissions');if(!state.submissions.length){el.innerHTML='<div class="panel empty">目前還沒有正式送出的填答紀錄。</div>';return}const opts=state.templates.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}${t.is_active?'（預設）':''}</option>`).join('');el.innerHTML=`<div class="panel"><div class="section-title">📋 正式填答紀錄（共 ${state.submissions.length} 筆）</div><p class="hint">這裡只顯示已正式送出的交接清冊。填寫中的草稿會由員工登入後自己繼續。</p><div class="table-wrap"><table><thead><tr><th>編號</th><th>送出時間</th><th>公司</th><th>填寫人員</th><th>社區</th><th>交接人員</th><th>操作</th></tr></thead><tbody>${state.submissions.map(s=>{const d=s.data;return `<tr><td>${s.id}</td><td>${formatDate(s.created_at)}</td><td>${escapeHtml(s.tenant_name||'')}</td><td>${escapeHtml(s.employee_name||'')}<br><span class="muted">${escapeHtml(s.employee_id||'')}</span></td><td>${escapeHtml(d.community_name||'')}</td><td>${escapeHtml(d.outgoing_manager||'')} → ${escapeHtml(d.incoming_manager||'')}</td><td><select id="tpl-${s.id}" ${!state.templates.length?'disabled':''}>${opts||'<option>尚未上傳範本</option>'}</select> <button class="secondary" onclick="downloadDocx(${s.id})" ${!state.templates.length?'disabled':''}>產生 Word</button> <button class="danger" onclick="deleteSubmission(${s.id})">刪除</button></td></tr>`}).join('')}</tbody></table></div></div>`}
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
  <div class="panel"><div class="section-title">🏢 各公司已建立的範本（${company.length} 份）</div><p class="hint">這些是公司管理員從平台範本建立或自行上傳的版本。總後臺可以查看，但內容與管理權仍屬各公司。</p>${company.length?`<div class="table-wrap"><table><thead><tr><th>名稱</th><th>公司</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>${companyRows}</tbody></table></div>`:'<div class="empty">目前還沒有公司自己的範本。</div>'}</div>`;
  $('uploadGlobalTemplate').addEventListener('submit',async e=>{e.preventDefault();try{const fd=new FormData();fd.append('name',$('globalTplName').value);fd.append('template',$('globalTplFile').files[0]);await api('/api/admin/templates',{method:'POST',body:fd});await loadTemplates();renderTemplates();alert('平台制式範本已上傳。')}catch(err){alert(err.message)}})
}
async function activateTemplate(id){try{await api(`/api/admin/templates/${id}/activate`,{method:'POST'});await loadTemplates();renderTemplates()}catch(err){alert(err.message)}}
async function deleteTemplate(id){if(!confirm('確定刪除這份平台制式範本嗎？已經複製到各公司的版本不會受影響。'))return;try{await api(`/api/admin/templates/${id}`,{method:'DELETE'});await loadTemplates();renderTemplates()}catch(err){alert(err.message)}}
function renderFormDesigner(){
  const el=$('tab-form'),c=state.config||{},u=c.uiTexts||{};
  el.innerHTML=`
  <div class="panel designer-intro">
    <div class="section-title">🛠 中央表單設計中心</div>
    <p><strong>這裡是平台提供標準雛型的地方。</strong> 目前先分成「交接清冊」與「工作日誌」兩套獨立表單；未來可以再增加其他平台制式表單。各公司採用後，再於自己的公司後台建立公司版本。</p>
  </div>

  <div class="module-card-grid">
    <div class="panel module-card">
      <div class="module-card-icon">📋</div>
      <div class="module-card-body">
        <div class="section-title">交接清冊</div>
        <p><strong>目前正式使用中的交接清冊。</strong><br>這套表單已確認可以正常使用，以下設計內容維持獨立，不與工作日誌共用。</p>
        <button class="secondary" onclick="toggleDesigner('checklistDesigner','checklistBtn')" id="checklistBtn">進入交接清冊設計</button>
      </div>
    </div>

    <div class="panel module-card">
      <div class="module-card-icon">📝</div>
      <div class="module-card-body">
        <div class="section-title">工作日誌</div>
        <p><strong>社區經理日常工作回報。</strong><br>未來會像交接清冊一樣，由平台設定表單，經理登入後選擇社區並填寫、儲存草稿、送出回報。</p>
        <button class="secondary" onclick="toggleDesigner('journalDesigner','journalBtn')" id="journalBtn">進入工作日誌設計</button>
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

  <div id="journalDesigner" class="designer-collapsible" style="display:none">
    <div class="panel">
      <div class="section-title">⚙️ 工作日誌設計</div>
      <p><strong>這裡先建立工作日誌的獨立入口。</strong> 下一階段會在此加入與交接清冊相同的表單設計功能，例如頁面、子標題、題目、回答格式、必填設定與排序。</p>
      <div class="msg inline-msg">🚧 工作日誌填寫系統尚未啟用。現在先整理總後台架構，完成後再接上經理前台與公司後台。</div>
    </div>
  </div>

  <div id="checklistDesigner" class="designer-collapsible" style="display:none">
    <div class="panel">
      <div class="section-title">⚙️ 交接清冊雛型設定</div>
      <p class="hint">以下就是目前已經確認 OK 的交接清冊設定。這裡的修改只會作用於交接清冊；工作日誌使用另一套獨立設定。</p>
    </div>
    <div class="panel">
      <div class="section-title">① 網站基本名稱</div>
      <div class="field"><label>網站標題</label><input id="siteTitle" value="${escapeAttr(c.title||'社區交接清冊')}"></div>
      <div class="field"><label>副標題</label><input id="siteSubtitle" value="${escapeAttr(c.subtitle||'')}"></div>
    </div>
    <div class="panel">
      <div class="section-title">② 公司管理後台／登入頁顯示文字</div>
      <p class="hint">這些就是公司管理員畫面上看到的標題與說明文字。修改後按最下面的「儲存全部交接清冊設定」即可套用。</p>
      <div class="editor-grid">
        <div><label>公司後台標題</label><input id="companyTitle" value="${escapeAttr(u.companyTitle||'公司管理後台')}"></div>
        <div><label>公司後台副標題</label><input id="companySubtitle" value="${escapeAttr(u.companySubtitle||'物業管理公司')}"></div>
        <div class="wide"><label>公司後台首頁說明</label><textarea id="companyIntro">${escapeHtml(u.companyIntro||'')}</textarea></div>
        <div><label>公司管理員登入標題</label><input id="companyLoginTitle" value="${escapeAttr(u.companyLoginTitle||'公司管理員登入')}"></div>
        <div><label>公司管理員登入說明</label><textarea id="companyLoginHint">${escapeHtml(u.companyLoginHint||'')}</textarea></div>
        <div><label>一般人員登入標題</label><input id="staffLoginTitle" value="${escapeAttr(u.staffLoginTitle||'物業人員登入')}"></div>
        <div><label>一般人員登入說明</label><textarea id="staffLoginHint">${escapeHtml(u.staffLoginHint||'')}</textarea></div>
      </div>
    </div>
    <div class="panel">
      <div class="section-title">③ 交接清冊頁面／母標題管理</div>
      <div id="pagesEditor"></div>
      <button class="secondary" onclick="addPage()">＋ 新增頁面</button>
    </div>
    <div class="panel">
      <div class="section-title">④ 交接清冊題目／子標題管理</div>
      <p class="hint">題目會依「所在頁面＋子標題」自動分組顯示。題目 ↑↓ 只調整同一子標題內的順序。</p>
      <div id="questionsEditor"></div>
      <button class="secondary" onclick="addQuestion()">＋ 新增題目</button>
    </div>
    <div class="save-bar"><button onclick="saveFormConfig()">💾 儲存全部交接清冊設定</button><span id="formSaveMsg"></span></div>
  </div>`;
  renderPagesEditor();renderQuestionsEditor();
}
function toggleDesigner(id,buttonId){
  const box=$(id),btn=$(buttonId);if(!box)return;
  const opening=box.style.display==='none'||!box.style.display;
  document.querySelectorAll('.designer-collapsible').forEach(x=>{if(x!==box)x.style.display='none'});
  document.querySelectorAll('.module-card button').forEach(x=>{if(x!==btn)x.textContent=x.id==='journalBtn'?'進入工作日誌設計':'進入交接清冊設計'});
  box.style.display=opening?'block':'none';
  if(btn)btn.textContent=opening?(id==='journalDesigner'?'收起工作日誌設計':'收起交接清冊設計'):(id==='journalDesigner'?'進入工作日誌設計':'進入交接清冊設計');
  if(opening)box.scrollIntoView({behavior:'smooth',block:'start'});
}

function renderPagesEditor(){const w=$('pagesEditor');w.innerHTML=state.config.pages.map((p,i)=>`<div class="page-card"><div class="move-buttons"><button class="icon-btn" onclick="movePage(${i},-1)" ${i===0?'disabled':''}>↑</button><button class="icon-btn" onclick="movePage(${i},1)" ${i===state.config.pages.length-1?'disabled':''}>↓</button></div><div class="page-number">第 ${i+1} 頁</div><div class="grow"><label>頁面／母標題</label><input value="${escapeAttr(p.title)}" oninput="state.config.pages[${i}].title=this.value"><label>頁面說明</label><input value="${escapeAttr(p.description||'')}" oninput="state.config.pages[${i}].description=this.value"></div><button class="danger" onclick="removePage(${i})">刪除頁面</button></div>`).join('')}
function groupNamesForPage(pageId){const seen=[];for(const q of state.config.questions){if(q.pageId===pageId){const g=q.group||'填寫資料';if(!seen.includes(g))seen.push(g)}}return seen}
function renderQuestionsEditor(){const w=$('questionsEditor');const pages=state.config.pages;w.innerHTML=pages.map((p,pi)=>{const groups=groupNamesForPage(p.id);const qs=groups.flatMap(g=>state.config.questions.map((q,i)=>({q,i})).filter(x=>x.q.pageId===p.id&&(x.q.group||'填寫資料')===g));return `<div class="designer-page-block"><h3>第 ${pi+1} 頁｜${escapeHtml(p.title)}</h3>${groups.map(g=>`<div class="group-block"><div class="group-heading"><strong>▰ ${escapeHtml(g)}</strong><span>${qs.filter(x=>(x.q.group||'填寫資料')===g).length} 題</span></div>${qs.filter(x=>(x.q.group||'填寫資料')===g).map(x=>questionCard(x.i,x.q,qs.filter(y=>(y.q.group||'填寫資料')===g).map(y=>y.i))).join('')}</div>`).join('')||'<div class="empty">這一頁目前沒有題目。</div>'}</div>`}).join('')}
function questionCard(i,q,groupIndexes){const pos=groupIndexes.indexOf(i);return `<div class="question-card"><div class="move-buttons"><button class="icon-btn" onclick="moveQuestionWithinGroup(${i},-1)" ${pos<=0?'disabled':''}>↑</button><button class="icon-btn" onclick="moveQuestionWithinGroup(${i},1)" ${pos===groupIndexes.length-1?'disabled':''}>↓</button></div><div class="q-no">${pos+1}</div><div class="grow"><div class="editor-grid"><div><label>所在頁面</label><select onchange="changeQuestionPage(${i},this.value)">${state.config.pages.map(p=>`<option value="${escapeAttr(p.id)}" ${q.pageId===p.id?'selected':''}>${escapeHtml(p.title)}</option>`).join('')}</select></div><div><label>子標題／小分類</label><input value="${escapeAttr(q.group||'填寫資料')}" oninput="state.config.questions[${i}].group=this.value"></div><div class="wide"><label>題目文字</label><input value="${escapeAttr(q.label)}" oninput="state.config.questions[${i}].label=this.value"></div><div><label>回答格式</label><select onchange="state.config.questions[${i}].type=this.value"><option value="text" ${q.type==='text'?'selected':''}>單行文字</option><option value="textarea" ${q.type==='textarea'?'selected':''}>多行文字</option><option value="number" ${q.type==='number'?'selected':''}>數字</option><option value="date" ${q.type==='date'?'selected':''}>日期</option></select></div><div><label>是否必填</label><select onchange="state.config.questions[${i}].required=this.value==='true'"><option value="true" ${q.required?'selected':''}>必填</option><option value="false" ${!q.required?'selected':''}>非必填</option></select></div><div class="wide"><label>欄位代碼</label><input class="code-input" value="${escapeAttr(q.id)}" oninput="state.config.questions[${i}].id=this.value.replace(/[^A-Za-z0-9_]/g,'_')"></div></div></div><button class="danger" onclick="removeQuestion(${i})">刪除</button></div>`}
function addPage(){state.config.pages.push({id:'page_'+Date.now(),title:'新頁面',description:''});renderFormDesigner()}
function removePage(i){const p=state.config.pages[i];if(state.config.questions.some(q=>q.pageId===p.id)){alert('請先把這一頁的題目移到其他頁面。');return}if(state.config.pages.length<=1){alert('至少要保留一個頁面。');return}state.config.pages.splice(i,1);renderFormDesigner()}
function movePage(i,d){const j=i+d;if(j<0||j>=state.config.pages.length)return;[state.config.pages[i],state.config.pages[j]]=[state.config.pages[j],state.config.pages[i]];renderPagesEditor();renderQuestionsEditor()}
function addQuestion(){if(!state.config.pages.length)return;const p=state.config.pages[0];const groups=groupNamesForPage(p.id);state.config.questions.push({id:'new_field_'+Date.now(),label:'新題目',type:'text',required:false,pageId:p.id,group:groups[0]||'填寫資料'});renderQuestionsEditor()}
function changeQuestionPage(i,pageId){state.config.questions[i].pageId=pageId;const groups=groupNamesForPage(pageId);if(!groups.includes(state.config.questions[i].group))state.config.questions[i].group=groups[0]||'填寫資料';renderQuestionsEditor()}
function moveQuestionWithinGroup(i,d){const q=state.config.questions[i],same=state.config.questions.map((x,idx)=>({x,idx})).filter(o=>o.x.pageId===q.pageId&&(o.x.group||'填寫資料')===(q.group||'填寫資料')).map(o=>o.idx);const pos=same.indexOf(i),j=pos+d;if(j<0||j>=same.length)return;const target=same[j];[state.config.questions[i],state.config.questions[target]]=[state.config.questions[target],state.config.questions[i]];renderQuestionsEditor()}
function removeQuestion(i){state.config.questions.splice(i,1);renderQuestionsEditor()}
async function saveFormConfig(){const msg=$('formSaveMsg');state.config.title=$('siteTitle').value;state.config.subtitle=$('siteSubtitle').value;state.config.uiTexts={...(state.config.uiTexts||{}),companyTitle:$('companyTitle').value,companySubtitle:$('companySubtitle').value,companyIntro:$('companyIntro').value,companyLoginTitle:$('companyLoginTitle').value,companyLoginHint:$('companyLoginHint').value,staffLoginTitle:$('staffLoginTitle').value,staffLoginHint:$('staffLoginHint').value};const ids=state.config.questions.map(q=>q.id.trim());if(ids.some(x=>!x)||new Set(ids).size!==ids.length){msg.innerHTML='<span class="msg error inline-msg">欄位代碼不可空白或重複。</span>';return}try{await api('/api/admin/form-config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.config)});msg.innerHTML='<span class="msg success inline-msg">✓ 已儲存！</span>';setTimeout(()=>msg.innerHTML='',4000)}catch(err){msg.innerHTML=`<span class="msg error inline-msg">${escapeHtml(err.message)}</span>`}}

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
    const nodeStyle=`display:${visible?'block':'none'};`;
    return `<div class="custom-menu-node custom-menu-node-v588" data-menu-id="${escapeAttr(String(item.id))}" data-parent-id="${escapeAttr(String(item.parentId||''))}" data-depth="${depth}" style="${nodeStyle}">
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

function renderCustomization(){
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
  const isOverride=!isPlatform && !!c.overrides?.[c.scope];
  const title=isPlatform?'🌐 平台標準工作目錄':'🧩 企業客製化工作目錄';
  const intro=isPlatform?'這裡是整個平台的「基本標準目錄」。所有沒有另外客製的企業都會使用這套目錄；企業客製化不會反過來修改這裡。':'這裡只調整指定企業的工作目錄。只有該企業會受到影響，不會改變其他企業。';
  const status=isPlatform?'目前正在編輯：平台預設｜這套目錄會作為所有企業的基準。':`目前：${escapeHtml(t?.name||'尚未選擇公司')}｜${isOverride?'已使用企業客製目錄':'目前沿用平台預設目錄'}`;
  el.innerHTML=`<div class="panel"><div class="section-title">${title}</div><p>${intro}</p><div class="editor-grid"><div><label>設定對象</label><select id="customTargetSelect">${targetOptions}</select></div><div><label>工作空間</label><select id="customScopeSelect">${scopeOptions}</select></div></div><p class="hint">${status}</p></div><div class="panel"><div class="section-title">📂 ${c.scope==='company'?'公司內勤':'社區駐點'}工作目錄</div><p class="hint">母目錄與子目錄會自動整理成樹狀結構。新增子目錄後會直接掛在母目錄下方；點「＋／−」可展開或收合。上下箭頭只會調整同一層級的順序。</p><div class="custom-menu-tree">${rootRows||'<div class="empty">目前沒有目錄項目。</div>'}</div><div class="form-nav"><button class="secondary" onclick="addCustomMenu()">＋ 新增母目錄</button>${isPlatform?'':'<button class="secondary" onclick="resetCustomMenu()">↩ 這家公司恢復平台預設</button>'}<button onclick="saveCustomMenu()">💾 ${isPlatform?'儲存平台預設':'儲存這家公司設定'}</button><span id="customSaveMsg"></span></div></div><div class="panel"><div class="section-title">🔐 權限分流說明</div><div class="guide-grid"><div><strong>🏢 內勤</strong><br>公司財務、會計、總務、人事、公司資源等內勤工作。</div><div><strong>🏠 駐點</strong><br>代辦、工作日誌、管理委員會、住戶、廠商、交接等社區工作。</div><div><strong>🏢＋🏠 內勤＋兼任駐點</strong><br>同一人可同時擁有兩個工作空間的可處理項目。</div><div><strong>🧩 企業客製</strong><br>企業若有特殊需求，可在「設定對象」選擇公司後獨立調整，不影響其他企業。</div></div></div>`;
  $('customTargetSelect').addEventListener('change',async e=>{const v=e.target.value;if(v==='platform'){c.mode='platform';c.tenantId=null;}else{c.mode='company';c.tenantId=Number(v.split(':')[1]);}c.openIds=[];await loadCustomization();renderCustomization();});
  $('customScopeSelect').addEventListener('change',async e=>{c.scope=e.target.value;c.openIds=[];await loadCustomization();renderCustomization();});
}
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
  nodes.forEach(node=>{node.style.display=calcVisible(node)?'block':'none';});
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
async function resetCustomMenu(){if(!confirm('確定讓這家公司恢復使用平台預設目錄嗎？不會刪除任何人員或業務資料。'))return;try{await api('/api/admin/menu-config/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:state.customization.scope,tenant_id:state.customization.tenantId})});await loadCustomization();renderCustomization();}catch(err){alert(err.message)}}
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

function formatDate(s){return new Date(s).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function escapeAttr(s){return escapeHtml(s)}
checkSession();

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCustomMenuEditor()});
