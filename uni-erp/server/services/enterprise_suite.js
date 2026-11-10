import { docNo, academicYear } from '../lib/doc_no.js';
import { amount, required, text } from '../validate.js';
import { listQuizzes, withoutAnswers, submitQuiz } from './quizzes.js';
import { listAllSlots, DAYS } from './schedule.js';
import { notify } from './push.js';
import { loadIdentity } from './pki.js';
import { createCharge, createPayment } from './finance/fees.js';
import { ready as financeReady } from './finance/core.js';
import { tx } from '../db.js';
import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import { passMarkFor, passSql } from './academics.js';
import { getSetting } from './settings.js';
import { STATUS_LABEL } from './students.js';
import { overdueDues } from './finance/fees.js';
import { creditCap, currentTerm, registrationWindow, assertRegistrationOpen, listSections, activeSectionsOf, createSection, updateSection, dropEnrollment } from './sections.js';
import { activeCardBlock } from './card_blocks.js';

/**
 * دوال منطقية نقية وقابلة للاختبار المباشر (Pure Functions for Unit Testing)
 */
export function calculateSimulatedGpa(currentGpa, completedHours, upcomingCourses = []) {
  const curGpa = Math.max(0, Math.min(100, Number(currentGpa) || 0));
  const curHours = Math.max(0, Number(completedHours) || 0);
  let totalWeighted = curGpa * curHours;
  let totalHours = curHours;

  for (const c of upcomingCourses) {
    const cr = Math.max(0, Number(c.credits) || 0);
    const gr = Math.max(0, Math.min(100, Number(c.expectedScore) || 0));
    if (cr > 0) {
      totalWeighted += gr * cr;
      totalHours += cr;
    }
  }
  const projectedGpa = totalHours > 0 ? Math.round((totalWeighted / totalHours) * 100) / 100 : 0;
  const letter = projectedGpa >= 90 ? 'ممتاز (A+)' : projectedGpa >= 80 ? 'جيد جداً (B+)' : projectedGpa >= 70 ? 'جيد (C+)' : projectedGpa >= 60 ? 'مقبول (D)' : 'إنذار أكاديمي (F)';
  return { projectedGpa, totalHours, letter, delta: Math.round((projectedGpa - curGpa) * 100) / 100 };
}

export function computeFacultyOverloadPay(quorumHours, actualTeachingHours, supervisionHours, hourlyRate) {
  const q = Math.max(0, Number(quorumHours) || 0);
  const actual = Math.max(0, Number(actualTeachingHours) || 0);
  const sup = Math.max(0, Number(supervisionHours) || 0);
  const rate = Math.max(0, Number(hourlyRate) || 0);
  const overloadHours = Math.max(0, actual + sup - q);
  const totalOverloadPay = Math.round(overloadHours * rate);
  return { overloadHours, totalOverloadPay };
}

// خطة الطالب من مقررات برنامجه وعلاماته المعتمدة ومتطلباتها السابقة
function advisingPlanFor(db, userId) {
  const profile = db.prepare('SELECT program_id FROM student_profiles WHERE user_id = ?').get(userId);
  if (!profile) return [];
  const pm = passMarkFor(db, userId);
  const marks = new Map(db.prepare("SELECT course_id, mark FROM grades WHERE student_id = ? AND workflow_status = 'approved' ORDER BY academic_year, id").all(userId).map((g) => [g.course_id, Number(g.mark)]));
  const enrolled = new Set(db.prepare('SELECT e.course_code FROM student_self_enrollments e JOIN users u ON u.student_no = e.student_no WHERE u.id = ? AND e.semester = ? AND e.dropped_at IS NULL').all(userId, currentTerm(db)).map((e) => e.course_code));
  const prereqs = new Map();
  for (const p of db.prepare('SELECT p.course_id, c.code FROM sa_course_prerequisites p JOIN courses c ON c.id = p.prereq_course_id').all()) prereqs.set(p.course_id, [...(prereqs.get(p.course_id) ?? []), p.code]);
  return db.prepare('SELECT id, code, name, hours, level FROM courses WHERE program_id = ? AND active = 1 ORDER BY level, semester, id').all(profile.program_id).map((c) => {
    const mark = marks.get(c.id);
    const status = mark === undefined ? (enrolled.has(c.code) ? 'مسجل حالياً' : 'متبقي') : mark >= pm ? 'منجز' : 'راسب';
    return { code: c.code, name: c.name, credits: c.hours, year: c.level, prereq: prereqs.get(c.id)?.join('، ') ?? '—', status, grade: mark ?? null };
  });
}

