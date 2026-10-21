// 組織架構：部門、職位（名稱可客製化）與系統認得的「職位類型」。
// 職位類型決定：工作地點（駐點／內勤）、管轄範圍、排班方式、上下級關係；名稱由各公司自訂。
'use strict';

// 系統內建的職位類型（不可新增，名稱可改）
const KINDS = {
  owner:        { label: '老闆／董事長', scope: '全公司', work: 'internal', schedule: 'office', manager: true },
  gm:           { label: '總經理', scope: '全公司', work: 'internal', schedule: 'office', manager: true },
  dept_head:    { label: '部門主管', scope: '整個部門', work: 'internal', schedule: 'office', manager: true },
  dept_manager: { label: '部門經理（可分日／夜班）', scope: '部門內同班別的人員', work: 'internal', schedule: 'office', manager: true, shift: true },
  region:       { label: '區域督導', scope: '負責區域內所有社區與人員', work: 'hybrid', schedule: 'office', manager: true, regions: true },
  site_manager: { label: '社區主管（經理／總幹事）', scope: '所屬社區所有現場人員', work: 'site', schedule: 'admin', manager: true, sites: 'one' },
  site_deputy:  { label: '社區副主管（副理／主秘）', scope: '所屬社區同部門人員，聽社區主管指揮', work: 'site', schedule: 'admin', manager: true, sites: 'one' },
  site_staff:   { label: '現場人員', scope: '自己', work: 'site', schedule: 'admin', sites: 'one', shift: true },
  mobile:       { label: '機動人員（多社區）', scope: '自己', work: 'site', schedule: 'mobile', sites: 'many', shift: true },
  office:       { label: '內勤職員', scope: '自己', work: 'internal', schedule: 'office' },
};
const KIND_ORDER = Object.keys(KINDS);
const SCHEDULES = { admin: '行政班', security: '保全班', mobile: '機動班', office: '內勤（見紅休）' };
const SHIFTS = { day: '日班', night: '夜班' };

const SITE_ALL = ['todo', 'work-journal', 'finance', 'committee', 'residents', 'vendors', 'handover', 'company-resources', 'sop', 'schedule', 'attendance'];
const P = {
  boss: ['manage-staff', 'manage-communities', 'view-submissions', 'manage-templates', 'manage-sop', 'work-journal', 'company-work-journal', 'company-accounting', 'company-general-affairs', 'company-personnel', 'company-finance', 'company-hr', 'finance', 'company-resources', 'schedule', 'attendance'],
  property: ['manage-communities', 'view-submissions', 'work-journal', 'company-work-journal', 'manage-sop', 'company-resources', 'schedule', 'attendance'],
  duty: ['schedule', 'attendance', 'company-resources'],
  secretary: ['work-journal', 'company-work-journal', 'view-submissions', 'company-resources', 'schedule'],
  manager: SITE_ALL,
  secretaryStaff: ['todo', 'work-journal', 'committee', 'residents', 'vendors', 'handover', 'company-resources', 'schedule', 'attendance'],
  guard: ['todo', 'company-resources', 'schedule', 'attendance'],
  region: [...SITE_ALL, 'view-submissions', 'company-work-journal'],
  accountant: ['finance', 'company-accounting', 'company-finance', 'company-resources'],
  hr: ['manage-staff', 'company-hr', 'company-personnel', 'company-resources'],
  general: ['company-resources', 'manage-templates', 'company-general-affairs'],
};

