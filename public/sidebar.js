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
  function renderItems(items,pinnedIds=new Set()){
    const nav=sidebar?.querySelector('.nav-tabs'); if(!nav)return;
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
            if(String(item.action||'')==='todo'){
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
          btn.addEventListener('click',()=>emit(item));
        }
        nav.appendChild(btn);
        if(children.length){
          const childBox=document.createElement('div');childBox.className='menu-children is-collapsed';nav.appendChild(childBox);
          for(const child of children){
            const cbtn=document.createElement('button');cbtn.type='button';cbtn.className='menu-child';cbtn.dataset.menuAction=child.action||'placeholder';cbtn.dataset.menuId=child.id;
            cbtn.innerHTML=`<span class="nav-icon">•</span><span class="nav-label">${esc(child.label||'未命名功能')}</span>`;
            cbtn.addEventListener('click',()=>emit(child));
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
  function sync(){const logged=main?getComputedStyle(main).display!=='none':(login?getComputedStyle(login).display==='none':true);document.body.classList.toggle('is-authenticated',logged);if(logged){const scope=location.pathname.includes('company.html')?'company':location.pathname.endsWith('/')||location.pathname.includes('index.html')?'staff':null;if(scope)setTimeout(()=>loadDynamicSidebar(scope),30)}}
  if(login||main){sync();const mo=new MutationObserver(sync);if(login)mo.observe(login,{attributes:true,attributeFilter:['style','class']});if(main)mo.observe(main,{attributes:true,attributeFilter:['style','class']})}
})();