// مؤشرات الرئاسة من السجلات الفعلية؛ ما لا مصدر له لا يظهر
function executiveKpisFrom(db) {
  const pct = (part, whole) => (Number(whole) ? Math.round((Number(part) / Number(whole)) * 1000) / 10 : 0);
  const FACULTY = `FROM student_profiles sp JOIN programs p ON p.id = sp.program_id LEFT JOIN faculties fa ON fa.id = p.faculty_id`;
  const NAME = `COALESCE(fa.name, p.faculty, 'غير محدد')`;
  const passExpr = passSql(db, 'g.student_id'), byFaculty = new Map();
  const row = (faculty) => { if (!byFaculty.has(faculty)) byFaculty.set(faculty, { faculty, students: 0, graded: 0, passed: 0, charged: 0, paid: 0, researchPapers: 0 }); return byFaculty.get(faculty); };
  for (const r of db.prepare(`SELECT ${NAME} AS faculty, COUNT(*) AS n ${FACULTY} WHERE sp.status = 'active' GROUP BY ${NAME}`).all()) row(r.faculty).students = Number(r.n);
  for (const r of db.prepare(`SELECT ${NAME} AS faculty, COUNT(*) AS n, SUM(CASE WHEN g.mark >= ${passExpr} THEN 1 ELSE 0 END) AS passed FROM grades g JOIN student_profiles sp ON sp.user_id = g.student_id JOIN programs p ON p.id = sp.program_id LEFT JOIN faculties fa ON fa.id = p.faculty_id WHERE g.workflow_status = 'approved' GROUP BY ${NAME}`).all()) Object.assign(row(r.faculty), { graded: Number(r.n), passed: Number(r.passed) });
  for (const r of db.prepare(`SELECT ${NAME} AS faculty, SUM(c.amount) AS total FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id JOIN student_profiles sp ON sp.user_id = c.student_id JOIN programs p ON p.id = sp.program_id LEFT JOIN faculties fa ON fa.id = p.faculty_id WHERE c.status <> 'void' AND ft.kind = 'fee' GROUP BY ${NAME}`).all()) row(r.faculty).charged = Number(r.total);
  for (const r of db.prepare(`SELECT ${NAME} AS faculty, SUM(pay.amount) AS total FROM fin_payments pay JOIN student_profiles sp ON sp.user_id = pay.student_id JOIN programs p ON p.id = sp.program_id LEFT JOIN faculties fa ON fa.id = p.faculty_id WHERE pay.status <> 'void' GROUP BY ${NAME}`).all()) row(r.faculty).paid = Number(r.total);
  for (const r of db.prepare("SELECT faculty_name AS faculty, COUNT(*) AS n FROM research_projects WHERE status = 'published' GROUP BY faculty_name").all()) row(r.faculty).researchPapers = Number(r.n);
  const rows = [...byFaculty.values()], sum = (k) => rows.reduce((total, f) => total + f[k], 0);
  return {
    overallSuccessRate: pct(sum('passed'), sum('graded')),
    financialCollectionRate: pct(sum('paid'), sum('charged')),
    researchPublicationsCount: sum('researchPapers'),
    facultiesComparison: rows.map((f) => ({ faculty: f.faculty, students: f.students, successRate: pct(f.passed, f.graded), collectionRate: pct(f.paid, f.charged), researchPapers: f.researchPapers })),
  };
}

// ما يغطيه توقيع القسيمة: أي تعديل لاحق في هذه القيم يبطله
const money2 = (v) => Number(v).toFixed(2);
const payslipPayload = (p) => Buffer.from([p.payslip_code, p.employee_code ?? '', p.employee_name, p.month_label, money2(p.basic_salary), money2(p.overload_pay), money2(p.allowances), money2(p.deductions), money2(p.net_salary)].join('|'), 'utf8');

