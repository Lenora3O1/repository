// 總後台：各公司組織架構（部門、職位名稱、職位類型、班別、排班、預設權限）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={tid:null,d:null,c:null};
  function injectStyle(){
    if(document.getElementById('orgAdminStyle'))return;
    const s=document.createElement('style');s.id='orgAdminStyle';
    s.textContent=`
.oa-tbl{border-collapse:collapse;width:100%;font-size:.86rem}.oa-tbl th,.oa-tbl td{padding:6px 7px;border-bottom:1px solid #F2EFEE;text-align:left;vertical-align:middle}.oa-tbl th{background:#F6F4F2;font-size:.78rem;white-space:nowrap}
.oa-tbl input,.oa-tbl select{margin:0;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.oa-tbl td.btns{white-space:nowrap}.oa-tbl td.btns button{padding:3px 9px;min-height:0;margin:0 2px 0 0}
.oa-wrap{overflow:auto;border:1px solid #E9E3E1;border-radius:12px}
.oa-sec{margin:18px 0 8px;font-weight:800;color:#4E312D;border-top:1px solid #E9E3E1;padding-top:12px}
.oa-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.oa-bar select{width:auto;margin:0}.oa-bar button{padding:7px 14px;min-height:0;margin:0}
.oa-depts{display:flex;flex-wrap:wrap;gap:8px}.oa-depts span{display:inline-flex;gap:4px;align-items:center;border:1px solid #E6E0DD;border-radius:999px;padding:3px 6px 3px 10px;background:#fff}.oa-depts input{border:0;width:110px;margin:0;padding:2px;font:inherit}.oa-depts button{border:0;background:none;color:#a8322a;padding:0 4px;min-height:0;cursor:pointer}
.oa-kinds{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 16px;font-size:.82rem;color:#5D504C;background:#FAF9F7;border-radius:10px;padding:10px 12px}
.oa-perm{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:3px 10px}.oa-perm label{display:flex;gap:6px;align-items:center;font-size:.85rem;margin:0}.oa-perm input{width:auto;margin:0}
.oa-msg{border-radius:10px;padding:9px 12px;margin:8px 0}.oa-msg.ok{background:#E8EEDF;border:1px solid #C9D6B5;color:#3E5328}.oa-msg.err{background:#fdf0ef;border:1px solid #f1c4bf;color:#9b2c22}
`;
    document.head.appendChild(s);
  }
  function modal(title,body){const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-width:640px;width:min(640px,96vw);max-height:90vh;overflow:auto"><button type="button" class="modal-close">×</button><h2>${title}</h2>${body}</div>`;document.body.appendChild(box);const close=()=>box.remove();box.querySelector('.modal-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});return {box,close};}
  async function load(el){
    injectStyle();el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
    try{if(!S.tid){const t=await api('/api/admin/leave-policies');S.tid=t.tenants[0]?.id||null;}if(!S.tid){el.innerHTML='<div class="panel"><div class="empty">還沒有公司。</div></div>';return;}await fetchDraw(el);}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;}
  }
  async function fetchDraw(el,msg=''){S.d=await api(`/api/admin/org/${S.tid}`);S.c=JSON.parse(JSON.stringify(S.d.config));paint(el,msg);}
  function paint(el,msg=''){
    const d=S.d,c=S.c,K=d.kinds;
    const deptOpts=v=>`<option value="">（不屬於部門）</option>${c.departments.map(x=>`<option value="${esc(x.id)}" ${x.id===v?'selected':''}>${esc(x.name)}</option>`).join('')}`;
    const row=(p,i)=>{const k=K[p.kind];const siteKind=['site_manager','site_deputy','site_staff'].includes(p.kind);const used=d.usage[p.id]||0;
      return `<tr><td><input data-p="${i}" data-f="name" value="${esc(p.name)}" placeholder="例如：總幹事"></td>
      <td><select data-p="${i}" data-f="kind">${d.kind_order.map(x=>`<option value="${x}" ${x===p.kind?'selected':''}>${esc(K[x].label)}</option>`).join('')}</select></td>
      <td><select data-p="${i}" data-f="dept">${deptOpts(p.dept)}</select></td>
      <td>${k.shift?`<select data-p="${i}" data-f="shift"><option value="">${p.kind==='dept_manager'?'不分（管全部）':'開通時選'}</option><option value="day" ${p.shift==='day'?'selected':''}>日班</option><option value="night" ${p.shift==='night'?'selected':''}>夜班</option></select>`:'<small class="muted">—</small>'}</td>
      <td>${siteKind?`<select data-p="${i}" data-f="schedule"><option value="admin" ${p.schedule==='admin'?'selected':''}>行政班</option><option value="security" ${p.schedule==='security'?'selected':''}>保全班</option></select>`:`<small class="muted">${esc(d.schedules[p.kind==='mobile'?'mobile':k.schedule==='office'?'office':p.schedule]||'')}</small>`}</td>
      <td><button type="button" class="secondary" data-perm="${i}" style="padding:4px 10px;min-height:0;margin:0">${p.perms.length} 項</button></td>
      <td>${used?`<b>${used}</b> 人`:'<small class="muted">0</small>'}</td>
      <td class="btns"><button type="button" class="secondary" data-up="${i}" ${i?'':'disabled'}>↑</button><button type="button" class="secondary" data-dn="${i}" ${i<c.positions.length-1?'':'disabled'}>↓</button><button type="button" class="danger" data-del="${i}" ${used?'disabled title="還有人員使用"':''}>刪除</button></td></tr>`;};
    el.innerHTML=`<div class="panel"><div class="eyebrow">🏢 平台設定</div><h1>組織架構（各公司客製化）</h1>
      <p class="hint">每家公司的職稱說法不同（例如「社區經理」也叫「總幹事」，「日班保全」也叫「日班警勤」「日班管家」），名稱可以自由修改。系統依「職位類型」判斷上下級、工作地點與排班，所以改名不影響功能。公司開通人員時只要選職位。</p>
      <div class="oa-bar"><b>公司</b><select id="oaT">${d.tenants.map(t=>`<option value="${t.id}" ${t.id===S.tid?'selected':''}>${esc(t.name)}（${esc(t.code)}）</option>`).join('')}</select>${d.customized?`<small class="muted">已客製化，最後更新 ${esc((d.updated_at||'').slice(0,16).replace('T',' '))}</small>`:'<small class="muted">目前使用平台預設</small>'}</div>
      ${msg}
      <div class="oa-sec">部門</div>
      <div class="oa-depts">${c.departments.map((x,i)=>`<span><input data-d="${i}" value="${esc(x.name)}"><button type="button" data-ddel="${i}" title="刪除">×</button></span>`).join('')}<button type="button" class="secondary" id="oaDAdd" style="padding:4px 12px;min-height:0;margin:0">＋ 部門</button></div>
      <div class="oa-sec">職位</div>
      <div class="oa-wrap"><table class="oa-tbl"><thead><tr><th>職位名稱</th><th>職位類型</th><th>部門</th><th>班別</th><th>排班</th><th>預設權限</th><th>人數</th><th></th></tr></thead><tbody>${c.positions.map(row).join('')}</tbody></table></div>
      <div class="oa-bar"><button type="button" class="secondary" id="oaPAdd">＋ 新增職位</button><small class="muted">例如：吧檯秘書（現場人員・秘書部）、總幹事（社區主管・物業部）</small></div>
      <details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700">職位類型說明（系統依類型判斷上下級）</summary><div class="oa-kinds" style="margin-top:8px">${d.kind_order.map(k=>`<div><b>${esc(K[k].label)}</b>：${esc(K[k].scope)}</div>`).join('')}</div>
      <p class="hint">上下級：現場人員 → 同社區同部門的副主管 → 社區主管 → 該區督導；同時也歸所屬部門的部門經理（有分日／夜班就對應同班別）→ 部門主管 → 總經理 → 老闆。</p></details>
      <div class="oa-bar" style="margin-top:16px"><button type="button" id="oaSave">💾 儲存這家公司的組織架構</button>${d.customized?'<button type="button" class="secondary" id="oaReset">↺ 改回平台預設</button>':''}</div></div>`;
    el.querySelector('#oaT').onchange=e=>{S.tid=Number(e.target.value);fetchDraw(el).catch(x=>alert(x.message));};
    el.querySelectorAll('[data-d]').forEach(i=>i.oninput=()=>{c.departments[Number(i.dataset.d)].name=i.value;});
    el.querySelectorAll('[data-ddel]').forEach(b=>b.onclick=()=>{const x=c.departments[Number(b.dataset.ddel)];const n=c.positions.filter(p=>p.dept===x.id).length;if(n&&!confirm(`「${x.name}」底下有 ${n} 個職位，刪除後這些職位會變成不屬於部門。確定？`))return;c.departments.splice(Number(b.dataset.ddel),1);c.positions.forEach(p=>{if(p.dept===x.id)p.dept='';});paint(el);});
    el.querySelector('#oaDAdd').onclick=()=>{c.departments.push({id:'d_'+Math.random().toString(36).slice(2,8),name:'新部門'});paint(el);};
    el.querySelectorAll('[data-p]').forEach(i=>i.onchange=()=>{const p=c.positions[Number(i.dataset.p)];p[i.dataset.f]=i.value;if(i.dataset.f==='kind'){if(!K[p.kind].shift)p.shift='';paint(el);}});
    el.querySelectorAll('input[data-p]').forEach(i=>i.oninput=()=>{c.positions[Number(i.dataset.p)].name=i.value;});
    el.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.up);[c.positions[i-1],c.positions[i]]=[c.positions[i],c.positions[i-1]];paint(el);});
    el.querySelectorAll('[data-dn]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.dn);[c.positions[i+1],c.positions[i]]=[c.positions[i],c.positions[i+1]];paint(el);});
    el.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{c.positions.splice(Number(b.dataset.del),1);paint(el);});
    el.querySelector('#oaPAdd').onclick=()=>{c.positions.push({id:'p_'+Math.random().toString(36).slice(2,8),name:'',kind:'site_staff',dept:c.departments[0]?.id||'',shift:'',schedule:'admin',perms:[]});paint(el);el.querySelector(`input[data-p="${c.positions.length-1}"]`)?.focus();};
    el.querySelectorAll('[data-perm]').forEach(b=>b.onclick=()=>{const p=c.positions[Number(b.dataset.perm)];const set=new Set(p.perms);const L=d.permission_labels;const work=K[p.kind].work;
      const group=(title,keys)=>`<div style="font-weight:800;margin:10px 0 6px">${title}</div><div class="oa-perm">${keys.filter(k=>!['hr-records','payroll'].includes(k)).map(k=>`<label><input type="checkbox" value="${esc(k)}" ${set.has(k)?'checked':''}> ${esc(L[k]||k)}</label>`).join('')}</div>`;
      const {box,close}=modal(`「${esc(p.name||'新職位')}」預設工作台權限`,`<p class="hint">開通這個職位的人員時自動勾選；公司仍可個別調整。人事資料、薪資權限只能由公司管理員個別授予，不放在職位預設。</p>${work!=='site'?group('🏢 內勤工作項目',d.company_keys):''}${work!=='internal'?group('🏠 駐點工作項目',d.site_keys):''}<div class="modal-actions"><button type="button" id="pmOk">確定</button></div>`);
      box.querySelector('#pmOk').onclick=()=>{p.perms=[...box.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);close();paint(el);};});
    el.querySelector('#oaSave').onclick=async()=>{if(c.positions.some(p=>!p.name.trim())){alert('有職位沒有填名稱');return;}try{await api(`/api/admin/org/${S.tid}`,J('PUT',{config:c}));await fetchDraw(el,'<div class="oa-msg ok">✓ 已儲存。已在這些職位的人員會同步顯示新的職位名稱。</div>');}catch(e){paint(el,`<div class="oa-msg err">${esc(e.message)}</div>`);}};
    el.querySelector('#oaReset')?.addEventListener('click',async()=>{if(!confirm('改回平台預設的部門與職位？'))return;try{await api(`/api/admin/org/${S.tid}`,{method:'DELETE'});await fetchDraw(el);}catch(e){alert(e.message);}});
  }
  window.OrgAdminModule={load};
})();
