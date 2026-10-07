let formConfig=null, answers={}, currentPage=0, draftId=null, draftCommunityId=null, autosaveTimer=null, saving=false, dirty=false, communities=[];
const $=id=>document.getElementById(id);
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
async function applyStaffBranding(){try{const b=await api('/api/staff/branding');document.title=b.title||document.title;const root=document.documentElement;root.style.setProperty('--accent',b.accent);root.style.setProperty('--accent-dark',b.accentDark);root.style.setProperty('--bg',b.bg);root.style.setProperty('--panel',b.panel);}catch(e){console.warn('Staff branding load skipped',e)}}
async function boot(){
  // 平台名稱與「表單範本標題」分離，避免公司自訂的表單名稱跑到網站／瀏覽器標題。
  // 例如表單可以叫「社區行政事務回報」，但網站仍維持「社區管理工作平台」。
  const platformTitle='社區管理工作平台';
  const platformSubtitle='物業管理數位工作平台';
  document.title=platformTitle;
  document.querySelector('.brand').textContent=platformTitle;
  document.querySelector('.sub').textContent=platformSubtitle;
  try{
    formConfig=await api('/api/form-config');
    // 登入頁版型固定，不讓舊版表單文字設定覆蓋新的 UI。
    const loginBtn=document.querySelector('#staffLoginForm button[type=submit]');
    if(loginBtn)loginBtn.textContent='登入';
    const s=await api('/api/staff/session');
    if(s.loggedIn){
      if(s.entry==='company' || s.user.role==='company_admin'){ location.href='company.html'; return; }
      await applyStaffBranding();
      showHome(s.user);
    }else showLogin();
  }catch(err){
    // API 暫時慢／失敗時不要讓手機看到一整頁空白。保留登入畫面並顯示可理解的提示。
    showLogin();
    const m=document.getElementById('loginMsg');
    if(m)m.innerHTML=`<div class="msg error">系統目前載入較慢，請稍候再試。${escapeHtml(err?.message||'')}</div>`;
    console.warn('Staff boot failed',err);
  }
}
function setTopbarCompany(name){
  const brand=$('platformBrand');
  const sub=$('platformSub');
  if(brand)brand.textContent=name||'（公司名稱）';
  if(sub)sub.textContent='';
}
function showLogin(){
  window.__workspaceAuthenticated=false;window.setMessageCenterVisible?.(false);
  $('loginView').style.display='block';$('homeView').style.display='none';$('editorView').style.display='none';$('staffTop').style.display='none';
  $('loginInternal').style.display='flex';
  setTopbarCompany('（公司名稱）');
  document.body.classList.remove('is-authenticated');
}
function showCompanyHint(user){ location.href='company.html'; }
function showHome(user){
  window.__messageCurrentUserId=user?.id||null;
  window.__workspaceAuthenticated=true;window.setMessageCenterVisible?.(true);
  $('loginView').style.display='none';$('homeView').style.display='block';$('editorView').style.display='none';$('staffTop').style.display='flex';$('loginInternal').style.display='none';
  $('staffName').textContent=user.name||'使用者';
  setTopbarCompany(user.tenant_name||'（公司名稱）');
  document.body.classList.add('is-authenticated');
  const profile=$('staffProfile');
  if(profile){
    profile.onclick=()=>showStaffProfile(user);
    profile.title='查看人職資料';
  }
  window.refreshWorkspaceMenu?.('staff');loadHome(user); if(Array.isArray(user.site_assignments)&&user.site_assignments.length>1) openSiteContextPicker(user.site_assignments); else if(Array.isArray(user.site_assignments)&&user.site_assignments.length===1) selectSiteContext(user.site_assignments[0].community_id);
}
async function selectSiteContext(communityId){try{await api('/api/staff/select-community',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({community_id:Number(communityId)})});}catch(e){console.warn('site context select failed',e)}}
function openSiteContextPicker(assignments){const old=document.getElementById('siteContextPicker');if(old)old.remove();const modal=document.createElement('div');modal.id='siteContextPicker';modal.className='modal-backdrop';modal.innerHTML=`<div class="modal community-picker-modal" role="dialog" aria-modal="true"><div class="eyebrow">現場工作台</div><h2>請選擇要進入的案場</h2><p class="modal-note">您同時服務多個案場。進入後只會看到該案場的資料，不會與其他社區混在一起。</p><div class="community-choice-list">${assignments.map(a=>`<button type="button" class="community-choice" data-cid="${a.community_id}"><span>🏠</span><strong>${escapeHtml(a.community_name||'未命名案場')}</strong><span>→</span></button>`).join('')}</div></div>`;document.body.appendChild(modal);document.body.classList.add('modal-open');modal.querySelectorAll('[data-cid]').forEach(btn=>btn.addEventListener('click',async()=>{await selectSiteContext(btn.dataset.cid);modal.remove();document.body.classList.remove('modal-open');setTopbarCompany((assignments.find(a=>String(a.community_id)===String(btn.dataset.cid))||{}).community_name||'（公司名稱）');loadHome();}));}
async function showStaffProfile(user){
  const old=document.getElementById('staffProfileModal');
  if(old)old.remove();
  const modal=document.createElement('div');
  modal.id='staffProfileModal';
  modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal staff-profile-modal" role="dialog" aria-modal="true">
    <button type="button" class="modal-close" aria-label="關閉">×</button>
    <div class="eyebrow">職員資料</div>
    <h2 id="profileName">${escapeHtml(user?.name||'使用者')}</h2>
    <div id="staffProfileBody" class="staff-profile-body"><div class="profile-loading">資料載入中…</div></div>
    <div class="profile-logout-wrap"><button type="button" class="profile-logout" id="staffProfileLogout">登出</button></div>
  </div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};
  modal.querySelector('.modal-close').addEventListener('click',close);
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  modal.querySelector('#staffProfileLogout').addEventListener('click',async()=>{
    const btn=modal.querySelector('#staffProfileLogout');btn.disabled=true;btn.textContent='登出中…';
    try{await api('/api/staff/logout',{method:'POST'});location.href='/';}catch(e){btn.disabled=false;btn.textContent='登出';alert(e.message||'登出失敗');}
  });
  try{
    const d=await api('/api/staff/profile');
    const communityNames=(d.communities||[]).map(c=>c.name).filter(Boolean);
    const salary=d.salary||{};
    const body=modal.querySelector('#staffProfileBody');
    body.innerHTML=`
      <div class="staff-profile-basic">
        <div><span>員編</span><strong>${escapeHtml(d.employee_id||'—')}</strong></div>
        <div><span>職務</span><strong>${escapeHtml(d.position||'尚未設定')}</strong></div>
        <div><span>公司</span><strong>${escapeHtml(d.tenant_name||'—')}</strong></div>
        <div><span>服務案場</span><strong>${communityNames.length?escapeHtml(communityNames.join('、')):'目前無駐點案場'}</strong></div>
      </div>
      <button type="button" class="monthly-payslip-card" id="salaryDetailsBtn">
        <span><strong>薪資相關</strong><small>試用期、正式薪資、投保等資料</small></span><b>›</b>
      </button>
      <button type="button" class="monthly-payslip-card" id="monthlyPayslipBtn">
        <span><strong>本月薪資單</strong><small>點選查看當月薪資單</small></span><b>›</b>
      </button>`;
    modal.querySelector('#salaryDetailsBtn').addEventListener('click',()=>openSalaryDetailsCard(salary));
    modal.querySelector('#monthlyPayslipBtn').addEventListener('click',()=>openPayslipCard(d));
  }catch(e){modal.querySelector('#staffProfileBody').innerHTML=`<div class="profile-error">目前無法載入職員資料。<br><small>${escapeHtml(e.message||'')}</small></div>`;}
}
function openPayslipCard(profile){
  const old=document.getElementById('staffPayslipModal');if(old)old.remove();
  const modal=document.createElement('div');modal.id='staffPayslipModal';modal.className='modal-backdrop payslip-backdrop';
  const now=new Date();const ym=`${now.getFullYear()} 年 ${now.getMonth()+1} 月`;
  modal.innerHTML=`<div class="modal payslip-modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><div class="eyebrow">本月薪資單</div><h2>${escapeHtml(ym)}</h2><div class="payslip-empty"><strong>本月薪資單尚未建立</strong><p>待公司後台建立薪資資料後，這裡會顯示當月薪資單。</p></div></div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};modal.querySelector('.modal-close').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close()});
}
function openSalaryDetailsCard(salary){
  salary=salary||{};
  const old=document.getElementById('staffSalaryModal');if(old)old.remove();
  const modal=document.createElement('div');modal.id='staffSalaryModal';modal.className='modal-backdrop payslip-backdrop';
  modal.innerHTML=`<div class="modal payslip-modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><div class="eyebrow">薪資相關</div><h2>試用與投保資料</h2><div class="staff-profile-basic salary-details-body">
    <div><span>試用期</span><strong>${salary.trial_end_date?`至 ${escapeHtml(salary.trial_end_date)}`:'尚未設定'}</strong></div>
    <div><span>正式薪資</span><strong>${salary.formal_salary?escapeHtml(salary.formal_salary):'尚未設定'}</strong></div>
    <div><span>投保級距</span><strong>${salary.insurance_level?escapeHtml(salary.insurance_level):'尚未設定'}</strong></div>
    <div><span>健保眷屬</span><strong>${Number.isFinite(Number(salary.health_dependents))?Number(salary.health_dependents):0} 人</strong></div>
  </div></div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};modal.querySelector('.modal-close').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close()});
}


