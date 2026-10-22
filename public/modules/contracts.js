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
.ct-table td button{padding:4px 10px;min-height:0;margin:0}
.ct-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 14px}.ct-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.ct-form input,.ct-form select,.ct-form textarea{margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #DDCCC4;border-radius:8px;background:#fff;font:inherit}
.ct-form .wide{grid-column:1/-1}.ct-form .half{grid-column:span 2}
.ct-ok{color:#3E5328;font-weight:700}.ct-bad{color:#A44528;font-weight:700}
.ct-acts{display:flex;gap:8px;flex-wrap:wrap}.ct-acts button{padding:7px 14px;min-height:0;margin:0}
@media(max-width:860px){.ct-card{grid-template-columns:1fr 1fr}.ct-form{grid-template-columns:1fr 1fr}.ct-form .half{grid-column:1/-1}}
`;document.head.appendChild(s);
  }
  const S={status:'current',cid:0,view:'list',id:null};
  let M=null;
  async function render(el,label){
    injectStyle();M=await api('/api/company/contracts/meta');S.label=label||'社區合約';
    if(S.view==='edit')return editor(el,S.id);
    if(S.view==='detail'&&S.id)return detail(el,S.id);
    return list(el);
  }
  const head=(title,sub='')=>`<div class="eyebrow">📄 總務管理</div><h1>${esc(title)}</h1>${sub}`;
  async function list(el){
    S.view='list';
    const qs=new URLSearchParams({status:S.status});if(S.cid)qs.set('community_id',S.cid);
    const d=await api(`/api/company/contracts?${qs}`);
    const card=c=>`<div class="ct-card${c.status==='expiring'?' alert':''}" data-id="${c.id}"><div><h4>${esc(c.community_name)} <span class="ct-pill ${ST[c.status]}">${esc(c.status_label)}</span></h4><small>${esc(c.entity_name)}${c.contract_no?`｜${esc(c.contract_no)}`:''}</small></div>
      <div><small>合約期間</small><div>${c.start_date} ～ ${c.end_date}</div><small>${c.status==='terminated'?`${c.terminated_at} 解約`:c.days_left>=0?`剩 ${c.days_left} 天`:`已過期 ${-c.days_left} 天`}</small></div>
      <div class="ct-amt"><small>每月（含稅）</small><div><b>$${money(c.amounts.gross)}</b></div><small>${c.items.filter(i=>i.amount).map(i=>esc(M.kinds[i.kind]?.replace('服務費','')||i.name)).join('・')}</small></div>
      <div style="text-align:right"><small>派駐 ${c.staffing.reduce((s,x)=>s+x.count,0)} 人</small><br><small>${c.feedback.length?`回饋 ${c.feedback.length} 項`:''}</small></div></div>`;
    el.innerHTML=`${head(S.label)}
      <div class="ct-sum"><div><span>履約中合約</span><b>${d.summary.current} 份</b></div><div><span>每月合約金額（未稅）</span><b>$${money(d.summary.monthly_net)}</b></div><div><span>每月合約金額（含稅）</span><b>$${money(d.summary.monthly_gross)}</b></div><div><span>即將到期</span><b style="color:${d.summary.expiring?'#A44528':'inherit'}">${d.summary.expiring} 份</b></div></div>
      <div class="ct-bar"><select id="ctC"><option value="0">全部社區</option>${M.communities.map(c=>`<option value="${c.id}" ${S.cid===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>${[['current','目前有效'],['expiring','即將到期'],['expired','已到期'],['terminated','已解約'],['all','全部']].map(([k,l])=>`<button type="button" data-st="${k}" class="${S.status===k?'':'secondary'}">${l}</button>`).join('')}${M.can_edit?'<button type="button" id="ctNew" style="margin-left:auto">＋ 新增合約</button>':''}</div>
      ${d.rows.length?`<div class="ct-list">${d.rows.map(card).join('')}</div>`:'<div class="empty">沒有符合的合約。</div>'}`;
    el.querySelector('#ctC').addEventListener('change',e=>{S.cid=Number(e.target.value);list(el);});
    el.querySelectorAll('[data-st]').forEach(b=>b.addEventListener('click',()=>{S.status=b.dataset.st;list(el);}));
    el.querySelector('#ctNew')?.addEventListener('click',()=>editor(el,null));
    el.querySelectorAll('[data-id]').forEach(c=>c.addEventListener('click',()=>detail(el,Number(c.dataset.id))));
  }
  async function detail(el,id){
    S.view='detail';S.id=id;const {contract:c}=await api(`/api/company/contracts/${id}`);
    const posName=p=>p.position_name||M.positions.find(x=>x.id===p.position_id)?.name||p.position_id;
    const staffRows=c.staffing.map(p=>{const act=c.actual_staff.find(a=>a.position_id&&a.position_id===p.position_id);const n=act?.count||0;return `<tr><td>${esc(posName(p))}</td><td>${esc(M.shifts[p.shift]||'')}</td><td class="n">${p.count}</td><td class="n ${n>=p.count?'ct-ok':'ct-bad'}">${n}</td><td>${esc(act?.people.join('、')||'')}</td><td>${esc(p.note||'')}</td></tr>`;}).join('');
    const extra=c.actual_staff.filter(a=>!c.staffing.some(p=>p.position_id&&p.position_id===a.position_id));
    const fb=c.feedback.map(f=>`<tr><td>${f.type==='cash'?'💰 現金':'🧹 服務'}</td><td>${esc(f.name)}</td><td class="n">${f.amount?`$${money(f.amount)}`:''}</td><td>${esc(M.freq[f.frequency]||'')}${f.times?`，${f.times} 次`:''}</td><td>${esc(f.note||'')}</td></tr>`).join('');
    el.innerHTML=`${head(`${c.community_name}｜社區合約`)}
      <div class="ct-bar"><button type="button" class="secondary" id="ctBack">◀ 合約列表</button><span class="ct-pill ${ST[c.status]}">${esc(c.status_label)}</span>${c.status!=='terminated'?`<span class="ct-muted">${c.days_left>=0?`距離到期 ${c.days_left} 天`:`已過期 ${-c.days_left} 天`}</span>`:''}
        ${M.can_edit?`<span class="ct-acts" style="margin-left:auto">${c.status!=='terminated'?'<button type="button" id="ctEdit">✏️ 編輯</button><button type="button" class="secondary" id="ctRenew">🔁 續約</button><button type="button" class="secondary" id="ctTerm">解約</button>':''}${c.status==='draft'?'<button type="button" class="secondary" id="ctDel">刪除草稿</button>':''}</span>`:''}</div>
      <div class="ct-sec"><h3>基本資料</h3><div class="ct-kv"><div><span>社區</span>${esc(c.community_name)}</div><div><span>簽約公司</span>${esc(c.entity_name)}${c.entity_tax_id?`（${esc(c.entity_tax_id)}）`:''}</div><div><span>合約編號</span>${esc(c.contract_no||'—')}</div><div><span>合約期間</span>${c.start_date} ～ ${c.end_date}</div><div><span>到期前提醒</span>${c.remind_days?`${c.remind_days} 天`:'不提醒'}</div>${c.terminated_at?`<div><span>解約</span>${c.terminated_at}：${esc(c.terminate_reason)}</div>`:''}</div>${c.note?`<p class="ct-muted" style="margin:10px 0 0">備註：${esc(c.note)}</p>`:''}</div>
      <div class="ct-sec"><h3>合約金額（每月）<small class="ct-muted">${c.tax_type==='inclusive'?'金額為含稅':'金額為未稅，另加 5% 營業稅'}</small></h3><table class="ct-table"><thead><tr><th>項目</th><th class="n">金額</th><th>說明</th></tr></thead><tbody>${c.items.map(i=>`<tr><td>${esc(i.name)}</td><td class="n">$${money(i.amount)}</td><td>${esc(i.note||'')}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>未稅</b></td><td class="n"><b>$${money(c.amounts.net)}</b></td><td></td></tr><tr><td>營業稅 5%</td><td class="n">$${money(c.amounts.tax)}</td><td></td></tr><tr><td><b>含稅合計</b></td><td class="n"><b style="color:#A44528">$${money(c.amounts.gross)}</b></td><td class="ct-muted">年約 $${money(c.amounts.gross*12)}</td></tr></tfoot></table></div>
      <div class="ct-sec"><h3>派駐配置<small class="ct-muted">實際人數＝組織架構中駐點在這個社區的人（不含機動）</small></h3>${c.staffing.length?`<table class="ct-table"><thead><tr><th>職位</th><th>班別</th><th class="n">合約</th><th class="n">實際</th><th>人員</th><th>說明</th></tr></thead><tbody>${staffRows}</tbody></table>`:'<div class="ct-muted">沒有填派駐配置。</div>'}${extra.length?`<p class="ct-muted" style="margin:8px 0 0">合約沒有列、但有派駐：${extra.map(a=>`${esc(a.name)} ${a.count} 人`).join('、')}</p>`:''}</div>
      <div class="ct-sec"><h3>回饋項目</h3>${c.feedback.length?`<table class="ct-table"><thead><tr><th>類型</th><th>項目</th><th class="n">金額</th><th>頻率</th><th>說明</th></tr></thead><tbody>${fb}</tbody></table>`:'<div class="ct-muted">沒有回饋項目。</div>'}</div>
      <div class="ct-sec"><h3>買受人與請款</h3><div class="ct-kv"><div><span>買受人（發票抬頭）</span>${esc(c.client.name||'—')}</div><div><span>統一編號</span>${esc(c.client.tax_id||'—')}</div><div><span>聯絡人</span>${esc([c.client.contact,c.client.phone].filter(Boolean).join(' ')||'—')}</div><div><span>Email</span>${esc(c.client.email||'—')}</div><div><span>每月請款日</span>${c.billing.day} 號${c.billing.in_advance?'（當月請款）':'（次月請款）'}</div><div><span>付款期限</span>${c.billing.terms_days} 天</div><div><span>發票</span>${{b2b:'三聯式（有統編）',b2c:'二聯式',none:'不開發票'}[c.billing.invoice_kind]||''}</div></div></div>
      <div class="ct-sec"><h3>合約附件${M.can_edit?'<span><input type="file" id="ctFile" accept="application/pdf,image/*" multiple style="display:none"><button type="button" class="secondary" id="ctUp" style="padding:5px 12px;min-height:0;margin:0">📎 上傳</button></span>':''}</h3>${c.files.length?c.files.map(f=>`<div style="display:flex;gap:10px;align-items:center;padding:4px 0"><a href="/api/company/contracts/files/${f.id}" target="_blank" rel="noopener">📄 ${esc(f.original)}</a><small class="ct-muted">${esc(f.uploaded_by)} ${String(f.created_at).slice(0,10)}</small>${M.can_edit?`<button type="button" class="secondary" data-fdel="${f.id}" style="padding:2px 8px;min-height:0;margin:0">刪除</button>`:''}</div>`).join(''):'<div class="ct-muted">還沒有上傳合約掃描檔。</div>'}</div>
      <details class="ct-sec"><summary style="cursor:pointer;font-weight:700;color:#5F403B">異動紀錄（${c.logs.length}）</summary><table class="ct-table" style="margin-top:8px"><tbody>${c.logs.map(l=>`<tr><td style="white-space:nowrap">${String(l.created_at).slice(0,16).replace('T',' ')}</td><td>${esc(l.actor)}</td><td>${esc({create:'建立',update:'修改',renew:'續約',terminate:'解約',file:'上傳附件',file_delete:'刪除附件'}[l.action]||l.action)}</td><td>${esc(l.note)}</td></tr>`).join('')}</tbody></table></details>`;
    el.querySelector('#ctBack').addEventListener('click',()=>list(el));
    el.querySelector('#ctEdit')?.addEventListener('click',()=>editor(el,c.id));
    el.querySelector('#ctRenew')?.addEventListener('click',async()=>{const m=prompt(`續約幾個月？（新合約從 ${c.end_date} 隔天開始，金額與派駐配置先沿用，之後可以再編輯）`,'12');if(!m)return;try{const r=await api(`/api/company/contracts/${c.id}/renew`,J('POST',{months:Number(m)}));editor(el,r.contract.id);}catch(e){alert(e.message);}});
    el.querySelector('#ctTerm')?.addEventListener('click',async()=>{const reason=prompt('解約原因：');if(!reason)return;const date=prompt('解約生效日（YYYY-MM-DD）：',M.today);if(!date)return;try{await api(`/api/company/contracts/${c.id}/terminate`,J('POST',{reason,date}));detail(el,c.id);}catch(e){alert(e.message);}});
    el.querySelector('#ctDel')?.addEventListener('click',async()=>{if(!confirm('刪除這份草稿？'))return;try{await api(`/api/company/contracts/${c.id}`,{method:'DELETE'});list(el);}catch(e){alert(e.message);}});
    el.querySelector('#ctUp')?.addEventListener('click',()=>el.querySelector('#ctFile').click());
    el.querySelector('#ctFile')?.addEventListener('change',async e=>{const fd=new FormData();for(const f of e.target.files)fd.append('files',f);try{const r=await fetch(`/api/company/contracts/${c.id}/files`,{method:'POST',credentials:'same-origin',body:fd});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'上傳失敗');detail(el,c.id);}catch(err){alert(err.message);}});
    el.querySelectorAll('[data-fdel]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('刪除這個附件？'))return;try{await api(`/api/company/contracts/files/${b.dataset.fdel}`,{method:'DELETE'});detail(el,c.id);}catch(e){alert(e.message);}}));
  }
  async function editor(el,id){
    S.view='edit';S.id=id;
    const c=id?(await api(`/api/company/contracts/${id}`)).contract:{community_id:S.cid||M.communities[0]?.id,entity_id:M.entities[0]?.id,start_date:M.today,end_date:'',tax_type:'exclusive',remind_days:60,
      items:[{kind:'property',name:'物業管理服務費',amount:''},{kind:'security',name:'保全服務費',amount:''},{kind:'cleaning',name:'清潔服務費',amount:''}],staffing:[],feedback:[],client:{},billing:{day:1,terms_days:30,invoice_kind:'b2b',in_advance:true}};
    const K=Object.entries(M.kinds),F=Object.entries(M.freq),SH=Object.entries(M.shifts).filter(([k])=>k);
    const itemRow=(i={})=>`<tr><td><select data-f="kind">${K.map(([k,l])=>`<option value="${k}" ${i.kind===k?'selected':''}>${l}</option>`).join('')}</select></td><td><input data-f="name" value="${esc(i.name||'')}" placeholder="項目名稱"></td><td><input data-f="amount" type="number" min="0" value="${i.amount??''}" placeholder="每月金額"></td><td><input data-f="note" value="${esc(i.note||'')}"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;
    const staffRow=(p={})=>`<tr><td><select data-f="position_id"><option value="">（自訂職位）</option>${M.positions.map(x=>`<option value="${x.id}" ${p.position_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></td><td><input data-f="position_name" value="${esc(p.position_id?'':(p.position_name||''))}" placeholder="自訂職位名稱"></td><td><select data-f="shift"><option value="">—</option>${SH.map(([k,l])=>`<option value="${k}" ${p.shift===k?'selected':''}>${l}</option>`).join('')}</select></td><td><input data-f="count" type="number" min="0" value="${p.count??1}"></td><td><input data-f="note" value="${esc(p.note||'')}"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;
    const fbRow=(f={})=>`<tr><td><select data-f="type"><option value="cash" ${f.type!=='service'?'selected':''}>💰 現金</option><option value="service" ${f.type==='service'?'selected':''}>🧹 服務</option></select></td><td><input data-f="name" value="${esc(f.name||'')}" placeholder="例如：回饋金、特別清潔"></td><td><input data-f="amount" type="number" min="0" value="${f.amount||''}" placeholder="金額（服務可填價值）"></td><td><select data-f="frequency">${F.map(([k,l])=>`<option value="${k}" ${f.frequency===k?'selected':''}>${l}</option>`).join('')}</select></td><td><input data-f="times" type="number" min="0" value="${f.times||''}" placeholder="次數"></td><td><input data-f="note" value="${esc(f.note||'')}"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;
    const cl=c.client||{},bl=c.billing||{};
    el.innerHTML=`${head(id?`編輯合約：${esc(c.community_name||'')}`:'新增社區合約')}
      <div class="ct-bar"><button type="button" class="secondary" id="ctCancel">◀ 取消</button></div>
      <div class="ct-sec"><h3>基本資料</h3><div class="ct-form">
        <label class="half">社區<select id="fC">${M.communities.map(x=>`<option value="${x.id}" ${c.community_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="half">簽約公司<select id="fE">${M.entities.map(x=>`<option value="${x.id}" ${c.entity_id===x.id?'selected':''}>${esc(x.name)}${x.tax_id?`（${x.tax_id}）`:''}</option>`).join('')}</select><small class="ct-muted" style="font-weight:400">簽約公司在「會計 → 傳票與帳冊 → 簽約公司」維護</small></label>
        <label>合約編號<input id="fNo" value="${esc(c.contract_no||'')}"></label><label>開始日<input type="date" id="fS" value="${esc(c.start_date||'')}"></label><label>結束日<input type="date" id="fEnd" value="${esc(c.end_date||'')}"></label><label>到期前幾天提醒<input type="number" id="fR" min="0" max="365" value="${c.remind_days??60}"></label>
        <label class="wide">備註<input id="fNote" value="${esc(c.note||'')}"></label></div></div>
      <div class="ct-sec"><h3>合約金額（每月）<label style="display:flex;gap:14px;font-size:.86rem;font-weight:600"><label style="display:flex;gap:5px;align-items:center"><input type="radio" name="tax" value="exclusive" ${c.tax_type!=='inclusive'?'checked':''} style="width:auto;margin:0"> 未稅（另加 5%）</label><label style="display:flex;gap:5px;align-items:center"><input type="radio" name="tax" value="inclusive" ${c.tax_type==='inclusive'?'checked':''} style="width:auto;margin:0"> 含稅</label></label></h3>
        <table class="ct-table"><thead><tr><th style="width:170px">類別</th><th>項目</th><th style="width:150px">每月金額</th><th>說明</th><th></th></tr></thead><tbody id="tItems">${(c.items||[]).map(itemRow).join('')}</tbody></table><div class="ct-bar"><button type="button" class="secondary" data-add="tItems">＋ 新增項目</button><span id="fTotal" class="ct-muted"></span></div></div>
      <div class="ct-sec"><h3>派駐配置</h3><table class="ct-table"><thead><tr><th>職位</th><th>自訂名稱</th><th style="width:110px">班別</th><th style="width:90px">人數</th><th>說明</th><th></th></tr></thead><tbody id="tStaff">${(c.staffing||[]).map(staffRow).join('')}</tbody></table><div class="ct-bar"><button type="button" class="secondary" data-add="tStaff">＋ 新增職位</button></div></div>
      <div class="ct-sec"><h3>回饋項目</h3><table class="ct-table"><thead><tr><th style="width:120px">類型</th><th>項目</th><th style="width:140px">金額</th><th style="width:110px">頻率</th><th style="width:80px">次數</th><th>說明</th><th></th></tr></thead><tbody id="tFb">${(c.feedback||[]).map(fbRow).join('')}</tbody></table><div class="ct-bar"><button type="button" class="secondary" data-add="tFb">＋ 新增回饋</button><span class="ct-muted">現金回饋會在「社區回饋金」產生應付；服務回饋（例如每季特清）會列入排程提醒。</span></div></div>
      <div class="ct-sec"><h3>買受人與請款</h3><div class="ct-form">
        <label class="half">買受人（發票抬頭）<input id="cN" value="${esc(cl.name||'')}" placeholder="例如：○○社區管理委員會"></label><label>統一編號<input id="cT" maxlength="8" value="${esc(cl.tax_id||'')}"></label><label>聯絡人<input id="cP" value="${esc(cl.contact||'')}"></label>
        <label>電話<input id="cPh" value="${esc(cl.phone||'')}"></label><label>Email<input id="cEm" value="${esc(cl.email||'')}"></label><label class="half">地址<input id="cA" value="${esc(cl.address||'')}"></label>
        <label>每月請款日<input type="number" id="bD" min="1" max="28" value="${bl.day||1}"></label><label>付款期限（天）<input type="number" id="bT" min="0" max="120" value="${bl.terms_days??30}"></label>
        <label>發票<select id="bI"><option value="b2b" ${bl.invoice_kind==='b2b'?'selected':''}>三聯式（有統編）</option><option value="b2c" ${bl.invoice_kind==='b2c'?'selected':''}>二聯式</option><option value="none" ${bl.invoice_kind==='none'?'selected':''}>不開發票</option></select></label>
        <label>請款月份<select id="bA"><option value="1" ${bl.in_advance!==false?'selected':''}>當月請當月</option><option value="0" ${bl.in_advance===false?'selected':''}>次月請上個月</option></select></label></div></div>
      <div class="ct-acts"><button type="button" id="ctSave">💾 儲存合約</button>${id?'':'<button type="button" class="secondary" id="ctDraft">存成草稿</button>'}</div>`;
    const rows={tItems:itemRow,tStaff:staffRow,tFb:fbRow};
    const total=()=>{const s=[...el.querySelectorAll('#tItems tr')].reduce((a,tr)=>a+(Number(tr.querySelector('[data-f=amount]').value)||0),0);const inc=el.querySelector('[name=tax]:checked').value==='inclusive';const net=inc?Math.round(s/1.05):s,gross=inc?s:s+Math.round(s*0.05);el.querySelector('#fTotal').textContent=`每月未稅 $${money(net)}、含稅 $${money(gross)}`;};
    const bind=()=>{el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{b.closest('tr').remove();total();});el.querySelectorAll('#tItems [data-f=kind]').forEach(s=>s.onchange=()=>{const n=s.closest('tr').querySelector('[data-f=name]');if(!n.value||Object.values(M.kinds).includes(n.value))n.value=M.kinds[s.value];});};
    el.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{el.querySelector('#'+b.dataset.add).insertAdjacentHTML('beforeend',rows[b.dataset.add]());bind();}));
    el.querySelector('#tItems').addEventListener('input',total);el.querySelectorAll('[name=tax]').forEach(r=>r.addEventListener('change',total));bind();total();
    el.querySelector('#ctCancel').addEventListener('click',()=>id?detail(el,id):list(el));
    const read=sel=>[...el.querySelectorAll(`${sel} tr`)].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-f]')].map(i=>[i.dataset.f,i.value])));
    const save=async draft=>{const v=s=>el.querySelector(s).value;
      const body={community_id:Number(v('#fC')),entity_id:Number(v('#fE')),contract_no:v('#fNo'),start_date:v('#fS'),end_date:v('#fEnd'),remind_days:Number(v('#fR')),note:v('#fNote'),tax_type:el.querySelector('[name=tax]:checked').value,
        items:read('#tItems'),staffing:read('#tStaff').map(p=>({...p,position_name:p.position_id?(M.positions.find(x=>x.id===p.position_id)?.name||''):p.position_name})),feedback:read('#tFb'),
        client:{name:v('#cN'),tax_id:v('#cT'),contact:v('#cP'),phone:v('#cPh'),email:v('#cEm'),address:v('#cA')},billing:{day:Number(v('#bD')),terms_days:Number(v('#bT')),invoice_kind:v('#bI'),in_advance:v('#bA')==='1'},draft};
      try{const r=id?await api(`/api/company/contracts/${id}`,J('PUT',body)):await api('/api/company/contracts',J('POST',body));detail(el,r.contract.id);}
      catch(e){if(e.status===409&&confirm(`${e.message}\n\n仍要建立嗎？`)){try{const r=await api('/api/company/contracts',J('POST',{...body,allow_overlap:true}));detail(el,r.contract.id);}catch(x){alert(x.message);}}else alert(e.message);}};
    el.querySelector('#ctSave').addEventListener('click',()=>save(false));el.querySelector('#ctDraft')?.addEventListener('click',()=>save(true));
  }
  window.ContractsModule={render:async(el,label)=>{S.view='list';S.id=null;return render(el,label);}};
})();
