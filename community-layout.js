// 社區棟別門牌設定與戶別清單
// - 社區第一次使用住戶名冊時，由經理或秘書設定：共同地址前段、戶別代號格式、每一棟的門牌／位置（前棟、後棟）／樓層／每層戶號；店面等特殊戶別可逐戶指定門牌。
// - 系統依設定產生全社區的戶別清單（例如 2A1 = A 棟 2 樓之 1 = 和平路 100 號二樓之 1），住戶聯繫表、區分所有權人、承租人都對到這份清單。
// - 汽車位、機車位跟著「戶」：換聯絡人、換承租人都不用重填。
'use strict';

const FORMATS = {
  FBN: { label: '樓層＋棟別＋戶號（例如 2A1）', make: (f, b, n) => `${f}${b}${n}` },
  BFN: { label: '棟別＋樓層＋戶號（例如 A21、A2-1 請選下一個）', make: (f, b, n) => `${b}${f}${n}` },
  'B-F-N': { label: '棟別-樓層-戶號（例如 A-2-1）', make: (f, b, n) => `${b}-${f}-${n}` },
  'BF-N': { label: '棟別樓層-戶號（例如 A2-1）', make: (f, b, n) => `${b}${f}-${n}` },
};
const CN = '零一二三四五六七八九';
function cnNum(n) { n = Number(n); if (!Number.isFinite(n) || n < 0) return String(n); if (n < 10) return CN[n]; if (n < 20) return `十${n % 10 ? CN[n % 10] : ''}`; if (n < 100) return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`; return String(n); }
function fromCn(s) {
  s = String(s || '').trim(); if (/^\d+$/.test(s)) return Number(s);
  const d = c => CN.indexOf(c) >= 0 ? CN.indexOf(c) : ({ 〇: 0, 两: 2, 兩: 2 })[c];
  if (!s) return NaN; if (s === '十') return 10;
  const m = s.match(/^([一二三四五六七八九两兩])?十([一二三四五六七八九])?$/); if (m) return (m[1] ? d(m[1]) : 1) * 10 + (m[2] ? d(m[2]) : 0);
  if (s.length === 1 && d(s) !== undefined) return d(s);
  return NaN;
}
const half = s => String(s ?? '').replace(/[Ａ-Ｚａ-ｚ０-９－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s　]/g, '');
const str = (v, m = 120) => String(v ?? '').trim().slice(0, m);
function expandList(text) {
  const out = []; for (const part of String(text || '').split(/[,，、\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
    if (m) { const a = Number(m[1]), b = Number(m[2]); for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 200; i++) out.push(i); }
    else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return [...new Set(out)];
}
// 門牌「和平路100號」→ 比對用的 key（去掉空白、全形）
const doorKey = s => half(s).replace(/之/g, '-').replace(/號號+/g, '號');
// 從完整地址拆出 門牌（…號）、樓層、之幾
function parseAddress(addr) {
  const s = half(addr).replace(/號號+/g, '號'); if (!s) return null;
  const m = s.match(/([^\d市縣區鄉鎮里村鄰號]+?[路街道](?:[一二三四五六七八九十]+段)?(?:\d+巷)?(?:\d+弄)?\d+(?:-\d+)?號)(?:([\d一二三四五六七八九十兩两]+)(?:樓|F))?(?:之([\d一二三四五六七八九十]+))?/);
  if (!m) return null;
  const door = m[1]; const floor = m[2] ? fromCn(m[2]) : null; const no = m[3] ? fromCn(m[3]) : null;
  return { door, floor: Number.isFinite(floor) ? floor : null, no: Number.isFinite(no) ? no : null };
}
// 車位：「B1-312」「B1-313-1」→ 汽車位；「機143」「機車位 143」→ 機車位
function parseParking(text) {
  const s = half(text); const cars = [], motos = [];
  for (const m of s.matchAll(/(?<![A-Za-z0-9])(B\d{1,2}-\d{1,4}(?:-\d{1,2})?)/gi)) cars.push(m[1].toUpperCase());
  for (const m of s.matchAll(/機(?:車)?(?:位)?[:：]?\s*([A-Za-z]?\d{1,4}(?:-\d{1,3})?)/g)) motos.push(m[1].toUpperCase());
  return { cars: [...new Set(cars)], motos: [...new Set(motos)] };
}
const splitSpaces = v => [...new Set(half(v).toUpperCase().split(/[,，、;；/／]+/).map(x => x.trim()).filter(Boolean))].slice(0, 10);

module.exports = function registerCommunityLayout(d) {
  const { db, now } = d;
  { const cols = db.prepare('PRAGMA table_info(communities)').all().map(c => c.name); if (!cols.includes('main_address')) db.exec("ALTER TABLE communities ADD COLUMN main_address TEXT DEFAULT ''"); }
  db.exec(`CREATE TABLE IF NOT EXISTS community_layouts (tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, prefix TEXT DEFAULT '', code_format TEXT DEFAULT 'FBN', buildings_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT, updated_by TEXT DEFAULT '', PRIMARY KEY (tenant_id,community_id));
    CREATE TABLE IF NOT EXISTS resident_units (tenant_id INTEGER NOT NULL, community_id INTEGER NOT NULL, code TEXT NOT NULL, building TEXT DEFAULT '', building_name TEXT DEFAULT '', zone TEXT DEFAULT '', floor INTEGER, no TEXT DEFAULT '', door TEXT DEFAULT '', address TEXT DEFAULT '', short TEXT DEFAULT '', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1, cars_json TEXT DEFAULT '[]', motos_json TEXT DEFAULT '[]', parking_updated_at TEXT, parking_updated_by TEXT DEFAULT '', PRIMARY KEY (tenant_id,community_id,code));`);
  const parse = (s, f) => { try { return JSON.parse(s); } catch { return f; } };

  function cleanLayout(b) {
    const fmt = FORMATS[b?.code_format] ? b.code_format : 'FBN'; const seen = new Set(); const buildings = [];
    for (const x of (Array.isArray(b?.buildings) ? b.buildings : []).slice(0, 40)) {
      const code = half(x?.code).toUpperCase().slice(0, 6); if (!code || seen.has(code)) continue; seen.add(code);
      const type = x?.type === 'list' ? 'list' : 'tower';
      const o = { code, name: str(x?.name, 30) || `${code}棟`, zone: str(x?.zone, 20), type, door: str(x?.door, 60) };
      if (type === 'tower') { o.floor_from = Math.max(-5, Math.min(99, Math.round(Number(x?.floor_from) || 1))); o.floor_to = Math.max(o.floor_from, Math.min(99, Math.round(Number(x?.floor_to) || o.floor_from))); o.units = expandList(x?.units).slice(0, 40).join(','); if (!o.units) o.units = '1'; }
      else o.list = String(x?.list || '').split(/\n/).map(l => l.trim()).filter(Boolean).slice(0, 200).map(l => { const m = l.match(/^(\S+)\s*(.*)$/); return `${half(m[1]).toUpperCase()}${m[2] ? ` ${str(m[2], 60)}` : ''}`; }).join('\n');
      buildings.push(o);
    }
    return { prefix: str(b?.prefix, 60), code_format: fmt, buildings };
  }
  function layout(tid, cid) {
    const r = db.prepare('SELECT * FROM community_layouts WHERE tenant_id=? AND community_id=?').get(tid, cid);
    if (!r) return { configured: false, prefix: '', code_format: 'FBN', buildings: [], updated_at: '', updated_by: '' };
    return { configured: true, prefix: r.prefix || '', code_format: r.code_format || 'FBN', buildings: parse(r.buildings_json, []), updated_at: r.updated_at || '', updated_by: r.updated_by || '' };
  }
  // 依設定產生戶別清單
  function generate(L) {
    const out = []; const mk = FORMATS[L.code_format]?.make || FORMATS.FBN.make; let sort = 0;
    for (const b of L.buildings) {
      if (b.type === 'list') {
        for (const line of String(b.list || '').split('\n').filter(Boolean)) {
          const m = line.match(/^(\S+)\s*(.*)$/); const code = m[1]; let door = m[2] || b.door || '';
          if (door && /^\d/.test(door) && b.door) { const road = (b.door.match(/^(.*?[路街道巷弄段])/) || [])[1] || ''; door = road + door; }
          out.push({ code, building: b.code, building_name: b.name, zone: b.zone, floor: 1, no: code, door, address: `${L.prefix}${door}`, short: door.replace(/^.*?[路街道巷弄段]/, '') || door, sort: sort++ });
        }
        continue;
      }
      const units = expandList(b.units);
      for (let f = b.floor_from; f <= b.floor_to; f++) for (const n of units) {
        const fl = f < 0 ? `地下${cnNum(-f)}樓` : `${cnNum(f)}樓`;
        out.push({ code: mk(f, b.code, n), building: b.code, building_name: b.name, zone: b.zone, floor: f, no: String(n), door: b.door, address: `${L.prefix}${b.door}${fl}之${n}`, short: `${b.door.replace(/^.*?[路街道巷弄段]/, '') || b.door} ${f}樓之${n}`, sort: sort++ });
      }
    }
    return out;
  }
  function save(tid, cid, body, by) {
    const L = cleanLayout(body); if (!L.buildings.length) throw Object.assign(new Error('請至少設定一棟'), { status: 400 });
    for (const b of L.buildings) if (!b.door && b.type === 'tower') throw Object.assign(new Error(`請填寫「${b.name}」的門牌（例如：和平路100號）`), { status: 400 });
    const units = generate(L); const codes = new Set();
    for (const u of units) { if (codes.has(u.code)) throw Object.assign(new Error(`戶別代號重複：${u.code}，請調整代號格式或棟別代號`), { status: 400 }); codes.add(u.code); }
    if (units.length > 5000) throw Object.assign(new Error('戶數太多（上限 5000 戶）'), { status: 400 });
    db.transaction(() => {
      db.prepare('INSERT INTO community_layouts (tenant_id,community_id,prefix,code_format,buildings_json,updated_at,updated_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id,community_id) DO UPDATE SET prefix=excluded.prefix,code_format=excluded.code_format,buildings_json=excluded.buildings_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by')
        .run(tid, cid, L.prefix, L.code_format, JSON.stringify(L.buildings), now(), by);
      db.prepare('UPDATE resident_units SET active=0 WHERE tenant_id=? AND community_id=?').run(tid, cid);
      const up = db.prepare('INSERT INTO resident_units (tenant_id,community_id,code,building,building_name,zone,floor,no,door,address,short,sort,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(tenant_id,community_id,code) DO UPDATE SET building=excluded.building,building_name=excluded.building_name,zone=excluded.zone,floor=excluded.floor,no=excluded.no,door=excluded.door,address=excluded.address,short=excluded.short,sort=excluded.sort,active=1');
      for (const u of units) up.run(tid, cid, u.code, u.building, u.building_name, u.zone, u.floor, u.no, u.door, u.address, u.short, u.sort);
    })();
    return { layout: layout(tid, cid), units: units.length };
  }
  const unitOut = r => ({ code: r.code, building: r.building, building_name: r.building_name, zone: r.zone, floor: r.floor, no: r.no, door: r.door, address: r.address, short: r.short, sort: r.sort, cars: parse(r.cars_json, []), motos: parse(r.motos_json, []) });
  function units(tid, cid) { return db.prepare('SELECT * FROM resident_units WHERE tenant_id=? AND community_id=? AND active=1 ORDER BY sort').all(tid, cid).map(unitOut); }
  function setParking(tid, cid, code, cars, motos, by) {
    const r = db.prepare('SELECT code FROM resident_units WHERE tenant_id=? AND community_id=? AND code=? AND active=1').get(tid, cid, code); if (!r) return false;
    db.prepare('UPDATE resident_units SET cars_json=?,motos_json=?,parking_updated_at=?,parking_updated_by=? WHERE tenant_id=? AND community_id=? AND code=?').run(JSON.stringify(cars), JSON.stringify(motos), now(), by, tid, cid, code); return true;
  }

  // 解析一筆資料對到哪一戶：戶別代號、完整地址、橫向表格的「1-1-0101」都可以
  function resolver(tid, cid) {
    const L = layout(tid, cid); const U = units(tid, cid); const byCode = new Map(U.map(u => [u.code, u]));
    const byLoose = new Map(U.map(u => [u.code.replace(/[-\s]/g, ''), u]));
    const byAddr = new Map(); for (const u of U) byAddr.set(`${doorKey(u.door)}|${u.floor}|${u.no}`, u);
    const byDoor = new Map(); for (const u of U) { const k = doorKey(u.door); if (!byDoor.has(k)) byDoor.set(k, []); byDoor.get(k).push(u); }
    const mk = FORMATS[L.code_format]?.make || FORMATS.FBN.make;
    function fromCode(raw) {
      let s = half(raw).toUpperCase().replace(/[（(].*?[）)]/g, '').replace(/[號室戶]$/, ''); if (!s) return null;
      if (byCode.has(s)) return byCode.get(s); const loose = s.replace(/[-\s]/g, ''); if (byLoose.has(loose)) return byLoose.get(loose);
      // 「2F-1」「2樓之1」配上棟別
      return null;
    }
    function fromAddress(addr) {
      const p = parseAddress(addr); if (!p) return null; const k = doorKey(p.door);
      if (p.floor !== null && p.no !== null) return byAddr.get(`${k}|${p.floor}|${p.no}`) || null;
      const list = byDoor.get(k) || []; return list.length === 1 ? list[0] : null;
    }
    function fromParts(building, floor, no) {
      const b = L.buildings.find(x => x.code === half(building).toUpperCase() || x.name === str(building) || (x.door && half(building).includes(doorKey(x.door))) || new RegExp(`${x.code}棟`).test(half(building)));
      if (!b || !Number.isFinite(floor) || !Number.isFinite(no)) return null; return byCode.get(mk(floor, b.code, no)) || null;
    }
    return function resolve(row) {
      const warn = []; const unitText = String(row.unit || ''); const note = (unitText.match(/[（(](.*?)[）)]/) || [])[1] || '';
      let u = fromCode(unitText); const viaAddr = row.address ? fromAddress(row.address) : null;
      if (!u && /^\d+-\d+-\d{4}/.test(half(unitText))) { const m = half(unitText).match(/-(\d{2})(\d{2})/); u = fromParts(row.building, Number(m[1]), Number(m[2])); }
      if (!u && row.building && row.floor && /^\d+$/.test(half(unitText))) u = fromParts(row.building, Number(half(row.floor).replace(/\D/g, '')), Number(half(unitText)));
      if (u && viaAddr && viaAddr.code !== u.code) warn.push(`戶別 ${u.code} 和門牌地址（${row.address}）對不起來，地址看起來是 ${viaAddr.code}；已依戶別匯入`);
      else if (u && row.address && !viaAddr && parseAddress(row.address)) warn.push(`門牌地址（${row.address}）不在社區設定的門牌裡，已依戶別 ${u.code} 匯入`);
      if (!u && viaAddr) u = viaAddr;
      if (!u) warn.push(unitText || row.address ? `找不到戶別「${unitText || row.address}」，請確認是否在社區戶別清單中` : '沒有戶別或門牌');
      return { unit: u, note, warn };
    };
  }
  return { FORMATS, clean: cleanLayout, layout, save, generate, units, setParking, resolver, parseParking, splitSpaces, parseAddress, cnNum };
};
Object.assign(module.exports, { parseParking, parseAddress, expandList, cnNum, fromCn, FORMATS });