export function buildEnterpriseSuiteOverview(db, scope = {}) {
  const mine = scope.studentNo ? 'WHERE student_no = ?' : '', mineArgs = scope.studentNo ? [scope.studentNo] : [];
  const scheduleSlots = listAllSlots(db);
  const scheduleCourses = db.prepare('SELECT id, code, name, instructor FROM courses WHERE active = 1 ORDER BY name').all();
  const quizzes = listQuizzes(db);
  const quizSubmissions = db.prepare('SELECT * FROM lms_quiz_submissions ORDER BY submitted_at DESC LIMIT 30').all();
  const selfEnrollments = db.prepare(`SELECT * FROM student_self_enrollments ${mine} ORDER BY registered_at DESC LIMIT 1000`).all(...mineArgs);
  const facultyOverloads = scope.studentNo ? [] : db.prepare('SELECT * FROM faculty_overload_records ORDER BY id DESC LIMIT 500').all();
  const signedPayslips = scope.studentNo ? [] : db.prepare('SELECT * FROM hr_signed_payslips ORDER BY issued_at DESC LIMIT 500').all();
  const feeInstallments = db.prepare(`SELECT * FROM student_fee_installments ${mine} ORDER BY id ASC LIMIT 2000`).all(...mineArgs);
  const notifications = db.prepare('SELECT * FROM multi_channel_notifications ORDER BY created_at DESC LIMIT 20').all();
  const encryptedSnapshots = db.prepare('SELECT * FROM encrypted_snapshots ORDER BY created_at DESC LIMIT 20').all();
  const offlineBatches = db.prepare('SELECT * FROM offline_sync_batches ORDER BY synced_at DESC LIMIT 20').all();

  return {
    scheduleSlots,
    scheduleCourses,
    scheduleDays: DAYS,
    quizzes,
    quizSubmissions,
    selfEnrollments,
    facultyOverloads,
    signedPayslips,
    feeInstallments,
    notifications,
    encryptedSnapshots,
    offlineBatches,
    executiveKpis: scope.skipKpis ? { facultiesComparison: [] } : executiveKpisFrom(db),
  };
}

