require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const db = require('./db');
const { generateDocx } = require('./generate');
const { analyzeTemplate } = require('./template-analyzer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TEMPLATES_DIR = path.join(DATA_DIR, 'uploads', 'templates');
const SOPS_DIR = path.join(DATA_DIR, 'uploads', 'sops');
const GENERATED_DIR = path.join(DATA_DIR, 'generated');
const QUESTIONS_PATH = path.join(__dirname, 'config', 'questions.json');
const FORM_CONFIG_PATH = path.join(DATA_DIR, 'form-config.json');
const MENU_CONFIG_PATH = path.join(DATA_DIR, 'menu-config.json');
for (const dir of [TEMPLATES_DIR, SOPS_DIR, GENERATED_DIR]) fs.mkdirSync(dir, { recursive: true });

const sopUpload=multer({
  storage:multer.diskStorage({
    destination:(req,file,cb)=>cb(null,SOPS_DIR),
    filename:(req,file,cb)=>{
      const ext=path.extname(file.originalname||'').toLowerCase();
      const safeBase=path.basename(file.originalname||'sop',ext).replace(/[^\w\u4e00-\u9fa5.-]/g,'_').slice(0,80)||'sop';
      cb(null,`${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeBase}${ext}`);
    }
  }),
  limits:{fileSize:20*1024*1024},
  fileFilter:(req,file,cb)=>{
    const ext=path.extname(file.originalname||'').toLowerCase();
    cb(['.pdf','.doc','.docx','.xls','.xlsx','.xlsm','.txt'].includes(ext)?null:new Error('SOP 僅允許 PDF、Word、Excel 或 TXT 檔案'),true);
  }
});


app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax', httpOnly: true }
}));

function requireSuperAdmin(req,res,next){ if(req.session?.isAdmin) return next(); return res.status(401).json({error:'尚未登入總後臺或登入已過期'}); }
function requireStaff(req,res,next){ const u=getUser(req); const t=u?.tenant_id?db.prepare('SELECT status FROM tenants WHERE id=?').get(u.tenant_id):null; if(u && u.is_active && u.tenant_id && t?.status==='active') return next(); return res.status(401).json({error:'帳號已停用、公司已停用或尚未登入'}); }
function requireStaffFiller(req,res,next){ const u=getUser(req); const t=u?.tenant_id?db.prepare('SELECT status FROM tenants WHERE id=?').get(u.tenant_id):null; if(u && u.is_active && u.tenant_id && t?.status==='active' && u.role!=='company_admin' && hasSiteAccess(u)) return next(); return res.status(403).json({error:'此帳號沒有啟用中的駐點案場，請使用公司內部後台或先設定駐點案場'}); }
function hasSiteAccess(u){ if(!u||!u.tenant_id||u.role==='company_admin') return false; return db.prepare("SELECT 1 FROM staff_communities sc JOIN communities c ON c.id=sc.community_id WHERE sc.staff_id=? AND c.tenant_id=? AND c.status='active' LIMIT 1").get(u.id,u.tenant_id) || db.prepare("SELECT 1 FROM staff_work_assignments a JOIN communities c ON c.id=a.community_id WHERE a.staff_id=? AND a.tenant_id=? AND a.scope_type='site' AND c.status='active' LIMIT 1").get(u.id,u.tenant_id); }
function hasCompanyAccess(u){ return !!u && (u.role==='company_admin' || ['internal','hybrid'].includes(u.work_type||'')); }
function requireCompanyAdmin(req,res,next){ const u=getUser(req); const t=u?.tenant_id?db.prepare('SELECT status FROM tenants WHERE id=?').get(u.tenant_id):null; if(u && u.is_active && u.tenant_id && t?.status==='active' && hasCompanyAccess(u)) return next(); return res.status(403).json({error:'這個帳號沒有公司內部後台權限'}); }
function requireCompanyPermission(key){ return (req,res,next)=>{ const u=getUser(req); if(u?.role==='company_admin') return next(); const a=getCompanyAssignment(u); if(effectivePermissions(u).includes(key)) return next(); return res.status(403).json({error:'您目前沒有這項公司內部功能的權限'}); }; }
function tenantId(req){ return Number(req.session.tenantId); }
function requireMessageUser(req,res,next){
  const u=getUser(req);
  const t=u?.tenant_id?db.prepare('SELECT status FROM tenants WHERE id=?').get(u.tenant_id):null;
  if(u && u.is_active && u.tenant_id && t?.status==='active' && u.role!=='super_admin') return next();
  return res.status(403).json({error:'目前帳號沒有內部訊息功能權限'});
}
function getMessageAuditSettings(tenantIdValue){
  const row=db.prepare('SELECT * FROM message_audit_settings WHERE tenant_id=?').get(tenantIdValue);
  if(!row) return {enabled:false,auditor_ids:[]};
  let ids=[]; try{const x=JSON.parse(row.auditor_ids_json||'[]'); ids=Array.isArray(x)?x.map(Number).filter(Boolean):[]}catch{}
  return {enabled:!!row.enabled,auditor_ids:ids,updated_at:row.updated_at||''};
}
function canAuditMessages(req){
  const u=getUser(req); if(!u||!u.tenant_id||u.role==='super_admin') return false;
  const cfg=getMessageAuditSettings(u.tenant_id);
  return cfg.enabled && (u.role==='company_admin' || cfg.auditor_ids.includes(Number(u.id)));
}
function requireMessageAuditor(req,res,next){
  if(canAuditMessages(req)) return next();
  return res.status(403).json({error:'目前帳號沒有訊息稽核權限，或公司尚未啟用此功能'});
}

function sanitizeBranding(row){return {tenant_id:row.id,title:row.brand_title||row.name||'物業管理公司',subtitle:row.brand_subtitle||'物業管理公司',loginTitle:row.brand_login_title||'公司管理員登入',loginHint:row.brand_login_hint||'這裡是公司專屬管理後台。登入後可管理人員、社區與公司資料。',intro:row.brand_intro||'這裡只管理您所屬公司的資料。',logoText:row.brand_logo_text||'',accent:row.brand_accent||'#2F6F5E',accentDark:row.brand_accent_dark||'#204F42',bg:row.brand_bg||'#F7F7F4',panel:row.brand_panel||'#FFFFFF'};}
function validHex(v,fallback){const s=String(v||'').trim();return /^#[0-9a-fA-F]{6}$/.test(s)?s:fallback;}
function legacyToConfig(){
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH,'utf-8'));
  const sectionNames=[...new Set(questions.map(q=>q.section||'其他'))];
  const pages=sectionNames.map((name,i)=>({id:`page_${i+1}`,title:name,description:''}));
  const pageMap=Object.fromEntries(sectionNames.map((name,i)=>[name,pages[i].id]));
  return {title:'社區交接清冊',subtitle:'物業管理部門',pages,questions:questions.map(q=>({...q,pageId:pageMap[q.section||'其他'],group:'填寫資料'}))};
}
function readFormConfig(){
  if(!fs.existsSync(FORM_CONFIG_PATH)){
    const seedPath=path.join(__dirname,'config','form-config.json');
    const initial=fs.existsSync(seedPath)?JSON.parse(fs.readFileSync(seedPath,'utf-8')):legacyToConfig();
    fs.writeFileSync(FORM_CONFIG_PATH,JSON.stringify(initial,null,2),'utf-8');
  }
  const config=JSON.parse(fs.readFileSync(FORM_CONFIG_PATH,'utf-8'));
  config.pages=Array.isArray(config.pages)?config.pages:[];
  config.questions=Array.isArray(config.questions)?config.questions:[];
  const defaults={companyTitle:'公司管理後台',companySubtitle:'物業管理公司',companyIntro:'這裡只管理您所屬公司的資料。您可以自行開通一般人員、設定社區權限，以及查看本公司的正式交接紀錄。',companyLoginTitle:'公司管理員登入',companyLoginHint:'這裡是公司專屬管理後台。登入後可開通人員、管理社區與查看本公司交接紀錄。',staffLoginTitle:'物業人員登入',staffLoginHint:'請使用您的「員編＋密碼」登入。填寫到一半可以離開，系統會自動保存，下次登入可繼續。'};
  config.uiTexts={...defaults,...(config.uiTexts||{})};
  return config;
}
function writeFormConfig(config){fs.writeFileSync(FORM_CONFIG_PATH,JSON.stringify(config,null,2),'utf-8');}
function defaultMenuConfig(){
  const seed=path.join(__dirname,'config','menu-config.json');
  if(fs.existsSync(seed)) return JSON.parse(fs.readFileSync(seed,'utf-8'));
  return {staff:[],company:[]};
}
function readMenuConfig(){
  if(!fs.existsSync(MENU_CONFIG_PATH)) fs.writeFileSync(MENU_CONFIG_PATH,JSON.stringify(defaultMenuConfig(),null,2),'utf-8');
  const c=JSON.parse(fs.readFileSync(MENU_CONFIG_PATH,'utf-8'));
  c.staff=Array.isArray(c.staff)?c.staff:[]; c.company=Array.isArray(c.company)?c.company:[];
  c.tenants=(c.tenants&&typeof c.tenants==='object')?c.tenants:{};
  // V5.9：平台預設與企業目錄必須完全隔離。
  // 每家公司都保存自己的目錄快照；建立公司時／第一次升級既有公司時複製當下平台預設。
  // 之後平台管理員修改平台預設，不會回頭同步已存在公司的目錄。
  // 「恢復平台預設」也不是刪掉企業設定改成即時繼承，而是把「目前平台預設」複製一份到該公司，
  // 讓該公司從這一刻起再次獨立。
  try{
    const tenantRows=db.prepare('SELECT id FROM tenants ORDER BY id').all();
    let changed=false;
    for(const t of tenantRows){
      const key=String(t.id);
      if(!c.tenants[key] || typeof c.tenants[key]!=='object') c.tenants[key]={};
      for(const scope of ['staff','company']){
        if(!Array.isArray(c.tenants[key][scope])){
          c.tenants[key][scope]=(c[scope]||[]).map(x=>({...x}));
          changed=true;
        }
      }
    }
    // 目錄完全由平台總後台／各公司既有目錄配置控制；此處不自動新增或修改任何 SOP 目錄。
    if(changed) writeMenuConfig(c);
  }catch(e){ console.error('menu tenant snapshot migration error',e); }
  return c;
}
function writeMenuConfig(c){fs.writeFileSync(MENU_CONFIG_PATH,JSON.stringify(c,null,2),'utf-8');}
function cleanMenuItems(items){
  if(!Array.isArray(items)) return null;
  const ids=new Set();
  const clean=items.map((x,i)=>({
    id:String(x?.id||`menu_${Date.now()}_${i}`).trim(), parentId:x?.parentId?String(x.parentId):null,
    icon:String(x?.icon||'•').trim().slice(0,8), label:String(x?.label||'未命名功能').trim().slice(0,80),
    action:String(x?.action||'placeholder').trim().slice(0,80), enabled:x?.enabled!==false
  })).filter(x=>x.label);
  for(const x of clean){if(ids.has(x.id)) throw new Error('目錄代碼不能重複');ids.add(x.id);}
  const idSet=new Set(clean.map(x=>x.id));
  for(const x of clean){if(x.parentId===x.id || (x.parentId && !idSet.has(x.parentId))) x.parentId=null;}
  return clean;
}
const STAFF_PERMISSION_DEFAULTS=['todo','work-journal','finance','committee','residents','vendors','handover','company-resources'];
const STAFF_PERMISSION_LABELS={
  'todo':'代辦事項','work-journal':'工作日誌','finance':'財務／會計','committee':'管理委員會','residents':'住戶名冊','vendors':'廠商聯繫','handover':'交接清冊','company-resources':'公司資源',
  'manage-staff':'公司人員管理','manage-communities':'社區管理','view-submissions':'交接紀錄','manage-templates':'公司文件／範本','manage-sop':'案場 SOP 管理','sop':'案場 SOP',
  'company-work-journal':'工作日誌管理','company-accounting':'會計','company-general-affairs':'總務管理','company-personnel':'人員','company-finance':'公司財務','company-hr':'人事管理','company-new-record':'新日錄'
};
const COMPANY_PERMISSION_KEYS=new Set(['finance','company-resources','manage-staff','manage-communities','view-submissions','manage-templates','manage-sop','work-journal','company-work-journal','company-accounting','company-general-affairs','company-personnel','company-finance','company-hr','company-new-record']);
const SITE_PERMISSION_KEYS=new Set(['todo','work-journal','finance','committee','residents','vendors','handover','company-resources','sop']);
function parsePermissions(u){
  try{const p=JSON.parse(u?.permission_json||'[]');return Array.isArray(p)?p.map(String):[];}catch{return []}
}
function suggestedPermissionsForUser(u){
  const jobs=getJobCategories(u); const out=new Set();
  const has=x=>jobs.includes(x);
  if(has('會計')||has('財務')) out.add('finance');
  if(has('總務')) {out.add('company-resources');out.add('manage-templates');}
  if(has('人事')) out.add('manage-staff');
  if(has('勤務')) out.add('manage-staff');
  if(has('社區管理')) {out.add('manage-communities');out.add('view-submissions');}
  if((u?.work_type||'site')!=='internal' && (has('社區管理')||has('秘書')||has('保全'))) ['todo','work-journal','committee','residents','vendors','handover'].forEach(x=>out.add(x));
  if(!out.size) out.add((u?.work_type||'site')==='internal'?'company-resources':'todo');
  return [...out];
}
function effectivePermissions(u){
  const raw=parsePermissions(u);
  if(!u || u.role==='company_admin') return raw;
  const legacyAll=raw.length>=STAFF_PERMISSION_DEFAULTS.length && STAFF_PERMISSION_DEFAULTS.every(x=>raw.includes(x));
  return (raw.length===0||legacyAll)?suggestedPermissionsForUser(u):raw;
}
function parseJsonArray(v){try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x.map(String):[];}catch{return []}}
function getJobCategories(u){const a=parseJsonArray(u?.job_categories_json); return a.length?a:(u?.job_category?[String(u.job_category)]:[])}
function getSiteAssignments(u){
  if(!u) return [];
  const rows=db.prepare(`SELECT a.*,c.name community_name FROM staff_work_assignments a LEFT JOIN communities c ON c.id=a.community_id WHERE a.staff_id=? AND a.tenant_id=? AND a.scope_type='site' AND c.status='active' ORDER BY c.name`).all(u.id,u.tenant_id);
  if(rows.length) return rows.map(r=>({...r,job_categories:getJobCategories({job_categories_json:r.job_categories_json,job_category:''}),permissions:parseJsonArray(r.permissions_json)}));
  const legacy=db.prepare(`SELECT c.id,c.name FROM communities c JOIN staff_communities sc ON sc.community_id=c.id WHERE sc.staff_id=? AND c.tenant_id=? AND c.status='active' ORDER BY c.name`).all(u.id,u.tenant_id);
  return legacy.map(c=>({community_id:c.id,community_name:c.name,job_categories:getJobCategories(u),job_level:u.job_level||'',permissions:effectivePermissions(u)}));
}
function getCompanyAssignment(u){
  if(!u) return null;
  const r=db.prepare(`SELECT * FROM staff_work_assignments WHERE staff_id=? AND tenant_id=? AND scope_type='company' ORDER BY id LIMIT 1`).get(u.id,u.tenant_id);
  if(r) return {...r,job_categories:parseJsonArray(r.job_categories_json),permissions:parseJsonArray(r.permissions_json)};
  if(['internal','hybrid'].includes(u.work_type||'')) return {scope_type:'company',job_categories:getJobCategories(u),job_level:u.job_level||'',permissions:effectivePermissions(u)};
  return null;
}
function syncWorkAssignments(staffId, tenantIdValue, workType, communityIds, jobCategories, jobLevel, permissions){
  const ids=[...new Set((communityIds||[]).map(Number).filter(Boolean))];
  const cats=[...new Set((jobCategories||[]).map(String).filter(Boolean))];
  const perms=[...new Set((permissions||[]).map(String).filter(Boolean))];
  const tx=db.transaction(()=>{
    db.prepare('DELETE FROM staff_work_assignments WHERE staff_id=? AND tenant_id=?').run(staffId,tenantIdValue);
    const ins=db.prepare('INSERT INTO staff_work_assignments (staff_id,tenant_id,scope_type,community_id,job_categories_json,job_level,permissions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const t=now();
    if(workType==='internal'||workType==='hybrid') ins.run(staffId,tenantIdValue,'company',null,JSON.stringify(cats),jobLevel||'',JSON.stringify(perms),t,t);
    if(workType==='site'||workType==='hybrid') for(const cid of ids) ins.run(staffId,tenantIdValue,'site',cid,JSON.stringify(cats),jobLevel||'',JSON.stringify(perms),t,t);
  }); tx();
}
function menuPermissionKey(item,scope='staff'){
  const raw=`${item?.id||''} ${item?.action||''} ${item?.label||''}`.toLowerCase();
  // SOP 在公司後台與現場工作台是兩種不同權限；不能讓「案場 SOP」被誤判成公司 SOP 管理。
  if(scope==='staff' && (String(item?.action||'')==='sop'||String(item?.action||'')==='sop-admin'||String(item?.action||'')==='sop-duty'||String(item?.action||'')==='sop-company'||String(item?.action||'')==='sop-community')) return 'sop';
  if(scope==='company' && (String(item?.action||'')==='sop'||String(item?.id||'')==='company-sop')) return 'manage-sop';
  const rules=[
    ['manage-staff',['staff','人員管理','公司人員']],['manage-communities',['communities','社區管理']],['view-submissions',['submissions','交接紀錄']],['manage-templates',['templates','公司文件','範本']],['manage-sop',['manage-sop']],
    ['todo',['todo','代辦事項']],['work-journal',['work-journal','工作日誌']],['finance',['finance','財務','會計']],['committee',['committee','管理委員會']],['residents',['residents','住戶名冊']],['vendors',['vendors','廠商聯繫']],['handover',['handover','交接清冊']],['company-resources',['company-resources','公司資源']]
  ];
  for(const [key,terms] of rules) if(terms.some(t=>raw.includes(String(t).toLowerCase()))) return key;
  return null;
}
function resolveMenu(scope,tenantIdValue,staffUser=null){
  const c=readMenuConfig();
  let items=c[scope]||[];
  if(c.tenants && tenantIdValue && Array.isArray(c.tenants[String(tenantIdValue)]?.[scope])) items=c.tenants[String(tenantIdValue)][scope];
  items=items.filter(x=>x.enabled!==false);
  if(staffUser && staffUser.role!=='company_admin'){
    const selected=new Set(effectivePermissions(staffUser));
    const allowedKeys=scope==='company'?COMPANY_PERMISSION_KEYS:SITE_PERMISSION_KEYS;
    items=items.filter(item=>{
      const key=menuPermissionKey(item,scope);
      if(!key) return true;
      if(!allowedKeys.has(key)) return false;
      return selected.has(key) || (item.parentId && selected.has(menuPermissionKey(items.find(x=>String(x.id)===String(item.parentId)),scope)||''));
    });
  }
  return items;
}


function readQuestions(){return readFormConfig().questions;}
function cleanData(data){ return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {}; }
function now(){return new Date().toISOString();}
function getUser(req){
  if(req.session?.userId) return db.prepare('SELECT * FROM staff_users WHERE id=?').get(Number(req.session.userId));
  if(req.session?.employeeId && req.session?.tenantId) return db.prepare('SELECT * FROM staff_users WHERE employee_id=? AND tenant_id=?').get(req.session.employeeId, Number(req.session.tenantId));
  return null;
}
function authenticateStaff(employeeId, password, tenantCode='', entry='staff') {
  const eid=String(employeeId||'').trim();
  const pass=String(password||'');
  const code=String(tenantCode||'').trim().toLowerCase();
  const loginEntry=entry==='company'?'company':'staff';
  if(!eid || !pass) return {error:'員編或密碼錯誤，或帳號已停用'};
  let rows;
  if(code){
    rows=db.prepare(`SELECT u.*,t.name AS tenant_name,t.status AS tenant_status,t.code AS tenant_code FROM staff_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.employee_id=? AND lower(t.code)=?`).all(eid,code);
  }else{
    rows=db.prepare(`SELECT u.*,t.name AS tenant_name,t.status AS tenant_status,t.code AS tenant_code FROM staff_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.employee_id=?`).all(eid);
  }
  const matches=rows.filter(u=>u.is_active && u.tenant_status==='active' && db.verifyPassword(pass,u.password_salt,u.password_hash));
  if(matches.length===0) return {error:'員編或密碼錯誤，或帳號已停用'};
  const eligible=matches.filter(u=> loginEntry==='company' ? hasCompanyAccess(u) : hasSiteAccess(u));
  if(eligible.length===0){
    return {error:loginEntry==='company'?'這個帳號沒有公司內勤工作權限，請從一般人員入口登入。':'這個帳號沒有啟用中的駐點案場，請從公司內勤入口登入。'};
  }
  if(eligible.length>1) return {ambiguous:true,error:'這個員編在多家公司都有符合此入口的帳號，請輸入公司代碼後再登入。'};
  return {user:eligible[0]};
}

function getAccessibleCommunity(req, id){
  const cid=Number(id);
  if(!cid) return null;
  const u=getUser(req);
  if(!u || u.tenant_id!==tenantId(req)) return null;
  if(u.role==='company_admin') return db.prepare('SELECT * FROM communities WHERE id=? AND tenant_id=? AND status=\'active\'').get(cid,tenantId(req));
  return db.prepare(`SELECT c.* FROM communities c JOIN staff_communities sc ON sc.community_id=c.id WHERE c.id=? AND c.tenant_id=? AND c.status='active' AND sc.staff_id=?`).get(cid,tenantId(req),u.id);
}
function getTenant(req){return db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId(req));}

