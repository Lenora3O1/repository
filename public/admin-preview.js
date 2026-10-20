// 總後台模組預覽（隔離沙盒）
// 1) 以總後台身分讀取「指定公司」的實際目錄與美編設定（唯讀）。
// 2) 之後把 window.fetch 換成示意資料路由：現場／內勤程式發出的所有 API 都由這裡回應，
//    任何新增、修改、刪除一律攔截，不會送到伺服器。
// 3) 載入真正的 index.html / company.html 與其程式，因此預覽畫面就是實際模組畫面。
(function(){
  'use strict';
  const params=new URLSearchParams(location.search);
  const scope=params.get('scope')==='company'?'company':'staff';
  const tenantId=Number(params.get('tenant_id')||0)||null;
  const initialAction=params.get('action')||'';
  const realFetch=window.fetch.bind(window);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ---------- 示意資料 ----------
  const today=new Date();
  const iso=(dOffset=0,h=9,m=0)=>{const d=new Date(today);d.setDate(d.getDate()+dOffset);d.setHours(h,m,0,0);return d.toISOString();};
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const month=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const COMMUNITIES=[{id:901,name:'示意社區・綠景莊園',status:'active'},{id:902,name:'示意社區・翠堤大廈',status:'active'}];
  const PEOPLE=[
    {id:801,employee_id:'D001',name:'王小明',job_level:'經理',job_category:'社區管理',work_type:'site',position:'經理｜社區管理'},
    {id:802,employee_id:'D002',name:'林雅婷',job_level:'秘書',job_category:'秘書',work_type:'site',position:'秘書｜秘書'},
    {id:803,employee_id:'D003',name:'陳志豪',job_level:'保全',job_category:'保全',work_type:'site',position:'保全｜保全'},
    {id:804,employee_id:'D004',name:'張美玲',job_level:'專員',job_category:'會計',work_type:'internal',position:'專員｜會計'},
    {id:805,employee_id:'D005',name:'黃建宏',job_level:'機動',job_category:'機動',work_type:'site',position:'機動｜機動'}
  ];
  const SITE_PERMS=['todo','work-journal','finance','committee','residents','vendors','handover','company-resources','sop','schedule','attendance'];
  const COMPANY_PERMS=['finance','company-resources','manage-staff','manage-communities','view-submissions','manage-templates','manage-sop','work-journal','company-work-journal','company-accounting','company-general-affairs','company-personnel','company-finance','company-hr','company-new-record','schedule','attendance'];
  const siteAssignments=COMMUNITIES.map(c=>({community_id:c.id,community_name:c.name,job_categories:['社區管理'],job_level:'經理',permissions:SITE_PERMS}));
  const scheduleProfile={staff_id:801,schedule_role:'admin',community_ids:COMMUNITIES.map(c=>c.id),rest_days:8,self_select_days:2,default_shift:'day'};
  const ctx={tenant:{id:tenantId||0,name:'示意公司'},branding:null,menu:[]};

  function staffUser(){return {id:801,employee_id:'D001',name:'王小明（示意）',position:'經理｜社區管理',job_category:'社區管理',job_level:'經理',work_type:'site',permissions:SITE_PERMS,job_categories:['社區管理'],schedule_role:'admin',schedule_profile:scheduleProfile,site_assignments:siteAssignments.slice(0,1),company_assignment:null,role:'staff',tenant_id:ctx.tenant.id,tenant_name:ctx.tenant.name};}
  function companyUser(){return {id:810,employee_id:'A001',name:'公司管理員（示意）',admin_level:'owner',role:'company_admin',work_type:'internal',permissions:COMPANY_PERMS,job_categories:['社區管理']};}
  const todos=[
    {id:1,content:'B1 機房抽水馬達異音，聯絡保養廠商到場檢查',status:'open',created_at:iso(-1,10),created_by_name:'林雅婷',visibility:'community',community_id:901},
    {id:2,content:'下週一管委會月例會資料印製 15 份',status:'open',created_at:iso(0,8,30),created_by_name:'王小明',visibility:'community',community_id:901},
    {id:3,content:'中庭照明定時器調整為 18:00 開啟',status:'open',created_at:iso(-2,14),created_by_name:'陳志豪',visibility:'community',community_id:901}
  ];
  const residents=(()=>{const names=['曲采姿','古博翔','何靖閔','李佳穎','吳承恩','周子瑜','鄭家豪','蔡依林','許志明','謝雅雯','劉冠廷','楊淑芬'];return names.map((n,i)=>({id:i+1,building:i<6?'A棟':'B棟',unit:`${Math.floor(i/2)+1}F-${(i%2)+1}`,floor:String(Math.floor(i/2)+1),name:n,phone:`09${String(12345678+i*1111).slice(0,2)}-${String(345678+i*731).slice(0,3)}-${String(100+i*37).padStart(3,'0')}`,address:'',extra:i%3===0?'承租人；機車位 B1-'+(100+i):''}));})();
  const sops=[
    {id:1,title:'颱風季防災應變流程',category:'行政',description:'颱風警報發布後的巡查、沙包與通報流程',version:'v2',original_filename:'颱風應變SOP.pdf',updated_at:iso(-10),updated_by:'公司總務',scope_type:'company_basic',review_status:'published',is_active:1},
    {id:2,title:'夜間巡邏勤務規範',category:'勤務',description:'夜班巡邏路線、打卡點與異常通報',version:'v1',original_filename:'夜間巡邏規範.docx',updated_at:iso(-20),updated_by:'勤務主管',scope_type:'company_basic',review_status:'published',is_active:1},
    {id:3,title:'包裹代收注意事項',category:'案場注意事項',description:'本社區包裹登記與領取規則',version:'v1',original_filename:'包裹代收.pdf',updated_at:iso(-3),updated_by:'王小明',scope_type:'community',review_status:'published',is_active:1}
  ];
  const resources=[
    {id:1,name:'住戶聯繫表上傳範本',original_name:'住戶聯繫表範本.xlsx',extension:'.xlsx',category:'住戶名冊',description:'上傳住戶名冊時使用的欄位範本',created_at:iso(-30)},
    {id:2,name:'交接清冊空白表',original_name:'交接清冊.docx',extension:'.docx',category:'交接清冊',description:'紙本交接時使用',created_at:iso(-40)},
    {id:3,name:'員工手冊 2026',original_name:'員工手冊2026.pdf',extension:'.pdf',category:'公司資源',description:'人事規章與福利說明',created_at:iso(-60)}
  ];
  const attLocations=[
    {id:11,community_id:901,location_type:'attendance',name:'一樓大廳管理中心',address:'大廳櫃台',lat:25.033,lng:121.565,radius_m:80,qr_token:'P-DEMO-CHECKIN',is_active:true},
    {id:12,community_id:901,location_type:'patrol',name:'B1 機房',address:'機房鐵門旁',radius_m:30,qr_token:'P-DEMO-B1',is_active:true},
    {id:13,community_id:901,location_type:'patrol',name:'B2 車道出入口',address:'車道柵欄旁',radius_m:30,qr_token:'P-DEMO-B2',is_active:true},
    {id:14,community_id:902,location_type:'attendance',name:'翠堤大廳',address:'大廳',radius_m:80,qr_token:'P-DEMO-C2',is_active:true}
  ];
  const attRoutes=[{id:21,community_id:901,name:'夜間地下室巡邏',time_label:'22:00',is_active:true,points:[{location_id:12,sequence_no:1,name:'B1 機房'},{location_id:13,sequence_no:2,name:'B2 車道出入口'}]}];
  const attRecords=[
    {id:1,recorded_at:iso(0,8,2),record_type:'checkin',location_name:'一樓大廳管理中心',staff_name:'王小明',employee_id:'D001',community_name:COMMUNITIES[0].name,source:'online'},
    {id:2,recorded_at:iso(-1,22,10),record_type:'patrol',location_name:'B1 機房',patrol_route_name:'夜間地下室巡邏',staff_name:'陳志豪',employee_id:'D003',community_name:COMMUNITIES[0].name,source:'offline'},
    {id:3,recorded_at:iso(-1,22,18),record_type:'patrol',location_name:'B2 車道出入口',patrol_route_name:'夜間地下室巡邏',staff_name:'陳志豪',employee_id:'D003',community_name:COMMUNITIES[0].name,source:'online'},
    {id:4,recorded_at:iso(-1,18,1),record_type:'checkout',location_name:'一樓大廳管理中心',staff_name:'林雅婷',employee_id:'D002',community_name:COMMUNITIES[0].name,source:'online'}
  ];
  function scheduleEntries(){const out=[];const days=new Date(today.getFullYear(),today.getMonth()+1,0).getDate();let id=1;for(const p of PEOPLE.filter(x=>x.work_type!=='internal')){for(let d=1;d<=days;d++){const date=ymd(new Date(today.getFullYear(),today.getMonth(),d));const off=(d+p.id)%6===0;out.push({id:id++,staff_id:p.id,staff_name:p.name,employee_id:p.employee_id,community_id:901,community_name:COMMUNITIES[0].name,work_date:date,month,category:p.job_category==='保全'?'security':p.job_category==='機動'?'mobile':'admin',shift_code:off?'off':(p.job_category==='保全'?'day':'work'),source:'auto'});}}return out;}
  // 示意聊天：文字、貼圖、圖片（圖片用內嵌 SVG，不讀取任何正式檔案）
  const demoPhoto='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3f3"/><stop offset="1" stop-color="#eef4ea"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><rect x="120" y="230" width="560" height="300" fill="#b9c7c0"/><rect x="170" y="280" width="120" height="110" fill="#8fa39a"/><rect x="340" y="280" width="120" height="110" fill="#8fa39a"/><rect x="510" y="280" width="120" height="110" fill="#8fa39a"/><rect x="360" y="420" width="80" height="110" fill="#6d8178"/><text x="400" y="150" font-size="44" text-anchor="middle" fill="#45605a" font-family="sans-serif">示意照片</text></svg>');
  const ME={id:801,employee_id:'D001',name:'王小明（示意）',role:'staff',work_type:'site'}, MEI={id:804,employee_id:'D004',name:'張美玲',role:'staff',work_type:'internal'};
  const msgDef=[
    [MEI,ME,'text','明天上午 10 點電梯保養，麻煩先張貼公告。',null,-1,9,12,true],
    [ME,MEI,'text','收到，我下午貼好。',null,-1,9,20,true],
    [ME,MEI,'sticker','[貼圖] 收到！',{id:'received',emoji:'👌',text:'收到！',tone:'green'},-1,9,21,true],
    [ME,MEI,'image','[圖片] 公告已張貼在一樓電梯旁',{url:demoPhoto,name:'公告照片.jpg',width:800,height:600},0,14,5,true],
    [MEI,ME,'sticker','[貼圖] 辛苦了',{id:'hardwork',emoji:'💪',text:'辛苦了',tone:'gold'},0,14,9,false],
    [MEI,ME,'text','另外 B1 抽水馬達的保養報告，廠商下週會送過來。',null,0,14,10,false]
  ];
  const messages=msgDef.map(([from,to,type,body,att,d,h,mi,read],i)=>({id:900+i,subject:'',body,message_type:type,attachment:att,created_at:iso(d,h,mi),read_at:read?iso(d,h,mi+1):null,sender_id:from.id,recipient_id:to.id,sender:from,recipient:to,sender_name:from.name,recipient_name:to.name}));
  const msgFor=meId=>messages.map(m=>({...m,direction:m.sender_id===meId?'out':'in',unread:m.recipient_id===meId&&!m.read_at}));
  const STICKERS=[['received','👌','收到！','green'],['thanks','🙏','謝謝','peach'],['hardwork','💪','辛苦了','gold'],['ok','👍','好的','blue'],['wait','⏳','稍等一下','lilac'],['onit','🏃','馬上處理','orange'],['done','✅','處理好了','green'],['help','🆘','請協助','red'],['check','👀','請確認','blue'],['call','📞','請回電','teal'],['sorry','🙇','抱歉','peach'],['great','🎉','太棒了','gold'],['morning','☀️','早安','orange'],['night','🌙','晚安','lilac'],['onsite','📍','已到現場','teal'],['vendor','🔧','已通知廠商','gray']].map(([id,emoji,text,tone])=>({id,emoji,text,tone}));

  // ---------- 示意 API 路由 ----------
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  // 未知 GET：回傳「可當陣列也可當物件」的空資料，讓模組顯示空狀態而不是報錯。
  function emptyish(){const a=[];for(const k of ['rows','items','records','staff','communities','sops','todos','pins','entries','locations','routes','submissions','templates','admins','messages','conversations','recipients','platformResources','companyResources','globalTemplates','companyTemplates','problems','questions','managers'])a[k]=[];a.success=true;a.preview=true;return a;}
  const GET=[
    [/^\/api\/form-config$/,()=>'passthrough'],
    [/^\/api\/staff\/session$/,()=>({loggedIn:true,entry:'staff',user:staffUser()})],
    [/^\/api\/staff\/branding$/,()=>ctx.branding||{}],
    [/^\/api\/staff\/menu-config$/,()=>({scope:'staff',items:ctx.menu})],
    [/^\/api\/staff\/profile$/,()=>({...staffUser(),site_assignments:siteAssignments})],
    [/^\/api\/staff\/communities$/,()=>COMMUNITIES],
    [/^\/api\/staff\/dashboard-pins$/,()=>{const leaf=ctx.menu.filter(x=>x.parentId&&x.enabled!==false).slice(0,3);return {pins:leaf.map((item,i)=>({menu_id:item.id,sort_order:i,item}))};}],
    [/^\/api\/staff\/todos\/archived$/,()=>({todos:[{id:9,content:'中秋節社區活動場地復原',status:'done',created_at:iso(-12),completed_at:iso(-11),created_by_name:'林雅婷',completed_by_name:'王小明'}]})],
    [/^\/api\/staff\/todos$/,()=>({todos})],
    [/^\/api\/staff\/drafts$/,()=>({drafts:[]})],
    [/^\/api\/staff\/residents$/,(u)=>({community:COMMUNITIES[0],category:u.searchParams.get('category')||'residents-contact',records:residents,preference:{sort:'building'},last_import:{original_filename:'住戶資料表(示意).xlsx',imported_at:iso(-5),imported_by_name:'王小明'},viewer:{can_upload:true}})],
    [/^\/api\/staff\/platform-resources$/,()=>({platformResources:resources,companyResources:[]})],
    [/^\/api\/staff\/company-resources$/,()=>({platformResources:resources,companyResources:[],resources})],
    [/^\/api\/staff\/sops$/,(u)=>{const cat=u.searchParams.get('category')||'',sc=u.searchParams.get('scope')||'';return {sops:sops.filter(x=>(!cat||x.category===cat)&&(!sc||x.scope_type===sc)).map(x=>({...x,target_jobs:x.scope_type==='community'?['秘書','保全']:[],source_type:x.scope_type==='community'?'manager':'company',uploader_name:x.scope_type==='community'?'王小明':''})),viewer:{job_level:'經理',manager:true,can_upload:true,upload_communities:COMMUNITIES.map(c=>({id:c.id,name:c.name})),upload_scope:'assigned'}};}],
    [/^\/api\/staff\/manager-checklist$/,async()=>{const r=await realFetch('/api/form-config',{credentials:'same-origin'});const c=r.ok?await r.json():{pages:[],questions:[]};return {version:'central-manager',formConfig:{title:c.title||'社區交接清冊',subtitle:c.subtitle||'',pages:c.pages||[],questions:c.questions||[]},communities:COMMUNITIES};}],
    [/^\/api\/staff\/handover\/forms$/,()=>({forms:[{id:'manager',label:'經理交接清冊',drafts:1},{id:'secretary',label:'秘書交接清冊',drafts:0}]})],
    [/^\/api\/staff\/handover\/(manager|secretary)\/config$/,async(u)=>{const type=u.pathname.split('/')[4];const r=await realFetch('/api/admin/handover-forms',{credentials:'same-origin'});const d=r.ok?await r.json():{forms:{}};const c=d.forms?.[type]||{pages:[],questions:[]};const label=type==='secretary'?'秘書交接清冊':'經理交接清冊';return {formType:type,label,formConfig:{formType:type,label,title:label,subtitle:c.subtitle||'',pages:c.pages||[],questions:c.questions||[]},communities:COMMUNITIES,today:ymd(today)};}],
    [/^\/api\/staff\/handover\/(manager|secretary)\/submissions$/,()=>({submissions:[{id:12,created_at:iso(-20),community_id:COMMUNITIES[0].id,community_name:COMMUNITIES[0].name}]})],
    [/^\/api\/staff\/schedule\/community-view$/,()=>({month,communities:COMMUNITIES,selected_community_id:901,staff:PEOPLE.filter(p=>p.work_type!=='internal'),entries:scheduleEntries(),profile:scheduleProfile,self_off_dates:[],off_conflicts:[]})],
    [/^\/api\/staff\/schedule\/(month|community)$/,()=>({month,category:'admin',profile:scheduleProfile,entries:scheduleEntries().filter(e=>e.staff_id===801),communities:COMMUNITIES,problems:[],rules:[]})],
    [/^\/api\/staff\/schedule\/(rules|requests|overtime)$/,()=>({rules:COMMUNITIES.map(c=>({community_id:c.id,name:c.name,config:{mode:'rotation',rest_days:8}})),rows:[]})],
    [/^\/api\/staff\/attendance\/bootstrap$/,()=>({rules:{enabled:true,default_checkin_radius_m:80},communities:COMMUNITIES,locations:attLocations,routes:attRoutes,active_community_id:901,patrol_access:{901:true,902:false},can_manage_patrol:true})],
    [/^\/api\/staff\/attendance\/records$/,()=>({rows:attRecords})],
    [/^\/api\/staff\/attendance\/patrol-management$/,()=>({locations:attLocations.filter(l=>l.location_type==='patrol')})],
    [/^\/api\/staff\/attendance\/patrol-status$/,()=>({summary:{people:1,scans:2,points:2},rows:attRecords.filter(r=>r.record_type==='patrol')})],
    [/^\/api\/messages\/unread-count$/,()=>({count:2})],
    [/^\/api\/messages\/stickers$/,()=>({stickers:STICKERS})],
    [/^\/api\/messages\/typing$/,()=>({typing:false})],
    [/^\/api\/messages\/recipients$/,()=>PEOPLE.filter(p=>p.id!==801).map(p=>({...p,role:'staff',communities:p.work_type==='internal'?[]:[COMMUNITIES[0].name],scope_label:p.work_type==='internal'?'公司內勤':'社區駐點'}))],
    [/^\/api\/messages\/conversation\/\d+/,()=>({partner:{...MEI,scope_label:'公司內勤'},messages:msgFor(scope==='company'?804:801)})],
    [/^\/api\/messages$/,()=>msgFor(scope==='company'?804:801).slice().reverse()],
    [/^\/api\/gifts$/,()=>({gifts:[['中秋精緻禮盒','#c0392b','月','企業團購 9 折，可客製祝福卡片'],['手工茶葉禮盒','#2e7d4f','茶','台灣高山茶，送禮自用兩相宜'],['節慶花禮','#b0457a','花',''],['精品咖啡組','#6b4a2f','啡','精選單品豆，附濾掛']].map(([name,color,ch,desc],i)=>({id:i+1,name,description:desc,website_url:'https://example.com/gift-'+(i+1),line_url:i===2?'':'https://lin.ee/example',logo_url:'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" rx="18" fill="#fff"/><circle cx="120" cy="80" r="52" fill="${color}"/><text x="120" y="98" font-size="52" text-anchor="middle" fill="#fff" font-family="sans-serif">${ch}</text><text x="120" y="160" font-size="20" text-anchor="middle" fill="${color}" font-family="sans-serif">示意 LOGO</text></svg>`)}))})],
    [/^\/api\/staff\/journal\/context$/,()=>({communities:COMMUNITIES.map(c=>({id:c.id,name:c.name,mode:c.id===902?'weekly':'daily'})),manager:true,today:ymd(today),categories:{}})],
    [/^\/api\/staff\/journal\/(day|week)$/,(u)=>{const weekly=/week$/.test(u.pathname);const date=u.searchParams.get('date')||ymd(today);const meters=[['water','自來水表',11472],['public_power','大公電表',1613],['door','鐵捲門次數表',22523]].map(([key,label,base])=>({key,label,today:null,usage:null,history:[...Array(6)].map((_,i)=>({date:ymd(new Date(today.getTime()-(6-i)*86400000)),value:base+i*40,usage:i?40:null}))}));
      const base={settings:{mode:weekly?'weekly':'daily',meters:meters.map(m=>({key:m.key,label:m.label})),roles:['總幹事','秘書'],overview:{total:'186',owner:'75',tenant:'25',vacant:'63',reno_applied:'23',reno_working:'15',reno_pending:'8',car:'195',moto:'198'}},community:{id:901,name:COMMUNITIES[0].name},manager:true,journal:{status:'draft',data:{notes:{'總幹事':[{text:'巡視公設，B5F 牆面油漆進度追蹤。',remark:''}]},construction_units:[{unit:'4A5',work:'系統、設計師',people:'5'}]},updated_by:'王小明',updated_at:iso(0,9)},meters,renovations:[{id:1,unit:'7A3',permit_period:'3/2',deposit:'paid',cleaning_fee:'paid',status:'done',detector_reset:false},{id:2,unit:'26B2',permit_period:'5/22',deposit:'paid',cleaning_fee:'paid',status:'working',detector_reset:true}],tracking:[{id:1,category:'resident',category_label:'住戶交辦事項與問題處置',opened_on:ymd(new Date(today.getTime()-9*86400000)),content:'19B5 住戶反映客梯刷卡會直接亮 B1 樓層。',closed_on:null,updates:[{id:1,update_date:ymd(new Date(today.getTime()-8*86400000)),content:'已向電梯廠商報修。'}]}],staffing_suggestion:{rows:PEOPLE.filter(p=>p.work_type!=='internal').map((p,i)=>({role:p.job_level,name:p.name,status:i===1?'off':'work'})),tomorrow_off:'保全 陳志豪'},live:true,date};
      if(!weekly)return base;
      return {...base,week_start:date,summary:{week_start:date,week_end:ymd(new Date(new Date(date).getTime()+6*86400000)),construction:[],construction_total:{unit_people:24,public_people:3},daily_count:5,daily_submitted:4,meters:meters.map((m,i)=>({key:m.key,label:m.label,usage:280+i*10,prev_usage:i===0?190:270+i*10,change_pct:i===0?47.4:3.7,abnormal:i===0})),renovation:{new_units:['22B1'],done_units:['8B6'],working:15,detector_pending:['7A3']},tracking:{new_count:3,closed:[{content:'環保室照明改回恆亮',category_label:'公共設施相關修繕',closed_on:date}],open:[],overdue:1,resident_new:2,by_category:[{label:'管理委員會',new:0,open:1},{label:'住戶交辦事項與問題處置',new:2,open:3},{label:'管理中心待辦事項',new:1,open:1},{label:'公共設施相關修繕',new:0,open:2}]},staffing:PEOPLE.filter(p=>p.work_type!=='internal').map(p=>({role:p.job_level,name:p.name,work_days:5,off_days:2}))}};}],
    [/^\/api\/staff\/journal\/list$/,()=>({rows:[{id:1,period_date:ymd(today),status:'draft',updated_by:'王小明',updated_at:iso(0,9)}]})],
    [/^\/api\/company\/journal\/communities$/,()=>({communities:COMMUNITIES.map(c=>({...c,mode:c.id===902?'weekly':'daily',last_journal:ymd(today)})),today:ymd(today)})],
    [/^\/api\/company\/journal\/list$/,()=>({rows:[{id:1,community_id:901,community_name:COMMUNITIES[0].name,kind:'daily',period_date:ymd(today),status:'submitted',updated_by:'王小明',updated_at:iso(0,9),submitted_by:'王小明',submitted_at:iso(0,18)}]})],
    // 公司內勤
    [/^\/api\/company\/session$/,()=>({loggedIn:true,entry:'company',user:companyUser(),tenant:{id:ctx.tenant.id,name:ctx.tenant.name}})],
    [/^\/api\/company\/branding$/,()=>ctx.branding||{}],
    [/^\/api\/company\/menu-config$/,()=>({scope:'company',items:ctx.menu})],
    [/^\/api\/company\/site-menu-config$/,()=>({scope:'staff',items:ctx.siteMenu||[]})],
    [/^\/api\/company\/staff$/,()=>PEOPLE.map(p=>({...p,is_active:1,role:'staff',permissions:p.work_type==='internal'?['finance','company-resources']:SITE_PERMS,job_categories:[p.job_category],site_assignments:p.work_type==='internal'?[]:[{community_id:901,community_name:COMMUNITIES[0].name}],community_ids:p.work_type==='internal'?[]:[901],last_login_at:iso(-1),created_at:iso(-90)}))],
    [/^\/api\/company\/communities$/,()=>COMMUNITIES.map(c=>({...c,tenant_id:ctx.tenant.id,created_at:iso(-200)}))],
    [/^\/api\/company\/submissions$/,()=>({submissions:[{id:1,created_at:iso(-6),employee_id:'D001',staff_name:'王小明',data:{community_name:COMMUNITIES[0].name,handover_date:ymd(today)}}],questions:[]})],
    [/^\/api\/company\/templates$/,()=>({globalTemplates:[{id:1,name:'平台交接清冊範本',filename:'demo.docx',is_active:1,created_at:iso(-100)}],companyTemplates:[]})],
    [/^\/api\/company\/platform-resources$/,()=>({platformResources:resources,companyResources:[]})],
    [/^\/api\/company\/admins$/,()=>({admins:[{id:810,employee_id:'A001',name:'公司管理員（示意）',admin_level:'owner',is_active:1,last_login_at:iso(0)}],current_user_id:810,current_admin_level:'owner'})],
    [/^\/api\/company\/sops$/,()=>({sops})],
    [/^\/api\/company\/sops\/upload-context$/,()=>({communities:COMMUNITIES,managers:[PEOPLE[0]],current_uploader_id:810,current_uploader_name:'公司管理員（示意）'})],
    [/^\/api\/company\/schedule\/staff$/,()=>({staff:PEOPLE.filter(p=>p.work_type!=='internal').map(p=>({...p,is_active:1,job_categories:[p.job_category],schedule_profile:{...scheduleProfile,staff_id:p.id,schedule_role:p.job_category==='保全'?'security':p.job_category==='機動'?'mobile':'admin'},site_assignments:siteAssignments.slice(0,1)})),communities:COMMUNITIES})],
    [/^\/api\/company\/schedule\/month$/,(u)=>{const cat=u.searchParams.get('category')||'security';return {month,category:cat,community_id:901,entries:scheduleEntries().filter(e=>e.category===cat),problems:[]};}],
    [/^\/api\/company\/schedule\/rules$/,(u)=>({tenant_id:ctx.tenant.id,community_id:null,category:u.searchParams.get('category')||'security',config:{mode:'rotation',rest_days:8,self_select_days:2,max_consecutive:6,shift:'day'}})],
    [/^\/api\/company\/schedule\/menu-state$/,()=>({enabled:true,items:[]})],
    [/^\/api\/company\/attendance\/bootstrap$/,()=>({rules:{enabled:true,default_checkin_radius_m:80,patrol_qr_radius_m:30},communities:COMMUNITIES,locations:attLocations,routes:attRoutes})],
    [/^\/api\/company\/attendance\/records$/,()=>({rows:attRecords})],
    [/^\/api\/company\/attendance\/routes$/,()=>({routes:attRoutes})],
    [/^\/api\/company\/attendance\/patrol-staff$/,()=>({community:COMMUNITIES[0],staff:PEOPLE.filter(p=>p.work_type!=='internal').map(p=>({...p,is_patrol:p.job_category==='保全'}))})],
    [/^\/api\/company\/attendance\/maps-config$/,()=>({configured:false,key:''})],
    [/^\/api\/company\/message-audit\/access$/,()=>({enabled:false,authorized:false,user_id:810})],
    [/^\/api\/company\/personnel-archive/,()=>[]]
  ];
  function previewToast(text){
    let t=document.getElementById('previewToast');
    if(!t){t=document.createElement('div');t.id='previewToast';t.setAttribute('role','status');document.body.appendChild(t);}
    t.textContent=text;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2600);
  }
  async function mockFetch(input,init={}){
    const url=new URL(typeof input==='string'?input:input.url,location.origin);
    const method=String(init.method||(typeof input==='object'&&input.method)||'GET').toUpperCase();
    if(url.origin!==location.origin) return json({error:'預覽模式不連線外部網站'},403);
    if(!url.pathname.startsWith('/api/')) return realFetch(input,init); // 靜態檔（範本 html、css）
    if(method!=='GET'){
      previewToast('預覽模式：此操作不會儲存，也不會修改任何正式資料。');
      if(/\/(login)$/.test(url.pathname)) return json({success:true,user:staffUser()});
      if(/\/logout$/.test(url.pathname)) return json({success:true});
      return json({success:true,preview:true,id:0,rows:[],items:[]});
    }
    for(const [re,fn] of GET){
      if(re.test(url.pathname)){
        const out=await fn(url);
        if(out==='passthrough') return realFetch(url.pathname+url.search,{credentials:'same-origin'});
        return json(out);
      }
    }
    return json(emptyish());
  }

  // ---------- 開機 ----------
  async function adminJson(path){const r=await realFetch(path,{credentials:'same-origin',cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`讀取失敗（${r.status}）`);return d;}
  function showFatal(msg){document.body.innerHTML=`<div style="font-family:sans-serif;padding:32px;color:#7a2e1f"><h2>預覽無法載入</h2><p>${esc(msg)}</p><p style="color:#555">請確認仍以系統總管理員身分登入總後台。</p></div>`;}
  async function boot(){
    try{
      const q=tenantId?`tenant_id=${tenantId}&`:'';
      const [menu,siteMenu]=await Promise.all([adminJson(`/api/admin/menu-preview?${q}scope=${scope}`),scope==='company'?adminJson(`/api/admin/menu-preview?${q}scope=staff`):Promise.resolve(null)]);
      ctx.menu=menu.items||[];ctx.siteMenu=siteMenu?.items||[];
      if(menu.tenant)ctx.tenant={id:menu.tenant.id,name:menu.tenant.name};else ctx.tenant={id:0,name:'平台預設（示意公司）'};
      if(tenantId){try{ctx.branding=await adminJson(`/api/admin/tenants/${tenantId}/branding`);}catch{ctx.branding=null;}}
    }catch(e){showFatal(e.message);return;}

    // 從這一刻起，所有程式的 API 呼叫都只會拿到示意資料。
    window.fetch=mockFetch;
    window.open=function(){previewToast('預覽模式不提供檔案下載或開新視窗。');return null;};
    document.addEventListener('click',e=>{
      const a=e.target.closest?.('a[href]');
      if(a){const href=a.getAttribute('href')||'';if(href&&!href.startsWith('#')&&!href.startsWith('javascript:')){e.preventDefault();e.stopPropagation();previewToast('預覽模式不會離開此頁面。');return;}}
      if(e.target.closest?.('#logoutBtn,#staffEntryLink,#staffLogoutBtn,[data-logout]')){e.preventDefault();e.stopImmediatePropagation();previewToast('預覽模式不提供登出。');}
    },true);
    document.addEventListener('submit',e=>{const f=e.target;if(f&&f.getAttribute('action')){e.preventDefault();previewToast('預覽模式：此操作不會儲存。');}},true);

    const page=scope==='company'?'company.html':'index.html';
    const html=await (await realFetch(page,{cache:'no-store'})).text();
    const doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('link[rel=stylesheet]').forEach(l=>{const n=document.createElement('link');n.rel='stylesheet';n.href=l.getAttribute('href');document.head.appendChild(n);});
    doc.querySelectorAll('head style').forEach(s=>document.head.appendChild(s.cloneNode(true)));
    const scripts=[...doc.querySelectorAll('script')];
    scripts.forEach(s=>s.remove());
    const banner=document.createElement('div');
    banner.className='preview-banner';
    banner.innerHTML=`<strong>預覽模式</strong><span>${esc(ctx.tenant.name)}｜${scope==='company'?'公司內勤':'社區駐點／現場人員'}</span><span class="preview-banner-note">示意資料・所有變更都不會儲存</span>`;
    document.body.innerHTML=doc.body.innerHTML;
    document.body.prepend(banner);
    document.body.classList.add('is-admin-preview');
    for(const s of scripts){
      await new Promise(resolve=>{
        const n=document.createElement('script');
        if(s.src){n.src=s.getAttribute('src');n.onload=resolve;n.onerror=resolve;}
        else{n.textContent=s.textContent;}
        document.body.appendChild(n);
        if(!s.src)resolve();
      });
    }
    // 預覽頁路徑不是 company.html／index.html，側邊欄不會自動判斷工作空間，這裡主動載入一次。
    if(scope==='company')setTimeout(()=>window.refreshWorkspaceMenu?.('company'),300);
    if(initialAction){
      const item=ctx.menu.find(x=>String(x.action)===initialAction||String(x.id)===initialAction);
      setTimeout(()=>document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:item?.action||initialAction,id:item?.id||initialAction,label:item?.label||''}})),700);
    }
    try{parent.postMessage({type:'admin-preview-ready',scope,tenant:ctx.tenant,menu:ctx.menu},location.origin);}catch{}
  }
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin||e.data?.type!=='admin-preview-open')return;
    const d=e.data;document.dispatchEvent(new CustomEvent('workspace-menu',{detail:{action:d.action,id:d.id,label:d.label}}));
  });
  boot();
})();
