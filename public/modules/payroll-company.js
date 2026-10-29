// 公司內勤：人事管理／人員薪資統計表／人員薪資單／借資，以及「我的薪資單」
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const n=v=>Math.round(Number(String(v??'').replace(/[,\s]/g,''))||0);
  const money=v=>n(v).toLocaleString('en-US');
  const monthLabel=m=>m?`${m.slice(0,4)} 年 ${Number(m.slice(5,7))} 月`:'';
  const thisMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
  const S={el:null};

  function injectStyle(){
    if(document.getElementById('payrollStyle'))return;
    const s=document.createElement('style');s.id='payrollStyle';
    s.textContent=`
.pr-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}
.pr-bar input[type=month]{width:auto;margin:0}
.pr-bar button{padding:9px 14px;min-height:0;margin:0}
.pr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0 14px}
.pr-kpi{border:1px solid #E9E3E1;border-radius:12px;padding:10px 14px;background:#fff}
.pr-kpi span{display:block;font-size:.78rem;color:#70635F;font-weight:700}.pr-kpi b{font-size:1.35rem}
.pr-pill{display:inline-block;padding:3px 12px;border-radius:999px;font-weight:800;font-size:.8rem}
.pr-pill.draft{background:#fff3e0;color:#a35a00}.pr-pill.published{background:#E8EEDF;color:#3E5328}
.pr-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px;max-height:70vh}
.pr-table{border-collapse:separate;border-spacing:0;min-width:100%;font-size:.86rem;white-space:nowrap}
.pr-table th,.pr-table td{padding:7px 9px;border-bottom:1px solid #F2EFEE;text-align:right}
.pr-table thead th{position:sticky;top:0;background:#F6F4F2;z-index:2;font-size:.78rem}
.pr-table thead tr.grp th{top:0;background:#EFECE7;text-align:center}
.pr-table thead tr.grp+tr.cols th{top:31px}
.pr-table th.l,.pr-table td.l{text-align:left}
.pr-table td.sticky,.pr-table th.sticky{position:sticky;left:0;background:#fff;z-index:1;text-align:left}
.pr-table thead th.sticky{z-index:3;background:#F6F4F2}
.pr-table tr.tot td{font-weight:800;background:#FAF9F7;position:sticky;bottom:0}
.pr-table td.ee{background:#fffaf5}.pr-table td.er{background:#f5f9ff}
.pr-table td.net{font-weight:800;color:#4E312D}
.pr-table input{width:84px;margin:0;padding:5px 6px;text-align:right;border:1px solid #E2D9D6;border-radius:6px;font:inherit}
.pr-table tr:hover td{background:#FBFAF8}
button.lnk{border:0!important;background:transparent!important;color:#4E312D!important;font-weight:700;padding:0!important;min-height:0!important;box-shadow:none!important;cursor:pointer;text-decoration:underline;font-size:inherit;width:auto}
.pr-warn{background:#fff7e5;border:1px solid #efd99c;border-radius:10px;padding:10px 14px;margin:8px 0;color:#7a5200}
.pr-ok{background:#E8EEDF;border:1px solid #C9D6B5;border-radius:10px;padding:10px 14px;margin:8px 0;color:#3E5328}
.pr-badges span{display:inline-block;padding:1px 7px;border-radius:999px;font-size:.72rem;font-weight:700;margin-right:3px;background:#e6f2fb;color:#1e5f8c}
.pr-badges span.off{background:#f0f0ee;color:#999;text-decoration:line-through}
.pr-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.pr-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.pr-form input,.pr-form select,.pr-form textarea{margin:0;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.pr-form .wide{grid-column:1/-1}
.pr-form .chk{flex-direction:row;align-items:center;gap:8px;font-weight:600}
.pr-form .chk input{width:auto}
.pr-sec{grid-column:1/-1;font-weight:800;color:#4E312D;border-top:1px solid #E9E3E1;padding-top:10px;margin-top:4px}
.pr-allow{display:flex;gap:6px;margin-bottom:6px}.pr-allow input{flex:1}
.pr-ded{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,.9fr) auto;gap:6px;margin-bottom:6px;align-items:center}.pr-ded input{margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #D8CECB;border-radius:8px}
.pr-ded-once{grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr) auto}
.pr-info{background:#F8F6F4;border:1px solid #E6E0DD;border-radius:10px;padding:10px 12px;font-size:.84rem;line-height:1.7}
.pr-ded-head span{font-size:.74rem;color:#7A6E6A;font-weight:700}
@media(max-width:700px){.pr-ded{grid-template-columns:1fr 1fr}.pr-ded-head{display:none}}
.pr-preview{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pr-preview div{border-radius:10px;padding:10px 12px;font-size:.86rem;line-height:1.7}
.pr-preview .ee{background:#fffaf5;border:1px solid #f3dfc8}.pr-preview .er{background:#f5f9ff;border:1px solid #d5e3f5}
.pr-law{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:.86rem;background:#fff8d6;border:1px solid #e9cf63}.pr-law th{background:#ffe98a;text-align:left;padding:7px 12px;color:#6b4e00}.pr-law td{padding:7px 12px;border-top:1px solid #f0de8f;vertical-align:top;line-height:1.6}.pr-law td:first-child{white-space:nowrap;font-weight:800;color:#6b4e00;width:1%}
.pr-tabs{display:flex;gap:6px;margin:6px 0 12px}.pr-tabs button{padding:6px 14px;min-height:0;border-radius:999px}
@media(max-width:700px){.pr-form,.pr-preview{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }
  function modal(title,body,{wide=false}={}){
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="${wide?'max-width:880px;width:min(880px,96vw);':'max-width:640px;width:min(640px,96vw);'}max-height:92vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button>${title?`<h2>${title}</h2>`:''}${body}</div>`;
    document.body.appendChild(box);document.body.classList.add('modal-open');
    const close=()=>{box.remove();document.body.classList.remove('modal-open');};
    box.querySelector('.modal-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    return {box,close};
  }

  // ---------- 保費試算（與後端相同公式） ----------
  function gradeFor(list,s){return list.find(g=>g>=s)??list[list.length-1];}
  function calcIns(p,T){
    const R=T.rates;const lab=p.labor_insured?p.labor_grade:0,occ=p.labor_insured&&p.occupational_insured?(p.auto_grade?gradeFor(T.occupational,p.monthly):gradeFor(T.occupational,p.labor_grade)):0,hea=p.health_insured?p.health_grade:0,pen=p.pension_enabled?p.pension_grade:0;
    const emp=p.labor_insured&&p.employment_insured;const deps=Math.min(Math.max(n(p.health_dependents),0),R.health_max_dependents||3);
    return {employee:{labor:lab?Math.round(lab*(R.labor_ordinary+(emp?R.employment:0))*R.labor_employee):0,health:hea?Math.round(hea*R.health*R.health_employee)*(1+deps):0,pension_self:pen?Math.round(pen*(Number(p.pension_self_rate)||0)/100):0},
      employer:{labor:lab?Math.round(lab*(R.labor_ordinary+(emp?R.employment:0))*R.labor_employer):0,occupational:occ?Math.round(occ*R.occupational):0,health:hea?Math.round(hea*R.health*R.health_employer*(1+R.health_avg_dependents)):0,pension:pen?Math.round(pen*R.pension_employer):0}};
  }
  const sum=o=>Object.values(o||{}).reduce((a,v)=>a+n(v),0);

  // ================= 人事管理（人事／總務）：基本資料 =================
  const leaveText=p=>{const a=p.annual_leave;if(!a)return '—';if(!a.days)return `<small class="muted">${esc(a.next_date)} 起 ${a.next_days} 天</small>`;return `<b>${a.days}</b> 天<small class="muted">（剩 ${p.annual_left}）</small><br><small class="muted">至 ${esc(a.end)}</small>`;};
  async function renderHR(el,label){
    const d=await api('/api/company/hr/profiles');S.hrTable=d.table;
    const today=new Date().toISOString().slice(0,10);const soon=new Date(Date.now()+14*864e5).toISOString().slice(0,10);
    const trial=d.profiles.filter(p=>p.trial_end_date&&p.trial_end_date>=today&&p.trial_end_date<=soon);
    const missing=d.profiles.filter(p=>p.role!=='company_admin'&&!p.hire_date);
    const grant=d.profiles.filter(p=>p.annual_leave?.next_date&&p.annual_leave.next_date>=today&&p.annual_leave.next_date<=soon);
    el.innerHTML=`<div class="eyebrow">👥 人事管理</div><h1>${esc(label||'人事管理')}</h1><p class="hint">人員的基本資料、到職與試用期、特休、勞健保加保與級距、眷屬、薪資發放方式，由人事或總務登記。薪資金額由會計在「人員薪資單 → 薪資設定」處理，這裡看不到薪資。</p>
      ${missing.length?`<div class="pr-warn">⚠ ${missing.length} 位人員尚未登記到職日（無法計算特休）：${esc(missing.map(p=>p.name).join('、'))}</div>`:''}
      ${trial.length?`<div class="pr-warn">⏰ 試用期 14 天內到期：${esc(trial.map(p=>`${p.name}（${p.trial_end_date}）`).join('、'))}</div>`:''}
      ${grant.length?`<div class="pr-ok">🌴 14 天內將取得新年度特休：${esc(grant.map(p=>`${p.name} ${p.annual_leave.next_date} 起 ${p.annual_leave.next_days} 天`).join('、'))}</div>`:''}
      <div class="pr-wrap"><table class="pr-table"><thead><tr class="cols"><th class="sticky">人員</th><th class="l">職務</th><th class="l">到職日</th><th class="l">試用期至</th><th class="l">特休（本期）</th><th class="l">加保</th><th>勞保級距</th><th>健保級距</th><th>眷屬</th><th class="l">薪資發放</th><th class="l">手機／緊急聯絡人</th><th></th></tr></thead><tbody>${d.profiles.map(p=>`<tr><td class="sticky"><b>${esc(p.name)}</b><br><small class="muted">${esc(p.employee_id)}${p.id_masked?`｜${esc(p.id_masked)}`:''}</small></td><td class="l">${esc(p.position||'')}${p.gender?`<br><small class="muted">${p.gender==='F'?'女':'男'}</small>`:''}</td><td class="l">${esc(p.hire_date||'—')}</td><td class="l">${p.trial_end_date?`${esc(p.trial_end_date)}${p.trial_end_date<today?' <small class="muted">已轉正</small>':''}`:'—'}</td><td class="l">${leaveText(p)}</td><td class="l pr-badges"><span class="${p.labor_insured?'':'off'}">勞</span><span class="${p.labor_insured&&p.employment_insured?'':'off'}">就</span><span class="${p.health_insured?'':'off'}">健</span><span class="${p.pension_enabled?'':'off'}">退</span>${p.insured_date?`<br><small class="muted">${esc(p.insured_date)} 加保</small>`:''}</td><td>${p.labor_insured?money(p.labor_grade):'—'}${p.auto_grade?'<br><small class="muted">自動</small>':''}</td><td>${p.health_insured?money(p.health_grade):'—'}</td><td>${p.health_dependents||0}</td><td class="l">${p.pay_method==='cash'?'領現':p.bank_account?`轉帳<br><small class="muted">${esc(p.bank_name)} ${esc(p.bank_account)}</small>`:'<span class="muted">未登記</span>'}</td><td class="l">${esc(p.mobile||'—')}${p.emergency_name?`<br><small class="muted">${esc(p.emergency_name)} ${esc(p.emergency_phone)}</small>`:''}</td><td><button type="button" class="secondary" data-edit="${p.staff_id}" style="padding:5px 12px;min-height:0">編輯</button></td></tr>`).join('')}</tbody></table></div>
      <p class="hint" style="margin-top:8px">特休依勞基法第 38 條（週年制）自動計算：滿 6 個月 3 天、滿 1 年 7 天、2 年 10 天、3～4 年 14 天、5～9 年 15 天、10 年起每年加 1 天至 30 天。</p>`;
    el.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editHR(d.profiles.find(p=>p.staff_id===Number(b.dataset.edit)),d.table,()=>renderHR(el,label))));
  }
  function editHR(p,T,done){
    const opts=(list,v)=>list.map(g=>`<option value="${g}" ${Number(v)===g?'selected':''}>${money(g)}</option>`).join('');
    const a=p.annual_leave;
    const {box,close}=modal(`👤 ${esc(p.name)}｜人事基本資料`,`<form class="pr-form" id="hrForm">
      <div class="pr-sec">到職與試用</div>
      <label>到職日<input type="date" name="hire_date" value="${esc(p.hire_date)}"></label>
      <label>試用期到期日<input type="date" name="trial_end_date" value="${esc(p.trial_end_date)}"></label>
      <div class="pr-sec">特休（依到職日自動計算）</div>
      <div class="wide" id="hrLeave"></div>
      <label>系統外已休天數<input type="number" min="0" max="60" step="0.5" name="annual_used" value="${p.annual_used||0}"><small class="muted" style="font-weight:400">上線前或紙本請的特休；系統假單會自動扣，不用填在這裡</small></label>
      <div class="pr-sec">個人資料</div>
      <label>性別<select name="gender"><option value="">未登記</option><option value="F" ${p.gender==='F'?'selected':''}>女</option><option value="M" ${p.gender==='M'?'selected':''}>男</option></select><small class="muted" style="font-weight:400">生理假、產假、產檢假依此判斷</small></label>
      <label>證件類別<select name="id_type"><option value="national" ${p.id_type!=='arc'&&p.id_type!=='passport'?'selected':''}>身分證</option><option value="arc" ${p.id_type==='arc'?'selected':''}>居留證（外籍）</option><option value="passport" ${p.id_type==='passport'?'selected':''}>護照</option></select></label>
      <label>身分證字號／居留證號碼<input name="id_no" maxlength="20" autocomplete="off" value="${esc(p.id_no||'')}" placeholder="例如 A123456789"><small class="muted" style="font-weight:400">勞健保加保必填；系統會檢查格式與檢查碼，人員列表只顯示部分號碼</small></label>
      <label class="hr-nat">國籍<input name="nationality" value="${esc(p.nationality||'')}" placeholder="例如：越南"></label>
      <label>生日<input type="date" name="birthday" value="${esc(p.birthday)}"></label>
      <label>手機<input name="mobile" inputmode="tel" value="${esc(p.mobile)}"></label>
      <label class="wide">通訊地址<input name="address" value="${esc(p.address)}"></label>
      <label>緊急聯絡人<input name="emergency_name" value="${esc(p.emergency_name)}"></label>
      <label>關係<input name="emergency_relation" value="${esc(p.emergency_relation)}" placeholder="例如：配偶"></label>
      <label>緊急聯絡電話<input name="emergency_phone" inputmode="tel" value="${esc(p.emergency_phone)}"></label>
      <div class="pr-sec">勞健保加保與級距</div>
      <label class="chk"><input type="checkbox" name="labor_insured" ${p.labor_insured?'checked':''}> 加保勞保（含職災）</label>
      <label class="chk"><input type="checkbox" name="employment_insured" ${p.employment_insured?'checked':''}> 加保就業保險</label>
      <label class="chk"><input type="checkbox" name="health_insured" ${p.health_insured?'checked':''}> 加保健保</label>
      <label class="chk"><input type="checkbox" name="pension_enabled" ${p.pension_enabled?'checked':''}> 提繳勞退 6%</label>
      <label>加保日期<input type="date" name="insured_date" value="${esc(p.insured_date)}"></label>
      <label>健保眷屬人數<input type="number" min="0" max="10" name="health_dependents" value="${p.health_dependents||0}"></label>
      <label class="chk wide"><input type="checkbox" name="auto_grade" ${p.auto_grade?'checked':''}> 加保級距依會計設定的薪資自動對應（試用期依試用期薪資）${p.salary_set?'':'<small class="muted">　會計尚未設定薪資</small>'}</label>
      <label>勞保投保薪資<select name="labor_grade">${opts(T.labor,p.labor_grade)}</select></label>
      <label>健保投保金額<select name="health_grade">${opts(T.health,p.health_grade)}</select></label>
      <label>勞退提繳工資<select name="pension_grade">${opts(T.pension,p.pension_grade)}</select></label>
      <div class="pr-sec">薪資發放</div>
      <label class="chk"><input type="radio" name="pay_method" value="transfer" ${p.pay_method!=='cash'?'checked':''}> 薪轉（匯款）</label>
      <label class="chk"><input type="radio" name="pay_method" value="cash" ${p.pay_method==='cash'?'checked':''}> 領現</label>
      <label class="hr-bank">銀行／分行<input name="bank_name" value="${esc(p.bank_name)}" placeholder="例如：台灣銀行 中山分行"></label>
      <label class="hr-bank">帳號<input name="bank_account" inputmode="numeric" value="${esc(p.bank_account)}"></label>
      <label class="wide">人事備註<textarea name="note" rows="2">${esc(p.note)}</textarea></label>
      <div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">💾 儲存</button></div></form>`,{wide:true});
    const f=box.querySelector('#hrForm');box.querySelector('[data-cancel]').onclick=close;
    const sync=()=>{const auto=f.elements.auto_grade.checked;for(const k of ['labor_grade','health_grade','pension_grade'])f.elements[k].disabled=auto;const cash=f.querySelector('input[name=pay_method]:checked')?.value==='cash';box.querySelectorAll('.hr-bank').forEach(x=>x.style.display=cash?'none':'');box.querySelectorAll('.hr-nat').forEach(x=>x.style.display=f.elements.id_type.value==='national'?'none':'');
      const sys=Number(p.annual_system_used)||0,pend=Number(p.annual_pending)||0;const used=(Number(f.elements.annual_used.value)||0)+sys;box.querySelector('#hrLeave').innerHTML=a?(a.days?`<div class="pr-ok" style="margin:0">本期特休 <b>${a.days} 天</b>（${esc(a.start)}～${esc(a.end)}），已休 ${used} 天${sys?`（系統假單 ${sys} 天）`:''}${pend?`、審核中 ${pend} 天`:''}，<b>剩 ${Math.max(0,a.days-used-pend)} 天</b>。下次 ${esc(a.next_date)} 起 ${a.next_days} 天。</div>`:`<div class="pr-warn" style="margin:0">年資未滿 6 個月，${esc(a.next_date)} 起有 3 天特休。</div>`):'<div class="pr-warn" style="margin:0">請先填寫到職日並儲存，系統會自動計算特休。</div>';};
    f.addEventListener('change',sync);f.addEventListener('input',sync);sync();
    f.addEventListener('submit',async e=>{e.preventDefault();const v=k=>f.elements[k];const body={id_type:v('id_type').value,id_no:v('id_no').value,nationality:v('nationality').value,gender:v('gender').value,hire_date:v('hire_date').value,trial_end_date:v('trial_end_date').value,annual_used:Number(v('annual_used').value)||0,birthday:v('birthday').value,mobile:v('mobile').value,address:v('address').value,emergency_name:v('emergency_name').value,emergency_relation:v('emergency_relation').value,emergency_phone:v('emergency_phone').value,labor_insured:v('labor_insured').checked,employment_insured:v('employment_insured').checked,health_insured:v('health_insured').checked,pension_enabled:v('pension_enabled').checked,insured_date:v('insured_date').value,health_dependents:n(v('health_dependents').value),auto_grade:v('auto_grade').checked,labor_grade:n(v('labor_grade').value),health_grade:n(v('health_grade').value),pension_grade:n(v('pension_grade').value),pay_method:f.querySelector('input[name=pay_method]:checked')?.value||'transfer',bank_name:v('bank_name').value,bank_account:v('bank_account').value,note:v('note').value};try{await api(`/api/company/hr/profiles/${p.staff_id}`,J('PUT',body));close();done();}catch(err){alert(err.message);}});
  }

  // ================= 人員薪資設定（會計） =================
  const thisM=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
  async function renderSalaries(box){
    const d=await api('/api/company/payroll/salaries');const T=d.table;
    const unset=d.salaries.filter(p=>p.payroll_enabled&&!p.configured);
    box.innerHTML=`<p class="hint">每位人員的薪資由會計設定：試用期薪資、正式薪資、固定加給、每月定期代扣款（法扣、制服費等）、當月扣款與勞退自提。到職日、試用期、加保級距、薪轉帳號由人事在「人事管理」登記，這裡只顯示。目前使用 ${T.year} 年投保級距表。</p>
      ${unset.length?`<div class="pr-warn">⚠ ${unset.length} 位人員尚未設定薪資：${esc(unset.map(p=>p.name).join('、'))}</div>`:''}
      <div class="pr-wrap"><table class="pr-table"><thead><tr class="cols"><th class="sticky">人員</th><th class="l">試用期至</th><th>試用期薪資</th><th>正式薪資</th><th>固定加給</th><th class="l">本月代扣</th><th>勞保級距</th><th>健保級距</th><th class="l">發放</th><th title="勞健保、勞退自提＋公司保險費">員工自付／月</th><th title="勞健保、勞退 6%＋公司保險費">公司負擔／月</th><th></th></tr></thead><tbody>${d.salaries.map(p=>`<tr${p.payroll_enabled?'':' style="opacity:.55"'}><td class="sticky"><b>${esc(p.name)}</b>${p.in_trial?' <span class="pr-pill draft" style="font-size:.7rem">試用中</span>':''}<br><small class="muted">${esc(p.employee_id)}</small></td><td class="l">${esc(p.trial_end_date||'—')}</td><td>${p.trial_salary?money(p.trial_salary):'—'}</td><td>${p.configured?money(p.base_salary):'<span class="muted">未設定</span>'}</td><td>${money((p.allowances||[]).reduce((a,x)=>a+n(x.amount),0))}</td><td class="l" style="white-space:normal;min-width:120px">${(p.deductions_now||[]).map(x=>`${esc(x.name)} ${money(x.amount)}${x.once?' <small class="muted">當月</small>':''}`).join('<br>')||'—'}</td><td>${p.labor_insured?money(p.labor_grade):'未加保'}</td><td>${p.health_insured?money(p.health_grade):'未加保'}</td><td class="l">${p.pay_method==='cash'?'領現':p.bank_account?'轉帳':'<span class="muted">未登記</span>'}</td><td>${p.configured?money(sum(p.insurance.employee)+(p.company_ins_now||[]).reduce((a,x)=>a+n(x.employee),0)):'—'}</td><td>${p.configured?money(sum(p.insurance.employer)+(p.company_ins_now||[]).reduce((a,x)=>a+n(x.company),0)):'—'}</td><td><button type="button" class="secondary" data-edit="${p.staff_id}" style="padding:5px 12px;min-height:0">設定</button></td></tr>`).join('')}</tbody></table></div>
      <p class="hint" style="margin-top:8px">試用期中的人員，級距與保費以試用期薪資計算。淡色的人員不納入薪資計算。</p>`;
    box.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editSalary(d.salaries.find(p=>p.staff_id===Number(b.dataset.edit)),T,()=>renderSalaries(box),d.company_ins||[])));
    // 公司保險費（團險、誠實險、意外險）
    const ci=d.company_ins||[];
    const insBox=document.createElement('div');insBox.innerHTML=`<div class="section-title" style="margin-top:22px">🛡 公司保險費（團險、誠實險、意外險等）</div><p class="hint">公司統一投保的保險，設定一次後每位人員從到職月起自動套用；個別人員可以在「設定」裡排除。員工負擔的金額會列在薪資單的保險費，公司負擔的金額算進人事成本。勞保、健保、勞退依投保級距自動計算，不用在這裡設定。</p>${ci.length?`<div class="pr-wrap"><table class="pr-table" style="width:auto;min-width:420px"><thead><tr class="cols"><th class="sticky">項目</th><th>員工負擔／月</th><th>公司負擔／月</th><th>適用人數</th></tr></thead><tbody>${ci.map(x=>`<tr><td class="sticky"><b>${esc(x.name)}</b></td><td>${money(x.employee)}</td><td>${money(x.company)}</td><td>${d.salaries.filter(p=>p.payroll_enabled&&(p.company_ins_now||[]).some(i=>i.id===x.id)).length} 人</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty" style="padding:12px">還沒有設定公司保險費。</div>'}<div class="pr-bar"><button type="button" class="secondary" id="ciEdit">${ci.length?'✏️ 修改保險費項目':'＋ 設定公司保險費'}</button></div>`;
    box.appendChild(insBox);
    insBox.querySelector('#ciEdit').onclick=()=>{const items=ci.map(x=>({...x}));if(!items.length)items.push({name:'團險',employee:0,company:0},{name:'誠實險',employee:0,company:0});
      const {box:mb,close}=modal('🛡 公司保險費',`<p class="hint">每位人員每月的金額。物業管理多由員工負擔；公司要吸收的部分填在「公司負擔」。</p><div class="pr-ded pr-ded-head" style="grid-template-columns:1.4fr 1fr 1fr auto"><span>項目</span><span>員工負擔／月</span><span>公司負擔／月</span><span></span></div><div id="ciList"></div><button type="button" class="secondary" id="ciAdd" style="padding:6px 12px;min-height:0">＋ 新增一項</button><div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" id="ciSave">💾 儲存</button></div>`,{wide:true});
      const draw=()=>{mb.querySelector('#ciList').innerHTML=items.map((x,i)=>`<div class="pr-ded" style="grid-template-columns:1.4fr 1fr 1fr auto"><input value="${esc(x.name)}" placeholder="例如：團險" data-ci="${i}" data-k="name"><input value="${x.employee||''}" inputmode="numeric" placeholder="0" data-ci="${i}" data-k="employee"><input value="${x.company||''}" inputmode="numeric" placeholder="0" data-ci="${i}" data-k="company"><button type="button" class="danger" data-cr="${i}" style="padding:4px 10px;min-height:0">×</button></div>`).join('');
        mb.querySelectorAll('[data-ci]').forEach(inp=>inp.addEventListener('input',()=>{const it=items[inp.dataset.ci];it[inp.dataset.k]=inp.dataset.k==='name'?inp.value:n(inp.value);}));
        mb.querySelectorAll('[data-cr]').forEach(b=>b.addEventListener('click',()=>{items.splice(Number(b.dataset.cr),1);draw();}));};
      draw();mb.querySelector('#ciAdd').onclick=()=>{items.push({name:'',employee:0,company:0});draw();};mb.querySelector('[data-cancel]').onclick=close;
      mb.querySelector('#ciSave').onclick=async()=>{try{await api('/api/company/payroll/company-insurance',J('PUT',{items:items.filter(x=>x.name.trim()&&(n(x.employee)||n(x.company)))}));close();renderSalaries(box);}catch(err){alert(err.message);}};};
    // 代扣款（從借資頁移過來）
    const ded=document.createElement('div');box.appendChild(ded);dedSection(ded,d.salaries,()=>renderSalaries(box));
  }
  // 代扣款：法扣、制服費、宿舍費、當月扣款（保險費請用「公司保險費」）
  function dedSection(host,salaries,reload){
    const m=thisM();const md=(a,b)=>(Number(b.slice(0,4))-Number(a.slice(0,4)))*12+Number(b.slice(5,7))-Number(a.slice(5,7));
    const dl=salaries.flatMap(p=>(p.deductions||[]).map(x=>({...x,staff_id:p.staff_id,name_staff:p.name,employee_id:p.employee_id,ended:x.once?x.start_month<m:(x.months?md(x.start_month,m)>=x.months:false),active_now:x.once?x.start_month===m:(x.start_month<=m&&!(x.months&&md(x.start_month,m)>=x.months))})));
    const dAct=dl.filter(x=>!x.ended);const staff=salaries.map(p=>({id:p.staff_id,name:p.name,employee_id:p.employee_id}));
    host.innerHTML=`<div class="section-title" style="margin-top:22px">🧾 代扣款（法扣、制服費、宿舍費、當月扣款等）</div><p class="hint">設定後每個月產生薪資時自動扣除，期數到了自動停止，會出現在「人員薪資統計表」的「代扣款」欄。團險、誠實險等保險費請用上方的「公司保險費」。</p>
      <div class="pr-bar"><button type="button" class="secondary" id="dedAdd">＋ 新增代扣款</button><span class="muted">目前每月代扣合計 ${money(dl.filter(x=>x.active_now).reduce((a,x)=>a+n(x.amount),0))} 元</span></div>
      ${dAct.length?`<div class="pr-wrap"><table class="pr-table" style="width:100%"><thead><tr class="cols"><th class="sticky">人員</th><th class="l">項目</th><th>每月金額</th><th class="l">開始月份</th><th class="l">期數</th><th class="l">狀態</th><th></th></tr></thead><tbody>${dAct.map(x=>`<tr><td class="sticky"><b>${esc(x.name_staff)}</b><br><small class="muted">${esc(x.employee_id)}</small></td><td class="l">${esc(x.name)}</td><td>${money(x.amount)}</td><td class="l">${monthLabel(x.start_month)}</td><td class="l">${x.once?'當月扣款':x.months?`${x.months} 期`:'每月持續'}</td><td class="l">${x.active_now?'<span class="pr-pill draft">扣款中</span>':'<span class="muted">尚未開始</span>'}</td><td><button type="button" class="secondary" data-ded="${x.staff_id}" style="padding:4px 10px;min-height:0">編輯</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前沒有代扣款。</div>'}`;
    const editDed=(staffId)=>{const items=dl.filter(x=>x.staff_id===staffId&&!x.once).map(x=>({...x}));const keepOnce=dl.filter(x=>x.staff_id===staffId&&x.once&&x.name);const who=staff.find(s=>s.id===staffId);if(!items.length)items.push({name:'',amount:0,start_month:thisM(),months:0});
      const {box,close}=modal(`🧾 ${esc(who?.name||'')}｜定期代扣款`,`<div class="pr-ded pr-ded-head"><span>項目</span><span>每月金額</span><span>開始月份</span><span>期數（空白＝持續）</span><span></span></div>${deductionRows(items,'dedList')}<button type="button" class="secondary" id="dedRow" style="padding:6px 12px;min-height:0">＋ 新增一項</button><div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" id="dedSave">💾 儲存</button></div>`,{wide:true});
      bindDeductions(box,items,'dedList');
      box.querySelector('#dedRow').onclick=()=>{items.push({name:'',amount:0,start_month:thisM(),months:0});box.querySelector('#dedList').outerHTML=deductionRows(items,'dedList');bindDeductions(box,items,'dedList');};
      box.querySelector('[data-cancel]').onclick=close;
      box.querySelector('#dedSave').onclick=async()=>{try{await api(`/api/company/payroll/salaries/${staffId}/deductions`,J('PUT',{deductions:[...items.filter(x=>x.name.trim()&&n(x.amount)),...keepOnce]}));close();reload();}catch(err){alert(err.message);}};
    };
    host.querySelectorAll('[data-ded]').forEach(b=>b.addEventListener('click',()=>editDed(Number(b.dataset.ded))));
    host.querySelector('#dedAdd').addEventListener('click',()=>{const {box,close}=modal('🧾 新增代扣款',`<form class="pr-form"><label class="wide">人員<select id="dedWho">${staff.map(s=>`<option value="${s.id}">${esc(s.name)}（${esc(s.employee_id)}）</option>`).join('')}</select></label><div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" id="dedNext">下一步</button></div></form>`);box.querySelector('[data-cancel]').onclick=close;box.querySelector('#dedNext').onclick=()=>{const id=Number(box.querySelector('#dedWho').value);close();editDed(id);};});
  }
  function deductionRows(list,id,once){return `<div id="${id}">${list.map((x,i)=>once?`<div class="pr-ded pr-ded-once"><input placeholder="項目（例如：遲到扣款、罰單）" value="${esc(x.name)}" data-dn="${i}"><input placeholder="金額" inputmode="numeric" value="${x.amount||''}" data-da="${i}"><input type="month" value="${esc(x.start_month||thisM())}" data-ds="${i}" title="扣在哪個月的薪資"><button type="button" class="danger" data-dr="${i}" style="padding:4px 10px;min-height:0">×</button></div>`:`<div class="pr-ded"><input placeholder="項目（例如：法扣、制服費）" value="${esc(x.name)}" data-dn="${i}"><input placeholder="每月金額" inputmode="numeric" value="${x.amount||''}" data-da="${i}"><input type="month" value="${esc(x.start_month||thisM())}" data-ds="${i}" title="從哪個月開始扣"><input type="number" min="0" placeholder="期數" value="${x.months||''}" data-dm="${i}" title="扣幾個月，0 或空白＝每月持續"><button type="button" class="danger" data-dr="${i}" style="padding:4px 10px;min-height:0">×</button></div>`).join('')}</div>`;}
  function bindDeductions(box,list,id,onChange,once){
    const wrap=box.querySelector('#'+id);
    wrap.querySelectorAll('[data-dn]').forEach(i=>i.addEventListener('input',()=>{list[i.dataset.dn].name=i.value;onChange&&onChange();}));
    wrap.querySelectorAll('[data-da]').forEach(i=>i.addEventListener('input',()=>{list[i.dataset.da].amount=n(i.value);onChange&&onChange();}));
    wrap.querySelectorAll('[data-ds]').forEach(i=>i.addEventListener('change',()=>{list[i.dataset.ds].start_month=i.value;onChange&&onChange();}));
    wrap.querySelectorAll('[data-dm]').forEach(i=>i.addEventListener('input',()=>{list[i.dataset.dm].months=n(i.value);}));
    wrap.querySelectorAll('[data-dr]').forEach(b=>b.addEventListener('click',()=>{list.splice(Number(b.dataset.dr),1);wrap.outerHTML=deductionRows(list,id,once);bindDeductions(box,list,id,onChange,once);onChange&&onChange();}));
  }
  function editSalary(p,T,done,ci=[]){
    const st={...p,allowances:(p.allowances||[]).map(x=>({...x})),recurring:(p.deductions||[]).filter(x=>!x.once).map(x=>({...x})),once:(p.deductions||[]).filter(x=>x.once).map(x=>({...x}))};
    const {box,close}=modal(`💰 ${esc(p.name)}｜薪資設定`,`<form class="pr-form" id="salForm">
      <label class="chk wide"><input type="checkbox" name="payroll_enabled" ${st.payroll_enabled?'checked':''}> 納入每月薪資計算</label>
      <div class="wide pr-info"><b>人事資料（人事登記，這裡只顯示）</b><br>到職 ${esc(p.hire_date||'未登記')}｜試用期至 ${esc(p.trial_end_date||'未登記')}｜加保：${[p.labor_insured?'勞保':'',p.labor_insured&&p.employment_insured?'就保':'',p.health_insured?'健保':'',p.pension_enabled?'勞退':''].filter(Boolean).join('、')||'無'}${p.insured_date?`（${esc(p.insured_date)}）`:''}<br>勞保級距 ${p.labor_insured?money(p.labor_grade):'—'}｜健保級距 ${p.health_insured?money(p.health_grade):'—'}｜勞退 ${p.pension_enabled?money(p.pension_grade):'—'}｜健保眷屬 ${p.health_dependents||0} 人<br>發放：${p.pay_method==='cash'?'領現':p.bank_account?`薪轉 ${esc(p.bank_name)} ${esc(p.bank_account)}`:'尚未登記薪轉帳號'}</div>
      <div class="pr-sec">薪資</div>
      <label>試用期薪資（元／月）<input name="trial_salary" inputmode="numeric" value="${st.trial_salary||''}" placeholder="${p.trial_end_date?'試用期間適用':'沒有試用期可留白'}"></label>
      <label>正式薪資（元／月）<input name="base_salary" inputmode="numeric" value="${st.base_salary||''}" placeholder="例如 32000"></label>
      <p class="hint wide" style="margin:-4px 0 0">試用期到期日在月中時，當月底薪依日數比例計算（試用期薪資＋正式薪資）。</p>
      <div class="wide"><div style="font-weight:700;font-size:.86rem;margin-bottom:5px">固定加給（每月固定發放）</div><div id="salAllow"></div><button type="button" class="secondary" id="salAllowAdd" style="padding:6px 12px;min-height:0">＋ 新增加給</button></div>
      <div class="wide"><div style="font-weight:700;font-size:.86rem;margin-bottom:5px">每月定期代扣款（法扣、制服費、宿舍費等；每月自動扣，期數到了自動停止）</div><div class="pr-ded pr-ded-head"><span>項目</span><span>每月金額</span><span>開始月份</span><span>期數（空白＝持續）</span><span></span></div>${deductionRows(st.recurring,'salDed')}<button type="button" class="secondary" id="salDedAdd" style="padding:6px 12px;min-height:0">＋ 新增定期代扣</button></div>
      <div class="wide"><div style="font-weight:700;font-size:.86rem;margin-bottom:5px">當月扣款（只扣指定月份一次，例如遲到扣款、設備賠償）</div><div class="pr-ded pr-ded-once pr-ded-head"><span>項目</span><span>金額</span><span>扣款月份</span><span></span></div>${deductionRows(st.once,'salOnce',true)}<button type="button" class="secondary" id="salOnceAdd" style="padding:6px 12px;min-height:0">＋ 新增當月扣款</button></div>
      ${ci.length?`<div class="wide"><div style="font-weight:700;font-size:.86rem;margin-bottom:5px">公司保險費（取消勾選＝這個人不扣）</div><div style="display:flex;gap:14px;flex-wrap:wrap">${ci.map(x=>`<label class="chk" style="margin:0"><input type="checkbox" data-ins="${esc(x.id)}" ${(p.ins_exclude||[]).includes(x.id)?'':'checked'}> ${esc(x.name)}（員工 ${money(x.employee)}${n(x.company)?`／公司 ${money(x.company)}`:''}）</label>`).join('')}</div></div>`:''}
      <div class="pr-sec">勞退自提</div>
      <label>勞退自提（%）<input type="number" min="0" max="6" step="1" name="pension_self_rate" value="${st.pension_self_rate||0}"></label>
      <label class="wide">薪資備註<textarea name="salary_note" rows="2">${esc(st.salary_note)}</textarea></label>
      <div class="pr-preview" id="salPreview"></div>
      <div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">💾 儲存</button></div></form>`,{wide:true});
    const f=box.querySelector('#salForm');
    const drawAllow=()=>{box.querySelector('#salAllow').innerHTML=st.allowances.map((a,i)=>`<div class="pr-allow"><input placeholder="名稱" value="${esc(a.name)}" data-an="${i}"><input placeholder="金額" inputmode="numeric" value="${a.amount||''}" data-aa="${i}" style="max-width:140px"><button type="button" class="danger" data-ar="${i}" style="padding:4px 10px;min-height:0">×</button></div>`).join('');
      box.querySelectorAll('[data-an]').forEach(i=>i.addEventListener('input',()=>{st.allowances[i.dataset.an].name=i.value;}));box.querySelectorAll('[data-aa]').forEach(i=>i.addEventListener('input',()=>{st.allowances[i.dataset.aa].amount=n(i.value);update();}));box.querySelectorAll('[data-ar]').forEach(b=>b.addEventListener('click',()=>{st.allowances.splice(Number(b.dataset.ar),1);drawAllow();update();}));};
    box.querySelector('#salAllowAdd').onclick=()=>{st.allowances.push({name:'',amount:0});drawAllow();};
    box.querySelector('#salDedAdd').onclick=()=>{st.recurring.push({name:'',amount:0,start_month:thisM(),months:0});box.querySelector('#salDed').outerHTML=deductionRows(st.recurring,'salDed');bindDeductions(box,st.recurring,'salDed',update);box.querySelector('#salDed .pr-ded:last-child input')?.focus();};
    box.querySelector('#salOnceAdd').onclick=()=>{st.once.push({name:'',amount:0,start_month:thisM(),once:true});box.querySelector('#salOnce').outerHTML=deductionRows(st.once,'salOnce',true);bindDeductions(box,st.once,'salOnce',update,true);box.querySelector('#salOnce .pr-ded:last-child input')?.focus();};
    bindDeductions(box,st.recurring,'salDed',update);bindDeductions(box,st.once,'salOnce',update,true);
    const read=()=>{const v=k=>f.elements[k];return {payroll_enabled:v('payroll_enabled').checked,trial_salary:n(v('trial_salary').value),base_salary:n(v('base_salary').value),allowances:st.allowances.filter(a=>a.name.trim()&&n(a.amount)),deductions:[...st.recurring.filter(x=>x.name.trim()&&n(x.amount)),...st.once.filter(x=>x.name.trim()&&n(x.amount)).map(x=>({...x,once:true,months:1}))],pension_self_rate:Number(v('pension_self_rate').value)||0,salary_note:v('salary_note').value,ins_exclude:[...box.querySelectorAll('[data-ins]')].filter(c=>!c.checked).map(c=>c.dataset.ins)};};
    function update(){
      const v=read();const allow=v.allowances.reduce((a,x)=>a+n(x.amount),0);
      const inTrial=v.trial_salary&&p.trial_end_date&&p.trial_end_date>=`${thisM()}-01`;
      const monthly=(inTrial?v.trial_salary:v.base_salary)+allow;
      const g=p.auto_grade?{labor_grade:gradeFor(T.labor,monthly),health_grade:gradeFor(T.health,monthly),pension_grade:gradeFor(T.pension,monthly)}:{labor_grade:p.labor_grade,health_grade:p.health_grade,pension_grade:p.pension_grade};
      const ins=calcIns({...v,...g,monthly,auto_grade:p.auto_grade,labor_insured:p.labor_insured,employment_insured:p.employment_insured,occupational_insured:true,health_insured:p.health_insured,pension_enabled:p.pension_enabled,health_dependents:p.health_dependents},T);
      const m=thisM();const ded=v.deductions.filter(x=>x.once?x.start_month===m:x.start_month<=m).reduce((a,x)=>a+n(x.amount),0);
      const insEe=p.hire_date&&p.hire_date>`${m}-31`?0:ci.filter(x=>!v.ins_exclude.includes(x.id)).reduce((a,x)=>a+n(x.employee),0);const net=monthly-sum(ins.employee)-ded-insEe;
      box.querySelector('#salPreview').innerHTML=`<div class="ee"><b>${inTrial?'試用期中，':''}本月試算（員工）</b><br>月薪 ${money(monthly)} − 勞保 ${money(ins.employee.labor)} − 健保 ${money(ins.employee.health)}${ins.employee.pension_self?` − 勞退自提 ${money(ins.employee.pension_self)}`:''}${insEe?` − 保險費 ${money(insEe)}`:''}${ded?` − 代扣 ${money(ded)}`:''}<br><b>約實發 ${money(net)} 元</b>（未含加班、請假、借資）</div><div class="er"><b>公司每月負擔</b><br>勞保 ${money(ins.employer.labor)}　職災 ${money(ins.employer.occupational)}　健保 ${money(ins.employer.health)}　勞退 ${money(ins.employer.pension)}<br><b>合計 ${money(sum(ins.employer))} 元</b></div>`;
    }
    drawAllow();update();f.addEventListener('input',update);f.addEventListener('change',update);
    box.querySelector('[data-cancel]').onclick=close;
    f.addEventListener('submit',async e=>{e.preventDefault();const v=read();if(v.trial_salary&&!p.trial_end_date&&!confirm('這位人員在人事管理還沒有登記試用期到期日，試用期薪資不會生效。仍要儲存嗎？'))return;try{await api(`/api/company/payroll/salaries/${p.staff_id}`,J('PUT',v));close();done();}catch(err){alert(err.message);}});
  }

  // ================= 人員薪資統計表 =================
  async function renderStats(el,label,month){
    month=month||S.month||thisMonth();S.month=month;
    const [{run},meta]=await Promise.all([api(`/api/company/payroll/runs/${month}`),api('/api/company/payroll/runs')]);
    const pub=run?.status==='published';
    const T=run?.totals||{};
    const runsHtml=(meta.runs||[]).slice(0,8).map(r=>`<button type="button" class="${r.month===month?'':'secondary'}" data-month="${r.month}" style="padding:5px 12px;min-height:0;font-size:.82rem">${monthLabel(r.month)}${r.status==='published'?' ✓':''}</button>`).join('');
    el.innerHTML=`<div class="eyebrow">📊 會計</div><h1>${esc(label||'人員薪資統計表')}</h1><p class="hint">按「產生本月薪資」會依「人事管理」的薪資與投保資料，自動計算勞健保、勞退與借資扣回。加班費、請假扣款等可以直接在表上修改。確認後按「發布薪資單」，每位人員會收到通知並可在職員資料查看。</p>
      <div class="pr-bar"><label style="display:flex;align-items:center;gap:8px;margin:0;font-weight:700">月份 <input type="month" id="prMonth" value="${month}"></label>${run?`<span class="pr-pill ${run.status}">${pub?`已發布（${esc(run.published_by||'')}）`:'草稿'}</span>`:''}
        ${!pub?`<button type="button" id="prGen">${run?'🔄 重新計算':'⚙ 產生本月薪資'}</button>`:''}${run&&!pub?'<button type="button" id="prPub">📣 發布薪資單</button>':''}${pub?'<button type="button" class="secondary" id="prUnpub">↩ 撤回發布</button>':''}${run?'<button type="button" class="secondary" id="prExport">📥 匯出 Excel</button><button type="button" class="secondary" id="prPrint">🖨 列印</button>':''}${run&&!pub?'<button type="button" class="danger" id="prDel">刪除草稿</button>':''}</div>
      ${runsHtml?`<div class="pr-bar" style="margin-top:-6px">${runsHtml}</div>`:''}
      ${!run?`<div class="empty">${monthLabel(month)}還沒有薪資資料。請先確認「人事管理」中每位人員的薪資，再按「產生本月薪資」。</div>`:`
      ${run.items.some(x=>!x.configured)?`<div class="pr-warn">⚠ ${esc(run.items.filter(x=>!x.configured).map(x=>x.name).join('、'))} 尚未在人事管理設定薪資，金額為 0。</div>`:''}
      <table class="pr-law"><tr><th colspan="2">⚠ 2026 年請假新制提醒（勞工請假規則，115 年 1 月 1 日施行）</th></tr><tr><td>病假 10 日保障</td><td>一年內病假未超過 10 日，公司不得因此扣考績、降薪、調職或扣獎金等不利處分；超過 10 日也不能只用病假天數當考核標準。</td></tr><tr><td>全勤獎金按比例</td><td>請病假時全勤獎金只能依請假日數按比例扣，不能請 1 天就整筆扣光。生理假、婚假、喪假、公假、公傷病假、產假、產檢假、陪產假、家庭照顧假不得扣全勤。</td></tr>${(()=>{const hit=run.items.filter(x=>Number(x.sick_days_year)>0);return hit.length?`<tr><td>今年病假天數</td><td>${hit.map(x=>`${esc(x.name)} ${x.sick_days_year} 日${Number(x.sick_days_year)<=10?'（10 日內）':''}`).join('、')}</td></tr>`:'';})()}</table>
      ${pub?`<div class="pr-ok">✓ 已發布給 ${run.items.length} 位人員：已讀 ${run.viewed} 人、已確認 ${run.confirmed} 人。如需修改請先「撤回發布」。</div>`:''}
      <div class="pr-kpis"><div class="pr-kpi"><span>人數</span><b>${run.items.length}</b></div><div class="pr-kpi"><span>應發合計</span><b>${money(T.gross)}</b></div><div class="pr-kpi"><span>實發合計</span><b>${money(T.net)}</b></div><div class="pr-kpi"><span>公司負擔勞健保／勞退／保險費</span><b>${money(T.employer_total)}</b></div><div class="pr-kpi"><span>人事成本合計</span><b>${money(T.employer_cost)}</b></div></div>
      <div class="pr-wrap" id="prTableWrap"><table class="pr-table"><thead><tr class="grp"><th class="sticky"></th><th colspan="5">應發</th><th colspan="10">應扣</th><th></th><th colspan="6">公司負擔</th></tr><tr class="cols"><th class="sticky">人員</th><th>底薪</th><th>固定加給</th><th>加班費</th><th>其他加項</th><th>應發合計</th><th>勞保</th><th>健保</th><th>勞退自提</th><th>保險費</th><th>請假扣款</th><th>全勤扣減</th><th>借資扣回</th><th>代扣款</th><th>其他扣項</th><th>應扣合計</th><th>實發金額</th><th>勞保</th><th>職災</th><th>健保</th><th>勞退6%</th><th>保險費</th><th>人事成本</th></tr></thead><tbody>
      ${run.items.map(x=>{const ed=k=>pub?money(x[k]):`<input data-item="${x.id}" data-k="${k}" value="${n(x[k])||''}" inputmode="numeric" placeholder="0">`;const ee=x.ins?.employee||{},er=x.ins?.employer||{};return `<tr><td class="sticky"><button type="button" class="lnk" data-detail="${x.id}">${esc(x.name)}</button><br><small class="muted">${esc(x.employee_id)}</small></td><td title="${esc(x.base_note||'')}">${money(x.base)}${x.base_manual?' ✎':x.base_note?' <small class="muted">試</small>':''}</td><td>${money((x.allowances||[]).reduce((a,y)=>a+n(y.amount),0))}</td><td title="${x.overtime_hours?`加班 ${x.overtime_hours} 小時`:''}">${ed('overtime')}${x.overtime_autocalc&&n(x.overtime)?'<br><small class="muted">依紀錄</small>':''}</td><td>${ed('other_add')}</td><td><b>${money(x.gross)}</b></td><td class="ee">${money(ee.labor)}</td><td class="ee">${money(ee.health)}</td><td class="ee">${money(ee.pension_self)}</td><td class="ee" title="${esc((x.company_ins||[]).filter(i=>n(i.employee)).map(i=>`${i.name} ${i.employee}`).join('、'))}">${money(x.company_ins_ee)}</td><td title="${esc((x.leave_lines||[]).map(l=>`${l.label} ${l.length}：${l.amount}`).join('\n'))}">${ed('leave_deduct')}${x.leave_auto&&(x.leave_lines||[]).length?'<br><small class="muted">依假單</small>':x.leave_manual&&n(x.leave_deduct)?'<br><small class="muted">手動</small>':''}</td><td>${ed('attendance_deduct')}</td><td>${ed('advance_deduct')}</td><td title="${esc((x.deductions||[]).map(d=>`${d.name} ${d.amount}（${d.period}）`).join('、'))}">${money(x.deductions_total)}</td><td>${ed('other_deduct')}</td><td><b>${money(x.deduct_total)}</b></td><td class="net">${money(x.net)}</td><td class="er">${money(er.labor)}</td><td class="er">${money(er.occupational)}</td><td class="er">${money(er.health)}</td><td class="er">${money(er.pension)}</td><td class="er">${money(x.company_ins_er)}</td><td><b>${money(x.employer_cost)}</b></td></tr>`;}).join('')}
      <tr class="tot"><td class="sticky">合計</td><td>${money(T.base)}</td><td>${money(T.allowances)}</td><td>${money(T.overtime)}</td><td>${money(T.other_add)}</td><td>${money(T.gross)}</td><td>${money(T.labor_ee)}</td><td>${money(T.health_ee)}</td><td>${money(T.pension_self)}</td><td>${money(T.company_ins_ee)}</td><td>${money(T.leave_deduct)}</td><td>${money(T.attendance_deduct)}</td><td>${money(T.advance_deduct)}</td><td>${money(T.deductions)}</td><td>${money(T.other_deduct)}</td><td>${money(T.deduct_total)}</td><td>${money(T.net)}</td><td>${money(T.labor_er)}</td><td>${money(T.occupational_er)}</td><td>${money(T.health_er)}</td><td>${money(T.pension_er)}</td><td>${money(T.company_ins_er)}</td><td>${money(T.employer_cost)}</td></tr></tbody></table></div>
      <p class="hint" style="margin-top:8px">請假扣款、全勤扣減依核准的假單自動計算（滑鼠移到金額上看明細）；加班費依加班紀錄以平日費率試算，休息日、國定假日加班請手動調整。手動修改過的金額，重新計算時會保留。「試」表示當月含試用期薪資；代扣款來自「薪資設定」的定期代扣（滑鼠移上去看明細）。使用 ${run.table_year} 年投保級距表；職災費率 ${(Number(run.rates?.occupational||0)*100).toFixed(2)}%（<button type="button" class="lnk" id="prOcc">修改本公司職災費率</button>）。點人員姓名可以填寫備註、調整底薪。</p>`}`;
    el.querySelector('#prMonth').addEventListener('change',e=>{if(e.target.value)renderStats(el,label,e.target.value).catch(err=>alert(err.message));});
    el.querySelectorAll('[data-month]').forEach(b=>b.addEventListener('click',()=>renderStats(el,label,b.dataset.month).catch(err=>alert(err.message))));
    el.querySelector('#prGen')?.addEventListener('click',async e=>{e.target.disabled=true;try{await api(`/api/company/payroll/runs/${month}/generate`,{method:'POST'});await renderStats(el,label,month);}catch(err){alert(err.message);e.target.disabled=false;}});
    el.querySelector('#prPub')?.addEventListener('click',async()=>{if(!confirm(`確定發布 ${monthLabel(month)} 的薪資單給 ${run.items.length} 位人員嗎？\n\n發布後每位人員會收到訊息通知，借資扣回也會正式入帳。`))return;try{await api(`/api/company/payroll/runs/${month}/publish`,{method:'POST'});await renderStats(el,label,month);}catch(err){alert(err.message);}});
    el.querySelector('#prUnpub')?.addEventListener('click',async()=>{if(!confirm('撤回後人員就看不到這個月的薪資單，借資扣回也會還原。修改完請再重新發布。確定嗎？'))return;try{await api(`/api/company/payroll/runs/${month}/unpublish`,{method:'POST'});await renderStats(el,label,month);}catch(err){alert(err.message);}});
    el.querySelector('#prDel')?.addEventListener('click',async()=>{if(!confirm('刪除這個月份的薪資草稿？'))return;try{await api(`/api/company/payroll/runs/${month}`,{method:'DELETE'});await renderStats(el,label,month);}catch(err){alert(err.message);}});
    el.querySelector('#prExport')?.addEventListener('click',()=>window.open(`/api/company/payroll/runs/${month}/export`,'_blank'));
    el.querySelector('#prPrint')?.addEventListener('click',()=>{const w=window.open('','_blank');if(!w)return;w.document.write(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>人員薪資統計表 ${monthLabel(month)}</title><style>body{font-family:sans-serif;padding:16px}table{border-collapse:collapse;font-size:11px}th,td{border:1px solid #999;padding:3px 5px;text-align:right;white-space:nowrap}th{background:#eee}input{display:none}.sticky,.l{text-align:left}button{border:0;background:none;padding:0;font:inherit}@page{size:A4 landscape;margin:10mm}</style></head><body><h2>人員薪資統計表 ${monthLabel(month)}</h2>${el.querySelector('#prTableWrap').innerHTML.replace(/<input[^>]*value="([^"]*)"[^>]*>/g,'$1')}</body></html>`);w.document.close();setTimeout(()=>w.print(),300);});
    el.querySelector('#prOcc')?.addEventListener('click',async()=>{const v=prompt('職災保險費率（%），依公司行業別，含通勤災害。例如 0.21',(Number(run.rates?.occupational||0)*100).toFixed(2));if(v===null)return;try{await api('/api/company/payroll/settings',J('PUT',{occupational_rate:Number(v)/100}));if(!pub)await api(`/api/company/payroll/runs/${month}/generate`,{method:'POST'});await renderStats(el,label,month);}catch(err){alert(err.message);}});
    let t;el.querySelectorAll('input[data-item]').forEach(inp=>inp.addEventListener('change',()=>{clearTimeout(t);const id=inp.dataset.item,k=inp.dataset.k;t=setTimeout(async()=>{try{await api(`/api/company/payroll/items/${id}`,J('PUT',{[k]:n(inp.value)}));const pos=el.querySelector('#prTableWrap')?.scrollLeft||0;await renderStats(el,label,month);const w=el.querySelector('#prTableWrap');if(w)w.scrollLeft=pos;}catch(err){alert(err.message);}},150);}));
    el.querySelectorAll('[data-detail]').forEach(b=>b.addEventListener('click',()=>itemDetail(run.items.find(x=>String(x.id)===b.dataset.detail),pub,()=>renderStats(el,label,month))));
  }
  function itemDetail(x,pub,done){
    const {box,close}=modal('',`${window.PayslipView?window.PayslipView.html({...x,month:S.month}):''}${pub?'':`<form class="pr-form" id="itForm" style="margin-top:14px"><div class="pr-sec">調整（只影響這個月）</div><label>底薪（本月）<input name="base" inputmode="numeric" value="${n(x.base)}"></label><label>借資扣回（本月）<input name="advance_deduct" inputmode="numeric" value="${n(x.advance_deduct)}"></label><label>其他加項說明<input name="other_add_note" value="${esc(x.other_add_note||'')}" placeholder="例如：績效獎金"></label><label>其他扣項說明<input name="other_deduct_note" value="${esc(x.other_deduct_note||'')}" placeholder="例如：制服費"></label><label class="wide">備註（會顯示在員工薪資單）<input name="note" value="${esc(x.note||'')}"></label><div class="wide modal-actions">${x.base_manual||x.advance_manual||x.leave_manual||x.overtime_manual||x.att_manual?'<button type="button" class="secondary" id="itReset">↺ 改回系統自動計算</button>':''}<button type="button" class="secondary" data-cancel>取消</button><button type="submit">儲存</button></div></form>`}`,{wide:true});
    box.querySelector('[data-cancel]')?.addEventListener('click',close);
    box.querySelector('#itReset')?.addEventListener('click',async()=>{try{await api(`/api/company/payroll/items/${x.id}`,J('PUT',{reset:true}));close();done();}catch(err){alert(err.message);}});
    box.querySelector('#itForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.target.elements;const body={other_add_note:f.other_add_note.value,other_deduct_note:f.other_deduct_note.value,note:f.note.value};if(n(f.base.value)!==n(x.base))body.base=n(f.base.value);if(n(f.advance_deduct.value)!==n(x.advance_deduct))body.advance_deduct=n(f.advance_deduct.value);try{await api(`/api/company/payroll/items/${x.id}`,J('PUT',body));close();done();}catch(err){alert(err.message);}});
  }

  // ================= 人員薪資單（會計檢視已發布） =================
  async function renderSlips(el,label,month,tab){
    tab=tab||S.slipTab||'settings';S.slipTab=tab;
    if(tab==='settings'){
      el.innerHTML=`<div class="eyebrow">📄 會計</div><h1>${esc(label||'人員薪資')}</h1><div class="pr-tabs"><button type="button" data-tab="settings">💰 薪資設定</button><button type="button" class="secondary" data-tab="published">📄 已發布薪資單</button><button type="button" class="secondary" id="psMine" style="margin-left:auto">我的薪資單</button></div><div id="salBox"><div class="profile-loading">正在讀取資料中，請稍候…</div></div>`;
      el.querySelector('[data-tab=published]').addEventListener('click',()=>renderSlips(el,label,null,'published').catch(err=>alert(err.message)));
      el.querySelector('#psMine').addEventListener('click',()=>openMine().catch(err=>alert(err.message)));
      return renderSalaries(el.querySelector('#salBox'));
    }
    const meta=await api('/api/company/payroll/runs');const pubs=(meta.runs||[]).filter(r=>r.status==='published');
    month=month||pubs[0]?.month;
    const run=month?(await api(`/api/company/payroll/runs/${month}`)).run:null;
    el.innerHTML=`<div class="eyebrow">📄 會計</div><h1>${esc(label||'人員薪資')}</h1><div class="pr-tabs"><button type="button" class="secondary" data-tab="settings">💰 薪資設定</button><button type="button" data-tab="published">📄 已發布薪資單</button></div><p class="hint">在「人員薪資統計表」按「發布薪資單」後，會自動為每位人員產生薪資單並以訊息通知。這裡可以看到每個人是否已讀、已確認。</p>
      <div class="pr-bar">${pubs.map(r=>`<button type="button" class="${r.month===month?'':'secondary'}" data-month="${r.month}" style="padding:5px 12px;min-height:0">${monthLabel(r.month)}</button>`).join('')||'<span class="muted">還沒有發布過薪資單。</span>'}<button type="button" class="secondary" id="psMine" style="margin-left:auto">📄 我的薪資單</button></div>
      ${run&&run.status==='published'?`<div class="pr-ok">${monthLabel(month)}：發布 ${run.items.length} 份，已讀 ${run.viewed}、已確認 ${run.confirmed}。發布者 ${esc(run.published_by||'')}。</div><div class="pr-wrap"><table class="pr-table"><thead><tr class="cols"><th class="sticky">人員</th><th class="l">職務</th><th>應發</th><th>應扣</th><th>實發</th><th class="l">已讀</th><th class="l">已確認</th><th></th></tr></thead><tbody>${run.items.map(x=>`<tr><td class="sticky"><b>${esc(x.name)}</b><br><small class="muted">${esc(x.employee_id)}</small></td><td class="l">${esc(x.position||'')}</td><td>${money(x.gross)}</td><td>${money(x.deduct_total)}</td><td class="net">${money(x.net)}</td><td class="l">${x.viewed_at?'✓':'—'}</td><td class="l">${x.confirmed_at?'<span class="pr-pill published">已確認</span>':'<span class="muted">未確認</span>'}</td><td><button type="button" class="secondary" data-view="${x.id}" style="padding:5px 12px;min-height:0">查看</button></td></tr>`).join('')}</tbody></table></div>`:''}`;
    el.querySelectorAll('[data-month]').forEach(b=>b.addEventListener('click',()=>renderSlips(el,label,b.dataset.month,'published').catch(err=>alert(err.message))));
    el.querySelector('[data-tab=settings]').addEventListener('click',()=>renderSlips(el,label,null,'settings').catch(err=>alert(err.message)));
    el.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{const x=run.items.find(i=>String(i.id)===b.dataset.view);modal('',window.PayslipView.html({...x,month}),{wide:true});}));
    el.querySelector('#psMine').addEventListener('click',()=>openMine().catch(err=>alert(err.message)));
  }
  // 我的薪資單（內勤自己）
  async function openMine(base='/api/company/my'){
    const d=await api(`${base}/payslips`);
    const {box,close}=modal('📄 我的薪資單',d.payslips.length?`<div class="pr-wrap"><table class="pr-table" style="width:100%"><thead><tr class="cols"><th class="l">月份</th><th>實發</th><th class="l">狀態</th><th></th></tr></thead><tbody>${d.payslips.map(p=>`<tr><td class="l">${monthLabel(p.month)}</td><td class="net">${money(p.net)}</td><td class="l">${p.confirmed_at?'已確認':'<span class="pr-pill draft">待確認</span>'}</td><td><button type="button" class="secondary" data-open="${p.id}" style="padding:5px 12px;min-height:0">查看</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">目前還沒有薪資單。</p>');
    box.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',async()=>{close();await showPayslip(base,b.dataset.open);}));
  }
  async function showPayslip(base,id){
    const {payslip}=await api(`${base}/payslips/${id}`);
    const {box,close}=modal('',`${window.PayslipView.html(payslip)}<div class="modal-actions">${payslip.confirmed_at?'':'<button type="button" id="psConfirm">✓ 已確認，金額無誤</button>'}<button type="button" class="secondary" data-cancel>關閉</button></div>`,{wide:true});
    box.querySelector('[data-cancel]').onclick=close;
    box.querySelector('#psConfirm')?.addEventListener('click',async()=>{try{await api(`${base}/payslips/${id}/confirm`,{method:'POST'});close();await showPayslip(base,id);}catch(err){alert(err.message);}});
  }

  // ================= 借資 =================
  async function renderAdvances(el,label){
    const d=await api('/api/company/payroll/advances');S.adFilter=S.adFilter||'active';
    const list=d.advances.filter(a=>S.adFilter==='all'||a.status===S.adFilter);
    const active=d.advances.filter(a=>a.status==='active');
    el.innerHTML=`<div class="eyebrow">💰 會計</div><h1>${esc(label||'借資')}</h1><div class="section-title">🧾 借支申請</div><p class="hint">人員在「職員資料 → 借支申請」自行申請，依公司規則自動算可借金額、依關卡審核。會計在這裡勾選「待撥款」的申請按「確認撥款」：會建立借資（撥款月份的薪資一次扣回），總金額轉入公司應支。</p><div id="advAcct"></div><div class="section-title" style="margin-top:22px">💰 借資（扣回中）</div><p class="hint">登記人員借資（預支薪資）。產生每月薪資時，系統會依「每月扣回金額」自動帶入「借資扣回」；發布薪資單後才正式扣回，還完會自動結清。</p>
      <div class="pr-kpis"><div class="pr-kpi"><span>進行中借資</span><b>${active.length} 筆</b></div><div class="pr-kpi"><span>尚未還款餘額</span><b>${money(active.reduce((a,x)=>a+n(x.balance),0))}</b></div><div class="pr-kpi"><span>每月預計扣回</span><b>${money(active.reduce((a,x)=>a+Math.min(n(x.monthly_deduct),n(x.balance)),0))}</b></div></div>
      <div class="pr-bar"><button type="button" class="secondary" id="adAdd">＋ 直接登記借資（分期等特殊狀況）</button><div class="pr-tabs" style="margin:0">${[['active','進行中'],['closed','已結清'],['all','全部']].map(([k,t])=>`<button type="button" class="${S.adFilter===k?'':'secondary'}" data-f="${k}">${t}</button>`).join('')}</div></div>
      ${list.length?`<div class="pr-wrap"><table class="pr-table" style="width:100%"><thead><tr class="cols"><th class="sticky">人員</th><th class="l">借資日期</th><th>借資金額</th><th>每月扣回</th><th class="l">開始扣回</th><th>已還</th><th>剩餘</th><th class="l">事由</th><th class="l">狀態</th><th></th></tr></thead><tbody>${list.map(a=>`<tr><td class="sticky"><b>${esc(a.name)}</b><br><small class="muted">${esc(a.employee_id)}</small></td><td class="l">${esc(a.advance_date)}</td><td>${money(a.amount)}</td><td>${money(a.monthly_deduct)}</td><td class="l">${monthLabel(a.start_month)}</td><td>${money(n(a.amount)-n(a.balance))}</td><td class="net">${money(a.balance)}</td><td class="l" style="white-space:normal;min-width:120px">${esc(a.reason||'')}</td><td class="l">${a.status==='active'?'<span class="pr-pill draft">扣回中</span>':'<span class="pr-pill published">已結清</span>'}</td><td style="white-space:nowrap"><button type="button" class="secondary" data-hist="${a.id}" style="padding:4px 10px;min-height:0">紀錄</button> ${a.status==='active'?`<button type="button" class="secondary" data-edit="${a.id}" style="padding:4px 10px;min-height:0">編輯</button> <button type="button" class="secondary" data-close="${a.id}" style="padding:4px 10px;min-height:0">結清</button>`:''} ${a.repayments.length?'':`<button type="button" class="danger" data-del="${a.id}" style="padding:4px 10px;min-height:0">刪除</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前沒有資料。</div>'}
      <p class="hint" style="margin-top:18px">🧾 代扣款（法扣、制服費、宿舍費）與 🛡 公司保險費（團險、誠實險）已移到「人員薪資 → 薪資設定」。</p>`;
    const reload=()=>renderAdvances(el,label);
    if(window.AdvanceModule)window.AdvanceModule.accountantPanel(el.querySelector('#advAcct'),d.staff);else el.querySelector('#advAcct').innerHTML='<div class="muted">借支模組尚未載入</div>';
    el.querySelectorAll('[data-f]').forEach(b=>b.addEventListener('click',()=>{S.adFilter=b.dataset.f;reload();}));
    el.querySelector('#adAdd').addEventListener('click',()=>advanceForm(null,d.staff,reload));
    el.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>advanceForm(d.advances.find(a=>String(a.id)===b.dataset.edit),d.staff,reload)));
    el.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',async()=>{const a=d.advances.find(x=>String(x.id)===b.dataset.close);if(!confirm(`把「${a.name}」這筆借資結清嗎？\n剩餘 ${money(a.balance)} 元會登記為「現金還款／結清」，之後不再從薪資扣回。`))return;try{await api(`/api/company/payroll/advances/${a.id}`,J('PUT',{status:'closed',settle:true}));reload();}catch(err){alert(err.message);}}));
    el.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('刪除這筆借資登記？'))return;try{await api(`/api/company/payroll/advances/${b.dataset.del}`,{method:'DELETE'});reload();}catch(err){alert(err.message);}}));
    el.querySelectorAll('[data-hist]').forEach(b=>b.addEventListener('click',()=>{const a=d.advances.find(x=>String(x.id)===b.dataset.hist);modal(`💰 ${esc(a.name)}｜借資紀錄`,`<p>${esc(a.advance_date)} 借資 <b>${money(a.amount)}</b> 元，每月扣回 ${money(a.monthly_deduct)} 元。${a.reason?`<br>事由：${esc(a.reason)}`:''}</p>${a.repayments.length?`<table class="pr-table" style="width:100%"><thead><tr class="cols"><th class="l">月份</th><th>金額</th><th class="l">方式</th></tr></thead><tbody>${a.repayments.map(r=>`<tr><td class="l">${monthLabel(r.month)}</td><td>${money(r.amount)}</td><td class="l">${esc(r.note||'')}</td></tr>`).join('')}</tbody></table>`:'<p class="hint">還沒有扣回紀錄。</p>'}<p><b>剩餘 ${money(a.balance)} 元</b></p>`);}));
  }
  function advanceForm(a,staff,done){
    const isNew=!a;const today=new Date().toISOString().slice(0,10);
    const nextMonth=(()=>{const d=new Date();d.setMonth(d.getMonth()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;})();
    const {box,close}=modal(isNew?'💰 登記借資':'✏️ 修改借資',`<form class="pr-form" id="adForm"><label class="wide">人員<select name="staff_id" ${isNew?'':'disabled'}>${staff.map(s=>`<option value="${s.id}" ${a&&a.staff_id===s.id?'selected':''}>${esc(s.name)}（${esc(s.employee_id)}）</option>`).join('')}</select></label><label>借資日期<input type="date" name="advance_date" value="${esc(a?.advance_date||today)}"></label><label>借資金額<input name="amount" inputmode="numeric" value="${a?a.amount:''}"></label><label>每月扣回金額<input name="monthly_deduct" inputmode="numeric" value="${a?a.monthly_deduct:''}" placeholder="一次扣清就填借資金額"></label><label>從哪個月的薪資開始扣<input type="month" name="start_month" value="${esc(a?.start_month||thisMonth())}"></label><label class="wide">事由（選填）<input name="reason" value="${esc(a?.reason||'')}"></label><p class="hint wide" id="adHint"></p><div class="wide modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">儲存</button></div></form>`);
    const f=box.querySelector('#adForm');const hint=()=>{const amt=n(f.amount.value),m=n(f.monthly_deduct.value);box.querySelector('#adHint').textContent=amt&&m?`預計分 ${Math.ceil(amt/m)} 個月扣完。`:'';};f.addEventListener('input',hint);hint();
    box.querySelector('[data-cancel]').onclick=close;
    f.addEventListener('submit',async e=>{e.preventDefault();const body={staff_id:Number(f.staff_id.value),advance_date:f.advance_date.value,amount:n(f.amount.value),monthly_deduct:n(f.monthly_deduct.value),start_month:f.start_month.value,reason:f.reason.value};try{await api(isNew?'/api/company/payroll/advances':`/api/company/payroll/advances/${a.id}`,J(isNew?'POST':'PUT',body));close();done();}catch(err){alert(err.message);}});
  }

  async function render(container,view,label){
    injectStyle();S.el=container;
    if(view==='hr')return renderHR(container,label);
    if(view==='slips')return renderSlips(container,label);
    if(view==='advances')return renderAdvances(container,label);
    return renderStats(container,label);
  }
  window.PayrollCompanyModule={render,openMine,showPayslip};
  // 公司頁頂端加「我的薪資單」按鈕（內勤人員自己的薪資單）
  function addHeaderButton(){const wrap=document.getElementById('logoutWrap');if(!wrap||document.getElementById('myPayslipBtn'))return;const b=document.createElement('button');b.type='button';b.id='myPayslipBtn';b.className='top-link';b.style.marginRight='8px';b.textContent='📄 我的薪資單';b.addEventListener('click',()=>{injectStyle();openMine().catch(err=>alert(err.message));});wrap.insertBefore(b,wrap.firstChild);if(!document.getElementById('myPwBtn')){const k=document.createElement('button');k.type='button';k.id='myPwBtn';k.className='top-link';k.style.marginRight='8px';k.textContent='🔑 修改密碼';k.addEventListener('click',()=>window.PasswordModule?.open('/api/company/my'));wrap.insertBefore(k,b.nextSibling);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addHeaderButton);else addHeaderButton();
})();
