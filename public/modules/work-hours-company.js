// 公司內勤：出勤工時與加班（報表、待核定加班、補休與加班、工時設定）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const post=(u,b)=>api(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});
  const H=min=>min?`${Math.round(min/60*100)/100}`:'';
  const thisMonth=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,7);
  const MODE={pay:'加班費',allowance:'補貼',comp:'補休'};
  const S={tab:'report',month:thisMonth(),community:'',group:'',q:'',open:new Set(),data:null};
  function css(){if(document.getElementById('whCss'))return;const s=document.createElement('style');s.id='whCss';s.textContent=`
  .wh-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 14px}.wh-tabs button{border-radius:99px;padding:7px 14px}.wh-tabs button:not(.on){background:#F3ECE6;color:#5F403B;border-color:#E2D3CA}
  .wh-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}.wh-bar label{display:flex;flex-direction:column;gap:3px;font-size:.82rem;color:#6E5650;font-weight:700}.wh-bar select,.wh-bar input{width:auto;min-width:120px}
  .wh-t{width:100%;border-collapse:collapse;min-width:0!important;font-size:.88rem}.wh-t th,.wh-t td{padding:7px 8px;border-bottom:1px solid #F0E7E2;text-align:left;vertical-align:top}.wh-t th{background:#F7F1EC;font-size:.78rem;color:#6E5650;white-space:nowrap;position:sticky;top:0;z-index:1}
  .wh-t td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.wh-wrap{overflow:auto;border:1px solid #EFE6E0;border-radius:12px;max-height:70vh}
  .wh-p{cursor:pointer}.wh-p:hover td{background:#FBF7F3}.wh-p td:first-child b{color:#5F403B}
  .wh-d td{background:#FDFBF8;font-size:.84rem}.wh-d.rest td{color:#9A8A84}.wh-d.red td:nth-child(1){color:#A52828}
  .wh-tag{display:inline-block;font-size:.72rem;font-weight:700;border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:1px}.t-fix{background:#FFF0D6;color:#8A5A00}.t-off{background:#E7EEF7;color:#2F4F7A}.t-bad{background:#FBE5E5;color:#A52828}
  .wh-st{font-size:.8rem}.wh-st.warn{color:#A44528;font-weight:700}.wh-loc{display:block;color:#9A8A84;font-size:.74rem}
  .wh-ot{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.wh-ot button{padding:3px 8px;font-size:.78rem}.wh-ot .ok{color:#2F6B3A;font-weight:700}.wh-ot .no{color:#7A5F58}
  .wh-banner{border-radius:12px;padding:10px 14px;margin-bottom:12px;font-weight:600}.wh-banner.ok{background:#E9F4EC;color:#2F6B3A}.wh-banner.bad{background:#FBE5E5;color:#A52828}
  .wh-card{border:1px solid #E8DCD5;border-radius:12px;padding:14px;background:#fff;margin-bottom:12px}.wh-card h3{margin:0 0 8px;font-size:1rem}
  .wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
  .wh-card input,.wh-bar input,.wh-modal input,.wh-modal select{border:1px solid #D9C7BE;border-radius:10px;padding:8px 10px;min-height:42px;font:inherit;background:#fff;box-sizing:border-box;color:#1D0D0C}
  .wh-card td input{width:100%;min-width:90px}.wh-modal label{display:flex;flex-direction:column;gap:4px;margin:0 0 10px;font-weight:700;font-size:.9rem}.wh-modal input,.wh-modal select{width:100%}
  @media print{body>*:not(.wh-print){display:none!important}.wh-print{display:block!important;background:#fff}html,body{background:#fff!important}}`;document.head.appendChild(s);}
  function punch(p){if(!p)return '<span style="color:#C4B3AC">—</span>';const tags=(p.source==='fix'?'<span class="wh-tag t-fix" title="補打卡">補</span>':'')+(p.source==='offline'?`<span class="wh-tag t-off" title="離線打卡，${esc(p.received)} 上傳">離線</span>`:'')+(p.integrity==='changed'?'<span class="wh-tag t-bad" title="這筆紀錄在封存後被改動過">⚠ 被改動</span>':'');
    return `${esc(p.time)}${tags}<span class="wh-loc">${esc(p.location||'')}${p.fix?`｜${esc(p.fix.reason)}（${esc(p.fix.approved_by)} 核准）`:''}</span>`;}
  function otCell(p,x,mode){const o=x.ot;if(!o)return '';
    if(o.status==='approved')return `<div class="wh-ot"><span class="ok">✓ 核定 ${o.hours} 時${o.comp_choice?`（${o.comp_choice==='comp'?'補休':'加班費'}）`:''}</span><button type="button" class="secondary" data-undo="${o.review_id}">撤回</button></div>`;
    if(o.status==='dismissed')return `<div class="wh-ot"><span class="no">不列加班：${esc(o.reason)}</span><button type="button" class="secondary" data-undo="${o.review_id}">撤回</button></div>`;
    return `<div class="wh-ot"><span class="warn" style="color:#A44528;font-weight:700">待核定 ${Math.round(o.minutes/60*100)/100} 時</span><button type="button" data-ot="${p.staff_id}|${x.date}|${o.kind}">核定</button><button type="button" class="secondary" data-dismiss="${p.staff_id}|${x.date}|${o.kind}">不列</button></div>`;}
  function dayRows(p,mode){return p.days.map(x=>`<tr class="wh-d ${x.plan==='rest'||x.plan==='before'?'rest':''} ${x.red?'red':''}"><td>${x.date.slice(5)}（${x.weekday}）</td><td>${esc(x.shift?.name||'')}</td><td>${x.plan==='rest'&&!x.in&&!x.out?'':punch(x.in)}</td><td>${x.plan==='rest'&&!x.in&&!x.out?'':punch(x.out)}</td><td class="n">${H(x.normal_min)}</td><td class="n">${H(x.sched_ot_min)}</td><td class="wh-st ${x.status.some(s=>/遲到|早退|缺|未打卡|被改動/.test(s))?'warn':''}">${esc(x.status.join('、'))}${x.leave?`<br><span style="color:#2F4F7A">${esc(x.leave.names.join('、'))} ${x.leave.hours} 時</span>`:''}</td><td>${otCell(p,x,mode)}</td></tr>`).join('');}
  async function render(el,label){css();try{const t=sessionStorage.getItem('wh.tab');if(t){S.tab=t;sessionStorage.removeItem('wh.tab');}const m=sessionStorage.getItem('wh.month');if(m){S.month=m;sessionStorage.removeItem('wh.month');}}catch{}el.innerHTML=`<div class="eyebrow">📍 出勤與巡邏</div><h1>${esc(label||'出勤工時與加班')}</h1>
      <p class="hint">依班別時段與打卡紀錄自動計算每天的正常工時、排定加班（例如保全 12 小時班＝正常 8 小時＋加班 4 小時）、遲到早退與缺卡。下班後超時與休假日出勤會列為「待核定」，主管核定後才計入加班，並依公司的加班方式轉成加班費、補貼或補休。</p>
      <div class="wh-tabs">${[['report','📋 出勤工時報表'],['exceptions','⚠️ 出勤異常'],['pending','⏳ 待核定加班'],['comp','🕘 補休與加班'],['settings','⚙️ 工時設定']].map(([k,t])=>`<button type="button" data-tab="${k}" class="${S.tab===k?'on':''}">${t}</button>`).join('')}</div><div id="whBody"><div class="profile-loading">讀取中…</div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;render(el,label);});
    const body=el.querySelector('#whBody');
    try{if(S.tab==='exceptions')return await renderExceptions(body,el,label);if(S.tab==='settings')return await renderSettings(body);if(S.tab==='comp')return await renderComp(body);await renderReport(body,el,label);}catch(e){body.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;}}
  async function load(){const q=new URLSearchParams({month:S.month});if(S.community)q.set('community_id',S.community);if(S.group)q.set('group',S.group);S.data=await api(`/api/company/work-hours/report?${q}`);return S.data;}
  async function renderReport(body,el,label){
    const d=await load();const pending=S.tab==='pending';const kw=S.q.trim();
    const people=d.people.filter(p=>!kw||p.name.includes(kw)||p.employee_id.includes(kw)||p.position.includes(kw)).filter(p=>!pending||p.days.some(x=>x.ot?.status==='pending'));
    const q=new URLSearchParams({month:S.month});if(S.community)q.set('community_id',S.community);if(S.group)q.set('group',S.group);
    body.innerHTML=`<div class="wh-bar"><label>年月<input type="month" id="whMonth" value="${S.month}"></label><label>社區<select id="whCom"><option value="">全部社區</option>${d.communities.map(c=>`<option value="${c.id}" ${String(c.id)===S.community?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label>職務類別<select id="whGrp"><option value="">全部</option><option value="admin" ${S.group==='admin'?'selected':''}>行政（固定班、見紅休）</option><option value="guard" ${S.group==='guard'?'selected':''}>保全</option></select></label><label>人員<input id="whQ" placeholder="姓名、員編或職務" value="${esc(S.q)}"></label>
      <span style="flex:1"></span>${pending?'':`<button type="button" class="secondary" id="whXlsx">⬇ 下載 Excel</button><button type="button" class="secondary" id="whPdf">🖨 列印／存成 PDF</button>`}</div>
      ${d.integrity.changed?`<div class="wh-banner bad">⚠ 有 ${d.integrity.changed} 筆打卡紀錄在封存後被改動過（已標示「⚠ 被改動」），請查明原因。</div>`:d.integrity.checked?`<div class="wh-banner ok">✓ 本月 ${d.integrity.checked} 筆打卡紀錄驗證完整，沒有被改動。補打卡標示「補」，離線打卡標示「離線」。</div>`:''}
      <p class="hint" style="margin:0 0 8px">公司加班方式：<b>${MODE[d.overtime_mode]||'加班費'}</b>｜下班後超過 ${d.settings.remind_min} 分鐘列入待核定，以 ${d.settings.unit_min} 分鐘為單位｜點人員可展開每日明細。</p>
      ${pending&&!people.length?'<div class="wh-banner ok">✓ 目前沒有待核定的加班</div>':''}
      <div class="wh-wrap"><table class="wh-t"><thead><tr><th>人員</th><th>職務</th><th>出勤天數</th><th>正常工時</th><th>排定加班</th><th>已核定加班</th><th>待核定</th><th>休假日出勤</th><th>請假</th><th>遲到</th><th>早退</th><th>缺卡</th><th>未打卡</th><th>補打卡</th></tr></thead><tbody>
      ${people.map(p=>{const t=p.totals;const open=S.open.has(p.staff_id)||pending;return `<tr class="wh-p" data-p="${p.staff_id}"><td>${open?'▾':'▸'} <b>${esc(p.name)}</b><br><small class="muted">${esc(p.employee_id)}｜${esc(p.default_shift)}</small></td><td>${esc(p.position)}<br><small class="muted">${esc(p.group_name)}${p.communities.length?`｜${esc(p.communities.join('、'))}`:''}</small></td><td class="n">${t.work_days}</td><td class="n">${t.normal_h}</td><td class="n">${t.sched_ot_h||''}</td><td class="n">${t.approved_ot_h||''}</td><td class="n" style="color:#A44528;font-weight:700">${t.pending_ot_h||''}</td><td class="n">${t.rest_work_days||''}</td><td class="n">${t.leave_h||''}</td><td class="n">${t.late_count?`${t.late_count} 次／${t.late_min} 分`:''}</td><td class="n">${t.early_count||''}</td><td class="n">${t.missing||''}</td><td class="n">${t.absent||''}</td><td class="n">${t.fix_count||''}</td></tr>
        ${open?`<tr><td colspan="14" style="padding:0 0 10px 18px;background:#FDFBF8"><table class="wh-t"><thead><tr><th>日期</th><th>班別</th><th>上班打卡</th><th>下班打卡</th><th>正常工時</th><th>排定加班</th><th>狀態</th><th>超時／休假日出勤</th></tr></thead><tbody>${pending?dayRows({...p,days:p.days.filter(x=>x.ot?.status==='pending')},d.overtime_mode):dayRows(p,d.overtime_mode)}</tbody></table>${p.extra_punches.length?`<div class="hint" style="margin:6px 0 0">另有 ${p.extra_punches.length} 筆未配對的打卡（例如重複打卡）：${p.extra_punches.map(x=>`${x.date.slice(5)} ${x.time} ${x.type==='checkin'?'上班':'下班'}`).join('、')}</div>`:''}</td></tr>`:''}`;}).join('')||'<tr><td colspan="14" class="hint">沒有符合條件的人員</td></tr>'}
      </tbody></table></div>`;
    const again=()=>render(el,label);
    body.querySelector('#whMonth').onchange=e=>{S.month=e.target.value||thisMonth();again();};
    body.querySelector('#whCom').onchange=e=>{S.community=e.target.value;again();};
    body.querySelector('#whGrp').onchange=e=>{S.group=e.target.value;again();};
    let t;body.querySelector('#whQ').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{S.q=e.target.value;renderReport(body,el,label).then(()=>{const i=body.querySelector('#whQ');i.focus();i.setSelectionRange(i.value.length,i.value.length);});},300);};
    body.querySelectorAll('.wh-p').forEach(r=>r.onclick=()=>{const id=Number(r.dataset.p);S.open.has(id)?S.open.delete(id):S.open.add(id);renderReport(body,el,label);});
    body.querySelector('#whXlsx')?.addEventListener('click',()=>{const a=document.createElement('a');a.href=`/api/company/work-hours/export?${q}`;a.download='';document.body.appendChild(a);a.click();a.remove();});
    body.querySelector('#whPdf')?.addEventListener('click',()=>printPdf(d,people));
    body.querySelectorAll('[data-ot]').forEach(b=>b.onclick=e=>{e.stopPropagation();const [sid,date,kind]=b.dataset.ot.split('|');approve(d,Number(sid),date,kind,again);});
    body.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const [sid,date,kind]=b.dataset.dismiss.split('|');const reason=prompt('不列加班的原因（會留下紀錄，例如：個人逗留、私事、等人接送）：');if(!reason)return;try{await post('/api/company/work-hours/ot-review',{staff_id:Number(sid),date,kind,action:'dismiss',reason});again();}catch(err){alert(err.message);}});
    body.querySelectorAll('[data-undo]').forEach(b=>b.onclick=async e=>{e.stopPropagation();if(!confirm('要撤回這筆核定嗎？撤回後會回到「待核定」。'))return;try{await post(`/api/company/work-hours/ot-review/${b.dataset.undo}/undo`);again();}catch(err){alert(err.message);}});
  }
  function approve(d,sid,date,kind,done){
    const p=d.people.find(x=>x.staff_id===sid);const x=p.days.find(y=>y.date===date);const o=x.ot;const max=Math.round(o.minutes/60*100)/100;
    const box=document.createElement('div');box.className='modal-backdrop';box.style.cssText='position:fixed;inset:0;z-index:2600;background:rgba(29,13,12,.45);display:flex;align-items:center;justify-content:center;padding:14px';
    const defChoice=d.overtime_mode==='comp'?'comp':'pay';
    box.innerHTML=`<div class="modal wh-modal" style="max-width:460px;width:100%;background:#FCFAF1;border-radius:16px;padding:20px"><h3 style="margin:0 0 6px">核定加班｜${esc(p.name)}</h3>
      <p class="hint">${date}（${x.weekday}）${kind==='rest'?`${esc(x.status[0])}，打卡 ${esc(x.in?.time||'')}～${esc(x.out?.time||'')}`:`班別 ${esc(x.shift?.end||'')} 下班，實際 ${esc(x.out?.time||'')} 打下班卡`}。可核定最多 <b>${max}</b> 小時（以 ${d.settings.unit_min} 分鐘為單位）。</p>
      <label>核定時數<input type="number" id="otH" min="${d.settings.unit_min/60}" max="${max}" step="${d.settings.unit_min/60}" value="${max}"></label>
      ${kind==='rest'?`<label>加班種類<select id="otT"><option value="rest_day" ${o.suggested_type==='rest_day'?'selected':''}>休息日加班（1.34／1.67 倍）</option><option value="holiday" ${o.suggested_type==='holiday'?'selected':''}>國定假日／例假日出勤（加倍）</option></select></label>`:''}
      <label>換成<select id="otC"><option value="pay" ${defChoice==='pay'?'selected':''}>${d.overtime_mode==='allowance'?'補貼':'加班費'}</option><option value="comp" ${defChoice==='comp'?'selected':''}>補休（須本人同意）</option></select></label>
      <label>說明（選填）<input id="otR" placeholder="例如：住戶會議延長、颱風留守"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="secondary" data-x>取消</button><button type="button" data-go>核定</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector('[data-x]').onclick=()=>box.remove();
    box.querySelector('[data-go]').onclick=async()=>{try{await post('/api/company/work-hours/ot-review',{staff_id:sid,date,kind,action:'approve',hours:Number(box.querySelector('#otH').value),ot_type:box.querySelector('#otT')?.value,comp_choice:box.querySelector('#otC').value,reason:box.querySelector('#otR').value});box.remove();done();}catch(e){alert(e.message);}};
  }
  // 列印／存成 PDF：每人一頁，含每日打卡、補打卡註記與簽名欄
  function printPdf(d,people){
    const co=document.querySelector('.brand-title,.company-name')?.textContent||'';
    const pg=p=>`<div style="page-break-after:always;font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;font-size:11px;color:#111">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:4px;margin-bottom:6px"><div style="font-size:16px;font-weight:700">出勤紀錄表　${esc(d.month)}</div><div>${esc(co)}</div></div>
      <div style="margin-bottom:6px">姓名：<b>${esc(p.name)}</b>　員編：${esc(p.employee_id)}　職務：${esc(p.position)}（${esc(p.group_name)}）　社區：${esc(p.communities.join('、'))}　班別：${esc(p.default_shift)}</div>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="3"><thead style="background:#eee"><tr><th>日期</th><th>班別</th><th>上班</th><th>下班</th><th>正常</th><th>排定加班</th><th>核定加班</th><th>狀態／請假</th><th>補打卡說明</th></tr></thead><tbody>
      ${p.days.map(x=>`<tr><td>${x.date.slice(5)}(${x.weekday})</td><td>${esc(x.shift?.name?.replace(/^[^ ]+ /,'')||'')}</td><td>${x.in?esc(x.in.time)+(x.in.source==='fix'?'＊':x.in.source==='offline'?'△':''):''}</td><td>${x.out?esc(x.out.time)+(x.out.source==='fix'?'＊':x.out.source==='offline'?'△':''):''}</td><td align="right">${H(x.normal_min)}</td><td align="right">${H(x.sched_ot_min)}</td><td align="right">${x.ot?.status==='approved'?x.ot.hours:''}</td><td>${esc(x.status.join('、'))}${x.leave?` ${esc(x.leave.names.join('、'))}${x.leave.hours}時`:''}</td><td>${[x.in,x.out].filter(y=>y?.fix).map(y=>`${esc(y.fix.reason)}（${esc(y.fix.approved_by)}）`).join('；')}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4" align="right"><b>合計</b></td><td align="right"><b>${p.totals.normal_h}</b></td><td align="right"><b>${p.totals.sched_ot_h||''}</b></td><td align="right"><b>${p.totals.approved_ot_h||''}</b></td><td colspan="2">出勤 ${p.totals.work_days} 天｜遲到 ${p.totals.late_count} 次｜缺卡 ${p.totals.missing}｜請假 ${p.totals.leave_h} 時</td></tr></tfoot></table>
      <div style="margin-top:6px;color:#444">＊補打卡（事後申請並經核准）　△離線打卡（當下無網路，之後上傳）　打卡紀錄均經加密封存，事後改動可被驗出。</div>
      <div style="display:flex;gap:40px;margin-top:22px"><div>員工簽名：＿＿＿＿＿＿＿＿</div><div>主管簽名：＿＿＿＿＿＿＿＿</div><div>列印日期：${new Date().toLocaleDateString('zh-TW')}</div></div></div>`;
    const w=document.createElement('div');w.className='wh-print';w.style.display='none';w.innerHTML=`<style>@page{size:A4 landscape;margin:10mm}</style>`+people.map(pg).join('');document.body.appendChild(w);window.print();setTimeout(()=>w.remove(),1500);
  }
  async function renderExceptions(body,el,label){
    const d=await api(`/api/company/work-hours/exceptions?month=${S.month}`);const ro=d.published;
    const st={pending:'<b style="color:#A44528">待處理</b>',absent:'<b style="color:#A52828">確認曠職</b>',excused:'<b style="color:#2F6B3A">不扣薪</b>'};
    const items=[...d.items].sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
    body.innerHTML=`<div class="wh-bar"><label>年月<input type="month" id="whMonth" value="${S.month}"></label><span style="flex:1"></span></div>
      ${ro?'<div class="wh-banner ok">這個月份的薪資已經發布，出勤異常不能再修改（如需修改請先撤回發布）。</div>':d.pending?`<div class="wh-banner bad">⚠ 還有 ${d.pending} 筆出勤異常待處理。處理完成前，這個月的薪資不能發布。</div>`:d.items.length?'<div class="wh-banner ok">✓ 本月出勤異常都已處理完成，可以到「人員薪資統計表」重新計算並發布薪資。</div>':'<div class="wh-banner ok">✓ 本月沒有出勤異常</div>'}
      <p class="hint">排班日沒有打卡、也沒有請假，或只打了一次卡，會列在這裡。<b>員工補打卡或補請假經核准後，這一筆會自動消失</b>（依假別扣薪）。如果確定沒有上班，請按「確認曠職」：扣當天一日工資並取消全勤獎金；如果其實有上班（忘了打卡、公出），請按「不扣薪」並填寫原因。</p>
      <div class="wh-wrap"><table class="wh-t"><thead><tr><th>日期</th><th>人員</th><th>班別</th><th>異常</th><th>打卡</th><th>處理結果</th><th></th></tr></thead><tbody>
      ${items.map(x=>`<tr><td>${x.date.slice(5)}（${x.weekday}）</td><td><b>${esc(x.name)}</b><br><small class="muted">${esc(x.employee_id)}｜${esc(x.position)}</small></td><td>${esc(x.shift)}</td><td>${esc(x.issue_label)}${x.leave?`<br><small style="color:#2F4F7A">${esc(x.leave.names.join('、'))} ${x.leave.hours} 時</small>`:''}</td><td>${x.in?`上班 ${esc(x.in.time)}`:''}${x.out?`${x.in?'<br>':''}下班 ${esc(x.out.time)}`:''}${!x.in&&!x.out?'—':''}</td>
        <td>${st[x.status]}${x.reason?`<br><small>${esc(x.reason)}</small>`:''}${x.decided_by?`<br><small class="muted">${esc(x.decided_by)}</small>`:''}</td>
        <td><div class="wh-ot">${ro?'':x.status==='pending'?`<button type="button" data-abs="${x.staff_id}|${x.date}">確認曠職</button><button type="button" class="secondary" data-exc="${x.staff_id}|${x.date}">不扣薪</button>`:`<button type="button" class="secondary" data-eundo="${x.resolution_id}">撤回</button>`}</div></td></tr>`).join('')||'<tr><td colspan="7" class="hint">沒有出勤異常</td></tr>'}
      </tbody></table></div>`;
    const again=()=>renderExceptions(body,el,label);
    body.querySelector('#whMonth').onchange=e=>{S.month=e.target.value||thisMonth();again();};
    const go=async(v,action,reason)=>{const [sid,date]=v.split('|');try{await post('/api/company/work-hours/exceptions',{staff_id:Number(sid),date,action,reason});again();}catch(e){alert(e.message);}};
    body.querySelectorAll('[data-abs]').forEach(b=>b.onclick=()=>{if(!confirm('確認這天曠職？\n會扣當天一日工資，並取消本月全勤獎金（如有）。'))return;go(b.dataset.abs,'absent','');});
    body.querySelectorAll('[data-exc]').forEach(b=>b.onclick=()=>{const r=prompt('不扣薪的原因（例如：有上班但忘了打卡、公出、颱風停班）：');if(!r)return;go(b.dataset.exc,'excused',r);});
    body.querySelectorAll('[data-eundo]').forEach(b=>b.onclick=async()=>{if(!confirm('撤回後會回到「待處理」。確定嗎？'))return;try{await post(`/api/company/work-hours/exceptions/${b.dataset.eundo}/undo`);again();}catch(e){alert(e.message);}});
  }
  async function renderComp(body){
    const d=await api('/api/company/work-hours/comp');const L={year_end:'當年度 12/31 前',['6m']:'加班日起 6 個月內',['1y']:'加班日起 1 年內'}[d.expiry];
    body.innerHTML=`<p class="hint">補休期限：<b>${L}</b>（可在「工時設定」修改）。依勞基法第 32 條之 1，補休期限屆滿未休完的時數，應依原本加班的費率折發加班費。</p>
      <div class="wh-wrap"><table class="wh-t"><thead><tr><th>人員</th><th>職務</th><th>累計換補休</th><th>可用補休</th><th>30 天內到期</th><th>到期未休（應折發）</th><th>已折發</th><th></th></tr></thead><tbody>
      ${d.rows.map(r=>`<tr><td><b>${esc(r.name)}</b><br><small class="muted">${esc(r.employee_id)}</small></td><td>${esc(r.position)}</td><td class="n">${r.earned}</td><td class="n"><b>${r.available}</b></td><td class="n" style="color:#A44528">${r.expiring_30d||''}</td><td class="n" style="color:#A52828;font-weight:700">${r.expired_unpaid||''}</td><td class="n">${r.paid_out||''}</td><td>${r.expired_unpaid?`<button type="button" data-pay="${r.staff_id}" data-n="${esc(r.name)}" data-h="${r.expired_unpaid}">折發加班費</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="hint">目前沒有人員換過補休</td></tr>'}
      </tbody></table></div>`;
    body.querySelectorAll('[data-pay]').forEach(b=>b.onclick=async()=>{if(!confirm(`將「${b.dataset.n}」到期未休的 ${b.dataset.h} 小時補休折發加班費？\n會新增一筆加班費紀錄，併入本月薪資計算。`))return;try{await post(`/api/company/work-hours/comp/${b.dataset.pay}/payout`);renderComp(body);}catch(e){alert(e.message);}});
  }
  async function renderSettings(body){
    const d=await api('/api/company/work-hours/settings');const c=d.settings;const ro=d.can_edit?'':'disabled';
    const opt=(v,g)=>c.shifts.filter(s=>!g||s.group===g).map(s=>`<option value="${esc(s.id)}" ${s.id===v?'selected':''}>${esc(s.name)}</option>`).join('');
    body.innerHTML=`${d.can_edit?'':'<div class="msg">只有公司負責人、總經理或部門主管可以修改工時設定。</div>'}
      <div class="wh-card"><h3>🕘 班別時段</h3><p class="hint" style="margin-top:0">休息時間（例如午休 1 小時）不算工時。跨夜班別（例如 19:00–07:00）會自動算到隔天。超過每日正常工時的排定時數，列為「排定加班」。</p>
        <div class="wh-wrap" style="max-height:none"><table class="wh-t"><thead><tr><th>名稱</th><th>上班</th><th>下班</th><th>休息（分鐘）</th><th>適用</th><th>每日工時</th><th></th></tr></thead><tbody id="whShifts">${c.shifts.map(s=>shiftRow(s,ro)).join('')}</tbody></table></div>
        ${d.can_edit?'<button type="button" class="secondary" id="whAdd" style="margin-top:8px">＋ 新增班別</button>':''}</div>
      <div class="wh-card"><h3>📌 預設班別與計算方式</h3><div class="wh-grid">
        <label>行政職預設班別<select id="sAdmin" ${ro}>${opt(c.admin_shift)}</select></label>
        <label>保全日班<select id="sGD" ${ro}>${opt(c.guard_day_shift)}</select></label>
        <label>保全夜班<select id="sGN" ${ro}>${opt(c.guard_night_shift)}</select></label>
        <label>每日正常工時（小時）<input type="number" id="sNormal" min="4" max="12" value="${c.normal_hours}" ${ro}><small class="muted">保全 12 小時班＝正常 8＋排定加班 4</small></label>
        <label>下班後超過幾分鐘列入待核定<input type="number" id="sRemind" min="1" max="240" value="${c.remind_min}" ${ro}></label>
        <label>加班計算單位<select id="sUnit" ${ro}>${[1,15,30,60].map(n=>`<option value="${n}" ${c.unit_min===n?'selected':''}>${n===1?'每分鐘':`每 ${n} 分鐘`}</option>`).join('')}</select></label>
        <label>補休期限<select id="sExp" ${ro}><option value="year_end" ${c.comp_expiry==='year_end'?'selected':''}>當年度 12/31 前</option><option value="6m" ${c.comp_expiry==='6m'?'selected':''}>加班日起 6 個月</option><option value="1y" ${c.comp_expiry==='1y'?'selected':''}>加班日起 1 年</option></select></label>
      </div></div>
      <div class="wh-card"><h3>💰 出勤扣薪規則</h3><p class="hint" style="margin-top:0">請假依假別自動扣薪；主管在「出勤異常」確認的曠職，扣當天一日工資並取消全勤獎金。依勞基法不得以罰款方式扣薪，遲到早退只能按比例扣。</p><div class="wh-grid">
        <label>遲到早退<select id="sLate" ${ro}>${[['none','不扣薪，也不影響全勤'],['attendance','只取消全勤獎金'],['prorate','依分鐘比例扣薪'],['both','依分鐘比例扣薪＋取消全勤獎金']].map(([v,t])=>`<option value="${v}" ${c.late_mode===v?'selected':''}>${t}</option>`).join('')}</select></label>
        <label>寬限（分鐘）<input type="number" id="sGrace" min="0" max="60" value="${c.late_grace_min||0}" ${ro}><small class="muted">在寬限內不算遲到早退</small></label>
        <label>行政職日薪<select id="sWA" ${ro}><option value="month30" ${c.wage_basis_admin!=='workdays'?'selected':''}>月薪 ÷ 30</option><option value="workdays" ${c.wage_basis_admin==='workdays'?'selected':''}>月薪 ÷ 當月應出勤日</option></select></label>
        <label>保全日薪<select id="sWG" ${ro}><option value="scheduled" ${c.wage_basis_guard!=='month30'?'selected':''}>月薪 ÷ 當月排班天數</option><option value="month30" ${c.wage_basis_guard==='month30'?'selected':''}>月薪 ÷ 30</option></select><small class="muted">做一休一等排班制建議用排班天數</small></label>
      </div></div>
      <div class="wh-card"><h3>👤 個人固定班別</h3><p class="hint" style="margin-top:0">例如秘書固定 10:00–19:00、三班制社區的保全。沒設定的人使用上面的預設班別；有排班表的保全依班表的日／夜班。</p>
        <div class="wh-wrap" style="max-height:340px"><table class="wh-t"><thead><tr><th>人員</th><th>職務</th><th>固定班別</th></tr></thead><tbody>${d.people.map(p=>`<tr><td>${esc(p.name)} <small class="muted">${esc(p.employee_id)}</small></td><td>${esc(p.position)}</td><td><select data-ps="${p.id}" ${ro}><option value="">（使用預設）</option>${opt(c.person_shift[p.id]||'')}</select></td></tr>`).join('')}</tbody></table></div></div>
      ${d.can_edit?'<div style="text-align:right"><button type="button" id="whSave">儲存工時設定</button></div>':''}${c.updated_at?`<p class="hint">最後修改：${esc(c.updated_by)}｜${esc(String(c.updated_at).slice(0,16).replace('T',' '))}</p>`:''}`;
    const tb=body.querySelector('#whShifts');
    const bind=()=>{tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{b.closest('tr').remove();});tb.querySelectorAll('input').forEach(i=>i.oninput=()=>{const tr=i.closest('tr');tr.querySelector('[data-net]').textContent=netOf(tr);});};bind();
    body.querySelector('#whAdd')?.addEventListener('click',()=>{tb.insertAdjacentHTML('beforeend',shiftRow({id:'',name:'',start:'09:00',end:'18:00',break_min:60,group:'admin'},''));bind();});
    body.querySelector('#whSave')?.addEventListener('click',async e=>{
      const shifts=[...tb.querySelectorAll('tr')].map(tr=>({id:tr.dataset.id||'',name:tr.querySelector('[data-f=name]').value,start:tr.querySelector('[data-f=start]').value,end:tr.querySelector('[data-f=end]').value,break_min:Number(tr.querySelector('[data-f=break]').value),group:tr.querySelector('[data-f=group]').value}));
      const ps={};body.querySelectorAll('[data-ps]').forEach(s=>{if(s.value)ps[s.dataset.ps]=s.value;});
      e.target.disabled=true;try{await api('/api/company/work-hours/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shifts,admin_shift:body.querySelector('#sAdmin').value,guard_day_shift:body.querySelector('#sGD').value,guard_night_shift:body.querySelector('#sGN').value,normal_hours:Number(body.querySelector('#sNormal').value),remind_min:Number(body.querySelector('#sRemind').value),unit_min:Number(body.querySelector('#sUnit').value),comp_expiry:body.querySelector('#sExp').value,person_shift:ps,late_mode:body.querySelector('#sLate').value,late_grace_min:Number(body.querySelector('#sGrace').value),wage_basis_admin:body.querySelector('#sWA').value,wage_basis_guard:body.querySelector('#sWG').value})});alert('已儲存');renderSettings(body);}catch(err){alert(err.message);e.target.disabled=false;}});
  }
  const netOf=tr=>{const t=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(v||'');return m?Number(m[1])*60+Number(m[2]):null;};const a=t(tr.querySelector('[data-f=start]').value),b=t(tr.querySelector('[data-f=end]').value);if(a===null||b===null)return '';const n=((b-a+1440)%1440)-(Number(tr.querySelector('[data-f=break]').value)||0);return `${Math.round(n/60*100)/100} 小時`;};
  function shiftRow(s,ro){const tr=`<tr data-id="${esc(s.id)}"><td><input data-f="name" value="${esc(s.name)}" placeholder="例如：行政早班" ${ro}></td><td><input data-f="start" type="time" value="${esc(s.start)}" ${ro}></td><td><input data-f="end" type="time" value="${esc(s.end)}" ${ro}></td><td><input data-f="break" type="number" min="0" max="240" step="10" value="${s.break_min}" style="width:90px" ${ro}></td><td><select data-f="group" ${ro}><option value="admin" ${s.group!=='guard'?'selected':''}>行政</option><option value="guard" ${s.group==='guard'?'selected':''}>保全</option></select></td><td data-net></td><td>${ro?'':'<button type="button" class="secondary" data-del style="padding:3px 8px">刪除</button>'}</td></tr>`;
    const tmp=document.createElement('tbody');tmp.innerHTML=tr;tmp.querySelector('[data-net]').textContent=netOf(tmp.firstElementChild);return tmp.innerHTML;}
  window.WorkHoursCompany={render};
})();
