// 薪資單顯示（現場職員資料、內勤我的薪資單、會計預覽共用）
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Math.round(Number(v)||0);
  const money=v=>n(v).toLocaleString('en-US');
  const monthLabel=m=>m?`${m.slice(0,4)} 年 ${Number(m.slice(5,7))} 月`:'';
  function injectStyle(){
    if(document.getElementById('payslipViewStyle'))return;
    const s=document.createElement('style');s.id='payslipViewStyle';
    s.textContent=`
.ps{font-size:.95rem}
.ps-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.ps-head small{color:#7A6E6A}
.ps-net{background:linear-gradient(135deg,#4E312D,#69453F);color:#fff;border-radius:16px;padding:14px 18px;margin:8px 0 14px;display:flex;justify-content:space-between;align-items:center}
.ps-net span{opacity:.85;font-weight:700}.ps-net b{font-size:1.7rem;letter-spacing:.02em}
.ps-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ps-box{border:1px solid #E9E3E1;border-radius:12px;overflow:hidden}
.ps-box h4{margin:0;padding:8px 12px;background:#F8F6F4;font-size:.88rem}
.ps-box.minus h4{background:#fdf3f2}
.ps-row{display:flex;justify-content:space-between;gap:10px;padding:7px 12px;border-top:1px solid #F3F1F0}
.ps-row span{color:#5D504C}.ps-row small{display:block;color:#958D8A;font-size:.76rem}
.ps-row.total{font-weight:800;background:#FCFBFA}
.ps-note{margin-top:12px;font-size:.82rem;color:#7A6E6A;line-height:1.6}
@media(max-width:640px){.ps-cols{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }
  function html(p){
    injectStyle();
    const ins=p.ins||{},ee=ins.employee||{},g=ins.grades||{};
    const row=(label,v,sub='')=>`<div class="ps-row"><span>${esc(label)}${sub?`<small>${esc(sub)}</small>`:''}</span><b>${money(v)}</b></div>`;
    const plus=[row('底薪',p.base,p.base_note),...(p.allowances||[]).map(a=>row(a.name,a.amount)),n(p.overtime)?row(p.overtime_label||'加班費',p.overtime,p.overtime_hours?`${p.overtime_hours} 小時`:''):'',n(p.other_add)?row('其他加項',p.other_add,p.other_add_note):''].join('');
    const minus=[n(ee.labor)?row('勞保費（含就保）',ee.labor,g.labor?`投保薪資 ${money(g.labor)}`:''):'',n(ee.health)?row('健保費',ee.health,`投保金額 ${money(g.health)}${n(ins.health_dependents)?`，含眷屬 ${n(ins.health_dependents)} 人`:''}`):'',n(ee.pension_self)?row('勞退自提',ee.pension_self,`${ins.pension_self_rate||0}%`):'',n(p.leave_deduct)?row('請假扣款',p.leave_deduct,(p.leave_lines||[]).map(l=>`${l.label} ${l.length}`).join('、')):'',n(p.attendance_deduct)?row(`${p.attendance_name||'全勤獎金'}扣減`,p.attendance_deduct):'',n(p.advance_deduct)?row('借資扣回',p.advance_deduct):'',...(p.deductions||[]).map(d=>row(d.name,d.amount,d.period)),n(p.other_deduct)?row('其他扣項',p.other_deduct,p.other_deduct_note):''].join('')||'<div class="ps-row"><span>無</span><b>0</b></div>';
    return `<div class="ps"><div class="ps-head"><div><div class="eyebrow">薪資單</div><h2 style="margin:2px 0">${esc(monthLabel(p.month))}</h2><small>${esc(p.name||'')} ${esc(p.employee_id||'')}${p.position?`｜${esc(p.position)}`:''}</small></div>${p.confirmed_at?'<span class="tag success">✓ 已確認</span>':''}</div>
      <div class="ps-net"><span>實發金額</span><b>$ ${money(p.net)}</b></div>
      <div class="ps-cols"><div class="ps-box"><h4>應發項目</h4>${plus}<div class="ps-row total"><span>應發合計</span><b>${money(p.gross)}</b></div></div>
      <div class="ps-box minus"><h4>應扣項目</h4>${minus}<div class="ps-row total"><span>應扣合計</span><b>${money(p.deduct_total)}</b></div></div></div>
      ${p.note?`<div class="ps-note">備註：${esc(p.note)}</div>`:''}
      <div class="ps-note">公司另為您負擔：勞保 ${money(ins.employer?.labor)}、職災 ${money(ins.employer?.occupational)}、健保 ${money(ins.employer?.health)}、勞退 6% ${money(ins.employer?.pension)} 元。<br>如有疑問請洽公司會計。</div></div>`;
  }
  window.PayslipView={html,money,monthLabel};
})();