// ===== 公開表單設定（所有公司共用中央表單版本；後續可再擴充公司覆寫） =====
app.get('/api/form-config',(req,res)=>res.json(readFormConfig()));
// V5.3：現場經理共用中央版交接清冊。
// 表單頁面／題目以總後臺的 /data/form-config.json 為準；每位已啟用且有駐點社區權限的人員都可讀取。
app.get('/api/staff/manager-checklist',requireStaffFiller,(req,res)=>{
  try{
    const config=readFormConfig();
    if(!Array.isArray(config.pages)||!config.pages.length||!Array.isArray(config.questions)||!config.questions.length){
      return res.status(500).json({error:'中央交接清冊設定不完整，請到總後臺檢查交接清冊頁面與題目設定。'});
    }
    const communities=db.prepare(`SELECT c.* FROM communities c JOIN staff_communities sc ON sc.community_id=c.id WHERE c.tenant_id=? AND c.status='active' AND sc.staff_id=? ORDER BY c.name`).all(tenantId(req),getUser(req).id);
    res.json({
      version:'central-manager',
      formConfig:{title:config.title||'社區交接清冊',subtitle:config.subtitle||'',pages:config.pages,questions:config.questions},
      communities
    });
  }catch(err){
    console.error('manager-checklist config error',err);
    res.status(500).json({error:'無法讀取中央交接清冊設定。',detail:err.message});
  }
});
// ===== 動態工作目錄 =====
app.get('/api/staff/menu-config',requireStaff,(req,res)=>{const u=getUser(req);res.json({scope:'staff',items:resolveMenu('staff',tenantId(req),u)});});
app.get('/api/company/menu-config',requireCompanyAdmin,(req,res)=>res.json({scope:'company',items:resolveMenu('company',tenantId(req),getUser(req))}));
app.get('/api/admin/menu-config',requireSuperAdmin,(req,res)=>{
  const c=readMenuConfig();
  const tid=req.query?.tenant_id?Number(req.query.tenant_id):null;
  if(tid){
    const tenant=db.prepare('SELECT id,name FROM tenants WHERE id=?').get(tid);
    if(!tenant)return res.status(404).json({error:'找不到公司'});
    res.json({global:{staff:c.staff,company:c.company},tenant_id:tid,tenant_name:tenant.name,overrides:c.tenants?.[String(tid)]||{}});
  }else res.json(c);
});
app.put('/api/admin/menu-config',requireSuperAdmin,(req,res)=>{
  try{
    const current=readMenuConfig();
    const scope=req.body?.scope;
    if(!['staff','company'].includes(scope)) return res.status(400).json({error:'目錄類型不正確'});
    const items=cleanMenuItems(req.body?.items); if(!items) return res.status(400).json({error:'目錄格式錯誤'});
    const tid=req.body?.tenant_id?Number(req.body.tenant_id):null;
    if(tid){
      if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)) return res.status(404).json({error:'找不到公司'});
      current.tenants=current.tenants||{}; current.tenants[String(tid)]=current.tenants[String(tid)]||{}; current.tenants[String(tid)][scope]=items;
    }else{ current[scope]=items; }
    writeMenuConfig(current); res.json({success:true,config:current});
  }catch(e){res.status(400).json({error:e.message||'目錄設定儲存失敗'});}
});
app.post('/api/admin/menu-config/reset',requireSuperAdmin,(req,res)=>{
  try{
    const scope=req.body?.scope,tid=req.body?.tenant_id?Number(req.body.tenant_id):null;
    if(!['staff','company'].includes(scope)||!tid)return res.status(400).json({error:'請指定公司與目錄類型'});
    const c=readMenuConfig();
    const tenant=db.prepare('SELECT id FROM tenants WHERE id=?').get(tid);
    if(!tenant)return res.status(404).json({error:'找不到公司'});
    c.tenants=c.tenants||{};
    c.tenants[String(tid)]=c.tenants[String(tid)]||{};
    // 恢復平台預設＝複製「此刻的平台預設」到該公司，之後仍與平台獨立。
    c.tenants[String(tid)][scope]=(c[scope]||[]).map(x=>({...x}));
    writeMenuConfig(c);
    res.json({success:true,items:c.tenants[String(tid)][scope]});
  }catch(e){res.status(400).json({error:e.message||'恢復平台預設失敗'});}
});


