require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./db');
const { generateDocx } = require('./generate');
const { analyzeTemplate } = require('./template-analyzer');

const app = express();

// SOP 模組資料欄位升級：保留『來源負責人』與『實際上傳者』兩個概念。
try {
  const sopCols = db.prepare("PRAGMA table_info(sops)").all().map(x=>String(x.name));
  if (sopCols.length) {
    if (!sopCols.includes('source_manager_staff_id')) db.prepare('ALTER TABLE sops ADD COLUMN source_manager_staff_id INTEGER').run();
    if (!sopCols.includes('source_manager_name')) db.prepare('ALTER TABLE sops ADD COLUMN source_manager_name TEXT').run();
  }
} catch (e) { console.warn('[SOP] 欄位升級略過：', e.message); }
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TEMPLATES_DIR = path.join(DATA_DIR, 'uploads', 'templates');
const PLATFORM_RESOURCES_DIR = path.join(DATA_DIR, 'uploads', 'platform-resources');
const RESIDENT_IMPORTS_DIR = path.join(DATA_DIR, 'uploads', 'resident-imports');
fs.mkdirSync(PLATFORM_RESOURCES_DIR, { recursive: true });
fs.mkdirSync(RESIDENT_IMPORTS_DIR, { recursive: true });

// 住戶名冊上傳器：必須在所有住戶 API 路由註冊前完成初始化，避免 TDZ / Cannot access before initialization。
const residentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RESIDENT_IMPORTS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const base = path.basename(file.originalname || 'resident', ext)
        .replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 80) || 'resident';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${base}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(['.xlsx','.xls','.csv','.txt'].includes(ext) ? null : new Error('住戶名冊只允許 Excel（xlsx/xls）、CSV 或 TXT'), true);
  }
});
const SOPS_DIR = path.join(DATA_DIR, 'uploads', 'sops');
const GENERATED_DIR = path.join(DATA_DIR, 'generated');
const QUESTIONS_PATH = path.join(__dirname, 'config', 'questions.json');
const FORM_CONFIG_PATH = path.join(DATA_DIR, 'form-config.json');
const MENU_CONFIG_PATH = path.join(DATA_DIR, 'menu-config.json');
const STAFF_UI_COPY_PATH = path.join(DATA_DIR, 'staff-ui-copy.json');
const PLATFORM_UI_COPY_PATH = path.join(DATA_DIR, 'platform-ui-copy.json');
const PLATFORM_RULES_PATH = path.join(DATA_DIR, 'platform-rules.json');
const PLATFORM_RULES_HISTORY_PATH = path.join(DATA_DIR, 'platform-rules-history.json');
const DEFAULT_STAFF_UI_COPY = {
  workspaceLoading: '正在讀取資料，請稍候…',
  moduleDefaultDescription: '這個工作內容已經可以放進工作目錄與個人釘選區，實際資料功能會依平台建置進度陸續加入。',
  moduleDefaultNote: '您可以先把常用的其他工作項目釘選到首頁；未來功能完成後，不需要重新設定釘選。',
  todoDescription: '目前需要處理的工作會顯示在這裡；完成後會自動移到「已封存」。',
  todoEmpty: '目前尚無代辦事項。',
  archivedDescription: '已完成的代辦事項會保留在這裡，不會被刪除。',
  archivedEmpty: '查無符合條件的封存紀錄。',
  handoverDescription: '交接相關工作集中在這裡；完成後不會一直顯示在工作台首頁。',
  handoverEmpty: '目前沒有未完成的交接紀錄。',
  sopIntro: '目前登入職務：{{job}}。{{scope}}只會顯示您目前有權限閱讀的內容。',
  sopEmpty: '目前還沒有可閱讀的 SOP。公司基本 SOP 與本案場注意事項會依您的職務自動分流。',
  managerUploadEyebrow: '📤 經理分流上傳',
  managerUploadTitle: '上傳社區 SOP',
  managerUploadHint: '只要您的身分是經理即可上傳。不論公司內勤或派駐社區的經理，都可以把 SOP 回傳公司管理；駐點經理只會看到自己的派駐社區，內勤經理可選擇本公司啟用中的社區。',
  managerUploadButton: '📤 上傳 SOP',
  managerUploadSubmit: '上傳並回傳公司',
  managerUploadSuccess: '✅ SOP 已上傳，也已回傳公司管理端。',
  moduleDescriptions: {
    'todo': '目前需要處理的工作會顯示在這裡；完成後會自動移到「已封存」。',
    'work-journal': '工作日誌會集中記錄日常工作與處理進度，方便日後追蹤與交接。',
    'finance': '財務相關工作與資料會依目前帳號權限集中顯示在這裡。',
    'committee': '管理委員會相關資料與工作會集中顯示在這裡。',
    'residents': '住戶相關資料與工作會依目前帳號權限顯示在這裡。',
    'vendors': '廠商聯繫與合作資料會集中顯示在這裡，方便查詢與後續處理。',
    'handover': '交接相關工作集中在這裡；完成後不會一直顯示在工作台首頁。',
    'company-resources': '公司提供的文件、資源與工作資訊會集中顯示在這裡。',
    'shift': '班表與勤務相關工作會集中顯示在這裡。',
    'finance-income': '收入報表相關資料會依目前帳號權限顯示在這裡。',
    'finance-payable': '支出與應付相關資料會依目前帳號權限顯示在這裡。',
    'committee-current': '本屆管理委員會相關資料會集中顯示在這裡。',
    'committee-monthly': '管理委員會月例會相關資料會集中顯示在這裡。',
    'committee-owners': '區分所有權人會議相關資料會集中顯示在這裡。',
    'residents-contact': '住戶聯繫相關資料會集中顯示在這裡。',
    'residents-owners': '區分所有權人相關資料會集中顯示在這裡。',
    'residents-tenants': '承租人相關資料會集中顯示在這裡。',
    'vendors-maintenance': '簽約保養廠商相關資料會集中顯示在這裡。',
    'vendors-general': '一般廠商相關資料會集中顯示在這裡。',
    'vendors-special': '特約廠商相關資料會集中顯示在這裡。',
    'handover-manager': '經理交接清冊相關工作會集中顯示在這裡。',
    'handover-secretary': '秘書交接清冊相關工作會集中顯示在這裡。'
  }
};
const DEFAULT_ADMIN_MENU = [
  {id:'platform-rules',parentId:null,icon:'⚙️',label:'平台規則與設定',action:'platform-rules',enabled:true},
  {id:'platform-rules-schedule',parentId:'platform-rules',icon:'↳',label:'班表與排班規則',action:'platform-rules-schedule',enabled:true},
  {id:'platform-rules-attendance',parentId:'platform-rules',icon:'↳',label:'出勤與巡邏規則',action:'platform-rules-attendance',enabled:true}
];
const DEFAULT_PLATFORM_RULES = {
  schemaVersion: 1,
  schedule: {
    max_consecutive: 6,
    cross_month_check: true,
    overflow_action: 'auto_reschedule',
    holiday_source: 'taiwan_government_calendar',
    security: {rest_days: 6, self_select_days: 2, max_consecutive: 6, shift: 'day'},
    mobile: {rest_days: 6, self_select_days: 2, max_consecutive: 6},
    admin: {
      manager: {mode: 'red_holiday', rest_days: 8},
      secretary: {mode: 'rotation', rest_days: 8}
    }
  },
  attendance: {
    enabled: true,
    gps_checkin_enabled: true,
    default_checkin_radius_m: 100,
    max_gps_accuracy_m: 150,
    patrol_enabled: true,
    patrol_qr_enabled: true,
    patrol_qr_radius_m: 30,
    gps_log_enabled: true,
    offline_queue_enabled: true,
    offline_sync_enabled: true
  },
  updated_at: '',
  updated_by: 'system'
};
function cloneJson(x){ return JSON.parse(JSON.stringify(x)); }
function mergePlatformRules(base, incoming){
  const out=cloneJson(base);
  const src=incoming&&typeof incoming==='object'?incoming:{};
  if(src.schedule&&typeof src.schedule==='object'){
    for(const k of ['max_consecutive','cross_month_check','overflow_action','holiday_source']) if(src.schedule[k]!==undefined) out.schedule[k]=src.schedule[k];
    for(const role of ['security','mobile']) if(src.schedule[role]&&typeof src.schedule[role]==='object') out.schedule[role]={...out.schedule[role],...src.schedule[role]};
    if(src.schedule.admin&&typeof src.schedule.admin==='object') for(const role of ['manager','secretary']) if(src.schedule.admin[role]&&typeof src.schedule.admin[role]==='object') out.schedule.admin[role]={...out.schedule.admin[role],...src.schedule.admin[role]};
  }
  if(src.attendance&&typeof src.attendance==='object') out.attendance={...out.attendance,...src.attendance};
  out.schemaVersion=2; return out;
}
function readPlatformRules(){
  let saved={};
  try{if(fs.existsSync(PLATFORM_RULES_PATH)) saved=JSON.parse(fs.readFileSync(PLATFORM_RULES_PATH,'utf-8'));}catch(e){console.error('platform rules read error',e);}
  const rules=mergePlatformRules(DEFAULT_PLATFORM_RULES,saved);
  if(!rules.updated_at){rules.updated_at=now();rules.updated_by='system';try{fs.writeFileSync(PLATFORM_RULES_PATH,JSON.stringify(rules,null,2),'utf-8');}catch{}}
  return rules;
}
function writePlatformRules(input, actor='system'){
  const current=readPlatformRules();
  const next=mergePlatformRules(current,input);
  next.updated_at=now(); next.updated_by=String(actor||'super_admin');
  let history=[];
  try{if(fs.existsSync(PLATFORM_RULES_HISTORY_PATH)) history=JSON.parse(fs.readFileSync(PLATFORM_RULES_HISTORY_PATH,'utf-8'));}catch{}
  if(!Array.isArray(history)) history=[];
  history.unshift({version:history.length+1,updated_at:next.updated_at,updated_by:next.updated_by,rules:cloneJson(next)});
  history=history.slice(0,50);
  fs.writeFileSync(PLATFORM_RULES_PATH,JSON.stringify(next,null,2),'utf-8');
  fs.writeFileSync(PLATFORM_RULES_HISTORY_PATH,JSON.stringify(history,null,2),'utf-8');
  return next;
}
for (const dir of [TEMPLATES_DIR, SOPS_DIR, GENERATED_DIR, RESIDENT_IMPORTS_DIR]) fs.mkdirSync(dir, { recursive: true });

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
function requireStaffSopUser(req,res,next){ const u=getUser(req); const t=u?.tenant_id?db.prepare('SELECT status FROM tenants WHERE id=?').get(u.tenant_id):null; if(u && u.is_active && u.tenant_id && t?.status==='active' && u.role!=='company_admin' && (hasSiteAccess(u)||isSiteManager(u))) return next(); return res.status(403).json({error:'只有有效的公司人員或駐點人員可以使用案場 SOP'}); }
function hasSiteAccess(u){ if(!u||!u.tenant_id||u.role==='company_admin') return false; return db.prepare("SELECT 1 FROM staff_communities sc JOIN communities c ON c.id=sc.community_id WHERE sc.staff_id=? AND c.tenant_id=? AND c.status='active' LIMIT 1").get(u.id,u.tenant_id) || db.prepare("SELECT 1 FROM staff_work_assignments a JOIN communities c ON c.id=a.community_id WHERE a.staff_id=? AND a.tenant_id=? AND a.scope_type='site' AND c.status='active' LIMIT 1").get(u.id,u.tenant_id); }
function hasCompanyAccess(u){ return !!u && (u.role==='company_admin' || ['internal','hybrid'].includes(u.work_type||'')); }
function requireCompanyAdmin(req,res,next){ const u=getUser(req); const t=u?.tenant_id?db.prepare('SELECT status FROM tenants WHERE id=?').get(u.tenant_id):null; if(u && u.is_active && u.tenant_id && t?.status==='active' && hasCompanyAccess(u)) return next(); return res.status(403).json({error:'這個帳號沒有公司內部後台權限'}); }
function requireCompanyPermission(key){ return (req,res,next)=>{ const u=getUser(req); if(u?.role==='company_admin') return next(); const a=getCompanyAssignment(u); if(effectivePermissions(u).includes(key)) return next(); return res.status(403).json({error:'您目前沒有這項公司內部功能的權限'}); }; }
function isCompanyRequest(req){ return String(req.path||'').startsWith('/api/company/'); }
function isStaffRequest(req){ return String(req.path||'').startsWith('/api/staff/'); }
function getScopedSessionUserId(req){
  if(isCompanyRequest(req)) return req.session?.companyUserId || (req.session?.entry==='company'?req.session?.userId:null);
  if(isStaffRequest(req)) return req.session?.staffUserId || (req.session?.entry==='staff'?req.session?.userId:null);
  return req.session?.userId || req.session?.companyUserId || req.session?.staffUserId || null;
}
function tenantId(req){
  if(isCompanyRequest(req)) return Number(req.session?.companyTenantId || (req.session?.entry==='company'?req.session?.tenantId:0));
  if(isStaffRequest(req)) return Number(req.session?.staffTenantId || (req.session?.entry==='staff'?req.session?.tenantId:0));
  return Number(req.session?.tenantId || req.session?.companyTenantId || req.session?.staffTenantId || 0);
}
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
function readJsonObject(filePath){
  try{if(fs.existsSync(filePath))return JSON.parse(fs.readFileSync(filePath,'utf-8'))||{};}catch(e){console.error('ui copy read error:',e);}
  return {};
}
function readPlatformUiCopy(){
  const saved=readJsonObject(PLATFORM_UI_COPY_PATH);
  return {...DEFAULT_STAFF_UI_COPY,...saved,moduleDescriptions:{...DEFAULT_STAFF_UI_COPY.moduleDescriptions,...(saved.moduleDescriptions||{})}};
}
function writePlatformUiCopy(copy){
  const current=readPlatformUiCopy();
  const merged={...current,...copy,moduleDescriptions:{...current.moduleDescriptions,...(copy.moduleDescriptions||{})}};
  fs.writeFileSync(PLATFORM_UI_COPY_PATH,JSON.stringify(merged,null,2),'utf-8');
  return merged;
}
function readStaffUiCopy(tenantIdValue){
  // 現階段所有公司共用「平台預設前台自述」。保留舊的公司版資料檔，供未來真正啟用客製覆寫時使用。
  return readPlatformUiCopy();
}
function writeStaffUiCopy(tenantIdValue,copy){
  let all=readJsonObject(STAFF_UI_COPY_PATH);
  const current=readStaffUiCopy(tenantIdValue);
  all[String(tenantIdValue)]={...current,...copy,moduleDescriptions:{...current.moduleDescriptions,...(copy.moduleDescriptions||{})}};
  fs.writeFileSync(STAFF_UI_COPY_PATH,JSON.stringify(all,null,2),'utf-8');
  return all[String(tenantIdValue)];
}
function sanitizeStaffUiCopy(body,tenantIdValue){
  const current=readStaffUiCopy(tenantIdValue), out={};
  for(const key of Object.keys(DEFAULT_STAFF_UI_COPY)){
    if(key==='moduleDescriptions')continue;
    const v=String(body?.[key]??current[key]??'').trim();
    out[key]=v.slice(0,1000);
  }
  out.moduleDescriptions={};
  const incoming=body?.moduleDescriptions&&typeof body.moduleDescriptions==='object'?body.moduleDescriptions:{};
  for(const key of Object.keys(DEFAULT_STAFF_UI_COPY.moduleDescriptions)){
    const v=String(incoming[key]??current.moduleDescriptions?.[key]??DEFAULT_STAFF_UI_COPY.moduleDescriptions[key]??'').trim();
    out.moduleDescriptions[key]=v.slice(0,1000);
  }
  return out;
}
function sanitizePlatformUiCopy(body){
  const current=readPlatformUiCopy(), out={};
  for(const key of Object.keys(DEFAULT_STAFF_UI_COPY)){
    if(key==='moduleDescriptions')continue;
    const v=String(body?.[key]??current[key]??'').trim();
    out[key]=v.slice(0,1000);
  }
  out.moduleDescriptions={};
  const incoming=body?.moduleDescriptions&&typeof body.moduleDescriptions==='object'?body.moduleDescriptions:{};
  for(const key of Object.keys(DEFAULT_STAFF_UI_COPY.moduleDescriptions)){
    const v=String(incoming[key]??current.moduleDescriptions?.[key]??DEFAULT_STAFF_UI_COPY.moduleDescriptions[key]??'').trim();
    out.moduleDescriptions[key]=v.slice(0,1000);
  }
  return out;
}
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
const PLATFORM_STAFF_SCHEDULE_MENU = [
  {id:'staff-schedule',parentId:null,icon:'📅',label:'班表',action:'staff-schedule',enabled:true},
  {id:'staff-schedule-rules',parentId:'staff-schedule',icon:'↳',label:'排班表',action:'staff-schedule-rules',enabled:true},
  {id:'staff-schedule-leave',parentId:'staff-schedule',icon:'↳',label:'請假／代班',action:'staff-schedule-leave',enabled:true},
  {id:'staff-schedule-overtime',parentId:'staff-schedule',icon:'↳',label:'加班',action:'staff-schedule-overtime',enabled:true}
];
const PLATFORM_COMPANY_SCHEDULE_MENU = [
  {id:'company-schedule',parentId:null,icon:'📅',label:'班表',action:'schedule',enabled:true},
  {id:'company-schedule-month',parentId:'company-schedule',icon:'↳',label:'月班表',action:'schedule-month',enabled:true},
  {id:'company-schedule-staff',parentId:'company-schedule',icon:'↳',label:'人員班表',action:'schedule-staff',enabled:true},
  {id:'company-schedule-community',parentId:'company-schedule',icon:'↳',label:'社區班表',action:'schedule-community',enabled:true},
  {id:'company-schedule-swap',parentId:'company-schedule',icon:'↳',label:'換班紀錄',action:'schedule-swap',enabled:true},
  {id:'company-schedule-leave',parentId:'company-schedule',icon:'↳',label:'請假／代班',action:'schedule-leave',enabled:true},
  {id:'company-schedule-overtime',parentId:'company-schedule',icon:'↳',label:'加班',action:'schedule-overtime',enabled:true}
];
const PLATFORM_STAFF_ATTENDANCE_MENU = [
  {id:'staff-attendance',parentId:null,icon:'📍',label:'出勤與巡邏',action:'staff-attendance',enabled:true}
];
const PLATFORM_COMPANY_ATTENDANCE_MENU = [
  {id:'company-attendance',parentId:null,icon:'📍',label:'出勤與巡邏',action:'attendance',enabled:true},
  {id:'company-attendance-locations',parentId:'company-attendance',icon:'↳',label:'打卡／巡邏點',action:'attendance-locations',enabled:true},
  {id:'company-attendance-records',parentId:'company-attendance',icon:'↳',label:'出勤紀錄',action:'attendance-records',enabled:true},
  {id:'company-patrol-records',parentId:'company-attendance',icon:'↳',label:'巡邏紀錄',action:'patrol-records',enabled:true}
];
function isAttendanceMenuItem(item, scope){
  const id=String(item?.id||'').trim(), action=String(item?.action||'').trim(), label=String(item?.label||'').trim();
  if(scope==='company') return id==='company-attendance'||/^company-attendance(?:-|$)/.test(id)||action==='attendance'||['出勤與巡邏','打卡／巡邏點','出勤紀錄','巡邏紀錄'].includes(label);
  return id==='staff-attendance'||action==='staff-attendance'||label==='出勤與巡邏';
}
function normalizeAttendanceMenu(items, scope){
  const source=Array.isArray(items)?items:[];
  const first=source.findIndex(x=>isAttendanceMenuItem(x,scope));
  const filtered=source.filter(x=>!isAttendanceMenuItem(x,scope));
  const standard=scope==='company'?PLATFORM_COMPANY_ATTENDANCE_MENU:PLATFORM_STAFF_ATTENDANCE_MENU;
  filtered.splice(first<0?filtered.length:first,0,...standard.map(x=>({...x})));
  return filtered;
}
function isScheduleMenuItem(item, scope){
  const id=String(item?.id||'').trim();
  const action=String(item?.action||'').trim();
  const label=String(item?.label||'').trim();
  if(scope==='company') return id==='shift'||action==='shift'||action==='schedule'||/^company-schedule(?:-|$)/.test(id)||['班表','月班表','人員班表','社區班表','換班紀錄','請假／代班','加班'].includes(label);
  return id==='shift'||action==='shift'||action==='staff-schedule'||/^staff-schedule(?:-|$)/.test(id)||['班表','排班表','請假／代班','加班'].includes(label);
}
function normalizeScheduleMenu(items, scope){
  const source=Array.isArray(items)?items:[];
  const first=source.findIndex(x=>isScheduleMenuItem(x,scope));
  const filtered=source.filter(x=>!isScheduleMenuItem(x,scope));
  const standard=scope==='company'?PLATFORM_COMPANY_SCHEDULE_MENU:PLATFORM_STAFF_SCHEDULE_MENU;
  filtered.splice(first<0?filtered.length:first,0,...standard.map(x=>({...x})));
  return filtered;
}
function defaultMenuConfig(){
  const seed=path.join(__dirname,'config','menu-config.json');
  if(fs.existsSync(seed)) return JSON.parse(fs.readFileSync(seed,'utf-8'));
  return {staff:[],company:[]};
}
function readMenuConfig(){
  if(!fs.existsSync(MENU_CONFIG_PATH)) fs.writeFileSync(MENU_CONFIG_PATH,JSON.stringify(defaultMenuConfig(),null,2),'utf-8');
  const c=JSON.parse(fs.readFileSync(MENU_CONFIG_PATH,'utf-8'));
  c.staff=Array.isArray(c.staff)?c.staff:[]; c.company=Array.isArray(c.company)?c.company:[];
  const seedConfig=defaultMenuConfig();
  if(!Array.isArray(c.admin)) c.admin=Array.isArray(seedConfig.admin)?seedConfig.admin.map(x=>({...x})):DEFAULT_ADMIN_MENU.map(x=>({...x}));
  // 平台規則中心標準化：保留既有目錄，只在缺少時補上出勤與巡邏規則。
  if(!c.admin.some(x=>String(x.id)==='platform-rules')) c.admin.push({...DEFAULT_ADMIN_MENU[0]});
  if(!c.admin.some(x=>String(x.id)==='platform-rules-schedule')) c.admin.push({...DEFAULT_ADMIN_MENU[1]});
  if(!c.admin.some(x=>String(x.id)==='platform-rules-attendance')) c.admin.push({id:'platform-rules-attendance',parentId:'platform-rules',icon:'↳',label:'出勤與巡邏規則',action:'platform-rules-attendance',enabled:true});
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
    // 班表例外：目前仍在產品測試期，班表已正式成為平台標準模組；每次啟動都
    // 將平台預設與既有公司中的班表項目標準化，確保不會重複或缺漏。
    const beforeStaff=JSON.stringify(c.staff), beforeCompany=JSON.stringify(c.company);
    c.staff=normalizeScheduleMenu(c.staff,'staff');
    c.company=normalizeScheduleMenu(c.company,'company');
    const beforeAttendanceStaff=JSON.stringify(c.staff), beforeAttendanceCompany=JSON.stringify(c.company);
    c.staff=normalizeAttendanceMenu(c.staff,'staff');
    c.company=normalizeAttendanceMenu(c.company,'company');
    let menuChanged=(beforeStaff!==JSON.stringify(c.staff)||beforeCompany!==JSON.stringify(c.company)||beforeAttendanceStaff!==JSON.stringify(c.staff)||beforeAttendanceCompany!==JSON.stringify(c.company));
    for(const t of tenantRows){
      const key=String(t.id);
      c.tenants[key]=c.tenants[key]||{};
      const nextStaff=normalizeAttendanceMenu(normalizeScheduleMenu(c.tenants[key].staff||c.staff,'staff'),'staff');
      const nextCompany=normalizeAttendanceMenu(normalizeScheduleMenu(c.tenants[key].company||c.company,'company'),'company');
      if(JSON.stringify(c.tenants[key].staff||[])!==JSON.stringify(nextStaff)||JSON.stringify(c.tenants[key].company||[])!==JSON.stringify(nextCompany)) menuChanged=true;
      c.tenants[key].staff=nextStaff;
      c.tenants[key].company=nextCompany;
    }
    c._schedulePlatformVersion=2;
    if(changed||menuChanged) writeMenuConfig(c);
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
const STAFF_PERMISSION_DEFAULTS=['todo','work-journal','finance','committee','residents','vendors','handover','company-resources','schedule','attendance'];
const STAFF_PERMISSION_LABELS={
  'todo':'代辦事項','work-journal':'工作日誌','finance':'財務／會計','committee':'管理委員會','residents':'住戶名冊','vendors':'廠商聯繫','handover':'交接清冊','company-resources':'公司資源',
  'manage-staff':'公司人員管理','manage-communities':'社區管理','view-submissions':'交接紀錄','manage-templates':'公司文件／範本','manage-sop':'案場 SOP 管理','sop':'案場 SOP','schedule':'班表','attendance':'出勤與巡邏',
  'company-work-journal':'工作日誌管理','company-accounting':'會計','company-general-affairs':'總務管理','company-personnel':'人員','company-finance':'公司財務','company-hr':'人事管理','company-new-record':'新日錄'
};
const COMPANY_PERMISSION_KEYS=new Set(['finance','company-resources','manage-staff','manage-communities','view-submissions','manage-templates','manage-sop','work-journal','company-work-journal','company-accounting','company-general-affairs','company-personnel','company-finance','company-hr','company-new-record','schedule','attendance']);
const SITE_PERMISSION_KEYS=new Set(['todo','work-journal','finance','committee','residents','vendors','handover','company-resources','sop','schedule','attendance']);
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
  if(['internal','hybrid'].includes(u?.work_type||'')) out.add('schedule');
  if((u?.work_type||'site')!=='internal' && (has('社區管理')||has('秘書')||has('保全')||has('機動'))) {['todo','work-journal','committee','residents','vendors','handover'].forEach(x=>out.add(x));out.add('schedule');out.add('attendance');}
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
  // 班表與人員管理資料同步：職務／案場異動後，班表身分與支援社區立即跟著更新。
  try{ if(typeof scheduleSyncProfileFromStaff==='function') scheduleSyncProfileFromStaff(tenantIdValue,staffId); }catch(e){ console.error('schedule profile sync error:',e); }
}
function menuPermissionKey(item,scope='staff'){
  const raw=`${item?.id||''} ${item?.action||''} ${item?.label||''}`.toLowerCase();
  // SOP 在公司後台與現場工作台是兩種不同權限；不能讓「案場 SOP」被誤判成公司 SOP 管理。
  if(scope==='staff' && (String(item?.action||'')==='sop'||String(item?.action||'')==='sop-admin'||String(item?.action||'')==='sop-duty'||String(item?.action||'')==='sop-company'||String(item?.action||'')==='sop-community')) return 'sop';
  if(scope==='company' && (String(item?.action||'')==='sop'||String(item?.id||'')==='company-sop')) return 'manage-sop';
  const rules=[
    ['manage-staff',['staff','人員管理','公司人員']],['attendance',['attendance','出勤與巡邏','打卡','巡邏']],['manage-communities',['communities','社區管理']],['view-submissions',['submissions','交接紀錄']],['manage-templates',['templates','公司文件','範本']],['manage-sop',['manage-sop']],['schedule',['schedule','班表']],
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
      // 經理不論內勤或駐點，都可以進入案場 SOP；上傳權限由 SOP API 再次驗證。
      if(scope==='staff' && key==='sop' && isSiteManager(staffUser)) return true;
      if(scope==='staff' && key==='schedule' && ['admin','security','mobile'].includes(scheduleDefaultRole(staffUser))) return true;
      if(scope==='staff' && key==='attendance' && hasSiteAccess(staffUser)) return true;
      if(scope==='staff' && key==='residents') return true;
      return selected.has(key) || (item.parentId && selected.has(menuPermissionKey(items.find(x=>String(x.id)===String(item.parentId)),scope)||''));
    });
    if(scope==='staff'){
      const role=scheduleDefaultRole(staffUser);
      if(role!=='admin') items=items.filter(x=>!['staff-schedule-rules','staff-schedule-leave','staff-schedule-overtime'].includes(String(x.id)));
    }
  }
  return items;
}


