// 人員開通管理：個人上下班時段（例外）。公司內勤、督導、主管或經公司同意的個人時段；社區人員一般依社區合約的派駐配置時段
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||'操作失敗');return d;}
  const post=(u,b)=>api(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});
  const today=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
  const SRC={person:'個人時段',contract:'社區合約',undefined:'公司預設'};
  async function open(staffId){
    const back=document.createElement('div');back.style.cssText='position:fixed;inset:0;z-index:2600;background:rgba(29,13,12,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto';document.body.appendChild(back);
    const close=()=>back.remove();
    async function draw(){
      let d;try{d=await api(`/api/company/work-hours/person-shifts/${staffId}`);}catch(e){alert(e.message);close();return;}
      const t=today();const active=r=>!r.removed_at&&r.from_date<=t&&(!r.to_date||r.to_date>=t);
      back.innerHTML=`<div style="background:#FCFAF1;border-radius:16px;max-width:720px;width:100%;padding:20px 20px 16px;box-shadow:0 18px 50px rgba(0,0,0,.25)">
        <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">🕘 上下班時段｜${esc(d.person.name)} <small class="muted">${esc(d.person.employee_id)}</small></h3><button type="button" class="secondary" data-x style="padding:4px 10px;min-height:0">✕</button></div>
        <p class="hint">目前適用：<b>${d.current?`${esc(d.current.start)}–${esc(d.current.end)}${d.current.break_min?`（休息 ${d.current.break_min} 分）`:''}`:'—'}</b>，來源：${SRC[d.current?.source]||'公司預設'}。<br>社區人員一般依「社區合約 → 派駐配置」的時段，人員調到哪個社區就照該社區時間；只有公司內勤、督導、主管或經公司同意的特殊情況，才需要設定個人時段。</p>
        <table class="ct-table" style="width:100%;min-width:0;font-size:.88rem"><thead><tr><th>時段</th><th>期間</th><th>原因</th><th>設定人</th><th></th></tr></thead><tbody>
        ${d.rows.length?d.rows.map(r=>`<tr style="${r.removed_at?'opacity:.5':''}"><td><b>${esc(r.start)}–${esc(r.end)}</b>${r.break_min?`<br><small class="muted">休息 ${r.break_min} 分</small>`:''}</td><td>${r.from_date==='2000-01-01'?'一直以來':esc(r.from_date)} 起${r.to_date?`<br>至 ${esc(r.to_date)}`:''}${active(r)?' <b style="color:#2F6B3A">（使用中）</b>':''}${r.removed_at?'<br><small>已取消</small>':''}</td><td>${esc(r.reason)}</td><td><small>${esc(r.created_by)}<br>${esc(String(r.created_at).slice(0,10))}</small></td><td>${!r.removed_at&&(!r.to_date||r.to_date>=t)?`<button type="button" class="secondary" data-rm="${r.id}" style="padding:3px 8px;min-height:0">停用</button>`:''}</td></tr>`).join(''):'<tr><td colspan="5" class="hint">沒有設定個人時段</td></tr>'}
        </tbody></table>
        <h4 style="margin:14px 0 6px">＋ 新增個人時段</h4>
        <style>.ps-f label{display:flex;flex-direction:column;gap:4px;font-weight:700;font-size:.88rem}.ps-f input{width:100%;box-sizing:border-box}</style><div class="ps-f" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
          <label>上班<input type="time" id="psS" value="09:00"></label><label>下班<input type="time" id="psE" value="18:00"></label><label>休息（分鐘）<input type="number" id="psB" min="0" max="240" step="10" value="60"></label>
          <label>開始日<input type="date" id="psF" value="${t}"></label><label>結束日（可空白）<input type="date" id="psT"></label></div>
        <div class="ps-f" style="margin-top:8px"><label>原因（必填）<input id="psR" placeholder="例如：公司內勤統一 09:00–18:00、督導巡區時段、經公司同意的個人時段"></label></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" class="secondary" data-x>關閉</button><button type="button" id="psAdd">新增</button></div></div>`;
      back.querySelectorAll('[data-x]').forEach(b=>b.onclick=close);
      back.querySelectorAll('[data-rm]').forEach(b=>b.onclick=async()=>{if(!confirm('停用這個個人時段？\n已經開始的會設定到昨天為止，過去的出勤仍依原本時段計算。'))return;try{await post(`/api/company/work-hours/person-shifts/${staffId}/${b.dataset.rm}/remove`);draw();}catch(e){alert(e.message);}});
      back.querySelector('#psAdd').onclick=async()=>{const v=id=>back.querySelector(id).value;try{await post(`/api/company/work-hours/person-shifts/${staffId}`,{start:v('#psS'),end:v('#psE'),break_min:Number(v('#psB')),from_date:v('#psF'),to_date:v('#psT'),reason:v('#psR')});draw();}catch(e){alert(e.message);}};
    }
    draw();
  }
  window.PersonShift={open};
})();
