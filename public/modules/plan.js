// 公司內部：方案與費用（只給公司高層；開通會計模組時會計也看得到）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>Number(n||0).toLocaleString('zh-TW');
  async function api(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'讀取失敗');return d;}
  function css(){if(document.getElementById('planCss'))return;const s=document.createElement('style');s.id='planCss';s.textContent=`
    .pl-wrap{display:grid;gap:14px}.pl-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
    .pl-box{border:1px solid #E9E3E1;border-radius:14px;padding:14px 16px;background:#fff}.pl-box h3{margin:0 0 10px;font-size:1rem}
    .pl-k{font-size:.8rem;color:#6B625F;font-weight:700}.pl-v{font-size:1.35rem;font-weight:800;margin-top:2px}
    .pl-bar{height:10px;border-radius:99px;background:#EFEAE8;overflow:hidden;margin-top:8px}.pl-bar i{display:block;height:100%;background:#5E7A3E}.pl-bar i.w{background:#C48A2C}.pl-bar i.x{background:#A44528}
    .pl-warn{border-radius:12px;padding:10px 14px;background:#FBF0DC;color:#6E4810;font-weight:700}.pl-warn.alert{background:#F8E5DF;color:#A44528}
    .pl-t{width:100%;border-collapse:collapse;font-size:.9rem}.pl-t td,.pl-t th{padding:8px;border-top:1px solid #F2EFEE;text-align:left;vertical-align:top}.pl-t th{background:#F6F4F2;border-top:0}
    .pl-b{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.78rem;font-weight:700}
    .pl-feat{display:flex;flex-wrap:wrap;gap:6px}.pl-feat span{background:#F3F0EE;border-radius:999px;padding:3px 10px;font-size:.82rem}
  `;document.head.appendChild(s);}
  const PH={active:['使用中','#3E5328','#EAF1E3'],grace:['寬限期','#8A5A12','#FBF0DC'],expired:['已到期（唯讀）','#A44528','#F8E5DF']};
  const b=(t,c,bg)=>`<span class="pl-b" style="color:${c};background:${bg}">${esc(t)}</span>`;
  async function render(el,label){
    css();el.innerHTML='<div class="profile-loading">讀取中…</div>';
    let d;try{d=await api('/api/company/plan');}catch(e){el.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;return;}
    const s=d.state;const head=`<div class="eyebrow">💳 公司方案</div><h1>${esc(label||'方案與費用')}</h1>`;
    if(!s.configured){el.innerHTML=`${head}<div class="pl-box"><b>尚未設定方案</b><p class="muted" style="margin:6px 0 0">目前為開發／試用階段，功能不受人數與社區數限制。正式使用前，系統服務商會替貴公司設定方案。</p><p class="muted" style="margin:6px 0 0">目前用量：員工 ${s.usage.staff} 人・社區 ${s.usage.community} 個</p></div>`;return;}
    const ph=PH[s.phase]||PH.active;const cls=s.used>=s.limit?'x':s.ratio>=90?'w':'';
    el.innerHTML=`${head}<div class="pl-wrap">
      ${d.warnings.map(w=>`<div class="pl-warn ${w.tone==='alert'?'alert':''}">⚠ ${esc(w.text)}</div>`).join('')}
      <div class="pl-top">
        <div class="pl-box"><div class="pl-k">目前方案</div><div class="pl-v">${esc(s.tier.name)}</div><div class="muted" style="margin-top:4px">${esc(s.basis_name)}${s.template_name?`・${esc(s.template_name)}方案`:''}</div></div>
        <div class="pl-box"><div class="pl-k">${esc(s.basis_name)}用量</div><div class="pl-v">${s.used}<span style="font-size:1rem;color:#6B625F">／${s.limit} ${esc(s.unit)}</span></div><div class="pl-bar"><i class="${cls}" style="width:${Math.min(100,s.ratio)}%"></i></div><div class="muted" style="font-size:.8rem;margin-top:6px">${s.basis==='staff'?'在職且啟用中的人員帳號（不含公司管理員帳號）；停用或離職的帳號不計入。':'啟用中的社區；停用（結束服務）的社區不計入。'}</div></div>
        <div class="pl-box"><div class="pl-k">使用期限</div><div class="pl-v" style="font-size:1.1rem">${s.expires_at?esc(s.expires_at):'不限'}</div><div style="margin-top:6px">${b(ph[0],ph[1],ph[2])}${s.phase==='active'&&s.days_left!==null?` <small class="muted">剩 ${s.days_left} 天</small>`:''}</div><div class="muted" style="font-size:.8rem;margin-top:6px">到期後有 ${d.grace_days} 天寬限期；寬限期過後加值功能關閉、基本功能改為唯讀。</div></div>
        <div class="pl-box"><div class="pl-k">每月費用</div><div class="pl-v">$${money(d.fee.total)}</div><div class="muted" style="font-size:.8rem;margin-top:6px">系統試算金額，實際以系統服務商開立的帳單為準。</div></div>
      </div>
      <div class="pl-box"><h3>費用明細</h3><table class="pl-t">${d.fee.lines.map(x=>`<tr><td>${esc(x.name)}</td><td style="text-align:right;white-space:nowrap">$${money(x.amount)}</td></tr>`).join('')}<tr><td><b>每月合計</b></td><td style="text-align:right"><b>$${money(d.fee.total)}</b></td></tr></table></div>
      <div class="pl-box"><h3>功能</h3><div class="pl-k" style="margin-bottom:6px">基本功能（方案內含）</div><div class="pl-feat">${d.base_features.map(x=>`<span>✓ ${esc(x)}</span>`).join('')}</div>
        <div class="pl-k" style="margin:14px 0 6px">加值功能</div><table class="pl-t"><thead><tr><th>功能</th><th>狀態</th><th style="text-align:right">月費</th></tr></thead><tbody>
        ${d.modules.map(m=>{const st=m.enabled?(m.trial&&!(m.switched_on&&!m.expired&&m.tier_ok)?b(`免費試用至 ${m.trial_until}`,'#2F5E8A','#E3EDF7'):b(`已開通${m.expires_at?`（至 ${m.expires_at}）`:''}`,'#3E5328','#EAF1E3')):m.reason==='expired'?b('已到期','#A44528','#F8E5DF'):m.reason==='plan_expired'?b('方案到期，暫停使用','#A44528','#F8E5DF'):m.reason==='tier'?b(`需「${m.min_tier_name}」以上方案`,'#8A5A12','#FBF0DC'):b('未開通','#6B625F','#F1EEEC');
          return `<tr><td><b>${esc(m.name)}</b><br><small class="muted">${esc(m.desc)}</small></td><td>${st}</td><td style="text-align:right;white-space:nowrap">${m.price===null?'—':`$${money(m.price)}`}</td></tr>`;}).join('')}
        </tbody></table><div class="muted" style="font-size:.82rem;margin-top:8px">如需開通加值功能、升級方案或續約，請聯絡系統服務商。</div></div>
    </div>`;
  }
  window.PlanModule={render};
})();