function readQuestions(){return readFormConfig().questions;}
function cleanData(data){ return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {}; }
function now(){return new Date().toISOString();}
function getUser(req){
  const scopedId=getScopedSessionUserId(req);
  if(scopedId) return db.prepare('SELECT * FROM staff_users WHERE id=?').get(Number(scopedId));
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
  const eligible=matches.filter(u=> loginEntry==='company' ? hasCompanyAccess(u) : (hasSiteAccess(u) || isSiteManager(u)));
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
app.get('/api/staff/menu-config',requireStaff,(req,res)=>{
  const u=getUser(req);
  let items=resolveMenu('staff',tenantId(req),u);
  const role=scheduleGetProfile(tenantId(req),u.id)?.schedule_role||scheduleDefaultRole(u);
  if(role!=='admin') items=items.filter(x=>!['staff-schedule-rules','staff-schedule-leave','staff-schedule-overtime'].includes(String(x.id)));
  res.json({scope:'staff',items});
});
app.get('/api/company/menu-config',requireCompanyAdmin,(req,res)=>res.json({scope:'company',items:resolveMenu('company',tenantId(req),getUser(req))}));
app.get('/admin', (req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.set('Expires','0');res.sendFile(path.join(__dirname,'public','admin.html'));});
app.get('/admin.html', (req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.set('Expires','0');res.sendFile(path.join(__dirname,'public','admin.html'));});
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
    if(!['staff','company','admin'].includes(scope)) return res.status(400).json({error:'目錄類型不正確'});
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
  if(entry==='staff' && user.role!=='company_admin' && !(hasSiteAccess(user) || isSiteManager(user))) return res.status(403).json({error:'此帳號目前沒有可用的工作身分。'});
  if(entry==='company' && user.role!=='company_admin' && !hasCompanyAccess(user)) return res.status(403).json({error:'此帳號目前沒有公司內勤權限。'});
  const loginScope=loginEntry;
  if(loginScope==='company'){
    req.session.companyUserId=user.id; req.session.companyEmployeeId=user.employee_id; req.session.companyTenantId=user.tenant_id;
  }else{
    req.session.staffUserId=user.id; req.session.staffEmployeeId=user.employee_id; req.session.staffEmployeeName=user.name; req.session.staffTenantId=user.tenant_id;
  }
  // 保留舊欄位給尚未分流的舊 API；新的 /api/company/*、/api/staff/* 會優先使用各自登入身分。
  req.session.userId=user.id; req.session.entry=entry||'staff'; req.session.employeeId=user.employee_id; req.session.employeeName=user.name; req.session.tenantId=user.tenant_id; req.session.role=user.role||'staff';
  db.prepare('UPDATE staff_users SET last_login_at=? WHERE id=?').run(now(),user.id);
  res.json({success:true,user:{id:user.id,employee_id:user.employee_id,name:user.name,role:user.role||'staff',admin_level:user.admin_level||'admin',tenant_id:user.tenant_id,tenant_name:user.tenant_name,tenant_code:user.tenant_code,position:user.position||'',work_type:user.work_type||'site',job_category:user.job_category||'',job_level:user.job_level||'',permissions:parsePermissions(user),job_categories:getJobCategories(user),site_assignments:getSiteAssignments(user),company_assignment:getCompanyAssignment(user)}});
});
app.post('/api/staff/logout',(req,res)=>{
  delete req.session.staffUserId; delete req.session.staffEmployeeId; delete req.session.staffEmployeeName; delete req.session.staffTenantId;
  if(req.session.entry==='staff'){req.session.userId=null;req.session.employeeId=null;req.session.employeeName=null;req.session.tenantId=null;req.session.role=null;req.session.entry=req.session.companyUserId?'company':'';}
  req.session.save(()=>res.json({success:true}));
});
app.post('/api/company/logout',(req,res)=>{
  delete req.session.companyUserId; delete req.session.companyEmployeeId; delete req.session.companyTenantId;
  if(req.session.entry==='company'){req.session.userId=null;req.session.employeeId=null;req.session.employeeName=null;req.session.tenantId=null;req.session.role=null;req.session.entry=req.session.staffUserId?'staff':'';}
  req.session.save(()=>res.json({success:true}));
});
app.get('/api/staff/session',(req,res)=>{
  const u=getUser(req); if(!u || !u.is_active || !u.tenant_id) return res.json({loggedIn:false});
  const t=db.prepare('SELECT * FROM tenants WHERE id=?').get(u.tenant_id); if(!t || t.status!=='active') return res.json({loggedIn:false});
  res.json({loggedIn:true,entry:req.session.entry||'staff',user:{id:u.id,employee_id:u.employee_id,name:u.name,position:u.position||'',job_category:u.job_category||'',job_level:u.job_level||'',work_type:u.work_type||'site',permissions:effectivePermissions(u),job_categories:getJobCategories(u),schedule_role:scheduleDefaultRole(u),schedule_profile:scheduleGetProfile(u.tenant_id,u.id),site_assignments:getSiteAssignments(u),company_assignment:getCompanyAssignment(u),trial_end_date:u.trial_end_date||'',formal_salary:u.formal_salary||'',insurance_level:u.insurance_level||'',health_dependents:Number(u.health_dependents||0),role:u.role||'staff',tenant_id:u.tenant_id,tenant_name:t.name}});
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

// ===== 公司系統白標／美編 =====
app.get('/api/admin/tenants/:id/branding',requireSuperAdmin,(req,res)=>{const row=db.prepare('SELECT * FROM tenants WHERE id=?').get(Number(req.params.id));if(!row)return res.status(404).json({error:'找不到公司'});res.json(sanitizeBranding(row));});
app.put('/api/admin/tenants/:id/branding',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);const row=db.prepare('SELECT * FROM tenants WHERE id=?').get(id);if(!row)return res.status(404).json({error:'找不到公司'});const b=req.body||{};const v={title:String(b.title||'').trim(),subtitle:String(b.subtitle||'').trim(),loginTitle:String(b.loginTitle||'').trim(),loginHint:String(b.loginHint||'').trim(),intro:String(b.intro||'').trim(),logoText:String(b.logoText||'').trim(),accent:validHex(b.accent,'#2F6F5E'),accentDark:validHex(b.accentDark,'#204F42'),bg:validHex(b.bg,'#F7F7F4'),panel:validHex(b.panel,'#FFFFFF')};if(!v.title)return res.status(400).json({error:'系統名稱不可空白'});db.prepare('UPDATE tenants SET brand_title=?,brand_subtitle=?,brand_login_title=?,brand_login_hint=?,brand_intro=?,brand_logo_text=?,brand_accent=?,brand_accent_dark=?,brand_bg=?,brand_panel=?,updated_at=? WHERE id=?').run(v.title,v.subtitle,v.loginTitle,v.loginHint,v.intro,v.logoText,v.accent,v.accentDark,v.bg,v.panel,now(),id);res.json({success:true,branding:{tenant_id:id,...v}});});
app.get('/api/admin/ui-copy',requireSuperAdmin,(req,res)=>res.json({scope:'platform',copy:readPlatformUiCopy()}));
app.put('/api/admin/ui-copy',requireSuperAdmin,(req,res)=>{const copy=sanitizePlatformUiCopy(req.body||{});const saved=writePlatformUiCopy(copy);res.json({success:true,scope:'platform',copy:saved});});
app.get('/api/admin/tenants/:id/ui-copy',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(id))return res.status(404).json({error:'找不到公司'});res.json({tenant_id:id,copy:readStaffUiCopy(id)});});
app.put('/api/admin/tenants/:id/ui-copy',requireSuperAdmin,(req,res)=>{const id=Number(req.params.id);if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(id))return res.status(404).json({error:'找不到公司'});const copy=sanitizeStaffUiCopy(req.body||{},id);writeStaffUiCopy(id,copy);res.json({success:true,tenant_id:id,copy});});

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

