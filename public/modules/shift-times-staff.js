// 現場：上下班時段（依社區合約的派駐配置）；社區主管、副主管、區域督導可申請變更
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const post=(u,b)=>api(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});
  const ST={pending:['審核中','#A44528'],approved:['已核准','#2F6B3A'],rejected:['已退回','#A52828'],cancelled:['已取消','#8B7770']};
  const SRC={person:'個人時段（公司設定）',contract:'依社區合約'};
  function css(){if(document.getElementById('stCss'))return;const s=document.createElement('style');s.id='stCss';s.textContent=`
  .st-card{background:#fff;border:1px solid #E8DCD5;border-radius:14px;padding:14px;margin:0 0 12px}.st-card h3{margin:0 0 8px;font-size:1.02rem}
  .st-mine{font-size:1.6rem;font-weight:800;color:#5F403B}.st-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 0;border-top:1px solid #F1E9E4}.st-row:first-of-type{border-top:0}
  .st-row small{display:block;color:#8B7770}.st-t{font-weight:800;color:#5F403B;white-space:nowrap;text-align:right}.st-form label{display:flex;flex-direction:column;gap:4px;font-weight:700;font-size:.9rem;margin-bottom:8px}
  .st-form input,.st-form select,.st-form textarea{width:100%;box-sizing:border-box}.st-g{display:grid;grid-template-columns:1fr 1fr;gap:8px}`;document.head.appendChild(s);}
  async function render(el,{label}={}){
    css();el.innerHTML='<div class="profile-loading">讀取中…</div>';
    let d;try{d=await api('/api/staff/shift-times');}catch(e){el.innerHTML=`<div class="msg error">${esc(e.message)}</div>`;return;}
    const can=d.communities.some(c=>c.can_request);
    el.innerHTML=`<div class="eyebrow">📅 班表</div><h1>${esc(label||'上下班時段')}</h1>
      <div class="st-card"><h3>我的上下班時間</h3>${d.mine?`<div class="st-mine">${esc(d.mine.start)}–${esc(d.mine.end)}</div><small class="muted">${d.mine.break_min?`休息 ${d.mine.break_min} 分鐘｜`:''}${SRC[d.mine.source]||'公司預設'}</small>`:'<div class="hint">尚未設定</div>'}<p class="hint" style="margin:8px 0 0">有排班的日子以班表的日班／夜班為準。</p></div>
      ${d.communities.map(c=>`<div class="st-card"><h3>🏢 ${esc(c.name)}</h3>${c.rows.length?c.rows.map(r=>`<div class="st-row"><div>${esc(r.position_name||'職位')}${r.shift_label?`｜${esc(r.shift_label)}`:''}<small>合約 ${r.count} 人${r.upcoming.length?`｜${esc(r.upcoming.map(x=>`${x.from} 起改為 ${x.start}–${x.end}`).join('；'))}`:''}</small></div><div class="st-t">${r.current?`${esc(r.current.start)}–${esc(r.current.end)}${r.current.break_min?`<small>休 ${r.current.break_min} 分</small>`:''}`:'<span class="muted">未設定</span>'}${c.can_request?`<br><button type="button" class="secondary" data-req="${c.id}|${r.contract_id}|${r.row_index}" style="padding:3px 10px;min-height:0;font-size:.8rem;margin-top:4px">申請變更</button>`:''}</div></div>`).join(''):'<div class="hint">這個社區的合約還沒有設定派駐職位</div>'}</div>`).join('')||'<div class="st-card hint">目前沒有駐點社區</div>'}
      ${can||d.requests.length?`<div class="st-card"><h3>我的變更申請</h3>${d.requests.length?d.requests.map(r=>`<div class="st-row"><div>${esc(r.community_name)}｜${esc(r.position_name)}<small>${r.old?.start?`${esc(r.old.start)}–${esc(r.old.end)} → `:''}<b>${esc(r.start)}–${esc(r.end)}</b>，${esc(r.effective_from)} 起｜${esc(r.basis)}</small>${r.comment?`<small>內勤回覆：${esc(r.comment)}</small>`:''}</div><div class="st-t" style="color:${ST[r.status][1]}">${ST[r.status][0]}${r.status==='pending'?`<br><button type="button" class="secondary" data-cancel="${r.id}" style="padding:3px 10px;min-height:0;font-size:.8rem;margin-top:4px">取消</button>`:''}</div></div>`).join(''):'<div class="hint">還沒有申請紀錄</div>'}</div>`:''}`;
    const again=()=>render(el,{label});
    el.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{if(!confirm('取消這筆申請？'))return;try{await post(`/api/staff/shift-requests/${b.dataset.cancel}/cancel`);again();}catch(e){alert(e.message);}});
    el.querySelectorAll('[data-req]').forEach(b=>b.onclick=()=>{const [cid,ctr,idx]=b.dataset.req.split('|').map(Number);const c=d.communities.find(x=>x.id===cid);const r=c.rows.find(x=>x.contract_id===ctr&&x.row_index===idx);form(el,c,r,again);});
  }
  function form(el,c,r,done){
    const t=new Date(Date.now()+8*3600e3).toISOString().slice(0,10);const cur=r.current||{};
    const back=document.createElement('div');back.style.cssText='position:fixed;inset:0;z-index:2600;background:rgba(29,13,12,.45);display:flex;align-items:flex-end;justify-content:center;padding:0';
    back.innerHTML=`<div class="st-form" style="background:#FCFAF1;border-radius:18px 18px 0 0;max-width:520px;width:100%;padding:18px 16px 22px;max-height:92vh;overflow:auto">
      <h3 style="margin:0 0 4px">申請變更上下班時段</h3><p class="hint" style="margin:0 0 10px">${esc(c.name)}｜${esc(r.position_name||'')}${r.shift_label?`（${esc(r.shift_label)}）`:''}｜目前 ${cur.start?`${esc(cur.start)}–${esc(cur.end)}`:'未設定'}。送出後由公司內勤審核，核准後從生效日起套用。</p>
      <div class="st-g"><label>上班<input type="time" id="rS" value="${esc(cur.start||'09:00')}"></label><label>下班<input type="time" id="rE" value="${esc(cur.end||'18:00')}"></label></div>
      <div class="st-g"><label>休息（分鐘）<input type="number" id="rB" min="0" max="240" step="10" value="${cur.break_min??0}"></label><label>生效日<input type="date" id="rF" min="${t}" value="${t}"></label></div>
      <label>社區同意的依據（必填）<input id="rBasis" placeholder="例如：11/3 管委會會議決議、主委書面同意"></label>
      <label>說明（選填）<textarea id="rR" rows="2" placeholder="例如：住戶反映晚上 7 點後仍有大量包裹"></textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="secondary" data-x>取消</button><button type="button" data-go>送出申請</button></div></div>`;
    document.body.appendChild(back);
    back.querySelector('[data-x]').onclick=()=>back.remove();
    back.querySelector('[data-go]').onclick=async()=>{const v=id=>back.querySelector(id).value;try{await post('/api/staff/shift-requests',{community_id:c.id,contract_id:r.contract_id,row_index:r.row_index,start:v('#rS'),end:v('#rE'),break_min:Number(v('#rB')),effective_from:v('#rF'),basis:v('#rBasis'),reason:v('#rR')});back.remove();alert('已送出，公司內勤審核後會更新');done();}catch(e){alert(e.message);}};
  }
  window.ShiftTimesStaff={render};
})();
