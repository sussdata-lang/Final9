// جدول محاضرات المقررات وكشف التعارض بين مقررات الطالب
import { passMarkFor } from './academics.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

export const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s, label) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim());
  if (!m) throw new HttpError(400, `${label}: صيغة الوقت HH:MM.`, 'validation');
  return Number(m[1]) * 60 + Number(m[2]);
};

export function getSlots(db, courseId) {
  return db.prepare('SELECT s.id, s.day, s.start_min, s.end_min, s.hall, s.group_id, g.name AS group_name FROM course_schedules s LEFT JOIN student_groups g ON g.id = s.group_id WHERE s.course_id = ? ORDER BY s.day, s.start_min').all(Number(courseId))
    .map((r) => ({ id: r.id, day: r.day, dayLabel: DAYS[r.day], start: hm(r.start_min), end: hm(r.end_min), hall: r.hall ?? '', groupId: r.group_id ?? null, groupName: r.group_name ?? '' }));
}

// تعارض موعد مع مقرر آخر: القاعة نفسها أو المدرّس نفسه في وقت متداخل
export function findSlotConflict(others, course, slot) {
  for (const o of others) {
    if (o.course_id === course.id || o.day !== slot.day || !(slot.a < o.end_min && o.start_min < slot.b)) continue;
    if (slot.hall && o.hall === slot.hall) return `تضارب قاعة: القاعة ${o.hall} محجوزة لمقرر «${o.course_name}» في ${DAYS[o.day]} ${hm(o.start_min)}-${hm(o.end_min)}.`;
    const sameMember = course.member_id && o.member_id === course.member_id;
    const sameName = course.instructor && o.instructor === course.instructor;
    if (sameMember || sameName) return `تضارب مدرّس: لدى ${course.instructor || 'المدرّس'} مقرر «${o.course_name}» في ${DAYS[o.day]} ${hm(o.start_min)}-${hm(o.end_min)}.`;
  }
  return null;
}

// كل مواعيد الجامعة، للعرض في شاشة الجدول
export function listAllSlots(db) {
  return db.prepare(`SELECT s.id, s.course_id, s.day, s.start_min, s.end_min, s.hall, c.code, c.name, c.instructor, p.faculty, g.name AS group_name
    FROM course_schedules s JOIN courses c ON c.id = s.course_id LEFT JOIN programs p ON p.id = c.program_id LEFT JOIN student_groups g ON g.id = s.group_id
    ORDER BY s.day, s.start_min`).all().map((r) => ({
    id: r.id, course_id: r.course_id, course_code: r.code ?? '', course_name: r.name, faculty_name: r.faculty ?? '', instructor_name: r.instructor ?? '',
    hall_code: r.hall ?? '', day_name: DAYS[r.day], time_slot: `${hm(r.start_min)} - ${hm(r.end_min)}`, group_name: r.group_name ?? '', status: 'معتمد',
  }));
}

export function addSlot(deps, actor, courseId, slot, ip) {
  const current = getSlots(deps.db, courseId).map((s) => ({ day: s.day, start: s.start, end: s.end, hall: s.hall, groupId: s.groupId }));
  return setSlots(deps, actor, courseId, [...current, slot], ip);
}

