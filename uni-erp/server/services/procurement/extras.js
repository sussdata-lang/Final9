// المشتريات حسب الواقع: إرسال أمر الشراء إلى المورد، ومرفقات الأمر (الفاتورة وغيرها)، ورمز QR للصنف.
// لا خادم بريد في النظام: «الإرسال» يُعدّ نص الأمر ورابط الإرسال من جهاز المستخدم (بريد أو واتساب) أو للطباعة والتسليم،
// ويسجّل كل إرسال (القناة والجهة ومن أرسل ومتى) ويعتمد الأمر إن كان مسودة.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
import { sha256 } from '../../security.js';
import { readUpload, saveUpload } from '../staging.js';
import { detectMime } from '../requests.js';
import { getSetting } from '../settings.js';
import { qrSvg } from '../../qr.js';
import { bad, clean, getOrder, orderAction, itemQr, listItems } from './core.js';

export const CHANNELS = { email: 'البريد الإلكتروني', whatsapp: 'واتساب', fax: 'الفاكس', hand: 'تسليم باليد', print: 'طباعة وتسليم' };
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const digits = (v) => String(v ?? '').replace(/[^\d+]/g, '');
// رقم سوري محلي (09…) يصير دولياً (9639…) لرابط واتساب
const intl = (v) => { const d = digits(v).replace(/^\+/, '').replace(/^00/, ''); return d.startsWith('0') ? `963${d.slice(1)}` : d; };
const money = (n) => Number(n || 0).toLocaleString('en-US');

