// Excel 批次匯入：人事（開通帳號＋人事資料）、薪資（會計）
// 流程：下載範本（空白或含目前人員）→ 填好上傳 → 預覽（每一列檢查、標出錯誤與提醒，不寫入）→ 確認匯入 → 新帳號的臨時密碼清單
// 規則：員編（或手機）已存在＝更新，空白的格子保留原本資料；不存在＝開通新帳號（需要「人員管理」權限）
'use strict';
const crypto = require('crypto');
const { buildXlsx } = require('./xlsx-writer');
const OM = require('./org-model');

module.exports = function registerStaffImport(app, d) {
  const { db, XLSX, multer, LI, getUser, tenantId, now, requireCompanyAdmin, getOrg, getPayroll, getPlans, hasPermission, getSiteAssignments } = d;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => { console.error('[import]', e); if (!res.headersSent) bad(res, e.status ? e.message : '處理失敗，請稍後再試', e.status || 500); }); } catch (e) { console.error('[import]', e); if (!res.headersSent) bad(res, e.status ? e.message : '處理失敗，請稍後再試', e.status || 500); } };
  const str = (v, m = 200) => String(v ?? '').trim().slice(0, m);
  const org = () => getOrg(), pay = () => getPayroll();
  const canStaff = u => !!u && (u.role === 'company_admin' || hasPermission(u, 'manage-staff'));
  const canHR = u => { try { return !!pay()?.canHR(u); } catch { return false; } };
  const canPayroll = u => { try { return !!pay()?.canPayroll(u); } catch { return false; } };
  const tempPassword = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'; const D = '23456789'; const r = crypto.randomBytes(10); let s = ''; for (let i = 0; i < 6; i++) s += A[r[i] % A.length]; for (let i = 6; i < 10; i++) s += D[r[i] % D.length]; return s; };

  // ---------- 值的整理 ----------
  const pad = n => String(n).padStart(2, '0');
  function toDate(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { const dt = new Date(Math.round((v - 25569) * 864e5)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    let s = String(v).trim().replace(/^民國\s*/, '').replace(/年|月/g, '/').replace(/日/g, '').replace(/[.\-]/g, '/').replace(/\s+.*$/, '');
    if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6)}`;
    if (/^\d{7}$/.test(s)) s = `${s.slice(0, 3)}/${s.slice(3, 5)}/${s.slice(5)}`;
    const m = /^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/.exec(s); if (!m) return null;
    let y = Number(m[1]); if (y < 1000) y += 1911;
    const mo = Number(m[2]), da = Number(m[3]); const dt = new Date(Date.UTC(y, mo - 1, da));
    if (dt.getUTCMonth() !== mo - 1 || y < 1900 || y > 2100) return null;
    return `${y}-${pad(mo)}-${pad(da)}`;
  }
  function yesNo(v) { const s = String(v ?? '').trim().toLowerCase(); if (!s) return undefined; if (/^(是|有|y|yes|v|✓|o|1|true|加保|要)$/.test(s)) return true; if (/^(否|無|沒有|n|no|x|0|false|不|不加保|不要)$/.test(s)) return false; return null; }
  function phone(v) { let s = String(v ?? '').replace(/[^\d+]/g, ''); if (/^9\d{8}$/.test(s)) s = '0' + s; if (/^8869\d{8}$/.test(s)) s = '0' + s.slice(3); if (/^\+8869\d{8}$/.test(s)) s = '0' + s.slice(4); return s; }
  const text = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : str(v, 300);

  // ---------- 範本欄位 ----------
  const STAFF_COLS = [
    { key: 'employee_id', label: '員編', w: 12, alias: ['員工編號', '工號', '帳號'] },
    { key: 'name', label: '姓名', w: 12, req: true },
    { key: 'mobile', label: '手機', w: 14, alias: ['手機號碼', '行動電話', '電話'] },
    { key: 'position', label: '職位', w: 16, alias: ['職稱', '職務'] },
    { key: 'communities', label: '駐點社區', w: 20, alias: ['社區', '駐點', '案場', '所屬社區'] },
    { key: 'shift', label: '班別', w: 8 },
    { key: 'regions', label: '負責區域', w: 14, alias: ['區域'] },
    { key: 'hire_date', label: '到職日', w: 12, alias: ['到職日期', '報到日'] },
    { key: 'trial_end_date', label: '試用期到期日', w: 14, alias: ['試用期滿', '試用到期日'] },
    { key: 'gender', label: '性別', w: 7 },
    { key: 'id_type', label: '證件類別', w: 10 },
    { key: 'id_no', label: '證號', w: 14, alias: ['身分證字號', '身分證', '身份證字號', '統一證號', '居留證號'] },
    { key: 'nationality', label: '國籍', w: 10 },
    { key: 'birthday', label: '生日', w: 12, alias: ['出生日期', '出生年月日'] },
    { key: 'address', label: '通訊地址', w: 30, alias: ['地址', '戶籍地址', '居住地址'] },
    { key: 'emergency_name', label: '緊急聯絡人', w: 12 },
    { key: 'emergency_relation', label: '關係', w: 8, alias: ['緊急聯絡人關係'] },
    { key: 'emergency_phone', label: '緊急聯絡電話', w: 14, alias: ['緊急聯絡人電話'] },
    { key: 'insured_date', label: '加保日', w: 12, alias: ['投保日'] },
    { key: 'labor_insured', label: '勞保', w: 7 },
    { key: 'employment_insured', label: '就保', w: 7 },
    { key: 'health_insured', label: '健保', w: 7 },
    { key: 'pension_enabled', label: '勞退', w: 7 },
    { key: 'health_dependents', label: '健保眷屬人數', w: 12, alias: ['眷屬', '眷屬人數'] },
    { key: 'pay_method', label: '薪資發放', w: 10, alias: ['發薪方式'] },
    { key: 'bank_name', label: '銀行名稱', w: 14, alias: ['銀行'] },
    { key: 'bank_account', label: '銀行帳號', w: 18, alias: ['帳號（銀行）', '薪轉帳號'] },
    { key: 'annual_used', label: '系統外已休特休天數', w: 12, alias: ['已休特休'] },
    { key: 'note', label: '備註', w: 24 },
  ];
  const SALARY_COLS = [
    { key: 'employee_id', label: '員編', w: 12, req: true }, { key: 'name', label: '姓名', w: 12 },
    { key: 'base_salary', label: '正式薪資', w: 12, alias: ['底薪', '本薪', '月薪'] }, { key: 'trial_salary', label: '試用期薪資', w: 12 },
    { key: 'a1n', label: '加給1名稱', w: 12 }, { key: 'a1v', label: '加給1金額', w: 11 }, { key: 'a2n', label: '加給2名稱', w: 12 }, { key: 'a2v', label: '加給2金額', w: 11 }, { key: 'a3n', label: '加給3名稱', w: 12 }, { key: 'a3v', label: '加給3金額', w: 11 },
    { key: 'pension_self_rate', label: '勞退自提（%）', w: 12, alias: ['勞退自提'] }, { key: 'salary_note', label: '薪資備註', w: 24, alias: ['備註'] },
  ];
  const norm = s => String(s || '').replace(/[＊*\s　（）()]/g, '').replace(/[%％]/g, '').toLowerCase();
  function mapHeader(row, COLS) { const idx = {}; row.forEach((h, i) => { const n = norm(h); if (!n) return; const c = COLS.find(c => norm(c.label) === n || (c.alias || []).some(a => norm(a) === n)); if (c && idx[c.key] === undefined) idx[c.key] = i; }); return idx; }

  function companyLists(tid) {
    const cfg = org().configFor(tid);
    const positions = cfg.positions.filter(p => !['owner'].includes(p.kind));
    const communities = db.prepare("SELECT id,name FROM communities WHERE tenant_id=? AND status='active' ORDER BY name").all(tid);
    const regions = db.prepare('SELECT id,name FROM org_regions WHERE tenant_id=? ORDER BY sort,id').all(tid);
    return { cfg, positions, communities, regions };
  }

  // ---------- 範本 ----------
  function sendXlsx(res, name, buf) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'no-store'); res.end(buf);
  }
  const yn = v => v === true ? '是' : v === false ? '否' : '';
  app.get('/api/company/staff-import/template', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canHR(u) && !canStaff(u)) return bad(res, '需要人事或人員管理權限', 403);
    const tid = tenantId(req); const L = companyLists(tid); const mobileMode = LI.loginMode(tid) === 'mobile';
    const head = STAFF_COLS.map(c => c.label + (c.req || (c.key === 'mobile' && mobileMode) || (c.key === 'employee_id' && !mobileMode) || c.key === 'position' ? '＊' : ''));
    const required = new Set(STAFF_COLS.map((c, i) => head[i].endsWith('＊') ? i : -1).filter(i => i >= 0));
    const rows = [head];
    if (req.query.mode === 'current') {
      const people = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY role='company_admin' DESC,employee_id").all(tid);
      for (const p of people) {
        const h = canHR(u) ? (pay().hrBody(tid, p.id) || {}) : {}; const m = org().memberRow(tid, p.id); const pos = m ? org().posOf(L.cfg, m.position_id) : null;
        const sites = getSiteAssignments(p).map(a => L.communities.find(c => c.id === Number(a.community_id))?.name).filter(Boolean);
        let regs = []; try { regs = JSON.parse(m?.region_ids_json || '[]').map(id => L.regions.find(r => r.id === Number(id))?.name).filter(Boolean); } catch {}
        const v = { employee_id: p.employee_id, name: p.name, mobile: h.mobile || LI.mobileOf(p.id) || '', position: pos?.name || '', communities: pos?.kind === 'region' ? '' : [...new Set(sites)].join('、'), shift: m?.shift === 'night' ? '夜班' : m?.shift === 'day' ? '日班' : '', regions: regs.join('、'),
          hire_date: h.hire_date || '', trial_end_date: h.trial_end_date || '', gender: h.gender === 'M' ? '男' : h.gender === 'F' ? '女' : '', id_type: h.id_no ? ({ national: '身分證', arc: '居留證', passport: '護照' }[h.id_type] || '身分證') : '', id_no: h.id_no || '', nationality: h.nationality || '', birthday: h.birthday || '', address: h.address || '',
          emergency_name: h.emergency_name || '', emergency_relation: h.emergency_relation || '', emergency_phone: h.emergency_phone || '', insured_date: h.insured_date || '', labor_insured: canHR(u) ? yn(h.labor_insured) : '', employment_insured: canHR(u) ? yn(h.employment_insured) : '', health_insured: canHR(u) ? yn(h.health_insured) : '', pension_enabled: canHR(u) ? yn(h.pension_enabled) : '',
          health_dependents: h.health_dependents ? String(h.health_dependents) : '', pay_method: h.pay_method === 'cash' ? '現金' : canHR(u) && h.staff_id ? '轉帳' : '', bank_name: h.bank_name || '', bank_account: h.bank_account || '', annual_used: h.annual_used ? String(h.annual_used) : '', note: h.note || '' };
        rows.push(STAFF_COLS.map(c => v[c.key] ?? ''));
      }
      try { db.prepare('INSERT INTO data_access_logs (tenant_id,staff_id,employee_id,name,category,what,path,ip,at) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, u.id, u.employee_id, u.name, '人事資料', '下載人事資料（含目前人員）', req.path, String(req.ip || ''), now()); } catch {}
    }
    const col = k => STAFF_COLS.findIndex(c => c.key === k);
    const listRef = (letter, n) => `'選項'!$${letter}$2:$${letter}$${Math.max(2, n + 1)}`;
    const opt = [['職位', '駐點社區', '負責區域', '班別', '性別', '證件類別', '是／否', '薪資發放']];
    const maxN = Math.max(L.positions.length, L.communities.length, L.regions.length, 3);
    for (let i = 0; i < maxN; i++) opt.push([L.positions[i]?.name || '', L.communities[i]?.name || '', L.regions[i]?.name || '', ['日班', '夜班'][i] || '', ['男', '女'][i] || '', ['身分證', '居留證', '護照'][i] || '', ['是', '否'][i] || '', ['轉帳', '現金'][i] || '']);
    const guide = [
      ['人員資料匯入說明'], [''],
      ['1. 在「人員資料」工作表，一列填一位人員。可以直接從原本的 Excel 複製貼上（欄位順序不同也沒關係，系統依「標題」對應）。'],
      ['2. 標題有「＊」的欄位是必填（紅色標題）。其他欄位可以先空著，之後再補。'],
      [`3. ${mobileMode ? '本公司用手機號碼登入：手機必填，員編可空白（系統自動產生）。' : '員編必填；有填手機的人也可以用手機登入。'}`],
      ['4. 員編（或手機）已經在系統裡的人＝更新資料，空白的格子會保留原本的內容；不在系統裡的人＝開通新帳號。'],
      ['5. 職位、駐點社區、負責區域請用下拉選單選擇，或照「選項」工作表的名稱填寫；駐點多個社區（機動人員）用「、」分開。'],
      ['6. 日期可以寫 2024/3/5、2024-03-05 或民國 113/3/5。勞保／就保／健保／勞退填「是」或「否」，空白＝加保。'],
      ['7. 上傳後會先顯示檢查結果，確認沒問題再按「確認匯入」才會真的寫入。'],
      ['8. 新開通的帳號會產生臨時密碼清單，請交給本人；第一次登入時必須自行修改密碼。'],
      ['9. 這份檔案含有個人資料，匯入完成後請刪除，不要用 LINE 或 Email 隨意轉傳。'],
      [''], ['範例（虛構資料）：'],
      ['員編', '姓名', '手機', '職位', '駐點社區', '班別', '到職日', '證號', '勞保'],
      ['A101', '林曉明', '0912000111', L.positions.find(p => p.kind === 'site_staff')?.name || '保全員', L.communities[0]?.name || '範例社區', '日班', '2024/3/5', 'A123456789', '是'],
    ];
    const buf = buildXlsx([
      { name: '人員資料', header: true, textCols: true, freeze: 1, required, rows, widths: STAFF_COLS.map(c => c.w),
        validations: [
          L.positions.length && { col: col('position'), ref: listRef('A', L.positions.length), prompt: ['職位', '請選擇職位（與組織架構的職位名稱相同）'] },
          L.communities.length && { col: col('communities'), ref: listRef('B', L.communities.length), prompt: ['駐點社區', '選一個社區；機動人員可自行輸入多個，用「、」分開'] },
          L.regions.length && { col: col('regions'), ref: listRef('C', L.regions.length) },
          { col: col('shift'), list: ['日班', '夜班'] }, { col: col('gender'), list: ['男', '女'] }, { col: col('id_type'), list: ['身分證', '居留證', '護照'] },
          ...['labor_insured', 'employment_insured', 'health_insured', 'pension_enabled'].map(k => ({ col: col(k), list: ['是', '否'] })),
          { col: col('pay_method'), list: ['轉帳', '現金'] },
        ].filter(Boolean) },
      { name: '填寫說明', rows: guide, widths: [14, 12, 14, 14, 16, 8, 12, 14, 8], rowStyles: { 0: 4, 12: 4, 14: 6 } },
      { name: '選項', header: true, rows: opt, widths: [18, 22, 14, 8, 6, 10, 8, 10] },
    ]);
    sendXlsx(res, req.query.mode === 'current' ? '人員資料（含目前人員）.xlsx' : '人員資料匯入範本.xlsx', buf);
  }));

  // ---------- 讀檔 ----------
  function readRows(file, COLS) {
    if (!file?.buffer?.length) throw Object.assign(new Error('請選擇檔案'), { status: 400 });
    let wb; try { wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: false }); } catch { throw Object.assign(new Error('讀不到這個檔案，請確認是 Excel（.xlsx／.xls）或 CSV'), { status: 400 }); }
    const sheetName = wb.SheetNames.find(n => /人員資料|薪資/.test(n)) || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' }) || [];
    let hi = aoa.findIndex(r => { const m = mapHeader(r, COLS); return m.name !== undefined || m.employee_id !== undefined; });
    if (hi < 0) throw Object.assign(new Error('找不到標題列（至少要有「員編」或「姓名」欄）。請使用系統提供的範本'), { status: 400 });
    const idx = mapHeader(aoa[hi], COLS);
    const out = [];
    for (let r = hi + 1; r < aoa.length; r++) {
      const row = aoa[r]; if (!row || row.every(v => String(v ?? '').trim() === '')) continue;
      const o = { _row: r + 1 }; for (const c of COLS) if (idx[c.key] !== undefined) o[c.key] = row[idx[c.key]];
      out.push(o);
    }
    if (!out.length) throw Object.assign(new Error('檔案裡沒有資料列'), { status: 400 });
    if (out.length > 2000) throw Object.assign(new Error('一次最多匯入 2000 位人員，請分批上傳'), { status: 400 });
    return { rows: out, columns: Object.keys(idx), sheet: sheetName };
  }

  // ---------- 試算與寫入（同一套邏輯；預覽時整批復原） ----------
  const pending = new Map(); // token -> { uid, tid, kind, rows, at }
  const ROLLBACK = Symbol('rollback');
  function runBatch(fn, dry) {
    let result;
    const t = db.transaction(() => { result = fn(); if (dry) throw ROLLBACK; });
    try { t(); } catch (e) { if (e !== ROLLBACK) throw e; }
    return result;
  }
  // 每一列用 SAVEPOINT 隔開：某一列失敗只復原那一列
  function eachRow(rows, fn) {
    const out = [];
    for (const r of rows) {
      const rep = { row: r._row, employee_id: str(r.employee_id, 30), name: str(r.name, 60), action: '', errors: [], warnings: [], fields: [] };
      db.exec('SAVEPOINT imp_row');
      try { fn(r, rep); if (rep.errors.length) throw new Error('row'); db.exec('RELEASE imp_row'); }
      catch (e) { db.exec('ROLLBACK TO imp_row'); db.exec('RELEASE imp_row'); if (e.message !== 'row') rep.errors.push(e.message || '處理失敗'); if (rep.action !== '略過') rep.action = '錯誤'; }
      out.push(rep);
    }
    return out;
  }
  const findByEmp = (tid, e) => e ? db.prepare('SELECT * FROM staff_users WHERE tenant_id=? AND employee_id=?').get(tid, e) : null;
  const findByMobile = (tid, m) => { if (!m) return null; const ids = LI.staffIdsByMobile(m); for (const id of ids) { const u = db.prepare('SELECT * FROM staff_users WHERE id=? AND tenant_id=?').get(id, tid); if (u) return u; } return null; };
  const LABEL = Object.fromEntries(STAFF_COLS.map(c => [c.key, c.label]));

  function processStaff(tid, actor, rows, { dry }) {
    const L = companyLists(tid); const mobileMode = LI.loginMode(tid) === 'mobile';
    const posByName = new Map(L.positions.map(p => [norm(p.name), p])); const comByName = new Map(L.communities.map(c => [norm(c.name), c])); const regByName = new Map(L.regions.map(r => [norm(r.name), r]));
    const allowStaff = canStaff(actor), allowHR = canHR(actor);
    const seenEmp = new Map(), seenMobile = new Map(), seenId = new Map();
    let plan = null; try { const S = getPlans()?.state(tid); if (S?.configured && S.basis === 'staff') plan = { left: Math.max(0, S.limit - S.used), text: `${S.basis_name} ${S.used}／${S.limit}` }; } catch {}
    const created = [];
    const reports = eachRow(rows, (r, rep) => {
      const E = m => rep.errors.push(m), W = m => rep.warnings.push(m);
      const emp = str(r.employee_id, 30), name = str(r.name, 60), mob = phone(r.mobile);
      if (/^範例/.test(emp) || /^範例/.test(name)) { rep.action = '略過'; W('範例列，已略過'); return; }
      if (emp) { if (seenEmp.has(emp)) E(`員編和第 ${seenEmp.get(emp)} 列重複`); seenEmp.set(emp, r._row); }
      if (mob) { if (!LI.isMobile(mob)) E(`手機號碼格式不正確：${text(r.mobile)}`); else { if (seenMobile.has(mob)) E(`手機和第 ${seenMobile.get(mob)} 列重複`); seenMobile.set(mob, r._row); } }
      let u = findByEmp(tid, emp) || (!emp ? findByMobile(tid, mob) : null);
      if (u && !u.is_active) { E('這個員編是已停用的帳號，請先在人員管理重新啟用'); return; }
      // 職位／社區／區域／班別
      const posName = str(r.position, 60); const pos = posName ? posByName.get(norm(posName)) : null;
      if (posName && !pos) E(`找不到職位「${posName}」（請用下拉選單，或照「選項」工作表的名稱）`);
      const comNames = str(r.communities, 500).split(/[、,，;；\/\n]+/).map(s => s.trim()).filter(Boolean);
      const coms = comNames.map(n => comByName.get(norm(n)) || (E(`找不到社區「${n}」`), null)).filter(Boolean);
      const regNames = str(r.regions, 300).split(/[、,，;；\/\n]+/).map(s => s.trim()).filter(Boolean);
      const regs = regNames.map(n => regByName.get(norm(n)) || (E(`找不到區域「${n}」`), null)).filter(Boolean);
      const shiftTxt = str(r.shift, 10); const shift = /夜/.test(shiftTxt) ? 'night' : /日|白/.test(shiftTxt) ? 'day' : '';
      if (shiftTxt && !shift) E(`班別請填「日班」或「夜班」：${shiftTxt}`);
      // 人事欄位
      const hr = {};
      for (const k of ['hire_date', 'trial_end_date', 'birthday', 'insured_date']) if (String(r[k] ?? '').trim() !== '') { const dt = toDate(r[k]); if (!dt) E(`${LABEL[k]}看不懂：${text(r[k])}（請寫 2024/3/5 或民國 113/3/5）`); else hr[k] = dt; }
      for (const k of ['labor_insured', 'employment_insured', 'health_insured', 'pension_enabled']) { const v = yesNo(r[k]); if (v === null) E(`${LABEL[k]}請填「是」或「否」：${text(r[k])}`); else if (v !== undefined) hr[k] = v; }
      const g = str(r.gender, 5); if (g) { if (/^(男|m|male)$/i.test(g)) hr.gender = 'M'; else if (/^(女|f|female)$/i.test(g)) hr.gender = 'F'; else E(`性別請填「男」或「女」：${g}`); }
      const idt = str(r.id_type, 10); if (idt) { const t = /居留/.test(idt) ? 'arc' : /護照/.test(idt) ? 'passport' : /身分|身份|國民/.test(idt) ? 'national' : ''; if (!t) E(`證件類別請填身分證、居留證或護照：${idt}`); else hr.id_type = t; }
      const idn = str(r.id_no, 20).toUpperCase().replace(/\s/g, ''); if (idn) { hr.id_no = idn; if (!hr.id_type) hr.id_type = /^[A-Z][89A-D]/.test(idn) ? 'arc' : 'national'; if (seenId.has(idn)) E(`證號和第 ${seenId.get(idn)} 列重複`); seenId.set(idn, r._row); }
      for (const k of ['nationality', 'address', 'emergency_name', 'emergency_relation', 'bank_name', 'note']) if (String(r[k] ?? '').trim()) hr[k] = text(r[k]);
      if (String(r.emergency_phone ?? '').trim()) hr.emergency_phone = phone(r.emergency_phone) || text(r.emergency_phone);
      if (String(r.bank_account ?? '').trim()) { hr.bank_account = text(r.bank_account).replace(/\s/g, ''); if (typeof r.bank_account === 'number' && String(r.bank_account).length >= 15) W('銀行帳號是數字格式，Excel 可能已把長帳號改成科學記號，請確認'); }
      const pm = str(r.pay_method, 10); if (pm) { if (/現金/.test(pm)) hr.pay_method = 'cash'; else if (/轉帳|匯款|薪轉/.test(pm)) hr.pay_method = 'transfer'; else E(`薪資發放請填「轉帳」或「現金」：${pm}`); }
      if (String(r.health_dependents ?? '').trim() !== '') { const n = Number(r.health_dependents); if (!Number.isInteger(n) || n < 0 || n > 20) E(`健保眷屬人數請填 0～20 的整數：${text(r.health_dependents)}`); else hr.health_dependents = n; }
      if (String(r.annual_used ?? '').trim() !== '') { const n = Number(r.annual_used); if (!Number.isFinite(n) || n < 0 || n > 60) E(`系統外已休特休天數不正確：${text(r.annual_used)}`); else hr.annual_used = n; }
      if (mob) hr.mobile = mob;
      const hrKeys = Object.keys(hr).filter(k => k !== 'mobile');
      if (hrKeys.length && !allowHR) { W('您沒有人事權限，人事欄位不會匯入'); for (const k of hrKeys) delete hr[k]; }
      if (rep.errors.length) { rep.action = u ? '更新' : '新增'; return; }
      rep.fields = [...new Set([...(posName ? ['職位'] : []), ...(coms.length ? ['駐點社區'] : []), ...(regs.length ? ['負責區域'] : []), ...(shift ? ['班別'] : []), ...Object.keys(hr).map(k => LABEL[k] || k)])];
      const memberBody = cur => {
        const p = pos || (cur ? org().posOf(L.cfg, cur.position_id) : null);
        const K = p ? OM.KINDS[p.kind] || {} : {};
        const curSites = u ? getSiteAssignments(u).map(a => Number(a.community_id)).filter(Boolean) : [];
        let curRegs = []; try { curRegs = JSON.parse(cur?.region_ids_json || '[]').map(Number); } catch {}
        return { p, K, body: { position_id: p?.id, community_ids: coms.length ? coms.map(c => c.id) : curSites, region_ids: regs.length ? regs.map(x => x.id) : curRegs, shift: shift || cur?.shift || '', confirm_shared_mobile: true } };
      };
      if (!u) {
        // ---- 新增 ----
        rep.action = '新增';
        if (!allowStaff) return E('開通新帳號需要「人員管理」權限');
        if (!name) return E('姓名必填');
        if (!pos) return E('新人員的職位必填');
        if (!emp && !mobileMode) return E('員編必填');
        if (mobileMode && !mob) return E('本公司用手機號碼登入，手機必填');
        if (plan) { if (plan.left <= 0) return E(`已達方案人數上限（${plan.text}），請聯絡系統服務商升級方案`); plan.left--; }
        if (mob && LI.usedByOtherTenant(tid, mob)) W('這支手機在其他公司也有帳號（兼職），兩邊帳號密碼各自獨立');
        const { K, body } = memberBody(null);
        if (K.sites && !body.community_ids.length) return E(`「${pos.name}」要填駐點社區`);
        if (K.sites === 'one' && body.community_ids.length > 1) return E(`「${pos.name}」只能駐點一個社區（多社區請用機動職位）`);
        if (K.regions && !body.region_ids.length) return E(`「${pos.name}」要填負責區域`);
        const pw = tempPassword();
        const r2 = org().createStaff(tid, { ...body, employee_id: emp, name, mobile: mob, password: pw }, actor);
        u = db.prepare('SELECT * FROM staff_users WHERE id=?').get(r2.id); rep.employee_id = r2.employee_id;
        created.push({ row: r._row, employee_id: r2.employee_id, name, mobile: mob, position: pos.name, temp_password: pw });
      } else {
        // ---- 更新 ----
        rep.action = '更新'; rep.employee_id = u.employee_id; rep.name = rep.name || u.name;
        if (name && name !== u.name) { if (u.role === 'company_admin') W('公司管理員的姓名不會在這裡修改'); else W(`姓名會從「${u.name}」改成「${name}」`); }
        const changeMember = pos || coms.length || regs.length || shift || (name && name !== u.name) || (mob && mob !== LI.normMobile(LI.mobileOf(u.id)));
        if (changeMember) {
          if (!allowStaff) W('您沒有人員管理權限，職位、社區、手機不會變更');
          else if (u.role === 'company_admin' && actor.role !== 'company_admin') W('公司管理員的職位不會在這裡變更');
          else {
            const cur = org().memberRow(tid, u.id); const { p, K, body } = memberBody(cur);
            if (!p) {
              if (coms.length || regs.length || shift) W('這位人員還沒有設定職位，請填「職位」才能更新駐點社區或班別');
              if (name && u.role !== 'company_admin') db.prepare('UPDATE staff_users SET name=?,updated_at=? WHERE id=?').run(name, now(), u.id);
              if (mob && mob !== LI.normMobile(LI.mobileOf(u.id))) { const chk = LI.checkForAccount(tid, mob, { confirm_shared_mobile: true }, { previous: LI.mobileOf(u.id), exceptId: u.id }); if (chk) return E(chk.body?.error || '手機號碼無法使用'); LI.saveMobile(tid, u.id, mob); }
            }
            else {
              if (K.sites && !body.community_ids.length) return E(`「${p.name}」要填駐點社區`);
              if (K.sites === 'one' && body.community_ids.length > 1) return E(`「${p.name}」只能駐點一個社區`);
              org().updateStaff(tid, u.id, { ...body, name: name || undefined, ...(mob ? { mobile: mob } : {}) }, actor);
            }
          }
        }
      }
      // 人事資料：原本的資料＋這次有填的欄位
      if (allowHR && Object.keys(hr).length) {
        const cur = pay().hrBody(tid, u.id) || {};
        const body = { ...cur, ...hr, mobile: hr.mobile || cur.mobile || LI.mobileOf(u.id) || '' }; if (!hr.id_no) delete body.id_no; // 沒填證號就不動原本的證號
        pay().saveHr(tid, u.id, body, actor);
        if (hr.mobile) try { db.prepare('UPDATE hr_profiles SET mobile=? WHERE tenant_id=? AND staff_id=?').run(hr.mobile, tid, u.id); } catch {}
      }
      if (!dry) try { db.prepare('INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, actor.employee_id, actor.name, rep.action === '新增' ? 'import_create' : 'import_update', 'staff-import', 'staff_user', String(u.id), `Excel 匯入${rep.action}：${u.name}（${rep.fields.join('、') || '無變更'}）`, now()); } catch {}
    });
    return { reports, created };
  }

  function processSalary(tid, actor, rows, { dry }) {
    const created = [];
    const reports = eachRow(rows, (r, rep) => {
      const E = m => rep.errors.push(m), W = m => rep.warnings.push(m);
      const emp = str(r.employee_id, 30); rep.action = '更新';
      if (/^範例/.test(emp)) { rep.action = '略過'; W('範例列，已略過'); return; }
      const u = findByEmp(tid, emp); if (!emp) return E('員編必填'); if (!u) return E(`找不到員編「${emp}」，請先在人事管理開通`);
      rep.name = u.name; if (str(r.name, 60) && str(r.name, 60) !== u.name) W(`姓名和系統不同（系統：${u.name}），請確認是同一人`);
      const money = (k, label) => { const s = String(r[k] ?? '').replace(/[,\s元$]/g, ''); if (!s) return undefined; const n = Number(s); if (!Number.isFinite(n) || n < 0 || n > 10000000) { E(`${label}不正確：${text(r[k])}`); return undefined; } return Math.round(n); };
      const up = {}; const f = [];
      const bs = money('base_salary', '正式薪資'); if (bs !== undefined) { up.base_salary = bs; f.push('正式薪資'); }
      const ts = money('trial_salary', '試用期薪資'); if (ts !== undefined) { up.trial_salary = ts; f.push('試用期薪資'); }
      const al = [1, 2, 3].map(i => ({ name: str(r[`a${i}n`], 20), amount: money(`a${i}v`, `加給${i}金額`) })).filter(x => x.name || x.amount !== undefined);
      for (const x of al) if (!x.name || x.amount === undefined) E('加給的名稱和金額要一起填');
      if (al.length) { up.allowances = al.filter(x => x.name && x.amount).map(x => ({ name: x.name, amount: x.amount })); f.push('加給'); }
      if (String(r.pension_self_rate ?? '').trim() !== '') { const n = Number(String(r.pension_self_rate).replace(/[%％]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 6) E(`勞退自提要在 0～6%：${text(r.pension_self_rate)}`); else { up.pension_self_rate = n; f.push('勞退自提'); } }
      if (String(r.salary_note ?? '').trim()) { up.salary_note = text(r.salary_note); f.push('薪資備註'); }
      if (rep.errors.length) return;
      if (!f.length) { rep.action = '略過'; W('沒有填任何薪資欄位'); return; }
      rep.fields = f;
      const cur = pay().salaryBody(tid, u.id) || {};
      pay().saveSalary(tid, u.id, { ...cur, ...up }, actor);
      if (!dry) try { db.prepare('INSERT INTO audit_logs (tenant_id,employee_id,employee_name,action,module,record_type,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, actor.employee_id, actor.name, 'import_salary', 'salary-import', 'staff_user', String(u.id), `Excel 匯入薪資：${u.name}（${f.join('、')}）`, now()); } catch {}
    });
    return { reports, created };
  }

  const summary = reports => ({ total: reports.length, create: reports.filter(r => r.action === '新增').length, update: reports.filter(r => r.action === '更新').length, skip: reports.filter(r => r.action === '略過').length, error: reports.filter(r => r.action === '錯誤').length, warning: reports.filter(r => r.warnings.length && r.action !== '錯誤').length });
  function preview(kind, COLS, proc, guardFn) {
    return wrap((req, res) => {
      const u = getUser(req); if (!guardFn(u)) return bad(res, kind === 'salary' ? '需要薪資權限' : '需要人事或人員管理權限', 403);
      const tid = tenantId(req); const { rows, columns, sheet } = readRows(req.file, COLS);
      const { reports } = runBatch(() => proc(tid, u, rows, { dry: true }), true);
      for (const [k, v] of pending) if (Date.now() - v.at > 30 * 60e3) pending.delete(k);
      const token = crypto.randomBytes(16).toString('hex'); pending.set(token, { uid: u.id, tid, kind, rows, at: Date.now() });
      res.set('Cache-Control', 'no-store');
      res.json({ token, sheet, columns: columns.map(k => (COLS.find(c => c.key === k) || {}).label).filter(Boolean), reports, summary: summary(reports) });
    });
  }
  function commit(kind, proc, guardFn) {
    return wrap((req, res) => {
      const u = getUser(req); if (!guardFn(u)) return bad(res, '沒有權限', 403);
      const p = pending.get(String(req.body?.token || '')); if (!p || p.uid !== u.id || p.tid !== tenantId(req) || p.kind !== kind) return bad(res, '預覽已過期，請重新上傳檔案');
      pending.delete(String(req.body.token));
      const { reports, created } = runBatch(() => proc(p.tid, u, p.rows, { dry: false }), false);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, reports, summary: summary(reports), created });
    });
  }
  app.post('/api/company/staff-import/preview', requireCompanyAdmin, upload.single('file'), preview('staff', STAFF_COLS, processStaff, u => canHR(u) || canStaff(u)));
  app.post('/api/company/staff-import/commit', requireCompanyAdmin, commit('staff', processStaff, u => canHR(u) || canStaff(u)));

  // ---------- 薪資 ----------
  app.get('/api/company/salary-import/template', requireCompanyAdmin, wrap((req, res) => {
    const u = getUser(req); if (!canPayroll(u)) return bad(res, '需要薪資權限', 403);
    const tid = tenantId(req); const rows = [SALARY_COLS.map(c => c.label + (c.req ? '＊' : ''))];
    const people = db.prepare("SELECT * FROM staff_users WHERE tenant_id=? AND is_active=1 AND COALESCE(person_status,'active')='active' ORDER BY employee_id").all(tid);
    for (const p of people) {
      const s = req.query.mode === 'current' ? (pay().salaryBody(tid, p.id) || {}) : {};
      const al = s.allowances || [];
      rows.push([p.employee_id, p.name, s.base_salary || '', s.trial_salary || '', al[0]?.name || '', al[0]?.amount || '', al[1]?.name || '', al[1]?.amount || '', al[2]?.name || '', al[2]?.amount || '', s.pension_self_rate || '', s.salary_note || '']);
    }
    if (req.query.mode === 'current') try { db.prepare('INSERT INTO data_access_logs (tenant_id,staff_id,employee_id,name,category,what,path,ip,at) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, u.id, u.employee_id, u.name, '薪資', '下載薪資設定（含目前金額）', req.path, String(req.ip || ''), now()); } catch {}
    const guide = [['薪資設定匯入說明'], [''], ['1. 「薪資設定」工作表已列出目前所有人員的員編與姓名，請在同一列填入薪資。'], ['2. 員編必填（用來對應人員）；姓名只是方便核對。'], ['3. 空白的格子會保留系統裡原本的金額；有填加給時，會用這次填的加給取代原本的加給。'], ['4. 金額請填數字（可以有千分位逗號）；勞退自提填 0～6。'], ['5. 上傳後會先顯示檢查結果，確認後才會寫入。定期代扣款（法扣、制服費）請在系統裡設定。'], ['6. 這份檔案含有薪資資料，匯入完成後請刪除。']];
    sendXlsx(res, req.query.mode === 'current' ? '薪資設定（含目前金額）.xlsx' : '薪資設定匯入範本.xlsx', buildXlsx([
      { name: '薪資設定', header: true, textCols: false, freeze: 1, required: new Set([0]), rows, widths: SALARY_COLS.map(c => c.w) },
      { name: '填寫說明', rows: guide, widths: [90], rowStyles: { 0: 4 } },
    ]));
  }));
  app.post('/api/company/salary-import/preview', requireCompanyAdmin, upload.single('file'), preview('salary', SALARY_COLS, processSalary, canPayroll));
  app.post('/api/company/salary-import/commit', requireCompanyAdmin, commit('salary', processSalary, canPayroll));

  return { toDate, phone, yesNo };
};