// ===== 個人工作台釘選 =====
function getStaffMenuItem(req, menuId){
  const id=String(menuId||'').trim();
  if(!id) return null;
  return resolveMenu('staff',tenantId(req)).find(x=>String(x.id)===id) || null;
}
function getStaffMenuChildren(menuId){
  const items=readMenuConfig().staff||[];
  return items.filter(x=>x.enabled!==false && x.parentId===menuId);
}
app.get('/api/staff/dashboard-pins',requireStaffFiller,(req,res)=>{
  const u=getUser(req);
  const rows=db.prepare('SELECT menu_id,sort_order,created_at,updated_at FROM dashboard_pins WHERE staff_id=? AND tenant_id=? ORDER BY sort_order ASC,id ASC').all(u.id,tenantId(req));
  const menu=resolveMenu('staff',tenantId(req));
  const valid=new Map(menu.map(x=>[String(x.id),x]));
  const pins=rows.filter(r=>valid.has(String(r.menu_id))).map(r=>({menu_id:r.menu_id,sort_order:r.sort_order,created_at:r.created_at,updated_at:r.updated_at,item:valid.get(String(r.menu_id))}));
  res.json({pins});
});
app.post('/api/staff/dashboard-pins',requireStaffFiller,(req,res)=>{
  const u=getUser(req);
  const menuId=String(req.body?.menu_id||'').trim();
  const item=getStaffMenuItem(req,menuId);
  if(!item) return res.status(404).json({error:'找不到這個工作項目，或目前已停用'});
  if(getStaffMenuChildren(menuId).length) return res.status(400).json({error:'請釘選實際工作項目，不需要釘選分類目錄'});
  const exists=db.prepare('SELECT id FROM dashboard_pins WHERE staff_id=? AND menu_id=?').get(u.id,menuId);
  if(exists) return res.json({success:true,pinned:true,menu_id:menuId});
  const max=db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS m FROM dashboard_pins WHERE staff_id=? AND tenant_id=?').get(u.id,tenantId(req)).m;
  const t=now(); db.prepare('INSERT INTO dashboard_pins (staff_id,tenant_id,menu_id,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(u.id,tenantId(req),menuId,Number(max)+1,t,t);
  res.json({success:true,pinned:true,menu_id:menuId});
});
app.delete('/api/staff/dashboard-pins/:menuId',requireStaffFiller,(req,res)=>{
  const u=getUser(req); db.prepare('DELETE FROM dashboard_pins WHERE staff_id=? AND tenant_id=? AND menu_id=?').run(u.id,tenantId(req),String(req.params.menuId));
  res.json({success:true,pinned:false,menu_id:String(req.params.menuId)});
});
app.put('/api/staff/dashboard-pins/order',requireStaffFiller,(req,res)=>{
  const u=getUser(req); const ids=Array.isArray(req.body?.menu_ids)?req.body.menu_ids.map(x=>String(x)).filter(Boolean):[];
  const valid=new Set(resolveMenu('staff',tenantId(req)).map(x=>String(x.id)));
  const clean=[...new Set(ids)].filter(id=>valid.has(id));
  const tx=db.transaction(()=>{const stmt=db.prepare('UPDATE dashboard_pins SET sort_order=?,updated_at=? WHERE staff_id=? AND tenant_id=? AND menu_id=?');const t=now();clean.forEach((id,i)=>stmt.run(i,t,u.id,tenantId(req),id));});
  tx(); res.json({success:true});
});


// ===== V5.1 現場人員代辦事項 =====
app.get('/api/staff/todos',requireStaffFiller,(req,res)=>{
  const u=getUser(req);
  const rows=db.prepare(`SELECT * FROM staff_todos WHERE staff_id=? AND tenant_id=? ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, created_at DESC`).all(u.id,tenantId(req));
  res.json({todos:rows});
});
app.post('/api/staff/todos',requireStaffFiller,(req,res)=>{
  const u=getUser(req);
  const content=String(req.body?.content||'').trim();
  if(!content) return res.status(400).json({error:'請輸入代辦事項內容'});
  if(content.length>300) return res.status(400).json({error:'代辦事項最多 300 字'});
  const t=now();
  const info=db.prepare(`INSERT INTO staff_todos (staff_id,tenant_id,content,status,created_at,created_by_id,created_by_name) VALUES (?,?,?,?,?,?,?)`).run(u.id,tenantId(req),content,'open',t,u.id,u.name||'');
  res.json({success:true,todo:db.prepare('SELECT * FROM staff_todos WHERE id=?').get(info.lastInsertRowid)});
});
app.put('/api/staff/todos/:id/complete',requireStaffFiller,(req,res)=>{
  const u=getUser(req); const id=Number(req.params.id);
  const row=db.prepare('SELECT * FROM staff_todos WHERE id=? AND staff_id=? AND tenant_id=?').get(id,u.id,tenantId(req));
  if(!row) return res.status(404).json({error:'找不到這筆代辦事項'});
  if(row.status==='done') return res.json({success:true,todo:row});
  const t=now();
  db.prepare(`UPDATE staff_todos SET status='done',completed_at=?,completed_by_id=?,completed_by_name=? WHERE id=? AND staff_id=? AND tenant_id=?`).run(t,u.id,u.name||'',id,u.id,tenantId(req));
  res.json({success:true,todo:db.prepare('SELECT * FROM staff_todos WHERE id=?').get(id)});
});
app.get('/api/staff/todos/archived',requireStaffFiller,(req,res)=>{
  const u=getUser(req);
  const keyword=String(req.query?.keyword||'').trim();
  const date=String(req.query?.date||'').trim();
  let sql=`SELECT * FROM staff_todos WHERE staff_id=? AND tenant_id=? AND status='done'`;
  const params=[u.id,tenantId(req)];
  if(keyword){sql+=` AND (content LIKE ? OR created_by_name LIKE ? OR completed_by_name LIKE ?)`;const k=`%${keyword}%`;params.push(k,k,k);}
  if(/^\d{4}-\d{2}-\d{2}$/.test(date)){sql+=` AND (substr(created_at,1,10)=? OR substr(completed_at,1,10)=?)`;params.push(date,date);}
  sql+=` ORDER BY completed_at DESC, id DESC`;
  const rows=db.prepare(sql).all(...params);
  res.json({todos:rows});
});


// ===== 員編登入 / 登出 =====
app.post('/api/staff/login',(req,res)=>{
  const {employeeId,password,tenantCode,entry}=req.body||{};
  const loginEntry=entry==='company'?'company':'staff';
  const auth=authenticateStaff(employeeId,password,tenantCode,loginEntry);
  if(auth.error) return res.status(auth.ambiguous?409:401).json({error:auth.error,needsTenantCode:!!auth.ambiguous});
  const user=auth.user;
  if(entry==='staff' && user.role!=='company_admin' && !hasSiteAccess(user)) return res.status(403).json({error:'此帳號目前沒有駐點案場，請從公司內部後台登入。'});
  if(entry==='company' && user.role!=='company_admin' && !hasCompanyAccess(user)) return res.status(403).json({error:'此帳號目前沒有公司內勤權限。'});
  req.session.userId=user.id; req.session.entry=entry||'staff'; req.session.employeeId=user.employee_id; req.session.employeeName=user.name; req.session.tenantId=user.tenant_id; req.session.role=user.role||'staff';
  db.prepare('UPDATE staff_users SET last_login_at=? WHERE id=?').run(now(),user.id);
  res.json({success:true,user:{id:user.id,employee_id:user.employee_id,name:user.name,role:user.role||'staff',admin_level:user.admin_level||'admin',tenant_id:user.tenant_id,tenant_name:user.tenant_name,tenant_code:user.tenant_code,position:user.position||'',work_type:user.work_type||'site',job_category:user.job_category||'',job_level:user.job_level||'',permissions:parsePermissions(user),job_categories:getJobCategories(user),site_assignments:getSiteAssignments(user),company_assignment:getCompanyAssignment(user)}});
});
app.post('/api/staff/logout',(req,res)=>{req.session.destroy(()=>res.json({success:true}));});
app.get('/api/staff/session',(req,res)=>{
  const u=getUser(req); if(!u || !u.is_active || !u.tenant_id) return res.json({loggedIn:false});
  const t=db.prepare('SELECT * FROM tenants WHERE id=?').get(u.tenant_id); if(!t || t.status!=='active') return res.json({loggedIn:false});
  res.json({loggedIn:true,entry:req.session.entry||'staff',user:{id:u.id,employee_id:u.employee_id,name:u.name,position:u.position||'',job_category:u.job_category||'',job_level:u.job_level||'',work_type:u.work_type||'site',permissions:effectivePermissions(u),job_categories:getJobCategories(u),site_assignments:getSiteAssignments(u),company_assignment:getCompanyAssignment(u),trial_end_date:u.trial_end_date||'',formal_salary:u.formal_salary||'',insurance_level:u.insurance_level||'',health_dependents:Number(u.health_dependents||0),role:u.role||'staff',tenant_id:u.tenant_id,tenant_name:t.name}});
});

app.post('/api/staff/select-community',requireStaffFiller,(req,res)=>{const cid=Number(req.body?.community_id);const u=getUser(req);if(!cid||!getAccessibleCommunity(req,cid))return res.status(403).json({error:'您沒有這個案場的工作權限'});req.session.activeCommunityId=cid;const c=db.prepare('SELECT id,name FROM communities WHERE id=?').get(cid);res.json({success:true,community:c});});
// ===== 公司/社區資訊給前台 =====
app.get('/api/staff/tenant',requireStaff,(req,res)=>res.json({tenant:getTenant(req)}));
// ===== 內部訊息中心：公司內勤 ↔ 社區駐點人員；總後臺不提供此功能 =====
app.get('/api/messages/unread-count',requireMessageUser,(req,res)=>{
  const u=getUser(req);
  const row=db.prepare('SELECT COUNT(*) AS count FROM messages WHERE tenant_id=? AND recipient_id=? AND read_at IS NULL').get(tenantId(req),u.id);
  res.json({count:Number(row?.count||0)});
});

app.get('/api/messages/recipients',requireMessageUser,(req,res)=>{
  const u=getUser(req);
  const q=String(req.query?.q||'').trim();
  const rows=db.prepare(`SELECT u.id,u.employee_id,u.name,u.role,u.work_type,u.position,u.job_category,u.job_level,
      COALESCE((SELECT GROUP_CONCAT(c.name,'、') FROM staff_communities sc JOIN communities c ON c.id=sc.community_id WHERE sc.staff_id=u.id AND c.tenant_id=u.tenant_id AND c.status='active'),'') AS legacy_communities,
      COALESCE((SELECT GROUP_CONCAT(c.name,'、') FROM staff_work_assignments a JOIN communities c ON c.id=a.community_id WHERE a.staff_id=u.id AND a.tenant_id=u.tenant_id AND a.scope_type='site' AND c.status='active'),'') AS assigned_communities
    FROM staff_users u
    WHERE u.tenant_id=? AND u.id<>? AND u.is_active=1 AND COALESCE(u.person_status,'active')='active' AND u.role<>'super_admin'
    ORDER BY CASE WHEN u.role='company_admin' THEN 0 ELSE 1 END, u.employee_id`).all(tenantId(req),u.id);
  const norm=v=>String(v||'').toLowerCase();
  const list=rows.map(r=>{
    const communities=[...new Set(String(`${r.legacy_communities||''}、${r.assigned_communities||''}`).split('、').map(x=>x.trim()).filter(Boolean))];
    return {id:r.id,employee_id:r.employee_id,name:r.name,role:r.role,work_type:r.work_type||'site',position:r.position||'',job_category:r.job_category||'',job_level:r.job_level||'',communities,scope_label:r.role==='company_admin'?'公司管理員':(r.work_type==='hybrid'?'內勤＋駐點':r.work_type==='internal'?'公司內勤':'社區駐點')};
  }).filter(r=>{
    if(!q)return true; const hay=[r.name,r.employee_id,r.position,r.job_category,r.job_level,r.scope_label,...r.communities].map(norm).join(' '); return hay.includes(norm(q));
  });
  res.json(list);
});

app.get('/api/messages',requireMessageUser,(req,res)=>{
  const u=getUser(req);
  const limit=Math.min(100,Math.max(10,Number(req.query?.limit)||50));
  const rows=db.prepare(`SELECT m.id,m.subject,m.body,m.created_at,m.read_at,m.sender_id,m.recipient_id,
      COALESCE(m.sender_employee_id,s.employee_id,'') AS sender_employee_id,COALESCE(m.sender_name,s.name,'已離職／帳號已封存') AS sender_name,s.role AS sender_role,s.work_type AS sender_work_type,
      COALESCE(m.recipient_employee_id,r.employee_id,'') AS recipient_employee_id,COALESCE(m.recipient_name,r.name,'已離職／帳號已封存') AS recipient_name,r.role AS recipient_role,r.work_type AS recipient_work_type
    FROM messages m
    LEFT JOIN staff_users s ON s.id=m.sender_id
    LEFT JOIN staff_users r ON r.id=m.recipient_id
    WHERE m.tenant_id=? AND (m.sender_id=? OR m.recipient_id=?)
    ORDER BY m.created_at DESC LIMIT ?`).all(tenantId(req),u.id,u.id,limit);
  res.json(rows.map(r=>({
    ...r,
    direction:r.recipient_id===u.id?'in':'out',
    unread:r.recipient_id===u.id&&!r.read_at,
    sender:{id:r.sender_id,employee_id:r.sender_employee_id,name:r.sender_name,role:r.sender_role,work_type:r.sender_work_type||'site'},
    recipient:{id:r.recipient_id,employee_id:r.recipient_employee_id,name:r.recipient_name,role:r.recipient_role,work_type:r.recipient_work_type||'site'}
  })));
});

app.post('/api/messages',requireMessageUser,(req,res)=>{
  const u=getUser(req);
  const recipientId=Number(req.body?.recipient_id);
  const subject=String(req.body?.subject||'').trim().slice(0,120);
  const body=String(req.body?.body||'').trim();
  if(!recipientId)return res.status(400).json({error:'請選擇收件人'});
  if(recipientId===u.id)return res.status(400).json({error:'不能傳送訊息給自己'});
  if(!body)return res.status(400).json({error:'訊息內容不可空白'});
  if(body.length>5000)return res.status(400).json({error:'訊息內容最多 5000 字'});
  const recipient=db.prepare(`SELECT id,employee_id,name FROM staff_users WHERE id=? AND tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' AND role<>'super_admin'`).get(recipientId,tenantId(req));
  if(!recipient)return res.status(404).json({error:'找不到可用的公司內部收件人'});
  const t=now();
  const info=db.prepare('INSERT INTO messages (tenant_id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,subject,body,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)').run(tenantId(req),u.id,recipientId,u.employee_id,u.name,recipient.employee_id,recipient.name,subject||'內部訊息',body,t);
  res.json({success:true,id:info.lastInsertRowid,created_at:t});
});

app.put('/api/messages/:id/read',requireMessageUser,(req,res)=>{
  const u=getUser(req);
  const id=Number(req.params.id);
  if(!id)return res.status(400).json({error:'訊息編號不正確'});
  const t=now();
  const result=db.prepare('UPDATE messages SET read_at=? WHERE id=? AND tenant_id=? AND recipient_id=? AND read_at IS NULL').run(t,id,tenantId(req),u.id);
  res.json({success:true,updated:result.changes>0,read_at:t});
});

app.put('/api/messages/read-all',requireMessageUser,(req,res)=>{
  const u=getUser(req);
  const t=now();
  const result=db.prepare('UPDATE messages SET read_at=? WHERE tenant_id=? AND recipient_id=? AND read_at IS NULL').run(t,tenantId(req),u.id);
  res.json({success:true,updated_count:result.changes});
});

app.get('/api/messages/conversation/:partnerId',requireMessageUser,(req,res)=>{
  const u=getUser(req), partnerId=Number(req.params.partnerId), limit=Math.min(300,Math.max(20,Number(req.query?.limit)||200));
  if(!partnerId || partnerId===u.id)return res.status(400).json({error:'對話對象不正確'});
  const partner=db.prepare("SELECT id,employee_id,name,role,work_type,position,job_category,job_level FROM staff_users WHERE id=? AND tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' AND role<>'super_admin'").get(partnerId,tenantId(req));
  if(!partner)return res.status(404).json({error:'找不到可用的對話對象'});
  const rows=db.prepare(`SELECT m.id,m.subject,m.body,m.created_at,m.read_at,m.sender_id,m.recipient_id,COALESCE(m.sender_employee_id,s.employee_id,'') AS sender_employee_id,COALESCE(m.sender_name,s.name,'已離職／帳號已封存') AS sender_name,COALESCE(m.recipient_employee_id,r.employee_id,'') AS recipient_employee_id,COALESCE(m.recipient_name,r.name,'已離職／帳號已封存') AS recipient_name FROM messages m LEFT JOIN staff_users s ON s.id=m.sender_id LEFT JOIN staff_users r ON r.id=m.recipient_id WHERE m.tenant_id=? AND ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?)) ORDER BY m.created_at DESC LIMIT ?`).all(tenantId(req),u.id,partnerId,partnerId,u.id,limit).reverse();
  const scope=partner.role==='company_admin'?'公司管理員':(partner.work_type==='hybrid'?'內勤＋駐點':partner.work_type==='internal'?'公司內勤':'社區駐點');
  res.json({partner:{...partner,scope_label:scope},messages:rows.map(r=>({...r,direction:r.sender_id===u.id?'out':'in',unread:r.recipient_id===u.id&&!r.read_at}))});
});
app.put('/api/messages/conversation/:partnerId/read',requireMessageUser,(req,res)=>{const u=getUser(req),partnerId=Number(req.params.partnerId);if(!partnerId)return res.status(400).json({error:'對話對象不正確'});const t=now();const result=db.prepare('UPDATE messages SET read_at=? WHERE tenant_id=? AND sender_id=? AND recipient_id=? AND read_at IS NULL').run(t,tenantId(req),partnerId,u.id);res.json({success:true,updated_count:result.changes,read_at:t});});
app.get('/api/messages/typing',requireMessageUser,(req,res)=>{const u=getUser(req),partnerId=Number(req.query?.partner_id);if(!partnerId)return res.status(400).json({error:'對話對象不正確'});const current=now();db.prepare('DELETE FROM message_typing WHERE tenant_id=? AND expires_at<=?').run(tenantId(req),current);const row=db.prepare('SELECT 1 AS typing FROM message_typing WHERE tenant_id=? AND sender_id=? AND recipient_id=? AND expires_at>?').get(tenantId(req),partnerId,u.id,current);res.json({typing:!!row});});
app.post('/api/messages/typing',requireMessageUser,(req,res)=>{const u=getUser(req),partnerId=Number(req.body?.partner_id),typing=!!req.body?.typing;if(!partnerId||partnerId===u.id)return res.status(400).json({error:'對話對象不正確'});const recipient=db.prepare("SELECT id FROM staff_users WHERE id=? AND tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' AND role<>'super_admin'").get(partnerId,tenantId(req));if(!recipient)return res.status(404).json({error:'找不到可用的對話對象'});if(typing){const t=now(),exp=new Date(Date.now()+4000).toISOString();db.prepare(`INSERT INTO message_typing(tenant_id,sender_id,recipient_id,updated_at,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,sender_id,recipient_id) DO UPDATE SET updated_at=excluded.updated_at,expires_at=excluded.expires_at`).run(tenantId(req),u.id,partnerId,t,exp);}else db.prepare('DELETE FROM message_typing WHERE tenant_id=? AND sender_id=? AND recipient_id=?').run(tenantId(req),u.id,partnerId);res.json({success:true});});
// ===== 企業訊息稽核：預設關閉；由總後臺啟用並指定稽核人員。總後臺本身不直接查看內容。 =====
app.get('/api/admin/message-audit-settings',requireSuperAdmin,(req,res)=>{
  const tid=Number(req.query?.tenant_id); if(!tid)return res.status(400).json({error:'請指定公司'});
  const tenant=db.prepare('SELECT id,name FROM tenants WHERE id=?').get(tid); if(!tenant)return res.status(404).json({error:'找不到公司'});
  const cfg=getMessageAuditSettings(tid);
  const staff=db.prepare(`SELECT id,employee_id,name,role,position,job_category,admin_level FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY CASE WHEN role='company_admin' THEN 0 ELSE 1 END, employee_id`).all(tid);
  res.json({tenant,cfg,staff});
});
app.put('/api/admin/message-audit-settings',requireSuperAdmin,(req,res)=>{
  const tid=Number(req.body?.tenant_id); if(!tid)return res.status(400).json({error:'請指定公司'});
  if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid))return res.status(404).json({error:'找不到公司'});
  const enabled=!!req.body?.enabled; const ids=Array.isArray(req.body?.auditor_ids)?[...new Set(req.body.auditor_ids.map(Number).filter(Boolean))]:[];
  const valid=new Set(db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active'").all(tid).map(x=>Number(x.id)));
  const clean=ids.filter(id=>valid.has(id)); const t=now();
  db.prepare(`INSERT INTO message_audit_settings (tenant_id,enabled,auditor_ids_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,auditor_ids_json=excluded.auditor_ids_json,updated_at=excluded.updated_at`).run(tid,enabled?1:0,JSON.stringify(clean),t);
  res.json({success:true,cfg:getMessageAuditSettings(tid)});
});
app.get('/api/company/message-audit/access',requireCompanyAdmin,(req,res)=>{
  const u=getUser(req),cfg=getMessageAuditSettings(tenantId(req));
  res.json({enabled:cfg.enabled,authorized:canAuditMessages(req),user_id:u?.id||null});
});
app.get('/api/company/message-audit/search',requireCompanyAdmin,requireMessageAuditor,(req,res)=>{
  const q=String(req.query?.q||'').trim(); const from=String(req.query?.from||'').trim(); const to=String(req.query?.to||'').trim();
  let sql=`SELECT m.id,m.sender_id,m.recipient_id,m.sender_employee_id,m.sender_name,m.recipient_employee_id,m.recipient_name,m.body,m.created_at,m.read_at FROM messages m WHERE m.tenant_id=?`; const params=[tenantId(req)];
  if(q){sql+=` AND (m.body LIKE ? OR m.sender_name LIKE ? OR m.recipient_name LIKE ? OR m.sender_employee_id LIKE ? OR m.recipient_employee_id LIKE ?)`;const k=`%${q}%`;params.push(k,k,k,k,k);}
  if(/^\d{4}-\d{2}-\d{2}$/.test(from)){sql+=` AND substr(m.created_at,1,10)>=?`;params.push(from);}
  if(/^\d{4}-\d{2}-\d{2}$/.test(to)){sql+=` AND substr(m.created_at,1,10)<=?`;params.push(to);}
  sql+=' ORDER BY m.created_at DESC LIMIT 500';
  const rows=db.prepare(sql).all(...params);
  db.prepare(`INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(tenantId(req),getUser(req).employee_id,getUser(req).name,'view-message-audit','message_audit','search','',JSON.stringify({q,from,to,count:rows.length}),now());
  res.json({rows});
});
app.get('/api/company/message-audit/conversation/:partnerId',requireCompanyAdmin,requireMessageAuditor,(req,res)=>{
  const u=getUser(req),partnerId=Number(req.params.partnerId); if(!partnerId)return res.status(400).json({error:'對話對象不正確'});
  const partner=db.prepare("SELECT id,employee_id,name,role,work_type,position,job_category,job_level FROM staff_users WHERE id=? AND tenant_id=?").get(partnerId,tenantId(req)); if(!partner)return res.status(404).json({error:'找不到人員'});
  const rows=db.prepare(`SELECT id,sender_id,recipient_id,sender_employee_id,sender_name,recipient_employee_id,recipient_name,body,created_at,read_at FROM messages WHERE tenant_id=? AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY created_at ASC LIMIT 500`).all(tenantId(req),u.id,partnerId,partnerId,u.id);
  db.prepare(`INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(tenantId(req),u.employee_id,u.name,'view-message-conversation','message_audit','conversation',String(partnerId),JSON.stringify({partner_employee_id:partner.employee_id,partner_name:partner.name,count:rows.length}),now());
  res.json({partner,messages:rows});
});

app.get('/api/staff/profile',requireStaff,(req,res)=>{
  const u=getUser(req);
  if(!u)return res.status(401).json({error:'尚未登入'});
  const t=db.prepare('SELECT id,name FROM tenants WHERE id=?').get(u.tenant_id);
  const communities=u.role==='company_admin'
    ? db.prepare("SELECT id,name,status FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tenantId(req))
    : db.prepare("SELECT c.id,c.name,c.status FROM communities c JOIN staff_communities sc ON sc.community_id=c.id WHERE c.tenant_id=? AND c.status='active' AND sc.staff_id=? ORDER BY c.name").all(tenantId(req),u.id);
  res.json({
    employee_id:u.employee_id,
    name:u.name,
    position:u.position||'',
    job_category:u.job_category||'',
    job_level:u.job_level||'',
    work_type:u.work_type||'site',
    permissions:effectivePermissions(u),
    job_categories:getJobCategories(u),
    site_assignments:getSiteAssignments(u),
    company_assignment:getCompanyAssignment(u),
    tenant_name:t?.name||'',
    communities,
    salary:{
      trial_end_date:u.trial_end_date||'',
      formal_salary:u.formal_salary||'',
      insurance_level:u.insurance_level||'',
      health_dependents:Number(u.health_dependents||0)
    },
    payslip:{available:false,message:'本月薪資單尚未建立'}
  });
});

app.get('/api/staff/communities',requireStaff,(req,res)=>{
  const u=getUser(req); let rows;
  if(u.role==='company_admin') rows=db.prepare("SELECT * FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tenantId(req));
  else rows=db.prepare("SELECT c.* FROM communities c JOIN staff_communities sc ON sc.community_id=c.id WHERE c.tenant_id=? AND c.status='active' AND sc.staff_id=? ORDER BY c.name").all(tenantId(req),u.id);
  res.json(rows);
});

// ===== 員工草稿 =====
app.get('/api/staff/drafts',requireStaffFiller,(req,res)=>{
  const rows=db.prepare('SELECT id,created_at,updated_at,current_page,data,community_id FROM drafts WHERE employee_id=? AND tenant_id=? ORDER BY updated_at DESC').all(req.session.employeeId,tenantId(req));
  res.json(rows.map(r=>({id:r.id,created_at:r.created_at,updated_at:r.updated_at,current_page:r.current_page,community_id:r.community_id,data:JSON.parse(r.data)})));
});
app.post('/api/staff/drafts',requireStaffFiller,(req,res)=>{
  const data=cleanData(req.body?.data); const page=Math.max(0,Number(req.body?.current_page)||0); const communityId=req.body?.community_id?Number(req.body.community_id):null;
  if(communityId && !getAccessibleCommunity(req,communityId)) return res.status(403).json({error:'您沒有這個社區的填寫權限'});
  const t=now(); const info=db.prepare('INSERT INTO drafts (employee_id,tenant_id,community_id,created_at,updated_at,current_page,data) VALUES (?,?,?,?,?,?,?)').run(req.session.employeeId,tenantId(req),communityId,t,t,page,JSON.stringify(data));
  res.json({success:true,id:info.lastInsertRowid,updated_at:t});
});
app.put('/api/staff/drafts/:id',requireStaffFiller,(req,res)=>{
  const id=Number(req.params.id); const draft=db.prepare('SELECT * FROM drafts WHERE id=? AND employee_id=? AND tenant_id=?').get(id,req.session.employeeId,tenantId(req));
  if(!draft) return res.status(404).json({error:'找不到這份草稿'});
  const data=cleanData(req.body?.data); const page=Math.max(0,Number(req.body?.current_page)||0); const communityId=req.body?.community_id===undefined?draft.community_id:(req.body.community_id?Number(req.body.community_id):null);
  if(communityId && !getAccessibleCommunity(req,communityId)) return res.status(403).json({error:'您沒有這個社區的填寫權限'});
  const t=now(); db.prepare('UPDATE drafts SET updated_at=?,current_page=?,data=?,community_id=? WHERE id=? AND employee_id=? AND tenant_id=?').run(t,page,JSON.stringify(data),communityId,id,req.session.employeeId,tenantId(req));
  res.json({success:true,updated_at:t});
});
app.get('/api/staff/drafts/:id',requireStaffFiller,(req,res)=>{
  const r=db.prepare('SELECT * FROM drafts WHERE id=? AND employee_id=? AND tenant_id=?').get(Number(req.params.id),req.session.employeeId,tenantId(req));
  if(!r) return res.status(404).json({error:'找不到這份草稿'});
  res.json({id:r.id,created_at:r.created_at,updated_at:r.updated_at,current_page:r.current_page,community_id:r.community_id,data:JSON.parse(r.data)});
});
app.delete('/api/staff/drafts/:id',requireStaffFiller,(req,res)=>{db.prepare('DELETE FROM drafts WHERE id=? AND employee_id=? AND tenant_id=?').run(Number(req.params.id),req.session.employeeId,tenantId(req));res.json({success:true});});
app.post('/api/staff/drafts/:id/submit',requireStaffFiller,(req,res)=>{
  const draft=db.prepare('SELECT * FROM drafts WHERE id=? AND employee_id=? AND tenant_id=?').get(Number(req.params.id),req.session.employeeId,tenantId(req));
  if(!draft) return res.status(404).json({error:'找不到這份草稿'});
  const answers=JSON.parse(draft.data); const questions=readQuestions(); const missing=questions.filter(q=>q.required&&!String(answers[q.id]??'').trim());
  if(missing.length) return res.status(400).json({error:'有必填欄位未填寫',missing:missing.map(q=>q.label)});
  const t=now(); const info=db.prepare('INSERT INTO submissions (created_at,updated_at,employee_id,employee_name,tenant_id,community_id,data) VALUES (?,?,?,?,?,?,?)').run(t,t,req.session.employeeId,req.session.employeeName,tenantId(req),draft.community_id,JSON.stringify(answers));
  db.prepare('DELETE FROM drafts WHERE id=? AND employee_id=? AND tenant_id=?').run(draft.id,req.session.employeeId,tenantId(req));
  res.json({success:true,id:info.lastInsertRowid});
});
app.post('/api/submissions',requireStaffFiller,(req,res)=>{
  const answers=cleanData(req.body); const missing=readQuestions().filter(q=>q.required&&!String(answers[q.id]??'').trim());
  if(missing.length)return res.status(400).json({error:'有必填欄位未填寫',missing:missing.map(q=>q.label)});
  const t=now(); const info=db.prepare('INSERT INTO submissions (created_at,updated_at,employee_id,employee_name,tenant_id,data) VALUES (?,?,?,?,?,?)').run(t,t,req.session.employeeId,req.session.employeeName,tenantId(req),JSON.stringify(answers));
  res.json({success:true,id:info.lastInsertRowid});
});

// ===== 總後臺 =====
app.post('/api/admin/login',(req,res)=>{const {username,password}=req.body||{};if(username===ADMIN_USER&&password===ADMIN_PASS){req.session.isAdmin=true;req.session.employeeId=null;req.session.tenantId=null;req.session.role='super_admin';return res.json({success:true});}res.status(401).json({error:'帳號或密碼錯誤'});});
app.post('/api/admin/logout',(req,res)=>{req.session.destroy(()=>res.json({success:true}));});
app.get('/api/admin/session',(req,res)=>res.json({isAdmin:!!req.session?.isAdmin}));


// ===== 總後臺智慧 AI 助手 =====
// 第一階段為「平台架構顧問」：只提供系統設計、模組規劃與問題分析，
// 不直接讀取或修改 C2C 客戶營運資料，也不直接執行資料異動。
const ADMIN_AI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const ADMIN_AI_ENDPOINT = 'https://api.openai.com/v1/responses';
const ADMIN_AI_MAX_HISTORY = 12;
const ADMIN_AI_SYSTEM_PROMPT = `你是「物業管理平台｜系統總後臺」的智慧平台工程師。
你服務的對象是平台 System Owner / Super Admin。

你的工作：
1. 協助平台擁有者規劃、設計與改善物業管理 SaaS 的模組、母目錄、子目錄、權限與使用流程。
2. 用繁體中文、自然、白話、實務導向回答；不要把事情講得過度複雜。
3. 永遠區分三層：平台層（System Owner）、公司租戶層（C2C 客戶）、公司內部人員／案場層。
4. 平台層可以管理「模組、功能、母目錄、版本、開通能力」；客戶公司自行決定公司內部權限與實際業務資料。
5. 不應主動要求、猜測或揭露任何 C2C 客戶的住戶、財務、社區、員工、SOP 內容或其他營運機密。
6. 如果使用者要求修改系統，先提出清楚的變更方案、會影響哪些檔案／資料結構、風險與測試方式。除非後續工具明確授權，不要聲稱自己已經真的修改、部署或上線。
7. 不要自行建立、刪除或改寫平台母目錄；除非使用者明確要求，而且要先確認變更範圍。
8. 這個第一階段助手沒有寫入系統的工具，因此只能提供分析、規劃、檢查與建議，不得假裝有執行權限。
9. 使用者說「幫我做」時，可以產生具體的實作規格與待修改檔案清單，並提醒需要確認後才能進入下一階段。
`;

app.get('/api/admin/ai/status',requireSuperAdmin,async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const key=String(process.env.OPENAI_API_KEY||'').trim();
  if(!key){
    return res.json({success:true,enabled:false,model:ADMIN_AI_MODEL,mode:'platform-consultant',status:'missing_key'});
  }
  try{
    // 不只檢查模型是否存在，直接做一次極小的 Responses API 測試，才能確認「真的能聊天」。
    const r=await fetch(ADMIN_AI_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:ADMIN_AI_MODEL,input:'請只回答 OK',max_output_tokens:8,store:false})
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      console.error('Admin AI status response test error:',r.status,data);
      return res.json({success:true,enabled:true,model:ADMIN_AI_MODEL,mode:'platform-consultant',status:'api_error',httpStatus:r.status,detail:data?.error?.message||`OpenAI HTTP ${r.status}`,requestId:r.headers.get('x-request-id')||null});
    }
    const text=data.output_text || '';
    return res.json({success:true,enabled:true,model:ADMIN_AI_MODEL,mode:'platform-consultant',status:'ready',testReply:text||'OK'});
  }catch(err){
    console.error('Admin AI status response test failed:',err);
    return res.json({success:true,enabled:true,model:ADMIN_AI_MODEL,mode:'platform-consultant',status:'network_error',detail:err?.message||'network error'});
  }
});

