import { docNo, academicYear } from '../lib/doc_no.js';
import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import { passMark } from './academics.js';

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

export function detectTimetableConflict(existingSlots = [], candidate) {
  for (const s of existingSlots) {
    if (s.day_name === candidate.day_name && s.time_slot === candidate.time_slot) {
      if (s.hall_code === candidate.hall_code) {
        return { conflict: true, reason: `تضارب قاعة: القاعة ${s.hall_code} محجوزة لمقرر "${s.course_name}" في نفس التوقيت.` };
      }
      if (s.instructor_name === candidate.instructor_name) {
        return { conflict: true, reason: `تضارب أستاذ: المحاضر "${s.instructor_name}" لديه محاضرة "${s.course_name}" في نفس التوقيت.` };
      }
    }
  }
  return { conflict: false, reason: null };
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
  const pm = passMark(db);
  const marks = new Map(db.prepare("SELECT course_id, mark FROM grades WHERE student_id = ? AND workflow_status = 'approved' ORDER BY academic_year, id").all(userId).map((g) => [g.course_id, Number(g.mark)]));
  const enrolled = new Set(db.prepare('SELECT e.course_code FROM student_self_enrollments e JOIN users u ON u.student_no = e.student_no WHERE u.id = ?').all(userId).map((e) => e.course_code));
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
  const pm = passMark(db), byFaculty = new Map();
  const row = (faculty) => { if (!byFaculty.has(faculty)) byFaculty.set(faculty, { faculty, students: 0, graded: 0, passed: 0, charged: 0, paid: 0, researchPapers: 0 }); return byFaculty.get(faculty); };
  for (const r of db.prepare(`SELECT ${NAME} AS faculty, COUNT(*) AS n ${FACULTY} WHERE sp.status = 'active' GROUP BY ${NAME}`).all()) row(r.faculty).students = Number(r.n);
  for (const r of db.prepare(`SELECT ${NAME} AS faculty, COUNT(*) AS n, SUM(CASE WHEN g.mark >= ? THEN 1 ELSE 0 END) AS passed FROM grades g JOIN student_profiles sp ON sp.user_id = g.student_id JOIN programs p ON p.id = sp.program_id LEFT JOIN faculties fa ON fa.id = p.faculty_id WHERE g.workflow_status = 'approved' GROUP BY ${NAME}`).all(pm)) Object.assign(row(r.faculty), { graded: Number(r.n), passed: Number(r.passed) });
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

export function buildEnterpriseSuiteOverview(db) {
  const scheduleSlots = db.prepare('SELECT * FROM smart_schedule_slots ORDER BY id DESC').all();
  const quizzes = db.prepare('SELECT * FROM online_quizzes ORDER BY id DESC').all().map((q) => ({
    ...q,
    questions: JSON.parse(q.questions_json || '[]'),
  }));
  const quizSubmissions = db.prepare('SELECT * FROM online_quiz_submissions ORDER BY submitted_at DESC LIMIT 30').all();
  const selfEnrollments = db.prepare('SELECT * FROM student_self_enrollments ORDER BY registered_at DESC').all();
  const facultyOverloads = db.prepare('SELECT * FROM faculty_overload_records ORDER BY id DESC').all();
  const signedPayslips = db.prepare('SELECT * FROM hr_signed_payslips ORDER BY issued_at DESC').all();
  const feeInstallments = db.prepare('SELECT * FROM student_fee_installments ORDER BY id ASC').all();
  const notifications = db.prepare('SELECT * FROM multi_channel_notifications ORDER BY created_at DESC LIMIT 20').all();
  const encryptedSnapshots = db.prepare('SELECT * FROM encrypted_snapshots ORDER BY created_at DESC LIMIT 20').all();
  const offlineBatches = db.prepare('SELECT * FROM offline_sync_batches ORDER BY synced_at DESC LIMIT 20').all();

  return {
    scheduleSlots,
    quizzes,
    quizSubmissions,
    selfEnrollments,
    facultyOverloads,
    signedPayslips,
    feeInstallments,
    notifications,
    encryptedSnapshots,
    offlineBatches,
    executiveKpis: executiveKpisFrom(db),
  };
}

const canAny = (user, ...perms) => perms.some((p) => user.can(p));
const needAny = (c, ...perms) => { if (!canAny(c.user, ...perms)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
const SEES_PAYROLL = ['hr:manage', 'hr_payroll:approve'];

// نسخة النظرة الشاملة حسب صلاحيات المستخدم: بيانات الرواتب والرسوم والنسخ لا تصل إلا لمن يملكها، والطالب يرى سجلاته فقط
export function enterpriseOverviewFor(db, user) {
  const ov = buildEnterpriseSuiteOverview(db);
  const own = (rows) => rows.filter((row) => user.student_no && row.student_no === user.student_no);
  const seesAcademic = canAny(user, 'course:manage', 'grade:manage', 'academic:read');
  return {
    ...ov,
    advisingPlan: user.role === 'student' ? advisingPlanFor(db, user.id) : [],
    quizzes: canAny(user, 'course:manage', 'grade:manage') ? ov.quizzes : ov.quizzes.map(({ questions_json, ...q }) => ({ ...q, questions: q.questions.map(({ answer, ...rest }) => rest) })),
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

  // 1. إضافة حصة في الجدول الذكي مع فحص التضارب الآلي
  r.add('POST', '/api/enterprise/schedule', (c) => {
    needAny(c, 'course:manage', 'attendance:manage');
    const b = c.body || {};
    if (!b.course_code || !b.course_name || !b.instructor_name || !b.hall_code || !b.day_name || !b.time_slot) {
      throw new HttpError(400, 'جميع حقول المقرر والقاعة والمحاضر والتوقيت مطلوبة.');
    }
    const existing = db.prepare('SELECT * FROM smart_schedule_slots WHERE day_name = ? AND time_slot = ?').all(b.day_name, b.time_slot);
    const check = detectTimetableConflict(existing, b);
    if (check.conflict) {
      throw new HttpError(409, check.reason, 'schedule_conflict');
    }
    const info = db.prepare(`
      INSERT INTO smart_schedule_slots (course_code, course_name, faculty_name, instructor_name, hall_code, day_name, time_slot, section_code, enrolled_count, capacity, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'معتمد بلا تضارب', ?)
    `).run(
      String(b.course_code).trim(),
      String(b.course_name).trim(),
      String(b.faculty_name || '').trim(),
      String(b.instructor_name).trim(),
      String(b.hall_code).trim(),
      String(b.day_name).trim(),
      String(b.time_slot).trim(),
      String(b.section_code || 'شعبة 1').trim(),
      Number(b.enrolled_count || 0),
      Number(b.capacity || 0),
      Date.now()
    );
    c.json(201, { ok: true, id: Number(info.lastInsertRowid) });
  });

  // 2. تقديم اختبار إلكتروني وتصحيح فوري آلي (Online Quiz Auto-Grading)
  r.add('POST', '/api/enterprise/quizzes/:id/submit', (c) => {
    const quizId = Number(c.params.id);
    const quiz = db.prepare('SELECT * FROM online_quizzes WHERE id = ?').get(quizId);
    if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.');
    if (!c.user.student_no) throw new HttpError(403, 'تقديم الاختبار متاح للطلاب فقط.', 'forbidden');
    if (quiz.status !== 'نشط') throw new HttpError(409, 'هذا الاختبار غير متاح حالياً.', 'quiz_closed');
    if (db.prepare('SELECT 1 AS x FROM online_quiz_submissions WHERE quiz_id = ? AND student_no = ? LIMIT 1').get(quizId, c.user.student_no)) throw new HttpError(409, 'قدّمت هذا الاختبار من قبل، ويُسمح بمحاولة واحدة.', 'quiz_already_submitted');
    const questions = JSON.parse(quiz.questions_json || '[]');
    const answers = Array.isArray(c.body?.answers) ? c.body.answers : [];
    let correct = 0;
    questions.forEach((q, idx) => {
      if (Number(answers[idx]) === Number(q.answer)) correct++;
    });
    const score = questions.length > 0 ? Math.round((correct / questions.length) * quiz.total_marks * 10) / 10 : quiz.total_marks;
    const studentNo = c.user.student_no;
    const studentName = c.user.display_name;

    db.prepare(`
      INSERT INTO online_quiz_submissions (quiz_id, student_no, student_name, score, total_marks, answers_json, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(quizId, studentNo, studentName, score, quiz.total_marks, JSON.stringify(answers), Date.now());

    c.json(200, { ok: true, score, totalMarks: quiz.total_marks, correctCount: correct, questionsCount: questions.length });
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
    if (!b.course_code || !b.course_name) throw new HttpError(400, 'يرجى تحديد رمز واسم المقرر للتسجيل.');
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
    if (stuUser?.status && ['withdrawn', 'suspended', 'dismissed'].includes(stuUser.status)) {
      throw new HttpError(403, `لا يمكن تسجيل المقررات لأن حالة قيد الطالب الحالية (${stuUser.status}).`, 'student_inactive');
    }
    if (studentId) {
      const activeHold = db.prepare('SELECT hold_type, note FROM student_holds WHERE student_id = ? AND cleared_at IS NULL AND (active IS NULL OR active = 1) LIMIT 1').get(studentId);
      if (activeHold) {
        throw new HttpError(403, `يوجد منع نشط على ملف الطالب (${activeHold.hold_type}) يمنع التسجيل الذاتي للمقررات.`, 'student_hold_active');
      }
    }

    const dup = db.prepare('SELECT id FROM student_self_enrollments WHERE student_no = ? AND course_code = ?').get(studentNo, b.course_code);
    if (dup) throw new HttpError(409, 'أنت مسجل مسبقاً في هذا المقرر لهذا الفصل.');

    const newCredits = Math.max(1, Number(b.credits || 3));
    const currentCreditsRow = db.prepare('SELECT COALESCE(SUM(credits), 0) AS total FROM student_self_enrollments WHERE student_no = ?').get(studentNo);
    const currentCredits = Number(currentCreditsRow?.total || 0);
    if (currentCredits + newCredits > 18) {
      throw new HttpError(400, `لا يمكن تجاوز الحد الأقصى للعبء الفصلي المسموح (18 ساعة معتمدة). الساعات المسجلة حالياً: ${currentCredits}.`, 'credit_limit_exceeded');
    }

    // المتطلبات المربوطة في الخطة الدراسية تُفرض من السجل، لا مما يرسله المتصفح
    if (studentId) {
      const pm = passMark(db);
      const required = db.prepare(`SELECT pc.id, pc.name, p.min_mark FROM courses c
        JOIN student_profiles sp ON sp.program_id = c.program_id AND sp.user_id = ?
        JOIN sa_course_prerequisites p ON p.course_id = c.id JOIN courses pc ON pc.id = p.prereq_course_id WHERE c.code = ?`).all(studentId, b.course_code);
      for (const r of required) {
        const best = db.prepare("SELECT MAX(mark) AS m FROM grades WHERE student_id = ? AND course_id = ? AND workflow_status = 'approved'").get(studentId, r.id)?.m;
        if (best === null || best === undefined || Number(best) < Math.max(pm, Number(r.min_mark))) throw new HttpError(400, `يتطلب هذا المقرر اجتياز «${r.name}» أولاً.`, 'prerequisite_missing');
      }
    }

    // التحقق من المتطلب السابق (Prerequisite) إن وجد
    const prereqCode = String(b.prerequisite_code || '').trim();
    if (prereqCode && prereqCode !== 'مستوفى' && prereqCode !== 'لا يوجد' && prereqCode !== 'NONE' && studentId) {
      const prereqCourse = db.prepare('SELECT id, name FROM courses WHERE code = ? OR name = ? LIMIT 1').get(prereqCode, prereqCode);
      if (prereqCourse) {
        const passed = db.prepare("SELECT id FROM grades WHERE student_id = ? AND (course_id = ? OR course = ?) AND mark >= 60 AND workflow_status = 'approved' LIMIT 1")
          .get(studentId, prereqCourse.id, prereqCourse.name);
        if (!passed) {
          throw new HttpError(400, `لم يتم استيفاء المتطلب السابق للمقرر (${prereqCode}).`, 'prerequisite_not_met');
        }
      }
    }

    db.prepare(`
      INSERT INTO student_self_enrollments (student_no, student_name, course_code, course_name, credits, semester, prerequisite_code, status, registered_at)
      VALUES (?, ?, ?, ?, ?, 'الفصل الأول ${academicYear()}', ?, 'مسجل ومعتمد آلياً', ?)
    `).run(studentNo, studentName, b.course_code, b.course_name, newCredits, b.prerequisite_code || 'مستوفى', Date.now());
    c.json(201, { ok: true });
  });

  // 5. احتساب العبء التدريسي الإضافي وإصدار قسيمة راتب موقعة رقمياً (Faculty Overload & Signed Payslip)
  r.add('POST', '/api/enterprise/faculty-overload', (c) => {
    if (!c.user || (c.user.role !== 'admin' && !c.user.can?.('hr:manage') && !c.user.can?.('hr_payroll:approve') && !c.user.can?.('faculty:manage'))) {
      throw new HttpError(403, 'يتطلب احتساب العبء التدريسي صلاحية الموارد البشرية أو شؤون الهيئة التدريسية (hr:manage / faculty:manage).', 'forbidden');
    }
    const b = c.body || {};
    if (!b.instructor_name) throw new HttpError(400, 'اسم عضو الهيئة التدريسية مطلوب.');
    const calc = computeFacultyOverloadPay(b.quorum_hours ?? 10, b.actual_teaching_hours ?? 14, b.supervision_hours ?? 2, b.hourly_rate ?? 100000);
    db.prepare(`
      INSERT INTO faculty_overload_records (instructor_name, academic_rank, faculty_name, quorum_hours, actual_teaching_hours, supervision_hours, overload_hours, hourly_rate, total_overload_pay, semester, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'الفصل الأول ${academicYear()}', 'معتمد للرواتب', ?)
    `).run(
      b.instructor_name,
      b.academic_rank || 'أستاذ مساعد',
      b.faculty_name || 'كلية هندسة الأمن السيبراني',
      Number(b.quorum_hours ?? 10),
      Number(b.actual_teaching_hours ?? 14),
      Number(b.supervision_hours ?? 2),
      calc.overloadHours,
      Number(b.hourly_rate ?? 100000),
      calc.totalOverloadPay,
      Date.now()
    );
    c.json(201, { ok: true, ...calc });
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
    const overload = Number(b.overload_pay) || 0;
    const allow = Number(b.allowances) || 0;
    const ded = Number(b.deductions) || 0;
    const net = basic + overload + allow - ded;
    const issued = new Date();
    const code = docNo(`PAY-${issued.getFullYear()}${String(issued.getMonth() + 1).padStart(2, '0')}`);
    // بصمة تحقق بلا مفتاح، وليست توقيعاً رقمياً
    const sig = 'SHA256-' + crypto.createHash('sha256').update(`${code}:${b.employee_name}:${net}`).digest('hex').slice(0, 20).toUpperCase();

    db.prepare(`
      INSERT INTO hr_signed_payslips (payslip_code, employee_code, employee_name, department, month_label, basic_salary, overload_pay, allowances, deductions, net_salary, digital_signature, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, b.employee_code || '', b.employee_name, b.department || '', b.month_label || issued.toLocaleDateString('ar-SY-u-nu-latn', { month: 'long', year: 'numeric' }), basic, overload, allow, ded, net, sig, Date.now());
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
    const receipt = docNo('RCP');
    const method = c.body?.payment_method || 'بطاقة الدفع الإلكتروني الجامعية';
    db.prepare(`
      UPDATE student_fee_installments
      SET paid_amount = amount, payment_method = ?, receipt_no = ?, status = 'مسدد بالكامل', paid_at = ?
      WHERE id = ?
    `).run(method, receipt, Date.now(), id);
    audit(db, c.user, 'تسجيل سداد قسط', `${row.installment_code} · ${receipt}`, c.ip);
    c.json(200, { ok: true, receipt_no: receipt, paid_at: Date.now() });
  });

  // 7. إرسال إشعار فوري متعدد القنوات (Web Push / Telegram / WhatsApp / Email)
  r.add('POST', '/api/enterprise/notifications/broadcast', (c) => {
    needAny(c, 'news:manage');
    const b = c.body || {};
    if (!b.title || !b.body) throw new HttpError(400, 'عنوان ونص الإشعار مطلوبان.');
    db.prepare(`
      INSERT INTO multi_channel_notifications (title, body, target_audience, channels, priority, delivery_count, sender_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.title,
      b.body,
      b.target_audience || 'جميع الطلاب والعاملين',
      b.channels || 'Web Push + Telegram + WhatsApp + Email',
      b.priority || 'عاجل',
      0, // الإشعار يُسجَّل فقط، ولا إرسال خارجي فعلي
      c.user?.display_name || 'إدارة الجامعة',
      Date.now()
    );
    c.json(201, { ok: true });
  });

  // 9. مزامنة دفعة حضور وعلامات اللجان الامتحانية دون اتصال (Offline Exam Sync)
  r.add('POST', '/api/enterprise/offline-sync', (c) => {
    needAny(c, 'grade:manage', 'attendance:manage');
    const b = c.body || {};
    const records = Array.isArray(b.records) ? b.records : [];
    const code = docNo('SYNC-OFF');
    db.prepare(`
      INSERT INTO offline_sync_batches (batch_code, committee_name, hall_code, course_code, records_count, payload_json, synced_by, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      b.committee_name || 'اللجنة الامتحانية المركزية',
      b.hall_code || 'مدرج الفارابي A1',
      b.course_code || 'CYB-301',
      records.length || 1,
      JSON.stringify(records),
      c.user?.display_name || 'رئيس القاعة الامتحانية',
      Date.now()
    );
    c.json(201, { ok: true, batch_code: code, synced_count: records.length || 1 });
  });

  // 10. البحث الشامل الفوري (Command Palette Search API)
  r.add('GET', '/api/enterprise/global-search', (c) => {
    const q = String(c.query.q || '').trim().toLowerCase();
    const students = !c.user.can('student:read') ? [] : db.prepare("SELECT id, username, display_name, student_no, program FROM users WHERE role = 'student' LIMIT 30").all()
      .filter((s) => !q || String(s.display_name).toLowerCase().includes(q) || String(s.student_no).toLowerCase().includes(q));
    const courses = db.prepare('SELECT id, code, name, instructor FROM courses LIMIT 30').all()
      .filter((x) => !q || String(x.name).toLowerCase().includes(q) || String(x.code).toLowerCase().includes(q));
    const payslips = !canAny(c.user, ...SEES_PAYROLL) ? [] : db.prepare('SELECT payslip_code, employee_name, department, net_salary FROM hr_signed_payslips LIMIT 20').all()
      .filter((p) => !q || String(p.employee_name).toLowerCase().includes(q) || String(p.payslip_code).toLowerCase().includes(q));

    c.json(200, { students: students.slice(0, 8), courses: courses.slice(0, 8), payslips: payslips.slice(0, 6) });
  });
}
