// 代班、調假、加班、我的休假制度（現場 /api/staff 與內勤 /api/company/my 共用）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok){if(d.must_change_password)window.PasswordModule?.force(url.startsWith('/api/company')?'/api/company/my':'/api/staff');throw new Error(d.error||'操作失敗');}return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const WD='日一二三四五六';
  const dl=d=>{const x=new Date(`${d}T12:00:00`);return `${Number(d.slice(5,7))}/${Number(d.slice(8,10))}（${WD[x.getDay()]}）`;};
  const today=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
  function injectStyle(){
    if(document.getElementById('coverStyle'))return;
    const s=document.createElement('style');s.id='coverStyle';
    s.textContent=`
.cv-sec{margin:4px 0 18px}.cv-sec>h3{margin:0 0 8px;font-size:1.02rem;color:#5F403B}
.cv-list{display:grid;gap:10px}
.cv-card{border:1px solid #E2D3CC;border-radius:14px;padding:12px 14px;background:#fff}
.cv-card.req{border-left:4px solid #A44528}
.cv-top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
.cv-top h4{margin:0;font-size:.98rem}.cv-meta{font-size:.84rem;color:#5F403B;line-height:1.6}
.cv-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.74rem;font-weight:800;margin-left:6px;vertical-align:middle}
.cv-pill.open{background:#F6E3DC;color:#7A2E1A}.cv-pill.filled{background:#E8EEDF;color:#3E5328}.cv-pill.must{background:#A44528;color:#fff}.cv-pill.wait{background:#fff3e0;color:#a35a00}.cv-pill.no{background:#eee;color:#666}
.cv-cands{display:grid;gap:6px;margin-top:10px}
.cv-cand{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:7px 10px;border-radius:10px;background:#FCFAF1;border:1px solid #F1E7E1;font-size:.88rem}
.cv-cand.off{opacity:.55}.cv-cand small{color:#7A5F58;display:block}.cv-cand .hand{color:#A44528;font-weight:800}
.cv-acts{display:flex;gap:6px;flex-wrap:wrap}.cv-acts button,.cv-cand button{padding:5px 12px;min-height:0;margin:0}
.cv-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;max-width:720px}
.cv-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.88rem;margin:0}
.cv-form input,.cv-form select,.cv-form textarea{margin:0;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #DDCCC4;border-radius:8px;background:#fff;font:inherit}
.cv-form .wide{grid-column:1/-1}
.cv-info{background:#F6ECE6;border:1px solid #E2D3CC;border-radius:12px;padding:12px 14px;line-height:1.75;margin-bottom:14px}
.cv-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}.cv-tabs button{padding:7px 14px;min-height:0;border-radius:999px;margin:0}
.cv-tabs .badge{display:inline-block;background:#A44528;color:#fff;border-radius:999px;font-size:.72rem;padding:0 7px;margin-left:5px}
.cv-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;max-width:420px;margin-top:10px}
.cv-cal div{text-align:center;padding:6px 0;border-radius:8px;font-size:.84rem;background:#fff;border:1px solid #F1E7E1}
.cv-cal .h{background:transparent;border:0;color:#9A6654;font-weight:700}.cv-cal .red{background:#F6E3DC;color:#7A2E1A;font-weight:800;border-color:#EBCFC4}
.cv-table{width:100%;border-collapse:collapse;font-size:.86rem}.cv-table th,.cv-table td{padding:7px 9px;border-bottom:1px solid #F1E7E1;text-align:left}.cv-table th{background:#F6ECE6;font-size:.78rem}
@media(max-width:640px){.cv-form{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }
  const STATUS={open:['open','待安排'],filled:['filled','已安排'],not_needed:['no','不需代班'],cancelled:['no','已取消']};

  // ================= 代班 =================
  async function renderCover(box,{base='/api/staff',refresh}={}){
    injectStyle();
    const d=await api(`${base}/cover/needs`);
    const head=n=>`<h4>${dl(n.work_date)} ${esc(n.shift_label||'')}｜${esc(n.community||'—')}${n.required?'<span class="cv-pill must">一定要代班</span>':''}<span class="cv-pill ${STATUS[n.status]?.[0]||''}">${STATUS[n.status]?.[1]||n.status}</span></h4><div class="cv-meta">${esc(n.name)} 請假${n.hours<8?`（${n.hours} 小時）`:''}${n.assignee?`　→　代班：<b>${esc(n.assignee)}</b>`:''}${n.offers.length&&n.status==='open'?`　🙋 願意代班：${esc(n.offers.map(o=>o.name).join('、'))}`:''}</div>`;
    const dispatch=d.dispatch.map(n=>`<div class="cv-card${n.required?' req':''}"><div class="cv-top"><div>${head(n)}</div><div class="cv-acts">${n.status==='filled'?`<button type="button" class="secondary" data-unassign="${n.id}">改派</button>`:''}${n.status==='open'&&!n.required?`<button type="button" class="secondary" data-close="${n.id}">不需代班</button>`:''}</div></div>
      ${n.status==='open'?`<div class="cv-cands">${(n.candidates||[]).length?n.candidates.map(c=>`<div class="cv-cand${c.available?'':' off'}"><div>${c.offered?'<span class="hand">🙋 </span>':''}<b>${esc(c.name)}</b> <small>${esc(c.position||'')}${c.mobile?'・機動':''}${c.same_shift?'':'・不同班別'}｜${esc(c.reason)}</small></div><button type="button" ${c.available?'':'class="secondary"'} data-assign="${n.id}" data-sid="${c.staff_id}" data-ok="${c.available?1:0}">${c.available?'指派':'仍要指派'}</button></div>`).join(''):'<div class="cv-meta">找不到可以代班的人（同職務、同社區或機動人員）。</div>'}</div>`:''}</div>`).join('');
    const forMe=d.for_me.map(n=>`<div class="cv-card"><div class="cv-top"><div>${head(n)}<div class="cv-meta">${esc(n.me.reason)}</div></div><div class="cv-acts">${n.me.offered?`<button type="button" class="secondary" data-offer="${n.id}" data-withdraw="1">取消意願</button>`:`<button type="button" data-offer="${n.id}" ${n.me.available?'':'disabled'}>🙋 我可以代班</button>`}</div></div></div>`).join('');
    const mine=d.my_assignments.map(n=>`<div class="cv-card"><div class="cv-top"><div>${head(n)}</div></div></div>`).join('');
    const myLeave=d.my_leave.map(n=>`<div class="cv-card"><div class="cv-top"><div>${head(n)}</div></div></div>`).join('');
    box.innerHTML=`${d.is_dispatcher?`<div class="cv-sec"><h3>🧭 需要我調度的代班（${d.dispatch.filter(n=>n.status==='open').length} 待安排）</h3>${dispatch?`<div class="cv-list">${dispatch}</div>`:'<div class="empty">目前沒有代班需求。</div>'}<p class="hint">保全是 24 小時勤務，請假一定要安排代班；社區主管、副主管依申請人勾選；其他人員由部門主管視情況安排。系統只列出同職務、同社區（或機動）的人，並檢查當天是否休假、會不會連續上班超過上限。</p></div>`:''}
      <div class="cv-sec"><h3>🙋 我可以代的班</h3>${forMe?`<div class="cv-list">${forMe}</div>`:'<div class="empty">目前沒有需要您幫忙的班。</div>'}</div>
      ${mine?`<div class="cv-sec"><h3>📌 我的代班</h3><div class="cv-list">${mine}</div></div>`:''}
      ${myLeave?`<div class="cv-sec"><h3>📝 我請假的代班狀況</h3><div class="cv-list">${myLeave}</div></div>`:''}`;
    const again=()=>refresh?refresh():renderCover(box,{base,refresh});
    box.querySelectorAll('[data-offer]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`${base}/cover/needs/${b.dataset.offer}/offer`,J('POST',{withdraw:!!b.dataset.withdraw}));if(!b.dataset.withdraw)alert('已通知負責調度的主管，確認後會再通知您。');again();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-assign]').forEach(b=>b.addEventListener('click',async()=>{const force=b.dataset.ok!=='1';if(force&&!confirm('這位人員目前不符合代班條件，確定仍要指派嗎？'))return;try{await api(`${base}/cover/needs/${b.dataset.assign}/assign`,J('POST',{staff_id:Number(b.dataset.sid),force}));again();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-unassign]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('取消目前的代班人並重新安排？原代班人的班表會還原。'))return;try{await api(`${base}/cover/needs/${b.dataset.unassign}/unassign`,J('POST',{}));again();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',async()=>{const note=prompt('不需要代班的原因（例如：當天人力足夠）','人力足夠');if(note===null)return;try{await api(`${base}/cover/needs/${b.dataset.close}/close`,J('POST',{note}));again();}catch(e){alert(e.message);}}));
  }

  // ================= 調假 =================
  async function renderSwap(box,{base='/api/staff',refresh}={}){
    injectStyle();
    const d=await api(`${base}/cover/swaps`);
    const ST={pending:['wait','審核中'],approved:['filled','已核准'],rejected:['open','已退回'],cancelled:['no','已取消']};
    const row=s=>`<div class="cv-card"><div class="cv-top"><div><h4>${s.can_decide?`${esc(s.name)}｜`:''}${dl(s.off_date)} 休假 ↔ ${dl(s.work_date)} 上班<span class="cv-pill ${ST[s.status]?.[0]}">${ST[s.status]?.[1]||s.status}</span></h4><div class="cv-meta">${esc(s.community||'')}${s.reason?`｜${esc(s.reason)}`:''}${s.comment?`<br>主管：${esc(s.comment)}`:''}</div></div><div class="cv-acts">${s.can_decide?`<button type="button" data-sw="${s.id}" data-a="approve">✓ 核准</button><button type="button" class="danger" data-sw="${s.id}" data-a="reject">退回</button>`:''}${s.can_cancel?`<button type="button" class="secondary" data-swc="${s.id}">取消</button>`:''}</div></div></div>`;
    box.innerHTML=`<div class="cv-info">🔄 <b>調假</b>：把某一天的班和自己的休假日對調，<b>不用請假、不扣薪</b>。例如想 11/12 休息，就把 11/15 的休假改成上班。現場主管核准後班表自動更新。若沒辦法調假，再改用「申請請假」。</div>
      ${d.work_days.length&&d.off_days.length?`<form class="cv-form" id="swForm"><label>想休息的日子（原本上班）<select name="off_date">${d.work_days.map(x=>`<option value="${x}">${dl(x)}</option>`).join('')}</select></label><label>改成上班的休假日<select name="work_date">${d.off_days.map(x=>`<option value="${x}">${dl(x)}</option>`).join('')}</select></label><label class="wide">說明（可不填）<input name="reason" maxlength="300" placeholder="例如：家裡有事"></label><div class="wide"><button type="submit">送出調假</button></div></form>`:'<div class="empty">接下來 45 天的班表還沒排好，暫時無法調假。</div>'}
      ${d.todo.length?`<div class="cv-sec" style="margin-top:18px"><h3>✅ 待我審核的調假（${d.todo.length}）</h3><div class="cv-list">${d.todo.map(row).join('')}</div></div>`:''}
      <div class="cv-sec" style="margin-top:18px"><h3>📋 我的調假</h3>${d.mine.length?`<div class="cv-list">${d.mine.map(row).join('')}</div>`:'<div class="empty">還沒有調假紀錄。</div>'}</div>`;
    const again=()=>refresh?refresh():renderSwap(box,{base,refresh});
    box.querySelector('#swForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.target.elements;try{await api(`${base}/cover/swaps`,J('POST',{off_date:f.off_date.value,work_date:f.work_date.value,reason:f.reason.value}));alert('已送出，等待現場主管核准。');again();}catch(err){alert(err.message);}});
    box.querySelectorAll('[data-sw]').forEach(b=>b.addEventListener('click',async()=>{let comment='';if(b.dataset.a==='reject'){comment=prompt('退回原因：');if(!comment)return;}try{await api(`${base}/cover/swaps/${b.dataset.sw}/decide`,J('POST',{action:b.dataset.a,comment}));again();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-swc]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`${base}/cover/swaps/${b.dataset.swc}/cancel`,J('POST',{}));again();}catch(e){alert(e.message);}}));
  }

  // ================= 加班 =================
  const OT_ST={pending:['wait','審核中'],approved:['filled','已核准'],rejected:['open','已退回'],cancelled:['no','已取消']};
  const COMP={pay:'領加班費',comp:'換補休',choose:'本人選擇'};
  async function renderOvertime(el,{base='/api/staff',side='staff',label='加班',tab}={}){
    injectStyle();
    const S=renderOvertime.S||(renderOvertime.S={tab:'apply'});if(tab)S.tab=tab;
    const d=await api(`${base}/overtime`);
    let all=null;if(side==='company'){try{all=await api(`/api/company/overtime/all?month=${S.month||today().slice(0,7)}`);}catch{all=null;}}
    const tabs=[['apply','⏱ 申請加班'],['mine','📋 我的加班']];if(d.todo.length)tabs.push(['todo','✅ 待我審核']);if(all)tabs.push(['all','🗂 全部加班']);
    if(!tabs.some(t=>t[0]===S.tab))S.tab='apply';
    const T=d.types;const tInfo=t=>`${esc(t.hint||'')}｜${t.comp==='choose'?'可選擇領加班費或換補休':t.comp==='comp'?'換補休':'領加班費'}`;
    const card=o=>`<div class="cv-card"><div class="cv-top"><div><h4>${o.can_decide||all?`${esc(o.name)}｜`:''}${dl(o.work_date)} ${esc(o.type_name)} ${o.hours} 小時<span class="cv-pill ${OT_ST[o.status]?.[0]}">${OT_ST[o.status]?.[1]||o.status}</span>${o.source==='cover'?'<span class="cv-pill wait">代班</span>':''}</h4><div class="cv-meta">${o.start_time?`${esc(o.start_time)}～${esc(o.end_time)}｜`:''}${esc(o.community||'')}${o.reason?`｜${esc(o.reason)}`:''}<br>${o.comp_rule==='choose'?(o.comp_choice?`選擇：<b>${COMP[o.comp_choice]}</b>`:'<b style="color:#7A2E1A">尚未選擇領加班費或換補休</b>'):COMP[o.comp_rule]||''}${o.comment?`｜主管：${esc(o.comment)}`:''}</div></div><div class="cv-acts">${o.can_choose?`<button type="button" class="${o.comp_choice==='pay'?'':'secondary'}" data-ch="${o.id}" data-c="pay">💰 加班費</button><button type="button" class="${o.comp_choice==='comp'?'':'secondary'}" data-ch="${o.id}" data-c="comp">🌴 換補休</button>`:''}${o.can_decide?`<button type="button" data-od="${o.id}" data-a="approve">✓ 核准</button><button type="button" class="danger" data-od="${o.id}" data-a="reject">退回</button>`:''}${o.can_cancel?`<button type="button" class="secondary" data-oc="${o.id}">取消</button>`:''}</div></div></div>`;
    let body='';
    if(S.tab==='apply')body=`<div class="cv-info">⏱ 加班分成：${T.map(t=>`<b>${esc(t.name)}</b>`).join('、')}。依公司規定計算，休假日被請回或代班時可以選擇領加班費或換補休（依法換補休要本人同意）。送出後由現場主管（或直屬主管）核准。</div>
      <form class="cv-form" id="otForm"><label class="wide">加班種類<select name="ot_type">${T.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select><small class="muted" id="otHint" style="font-weight:400"></small></label>
      <label>日期<input type="date" name="work_date" value="${today()}"></label>${d.communities.length>1?`<label>社區<select name="community_id">${d.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>`:'<span></span>'}
      <label>開始時間<input type="time" name="start_time" value="19:00"></label><label>結束時間<input type="time" name="end_time" value="21:00"></label>
      <label class="wide" id="otChoice"></label>
      <label class="wide">事由<input name="reason" maxlength="300" placeholder="例如：區權會、社區主委請求支援"></label><div class="wide"><button type="submit">送出加班申請</button></div></form>`;
    if(S.tab==='mine')body=d.mine.length?`<div class="cv-list">${d.mine.map(card).join('')}</div>`:'<div class="empty">還沒有加班紀錄。</div>';
    if(S.tab==='todo')body=`<div class="cv-list">${d.todo.map(card).join('')}</div>`;
    if(S.tab==='all'&&all){const sum=all.rows.filter(o=>o.status!=='rejected').reduce((a,o)=>a+Number(o.hours||0),0);body=`<div class="cv-tabs"><input type="month" id="otMonth" value="${esc(all.month)}" style="width:auto;margin:0"><button type="button" class="secondary" id="otAdd">＋ 登錄加班</button><span class="cv-meta" style="align-self:center">本月 ${all.rows.length} 筆、${Math.round(sum*10)/10} 小時</span></div>${all.rows.length?`<div style="overflow:auto"><table class="cv-table"><thead><tr><th>日期</th><th>人員</th><th>種類</th><th>時數</th><th>狀態</th><th>領錢／補休</th><th>事由</th></tr></thead><tbody>${all.rows.map(o=>`<tr><td>${dl(o.work_date)}</td><td>${esc(o.name)}</td><td>${esc(o.type_name)}${o.source==='cover'?'（代班）':''}</td><td>${o.hours}</td><td>${OT_ST[o.status]?.[1]||o.status}</td><td>${o.comp_rule==='choose'?(COMP[o.comp_choice]||'待選擇'):COMP[o.comp_rule]||''}</td><td>${esc(o.reason||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">這個月沒有加班紀錄。</div>'}`;}
    el.innerHTML=`<div class="${side==='company'?'':'panel'}">${side==='company'?'':`<div class="eyebrow">📅 班表</div><h1>${esc(label)}</h1>`}<div class="cv-tabs">${tabs.map(([k,l])=>`<button type="button" data-tab="${k}" class="${S.tab===k?'':'secondary'}">${l}${k==='todo'?`<span class="badge">${d.todo.length}</span>`:''}</button>`).join('')}</div><div id="otBody">${body}</div></div>`;
    const again=()=>renderOvertime(el,{base,side,label});
    el.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{S.tab=b.dataset.tab;again().catch(e=>alert(e.message));}));
    const f=el.querySelector('#otForm');
    if(f){const sync=()=>{const t=T.find(x=>x.id===f.elements.ot_type.value);el.querySelector('#otHint').textContent=t?tInfo(t):'';el.querySelector('#otChoice').innerHTML=t?.comp==='choose'?`<span>領加班費或換補休</span><span style="display:flex;gap:16px;font-weight:600"><label style="flex-direction:row;gap:6px;align-items:center"><input type="radio" name="comp_choice" value="pay" checked style="width:auto"> 領加班費</label><label style="flex-direction:row;gap:6px;align-items:center"><input type="radio" name="comp_choice" value="comp" style="width:auto"> 換補休</label></span>`:'';};f.elements.ot_type.addEventListener('change',sync);sync();
      f.addEventListener('submit',async e=>{e.preventDefault();const v=k=>f.elements[k]?.value;try{await api(`${base}/overtime`,J('POST',{ot_type:v('ot_type'),work_date:v('work_date'),community_id:v('community_id')||null,start_time:v('start_time'),end_time:v('end_time'),reason:v('reason'),comp_choice:f.querySelector('[name=comp_choice]:checked')?.value||''}));alert('已送出，等待主管核准。');S.tab='mine';again();}catch(err){alert(err.message);}});}
    el.querySelectorAll('[data-ch]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`${base}/overtime/${b.dataset.ch}/choice`,J('POST',{comp_choice:b.dataset.c}));again();}catch(e){alert(e.message);}}));
    el.querySelectorAll('[data-od]').forEach(b=>b.addEventListener('click',async()=>{let comment='';if(b.dataset.a==='reject'){comment=prompt('退回原因：');if(!comment)return;}try{await api(`${base}/overtime/${b.dataset.od}/decide`,J('POST',{action:b.dataset.a,comment}));again();}catch(e){alert(e.message);}}));
    el.querySelectorAll('[data-oc]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`${base}/overtime/${b.dataset.oc}/cancel`,J('POST',{}));again();}catch(e){alert(e.message);}}));
    el.querySelector('#otMonth')?.addEventListener('change',e=>{S.month=e.target.value;again();});
    el.querySelector('#otAdd')?.addEventListener('click',()=>companyAdd(T,again));
  }
  async function companyAdd(T,done){
    const sc=await api('/api/company/schedule/staff').catch(()=>({staff:[],communities:[]}));
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" style="max-width:560px;width:min(560px,96vw)"><button type="button" class="modal-close">×</button><h2>＋ 登錄加班</h2><form class="cv-form" id="caForm"><label class="wide">人員<select name="staff_id">${sc.staff.map(u=>`<option value="${u.id}">${esc(u.name)} ${esc(u.employee_id)}</option>`).join('')}</select></label><label class="wide">種類<select name="ot_type">${T.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><label>日期<input type="date" name="work_date" value="${today()}"></label><label>社區<select name="community_id"><option value="">不指定</option>${sc.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><label>開始<input type="time" name="start_time" value="19:00"></label><label>結束<input type="time" name="end_time" value="21:00"></label><label class="wide">事由<input name="reason"></label><div class="wide modal-actions"><button type="submit">登錄（直接核准）</button></div></form></div>`;
    document.body.appendChild(box);const close=()=>box.remove();box.querySelector('.modal-close').onclick=close;
    box.querySelector('#caForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.target.elements;try{await api('/api/company/overtime',J('POST',{staff_id:Number(f.staff_id.value),ot_type:f.ot_type.value,work_date:f.work_date.value,community_id:f.community_id.value||null,start_time:f.start_time.value,end_time:f.end_time.value,reason:f.reason.value}));close();done();}catch(err){alert(err.message);}});
  }

  // ================= 我的休假制度 =================
  async function renderMyRule(el,{base='/api/staff',label='我的休假制度'}={}){
    injectStyle();
    const r=await api(`${base}/schedule/my-rule`);
    const [y,m]=r.month.split('-').map(Number);const first=new Date(y,m-1,1).getDay();const reds=new Set(r.red_days);
    const cal=`<div class="cv-cal">${[...'日一二三四五六'].map(x=>`<div class="h">${x}</div>`).join('')}${Array.from({length:first},()=>'<div style="border:0;background:transparent"></div>').join('')}${Array.from({length:r.days_in_month},(_,i)=>{const d=`${r.month}-${String(i+1).padStart(2,'0')}`;return `<div class="${reds.has(d)?'red':''}">${i+1}</div>`;}).join('')}</div>`;
    const showCal=r.mode==='red_holiday'||r.mode==='rotation';
    el.innerHTML=`<div class="panel"><div class="eyebrow">📅 班表</div><h1>${esc(label)}</h1>
      <div class="cv-info" style="font-size:1rem"><b style="font-size:1.1rem">${esc(r.mode_label)}</b>${r.community?`｜${esc(r.community)}`:''}${r.position?`｜${esc(r.position)}`:''}<br>${esc(r.text)}</div>
      <div class="cv-meta" style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:6px"><span>${m} 月休假：<b>${r.rest_days} 天</b></span>${r.self_select_days?`<span>可自選：<b>${r.self_select_days} 天</b></span>`:''}${r.max_consecutive?`<span>最多連續上班：<b>${r.max_consecutive} 天</b></span>`:''}</div>
      ${showCal?`<div class="cv-meta">${m} 月行事曆（紅色是週末、國定假日與補假，共 ${r.red_count} 天）</div>${cal}`:''}
      ${r.self_select_days?'<p style="margin-top:14px"><button type="button" id="goSelf">前往自選休假 ›</button></p>':''}</div>`;
    el.querySelector('#goSelf')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:'staff-schedule-self-select',label:'自選休假'}})));
  }

  window.CoverModule={renderCover,renderSwap,renderOvertime,renderMyRule};
})();
