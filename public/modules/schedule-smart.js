// 公司內勤：智慧月班表（人力需求、自動排班、缺人提示與補位、點格子微調、發布）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d={};try{d=await r.json()}catch{}if(!r.ok){if(d.must_change_password)window.PasswordModule?.force('/api/company/my');throw new Error(d.error||'操作失敗');}return d;}
  const J=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const S={month:null,cid:0};
  const CODE={work:'班',day:'日',night:'夜',off:'休',leave:'假','':'—'};
  function injectStyle(){
    if(document.getElementById('smartSchedStyle'))return;
    const s=document.createElement('style');s.id='smartSchedStyle';
    s.textContent=`
.ss-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.ss-bar input,.ss-bar select{width:auto;margin:0;padding:8px 10px}.ss-bar button{padding:8px 14px;min-height:0;margin:0}
.ss-pill{display:inline-block;padding:3px 12px;border-radius:999px;font-weight:800;font-size:.8rem}.ss-pill.draft{background:#fff3e0;color:#a35a00}.ss-pill.pub{background:#E8EEDF;color:#3E5328}.ss-pill.none{background:#eee;color:#666}
.ss-sum{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px}.ss-sum div{border-radius:10px;padding:8px 14px;font-weight:700;font-size:.88rem}.ss-sum .bad{background:#F6E3DC;color:#7A2E1A}.ss-sum .ok{background:#E8EEDF;color:#3E5328}.ss-sum .info{background:#F6ECE6;color:#5F403B}
.ss-wrap{overflow:auto;border:1px solid #E2D3CC;border-radius:12px;max-height:72vh;background:#fff}
.ss-grid{border-collapse:separate;border-spacing:0;font-size:.8rem;white-space:nowrap}
.ss-grid th,.ss-grid td{border-bottom:1px solid #F1E7E1;border-right:1px solid #F6EFEA;padding:0;text-align:center;min-width:30px;height:30px}
.ss-grid thead th{position:sticky;top:0;background:#F6ECE6;z-index:3;padding:4px 2px;font-size:.74rem;color:#5F403B}
.ss-grid thead th.red{color:#A44528;background:#F6E3DC}
.ss-grid .nm{position:sticky;left:0;background:#fff;z-index:2;text-align:left;padding:2px 10px;min-width:150px}
.ss-grid thead .nm{z-index:4;background:#F6ECE6}
.ss-grid .nm small{display:block;color:#9A6654;font-size:.72rem}
.ss-grid tr.grp td{background:#FCFAF1;font-weight:800;color:#5F403B;font-size:.74rem}.ss-grid tr.grp td.nm{background:#FCFAF1}
.ss-grid tr.grp td.short{background:#F6E3DC;color:#7A2E1A}.ss-grid tr.grp td.okc{color:#3E5328}
.ss-c{cursor:pointer;font-weight:700;position:relative}.ss-c:hover{outline:2px solid #A44528;outline-offset:-2px}
.ss-c.work,.ss-c.day{background:#fff;color:#1D0D0C}.ss-c.night{background:#3B2A27;color:#FCFAF1}.ss-c.off{background:#EFE6DF;color:#9A6654}.ss-c.leave{background:#F6E3DC;color:#7A2E1A}
.ss-c.red.off{background:#EBD9CF}.ss-c.other{background:#FFF6E6;color:#9A6654;font-size:.7rem}
.ss-c.lock::after{content:'';position:absolute;top:2px;right:2px;width:5px;height:5px;border-radius:50%;background:#A44528}
.ss-c.warn{box-shadow:inset 0 0 0 2px #C0392B}
.ss-menu{position:absolute;z-index:50;background:#fff;border:1px solid #E2D3CC;border-radius:10px;padding:6px;display:flex;gap:4px;box-shadow:0 8px 24px rgba(29,13,12,.15)}
.ss-menu button{padding:5px 10px;min-height:0;margin:0}
.ss-short{display:grid;gap:8px;margin-top:14px}
.ss-sh{border:1px solid #E2D3CC;border-left:4px solid #A44528;border-radius:10px;padding:9px 12px;background:#fff}
.ss-sh b{color:#7A2E1A}.ss-sh .sg{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ss-sh .sg button{padding:4px 10px;min-height:0;margin:0;font-size:.8rem}
.ss-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.78rem;color:#5F403B;margin-top:10px}.ss-legend span i{display:inline-block;width:16px;height:16px;border-radius:4px;vertical-align:-3px;margin-right:4px;border:1px solid #E2D3CC}
`;
    document.head.appendChild(s);
  }
  async function render(el){
    injectStyle();
    S.month=S.month||new Date(Date.now()+8*3600e3).toISOString().slice(0,7);
    el.innerHTML='<div class="profile-loading">讀取班表中…</div>';
    const d=await api(`/api/company/schedule/smart?month=${S.month}${S.cid?`&community_id=${S.cid}`:''}`);
    if(!d.community){el.innerHTML='<div class="empty">還沒有服務中的社區。</div>';return;}
    S.cid=d.community.id;
    const short=d.shortages.reduce((a,x)=>a+x.short,0);const pub=d.publish?.status==='published';
    const groupsUsed=d.groups.filter(g=>d.rows.some(r=>r.group===g.key)||d.cover[g.key].some(c=>c.need>0));
    const head=`<tr><th class="nm">人員</th>${d.days.map(x=>`<th class="${x.red?'red':''}">${Number(x.date.slice(8))}<br>${x.wd}</th>`).join('')}<th>上班</th><th>休</th></tr>`;
    const personRow=r=>`<tr><td class="nm"><b>${esc(r.name)}</b><small>${esc(r.position||'')}・${esc({red_holiday:'見紅休',rotation:'輪排休',fixed_monthly:'月休'}[r.rest_mode]||'')} ${r.rest_target} 天</small></td>${r.cells.map((c,i)=>{const other=c.code&&!c.here&&!['off','leave'].includes(c.code);return `<td class="ss-c ${other?'other':c.code}${d.days[i].red?' red':''}${c.locked?' lock':''}${c.streak_warn?' warn':''}" data-sid="${r.staff_id}" data-date="${c.date}" title="${esc([other?`支援 ${c.community}`:'',c.note,c.locked?'已手動調整（重新排班不會覆蓋）':'',c.streak_warn?`連續上班超過 ${d.max_consecutive} 天`:''].filter(Boolean).join('｜'))}">${other?'支':CODE[c.code]??c.code}</td>`;}).join('')}<td>${r.work}</td><td>${r.off}</td></tr>`;
    const groupRow=g=>`<tr class="grp"><td class="nm">${esc(g.label)}（需要／排定）</td>${d.cover[g.key].map(c=>`<td class="${c.have<c.need?'short':c.need?'okc':''}">${c.need?`${c.have}/${c.need}`:''}</td>`).join('')}<td></td><td></td></tr>`;
    const body=groupsUsed.map(g=>groupRow(g)+d.rows.filter(r=>r.group===g.key).map(personRow).join('')).join('')+(d.rows.some(r=>r.group==='mobile')?`<tr class="grp"><td class="nm">機動支援</td>${d.days.map(()=>'<td></td>').join('')}<td></td><td></td></tr>${d.rows.filter(r=>r.group==='mobile').map(personRow).join('')}`:'');
    el.innerHTML=`<div class="ss-bar"><input type="month" id="ssMonth" value="${esc(S.month)}"><select id="ssComm">${d.communities.map(c=>`<option value="${c.id}" ${c.id===S.cid?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      ${d.publish?`<span class="ss-pill ${pub?'pub':'draft'}">${pub?`已發布（${esc(d.publish.published_by||'')}）`:'草稿：現場人員還看不到'}</span>`:'<span class="ss-pill none">尚未排班</span>'}
      ${pub?'':'<button type="button" id="ssGen">🤖 智慧排班（全公司）</button>'}${d.can_staffing?'<button type="button" class="secondary" id="ssNeed">👥 人力需求</button>':''}${d.publish&&!pub?'<button type="button" class="secondary" id="ssPub">📣 發布班表</button>':''}${pub?'<button type="button" class="secondary" id="ssUnpub">↩ 撤回發布</button>':''}</div>
      <div class="ss-sum">${short?`<div class="bad">⚠ 本月 ${d.community.name} 缺 ${short} 個班次</div>`:d.rows.length?'<div class="ok">✓ 每天每班人力足額</div>':''}<div class="info">人力需求：${groupsUsed.map(g=>`${g.label} 平日 ${d.staffing.need[g.key].weekday}／假日 ${d.staffing.need[g.key].holiday}`).join('、')}${d.staffing.custom?'':'（預設值）'}</div></div>
      ${d.rows.length?`<div class="ss-wrap"><table class="ss-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>`:'<div class="empty">這個社區還沒有排班人員。請先在「公司人員管理」設定人員的職位與所屬社區。</div>'}
      <div class="ss-legend"><span><i style="background:#fff"></i>班／日班</span><span><i style="background:#3B2A27"></i>夜班</span><span><i style="background:#EFE6DF"></i>休</span><span><i style="background:#F6E3DC"></i>請假</span><span><i style="background:#FFF6E6"></i>支援其他社區</span><span><i style="background:#fff;box-shadow:inset 0 0 0 2px #C0392B"></i>連續上班超過 ${d.max_consecutive} 天</span><span>● 手動調整（重新排班不會覆蓋）</span><span>點格子可以調整</span></div>
      ${d.shortages.length?`<h3 style="margin:18px 0 6px">缺人與補位建議</h3><div class="ss-short">${d.shortages.map((x,i)=>`<div class="ss-sh"><b>${Number(x.date.slice(5,7))}/${Number(x.date.slice(8))}　${esc(x.group_label)} 缺 ${x.short} 人</b>（需要 ${x.need}、排定 ${x.have}）<div class="sg">${x.suggestions.length?x.suggestions.map(s=>`<button type="button" class="secondary" data-fill="${i}" data-sid="${s.staff_id}" title="${esc(s.label)}">指派 ${esc(s.name)}<small style="display:block;font-weight:400">${esc(s.label)}</small></button>`).join(''):'<span class="muted">找不到符合條件的人（同班別休假中、機動人員或同區域其他社區），可以考慮請人加班或調整其他人的休假。</span>'}</div></div>`).join('')}</div>`:''}
      <p class="hint" style="margin-top:12px">智慧排班會依每個人的休假制度（見紅休、輪排休、月休）、自選休假、已核准的假單與連續上班上限，優先把休假排在人力有餘裕的日子；保留手動調整、代班、調假的格子；機動人員自動補到缺人的社區。發布前現場人員看不到這個月的班表。</p>`;
    const again=()=>{const w=el.querySelector('.ss-wrap');const pos=w?[w.scrollLeft,w.scrollTop]:null;return render(el).then(()=>{const n=el.querySelector('.ss-wrap');if(n&&pos){n.scrollLeft=pos[0];n.scrollTop=pos[1];}});};
    el.querySelector('#ssMonth').addEventListener('change',e=>{S.month=e.target.value;render(el).catch(x=>alert(x.message));});
    el.querySelector('#ssComm').addEventListener('change',e=>{S.cid=Number(e.target.value);render(el).catch(x=>alert(x.message));});
    el.querySelector('#ssGen')?.addEventListener('click',async e=>{if(d.publish&&!confirm('重新排班會重排所有自動排的格子（手動調整、代班、調假、自選休假、請假會保留）。確定嗎？'))return;e.target.disabled=true;e.target.textContent='排班中…';try{const r=await api('/api/company/schedule/smart/generate',J('POST',{month:S.month}));await render(el);if(r.extra_off)alert(`已排好 ${r.people} 位人員的班表。\n有 ${r.extra_off} 天為了不超過連續上班上限而多排休。`);}catch(err){alert(err.message);e.target.disabled=false;}});
    el.querySelector('#ssPub')?.addEventListener('click',async()=>{if(short&&!confirm(`還有 ${short} 個班次缺人，確定要發布嗎？`))return;if(!confirm(`發布 ${S.month} 班表？所有人會收到通知，現場人員可以開始查看。`))return;try{await api('/api/company/schedule/smart/publish',J('POST',{month:S.month}));render(el);}catch(err){alert(err.message);}});
    el.querySelector('#ssUnpub')?.addEventListener('click',async()=>{if(!confirm('撤回後現場人員暫時看不到這個月的班表，確定嗎？'))return;try{await api('/api/company/schedule/smart/publish',J('POST',{month:S.month,unpublish:true}));render(el);}catch(err){alert(err.message);}});
    el.querySelector('#ssNeed')?.addEventListener('click',()=>openNeed(d,()=>render(el)));
    el.querySelectorAll('[data-fill]').forEach(b=>b.addEventListener('click',async()=>{const x=d.shortages[Number(b.dataset.fill)];try{const r=await api('/api/company/schedule/smart/fill',J('POST',{staff_id:Number(b.dataset.sid),community_id:S.cid,date:x.date,group:x.group}));if(r.overtime_id)alert('已指派。對方當天原本休假，已記一筆休假日加班。');again();}catch(err){alert(err.message);}}));
    el.querySelectorAll('.ss-c').forEach(td=>td.addEventListener('click',e=>{
      document.querySelectorAll('.ss-menu').forEach(m=>m.remove());
      const r=d.rows.find(x=>x.staff_id===Number(td.dataset.sid));if(!r)return;
      const opts=r.group==='guard_night'?[['night','夜班'],['off','休假']]:r.group==='guard_day'?[['day','日班'],['off','休假']]:r.group==='mobile'?[['day','日班'],['night','夜班'],['off','休假']]:[['work','上班'],['off','休假']];
      const m=document.createElement('div');m.className='ss-menu';m.innerHTML=opts.map(([v,l])=>`<button type="button" data-v="${v}" class="${v==='off'?'secondary':''}">${l}</button>`).join('')+'<button type="button" class="secondary" data-v="">清除</button>';
      document.body.appendChild(m);const rc=td.getBoundingClientRect();m.style.left=`${Math.min(window.scrollX+rc.left,window.scrollX+window.innerWidth-260)}px`;m.style.top=`${window.scrollY+rc.bottom+4}px`;
      m.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',async()=>{m.remove();try{await api('/api/company/schedule/smart/cell',J('POST',{staff_id:r.staff_id,community_id:S.cid,date:td.dataset.date,code:b.dataset.v}));again();}catch(err){alert(err.message);}}));
      setTimeout(()=>document.addEventListener('click',function h(ev){if(!m.contains(ev.target)){m.remove();document.removeEventListener('click',h);}}),0);
      e.stopPropagation();
    }));
  }
  function openNeed(d,done){
    const box=document.createElement('div');box.className='modal-backdrop';
    box.innerHTML=`<div class="modal" style="max-width:560px;width:min(560px,96vw)"><button type="button" class="modal-close">×</button><h2>👥 ${esc(d.community.name)}｜人力需求</h2><p class="hint">依社區合約，每天每班需要幾個人。「假日」是週末與國定假日。智慧排班會依這個人數安排休假，並標出缺人的日子。</p>
      <table class="cv-table" style="width:100%"><thead><tr><th>班別</th><th>平日</th><th>假日</th></tr></thead><tbody>${d.groups.map(g=>`<tr><td>${esc(g.label)}</td><td><input type="number" min="0" max="20" data-g="${g.key}" data-k="weekday" value="${d.staffing.need[g.key].weekday}" style="width:80px;margin:0"></td><td><input type="number" min="0" max="20" data-g="${g.key}" data-k="holiday" value="${d.staffing.need[g.key].holiday}" style="width:80px;margin:0"></td></tr>`).join('')}</tbody></table>
      <p class="hint">例如社區主管見紅休：平日 1、假日 0；保全 24 小時：日班、夜班平日假日都填 1。</p><div class="modal-actions"><button type="button" id="needSave">💾 儲存</button></div></div>`;
    document.body.appendChild(box);const close=()=>box.remove();box.querySelector('.modal-close').onclick=close;
    box.querySelector('#needSave').onclick=async()=>{const need={};box.querySelectorAll('[data-g]').forEach(i=>{need[i.dataset.g]=need[i.dataset.g]||{};need[i.dataset.g][i.dataset.k]=Number(i.value)||0;});try{await api(`/api/company/schedule/smart/staffing/${d.community.id}`,J('PUT',{need}));close();done();}catch(e){alert(e.message);}};
  }
  window.SmartSchedule={render};
})();
