// التقويم الأكاديمي، وإلغاء المحاضرة وتعويضها مع إشعار طلاب المقرر، والحرمان من المقرر بنسبة الغياب.
// الغياب يُحسب من سجل القاعات: أيام انعقاد المقرر داخل فترة الفصل في التقويم، مقابل أيام حضور الطالب.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getSetting } from './settings.js';
import { currentTerm } from './sections.js';
import { academicYear } from '../lib/doc_no.js';

export const CALENDAR_KINDS = { term: 'بداية الفصل ونهايته', registration: 'التسجيل', add_drop: 'الحذف والإضافة', exams: 'الامتحانات', holiday: 'عطلة', event: 'حدث أكاديمي' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const today = () => new Date().toISOString().slice(0, 10);
const DAMASCUS_DAY = "to_char(to_timestamp(l.entered_at / 1000.0) AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD')";
const notify = (db, ids, kind, ref, text) => {
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"), now = Date.now();
  let n = 0;
  for (const id of new Set(ids)) n += ins.run(id, kind, ref, text, now).changes;
  return n;
};

const loadCourse = (db, id) => {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(id));
  if (!c) throw bad('المقرر غير موجود.', 404, 'not_found');
  return c;
};
const teaches = (db, actor, courseId) => !!db.prepare('SELECT 1 FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE c.id = ? AND m.user_id = ?').get(Number(courseId), Number(actor.id));
const needCourse = (db, actor, courseId, ...perms) => {
  if (teaches(db, actor, courseId) || perms.some((p) => actor.can?.(p))) return;
  throw bad('هذا الإجراء لمدرّس المقرر أو لمن يملك صلاحية إدارة المقررات.', 403, 'forbidden');
};

// طلاب المقرر في الفصل الجاري: المسجلون فيه، وإلا طلاب برنامجه وسنته الفعّالون
export function courseStudents(db, course) {
  const enrolled = db.prepare(`SELECT DISTINCT u.id FROM student_self_enrollments e JOIN users u ON u.student_no = e.student_no
    WHERE (e.course_id = ? OR e.course_code = ?) AND e.semester = ? AND e.dropped_at IS NULL`).all(course.id, course.code ?? '', currentTerm(db)).map((x) => Number(x.id));
  if (enrolled.length) return enrolled;
  return db.prepare("SELECT p.user_id AS id FROM student_profiles p WHERE p.program_id = ? AND p.study_level = ? AND p.status = 'active'").all(course.program_id, course.level).map((x) => Number(x.id));
}

/* ===== التقويم ===== */
export function termWindow(db) {
  const t = db.prepare("SELECT start_day, end_day FROM academic_calendar WHERE term = ? AND kind = 'term' AND active = 1 ORDER BY id DESC LIMIT 1").get(currentTerm(db));
  if (t) return { from: t.start_day, to: t.end_day, fromCalendar: true };
  return { from: new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10), to: today(), fromCalendar: false };
}

export function listCalendar({ db }) {
  const year = academicYear();
  return {
    currentTerm: currentTerm(db), kinds: CALENDAR_KINDS,
    events: db.prepare('SELECT * FROM academic_calendar WHERE active = 1 AND term LIKE ? ORDER BY start_day, id').all(`%${year}`).map((e) => ({
      id: Number(e.id), term: e.term, kind: e.kind, kindLabel: CALENDAR_KINDS[e.kind], title: e.title, startDay: e.start_day, endDay: e.end_day, past: e.end_day < today(),
    })),
  };
}

