// إيقاف البطاقة الجامعية عند الفقدان أو لأي سبب إداري. الإيقاف يسري فوراً عند البوابات وقارئات القاعات.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

const LABEL = { lost: 'فقدان', stolen: 'سرقة', damaged: 'تلف', admin: 'قرار إداري' };
const SELF_REASONS = ['lost', 'stolen'];
const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);

export function activeCardBlock(db, studentId) {
  const r = db.prepare('SELECT * FROM card_blocks WHERE student_id = ? AND cleared_at IS NULL').get(Number(studentId));
  return r ? { id: Number(r.id), reason: r.reason, reasonLabel: LABEL[r.reason], note: r.note, blockedAt: Number(r.blocked_at) } : null;
}

export function assertCardUsable(db, studentId) {
  const b = activeCardBlock(db, studentId);
  if (b) throw new HttpError(409, `البطاقة موقوفة بسبب ${b.reasonLabel}. يُراجع الطالب مكتب الوثائق.`, 'card_blocked');
}

export function blockCard({ db }, actor, studentId, body, ip) {
  const id = Number(studentId), own = actor.role === 'student' && Number(actor.id) === id;
  if (!own && !actor.can?.('student:update')) throw bad('لا تملك صلاحية إيقاف البطاقة.', 403, 'forbidden');
  const student = db.prepare("SELECT id, student_no, display_name FROM users WHERE id = ? AND role = 'student'").get(id);
  if (!student) throw bad('الطالب غير موجود.', 404, 'not_found');
  const reason = String(body?.reason ?? '');
  if (!(own ? SELF_REASONS : Object.keys(LABEL)).includes(reason)) throw bad('سبب الإيقاف غير صالح.');
  const note = String(body?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), now = Date.now();
  const r = db.prepare('INSERT INTO card_blocks (student_id, reason, note, blocked_at, blocked_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').run(id, reason, note, now, actor.id ?? null);
  if (!r.changes) throw bad('البطاقة موقوفة مسبقاً.', 409, 'conflict');
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'card_blocked', ?, ?, '', ?) ON CONFLICT DO NOTHING");
  for (const u of db.prepare("SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE u.active = 1 AND o.code IN ('of_docs', 'safety')").all()) ins.run(u.id, now, `أوقفت بطاقة الطالب ${student.display_name} (${student.student_no}) بسبب ${LABEL[reason]}.`, now);
  audit(db, actor, 'إيقاف بطاقة جامعية', `${student.student_no}: ${LABEL[reason]}`, ip);
  return { block: activeCardBlock(db, id) };
}

export function unblockCard({ db }, actor, studentId, body, ip) {
  const active = activeCardBlock(db, studentId);
  if (!active) throw bad('البطاقة غير موقوفة.', 409, 'conflict');
  const student = db.prepare('SELECT student_no FROM users WHERE id = ?').get(Number(studentId));
  db.prepare('UPDATE card_blocks SET cleared_at = ?, cleared_by = ?, clear_note = ? WHERE id = ?').run(Date.now(), actor.id ?? null, String(body?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), active.id);
  audit(db, actor, 'رفع إيقاف بطاقة جامعية', student?.student_no ?? String(studentId), ip);
  return { block: null };
}
