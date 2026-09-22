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
      if(s.user.role==='company_admin'){ location.href='company.html'; return; }
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
  $('loginView').style.display='block';$('homeView').style.display='none';$('editorView').style.display='none';$('staffTop').style.display='none';
  $('loginInternal').style.display='flex';
  setTopbarCompany('（公司名稱）');
  document.body.classList.remove('is-authenticated');
}
function showCompanyHint(user){ location.href='company.html'; }
function showHome(user){
  $('loginView').style.display='none';$('homeView').style.display='block';$('editorView').style.display='none';$('staffTop').style.display='flex';$('loginInternal').style.display='none';
  $('staffName').textContent=user.name||'使用者';
  setTopbarCompany(user.tenant_name||'（公司名稱）');
  document.body.classList.add('is-authenticated');
  const profile=$('staffProfile');
  if(profile){
    profile.onclick=()=>showStaffProfile(user);
    profile.title='查看人職資料';
  }
  window.refreshWorkspaceMenu?.('staff');loadHome(user);
}
function showStaffProfile(user){
  const old=document.getElementById('staffProfileModal');
  if(old)old.remove();
  const modal=document.createElement('div');
  modal.id='staffProfileModal';
  modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal staff-profile-modal" role="dialog" aria-modal="true">
    <button type="button" class="modal-close" aria-label="關閉">×</button>
    <div class="eyebrow">人職資料</div>
    <h2>${escapeHtml(user?.name||'使用者')}</h2>
    <div class="profile-list">
      <div><span>員編</span><strong>${escapeHtml(user?.employee_id||user?.employeeId||'—')}</strong></div>
      <div><span>職務</span><strong>${escapeHtml(user?.position||user?.job_title||user?.title||'—')}</strong></div>
      <div><span>公司</span><strong>${escapeHtml(user?.tenant_name||'—')}</strong></div>
    </div>
  </div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open')};
  modal.querySelector('.modal-close').addEventListener('click',close);
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
}

let staffClockTimer=null;
async function loadHome(user){
  const el=$('staffHome');
  if(!el)return;
  const displayName=String(user?.name||'').trim()||'使用者';
  const position=String(user?.position||user?.job_title||user?.title||'職務').trim()||'職務';
  el.innerHTML=`<div class="dashboard-layout"><div class="dashboard-left"><div class="panel home-head"><div class="eyebrow">歡迎回來</div><h1>${escapeHtml(displayName)}（${escapeHtml(position)}）</h1></div><div class="panel dashboard-clock"><div class="eyebrow">今天</div><div id="staffDate" class="dashboard-date"></div><div id="staffClock" class="dashboard-time"></div><div class="dashboard-note">本日尚未安排事務</div></div></div><div class="panel dashboard-todo"><div class="section-title"><span>📌</span> 代辦事項 <button type="button" class="todo-add" aria-label="新增代辦事項">＋</button></div><div class="todo-empty">目前尚無代辦事項。</div></div></div><div id="pinnedWorkPanel" class="panel pinned-panel"><div class="section-title">⭐ 釘選工作</div><div id="pinnedWorkList" class="pinned-work-list"><div class="empty">載入中…</div></div></div>`;
  clearInterval(staffClockTimer);
  const tick=()=>{const d=new Date();const date=$('staffDate'),clock=$('staffClock');if(date)date.textContent=d.toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric',weekday:'long'});if(clock)clock.textContent=d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',second:'2-digit'});};
  tick();staffClockTimer=setInterval(tick,1000);
  await loadPinnedWork();
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

