// 交接清冊：經理版／秘書版各自獨立的表單設定、智慧題目（自動帶入、條件顯示、選項題）。
// - 經理版沿用原本的 DATA_DIR/form-config.json（不影響既有題目與 Word 範本欄位代碼）。
// - 秘書版存在 DATA_DIR/handover-secretary.json，第一次使用時由 config/handover-secretary.json 建立。
// - 草稿與正式紀錄以 form_type 區分（既有資料一律視為經理版）。
const FORM_TYPES = {
  manager: { label: '經理交接清冊', short: '經理', icon: '👔' },
  secretary: { label: '秘書交接清冊', short: '秘書', icon: '🗂' },
};
const QUESTION_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'tel', 'yesno', 'radio', 'select', 'checkbox'];
const OPTION_TYPES = new Set(['radio', 'select', 'checkbox']);
const PREFILL_SOURCES = ['', 'community', 'today', 'user', 'user_position', 'last'];
const SHOW_OPS = ['eq', 'neq', 'filled'];
// 舊題目沒有設定「自動帶入」時，依欄位代碼套用的智慧預設（只影響新開的草稿，不改動總後台設定檔）。
const SMART_DEFAULTS = {
  community_name: 'community',
  handover_date: 'today',
  outgoing_manager: 'user',
  outgoing_secretary: 'user',
};

function cleanFormType(v) { return Object.prototype.hasOwnProperty.call(FORM_TYPES, String(v || '')) ? String(v) : 'manager'; }
function isFormType(v) { return Object.prototype.hasOwnProperty.call(FORM_TYPES, String(v || '')); }
function isEmpty(v) { return Array.isArray(v) ? v.filter(x => String(x ?? '').trim()).length === 0 : !String(v ?? '').trim(); }
function answerValues(v) { return (Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v])).map(x => String(x)); }

function isVisible(q, answers, byId, depth = 0) {
  const c = q && q.showIf;
  if (!c || !c.q) return true;
  if (depth > 10) return true;
  const src = byId[c.q];
  if (!src) return true;
  if (!isVisible(src, answers, byId, depth + 1)) return false;
  const vals = answerValues(answers[c.q]);
  if (c.op === 'filled') return vals.some(x => x.trim());
  const target = String(c.value ?? '');
  if (c.op === 'neq') return vals.length > 0 && !vals.includes(target);
  return vals.includes(target);
}
function missingRequired(form, answers) {
  const byId = Object.fromEntries((form.questions || []).map(q => [q.id, q]));
  return (form.questions || []).filter(q => q.required && isVisible(q, answers, byId) && isEmpty(answers[q.id]));
}
// 送出時移除被條件隱藏的題目答案與內部欄位，避免舊答案留在正式紀錄。
function cleanAnswersForSubmit(form, answers) {
  const byId = Object.fromEntries((form.questions || []).map(q => [q.id, q]));
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (k.startsWith('__')) continue;
    const q = byId[k];
    if (q && !isVisible(q, answers, byId)) continue;
    out[k] = v;
  }
  return out;
}
// Word 範本只能放文字：複選題轉成「、」分隔。
function flattenForDocx(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) out[k] = Array.isArray(v) ? v.join('、') : v;
  return out;
}

