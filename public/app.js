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
// 登入頁頂端顯示系統名稱（取自登入卡片上的系統名稱，例如「鶴絲物業管理系統」），登入後才換成所屬公司名稱
const LOGIN_SYSTEM_NAME=(()=>{const t=(document.querySelector('.login-company')?.textContent||document.getElementById('platformBrand')?.textContent||'').trim();return t&&!t.includes('公司名稱')?t:'鶴絲物業管理系統';})();
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
  setTopbarCompany(LOGIN_SYSTEM_NAME);
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
        <span><strong>本月薪資單</strong><small>${d.payslip?.available?`${escapeHtml(d.payslip.month.slice(0,4)+' 年 '+Number(d.payslip.month.slice(5,7))+' 月')}｜實發 ${Number(d.payslip.net||0).toLocaleString('en-US')} 元${d.payslip.confirmed?'':'（待確認）'}`:'點選查看當月薪資單'}</small></span><b>›</b>
      </button>`;
    modal.querySelector('#salaryDetailsBtn').addEventListener('click',()=>openSalaryDetailsCard(salary,d.advances));
    modal.querySelector('#monthlyPayslipBtn').addEventListener('click',()=>openPayslipCard(d).catch(e=>alert(e.message)));
  }catch(e){modal.querySelector('#staffProfileBody').innerHTML=`<div class="profile-error">目前無法載入職員資料。<br><small>${escapeHtml(e.message||'')}</small></div>`;}
}
function payslipModal(inner){
  const old=document.getElementById('staffPayslipModal');if(old)old.remove();
  const modal=document.createElement('div');modal.id='staffPayslipModal';modal.className='modal-backdrop payslip-backdrop';
  modal.innerHTML=`<div class="modal payslip-modal" role="dialog" aria-modal="true" style="max-width:640px;width:min(640px,96vw);max-height:92vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button>${inner}</div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};modal.querySelector('.modal-close').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close()});
  return {modal,close};
}
async function openPayslipCard(profile,id){
  const list=(await api('/api/staff/payslips').catch(()=>({payslips:[]}))).payslips||[];
  if(!list.length){payslipModal(`<div class="eyebrow">本月薪資單</div><h2>${escapeHtml(new Date().getFullYear()+' 年 '+(new Date().getMonth()+1)+' 月')}</h2><div class="payslip-empty"><strong>薪資單尚未發布</strong><p>公司會計發布薪資單後，您會收到訊息通知，並可在這裡查看。</p></div>`);return;}
  const pick=id||list[0].id;
  const {payslip}=await api(`/api/staff/payslips/${pick}`);
  const others=list.filter(x=>String(x.id)!==String(pick));
  const {modal,close}=payslipModal(`${window.PayslipView?window.PayslipView.html(payslip):''}<div class="modal-actions">${payslip.confirmed_at?'':'<button type="button" id="payslipConfirm">✓ 已確認，金額無誤</button>'}</div>${others.length?`<div class="payslip-history" style="margin-top:14px"><div style="font-weight:800;font-size:.9rem;margin-bottom:6px">歷史薪資單</div>${others.map(x=>`<button type="button" data-slip="${x.id}" style="display:flex;justify-content:space-between;align-items:center;width:100%;margin:0 0 6px;padding:10px 14px;border:1px solid #e1e9e5;border-radius:10px;background:#fff;color:#1d2a25;min-height:0;font-weight:700;text-align:left"><span>${escapeHtml(x.month.slice(0,4)+' 年 '+Number(x.month.slice(5,7))+' 月')}<small style="display:block;font-weight:400;color:#6a7a73">實發 ${Number(x.net||0).toLocaleString('en-US')} 元${x.confirmed_at?'｜已確認':'｜待確認'}</small></span><span>›</span></button>`).join('')}</div>`:''}`);
  modal.querySelector('#payslipConfirm')?.addEventListener('click',async()=>{try{await api(`/api/staff/payslips/${pick}/confirm`,{method:'POST'});close();openPayslipCard(profile,pick);}catch(e){alert(e.message)}});
  modal.querySelectorAll('[data-slip]').forEach(b=>b.addEventListener('click',()=>{close();openPayslipCard(profile,b.dataset.slip);}));
}
function openSalaryDetailsCard(salary,advances){
  salary=salary||{};advances=advances||[];
  const money=v=>Number(v||0).toLocaleString('en-US');
  const yes=(on,txt)=>on?txt:'<span style="color:#999">未加保</span>';
  const allow=(salary.allowances||[]).map(a=>`${escapeHtml(a.name)} ${money(a.amount)}`).join('、');
  const ee=salary.employee_insurance||{};const eeSum=Number(ee.labor||0)+Number(ee.health||0)+Number(ee.pension_self||0);
  payslipModal(`<div class="eyebrow">薪資相關</div><h2>人事與投保資料</h2><div class="staff-profile-basic salary-details-body">
    <div><span>到職日</span><strong>${salary.hire_date?escapeHtml(salary.hire_date):'尚未設定'}</strong></div>
    <div><span>試用期</span><strong>${salary.trial_end_date?`至 ${escapeHtml(salary.trial_end_date)}`:'尚未設定'}</strong></div>
    <div><span>正式薪資（底薪）</span><strong>${salary.formal_salary?`${money(salary.formal_salary)} 元`:'尚未設定'}</strong></div>
    ${allow?`<div><span>固定加給</span><strong>${allow}</strong></div>`:''}
    <div><span>勞保投保薪資</span><strong>${yes(salary.labor_insured,salary.insurance_level?`${money(salary.insurance_level)} 元${salary.employment_insured?'（含就保）':''}`:'尚未設定')}</strong></div>
    <div><span>健保投保金額</span><strong>${yes(salary.health_insured,salary.health_grade?`${money(salary.health_grade)} 元`:'尚未設定')}</strong></div>
    <div><span>健保眷屬</span><strong>${Number(salary.health_dependents||0)} 人</strong></div>
    <div><span>勞退</span><strong>${salary.pension_enabled?`公司提繳 6%${salary.pension_self_rate?`，自提 ${salary.pension_self_rate}%`:''}`:'未提繳'}</strong></div>
    ${salary.configured?`<div><span>每月保費自付</span><strong>${money(eeSum)} 元</strong></div>`:''}
    ${advances.map(a=>`<div><span>借資餘額</span><strong>${money(a.balance)} 元（每月扣回 ${money(a.monthly_deduct)}）</strong></div>`).join('')}
  </div><p class="hint" style="margin-top:10px">資料由公司人事維護，如有錯誤請洽人事或會計。</p>`);
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

// ===== 交接清冊：經理版／秘書版分開（題目、草稿、送出紀錄各自獨立） =====
const HANDOVER_TYPES={manager:{label:'經理交接清冊',icon:'👔',hint:'現場經理（總幹事）離任或交接時填寫：社區基本資料、財務、待辦、鑰匙門禁、設施與聯絡窗口。'},secretary:{label:'秘書交接清冊',icon:'🗂',hint:'社區秘書／行政人員交接時填寫：管理費帳務、住戶資料、印鑑文件、櫃台收發與系統帳號。'}};
let handoverType='manager', handoverLabel='經理交接清冊', handoverDrafts=[];
function injectHandoverStyle(){
  if(document.getElementById('handoverStyle'))return;
  const s=document.createElement('style');s.id='handoverStyle';
  s.textContent=`
.ho-hub{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:14px}
.ho-hub-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;border:1px solid #dbe7e1;border-radius:16px;padding:18px;background:#fff;color:inherit;cursor:pointer;min-height:0;box-shadow:none}
.ho-hub-card:hover{border-color:#8fbfa8;background:#f6fbf8}
.ho-hub-card .ho-hub-icon{font-size:1.8rem}
.ho-hub-card strong{font-size:1.1rem}
.ho-hub-card small{color:#5f7068;line-height:1.6;font-weight:400}
.ho-badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#fff3e0;color:#a35a00;font-weight:700;font-size:.78rem}
.ho-switch{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}
.ho-switch button{padding:6px 12px;min-height:0;font-size:.85rem}
.ho-recent{list-style:none;margin:0;padding:0}
.ho-recent li{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed #e1e9e5}
.ho-recent li:last-child{border-bottom:0}
.field .field-help{display:block;margin:-2px 0 6px;color:#6a7a73;font-size:.85rem;line-height:1.5}
.field .prefill-tag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;background:#e6f2fb;color:#1e5f8c;font-size:.72rem;font-weight:700;vertical-align:middle}
.field.is-conditional{border-left:3px solid #cfe3d8;padding-left:12px;margin-left:2px}
.choice-pills{display:flex;flex-wrap:wrap;gap:8px}
.choice-pills label{display:inline-flex;align-items:center;gap:6px;margin:0;padding:8px 14px;border:1px solid #cbded7;border-radius:999px;background:#fff;cursor:pointer;font-weight:600;user-select:none}
.choice-pills input{width:auto;margin:0;accent-color:#1f6b43}
.choice-pills label:has(input:checked){background:#e3f2e9;border-color:#5fa883;color:#174f34}
.money-wrap{display:flex;align-items:center;gap:8px}.money-wrap input{flex:1}.money-wrap span{color:#5f7068;font-weight:700}
`;
  document.head.appendChild(s);
}
async function loadHandoverConfig(type){
  const t=HANDOVER_TYPES[type]?type:'manager';
  const d=await api(`/api/staff/handover/${t}/config`);
  if(!d.formConfig||!Array.isArray(d.formConfig.pages)||!d.formConfig.pages.length) throw new Error(`${HANDOVER_TYPES[t].label}沒有可用的頁面，請到總後台「中央表單設計中心」檢查設定。`);
  handoverType=t;formConfig=d.formConfig;communities=Array.isArray(d.communities)?d.communities:[];
  return d;
}
// 舊名稱保留，避免其他地方呼叫失敗
async function loadCentralManagerChecklist(){return loadHandoverConfig('manager');}
async function startDraftForCommunity(cid){
  if(!formConfig||formConfig.formType!==handoverType) await loadHandoverConfig(handoverType);
  const community=communities.find(c=>c.id===Number(cid));
  if(!community){showMessage('找不到可用的駐點社區。','error');return;}
  const r=await api('/api/staff/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{},current_page:0,community_id:Number(cid),form_type:handoverType,prefill:true})});
  draftId=r.id;draftCommunityId=Number(cid);answers=r.data||{};currentPage=0;showEditor();
  const n=(answers.__prefilled||[]).length;
  if(n) showMessage(`已自動帶入 ${n} 題（社區、日期、填寫人與上次交接的答案），請確認內容是否仍正確。`,'success');
}
function handoverSwitchButtons(current){
  return `<div class="ho-switch">${Object.entries(HANDOVER_TYPES).filter(([k])=>k!==current).map(([k,m])=>`<button type="button" class="secondary" data-ho-switch="${k}">${m.icon} 改看${escapeHtml(m.label)}</button>`).join('')}</div>`;
}
function bindHandoverSwitch(el){el.querySelectorAll('[data-ho-switch]').forEach(b=>b.addEventListener('click',()=>{showWorkspaceLoading(HANDOVER_TYPES[b.dataset.hoSwitch].label);loadHandoverHome(b.dataset.hoSwitch).catch(err=>showWorkspaceError(HANDOVER_TYPES[b.dataset.hoSwitch].label,err));}));}
// 交接清冊總覽（目錄「交接清冊」本身）：選擇經理版或秘書版
async function loadHandoverHub(label='交接清冊'){
  injectHandoverStyle();
  const el=$('staffHome');if(!el)return;
  const d=await api('/api/staff/handover/forms').catch(()=>({forms:Object.entries(HANDOVER_TYPES).map(([id,m])=>({id,...m,drafts:0}))}));
  el.innerHTML=`<div class="panel"><div class="eyebrow">工作項目</div><h1>📋 ${escapeHtml(label)}</h1><p class="hint">經理與秘書的交接清冊是兩份不同的表單，草稿與送出紀錄也分開保存。請選擇要填寫哪一份。</p><div class="ho-hub">${(d.forms||[]).map(f=>`<button type="button" class="ho-hub-card" data-ho-open="${f.id}"><span class="ho-hub-icon">${HANDOVER_TYPES[f.id]?.icon||'📋'}</span><strong>${escapeHtml(HANDOVER_TYPES[f.id]?.label||f.label)}</strong><small>${escapeHtml(HANDOVER_TYPES[f.id]?.hint||'')}</small>${f.drafts?`<span class="ho-badge">${f.drafts} 份未完成</span>`:''}</button>`).join('')}</div></div>`;
  el.querySelectorAll('[data-ho-open]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.hoOpen;showWorkspaceLoading(HANDOVER_TYPES[t].label);loadHandoverHome(t).catch(err=>showWorkspaceError(HANDOVER_TYPES[t].label,err));}));
}
async function loadHandoverHome(type='manager',label=''){
  injectHandoverStyle();
  await loadHandoverConfig(type);
  handoverLabel=label||HANDOVER_TYPES[handoverType].label;
  const meta=HANDOVER_TYPES[handoverType];
  const [drafts,subs]=await Promise.all([api(`/api/staff/drafts?form_type=${handoverType}`),api(`/api/staff/handover/${handoverType}/submissions`).catch(()=>({submissions:[]}))]);
  handoverDrafts=drafts;
  const el=$('staffHome');if(!el)return;
  $('loginView').style.display='none';$('editorView').style.display='none';$('homeView').style.display='block';
  const total=formConfig.pages.length;
  if(!communities.length){
    el.innerHTML=`<div class="panel workspace-error"><div class="eyebrow">${escapeHtml(handoverLabel)}</div><h1>尚未開通駐點案場</h1><p>目前這個人員帳號沒有被指定任何啟用中的社區，因此暫時無法開啟${escapeHtml(meta.label)}。</p><p class="hint">請由公司後台為此人員設定駐點社區；設定完成後重新登入即可。</p>${handoverSwitchButtons(handoverType)}</div>`;
    bindHandoverSwitch(el);return;
  }
  const cards=drafts.length?drafts.map(d=>{const pct=Math.min(99,Math.round(((d.current_page+1)/total)*100));const community=communities.find(c=>c.id===d.community_id)?.name||d.data.community_name||'尚未指定社區';return `<div class="draft-card"><div><div class="draft-title">🏠 ${escapeHtml(community)}</div><div class="hint">最後儲存：${formatDate(d.updated_at)}　｜　目前第 ${Math.min(d.current_page+1,total)} / ${total} 頁</div><div class="progress-mini"><span style="width:${pct}%"></span></div></div><div class="draft-actions"><button onclick="continueDraft(${d.id})">繼續填寫</button><button class="danger" onclick="deleteDraft(${d.id})">刪除草稿</button></div></div>`}).join(''):'<div class="empty">目前沒有未完成的'+escapeHtml(meta.label)+'。</div>';
  const communityOptions=communities.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}${drafts.some(d=>d.community_id===c.id)?'（有草稿）':''}</option>`).join('');
  const recent=(subs.submissions||[]).length?`<div class="panel"><div class="section-title">✅ 我最近送出的${escapeHtml(meta.label)}</div><ul class="ho-recent">${subs.submissions.map(s=>`<li><span>🏠 ${escapeHtml(s.community_name||'—')}</span><small class="muted">單號 ${s.id}　${formatDate(s.created_at)}</small></li>`).join('')}</ul></div>`:'';
  el.innerHTML=`<div class="panel"><div class="eyebrow">交接清冊</div><h1>${meta.icon} ${escapeHtml(handoverLabel)}</h1><p class="hint">${escapeHtml(meta.hint)}<br>共 ${total} 頁。社區名稱、日期、填寫人與上次交接的答案會自動帶入，只要確認或修改即可；草稿會自動儲存。</p><div class="new-draft-box"><label>選擇要交接的社區</label><select id="newCommunity">${communityOptions}</select><button class="big-action" onclick="newDraft()">＋ 開始新的${escapeHtml(meta.label)}</button></div>${handoverSwitchButtons(handoverType)}</div><div class="panel"><div class="section-title">🟡 未完成的${escapeHtml(meta.label)}</div>${cards}</div>${recent}`;
  bindHandoverSwitch(el);
}
async function openManagerChecklist(label='經理交接清冊'){return loadHandoverHome('manager',label);}
async function openSecretaryChecklist(label='秘書交接清冊'){return loadHandoverHome('secretary',label);}
async function loadChecklistModule(label='交接清冊'){return loadHandoverHub(label);}
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
async function loadStaffSchedulePage(mode='community',label='案場全班班表',monthOverride='',communityOverride=''){
  const el=$('staffHome'); if(!el)return;
  showWorkspaceLoading(mode==='self'?'自選休假':'案場全班班表');
  const month=monthOverride||new Date().toISOString().slice(0,7);
  const query=new URLSearchParams({month}); if(communityOverride)query.set('community_id',communityOverride);
  const data=await api('/api/staff/schedule/community-view?'+query.toString());
  const communities=data.communities||[], selected=String(data.selected_community_id||'');
  const profile=data.profile||{}; const entries=data.entries||[], staff=data.staff||[];
  const selfAllowed=['security','mobile'].includes(profile.schedule_role);
  const selfDates=new Set(data.self_off_dates||[]);
  const offByDate=new Map((data.off_conflicts||[]).map(x=>[x.work_date,Number(x.count||0)]));
  const days=Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
  const rosterByDay=new Map(); for(const e of entries){const key=e.work_date;if(!rosterByDay.has(key))rosterByDay.set(key,new Map());rosterByDay.get(key).set(String(e.staff_id),e);}
  const communityOptions=communities.map(c=>`<option value="${c.id}" ${String(c.id)===selected?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  const controls=`<div class="staff-schedule-controls"><label>月份<input type="month" id="staffScheduleMonth" value="${escapeHtml(month)}"></label><label>案場<select id="staffScheduleCommunity">${communityOptions||'<option value="">目前沒有已派駐案場</option>'}</select></label><button type="button" id="staffScheduleRefresh">查詢班表</button></div>`;
  if(!communities.length){el.innerHTML=`<div class="panel staff-schedule-page"><h1>📅 ${mode==='self'?'自選休假':'案場全班班表'}</h1><p>目前帳號沒有可查看的已派駐案場，請聯絡公司管理人員確認人員派駐設定。</p></div>`;return;}
  const rosterHead=`<tr><th class="staff-schedule-date-col">日期</th>${staff.map(u=>`<th>${escapeHtml(u.name)}${u.position?`<small>${escapeHtml(u.position)}</small>`:''}</th>`).join('')}</tr>`;
  const rows=days.map(date=>{
    const dateEntries=rosterByDay.get(date)||new Map();
    const d=new Date(date+'T12:00:00'); const weekday=['日','一','二','三','四','五','六'][d.getDay()];
    const count=offByDate.get(date)||0; const alreadySelf=selfDates.has(date);
    const cells=staff.map(u=>{const e=dateEntries.get(String(u.id));if(!e)return '<td class="staff-schedule-empty">—</td>';const code=String(e.shift_code||'work');const off=code==='off';const label=off?'休':({'day':'日班','night':'夜班','work':'上班'}[code]||code);return `<td class="${off?'staff-schedule-off':'staff-schedule-work'}" title="${escapeHtml(e.note||'')}">${escapeHtml(label)}${e.source==='self-select'?'<small>自選</small>':''}</td>`;}).join('');
    let actionCell='';
    if(mode==='self'&&selfAllowed){const disabled=alreadySelf||count>0||Number(profile.self_select_days||0)<=0;const reason=alreadySelf?'已選擇':count>0?'案場有人休假，避免撞假':Number(profile.self_select_days||0)<=0?'未開放自選':'可選';actionCell=`<td class="staff-schedule-self-cell"><button type="button" data-self-date="${date}" ${disabled?'disabled':''} title="${escapeHtml(reason)}">${alreadySelf?'已選休':count>0?'撞假不可選':'選這天休'}</button></td>`;}
    return `<tr><th class="staff-schedule-date-col">${date}<small>星期${weekday}</small></th>${cells}${actionCell}</tr>`;
  }).join('');
  const selfHeader=mode==='self'&&selfAllowed?'<th>自選休假</th>':'';
  const used=selfDates.size, limit=Number(profile.self_select_days||0);
  const selfNote=mode==='self'?`<div class="staff-schedule-note">${selfAllowed?`本月已自選 <strong>${used}</strong>／${limit} 天。只有當天案場沒有其他人排休時才能選擇；若撞假，按鈕會停用，後端也會再次檢查。`:'目前職務不開放自選休假；仍可查看案場全班班表。'}</div>`:'';
  el.innerHTML=`<style>.staff-schedule-page{padding:22px}.staff-schedule-controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:16px 0}.staff-schedule-controls label{display:grid;gap:6px;color:#587066;font-size:13px}.staff-schedule-controls input,.staff-schedule-controls select{min-width:170px;padding:10px;border:1px solid #cbded7;border-radius:9px;background:white}.staff-schedule-page button{padding:9px 12px;border:1px solid #b7d3c7;border-radius:8px;background:#edf7f1;color:#155a42;font-weight:700}.staff-schedule-page button:disabled{background:#f2f3f2;border-color:#e0e4e1;color:#9b4d4d;cursor:not-allowed}.staff-schedule-note{margin:10px 0 16px;padding:12px;background:#fff7e5;border:1px solid #efd99c;border-radius:9px;line-height:1.7}.staff-schedule-table-wrap{overflow:auto;max-height:65vh;border:1px solid #e0e9e4;border-radius:10px}.staff-schedule-table{border-collapse:separate;border-spacing:0;min-width:100%;white-space:nowrap}.staff-schedule-table th,.staff-schedule-table td{padding:9px 10px;border-right:1px solid #e7ece9;border-bottom:1px solid #e7ece9;text-align:center}.staff-schedule-table thead th{position:sticky;top:0;background:#f1f7f3;z-index:3}.staff-schedule-table th small,.staff-schedule-table td small{display:block;font-size:11px;color:#718179;margin-top:3px}.staff-schedule-table .staff-schedule-date-col{position:sticky;left:0;z-index:2;background:#f8fbf9;text-align:left}.staff-schedule-table thead .staff-schedule-date-col{z-index:4}.staff-schedule-work{background:#eef8f2;color:#185b42}.staff-schedule-off{background:#fff0ef;color:#a33131;font-weight:800}.staff-schedule-empty{color:#b2bbb6}.staff-schedule-self-cell{min-width:100px}</style><div class="panel staff-schedule-page"><div class="eyebrow">📅 現場勤務</div><h1>${mode==='self'?'自選休假':'案場全班班表'}</h1><p class="hint">可查看您有權限的案場全體人員班表；休假安排會即時顯示，避免同一天多人撞假。</p>${controls}${selfNote}<div class="staff-schedule-table-wrap"><table class="staff-schedule-table"><thead>${rosterHead.replace('</tr>',`${selfHeader}</tr>`)}</thead><tbody>${rows||'<tr><td colspan="2">本月尚無班表資料。</td></tr>'}</tbody></table></div><p class="hint">「—」代表目前尚未建立該人員當日班別；班表由公司排定後會顯示在這裡。</p></div>`;
  const refresh=()=>loadStaffSchedulePage(mode,'班表',$('staffScheduleMonth')?.value||month,$('staffScheduleCommunity')?.value||selected).catch(err=>showWorkspaceError('班表',err));
  $('staffScheduleRefresh')?.addEventListener('click',refresh);
  $('staffScheduleMonth')?.addEventListener('change',refresh);
  $('staffScheduleCommunity')?.addEventListener('change',refresh);
  el.querySelectorAll('[data-self-date]').forEach(btn=>btn.addEventListener('click',async()=>{const date=btn.dataset.selfDate;btn.disabled=true;try{await api('/api/staff/schedule/self-select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month,work_date:date,community_id:Number(selected)})});await loadStaffSchedulePage('self','自選休假',month,selected);}catch(err){alert(err.message||'自選休假失敗');btn.disabled=false;}}));
}

// 目錄設定使用的動作代碼與程式內部代碼對照（目錄的 handover-manager 等原本沒有對應，點了只會看到「建置中」）。
const WORKSPACE_ACTION_ALIASES={'handover':'checklist','handover-manager':'manager-checklist','handover-secretary':'secretary-checklist'};
// 企業自訂目錄若沒有設定功能代碼（placeholder），依名稱對應到已上線的功能
const WORKSPACE_LABEL_ACTIONS=[['住戶聯繫表','residents-contact'],['區分所有權人','residents-owners'],['所有權人','residents-owners'],['承租人','residents-tenants'],['出勤打卡','staff-attendance-checkin'],['巡邏紀錄','staff-patrol-records'],['巡邏巡檢','staff-patrol'],['出勤與巡邏','staff-attendance'],['經理交接','manager-checklist'],['秘書交接','secretary-checklist'],['交接清冊','checklist'],['工作日誌','work-journal'],['禮品','gifts'],['案場全班班表','staff-schedule-community'],['自選休假','staff-schedule-self-select'],['已封存','todo-archived'],['代辦事項','todo'],['案場 SOP','sop'],['案場SOP','sop']];
function labelWorkspaceAction(label){const t=String(label||'');const hit=WORKSPACE_LABEL_ACTIONS.find(([k])=>t.includes(k));return hit?hit[1]:'';}
function resolveWorkspaceAction(detail){
  // 舊設定常把連字號存成底線（work_journal），一律轉回平台代碼
  const raw=String(detail?.action||'').trim().replace(/_/g,'-');
  if(raw&&raw!=='placeholder')return WORKSPACE_ACTION_ALIASES[raw]||raw;
  return labelWorkspaceAction(detail?.label)||raw;
}
async function handleWorkspaceMenu(e){
  const {label}=e.detail||{};const action=resolveWorkspaceAction(e.detail);
  if(['staff-schedule','staff-schedule-community','staff-schedule-self-select'].includes(action)){
    try{await loadStaffSchedulePage(action==='staff-schedule-self-select'?'self':'community',label||'班表');}catch(err){showWorkspaceError(label||'班表',err);}
    return;
  }
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
  if(action==='secretary-checklist'){
    showWorkspaceLoading(label||'秘書交接清冊');
    try{await openSecretaryChecklist(label||'秘書交接清冊');}catch(err){showWorkspaceError(label||'秘書交接清冊',err);}
    return;
  }
  if(action==='checklist'){
    showWorkspaceLoading(label||'交接清冊');
    try{await loadChecklistModule(label||'交接清冊');}catch(err){showWorkspaceError(label||'交接清冊',err);}
    return;
  }
  if(['residents-contact','residents-owners','residents-tenants'].includes(action)){
    showWorkspaceLoading(label||'住戶名冊');
    try{if(!window.ResidentRosterModule) throw new Error('住戶名冊模組尚未載入，請重新整理頁面'); await window.ResidentRosterModule.render(action,label||'住戶名冊');}catch(err){showWorkspaceError(label||'住戶名冊',err);}
    return;
  }
  if(['staff-attendance','staff-attendance-checkin','staff-patrol','staff-patrol-records'].includes(action)){
    showWorkspaceLoading(label||'出勤與巡邏');
    try{if(!window.AttendanceStaffModule) throw new Error('出勤與巡邏模組尚未載入，請重新整理頁面'); await window.AttendanceStaffModule.render({action,container:$('staffHome')});}catch(err){showWorkspaceError(label||'出勤與巡邏',err);}
    return;
  }
  if(['sop','sop-admin','sop-duty','sop-company','sop-community'].includes(action)){
    showWorkspaceLoading(label||'案場 SOP');
    try{if(!window.SOPStaffModule)throw new Error('案場 SOP 模組尚未載入，請重新整理頁面');await window.SOPStaffModule.render(action,label,$('staffHome'));}catch(err){showWorkspaceError(label||'案場 SOP',err);}
    return;
  }
  if(action==='work-journal'){
    showWorkspaceLoading(label||'工作日誌');
    try{if(!window.WorkJournalModule)throw new Error('工作日誌模組尚未載入，請重新整理頁面');await window.WorkJournalModule.render($('staffHome'),label||'工作日誌');}catch(err){showWorkspaceError(label||'工作日誌',err);}
    return;
  }
  if(action==='gifts'){
    showWorkspaceLoading(label||'禮品推放');
    try{if(!window.GiftsModule)throw new Error('禮品模組尚未載入，請重新整理頁面');await window.GiftsModule.render($('staffHome'),label||'禮品推放');}catch(err){showWorkspaceError(label||'禮品推放',err);}
    return;
  }
  // 目錄的功能代碼對不上任何已上線功能時，再用項目名稱找一次（例如企業自訂的「工作日誌」）
  const byLabel=labelWorkspaceAction(label);
  if(byLabel&&byLabel!==action&&!e.__byLabel){return handleWorkspaceMenu({detail:{...e.detail,action:byLabel},__byLabel:true});}
  showWorkspacePlaceholder(label||'工作功能');
}
document.addEventListener('workspace-menu',e=>{handleWorkspaceMenu(e).catch(err=>showWorkspaceError(e.detail?.label||'工作功能',err));});
document.addEventListener('dashboard-pins-changed',()=>{if($('homeView')&&getComputedStyle($('homeView')).display!=='none')loadPinnedWork();});

async function newDraft(){
  const cid=Number($('newCommunity')?.value||0);if(!cid){showMessage('請先選擇社區。','error');return}
  const existing=handoverDrafts.find(d=>Number(d.community_id)===cid);
  if(existing&&confirm('這個社區已經有一份還沒送出的草稿。\n\n按「確定」繼續填寫那份草稿；按「取消」另外開一份新的。')){await continueDraft(existing.id);return;}
  await startDraftForCommunity(cid);
}
async function continueDraft(id){
  const d=await api(`/api/staff/drafts/${id}`);
  const type=HANDOVER_TYPES[d.form_type]?d.form_type:'manager';
  if(!formConfig||formConfig.formType!==type) await loadHandoverConfig(type);
  if(!handoverLabel||!handoverLabel.includes(HANDOVER_TYPES[type].label.slice(0,2))) handoverLabel=HANDOVER_TYPES[type].label;
  draftId=d.id;draftCommunityId=d.community_id||null;answers=d.data||{};currentPage=Math.max(0,Math.min(Number(d.current_page)||0,formConfig.pages.length-1));showEditor();
}
async function deleteDraft(id){if(!confirm('確定刪除這份未完成草稿嗎？刪除後無法復原。'))return;await api(`/api/staff/drafts/${id}`,{method:'DELETE'});await loadHandoverHome(handoverType,handoverLabel);}
function showEditor(){ injectHandoverStyle();$('homeView').style.display='none';$('editorView').style.display='block';dirty=false;renderPage();window.scrollTo({top:0}); }
function getPageQuestions(pageId){return formConfig.questions.filter(q=>q.pageId===pageId)}
function groupedQuestions(pageId){const groups=[],map={};for(const q of getPageQuestions(pageId)){const key=q.group||'填寫資料';if(!map[key]){map[key]={title:key,questions:[]};groups.push(map[key])}map[key].questions.push(q)}return groups;}
// ---- 智慧題目：條件顯示 ----
function hoValues(v){return (Array.isArray(v)?v:(v===undefined||v===null||v===''?[]:[v])).map(x=>String(x));}
function hoEmpty(v){return Array.isArray(v)?!v.some(x=>String(x??'').trim()):!String(v??'').trim();}
function questionVisible(q,depth=0){
  const c=q&&q.showIf;if(!c||!c.q||depth>10)return true;
  const src=formConfig.questions.find(x=>x.id===c.q);if(!src)return true;
  if(!questionVisible(src,depth+1))return false;
  const vals=hoValues(answers[c.q]);
  if(c.op==='filled')return vals.some(x=>x.trim());
  if(c.op==='neq')return vals.length>0&&!vals.includes(String(c.value??''));
  return vals.includes(String(c.value??''));
}
function applyVisibility(){
  const form=$('checklistForm');if(!form)return;
  form.querySelectorAll('[data-qid]').forEach(w=>{const q=formConfig.questions.find(x=>x.id===w.dataset.qid);w.hidden=!questionVisible(q);});
  form.querySelectorAll('section.panel[data-group]').forEach(p=>{p.hidden=!p.querySelector('[data-qid]:not([hidden])');});
}
function readField(q){
  const form=$('checklistForm');
  if(q.type==='checkbox')return [...form.querySelectorAll(`input[type=checkbox][name="${CSS.escape(q.id)}"]:checked`)].map(x=>x.value);
  if(['radio','yesno'].includes(q.type))return form.querySelector(`input[type=radio][name="${CSS.escape(q.id)}"]:checked`)?.value||'';
  const el=form.querySelector(`[name="${CSS.escape(q.id)}"]`);return el?el.value:(answers[q.id]??'');
}
function renderPage(){
 const form=$('checklistForm'),page=formConfig.pages[currentPage],total=formConfig.pages.length;form.innerHTML='';renderProgress();
 $('draftBar').innerHTML=`<div><strong>🟡 草稿模式</strong><span id="saveStatus">${dirty?'尚未儲存':'已儲存'}</span></div><div class="draft-bar-actions"><button type="button" class="secondary" onclick="saveNow()">💾 儲存草稿</button><button type="button" class="secondary" onclick="backHome()">← 返回${escapeHtml(HANDOVER_TYPES[handoverType]?.label||'交接清冊')}</button></div>`;
 const communityName=communities.find(c=>c.id===draftCommunityId)?.name || answers.community_name || '未指定';
 const header=document.createElement('div');header.className='page-header';header.innerHTML=`<div class="eyebrow">${escapeHtml(HANDOVER_TYPES[handoverType]?.label||'')}　｜　${escapeHtml(communityName)}　｜　第 ${currentPage+1} 頁／共 ${total} 頁</div><h1>${escapeHtml(page.title)}</h1>${page.description?`<p>${escapeHtml(page.description)}</p>`:''}`;form.appendChild(header);
 for(const group of groupedQuestions(page.id)){const panel=document.createElement('section');panel.className='panel';panel.dataset.group=group.title;const title=document.createElement('div');title.className='section-title';title.textContent=group.title;panel.appendChild(title);for(const q of group.questions)panel.appendChild(renderField(q));form.appendChild(panel)}
 const nav=document.createElement('div');nav.className='form-nav';nav.innerHTML=`<button type="button" class="secondary" id="prevBtn" ${currentPage===0?'disabled':''}>← 上一頁</button>${currentPage<total-1?'<button type="button" id="nextBtn">儲存並下一頁 →</button>':'<button type="submit" id="submitBtn">確認並正式送出 ✓</button>'}`;form.appendChild(nav);
 for(const q of getPageQuestions(page.id)){
   const onChange=()=>{markDirty(q.id,readField(q));applyVisibility();};
   form.querySelectorAll(`[name="${CSS.escape(q.id)}"]`).forEach(input=>{input.addEventListener('input',onChange);input.addEventListener('change',onChange);});
 }
 applyVisibility();
 $('prevBtn').addEventListener('click',async()=>{savePageAnswers();await saveNow(true);currentPage--;renderPage();window.scrollTo({top:0,behavior:'smooth'})});
 const next=$('nextBtn');if(next)next.addEventListener('click',async()=>{if(!validateCurrentPage())return;savePageAnswers();await saveNow(true);currentPage++;renderPage();window.scrollTo({top:0,behavior:'smooth'})});
 form.onsubmit=onSubmit;
}
function renderProgress(){$('progressArea').innerHTML=formConfig.pages.map((p,i)=>`<div class="progress-step ${i===currentPage?'current':i<currentPage?'done':''}"><span>${i<currentPage?'✓':i+1}</span><small>${escapeHtml(p.title)}</small></div>`).join('<div class="progress-line"></div>')}
function renderField(q){
  const wrap=document.createElement('div');wrap.className='field'+(q.showIf&&q.showIf.q?' is-conditional':'');wrap.dataset.qid=q.id;
  const prefilled=(answers.__prefilled||[]).includes(q.id);
  const label=document.createElement('label');label.setAttribute('for',q.id);label.innerHTML=escapeHtml(q.label)+(q.required?'<span class="req">*</span>':'')+(prefilled?'<span class="prefill-tag" title="系統自動帶入，可直接修改">自動帶入</span>':'');wrap.appendChild(label);
  if(q.help){const h=document.createElement('small');h.className='field-help';h.textContent=q.help;wrap.appendChild(h);}
  const value=answers[q.id];
  if(['yesno','radio','checkbox'].includes(q.type)){
    const opts=q.type==='yesno'?['是','否']:(q.options||[]);const multi=q.type==='checkbox';const vals=hoValues(value);
    const box=document.createElement('div');box.className='choice-pills';box.setAttribute('role',multi?'group':'radiogroup');box.setAttribute('aria-label',q.label);
    opts.forEach((o,i)=>{const l=document.createElement('label');const inp=document.createElement('input');inp.type=multi?'checkbox':'radio';inp.name=q.id;inp.value=o;if(i===0)inp.id=q.id;inp.checked=vals.includes(String(o));l.appendChild(inp);l.appendChild(document.createTextNode(o));box.appendChild(l);});
    wrap.appendChild(box);return wrap;
  }
  let input;
  if(q.type==='textarea')input=document.createElement('textarea');
  else if(q.type==='select'){input=document.createElement('select');input.appendChild(new Option('請選擇…',''));for(const o of q.options||[])input.appendChild(new Option(o,o));}
  else{input=document.createElement('input');input.type=q.type==='money'?'number':(['number','date','tel'].includes(q.type)?q.type:'text');if(q.type==='money'){input.step='1';input.inputMode='numeric';}if(q.type==='tel')input.inputMode='tel';}
  input.id=q.id;input.name=q.id;if(q.placeholder)input.placeholder=q.placeholder;input.value=Array.isArray(value)?value.join('、'):(value??'');
  if(q.type==='money'){const m=document.createElement('div');m.className='money-wrap';m.appendChild(input);const u=document.createElement('span');u.textContent='元';m.appendChild(u);wrap.appendChild(m);}else wrap.appendChild(input);
  return wrap;
}
function markDirty(k,v){answers[k]=v;dirty=true;if($('saveStatus'))$('saveStatus').textContent='儲存中…';clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveNow(true),900)}
function savePageAnswers(){if(!formConfig||!$('checklistForm'))return;const page=formConfig.pages[currentPage];if(!page)return;for(const q of getPageQuestions(page.id)){if($('checklistForm').querySelector(`[name="${CSS.escape(q.id)}"]`))answers[q.id]=readField(q);}dirty=true}
async function saveNow(silent=false){if(!draftId||saving)return;savePageAnswers();saving=true;try{await api(`/api/staff/drafts/${draftId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:answers,current_page:currentPage,community_id:draftCommunityId})});dirty=false;if($('saveStatus'))$('saveStatus').textContent=`✓ 已儲存 ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`;if(!silent)showMessage('草稿已儲存，下次登入可以繼續填寫。','success')}catch(e){if(!silent)showMessage(e.message,'error');if($('saveStatus'))$('saveStatus').textContent='⚠ 儲存失敗'}finally{saving=false}}
function missingOnPage(pageId){return getPageQuestions(pageId).filter(q=>q.required&&questionVisible(q)&&hoEmpty(answers[q.id]));}
function validateCurrentPage(){savePageAnswers();const missing=missingOnPage(formConfig.pages[currentPage].id);if(missing.length){showMessage(`請先完成必填欄位：${missing.map(q=>q.label).join('、')}`,'error');const first=$(missing[0].id);if(first)first.focus();return false}return true}
async function onSubmit(e){
  e.preventDefault();if(!validateCurrentPage())return;
  // 送出前檢查全部頁面，直接跳到還沒填完的那一頁
  const firstMissing=formConfig.pages.findIndex(p=>missingOnPage(p.id).length);
  if(firstMissing>=0){await saveNow(true);currentPage=firstMissing;renderPage();showMessage(`第 ${firstMissing+1} 頁「${formConfig.pages[firstMissing].title}」還有必填欄位：${missingOnPage(formConfig.pages[firstMissing].id).map(q=>q.label).join('、')}`,'error');window.scrollTo({top:0,behavior:'smooth'});return;}
  await saveNow(true);const btn=$('submitBtn');btn.disabled=true;btn.textContent='送出中…';
  try{const r=await api(`/api/staff/drafts/${draftId}/submit`,{method:'POST'});draftId=null;draftCommunityId=null;answers={};currentPage=0;dirty=false;await loadHandoverHome(handoverType,handoverLabel);const ok=document.createElement('div');ok.className='msg success';ok.textContent=`🎉 ${HANDOVER_TYPES[handoverType].label}已正式送出！單號：${r.id}`;$('staffHome')?.prepend(ok);setTimeout(()=>ok.remove(),8000);window.scrollTo({top:0});}
  catch(err){showMessage(err.message,'error');btn.disabled=false;btn.textContent='確認並正式送出 ✓'}
}
function showHomeAfterSubmit(){api('/api/staff/session').then(s=>showHome(s.user)).catch(showLogin)}
async function backHome(){await saveNow(true);await loadHandoverHome(handoverType,handoverLabel);}
$('staffLoginForm').addEventListener('submit',async e=>{e.preventDefault();const m=$('loginMsg');try{const r=await api('/api/staff/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:$('employeeId').value,password:$('employeePassword').value,tenantCode:$('staffTenantCode')?.value||'',entry:'staff'})});if(r.user.role==='company_admin'){location.href='company.html';return}await applyStaffBranding();showHome(r.user)}catch(err){if(err.message?.includes('多家公司')&&$('staffTenantCode')){$('staffTenantCode').closest('.field').style.display='block';$('staffTenantCode').focus();}m.innerHTML=`<div class="msg error">${escapeHtml(err.message)}</div>`}});
$('staffLogout')?.addEventListener('click',async()=>{if(dirty&&draftId)await saveNow(true);await api('/api/staff/logout',{method:'POST'});showLogin();$('employeePassword').value='';});
function showMessage(text,type){$('msgArea').innerHTML=`<div class="msg ${type}">${escapeHtml(text)}</div>`;setTimeout(()=>{if($('msgArea'))$('msgArea').innerHTML=''},5000)}
function formatDate(s){return new Date(s).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
window.newDraft=newDraft;window.continueDraft=continueDraft;window.openSecretaryChecklist=openSecretaryChecklist;window.deleteDraft=deleteDraft;window.saveNow=saveNow;window.backHome=backHome;
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&draftId&&dirty)saveNow(true)});
window.addEventListener('beforeunload',()=>{if(!draftId||!dirty)return;savePageAnswers();fetch(`/api/staff/drafts/${draftId}`,{method:'PUT',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:answers,current_page:currentPage,community_id:draftCommunityId})}).catch(()=>{})});
boot().catch(e=>showMessage(e.message,'error'));
