// تعديل وحذف الذمم وقواعد الفحص الآلي (كانت تُنشأ وتُعطَّل فقط)
import { bad } from '../validate.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { cleanRuleParams } from './rules.js';
import { encryptField, decryptField } from '../lib/data_crypto.js';

const HOLD_TYPES = ['financial', 'disciplinary', 'library'];

export function updateHold({ db, cfg }, actor, id, b, ip) {
  const h = db.prepare('SELECT h.*, u.student_no FROM student_holds h JOIN users u ON u.id = h.student_id WHERE h.id = ?').get(Number(id));
  if (!h) throw new HttpError(404, 'الذمة غير موجودة.', 'not_found');
  const type = b?.holdType ?? h.hold_type;
  if (!HOLD_TYPES.includes(type)) throw bad('نوع الذمة غير صالح.');
  // النص المرسل دائماً صريح؛ غياب b.note يعني الإبقاء على ما كان (يُفَكّ أولاً لئلا يُشفَّر مرتين إن بقي النوع انضباطياً)
  const plain = b?.note === undefined ? decryptField(cfg, h.note ?? '') : String(b.note).replace(/\s+/g, ' ').trim().slice(0, 200);
  const note = type === 'disciplinary' ? encryptField(cfg, plain) : plain;
  tx(db, () => { db.prepare('UPDATE student_holds SET hold_type = ?, note = ? WHERE id = ?').run(type, note, h.id); audit(db, actor, `تعديل ذمة (${type})`, h.student_no, ip); });
}

export function deleteHold({ db }, actor, id, ip) {
  const h = db.prepare('SELECT h.id, u.student_no FROM student_holds h JOIN users u ON u.id = h.student_id WHERE h.id = ?').get(Number(id));
  if (!h) throw new HttpError(404, 'الذمة غير موجودة.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM student_holds WHERE id = ?').run(h.id); audit(db, actor, 'حذف ذمة', h.student_no, ip); });
}

// المعاملات تُتحقَّق حسب نوع القاعدة كي لا تُكسَر الفحوص عند الطلب (يقرأها rules.js دون تحقق)
function parseParams(kind, p) {
  const { params, error } = cleanRuleParams(kind, p);
  if (error) throw bad(error);
  return params;
}
const cleanMessage = (m) => { const s = String(m ?? '').replace(/\s+/g, ' ').trim(); if (s.length < 3 || s.length > 300) throw bad('رسالة الرفض بين 3 و300 حرف.'); return s; };

export function createRule({ db }, actor, b, ip) {
  const service = b?.service ? String(b.service) : null;
  if (service && !db.prepare('SELECT 1 AS x FROM service_types WHERE code = ?').get(service)) throw bad('الخدمة غير موجودة.');
  const message = cleanMessage(b?.message), params = JSON.stringify(parseParams(b?.kind, b?.params));
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO rules (service_code, kind, params_json, message) VALUES (?,?,?,?)').run(service, String(b.kind), params, message).lastInsertRowid);
    audit(db, actor, `إضافة قاعدة فحص (${b.kind})`, String(id), ip);
    return { id };
  });
}

export function updateRule({ db }, actor, id, b, ip) {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'القاعدة غير موجودة.', 'not_found');
  const message = b?.message === undefined ? r.message : cleanMessage(b.message);
  let params = r.params_json;
  if (b?.params !== undefined) {
    let obj = b.params; if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { throw bad('معاملات القاعدة ليست JSON صالحاً.'); } }
    params = JSON.stringify(parseParams(r.kind, obj));
  }
  tx(db, () => { db.prepare('UPDATE rules SET message = ?, params_json = ? WHERE id = ?').run(message, params, r.id); audit(db, actor, `تعديل قاعدة فحص (${r.kind})`, String(r.id), ip); });
}

export function deleteRule({ db }, actor, id, ip) {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'القاعدة غير موجودة.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM rules WHERE id = ?').run(r.id); audit(db, actor, `حذف قاعدة فحص (${r.kind})`, String(r.id), ip); });
}