async function startDraftForCommunity(cid){
  const community=communities.find(c=>c.id===Number(cid));
  if(!community){showMessage('找不到可用的社區。','error');return;}
  const initial={};
  if(formConfig.questions.some(q=>q.id==='community_name')) initial.community_name=community.name||'';
  const r=await api('/api/staff/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:initial,current_page:0,community_id:Number(cid)})});
  draftId=r.id;draftCommunityId=Number(cid);answers=initial;currentPage=0;showEditor();
}

async function openManagerChecklist(label='經理交接清冊'){
  communities=await api('/api/staff/communities');
  const drafts=await api('/api/staff/drafts');
  if(communities.length===1){
    const cid=communities[0].id;
    const existing=drafts.find(d=>Number(d.community_id)===Number(cid));
    if(existing){await continueDraft(existing.id);}else{await startDraftForCommunity(cid);}
    return;
  }
  if(communities.length>1){
    const options=communities.map(c=>`<button type="button" class="community-choice" data-community-id="${c.id}"><span>🏠</span><strong>${escapeHtml(c.name)}</strong><span>→</span></button>`).join('');
    const modal=document.createElement('div');modal.className='modal-backdrop';modal.innerHTML=`<div class="modal community-picker-modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><div class="eyebrow">${escapeHtml(label)}</div><h2>請選擇這次要交接的社區</h2><p class="modal-note">您同時服務多個社區，因此才需要選擇；如果只有一個社區，之後會直接進入交接畫面。</p><div class="community-choice-list">${options}</div></div>`;
    document.body.appendChild(modal);document.body.classList.add('modal-open');
    const close=()=>{modal.remove();document.body.classList.remove('modal-open')};
    modal.querySelector('.modal-close').addEventListener('click',close);
    modal.addEventListener('click',e=>{if(e.target===modal)close()});
    modal.querySelectorAll('.community-choice').forEach(btn=>btn.addEventListener('click',async()=>{const cid=Number(btn.dataset.communityId);close();const existing=drafts.find(d=>Number(d.community_id)===cid);if(existing)await continueDraft(existing.id);else await startDraftForCommunity(cid);}));
    return;
  }
  await loadChecklistModule(label);
}

async function loadChecklistModule(label='交接清冊'){
  communities=await api('/api/staff/communities');
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

async function handleWorkspaceMenu(e){
  const {action,label}=e.detail||{};
  if(action==='home'){const s=await api('/api/staff/session');if(s.loggedIn)showHome(s.user);return;}
  if(action==='manager-checklist'){await openManagerChecklist(label||'經理交接清冊');return;}
  if(action==='checklist'||action==='secretary-checklist'){await loadChecklistModule(label||'交接清冊');return;}
  showWorkspacePlaceholder(label||'工作功能');
}
document.addEventListener('workspace-menu',e=>{handleWorkspaceMenu(e).catch(err=>showMessage(err.message,'error'));});
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
$('staffLoginForm').addEventListener('submit',async e=>{e.preventDefault();const m=$('loginMsg');try{const r=await api('/api/staff/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:$('employeeId').value,password:$('employeePassword').value,tenantCode:$('staffTenantCode')?.value||''})});if(r.user.role==='company_admin'){location.href='company.html';return}await applyStaffBranding();showHome(r.user)}catch(err){if(err.message?.includes('多家公司')&&$('staffTenantCode')){$('staffTenantCode').closest('.field').style.display='block';$('staffTenantCode').focus();}m.innerHTML=`<div class="msg error">${escapeHtml(err.message)}</div>`}});
$('staffLogout').addEventListener('click',async()=>{if(dirty&&draftId)await saveNow(true);await api('/api/staff/logout',{method:'POST'});showLogin();$('employeePassword').value='';});
function showMessage(text,type){$('msgArea').innerHTML=`<div class="msg ${type}">${escapeHtml(text)}</div>`;setTimeout(()=>{if($('msgArea'))$('msgArea').innerHTML=''},5000)}
function formatDate(s){return new Date(s).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
window.newDraft=newDraft;window.continueDraft=continueDraft;window.deleteDraft=deleteDraft;window.saveNow=saveNow;window.backHome=backHome;
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&draftId&&dirty)saveNow(true)});
window.addEventListener('beforeunload',()=>{if(!draftId||!dirty)return;savePageAnswers();fetch(`/api/staff/drafts/${draftId}`,{method:'PUT',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:answers,current_page:currentPage,community_id:draftCommunityId})}).catch(()=>{})});
boot().catch(e=>showMessage(e.message,'error'));
