// 總後台：方案與計費（公司方案、加值模組開通／試用、價格級距與方案範本）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>Number(n||0).toLocaleString('zh-TW');
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const inp='margin:0;padding:6px 8px;border:1px solid #D8CECB;border-radius:8px;font:inherit;min-height:0';
  const btn='padding:6px 12px;min-height:0;margin:0';
  const PHASE={none:['未設定方案','#6B625F','#F1EEEC'],active:['使用中','#3E5328','#EAF1E3'],grace:['寬限期','#8A5A12','#FBF0DC'],expired:['已到期（唯讀）','#A44528','#F8E5DF']};
  const badge=(t,c,b)=>`<span style="display:inline-block;white-space:nowrap;padding:2px 9px;border-radius:999px;font-size:.78rem;font-weight:700;color:${c};background:${b}">${esc(t)}</span>`;
  let S={view:'tenants',open:{}};
  function css(){if(document.getElementById('plansAdminCss'))return;const s=document.createElement('style');s.id='plansAdminCss';s.textContent=`
    .pa-card{border:1px solid #E9E3E1;border-radius:14px;margin-top:12px;background:#fff}
    .pa-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;cursor:pointer}
    .pa-head b{font-size:1.02rem}.pa-head .sp{flex:1}
    .pa-body{border-top:1px solid #F2EFEE;padding:12px 14px;display:grid;gap:14px}
    .pa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
    .pa-grid label{display:grid;gap:4px;margin:0;font-size:.82rem;font-weight:700;color:#6B625F}
    .pa-t{width:100%;border-collapse:collapse;font-size:.86rem}.pa-t th{background:#F6F4F2;text-align:left;padding:7px 8px;font-weight:700}.pa-t td{padding:7px 8px;border-top:1px solid #F2EFEE;vertical-align:middle}
    .pa-bar{height:8px;border-radius:99px;background:#EFEAE8;overflow:hidden;min-width:120px}.pa-bar i{display:block;height:100%;background:#5E7A3E}.pa-bar i.w{background:#C48A2C}.pa-bar i.x{background:#A44528}
    .pa-sub{display:flex;gap:8px;margin:10px 0 2px}.pa-warn{color:#A44528;font-size:.84rem;font-weight:700}
    .pa-sec{border:1px solid #E9E3E1;border-radius:12px;padding:12px 14px;margin-top:12px}.pa-sec h3{margin:0 0 8px;font-size:1rem}
  `;document.head.appendChild(s);}
  async function load(el){
    css();el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
    let d;try{d=await api('/api/admin/plans');}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;return;}
    el.innerHTML=`<div class="panel"><div class="eyebrow">💳 平台設定</div><h1>方案與計費</h1>
      <p class="hint">每家公司選一種計價依據（員工規模或社區案場規模）與級距；超過上限時，公司無法再新增人員帳號或社區（既有資料不受影響）。到期後有 ${d.pricing.grace_days} 天寬限期，寬限期過後加值功能關閉、基本功能改為唯讀。系統只計算費用，實際帳單與收款請在系統外處理。尚未設定方案的公司不受限制（開發／試用階段）。</p>
      <div class="pa-sub"><button type="button" data-v="tenants" class="${S.view==='tenants'?'':'secondary'}" style="${btn}">🏢 公司方案</button><button type="button" data-v="pricing" class="${S.view==='pricing'?'':'secondary'}" style="${btn}">🏷 價格與方案範本</button></div>
      <div id="paBody"></div></div>`;
    el.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{S.view=b.dataset.v;load(el);});
    const body=el.querySelector('#paBody');
    if(S.view==='pricing')return pricingView(body,d,el);
    tenantsView(body,d,el);
  }
  function tierOpts(d,basis,sel){return (d.pricing.tiers[basis]||[]).map((t,i)=>`<option value="${esc(t.id)}" ${t.id===sel?'selected':''}>${i+1}. ${esc(t.name)}（上限 ${t.max}，$${money(t.price)}／月）</option>`).join('');}
  function tenantsView(box,d,el){
    const keys=Object.keys(d.catalog).sort((a,b)=>d.catalog[a].order-d.catalog[b].order);
    box.innerHTML=d.tenants.map(t=>{const p=t.plan;const ph=PHASE[p.phase]||PHASE.none;const open=!!S.open[t.id];
      const bar=p.configured&&p.limit?`<div style="display:flex;gap:8px;align-items:center"><div class="pa-bar"><i class="${p.used>=p.limit?'x':p.ratio>=d.pricing.warn_ratio?'w':''}" style="width:${Math.min(100,p.ratio)}%"></i></div><small><b>${p.used}</b>／${p.limit} ${esc(p.unit)}</small></div>`:'';
      return `<div class="pa-card" data-t="${t.id}"><div class="pa-head" data-toggle><b>${esc(t.name)}</b><small class="muted">${esc(t.code)}${t.status!=='active'?'（公司已停用）':''}</small>${badge(ph[0],ph[1],ph[2])}
        <small class="muted">${p.configured?`${esc(p.basis_name)}・${esc(p.tier.name)}${p.template_name?`・${esc(p.template_name)}`:''}${p.expires_at?`・到期 ${esc(p.expires_at)}`:''}`:''}</small>${bar}<span class="sp"></span>${p.configured?`<b>$${money(t.fee.total)}／月</b>`:''}<span>${open?'▲':'▼'}</span></div>
        ${open?`<div class="pa-body">
          ${t.warnings.length?`<div>${t.warnings.map(w=>`<div class="${w.tone==='alert'?'pa-warn':'muted'}">⚠ ${esc(w.text)}</div>`).join('')}</div>`:''}
          <div><div style="font-weight:700;margin-bottom:6px">方案</div><div class="pa-grid">
            <label>計價依據<select data-f="basis" style="${inp}"><option value="">未設定（不限制）</option>${Object.entries(d.basis).map(([k,v])=>`<option value="${k}" ${p.basis===k?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label>
            <label>級距<select data-f="tier_id" style="${inp}">${p.configured?tierOpts(d,p.basis,p.tier.id):''}</select></label>
            <label>方案範本<select data-f="template_id" style="${inp}"><option value="">（不使用範本）</option>${d.pricing.templates.map(x=>`<option value="${esc(x.id)}" ${p.template_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
            <label>開始日<input type="date" data-f="started_at" value="${esc(p.started_at||'')}" style="${inp}"></label>
            <label>到期日（空白＝不限）<input type="date" data-f="expires_at" value="${esc(p.expires_at||'')}" style="${inp}"></label>
            <label>每月調整金額（折扣填負數）<input type="number" data-f="discount" value="${esc(p.discount||0)}" style="${inp}"></label>
            <label style="grid-column:1/-1">備註（例如年約、付款方式）<input data-f="note" value="${esc(p.note||'')}" style="${inp}"></label>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px"><label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:700"><input type="checkbox" data-f="apply_template" style="width:auto;margin:0"> 依範本重新設定加值模組</label><button type="button" data-save-plan style="${btn}">儲存方案</button>
          <small class="muted">目前用量：員工 ${t.plan.usage.staff} 人（不含公司管理員帳號）・社區 ${t.plan.usage.community} 個（啟用中）</small></div></div>
          <div><div style="font-weight:700;margin-bottom:6px">加值模組</div><div style="overflow:auto;border:1px solid #E9E3E1;border-radius:12px"><table class="pa-t"><thead><tr><th>模組</th><th>開通</th><th>到期日</th><th>備註</th><th>狀態</th><th></th></tr></thead><tbody>
          ${keys.map(k=>{const a=t.addons[k];const st=a.enabled?(a.trial&&!(a.switched_on&&!a.expired&&a.tier_ok)?badge(`試用至 ${a.trial_until}`,'#2F5E8A','#E3EDF7'):badge('使用中','#3E5328','#EAF1E3')):a.reason==='expired'?badge('已到期','#A44528','#F8E5DF'):a.reason==='tier'?badge('方案級距不足','#8A5A12','#FBF0DC'):a.reason==='plan_expired'?badge('方案到期','#A44528','#F8E5DF'):a.reason==='trial_ended'?badge('試用已結束','#6B625F','#F1EEEC'):badge('未開通','#6B625F','#F1EEEC');
            const trial=k==='smart_schedule'?(a.trial?`<button type="button" class="secondary" data-trial="stop" style="${btn}">結束試用</button>`:`<button type="button" class="secondary" data-trial="start" style="${btn}">免費試用 ${d.pricing.modules[k].trial_days} 天</button>`):'';
            return `<tr data-k="${k}"><td><b>${esc(d.catalog[k].name)}</b><br><small class="muted">${esc(d.catalog[k].desc)}</small></td>
            <td><input type="checkbox" data-m="enabled" ${a.switched_on?'checked':''} style="width:auto;margin:0"></td>
            <td><input type="date" data-m="expires_at" value="${esc(a.expires_at)}" style="${inp}"></td><td><input data-m="note" value="${esc(a.note)}" style="${inp};width:100%;min-width:120px"></td>
            <td>${st}</td><td style="white-space:nowrap"><button type="button" data-save-mod style="${btn}">儲存</button> ${trial}</td></tr>`;}).join('')}
          </tbody></table></div></div>
          ${p.configured?`<div><div style="font-weight:700;margin-bottom:6px">每月費用試算</div><table class="pa-t" style="max-width:560px">${t.fee.lines.map(x=>`<tr><td>${esc(x.name)}</td><td style="text-align:right">$${money(x.amount)}</td></tr>`).join('')}<tr><td><b>合計</b></td><td style="text-align:right"><b>$${money(t.fee.total)}</b></td></tr></table></div>`:''}
          <div><button type="button" class="secondary" data-logs style="${btn}">異動紀錄</button><div data-logbox></div></div>
        </div>`:''}</div>`;}).join('');
    box.querySelectorAll('[data-toggle]').forEach(h=>h.onclick=()=>{const id=h.closest('[data-t]').dataset.t;S.open[id]=!S.open[id];load(el);});
    box.querySelectorAll('[data-t]').forEach(card=>{
      const tid=card.dataset.t;const g=f=>card.querySelector(`[data-f="${f}"]`);
      g('basis')?.addEventListener('change',()=>{g('tier_id').innerHTML=g('basis').value?tierOpts(d,g('basis').value,''):'';});
      card.querySelector('[data-save-plan]')?.addEventListener('click',async()=>{
        if(!g('basis').value&&!confirm('取消方案設定後，這家公司不受任何限制，加值模組恢復預設。確定嗎？'))return;
        try{const r=await api(`/api/admin/plans/${tid}`,J('PUT',{basis:g('basis').value,tier_id:g('tier_id').value,template_id:g('template_id').value,apply_template:g('apply_template').checked,started_at:g('started_at').value,expires_at:g('expires_at').value,discount:g('discount').value,note:g('note').value}));if(r.over_limit)alert(r.over_limit);load(el);}catch(e){alert(e.message);}
      });
      card.querySelectorAll('[data-save-mod]').forEach(b=>b.onclick=async()=>{const tr=b.closest('tr');const m=f=>tr.querySelector(`[data-m="${f}"]`);
        try{await api(`/api/admin/plans/${tid}/modules/${tr.dataset.k}`,J('PUT',{enabled:m('enabled').checked,expires_at:m('expires_at').value,note:m('note').value}));load(el);}catch(e){alert(e.message);}});
      card.querySelectorAll('[data-trial]').forEach(b=>b.onclick=async()=>{const tr=b.closest('tr');try{await api(`/api/admin/plans/${tid}/modules/${tr.dataset.k}/trial`,J('POST',{stop:b.dataset.trial==='stop'}));load(el);}catch(e){alert(e.message);}});
      card.querySelector('[data-logs]')?.addEventListener('click',async()=>{const lb=card.querySelector('[data-logbox]');try{const r=await api(`/api/admin/plans/${tid}/logs`);lb.innerHTML=r.logs.length?`<table class="pa-t" style="margin-top:6px">${r.logs.map(x=>`<tr><td style="white-space:nowrap">${esc(String(x.created_at).slice(0,16).replace('T',' '))}</td><td>${esc(x.note)}</td></tr>`).join('')}</table>`:'<div class="muted" style="margin-top:6px">沒有紀錄</div>';}catch(e){lb.textContent=e.message;}});
    });
  }
  function pricingView(box,d,el){
    const P=JSON.parse(JSON.stringify(d.pricing));const keys=Object.keys(d.catalog).sort((a,b)=>d.catalog[a].order-d.catalog[b].order);
    function draw(){
      box.innerHTML=`<div class="pa-sec"><h3>到期與提醒</h3><div class="pa-grid">
          <label>到期後寬限期（天）<input type="number" min="0" max="60" data-g="grace_days" value="${P.grace_days}" style="${inp}"></label>
          <label>用量提醒門檻（%）<input type="number" min="50" max="100" data-g="warn_ratio" value="${P.warn_ratio}" style="${inp}"></label>
          <label>到期前幾天開始提醒<input type="number" min="1" max="120" data-g="warn_days" value="${P.warn_days}" style="${inp}"></label></div></div>
        ${Object.entries(d.basis).map(([b,v])=>`<div class="pa-sec"><h3>${esc(v.name)}級距</h3><table class="pa-t"><thead><tr><th>#</th><th>名稱</th><th>上限（${esc(v.unit)}）</th><th>基本月費</th><th></th></tr></thead><tbody>
          ${P.tiers[b].map((t,i)=>`<tr data-b="${b}" data-i="${i}"><td>${i+1}</td><td><input data-x="name" value="${esc(t.name)}" style="${inp};width:100%"></td><td><input type="number" min="1" data-x="max" value="${t.max}" style="${inp};width:110px"></td><td><input type="number" min="0" data-x="price" value="${t.price}" style="${inp};width:120px"></td><td><button type="button" class="secondary" data-del-tier style="${btn}">刪除</button></td></tr>`).join('')}
          </tbody></table><button type="button" class="secondary" data-add-tier="${b}" style="${btn};margin-top:8px">＋ 新增級距</button><div class="muted" style="font-size:.8rem;margin-top:4px">級距依上限由小到大排序；已使用中的級距請不要刪除（改名或改價即可）。</div></div>`).join('')}
        <div class="pa-sec"><h3>加值模組價格</h3><table class="pa-t"><thead><tr><th>模組</th><th>固定月費</th><th>另加基本月費的 %</th><th>其他</th></tr></thead><tbody>
          ${keys.map(k=>`<tr data-k="${k}"><td><b>${esc(d.catalog[k].name)}</b></td><td><input type="number" min="0" data-y="price" value="${P.modules[k].price}" style="${inp};width:110px"></td><td><input type="number" min="0" max="100" data-y="percent" value="${P.modules[k].percent}" style="${inp};width:80px"></td>
          <td>${k==='smart_schedule'?`<label style="display:inline-flex;gap:6px;align-items:center;margin:0">限第 <input type="number" min="1" max="12" data-y="min_tier" value="${P.modules[k].min_tier}" style="${inp};width:60px"> 級以上加購</label>　<label style="display:inline-flex;gap:6px;align-items:center;margin:0">免費試用 <input type="number" min="0" max="180" data-y="trial_days" value="${P.modules[k].trial_days}" style="${inp};width:70px"> 天</label>`:''}</td></tr>`).join('')}
          </tbody></table><div class="muted" style="font-size:.8rem;margin-top:4px">基本方案包含：${esc(d.base_features.join('、'))}。</div></div>
        <div class="pa-sec"><h3>方案範本</h3><table class="pa-t"><thead><tr><th>名稱</th>${keys.map(k=>`<th>${esc(d.catalog[k].name)}</th>`).join('')}<th></th></tr></thead><tbody>
          ${P.templates.map((t,i)=>`<tr data-ti="${i}"><td><input data-z="name" value="${esc(t.name)}" style="${inp};width:110px"></td>${keys.map(k=>`<td><input type="checkbox" data-zm="${k}" ${t.modules.includes(k)?'checked':''} style="width:auto;margin:0"></td>`).join('')}<td><button type="button" class="secondary" data-del-tpl style="${btn}">刪除</button></td></tr>`).join('')}
          </tbody></table><button type="button" class="secondary" data-add-tpl style="${btn};margin-top:8px">＋ 新增範本</button></div>
        <div style="margin-top:14px"><button type="button" data-save-pricing style="${btn}">儲存價格設定</button></div>`;
      const sync=()=>{box.querySelectorAll('[data-g]').forEach(x=>P[x.dataset.g]=Number(x.value));
        box.querySelectorAll('tr[data-b]').forEach(tr=>{const t=P.tiers[tr.dataset.b][tr.dataset.i];tr.querySelectorAll('[data-x]').forEach(x=>t[x.dataset.x]=x.dataset.x==='name'?x.value:Number(x.value));});
        box.querySelectorAll('tr[data-k]').forEach(tr=>tr.querySelectorAll('[data-y]').forEach(x=>P.modules[tr.dataset.k][x.dataset.y]=Number(x.value)));
        box.querySelectorAll('tr[data-ti]').forEach(tr=>{const t=P.templates[tr.dataset.ti];t.name=tr.querySelector('[data-z="name"]').value;t.modules=[...tr.querySelectorAll('[data-zm]')].filter(x=>x.checked).map(x=>x.dataset.zm);});};
      box.querySelectorAll('[data-add-tier]').forEach(b=>b.onclick=()=>{sync();const L=P.tiers[b.dataset.addTier];const last=L[L.length-1];L.push({id:`${b.dataset.addTier[0]}${Date.now().toString(36)}`,name:'新級距',max:(last?.max||0)*2||10,price:last?.price||0});draw();});
      box.querySelectorAll('[data-del-tier]').forEach(b=>b.onclick=()=>{sync();const tr=b.closest('tr');P.tiers[tr.dataset.b].splice(Number(tr.dataset.i),1);draw();});
      box.querySelector('[data-add-tpl]').onclick=()=>{sync();P.templates.push({id:`t${Date.now().toString(36)}`,name:'新方案',modules:[]});draw();};
      box.querySelectorAll('[data-del-tpl]').forEach(b=>b.onclick=()=>{sync();P.templates.splice(Number(b.closest('tr').dataset.ti),1);draw();});
      box.querySelector('[data-save-pricing]').onclick=async()=>{sync();try{await api('/api/admin/plans/pricing',J('PUT',{pricing:P}));alert('已儲存');load(el);}catch(e){alert(e.message);}};
    }
    draw();
  }
  window.PlansAdminModule={load};
})();
