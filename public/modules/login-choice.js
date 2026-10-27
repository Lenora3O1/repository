// 登入：同一支手機在多家公司都有帳號、而且剛好密碼相同時，讓本人選擇要登入哪一家。
// 只會列出「密碼相符」的公司（伺服器端已過濾）。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function css(){if(document.getElementById('loginChoiceCss'))return;const s=document.createElement('style');s.id='loginChoiceCss';s.textContent=`
  .lc-back{position:fixed;inset:0;z-index:2600;background:rgba(29,13,12,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .lc-box{background:#FCFAF1;color:#1D0D0C;border-radius:16px;max-width:420px;width:100%;padding:22px 20px;box-shadow:0 18px 50px rgba(0,0,0,.25);font-family:inherit}
  .lc-box h3{margin:0 0 4px;font-size:1.15rem}.lc-box p{margin:0 0 14px;color:#7A5F58;font-size:.9rem;line-height:1.5}
  .lc-list{display:grid;gap:8px}.lc-item{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;padding:13px 14px;border:1px solid #E2D3CC;border-radius:12px;background:#fff;font-weight:700}
  .lc-item:hover,.lc-item:focus-visible{border-color:#A44528;box-shadow:0 0 0 3px rgba(164,69,40,.15)}
  .lc-ico{width:34px;height:34px;border-radius:9px;background:#E8DCD5;color:#5F403B;display:grid;place-items:center;flex:none;font-size:1rem}
  .lc-cancel{all:unset;cursor:pointer;display:block;margin:14px auto 0;color:#7A5F58;font-size:.88rem;text-decoration:underline}`;document.head.appendChild(s);}
  function choose(choices,msg){css();return new Promise(resolve=>{const b=document.createElement('div');b.className='lc-back';b.innerHTML=`<div class="lc-box" role="dialog" aria-modal="true" aria-label="選擇要登入的公司"><h3>請選擇要登入的公司</h3><p>${esc(msg||'這組帳號密碼在多家公司都可以登入。')}</p><div class="lc-list">${choices.map(c=>`<button type="button" class="lc-item" data-id="${Number(c.id)}"><span class="lc-ico">🏢</span><span>${esc(c.tenant_name)}</span></button>`).join('')}</div><button type="button" class="lc-cancel">取消</button></div>`;document.body.appendChild(b);const done=v=>{b.remove();resolve(v);};b.querySelectorAll('.lc-item').forEach(x=>x.onclick=()=>done(Number(x.dataset.id)));b.querySelector('.lc-cancel').onclick=()=>done(0);b.querySelector('.lc-item')?.focus();});}
  async function post(payload){const r=await fetch('/api/staff/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});let d={};try{d=await r.json()}catch{}return {r,d};}
  async function login(payload){
    let {r,d}=await post(payload);
    if(r.status===409&&d.needsChoice&&Array.isArray(d.choices)&&d.choices.length){
      const id=await choose(d.choices,d.error);if(!id)throw new Error('已取消登入');
      ({r,d}=await post({...payload,accountId:id}));
    }
    if(!r.ok){const e=new Error(d.error||'登入失敗');e.data=d;throw e;}
    return d;
  }
  window.LoginChoice={login,choose};
})();
