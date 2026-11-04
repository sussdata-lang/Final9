import { sha256 } from './security.js';

export const GENESIS = '0'.repeat(64);
const rowHash = (prev, r) => sha256([prev, r.at, r.actor_id ?? '', r.actor_label, r.role, r.action, r.ref, r.ip ?? ''].join('|'));

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
  let prev = tailHashCache.get(db);
  if (!prev) {
    const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
    prev = last ? last.hash : GENESIS;
  }
  const row = { at: Date.now(), actor_id: actor?.id ?? null, actor_label: actor?.label ?? 'النظام', role: actor?.roleKey ?? actor?.role ?? 'system', action, ref: String(ref), ip };
  const nextHash = rowHash(prev, row);
  db.prepare('INSERT INTO audit_log (at, actor_id, actor_label, role, action, ref, ip, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(row.at, row.actor_id, row.actor_label, row.role, row.action, row.ref, row.ip, prev, nextHash);
  tailHashCache.set(db, nextHash);
}

export function verifyAuditChain(db) {
  let prev = GENESIS, n = 0;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').all()) {
    n++;
    if (r.prev_hash !== prev || r.hash !== rowHash(prev, r)) {
      tailHashCache.delete(db);
      return { ok: false, brokenAtId: r.id, checked: n };
    }
    prev = r.hash;
  }
  tailHashCache.set(db, prev);
  return { ok: true, checked: n };
}
