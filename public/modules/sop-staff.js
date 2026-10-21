// 案場 SOP：現場工作台
// - 所有人：依身分與派駐案場閱讀公司 SOP 與本案場 SOP（伺服器端已過濾權限）。
// - 社區經理：可上傳自己派駐案場的 SOP（存為「案場注意事項」，同步回公司內勤管理）。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const VIEWS={
    'sop':{title:'案場 SOP',query:''},
    'sop-admin':{title:'行政 SOP',query:'category=行政'},
    'sop-duty':{title:'勤務 SOP',query:'category=勤務'},
    'sop-company':{title:'公司基本 SOP',query:'scope=company_basic'},
    'sop-community':{title:'案場注意事項',query:'scope=community'}
  };
  const FILE_ACCEPT='.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.txt';
  const FILE_ICON={pdf:'📕',doc:'📘',docx:'📘',xls:'📗',xlsx:'📗',xlsm:'📗',txt:'📄'};
  function fmtDate(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;}
  function ext(name){return String(name||'').split('.').pop().toLowerCase();}
  function injectStyle(){
    if(document.getElementById('sopStaffStyle'))return;
    const s=document.createElement('style');s.id='sopStaffStyle';
    s.textContent=`
.sop-staff .sop-staff-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.sop-staff .sop-staff-head h1{margin:4px 0 6px}
.sop-staff .sop-staff-head p{margin:0;color:var(--ink-soft,#6F635F)}
.sop-upload-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:18px 0 4px;padding:14px 16px;border-radius:14px;background:#F5F3EF;border:1px solid #E2DAD7}
.sop-upload-card div{flex:1;min-width:220px}
.sop-upload-card strong{display:block;color:var(--accent-dark,#422A26)}
.sop-upload-card small{color:#61544F}
.sop-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:18px 0 12px}
.sop-toolbar .sop-search{position:relative;flex:1;min-width:220px}
.sop-toolbar .sop-search input{width:100%;box-sizing:border-box;margin:0;border:1px solid #E2D9D6;border-radius:999px;padding:10px 14px 10px 36px;font:inherit;background:#fff}
.sop-toolbar .sop-search span{position:absolute;left:13px;top:50%;transform:translateY(-50%);opacity:.5}
.sop-filter{display:inline-flex;gap:4px;padding:4px;border-radius:10px;background:#F6F3F2;border:1px solid #E8E2E0}
.sop-filter button{border:0;background:transparent;color:#6F635F;font-weight:700;padding:7px 12px;border-radius:8px;min-height:0;cursor:pointer}
.sop-filter button.active{background:#fff;color:var(--accent-dark,#422A26);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.sop-list{display:flex;flex-direction:column;gap:10px}
.sop-item{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 16px;border:1px solid #E9E3E1;border-radius:14px;background:#fff}
.sop-item-icon{width:48px;height:48px;border-radius:12px;background:#F7F5F3;display:flex;align-items:center;justify-content:center;font-size:1.5rem}
.sop-item-main{min-width:0}
.sop-item-main h3{margin:0 0 4px;font-size:1.02rem;color:var(--ink,#2A201D)}
.sop-item-main p{margin:4px 0 0;font-size:.86rem;color:#6F635F;line-height:1.5}
.sop-tags{display:flex;gap:6px;flex-wrap:wrap;font-size:.76rem}
.sop-tag{padding:2px 9px;border-radius:999px;background:#F2EFEE;color:#5D504C;font-weight:600}
.sop-tag.company{background:#e5eefb;color:#2f5d8a}
.sop-tag.community{background:#E8EEDF;color:#3E5328}
.sop-tag.emergency{background:#ffe8e0;color:#a3492a}
.sop-item-meta{font-size:.76rem;color:#8A7E7A;margin-top:6px}
.sop-download{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;background:var(--accent,#5D403C);color:#fff;font-weight:700;text-decoration:none;white-space:nowrap}
.sop-download:hover{background:var(--accent-dark,#422A26)}
.sop-empty-state{text-align:center;padding:40px 16px;color:#6F635F}
.sop-empty-state div{font-size:2.4rem;margin-bottom:8px}
.sop-upload-form{display:flex;flex-direction:column;gap:12px;margin-top:10px}
.sop-upload-form label{display:flex;flex-direction:column;gap:6px;font-weight:700;font-size:.9rem}
.sop-upload-form input:not([type=checkbox]),.sop-upload-form select,.sop-upload-form textarea{width:100%;box-sizing:border-box;margin:0;font-weight:400}
.sop-upload-form .sop-row{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px}
.sop-upload-form .sop-jobs{display:flex;gap:14px;flex-wrap:wrap;font-weight:500}
.sop-upload-form .sop-jobs label{flex-direction:row;align-items:center;gap:6px;font-weight:500}
.sop-upload-form .hint{margin:0;font-weight:400}
@media(max-width:640px){.sop-item{grid-template-columns:40px minmax(0,1fr)}.sop-item-icon{width:40px;height:40px;font-size:1.25rem}.sop-download{grid-column:1/-1;justify-content:center}.sop-upload-form .sop-row{grid-template-columns:1fr}.sop-filter{width:100%}.sop-filter button{flex:1}}
`;
    document.head.appendChild(s);
  }
  function itemHtml(x){
    const scope=String(x.scope_type||'company_basic')==='community'?'<span class="sop-tag community">本案場</span>':'<span class="sop-tag company">公司基本</span>';
    const cat=x.category?`<span class="sop-tag ${x.category==='應變'?'emergency':''}">${esc(x.category)}</span>`:'';
    const targets=(x.target_jobs||[]).length?(x.target_jobs||[]).join('、'):'全部人員';
    const source=x.source_type==='manager'?`案場經理 ${esc(x.uploader_name||x.source_manager_name||'')} 上傳`:x.source_type==='manager-assisted'?`公司內勤代 ${esc(x.source_manager_name||'經理')} 上傳`:'公司內勤建立';
    return `<article class="sop-item" data-search="${esc(`${x.title} ${x.category||''} ${x.description||''}`.toLowerCase())}" data-scope="${esc(x.scope_type||'company_basic')}">
      <div class="sop-item-icon" aria-hidden="true">${FILE_ICON[ext(x.original_filename)]||'📄'}</div>
      <div class="sop-item-main"><h3>${esc(x.title)}</h3><div class="sop-tags">${scope}${cat}<span class="sop-tag">版本 ${esc(x.version||'1.0')}</span></div>${x.description?`<p>${esc(x.description)}</p>`:''}<div class="sop-item-meta">適用：${esc(targets)}｜${source}｜更新 ${fmtDate(x.updated_at)}</div></div>
      <a class="sop-download" href="/api/staff/sops/${Number(x.id)}/download" download>⬇ 下載</a>
    </article>`;
  }
  function openUpload(viewer,onDone){
    const list=Array.isArray(viewer.upload_communities)?viewer.upload_communities:[];
    const box=document.createElement('div');box.className='modal-backdrop';box.id='sopStaffUpload';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="sopUpTitle"><button type="button" class="modal-close" aria-label="關閉">×</button>
      <div class="eyebrow">📤 案場經理上傳</div><h2 id="sopUpTitle">上傳本案場 SOP</h2>
      <p class="modal-note">上傳後會出現在「案場注意事項」，派駐該案場的指定職務人員就能閱讀；同時回傳公司內勤，由公司統一管理。</p>
      <form class="sop-upload-form" id="sopUpForm">
        <label>案場<select id="sopUpCommunity" ${list.length?'':'disabled'}>${list.length?list.map(c=>`<option value="${Number(c.id)}">${esc(c.name)}</option>`).join(''):'<option>目前沒有可上傳的案場</option>'}</select></label>
        <div class="sop-row"><label>SOP 名稱<input id="sopUpTitleInput" type="text" maxlength="120" required placeholder="例如：包裹代收注意事項"></label><label>版本<input id="sopUpVersion" type="text" maxlength="20" value="1.0"></label></div>
        <label>說明（選填）<textarea id="sopUpDesc" rows="2" maxlength="500" placeholder="簡單說明這份 SOP 的用途"></textarea></label>
        <div><div style="font-weight:700;font-size:.9rem;margin-bottom:6px">適用職務</div><div class="sop-jobs">${['秘書','保全','機動'].map((j,i)=>`<label><input type="checkbox" value="${j}" ${i<2?'checked':''}> ${j}</label>`).join('')}</div><p class="hint">經理本人一律看得到自己案場的 SOP。</p></div>
        <label>檔案<input id="sopUpFile" type="file" accept="${FILE_ACCEPT}" required><span class="hint">PDF、Word、Excel 或 TXT，最多 20MB</span></label>
        <div class="modal-actions"><span id="sopUpMsg" style="margin-right:auto"></span><button type="button" class="secondary" data-close>取消</button><button type="submit" id="sopUpSubmit" ${list.length?'':'disabled'}>上傳</button></div>
      </form></div>`;
    document.body.appendChild(box);document.body.classList.add('modal-open');
    const close=()=>{box.remove();document.body.classList.remove('modal-open');};
    box.querySelector('.modal-close').onclick=close;box.querySelector('[data-close]').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close();});
    box.querySelector('#sopUpForm').addEventListener('submit',async e=>{
      e.preventDefault();const msg=box.querySelector('#sopUpMsg'),btn=box.querySelector('#sopUpSubmit');
      const file=box.querySelector('#sopUpFile').files[0];
      if(!file){msg.innerHTML='<span class="msg error inline-msg">請選擇檔案</span>';return;}
      if(file.size>20*1024*1024){msg.innerHTML='<span class="msg error inline-msg">檔案最多 20MB</span>';return;}
      const jobs=[...box.querySelectorAll('.sop-jobs input:checked')].map(x=>x.value);
      if(!jobs.length){msg.innerHTML='<span class="msg error inline-msg">請至少勾選一個適用職務</span>';return;}
      const fd=new FormData();fd.append('community_id',box.querySelector('#sopUpCommunity').value);fd.append('title',box.querySelector('#sopUpTitleInput').value.trim());fd.append('version',box.querySelector('#sopUpVersion').value.trim()||'1.0');fd.append('description',box.querySelector('#sopUpDesc').value.trim());fd.append('target_jobs',JSON.stringify(jobs));fd.append('file',file);
      btn.disabled=true;msg.innerHTML='<span class="hint">上傳中…</span>';
      try{const d=await api('/api/staff/sops/community-upload',{method:'POST',body:fd});close();alert(`✅ ${d.message||'已上傳'}`);onDone&&onDone();}
      catch(err){msg.innerHTML=`<span class="msg error inline-msg">${esc(err.message)}</span>`;btn.disabled=false;}
    });
    setTimeout(()=>box.querySelector('#sopUpTitleInput')?.focus(),0);
  }
  async function render(action,label,container){
    injectStyle();
    const el=container||document.getElementById('staffHome');if(!el)return;
    const view=VIEWS[action]||VIEWS.sop;const title=label||view.title;
    const d=await api(`/api/staff/sops${view.query?`?${view.query}`:''}`);
    const rows=Array.isArray(d.sops)?d.sops:[];const viewer=d.viewer||{};
    const showFilter=action==='sop'&&rows.some(x=>x.scope_type==='community')&&rows.some(x=>x.scope_type!=='community');
    const upload=viewer.can_upload?`<div class="sop-upload-card"><div><strong>📤 您是案場經理，可以上傳本案場的 SOP</strong><small>上傳後會放在「案場注意事項」，並同步給公司內勤管理。</small></div><button type="button" id="sopStaffUploadBtn">上傳 SOP</button></div>`:'';
    el.innerHTML=`<div class="panel sop-staff"><div class="sop-staff-head"><div><div class="eyebrow">📚 案場 SOP</div><h1>${esc(title)}</h1><p>依您的職務（${esc(viewer.job_level||viewer.job_category||'駐點人員')}）與派駐案場，顯示可閱讀的 SOP。</p></div></div>${upload}
      ${rows.length?`<div class="sop-toolbar">${rows.length>4?'<label class="sop-search"><span aria-hidden="true">🔍</span><input type="search" id="sopStaffSearch" placeholder="搜尋 SOP 名稱或說明"></label>':''}${showFilter?'<div class="sop-filter" role="tablist"><button type="button" class="active" data-scope="">全部</button><button type="button" data-scope="company_basic">公司基本</button><button type="button" data-scope="community">本案場</button></div>':''}</div>
      <div class="sop-list" id="sopStaffList">${rows.map(itemHtml).join('')}</div><div class="sop-empty-state" id="sopStaffNoMatch" hidden><div>🔍</div>沒有符合的 SOP</div>`
      :`<div class="sop-empty-state"><div>📭</div>目前沒有${esc(title)}可以閱讀。<br><small>公司內勤上架後，或${viewer.can_upload?'您上傳本案場 SOP 後，':'案場經理上傳後，'}就會出現在這裡。</small></div>`}</div>`;
    el.querySelector('#sopStaffUploadBtn')?.addEventListener('click',()=>openUpload(viewer,()=>render(action,label,container)));
    let scope='';const apply=()=>{const q=String(el.querySelector('#sopStaffSearch')?.value||'').trim().toLowerCase();let n=0;el.querySelectorAll('.sop-item').forEach(it=>{const ok=(!q||it.dataset.search.includes(q))&&(!scope||it.dataset.scope===scope);it.hidden=!ok;if(ok)n++;});const nm=el.querySelector('#sopStaffNoMatch');if(nm)nm.hidden=n>0;};
    el.querySelector('#sopStaffSearch')?.addEventListener('input',apply);
    el.querySelectorAll('.sop-filter button').forEach(b=>b.addEventListener('click',()=>{scope=b.dataset.scope;el.querySelectorAll('.sop-filter button').forEach(x=>x.classList.toggle('active',x===b));apply();}));
  }
  window.SOPStaffModule={render,actions:Object.keys(VIEWS)};
})();
