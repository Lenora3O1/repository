const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'data.sqlite'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    current_page INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
  );
`);

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// V3 compatibility columns
addColumnIfMissing('submissions', 'employee_id', "TEXT DEFAULT ''");
addColumnIfMissing('submissions', 'employee_name', "TEXT DEFAULT ''");
addColumnIfMissing('submissions', 'updated_at', "TEXT DEFAULT ''");

// V4 multi-tenant / RBAC columns
addColumnIfMissing('staff_users', 'role', "TEXT DEFAULT 'staff'");
addColumnIfMissing('staff_users', 'tenant_id', "INTEGER");
addColumnIfMissing('staff_users', 'last_login_at', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'admin_level', "TEXT DEFAULT 'admin'");
// V5.4：職員資料骨架欄位；先建立欄位，實際內容由後續公司後台人事功能維護。
addColumnIfMissing('staff_users', 'position', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'trial_end_date', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'formal_salary', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'insurance_level', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'health_dependents', "INTEGER DEFAULT 0");
addColumnIfMissing('staff_users', 'work_type', "TEXT DEFAULT 'site'");
addColumnIfMissing('staff_users', 'job_category', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'job_level', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'permission_json', "TEXT DEFAULT '[]'");
addColumnIfMissing('staff_users', 'job_categories_json', "TEXT DEFAULT '[]'");
addColumnIfMissing('staff_users', 'person_uid', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'person_status', "TEXT DEFAULT 'active'");
addColumnIfMissing('submissions', 'tenant_id', "INTEGER");
addColumnIfMissing('submissions', 'community_id', "INTEGER");
addColumnIfMissing('drafts', 'tenant_id', "INTEGER");
addColumnIfMissing('drafts', 'community_id', "INTEGER");
addColumnIfMissing('templates', 'tenant_id', "INTEGER");

// V4.6：員編改為「公司內唯一」，不同公司可以使用相同員編（例如 A001）。
// 舊版曾在 employee_id 上建立全系統 UNIQUE，這裡安全地重建 staff_users / staff_communities 後改用複合唯一索引。
function migrateEmployeeIdUniqueness() {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='staff_users'").get()?.sql || '';
  if (!/employee_id[^,]*\bUNIQUE\b/i.test(sql)) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_tenant_employee ON staff_users(tenant_id, employee_id)');
    return;
  }
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      ALTER TABLE staff_communities RENAME TO staff_communities_legacy;
      ALTER TABLE staff_users RENAME TO staff_users_legacy;
      CREATE TABLE staff_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        role TEXT DEFAULT 'staff',
        tenant_id INTEGER,
        last_login_at TEXT DEFAULT '',
        admin_level TEXT DEFAULT 'admin'
      );
      INSERT INTO staff_users (id,employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,last_login_at,admin_level)
        SELECT id,employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,last_login_at,admin_level FROM staff_users_legacy;
      CREATE UNIQUE INDEX idx_staff_users_tenant_employee ON staff_users(tenant_id, employee_id);
      CREATE TABLE staff_communities (
        staff_id INTEGER NOT NULL,
        community_id INTEGER NOT NULL,
        PRIMARY KEY (staff_id, community_id),
        FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      );
      INSERT INTO staff_communities (staff_id,community_id) SELECT staff_id,community_id FROM staff_communities_legacy;
      DROP TABLE staff_communities_legacy;
      DROP TABLE staff_users_legacy;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
migrateEmployeeIdUniqueness();

// V5.4：若舊版因員編唯一性而重建過 staff_users，上述欄位需要再次補上。
addColumnIfMissing('staff_users', 'position', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'trial_end_date', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'formal_salary', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'insurance_level', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'health_dependents', "INTEGER DEFAULT 0");
addColumnIfMissing('staff_users', 'work_type', "TEXT DEFAULT 'site'");
addColumnIfMissing('staff_users', 'job_category', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'job_level', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'permission_json', "TEXT DEFAULT '[]'");
addColumnIfMissing('staff_users', 'job_categories_json', "TEXT DEFAULT '[]'");
addColumnIfMissing('staff_users', 'person_uid', "TEXT DEFAULT ''");
addColumnIfMissing('staff_users', 'person_status', "TEXT DEFAULT 'active'");

// New tenant tables

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
  CREATE TABLE IF NOT EXISTS staff_communities (
    staff_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    PRIMARY KEY (staff_id, community_id),
    FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );
`);