app.post('/api/admin/ai/chat',requireSuperAdmin,async(req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY){
      return res.status(503).json({
        error:'尚未設定 OPENAI_API_KEY',
        code:'OPENAI_API_KEY_MISSING',
        setup:'請在 Zeabur 的 Environment Variables 設定 OPENAI_API_KEY，儲存後重新部署。不要把金鑰寫進前端檔案。'
      });
    }
    const body=req.body||{};
    const message=String(body.message||'').trim();
    if(!message) return res.status(400).json({error:'請輸入訊息'});
    if(message.length>4000) return res.status(400).json({error:'單次訊息最多 4000 字'});
    const history=Array.isArray(body.history)?body.history.slice(-ADMIN_AI_MAX_HISTORY).map(x=>({
      role:x?.role==='assistant'?'assistant':'user',
      content:String(x?.content||'').slice(0,6000)
    })).filter(x=>x.content):[];

    const platformContext = {
      role: 'System Owner / Super Admin',
      currentAdminSections: ['公司管理','全部交接','全系統人員','平台制式範本','中央表單設計','公司系統美編','企業客製化','訊息稽核'],
      architectureRules: [
        '總後台是平台母系統與模組建置基準點',
        'C2C 客戶公司自行決定開通哪些已提供的模組與公司內部權限',
        '平台擁有者不應介入或查看客戶的營運機密',
        '系統測試公司可作為產品體驗與流程測試環境'
      ]
    };

    // 先把歷史對話整理成純文字，避免不同 Responses API 版本對 message content 結構的相容性差異。
    const historyText=history.map(x=>`${x.role==='assistant'?'AI':'使用者'}：${x.content}`).join('\n');
    const input=`平台背景（僅供架構討論，不含客戶營運資料）：${JSON.stringify(platformContext, null, 2)}\n\n${historyText?`先前對話：\n${historyText}\n\n`:''}使用者目前的問題：${message}`;

    const r=await fetch(ADMIN_AI_ENDPOINT,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body:JSON.stringify({
        model:ADMIN_AI_MODEL,
        instructions:ADMIN_AI_SYSTEM_PROMPT,
        input,
        max_output_tokens:1200,
        store:false
      })
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      console.error('Admin AI API error:',r.status,data);
      const requestId=r.headers.get('x-request-id')||null;
      return res.status(502).json({error:'AI 服務目前無法回應。',code:'OPENAI_API_ERROR',httpStatus:r.status,detail:data?.error?.message||`OpenAI HTTP ${r.status}`,requestId});
    }
    const text=data.output_text || (Array.isArray(data.output)?data.output.flatMap(o=>Array.isArray(o.content)?o.content.filter(c=>c.type==='output_text').map(c=>c.text):[]).join('\n'):'');
    if(!text) return res.status(502).json({error:'AI 沒有回傳文字結果，請稍後再試。'});
    res.json({reply:text,model:data.model||ADMIN_AI_MODEL});
  }catch(err){
    console.error('Admin AI request failed:',err);
    res.status(500).json({error:'智慧助手後端發生錯誤。',code:'ADMIN_AI_SERVER_ERROR',detail:err?.message||'unknown error'});
  }
});