let staffClockTimer=null;
function staffJobSummary(user){
  const cats=Array.isArray(user?.job_categories)?user.job_categories:[];
  const level=String(user?.job_level||'').trim();
  const position=String(user?.position||user?.job_title||user?.title||'').trim();
  const main=level||position||'現場人員';
  const extras=cats.filter(x=>String(x||'').trim() && String(x).trim()!==main).map(String);
  return [main,...extras].slice(0,2).join('｜');
}
async function loadHome(user){
  const el=$('staffHome');
  if(!el)return;
  const displayName=String(user?.name||'').trim()||'使用者';
  const jobSummary=staffJobSummary(user);
  el.innerHTML=`<div class="dashboard-layout dashboard-layout-v2">
    <div class="dashboard-left">
      <div class="panel home-head home-head-v2"><div><div class="eyebrow">歡迎回來</div><h1>${escapeHtml(displayName)} <span class="home-role">（${escapeHtml(jobSummary)}）</span></h1><div id="staffCommunityHint" class="home-community"></div></div><div class="home-community-badge">🏢 <span id="staffCommunityBadge">案場</span></div></div>
      <div class="panel dashboard-clock"><div class="eyebrow">今天</div><div id="staffDate" class="dashboard-date"></div><div id="staffClock" class="dashboard-time"></div><div class="dashboard-note">本日尚未安排事務</div></div>
    </div>
    <div class="panel dashboard-todo"><div class="section-title"><span>📌</span> 代辦事項 <span id="todoCount" class="home-count-badge">0</span><button type="button" class="todo-add" id="todoAddBtn" aria-label="新增代辦事項">＋</button></div><div id="todoList" class="todo-list"><div class="todo-empty">載入中…</div></div></div>
  </div>
  <div class="dashboard-bottom-grid">
    <div id="pinnedWorkPanel" class="panel pinned-panel pinned-panel-v2"><div class="section-title">⭐ 釘選工作</div><div id="pinnedWorkList" class="pinned-work-list"><div class="empty">載入中…</div></div></div>
    <div class="panel important-panel"><div class="section-title"><span>🔔</span> 重要事項提醒 <button type="button" class="important-view-all" id="importantViewAll">查看全部</button></div><div id="importantReminderList" class="important-reminder-list"><div class="important-empty"><div class="important-empty-icon">🔔</div><strong>目前尚無重要事項提醒</strong><span>有需要優先處理的公告、設備、住戶或案場事項時，會顯示在這裡。</span></div></div></div>
  </div>`;
  clearInterval(staffClockTimer);
  const tick=()=>{const d=new Date();const date=$('staffDate'),clock=$('staffClock');if(date)date.textContent=d.toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric',weekday:'long'});if(clock)clock.textContent=d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',second:'2-digit'});};
  tick();staffClockTimer=setInterval(tick,1000);
  $('todoAddBtn')?.addEventListener('click',openTodoCreateModal);
  $('importantViewAll')?.addEventListener('click',()=>{ const item=document.querySelector('[data-action="todo"]'); if(item) item.click(); });
  await Promise.all([loadPinnedWork(),loadHomeTodos(),loadStaffCommunityHint()]);
}
async function loadStaffCommunityHint(){
  const el=$('staffCommunityHint'); if(!el)return;
  try{const d=await api('/api/staff/communities'); const list=Array.isArray(d)?d:[]; const text=list.length===1?(list[0].name||''):list.length>1?list.map(x=>x.name).join('、'):''; el.textContent=text; const badge=$('staffCommunityBadge'); if(badge) badge.textContent=list.length===1?(list[0].name||'案場'):(list.length>1?'多案場':'案場');}
  catch(e){el.textContent='';}
}
function todoTime(s){if(!s)return '—';const d=new Date(s);return d.toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
async function loadHomeTodos(){
  const list=$('todoList'); if(!list)return;
  try{
    const d=await api('/api/staff/todos'); const todos=(d.todos||[]).filter(x=>x.status==='open');
    const badge=$('todoCount');if(badge)badge.textContent=String(todos.length);
    if(!todos.length){list.innerHTML='<div class="todo-empty">目前尚無代辦事項。</div>';return;}
    list.innerHTML=todos.slice(0,5).map(t=>`<div class="todo-row" data-todo-id="${t.id}"><button type="button" class="todo-check" aria-label="完成代辦事項" title="標記完成">○</button><div class="todo-content"><strong>${escapeHtml(t.content)}</strong><small>登記時間：${escapeHtml(todoTime(t.created_at))}</small></div></div>`).join('') + (todos.length>5?`<div class="todo-more">還有 ${todos.length-5} 項待處理…</div>`:'');
    list.querySelectorAll('.todo-check').forEach(btn=>btn.addEventListener('click',async()=>{const row=btn.closest('.todo-row');const id=Number(row?.dataset.todoId);if(!id)return;btn.disabled=true;try{await api(`/api/staff/todos/${id}/complete`,{method:'PUT'});await loadHomeTodos();}catch(e){btn.disabled=false;alert(e.message||'完成代辦事項失敗');}}));
  }catch(e){list.innerHTML=`<div class="todo-empty">目前無法載入代辦事項。<br><small>${escapeHtml(e.message||'')}</small></div>`;}
}
function openTodoCreateModal(){
  const old=document.getElementById('todoCreateModal'); if(old)old.remove();
  const modal=document.createElement('div'); modal.id='todoCreateModal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal todo-create-modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><div class="eyebrow">📌 代辦事項</div><h2>新增代辦事項</h2><div class="field"><label for="newTodoContent">事項內容</label><textarea id="newTodoContent" rows="4" maxlength="300" placeholder="請輸入要處理的工作…"></textarea></div><div class="modal-actions"><button type="button" class="secondary" id="todoCancelBtn">取消</button><button type="button" id="todoSaveBtn">新增</button></div></div>`;
  document.body.appendChild(modal); document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};
  modal.querySelector('.modal-close').addEventListener('click',close);modal.querySelector('#todoCancelBtn').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close()});
  const input=modal.querySelector('#newTodoContent'); input.focus();
  modal.querySelector('#todoSaveBtn').addEventListener('click',async()=>{const content=input.value.trim();if(!content){input.focus();return;}const btn=modal.querySelector('#todoSaveBtn');btn.disabled=true;btn.textContent='新增中…';try{await api('/api/staff/todos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});close();await loadHomeTodos();}catch(e){btn.disabled=false;btn.textContent='新增';alert(e.message||'新增代辦事項失敗');}});
}
async function loadTodoPage(){
  const el=$('staffHome'); if(!el)return; showWorkspaceLoading('代辦事項');
  try{
    const d=await api('/api/staff/todos');
    const rows=(d.todos||[]).filter(x=>x.status==='open');
    el.innerHTML=`<div class="panel todo-page-panel"><div class="todo-page-head"><div><div class="eyebrow">📌 工作項目</div><h1>代辦事項</h1><p class="hint">目前需要處理的工作會顯示在這裡；完成後會自動移到「已封存」。</p></div><button type="button" class="todo-page-add" id="todoPageAddBtn">＋ 新增代辦事項</button></div><div id="todoPageList" class="todo-page-list">${rows.length?rows.map(t=>`<div class="todo-page-row" data-todo-id="${t.id}"><button type="button" class="todo-check" title="完成並封存">○</button><div class="todo-content"><strong>${escapeHtml(t.content)}</strong><small>登記人：${escapeHtml(t.created_by_name||'—')}</small><small>登記時間：${escapeHtml(todoTime(t.created_at))}</small></div></div>`).join(''):'<div class="todo-empty">目前尚無代辦事項。</div>'}</div></div>`;
    $('todoPageAddBtn')?.addEventListener('click',openTodoCreateModal);
    el.querySelectorAll('.todo-page-row .todo-check').forEach(btn=>btn.addEventListener('click',async()=>{const row=btn.closest('.todo-page-row');const id=Number(row?.dataset.todoId);if(!id)return;btn.disabled=true;try{await api(`/api/staff/todos/${id}/complete`,{method:'PUT'});await loadTodoPage();}catch(e){btn.disabled=false;alert(e.message||'完成代辦事項失敗');}}));
  }catch(e){showWorkspaceError('代辦事項',e);}
}
async function loadArchivedTodos(params={}){
  const el=$('staffHome'); if(!el)return; showWorkspaceLoading('已封存');
  try{
    const q=new URLSearchParams(); if(params.keyword)q.set('keyword',params.keyword); if(params.date)q.set('date',params.date);
    const d=await api('/api/staff/todos/archived'+(q.toString()?`?${q.toString()}`:''));
    const rows=d.todos||[];
    el.innerHTML=`<div class="panel workspace-placeholder archived-todos-panel"><div class="eyebrow">📌 代辦事項</div><h1>已封存</h1><p class="hint">已完成的代辦事項會保留在這裡，不會被刪除。</p><form id="archivedTodoSearch" class="archived-search"><input id="archivedKeyword" type="search" placeholder="搜尋名稱／關鍵字" value="${escapeHtml(params.keyword||'')}"><input id="archivedDate" type="date" value="${escapeHtml(params.date||'')}"><button type="submit">搜尋</button><button type="button" class="secondary" id="archivedClearBtn">清除</button></form>${rows.length?`<div class="archived-todo-list">${rows.map(t=>`<div class="archived-todo-row"><div class="archived-todo-check">✓</div><div class="todo-content"><strong>${escapeHtml(t.content)}</strong><small>登記人：${escapeHtml(t.created_by_name||'—')}</small><small>處理人：${escapeHtml(t.completed_by_name||'—')}</small><small>登記時間：${escapeHtml(todoTime(t.created_at))}</small><small>處理完畢：${escapeHtml(todoTime(t.completed_at))}</small></div></div>`).join('')}</div>`:'<div class="todo-empty">查無符合條件的封存紀錄。</div>'}</div>`;
    $('archivedTodoSearch')?.addEventListener('submit',e=>{e.preventDefault();loadArchivedTodos({keyword:$('archivedKeyword')?.value.trim()||'',date:$('archivedDate')?.value||''});});
    $('archivedClearBtn')?.addEventListener('click',()=>loadArchivedTodos());
  }catch(e){showWorkspaceError('已封存',e);}
}
async function loadPinnedWork(){
  const list=$('pinnedWorkList');if(!list)return;
  try{
    const d=await api('/api/staff/dashboard-pins');
    const pins=Array.isArray(d.pins)?d.pins:[];
    if(!pins.length){list.innerHTML=`<div class="pinned-empty"><div class="pinned-empty-icon">☆</div><strong>還沒有釘選工作</strong><span>請從左側工作目錄找到常用功能，點一下右側的 ☆，就會出現在這裡。</span></div>`;return;}
    list.innerHTML=pins.map(p=>{const item=p.item||{};return `<button type="button" class="pinned-work-card" data-pinned-action="${escapeHtml(item.action||'placeholder')}" data-pinned-id="${escapeHtml(item.id||'')}" data-pinned-label="${escapeHtml(item.label||'')}" title="開啟${escapeHtml(item.label||'工作項目')}"><span class="pinned-work-icon">${escapeHtml(item.icon||'•')}</span><span class="pinned-work-body"><strong>${escapeHtml(item.label||'未命名功能')}</strong><small>點一下直接開啟</small></span><span class="pinned-work-arrow">→</span></button>`}).join('');
    list.querySelectorAll('[data-pinned-action]').forEach(btn=>btn.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:btn.dataset.pinnedAction,id:btn.dataset.pinnedId,label:btn.dataset.pinnedLabel}}))));
  }catch(e){list.innerHTML=`<div class="empty">暫時無法載入釘選工作。</div>`;console.warn(e)}
}

