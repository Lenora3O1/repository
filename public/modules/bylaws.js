// 社區資訊 → 規約：上傳目前版本、全文搜尋（關鍵字標亮）、線上逐條修改（每次儲存保留版本）、下載 Word／列印 PDF。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,o={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=b=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  const tw=v=>{const t=new Date(v);return isNaN(t)?'':new Date(t.getTime()+8*3600e3).toISOString().slice(0,16).replace('T',' ');};
  const KAI="'標楷體','DFKai-SB','BiauKai','TW-Kai','Kaiti TC','STKaiti','LXGW WenKai TC',serif";
  const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function css(){if(document.getElementById('blCss'))return;const s=document.createElement('style');s.id='blCss';s.textContent=`
.bl{display:grid;gap:14px}.bl-card{border:1px solid #E6DCD8;border-radius:14px;padding:14px 16px;background:#fff;display:grid;gap:10px}.bl h3{margin:0;font-size:1.02rem;color:#4E322D;flex:1}
.bl-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.bl-bar button{margin:0}.bl-muted{color:#7A5F58;font-size:.86rem}
.bl-tip{background:#FBF8F5;border:1px solid #EDE3DE;border-radius:10px;padding:10px 12px;font-size:.9rem;color:#5d4a44;line-height:1.7}
.bl-search{display:flex;gap:8px;align-items:center;position:sticky;top:0;z-index:2;background:#fff;padding:6px 0}.bl-search input{flex:1;margin:0;padding:10px 12px;border:1px solid #D8CECB;border-radius:10px;font:inherit;font-size:1rem}
.bl-doc{font-family:${KAI};line-height:1.9;color:#2c1f1b}.bl-doc h2{text-align:center;font-size:1.35rem;margin:6px 0 14px}.bl-ch{text-align:center;font-weight:800;font-size:1.1rem;margin:18px 0 8px;color:#4E322D}
.bl-art{padding:8px 10px;border-radius:10px;scroll-margin-top:70px}.bl-art:hover{background:#FBF8F5}.bl-no{font-weight:800}.bl-body{white-space:pre-wrap;padding-left:2em}
.bl-doc mark{background:#FFE39A;color:inherit;padding:0 1px;border-radius:3px}.bl-hit{border:1px solid #F1D9A0;background:#FFFCF2}
.bl-toc{display:flex;gap:6px;flex-wrap:wrap}.bl-toc a{font-size:.82rem;padding:3px 9px;border-radius:999px;background:#F5F2EE;color:#5d4a44;text-decoration:none}
.bl-ed{display:grid;gap:8px}.bl-it{display:grid;grid-template-columns:110px 130px minmax(0,1fr) auto;gap:6px;align-items:start;border:1px solid #EFE6E2;border-radius:10px;padding:8px;background:#FDFCFB}
.bl-it select,.bl-it input,.bl-it textarea,.bl-f input,.bl-f textarea{margin:0;padding:7px 9px;border:1px solid #D8CECB;border-radius:8px;font:inherit;width:100%;box-sizing:border-box;background:#fff}
.bl-it textarea{grid-column:1/-2;min-height:64px;line-height:1.7;resize:vertical}.bl-it .ops{display:flex;flex-direction:column;gap:4px;grid-row:1/3;grid-column:4}.bl-it .ops button{margin:0;padding:3px 8px;min-height:0}
.bl-it.ch{background:#FBEAE3}.bl-f{display:grid;grid-template-columns:1fr 1fr;gap:8px}.bl-f label{display:flex;flex-direction:column;gap:4px;font-weight:700}.bl-f .w{grid-column:1/-1}
@media(max-width:640px){.bl-it{grid-template-columns:1fr 1fr auto}.bl-it input[data-k=title]{grid-column:1/3}.bl-it .ops{grid-column:3;grid-row:1/4}.bl-it textarea{grid-column:1/3}.bl-f{grid-template-columns:1fr}}
.bl-bg{position:fixed;inset:0;background:rgba(40,25,20,.42);z-index:3000;display:flex;align-items:center;justify-content:center;padding:14px}.bl-modal{background:#fff;border-radius:14px;max-width:720px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden}.bl-modal header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #EFE6E2}.bl-modal header h3{flex:1;margin:0}.bl-modal header button{margin:0}.bl-modal .body{padding:12px 16px;overflow:auto;display:grid;gap:10px}
.bl-ver{display:flex;gap:8px;align-items:center;border:1px solid #EFE6E2;border-radius:10px;padding:8px 12px}.bl-ver div{flex:1}.bl-ver button{margin:0;padding:4px 10px;min-height:0}
`;document.head.appendChild(s);}
  function modal(title,html){const bg=document.createElement('div');bg.className='bl-bg';bg.innerHTML=`<div class="bl-modal" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button type="button" class="secondary" data-x>關閉</button></header><div class="body">${html}</div></div>`;document.body.appendChild(bg);bg.close=()=>bg.remove();bg.querySelector('[data-x]').onclick=bg.close;return bg;}
  const label=it=>it.type==='article'?`${it.no}${it.title?`（${it.title}）`:''}`:it.type==='chapter'?`${it.no}${it.title?`　${it.title}`:''}`:'';
  const verText=v=>`第 ${v.version_no} 版${v.amend_date?`｜修正日期 ${v.amend_date}`:''}${v.amend_note?`｜${v.amend_note}`:''}`;

  let S={};
  async function render(host,lbl){
    css();S={host,label:lbl||'規約',q:''};host.innerHTML='<div class="panel"><div class="bl-muted">載入規約…</div></div>';
    try{S.d=await api('/api/staff/bylaws');}catch(e){host.innerHTML=`<div class="panel"><h1>${esc(S.label)}</h1><div class="bl-tip">${esc(e.message)}</div></div>`;return;}
    S.view=S.d.current;draw();
  }
  function draw(){
    const {host,d}=S;const V=S.view;const old=V&&d.current&&V.id!==d.current.id;
    host.innerHTML=`<div class="panel"><div class="eyebrow">🏢 社區資訊</div><h1>${esc(S.label)}</h1><div class="bl">
      ${!V?`<div class="bl-card"><div class="bl-tip">📄 ${esc(d.community?.name||'')}還沒有上傳規約。${d.can_edit?'請按「上傳規約」選擇目前版本的 Word（.docx）或 PDF；系統會自動拆成章、條，之後就能搜尋與線上修改。':'請經理或秘書上傳。'}</div>${d.can_edit?'<div class="bl-bar"><button type="button" id="blUp">⬆ 上傳規約</button><button type="button" class="secondary" id="blPaste">📋 直接貼上文字</button></div>':''}</div>`
      :`<div class="bl-card"><div class="bl-bar"><h3>${esc(V.title)}</h3>${old?'<span class="bl-muted" style="color:#a33131">（正在看舊版本）</span>':''}</div>
        <div class="bl-muted">${esc(verText(V))}｜${esc(V.created_by)} ${esc(tw(V.created_at))} ${V.source==='upload'?'上傳':'線上修改'}${V.has_file?`｜原始檔：${esc(V.file_original)}`:''}</div>
        <div class="bl-bar"><button type="button" class="secondary" id="blDocx">⬇ 下載 Word</button><button type="button" class="secondary" id="blPdf">🖨 列印／存成 PDF</button>${V.has_file?'<button type="button" class="secondary" id="blOrig">📎 原始檔</button>':''}<button type="button" class="secondary" id="blVers">🕘 版本紀錄（${d.versions.length}）</button>
          ${d.can_edit&&!old?'<button type="button" id="blEdit">✏️ 修改條文</button><button type="button" class="secondary" id="blUp">⬆ 上傳新版</button>':''}${old?'<button type="button" id="blCur">回到目前版本</button>':''}</div></div>
      <div class="bl-card"><div class="bl-search"><input id="blQ" type="search" placeholder="🔎 搜尋規約：例如 管理費、寵物、停車、裝修" value="${esc(S.q)}"><span class="bl-muted" id="blCnt"></span></div>
        <div class="bl-toc" id="blToc"></div><div class="bl-doc" id="blDoc"></div></div>`}
    </div></div>`;
    const q=s=>host.querySelector(s);
    q('#blUp')?.addEventListener('click',()=>uploadDialog(false));q('#blPaste')?.addEventListener('click',()=>uploadDialog(true));
    if(!V)return;
    q('#blDocx').onclick=()=>{location.href=`/api/staff/bylaws/versions/${V.id}/docx`;};
    q('#blOrig')?.addEventListener('click',()=>{location.href=`/api/staff/bylaws/versions/${V.id}/file`;});
    q('#blPdf').onclick=()=>printPdf(V);
    q('#blVers').onclick=versions;q('#blEdit')?.addEventListener('click',()=>editor(V));q('#blCur')?.addEventListener('click',()=>{S.view=d.current;draw();});
    q('#blQ').oninput=e=>{S.q=e.target.value;paintDoc();};
    paintDoc();
  }
  function paintDoc(){
    const V=S.view;const host=S.host;const kws=S.q.trim().split(/\s+/).filter(Boolean);
    const hl=t=>{let h=esc(t);for(const k of kws){const e=esc(k).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');h=h.replace(new RegExp(e,'g'),m=>`<mark>${m}</mark>`);}return h;};
    const hit=it=>kws.every(k=>`${label(it)}\n${it.body}`.includes(k));
    let n=0;let html=`<h2>${esc(V.title)}</h2>`;let curCh=null;
    V.items.forEach((it,i)=>{
      if(it.type==='chapter'){curCh=it;if(!kws.length)html+=`<div class="bl-ch" id="bl-${i}">${hl(label(it))}</div>`;return;}
      if(kws.length&&!hit(it))return;n++;
      if(kws.length&&curCh){html+=`<div class="bl-ch">${esc(label(curCh))}</div>`;curCh=null;}
      html+=`<div class="bl-art ${kws.length?'bl-hit':''}" id="bl-${i}">${it.type==='article'?`<div class="bl-no">${hl(label(it))}</div>`:''}<div class="bl-body">${hl(it.body)}</div></div>`;
    });
    if(kws.length&&!n)html+='<div class="bl-muted" style="text-align:center;padding:20px">找不到含有這些字的條文。</div>';
    host.querySelector('#blDoc').innerHTML=html;
    host.querySelector('#blCnt').textContent=kws.length?`找到 ${n} 條`:`共 ${V.items.filter(x=>x.type==='article').length} 條`;
    host.querySelector('#blToc').innerHTML=kws.length?'':V.items.map((it,i)=>it.type==='chapter'?`<a href="#bl-${i}" data-j="${i}">${esc(it.no)}${it.title?` ${esc(it.title)}`:''}</a>`:'').join('');
    host.querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();host.querySelector(`#bl-${a.dataset.j}`)?.scrollIntoView({behavior:'smooth'});});
  }
  async function versions(){
    const m=modal('版本紀錄',S.d.versions.map(v=>`<div class="bl-ver"><div><b>${esc(verText(v))}</b><div class="bl-muted">${esc(v.created_by)} ${esc(tw(v.created_at))} ${v.source==='upload'?'上傳':'線上修改'}${v.id===S.d.current.id?'｜目前版本':''}</div></div><button type="button" class="secondary" data-v="${v.id}">查看</button><button type="button" class="secondary" data-w="${v.id}">Word</button></div>`).join(''));
    m.querySelectorAll('[data-v]').forEach(b=>b.onclick=async()=>{try{const x=await api(`/api/staff/bylaws/versions/${b.dataset.v}`);S.view=x.version;m.close();draw();}catch(e){alert(e.message);}});
    m.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{location.href=`/api/staff/bylaws/versions/${b.dataset.w}/docx`;});
  }

  // PDF：瀏覽器抽出文字（掃描檔讀不到）
  function loadPdfJs(){return new Promise((ok,no)=>{if(window.pdfjsLib)return ok(window.pdfjsLib);const s=document.createElement('script');s.src=PDFJS+'pdf.min.js';s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js';ok(window.pdfjsLib);};s.onerror=()=>no(new Error('無法載入 PDF 讀取元件，請確認網路，或改上傳 Word 檔'));document.head.appendChild(s);});}
  async function pdfText(file){
    const lib=await loadPdfJs();const doc=await lib.getDocument({data:await file.arrayBuffer()}).promise;const out=[];
    for(let p=1;p<=doc.numPages;p++){const c=await (await doc.getPage(p)).getTextContent();const rows=new Map();
      for(const it of c.items){if(!it.str)continue;const y=Math.round(it.transform[5]);let key=[...rows.keys()].find(k=>Math.abs(k-y)<=2);if(key===undefined){key=y;rows.set(y,[]);}rows.get(key).push(it);}
      for(const y of [...rows.keys()].sort((a,b)=>b-a))out.push(rows.get(y).sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join('').replace(/\s+$/,''));
      out.push('');}
    return out.join('\n');
  }
  function uploadDialog(paste){
    const m=modal(paste?'貼上規約文字':'上傳規約',`${paste?'<textarea id="upT" rows="12" style="width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #D8CECB;border-radius:8px" placeholder="把規約全文貼在這裡；系統會依「第○章」「第○條」自動拆開。"></textarea>':'<input type="file" id="upF" accept=".docx,.pdf,.txt"><div class="bl-muted">支援 Word（.docx）、PDF、純文字。舊版 Word（.doc）請先另存成 .docx。掃描成圖片的 PDF 讀不到文字。</div>'}
      <div class="bl-bar"><button type="button" id="upGo">讀取並預覽</button></div><div id="upPv"></div>`);
    m.querySelector('#upGo').onclick=async()=>{
      const pv=m.querySelector('#upPv');pv.innerHTML='<div class="bl-muted">讀取中…</div>';
      try{const fd=new FormData();
        if(paste){const t=m.querySelector('#upT').value;if(!t.trim())throw new Error('請貼上規約文字');fd.append('text',t);}
        else{const f=m.querySelector('#upF').files[0];if(!f)throw new Error('請選擇檔案');if(/\.pdf$/i.test(f.name))fd.append('text',await pdfText(f));fd.append('file',f);}
        const r=await fetch('/api/staff/bylaws/parse',{method:'POST',credentials:'same-origin',body:fd});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||'讀取失敗');
        const arts=x.items.filter(i=>i.type==='article');
        pv.innerHTML=`<div class="bl-tip">讀到 <b>${x.stats.chapters}</b> 章、<b>${x.stats.articles}</b> 條（共 ${x.stats.chars.toLocaleString()} 字）。${x.stats.articles?'':'⚠ 沒有找到「第○條」，請確認內容；也可以儲存後再用「修改條文」整理。'}</div>
          <div class="bl-doc" style="max-height:220px;overflow:auto;border:1px solid #EFE6E2;border-radius:10px;padding:8px 12px;font-size:.92rem">${arts.slice(0,4).map(a=>`<div><b>${esc(label(a))}</b> ${esc(a.body.slice(0,80))}${a.body.length>80?'…':''}</div>`).join('')}${arts.length>4?`<div class="bl-muted">…還有 ${arts.length-4} 條</div>`:''}</div>
          <div class="bl-f"><label class="w">規約名稱<input id="upTitle" maxlength="80" value="${esc(x.title||`${S.d.community?.name||''}規約`)}"></label><label>修正（通過）日期<input type="date" id="upDate"></label><label>說明<input id="upNote" maxlength="200" placeholder="例如：115 年度區分所有權人會議通過"></label></div>
          <div class="bl-bar"><button type="button" id="upSave">💾 儲存為${S.d.current?'新版本':'目前版本'}</button></div>`;
        m.querySelector('#upSave').onclick=async()=>{try{const y=await api('/api/staff/bylaws',J({title:m.querySelector('#upTitle').value,items:x.items,amend_date:m.querySelector('#upDate').value,amend_note:m.querySelector('#upNote').value,token:x.token}));m.close();await render(S.host,S.label);}catch(e){alert(e.message);}};
      }catch(e){pv.innerHTML=`<div class="bl-tip" style="color:#a33131">${esc(e.message)}</div>`;}
    };
  }
  // 線上修改：逐條編輯、新增、刪除、上下移；儲存成新版本
  function editor(V){
    const items=JSON.parse(JSON.stringify(V.items));const host=S.host;
    const draw2=()=>{host.innerHTML=`<div class="panel"><div class="eyebrow">🏢 社區資訊 → ${esc(S.label)}</div><h1>修改條文</h1><div class="bl">
      <div class="bl-card"><div class="bl-f"><label class="w">規約名稱<input id="edTitle" maxlength="80" value="${esc(V.title)}"></label><label>修正（通過）日期<input type="date" id="edDate"></label><label>說明<input id="edNote" maxlength="200" placeholder="例如：115 年度區分所有權人會議修正第 12 條"></label></div>
        <div class="bl-muted">儲存後會產生第 ${S.d.current.version_no+1} 版，舊版本仍可在「版本紀錄」查看與下載。規約修正應經區分所有權人會議決議，這裡是把通過的內容登錄進系統。</div></div>
      <div class="bl-card bl-ed">${items.map((it,i)=>`<div class="bl-it ${it.type==='chapter'?'ch':''}" data-i="${i}"><select data-k="type"><option value="article" ${it.type==='article'?'selected':''}>條</option><option value="chapter" ${it.type==='chapter'?'selected':''}>章</option><option value="text" ${it.type==='text'?'selected':''}>說明文字</option></select><input data-k="no" maxlength="30" value="${esc(it.no)}" placeholder="${it.type==='chapter'?'第一章':'第一條'}"><input data-k="title" maxlength="60" value="${esc(it.title)}" placeholder="${it.type==='chapter'?'章名':'條名（可空白）'}"><div class="ops"><button type="button" class="secondary" data-up="${i}" title="上移">↑</button><button type="button" class="secondary" data-down="${i}" title="下移">↓</button><button type="button" class="secondary" data-add="${i}" title="在下面新增一條">＋</button><button type="button" class="secondary" data-del="${i}" title="刪除" style="color:#a33131">✕</button></div>${it.type==='chapter'?'':`<textarea data-k="body" placeholder="條文內容">${esc(it.body)}</textarea>`}</div>`).join('')}
        <div class="bl-bar"><button type="button" class="secondary" id="edAdd">＋ 在最後新增一條</button></div></div>
      <div class="bl-bar"><button type="button" class="secondary" id="edCancel">取消</button><button type="button" id="edSave">💾 儲存為新版本</button></div></div></div>`;
      host.querySelectorAll('[data-i]').forEach(row=>{const it=items[Number(row.dataset.i)];row.querySelectorAll('[data-k]').forEach(inp=>inp.addEventListener(inp.tagName==='SELECT'?'change':'input',()=>{it[inp.dataset.k]=inp.value;if(inp.tagName==='SELECT')draw2();}));});
      const mv=(i,d)=>{const j=i+d;if(j<0||j>=items.length)return;[items[i],items[j]]=[items[j],items[i]];draw2();};
      host.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>mv(Number(b.dataset.up),-1));host.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>mv(Number(b.dataset.down),1));
      host.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{items.splice(Number(b.dataset.add)+1,0,{type:'article',no:'',title:'',body:''});draw2();});
      host.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const it=items[Number(b.dataset.del)];if((it.body||it.no)&&!confirm(`刪除「${label(it)||'這一段'}」？`))return;items.splice(Number(b.dataset.del),1);draw2();});
      host.querySelector('#edAdd').onclick=()=>{items.push({type:'article',no:'',title:'',body:''});draw2();};
      host.querySelector('#edCancel').onclick=()=>{if(confirm('放棄這次的修改？'))draw();};
      host.querySelector('#edSave').onclick=async()=>{try{const x=await api('/api/staff/bylaws',J({title:host.querySelector('#edTitle').value,items,amend_date:host.querySelector('#edDate').value,amend_note:host.querySelector('#edNote').value}));await render(S.host,S.label);}catch(e){alert(e.message);}};
    };
    draw2();
  }
  function printPdf(V){
    const w=window.open('','_blank');if(!w){alert('瀏覽器擋住了列印視窗，請允許彈出視窗後再試一次');return;}
    const body=V.items.map(it=>it.type==='chapter'?`<h3>${esc(label(it))}</h3>`:it.type==='article'?`<div class="a"><b>${esc(label(it))}</b><div class="b">${esc(it.body)}</div></div>`:`<div class="b0">${esc(it.body)}</div>`).join('');
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(V.title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&display=swap"><style>@page{size:A4;margin:20mm 18mm}body{font-family:${KAI};color:#000;line-height:1.9;font-size:12pt}h1{text-align:center;font-size:18pt;margin:0 0 14pt}h3{text-align:center;font-size:14pt;margin:16pt 0 6pt}.a{margin:6pt 0;break-inside:avoid-page}.b{white-space:pre-wrap;padding-left:2em}.b0{white-space:pre-wrap}.ft{margin-top:20pt;font-size:9.5pt;color:#555;border-top:1px solid #999;padding-top:6pt}</style></head><body><h1>${esc(V.title)}</h1>${body}<div class="ft">${esc(verText(V))}</div></body></html>`);
    w.document.close();let done=false;const go=()=>{if(done)return;done=true;try{w.focus();w.print();}catch{}};try{w.document.fonts.ready.then(()=>setTimeout(go,200));}catch{}setTimeout(go,3000);
  }
  window.BylawsModule={render};
})();