// ===== 公司系統白標／美編 =====
app.get('/api/admin/tenants/:id/branding',requireSuperAdmin,(req,res)=>{const row=db.prepare('SELECT * FROM tenants WHERE id=?').get(Number(req.params.id));if(!row)return res.status(404).json({error:'找不到公司'});res.json(sanitizeBranding(row));});
app.put('/api/admin/tenants/:id/branding',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const row=db.prepare('SELECT * FROM tenants WHERE id=?').get(id);if(!row)return res.status(404).json({error:'找不到公司'});const b=req.body||{};const v={title:String(b.title||'').trim(),subtitle:String(b.subtitle||'').trim(),loginTitle:String(b.loginTitle||'').trim(),loginHint:String(b.loginHint||'').trim(),intro:String(b.intro||'').trim(),logoText:String(b.logoText||'').trim(),accent:validHex(b.accent,'#2F6F5E'),accentDark:validHex(b.accentDark,'#204F42'),bg:validHex(b.bg,'#F7F7F4'),panel:validHex(b.panel,'#FFFFFF')};if(!v.title)return res.status(400).json({error:'系統名稱不可空白'});db.prepare('UPDATE tenants SET brand_title=?,brand_subtitle=?,brand_login_title=?,brand_login_hint=?,brand_intro=?,brand_logo_text=?,brand_accent=?,brand_accent_dark=?,brand_bg=?,brand_panel=?,updated_at=? WHERE id=?').run(v.title,v.subtitle,v.loginTitle,v.loginHint,v.intro,v.logoText,v.accent,v.accentDark,v.bg,v.panel,now(),id);res.json({success:true,branding:{tenant_id:id,...v}});});

