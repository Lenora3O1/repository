// 個資欄位加密（AES-256-GCM）：身分證字號、銀行帳號、手機、地址、緊急聯絡人、住戶姓名電話、面試履歷等，
// 在資料庫裡存成亂碼；就算資料庫檔案或備份被偷走，沒有金鑰也看不到內容。
//
// 金鑰：主機環境變數 DATA_ENCRYPTION_KEY（至少 32 個字元的亂碼）。金鑰不放在資料庫或備份裡。
//   ⚠️ 金鑰遺失＝這些欄位永遠無法還原，請另外抄一份由負責人保管。
//
// 作法（程式其他地方不用改）：
//   寫入：用「暫存觸發器」在資料寫進去之後立刻加密那幾個欄位（只存在這次連線，不寫進資料庫檔）。
//   讀取：所有查詢結果中以 enc: 開頭的值自動解密。
//   身分證字號用「固定加密」（同樣的號碼得到同樣的亂碼），才能檢查是否重複登記。
'use strict';
const crypto = require('crypto');

const FIELDS = [
  ['hr_profiles', 'id_no', true], ['hr_profiles', 'bank_account'], ['hr_profiles', 'mobile'], ['hr_profiles', 'address'],
  ['hr_profiles', 'emergency_name'], ['hr_profiles', 'emergency_phone'],
  ['resident_records', 'name'], ['resident_records', 'phone'], ['resident_records', 'address'], ['resident_records', 'extra'], ['resident_records', 'raw_json'],
  ['interview_applicants', 'resume_json'],
  ['payroll_items', 'data_json'],
];
const P_RAND = 'enc:v1:', P_DET = 'enc:d1:';

function deriveKeys(master) {
  const ikm = Buffer.from(String(master), 'utf8');
  const k = n => Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from('hesi-field-crypto'), Buffer.from(n), 32));
  return { enc: k('enc'), det: k('det-iv') };
}

module.exports = function installFieldCrypto(db) {
  const master = process.env.DATA_ENCRYPTION_KEY || '';
  const keys = master.length >= 32 ? deriveKeys(master) : null;
  let failures = 0;

  function enc(v, det = false) {
    if (!keys || v === null || v === undefined) return v;
    const s = String(v); if (!s || s.startsWith('enc:')) return s;
    const iv = det ? crypto.createHmac('sha256', keys.det).update(s).digest().subarray(0, 12) : crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', keys.enc, iv); const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
    return (det ? P_DET : P_RAND) + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }
  function dec(v) {
    if (typeof v !== 'string' || !v.startsWith('enc:')) return v;
    if (!keys) { failures++; return ''; }
    try {
      const b = Buffer.from(v.slice(7), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', keys.enc, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    } catch { failures++; return ''; }
  }
  const decRow = r => { if (!r || typeof r !== 'object') return dec(r); if (Array.isArray(r)) return r.map(dec); for (const k in r) { const v = r[k]; if (typeof v === 'string' && v.charCodeAt(0) === 101 && v.startsWith('enc:')) r[k] = dec(v); } return r; };

  // 讀取：包裝 db.prepare，查詢結果自動解密
  const origPrepare = db.prepare.bind(db);
  db.prepare = function (sql) {
    const st = origPrepare(sql); if (!st.reader) return st;
    const proxy = new Proxy(st, {
      get(t, p) {
        if (p === 'get') return (...a) => decRow(t.get(...a));
        if (p === 'all') return (...a) => t.all(...a).map(decRow);
        if (p === 'iterate') return function* (...a) { for (const r of t.iterate(...a)) yield decRow(r); };
        const v = t[p];
        if (typeof v !== 'function') return v;
        if (['pluck', 'raw', 'expand', 'safeIntegers', 'bind'].includes(p)) return (...a) => { v.apply(t, a); return proxy; };
        return v.bind(t);
      },
    });
    return proxy;
  };
  // SQL 裡可用：enc_field(值, 是否固定加密)、enc_eq(值)（查詢身分證是否重複時用）
  db.function('enc_field', { deterministic: false }, (v, det) => enc(v, !!det));
  db.function('enc_eq', { deterministic: true }, v => enc(v, true));

  // 金鑰檢查：資料庫裡記一筆「用目前金鑰加密的檢查值」，之後開機若金鑰不同或不見了就停止啟動，避免把資料寫壞
  db.exec("CREATE TABLE IF NOT EXISTS sec_meta (k TEXT PRIMARY KEY, v TEXT)");
  function checkKey() {
    const row = origPrepare("SELECT v FROM sec_meta WHERE k='field_key_check'").get();
    if (!row) { if (keys) origPrepare("INSERT INTO sec_meta (k,v) VALUES ('field_key_check',?)").run(enc('hesi-ok')); return { ok: true }; }
    if (!keys) return { ok: false, error: '資料庫裡已有加密的個資欄位，但主機沒有設定 DATA_ENCRYPTION_KEY。請把原本的金鑰設定回環境變數後重新部署。' };
    if (dec(row.v) !== 'hesi-ok') return { ok: false, error: 'DATA_ENCRYPTION_KEY 和資料庫加密時用的金鑰不一樣。請改回原本的金鑰（就是您手抄保存的那一組）後重新部署。' };
    return { ok: true };
  }
  const keyState = checkKey();

  // 開機時（所有資料表都建立後）呼叫：建立加密觸發器，並把舊的明文資料加密
  function activate() {
    if (!keys || !keyState.ok) return { encrypted: 0 };
    let n = 0;
    for (const [t, c, det] of FIELDS) {
      const cols = origPrepare(`PRAGMA table_info(${t})`).all().map(x => x.name); if (!cols.includes(c)) continue;
      const when = `NEW.${c} IS NOT NULL AND NEW.${c}<>'' AND substr(NEW.${c},1,4)<>'enc:'`;
      const body = `UPDATE ${t} SET ${c}=enc_field(NEW.${c},${det ? 1 : 0}) WHERE rowid=NEW.rowid;`;
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS enc_${t}_${c}_i AFTER INSERT ON main.${t} WHEN ${when} BEGIN ${body} END;`);
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS enc_${t}_${c}_u AFTER UPDATE OF ${c} ON main.${t} WHEN ${when} BEGIN ${body} END;`);
      n += origPrepare(`UPDATE ${t} SET ${c}=enc_field(${c},${det ? 1 : 0}) WHERE ${c} IS NOT NULL AND ${c}<>'' AND substr(${c},1,4)<>'enc:'`).run().changes;
    }
    if (n) console.log(`[資安] 已將 ${n} 筆舊的個資欄位加密`);
    return { encrypted: n };
  }
  function status() {
    let plain = 0, encrypted = 0;
    for (const [t, c] of FIELDS) { try { const r = origPrepare(`SELECT SUM(CASE WHEN substr(${c},1,4)='enc:' THEN 1 ELSE 0 END) e, SUM(CASE WHEN ${c}<>'' AND substr(${c},1,4)<>'enc:' THEN 1 ELSE 0 END) p FROM ${t}`).get(); encrypted += r.e || 0; plain += r.p || 0; } catch {} }
    return { key_set: !!keys, key_ok: keyState.ok, error: keyState.error || '', fields: FIELDS.map(([t, c]) => `${t}.${c}`), encrypted, plain, decrypt_failures: failures };
  }
  return { enabled: !!keys, keyState, enc, dec, activate, status };
};
