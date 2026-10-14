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

  // 平台公版文件／公司資源（與交接 Word 範本分離，支援一般文書檔案）
  db.exec(`CREATE TABLE IF NOT EXISTS platform_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT DEFAULT '',
    extension TEXT DEFAULT '',
    category TEXT DEFAULT '一般平台公版',
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS company_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    platform_resource_id INTEGER,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT DEFAULT '',
    extension TEXT DEFAULT '',
    category TEXT DEFAULT '公司資源',
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  )`);

  // V4.7：舊版正式資料庫可能已建立資源表，但缺少 name 欄位；
  // CREATE TABLE IF NOT EXISTS 不會替既有資料表補欄位，因此啟動時安全補欄並以原始檔名回填。
  for (const table of ['platform_resources','company_resources']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c=>String(c.name));
    if (cols.length && !cols.includes('name')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN name TEXT`);
      const nowCols = db.prepare(`PRAGMA table_info(${table})`).all().map(c=>String(c.name));
      if (nowCols.includes('original_name')) {
        db.exec(`UPDATE ${table} SET name=original_name WHERE name IS NULL OR trim(name)=''`);
      }
    }
  }

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
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    sender_employee_id TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    recipient_employee_id TEXT NOT NULL DEFAULT '',
    recipient_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages(tenant_id,recipient_id,read_at,created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(tenant_id,sender_id,created_at);
  CREATE TABLE IF NOT EXISTS message_typing (
    tenant_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id,sender_id,recipient_id)
  );
  CREATE INDEX IF NOT EXISTS idx_message_typing_recipient ON message_typing(tenant_id,recipient_id,expires_at);
  CREATE TABLE IF NOT EXISTS message_audit_settings (
    tenant_id INTEGER PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    auditor_ids_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
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

// V6：智慧住戶名冊。每次匯入保留版本，前台只顯示該案場／分類最新啟用版本。
db.exec(`CREATE TABLE IF NOT EXISTS resident_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL,
  category TEXT NOT NULL, original_filename TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL, imported_by INTEGER,
  imported_by_name TEXT DEFAULT '', row_count INTEGER NOT NULL DEFAULT 0, detected_fields_json TEXT DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resident_imports_current ON resident_imports(tenant_id,community_id,category,is_active,imported_at);
CREATE TABLE IF NOT EXISTS resident_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, category TEXT NOT NULL,
  building TEXT DEFAULT '', unit TEXT DEFAULT '', floor TEXT DEFAULT '', name TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', extra TEXT DEFAULT '', raw_json TEXT DEFAULT '{}',
  FOREIGN KEY (import_id) REFERENCES resident_imports(id) ON DELETE CASCADE, FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resident_records_current ON resident_records(tenant_id,community_id,category,import_id);
CREATE TABLE IF NOT EXISTS resident_sort_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, category TEXT NOT NULL, sort_key TEXT NOT NULL DEFAULT 'building', updated_at TEXT NOT NULL,
  UNIQUE(staff_id,community_id,category), FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE, FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);`);

// V5.10：案場 SOP。SOP 屬於公司，可指定全部案場或特定案場；檔案實體存放於 DATA_DIR/uploads/sops。
db.exec(`CREATE TABLE IF NOT EXISTS sops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '行政',
  description TEXT DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0',
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT DEFAULT '',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sops_tenant_category ON sops(tenant_id, category, is_active, updated_at);
CREATE TABLE IF NOT EXISTS sop_communities (
  sop_id INTEGER NOT NULL,
  community_id INTEGER NOT NULL,
  PRIMARY KEY (sop_id, community_id),
  FOREIGN KEY (sop_id) REFERENCES sops(id) ON DELETE CASCADE,
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sop_communities_community ON sop_communities(community_id, sop_id);
`);
// V5.11：SOP 智慧分流。保留既有 SOP，新增「公司基本／案場」來源、上傳人員與職務對象。
addColumnIfMissing('sops', 'scope_type', "TEXT DEFAULT 'company_basic'");
addColumnIfMissing('sops', 'target_jobs_json', "TEXT DEFAULT '[]'");
addColumnIfMissing('sops', 'source_type', "TEXT DEFAULT 'company'");
addColumnIfMissing('sops', 'uploader_staff_id', "INTEGER");
addColumnIfMissing('sops', 'uploader_name', "TEXT DEFAULT ''");
addColumnIfMissing('sops', 'review_status', "TEXT DEFAULT 'published'");
// 舊 SOP 視為公司基本 SOP，確保升級後原有內容仍會回到前台。
db.prepare("UPDATE sops SET scope_type='company_basic' WHERE scope_type IS NULL OR scope_type=''").run();
db.prepare("UPDATE sops SET target_jobs_json='[]' WHERE target_jobs_json IS NULL OR target_jobs_json=''").run();
db.prepare("UPDATE sops SET source_type='company' WHERE source_type IS NULL OR source_type=''").run();
db.prepare("UPDATE sops SET review_status='published' WHERE review_status IS NULL OR review_status=''").run();

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

// V5.6.2：更完整地修復同名公司被拆成多個 tenant 的問題。
// 背景：若舊版部署／初始化曾建立第二個「同名公司」，公司管理員可能在 tenant A，
// 一般人員／社區卻仍在 tenant B，造成總後台看得到、公司後台看不到。
// 本修復只處理「完全同名」的 tenant，並以「有公司管理員的 tenant」作為公司主 tenant。
// 為避免誤合併：若同名 tenant 之間存在相同員編，整組不自動合併，只記錄警告。

// 出勤／巡邏模組 V2：公司地點設定、巡邏 QR、出勤與巡邏紀錄。
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    location_type TEXT NOT NULL DEFAULT 'attendance',
    name TEXT NOT NULL,
    lat REAL,
    lng REAL,
    radius_m INTEGER NOT NULL DEFAULT 100,
    qr_token TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    address TEXT DEFAULT '',
    place_id TEXT DEFAULT '',
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_locations_tenant_community ON attendance_locations(tenant_id,community_id,location_type,is_active);
  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    location_id INTEGER,
    record_type TEXT NOT NULL,
    qr_token TEXT DEFAULT '',
    lat REAL,
    lng REAL,
    accuracy_m REAL,
    recorded_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'online',
    client_record_id TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES attendance_locations(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_client ON attendance_records(tenant_id,staff_id,client_record_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_date ON attendance_records(tenant_id,community_id,recorded_at);
  CREATE INDEX IF NOT EXISTS idx_attendance_records_staff_date ON attendance_records(tenant_id,staff_id,recorded_at);
  CREATE TABLE IF NOT EXISTS patrol_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    time_label TEXT DEFAULT '',
    note TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_patrol_routes_tenant_community ON patrol_routes(tenant_id,community_id,is_active);
  CREATE TABLE IF NOT EXISTS patrol_route_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,
    location_id INTEGER NOT NULL,
    sequence_no INTEGER NOT NULL,
    UNIQUE(route_id,location_id),
    UNIQUE(route_id,sequence_no),
    FOREIGN KEY (route_id) REFERENCES patrol_routes(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES attendance_locations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_patrol_route_points_route ON patrol_route_points(route_id,sequence_no);
  CREATE TABLE IF NOT EXISTS patrol_staff_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id,community_id,staff_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_patrol_staff_assignments_site ON patrol_staff_assignments(tenant_id,community_id,is_active);
`);

