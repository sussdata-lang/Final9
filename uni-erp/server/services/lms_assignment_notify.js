// إشعارات الاختبارات والتكليفات: تُحفظ داخل الموقع دائماً، وWeb Push إضافة لمن فعّله.
// الفهرس الفريد على (المستخدم، النوع، المرجع) يمنع التكرار عند توسيع الجمهور أو تكرار المهمة المجدولة.
import { tx } from '../db.js';
import { log } from '../lib/logger.js';
import { notify } from './push.js';
import { AUDIENCE_SQL } from './lms_assignment_audience.js';

const HOUR = 3600_000, TICK_MS = 5 * 60_000, PUSH_BATCH = 5000;
const KIND_LABEL = { exam: 'اختبار', assignment: 'تكليف' };
const INSERT = 'INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at)';
export const assignmentUrl = (id) => `/?view=lms&tab=assignments&id=${id}`;

function inboxForQuery(db, { kind, refId, text, url, now }, sql, args) {
  return db.prepare(`${INSERT} SELECT x.id, ?::text, ?::bigint, ?::text, ?::text, ?::bigint FROM (${sql}) x ON CONFLICT DO NOTHING RETURNING user_id`).all(kind, refId, text, url, now, ...args).map((r) => r.user_id);
}
function inboxForUser(db, userId, { kind, refId, text, url, now }) {
  return db.prepare(`${INSERT} VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING user_id`).all(userId, kind, refId, text, url, now).map((r) => r.user_id);
}
// يُستدعى بعد إتمام المعاملة، فلا يصل تنبيه عن شيء لم يُحفظ
export function pushTo(deps, delivery) {
  if (!delivery?.ids.length) return;
  for (let i = 0; i < delivery.ids.length; i += PUSH_BATCH) notify(deps, delivery.ids.slice(i, i + PUSH_BATCH), delivery.payload);
}

// داخل معاملة النشر. عند توسيع الجمهور يصل الإشعار للطلاب الجدد فقط
export function announceAssignment(db, a, now = Date.now()) {
  const label = KIND_LABEL[a.kind] ?? 'اختبار', url = assignmentUrl(a.id), text = `${label} جديد: ${a.title}`;
  const ids = inboxForQuery(db, { kind: 'assign_new', refId: a.id, text, url, now }, AUDIENCE_SQL, [a.id]);
  return { ids, payload: { title: `${label} جديد`, body: a.title, url, tag: `assign-${a.id}` } };
}

export function notifyNewSubmission(db, a, submission, studentName, now = Date.now()) {
  const url = assignmentUrl(a.id), text = `حل جديد من ${studentName} على «${a.title}»`;
  return { ids: inboxForUser(db, a.owner_id, { kind: 'assign_submission', refId: submission.id, text, url, now }), payload: { title: 'حل جديد', body: text, url, tag: `assign-sub-${a.id}` } };
}

export function notifyGraded(db, a, submission, now = Date.now()) {
  const url = assignmentUrl(a.id), text = `رُصدت درجتك في «${a.title}»`;
  return { ids: inboxForUser(db, submission.student_id, { kind: 'assign_grade', refId: submission.id, text, url, now }), payload: { title: 'درجة جديدة', body: text, url, tag: `assign-grade-${submission.id}` } };
}

// تحويل المجدول إلى منشور عند موعده، وتذكير من لم يسلّم قبل 24 ساعة. التحديث الذري هو ما يمنع التكرار بين العمليات والخوادم
export function runAssignmentTick(deps, now = Date.now()) {
  const { db } = deps, out = [];
  tx(db, () => {
    for (const a of db.prepare("UPDATE lms_assignments SET status = 'published', published_at = ?, updated_at = ? WHERE status = 'scheduled' AND starts_at <= ? RETURNING *").all(now, now, now)) out.push(announceAssignment(db, a, now));
  });
  tx(db, () => {
    for (const a of db.prepare("UPDATE lms_assignments SET reminder_sent_at = ? WHERE status = 'published' AND reminder_sent_at IS NULL AND due_at > ? AND due_at <= ? RETURNING *").all(now, now, now + 24 * HOUR)) {
      const url = assignmentUrl(a.id), text = `يقترب آخر موعد لتسليم «${a.title}» خلال 24 ساعة`;
      const ids = inboxForQuery(db, { kind: 'assign_reminder', refId: a.id, text, url, now }, `${AUDIENCE_SQL} AND NOT EXISTS (SELECT 1 FROM lms_assignment_submissions s WHERE s.assignment_id = ? AND s.student_id = sp.user_id AND s.status <> 'draft')`, [a.id, a.id]);
      out.push({ ids, payload: { title: 'تذكير بموعد التسليم', body: text, url, tag: `assign-remind-${a.id}` } });
    }
  });
  out.forEach((d) => pushTo(deps, d));
  return out.reduce((n, d) => n + d.ids.length, 0);
}

export function startAssignmentScheduler(deps) {
  const tick = () => { try { runAssignmentTick(deps); } catch (e) { log.warn('lms_assignments: ' + e.message); } };
  const first = setTimeout(tick, 30_000), timer = setInterval(tick, TICK_MS);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

export function registerUserNotificationRoutes(r, { db }) {
  r.add('GET', '/api/notifications', (c) => {
    const items = db.prepare('SELECT id, kind, text, url, at, read FROM user_notifications WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 50').all(c.user.id);
    c.json(200, { items: items.map((n) => ({ id: n.id, kind: n.kind, text: n.text, url: n.url, at: n.at, read: !!n.read })), unread: Number(db.prepare('SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ? AND read = 0').get(c.user.id).c) });
  });
  r.add('POST', '/api/notifications/read', (c) => {
    const ids = Array.isArray(c.body?.ids) ? c.body.ids.map(Number).filter(Number.isInteger).slice(0, 200) : null;
    if (ids?.length) db.prepare(`UPDATE user_notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).run(c.user.id, ...ids);
    else if (c.body?.all === true) db.prepare('UPDATE user_notifications SET read = 1 WHERE user_id = ? AND read = 0').run(c.user.id);
    c.json(200, { ok: true });
  });
}
