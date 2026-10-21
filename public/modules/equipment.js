// 總務設備管理：現場「設備申請」、公司「設備清冊／設備申請紀錄／社區進駐設備」
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok){if(d.must_change_password)window.PasswordModule?.force(url.startsWith('/api/company')?'/api/company/my':'/api/staff');const e=new Error(d.error||'操作失敗');e.data=d;throw e;}return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const WD='日一二三四五六';
  const today=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
  const addDays=(s,n)=>{const x=new Date(`${s}T00:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const diff=(a,b)=>Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/864e5);
  const dl=d=>{if(!d)return '';const x=new Date(`${d}T12:00:00`);return `${Number(d.slice(5,7))}/${Number(d.slice(8,10))}（${WD[x.getDay()]}）`;};
  const dt=s=>s?String(s).replace('T',' ').slice(0,16):'';
  const period=r=>r.start_date===r.end_date?dl(r.start_date):`${dl(r.start_date)} ～ ${dl(r.end_date)}（${r.days} 天）`;
  const money=v=>Math.round(Number(v)||0).toLocaleString('en-US');
  const ST={pending_site:'wait',pending_ga:'wait',approved:'ok',lent:'lent',returning:'wait',closed:'done',rejected:'no',cancelled:'no'};
  const SRC={move_in:'進駐',loan:'借用'};const OWN={company:'公司財產',community:'社區自有'};
  const CHECK={ok:'點收無誤',damaged:'有損壞',missing:'有遺失'};

  function injectStyle(){
    if(document.getElementById('equipStyle'))return;
    const s=document.createElement('style');s.id='equipStyle';
    s.textContent=`
.eq-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px;align-items:center}.eq-tabs button{padding:7px 14px;min-height:0;border-radius:999px;margin:0}
.eq-tabs .badge{display:inline-block;background:#A44528;color:#fff;border-radius:999px;font-size:.72rem;padding:0 7px;margin-left:5px}
.eq-tabs select,.eq-tabs input{width:auto;margin:0;padding:7px 10px}
.eq-info{background:#F6ECE6;border:1px solid #E2D3CC;border-radius:12px;padding:11px 14px;line-height:1.7;margin-bottom:14px;font-size:.9rem;color:#5F403B}
.eq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.eq-item{border:1px solid #E2D3CC;border-radius:14px;background:#fff;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:box-shadow .15s,border-color .15s}
.eq-item:hover{border-color:#C9B0A8;box-shadow:0 4px 14px rgba(95,64,59,.10)}.eq-item.sel{border:2px solid #A44528}
.eq-item.none{opacity:.6}
.eq-ph{height:110px;background:#F6ECE6 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:2.2rem;color:#C9B0A8}
.eq-item .b{padding:9px 12px;display:grid;gap:3px}.eq-item h4{margin:0;font-size:.96rem;color:#1D0D0C}.eq-item small{color:#9A6654}
.eq-nums{display:flex;gap:10px;font-size:.8rem;color:#5F403B;flex-wrap:wrap}.eq-nums b{color:#A44528;font-size:.95rem}
.eq-book{border:1px solid #C9B0A8;border-radius:14px;background:#FCFAF1;padding:14px;margin:14px 0}
.eq-book h3{margin:0 0 6px;font-size:1.05rem;color:#5F403B}
.eq-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 14px}
.eq-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.eq-form input,.eq-form select,.eq-form textarea{margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #DDCCC4;border-radius:8px;background:#fff;font:inherit}
.eq-form .wide{grid-column:1/-1}.eq-form .half{grid-column:span 2}
.eq-cal-head{display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px;gap:8px;flex-wrap:wrap}
.eq-cal-head button{padding:5px 12px;min-height:0;margin:0}
.eq-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.eq-cal .h{text-align:center;font-weight:700;color:#9A6654;font-size:.8rem;padding:2px 0}
.eq-day{border:1px solid #EADDD6;border-radius:9px;background:#fff;padding:5px 4px;text-align:center;cursor:pointer;min-height:46px;display:flex;flex-direction:column;justify-content:center;gap:1px;user-select:none}
.eq-day b{font-size:.9rem;color:#1D0D0C}.eq-day span{font-size:.7rem;color:#5F403B}
.eq-day.full,.eq-day.past,.eq-day.beyond{background:#EFEAE8;color:#A9A09D;cursor:not-allowed;border-color:#E6E0DE}.eq-day.full b,.eq-day.past b,.eq-day.beyond b,.eq-day.full span,.eq-day.past span,.eq-day.beyond span{color:#ABA19E}
.eq-day.low{background:#FFF6E6}.eq-day.in{background:#F3DDD3;border-color:#C9B0A8}.eq-day.edge{background:#A44528;border-color:#A44528}.eq-day.edge b,.eq-day.edge span{color:#fff}
.eq-day.today{outline:2px solid #C9B0A8;outline-offset:-2px}
.eq-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.78rem;color:#5F403B;margin-top:8px}.eq-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:4px;border:1px solid #DDCCC4}
.eq-early{margin-top:10px;padding:8px 12px;border-radius:10px;background:#E8EEDF;color:#3E5328;font-size:.88rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.eq-early button{padding:4px 12px;min-height:0;margin:0}
.eq-early.no{background:#F6E3DC;color:#7A2E1A}
.eq-list{display:grid;gap:10px}
.eq-card{border:1px solid #E2D3CC;border-radius:14px;padding:12px 14px;background:#fff}
.eq-card.alert{border-left:4px solid #A44528}
.eq-top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
.eq-top h4{margin:0;font-size:.98rem;color:#1D0D0C}.eq-meta{font-size:.84rem;color:#5F403B;line-height:1.65}
.eq-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.74rem;font-weight:800;margin-left:6px;vertical-align:middle;white-space:nowrap}
.eq-pill.wait{background:#fff3e0;color:#a35a00}.eq-pill.ok{background:#E8EEDF;color:#3E5328}.eq-pill.lent{background:#5F403B;color:#fff}.eq-pill.done{background:#EFEAE8;color:#5F403B}.eq-pill.no{background:#eee;color:#777}.eq-pill.red{background:#A44528;color:#fff}
.eq-acts{display:flex;gap:6px;flex-wrap:wrap}.eq-acts button{padding:5px 12px;min-height:0;margin:0}
.eq-flow{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;font-size:.74rem}.eq-flow span{padding:2px 8px;border-radius:999px;background:#F6ECE6;color:#9A6654}.eq-flow span.on{background:#A44528;color:#fff}.eq-flow span.done{background:#C9B0A8;color:#fff}
.eq-table{width:100%;border-collapse:collapse;font-size:.86rem}.eq-table th,.eq-table td{padding:7px 9px;border-bottom:1px solid #F1E7E1;text-align:left;vertical-align:middle}.eq-table th{background:#F6ECE6;font-size:.78rem;color:#5F403B;white-space:nowrap}
.eq-table td button{padding:4px 10px;min-height:0;margin:0}
.eq-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px;background:#fff}
.eq-group{border:1px solid #E2D3CC;border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden}
.eq-ghead{display:flex;gap:12px;align-items:center;padding:10px 12px;cursor:pointer;flex-wrap:wrap}
.eq-thumb{width:54px;height:54px;border-radius:10px;background:#F6ECE6 center/cover no-repeat;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#C9B0A8;font-size:1.4rem}
.eq-ghead .t{flex:1 1 200px}.eq-ghead h4{margin:0;font-size:1rem}.eq-ghead small{color:#9A6654}
.eq-stats{display:flex;gap:14px;flex-wrap:wrap}.eq-stats div{text-align:center;min-width:52px}.eq-stats b{display:block;font-size:1.05rem;color:#1D0D0C}.eq-stats span{font-size:.72rem;color:#9A6654}
.eq-stats .hi b{color:#A44528}
.eq-gbody{border-top:1px solid #F1E7E1;padding:8px 10px;background:#FCFAF1}
.eq-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.eq-chips button{padding:5px 12px;min-height:0;border-radius:999px;margin:0;font-size:.84rem}
.eq-modal-bg{position:fixed;inset:0;background:rgba(29,13,12,.42);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:40px 14px;overflow:auto}
.eq-modal{background:#fff;border-radius:16px;max-width:760px;width:100%;padding:20px 22px;box-shadow:0 20px 50px rgba(0,0,0,.25);position:relative}
.eq-modal h3{margin:0 0 6px;color:#5F403B}.eq-modal .x{position:absolute;right:14px;top:10px;background:none;border:0;font-size:1.5rem;color:#5F403B;cursor:pointer;padding:4px 8px;min-height:0}
.eq-modal .foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.eq-units{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-top:8px}
.eq-units label{display:flex;gap:6px;align-items:center;border:1px solid #EADDD6;border-radius:9px;padding:6px 8px;font-size:.85rem;font-weight:600;margin:0}
.eq-units input{width:auto;margin:0}
.eq-sites{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.eq-site{border:1px solid #E2D3CC;border-radius:14px;background:#fff;padding:12px 14px;cursor:pointer}.eq-site:hover{border-color:#A44528}
.eq-site h4{margin:0 0 4px}.eq-muted{color:#9A6654;font-size:.82rem}
.eq-sub{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px}.eq-sub button{padding:7px 14px;min-height:0;margin:0}
@media(max-width:720px){.eq-form{grid-template-columns:1fr 1fr}.eq-form .half{grid-column:1/-1}}
`;
    document.head.appendChild(s);
  }
  function modal(title,html,{wide}={}){
    const bg=document.createElement('div');bg.className='eq-modal-bg';
    bg.innerHTML=`<div class="eq-modal" style="${wide?'max-width:980px':''}"><button type="button" class="x" aria-label="關閉">×</button><h3>${title}</h3>${html}</div>`;
    document.body.appendChild(bg);const close=()=>bg.remove();
    bg.querySelector('.x').addEventListener('click',close);bg.addEventListener('click',e=>{if(e.target===bg)close();});
    return {box:bg.querySelector('.eq-modal'),close};
  }
  const photoUrl=(base,id)=>`${base}/equip/photo/${id}`;
  const thumb=(base,id,cls='eq-thumb')=>id?`<div class="${cls}" style="background-image:url('${photoUrl(base,id)}')"></div>`:`<div class="${cls}">🧰</div>`;

  // 流程進度
  function flow(r,siteStep){
    const steps=[...(siteStep?[['pending_site','案場主管']]:[]),['pending_ga','總務核准'],['approved','出借'],['lent','歸還'],['returning','點收'],['closed','歸檔']];
    const order=steps.map(s=>s[0]);const cur=order.indexOf(r.status);
    if(['rejected','cancelled'].includes(r.status))return '';
    return `<div class="eq-flow">${steps.map(([k,l],i)=>`<span class="${i<cur||r.status==='closed'?'done':i===cur?'on':''}">${l}</span>`).join('')}</div>`;
  }
  function reqCard(r,{showWho=true,actions='',siteStep=true}={}){
    const alert=r.overdue||['pending_ga','returning'].includes(r.status);
    const unitsTxt=r.units?.length?`<br>出借：${esc(r.units.map(u=>u.asset_no||`${u.name} ×${u.qty}`).join('、'))}`:'';
    const who=[r.site_by&&`案場主管 ${esc(r.site_by)} 同意`,r.ga_by&&r.status!=='rejected'&&`總務 ${esc(r.ga_by)} 核准`,r.lent_at&&`${dt(r.lent_at).slice(5)} 出借`,r.returned_at&&`${dt(r.returned_at).slice(5)} 歸還`,r.checked_at&&`${esc(r.checked_by)} 點收：${CHECK[r.check_result]||''}`].filter(Boolean).join('　·　');
    return `<div class="eq-card${alert?' alert':''}"><div class="eq-top"><div><h4>${esc(r.item_name)} ×${r.qty}<span class="eq-pill ${ST[r.status]||''}">${esc(r.status_label)}</span>${r.overdue?'<span class="eq-pill red">逾期未還</span>':''}</h4>
      <div class="eq-meta">${showWho?`${esc(r.applicant_name)}｜`:''}${esc(r.community_name||'')}｜${period(r)}${r.purpose?`<br>用途：${esc(r.purpose)}`:''}${unitsTxt}${r.status==='pending_site'&&r.site_approvers?.length?`<br>等待：${esc(r.site_approvers.join('、'))}`:''}${who?`<br><span class="eq-muted">${who}</span>`:''}${r.comment?`<br>${r.status==='rejected'?'退回原因':'備註'}：${esc(r.comment)}`:''}${r.return_note?`<br>歸還備註：${esc(r.return_note)}`:''}${r.check_note?`<br>點收：${esc(r.check_note)}`:''}</div>
      ${flow(r,siteStep&&(r.site_approvers?.length||r.site_by))}</div><div class="eq-acts">${actions}</div></div></div>`;
  }

  // ================= 現場：設備申請 =================
  const SS={tab:'apply',cat:'',q:'',gkey:'',cid:null,qty:1,start:'',end:'',calFrom:'',purpose:''};
  async function renderStaff(el,{base='/api/staff',label='設備申請',side='staff'}={}){
    injectStyle();
    const m=await api(`${base}/equip/meta`);
    if(!SS.cid||!m.communities.some(c=>c.id===SS.cid))SS.cid=m.communities[0]?.id||null;
    const tabs=[['apply','🧰 申請借用'],['mine','📋 我的申請']];if(m.is_site_approver)tabs.push(['approve','✅ 待我審核']);tabs.push(['site','🏢 本社區設備']);
    if(!tabs.some(t=>t[0]===SS.tab))SS.tab='apply';
    el.innerHTML=`<div class="${side==='company'?'':'panel'}">${side==='company'?'':`<div class="eyebrow">🧰 設備</div><h1>${esc(label)}</h1>`}<div class="eq-tabs">${tabs.map(([k,l])=>`<button type="button" data-tab="${k}" class="${SS.tab===k?'':'secondary'}">${l}${k==='approve'&&m.waiting?`<span class="badge">${m.waiting}</span>`:''}</button>`).join('')}</div><div id="eqBody"><div class="profile-loading">讀取中…</div></div></div>`;
    const again=()=>renderStaff(el,{base,label,side});
    el.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{SS.tab=b.dataset.tab;again().catch(e=>alert(e.message));}));
    const body=el.querySelector('#eqBody');
    if(SS.tab==='apply')return staffApply(body,m,base,again);
    if(SS.tab==='mine'||SS.tab==='approve')return staffList(body,m,base,again,SS.tab);
    if(SS.tab==='site')return staffSite(body,m,base);
  }
  function staffApply(body,m,base,again){
    if(!m.communities.length){body.innerHTML='<div class="empty">您還沒有所屬社區，無法申請借用設備。</div>';return;}
    if(!m.catalog.length){body.innerHTML='<div class="empty">公司還沒有登記可借用的設備。</div>';return;}
    const cats=[...new Set(m.catalog.map(x=>x.category).filter(Boolean))];
    const list=m.catalog.filter(x=>(!SS.cat||x.category===SS.cat)&&(!SS.q||`${x.name} ${x.brand_model}`.toLowerCase().includes(SS.q.toLowerCase())));
    const card=x=>`<div class="eq-item${SS.gkey===x.gkey?' sel':''}${x.total?'':' none'}" data-g="${esc(x.gkey)}">${x.photo_id?`<div class="eq-ph" style="background-image:url('${photoUrl(base,x.photo_id)}')"></div>`:'<div class="eq-ph">🧰</div>'}<div class="b"><h4>${esc(x.name)}</h4><small>${esc([x.category,x.brand_model].filter(Boolean).join('｜'))}</small><div class="eq-nums"><span>總數 <b>${x.total}</b></span><span>今天借出 <b>${x.lent_today}</b></span><span>可借 <b>${x.avail_today}</b></span></div></div></div>`;
    body.innerHTML=`<div class="eq-info">🧰 選設備 → 選借用期間（借滿的日子會反灰），送出後由${m.settings.site_approval?'<b>案場主管</b>同意，再由':''}<b>總務</b>核准出借。用完歸還後按「已歸還」，總務點收後歸檔。每次最多借 ${m.settings.max_days} 天，可預約 ${m.settings.horizon_days} 天內。</div>
      <div class="eq-tabs">${m.communities.length>1?`<select id="eqComm">${m.communities.map(c=>`<option value="${c.id}" ${c.id===SS.cid?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:`<span class="eq-muted">社區：<b>${esc(m.communities[0].name)}</b></span>`}<input id="eqQ" placeholder="🔍 搜尋設備" value="${esc(SS.q)}" style="min-width:180px"></div>
      <div class="eq-chips"><button type="button" data-cat="" class="${SS.cat?'secondary':''}">全部</button>${cats.map(c=>`<button type="button" data-cat="${esc(c)}" class="${SS.cat===c?'':'secondary'}">${esc(c)}</button>`).join('')}</div>
      <div id="eqBook"></div>
      <div class="eq-grid">${list.map(card).join('')||'<div class="empty">沒有符合的設備。</div>'}</div>`;
    body.querySelector('#eqComm')?.addEventListener('change',e=>{SS.cid=Number(e.target.value);});
    const q=body.querySelector('#eqQ');q.addEventListener('input',()=>{SS.q=q.value;clearTimeout(q._t);q._t=setTimeout(()=>{staffApply(body,m,base,again);const n=body.querySelector('#eqQ');n.focus();n.setSelectionRange(n.value.length,n.value.length);},250);});
    body.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{SS.cat=b.dataset.cat;staffApply(body,m,base,again);}));
    body.querySelectorAll('[data-g]').forEach(c=>c.addEventListener('click',()=>{const x=m.catalog.find(i=>i.gkey===c.dataset.g);if(!x.total){alert('這項設備目前沒有可以借用的數量（可能都在維修或進駐在社區）。');return;}if(SS.gkey!==x.gkey){SS.gkey=x.gkey;SS.qty=1;SS.start='';SS.end='';SS.calFrom='';}staffApply(body,m,base,again);body.querySelector('#eqBook')?.scrollIntoView({behavior:'smooth',block:'start'});}));
    const x=m.catalog.find(i=>i.gkey===SS.gkey);if(x)booking(body.querySelector('#eqBook'),x,m,base,again);
  }
  async function booking(box,x,m,base,again){
    const t=m.today||today();if(!SS.calFrom){const d=new Date(`${t}T12:00:00`);SS.calFrom=addDays(t,-d.getDay());}
    const dur=SS.start&&SS.end?diff(SS.start,SS.end)+1:1;
    const a=await api(`${base}/equip/availability?gkey=${encodeURIComponent(x.gkey)}&from=${SS.calFrom<t?t:SS.calFrom}&days=42&qty=${SS.qty}&dur=${Math.min(dur,m.settings.max_days)}`);
    const byD=new Map(a.days.map(d=>[d.d,d]));const max=a.stock.total;
    const okRange=(s,e)=>{for(let d=s;d<=e;d=addDays(d,1)){const v=byD.get(d);if(!v||v.avail<SS.qty||v.beyond)return false;}return true;};
    const cells=[];for(let i=0;i<42;i++){const d=addDays(SS.calFrom,i);const v=byD.get(d);const past=d<t;const cls=['eq-day'];
      if(past)cls.push('past');else if(!v)cls.push('beyond');else if(v.beyond)cls.push('beyond');else if(v.avail<SS.qty)cls.push('full');else if(v.avail<max)cls.push('low');
      if(SS.start&&d>=SS.start&&d<=(SS.end||SS.start))cls.push(d===SS.start||d===SS.end?'edge':'in');if(d===t)cls.push('today');
      cells.push(`<div class="${cls.join(' ')}" data-d="${d}"><b>${Number(d.slice(8))===1||i===0?`${Number(d.slice(5,7))}/`:''}${Number(d.slice(8))}</b><span>${past?'':v&&!v.beyond?`可借 ${v.avail}`:''}</span></div>`);}
    const early=a.earliest;
    box.innerHTML=`<div class="eq-book"><div class="eq-top"><div style="display:flex;gap:12px;align-items:center">${thumb(base,x.photo_id)}<div><h3>${esc(x.name)}</h3><div class="eq-muted">${esc([x.category,x.brand_model].filter(Boolean).join('｜'))}${x.location?`｜存放：${esc(x.location)}`:''}</div><div class="eq-nums" style="margin-top:4px"><span>可借總數 <b>${a.stock.total}</b></span>${a.stock.at_sites?`<span>進駐社區 ${a.stock.at_sites}</span>`:''}${a.stock.repair?`<span>維修中 ${a.stock.repair}</span>`:''}</div></div></div><button type="button" class="secondary" id="eqClose" style="padding:5px 12px;min-height:0;margin:0">✕ 取消選擇</button></div>
      <div class="eq-form" style="margin-top:12px"><label>數量<input type="number" id="eqQty" min="1" max="${max}" value="${SS.qty}"></label><label>開始日<input type="date" id="eqS" min="${t}" value="${SS.start}"></label><label>結束日<input type="date" id="eqE" min="${SS.start||t}" value="${SS.end}"></label><label>天數<input disabled value="${SS.start&&SS.end?`${dur} 天`:'—'}"></label></div>
      <div class="eq-cal-head"><b>點日曆選擇期間：先點開始日，再點結束日</b><span><button type="button" class="secondary" id="eqPrev">◀</button> <button type="button" class="secondary" id="eqNext">▶</button></span></div>
      <div class="eq-cal">${[...WD].map(w=>`<div class="h">${w}</div>`).join('')}${cells.join('')}</div>
      <div class="eq-legend"><span><i style="background:#fff"></i>可借</span><span><i style="background:#FFF6E6"></i>部分借出</span><span><i style="background:#EFEAE8"></i>借滿／不可預約</span><span><i style="background:#A44528;border-color:#A44528"></i>您選的期間</span></div>
      <div class="eq-early${early?'':' no'}">${early?`📅 借 ${SS.qty} 個、${dur} 天，最早可以從 <b>${dl(early)}</b> 開始借${early!==SS.start?` <button type="button" id="eqUseEarly">套用</button>`:''}`:`⚠ 在可預約的 ${a.horizon_days} 天內找不到可以借 ${SS.qty} 個、${dur} 天的期間，請減少數量或天數。`}</div>
      <div class="eq-form" style="margin-top:12px"><label class="wide">用途<input id="eqPurpose" maxlength="300" placeholder="例如：社區中秋活動、地下室清洗" value="${esc(SS.purpose)}"></label><div class="wide"><button type="button" id="eqSubmit">送出借用申請</button></div></div></div>`;
    const re=()=>booking(box,x,m,base,again).catch(e=>alert(e.message));
    box.querySelector('#eqClose').addEventListener('click',()=>{SS.gkey='';staffApply(box.parentElement,m,base,again);});
    box.querySelector('#eqPurpose').addEventListener('input',e=>{SS.purpose=e.target.value;});
    box.querySelector('#eqQty').addEventListener('change',e=>{SS.qty=Math.max(1,Math.min(max,Number(e.target.value)||1));re();});
    box.querySelector('#eqS').addEventListener('change',e=>{SS.start=e.target.value;if(SS.end&&SS.end<SS.start)SS.end=SS.start;if(!SS.end)SS.end=SS.start;re();});
    box.querySelector('#eqE').addEventListener('change',e=>{SS.end=e.target.value;if(SS.start&&SS.end<SS.start)SS.start=SS.end;re();});
    box.querySelector('#eqPrev').addEventListener('click',()=>{const n=addDays(SS.calFrom,-28);SS.calFrom=n<addDays(t,-7)?SS.calFrom:n;re();});
    box.querySelector('#eqNext').addEventListener('click',()=>{if(diff(t,SS.calFrom)<m.settings.horizon_days){SS.calFrom=addDays(SS.calFrom,28);re();}});
    box.querySelector('#eqUseEarly')?.addEventListener('click',()=>{const d0=dur;SS.start=early;SS.end=addDays(early,d0-1);const d=new Date(`${early}T12:00:00`);SS.calFrom=addDays(early,-d.getDay());re();});
    box.querySelectorAll('.eq-day').forEach(c=>c.addEventListener('click',()=>{
      if(/past|beyond|full/.test(c.className))return;const d=c.dataset.d;
      if(!SS.start||SS.end&&SS.end!==SS.start||d<SS.start){SS.start=d;SS.end=d;}
      else{if(diff(SS.start,d)+1>m.settings.max_days){alert(`每次最多借 ${m.settings.max_days} 天`);return;}if(!okRange(SS.start,d)){alert('這段期間中間有借滿的日子，請重新選擇。');return;}SS.end=d;}
      re();}));
    box.querySelector('#eqSubmit').addEventListener('click',async()=>{
      if(!SS.start||!SS.end){alert('請選擇借用期間');return;}if(!SS.cid){alert('請選擇社區');return;}
      const btn=box.querySelector('#eqSubmit');btn.disabled=true;
      try{await api(`${base}/equip/requests`,J('POST',{community_id:SS.cid,gkey:x.gkey,qty:SS.qty,start_date:SS.start,end_date:SS.end,purpose:SS.purpose}));alert(m.settings.site_approval?'已送出，等待案場主管同意。':'已送出，等待總務核准。');SS.gkey='';SS.start='';SS.end='';SS.purpose='';SS.tab='mine';again();}
      catch(e){btn.disabled=false;if(e.data?.earliest){if(confirm(`${e.message}\n\n要改成從 ${e.data.earliest} 開始嗎？`)){SS.start=e.data.earliest;SS.end=addDays(e.data.earliest,dur-1);re();}}else alert(e.message);}
    });
  }
  async function staffList(body,m,base,again,scope){
    const d=await api(`${base}/equip/requests?scope=${scope==='approve'?'approve':'mine'}`);
    const acts=r=>[r.can.site_decide&&`<button type="button" data-sd="${r.id}" data-a="1">✅ 同意</button><button type="button" class="secondary" data-sd="${r.id}" data-a="0">退回</button>`,r.can.ret&&`<button type="button" data-ret="${r.id}">📦 已歸還</button>`,r.can.cancel&&`<button type="button" class="secondary" data-cc="${r.id}">取消申請</button>`].filter(Boolean).join('');
    const rows=scope==='approve'?[...d.rows.filter(r=>r.status==='pending_site'),...d.rows.filter(r=>r.status!=='pending_site')]:d.rows;
    body.innerHTML=rows.length?`${scope==='approve'?'<div class="eq-info">您是案場主管，社區人員的借用申請要先經過您同意，再送總務核准。</div>':''}<div class="eq-list">${rows.map(r=>reqCard(r,{showWho:scope==='approve',actions:acts(r)})).join('')}</div>`:`<div class="empty">${scope==='approve'?'目前沒有需要您審核的申請。':'還沒有借用申請。'}</div>`;
    body.querySelectorAll('[data-sd]').forEach(b=>b.addEventListener('click',async()=>{const approve=b.dataset.a==='1';let comment='';if(!approve){comment=prompt('退回原因：');if(!comment)return;}try{await api(`${base}/equip/requests/${b.dataset.sd}/site-decide`,J('POST',{approve,comment}));again();}catch(e){alert(e.message);}}));
    body.querySelectorAll('[data-ret]').forEach(b=>b.addEventListener('click',async()=>{const note=prompt('已歸還給總務？可以寫備註（例如：放回倉庫第二層、電池沒電）：','');if(note===null)return;try{await api(`${base}/equip/requests/${b.dataset.ret}/return`,J('POST',{note}));again();}catch(e){alert(e.message);}}));
    body.querySelectorAll('[data-cc]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('確定取消這張申請？'))return;try{await api(`${base}/equip/requests/${b.dataset.cc}/cancel`,J('POST',{}));again();}catch(e){alert(e.message);}}));
  }
  async function staffSite(body,m,base){
    if(!m.communities.length){body.innerHTML='<div class="empty">您還沒有所屬社區。</div>';return;}
    const d=await api(`${base}/equip/site-items?community_id=${SS.cid}`);
    body.innerHTML=`<div class="eq-tabs">${m.communities.length>1?`<select id="eqComm2">${m.communities.map(c=>`<option value="${c.id}" ${c.id===SS.cid?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:''}<span class="eq-muted">${esc(d.community.name)} 目前有 ${d.rows.length} 項設備（進駐時帶來的設備＋借用中的設備）</span></div>${siteTable(d.rows,{})}`;
    body.querySelector('#eqComm2')?.addEventListener('change',e=>{SS.cid=Number(e.target.value);staffSite(body,m,base);});
  }
  function siteTable(rows,{actions}){
    if(!rows.length)return '<div class="empty">目前沒有登記設備。</div>';
    return `<div class="eq-wrap"><table class="eq-table"><thead><tr><th>分類</th><th>名稱</th><th>廠牌型號</th><th>財產編號</th><th>數量</th><th>來源</th><th>歸屬</th><th>日期</th><th>備註</th>${actions?'<th></th>':''}</tr></thead><tbody>${rows.map(x=>`<tr${x.status!=='present'?' style="opacity:.55"':''}><td>${esc(x.category||'')}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.brand_model||'')}</td><td>${esc(x.asset_no||'')}</td><td>${x.qty}</td><td>${x.source==='loan'?'<span class="eq-pill lent" style="margin:0">借用</span>':'進駐'}</td><td>${OWN[x.owner]||''}</td><td>${dt(x.placed_at).slice(0,10)}${x.status!=='present'?`<br><small>撤回 ${dt(x.removed_at).slice(0,10)}</small>`:''}</td><td>${esc(x.status!=='present'?x.removed_note||'':x.note||'')}</td>${actions?`<td>${actions(x)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
  }

  // ================= 公司：總務管理 =================
  const CS={view:'inventory',cat:'',q:'',status:'',open:{},group:'todo',cid:0,month:'',site:null};
  async function renderCompany(el,view,label){
    injectStyle();if(view)CS.view=view;
    const m=await api('/api/company/equip/meta');CS.m=m;
    const subs=[['inventory','📋 設備清冊'],['requests','🗂 設備申請紀錄'],['sites','🏢 社區進駐設備'],['apply','🧰 我要借用']];
    const todo=m.counts.pending_ga+m.counts.approved+m.counts.returning;
    el.innerHTML=`<div class="eyebrow">🧰 總務管理</div><h1>${esc(label||({inventory:'設備清冊',requests:'設備申請紀錄',sites:'社區進駐設備',apply:'設備申請'})[CS.view])}</h1>
      <div class="eq-sub">${subs.map(([k,l])=>`<button type="button" data-view="${k}" class="${CS.view===k?'':'secondary'}">${l}${k==='requests'&&todo?`<span class="badge" style="display:inline-block;background:${CS.view===k?'#fff':'#A44528'};color:${CS.view===k?'#A44528':'#fff'};border-radius:999px;font-size:.72rem;padding:0 7px;margin-left:5px">${todo}</span>`:''}</button>`).join('')}</div><div id="eqC"><div class="profile-loading">讀取中…</div></div>`;
    el.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{CS.view=b.dataset.view;el.querySelector('h1').textContent=({inventory:'設備清冊',requests:'設備申請紀錄',sites:'社區進駐設備',apply:'設備申請'})[CS.view];renderCompany(el,CS.view,el.querySelector('h1').textContent).catch(e=>alert(e.message));}));
    const box=el.querySelector('#eqC');const again=()=>renderCompany(el,CS.view,el.querySelector('h1').textContent);
    if(CS.view==='inventory')return inventory(box,m,again);
    if(CS.view==='requests')return records(box,m,again);
    if(CS.view==='sites')return sites(box,m,again);
    if(CS.view==='apply')return renderStaff(box,{base:'/api/company/my',side:'company'});
  }

  // ---- 設備清冊 ----
  async function inventory(box,m,again){
    const d=await api('/api/company/equip/items');const base='/api/company/my';
    const cats=m.settings.categories;
    const match=g=>(!CS.cat||g.category===CS.cat)&&(!CS.q||`${g.name} ${g.brand_model} ${g.items.map(i=>i.asset_no+' '+i.location).join(' ')}`.toLowerCase().includes(CS.q.toLowerCase()))&&(!CS.status||g.items.some(i=>i.status===CS.status));
    const groups=d.groups.filter(match);
    const tot=d.groups.reduce((a,g)=>({owned:a.owned+g.owned,value:a.value+g.items.reduce((s,i)=>s+i.price*i.quantity,0)}),{owned:0,value:0});
    const whereTxt=i=>i.where.map(w=>`${w.source==='loan'?`借用中→${esc(w.community)}${w.until?`（至 ${w.until.slice(5)}${w.overdue?'，逾期':''}）`:''}`:`進駐 ${esc(w.community)}`}${i.track_mode==='qty'?` ×${w.qty}`:''}`).join('<br>');
    const itemRow=i=>`<tr><td>${i.track_mode==='unit'?`<b>${esc(i.asset_no||'（未編號）')}</b>`:`依數量${i.asset_no?`<br><small>${esc(i.asset_no)}</small>`:''}`}</td><td>${i.quantity}</td><td><span class="eq-pill ${i.status==='normal'?'ok':i.status==='repair'?'wait':'no'}" style="margin:0">${esc(i.status_label)}</span></td><td>${esc(i.location||'')}</td><td>${i.purchase_date||''}</td><td>${i.price?`$${money(i.price)}`:''}</td><td>${whereTxt(i)||'<span class="eq-muted">在庫</span>'}</td><td>${esc(i.note||'')}</td><td style="white-space:nowrap"><button type="button" class="secondary" data-edit="${i.id}">編輯</button> <button type="button" class="secondary" data-del="${i.id}">刪除</button></td></tr>`;
    const grp=g=>{const ph=g.items.find(i=>i.has_photo);const open=CS.open[g.gkey];return `<div class="eq-group"><div class="eq-ghead" data-tg="${esc(g.gkey)}">${thumb(base,ph?.id)}<div class="t"><h4>${esc(g.name)} <small>${open?'▲':'▼'}</small></h4><small>${esc([g.category,g.brand_model].filter(Boolean).join('｜'))}${g.items[0]?.track_mode==='unit'?'｜逐台登記':'｜依數量登記'}</small></div><div class="eq-stats"><div><b>${g.owned}</b><span>總數</span></div><div class="hi"><b>${g.avail_today}</b><span>今天可借</span></div><div><b>${g.lent_today}</b><span>借出／預約</span></div><div><b>${g.at_sites}</b><span>進駐社區</span></div><div><b>${g.repair}</b><span>維修中</span></div></div><button type="button" class="secondary" data-hist="${esc(g.gkey)}" style="padding:5px 12px;min-height:0;margin:0">借用紀錄</button></div>${open?`<div class="eq-gbody"><div class="eq-wrap"><table class="eq-table"><thead><tr><th>財產編號</th><th>數量</th><th>狀態</th><th>存放位置</th><th>購入日期</th><th>單價</th><th>目前位置</th><th>備註</th><th></th></tr></thead><tbody>${g.items.map(itemRow).join('')}</tbody></table></div></div>`:''}</div>`;};
    box.innerHTML=`<div class="eq-tabs"><input id="eqIQ" placeholder="🔍 名稱、型號、財產編號、位置" value="${esc(CS.q)}" style="min-width:220px"><select id="eqIS"><option value="">全部狀態</option>${Object.entries(m.item_status).map(([k,v])=>`<option value="${k}" ${CS.status===k?'selected':''}>${v}</option>`).join('')}</select><button type="button" id="eqAdd">＋ 新增設備</button><button type="button" class="secondary" id="eqCats">🏷 分類設定</button><span class="eq-muted">共 ${d.groups.length} 種、${tot.owned} 件，帳面價值 $${money(tot.value)}</span></div>
      <div class="eq-chips"><button type="button" data-cat="" class="${CS.cat?'secondary':''}">全部分類</button>${cats.map(c=>`<button type="button" data-cat="${esc(c)}" class="${CS.cat===c?'':'secondary'}">${esc(c)}（${d.groups.filter(g=>g.category===c).length}）</button>`).join('')}</div>
      ${groups.length?groups.map(grp).join(''):`<div class="empty">${d.groups.length?'沒有符合的設備。':'還沒有登記設備，按「＋ 新增設備」開始建立設備清冊。'}</div>`}`;
    const re=()=>inventory(box,m,again).catch(e=>alert(e.message));
    const q=box.querySelector('#eqIQ');q.addEventListener('input',()=>{CS.q=q.value;clearTimeout(q._t);q._t=setTimeout(async()=>{await re();const n=box.querySelector('#eqIQ');n.focus();n.setSelectionRange(n.value.length,n.value.length);},300);});
    box.querySelector('#eqIS').addEventListener('change',e=>{CS.status=e.target.value;re();});
    box.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{CS.cat=b.dataset.cat;re();}));
    box.querySelectorAll('[data-tg]').forEach(h=>h.addEventListener('click',e=>{if(e.target.closest('button'))return;CS.open[h.dataset.tg]=!CS.open[h.dataset.tg];re();}));
    box.querySelectorAll('[data-hist]').forEach(b=>b.addEventListener('click',()=>{CS.view='requests';CS.gkey=b.dataset.hist;CS.group='all';again();}));
    box.querySelector('#eqAdd').addEventListener('click',()=>itemModal(m,null,null,re));
    box.querySelector('#eqCats').addEventListener('click',()=>catsModal(m,again));
    box.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{const id=Number(b.dataset.edit);const g=d.groups.find(x=>x.items.some(i=>i.id===id));itemModal(m,g.items.find(i=>i.id===id),g,re);}));
    box.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('確定從設備清冊刪除這筆設備？（借用紀錄會保留）'))return;try{await api(`/api/company/equip/items/${b.dataset.del}`,{method:'DELETE'});re();}catch(e){alert(e.message);}}));
  }
  function itemModal(m,it,g,done){
    const cats=m.settings.categories;const isNew=!it;const v=it||{track_mode:'unit',status:'normal',category:CS.cat||cats[0]||''};
    const {box,close}=modal(isNew?'＋ 新增設備':`編輯：${esc(it.name)}${it.asset_no?`（${esc(it.asset_no)}）`:''}`,`
      <form class="eq-form" id="eqItemF" style="margin-top:10px">
        <label class="half">設備名稱<input name="name" required maxlength="60" value="${esc(v.name||'')}" placeholder="例如：高壓清洗機"></label>
        <label>分類<select name="category">${cats.map(c=>`<option ${v.category===c?'selected':''}>${esc(c)}</option>`).join('')}${v.category&&!cats.includes(v.category)?`<option selected>${esc(v.category)}</option>`:''}</select></label>
        <label>狀態<select name="status">${Object.entries(m.item_status).map(([k,l])=>`<option value="${k}" ${v.status===k?'selected':''}>${l}</option>`).join('')}</select></label>
        <label class="half">廠牌型號<input name="brand_model" maxlength="80" value="${esc(v.brand_model||'')}" placeholder="例如：Karcher K5"></label>
        <label>購入日期<input type="date" name="purchase_date" value="${esc(v.purchase_date||'')}"></label>
        <label>金額（單價）<input type="number" min="0" name="price" value="${v.price||''}" placeholder="0"></label>
        <label class="half">存放位置<input name="location" maxlength="80" value="${esc(v.location||'')}" placeholder="例如：總公司倉庫 A 櫃"></label>
        <label class="half">照片<input type="file" name="photo" accept="image/*">${it?.has_photo?'<small class="eq-muted" style="font-weight:400">已有照片，上傳會換掉</small>':''}</label>
        ${isNew?`<div class="wide"><b style="font-size:.86rem">登記方式</b><div style="display:flex;gap:18px;margin-top:6px;flex-wrap:wrap"><label style="flex-direction:row;gap:6px;align-items:center;font-weight:600"><input type="radio" name="track_mode" value="unit" checked style="width:auto"> 逐台登記（每台有財產編號，例如：清洗機、吸塵器）</label><label style="flex-direction:row;gap:6px;align-items:center;font-weight:600"><input type="radio" name="track_mode" value="qty" style="width:auto"> 依數量登記（例如：三角錐、延長線）</label></div></div>
        <label>數量<input type="number" name="quantity" min="1" max="9999" value="1"></label>
        <label class="unit">財產編號前綴<input name="asset_prefix" maxlength="30" placeholder="例如：CL-K5"></label><label class="unit">起始號碼<input type="number" name="asset_start" min="1" value="1"></label>
        <label class="qty" style="display:none">編號（選填）<input name="asset_no" maxlength="40"></label>
        <label class="wide unit">或逐一輸入財產編號（空白或逗號分隔，留空就用前綴自動編號）<textarea name="asset_nos" rows="2" placeholder="例如：A001 A002 A003"></textarea><small class="eq-muted" id="eqPrev" style="font-weight:400"></small></label>`
        :`${it.track_mode==='qty'?`<label>數量<input type="number" name="quantity" min="0" max="99999" value="${it.quantity}"></label>`:''}<label>財產編號<input name="asset_no" maxlength="40" value="${esc(it.asset_no||'')}"></label>${g&&g.items.length>1?`<label class="wide" style="flex-direction:row;gap:8px;align-items:center;font-weight:600"><input type="checkbox" name="apply_group" value="1" checked style="width:auto"> 名稱、分類、廠牌型號一起套用到同款的 ${g.items.length} 筆</label><label class="wide" style="flex-direction:row;gap:8px;align-items:center;font-weight:600"><input type="checkbox" name="photo_all" value="1" checked style="width:auto"> 照片也套用到同款還沒有照片的設備</label>`:''}`}
        <label class="wide">備註<input name="note" maxlength="300" value="${esc(v.note||'')}"></label>
      </form><div class="foot"><button type="button" class="secondary" data-x>取消</button><button type="button" id="eqItemSave">💾 儲存</button></div>`);
    const f=box.querySelector('#eqItemF');box.querySelector('[data-x]').addEventListener('click',close);
    const sync=()=>{if(!isNew)return;const mode=f.querySelector('[name=track_mode]:checked').value;f.querySelectorAll('.unit').forEach(x=>x.style.display=mode==='unit'?'':'none');f.querySelectorAll('.qty').forEach(x=>x.style.display=mode==='qty'?'':'none');
      const n=Number(f.elements.quantity.value)||1,p=f.elements.asset_prefix.value.trim(),s=Number(f.elements.asset_start.value)||1,w=Math.max(3,String(s+n-1).length);const list=f.elements.asset_nos.value.split(/[\s,，、]+/).filter(Boolean);
      box.querySelector('#eqPrev').textContent=mode!=='unit'?'':list.length?`${list.length} 個編號${list.length<n?`（還差 ${n-list.length} 個${p?'，用前綴補上':'，沒有編號'}）`:''}`:p?`會建立：${[0,1,2].filter(i=>i<n).map(i=>`${p}-${String(s+i).padStart(w,'0')}`).join('、')}${n>3?` … ${p}-${String(s+n-1).padStart(w,'0')}`:''}（共 ${n} 台）`:`共 ${n} 台，沒有財產編號`;};
    f.addEventListener('input',sync);f.addEventListener('change',sync);sync();
    box.querySelector('#eqItemSave').addEventListener('click',async()=>{
      if(!f.elements.name.value.trim()){alert('請填寫設備名稱');return;}
      const fd=new FormData(f);if(!f.elements.photo.files.length)fd.delete('photo');
      const btn=box.querySelector('#eqItemSave');btn.disabled=true;
      try{const r=await fetch(isNew?'/api/company/equip/items':`/api/company/equip/items/${it.id}`,{method:isNew?'POST':'PUT',credentials:'same-origin',body:fd});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'儲存失敗');close();if(isNew)CS.open[''+(j.gkey||'')]=true;done();}
      catch(e){btn.disabled=false;alert(e.message);}
    });
  }
  function catsModal(m,done){
    const {box,close}=modal('🏷 設備分類',`<p class="eq-muted">一行一個分類，順序就是顯示順序。已經使用中的分類改名時，原本的設備仍會保留舊分類，請到設備編輯中調整。</p><textarea id="eqCatT" rows="10" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #DDCCC4;border-radius:10px;font:inherit">${esc(m.settings.categories.join('\n'))}</textarea><div class="foot"><button type="button" class="secondary" data-x>取消</button><button type="button" id="eqCatS">💾 儲存</button></div>`);
    box.querySelector('[data-x]').addEventListener('click',close);
    box.querySelector('#eqCatS').addEventListener('click',async()=>{try{await api('/api/company/equip/categories',J('PUT',{categories:box.querySelector('#eqCatT').value.split('\n').map(s=>s.trim()).filter(Boolean)}));close();done();}catch(e){alert(e.message);}});
  }

  // ---- 設備申請紀錄 ----
  async function records(box,m,again){
    const qs=new URLSearchParams();if(CS.cid)qs.set('community_id',CS.cid);if(CS.group&&CS.group!=='all')qs.set('group',CS.group);if(CS.month)qs.set('month',CS.month);if(CS.gkey)qs.set('gkey',CS.gkey);
    const d=await api(`/api/company/equip/requests?${qs}`);const c=m.counts;
    const G=[['todo','待處理',c.pending_ga+c.approved+c.returning],['lent','出借中',c.lent],['done','已歸檔／退回',0],['all','全部',0]];
    const acts=r=>[r.can.site_decide&&`<button type="button" data-sd="${r.id}" data-a="1">案場同意</button>`,r.can.ga_decide&&`<button type="button" data-gd="${r.id}" data-a="1">✅ 核准</button><button type="button" class="secondary" data-gd="${r.id}" data-a="0">退回</button>`,r.can.lend&&`<button type="button" data-lend="${r.id}">📦 出借</button>`,r.can.check&&`<button type="button" data-chk="${r.id}">🔍 點收歸檔</button>`,`<button type="button" class="secondary" data-log="${r.id}">紀錄</button>`].filter(Boolean).join('');
    const gName=CS.gkey?(d.rows[0]?.item_name||'這項設備'):'';
    box.innerHTML=`<div class="eq-tabs"><select id="eqRC"><option value="0">全部社區</option>${m.communities.map(x=>`<option value="${x.id}" ${CS.cid===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>${G.map(([k,l,n])=>`<button type="button" data-grp="${k}" class="${CS.group===k?'':'secondary'}">${l}${n?`<span class="badge">${n}</span>`:''}</button>`).join('')}<input type="month" id="eqRM" value="${esc(CS.month)}" title="借用期間月份">${CS.month?'<button type="button" class="secondary" id="eqRMx">清除月份</button>':''}${CS.gkey?`<button type="button" class="secondary" id="eqRGx">只看 ${esc(gName)} ✕</button>`:''}</div>
      ${c.overdue?`<div class="eq-info" style="background:#F6E3DC;border-color:#EBCFC4;color:#7A2E1A">⏰ 有 ${c.overdue} 筆借用已經過了歸還日還沒有歸還。</div>`:''}
      ${d.rows.length?`<div class="eq-list">${d.rows.map(r=>reqCard(r,{actions:acts(r)})).join('')}</div>`:'<div class="empty">沒有符合的借用紀錄。</div>'}`;
    const re=()=>again();
    box.querySelector('#eqRC').addEventListener('change',e=>{CS.cid=Number(e.target.value);records(box,m,again);});
    box.querySelectorAll('[data-grp]').forEach(b=>b.addEventListener('click',()=>{CS.group=b.dataset.grp;records(box,m,again);}));
    box.querySelector('#eqRM').addEventListener('change',e=>{CS.month=e.target.value;records(box,m,again);});
    box.querySelector('#eqRMx')?.addEventListener('click',()=>{CS.month='';records(box,m,again);});
    box.querySelector('#eqRGx')?.addEventListener('click',()=>{CS.gkey='';records(box,m,again);});
    box.querySelectorAll('[data-sd]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`/api/company/my/equip/requests/${b.dataset.sd}/site-decide`,J('POST',{approve:true}));re();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-gd]').forEach(b=>b.addEventListener('click',async()=>{const approve=b.dataset.a==='1';const comment=approve?(prompt('核准備註（選填，例如：請到總公司倉庫領取）：','')??null):prompt('退回原因：');if(comment===null||(!approve&&!comment))return;try{await api(`/api/company/equip/requests/${b.dataset.gd}/ga-decide`,J('POST',{approve,comment}));re();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-lend]').forEach(b=>b.addEventListener('click',()=>lendModal(Number(b.dataset.lend),re)));
    box.querySelectorAll('[data-chk]').forEach(b=>b.addEventListener('click',()=>checkModal(d.rows.find(r=>r.id===Number(b.dataset.chk)),re)));
    box.querySelectorAll('[data-log]').forEach(b=>b.addEventListener('click',()=>logModal(Number(b.dataset.log))));
  }
  async function lendModal(id,done){
    const {request:r}=await api(`/api/company/equip/requests/${id}`);const units=r.free_units||[];const unit=units.some(u=>u.track_mode==='unit');
    let need=r.qty;const pre=new Set();for(const u of units){if(need<=0)break;pre.add(u.id);need-=u.free;}
    const {box,close}=modal(`📦 出借：${esc(r.item_name)} ×${r.qty}`,`<div class="eq-meta">${esc(r.applicant_name)}｜${esc(r.community_name)}｜${period(r)}</div>
      ${unit?`<p style="margin:10px 0 0"><b>選擇要出借的設備（${r.qty} 台）</b></p><div class="eq-units">${units.map(u=>`<label><input type="checkbox" value="${u.id}" ${pre.has(u.id)?'checked':''}> ${esc(u.asset_no||u.name)}${u.location?`<small class="eq-muted">　${esc(u.location)}</small>`:''}</label>`).join('')||'<span class="eq-muted">目前倉庫沒有可出借的設備</span>'}</div>`:`<p class="eq-muted">依數量登記的設備，會從倉庫數量中出借 ${r.qty} 個（目前可出借 ${units.reduce((s,u)=>s+u.free,0)} 個）。</p>`}
      <p class="eq-muted">出借後會加到「${esc(r.community_name)}」的社區設備，歸還點收後自動移除。</p><div class="foot"><button type="button" class="secondary" data-x>取消</button><button type="button" id="eqLendOk">確認出借</button></div>`);
    box.querySelector('[data-x]').addEventListener('click',close);
    box.querySelector('#eqLendOk').addEventListener('click',async()=>{const ids=[...box.querySelectorAll('.eq-units input:checked')].map(x=>Number(x.value));if(unit&&ids.length!==r.qty&&!confirm(`您選了 ${ids.length} 台，申請的是 ${r.qty} 台，不足的會自動挑選，確定嗎？`))return;try{await api(`/api/company/equip/requests/${id}/lend`,J('POST',{unit_ids:ids}));close();done();}catch(e){alert(e.message);}});
  }
  function checkModal(r,done){
    const units=r.units||[];
    const {box,close}=modal(`🔍 點收：${esc(r.item_name)} ×${r.qty}`,`<div class="eq-meta">${esc(r.applicant_name)}｜${esc(r.community_name)}｜${period(r)}${r.return_note?`<br>歸還備註：${esc(r.return_note)}`:''}${r.status==='lent'?'<br><b>申請人還沒按「已歸還」，點收後直接歸檔。</b>':''}</div>
      <div class="eq-wrap" style="margin-top:10px"><table class="eq-table"><thead><tr><th>設備</th><th>數量</th><th>損壞</th><th>遺失</th></tr></thead><tbody>${units.map(u=>`<tr data-u="${u.id}"><td>${esc(u.asset_no||u.name)}</td><td>${u.qty}</td><td>${u.qty===1?`<input type="checkbox" data-k="damaged" style="width:auto;margin:0">`:`<input type="number" min="0" max="${u.qty}" value="0" data-k="damaged" style="width:70px;margin:0">`}</td><td>${u.qty===1?`<input type="checkbox" data-k="missing" style="width:auto;margin:0">`:`<input type="number" min="0" max="${u.qty}" value="0" data-k="missing" style="width:70px;margin:0">`}</td></tr>`).join('')}</tbody></table></div>
      <p class="eq-muted">沒有勾選的就是正常歸還、數量恢復。損壞的會改成「維修中」，遺失的改成「遺失」，都不能再借出。</p>
      <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem">點收備註<input id="eqChkN" maxlength="300" placeholder="例如：外觀正常、配件齊全"></label>
      <div class="foot"><button type="button" class="secondary" data-x>取消</button><button type="button" id="eqChkOk">✅ 點收歸檔</button></div>`);
    box.querySelector('[data-x]').addEventListener('click',close);
    box.querySelector('#eqChkOk').addEventListener('click',async()=>{const lines=[...box.querySelectorAll('[data-u]')].map(tr=>{const g=k=>{const i=tr.querySelector(`[data-k=${k}]`);return i.type==='checkbox'?(i.checked?1:0):Number(i.value)||0;};return {id:Number(tr.dataset.u),damaged:g('damaged'),missing:g('missing')};});
      try{await api(`/api/company/equip/requests/${r.id}/check`,J('POST',{lines,note:box.querySelector('#eqChkN').value}));close();done();}catch(e){alert(e.message);}});
  }
  async function logModal(id){
    const {request:r}=await api(`/api/company/equip/requests/${id}`);const A={apply:'申請',site_approve:'案場主管同意',site_reject:'案場主管退回',ga_approve:'總務核准',ga_reject:'總務退回',lend:'出借',return:'申請人歸還',check:'點收歸檔',cancel:'取消'};
    const {box,close}=modal(`📜 ${esc(r.item_name)} ×${r.qty}`,`${reqCard(r,{})}<div class="eq-wrap" style="margin-top:10px"><table class="eq-table"><thead><tr><th>時間</th><th>人員</th><th>動作</th><th>說明</th></tr></thead><tbody>${r.logs.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${esc(l.actor)}</td><td>${A[l.action]||esc(l.action)}</td><td>${esc(l.note||'')}</td></tr>`).join('')}</tbody></table></div><div class="foot"><button type="button" data-x>關閉</button></div>`);
    box.querySelector('[data-x]').addEventListener('click',close);
  }

  // ---- 社區進駐設備 ----
  async function sites(box,m,again){
    if(CS.site)return siteDetail(box,m,again);
    const d=await api('/api/company/equip/sites');
    box.innerHTML=`<div class="eq-info">🏢 記錄每個社區進駐時帶進去的設備（公司財產或社區自有），借用出借、歸還時會自動更新。撤場時可以列印點交清單，請社區簽收。</div>
      <div class="eq-sites">${d.rows.map(s=>`<div class="eq-site" data-site="${s.id}"><h4>${esc(s.name)}</h4><div class="eq-muted">${s.lines?`${s.lines} 項、共 ${s.qty} 件${s.loan?`（借用中 ${s.loan} 件）`:''}`:'尚未登記設備'}</div></div>`).join('')||'<div class="empty">還沒有社區。</div>'}</div>`;
    box.querySelectorAll('[data-site]').forEach(c=>c.addEventListener('click',()=>{CS.site=Number(c.dataset.site);siteDetail(box,m,again);}));
  }
  async function siteDetail(box,m,again){
    const d=await api(`/api/company/equip/sites/${CS.site}`);const present=d.rows.filter(x=>x.status==='present');const gone=d.rows.filter(x=>x.status!=='present');
    box.innerHTML=`<div class="eq-tabs"><button type="button" class="secondary" id="eqBack">◀ 所有社區</button><b style="font-size:1.05rem">${esc(d.community.name)}</b><span class="eq-muted">目前 ${present.length} 項、${present.reduce((s,x)=>s+x.qty,0)} 件</span></div>
      <div class="eq-tabs"><button type="button" id="eqIn">＋ 進駐設備</button><button type="button" class="secondary" id="eqPrintIn">🖨 列印進駐點交清單</button><button type="button" class="secondary" id="eqPrintOut">🖨 列印撤場點交清單</button><button type="button" class="secondary" id="eqOut">🚚 撤場（全部撤回）</button></div>
      ${siteTable(present,{actions:x=>x.source==='loan'?'<small class="eq-muted">歸還時點收</small>':`<button type="button" class="secondary" data-rm="${x.id}">撤回</button>`})}
      ${gone.length?`<details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700;color:#5F403B">已撤回／已歸還（${gone.length}）</summary><div style="margin-top:8px">${siteTable(gone,{})}</div></details>`:''}`;
    const re=()=>siteDetail(box,m,again).catch(e=>alert(e.message));
    box.querySelector('#eqBack').addEventListener('click',()=>{CS.site=null;sites(box,m,again);});
    box.querySelector('#eqIn').addEventListener('click',()=>moveInModal(m,d,re));
    box.querySelector('#eqPrintIn').addEventListener('click',()=>printList(d,present,'進駐'));
    box.querySelector('#eqPrintOut').addEventListener('click',()=>printList(d,present,'撤場'));
    box.querySelector('#eqOut').addEventListener('click',async()=>{if(!present.some(x=>x.source==='move_in')){alert('目前沒有進駐設備。');return;}if(!confirm(`確定「${d.community.name}」撤場？\n所有進駐設備都會標記為已撤回（公司財產回到倉庫可再借出）。\n建議先列印撤場點交清單請社區簽收。`))return;try{const r=await api(`/api/company/equip/sites/${CS.site}/move-out`,J('POST',{}));alert(`已撤回 ${r.removed} 項。${r.loans_left?`\n還有 ${r.loans_left} 項借用中的設備，請到「設備申請紀錄」點收歸還。`:''}`);re();}catch(e){alert(e.message);}});
    box.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',async()=>{const note=prompt('撤回原因（選填）：','撤回倉庫');if(note===null)return;try{await api(`/api/company/equip/sites/${CS.site}/items/${b.dataset.rm}/remove`,J('POST',{note}));re();}catch(e){alert(e.message);}}));
  }
  async function moveInModal(m,site,done){
    const inv=await api('/api/company/equip/items');
    const opts=inv.groups.map(g=>`<option value="${esc(g.gkey)}">${esc(g.category)}｜${esc(g.name)}${g.brand_model?`（${esc(g.brand_model)}）`:''} — 倉庫可用 ${g.total}</option>`).join('');
    const {box,close}=modal(`＋ 進駐設備：${esc(site.community.name)}`,`<div class="eq-tabs"><button type="button" data-mt="inv">從設備清冊（公司財產）</button><button type="button" class="secondary" data-mt="free">社區自有／其他設備</button></div>
      <div data-p="inv"><form class="eq-form"><label class="wide">設備<select id="eqMG"><option value="">請選擇</option>${opts}</select></label><label>數量<input type="number" id="eqMQ" min="1" value="1"></label><label class="half">備註<input id="eqMN" maxlength="200" placeholder="例如：放在管理室"></label><div class="wide eq-units" id="eqMU"></div></form></div>
      <div data-p="free" style="display:none"><form class="eq-form"><label class="half">名稱<input id="eqFN" maxlength="60" placeholder="例如：社區 AED"></label><label>分類<select id="eqFC">${m.settings.categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label><label>數量<input type="number" id="eqFQ" min="1" value="1"></label><label class="half">廠牌型號<input id="eqFB" maxlength="80"></label><label>財產編號<input id="eqFA" maxlength="40"></label><label>歸屬<select id="eqFO"><option value="community">社區自有</option><option value="company">公司財產（未列清冊）</option></select></label><label class="wide">備註<input id="eqFR" maxlength="200"></label></form></div>
      <div class="foot"><button type="button" class="secondary" data-x>取消</button><button type="button" id="eqMOk">加入社區設備</button></div>`);
    let mode='inv';box.querySelector('[data-x]').addEventListener('click',close);
    box.querySelectorAll('[data-mt]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mt;box.querySelectorAll('[data-mt]').forEach(x=>x.className=x===b?'':'secondary');box.querySelectorAll('[data-p]').forEach(p=>p.style.display=p.dataset.p===mode?'':'none');}));
    box.querySelector('#eqMG').addEventListener('change',e=>{const g=inv.groups.find(x=>x.gkey===e.target.value);const u=box.querySelector('#eqMU');const free=g?g.items.filter(i=>i.track_mode==='unit'&&i.status==='normal'&&!i.where.length):[];u.innerHTML=free.length?free.map(i=>`<label><input type="checkbox" value="${i.id}"> ${esc(i.asset_no||i.name)}</label>`).join(''):'';if(g)box.querySelector('#eqMQ').max=g.total;});
    box.querySelector('#eqMU').addEventListener('change',()=>{const n=box.querySelectorAll('#eqMU input:checked').length;if(n)box.querySelector('#eqMQ').value=n;});
    box.querySelector('#eqMOk').addEventListener('click',async()=>{const v=s=>box.querySelector(s).value;
      const body=mode==='inv'?{gkey:v('#eqMG'),qty:Number(v('#eqMQ')),note:v('#eqMN'),unit_ids:[...box.querySelectorAll('#eqMU input:checked')].map(x=>Number(x.value))}:{name:v('#eqFN'),category:v('#eqFC'),qty:Number(v('#eqFQ')),brand_model:v('#eqFB'),asset_no:v('#eqFA'),owner:v('#eqFO'),note:v('#eqFR')};
      if(mode==='inv'&&!body.gkey){alert('請選擇設備');return;}
      try{await api(`/api/company/equip/sites/${CS.site}/items`,J('POST',body));close();done();}catch(e){alert(e.message);}});
  }
  function printList(d,rows,kind){
    if(!rows.length){alert('目前沒有設備可以列印。');return;}
    const w=window.open('','_blank');if(!w){alert('請允許彈出視窗以列印');return;}
    const t=today();
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(d.community.name)} 設備${kind}點交清單</title><style>
      body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#1D0D0C;margin:24px}h1{font-size:20px;margin:0 0 4px;text-align:center}.sub{text-align:center;color:#5F403B;margin-bottom:14px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #5F403B;padding:6px 5px;text-align:left}th{background:#F6ECE6}td.c{text-align:center}
      .sign{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:28px;font-size:13px}.sign div{border-top:1px solid #1D0D0C;padding-top:6px;text-align:center}
      .note{font-size:12px;color:#5F403B;margin-top:12px;line-height:1.7}@media print{body{margin:10mm}button{display:none}}</style></head><body>
      <h1>${esc(d.tenant||'')}　${esc(d.community.name)}　設備${kind}點交清單</h1><div class="sub">點交日期：${t.replace(/-/g,'/')}　共 ${rows.length} 項、${rows.reduce((s,x)=>s+x.qty,0)} 件</div>
      <table><thead><tr><th style="width:28px">#</th><th>分類</th><th>名稱</th><th>廠牌型號</th><th>財產編號</th><th style="width:40px">數量</th><th>歸屬</th><th>來源</th><th style="width:44px">點交<br>確認</th><th style="width:22%">狀況／備註</th></tr></thead><tbody>
      ${rows.map((x,i)=>`<tr><td class="c">${i+1}</td><td>${esc(x.category||'')}</td><td>${esc(x.name)}</td><td>${esc(x.brand_model||'')}</td><td>${esc(x.asset_no||'')}</td><td class="c">${x.qty}</td><td>${OWN[x.owner]||''}</td><td>${SRC[x.source]||''}${x.source==='loan'?'（借用中）':''}</td><td class="c">☐</td><td>${esc(x.note||'')}</td></tr>`).join('')}</tbody></table>
      <div class="note">${kind==='撤場'?'※ 撤場時請逐項確認：公司財產由物業公司收回；社區自有設備由社區（管理委員會）點收。借用中的設備請一併歸還。':'※ 進駐時請逐項確認數量與狀況，如有損壞請在備註欄註明。'}</div>
      <div class="sign"><div>${kind==='撤場'?'移交人（物業公司）':'移交人'}</div><div>${kind==='撤場'?'接收人（管理委員會）':'接收人（社區主管）'}</div><div>見證人</div><div>日期</div></div>
      <p style="text-align:center;margin-top:24px"><button onclick="window.print()">🖨 列印／另存 PDF</button></p><script>setTimeout(()=>window.print(),400)<\/script></body></html>`);
    w.document.close();
  }

  window.EquipmentModule={renderStaff,renderCompany};
})();
