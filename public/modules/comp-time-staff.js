// 現場／內勤人員：補休（可用時數、期限、加班紀錄、補休使用紀錄、申請補休）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(u){const r=await fetch(u,{credentials:'same-origin',cache:'no-store'});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||'讀取失敗');return d;}
  const AS={comp:'換補休',pay:'加班費'};
  function css(){if(document.getElementById('ctCss'))return;const s=document.createElement('style');s.id='ctCss';s.textContent=`
  .ct-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
  .ct-num{background:#fff;border:1px solid #E8DCD5;border-radius:14px;padding:14px;text-align:center}.ct-num b{display:block;font-size:2rem;color:#5F403B;line-height:1.2}.ct-num span{font-size:.85rem;color:#7A5F58}
  .ct-num.warn b{color:#A44528}.ct-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}.ct-tabs button{border-radius:99px;padding:6px 12px}.ct-tabs button:not(.on){background:#F3ECE6;color:#5F403B;border-color:#E2D3CA}
  .ct-list{display:flex;flex-direction:column;gap:8px}.ct-item{background:#fff;border:1px solid #EFE6E0;border-radius:12px;padding:10px 12px;display:flex;justify-content:space-between;gap:10px;align-items:center}
  .ct-item small{color:#8B7770;display:block}.ct-h{font-weight:800;color:#5F403B;white-space:nowrap;font-size:1.05rem}.ct-tag{font-size:.75rem;border-radius:6px;padding:1px 6px;background:#E7EEF7;color:#2F4F7A;margin-left:4px}.ct-tag.pay{background:#FFF0D6;color:#8A5A00}`;document.head.appendChild(s);}
  let tab='credits';
  async function render(el,{label}={}){
    css();el.innerHTML='<div class="profile-loading">讀取中…</div>';
    let d;try{d=await api('/api/staff/comp-time');}catch(e){el.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;return;}
    const lists={
      credits:d.credits.filter(c=>c.hours>0).slice().sort((a,b)=>b.date.localeCompare(a.date)).map(c=>`<div class="ct-item"><div>${esc(c.date)} 加班 ${c.hours} 小時<small>${esc(c.reason||'')}</small><small>期限：${esc(c.expires)}${c.unpaid?'｜<b style="color:#A52828">已到期未休，公司應折發加班費</b>':''}</small></div><div class="ct-h">${c.expires<new Date().toISOString().slice(0,10)?'已到期':`剩 ${c.left} 時`}</div></div>`).join(''),
      uses:d.uses.slice().sort((a,b)=>b.d.localeCompare(a.d)).map(u=>`<div class="ct-item"><div>${esc(u.d)} 請補休<small>${u.status==='pending'?'審核中':'已核准'}</small></div><div class="ct-h">${u.h} 時</div></div>`).join(''),
      ot:d.overtime.map(o=>`<div class="ct-item"><div>${esc(o.work_date)}${o.start_time||o.end_time?` ${esc(o.start_time||'')}～${esc(o.end_time||'')}`:''}<span class="ct-tag ${o.as==='pay'?'pay':''}">${AS[o.as]||''}</span><small>${esc(o.reason||'')}</small></div><div class="ct-h">${o.hours} 時</div></div>`).join(''),
    };
    el.innerHTML=`<div class="eyebrow">📅 班表</div><h1>${esc(label||'補休')}</h1>
      <p class="hint">加班選擇「換補休」的時數會累積在這裡，可以用來請補休。補休期限：<b>${esc(d.expiry_label)}</b>；到期沒休完的時數，公司會依規定折發加班費。</p>
      <div class="ct-hero"><div class="ct-num"><b>${d.available}</b><span>目前可用補休（小時）</span></div><div class="ct-num ${d.expiring_30d?'warn':''}"><b>${d.expiring_30d}</b><span>30 天內到期（小時）</span></div>${d.expired_unpaid?`<div class="ct-num warn"><b>${d.expired_unpaid}</b><span>已到期、待公司折發（小時）</span></div>`:''}</div>
      <div style="margin-bottom:12px"><button type="button" id="ctApply" ${d.available>0?'':'disabled'}>📝 申請補休</button>${d.available>0?'':'<span class="hint" style="margin-left:8px">目前沒有可用的補休時數</span>'}</div>
      <div class="ct-tabs">${[['credits','補休明細與期限'],['uses','補休使用紀錄'],['ot','加班紀錄']].map(([k,t])=>`<button type="button" data-t="${k}" class="${tab===k?'on':''}">${t}</button>`).join('')}</div>
      <div class="ct-list">${lists[tab]||''}${lists[tab]?'':'<div class="hint">目前沒有紀錄</div>'}</div>`;
    el.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;render(el,{label});});
    el.querySelector('#ctApply').onclick=()=>{try{sessionStorage.setItem('leave.preset','comp');}catch{}document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:'staff-leave',id:'staff-leave',label:'請假'}}));};
  }
  window.CompTimeStaff={render};
})();
