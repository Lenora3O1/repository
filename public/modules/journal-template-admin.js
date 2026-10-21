// 總後台：工作日誌「平台預設範本」設計（中央表單設計中心 → 進入工作日誌設計）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const TYPES=[['text','單行文字'],['textarea','多行文字'],['number','數字'],['yesno','是／否'],['select','單選'],['checklist','勾選清單（可複選）']];
  const SCOPES=[['daily','每日日誌'],['weekly','每週日誌'],['both','每日＋每週']];
  const S={el:null,t:null,builtins:null,usage:null,dirty:false};

  function injectStyle(){
    if(document.getElementById('jtaStyle'))return;
    const s=document.createElement('style');s.id='jtaStyle';
    s.textContent=`
.jta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.jta-list{display:flex;flex-direction:column;gap:8px}
.jta-row{display:flex;align-items:center;gap:8px;border:1px solid var(--line,#ddd);border-radius:10px;padding:8px 10px;background:#fff}
.jta-row.off{background:#f6f6f4;opacity:.75}
.jta-row input[type=text],.jta-row input:not([type]),.jta-row select{margin:0;flex:1;min-width:0}
.jta-row .jta-switch{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-weight:700;font-size:.85rem}
.jta-row .jta-switch input{width:auto;margin:0}
.jta-row small{color:#7A6E6A}
.jta-parts{display:flex;flex-wrap:wrap;gap:12px;margin:2px 0 0 38px;font-size:.84rem}
.jta-parts label{display:inline-flex;align-items:center;gap:5px;margin:0;font-weight:600}
.jta-parts input{width:auto;margin:0}
.jta-sec-block{display:flex;flex-direction:column;gap:2px}
.jta-x{border:0;background:transparent;color:#ACA3A0;font-size:1.1rem;padding:4px 8px;min-height:0;cursor:pointer;border-radius:6px}
.jta-x:hover{background:#fdecea;color:#c0392b}
.jta-add{border:1px dashed #CFBEB9;background:#fff;color:var(--accent-dark,#422A26);padding:7px 12px;border-radius:9px;font-weight:700;min-height:0;cursor:pointer;font-size:.86rem;margin-top:8px}
.jta-mode{display:flex;gap:18px;flex-wrap:wrap}
.jta-mode label{display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:700}
.jta-mode input{width:auto;margin:0}
.jta-custom{border:1px solid var(--line,#ddd);border-radius:12px;padding:12px;background:#fff;display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px 10px;align-items:end}
.jta-custom label{display:block;font-size:.76rem;font-weight:700;color:#70635F;margin:0 0 3px}
.jta-custom input,.jta-custom select,.jta-custom textarea{margin:0;width:100%;box-sizing:border-box}
.jta-custom .wide{grid-column:1/-1}
.jta-usage{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.jta-usage span{background:#F9F7F4;border:1px solid #E4DCDA;border-radius:999px;padding:3px 12px;font-size:.82rem}
.jta-preview{position:fixed;inset:0;z-index:10040;background:rgba(30,21,20,.55);display:flex;align-items:center;justify-content:center;padding:20px}
.jta-preview-box{background:#fff;border-radius:16px;width:min(980px,100%);height:min(92vh,1200px);display:flex;flex-direction:column;overflow:hidden}
.jta-preview-bar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #E9E3E1}
.jta-preview-bar strong{flex:1}.jta-preview-bar button{padding:8px 14px;min-height:0}
.jta-preview iframe{flex:1;border:0;width:100%}
@media(max-width:900px){.jta-grid{grid-template-columns:1fr}.jta-custom{grid-template-columns:1fr 1fr}}
`;
    document.head.appendChild(s);
  }
  const mark=()=>{S.dirty=true;const m=S.el?.querySelector('#jtaMsg');if(m)m.innerHTML='<span class="muted">有尚未儲存的修改</span>';};
  const move=(arr,i,d)=>{const j=i+d;if(j<0||j>=arr.length)return false;[arr[i],arr[j]]=[arr[j],arr[i]];return true;};

  function sectionList(kind){
    const list=S.t[`${kind}_sections`];const meta=Object.fromEntries((S.builtins[`${kind}_sections`]||[]).map(x=>[x.key,x]));
    return `<div class="jta-list">${list.map((s,i)=>{const m=meta[s.key]||{};return `<div class="jta-sec-block"><div class="jta-row ${s.on===false?'off':''}"><label class="jta-switch"><input type="checkbox" data-sec="${kind}" data-i="${i}" data-f="on" ${s.on!==false?'checked':''}> 記錄</label><input data-sec="${kind}" data-i="${i}" data-f="label" value="${esc(s.label)}" aria-label="區塊名稱" placeholder="${esc(m.label||'')}"><button type="button" class="icon-btn" data-mv="${kind}" data-i="${i}" data-d="-1" ${i===0?'disabled':''} title="往上">↑</button><button type="button" class="icon-btn" data-mv="${kind}" data-i="${i}" data-d="1" ${i===list.length-1?'disabled':''} title="往下">↓</button></div>${m.hint?`<small style="margin-left:38px;color:#7A6E6A">${esc(m.hint)}</small>`:''}${m.parts?`<div class="jta-parts">${Object.entries(m.parts).map(([pk,pl])=>`<label><input type="checkbox" data-sec="${kind}" data-i="${i}" data-part="${pk}" ${s.parts?.[pk]!==false?'checked':''} ${s.on===false?'disabled':''}> ${esc(pl)}</label>`).join('')}</div>`:''}</div>`;}).join('')}</div>`;
  }
  function simpleList(id,items,ph){return `<div class="jta-list" id="${id}">${items.map((v,i)=>`<div class="jta-row"><input value="${esc(v)}" data-list="${id}" data-i="${i}" placeholder="${esc(ph)}"><button type="button" class="icon-btn" data-lmv="${id}" data-i="${i}" data-d="-1" ${i===0?'disabled':''}>↑</button><button type="button" class="icon-btn" data-lmv="${id}" data-i="${i}" data-d="1" ${i===items.length-1?'disabled':''}>↓</button><button type="button" class="jta-x" data-lrm="${id}" data-i="${i}" aria-label="刪除">×</button></div>`).join('')}</div><button type="button" class="jta-add" data-ladd="${id}">＋ 新增</button>`;}
  const LISTS={jtaMeters:{get:()=>S.t.meters,label:x=>x.label,set:(x,v)=>{x.label=v;},make:()=>({key:'',label:''})},jtaRoles:{get:()=>S.t.roles,label:x=>x,set:null,make:()=>''},jtaCats:{get:()=>S.t.tracking_categories,label:x=>x.label,set:(x,v)=>{x.label=v;},make:()=>({key:'',label:''})}};
  function customList(){
    return `<div class="jta-list">${S.t.custom_items.map((c,i)=>`<div class="jta-custom"><div><label>項目名稱</label><input data-ci="${i}" data-f="label" value="${esc(c.label)}" placeholder="例如：垃圾清運是否正常"></div><div><label>填寫方式</label><select data-ci="${i}" data-f="type">${TYPES.map(([v,l])=>`<option value="${v}" ${c.type===v?'selected':''}>${l}</option>`).join('')}</select></div><div><label>用在</label><select data-ci="${i}" data-f="scope">${SCOPES.map(([v,l])=>`<option value="${v}" ${c.scope===v?'selected':''}>${l}</option>`).join('')}</select></div><div style="display:flex;gap:4px"><button type="button" class="icon-btn" data-cmv="${i}" data-d="-1" ${i===0?'disabled':''}>↑</button><button type="button" class="icon-btn" data-cmv="${i}" data-d="1" ${i===S.t.custom_items.length-1?'disabled':''}>↓</button><button type="button" class="jta-x" data-crm="${i}" aria-label="刪除">×</button></div>${['select','checklist'].includes(c.type)?`<div class="wide"><label>選項（一行一個）</label><textarea rows="2" data-ci="${i}" data-f="options">${esc((c.options||[]).join('\n'))}</textarea></div>`:''}<div class="wide"><label>填寫提示（選填）</label><input data-ci="${i}" data-f="hint" value="${esc(c.hint||'')}" placeholder="顯示在項目名稱下方"></div></div>`).join('')||'<div class="empty" style="padding:12px">還沒有自訂項目。例如「垃圾清運是否正常」「本週消防檢查（滅火器、緊急照明…）」。</div>'}</div><button type="button" class="jta-add" id="jtaCustomAdd">＋ 新增自訂紀錄項目</button>`;
  }
  function draw(){
    const t=S.t,u=S.usage||{};
    S.el.innerHTML=`<div class="panel"><div class="section-title">⚙️ 工作日誌設計｜平台預設範本</div>
      <p class="hint">這份範本是所有社區的預設：各社區沒有自行調整的部分都會自動沿用。社區經理仍可在工作日誌的「⚙ 設定」調整自己社區的日誌類型、抄表項目與記事職務，也可以一鍵恢復平台預設。<br>已送出的日誌會保留送出當時的格式，不會因為這裡修改而改變。</p>
      ${u.communities!=null?`<div class="jta-usage"><span>啟用中社區 ${u.communities} 個</span><span>自訂日誌類型 ${u.custom_mode||0} 個</span><span>自訂抄表項目 ${u.custom_meters||0} 個</span><span>自訂記事職務 ${u.custom_roles||0} 個</span></div>`:''}
    </div>
    <div class="panel"><div class="section-title">① 預設日誌類型</div><div class="jta-mode"><label><input type="radio" name="jtaMode" value="daily" ${t.mode!=='weekly'?'checked':''}> 每日工作日誌</label><label><input type="radio" name="jtaMode" value="weekly" ${t.mode==='weekly'?'checked':''}> 每週工作日誌</label></div><p class="hint" style="margin-bottom:0">新社區或還沒選過類型的社區會用這個；已由公司或經理選過的社區維持原本選擇。</p></div>
    <div class="jta-grid">
      <div class="panel"><div class="section-title">② 每日日誌要記錄的區塊</div><p class="hint">取消勾選就不會出現在現場填寫畫面與列印版；可以改名稱、調整順序。</p>${sectionList('daily')}</div>
      <div class="panel"><div class="section-title">③ 每週日誌要記錄的區塊</div><p class="hint">標示「自動彙整」的區塊會由每日日誌、班表、抄表自動統計。</p>${sectionList('weekly')}</div>
    </div>
    <div class="jta-grid">
      <div class="panel"><div class="section-title">④ 抄表項目（社區巡檢）</div><p class="hint">現場只要填當日度數，系統自動算使用量。</p>${simpleList('jtaMeters',t.meters.map(m=>m.label),'例如：自來水表')}</div>
      <div class="panel"><div class="section-title">⑤ 「案場重要記事」職務欄</div><p class="hint">每個職務各自填寫，彼此不會覆蓋。</p>${simpleList('jtaRoles',t.roles,'例如：總幹事')}
        <div class="section-title" style="margin-top:18px">⑥ 待辦追蹤分類</div><p class="hint">刪除分類後，舊事項仍會顯示；新事項無法再選這個分類。</p>${simpleList('jtaCats',t.tracking_categories.map(c=>c.label),'例如：管理委員會')}</div>
    </div>
    <div class="panel"><div class="section-title">⑦ 自訂紀錄項目</div><p class="hint">想多記錄的事情可以加在這裡，會出現在「其他紀錄項目」區塊（記得在 ②／③ 保持開啟）。</p>${customList()}</div>
    <div class="save-bar"><button type="button" id="jtaSave">💾 儲存工作日誌平台範本</button><button type="button" class="secondary" id="jtaPreviewD">👁 預覽每日列印</button><button type="button" class="secondary" id="jtaPreviewW">👁 預覽每週列印</button><button type="button" class="secondary" id="jtaReset">↺ 還原系統原始範本</button><span id="jtaMsg"></span></div>`;
    bind();
  }
  function bind(){
    const el=S.el;
    el.querySelectorAll('input[name=jtaMode]').forEach(r=>r.addEventListener('change',()=>{S.t.mode=r.value;mark();}));
    el.querySelectorAll('[data-sec]').forEach(inp=>inp.addEventListener(inp.type==='checkbox'?'change':'input',()=>{const s=S.t[`${inp.dataset.sec}_sections`][Number(inp.dataset.i)];
      if(inp.dataset.part){s.parts=s.parts||{};s.parts[inp.dataset.part]=inp.checked;}
      else if(inp.dataset.f==='on'){s.on=inp.checked;draw();}
      else s.label=inp.value;mark();}));
    el.querySelectorAll('[data-mv]').forEach(b=>b.addEventListener('click',()=>{if(move(S.t[`${b.dataset.mv}_sections`],Number(b.dataset.i),Number(b.dataset.d))){mark();draw();}}));
    el.querySelectorAll('[data-list]').forEach(inp=>inp.addEventListener('input',()=>{const L=LISTS[inp.dataset.list],arr=L.get(),i=Number(inp.dataset.i);if(L.set)L.set(arr[i],inp.value);else arr[i]=inp.value;mark();}));
    el.querySelectorAll('[data-lmv]').forEach(b=>b.addEventListener('click',()=>{if(move(LISTS[b.dataset.lmv].get(),Number(b.dataset.i),Number(b.dataset.d))){mark();draw();}}));
    el.querySelectorAll('[data-lrm]').forEach(b=>b.addEventListener('click',()=>{const arr=LISTS[b.dataset.lrm].get();arr.splice(Number(b.dataset.i),1);mark();draw();}));
    el.querySelectorAll('[data-ladd]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.ladd;LISTS[id].get().push(LISTS[id].make());mark();draw();el.querySelector(`#${id} .jta-row:last-child input`)?.focus();}));
    el.querySelectorAll('[data-ci]').forEach(inp=>inp.addEventListener(inp.tagName==='SELECT'?'change':'input',()=>{const c=S.t.custom_items[Number(inp.dataset.ci)];const f=inp.dataset.f;
      if(f==='options')c.options=inp.value.split('\n').map(x=>x.trim()).filter(Boolean);else c[f]=inp.value;
      if(f==='type'){if(['select','checklist'].includes(c.type)&&!(c.options||[]).length)c.options=['已完成','未完成'];draw();}mark();}));
    el.querySelectorAll('[data-cmv]').forEach(b=>b.addEventListener('click',()=>{if(move(S.t.custom_items,Number(b.dataset.cmv),Number(b.dataset.d))){mark();draw();}}));
    el.querySelectorAll('[data-crm]').forEach(b=>b.addEventListener('click',()=>{const c=S.t.custom_items[Number(b.dataset.crm)];if(c.label&&!confirm(`刪除「${c.label}」？已送出日誌裡的內容不受影響。`))return;S.t.custom_items.splice(Number(b.dataset.crm),1);mark();draw();}));
    el.querySelector('#jtaCustomAdd').addEventListener('click',()=>{S.t.custom_items.push({id:'',label:'',type:'text',scope:'daily'});mark();draw();el.querySelector('.jta-custom:last-child input')?.focus();});
    el.querySelector('#jtaSave').addEventListener('click',save);
    el.querySelector('#jtaReset').addEventListener('click',async()=>{if(!confirm('把工作日誌平台範本還原成系統原始設定嗎？（各社區自己調整過的設定不受影響）'))return;try{const r=await api('/api/admin/journal-template/reset',{method:'POST'});S.t=r.template;S.usage=r.usage;S.dirty=false;draw();msg('✓ 已還原系統原始範本','success');}catch(e){msg(e.message,'error');}});
    el.querySelector('#jtaPreviewD').addEventListener('click',()=>preview('daily'));
    el.querySelector('#jtaPreviewW').addEventListener('click',()=>preview('weekly'));
  }
  function msg(text,type){const m=S.el.querySelector('#jtaMsg');if(m){m.innerHTML=`<span class="msg ${type} inline-msg">${esc(text)}</span>`;if(type==='success')setTimeout(()=>{if(m.textContent.includes(text))m.innerHTML='';},5000);}}
  function payloadForSave(){
    const t=JSON.parse(JSON.stringify(S.t));
    t.meters=t.meters.filter(m=>String(m.label||'').trim());t.roles=t.roles.filter(x=>String(x||'').trim());
    t.tracking_categories=t.tracking_categories.filter(c=>String(c.label||'').trim());t.custom_items=t.custom_items.filter(c=>String(c.label||'').trim());
    return t;
  }
  async function save(){
    try{const r=await api('/api/admin/journal-template',J('PUT',payloadForSave()));S.t=r.template;S.usage=r.usage||S.usage;S.dirty=false;draw();msg('✓ 已儲存！各社區重新開啟工作日誌就會套用。','success');}
    catch(e){msg(e.message,'error');}
  }
  // 用示意資料預覽列印版面（不會寫入任何資料）
  function sample(kind){
    const t=payloadForSave();const today=new Date().toISOString().slice(0,10);
    const settings={...t,overview:{total:'250',owner:'180',tenant:'52',vacant:'18',reno_applied:'3',reno_working:'2',reno_pending:'1',car:'210',moto:'260'}};
    const cats=t.tracking_categories;const tracking=cats.slice(0,2).map((c,i)=>({id:i+1,category:c.key,category_label:c.label,opened_on:today,content:i?'B1 車道燈具不亮':'住戶反映 12F 走道漏水',updates:[{update_date:today,content:'已聯絡廠商，預計明日查修'}]}));
    const custom={};for(const c of t.custom_items)custom[c.id||c.label]=c.type==='yesno'?'是':c.type==='checklist'?(c.options||[]).slice(0,1):c.type==='number'?'3':'（示意內容）';
    t.custom_items.forEach(c=>{if(!c.id)c.id=c.label;});
    const meters=t.meters.map((m,i)=>({key:m.key,label:m.label,history:[0,1,2].map(d=>({date:new Date(Date.now()-(2-d)*864e5).toISOString().slice(0,10),value:1000+i*100+d*10,usage:d?10:null}))}));
    const notes=Object.fromEntries(t.roles.map(r=>[r,[{text:`${r}本日工作內容（示意）`,remark:''}]]));
    if(kind==='daily')return {date:today,journal:{status:'draft',updated_by:'示意',data:{notes,construction_units:[{unit:'4A5',work:'油漆',people:'3'}],construction_public:[{place:'中庭',work:'植栽修剪',people:'2'}],staffing:{rows:t.roles.map(r=>({role:r,name:'王小明',status:'work'})),tomorrow_off:'無'},packages:{d3:{pkg:'2',reg:'',deposit:'',note:'5B6'}},custom,extra:'（示意）其他事項'}},settings,overview:settings.overview,meters,renovations:[{unit:'7A3',permit_period:'10/1-11/30',deposit:'paid',cleaning_fee:'paid',status:'working',detector_reset:false}],tracking};
    return {week_start:today,journal:{status:'draft',data:{summary:'1. 完成 B 棟電梯查修\n2. 新增 2 戶裝修申請',committee:'（示意）需管委會決議事項',next_week:'（示意）水塔清洗',custom}},settings,summary:{week_start:today,week_end:today,construction:[],construction_total:{unit_people:12,public_people:5},daily_count:5,daily_submitted:4,meters:t.meters.map(m=>({label:m.label,usage:120,prev_usage:100,change_pct:20,abnormal:false})),renovation:{new_units:['7A3'],done_units:[],working:2,detector_pending:['7A3']},tracking:{new_count:2,closed:[],open:tracking.map(x=>({...x,age_days:3,last_update:x.updates[0]})),overdue:0,resident_new:1,by_category:cats.map(c=>({key:c.key,label:c.label,new:1,open:1}))},staffing:[{role:t.roles[0]||'總幹事',name:'王小明',work_days:5,off_days:2}]}};
  }
  function preview(kind){
    if(!window.JournalPrint){alert('列印模組尚未載入，請重新整理頁面');return;}
    const box=document.createElement('div');box.className='jta-preview';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
    box.innerHTML=`<div class="jta-preview-box"><div class="jta-preview-bar"><strong>👁 ${kind==='weekly'?'每週':'每日'}工作日誌列印預覽（示意資料，依目前畫面上的設定，尚未儲存的修改也會顯示）</strong><button type="button" class="secondary" data-close>✕ 關閉</button></div><iframe title="列印預覽"></iframe></div>`;
    document.body.appendChild(box);
    const doc=box.querySelector('iframe').contentDocument;doc.open();doc.write(window.JournalPrint.html(sample(kind),{name:'示範社區'}));doc.close();
    const close=()=>box.remove();box.querySelector('[data-close]').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
  }
  async function render(container){
    injectStyle();S.el=container;
    if(S.t&&S.dirty){draw();return;}
    container.innerHTML='<div class="panel">讀取工作日誌範本中…</div>';
    const d=await api('/api/admin/journal-template');
    S.t=d.template;S.builtins=d.builtins;S.usage=d.usage;S.dirty=false;draw();
  }
  window.JournalTemplateAdmin={render};
})();