// 相容既有資料庫：不覆蓋原有巡邏地點，只補上地址與 Google Place ID 欄位。
addColumnIfMissing('attendance_locations', 'address', "TEXT DEFAULT ''");
addColumnIfMissing('attendance_locations', 'place_id', "TEXT DEFAULT ''");
addColumnIfMissing('attendance_records', 'patrol_route_id', 'INTEGER');

function repairDuplicateNamedTenants() {
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY id').all();
  const norm = v => String(v || '').trim().replace(/\\s+/g, '');
  const byName = new Map();
  for (const t of tenants) {
    const key = norm(t.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(t);
  }

  for (const [nameKey, group] of byName) {
    if (group.length < 2) continue;

    const stats = group.map(t => {
      const staff = db.prepare("SELECT id,employee_id,role FROM staff_users WHERE tenant_id=?").all(t.id);
      const communities = db.prepare('SELECT id,name,status FROM communities WHERE tenant_id=?').all(t.id);
      return {
        tenant: t,
        admins: staff.filter(x => x.role === 'company_admin'),
        staff: staff.filter(x => x.role === 'staff'),
        allStaff: staff,
        communities
      };
    });

    const adminTenants = stats.filter(x => x.admins.length > 0);
    const dataTenants = stats.filter(x => x.staff.length > 0 || x.communities.length > 0);
    if (adminTenants.length !== 1 || dataTenants.length === 0) {
      console.warn(`[V5.6.2] 同名公司暫不自動合併：${group[0].name}；管理員公司=${adminTenants.length}，有一般資料公司=${dataTenants.length}`);
      continue;
    }

    const target = adminTenants[0];
    const sources = stats.filter(x => x.tenant.id !== target.tenant.id && (x.staff.length > 0 || x.communities.length > 0));
    if (!sources.length) continue;

    const targetEmployeeIds = new Set(target.allStaff.map(x => String(x.employee_id)));
    const sourceEmployeeIds = sources.flatMap(x => x.allStaff.map(y => String(y.employee_id)));
    const allSourceCounts = new Map();
    for (const e of sourceEmployeeIds) allSourceCounts.set(e, (allSourceCounts.get(e) || 0) + 1);
    const duplicateEmployeeIds = sourceEmployeeIds.filter(e => targetEmployeeIds.has(e) || (allSourceCounts.get(e) || 0) > 1);
    if (duplicateEmployeeIds.length) {
      console.warn(`[V5.6.2] 同名公司存在員編衝突，為安全起見不自動合併：${group[0].name}；衝突：${[...new Set(duplicateEmployeeIds)].join(', ')}`);
      continue;
    }

    const dbFile = path.join(DATA_DIR, 'data.sqlite');
    const backupDir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `data.sqlite.before-v5.6.2-${Date.now()}.bak`);
    try { fs.copyFileSync(dbFile, backupFile); } catch (e) {
      console.error('[V5.6.2] 無法建立資料庫備份，取消 tenant 合併：', e.message);
      continue;
    }

    try {
      const tx = db.transaction(() => {
        for (const source of sources) {
          const sourceId = Number(source.tenant.id);
          const targetId = Number(target.tenant.id);

          db.prepare('UPDATE staff_users SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE communities SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE staff_work_assignments SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE staff_person_archive SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE submissions SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE drafts SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE templates SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE audit_logs SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE dashboard_pins SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE staff_todos SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE sops SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE attendance_locations SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);
          db.prepare('UPDATE attendance_records SET tenant_id=? WHERE tenant_id=?').run(targetId, sourceId);

          const sourceMenus = db.prepare('SELECT id,scope FROM menu_configs WHERE tenant_id=?').all(sourceId);
          for (const m of sourceMenus) {
            const exists = db.prepare('SELECT id FROM menu_configs WHERE tenant_id=? AND scope=?').get(targetId, m.scope);
            if (exists) db.prepare('DELETE FROM menu_configs WHERE id=?').run(m.id);
            else db.prepare('UPDATE menu_configs SET tenant_id=? WHERE id=?').run(targetId, m.id);
          }

          // 同名來源 tenant 已完成資料搬遷；保留 tenant 本身作為停用紀錄，避免歷史 ID 被重用。
          db.prepare("UPDATE tenants SET status='inactive', updated_at=? WHERE id=?").run(new Date().toISOString(), sourceId);
        }
      });
      tx();
      console.warn(`[V5.6.2] 已修復同名公司：${target.tenant.name}；主 tenant=${target.tenant.id}，來源 tenant=${sources.map(x => x.tenant.id).join(',')}`);
    } catch (e) {
      console.error(`[V5.6.2] tenant 合併失敗，交易已回滾：${e.message}；備份：${backupFile}`);
    }
  }
}
repairDuplicateNamedTenants();

module.exports = db;
module.exports.makePassword = makePassword;
module.exports.verifyPassword = verifyPassword;