function normalizeQuestion(q) {
  const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
  const out = {
    id: String(q.id || '').trim(),
    label: String(q.label || '').trim() || '未命名題目',
    type,
    required: !!q.required,
    pageId: String(q.pageId || ''),
    group: String(q.group || '填寫資料').trim() || '填寫資料',
  };
  if (OPTION_TYPES.has(type)) {
    const opts = Array.isArray(q.options) ? q.options : String(q.options || '').split(/\r?\n|,|，/);
    out.options = [...new Set(opts.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 40);
  }
  const help = String(q.help || '').trim(); if (help) out.help = help.slice(0, 300);
  const placeholder = String(q.placeholder || '').trim(); if (placeholder) out.placeholder = placeholder.slice(0, 120);
  if (q.prefill !== undefined) out.prefill = PREFILL_SOURCES.includes(q.prefill) ? q.prefill : '';
  if (q.showIf && q.showIf.q) {
    out.showIf = { q: String(q.showIf.q), op: SHOW_OPS.includes(q.showIf.op) ? q.showIf.op : 'eq', value: String(q.showIf.value ?? '') };
  }
  return out;
}
function validateForm(config) {
  if (!config || !Array.isArray(config.pages) || !Array.isArray(config.questions)) return '表單設定格式錯誤';
  if (!config.pages.length) return '至少要保留一個頁面';
  const pageIds = new Set(config.pages.map(p => p.id));
  if (pageIds.size !== config.pages.length) return '頁面代碼不能重複';
  const ids = config.questions.map(q => String(q.id || '').trim());
  if (ids.some(id => !id)) return '有題目沒有欄位代碼';
  if (ids.some(id => !/^[A-Za-z0-9_\-一-龥]+$/.test(id))) return '欄位代碼只能使用英文、數字、底線或中文';
  if (ids.some(id => id.startsWith('__'))) return '欄位代碼不能以兩個底線開頭';
  if (new Set(ids).size !== ids.length) return '欄位代碼不能重複';
  if (config.questions.some(q => !pageIds.has(q.pageId))) return '有題目尚未指定有效頁面';
  const idSet = new Set(ids);
  for (const q of config.questions) {
    if (OPTION_TYPES.has(q.type) && !(Array.isArray(q.options) ? q.options : String(q.options || '').split(/\r?\n|,|，/)).some(x => String(x || '').trim()))
      return `「${q.label || q.id}」是選項題，請至少設定一個選項`;
    if (q.showIf && q.showIf.q) {
      if (q.showIf.q === q.id) return `「${q.label || q.id}」的顯示條件不能指向自己`;
      if (!idSet.has(q.showIf.q)) return `「${q.label || q.id}」的顯示條件指向不存在的題目`;
    }
  }
  return null;
}
function normalizeForm(config) {
  return {
    ...config,
    pages: config.pages.map(p => ({ id: String(p.id), title: String(p.title || '').trim() || '未命名頁面', description: String(p.description || '') })),
    questions: config.questions.map(normalizeQuestion),
  };
}

module.exports = function createHandoverForms({ fs, path, DATA_DIR, readFormConfig, writeFormConfig }) {
  const SECRETARY_PATH = path.join(DATA_DIR, 'handover-secretary.json');
  const SECRETARY_SEED = path.join(__dirname, 'config', 'handover-secretary.json');

  function readSecretary() {
    if (!fs.existsSync(SECRETARY_PATH)) {
      const seed = JSON.parse(fs.readFileSync(SECRETARY_SEED, 'utf-8'));
      fs.writeFileSync(SECRETARY_PATH, JSON.stringify(seed, null, 2), 'utf-8');
    }
    const c = JSON.parse(fs.readFileSync(SECRETARY_PATH, 'utf-8'));
    c.pages = Array.isArray(c.pages) ? c.pages : [];
    c.questions = Array.isArray(c.questions) ? c.questions : [];
    return c;
  }
  // 設計用（總後台）：原樣讀取
  function readRaw(type) { return cleanFormType(type) === 'secretary' ? readSecretary() : readFormConfig(); }
  // 填寫用（現場）：補上智慧預設
  function readForm(type) {
    const t = cleanFormType(type);
    const c = readRaw(t);
    const questions = c.questions.map(q => {
      const n = normalizeQuestion(q);
      if (n.prefill === undefined) n.prefill = SMART_DEFAULTS[n.id] || '';
      return n;
    });
    const meta = FORM_TYPES[t];
    return { formType: t, label: meta.label, title: t === 'manager' ? meta.label : (c.title || meta.label), subtitle: c.subtitle || '', pages: c.pages, questions };
  }
  function writeForm(type, config) {
    const t = cleanFormType(type);
    const err = validateForm(config);
    if (err) { const e = new Error(err); e.status = 400; throw e; }
    const clean = normalizeForm(config);
    if (t === 'secretary') {
      fs.writeFileSync(SECRETARY_PATH, JSON.stringify({ title: String(clean.title || FORM_TYPES.secretary.label), subtitle: String(clean.subtitle || ''), pages: clean.pages, questions: clean.questions }, null, 2), 'utf-8');
    } else {
      const current = readFormConfig();
      writeFormConfig({ ...current, ...clean, uiTexts: clean.uiTexts || current.uiTexts });
    }
  }
  function resetForm(type) {
    if (cleanFormType(type) !== 'secretary') { const e = new Error('經理版沒有平台預設可還原'); e.status = 400; throw e; }
    fs.writeFileSync(SECRETARY_PATH, fs.readFileSync(SECRETARY_SEED, 'utf-8'), 'utf-8');
  }
  function todayTW() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  // 依題目設定自動帶入：社區名稱、今天日期、填寫人、上次交接的同題答案。
  function initialAnswers(form, { community, user, last }) {
    const data = {}; const filled = [];
    for (const q of form.questions) {
      let v;
      if (q.prefill === 'community') v = community?.name || '';
      else if (q.prefill === 'today') v = todayTW();
      else if (q.prefill === 'user') v = user?.name || '';
      else if (q.prefill === 'user_position') v = user?.position || '';
      else if (q.prefill === 'last' && last && last[q.id] !== undefined) v = last[q.id];
      if (v !== undefined && !isEmpty(v)) { data[q.id] = v; filled.push(q.id); }
    }
    if (filled.length) data.__prefilled = filled;
    return data;
  }

  function lastSubmissionFor(db, tid, cid, type) {
    if (!cid) return null;
    const row = db.prepare("SELECT id,data,created_at,employee_name FROM submissions WHERE tenant_id=? AND community_id=? AND COALESCE(form_type,'manager')=? ORDER BY id DESC LIMIT 1").get(tid, Number(cid), cleanFormType(type));
    if (!row) return null;
    try { return { ...row, data: JSON.parse(row.data) }; } catch { return null; }
  }

  function register(app, { db, getUser, tenantId, requireStaffFiller, requireSuperAdmin, getAccessibleCommunity }) {
    const send = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : '操作失敗，請稍後再試' });
    const lastSubmission = (req, type, cid) => lastSubmissionFor(db, tenantId(req), cid, type);
    const myCommunities = req => db.prepare(`SELECT c.* FROM communities c JOIN staff_communities sc ON sc.community_id=c.id WHERE c.tenant_id=? AND c.status='active' AND sc.staff_id=? ORDER BY c.name`).all(tenantId(req), getUser(req).id);

    app.get('/api/staff/handover/forms', requireStaffFiller, (req, res) => {
      const counts = Object.fromEntries(db.prepare("SELECT COALESCE(form_type,'manager') t,COUNT(*) c FROM drafts WHERE employee_id=? AND tenant_id=? GROUP BY t").all(req.session.employeeId, tenantId(req)).map(r => [r.t, r.c]));
      res.json({ forms: Object.entries(FORM_TYPES).map(([id, m]) => ({ id, ...m, drafts: counts[id] || 0, pages: readRaw(id).pages.length })) });
    });
    app.get('/api/staff/handover/:type/config', requireStaffFiller, (req, res) => {
      if (!isFormType(req.params.type)) return res.status(404).json({ error: '沒有這種交接清冊' });
      try {
        const form = readForm(req.params.type);
        if (!form.pages.length || !form.questions.length) return res.status(500).json({ error: `${form.label}尚未設定題目，請到總後台「中央表單設計中心」設定。` });
        res.json({ formType: form.formType, label: form.label, formConfig: form, communities: myCommunities(req), today: todayTW() });
      } catch (err) { console.error('handover config error', err); res.status(500).json({ error: '無法讀取交接清冊設定' }); }
    });
    // 這個社區上一份同類型交接清冊（給「沿用上次答案」使用）
    app.get('/api/staff/handover/:type/last', requireStaffFiller, (req, res) => {
      if (!isFormType(req.params.type)) return res.status(404).json({ error: '沒有這種交接清冊' });
      const cid = Number(req.query.community_id);
      if (!getAccessibleCommunity(req, cid)) return res.status(403).json({ error: '您沒有這個社區的填寫權限' });
      const form = readForm(req.params.type);
      const last = lastSubmission(req, form.formType, cid);
      if (!last) return res.json({ last: null });
      const allowed = new Set(form.questions.filter(q => q.prefill === 'last').map(q => q.id));
      res.json({ last: { id: last.id, created_at: last.created_at, employee_name: last.employee_name, data: Object.fromEntries(Object.entries(last.data).filter(([k]) => allowed.has(k))) } });
    });
    app.get('/api/staff/handover/:type/submissions', requireStaffFiller, (req, res) => {
      if (!isFormType(req.params.type)) return res.status(404).json({ error: '沒有這種交接清冊' });
      const rows = db.prepare("SELECT s.id,s.created_at,s.community_id,c.name community_name FROM submissions s LEFT JOIN communities c ON c.id=s.community_id WHERE s.tenant_id=? AND s.employee_id=? AND COALESCE(s.form_type,'manager')=? ORDER BY s.id DESC LIMIT 10").all(tenantId(req), req.session.employeeId, req.params.type);
      res.json({ submissions: rows });
    });

    app.get('/api/admin/handover-forms', requireSuperAdmin, (req, res) => {
      res.json({ types: Object.entries(FORM_TYPES).map(([id, m]) => ({ id, ...m })), questionTypes: QUESTION_TYPES, forms: { manager: readRaw('manager'), secretary: readRaw('secretary') } });
    });
    app.put('/api/admin/handover-forms/:type', requireSuperAdmin, (req, res) => {
      if (!isFormType(req.params.type)) return res.status(404).json({ error: '沒有這種交接清冊' });
      try { writeForm(req.params.type, req.body); res.json({ success: true, form: readRaw(req.params.type) }); } catch (err) { send(res, err); }
    });
    app.post('/api/admin/handover-forms/:type/reset', requireSuperAdmin, (req, res) => {
      try { resetForm(req.params.type); res.json({ success: true, form: readRaw(req.params.type) }); } catch (err) { send(res, err); }
    });
  }

  return { FORM_TYPES, cleanFormType, isFormType, readForm, readRaw, writeForm, validateForm, missingRequired, cleanAnswersForSubmit, flattenForDocx, initialAnswers, lastSubmissionFor, register };
};
module.exports.FORM_TYPES = FORM_TYPES;
module.exports._internal = { isVisible, missingRequired, cleanAnswersForSubmit, normalizeQuestion, validateForm };
