// 保全勤務日誌（現場）＋勤務日誌管理（公司）＋收入報表（現場財務）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,o={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Object.assign(new Error(d.error||'操作失敗'),{status:r.status,data:d});return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const money=v=>Math.round(Number(v)||0).toLocaleString('en-US');
  const tw=t=>{if(!t)return'';const d=new Date(t);return Number.isNaN(+d)?String(t):d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});};
  const SH={day:'日班',night:'夜班'};
  function css(){if(document.getElementById('dlCss'))return;const s=document.createElement('style');s.id='dlCss';s.textContent=`
.dl-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 12px}.dl-top input[type=date]{width:auto;margin:0;padding:8px 10px;font-size:16px}
.dl-seg{display:inline-flex;border:1px solid #D9C9C2;border-radius:999px;overflow:hidden}.dl-seg button{margin:0;border:0;border-radius:0;padding:9px 18px;min-height:0;background:#fff;color:#5F403B;font-size:16px}.dl-seg button.on{background:#5F403B;color:#fff}
.dl-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px}.dl-tabs button{margin:0;white-space:nowrap;padding:9px 14px;min-height:0;border-radius:999px;font-size:15px}
.dl-card{background:#fff;border:1px solid #E7DAD4;border-radius:14px;padding:14px 16px;margin-bottom:12px}.dl-card h3{margin:0 0 10px;font-size:1.05rem;color:#5F403B;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.dl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.dl-grid label{display:flex;flex-direction:column;gap:4px;font-weight:700;font-size:.95rem;margin:0}.dl-grid input{margin:0;font-size:22px;text-align:center;padding:10px}
.dl-den{width:100%;border-collapse:collapse;table-layout:fixed}.dl-den td{padding:5px 4px;border-bottom:1px solid #F1E7E1;font-size:16px;white-space:nowrap}.dl-den td:first-child{width:26%}.dl-den td:nth-child(2){width:42%}.dl-den input{width:64px;margin:0;text-align:center;font-size:18px;padding:6px 2px}.dl-den td.n{text-align:right}.dl-den tfoot td{font-weight:800;font-size:18px;color:#A44528}
.dl-ok{background:#EEF4E6;border:1px solid #CFE0BF;color:#3E5328;border-radius:12px;padding:10px 14px;margin-bottom:10px}.dl-bad{background:#FBE9E3;border:1px solid #F0C9BC;color:#8A3B22;border-radius:12px;padding:10px 14px;margin-bottom:10px}.dl-info{background:#F6EFEA;border-radius:12px;padding:10px 14px;margin-bottom:10px;color:#5F403B}
.dl-t{width:100%;border-collapse:collapse;font-size:15px}.dl-t th,.dl-t td{padding:7px 8px;border-bottom:1px solid #F1E7E1;text-align:left;vertical-align:top}.dl-t th{background:#F6ECE6;font-size:.82rem;color:#5F403B}.dl-t td.n{text-align:right;white-space:nowrap}.dl-t input,.dl-t textarea{margin:0;width:100%;box-sizing:border-box;padding:7px 8px;font-size:15px}
.dl-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.dl-acts button{margin:0}
.dl-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:800}.dl-pill.fee{background:#FFF3E0;color:#A35A00}.dl-pill.dep{background:#EAF1FB;color:#2D5B8A}.dl-pill.bad{background:#FBE3DC;color:#A44528}.dl-pill.ok{background:#E8EEDF;color:#3E5328}
.dl-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dl-form label{display:flex;flex-direction:column;gap:4px;font-weight:700;margin:0}.dl-form input,.dl-form select,.dl-form textarea{margin:0;font-size:16px}.dl-form .w2{grid-column:1/-1}
.dl-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1E7E1}.dl-item b{font-size:16px}
.dl-big{font-size:17px;padding:12px 22px}
@media(max-width:640px){.dl-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.dl-form{grid-template-columns:1fr}.dl-t{font-size:14px}}
.dl-den,.dl-t{min-width:0!important}
@media(max-width:640px){.dl-stack thead{display:none}.dl-stack tr{display:block;border-bottom:1px solid #EADBD3;padding:8px 0}.dl-stack td{display:inline-block;border:0;padding:2px 6px;vertical-align:middle}.dl-stack td.n{font-size:17px}.dl-stack td:last-child{display:block;margin-top:4px}}
@media print{.dl-noprint{display:none!important}}
`;document.head.appendChild(s);}

  // ---------- 唯讀檢視（現場經理副本、公司內勤共用） ----------
  function viewHTML(l){
    const d=l.data||{},t=l.takeover,h=l.handover;const P={parcel:'包裹',registered:'掛號',deposit:'寄放物'};
    const pk=x=>x?Object.entries(P).map(([k,n])=>`${n} ${Number(x[k]||0)} 件`).join('、'):'—';
    return `<div class="dl-card"><h3>${esc(l.community_name)}｜${esc(l.date)} ${esc(l.shift_label)}<span>${l.flagged?'<span class="dl-pill bad">⚠️ 有差異</span>':'<span class="dl-pill ok">相符</span>'}</span></h3>
      <div>值班：<b>${esc(l.staff_name)}</b>　送出：${esc(tw(l.submitted_at))}</div></div>
      <div class="dl-card"><h3>接班點收</h3>${t?(t.first_time?'<div class="dl-info">這個社區第一次使用勤務日誌，沒有前一班可點收。</div>':`<div>上一班：${esc(t.prev_staff||'—')}${t.handover_absent?'　<span class="dl-pill bad">交班人不在場</span>':''}</div>
        <div>寄物點收：${pk(t.packages)}</div><div>現金：點到 <b>$${money(t.cash_counted)}</b>，應有 $${money(t.cash_expected)}</div>
        ${t.diffs?.length?`<div class="dl-bad">${t.diffs.map(esc).join('<br>')}<br>原因：${esc(t.reason)}</div>`:''}`):'—'}</div>
      <div class="dl-card"><h3>勤務紀錄</h3>${(d.records||[]).length?`<table class="dl-t"><thead><tr><th style="width:80px">時間</th><th>內容</th></tr></thead><tbody>${d.records.map(r=>`<tr><td>${esc(r.time)}</td><td>${esc(r.content)}</td></tr>`).join('')}</tbody></table>`:'<div class="dl-info">沒有紀錄</div>'}</div>
      <div class="dl-card"><h3>訪客／廠商進出</h3>${(d.visitors||[]).length?`<table class="dl-t"><thead><tr><th>進入</th><th>對象</th><th>事由</th><th>離開</th></tr></thead><tbody>${d.visitors.map(r=>`<tr><td>${esc(r.time)}</td><td>${esc(r.who)}</td><td>${esc(r.purpose)}</td><td>${esc(r.out)}</td></tr>`).join('')}</tbody></table>`:'<div class="dl-info">沒有紀錄</div>'}</div>
      <div class="dl-card"><h3>異常狀況</h3><div style="white-space:pre-wrap">${esc(d.incidents||'無')}</div></div>
      <div class="dl-card"><h3>交辦下一班</h3><div style="white-space:pre-wrap">${esc(d.next_todo||'無')}</div>${d.note?`<div style="white-space:pre-wrap;margin-top:8px">備註：${esc(d.note)}</div>`:''}</div>
      ${h?`<div class="dl-card"><h3>交班移交清單</h3><div>寄物：${pk(h.packages)}</div><div>現金：點到 <b>$${money(h.cash_counted)}</b>，帳上 $${money(h.cash_expected)}${h.reason?`<div class="dl-bad">差異原因：${esc(h.reason)}</div>`:''}</div>
        ${(h.cash||[]).length?`<table class="dl-t" style="margin-top:8px"><thead><tr><th>類別</th><th>戶別</th><th class="n">金額</th><th>說明</th><th>經手</th></tr></thead><tbody>${h.cash.map(c=>`<tr><td>${c.kind==='fee'?`代收${esc(c.fee_type)}`:'住戶寄放'}</td><td>${esc(c.unit)}</td><td class="n">$${money(c.amount)}</td><td>${c.kind==='fee'?(c.receipt_no?`收據 ${esc(c.receipt_no)}`:'未開收據'):`${esc(c.depositor)} → ${esc(c.recipient)}`}</td><td>${esc(c.received_by)}</td></tr>`).join('')}</tbody></table>`:''}
        <div style="margin-top:8px">物品：${(h.items||[]).map(i=>`${esc(i.name)}${i.out?`（借出：${esc(i.out.vendor)}）`:'（在）'}`).join('、')||'—'}</div></div>`:''}`;
  }
  function printLog(l){const w=window.open('','_blank');if(!w)return alert('請允許跳出視窗');w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>勤務日誌 ${esc(l.date)} ${esc(l.shift_label)}</title><style>body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;padding:18px;color:#222}h1{font-size:20px}.dl-card{border:1px solid #ccc;border-radius:8px;padding:10px 12px;margin-bottom:10px}.dl-card h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between}table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}.n{text-align:right}.dl-bad{color:#a00}.dl-pill{font-size:12px}</style></head><body><h1>保全勤務日誌</h1>${viewHTML(l)}<script>print()<\/script></body></html>`);w.document.close();}

  // ================= 現場 =================
  const S={tab:null,date:'',shift:''};let C=null,EL=null;
  const cidQ=()=>window.__activeCommunityId?`&community_id=${window.__activeCommunityId}`:'';
  const Q=x=>({...x,community_id:window.__activeCommunityId||undefined,date:S.date,shift:S.shift});
  function defaults(){const n=new Date(Date.now()+8*3600e3);const h=n.getUTCHours();let d=n.toISOString().slice(0,10);let sh='day';if(h>=19)sh='night';else if(h<7){sh='night';const y=new Date(n);y.setUTCDate(y.getUTCDate()-1);d=y.toISOString().slice(0,10);}return [d,sh];}
  async function render(el,label){
    css();EL=el;if(!S.date){[S.date,S.shift]=defaults();}
    C=await api(`/api/staff/duty/context?date=${S.date}&shift=${S.shift}${cidQ()}`);
    const guard=C.role.guard;const tabs=guard?[['take','① 接班點收'],['log','② 勤務紀錄'],['cash','③ 現金'],['items','④ 鑰匙物品'],['hand','⑤ 交班送出'],['hist','歷史日誌']]:[['hist','勤務日誌（副本）'],['cash','現金保管'],['items','鑰匙物品']];
    if(!S.tab||!tabs.some(t=>t[0]===S.tab))S.tab=tabs[0][0];
    const locked=C.log?.status==='submitted';
    el.innerHTML=`<div class="panel"><div class="eyebrow">🛡️ 勤務日誌｜${esc(C.community.name)}</div><h1>${esc(label||'勤務日誌')}</h1>
      ${guard?`<div class="dl-top dl-noprint"><input type="date" id="dlD" value="${S.date}"><span class="dl-seg"><button type="button" data-sh="day" class="${S.shift==='day'?'on':''}">☀️ 日班</button><button type="button" data-sh="night" class="${S.shift==='night'?'on':''}">🌙 夜班</button></span>${locked?'<span class="dl-pill ok">✓ 已交班送出</span>':C.log?.takeover?'<span class="dl-pill ok">已點收</span>':''}</div>`:''}
      <div class="dl-tabs dl-noprint">${tabs.map(([k,l])=>`<button type="button" data-tab="${k}" class="${S.tab===k?'':'secondary'}">${l}</button>`).join('')}</div><div id="dlBody"></div></div>`;
    el.querySelector('#dlD')?.addEventListener('change',e=>{S.date=e.target.value;render(el,label);});
    el.querySelectorAll('[data-sh]').forEach(b=>b.onclick=()=>{S.shift=b.dataset.sh;render(el,label);});
    el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;render(el,label);});
    const body=el.querySelector('#dlBody');const again=()=>render(el,label);
    ({take:tabTake,log:tabLog,cash:tabCash,items:tabItems,hand:tabHand,hist:tabHist})[S.tab](body,again);
  }
  const denomTable=(id,val={})=>`<table class="dl-den" id="${id}"><tbody>${C.denoms.map(v=>`<tr><td>$${v.toLocaleString()}</td><td>× <input type="number" min="0" inputmode="numeric" data-dn="${v}" value="${val[v]||''}" placeholder="0"> ${v>=100?'張':'枚'}</td><td class="n" data-sub="${v}">$0</td></tr>`).join('')}</tbody><tfoot><tr><td>合計</td><td></td><td class="n" data-total>$0</td></tr></tfoot></table>`;
  function bindDenoms(root,id){const t=root.querySelector('#'+id);const calc=()=>{let s=0;t.querySelectorAll('[data-dn]').forEach(i=>{const v=Number(i.dataset.dn)*(Number(i.value)||0);s+=v;t.querySelector(`[data-sub="${i.dataset.dn}"]`).textContent='$'+money(v);});t.querySelector('[data-total]').textContent='$'+money(s);return s;};t.addEventListener('input',calc);calc();return ()=>Object.fromEntries([...t.querySelectorAll('[data-dn]')].map(i=>[i.dataset.dn,Number(i.value)||0]));}
  const pkgInputs=(id,val={})=>`<div class="dl-grid" id="${id}">${Object.entries(C.pkg).map(([k,n])=>`<label>${n}<input type="number" min="0" inputmode="numeric" data-pk="${k}" value="${val[k]??''}" placeholder="0"></label>`).join('')}</div>`;
  const readPk=(root,id)=>Object.fromEntries([...root.querySelectorAll(`#${id} [data-pk]`)].map(i=>[i.dataset.pk,Number(i.value)||0]));

  function tabTake(b,again){
    const t=C.log?.takeover;
    if(!C.prev){b.innerHTML=`<div class="dl-info">這個社區還沒有前一班的勤務日誌，第一次使用不用點收。請直接記錄，交班時把目前的寄物件數、現金點清楚，下一班就會從這裡開始點收。</div>`;return;}
    if(t){b.innerHTML=`<div class="dl-card"><h3>點收結果</h3>${t.diffs.length?`<div class="dl-bad">${t.diffs.map(esc).join('<br>')}<br>原因：${esc(t.reason)}</div>`:'<div class="dl-ok">✓ 寄物件數、現金都相符</div>'}
      <div>上一班：${esc(t.prev_staff)}（${esc(C.prev.date)} ${esc(C.prev.shift_label)}）</div><div>點收時間：${esc(tw(t.at))}　點收人：${esc(t.by)}</div></div>
      ${C.prev.todo?`<div class="dl-card"><h3>上一班交辦</h3><div style="white-space:pre-wrap">${esc(C.prev.todo)}</div></div>`:''}`;return;}
    b.innerHTML=`<div class="dl-info">上一班：<b>${esc(C.prev.staff_name)}</b>（${esc(C.prev.date)} ${esc(C.prev.shift_label)}）。請<b>自己實際點過</b>再填，送出後系統才會顯示上一班移交的數量。</div>
      ${C.prev.todo?`<div class="dl-card"><h3>📌 上一班交辦</h3><div style="white-space:pre-wrap">${esc(C.prev.todo)}</div></div>`:''}
      <div class="dl-card"><h3>1. 寄物件數</h3>${pkgInputs('tkPk')}</div>
      <div class="dl-card"><h3>2. 現金點算（保管中的所有現金）</h3>${denomTable('tkDn')}</div>
      <div class="dl-card"><h3>3. 鑰匙物品</h3>${C.items.length?C.items.map(i=>`<div class="dl-item"><b>${esc(i.name)}</b><span>${i.out?`<span class="dl-pill fee">借出：${esc(i.out.vendor)}</span>`:'<span class="dl-pill ok">應在現場</span>'}</span></div>`).join(''):'<div class="dl-info">經理還沒有設定物品清單</div>'}</div>
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" id="tkAbs" style="width:auto;margin:0"> 交班人不在場（沒有當面交接）</label>
      <div id="tkMsg"></div><div class="dl-acts"><button type="button" class="dl-big" id="tkGo">✓ 確認點收、開始接班</button></div>`;
    const readDn=bindDenoms(b,'tkDn');let reasonMode=false;
    b.querySelector('#tkGo').onclick=async()=>{const body=Q({packages:readPk(b,'tkPk'),denoms:readDn(),handover_absent:b.querySelector('#tkAbs').checked,reason:b.querySelector('#tkReason')?.value||''});
      if(reasonMode&&!body.reason.trim())return alert('請寫下差異原因');
      try{await api('/api/staff/duty/takeover',J('POST',body));again();}
      catch(e){if(e.status===409&&e.data?.diffs){reasonMode=true;b.querySelector('#tkMsg').innerHTML=`<div class="dl-bad"><b>點收數量和應有數量不同：</b><br>${e.data.diffs.map(esc).join('<br>')}<br><br>請再點一次；確定有差異，請寫下原因後再按確認（會通知社區經理與勤務主管）。<textarea id="tkReason" rows="3" style="margin-top:8px;width:100%" placeholder="例如：包裹已被住戶領走、上一班漏登記…"></textarea></div>`;b.querySelector('#tkReason').focus();}else alert(e.message);}};
  }
  function tabLog(b,again){
    const d=C.log?.data||{};const locked=C.log?.status==='submitted';const dis=locked?'disabled':'';
    const rec=(r={})=>`<tr><td style="width:90px"><input data-k="time" type="time" value="${esc(r.time||'')}" ${dis}></td><td><input data-k="content" value="${esc(r.content||'')}" ${dis} placeholder="例如：巡視 B1 停車場、處理住戶反映…"></td></tr>`;
    const vis=(r={})=>`<tr><td style="width:90px"><input data-k="time" type="time" value="${esc(r.time||'')}" ${dis}></td><td><input data-k="who" value="${esc(r.who||'')}" ${dis} placeholder="廠商／訪客"></td><td><input data-k="purpose" value="${esc(r.purpose||'')}" ${dis} placeholder="事由"></td><td style="width:90px"><input data-k="out" type="time" value="${esc(r.out||'')}" ${dis}></td></tr>`;
    b.innerHTML=`${locked?'<div class="dl-ok">這一班已交班送出，內容已鎖定。</div>':'<div class="dl-info">內容會自動儲存，可以邊值班邊寫。</div>'}
      <div class="dl-card"><h3>勤務紀錄</h3><table class="dl-t"><thead><tr><th>時間</th><th>內容</th></tr></thead><tbody id="tR">${(d.records?.length?d.records:[{}]).map(rec).join('')}</tbody></table>${locked?'':'<div class="dl-acts"><button type="button" class="secondary" data-add="R">＋ 一筆</button></div>'}</div>
      <div class="dl-card"><h3>訪客／廠商進出</h3><table class="dl-t"><thead><tr><th>進入</th><th>對象</th><th>事由</th><th>離開</th></tr></thead><tbody id="tV">${(d.visitors?.length?d.visitors:[{}]).map(vis).join('')}</tbody></table>${locked?'':'<div class="dl-acts"><button type="button" class="secondary" data-add="V">＋ 一筆</button></div>'}</div>
      <div class="dl-card"><h3>異常狀況</h3><textarea id="fInc" rows="3" ${dis} placeholder="沒有就留白">${esc(d.incidents||'')}</textarea></div>
      <div class="dl-card"><h3>交辦下一班</h3><textarea id="fTodo" rows="3" ${dis} placeholder="下一班接班時會第一個看到">${esc(d.next_todo||'')}</textarea></div>
      <div class="dl-card"><h3>其他備註</h3><textarea id="fNote" rows="2" ${dis}>${esc(d.note||'')}</textarea></div><div id="svd" class="hint"></div>`;
    if(locked)return;
    b.querySelectorAll('[data-add]').forEach(x=>x.onclick=()=>{b.querySelector('#t'+x.dataset.add).insertAdjacentHTML('beforeend',x.dataset.add==='R'?rec():vis());});
    const rows=id=>[...b.querySelectorAll(`#${id} tr`)].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i=>[i.dataset.k,i.value])));
    let tm=null;b.addEventListener('input',()=>{clearTimeout(tm);b.querySelector('#svd').textContent='儲存中…';tm=setTimeout(async()=>{try{await api('/api/staff/duty/log',J('PUT',Q({data:{records:rows('tR'),visitors:rows('tV'),incidents:b.querySelector('#fInc').value,next_todo:b.querySelector('#fTodo').value,note:b.querySelector('#fNote').value}})));const d2=C.log||(C.log={});d2.data={records:rows('tR'),visitors:rows('tV'),incidents:b.querySelector('#fInc').value,next_todo:b.querySelector('#fTodo').value,note:b.querySelector('#fNote').value};b.querySelector('#svd').textContent='✓ 已自動儲存';}catch(e){b.querySelector('#svd').textContent='⚠️ '+e.message;}},800);});
  }
  async function tabCash(b,again){
    let rows;if(C.role.guard&&!C.role.manager&&!C.role.take_fee){if(C.cash.hidden){b.innerHTML='<div class="dl-info">請先完成「① 接班點收」，才會看到目前保管中的現金明細（先點再看）。</div>';return;}rows=C.cash.rows;}
    else rows=(await api(`/api/staff/duty/cash?status=held${cidQ()}`)).rows;
    const total=rows.reduce((s,r)=>s+r.amount,0);const locked=C.role.guard&&C.log?.status==='submitted';
    const row=r=>`<tr><td><span class="dl-pill ${r.kind==='fee'?'fee':'dep'}">${r.kind==='fee'?`代收${esc(r.fee_type)}`:'住戶寄放'}</span></td><td><b>${esc(r.unit)}</b></td><td class="n"><b>$${money(r.amount)}</b></td><td>${r.kind==='fee'?(r.receipt_no?`收據 ${esc(r.receipt_no)}`:'<span class="hint">未開收據</span>'):`${esc(r.depositor||'')} → <b>${esc(r.recipient)}</b>`}${r.note?`<br><small>${esc(r.note)}</small>`:''}</td><td><small>${esc(r.received_by)}<br>${esc(tw(r.received_at))}</small></td>
      <td style="white-space:nowrap">${r.kind==='fee'&&!C.role.take_fee?'<small class="hint">由財務秘書／經理領取</small>':`<button type="button" data-take="${r.id}">領取</button>`} <button type="button" class="secondary" data-void="${r.id}">作廢</button></td></tr>`;
    b.innerHTML=`<div class="dl-card"><h3>目前保管中的現金<span style="color:#A44528">合計 $${money(total)}</span></h3>${rows.length?`<div style="overflow-x:auto"><table class="dl-t dl-stack"><thead><tr><th>類別</th><th>戶別</th><th class="n">金額</th><th>說明</th><th>登記</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`:'<div class="dl-info">目前沒有保管中的現金。</div>'}
      ${locked?'':`<div class="dl-acts"><button type="button" id="addDep">＋ 住戶寄放現金</button><button type="button" id="addFee" class="secondary">＋ 代收管理費／停車費</button><button type="button" id="hist" class="secondary">已領取／作廢紀錄</button></div>`}</div><div id="cashForm"></div><div id="cashHist"></div>`;
    const F=b.querySelector('#cashForm');
    const form=kind=>{F.innerHTML=`<div class="dl-card"><h3>${kind==='fee'?'代收管理費／停車費':'住戶寄放現金'}</h3><div class="dl-form">
      <label>戶別<input id="cU" placeholder="例如 A3-5F"></label><label>金額<input id="cA" type="number" min="1" inputmode="numeric"></label>
      ${kind==='fee'?`<label>項目<select id="cT">${C.fee_types.map(x=>`<option>${x}</option>`).join('')}</select></label><label>收據號碼（選填）<input id="cR" placeholder="有開收據才填"></label>`:`<label>寄放人<input id="cD" placeholder="例如 王太太"></label><label>交給誰（收件人）<input id="cP" placeholder="例如 李先生"></label>`}
      <label class="w2">備註<input id="cN"></label></div><div class="dl-acts"><button type="button" id="cSave">💾 登記</button><button type="button" class="secondary" id="cX">取消</button></div>${kind==='fee'?'<p class="hint">代收款只能由財務秘書或經理領取；保全只負責保管與交接清點。</p>':''}</div>`;
      F.querySelector('#cX').onclick=()=>F.innerHTML='';
      F.querySelector('#cSave').onclick=async()=>{const v=id=>F.querySelector(id)?.value||'';try{await api('/api/staff/duty/cash',J('POST',Q({kind,unit:v('#cU'),amount:Number(v('#cA')),fee_type:v('#cT'),receipt_no:v('#cR'),depositor:v('#cD'),recipient:v('#cP'),note:v('#cN')})));C=await api(`/api/staff/duty/context?date=${S.date}&shift=${S.shift}${cidQ()}`);tabCash(b,again);}catch(e){alert(e.message);}};
      F.querySelector('#cU').focus();};
    b.querySelector('#addDep')?.addEventListener('click',()=>form('deposit'));b.querySelector('#addFee')?.addEventListener('click',()=>form('fee'));
    const reload=async()=>{C=await api(`/api/staff/duty/context?date=${S.date}&shift=${S.shift}${cidQ()}`);tabCash(b,again);};
    b.querySelectorAll('[data-take]').forEach(x=>x.onclick=async()=>{const r=rows.find(y=>y.id===Number(x.dataset.take));let body={};
      if(r.kind==='fee'){const no=prompt(`領取代收${r.fee_type} ${r.unit} $${money(r.amount)}\n\n請填寫收據號碼（填完會自動帶入收入報表）：`,r.receipt_no||'');if(no===null)return;body.receipt_no=no;}
      else{const to=prompt(`${r.unit} 寄放 $${money(r.amount)}\n領取人姓名：`,r.recipient||'');if(to===null)return;body.taken_to=to;}
      try{await api(`/api/staff/duty/cash/${r.id}/take`,J('POST',Q(body)));await reload();}catch(e){alert(e.message);}});
    b.querySelectorAll('[data-void]').forEach(x=>x.onclick=async()=>{const reason=prompt('作廢原因（例如登記錯誤）：\n作廢後會通知社區經理；金額不能修改，請作廢後重新登記。');if(!reason)return;try{await api(`/api/staff/duty/cash/${x.dataset.void}/void`,J('POST',Q({reason})));await reload();}catch(e){alert(e.message);}});
    b.querySelector('#hist')?.addEventListener('click',async()=>{const H=b.querySelector('#cashHist');if(H.innerHTML){H.innerHTML='';return;}const [t,v]=await Promise.all([api(`/api/staff/duty/cash?status=taken${cidQ()}`),api(`/api/staff/duty/cash?status=void${cidQ()}`)]);
      H.innerHTML=`<div class="dl-card"><h3>已領取</h3>${t.rows.length?`<table class="dl-t"><tbody>${t.rows.map(r=>`<tr><td>${r.kind==='fee'?`代收${esc(r.fee_type)}`:'寄放'}</td><td>${esc(r.unit)}</td><td class="n">$${money(r.amount)}</td><td>${esc(r.taken_to)}${r.receipt_no?`（收據 ${esc(r.receipt_no)}）`:''}<br><small>${esc(r.taken_by)} ${esc(tw(r.taken_at))}</small></td></tr>`).join('')}</tbody></table>`:'<div class="dl-info">沒有</div>'}</div>
        <div class="dl-card"><h3>已作廢</h3>${v.rows.length?`<table class="dl-t"><tbody>${v.rows.map(r=>`<tr><td>${esc(r.unit)}</td><td class="n">$${money(r.amount)}</td><td>${esc(r.void_reason)}<br><small>${esc(r.voided_by)} ${esc(tw(r.voided_at))}</small></td></tr>`).join('')}</tbody></table>`:'<div class="dl-info">沒有</div>'}</div>`;});
  }
  function tabItems(b,again){
    const vend=`<datalist id="dlVend">${(C.vendors||[]).map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`;
    b.innerHTML=`<div class="dl-card"><h3>鑰匙、門禁卡、對講機等${C.role.manager?'<button type="button" class="secondary" id="iAdd">＋ 新增物品</button>':''}</h3>${vend}
      ${C.items.length?C.items.map(i=>`<div class="dl-item"><div><b>${esc(i.name)}</b>${i.out?`<div><span class="dl-pill fee">借出中：${esc(i.out.vendor)}</span> <small class="hint">${esc(i.out.out_by)} ${esc(tw(i.out.out_at))}${i.out.note?`｜${esc(i.out.note)}`:''}</small></div>`:'<div><span class="dl-pill ok">在現場</span></div>'}</div>
        <div style="white-space:nowrap">${i.out?`<button type="button" data-back="${i.id}">↩ 歸還</button>`:`<button type="button" class="secondary" data-lend="${i.id}">借出</button>`}${C.role.manager?` <button type="button" class="secondary" data-rm="${i.id}">移除</button>`:''}</div></div>`).join(''):`<div class="dl-info">${C.role.manager?'還沒有物品清單，請按「＋ 新增物品」，一次可以輸入多個（每行一個）。':'社區經理還沒有設定物品清單。'}</div>`}</div><div id="iForm"></div>`;
    const F=b.querySelector('#iForm');const re=async()=>{C=await api(`/api/staff/duty/context?date=${S.date}&shift=${S.shift}${cidQ()}`);tabItems(b,again);};
    b.querySelector('#iAdd')?.addEventListener('click',()=>{F.innerHTML=`<div class="dl-card"><h3>新增物品（每行一個）</h3><textarea id="iN" rows="4" placeholder="大門鑰匙\n機房鑰匙\n對講機 1 號\n公務手機"></textarea><div class="dl-acts"><button type="button" id="iS">💾 新增</button></div></div>`;F.querySelector('#iS').onclick=async()=>{try{await api('/api/staff/duty/items',J('POST',Q({names:F.querySelector('#iN').value.split('\n')})));await re();}catch(e){alert(e.message);}};});
    b.querySelectorAll('[data-lend]').forEach(x=>x.onclick=()=>{const it=C.items.find(i=>i.id===Number(x.dataset.lend));F.innerHTML=`<div class="dl-card"><h3>借出：${esc(it.name)}</h3><div class="dl-form"><label>借用廠商<input id="lV" list="dlVend" placeholder="可從廠商聯繫名單選，或直接輸入"></label><label>備註<input id="lN" placeholder="例如：電梯保養"></label></div><div class="dl-acts"><button type="button" id="lS">確認借出</button><button type="button" class="secondary" id="lX">取消</button></div></div>`;F.querySelector('#lX').onclick=()=>F.innerHTML='';F.querySelector('#lV').focus();F.querySelector('#lS').onclick=async()=>{try{await api(`/api/staff/duty/items/${it.id}/lend`,J('POST',Q({vendor:F.querySelector('#lV').value,note:F.querySelector('#lN').value})));await re();}catch(e){alert(e.message);}};});
    b.querySelectorAll('[data-back]').forEach(x=>x.onclick=async()=>{try{await api(`/api/staff/duty/items/${x.dataset.back}/return`,J('POST',Q({})));await re();}catch(e){alert(e.message);}});
    b.querySelectorAll('[data-rm]').forEach(x=>x.onclick=async()=>{if(!confirm('從清單移除這個物品？'))return;try{await api(`/api/staff/duty/items/${x.dataset.rm}?${cidQ().slice(1)}`,{method:'DELETE'});await re();}catch(e){alert(e.message);}});
  }
  function tabHand(b,again){
    if(C.log?.status==='submitted'){b.innerHTML=`<div class="dl-ok">✓ 已於 ${esc(tw(C.log.submitted_at))} 交班送出，公司內勤與社區經理都已收到副本。</div><div class="dl-acts"><button type="button" class="secondary" id="pr">🖨 列印</button></div>`;b.querySelector('#pr').onclick=()=>printLog(C.log);return;}
    if(C.prev&&!C.log?.takeover){b.innerHTML='<div class="dl-info">請先完成「① 接班點收」。</div>';return;}
    const t=C.log?.takeover||{};
    b.innerHTML=`<div class="dl-info">交班前請再實際點一次。送出後內容會鎖定，公司內勤與社區經理會各收到一份。帳上保管中的現金：<b>$${money(C.cash.total)}</b>（${C.cash.rows.length} 筆）</div>
      <div class="dl-card"><h3>1. 移交寄物件數</h3>${pkgInputs('hPk',t.packages||{})}</div>
      <div class="dl-card"><h3>2. 現金點算</h3>${denomTable('hDn')}</div>
      <div class="dl-card"><h3>3. 鑰匙物品</h3>${C.items.map(i=>`<div class="dl-item"><b>${esc(i.name)}</b>${i.out?`<span class="dl-pill fee">借出：${esc(i.out.vendor)}</span>`:'<span class="dl-pill ok">在現場</span>'}</div>`).join('')||'<div class="dl-info">沒有物品清單</div>'}</div>
      <div id="hMsg"></div><div class="dl-acts"><button type="button" class="dl-big" id="hGo">📤 交班送出</button></div>`;
    const readDn=bindDenoms(b,'hDn');let reasonMode=false;
    b.querySelector('#hGo').onclick=async()=>{const reason=b.querySelector('#hReason')?.value||'';if(reasonMode&&!reason.trim())return alert('請寫下差異原因');if(!reasonMode&&!confirm('確定交班送出？送出後就不能修改了。'))return;
      try{await api('/api/staff/duty/submit',J('POST',Q({packages:readPk(b,'hPk'),denoms:readDn(),reason})));S.tab='hand';again();}
      catch(e){if(e.status===409){reasonMode=true;b.querySelector('#hMsg').innerHTML=`<div class="dl-bad">${esc(e.message)}<textarea id="hReason" rows="3" style="margin-top:8px;width:100%" placeholder="確定有差異才填，會通知社區經理與勤務主管"></textarea></div>`;}else alert(e.message);}};
  }
  async function tabHist(b){
    const d=await api(`/api/staff/duty/logs?x=1${cidQ()}`);
    b.innerHTML=`<div class="dl-card"><h3>已送出的勤務日誌（唯讀）</h3>${d.rows.length?`<table class="dl-t"><thead><tr><th>日期</th><th>班別</th><th>值班</th><th>狀態</th></tr></thead><tbody>${d.rows.map(l=>`<tr data-id="${l.id}" style="cursor:pointer"><td>${esc(l.date)}</td><td>${esc(l.shift_label)}</td><td>${esc(l.staff_name)}</td><td>${l.flagged?'<span class="dl-pill bad">有差異</span>':'<span class="dl-pill ok">相符</span>'}</td></tr>`).join('')}</tbody></table>`:'<div class="dl-info">還沒有送出的勤務日誌。</div>'}</div><div id="hv"></div>`;
    b.querySelectorAll('[data-id]').forEach(tr=>tr.onclick=async()=>{const {log}=await api(`/api/staff/duty/logs/${tr.dataset.id}`);const v=b.querySelector('#hv');v.innerHTML=`<div class="dl-acts dl-noprint" style="margin-bottom:8px"><button type="button" class="secondary" id="pr">🖨 列印</button></div>${viewHTML(log)}`;v.querySelector('#pr').onclick=()=>printLog(log);v.scrollIntoView({behavior:'smooth'});});
  }
  window.DutyLogModule={render:async(el,label)=>{S.tab=null;return render(el,label);}};

  // ================= 收入報表（現場財務） =================
  window.SiteIncomeModule={render:async function(el,label){css();let month=new Date(Date.now()+8*3600e3).toISOString().slice(0,7);
    const draw=async()=>{const d=await api(`/api/staff/income?month=${month}${cidQ()}`);
      el.innerHTML=`<div class="panel"><div class="eyebrow">💰 財務報表｜${esc(d.community)}</div><h1>${esc(label||'收入報表')}</h1>
        <div class="dl-top dl-noprint"><input type="month" id="iM" value="${d.month}" style="width:auto;margin:0"><button type="button" class="secondary" id="iP" style="margin:0">🖨 列印</button>${d.can_edit?'<button type="button" id="iA" style="margin:0">＋ 登記收入</button>':''}</div>
        <div class="dl-card"><h3>${esc(d.month)} 收入合計<span style="color:#A44528">$${money(d.total)}</span></h3><div>${Object.entries(d.by_category).map(([k,v])=>`${esc(k)} $${money(v)}`).join('　')||'本月沒有收入'}</div><p class="hint" style="margin:6px 0 0">保全代收的管理費、停車費，在財務秘書或經理領取並填入收據號碼後會自動列在這裡。</p></div>
        <div id="iF"></div><div class="dl-card"><table class="dl-t dl-stack"><thead><tr><th>日期</th><th>項目</th><th>戶別</th><th class="n">金額</th><th>收據號碼</th><th>說明</th>${d.can_edit?'<th class="dl-noprint"></th>':''}</tr></thead><tbody>${d.rows.map(r=>`<tr style="${r.voided_at?'opacity:.5;text-decoration:line-through':''}"><td>${esc(r.date)}</td><td>${esc(r.category)}</td><td>${esc(r.unit)}</td><td class="n">$${money(r.amount)}</td><td>${esc(r.receipt_no)}</td><td><small>${r.source==='duty_fee'?'🛡️ ':''}${esc(r.note)}${r.voided_at?`<br>作廢：${esc(r.void_reason)}`:''}</small></td>${d.can_edit?`<td class="dl-noprint">${r.voided_at?'':`<button type="button" class="secondary" data-v="${r.id}" style="margin:0;padding:4px 10px;min-height:0">作廢</button>`}</td>`:''}</tr>`).join('')||'<tr><td colspan="7">沒有資料</td></tr>'}</tbody></table></div></div>`;
      el.querySelector('#iM').onchange=e=>{month=e.target.value;draw();};el.querySelector('#iP').onclick=()=>print();
      el.querySelector('#iA')?.addEventListener('click',()=>{const F=el.querySelector('#iF');F.innerHTML=`<div class="dl-card"><h3>登記收入</h3><div class="dl-form"><label>日期<input type="date" id="fD" value="${new Date(Date.now()+8*3600e3).toISOString().slice(0,10)}"></label><label>項目<select id="fC">${d.categories.map(x=>`<option>${x}</option>`).join('')}</select></label><label>戶別<input id="fU"></label><label>金額<input id="fA" type="number" min="1"></label><label>收據號碼<input id="fR"></label><label>說明<input id="fN"></label></div><div class="dl-acts"><button type="button" id="fS">💾 登記</button></div></div>`;
        F.querySelector('#fS').onclick=async()=>{const v=s=>F.querySelector(s).value;try{await api('/api/staff/income',J('POST',{community_id:window.__activeCommunityId||undefined,date:v('#fD'),category:v('#fC'),unit:v('#fU'),amount:Number(v('#fA')),receipt_no:v('#fR'),note:v('#fN')}));draw();}catch(e){alert(e.message);}};});
      el.querySelectorAll('[data-v]').forEach(b=>b.onclick=async()=>{const reason=prompt('作廢原因：');if(!reason)return;try{await api(`/api/staff/income/${b.dataset.v}/void`,J('POST',{community_id:window.__activeCommunityId||undefined,reason}));draw();}catch(e){alert(e.message);}});};
    await draw();}};

  // ================= 公司內勤：勤務日誌管理（唯讀） =================
  window.DutyLogCompanyModule={render:async function(el,label){css();const F={cid:'',from:'',to:'',flag:false};
    const draw=async()=>{const qs=new URLSearchParams({community_id:F.cid,from:F.from,to:F.to,flagged:F.flag?'1':''});const d=await api(`/api/company/duty-logs?${qs}`);
      el.innerHTML=`<div class="eyebrow">🛡️ 勤務日誌管理</div><h1>${esc(label||'勤務日誌管理')}</h1><p class="hint">保全每一班交班送出的勤務日誌與交接點收紀錄。內容由現場送出後鎖定，這裡只能查看與列印。</p>
        <div class="dl-top"><select id="fc" style="width:auto;margin:0"><option value="">全部社區</option>${d.communities.map(c=>`<option value="${c.id}" ${String(c.id)===F.cid?'selected':''}>${esc(c.name)}</option>`).join('')}</select><input type="date" id="ff" value="${F.from}"><span>～</span><input type="date" id="ft" value="${F.to}"><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="fg" ${F.flag?'checked':''} style="width:auto;margin:0"> 只看有差異</label></div>
        <div class="dl-card">${d.rows.length?`<table class="dl-t"><thead><tr><th>日期</th><th>班別</th><th>社區</th><th>值班</th><th>狀態</th><th>送出</th></tr></thead><tbody>${d.rows.map(l=>`<tr data-id="${l.id}" style="cursor:pointer"><td>${esc(l.date)}</td><td>${esc(l.shift_label)}</td><td>${esc(l.community_name)}</td><td>${esc(l.staff_name)}</td><td>${l.flagged?'<span class="dl-pill bad">⚠️ 有差異</span>':'<span class="dl-pill ok">相符</span>'}</td><td><small>${esc(tw(l.submitted_at))}</small></td></tr>`).join('')}</tbody></table>`:'<div class="dl-info">沒有符合的勤務日誌。</div>'}</div><div id="v"></div>`;
      el.querySelector('#fc').onchange=e=>{F.cid=e.target.value;draw();};el.querySelector('#ff').onchange=e=>{F.from=e.target.value;draw();};el.querySelector('#ft').onchange=e=>{F.to=e.target.value;draw();};el.querySelector('#fg').onchange=e=>{F.flag=e.target.checked;draw();};
      el.querySelectorAll('[data-id]').forEach(tr=>tr.onclick=async()=>{const {log}=await api(`/api/company/duty-logs/${tr.dataset.id}`);const v=el.querySelector('#v');v.innerHTML=`<div class="dl-acts" style="margin-bottom:8px"><button type="button" class="secondary" id="pr">🖨 列印</button></div>${viewHTML(log)}`;v.querySelector('#pr').onclick=()=>printLog(log);v.scrollIntoView({behavior:'smooth'});});};
    await draw();}};
})();
