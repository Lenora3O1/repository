// 總務管理 → 社區合約
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok){const e=new Error(d.error||'操作失敗');e.data=d;e.status=r.status;throw e;}return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const money=v=>Math.round(Number(v)||0).toLocaleString('en-US');
  const ST={active:'ok',expiring:'wait',upcoming:'info',expired:'no',terminated:'no',draft:'info'};
  function injectStyle(){
    if(document.getElementById('ctStyle'))return;
    const s=document.createElement('style');s.id='ctStyle';
    s.textContent=`
.ct-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 14px}.ct-bar select,.ct-bar input{width:auto;margin:0;padding:7px 10px}.ct-bar button{padding:7px 14px;min-height:0;margin:0;border-radius:999px}
.ct-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}.ct-sum div{background:#fff;border:1px solid #E2D3CC;border-radius:14px;padding:10px 14px}.ct-sum b{display:block;font-size:1.3rem;color:#1D0D0C}.ct-sum span{font-size:.8rem;color:#9A6654}
.ct-list{display:grid;gap:10px}.ct-card{border:1px solid #E2D3CC;border-radius:14px;background:#fff;padding:12px 16px;cursor:pointer;display:grid;grid-template-columns:minmax(180px,1.3fr) minmax(160px,1fr) minmax(150px,1fr) auto;gap:10px 18px;align-items:center}
.ct-card:hover{border-color:#A44528}.ct-card.alert{border-left:4px solid #A44528}.ct-card h4{margin:0;font-size:1.02rem;color:#1D0D0C}.ct-card small,.ct-muted{color:#9A6654;font-size:.82rem}
.ct-amt b{font-size:1.05rem;color:#A44528}
.ct-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.74rem;font-weight:800;white-space:nowrap}.ct-pill.ok{background:#E8EEDF;color:#3E5328}.ct-pill.wait{background:#fff3e0;color:#a35a00}.ct-pill.no{background:#eee;color:#777}.ct-pill.info{background:#F6ECE6;color:#9A6654}
.ct-sec{border:1px solid #E2D3CC;border-radius:14px;background:#fff;padding:14px 16px;margin-bottom:12px}.ct-sec h3{margin:0 0 10px;font-size:1rem;color:#5F403B;display:flex;justify-content:space-between;align-items:center;gap:8px}
.ct-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 18px;font-size:.9rem}.ct-kv div span{display:block;color:#9A6654;font-size:.78rem}
.ct-table{width:100%;border-collapse:collapse;font-size:.88rem}.ct-table th,.ct-table td{padding:7px 9px;border-bottom:1px solid #F1E7E1;text-align:left;vertical-align:middle}.ct-table th{background:#F6ECE6;font-size:.78rem;color:#5F403B}.ct-table td.n,.ct-table th.n{text-align:right}
.ct-table input,.ct-table select{margin:0;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #DDCCC4;border-radius:7px;font:inherit}
.ct-table input:disabled,.ct-table select:disabled,.ct-form select:disabled{background:#F3EEEB;color:#A08F88;cursor:not-allowed}
.ct-table td button{padding:4px 10px;min-height:0;margin:0}
.ct-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 14px}.ct-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.ct-form input,.ct-form select,.ct-form textarea{margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #DDCCC4;border-radius:8px;background:#fff;font:inherit}
.ct-form .wide{grid-column:1/-1}.ct-form .half{grid-column:span 2}
.ct-ok{color:#3E5328;font-weight:700}.ct-bad{color:#A44528;font-weight:700}
.ct-acts{display:flex;gap:8px;flex-wrap:wrap}.ct-acts button{padding:7px 14px;min-height:0;margin:0}
@media(max-width:860px){.ct-card{grid-template-columns:1fr 1fr}.ct-form{grid-template-columns:1fr 1fr}.ct-form .half{grid-column:1/-1}}
`;document.head.appendChild(s);
  }
  const S={status:'current',cid:0,view:'list',gid:null};
  let M=null;
  async function render(el,label){
    injectStyle();M=await api('/api/company/contracts/meta');S.label=label||'社區合約';
    if(S.view==='detail'&&S.gid)return detail(el,S.gid);
    return list(el);
  }
  const head=(title,sub='')=>`<div class="eyebrow">📄 總務管理</div><h1>${esc(title)}</h1>${sub}`;
  const entLabel=id=>{const e=M.entities.find(x=>x.id===Number(id));return e?(e.short_name||e.name):'';};
  const RANK={expiring:0,active:1,upcoming:2,draft:3,expired:4,terminated:5};
  const left=c=>c.status==='terminated'?`${c.terminated_at} 解約`:c.days_left>=0?`剩 ${c.days_left} 天`:`已過期 ${-c.days_left} 天`;
  // 同一組合約（同社區、多家簽約公司）合成一張卡片
  function groupRows(rows){const m=new Map();for(const c of rows){const g=m.get(c.group_id)||[];g.push(c);m.set(c.group_id,g);}return [...m.values()].map(g=>g.sort((a,b)=>a.id-b.id));}
  async function list(el){
    S.view='list';
    const qs=new URLSearchParams({status:S.status});if(S.cid)qs.set('community_id',S.cid);
    const d=await api(`/api/company/contracts?${qs}`);
    const groups=groupRows(d.rows);
    const card=g=>{const c0=[...g].sort((a,b)=>RANK[a.status]-RANK[b.status])[0];const starts=[...new Set(g.map(c=>c.start_date))],ends=[...new Set(g.map(c=>c.end_date))];
      const gross=g.reduce((s,c)=>s+c.amounts.gross,0);
      return `<div class="ct-card${g.some(c=>c.status==='expiring')?' alert':''}" data-gid="${c0.group_id}"><div><h4>${esc(c0.community_name)} <span class="ct-pill ${ST[c0.status]}">${esc(c0.status_label)}</span></h4>${g.map(c=>`<small style="display:block">${esc(c.entity_name)}${c.contract_no?`｜${esc(c.contract_no)}`:''}${g.length>1&&c.status!==c0.status?` <span class="ct-pill ${ST[c.status]}">${esc(c.status_label)}</span>`:''}</small>`).join('')}</div>
      <div><small>合約期間</small><div>${starts.length===1&&ends.length===1?`${starts[0]} ～ ${ends[0]}`:'各家不同'}</div><small>${left(c0)}</small></div>
      <div class="ct-amt"><small>每月（含稅）</small><div><b>$${money(gross)}</b></div><small>${g.flatMap(c=>c.items.filter(i=>i.amount).map(i=>esc(M.kinds[i.kind]?.replace('服務費','')||i.name))).join('・')}</small></div>
      <div style="text-align:right"><small>派駐 ${g.reduce((s,c)=>s+c.staffing.reduce((a,x)=>a+x.count,0),0)} 人</small><br><small>${g.length>1?`${g.length} 家簽約公司`:''}</small></div></div>`;};
    const curG=groups.filter(g=>g.some(c=>['active','expiring'].includes(c.status)));
    el.innerHTML=`${head(S.label)}
      <div class="ct-sum"><div><span>履約中社區合約</span><b>${S.status==='current'||S.status==='all'?curG.length:d.summary.current} 組</b></div><div><span>每月合約金額（未稅）</span><b>$${money(d.summary.monthly_net)}</b></div><div><span>每月合約金額（含稅）</span><b>$${money(d.summary.monthly_gross)}</b></div><div><span>即將到期</span><b style="color:${d.summary.expiring?'#A44528':'inherit'}">${d.summary.expiring} 份</b></div></div>
      <div class="ct-bar"><select id="ctC"><option value="0">全部社區</option>${M.communities.map(c=>`<option value="${c.id}" ${S.cid===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>${[['current','目前有效'],['expiring','即將到期'],['expired','已到期'],['terminated','已解約'],['all','全部']].map(([k,l])=>`<button type="button" data-st="${k}" class="${S.status===k?'':'secondary'}">${l}</button>`).join('')}${M.can_edit?'<button type="button" id="ctNew" style="margin-left:auto">＋ 新增合約</button>':''}</div>
      ${groups.length?`<div class="ct-list">${groups.map(card).join('')}</div>`:'<div class="empty">沒有符合的合約。</div>'}`;
    el.querySelector('#ctC').addEventListener('change',e=>{S.cid=Number(e.target.value);list(el);});
    el.querySelectorAll('[data-st]').forEach(b=>b.addEventListener('click',()=>{S.status=b.dataset.st;list(el);}));
    el.querySelector('#ctNew')?.addEventListener('click',()=>editor(el,{}));
    el.querySelectorAll('[data-gid]').forEach(c=>c.addEventListener('click',()=>detail(el,Number(c.dataset.gid))));
  }
  async function detail(el,gid){
    S.view='detail';S.gid=gid;const {group:G}=await api(`/api/company/contracts/group/${gid}`);
    const ms=G.members,live=ms.filter(c=>c.status!=='terminated'),c0=live[0]||ms[0];const multi=ms.length>1;
    const posName=p=>p.position_name||M.positions.find(x=>x.id===p.position_id)?.name||p.position_id;
    const staff=ms.flatMap(c=>c.status==='terminated'?[]:c.staffing.map(p=>({...p,ent:c.entity_name})));
    const staffRows=staff.map(p=>{const act=G.actual_staff.find(a=>a.position_id&&a.position_id===p.position_id);const n=act?.count||0;return `<tr><td>${esc(p.ent)}</td><td>${esc(posName(p))}</td><td>${esc(M.shifts[p.shift]||'')}</td><td class="n">${p.count}</td><td class="n ${n>=p.count?'ct-ok':'ct-bad'}">${n}</td><td>${esc(act?.people.join('、')||'')}</td><td>${esc(p.note||'')}</td></tr>`;}).join('');
    const extra=G.actual_staff.filter(a=>!staff.some(p=>p.position_id&&p.position_id===a.position_id));
    const fb=ms.flatMap(c=>c.status==='terminated'?[]:c.feedback.map(f=>`<tr><td>${esc(c.entity_name)}</td><td>${f.type==='cash'?'💰 現金':'🧹 服務'}</td><td>${esc(f.name)}</td><td class="n">${f.type==='cash'&&f.amount?`$${money(f.amount)}`:'—'}</td><td>${esc(M.freq[f.frequency]||'')}${f.times?`，${f.times} 次`:''}</td><td>${esc(f.note||'')}</td></tr>`)).join('');
    const items=ms.flatMap(c=>c.status==='terminated'?[]:c.items.map(i=>`<tr><td>${esc(c.entity_name)}</td><td>${esc(i.name)}</td><td class="n">$${money(i.amount)}${c.tax_type==='inclusive'?' <small class="ct-muted">含稅</small>':''}</td><td>${esc(i.note||'')}</td></tr>`)).join('');
    const same=k=>new Set(live.map(c=>c[k])).size<=1;
    const memRow=c=>`<tr><td>${esc(c.entity_name)}${c.entity_tax_id?`<br><small class="ct-muted">${esc(c.entity_tax_id)}</small>`:''}</td><td>${esc(c.contract_no||'—')}</td><td>${c.start_date} ～ ${c.end_date}<br><small class="ct-muted">${left(c)}</small></td><td><span class="ct-pill ${ST[c.status]}">${esc(c.status_label)}</span></td><td class="n">$${money(c.amounts.gross)}</td>
      ${M.can_edit?`<td style="white-space:nowrap">${c.status!=='terminated'?`<button type="button" class="secondary" data-one="${c.id}">只改這家</button> <button type="button" class="secondary" data-term="${c.id}">解約</button>`:''}${multi?` <button type="button" class="secondary" data-ungroup="${c.id}">移出</button>`:''}${c.status==='draft'?` <button type="button" class="secondary" data-del="${c.id}">刪除草稿</button>`:''}</td>`:''}</tr>`;
    el.innerHTML=`${head(`${G.community_name}｜社區合約`)}
      <div class="ct-bar"><button type="button" class="secondary" id="ctBack">◀ 合約列表</button><span class="ct-pill ${ST[c0.status]}">${esc(c0.status_label)}</span>
        ${M.can_edit?`<span class="ct-acts" style="margin-left:auto">${live.length?`<button type="button" id="ctEdit">✏️ ${multi?'編輯整組':'編輯'}</button><button type="button" class="secondary" id="ctRenew">🔁 ${multi?'整組續約':'續約'}</button>`:''}<button type="button" class="secondary" id="ctMerge">🔗 合併同社區的其他合約</button></span>`:''}</div>
      <div id="ctMergeBox"></div>
      <div class="ct-sec"><h3>基本資料</h3><div class="ct-kv"><div><span>社區</span>${esc(G.community_name)}</div><div><span>合約期間</span>${same('start_date')&&same('end_date')?`${c0.start_date} ～ ${c0.end_date}`:'各家不同（見下表）'}</div><div><span>到期通知</span>${c0.remind_days?`到期前 ${c0.remind_days} 天`:'不提醒'}</div></div>${c0.note?`<p class="ct-muted" style="margin:10px 0 0">備註：${esc(c0.note)}</p>`:''}
        <table class="ct-table" style="margin-top:12px"><thead><tr><th>簽約公司</th><th>合約編號</th><th>期間</th><th>狀態</th><th class="n">每月（含稅）</th>${M.can_edit?'<th></th>':''}</tr></thead><tbody>${ms.map(memRow).join('')}</tbody></table>
        ${ms.filter(c=>c.terminated_at).map(c=>`<p class="ct-muted" style="margin:6px 0 0">${esc(c.entity_name)}：${c.terminated_at} 解約，${esc(c.terminate_reason)}</p>`).join('')}</div>
      <div class="ct-sec"><h3>合約資訊（每月）<small class="ct-muted">${same('tax_type')?(c0.tax_type==='inclusive'?'金額為含稅':'金額為未稅，另加 5% 營業稅'):'各家含稅／未稅不同'}</small></h3><table class="ct-table"><thead><tr><th>簽約公司</th><th>項目</th><th class="n">每月金額</th><th>說明</th></tr></thead><tbody>${items}</tbody><tfoot><tr><td colspan="2"><b>未稅</b></td><td class="n"><b>$${money(G.amounts.net)}</b></td><td></td></tr><tr><td colspan="2">營業稅 5%</td><td class="n">$${money(G.amounts.tax)}</td><td></td></tr><tr><td colspan="2"><b>含稅合計</b></td><td class="n"><b style="color:#A44528">$${money(G.amounts.gross)}</b></td><td class="ct-muted">年約 $${money(G.amounts.gross*12)}</td></tr></tfoot></table></div>
      <div class="ct-sec"><h3>派駐配置<small class="ct-muted">實際人數＝組織架構中駐點在這個社區的人（不含機動）</small></h3>${staff.length?`<table class="ct-table"><thead><tr><th>簽約公司</th><th>職位</th><th>班別</th><th class="n">合約</th><th class="n">實際</th><th>人員</th><th>說明</th></tr></thead><tbody>${staffRows}</tbody></table>`:'<div class="ct-muted">沒有填派駐配置。</div>'}${extra.length?`<p class="ct-muted" style="margin:8px 0 0">合約沒有列、但有派駐：${extra.map(a=>`${esc(a.name)} ${a.count} 人`).join('、')}</p>`:''}</div>
      <div class="ct-sec"><h3>回饋項目</h3>${fb?`<table class="ct-table"><thead><tr><th>簽約公司</th><th>類型</th><th>項目</th><th class="n">金額</th><th>頻率</th><th>說明</th></tr></thead><tbody>${fb}</tbody></table>`:'<div class="ct-muted">沒有回饋項目。</div>'}</div>
      <div class="ct-sec"><h3>買受人與請款</h3><div class="ct-kv"><div><span>買受人（發票抬頭）</span>${esc(c0.client.name||'—')}</div><div><span>統一編號</span>${esc(c0.client.tax_id||'—')}</div><div><span>聯絡人</span>${esc([c0.client.contact,c0.client.phone].filter(Boolean).join(' ')||'—')}</div><div><span>Email</span>${esc(c0.client.email||'—')}</div><div><span>每月請款日</span>${c0.billing.day} 號${c0.billing.in_advance?'（當月請款）':'（次月請款）'}</div><div><span>付款期限</span>${c0.billing.terms_days} 天</div><div><span>發票</span>${{b2b:'三聯式（有統編）',b2c:'二聯式',none:'不開發票'}[c0.billing.invoice_kind]||''}</div></div>${multi?'<p class="ct-muted" style="margin:8px 0 0">每家簽約公司各自開立請款單與發票。</p>':''}</div>
      <div class="ct-sec"><h3>合約附件${M.can_edit?'<span><input type="file" id="ctFile" accept="application/pdf,image/*" multiple style="display:none"><button type="button" class="secondary" id="ctUp" style="padding:5px 12px;min-height:0;margin:0">📎 上傳</button></span>':''}</h3>${G.files.length?G.files.map(f=>`<div style="display:flex;gap:10px;align-items:center;padding:4px 0"><a href="/api/company/contracts/files/${f.id}" target="_blank" rel="noopener">📄 ${esc(f.original)}</a><small class="ct-muted">${multi?`${esc(f.entity_name)}｜`:''}${esc(f.uploaded_by)} ${String(f.created_at).slice(0,10)}</small>${M.can_edit?`<button type="button" class="secondary" data-fdel="${f.id}" style="padding:2px 8px;min-height:0;margin:0">刪除</button>`:''}</div>`).join(''):'<div class="ct-muted">還沒有上傳合約掃描檔。</div>'}</div>
      <details class="ct-sec"><summary style="cursor:pointer;font-weight:700;color:#5F403B">異動紀錄（${G.logs.length}）</summary><table class="ct-table" style="margin-top:8px"><tbody>${G.logs.map(l=>`<tr><td style="white-space:nowrap">${String(l.created_at).slice(0,16).replace('T',' ')}</td><td>${esc(l.actor)}</td>${multi?`<td>${esc(l.entity_name)}</td>`:''}<td>${esc({create:'建立',update:'修改',renew:'續約',terminate:'解約',file:'上傳附件',file_delete:'刪除附件',group:'合約組'}[l.action]||l.action)}</td><td>${esc(l.note)}</td></tr>`).join('')}</tbody></table></details>`;
    const again=()=>detail(el,gid);
    el.querySelector('#ctBack').addEventListener('click',()=>list(el));
    el.querySelector('#ctEdit')?.addEventListener('click',()=>editor(el,{gid}));
    el.querySelector('#ctRenew')?.addEventListener('click',async()=>{const m=prompt(`續約幾個月？（${multi?'每一家都':'新合約'}從原合約到期隔天開始，金額與派駐配置先沿用，之後可以再編輯）`,'12');if(!m)return;try{const r=await api(`/api/company/contracts/group/${gid}/renew`,J('POST',{months:Number(m)}));editor(el,{gid:r.group.group_id});}catch(e){alert(e.message);}});
    el.querySelectorAll('[data-one]').forEach(b=>b.addEventListener('click',()=>editor(el,{id:Number(b.dataset.one),gid})));
    el.querySelectorAll('[data-term]').forEach(b=>b.addEventListener('click',async()=>{const c=ms.find(x=>x.id===Number(b.dataset.term));const reason=prompt(`「${c.entity_name}」解約原因：`);if(!reason)return;const date=prompt('解約生效日（YYYY-MM-DD）：',M.today);if(!date)return;try{await api(`/api/company/contracts/${c.id}/terminate`,J('POST',{reason,date}));again();}catch(e){alert(e.message);}}));
    el.querySelectorAll('[data-ungroup]').forEach(b=>b.addEventListener('click',async()=>{const c=ms.find(x=>x.id===Number(b.dataset.ungroup));if(!confirm(`把「${c.entity_name}」的合約移出這組，變成單獨一份合約？`))return;try{await api(`/api/company/contracts/${c.id}/ungroup`,J('POST',{}));const rest=ms.filter(x=>x.id!==c.id);rest.length?detail(el,c.id===gid?rest[0].id:gid):list(el);}catch(e){alert(e.message);}}));
    el.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('刪除這份草稿？'))return;try{await api(`/api/company/contracts/${b.dataset.del}`,{method:'DELETE'});const rest=ms.filter(x=>x.id!==Number(b.dataset.del));rest.length?detail(el,Number(b.dataset.del)===gid?rest[0].id:gid):list(el);}catch(e){alert(e.message);}}));
    el.querySelector('#ctMerge')?.addEventListener('click',async()=>{
      const box=el.querySelector('#ctMergeBox');if(box.innerHTML){box.innerHTML='';return;}
      const d=await api(`/api/company/contracts?status=all&community_id=${G.community_id}`);const others=d.rows.filter(c=>c.group_id!==gid&&c.status!=='terminated');
      box.innerHTML=`<div class="ct-sec"><h3>合併同社區的其他合約</h3>${others.length?`<p class="ct-muted" style="margin:0 0 8px">勾選要併進這組的合約（例如同一個社區分別跟保全、清潔公司簽的合約）。合併後一起顯示，各家仍各自請款、開發票。</p>${others.map(c=>`<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" value="${c.id}" style="width:auto;margin:0"> ${esc(c.entity_name)}｜${c.start_date} ～ ${c.end_date}｜每月 $${money(c.amounts.gross)}${c.contract_no?`｜${esc(c.contract_no)}`:''} <span class="ct-pill ${ST[c.status]}">${esc(c.status_label)}</span></label>`).join('')}<div class="ct-acts" style="margin-top:8px"><button type="button" id="ctMergeGo">🔗 合併</button></div>`:'<div class="ct-muted">這個社區沒有其他可以合併的合約。</div>'}</div>`;
      box.querySelector('#ctMergeGo')?.addEventListener('click',async()=>{const ids=[...box.querySelectorAll('input:checked')].map(x=>Number(x.value));if(!ids.length)return alert('請勾選要合併的合約');try{const r=await api('/api/company/contracts/group/merge',J('POST',{ids:[ms[0].id,...ids]}));detail(el,r.group.group_id);}catch(e){alert(e.message);}});
    });
    el.querySelector('#ctUp')?.addEventListener('click',()=>el.querySelector('#ctFile').click());
    el.querySelector('#ctFile')?.addEventListener('change',async e=>{const fd=new FormData();for(const f of e.target.files)fd.append('files',f);try{const r=await fetch(`/api/company/contracts/${c0.id}/files`,{method:'POST',credentials:'same-origin',body:fd});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'上傳失敗');again();}catch(err){alert(err.message);}});
    el.querySelectorAll('[data-fdel]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('刪除這個附件？'))return;try{await api(`/api/company/contracts/files/${b.dataset.fdel}`,{method:'DELETE'});again();}catch(e){alert(e.message);}}));
  }
  // 編輯器：{} 新增；{gid} 整組編輯；{id,gid} 只改這一家
  async function editor(el,opt){
    const one=!!opt.id;let ms=[];
    if(opt.id)ms=[(await api(`/api/company/contracts/${opt.id}`)).contract];
    else if(opt.gid)ms=(await api(`/api/company/contracts/group/${opt.gid}`)).group.members.filter(c=>c.status!=='terminated');
    const isNew=!ms.length;const e0=M.entities[0]?.id;
    const c=ms[0]||{community_id:S.cid||M.communities[0]?.id,start_date:M.today,end_date:'',tax_type:'exclusive',remind_days:60,contract_no:'',note:'',client:{},billing:{day:1,terms_days:30,invoice_kind:'b2b',in_advance:true}};
    const withE=(arr,k)=>ms.length?ms.flatMap(m=>(m[k]||[]).map(x=>({...x,entity_id:m.entity_id}))):arr;
    const items=withE([{kind:'property',name:'物業管理服務費',amount:'',entity_id:e0},{kind:'security',name:'保全服務費',amount:'',entity_id:e0},{kind:'cleaning',name:'清潔服務費',amount:'',entity_id:e0}],'items');
    const staffing=withE([],'staffing'),feedback=withE([],'feedback');
    const nos=Object.fromEntries(ms.map(m=>[m.entity_id,m.contract_no||'']));
    const firstNo=ms[0]?.contract_no||'';
    const ENTS=one?M.entities.filter(x=>x.id===c.entity_id):M.entities;
    const K=Object.entries(M.kinds),F=Object.entries(M.freq),SH=Object.entries(M.shifts).filter(([k])=>k);
    const entSel=(v,auto)=>`<select data-f="entity_id"${auto?' data-auto="1"':''}${one?' disabled':''}>${ENTS.map(x=>`<option value="${x.id}" ${Number(v)===x.id?'selected':''}>${esc(x.short_name||x.name)}</option>`).join('')}</select>`;
    const itemRow=(i={})=>`<tr><td>${entSel(i.entity_id??lastEnt())}</td><td><div style="display:flex;gap:6px"><select data-f="kind" style="width:140px;flex:0 0 140px">${K.map(([k,l])=>`<option value="${k}" ${i.kind===k?'selected':''}>${l}</option>`).join('')}</select><input data-f="name" value="${esc(i.name||'')}" placeholder="項目名稱"></div></td><td><input data-f="amount" type="number" min="0" value="${i.amount??''}" placeholder="每月金額"></td><td><input data-f="note" value="${esc(i.note||'')}"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;
    const staffRow=(p={})=>`<tr><td>${entSel(p.entity_id??lastEnt(),!p.entity_id)}</td><td><div style="display:flex;gap:6px"><select data-f="position_id"><option value="">（自訂職位）</option>${M.positions.map(x=>`<option value="${x.id}" ${p.position_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><input data-f="position_name" value="${esc(p.position_id?'':(p.position_name||''))}" placeholder="自訂職位名稱" style="${p.position_id?'display:none':''}"></div></td><td><select data-f="shift"><option value="">—</option>${SH.map(([k,l])=>`<option value="${k}" ${p.shift===k?'selected':''}>${l}</option>`).join('')}</select></td><td><input data-f="count" type="number" min="0" value="${p.count??1}"></td><td><input data-f="note" value="${esc(p.note||'')}"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;
    const fbRow=(f={})=>{const sv=f.type==='service';return `<tr><td>${entSel(f.entity_id??firstEnt())}</td><td><select data-f="type"><option value="cash" ${!sv?'selected':''}>💰 現金</option><option value="service" ${sv?'selected':''}>🧹 服務</option></select></td><td><input data-f="name" value="${esc(f.name||'')}" placeholder="例如：回饋金、特別清潔"></td><td><input data-f="amount" type="number" min="0" value="${sv?0:(f.amount||'')}" placeholder="金額"${sv?' disabled':''}></td><td><select data-f="frequency">${F.map(([k,l])=>`<option value="${k}" ${f.frequency===k?'selected':''}>${l}</option>`).join('')}</select></td><td><input data-f="times" type="number" min="0" value="${f.times||''}" placeholder="次數"></td><td><input data-f="note" value="${esc(f.note||'')}"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;};
    const cl=c.client||{},bl=c.billing||{};
    const title=isNew?'新增社區合約':one?`編輯合約：${esc(c.community_name||'')}｜${esc(c.entity_name||'')}`:`編輯合約：${esc(c.community_name||'')}`;
    el.innerHTML=`${head(title)}
      <div class="ct-bar"><button type="button" class="secondary" id="ctCancel">◀ 取消</button>${one?'<span class="ct-muted">只修改這一家簽約公司的合約，同組其他公司不受影響。</span>':''}</div>
      <div class="ct-sec"><h3>基本資料</h3><div class="ct-form">
        <label class="half">社區<select id="fC" ${isNew?'':'disabled'}>${M.communities.map(x=>`<option value="${x.id}" ${c.community_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="half">合約編號${one?'':' <small class="ct-muted" style="font-weight:400">（第一家簽約公司）</small>'}<input id="fNo" value="${esc(one?c.contract_no||'':firstNo)}"></label>
        <div class="wide" id="noBox" style="display:none"></div>
        <label>開始日<input type="date" id="fS" value="${esc(c.start_date||'')}"></label><label>結束日<input type="date" id="fEnd" value="${esc(c.end_date||'')}"></label><label>到期通知（到期前幾天）<input type="number" id="fR" min="0" max="365" value="${c.remind_days??60}"></label><label>備註<input id="fNote" value="${esc(c.note||'')}"></label></div></div>
      <div class="ct-sec"><h3>合約資訊（每月）<label style="display:flex;gap:14px;font-size:.86rem;font-weight:600"><label style="display:flex;gap:5px;align-items:center"><input type="radio" name="tax" value="exclusive" ${c.tax_type!=='inclusive'?'checked':''} style="width:auto;margin:0"> 未稅（另加 5%）</label><label style="display:flex;gap:5px;align-items:center"><input type="radio" name="tax" value="inclusive" ${c.tax_type==='inclusive'?'checked':''} style="width:auto;margin:0"> 含稅</label></label></h3>
        <table class="ct-table"><thead><tr><th style="width:190px">簽約公司</th><th>項目</th><th style="width:140px">每月金額</th><th>說明</th><th></th></tr></thead><tbody id="tItems">${items.map(itemRow).join('')}</tbody></table><div class="ct-bar"><button type="button" class="secondary" data-add="tItems">＋ 新增項目</button><span id="fTotal" class="ct-muted"></span></div>
        <small class="ct-muted">簽約公司在「會計 → 傳票與帳冊 → 簽約公司」維護。同一社區跟不同公司簽約時，每一列選各自的簽約公司，儲存後會依公司分開請款、開發票。</small></div>
      <div class="ct-sec"><h3>派駐配置</h3><table class="ct-table"><thead><tr><th style="width:190px">簽約公司</th><th>職位</th><th style="width:110px">班別</th><th style="width:80px">人數</th><th>說明</th><th></th></tr></thead><tbody id="tStaff">${staffing.map(staffRow).join('')}</tbody></table><div class="ct-bar"><button type="button" class="secondary" data-add="tStaff">＋ 新增職位</button><span class="ct-muted">選職位後會自動帶入對應的簽約公司（保全→保全費那家、物業／秘書→物業費那家），可以再改。</span></div></div>
      <div class="ct-sec"><h3>回饋項目</h3><table class="ct-table"><thead><tr><th style="width:190px">簽約公司</th><th style="width:110px">類型</th><th>項目</th><th style="width:120px">金額</th><th style="width:100px">頻率</th><th style="width:70px">次數</th><th>說明</th><th></th></tr></thead><tbody id="tFb">${feedback.map(fbRow).join('')}</tbody></table><div class="ct-bar"><button type="button" class="secondary" data-add="tFb">＋ 新增回饋</button><span class="ct-muted">現金回饋會在「社區回饋金」產生應付；服務回饋（例如每季特清）不計金額，列入排程提醒。</span></div></div>
      <div class="ct-sec"><h3>買受人與請款</h3><div class="ct-form">
        <label class="half">買受人（發票抬頭）<input id="cN" value="${esc(cl.name||'')}" placeholder="例如：○○社區管理委員會"></label><label>統一編號<input id="cT" maxlength="8" value="${esc(cl.tax_id||'')}"></label><label>聯絡人<input id="cP" value="${esc(cl.contact||'')}"></label>
        <label>電話<input id="cPh" value="${esc(cl.phone||'')}"></label><label>Email<input id="cEm" value="${esc(cl.email||'')}"></label><label class="half">地址<input id="cA" value="${esc(cl.address||'')}"></label>
        <label>每月請款日<input type="number" id="bD" min="1" max="28" value="${bl.day||1}"></label><label>付款期限（天）<input type="number" id="bT" min="0" max="120" value="${bl.terms_days??30}"></label>
        <label>發票<select id="bI"><option value="b2b" ${bl.invoice_kind==='b2b'?'selected':''}>三聯式（有統編）</option><option value="b2c" ${bl.invoice_kind==='b2c'?'selected':''}>二聯式</option><option value="none" ${bl.invoice_kind==='none'?'selected':''}>不開發票</option></select></label>
        <label>請款月份<select id="bA"><option value="1" ${bl.in_advance!==false?'selected':''}>當月請當月</option><option value="0" ${bl.in_advance===false?'selected':''}>次月請上個月</option></select></label></div></div>
      <div class="ct-acts"><button type="button" id="ctSave">💾 儲存合約</button>${isNew?'<button type="button" class="secondary" id="ctDraft">存成草稿</button>':''}</div>`;
    function firstEnt(){const o=el.querySelector('#tItems')?order():[];return o[0]??lastEnt();}
    function lastEnt(){const s=el.querySelectorAll?.('#tItems [data-f=entity_id]');return s&&s.length?Number(s[s.length-1].value):(one?c.entity_id:e0);}
    // 依合約金額列出現的順序整理簽約公司
    const order=()=>{const o=[];el.querySelectorAll('#tItems tr').forEach(tr=>{const e=Number(tr.querySelector('[data-f=entity_id]').value);if(Number(tr.querySelector('[data-f=amount]').value)>0&&!o.includes(e))o.push(e);});return o;};
    const noBox=()=>{if(one)return;const box=el.querySelector('#noBox');const keep=Object.fromEntries([...box.querySelectorAll('[data-no]')].map(i=>[i.dataset.no,i.value]));const o=order();const rest=o.slice(1);
      box.style.display=rest.length?'':'none';
      box.innerHTML=rest.length?`<div style="font-weight:700;font-size:.86rem;margin-bottom:5px">其他簽約公司的合約編號 <small class="ct-muted" style="font-weight:400">第一家：${esc(entLabel(o[0]))}</small></div><div class="ct-form">${rest.map(e=>`<label class="half">${esc(entLabel(e))}<input data-no="${e}" value="${esc(keep[e]??(nos[e]&&nos[e]!==firstNo?nos[e]:''))}" placeholder="不填，自動延用第一家編號"></label>`).join('')}</div>`:'';};
    const total=()=>{const by={};let s=0;el.querySelectorAll('#tItems tr').forEach(tr=>{const a=Number(tr.querySelector('[data-f=amount]').value)||0;const e=Number(tr.querySelector('[data-f=entity_id]').value);s+=a;if(a)by[e]=(by[e]||0)+a;});const inc=el.querySelector('[name=tax]:checked').value==='inclusive';const g=v=>inc?v:v+Math.round(v*0.05);const net=inc?Math.round(s/1.05):s;
      const parts=Object.entries(by);el.querySelector('#fTotal').textContent=`每月未稅 $${money(net)}、含稅 $${money(g(s))}${parts.length>1?`（${parts.map(([e,v])=>`${entLabel(e)} $${money(g(v))}`).join('、')}）`:''}`;noBox();};
    const kindEnt=k=>{const tr=[...el.querySelectorAll('#tItems tr')].find(t=>t.querySelector('[data-f=kind]').value===k&&Number(t.querySelector('[data-f=amount]').value)>0)||[...el.querySelectorAll('#tItems tr')].find(t=>t.querySelector('[data-f=kind]').value===k);return tr?tr.querySelector('[data-f=entity_id]').value:null;};
    const DEPT={duty:'security',property:'property',secretary:'property',cleaning:'cleaning'};
    const bind=()=>{
      el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{b.closest('tr').remove();total();});
      el.querySelectorAll('#tItems [data-f=kind]').forEach(s=>s.onchange=()=>{const n=s.closest('tr').querySelector('[data-f=name]');if(!n.value||Object.values(M.kinds).includes(n.value))n.value=M.kinds[s.value];});
      el.querySelectorAll('#tStaff [data-f=entity_id]').forEach(s=>s.onchange=()=>{delete s.dataset.auto;});
      el.querySelectorAll('#tStaff [data-f=position_id]').forEach(s=>s.onchange=()=>{const tr=s.closest('tr');tr.querySelector('[data-f=position_name]').style.display=s.value?'none':'';const p=M.positions.find(x=>x.id===s.value);
        if(p?.shift&&!tr.querySelector('[data-f=shift]').value)tr.querySelector('[data-f=shift]').value=p.shift==='day'||p.shift==='night'?p.shift:'';
        const es=tr.querySelector('[data-f=entity_id]');if(!one&&es.dataset.auto&&p){const k=DEPT[p.dept]||(/清潔/.test(p.name)?'cleaning':/保全|警衛/.test(p.name)?'security':'property');const e=kindEnt(k);if(e)es.value=e;}});
      el.querySelectorAll('#tFb [data-f=type]').forEach(s=>s.onchange=()=>{const a=s.closest('tr').querySelector('[data-f=amount]');if(s.value==='service'){a.dataset.keep=a.value;a.value=0;a.disabled=true;}else{a.disabled=false;a.value=a.dataset.keep&&a.dataset.keep!=='0'?a.dataset.keep:'';}});
    };
    el.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{el.querySelector('#'+b.dataset.add).insertAdjacentHTML('beforeend',rows[b.dataset.add]());bind();total();}));
    const rows={tItems:itemRow,tStaff:staffRow,tFb:fbRow};
    el.querySelector('#tItems').addEventListener('input',total);el.querySelector('#tItems').addEventListener('change',total);el.querySelectorAll('[name=tax]').forEach(r=>r.addEventListener('change',total));bind();total();
    el.querySelector('#ctCancel').addEventListener('click',()=>opt.gid?detail(el,opt.gid):list(el));
    const read=sel=>[...el.querySelectorAll(`${sel} tr`)].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-f]')].map(i=>[i.dataset.f,i.dataset.f==='entity_id'?Number(i.value):i.value])));
    const save=async draft=>{const v=s=>el.querySelector(s).value;
      const body={community_id:Number(v('#fC')),contract_no:v('#fNo'),contract_nos:Object.fromEntries([...el.querySelectorAll('[data-no]')].map(i=>[i.dataset.no,i.value])),start_date:v('#fS'),end_date:v('#fEnd'),remind_days:Number(v('#fR')),note:v('#fNote'),tax_type:el.querySelector('[name=tax]:checked').value,
        items:read('#tItems'),staffing:read('#tStaff').map(p=>({...p,position_name:p.position_id?(M.positions.find(x=>x.id===p.position_id)?.name||''):p.position_name})),feedback:read('#tFb').map(f=>f.type==='service'?{...f,amount:0}:f),
        client:{name:v('#cN'),tax_id:v('#cT'),contact:v('#cP'),phone:v('#cPh'),email:v('#cEm'),address:v('#cA')},billing:{day:Number(v('#bD')),terms_days:Number(v('#bT')),invoice_kind:v('#bI'),in_advance:v('#bA')==='1'},draft};
      if(one)body.entity_id=c.entity_id;
      const go=async extra=>{const b={...body,...extra};if(one){await api(`/api/company/contracts/${c.id}`,J('PUT',b));return opt.gid||c.group_id;}const r=isNew?await api('/api/company/contracts/group',J('POST',b)):await api(`/api/company/contracts/group/${opt.gid}`,J('PUT',b));return r.group.group_id;};
      try{detail(el,await go({}));}
      catch(e){if(e.status===409&&confirm(`${e.message}\n\n仍要儲存嗎？`)){try{detail(el,await go({allow_overlap:true}));}catch(x){alert(x.message);}}else alert(e.message);}};
    el.querySelector('#ctSave').addEventListener('click',()=>save(false));el.querySelector('#ctDraft')?.addEventListener('click',()=>save(true));
  }
  window.ContractsModule={render:async(el,label)=>{S.view='list';S.gid=null;return render(el,label);}};
})();
