import { tx } from '../db.js';

// أرقام المستندات: عدّاد ذري في القاعدة، فلا يأخذ طلبان متزامنان الرقم نفسه ولو من عمليتين مختلفتين.
// floorSql يعيد أعلى رقم مستخدم، فيبدأ العدّاد مما وصلت إليه البيانات الموجودة. يُلغى العدّ مع إلغاء المعاملة.
export function nextNumber(db, key, floorSql = 'SELECT 0', floorArgs = []) {
  const row = db.prepare(`INSERT INTO doc_sequences (key, value) VALUES (?, COALESCE((${floorSql}), 0) + 1)
    ON CONFLICT (key) DO UPDATE SET value = GREATEST(doc_sequences.value, COALESCE((${floorSql}), 0)) + 1 RETURNING value`).get(key, ...floorArgs, ...floorArgs);
  return Number(row.value);
}

// قفل باسم مفتاح يمتد عبر عمليات الخادم حتى نهاية المعاملة: يسلسل «افحص ثم اكتب» للسجل نفسه دون قيد في الجدول،
// فلا تمنع بيانات قديمة مكررة إقلاع الخادم.
export function withLock(db, key, fn) {
  return tx(db, () => {
    db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(String(key));
    return fn();
  });
}
