// 電子發票加值中心串接
// - 綠界 ECPay：B2C 一般開立（/B2CInvoice/Issue）、作廢（/B2CInvoice/Invalid）。資料先 URL Encode 再 AES-128-CBC（PKCS7）加密，Base64 傳送。
// - 其他加值中心尚未串接：請改用「外部開立後登錄發票號碼」。
// - 測試：環境變數 EINVOICE_MOCK=1 時不連線，回傳模擬的發票號碼。
'use strict';
const crypto = require('crypto');

const ECPAY = { stage: 'https://einvoice-stage.ecpay.com.tw', prod: 'https://einvoice.ecpay.com.tw' };
// 與 .NET HttpUtility.UrlEncode 相同：空白轉 +，其餘依 encodeURIComponent
const urlenc = s => encodeURIComponent(s).replace(/%20/g, '+');
const urldec = s => decodeURIComponent(String(s).replace(/\+/g, '%20'));
function aesEnc(text, key, iv) { const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8')); return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64'); }
function aesDec(b64, key, iv) { const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8')); return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8'); }
const err = (m) => Object.assign(new Error(m), { status: 400 });

async function ecpayCall(cfg, path, data) {
  if (!cfg.merchant_id || !cfg.hash_key || !cfg.hash_iv) throw err('加值中心串接資料不完整（特店代號、HashKey、HashIV），請聯絡系統管理者');
  if (cfg.hash_key.length !== 16 || cfg.hash_iv.length !== 16) throw err('綠界 HashKey／HashIV 應為 16 碼，請聯絡系統管理者確認');
  const body = { MerchantID: cfg.merchant_id, RqHeader: { Timestamp: Math.floor(Date.now() / 1000) }, Data: aesEnc(urlenc(JSON.stringify({ MerchantID: cfg.merchant_id, ...data })), cfg.hash_key, cfg.hash_iv) };
  let r;
  try { r = await fetch(`${cfg.test_mode ? ECPAY.stage : ECPAY.prod}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw err(`無法連線到綠界（${e.message}），請稍後再試或改用手動登錄`); }
  const j = await r.json().catch(() => null); if (!j) throw err(`綠界回應格式錯誤（HTTP ${r.status}）`);
  if (Number(j.TransCode) !== 1) throw err(`綠界傳輸失敗：${j.TransMsg || j.TransCode}`);
  let out; try { out = JSON.parse(urldec(aesDec(j.Data, cfg.hash_key, cfg.hash_iv))); } catch { throw err('無法解開綠界回應，請確認 HashKey／HashIV'); }
  if (Number(out.RtnCode) !== 1) throw err(`綠界：${out.RtnMsg || `錯誤代碼 ${out.RtnCode}`}`);
  return out;
}

// bill：{ id, tenant_id, client:{name,tax_id,address,email,phone}, items:[{name, gross}], gross, tax_exempt, remark }
async function issue(cfg, bill) {
  if (process.env.EINVOICE_MOCK === '1') { const n = String(Date.now()).slice(-8); return { invoice_no: `ZZ${n}`, invoice_date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), random: '1234', provider: 'mock', raw: { mock: true } }; }
  if (cfg.provider !== 'ecpay') throw err('目前系統只串接綠界電子發票；其他加值中心請先在加值中心網站開立，再回來登錄發票號碼');
  const c = bill.client || {};
  if (!c.name) throw err('合約的買受人名稱是空的，請先到社區合約補上');
  if (!c.address) throw err('電子發票需要買受人地址（列印證明聯用），請先到社區合約補上');
  const phone = String(c.phone || '').replace(/\D/g, '').slice(0, 20);
  if (!c.email && !phone) throw err('電子發票需要買受人 Email 或電話，請先到社區合約補上');
  const items = bill.items.map((x, i) => ({ ItemSeq: i + 1, ItemName: String(x.name).slice(0, 100), ItemCount: 1, ItemWord: '式', ItemPrice: x.gross, ItemTaxType: bill.tax_exempt ? '3' : '1', ItemAmount: x.gross }));
  const data = {
    RelateNumber: `T${bill.tenant_id}B${bill.id}R${Date.now().toString(36)}`.toUpperCase().slice(0, 50), CustomerID: '', CustomerIdentifier: c.tax_id || '', CustomerName: String(c.name).slice(0, 60),
    CustomerAddr: String(c.address).slice(0, 100), CustomerPhone: phone, CustomerEmail: c.email || '', ClearanceMark: '', Print: '1', Donation: '0', LoveCode: '', CarrierType: '', CarrierNum: '',
    TaxType: bill.tax_exempt ? '3' : '1', SpecialTaxType: bill.tax_exempt ? 8 : 0, SalesAmount: bill.gross, InvoiceRemark: String(bill.remark || '').slice(0, 200), Items: items, InvType: '07', vat: '1',
  };
  const o = await ecpayCall(cfg, '/B2CInvoice/Issue', data);
  return { invoice_no: o.InvoiceNo, invoice_date: String(o.InvoiceDate || '').slice(0, 10).replace(/\//g, '-'), random: o.RandomNumber || '', provider: 'ecpay', raw: { RelateNumber: data.RelateNumber, InvoiceNo: o.InvoiceNo, InvoiceDate: o.InvoiceDate, RandomNumber: o.RandomNumber } };
}
async function invalid(cfg, inv, reason) {
  if (process.env.EINVOICE_MOCK === '1') return { ok: true };
  if (cfg.provider !== 'ecpay') throw err('目前系統只串接綠界；請到加值中心網站作廢這張發票');
  await ecpayCall(cfg, '/B2CInvoice/Invalid', { InvoiceNo: inv.invoice_no, InvoiceDate: inv.invoice_date, Reason: String(reason || '作廢').slice(0, 20) });
  return { ok: true };
}
module.exports = { issue, invalid, _test: { aesEnc, aesDec, urlenc, urldec } };