app.get('/api/admin/platform-rules',requireSuperAdmin,(req,res)=>{
  res.json({scope:'platform',rules:readPlatformRules()});
});
app.put('/api/admin/platform-rules',requireSuperAdmin,(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const s=body.schedule&&typeof body.schedule==='object'?body.schedule:{};
    const max=Math.max(1,Math.min(31,Number(s.max_consecutive||6)));
    const overflow=['auto_reschedule','warn_only','block_generation'].includes(String(s.overflow_action))?String(s.overflow_action):'auto_reschedule';
    const a=body.attendance&&typeof body.attendance==='object'?body.attendance:{};
    const next={schedule:{
      max_consecutive:max,
      cross_month_check:body.schedule?.cross_month_check!==false,
      overflow_action:overflow,
      holiday_source:'taiwan_government_calendar',
      security:{rest_days:Math.max(0,Math.min(31,Number(s.security?.rest_days??6))),self_select_days:Math.max(0,Math.min(31,Number(s.security?.self_select_days??2))),max_consecutive:Math.max(1,Math.min(31,Number(s.security?.max_consecutive??max))),shift:['day','night'].includes(String(s.security?.shift))?String(s.security.shift):'day'},
      mobile:{rest_days:Math.max(0,Math.min(31,Number(s.mobile?.rest_days??6))),self_select_days:Math.max(0,Math.min(31,Number(s.mobile?.self_select_days??2))),max_consecutive:Math.max(1,Math.min(31,Number(s.mobile?.max_consecutive??max)))},
      admin:{manager:{mode:['red_holiday','rotation','fixed_monthly'].includes(String(s.admin?.manager?.mode))?String(s.admin.manager.mode):'red_holiday',rest_days:Math.max(0,Math.min(31,Number(s.admin?.manager?.rest_days??8)))},secretary:{mode:['red_holiday','rotation','fixed_monthly'].includes(String(s.admin?.secretary?.mode))?String(s.admin.secretary.mode):'rotation',rest_days:Math.max(0,Math.min(31,Number(s.admin?.secretary?.rest_days??8)))}}
    },attendance:{
      enabled:a.enabled!==false, gps_checkin_enabled:a.gps_checkin_enabled!==false,
      default_checkin_radius_m:Math.max(20,Math.min(1000,Number(a.default_checkin_radius_m??100))),
      max_gps_accuracy_m:Math.max(10,Math.min(500,Number(a.max_gps_accuracy_m??150))),
      patrol_enabled:a.patrol_enabled!==false, patrol_qr_enabled:a.patrol_qr_enabled!==false,
      patrol_qr_radius_m:Math.max(5,Math.min(200,Number(a.patrol_qr_radius_m??30))),
      gps_log_enabled:a.gps_log_enabled!==false, offline_queue_enabled:a.offline_queue_enabled!==false, offline_sync_enabled:a.offline_sync_enabled!==false
    }};
    const saved=writePlatformRules(next,`super_admin:${ADMIN_USER}`);
    res.json({success:true,rules:saved});
  }catch(e){res.status(400).json({error:e.message||'平台規則儲存失敗'});}
});
app.get('/api/admin/platform-rules/history',requireSuperAdmin,(req,res)=>{
  let history=[];try{if(fs.existsSync(PLATFORM_RULES_HISTORY_PATH)) history=JSON.parse(fs.readFileSync(PLATFORM_RULES_HISTORY_PATH,'utf-8'));}catch{}
  res.json({history:Array.isArray(history)?history:[]});
});

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
app.get('/api/staff/ui-copy',requireStaff,(req,res)=>{const row=getTenant(req);if(!row)return res.status(404).json({error:'找不到公司'});res.json({copy:readStaffUiCopy(row.id)});});
app.get('/api/company/session',requireCompanyAdmin,(req,res)=>{const u=getUser(req);res.json({loggedIn:true,entry:req.session.entry||'company',user:{employee_id:u.employee_id,name:u.name,admin_level:u.admin_level||'staff',role:u.role,work_type:u.work_type||'internal',permissions:effectivePermissions(u),job_categories:getJobCategories(u)},tenant:getTenant(req)});});
app.get('/api/company/admins',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const rows=db.prepare("SELECT id,employee_id,name,is_active,admin_level,last_login_at,created_at,updated_at FROM staff_users WHERE tenant_id=? AND role='company_admin' ORDER BY admin_level='owner' DESC,id").all(tenantId(req));res.json({admins:rows,current_user_id:getUser(req).id,current_admin_level:getUser(req).admin_level||'admin'});});
app.post('/api/company/admins',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const me=getUser(req);if((me.admin_level||'admin')!=='owner')return res.status(403).json({error:'只有公司負責人可以新增公司管理員。一般公司管理員仍可開通總務、會計等一般人員帳號。'});const employeeId=String(req.body?.employee_id||'').trim();const name=String(req.body?.name||'').trim();const password=String(req.body?.password||'');if(!employeeId||!name||password.length<4)return res.status(400).json({error:'請填寫員編、姓名，且密碼至少 4 碼'});if(db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tenantId(req),employeeId))return res.status(400).json({error:'這家公司已經有相同員編'});const p=db.makePassword(password);const t=now();const info=db.prepare('INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,admin_level) VALUES (?,?,?,?,1,?,?,?,?,?)').run(employeeId,name,p.hash,p.salt,t,t,'company_admin',tenantId(req),'admin');res.json({success:true,id:info.lastInsertRowid});});
app.put('/api/company/admins/:id',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const me=getUser(req);if((me.admin_level||'admin')!=='owner')return res.status(403).json({error:'只有公司負責人可以管理其他公司管理員'});const id=Number(req.params.id);const u=db.prepare("SELECT * FROM staff_users WHERE id=? AND tenant_id=? AND role='company_admin'").get(id,tenantId(req));if(!u)return res.status(404).json({error:'找不到公司管理員'});const name=String(req.body?.name||u.name).trim();const active=req.body?.is_active===undefined?!!u.is_active:!!req.body.is_active;const password=String(req.body?.password||'');if(!name)return res.status(400).json({error:'姓名不可空白'});if(u.admin_level==='owner'&&!active)return res.status(400).json({error:'不能停用公司負責人'});const t=now();if(password){if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const p=db.makePassword(password);db.prepare('UPDATE staff_users SET name=?,is_active=?,password_hash=?,password_salt=?,updated_at=? WHERE id=? AND tenant_id=?').run(name,active?1:0,p.hash,p.salt,t,id,tenantId(req));}else db.prepare('UPDATE staff_users SET name=?,is_active=?,updated_at=? WHERE id=? AND tenant_id=?').run(name,active?1:0,t,id,tenantId(req));res.json({success:true});});
app.get('/api/company/staff',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const rows=db.prepare(`SELECT id,employee_id,name,is_active,role,admin_level,position,job_category,job_level,work_type,job_categories_json,permission_json,person_uid,person_status,created_at,updated_at FROM staff_users WHERE tenant_id=? ORDER BY role DESC,admin_level='owner' DESC,is_active DESC,employee_id`).all(tenantId(req));res.json(rows.map(r=>({...r,permissions:effectivePermissions(r),job_categories:getJobCategories(r)})));});
app.post('/api/company/staff',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const employeeId=String(req.body?.employee_id||'').trim();const name=String(req.body?.name||'').trim();const password=String(req.body?.password||'');const workType=['site','internal','hybrid'].includes(req.body?.work_type)?req.body.work_type:'site';const jobCategories=Array.isArray(req.body?.job_categories)?req.body.job_categories.map(String).filter(Boolean):String(req.body?.job_category||'').trim()?[String(req.body.job_category).trim()]:[];const jobLevel=String(req.body?.job_level||'').trim();const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.map(String).filter(Boolean):STAFF_PERMISSION_DEFAULTS.slice();const communityIds=Array.isArray(req.body?.community_ids)?req.body.community_ids.map(Number).filter(Boolean):[];if(!employeeId)return res.status(400).json({error:'請填寫員編。'});if(!name)return res.status(400).json({error:'請填寫姓名。姓名不限制字數。'});if(password.length<4)return res.status(400).json({error:`初始密碼至少 4 碼，目前收到 ${password.length} 碼。`});if(!jobCategories.length)return res.status(400).json({error:'至少選擇一個職務類別'});if(!jobLevel)return res.status(400).json({error:'請選擇職務位階'});if(workType!=='internal'&&!communityIds.length)return res.status(400).json({error:'駐點／兼任駐點人員至少要勾選一個案場'});if(db.prepare('SELECT id FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tenantId(req),employeeId))return res.status(400).json({error:'這家公司目前已有相同員編的啟用帳號'});const valid=new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tenantId(req)).map(x=>x.id));if(communityIds.some(x=>!valid.has(x)))return res.status(400).json({error:'包含不屬於本公司的啟用案場'});const p=db.makePassword(password);const t=now();const position=`${jobLevel}${jobCategories.length?'｜'+jobCategories.join('、'):''}`;const info=db.prepare('INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,position,work_type,job_category,job_level,job_categories_json,permission_json,person_uid,person_status) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)').run(employeeId,name,p.hash,p.salt,t,t,'staff',tenantId(req),position,workType,jobCategories[0],jobLevel,JSON.stringify(jobCategories),JSON.stringify(permissions),'P'+String(Date.now()),'active');syncWorkAssignments(info.lastInsertRowid,tenantId(req),workType,communityIds,jobCategories,jobLevel,permissions);res.json({success:true,id:info.lastInsertRowid});});
app.put('/api/company/staff/:id',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const id=Number(req.params.id);const u=db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!u)return res.status(404).json({error:'找不到人員'});if(u.role==='company_admin'&&u.id!==getUser(req).id)return res.status(400).json({error:'公司管理員請由公司負責人管理'});const name=String(req.body?.name||u.name).trim();const active=req.body?.is_active===undefined?!!u.is_active:!!req.body.is_active;const password=String(req.body?.password||'');const workType=['site','internal','hybrid'].includes(req.body?.work_type)?req.body.work_type:(u.work_type||'site');const jobCategories=Array.isArray(req.body?.job_categories)?req.body.job_categories.map(String).filter(Boolean):String(req.body?.job_category||u.job_category||'').trim()?[String(req.body?.job_category||u.job_category).trim()]:getJobCategories(u);const jobLevel=String(req.body?.job_level===undefined?(u.job_level||''):req.body.job_level).trim();const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.map(String).filter(Boolean):parsePermissions(u);const communityIds=Array.isArray(req.body?.community_ids)?req.body.community_ids.map(Number).filter(Boolean):getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean);if(!name)return res.status(400).json({error:'姓名不可空白'});if(!jobCategories.length)return res.status(400).json({error:'至少選擇一個職務類別'});if(!jobLevel)return res.status(400).json({error:'請選擇職務位階'});if(workType!=='internal'&&!communityIds.length)return res.status(400).json({error:'駐點／兼任駐點人員至少要勾選一個案場'});const valid=new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tenantId(req)).map(x=>x.id));if(communityIds.some(x=>!valid.has(x)))return res.status(400).json({error:'包含不屬於本公司的啟用案場'});const position=`${jobLevel}｜${jobCategories.join('、')}`;const t=now();if(password){if(password.length<4)return res.status(400).json({error:'新密碼至少 4 碼'});const p=db.makePassword(password);db.prepare("UPDATE staff_users SET name=?,is_active=?,password_hash=?,password_salt=?,position=?,work_type=?,job_category=?,job_level=?,job_categories_json=?,permission_json=?,person_status='active',updated_at=? WHERE id=? AND tenant_id=?").run(name,active?1:0,p.hash,p.salt,position,workType,jobCategories[0],jobLevel,JSON.stringify(jobCategories),JSON.stringify(permissions),t,id,tenantId(req));}else db.prepare("UPDATE staff_users SET name=?,is_active=?,position=?,work_type=?,job_category=?,job_level=?,job_categories_json=?,permission_json=?,person_status='active',updated_at=? WHERE id=? AND tenant_id=?").run(name,active?1:0,position,workType,jobCategories[0],jobLevel,JSON.stringify(jobCategories),JSON.stringify(permissions),t,id,tenantId(req));syncWorkAssignments(id,tenantId(req),workType,communityIds,jobCategories,jobLevel,permissions);res.json({success:true});});
app.post('/api/company/staff/:id/status',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const id=Number(req.params.id);const u=db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id,tenantId(req));if(!u||u.role==='company_admin'&&u.admin_level==='owner')return res.status(404).json({error:'找不到可異動的人員'});if(u.role==='company_admin'&&(getUser(req).admin_level||'admin')!=='owner')return res.status(403).json({error:'只有公司負責人可以處理其他公司管理員的離職、停用或黑名單。'});const status=String(req.body?.status||'').trim();if(!['active','disabled','left','blacklist'].includes(status))return res.status(400).json({error:'人員狀態不正確'});if(status==='disabled'){db.prepare("UPDATE staff_users SET is_active=0,person_status='disabled',updated_at=? WHERE id=? AND tenant_id=?").run(now(),id,tenantId(req));return res.json({success:true,action:'disabled'});}if(status==='active'){db.prepare("UPDATE staff_users SET is_active=1,person_status='active',updated_at=? WHERE id=? AND tenant_id=?").run(now(),id,tenantId(req));return res.json({success:true,action:'active'});}const snapshot={employee_id:u.employee_id,name:u.name,work_type:u.work_type,job_categories:getJobCategories(u),job_level:u.job_level,permissions:parsePermissions(u),communities:getSiteAssignments(u).map(x=>({id:x.community_id,name:x.community_name})),archived_from_account_id:u.id};db.prepare('INSERT INTO staff_person_archive (person_uid,tenant_id,employee_id,name,person_status,archived_at,archived_by_staff_id,snapshot_json) VALUES (?,?,?,?,?,?,?,?)').run(u.person_uid||('P'+String(u.id).padStart(8,'0')),tenantId(req),u.employee_id,u.name,status,now(),getUser(req).id,JSON.stringify(snapshot));db.prepare('DELETE FROM staff_users WHERE id=? AND tenant_id=?').run(id,tenantId(req));return res.json({success:true,action:'archived_deleted_account'});});
app.get('/api/company/personnel-archive',requireCompanyAdmin,requireCompanyPermission('manage-staff'),(req,res)=>{const status=String(req.query?.status||'').trim();const rows=status?db.prepare('SELECT * FROM staff_person_archive WHERE tenant_id=? AND person_status=? ORDER BY archived_at DESC').all(tenantId(req),status):db.prepare('SELECT * FROM staff_person_archive WHERE tenant_id=? ORDER BY archived_at DESC').all(tenantId(req));res.json(rows.map(r=>({...r,snapshot:JSON.parse(r.snapshot_json||'{}')})));});
app.delete('/api/company/staff/:id',requireCompanyAdmin,(req,res)=>res.status(400).json({error:'請使用「停用」、「離職」或「黑名單」處理人員狀態；離職與黑名單會封存人事資料並刪除登入帳號。'}));

