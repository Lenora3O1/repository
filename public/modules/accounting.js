// 會計 → 傳票與帳冊：傳票、帳冊報表（試算表／總分類帳／損益表／資產負債表）、會計科目、簽約公司、月結關帳、傳票匯出
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const fm=v=>{const n=Number(v)||0;if(!n)return '';const s=Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2});return n<0?`(${s})`:s;};
  const fz=v=>{const n=Number(v)||0;const s=Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2});return n<0?`(${s})`:s;};
  function injectStyle(){
    if(document.getElementById('acStyle'))return;
    const s=document.createElement('style');s.id='acStyle';
    s.textContent=`
.ac-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}.ac-tabs button{padding:7px 14px;min-height:0;margin:0}
.ac-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.ac-bar select,.ac-bar input{width:auto;margin:0;padding:7px 10px}.ac-bar button{padding:7px 14px;min-height:0;margin:0}
.ac-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px;background:#fff}
.ac-t{width:100%;border-collapse:collapse;font-size:.86rem}.ac-t th,.ac-t td{padding:7px 9px;border-bottom:1px solid #F1E7E1;text-align:left;vertical-align:middle}.ac-t th{background:#F6ECE6;font-size:.78rem;color:#5F403B;white-space:nowrap;position:sticky;top:0}
.ac-t td.n,.ac-t th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ac-t tr.click{cursor:pointer}.ac-t tr.click:hover td{background:#FCFAF1}.ac-t tr.void td{color:#aaa;text-decoration:line-through}
.ac-t tr.sec td{background:#FCFAF1;font-weight:800;color:#5F403B}.ac-t tr.tot td{font-weight:800;border-top:2px solid #5F403B}.ac-t tr.grand td{font-weight:900;background:#F6ECE6}
.ac-t input,.ac-t select{margin:0;width:100%;box-sizing:border-box;padding:6px 7px;border:1px solid #DDCCC4;border-radius:7px;font:inherit}.ac-t td button{padding:3px 9px;min-height:0;margin:0}
.ac-pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.72rem;font-weight:800;background:#F6ECE6;color:#9A6654;white-space:nowrap}.ac-pill.r{background:#E8EEDF;color:#3E5328}.ac-pill.p{background:#F6E3DC;color:#7A2E1A}.ac-pill.x{background:#eee;color:#888}
.ac-note{background:#F6ECE6;border:1px solid #E2D3CC;border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:.88rem;color:#5F403B;line-height:1.7}
.ac-ok{color:#3E5328;font-weight:800}.ac-bad{color:#A44528;font-weight:800}.ac-muted{color:#9A6654;font-size:.82rem}
.ac-modal-bg{position:fixed;inset:0;background:rgba(29,13,12,.42);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:30px 12px;overflow:auto}
.ac-modal{background:#fff;border-radius:16px;max-width:1080px;width:100%;padding:20px 22px;position:relative;box-shadow:0 20px 50px rgba(0,0,0,.25)}.ac-modal h3{margin:0 0 10px;color:#5F403B}.ac-modal .x{position:absolute;right:12px;top:8px;background:none;border:0;font-size:1.5rem;color:#5F403B;cursor:pointer;min-height:0;padding:4px 8px}
.ac-modal .foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center}
.ac-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 14px}.ac-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}.ac-form input,.ac-form select{margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #DDCCC4;border-radius:8px;font:inherit}.ac-form .wide{grid-column:1/-1}.ac-form .half{grid-column:span 2}
.ac-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.ac-month{border:1px solid #E2D3CC;border-radius:12px;padding:10px 12px;background:#fff}.ac-month.closed{background:#F6ECE6}.ac-month b{font-size:1rem}.ac-month button{padding:4px 10px;min-height:0;margin:6px 0 0}
.ac-print-head{display:none}
@media print{body.ac-printing *{visibility:hidden}body.ac-printing #acPrint,body.ac-printing #acPrint *{visibility:visible}body.ac-printing #acPrint{position:absolute;left:0;top:0;width:100%}body.ac-printing .ac-print-head{display:block;text-align:center;margin-bottom:8px}body.ac-printing .ac-t th{position:static}}
@media(max-width:760px){.ac-form{grid-template-columns:1fr 1fr}.ac-form .half{grid-column:1/-1}}
`;document.head.appendChild(s);
  }
  function modal(title,html){const bg=document.createElement('div');bg.className='ac-modal-bg';bg.innerHTML=`<div class="ac-modal"><button type="button" class="x">×</button><h3>${title}</h3>${html}</div>`;document.body.appendChild(bg);const close=()=>bg.remove();bg.querySelector('.x').onclick=close;return {box:bg.querySelector('.ac-modal'),close};}
  const S={tab:'vouchers',rep:'trial',eid:null,from:'',to:'',q:'',source:'',status:'',acc:null,by:'',year:''};
  let M=null;
  const TP={receipt:'r',payment:'p',transfer:''};
  async function render(el,label){
    injectStyle();M=await api('/api/company/acct/meta');
    if(!S.eid||!M.entities.some(e=>e.id===S.eid))S.eid=M.entities[0]?.id;
    if(!S.from){S.from=`${M.today.slice(0,7)}-01`;S.to=M.today;S.year=M.today.slice(0,4);}
    const tabs=[['vouchers','🧾 傳票'],['reports','📊 帳冊報表'],['accounts','📚 會計科目'],['entities','🏢 簽約公司'],['periods','🔒 月結關帳'],['export','📤 匯出給會計師']];
    el.innerHTML=`<div class="eyebrow">💰 會計</div><h1>${esc(label||'傳票與帳冊')}</h1>
      <div class="ac-tabs">${tabs.map(([k,l])=>`<button type="button" data-tab="${k}" class="${S.tab===k?'':'secondary'}">${l}</button>`).join('')}</div>
      ${M.entities.length>1&&!['accounts','entities'].includes(S.tab)?`<div class="ac-bar"><b>公司別</b><select id="acE">${M.entities.map(e=>`<option value="${e.id}" ${e.id===S.eid?'selected':''}>${esc(e.short_name||e.name)}${e.tax_id?`（${e.tax_id}）`:''}</option>`).join('')}</select></div>`:''}
      <div id="acBody"><div class="profile-loading">正在讀取資料中，請稍候…</div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{S.tab=b.dataset.tab;render(el,label).catch(e=>alert(e.message));}));
    el.querySelector('#acE')?.addEventListener('change',e=>{S.eid=Number(e.target.value);render(el,label);});
    const box=el.querySelector('#acBody');const again=()=>render(el,label);
    return ({vouchers,reports,accounts,entities,periods,exporter})[S.tab==='export'?'exporter':S.tab](box,again);
  }
  const range=()=>`<input type="date" id="acF" value="${S.from}"> ～ <input type="date" id="acT" value="${S.to}"><select id="acQuick"><option value="">快速選擇</option><option value="m0">本月</option><option value="m1">上個月</option><option value="q">本季</option><option value="y">今年</option><option value="ly">去年</option></select>`;
  function bindRange(box,re){
    box.querySelector('#acF').onchange=e=>{S.from=e.target.value;re();};box.querySelector('#acT').onchange=e=>{S.to=e.target.value;re();};
    box.querySelector('#acQuick').onchange=e=>{const t=M.today,y=Number(t.slice(0,4)),m=Number(t.slice(5,7));const last=(yy,mm)=>new Date(Date.UTC(yy,mm,0)).toISOString().slice(0,10);const p=n=>String(n).padStart(2,'0');
      if(e.target.value==='m0'){S.from=`${y}-${p(m)}-01`;S.to=last(y,m);}if(e.target.value==='m1'){const yy=m===1?y-1:y,mm=m===1?12:m-1;S.from=`${yy}-${p(mm)}-01`;S.to=last(yy,mm);}
      if(e.target.value==='q'){const q0=Math.floor((m-1)/3)*3+1;S.from=`${y}-${p(q0)}-01`;S.to=last(y,q0+2);}if(e.target.value==='y'){S.from=`${y}-01-01`;S.to=`${y}-12-31`;}if(e.target.value==='ly'){S.from=`${y-1}-01-01`;S.to=`${y-1}-12-31`;}re();};
  }

  // ---------- 傳票 ----------
  async function vouchers(box,again){
    const qs=new URLSearchParams({entity_id:S.eid,from:S.from,to:S.to});if(S.q)qs.set('q',S.q);if(S.source)qs.set('source',S.source);if(S.status)qs.set('status',S.status);
    const d=await api(`/api/company/acct/vouchers?${qs}`);const tot=d.rows.filter(v=>v.status==='posted').reduce((s,v)=>s+v.total,0);
    box.innerHTML=`<div class="ac-bar">${range()}<input id="acQ" placeholder="🔍 傳票號碼、摘要、對象" value="${esc(S.q)}"><select id="acS"><option value="">全部來源</option>${Object.entries(M.sources).map(([k,l])=>`<option value="${k}" ${S.source===k?'selected':''}>${l}</option>`).join('')}</select><select id="acV"><option value="">有效傳票</option><option value="void" ${S.status==='void'?'selected':''}>已作廢</option><option value="all" ${S.status==='all'?'selected':''}>全部</option></select><button type="button" id="acNew">＋ 開立傳票</button></div>
      <div class="ac-muted" style="margin-bottom:6px">共 ${d.rows.length} 張，金額合計 ${fz(tot)}</div>
      ${d.rows.length?`<div class="ac-wrap"><table class="ac-t"><thead><tr><th>日期</th><th>傳票號碼</th><th>類別</th><th>摘要</th><th>科目</th><th class="n">金額</th><th>來源</th><th>開立人</th></tr></thead><tbody>${d.rows.map(v=>`<tr class="click${v.status==='void'?' void':''}" data-v="${v.id}"><td>${v.date}</td><td><b>${v.no}</b></td><td><span class="ac-pill ${TP[v.type]}">${esc(v.type_label)}</span></td><td>${esc(v.summary)}</td><td class="ac-muted">${esc([...new Set(v.lines.map(l=>l.account_name))].slice(0,3).join('、'))}</td><td class="n">${fz(v.total)}</td><td>${esc(v.source_label)}${v.closed?' 🔒':''}</td><td>${esc(v.created_by)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">這段期間沒有傳票。</div>'}`;
    const re=()=>vouchers(box,again).catch(e=>alert(e.message));bindRange(box,re);
    const q=box.querySelector('#acQ');q.onkeydown=e=>{if(e.key==='Enter'){S.q=q.value;re();}};q.onchange=()=>{S.q=q.value;re();};
    box.querySelector('#acS').onchange=e=>{S.source=e.target.value;re();};box.querySelector('#acV').onchange=e=>{S.status=e.target.value;re();};
    box.querySelector('#acNew').onclick=()=>voucherEditor(null,re);
    box.querySelectorAll('[data-v]').forEach(r=>r.onclick=()=>voucherView(Number(r.dataset.v),re));
  }
  async function voucherView(id,done){
    const {voucher:v,logs}=await api(`/api/company/acct/vouchers/${id}`);
    const {box,close}=modal(`${esc(v.type_label)}　${v.no}`,`<div class="ac-muted">日期 ${v.date}｜${esc(v.source_label)}｜開立 ${esc(v.created_by)} ${String(v.created_at).slice(0,16).replace('T',' ')}${v.updated_by?`｜修改 ${esc(v.updated_by)}`:''}${v.status==='void'?`<br><b class="ac-bad">已作廢</b>：${esc(v.void_reason)}（${esc(v.void_by)}）`:''}${v.closed?'<br>🔒 這個月份已經關帳':''}</div>
      <p style="margin:8px 0"><b>摘要：</b>${esc(v.summary||'—')}</p>
      <div class="ac-wrap"><table class="ac-t"><thead><tr><th>#</th><th>科目</th><th>說明</th><th>社區</th><th>對象</th><th class="n">借方</th><th class="n">貸方</th></tr></thead><tbody>${v.lines.map(l=>`<tr><td>${l.line_no}</td><td>${esc(l.code)} ${esc(l.account_name)}</td><td>${esc(l.memo)}</td><td>${esc(l.community_name)}</td><td>${esc(l.party)}${l.party_tax_id?` <small>${esc(l.party_tax_id)}</small>`:''}</td><td class="n">${fm(l.debit)}</td><td class="n">${fm(l.credit)}</td></tr>`).join('')}<tr class="tot"><td colspan="5">合計</td><td class="n">${fz(v.total)}</td><td class="n">${fz(v.total)}</td></tr></tbody></table></div>
      ${logs.length?`<details style="margin-top:8px"><summary class="ac-muted" style="cursor:pointer">異動紀錄</summary>${logs.map(l=>`<div class="ac-muted">${String(l.created_at).slice(0,16).replace('T',' ')} ${esc(l.actor)}：${esc(l.note)}</div>`).join('')}</details>`:''}
      <div class="foot">${v.editable?'<button type="button" class="secondary" id="vVoid">作廢</button><button type="button" id="vEdit">✏️ 修改</button>':''}${!v.editable&&v.status==='posted'&&v.source==='adjust'&&!v.closed?'<button type="button" class="secondary" id="vVoid">作廢</button>':''}<button type="button" class="secondary" id="vCopy">📋 複製成新傳票</button><button type="button" id="vClose">關閉</button></div>`);
    box.querySelector('#vClose').onclick=close;
    box.querySelector('#vEdit')?.addEventListener('click',()=>{close();voucherEditor(v,done);});
    box.querySelector('#vCopy').onclick=()=>{close();voucherEditor({...v,id:null,no:'',date:M.today},done);};
    box.querySelector('#vVoid')?.addEventListener('click',async()=>{const reason=prompt('作廢原因：');if(!reason)return;try{await api(`/api/company/acct/vouchers/${v.id}/void`,J('POST',{reason}));close();done();}catch(e){alert(e.message);}});
  }
  function voucherEditor(v,done){
    const edit=!!v?.id;const lines=v?.lines?.length?v.lines:[{},{}];
    const accs=M.accounts.filter(a=>a.is_active);
    const accOpts=sel=>`<option value="">選擇科目</option>${Object.entries(M.types).map(([t,l])=>`<optgroup label="${l}">${accs.filter(a=>a.type===t).map(a=>`<option value="${a.id}" ${Number(sel)===a.id?'selected':''}>${a.code} ${esc(a.name)}</option>`).join('')}</optgroup>`).join('')}`;
    const row=(l={})=>`<tr><td><select data-f="account_id">${accOpts(l.account_id)}</select></td><td><input data-f="memo" value="${esc(l.memo||'')}"></td><td><select data-f="community_id"><option value="">—</option>${M.communities.map(c=>`<option value="${c.id}" ${Number(l.community_id)===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></td><td><input data-f="party" value="${esc(l.party||'')}" placeholder="客戶／廠商"></td><td><input data-f="debit" type="number" min="0" step="1" value="${l.debit||''}" style="text-align:right"></td><td><input data-f="credit" type="number" min="0" step="1" value="${l.credit||''}" style="text-align:right"></td><td><button type="button" class="secondary" data-rm>✕</button></td></tr>`;
    const {box,close}=modal(edit?`修改傳票 ${v.no}`:'＋ 開立傳票',`<div class="ac-form" style="margin-bottom:10px"><label>日期<input type="date" id="vD" value="${v?.date||M.today}"></label><label class="half">摘要<input id="vS" maxlength="200" value="${esc(v?.summary||'')}" placeholder="例如：支付 10 月辦公室租金"></label>${M.entities.length>1?`<label>公司別<select id="vE" ${edit?'disabled':''}>${M.entities.map(e=>`<option value="${e.id}" ${(v?.entity_id||S.eid)===e.id?'selected':''}>${esc(e.short_name||e.name)}</option>`).join('')}</select></label>`:''}</div>
      <div class="ac-wrap"><table class="ac-t"><thead><tr><th style="width:26%">會計科目</th><th>說明</th><th style="width:13%">社區（部門）</th><th style="width:13%">對象</th><th style="width:11%" class="n">借方</th><th style="width:11%" class="n">貸方</th><th></th></tr></thead><tbody id="vL">${lines.map(row).join('')}</tbody></table></div>
      <div class="foot" style="justify-content:space-between"><span><button type="button" class="secondary" id="vAdd">＋ 新增分錄</button> <span id="vBal" class="ac-muted"></span></span><span style="display:flex;gap:8px"><button type="button" class="secondary" id="vX">取消</button><button type="button" id="vSave">💾 ${edit?'儲存修改':'過帳'}</button></span></div>
      <p class="ac-muted" style="margin:8px 0 0">傳票類別會自動判斷：只有現金／銀行存款在借方是「收入傳票」、只在貸方是「支出傳票」，其他是「轉帳傳票」。借貸必須平衡才能過帳。</p>`);
    const bal=()=>{let d=0,c=0;box.querySelectorAll('#vL tr').forEach(tr=>{d+=Number(tr.querySelector('[data-f=debit]').value)||0;c+=Number(tr.querySelector('[data-f=credit]').value)||0;});box.querySelector('#vBal').innerHTML=`借方 <b>${fz(d)}</b>　貸方 <b>${fz(c)}</b>　${Math.abs(d-c)<0.005&&d>0?'<span class="ac-ok">✓ 平衡</span>':`<span class="ac-bad">差 ${fz(d-c)}</span>`}`;};
    const bind=()=>{box.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{if(box.querySelectorAll('#vL tr').length>2){b.closest('tr').remove();bal();}});};
    box.querySelector('#vL').addEventListener('input',e=>{const f=e.target.dataset.f;if(f==='debit'&&e.target.value)e.target.closest('tr').querySelector('[data-f=credit]').value='';if(f==='credit'&&e.target.value)e.target.closest('tr').querySelector('[data-f=debit]').value='';bal();});
    box.querySelector('#vAdd').onclick=()=>{box.querySelector('#vL').insertAdjacentHTML('beforeend',row({memo:box.querySelector('#vL tr:last-child [data-f=memo]')?.value||''}));bind();};
    box.querySelector('#vX').onclick=close;bind();bal();
    box.querySelector('#vSave').onclick=async()=>{const L=[...box.querySelectorAll('#vL tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-f]')].map(i=>[i.dataset.f,i.value]))).filter(l=>l.account_id&&(Number(l.debit)||Number(l.credit)));
      const body={date:box.querySelector('#vD').value,summary:box.querySelector('#vS').value,entity_id:Number(box.querySelector('#vE')?.value||v?.entity_id||S.eid),lines:L.map(l=>({...l,account_id:Number(l.account_id),debit:Number(l.debit)||0,credit:Number(l.credit)||0}))};
      try{edit?await api(`/api/company/acct/vouchers/${v.id}`,J('PUT',body)):await api('/api/company/acct/vouchers',J('POST',body));close();done();}catch(e){alert(e.message);}};
  }

  // ---------- 帳冊報表 ----------
  async function reports(box,again){
    const R=[['trial','試算表'],['ledger','總分類帳'],['income','損益表'],['balance','資產負債表']];
    const ent=M.entities.find(e=>e.id===S.eid)||{};
    let html='',title='';const qs=new URLSearchParams({entity_id:S.eid,from:S.from,to:S.to});
    if(S.rep==='trial'){const d=await api(`/api/company/acct/reports/trial?${qs}`);title=`試算表　${S.from} ～ ${S.to}`;
      let cur='';html=`<table class="ac-t"><thead><tr><th>科目</th><th class="n">期初餘額</th><th class="n">本期借方</th><th class="n">本期貸方</th><th class="n">期末餘額</th></tr></thead><tbody>${d.rows.map(r=>{const h=r.type!==cur?`<tr class="sec"><td colspan="5">${esc(r.type_label)}</td></tr>`:'';cur=r.type;return `${h}<tr class="click" data-acc="${r.account_id}"><td>${esc(r.code)} ${esc(r.name)}</td><td class="n">${fm(r.opening)}</td><td class="n">${fm(r.debit)}</td><td class="n">${fm(r.credit)}</td><td class="n">${fm(r.closing)}</td></tr>`;}).join('')}<tr class="grand"><td>合計</td><td></td><td class="n">${fz(d.total.debit)}</td><td class="n">${fz(d.total.credit)}</td><td class="n">${d.balanced?'<span class="ac-ok">借貸平衡</span>':'<span class="ac-bad">不平衡</span>'}</td></tr></tbody></table>`;}
    if(S.rep==='ledger'){const accs=M.accounts;if(!S.acc)S.acc=accs.find(a=>a.sys_key==='bank')?.id||accs[0]?.id;qs.set('account_id',S.acc);const d=await api(`/api/company/acct/reports/ledger?${qs}`);title=`總分類帳　${d.account.code} ${d.account.name}　${S.from} ～ ${S.to}`;
      html=`<table class="ac-t"><thead><tr><th>日期</th><th>傳票號碼</th><th>摘要</th><th>社區</th><th>對象</th><th class="n">借方</th><th class="n">貸方</th><th class="n">餘額</th></tr></thead><tbody><tr class="sec"><td colspan="7">期初餘額</td><td class="n">${fz(d.opening)}</td></tr>${d.rows.map(r=>`<tr class="click" data-vid="${r.voucher_id}"><td>${r.date}</td><td>${r.no}</td><td>${esc(r.summary)}</td><td>${esc(r.community_name)}</td><td>${esc(r.party)}</td><td class="n">${fm(r.debit)}</td><td class="n">${fm(r.credit)}</td><td class="n">${fz(r.balance)}</td></tr>`).join('')}<tr class="grand"><td colspan="5">本期合計／期末餘額</td><td class="n">${fz(d.debit)}</td><td class="n">${fz(d.credit)}</td><td class="n">${fz(d.closing)}</td></tr></tbody></table>`;}
    if(S.rep==='income'){if(S.by)qs.set('by','community');const d=await api(`/api/company/acct/reports/income?${qs}`);title=`損益表　${S.from} ～ ${S.to}`;const cols=d.columns;
      const sec=(t,label)=>{const L=d.sections[t];if(!L.length)return '';return `<tr class="sec"><td colspan="${2+cols.length}">${label}</td></tr>${L.map(x=>`<tr><td>${esc(x.code)} ${esc(x.name)}</td>${cols.map(c=>`<td class="n">${fm(x.by[c.id])}</td>`).join('')}<td class="n">${fz(x.total)}</td></tr>`).join('')}`;};
      const tot=(k,label,cls='tot')=>`<tr class="${cls}"><td>${label}</td>${cols.map(c=>`<td class="n">${fz(c.totals[k])}</td>`).join('')}<td class="n">${fz(d.totals[k])}</td></tr>`;
      html=`<table class="ac-t"><thead><tr><th>項目</th>${cols.map(c=>`<th class="n">${esc(c.name)}</th>`).join('')}<th class="n">合計</th></tr></thead><tbody>${sec('revenue','營業收入')}${tot('revenue','營業收入合計')}${sec('cost','營業成本')}${tot('cost','營業成本合計')}${tot('gross','營業毛利','grand')}${sec('expense','營業費用')}${tot('expense','營業費用合計')}${tot('operating','營業淨利','grand')}${sec('other_income','營業外收入')}${sec('other_expense','營業外支出')}${tot('pretax','稅前淨利')}${sec('tax','所得稅')}${tot('net','本期淨利','grand')}</tbody></table>`;}
    if(S.rep==='balance'){const d=await api(`/api/company/acct/reports/balance?${qs}`);title=`資產負債表　${S.to}`;
      const part=(L,label,total)=>`<tr class="sec"><td colspan="2">${label}</td></tr>${L.map(x=>`<tr><td>${x.code?`${esc(x.code)} `:''}${esc(x.name)}</td><td class="n">${fz(x.amount)}</td></tr>`).join('')}<tr class="tot"><td>${label}合計</td><td class="n">${fz(total)}</td></tr>`;
      html=`<table class="ac-t"><thead><tr><th>項目</th><th class="n">金額</th></tr></thead><tbody>${part(d.asset,'資產',d.total_asset)}${part(d.liability,'負債',d.total_liability)}${part(d.equity,'權益',d.total_equity)}<tr class="grand"><td>負債及權益合計</td><td class="n">${fz(d.total_liability+d.total_equity)} ${d.balanced?'<span class="ac-ok">✓</span>':'<span class="ac-bad">與資產不符</span>'}</td></tr></tbody></table>`;}
    box.innerHTML=`<div class="ac-tabs">${R.map(([k,l])=>`<button type="button" data-rep="${k}" class="${S.rep===k?'':'secondary'}">${l}</button>`).join('')}</div>
      <div class="ac-bar">${S.rep==='balance'?`截至 <input type="date" id="acT" value="${S.to}"><input type="hidden" id="acF" value="${S.from}"><select id="acQuick" style="display:none"></select>`:range()}${S.rep==='ledger'?`<select id="acAcc">${M.accounts.map(a=>`<option value="${a.id}" ${S.acc===a.id?'selected':''}>${a.code} ${esc(a.name)}</option>`).join('')}</select>`:''}${S.rep==='income'?`<label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:600"><input type="checkbox" id="acBy" ${S.by?'checked':''} style="width:auto;margin:0"> 依社區分欄（各案場損益）</label>`:''}<button type="button" class="secondary" id="acPr">🖨 列印</button></div>
      <div id="acPrint"><div class="ac-print-head"><h2 style="margin:0">${esc(ent.name||'')}</h2><div>${esc(title)}</div></div>${S.rep==='trial'?'<div class="ac-muted" style="margin-bottom:6px">點科目可以看總分類帳</div>':''}<div class="ac-wrap">${html}</div></div>`;
    const re=()=>reports(box,again).catch(e=>alert(e.message));bindRange(box,re);
    box.querySelectorAll('[data-rep]').forEach(b=>b.onclick=()=>{S.rep=b.dataset.rep;re();});
    box.querySelector('#acAcc')?.addEventListener('change',e=>{S.acc=Number(e.target.value);re();});
    box.querySelector('#acBy')?.addEventListener('change',e=>{S.by=e.target.checked?'community':'';re();});
    box.querySelectorAll('[data-acc]').forEach(r=>r.onclick=()=>{S.acc=Number(r.dataset.acc);S.rep='ledger';re();});
    box.querySelectorAll('[data-vid]').forEach(r=>r.onclick=()=>voucherView(Number(r.dataset.vid),re));
    box.querySelector('#acPr').onclick=()=>{document.body.classList.add('ac-printing');const off=()=>{document.body.classList.remove('ac-printing');window.removeEventListener('afterprint',off);};window.addEventListener('afterprint',off);window.print();setTimeout(off,1500);};
  }

  // ---------- 會計科目 ----------
  function accounts(box,again){
    const rows=Object.entries(M.types).map(([t,l])=>`<tr class="sec"><td colspan="4">${l}</td></tr>${M.accounts.filter(a=>a.type===t).map(a=>`<tr${a.is_active?'':' class="void"'}><td><b>${esc(a.code)}</b></td><td>${esc(a.name)}${a.sys_key?' <span class="ac-pill" title="系統自動入帳會使用這個科目">系統</span>':''}</td><td class="ac-muted">${esc(a.note||'')}</td><td><button type="button" class="secondary" data-ea="${a.id}">編輯</button></td></tr>`).join('')}`).join('');
    box.innerHTML=`<div class="ac-note">預設科目依《商業會計處理準則》常用科目整理。可以新增、改代號或名稱、停用；已經有傳票使用的科目不能改類別。標「系統」的科目是應收、應支、薪資自動入帳會用到的，可以改代號與名稱，系統仍會認得。</div><div class="ac-bar"><button type="button" id="acAdd">＋ 新增科目</button></div><div class="ac-wrap"><table class="ac-t"><thead><tr><th style="width:110px">代號</th><th>名稱</th><th>說明</th><th style="width:80px"></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    const ed=a=>{const {box:b,close}=modal(a?`編輯科目 ${esc(a.code)}`:'＋ 新增會計科目',`<div class="ac-form"><label>代號<input id="aC" value="${esc(a?.code||'')}"></label><label class="half">名稱<input id="aN" value="${esc(a?.name||'')}"></label><label>類別<select id="aT">${Object.entries(M.types).map(([k,l])=>`<option value="${k}" ${a?.type===k?'selected':''}>${l}</option>`).join('')}</select></label><label class="wide">說明<input id="aD" value="${esc(a?.note||'')}"></label>${a?`<label class="wide" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="aA" ${a.is_active?'checked':''} style="width:auto"> 使用中</label>`:''}</div><div class="foot"><button type="button" class="secondary" id="aX">取消</button><button type="button" id="aS">💾 儲存</button></div>`);
      b.querySelector('#aX').onclick=close;b.querySelector('#aS').onclick=async()=>{const body={code:b.querySelector('#aC').value,name:b.querySelector('#aN').value,type:b.querySelector('#aT').value,note:b.querySelector('#aD').value};if(a)body.is_active=b.querySelector('#aA').checked;try{a?await api(`/api/company/acct/accounts/${a.id}`,J('PUT',body)):await api('/api/company/acct/accounts',J('POST',body));close();again();}catch(e){alert(e.message);}};};
    box.querySelector('#acAdd').onclick=()=>ed(null);box.querySelectorAll('[data-ea]').forEach(x=>x.onclick=()=>ed(M.accounts.find(a=>a.id===Number(x.dataset.ea))));
  }

  // ---------- 簽約公司 ----------
  async function entities(box,again){
    const d=await api('/api/company/acct/entities');
    box.innerHTML=`<div class="ac-note">同一個集團如果有好幾個統編（例如物業公司、保全公司、清潔公司分開），在這裡建立。每家公司的帳本、發票、401 申報資料分開，社區合約要選是哪一家簽的。</div><div class="ac-bar"><button type="button" id="enAdd">＋ 新增公司</button></div>
      <div class="ac-wrap"><table class="ac-t"><thead><tr><th>公司名稱</th><th>統一編號</th><th>稅籍編號</th><th>負責人</th><th>地址／電話</th><th>銀行帳戶</th><th></th></tr></thead><tbody>${d.rows.map(e=>`<tr${e.is_active?'':' class="void"'}><td><b>${esc(e.name)}</b>${e.short_name?`<br><small class="ac-muted">${esc(e.short_name)}</small>`:''}${e.is_default?' <span class="ac-pill r">預設</span>':''}</td><td>${esc(e.tax_id||'—')}</td><td>${esc(e.tax_reg_no||'')}</td><td>${esc(e.owner||'')}</td><td>${esc(e.address||'')}<br><small>${esc(e.phone||'')}</small></td><td>${e.banks.map(b=>`${esc(b.bank)} ${esc(b.branch)} ${esc(b.account)}`).join('<br>')}</td><td><button type="button" class="secondary" data-en="${e.id}">編輯</button></td></tr>`).join('')}</tbody></table></div>`;
    const ed=e=>{const banks=e?.banks?.length?e.banks:[{}];const br=b=>`<tr><td><input data-f="bank" value="${esc(b.bank||'')}" placeholder="銀行"></td><td><input data-f="code" value="${esc(b.code||'')}" placeholder="代碼"></td><td><input data-f="branch" value="${esc(b.branch||'')}" placeholder="分行"></td><td><input data-f="account" value="${esc(b.account||'')}" placeholder="帳號"></td><td><input data-f="name" value="${esc(b.name||'')}" placeholder="戶名"></td></tr>`;
      const {box:b,close}=modal(e?`編輯：${esc(e.name)}`:'＋ 新增簽約公司',`<div class="ac-form"><label class="half">公司名稱<input id="eN" value="${esc(e?.name||'')}"></label><label>簡稱<input id="eS" value="${esc(e?.short_name||'')}"></label><label>統一編號<input id="eT" maxlength="8" value="${esc(e?.tax_id||'')}"></label><label>稅籍編號<input id="eR" value="${esc(e?.tax_reg_no||'')}"></label><label>負責人<input id="eO" value="${esc(e?.owner||'')}"></label><label>電話<input id="eP" value="${esc(e?.phone||'')}"></label><label class="wide">地址<input id="eA" value="${esc(e?.address||'')}"></label>${e?`<label class="half" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="eD" ${e.is_default?'checked':''} style="width:auto"> 設為預設公司</label>${!e.is_default?`<label class="half" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="eX" ${e.is_active?'':'checked'} style="width:auto"> 停用</label>`:''}`:''}</div>
        <p style="margin:12px 0 6px;font-weight:700">銀行帳戶（請款單上顯示的匯款帳戶）</p><div class="ac-wrap"><table class="ac-t"><tbody id="eB">${banks.map(br).join('')}</tbody></table></div><button type="button" class="secondary" id="eBA" style="margin-top:6px;padding:4px 12px;min-height:0">＋ 帳戶</button>
        <div class="foot"><button type="button" class="secondary" id="eC">取消</button><button type="button" id="eSv">💾 儲存</button></div>`);
      b.querySelector('#eBA').onclick=()=>b.querySelector('#eB').insertAdjacentHTML('beforeend',br({}));b.querySelector('#eC').onclick=close;
      b.querySelector('#eSv').onclick=async()=>{const v=s=>b.querySelector(s)?.value;const body={name:v('#eN'),short_name:v('#eS'),tax_id:v('#eT'),tax_reg_no:v('#eR'),owner:v('#eO'),phone:v('#eP'),address:v('#eA'),banks:[...b.querySelectorAll('#eB tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-f]')].map(i=>[i.dataset.f,i.value])))};
        if(e){body.is_default=b.querySelector('#eD').checked;if(b.querySelector('#eX')?.checked)body.is_active=false;}
        try{e?await api(`/api/company/acct/entities/${e.id}`,J('PUT',body)):await api('/api/company/acct/entities',J('POST',body));close();again();}catch(x){alert(x.message);}};};
    box.querySelector('#enAdd').onclick=()=>ed(null);box.querySelectorAll('[data-en]').forEach(x=>x.onclick=()=>ed(d.rows.find(e=>e.id===Number(x.dataset.en))));
  }

  // ---------- 月結 ----------
  async function periods(box,again){
    const d=await api(`/api/company/acct/periods?entity_id=${S.eid}&year=${S.year}`);
    box.innerHTML=`<div class="ac-note">月結關帳後，這個月份的傳票就不能再新增、修改或作廢（系統自動入帳的單據作廢時會改開沖銷傳票到當月）。請依月份順序關帳；要重新開帳只有公司管理員可以操作，且會留下紀錄。</div>
      <div class="ac-bar"><select id="pY">${[0,1,2,3].map(i=>{const y=Number(M.today.slice(0,4))-i;return `<option ${String(y)===S.year?'selected':''}>${y}</option>`;}).join('')}</select></div>
      <div class="ac-cards">${d.rows.map(r=>`<div class="ac-month${r.closed?' closed':''}"><b>${Number(r.period.slice(5))} 月</b> ${r.closed?'🔒':''}<div class="ac-muted">${r.vouchers} 張、${fz(r.total)}</div>${r.closed?`<div class="ac-muted">${esc(r.closed_by)} ${String(r.closed_at).slice(0,10)}</div>${M.is_admin?`<button type="button" class="secondary" data-ro="${r.period}">重新開帳</button>`:''}`:`<button type="button" data-cl="${r.period}">關帳</button>`}</div>`).join('')}</div>`;
    box.querySelector('#pY').onchange=e=>{S.year=e.target.value;periods(box,again);};
    box.querySelectorAll('[data-cl]').forEach(b=>b.onclick=async()=>{if(!confirm(`確定 ${b.dataset.cl} 月結關帳？關帳後這個月的傳票就不能修改。`))return;try{await api('/api/company/acct/periods/close',J('POST',{entity_id:S.eid,period:b.dataset.cl}));periods(box,again);}catch(e){alert(e.message);}});
    box.querySelectorAll('[data-ro]').forEach(b=>b.onclick=async()=>{const reason=prompt('重新開帳原因：');if(!reason)return;try{await api('/api/company/acct/periods/close',J('POST',{entity_id:S.eid,period:b.dataset.ro,reopen:true,reason}));periods(box,again);}catch(e){alert(e.message);}});
  }

  // ---------- 匯出 ----------
  function exporter(box){
    box.innerHTML=`<div class="ac-note">把傳票匯出給會計師事務所（每月或每季）。可以使用的格式由系統總後台依您配合的會計軟體開通；如果事務所的軟體不在清單上，請跟系統管理者聯絡設定。</div>
      <div class="ac-bar">${range()}<select id="xF">${M.formats.map(f=>`<option value="${f.key}" ${f.key===M.default_format?'selected':''}>${esc(f.name)}（${f.file==='xlsx'?'Excel':'CSV'}）</option>`).join('')}</select><button type="button" id="xGo">📤 下載傳票檔</button></div>`;
    bindRange(box,()=>exporter(box));
    box.querySelector('#xGo').onclick=()=>{const qs=new URLSearchParams({entity_id:S.eid,from:S.from,to:S.to,format:box.querySelector('#xF').value});fetch(`/api/company/acct/export?${qs}`,{credentials:'same-origin'}).then(async r=>{if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'匯出失敗');}const cd=r.headers.get('Content-Disposition')||'';const m=/filename\*=UTF-8''([^;]+)/.exec(cd);const name=m?decodeURIComponent(m[1]):'傳票.csv';const n=r.headers.get('X-Export-Count');const note=r.headers.get('X-Export-Note');const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);if(n==='0')alert('這段期間沒有傳票，下載的檔案只有欄位標題。');if(note==='big5-unavailable')alert('伺服器目前無法轉成 Big5，已改用 UTF-8 匯出。');}).catch(e=>alert(e.message));};
  }
  window.AccountingModule={render,style:injectStyle};
})();
