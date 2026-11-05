import crypto from 'node:crypto';
import { sha256 } from './security.js';

export const GENESIS = '0'.repeat(64);
const rowText = (prev, r) => [prev, r.at, r.actor_id ?? '', r.actor_label, r.role, r.action, r.ref, r.ip ?? ''].join('|');
const legacyHash = (prev, r) => sha256(rowText(prev, r));
// البصمة بمفتاح خارج القاعدة: من يكتب في القاعدة وحدها لا يستطيع إعادة حساب السلسلة. الصفوف الأقدم من المفتاح بلا مفتاح
let auditKey = null;
export const setAuditKey = (k) => { if (!auditKey && k) auditKey = k; };
const rowHash = (prev, r) => (auditKey ? crypto.createHmac('sha256', auditKey).update(rowText(prev, r)).digest('hex') : legacyHash(prev, r));
const ANCHOR = 'audit.chain_anchor';

// ذاكرة مؤقتة لآخر بصمة في سلسلة التدقيق لتسريع الكتابة المتزامنة (10+ عمليات/ثانية) دون استعلام SELECT إضافي في كل عملية
const tailHashCache = new WeakMap();

export function invalidateAuditTailCache(db) {
  if (db) tailHashCache.delete(db);
}

// إضافة سجل: كل صف يضم بصمة الصف السابق، فأي حذف أو تعديل لاحق يكسر السلسلة.
export function audit(db, actor, action, ref = '', ip = null) {
  // خيط العمليات الثقيلة لا يكتب في السلسلة مباشرة: كاتبان متزامنان يكسران تسلسل البصمات (انظر heavy.js)
  if (db.auditSink) {
    db.auditSink.push({ actor: actor ? { id: actor.id, label: actor.label, roleKey: actor.roleKey, role: actor.role } : null, action, ref: String(ref), ip });
    return;
  }
  const row = { at: Date.now(), actor_id: actor?.id ?? null, actor_label: actor?.label ?? 'النظام', role: actor?.roleKey ?? actor?.role ?? 'system', action, ref: String(ref), ip };
  let prev = tailHashCache.get(db);
  // عملية أخرى قد تسبق إلى الذيل نفسه؛ حينها لا يُدرج الصف ويُعاد الحساب، فتبقى السلسلة خطًا واحدًا
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!prev) {
      const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
      prev = last ? last.hash : GENESIS;
    }
    const nextHash = rowHash(prev, row);
    const done = db.prepare('INSERT INTO audit_log (at, actor_id, actor_label, role, action, ref, ip, prev_hash, chain_prev, hash) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (chain_prev) DO NOTHING')
      .run(row.at, row.actor_id, row.actor_label, row.role, row.action, row.ref, row.ip, prev, prev, nextHash);
    if (done.changes) {
      tailHashCache.set(db, nextHash);
      return;
    }
    tailHashCache.delete(db);
    prev = null;
  }
  throw new Error('تعذر تسجيل حدث التدقيق بعد محاولات متكررة.');
}

export function verifyAuditChain(db) {
  // بعد حذف ما تجاوز مدة الاحتفاظ تبدأ السلسلة من المرساة المحفوظة
  let prev = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(ANCHOR)?.value || GENESIS, n = 0, legacyRows = 0, keyed = false;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').all()) {
    n++;
    const okKeyed = r.hash === rowHash(prev, r);
    // صف بلا مفتاح يُقبل قبل أول صف بمفتاح فقط، فلا يمكن إدراج صفوف مزورة بعده
    const okLegacy = !keyed && r.hash === legacyHash(prev, r);
    if (r.prev_hash !== prev || !(okKeyed || okLegacy)) {
      tailHashCache.delete(db);
      return { ok: false, brokenAtId: r.id, checked: n };
    }
    if (okKeyed && auditKey) keyed = true; else legacyRows++;
    prev = r.hash;
  }
  tailHashCache.set(db, prev);
  return { ok: true, checked: n, legacyRows };
}

// يحذف ما تجاوز مدة الاحتفاظ، ويحفظ بصمة آخر صف محذوف لتبقى السلسلة قابلة للتحقق. يُفك منع الحذف داخل المعاملة وحدها
export function purgeAuditLog(db, years, now = Date.now()) {
  const cutoff = now - Number(years) * 365.25 * 24 * 3600_000;
  const last = db.prepare('SELECT id, hash FROM audit_log WHERE at < ? ORDER BY id DESC LIMIT 1').get(cutoff);
  if (!last) return { removed: 0 };
  db.prepare('BEGIN').run();
  try {
    db.prepare('ALTER TABLE audit_log DISABLE TRIGGER audit_no_delete').run();
    const removed = Number(db.prepare('DELETE FROM audit_log WHERE id <= ?').run(last.id).changes ?? 0);
    db.prepare('ALTER TABLE audit_log ENABLE TRIGGER audit_no_delete').run();
    db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(ANCHOR, last.hash);
    db.prepare('COMMIT').run();
    return { removed };
  } catch (e) { db.prepare('ROLLBACK').run(); throw e; }
}