app.get('/api/company/communities',requireCompanyAdmin,requireCompanyPermission('manage-communities'),(req,res)=>res.json(db.prepare('SELECT * FROM communities WHERE tenant_id=? ORDER BY status DESC,name').all(tenantId(req))));
app.post('/api/company/communities',requireCompanyAdmin,requireCompanyPermission('manage-communities'),(req,res)=>{const name=String(req.body?.name||'').trim();if(!name)return res.status(400).json({error:'社區名稱不可空白'});const t=now();const tx=db.transaction(()=>{const info=db.prepare('INSERT INTO communities (tenant_id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run(tenantId(req),name,'active',t,t);const cid=Number(info.lastInsertRowid);const pr=schedulePlatformRules();
  const defaults={admin:{manager:{mode:pr.admin.manager.mode,rest_days:pr.admin.manager.rest_days,red_dates:[]},secretary:{mode:pr.admin.secretary.mode,rest_days:pr.admin.secretary.rest_days,red_dates:[]}},security:{...pr.security},mobile:{...pr.mobile}};for(const [category,config] of Object.entries(defaults))db.prepare('INSERT INTO schedule_rules (tenant_id,community_id,category,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,community_id,category) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at').run(tenantId(req),cid,category,JSON.stringify(config),t,t);return cid;});try{const id=tx();res.json({success:true,id});}catch(e){res.status(500).json({error:'新增社區失敗，請稍後再試。'});}});
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
function isSiteManager(u){
  if(!u||u.role==='company_admin')return false;
  const hasManagerText=(v)=>String(v||'').trim().includes('經理');
  const jobs=getJobCategories(u);
  const level=String(u.job_level||'').trim();
  const position=String(u.position||'').trim();
  const category=String(u.job_category||'').trim();
  // 只要人員身分是「經理」即可使用案場 SOP 上傳；身分可能存在人員本身或派駐案場的職務資料。
  if(hasManagerText(level)||jobs.some(hasManagerText)||hasManagerText(position)||hasManagerText(category)) return true;
  try{
    return getSiteAssignments(u).some(a=>hasManagerText(a?.job_level)||(Array.isArray(a?.job_categories)&&a.job_categories.some(hasManagerText)));
  }catch{return false;}
}
function canManagerUploadSop(u){
  // 經理身分本身就是上傳權限，不再額外要求 SOP menu permission；SOP 頁面能開啟即可看到上傳入口。
  return isSiteManager(u);
}
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

app.get('/api/company/sops/upload-context',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>{
  const tid=tenantId(req);
  const communities=db.prepare("SELECT id,name,status FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid);
  const staff=db.prepare("SELECT id,employee_id,name,job_level,job_category,job_categories_json,work_type,is_active FROM staff_users WHERE tenant_id=? AND is_active=1 ORDER BY name,employee_id").all(tid);
  const managers=staff.filter(u=>{let cats=[];try{cats=JSON.parse(u.job_categories_json||'[]')}catch{};const vals=[u.job_level,u.job_category,...cats].map(x=>String(x||''));return vals.some(v=>v.includes('經理'));}).map(u=>({id:u.id,employee_id:u.employee_id,name:u.name,job_level:u.job_level,job_category:u.job_category,work_type:u.work_type}));
  res.json({communities,managers,current_uploader_id:getUser(req).id,current_uploader_name:getUser(req).name||''});
});
app.get('/api/company/sops',requireCompanyAdmin,requireCompanyPermission('manage-sop'),(req,res)=>res.json({sops:sopRowsForTenant(tenantId(req))}));
app.post('/api/company/sops',requireCompanyAdmin,requireCompanyPermission('manage-sop'),sopUpload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'請選擇 SOP 檔案'});
  const title=String(req.body?.title||'').trim(); const version=String(req.body?.version||'1.0').trim()||'1.0'; const category=cleanSopCategory(req.body?.category); const scopeType=cleanSopScope(req.body?.scope_type); const description=String(req.body?.description||'').trim(); let ids=[]; let targets=[];
  try{ids=req.body?.community_ids?parseSopCommunityIds(JSON.parse(req.body.community_ids)):[]}catch{ids=[]}
  try{targets=req.body?.target_jobs?parseSopTargetJobs(JSON.parse(req.body.target_jobs)):[]}catch{targets=[]}
  if(!title){cleanupUploadedFile(req.file);return res.status(400).json({error:'SOP 名稱不可空白'});}
  if(scopeType==='community'&&!ids.length){cleanupUploadedFile(req.file);return res.status(400).json({error:'案場 SOP 至少要指定一個派駐案場'});}
  if(!validateSopCommunityIds(ids,tenantId(req))){cleanupUploadedFile(req.file);return res.status(400).json({error:'包含不屬於本公司的啟用案場'});}
  const t=now(),u=getUser(req);let sourceManagerId=Number(req.body?.source_manager_staff_id||0)||null;let sourceManagerName=String(req.body?.source_manager_name||'').trim();if(sourceManagerId){const sm=db.prepare("SELECT id,name,job_level,job_category,job_categories_json FROM staff_users WHERE id=? AND tenant_id=? AND is_active=1").get(sourceManagerId,tenantId(req));if(!sm){cleanupUploadedFile(req.file);return res.status(400).json({error:'來源駐點經理不存在或已停用'});}let cats=[];try{cats=JSON.parse(sm.job_categories_json||'[]')}catch{};if(![sm.job_level,sm.job_category,...cats].some(v=>String(v||'').includes('經理'))){cleanupUploadedFile(req.file);return res.status(400).json({error:'來源負責人必須是經理身分'});}sourceManagerName=sm.name||sourceManagerName;}const info=db.prepare('INSERT INTO sops (tenant_id,title,category,description,version,filename,original_filename,is_active,created_at,updated_at,updated_by,scope_type,target_jobs_json,source_type,uploader_staff_id,uploader_name,review_status,source_manager_staff_id,source_manager_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),title,category,description,version,req.file.filename,req.file.originalname,1,t,t,u.name||u.employee_id||'',scopeType,JSON.stringify(targets),sourceManagerId?'manager-assisted':'company',u.id,u.name||'', 'published',sourceManagerId,sourceManagerName||null);
  const ins=db.prepare('INSERT INTO sop_communities (sop_id,community_id) VALUES (?,?)');for(const id of ids)ins.run(info.lastInsertRowid,id);auditSop(u,'create',info.lastInsertRowid,{title,category,scope_type:scopeType,version,community_ids:ids,target_jobs:targets,source_type:sourceManagerId?'manager-assisted':'company',source_manager_staff_id:sourceManagerId,source_manager_name:sourceManagerName});res.json({success:true,id:Number(info.lastInsertRowid)});
});

// 案場經理上傳「派駐社區注意事項」：資料直接回到同一家公司 SOP 中，內勤不必代為整理上傳。
app.post('/api/staff/sops/community-upload',requireStaffSopUser,sopUpload.single('file'),(req,res)=>{
  const u=getUser(req); if(!canManagerUploadSop(u)){cleanupUploadedFile(req.file);return res.status(403).json({error:'只有已開通「案場 SOP」模組的案場經理可以上傳派駐社區 SOP'});}
  if(!req.file)return res.status(400).json({error:'請選擇 SOP 檔案'});
  const title=String(req.body?.title||'').trim(); const version=String(req.body?.version||'1.0').trim()||'1.0'; const description=String(req.body?.description||'').trim(); let cid=Number(req.body?.community_id||0); let targets=[];
  try{targets=req.body?.target_jobs?parseSopTargetJobs(JSON.parse(req.body.target_jobs)):[]}catch{targets=[]}
  const assigned=getUserSiteCommunityIds(u);
  // 內勤經理沒有派駐案場，因此可選擇同公司所有啟用中的社區；駐點經理則只可選自己的派駐社區。
  const uploadCommunities=assigned.length?assigned:db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tenantId(req)).map(x=>Number(x.id));
  if(!cid&&uploadCommunities.length===1)cid=uploadCommunities[0];
  if(!title){cleanupUploadedFile(req.file);return res.status(400).json({error:'SOP 名稱不可空白'});}
  if(!cid||!uploadCommunities.includes(cid)||!validateSopCommunityIds([cid],tenantId(req))){cleanupUploadedFile(req.file);return res.status(400).json({error:assigned.length?'請選擇您目前派駐的有效案場':'請選擇本公司有效的案場'});}
  if(!targets.length)targets=['秘書','保全'];
  const t=now();const info=db.prepare('INSERT INTO sops (tenant_id,title,category,description,version,filename,original_filename,is_active,created_at,updated_at,updated_by,scope_type,target_jobs_json,source_type,uploader_staff_id,uploader_name,review_status,source_manager_staff_id,source_manager_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),title,'案場注意事項',description,version,req.file.filename,req.file.originalname,1,t,t,u.name||u.employee_id||'','community',JSON.stringify(targets),'manager',u.id,u.name||'','published',u.id,u.name||'');
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
app.get('/api/staff/sops',requireStaffSopUser,(req,res)=>{const u=getUser(req);const category=['行政','勤務','應變','案場注意事項'].includes(String(req.query?.category||''))?String(req.query.category):'';const scope=String(req.query?.scope||'').trim();const rows=sopRowsForTenant(tenantId(req),category).filter(x=>x.is_active&&x.review_status!=='draft'&&(!scope||String(x.scope_type||'company_basic')===scope)&&canStaffAccessSop(req,x));const manager=isSiteManager(u);const canUpload=canManagerUploadSop(u);const assigned=getUserSiteCommunityIds(u);const uploadCommunities=assigned.length ? db.prepare("SELECT id,name FROM communities WHERE id IN ("+assigned.map(()=>'?').join(',')+") AND tenant_id=? AND status='active' ORDER BY name").all(...assigned,tenantId(req)) : db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tenantId(req));res.json({sops:rows,viewer:{job_level:u.job_level||'',position:u.position||'',job_category:u.job_category||'',job_categories:getJobCategories(u),manager,can_upload:canUpload,upload_communities:canUpload?uploadCommunities:[],upload_scope:assigned.length?'assigned':'company',upload_reason:manager&&!canUpload?'目前公司尚未開通「案場 SOP」模組':''}});});
app.get('/api/staff/sops/:id/download',requireStaffSopUser,(req,res)=>{const sop=db.prepare('SELECT * FROM sops WHERE id=? AND tenant_id=? AND is_active=1').get(Number(req.params.id),tenantId(req));if(!sop||sop.review_status==='draft'||!canStaffAccessSop(req,sop))return res.status(404).json({error:'找不到您目前可以閱讀的 SOP'});const p=path.join(SOPS_DIR,sop.filename);if(!fs.existsSync(p))return res.status(404).json({error:'SOP 檔案不存在，請通知公司重新上傳'});res.download(p,sopDownloadName(sop));});

// 平台公版文件：與交接 Word 範本分離，支援一般文書檔案。
const PLATFORM_RESOURCE_EXTS = new Set(['.pdf','.doc','.docx','.xls','.xlsx','.xlsm','.ppt','.pptx','.txt','.csv']);
const platformResourceUpload = multer({
  storage: multer.diskStorage({
    destination:(req,file,cb)=>cb(null,PLATFORM_RESOURCES_DIR),
    filename:(req,file,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(5).toString('hex')+'-'+file.originalname.replace(/[^\\w.\\-\\u4e00-\\u9fa5]/g,'_'))
  }),
  fileFilter:(req,file,cb)=>PLATFORM_RESOURCE_EXTS.has(path.extname(file.originalname).toLowerCase())?cb(null,true):cb(new Error('平台公版僅允許 PDF、Word、Excel、PowerPoint、TXT 或 CSV 檔案'))
});
app.get('/api/admin/platform-resources',requireSuperAdmin,(req,res)=>res.json(db.prepare('SELECT id,name,original_name,filename,mime_type,extension,category,description,is_active,created_at FROM platform_resources ORDER BY id DESC').all()));
app.post('/api/admin/platform-resources',requireSuperAdmin,platformResourceUpload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'未收到檔案'});
  const ext=path.extname(req.file.originalname).toLowerCase();
  const name=String(req.body?.name||req.file.originalname).trim();
  const category=String(req.body?.category||'一般平台公版').trim()||'一般平台公版';
  const description=String(req.body?.description||'').trim();
  db.prepare('INSERT INTO platform_resources (name,original_name,filename,mime_type,extension,category,description,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(name,req.file.originalname,req.file.filename,req.file.mimetype||'',ext,category,description,1,now());
  res.json({success:true});
});
app.get('/api/admin/platform-resources/:id/download',requireSuperAdmin,(req,res)=>{
  const r=db.prepare('SELECT * FROM platform_resources WHERE id=? AND is_active=1').get(Number(req.params.id));
  if(!r)return res.status(404).json({error:'找不到平台公版文件'});
  const p=path.join(PLATFORM_RESOURCES_DIR,r.filename); if(!fs.existsSync(p))return res.status(404).json({error:'檔案不存在'});
  res.download(p,r.original_name);
});
app.delete('/api/admin/platform-resources/:id',requireSuperAdmin,(req,res)=>{
  const r=db.prepare('SELECT * FROM platform_resources WHERE id=?').get(Number(req.params.id));
  if(r){const p=path.join(PLATFORM_RESOURCES_DIR,r.filename);if(fs.existsSync(p))fs.unlinkSync(p);db.prepare('DELETE FROM platform_resources WHERE id=?').run(r.id);}
  res.json({success:true});
});

// 住戶名冊公版：現場人員可直接取得總後台提供的最新住戶名冊範本。
app.get('/api/staff/platform-resources', requireStaffFiller, (req,res)=>{
  const category=String(req.query?.category||'').trim();
  const rows=db.prepare(
    "SELECT id,name,original_name,extension,category,description,created_at FROM platform_resources WHERE is_active=1 AND (?='' OR category=? OR category LIKE ?) ORDER BY id DESC"
  ).all(category,category,category+'／%');
  res.json({platformResources:rows});
});
app.get('/api/staff/platform-resources/:id/download', requireStaffFiller, (req,res)=>{
  const r=db.prepare('SELECT * FROM platform_resources WHERE id=? AND is_active=1').get(Number(req.params.id));
  if(!r)return res.status(404).json({error:'找不到平台公版文件'});
  const p=path.join(PLATFORM_RESOURCES_DIR,r.filename);
  if(!fs.existsSync(p))return res.status(404).json({error:'檔案不存在'});
  res.download(p,r.original_name);
});