// V5.6 人員／工作環境架構：公司內勤與現場駐點可分開管理；一人可多案場、多職務。
db.exec(`
  CREATE TABLE IF NOT EXISTS staff_work_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'site',
    community_id INTEGER,
    job_categories_json TEXT NOT NULL DEFAULT '[]',
    job_level TEXT NOT NULL DEFAULT '',
    permissions_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_staff_work_assignments_staff ON staff_work_assignments(staff_id);
  CREATE INDEX IF NOT EXISTS idx_staff_work_assignments_scope ON staff_work_assignments(tenant_id,scope_type,community_id);
  CREATE TABLE IF NOT EXISTS staff_person_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_uid TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    employee_id TEXT NOT NULL,
    name TEXT NOT NULL,
    person_status TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    archived_by_staff_id INTEGER,
    snapshot_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_staff_person_archive_tenant ON staff_person_archive(tenant_id,person_status);
`);
function ensurePersonUids(){
  const rows=db.prepare("SELECT id FROM staff_users WHERE COALESCE(person_uid,'')='' ORDER BY id").all();
  const up=db.prepare("UPDATE staff_users SET person_uid=? WHERE id=?");
  for(const r of rows) up.run('P'+String(r.id).padStart(8,'0'),r.id);
}
ensurePersonUids();

// V4.1.6 company white-label / branding settings
addColumnIfMissing('tenants', 'brand_title', "TEXT DEFAULT ''");
addColumnIfMissing('tenants', 'brand_subtitle', "TEXT DEFAULT ''");
addColumnIfMissing('tenants', 'brand_login_title', "TEXT DEFAULT ''");
addColumnIfMissing('tenants', 'brand_login_hint', "TEXT DEFAULT ''");
addColumnIfMissing('tenants', 'brand_intro', "TEXT DEFAULT ''");
addColumnIfMissing('tenants', 'brand_logo_text', "TEXT DEFAULT ''");
addColumnIfMissing('tenants', 'brand_accent', "TEXT DEFAULT '#2F6F5E'");
addColumnIfMissing('tenants', 'brand_accent_dark', "TEXT DEFAULT '#204F42'");
addColumnIfMissing('tenants', 'brand_bg', "TEXT DEFAULT '#F7F7F4'");
addColumnIfMissing('tenants', 'brand_panel', "TEXT DEFAULT '#FFFFFF'");

// Company admin hierarchy: the first company_admin of each company is the owner.
db.prepare("UPDATE staff_users SET admin_level='owner' WHERE role='company_admin' AND id IN (SELECT MIN(id) FROM staff_users WHERE role='company_admin' AND tenant_id IS NOT NULL GROUP BY tenant_id)").run();

function makePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function createStaff(employeeId, name, password, role='staff', tenantId=null) {
  const now = new Date().toISOString();
  const { salt, hash } = makePassword(password);
  const info = db.prepare(`INSERT INTO staff_users (employee_id,name,password_hash,password_salt,is_active,created_at,updated_at,role,tenant_id,admin_level) VALUES (?,?,?,?,1,?,?,?,?,?)`)
    .run(employeeId.trim(), name.trim(), hash, salt, now, now, role, tenantId, role==='company_admin'?'owner':'');
  return info.lastInsertRowid;
}

