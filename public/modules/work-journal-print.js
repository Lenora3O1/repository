// 工作日誌列印版面（每日／每週），版面依「每日工作日誌」範本。
// JournalPrint.html(payload,community) 產生完整 HTML；JournalPrint.print(...) 以隱藏 iframe 列印（可另存 PDF）。
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nl=s=>esc(s).replace(/\n/g,'<br>');
  const WEEK='日一二三四五六';
  function rocDate(iso){const d=new Date(`${iso}T00:00:00`);return `${d.getFullYear()-1911}年${d.getMonth()+1}月${d.getDate()}日(星期${WEEK[d.getDay()]})`;}
  function md(iso){if(!iso)return '';const d=new Date(`${iso}T00:00:00`);return `${d.getMonth()+1}/${d.getDate()}`;}
  const num=v=>Number(String(v??'').replace(/[^\d.]/g,''))||0;
  const BASE_CATS=[['committee','管理委員會'],['resident','住戶交辦事項與問題處置'],['center','管理中心待辦事項'],['facility','公共設施相關修繕']];
  const CN='一二三四五六七八九十';const cn=i=>i<=10?CN[i-1]:(i<20?'十'+CN[i-11]:String(i));
  function catsFor(settings,items){const list=(settings?.tracking_categories||[]).map(c=>[c.key,c.label]);const out=list.length?list:BASE_CATS.slice();for(const t of items||[])if(!out.some(([k])=>k===t.category))out.push([t.category,t.category_label||'其他']);return out;}
  function customHtml(items,vals){vals=vals||{};return `<table>${items.map(c=>{const v=vals[c.id];const txt=Array.isArray(v)?v.join('、'):(v??'');return `<tr><th style="width:30%;text-align:left">${esc(c.label)}</th><td>${nl(txt)}</td></tr>`;}).join('')}</table>`;}
  const CSS=`
@page{size:A4;margin:14mm 12mm}
*{box-sizing:border-box}
body{font-family:'DFKai-SB','BiauKai','標楷體','Noto Serif TC','PMingLiU',serif;color:#000;font-size:11pt;line-height:1.45;margin:0;padding:16px}
h1{font-size:16pt;text-align:center;margin:0 0 2px;letter-spacing:.1em}
.doc-sub{text-align:center;font-size:12pt;margin:0 0 10px}
.doc-meta{display:flex;justify-content:space-between;font-size:9pt;color:#333;margin-bottom:6px;font-family:sans-serif}
h2{font-size:12pt;margin:14px 0 6px}
h3{font-size:11pt;margin:8px 0 4px}
table{width:100%;border-collapse:collapse;margin:0 0 8px;page-break-inside:auto}
tr{page-break-inside:avoid}
th,td{border:1px solid #000;padding:3px 5px;vertical-align:top;font-size:10pt}
th{background:#f0f0f0;font-weight:bold;text-align:center}
td.c{text-align:center}td.n{text-align:right;font-variant-numeric:tabular-nums}
.no{width:46px;text-align:center;white-space:nowrap}
.cat td{background:#f7f7f7;font-weight:bold}
.muted{color:#555}
.mark{background:#ff0}
.two{display:flex;gap:8px}.two>div{flex:1;min-width:0}
.sign{display:flex;justify-content:space-between;margin-top:18px;font-size:11pt}
.sign span{flex:1;border-top:1px solid #000;margin:0 8px;padding-top:4px;text-align:center}
.box{border:1px solid #000;padding:6px 8px;min-height:40px;margin-bottom:8px}
.up{margin:0 0 3px}
.abn{font-weight:bold}
@media screen{body{max-width:900px;margin:0 auto;background:#fff}}
`;
  function notesSection(data,roles){
    const notes=data.notes||{};const list=[...new Set([...(roles||[]),...Object.keys(notes)])];
    return list.map(role=>{const rows=(notes[role]||[]).filter(x=>x&&(x.text||x.remark));return `<h3>${esc(role)}</h3><table><tr><th class="no">項次</th><th>本日工作內容</th><th style="width:22%">備註</th></tr>${rows.length?rows.map((x,i)=>`<tr><td class="no">${i+1}</td><td>${nl(x.text)}</td><td>${nl(x.remark)}</td></tr>`).join(''):'<tr><td class="no">1</td><td></td><td></td></tr>'}</table>`;}).join('');
  }
  function constructionSection(data){
    const u=(data.construction_units||[]).filter(x=>x&&(x.unit||x.work)),p=(data.construction_public||[]).filter(x=>x&&(x.place||x.work));
    const n=Math.max(u.length,p.length,1);let rows='';
    for(let i=0;i<n;i++){const a=u[i],b=p[i];rows+=`<tr><td class="no">${a?i+1:''}</td><td class="c">${esc(a?.unit)}</td><td>${esc(a?.work)}</td><td class="n">${esc(a?.people)}</td><td class="no">${b?i+1:''}</td><td class="c">${esc(b?.place)}</td><td>${esc(b?.work)}</td><td class="n">${esc(b?.people)}</td></tr>`;}
    return `<table><tr><th colspan="4">專有戶施工統計表</th><th colspan="4">公共區域施工統計表</th></tr><tr><th class="no">項次</th><th>戶別</th><th>工程內容</th><th>人數</th><th class="no">項次</th><th>施工地點</th><th>工程內容</th><th>人數</th></tr>${rows}<tr><td colspan="4">當日施工人數統計：${u.reduce((s,x)=>s+num(x.people),0)}人</td><td colspan="4">當日施工人數統計：${p.reduce((s,x)=>s+num(x.people),0)}人</td></tr></table>`;
  }
  function renovationSection(list){
    const rows=(list||[]);const pending=rows.filter(r=>!r.detector_reset).map(r=>r.unit);
    const dot=v=>v?'●':'';
    return `<table><tr><th colspan="10" style="text-align:left">專有戶施工資訊：</th></tr><tr><th class="no" rowspan="2"></th><th rowspan="2">戶別</th><th rowspan="2">施工申請期限</th><th colspan="2">保證金繳交</th><th colspan="2">清潔費繳交</th><th colspan="2">裝潢情形</th></tr><tr><th>已繳</th><th>退款中</th><th>已繳</th><th>未繳</th><th>裝潢中</th><th>已完工</th></tr>${rows.length?rows.map((r,i)=>`<tr><td class="no">${i+1}</td><td class="c">${r.detector_reset?esc(r.unit):`<span class="mark">${esc(r.unit)}</span>`}</td><td class="c">${esc(r.permit_period)}</td><td class="c">${dot(r.deposit==='paid')}</td><td class="c">${dot(r.deposit==='refunding')}</td><td class="c">${dot(r.cleaning_fee==='paid')}</td><td class="c">${dot(r.cleaning_fee==='unpaid')}</td><td class="c">${dot(r.status!=='done')}</td><td class="c">${dot(r.status==='done')}</td></tr>`).join(''):'<tr><td colspan="9" class="c muted">目前沒有裝潢施工戶</td></tr>'}<tr><td colspan="9"><span class="mark">裝潢施工戶此字體註記為消防探測器尚未復歸；</span>尚未恢復戶別${pending.length?`如右(${pending.length}戶)：${esc(pending.join('、'))}`:'：無'}</td></tr></table>`;
  }
  function staffingSection(st){
    const rows=(st?.rows||[]);const half=Math.ceil(rows.length/2)||1;let body='';
    const cell=r=>r?`<td>${esc(r.role)}</td><td class="c">${esc(r.name)}</td><td class="c">${r.status==='work'?'ˇ':''}</td><td class="c">${r.status==='off'?'ˇ':''}</td>`:'<td></td><td></td><td></td><td></td>';
    for(let i=0;i<half;i++)body+=`<tr>${cell(rows[i])}${cell(rows[i+half])}</tr>`;
    return `<table><tr><th colspan="8" style="text-align:left">管理中心人員值班表：</th></tr><tr><th rowspan="2">職務名稱</th><th rowspan="2">姓 名</th><th colspan="2">值班出勤表</th><th rowspan="2">職務名稱</th><th rowspan="2">姓 名</th><th colspan="2">值班出勤表</th></tr><tr><th>上班</th><th>休假</th><th>上班</th><th>休假</th></tr>${body}<tr><td colspan="8">明日休假人員：${esc(st?.tomorrow_off||'無')}</td></tr></table>`;
  }
  function metersSection(meters){
    return (meters||[]).map(m=>{const h=m.history||[];if(!h.length)return `<table><tr><th style="text-align:left">${esc(m.label)}紀錄</th></tr><tr><td class="muted">尚無抄表紀錄</td></tr></table>`;
      return `<table><tr><th colspan="${h.length+1}" style="text-align:left">${esc(m.label)}紀錄</th></tr><tr><th style="width:12%">日期</th>${h.map(x=>`<th>${md(x.date)}</th>`).join('')}</tr><tr><td>今日度數</td>${h.map(x=>`<td class="n">${esc(x.value)}</td>`).join('')}</tr><tr><td>使用紀錄</td>${h.map(x=>`<td class="n">${x.usage==null?'':esc(x.usage)}</td>`).join('')}</tr></table>`;}).join('');
  }
  function overviewSection(o){
    o=o||{};
    return `<table><tr><th colspan="9" style="text-align:left">社區概況說明：</th></tr><tr><th rowspan="2">總戶數</th><th colspan="3">入住戶現況</th><th colspan="3">裝潢戶</th><th rowspan="2">汽車位</th><th rowspan="2">機車位</th></tr><tr><th>自住</th><th>承租</th><th>空屋</th><th>已申請</th><th>施工中</th><th>待驗退</th></tr><tr>${['total','owner','tenant','vacant','reno_applied','reno_working','reno_pending','car','moto'].map(k=>`<td class="c">${nl(o[k])}</td>`).join('')}</tr></table>`;
  }
  function packagesSection(p){
    p=p||{};const row=(k,label)=>{const x=p[k]||{};return `<tr><td>${label}</td><td class="c">${esc(x.pkg??'')}${x.pkg!==''&&x.pkg!=null?'件':''}</td><td class="c">${esc(x.reg??'')}${x.reg!==''&&x.reg!=null?'件':''}</td><td class="c">${esc(x.deposit??'')}${x.deposit!==''&&x.deposit!=null?'件':''}</td><td>${nl(x.note)}</td></tr>`;};
    return `<table><tr><th style="width:16%">項目/數量</th><th style="width:9%">包裹</th><th style="width:9%">掛號</th><th style="width:9%">寄物</th><th>備註</th></tr>${row('d3','3日以上未領')}${row('d5','5日以上未領')}${row('d7','7日以上未領')}</table>`;
  }
  function trackingSection(list,settings){
    const items=list||[];
    return `<table><tr><th style="width:11%">日期</th><th style="width:40%">交辦與問題內容</th><th>處理進度</th></tr>${catsFor(settings,items).map(([k,label])=>{const rows=items.filter(t=>t.category===k);return `<tr class="cat"><td colspan="3">${label}</td></tr>${rows.length?rows.map(t=>`<tr><td class="c">${md(t.opened_on)}</td><td>${nl(t.content)}${t.closed_on?`<div class="muted">（${md(t.closed_on)} 結案）</div>`:''}</td><td>${(t.updates||[]).map(u=>`<div class="up">${md(u.update_date)} ${nl(u.content)}</div>`).join('')}</td></tr>`).join(''):'<tr><td></td><td class="muted">無</td><td></td></tr>'}`;}).join('')}</table>`;
  }
  function dailyBody(p,data,st){
    const secs=(p.settings?.daily_sections||[{key:'notes'},{key:'construction'},{key:'staffing'},{key:'meters'},{key:'record'},{key:'tracking'},{key:'custom'},{key:'extra'}]).filter(x=>x.on!==false);
    const custom=(p.settings?.custom_items||[]).filter(c=>c.scope==='daily'||c.scope==='both');
    let n=0;const h=(c,def,colon='')=>`<h2>${cn(++n)}、${esc(c.label||def)}${colon}</h2>`;
    const B={
      notes:c=>h(c,'案場重要記事','：')+notesSection(data,p.settings?.roles||Object.keys(data.notes||{})),
      construction:c=>{const parts=c.parts||{};if(parts.stats===false&&parts.renovations===false)return '';return h(c,'施工管制','：')+(parts.stats!==false?constructionSection(data):'')+(parts.renovations!==false?renovationSection(p.renovations):'');},
      staffing:c=>h(c,'人員管制')+staffingSection(st),
      meters:c=>h(c,'社區巡檢狀況','：')+metersSection(p.meters),
      record:c=>{const parts=c.parts||{};if(parts.overview===false&&parts.packages===false)return '';return h(c,'本日工作記錄與交辦事項')+(parts.overview!==false?overviewSection(p.overview||p.settings?.overview):'')+(parts.packages!==false?packagesSection(data.packages):'');},
      tracking:c=>h(c,'待辦追蹤事項及住戶反映事項')+trackingSection(p.tracking,p.settings),
      custom:c=>custom.length?h(c,'其他紀錄項目')+customHtml(custom,data.custom):'',
      extra:c=>data.extra?h(c,'其他事項')+`<div class="box">${nl(data.extra)}</div>`:'',
    };
    return secs.map(c=>B[c.key]?B[c.key](c):'').join('');
  }
  function dailyHtml(p,community){
    const data=p.journal?.data||{};const st=data.staffing||p.staffing_suggestion||{rows:[]};
    return `<h1>${esc(community?.name||'')} 工作日誌</h1><p class="doc-sub">${rocDate(p.date||p.journal?.period_date)}</p>
      <div class="doc-meta"><span>${p.journal?.status==='submitted'?`已送出：${esc(p.journal.submitted_by||'')}`:'草稿（尚未送出）'}</span><span>最後編輯：${esc(p.journal?.updated_by||'—')}</span></div>
      ${dailyBody(p,data,st)}
      <div class="sign"><span>記錄人員</span><span>社區經理</span><span>主任委員</span></div>`;
  }
  function weeklyBody(p,data,s,t,r,cons,manualCons){
    const secs=(p.settings?.weekly_sections||[{key:'summary'},{key:'construction'},{key:'meters'},{key:'tracking'},{key:'staffing'},{key:'custom'},{key:'committee'},{key:'next_week'},{key:'extra'}]).filter(x=>x.on!==false);
    const custom=(p.settings?.custom_items||[]).filter(c=>c.scope==='weekly'||c.scope==='both');
    let n=0;const h=(c,def)=>`<h2>${cn(++n)}、${esc(c.label||def)}</h2>`;
    const B={
      summary:c=>h(c,'本週重點摘要')+`<div class="box">${nl(data.summary)||'<span class="muted">（未填寫）</span>'}</div>`,
      construction:c=>h(c,'施工管制週統計')+(s.daily_count?`<table><tr><th>日期</th><th>施工戶數</th><th>專有戶施工人數</th><th>公共區域施工人數</th></tr>${cons}<tr><td class="c">合計</td><td></td><td class="n">${s.construction_total?.unit_people||0}</td><td class="n">${s.construction_total?.public_people||0}</td></tr></table>`:'')+(manualCons?`<div class="box">${nl(manualCons)}</div>`:'')+`<table><tr><th style="width:22%">本週新申請裝修</th><td>${esc((r.new_units||[]).join('、')||'無')}</td></tr><tr><th>本週完工</th><td>${esc((r.done_units||[]).join('、')||'無')}</td></tr><tr><th>目前裝潢中</th><td>${r.working||0} 戶</td></tr><tr><th>消防探測器尚未復歸</th><td>${esc((r.detector_pending||[]).join('、')||'無')}</td></tr></table>`,
      meters:c=>h(c,'社區巡檢（水電用量）週報')+`<table><tr><th>項目</th><th>本週用量</th><th>上週用量</th><th>增減</th></tr>${(s.meters||[]).map(m=>`<tr><td>${esc(m.label)}</td><td class="n">${m.usage??'—'}</td><td class="n">${m.prev_usage??'—'}</td><td class="n ${m.abnormal?'abn':''}">${m.change_pct==null?'—':`${m.change_pct>0?'+':''}${m.change_pct}%${m.abnormal?' ⚠':''}`}</td></tr>`).join('')}</table>`,
      tracking:c=>h(c,'待辦追蹤週報')+`<table><tr><th>分類</th><th>本週新增</th><th>仍在追蹤</th></tr>${(t.by_category||[]).map(c=>`<tr><td>${esc(c.label)}</td><td class="n">${c.new}</td><td class="n">${c.open}</td></tr>`).join('')}<tr><td>本週結案</td><td class="n" colspan="2">${(t.closed||[]).length} 件</td></tr><tr><td>追蹤超過 30 天</td><td class="n" colspan="2">${t.overdue||0} 件</td></tr></table>`
        +((t.open||[]).length?`<h3>仍在追蹤中的事項</h3><table><tr><th style="width:11%">開立</th><th style="width:16%">分類</th><th>內容</th><th style="width:30%">最新進度</th><th style="width:8%">天數</th></tr>${t.open.map(x=>`<tr><td class="c">${md(x.opened_on)}</td><td>${esc(x.category_label)}</td><td>${nl(x.content)}</td><td>${x.last_update?`${md(x.last_update.update_date)} ${nl(x.last_update.content)}`:''}</td><td class="n ${x.age_days>30?'abn':''}">${x.age_days}</td></tr>`).join('')}</table>`:'')
        +((t.closed||[]).length?`<h3>本週已結案</h3><table>${t.closed.map(x=>`<tr><td style="width:11%" class="c">${md(x.closed_on)}</td><td style="width:16%">${esc(x.category_label)}</td><td>${nl(x.content)}</td></tr>`).join('')}</table>`:''),
      staffing:c=>h(c,'人員出勤週統計')+((s.staffing||[]).length?`<table><tr><th>職務</th><th>姓名</th><th>上班天數</th><th>休假天數</th></tr>${s.staffing.map(x=>`<tr><td>${esc(x.role)}</td><td class="c">${esc(x.name)}</td><td class="n">${x.work_days}</td><td class="n">${x.off_days}</td></tr>`).join('')}</table>`:'<div class="box muted">本週班表尚無資料</div>'),
      custom:c=>custom.length?h(c,'其他紀錄項目')+customHtml(custom,data.custom):'',
      committee:c=>h(c,'需管委會決議／協助事項')+`<div class="box">${nl(data.committee)||'<span class="muted">無</span>'}</div>`,
      next_week:c=>h(c,'下週工作計畫')+`<div class="box">${nl(data.next_week)||'<span class="muted">（未填寫）</span>'}</div>`,
      extra:c=>data.extra?h(c,'其他事項')+`<div class="box">${nl(data.extra)}</div>`:'',
    };
    return secs.map(c=>B[c.key]?B[c.key](c):'').join('');
  }
  function weeklyHtml(p,community){
    const data=p.journal?.data||{};const s=p.summary||{};const t=s.tracking||{};const r=s.renovation||{};
    const range=`${rocDate(s.week_start||p.week_start)} ～ ${rocDate(s.week_end||p.week_start)}`.replace(/\(星期.\)/g,'');
    const cons=(s.construction||[]).map(d=>`<tr><td class="c">${md(d.date)}</td><td class="n">${d.unit_count||''}</td><td class="n">${d.unit_people||''}</td><td class="n">${d.public_people||''}</td></tr>`).join('');
    const manualCons=(data.construction||'').trim();
    return `<h1>${esc(community?.name||'')} 每週工作日誌</h1><p class="doc-sub">${range}</p>
      <div class="doc-meta"><span>${p.journal?.status==='submitted'?`已送出：${esc(p.journal.submitted_by||'')}`:'草稿（尚未送出）'}</span><span>本週每日日誌：${s.daily_count||0} 份（已送出 ${s.daily_submitted||0}）</span></div>
      ${weeklyBody(p,data,s,t,r,cons,manualCons)}
      <div class="sign"><span>記錄人員</span><span>社區經理</span><span>主任委員</span></div>`;
  }
  function html(payload,community){
    const weekly=!!(payload.summary||payload.week_start);
    return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${esc(community?.name||'')} ${weekly?'每週':'每日'}工作日誌</title><style>${CSS}</style></head><body>${weekly?weeklyHtml(payload,community):dailyHtml(payload,community)}</body></html>`;
  }
  function print(payload,community){
    const old=document.getElementById('journalPrintFrame');if(old)old.remove();
    const f=document.createElement('iframe');f.id='journalPrintFrame';f.setAttribute('aria-hidden','true');
    f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const doc=f.contentDocument;doc.open();doc.write(html(payload,community));doc.close();
    setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print();}catch(e){alert('無法開啟列印視窗：'+e.message);}},250);
  }
  window.JournalPrint={html,print};
})();
