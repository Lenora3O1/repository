// 兩步驟驗證（登入畫面用）：密碼正確後，輸入手機驗證 App 上的 6 位數；第一次登入時引導設定並顯示備用碼
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function css(){if(document.getElementById('tfaCss'))return;const s=document.createElement('style');s.id='tfaCss';s.textContent=`
  .tfa-back{position:fixed;inset:0;z-index:2700;background:rgba(29,13,12,.5);display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto}
  .tfa-box{background:#FCFAF1;color:#1D0D0C;border-radius:16px;max-width:460px;width:100%;padding:22px 20px;box-shadow:0 18px 50px rgba(0,0,0,.25);font-family:inherit;max-height:96vh;overflow:auto}
  .tfa-box h3{margin:0 0 6px;font-size:1.15rem}.tfa-box p,.tfa-box li{color:#5F403B;font-size:.92rem;line-height:1.6;margin:0 0 10px}.tfa-box ol{padding-left:20px;margin:0 0 10px}
  .tfa-qr{display:flex;justify-content:center;background:#fff;border-radius:12px;padding:10px;margin:6px 0 8px}.tfa-qr svg{width:190px;height:190px}
  .tfa-key{font-family:ui-monospace,Menlo,Consolas,monospace;background:#F3ECE6;border-radius:8px;padding:8px 10px;word-break:break-all;font-size:.86rem;text-align:center;letter-spacing:.05em}
  .tfa-code{font-size:1.6rem;letter-spacing:.35em;text-align:center;font-weight:800;width:100%;box-sizing:border-box;padding:10px;border:1px solid #D9C7BE;border-radius:12px;margin:6px 0}
  .tfa-err{color:#A52828;font-size:.88rem;min-height:1.2em;margin:4px 0}
  .tfa-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}.tfa-row button{min-width:96px}
  .tfa-link{all:unset;cursor:pointer;color:#7A5F58;font-size:.86rem;text-decoration:underline}
  .tfa-rec{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1rem;background:#fff;border:1px dashed #C9B3A8;border-radius:12px;padding:12px;margin:8px 0;text-align:center}`;document.head.appendChild(s);}
  function qrSvg(text){try{const q=window.qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true});}catch(e){return '';}}
  function modal(html){css();const b=document.createElement('div');b.className='tfa-back';b.innerHTML=`<div class="tfa-box" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(b);return b;}
  async function post(url,body){const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let d={};try{d=await r.json();}catch{}return {r,d};}
  // 顯示備用碼（只顯示這一次）
  function showRecovery(codes){return new Promise(resolve=>{const b=modal(`<h3>🧾 請抄下備用碼</h3><p>手機遺失或換手機時，可以用下面任一組備用碼登入（每組只能用一次）。<b>這個畫面關閉後就看不到了</b>，請抄在紙上或存在安全的地方，不要和密碼放在一起。</p>
    <div class="tfa-rec">${codes.map(c=>`<span>${esc(c)}</span>`).join('')}</div>
    <div class="tfa-row"><button type="button" class="secondary" data-copy>複製</button><button type="button" data-ok disabled>我已經抄好了</button></div>
    <label style="display:flex;gap:6px;align-items:center;font-size:.9rem;margin-top:8px"><input type="checkbox" data-chk style="width:auto;margin:0"> 我已經把備用碼抄下來／存好</label>`);
    b.querySelector('[data-chk]').onchange=e=>{b.querySelector('[data-ok]').disabled=!e.target.checked;};
    b.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(codes.join('\n'));b.querySelector('[data-copy]').textContent='✓ 已複製';}catch{}};
    b.querySelector('[data-ok]').onclick=()=>{b.remove();resolve();};});}
  // d：登入 API 回傳（need_2fa 或 setup_2fa）；url：送驗證碼的 API。成功時回傳最後的登入結果
  function run(d,url){return new Promise((resolve,reject)=>{
    const setup=!!d.setup_2fa;
    const b=modal((setup?`<h3>🔐 第一次登入：設定兩步驟驗證</h3>
      <p>為了保護公司與客戶資料，${esc(d.name||'您')}的帳號登入時除了密碼，還需要手機上的 6 位數驗證碼。</p>
      <ol><li>在手機安裝「Google Authenticator」或「Microsoft Authenticator」（免費）。</li><li>打開 App，按「＋」→「掃描 QR 碼」，掃下面的圖。</li><li>輸入 App 上顯示的 6 位數。</li></ol>
      <div class="tfa-qr">${qrSvg(d.otpauth)}</div>
      <details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:.88rem;color:#7A5F58">沒辦法掃描？改用手動輸入金鑰</summary><div class="tfa-key">${esc(String(d.secret||'').replace(/(.{4})/g,'$1 ').trim())}</div></details>`
      :`<h3>🔐 兩步驟驗證</h3><p>請打開手機上的驗證 App，輸入「鶴絲物業管理系統」目前顯示的 6 位數。</p>`)
      +`<input class="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${setup?6:12}" placeholder="000000" data-code>
      <div class="tfa-err" data-err></div>
      ${setup?'':'<button type="button" class="tfa-link" data-rec>手機不在身邊？改用備用碼</button>'}
      <div class="tfa-row"><button type="button" class="secondary" data-cancel>取消</button><button type="button" data-go>${setup?'完成設定並登入':'驗證並登入'}</button></div>`);
    const inp=b.querySelector('[data-code]'),err=b.querySelector('[data-err]');setTimeout(()=>inp.focus(),50);
    b.querySelector('[data-rec]')?.addEventListener('click',()=>{inp.placeholder='xxxxx-xxxxx';inp.style.letterSpacing='.1em';inp.removeAttribute('inputmode');inp.focus();});
    b.querySelector('[data-cancel]').onclick=()=>{b.remove();reject(new Error('已取消登入'));};
    const go=async()=>{const code=inp.value.trim();if(!code){err.textContent='請輸入驗證碼';return;}
      const btn=b.querySelector('[data-go]');btn.disabled=true;
      try{const {r,d:res}=await post(url,{code});if(!r.ok){err.textContent=res.error||'驗證失敗';btn.disabled=false;inp.select();if(/重新|逾時|上鎖|過多/.test(res.error||'')){setTimeout(()=>{b.remove();reject(new Error(res.error));},1600);}return;}
        b.remove();if(Array.isArray(res.recovery_codes)&&res.recovery_codes.length)await showRecovery(res.recovery_codes);resolve(res);}
      catch(e){err.textContent='連線失敗，請再試一次';btn.disabled=false;}};
    b.querySelector('[data-go]').onclick=go;inp.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  });}
  window.TwoFA={run,showRecovery};
})();
