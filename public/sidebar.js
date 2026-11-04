(function(){
  const sidebar=document.getElementById('appSidebar');
  const toggle=document.getElementById('sidebarToggle');
  const backdrop=document.getElementById('sidebarBackdrop');
  const key='handover-sidebar-collapsed';
  const mobile=()=>window.innerWidth<=900;
  function setCollapsed(v){document.body.classList.toggle('sidebar-collapsed',!!v);if(!mobile())document.body.classList.remove('sidebar-hover');try{localStorage.setItem(key,v?'1':'0')}catch(e){}}
  function wrapStaticButtons(){
    if(!sidebar)return;
    sidebar.querySelectorAll('.nav-tabs button').forEach(btn=>{
      if(btn.querySelector('.nav-icon'))return;
      const raw=btn.textContent.trim();
      const m=raw.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*(.*)$/u);
      if(!m)return;
      btn.textContent='';
      const icon=document.createElement('span');icon.className='nav-icon';icon.textContent=m[1];
      const label=document.createElement('span');label.className='nav-label';label.textContent=m[2];
      btn.append(icon,label);
    });
  }
  function setupShell(){
    if(!sidebar)return;
    wrapStaticButtons();
    document.getElementById('sidebarHome')?.addEventListener('click',()=>{
      document.body.classList.remove('sidebar-open');
      document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:'home',id:'home',label:'工作台'}}));
    });
    if(mobile()) document.body.classList.remove('sidebar-collapsed'); else {document.body.classList.add('sidebar-collapsed');try{localStorage.setItem(key,'1')}catch(e){}}
    sidebar.addEventListener('mouseenter',()=>{if(!mobile())document.body.classList.add('sidebar-hover')});
    sidebar.addEventListener('mouseleave',()=>{if(!mobile())document.body.classList.remove('sidebar-hover')});
    toggle?.addEventListener('click',()=>{
      if(mobile()){
        document.body.classList.toggle('sidebar-open');
      }else{
        document.body.classList.toggle('sidebar-open');
        document.body.classList.remove('sidebar-hover');
      }
    });
    backdrop?.addEventListener('click',()=>document.body.classList.remove('sidebar-open'));
  }
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function togglePin(menuId,pinBtn){
    try{
      const pinned=pinBtn.dataset.pinned==='1';
      const r=await fetch(pinned?`/api/staff/dashboard-pins/${encodeURIComponent(menuId)}`:'/api/staff/dashboard-pins',{method:pinned?'DELETE':'POST',credentials:'same-origin',headers:pinned?{}:{'Content-Type':'application/json'},body:pinned?undefined:JSON.stringify({menu_id:menuId})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||'釘選設定失敗');
      pinBtn.dataset.pinned=pinned?'0':'1';
      pinBtn.textContent=pinned?'☆':'★';
      pinBtn.title=pinned?'釘選到我的工作台':'已釘選；點一下取消釘選';
      document.dispatchEvent(new CustomEvent('dashboard-pins-changed'));
    }catch(e){alert(e.message||'釘選設定失敗');}
  }
  function makePinButton(item,pinned){
    const p=document.createElement('button');
    p.type='button';p.className='menu-pin-btn';p.dataset.pinned=pinned?'1':'0';p.textContent=pinned?'★':'☆';
    p.title=pinned?'已釘選；點一下取消釘選':'釘選到我的工作台';p.setAttribute('aria-label',p.title);
    p.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();togglePin(item.id,p);});
    return p;
  }
  // ---------- 網址與瀏覽器歷程：上一頁／下一頁、滑鼠中鍵（或 Ctrl＋點）開新分頁 ----------
  const scopeOf=()=>location.pathname.includes('company.html')?'company':'staff';
  const homeDetail=()=>scopeOf()==='company'?{action:'overview',id:'home',label:'總覽'}:{action:'home',id:'home',label:'工作台'};
  const keyOf=d=>String(d?.id||d?.action||'');
  const pick=d=>{const o={};for(const k of ['action','id','label','parentId','parentLabel','tab'])if(d&&d[k]!==undefined&&d[k]!==null)o[k]=d[k];return o;};
  const isHome=d=>d.action==='home'||d.id==='home'||(scopeOf()==='company'&&d.action==='overview');
  const baseUrl=()=>location.pathname+location.search;
  const menuUrl=d=>`${baseUrl()}#m=${encodeURIComponent(keyOf(d))}`;
  try{if(!history.state&&!/^#m=/.test(location.hash))history.replaceState({home:true},'',baseUrl());}catch(e){}
  // ---------- 系統更新偵測：部署新版後，還開著的舊頁面在點下一個功能時自動重新整理成新版 ----------
  // 伺服器每個 API 回應都帶 X-App-Version；和頁面載入時的版本不同，就代表程式已經更新。
  let appVer=null,appStale=false;
  try{const of=window.fetch.bind(window);window.fetch=async(...args)=>{const r=await of(...args);try{if(r.status===401&&r.headers.get('x-relogin')==='1')showRelogin();}catch(e){}try{const v=r.headers.get('x-app-version');if(v){if(appVer===null)appVer=v;else if(v!==appVer&&!appStale){appStale=true;showUpdateBar();}}}catch(e){}return r;};}catch(e){}
  // 登入已逾時（閒置太久或登入狀態失效）：用清楚的提示請使用者重新登入，取代「沒有權限」的錯誤訊息
  function showRelogin(){if(!document.body.classList.contains('is-authenticated')||document.getElementById('reloginBox'))return;const b=document.createElement('div');b.id='reloginBox';b.style.cssText='position:fixed;inset:0;z-index:10001;background:rgba(29,13,12,.5);display:flex;align-items:center;justify-content:center;padding:16px';b.innerHTML='<div role="alertdialog" aria-modal="true" style="background:#FCFAF1;color:#1D0D0C;border-radius:16px;max-width:400px;width:100%;padding:22px 20px;box-shadow:0 18px 50px rgba(0,0,0,.25)"><h3 style="margin:0 0 8px">🔒 登入已逾時</h3><p style="margin:0 0 16px;color:#5F403B;line-height:1.6">為了資料安全，系統已將您登出。請重新登入後繼續作業。</p><div style="text-align:right"><button type="button" id="reloginGo">重新登入</button></div></div>';document.body.appendChild(b);b.querySelector('#reloginGo').onclick=()=>location.replace(location.pathname);}
  function showUpdateBar(){if(document.getElementById('appUpdateBar'))return;const b=document.createElement('div');b.id='appUpdateBar';b.setAttribute('role','status');b.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:#5F403B;color:#fff;padding:10px 18px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-size:15px;cursor:pointer;max-width:92vw;text-align:center';b.textContent='🔄 系統已更新，點這裡重新整理（下一次點選功能也會自動更新）';b.onclick=()=>location.reload();document.body.appendChild(b);}
  document.addEventListener('workspace-menu',e=>{
    const d=e.detail||{};if(d.fromHistory)return;
    // 程式已更新：直接用新版打開這個功能（網址帶 #m=…，重新整理後會自動開啟），避免舊程式看不懂新功能
    if(appStale&&keyOf(d)&&!isHome(d)){e.stopImmediatePropagation();try{location.replace(menuUrl(d));}catch(_){}location.reload();return;}
    try{
      const st=history.state;
      if(isHome(d)){if(!st||st.home)history.replaceState({home:true},'',baseUrl());else history.pushState({home:true},'',baseUrl());return;}
      if(!keyOf(d))return;
      if(st&&st.menu&&keyOf(st.menu)===keyOf(d)){history.replaceState({menu:pick(d)},'',menuUrl(d));return;}
      history.pushState({menu:pick(d)},'',menuUrl(d));
    }catch(err){}
  },true);
  window.addEventListener('popstate',e=>{
    if(!document.body.classList.contains('is-authenticated'))return;
    const st=e.state;const d=st&&st.menu?st.menu:homeDetail();
    document.body.classList.remove('sidebar-open','sidebar-hover');
    document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{...d,fromHistory:true}}));
  });
  let menuItems=null,menuResolve;const menuReady=new Promise(r=>menuResolve=r);
  // 開新分頁或重新整理時，網址帶著 #m=… 就直接打開那個功能（登入、選好社區之後由各頁呼叫）
  window.__openDeepLink=async function(){
    const m=location.hash.match(/^#m=(.+)$/);if(!m||window.__deepLinkDone)return false;window.__deepLinkDone=true;
    const key=decodeURIComponent(m[1]);
    const items=await Promise.race([menuReady,new Promise(r=>setTimeout(()=>r(menuItems||[]),6000))]);
    let it=(items||[]).find(x=>String(x.id)===key)||(items||[]).find(x=>String(x.action||'')===key);
    // 公司端的母目錄（例如「會計」「總務管理」）本身沒有頁面：直接打開第一個子項目
    if(it&&/company\.html/.test(location.pathname)){const kids=(items||[]).filter(x=>String(x.parentId||'')===String(it.id)&&x.enabled!==false);if(kids.length&&['finance','company-resources'].includes(String(it.action||'')))it=kids[0];}
    if(!it){try{history.replaceState({home:true},'',baseUrl());}catch(e){}return false;}
    const parent=it.parentId?items.find(x=>String(x.id)===String(it.parentId)):null;
    const d={action:it.action,id:it.id,label:it.label,parentId:it.parentId||null,parentLabel:parent?.label||''};
    try{history.replaceState({menu:pick(d)},'',menuUrl(d));}catch(e){}
    document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{...d,fromHistory:true}}));
    return true;
  };
  function openInNewTab(item){window.open(menuUrl({id:item.id,action:item.action}),'_blank','noopener');}
  function bindNewTab(btn,item){
    btn.addEventListener('mousedown',e=>{if(e.button===1)e.preventDefault();});
    btn.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();e.stopPropagation();openInNewTab(item);}});
    btn.addEventListener('click',e=>{if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();e.stopImmediatePropagation();openInNewTab(item);}},true);
  }
  function renderItems(items,pinnedIds=new Set()){
    const nav=sidebar?.querySelector('.nav-tabs'); if(!nav)return;
    menuItems=Array.isArray(items)?items:[];menuResolve(menuItems);
    nav.innerHTML='';
    // 工作台是首頁，不屬於工作目錄；從目錄中移除，改由左上角 ↩ 返回。
    items=(Array.isArray(items)?items:[]).filter(x=>String(x.action||'')!=='home' && String(x.label||'')!=='我的工作台');
    const byParent={}; for(const x of items){const p=x.parentId||'__root';(byParent[p] ||= []).push(x)}
    function emit(item){
      nav.querySelectorAll('button:not(.menu-pin-btn)').forEach(x=>x.classList.remove('active'));
      // 點了工作項目就自動收起目錄（桌機展開的目錄、手機抽屜都一樣）
      document.body.classList.remove('sidebar-open','sidebar-hover');
      const parent=item.parentId?items.find(x=>String(x.id)===String(item.parentId)):null;
      document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:item.action,id:item.id,label:item.label,parentId:item.parentId||null,parentLabel:parent?.label||''}}));
    }
    function add(parent,depth){
      for(const item of (byParent[parent]||[])){
        const children=byParent[item.id]||[];
        const btn=document.createElement('button');
        btn.type='button';btn.className=depth?'menu-child':'';btn.dataset.menuAction=item.action||'placeholder';btn.dataset.menuId=item.id;
        btn.innerHTML=`<span class="nav-icon">●</span><span class="nav-label">${esc(item.label||'未命名功能')}</span>${children.length?'<span class="menu-chevron" aria-hidden="true">›</span>':''}`;
        if(children.length){
          btn.classList.add('menu-parent');btn.setAttribute('aria-expanded','false');
          btn.addEventListener('click',()=>{
            const open=btn.getAttribute('aria-expanded')!=='false';
            // 有子目錄但本身也是頁面（代辦事項、社區資訊）：點母目錄也會打開該頁
            if(String(item.action||'')==='todo'||(['community-info',...(scopeOf()==='staff'?['company-resources']:[])].includes(String(item.action||''))&&!open)){
              document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:item.action,id:item.id,label:item.label}}));
            }
            // 手機／桌機都採用手風琴式目錄：開啟新的母目錄時，其他母目錄自動收起。
            nav.querySelectorAll('.menu-parent[aria-expanded="true"]').forEach(other=>{
              if(other===btn)return;
              other.setAttribute('aria-expanded','false');
              const otherBox=other.nextElementSibling;
              if(otherBox?.classList.contains('menu-children'))otherBox.classList.add('is-collapsed');
            });
            btn.setAttribute('aria-expanded',String(!open));
            const box=btn.nextElementSibling;if(box)box.classList.toggle('is-collapsed',open);
          });
        }else{
          btn.addEventListener('click',()=>emit(item));bindNewTab(btn,item);
        }
        if(children.length&&['todo','community-info'].includes(String(item.action||'')))bindNewTab(btn,item);
        nav.appendChild(btn);
        if(children.length){
          const childBox=document.createElement('div');childBox.className='menu-children is-collapsed';nav.appendChild(childBox);
          for(const child of children){
            const cbtn=document.createElement('button');cbtn.type='button';cbtn.className='menu-child';cbtn.dataset.menuAction=child.action||'placeholder';cbtn.dataset.menuId=child.id;
            cbtn.innerHTML=`<span class="nav-icon">•</span><span class="nav-label">${esc(child.label||'未命名功能')}</span>`;
            cbtn.addEventListener('click',()=>emit(child));bindNewTab(cbtn,child);
            childBox.appendChild(cbtn);
          }
        }
      }
    }
    add('__root',0);
  }
  async function loadDynamicSidebar(scope){
    if(!sidebar)return;
    try{
      const menuUrl=scope==='company'?'/api/company/menu-config':'/api/staff/menu-config';
      if(scope==='staff'){
        const [mr,pr]=await Promise.all([fetch(menuUrl,{credentials:'same-origin',cache:'no-store'}),fetch('/api/staff/dashboard-pins',{credentials:'same-origin',cache:'no-store'})]);
        if(!mr.ok)return;
        const md=await mr.json(); const pd=pr.ok?await pr.json():{pins:[]};
        const ids=new Set((Array.isArray(pd.pins)?pd.pins:[]).map(x=>String(x.menu_id)));
        renderItems(Array.isArray(md.items)?md.items:[],ids);
      }else{
        const r=await fetch(menuUrl,{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const d=await r.json();renderItems(Array.isArray(d.items)?d.items:[]);
      }
    }catch(e){console.warn('Dynamic menu load skipped',e)}
  }
  window.refreshWorkspaceMenu=loadDynamicSidebar;
  setupShell();
  // 桌機／手機切換時同步狀態，避免先前的 hover / drawer class 留在 body 造成卡住。
  let lastMobile=mobile();
  window.addEventListener('resize',()=>{
    const nowMobile=mobile();
    if(nowMobile!==lastMobile){
      document.body.classList.remove('sidebar-hover');
      document.body.classList.remove('sidebar-open');
      if(nowMobile) document.body.classList.remove('sidebar-collapsed');
      else document.body.classList.add('sidebar-collapsed');
      lastMobile=nowMobile;
    }
  },{passive:true});
  document.querySelectorAll('[data-close-notice]').forEach(btn=>btn.addEventListener('click',()=>{const n=btn.closest('.floating-notice');if(!n)return;n.classList.add('is-closed');try{localStorage.setItem('notice-closed-'+(n.id||location.pathname),'1')}catch(e){}}));
  document.querySelectorAll('.floating-notice').forEach(n=>{try{if(localStorage.getItem('notice-closed-'+(n.id||location.pathname))==='1')n.classList.add('is-closed')}catch(e){}});
  const login=document.getElementById('loginView'),main=document.getElementById('mainView');
  function sync(){const home=document.getElementById('homeView');const logged=main?getComputedStyle(main).display!=='none':home?getComputedStyle(home).display!=='none':(login?getComputedStyle(login).display==='none':true);document.body.classList.toggle('is-authenticated',logged);if(logged){const scope=location.pathname.includes('company.html')?'company':location.pathname.endsWith('/')||location.pathname.includes('index.html')?'staff':null;if(scope)setTimeout(()=>loadDynamicSidebar(scope),30)}}
  if(login||main){sync();const mo=new MutationObserver(sync);if(login)mo.observe(login,{attributes:true,attributeFilter:['style','class']});const hv=document.getElementById('homeView');if(hv&&!main)mo.observe(hv,{attributes:true,attributeFilter:['style','class']});if(main)mo.observe(main,{attributes:true,attributeFilter:['style','class']})}
})();

