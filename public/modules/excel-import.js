// Excel 批次匯入精靈：① 下載範本 → ② 上傳 → ③ 檢查結果（不寫入）→ ④ 確認匯入 → 新帳號臨時密碼清單
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const CFG={
    staff:{title:'📥 人員資料批次匯入',base:'/api/company/staff-import',blank:'下載空白範本',current:'下載目前人員資料（可直接補齊）',
      intro:'用 Excel 一次開通很多人員、或補齊人事資料。可以把原本的人事 Excel 直接複製貼到範本裡；員編（或手機）已在系統的人會更新資料，空白格子保留原本內容；不在系統的人會開通新帳號。'},
    salary:{title:'📥 薪資設定批次匯入',base:'/api/company/salary-import',blank:'下載範本（已列出所有人員）',current:'下載目前薪資設定（可直接修改）',
      intro:'用 Excel 一次設定所有人員的正式薪資、試用期薪資、固定加給與勞退自提。空白格子保留原本的金額。'},
  };
  function css(){if(document.getElementById('xiCss'))return;const s=document.createElement('style');s.id='xiCss';s.textContent=`
  .xi-back{position:fixed;inset:0;z-index:2500;background:rgba(29,13,12,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}
  .xi-box{background:#FCFAF1;border-radius:16px;max-width:1100px;width:100%;padding:22px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,.25);position:relative}
  .xi-box h2{margin:0 0 6px;font-size:1.25rem}.xi-x{all:unset;position:absolute;right:14px;top:10px;cursor:pointer;font-size:1.6rem;line-height:1;color:#7A5F58;padding:4px 8px}
  .xi-steps{display:flex;gap:6px;margin:10px 0 14px;flex-wrap:wrap}.xi-steps span{font-size:.82rem;padding:4px 10px;border-radius:99px;background:#EFE6E0;color:#7A5F58;font-weight:700}.xi-steps span.on{background:#5F403B;color:#fff}
  .xi-card{border:1px solid #E8DCD5;border-radius:12px;padding:14px;background:#fff;margin-bottom:12px}.xi-card h3{margin:0 0 8px;font-size:1rem}
  .xi-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .xi-drop{border:2px dashed #D3BFB5;border-radius:12px;padding:22px;text-align:center;color:#7A5F58;cursor:pointer;background:#FDFBF7}.xi-drop.on{border-color:#A44528;background:#FBF1EC}
  .xi-sum{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}.xi-sum b{display:inline-block;padding:6px 12px;border-radius:10px;font-size:.92rem}
  .xi-c{background:#E6F2E8;color:#2F6B3A}.xi-u{background:#E7EEF7;color:#2F4F7A}.xi-s{background:#EFEAE7;color:#7A5F58}.xi-e{background:#FBE5E5;color:#A52828}.xi-w{background:#FFF4D9;color:#8A6200}
  .xi-wrap{max-height:52vh;overflow:auto;border:1px solid #EFE6E0;border-radius:10px}
  .xi-t{width:100%;border-collapse:collapse;min-width:0!important;font-size:.88rem}.xi-t th,.xi-t td{padding:7px 9px;border-bottom:1px solid #F1E9E4;text-align:left;vertical-align:top}.xi-t td:nth-child(-n+4),.xi-t th{white-space:nowrap}.xi-t th{background:#F7F1EC;position:sticky;top:0;z-index:1;font-size:.8rem;color:#6E5650}
  .xi-t tr.err td{background:#FFF7F7}.xi-t .msg-e{color:#A52828}.xi-t .msg-w{color:#8A6200}.xi-t .f{color:#7A5F58;font-size:.8rem}
  .xi-pw{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1rem;letter-spacing:.05em;font-weight:700}
  @media print{body>*:not(.xi-print){display:none!important}.xi-print{display:block!important}}`;document.head.appendChild(s);}
  const badge=a=>a==='新增'?'<b class="xi-c" style="padding:2px 8px;border-radius:8px">新增</b>':a==='更新'?'<b class="xi-u" style="padding:2px 8px;border-radius:8px">更新</b>':a==='略過'?'<b class="xi-s" style="padding:2px 8px;border-radius:8px">略過</b>':'<b class="xi-e" style="padding:2px 8px;border-radius:8px">錯誤</b>';
  function open(kind,{onDone}={}){
    css();const C=CFG[kind];const back=document.createElement('div');back.className='xi-back';document.body.appendChild(back);document.body.classList.add('modal-open');
    let done=false;const close=()=>{back.remove();document.body.classList.remove('modal-open');if(done&&onDone)onDone();};
    const frame=(step,html)=>{back.innerHTML=`<div class="xi-box" role="dialog" aria-modal="true"><button type="button" class="xi-x" aria-label="關閉">×</button><h2>${C.title}</h2>
      <div class="xi-steps">${['① 下載範本','② 上傳檔案','③ 檢查結果','④ 完成'].map((t,i)=>`<span class="${i+1===step?'on':''}">${t}</span>`).join('')}</div>${html}</div>`;
      back.querySelector('.xi-x').onclick=()=>{if(step===3&&!confirm('還沒有匯入，確定要關閉嗎？'))return;close();};};
    // ---------- ①② ----------
    function start(msg){
      frame(1,`<p class="hint">${C.intro}</p>
        <div class="xi-card"><h3>① 下載範本</h3><div class="xi-row"><button type="button" class="secondary" data-dl="${C.base}/template">⬇ ${C.blank}</button><button type="button" class="secondary" data-dl="${C.base}/template?mode=current">⬇ ${C.current}</button></div>
          <p class="hint" style="margin:8px 0 0">範本有「填寫說明」工作表與下拉選單。標題紅色的欄位必填，其他可以之後再補。</p></div>
        <div class="xi-card"><h3>② 上傳填好的檔案</h3><input type="file" id="xiFile" accept=".xlsx,.xls,.csv" style="display:none"><div class="xi-drop" id="xiDrop" role="button" tabindex="0"><div style="font-size:1.6rem">📄</div><div><b>點這裡選擇檔案</b>，或把檔案拖曳到這裡</div><div class="hint" style="margin:4px 0 0">支援 .xlsx、.xls、.csv。上傳後只會先檢查，不會馬上寫入。</div></div>
          <div id="xiMsg" style="margin-top:8px">${msg?`<div class="msg error">${esc(msg)}</div>`:''}</div></div>`);
      const inp=back.querySelector('#xiFile'),drop=back.querySelector('#xiDrop');
      inp.onchange=()=>inp.files[0]&&upload(inp.files[0]);
      drop.onclick=()=>inp.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inp.click();}};
      back.querySelectorAll('[data-dl]').forEach(b=>b.onclick=()=>{const a=document.createElement('a');a.href=b.dataset.dl;a.download='';document.body.appendChild(a);a.click();a.remove();});
      drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('on');});drop.addEventListener('dragleave',()=>drop.classList.remove('on'));
      drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('on');const f=e.dataTransfer.files[0];if(f)upload(f);});
    }
    async function upload(file){
      back.querySelector('#xiMsg').innerHTML='<div class="profile-loading">正在檢查每一列資料，請稍候…</div>';
      const fd=new FormData();fd.append('file',file);
      try{const r=await fetch(`${C.base}/preview`,{method:'POST',credentials:'same-origin',body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'檢查失敗');preview(d,file.name);}
      catch(e){start(e.message);}
    }
    // ---------- ③ ----------
    function preview(d,fname,onlyIssues=false){
      const s=d.summary;const n=s.create+s.update;
      const list=onlyIssues?d.reports.filter(r=>r.errors.length||r.warnings.length):d.reports;
      frame(3,`<p class="hint">檔案「${esc(fname)}」（工作表：${esc(d.sheet)}）共 ${s.total} 列。<b>這一步還沒有寫入任何資料</b>，請確認後再按「確認匯入」。</p>
        <div class="xi-sum">${s.create?`<b class="xi-c">新增 ${s.create} 人</b>`:''}${s.update?`<b class="xi-u">更新 ${s.update} 人</b>`:''}${s.skip?`<b class="xi-s">略過 ${s.skip} 列</b>`:''}${s.error?`<b class="xi-e">錯誤 ${s.error} 列（不會匯入）</b>`:''}${s.warning?`<b class="xi-w">提醒 ${s.warning} 列</b>`:''}</div>
        ${s.error?'<div class="msg error" style="margin-bottom:10px">有錯誤的列不會匯入，其他列照常匯入。也可以先修改 Excel 後重新上傳。</div>':''}
        <label style="display:inline-flex;gap:6px;align-items:center;margin-bottom:8px;font-size:.9rem"><input type="checkbox" id="xiOnly" ${onlyIssues?'checked':''} style="width:auto;margin:0"> 只看有錯誤或提醒的列</label>
        <div class="xi-wrap"><table class="xi-t"><thead><tr><th>Excel 列</th><th>結果</th><th>員編</th><th>姓名</th><th>會匯入的欄位</th><th>錯誤／提醒</th></tr></thead><tbody>
        ${list.map(r=>`<tr class="${r.errors.length?'err':''}"><td>${r.row}</td><td>${badge(r.action)}</td><td>${esc(r.employee_id||'')}</td><td>${esc(r.name||'')}</td><td class="f">${esc((r.fields||[]).join('、'))}</td><td>${r.errors.map(m=>`<div class="msg-e">✗ ${esc(m)}</div>`).join('')}${r.warnings.map(m=>`<div class="msg-w">⚠ ${esc(m)}</div>`).join('')}</td></tr>`).join('')||'<tr><td colspan="6" class="hint">沒有需要注意的列 ✓</td></tr>'}
        </tbody></table></div>
        <div class="xi-row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="secondary" id="xiRe">重新上傳</button><button type="button" id="xiGo" ${n?'':'disabled'}>確認匯入（${s.create?`新增 ${s.create} 人`:''}${s.create&&s.update?'、':''}${s.update?`更新 ${s.update} 人`:''}${n?'':'沒有可匯入的資料'}）</button></div>`);
      back.querySelector('#xiOnly').onchange=e=>preview(d,fname,e.target.checked);
      back.querySelector('#xiRe').onclick=()=>start();
      back.querySelector('#xiGo').onclick=async e=>{e.target.disabled=true;e.target.textContent='匯入中…';
        try{const r=await fetch(`${C.base}/commit`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:d.token})});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||'匯入失敗');done=true;result(x);}
        catch(err){alert(err.message);e.target.disabled=false;e.target.textContent='確認匯入';}};
    }
    // ---------- ④ ----------
    function result(x){
      const s=x.summary;const cr=x.created||[];const failed=x.reports.filter(r=>r.action==='錯誤');
      frame(4,`<div class="xi-sum">${s.create?`<b class="xi-c">已新增 ${s.create} 人</b>`:''}${s.update?`<b class="xi-u">已更新 ${s.update} 人</b>`:''}${failed.length?`<b class="xi-e">${failed.length} 列未匯入</b>`:''}</div>
        ${cr.length?`<div class="xi-card"><h3>🔑 新帳號的臨時密碼</h3><p class="hint" style="margin-top:0"><b>這份清單只會顯示這一次</b>，請現在下載或列印，交給每位人員本人。第一次登入時必須自行修改密碼。請不要張貼在公開的群組。</p>
          <div class="xi-row" style="margin-bottom:8px"><button type="button" id="xiCsv">下載清單（Excel 可開）</button><button type="button" class="secondary" id="xiPrint">列印開通通知</button></div>
          <div class="xi-wrap" style="max-height:40vh"><table class="xi-t"><thead><tr><th>員編</th><th>姓名</th><th>職位</th><th>登入帳號</th><th>臨時密碼</th></tr></thead><tbody>${cr.map(c=>`<tr><td>${esc(c.employee_id)}</td><td>${esc(c.name)}</td><td>${esc(c.position)}</td><td>${esc(c.mobile||c.employee_id)}</td><td class="xi-pw">${esc(c.temp_password)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
        ${failed.length?`<div class="xi-card"><h3>未匯入的列</h3><div class="xi-wrap" style="max-height:28vh"><table class="xi-t"><thead><tr><th>Excel 列</th><th>員編</th><th>姓名</th><th>原因</th></tr></thead><tbody>${failed.map(r=>`<tr class="err"><td>${r.row}</td><td>${esc(r.employee_id)}</td><td>${esc(r.name)}</td><td class="msg-e">${esc(r.errors.join('；'))}</td></tr>`).join('')}</tbody></table></div><p class="hint" style="margin:8px 0 0">修改 Excel 後只上傳這幾列即可（已匯入的人重複上傳也只會更新，不會重複開通）。</p></div>`:''}
        <div class="xi-row" style="justify-content:flex-end"><button type="button" class="secondary" id="xiMore">再匯入一份</button><button type="button" id="xiClose">完成</button></div>`);
      back.querySelector('#xiClose').onclick=()=>{if(cr.length&&!confirm('臨時密碼清單關閉後就看不到了，確定已經下載或列印了嗎？'))return;close();};
      back.querySelector('#xiMore').onclick=()=>{if(cr.length&&!confirm('臨時密碼清單關閉後就看不到了，確定已經下載或列印了嗎？'))return;start();};
      const site=location.origin;
      back.querySelector('#xiCsv')?.addEventListener('click',()=>{const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv='﻿'+[['員編','姓名','職位','登入帳號','臨時密碼','登入網址'],...cr.map(c=>[c.employee_id,c.name,c.position,c.mobile||c.employee_id,c.temp_password,site])].map(r=>r.map(q).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`帳號開通清單_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);});
      back.querySelector('#xiPrint')?.addEventListener('click',()=>{const p=document.createElement('div');p.className='xi-print';p.style.display='none';
        p.innerHTML=cr.map(c=>`<div style="page-break-inside:avoid;border:1px dashed #999;border-radius:8px;padding:14px 18px;margin:0 0 14px;font-family:sans-serif"><div style="font-size:18px;font-weight:700;margin-bottom:6px">帳號開通通知</div><div>姓名：${esc(c.name)}（員編 ${esc(c.employee_id)}）　職位：${esc(c.position)}</div><div>登入帳號：<b>${esc(c.mobile||c.employee_id)}</b>　臨時密碼：<b style="font-family:monospace;font-size:16px">${esc(c.temp_password)}</b></div><div>登入網址：${esc(site)}</div><div style="color:#555;font-size:12px;margin-top:6px">第一次登入請立即修改密碼。密碼請勿告訴他人；這張通知看完請銷毀。</div></div>`).join('');
        document.body.appendChild(p);window.print();setTimeout(()=>p.remove(),1000);});
    }
    start();
  }
  window.ExcelImport={open};
})();