app.get('/api/admin/tenants',requireSuperAdmin,(req,res)=>{
  const rows=db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM staff_users u WHERE u.tenant_id=t.id AND u.role='staff') staff_count, (SELECT COUNT(*) FROM staff_users u WHERE u.tenant_id=t.id AND u.role='company_admin') admin_count, (SELECT COUNT(*) FROM communities c WHERE c.tenant_id=t.id) community_count, (SELECT u.employee_id FROM staff_users u WHERE u.tenant_id=t.id AND u.role='company_admin' AND u.admin_level='owner' ORDER BY u.id LIMIT 1) admin_employee_id, (SELECT u.name FROM staff_users u WHERE u.tenant_id=t.id AND u.role='company_admin' AND u.admin_level='owner' ORDER BY u.id LIMIT 1) admin_name, (SELECT u.last_login_at FROM staff_users u WHERE u.tenant_id=t.id AND u.role='company_admin' AND u.admin_level='owner' ORDER BY u.id LIMIT 1) admin_last_login_at, (SELECT u.is_active FROM staff_users u WHERE u.tenant_id=t.id AND u.role='company_admin' AND u.admin_level='owner' ORDER BY u.id LIMIT 1) admin_is_active FROM tenants t ORDER BY CASE WHEN t.status='active' THEN 0 ELSE 1 END,t.id DESC`).all();
  res.json(rows);
});
app.post('/api/admin/tenants',requireSuperAdmin,(req,res)=>{
  const name=String(req.body?.name||'').trim(); const code=String(req.body?.code||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');
  const adminEmployeeId=String(req.body?.admin_employee_id||'').trim(); const adminName=String(req.body?.admin_name||'').trim(); const adminPassword=String(req.body?.admin_password||'');
  if(!name||!adminEmployeeId||!adminName||adminPassword.length<4)return res.status(400).json({error:'請完整填寫公司名稱、公司管理員員編、姓名與至少 4 碼密碼'});
  if(code && db.prepare('SELECT id FROM tenants WHERE code=?').get(code))return res.status(400).json({error:'公司代碼已存在'});
  if(db.prepare('SELECT id FROM tenants WHERE name=?').get(name))return res.status(400).json({error:'已有同名公司。請直接使用既有公司，不要重新建立相同公司。'});
  const finalCode=code||`company-${Date.now()}`; const t=now(); const tx=db.transaction(()=>{
    const info=db.prepare('INSERT INTO tenants (name,code,status,created_at,updated_at) VALUES (?,?,?,?,?)').run(name,finalCode,'active',t,t);
    const tid=info.lastInsertRowid;
    // 新公司建立當下就複製一份平台目錄，之後平台預設的變更不會同步到這家公司。
    const menuNow=readMenuConfig();
    menuNow.tenants=menuNow.tenants||{};
    menuNow.tenants[String(tid)]={staff:(menuNow.staff||[]).map(x=>({...x})),company:(menuNow.company||[]).map(x=>({...x}))};
    writeMenuConfig(menuNow);
    const p=db.makePassword(adminPassword); const u=db.prepare('INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,admin_level) VALUES (?,?,?,?,1,?,?,?,?,?)').run(adminEmployeeId,adminName,p.hash,p.salt,t,t,'company_admin',tid,'owner');
    db.prepare('INSERT INTO communities (tenant_id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run(tid,'請建立第一個社區','active',t,t);
    return {tenantId:tid,userId:u.lastInsertRowid};
  });
  try{res.json({success:true,...tx()});}catch(e){res.status(500).json({error:'建立公司失敗，請確認資料是否重複'});}
});
app.put('/api/admin/tenants/:id',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const t=db.prepare('SELECT * FROM tenants WHERE id=?').get(id);if(!t)return res.status(404).json({error:'找不到公司'});const name=String(req.body?.name||t.name).trim();const status=req.body?.status===undefined?t.status:(req.body.status?'active':'inactive');if(!name)return res.status(400).json({error:'公司名稱不可空白'});db.prepare('UPDATE tenants SET name=?,status=?,updated_at=? WHERE id=?').run(name,status,now(),id);res.json({success:true});});
app.get('/api/admin/tenants/:id/admin',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const u=db.prepare("SELECT id,employee_id,name,is_active,last_login_at,created_at,admin_level FROM staff_users WHERE tenant_id=? AND role='company_admin' AND admin_level='owner' ORDER BY id LIMIT 1").get(id);if(!u)return res.status(404).json({error:'找不到公司負責人'});res.json({admin:u,password_viewable:false});});
app.get('/api/admin/tenants/:id/admins',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const rows=db.prepare("SELECT id,employee_id,name,is_active,last_login_at,created_at,updated_at,admin_level FROM staff_users WHERE tenant_id=? AND role='company_admin' ORDER BY admin_level='owner' DESC,id").all(id);res.json(rows);});
app.post('/api/admin/tenants/:id/admins',requireSuperAdmin,(req,res)=>{const tenantIdValue=Number(req.params.id);const tenant=db.prepare('SELECT id,status FROM tenants WHERE id=?').get(tenantIdValue);if(!tenant)return res.status(404).json({error:'找不到公司'});const employeeId=String(req.body?.employee_id||'').trim();const name=String(req.body?.name||'').trim();const password=String(req.body?.password||'');if(!employeeId||!name||password.length<4)return res.status(400).json({error:'請填寫員編、姓名，且密碼至少 4 碼'});if(db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tenantIdValue,employeeId))return res.status(400).json({error:'這家公司已經有相同員編'});const p=db.makePassword(password);const t=now();const info=db.prepare('INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,admin_level) VALUES (?,?,?,?,1,?,?,?,?,?)').run(employeeId,name,p.hash,p.salt,t,t,'company_admin',tenantIdValue,'admin');res.json({success:true,id:info.lastInsertRowid});});
app.put('/api/admin/company-admins/:id',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const u=db.prepare("SELECT * FROM staff_users WHERE id=? AND role='company_admin'").get(id);if(!u)return res.status(404).json({error:'找不到公司管理員'});const name=String(req.body?.name||u.name).trim();const active=req.body?.is_active===undefined?!!u.is_active:!!req.body.is_active;const password=String(req.body?.password||'');if(!name)return res.status(400).json({error:'姓名不可空白'});if(u.admin_level==='owner'&&!active)return res.status(400).json({error:'公司負責人不能由這裡停用，請先指定新的負責人'});const t=now();if(password){if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const p=db.makePassword(password);db.prepare('UPDATE staff_users SET name=?,is_active=?,password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(name,active?1:0,p.hash,p.salt,t,id);}else db.prepare('UPDATE staff_users SET name=?,is_active=?,updated_at=? WHERE id=?').run(name,active?1:0,t,id);res.json({success:true});});
app.post('/api/admin/tenants/:id/admin/reset-password',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const password=String(req.body?.password||'');if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const u=db.prepare("SELECT id FROM staff_users WHERE tenant_id=? AND role='company_admin' AND admin_level='owner' ORDER BY id LIMIT 1").get(id);if(!u)return res.status(404).json({error:'找不到公司負責人'});const p=db.makePassword(password);db.prepare('UPDATE staff_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(p.hash,p.salt,now(),u.id);res.json({success:true});});

app.get('/api/admin/submissions',requireSuperAdmin,(req,res)=>{
  const rows=db.prepare(`SELECT s.id,s.created_at,s.updated_at,s.employee_id,s.employee_name,s.tenant_id,s.community_id,s.data,t.name tenant_name,c.name community_name FROM submissions s LEFT JOIN tenants t ON t.id=s.tenant_id LEFT JOIN communities c ON c.id=s.community_id ORDER BY s.id DESC`).all();
  res.json({submissions:rows.map(r=>({...r,data:JSON.parse(r.data)})),questions:readQuestions()});
});
app.delete('/api/admin/submissions/:id',requireSuperAdmin,(req,res)=>{db.prepare('DELETE FROM submissions WHERE id=?').run(req.params.id);res.json({success:true});});
app.get('/api/admin/questions',requireSuperAdmin,(req,res)=>res.json(readQuestions()));
app.put('/api/admin/questions',requireSuperAdmin,(req,res)=>{const list=req.body;if(!Array.isArray(list))return res.status(400).json({error:'格式錯誤'});const config=readFormConfig();config.questions=list;writeFormConfig(config);res.json({success:true});});
app.get('/api/admin/form-config',requireSuperAdmin,(req,res)=>res.json(readFormConfig()));
app.put('/api/admin/form-config',requireSuperAdmin,(req,res)=>{const config=req.body;if(!config||!Array.isArray(config.pages)||!Array.isArray(config.questions))return res.status(400).json({error:'表單設定格式錯誤'});const pageIds=new Set(config.pages.map(p=>p.id));const ids=config.questions.map(q=>q.id);if(new Set(ids).size!==ids.length)return res.status(400).json({error:'欄位代碼不能重複'});if(config.questions.some(q=>!pageIds.has(q.pageId)))return res.status(400).json({error:'有題目尚未指定有效頁面'});writeFormConfig(config);res.json({success:true});});

// 總後臺可查看全部帳號，但一般公司管理操作應在公司後台進行
app.get('/api/admin/staff',requireSuperAdmin,(req,res)=>{const rows=db.prepare(`SELECT u.id,u.employee_id,u.name,u.is_active,u.role,u.tenant_id,u.created_at,u.updated_at,t.name tenant_name FROM staff_users u LEFT JOIN tenants t ON t.id=u.tenant_id ORDER BY u.tenant_id,u.role DESC,u.employee_id`).all();res.json(rows);});
app.put('/api/admin/staff/:id',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const user=db.prepare('SELECT * FROM staff_users WHERE id=?').get(id);if(!user)return res.status(404).json({error:'找不到人員'});const name=String(req.body?.name||user.name).trim();const active=req.body?.is_active===undefined?!!user.is_active:!!req.body.is_active;const role=req.body?.role||user.role||'staff';const tenantIdValue=req.body?.tenant_id===null?null:(req.body?.tenant_id===undefined?user.tenant_id:Number(req.body.tenant_id));const password=String(req.body?.password||'');if(!name)return res.status(400).json({error:'姓名不可空白'});if(!['staff','company_admin'].includes(role))return res.status(400).json({error:'角色不正確'});if(role==='company_admin'&&!tenantIdValue)return res.status(400).json({error:'公司管理員必須隸屬一家公司'});const t=now();if(password){if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const p=db.makePassword(password);db.prepare('UPDATE staff_users SET name=?,is_active=?,role=?,tenant_id=?,password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(name,active?1:0,role,tenantIdValue,p.hash,p.salt,t,id);}else db.prepare('UPDATE staff_users SET name=?,is_active=?,role=?,tenant_id=?,updated_at=? WHERE id=?').run(name,active?1:0,role,tenantIdValue,t,id);res.json({success:true});});
app.delete('/api/admin/staff/:id',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const u=db.prepare('SELECT * FROM staff_users WHERE id=?').get(id);if(!u)return res.status(404).json({error:'找不到人員'});db.prepare('DELETE FROM staff_users WHERE id=?').run(id);db.prepare('DELETE FROM drafts WHERE employee_id=? AND tenant_id=?').run(u.employee_id,u.tenant_id);res.json({success:true});});

// ===== 公司管理後台 =====
app.get('/api/company/branding',requireCompanyAdmin,(req,res)=>{const row=getTenant(req);if(!row)return res.status(404).json({error:'找不到公司'});res.json(sanitizeBranding(row));});
app.get('/api/staff/branding',requireStaffFiller,(req,res)=>{const row=getTenant(req);if(!row)return res.status(404).json({error:'找不到公司'});res.json(sanitizeBranding(row));});
app.get('/api/company/session',requireCompanyAdmin,(req,res)=>{const u=getUser(req);res.json({loggedIn:true,entry:req.session.entry||'company',user:{employee_id:u.employee_id,name:u.name,admin_level:u.admin_level||'staff',role:u.role,work_type:u.work_type||'internal',permissions:effectivePermissions(u),job_categories:getJobCategories(u)},tenant:getTenant(req)});});
app.get('/api/company/admins',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const rows=db.prepare("SELECT id,employee_id,name,is_active,admin_level,last_login_at,created_at,updated_at FROM staff_users WHERE tenant_id=? AND role='company_admin' ORDER BY admin_level='owner' DESC,id").all(tenantId(req));res.json({admins:rows,current_user_id:getUser(req).id,current_admin_level:getUser(req).admin_level||'admin'});});
app.post('/api/company/admins',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const me=getUser(req);if((me.admin_level||'admin')!=='owner')return res.status(403).json({error:'只有公司負責人可以新增公司管理員。一般公司管理員仍可開通總務、會計等一般人員帳號。'});const employeeId=String(req.body?.employee_id||'').trim();const name=String(req.body?.name||'').trim();const password=String(req.body?.password||'');if(!employeeId||!name||password.length<4)return res.status(400).json({error:'請填寫員編、姓名，且密碼至少 4 碼'});if(db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tenantId(req),employeeId))return res.status(400).json({error:'這家公司已經有相同員編'});const p=db.makePassword(password);const t=now();const info=db.prepare('INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,admin_level) VALUES (?,?,?,?,1,?,?,?,?,?)').run(employeeId,name,p.hash,p.salt,t,t,'company_admin',tenantId(req),'admin');res.json({success:true,id:info.lastInsertRowid});});
app.put('/api/company/admins/:id',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const me=getUser(req);if((me.admin_level||'admin')!=='owner')return res.status(403).json({error:'只有公司負責人可以管理其他公司管理員'});const id=Number(req.params.id);const u=db.prepare("SELECT * FROM staff_users WHERE id=? AND tenant_id=? AND role='company_admin'").get(id,tenantId(req));if(!u)return res.status(404).json({error:'找不到公司管理員'});const name=String(req.body?.name||u.name).trim();const active=req.body?.is_active===undefined?!!u.is_active:!!req.body.is_active;const password=String(req.body?.password||'');if(!name)return res.status(400).json({error:'姓名不可空白'});if(u.admin_level==='owner'&&!active)return res.status(400).json({error:'不能停用公司負責人'});const t=now();if(password){if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const p=db.makePassword(password);db.prepare('UPDATE staff_users SET name=?,is_active=?,password_hash=?,password_salt=?,updated_at=? WHERE id=? AND tenant_id=?').run(name,active?1:0,p.hash,p.salt,t,id,tenantId(req));}else db.prepare('UPDATE staff_users SET name=?,is_active=?,updated_at=? WHERE id=? AND tenant_id=?').run(name,active?1:0,t,id,tenantId(req));res.json({success:true});});
app.get('/api/company/staff',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const rows=db.prepare(`SELECT id,employee_id,name,is_active,role,admin_level,position,job_category,job_level,work_type,job_categories_json,permission_json,person_uid,person_status,created_at,updated_at FROM staff_users WHERE tenant_id=? ORDER BY role DESC,admin_level='owner' DESC,is_active DESC,employee_id`).all(tenantId(req));res.json(rows.map(r=>({...r,permissions:effectivePermissions(r),job_categories:getJobCategories(r)})));});
app.post('/api/company/staff',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const employeeId=String(req.body?.employee_id||'').trim();const name=String(req.body?.name||'').trim();const password=String(req.body?.password||'');const workType=['site','internal','hybrid'].includes(req.body?.work_type)?req.body.work_type:'site';const jobCategories=Array.isArray(req.body?.job_categories)?req.body.job_categories.map(String).filter(Boolean):String(req.body?.job_category||'').trim()?[String(req.body.job_category).trim()]:[];const jobLevel=String(req.body?.job_level||'').trim();const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.map(String).filter(Boolean):STAFF_PERMISSION_DEFAULTS.slice();const communityIds=Array.isArray(req.body?.community_ids)?req.body.community_ids.map(Number).filter(Boolean):[];if(!employeeId||!name||password.length<4)return res.status(400).json({error:'請填寫員編、姓名，且密碼至少 4 碼'});if(!jobCategories.length)return res.status(400).json({error:'至少選擇一個職務類別'});if(!jobLevel)return res.status(400).json({error:'請選擇職務位階'});if(workType!=='internal'&&!communityIds.length)return res.status(400).json({error:'駐點／兼任駐點人員至少要勾選一個案場'});if(db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tenantId(req),employeeId))return res.status(400).json({error:'這家公司目前已有相同員編的啟用帳號'});const valid=new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tenantId(req)).map(x=>x.id));if(communityIds.some(x=>!valid.has(x)))return res.status(400).json({error:'包含不屬於本公司的啟用案場'});const p=db.makePassword(password);const t=now();const position=`${jobLevel}${jobCategories.length?'｜'+jobCategories.join('、'):''}`;const info=db.prepare('INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,position,work_type,job_category,job_level,job_categories_json,permission_json,person_uid,person_status) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)').run(employeeId,name,p.hash,p.salt,t,t,'staff',tenantId(req),position,workType,jobCategories[0],jobLevel,JSON.stringify(jobCategories),JSON.stringify(permissions),'P'+String(Date.now()),'active');syncWorkAssignments(info.lastInsertRowid,tenantId(req),workType,communityIds,jobCategories,jobLevel,permissions);res.json({success:true,id:info.lastInsertRowid});});
app.put('/api/company/staff/:id',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const id=Number(req.params.id);const u=db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!u)return res.status(404).json({error:'找不到人員'});if(u.role==='company_admin'&&u.id!==getUser(req).id)return res.status(400).json({error:'公司管理員請由公司負責人管理'});const name=String(req.body?.name||u.name).trim();const active=req.body?.is_active===undefined?!!u.is_active:!!req.body.is_active;const password=String(req.body?.password||'');const workType=['site','internal','hybrid'].includes(req.body?.work_type)?req.body.work_type:(u.work_type||'site');const jobCategories=Array.isArray(req.body?.job_categories)?req.body.job_categories.map(String).filter(Boolean):String(req.body?.job_category||u.job_category||'').trim()?[String(req.body?.job_category||u.job_category).trim()]:getJobCategories(u);const jobLevel=String(req.body?.job_level===undefined?(u.job_level||''):req.body.job_level).trim();const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.map(String).filter(Boolean):parsePermissions(u);const communityIds=Array.isArray(req.body?.community_ids)?req.body.community_ids.map(Number).filter(Boolean):getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean);if(!name)return res.status(400).json({error:'姓名不可空白'});if(!jobCategories.length)return res.status(400).json({error:'至少選擇一個職務類別'});if(!jobLevel)return res.status(400).json({error:'請選擇職務位階'});if(workType!=='internal'&&!communityIds.length)return res.status(400).json({error:'駐點／兼任駐點人員至少要勾選一個案場'});const valid=new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tenantId(req)).map(x=>x.id));if(communityIds.some(x=>!valid.has(x)))return res.status(400).json({error:'包含不屬於本公司的啟用案場'});const position=`${jobLevel}｜${jobCategories.join('、')}`;const t=now();if(password){if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const p=db.makePassword(password);db.prepare("UPDATE staff_users SET name=?,is_active=?,password_hash=?,password_salt=?,position=?,work_type=?,job_category=?,job_level=?,job_categories_json=?,permission_json=?,person_status='active',updated_at=? WHERE id=? AND tenant_id=?").run(name,active?1:0,p.hash,p.salt,position,workType,jobCategories[0],jobLevel,JSON.stringify(jobCategories),JSON.stringify(permissions),t,id,tenantId(req));}else db.prepare("UPDATE staff_users SET name=?,is_active=?,position=?,work_type=?,job_category=?,job_level=?,job_categories_json=?,permission_json=?,person_status='active',updated_at=? WHERE id=? AND tenant_id=?").run(name,active?1:0,position,workType,jobCategories[0],jobLevel,JSON.stringify(jobCategories),JSON.stringify(permissions),t,id,tenantId(req));syncWorkAssignments(id,tenantId(req),workType,communityIds,jobCategories,jobLevel,permissions);res.json({success:true});});
app.post('/api/company/staff/:id/status',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const id=Number(req.params.id);const u=db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!u||u.role==='company_admin'&&u.admin_level==='owner')return res.status(404).json({error:'找不到可異動的人員'});if(u.role==='company_admin'&&(getUser(req).admin_level||'admin')!=='owner')return res.status(403).json({error:'只有公司負責人可以處理其他公司管理員的離職、停用或黑名單。'});const status=String(req.body?.status||'').trim();if(!['active','disabled','left','blacklist'].includes(status))return res.status(400).json({error:'人員狀態不正確'});if(status==='disabled'){db.prepare("UPDATE staff_users SET is_active=0,person_status='disabled',updated_at=? WHERE id=? AND tenant_id=?").run(now(),id,tenantId(req));return res.json({success:true,action:'disabled'});}if(status==='active'){db.prepare("UPDATE staff_users SET is_active=1,person_status='active',updated_at=? WHERE id=? AND tenant_id=?").run(now(),id,tenantId(req));return res.json({success:true,action:'active'});}const snapshot={employee_id:u.employee_id,name:u.name,work_type:u.work_type,job_categories:getJobCategories(u),job_level:u.job_level,permissions:parsePermissions(u),communities:getSiteAssignments(u).map(x=>({id:x.community_id,name:x.community_name})),archived_from_account_id:u.id};db.prepare('INSERT INTO staff_person_archive (person_uid,tenant_id,employee_id,name,person_status,archived_at,archived_by_staff_id,snapshot_json) VALUES (?,?,?,?,?,?,?,?)').run(u.person_uid||('P'+String(u.id).padStart(8,'0')),tenantId(req),u.employee_id,u.name,status,now(),getUser(req).id,JSON.stringify(snapshot));db.prepare('DELETE FROM staff_users WHERE id=? AND tenant_id=?').run(id,tenantId(req));return res.json({success:true,action:'archived_deleted_account'});});
app.get('/api/company/personnel-archive',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const status=String(req.query?.status||'').trim();const rows=status?db.prepare('SELECT * FROM staff_person_archive WHERE tenant_id=? AND person_status=? ORDER BY archived_at DESC').all(tenantId(req),status):db.prepare('SELECT * FROM staff_person_archive WHERE tenant_id=? ORDER BY archived_at DESC').all(tenantId(req));res.json(rows.map(r=>({...r,snapshot:JSON.parse(r.snapshot_json||'{}')})));});
app.delete('/api/company/staff/:id',requireCompanyAdmin,(req,res)=>res.status(400).json({error:'請使用「停用」、「離職」或「黑名單」處理人員狀態；離職與黑名單會封存人事資料並刪除登入帳號。'}));

app.get('/api/company/communities',requireCompanyAdmin,requireCompanyPermission('manage-communities'),(req,res)=>res.json(db.prepare('SELECT * FROM communities WHERE tenant_id=? ORDER BY status DESC,name').all(tenantId(req))));
app.post('/api/company/communities',requireCompanyAdmin,requireCompanyPermission('manage-communities'),(req,res)=>{const name=String(req.body?.name||'').trim();if(!name)return res.status(400).json({error:'社區名稱不可空白'});const t=now();const info=db.prepare('INSERT INTO communities (tenant_id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run(tenantId(req),name,'active',t,t);res.json({success:true,id:info.lastInsertRowid});});
app.put('/api/company/communities/:id',requireCompanyAdmin,requireCompanyPermission('manage-communities'),(req,res)=>{const id=Number(req.params.id);const c=db.prepare('SELECT * FROM communities WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!c)return res.status(404).json({error:'找不到社區'});const name=String(req.body?.name||c.name).trim();const status=req.body?.status===undefined?c.status:(req.body.status?'active':'inactive');if(!name)return res.status(400).json({error:'社區名稱不可空白'});db.prepare('UPDATE communities SET name=?,status=?,updated_at=? WHERE id=? AND tenant_id=?').run(name,status,now(),id,tenantId(req));res.json({success:true});});
app.get('/api/company/staff/:id/communities',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const id=Number(req.params.id);const u=db.prepare('SELECT id FROM staff_users WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!u)return res.status(404).json({error:'找不到人員'});const rows=db.prepare('SELECT c.id,c.name,c.status,CASE WHEN sc.staff_id IS NULL THEN 0 ELSE 1 END assigned FROM communities c LEFT JOIN staff_communities sc ON sc.community_id=c.id AND sc.staff_id=? WHERE c.tenant_id=? ORDER BY c.name').all(id,tenantId(req));res.json(rows);});
app.put('/api/company/staff/:id/communities',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const id=Number(req.params.id);const u=db.prepare("SELECT * FROM staff_users WHERE id=? AND tenant_id=?").get(id,tenantId(req));if(!u)return res.status(404).json({error:'找不到人員'});if(u.role==='company_admin')return res.status(400).json({error:'公司管理員不需要設定社區權限'});const ids=Array.isArray(req.body?.community_ids)?req.body.community_ids.map(Number).filter(Boolean):[];const valid=new Set(db.prepare('SELECT id FROM communities WHERE tenant_id=?').all(tenantId(req)).map(x=>x.id));if(ids.some(x=>!valid.has(x)))return res.status(400).json({error:'包含不屬於本公司的社區'});const cats=getJobCategories(u),perms=parsePermissions(u);const tx=db.transaction(()=>{db.prepare('DELETE FROM staff_communities WHERE staff_id=?').run(id);const ins=db.prepare('INSERT INTO staff_communities (staff_id,community_id) VALUES (?,?)');for(const cid of ids)ins.run(id,cid);});tx();syncWorkAssignments(id,tenantId(req),u.work_type==='internal'?'internal':(u.work_type==='hybrid'?'hybrid':'site'),ids,cats,u.job_level||'',perms);res.json({success:true});});
app.get('/api/company/submissions',requireCompanyAdmin,requireCompanyPermission('view-submissions'),(req,res)=>{const rows=db.prepare(`SELECT s.id,s.created_at,s.updated_at,s.employee_id,s.employee_name,s.community_id,s.data,c.name community_name FROM submissions s LEFT JOIN communities c ON c.id=s.community_id WHERE s.tenant_id=? ORDER BY s.id DESC`).all(tenantId(req));res.json({submissions:rows.map(r=>({...r,data:JSON.parse(r.data)})),questions:readQuestions()});});
// ===== 案場 SOP／智慧分流 =====
function cleanSopCategory(v){const s=String(v||'').trim();return ['行政','勤務','應變','案場注意事項'].includes(s)?s:'行政';}
function cleanSopScope(v){return String(v||'')==='community'?'community':'company_basic';}
function parseSopCommunityIds(v){return Array.isArray(v)?[...new Set(v.map(Number).filter(Boolean))]:[];}
function parseSopTargetJobs(v){return Array.isArray(v)?[...new Set(v.map(x=>String(x||'').trim()).filter(Boolean))]:[];}
function parseSopTargetJobsJson(v){try{return parseSopTargetJobs(JSON.parse(v||'[]'));}catch{return [];}}
function getSopCommunityIds(sopId){return db.prepare('SELECT community_id FROM sop_communities WHERE sop_id=? ORDER BY community_id').all(sopId).map(x=>Number(x.community_id));}
function getSopTargetJobs(sop){return parseSopTargetJobsJson(sop?.target_jobs_json);}
function getUserSiteCommunityIds(u){return getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean);}
function isSiteManager(u){if(!u||u.role==='company_admin')return false;const jobs=getJobCategories(u);return String(u.job_level||'')==='經理'||jobs.includes('經理');}
function sopTargetMatchesUser(sop,u){
  const targets=getSopTargetJobs(sop); if(!targets.length||targets.includes('全部'))return true;
  const jobs=getJobCategories(u); const level=String(u.job_level||'');
  return targets.some(t=>t===level||jobs.includes(t));
}
function sopRowsForTenant(tid,category=''){
  const params=[tid]; let sql=`SELECT s.*,COUNT(sc.community_id) AS community_count FROM sops s LEFT JOIN sop_communities sc ON sc.sop_id=s.id WHERE s.tenant_id=?`;
  if(['行政','勤務','應變','案場注意事項'].includes(category)){sql+=' AND s.category=?';params.push(category);}
  return db.prepare(sql+` GROUP BY s.id ORDER BY CASE s.scope_type WHEN 'company_basic' THEN 0 ELSE 1 END,CASE s.category WHEN '應變' THEN 0 WHEN '行政' THEN 1 WHEN '勤務' THEN 2 ELSE 3 END,s.is_active DESC,s.updated_at DESC,s.id DESC`).all(...params).map(r=>({...r,community_ids:getSopCommunityIds(r.id),target_jobs:getSopTargetJobs(r)}));
}
function canStaffAccessSop(req,sop){
  const u=getUser(req); if(!u||u.tenant_id!==sop.tenant_id||u.role==='company_admin')return false;
  if(String(sop.scope_type||'company_basic')==='company_basic') return sopTargetMatchesUser(sop,u);
  const communities=getUserSiteCommunityIds(u); if(!communities.length)return false;
  const assigned=getSopCommunityIds(sop.id);
  if(!assigned.length || !assigned.some(cid=>communities.includes(cid))) return false;
  // 案場經理可查看自己派駐案場的案場注意事項；秘書／保全則依經理指定的職務分流。
  if(isSiteManager(u)) return true;
  return sopTargetMatchesUser(sop,u);
}
function sopDownloadName(sop){return String(sop.original_filename||sop.title||'SOP').replace(/[\r\n]/g,'_');}
function cleanupUploadedFile(file){if(file?.filename)try{fs.unlinkSync(path.join(SOPS_DIR,file.filename))}catch{}}
function validateSopCommunityIds(ids,tid){
  const valid=new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tid).map(x=>Number(x.id)));
  return ids.every(id=>valid.has(id));
}
function auditSop(u,action,id,detail){db.prepare('INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(u.tenant_id,u.employee_id,u.name,action,'sop','sop',String(id),JSON.stringify(detail||{}),now());}

app.get('/api/company/sops',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>res.json({sops:sopRowsForTenant(tenantId(req))}));
app.post('/api/company/sops',requireCompanyAdmin,requireCompanyPermission('manage-sop'),sopUpload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'請選擇 SOP 檔案'});
  const title=String(req.body?.title||'').trim(); const version=String(req.body?.version||'1.0').trim()||'1.0'; const category=cleanSopCategory(req.body?.category); const scopeType=cleanSopScope(req.body?.scope_type); const description=String(req.body?.description||'').trim(); let ids=[]; let targets=[];
  try{ids=req.body?.community_ids?parseSopCommunityIds(JSON.parse(req.body.community_ids)):[]}catch{ids=[]}
  try{targets=req.body?.target_jobs?parseSopTargetJobs(JSON.parse(req.body.target_jobs)):[]}catch{targets=[]}
  if(!title){cleanupUploadedFile(req.file);return res.status(400).json({error:'SOP 名稱不可空白'});}
  if(scopeType==='community'&&!ids.length){cleanupUploadedFile(req.file);return res.status(400).json({error:'案場 SOP 至少要指定一個派駐案場'});}
  if(!validateSopCommunityIds(ids,tenantId(req))){cleanupUploadedFile(req.file);return res.status(400).json({error:'包含不屬於本公司的啟用案場'});}
  const t=now(),u=getUser(req);const info=db.prepare('INSERT INTO sops (tenant_id,title,category,description,version,filename,original_filename,is_active,created_at,updated_at,updated_by,scope_type,target_jobs_json,source_type,uploader_staff_id,uploader_name,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),title,category,description,version,req.file.filename,req.file.originalname,1,t,t,u.name||u.employee_id||'',scopeType,JSON.stringify(targets),'company',u.id,u.name||'', 'published');
  const ins=db.prepare('INSERT INTO sop_communities (sop_id,community_id) VALUES (?,?)');for(const id of ids)ins.run(info.lastInsertRowid,id);auditSop(u,'create',info.lastInsertRowid,{title,category,scope_type:scopeType,version,community_ids:ids,target_jobs:targets,source_type:'company'});res.json({success:true,id:Number(info.lastInsertRowid)});
});

// 案場經理上傳「派駐社區注意事項」：資料直接回到同一家公司 SOP 中，內勤不必代為整理上傳。
app.post('/api/staff/sops/community-upload',requireStaffFiller,sopUpload.single('file'),(req,res)=>{
  const u=getUser(req); if(!isSiteManager(u) || !effectivePermissions(u).includes('sop')){cleanupUploadedFile(req.file);return res.status(403).json({error:'只有具備 SOP 權限的案場經理可以上傳派駐社區 SOP'});}
  if(!req.file)return res.status(400).json({error:'請選擇 SOP 檔案'});
  const title=String(req.body?.title||'').trim(); const version=String(req.body?.version||'1.0').trim()||'1.0'; const description=String(req.body?.description||'').trim(); let cid=Number(req.body?.community_id||0); let targets=[];
  try{targets=req.body?.target_jobs?parseSopTargetJobs(JSON.parse(req.body.target_jobs)):[]}catch{targets=[]}
  const assigned=getUserSiteCommunityIds(u); if(!cid&&assigned.length===1)cid=assigned[0];
  if(!title){cleanupUploadedFile(req.file);return res.status(400).json({error:'SOP 名稱不可空白'});}
  if(!cid||!assigned.includes(cid)||!validateSopCommunityIds([cid],tenantId(req))){cleanupUploadedFile(req.file);return res.status(400).json({error:'請選擇您目前派駐的有效案場'});}
  if(!targets.length)targets=['秘書','保全'];
  const t=now();const info=db.prepare('INSERT INTO sops (tenant_id,title,category,description,version,filename,original_filename,is_active,created_at,updated_at,updated_by,scope_type,target_jobs_json,source_type,uploader_staff_id,uploader_name,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),title,'案場注意事項',description,version,req.file.filename,req.file.originalname,1,t,t,u.name||u.employee_id||'','community',JSON.stringify(targets),'manager',u.id,u.name||'','published');
  db.prepare('INSERT INTO sop_communities (sop_id,community_id) VALUES (?,?)').run(info.lastInsertRowid,cid);auditSop(u,'manager-upload',info.lastInsertRowid,{title,version,community_id:cid,target_jobs:targets,source_type:'manager'});res.json({success:true,id:Number(info.lastInsertRowid),message:'已上傳，這份 SOP 已回傳公司並可由公司內勤統一管理。'});
});

app.put('/api/company/sops/:id',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>{
  const id=Number(req.params.id),sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!sop)return res.status(404).json({error:'找不到 SOP'});
  const title=String(req.body?.title??sop.title).trim(),version=String(req.body?.version??sop.version).trim()||'1.0',category=cleanSopCategory(req.body?.category??sop.category),scopeType=cleanSopScope(req.body?.scope_type??sop.scope_type),description=String(req.body?.description ?? sop.description ?? '').trim();if(!title)return res.status(400).json({error:'SOP 名稱不可空白'});
  let ids=getSopCommunityIds(id);if(Array.isArray(req.body?.community_ids))ids=parseSopCommunityIds(req.body.community_ids);let targets=getSopTargetJobs(sop);if(Array.isArray(req.body?.target_jobs))targets=parseSopTargetJobs(req.body.target_jobs);if(scopeType==='community'&&!ids.length)return res.status(400).json({error:'案場 SOP 至少要指定一個派駐案場'});if(!validateSopCommunityIds(ids,tenantId(req)))return res.status(400).json({error:'包含不屬於本公司的啟用案場'});
  const active=req.body?.is_active===undefined?!!sop.is_active:!!req.body.is_active,t=now(),u=getUser(req);const tx=db.transaction(()=>{db.prepare('UPDATE sops SET title=?,category=?,description=?,version=?,is_active=?,scope_type=?,target_jobs_json=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(title,category,description,version,active?1:0,scopeType,JSON.stringify(targets),t,u.name||u.employee_id||'',id,tenantId(req));if(Array.isArray(req.body?.community_ids)){db.prepare('DELETE FROM sop_communities WHERE sop_id=?').run(id);const ins=db.prepare('INSERT INTO sop_communities (sop_id,community_id) VALUES (?,?)');for(const cid of ids)ins.run(id,cid);}});tx();auditSop(u,'update',id,{title,category,scope_type:scopeType,version,community_ids:ids,target_jobs:targets});res.json({success:true});
});
app.post('/api/company/sops/:id/file',requireCompanyAdmin,requireCompanyPermission('manage-sop'),sopUpload.single('file'),(req,res)=>{const id=Number(req.params.id),sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!sop)return res.status(404).json({error:'找不到 SOP'});if(!req.file)return res.status(400).json({error:'請選擇新的 SOP 檔案'});const old=path.join(SOPS_DIR,sop.filename);if(fs.existsSync(old))try{fs.unlinkSync(old)}catch{};const u=getUser(req);db.prepare('UPDATE sops SET filename=?,original_filename=?,updated_at=?,updated_by=?,uploader_staff_id=?,uploader_name=?,source_type=? WHERE id=? AND tenant_id=?').run(req.file.filename,req.file.originalname,now(),u.name||u.employee_id||'',u.id,u.name||'','company',id,tenantId(req));auditSop(u,'replace-file',id,{original_filename:req.file.originalname});res.json({success:true});});
app.post('/api/company/sops/:id/toggle',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>{const id=Number(req.params.id),sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!sop)return res.status(404).json({error:'找不到 SOP'});const u=getUser(req);db.prepare('UPDATE sops SET is_active=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(req.body?.is_active?1:0,now(),u.name||u.employee_id||'',id,tenantId(req));auditSop(u,'toggle',id,{is_active:!!req.body?.is_active});res.json({success:true});});
app.delete('/api/company/sops/:id',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>{const id=Number(req.params.id),sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!sop)return res.status(404).json({error:'找不到 SOP'});const p=path.join(SOPS_DIR,sop.filename);if(fs.existsSync(p))try{fs.unlinkSync(p)}catch{};const u=getUser(req);db.prepare('DELETE FROM sops WHERE id=? AND tenant_id=?').run(id,tenantId(req));auditSop(u,'delete',id,{title:sop.title});res.json({success:true});});
app.get('/api/company/sops/:id/download',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>{const sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=?').get(Number(req.params.id),tenantId(req));if(!sop)return res.status(404).json({error:'找不到 SOP'});const p=path.join(SOPS_DIR,sop.filename);if(!fs.existsSync(p))return res.status(404).json({error:'SOP 檔案不存在，請重新上傳'});res.download(p,sopDownloadName(sop));});
app.get('/api/staff/sops',requireStaffFiller,(req,res)=>{const u=getUser(req);const category=['行政','勤務','應變','案場注意事項'].includes(String(req.query?.category||''))?String(req.query.category):'';const scope=String(req.query?.scope||'').trim();const rows=sopRowsForTenant(tenantId(req),category).filter(x=>x.is_active&&x.review_status!=='draft'&&(!scope||String(x.scope_type||'company_basic')===scope)&&canStaffAccessSop(req,x));const manager=isSiteManager(u);const canUpload=manager&&effectivePermissions(u).includes('sop');res.json({sops:rows,viewer:{job_level:u.job_level||'',job_categories:getJobCategories(u),manager,can_upload:canUpload,upload_reason:manager&&!canUpload?'公司尚未開通您的「案場 SOP」權限':''}});});
app.get('/api/staff/sops/:id/download',requireStaffFiller,(req,res)=>{const sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=? AND is_active=1').get(Number(req.params.id),tenantId(req));if(!sop||sop.review_status==='draft'||!canStaffAccessSop(req,sop))return res.status(404).json({error:'找不到您目前可以閱讀的 SOP'});const p=path.join(SOPS_DIR,sop.filename);if(!fs.existsSync(p))return res.status(404).json({error:'SOP 檔案不存在，請通知公司重新上傳'});res.download(p,sopDownloadName(sop));});

app.get('/api/company/templates',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>res.json({globalTemplates:db.prepare('SELECT id,name,filename,is_active,created_at FROM templates WHERE tenant_id IS NULL ORDER BY is_active DESC,id DESC').all(),companyTemplates:db.prepare('SELECT id,name,filename,is_active,created_at FROM templates WHERE tenant_id=? ORDER BY is_active DESC,id DESC').all(tenantId(req))}));
const upload=multer({storage:multer.diskStorage({destination:(req,file,cb)=>cb(null,TEMPLATES_DIR),filename:(req,file,cb)=>cb(null,Date.now()+'-'+file.originalname.replace(/[^\\w.\\-\\u4e00-\\u9fa5]/g,'_'))}),fileFilter:(req,file,cb)=>file.originalname.toLowerCase().endsWith('.docx')?cb(null,true):cb(new Error('只允許上傳 .docx 檔案'))});
const analyzerUpload=multer({storage:multer.diskStorage({destination:(req,file,cb)=>cb(null,TEMPLATES_DIR),filename:(req,file,cb)=>cb(null,'__analysis__'+Date.now()+'-'+file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_'))}),fileFilter:(req,file,cb)=>['.docx','.xlsx','.xlsm'].includes(path.extname(file.originalname).toLowerCase())?cb(null,true):cb(new Error('只允許上傳 .docx、.xlsx、.xlsm 檔案'))});
app.post('/api/admin/template-analyze',requireSuperAdmin,analyzerUpload.single('template'),(req,res)=>{if(!req.file)return res.status(400).json({error:'未收到檔案'});const filePath=path.join(TEMPLATES_DIR,req.file.filename);try{const result=analyzeTemplate(filePath);res.json({success:true,analysis:result});}catch(err){console.error(err);res.status(400).json({error:'模板分析失敗',detail:err.message});}finally{try{fs.unlinkSync(filePath)}catch(e){}}});
app.post('/api/company/templates',requireCompanyAdmin,requireCompanyPermission('manage-templates'),upload.single('template'),(req,res)=>{if(!req.file)return res.status(400).json({error:'未收到檔案'});db.prepare('INSERT INTO templates (name,filename,is_active,created_at,tenant_id) VALUES (?,?,0,?,?)').run(req.body.name||req.file.originalname,req.file.filename,now(),tenantId(req));res.json({success:true});});
app.post('/api/company/templates/:id/adopt',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{const source=db.prepare('SELECT * FROM templates WHERE id=? AND tenant_id IS NULL').get(req.params.id);if(!source)return res.status(404).json({error:'找不到平台制式範本'});const safe=source.filename.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');const filename=`${Date.now()}-${tenantId(req)}-${safe}`;fs.copyFileSync(path.join(TEMPLATES_DIR,source.filename),path.join(TEMPLATES_DIR,filename));db.prepare('INSERT INTO templates (name,filename,is_active,created_at,tenant_id) VALUES (?,?,0,?,?)').run(source.name,filename,now(),tenantId(req));res.json({success:true});});
app.put('/api/company/templates/:id',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{const id=Number(req.params.id);const tpl=db.prepare('SELECT * FROM templates WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!tpl)return res.status(404).json({error:'找不到公司範本'});const name=String(req.body?.name||'').trim();if(!name)return res.status(400).json({error:'範本名稱不可空白'});db.prepare('UPDATE templates SET name=? WHERE id=? AND tenant_id=?').run(name,id,tenantId(req));res.json({success:true});});
app.post('/api/company/templates/:id/replace',requireCompanyAdmin,requireCompanyPermission('manage-templates'),upload.single('template'),(req,res)=>{const id=Number(req.params.id);const tpl=db.prepare('SELECT * FROM templates WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!tpl)return res.status(404).json({error:'找不到公司範本'});if(!req.file)return res.status(400).json({error:'未收到檔案'});const oldPath=path.join(TEMPLATES_DIR,tpl.filename);if(fs.existsSync(oldPath))fs.unlinkSync(oldPath);db.prepare('UPDATE templates SET filename=? WHERE id=? AND tenant_id=?').run(req.file.filename,id,tenantId(req));res.json({success:true});});
app.post('/api/company/templates/:id/activate',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{const id=Number(req.params.id);const tpl=db.prepare('SELECT id FROM templates WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!tpl)return res.status(404).json({error:'找不到公司範本'});db.prepare('UPDATE templates SET is_active=0 WHERE tenant_id=?').run(tenantId(req));db.prepare('UPDATE templates SET is_active=1 WHERE id=? AND tenant_id=?').run(id,tenantId(req));res.json({success:true});});
app.delete('/api/company/templates/:id',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{const tpl=db.prepare('SELECT * FROM templates WHERE id=? AND tenant_id=?').get(req.params.id,tenantId(req));if(tpl){const p=path.join(TEMPLATES_DIR,tpl.filename);if(fs.existsSync(p))fs.unlinkSync(p);db.prepare('DELETE FROM templates WHERE id=? AND tenant_id=?').run(req.params.id,tenantId(req));}res.json({success:true});});

function generateForSubmission(req,res,id,templateId){
  const submission=db.prepare('SELECT * FROM submissions WHERE id=? AND tenant_id=?').get(id,tenantId(req));
  if(!submission)return res.status(404).json({error:'找不到該筆紀錄'});
  const template=templateId?db.prepare('SELECT * FROM templates WHERE id=? AND (tenant_id=? OR tenant_id IS NULL)').get(templateId,tenantId(req)):(db.prepare('SELECT * FROM templates WHERE tenant_id=? AND is_active=1').get(tenantId(req))||db.prepare('SELECT * FROM templates WHERE tenant_id IS NULL AND is_active=1').get());
  if(!template)return res.status(400).json({error:'尚未設定公司 Word 範本，請先到「Word 範本」上傳並啟用一份範本'});
  try{const buffer=generateDocx(path.join(TEMPLATES_DIR,template.filename),JSON.parse(submission.data));const d=JSON.parse(submission.data);const fileName=`交接清冊_${d.community_name||submission.id}_${submission.id}.docx`;res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.send(buffer);}catch(err){console.error(err);res.status(500).json({error:'產生 Word 檔失敗，請確認範本內的 {{欄位代碼}} 是否正確',detail:err.message});}
}
app.get('/api/company/generate/:submissionId',requireCompanyAdmin,requireCompanyPermission('view-submissions'),(req,res)=>generateForSubmission(req,res,Number(req.params.submissionId),req.query.templateId?Number(req.query.templateId):null));
app.delete('/api/company/submissions/:id',requireCompanyAdmin,requireCompanyPermission('view-submissions'),(req,res)=>{db.prepare('DELETE FROM submissions WHERE id=? AND tenant_id=?').run(req.params.id,tenantId(req));res.json({success:true});});

// Super admin template management: templates without tenant are global; company templates are visible here too.
app.get('/api/admin/templates',requireSuperAdmin,(req,res)=>res.json(db.prepare(`SELECT tp.*,t.name tenant_name FROM templates tp LEFT JOIN tenants t ON t.id=tp.tenant_id ORDER BY tp.id DESC`).all()));
app.post('/api/admin/templates',requireSuperAdmin,upload.single('template'),(req,res)=>{if(!req.file)return res.status(400).json({error:'未收到檔案'});const tid=req.body.tenant_id?Number(req.body.tenant_id):null;db.prepare('INSERT INTO templates (name,filename,is_active,created_at,tenant_id) VALUES (?,?,0,?,?)').run(req.body.name||req.file.originalname,req.file.filename,now(),tid);res.json({success:true});});
app.post('/api/admin/templates/:id/activate',requireSuperAdmin,(req,res)=>{const tpl=db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.id);if(!tpl)return res.status(404).json({error:'找不到範本'});if(tpl.tenant_id===null) db.prepare('UPDATE templates SET is_active=0 WHERE tenant_id IS NULL').run(); else db.prepare('UPDATE templates SET is_active=0 WHERE tenant_id=?').run(tpl.tenant_id);db.prepare('UPDATE templates SET is_active=1 WHERE id=?').run(req.params.id);res.json({success:true});});
app.delete('/api/admin/templates/:id',requireSuperAdmin,(req,res)=>{const tpl=db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.id);if(tpl){const p=path.join(TEMPLATES_DIR,tpl.filename);if(fs.existsSync(p))fs.unlinkSync(p);db.prepare('DELETE FROM templates WHERE id=?').run(req.params.id);}res.json({success:true});});
app.get('/api/admin/generate/:submissionId',requireSuperAdmin,(req,res)=>{const submission=db.prepare('SELECT * FROM submissions WHERE id=?').get(req.params.submissionId);if(!submission)return res.status(404).json({error:'找不到該筆紀錄'});const template=req.query.templateId?db.prepare('SELECT * FROM templates WHERE id=?').get(req.query.templateId):(db.prepare('SELECT * FROM templates WHERE tenant_id=? AND is_active=1').get(submission.tenant_id)||db.prepare('SELECT * FROM templates WHERE tenant_id IS NULL AND is_active=1').get());if(!template)return res.status(400).json({error:'尚未設定該公司的 Word 範本'});try{const buffer=generateDocx(path.join(TEMPLATES_DIR,template.filename),JSON.parse(submission.data));const d=JSON.parse(submission.data);const fileName=`交接清冊_${d.community_name||submission.id}_${submission.id}.docx`;res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.send(buffer);}catch(err){console.error(err);res.status(500).json({error:'產生 Word 檔失敗',detail:err.message});}});

app.listen(PORT,()=>console.log(`V4 伺服器已啟動：http://localhost:${PORT}`));
