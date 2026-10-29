// 存證信函：照郵局存證信函用紙（每頁 10 行 × 20 格、每格一字）自動排版。
// 現場人員只要打內容；寄件人（社區管委會／公司）自動帶入，收件人可從住戶名冊挑選或手動輸入。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,o={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const ST={draft:['草稿','ll-st-draft'],printed:['已列印','ll-st-print'],sent:['已寄出','ll-st-sent']};
  const NUM='一二三四五六七八九十';
  const todayTW=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
  const tw=v=>{if(!v)return '';const d=new Date(v);return isNaN(d)?String(v):new Date(d.getTime()+8*3600e3).toISOString().slice(0,16).replace('T',' ');};

  // 與後端相同的排版規則：半形轉全形，每段落自動換行
  function layout(text){
    const full=String(text||'').replace(/\r/g,'').replace(/\t/g,'  ').replace(/[\x21-\x7e]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xFEE0)).replace(/ /g,'　');
    const lines=[];
    for(const para of full.split('\n')){const cs=[...para];if(!cs.length){lines.push('');continue;}for(let i=0;i<cs.length;i+=20)lines.push(cs.slice(i,i+20).join(''));}
    while(lines.length&&!lines[lines.length-1].trim())lines.pop();
    const pages=Math.max(1,Math.ceil(lines.length/10));
    return {lines,pages};
  }

  // 範本（僅供參考，請依實際情況修改）
  const TEMPLATES=[
    {id:'fee',scope:'site',name:'催繳管理費',title:'{戶別} 催繳管理費',body:'敬啟者：\n　　台端為本社區{戶別}之區分所有權人，依公寓大廈管理條例及本社區規約，應按期繳納管理費。經查台端自○年○月起至○年○月止，累計積欠管理費新臺幣○元整，經本會多次催告，迄今仍未繳納。\n　　請台端於收到本函後○日內，至本社區管理中心繳清上開款項。逾期仍未繳納，本會將依公寓大廈管理條例第二十一條規定，訴請法院命台端給付應繳金額及遲延利息，衍生之相關費用概由台端負擔，請勿自誤。\n　　特此函告。'},
    {id:'rule',scope:'site',name:'違反規約限期改善',title:'{戶別} 違反規約限期改善',body:'敬啟者：\n　　經查台端（{戶別}）於○年○月○日有○○○○之情形，已違反本社區規約第○條之規定，經本會口頭及書面勸導，仍未改善。\n　　請台端於收到本函後○日內改善完畢。逾期仍未改善，本會將依公寓大廈管理條例及本社區規約相關規定處理。\n　　特此函告。'},
    {id:'repair',scope:'site',name:'配合修繕（漏水等）',title:'{戶別} 配合修繕通知',body:'敬啟者：\n　　本社區○○○（例如：○樓公共管線）發生漏水情形，經廠商檢查，須進入台端（{戶別}）專有部分施工修繕。本會已於○年○月○日通知台端，迄今未獲回覆。\n　　依公寓大廈管理條例第六條規定，他住戶因維護、修繕專有部分、約定專用部分或設置管線，必須進入或使用其專有部分時，不得拒絕。請台端於收到本函後○日內與本社區管理中心聯繫，約定施工時間。\n　　特此函告。'},
    {id:'blank',scope:'all',name:'一般通知（空白）',title:'',body:'敬啟者：\n　　\n\n　　特此函告。'},
    {id:'return',scope:'company',name:'催告返還公司財物',title:'催告返還公司財物',body:'敬啟者：\n　　台端前任職本公司期間，領用本公司所有之○○○（品名、數量），離職時迄今尚未返還，經本公司多次聯繫未果。\n　　請台端於收到本函後○日內，將上開物品返還本公司。逾期未返還，本公司將依法追究相關責任。\n　　特此函告。'},
  ];

  function css(){if(document.getElementById('llCss'))return;const s=document.createElement('style');s.id='llCss';s.textContent=`
.ll{display:grid;gap:14px}.ll h3{margin:0;font-size:1.02rem;color:#4E322D}.ll-card{border:1px solid #E6DCD8;border-radius:14px;padding:14px 16px;background:#fff}
.ll-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ll-head h2{margin:0;flex:1}.ll-head button{margin:0}
.ll-muted{color:#7A5F58;font-size:.86rem}.ll-tip{background:#FBF8F5;border:1px solid #EDE3DE;border-radius:10px;padding:10px 12px;font-size:.88rem;color:#5d4a44;line-height:1.7}
.ll-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ll-bar select,.ll-bar input{margin:0;padding:8px 10px;border:1px solid #D8CECB;border-radius:8px;font:inherit;background:#fff;width:auto}.ll-bar button{margin:0}
.ll-list{display:grid;gap:8px}.ll-item{border:1px solid #ECE4E1;border-radius:12px;padding:10px 14px;background:#fff;display:grid;gap:4px;cursor:pointer;text-align:left;font:inherit;color:inherit}.ll-item:hover{border-color:#C9A99D}
.ll-item-top{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center}
.ll-st{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.8rem;font-weight:700}.ll-st-draft{background:#F1EEEC;color:#6f625e}.ll-st-print{background:#E9EEF7;color:#2F4A7A}.ll-st-sent{background:#E8EEDF;color:#3E5328}
.ll-edit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}@media(max-width:980px){.ll-edit{grid-template-columns:minmax(0,1fr)}}.ll,.ll-edit>*,.ll-form>*{min-width:0}.ll-pv{overflow:hidden}
.ll-form{display:grid;gap:10px}.ll-form label{display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0;font-size:.92rem}.ll-form input,.ll-form select,.ll-form textarea{margin:0;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;font:inherit;background:#fff;width:100%;box-sizing:border-box}
.ll-form textarea{min-height:260px;line-height:1.8;resize:vertical}.ll-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}@media(max-width:560px){.ll-row{grid-template-columns:minmax(0,1fr)}}
.ll-sec{font-weight:800;color:#4E322D;margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ll-sec button{margin:0;padding:5px 10px;min-height:0;font-size:.85rem}
.ll-rcp{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.4fr) auto auto;gap:6px;align-items:center;border:1px solid #EFE6E2;border-radius:10px;padding:8px;background:#FDFCFB}.ll-rcp input{padding:7px 9px!important}.ll-rcp label{flex-direction:row!important;align-items:center;gap:4px!important;font-weight:600!important;white-space:nowrap}.ll-rcp label input{width:auto}.ll-rcp button{margin:0;padding:4px 9px;min-height:0}
@media(max-width:560px){.ll-grid td{font-size:12px;height:22px}.ll-grid th{font-size:8px}.ll-grid th.rh{width:14px}.ll-pv{position:static}.ll-rcp{grid-template-columns:minmax(0,1fr) auto auto}.ll-rcp input[data-k=address]{grid-column:1/-1;grid-row:2}}
.ll-count{display:flex;gap:10px;flex-wrap:wrap;font-size:.86rem;color:#5d4a44}.ll-count b{color:#A44528}
.ll-actions{display:flex;gap:8px;flex-wrap:wrap}.ll-actions button{margin:0}
.ll-pv{position:sticky;top:10px}.ll-pv-nav{display:flex;gap:8px;align-items:center;margin-bottom:8px}.ll-pv-nav button{margin:0;padding:4px 10px;min-height:0}
.ll-grid{border-collapse:collapse;width:100%;min-width:0!important;table-layout:fixed;background:#fff}.ll-grid td,.ll-grid th{border:1px solid #c9b9b3;text-align:center;padding:0;height:28px;font-size:15px;font-family:'Noto Serif TC','Noto Sans TC',serif}.ll-grid th{font-size:10px;color:#8a7a74;font-weight:400;height:16px;background:#faf7f5}.ll-grid th.rh{width:22px}
.ll-paper{border:1px solid #d8ccc7;border-radius:6px;padding:10px;background:#fffefc}.ll-paper .pt{text-align:center;font-weight:800;letter-spacing:.3em;margin-bottom:6px;color:#4E322D}.ll-paper .pp{font-size:.82rem;line-height:1.6;margin-bottom:8px;color:#4E322D}
.ll-modal-bg{position:fixed;inset:0;background:rgba(40,25,20,.42);z-index:3000;display:flex;align-items:center;justify-content:center;padding:14px}.ll-modal{background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}.ll-modal header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #EFE6E2}.ll-modal header h3{flex:1;margin:0}.ll-modal header button{margin:0}.ll-modal .body{padding:12px 16px;overflow:auto;display:grid;gap:8px}
.ll-pick{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start;border:1px solid #EFE6E2;border-radius:10px;padding:8px 10px;cursor:pointer}.ll-pick input{margin-top:4px;width:auto}
.ll-log{font-size:.84rem;display:grid;gap:3px}.ll-log div{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px dashed #EFE6E2;padding:3px 0}
`;document.head.appendChild(s);}

  // ---------- 列表 ----------
  async function render(host,opt={}){
    css();const base=opt.base||'/api/staff',label=opt.label||'存證信函';const st=host._llf||(host._llf={q:'',status:''});
    host.innerHTML='<div class="ll-muted">載入存證信函…</div>';
    let d;try{d=await api(`${base}/legal-letters?q=${encodeURIComponent(st.q)}&status=${st.status}`);}catch(e){host.innerHTML=`<div class="ll"><div class="ll-head"><h2>${esc(label)}</h2></div><div class="ll-tip">${esc(e.message)}</div></div>`;return;}
    const ctx={base,label,host,d};
    host.innerHTML=`<div class="ll"><div class="ll-head"><h2>${esc(label)}</h2><button type="button" id="llNew">＋ 寫一封存證信函</button></div>
      <div class="ll-tip">📮 照郵局「存證信函用紙」格式自動排版（每頁 10 行、每行 20 格，一格一字）。${d.scope==='site'?`寄件人預設為「${esc(d.community?.name||'')}管理委員會」，收件人可以直接從住戶名冊挑選。`:'寄件人預設為公司資料中的公司名稱、負責人與地址。'}列印後到郵局辦理存證，回來再「登記已寄出」並填上存證號碼。</div>
      <div class="ll-bar"><select id="llSt"><option value="">全部</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}" ${k===st.status?'selected':''}>${v[0]}</option>`).join('')}</select><input id="llQ" value="${esc(st.q)}" placeholder="搜尋標題、收件人、內容"><button type="button" class="secondary" id="llFind">搜尋</button></div>
      <div class="ll-list">${d.rows.length?d.rows.map(r=>`<button type="button" class="ll-item" data-id="${r.id}"><div class="ll-item-top"><b>${esc(r.title||'（未命名）')}</b><span class="ll-st ${ST[r.status][1]}">${ST[r.status][0]}</span></div><div>收件人：${esc(r.recipients.filter(x=>!x.cc).map(x=>x.name).join('、')||'—')}${r.recipients.some(x=>x.cc)?`　副本：${esc(r.recipients.filter(x=>x.cc).map(x=>x.name).join('、'))}`:''}</div><div class="ll-muted">${r.pages} 頁｜${esc(r.created_by)} 建立於 ${esc(tw(r.created_at))}${r.sent_date?`｜${esc(r.sent_date)} 寄出${r.post_no?`（存證號碼 ${esc(r.post_no)}）`:''}`:''}</div></button>`).join(''):'<div class="ll-muted">目前還沒有存證信函。</div>'}</div></div>`;
    const re=()=>render(host,opt);
    host.querySelector('#llNew').onclick=()=>editor(ctx,null);
    host.querySelector('#llSt').onchange=e=>{st.status=e.target.value;re();};
    host.querySelector('#llFind').onclick=()=>{st.q=host.querySelector('#llQ').value.trim();re();};
    host.querySelector('#llQ').onkeydown=e=>{if(e.key==='Enter'){st.q=e.target.value.trim();re();}};
    host.querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{try{const x=await api(`${base}/legal-letters/${b.dataset.id}`);editor(ctx,x.letter);}catch(e){alert(e.message);}});
  }

  // ---------- 編輯 ----------
  function editor(ctx,letter){
    const {base,host,d}=ctx;const site=d.scope==='site';
    const L=letter?JSON.parse(JSON.stringify(letter)):{id:null,title:'',sender:{...d.default_sender},recipients:[],body:'',status:'draft'};
    const locked=L.status==='sent';let page=0;
    const back=()=>render(host,{base,label:ctx.label});
    host.innerHTML=`<div class="ll"><div class="ll-head"><button type="button" class="secondary" id="llBack">← 返回列表</button><h2>${L.id?esc(L.title||'存證信函'):'寫一封存證信函'}</h2>${L.id?`<span class="ll-st ${ST[L.status][1]}">${ST[L.status][0]}</span>`:''}</div>
      ${locked?`<div class="ll-tip">這封信已於 ${esc(L.sent_date)} 寄出${L.post_no?`（存證號碼 ${esc(L.post_no)}）`:''}，內容已鎖定；如需更正請另寫一封。</div>`:''}
      <div class="ll-edit"><div class="ll-card ll-form" id="llForm">
        <label>標題（內部辨識用，不會印出）<input data-f="title" maxlength="60" value="${esc(L.title)}" placeholder="例如：3A2 催繳管理費"></label>
        <div class="ll-sec">一、寄件人</div>
        ${!site&&d.entities.length>1?`<label>公司<select id="llEnt">${d.entities.map(e=>`<option value="${e.id}" ${e.id===L.sender.entity_id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>`:''}
        <label>寄件人名稱<input data-s="org" maxlength="80" value="${esc(L.sender.org)}" placeholder="${site?'例如：綠景莊園社區管理委員會':'公司全名'}"></label>
        <div class="ll-row"><label>代表人職稱<input data-s="rep_title" maxlength="20" value="${esc(L.sender.rep_title)}" placeholder="${site?'主任委員':'負責人'}"></label><label>代表人姓名<input data-s="rep" maxlength="40" value="${esc(L.sender.rep)}" placeholder="例如：王大明"></label></div>
        <label>詳細地址<input data-s="address" maxlength="120" value="${esc(L.sender.address)}" placeholder="含郵遞區號，例如：100 臺北市中正區和平路 88 號"></label>
        <div class="ll-muted">寄件人是管委會或公司時，印出後請蓋「單位圖章」及「代表人印章」。</div>
        <div class="ll-sec">二、收件人／三、副本收件人 <button type="button" class="secondary" id="llAdd">＋ 手動新增</button>${site?'<button type="button" class="secondary" id="llPick">📒 從住戶名冊挑選</button>':''}</div>
        <div id="llRcps" style="display:grid;gap:6px"></div>
        <div class="ll-sec">內容 <select id="llTpl" style="width:auto;padding:5px 8px"><option value="">套用範本…</option>${TEMPLATES.filter(t=>t.scope==='all'||t.scope===d.scope).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <textarea data-f="body" maxlength="20000" placeholder="直接打內容即可，系統會自動排成每行 20 字。段落開頭可以空兩格（　　）。">${esc(L.body)}</textarea>
        <div class="ll-count" id="llCount"></div>
        <div class="ll-muted">範本僅供參考，請依實際情況修改（○ 的地方要填寫）；涉及訴訟或金額較大時，建議先請律師確認內容。</div>
        <div class="ll-actions">${locked?'':`<button type="button" id="llSave">💾 儲存草稿</button>`}<button type="button" class="secondary" id="llPrint">🖨 列印存證信函</button>${L.id&&L.status!=='draft'?`<button type="button" class="secondary" id="llSent">${locked?'取消寄出登記':'📮 登記已寄出'}</button>`:''}${L.id&&L.status==='draft'?'<button type="button" class="secondary" id="llDel" style="color:#a33131">刪除草稿</button>':''}</div>
        ${L.logs?.length?`<div class="ll-sec">紀錄</div><div class="ll-log">${L.logs.map(x=>`<div><span class="ll-muted">${esc(tw(x.created_at))}</span><b>${esc(x.actor)}</b><span>${esc(x.label)}</span><span class="ll-muted">${esc(x.note||'')}</span></div>`).join('')}</div>`:''}
      </div>
      <div class="ll-card ll-pv"><div class="ll-pv-nav"><b style="flex:1">預覽</b><button type="button" class="secondary" id="llPrev">‹</button><span id="llPg"></span><button type="button" class="secondary" id="llNext">›</button></div><div id="llPaper"></div></div></div></div>`;
    const F=host.querySelector('#llForm');
    if(locked)F.querySelectorAll('input,textarea,select').forEach(i=>i.disabled=true);
    const q=s=>host.querySelector(s);
    const rcpBox=q('#llRcps');
    function drawRcps(){
      rcpBox.innerHTML=L.recipients.length?L.recipients.map((r,i)=>`<div class="ll-rcp" data-i="${i}"><input data-k="name" maxlength="80" value="${esc(r.name)}" placeholder="姓名"><input data-k="address" maxlength="120" value="${esc(r.address)}" placeholder="詳細地址（含郵遞區號）"><label><input type="checkbox" data-k="cc" ${r.cc?'checked':''}>副本</label><button type="button" class="secondary" data-del="${i}" title="移除">✕</button></div>`).join(''):'<div class="ll-muted">尚未加入收件人。</div>';
      rcpBox.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener(inp.type==='checkbox'?'change':'input',()=>{const r=L.recipients[Number(inp.closest('[data-i]').dataset.i)];r[inp.dataset.k]=inp.type==='checkbox'?inp.checked:inp.value;paint();}));
      rcpBox.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{L.recipients.splice(Number(b.dataset.del),1);drawRcps();paint();});
      if(locked)rcpBox.querySelectorAll('input,button').forEach(i=>i.disabled=true);
    }
    function paint(){
      const lay=layout(L.body);if(page>=lay.pages)page=lay.pages-1;
      const main=L.recipients.filter(r=>!r.cc).length,cc=L.recipients.length-main,copies=L.recipients.length+2;
      q('#llCount').innerHTML=`目前 <b>${lay.lines.length}</b> 行、共 <b>${lay.pages}</b> 頁｜需準備 <b>${copies}</b> 份（收件人 ${main}${cc?`＋副本收件人 ${cc}`:''}＋郵局與寄件人各 1）`;
      q('#llPg').textContent=`第 ${page+1}／${lay.pages} 頁`;
      q('#llPaper').innerHTML=`<div class="ll-paper"><div class="pt">郵局存證信函用紙</div><div class="pp">一、寄件人：${esc(senderName(L.sender))||'<span class="ll-muted">（未填）</span>'}<br>　　地址：${esc(L.sender.address)||'<span class="ll-muted">（未填）</span>'}${L.recipients.map(r=>`<br>${r.cc?'三、副本收件人':'二、收件人'}：${esc(r.name)}<br>　　地址：${esc(r.address)}`).join('')}</div>${gridHtml(lay.lines.slice(page*10,page*10+10),'ll-grid')}</div>`;
    }
    F.querySelectorAll('[data-f]').forEach(i=>i.addEventListener('input',()=>{L[i.dataset.f]=i.value;if(i.dataset.f==='body')paint();}));
    F.querySelectorAll('[data-s]').forEach(i=>i.addEventListener('input',()=>{L.sender[i.dataset.s]=i.value;paint();}));
    q('#llEnt')?.addEventListener('change',e=>{const en=d.entities.find(x=>String(x.id)===e.target.value);if(!en)return;Object.assign(L.sender,{kind:'company',entity_id:en.id,org:en.name,rep_title:L.sender.rep_title||'負責人',rep:en.owner||'',address:en.address||''});F.querySelector('[data-s=org]').value=L.sender.org;F.querySelector('[data-s=rep]').value=L.sender.rep;F.querySelector('[data-s=address]').value=L.sender.address;paint();});
    q('#llAdd').onclick=()=>{if(L.recipients.length>=12){alert('收件人最多 12 位');return;}L.recipients.push({name:'',address:'',cc:false});drawRcps();paint();rcpBox.querySelector(`[data-i="${L.recipients.length-1}"] input`)?.focus();};
    q('#llPick')?.addEventListener('click',()=>pickResidents(d.community,list=>{for(const r of list){if(L.recipients.length>=12)break;if(!L.recipients.some(x=>x.name===r.name&&x.address===r.address))L.recipients.push(r);}drawRcps();paint();}));
    q('#llTpl').onchange=e=>{const t=TEMPLATES.find(x=>x.id===e.target.value);e.target.value='';if(!t)return;if(L.body.trim()&&!confirm('套用範本會取代目前的內容，確定嗎？'))return;const r0=L.recipients.find(x=>!x.cc)||{};const unit=r0.unit||'○○○';const fill=s=>s.replace(/\{戶別\}/g,unit).replace(/\{收件人\}/g,r0.name||'○○○').replace(/\{寄件人\}/g,L.sender.org||'');L.body=fill(t.body);if(!L.title.trim())L.title=fill(t.title);F.querySelector('[data-f=body]').value=L.body;F.querySelector('[data-f=title]').value=L.title;paint();};
    q('#llPrev').onclick=()=>{if(page>0){page--;paint();}};q('#llNext').onclick=()=>{if(page<layout(L.body).pages-1){page++;paint();}};
    q('#llBack').onclick=back;
    const payload=()=>({title:L.title,sender:L.sender,recipients:L.recipients.map(r=>({...r,name:String(r.name||'').trim(),address:String(r.address||'').trim()})),body:L.body});
    async function save(silent){const x=L.id?await api(`${base}/legal-letters/${L.id}`,J('PUT',payload())):await api(`${base}/legal-letters`,J('POST',payload()));Object.assign(L,x.letter);if(!silent)editor(ctx,x.letter);return x.letter;}
    q('#llSave')?.addEventListener('click',async()=>{try{await save();}catch(e){alert(e.message);}});
    q('#llPrint').onclick=async()=>{try{if(!locked)await save(true);const x=await api(`${base}/legal-letters/${L.id}/print`,J('POST',{}));printLetter(x.letter);editor(ctx,x.letter);}catch(e){alert(e.message);}};
    q('#llSent')?.addEventListener('click',()=>locked?undoSent():sentDialog());
    q('#llDel')?.addEventListener('click',async()=>{if(!confirm('刪除這份草稿？'))return;try{await api(`${base}/legal-letters/${L.id}`,{method:'DELETE'});back();}catch(e){alert(e.message);}});
    async function undoSent(){const reason=prompt('取消寄出登記的原因（例如：登記錯誤）');if(reason===null)return;try{const x=await api(`${base}/legal-letters/${L.id}/sent`,J('POST',{undo:true,reason}));editor(ctx,x.letter);}catch(e){alert(e.message);}}
    function sentDialog(){
      const m=modal('📮 登記已寄出',`<label class="ll-form" style="display:grid;gap:8px"><span>寄出日期<input type="date" id="sdD" value="${todayTW()}"></span><span>郵局存證號碼（郵局收據上的「存證信函第○號」）<input id="sdN" maxlength="40" placeholder="例如：臺北○○郵局 第 123 號"></span><span>備註（掛號號碼等）<input id="sdR" maxlength="300"></span></label><div class="ll-actions"><button type="button" id="sdOk">確認登記</button></div>`);
      m.querySelector('#sdOk').onclick=async()=>{try{const x=await api(`${base}/legal-letters/${L.id}/sent`,J('POST',{sent_date:m.querySelector('#sdD').value,post_no:m.querySelector('#sdN').value,note:m.querySelector('#sdR').value}));m.close();editor(ctx,x.letter);}catch(e){alert(e.message);}};
    }
    drawRcps();paint();
  }
  const senderName=s=>[s.org,(s.rep?`${s.rep_title?s.rep_title+'　':''}${s.rep}`:'')].filter(Boolean).join('　');
  function gridHtml(lines,cls){
    let h=`<table class="${cls}"><tr><th class="rh">行</th>${Array.from({length:20},(_,i)=>`<th>${i+1}</th>`).join('')}</tr>`;
    for(let r=0;r<10;r++){const cs=[...(lines[r]||'')];h+=`<tr><th class="rh">${NUM[r]}</th>${Array.from({length:20},(_,i)=>`<td>${esc(cs[i]||'')}</td>`).join('')}</tr>`;}
    return h+'</table>';
  }
  function modal(title,html){
    const bg=document.createElement('div');bg.className='ll-modal-bg';bg.innerHTML=`<div class="ll-modal" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button type="button" class="secondary" data-x>關閉</button></header><div class="body">${html}</div></div>`;
    document.body.appendChild(bg);bg.close=()=>bg.remove();bg.querySelector('[data-x]').onclick=bg.close;bg.addEventListener('click',e=>{if(e.target===bg)bg.close();});return bg;
  }

  // 從住戶名冊挑選（沿用住戶名冊的權限與使用須知）
  function pickResidents(community,done){
    const CATS=[['residents-owners','區分所有權人'],['residents-tenants','承租人'],['residents-contact','住戶聯繫表']];let cat='residents-owners',rows=[],kw='';
    const m=modal('從住戶名冊挑選收件人','<div class="ll-bar" id="pkTabs"></div><input id="pkQ" placeholder="搜尋戶別或姓名" style="margin:0;padding:8px 10px;border:1px solid #D8CECB;border-radius:8px"><div id="pkList" style="display:grid;gap:6px"></div><div class="ll-actions"><button type="button" id="pkOk">加入勾選的收件人</button></div>');
    const draw=()=>{m.querySelector('#pkTabs').innerHTML=CATS.map(([k,t])=>`<button type="button" class="${k===cat?'':'secondary'}" data-c="${k}" style="padding:6px 12px;min-height:0">${t}</button>`).join('');m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{cat=b.dataset.c;load();});
      const list=rows.filter(r=>!kw||`${r.building}${r.unit}${r.name}`.includes(kw));
      m.querySelector('#pkList').innerHTML=list.length?list.map(r=>`<label class="ll-pick"><input type="checkbox" data-r="${rows.indexOf(r)}"><span><b>${esc(r.unit_label||r.unit)}</b>　${esc(r.name||'（未填姓名）')}<br><span class="ll-muted">${esc(r.address||'（沒有門牌地址，加入後請補上）')}</span></span></label>`).join(''):'<div class="ll-muted">沒有資料。</div>';};
    async function load(){m.querySelector('#pkList').innerHTML='<div class="ll-muted">載入中…</div>';try{const x=await api(`/api/staff/residents?category=${cat}`);if(x.ack_required){rows=[];m.querySelector('#pkList').innerHTML='<div class="ll-tip">請先到「住戶名冊」閱讀並同意使用須知，才能挑選住戶。</div>';return;}rows=(x.records||[]).filter(r=>r.status!=='ended').map(r=>({...r,unit_label:[r.building,r.unit].filter(Boolean).join(' ')}));}catch(e){rows=[];m.querySelector('#pkList').innerHTML=`<div class="ll-tip">${esc(e.message)}</div>`;return;}draw();}
    m.querySelector('#pkQ').oninput=e=>{kw=e.target.value.trim();draw();};
    m.querySelector('#pkOk').onclick=()=>{const out=[];m.querySelectorAll('[data-r]:checked').forEach(c=>{const r=rows[Number(c.dataset.r)];for(const n of String(r.name||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean))out.push({name:n,address:r.address||'',cc:false,unit:r.unit_label||r.unit||'',source:cat});});if(!out.length){alert('請勾選收件人');return;}m.close();done(out);};
    load();
  }

  // ---------- 列印（A4，依份數重複整份） ----------
  function printLetter(L){
    const lay=layout(L.body);const copies=L.recipients.length+2;const N=lay.pages;
    const party=(label,list)=>`<tr><th class="pl" rowspan="${Math.max(1,list.length)*2}">${label}</th>${list.length?list.map((r,i)=>`${i?'<tr>':''}<td class="k">姓名：</td><td class="v">${esc(r.name)}${label.includes('寄件人')?'<span class="seal">印</span>':''}</td></tr><tr><td class="k">詳細地址：</td><td class="v">${esc(r.address)}</td></tr>`).join(''):'<td class="k">姓名：</td><td class="v"></td></tr><tr><td class="k">詳細地址：</td><td class="v"></td></tr>'}`;
    const sender=[{name:senderName(L.sender),address:L.sender.address}];
    const main=L.recipients.filter(r=>!r.cc),cc=L.recipients.filter(r=>r.cc);
    const pageHtml=(p,copy)=>`<section class="pg"><div class="side">${copy===0?'正<br>本':'副<br>本'}</div><div class="top"><span>存證信函第＿＿＿＿＿號</span><h1>郵局存證信函用紙</h1><span class="pn">第 ${p+1} 頁／共 ${N} 頁</span></div>
      <div class="note">〈寄件人如為機關、團體、學校、公司、商號請加蓋單位圖章及法定代理人簽名或蓋章〉</div>
      <table class="parties">${party('一、寄件人',sender)}${party('二、收件人',main)}${party('三、副本收件人',cc)}</table>
      <div class="note r">（本欄姓名、地址不敷填寫時，請另紙聯記）</div>
      ${gridHtml(lay.lines.slice(p*10,p*10+10),'grid')}
      <div class="foot"><div class="fee">本存證信函共 <u>${N}</u> 頁，正本＿＿份，存證費＿＿元，副本＿＿份，存證費＿＿元，附件＿＿張，存證費＿＿元，加具正本＿＿份，存證費＿＿元，加具副本＿＿份，存證費＿＿元，合計＿＿元。</div>
      <div class="cert"><div>經　　　　　　郵局<br>　　年　　月　　日證明正本內容完全相同</div><div>郵戳</div><div>經辦員<br><br>主　管</div><div class="stamp">郵票或郵資券<br>黏貼處</div></div>
      <div class="memo">備註：<br>一、存證信函需送交郵局辦理證明手續後始有效，自交寄之日起由郵局保存之副本，於三年期滿後銷燬之。<br>二、在＿＿頁＿＿行第＿＿格下塗改增刪＿＿字　印（如有修改應填註本欄並蓋用寄件人印章，但塗改增刪每頁至多不得逾二十字）。<br>三、每件一式三份，用不脫色筆或打字機複寫，或書寫後複印、影印，每格限書一字，色澤明顯、字跡端正。</div></div>
      <div class="seam">騎縫郵戳</div></section>`;
    let body='';for(let c=0;c<copies;c++)for(let p=0;p<N;p++)body+=pageHtml(p,c);
    const CSS=`@page{size:A4;margin:9mm 10mm}body{margin:0;font-family:'Noto Serif TC','Noto Sans TC','PMingLiU','Microsoft JhengHei',serif;color:#111}.pg{position:relative;page-break-after:always;padding-left:9mm;min-height:270mm;box-sizing:border-box}.pg:last-child{page-break-after:auto}
.side{position:absolute;left:0;top:70mm;width:7mm;border:1px solid #333;text-align:center;font-size:12pt;line-height:1.5;padding:3mm 0}
.top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:2mm}.top h1{font-size:17pt;letter-spacing:.35em;margin:0}.top span{font-size:9.5pt}.pn{color:#555}
.note{font-size:8.5pt;margin:1mm 0}.note.r{text-align:right}
table{border-collapse:collapse;width:100%}.parties td,.parties th{border:1px solid #333;padding:1.3mm 2mm;font-size:10.5pt;text-align:left;vertical-align:middle}.parties th.pl{width:24mm;font-weight:400}.parties td.k{width:20mm;white-space:nowrap}.seal{float:right;color:#999;font-size:9pt;border:1px dashed #aaa;padding:0 2mm}
.grid{table-layout:fixed;margin-top:2mm}.grid td,.grid th{border:1px solid #333;text-align:center;padding:0;height:8.6mm;font-size:14pt}.grid th{height:4.5mm;font-size:7.5pt;font-weight:400}.grid th.rh{width:7mm}
.foot{font-size:9pt;margin-top:2mm}.fee{line-height:1.7}.cert{display:grid;grid-template-columns:1.6fr .6fr .8fr 1fr;border:1px solid #333;margin-top:2mm}.cert div{border-right:1px solid #333;padding:2mm;min-height:17mm;line-height:1.6}.cert div:last-child{border-right:0}.stamp{text-align:center;color:#555}
.memo{margin-top:2mm;line-height:1.55;font-size:8.3pt}.seam{position:absolute;left:1mm;top:150mm;font-size:7.5pt;color:#777;writing-mode:vertical-rl;letter-spacing:.2em}`;
    const w=window.open('','_blank');if(!w){alert('瀏覽器擋住了列印視窗，請允許彈出視窗後再試一次');return;}
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>存證信函 ${esc(L.title||'')}</title><style>${CSS}</style></head><body>${body}</body></html>`);w.document.close();setTimeout(()=>w.print(),400);
  }

  window.LegalLetterModule={render,layout,printLetter};
})();