app.get('/api/company/platform-resources',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>res.json({platformResources:db.prepare('SELECT id,name,original_name,extension,category,description,created_at FROM platform_resources WHERE is_active=1 ORDER BY category,name,id DESC').all(),companyResources:db.prepare('SELECT id,name,original_name,extension,category,description,created_at FROM company_resources WHERE tenant_id=? AND is_active=1 ORDER BY category,name,id DESC').all(tenantId(req))}));
app.get('/api/company/platform-resources/:id/download',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{
  const r=db.prepare('SELECT * FROM platform_resources WHERE id=? AND is_active=1').get(Number(req.params.id));
  if(!r)return res.status(404).json({error:'找不到平台公版文件'});
  const p=path.join(PLATFORM_RESOURCES_DIR,r.filename); if(!fs.existsSync(p))return res.status(404).json({error:'檔案不存在'});
  res.download(p,r.original_name);
});
app.post('/api/company/platform-resources/:id/adopt',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{
  const source=db.prepare('SELECT * FROM platform_resources WHERE id=? AND is_active=1').get(Number(req.params.id));
  if(!source)return res.status(404).json({error:'找不到平台公版文件'});
  const safe=source.original_name.replace(/[^\\w.\\-\\u4e00-\\u9fa5]/g,'_');
  const filename=`${Date.now()}-${tenantId(req)}-${crypto.randomBytes(4).toString('hex')}-${safe}`;
  fs.copyFileSync(path.join(PLATFORM_RESOURCES_DIR,source.filename),path.join(PLATFORM_RESOURCES_DIR,filename));
  db.prepare('INSERT INTO company_resources (tenant_id,platform_resource_id,name,original_name,filename,mime_type,extension,category,description,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),source.id,source.name,source.original_name,filename,source.mime_type,source.extension,source.category,source.description,1,now());
  res.json({success:true});
});
app.get('/api/company/resources/:id/download',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{
  const r=db.prepare('SELECT * FROM company_resources WHERE id=? AND tenant_id=? AND is_active=1').get(Number(req.params.id),tenantId(req));
  if(!r)return res.status(404).json({error:'找不到公司公版文件'});
  const p=path.join(PLATFORM_RESOURCES_DIR,r.filename); if(!fs.existsSync(p))return res.status(404).json({error:'檔案不存在'});
  res.download(p,r.original_name);
});
app.delete('/api/company/resources/:id',requireCompanyAdmin,requireCompanyPermission('manage-templates'),(req,res)=>{
  const r=db.prepare('SELECT * FROM company_resources WHERE id=? AND tenant_id=?').get(Number(req.params.id),tenantId(req));
  if(r){const p=path.join(PLATFORM_RESOURCES_DIR,r.filename);if(fs.existsSync(p))fs.unlinkSync(p);db.prepare('DELETE FROM company_resources WHERE id=? AND tenant_id=?').run(r.id,tenantId(req));}
  res.json({success:true});
});
// ===== 智慧住戶名冊 =====
const RESIDENT_CATEGORIES=new Set(['residents-contact','residents-owners','residents-tenants']);
const RESIDENT_HEADER_ALIASES={
  building:['棟','棟別','棟號','大樓','大樓別','building','building_no','block'],
  unit:['戶號','戶別','戶號碼','門牌號','房號','unit','unit_no','house_no'],
  floor:['樓層','樓','層','floor','floor_no'],
  name:['姓名','住戶姓名','所有權人','承租人','戶長','name','owner','tenant'],
  phone:['電話','聯絡電話','手機','手機號碼','聯絡手機','phone','mobile','tel'],
  address:['地址','門牌','住址','完整地址','address'],
  relation:['身分','身份','關係','住戶身分','relation','role']
};
function residentCleanHeader(v){return String(v??'').trim().toLowerCase().replace(/[\s_\-（）()]/g,'');}
function residentHeaderMap(headers){
  const out={};
  const normalized=headers.map(h=>({raw:String(h??'').trim(),key:residentCleanHeader(h)}));
  for(const [field,aliases] of Object.entries(RESIDENT_HEADER_ALIASES)){
    const hit=normalized.find(x=>aliases.some(a=>residentCleanHeader(a)===x.key));
    if(hit)out[field]=hit.raw;
  }
  return out;
}
function residentCell(row,key){const v=row[key];return v===undefined||v===null?'':String(v).trim();}
function residentNormalizeRow(row,map){
  let building=residentCell(row,map.building),unit=residentCell(row,map.unit),floor=residentCell(row,map.floor),name=residentCell(row,map.name),phone=residentCell(row,map.phone),address=residentCell(row,map.address),relation=residentCell(row,map.relation);
  if(!unit&&address){const m=address.match(/([A-Za-z一二三四五六七八九十百千\u4e00-\u9fff]?[\-]?[0-9]{1,5}號?)/);if(m)unit=m[1];}
  if(!floor){const m=String(unit||address).match(/(?:[BbFf]|地下|地上)?\s*(\d{1,3})\s*(?:樓|F|f)/);if(m)floor=m[1];}
  if(!building){const m=String(unit||address).match(/^([A-Za-zＡ-Ｚａ-ｚ一二三四五六七八九十百千]+)[\s\-]*/);if(m)building=m[1];}
  const known=new Set(Object.values(map));const extra=Object.entries(row).filter(([k,v])=>v!==undefined&&v!==null&&String(v).trim()!==''&&!known.has(k)).map(([k,v])=>`${k}：${String(v).trim()}`).join('；');
  return {building,unit,floor,name,phone,address,extra,relation,raw:row};
}
function residentLooksLikeMatrixUnit(v){
  return /^\s*\d+-\d+-\d{4}(?:\([^)]*\))?\s*$/.test(String(v??''));
}
function residentMatrixSheet(ws){
  const vals=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
  const unitRows=[];
  for(let ri=0;ri<vals.length;ri++){
    const hits=[];
    for(let ci=0;ci<(vals[ri]||[]).length;ci++) if(residentLooksLikeMatrixUnit(vals[ri][ci])) hits.push([ci,String(vals[ri][ci]).trim()]);
    if(hits.length) unitRows.push({ri,hits});
  }
  if(unitRows.length<2)return null;
  const title=String(vals[0]?.[0]||ws.name||'').trim();
  const rows=[];
  for(let i=0;i<unitRows.length;i++){
    const {ri,hits}=unitRows[i];
    const nextRi=i+1<unitRows.length?unitRows[i+1].ri:vals.length;
    const floorFromRow=String(vals[ri]?.[0]??'').trim();
    for(const [ci,unitRaw] of hits){
      const unit=String(unitRaw).replace(/\s+/g,'');
      let floor=floorFromRow;
      if(!floor){const m=unit.match(/-(\d{4})(?:\(|$)/);if(m)floor=String(parseInt(m[1].slice(0,2),10));}
      const nameRow=vals[ri+1]||[], phoneRow=vals[ri+2]||[];
      const name1=String(nameRow[ci]??'').trim();
      const name2=String(nameRow[ci+1]??'').trim();
      const phone1=String(phoneRow[ci]??'').trim();
      const phone2=String(phoneRow[ci+1]??'').trim();
      const extras=[];
      for(let rr=ri+3;rr<Math.min(nextRi,ri+8);rr++){
        for(const cc of [ci,ci+1]){const v=String(vals[rr]?.[cc]??'').trim();if(v)extras.push(v);}
      }
      const extraParts=[];
      if(name2)extraParts.push(`其他聯絡人：${name2}`);
      const phones=[phone1,phone2].filter(Boolean);
      if(extras.length)extraParts.push(...extras);
      if(!name1&&!name2&&!phones.length&&!extraParts.length)continue;
      rows.push({building:title,unit,floor,name:name1||name2,phone:phones.join('；'),address:'',extra:extraParts.join('；'),relation:unit.includes('(租')?'承租相關標記':'',raw:{sheet:ws.name,unit_col:ci+1,secondary_name:name2}});
    }
  }
  return rows.length?{rows,detected:['棟別','戶號','樓層','主要聯絡人','其他聯絡人','電話','原始備註'],mode:'matrix',sheet:ws.name}:null;
}
function residentParseFile(filePath){
  const wb=XLSX.readFile(filePath,{cellDates:false,raw:false});
  if(!wb.SheetNames.length)throw new Error('檔案沒有可讀取的工作表');
  // 先辨識「住戶聯繫表」常見的橫向矩陣格式：一戶佔兩欄，樓層/戶號/姓名/電話/車位逐列排列。
  const matrix=[];
  for(const sheetName of wb.SheetNames){
    const hit=residentMatrixSheet(wb.Sheets[sheetName]);
    if(hit)matrix.push(hit);
  }
  if(matrix.length){
    const rows=matrix.flatMap(x=>x.rows);
    return {rows,detected:[...new Set(matrix.flatMap(x=>x.detected))],headers:[],mode:'matrix',sheets:matrix.map(x=>x.sheet)};
  }
  // 一般直向 Excel/CSV 則沿用欄名智慧辨識。
  const sheetName=wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:'',raw:false});
  if(!rows.length)throw new Error('檔案沒有資料列');
  const headers=Object.keys(rows[0]);
  const map=residentHeaderMap(headers);
  const parsed=rows.map(r=>residentNormalizeRow(r,map)).filter(r=>Object.values(r).some(v=>String(v||'').trim()!==''));
  if(!parsed.length)throw new Error('檔案沒有可匯入的住戶資料');
  return {rows:parsed,detected:Object.keys(map),headers,mode:'table',sheets:[sheetName]};
}
// 住戶名冊資料表自動補齊：讓只更新 server.js 的部署也能正常啟動。
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resident_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      community_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      original_filename TEXT,
      imported_at TEXT,
      imported_by INTEGER,
      imported_by_name TEXT,
      row_count INTEGER DEFAULT 0,
      detected_fields_json TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_resident_imports_current ON resident_imports(tenant_id,community_id,category,is_active,imported_at);
    CREATE TABLE IF NOT EXISTS resident_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      tenant_id INTEGER NOT NULL,
      community_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      building TEXT,
      unit TEXT,
      floor TEXT,
      name TEXT,
      phone TEXT,
      address TEXT,
      extra TEXT,
      raw_json TEXT,
      FOREIGN KEY (import_id) REFERENCES resident_imports(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_resident_records_current ON resident_records(tenant_id,community_id,category,import_id);
    CREATE TABLE IF NOT EXISTS resident_sort_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      tenant_id INTEGER NOT NULL,
      community_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      sort_key TEXT NOT NULL DEFAULT 'building',
      updated_at TEXT,
      UNIQUE(staff_id,community_id,category)
    );
  `);
} catch (e) {
  console.error('[resident-roster] schema init failed:', e);
}
function residentCategory(req){const c=String(req.query?.category||req.body?.category||'');if(!RESIDENT_CATEGORIES.has(c))throw new Error('住戶名冊分類無效');return c;}
function residentAccessibleCommunity(req,cid){return !!cid&&!!getAccessibleCommunity(req,Number(cid));}
function residentCanUpload(u){if(!u||u.role==='company_admin')return false;const vals=[u.job_level,u.job_category,u.position,...getJobCategories(u)];return vals.some(v=>String(v||'').includes('經理'))||vals.some(v=>String(v||'').includes('社區管理'));}
function residentActiveCommunity(req){const cid=Number(req.session?.activeCommunityId||0);if(cid&&residentAccessibleCommunity(req,cid))return db.prepare('SELECT id,name,region FROM communities WHERE id=? AND tenant_id=? AND status=\'active\'').get(cid,tenantId(req));const ids=getUserSiteCommunityIds(getUser(req));if(ids.length===1)return db.prepare('SELECT id,name,region FROM communities WHERE id=? AND tenant_id=? AND status=\'active\'').get(ids[0],tenantId(req));return null;}
app.get('/api/staff/residents',requireStaffFiller,(req,res)=>{
  try{const category=residentCategory(req),u=getUser(req),c=residentActiveCommunity(req);if(!c)return res.status(400).json({error:'請先選擇目前要操作的案場'});const imp=db.prepare('SELECT * FROM resident_imports WHERE tenant_id=? AND community_id=? AND category=? AND is_active=1 ORDER BY id DESC LIMIT 1').get(tenantId(req),c.id,category);const rows=imp?db.prepare('SELECT building,unit,floor,name,phone,address,extra FROM resident_records WHERE import_id=? ORDER BY id').all(imp.id):[];const pref=db.prepare('SELECT sort_key FROM resident_sort_preferences WHERE staff_id=? AND tenant_id=? AND community_id=? AND category=?').get(u.id,tenantId(req),c.id,category);res.json({community:c,category,records:rows,preference:{sort:pref?.sort_key||'building'},last_import:imp||null,viewer:{can_upload:residentCanUpload(u)}});}catch(e){res.status(400).json({error:e.message||'無法載入住戶資料'});}
});
app.put('/api/staff/residents/preference',requireStaffFiller,(req,res)=>{try{const category=residentCategory(req),u=getUser(req),c=residentActiveCommunity(req),sort=['building','unit','floor'].includes(String(req.body?.sort||''))?String(req.body.sort):'building';if(!c)return res.status(400).json({error:'請先選擇案場'});db.prepare(`INSERT INTO resident_sort_preferences(staff_id,tenant_id,community_id,category,sort_key,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(staff_id,community_id,category) DO UPDATE SET sort_key=excluded.sort_key,updated_at=excluded.updated_at`).run(u.id,tenantId(req),c.id,category,sort,now());res.json({success:true,sort});}catch(e){res.status(400).json({error:e.message||'排序設定失敗'});}});
app.post('/api/staff/residents/import',requireStaffFiller,residentUpload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'請選擇 Excel／CSV 檔案'});
  try{const category=residentCategory(req),u=getUser(req),c=residentActiveCommunity(req);if(!c)throw new Error('請先選擇目前要操作的案場');if(!residentCanUpload(u))throw new Error('目前帳號只有主管／社區管理人員可以上傳住戶名冊');const parsed=residentParseFile(path.join(RESIDENT_IMPORTS_DIR,req.file.filename));const t=now();const info=db.prepare('INSERT INTO resident_imports(tenant_id,community_id,category,original_filename,imported_at,imported_by,imported_by_name,row_count,detected_fields_json,is_active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(tenantId(req),c.id,category,req.file.originalname,t,u.id,u.name||u.employee_id||'',parsed.rows.length,JSON.stringify(parsed.detected));db.prepare('UPDATE resident_imports SET is_active=0 WHERE tenant_id=? AND community_id=? AND category=? AND id<>?').run(tenantId(req),c.id,category,info.lastInsertRowid);const ins=db.prepare('INSERT INTO resident_records(import_id,tenant_id,community_id,category,building,unit,floor,name,phone,address,extra,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');const tx=db.transaction(rows=>{for(const r of rows)ins.run(info.lastInsertRowid,tenantId(req),c.id,category,r.building,r.unit,r.floor,r.name,r.phone,r.address,[r.relation,r.extra].filter(Boolean).join('；'),JSON.stringify(r.raw));});tx(parsed.rows);res.json({success:true,imported:parsed.rows.length,detected_fields:parsed.detected,message:`已匯入 ${parsed.rows.length} 筆，並成為目前這個案場的最新${category==='residents-contact'?'住戶聯繫表':category==='residents-owners'?'區分所有權人':'承租人'}。`});}catch(e){res.status(400).json({error:e.message||'匯入失敗'});}finally{ /* 保留原始匯入檔，方便日後追溯 */ }
});


// ===== 出勤／巡邏 V2：出勤 GPS、巡邏 QR、離線同步 =====
function attendancePlatformRules(){ return readPlatformRules().attendance || DEFAULT_PLATFORM_RULES.attendance; }
function attendanceCommunityForCompany(req, communityId){
  const cid=Number(communityId||0); if(!cid) return null;
  return db.prepare("SELECT * FROM communities WHERE id=? AND tenant_id=? AND status='active'").get(cid,tenantId(req));
}
function attendanceCommunityForStaff(req, communityId){
  const cid=Number(communityId||0); if(!cid) return null;
  const u=getUser(req); if(!u) return null;
  return getAccessibleCommunity(req,cid);
}
function attendanceCleanType(v){ return ['attendance','patrol'].includes(String(v||''))?String(v):'attendance'; }
function attendanceRecordType(v){ return ['checkin','checkout','patrol'].includes(String(v||''))?String(v):''; }
function attendanceDistanceMeters(lat1,lng1,lat2,lng2){
  const a=Number(lat1),b=Number(lng1),c=Number(lat2),d=Number(lng2);
  if(![a,b,c,d].every(Number.isFinite)) return null;
  const R=6371000, p1=a*Math.PI/180,p2=c*Math.PI/180,dp=(c-a)*Math.PI/180,dl=(d-b)*Math.PI/180;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
}
function attendanceLocationPayload(r){return {id:r.id,community_id:r.community_id,location_type:r.location_type,name:r.name,address:r.address||'',place_id:r.place_id||'',lat:r.lat,lng:r.lng,radius_m:r.radius_m,qr_token:r.qr_token,is_active:!!r.is_active,created_at:r.created_at,updated_at:r.updated_at};}

app.get('/api/company/attendance/place-search',requireCompanyAdmin,requireCompanyPermission('attendance'),async(req,res)=>{
  const key=String(process.env.GOOGLE_MAPS_API_KEY||'').trim();
  if(!key)return res.json({configured:false,places:[]});
  const q=String(req.query?.q||'').trim();
  if(!q)return res.status(400).json({error:'請輸入地點或地址。'});
  try{
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
    const response=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location'},body:JSON.stringify({textQuery:q,languageCode:'zh-TW',regionCode:'TW',maxResultCount:5})});
    clearTimeout(timer);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return res.status(502).json({error:data?.error?.message||'Google 地圖搜尋失敗。'});
    const places=(data.places||[]).map(p=>({place_id:p.id||'',name:p.displayName?.text||'',address:p.formattedAddress||'',lat:p.location?.latitude??null,lng:p.location?.longitude??null})).filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng)));
    res.json({configured:true,places});
  }catch(e){res.status(502).json({error:e?.name==='AbortError'?'Google 地圖搜尋逾時，請稍後再試。':(e.message||'Google 地圖搜尋失敗。')});}
});

app.get('/api/company/attendance/bootstrap',requireCompanyAdmin,(req,res)=>{
  const tid=tenantId(req), communities=db.prepare("SELECT id,name,status FROM communities WHERE tenant_id=? ORDER BY name").all(tid);
  const locations=db.prepare('SELECT * FROM attendance_locations WHERE tenant_id=? ORDER BY community_id,location_type,name').all(tid).map(attendanceLocationPayload);
  res.json({rules:attendancePlatformRules(),communities,locations});
});
app.post('/api/company/attendance/locations',requireCompanyAdmin,requireCompanyPermission('attendance'),(req,res)=>{
  const c=attendanceCommunityForCompany(req,req.body?.community_id); if(!c)return res.status(400).json({error:'請選擇本公司的啟用社區'});
  const type=attendanceCleanType(req.body?.location_type), name=String(req.body?.name||'').trim(); if(!name)return res.status(400).json({error:'請輸入地點名稱'});
  const rules=attendancePlatformRules(); const radius=Math.max(5,Math.min(1000,Number(req.body?.radius_m|| (type==='attendance'?rules.default_checkin_radius_m:rules.patrol_qr_radius_m))));
  let lat=req.body?.lat===''||req.body?.lat==null?null:Number(req.body.lat), lng=req.body?.lng===''||req.body?.lng==null?null:Number(req.body.lng);
  if(!Number.isFinite(lat))lat=null; if(!Number.isFinite(lng))lng=null;
  const token=`P-${crypto.randomBytes(12).toString('hex').toUpperCase()}`; const t=now();
  const address=String(req.body?.address||'').trim().slice(0,500), placeId=String(req.body?.place_id||'').trim().slice(0,200); const info=db.prepare('INSERT INTO attendance_locations (tenant_id,community_id,location_type,name,lat,lng,radius_m,qr_token,is_active,created_at,updated_at,address,place_id) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)').run(tenantId(req),c.id,type,name,lat,lng,radius,token,t,t,address,placeId);
  res.json({success:true,location:attendanceLocationPayload(db.prepare('SELECT * FROM attendance_locations WHERE id=?').get(info.lastInsertRowid))});
});
app.put('/api/company/attendance/locations/:id',requireCompanyAdmin,requireCompanyPermission('attendance'),(req,res)=>{
  const id=Number(req.params.id), row=db.prepare('SELECT * FROM attendance_locations WHERE id=? AND tenant_id=?').get(id,tenantId(req)); if(!row)return res.status(404).json({error:'找不到地點'});
  const c=attendanceCommunityForCompany(req,req.body?.community_id??row.community_id); if(!c)return res.status(400).json({error:'請選擇本公司的啟用社區'});
  const type=attendanceCleanType(req.body?.location_type||row.location_type), name=String(req.body?.name??row.name).trim(); if(!name)return res.status(400).json({error:'地點名稱不可空白'});
  const radius=Math.max(5,Math.min(1000,Number(req.body?.radius_m??row.radius_m))); let lat=req.body?.lat===''||req.body?.lat==null?null:Number(req.body.lat),lng=req.body?.lng===''||req.body?.lng==null?null:Number(req.body.lng); if(!Number.isFinite(lat))lat=null;if(!Number.isFinite(lng))lng=null;
  const active=req.body?.is_active===undefined?!!row.is_active:!!req.body.is_active; const address=String(req.body?.address??row.address??'').trim().slice(0,500), placeId=String(req.body?.place_id??row.place_id??'').trim().slice(0,200); db.prepare('UPDATE attendance_locations SET community_id=?,location_type=?,name=?,lat=?,lng=?,radius_m=?,is_active=?,updated_at=?,address=?,place_id=? WHERE id=? AND tenant_id=?').run(c.id,type,name,lat,lng,radius,active?1:0,now(),address,placeId,id,tenantId(req));
  res.json({success:true,location:attendanceLocationPayload(db.prepare('SELECT * FROM attendance_locations WHERE id=?').get(id))});
});
app.delete('/api/company/attendance/locations/:id',requireCompanyAdmin,requireCompanyPermission('attendance'),(req,res)=>{
  const id=Number(req.params.id), tid=tenantId(req);
  const row=db.prepare('SELECT * FROM attendance_locations WHERE id=? AND tenant_id=?').get(id,tid);
  if(!row)return res.status(404).json({error:'找不到地點'});
  const records=db.prepare('SELECT COUNT(*) AS n FROM attendance_records WHERE tenant_id=? AND location_id=?').get(tid,id);
  if(Number(records?.n||0)>0){
    db.prepare('UPDATE attendance_locations SET is_active=0,updated_at=? WHERE id=? AND tenant_id=?').run(now(),id,tid);
    return res.json({success:true,action:'deactivated',message:'此地點已有歷史紀錄，因此改為停用，歷史巡邏／出勤紀錄會保留。'});
  }
  db.prepare('DELETE FROM attendance_locations WHERE id=? AND tenant_id=?').run(id,tid);
  res.json({success:true,action:'deleted',message:'地點已刪除。'});
});

app.post('/api/company/attendance/locations/:id/regenerate-qr',requireCompanyAdmin,requireCompanyPermission('attendance'),(req,res)=>{
  const id=Number(req.params.id), row=db.prepare('SELECT * FROM attendance_locations WHERE id=? AND tenant_id=?').get(id,tenantId(req)); if(!row)return res.status(404).json({error:'找不到地點'});
  const token=`P-${crypto.randomBytes(12).toString('hex').toUpperCase()}`; db.prepare('UPDATE attendance_locations SET qr_token=?,updated_at=? WHERE id=? AND tenant_id=?').run(token,now(),id,tenantId(req)); res.json({success:true,location:attendanceLocationPayload(db.prepare('SELECT * FROM attendance_locations WHERE id=?').get(id))});
});
app.get('/api/company/attendance/records',requireCompanyAdmin,requireCompanyPermission('attendance'),(req,res)=>{
  const tid=tenantId(req),cid=Number(req.query?.community_id||0),type=attendanceRecordType(req.query?.record_type||''); let sql=`SELECT r.*,u.name staff_name,u.employee_id,c.name community_name,l.name location_name FROM attendance_records r JOIN staff_users u ON u.id=r.staff_id AND u.tenant_id=r.tenant_id JOIN communities c ON c.id=r.community_id AND c.tenant_id=r.tenant_id LEFT JOIN attendance_locations l ON l.id=r.location_id AND l.tenant_id=r.tenant_id WHERE r.tenant_id=?`; const args=[tid]; if(cid){sql+=' AND r.community_id=?';args.push(cid);} if(type){sql+=' AND r.record_type=?';args.push(type);} const rows=db.prepare(sql+' ORDER BY r.recorded_at DESC LIMIT 1000').all(...args); res.json({rows});
});

app.get('/api/staff/attendance/bootstrap',requireStaffFiller,(req,res)=>{
  const u=getUser(req),ids=getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean), rules=attendancePlatformRules();
  if(rules.enabled===false)return res.json({rules,locations:[],communities:[]});
  const placeholders=ids.map(()=>'?').join(',')||'0'; const communities=ids.length?db.prepare(`SELECT id,name,status FROM communities WHERE tenant_id=? AND id IN (${placeholders}) AND status='active' ORDER BY name`).all(tenantId(req),...ids):[];
  const locations=ids.length?db.prepare(`SELECT * FROM attendance_locations WHERE tenant_id=? AND community_id IN (${placeholders}) AND is_active=1 ORDER BY community_id,location_type,name`).all(tenantId(req),...ids):[];
  res.json({rules,communities,locations:locations.map(attendanceLocationPayload),active_community_id:Number(req.session?.activeCommunityId||0)||null});
});
function attendanceValidateStaffCommunity(req,communityId){return attendanceCommunityForStaff(req,communityId);}
app.post('/api/staff/attendance/records',requireStaffFiller,(req,res)=>{
  try{
    const u=getUser(req),rules=attendancePlatformRules(); if(rules.enabled===false)return res.status(403).json({error:'平台目前尚未啟用出勤／巡邏功能'});
    const cid=Number(req.body?.community_id||0), c=attendanceValidateStaffCommunity(req,cid); if(!c)return res.status(403).json({error:'您目前沒有這個案場的工作權限'});
    const rt=attendanceRecordType(req.body?.record_type); if(!rt)return res.status(400).json({error:'打卡類型不正確'});
    const clientId=String(req.body?.client_record_id||'').trim()||`C-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
    const exists=db.prepare('SELECT * FROM attendance_records WHERE tenant_id=? AND staff_id=? AND client_record_id=?').get(tenantId(req),u.id,clientId); if(exists)return res.json({success:true,duplicate:true,record:exists});
    const lat=req.body?.lat==null||req.body?.lat===''?null:Number(req.body.lat),lng=req.body?.lng==null||req.body?.lng===''?null:Number(req.body.lng),accuracy=req.body?.accuracy_m==null||req.body?.accuracy_m===''?null:Number(req.body.accuracy_m);
    let location=null;
    if(rt==='patrol'){
      const token=String(req.body?.qr_token||'').trim(); if(!rules.patrol_qr_enabled||!token)return res.status(400).json({error:'巡邏打卡需要掃描有效 QR Code'});
      location=db.prepare("SELECT * FROM attendance_locations WHERE tenant_id=? AND community_id=? AND location_type='patrol' AND qr_token=? AND is_active=1").get(tenantId(req),cid,token); if(!location)return res.status(400).json({error:'這張 QR Code 不屬於目前案場，或巡邏點已停用'});
    } else {
      const lid=Number(req.body?.location_id||0); location=db.prepare("SELECT * FROM attendance_locations WHERE id=? AND tenant_id=? AND community_id=? AND location_type='attendance' AND is_active=1").get(lid,tenantId(req),cid);
      if(!location)return res.status(400).json({error:'找不到有效的出勤打卡點'});
      if(rules.gps_checkin_enabled){
        if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'出勤打卡需要開啟手機定位'});
        if(location.lat==null||location.lng==null)return res.status(400).json({error:'此打卡點尚未設定 GPS 座標，請聯絡公司管理員'});
        const distance=attendanceDistanceMeters(lat,lng,location.lat,location.lng); if(distance==null||distance>Number(location.radius_m||rules.default_checkin_radius_m))return res.status(400).json({error:`目前距離打卡點約 ${Math.round(distance||0)} 公尺，超出允許範圍 ${location.radius_m} 公尺`});
        if(Number.isFinite(accuracy)&&accuracy>Number(rules.max_gps_accuracy_m||150))return res.status(400).json({error:`目前 GPS 誤差約 ${Math.round(accuracy)} 公尺，超過系統允許的 ${rules.max_gps_accuracy_m} 公尺`});
      }
    }
    const recordedAt=String(req.body?.recorded_at||now()), source=String(req.body?.source||'online')==='offline'?'offline':'online';
    const info=db.prepare('INSERT INTO attendance_records (tenant_id,staff_id,community_id,location_id,record_type,qr_token,lat,lng,accuracy_m,recorded_at,received_at,source,client_record_id,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),u.id,cid,location?.id||null,rt,rt==='patrol'?String(req.body.qr_token||''):'',Number.isFinite(lat)?lat:null,Number.isFinite(lng)?lng:null,Number.isFinite(accuracy)?accuracy:null,recordedAt,now(),source,clientId,JSON.stringify({user_agent:String(req.headers['user-agent']||'').slice(0,300)}));
    res.json({success:true,id:info.lastInsertRowid,record:db.prepare('SELECT * FROM attendance_records WHERE id=?').get(info.lastInsertRowid)});
  }catch(e){res.status(400).json({error:e.message||'打卡紀錄寫入失敗'});}
});
app.post('/api/staff/attendance/sync',requireStaffFiller,(req,res)=>{
  const rows=Array.isArray(req.body?.records)?req.body.records.slice(0,100):[]; const results=[]; for(const row of rows){
    try{ const fake={body:{...row,source:'offline'},session:req.session,headers:req.headers,path:'/api/staff/attendance/records'}; let done=false; const rr={status(n){this.code=n;return this},json(x){this.payload=x;done=true;return this}}; /* 以相同驗證邏輯重跑：直接呼叫內部函式不依賴 Express chain */
      const u=getUser(req),c=attendanceValidateStaffCommunity(req,Number(row.community_id)); if(!c)throw new Error('案場權限已失效');
      const cid=Number(row.community_id),rt=attendanceRecordType(row.record_type),clientId=String(row.client_record_id||'').trim(); if(!clientId)throw new Error('離線紀錄缺少識別碼');
      if(db.prepare('SELECT id FROM attendance_records WHERE tenant_id=? AND staff_id=? AND client_record_id=?').get(tenantId(req),u.id,clientId)){results.push({client_record_id:clientId,success:true,duplicate:true});continue;}
      const rules=attendancePlatformRules(); let location=null;
      const lat=Number.isFinite(Number(row.lat))?Number(row.lat):null,lng=Number.isFinite(Number(row.lng))?Number(row.lng):null,accuracy=Number.isFinite(Number(row.accuracy_m))?Number(row.accuracy_m):null;
      if(rt==='patrol'){const token=String(row.qr_token||'').trim();location=db.prepare("SELECT * FROM attendance_locations WHERE tenant_id=? AND community_id=? AND location_type='patrol' AND qr_token=? AND is_active=1").get(tenantId(req),cid,token);if(!location)throw new Error('巡邏 QR 已失效或不屬於此案場');}
      else {location=db.prepare("SELECT * FROM attendance_locations WHERE id=? AND tenant_id=? AND community_id=? AND location_type='attendance' AND is_active=1").get(Number(row.location_id),tenantId(req),cid);if(!location)throw new Error('出勤打卡點已失效');if(rules.gps_checkin_enabled){if(lat==null||lng==null)throw new Error('離線出勤紀錄缺少 GPS');const d=attendanceDistanceMeters(lat,lng,location.lat,location.lng);if(d==null||d>Number(location.radius_m||rules.default_checkin_radius_m))throw new Error('離線出勤紀錄超出打卡範圍');if(accuracy!=null&&accuracy>Number(rules.max_gps_accuracy_m||150))throw new Error('離線 GPS 誤差過大');}}
      const info=db.prepare('INSERT INTO attendance_records (tenant_id,staff_id,community_id,location_id,record_type,qr_token,lat,lng,accuracy_m,recorded_at,received_at,source,client_record_id,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),u.id,cid,location?.id||null,rt,rt==='patrol'?String(row.qr_token||''):'',lat,lng,accuracy,String(row.recorded_at||now()),now(),'offline',clientId,JSON.stringify({synced:true,user_agent:String(req.headers['user-agent']||'').slice(0,300)}));results.push({client_record_id:clientId,success:true,id:info.lastInsertRowid});
    }catch(e){results.push({client_record_id:String(row.client_record_id||''),success:false,error:e.message||'同步失敗'});}
  } res.json({success:true,results});
});
app.get('/api/staff/attendance/records',requireStaffFiller,(req,res)=>{const u=getUser(req),cid=Number(req.query?.community_id||0),rows=db.prepare(`SELECT r.*,c.name community_name,l.name location_name FROM attendance_records r JOIN communities c ON c.id=r.community_id AND c.tenant_id=r.tenant_id LEFT JOIN attendance_locations l ON l.id=r.location_id AND l.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.staff_id=? ${cid?'AND r.community_id=?':''} ORDER BY r.recorded_at DESC LIMIT 100`).all(...([tenantId(req),u.id].concat(cid?[cid]:[])));res.json({rows});});

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

// ===== 智慧班表模組 V1 =====
// 三套排班規則完全分離：行政／保全／機動。
// 班表資料一律以 tenant_id 隔離，不讀取其他公司的排班資料。

const SCHEDULE_MENU_ITEMS = PLATFORM_COMPANY_SCHEDULE_MENU;

function schedulePlatformRules(){ return readPlatformRules().schedule; }
function scheduleEffectiveRule(tenantIdValue, communityId, category){
  const platform=schedulePlatformRules();
  const base=category==='admin'?platform.admin:(platform[category]||{});
  const local=scheduleGetRule(tenantIdValue,communityId,category).config||{};
  if(category==='admin') return {manager:{...platform.admin.manager,...(local.manager||{})},secretary:{...platform.admin.secretary,...(local.secretary||{})}};
  return {...base,...local};
}
function scheduleEnsureSchema(){
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      schedule_role TEXT NOT NULL DEFAULT '',
      default_shift TEXT NOT NULL DEFAULT '',
      rest_days INTEGER NOT NULL DEFAULT 6,
      self_select_days INTEGER NOT NULL DEFAULT 2,
      community_ids_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id,staff_id),
      FOREIGN KEY(staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS schedule_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      community_id INTEGER,
      category TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id,community_id,category)
    );
    CREATE TABLE IF NOT EXISTS schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      work_date TEXT NOT NULL,
      staff_id INTEGER NOT NULL,
      community_id INTEGER,
      category TEXT NOT NULL,
      shift_code TEXT NOT NULL DEFAULT 'work',
      status TEXT NOT NULL DEFAULT 'planned',
      source TEXT NOT NULL DEFAULT 'manual',
      note TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id,work_date,staff_id,community_id),
      FOREIGN KEY(staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_entries_tenant_month ON schedule_entries(tenant_id,month,category);
    CREATE TABLE IF NOT EXISTS schedule_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      community_id INTEGER,
      from_staff_id INTEGER NOT NULL,
      to_staff_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'approved',
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      community_id INTEGER,
      work_date TEXT NOT NULL,
      request_type TEXT NOT NULL,
      target_staff_id INTEGER,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_overtime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      community_id INTEGER,
      work_date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '',
      shift_code TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
scheduleEnsureSchema();

function scheduleJson(v, fallback={}){try{const x=JSON.parse(v||'');return x&&typeof x==='object'?x:fallback;}catch{return fallback;}}
function scheduleArray(v){try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return [];}}
function scheduleMonth(value){const s=String(value||'').trim();return /^\d{4}-\d{2}$/.test(s)?s:(new Date().toISOString().slice(0,7));}
function scheduleDaysInMonth(month){const [y,m]=scheduleMonth(month).split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();}
function scheduleDate(month,day){return `${scheduleMonth(month)}-${String(day).padStart(2,'0')}`;}
function scheduleWorkdays(month){return Array.from({length:scheduleDaysInMonth(month)},(_,i)=>scheduleDate(month,i+1));}
function scheduleDefaultRole(u){
  const jobs=getJobCategories(u); const text=jobs.join('、');
  if(jobs.includes('機動')) return 'mobile';
  if(jobs.includes('保全')) return 'security';
  if(jobs.includes('秘書')||jobs.includes('社區管理')||u?.job_level==='經理') return 'admin';
  return '';
}
function scheduleSyncProfileFromStaff(tenantIdValue,staffId){
  const u=db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(Number(staffId),tenantIdValue);
  if(!u) return null;
  const role=scheduleDefaultRole(u);
  const existing=db.prepare('SELECT * FROM schedule_profiles WHERE tenant_id=? AND staff_id=?').get(tenantIdValue,Number(staffId));
  if(!role){
    if(existing) db.prepare("UPDATE schedule_profiles SET schedule_role='',community_ids_json='[]',updated_at=? WHERE tenant_id=? AND staff_id=?").run(now(),tenantIdValue,Number(staffId));
    return null;
  }
  const assigned=getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean);
  const pr=schedulePlatformRules();
  const defaultShift=existing?.default_shift || (role==='security'?(pr.security.shift||'day'):'');
  const restDays=existing?.rest_days!=null?Number(existing.rest_days):(role==='security'?Number(pr.security.rest_days||6):role==='mobile'?Number(pr.mobile.rest_days||6):Number(pr.admin.manager.rest_days||8));
  const selfDays=existing?.self_select_days!=null?Number(existing.self_select_days):Math.min(role==='security'?Number(pr.security.self_select_days||2):role==='mobile'?Number(pr.mobile.self_select_days||2):0,restDays);
  const notes=existing?.notes||'';
  db.prepare(`INSERT INTO schedule_profiles (tenant_id,staff_id,schedule_role,default_shift,rest_days,self_select_days,community_ids_json,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,staff_id) DO UPDATE SET schedule_role=excluded.schedule_role,default_shift=excluded.default_shift,community_ids_json=excluded.community_ids_json,updated_at=excluded.updated_at`).run(tenantIdValue,Number(staffId),role,defaultShift,Math.max(0,Math.min(31,restDays)),Math.max(0,Math.min(restDays,selfDays)),JSON.stringify(assigned),notes,now(),now());
  return scheduleGetProfile(tenantIdValue,Number(staffId));
}

