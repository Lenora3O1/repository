// 總後台：加值功能開通（依公司開關、到期日、備註）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const inp='margin:0;padding:6px 8px;border:1px solid #D8CECB;border-radius:8px;font:inherit';
  async function load(el){
    el.innerHTML='<div class="panel"><div class="profile-loading">讀取中…</div></div>';
    let d;try{d=await api('/api/admin/addons');}catch(e){el.innerHTML=`<div class="panel"><div class="msg error">${esc(e.message)}</div></div>`;return;}
    const keys=Object.keys(d.catalog);
    el.innerHTML=`<div class="panel"><div class="eyebrow">🧩 平台設定</div><h1>加值功能開通</h1><p class="hint">這些功能預設不開放，依公司需求（或另外收費）在這裡開通。可以設定到期日，到期後自動關閉；關閉後公司看不到相關目錄與資料（資料會保留，重新開通即可再使用）。</p>
      ${keys.map(k=>`<div style="margin-top:14px"><b style="font-size:1.05rem">${esc(d.catalog[k].name)}</b><div class="muted" style="font-size:.86rem">${esc(d.catalog[k].desc)}</div>
      <div style="overflow:auto;border:1px solid #E9E3E1;border-radius:12px;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:.88rem"><thead><tr style="background:#F6F4F2"><th style="padding:8px;text-align:left">公司</th><th style="text-align:left">狀態</th><th style="text-align:left">到期日（空白＝不限）</th><th style="text-align:left">備註（例如方案、收費）</th><th style="text-align:left">最後更新</th><th></th></tr></thead><tbody>
      ${d.tenants.map(t=>{const a=t.addons[k];return `<tr style="border-top:1px solid #F2EFEE" data-t="${t.id}" data-k="${k}"><td style="padding:8px"><b>${esc(t.name)}</b><br><small class="muted">${esc(t.code)}${t.status!=='active'?'（已停用）':''}</small></td>
        <td><label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:700"><input type="checkbox" data-f="enabled" ${a.switched_on?'checked':''} style="width:auto;margin:0"> 開通</label>${a.expired?'<small style="color:#A44528;font-weight:700">已到期</small>':a.enabled?'<small style="color:#3E5328;font-weight:700">使用中</small>':'<small class="muted">未開通</small>'}</td>
        <td><input type="date" data-f="expires_at" value="${esc(a.expires_at)}" style="${inp}"></td><td><input data-f="note" value="${esc(a.note)}" placeholder="例如：年約 2026/12 到期" style="${inp};width:100%"></td><td><small class="muted">${esc(String(a.updated_at||'').slice(0,16).replace('T',' '))}</small></td>
        <td><button type="button" data-save style="padding:5px 12px;min-height:0;margin:0">儲存</button></td></tr>`;}).join('')}</tbody></table></div></div>`).join('')}</div>`;
    el.querySelectorAll('[data-save]').forEach(b=>b.onclick=async()=>{const tr=b.closest('tr');const g=f=>tr.querySelector(`[data-f="${f}"]`);
      try{await api(`/api/admin/addons/${tr.dataset.t}/${tr.dataset.k}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:g('enabled').checked,expires_at:g('expires_at').value,note:g('note').value})});load(el);}catch(e){alert(e.message);}});
  }
  window.AddonsAdminModule={load};
})();
