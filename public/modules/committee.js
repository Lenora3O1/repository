// 管理委員會 → 本屆委員：管委會抬頭、任期、委員名單。
// 主任委員、監察委員、財務委員是固定職務（不能刪除，只能換人）；其他職務由經理、秘書新增。
// 選人可以直接從住戶名冊帶入；承租人、出租戶能不能擔任，依「社區資訊」的設定（不行的會反灰）。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,o={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const SRC={owner:'所有權人',tenant:'承租人',manual:'手動輸入'};
  const ROLES=['副主任委員','委員','公共事務委員','機電委員','環境委員','康樂委員','安全委員','秘書委員'];
  const tw=v=>{const t=new Date(v);return isNaN(t)?'':new Date(t.getTime()+8*3600e3).toISOString().slice(0,16).replace('T',' ');};
  function css(){if(document.getElementById('cmCss'))return;const s=document.createElement('style');s.id='cmCss';s.textContent=`
.cm{display:grid;gap:14px}.cm-card{border:1px solid #E6DCD8;border-radius:14px;padding:14px 16px;background:#fff;display:grid;gap:10px}.cm-card h3{margin:0;font-size:1.02rem;color:#4E322D;flex:1}
.cm-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cm-h button{margin:0}
.cm-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.cm-kv>div{border:1px solid #EFE6E2;border-radius:10px;padding:10px 12px;background:#FDFCFB}.cm-kv small{display:block;color:#7A5F58;font-weight:700;font-size:.78rem;margin-bottom:3px}
.cm-kv input{margin:0;padding:8px 10px;border:1px solid #D8CECB;border-radius:8px;font:inherit;width:100%;box-sizing:border-box}
.cm-list{display:grid;gap:8px}.cm-m{display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #EFE6E2;border-radius:12px;padding:10px 12px;background:#fff}
.cm-m.fixed{background:#FBF8F5}.cm-role{font-weight:800;color:#4E322D}.cm-role input{margin:0;padding:7px 9px;border:1px solid #D8CECB;border-radius:8px;font:inherit;width:100%;box-sizing:border-box}
.cm-who b{font-size:1.05rem}.cm-who .s{color:#7A5F58;font-size:.85rem}.cm-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.cm-acts button{margin:0;padding:5px 10px;min-height:0;font-size:.85rem}
.cm-tag{display:inline-block;padding:1px 8px;border-radius:999px;background:#F1EEEC;color:#6f625e;font-size:.75rem;font-weight:700;margin-left:4px}.cm-fix{background:#FBEAE3;color:#A44528}
.cm-muted{color:#7A5F58;font-size:.86rem}.cm-tip{background:#FBF8F5;border:1px solid #EDE3DE;border-radius:10px;padding:10px 12px;font-size:.88rem;color:#5d4a44;line-height:1.7}
@media(max-width:640px){.cm-m{grid-template-columns:1fr}.cm-acts{justify-content:flex-start}}
.cm-bg{position:fixed;inset:0;background:rgba(40,25,20,.42);z-index:3000;display:flex;align-items:center;justify-content:center;padding:14px}.cm-modal{background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}.cm-modal header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #EFE6E2}.cm-modal header h3{flex:1;margin:0}.cm-modal header button{margin:0}.cm-modal .body{padding:12px 16px;overflow:auto;display:grid;gap:8px}
.cm-modal input{margin:0;padding:9px 11px;border:1px solid #D8CECB;border-radius:8px;font:inherit;width:100%;box-sizing:border-box}.cm-modal label{display:flex;flex-direction:column;gap:5px;font-weight:700}
.cm-c{display:grid;gap:2px;text-align:left;border:1px solid #EFE6E2;border-radius:10px;padding:9px 12px;background:#fff;font:inherit;color:inherit;cursor:pointer;margin:0}.cm-c:hover:not(:disabled){border-color:#A44528}.cm-c:disabled{opacity:.45;cursor:not-allowed;background:#F5F3F2}
`;document.head.appendChild(s);}
  function modal(title,html){const bg=document.createElement('div');bg.className='cm-bg';bg.innerHTML=`<div class="cm-modal" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button type="button" class="secondary" data-x>關閉</button></header><div class="body">${html}</div></div>`;document.body.appendChild(bg);bg.close=()=>bg.remove();bg.querySelector('[data-x]').onclick=bg.close;bg.addEventListener('mousedown',e=>{if(e.target===bg)bg.close();});return bg;}

  async function render(host,label){
    css();host.innerHTML='<div class="panel"><div class="cm-muted">載入本屆委員…</div></div>';
    let d;try{d=await api('/api/staff/committee');}catch(e){host.innerHTML=`<div class="panel"><h1>${esc(label||'本屆委員')}</h1><div class="cm-tip">${esc(e.message)}</div></div>`;return;}
    view(host,label,d,false);
  }
  function view(host,label,d,editing){
    const P=d.profile;const st={head:{committee_name:P.committee_name,term_start:P.term_start,term_end:P.term_end,tax_id:P.tax_id},members:JSON.parse(JSON.stringify(P.members||[]))};
    const draw=()=>{
      const rule=`承租人${P.tenant_eligible?'可以':'不可以'}擔任；房子出租中的所有權人${P.landlord_eligible?'可以':'不可以'}擔任（依「社區資訊」設定）`;
      host.innerHTML=`<div class="panel"><div class="eyebrow">🏛 管理委員會</div><h1>${esc(label||'本屆委員')}</h1><div class="cm">
        <div class="cm-card"><div class="cm-h"><h3>${esc(P.committee_title||'管理委員會')}</h3>${d.can_edit&&!editing?'<button type="button" id="cmEdit">✏️ 編輯本屆委員</button>':''}</div>
          <div class="cm-kv">${editing?`<div><small>抬頭（管委會名稱）</small><input data-h="committee_name" maxlength="60" value="${esc(st.head.committee_name)}" placeholder="${esc(P.name?P.name+'管理委員會':'')}"></div><div><small>任期開始</small><input type="date" data-h="term_start" value="${esc(st.head.term_start)}"></div><div><small>任期結束</small><input type="date" data-h="term_end" value="${esc(st.head.term_end)}"></div><div><small>統一編號（選填）</small><input data-h="tax_id" maxlength="8" inputmode="numeric" value="${esc(st.head.tax_id)}"></div>`
            :`<div><small>任期</small><b>${P.term_start||P.term_end?`${esc(P.term_start||'—')}～${esc(P.term_end||'—')}`:'—'}</b></div><div><small>統一編號</small><b>${esc(P.tax_id||'—')}</b></div><div><small>委員人數</small><b>${(P.members||[]).filter(m=>m.name).length} 人</b></div>`}</div>
          <div class="cm-muted">委員資格：${esc(rule)}。</div></div>
        <div class="cm-card"><div class="cm-h"><h3>委員名單</h3>${editing?'<button type="button" class="secondary" id="cmAdd">＋ 新增職務</button>':''}</div>
          <div class="cm-list">${st.members.map((m,i)=>`<div class="cm-m ${m.fixed?'fixed':''}">
            <div class="cm-role">${editing&&!m.fixed?`<input data-role="${i}" list="cmRoles" maxlength="20" value="${esc(m.role)}" placeholder="職稱">`:`${esc(m.role)}${m.fixed?'<span class="cm-tag cm-fix">固定</span>':''}`}</div>
            <div class="cm-who">${m.name?`<b>${esc(m.name)}</b>${m.unit?`<span class="cm-tag">${esc(m.unit)}</span>`:''}<span class="cm-tag">${esc(SRC[m.source]||'手動輸入')}</span>${m.phone?`<div class="s">📞 ${esc(m.phone)}</div>`:''}`:'<span class="cm-muted">（尚未設定）</span>'}</div>
            <div class="cm-acts">${editing?`<button type="button" data-pick="${i}">從住戶選擇</button><button type="button" class="secondary" data-man="${i}">手動輸入</button>${m.name?`<button type="button" class="secondary" data-clr="${i}">清空</button>`:''}${m.fixed?'':`<button type="button" class="secondary" data-del="${i}" style="color:#a33131">刪除職務</button>`}`:''}</div></div>`).join('')}</div>
          <datalist id="cmRoles">${ROLES.map(r=>`<option value="${r}">`).join('')}</datalist>
          ${editing?`<div class="cm-h"><button type="button" class="secondary" id="cmCancel">取消</button><button type="button" id="cmSave">💾 儲存本屆委員</button></div><div class="cm-muted">主任委員、監察委員、財務委員是固定職務，不能刪除；改選後直接換人即可。存證信函的寄件人會自動帶入主任委員。</div>`
            :`${(P.committee_updated_at)?`<div class="cm-muted">最後更新：${esc(tw(P.committee_updated_at))} ${esc(P.committee_updated_by)}</div>`:''}`}
        </div></div></div>`;
      if(!editing){host.querySelector('#cmEdit')?.addEventListener('click',()=>view(host,label,d,true));return;}
      host.querySelectorAll('[data-h]').forEach(i=>i.oninput=()=>st.head[i.dataset.h]=i.value);
      host.querySelectorAll('[data-role]').forEach(i=>i.oninput=()=>st.members[Number(i.dataset.role)].role=i.value);
      host.querySelector('#cmAdd').onclick=()=>{st.members.push({role:'委員',fixed:false,name:'',unit:'',phone:'',source:'manual'});draw();};
      host.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{st.members.splice(Number(b.dataset.del),1);draw();});
      host.querySelectorAll('[data-clr]').forEach(b=>b.onclick=()=>{Object.assign(st.members[Number(b.dataset.clr)],{name:'',unit:'',phone:'',source:'manual',ref_id:null});draw();});
      host.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>pick(st.members[Number(b.dataset.pick)],c=>{Object.assign(st.members[Number(b.dataset.pick)],{name:c.name,unit:c.unit,phone:c.phone,source:c.source,ref_id:c.ref_id});draw();}));
      host.querySelectorAll('[data-man]').forEach(b=>b.onclick=()=>manual(st.members[Number(b.dataset.man)],v=>{Object.assign(st.members[Number(b.dataset.man)],v,{source:'manual',ref_id:null});draw();}));
      host.querySelector('#cmCancel').onclick=()=>view(host,label,d,false);
      host.querySelector('#cmSave').onclick=async()=>{try{const x=await api('/api/staff/committee',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...st.head,members:st.members})});d.profile=x.profile;view(host,label,d,false);}catch(e){alert(e.message);}};
    };
    draw();
  }
  async function pick(m,done){
    const bg=modal(`選擇「${m.role||'委員'}」`,'<input id="cpQ" placeholder="搜尋戶別或姓名"><div id="cpL" style="display:grid;gap:6px"><div class="cm-muted">載入中…</div></div>');
    let rows=[];try{const x=await api('/api/staff/committee/candidates');if(x.ack_required){bg.querySelector('#cpL').innerHTML='<div class="cm-tip">請先到「住戶名冊」閱讀並同意個資使用須知，才能從住戶選擇；也可以先用「手動輸入」。</div>';return;}rows=x.rows||[];}catch(e){bg.querySelector('#cpL').innerHTML=`<div class="cm-tip">${esc(e.message)}</div>`;return;}
    const draw=kw=>{const list=rows.filter(r=>!kw||`${r.unit}${r.name}`.includes(kw));
      bg.querySelector('#cpL').innerHTML=list.length?list.map(r=>`<button type="button" class="cm-c" data-i="${rows.indexOf(r)}" ${r.eligible?'':'disabled'}><div><b>${esc(r.unit)}</b>　${esc(r.name)}<span class="cm-tag">${esc(r.kind)}</span></div><div class="cm-muted">${r.eligible?(r.phone?`📞 ${esc(r.phone)}`:''):`⛔ ${esc(r.reason)}`}</div></button>`).join(''):'<div class="cm-muted">住戶名冊裡沒有符合的人；可以改用「手動輸入」。</div>';
      bg.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{bg.close();done(rows[Number(b.dataset.i)]);});};
    bg.querySelector('#cpQ').oninput=e=>draw(e.target.value.trim());draw('');
  }
  function manual(m,done){
    const bg=modal(`手動輸入「${m.role||'委員'}」`,`<label>姓名<input id="mN" maxlength="40" value="${esc(m.name||'')}"></label><label>戶別<input id="mU" maxlength="40" value="${esc(m.unit||'')}" placeholder="例如：3A2"></label><label>電話<input id="mP" maxlength="40" inputmode="tel" value="${esc(m.phone||'')}"></label><div class="cm-h"><button type="button" id="mOk">確定</button></div>`);
    bg.querySelector('#mN').focus();
    bg.querySelector('#mOk').onclick=()=>{const name=bg.querySelector('#mN').value.trim();if(!name){alert('請填寫姓名');return;}bg.close();done({name,unit:bg.querySelector('#mU').value.trim(),phone:bg.querySelector('#mP').value.trim()});};
  }
  window.CommitteeModule={render};
})();