const canAny = (user, ...perms) => perms.some((p) => user.can(p));
const needAny = (c, ...perms) => { if (!canAny(c.user, ...perms)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
const SEES_PAYROLL = ['hr:manage', 'hr_payroll:approve'];

// نسخة النظرة الشاملة حسب صلاحيات المستخدم: بيانات الرواتب والرسوم والنسخ لا تصل إلا لمن يملكها، والطالب يرى سجلاته فقط
export function enterpriseOverviewFor(db, user) {
  const ov = buildEnterpriseSuiteOverview(db, { studentNo: user.role === 'student' ? (user.student_no || '-') : null, skipKpis: !user.can('stats:read') });
  const own = (rows) => rows.filter((row) => user.student_no && row.student_no === user.student_no);
  const seesAcademic = canAny(user, 'course:manage', 'grade:manage', 'academic:read');
  return {
    ...ov,
    advisingPlan: user.role === 'student' ? advisingPlanFor(db, user.id) : [],
    registration: registrationWindow(db),
    courseSections: listSections(db, { activeOnly: user.role === 'student' }),
    cardBlock: user.role === 'student' ? activeCardBlock(db, user.id) : null,
    enrollableCourses: user.role === 'student'
      ? db.prepare('SELECT c.code, c.name, c.hours FROM courses c JOIN student_profiles sp ON sp.program_id = c.program_id WHERE sp.user_id = ? AND c.active = 1 AND c.code IS NOT NULL ORDER BY c.level, c.semester, c.name').all(user.id)
      : db.prepare('SELECT code, name, hours FROM courses WHERE active = 1 AND code IS NOT NULL ORDER BY name LIMIT 500').all(),
    quizzes: canAny(user, 'course:manage', 'grade:manage') ? ov.quizzes : ov.quizzes.filter((q) => user.role !== 'student' || q.open).map(withoutAnswers),
    quizSubmissions: seesAcademic ? ov.quizSubmissions : own(ov.quizSubmissions),
    selfEnrollments: seesAcademic || user.can('student:read') ? ov.selfEnrollments : own(ov.selfEnrollments),
    facultyOverloads: canAny(user, ...SEES_PAYROLL, 'faculty:manage') ? ov.facultyOverloads : [],
    signedPayslips: canAny(user, ...SEES_PAYROLL) ? ov.signedPayslips : [],
    feeInstallments: canAny(user, 'finance:read', 'finance:fees', 'finance:post') ? ov.feeInstallments : own(ov.feeInstallments),
    encryptedSnapshots: canAny(user, 'backup:manage', 'settings:manage') ? ov.encryptedSnapshots : [],
    offlineBatches: canAny(user, 'grade:manage', 'attendance:manage', 'academic:read') ? ov.offlineBatches : [],
    executiveKpis: user.can('stats:read') ? ov.executiveKpis : { facultiesComparison: [] },
  };
}

export function registerEnterpriseSuiteRoutes(r, deps) {
  const { db } = deps;

  // نظرة شاملة لجميع الميزات الـ 15
  r.add('GET', '/api/enterprise/overview', (c) => {
    c.json(200, enterpriseOverviewFor(db, c.user));
  });

  // 3. محاكي المعدل التراكمي (GPA Simulator)
  r.add('POST', '/api/enterprise/gpa-simulate', (c) => {
    const b = c.body || {};
    const res = calculateSimulatedGpa(b.currentGpa ?? 0, b.completedHours ?? 0, b.upcomingCourses || []);
    c.json(200, res);
  });

  // 4. التسجيل الذاتي للمقررات (Self-Enrollment)
  r.add('POST', '/api/enterprise/self-enroll', (c) => {
    const b = c.body || {};
    if (!b.course_code) throw new HttpError(400, 'يرجى اختيار المقرر.');
    // الطالب يسجّل لنفسه فقط؛ وتحديد طالب آخر يتطلب صلاحية إدارية
    const self = Boolean(c.user.student_no);
    if (!self) needAny(c, 'course:manage', 'student:register');
    const studentNo = self ? c.user.student_no : String(b.student_no || '').trim();
    if (!studentNo) throw new HttpError(400, 'يرجى تحديد الرقم الجامعي للطالب.');
    const studentName = self ? c.user.display_name : String(b.student_name || studentNo);

    // التحقق من موانع التسجيل (Holds) وحالة قيد الطالب
    const stuUser = db.prepare(`
      SELECT u.id, p.status
      FROM users u
      LEFT JOIN student_profiles p ON p.user_id = u.id
      WHERE u.username = ? OR u.student_no = ?
      LIMIT 1
    `).get(studentNo, studentNo);
    const studentId = stuUser?.id || (c.user?.role === 'student' ? c.user.id : null);
    if (stuUser?.status && stuUser.status !== 'active') {
      throw new HttpError(403, `لا يمكن تسجيل المقررات لأن حالة قيد الطالب الحالية: ${STATUS_LABEL[stuUser.status] ?? stuUser.status}.`, 'student_inactive');
    }
    if (self) assertRegistrationOpen(db);
    if (stuUser?.id) db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`enroll:${stuUser.id}`);
    if (studentId && getSetting(db, 'academic.registration_requires_clearance')) {
      const due = overdueDues(db, { id: studentId, student_no: studentNo }) / 100;
      if (due > Number(getSetting(db, 'academic.registration_max_due'))) throw new HttpError(409, `يُفتح التسجيل بعد سداد المستحقات التي حان موعدها: ${due.toLocaleString('en-US')} ل.س.`, 'financial_dues');
    }
    if (studentId) {
      const activeHold = db.prepare('SELECT hold_type, note FROM student_holds WHERE student_id = ? AND cleared_at IS NULL AND (active IS NULL OR active = 1) LIMIT 1').get(studentId);
      if (activeHold) {
        throw new HttpError(403, `يوجد منع نشط على ملف الطالب (${activeHold.hold_type}) يمنع التسجيل الذاتي للمقررات.`, 'student_hold_active');
      }
    }

    // بيانات المقرر من السجل، لا مما يرسله المتصفح
    const course = db.prepare('SELECT code, name, hours FROM courses WHERE code = ? AND active = 1 ORDER BY id LIMIT 1').get(String(b.course_code));
    if (!course) throw new HttpError(404, 'المقرر غير موجود أو غير مفعل.', 'not_found');

    // منع التكرار وحد الساعات يخصان الفصل الحالي؛ الفصول السابقة سجل تاريخي
    const term = currentTerm(db);
    const dup = db.prepare('SELECT id FROM student_self_enrollments WHERE student_no = ? AND course_code = ? AND semester = ? AND dropped_at IS NULL').get(studentNo, course.code, term);
    if (dup) throw new HttpError(409, 'أنت مسجل مسبقاً في هذا المقرر لهذا الفصل.');
    if (studentId) {
      const best = db.prepare("SELECT MAX(g.mark) AS m FROM grades g JOIN courses c ON c.id = g.course_id WHERE g.student_id = ? AND c.code = ? AND g.workflow_status = 'approved'").get(studentId, course.code)?.m;
      if (best !== null && best !== undefined && Number(best) >= passMarkFor(db, studentId)) throw new HttpError(409, 'نجحت في هذا المقرر سابقاً، فلا يُعاد تسجيله.', 'already_passed');
    }

    // إذا فُتحت شعب للمقرر فالاختيار منها إلزامي ضمن السعة
    const sections = activeSectionsOf(db, course.code);
    let sectionId = null;
    if (sections.length) {
      const sec = sections.find((s) => s.id === Number(b.section_id));
      if (!sec) throw new HttpError(400, 'اختر شعبة من شعب هذا المقرر.', 'section_required');
      if (sec.seatsLeft <= 0) throw new HttpError(409, `الشعبة «${sec.name}» مكتملة.`, 'section_full');
      sectionId = sec.id;
    }

    const newCredits = Number(course.hours);
    const currentCreditsRow = db.prepare('SELECT COALESCE(SUM(credits), 0) AS total FROM student_self_enrollments WHERE student_no = ? AND semester = ? AND dropped_at IS NULL').get(studentNo, term);
    const currentCredits = Number(currentCreditsRow?.total || 0);
    const { cap, gpa } = creditCap(db, studentId);
    if (currentCredits + newCredits > cap) {
      throw new HttpError(400, `لا يمكن تجاوز الحد الأقصى للعبء الفصلي المسموح (${cap} ساعة${gpa === null ? '' : ` لمعدل ${gpa}%`}). الساعات المسجلة حالياً: ${currentCredits}.`, 'credit_limit_exceeded');
    }

    // المتطلبات المربوطة في الخطة الدراسية تُفرض من السجل، لا مما يرسله المتصفح
    if (studentId) {
      const pm = passMarkFor(db, studentId);
      const required = db.prepare(`SELECT pc.id, pc.name, p.min_mark FROM courses c
        JOIN student_profiles sp ON sp.program_id = c.program_id AND sp.user_id = ?
        JOIN sa_course_prerequisites p ON p.course_id = c.id JOIN courses pc ON pc.id = p.prereq_course_id WHERE c.code = ?`).all(studentId, b.course_code);
      for (const r of required) {
        const best = db.prepare("SELECT MAX(mark) AS m FROM grades WHERE student_id = ? AND course_id = ? AND workflow_status = 'approved'").get(studentId, r.id)?.m;
        if (best === null || best === undefined || Number(best) < Math.max(pm, Number(r.min_mark))) throw new HttpError(400, `يتطلب هذا المقرر اجتياز «${r.name}» أولاً.`, 'prerequisite_missing');
      }
    }

    db.prepare(`
      INSERT INTO student_self_enrollments (student_no, student_name, course_code, course_name, credits, semester, prerequisite_code, status, registered_at, section_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'مسجل ومعتمد آلياً', ?, ?)
    `).run(studentNo, studentName, course.code, course.name, newCredits, term, '', Date.now(), sectionId);
    c.json(201, { ok: true });
  });

  r.add('POST', '/api/enterprise/self-enroll/:id/drop', (c) => { if (!c.user) throw new HttpError(401, 'سجّل الدخول أولاً.', 'unauthorized'); c.json(200, dropEnrollment(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/enterprise/sections', (c) => { needAny(c, 'course:manage'); c.json(201, createSection(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/enterprise/sections/:id', (c) => { needAny(c, 'course:manage'); c.json(200, updateSection(deps, c.user, c.params.id, c.body, c.ip)); });

  // 5. احتساب العبء التدريسي الإضافي وإصدار قسيمة راتب موقعة رقمياً (Faculty Overload & Signed Payslip)
  r.add('POST', '/api/enterprise/faculty-overload', (c) => {
    if (!c.user || (c.user.role !== 'admin' && !c.user.can?.('hr:manage') && !c.user.can?.('hr_payroll:approve') && !c.user.can?.('faculty:manage'))) {
      throw new HttpError(403, 'يتطلب احتساب العبء التدريسي صلاحية الموارد البشرية أو شؤون الهيئة التدريسية (hr:manage / faculty:manage).', 'forbidden');
    }
    const b = c.body || {};
    if (!b.instructor_name) throw new HttpError(400, 'اسم عضو الهيئة التدريسية مطلوب.');
    const quorum = amount(b.quorum_hours, 'نصاب الساعات'), actual = amount(b.actual_teaching_hours, 'الساعات الفعلية'), supervision = amount(b.supervision_hours, 'ساعات الإشراف', { optional: true }), rate = amount(b.hourly_rate, 'أجر الساعة', { min: 1 });
    const calc = computeFacultyOverloadPay(quorum, actual, supervision, rate);
    db.prepare(`
      INSERT INTO faculty_overload_records (instructor_name, academic_rank, faculty_name, quorum_hours, actual_teaching_hours, supervision_hours, overload_hours, hourly_rate, total_overload_pay, semester, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'الفصل الأول ${academicYear()}', 'معتمد للرواتب', ?)
    `).run(
      b.instructor_name,
      text(b.academic_rank, 80),
      required(b.faculty_name, 'الكلية', 120),
      quorum,
      actual,
      supervision,
      calc.overloadHours,
      Number(b.hourly_rate ?? 100000),
      calc.totalOverloadPay,
      Date.now()
    );
    c.json(201, { ok: true, ...calc });
  });

  r.add('GET', '/api/enterprise/payslips/:code/verify', (c) => {
    if (!canAny(c.user, ...SEES_PAYROLL, 'audit:read')) throw new HttpError(403, 'لا تملك صلاحية التحقق من قسائم الرواتب.', 'forbidden');
    const row = db.prepare('SELECT * FROM hr_signed_payslips WHERE upper(payslip_code) = upper(?)').get(String(c.params.code));
    if (!row) throw new HttpError(404, 'لا توجد قسيمة بهذا الرمز.', 'not_found');
    const sig = String(row.digital_signature ?? ''), id = loadIdentity(deps.cfg);
    const valid = sig.startsWith('RSA-SHA256:') && crypto.verify('sha256', payslipPayload(row), crypto.createPublicKey(id.key), Buffer.from(sig.slice(11), 'base64'));
    c.json(200, { valid, code: row.payslip_code, employee: row.employee_name, month: row.month_label, certificateTrusted: id.trusted });
  });

  r.add('POST', '/api/enterprise/payslips/issue', (c) => {
    if (!c.user || (c.user.role !== 'admin' && !c.user.can?.('hr:manage') && !c.user.can?.('hr_payroll:approve'))) {
      throw new HttpError(403, 'يتطلب إصدار قسائم الرواتب الموقعة صلاحية إدارة الموارد البشرية والرواتب (hr:manage / hr_payroll:approve).', 'forbidden');
    }
    const b = c.body || {};
    if (!b.employee_name) throw new HttpError(400, 'اسم الموظف مطلوب لإصدار القسيمة.');
    if (b.employee_id) {
      const empExists = db.prepare('SELECT id FROM hr_employees WHERE id = ?').get(Number(b.employee_id));
      if (!empExists) throw new HttpError(404, 'سجل الموظف غير موجود في جدول الموارد البشرية (hr_employees).', 'employee_not_found');
    }
    if (!(Number(b.basic_salary) > 0)) throw new HttpError(400, 'الراتب الأساسي مطلوب.', 'validation');
    const basic = Number(b.basic_salary);
    const overload = amount(b.overload_pay, 'أجر الساعات الإضافية', { optional: true });
    const allow = amount(b.allowances, 'البدلات', { optional: true });
    const ded = amount(b.deductions, 'الحسميات', { optional: true });
    const net = basic + overload + allow - ded;
    const issued = new Date();
    const code = docNo(`PAY-${issued.getFullYear()}${String(issued.getMonth() + 1).padStart(2, '0')}`);
    const month = b.month_label || issued.toLocaleDateString('ar-SY-u-nu-latn', { month: 'long', year: 'numeric' });
    const sig = 'RSA-SHA256:' + crypto.sign('sha256', payslipPayload({ payslip_code: code, employee_code: b.employee_code || '', employee_name: b.employee_name, month_label: month, basic_salary: basic, overload_pay: overload, allowances: allow, deductions: ded, net_salary: net }), loadIdentity(deps.cfg).key).toString('base64');

    db.prepare(`
      INSERT INTO hr_signed_payslips (payslip_code, employee_code, employee_name, department, month_label, basic_salary, overload_pay, allowances, deductions, net_salary, digital_signature, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, b.employee_code || '', b.employee_name, b.department || '', month, basic, overload, allow, ded, net, sig, Date.now());
    c.json(201, { ok: true, payslip_code: code, net_salary: net, digital_signature: sig });
  });

  // 6. سداد قسط جامعي إلكترونياً وإصدار إيصال فوري (E-Payment)
  r.add('POST', '/api/enterprise/installments/:id/pay', (c) => {
    // لا توجد بوابة دفع مربوطة بعد؛ وأي رمز يرسله المتصفح لا يثبت حصول الدفع، لذلك يسجّل السداد موظف مالي فقط
    if (!canAny(c.user, 'finance:post', 'finance:fees')) {
      throw new HttpError(403, 'يتطلب تسجيل سداد القسط صلاحية مالية (finance:post / finance:fees).', 'forbidden');
    }
    const id = Number(c.params.id);
    const row = db.prepare('SELECT * FROM student_fee_installments WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'القسط غير موجود.');
    if (row.paid_at) throw new HttpError(409, 'هذا القسط مسدد مسبقاً.', 'already_paid');
    // مصدر الرصيد واحد هو دفتر المالية: القسط يُسجَّل استحقاقاً ثم دفعة، فيظهر في /api/me/fees وفي القيود
    const stu = db.prepare("SELECT id FROM users WHERE student_no = ? AND role = 'student'").get(row.student_no);
    if (!stu) throw new HttpError(409, 'لا يوجد حساب طالب بهذا الرقم الجامعي، فلا يمكن ترحيل السداد إلى المالية.', 'no_student_account');
    financeReady(db);
    const feeType = db.prepare("SELECT id FROM fin_fee_types WHERE active = 1 AND kind = 'fee' ORDER BY id LIMIT 1").get();
    if (!feeType && !row.fin_charge_id) throw new HttpError(409, 'عرّف نوع رسم في المالية أولاً.', 'no_fee_type');
    const due = Number(row.amount), remaining = due - Number(row.paid_amount || 0);
    const method = /مصرف|بنك|bank/i.test(String(c.body?.payment_method ?? '')) ? 'bank' : 'cash';
    const { receipt, paidAt } = tx(db, () => {
      const charge = row.fin_charge_id ? null : createCharge(deps, c.user, { studentId: stu.id, feeTypeId: feeType.id, amount: due, dueDay: String(row.due_date).slice(0, 10), note: `قسط ${row.installment_code}` }, c.ip);
      const pay = createPayment(deps, c.user, { studentId: stu.id, amount: remaining, method, note: `قسط ${row.installment_code}` }, c.ip);
      const at = Date.now();
      db.prepare(`UPDATE student_fee_installments SET paid_amount = amount, payment_method = ?, receipt_no = ?, status = 'مسدد بالكامل', paid_at = ?, fin_charge_id = COALESCE(fin_charge_id, ?), fin_payment_id = ? WHERE id = ?`)
        .run(c.body?.payment_method || (method === 'bank' ? 'مصرف' : 'نقدي'), pay.receiptNo, at, charge?.id ?? null, pay.payment.id, id);
      return { receipt: pay.receiptNo, paidAt: at };
    });
    audit(db, c.user, 'تسجيل سداد قسط', `${row.installment_code} · ${receipt}`, c.ip);
    c.json(200, { ok: true, receipt_no: receipt, paid_at: paidAt });
  });

  // 7. إرسال إشعار فوري متعدد القنوات (Web Push / Telegram / WhatsApp / Email)
  r.add('POST', '/api/enterprise/notifications/broadcast', (c) => {
    needAny(c, 'news:manage');
    const b = c.body || {};
    if (!b.title || !b.body) throw new HttpError(400, 'عنوان ونص الإشعار مطلوبان.');
    // الإرسال الفعلي: إشعارات المتصفح لمن اشترك من الجمهور. القنوات الأخرى غير مربوطة، فلا تُعرض
    const toStaff = b.audience === 'staff';
    const ids = db.prepare(toStaff ? "SELECT id FROM users WHERE role <> 'student' AND active = 1" : "SELECT u.id FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.role = 'student' AND u.active = 1 AND p.status = 'active'").all().map((u) => u.id);
    const devices = ids.length ? Number(db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`).get(...ids).c) : 0;
    db.prepare(`
      INSERT INTO multi_channel_notifications (title, body, target_audience, channels, priority, delivery_count, sender_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.title, b.body, toStaff ? 'الهيئة التدريسية والإدارية' : 'كافة الطلاب', 'البوابة الداخلية + إشعارات المتصفح', b.priority || 'عاجل', devices, c.user?.display_name || 'إدارة الجامعة', Date.now());
    if (ids.length) notify(deps, ids, { title: b.title, body: b.body, tag: 'broadcast' });
    audit(db, c.user, 'إرسال إشعار عام', String(b.title).slice(0, 80), c.ip);
    c.json(201, { ok: true, devices });
  });

  // 9. مزامنة دفعة حضور وعلامات اللجان الامتحانية دون اتصال (Offline Exam Sync)
  r.add('POST', '/api/enterprise/offline-sync', (c) => {
    needAny(c, 'grade:manage', 'attendance:manage');
    const b = c.body || {};
    const committee = String(b.committee_name ?? '').trim().slice(0, 120);
    const hall = String(b.hall_code ?? '').trim().slice(0, 60);
    const courseCode = String(b.course_code ?? '').trim().slice(0, 40);
    if (!committee || !hall || !courseCode) throw new HttpError(400, 'اللجنة والقاعة والمقرر مطلوبة.', 'validation');
    const course = db.prepare('SELECT id, code, name FROM courses WHERE code = ? AND active = 1 ORDER BY id LIMIT 1').get(courseCode);
    if (!course) throw new HttpError(404, `المقرر ${courseCode} غير موجود.`, 'not_found');
    const numbers = [...new Set((Array.isArray(b.student_nos) ? b.student_nos : []).map((n) => String(n ?? '').trim()).filter(Boolean))];
    if (!numbers.length) throw new HttpError(400, 'أدخل الرقم الجامعي لطالب واحد على الأقل.', 'validation');
    const find = db.prepare("SELECT id, student_no FROM users WHERE role = 'student' AND student_no = ?");
    const students = numbers.map((n) => find.get(n));
    const missing = numbers.filter((_, i) => !students[i]);
    if (missing.length) throw new HttpError(400, `أرقام جامعية غير موجودة: ${missing.slice(0, 10).join('، ')}`, 'validation');
    const code = docNo('EXAM-ATT');
    const now = Date.now();
    tx(db, () => {
      const ins = db.prepare("INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, exited_at, method, recorded_by, note) VALUES (?, 'exam', ?, ?, ?, ?, ?, 'manual', ?, ?)");
      for (const st of students) ins.run(st.id, course.id, course.name, hall, now, now, c.user.id, `${committee} — ${code}`);
      db.prepare(`INSERT INTO offline_sync_batches (batch_code, committee_name, hall_code, course_code, records_count, payload_json, synced_by, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(code, committee, hall, course.code, students.length, JSON.stringify(numbers), c.user.display_name || '', now);
    });
    audit(db, c.user, 'رصد حضور لجنة امتحانية', `${code} — ${course.code} — ${students.length} طالب`, c.ip);
    c.json(201, { ok: true, batch_code: code, recorded_count: students.length });
  });

  // 10. البحث الشامل الفوري (Command Palette Search API)
  r.add('GET', '/api/enterprise/global-search', (c) => {
    const like = `%${String(c.query.q || '').trim().replace(/[\\%_]/g, '\\$&')}%`;
    const students = !c.user.can('student:read') ? [] : db.prepare("SELECT id, username, display_name, student_no, program FROM users WHERE role = 'student' AND (display_name ILIKE ? ESCAPE '\\' OR student_no ILIKE ? ESCAPE '\\') ORDER BY id LIMIT 8").all(like, like);
    const courses = db.prepare("SELECT id, code, name, instructor FROM courses WHERE name ILIKE ? ESCAPE '\\' OR code ILIKE ? ESCAPE '\\' ORDER BY id LIMIT 8").all(like, like);
    const payslips = !canAny(c.user, ...SEES_PAYROLL) ? [] : db.prepare("SELECT payslip_code, employee_name, department, net_salary FROM hr_signed_payslips WHERE employee_name ILIKE ? ESCAPE '\\' OR payslip_code ILIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 6").all(like, like);

    c.json(200, { students, courses, payslips });
  });
}
