// أنظمة الدراسة: التخرج، والترفيع السنوي، وتجديد القيد، واستنفاد سنوات الدراسة، والتظلم من القرارات الانضباطية.
// كل عتبة تُقرأ من الإعدادات العامة (تبويب «أنظمة الدراسة والتخرج»)، ولا رقم ثابت هنا.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { academicYear, docNo } from '../lib/doc_no.js';
import { getSetting } from './settings.js';
import { withLock } from './numbering.js';
import { passSql } from './academics.js';
import { financialDue } from './student_affairs_suite.js';

const n = (db, k) => Number(getSetting(db, k));
const today = () => new Date().toISOString().slice(0, 10);
const allowed = (actor, perms) => !!actor && (actor.role === 'admin' || perms.some((p) => actor.can?.(p)));
const need = (actor, perms) => { if (!allowed(actor, perms)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
const actorName = (a) => a?.display_name || a?.name || a?.label || 'شؤون الطلاب';
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const startYear = (y = academicYear()) => Number(String(y).slice(0, 4));
const addDays = (day, d) => new Date(Date.parse(`${day}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
const notify = (db, userId, kind, ref, text) => db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING").run(userId, kind, ref, text, Date.now());

// المقررات المعتمدة التي نجح فيها الطالب، لطالب واحد أو للجميع
function passedByStudent(db, studentId = null) {
  const rows = db.prepare(`SELECT student_id, course_id FROM grades WHERE workflow_status = 'approved' AND mark >= ${passSql(db, 'grades.student_id')} AND course_id IS NOT NULL${studentId ? ' AND student_id = ?' : ''}`).all(...(studentId ? [studentId] : []));
  const out = new Map();
  for (const r of rows) { const k = Number(r.student_id); if (!out.has(k)) out.set(k, new Set()); out.get(k).add(Number(r.course_id)); }
  return out;
}
const planCourses = (db, programId = null) => db.prepare(`SELECT id, program_id, level, hours FROM courses WHERE active = 1${programId ? ' AND program_id = ?' : ''}`).all(...(programId ? [programId] : []));

/* ---------- التخرج: ما يمنع تقديم الطالب للتخرج ---------- */
export function graduationBlockers(db, studentId) {
  const prof = db.prepare('SELECT program_id FROM student_profiles WHERE user_id = ?').get(studentId);
  if (!prof) return ['ملف الطالب غير موجود.'];
  // شرط ثابت لا يعطله إعداد: لا تخرج قبل النجاح في جميع مقررات الخطة
  const plan = planCourses(db, prof.program_id);
  if (!plan.length) return ['لا توجد خطة مقررات مسجلة لبرنامج الطالب.'];
  const passed = passedByStudent(db, studentId).get(Number(studentId)) ?? new Set();
  const left = plan.filter((c) => !passed.has(Number(c.id))).length;
  return left ? [`لم ينجح بعد في ${left} مقرراً من خطة برنامجه.`] : [];
}

/* ---------- الترفيع السنوي ---------- */
export function promotionPreview({ db }, actor) {
  need(actor, ['student:update']);
  const year = academicYear(), max = n(db, 'reg.promotion_max_carried');
  const students = db.prepare(`SELECT p.user_id AS id, p.program_id, p.study_level AS level, u.display_name AS name, u.student_no AS "studentNo", g.years
    FROM student_profiles p JOIN users u ON u.id = p.user_id JOIN programs g ON g.id = p.program_id WHERE p.status = 'active'`).all();
  const done = new Set(db.prepare('SELECT student_id FROM sa_promotions WHERE academic_year = ?').all(year).map((r) => Number(r.student_id)));
  const courses = planCourses(db), passed = passedByStudent(db), rows = [];
  for (const s of students) {
    if (Number(s.level) >= Number(s.years) || done.has(Number(s.id))) continue;
    const required = courses.filter((c) => Number(c.program_id) === Number(s.program_id) && Number(c.level) <= Number(s.level));
    if (!required.length) continue;
    const ok = passed.get(Number(s.id)) ?? new Set(), carried = required.filter((c) => !ok.has(Number(c.id))).length;
    rows.push({ id: s.id, name: s.name, studentNo: s.studentNo, level: Number(s.level), toLevel: Number(s.level) + 1, carried, eligible: carried <= max });
  }
  return { academicYear: year, maxCarried: max, promotedThisYear: done.size, rows: rows.sort((a, b) => a.carried - b.carried) };
}
export function applyPromotions(deps, actor, body, ip) {
  need(actor, ['student:update']);
  const { db } = deps, year = academicYear();
  return withLock(db, `promotion:${year}`, () => {
    const wanted = Array.isArray(body?.studentIds) ? new Set(body.studentIds.map(Number)) : null;
    const list = promotionPreview(deps, actor).rows.filter((r) => r.eligible && (!wanted || wanted.has(Number(r.id))));
    const ins = db.prepare('INSERT INTO sa_promotions (student_id, academic_year, from_level, to_level, carried, decided_by, decided_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'), now = Date.now();
    for (const r of list) {
      ins.run(r.id, year, r.level, r.toLevel, r.carried, actorName(actor), actor.id ?? null, now);
      db.prepare('UPDATE student_profiles SET study_level = ?, updated_at = ? WHERE user_id = ?').run(r.toLevel, now, r.id);
      notify(db, r.id, 'promotion', startYear(year), `تم ترفيعك إلى السنة ${r.toLevel} للعام الدراسي ${year}${r.carried ? ` مع حمل ${r.carried} مقرراً` : ''}.`);
    }
    audit(db, actor, 'ترفيع سنوي للطلاب', `${year}: ${list.length} طالباً`, ip);
    return { academicYear: year, promoted: list.length };
  });
}

/* ---------- تجديد القيد السنوي ---------- */
function renewalState(db, studentId) {
  const year = academicYear(), open = String(getSetting(db, 'reg.renewal_open') || ''), close = String(getSetting(db, 'reg.renewal_close') || ''), lateDays = n(db, 'reg.renewal_late_days'), d = today();
  const lastDay = isDay(close) ? addDays(close, lateDays) : null;
  const windowState = isDay(open) && d < open ? 'not_open' : (lastDay && d > lastDay ? 'closed' : 'open');
  const late = windowState === 'open' && isDay(close) && d > close;
  const done = db.prepare('SELECT created_at, late FROM sa_enrollment_renewals WHERE student_id = ? AND academic_year = ?').get(studentId, year);
  const prof = db.prepare('SELECT status, study_level FROM student_profiles WHERE user_id = ?').get(studentId);
  const blockers = [];
  if (!prof) blockers.push('ملف الطالب غير موجود.');
  else if (prof.status !== 'active') blockers.push('حالة القيد لا تسمح بالتجديد.');
  if (windowState === 'not_open') blockers.push(`يبدأ تجديد القيد في ${open}.`);
  if (windowState === 'closed') blockers.push(`انتهت مهلة تجديد القيد في ${lastDay}.`);
  if (getSetting(db, 'reg.renewal_block_dues')) { const due = financialDue(db, studentId); if (due > 0) blockers.push(`عليك مستحقات قدرها ${due.toLocaleString('en-US')} ل.س.`); }
  if (getSetting(db, 'reg.renewal_block_holds') && db.prepare('SELECT 1 AS x FROM student_holds WHERE student_id = ? AND cleared_at IS NULL AND (active IS NULL OR active = 1) LIMIT 1').get(studentId)) blockers.push('توجد عقوبة أو ذمة قائمة.');
  return { academicYear: year, open: open || null, close: close || null, late, renewedAt: done ? Number(done.created_at) : null, blockers, level: prof?.study_level };
}
export function renewEnrollment(deps, actor, body, ip) {
  const { db } = deps;
  if (!actor) throw new HttpError(401, 'يلزم تسجيل الدخول.', 'unauthenticated');
  let studentId = actor.id;
  if (actor.role !== 'student') { need(actor, ['student:update']); studentId = Number(body?.studentId); if (!studentId) throw new HttpError(400, 'يرجى تحديد الطالب.', 'validation'); }
  return withLock(db, `renewal:${studentId}`, () => {
    const s = renewalState(db, studentId);
    if (s.renewedAt) throw new HttpError(409, 'تم تجديد القيد لهذا العام مسبقاً.', 'conflict');
    if (s.blockers.length) throw new HttpError(409, `تعذر تجديد القيد: ${s.blockers.join(' ')}`, 'renewal_blocked');
    db.prepare('INSERT INTO sa_enrollment_renewals (student_id, academic_year, level, late, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(studentId, s.academicYear, s.level, s.late ? 1 : 0, actor.id ?? null, Date.now());
    audit(db, actor, 'تجديد قيد طالب', `طالب #${studentId} — ${s.academicYear}${s.late ? ' (متأخر)' : ''}`, ip);
    return { academicYear: s.academicYear, late: s.late };
  });
}
export function renewalReport({ db }, actor) {
  need(actor, ['student:read']);
  const year = academicYear();
  const rows = db.prepare(`SELECT p.user_id AS id, u.display_name AS name, u.student_no AS "studentNo", p.study_level AS level, r.created_at AS "renewedAt", r.late
    FROM student_profiles p JOIN users u ON u.id = p.user_id LEFT JOIN sa_enrollment_renewals r ON r.student_id = p.user_id AND r.academic_year = ?
    WHERE p.status = 'active' ORDER BY r.created_at IS NOT NULL, u.student_no LIMIT 1000`).all(year);
  return { academicYear: year, open: getSetting(db, 'reg.renewal_open') || null, close: getSetting(db, 'reg.renewal_close') || null, renewed: rows.filter((r) => r.renewedAt).length, total: rows.length, rows };
}

/* ---------- استنفاد سنوات الدراسة ---------- */
export function exhaustionList({ db }, actor) {
  need(actor, ['student:read', 'sa_advising:view']);
  const year = academicYear(), current = startYear(year), extra = n(db, 'reg.max_stay_extra_percent'), warn = n(db, 'reg.exhaustion_warn_years'), countPost = !!getSetting(db, 'reg.count_postponement');
  const rows = db.prepare(`SELECT p.user_id AS id, u.display_name AS name, u.student_no AS "studentNo", p.status, p.enroll_year, g.years, g.name AS program,
      COALESCE((SELECT SUM(m.duration_semesters) FROM sa_lifecycle_movements m WHERE m.student_id = p.user_id AND m.movement_type = 'postponement' AND m.status = 'approved'), 0) AS postponed
    FROM student_profiles p JOIN users u ON u.id = p.user_id JOIN programs g ON g.id = p.program_id WHERE p.status IN ('active', 'suspended')`).all();
  const out = [];
  for (const r of rows) {
    const max = Number(r.years) * (1 + extra / 100), used = current - Number(r.enroll_year) + 1 - (countPost ? 0 : Number(r.postponed) / 2), remaining = max - used;
    if (remaining <= warn) out.push({ id: r.id, name: r.name, studentNo: r.studentNo, program: r.program, enrollYear: Number(r.enroll_year), maxYears: max, usedYears: used, remaining, exhausted: remaining <= 0 });
  }
  return { academicYear: year, extraPercent: extra, warnYears: warn, rows: out.sort((a, b) => a.remaining - b.remaining) };
}
export function notifyExhaustion(deps, actor, ip) {
  need(actor, ['student:update', 'sa_advising:edit']);
  const { db } = deps, list = exhaustionList(deps, actor), ref = startYear(list.academicYear);
  for (const r of list.rows) notify(db, r.id, 'study_limit', ref, r.exhausted ? `استنفدت الحد الأقصى لسنوات الدراسة (${r.maxYears} سنوات). راجع شؤون الطلاب.` : `بقي لك ${r.remaining} من الحد الأقصى لسنوات الدراسة (${r.maxYears} سنوات).`);
  audit(db, actor, 'تنبيه الطلاب باستنفاد سنوات الدراسة', `${list.rows.length} طالباً`, ip);
  return { notified: list.rows.length };
}

/* ---------- التظلم من القرارات الانضباطية ---------- */
const APPEAL_SETTING = { warning: 'reg.appeal_warning', exam_zero: 'reg.appeal_exam_zero', term_suspension: 'reg.appeal_term_suspension', dismissal: 'reg.appeal_dismissal' };
const APPEAL_SQL = `SELECT a.*, u.display_name AS "studentName", u.student_no AS "studentNo", d.committee_decision_no AS "decisionNo", d.penalty_level AS "penaltyLevel"
  FROM sa_disciplinary_appeals a JOIN users u ON u.id = a.student_id LEFT JOIN sa_disciplinary_details d ON d.hold_id = a.hold_id`;
function appealDeadline(db, detail) { return Number(detail.created_at) + n(db, 'reg.appeal_days') * 86400000; }
function myDecisions(db, studentId) {
  return db.prepare(`SELECT d.hold_id, d.committee_decision_no AS "decisionNo", d.penalty_level AS "penaltyLevel", d.created_at, a.status AS "appealStatus"
    FROM sa_disciplinary_details d LEFT JOIN sa_disciplinary_appeals a ON a.hold_id = d.hold_id WHERE d.student_id = ? ORDER BY d.id DESC`).all(studentId)
    .map((d) => ({ holdId: d.hold_id, decisionNo: d.decisionNo, penaltyLevel: d.penaltyLevel, appealStatus: d.appealStatus ?? null, deadline: appealDeadline(db, d), canAppeal: !d.appealStatus && !!getSetting(db, APPEAL_SETTING[d.penaltyLevel] ?? 'reg.appeal_warning') && Date.now() <= appealDeadline(db, d) }));
}
export function submitAppeal(deps, actor, body, ip) {
  const { db } = deps;
  if (actor?.role !== 'student') throw new HttpError(403, 'التظلم يقدمه الطالب صاحب القرار.', 'forbidden');
  const holdId = Number(body?.holdId), reason = String(body?.reason ?? '').trim().slice(0, 1000);
  if (reason.length < 5) throw new HttpError(400, 'اكتب أسباب التظلم (5 أحرف على الأقل).', 'validation');
  return withLock(db, `appeal:${holdId}`, () => {
    const d = db.prepare('SELECT * FROM sa_disciplinary_details WHERE hold_id = ? AND student_id = ?').get(holdId, actor.id);
    if (!d) throw new HttpError(404, 'القرار غير موجود.', 'not_found');
    if (!getSetting(db, APPEAL_SETTING[d.penalty_level] ?? 'reg.appeal_warning')) throw new HttpError(409, 'هذا القرار نهائي ولا يقبل التظلم.', 'conflict');
    if (Date.now() > appealDeadline(db, d)) throw new HttpError(409, `انتهت مهلة التظلم (${n(db, 'reg.appeal_days')} يوماً من تاريخ القرار).`, 'conflict');
    if (db.prepare('SELECT 1 AS x FROM sa_disciplinary_appeals WHERE hold_id = ?').get(holdId)) throw new HttpError(409, 'قُدّم تظلم على هذا القرار مسبقاً.', 'conflict');
    const no = docNo(`APL-${new Date().getFullYear()}`);
    const id = Number(db.prepare("INSERT INTO sa_disciplinary_appeals (appeal_no, hold_id, student_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id").get(no, holdId, actor.id, reason, Date.now()).id);
    audit(db, actor, 'تقديم تظلم من قرار انضباطي', `${no} — ${d.committee_decision_no}`, ip);
    return { id, appealNo: no };
  });
}
export function decideAppeal(deps, actor, id, body, ip) {
  need(actor, ['sa_lifecycle:final']);
  const { db } = deps, outcome = String(body?.outcome ?? ''), note = String(body?.note ?? '').trim().slice(0, 500);
  if (!['upheld', 'reduced', 'cancelled'].includes(outcome)) throw new HttpError(400, 'نتيجة التظلم غير معروفة.', 'validation');
  if (note.length < 3) throw new HttpError(400, 'اكتب مسوغات القرار (3 أحرف على الأقل).', 'validation');
  return withLock(db, `appeal-decide:${Number(id)}`, () => {
    const a = db.prepare('SELECT * FROM sa_disciplinary_appeals WHERE id = ?').get(Number(id));
    if (!a) throw new HttpError(404, 'التظلم غير موجود.', 'not_found');
    if (a.status !== 'pending') throw new HttpError(409, 'تم البت في هذا التظلم مسبقاً.', 'conflict');
    const d = db.prepare('SELECT * FROM sa_disciplinary_details WHERE hold_id = ?').get(a.hold_id), now = Date.now();
    db.prepare('UPDATE sa_disciplinary_appeals SET status = ?, decision_note = ?, decided_by = ?, decided_by_id = ?, decided_at = ? WHERE id = ?').run(outcome, note, actorName(actor), actor.id ?? null, now, a.id);
    let reinstatementNeeded = false;
    if (outcome !== 'upheld') {
      // الحركة المعلقة بهذا القرار تسقط، والمنفذة تحتاج حركة إعادة قيد عبر السلسلة
      db.prepare("UPDATE sa_lifecycle_movements SET status = 'rejected', current_step = NULL, decided_at = ?, reject_reason = ? WHERE student_id = ? AND decision_no = ? AND status = 'pending'").run(now, `قبول التظلم ${a.appeal_no}`, a.student_id, d.committee_decision_no);
      reinstatementNeeded = !!db.prepare("SELECT 1 AS x FROM sa_lifecycle_movements WHERE student_id = ? AND decision_no = ? AND status = 'approved'").get(a.student_id, d.committee_decision_no);
      if (outcome === 'reduced') db.prepare("UPDATE sa_disciplinary_details SET penalty_level = 'warning' WHERE hold_id = ?").run(a.hold_id);
      if (outcome === 'cancelled') db.prepare('UPDATE student_holds SET active = 0, cleared_at = ? WHERE id = ? AND cleared_at IS NULL').run(now, a.hold_id);
    }
    notify(db, a.student_id, 'appeal', a.id, `صدر قرار تظلمك ${a.appeal_no}: ${{ upheld: 'تثبيت العقوبة', reduced: 'تخفيف العقوبة', cancelled: 'إلغاء العقوبة' }[outcome]}.`);
    audit(db, actor, `البت في تظلم انضباطي (${outcome})`, a.appeal_no, ip);
    return { status: outcome, reinstatementNeeded };
  });
}
// تظلم قائم يوقف تنفيذ القرار إذا فعّلت ذلك الإعدادات
export function appealBlocksMovement(db, movement) {
  if (!getSetting(db, 'reg.appeal_suspends') || !movement.decision_no) return false;
  return !!db.prepare("SELECT 1 AS x FROM sa_disciplinary_appeals a JOIN sa_disciplinary_details d ON d.hold_id = a.hold_id WHERE a.status = 'pending' AND a.student_id = ? AND d.committee_decision_no = ?").get(movement.student_id, movement.decision_no);
}

/* ---------- المسارات ---------- */
export function registerStudentRegulationRoutes(r, deps) {
  const { db } = deps, B = '/api/student-regulations';
  r.add('GET', `${B}/me`, (c) => {
    if (c.user?.role !== 'student') throw new HttpError(403, 'هذه الخدمة للطلاب.', 'forbidden');
    c.json(200, { renewal: renewalState(db, c.user.id), decisions: myDecisions(db, c.user.id), appealDays: n(db, 'reg.appeal_days') });
  });
  r.add('GET', `${B}/promotion`, (c) => c.json(200, promotionPreview(deps, c.user)));
  r.add('POST', `${B}/promotion/apply`, (c) => c.json(200, applyPromotions(deps, c.user, c.body, c.ip)));
  r.add('GET', `${B}/renewals`, (c) => c.json(200, renewalReport(deps, c.user)));
  r.add('POST', `${B}/renew`, (c) => c.json(201, renewEnrollment(deps, c.user, c.body, c.ip)));
  r.add('GET', `${B}/exhaustion`, (c) => c.json(200, exhaustionList(deps, c.user)));
  r.add('POST', `${B}/exhaustion/notify`, (c) => c.json(200, notifyExhaustion(deps, c.user, c.ip)));
  r.add('GET', `${B}/appeals`, (c) => {
    need(c.user, ['sa_discipline:view', 'sa_lifecycle:final']);
    c.json(200, { appeals: db.prepare(`${APPEAL_SQL} ORDER BY a.id DESC LIMIT 300`).all(), canDecide: allowed(c.user, ['sa_lifecycle:final']) });
  });
  r.add('POST', `${B}/appeals`, (c) => c.json(201, submitAppeal(deps, c.user, c.body, c.ip)));
  r.add('POST', `${B}/appeals/:id/decide`, (c) => c.json(200, decideAppeal(deps, c.user, c.params.id, c.body, c.ip)));
}
