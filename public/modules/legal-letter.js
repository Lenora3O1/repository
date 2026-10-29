// 存證信函：照郵局存證信函用紙（每頁 10 行 × 20 格、每格一字）自動排版。
// 現場人員只要打內容；寄件人（社區管委會／公司）自動帶入，收件人可從住戶名冊挑選或手動輸入。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,o={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const ST={draft:['草稿','ll-st-draft'],printed:['已列印','ll-st-print'],sent:['已寄出','ll-st-sent']};
  const NUM='一二三四五六七八九十';
  // 字型：電腦有「標楷體」就用標楷體（Windows：DFKai-SB；Mac：BiauKai），沒有的裝置用楷書網路字型（霞鶩文楷 TC）
  const KAI="'標楷體','DFKai-SB','BiauKai','TW-Kai','Kaiti TC','STKaiti','LXGW WenKai TC',serif";
  const KAI_LINK='<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&display=swap">';
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
.ll-grid{border-collapse:collapse;width:100%;min-width:0!important;table-layout:fixed;background:#fff}.ll-grid td,.ll-grid th{border:1px solid #c9b9b3;text-align:center;padding:0;height:28px;font-size:15px;font-family:${KAI}}.ll-grid th{font-size:10px;color:#8a7a74;font-weight:400;height:16px;background:#faf7f5}.ll-grid th.rh{width:22px}
.ll-paper{border:1px solid #d8ccc7;border-radius:6px;padding:10px;background:#fffefc}.ll-paper .pt{text-align:center;font-weight:800;letter-spacing:.3em;margin-bottom:6px;color:#4E322D}.ll-paper .pp{font-size:.82rem;line-height:1.6;margin-bottom:8px;color:#4E322D}
.ll-modal-bg{position:fixed;inset:0;background:rgba(40,25,20,.42);z-index:3000;display:flex;align-items:center;justify-content:center;padding:14px}.ll-modal{background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}.ll-modal header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #EFE6E2}.ll-modal header h3{flex:1;margin:0}.ll-modal header button{margin:0}.ll-modal .body{padding:12px 16px;overflow:auto;display:grid;gap:8px}
.ll-pick{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start;border:1px solid #EFE6E2;border-radius:10px;padding:8px 10px;cursor:pointer}.ll-pick input{margin-top:4px;width:auto}
.ll-log{font-size:.84rem;display:grid;gap:3px}.ll-log div{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px dashed #EFE6E2;padding:3px 0}

.ll-kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.ll-kind{display:grid;gap:6px;text-align:left;border:1px solid #E2D3CC;border-radius:14px;padding:16px 18px;background:#fff;font:inherit;color:#4E322D;cursor:pointer;margin:0}.ll-kind:hover{border-color:#A44528;background:#FFFBF8}.ll-kind span{font-size:1.8rem}.ll-kind b{font-size:1.1rem}.ll-kind small{color:#7A5F58;line-height:1.6}
.ll-kbadge{padding:3px 10px;border-radius:999px;background:#FBEAE3;color:#A44528;font-weight:700;font-size:.85rem}
.ll-box{display:grid;gap:10px}.ll-box-h{display:flex;align-items:center;gap:8px}.ll-box-h h3{flex:1}.ll-box-h button,.ll-box-h select{margin:0;width:auto;padding:5px 10px;min-height:0;font-size:.85rem}
.ll-rl{display:grid;gap:6px}.ll-ri{display:flex;gap:8px;align-items:center;border:1px solid #EFE6E2;border-radius:10px;padding:8px 10px;background:#FDFCFB}.ll-ri>div{flex:1;min-width:0;word-break:break-word}.ll-ri button{margin:0;padding:4px 10px;min-height:0}
.ll-tag{display:inline-block;padding:1px 7px;border-radius:999px;background:#F1EEEC;color:#6f625e;font-size:.75rem;font-weight:700}.ll-tag.warn{background:#fff4dc;color:#8a5a00}
.ll-ask{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#FBF8F5;border-radius:10px;padding:10px 12px}.ll-ask span{font-weight:700;flex-basis:100%}.ll-ask button{margin:0}
.ll-mf{display:grid;gap:10px}.ll-mf label{display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0}.ll-mf input,.ll-mf select,.ll-in{margin:0;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;font:inherit;background:#fff;width:100%;box-sizing:border-box}
.ll-plist{display:grid;gap:6px}.ll-pu{display:grid;gap:3px;text-align:left;border:1px solid #EFE6E2;border-radius:10px;padding:9px 12px;background:#fff;font:inherit;color:inherit;cursor:pointer;margin:0}.ll-pu:hover{border-color:#A44528}
`;document.head.appendChild(s);if(!document.getElementById('llFont')){const l=document.createElement('link');l.id='llFont';l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&display=swap';document.head.appendChild(l);}}

  // ---------- 列表 ----------
  async function render(host,opt={}){
    css();const base=opt.base||'/api/staff',label=opt.label||'存證信函';const st=host._llf||(host._llf={q:'',status:''});
    host.innerHTML='<div class="ll-muted">載入存證信函…</div>';
    let d;try{d=await api(`${base}/legal-letters?q=${encodeURIComponent(st.q)}&status=${st.status}`);}catch(e){host.innerHTML=`<div class="ll"><div class="ll-head"><h2>${esc(label)}</h2></div><div class="ll-tip">${esc(e.message)}</div></div>`;return;}
    const ctx={base,label,host,d};
    host.innerHTML=`<div class="ll"><div class="ll-head"><h2>${esc(label)}</h2><button type="button" id="llNew">＋ 寫一封存證信函</button></div>
      <div class="ll-tip">📮 照郵局「存證信函用紙」格式自動排版（每頁 10 行、每行 20 格，一格一字）。${d.scope==='site'?`寄件人預設為「${esc(d.community?.name||'')}管理委員會」，收件人可以直接從住戶名冊挑選。`:'寄件人預設為公司資料中的公司名稱、負責人與地址。'}列印後到郵局辦理存證，回來再「登記已寄出」並填上存證號碼。</div>
      <div class="ll-bar"><select id="llSt"><option value="">全部</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}" ${k===st.status?'selected':''}>${v[0]}</option>`).join('')}</select><input id="llQ" value="${esc(st.q)}" placeholder="搜尋標題、收件人、內容"><button type="button" class="secondary" id="llFind">搜尋</button></div>
      <div class="ll-list">${d.rows.length?d.rows.map(r=>`<button type="button" class="ll-item" data-id="${r.id}"><div class="ll-item-top"><b>${r.kind==='fee'?'💰 ':''}${esc(r.title||'（未命名）')}</b><span class="ll-st ${ST[r.status][1]}">${ST[r.status][0]}</span></div><div>收件人：${esc(r.recipients.filter(x=>!x.cc).map(x=>x.name).join('、')||'—')}${r.recipients.some(x=>x.cc)?`　副本：${esc(r.recipients.filter(x=>x.cc).map(x=>x.name).join('、'))}`:''}</div><div class="ll-muted">${r.pages} 頁｜${esc(r.created_by)} 建立於 ${esc(tw(r.created_at))}${r.sent_date?`｜${esc(r.sent_date)} 寄出${r.post_no?`（存證號碼 ${esc(r.post_no)}）`:''}`:''}</div></button>`).join(''):'<div class="ll-muted">目前還沒有存證信函。</div>'}</div></div>`;
    const re=()=>render(host,opt);
    host.querySelector('#llNew').onclick=()=>chooseKind(ctx);
    host.querySelector('#llSt').onchange=e=>{st.status=e.target.value;re();};
    host.querySelector('#llFind').onclick=()=>{st.q=host.querySelector('#llQ').value.trim();re();};
    host.querySelector('#llQ').onkeydown=e=>{if(e.key==='Enter'){st.q=e.target.value.trim();re();}};
    host.querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{try{const x=await api(`${base}/legal-letters/${b.dataset.id}`);editor(ctx,x.letter);}catch(e){alert(e.message);}});
  }

  // ---------- 新信件：先選類型 ----------
  function chooseKind(ctx){
    const {host,d}=ctx;
    if(d.scope!=='site')return editor(ctx,null,'other');
    host.innerHTML=`<div class="ll"><div class="ll-head"><button type="button" class="secondary" id="llBack">← 返回列表</button><h2>寫一封存證信函</h2></div>
      <div class="ll-tip">請先選擇信件類型。</div>
      <div class="ll-kinds"><button type="button" class="ll-kind" data-k="fee"><span>💰</span><b>管理費催繳</b><small>收件人從「區分所有權人」挑選，地址自動帶入（出租中的戶別帶所有權人戶籍地址），內容套用催繳範本。</small></button>
      <button type="button" class="ll-kind" data-k="other"><span>📝</span><b>其他</b><small>違反規約、配合修繕、廠商履約等。收件人可以選簽約廠商自動帶入，或手動輸入。</small></button></div></div>`;
    host.querySelector('#llBack').onclick=()=>render(host,{base:ctx.base,label:ctx.label});
    host.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>editor(ctx,null,b.dataset.k));
  }

  // ---------- 編輯（一頁由上往下：寄件人 → 收件人 → 副本收件人 → 內容） ----------
  function editor(ctx,letter,newKind){
    const {base,host,d}=ctx;const site=d.scope==='site';
    const L=letter?JSON.parse(JSON.stringify(letter)):{id:null,kind:newKind||'other',title:'',sender:{...d.default_sender},recipients:[],body:'',status:'draft'};
    if(!letter&&L.kind==='fee'){const t=TEMPLATES.find(x=>x.id==='fee');L.body=t.body.replace(/\{戶別\}/g,'○○○');L.title='○○○ 催繳管理費';}
    const fee=L.kind==='fee';const locked=L.status==='sent';let page=0;
    const back=()=>render(host,{base,label:ctx.label});
    const kindLabel=fee?'💰 管理費催繳':site?'📝 其他':'📝 公司存證信函';
    host.innerHTML=`<div class="ll"><div class="ll-head"><button type="button" class="secondary" id="llBack">← 返回列表</button><h2>${L.id?esc(L.title||'存證信函'):'寫一封存證信函'}</h2><span class="ll-kbadge">${kindLabel}</span>${L.id?`<span class="ll-st ${ST[L.status][1]}">${ST[L.status][0]}</span>`:''}</div>
      ${locked?`<div class="ll-tip">這封信已於 ${esc(L.sent_date)} 寄出${L.post_no?`（存證號碼 ${esc(L.post_no)}）`:''}，內容已鎖定；如需更正請另寫一封。</div>`:''}
      <div class="ll-edit"><div class="ll-form" id="llForm">
        <div class="ll-card ll-box"><div class="ll-box-h"><h3>寄件人資訊</h3>${locked?'':'<button type="button" class="secondary" id="llSnd">編輯</button>'}</div><div id="llSender"></div><div class="ll-muted">寄件人是管委會或公司時，印出後請蓋「單位圖章」及「代表人印章」。</div></div>
        <div class="ll-card ll-box"><div class="ll-box-h"><h3>收件人資訊</h3></div>
          ${locked?'':fee?`<div class="ll-actions"><button type="button" id="llOwn">＋ 從區分所有權人選擇</button><button type="button" class="secondary" data-man="0">＋ 手動新增</button></div>`
            :`<div class="ll-ask"><span>收件人是目前的${site?'簽約廠商':'往來廠商'}嗎？</span><button type="button" id="llVen">是，從${site?'簽約廠商':'廠商'}選擇</button><button type="button" class="secondary" data-man="0">否，手動輸入</button></div>`}
          <div class="ll-rl" id="llMain"></div></div>
        <div class="ll-card ll-box"><div class="ll-box-h"><h3>副本收件人資訊</h3>${locked?'':'<button type="button" class="secondary" data-man="1">＋ 新增副本收件人</button>'}</div><div class="ll-rl" id="llCc"></div></div>
        <div class="ll-card ll-box"><div class="ll-box-h"><h3>信函內容</h3>${locked?'':`<select id="llTpl"><option value="">套用範本…</option>${TEMPLATES.filter(t=>t.scope==='all'||t.scope===d.scope).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`}</div>
          <label>標題（內部辨識用，不會印出）<input data-f="title" maxlength="60" value="${esc(L.title)}" placeholder="例如：3A2 催繳管理費"></label>
          <label>請輸入信函內容：<textarea data-f="body" maxlength="20000" placeholder="直接打內容即可，系統會自動排成每行 20 字。段落開頭可以空兩格（　　）。">${esc(L.body)}</textarea></label>
          <div class="ll-count" id="llCount"></div>
          <div class="ll-muted">範本僅供參考，請依實際情況修改（○ 的地方要填寫）；涉及訴訟或金額較大時，建議先請律師確認內容。</div>
          <div class="ll-actions">${locked?'':`<button type="button" class="secondary" id="llClr">清除內文</button><button type="button" class="secondary" id="llSave">💾 儲存草稿</button>`}<button type="button" id="llPrint">📮 產生存證信函（列印／PDF）</button>${L.id&&L.status!=='draft'?`<button type="button" class="secondary" id="llSent">${locked?'取消寄出登記':'登記已寄出'}</button>`:''}${L.id&&L.status==='draft'?'<button type="button" class="secondary" id="llDel" style="color:#a33131">刪除草稿</button>':''}</div>
        </div>
        ${L.logs?.length?`<div class="ll-card"><h3>紀錄</h3><div class="ll-log">${L.logs.map(x=>`<div><span class="ll-muted">${esc(tw(x.created_at))}</span><b>${esc(x.actor)}</b><span>${esc(x.label)}</span><span class="ll-muted">${esc(x.note||'')}</span></div>`).join('')}</div></div>`:''}
      </div>
      <div class="ll-card ll-pv"><div class="ll-pv-nav"><b style="flex:1">預覽</b><button type="button" class="secondary" id="llPrev">‹</button><span id="llPg"></span><button type="button" class="secondary" id="llNext">›</button></div><div id="llPaper"></div></div></div></div>`;
    const F=host.querySelector('#llForm');const q=s=>host.querySelector(s);
    if(locked)F.querySelectorAll('input,textarea,select').forEach(i=>i.disabled=true);
    function drawSender(){const S=L.sender;q('#llSender').innerHTML=`<div class="ll-ri"><div><b>${esc(senderName(S))||'<span class="ll-muted">（尚未填寫）</span>'}</b><div class="ll-muted">${esc(S.address)||'（尚未填寫地址）'}</div></div></div>`;}
    function drawRcps(){
      for(const [sel,cc] of [['#llMain',false],['#llCc',true]]){
        const list=L.recipients.map((r,i)=>({r,i})).filter(x=>!!x.r.cc===cc);
        q(sel).innerHTML=list.length?list.map(({r,i})=>`<div class="ll-ri"><div><b>${esc(r.name)}</b>${r.unit?` <span class="ll-tag">${esc(r.unit)}</span>`:''}${r.source==='vendor'?' <span class="ll-tag">簽約廠商</span>':''}${r.note?` <span class="ll-tag warn">${esc(r.note)}</span>`:''}<div class="ll-muted">${esc(r.address)||'<span style="color:#a33131">⚠ 尚未填寫地址</span>'}</div></div>${locked?'':`<button type="button" class="secondary" data-ed="${i}">編輯</button><button type="button" class="secondary" data-rm="${i}">✕</button>`}</div>`).join(''):`<div class="ll-muted">${cc?'沒有副本收件人（可省略）。':'尚未加入收件人。'}</div>`;
      }
      host.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{L.recipients.splice(Number(b.dataset.rm),1);drawRcps();paint();});
      host.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>addrDialog(L.recipients[Number(b.dataset.ed)],v=>{Object.assign(L.recipients[Number(b.dataset.ed)],v);drawRcps();paint();}));
    }
    function paint(){
      const lay=layout(L.body);if(page>=lay.pages)page=lay.pages-1;
      const main=L.recipients.filter(r=>!r.cc).length,cc=L.recipients.length-main,copies=L.recipients.length+2;
      q('#llCount').innerHTML=`目前 <b>${lay.lines.length}</b> 行、共 <b>${lay.pages}</b> 頁｜需準備 <b>${copies}</b> 份（收件人 ${main}${cc?`＋副本收件人 ${cc}`:''}＋郵局與寄件人各 1）`;
      q('#llPg').textContent=`第 ${page+1}／${lay.pages} 頁`;
      q('#llPaper').innerHTML=`<div class="ll-paper"><div class="pt">郵局存證信函用紙</div><div class="pp">一、寄件人：${esc(senderName(L.sender))||'<span class="ll-muted">（未填）</span>'}<br>　　地址：${esc(L.sender.address)||'<span class="ll-muted">（未填）</span>'}${L.recipients.map(r=>`<br>${r.cc?'三、副本收件人':'二、收件人'}：${esc(r.name)}<br>　　地址：${esc(r.address)}`).join('')}</div>${gridHtml(lay.lines.slice(page*10,page*10+10),'ll-grid')}</div>`;
    }
    const addRcps=list=>{for(const r of list){if(L.recipients.length>=12){alert('收件人（含副本）最多 12 位');break;}if(!L.recipients.some(x=>x.name===r.name&&x.address===r.address&&!!x.cc===!!r.cc))L.recipients.push(r);}drawRcps();paint();};
    F.querySelectorAll('[data-f]').forEach(i=>i.addEventListener('input',()=>{L[i.dataset.f]=i.value;if(i.dataset.f==='body')paint();}));
    q('#llSnd')?.addEventListener('click',()=>senderDialog(L.sender,d,v=>{Object.assign(L.sender,v);drawSender();paint();}));
    host.querySelectorAll('[data-man]').forEach(b=>b.onclick=()=>addrDialog({cc:b.dataset.man==='1'},v=>addRcps([{...v,cc:b.dataset.man==='1',source:'manual'}])));
    q('#llOwn')?.addEventListener('click',()=>pickOwners(base,list=>{
      L.recipients=L.recipients.filter(r=>r.cc||r.source!=='owner');addRcps(list);
      const unit=list[0]?.unit||'';if(unit){const rpl=v=>v.replace(/○○○(?=之區分所有權人| 催繳管理費)/g,unit);L.body=rpl(L.body);L.title=rpl(L.title);F.querySelector('[data-f=body]').value=L.body;F.querySelector('[data-f=title]').value=L.title;paint();}
    }));
    q('#llVen')?.addEventListener('click',()=>pickVendors(base,site,list=>addRcps(list)));
    q('#llTpl')?.addEventListener('change',e=>{const t=TEMPLATES.find(x=>x.id===e.target.value);e.target.value='';if(!t)return;if(L.body.trim()&&!confirm('套用範本會取代目前的內容，確定嗎？'))return;const r0=L.recipients.find(x=>!x.cc)||{};const unit=r0.unit||'○○○';const fill=s=>s.replace(/\{戶別\}/g,unit).replace(/\{收件人\}/g,r0.name||'○○○').replace(/\{寄件人\}/g,L.sender.org||'');L.body=fill(t.body);if(!L.title.trim()||/○○○/.test(L.title))L.title=fill(t.title);F.querySelector('[data-f=body]').value=L.body;F.querySelector('[data-f=title]').value=L.title;paint();});
    q('#llClr')?.addEventListener('click',()=>{if(L.body.trim()&&!confirm('清除全部內文？'))return;L.body='';F.querySelector('[data-f=body]').value='';paint();});
    q('#llPrev').onclick=()=>{if(page>0){page--;paint();}};q('#llNext').onclick=()=>{if(page<layout(L.body).pages-1){page++;paint();}};
    q('#llBack').onclick=back;
    const payload=()=>({kind:L.kind,title:L.title,sender:L.sender,recipients:L.recipients.map(r=>({...r,name:String(r.name||'').trim(),address:String(r.address||'').trim()})),body:L.body});
    async function save(silent){const x=L.id?await api(`${base}/legal-letters/${L.id}`,J('PUT',payload())):await api(`${base}/legal-letters`,J('POST',payload()));Object.assign(L,x.letter);if(!silent)editor(ctx,x.letter);return x.letter;}
    q('#llSave')?.addEventListener('click',async()=>{try{await save();}catch(e){alert(e.message);}});
    q('#llPrint').onclick=async()=>{const w=window.open('','_blank');try{if(!locked)await save(true);const x=await api(`${base}/legal-letters/${L.id}/print`,J('POST',{}));printLetter(x.letter,w);editor(ctx,x.letter);}catch(e){try{w&&w.close();}catch{}alert(e.message);}};
    q('#llSent')?.addEventListener('click',()=>locked?undoSent():sentDialog());
    q('#llDel')?.addEventListener('click',async()=>{if(!confirm('刪除這份草稿？'))return;try{await api(`${base}/legal-letters/${L.id}`,{method:'DELETE'});back();}catch(e){alert(e.message);}});
    async function undoSent(){const reason=prompt('取消寄出登記的原因（例如：登記錯誤）');if(reason===null)return;try{const x=await api(`${base}/legal-letters/${L.id}/sent`,J('POST',{undo:true,reason}));editor(ctx,x.letter);}catch(e){alert(e.message);}}
    function sentDialog(){
      const m=modal('登記已寄出',`<div class="ll-mf"><label>寄出日期<input type="date" id="sdD" value="${todayTW()}"></label><label>郵局存證號碼（郵局收據上的「存證信函第○號」）<input id="sdN" maxlength="40" placeholder="例如：臺北○○郵局 第 123 號"></label><label>備註（掛號號碼等）<input id="sdR" maxlength="300"></label></div><div class="ll-actions"><button type="button" id="sdOk">確認登記</button></div>`);
      m.querySelector('#sdOk').onclick=async()=>{try{const x=await api(`${base}/legal-letters/${L.id}/sent`,J('POST',{sent_date:m.querySelector('#sdD').value,post_no:m.querySelector('#sdN').value,note:m.querySelector('#sdR').value}));m.close();editor(ctx,x.letter);}catch(e){alert(e.message);}};
    }
    drawSender();drawRcps();paint();
  }
  const senderName=s=>[s.org,(s.rep?`${s.rep_title?s.rep_title+'　':''}${s.rep}`:'')].filter(Boolean).join('　');
  function gridHtml(lines,cls){
    let h=`<table class="${cls}"><tr><th class="rh">行</th>${Array.from({length:20},(_,i)=>`<th>${i+1}</th>`).join('')}</tr>`;
    for(let r=0;r<10;r++){const cs=[...(lines[r]||'')];h+=`<tr><th class="rh">${NUM[r]}</th>${Array.from({length:20},(_,i)=>`<td>${esc(cs[i]||'')}</td>`).join('')}</tr>`;}
    return h+'</table>';
  }
  function modal(title,html){
    const bg=document.createElement('div');bg.className='ll-modal-bg';bg.innerHTML=`<div class="ll-modal" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button type="button" class="secondary" data-x>關閉</button></header><div class="body">${html}</div></div>`;
    document.body.appendChild(bg);bg.close=()=>bg.remove();bg.querySelector('[data-x]').onclick=bg.close;bg.addEventListener('mousedown',e=>{if(e.target===bg)bg.close();});return bg;
  }
  // 新增地址資訊（姓名或單位名稱、地址）
  function addrDialog(cur,done){
    const m=modal(cur?.name?'編輯地址資訊':'新增地址資訊',`<div class="ll-mf"><label>姓名或單位名稱<input id="adN" maxlength="80" value="${esc(cur?.name||'')}" placeholder="個人填姓名；公司填全名，例如：○○股份有限公司　法定代理人　王○○"></label><label>地址<input id="adA" maxlength="120" value="${esc(cur?.address||'')}" placeholder="含郵遞區號，例如：100 臺北市中正區和平路 88 號"></label></div><div class="ll-actions"><button type="button" class="secondary" data-x2>關閉</button><button type="button" id="adOk">${cur?.name?'儲存':'新增'}</button></div>`);
    m.querySelector('[data-x2]').onclick=m.close;m.querySelector('#adN').focus();
    m.querySelector('#adOk').onclick=()=>{const name=m.querySelector('#adN').value.trim(),address=m.querySelector('#adA').value.trim();if(!name){alert('請填寫姓名或單位名稱');return;}if(!address){alert('請填寫地址');return;}m.close();done({name,address,note:''});};
  }
  function senderDialog(S,d,done){
    const ents=d.scope==='company'?d.entities||[]:[];
    const m=modal('寄件人資訊',`<div class="ll-mf">${ents.length>1?`<label>公司<select id="sdE">${ents.map(e=>`<option value="${e.id}" ${e.id===S.entity_id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>`:''}<label>寄件人名稱<input id="sO" maxlength="80" value="${esc(S.org)}"></label><div class="ll-row"><label>代表人職稱<input id="sT" maxlength="20" value="${esc(S.rep_title)}" placeholder="${d.scope==='site'?'主任委員':'負責人'}"></label><label>代表人姓名<input id="sR" maxlength="40" value="${esc(S.rep)}" placeholder="例如：王大明"></label></div><label>詳細地址<input id="sA" maxlength="120" value="${esc(S.address)}" placeholder="含郵遞區號"></label></div><div class="ll-actions"><button type="button" id="sOk">確定</button></div>`);
    m.querySelector('#sdE')?.addEventListener('change',e=>{const en=ents.find(x=>String(x.id)===e.target.value);if(!en)return;m.querySelector('#sO').value=en.name;m.querySelector('#sR').value=en.owner||'';m.querySelector('#sA').value=en.address||'';});
    m.querySelector('#sOk').onclick=()=>{const en=m.querySelector('#sdE');m.close();done({org:m.querySelector('#sO').value.trim(),rep_title:m.querySelector('#sT').value.trim(),rep:m.querySelector('#sR').value.trim(),address:m.querySelector('#sA').value.trim(),...(en?{entity_id:Number(en.value),kind:'company'}:{})});};
  }

  // 管理費催繳：區分所有權人（一次選一戶；共有人一起帶入）
  async function pickOwners(base,done){
    const m=modal('從區分所有權人選擇','<input id="poQ" placeholder="搜尋戶別或姓名" class="ll-in"><div id="poL" class="ll-plist"><div class="ll-muted">載入中…</div></div>');
    let rows=[];
    try{const x=await api(`${base}/legal-letters/owners`);if(x.ack_required){m.querySelector('#poL').innerHTML='<div class="ll-tip">請先到「住戶名冊」閱讀並同意個資使用須知，才能挑選所有權人。</div>';return;}rows=x.rows||[];}catch(e){m.querySelector('#poL').innerHTML=`<div class="ll-tip">${esc(e.message)}</div>`;return;}
    const units=[];const by=new Map();for(const r of rows){const k=r.unit||r.unit_label;if(!by.has(k)){by.set(k,{unit:k,label:r.unit_label,rented:r.rented,people:[]});units.push(by.get(k));}by.get(k).people.push(r);}
    const draw=kw=>{const list=units.filter(u=>!kw||`${u.label}${u.people.map(p=>p.name).join('')}`.includes(kw));
      m.querySelector('#poL').innerHTML=list.length?list.map(u=>{const miss=u.people.some(p=>!p.address);return `<button type="button" class="ll-pu" data-u="${esc(u.unit)}"><div><b>${esc(u.label)}</b>　${esc(u.people.map(p=>p.name).join('、'))}${u.rented?' <span class="ll-tag">出租中</span>':''}</div><div class="ll-muted">${miss?'<span style="color:#a33131">⚠ 出租中但沒有登錄戶籍／通訊地址，選了之後請補上地址（或到區分所有權人名冊補登）</span>':`${u.rented?'寄戶籍／通訊地址：':'寄門牌地址：'}${esc(u.people[0].address)}`}</div></button>`;}).join(''):'<div class="ll-muted">沒有符合的所有權人。</div>';
      m.querySelectorAll('[data-u]').forEach(b=>b.onclick=()=>{const u=by.get(b.dataset.u);m.close();done(u.people.map(p=>({name:p.name,address:p.address,unit:u.unit,source:'owner',ref_id:p.record_id,cc:false,note:!p.address?'待補地址':(u.rented?'戶籍地址':'')})));});};
    m.querySelector('#poQ').oninput=e=>draw(e.target.value.trim());draw('');
  }
  // 其他：簽約廠商（可在這裡新增）
  async function pickVendors(base,site,done){
    const m=modal(site?'從簽約廠商選擇':'從廠商選擇','<div id="pvL" class="ll-plist"><div class="ll-muted">載入中…</div></div>');
    async function load(){
      let rows=[];try{const x=await api(site?'/api/staff/community-vendors?current=1':`${base}/legal-letters/vendors`);rows=x.rows||[];}catch(e){m.querySelector('#pvL').innerHTML=`<div class="ll-tip">${esc(e.message)}</div>`;return;}
      m.querySelector('#pvL').innerHTML=`${rows.length?rows.map(v=>`<button type="button" class="ll-pu" data-v="${v.id}"><div><b>${esc(v.name)}</b>${v.service?` <span class="ll-tag">${esc(v.service)}</span>`:''}${v.category_label?` <span class="ll-muted">${esc(v.category_label)}</span>`:''}</div><div class="ll-muted">${v.owner?`負責人 ${esc(v.owner)}｜`:''}${esc(v.address)||'<span style="color:#a33131">⚠ 沒有地址，選了之後請補上</span>'}${v.contract_end?`｜合約到 ${esc(v.contract_end)}`:''}</div></button>`).join(''):`<div class="ll-muted">${site?'目前還沒有登錄簽約中的廠商。':'公司應支裡還沒有廠商資料。'}</div>`}${site?'<button type="button" class="secondary" id="pvAdd">＋ 新增簽約廠商</button>':''}`;
      m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{const v=rows.find(x=>String(x.id)===b.dataset.v);m.close();done([{name:v.owner?`${v.name}　法定代理人　${v.owner}`:v.name,address:v.address||'',source:'vendor',ref_id:v.id,cc:false,note:v.address?'':'待補地址'}]);});
      m.querySelector('#pvAdd')?.addEventListener('click',()=>vendorForm(()=>load()));
    }
    load();
  }
  function vendorForm(saved){
    const m=modal('新增簽約廠商',`<div class="ll-mf"><div class="ll-row"><label>類別<select id="vc"><option value="maintenance">簽約保養廠商</option><option value="general">一般廠商</option><option value="special">特約廠商</option></select></label><label>服務項目<input id="vs" maxlength="80" placeholder="例如：電梯保養"></label></div><label>廠商名稱 *<input id="vn" maxlength="80" placeholder="公司全名"></label><div class="ll-row"><label>統一編號<input id="vt" maxlength="8" inputmode="numeric"></label><label>負責人（法定代理人）<input id="vo" maxlength="40"></label></div><div class="ll-row"><label>聯絡人<input id="vk" maxlength="40"></label><label>電話<input id="vp" maxlength="40" inputmode="tel"></label></div><label>地址 *<input id="va" maxlength="120" placeholder="含郵遞區號"></label><div class="ll-row"><label>合約開始<input type="date" id="v1"></label><label>合約到期<input type="date" id="v2"></label></div></div><div class="ll-muted">存到本社區的簽約廠商清單，之後寫信可以直接選。</div><div class="ll-actions"><button type="button" id="vOk">儲存</button></div>`);
    m.querySelector('#vOk').onclick=async()=>{const g=id=>m.querySelector(id).value.trim();if(!g('#va')){alert('請填寫廠商地址');return;}try{await api('/api/staff/community-vendors',J('POST',{category:g('#vc'),service:g('#vs'),name:g('#vn'),tax_id:g('#vt'),owner:g('#vo'),contact:g('#vk'),phone:g('#vp'),address:g('#va'),contract_start:g('#v1'),contract_end:g('#v2')}));m.close();saved();}catch(e){alert(e.message);}};
  }

  // ---------- 列印（A4，依份數重複整份） ----------
  function printLetter(L,win){
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
    const CSS=`@page{size:A4;margin:9mm 10mm}body{margin:0;font-family:${KAI};color:#111}.pg{position:relative;page-break-after:always;padding-left:9mm;min-height:270mm;box-sizing:border-box}.pg:last-child{page-break-after:auto}
.side{position:absolute;left:0;top:70mm;width:7mm;border:1px solid #333;text-align:center;font-size:12pt;line-height:1.5;padding:3mm 0}
.top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:2mm}.top h1{font-size:17pt;letter-spacing:.35em;margin:0}.top span{font-size:9.5pt}.pn{color:#555}
.note{font-size:8.5pt;margin:1mm 0}.note.r{text-align:right}
table{border-collapse:collapse;width:100%}.parties td,.parties th{border:1px solid #333;padding:1.3mm 2mm;font-size:10.5pt;text-align:left;vertical-align:middle}.parties th.pl{width:24mm;font-weight:400}.parties td.k{width:20mm;white-space:nowrap}.seal{float:right;color:#999;font-size:9pt;border:1px dashed #aaa;padding:0 2mm}
.grid{table-layout:fixed;margin-top:2mm}.grid td,.grid th{border:1px solid #333;text-align:center;padding:0;height:8.6mm;font-size:14pt}.grid th{height:4.5mm;font-size:7.5pt;font-weight:400}.grid th.rh{width:7mm}
.foot{font-size:9pt;margin-top:2mm}.fee{line-height:1.7}.cert{display:grid;grid-template-columns:1.6fr .6fr .8fr 1fr;border:1px solid #333;margin-top:2mm}.cert div{border-right:1px solid #333;padding:2mm;min-height:17mm;line-height:1.6}.cert div:last-child{border-right:0}.stamp{text-align:center;color:#555}
.memo{margin-top:2mm;line-height:1.55;font-size:8.3pt}.seam{position:absolute;left:1mm;top:150mm;font-size:7.5pt;color:#777;writing-mode:vertical-rl;letter-spacing:.2em}`;
    const w=win||window.open('','_blank');if(!w){alert('瀏覽器擋住了列印視窗，請允許彈出視窗後再試一次');return;}
    w.document.open();w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>存證信函 ${esc(L.title||'')}</title>${KAI_LINK}<style>${CSS}</style></head><body>${body}</body></html>`);w.document.close();
    // 等字型（標楷體／楷書網路字型）載入後再開列印視窗
    const go=()=>{try{w.focus();w.print();}catch{}};let done=false;const once=()=>{if(!done){done=true;go();}};
    try{w.document.fonts.ready.then(()=>setTimeout(once,200));}catch{}setTimeout(once,2500);
  }

  window.LegalLetterModule={render,layout,printLetter};
})();
