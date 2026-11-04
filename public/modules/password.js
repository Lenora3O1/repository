// 修改密碼：第一次登入（或管理員重設後）強制修改；平常可從職員資料／上方按鈕自行修改
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let forcing=false;
  // 密碼強度：和伺服器規則一致（至少 8 碼、英文＋數字、不是常見或連續的密碼），再依長度與字元種類給分
  const COMMON=['password','password1','passw0rd','qwerty123','abc12345','abcd1234','a1234567','aa123456','pass1234','admin123','iloveyou1','qwer1234','asdf1234','zxcv1234','test1234','user1234','abc123456','1qaz2wsx','qaz123456','a12345678','p@ssw0rd'];
  function strength(pw){
    const low=pw.toLowerCase(),seq='01234567890abcdefghijklmnopqrstuvwxyz',an=low.replace(/[^a-z0-9]/g,'');
    const weak=COMMON.includes(low)||/^(.)\1+$/.test(pw)||/(.)\1{4,}/.test(pw)||(an.length>=8&&(seq.includes(an)||seq.split('').reverse().join('').includes(an)));
    const rules=[[pw.length>=8,'至少 8 碼'],[/[A-Za-z]/.test(pw),'有英文字母'],[/\d/.test(pw),'有數字'],[!!pw&&!weak,'不是常見、重複或連續的密碼']];
    const ok=rules.every(r=>r[0]);
    let score=0;if(ok){score=1;const kinds=[/[a-z]/,/[A-Z]/,/\d/,/[^A-Za-z0-9]/].filter(r=>r.test(pw)).length;if(pw.length>=12)score++;if(pw.length>=16)score++;if(kinds>=3&&pw.length>=10)score++;score=Math.min(score,3);}
    return {rules,ok,level:pw?(ok?['','普通','強','很強'][score]:'太弱'):'',score:ok?score:0};
  }
  function meter(pw){
    const s=strength(pw);if(!pw)return '';
    const color=s.ok?['#C9822B','#C9822B','#4E8A3E','#2F6B3A'][s.score]:'#B23B3B';const w=s.ok?[0,40,70,100][s.score]:15;
    return `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700"><div style="flex:1;height:6px;border-radius:99px;background:#EADFD9;overflow:hidden"><div style="width:${w}%;height:100%;background:${color};transition:width .2s"></div></div><span style="color:${color};min-width:3em;text-align:right">${s.level}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:.8rem;font-weight:500">${s.rules.map(([ok,t])=>`<span style="color:${ok?'#2F6B3A':'#9A8A84'}">${ok?'✓':'○'} ${t}</span>`).join('')}</div>
      ${s.ok&&s.score<2?'<div style="font-size:.78rem;color:#7A5F58;margin-top:2px">再長一點（12 碼以上）會更安全</div>':''}`;
  }
  function show(base,{force=false}={}){
    if(force&&forcing)return;if(force)forcing=true;
    document.getElementById('pwModal')?.remove();
    const box=document.createElement('div');box.className='modal-backdrop';box.id='pwModal';box.style.zIndex='9999';
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-width:440px;width:min(440px,94vw)">${force?'':'<button type="button" class="modal-close" aria-label="關閉">×</button>'}
      <h2>🔑 ${force?'請先設定您的密碼':'修改密碼'}</h2>
      ${force?'<p class="hint">為了帳號安全，請先設定新密碼再開始使用（臨時密碼、或不符合新規則的簡單密碼都需要更換）。</p>':''}
      <form id="pwForm" style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0">目前的密碼<input type="password" name="cur" autocomplete="current-password" required></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-weight:700;margin:0">新密碼<input type="password" name="n1" autocomplete="new-password" minlength="8" required><small class="muted" style="font-weight:400">至少 8 碼，英文和數字都要有，不能包含帳號或手機，避免 abcd1234 這類容易猜到的密碼</small><div id="pwMeter" style="margin-top:4px"></div></label>
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
    f.elements.n1.addEventListener('input',()=>{box.querySelector('#pwMeter').innerHTML=meter(f.elements.n1.value);});
    f.elements.show.addEventListener('change',()=>{for(const k of ['cur','n1','n2'])f.elements[k].type=f.elements.show.checked?'text':'password';});
    f.addEventListener('submit',async e=>{e.preventDefault();const msg=box.querySelector('#pwMsg');
      if(f.elements.n1.value!==f.elements.n2.value){msg.innerHTML='<div class="msg error">兩次輸入的新密碼不一樣</div>';return;}
      if(!strength(f.elements.n1.value).ok){msg.innerHTML='<div class="msg error">新密碼還不符合規則，請看密碼下方的提示</div>';return;}
      try{const r=await fetch(`${base}/password`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:f.elements.cur.value,new_password:f.elements.n1.value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'修改失敗');
        if(force){location.reload();return;}close();alert('密碼已修改，下次登入請使用新密碼。');
      }catch(err){msg.innerHTML=`<div class="msg error">${esc(err.message)}</div>`;}});
    setTimeout(()=>f.elements.cur.focus(),50);
  }
  window.PasswordModule={force:base=>show(base,{force:true}),open:base=>show(base)};
})();