export function setSlots({ db }, actor, courseId, slots, ip) {
  const c = db.prepare('SELECT id, name, member_id, instructor FROM courses WHERE id = ?').get(Number(courseId));
  if (!c) throw new HttpError(404, 'المقرر غير موجود.', 'not_found');
  if (!Array.isArray(slots) || slots.length > 20) throw new HttpError(400, 'الحد الأقصى 20 موعداً للمقرر.', 'validation');
  const clean = slots.map((s, i) => {
    const day = Number(s?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new HttpError(400, `الموعد ${i + 1}: اليوم غير صالح.`, 'validation');
    const a = toMin(s.start, `الموعد ${i + 1} (البداية)`), b = toMin(s.end, `الموعد ${i + 1} (النهاية)`);
    if (b <= a) throw new HttpError(400, `الموعد ${i + 1}: النهاية يجب أن تكون بعد البداية.`, 'validation');
    const hall = String(s.hall ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const groupId = Number(s.groupId) || null;
    if (groupId && !db.prepare('SELECT 1 AS x FROM student_groups WHERE id = ?').get(groupId)) throw new HttpError(400, `الموعد ${i + 1}: الفئة غير موجودة.`, 'validation');
    return { day, a, b, hall: hall || null, groupId };
  });
  const others = db.prepare('SELECT s.course_id, s.day, s.start_min, s.end_min, s.hall, x.name AS course_name, x.member_id, x.instructor FROM course_schedules s JOIN courses x ON x.id = s.course_id WHERE s.course_id <> ?').all(c.id);
  for (const s of clean) {
    const reason = findSlotConflict(others, c, s);
    if (reason) throw new HttpError(409, reason, 'schedule_conflict');
  }
  tx(db, () => {
    db.prepare('DELETE FROM course_schedules WHERE course_id = ?').run(c.id);
    for (const s of clean) db.prepare('INSERT INTO course_schedules (course_id, day, start_min, end_min, hall, group_id) VALUES (?,?,?,?,?,?)').run(c.id, s.day, s.a, s.b, s.hall, s.groupId);
    audit(db, actor, 'تعديل جدول محاضرات مقرر', c.name.slice(0, 80), ip);
  });
  return { slots: getSlots(db, c.id) };
}

// مقررات الطالب الحالية = مقررات برنامجه في سنته الدراسية غير المنجَزة (لم ينجح فيها بعلامة معتمدة).
function currentCourses(db, studentId) {
  const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(Number(studentId));
  if (!p) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  const courses = db.prepare(`SELECT c.id, c.name, c.semester FROM courses c WHERE c.program_id = ? AND c.level = ? AND c.active = 1
    AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.student_id = ? AND g.course_id = c.id AND g.workflow_status = 'approved' AND g.mark >= ?)`).all(p.program_id, p.study_level, Number(studentId), passMarkFor(db, studentId));
  return { p, courses };
}
// مواعيد مقررات الطالب: موعد الفئة يخص أعضاءها، وما لا فئة له يخص الجميع
function studentSlots(db, studentId, courses) {
  return db.prepare(`SELECT s.course_id, s.day, s.start_min, s.end_min, s.hall, s.group_id, g.name AS group_name FROM course_schedules s LEFT JOIN student_groups g ON g.id = s.group_id
    WHERE s.course_id IN (${courses.map(() => '?').join(',') || 'NULL'}) AND (s.group_id IS NULL OR EXISTS (SELECT 1 FROM student_group_members m WHERE m.group_id = s.group_id AND m.student_id = ?))`).all(...courses.map((c) => c.id), Number(studentId));
}
export function studentTimetable(db, studentId) {
  const { courses } = currentCourses(db, studentId), byId = new Map(courses.map((c) => [c.id, c]));
  return studentSlots(db, studentId, courses)
    .sort((a, b) => a.day - b.day || a.start_min - b.start_min)
    .map((s) => ({ course: byId.get(s.course_id).name, semester: byId.get(s.course_id).semester, day: s.day, dayLabel: DAYS[s.day], start: hm(s.start_min), end: hm(s.end_min), hall: s.hall ?? '', groupName: s.group_name ?? '' }));
}

// التعارض يُفحص داخل الفصل نفسه.
export function detectScheduleConflicts(db, studentId) {
  const { p, courses } = currentCourses(db, studentId);
  const slots = studentSlots(db, studentId, courses);
  const conflicts = [], withSlots = new Set(slots.map((s) => s.course_id));
  for (const sem of [1, 2]) {
    const cs = courses.filter((c) => c.semester === sem), list = slots.filter((s) => cs.some((c) => c.id === s.course_id));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.course_id === b.course_id || a.day !== b.day) continue;
      const lo = Math.max(a.start_min, b.start_min), hi = Math.min(a.end_min, b.end_min);
      if (hi <= lo) continue;
      const nm = (id) => (cs.find((c) => c.id === id) || {}).name ?? '';
      conflicts.push({ semester: sem, day: a.day, dayLabel: DAYS[a.day], overlapMinutes: hi - lo,
        a: { courseId: a.course_id, course: nm(a.course_id), start: hm(a.start_min), end: hm(a.end_min), hall: a.hall ?? '' },
        b: { courseId: b.course_id, course: nm(b.course_id), start: hm(b.start_min), end: hm(b.end_min), hall: b.hall ?? '' } });
    }
  }
  return { studentId: Number(studentId), level: p.study_level, checkedCourses: courses.length, withoutSchedule: courses.filter((c) => !withSlots.has(c.id)).length, conflicts };
}
