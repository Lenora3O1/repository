// 平台預設目錄：新功能的目錄項目在這裡集中定義。
// 啟動時依版本號套用到平台預設目錄與各公司的目錄覆寫：
// - 已經有同名（或同功能代碼）的項目：保留原本的名稱與位置，只補上功能代碼，重複的移除。
// - 沒有的項目：新增到母目錄底下。
'use strict';

const VERSION = 6;
const COMPANY = [
  { parent: { id: 'company-general-affairs', label: '總務管理', labels: ['總務管理', '總務'], icon: '📦', action: 'company-resources' }, children: [
    { id: 'company-equip-inventory', label: '設備清冊', action: 'equip-inventory', match: ['設備清冊'] },
    { id: 'company-equip-apply', label: '設備申請', action: 'equip-apply', exact: ['設備申請', '設備借用', '我要借用'] },
    { id: 'company-equip-requests', label: '設備申請紀錄', action: 'equip-requests', match: ['設備申請紀錄', '借用紀錄'] },
    { id: 'company-equip-sites', label: '社區管理', action: 'equip-sites', match: ['社區進駐設備', '進駐設備'], exact: ['社區管理'] },
    { id: 'company-contracts', label: '社區合約', action: 'contracts', match: ['社區合約'] },
  ] },
  { parent: { id: 'company-accounting', label: '會計', labels: ['會計'], icon: '💰', action: 'finance' }, children: [
    { id: 'company-ar', label: '公司應收', action: 'acct-ar', match: ['公司應收', '應收帳款'] },
    { id: 'company-ap', label: '公司應支', action: 'acct-ap', match: ['公司應支', '公司應付', '應付帳款'] },
    { id: 'company-payroll-stats', label: '人員薪資統計表', action: 'payroll-stats', match: ['薪資統計'] },
    { id: 'company-payroll-slips', label: '人員薪資單', action: 'payroll-slips', match: ['薪資單'] },
    { id: 'company-payroll-advances', label: '借資', action: 'payroll-advances', match: ['借資', '借支'] },
    { id: 'company-feedback', label: '社區回饋金', action: 'acct-feedback', match: ['回饋金'] },
    { id: 'company-ledger', label: '傳票與帳冊', action: 'acct-ledger', match: ['傳票', '帳冊'] },
  ] },
];
COMPANY.unshift({ parent: null, children: [{ id: 'company-expense', label: '請款', action: 'ap-my', exact: ['請款', '我的請款', '費用請款'], after: 'company-overview', icon: '💸' }] });
// 方案與費用：只給公司高層（老闆、總經理、公司管理員），開通會計模組時會計也看得到
COMPANY.push({ parent: null, children: [{ id: 'company-plan', label: '方案與費用', action: 'plan-billing', exact: ['方案與費用', '方案與計費', '使用方案'], after: 'company-schedule', icon: '💳' }] });
COMPANY.push({ parent: null, children: [{ id: 'company-interviews', label: '面試管理', action: 'interviews', exact: ['面試管理', '面試人員', '招募管理'], after: 'company-hr', icon: '📝' }] });
const STAFF = [
  // 現場「設備借用申請」放在公司資源底下；舊版放在最上層的「設備申請」會合併過來
  { parent: { id: 'company-resources', label: '公司資源', labels: ['公司資源'], icon: '📦', action: 'company-resources' }, keepOrder: true, children: [{ id: 'staff-equipment', label: '設備借用申請', action: 'staff-equipment', match: ['設備借用'], exact: ['設備申請'], anywhere: true }] },
];

function apply(list, spec) {
  if (!Array.isArray(list)) return list;
  for (const grp of spec) {
    let pid = null;
    if (grp.parent) {
      let p = list.find(x => String(x.id) === grp.parent.id) || list.find(x => !x.parentId && grp.parent.labels.includes(String(x.label || '').trim()));
      if (!p) { p = { id: grp.parent.id, parentId: null, icon: grp.parent.icon, label: grp.parent.label, action: grp.parent.action, enabled: true }; list.push(p); }
      pid = String(p.id);
    }
    const under = x => (pid === null ? !x.parentId : String(x.parentId || '') === pid);
    const used = new Set(); const picked = [];
    for (const c of grp.children) {
      const label = x => String(x.label || '').trim();
      const hasKids = x => list.some(y => String(y.parentId || '') === String(x.id));
      const hits = list.filter(x => (c.anywhere ? !hasKids(x) && String(x.id) !== pid : under(x)) && !used.has(x) && (String(x.action || '') === c.action || String(x.id) === c.id || (c.exact || []).includes(label(x)) || (c.match || []).some(m => label(x).includes(m))));
      // 優先保留：放在正確母目錄底下的、使用者自訂的同名項目（不是系統產生的 id）
      hits.sort((a, b) => (under(b) - under(a)) || ((String(a.id) === c.id) - (String(b.id) === c.id)));
      let keep = hits[0];
      for (const extra of hits.slice(1)) { const i = list.indexOf(extra); if (i >= 0) list.splice(i, 1); }
      if (keep && !under(keep)) { const i = list.indexOf(keep); list.splice(i, 1); keep.parentId = pid; keep.icon = pid === null ? (c.icon || keep.icon) : '↳'; let at = list.findIndex(x => String(x.id) === pid) + 1; while (at > 0 && at < list.length && String(list[at].parentId || '') === pid) at++; list.splice(at, 0, keep); }
      if (keep) { keep.action = c.action; if (!keep.label || String(keep.id) === c.id) keep.label = c.label; }
      else { keep = { id: c.id, parentId: pid, icon: pid === null ? (c.icon || '•') : '↳', label: c.label, action: c.action, enabled: true }; if (pid !== null && grp.keepOrder) { let at = list.findIndex(x => String(x.id) === pid) + 1; while (at < list.length && String(list[at].parentId || '') === pid) at++; list.splice(at, 0, keep); } else if (pid === null) { let i = list.findIndex(x => String(x.id) === c.after); if (i < 0) list.push(keep); else { i++; while (i < list.length && String(list[i].parentId || '') === c.after) i++; list.splice(i, 0, keep); } } else list.push(keep); }
      used.add(keep); picked.push(keep);
    }
    if (pid !== null && !grp.keepOrder) {
      // 子目錄排序：規格中的項目依規格順序，其他自訂項目放在後面
      const others = list.filter(x => under(x) && !used.has(x));
      for (const x of [...picked, ...others]) { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); }
      let at = list.findIndex(x => String(x.id) === pid) + 1;
      list.splice(at, 0, ...picked, ...others);
    }
  }
  return list;
}
function sync(c) {
  apply(c.company, COMPANY); apply(c.staff, STAFF);
  for (const k of Object.keys(c.tenants || {})) { const t = c.tenants[k]; if (!t || typeof t !== 'object') continue; if (Array.isArray(t.company)) apply(t.company, COMPANY); if (Array.isArray(t.staff)) apply(t.staff, STAFF); }
  return c;
}
module.exports = { VERSION, sync, apply, COMPANY, STAFF };