function defaults() {
  return {
    departments: [
      { id: 'property', name: '物業部' },
      { id: 'duty', name: '勤務部' },
      { id: 'secretary', name: '秘書部' },
      { id: 'office', name: '行政部' },
    ],
    positions: [
      { id: 'owner', name: '老闆', kind: 'owner', dept: '', perms: P.boss },
      { id: 'gm', name: '總經理', kind: 'gm', dept: '', perms: P.boss },
      { id: 'property_head', name: '物業主管', kind: 'dept_head', dept: 'property', perms: P.property },
      { id: 'region', name: '區域督導', kind: 'region', dept: 'property', perms: P.region },
      { id: 'site_manager', name: '社區經理', kind: 'site_manager', dept: 'property', schedule: 'admin', perms: P.manager },
      { id: 'site_deputy', name: '社區副理', kind: 'site_deputy', dept: 'property', schedule: 'admin', perms: P.manager },
      { id: 'duty_head', name: '勤務主管', kind: 'dept_head', dept: 'duty', perms: P.duty },
      { id: 'duty_day_manager', name: '日班勤務經理', kind: 'dept_manager', dept: 'duty', shift: 'day', perms: P.duty },
      { id: 'duty_night_manager', name: '夜班勤務經理', kind: 'dept_manager', dept: 'duty', shift: 'night', perms: P.duty },
      { id: 'guard_day', name: '日班保全', kind: 'site_staff', dept: 'duty', shift: 'day', schedule: 'security', perms: P.guard },
      { id: 'guard_night', name: '夜班保全', kind: 'site_staff', dept: 'duty', shift: 'night', schedule: 'security', perms: P.guard },
      { id: 'guard_mobile', name: '機動保全', kind: 'mobile', dept: 'duty', schedule: 'mobile', perms: P.guard },
      { id: 'secretary_head', name: '秘書主管', kind: 'dept_head', dept: 'secretary', perms: P.secretary },
      { id: 'secretary_manager', name: '秘書副理', kind: 'dept_manager', dept: 'secretary', perms: P.secretary },
      { id: 'chief_secretary', name: '主秘', kind: 'site_deputy', dept: 'secretary', schedule: 'admin', perms: P.manager },
      { id: 'secretary', name: '櫃台秘書', kind: 'site_staff', dept: 'secretary', schedule: 'admin', perms: P.secretaryStaff },
      { id: 'finance_secretary', name: '財務秘書', kind: 'site_staff', dept: 'secretary', schedule: 'admin', perms: [...P.secretaryStaff, 'finance'] },
      { id: 'secretary_mobile', name: '機動秘書', kind: 'mobile', dept: 'secretary', schedule: 'mobile', perms: P.secretaryStaff },
      { id: 'accountant', name: '會計', kind: 'office', dept: 'office', perms: P.accountant },
      { id: 'hr', name: '人事', kind: 'office', dept: 'office', perms: P.hr },
      { id: 'general', name: '總務', kind: 'office', dept: 'office', perms: P.general },
    ],
  };
}

const str = (v, m = 20) => String(v ?? '').trim().slice(0, m);
const rid = p => `${p}${Math.random().toString(36).slice(2, 8)}`;
function normalize(input) {
  const d = defaults(); const b = input && typeof input === 'object' ? input : d;
  const departments = []; const dseen = new Set();
  for (const x of (Array.isArray(b.departments) ? b.departments : d.departments).slice(0, 20)) {
    const name = str(x?.name); if (!name) continue;
    let id = /^[a-z0-9_]{2,24}$/.test(x?.id) ? x.id : rid('d_'); while (dseen.has(id)) id = rid('d_'); dseen.add(id);
    departments.push({ id, name });
  }
  const positions = []; const pseen = new Set();
  for (const x of (Array.isArray(b.positions) ? b.positions : d.positions).slice(0, 60)) {
    const name = str(x?.name); const kind = KINDS[x?.kind] ? x.kind : null; if (!name || !kind) continue;
    let id = /^[a-z0-9_]{2,24}$/.test(x?.id) ? x.id : rid('p_'); while (pseen.has(id)) id = rid('p_'); pseen.add(id);
    const K = KINDS[kind];
    const schedule = K.schedule === 'office' ? 'office' : kind === 'mobile' ? 'mobile' : (['admin', 'security'].includes(x?.schedule) ? x.schedule : 'admin');
    positions.push({ id, name, kind, dept: dseen.has(x?.dept) ? x.dept : '', shift: K.shift && ['day', 'night'].includes(x?.shift) ? x.shift : '', schedule, perms: [...new Set((Array.isArray(x?.perms) ? x.perms : []).map(String))].filter(k => !['hr-records', 'payroll'].includes(k)).slice(0, 40) });
  }
  return { departments, positions };
}

module.exports = { KINDS, KIND_ORDER, SCHEDULES, SHIFTS, defaults, normalize };
