// 工作日誌：現場工作台（每日／每週）
// 自己的段落自動儲存；待辦追蹤、裝潢戶、水電表、社區概況會自動延續到之後的日誌；經理送出後鎖定。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const WEEK='日一二三四五六';
  const md=iso=>{if(!iso)return '';const d=new Date(`${iso}T00:00:00`);return `${d.getMonth()+1}/${d.getDate()}`;};
  const longDate=iso=>{const d=new Date(`${iso}T00:00:00`);return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}（${WEEK[d.getDay()]}）`;};
  const addDays=(iso,n)=>{const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const weekStart=iso=>{const d=new Date(`${iso}T00:00:00Z`);return addDays(iso,-((d.getUTCDay()+6)%7));};
  const time=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
  const BASE_CATS=[['committee','管理委員會'],['resident','住戶交辦事項與問題處置'],['center','管理中心待辦事項'],['facility','公共設施相關修繕']];
  // 待辦分類由總後台平台範本決定；已移除分類但仍有舊事項時，照樣顯示出來
  function cats(){const list=(S.payload?.settings?.tracking_categories||[]).map(c=>[c.key,c.label]);const out=list.length?list:BASE_CATS.slice();for(const t of S.payload?.tracking||[])if(!out.some(([k])=>k===t.category))out.push([t.category,t.category_label||'其他']);return out;}
  const secOn=(list,key)=>(list||[]).find(x=>x.key===key);
  const S={el:null,ctx:null,cid:0,date:'',mode:'daily',payload:null,saveTimers:{},saving:0,lastSaved:'',readonly:false};

  function injectStyle(){
    if(document.getElementById('workJournalStyle'))return;
    const s=document.createElement('style');s.id='workJournalStyle';
    s.textContent=`
