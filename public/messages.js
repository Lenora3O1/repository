(function(){
  const $ = id => document.getElementById(id);
  let visible = false;
  let modal = null;
  let activeTab = 'inbox';
  let messages = [];
  let recipients = [];
  let pollTimer = null;

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(v){
    if(!v)return '';
    const d=new Date(v); if(Number.isNaN(d.getTime()))return String(v);
    return d.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  function workLabel(r){
    if(r?.role==='company_admin')return '公司管理員';
    if(r?.work_type==='hybrid')return '內勤＋駐點';
    if(r?.work_type==='internal')return '公司內勤';
    return '社區駐點';
  }
  async function api(url,options={}){
    const r=await fetch(url,{credentials:'same-origin',...options});
    let d={}; try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d.error||'操作失敗');
    return d;
  }
  function setBadge(count){
    const wrap=$('messageCenterWrap'), badge=$('messageBadge');
    if(!wrap||!badge)return;
    const n=Number(count||0);
    badge.textContent=n>99?'99+':String(n);
    badge.hidden=n<=0;
    if(visible)wrap.style.display='flex';
  }
  async function refresh(){
    try{
      const d=await api('/api/messages/unread-count');
      setBadge(d.count);
      if(!visible){
        const w=$('messageCenterWrap'); if(w)w.style.display='flex';
      }
      return Number(d.count||0);
    }catch(e){
      if(e?.message?.includes('登入')||e?.message?.includes('權限')||e?.message?.includes('帳號')){
        const w=$('messageCenterWrap'); if(w)w.style.display='none';
      }
      return 0;
    }
  }
  async function loadData(){
    const [list,people]=await Promise.all([api('/api/messages?limit=100'),api('/api/messages/recipients')]);
    messages=list; recipients=people; render();
    await refresh();
  }
  function ensureModal(){
    if(modal)return modal;
    modal=document.createElement('div');
    modal.id='messageCenterModal';
    modal.className='modal-backdrop';
    modal.innerHTML=`<div class="modal modal-wide message-center-modal" role="dialog" aria-modal="true" aria-labelledby="messageCenterTitle">
      <button type="button" class="modal-close" id="messageCenterClose" aria-label="關閉訊息中心">×</button>
      <div class="eyebrow">內部溝通</div>
      <h2 id="messageCenterTitle">💬 訊息中心</h2>
      <p class="modal-note">這裡是公司內勤與社區駐點人員的內部聯絡管道，不需要另外加入私人 LINE。</p>
      <div class="message-tabs">
        <button type="button" data-message-tab="inbox" class="active">收件匣</button>
        <button type="button" data-message-tab="compose">✚ 撰寫訊息</button>
      </div>
      <div id="messageInboxPane"></div>
      <div id="messageComposePane" style="display:none"></div>
    </div>`;
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    modal.querySelector('#messageCenterClose').addEventListener('click',close);
    modal.addEventListener('click',e=>{if(e.target===modal)close()});
    modal.querySelectorAll('[data-message-tab]').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.messageTab)));
    return modal;
  }
  function close(){
    if(modal){modal.remove();modal=null;document.body.classList.remove('modal-open');}
  }
  function switchTab(tab){
    activeTab=tab==='compose'?'compose':'inbox';
    if(!modal)return;
    modal.querySelectorAll('[data-message-tab]').forEach(b=>b.classList.toggle('active',b.dataset.messageTab===activeTab));
    $('messageInboxPane').style.display=activeTab==='inbox'?'block':'none';
    $('messageComposePane').style.display=activeTab==='compose'?'block':'none';
    render();
  }
  function render(){
    if(!modal)return;
    if(activeTab==='inbox')renderInbox(); else renderCompose();
  }
  function renderInbox(){
    const el=$('messageInboxPane'); if(!el)return;
    if(!messages.length){
      el.innerHTML='<div class="message-empty"><div>💬</div><strong>目前沒有訊息</strong><p>公司內勤與案場人員之間的聯絡，都可以從這裡進行。</p></div>';
      return;
    }
    const unread=messages.filter(m=>m.unread).length;
    el.innerHTML=`<div class="message-toolbar"><span>共 ${messages.length} 則訊息${unread?`，<strong>${unread} 則未讀</strong>`:''}</span><button type="button" class="secondary" id="messageReadAll" ${unread?'':'disabled'}>全部標記已讀</button></div>
      <div class="message-list">${messages.map(m=>{
        const incoming=m.direction==='in';
        const person=incoming?m.sender:m.recipient;
        return `<button type="button" class="message-row ${m.unread?'is-unread':''}" data-message-id="${m.id}">
          <span class="message-avatar">${incoming?'↙':'↗'}</span>
          <span class="message-row-main"><span class="message-row-head"><strong>${incoming?'來自':'傳給'} ${esc(person.name||'已離職／帳號已封存')}</strong><small>${fmt(m.created_at)}</small></span>
          <span class="message-row-meta">${esc(person.employee_id||'')}　·　${esc(workLabel(person))}</span>
          <span class="message-row-subject">${esc(m.subject||'內部訊息')}</span>
          <span class="message-row-preview">${esc(m.body||'').replace(/\n/g,' ')}</span></span>
          ${m.unread?'<span class="message-unread-dot">未讀</span>':''}
        </button>`;
      }).join('')}</div>`;
    $('messageReadAll')?.addEventListener('click',async()=>{try{await api('/api/messages/read-all',{method:'PUT'});await loadData()}catch(e){alert(e.message)}});
    el.querySelectorAll('[data-message-id]').forEach(row=>row.addEventListener('click',()=>openMessage(Number(row.dataset.messageId))));
  }
  function renderCompose(prefill={}){
    const el=$('messageComposePane'); if(!el)return;
    const opts=recipients.map(r=>`<option value="${r.id}" ${Number(prefill.recipient_id)===Number(r.id)?'selected':''}>${esc(r.name)}（${esc(r.employee_id)}）｜${esc(r.scope_label||workLabel(r))}</option>`).join('');
    el.innerHTML=`<form id="messageComposeForm" class="message-compose-form">
      <div class="field"><label>收件人</label><select id="messageRecipient" required><option value="">請選擇公司內部人員</option>${opts}</select></div>
      <div class="field"><label>主旨</label><input id="messageSubject" maxlength="120" value="${esc(prefill.subject||'')}" placeholder="例如：明天上午請協助確認住戶資料"></div>
      <div class="field"><label>訊息內容</label><textarea id="messageBody" maxlength="5000" rows="8" required placeholder="請輸入訊息內容…">${esc(prefill.body||'')}</textarea></div>
      <div class="modal-note">📌 訊息只會在同一家公司內傳遞，總後台不會看到這個訊息中心。</div>
      <div class="modal-actions"><button type="button" class="secondary" id="messageCancelCompose">取消</button><button type="submit" id="messageSendBtn">送出訊息</button></div>
    </form>`;
    $('messageComposeForm').addEventListener('submit',sendMessage);
    $('messageCancelCompose').addEventListener('click',()=>switchTab('inbox'));
  }
  async function sendMessage(e){
    e.preventDefault();
    const btn=$('messageSendBtn'); btn.disabled=true; btn.textContent='傳送中…';
    try{
      await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_id:Number($('messageRecipient').value),subject:$('messageSubject').value,body:$('messageBody').value})});
      alert('訊息已送出。');
      activeTab='inbox';
      await loadData();
      switchTab('inbox');
    }catch(err){alert(err.message);btn.disabled=false;btn.textContent='送出訊息';}
  }
  async function openMessage(id){
    const m=messages.find(x=>Number(x.id)===Number(id)); if(!m||!modal)return;
    if(m.unread&&m.direction==='in'){
      try{await api(`/api/messages/${m.id}/read`,{method:'PUT'});m.read_at=new Date().toISOString();m.unread=false;await refresh();}catch(e){}
    }
    const incoming=m.direction==='in'; const person=incoming?m.sender:m.recipient;
    const pane=$('messageInboxPane');
    pane.innerHTML=`<div class="message-detail">
      <button type="button" class="message-back" id="messageBack">← 返回收件匣</button>
      <div class="message-detail-head"><div><div class="message-detail-direction">${incoming?'收到訊息':'已傳送訊息'}</div><h3>${esc(m.subject||'內部訊息')}</h3><p>${incoming?'來自':'收件人'}：<strong>${esc(person.name||'已離職／帳號已封存')}</strong>（${esc(person.employee_id||'')}） · ${esc(workLabel(person))}</p></div><time>${fmt(m.created_at)}</time></div>
      <div class="message-detail-body">${esc(m.body).replace(/\n/g,'<br>')}</div>
      <div class="modal-actions"><button type="button" id="messageReplyBtn">↩ 回覆</button></div>
    </div>`;
    $('messageBack').addEventListener('click',()=>{renderInbox()});
    $('messageReplyBtn').addEventListener('click',()=>{
      activeTab='compose';
      switchTab('compose');
      renderCompose({recipient_id:person.id,subject:`回覆：${m.subject||'內部訊息'}`,body:''});
    });
  }
  function setVisible(v){
    visible=!!v;
    const w=$('messageCenterWrap');
    if(w)w.style.display=visible?'flex':'none';
    if(!visible)close();
    if(visible){refresh();if(!pollTimer)pollTimer=setInterval(refresh,30000);}
    else if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  }
  async function open(){
    if(!visible)return;
    ensureModal();
    activeTab='inbox';
    switchTab('inbox');
    try{await loadData();}catch(e){
      $('messageInboxPane').innerHTML=`<div class="message-empty"><strong>訊息中心暫時無法載入</strong><p>${esc(e.message)}</p></div>`;
    }
  }
  function init(){
    const btn=$('messageCenterButton');
    if(btn)btn.addEventListener('click',open);
    window.setMessageCenterVisible=setVisible;
    window.refreshMessageCenter=refresh;
    const w=$('messageCenterWrap'); if(w)w.style.display='none';
    if(window.__workspaceAuthenticated===true)setVisible(true);
    window.addEventListener('workspace-authenticated',e=>setVisible(!!e.detail));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
