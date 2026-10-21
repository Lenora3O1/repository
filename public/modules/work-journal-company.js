// 工作日誌管理：公司內勤（查詢、檢視、列印各案場日誌；設定各社區日誌類型）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const WEEK='日一二三四五六';
  const longDate=iso=>{const d=new Date(`${iso}T00:00:00`);return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}（${WEEK[d.getDay()]}）`;};
  const addDays=(iso,n)=>{const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const time=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
  function injectStyle(){
    if(document.getElementById('wjCompanyStyle'))return;
    const s=document.createElement('style');s.id='wjCompanyStyle';
    s.textContent=`
.wjc-filters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr)) auto;gap:10px;align-items:end;margin:14px 0}
.wjc-filters label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.85rem}
.wjc-filters select,.wjc-filters input{margin:0;width:100%}
.wjc-filters button{padding:9px 16px;min-height:0}
.wjc-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:.78rem}
.wjc-pill.draft{background:#fff3e0;color:#a35a00}.wjc-pill.submitted{background:#E8EEDF;color:#3E5328}
.wjc-table tr[data-id]{cursor:pointer}
.wjc-table tr[data-id]:hover td{background:#F8F6F4}
.wjc-modes{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:10px}
.wjc-mode{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid #E9E3E1;border-radius:12px;padding:10px 12px;background:#fff}
.wjc-mode small{display:block;color:#7A6E6A}
.wjc-mode select{width:auto;margin:0}
.wjc-viewer{position:fixed;inset:0;z-index:10040;background:rgba(30,21,20,.55);display:flex;align-items:center;justify-content:center;padding:20px}
.wjc-viewer-box{background:#fff;border-radius:16px;width:min(980px,100%);height:min(92vh,1200px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.3)}
.wjc-viewer-bar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #E9E3E1}
.wjc-viewer-bar strong{flex:1}
.wjc-viewer-bar button{padding:8px 14px;min-height:0}
.wjc-viewer iframe{flex:1;border:0;width:100%;background:#fff}
@media(max-width:900px){.wjc-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.wjc-viewer{padding:0}.wjc-viewer-box{height:100vh;border-radius:0}}
`;
    document.head.appendChild(s);
  }
  async function openViewer(id){
    const p=await api(`/api/company/journal/view/${id}`);
    const box=document.createElement('div');box.className='wjc-viewer';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
    const title=p.summary?`${p.community?.name||''}｜每週工作日誌 ${longDate(p.summary.week_start)} 起`:`${p.community?.name||''}｜每日工作日誌 ${longDate(p.date||p.journal?.period_date)}`;
    box.innerHTML=`<div class="wjc-viewer-box"><div class="wjc-viewer-bar"><strong>${esc(title)}</strong><button type="button" class="secondary" data-print>🖨 列印／PDF</button><button type="button" class="secondary" data-close aria-label="關閉">✕ 關閉</button></div><iframe title="日誌內容"></iframe></div>`;
    document.body.appendChild(box);
    const doc=box.querySelector('iframe').contentDocument;doc.open();doc.write(window.JournalPrint.html(p,p.community));doc.close();
    const close=()=>box.remove();box.querySelector('[data-close]').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    box.querySelector('[data-print]').onclick=()=>{try{box.querySelector('iframe').contentWindow.print();}catch(e){alert(e.message);}};
  }
  async function render(container,label){
    injectStyle();
    const el=container;if(!el)return;
    if(!window.JournalPrint)throw new Error('日誌列印模組尚未載入，請重新整理頁面');
    const ctx=await api('/api/company/journal/communities');
    const today=ctx.today;const from=addDays(today,-30);
    el.innerHTML=`<div class="eyebrow">📝 工作日誌管理</div><h1>${esc(label||'工作日誌管理')}</h1><p class="hint">查看各案場的每日／每週工作日誌，可直接列印或另存 PDF。日誌由現場人員填寫、社區經理送出；這裡只能檢視，不會修改內容。</p>
      <div class="wjc-filters"><label>案場<select id="wjcCommunity"><option value="">全部案場</option>${ctx.communities.map(c=>`<option value="${c.id}">${esc(c.name)}${c.status!=='active'?'（停用）':''}</option>`).join('')}</select></label>
      <label>類型<select id="wjcKind"><option value="">全部</option><option value="daily">每日</option><option value="weekly">每週</option></select></label>
      <label>狀態<select id="wjcStatus"><option value="">全部</option><option value="submitted">已送出</option><option value="draft">草稿</option></select></label>
      <label>從<input type="date" id="wjcFrom" value="${from}"></label><label>到<input type="date" id="wjcTo" value="${today}"></label><button type="button" id="wjcSearch">查詢</button></div>
      <div id="wjcList"></div>
      <details style="margin-top:18px"><summary style="font-weight:800;cursor:pointer">⚙ 各社區日誌類型（依管委會習慣選擇每日或每週）</summary><div class="wjc-modes">${ctx.communities.filter(c=>c.status==='active').map(c=>`<div class="wjc-mode"><div><b>${esc(c.name)}</b><small>最近一份：${c.last_journal?longDate(c.last_journal):'尚無'}</small></div><select data-mode="${c.id}"><option value="inherit" ${c.mode_inherited?'selected':''}>沿用平台預設（${ctx.platform_mode==='weekly'?'每週':'每日'}）</option><option value="daily" ${!c.mode_inherited&&c.mode!=='weekly'?'selected':''}>每日</option><option value="weekly" ${!c.mode_inherited&&c.mode==='weekly'?'selected':''}>每週</option></select></div>`).join('')}</div></details>`;
    const search=async()=>{
      const q=new URLSearchParams();for(const [k,id] of [['community_id','wjcCommunity'],['kind','wjcKind'],['status','wjcStatus'],['from','wjcFrom'],['to','wjcTo']]){const v=el.querySelector('#'+id).value;if(v)q.set(k,v);}
      const box=el.querySelector('#wjcList');box.innerHTML='<div class="profile-loading">查詢中…</div>';
      try{const d=await api(`/api/company/journal/list?${q}`);const rows=d.rows||[];
        box.innerHTML=rows.length?`<div class="table-wrap"><table class="wjc-table"><thead><tr><th>日期</th><th>案場</th><th>類型</th><th>狀態</th><th>最後編輯</th><th>送出</th></tr></thead><tbody>${rows.map(r=>`<tr data-id="${r.id}" tabindex="0"><td><b>${r.kind==='weekly'?`${longDate(r.period_date)} 起一週`:longDate(r.period_date)}</b></td><td>${esc(r.community_name)}</td><td>${r.kind==='weekly'?'每週':'每日'}</td><td><span class="wjc-pill ${r.status}">${r.status==='submitted'?'已送出':'草稿'}</span></td><td>${esc(r.updated_by||'')}<br><small class="muted">${time(r.updated_at)}</small></td><td>${r.submitted_at?`${esc(r.submitted_by||'')}<br><small class="muted">${time(r.submitted_at)}</small>`:'—'}</td></tr>`).join('')}</tbody></table></div><p class="hint">共 ${rows.length} 份${rows.length>=300?'（只顯示最近 300 份，請縮小日期範圍）':''}，點一下即可檢視。</p>`:'<div class="empty">這段期間沒有符合條件的日誌。</div>';
        box.querySelectorAll('tr[data-id]').forEach(tr=>{const go=()=>openViewer(tr.dataset.id).catch(e=>alert(e.message));tr.addEventListener('click',go);tr.addEventListener('keydown',e=>{if(e.key==='Enter')go();});});
      }catch(e){box.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;}
    };
    el.querySelector('#wjcSearch').addEventListener('click',search);
    el.querySelectorAll('[data-mode]').forEach(sel=>sel.addEventListener('change',async()=>{try{await api('/api/company/journal/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(sel.value==='inherit'?{community_id:Number(sel.dataset.mode),reset:['mode']}:{community_id:Number(sel.dataset.mode),mode:sel.value})});}catch(e){alert(e.message);}}));
    await search();
  }
  window.WorkJournalCompanyModule={render};
})();