.wj{--wj-line:#e1e9e5;--wj-soft:#f4f8f6;--wj-muted:#5f6f68}
.wj-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
.wj-head h1{margin:4px 0 4px}
.wj-head p{margin:0;color:var(--wj-muted)}
.wj-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:16px 0 4px}
.wj-bar select{width:auto;min-width:160px;margin:0}
.wj-datenav{display:inline-flex;align-items:center;border:1px solid #d6e2dc;border-radius:10px;overflow:hidden;background:#fff}
.wj-datenav button{border:0;background:transparent;color:var(--accent-dark,#1B4D37);padding:8px 12px;min-height:0;font-size:1rem;border-radius:0}
.wj-datenav button:hover{background:var(--wj-soft)}
.wj-datenav input{border:0;border-left:1px solid #e3ebe7;border-right:1px solid #e3ebe7;padding:8px 10px;margin:0;font:inherit;width:auto;border-radius:0}
.wj-datenav .wj-week-label{padding:8px 12px;font-weight:700;white-space:nowrap;border-left:1px solid #e3ebe7;border-right:1px solid #e3ebe7}
.wj-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
.wj-actions button{padding:8px 14px;min-height:0}
.wj-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 0;font-size:.86rem;color:var(--wj-muted)}
.wj-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-weight:700;font-size:.82rem}
.wj-pill.draft{background:#fff3e0;color:#a35a00}.wj-pill.submitted{background:#e3f2e9;color:#1f6b43}
.wj-save{margin-left:auto}
.wj-sec{margin-top:16px}
.wj-sec>h2{display:flex;align-items:center;gap:10px;font-size:1.12rem;margin:0 0 4px}
.wj-sec>h2 .wj-num{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--accent,#2E6B4F);color:#fff;font-size:.9rem;flex:0 0 28px}
.wj-sec>.wj-hint{margin:0 0 12px;color:var(--wj-muted);font-size:.84rem}
.wj-sub{font-weight:800;margin:14px 0 6px;color:var(--ink,#1d2a25)}
.wj-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--wj-line);border-radius:12px;overflow:hidden;margin:0 0 6px;background:#fff}
.wj-table th{background:var(--wj-soft);font-size:.8rem;color:#4c5d56;text-align:left;padding:8px 10px;border-bottom:1px solid var(--wj-line);white-space:nowrap}
.wj-table td{padding:6px 8px;border-bottom:1px solid #eef2f0;vertical-align:top}
.wj-table tr:last-child td{border-bottom:0}
.wj-table input,.wj-table textarea,.wj-table select{width:100%;box-sizing:border-box;margin:0;padding:7px 9px;font:inherit;font-size:.92rem;border:1px solid transparent;border-radius:8px;background:transparent}
.wj-table input:hover,.wj-table textarea:hover{border-color:#e3ebe7}
.wj-table input:focus,.wj-table textarea:focus,.wj-table select:focus{border-color:var(--accent,#2E6B4F);background:#fff;outline:none}
.wj-table textarea{resize:vertical;min-height:38px}
.wj-table .no{width:44px;text-align:center;color:var(--wj-muted);font-size:.85rem;padding-top:14px}
.wj-table .num{width:80px}.wj-table .num input{text-align:right}
.wj-table .act{width:40px;text-align:center}
.wj-del{border:0;background:transparent;color:#a0aca7;font-size:1.1rem;padding:4px 8px;min-height:0;cursor:pointer;border-radius:6px}
.wj-del:hover{background:#fdecea;color:#c0392b}
.wj-add{border:1px dashed #b9cfc4;background:#fff;color:var(--accent-dark,#1B4D37);padding:7px 12px;border-radius:9px;font-weight:700;min-height:0;cursor:pointer;font-size:.86rem}
.wj-add:hover{background:var(--wj-soft)}
.wj-total{font-size:.86rem;color:var(--wj-muted);margin:2px 0 10px}
.wj-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.wj-check{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:.88rem}
.wj-check input{width:auto}
.wj-reno-off td:first-child input{background:#fff7b3}
.wj-meters{display:flex;flex-direction:column;gap:10px}
.wj-meter{display:grid;grid-template-columns:160px 150px 110px minmax(0,1fr);gap:12px;align-items:center;border:1px solid var(--wj-line);border-radius:12px;padding:10px 14px;background:#fff}
.wj-meter strong{font-size:.95rem}
.wj-meter input{margin:0;text-align:right}
.wj-meter .wj-usage{font-weight:800;color:var(--accent-dark,#1B4D37)}
.wj-meter .wj-usage small{display:block;font-weight:500;color:var(--wj-muted);font-size:.74rem}
.wj-spark{display:flex;gap:6px;overflow-x:auto;font-size:.74rem;color:var(--wj-muted)}
.wj-spark span{flex:0 0 auto;background:var(--wj-soft);border-radius:8px;padding:3px 8px;text-align:center;line-height:1.3}
.wj-spark b{display:block;color:var(--ink,#1d2a25);font-size:.8rem}
.wj-overview{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:8px}
.wj-overview label{display:flex;flex-direction:column;gap:4px;font-size:.76rem;color:var(--wj-muted);font-weight:700}
.wj-overview input{margin:0;text-align:center;padding:7px 4px}
.wj-cat{border:1px solid var(--wj-line);border-radius:14px;margin:0 0 12px;background:#fff;overflow:hidden}
.wj-cat-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--wj-soft);font-weight:800}
.wj-cat-head small{color:var(--wj-muted);font-weight:600}
.wj-track{padding:12px 14px;border-top:1px solid #eef2f0;display:grid;grid-template-columns:60px minmax(0,1fr);gap:10px}
.wj-track.closed{background:#fafbfa}
.wj-track.closed .wj-track-content{color:#7a8a83;text-decoration:line-through}
.wj-track-date{font-size:.82rem;color:var(--wj-muted);font-weight:700;padding-top:2px}
.wj-track-content{font-weight:600;white-space:pre-wrap}
.wj-track-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px}
.wj-ups{margin:8px 0 0;padding:0;list-style:none;border-left:2px solid #d6e5dd}
.wj-ups li{padding:3px 0 3px 10px;font-size:.88rem;display:flex;gap:8px;align-items:flex-start}
.wj-ups li b{color:var(--accent-dark,#1B4D37);flex:0 0 auto}
.wj-ups li span{flex:1;white-space:pre-wrap}
.wj-upform{display:flex;gap:6px;margin-top:8px}
.wj-upform input{margin:0;padding:7px 10px;font-size:.88rem}
.wj-upform input[type=date]{width:150px;flex:0 0 150px}
.wj-upform button{padding:7px 12px;min-height:0;white-space:nowrap}
.wj-newtrack{display:flex;gap:6px;padding:10px 14px;border-top:1px dashed #d6e5dd}
.wj-newtrack input{margin:0;padding:7px 10px}
.wj-newtrack input[type=date]{width:150px;flex:0 0 150px}
.wj-newtrack button{padding:7px 12px;min-height:0;white-space:nowrap}
.wj-link{border:0;background:transparent;color:var(--wj-muted);font-size:.8rem;padding:2px 4px;min-height:0;cursor:pointer;text-decoration:underline}
.wj-link:hover{color:var(--accent-dark,#1B4D37)}
.wj-text{width:100%;box-sizing:border-box;min-height:110px;margin:0;font:inherit;line-height:1.6}
.wj-auto{border:1px solid var(--wj-line);border-radius:12px;background:#fbfdfc;padding:12px 14px;margin-bottom:10px}
.wj-auto-tag{display:inline-block;font-size:.72rem;font-weight:800;color:#2f5d8a;background:#e5eefb;border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:middle}
.wj-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:10px}
.wj-kpi{border:1px solid var(--wj-line);border-radius:12px;padding:10px 12px;background:#fff}
.wj-kpi span{display:block;font-size:.76rem;color:var(--wj-muted);font-weight:700}
.wj-kpi b{font-size:1.4rem}
.wj-warn{color:#b3261e;font-weight:800}
.wj-ro input,.wj-ro textarea,.wj-ro select,.wj-ro .wj-add,.wj-ro .wj-del,.wj-ro .wj-upform,.wj-ro .wj-newtrack,.wj-ro .wj-link{pointer-events:none}
.wj-ro .wj-add,.wj-ro .wj-del,.wj-ro .wj-upform,.wj-ro .wj-newtrack,.wj-ro .wj-link,.wj-ro .wj-only-edit{display:none!important}
.wj-lock{margin-top:12px;padding:10px 14px;border-radius:10px;background:#e3f2e9;color:#1f6b43;font-weight:700}
.wj-settings label{display:block;font-weight:700;margin:12px 0 6px}
.wj-settings .wj-radio{display:flex;gap:16px}
.wj-settings .wj-radio label{display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:600}
.wj-settings .wj-list-edit{display:flex;flex-direction:column;gap:6px}
.wj-settings .wj-list-edit div{display:flex;gap:6px}
.wj-settings .wj-list-edit input{margin:0}
.wj-hist{max-height:60vh;overflow:auto}
.wj-custom{display:flex;flex-direction:column;gap:10px}
.wj-custom-item{display:grid;grid-template-columns:minmax(160px,30%) minmax(0,1fr);gap:12px;align-items:start;border:1px solid var(--wj-line);border-radius:12px;padding:10px 14px;background:#fff}
.wj-custom-label{font-weight:700;padding-top:6px}.wj-custom-label small{display:block;font-weight:400;color:var(--wj-muted);font-size:.8rem}
.wj-choice{display:flex;flex-wrap:wrap;gap:14px;padding-top:6px}
.wj-inherit{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;font-size:.72rem;font-weight:700;background:#e6f2fb;color:#1e5f8c}
.wj-inherit.own{background:#fff3e0;color:#a35a00}
@media(max-width:640px){.wj-custom-item{grid-template-columns:1fr}}
.wj-hist button{display:flex;justify-content:space-between;width:100%;text-align:left;border:0;border-bottom:1px solid #eef2f0;background:#fff;color:inherit;padding:10px 6px;min-height:0;cursor:pointer;border-radius:0}
.wj-hist button:hover{background:var(--wj-soft)}
@media(max-width:900px){.wj-two{grid-template-columns:1fr}.wj-overview{grid-template-columns:repeat(3,minmax(0,1fr))}.wj-meter{grid-template-columns:1fr 1fr}.wj-meter .wj-spark{grid-column:1/-1}}
@media(max-width:640px){.wj-sec{overflow:hidden}.wj .wj-table{table-layout:fixed;width:100%;min-width:0}.wj .wj-reno-wrap .wj-table{min-width:560px}.wj-table th{white-space:normal}.wj-table input,.wj-table textarea,.wj-table select{min-width:0;padding:6px 6px}.wj-table td{padding:4px 4px}.wj-table .act{width:30px}.wj-table .num{width:56px}.wj-pk td:first-child{width:72px;font-size:.8rem}.wj-actions{margin-left:0;width:100%}.wj-actions button{flex:1}.wj-bar select{width:100%}.wj-datenav{width:100%}.wj-datenav input{flex:1}.wj-upform,.wj-newtrack{flex-wrap:wrap}.wj-upform input[type=date],.wj-newtrack input[type=date]{flex:1 1 140px}.wj-track{grid-template-columns:1fr}.wj-table .no{display:none}.wj-meter{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }

  // ---------- 儲存 ----------
  function setSave(text,cls=''){const e=S.el?.querySelector('#wjSave');if(e){e.textContent=text;e.className=`wj-save ${cls}`;}}
  function data(){S.payload.journal=S.payload.journal||{data:{},status:'draft'};S.payload.journal.data=S.payload.journal.data||{};return S.payload.journal.data;}
  function queuePatch(key,value){
    if(S.readonly)return;
    data();if(key.startsWith('notes.')){data().notes=data().notes||{};data().notes[key.slice(6)]=value;}else data()[key]=value;
    clearTimeout(S.saveTimers[key]);setSave('儲存中…');
    S.saveTimers[key]=setTimeout(async()=>{
      S.saving++;
      try{const r=await api(`/api/staff/journal/${S.mode==='weekly'?'week':'day'}`,J('PUT',{community_id:S.cid,date:S.date,patch:{[key]:value}}));S.payload.journal={...r.journal,data:{...r.journal.data}};S.lastSaved=new Date().toISOString();setSave(`✓ 已自動儲存 ${time(S.lastSaved)}`,'ok');updateStatus();}
      catch(e){setSave(`⚠ 儲存失敗：${e.message}`,'err');}
      finally{S.saving--;}
    },700);
  }
  async function act(fn){try{await fn();}catch(e){alert(e.message);}}

  // ---------- 共用元件 ----------
  function rowsTable(cols,rows,onChange,{numbered=true,addLabel='＋ 新增一列',min=1}={}){
    // cols: [{key,label,type:'text'|'textarea'|'num',width}]
    const wrap=document.createElement('div');
    const draw=()=>{
      const list=rows.length?rows:Array.from({length:min},()=>({}));
      wrap.innerHTML=`<table class="wj-table"><thead><tr>${numbered?'<th class="no">項次</th>':''}${cols.map(c=>`<th${c.width?` style="width:${c.width}"`:''}>${esc(c.label)}</th>`).join('')}<th class="act"></th></tr></thead><tbody>${list.map((r,i)=>`<tr data-i="${i}">${numbered?`<td class="no">${i+1}</td>`:''}${cols.map(c=>`<td class="${c.type==='num'?'num':''}">${c.type==='textarea'?`<textarea rows="1" data-k="${c.key}" placeholder="${esc(c.ph||'')}">${esc(r[c.key]??'')}</textarea>`:`<input data-k="${c.key}" ${c.type==='num'?'inputmode="numeric"':''} value="${esc(r[c.key]??'')}" placeholder="${esc(c.ph||'')}">`}</td>`).join('')}<td class="act"><button type="button" class="wj-del" title="刪除這一列" aria-label="刪除這一列">×</button></td></tr>`).join('')}</tbody></table><button type="button" class="wj-add">${esc(addLabel)}</button>`;
      if(!rows.length)rows.push(...list);
      wrap.querySelectorAll('tr[data-i]').forEach(tr=>{const i=Number(tr.dataset.i);
        tr.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener('input',()=>{rows[i][inp.dataset.k]=inp.value;if(inp.tagName==='TEXTAREA'){inp.style.height='auto';inp.style.height=inp.scrollHeight+'px';}onChange(rows);}));
        tr.querySelector('.wj-del').addEventListener('click',()=>{rows.splice(i,1);draw();onChange(rows);});
      });
      wrap.querySelectorAll('textarea').forEach(t=>{t.style.height='auto';t.style.height=Math.max(38,t.scrollHeight)+'px';});
      wrap.querySelector('.wj-add').addEventListener('click',()=>{rows.push({});draw();onChange(rows);const last=wrap.querySelector('tr[data-i]:last-child [data-k]');last?.focus();});
    };
    draw();return wrap;
  }
  function section(n,title,hint){const sec=document.createElement('section');sec.className='wj-sec panel';sec.innerHTML=`<h2><span class="wj-num">${n}</span>${esc(title)}</h2>${hint?`<p class="wj-hint">${hint}</p>`:''}`;return sec;}

  // ---------- 各段 ----------
  function notesSection(n,cfg={}){
    const sec=section(n,cfg.label||'案場重要記事','依職務各自填寫本日工作內容，大家可以同時編輯，不會互相覆蓋。');
    const notes=data().notes||{};const roles=[...new Set([...(S.payload.settings.roles||[]),...Object.keys(notes)])];
    for(const role of roles){const h=document.createElement('div');h.className='wj-sub';h.textContent=role;sec.appendChild(h);
      const rows=(notes[role]||[]).map(x=>({...x}));sec.appendChild(rowsTable([{key:'text',label:'本日工作內容',type:'textarea',ph:'例如：巡視公設、處理住戶反映…'},{key:'remark',label:'備註',width:'24%'}],rows,r=>queuePatch(`notes.${role}`,r.filter(x=>x.text||x.remark))));}
    return sec;
  }
  function constructionSection(n,cfg={}){
    const parts=cfg.parts||{stats:true,renovations:true};
    const sec=section(n,cfg.label||'施工管制',parts.renovations!==false?'裝潢施工戶清單會自動延續到之後的日誌；只要更新有變動的戶別。':'');
    const two=document.createElement('div');two.className='wj-two';
    const mk=(title,key,cols)=>{const box=document.createElement('div');const rows=(data()[key]||[]).map(x=>({...x}));const total=document.createElement('div');total.className='wj-total';const upd=r=>{total.textContent=`當日施工人數統計：${r.reduce((a,x)=>a+(Number(String(x.people||'').replace(/[^\d.]/g,''))||0),0)} 人`;};box.innerHTML=`<div class="wj-sub">${title}</div>`;box.appendChild(rowsTable(cols,rows,r=>{upd(r);queuePatch(key,r.filter(x=>Object.values(x).some(Boolean)));}));upd(rows);box.appendChild(total);return box;};
    two.appendChild(mk('專有戶施工統計','construction_units',[{key:'unit',label:'戶別',width:'22%',ph:'4A5'},{key:'work',label:'工程內容',ph:'油漆'},{key:'people',label:'人數',type:'num'}]));
    two.appendChild(mk('公共區域施工統計','construction_public',[{key:'place',label:'施工地點',width:'26%',ph:'公設'},{key:'work',label:'工程內容',ph:'水電'},{key:'people',label:'人數',type:'num'}]));
    if(parts.stats!==false)sec.appendChild(two);
    if(parts.renovations===false)return sec;
    const h=document.createElement('div');h.className='wj-sub';h.textContent='專有戶施工資訊（裝潢戶清單）';sec.appendChild(h);
    const box=document.createElement('div');sec.appendChild(box);
    const draw=()=>{
      const list=S.payload.renovations||[];
      box.innerHTML=`<div class="wj-reno-wrap" style="overflow-x:auto"><table class="wj-table"><thead><tr><th>戶別</th><th>施工申請期限</th><th>保證金</th><th>清潔費</th><th>裝潢情形</th><th>消防探測器</th><th class="act"></th></tr></thead><tbody>${list.map(r=>`<tr data-id="${r.id}" class="${r.detector_reset?'':'wj-reno-off'}"><td><input data-k="unit" value="${esc(r.unit)}"></td><td><input data-k="permit_period" value="${esc(r.permit_period)}" placeholder="6/16-10/20"></td><td><select data-k="deposit"><option value="">—</option><option value="paid" ${r.deposit==='paid'?'selected':''}>已繳</option><option value="refunding" ${r.deposit==='refunding'?'selected':''}>退款中</option></select></td><td><select data-k="cleaning_fee"><option value="">—</option><option value="paid" ${r.cleaning_fee==='paid'?'selected':''}>已繳</option><option value="unpaid" ${r.cleaning_fee==='unpaid'?'selected':''}>未繳</option></select></td><td><select data-k="status"><option value="working" ${r.status!=='done'?'selected':''}>裝潢中</option><option value="done" ${r.status==='done'?'selected':''}>已完工</option></select></td><td><label class="wj-check"><input type="checkbox" data-k="detector_reset" ${r.detector_reset?'checked':''}> 已復歸</label></td><td class="act"><button type="button" class="wj-del" title="從清單移除" aria-label="從清單移除">×</button></td></tr>`).join('')||'<tr><td colspan="7" style="color:#7a8a83;padding:12px">目前沒有裝潢施工戶</td></tr>'}</tbody></table></div>
        <div class="wj-newtrack wj-only-edit" style="border:0;padding:6px 0"><input id="wjRenoUnit" placeholder="新增戶別，例如 12A3" style="max-width:200px"><input id="wjRenoPeriod" placeholder="施工申請期限" style="max-width:200px"><button type="button" id="wjRenoAdd">＋ 新增裝潢戶</button></div>
        ${list.some(r=>!r.detector_reset)?`<div class="wj-total">⚠ 消防探測器尚未復歸：${esc(list.filter(r=>!r.detector_reset).map(r=>r.unit).join('、'))}</div>`:''}`;
      box.querySelectorAll('tr[data-id]').forEach(tr=>{const id=tr.dataset.id;
        tr.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener('change',()=>act(async()=>{const body={community_id:S.cid,date:S.date,[inp.dataset.k]:inp.type==='checkbox'?inp.checked:inp.value};const r=await api(`/api/staff/journal/renovations/${id}`,J('PUT',body));S.payload.renovations=r.renovations;draw();})));
        tr.querySelector('.wj-del').addEventListener('click',()=>act(async()=>{const r=S.payload.renovations.find(x=>String(x.id)===id);if(!confirm(`把「${r?.unit}」從裝潢戶清單移除嗎？\n（已完工且保證金退還後再移除；移除後之後的日誌就不會再出現）`))return;const d=await api(`/api/staff/journal/renovations/${id}`,J('PUT',{community_id:S.cid,date:S.date,archived:true}));S.payload.renovations=d.renovations;draw();}));
      });
      box.querySelector('#wjRenoAdd')?.addEventListener('click',()=>act(async()=>{const unit=box.querySelector('#wjRenoUnit').value.trim();if(!unit)return alert('請輸入戶別');const r=await api('/api/staff/journal/renovations',J('POST',{community_id:S.cid,date:S.date,unit,permit_period:box.querySelector('#wjRenoPeriod').value.trim(),detector_reset:true}));S.payload.renovations=r.renovations;draw();}));
    };
    draw();return sec;
  }
  function staffingSection(n,cfg={}){
    const sec=section(n,cfg.label||'人員管制','已依「班表」自動帶入今天的上班／休假人員，可以直接修改。');
    const st=data().staffing||JSON.parse(JSON.stringify(S.payload.staffing_suggestion||{rows:[],tomorrow_off:''}));
    const save=()=>queuePatch('staffing',{rows:st.rows.filter(r=>r.role||r.name),tomorrow_off:st.tomorrow_off||''});
    const box=document.createElement('div');sec.appendChild(box);
    const draw=()=>{
      box.innerHTML=`<table class="wj-table"><thead><tr><th>職務名稱</th><th>姓名</th><th>出勤</th><th class="act"></th></tr></thead><tbody>${st.rows.map((r,i)=>`<tr data-i="${i}"><td><input data-k="role" value="${esc(r.role)}" placeholder="社區秘書"></td><td><input data-k="name" value="${esc(r.name)}"></td><td><select data-k="status"><option value="work" ${r.status!=='off'?'selected':''}>上班</option><option value="off" ${r.status==='off'?'selected':''}>休假</option></select></td><td class="act"><button type="button" class="wj-del" aria-label="刪除">×</button></td></tr>`).join('')||'<tr><td colspan="4" style="color:#7a8a83;padding:12px">班表尚未排定，請手動新增</td></tr>'}</tbody></table>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="wj-add" id="wjStAdd">＋ 新增人員</button><button type="button" class="wj-add" id="wjStReload">↻ 從班表重新帶入</button></div>
        <div class="wj-sub">明日休假人員</div><input id="wjTomorrow" value="${esc(st.tomorrow_off||'')}" placeholder="例如：環保人員 楊〇〇" style="margin:0">`;
      box.querySelectorAll('tr[data-i]').forEach(tr=>{const i=Number(tr.dataset.i);tr.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener(inp.tagName==='SELECT'?'change':'input',()=>{st.rows[i][inp.dataset.k]=inp.value;save();}));tr.querySelector('.wj-del').addEventListener('click',()=>{st.rows.splice(i,1);draw();save();});});
      box.querySelector('#wjStAdd').addEventListener('click',()=>{st.rows.push({role:'',name:'',status:'work'});draw();});
      box.querySelector('#wjStReload').addEventListener('click',()=>{if(st.rows.length&&!confirm('用班表的資料取代目前的人員清單嗎？'))return;const sug=S.payload.staffing_suggestion||{rows:[],tomorrow_off:''};st.rows=JSON.parse(JSON.stringify(sug.rows));st.tomorrow_off=sug.tomorrow_off;draw();save();});
      box.querySelector('#wjTomorrow').addEventListener('input',e=>{st.tomorrow_off=e.target.value;save();});
    };
    draw();return sec;
  }
  function metersSection(n,{date,title='社區巡檢狀況',hint}={}){
    const sec=section(n,title,hint||'只要填「今日度數」，使用量會自動計算（今日度數－前一次度數）。抄表項目可由經理在「⚙ 設定」調整。');
    let mDate=date||S.date;
    if(S.mode==='weekly'){const bar=document.createElement('div');bar.className='wj-only-edit';bar.style.cssText='margin:0 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';bar.innerHTML=`<span style="font-weight:700">抄表日期</span><input type="date" id="wjMeterDate" value="${mDate}" style="width:auto;margin:0">`;sec.appendChild(bar);bar.querySelector('input').addEventListener('change',e=>act(async()=>{mDate=e.target.value;const p=await api(`/api/staff/journal/day?community_id=${S.cid}&date=${mDate}`);meters=p.meters;draw();}));}
    let meters=S.payload.meters||[];
    const box=document.createElement('div');box.className='wj-meters';sec.appendChild(box);
    // 週報：抄表日期不一定是週日，依選擇的日期讀取當天度數
    if(S.mode==='weekly')setTimeout(()=>act(async()=>{const p=await api(`/api/staff/journal/day?community_id=${S.cid}&date=${mDate}`);meters=p.meters||meters;draw();}),0);
    const draw=()=>{
      box.innerHTML=meters.map(m=>`<div class="wj-meter" data-key="${esc(m.key)}"><strong>${esc(m.label)}</strong><input inputmode="decimal" placeholder="今日度數" value="${m.today??''}" aria-label="${esc(m.label)} 今日度數"><div class="wj-usage">${m.usage==null?'—':m.usage}<small>使用量</small></div><div class="wj-spark">${(m.history||[]).filter(h=>h.date!==mDate).slice(-6).map(h=>`<span>${md(h.date)}<b>${h.usage??h.value}</b></span>`).join('')||'<span>尚無前次紀錄</span>'}</div></div>`).join('');
      box.querySelectorAll('.wj-meter').forEach(div=>div.querySelector('input').addEventListener('change',e=>act(async()=>{const r=await api('/api/staff/journal/meter',J('PUT',{community_id:S.cid,date:mDate,key:div.dataset.key,value:e.target.value.trim()}));meters=(r.meters||meters).map(x=>x);if(mDate===S.date||S.mode!=='weekly')S.payload.meters=meters;draw();setSave(`✓ 已儲存抄表 ${time(new Date().toISOString())}`,'ok');})));
    };
    draw();return sec;
  }
  function recordSection(n,cfg={}){
    const parts=cfg.parts||{overview:true,packages:true};
    const sec=section(n,cfg.label||'本日工作記錄與交辦事項',parts.overview!==false?'社區概況會自動沿用，有變動時直接修改即可。':'');
    const ov={...(S.payload.settings.overview||{})};
    const F=[['total','總戶數'],['owner','自住'],['tenant','承租'],['vacant','空屋'],['reno_applied','裝潢已申請'],['reno_working','施工中'],['reno_pending','待驗退'],['car','汽車位'],['moto','機車位']];
    if(parts.overview!==false){const o=document.createElement('div');o.innerHTML=`<div class="wj-sub">社區概況說明</div><div class="wj-overview">${F.map(([k,l])=>`<label>${l}<input data-k="${k}" value="${esc(ov[k]||'')}"></label>`).join('')}</div>`;sec.appendChild(o);
    let t;o.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{ov[inp.dataset.k]=inp.value;clearTimeout(t);setSave('儲存中…');t=setTimeout(()=>act(async()=>{const r=await api('/api/staff/journal/settings',J('PUT',{community_id:S.cid,overview:ov}));S.payload.settings.overview=r.settings.overview;setSave(`✓ 已自動儲存 ${time(new Date().toISOString())}`,'ok');}),700);}));}
    if(parts.packages===false)return sec;
    const pk=JSON.parse(JSON.stringify(data().packages||{}));
    const p=document.createElement('div');p.innerHTML=`<div class="wj-sub">包裹／掛號／寄物未領統計</div><table class="wj-table wj-pk"><thead><tr><th>項目</th><th class="num">包裹</th><th class="num">掛號</th><th class="num">寄物</th><th>備註（戶別）</th></tr></thead><tbody>${[['d3','3日以上未領'],['d5','5日以上未領'],['d7','7日以上未領']].map(([k,l])=>`<tr data-r="${k}"><td style="white-space:nowrap;padding-top:13px">${l}</td>${['pkg','reg','deposit'].map(f=>`<td class="num"><input data-f="${f}" inputmode="numeric" value="${esc(pk[k]?.[f]??'')}"></td>`).join('')}<td><textarea rows="1" data-f="note" placeholder="包：21B6*2、25B6；掛：5B6">${esc(pk[k]?.note??'')}</textarea></td></tr>`).join('')}</tbody></table>`;sec.appendChild(p);
    p.querySelectorAll('tr[data-r]').forEach(tr=>tr.querySelectorAll('[data-f]').forEach(inp=>inp.addEventListener('input',()=>{pk[tr.dataset.r]=pk[tr.dataset.r]||{};pk[tr.dataset.r][inp.dataset.f]=inp.value;queuePatch('packages',pk);})));
    return sec;
  }
  function trackingSection(n,{date,title}={}){title=title||'待辦追蹤事項及住戶反映事項';
    const at=date||S.date;
    const sec=section(n,title,'尚未結案的事項會自動帶到之後的日誌。有新進度就在下面加一筆；處理完成請勾「結案」。');
    const box=document.createElement('div');sec.appendChild(box);
    const draw=()=>{
      const list=S.payload.tracking||[];
      box.innerHTML=cats().map(([k,label])=>{const items=list.filter(t=>t.category===k);return `<div class="wj-cat" data-cat="${k}"><div class="wj-cat-head"><span>${label}</span><small>${items.filter(t=>!t.closed_on).length} 件追蹤中</small></div>
        ${items.map(t=>`<div class="wj-track ${t.closed_on?'closed':''}" data-id="${t.id}"><div class="wj-track-date">${md(t.opened_on)}</div><div><div class="wj-track-content">${esc(t.content)}</div>
          ${(t.updates||[]).length?`<ul class="wj-ups">${t.updates.map(u=>`<li><b>${md(u.update_date)}</b><span>${esc(u.content)}</span><button type="button" class="wj-del" data-up="${u.id}" title="刪除這筆進度" aria-label="刪除這筆進度">×</button></li>`).join('')}</ul>`:''}
          <div class="wj-track-meta"><label class="wj-check"><input type="checkbox" data-close ${t.closed_on?'checked':''}> ${t.closed_on?`已結案（${md(t.closed_on)}）`:'結案'}</label><button type="button" class="wj-link" data-edit>修改內容</button><button type="button" class="wj-link" data-remove>刪除</button></div>
          ${t.closed_on?'':`<div class="wj-upform"><input type="date" value="${at}" data-ud><input placeholder="新增處理進度，例如：已向電梯廠商報修" data-uc><button type="button" data-uadd>加入進度</button></div>`}
        </div></div>`).join('')}
        <div class="wj-newtrack"><input type="date" value="${at}" data-nd><input placeholder="新增${label}…" data-nc style="flex:1"><button type="button" data-nadd>＋ 新增</button></div></div>`;}).join('');
      const refresh=r=>{S.payload.tracking=r.tracking;draw();};
      box.querySelectorAll('.wj-track').forEach(el=>{const id=el.dataset.id;const t=(S.payload.tracking||[]).find(x=>String(x.id)===id);
        el.querySelector('[data-close]').addEventListener('change',e=>act(async()=>refresh(await api(`/api/staff/journal/tracking/${id}`,J('PUT',{community_id:S.cid,date:at,closed_on:e.target.checked?at:null})))));
        el.querySelector('[data-edit]').addEventListener('click',()=>act(async()=>{const v=prompt('修改內容：',t.content);if(v===null||!v.trim())return;refresh(await api(`/api/staff/journal/tracking/${id}`,J('PUT',{community_id:S.cid,date:at,content:v.trim()})));}));
        el.querySelector('[data-remove]').addEventListener('click',()=>act(async()=>{if(!confirm('確定刪除這筆追蹤事項與它的所有進度嗎？（處理完成請用「結案」，刪除只用在登記錯誤）'))return;refresh(await api(`/api/staff/journal/tracking/${id}?community_id=${S.cid}&date=${at}`,{method:'DELETE'}));}));
        el.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>act(async()=>{if(!confirm('刪除這筆處理進度？'))return;refresh(await api(`/api/staff/journal/tracking-updates/${b.dataset.up}?community_id=${S.cid}&date=${at}`,{method:'DELETE'}));})));
        const add=el.querySelector('[data-uadd]');if(add){const go=()=>act(async()=>{const c=el.querySelector('[data-uc]').value.trim();if(!c)return;refresh(await api(`/api/staff/journal/tracking/${id}/updates`,J('POST',{community_id:S.cid,date:at,update_date:el.querySelector('[data-ud]').value,content:c})));});add.addEventListener('click',go);el.querySelector('[data-uc]').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();go();}});}
      });
      box.querySelectorAll('.wj-cat').forEach(cat=>{const go=()=>act(async()=>{const c=cat.querySelector('[data-nc]').value.trim();if(!c)return;S.payload.tracking=(await api('/api/staff/journal/tracking',J('POST',{community_id:S.cid,date:at,category:cat.dataset.cat,opened_on:cat.querySelector('[data-nd]').value,content:c}))).tracking;draw();});cat.querySelector('[data-nadd]').addEventListener('click',go);cat.querySelector('[data-nc]').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();go();}});});
    };
    draw();return sec;
  }
  function textSection(n,title,key,{hint='',ph=''}={}){const sec=section(n,title,hint);const t=document.createElement('textarea');t.className='wj-text';t.placeholder=ph;t.value=data()[key]||'';t.addEventListener('input',()=>queuePatch(key,t.value));sec.appendChild(t);return sec;}
  // 總後台「自訂紀錄項目」：依每日／每週顯示
  function customItems(kind){return (S.payload.settings?.custom_items||[]).filter(c=>c.scope==='both'||c.scope===kind);}
  function customSection(n,cfg,kind){
    const items=customItems(kind);if(!items.length)return null;
    const sec=section(n,cfg.label||'其他紀錄項目','');const vals=JSON.parse(JSON.stringify(data().custom||{}));
    const save=()=>queuePatch('custom',vals);
    const grid=document.createElement('div');grid.className='wj-custom';
    for(const c of items){
      const row=document.createElement('div');row.className='wj-custom-item';const v=vals[c.id];
      let ctl='';
      if(c.type==='textarea')ctl=`<textarea class="wj-text" style="min-height:70px" data-c="${esc(c.id)}">${esc(v||'')}</textarea>`;
      else if(c.type==='yesno'||c.type==='select'){const opts=c.type==='yesno'?['是','否']:(c.options||[]);ctl=`<div class="wj-choice">${opts.map(o=>`<label class="wj-check"><input type="radio" name="wjc_${esc(c.id)}" value="${esc(o)}" data-c="${esc(c.id)}" ${String(v)===String(o)?'checked':''}> ${esc(o)}</label>`).join('')}</div>`;}
      else if(c.type==='checklist'){const arr=Array.isArray(v)?v:[];ctl=`<div class="wj-choice">${(c.options||[]).map(o=>`<label class="wj-check"><input type="checkbox" value="${esc(o)}" data-c="${esc(c.id)}" ${arr.includes(o)?'checked':''}> ${esc(o)}</label>`).join('')}</div>`;}
      else ctl=`<input data-c="${esc(c.id)}" ${c.type==='number'?'inputmode="decimal"':''} value="${esc(v??'')}" style="margin:0">`;
      row.innerHTML=`<div class="wj-custom-label">${esc(c.label)}${c.hint?`<small>${esc(c.hint)}</small>`:''}</div><div>${ctl}</div>`;
      row.querySelectorAll('[data-c]').forEach(inp=>inp.addEventListener(inp.type==='radio'||inp.type==='checkbox'?'change':'input',()=>{
        if(c.type==='checklist')vals[c.id]=[...row.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
        else if(inp.type==='radio')vals[c.id]=inp.value;else vals[c.id]=inp.value;save();}));
      grid.appendChild(row);
    }
    sec.appendChild(grid);return sec;
  }

  // ---------- 週報彙整 ----------
  function weeklyAuto(){
    const s=S.payload.summary||{};const t=s.tracking||{};const r=s.renovation||{};
    const wrap=document.createDocumentFragment();
    const secs=(S.payload.settings?.weekly_sections||[{key:'summary'},{key:'construction'},{key:'meters'},{key:'tracking'},{key:'staffing'},{key:'custom'},{key:'committee'},{key:'next_week'},{key:'extra'}]).filter(x=>x.on!==false);
    const at=()=>S.payload.summary?.week_end&&S.payload.summary.week_end<todayStr()?S.payload.summary.week_end:todayClamp();
    const auto=sec=>{sec.querySelector('h2').insertAdjacentHTML('beforeend','<span class="wj-auto-tag">自動彙整</span>');return sec;};
    let n=0;
    const B={
      summary:c=>textSection(++n,c.label||'本週重點摘要','summary',{hint:'寫 3～5 點這週最重要的事，給管委會快速掌握。',ph:'1. 完成 B 棟客梯刷卡機查修\n2. 新增 3 戶裝修申請\n3. …'}),
      construction:c=>{const sec=auto(section(++n,c.label||'施工管制週統計','以下由本週每日日誌自動彙整；若本社區只寫週報，可在下方補充施工紀錄。'));
        sec.insertAdjacentHTML('beforeend',`<div class="wj-kpis"><div class="wj-kpi"><span>本週專有戶施工人次</span><b>${s.construction_total?.unit_people||0}</b></div><div class="wj-kpi"><span>公共區域施工人次</span><b>${s.construction_total?.public_people||0}</b></div><div class="wj-kpi"><span>目前裝潢中</span><b>${r.working||0}</b> 戶</div><div class="wj-kpi"><span>探測器未復歸</span><b class="${(r.detector_pending||[]).length?'wj-warn':''}">${(r.detector_pending||[]).length}</b> 戶</div></div>
      <div class="wj-auto">本週新申請裝修：${esc((r.new_units||[]).join('、')||'無')}<br>本週完工：${esc((r.done_units||[]).join('、')||'無')}${(r.detector_pending||[]).length?`<br><span class="wj-warn">消防探測器尚未復歸：${esc(r.detector_pending.join('、'))}</span>`:''}</div>`);
        const ct=document.createElement('textarea');ct.className='wj-text';ct.style.minHeight='70px';ct.placeholder='補充本週施工紀錄（選填）';ct.value=data().construction||'';ct.addEventListener('input',()=>queuePatch('construction',ct.value));sec.appendChild(ct);return sec;},
      meters:c=>{const m=auto(section(++n,c.label||'社區巡檢（水電用量）週報','本週用量＝週日前最後一次度數－上週最後一次度數；與上週相比變動 30% 以上會標示。'));
        m.insertAdjacentHTML('beforeend',`<table class="wj-table"><thead><tr><th>項目</th><th>本週用量</th><th>上週用量</th><th>增減</th></tr></thead><tbody>${(s.meters||[]).map(x=>`<tr><td>${esc(x.label)}</td><td>${x.usage??'—'}</td><td>${x.prev_usage??'—'}</td><td class="${x.abnormal?'wj-warn':''}">${x.change_pct==null?'—':`${x.change_pct>0?'+':''}${x.change_pct}%${x.abnormal?' ⚠':''}`}</td></tr>`).join('')}</tbody></table>`);
        const f=document.createDocumentFragment();f.appendChild(m);f.appendChild(metersSection(`${n}-1`,{date:at(),title:'抄表登錄',hint:'只寫週報的社區，可以在這裡登錄抄表度數（選擇抄表日期）。'}));return f;},
      tracking:c=>{const tr=auto(section(++n,c.label||'待辦追蹤週報',''));
        tr.insertAdjacentHTML('beforeend',`<div class="wj-kpis"><div class="wj-kpi"><span>本週新增</span><b>${t.new_count||0}</b></div><div class="wj-kpi"><span>本週結案</span><b>${(t.closed||[]).length}</b></div><div class="wj-kpi"><span>仍在追蹤</span><b>${(t.open||[]).length}</b></div><div class="wj-kpi"><span>超過 30 天</span><b class="${t.overdue?'wj-warn':''}">${t.overdue||0}</b></div><div class="wj-kpi"><span>本週住戶反映</span><b>${t.resident_new||0}</b></div></div>`);
        const f=document.createDocumentFragment();f.appendChild(tr);f.appendChild(trackingSection(`${n}-1`,{date:at(),title:'追蹤事項（可直接更新進度）'}));return f;},
      staffing:c=>{const st=auto(section(++n,c.label||'人員出勤週統計','依「班表」自動統計。'));
        st.insertAdjacentHTML('beforeend',(s.staffing||[]).length?`<table class="wj-table"><thead><tr><th>職務</th><th>姓名</th><th>上班天數</th><th>休假天數</th></tr></thead><tbody>${s.staffing.map(x=>`<tr><td>${esc(x.role)}</td><td>${esc(x.name)}</td><td>${x.work_days}</td><td>${x.off_days}</td></tr>`).join('')}</tbody></table>`:'<div class="wj-auto">本週班表尚無資料。</div>');return st;},
      custom:c=>{if(!customItems('weekly').length)return null;return customSection(++n,c,'weekly');},
      committee:c=>textSection(++n,c.label||'需管委會決議／協助事項','committee',{hint:'需要管委會開會決議、核准或協助的事項。',ph:'例如：18A3 違規充電樁，建議發函限期改善。'}),
      next_week:c=>textSection(++n,c.label||'下週工作計畫','next_week',{ph:'例如：水塔清洗（待建設公司排程）、春節清運公告張貼'}),
      extra:c=>textSection(++n,c.label||'其他事項','extra',{hint:'選填'}),
    };
    for(const c of secs){const el=B[c.key]?.(c);if(el)wrap.appendChild(el);}
    return wrap;
  }
  const todayStr=()=>S.ctx?.today||new Date().toISOString().slice(0,10);
  const todayClamp=()=>{const t=todayStr();const ws=S.payload?.summary?.week_start||weekStart(S.date);return t<ws?ws:t;};

  // ---------- 外框 ----------
  function updateStatus(){
    const j=S.payload?.journal;const st=S.el?.querySelector('#wjStatus');if(!st)return;
    const prevSave=st.querySelector('#wjSave');const keep=prevSave?[prevSave.textContent,prevSave.className]:['','wj-save'];
    const submitted=j?.status==='submitted';
    st.innerHTML=`<span class="wj-pill ${submitted?'submitted':'draft'}">${submitted?'✓ 已送出':'● 草稿'}</span>${submitted?`<span>${esc(j.submitted_by||'')} 送出於 ${time(j.submitted_at)}</span>`:j?.updated_at?`<span>最後編輯：${esc(j.updated_by||'')} ${time(j.updated_at)}</span>`:'<span>尚未開始填寫</span>'}<span id="wjSave" class="${keep[1]}">${esc(keep[0])}</span>`;
    const acts=S.el.querySelector('#wjActs');
    if(acts)acts.innerHTML=`<button type="button" class="secondary" id="wjHist">📚 歷史紀錄</button><button type="button" class="secondary" id="wjPrint">🖨 列印／PDF</button>${S.ctx.manager?`<button type="button" class="secondary" id="wjSettings">⚙ 設定</button>${submitted?'<button type="button" class="secondary" id="wjReopen">↩ 退回編輯</button>':'<button type="button" id="wjSubmit">✅ 送出</button>'}`:''}`;
    S.el.querySelector('#wjPrint')?.addEventListener('click',()=>act(async()=>{await flush();await reloadPayload();window.JournalPrint?window.JournalPrint.print(S.payload,S.payload.community):alert('列印模組尚未載入');}));
    S.el.querySelector('#wjHist')?.addEventListener('click',()=>act(openHistory));
    S.el.querySelector('#wjSettings')?.addEventListener('click',()=>openSettings());
    S.el.querySelector('#wjSubmit')?.addEventListener('click',()=>act(async()=>{await flush();if(!confirm(`確定送出${S.mode==='weekly'?'本週週報':` ${longDate(S.date)} 的日誌`}嗎？\n送出後內容會鎖定，之後的追蹤進度不會改到這一份。需要修改時可按「退回編輯」。`))return;await api(`/api/staff/journal/${S.mode==='weekly'?'week':'day'}/submit`,J('POST',{community_id:S.cid,date:S.date}));await load();}));
    S.el.querySelector('#wjReopen')?.addEventListener('click',()=>act(async()=>{if(!confirm('退回編輯後即可修改，修改完請記得再送出。確定嗎？'))return;await api(`/api/staff/journal/${S.mode==='weekly'?'week':'day'}/reopen`,J('POST',{community_id:S.cid,date:S.date}));await load();}));
  }
  async function flush(){const keys=Object.keys(S.saveTimers);for(const k of keys){clearTimeout(S.saveTimers[k]);}S.saveTimers={};const d=data();const patch={};
    if(keys.length){for(const k of keys){patch[k]=k.startsWith('notes.')?(d.notes?.[k.slice(6)]||[]).filter(x=>x.text||x.remark):d[k];}await api(`/api/staff/journal/${S.mode==='weekly'?'week':'day'}`,J('PUT',{community_id:S.cid,date:S.date,patch}));}
    let n=0;while(S.saving&&n++<40)await new Promise(r=>setTimeout(r,100));}
  async function reloadPayload(){S.payload=await api(`/api/staff/journal/${S.mode==='weekly'?'week':'day'}?community_id=${S.cid}&date=${S.date}`);}
  async function openHistory(){
    const d=await api(`/api/staff/journal/list?community_id=${S.cid}&kind=${S.mode}`);
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><h2>📚 ${S.mode==='weekly'?'每週':'每日'}日誌紀錄</h2><div class="wj-hist">${(d.rows||[]).map(r=>`<button type="button" data-d="${r.period_date}"><span><b>${S.mode==='weekly'?`${md(r.period_date)} 那一週`:longDate(r.period_date)}</b><br><small>${esc(r.updated_by||'')} ${time(r.updated_at)}</small></span><span class="wj-pill ${r.status}">${r.status==='submitted'?'已送出':'草稿'}</span></button>`).join('')||'<p class="hint">還沒有任何日誌。</p>'}</div></div>`;
    document.body.appendChild(box);const close=()=>box.remove();box.querySelector('.modal-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    box.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click',()=>{close();S.date=b.dataset.d;load();}));
  }
  function openSettings(){
    const st=JSON.parse(JSON.stringify(S.payload.settings));
    const inh=st.inherited||{};const tag=k=>inh[k]?'<span class="wj-inherit" title="沒有自行調整，跟著總後台平台範本">沿用平台預設</span>':'<span class="wj-inherit own">本社區自訂</span>';
    const touched=new Set();
    const box=document.createElement('div');box.className='modal-backdrop';
    const draw=()=>{box.innerHTML=`<div class="modal wj-settings" role="dialog" aria-modal="true"><button type="button" class="modal-close" aria-label="關閉">×</button><h2>⚙ ${esc(S.payload.community?.name||'')}｜工作日誌設定</h2>
      <p class="hint" style="margin:0">沒有調整的項目會跟著總後台的「平台預設範本」；要記錄哪些區塊、自訂項目由總後台統一設定。</p>
      <label>日誌類型（依管委會習慣）${tag('mode')}</label><div class="wj-radio"><label><input type="radio" name="wjMode" value="daily" ${st.mode!=='weekly'?'checked':''}> 每日工作日誌</label><label><input type="radio" name="wjMode" value="weekly" ${st.mode==='weekly'?'checked':''}> 每週工作日誌</label></div>
      <label>抄表項目${tag('meters')}</label><div class="wj-list-edit" id="wjMeterEdit">${st.meters.map((m,i)=>`<div><input value="${esc(m.label)}" data-i="${i}"><button type="button" class="wj-del" data-rm="${i}" aria-label="刪除">×</button></div>`).join('')}</div><button type="button" class="wj-add" id="wjMeterAdd" style="margin-top:6px">＋ 新增抄表項目</button>
      <label>「案場重要記事」的職務欄${tag('roles')}</label><div class="wj-list-edit" id="wjRoleEdit">${st.roles.map((r,i)=>`<div><input value="${esc(r)}" data-i="${i}"><button type="button" class="wj-del" data-rm="${i}" aria-label="刪除">×</button></div>`).join('')}</div><button type="button" class="wj-add" id="wjRoleAdd" style="margin-top:6px">＋ 新增職務</button>
      <div class="modal-actions">${inh.mode&&inh.meters&&inh.roles?'':'<button type="button" class="secondary" id="wjSetReset" style="margin-right:auto">↺ 全部恢復平台預設</button>'}<button type="button" class="secondary" data-close>取消</button><button type="button" id="wjSetSave">💾 儲存</button></div></div>`;
      box.querySelector('.modal-close').onclick=()=>box.remove();box.querySelector('[data-close]').onclick=()=>box.remove();
      box.querySelectorAll('input[name=wjMode]').forEach(r=>r.addEventListener('change',()=>{st.mode=r.value;touched.add('mode');}));
      box.querySelectorAll('#wjMeterEdit input').forEach(inp=>inp.addEventListener('input',()=>{st.meters[inp.dataset.i].label=inp.value;touched.add('meters');}));
      box.querySelectorAll('#wjRoleEdit input').forEach(inp=>inp.addEventListener('input',()=>{st.roles[inp.dataset.i]=inp.value;touched.add('roles');}));
      box.querySelectorAll('#wjMeterEdit [data-rm]').forEach(b=>b.addEventListener('click',()=>{st.meters.splice(Number(b.dataset.rm),1);touched.add('meters');draw();}));
      box.querySelectorAll('#wjRoleEdit [data-rm]').forEach(b=>b.addEventListener('click',()=>{st.roles.splice(Number(b.dataset.rm),1);touched.add('roles');draw();}));
      box.querySelector('#wjMeterAdd').onclick=()=>{st.meters.push({key:'',label:''});touched.add('meters');draw();box.querySelector('#wjMeterEdit div:last-child input')?.focus();};
      box.querySelector('#wjRoleAdd').onclick=()=>{st.roles.push('');touched.add('roles');draw();box.querySelector('#wjRoleEdit div:last-child input')?.focus();};
      box.querySelector('#wjSetReset')?.addEventListener('click',()=>act(async()=>{if(!confirm('把日誌類型、抄表項目、記事職務全部恢復成總後台的平台預設嗎？（已登錄的抄表度數不會刪除）'))return;const r=await api('/api/staff/journal/settings',J('PUT',{community_id:S.cid,reset:true}));box.remove();const c=S.ctx.communities.find(x=>Number(x.id)===S.cid);if(c)c.mode=r.settings.mode;S.mode=r.settings.mode;await load();}));
      box.querySelector('#wjSetSave').onclick=()=>act(async()=>{const body={community_id:S.cid};if(touched.has('mode'))body.mode=st.mode;if(touched.has('meters'))body.meters=st.meters.filter(m=>m.label.trim());if(touched.has('roles'))body.roles=st.roles.filter(x=>x.trim());if(Object.keys(body).length===1){box.remove();return;}const r=await api('/api/staff/journal/settings',J('PUT',body));box.remove();const c=S.ctx.communities.find(x=>Number(x.id)===S.cid);if(c)c.mode=r.settings.mode;S.mode=r.settings.mode;await load();});
    };
    draw();document.body.appendChild(box);box.addEventListener('click',e=>{if(e.target===box)box.remove();});
  }
  async function load(){
    const el=S.el;el.querySelector('#wjBody').innerHTML='<div class="panel"><div class="profile-loading">正在讀取日誌…</div></div>';
    if(S.mode==='weekly')S.date=weekStart(S.date);
    await reloadPayload();
    S.readonly=S.payload.journal?.status==='submitted';
    const c=S.ctx.communities.find(x=>Number(x.id)===S.cid);
    el.querySelector('#wjTitle').textContent=S.mode==='weekly'?'每週工作日誌':'每日工作日誌';
    el.querySelector('#wjSub').textContent=`${c?.name||''}｜${S.mode==='weekly'?`${longDate(S.date)} ～ ${longDate(addDays(S.date,6))}`:longDate(S.date)}`;
    const nav=el.querySelector('#wjNav');
    nav.innerHTML=`<button type="button" data-step="-1" aria-label="${S.mode==='weekly'?'上一週':'前一天'}">‹</button>${S.mode==='weekly'?`<span class="wj-week-label">${md(S.date)} ～ ${md(addDays(S.date,6))}</span>`:`<input type="date" value="${S.date}" aria-label="日期">`}<button type="button" data-step="1" aria-label="${S.mode==='weekly'?'下一週':'後一天'}">›</button><button type="button" data-today>${S.mode==='weekly'?'本週':'今天'}</button>`;
    nav.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>act(async()=>{await flush();S.date=addDays(S.date,Number(b.dataset.step)*(S.mode==='weekly'?7:1));await load();})));
    nav.querySelector('[data-today]').addEventListener('click',()=>act(async()=>{await flush();S.date=todayStr();await load();}));
    nav.querySelector('input')?.addEventListener('change',e=>act(async()=>{if(!e.target.value)return;await flush();S.date=e.target.value;await load();}));
    updateStatus();
    const body=el.querySelector('#wjBody');body.innerHTML='';body.className=S.readonly?'wj-ro':'';
    if(S.readonly)body.insertAdjacentHTML('beforeend',`<div class="wj-lock">🔒 這份日誌已由 ${esc(S.payload.journal.submitted_by||'經理')} 送出，內容已鎖定${S.ctx.manager?'；需要修改請按上方「退回編輯」':''}。</div>`);
    if(S.mode==='weekly'){body.appendChild(weeklyAuto());}
    else{
      const secs=(S.payload.settings?.daily_sections||[{key:'notes'},{key:'construction'},{key:'staffing'},{key:'meters'},{key:'record'},{key:'tracking'},{key:'custom'},{key:'extra'}]).filter(x=>x.on!==false);
      let n=0;
      const B={notes:c=>notesSection(++n,c),construction:c=>constructionSection(++n,c),staffing:c=>staffingSection(++n,c),meters:c=>metersSection(++n,{title:c.label}),record:c=>recordSection(++n,c),tracking:c=>trackingSection(++n,{title:c.label}),custom:c=>customItems('daily').length?customSection(++n,c,'daily'):null,extra:c=>textSection(++n,c.label||'其他事項','extra',{hint:'選填'})};
      for(const c of secs){const x=B[c.key]?.(c);if(x)body.appendChild(x);}
    }
    if(S.readonly)body.querySelectorAll('input,textarea,select').forEach(x=>{x.disabled=true;});
  }
  async function render(container,label){
    injectStyle();
    const el=container||document.getElementById('staffHome');if(!el)return;
    S.el=el;S.saveTimers={};
    S.ctx=await api('/api/staff/journal/context');
    if(!S.ctx.communities.length){el.innerHTML='<div class="panel"><div class="eyebrow">📝 工作日誌</div><h1>工作日誌</h1><p>您目前沒有派駐的案場，無法填寫工作日誌。</p></div>';return;}
    let saved=0;try{saved=Number(localStorage.getItem('wj-community')||0);}catch{}
    S.cid=Number((S.ctx.communities.find(c=>Number(c.id)===saved)||S.ctx.communities[0]).id);
    S.mode=(S.ctx.communities.find(c=>Number(c.id)===S.cid)?.mode)||'daily';
    S.date=S.ctx.today;
    el.innerHTML=`<div class="wj"><div class="panel"><div class="wj-head"><div><div class="eyebrow">📝 ${esc(label||'工作日誌')}</div><h1 id="wjTitle"></h1><p id="wjSub"></p></div></div>
      <div class="wj-bar">${S.ctx.communities.length>1?`<select id="wjCommunity" aria-label="案場">${S.ctx.communities.map(c=>`<option value="${c.id}" ${Number(c.id)===S.cid?'selected':''}>${esc(c.name)}（${c.mode==='weekly'?'每週':'每日'}）</option>`).join('')}</select>`:''}<div class="wj-datenav" id="wjNav"></div><div class="wj-actions" id="wjActs"></div></div>
      <div class="wj-status" id="wjStatus"></div></div><div id="wjBody"></div></div>`;
    el.querySelector('#wjCommunity')?.addEventListener('change',e=>act(async()=>{await flush();S.cid=Number(e.target.value);try{localStorage.setItem('wj-community',String(S.cid));}catch{}S.mode=S.ctx.communities.find(c=>Number(c.id)===S.cid)?.mode||'daily';S.date=todayStr();await load();}));
    await load();
  }
  window.addEventListener('beforeunload',()=>{if(Object.keys(S.saveTimers).length){try{flush();}catch{}}});
  document.addEventListener('workspace-menu',()=>{if(Object.keys(S.saveTimers).length)flush().catch(()=>{});});
  window.WorkJournalModule={render};
})();
