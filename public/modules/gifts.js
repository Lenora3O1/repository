// 禮品推放：現場工作台與公司內勤共用的瀏覽畫面（資料由總後台登記）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'讀取禮品資料失敗');return d;}
  function injectStyle(){
    if(document.getElementById('giftsModuleStyle'))return;
    const s=document.createElement('style');s.id='giftsModuleStyle';
    s.textContent=`
.gifts-module .gifts-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.gifts-module .gifts-head h1{margin:4px 0 6px}
.gifts-module .gifts-head p{margin:0;color:var(--ink-soft,#5f6f68)}
.gifts-search{position:relative;min-width:240px}
.gifts-search input{width:100%;box-sizing:border-box;border:1px solid #d6e2dc;border-radius:999px;padding:10px 14px 10px 36px;font:inherit;background:#fff;margin:0}
.gifts-search span{position:absolute;left:13px;top:50%;transform:translateY(-50%);opacity:.5}
.gifts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.gift-card{display:flex;flex-direction:column;border:1px solid #e1e9e5;border-radius:18px;background:#fff;overflow:hidden;transition:box-shadow .15s,transform .15s}
.gift-card:hover{box-shadow:0 10px 26px rgba(25,60,45,.10);transform:translateY(-2px)}
.gift-logo{aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;background:#f6f8f7;padding:18px;box-sizing:border-box;border-bottom:1px solid #eef2f0}
.gift-logo img{max-width:100%;max-height:100%;object-fit:contain}
.gift-logo .gift-logo-fallback{font-size:3rem;opacity:.6}
.gift-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.gift-body h3{margin:0;font-size:1.05rem;color:var(--ink,#1d2a25)}
.gift-body p{margin:0;font-size:.86rem;color:var(--ink-soft,#5f6f68);line-height:1.55}
.gift-links{display:flex;gap:8px;margin-top:auto;padding-top:6px;flex-wrap:wrap}
.gift-link{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 10px;border-radius:10px;font-weight:700;font-size:.88rem;text-decoration:none;white-space:nowrap;box-sizing:border-box}
.gift-link.web{background:#eef4f1;color:var(--accent-dark,#1B4D37);border:1px solid #d6e5dd}
.gift-link.web:hover{background:#e2eee8}
.gift-link.line{background:#06C755;color:#fff;border:1px solid #06C755}
.gift-link.line:hover{background:#05b04b}
.gift-link.is-disabled{opacity:.45;pointer-events:none}
.gifts-empty{text-align:center;padding:48px 16px;color:var(--ink-soft,#5f6f68)}
.gifts-empty div{font-size:2.6rem;margin-bottom:8px}
@media(max-width:560px){.gifts-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gift-body{padding:10px 10px 12px}.gift-links{flex-direction:column;gap:6px}.gift-link{flex:none;width:100%;font-size:.82rem;padding:8px 6px}.gift-logo{padding:12px}.gifts-search{min-width:0;width:100%}}
`;
    document.head.appendChild(s);
  }
  function card(g){
    const web=g.website_url?`<a class="gift-link web" href="${esc(g.website_url)}" target="_blank" rel="noopener noreferrer">🌐 禮品網頁</a>`:'';
    const line=g.line_url?`<a class="gift-link line" href="${esc(g.line_url)}" target="_blank" rel="noopener noreferrer">💬 官方 LINE</a>`:'';
    return `<article class="gift-card" data-name="${esc((g.name+' '+(g.description||'')).toLowerCase())}">
      <div class="gift-logo">${g.logo_url?`<img src="${esc(g.logo_url)}" alt="${esc(g.name)} LOGO" loading="lazy">`:'<span class="gift-logo-fallback">🎁</span>'}</div>
      <div class="gift-body"><h3>${esc(g.name)}</h3>${g.description?`<p>${esc(g.description)}</p>`:''}<div class="gift-links">${web}${line}${!web&&!line?'<span class="gift-link web is-disabled">尚未提供連結</span>':''}</div></div>
    </article>`;
  }
  async function render(container,label){
    injectStyle();
    const el=container||document.getElementById('staffHome');if(!el)return;
    const framed=el.classList.contains('panel');// 內勤工作區本身已是卡片，不再多包一層
    el.innerHTML=`<div class="${framed?'':'panel '}gifts-module"><div class="profile-loading">正在讀取禮品…</div></div>`;
    const panel=el.firstElementChild;
    try{
      const d=await api('/api/gifts');const gifts=Array.isArray(d.gifts)?d.gifts:[];
      panel.innerHTML=`<div class="gifts-head"><div><div class="eyebrow">🎁 合作推薦</div><h1>${esc(label||'禮品推放')}</h1><p>平台推薦的禮品與合作廠商，點選即可前往禮品網頁或加入官方 LINE。</p></div>${gifts.length>6?'<label class="gifts-search"><span aria-hidden="true">🔍</span><input type="search" id="giftsSearch" placeholder="搜尋禮品名稱"></label>':''}</div>
        ${gifts.length?`<div class="gifts-grid" id="giftsGrid">${gifts.map(card).join('')}</div><div class="gifts-empty" id="giftsNoMatch" hidden><div>🔍</div>沒有符合的禮品</div>`:'<div class="gifts-empty"><div>🎁</div>目前還沒有上架的禮品。</div>'}`;
      const input=panel.querySelector('#giftsSearch');
      if(input)input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();let n=0;panel.querySelectorAll('.gift-card').forEach(c=>{const ok=!q||c.dataset.name.includes(q);c.hidden=!ok;if(ok)n++;});panel.querySelector('#giftsNoMatch').hidden=n>0;});
    }catch(e){panel.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;}
  }
  window.GiftsModule={render};
})();
