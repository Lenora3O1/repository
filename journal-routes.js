// 工作日誌（每日／每週）
// 設計：會「延續」的資料（待辦追蹤、裝潢戶、水電表讀數、社區概況）各自存表，日誌只存當天內容；
// 經理送出時把當下完整內容存成快照，之後的修改不影響已送出的日誌。
'use strict';

const JT=require('./journal-template');
const DEFAULT_METERS=JT.DEFAULT_METERS;
const DEFAULT_ROLES=JT.DEFAULT_ROLES;
const DEFAULT_OVERVIEW={total:'',owner:'',tenant:'',vacant:'',reno_applied:'',reno_working:'',reno_pending:'',car:'',moto:''};
const TRACK_CATEGORIES={committee:'管理委員會',resident:'住戶交辦事項與問題處置',center:'管理中心待辦事項',facility:'公共設施相關修繕'};
const DAILY_KEYS=new Set(['construction_units','construction_public','staffing','packages','extra','custom']);
const WEEKLY_KEYS=new Set(['summary','construction','committee','next_week','extra','custom']);

module.exports=function registerJournalRoutes(app,d){
  const {db,getUser,tenantId,getSiteAssignments,isSiteManager,effectivePermissions,now,requireStaff,requireCompanyAdmin,requireSuperAdmin}=d;
  // 平台預設範本（總後台設定）；沒有傳入檔案路徑時（測試）只用內建預設
  const template=d.fs&&d.path?JT(d):{read:()=>JT.normalizeTemplate(null),write:()=>{throw new Error('範本無法儲存');},reset:()=>JT.normalizeTemplate(null)};

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_settings (
      tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'daily', meters_json TEXT NOT NULL DEFAULT '', roles_json TEXT NOT NULL DEFAULT '',
      overview_json TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tenant_id,community_id)
    );
    CREATE TABLE IF NOT EXISTS journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL,
      kind TEXT NOT NULL, period_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      data_json TEXT NOT NULL DEFAULT '{}', snapshot_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
      submitted_at TEXT, submitted_by TEXT NOT NULL DEFAULT '',
      UNIQUE (tenant_id,community_id,kind,period_date)
    );
    CREATE INDEX IF NOT EXISTS idx_journals_lookup ON journals(tenant_id,community_id,kind,period_date);
    CREATE TABLE IF NOT EXISTS journal_meter_readings (
      tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, meter_key TEXT NOT NULL, reading_date TEXT NOT NULL,
      value REAL NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tenant_id,community_id,meter_key,reading_date)
    );
    CREATE TABLE IF NOT EXISTS journal_renovations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL,
      unit TEXT NOT NULL, permit_period TEXT NOT NULL DEFAULT '', deposit TEXT NOT NULL DEFAULT '', cleaning_fee TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'working', detector_reset INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
      created_on TEXT NOT NULL, done_on TEXT, archived INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_reno ON journal_renovations(tenant_id,community_id,archived);
    CREATE TABLE IF NOT EXISTS journal_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL,
      category TEXT NOT NULL, opened_on TEXT NOT NULL, content TEXT NOT NULL, closed_on TEXT,
      created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_tracking ON journal_tracking(tenant_id,community_id,closed_on);
    CREATE TABLE IF NOT EXISTS journal_tracking_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tracking_id INTEGER NOT NULL, update_date TEXT NOT NULL, content TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_tracking_updates ON journal_tracking_updates(tracking_id,update_date);
  `);
  // 社區自行調整過哪些設定（mode／meters／roles）；沒調整的沿用平台範本
  if(!db.prepare('PRAGMA table_info(journal_settings)').all().some(c=>c.name==='custom_keys'))db.exec('ALTER TABLE journal_settings ADD COLUMN custom_keys TEXT');

  // ---------- 小工具 ----------
  const parse=(v,f)=>{try{const x=JSON.parse(v||'');return x==null?f:x;}catch{return f;}};
  const str=(v,max=500)=>String(v??'').trim().slice(0,max);
  const isDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
  const addDays=(date,n)=>{const x=new Date(`${date}T00:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const weekStart=date=>{const x=new Date(`${date}T00:00:00Z`);const dow=(x.getUTCDay()+6)%7;return addDays(date,-dow);};
  const todayTW=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
  const bad=(res,msg,code=400)=>res.status(code).json({error:msg});
  function userName(u){return u?.name||u?.employee_id||'';}

  function customKeys(r){
    if(!r)return new Set();
    const saved=parse(r.custom_keys,null);
    if(Array.isArray(saved))return new Set(saved);
    // 舊資料（範本功能之前建立）：與當時內建預設不同的才算社區自訂
    const out=new Set();if(r.mode==='weekly')out.add('mode');
    if(r.meters_json&&r.meters_json!==JSON.stringify(DEFAULT_METERS))out.add('meters');
    if(r.roles_json&&r.roles_json!==JSON.stringify(DEFAULT_ROLES))out.add('roles');
    return out;
  }
  function categoryMap(T){return Object.fromEntries((T.tracking_categories||[]).map(c=>[c.key,c.label]));}
  function catLabel(T,key){return categoryMap(T)[key]||TRACK_CATEGORIES[key]||'其他';}
  function settingsFor(tid,cid){
    const T=template.read();
    const r=db.prepare('SELECT * FROM journal_settings WHERE tenant_id=? AND community_id=?').get(tid,cid);
    const custom=customKeys(r);
    const meters=parse(r?.meters_json,null);const roles=parse(r?.roles_json,null);
    const useMeters=custom.has('meters')&&Array.isArray(meters);
    const useRoles=custom.has('roles')&&Array.isArray(roles)&&roles.length;
    return {mode:custom.has('mode')?(r.mode==='weekly'?'weekly':'daily'):T.mode,meters:useMeters?meters:T.meters,roles:useRoles?roles:T.roles,overview:{...DEFAULT_OVERVIEW,...parse(r?.overview_json,{})},
      daily_sections:T.daily_sections,weekly_sections:T.weekly_sections,tracking_categories:T.tracking_categories,custom_items:T.custom_items,
      inherited:{mode:!custom.has('mode'),meters:!useMeters,roles:!useRoles},platform:{mode:T.mode,meters:T.meters,roles:T.roles},
      updated_at:r?.updated_at||'',updated_by:r?.updated_by||''};
  }
  function saveSettings(tid,cid,body,by){
    const cur=settingsFor(tid,cid);
    const prev=db.prepare('SELECT * FROM journal_settings WHERE tenant_id=? AND community_id=?').get(tid,cid);
    const custom=customKeys(prev);
    // 恢復平台預設：reset=true 全部，或 reset=['mode','meters'] 指定項目
    if(body.reset){for(const k of (Array.isArray(body.reset)?body.reset:['mode','meters','roles']))custom.delete(k);}
    if(body.mode!==undefined)custom.add('mode');
    if(Array.isArray(body.meters))custom.add('meters');
    if(Array.isArray(body.roles))custom.add('roles');
    const mode=body.mode===undefined?cur.mode:(body.mode==='weekly'?'weekly':'daily');
    let meters=cur.meters;
    if(Array.isArray(body.meters)){
      const seen=new Set();meters=[];
      for(const m of body.meters){const label=str(m?.label,40);if(!label)continue;let key=str(m?.key,40).replace(/[^\w-]/g,'')||`m_${Date.now().toString(36)}_${meters.length}`;while(seen.has(key))key+='_';seen.add(key);meters.push({key,label});}
      if(meters.length>20)meters=meters.slice(0,20);
    }
    let roles=cur.roles;
    if(Array.isArray(body.roles)){roles=[...new Set(body.roles.map(x=>str(x,20)).filter(Boolean))].slice(0,10);if(!roles.length)roles=DEFAULT_ROLES;}
    let overview=cur.overview;
    if(body.overview&&typeof body.overview==='object'){overview={...DEFAULT_OVERVIEW};for(const k of Object.keys(DEFAULT_OVERVIEW))overview[k]=str(body.overview[k]??cur.overview[k],40);}
    db.prepare(`INSERT INTO journal_settings (tenant_id,community_id,mode,meters_json,roles_json,overview_json,updated_at,updated_by,custom_keys) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,community_id) DO UPDATE SET mode=excluded.mode,meters_json=excluded.meters_json,roles_json=excluded.roles_json,overview_json=excluded.overview_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by,custom_keys=excluded.custom_keys`)
      .run(tid,cid,mode,custom.has('meters')?JSON.stringify(meters):'',custom.has('roles')?JSON.stringify(roles):'',JSON.stringify(overview),now(),by,JSON.stringify([...custom]));
    return settingsFor(tid,cid);
  }
  function journalRow(tid,cid,kind,date){return db.prepare('SELECT * FROM journals WHERE tenant_id=? AND community_id=? AND kind=? AND period_date=?').get(tid,cid,kind,date)||null;}
  function journalPublic(r){if(!r)return null;return {id:r.id,kind:r.kind,period_date:r.period_date,status:r.status,data:parse(r.data_json,{}),updated_at:r.updated_at,updated_by:r.updated_by,submitted_at:r.submitted_at,submitted_by:r.submitted_by};}
  function patchJournal(tid,cid,kind,date,patch,by){
    const allowed=kind==='weekly'?WEEKLY_KEYS:DAILY_KEYS;
    let r=journalRow(tid,cid,kind,date);
    if(r&&r.status==='submitted')throw Object.assign(new Error('這份日誌已送出，請先由經理「退回編輯」才能修改'),{status:409});
    const data=parse(r?.data_json,{});
    for(const [k,v] of Object.entries(patch||{})){
      if(kind==='daily'&&k.startsWith('notes.')){const role=str(k.slice(6),20);if(!role)continue;data.notes=data.notes||{};data.notes[role]=Array.isArray(v)?v.slice(0,50).map(x=>({text:str(x?.text,1000),remark:str(x?.remark,200)})):[];continue;}
      if(!allowed.has(k))continue;
      data[k]=v;
    }
    const json=JSON.stringify(data);
    if(json.length>200000)throw new Error('日誌內容過長');
    const t=now();
    if(r)db.prepare('UPDATE journals SET data_json=?,updated_at=?,updated_by=? WHERE id=?').run(json,t,by,r.id);
    else db.prepare('INSERT INTO journals (tenant_id,community_id,kind,period_date,status,data_json,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?)').run(tid,cid,kind,date,'draft',json,t,t,by);
    return journalRow(tid,cid,kind,date);
  }

  // ---------- 延續資料 ----------
  function meterView(tid,cid,meters,date,days=7){
    return meters.map(m=>{
      const rows=db.prepare('SELECT reading_date,value FROM journal_meter_readings WHERE tenant_id=? AND community_id=? AND meter_key=? AND reading_date<=? ORDER BY reading_date DESC LIMIT ?').all(tid,cid,m.key,date,days+1).reverse();
      const hist=rows.map((r,i)=>({date:r.reading_date,value:r.value,usage:i>0?Math.round((r.value-rows[i-1].value)*100)/100:null}));
      const today=hist.find(h=>h.date===date)||null;
      if(today&&today.usage==null){const prev=db.prepare('SELECT value FROM journal_meter_readings WHERE tenant_id=? AND community_id=? AND meter_key=? AND reading_date<? ORDER BY reading_date DESC LIMIT 1').get(tid,cid,m.key,date);if(prev)today.usage=Math.round((today.value-prev.value)*100)/100;}
      return {key:m.key,label:m.label,today:today?today.value:null,usage:today?today.usage:null,history:hist.slice(-days)};
    });
  }
  function renovationList(tid,cid){return db.prepare('SELECT id,unit,permit_period,deposit,cleaning_fee,status,detector_reset,note,created_on,done_on FROM journal_renovations WHERE tenant_id=? AND community_id=? AND archived=0 ORDER BY sort_order,id').all(tid,cid).map(r=>({...r,detector_reset:!!r.detector_reset}));}
  // 截至某日：已開立且（未結案或當天才結案）的追蹤事項，以及截至當日的處理進度
  function trackingAsOf(tid,cid,date){
    const items=db.prepare('SELECT * FROM journal_tracking WHERE tenant_id=? AND community_id=? AND opened_on<=? AND (closed_on IS NULL OR closed_on>=?) ORDER BY opened_on,id').all(tid,cid,date,date);
    const upd=db.prepare('SELECT id,update_date,content,created_by FROM journal_tracking_updates WHERE tracking_id=? AND update_date<=? ORDER BY update_date,id');
    const T=template.read();
    return items.map(t=>({id:t.id,category:t.category,category_label:catLabel(T,t.category),opened_on:t.opened_on,content:t.content,closed_on:t.closed_on,closed_today:t.closed_on===date,updates:upd.all(t.id,date)}));
  }
  function staffingSuggestion(tid,cid,date){
    const q=`SELECT e.shift_code,u.name,COALESCE(NULLIF(u.position,''),u.job_level,'') AS role FROM schedule_entries e JOIN staff_users u ON u.id=e.staff_id AND u.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.community_id=? AND e.work_date=? ORDER BY u.employee_id`;
    let today=[],tomorrow=[];
    try{today=db.prepare(q).all(tid,cid,date);tomorrow=db.prepare(q).all(tid,cid,addDays(date,1));}catch{/* 尚未啟用班表 */}
    const off=c=>['off','leave'].includes(String(c));
    const roleOf=r=>String(r.role||'').split('｜')[0]||'人員';
    return {rows:today.map(r=>({role:roleOf(r),name:r.name,status:off(r.shift_code)?'off':'work'})),tomorrow_off:tomorrow.filter(r=>off(r.shift_code)).map(r=>`${roleOf(r)} ${r.name}`).join('、')};
  }
  function dailyPayload(tid,cid,date){
    const s=settingsFor(tid,cid);const r=journalRow(tid,cid,'daily',date);
    if(r&&r.status==='submitted'&&r.snapshot_json){const snap=parse(r.snapshot_json,{});return {...snap,journal:journalPublic(r),settings:{...s,...(snap.template||{})},live:false};}
    return {date,journal:journalPublic(r),settings:s,overview:s.overview,meters:meterView(tid,cid,s.meters,date),renovations:renovationList(tid,cid),tracking:trackingAsOf(tid,cid,date),staffing_suggestion:staffingSuggestion(tid,cid,date),live:true};
  }
  function weekSummary(tid,cid,start){
    const end=addDays(start,6),prevStart=addDays(start,-7),prevEnd=addDays(start,-1);
    const s=settingsFor(tid,cid);
    const days=[...Array(7)].map((_,i)=>addDays(start,i));
    const dailies=db.prepare("SELECT period_date,status,data_json,snapshot_json FROM journals WHERE tenant_id=? AND community_id=? AND kind='daily' AND period_date BETWEEN ? AND ?").all(tid,cid,start,end);
    const byDate=new Map(dailies.map(r=>[r.period_date,r]));
    const num=v=>Number(String(v??'').replace(/[^\d.]/g,''))||0;
    const construction=days.map(day=>{const r=byDate.get(day);const data=r?(parse(r.snapshot_json,null)?.journal?.data||parse(r.data_json,{})):{};const units=Array.isArray(data.construction_units)?data.construction_units.filter(x=>x&&(x.unit||x.work)):[];const pub=Array.isArray(data.construction_public)?data.construction_public.filter(x=>x&&(x.place||x.work)):[];return {date:day,has_journal:!!r,status:r?.status||'',unit_count:units.length,unit_people:units.reduce((a,x)=>a+num(x.people),0),public_people:pub.reduce((a,x)=>a+num(x.people),0)};});
    const usage=(key,a,b)=>{const last=db.prepare('SELECT value FROM journal_meter_readings WHERE tenant_id=? AND community_id=? AND meter_key=? AND reading_date<=? ORDER BY reading_date DESC LIMIT 1').get(tid,cid,key,b);const before=db.prepare('SELECT value FROM journal_meter_readings WHERE tenant_id=? AND community_id=? AND meter_key=? AND reading_date<? ORDER BY reading_date DESC LIMIT 1').get(tid,cid,key,a);const inRange=db.prepare('SELECT COUNT(*) c FROM journal_meter_readings WHERE tenant_id=? AND community_id=? AND meter_key=? AND reading_date BETWEEN ? AND ?').get(tid,cid,key,a,b).c;return last&&before&&inRange?Math.round((last.value-before.value)*100)/100:null;};
    const meters=s.meters.map(m=>{const cur=usage(m.key,start,end),prev=usage(m.key,prevStart,prevEnd);const change=cur!=null&&prev?Math.round((cur-prev)/prev*1000)/10:null;return {key:m.key,label:m.label,usage:cur,prev_usage:prev,change_pct:change,abnormal:change!=null&&Math.abs(change)>=30};});
    const renos=db.prepare('SELECT unit,status,detector_reset,created_on,done_on,archived FROM journal_renovations WHERE tenant_id=? AND community_id=?').all(tid,cid);
    const renovation={new_units:renos.filter(r=>r.created_on>=start&&r.created_on<=end).map(r=>r.unit),done_units:renos.filter(r=>r.done_on&&r.done_on>=start&&r.done_on<=end).map(r=>r.unit),working:renos.filter(r=>!r.archived&&r.status!=='done').length,detector_pending:renos.filter(r=>!r.archived&&!r.detector_reset).map(r=>r.unit)};
    const tr=db.prepare('SELECT id,category,opened_on,content,closed_on FROM journal_tracking WHERE tenant_id=? AND community_id=? AND opened_on<=?').all(tid,cid,end);
    const lastUpd=db.prepare('SELECT update_date,content FROM journal_tracking_updates WHERE tracking_id=? AND update_date<=? ORDER BY update_date DESC,id DESC LIMIT 1');
    const age=t=>Math.round((new Date(`${end}T00:00:00Z`)-new Date(`${t.opened_on}T00:00:00Z`))/86400000);
    const T=template.read();const cats=[...(T.tracking_categories||[])];for(const t of tr)if(!cats.some(c=>c.key===t.category))cats.push({key:t.category,label:catLabel(T,t.category)});
    const open=tr.filter(t=>!t.closed_on||t.closed_on>end).map(t=>({...t,category_label:catLabel(T,t.category),age_days:age(t),last_update:lastUpd.get(t.id,end)||null}));
    const tracking={new_count:tr.filter(t=>t.opened_on>=start).length,closed:tr.filter(t=>t.closed_on&&t.closed_on>=start&&t.closed_on<=end).map(t=>({content:t.content,category_label:catLabel(T,t.category),closed_on:t.closed_on})),open,overdue:open.filter(t=>t.age_days>30).length,resident_new:tr.filter(t=>t.category==='resident'&&t.opened_on>=start).length,by_category:cats.map(({key:k,label})=>({key:k,label,new:tr.filter(t=>t.category===k&&t.opened_on>=start).length,open:open.filter(t=>t.category===k).length}))};
    let staffing=[];
    try{staffing=db.prepare(`SELECT u.name,COALESCE(NULLIF(u.position,''),u.job_level,'') role,SUM(CASE WHEN e.shift_code IN ('off','leave') THEN 0 ELSE 1 END) work_days,SUM(CASE WHEN e.shift_code IN ('off','leave') THEN 1 ELSE 0 END) off_days FROM schedule_entries e JOIN staff_users u ON u.id=e.staff_id AND u.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.community_id=? AND e.work_date BETWEEN ? AND ? GROUP BY e.staff_id ORDER BY u.employee_id`).all(tid,cid,start,end).map(r=>({...r,role:String(r.role||'').split('｜')[0]}));}catch{}
    return {week_start:start,week_end:end,days,construction,construction_total:{unit_people:construction.reduce((a,x)=>a+x.unit_people,0),public_people:construction.reduce((a,x)=>a+x.public_people,0)},daily_count:dailies.length,daily_submitted:dailies.filter(r=>r.status==='submitted').length,meters,renovation,tracking,staffing,overview:s.overview};
  }
  function weeklyPayload(tid,cid,start){
    const s=settingsFor(tid,cid);const r=journalRow(tid,cid,'weekly',start);
    if(r&&r.status==='submitted'&&r.snapshot_json){const snap=parse(r.snapshot_json,{});return {...snap,journal:journalPublic(r),settings:{...s,...(snap.template||{})},live:false};}
    return {week_start:start,journal:journalPublic(r),settings:s,summary:weekSummary(tid,cid,start),meters:meterView(tid,cid,s.meters,addDays(start,6),7),renovations:renovationList(tid,cid),tracking:trackingAsOf(tid,cid,addDays(start,6)),live:true};
  }
  function submitJournal(tid,cid,kind,date,by){
    let r=journalRow(tid,cid,kind,date);
    if(!r){patchJournal(tid,cid,kind,date,{},by);r=journalRow(tid,cid,kind,date);}
    if(r.status==='submitted')return r;
    const snap=kind==='weekly'?weeklyPayload(tid,cid,date):dailyPayload(tid,cid,date);
    // 送出時把當下的區塊設定一起凍結，之後總後台改範本不會影響已送出的日誌
    const st=snap.settings||{};snap.template={roles:st.roles,daily_sections:st.daily_sections,weekly_sections:st.weekly_sections,tracking_categories:st.tracking_categories,custom_items:st.custom_items};
    delete snap.settings;snap.journal={...journalPublic(r),status:'submitted'};
    const t=now();
    db.prepare("UPDATE journals SET status='submitted',snapshot_json=?,submitted_at=?,submitted_by=?,updated_at=? WHERE id=?").run(JSON.stringify(snap),t,by,t,r.id);
    return journalRow(tid,cid,kind,date);
  }

  // ---------- 權限 ----------
  function staffCommunities(u){
    const ids=getSiteAssignments(u).map(a=>Number(a.community_id)).filter(Boolean);
    if(!ids.length)return [];
    return db.prepare(`SELECT id,name FROM communities WHERE tenant_id=? AND status='active' AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY name`).all(u.tenant_id,...ids);
  }
  function staffCtx(req,res,cidRaw){
    const u=getUser(req);const cid=Number(cidRaw||0);
    const list=staffCommunities(u);
    if(!list.length){bad(res,'您目前沒有派駐的案場，無法使用工作日誌',403);return null;}
    const c=cid?list.find(x=>Number(x.id)===cid):list[0];
    if(!c){bad(res,'您沒有這個案場的工作日誌權限',403);return null;}
    return {u,tid:tenantId(req),cid:Number(c.id),community:c,manager:isSiteManager(u),by:userName(u)};
  }
  function canCompanyJournal(u){if(!u)return false;if(u.role==='company_admin')return true;const p=effectivePermissions(u)||[];return p.includes('work-journal')||p.includes('company-work-journal');}
  function companyCtx(req,res,cidRaw){
    const u=getUser(req);if(!canCompanyJournal(u)){bad(res,'您沒有工作日誌管理權限',403);return null;}
    const tid=tenantId(req);const cid=Number(cidRaw||0);
    const c=cid?db.prepare('SELECT id,name FROM communities WHERE id=? AND tenant_id=?').get(cid,tid):null;
    if(cidRaw!==undefined&&!c){bad(res,'找不到這個社區',404);return null;}
    return {u,tid,cid:c?Number(c.id):0,community:c,by:userName(u)};
  }
  const wrap=fn=>(req,res)=>{try{fn(req,res);}catch(e){if(!res.headersSent)res.status(e.status||400).json({error:e.message||'操作失敗'});}};
  const needDate=(res,v)=>{if(!isDate(v)){bad(res,'日期格式不正確');return false;}return true;};

  // ---------- 現場人員 API ----------
  const S='/api/staff/journal';
  app.get(`${S}/context`,requireStaff,wrap((req,res)=>{
    const u=getUser(req);const list=staffCommunities(u);
    res.set('Cache-Control','no-store');
    res.json({communities:list.map(c=>({...c,mode:settingsFor(u.tenant_id,c.id).mode})),manager:isSiteManager(u),today:todayTW(),categories:categoryMap(template.read())});
  }));
  app.get(`${S}/settings`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c)return;res.json(settingsFor(c.tid,c.cid));}));
  app.put(`${S}/settings`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c)return;
    // 社區概況任何人都能更新（每天會變）；日誌類型、抄表項目、記事職務只有經理能改
    const body=c.manager?req.body:{overview:req.body?.overview};
    res.json({success:true,settings:saveSettings(c.tid,c.cid,body||{},c.by)});
  }));
  app.get(`${S}/day`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c||!needDate(res,req.query.date))return;res.set('Cache-Control','no-store');res.json({...dailyPayload(c.tid,c.cid,req.query.date),community:c.community,manager:c.manager});}));
  app.put(`${S}/day`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.body?.community_id);if(!c||!needDate(res,req.body?.date))return;const r=patchJournal(c.tid,c.cid,'daily',req.body.date,req.body.patch,c.by);res.json({success:true,journal:journalPublic(r)});}));
  app.get(`${S}/week`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c||!needDate(res,req.query.date))return;res.set('Cache-Control','no-store');res.json({...weeklyPayload(c.tid,c.cid,weekStart(req.query.date)),community:c.community,manager:c.manager});}));
  app.put(`${S}/week`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.body?.community_id);if(!c||!needDate(res,req.body?.date))return;const r=patchJournal(c.tid,c.cid,'weekly',weekStart(req.body.date),req.body.patch,c.by);res.json({success:true,journal:journalPublic(r)});}));
  for(const kind of ['daily','weekly']){
    const path=kind==='daily'?'day':'week';
    app.post(`${S}/${path}/submit`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.body?.community_id);if(!c||!needDate(res,req.body?.date))return;if(!c.manager)return bad(res,'只有社區經理可以送出日誌',403);const d=kind==='weekly'?weekStart(req.body.date):req.body.date;res.json({success:true,journal:journalPublic(submitJournal(c.tid,c.cid,kind,d,c.by))});}));
    app.post(`${S}/${path}/reopen`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.body?.community_id);if(!c||!needDate(res,req.body?.date))return;if(!c.manager)return bad(res,'只有社區經理可以退回編輯',403);const d=kind==='weekly'?weekStart(req.body.date):req.body.date;db.prepare("UPDATE journals SET status='draft',snapshot_json='',updated_at=?,updated_by=? WHERE tenant_id=? AND community_id=? AND kind=? AND period_date=?").run(now(),c.by,c.tid,c.cid,kind,d);res.json({success:true,journal:journalPublic(journalRow(c.tid,c.cid,kind,d))});}));
  }
  app.get(`${S}/list`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c)return;const kind=req.query.kind==='weekly'?'weekly':'daily';res.json({rows:db.prepare('SELECT id,kind,period_date,status,updated_at,updated_by,submitted_at,submitted_by FROM journals WHERE tenant_id=? AND community_id=? AND kind=? ORDER BY period_date DESC LIMIT 60').all(c.tid,c.cid,kind)});}));
  app.put(`${S}/meter`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c||!needDate(res,req.body?.date))return;
    const key=str(req.body?.key,40);if(!settingsFor(c.tid,c.cid).meters.some(m=>m.key===key))return bad(res,'找不到這個抄表項目');
    const raw=req.body?.value;
    if(raw===''||raw===null||raw===undefined){db.prepare('DELETE FROM journal_meter_readings WHERE tenant_id=? AND community_id=? AND meter_key=? AND reading_date=?').run(c.tid,c.cid,key,req.body.date);return res.json({success:true});}
    const v=Number(raw);if(!Number.isFinite(v)||v<0)return bad(res,'度數必須是數字');
    db.prepare(`INSERT INTO journal_meter_readings (tenant_id,community_id,meter_key,reading_date,value,updated_at,updated_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id,community_id,meter_key,reading_date) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(c.tid,c.cid,key,req.body.date,v,now(),c.by);
    res.json({success:true,meters:meterView(c.tid,c.cid,settingsFor(c.tid,c.cid).meters,req.body.date)});
  }));
  const renoFields=b=>({unit:str(b?.unit,20),permit_period:str(b?.permit_period,40),deposit:['paid','refunding',''].includes(b?.deposit)?b.deposit:'',cleaning_fee:['paid','unpaid',''].includes(b?.cleaning_fee)?b.cleaning_fee:'',status:b?.status==='done'?'done':'working',detector_reset:b?.detector_reset===false||b?.detector_reset===0||b?.detector_reset==='0'?0:1,note:str(b?.note,200)});
  app.post(`${S}/renovations`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c)return;const f=renoFields(req.body);if(!f.unit)return bad(res,'請輸入戶別');
    const on=isDate(req.body?.date)?req.body.date:todayTW();const t=now();
    const max=db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM journal_renovations WHERE tenant_id=? AND community_id=?').get(c.tid,c.cid).m;
    db.prepare('INSERT INTO journal_renovations (tenant_id,community_id,unit,permit_period,deposit,cleaning_fee,status,detector_reset,note,created_on,done_on,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(c.tid,c.cid,f.unit,f.permit_period,f.deposit,f.cleaning_fee,f.status,f.detector_reset,f.note,on,f.status==='done'?on:null,Number(max)+1,t,t);
    res.json({success:true,renovations:renovationList(c.tid,c.cid)});
  }));
  app.put(`${S}/renovations/:id`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c)return;const r=db.prepare('SELECT * FROM journal_renovations WHERE id=? AND tenant_id=? AND community_id=?').get(Number(req.params.id),c.tid,c.cid);if(!r)return bad(res,'找不到這筆裝潢戶',404);
    const f=renoFields({...r,detector_reset:!!r.detector_reset,...req.body});if(!f.unit)return bad(res,'請輸入戶別');
    const on=isDate(req.body?.date)?req.body.date:todayTW();
    const done=f.status==='done'?(r.done_on||on):null;
    db.prepare('UPDATE journal_renovations SET unit=?,permit_period=?,deposit=?,cleaning_fee=?,status=?,detector_reset=?,note=?,done_on=?,archived=?,updated_at=? WHERE id=?').run(f.unit,f.permit_period,f.deposit,f.cleaning_fee,f.status,f.detector_reset,f.note,done,req.body?.archived?1:0,now(),r.id);
    res.json({success:true,renovations:renovationList(c.tid,c.cid)});
  }));
  app.delete(`${S}/renovations/:id`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c)return;db.prepare('DELETE FROM journal_renovations WHERE id=? AND tenant_id=? AND community_id=?').run(Number(req.params.id),c.tid,c.cid);res.json({success:true,renovations:renovationList(c.tid,c.cid)});}));
  app.post(`${S}/tracking`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c)return;const content=str(req.body?.content,1000);if(!content)return bad(res,'請輸入交辦或問題內容');
    const cm=categoryMap(template.read());const cat=cm[req.body?.category]?req.body.category:(Object.keys(cm)[0]||'center');const on=isDate(req.body?.opened_on)?req.body.opened_on:todayTW();const t=now();
    db.prepare('INSERT INTO journal_tracking (tenant_id,community_id,category,opened_on,content,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(c.tid,c.cid,cat,on,content,c.by,t,t);
    res.json({success:true,tracking:trackingAsOf(c.tid,c.cid,isDate(req.body?.date)?req.body.date:on)});
  }));
  app.put(`${S}/tracking/:id`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c)return;const t=db.prepare('SELECT * FROM journal_tracking WHERE id=? AND tenant_id=? AND community_id=?').get(Number(req.params.id),c.tid,c.cid);if(!t)return bad(res,'找不到這筆追蹤事項',404);
    const content=req.body?.content===undefined?t.content:str(req.body.content,1000);if(!content)return bad(res,'內容不可空白');
    const cat=categoryMap(template.read())[req.body?.category]?req.body.category:t.category;
    const opened=isDate(req.body?.opened_on)?req.body.opened_on:t.opened_on;
    const closed=req.body?.closed_on===undefined?t.closed_on:(isDate(req.body.closed_on)?req.body.closed_on:null);
    db.prepare('UPDATE journal_tracking SET category=?,content=?,opened_on=?,closed_on=?,updated_at=? WHERE id=?').run(cat,content,opened,closed,now(),t.id);
    res.json({success:true,tracking:trackingAsOf(c.tid,c.cid,isDate(req.body?.date)?req.body.date:todayTW())});
  }));
  app.delete(`${S}/tracking/:id`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c)return;const t=db.prepare('SELECT id FROM journal_tracking WHERE id=? AND tenant_id=? AND community_id=?').get(Number(req.params.id),c.tid,c.cid);if(!t)return bad(res,'找不到這筆追蹤事項',404);db.prepare('DELETE FROM journal_tracking_updates WHERE tracking_id=?').run(t.id);db.prepare('DELETE FROM journal_tracking WHERE id=?').run(t.id);res.json({success:true,tracking:trackingAsOf(c.tid,c.cid,isDate(req.query.date)?req.query.date:todayTW())});}));
  app.post(`${S}/tracking/:id/updates`,requireStaff,wrap((req,res)=>{
    const c=staffCtx(req,res,req.body?.community_id);if(!c)return;const t=db.prepare('SELECT id FROM journal_tracking WHERE id=? AND tenant_id=? AND community_id=?').get(Number(req.params.id),c.tid,c.cid);if(!t)return bad(res,'找不到這筆追蹤事項',404);
    const content=str(req.body?.content,1000);if(!content)return bad(res,'請輸入處理進度');const day=isDate(req.body?.update_date)?req.body.update_date:todayTW();
    db.prepare('INSERT INTO journal_tracking_updates (tracking_id,update_date,content,created_by,created_at) VALUES (?,?,?,?,?)').run(t.id,day,content,c.by,now());
    res.json({success:true,tracking:trackingAsOf(c.tid,c.cid,isDate(req.body?.date)?req.body.date:day)});
  }));
  app.delete(`${S}/tracking-updates/:id`,requireStaff,wrap((req,res)=>{const c=staffCtx(req,res,req.query.community_id);if(!c)return;const up=db.prepare('SELECT u.id FROM journal_tracking_updates u JOIN journal_tracking t ON t.id=u.tracking_id WHERE u.id=? AND t.tenant_id=? AND t.community_id=?').get(Number(req.params.id),c.tid,c.cid);if(!up)return bad(res,'找不到這筆進度',404);db.prepare('DELETE FROM journal_tracking_updates WHERE id=?').run(up.id);res.json({success:true,tracking:trackingAsOf(c.tid,c.cid,isDate(req.query.date)?req.query.date:todayTW())});}));

  // ---------- 公司內勤 API（唯讀＋社區設定） ----------
  const C='/api/company/journal';
  app.get(`${C}/communities`,requireCompanyAdmin,wrap((req,res)=>{const c=companyCtx(req,res);if(!c)return;const rows=db.prepare("SELECT id,name,status FROM communities WHERE tenant_id=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,name").all(c.tid);const last=db.prepare('SELECT MAX(period_date) d FROM journals WHERE tenant_id=? AND community_id=?');const T=template.read();res.json({communities:rows.map(r=>{const st=settingsFor(c.tid,r.id);return {...r,mode:st.mode,mode_inherited:st.inherited.mode,last_journal:last.get(c.tid,r.id).d||''};}),today:todayTW(),platform_mode:T.mode});}));
  app.get(`${C}/list`,requireCompanyAdmin,wrap((req,res)=>{
    const c=companyCtx(req,res);if(!c)return;const params=[c.tid];let sql='SELECT j.id,j.community_id,cm.name community_name,j.kind,j.period_date,j.status,j.updated_at,j.updated_by,j.submitted_at,j.submitted_by FROM journals j JOIN communities cm ON cm.id=j.community_id WHERE j.tenant_id=?';
    if(Number(req.query.community_id)){sql+=' AND j.community_id=?';params.push(Number(req.query.community_id));}
    if(['daily','weekly'].includes(req.query.kind)){sql+=' AND j.kind=?';params.push(req.query.kind);}
    if(['draft','submitted'].includes(req.query.status)){sql+=' AND j.status=?';params.push(req.query.status);}
    if(isDate(req.query.from)){sql+=' AND j.period_date>=?';params.push(req.query.from);}
    if(isDate(req.query.to)){sql+=' AND j.period_date<=?';params.push(req.query.to);}
    res.json({rows:db.prepare(sql+' ORDER BY j.period_date DESC,cm.name LIMIT 300').all(...params)});
  }));
  app.get(`${C}/view/:id`,requireCompanyAdmin,wrap((req,res)=>{
    const c=companyCtx(req,res);if(!c)return;const r=db.prepare('SELECT * FROM journals WHERE id=? AND tenant_id=?').get(Number(req.params.id),c.tid);if(!r)return bad(res,'找不到這份日誌',404);
    const community=db.prepare('SELECT id,name FROM communities WHERE id=?').get(r.community_id);
    res.json({...(r.kind==='weekly'?weeklyPayload(c.tid,r.community_id,r.period_date):dailyPayload(c.tid,r.community_id,r.period_date)),community});
  }));
  app.get(`${C}/settings`,requireCompanyAdmin,wrap((req,res)=>{const c=companyCtx(req,res,req.query.community_id);if(!c)return;res.json(settingsFor(c.tid,c.cid));}));
  app.put(`${C}/settings`,requireCompanyAdmin,wrap((req,res)=>{const c=companyCtx(req,res,req.body?.community_id);if(!c)return;res.json({success:true,settings:saveSettings(c.tid,c.cid,req.body||{},c.by)});}));

  // ---------- 總後台：平台預設範本 ----------
  if(requireSuperAdmin){
    const A='/api/admin/journal-template';
    const builtins={daily_sections:JT.DAILY_SECTIONS,weekly_sections:JT.WEEKLY_SECTIONS,custom_types:JT.CUSTOM_TYPES,default:JT.defaultTemplate()};
    const usage=()=>{const rows=db.prepare('SELECT * FROM journal_settings').all();const n=k=>rows.filter(r=>customKeys(r).has(k)).length;return {communities:db.prepare("SELECT COUNT(*) c FROM communities WHERE status='active'").get().c,custom_mode:n('mode'),custom_meters:n('meters'),custom_roles:n('roles')};};
    app.get(A,requireSuperAdmin,wrap((req,res)=>{res.set('Cache-Control','no-store');res.json({template:template.read(),builtins,usage:usage()});}));
    app.put(A,requireSuperAdmin,wrap((req,res)=>{res.json({success:true,template:template.write(req.body||{}),usage:usage()});}));
    app.post(`${A}/reset`,requireSuperAdmin,wrap((req,res)=>{res.json({success:true,template:template.reset(),usage:usage()});}));
  }

  return {settingsFor,weekSummary,dailyPayload,weeklyPayload,weekStart,addDays};
};
module.exports.DEFAULT_METERS=DEFAULT_METERS;
module.exports.TRACK_CATEGORIES=TRACK_CATEGORIES;
