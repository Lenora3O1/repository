// 修改密碼：第一次登入（或管理員重設後）強制修改；平常可從職員資料／上方按鈕自行修改
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let forcing=false;
  function show(base,{force=false}={}){
    if(force&&forcing)return;if(force)forcing=true;
    document.getElementById('pwModal')?.remove();
    const box=document.createElement('div');box.className='modal-backdrop';box.id='pwModal';box.style.zIndex='9999';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-width:440px;width:min(440px,94vw)">${force?'':'<button type="button" class="modal-close" aria-label="關閉">×</button>'}
      <h2>🔑 ${force?'請先設定您的密碼':'修改密碼'}</h2>
      ${force?'<p class="hint">這是公司開通（或重設）時給您的臨時密碼。為了帳號安全，請改成只有您知道的密碼後再開始使用。</p>':''}
      <form id="pwForm" style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0">${force?'目前的臨時密碼':'目前的密碼'}<input type="password" name="cur" autocomplete="current-password" required></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0">新密碼<input type="password" name="n1" autocomplete="new-password" minlength="6" required><small class="muted" style="font-weight:400">至少 6 碼，不能和員編相同，避免 123456 這類容易猜到的密碼</small></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0">再輸入一次新密碼<input type="password" name="n2" autocomplete="new-password" required></label>
        <label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:500"><input type="checkbox" name="show" style="width:auto;margin:0"> 顯示密碼</label>
        <div id="pwMsg"></div>
        <div class="modal-actions">${force?`<button type="button" class="secondary" id="pwLogout">登出</button>`:'<button type="button" class="secondary" data-cancel>取消</button>'}<button type="submit">確認修改</button></div>
      </form></div>`;
    document.body.appendChild(box);document.body.classList.add('modal-open');
    const close=()=>{box.remove();document.body.classList.remove('modal-open');};
    box.querySelector('.modal-close')?.addEventListener('click',close);box.querySelector('[data-cancel]')?.addEventListener('click',close);
    box.querySelector('#pwLogout')?.addEventListener('click',async()=>{try{await fetch(`${base.replace(/\/my$/,'')}/logout`,{method:'POST',credentials:'same-origin'});}catch{}location.reload();});
    const f=box.querySelector('#pwForm');
    f.elements.show.addEventListener('change',()=>{for(const k of ['cur','n1','n2'])f.elements[k].type=f.elements.show.checked?'text':'password';});
    f.addEventListener('submit',async e=>{e.preventDefault();const msg=box.querySelector('#pwMsg');
      if(f.elements.n1.value!==f.elements.n2.value){msg.innerHTML='<div class="msg error">兩次輸入的新密碼不一樣</div>';return;}
      try{const r=await fetch(`${base}/password`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:f.elements.cur.value,new_password:f.elements.n1.value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'修改失敗');
        if(force){location.reload();return;}close();alert('密碼已修改，下次登入請使用新密碼。');
      }catch(err){msg.innerHTML=`<div class="msg error">${esc(err.message)}</div>`;}});
    setTimeout(()=>f.elements.cur.focus(),50);
  }
  window.PasswordModule={force:base=>show(base,{force:true}),open:base=>show(base)};
})();