function slugCode(name) {
  const base = String(name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
  let code = base, n = 2;
  while (db.prepare('SELECT id FROM tenants WHERE code=?').get(code)) code = `${base}-${n++}`;
  return code;
}

function ensureTenant() {
  let tenant = db.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
  if (!tenant) {
    const now = new Date().toISOString();
    const name = process.env.DEFAULT_TENANT_NAME || '示範物業管理公司';
    const code = process.env.DEFAULT_TENANT_CODE || slugCode(name);
    const info = db.prepare('INSERT INTO tenants (name,code,status,created_at,updated_at) VALUES (?,?,?,?,?)').run(name, code, 'active', now, now);
    tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(info.lastInsertRowid);
  }
  return tenant;
}

const defaultTenant = ensureTenant();

const brandDefaults = {title: defaultTenant.name || '物業管理公司', subtitle: '物業管理公司', loginTitle: '公司管理員登入', loginHint: '這裡是公司專屬管理後台。登入後可管理人員、社區與公司資料。', intro: '這裡只管理您所屬公司的資料。', logoText: ''};
db.prepare(`UPDATE tenants SET
  brand_title=COALESCE(NULLIF(brand_title,''), @title),
  brand_subtitle=COALESCE(NULLIF(brand_subtitle,''), @subtitle),
  brand_login_title=COALESCE(NULLIF(brand_login_title,''), @loginTitle),
  brand_login_hint=COALESCE(NULLIF(brand_login_hint,''), @loginHint),
  brand_intro=COALESCE(NULLIF(brand_intro,''), @intro),
  brand_logo_text=COALESCE(brand_logo_text,'')
`).run({
  title: brandDefaults.title,
  subtitle: brandDefaults.subtitle,
  loginTitle: brandDefaults.loginTitle,
  loginHint: brandDefaults.loginHint,
  intro: brandDefaults.intro
});

// Migrate all V3 staff/drafts/submissions/templates into the first tenant.
db.prepare("UPDATE staff_users SET tenant_id=? WHERE tenant_id IS NULL").run(defaultTenant.id);

// V4.4：共用修改紀錄基礎，供後續各社區模組記錄「誰、何時、修改什麼」。
db.exec(`CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  community_id INTEGER,
  employee_id TEXT DEFAULT '',
  employee_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_type TEXT DEFAULT '',
  record_id TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL
)`);

// V4.4：平台目錄設定。scope 可為 staff / company，tenant_id 為 null 表示平台預設；
// 未來可為單一公司建立 tenant-specific 覆寫，不影響其他公司。
db.exec(`CREATE TABLE IF NOT EXISTS menu_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  tenant_id INTEGER,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT DEFAULT '',
  UNIQUE(scope, tenant_id)
)`);

// V4.5：每位現場人員自己的儀表板釘選項目。
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  menu_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(staff_id, menu_id),
  FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
)`);

// V5.1：現場人員代辦事項。每位人員獨立保存，完成後不刪除，改為封存並保留時間。
db.exec(`CREATE TABLE IF NOT EXISTS staff_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  created_by_id INTEGER,
  created_by_name TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  completed_by_id INTEGER,
  completed_by_name TEXT DEFAULT '',
  FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_todos_staff_status ON staff_todos(staff_id, tenant_id, status, created_at)`);

db.prepare("UPDATE submissions SET tenant_id=(SELECT tenant_id FROM staff_users WHERE staff_users.employee_id=submissions.employee_id) WHERE tenant_id IS NULL").run();
db.prepare("UPDATE submissions SET tenant_id=? WHERE tenant_id IS NULL").run(defaultTenant.id);
db.prepare("UPDATE drafts SET tenant_id=(SELECT tenant_id FROM staff_users WHERE staff_users.employee_id=drafts.employee_id) WHERE tenant_id IS NULL").run();
db.prepare("UPDATE drafts SET tenant_id=? WHERE tenant_id IS NULL").run(defaultTenant.id);
db.prepare("UPDATE templates SET tenant_id=? WHERE tenant_id IS NULL").run(defaultTenant.id);

function ensureDefaultCommunity() {
  let c = db.prepare('SELECT * FROM communities WHERE tenant_id=? ORDER BY id LIMIT 1').get(defaultTenant.id);
  if (!c) {
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO communities (tenant_id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run(defaultTenant.id, '示範社區', 'active', now, now);
    c = db.prepare('SELECT * FROM communities WHERE id=?').get(info.lastInsertRowid);
  }
  return c;
}
const defaultCommunity = ensureDefaultCommunity();

function ensureDefaultStaff() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM staff_users').get().c;
  if (count === 0) {
    const employeeId = process.env.DEFAULT_EMPLOYEE_ID || 'A001';
    const password = process.env.DEFAULT_EMPLOYEE_PASS || '1234';
    const name = process.env.DEFAULT_EMPLOYEE_NAME || '測試人員';
    const id = createStaff(employeeId, name, password, 'staff', defaultTenant.id);
    db.prepare('INSERT OR IGNORE INTO staff_communities (staff_id,community_id) VALUES (?,?)').run(id, defaultCommunity.id);
    console.log(`已建立初始填表人員：${employeeId}`);
  }
  const companyAdminCount = db.prepare("SELECT COUNT(*) AS c FROM staff_users WHERE role='company_admin'").get().c;
  if (companyAdminCount === 0) {
    const employeeId = process.env.DEFAULT_COMPANY_ADMIN_ID || 'CA001';
    const password = process.env.DEFAULT_COMPANY_ADMIN_PASS || '1234';
    const name = process.env.DEFAULT_COMPANY_ADMIN_NAME || '示範公司管理員';
    if (!db.prepare('SELECT id FROM staff_users WHERE employee_id=?').get(employeeId)) {
      createStaff(employeeId, name, password, 'company_admin', defaultTenant.id);
      console.log(`已建立示範公司管理員：${employeeId}`);
    }
  }
}
ensureDefaultStaff();
// Existing V3 staff get the default community until the company manager customizes access.
const unassignedStaff = db.prepare('SELECT u.id FROM staff_users u LEFT JOIN staff_communities sc ON sc.staff_id=u.id WHERE u.tenant_id=? GROUP BY u.id HAVING COUNT(sc.community_id)=0').all(defaultTenant.id);
const assignDefault = db.prepare('INSERT OR IGNORE INTO staff_communities (staff_id,community_id) VALUES (?,?)');
for (const u of unassignedStaff) assignDefault.run(u.id, defaultCommunity.id);

module.exports = db;
module.exports.makePassword = makePassword;
module.exports.verifyPassword = verifyPassword;