// ---------- 閒置自動登出（公司內勤後台、系統總後台） ----------
// 30 分鐘沒有任何操作就自動登出，避免電腦離開座位時被別人看到資料。多個分頁共用「最後操作時間」，在任一分頁操作都算數。
(function(){
  const p=location.pathname;const scope=/company\.html/.test(p)?'company':/admin\.html/.test(p)?'admin':'';if(!scope)return;
  const LIMIT=30*60*1000,KEY='lastActivity:'+scope,MSG='idleLogout:'+scope;
  let last=Date.now(),wrote=0;
  const save=t=>{try{localStorage.setItem(KEY,String(t));}catch(e){}};
  const act=()=>{const t=Date.now();last=t;if(t-wrote>15000){wrote=t;save(t);}};
  // 在輸入框打字（含手機輸入法）也算有在作業
  document.addEventListener('input',()=>act(),true);
  ['mousedown','keydown','touchstart','wheel','mousemove','scroll'].forEach(e=>window.addEventListener(e,act,{passive:true,capture:true}));
  save(last);
  try{if(sessionStorage.getItem(MSG)){sessionStorage.removeItem(MSG);const d=document.createElement('div');d.setAttribute('role','status');d.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:10000;background:#5F403B;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-weight:600;max-width:92vw';d.textContent='為了資料安全，閒置超過 30 分鐘已自動登出，請重新登入。';document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(d));if(document.body)document.body.appendChild(d);setTimeout(()=>d.remove(),10000);}}catch(e){}
  // 快到時間前 2 分鐘先提醒；只要動一下滑鼠、按鍵或捲動就會繼續保持登入
  const WARN=2*60*1000;let bar=null;
  const hideBar=()=>{if(bar){bar.remove();bar=null;}};
  ['mousedown','keydown','touchstart','wheel','mousemove','scroll'].forEach(e=>window.addEventListener(e,hideBar,{passive:true,capture:true}));
  setInterval(async()=>{
    if(!document.body.classList.contains('is-authenticated'))return;
    let t=last;try{t=Math.max(last,Number(localStorage.getItem(KEY))||0);}catch(e){}
    const idle=Date.now()-t;
    if(idle<LIMIT-WARN){hideBar();return;}
    if(idle<LIMIT){if(!bar){bar=document.createElement('div');bar.setAttribute('role','alert');bar.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;background:#5F403B;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-weight:600;display:flex;gap:12px;align-items:center;max-width:94vw;flex-wrap:wrap';bar.innerHTML='<span>您已經一段時間沒有操作，約 2 分鐘後會自動登出。</span><button type="button" style="background:#fff;color:#5F403B;border:0;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">繼續使用</button>';bar.querySelector('button').onclick=()=>{act();hideBar();};document.body.appendChild(bar);}return;}
    hideBar();
    try{await fetch(scope==='admin'?'/api/admin/logout':'/api/company/logout',{method:'POST',credentials:'same-origin'});}catch(e){}
    try{sessionStorage.setItem(MSG,'1');}catch(e){}
    location.replace(location.pathname);
  },10000);
})();
