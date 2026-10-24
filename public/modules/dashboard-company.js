// 公司內勤首頁：依職位與權限顯示不同卡片（資料由 /api/company/dashboard 組合）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});let d={};try{d=await r.json()}catch{}if(!r.ok){if(d.must_change_password)window.PasswordModule?.force('/api/company/my');throw new Error(d.error||'讀取失敗');}return d;}
  function injectStyle(){
    if(document.getElementById('dashStyle'))return;
    const s=document.createElement('style');s.id='dashStyle';
    s.textContent=`
.db-hero{background:#fff;border:1px solid #E2D3CC;border-radius:16px;padding:20px 24px;margin-bottom:16px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end}
.db-hero small{color:#9A6654;font-weight:700;letter-spacing:.02em}.db-hero h1{margin:4px 0 2px;font-size:1.6rem;color:#1D0D0C}.db-hero p{margin:0;color:#5F403B}
.db-hero .co{font-weight:700;color:#5F403B;text-align:right}
.db-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.db-card{background:#fff;border:1px solid #E2D3CC;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-width:0;position:relative}
.db-card.sm{grid-column:span 1}.db-card.md{grid-column:span 2}.db-card.lg{grid-column:1/-1}
.db-card.click{cursor:pointer;transition:border-color .15s,transform .15s}.db-card.click:hover{border-color:#A44528;transform:translateY(-1px)}
.db-card.alert{border-top:3px solid #A44528}.db-card:not(.alert){border-top:3px solid #C9B0A8}
.db-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.db-head b{font-size:.92rem;color:#5F403B}.db-head .go{font-size:.8rem;color:#A44528;font-weight:700;white-space:nowrap}
.db-val{font-size:1.75rem;font-weight:800;color:#1D0D0C;line-height:1.1}.db-sub{font-size:.82rem;color:#9A6654}
.db-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}
.db-stat{background:#FCFAF1;border-radius:10px;padding:9px 12px}.db-stat span{display:block;font-size:.76rem;color:#5F403B;font-weight:700}.db-stat b{font-size:1.35rem;color:#1D0D0C}.db-stat small{display:block;color:#7A2E1A;font-size:.74rem;font-weight:700}
.db-list{display:grid}.db-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid #F1E7E1;font-size:.88rem}.db-row:first-child{border-top:0}
.db-row span{color:#1D0D0C}.db-row em{font-style:normal;color:#5F403B;text-align:right}.db-row.alert em{color:#7A2E1A;font-weight:700}
.db-row.link{cursor:pointer}.db-row.link:hover span{color:#A44528}
.db-table{width:100%;border-collapse:collapse;font-size:.86rem}.db-table th,.db-table td{padding:7px 8px;border-top:1px solid #F1E7E1;text-align:left}.db-table th{border-top:0;color:#5F403B;font-size:.76rem}
.db-table td.bad{color:#7A2E1A;font-weight:700}
.db-empty{color:#9A6654;font-size:.86rem}
@media(max-width:1100px){.db-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.db-card.md{grid-column:1/-1}}
@media(max-width:560px){.db-grid{grid-template-columns:1fr 1fr}.db-card.sm{grid-column:span 1}.db-val{font-size:1.4rem}.db-hero{padding:16px}}
`;
    document.head.appendChild(s);
  }
  let refresh=null;
  function go(a){
    if(!a)return;
    if(a.special==='ap-review'){if(!window.PayablesModule?.review){alert('模組尚未載入，請重新整理頁面');return;}window.PayablesModule.review(a.id,()=>refresh?.());return;}
    if(a.special==='messages'){document.getElementById('messageCenterButton')?.click();return;}
    if(a.special==='payslip'){document.getElementById('myPayslipBtn')?.click();return;}
    document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:a.action,label:a.label,tab:a.tab}}));
  }
  function card(c){
    const body=[];
    if(c.value!==undefined)body.push(`<div class="db-val">${esc(c.value)}</div>`);
    if(c.sub)body.push(`<div class="db-sub">${esc(c.sub)}</div>`);
    if(c.stats?.length)body.push(`<div class="db-stats">${c.stats.map(s=>`<div class="db-stat"><span>${esc(s.label)}</span><b>${esc(s.value)}</b>${s.warn?`<small>${esc(s.warn)}</small>`:''}</div>`).join('')}</div>`);
    if(c.items&&(c.items.length||!c.stats?.length))body.push(c.items.length?`<div class="db-list">${c.items.map((it,i)=>`<div class="db-row${it.tone==='alert'?' alert':''}${it.action?' link':''}" ${it.action?`data-item="${i}"`:''}><span>${esc(it.text)}</span><em>${esc(it.value)}</em></div>`).join('')}</div>`:`<div class="db-empty">${esc(c.empty||'沒有資料')}</div>`);
    if(c.table)body.push(`<div style="overflow:auto"><table class="db-table"><thead><tr>${c.table.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${c.table.rows.map((r,i)=>`<tr>${r.map((v,k)=>`<td class="${(c.table.alerts?.[i]||[]).includes(k)?'bad':''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    const clickable=c.action&&!c.items&&!c.table;
    return `<div class="db-card ${c.size||'sm'}${c.tone==='alert'?' alert':''}${clickable?' click':''}" data-card="${esc(c.id)}"><div class="db-head"><b>${c.icon?`${c.icon} `:''}${esc(c.title)}</b>${c.action?`<span class="go" data-go>${esc(c.action.label||'查看')} ›</span>`:''}</div>${body.join('')}</div>`;
  }
  async function render(el,{tenantName=''}={}){
    injectStyle();
    if(!el)return;
    refresh=()=>render(el,{tenantName});
    el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
    let d;try{d=await api('/api/company/dashboard');}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;return;}
    const h=d.today.hour;const hello=h<11?'早安':h<14?'午安':h<18?'午安':'晚安';
    const [mm,dd]=[Number(d.today.date.slice(5,7)),Number(d.today.date.slice(8,10))];
    el.innerHTML=`<div class="db-hero"><div><small>${mm} 月 ${dd} 日（${esc(d.today.weekday)}）${d.user.position?`・${esc(d.user.position)}`:''}${d.user.dept?`・${esc(d.user.dept)}`:''}</small><h1>${hello}，${esc(d.user.name)}</h1><p>以下是和您工作相關的今日重點。</p></div>${tenantName?`<div class="co">${esc(tenantName)}</div>`:''}</div>
      <div class="db-grid">${d.cards.map(card).join('')}</div>`;
    el.querySelectorAll('[data-card]').forEach(box=>{const c=d.cards.find(x=>x.id===box.dataset.card);if(!c)return;
      if(box.classList.contains('click'))box.addEventListener('click',()=>go(c.action));
      box.querySelector('[data-go]')?.addEventListener('click',e=>{e.stopPropagation();go(c.action);});
      box.querySelectorAll('[data-item]').forEach(r=>r.addEventListener('click',()=>go(c.items[Number(r.dataset.item)].action)));});
  }
  window.CompanyDashboard={render};
})();