function scheduleGetProfile(tenantIdValue,staffId){
  let p=db.prepare('SELECT * FROM schedule_profiles WHERE tenant_id=? AND staff_id=?').get(tenantIdValue,staffId);
  if(p) return {...p,community_ids:scheduleArray(p.community_ids_json)};
  const u=db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=? AND is_active=1').get(staffId,tenantIdValue);
  if(!u) return null;
  const role=scheduleDefaultRole(u);
  const pr=schedulePlatformRules();
  const defaultShift=role==='security'?(pr.security.shift||'day'):'';
  const restDays=role==='security'?Number(pr.security.rest_days||6):role==='mobile'?Number(pr.mobile.rest_days||6):Number(pr.admin.manager.rest_days||8);
  const selfDays=role==='security'?Number(pr.security.self_select_days||2):role==='mobile'?Number(pr.mobile.self_select_days||2):0;
  return {tenant_id:tenantIdValue,staff_id:staffId,schedule_role:role,default_shift:defaultShift,rest_days:restDays,self_select_days:selfDays,community_ids:getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean),notes:''};
}
function scheduleUpsertProfile(tenantIdValue,staffId,payload){
  const u=db.prepare('SELECT id,is_active FROM staff_users WHERE id=? AND tenant_id=?').get(staffId,tenantIdValue); if(!u)return null;
  const role=['admin','security','mobile'].includes(payload.schedule_role)?payload.schedule_role:'';
  const shift=['day','night',''].includes(payload.default_shift)?payload.default_shift:'';
  const rest=Math.max(0,Math.min(31,Number(payload.rest_days??6)));
  const self=Math.max(0,Math.min(rest,Number(payload.self_select_days??2)));
  const cids=[...new Set((Array.isArray(payload.community_ids)?payload.community_ids:[]).map(Number).filter(Boolean))];
  const valid=new Set(db.prepare("SELECT id FROM communities WHERE tenant_id=? AND status='active'").all(tenantIdValue).map(x=>Number(x.id)));
  if(cids.some(x=>!valid.has(x))) throw new Error('班表人員包含不屬於本公司的社區');
  const t=now();
  db.prepare(`INSERT INTO schedule_profiles (tenant_id,staff_id,schedule_role,default_shift,rest_days,self_select_days,community_ids_json,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,staff_id) DO UPDATE SET schedule_role=excluded.schedule_role,default_shift=excluded.default_shift,rest_days=excluded.rest_days,self_select_days=excluded.self_select_days,community_ids_json=excluded.community_ids_json,notes=excluded.notes,updated_at=excluded.updated_at`)
    .run(tenantIdValue,staffId,role,shift,rest,self,JSON.stringify(cids),String(payload.notes||'').slice(0,500),t,t);
  return scheduleGetProfile(tenantIdValue,staffId);
}
function scheduleLegacyDefault(category){
  if(category==='security') return {rest_days:6,self_select_days:2,max_consecutive:6,shift:'day'};
  if(category==='mobile') return {rest_days:6,self_select_days:2,max_consecutive:6};
  return {manager:{mode:'red_holiday',rest_days:8,red_dates:[]},secretary:{mode:'rotation',rest_days:8,red_dates:[]}};
}
function scheduleRuleUsesPlatform(category,config){
  if(!config || config.use_platform_defaults!==undefined) return config?.use_platform_defaults!==false;
  const legacy=scheduleLegacyDefault(category);
  return JSON.stringify(config)===JSON.stringify(legacy);
}
function scheduleGetRule(tenantIdValue,communityId,category){
  const platform=schedulePlatformRules();
  const r=db.prepare('SELECT * FROM schedule_rules WHERE tenant_id=? AND community_id IS ? AND category=?').get(tenantIdValue,communityId??null,category);
  if(!r){
    const config=category==='security'?{...platform.security,use_platform_defaults:true}:category==='mobile'?{...platform.mobile,use_platform_defaults:true}:{manager:{...platform.admin.manager,red_dates:[]},secretary:{...platform.admin.secretary,red_dates:[]},use_platform_defaults:true};
    return {tenant_id:tenantIdValue,community_id:communityId??null,category,config};
  }
  let local=scheduleJson(r.config_json,{});
  let uses=scheduleRuleUsesPlatform(category,local);
  if(local.use_platform_defaults===undefined){
    local={...local,use_platform_defaults:uses};
    try{db.prepare('UPDATE schedule_rules SET config_json=?,updated_at=? WHERE id=?').run(JSON.stringify(local),now(),r.id);}catch{}
  }
  if(!uses) return {...r,config:local};
  if(category==='admin') return {...r,config:{manager:{...platform.admin.manager,...(local.manager||{}),red_dates:(local.manager?.red_dates||[])},secretary:{...platform.admin.secretary,...(local.secretary||{}),red_dates:(local.secretary?.red_dates||[])},use_platform_defaults:true}};
  return {...r,config:{...platform[category],...local,use_platform_defaults:true}};
}
function scheduleSetRule(tenantIdValue,communityId,category,config){
  if(!['admin','security','mobile'].includes(category))throw new Error('班表類別不正確');
  if(communityId!==null && communityId!==undefined){const c=db.prepare('SELECT id FROM communities WHERE id=? AND tenant_id=? AND status=\'active\'').get(Number(communityId),tenantIdValue);if(!c)throw new Error('找不到本公司的啟用社區');}
  const t=now();db.prepare(`INSERT INTO schedule_rules (tenant_id,community_id,category,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,community_id,category) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at`).run(tenantIdValue,communityId??null,category,JSON.stringify(config||{}),t,t);
  return scheduleGetRule(tenantIdValue,communityId??null,category);
}
function scheduleListStaff(tenantIdValue){
  const rows=db.prepare("SELECT id,employee_id,name,is_active,work_type,job_category,job_level,job_categories_json,position FROM staff_users WHERE tenant_id=? AND role='staff' AND is_active=1 ORDER BY employee_id").all(tenantIdValue);
  return rows.map(u=>{const p=scheduleGetProfile(tenantIdValue,u.id);return {...u,job_categories:getJobCategories(u),schedule_profile:p,site_assignments:getSiteAssignments(u)};});
}
function scheduleValidateEntries(tenantIdValue,month){
  const m=scheduleMonth(month); const rows=db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND month=? ORDER BY work_date,staff_id').all(tenantIdValue,m);
  const byStaff={}; for(const r of rows)(byStaff[r.staff_id]??=[]).push(r);
  const problems=[]; const pr=schedulePlatformRules();
  for(const [sid,list] of Object.entries(byStaff)){
    const first=list[0]; const communityId=first?.community_id??null; const category=first?.category||'security';
    const rule=category==='admin'?pr:{...pr[category]};
    const max=Math.max(1,Number(rule.max_consecutive||pr.max_consecutive||6));
    const work=new Set(list.filter(x=>x.shift_code!=='off'&&x.shift_code!=='leave').map(x=>x.work_date));
    let streak=0;
    if(pr.cross_month_check){
      const prev=new Date(`${m}-01T00:00:00Z`); prev.setUTCDate(prev.getUTCDate()-1); const prevMonth=prev.toISOString().slice(0,7);
      const prior=db.prepare("SELECT work_date,shift_code FROM schedule_entries WHERE tenant_id=? AND staff_id=? AND month=? AND work_date>=? ORDER BY work_date DESC").all(tenantIdValue,Number(sid),prevMonth,`${prevMonth}-${String(Math.max(1,31-max)).padStart(2,'0')}`);
      for(const r of prior){if(r.shift_code==='off'||r.shift_code==='leave')break; streak++; if(streak>=max) break;}
    }
    for(const d of scheduleWorkdays(m)){
      if(work.has(d)){streak++;if(streak>max)problems.push({type:'max-consecutive',staff_id:Number(sid),date:d,community_id:communityId,category,message:`連續工作超過 ${max} 天`});}
      else streak=0;
    }
  }
  return problems;
}
function scheduleUpsertEntry(tenantIdValue,body,createdBy){
  const staffId=Number(body.staff_id),communityId=body.community_id?Number(body.community_id):null,date=String(body.work_date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期格式不正確');
  const u=db.prepare('SELECT id FROM staff_users WHERE id=? AND tenant_id=? AND is_active=1').get(staffId,tenantIdValue);if(!u)throw new Error('找不到本公司在職人員');
  if(communityId){const c=db.prepare('SELECT id FROM communities WHERE id=? AND tenant_id=? AND status=\'active\'').get(communityId,tenantIdValue);if(!c)throw new Error('社區不屬於本公司');}
  const category=['admin','security','mobile'].includes(body.category)?body.category:'security';
  const shift=String(body.shift_code||'work');
  if(!['work','off','leave','day','night','training'].includes(shift))throw new Error('班別不正確');
  const month=date.slice(0,7),t=now();
  db.prepare(`INSERT INTO schedule_entries (tenant_id,month,work_date,staff_id,community_id,category,shift_code,status,source,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,work_date,staff_id,community_id) DO UPDATE SET month=excluded.month,category=excluded.category,shift_code=excluded.shift_code,status=excluded.status,source=excluded.source,note=excluded.note,created_by=excluded.created_by,updated_at=excluded.updated_at`).run(tenantIdValue,month,date,staffId,communityId,category,shift,body.status||'planned',body.source||'manual',String(body.note||'').slice(0,500),createdBy,t,t);
  return db.prepare('SELECT * FROM schedule_entries WHERE tenant_id=? AND work_date=? AND staff_id=? AND community_id IS ?').get(tenantIdValue,date,staffId,communityId);
}
const SCHEDULE_HOLIDAY_API='https://data.ntpc.gov.tw/api/datasets/308dcd75-6434-45bc-a95f-584da4fed251/json?page=0&size=2000';
const SCHEDULE_HOLIDAY_CACHE=new Map();
const SCHEDULE_HOLIDAY_FALLBACK={
  2026:['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-27','2026-02-28','2026-04-03','2026-04-04','2026-04-05','2026-04-06','2026-05-01','2026-06-19','2026-09-25','2026-09-28','2026-10-09','2026-10-10','2026-10-25','2026-10-26','2026-12-25'],
  2027:['2027-01-01','2027-02-04','2027-02-05','2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-02-10','2027-02-28','2027-03-01','2027-04-04','2027-04-05','2027-04-06','2027-04-30','2027-05-01','2027-06-09','2027-09-15','2027-09-28','2027-10-10','2027-10-11','2027-10-25','2027-12-24','2027-12-25','2027-12-31']
};
async function scheduleTaiwanHolidayDates(year){
  const y=Number(year); if(SCHEDULE_HOLIDAY_CACHE.has(y)) return SCHEDULE_HOLIDAY_CACHE.get(y);
  try{
    const r=await fetch(SCHEDULE_HOLIDAY_API,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(5000)});
    if(!r.ok) throw new Error(`holiday API HTTP ${r.status}`);
    const data=await r.json();
    const records=Array.isArray(data)?data:(Array.isArray(data?.result?.records)?data.result.records:[]);
    const dates=[...new Set(records.filter(x=>Number(x?.year||String(x?.date||'').slice(0,4))===y && String(x?.isholiday??x?.isHoliday??'').trim()==='是' && !/週末|周末|例假|休息日/i.test(String(x?.holidaycategory||x?.holidayCategory||''))).map(x=>String(x?.date||'').slice(0,10)).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    if(dates.length){SCHEDULE_HOLIDAY_CACHE.set(y,dates);return dates;}
    throw new Error('holiday API returned no holiday records');
  }catch(e){const fallback=SCHEDULE_HOLIDAY_FALLBACK[y]||[];SCHEDULE_HOLIDAY_CACHE.set(y,fallback);return fallback;}
}
function schedulePickRestDays(days,totalRest,preferredDates=new Set(),maxConsecutive=6){
  const off=new Set([...preferredDates].filter(d=>days.includes(d)));
  while(off.size<totalRest){
    let picked=null;
    for(const d of days){if(off.has(d))continue;const idx=days.indexOf(d);const recent=days.slice(Math.max(0,idx-maxConsecutive),idx).filter(x=>!off.has(x));if(recent.length>=maxConsecutive){picked=d;break;}}
    if(!picked){const candidates=days.filter(d=>!off.has(d));if(!candidates.length)break;const step=Math.max(1,Math.floor(days.length/Math.max(1,totalRest)));picked=candidates[Math.min(candidates.length-1,Math.floor(off.size*step))];}
    off.add(picked);
  }
  return off;
}
async function scheduleGenerate(tenantIdValue,month,category,communityId,createdBy){
  const profiles=scheduleListStaff(tenantIdValue).filter(x=>x.schedule_profile?.schedule_role===category);
  const days=scheduleWorkdays(month);let created=0;
  const holidayDates=(await scheduleTaiwanHolidayDates(Number(month.slice(0,4)))).filter(d=>d.startsWith(month));
  const rotationAssignments=new Map();
  if(category==='admin'&&holidayDates.length){
    const groups=new Map();
    for(const person of profiles){for(const cid of (person.schedule_profile?.community_ids||[])){if(communityId&&Number(cid)!==Number(communityId))continue;if(!groups.has(Number(cid))) groups.set(Number(cid),[]); groups.get(Number(cid)).push(person);}}
    for(const [cid,people] of groups){people.sort((a,b)=>Number(a.id)-Number(b.id));const pool=[...new Map(people.map(p=>[p.id,p])).values()];if(pool.length>1)holidayDates.forEach((d,i)=>{const person=pool[i%pool.length];if(!rotationAssignments.has(person.id))rotationAssignments.set(person.id,new Set());rotationAssignments.get(person.id).add(d);});}
  }
  for(const person of profiles){
    const p=person.schedule_profile,jobs=person.job_categories||[],cids=(p.community_ids||[]).filter(Boolean);
    if(category==='mobile'&&!cids.length)continue;
    const targetCommunity=category==='mobile'?null:(communityId||cids[0]||null);const rule=scheduleEffectiveRule(tenantIdValue,targetCommunity,category);
    let totalRest=Number(p.rest_days||rule.rest_days||6),selfDays=Math.min(Number(p.self_select_days||rule.self_select_days||2),totalRest),mode='rotation';
    if(category==='admin'){const isManager=jobs.includes('社區管理')||person.job_level==='經理';const sub=isManager?(rule.manager||{}):(rule.secretary||{});mode=sub.mode||'rotation';totalRest=Number(sub.rest_days||p.rest_days||8);selfDays=0;}
    const existingSelf=db.prepare("SELECT work_date FROM schedule_entries WHERE tenant_id=? AND month=? AND staff_id=? AND shift_code='off' AND source='self-select'").all(tenantIdValue,month,person.id).map(x=>x.work_date);
    const preferred=new Set(existingSelf.slice(0,selfDays));
    if(category==='admin'){if(mode==='red_holiday')holidayDates.forEach(d=>preferred.add(d));else if(mode==='rotation')for(const d of (rotationAssignments.get(person.id)||[]))preferred.add(d);}
    const off=schedulePickRestDays(days,totalRest,preferred,Number(rule.max_consecutive||schedulePlatformRules().max_consecutive||6));
    let ci=0;
    for(const d of days){const isOff=off.has(d);let cid=targetCommunity;if(category==='mobile'&&!isOff){cid=cids[ci%cids.length];ci++;}if(category==='mobile'&&isOff)cid=cids.length?cids[Math.max(0,(ci-1)%cids.length)]:null;const shift=category==='security'?(p.default_shift||rule.shift||'day'):'work';scheduleUpsertEntry(tenantIdValue,{staff_id:person.id,community_id:cid,work_date:d,category,shift_code:isOff?'off':shift,source:'auto'},createdBy);created++;}
  }
  return {created,problems:scheduleValidateEntries(tenantIdValue,month),holiday_dates:holidayDates,holiday_source:'台灣政府辦公日曆資料；若資料服務暫時不可用則使用內建年度備援',platform_rules:schedulePlatformRules()};
}

const _scheduleOriginalCompanyMenuConfig = app._scheduleOriginalCompanyMenuConfig;
app.get('/api/company/schedule/menu-state',requireCompanyAdmin,(req,res)=>res.json({enabled:true,items:SCHEDULE_MENU_ITEMS}));

app.get('/api/company/schedule/staff',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>res.json({staff:scheduleListStaff(tenantId(req)),communities:db.prepare("SELECT id,name,status FROM communities WHERE tenant_id=? ORDER BY status DESC,name").all(tenantId(req))}));
app.put('/api/company/schedule/staff/:id',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{try{const p=scheduleUpsertProfile(tenantId(req),Number(req.params.id),req.body||{});if(!p)return res.status(404).json({error:'找不到人員'});res.json({success:true,profile:p});}catch(e){res.status(400).json({error:e.message||'班表人員設定失敗'});}});
app.get('/api/company/schedule/rules',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{const cid=req.query?.community_id?Number(req.query.community_id):null;const category=String(req.query?.category||'security');res.json(scheduleGetRule(tenantId(req),cid,category));});
app.put('/api/company/schedule/rules',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{try{const cid=req.body?.community_id?Number(req.body.community_id):null;const category=String(req.body?.category||'');res.json({success:true,rule:scheduleSetRule(tenantId(req),cid,category,req.body?.config||{})});}catch(e){res.status(400).json({error:e.message||'班表規則儲存失敗'});}});
app.get('/api/company/schedule/month',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{const month=scheduleMonth(req.query?.month);const category=['admin','security','mobile'].includes(String(req.query?.category))?String(req.query.category):'security';const cid=req.query?.community_id?Number(req.query.community_id):null;const rows=db.prepare(`SELECT e.*,u.name staff_name,u.employee_id,c.name community_name FROM schedule_entries e JOIN staff_users u ON u.id=e.staff_id LEFT JOIN communities c ON c.id=e.community_id WHERE e.tenant_id=? AND e.month=? AND e.category=? ${cid?'AND e.community_id=?':''} ORDER BY e.work_date,u.employee_id`).all(...(cid?[tenantId(req),month,category,cid]:[tenantId(req),month,category]));res.json({month,category,community_id:cid,entries:rows,problems:scheduleValidateEntries(tenantId(req),month)});});
app.post('/api/company/schedule/generate',requireCompanyAdmin,requireCompanyPermission('schedule'),async(req,res)=>{try{const month=scheduleMonth(req.body?.month);const category=String(req.body?.category||'security');const cid=req.body?.community_id?Number(req.body.community_id):null;const r=await scheduleGenerate(tenantId(req),month,category,cid,getUser(req).id);res.json({success:true,...r});}catch(e){res.status(400).json({error:e.message||'智慧排班失敗'});}});
app.post('/api/company/schedule/entry',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{try{res.json({success:true,entry:scheduleUpsertEntry(tenantId(req),req.body||{},getUser(req).id)});}catch(e){res.status(400).json({error:e.message||'班表儲存失敗'});}});
app.delete('/api/company/schedule/entry/:id',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{db.prepare('DELETE FROM schedule_entries WHERE id=? AND tenant_id=?').run(Number(req.params.id),tenantId(req));res.json({success:true});});
app.get('/api/company/schedule/swaps',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{const rows=db.prepare(`SELECT s.*,a.name from_name,b.name to_name,c.name community_name FROM schedule_swaps s JOIN staff_users a ON a.id=s.from_staff_id JOIN staff_users b ON b.id=s.to_staff_id LEFT JOIN communities c ON c.id=s.community_id WHERE s.tenant_id=? ORDER BY s.created_at DESC`).all(tenantId(req));res.json({rows});});
app.post('/api/company/schedule/swaps',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{try{const t=now();const cid=req.body?.community_id?Number(req.body.community_id):null;const from=Number(req.body?.from_staff_id),to=Number(req.body?.to_staff_id);if(!from||!to||from===to)throw new Error('請選擇不同的換班人員');db.prepare('INSERT INTO schedule_swaps (tenant_id,work_date,community_id,from_staff_id,to_staff_id,reason,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(tenantId(req),String(req.body.work_date||''),cid,from,to,String(req.body.reason||''),String(req.body.status||'approved'),getUser(req).id,t);res.json({success:true});}catch(e){res.status(400).json({error:e.message||'換班紀錄建立失敗'});}});
app.get('/api/company/schedule/requests',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{const rows=db.prepare(`SELECT r.*,u.name staff_name,t.name target_staff_name,c.name community_name FROM schedule_requests r JOIN staff_users u ON u.id=r.staff_id LEFT JOIN staff_users t ON t.id=r.target_staff_id LEFT JOIN communities c ON c.id=r.community_id WHERE r.tenant_id=? ORDER BY r.created_at DESC`).all(tenantId(req));res.json({rows});});
app.post('/api/company/schedule/requests',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{try{const t=now();const sid=Number(req.body?.staff_id),cid=req.body?.community_id?Number(req.body.community_id):null;if(!sid)throw new Error('請選擇人員');db.prepare('INSERT INTO schedule_requests (tenant_id,staff_id,community_id,work_date,request_type,target_staff_id,reason,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),sid,cid,String(req.body.work_date||''),String(req.body.request_type||'leave'),req.body.target_staff_id?Number(req.body.target_staff_id):null,String(req.body.reason||''),'approved',getUser(req).id,t,t);res.json({success:true});}catch(e){res.status(400).json({error:e.message||'請假／代班紀錄建立失敗'});}});
app.get('/api/company/schedule/overtime',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{const rows=db.prepare(`SELECT o.*,u.name staff_name,u.employee_id,c.name community_name FROM schedule_overtime o JOIN staff_users u ON u.id=o.staff_id LEFT JOIN communities c ON c.id=o.community_id WHERE o.tenant_id=? ORDER BY o.work_date DESC,o.id DESC`).all(tenantId(req));res.json({rows});});
app.post('/api/company/schedule/overtime',requireCompanyAdmin,requireCompanyPermission('schedule'),(req,res)=>{try{const sid=Number(req.body?.staff_id),cid=req.body?.community_id?Number(req.body.community_id):null,h=Number(req.body?.hours||0);if(!sid||!(h>0))throw new Error('請填寫人員與加班時數');const t=now();db.prepare('INSERT INTO schedule_overtime (tenant_id,staff_id,community_id,work_date,hours,category,shift_code,reason,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(tenantId(req),sid,cid,String(req.body.work_date||''),h,String(req.body.category||''),String(req.body.shift_code||''),String(req.body.reason||''),'pending',getUser(req).id,t,t);res.json({success:true});}catch(e){res.status(400).json({error:e.message||'加班紀錄建立失敗'});}});

// 現場行政：經理／秘書只能查看公司鎖定的社區排班規則，不能修改規則；班表則查看該社區現場完整結果。
function staffAdminCommunityIds(u){
  return [...new Set(getSiteAssignments(u).map(x=>Number(x.community_id)).filter(Boolean))];
}
function requireStaffScheduleAdmin(req,res,next){
  const u=getUser(req); const p=scheduleGetProfile(tenantId(req),u.id);
  if(!p || p.schedule_role!=='admin') return res.status(403).json({error:'此功能僅提供社區經理／秘書使用。'});
  next();
}
app.get('/api/staff/schedule/community',requireStaff,requireStaffScheduleAdmin,(req,res)=>{
  const u=getUser(req), ids=staffAdminCommunityIds(u), month=scheduleMonth(req.query?.month);
  if(!ids.length) return res.json({month,communities:[],entries:[],rules:[]});
  const ph=ids.map(()=>'?').join(',');
  const communities=db.prepare(`SELECT id,name,status FROM communities WHERE tenant_id=? AND status='active' AND id IN (${ph}) ORDER BY name`).all(tenantId(req),...ids);
  const entries=db.prepare(`SELECT e.*,u.name staff_name,u.employee_id,c.name community_name FROM schedule_entries e JOIN staff_users u ON u.id=e.staff_id LEFT JOIN communities c ON c.id=e.community_id WHERE e.tenant_id=? AND e.month=? AND e.community_id IN (${ph}) ORDER BY e.work_date,u.employee_id`).all(tenantId(req),month,...ids);
  const rules=communities.map(c=>({community_id:c.id,name:c.name,admin:scheduleGetRule(tenantId(req),c.id,'admin').config}));
  res.json({month,communities,entries,rules});
});
app.get('/api/staff/schedule/rules',requireStaff,requireStaffScheduleAdmin,(req,res)=>{
  const u=getUser(req), ids=staffAdminCommunityIds(u), ph=ids.map(()=>'?').join(',');
  if(!ids.length) return res.json({rules:[]});
  const communities=db.prepare(`SELECT id,name FROM communities WHERE tenant_id=? AND status='active' AND id IN (${ph}) ORDER BY name`).all(tenantId(req),...ids);
  const rules=communities.map(c=>({community_id:c.id,name:c.name,config:scheduleGetRule(tenantId(req),c.id,'admin').config}));
  res.json({rules});
});
app.get('/api/staff/schedule/requests',requireStaff,requireStaffScheduleAdmin,(req,res)=>{
  const u=getUser(req), ids=staffAdminCommunityIds(u), ph=ids.map(()=>'?').join(',');
  if(!ids.length) return res.json({rows:[]});
  const rows=db.prepare(`SELECT r.*,u.name staff_name,t.name target_staff_name,c.name community_name FROM schedule_requests r JOIN staff_users u ON u.id=r.staff_id LEFT JOIN staff_users t ON t.id=r.target_staff_id LEFT JOIN communities c ON c.id=r.community_id WHERE r.tenant_id=? AND r.community_id IN (${ph}) ORDER BY r.work_date DESC,r.created_at DESC`).all(tenantId(req),...ids);
  res.json({rows});
});
app.get('/api/staff/schedule/overtime',requireStaff,requireStaffScheduleAdmin,(req,res)=>{
  const u=getUser(req), ids=staffAdminCommunityIds(u), ph=ids.map(()=>'?').join(',');
  if(!ids.length) return res.json({rows:[]});
  const rows=db.prepare(`SELECT o.*,u.name staff_name,u.employee_id,c.name community_name FROM schedule_overtime o JOIN staff_users u ON u.id=o.staff_id LEFT JOIN communities c ON c.id=o.community_id WHERE o.tenant_id=? AND o.community_id IN (${ph}) ORDER BY o.work_date DESC,o.id DESC`).all(tenantId(req),...ids);
  res.json({rows});
});

// 現場人員：機動／保全的自選休假與自己的班表資料，後端先備妥；前台介面可獨立接上，不會看到行政資料。
app.get('/api/staff/schedule/month',requireStaffFiller,(req,res)=>{const month=scheduleMonth(req.query?.month);const u=getUser(req);const p=scheduleGetProfile(tenantId(req),u.id);if(!p)return res.status(404).json({error:'尚未設定班表身分'});const category=p.schedule_role;const rows=db.prepare('SELECT e.*,c.name community_name FROM schedule_entries e LEFT JOIN communities c ON c.id=e.community_id WHERE e.tenant_id=? AND e.month=? AND e.staff_id=? ORDER BY e.work_date').all(tenantId(req),month,u.id);res.json({month,category,profile:p,entries:rows,problems:scheduleValidateEntries(tenantId(req),month).filter(x=>x.staff_id===u.id)});});
app.post('/api/staff/schedule/self-select',requireStaffFiller,(req,res)=>{try{const u=getUser(req),p=scheduleGetProfile(tenantId(req),u.id);if(!p||!['security','mobile'].includes(p.schedule_role))return res.status(403).json({error:'目前只有保全／機動可使用自選休假'});const month=scheduleMonth(req.body?.month),date=String(req.body?.work_date||'');if(!scheduleWorkdays(month).includes(date))throw new Error('日期不在所選月份');const used=db.prepare("SELECT COUNT(*) c FROM schedule_entries WHERE tenant_id=? AND month=? AND staff_id=? AND shift_code='off' AND source='self-select'").get(tenantId(req),month,u.id).c;if(used>=Number(p.self_select_days||2))throw new Error(`本月最多可自選 ${p.self_select_days||2} 天`);
  const ids=(p.community_ids||[]).map(Number).filter(Boolean);
  const placeholders=ids.map(()=>'?').join(',')||'NULL';
  const conflictSecurity=db.prepare(`SELECT e.id,e.staff_id,e.community_id,e.work_date FROM schedule_entries e WHERE e.tenant_id=? AND e.work_date=? AND e.shift_code='off' AND e.category='security' AND e.staff_id<>? AND e.community_id IN (${placeholders}) LIMIT 1`).get(tenantId(req),date,u.id,...ids);
  if(conflictSecurity)throw new Error('此日期與支援社區的保全休假衝突，請選擇其他日期。');
  const mobileSelf=db.prepare("SELECT community_id FROM schedule_entries WHERE tenant_id=? AND work_date=? AND shift_code='off' AND source='self-select' AND category='mobile' AND staff_id<>?").all(tenantId(req),date,u.id);
  if(mobileSelf.some(r=>ids.includes(Number(r.community_id))))throw new Error('此日期已被其他支援相同社區的機動人員先選走，請選擇其他日期。');
  scheduleUpsertEntry(tenantId(req),{staff_id:u.id,community_id:(p.community_ids||[])[0]||null,work_date:date,category:p.schedule_role,shift_code:'off',source:'self-select',note:'人員自選休假'},u.id);res.json({success:true});
}catch(e){res.status(400).json({error:e.message||'自選休假失敗'});}});


app.listen(PORT,()=>console.log(`V4 伺服器已啟動：http://localhost:${PORT}`));
