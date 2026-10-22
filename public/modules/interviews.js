// 面試管理：面試人員的履歷、考核結果、操作情形；職務主管評分、錄取後開通帳號並帶入人事資料
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const ST={submitted:'w',reviewing:'w',hold:'d',hired:'ok',rejected:'x'};
  const mmss=s=>{s=Number(s)||0;return `${Math.floor(s/60)} 分 ${s%60} 秒`;};
  function style(){window.AccountingModule?.style?.();if(document.getElementById('ivStyle'))return;const s=document.createElement('style');s.id='ivStyle';s.textContent=`
.iv-pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.73rem;font-weight:800;white-space:nowrap}.iv-pill.d{background:#F6ECE6;color:#9A6654}.iv-pill.w{background:#fff3e0;color:#a35a00}.iv-pill.ok{background:#E8EEDF;color:#3E5328}.iv-pill.x{background:#eee;color:#888}
.iv-score{font-weight:900;color:#A44528;font-size:1.05rem}
.iv-sec{margin:14px 0 6px;font-weight:800;color:#5F403B;border-top:1px solid #F1E7E1;padding-top:10px}
.iv-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 16px;font-size:.9rem}.iv-kv div span{display:block;color:#9A6654;font-size:.76rem}
.iv-q{border:1px solid #E9E3E1;border-radius:12px;padding:10px 14px;margin-bottom:8px;background:#fff}.iv-q.ok{border-left:4px solid #6B8F4E}.iv-q.bad{border-left:4px solid #A44528}.iv-q.text{border-left:4px solid #C9B0A8}
.iv-q .o{padding:2px 6px;border-radius:6px;font-size:.88rem}.iv-q .o.ans{background:#E8EEDF;font-weight:700}.iv-q .o.pick{outline:2px solid #A44528}
.iv-q blockquote{margin:6px 0;padding:8px 12px;background:#FCFAF1;border-radius:8px;white-space:pre-wrap}
.iv-stars button{background:none;border:0;font-size:1.5rem;cursor:pointer;padding:0 2px;min-height:0;color:#C9B0A8}.iv-stars button.on{color:#A44528}
`;document.head.appendChild(s);}
  function modal(title,html){const bg=document.createElement('div');bg.className='ac-modal-bg';bg.innerHTML=`<div class="ac-modal"><button type="button" class="x">×</button><h3>${title}</h3>${html}</div>`;document.body.appendChild(bg);const close=()=>bg.remove();bg.querySelector('.x').onclick=close;return {box:bg.querySelector('.ac-modal'),close};}
  const S={status:'open',cat:''};
  async function render(el,label){
    style();const qs=new URLSearchParams({status:S.status});if(S.cat)qs.set('category',S.cat);
    const d=await api(`/api/company/interviews?${qs}`);
    const url=`${location.origin}/interview.html?c=${encodeURIComponent(d.tenant_code)}`;
    el.innerHTML=`<div class="eyebrow">📝 人事</div><h1>${esc(label||'面試管理')}</h1>
      <div class="ac-note">面試人員在公司電腦上從登入頁右下角的「📝 面試人員填寫履歷」進入（第一次使用請在面試電腦上打開 <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>，系統會記住公司）。只限電腦填寫；選擇題自動計分，情境題請在這裡評分。分數只有面試主管看得到。未錄取的資料 ${d.retention_months} 個月後自動刪除。${d.enabled?'':'<br><b class="ac-bad">目前總後台關閉了線上面試填寫。</b>'}</div>
      <div class="ac-bar">${[['open','待處理'],['hired','錄取'],['hold','備取'],['rejected','不錄取'],['all','全部']].map(([k,l])=>`<button type="button" data-st="${k}" class="${S.status===k?'':'secondary'}" style="border-radius:999px">${l}</button>`).join('')}${d.categories.length>1?`<select id="ivC"><option value="">全部類別</option>${d.categories.map(c=>`<option value="${c.id}" ${S.cat===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:''}</div>
      ${d.rows.length?`<div class="ac-wrap"><table class="ac-t"><thead><tr><th>姓名</th><th>應徵</th><th>經驗</th><th class="n">選擇題</th><th class="n">情境題</th><th>評等</th><th>操作情形</th><th>填寫時間</th><th>狀態</th></tr></thead><tbody>${d.rows.map(a=>`<tr class="click" data-a="${a.id}"><td><b>${esc(a.name)}</b><br><small class="ac-muted">${a.age?`${a.age} 歲　`:''}${esc(a.phone)}</small></td><td>${esc(a.category_name)}${a.position?`<br><small class="ac-muted">${esc(a.position)}</small>`:''}</td><td>${a.experienced?`有（${a.exp_years} 年）`:'沒有'}</td><td class="n"><span class="iv-score">${a.auto_score}</span>／${a.auto_max}</td><td class="n">${a.manual_done?`<span class="iv-score">${a.manual_score}</span>／${a.manual_max}`:`<span class="iv-pill w">待評分</span>`}</td><td>${a.rating?'★'.repeat(a.rating):''}</td><td class="ac-muted" style="font-size:.8rem">全程 ${mmss(a.metrics.total_seconds)}${a.metrics.paste_blocked?`<br>嘗試貼上 ${a.metrics.paste_blocked} 次`:''}${a.metrics.blur?`<br>切換視窗 ${a.metrics.blur} 次`:''}</td><td>${String(a.submitted_at||'').slice(0,16).replace('T',' ')}</td><td><span class="iv-pill ${ST[a.status]}">${esc(a.status_label)}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前沒有面試資料。</div>'}`;
    const again=()=>render(el,label).catch(e=>alert(e.message));
    el.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{S.status=b.dataset.st;again();});el.querySelector('#ivC')?.addEventListener('change',e=>{S.cat=e.target.value;again();});
    el.querySelectorAll('[data-a]').forEach(r=>r.onclick=()=>view(Number(r.dataset.a),again));
  }
  async function view(id,again){
    const {applicant:a}=await api(`/api/company/interviews/${id}`);const r=a.resume;const m=a.metrics;
    const L=String.fromCharCode;const q=x=>{
      if(x.type==='text')return `<div class="iv-q text"><b>${esc(x.text)}</b> <small class="ac-muted">（${x.points} 分）</small><blockquote>${esc(x.response||'（沒有作答）')}</blockquote><label style="display:flex;gap:8px;align-items:center;margin:0;font-weight:700;font-size:.88rem">評分<input type="number" min="0" max="${x.points}" data-m="${x.id}" value="${x.manual??''}" style="width:90px;margin:0"> ／ ${x.points}</label></div>`;
      const pick=Array.isArray(x.response)?x.response:[x.response];const ans=Array.isArray(x.answer)?x.answer:[x.answer];
      return `<div class="iv-q ${x.correct?'ok':'bad'}"><b>${x.correct?'✅':'❌'} ${esc(x.text)}</b> <small class="ac-muted">（${x.points} 分${x.type==='multi'?'・複選':''}）</small><div>${x.options.map((o,k)=>`<div class="o${ans.includes(k)?' ans':''}${pick.includes(k)?' pick':''}">${L(65+k)}. ${esc(o)}${pick.includes(k)?'　← 作答':''}</div>`).join('')}</div>${x.explain?`<small class="ac-muted">說明：${esc(x.explain)}</small>`:''}</div>`;};
    const {box,close}=modal(`📝 ${esc(a.name)}　<span class="iv-pill ${ST[a.status]}">${esc(a.status_label)}</span>`,`<div class="ac-muted">應徵 ${esc(a.category_name)}${a.position?`｜${esc(a.position)}`:''}｜${a.experienced?`有相關經驗 ${a.exp_years} 年`:'沒有相關經驗'}｜填寫於 ${String(a.submitted_at||'').slice(0,16).replace('T',' ')}</div>
      <div class="ac-sum" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0"><div class="ac-note" style="margin:0">選擇題<br><span class="iv-score">${a.auto_score} / ${a.auto_max}</span></div><div class="ac-note" style="margin:0">情境題<br><span class="iv-score">${a.manual_done?`${a.manual_score} / ${a.manual_max}`:'待評分'}</span></div><div class="ac-note" style="margin:0">填寫時間<br>履歷 ${mmss(m.resume_seconds)}<br>作答 ${mmss(m.quiz_seconds)}</div><div class="ac-note" style="margin:0">電腦操作<br>輸入 ${m.chars||0} 字、按鍵 ${m.keys||0} 次<br>${m.paste_blocked?`嘗試貼上 ${m.paste_blocked} 次、`:''}切換視窗 ${m.blur||0} 次</div></div>
      <div class="iv-sec">基本資料</div><div class="iv-kv"><div><span>性別／生日</span>${r.gender==='F'?'女':r.gender==='M'?'男':'—'}　${esc(r.birthday||'')}${a.age?`（${a.age} 歲）`:''}</div><div><span>${r.id_type==='arc'?'居留證':r.id_type==='passport'?'護照':'身分證'}</span>${esc(r.id_no||'')}${r.nationality?`（${esc(r.nationality)}）`:''}</div><div><span>手機／Email</span>${esc(r.phone||'')}<br>${esc(r.email||'')}</div><div><span>地址</span>${esc(r.address||'')}</div><div><span>緊急聯絡人</span>${esc([r.emergency_name,r.emergency_relation,r.emergency_phone].filter(Boolean).join(' '))}</div><div><span>通勤／班別意願</span>${esc([r.transport,r.shift_pref].filter(Boolean).join('／')||'—')}</div><div><span>可上班日／期望月薪</span>${esc(r.available_date||'—')}／${r.expected_salary?Number(r.expected_salary).toLocaleString():'—'}</div></div>
      <div class="iv-sec">學歷</div>${(r.education||[]).map(e=>`<div>${esc(e.school)} ${esc(e.major)} ${esc(e.degree)} ${esc(e.status)}</div>`).join('')||'<div class="ac-muted">未填</div>'}
      <div class="iv-sec">工作經歷</div>${(r.work||[]).length?`<table class="ac-t"><thead><tr><th>公司</th><th>職稱</th><th>期間</th><th>工作內容</th><th>離職原因</th></tr></thead><tbody>${r.work.map(w=>`<tr><td>${esc(w.company)}</td><td>${esc(w.title)}</td><td>${esc(w.start)}～${esc(w.end)}</td><td>${esc(w.duty)}</td><td>${esc(w.reason)}</td></tr>`).join('')}</tbody></table>`:'<div class="ac-muted">未填</div>'}
      <div class="iv-sec">證照與技能</div><div>${esc([...(r.licenses||[]),r.other_license].filter(Boolean).join('、')||'—')}</div>
      <div class="iv-sec">自我介紹</div><blockquote style="white-space:pre-wrap;margin:0;padding:8px 12px;background:#FCFAF1;border-radius:8px">${esc(r.intro||'')}</blockquote>
      <div class="iv-sec">考核作答</div>${a.questions.map(q).join('')}
      <div class="iv-sec">面試評語</div>${a.comments.map(c=>`<div class="ac-muted">${String(c.at).slice(0,16).replace('T',' ')} ${esc(c.by)}：${esc(c.text)}</div>`).join('')}
      <div class="iv-stars" style="margin:8px 0">整體評等 ${[1,2,3,4,5].map(n=>`<button type="button" data-r="${n}" class="${(a.rating||0)>=n?'on':''}">★</button>`).join('')}</div>
      <textarea id="ivCm" rows="2" placeholder="面談評語（選填）" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #DDCCC4;border-radius:8px;font:inherit"></textarea>
      <div class="foot"><button type="button" class="secondary" id="ivDel">刪除資料</button><button type="button" class="secondary" id="ivSave">💾 儲存評分</button><button type="button" class="secondary" data-d="rejected">不錄取</button><button type="button" class="secondary" data-d="hold">備取</button><button type="button" data-d="hired">✅ 錄取</button>${a.status==='hired'&&!a.staff_id?'<button type="button" id="ivHire">👤 開通員工帳號</button>':''}${a.staff_id?'<span class="ac-ok">已轉為員工</span>':''}</div>`);
    let rating=a.rating||null;box.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{rating=Number(b.dataset.r);box.querySelectorAll('[data-r]').forEach(x=>x.classList.toggle('on',Number(x.dataset.r)<=rating));});
    const save=async decision=>{const manual={};box.querySelectorAll('[data-m]').forEach(i=>{if(i.value!=='')manual[i.dataset.m]=Number(i.value);});await api(`/api/company/interviews/${a.id}/review`,J('POST',{manual,rating,comment:box.querySelector('#ivCm').value,decision}));};
    box.querySelector('#ivSave').onclick=async()=>{try{await save();close();again();}catch(e){alert(e.message);}};
    box.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{try{await save(b.dataset.d);close();if(b.dataset.d==='hired'&&confirm('已標記錄取。要現在開通員工帳號，並把履歷資料帶進人事資料嗎？'))hire(a,again);else again();}catch(e){alert(e.message);}});
    box.querySelector('#ivHire')?.addEventListener('click',()=>{close();hire(a,again);});
    box.querySelector('#ivDel').onclick=async()=>{if(!confirm('刪除這位面試人員的所有資料？無法復原。'))return;try{await api(`/api/company/interviews/${a.id}`,{method:'DELETE'});close();again();}catch(e){alert(e.message);}};
  }
  async function hire(a,again){
    let org=null;try{org=await api('/api/company/org');}catch{}
    const pos=org?.config?.positions||[];const comms=org?.communities||[];
    const {box,close}=modal(`👤 開通員工帳號：${esc(a.name)}`,`<p class="ac-muted">開通後會把履歷中的身分證字號、生日、性別、手機、地址、緊急聯絡人帶進「人事管理」。${org?'':'<br><b class="ac-bad">您沒有開通帳號的權限：請人事先在「公司人員管理」開通，再輸入員編連結資料。</b>'}</p>
      <div class="ac-form"><label>員編<input id="hE" placeholder="例如 G015"></label>${org?`<label>職位<select id="hP">${pos.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label class="half">駐點社區（現場職位）<select id="hC" multiple size="4">${comms.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><label>初始密碼<input id="hW" value="${esc(String(a.phone||'').replace(/\D/g,'').slice(-6)||'')}"><small class="ac-muted" style="font-weight:400">第一次登入會要求修改</small></label>`:''}</div>
      <div class="foot"><button type="button" class="secondary" id="hX">取消</button>${org?'<button type="button" class="secondary" id="hL">只連結既有員編</button><button type="button" id="hGo">開通並帶入資料</button>':'<button type="button" id="hL">連結員編</button>'}</div>`);
    box.querySelector('#hX').onclick=close;
    const link=async()=>{await api(`/api/company/interviews/${a.id}/link`,J('POST',{employee_id:box.querySelector('#hE').value.trim()}));};
    box.querySelector('#hL').onclick=async()=>{try{await link();alert('已把履歷資料帶進人事資料。');close();again();}catch(e){alert(e.message);}};
    box.querySelector('#hGo')?.addEventListener('click',async()=>{const eid=box.querySelector('#hE').value.trim();if(!eid){alert('請填寫員編');return;}const pw=box.querySelector('#hW').value;if(pw.length<6){alert('初始密碼至少 6 碼');return;}
      try{await api('/api/company/org/staff',J('POST',{employee_id:eid,name:a.name,password:pw,position_id:box.querySelector('#hP').value,community_ids:[...box.querySelector('#hC').selectedOptions].map(o=>Number(o.value)),mobile:a.phone}));await link();alert(`已開通 ${eid}，並帶入人事資料。`);close();again();}catch(e){alert(e.message);}});
  }
  window.InterviewsModule={render};
})();
