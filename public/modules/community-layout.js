// 社區資訊與「社區棟別門牌設定」精靈
// - 社區資訊：社區名稱、代表地址（公司內勤設定）、各棟門牌／位置／樓層／戶數。
// - 設定精靈：經理或秘書第一次使用住戶名冊時填寫，系統依設定產生全社區戶別清單（例如 2A1 = A 棟 2 樓之 1）。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,o={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(m,b)=>({method:m,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  function css(){if(document.getElementById('clCss'))return;const s=document.createElement('style');s.id='clCss';s.textContent=`
.cl-wrap{display:grid;gap:14px}.cl-com{display:grid;gap:10px;border:1px solid #E6DCD8;border-radius:14px;padding:12px 14px;background:#FBF8F5}.cl-com-h{display:flex;align-items:center;gap:8px}.cl-com-h b{flex:1}.cl-com-h button{margin:0;padding:5px 12px;min-height:0}.cl-kv .hint{display:block;margin-top:3px;font-size:.8rem}.cl-lay{border:1px solid #E9E3E1;border-radius:14px;padding:10px 14px;background:#fff}.cl-lay summary{cursor:pointer;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.cl-lay[open] summary{margin-bottom:10px}.cl-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-form .w{grid-column:1/-1}.cl-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0}.cl-form input:not([type=checkbox]){margin:0;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;font:inherit;background:#fff;width:100%;box-sizing:border-box;height:auto}.cl-form label.ck{flex-direction:row;align-items:center;font-weight:600}.cl-form label.ck input{width:auto;margin:0}.cl-form fieldset{border:1px solid #E6DCD8;border-radius:10px;padding:8px 12px;display:grid;gap:6px}@media(max-width:560px){.cl-form{grid-template-columns:1fr}}.cl-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.cl-kv>div{border:1px solid #E9E3E1;border-radius:12px;padding:12px 14px;background:#fff}.cl-kv small{display:block;color:#7A5F58;font-weight:700;font-size:.78rem;margin-bottom:4px}.cl-kv b{font-size:1.05rem}
.cl-t{width:100%;border-collapse:collapse;font-size:.9rem}.cl-t th{background:#F6F4F2;text-align:left;padding:8px 10px;font-size:.82rem;white-space:nowrap}.cl-t td{padding:8px 10px;border-top:1px solid #F2EFEE;vertical-align:top}
.cl-zone{display:inline-block;padding:2px 10px;border-radius:999px;background:#F3E7E1;color:#7E331D;font-size:.78rem;font-weight:700}
.cl-empty{border:1.5px dashed #D9C7C0;border-radius:14px;padding:22px;text-align:center;background:#FBF8F6}
.cl-ed input,.cl-ed select,.cl-ed textarea{margin:0;padding:7px 9px;border:1px solid #D8CECB;border-radius:8px;font:inherit;background:#fff;min-height:0;box-sizing:border-box}
.cl-ed .cl-row{display:grid;grid-template-columns:70px 100px 96px 110px minmax(150px,1fr) 150px minmax(140px,1fr) 34px;gap:8px;align-items:start;padding:10px 0;border-top:1px solid #F2EFEE}
.cl-ed .cl-row.h{font-size:.78rem;font-weight:700;color:#7A5F58;border-top:0;padding:0 0 4px}
.cl-ed .cl-row input,.cl-ed .cl-row select,.cl-ed .cl-row textarea{width:100%}
.cl-ed .cl-fl{display:flex;gap:4px;align-items:center}.cl-ed .cl-fl input{width:56px}
.cl-ed .cl-del{padding:6px 0;min-height:0;margin:0;width:34px}
.cl-ed .cl-top{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}.cl-ed label.f{display:grid;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.cl-pv{margin-top:12px;padding:10px 14px;border-radius:12px;background:#F6F4F2;font-size:.88rem;line-height:1.8}.cl-pv.bad{background:#F8E5DF;color:#A44528}
@media(max-width:900px){.cl-ed .cl-row{grid-template-columns:1fr 1fr}.cl-ed .cl-row.h{display:none}.cl-ed .cl-top{grid-template-columns:1fr}}
`;document.head.appendChild(s);}
  const unitsText=b=>b.type==='list'?String(b.list||'').split('\n').filter(Boolean).length+' 戶（逐戶指定）':`${b.units}`;
  const floorsText=b=>b.type==='list'?'—':`${b.floor_from}～${b.floor_to} 樓`;
  const num=(v,u)=>v===null||v===undefined||v===''?'—':`${Number(v).toLocaleString('en-US')} ${u}`;
  async function renderInfo(el,label){
    css();const d=await api('/api/staff/residents/layout');const L=d.layout,c=d.community||{},P=d.profile||{};
    const kv=(k,v,h='')=>`<div><small>${k}</small><b>${v}</b>${h?`<span class="hint">${h}</span>`:''}</div>`;
    const yn=v=>v?'可以':'不可以';
    el.innerHTML=`<div class="panel"><div class="eyebrow">🏢 社區資訊</div><h1>${esc(c.name||label||'社區資訊')}</h1>
      <div class="cl-wrap"><div class="cl-com"><div class="cl-com-h"><b>📋 社區基本資料</b>${d.can_edit?'<button type="button" class="secondary" id="clBasic">✏️ 編輯</button>':''}</div>
        <div class="cl-kv">${kv('地址',esc(P.main_address||'（尚未設定）'))}${kv('電話',esc(P.phone||'—'))}${kv('傳真',esc(P.fax||'—'))}${kv('電子信箱',esc(P.email||'—'))}
        ${kv('總戶數',num(P.units_total,'戶'),P.layout_units?`棟別門牌設定共 ${P.layout_units} 戶`:'')}${kv('樓層',`地上 ${P.floors_up??'—'} 層／地下 ${P.floors_down??'—'} 層`)}${kv('汽車位',num(P.car_spaces,'個'))}${kv('機車位',num(P.moto_spaces,'個'))}
        ${kv('管理委員資格',`承租人：${yn(P.tenant_eligible)}｜出租戶（屋主）：${yn(P.landlord_eligible)}`,'依社區規約設定；「本屆委員」選人時會依此判斷')}</div>
        ${P.updated_at?`<div class="hint">最後更新：${esc(tw(P.updated_at))} ${esc(P.updated_by)}</div>`:''}</div>
      <details class="cl-lay" ${L.configured?'':'open'}><summary><b>🏗 棟別門牌設定</b><span class="hint">（住戶名冊用來對應門牌地址${L.configured?`；共 ${d.total} 戶`:'；尚未設定'}）</span></summary>
      ${L.configured?`<div style="overflow:auto;border:1px solid #E9E3E1;border-radius:12px"><table class="cl-t"><thead><tr><th>棟別</th><th>位置</th><th>門牌</th><th>樓層</th><th>每層戶號</th><th>戶數</th></tr></thead><tbody>${L.buildings.map(b=>`<tr><td><b>${esc(b.name)}</b> <small style="color:#7A5F58">（${esc(b.code)}）</small></td><td>${b.zone?`<span class="cl-zone">${esc(b.zone)}</span>`:''}</td><td>${esc(b.type==='list'?(b.door?`${b.door}（逐戶）`:'逐戶指定'):b.door)}</td><td>${floorsText(b)}</td><td>${esc(unitsText(b))}</td><td>${d.counts[b.code]||0}</td></tr>`).join('')}</tbody></table></div>
        <div class="hint">戶別代號格式：${esc(d.formats[L.code_format]||'')}。例如：${d.sample.slice(0,2).map(x=>`${esc(x.code)} = ${esc(x.address)}`).join('；')}</div>`
      :`<p class="hint" style="margin:6px 0">設定每一棟的門牌、樓層和每層戶號後，住戶名冊上傳時會自動對到門牌地址。</p>`}
      ${d.can_edit?`<div style="margin-top:8px"><button type="button" class="secondary" id="clEdit">${L.configured?'✏️ 修改棟別門牌設定':'🏗 開始設定棟別門牌'}</button></div>`:''}</details>
      <p class="hint" style="margin:0">社區基本資料、棟別門牌由經理或秘書設定；管理委員會資料請到「管理委員會 → 本屆委員」。</p></div></div>`;
    el.querySelector('#clEdit')?.addEventListener('click',()=>openEditor({onSaved:()=>renderInfo(el,label)}));
    el.querySelector('#clBasic')?.addEventListener('click',()=>editBasic(P,()=>renderInfo(el,label)));
  }
  const tw=v=>{const t=new Date(v);return isNaN(t)?String(v||''):new Date(t.getTime()+8*3600e3).toISOString().slice(0,16).replace('T',' ');};
  function editBasic(P,onSaved){
    const bg=document.createElement('div');bg.className='modal-backdrop';const v=x=>x===null||x===undefined?'':esc(x);
    bg.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-width:620px;max-height:92vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button><h2>📋 社區基本資料</h2>
      <form id="cpF" class="cl-form"><label class="w">地址<input name="main_address" maxlength="120" value="${v(P.main_address)}" placeholder="含郵遞區號"></label>
      <label>電話<input name="phone" maxlength="40" inputmode="tel" value="${v(P.phone)}"></label><label>傳真<input name="fax" maxlength="40" inputmode="tel" value="${v(P.fax)}"></label>
      <label class="w">電子信箱<input name="email" type="email" maxlength="120" value="${v(P.email)}"></label>
      <label>總戶數<input name="units_total" type="number" min="0" value="${v(P.units_total)}" placeholder="${P.layout_units?`棟別門牌設定共 ${P.layout_units} 戶`:''}"></label><span></span>
      <label>地上幾層<input name="floors_up" type="number" min="0" value="${v(P.floors_up)}"></label><label>地下幾層<input name="floors_down" type="number" min="0" value="${v(P.floors_down)}"></label>
      <label>汽車位共幾個<input name="car_spaces" type="number" min="0" value="${v(P.car_spaces)}"></label><label>機車位共幾個<input name="moto_spaces" type="number" min="0" value="${v(P.moto_spaces)}"></label>
      <fieldset class="w"><legend>管理委員資格（依社區規約）</legend><label class="ck"><input type="checkbox" name="landlord_eligible" ${P.landlord_eligible?'checked':''}> 房子出租中的所有權人（屋主）可以擔任委員</label><label class="ck"><input type="checkbox" name="tenant_eligible" ${P.tenant_eligible?'checked':''}> 承租人（租戶）可以擔任委員</label></fieldset>
      <div class="modal-actions w"><button type="button" class="secondary" data-x>取消</button><button type="submit">💾 儲存</button></div></form></div>`;
    document.body.appendChild(bg);document.body.classList.add('modal-open');
    const close=()=>{bg.remove();document.body.classList.remove('modal-open');};bg.querySelector('.modal-close').onclick=close;bg.querySelector('[data-x]').onclick=close;
    bg.querySelector('#cpF').onsubmit=async e=>{e.preventDefault();const f=e.target;const v=Object.fromEntries(new FormData(f).entries());v.tenant_eligible=f.tenant_eligible.checked;v.landlord_eligible=f.landlord_eligible.checked;try{const r=await fetch('/api/staff/residents/profile',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||'儲存失敗');close();onSaved&&onSaved();}catch(err){alert(err.message);}};
  }
  function guess(c){const a=String(c?.main_address||'');const m=a.match(/^(.*?)([^\d市縣區鄉鎮里村鄰號]+?[路街道](?:[一二三四五六七八九十]+段)?(?:\d+巷)?(?:\d+弄)?\d+(?:-\d+)?號)/);return m?{prefix:m[1],door:m[2]}:{prefix:'',door:''};}
  async function openEditor({onSaved}={}){
    css();const d=await api('/api/staff/residents/layout');const g=guess(d.community);
    const L=d.layout.configured?JSON.parse(JSON.stringify(d.layout)):{prefix:g.prefix,code_format:'FBN',buildings:[{code:'A',name:'A棟',zone:'',type:'tower',door:g.door,floor_from:1,floor_to:12,units:'1-4'}]};
    const bg=document.createElement('div');bg.className='modal-backdrop';
    bg.innerHTML=`<div class="modal cl-ed" role="dialog" aria-modal="true" style="max-width:1100px;width:min(1100px,96vw);max-height:92vh;overflow:auto"><button type="button" class="modal-close" aria-label="關閉">×</button>
      <h2>🏗 社區棟別門牌設定</h2><p class="hint" style="margin-top:-4px">${esc(d.community?.name||'')}。每一棟填一行；店面這類每戶門牌不同的，類型選「逐戶指定」，一行一戶：<code>店1 117號</code>。</p>
      <div class="cl-top"><label class="f">共同地址前段（每一戶都一樣的部分）<input id="clPre" value="${esc(L.prefix)}" placeholder="例如：範例市幸福區和平里1鄰"></label>
      <label class="f">戶別代號格式<select id="clFmt">${Object.entries(d.formats).map(([k,v])=>`<option value="${k}" ${L.code_format===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label></div>
      <div class="cl-row h"><span>代號</span><span>名稱</span><span>位置</span><span>類型</span><span>門牌</span><span>樓層</span><span>每層戶號／逐戶清單</span><span></span></div>
      <div id="clRows"></div><button type="button" class="secondary" id="clAdd" style="margin-top:8px">＋ 新增一棟</button>
      <datalist id="clZones"><option value="前棟"><option value="後棟"><option value="中棟"><option value="店面"></datalist>
      <div class="cl-pv" id="clPv">計算中…</div>
      <div class="modal-actions" style="margin-top:14px"><button type="button" class="secondary" data-x>取消</button><button type="button" id="clSave">💾 儲存並產生戶別清單</button></div></div>`;
    document.body.appendChild(bg);document.body.classList.add('modal-open');
    const close=()=>{bg.remove();document.body.classList.remove('modal-open');};bg.querySelector('.modal-close').onclick=close;bg.querySelector('[data-x]').onclick=close;
    const rowsEl=bg.querySelector('#clRows');
    const read=()=>({prefix:bg.querySelector('#clPre').value,code_format:bg.querySelector('#clFmt').value,buildings:[...rowsEl.querySelectorAll('.cl-row')].map(r=>{const v=k=>r.querySelector(`[data-k="${k}"]`)?.value??'';return {code:v('code'),name:v('name'),zone:v('zone'),type:v('type'),door:v('door'),floor_from:v('floor_from'),floor_to:v('floor_to'),units:v('units'),list:v('list')};})});
    function draw(){rowsEl.innerHTML=L.buildings.map((b,i)=>`<div class="cl-row" data-i="${i}"><input data-k="code" value="${esc(b.code)}" placeholder="A"><input data-k="name" value="${esc(b.name)}" placeholder="A棟"><input data-k="zone" value="${esc(b.zone)}" list="clZones" placeholder="前棟"><select data-k="type"><option value="tower" ${b.type!=='list'?'selected':''}>住宅棟</option><option value="list" ${b.type==='list'?'selected':''}>逐戶指定</option></select>
      <input data-k="door" value="${esc(b.door)}" placeholder="${b.type==='list'?'路名，例如：和平路':'例如：和平路100號'}">
      ${b.type==='list'?'<span class="hint" style="padding-top:8px">—</span>':`<div class="cl-fl"><input data-k="floor_from" type="number" value="${esc(b.floor_from??1)}">～<input data-k="floor_to" type="number" value="${esc(b.floor_to??1)}"></div>`}
      ${b.type==='list'?`<textarea data-k="list" rows="4" placeholder="店1 117號&#10;店2 115號">${esc(b.list||'')}</textarea>`:`<input data-k="units" value="${esc(b.units||'')}" placeholder="例如：1-3,5-7（跳過 4）">`}
      <button type="button" class="secondary cl-del" data-del="${i}" title="刪除這一棟">✕</button></div>`).join('');
      rowsEl.querySelectorAll('[data-k="type"]').forEach(s=>s.onchange=()=>{L.buildings=read().buildings;draw();preview();});
      rowsEl.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{L.buildings=read().buildings;L.buildings.splice(Number(b.dataset.del),1);draw();preview();});
    }
    let tm=null;async function preview(){const pv=bg.querySelector('#clPv');try{const r=await api('/api/staff/residents/layout/preview',J('POST',{layout:read()}));pv.className='cl-pv'+(r.duplicates.length?' bad':'');pv.innerHTML=`共 <b>${r.total}</b> 戶。${r.sample.slice(0,3).map(x=>`<br><b>${esc(x.code)}</b>　${esc(x.address)}`).join('')}${r.total>3?`<br>…<br>${r.sample.slice(-1).map(x=>`<b>${esc(x.code)}</b>　${esc(x.address)}`).join('')}`:''}${r.duplicates.length?`<br>⚠ 戶別代號重複：${r.duplicates.map(esc).join('、')}，請調整代號格式或棟別代號。`:''}`;}catch(e){pv.className='cl-pv bad';pv.textContent=e.message;}}
    bg.addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(preview,350);});bg.querySelector('#clFmt').addEventListener('change',preview);
    bg.querySelector('#clAdd').onclick=()=>{L.buildings=read().buildings;const last=L.buildings[L.buildings.length-1]||{};const next=String.fromCharCode(((last.code||'@').charCodeAt(0)||64)+1);L.buildings.push({code:next,name:`${next}棟`,zone:last.zone||'',type:'tower',door:'',floor_from:last.floor_from||1,floor_to:last.floor_to||12,units:last.units||'1-4'});draw();preview();};
    bg.querySelector('#clSave').onclick=async()=>{const btn=bg.querySelector('#clSave');btn.disabled=true;try{const r=await api('/api/staff/residents/layout',J('PUT',{layout:read()}));close();alert(`✅ 已儲存，共產生 ${r.units} 戶的戶別清單。`);onSaved?.();}catch(e){alert(e.message);btn.disabled=false;}};
    draw();preview();
  }
  window.CommunityLayout={renderInfo,openEditor};
})();