export function addCalendarEvent({ db }, actor, b, ip) {
  const kind = String(b?.kind ?? '');
  if (!CALENDAR_KINDS[kind]) throw bad('نوع الحدث غير صالح.');
  const start = String(b?.startDay ?? ''), end = String(b?.endDay || b?.startDay || '');
  if (!DAY_RE.test(start) || !DAY_RE.test(end) || end < start) throw bad('التاريخان بصيغة 2026-09-01، والنهاية لا تسبق البداية.');
  const title = clean(b?.title, 120) || CALENDAR_KINDS[kind];
  const term = clean(b?.term, 60) || currentTerm(db);
  if (kind === 'term' && db.prepare("SELECT 1 FROM academic_calendar WHERE term = ? AND kind = 'term' AND active = 1").get(term)) throw bad('حُددت بداية هذا الفصل ونهايته مسبقاً؛ ألغِ الحدث السابق أولاً.', 409, 'conflict');
  const id = Number(db.prepare('INSERT INTO academic_calendar (term, kind, title, start_day, end_day, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id').get(term, kind, title, start, end, actor.id ?? null, Date.now()).id);
  audit(db, actor, 'إضافة حدث إلى التقويم الأكاديمي', `${term}: ${title} (${start} - ${end})`, ip);
  return { id };
}

export function cancelCalendarEvent({ db }, actor, id, ip) {
  const e = db.prepare('SELECT * FROM academic_calendar WHERE id = ? AND active = 1').get(Number(id));
  if (!e) throw bad('الحدث غير موجود.', 404, 'not_found');
  db.prepare('UPDATE academic_calendar SET active = 0 WHERE id = ?').run(e.id);
  audit(db, actor, 'إلغاء حدث من التقويم الأكاديمي', `${e.term}: ${e.title}`, ip);
  return { ok: true };
}

/* ===== إلغاء المحاضرة وتعويضها ===== */
const changeView = (db, r) => ({
  id: Number(r.id), courseId: Number(r.course_id), course: r.course_name, courseCode: r.course_code, kind: r.kind, lectureDay: r.lecture_day, start: r.start_time, end: r.end_time, hall: r.hall,
  makeupDay: r.makeup_day, makeupStart: r.makeup_start, makeupEnd: r.makeup_end, makeupHall: r.makeup_hall, reason: r.reason, notified: Number(r.notified), at: Number(r.created_at),
});
const CHANGE_SELECT = 'SELECT x.*, c.name AS course_name, c.code AS course_code FROM lecture_changes x JOIN courses c ON c.id = x.course_id';

