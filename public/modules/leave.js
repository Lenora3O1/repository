// 請假：現場工作台（/api/staff）與公司內勤（/api/company/my）共用。
// 分頁：申請請假、我的假單、待我審核；公司內勤另有全部假單、假別額度（人事）、審核人員設定（公司管理員）。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={el:null,base:'/api/staff',side:'staff',label:'請假',tab:'apply',meta:null};
  const payText=p=>p>=1?'全薪':p>0?`${Math.round(p*100)}% 給薪`:'不給薪';
  const proofText=t=>t.proof==='required'?`需要證明（${S.meta?.proof_days||7} 日內補交）`:t.proof==='optional'?'可附證明':'不需證明';
  const addDays=(s,n)=>{const x=new Date(`${s}T00:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const tw=iso=>{try{return new Date(iso).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return String(iso||'').slice(0,16);}};
  const when=r=>r.start_date===r.end_date?r.start_date:`${r.start_date}～${r.end_date}`;
  const STATUS_CLS={pending:'wait',approved:'ok',rejected:'no',cancelled:'off'};

  function injectStyle(){
    if(document.getElementById('leaveStyle'))return;
    const s=document.createElement('style');s.id='leaveStyle';
    s.textContent=`
.lv-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}.lv-tabs button{padding:7px 14px;min-height:0;border-radius:999px;margin:0}
.lv-tabs .badge{display:inline-block;background:#d64545;color:#fff;border-radius:999px;font-size:.72rem;padding:0 7px;margin-left:5px}
.lv-bal{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:4px 0 14px}
.lv-bal div{border:1px solid #E9E3E1;border-radius:12px;padding:9px 12px;background:#fff}.lv-bal span{display:block;font-size:.76rem;color:#70635F;font-weight:700}.lv-bal b{font-size:1.15rem}.lv-bal small{color:#8A7E7A}
.lv-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;max-width:760px}
.lv-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.88rem;margin:0}
.lv-form input,.lv-form select,.lv-form textarea{margin:0;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.lv-form .wide{grid-column:1/-1}.lv-form .req>.lt::after{content:' *';color:#d64545}
.lv-form .chk{flex-direction:row;align-items:center;gap:8px;font-weight:600}.lv-form .chk input{width:auto}
.lv-type-info{background:#F8F6F4;border:1px solid #E6E0DD;border-radius:10px;padding:9px 12px;font-size:.84rem;line-height:1.7}
.lv-prev{border-radius:10px;padding:10px 14px;font-size:.88rem;line-height:1.7}
.lv-prev.ok{background:#EEF2E6;border:1px solid #C9D6B5}.lv-prev.err{background:#fdf0ef;border:1px solid #f1c4bf;color:#9b2c22}
.lv-warn{color:#8a5a00}
.lv-list{display:grid;gap:10px}
.lv-card{border:1px solid #E9E3E1;border-radius:14px;padding:12px 14px;background:#fff;display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.lv-card h4{margin:0 0 3px;font-size:1rem}.lv-card .meta{font-size:.84rem;color:#70635F;line-height:1.6}
.lv-card .acts{display:flex;gap:6px;flex-wrap:wrap}.lv-card .acts button{padding:6px 12px;min-height:0;margin:0}
.lv-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;font-size:.76rem;margin-left:6px;vertical-align:middle}
.lv-pill.wait{background:#fff3e0;color:#a35a00}.lv-pill.ok{background:#E8EEDF;color:#3E5328}.lv-pill.no{background:#fde8e6;color:#a8322a}.lv-pill.off{background:#eee;color:#777}
.lv-pill.proof{background:#e6f2fb;color:#1e5f8c}.lv-pill.bad{background:#d64545;color:#fff}
.lv-steps{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:6px 0;font-size:.82rem}
.lv-steps span{padding:3px 10px;border-radius:999px;background:#F3F1F0;color:#7A6E6A}.lv-steps span.done{background:#E8EEDF;color:#3E5328}.lv-steps span.current{background:#fff3e0;color:#a35a00;font-weight:800}.lv-steps span.skip{text-decoration:line-through;opacity:.6}
.lv-log{font-size:.82rem;color:#70635F;border-left:3px solid #E9E3E1;padding-left:10px;margin:8px 0;line-height:1.7}
.lv-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px}
.lv-table{border-collapse:collapse;min-width:100%;font-size:.86rem;white-space:nowrap}.lv-table th,.lv-table td{padding:7px 10px;border-bottom:1px solid #F2EFEE;text-align:left}.lv-table th{background:#F6F4F2;font-size:.78rem}
.lv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.lv-bar select,.lv-bar input{width:auto;margin:0;padding:7px 10px}.lv-bar button{padding:7px 12px;min-height:0;margin:0}
.lv-step{border:1px solid #E9E3E1;border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#fff}
.lv-step h4{margin:0 0 6px}.lv-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px 12px;max-height:260px;overflow:auto;margin-top:8px}
.lv-people label{display:flex;gap:6px;align-items:flex-start;font-size:.85rem;font-weight:500;margin:0}.lv-people input{width:auto;margin-top:3px}
.lv-files a{display:inline-block;margin:2px 8px 2px 0}
@media(max-width:700px){.lv-form{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }
  function modal(title,body){
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-width:680px;width:min(680px,96vw);max-height:92vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button>${title?`<h2>${title}</h2>`:''}${body}</div>`;
    document.body.appendChild(box);document.body.classList.add('modal-open');
    const close=()=>{box.remove();document.body.classList.remove('modal-open');};
    box.querySelector('.modal-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    return {box,close};
  }
  const pill=r=>`<span class="lv-pill ${STATUS_CLS[r.status]||''}">${esc(r.status_label)}${r.status==='pending'&&r.current_step?`・${esc(r.current_step)}`:''}</span>${r.absent?'<span class="lv-pill bad">曠職</span>':r.proof_label?`<span class="lv-pill proof">${esc(r.proof_label)}</span>`:''}`;
  const steps=r=>`<div class="lv-steps">${r.steps.map((s,i)=>`${i?'→':''}<span class="${s.skipped?'skip':s.state}" title="${esc(s.skipped?(s.note||'略過'):(s.approvers.join('、')+((s.proxies||[]).length?`（代理：${s.proxies.join('、')}）`:'')))}">${esc(s.name)}${!s.skipped&&s.approvers.length&&s.approvers.length<=2?`<small>・${esc(s.approvers.join('、'))}</small>`:''}</span>`).join('')}</div>`;

  // ================= 主畫面 =================
  async function render(el,opts={}){
    injectStyle();
    S.el=el;S.base=opts.base||S.base;S.side=opts.side||(S.base.startsWith('/api/company')?'company':'staff');S.label=opts.label||S.label;if(opts.tab)S.tab=opts.tab;
    S.meta=await api(`${S.base}/leave/meta`);
    const m=S.meta;
    const tabs=[['apply','📝 申請請假'],['mine','📋 我的假單']];
    if(m.is_approver||m.pending_for_me)tabs.push(['approve','✅ 待我審核']);
    if(S.side==='company'&&m.can_manage)tabs.push(['all','🗂 全部假單'],['balance','📊 假別額度']);
    if(S.side==='company')tabs.push(['setup',m.is_admin?'⚙ 審核設定':'📖 請假規則']);
    if(!tabs.some(t=>t[0]===S.tab))S.tab='apply';
    el.innerHTML=`<div class="panel"><div class="eyebrow">📝 請假</div><h1>${esc(S.label)}</h1>
      <div class="lv-tabs">${tabs.map(([k,l])=>`<button type="button" data-tab="${k}" class="${S.tab===k?'':'secondary'}">${l}${k==='approve'&&m.pending_for_me?`<span class="badge">${m.pending_for_me}</span>`:''}</button>`).join('')}</div>
      <div id="lvBody"><div class="profile-loading">讀取中…</div></div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{S.tab=b.dataset.tab;render(el).catch(e=>alert(e.message));}));
    const body=el.querySelector('#lvBody');
    const fn={apply:renderApply,mine:renderMine,approve:renderApprove,all:renderAll,balance:renderBalance,setup:renderSetup}[S.tab];
    try{await fn(body);}catch(e){body.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;}
  }
  const refresh=()=>render(S.el).catch(e=>alert(e.message));

  function balanceCards(b,hpd){
    const out=[];const D=v=>Number.isInteger(v*2)?v:`${v}<small>（${Math.round(v*hpd*10)/10} 小時）</small>`;
    if(b.annual)out.push(b.annual.days?`<div><span>特休（本期）</span><b>剩 ${b.annual.left} 天</b><small>／${b.annual.days} 天${b.annual.pending?`，審核中 ${b.annual.pending}`:''}<br>${esc(b.annual.start)}～${esc(b.annual.end)}</small></div>`:`<div><span>特休</span><b>—</b><small>${esc(b.annual.next_date)} 起 ${b.annual.next_days} 天</small></div>`);
    else out.push('<div><span>特休</span><b>—</b><small>人事尚未登記到職日</small></div>');
    if(b.personal)out.push(`<div><span>事假（今年）</span><b>${D(b.personal.used)}／${b.personal.quota} 天</b>${b.personal.pending?`<small>審核中 ${b.personal.pending}</small>`:''}</div>`);
    if(b.family)out.push(`<div><span>家庭照顧假（今年）</span><b>${D(b.family.used)}／${b.family.quota} 天</b><small>併入事假</small></div>`);
    if(b.sick)out.push(`<div><span>病假（未住院，今年）</span><b>${D(b.sick.used)}／${b.sick.quota} 天</b>${b.sick.hospital?`<small>住院 ${b.sick.hospital} 天</small>`:''}</div>`);
    if(b.comp)out.push(`<div><span>補休</span><b>${b.comp.hours} 小時</b></div>`);
    return `<div class="lv-bal">${out.join('')}</div>`;
  }

  // ---------- 申請 ----------
  async function renderApply(box){
    const m=S.meta;const T0=m.types[0];
    box.innerHTML=`${balanceCards(m.balances,m.hours_per_day)}
      ${m.gender_missing?'<div class="lv-prev err" style="margin-bottom:10px">人事資料尚未登記您的性別，生理假、產假、產檢假暫時無法選擇；如需申請請洽人事。</div>':''}
      <form class="lv-form" id="lvForm">
        <label class="wide">假別<select name="type">${m.types.map(t=>`<option value="${esc(t.key)}">${esc(t.name)}</option>`).join('')}</select></label>
        <div class="wide lv-type-info" id="lvInfo"></div>
        <label id="lvSubWrap" class="wide"><span class="lt">類別</span><select name="sub"></select></label>
        <label id="lvEventWrap" class="req"><span class="lt">事由日期</span><input type="date" name="event_date"></label>
        <label class="req"><span class="lt">開始日期</span><input type="date" name="start_date" value="${esc(m.today)}"></label>
        <label class="req"><span class="lt">結束日期</span><input type="date" name="end_date" value="${esc(m.today)}"></label>
        <div class="wide" id="lvHoursWrap"></div>
        <label class="wide" id="lvReasonWrap"><span class="lt">原因說明</span><textarea name="reason" rows="2" maxlength="500" placeholder="例如：家中有事、看診"></textarea></label>
        <label class="wide" id="lvFileWrap">證明文件（照片或 PDF，可稍後再補）<input type="file" name="files" accept="image/*,application/pdf" multiple></label>
        <div class="wide" id="lvPrev"></div>
        <div class="wide modal-actions" style="justify-content:flex-start"><button type="submit" id="lvSubmit">📨 送出假單</button></div>
      </form>
      <p class="hint" style="margin-top:12px">請假單位：${m.unit==='hour'?'1 小時':m.unit==='half'?'半天':'1 天'}（每天 ${m.hours_per_day} 小時；家庭照顧假可以小時請假）。只計算需要上班的日子：有班表依班表，沒有班表時扣除例假日與國定假日。審核流程：${esc(m.flow.map(s=>s.name+(s.min_days?`（${s.min_days} 天以上）`:'')).join(' → ')||'公司管理員')}。</p>`;
    const f=box.querySelector('#lvForm');const E=k=>f.elements[k];
    const cur=()=>m.types.find(t=>t.key===E('type').value)||T0;
    let lastSub='';
    function sync(){
      const t=cur();
      box.querySelector('#lvInfo').innerHTML=`<b>${esc(t.name)}</b>：${esc(t.hint||'')}<br>給薪：${payText(t.pay)}${t.full_pay_days?`（每年前 ${t.full_pay_days} 天公司給全薪）`:''}｜${proofText(t)}${t.quota?`｜上限 ${t.quota} 天${t.per==='month'?'／月':t.per==='event'?'／每次事由':'／年'}`:''}${t.att==='none'?'｜不影響全勤':t.att==='prorate'?'｜全勤獎金按比例扣':'｜全勤獎金不發'}`;
      const sw=box.querySelector('#lvSubWrap');sw.style.display=t.subs.length?'':'none';
      if(t.subs.length&&lastSub!==t.key){E('sub').innerHTML=t.subs.map(s=>`<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('');lastSub=t.key;}
      sw.querySelector('.lt').textContent=t.key==='funeral'?'親屬關係':t.key==='maternity'?'產假類型':'類別';
      const ew=box.querySelector('#lvEventWrap');ew.style.display=t.event?'':'none';ew.querySelector('.lt').textContent=t.event||'事由日期';
      box.querySelector('#lvReasonWrap').classList.toggle('req',!!t.reason);
      box.querySelector('#lvFileWrap').style.display=t.proof==='none'?'none':'';
      // 產假依日曆天：自動帶出結束日期
      if(t.key==='maternity'&&E('start_date').value){const s=t.subs.find(x=>x.value===E('sub').value);if(s)E('end_date').value=addDays(E('start_date').value,s.days-1);}
      const one=E('start_date').value&&E('start_date').value===E('end_date').value;
      const unit=t.hourly||t.key==='comp'?'hour':m.unit;
      const hw=box.querySelector('#lvHoursWrap');const prev=hw.querySelector('[name=hours]')?.value;
      if(one&&unit!=='day'&&!t.calendar){hw.innerHTML=unit==='half'?`<label class="chk" style="display:inline-flex;margin-right:14px"><input type="radio" name="hmode" value="${m.hours_per_day}" checked> 整天</label><label class="chk" style="display:inline-flex"><input type="radio" name="hmode" value="${m.hours_per_day/2}"> 半天（${m.hours_per_day/2} 小時）</label><input type="hidden" name="hours">`:`<label style="max-width:240px">請假時數（小時）<input type="number" name="hours" min="1" max="${m.hours_per_day}" step="1" value="${prev||m.hours_per_day}"></label>`;
        if(unit==='half'){const hid=hw.querySelector('[name=hours]');const upd=()=>{hid.value=hw.querySelector('[name=hmode]:checked').value;};hw.querySelectorAll('[name=hmode]').forEach(r=>{if(prev&&r.value===prev)r.checked=true;r.addEventListener('change',()=>{upd();preview();});});upd();}
      }else hw.innerHTML='';
    }
    const read=()=>({type:E('type').value,sub:E('sub').value,event_date:E('event_date').value,start_date:E('start_date').value,end_date:E('end_date').value,hours:f.querySelector('[name=hours]')?.value||'',reason:E('reason').value});
    let timer,seq=0;
    async function preview(){
      clearTimeout(timer);timer=setTimeout(async()=>{const my=++seq;const pv=box.querySelector('#lvPrev');
        try{const p=await api(`${S.base}/leave/preview`,J('POST',read()));if(my!==seq)return;
          pv.innerHTML=`<div class="lv-prev ok">共 <b>${esc(p.length)}</b>（${p.dates.length} 個上班日：${esc(p.dates.length>6?p.dates.slice(0,3).join('、')+'…'+p.dates.slice(-2).join('、'):p.dates.join('、'))}）｜${payText(p.pay_ratio)}<br>審核：${esc(p.steps.join(' → ')||'自動核准')}${p.proof_due?`<br>📎 證明請在 <b>${esc(p.proof_due)}</b> 前上傳${m.overdue_action==='absent'?'，逾期視為曠職':''}`:''}${(p.warnings||[]).map(w=>`<div class="lv-warn">⚠ ${esc(w)}</div>`).join('')}</div>`;
          box.querySelector('#lvSubmit').disabled=false;
        }catch(e){if(my!==seq)return;const t=cur();const missingReason=t.reason&&!E('reason').value.trim()&&/原因/.test(e.message);pv.innerHTML=missingReason?'':`<div class="lv-prev err">${esc(e.message)}</div>`;}
      },250);
    }
    f.addEventListener('change',e=>{if(e.target.name==='start_date'&&E('end_date').value<E('start_date').value)E('end_date').value=E('start_date').value;if(e.target.name!=='files'){sync();preview();}});
    f.addEventListener('input',e=>{if(['reason','hours'].includes(e.target.name))preview();});
    sync();preview();
    f.addEventListener('submit',async e=>{e.preventDefault();const btn=box.querySelector('#lvSubmit');btn.disabled=true;
      try{const r=await api(`${S.base}/leave/requests`,J('POST',read()));
        const files=E('files').files;if(files&&files.length){const fd=new FormData();for(const x of files)fd.append('files',x);await fetch(`${S.base}/leave/requests/${r.request.id}/files`,{method:'POST',body:fd,credentials:'same-origin'}).then(async x=>{if(!x.ok){const d=await x.json().catch(()=>({}));alert(`假單已送出，但證明上傳失敗：${d.error||''}\n可以到「我的假單」再補上傳。`);}});}
        alert(r.request.status==='approved'?'假單已核准。':`假單已送出，等待「${r.request.current_step}」審核。`);S.tab='mine';refresh();
      }catch(err){alert(err.message);btn.disabled=false;}});
  }

  // ---------- 我的假單 ----------
  function card(r,{who=false,actions=''}={}){
    return `<div class="lv-card"><div style="flex:1;min-width:220px"><h4>${who?`${esc(r.name)} <small class="muted">${esc(r.employee_id)}</small>｜`:''}${esc(r.type_name)}${r.sub_label?` <small class="muted">${esc(r.sub_label)}</small>`:''}${pill(r)}</h4>
      <div class="meta">📅 ${esc(when(r))}　⏱ ${esc(r.length)}${r.reason?`<br>📝 ${esc(r.reason)}`:''}${r.proof_status==='pending'?`<br>📎 證明請在 <b>${esc(r.proof_due)}</b> 前上傳`:''}</div>${steps(r)}</div>
      <div class="acts"><button type="button" class="secondary" data-open="${r.id}">詳細</button>${actions}</div></div>`;
  }
  async function renderMine(box){
    const {requests}=await api(`${S.base}/leave/requests`);
    box.innerHTML=requests.length?`<div class="lv-list">${requests.map(r=>card(r,{actions:`${r.can.upload&&['pending','overdue','none'].includes(r.proof_status)?`<button type="button" data-up="${r.id}">📎 上傳證明</button>`:''}${r.can.cancel?`<button type="button" class="danger" data-cancel="${r.id}">取消</button>`:''}`})).join('')}</div>`:'<div class="empty">還沒有假單。</div>';
    bindCards(box,requests);
  }
  function bindCards(box,list){
    box.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openDetail(Number(b.dataset.open))));
    box.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>pickUpload(Number(b.dataset.up))));
    box.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('確定取消這張假單？'))return;try{await api(`${S.base}/leave/requests/${b.dataset.cancel}/cancel`,J('POST',{}));refresh();}catch(e){alert(e.message);}}));
    box.querySelectorAll('[data-approve]').forEach(b=>b.addEventListener('click',()=>decide(Number(b.dataset.approve),'approve')));
    box.querySelectorAll('[data-reject]').forEach(b=>b.addEventListener('click',()=>decide(Number(b.dataset.reject),'reject')));
  }
  function pickUpload(id,after){
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*,application/pdf';inp.multiple=true;
    inp.onchange=async()=>{if(!inp.files.length)return;const fd=new FormData();for(const x of inp.files)fd.append('files',x);
      try{const r=await fetch(`${S.base}/leave/requests/${id}/files`,{method:'POST',body:fd,credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'上傳失敗');alert('證明已上傳。');after?after():refresh();}catch(e){alert(e.message);}};
    inp.click();
  }
  async function decide(id,action,after){
    let comment='';
    if(action==='reject'){comment=prompt('退回原因（會通知申請人）：');if(comment===null)return;if(!comment.trim()){alert('請填寫退回原因');return;}}
    else if(!confirm('確定核准這張假單？'))return;
    try{await api(`${S.base}/leave/requests/${id}/decide`,J('POST',{action,comment}));after?after():refresh();}catch(e){alert(e.message);}
  }
  const ACT={submit:'送出申請',approve:'核准',admin_approve:'公司管理員核准',reject:'退回',cancel:'取消',revoke:'人事撤銷',proof_upload:'上傳證明',proof_verify:'確認證明',proof_waive:'免附證明',proof_reject:'要求重新補件',overdue:'證明逾期'};
  async function openDetail(id){
    const {request:r}=await api(`${S.base}/leave/requests/${id}`);
    const hr=S.side==='company'&&r.can.manage;
    const {box,close}=modal(`${esc(r.type_name)}｜${esc(r.name)}`,`<div>${pill(r)}</div>
      <div class="lv-card" style="margin-top:10px;display:block"><div class="meta">📅 ${esc(when(r))}　⏱ ${esc(r.length)}　💰 ${payText(r.pay_ratio)}${r.sub_label?`<br>類別：${esc(r.sub_label)}`:''}${r.event_date?`<br>事由日期：${esc(r.event_date)}`:''}${r.reason?`<br>原因：${esc(r.reason)}`:''}<br>上班日：${esc(r.entries.map(e=>`${e.d}${e.h<(S.meta.hours_per_day||8)?`（${e.h} 小時）`:''}`).join('、'))}${r.proof_req!=='none'?`<br>證明：${esc(r.proof_label||'可附')}${r.proof_due?`（期限 ${esc(r.proof_due)}）`:''}`:''}</div>${steps(r)}</div>
      ${r.files.length?`<div class="lv-files" style="margin:8px 0"><b>📎 證明文件</b><br>${r.files.map(f=>`<a href="${S.base}/leave/files/${f.id}" target="_blank" rel="noopener">${esc(f.original||'檔案')}</a>`).join('')}</div>`:''}
      <div class="lv-log">${r.actions.map(a=>`${esc(tw(a.at))}　${esc(a.actor)}　${esc(ACT[a.action]||a.action)}${a.step_name?`（${esc(a.step_name)}）`:''}${a.comment?`：${esc(a.comment)}`:''}`).join('<br>')}</div>
      <div class="modal-actions" style="flex-wrap:wrap">${r.can.decide?'<button type="button" id="dAp">✓ 核准</button><button type="button" class="danger" id="dRj">退回</button>':''}${r.can.upload?'<button type="button" class="secondary" id="dUp">📎 上傳證明</button>':''}${hr&&r.proof_req!=='none'&&['submitted','pending','overdue'].includes(r.proof_status)?'<button type="button" class="secondary" id="dPv">✓ 證明無誤</button><button type="button" class="secondary" id="dPw">免附證明</button>':''}${hr&&r.files.length&&['submitted','verified'].includes(r.proof_status)?'<button type="button" class="secondary" id="dPr">要求重新補件</button>':''}${hr&&['pending','approved'].includes(r.status)?'<button type="button" class="danger" id="dRv">撤銷假單</button>':''}${r.can.cancel?'<button type="button" class="danger" id="dCc">取消假單</button>':''}</div>`);
    const acts=box.querySelector('.modal-actions');if(acts&&!acts.children.length)acts.remove();
    const again=()=>{close();openDetail(id);refreshQuiet();};
    box.querySelector('#dAp')?.addEventListener('click',()=>decide(id,'approve',again));
    box.querySelector('#dRj')?.addEventListener('click',()=>decide(id,'reject',again));
    box.querySelector('#dUp')?.addEventListener('click',()=>pickUpload(id,again));
    const proof=async(action)=>{let comment='';if(action==='reject'){comment=prompt('需要重新補件的原因：');if(comment===null)return;}try{await api(`/api/company/leave/requests/${id}/proof`,J('POST',{action,comment}));again();}catch(e){alert(e.message);}};
    box.querySelector('#dPv')?.addEventListener('click',()=>proof('verify'));
    box.querySelector('#dPw')?.addEventListener('click',()=>proof('waive'));
    box.querySelector('#dPr')?.addEventListener('click',()=>proof('reject'));
    box.querySelector('#dRv')?.addEventListener('click',async()=>{const c=prompt('撤銷原因（會通知申請人）：');if(!c)return;try{const d=await api(`/api/company/leave/requests/${id}/revoke`,J('POST',{comment:c}));if(d.warning)alert(d.warning);again();}catch(e){alert(e.message);}});
    box.querySelector('#dCc')?.addEventListener('click',async()=>{if(!confirm('確定取消這張假單？'))return;try{await api(`${S.base}/leave/requests/${id}/cancel`,J('POST',{}));again();}catch(e){alert(e.message);}});
  }
  let quietTimer;function refreshQuiet(){clearTimeout(quietTimer);quietTimer=setTimeout(()=>render(S.el).catch(()=>{}),100);}

  // ---------- 待我審核 ----------
  async function renderApprove(box){
    const {pending,done}=await api(`${S.base}/leave/approvals`);
    box.innerHTML=`<h3 style="margin:0 0 8px">待審核（${pending.length}）</h3>${pending.length?`<div class="lv-list">${pending.map(r=>card(r,{who:true,actions:`<button type="button" data-approve="${r.id}">✓ 核准</button><button type="button" class="danger" data-reject="${r.id}">退回</button>`})).join('')}</div>`:'<div class="empty">目前沒有需要您審核的假單。</div>'}
      ${done.length?`<h3 style="margin:18px 0 8px">我處理過的</h3><div class="lv-list">${done.slice(0,30).map(r=>card(r,{who:true})).join('')}</div>`:''}`;
    bindCards(box,[...pending,...done]);
  }

  // ---------- 全部假單（人事） ----------
  async function renderAll(box){
    S.f=S.f||{month:new Date().toISOString().slice(0,7),status:'',proof:''};
    const q=new URLSearchParams();if(S.f.month)q.set('month',S.f.month);if(S.f.status)q.set('status',S.f.status);if(S.f.proof)q.set('proof',S.f.proof);
    const {requests}=await api(`/api/company/leave/requests?${q}`);
    box.innerHTML=`<div class="lv-bar"><input type="month" id="fM" value="${esc(S.f.month)}"><select id="fS"><option value="">全部狀態</option>${[['pending','審核中'],['approved','已核准'],['rejected','已退回'],['cancelled','已取消']].map(([v,l])=>`<option value="${v}" ${S.f.status===v?'selected':''}>${l}</option>`).join('')}</select><label class="chk" style="display:flex;gap:6px;align-items:center;margin:0;font-weight:600"><input type="checkbox" id="fP" style="width:auto" ${S.f.proof?'checked':''}> 只看證明待處理</label><button type="button" class="secondary" id="fClr">全部月份</button></div>
      ${requests.length?`<div class="lv-wrap"><table class="lv-table"><thead><tr><th>人員</th><th>假別</th><th>日期</th><th>時數</th><th>狀態</th><th>證明</th><th></th></tr></thead><tbody>${requests.map(r=>`<tr><td><b>${esc(r.name)}</b> <small class="muted">${esc(r.employee_id)}</small></td><td>${esc(r.type_name)}${r.sub_label?`<br><small class="muted">${esc(r.sub_label)}</small>`:''}</td><td>${esc(when(r))}</td><td>${esc(r.length)}</td><td>${esc(r.status_label)}${r.status==='pending'?`<br><small class="muted">${esc(r.current_step)}</small>`:''}</td><td>${r.absent?'<span class="lv-pill bad">曠職</span>':esc(r.proof_label||'—')}${r.proof_status==='pending'?`<br><small class="muted">期限 ${esc(r.proof_due)}</small>`:''}</td><td><button type="button" class="secondary" data-open="${r.id}" style="padding:5px 12px;min-height:0">詳細</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">沒有符合條件的假單。</div>'}`;
    box.querySelector('#fM').addEventListener('change',e=>{S.f.month=e.target.value;renderAll(box).catch(x=>alert(x.message));});
    box.querySelector('#fS').addEventListener('change',e=>{S.f.status=e.target.value;renderAll(box).catch(x=>alert(x.message));});
    box.querySelector('#fP').addEventListener('change',e=>{S.f.proof=e.target.checked?'todo':'';renderAll(box).catch(x=>alert(x.message));});
    box.querySelector('#fClr').addEventListener('click',()=>{S.f.month='';renderAll(box).catch(x=>alert(x.message));});
    bindCards(box,requests);
  }

  // ---------- 假別額度（人事） ----------
  async function renderBalance(box){
    const d=await api('/api/company/leave/balances');const y=new Date().getFullYear();
    box.innerHTML=`<p class="hint">今年（${y}）各人員的請假使用狀況（已核准；括號為審核中）。特休依到職日自動計算，包含人事登記的「系統外已休」。</p><div class="lv-wrap"><table class="lv-table"><thead><tr><th>人員</th><th>性別</th><th>特休剩餘</th><th>事假</th><th>家庭照顧假</th><th>病假（未住院）</th><th>住院病假</th><th>生理假（今年）</th>${d.policy.overtime_mode==='comp'?'<th>補休</th>':''}</tr></thead><tbody>${d.rows.map(r=>{const b=r.balances;const pp=x=>x?.pending?` <small class="muted">(${x.pending})</small>`:'';return `<tr><td><b>${esc(r.name)}</b> <small class="muted">${esc(r.employee_id)}</small></td><td>${r.gender==='F'?'女':r.gender==='M'?'男':'<span class="muted">未登記</span>'}</td><td>${b.annual?(b.annual.days?`${b.annual.left}／${b.annual.days} 天${pp(b.annual)}`:`<small class="muted">${esc(b.annual.next_date)} 起</small>`):'<span class="muted">無到職日</span>'}</td><td>${b.personal.used}／${b.personal.quota}${pp(b.personal)}</td><td>${b.family.used}／${b.family.quota}${pp(b.family)}</td><td>${b.sick.used}／${b.sick.quota}${pp(b.sick)}${b.sick.used>10?' <span class="lv-pill wait">超過 10 日</span>':''}</td><td>${b.sick.hospital||0}</td><td>${b.menstrual.year_used}</td>${d.policy.overtime_mode==='comp'?`<td>${b.comp?.hours??0} 小時</td>`:''}</tr>`;}).join('')}</tbody></table></div>`;
  }

  // ---------- 審核人員設定（公司管理員） ----------
  async function renderSetup(box){
    const d=await api('/api/company/leave/approvers');const P=d.policy;const sel={};for(const s of d.flow)sel[s.id]=new Set(d.approvers[s.id]||[]);
    const rules=`<div class="lv-type-info" style="margin-bottom:12px"><b>本公司請假規則</b>（由平台總後台依公司需求設定）<br>請假單位：${P.unit==='hour'?'1 小時':P.unit==='half'?'半天':'1 天'}，每天 ${P.hours_per_day} 小時｜證明補交：${P.proof_days} 日內，逾期${P.overdue_action==='absent'?'視為曠職':'只提醒'}｜日薪：${P.daily_wage_mode==='workdays'?'月薪 ÷ 當月應出勤日':'月薪 ÷ 30'}${P.wage_includes_allowances?'（含固定加給）':''}，時薪＝日薪 ÷ ${P.hours_per_day}｜加班：${P.overtime_mode==='comp'?'換補休':P.overtime_mode==='allowance'?`${esc(P.overtime_allowance?.name||'支援費')} ${P.overtime_allowance?.amount||0} 元／${P.overtime_allowance?.unit==='hour'?'小時':'次'}`:'時數加班費'+(P.overtime_auto?'（依加班紀錄自動計算）':'')}｜全勤獎金：${P.attendance.enabled?`「${esc(P.attendance.name)}」，事假${P.attendance.personal==='all'?'整筆不發':'按比例扣'}`:'未設定'}<br>${d.types.map(t=>`${esc(t.name)} ${payText(t.pay)}${t.quota?` ${t.quota} 天`:''}`).join('、')}</div>`;
    const BY={site:'申請人所屬社區的社區主管；沒有現場主管（例如社區主管本人、內勤、機動人員）時改由直屬主管審核',dept:'申請人所屬部門的主管（保全 → 同班別勤務經理；秘書 → 秘書部）',region:'申請人社區所在區域的督導',direct:'依組織架構往上一層',position:'指定職位'};
    const posName=id=>(d.positions||[]).find(p=>p.id===id)?.name||'（未選擇職位）';
    const desc=s=>(s.by||'people')==='position'?`由擔任「${esc(posName(s.position))}」的人審核；沒有人擔任時由公司管理員審核`:esc(BY[s.by]||'');
    const flowText=`<div class="lv-type-info" style="margin-bottom:12px"><b>審核流程</b>（依組織架構自動找審核人，人事異動不用重設）<ol style="margin:6px 0 0;padding-left:20px">${d.flow.map(s=>`<li><b>${esc(s.name)}</b>${s.min_days?`（請假 ${s.min_days} 天以上才需要）`:''}：${(s.by||'people')==='people'?'公司指定的人員（下方勾選）':desc(s)}</li>`).join('')}</ol><small class="muted">同一個人連續兩關只審一次；公司管理員隨時可以直接核准。</small></div>`;
    if(!d.can_edit){box.innerHTML=rules+flowText;return;}
    const DP=[['none','不代理：社區主管請假時一樣收到通知，遠端審核'],['absent','社區主管當天請假時，由同社區副主管（副理／主秘）代理審核'],['always','同社區副主管隨時都可以審核第一關'],['dept_notify','第一關不由現場審核：直接由部門審核，並知會社區主管']];
    const people=d.flow.filter(s=>(s.by||'people')==='people');
    box.innerHTML=`${rules}${flowText}
      <div class="lv-step"><h4>副主管代理審核</h4><div style="display:grid;gap:6px">${DP.map(([v,l])=>`<label style="display:flex;gap:8px;align-items:flex-start;font-weight:500;margin:0"><input type="radio" name="dp" value="${v}" style="width:auto;margin-top:4px" ${(d.prefs?.deputy_proxy||'none')===v?'checked':''}> ${esc(l)}</label>`).join('')}</div></div>
      ${people.length?`<p class="hint">以下關卡由公司指定審核人員：</p><div class="lv-bar"><input id="stQ" placeholder="搜尋姓名、員編、社區" style="min-width:220px"></div>${people.map(s=>`<div class="lv-step"><h4>${esc(s.name)} <small class="muted">${s.scope==='community'?'只限同社區':'全公司'}${s.min_days?`・請假 ${s.min_days} 天以上才需要`:''}</small></h4><div class="lv-people">${d.staff.map(p=>`<label data-q="${esc(`${p.name} ${p.employee_id} ${p.position} ${p.communities.join(' ')}`.toLowerCase())}"><input type="checkbox" data-step="${esc(s.id)}" value="${p.id}" ${sel[s.id].has(p.id)?'checked':''}><span>${esc(p.name)} <small class="muted">${esc(p.employee_id)} ${esc(p.position)}${p.role==='company_admin'?' 管理員':''}${p.communities.length?`<br>${esc(p.communities.slice(0,3).join('、'))}`:''}</small></span></label>`).join('')}</div></div>`).join('')}`:''}
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" id="stSave">💾 儲存</button></div>`;
    box.querySelector('#stQ')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();box.querySelectorAll('.lv-people label').forEach(l=>{l.style.display=!q||l.dataset.q.includes(q)?'':'none';});});
    box.querySelector('#stSave').addEventListener('click',async()=>{try{await api('/api/company/org/prefs',J('PUT',{deputy_proxy:box.querySelector('[name=dp]:checked')?.value||'none'}));if(people.length){const approvers={};for(const s of people)approvers[s.id]=[...box.querySelectorAll(`[data-step="${CSS.escape(s.id)}"]:checked`)].map(x=>Number(x.value));await api('/api/company/leave/approvers',J('PUT',{approvers}));}alert('已儲存。之後送出的假單會依新的設定流轉。');}catch(e){alert(e.message);}});
  }

  window.LeaveModule={render};
})();
