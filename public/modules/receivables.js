// 會計 → 公司應收：請款單（依合約產生／手動加開）、開立與發票、收款沖帳、帳齡、銷項明細（401）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const fz=v=>{const n=Number(v)||0;const s=Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2});return n<0?`-${s}`:s;};
  const ST={draft:'d',issued:'w',partial:'w',paid:'ok',void:'x'};
  function style(){if(document.getElementById('arStyle'))return;const s=document.createElement('style');s.id='arStyle';s.textContent=`
.ar-pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.73rem;font-weight:800;white-space:nowrap}.ar-pill.d{background:#F6ECE6;color:#9A6654}.ar-pill.w{background:#fff3e0;color:#a35a00}.ar-pill.ok{background:#E8EEDF;color:#3E5328}.ar-pill.x{background:#eee;color:#888}.ar-pill.red{background:#A44528;color:#fff}
.ar-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px}.ar-sum div{background:#fff;border:1px solid #E2D3CC;border-radius:14px;padding:10px 14px}.ar-sum b{display:block;font-size:1.25rem}.ar-sum span{font-size:.8rem;color:#9A6654}
.ar-items td input,.ar-items td select{margin:0;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #DDCCC4;border-radius:7px;font:inherit}
.ar-alloc{max-height:340px;overflow:auto;border:1px solid #E9E3E1;border-radius:12px;margin-top:8px}
`;document.head.appendChild(s);}
  function modal(title,html){const bg=document.createElement('div');bg.className='ac-modal-bg';bg.innerHTML=`<div class="ac-modal"><button type="button" class="x">×</button><h3>${title}</h3>${html}</div>`;document.body.appendChild(bg);const close=()=>bg.remove();bg.querySelector('.x').onclick=close;return {box:bg.querySelector('.ac-modal'),close};}
  const S={tab:'bills',eid:0,period:'',cid:0,status:'open',q:'',gen:'',agingDate:'',taxPeriod:'',rfrom:'',rto:''};
  let M=null;
  async function render(el,label){
    // 共用「傳票與帳冊」的樣式
    window.AccountingModule?.style?.();
    style();M=await api('/api/company/ar/meta');
    if(!S.eid||!M.entities.some(e=>e.id===S.eid))S.eid=M.entities[0]?.id;if(!S.gen)S.gen=M.today.slice(0,7);if(!S.agingDate)S.agingDate=M.today;
    if(!S.taxPeriod){const m=Number(M.today.slice(5,7));S.taxPeriod=`${M.today.slice(0,4)}-${String(m%2?m:m-1).padStart(2,'0')}`;}
    if(!S.rfrom){S.rfrom=`${M.today.slice(0,7)}-01`;S.rto=M.today;}
    const tabs=[['bills','🧾 請款單'],['receipts','💵 收款'],['aging','⏳ 帳齡'],['sales','📑 銷項明細（401）']];
    el.innerHTML=`<div class="eyebrow">💰 會計</div><h1>${esc(label||'公司應收')}</h1><div class="ac-tabs">${tabs.map(([k,l])=>`<button type="button" data-tab="${k}" class="${S.tab===k?'':'secondary'}">${l}</button>`).join('')}</div>
      ${M.entities.length>1?`<div class="ac-bar"><b>公司別</b><select id="arE">${M.entities.map(e=>`<option value="${e.id}" ${e.id===S.eid?'selected':''}>${esc(e.short_name||e.name)}${e.tax_id?`（${e.tax_id}）`:''}</option>`).join('')}</select></div>`:''}<div id="arBody"><div class="profile-loading">正在讀取資料中，請稍候…</div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;render(el,label).catch(e=>alert(e.message));});
    el.querySelector('#arE')?.addEventListener('change',e=>{S.eid=Number(e.target.value);render(el,label);});
    const box=el.querySelector('#arBody');return ({bills,receipts,aging,sales})[S.tab](box);
  }
  const ent=()=>M.entities.find(e=>e.id===S.eid)||M.entities[0];

  // ---------- 請款單 ----------
  async function bills(box){
    const qs=new URLSearchParams({entity_id:S.eid});if(S.period)qs.set('period',S.period);if(S.cid)qs.set('community_id',S.cid);if(S.status&&S.status!=='all')qs.set('status',S.status);if(S.q)qs.set('q',S.q);
    const d=await api(`/api/company/ar/bills?${qs}`);
    const G=[['draft','未開立'],['open','待收款'],['overdue','逾期'],['paid','已收款'],['void','已作廢'],['all','全部']];
    box.innerHTML=`<div class="ar-sum"><div><span>請款金額（含稅）</span><b>$${fz(d.total.gross)}</b></div><div><span>已收</span><b>$${fz(d.total.paid)}</b></div><div><span>未收</span><b style="color:#A44528">$${fz(d.total.outstanding)}</b></div></div>
      <div class="ac-bar"><b>依合約產生</b><input type="month" id="gM" value="${S.gen}"><button type="button" id="gGo">⚙️ 產生請款單</button><span style="flex:1"></span><button type="button" class="secondary" id="bNew">＋ 手動加開</button></div>
      <div class="ac-bar"><input type="month" id="fP" value="${S.period}" title="服務月份"><select id="fC"><option value="0">全部社區</option>${M.communities.map(c=>`<option value="${c.id}" ${S.cid===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>${G.map(([k,l])=>`<button type="button" data-st="${k}" class="${S.status===k?'':'secondary'}" style="border-radius:999px">${l}</button>`).join('')}<input id="fQ" placeholder="🔍 單號、發票、買受人" value="${esc(S.q)}"></div>
      ${S.status==='draft'&&d.rows.length?`<div class="ac-bar"><label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:600"><input type="checkbox" id="bAll" style="width:auto;margin:0"> 全選</label><select id="bType">${Object.entries(M.invoice_types).filter(([k])=>k!=='none').map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}<option value="none">不開發票</option></select><button type="button" id="bBatch">✅ 批次開立勾選的請款單</button><span class="ac-muted">手開或外部電子發票會先開立入帳，發票號碼之後再補登</span></div>`:''}
      ${d.rows.length?`<div class="ac-wrap"><table class="ac-t"><thead><tr>${S.status==='draft'?'<th></th>':''}<th>請款單號</th><th>社區／買受人</th><th>服務月份</th><th>請款日</th><th>到期日</th><th class="n">含稅金額</th><th class="n">未收</th><th>發票</th><th>狀態</th></tr></thead><tbody>${d.rows.map(b=>`<tr class="click${b.status==='void'?' void':''}" data-b="${b.id}">${S.status==='draft'?`<td><input type="checkbox" data-pick="${b.id}" style="width:auto;margin:0"></td>`:''}<td><b>${esc(b.bill_no)}</b></td><td>${esc(b.community_name||'—')}<br><small class="ac-muted">${esc(b.client.name||'')}</small></td><td>${esc(b.period||'')}${b.prorate?'<br><small class="ac-muted">按日計</small>':''}</td><td>${b.bill_date}</td><td>${b.due_date}</td><td class="n">${fz(b.gross)}</td><td class="n">${b.outstanding&&b.status!=='draft'?fz(b.outstanding):''}</td><td>${b.invoice_no?esc(b.invoice_no):b.status!=='draft'&&['paper','e_manual'].includes(b.invoice_type)?'<span class="ar-pill w">待補登</span>':esc(b.invoice_type==='none'?'不開':'')}</td><td><span class="ar-pill ${ST[b.status]}">${esc(b.status_label)}</span>${b.overdue?` <span class="ar-pill red">逾期 ${b.overdue} 天</span>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">沒有符合的請款單。</div>'}`;
    const re=()=>bills(box).catch(e=>alert(e.message));
    box.querySelector('#gM').onchange=e=>{S.gen=e.target.value;};
    box.querySelector('#gGo').onclick=async()=>{try{const r=await api('/api/company/ar/generate',J('POST',{period:S.gen,entity_id:S.eid}));alert(`已產生 ${r.made.length} 張 ${S.gen} 的請款單（未開立）。${r.skipped.length?`\n略過 ${r.skipped.length} 份：${r.skipped.map(x=>`${x.community}（${x.reason}）`).join('、')}`:''}${!r.contracts?'\n這個月份沒有有效的社區合約。':''}`);S.status='draft';S.period=S.gen;re();}catch(e){alert(e.message);}};
    box.querySelector('#bNew').onclick=()=>billEditor(null,re);
    box.querySelector('#fP').onchange=e=>{S.period=e.target.value;re();};box.querySelector('#fC').onchange=e=>{S.cid=Number(e.target.value);re();};
    box.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{S.status=b.dataset.st;re();});
    const q=box.querySelector('#fQ');q.onchange=()=>{S.q=q.value;re();};
    box.querySelectorAll('[data-pick]').forEach(c=>c.onclick=e=>e.stopPropagation());
    box.querySelector('#bAll')?.addEventListener('change',e=>box.querySelectorAll('[data-pick]').forEach(c=>c.checked=e.target.checked));
    box.querySelector('#bBatch')?.addEventListener('click',async()=>{const ids=[...box.querySelectorAll('[data-pick]:checked')].map(c=>Number(c.dataset.pick));if(!ids.length){alert('請勾選請款單');return;}if(!confirm(`開立 ${ids.length} 張請款單並入帳？`))return;try{const r=await api('/api/company/ar/bills/issue-batch',J('POST',{ids,type:box.querySelector('#bType').value}));alert(`開立 ${r.ok.length} 張${r.fail.length?`，失敗 ${r.fail.length} 張：\n${r.fail.map(f=>`${f.bill_no} ${f.community}：${f.error}`).join('\n')}`:''}`);re();}catch(e){alert(e.message);}});
    box.querySelectorAll('[data-b]').forEach(r=>r.onclick=()=>billView(Number(r.dataset.b),re));
  }
  async function billView(id,done){
    const {bill:b}=await api(`/api/company/ar/bills/${id}`);
    const A={generate:'依合約產生',create:'建立',edit:'修改',issue:'開立入帳',invoice:'登錄發票',void:'作廢',receipt:'收款',receipt_void:'收款作廢'};
    const {box,close}=modal(`請款單 ${esc(b.bill_no)}　<span class="ar-pill ${ST[b.status]}">${esc(b.status_label)}</span>`,`<div class="ac-muted">${esc(b.entity_name)}｜${esc(b.community_name||'')}${b.period?`｜服務月份 ${b.period}`:''}${b.prorate?`（${esc(b.prorate)}）`:''}｜請款日 ${b.bill_date}｜到期 ${b.due_date}${b.overdue?` <b class="ac-bad">逾期 ${b.overdue} 天</b>`:''}</div>
      <p style="margin:8px 0"><b>買受人：</b>${esc(b.client.name||'—')}${b.client.tax_id?`（統編 ${esc(b.client.tax_id)}）`:''}</p>
      <div class="ac-wrap"><table class="ac-t"><thead><tr><th>項目</th><th>說明</th><th class="n">金額（${b.tax_type==='inclusive'?'含稅':b.tax_type==='exempt'?'免稅':'未稅'}）</th></tr></thead><tbody>${b.items.map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.note||'')}</td><td class="n">${fz(i.amount)}</td></tr>`).join('')}<tr class="tot"><td colspan="2">未稅</td><td class="n">${fz(b.net)}</td></tr><tr><td colspan="2">營業稅</td><td class="n">${fz(b.tax)}</td></tr><tr class="grand"><td colspan="2">含稅合計</td><td class="n">${fz(b.gross)}</td></tr>${b.paid?`<tr><td colspan="2">已收</td><td class="n">${fz(b.paid)}</td></tr><tr class="tot"><td colspan="2">未收</td><td class="n">${fz(b.outstanding)}</td></tr>`:''}</tbody></table></div>
      ${b.status!=='draft'?`<p style="margin:10px 0 0"><b>發票：</b>${esc(b.invoice_label)}${b.invoice_no?`　${esc(b.invoice_no)}（${b.invoice_date}）${b.invoice_random?`　隨機碼 ${esc(b.invoice_random)}`:''}${b.invoice_status==='void'?' <span class="ar-pill x">已作廢</span>':''}`:b.invoice_type==='none'?'':'　<span class="ar-pill w">尚未登錄號碼</span>'}</p>`:''}
      ${b.receipts.length?`<p style="margin:8px 0 4px"><b>收款紀錄</b></p>${b.receipts.map(r=>`<div class="ac-muted">${r.date} ${esc(r.method_label)} ${fz(r.amount)}${r.status==='void'?'（已作廢）':''}</div>`).join('')}`:''}
      ${b.void_reason?`<p class="ac-bad">作廢原因：${esc(b.void_reason)}（${esc(b.void_by)}）</p>`:''}
      ${b.note?`<p class="ac-muted">備註：${esc(b.note)}</p>`:''}
      <details style="margin-top:8px"><summary class="ac-muted" style="cursor:pointer">紀錄</summary>${b.logs.map(l=>`<div class="ac-muted">${String(l.created_at).slice(0,16).replace('T',' ')} ${esc(l.actor)}：${esc(A[l.action]||l.action)} ${esc(l.note)}</div>`).join('')}</details>
      <div class="foot">${b.status==='draft'?'<button type="button" class="secondary" id="bDel">刪除</button><button type="button" class="secondary" id="bEdit">✏️ 修改</button><button type="button" id="bIssue">✅ 開立入帳</button>':''}
        ${['issued','partial'].includes(b.status)&&['paper','e_manual'].includes(b.invoice_type)?'<button type="button" class="secondary" id="bInv">🧾 登錄發票號碼</button>':''}
        ${['issued','partial'].includes(b.status)?'<button type="button" id="bPay">💵 收款</button>':''}
        ${['issued','partial','paid'].includes(b.status)&&!b.paid?'<button type="button" class="secondary" id="bVoid">作廢</button>':''}
        <button type="button" class="secondary" id="bPrint">🖨 列印請款單</button><button type="button" class="secondary" id="bX">關閉</button></div>`);
    box.querySelector('#bX').onclick=close;
    box.querySelector('#bPrint').onclick=()=>printBill(b);
    box.querySelector('#bEdit')?.addEventListener('click',()=>{close();billEditor(b,done);});
    box.querySelector('#bDel')?.addEventListener('click',async()=>{if(!confirm('刪除這張未開立的請款單？'))return;try{await api(`/api/company/ar/bills/${b.id}`,{method:'DELETE'});close();done();}catch(e){alert(e.message);}});
    box.querySelector('#bIssue')?.addEventListener('click',()=>{close();issueModal(b,done);});
    box.querySelector('#bInv')?.addEventListener('click',async()=>{const no=prompt('發票號碼（例如 AB12345678）：',b.invoice_no||'');if(!no)return;const date=prompt('發票日期（YYYY-MM-DD）：',b.invoice_date||b.bill_date);if(!date)return;try{await api(`/api/company/ar/bills/${b.id}/invoice`,J('POST',{no,date}));close();done();}catch(e){alert(e.message);}});
    box.querySelector('#bPay')?.addEventListener('click',()=>{close();receiptEditor(done,b);});
    box.querySelector('#bVoid')?.addEventListener('click',async()=>{const reason=prompt(`作廢原因：${b.invoice_type==='e_api'?'\n（電子發票會同時通知加值中心作廢）':b.invoice_no?'\n（紙本發票請記得收回）':''}`);if(!reason)return;try{await api(`/api/company/ar/bills/${b.id}/void`,J('POST',{reason}));close();done();}catch(e){alert(e.message);}});
  }
  function issueModal(b,done){
    const types=Object.entries(M.invoice_types);const def=b.invoice_type||(M.invoice_types.e_api?'e_api':M.invoice_types.paper?'paper':'e_manual');
    const {box,close}=modal(`開立 ${esc(b.bill_no)}`,`<p>開立後會產生傳票：借 應收帳款 ${fz(b.gross)}／貸 服務收入 ${fz(b.net)}＋銷項稅額 ${fz(b.tax)}。</p>
      <div class="ac-form"><label class="half">發票<select id="iT">${types.map(([k,l])=>`<option value="${k}" ${k===def?'selected':''}>${l}</option>`).join('')}</select></label><label id="iNoL">發票號碼<input id="iNo" placeholder="AB12345678（可之後補登）" maxlength="10"></label><label id="iDL">發票日期<input type="date" id="iD" value="${b.bill_date}"></label></div>
      <p class="ac-muted" id="iHint"></p><div class="foot"><button type="button" class="secondary" id="iX">取消</button><button type="button" id="iGo">✅ 開立入帳</button></div>`);
    const sync=()=>{const t=box.querySelector('#iT').value;const man=['paper','e_manual'].includes(t);box.querySelector('#iNoL').style.display=man?'':'none';box.querySelector('#iDL').style.display=man?'':'none';
      box.querySelector('#iHint').textContent=t==='e_api'?`會透過${M.einvoice_provider==='ecpay'?'綠界':'加值中心'}直接開立電子發票${M.einvoice_test?'（目前是測試環境）':''}，買受人資料取自社區合約。`:t==='e_manual'?'請先在加值中心網站開立電子發票，再把號碼登錄在這裡。':t==='paper'?'手開發票：開立後把發票號碼登錄在這裡（可以之後補登）。':'這張請款單不開發票（例如代收代付）。';};
    box.querySelector('#iT').onchange=sync;sync();box.querySelector('#iX').onclick=close;
    box.querySelector('#iGo').onclick=async()=>{const btn=box.querySelector('#iGo');btn.disabled=true;try{await api(`/api/company/ar/bills/${b.id}/issue`,J('POST',{type:box.querySelector('#iT').value,no:box.querySelector('#iNo').value,date:box.querySelector('#iD').value}));close();done();}catch(e){btn.disabled=false;alert(e.message);}};
  }
  function billEditor(b,done){
    const items=b?.items?.length?b.items:[{kind:'maintenance',name:'',amount:''}];const K=Object.entries(M.kinds);
    const row=(i={})=>`<tr><td><select data-f="kind">${K.map(([k,l])=>`<option value="${k}" ${i.kind===k?'selected':''}>${l}</option>`).join('')}</select></td><td><input data-f="name" value="${esc(i.name||'')}" placeholder="例如：機房抽水馬達更換"></td><td><input data-f="amount" type="number" min="0" value="${i.amount??''}"></td><td><input data-f="note" value="${esc(i.note||'')}"></td><td><button type="button" class="secondary" data-rm style="padding:3px 9px;min-height:0;margin:0">✕</button></td></tr>`;
    const cl=b?.client||{};
    const {box,close}=modal(b?`修改請款單 ${esc(b.bill_no)}`:'＋ 手動加開請款單',`<div class="ac-form">${b?'':`<label>公司別<select id="eE">${M.entities.map(e=>`<option value="${e.id}" ${e.id===S.eid?'selected':''}>${esc(e.short_name||e.name)}</option>`).join('')}</select></label><label>社區<select id="eC"><option value="">（非社區）</option>${M.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>`}
      <label>請款日<input type="date" id="eD" value="${b?.bill_date||M.today}"></label><label>到期日<input type="date" id="eDue" value="${b?.due_date||''}"></label>
      <label class="half">買受人<input id="cN" value="${esc(cl.name||'')}" placeholder="選了社區會自動帶合約的買受人"></label><label>統一編號<input id="cT" maxlength="8" value="${esc(cl.tax_id||'')}"></label>
      <label>稅別<select id="eTax"><option value="exclusive" ${b?.tax_type!=='inclusive'&&b?.tax_type!=='exempt'?'selected':''}>未稅（另加 5%）</option><option value="inclusive" ${b?.tax_type==='inclusive'?'selected':''}>含稅</option><option value="exempt" ${b?.tax_type==='exempt'?'selected':''}>免稅</option></select></label><label class="wide">備註<input id="eN" value="${esc(b?.note||'')}"></label></div>
      <div class="ac-wrap" style="margin-top:10px"><table class="ac-t ar-items"><thead><tr><th style="width:170px">收入類別</th><th>項目</th><th style="width:140px">金額</th><th>說明</th><th></th></tr></thead><tbody id="eL">${items.map(row).join('')}</tbody></table></div>
      <div class="foot" style="justify-content:space-between"><button type="button" class="secondary" id="eAdd">＋ 項目</button><span><button type="button" class="secondary" id="eX">取消</button> <button type="button" id="eS">💾 儲存（未開立）</button></span></div>`);
    const bind=()=>box.querySelectorAll('[data-rm]').forEach(x=>x.onclick=()=>{if(box.querySelectorAll('#eL tr').length>1)x.closest('tr').remove();});
    box.querySelector('#eAdd').onclick=()=>{box.querySelector('#eL').insertAdjacentHTML('beforeend',row());bind();};bind();box.querySelector('#eX').onclick=close;
    box.querySelector('#eS').onclick=async()=>{const v=s=>box.querySelector(s)?.value;const its=[...box.querySelectorAll('#eL tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-f]')].map(i=>[i.dataset.f,i.value])));
      const body={bill_date:v('#eD'),due_date:v('#eDue'),tax_type:v('#eTax'),note:v('#eN'),items:its,client:v('#cN')?{name:v('#cN'),tax_id:v('#cT')}:null};
      try{if(b)await api(`/api/company/ar/bills/${b.id}`,J('PUT',body));else await api('/api/company/ar/bills',J('POST',{...body,entity_id:Number(v('#eE')),community_id:Number(v('#eC'))||null}));close();S.status='draft';done();}catch(e){alert(e.message);}};
  }
  function printBill(b){
    const e=b.entity||{};const w=window.open('','_blank');if(!w){alert('請允許彈出視窗以列印');return;}
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>請款單 ${esc(b.bill_no)}</title><style>body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#1D0D0C;margin:28px;font-size:13px}h1{text-align:center;font-size:22px;margin:0 0 4px;letter-spacing:6px}.c{text-align:center;color:#5F403B}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #5F403B;padding:7px 8px;text-align:left}th{background:#F6ECE6}td.n{text-align:right}.kv{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:14px}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:36px}.sign div{border-top:1px solid #1D0D0C;padding-top:5px;text-align:center}@media print{button{display:none}body{margin:12mm}}</style></head><body>
      <div class="c" style="font-size:16px;font-weight:700">${esc(e.name||b.entity_name)}</div><div class="c">${e.tax_id?`統一編號 ${esc(e.tax_id)}　`:''}${esc(e.address||'')}${e.phone?`　電話 ${esc(e.phone)}`:''}</div>
      <h1 style="margin-top:14px">請 款 單</h1>
      <div class="kv"><div><b>買受人：</b>${esc(b.client.name||'')}</div><div><b>請款單號：</b>${esc(b.bill_no)}</div><div><b>統一編號：</b>${esc(b.client.tax_id||'')}</div><div><b>請款日期：</b>${b.bill_date}</div><div><b>社區：</b>${esc(b.community_name||'')}</div><div><b>付款期限：</b>${b.due_date}</div>${b.period?`<div><b>服務月份：</b>${b.period}${b.prorate?`（${esc(b.prorate)}）`:''}</div>`:''}${b.invoice_no?`<div><b>發票號碼：</b>${esc(b.invoice_no)}</div>`:''}</div>
      <table><thead><tr><th style="width:36px">#</th><th>項目</th><th>說明</th><th style="width:130px">金額</th></tr></thead><tbody>${b.items.map((i,k)=>`<tr><td>${k+1}</td><td>${esc(i.name)}</td><td>${esc(i.note||'')}</td><td class="n">${fz(i.amount)}</td></tr>`).join('')}
      <tr><td colspan="3" class="n">未稅金額</td><td class="n">${fz(b.net)}</td></tr><tr><td colspan="3" class="n">營業稅</td><td class="n">${fz(b.tax)}</td></tr><tr><td colspan="3" class="n"><b>應付總額（含稅）</b></td><td class="n"><b>NT$ ${fz(b.gross)}</b></td></tr></tbody></table>
      ${(e.banks||[]).length?`<p style="margin-top:16px"><b>匯款帳戶：</b><br>${e.banks.map(x=>`${esc(x.bank)}${x.code?`（${esc(x.code)}）`:''} ${esc(x.branch||'')}　帳號 ${esc(x.account)}　戶名 ${esc(x.name||e.name)}`).join('<br>')}</p>`:''}
      ${b.note?`<p>備註：${esc(b.note)}</p>`:''}
      <div class="sign"><div>承辦</div><div>會計</div><div>核准</div></div><p style="text-align:center;margin-top:20px"><button onclick="window.print()">🖨 列印／另存 PDF</button></p><script>setTimeout(()=>window.print(),400)<\/script></body></html>`);
    w.document.close();
  }

  // ---------- 收款 ----------
  async function receipts(box){
    const d=await api(`/api/company/ar/receipts?entity_id=${S.eid}&from=${S.rfrom}&to=${S.rto}`);
    box.innerHTML=`<div class="ac-bar"><input type="date" id="rF" value="${S.rfrom}"> ～ <input type="date" id="rT" value="${S.rto}"><button type="button" id="rNew">＋ 登錄收款</button></div>
      ${d.rows.length?`<div class="ac-wrap"><table class="ac-t"><thead><tr><th>日期</th><th>方式</th><th>付款人</th><th class="n">金額</th><th class="n">手續費</th><th>沖帳</th><th>備註</th><th></th></tr></thead><tbody>${d.rows.map(r=>`<tr${r.status==='void'?' class="void"':''}><td>${r.date}</td><td>${esc(r.method_label)}${r.ref?`<br><small class="ac-muted">${esc(r.ref)}</small>`:''}</td><td>${esc(r.payer||r.community_name||'')}</td><td class="n">${fz(r.amount)}</td><td class="n">${r.fee?fz(r.fee):''}</td><td>${r.allocations.map(a=>`${esc(a.bill_no)} ${fz(a.amount)}`).join('<br>')||'<span class="ac-muted">預收</span>'}</td><td>${esc(r.note||'')}${r.void_reason?`<br><small class="ac-bad">作廢：${esc(r.void_reason)}</small>`:''}</td><td>${r.status==='posted'?`<button type="button" class="secondary" data-rv="${r.id}">作廢</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">這段期間沒有收款紀錄。</div>'}`;
    const re=()=>receipts(box).catch(e=>alert(e.message));
    box.querySelector('#rF').onchange=e=>{S.rfrom=e.target.value;re();};box.querySelector('#rT').onchange=e=>{S.rto=e.target.value;re();};
    box.querySelector('#rNew').onclick=()=>receiptEditor(re);
    box.querySelectorAll('[data-rv]').forEach(b=>b.onclick=async()=>{const reason=prompt('作廢原因：');if(!reason)return;try{await api(`/api/company/ar/receipts/${b.dataset.rv}/void`,J('POST',{reason}));re();}catch(e){alert(e.message);}});
  }
  async function receiptEditor(done,bill){
    const d=await api(`/api/company/ar/bills?entity_id=${bill?.entity_id||S.eid}&status=open`);let open=d.rows;
    const {box,close}=modal('＋ 登錄收款',`<div class="ac-form"><label>收款日<input type="date" id="rD" value="${M.today}"></label><label>方式<select id="rM">${Object.entries(M.methods).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>收款金額<input type="number" id="rA" min="0" value="${bill?bill.outstanding:''}"></label><label>手續費<input type="number" id="rFee" min="0" value="0"></label>
      <label class="half">付款人<input id="rP" value="${esc(bill?.client?.name||'')}"></label><label>匯款末五碼／票號<input id="rR"></label><label>篩選社區<select id="rC"><option value="0">全部</option>${M.communities.map(c=>`<option value="${c.id}" ${bill?.community_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="wide">備註<input id="rN"></label></div>
      <p style="margin:12px 0 0"><b>沖帳</b> <span class="ac-muted">（依到期日先後自動分配收款金額，可以手動調整；沒沖完的會記在「預收款項」）</span></p>
      <div class="ar-alloc"><table class="ac-t"><thead><tr><th></th><th>請款單</th><th>社區</th><th>到期日</th><th class="n">未收</th><th style="width:140px">本次沖帳</th></tr></thead><tbody id="rL"></tbody></table></div>
      <div class="foot" style="justify-content:space-between"><span id="rSum" class="ac-muted"></span><span><button type="button" class="secondary" id="rX">取消</button> <button type="button" id="rGo">💾 收款入帳</button></span></div>`);
    const paint=()=>{const cid=Number(box.querySelector('#rC').value);const L=open.filter(b=>!cid||b.community_id===cid).sort((a,b)=>a.due_date.localeCompare(b.due_date));
      box.querySelector('#rL').innerHTML=L.map(b=>`<tr><td><input type="checkbox" data-c="${b.id}" ${bill?.id===b.id?'checked':''} style="width:auto;margin:0"></td><td>${esc(b.bill_no)}${b.invoice_no?`<br><small class="ac-muted">${esc(b.invoice_no)}</small>`:''}</td><td>${esc(b.community_name)}</td><td>${b.due_date}</td><td class="n">${fz(b.outstanding)}</td><td><input type="number" data-a="${b.id}" min="0" max="${b.outstanding}" value="${bill?.id===b.id?b.outstanding:''}" style="text-align:right"></td></tr>`).join('')||'<tr><td colspan="6" class="ac-muted">沒有待收款的請款單</td></tr>';
      box.querySelectorAll('[data-c]').forEach(c=>c.onchange=()=>{const inp=box.querySelector(`[data-a="${c.dataset.c}"]`);if(!c.checked){inp.value='';sum();return;}const amt=Number(box.querySelector('#rA').value)||0;const used=[...box.querySelectorAll('[data-a]')].reduce((s,i)=>s+(Number(i.value)||0),0);const b=open.find(x=>x.id===Number(c.dataset.c));inp.value=Math.max(0,Math.min(b.outstanding,amt-used))||b.outstanding;sum();});
      box.querySelectorAll('[data-a]').forEach(i=>i.oninput=()=>{box.querySelector(`[data-c="${i.dataset.a}"]`).checked=Number(i.value)>0;sum();});sum();};
    const sum=()=>{const amt=Number(box.querySelector('#rA').value)||0;const used=[...box.querySelectorAll('[data-a]')].reduce((s,i)=>s+(Number(i.value)||0),0);box.querySelector('#rSum').innerHTML=`收款 ${fz(amt)}　沖帳 ${fz(used)}　${amt-used>0?`預收 ${fz(amt-used)}`:amt-used<0?'<span class="ac-bad">沖帳超過收款金額</span>':'<span class="ac-ok">✓ 剛好</span>'}`;};
    const auto=()=>{let left=Number(box.querySelector('#rA').value)||0;box.querySelectorAll('#rL tr').forEach(tr=>{const c=tr.querySelector('[data-c]');if(!c)return;const b=open.find(x=>x.id===Number(c.dataset.c));const v=Math.min(left,b.outstanding);tr.querySelector('[data-a]').value=v>0?v:'';c.checked=v>0;left-=Math.max(0,v);});sum();};
    box.querySelector('#rC').onchange=()=>{paint();auto();};box.querySelector('#rA').oninput=auto;paint();if(!bill)sum();box.querySelector('#rX').onclick=close;
    box.querySelector('#rGo').onclick=async()=>{const v=s=>box.querySelector(s).value;const allocations=[...box.querySelectorAll('[data-a]')].map(i=>({bill_id:Number(i.dataset.a),amount:Number(i.value)||0})).filter(a=>a.amount>0);
      try{const r=await api('/api/company/ar/receipts',J('POST',{entity_id:bill?.entity_id||S.eid,date:v('#rD'),method:v('#rM'),amount:Number(v('#rA')),fee:Number(v('#rFee'))||0,payer:v('#rP'),ref:v('#rR'),note:v('#rN'),community_id:Number(v('#rC'))||null,allocations}));close();if(r.unallocated>0)alert(`已入帳。沒有沖帳的 ${fz(r.unallocated)} 記在「預收款項」。`);done();}catch(e){alert(e.message);}};
  }

  // ---------- 帳齡 ----------
  async function aging(box){
    const d=await api(`/api/company/ar/aging?entity_id=${S.eid}&date=${S.agingDate}`);const t=d.total;
    box.innerHTML=`<div class="ac-bar">截至 <input type="date" id="aD" value="${S.agingDate}"><span class="ac-muted">依到期日計算逾期天數</span></div>
      <div class="ac-wrap"><table class="ac-t"><thead><tr><th>社區／買受人</th><th class="n">未到期</th><th class="n">逾期 1–30 天</th><th class="n">31–60 天</th><th class="n">61–90 天</th><th class="n">90 天以上</th><th class="n">合計</th></tr></thead><tbody>${d.rows.map((r,i)=>`<tr class="click" data-x="${i}"><td><b>${esc(r.community_name)}</b><br><small class="ac-muted">${esc(r.client)}</small></td>${['current','d30','d60','d90','over'].map(k=>`<td class="n${k!=='current'&&r[k]?' ac-bad':''}">${r[k]?fz(r[k]):''}</td>`).join('')}<td class="n"><b>${fz(r.total)}</b></td></tr><tr data-xd="${i}" style="display:none"><td colspan="7">${r.bills.map(b=>`<div class="ac-muted">${esc(b.bill_no)}　到期 ${b.due_date}　未收 ${fz(b.outstanding)}${b.late?`　逾期 ${b.late} 天`:''}</div>`).join('')}</td></tr>`).join('')}<tr class="grand"><td>合計</td>${['current','d30','d60','d90','over','total'].map(k=>`<td class="n">${fz(t[k])}</td>`).join('')}</tr></tbody></table></div>`;
    box.querySelector('#aD').onchange=e=>{S.agingDate=e.target.value;aging(box);};
    box.querySelectorAll('[data-x]').forEach(r=>r.onclick=()=>{const x=box.querySelector(`[data-xd="${r.dataset.x}"]`);x.style.display=x.style.display==='none'?'':'none';});
  }

  // ---------- 銷項明細 ----------
  async function sales(box){
    const [y,m]=S.taxPeriod.split('-').map(Number);const from=`${y}-${String(m).padStart(2,'0')}-01`;const to=new Date(Date.UTC(y,m+1,0)).toISOString().slice(0,10);
    const d=await api(`/api/company/ar/sales?entity_id=${S.eid}&from=${from}&to=${to}`);const FMT={'31':'31 三聯式','32':'32 二聯式','35':'35 電子發票'};
    const cur=Number(M.today.slice(0,4));const per=[];for(const yy of [cur,cur-1])for(const mm of [11,9,7,5,3,1])per.push(`${yy}-${String(mm).padStart(2,'0')}`);
    box.innerHTML=`<div class="ac-note">營業稅兩個月一期申報（401）。這裡列出這一期開立的銷項發票（含作廢），可以下載給會計師；手開發票請確認號碼都已登錄。</div>
      <div class="ac-bar"><select id="sP">${per.map(p=>{const [a,b]=p.split('-').map(Number);return `<option value="${p}" ${p===S.taxPeriod?'selected':''}>${a-1911} 年 ${b}–${b+1} 月</option>`;}).join('')}</select><button type="button" class="secondary" id="sCsv">📤 下載 CSV</button></div>
      ${d.missing.length?`<div class="ac-note" style="background:#F6E3DC;border-color:#EBCFC4;color:#7A2E1A">⚠ 還有 ${d.missing.length} 張已開立的請款單沒有登錄發票號碼：${d.missing.map(x=>esc(x.bill_no)).join('、')}</div>`:''}
      <div class="ar-sum">${Object.entries(d.by_format).map(([k,v])=>`<div><span>${FMT[k]||k}</span><b>${v.count} 張${v.void?`<small class="ac-muted">（作廢 ${v.void}）</small>`:''}</b><span>銷售額 ${fz(v.net)}　稅額 ${fz(v.tax)}</span></div>`).join('')}<div><span>合計</span><b>$${fz(d.total.net)}</b><span>稅額 ${fz(d.total.tax)}</span></div></div>
      ${d.rows.length?`<div class="ac-wrap"><table class="ac-t"><thead><tr><th>格式</th><th>發票日期</th><th>發票號碼</th><th>買受人統編</th><th>買受人</th><th class="n">銷售額</th><th class="n">稅額</th><th>請款單</th></tr></thead><tbody>${d.rows.map(r=>`<tr${r.void?' class="void"':''}><td>${r.format}</td><td>${r.invoice_date}</td><td>${esc(r.invoice_no)}${r.void?' <span class="ar-pill x">作廢</span>':''}</td><td>${esc(r.buyer_tax_id)}</td><td>${esc(r.buyer)}</td><td class="n">${fz(r.net)}</td><td class="n">${fz(r.tax)}</td><td>${esc(r.bill_no)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">這一期沒有銷項發票。</div>'}`;
    box.querySelector('#sP').onchange=e=>{S.taxPeriod=e.target.value;sales(box);};
    box.querySelector('#sCsv').onclick=()=>{const a=document.createElement('a');a.href=`/api/company/ar/sales?entity_id=${S.eid}&from=${from}&to=${to}&format=csv`;a.click();};
  }
  window.ReceivablesModule={render};
})();
