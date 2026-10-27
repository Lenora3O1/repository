// 總後台：各公司會計設定（傳票匯出格式、發票模式與加值中心串接、應支審核關卡）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={tid:null,fmt:null};
  const KIND={owner:'老闆／董事長',gm:'總經理',dept_head:'部門主管',dept_manager:'部門經理',region:'區域督導'};
  const PERM={'company-accounting':'會計','company-finance':'公司財務','company-general-affairs':'總務','company-hr':'人事'};
  function style(){if(document.getElementById('acaStyle'))return;const s=document.createElement('style');s.id='acaStyle';s.textContent=`
.aca-sec{margin:18px 0 8px;font-weight:800;color:#4E312D;border-top:1px solid #E9E3E1;padding-top:12px;font-size:1rem}
.aca-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px 16px}.aca-grid label{display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin:0}
.aca-grid input,.aca-grid select,.aca-t input,.aca-t select{margin:0;width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #D8CECB;border-radius:8px;background:#fff;font:inherit}
.aca-chk{flex-direction:row!important;align-items:center;gap:8px!important}.aca-chk input{width:auto!important}
.aca-t{border-collapse:collapse;width:100%;font-size:.86rem}.aca-t th,.aca-t td{padding:6px 8px;border-bottom:1px solid #F2EFEE;text-align:left;vertical-align:middle}.aca-t th{background:#F6F4F2;font-size:.78rem}.aca-t td button{padding:3px 9px;min-height:0;margin:0}
.aca-fmts{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.aca-fmt{border:1px solid #E2D3CC;border-radius:12px;padding:10px 12px;background:#fff}.aca-fmt.on{border-color:#A44528;background:#FCFAF1}
.aca-fmt button{padding:3px 10px;min-height:0;margin:6px 0 0}
.aca-cols{display:flex;flex-wrap:wrap;gap:6px}.aca-cols span{display:inline-flex;gap:4px;align-items:center;border:1px solid #C9B0A8;border-radius:999px;padding:3px 4px 3px 10px;font-size:.82rem;background:#fff}.aca-cols span button{padding:0 6px;min-height:0;margin:0;border-radius:999px;font-size:.75rem}
.aca-note{background:#fff7e5;border:1px solid #efd99c;border-radius:10px;padding:9px 12px;margin:8px 0;color:#7a5200;font-size:.86rem;line-height:1.6}
`;document.head.appendChild(s);}
  async function load(el){style();el.innerHTML='<div class="panel"><div class="profile-loading">正在讀取資料中，請稍候…</div></div>';try{S.list=await api('/api/admin/acct-settings');if(!S.tid)S.tid=S.list.tenants[0]?.id||null;await draw(el);}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;}}
  async function draw(el){
    if(!S.tid){el.innerHTML='<div class="panel"><div class="empty">還沒有公司。</div></div>';return;}
    const d=await api(`/api/admin/acct-settings/${S.tid}`);S.d=d;S.c=JSON.parse(JSON.stringify(d.settings));paint(el);
  }
  function paint(el){
    const L=S.list,c=S.c,d=S.d,inv=c.invoice;
    const fmtCard=k=>{const f=c.formats.custom[k];const on=c.formats.enabled.includes(k);return `<div class="aca-fmt${on?' on':''}"><label class="aca-chk" style="display:flex;font-weight:800"><input type="checkbox" data-en="${k}" ${on?'checked':''}> ${esc(f.name)}</label><div style="font-size:.78rem;color:#8A7E7A">${f.file==='xlsx'?'Excel':'CSV'}・${esc(L.encodings[f.encoding])}・${esc(L.date_formats[f.date])}</div>${on?`<label class="aca-chk" style="display:flex;font-size:.8rem;font-weight:600;margin-top:4px"><input type="radio" name="defFmt" value="${k}" ${c.formats.default===k?'checked':''}> 預設格式</label>`:''}<button type="button" class="secondary" data-ef="${k}">⚙️ 欄位設定</button></div>`;};
    const by=s=>`<select data-s="by">${[['perm','有某項權限的人'],['kind','職位類型'],['position','指定職位']].map(([v,l])=>`<option value="${v}" ${s.by===v?'selected':''}>${l}</option>`).join('')}</select>`;
    const val=s=>s.by==='perm'?`<select data-s="value">${Object.entries(PERM).map(([v,l])=>`<option value="${v}" ${s.value===v?'selected':''}>${l}</option>`).join('')}</select>`:s.by==='kind'?`<select data-s="value">${Object.entries(KIND).map(([v,l])=>`<option value="${v}" ${s.value===v?'selected':''}>${l}</option>`).join('')}</select>`:`<select data-s="value">${d.positions.map(p=>`<option value="${esc(p.id)}" ${s.value===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`;
    el.innerHTML=`<div class="panel"><div class="eyebrow">💰 平台設定</div><h1>會計設定（各公司客製化）</h1>
      <p class="hint">依各公司配合的會計師事務所軟體開通傳票匯出格式；設定發票開立方式與加值中心串接；設定公費款項申請的主管審核關卡與金額門檻。</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>公司</b><select id="caT" style="width:auto;margin:0">${L.tenants.map(t=>`<option value="${t.id}" ${t.id===S.tid?'selected':''}>${esc(t.name)}（${esc(t.code)}）${t.customized?' ✎':''}</option>`).join('')}</select><small class="muted">${d.customized?`已客製化，最後更新 ${esc(String(d.updated_at).slice(0,16).replace('T',' '))}`:'目前使用平台預設'}｜簽約公司：${d.entities.map(e=>esc(e.short_name||e.name)+(e.tax_id?`（${e.tax_id}）`:'')).join('、')||'尚未建立'}</small></div>
      <div class="aca-sec">傳票匯出格式</div>
      <p class="hint" style="margin:0 0 8px">勾選這家公司可以使用的格式。各軟體預設欄位是常見的傳票匯入欄位，請依事務所提供的匯入規格按「欄位設定」調整後再開通。${L.big5?'':'<b>（伺服器目前沒有 Big5 轉碼套件，Big5 格式會改用 UTF-8 匯出）</b>'}</p>
      <div class="aca-fmts">${Object.keys(L.presets).map(fmtCard).join('')}</div>
      <div id="caFmt"></div>
      <div class="aca-sec">發票</div>
      <div class="aca-grid"><label>發票開立方式<select id="ivM"><option value="manual" ${inv.mode==='manual'?'selected':''}>手開發票（開立後登錄號碼）</option><option value="einvoice" ${inv.mode==='einvoice'?'selected':''}>電子發票</option><option value="both" ${inv.mode==='both'?'selected':''}>兩種都有（每張請款單選擇）</option></select></label>
        <label class="aca-chk" style="display:flex;align-self:end"><input type="checkbox" id="ivE" ${inv.einvoice_enabled?'checked':''}> 開啟加值中心串接（系統直接開立電子發票）</label></div>
      <div id="ivBox" style="${inv.einvoice_enabled?'':'display:none'}"><div class="aca-grid" style="margin-top:10px"><label>加值中心<select id="ivP"><option value="">請選擇</option>${Object.entries(L.providers).map(([k,l])=>`<option value="${k}" ${inv.provider===k?'selected':''}>${l}</option>`).join('')}</select></label>
        <label>特店代號／MerchantID<input id="ivMid" value="${esc(inv.merchant_id)}"></label><label>HashKey<input id="ivK" value="${esc(inv.hash_key)}" autocomplete="off"></label><label>HashIV<input id="ivI" value="${esc(inv.hash_iv)}" autocomplete="off"></label><label>App Key／API 金鑰（光貿等）<input id="ivA" value="${esc(inv.app_key)}" autocomplete="off"></label>
        <label class="aca-chk" style="display:flex;align-self:end"><input type="checkbox" id="ivTest" ${inv.test_mode?'checked':''}> 測試環境（正式上線前請先用測試帳號驗證）</label></div>
        <div class="aca-note">金鑰只會存在伺服器，畫面上只顯示末 4 碼；不修改就保持原值。實際開立電子發票會在「公司應收」上線時啟用。</div></div>
      <div class="aca-sec">公司應支：審核關卡</div>
      <p class="hint" style="margin:0 0 8px">內勤人員都可以提出公費款項申請，依序經過下列主管關卡（主管在首頁直接審核），最後一關固定是「會計總審核」，通過後才進入公司應支。「金額門檻」填 0 表示每張都要審；填金額表示申請金額達到這個數字才需要這一關（例如超過 5 萬才要老闆核准）。</p>
      <table class="aca-t"><thead><tr><th>#</th><th>關卡名稱</th><th>審核對象</th><th>對象</th><th>金額門檻（元）</th><th></th></tr></thead><tbody>${c.ap_flow.map((s,i)=>`<tr data-i="${i}"><td>${i+1}</td><td><input data-s="name" value="${esc(s.name)}"></td><td>${by(s)}</td><td>${val(s)}</td><td><input data-s="min_amount" type="number" min="0" value="${s.min_amount}"></td><td style="white-space:nowrap"><button type="button" class="secondary" data-up="${i}">↑</button> <button type="button" class="secondary" data-rm="${i}">✕</button></td></tr>`).join('')}</tbody></table>
      <div style="margin:8px 0"><button type="button" class="secondary" id="flAdd" style="padding:5px 12px;min-height:0">＋ 新增關卡</button></div>
      <label class="aca-chk" style="display:flex;font-weight:700;font-size:.88rem"><input type="checkbox" id="apTax" ${c.ap_require_tax_id?'checked':''}> 公費款項的發票必須有本公司統編（三聯式）</label>
      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap"><button type="button" id="caSave">💾 儲存這家公司設定</button>${d.customized?'<button type="button" class="secondary" id="caReset">↩ 恢復平台預設</button>':''}<span id="caMsg" class="muted" style="align-self:center"></span></div></div>`;
    const sync=()=>{
      c.formats.enabled=[...el.querySelectorAll('[data-en]:checked')].map(x=>x.dataset.en);const df=el.querySelector('[name=defFmt]:checked');if(df)c.formats.default=df.value;
      Object.assign(c.invoice,{mode:el.querySelector('#ivM').value,einvoice_enabled:el.querySelector('#ivE').checked,provider:el.querySelector('#ivP').value,merchant_id:el.querySelector('#ivMid').value,hash_key:el.querySelector('#ivK').value,hash_iv:el.querySelector('#ivI').value,app_key:el.querySelector('#ivA').value,test_mode:el.querySelector('#ivTest').checked});
      c.ap_flow=[...el.querySelectorAll('tr[data-i]')].map(tr=>({name:tr.querySelector('[data-s=name]').value,by:tr.querySelector('[data-s=by]').value,value:tr.querySelector('[data-s=value]').value,min_amount:Number(tr.querySelector('[data-s=min_amount]').value)||0}));
      c.ap_require_tax_id=el.querySelector('#apTax').checked;};
    el.querySelector('#caT').onchange=e=>{S.tid=Number(e.target.value);S.fmt=null;draw(el).catch(x=>alert(x.message));};
    el.querySelectorAll('[data-en]').forEach(x=>x.onchange=()=>{sync();paint(el);});
    el.querySelector('#ivE').onchange=e=>{el.querySelector('#ivBox').style.display=e.target.checked?'':'none';};
    el.querySelectorAll('[data-s=by]').forEach(x=>x.onchange=()=>{sync();const i=Number(x.closest('tr').dataset.i);c.ap_flow[i].value=x.value==='perm'?'company-accounting':x.value==='kind'?'gm':(d.positions[0]?.id||'');paint(el);});
    el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{sync();c.ap_flow.splice(Number(b.dataset.rm),1);paint(el);});
    el.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{sync();const i=Number(b.dataset.up);if(i>0){[c.ap_flow[i-1],c.ap_flow[i]]=[c.ap_flow[i],c.ap_flow[i-1]];}paint(el);});
    el.querySelector('#flAdd').onclick=()=>{sync();c.ap_flow.push({name:'',by:'kind',value:'gm',min_amount:0});paint(el);};
    el.querySelectorAll('[data-ef]').forEach(b=>b.onclick=()=>{sync();S.fmt=b.dataset.ef;paint(el);});
    if(S.fmt)fmtEditor(el.querySelector('#caFmt'),S.fmt,()=>{sync();paint(el);});
    el.querySelector('#caSave').onclick=async()=>{sync();try{const r=await api(`/api/admin/acct-settings/${S.tid}`,J('PUT',c));S.list=await api('/api/admin/acct-settings');S.d.settings=r.settings;S.d.customized=true;S.c=JSON.parse(JSON.stringify(r.settings));paint(el);el.querySelector('#caMsg').textContent='✅ 已儲存';}catch(e){alert(e.message);}};
    el.querySelector('#caReset')?.addEventListener('click',async()=>{if(!confirm('恢復平台預設？'))return;try{await api(`/api/admin/acct-settings/${S.tid}`,{method:'DELETE'});S.list=await api('/api/admin/acct-settings');await draw(el);}catch(e){alert(e.message);}});
  }
  function fmtEditor(box,k,rerender){
    const L=S.list,f=S.c.formats.custom[k];
    const map=Object.entries(f.code_map||{}).map(([a,b])=>`${a}=${b}`).join('\n');
    box.innerHTML=`<div style="border:1px solid #C9B0A8;border-radius:12px;padding:12px 14px;margin-top:10px;background:#FCFAF1"><b>⚙️ ${esc(f.name)}：欄位設定</b>
      <div class="aca-grid" style="margin-top:8px"><label>顯示名稱<input id="fN" value="${esc(f.name)}"></label><label>檔案類型<select id="fFile"><option value="csv" ${f.file==='csv'?'selected':''}>CSV</option><option value="xlsx" ${f.file==='xlsx'?'selected':''}>Excel（xlsx）</option></select></label>
        <label>文字編碼（CSV）<select id="fEnc">${Object.entries(L.encodings).map(([v,l])=>`<option value="${v}" ${f.encoding===v?'selected':''}>${l}</option>`).join('')}</select></label><label>日期格式<select id="fDate">${Object.entries(L.date_formats).map(([v,l])=>`<option value="${v}" ${f.date===v?'selected':''}>${l}</option>`).join('')}</select></label>
        <label>借貸表示<select id="fDc">${Object.entries(L.dc_styles).map(([v,l])=>`<option value="${v}" ${f.dc_style===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="aca-chk" style="display:flex;align-self:end"><input type="checkbox" id="fHead" ${f.header?'checked':''}> 第一列是欄位標題</label></div>
      <p style="margin:12px 0 6px;font-weight:700;font-size:.88rem">欄位順序（點 ◀ ▶ 調整，✕ 移除）</p><div class="aca-cols" id="fCols">${f.columns.map((c,i)=>`<span>${esc(L.fields[c])}<button type="button" class="secondary" data-l="${i}">◀</button><button type="button" class="secondary" data-r="${i}">▶</button><button type="button" class="secondary" data-x="${i}">✕</button></span>`).join('')}</div>
      <div style="margin-top:6px"><select id="fAdd" style="width:auto"><option value="">＋ 加入欄位</option>${Object.entries(L.fields).filter(([v])=>!f.columns.includes(v)).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>
      <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;font-size:.86rem;margin-top:12px">科目代號對照（本系統代號＝事務所軟體代號，一行一個；沒有列的照原代號）<textarea id="fMap" rows="4" placeholder="1103=1113&#10;4101=4111" style="padding:8px;border:1px solid #D8CECB;border-radius:8px;font:inherit">${esc(map)}</textarea></label>
      <div style="margin-top:8px;display:flex;gap:8px"><button type="button" id="fOk">套用（記得按下方儲存）</button><button type="button" class="secondary" id="fCancel">關閉</button></div></div>`;
    const cols=[...f.columns];
    const read=()=>{f.name=box.querySelector('#fN').value;f.file=box.querySelector('#fFile').value;f.encoding=box.querySelector('#fEnc').value;f.date=box.querySelector('#fDate').value;f.dc_style=box.querySelector('#fDc').value;f.header=box.querySelector('#fHead').checked;f.columns=cols;
      f.code_map=Object.fromEntries(box.querySelector('#fMap').value.split('\n').map(x=>x.split('=').map(s=>s.trim())).filter(x=>x[0]&&x[1]));};
    box.querySelectorAll('[data-l]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.l);if(i>0)[cols[i-1],cols[i]]=[cols[i],cols[i-1]];read();fmtEditor(box,k,rerender);});
    box.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.r);if(i<cols.length-1)[cols[i+1],cols[i]]=[cols[i],cols[i+1]];read();fmtEditor(box,k,rerender);});
    box.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{cols.splice(Number(b.dataset.x),1);read();fmtEditor(box,k,rerender);});
    box.querySelector('#fAdd').onchange=e=>{if(e.target.value){cols.push(e.target.value);read();fmtEditor(box,k,rerender);}};
    box.querySelector('#fOk').onclick=()=>{read();S.fmt=null;rerender();};box.querySelector('#fCancel').onclick=()=>{S.fmt=null;rerender();};
  }
  window.AccountingAdminModule={load};
})();
