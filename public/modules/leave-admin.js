// 總後台：各公司請假規則客製化（審核流程、請假單位、證明補交、日薪／時薪算法、加班、全勤獎金、優於法定的假別）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={tid:null,list:null,p:null,types:null};
  function injectStyle(){
    if(document.getElementById('leaveAdminStyle'))return;
    const s=document.createElement('style');s.id='leaveAdminStyle';
    s.textContent=`
.la-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px 16px}
.la-grid label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.la-grid input,.la-grid select,.la-tbl input,.la-tbl select{margin:0;width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.la-grid .chk{flex-direction:row;align-items:center;gap:8px;font-weight:600}.la-grid .chk input{width:auto}
.la-sec{margin:18px 0 8px;font-weight:800;color:#4E312D;border-top:1px solid #E9E3E1;padding-top:12px;font-size:1rem}
.la-tbl{border-collapse:collapse;width:100%;font-size:.86rem}.la-tbl th,.la-tbl td{padding:6px 8px;border-bottom:1px solid #F2EFEE;text-align:left;vertical-align:middle}.la-tbl th{background:#F6F4F2;font-size:.78rem}
.la-tbl td small{color:#8A7E7A}.la-tbl label{white-space:nowrap}
.la-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px}
.la-note{background:#fff7e5;border:1px solid #efd99c;border-radius:10px;padding:9px 12px;margin:8px 0;color:#7a5200;font-size:.86rem}
.la-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.la-bar select{width:auto;margin:0}.la-bar button{padding:7px 14px;min-height:0;margin:0}
`;
    document.head.appendChild(s);
  }
  async function load(el){
    injectStyle();
    el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
    try{S.list=await api('/api/admin/leave-policies');if(!S.tid)S.tid=S.list.tenants[0]?.id||null;await draw(el);}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;}
  }
  async function draw(el){
    if(!S.tid){el.innerHTML='<div class="panel"><div class="empty">還沒有公司。</div></div>';return;}
    const d=await api(`/api/admin/leave-policies/${S.tid}`);S.d=d;S.p=JSON.parse(JSON.stringify(d.policy));
    try{S.positions=(await api(`/api/admin/org/${S.tid}`)).config.positions;}catch{S.positions=[];}
    paint(el,d);
  }
  function paint(el,d){
    const L=S.list.legal.types;const P=S.p;
    const typeRow=k=>{const t=L[k];const o=P.types[k]||{};return `<tr><td><b>${esc(t.name)}</b><br><small>${esc(t.hint)}</small></td>
      <td><select data-t="${k}" data-f="pay">${[1,0.75,0.5,0.25,0].filter(v=>v>=t.pay).map(v=>`<option value="${v}" ${(o.pay??t.pay)===v?'selected':''}>${v===1?'全薪':v?`${v*100}%`:'不給薪'}${v===t.pay?'（法定）':''}</option>`).join('')}</select></td>
      <td>${t.quota?`<input type="number" min="${t.quota}" step="0.5" data-t="${k}" data-f="quota" value="${o.quota??t.quota}"><small>法定 ${t.quota} 日${t.per==='month'?'／月':t.per==='event'?'／次':'／年'}</small>`:'<small>依法定</small>'}</td>
      <td>${t.proofLocked?'<small>不需證明（法定）</small>':`<select data-t="${k}" data-f="proof">${[['none','不需證明'],['optional','可附'],['required','需要證明']].map(([v,l])=>`<option value="${v}" ${(o.proof||t.proof)===v?'selected':''}>${l}</option>`).join('')}</select>`}</td>
      <td>${t.reason?'<small>必填</small>':`<label class="chk" style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" data-t="${k}" data-f="reason" style="width:auto" ${o.reason?'checked':''}> 必填</label>`}</td>
      <td>${k==='sick'?`<input type="number" min="0" max="30" data-t="sick" data-f="full_pay_days" value="${o.full_pay_days||0}" title="每年前幾天公司給全薪"><small>前幾天全薪</small>`:t.att==='company'?'<small>見全勤獎金設定</small>':t.att==='prorate'?'<small>全勤按比例</small>':'<small>不得扣全勤</small>'}</td></tr>`;};
    const customRow=(c,i)=>`<tr><td><input data-c="${i}" data-f="name" value="${esc(c.name)}" placeholder="例如：生日假"></td><td><select data-c="${i}" data-f="pay">${[1,0.5,0].map(v=>`<option value="${v}" ${Number(c.pay)===v?'selected':''}>${v===1?'全薪':v?'半薪':'不給薪'}</option>`).join('')}</select></td><td><input type="number" min="0" step="0.5" data-c="${i}" data-f="quota" value="${c.quota||0}" title="0＝不限"><select data-c="${i}" data-f="per">${[['year','每年'],['event','每次事由']].map(([v,l])=>`<option value="${v}" ${c.per===v?'selected':''}>${l}</option>`).join('')}</select></td><td><select data-c="${i}" data-f="proof">${[['none','不需證明'],['optional','可附'],['required','需要證明']].map(([v,l])=>`<option value="${v}" ${c.proof===v?'selected':''}>${l}</option>`).join('')}</select></td><td><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" data-c="${i}" data-f="reason" style="width:auto" ${c.reason?'checked':''}> 必填</label></td><td><select data-c="${i}" data-f="att">${[['none','不影響全勤'],['prorate','全勤按比例'],['all','全勤不發']].map(([v,l])=>`<option value="${v}" ${c.att===v?'selected':''}>${l}</option>`).join('')}</select> <button type="button" class="danger" data-cdel="${i}" style="padding:3px 9px;min-height:0;margin-top:4px">刪除</button></td></tr>`;
    const BY=[['site','現場主管（沒有則直屬主管）'],['dept','職務主管（所屬部門）'],['region','區域督導'],['direct','直屬主管'],['position','指定職位'],['people','指定人員（公司勾選）']];
    const flowRow=(s,i)=>`<tr><td>${i+1}</td><td><input data-s="${i}" data-f="name" value="${esc(s.name)}" placeholder="例如：現場主管"></td><td><select data-s="${i}" data-f="by" data-redraw>${BY.map(([v,l])=>`<option value="${v}" ${(s.by||'people')===v?'selected':''}>${l}</option>`).join('')}</select>${(s.by||'people')==='position'?`<select data-s="${i}" data-f="position" style="margin-top:4px"><option value="">請選擇職位</option>${(S.positions||[]).map(p=>`<option value="${esc(p.id)}" ${s.position===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`:(s.by||'people')==='people'?`<select data-s="${i}" data-f="scope" style="margin-top:4px"><option value="community" ${s.scope==='community'?'selected':''}>只限同社區</option><option value="company" ${s.scope!=='community'?'selected':''}>全公司</option></select>`:''}</td><td><input type="number" min="0" step="0.5" data-s="${i}" data-f="min_days" value="${s.min_days||0}" title="0＝每張假單都要"><small>天以上才需要</small></td><td style="white-space:nowrap"><button type="button" class="secondary" data-sup="${i}" style="padding:3px 9px;min-height:0" ${i?'':'disabled'}>↑</button> <button type="button" class="secondary" data-sdn="${i}" style="padding:3px 9px;min-height:0" ${i<P.flow.length-1?'':'disabled'}>↓</button> <button type="button" class="danger" data-sdel="${i}" style="padding:3px 9px;min-height:0">刪除</button></td></tr>`;
    el.innerHTML=`<div class="panel"><div class="eyebrow">📝 平台設定</div><h1>請假規則（各公司客製化）</h1>
      <p class="hint">依勞基法、勞工請假規則、性別平等工作法的最低標準內建，每家公司可以設定更好的福利、審核流程與薪資算法。給薪比例與天數不能低於法定，存檔時會自動補足。審核人依組織架構自動對應；選「指定人員」的關卡由公司管理員在「請假管理 → 審核設定」勾選。</p>
      <div class="la-bar"><b>公司</b><select id="laT">${S.list.tenants.map(t=>`<option value="${t.id}" ${t.id===S.tid?'selected':''}>${esc(t.name)}（${esc(t.code)}）${t.customized?' ✎':''}</option>`).join('')}</select>${d.customized?`<small class="muted">已客製化，最後更新 ${esc((d.updated_at||'').slice(0,16).replace('T',' '))}</small>`:'<small class="muted">目前使用平台預設</small>'}</div>
      <div id="laNotes"></div>
      <div class="la-sec">審核流程</div>
      <div class="la-wrap"><table class="la-tbl"><thead><tr><th>#</th><th>關卡名稱</th><th>審核對象</th><th>條件</th><th></th></tr></thead><tbody>${P.flow.map(flowRow).join('')}</tbody></table></div>
      <div class="la-bar"><button type="button" class="secondary" id="laFlowAdd">＋ 新增關卡</button><small class="muted">審核人依「組織架構」自動找：保全 → 社區經理 → 勤務經理；秘書 → 社區經理 → 秘書部。沒有現場主管時改由直屬主管審核；同一個人連續兩關只審一次。</small></div>
      <div class="la-sec">請假單位與證明</div>
      <div class="la-grid">
        <label>最小請假單位<select data-k="unit"><option value="day" ${P.unit==='day'?'selected':''}>1 天</option><option value="half" ${P.unit==='half'?'selected':''}>半天</option><option value="hour" ${P.unit==='hour'?'selected':''}>1 小時</option></select><small class="muted" style="font-weight:400">家庭照顧假依法一律可以小時請假</small></label>
        <label>每日工時（小時）<input type="number" min="1" max="12" step="0.5" data-k="hours_per_day" value="${P.hours_per_day}"></label>
        <label>證明補交期限（天）<input type="number" min="1" max="60" data-k="proof_days" value="${P.proof_days}"><small class="muted" style="font-weight:400">法規沒有規定期限，由公司工作規則訂定</small></label>
        <label>逾期未補交<select data-k="overdue_action"><option value="absent" ${P.overdue_action==='absent'?'selected':''}>視為曠職（不給薪、全勤不發）</option><option value="remind" ${P.overdue_action==='remind'?'selected':''}>只提醒</option></select></label>
      </div>
      <div class="la-sec">薪資計算</div>
      <div class="la-grid">
        <label>日薪算法<select data-k="daily_wage_mode"><option value="month30" ${P.daily_wage_mode==='month30'?'selected':''}>月薪 ÷ 30</option><option value="workdays" ${P.daily_wage_mode==='workdays'?'selected':''}>月薪 ÷ 當月應出勤日（扣除例假、國定假日）</option></select><small class="muted" style="font-weight:400">時薪＝日薪 ÷ 每日工時；請假扣款、加班費都用這個時薪</small></label>
        <label class="chk"><input type="checkbox" data-k="wage_includes_allowances" ${P.wage_includes_allowances?'checked':''}> 日薪含固定加給（經常性給與）</label>
        <label>加班（內勤見紅休，加班另計）<select data-k="overtime_mode" data-redraw><option value="pay" ${P.overtime_mode==='pay'?'selected':''}>時數加班費（依時薪與法定倍數）</option><option value="allowance" ${P.overtime_mode==='allowance'?'selected':''}>車馬費／支援費（固定金額）</option><option value="comp" ${P.overtime_mode==='comp'?'selected':''}>加班換補休（開放「補休」假別）</option></select></label>
        ${P.overtime_mode==='allowance'?`<label>名稱<input data-oa="name" value="${esc(P.overtime_allowance?.name||'支援費')}"></label><label>計算方式<select data-oa="unit"><option value="time" ${P.overtime_allowance?.unit!=='hour'?'selected':''}>每次</option><option value="hour" ${P.overtime_allowance?.unit==='hour'?'selected':''}>每小時</option></select></label><label>金額（元）<input type="number" min="0" data-oa="amount" value="${P.overtime_allowance?.amount||0}"></label>`:''}
        <label class="chk"><input type="checkbox" data-k="overtime_auto" ${P.overtime_auto?'checked':''}> 依班表加班紀錄自動計算（加班費：平日前 2 小時 1.34 倍、之後 1.67 倍；支援費：依上面金額）</label>
      </div>
      <div class="la-sec">全勤獎金</div>
      <div class="la-grid">
        <label class="chk"><input type="checkbox" data-a="enabled" ${P.attendance.enabled?'checked':''}> 公司有全勤獎金</label>
        <label>固定加給中的名稱<input data-a="name" value="${esc(P.attendance.name)}"><small class="muted" style="font-weight:400">會計在「薪資設定 → 固定加給」用這個名稱</small></label>
        <label>請事假時<select data-a="personal"><option value="prorate" ${P.attendance.personal==='prorate'?'selected':''}>按比例扣</option><option value="all" ${P.attendance.personal==='all'?'selected':''}>整筆不發</option></select><small class="muted" style="font-weight:400">病假依法只能按比例；生理、婚、喪、公、產、陪產、家庭照顧假不得扣</small></label>
      </div>
      <div class="la-sec">法定假別（可設定優於法定）</div>
      <div class="la-wrap"><table class="la-tbl"><thead><tr><th>假別</th><th>給薪</th><th>天數</th><th>證明</th><th>原因</th><th>其他</th></tr></thead><tbody>${S.list.legal&&Object.keys(L).map(typeRow).join('')}</tbody></table></div>
      <div class="la-sec">公司自訂假別（福利假）</div>
      <div class="la-wrap"><table class="la-tbl"><thead><tr><th>名稱</th><th>給薪</th><th>天數上限</th><th>證明</th><th>原因</th><th>全勤</th></tr></thead><tbody>${P.custom.map(customRow).join('')||'<tr><td colspan="6" class="muted">沒有自訂假別</td></tr>'}</tbody></table></div>
      <div class="la-bar"><button type="button" class="secondary" id="laCusAdd">＋ 新增自訂假別</button></div>
      <div class="la-bar" style="margin-top:16px"><button type="button" id="laSave">💾 儲存這家公司的請假規則</button>${d.customized?'<button type="button" class="secondary" id="laReset">↺ 改回平台預設</button>':''}</div></div>`;
    el.querySelector('#laT').addEventListener('change',e=>{S.tid=Number(e.target.value);draw(el).catch(x=>alert(x.message));});
    const val=i=>i.type==='checkbox'?i.checked:i.type==='number'?Number(i.value):i.value;
    el.querySelectorAll('[data-k]').forEach(i=>i.addEventListener('change',()=>{P[i.dataset.k]=val(i);if(i.hasAttribute('data-redraw'))paint(el,d);}));
    el.querySelectorAll('[data-a]').forEach(i=>i.addEventListener('change',()=>{P.attendance[i.dataset.a]=val(i);}));
    el.querySelectorAll('[data-t]').forEach(i=>i.addEventListener('change',()=>{const k=i.dataset.t;P.types[k]=P.types[k]||{};P.types[k][i.dataset.f]=i.dataset.f==='pay'?Number(i.value):val(i);}));
    el.querySelectorAll('[data-c]').forEach(i=>i.addEventListener('change',()=>{const c=P.custom[Number(i.dataset.c)];c[i.dataset.f]=i.dataset.f==='pay'?Number(i.value):val(i);}));
    el.querySelectorAll('[data-s]').forEach(i=>i.addEventListener('change',()=>{const s=P.flow[Number(i.dataset.s)];s[i.dataset.f]=val(i);if(i.dataset.f==='by'&&!s.name)s.name=i.selectedOptions[0].textContent.replace(/（.*$/,'');if(i.hasAttribute('data-redraw'))paint(el,d);}));
    el.querySelectorAll('[data-oa]').forEach(i=>i.addEventListener('change',()=>{P.overtime_allowance=P.overtime_allowance||{};P.overtime_allowance[i.dataset.oa]=val(i);}));
    const redraw=()=>paint(el,d);
    el.querySelectorAll('[data-cdel]').forEach(b=>b.addEventListener('click',()=>{P.custom.splice(Number(b.dataset.cdel),1);redraw();}));
    el.querySelectorAll('[data-sdel]').forEach(b=>b.addEventListener('click',()=>{if(P.flow.length<=1){alert('至少要有一關');return;}P.flow.splice(Number(b.dataset.sdel),1);redraw();}));
    el.querySelectorAll('[data-sup]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.sup);[P.flow[i-1],P.flow[i]]=[P.flow[i],P.flow[i-1]];redraw();}));
    el.querySelectorAll('[data-sdn]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.sdn);[P.flow[i+1],P.flow[i]]=[P.flow[i],P.flow[i+1]];redraw();}));
    el.querySelector('#laFlowAdd').addEventListener('click',()=>{if(P.flow.length>=8){alert('最多 8 關');return;}P.flow.push({id:'',name:'',by:'position',position:'',scope:'company',min_days:0});redraw();});
    el.querySelector('#laCusAdd').addEventListener('click',()=>{P.custom.push({name:'',pay:1,quota:1,per:'year',proof:'none',reason:false,att:'none',enabled:true});redraw();});
    el.querySelector('#laSave').addEventListener('click',async()=>{try{const r=await api(`/api/admin/leave-policies/${S.tid}`,J('PUT',{policy:P}));S.list=await api('/api/admin/leave-policies');await draw(el);el.querySelector('#laNotes').innerHTML=`<div class="pr-ok" style="background:#E8EEDF;border:1px solid #C9D6B5;border-radius:10px;padding:9px 12px;color:#3E5328">✓ 已儲存。</div>${(r.notes||[]).map(x=>`<div class="la-note">${esc(x)}</div>`).join('')}`;}catch(e){alert(e.message);}});
    el.querySelector('#laReset')?.addEventListener('click',async()=>{if(!confirm('改回平台預設的請假規則？'))return;try{await api(`/api/admin/leave-policies/${S.tid}`,{method:'DELETE'});S.list=await api('/api/admin/leave-policies');await draw(el);}catch(e){alert(e.message);}});
  }
  window.LeaveAdminModule={load};
})();