function orderText(o) {
  const lines = o.lines.map((l, i) => `${i + 1}. ${l.description || l.itemName}: ${money(l.qty)} ${l.unit || ''} × ${money(l.unitCost)} = ${money(l.lineTotal)}`.replace(/\s+/g, ' ').trim());
  return [
    `أمر شراء رقم ${o.no} — الجامعة السورية للعلوم الأمنية`,
    `إلى: ${o.supplierName}`,
    '', 'البنود:', ...lines, '',
    `المجموع الكامل: ${money(o.grandTotal ?? o.totalAmount)} ${o.currency || 'ليرة سورية'}`,
    o.deliveryDay ? `تاريخ التوصيل المطلوب: ${o.deliveryDay}` : '',
    o.deliveryAddress ? `عنوان التوصيل: ${o.deliveryAddress}` : '',
    o.paymentTerms ? `شروط الدفع: ${o.paymentTerms}` : '',
    '', `يرجى ذكر رقم أمر الشراء ${o.no} على الفاتورة ومذكرة التسليم.`,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}

export function dispatchOrder(deps, actor, id, b, ip) {
  const { db } = deps;
  const o = db.prepare('SELECT * FROM proc_orders WHERE id=?').get(Number(id));
  if (!o) throw bad('أمر التوريد غير موجود.', 404, 'not_found');
  if (!['draft', 'ordered'].includes(o.status)) throw bad('لا يُرسل أمر ملغى أو مستلم.', 409, 'conflict');
  const channel = String(b?.channel ?? '');
  if (!CHANNELS[channel]) throw bad(`قناة الإرسال: ${Object.values(CHANNELS).join('، ')}.`);
  const sup = db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(o.supplier_id) ?? {};
  const typed = String(b?.recipient ?? '').trim();
  let recipient = typed || (channel === 'email' ? sup.email : channel === 'whatsapp' ? (sup.mobile || sup.phone) : channel === 'fax' ? sup.fax : '') || '';
  recipient = String(recipient).trim().slice(0, 120);
  if (channel === 'email' && !EMAIL_RE.test(recipient)) throw bad(recipient ? 'البريد الإلكتروني للمورد غير صالح.' : 'لا يوجد بريد إلكتروني للمورد؛ اكتبه.');
  if ((channel === 'whatsapp' || channel === 'fax') && !/^\+?\d{7,15}$/.test(digits(recipient))) throw bad(recipient ? 'رقم المورد غير صالح.' : `لا يوجد رقم ${channel === 'fax' ? 'فاكس' : 'موبايل'} للمورد؛ اكتبه.`);
  const note = String(b?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const approved = tx(db, () => {
    const wasDraft = o.status === 'draft';
    if (wasDraft) orderAction(deps, actor, o.id, 'order', ip);            // الإرسال يعتمد المسودة (مع فحص الموازنة)
    db.prepare('INSERT INTO proc_order_dispatches (order_id, channel, recipient, note, sent_by, sent_at) VALUES (?,?,?,?,?,?)').run(o.id, channel, recipient || null, note || null, actor.id ?? null, Date.now());
    audit(db, actor, `إرسال أمر شراء إلى المورد (${CHANNELS[channel]})`, `${o.no}${recipient ? ` → ${recipient}` : ''}`.slice(0, 200), ip);
    return wasDraft;
  });
  const order = getOrder(db, o.id).order, text = orderText(order);
  const link = channel === 'email' ? `mailto:${recipient}?subject=${encodeURIComponent(`أمر شراء ${order.no}`)}&body=${encodeURIComponent(text)}`
    : channel === 'whatsapp' ? `https://wa.me/${intl(recipient)}?text=${encodeURIComponent(text)}` : null;
  return { order, text, link, approvedNow: approved };
}

/* ---------- مرفقات أمر الشراء ---------- */
export const FILE_KINDS = { invoice: 'فاتورة المورد', delivery: 'مذكرة التسليم', quote: 'عرض السعر', other: 'مرفق آخر' };
export function addOrderFiles({ db, cfg }, actor, id, b, ip) {
  const o = db.prepare('SELECT * FROM proc_orders WHERE id=?').get(Number(id));
  if (!o) throw bad('أمر التوريد غير موجود.', 404, 'not_found');
  const kind = FILE_KINDS[b?.kind] ? b.kind : 'invoice';
  const list = Array.isArray(b?.files) ? b.files : [];
  if (!list.length) throw bad('اختر ملفاً واحداً على الأقل.');
  if (list.length > 10) throw bad('حتى 10 ملفات في المرة الواحدة.');
  const MAX = Number(getSetting(db, 'requests.max_attachment_mb')) * 1048576;
  const files = list.map((a) => {
    if (!a || (typeof a.data !== 'string' && !a.staged) || typeof a.name !== 'string') throw bad('ملف غير صالح.');
    const f = readUpload(a);
    if (!f.size || f.size > MAX) throw new HttpError(413, `حجم الملف الواحد حتى ${MAX / 1048576} ميغابايت.`, 'too_large');
    const mime = detectMime(f.head);
    if (!mime) throw new HttpError(415, 'الملفات المقبولة: PDF أو صورة JPG أو PNG (ممسوحة بالسكانر أو مصوّرة بالكاميرا).', 'bad_type');
    return { ...f, mime, name: path.basename(a.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'file' };
  });
  const stored = [];
  try {
    tx(db, () => {
      fs.mkdirSync(cfg.uploadDir, { recursive: true });
      for (const f of files) {
        const name = crypto.randomBytes(16).toString('hex'), p = path.join(cfg.uploadDir, name);
        saveUpload(f, p); stored.push(p);
        db.prepare('INSERT INTO proc_order_files (order_id, kind, orig_name, stored_name, mime, size, sha256, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(o.id, kind, f.name, name, f.mime, f.size, f.sha, actor.id ?? null, Date.now());
      }
      audit(db, actor, `إرفاق ${FILE_KINDS[kind]} بأمر شراء`, `${o.no}: ${files.length} ملف`, ip);
    });
  } catch (e) { for (const p of stored) fs.rmSync(p, { force: true }); throw e; }
  return getOrder(db, o.id);
}
export async function readOrderFile({ db, cfg }, fid) {
  const f = db.prepare('SELECT * FROM proc_order_files WHERE id=?').get(Number(fid));
  if (!f) throw bad('الملف غير موجود.', 404, 'not_found');
  const buf = await fs.promises.readFile(path.join(cfg.uploadDir, f.stored_name));
  if (sha256(buf) !== f.sha256) throw new HttpError(500, 'سلامة الملف مخالفة للمسجَّل.', 'integrity');
  return { buf, mime: f.mime, name: f.orig_name };
}
export function deleteOrderFile({ db, cfg }, actor, fid, ip) {
  const f = db.prepare('SELECT f.*, o.no FROM proc_order_files f JOIN proc_orders o ON o.id=f.order_id WHERE f.id=?').get(Number(fid));
  if (!f) throw bad('الملف غير موجود.', 404, 'not_found');
  db.prepare('DELETE FROM proc_order_files WHERE id=?').run(f.id);
  fs.rmSync(path.join(cfg.uploadDir, f.stored_name), { force: true });
  audit(db, actor, 'حذف مرفق أمر شراء', `${f.no}: ${f.orig_name}`, ip);
  return getOrder(db, f.order_id);
}

/* ---------- رمز QR للصنف ---------- */
export function setItemQr({ db }, actor, id, b, ip) {
  const it = db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id));
  if (!it) throw bad('الصنف غير موجود.', 404, 'not_found');
  // توليد رمز جديد، أو حفظ رمز مقروء من ملصق موجود، أو إزالته
  const code = b?.generate ? `SUSS-ITM-${it.code}-${crypto.randomBytes(3).toString('hex').toUpperCase()}` : itemQr(db, b?.code, it.id);
  if (b?.generate) itemQr(db, code, it.id);
  db.prepare('UPDATE proc_items SET qr_code=? WHERE id=?').run(code, it.id);
  audit(db, actor, code ? (b?.generate ? 'توليد رمز QR لصنف' : 'ربط رمز QR مقروء بصنف') : 'إزالة رمز QR لصنف', it.code, ip);
  return { item: listItems(db, { q: it.code }).find((x) => x.id === Number(it.id)) };
}
export function itemQrSvg({ db }, id) {
  const it = db.prepare('SELECT qr_code FROM proc_items WHERE id=?').get(Number(id));
  if (!it || !it.qr_code) throw bad('لا رمز QR لهذا الصنف.', 404, 'not_found');
  return qrSvg(it.qr_code);
}
export function itemByQr({ db }, code) {
  const s = String(code ?? '').trim();
  if (!s) throw bad('رمز QR فارغ.');
  const it = listItems(db, { qr: s })[0];
  if (!it) throw bad('لا صنف بهذا الرمز.', 404, 'not_found');
  return { item: it };
}
