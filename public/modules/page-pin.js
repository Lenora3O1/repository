// 工作頁面標題旁的 ☆／★：點一下就把這個工作釘選到首頁的「釘選工作」。
// 目錄本身不再放星號，畫面比較乾淨。
(function(){
  const host=()=>document.getElementById('staffHome');
  let current=null,pins=null,loading=null,raf=0;
  async function loadPins(force){
    if(pins&&!force)return pins;
    if(!loading||force)loading=fetch('/api/staff/dashboard-pins',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():{pins:[]}).then(d=>{pins=new Set((d.pins||[]).map(x=>String(x.menu_id)));return pins;}).catch(()=>{pins=new Set();return pins;});
    return loading;
  }
  function heading(root){
    for(const el of root.querySelectorAll('h1,h2,.section-title')){
      if(el.closest('.modal,.modal-backdrop,[hidden]'))continue;
      if(el.offsetParent===null&&getComputedStyle(el).position!=='fixed')continue;
      if(!el.textContent.trim())continue;
      return el;
    }
    return null;
  }
  function paint(btn){const on=pins?.has(String(current.id));btn.dataset.pinned=on?'1':'0';btn.textContent=on?'★':'☆';btn.title=on?'已釘選到首頁；點一下取消':'釘選到首頁的「釘選工作」';btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-pressed',on?'true':'false');}
  async function toggle(btn){
    const on=btn.dataset.pinned==='1';const id=String(current.id);btn.disabled=true;
    try{
      const r=await fetch(on?`/api/staff/dashboard-pins/${encodeURIComponent(id)}`:'/api/staff/dashboard-pins',{method:on?'DELETE':'POST',credentials:'same-origin',headers:on?{}:{'Content-Type':'application/json'},body:on?undefined:JSON.stringify({menu_id:id})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'釘選設定失敗');
      if(on)pins.delete(id);else pins.add(id);paint(btn);
      document.dispatchEvent(new CustomEvent('dashboard-pins-changed'));
    }catch(e){alert(e.message||'釘選設定失敗');}
    finally{btn.disabled=false;}
  }
  function place(){
    raf=0;const root=host();if(!root||!current||!pins)return;
    if(root.querySelector('.page-pin-btn')||root.querySelector('.home-head-v2'))return;
    const h=heading(root);if(!h)return;
    const btn=document.createElement('button');btn.type='button';btn.className='page-pin-btn';paint(btn);
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggle(btn);});
    const firstBtn=[...h.children].find(c=>c.tagName==='BUTTON');
    if(firstBtn)h.insertBefore(btn,firstBtn);else h.appendChild(btn);
  }
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(place);};
  document.addEventListener('workspace-menu',async e=>{
    const d=e.detail||{};
    if(!d.id||d.action==='home'){current=null;host()?.querySelectorAll('.page-pin-btn').forEach(x=>x.remove());return;}
    current={id:d.id,label:d.label||''};
    host()?.querySelectorAll('.page-pin-btn').forEach(x=>x.remove());
    await loadPins();schedule();
  });
  document.addEventListener('dashboard-pins-changed',()=>loadPins(true));
  function watch(){const root=host();if(!root){setTimeout(watch,500);return;}new MutationObserver(()=>{if(current)schedule();}).observe(root,{childList:true,subtree:true});}
  watch();
})();