async function loadCentralManagerChecklist(){
  const d=await api('/api/staff/manager-checklist');
  if(!d.formConfig || !Array.isArray(d.formConfig.pages) || !d.formConfig.pages.length){
    throw new Error('中央交接清冊沒有可用的頁面，請到總後臺檢查設定。');
  }
  formConfig=d.formConfig;
  communities=Array.isArray(d.communities)?d.communities:[];
  return d;
}
async function startDraftForCommunity(cid){
  if(!formConfig || !Array.isArray(formConfig.pages) || !formConfig.pages.length || !Array.isArray(formConfig.questions)){
    await loadCentralManagerChecklist();
  }
  const community=communities.find(c=>c.id===Number(cid));
  if(!community){showMessage('找不到可用的駐點社區。','error');return;}
  const initial={};
  if(formConfig.questions.some(q=>q.id==='community_name')) initial.community_name=community.name||'';
  const r=await api('/api/staff/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:initial,current_page:0,community_id:Number(cid)})});
  draftId=r.id;draftCommunityId=Number(cid);answers=initial;currentPage=0;showEditor();
}

async function openManagerChecklist(label='經理交接清冊'){
  // 這裡直接讀取總後臺的中央經理版，不再依賴登入頁當下是否已經載入 formConfig。
  await loadCentralManagerChecklist();
  if(communities.length===0){
    const el=$('staffHome');
    el.innerHTML=`<div class="panel workspace-error"><div class="eyebrow">${escapeHtml(label)}</div><h1>尚未開通駐點案場</h1><p>目前這個人員帳號沒有被指定任何啟用中的社區，因此暫時無法開啟經理交接清冊。</p><p class="hint">請由公司後台為此人員設定駐點社區；設定完成後，重新登入即可看到完整的中央經理版交接清冊。</p></div>`;
    return;
  }
  const drafts=await api('/api/staff/drafts');
  if(communities.length===1){
    const cid=communities[0].id;
    const existing=drafts.find(d=>Number(d.community_id)===Number(cid));
    if(existing){await continueDraft(existing.id);}else{await startDraftForCommunity(cid);}
    return;
  }
  const options=communities.map(c=>`<button type="button" class="community-choice" data-community-id="${c.id}"><span>🏠</span><strong>${escapeHtml(c.name)}</strong><span>→</span></button>`).join('');
  const modal=document.createElement('div');modal.className='modal-backdrop';modal.innerHTML=`<div class="modal community-picker-modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><div class="eyebrow">${escapeHtml(label)}</div><h2>請選擇這次要交接的社區</h2><p class="modal-note">您同時服務多個社區，因此才需要選擇；如果只有一個社區，會直接進入完整交接清冊。</p><div class="community-choice-list">${options}</div></div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};
  modal.querySelector('.modal-close').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close()});
  modal.querySelectorAll('.community-choice').forEach(btn=>btn.addEventListener('click',async()=>{const cid=Number(btn.dataset.communityId);close();const existing=drafts.find(d=>Number(d.community_id)===cid);if(existing)await continueDraft(existing.id);else await startDraftForCommunity(cid);}));
}

async function loadChecklistModule(label='交接清冊'){
  await loadCentralManagerChecklist();
  const drafts=await api('/api/staff/drafts');
  const el=$('staffHome');
  if(!el)return;
  const cards=drafts.length?drafts.map(d=>{const pct=Math.min(99,Math.round(((d.current_page+1)/formConfig.pages.length)*100));const community=d.data.community_name||communities.find(c=>c.id===d.community_id)?.name||'尚未指定社區';return `<div class="draft-card"><div><div class="draft-title">🏠 ${escapeHtml(community)}</div><div class="hint">最後儲存：${formatDate(d.updated_at)}　｜　目前第 ${Math.min(d.current_page+1,formConfig.pages.length)} / ${formConfig.pages.length} 頁</div><div class="progress-mini"><span style="width:${pct}%"></span></div></div><div class="draft-actions"><button onclick="continueDraft(${d.id})">繼續填寫</button><button class="danger" onclick="deleteDraft(${d.id})">刪除草稿</button></div></div>`}).join(''):'<div class="empty">目前沒有未完成的交接紀錄。</div>';
  const communityOptions=communities.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  el.innerHTML=`<div class="panel"><div class="eyebrow">工作項目</div><h1>📋 ${escapeHtml(label)}</h1><p class="hint">交接相關工作集中在這裡；完成後不會一直顯示在工作台首頁。</p><div class="new-draft-box"><label>選擇要交接的社區</label><select id="newCommunity">${communityOptions||'<option value="">目前尚無可用社區</option>'}</select><button class="big-action" onclick="newDraft()" ${communities.length?'':'disabled'}>＋ 開始新的交接</button></div></div><div class="panel"><div class="section-title">🟡 未完成交接清冊</div>${cards}</div>`;
}
function showWorkspacePlaceholder(label){
  $('loginView').style.display='none';$('editorView').style.display='none';$('homeView').style.display='block';$('staffTop').style.display='flex';
  const el=$('staffHome');el.innerHTML=`<div class="panel workspace-placeholder"><div class="eyebrow">工作項目</div><h1>🚧 ${escapeHtml(label||'工作功能')}</h1><p>這個工作內容已經可以放進工作目錄與個人釘選區，實際資料功能會依平台建置進度陸續加入。</p><div class="placeholder-note">您可以先把常用的其他工作項目釘選到首頁；未來功能完成後，不需要重新設定釘選。</div></div>`;
}

function showWorkspaceLoading(label){
  const el=$('staffHome');
  if(!el)return;
  $('loginView').style.display='none';$('editorView').style.display='none';$('homeView').style.display='block';$('staffTop').style.display='flex';
  el.innerHTML=`<div class="panel workspace-loading"><div class="eyebrow">工作項目</div><h1>📋 ${escapeHtml(label||'工作功能')}</h1><p>正在讀取您的社區與交接資料，請稍候…</p></div>`;
}
function showWorkspaceError(label,err){
  const el=$('staffHome');
  if(!el)return;
  $('loginView').style.display='none';$('editorView').style.display='none';$('homeView').style.display='block';$('staffTop').style.display='flex';
  el.innerHTML=`<div class="panel workspace-error"><div class="eyebrow">${escapeHtml(label||'工作功能')}</div><h1>目前無法開啟</h1><p>${escapeHtml(err?.message||'系統暫時無法取得資料。')}</p><button type="button" class="secondary" onclick="location.reload()">重新整理</button></div>`;
}
async function handleWorkspaceMenu(e){
  const {action,label}=e.detail||{};
  if(action==='home'){const s=await api('/api/staff/session');if(s.loggedIn)showHome(s.user);return;}
  if(action==='todo'){
    await loadTodoPage();
    return;
  }
  if(action==='todo-archived'){
    try{await loadArchivedTodos();}catch(err){showWorkspaceError(label||'已封存',err);}
    return;
  }
  if(action==='manager-checklist'){
    showWorkspaceLoading(label||'經理交接清冊');
    try{await openManagerChecklist(label||'經理交接清冊');}catch(err){showWorkspaceError(label||'經理交接清冊',err);}
    return;
  }
  if(action==='checklist'||action==='secretary-checklist'){
    showWorkspaceLoading(label||'交接清冊');
    try{await loadChecklistModule(label||'交接清冊');}catch(err){showWorkspaceError(label||'交接清冊',err);}
    return;
  }
  if(['residents-contact','residents-owners','residents-tenants'].includes(action)){
    showWorkspaceLoading(label||'住戶名冊');
    try{if(!window.ResidentRosterModule) throw new Error('住戶名冊模組尚未載入，請重新整理頁面'); await window.ResidentRosterModule.render(action,label||'住戶名冊');}catch(err){showWorkspaceError(label||'住戶名冊',err);}
    return;
  }
  if(action==='staff-attendance'){
    showWorkspaceLoading(label||'出勤與巡邏');
    try{if(!window.AttendanceStaffModule) throw new Error('出勤與巡邏模組尚未載入，請重新整理頁面'); await window.AttendanceStaffModule.render();}catch(err){showWorkspaceError(label||'出勤與巡邏',err);}
    return;
  }
  showWorkspacePlaceholder(label||'工作功能');
}
document.addEventListener('workspace-menu',e=>{handleWorkspaceMenu(e).catch(err=>showWorkspaceError(e.detail?.label||'工作功能',err));});
document.addEventListener('dashboard-pins-changed',()=>{if($('homeView')&&getComputedStyle($('homeView')).display!=='none')loadPinnedWork();});

async function newDraft(){const cid=Number($('newCommunity')?.value||0);if(!cid){showMessage('請先選擇社區。','error');return}await startDraftForCommunity(cid);}
async function continueDraft(id){const d=await api(`/api/staff/drafts/${id}`);draftId=d.id;draftCommunityId=d.community_id||null;answers=d.data||{};currentPage=Math.max(0,Math.min(Number(d.current_page)||0,formConfig.pages.length-1));showEditor();}
async function deleteDraft(id){if(!confirm('確定刪除這份未完成草稿嗎？刪除後無法復原。'))return;await api(`/api/staff/drafts/${id}`,{method:'DELETE'});loadChecklistModule('交接清冊');}
function showEditor(){ $('homeView').style.display='none';$('editorView').style.display='block';dirty=false;renderPage();window.scrollTo({top:0}); }
function getPageQuestions(pageId){return formConfig.questions.filter(q=>q.pageId===pageId)}
function groupedQuestions(pageId){const groups=[],map={};for(const q of getPageQuestions(pageId)){const key=q.group||'填寫資料';if(!map[key]){map[key]={title:key,questions:[]};groups.push(map[key])}map[key].questions.push(q)}return groups;}
function renderPage(){
 const form=$('checklistForm'),page=formConfig.pages[currentPage],total=formConfig.pages.length;form.innerHTML='';renderProgress();
 $('draftBar').innerHTML=`<div><strong>🟡 草稿模式</strong><span id="saveStatus">${dirty?'尚未儲存':'已儲存'}</span></div><div class="draft-bar-actions"><button type="button" class="secondary" onclick="saveNow()">💾 儲存草稿</button><button type="button" class="secondary" onclick="backHome()">← 返回交接清冊</button></div>`;
 const communityName=communities.find(c=>c.id===draftCommunityId)?.name || answers.community_name || '未指定';
 const header=document.createElement('div');header.className='page-header';header.innerHTML=`<div class="eyebrow">${escapeHtml(communityName)}　｜　第 ${currentPage+1} 頁／共 ${total} 頁</div><h1>${escapeHtml(page.title)}</h1>${page.description?`<p>${escapeHtml(page.description)}</p>`:''}`;form.appendChild(header);
 for(const group of groupedQuestions(page.id)){const panel=document.createElement('section');panel.className='panel';const title=document.createElement('div');title.className='section-title';title.textContent=group.title;panel.appendChild(title);for(const q of group.questions)panel.appendChild(renderField(q));form.appendChild(panel)}
 const nav=document.createElement('div');nav.className='form-nav';nav.innerHTML=`<button type="button" class="secondary" id="prevBtn" ${currentPage===0?'disabled':''}>← 上一頁</button>${currentPage<total-1?'<button type="button" id="nextBtn">儲存並下一頁 →</button>':'<button type="submit" id="submitBtn">確認並正式送出 ✓</button>'}`;form.appendChild(nav);
 form.querySelectorAll('input,textarea,select').forEach(input=>{input.value=answers[input.name]??'';input.addEventListener('input',()=>markDirty(input.name,input.value));input.addEventListener('change',()=>markDirty(input.name,input.value));});
 $('prevBtn').addEventListener('click',async()=>{savePageAnswers();await saveNow(true);currentPage--;renderPage();window.scrollTo({top:0,behavior:'smooth'})});
 const next=$('nextBtn');if(next)next.addEventListener('click',async()=>{if(!validateCurrentPage())return;savePageAnswers();await saveNow(true);currentPage++;renderPage();window.scrollTo({top:0,behavior:'smooth'})});
 form.onsubmit=onSubmit;
}
function renderProgress(){$('progressArea').innerHTML=formConfig.pages.map((p,i)=>`<div class="progress-step ${i===currentPage?'current':i<currentPage?'done':''}"><span>${i<currentPage?'✓':i+1}</span><small>${escapeHtml(p.title)}</small></div>`).join('<div class="progress-line"></div>')}
function renderField(q){const wrap=document.createElement('div');wrap.className='field';const label=document.createElement('label');label.setAttribute('for',q.id);label.innerHTML=escapeHtml(q.label)+(q.required?'<span class="req">*</span>':'');wrap.appendChild(label);let input;if(q.type==='textarea')input=document.createElement('textarea');else{input=document.createElement('input');input.type=['number','date'].includes(q.type)?q.type:'text'}input.id=q.id;input.name=q.id;input.required=!!q.required;wrap.appendChild(input);return wrap}
function markDirty(k,v){answers[k]=v;dirty=true;$('saveStatus').textContent='儲存中…';clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveNow(true),900)}
function savePageAnswers(){const form=$('checklistForm');for(const[k,v]of new FormData(form).entries())answers[k]=v;dirty=true}
async function saveNow(silent=false){if(!draftId||saving)return;savePageAnswers();saving=true;try{const r=await api(`/api/staff/drafts/${draftId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:answers,current_page:currentPage,community_id:draftCommunityId})});dirty=false;if($('saveStatus'))$('saveStatus').textContent=`✓ 已儲存 ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`;if(!silent)showMessage('草稿已儲存，下次登入可以繼續填寫。','success')}catch(e){if(!silent)showMessage(e.message,'error');if($('saveStatus'))$('saveStatus').textContent='⚠ 儲存失敗'}finally{saving=false}}
function validateCurrentPage(){savePageAnswers();const missing=getPageQuestions(formConfig.pages[currentPage].id).filter(q=>q.required&&!String(answers[q.id]??'').trim());if(missing.length){showMessage(`請先完成必填欄位：${missing.map(q=>q.label).join('、')}`,'error');const first=$(missing[0].id);if(first)first.focus();return false}return true}
async function onSubmit(e){e.preventDefault();if(!validateCurrentPage())return;await saveNow(true);const btn=$('submitBtn');btn.disabled=true;btn.textContent='送出中…';try{const r=await api(`/api/staff/drafts/${draftId}/submit`,{method:'POST'});showMessage(`🎉 交接清冊已正式送出！單號：${r.id}`,'success');draftId=null;draftCommunityId=null;answers={};currentPage=0;setTimeout(()=>showHomeAfterSubmit(),900)}catch(err){showMessage(err.message,'error');btn.disabled=false;btn.textContent='確認並正式送出 ✓'}}
function showHomeAfterSubmit(){api('/api/staff/session').then(s=>showHome(s.user)).catch(showLogin)}
async function backHome(){await saveNow(true);await loadChecklistModule('交接清冊');}
$('staffLoginForm').addEventListener('submit',async e=>{e.preventDefault();const m=$('loginMsg');try{const r=await api('/api/staff/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:$('employeeId').value,password:$('employeePassword').value,tenantCode:$('staffTenantCode')?.value||'',entry:'staff'})});if(r.user.role==='company_admin'){location.href='company.html';return}await applyStaffBranding();showHome(r.user)}catch(err){if(err.message?.includes('多家公司')&&$('staffTenantCode')){$('staffTenantCode').closest('.field').style.display='block';$('staffTenantCode').focus();}m.innerHTML=`<div class="msg error">${escapeHtml(err.message)}</div>`}});
$('staffLogout').addEventListener('click',async()=>{if(dirty&&draftId)await saveNow(true);await api('/api/staff/logout',{method:'POST'});showLogin();$('employeePassword').value='';});
function showMessage(text,type){$('msgArea').innerHTML=`<div class="msg ${type}">${escapeHtml(text)}</div>`;setTimeout(()=>{if($('msgArea'))$('msgArea').innerHTML=''},5000)}
function formatDate(s){return new Date(s).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
window.newDraft=newDraft;window.continueDraft=continueDraft;window.deleteDraft=deleteDraft;window.saveNow=saveNow;window.backHome=backHome;
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&draftId&&dirty)saveNow(true)});
window.addEventListener('beforeunload',()=>{if(!draftId||!dirty)return;savePageAnswers();fetch(`/api/staff/drafts/${draftId}`,{method:'PUT',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:answers,current_page:currentPage,community_id:draftCommunityId})}).catch(()=>{})});
boot().catch(e=>showMessage(e.message,'error'));