export function listLectureChanges({ db }, actor) {
  if (actor.role === 'student') {
    const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(actor.id);
    const own = db.prepare('SELECT e.course_id, e.course_code FROM student_self_enrollments e WHERE e.student_no = ? AND e.semester = ? AND e.dropped_at IS NULL').all(actor.student_no ?? '', currentTerm(db));
    const ids = new Set(own.map((x) => Number(x.course_id)).filter(Boolean));
    const rows = db.prepare(`${CHANGE_SELECT} WHERE x.lecture_day >= ? ORDER BY x.lecture_day`).all(new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
    return { changes: rows.filter((r) => ids.size ? ids.has(Number(r.course_id)) || own.some((o) => o.course_code === r.course_code) : p && db.prepare('SELECT 1 FROM courses WHERE id = ? AND program_id = ? AND level = ?').get(r.course_id, p.program_id, p.study_level)).map((r) => changeView(db, r)) };
  }
  const all = actor.can?.('course:manage') || actor.can?.('academic:read');
  const rows = all ? db.prepare(`${CHANGE_SELECT} ORDER BY x.lecture_day DESC LIMIT 300`).all()
    : db.prepare(`${CHANGE_SELECT} JOIN faculty_members m ON m.id = c.member_id WHERE m.user_id = ? ORDER BY x.lecture_day DESC LIMIT 300`).all(actor.id);
  const courses = all ? db.prepare('SELECT id, code, name FROM courses WHERE active = 1 ORDER BY name').all()
    : db.prepare('SELECT c.id, c.code, c.name FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE m.user_id = ? AND c.active = 1 ORDER BY c.name').all(actor.id);
  return { changes: rows.map((r) => changeView(db, r)), courses: courses.map((c) => ({ id: Number(c.id), code: c.code, name: c.name })) };
}

export function addLectureChange({ db }, actor, b, ip) {
  const course = loadCourse(db, b?.courseId);
  needCourse(db, actor, course.id, 'course:manage');
  const kind = String(b?.kind ?? '');
  if (!['cancel', 'makeup'].includes(kind)) throw bad('نوع التغيير: إلغاء أو تعويض.');
  const day = String(b?.lectureDay ?? '');
  if (!DAY_RE.test(day)) throw bad('تاريخ المحاضرة بصيغة 2026-10-15.');
  const time = (v, label, req = false) => { const t = String(v ?? ''); if (!t) { if (req) throw bad(`${label} مطلوب.`); return ''; } if (!TIME_RE.test(t)) throw bad(`${label} بصيغة 10:30.`); return t; };
  const start = time(b?.start, 'وقت البداية'), end = time(b?.end, 'وقت النهاية');
  let makeupDay = null, mStart = '', mEnd = '';
  if (kind === 'makeup' || b?.makeupDay) {
    makeupDay = String(b?.makeupDay ?? '');
    if (!DAY_RE.test(makeupDay)) throw bad('تاريخ محاضرة التعويض بصيغة 2026-10-20.');
    mStart = time(b?.makeupStart, 'بداية التعويض', true); mEnd = time(b?.makeupEnd, 'نهاية التعويض', true);
    if (mEnd <= mStart) throw bad('نهاية التعويض بعد بدايته.');
  }
  const reason = clean(b?.reason, 300);
  if (reason.length < 3) throw bad('سبب التغيير مطلوب.');
  const id = Number(db.prepare(`INSERT INTO lecture_changes (course_id, kind, lecture_day, start_time, end_time, hall, makeup_day, makeup_start, makeup_end, makeup_hall, reason, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(course.id, makeupDay && kind === 'cancel' ? 'cancel' : kind, day, start, end, clean(b?.hall, 60), makeupDay, mStart, mEnd, clean(b?.makeupHall, 60), reason, actor.id ?? null, Date.now()).id);
  const text = kind === 'cancel'
    ? `أُلغيت محاضرة ${course.name} يوم ${day}${start ? ` (${start})` : ''}: ${reason}.${makeupDay ? ` التعويض يوم ${makeupDay} من ${mStart} إلى ${mEnd}${b?.makeupHall ? ` في ${clean(b.makeupHall, 60)}` : ''}.` : ''}`
    : `محاضرة تعويضية في ${course.name} يوم ${makeupDay} من ${mStart} إلى ${mEnd}${b?.makeupHall ? ` في ${clean(b.makeupHall, 60)}` : ''}: ${reason}.`;
  const sent = notify(db, courseStudents(db, course), 'lecture_change', id, text);
  db.prepare('UPDATE lecture_changes SET notified = ? WHERE id = ?').run(sent, id);
  audit(db, actor, kind === 'cancel' ? 'إلغاء محاضرة' : 'محاضرة تعويضية', `${course.code ?? course.name} ${day}: ${reason}`.slice(0, 300), ip);
  return { id, notified: sent };
}

/* ===== الغياب والحرمان ===== */
export function absenceReport({ db }, actor, courseId) {
  const course = loadCourse(db, courseId);
  needCourse(db, actor, course.id, 'course:manage', 'attendance:manage');
  const w = termWindow(db), term = currentTerm(db), max = Number(getSetting(db, 'academic.max_absence_percent')), minSessions = Number(getSetting(db, 'academic.min_sessions_for_absence'));
  const days = db.prepare(`SELECT DISTINCT ${DAMASCUS_DAY} AS d FROM hall_logs l WHERE l.course_id = ? AND l.kind = 'course'`).all(course.id).map((x) => x.d).filter((d) => d >= w.from && d <= w.to);
  const held = days.length, daySet = new Set(days);
  const presence = new Map();
  for (const r of db.prepare(`SELECT l.student_id, ${DAMASCUS_DAY} AS d FROM hall_logs l WHERE l.course_id = ? AND l.kind = 'course'`).all(course.id)) {
    if (!daySet.has(r.d)) continue;
    const id = Number(r.student_id); if (!presence.has(id)) presence.set(id, new Set()); presence.get(id).add(r.d);
  }
  const ids = [...new Set([...courseStudents(db, course), ...presence.keys()])];
  const deprived = new Map(db.prepare("SELECT * FROM course_deprivations WHERE course_id = ? AND term = ? AND status = 'active'").all(course.id, term).map((x) => [Number(x.student_id), Number(x.id)]));
  const rows = ids.map((id) => {
    const u = db.prepare('SELECT display_name, student_no FROM users WHERE id = ?').get(id) ?? {};
    const present = presence.get(id)?.size ?? 0, absent = Math.max(0, held - present), pct = held ? Math.round((absent / held) * 1000) / 10 : 0;
    return { studentId: id, name: u.display_name, studentNo: u.student_no, present, absent, percent: pct, overLimit: held >= minSessions && pct > max, warn: held >= minSessions && pct >= max / 2 && pct <= max, deprivationId: deprived.get(id) ?? null };
  }).sort((a, b) => b.percent - a.percent);
  return { course: { id: Number(course.id), name: course.name, code: course.code }, term, window: w, held, maxPercent: max, minSessions, rows };
}

export function warnAbsence(deps, actor, courseId) {
  const rep = absenceReport(deps, actor, courseId);
  const ids = rep.rows.filter((r) => r.warn && !r.deprivationId).map((r) => r.studentId);
  // إنذار واحد لكل طالب في المقرر خلال الفصل
  const sent = notify(deps.db, ids, `absence_warning:${rep.term}`, rep.course.id, `تنبيه: بلغ غيابك في ${rep.course.name} نصف الحد المسموح (${rep.maxPercent}%). تجاوز الحد يحرمك من المقرر.`);
  return { warned: sent };
}

export function depriveStudents({ db }, actor, courseId, b, ip) {
  const rep = absenceReport({ db }, actor, courseId), wanted = new Set((Array.isArray(b?.studentIds) ? b.studentIds : []).map(Number));
  const targets = rep.rows.filter((r) => wanted.has(r.studentId));
  if (!targets.length) throw bad('اختر طلاباً من القائمة.');
  const under = targets.filter((r) => !r.overLimit);
  if (under.length) throw bad(`لم يتجاوز غياب ${under.map((r) => r.name).join('، ')} الحد (${rep.maxPercent}%).`, 409, 'under_limit');
  let n = 0;
  for (const r of targets) {
    const res = db.prepare('INSERT INTO course_deprivations (student_id, course_id, term, absence_percent, decided_by, decided_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(r.studentId, rep.course.id, rep.term, r.percent, actor.id ?? null, Date.now());
    if (!res.changes) continue;
    n++;
    notify(db, [r.studentId], 'course_deprivation', rep.course.id, `حُرمت من مقرر ${rep.course.name} في ${rep.term} لتجاوز غيابك ${r.percent}% (الحد ${rep.maxPercent}%). يحق لك التظلم وفق الأنظمة.`);
  }
  audit(db, actor, 'حرمان طلاب من مقرر بسبب الغياب', `${rep.course.code ?? rep.course.name}: ${n} طالب`, ip);
  return { deprived: n };
}

// معالج الحرمان الشامل: كل من تجاوز الحد في أي مقرر يملك المستخدم إدارته، دفعة واحدة بدل مراجعة كل مقرر على حدة
function manageableCourses(db, actor) {
  const all = actor.can?.('course:manage') || actor.can?.('academic:read');
  return all ? db.prepare('SELECT id FROM courses WHERE active = 1 ORDER BY name').all()
    : db.prepare('SELECT c.id FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE m.user_id = ? AND c.active = 1 ORDER BY c.name').all(actor.id);
}
export function absenceOverview(deps, actor) {
  const byStudent = new Map();
  let term = currentTerm(deps.db), maxPercent = Number(getSetting(deps.db, 'academic.max_absence_percent')), warnCount = 0, courses = 0;
  for (const { id } of manageableCourses(deps.db, actor)) {
    let rep;
    try { rep = absenceReport(deps, actor, id); } catch { continue; }
    courses++; term = rep.term; maxPercent = rep.maxPercent;
    for (const r of rep.rows) {
      if (r.warn && !r.deprivationId) warnCount++;
      if (!r.overLimit || r.deprivationId) continue;
      if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, { studentId: r.studentId, name: r.name, studentNo: r.studentNo, courses: [] });
      byStudent.get(r.studentId).courses.push({ courseId: rep.course.id, name: rep.course.name, percent: r.percent });
    }
  }
  const students = [...byStudent.values()].sort((a, b) => b.courses.length - a.courses.length || b.courses[0].percent - a.courses[0].percent);
  return { term, maxPercent, courses, warnCount, students, deprivationCount: students.reduce((n, s) => n + s.courses.length, 0) };
}
export function warnAbsenceAll(deps, actor) {
  let warned = 0;
  for (const { id } of manageableCourses(deps.db, actor)) { try { warned += warnAbsence(deps, actor, id).warned; } catch { /* خارج صلاحية هذا المقرر */ } }
  return { warned };
}
export function depriveAll(deps, actor, b, ip) {
  const wanted = Array.isArray(b?.studentIds) ? new Set(b.studentIds.map(Number)) : null;
  const ov = absenceOverview(deps, actor), perCourse = new Map();
  for (const s of ov.students) {
    if (wanted && !wanted.has(s.studentId)) continue;
    for (const c of s.courses) { if (!perCourse.has(c.courseId)) perCourse.set(c.courseId, []); perCourse.get(c.courseId).push(s.studentId); }
  }
  if (!perCourse.size) throw bad('لا طلاب لحرمانهم.');
  let deprived = 0;
  for (const [courseId, studentIds] of perCourse) deprived += depriveStudents(deps, actor, courseId, { studentIds }, ip).deprived;
  return { deprived, courses: perCourse.size };
}

export function liftDeprivation({ db }, actor, id, b, ip) {
  const d = db.prepare("SELECT * FROM course_deprivations WHERE id = ? AND status = 'active'").get(Number(id));
  if (!d) throw bad('الحرمان غير موجود أو مرفوع.', 404, 'not_found');
  const reason = clean(b?.reason, 300);
  if (reason.length < 3) throw bad('سبب رفع الحرمان مطلوب.');
  db.prepare("UPDATE course_deprivations SET status = 'lifted', lifted_by = ?, lifted_at = ?, lift_reason = ? WHERE id = ?").run(actor.id ?? null, Date.now(), reason, d.id);
  const c = db.prepare('SELECT name FROM courses WHERE id = ?').get(d.course_id);
  notify(db, [d.student_id], 'deprivation_lifted', d.id, `رُفع حرمانك من مقرر ${c?.name ?? ''}: ${reason}.`);
  audit(db, actor, 'رفع حرمان طالب من مقرر', `#${d.id}: ${reason}`, ip);
  return { ok: true };
}

// يُستدعى عند رصد العلامة: المحروم لا تُرصد له علامة في المقرر ضمن العام نفسه
export function assertNotDeprived(db, studentId, courseId, year) {
  if (!courseId) return;
  const d = db.prepare("SELECT term FROM course_deprivations WHERE student_id = ? AND course_id = ? AND status = 'active' AND term LIKE ?").get(Number(studentId), Number(courseId), `%${String(year ?? academicYear())}`);
  if (d) throw bad(`الطالب محروم من هذا المقرر بسبب الغياب (${d.term})؛ لا تُرصد له علامة حتى يُرفع الحرمان.`, 409, 'deprived');
}

export function myTeaching({ db }, actor) {
  const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(actor.id);
  const term = currentTerm(db), max = Number(getSetting(db, 'academic.max_absence_percent'));
  const own = db.prepare('SELECT course_id, course_code FROM student_self_enrollments WHERE student_no = ? AND semester = ? AND dropped_at IS NULL').all(actor.student_no ?? '', term);
  const courses = own.length
    ? own.map((o) => db.prepare('SELECT * FROM courses WHERE id = ? OR code = ? ORDER BY id LIMIT 1').get(o.course_id ?? 0, o.course_code)).filter(Boolean)
    : (p ? db.prepare('SELECT * FROM courses WHERE program_id = ? AND level = ? AND active = 1').all(p.program_id, p.study_level) : []);
  const w = termWindow(db);
  const absence = courses.map((c) => {
    const days = new Set(db.prepare(`SELECT DISTINCT ${DAMASCUS_DAY} AS d FROM hall_logs l WHERE l.course_id = ? AND l.kind = 'course'`).all(c.id).map((x) => x.d).filter((d) => d >= w.from && d <= w.to));
    const mine = new Set(db.prepare(`SELECT DISTINCT ${DAMASCUS_DAY} AS d FROM hall_logs l WHERE l.course_id = ? AND l.kind = 'course' AND l.student_id = ?`).all(c.id, actor.id).map((x) => x.d).filter((d) => days.has(d)));
    const pct = days.size ? Math.round(((days.size - mine.size) / days.size) * 1000) / 10 : 0;
    const dep = db.prepare("SELECT 1 FROM course_deprivations WHERE student_id = ? AND course_id = ? AND term = ? AND status = 'active'").get(actor.id, c.id, term);
    return { course: c.name, held: days.size, present: mine.size, percent: pct, deprived: !!dep };
  });
  return { term, maxPercent: max, calendar: listCalendar({ db }).events.filter((e) => !e.past), changes: listLectureChanges({ db }, actor).changes, absence };
}

export function registerTeachingRoutes(r, deps) {
  const auth = (c) => { if (!c.user) throw bad('سجّل الدخول أولاً.', 401, 'unauthorized'); return c.user; };
  const staff = (c) => { if (auth(c).role === 'student') throw bad('هذه الخدمة للموظفين.', 403, 'forbidden'); return c.user; };
  const perm = (c, p) => { if (!staff(c).can(p)) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/teaching/calendar', (c) => { auth(c); c.json(200, listCalendar(deps)); });
  r.add('POST', '/api/teaching/calendar', (c) => c.json(201, addCalendarEvent(deps, perm(c, 'course:manage'), c.body, c.ip)));
  r.add('POST', '/api/teaching/calendar/:id/cancel', (c) => c.json(200, cancelCalendarEvent(deps, perm(c, 'course:manage'), c.params.id, c.ip)));
  r.add('GET', '/api/teaching/lecture-changes', (c) => c.json(200, listLectureChanges(deps, auth(c))));
  r.add('POST', '/api/teaching/lecture-changes', (c) => c.json(201, addLectureChange(deps, staff(c), c.body, c.ip)));
  r.add('GET', '/api/teaching/absence-overview', (c) => c.json(200, absenceOverview(deps, staff(c))));
  r.add('POST', '/api/teaching/absence-overview/warn', (c) => c.json(200, warnAbsenceAll(deps, staff(c))));
  r.add('POST', '/api/teaching/absence-overview/deprive', (c) => c.json(200, depriveAll(deps, staff(c), c.body, c.ip)));
  r.add('GET', '/api/teaching/absence/:courseId',(c) => c.json(200, absenceReport(deps, staff(c), c.params.courseId)));
  r.add('POST', '/api/teaching/absence/:courseId/warn', (c) => c.json(200, warnAbsence(deps, staff(c), c.params.courseId)));
  r.add('POST', '/api/teaching/absence/:courseId/deprive', (c) => c.json(200, depriveStudents(deps, staff(c), c.params.courseId, c.body, c.ip)));
  r.add('POST', '/api/teaching/deprivations/:id/lift', (c) => c.json(200, liftDeprivation(deps, perm(c, 'course:manage'), c.params.id, c.body, c.ip)));
  r.add('GET', '/api/teaching/me', (c) => { if (auth(c).role !== 'student') throw bad('هذه الخدمة للطلاب.', 403, 'forbidden'); c.json(200, myTeaching(deps, c.user)); });
}
