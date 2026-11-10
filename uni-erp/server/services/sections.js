// شعب المقررات وفترة التسجيل والحذف والإضافة للفصل الحالي.
import { getSetting } from './settings.js';
import { academicYear } from '../lib/doc_no.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (db, key) => { const v = String(getSetting(db, key) ?? '').trim(); return DAY_RE.test(v) ? v : ''; };
const today = () => new Date().toISOString().slice(0, 10);
const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// الحد الفصلي للساعات حسب المعدل الموزون للعلامات المعتمدة؛ الطالب بلا علامات يأخذ الحد المتوسط
export function creditCap(db, studentId) {
  const r = studentId ? db.prepare("SELECT SUM(mark * hours) AS pts, SUM(hours) AS hrs FROM grades WHERE student_id = ? AND workflow_status = 'approved'").get(Number(studentId)) : null;
  const gpa = r && Number(r.hrs) > 0 ? Math.round((Number(r.pts) / Number(r.hrs)) * 10) / 10 : null;
  const n = (k) => Number(getSetting(db, k));
  const cap = gpa === null ? n('academic.cap_hours_default') : gpa < n('academic.cap_gpa_low') ? n('academic.cap_hours_low') : gpa >= n('academic.cap_gpa_high') ? n('academic.cap_hours_high') : n('academic.cap_hours_default');
  return { cap, gpa };
}

// اسم الفصل الجاري كما يُحفظ مع التسجيل: من الإعدادات والعام الدراسي
export const currentTerm = (db) => `${getSetting(db, 'academic.current_semester')} ${academicYear()}`;

export function registrationWindow(db) {
  const open = day(db, 'academic.registration_open'), close = day(db, 'academic.add_drop_close'), now = today();
  return { term: currentTerm(db), open, close, isOpen: (!open || now >= open) && (!close || now <= close) };
}

export function assertRegistrationOpen(db) {
  const w = registrationWindow(db);
  if (w.isOpen) return;
  throw new HttpError(409, w.open && today() < w.open ? `يبدأ التسجيل في ${w.open}.` : `انتهت فترة الحذف والإضافة في ${w.close}.`, 'registration_closed');
}

const SELECT = `SELECT s.*, c.code AS course_code, c.name AS course_name, c.hours,
  (SELECT COUNT(*) FROM student_self_enrollments e WHERE e.section_id = s.id AND e.dropped_at IS NULL) AS enrolled
  FROM course_sections s JOIN courses c ON c.id = s.course_id`;
const view = (r) => ({
  id: Number(r.id), courseId: Number(r.course_id), courseCode: r.course_code, courseName: r.course_name, hours: Number(r.hours), term: r.term, name: r.name,
  capacity: Number(r.capacity), enrolled: Number(r.enrolled), seatsLeft: Math.max(0, Number(r.capacity) - Number(r.enrolled)), instructor: r.instructor, hall: r.hall, schedule: r.schedule, active: !!Number(r.active),
});

export function listSections(db, { activeOnly = false } = {}) {
  return db.prepare(`${SELECT} WHERE s.term = ? ${activeOnly ? 'AND s.active = 1' : ''} ORDER BY c.code, s.name`).all(currentTerm(db)).map(view);
}
export const activeSectionsOf = (db, courseCode) => db.prepare(`${SELECT} WHERE s.term = ? AND s.active = 1 AND c.code = ? ORDER BY s.name`).all(currentTerm(db), courseCode).map(view);

const capacityOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2000) throw bad('سعة الشعبة عدد صحيح من 1 إلى 2000.');
  return n;
};

export function createSection({ db }, actor, b, ip) {
  const course = db.prepare('SELECT id, code FROM courses WHERE code = ? AND active = 1 ORDER BY id LIMIT 1').get(String(b?.courseCode ?? ''));
  if (!course) throw bad('المقرر غير موجود أو غير مفعل.', 404, 'not_found');
  const name = clean(b?.name, 20), term = currentTerm(db);
  if (!name) throw bad('اسم الشعبة مطلوب.');
  if (db.prepare('SELECT 1 FROM course_sections WHERE course_id = ? AND term = ? AND name = ?').get(course.id, term, name)) throw bad('هذه الشعبة موجودة لهذا المقرر في الفصل الحالي.', 409, 'conflict');
  const id = Number(db.prepare('INSERT INTO course_sections (course_id, term, name, capacity, instructor, hall, schedule, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
    .get(course.id, term, name, capacityOf(b?.capacity), clean(b?.instructor, 120), clean(b?.hall, 60), clean(b?.schedule, 120), actor.id ?? null, Date.now()).id);
  audit(db, actor, 'إنشاء شعبة مقرر', `${course.code} — ${name} (${term})`, ip);
  return { id };
}

export function updateSection({ db }, actor, id, b, ip) {
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(Number(id));
  if (!row) throw bad('الشعبة غير موجودة.', 404, 'not_found');
  const capacity = b?.capacity === undefined ? Number(row.capacity) : capacityOf(b.capacity);
  if (capacity < Number(row.enrolled)) throw bad(`السعة أقل من عدد المسجلين (${row.enrolled}).`, 409, 'conflict');
  const active = b?.active === undefined ? Number(row.active) : (b.active ? 1 : 0);
  db.prepare('UPDATE course_sections SET capacity = ?, active = ?, instructor = ?, hall = ?, schedule = ? WHERE id = ?')
    .run(capacity, active, b?.instructor === undefined ? row.instructor : clean(b.instructor, 120), b?.hall === undefined ? row.hall : clean(b.hall, 60), b?.schedule === undefined ? row.schedule : clean(b.schedule, 120), row.id);
  audit(db, actor, 'تعديل شعبة مقرر', `${row.course_code} — ${row.name}: السعة ${capacity}، ${active ? 'مفعلة' : 'معطلة'}`, ip);
  return { ok: true };
}

// الحذف يُبقي السجل بحالته، فيبقى أثره ظاهراً ويتحرر المقعد
export function dropEnrollment({ db }, actor, id, ip) {
  const row = db.prepare('SELECT * FROM student_self_enrollments WHERE id = ?').get(Number(id));
  const own = row && actor.student_no && row.student_no === actor.student_no;
  if (!row || (!own && !actor.can?.('course:manage') && !actor.can?.('student:register'))) throw bad('التسجيل غير موجود.', 404, 'not_found');
  if (row.dropped_at) throw bad('حُذف هذا التسجيل مسبقاً.', 409, 'conflict');
  if (row.semester !== currentTerm(db)) throw bad('لا يُحذف إلا تسجيل الفصل الحالي.', 409, 'conflict');
  if (own) assertRegistrationOpen(db);
  db.prepare("UPDATE student_self_enrollments SET dropped_at = ?, status = 'محذوف' WHERE id = ?").run(Date.now(), row.id);
  audit(db, actor, 'حذف تسجيل مقرر', `${row.student_no}: ${row.course_code} (${row.semester})`, ip);
  return { ok: true };
}
