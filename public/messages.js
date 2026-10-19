(function(){
// 內部訊息中心（現場工作台與公司內勤共用）
// 支援文字、圖片（自動壓縮、貼上／拖曳上傳、點圖放大）與貼圖。
const $=id=>document.getElementById(id);
let visible=false,modal=null,messages=[],recipients=[],conversations=[],activePartnerId=null,activePartner=null,chatMessages=[],chatSignature='',refreshTimer=null,chatTimer=null,typingTimer=null,typingHeartbeat=null,searchDebounceTimer=null,stickers=null,pending=[];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MAX_IMAGES_PER_SEND=9, MAX_EDGE=1600;
function fmtTime(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});}
function fmt(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);const now=new Date();if(d.toDateString()===now.toDateString())return fmtTime(v);const y=new Date(now);y.setDate(now.getDate()-1);if(d.toDateString()===y.toDateString())return '昨天';return d.getFullYear()===now.getFullYear()?`${d.getMonth()+1}/${d.getDate()}`:`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;}
function dayLabel(v){const d=new Date(v),now=new Date();if(d.toDateString()===now.toDateString())return '今天';const y=new Date(now);y.setDate(now.getDate()-1);if(d.toDateString()===y.toDateString())return '昨天';const w='日一二三四五六'[d.getDay()];return `${d.getFullYear()===now.getFullYear()?'':d.getFullYear()+'/'}${d.getMonth()+1}/${d.getDate()}（${w}）`;}
function workLabel(r){if(r?.scope_label)return r.scope_label;if(r?.role==='company_admin')return '公司管理員';if(r?.work_type==='hybrid')return '內勤＋駐點';if(r?.work_type==='internal')return '公司內勤';return '社區駐點';}
const AVATAR_TONES=['#2f7d5b','#3b6fa8','#a0573a','#7a5aa6','#2d8a8a','#b07a1d','#a8466a','#4f6d3a'];
function avatar(p,cls=''){const n=String(p?.name||'?');let h=0;for(const ch of String(p?.id??n))h=(h*31+ch.charCodeAt(0))>>>0;return `<span class="conversation-avatar ${cls}" style="--avatar-tone:${AVATAR_TONES[h%AVATAR_TONES.length]}" aria-hidden="true">${esc(n.slice(0,1))}</span>`;}
function previewText(m){if(!m)return '';if(m.message_type==='image')return '📷 圖片';if(m.message_type==='sticker')return `${m.attachment?.emoji||'💬'} 貼圖`;return String(m.body||'').replace(/\n/g,' ');}
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
function setBadge(n){const b=$('messageBadge'),w=$('messageCenterWrap');if(!b||!w)return;n=Number(n||0);b.textContent=n>99?'99+':String(n);b.hidden=n<=0;w.style.display='flex';}
async function refreshBadge(){try{const d=await api('/api/messages/unread-count');setBadge(d.count);}catch(e){if(/登入|權限|帳號/.test(e.message||'')){const w=$('messageCenterWrap');if(w)w.style.display='none';}}}
async function loadLists(q=''){
  const [list,people]=await Promise.all([api('/api/messages?limit=300'),api('/api/messages/recipients'+(q?`?q=${encodeURIComponent(q)}`:''))]);
  messages=Array.isArray(list)?list:[];recipients=Array.isArray(people)?people:[];
  const map=new Map();
  messages.forEach(m=>{const p=m.direction==='in'?m.sender:m.recipient;if(!p?.id)return;const k=Number(p.id);if(!map.has(k))map.set(k,{partner:p,last:m,unread:m.unread?1:0});else if(m.unread)map.get(k).unread++;});
  conversations=[...map.values()].sort((a,b)=>new Date(b.last.created_at)-new Date(a.last.created_at));
  await refreshBadge();
}
async function loadStickers(){if(stickers)return stickers;try{const d=await api('/api/messages/stickers');stickers=Array.isArray(d.stickers)?d.stickers:[];}catch{stickers=[];}return stickers;}

// ---------- 外框 ----------
function ensureModal(){
  if(modal)return modal;
  modal=document.createElement('div');modal.id='messageCenterModal';modal.className='modal-backdrop chat-backdrop';
  modal.innerHTML=`<div class="chat-modal" role="dialog" aria-modal="true" aria-label="內部訊息">
    <div class="chat-layout">
      <aside class="chat-list-pane">
        <div class="chat-list-head"><div><div class="chat-eyebrow">內部溝通</div><h2>訊息</h2></div>
          <div class="chat-list-actions"><button type="button" class="chat-icon-btn" id="chatNewBtn" title="找同事聊天" aria-label="找同事聊天">✎</button><button type="button" class="chat-icon-btn chat-close-mobile" id="chatCloseMobile" aria-label="關閉">×</button></div></div>
        <div class="chat-search"><span aria-hidden="true">🔍</span><input id="chatSearch" placeholder="搜尋聊天或同事…" autocomplete="off"></div>
        <div id="conversationList" class="conversation-list"></div>
      </aside>
      <section class="chat-pane" id="chatPane"></section>
      <button type="button" class="chat-close" id="chatClose" aria-label="關閉訊息">×</button>
    </div></div>`;
  document.body.appendChild(modal);document.body.classList.add('modal-open');
  $('chatClose').addEventListener('click',close);$('chatCloseMobile').addEventListener('click',close);
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  $('chatSearch').addEventListener('input',()=>{renderConversationList();const q=$('chatSearch').value.trim();clearTimeout(searchDebounceTimer);if(q)searchDebounceTimer=setTimeout(()=>showRecipientPicker(true),350);});
  $('chatNewBtn').addEventListener('click',()=>showRecipientPicker(false));
  document.addEventListener('keydown',onKey);
  showEmpty();renderConversationList();return modal;
}
function onKey(e){if(e.key!=='Escape'||!modal)return;if($('chatLightbox')){closeLightbox();return;}if($('stickerPanel')&&!$('stickerPanel').hidden){toggleStickers(false);return;}close();}
function close(){stopChatPolling();stopTyping();clearTimeout(searchDebounceTimer);searchDebounceTimer=null;closeLightbox();document.removeEventListener('keydown',onKey);if(modal){modal.remove();modal=null}document.body.classList.remove('modal-open');activePartnerId=null;activePartner=null;chatMessages=[];chatSignature='';pending=[];}

// ---------- 左側清單 ----------
function renderConversationList(){
  const el=$('conversationList');if(!el)return;
  const q=String($('chatSearch')?.value||'').trim().toLowerCase();
  const rows=conversations.filter(c=>{const p=c.partner;return !q||`${p.name||''} ${p.employee_id||''} ${workLabel(p)}`.toLowerCase().includes(q)});
  if(!rows.length){el.innerHTML=`<div class="chat-list-empty"><div class="chat-list-empty-icon">💬</div>${q?'沒有符合的聊天':'目前還沒有聊天'}<button type="button" class="chat-text-btn" id="chatListStart">找同事聊天</button></div>`;$('chatListStart')?.addEventListener('click',()=>showRecipientPicker(!!q));return;}
  el.innerHTML=rows.map(c=>{const p=c.partner;const mine=c.last.direction==='out';return `<button type="button" class="conversation-item ${Number(activePartnerId)===Number(p.id)?'active':''} ${c.unread?'has-unread':''}" data-partner="${p.id}">${avatar(p)}<span class="conversation-main"><span class="conversation-top"><strong>${esc(p.name||'已離職／帳號已封存')}</strong><small>${fmt(c.last.created_at)}</small></span><span class="conversation-sub">${esc(workLabel(p))}</span><span class="conversation-preview">${mine?'你：':''}${esc(previewText(c.last))}</span></span>${c.unread?`<span class="conversation-unread">${c.unread>99?'99+':c.unread}</span>`:''}</button>`}).join('');
  el.querySelectorAll('[data-partner]').forEach(b=>b.addEventListener('click',()=>openChat(Number(b.dataset.partner))));
}

// ---------- 找同事 ----------
function renderRecipientResults(q=''){
  const grid=$('chatPane')?.querySelector('.recipient-grid');if(!grid)return;
  const needle=String(q||'').trim().toLowerCase();
  const rows=recipients.filter(r=>Number(r.id)!==Number(window.__messageCurrentUserId)&&(!needle||`${r.name||''} ${r.employee_id||''} ${workLabel(r)} ${(r.communities||[]).join(' ')}`.toLowerCase().includes(needle)));
  grid.innerHTML=rows.map(p=>`<button type="button" class="recipient-card" data-recipient="${p.id}">${avatar(p)}<span class="recipient-copy"><strong>${esc(p.name)}</strong><small>${esc(p.employee_id)} · ${esc(workLabel(p))}</small>${p.communities?.length?`<em>🏠 ${esc(p.communities.join('、'))}</em>`:''}</span><span class="recipient-go" aria-hidden="true">›</span></button>`).join('')||'<div class="chat-list-empty">找不到符合條件的人員。</div>';
  grid.querySelectorAll('[data-recipient]').forEach(b=>b.addEventListener('click',()=>openChat(Number(b.dataset.recipient))));
}
function showRecipientPicker(fromSearch=false){
  const el=$('chatPane');if(!el)return;stopChatPolling();
  modal?.querySelector('.chat-layout')?.classList.add('chat-show-pane');
  const q=String($('chatSearch')?.value||'').trim();
  el.innerHTML=`<div class="chat-recipient-picker"><div class="picker-head"><button type="button" class="chat-icon-btn chat-back" id="pickerBack" aria-label="返回">‹</button><div><h3>找同事聊天</h3><p>可搜尋姓名、員編、職務或社區名稱</p></div></div><div class="recipient-search-inline"><span aria-hidden="true">🔍</span><input id="recipientSearch" value="${esc(q)}" placeholder="例如：綠景莊園、王小明、A001" autocomplete="off"></div><div class="recipient-grid"></div></div>`;
  $('pickerBack').addEventListener('click',()=>{activePartnerId?openChat(activePartnerId):showEmpty()});
  const input=$('recipientSearch');
  input.addEventListener('input',e=>{const value=e.target.value;clearTimeout(searchDebounceTimer);searchDebounceTimer=setTimeout(async()=>{try{await loadLists(value.trim());renderRecipientResults(value);}catch(err){const grid=$('chatPane')?.querySelector('.recipient-grid');if(grid)grid.innerHTML=`<div class="chat-list-empty">搜尋失敗：${esc(err.message)}</div>`;}},300);});
  renderRecipientResults(q);if(fromSearch||window.innerWidth>720){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
}
function showEmpty(){const p=$('chatPane');if(p)p.innerHTML='<div class="chat-empty"><div class="chat-empty-icon">💬</div><strong>選擇一位同事開始聊天</strong><p>公司內勤與案場人員可以直接在這裡聯絡，<br>也能傳照片和貼圖，不需要另外加私人 LINE。</p><button type="button" class="chat-primary-btn" id="chatEmptyStart">找同事聊天</button></div>';$('chatEmptyStart')?.addEventListener('click',()=>showRecipientPicker(false));modal?.querySelector('.chat-layout')?.classList.remove('chat-show-pane');}

// ---------- 聊天室 ----------
async function openChat(id){
  activePartnerId=id;pending=[];modal?.querySelector('.chat-layout')?.classList.add('chat-show-pane');stopTyping();
  try{
    const d=await api(`/api/messages/conversation/${id}?limit=300`);activePartner=d.partner;chatMessages=d.messages||[];
    if(chatMessages.some(m=>m.direction==='in'&&m.unread))await api(`/api/messages/conversation/${id}/read`,{method:'PUT'});
    chatMessages.forEach(m=>{if(m.direction==='in')m.unread=false});
    renderChat();startChatPolling();await loadLists();renderConversationList();
  }catch(e){const p=$('chatPane');if(p)p.innerHTML=`<div class="chat-empty"><strong>無法開啟聊天室</strong><p>${esc(e.message)}</p></div>`;}
}
function renderChat(){
  const p=$('chatPane');if(!p||!activePartner)return;
  p.innerHTML=`<div class="chat-header"><button type="button" class="chat-icon-btn chat-back" id="chatHeaderBack" aria-label="返回聊天清單">‹</button><div class="chat-person">${avatar(activePartner,'large')}<div><strong>${esc(activePartner.name||'已離職／帳號已封存')}</strong><small>${esc(activePartner.employee_id||'')} · ${esc(workLabel(activePartner))}</small></div></div></div>
    <div id="chatMessages" class="chat-messages" aria-live="polite"></div>
    <div id="typingIndicator" class="typing-indicator" aria-live="polite"></div>
    <div id="stickerPanel" class="sticker-panel" hidden></div>
    <form id="chatForm" class="chat-inputbar">
      <button type="button" class="chat-tool-btn" id="chatAttach" title="傳送圖片" aria-label="傳送圖片">🖼️</button>
      <button type="button" class="chat-tool-btn" id="chatStickerBtn" title="貼圖" aria-label="貼圖" aria-expanded="false">😊</button>
      <input type="file" id="chatFile" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>
      <textarea id="chatInput" rows="1" maxlength="5000" placeholder="${window.innerWidth>720?'輸入訊息…（可直接貼上或拖曳圖片）':'輸入訊息…'}"></textarea>
      <button type="submit" id="chatSend" class="chat-send" aria-label="送出">➤</button>
    </form>
    <div class="chat-drop-hint" id="chatDropHint">放開即可傳送圖片</div>`;
  chatSignature='';renderChatMessages(true);
  $('chatForm').addEventListener('submit',sendChatMessage);
  const input=$('chatInput');
  input.addEventListener('input',()=>{autoGrow();handleTyping();});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chatForm').requestSubmit()}});
  input.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();sendImages(files);}});
  $('chatHeaderBack').addEventListener('click',()=>{stopChatPolling();stopTyping();activePartnerId=null;activePartner=null;showEmpty();renderConversationList();});
  $('chatAttach').addEventListener('click',()=>$('chatFile').click());
  $('chatFile').addEventListener('change',e=>{const files=[...e.target.files];e.target.value='';if(files.length)sendImages(files);});
  $('chatStickerBtn').addEventListener('click',()=>toggleStickers());
  const pane=p;let depth=0;
  pane.addEventListener('dragenter',e=>{if([...e.dataTransfer?.types||[]].includes('Files')){depth++;pane.classList.add('is-dragging');}});
  pane.addEventListener('dragover',e=>{if([...e.dataTransfer?.types||[]].includes('Files'))e.preventDefault();});
  pane.addEventListener('dragleave',()=>{depth=Math.max(0,depth-1);if(!depth)pane.classList.remove('is-dragging');});
  pane.addEventListener('drop',e=>{e.preventDefault();depth=0;pane.classList.remove('is-dragging');const files=[...(e.dataTransfer?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length)sendImages(files);});
  if(window.innerWidth>720)input.focus();
}
function autoGrow(){const t=$('chatInput');if(!t)return;t.style.height='auto';t.style.height=Math.min(t.scrollHeight,140)+'px';}
function messageHtml(m,first,last){
  const out=m.direction==='out';
  const meta=`<span class="chat-meta">${fmtTime(m.created_at)}${out?` <span class="read-state ${m.read_at?'read':''}">${m.read_at?'已讀':'已送出'}</span>`:''}</span>`;
  let inner;
  if(m.message_type==='sticker'&&m.attachment){const a=m.attachment;inner=`<div class="chat-sticker tone-${esc(a.tone||'gray')}" role="img" aria-label="貼圖：${esc(a.text)}"><span class="chat-sticker-emoji">${esc(a.emoji)}</span><span class="chat-sticker-text">${esc(a.text)}</span></div>`;}
  else if(m.message_type==='image'&&m.attachment){const a=m.attachment;const ratio=a.width&&a.height?` style="aspect-ratio:${Number(a.width)}/${Number(a.height)}"`:'';const cap=String(m.body||'').replace(/^\[圖片\]\s*/,'');inner=`<button type="button" class="chat-image" data-image="${esc(a.url)}" data-name="${esc(a.name||'')}"${ratio}><img src="${esc(a.url)}" alt="圖片訊息" loading="lazy"></button>${cap?`<div class="chat-bubble ${out?'out':'in'} chat-caption">${esc(cap).replace(/\n/g,'<br>')}</div>`:''}`;}
  else inner=`<div class="chat-bubble ${out?'out':'in'}${first?' is-first':''}">${linkify(esc(m.body)).replace(/\n/g,'<br>')}</div>`;
  return `<div class="chat-bubble-row ${out?'out':'in'} type-${m.message_type||'text'}${first?' group-first':''}${last?' group-last':''}"><div class="chat-bubble-stack">${inner}${last?meta:''}</div></div>`;
}
function linkify(s){return s.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');}
function renderChatMessages(forceBottom=false){
  const el=$('chatMessages');if(!el)return;
  const all=chatMessages.concat(pending);
  const sig=all.map(m=>`${m.id}:${m.read_at?1:0}:${m.status||''}`).join('|');
  if(sig===chatSignature&&!forceBottom)return;chatSignature=sig;
  const near=el.scrollHeight-el.scrollTop-el.clientHeight<120;
  let html='',lastDay='';
  all.forEach((m,i)=>{
    const day=new Date(m.created_at).toDateString();
    if(day!==lastDay){html+=`<div class="chat-day"><span>${esc(dayLabel(m.created_at))}</span></div>`;lastDay=day;}
    const prev=all[i-1],next=all[i+1];
    const same=(a,b)=>a&&b&&a.direction===b.direction&&new Date(b.created_at).toDateString()===new Date(a.created_at).toDateString()&&Math.abs(new Date(b.created_at)-new Date(a.created_at))<5*60000;
    if(m.status){html+=`<div class="chat-bubble-row out type-image group-first group-last"><div class="chat-bubble-stack"><div class="chat-image is-pending${m.status==='error'?' is-error':''}"${m.ratio?` style="aspect-ratio:${m.ratio}"`:''}>${m.preview?`<img src="${m.preview}" alt="">`:''}<span class="chat-pending-label">${m.status==='error'?'傳送失敗':'傳送中…'}</span></div>${m.status==='error'?`<span class="chat-meta chat-error">${esc(m.error||'')}</span>`:''}</div></div>`;return;}
    html+=messageHtml(m,!same(prev,m),!same(m,next));
  });
  el.innerHTML=html||`<div class="chat-empty-inline">${avatar(activePartner||{},'large')}<strong>和 ${esc(activePartner?.name||'')} 開始聊天</strong><span>打個招呼，或傳一張貼圖吧 👋</span></div>`;
  el.querySelectorAll('[data-image]').forEach(b=>b.addEventListener('click',()=>openLightbox(b.dataset.image,b.dataset.name)));
  el.querySelectorAll('.chat-image img').forEach(img=>{if(!img.complete)img.addEventListener('load',()=>{if(forceBottom||near)el.scrollTop=el.scrollHeight;},{once:true});});
  if(forceBottom||near)el.scrollTop=el.scrollHeight;
}

// ---------- 傳送 ----------
async function sendChatMessage(e){
  e.preventDefault();const input=$('chatInput'),body=String(input?.value||'').trim();if(!body||!activePartnerId)return;
  const btn=$('chatSend');btn.disabled=true;stopTyping();
  try{await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_id:activePartnerId,subject:'',body})});input.value='';autoGrow();await refreshChat(true);}
  catch(err){alert(err.message)}finally{btn.disabled=false;input?.focus();}
}
async function sendSticker(id){
  if(!activePartnerId)return;toggleStickers(false);
  try{await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_id:activePartnerId,message_type:'sticker',sticker_id:id})});await refreshChat(true);}
  catch(err){alert(err.message)}
}
function loadImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>resolve({img,url});img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('無法讀取這張圖片'));};img.src=url;});}
// 手機照片常有好幾 MB：長邊縮到 1600px、轉成 JPEG，傳得快也省空間。GIF 保留原檔以免失去動畫。
async function prepareImage(file){
  const {img,url}=await loadImage(file);let w=img.naturalWidth,h=img.naturalHeight;
  if(file.type==='image/gif'||(Math.max(w,h)<=MAX_EDGE&&file.size<=1.5*1024*1024))return {blob:file,name:file.name,width:w,height:h,preview:url};
  const scale=Math.min(1,MAX_EDGE/Math.max(w,h));w=Math.round(w*scale);h=Math.round(h*scale);
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85));
  return {blob:blob||file,name:String(file.name||'photo').replace(/\.[^.]+$/,'')+'.jpg',width:w,height:h,preview:url};
}
async function sendImages(files){
  if(!activePartnerId)return;
  const list=files.filter(f=>/^image\/(jpeg|png|gif|webp)$/.test(f.type));
  if(list.length<files.length)alert('只能傳送 JPG、PNG、GIF 或 WEBP 圖片；其他檔案已略過。');
  if(list.length>MAX_IMAGES_PER_SEND){alert(`一次最多傳送 ${MAX_IMAGES_PER_SEND} 張圖片。`);list.length=MAX_IMAGES_PER_SEND;}
  for(const file of list){
    const tmp={id:`pending-${Date.now()}-${Math.random()}`,direction:'out',message_type:'image',created_at:new Date().toISOString(),status:'sending'};
    pending.push(tmp);
    try{
      const prep=await prepareImage(file);tmp.preview=prep.preview;tmp.ratio=`${prep.width}/${prep.height}`;renderChatMessages(true);
      if(prep.blob.size>10*1024*1024)throw new Error('圖片太大，單張最多 10MB');
      const fd=new FormData();fd.append('recipient_id',String(activePartnerId));fd.append('width',String(prep.width));fd.append('height',String(prep.height));fd.append('image',prep.blob,prep.name);
      await api('/api/messages/image',{method:'POST',body:fd});
      pending=pending.filter(x=>x!==tmp);if(prep.preview)setTimeout(()=>URL.revokeObjectURL(prep.preview),5000);
      await refreshChat(true);
    }catch(err){tmp.status='error';tmp.error=err.message||'傳送失敗';chatSignature='';renderChatMessages(true);setTimeout(()=>{pending=pending.filter(x=>x!==tmp);chatSignature='';renderChatMessages();},6000);}
  }
}
async function toggleStickers(force){
  const panel=$('stickerPanel'),btn=$('chatStickerBtn');if(!panel)return;
  const show=force===undefined?panel.hidden:force;
  if(show){const list=await loadStickers();panel.innerHTML=list.length?`<div class="sticker-panel-head">貼圖</div><div class="sticker-grid">${list.map(s=>`<button type="button" class="chat-sticker tone-${esc(s.tone)}" data-sticker="${esc(s.id)}" title="${esc(s.text)}"><span class="chat-sticker-emoji">${esc(s.emoji)}</span><span class="chat-sticker-text">${esc(s.text)}</span></button>`).join('')}</div>`:'<div class="chat-list-empty">目前沒有可用的貼圖。</div>';panel.querySelectorAll('[data-sticker]').forEach(b=>b.addEventListener('click',()=>sendSticker(b.dataset.sticker)));}
  panel.hidden=!show;btn?.setAttribute('aria-expanded',show?'true':'false');btn?.classList.toggle('active',show);
}

// ---------- 圖片放大 ----------
function openLightbox(url,name){
  closeLightbox();const box=document.createElement('div');box.id='chatLightbox';box.className='chat-lightbox';box.setAttribute('role','dialog');box.setAttribute('aria-label','圖片');
  const dl=url.startsWith('/api/')?`${url}${url.includes('?')?'&':'?'}download=1`:url;
  box.innerHTML=`<div class="chat-lightbox-bar"><span>${esc(name||'圖片')}</span><a class="chat-lightbox-btn" href="${esc(dl)}" download="${esc(name||'image')}">下載</a><button type="button" class="chat-lightbox-btn" id="chatLightboxClose" aria-label="關閉">×</button></div><img src="${esc(url)}" alt="${esc(name||'圖片')}">`;
  box.addEventListener('click',e=>{if(e.target===box||e.target.tagName==='IMG')closeLightbox();});
  document.body.appendChild(box);$('chatLightboxClose').addEventListener('click',closeLightbox);
}
function closeLightbox(){$('chatLightbox')?.remove();}

// ---------- 輸入中／更新 ----------
function handleTyping(){const input=$('chatInput');if(!input||!activePartnerId)return;if(input.value.trim()){sendTyping(true);clearTimeout(typingTimer);typingTimer=setTimeout(stopTyping,2500);if(!typingHeartbeat)typingHeartbeat=setInterval(()=>sendTyping(true),1500);}else stopTyping();}
async function sendTyping(v){if(!activePartnerId)return;try{await api('/api/messages/typing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partner_id:activePartnerId,typing:v})});}catch(e){}}
function stopTyping(){clearTimeout(typingTimer);typingTimer=null;if(typingHeartbeat){clearInterval(typingHeartbeat);typingHeartbeat=null}if(activePartnerId)sendTyping(false);}
async function refreshChat(forceBottom=false){
  if(!activePartnerId)return;
  const d=await api(`/api/messages/conversation/${activePartnerId}?limit=300`);chatMessages=d.messages||[];
  if(chatMessages.some(m=>m.direction==='in'&&m.unread))await api(`/api/messages/conversation/${activePartnerId}/read`,{method:'PUT'});
  chatMessages.forEach(m=>{if(m.direction==='in')m.unread=false});
  if(forceBottom)chatSignature='';renderChatMessages(forceBottom);
  await loadLists();renderConversationList();
}
async function pollChat(){
  if(!activePartnerId)return;
  try{await refreshChat(false);const t=await api(`/api/messages/typing?partner_id=${activePartnerId}`);const ind=$('typingIndicator');if(ind)ind.innerHTML=t.typing?`<span>${esc(activePartner?.name||'對方')} 正在輸入</span><i></i><i></i><i></i>`:'';}catch(e){}
}
function startChatPolling(){stopChatPolling();chatTimer=setInterval(pollChat,2000)}
function stopChatPolling(){if(chatTimer){clearInterval(chatTimer);chatTimer=null}}
async function open(){if(!visible)return;ensureModal();try{await loadLists();renderConversationList()}catch(e){const el=$('conversationList');if(el)el.innerHTML=`<div class="chat-list-empty">訊息中心暫時無法載入<br>${esc(e.message)}</div>`;}}
function setVisible(v){visible=!!v;const w=$('messageCenterWrap');if(w)w.style.display=visible?'flex':'none';if(!visible){close();if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null}}else{refreshBadge();if(!refreshTimer)refreshTimer=setInterval(refreshBadge,5000);}}
function init(){const btn=$('messageCenterButton');if(btn)btn.addEventListener('click',open);window.setMessageCenterVisible=setVisible;window.refreshMessageCenter=refreshBadge;const w=$('messageCenterWrap');if(w)w.style.display='none';if(window.__workspaceAuthenticated===true)setVisible(true);window.addEventListener('workspace-authenticated',e=>setVisible(!!e.detail));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
