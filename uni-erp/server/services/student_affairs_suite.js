import { docNo, academicYear } from '../lib/doc_no.js';
import { SOD_SENSITIVE_PERMISSIONS } from '../permissions.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { registerStudent, STATUS_LABEL } from './students.js';
import { createCharge, voidCharge } from './finance/fees.js';
import { createStudentInvoice } from './finance/student_billing.js';
import { currentTerm } from './sections.js';
import { graduationBlockers, appealBlocksMovement } from './student_regulations.js';
import { passMarkFor, passSql } from './academics.js';
import { nextNumber, withLock } from './numbering.js';
import { tx } from '../db.js';
import { ready as readyFinance } from './finance/core.js';
import { getSetting } from './settings.js';
import { issueDocument } from './documents.js';

/* ============================================================================
   1. الدوال النقية (Pure Decoupled Business Logic — Unit-Testable)
   ============================================================================ */

/**
 * 1-أ. محرك الفرز والمفاضلة الإلكترونية الآلي (Automated Admissions Sorting Engine)
 * يفرز المتقدمين تنازلياً حسب المجموع الموزون (مع أولوية أبناء الشهداء +5 درجات مفاضلة)
 * ويوزعهم على الرغبات الثلاث بحسب الحد الأدنى والطاقة الاستيعابية لكل برنامج.
 */
export function runAutomatedAdmissionsSort(applicants = [], programs = []) {
  const progMap = new Map();
  for (const p of programs) {
    progMap.set(Number(p.id), {
      id: Number(p.id),
      name: p.name,
      minScore: Number(p.minScore ?? 175),
      capacity: Number(p.capacity ?? 25),
      enrolledCount: Number(p.enrolledCount ?? 0),
    });
  }

  // ترتيب المتقدمين تنازلياً حسب الدرجة الفعالة للمفاضلة
  const sorted = [...applicants]
    .map((a) => ({
      ...a,
      effectiveScore: Number(a.hsScore || a.hs_score || 0) + (a.category === 'martyrs' ? 8 : 0),
    }))
    .sort((a, b) => b.effectiveScore - a.effectiveScore);

  const results = [];
  for (const app of sorted) {
    if (app.sorting_status === 'enrolled' || app.sorting_status === 'enrolling') {
      results.push({ id: app.id, status: 'enrolled', acceptedProgramId: app.accepted_program_id });
      continue;
    }
    const prefs = [app.pref1_program_id ?? app.pref1ProgramId, app.pref2_program_id ?? app.pref2ProgramId, app.pref3_program_id ?? app.pref3ProgramId]
      .map((x) => Number(x))
      .filter((x) => x > 0);

    let acceptedProgramId = null;
    let status = 'rejected';

    for (const pid of prefs) {
      const p = progMap.get(pid);
      if (!p) continue;
      // فئة الموازي تقبل بحد أدنى أقل بـ 10 درجات من العام
      const cutoff = app.category === 'parallel' ? p.minScore - 10 : p.minScore;
      if (app.effectiveScore >= cutoff) {
        if (p.enrolledCount < p.capacity) {
          acceptedProgramId = p.id;
          status = 'accepted';
          p.enrolledCount += 1;
          break;
        } else {
          status = 'waitlisted';
        }
      }
    }

    results.push({
      id: app.id,
      applicationNo: app.application_no || app.applicationNo,
      effectiveScore: app.effectiveScore,
      status,
      acceptedProgramId,
    });
  }
  return results;
}

/**
 * 1-ب. حاسبة معادلة المواد للطلاب المحولين (Transfer Credit Equivalence Calculator)
 */
export function calculateTransferEquivalenceSummary(equivalences = [], totalProgramHours = 132) {
  const approved = equivalences.filter((e) => (e.equivalence_status || e.status) === 'approved');
  const pending = equivalences.filter((e) => (e.equivalence_status || e.status) === 'pending');
  const earnedHours = approved.reduce((sum, e) => sum + Number(e.external_hours ?? e.hours ?? 0), 0);
  const totalReq = Math.max(1, Number(totalProgramHours) || 132);
  const remainingHours = Math.max(0, totalReq - earnedHours);
  const completionPercent = Math.min(100, Math.round((earnedHours / totalReq) * 1000) / 10);

  return {
    approvedCoursesCount: approved.length,
    pendingCoursesCount: pending.length,
    earnedHours,
    totalProgramHours: totalReq,
    remainingHours,
    completionPercent,
  };
}

/**
 * 2. بناء شجرة الخطة الدراسية والمتطلبات السابقة (Interactive Prerequisite & Degree Audit Tree)
 */
export function buildCoursePrerequisiteTree(courses = [], grades = [], prereqs = [], studentLevel = 1) {
  const gradeByCourseId = new Map();
  const gradeByCourseName = new Map();
  for (const g of grades) {
    const mark = Number(g.total ?? g.mark ?? 0);
    const passed = g.passed !== undefined ? !!g.passed : mark >= 60;
    if (g.courseId || g.course_id) gradeByCourseId.set(Number(g.courseId || g.course_id), { mark, passed });
    if (g.course) gradeByCourseName.set(String(g.course).trim(), { mark, passed });
  }

  const courseById = new Map(courses.map((c) => [Number(c.id), c]));
  const prereqsByCourse = new Map();
  for (const pr of prereqs) {
    const cid = Number(pr.course_id ?? pr.courseId);
    const pid = Number(pr.prereq_course_id ?? pr.prereqCourseId);
    if (!prereqsByCourse.has(cid)) prereqsByCourse.set(cid, []);
    prereqsByCourse.get(cid).push({ linkId: pr.id, prereqId: pid, minMark: Number(pr.min_mark ?? pr.minMark ?? 60) });
  }
  // ما يفتحه كل مقرر بعد اجتيازه
  const unlocksByCourse = new Map();
  for (const [cid, list] of prereqsByCourse) for (const r of list) { if (!unlocksByCourse.has(r.prereqId)) unlocksByCourse.set(r.prereqId, []); unlocksByCourse.get(r.prereqId).push(cid); }

  let completedHours = 0;
  let inProgressHours = 0;
  let availableHours = 0;
  let lockedHours = 0;

  const nodes = courses.map((c) => {
    const cid = Number(c.id);
    const hrs = Number(c.hours || 3);
    const g = gradeByCourseId.get(cid) || gradeByCourseName.get(String(c.name).trim());
    const reqList = prereqsByCourse.get(cid) || [];

    const missingPrereqs = [];
    for (const req of reqList) {
      const pCourse = courseById.get(req.prereqId);
      const pg = gradeByCourseId.get(req.prereqId) || (pCourse ? gradeByCourseName.get(String(pCourse.name).trim()) : null);
      if (!pg || !pg.passed || pg.mark < req.minMark) {
        missingPrereqs.push(pCourse ? pCourse.name : `مقرر #${req.prereqId}`);
      }
    }

    let state = 'available'; // completed | in_progress | available | locked
    if (g && g.passed) {
      state = 'completed';
      completedHours += hrs;
    } else if (missingPrereqs.length > 0) {
      state = 'locked';
      lockedHours += hrs;
    } else if (Number(c.level || 1) === Number(studentLevel)) {
      state = 'in_progress';
      inProgressHours += hrs;
    } else {
      state = 'available';
      availableHours += hrs;
    }

    return {
      id: cid,
      code: c.code || `CRS-${cid}`,
      name: c.name,
      level: Number(c.level || 1),
      semester: Number(c.semester || 1),
      hours: hrs,
      instructor: c.instructor || 'هيئة تدريسية',
      mark: g ? g.mark : null,
      passed: g ? g.passed : false,
      state,
      prerequisites: reqList.map((r) => {
        const pc = courseById.get(r.prereqId);
        return { id: r.prereqId, linkId: r.linkId, minMark: r.minMark, name: pc ? pc.name : `#${r.prereqId}`, code: pc ? pc.code : '' };
      }),
      unlocks: (unlocksByCourse.get(cid) || []).map((id) => { const uc = courseById.get(id); return { id, name: uc ? uc.name : `#${id}`, code: uc ? uc.code : '' }; }),
      missingPrereqs,
    };
  });

  const totalHours = completedHours + inProgressHours + availableHours + lockedHours;
  return {
    nodes,
    summary: {
      totalCourses: nodes.length,
      completedCount: nodes.filter((n) => n.state === 'completed').length,
      inProgressCount: nodes.filter((n) => n.state === 'in_progress').length,
      availableCount: nodes.filter((n) => n.state === 'available').length,
      lockedCount: nodes.filter((n) => n.state === 'locked').length,
      completedHours,
      inProgressHours,
      availableHours,
      lockedHours,
      totalHours,
      progressPercent: totalHours ? Math.round((completedHours / totalHours) * 1000) / 10 : 0,
    },
  };
}

/**
 * 5. حاسبة استحقاق المنح والإعفاءات المالية (Scholarship & Financial Aid Calculator)
 */
export function calculateScholarshipGrant({ scholarshipType, baseTuition = 1500000, gpa = 0 }) {
  const tuition = Math.max(0, Number(baseTuition) || 1500000);
  const numGpa = Number(gpa) || 0;
  let discountPercent = 0;
  let label = 'حسم طلابي';

  if (scholarshipType === 'merit_top') {
    label = 'منحة التفوق الأكاديمي (أوائل الدفعات)';
    if (numGpa >= 92) discountPercent = 100;
    else if (numGpa >= 85) discountPercent = 50;
    else if (numGpa >= 80) discountPercent = 25;
    else discountPercent = 15;
  } else if (scholarshipType === 'martyrs_kin') {
    label = 'منحة أبناء وذوي الشهداء';
    discountPercent = 100;
  } else if (scholarshipType === 'sibling_discount') {
    label = 'حسم الإخوة المسجلين بالجامعة';
    discountPercent = 20;
  } else if (scholarshipType === 'social_aid') {
    label = 'إعفاء صندوق التكافل والرعاية الطلابية';
    discountPercent = 40;
  } else {
    discountPercent = 15;
  }

  const amount = Math.round((tuition * discountPercent) / 100);
  return {
    scholarshipType,
    label,
    discountPercent,
    baseTuition: tuition,
    amount,
    netPayable: Math.max(0, tuition - amount),
  };
}

/**
 * 6. شريط التتبع الحي للمعاملات ذو الـ 5 مراحل (Live 5-Stage Request Tracker)
 */
export function buildFiveStageRequestTracker(request, appointment = null) {
  const autoRejected = request.rejectedBy === 'auto' || request.rejected_by === 'auto';
  const status = request.status || 'review';
  const unitName = (request.unit && request.unit.name) || request.unit_name || 'عمادة الكلية / القسم المختص';
  const hasDoc = !!(request.document || request.doc_code);

  const stages = [
    {
      step: 1,
      key: 'submitted',
      title: 'تقديم الطلب والفحص الآلي',
      subtitle: autoRejected ? 'رفض آلي لمخالفة القواعد' : 'اجتاز قواعد الفحص الآلي',
      state: autoRejected ? 'fail' : 'done',
    },
    {
      step: 2,
      key: 'affairs_review',
      title: 'مراجعة شؤون الطلاب',
      subtitle: 'تدقيق البيانات والمرفقات',
      state: autoRejected ? 'pending' : status === 'review' && !request.unit ? 'cur' : 'done',
    },
    {
      step: 3,
      key: 'unit_endorsement',
      title: `اعتماد الجهة (${unitName})`,
      subtitle: request.unit ? `محال إلى: ${unitName}` : 'موافقة القسم المختص',
      state: autoRejected
        ? 'pending'
        : status === 'review' && request.unit
        ? 'cur'
        : status === 'approved'
        ? 'done'
        : status === 'rejected'
        ? 'fail'
        : 'pending',
    },
    {
      step: 4,
      key: 'registrar_pki',
      title: 'المسجل العام والتوقيع PKI',
      subtitle: hasDoc ? `صدرت الوثيقة (${request.document?.code || request.doc_code})` : 'إصدار الوثيقة الموقعة رقمياً',
      state: status === 'approved' ? 'done' : status === 'rejected' ? 'fail' : 'pending',
    },
    {
      step: 5,
      key: 'appointment_delivery',
      title: 'حجز الدور والتسليم النهائي',
      subtitle: appointment
        ? `تذكرة ${appointment.ticket_no || appointment.ticketNo} · ${appointment.appointment_date || appointment.appointmentDate} (${appointment.time_slot || appointment.timeSlot})`
        : status === 'approved'
        ? 'متاح للتنزيل الرقمي أو حجز موعد استلام'
        : 'بانتظار صدور القرار',
      state:
        appointment && (appointment.queue_status === 'completed' || appointment.queueStatus === 'completed')
          ? 'done'
          : appointment
          ? 'cur'
          : status === 'approved'
          ? 'done'
          : 'pending',
    },
  ];

  return stages;
}

/* ============================================================================
   3. خدمات القراءة والكتابة المتكاملة مع المنظومة (Integrated Service Methods)
   ============================================================================ */

// كل قائمة تُرسل أحدث سجلاتها فقط، والأعداد تُحسب من الجدول. الطالب يأتيه ما يخصه كاملاً
const LIST_MAX = 500;

export function getStudentAffairsSuiteOverview(deps, query = {}) {
  const { db } = deps;
  const own = query.ownOnly ? Number(query.studentId) : null;
  const scoped = (column, sqlBody, tail) => (own ? db.prepare(`${sqlBody} WHERE ${column} = ? ${tail}`).all(own) : db.prepare(`${sqlBody} ${tail} LIMIT ${LIST_MAX}`).all());
  const count = (sql) => Number(db.prepare(sql).get().c);

  // المقاعد المشغولة هي مقاعد دفعة هذه السنة فقط، لا طلاب كل السنوات
  const admissionYear = new Date().getFullYear();
  const defaultMinScore = Number(getSetting(db, 'students.admission_default_min_score')), defaultCapacity = Number(getSetting(db, 'students.admission_default_capacity'));
  const programs = db
    .prepare(`
      SELECT p.id, p.name, p.faculty, p.degree, p.years, p.admission_min_score, p.admission_capacity,
             (SELECT COUNT(*) FROM student_profiles sp WHERE sp.program_id = p.id AND sp.status = 'active' AND sp.enroll_year = ${admissionYear}) AS intakeStudents,
             (SELECT COUNT(*) FROM student_profiles sp WHERE sp.program_id = p.id AND sp.status = 'active') AS activeStudents
      FROM programs p
      WHERE p.active = 1
      ORDER BY p.id
    `)
    .all()
    .map((p) => ({
      ...p,
      minScore: p.admission_min_score ?? defaultMinScore,
      capacity: p.admission_capacity ?? defaultCapacity,
      enrolledCount: Number(p.intakeStudents),
    }));

  // الحقول المختلفة تبحث عن الطالب عند الكتابة، فلا تُرسل قائمة كل الطلاب مع كل فتح للقسم
  const STUDENT_SQL = `SELECT u.id, u.display_name AS name, u.student_no AS studentNo,
             sp.program_id AS programId, sp.study_level AS level, sp.status,
             p.name AS programName, p.faculty
      FROM users u
      JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN programs p ON p.id = sp.program_id
      WHERE u.role = 'student'`;
  const targetStudent = (Number(query.studentId) ? db.prepare(`${STUDENT_SQL} AND u.id = ?`).get(Number(query.studentId)) : null)
    ?? db.prepare(`${STUDENT_SQL} ORDER BY u.id LIMIT 1`).get() ?? null;
  const students = targetStudent ? [targetStudent] : [];

  const courses = db
    .prepare('SELECT id, program_id AS programId, name, code, hours, level, semester, instructor FROM courses WHERE active = 1 ORDER BY level, semester, id')
    .all();

  // 1. بيانات القبول والمفاضلة
  const applicants = own ? [] : db
    .prepare(`
      SELECT a.*,
             p1.name AS pref1Name, p2.name AS pref2Name, p3.name AS pref3Name,
             pa.name AS acceptedProgramName,
             u.student_no AS enrolledStudentNo
      FROM sa_applicants a
      LEFT JOIN programs p1 ON p1.id = a.pref1_program_id
      LEFT JOIN programs p2 ON p2.id = a.pref2_program_id
      LEFT JOIN programs p3 ON p3.id = a.pref3_program_id
      LEFT JOIN programs pa ON pa.id = a.accepted_program_id
      LEFT JOIN users u ON u.id = a.enrolled_student_id
      ORDER BY a.hs_score DESC, a.id DESC
      LIMIT ${LIST_MAX}
    `)
    .all();

  // 1-ب. بيانات معادلة المواد للطلاب المحولين
  const EQ_SQL = `SELECT eq.*, u.display_name AS studentName, u.student_no AS studentNo,
             c.name AS internalCourseName, c.code AS internalCourseCode, c.hours AS internalHours
      FROM sa_credit_equivalences eq
      LEFT JOIN users u ON u.id = eq.student_id
      LEFT JOIN courses c ON c.id = eq.internal_course_id`;
  const equivalences = scoped('eq.student_id', EQ_SQL, 'ORDER BY eq.id DESC');

  const targetStudentId = targetStudent?.id ?? 0;
  const studentEquivalences = db.prepare(`${EQ_SQL} WHERE eq.student_id = ? ORDER BY eq.id DESC`).all(targetStudentId);
  const equivalenceSummary = calculateTransferEquivalenceSummary(studentEquivalences, (targetStudent ? 132 : 132));

  // 2. شجرة الخطة الدراسية والمتطلبات السابقة للطالب المختار
  const targetCourses = targetStudent
    ? courses.filter((c) => c.programId === targetStudent.programId)
    : courses;
  const targetGrades = targetStudent
    ? db
        .prepare(`SELECT course_id AS courseId, course, mark AS total, CASE WHEN mark >= ${passSql(db, 'grades.student_id')} THEN 1 ELSE 0 END AS passed FROM grades WHERE student_id = ? AND workflow_status = 'approved'`)
        .all(targetStudent.id)
    : [];
  const prereqs = db.prepare('SELECT * FROM sa_course_prerequisites').all();
  const degreeTree = buildCoursePrerequisiteTree(
    targetCourses.length ? targetCourses : courses,
    targetGrades,
    prereqs,
    targetStudent?.level || 1
  );

  // 2-ب. نظام الإنذار الأكاديمي المبكر وجلسات الإرشاد
  const advisingWarnings = scoped('w.student_id', `SELECT w.*, u.display_name AS studentName, u.student_no AS studentNo,
             p.name AS programName
      FROM sa_advising_warnings w
      LEFT JOIN users u ON u.id = w.student_id
      LEFT JOIN student_profiles sp ON sp.user_id = w.student_id
      LEFT JOIN programs p ON p.id = sp.program_id`, 'ORDER BY w.id DESC');

  // رصد تلقائي للطلاب المعرضين للإنذار من جدول العلامات الفعلي
  // استعلام واحد بدل استعلام لكل طالب؛ ويُعرض الأضعف أولاً مع العدد الكلي
  const atRiskAll = own ? [] : db
    .prepare(`
      SELECT u.id, u.display_name AS name, u.student_no AS studentNo, g.hrs, g.weighted, g.failed
      FROM (SELECT student_id, SUM(COALESCE(hours, 3)) AS hrs, SUM(COALESCE(hours, 3) * mark) AS weighted, SUM(CASE WHEN mark < ${passSql(db, 'grades.student_id')} THEN 1 ELSE 0 END) AS failed
            FROM grades WHERE workflow_status = 'approved' GROUP BY student_id) g
      JOIN users u ON u.id = g.student_id
      JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.role = 'student'
    `)
    .all()
    .map((r) => {
      const hrs = Number(r.hrs), gpa = hrs ? Math.round((Number(r.weighted) / hrs) * 10) / 10 : null, failedCount = Number(r.failed);
      return { id: r.id, name: r.name, studentNo: r.studentNo, gpa, failedCount, isAtRisk: (gpa !== null && gpa < 65) || failedCount >= 1 };
    })
    .filter((x) => x.isAtRisk)
    .sort((a, b) => (a.gpa ?? 0) - (b.gpa ?? 0));
  const autoDetectedAtRisk = atRiskAll.slice(0, 100);

  // 3. حركات القيد والانضباط المسلكي (مدمجة مع student_holds و student_profiles)
  const lifecycleMovements = scoped('m.student_id', `SELECT m.*, u.display_name AS studentName, u.student_no AS studentNo,
             pf.name AS fromProgramName, pt.name AS toProgramName
      FROM sa_lifecycle_movements m
      LEFT JOIN users u ON u.id = m.student_id
      LEFT JOIN programs pf ON pf.id = m.from_program_id
      LEFT JOIN programs pt ON pt.id = m.to_program_id`, 'ORDER BY m.id DESC');
  // مراحل الاعتماد لكل حركة معروضة
  if (lifecycleMovements.length) {
    const stepRows = db.prepare(`SELECT movement_id, step_no, label, status, decided_by_name, decided_at, note FROM sa_movement_steps WHERE movement_id IN (${lifecycleMovements.map((m) => Number(m.id)).join(',')}) ORDER BY movement_id, step_no`).all();
    const byId = new Map();
    for (const s of stepRows) { if (!byId.has(s.movement_id)) byId.set(s.movement_id, []); byId.get(s.movement_id).push(s); }
    for (const m of lifecycleMovements) m.steps = byId.get(m.id) || [];
  }

  const disciplinaryRecords = scoped('h.student_id', `SELECT h.id AS holdId, h.student_id AS studentId, h.hold_type AS holdType, h.note, h.active, h.created_at AS createdAt,
             u.display_name AS studentName, u.student_no AS studentNo,
             d.committee_decision_no AS decisionNo, d.violation_category AS violationCategory,
             d.penalty_level AS penaltyLevel, d.blocks_documents AS blocksDocuments, d.expires_at AS expiresAt
      FROM student_holds h
      JOIN users u ON u.id = h.student_id
      LEFT JOIN sa_disciplinary_details d ON d.hold_id = h.id`, 'ORDER BY h.active DESC, h.id DESC');

  // 5. المنح والإعفاءات والرعاية الطلابية (مدمجة مع المالية fin_charges)
  const scholarships = scoped('s.student_id', `SELECT s.*, u.display_name AS studentName, u.student_no AS studentNo,
             p.name AS programName,
             c.status AS finChargeStatus
      FROM sa_scholarships s
      LEFT JOIN users u ON u.id = s.student_id
      LEFT JOIN student_profiles sp ON sp.user_id = s.student_id
      LEFT JOIN programs p ON p.id = sp.program_id
      LEFT JOIN fin_charges c ON c.id = s.fin_charge_id`, 'ORDER BY s.id DESC');

  // 6. مكتب خدمة الطالب الموحد والدور الذكي وتتبع المعاملات
  const appointments = scoped('a.student_id', `SELECT a.*, u.display_name AS studentName, u.student_no AS studentNo,
             r.no AS requestNo, r.status AS requestStatus, st.label AS serviceLabel
      FROM sa_desk_appointments a
      LEFT JOIN users u ON u.id = a.student_id
      LEFT JOIN requests r ON r.id = a.request_id
      LEFT JOIN service_types st ON st.code = r.service_code`, "ORDER BY CASE a.queue_status WHEN 'serving' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, a.id DESC");

  const totals = own ? {} : {
    applicants: count('SELECT COUNT(*) AS c FROM sa_applicants'),
    equivalences: count('SELECT COUNT(*) AS c FROM sa_credit_equivalences'),
    warnings: count('SELECT COUNT(*) AS c FROM sa_advising_warnings'),
    movements: count('SELECT COUNT(*) AS c FROM sa_lifecycle_movements'),
    disciplinary: count('SELECT COUNT(*) AS c FROM student_holds'),
    scholarships: count('SELECT COUNT(*) AS c FROM sa_scholarships'),
    appointments: count('SELECT COUNT(*) AS c FROM sa_desk_appointments'),
  };

  return {
    kpis: {
      totalApplicants: totals.applicants,
      acceptedApplicants: own ? 0 : count("SELECT COUNT(*) AS c FROM sa_applicants WHERE sorting_status IN ('accepted', 'enrolled')"),
      approvedEquivalences: own ? 0 : count("SELECT COUNT(*) AS c FROM sa_credit_equivalences WHERE equivalence_status = 'approved'"),
      activeWarnings: own ? 0 : count("SELECT COUNT(*) AS c FROM sa_advising_warnings WHERE status <> 'resolved'"),
      lifecycleMovementsCount: totals.movements,
      activeHoldsCount: own ? 0 : count('SELECT COUNT(*) AS c FROM student_holds WHERE active = 1'),
      activeScholarshipsCount: own ? 0 : count("SELECT COUNT(*) AS c FROM sa_scholarships WHERE status = 'active'"),
      totalScholarshipAmount: own ? 0 : Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS c FROM sa_scholarships WHERE status = 'active'").get().c),
      waitingTicketsCount: own ? 0 : count("SELECT COUNT(*) AS c FROM sa_desk_appointments WHERE queue_status = 'waiting'"),
      servingTicketsCount: own ? 0 : count("SELECT COUNT(*) AS c FROM sa_desk_appointments WHERE queue_status = 'serving'"),
    },
    totals,
    listMax: LIST_MAX,
    programs,
    students,
    courses,
    targetStudent,
    admissions: {
      applicants,
      equivalences,
      equivalenceSummary,
    },
    advising: {
      degreeTree,
      warnings: advisingWarnings,
      autoDetectedAtRisk,
      atRiskTotal: atRiskAll.length,
    },
    lifecycle: {
      movements: lifecycleMovements,
      disciplinaryRecords,
      statuses: STATUS_LABEL,
    },
    scholarships: {
      list: scholarships,
    },
    deskQueue: {
      appointments,
    },
  };
}

const LINK_PERMS = ['course:manage', 'sa_advising:edit'];
// ربط مقررين في الخطة: المتطلب يجتازه الطالب قبل المقرر، ولا تُقبل حلقة تجعل مقرراً شرطاً لنفسه
function addCoursePrerequisite({ db }, actor, body, ip) {
  requireSuitePerm(actor, ...LINK_PERMS);
  const courseId = Number(body?.courseId), prereqId = Number(body?.prereqCourseId), minMark = body?.minMark === undefined || body?.minMark === '' ? 60 : Number(body.minMark);
  if (!Number.isInteger(minMark) || minMark < 0 || minMark > 100) throw new HttpError(400, 'علامة الاجتياز عدد صحيح بين 0 و100.', 'validation');
  const pick = db.prepare('SELECT id, name, program_id FROM courses WHERE id = ?');
  const course = pick.get(courseId), prereq = pick.get(prereqId);
  if (!course || !prereq) throw new HttpError(400, 'اختر مقررين موجودين.', 'validation');
  if (course.id === prereq.id) throw new HttpError(400, 'لا يكون المقرر متطلباً لنفسه.', 'validation');
  if (course.program_id !== prereq.program_id) throw new HttpError(400, 'المقرران من برنامجين مختلفين.', 'validation');
  if (db.prepare('SELECT 1 AS x FROM sa_course_prerequisites WHERE course_id = ? AND prereq_course_id = ?').get(course.id, prereq.id)) throw new HttpError(409, 'هذا الربط موجود.', 'conflict');
  // هل يصل المتطلب إلى المقرر عبر الروابط الحالية؟
  const edges = db.prepare('SELECT course_id, prereq_course_id FROM sa_course_prerequisites').all(), stack = [prereq.id], seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === course.id) throw new HttpError(409, 'هذا الربط يصنع حلقة: كل مقرر يصبح شرطاً للآخر.', 'cycle');
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (Number(e.course_id) === cur) stack.push(Number(e.prereq_course_id));
  }
  const id = Number(db.prepare('INSERT INTO sa_course_prerequisites (course_id, prereq_course_id, min_mark) VALUES (?,?,?)').run(course.id, prereq.id, minMark).lastInsertRowid);
  audit(db, actor, 'ربط مقررين في الخطة الدراسية', `${prereq.name} ← ${course.name}`.slice(0, 100), ip);
  return { id };
}
function removeCoursePrerequisite({ db }, actor, id, ip) {
  requireSuitePerm(actor, ...LINK_PERMS);
  const link = db.prepare('SELECT * FROM sa_course_prerequisites WHERE id = ?').get(Number(id));
  if (!link) throw new HttpError(404, 'الربط غير موجود.', 'not_found');
  db.prepare('DELETE FROM sa_course_prerequisites WHERE id = ?').run(link.id);
  audit(db, actor, 'إزالة ربط مقررين في الخطة الدراسية', String(link.id), ip);
  return { ok: true };
}

// تجاوز المدير لا يشمل صلاحيات حُجبت عنه بفصل المهام
const adminBypass = (actor, perms) => actor.role === 'admin' && !perms.every((p) => SOD_SENSITIVE_PERMISSIONS.has(p) && !actor.can?.(p));

function requireSuitePerm(actor, ...perms) {
  if (!actor || (!adminBypass(actor, perms) && !perms.some((p) => actor.can?.(p)))) {
    throw new HttpError(403, 'لا تملك صلاحية تنفيذ هذا الإجراء.', 'forbidden');
  }
}

const DESK_MANAGE = ['sa_scholarships:write', 'sa_scholarships:approve', 'request:decide', 'student:update'];
const SUITE_READ = ['sa_lifecycle:dean', 'sa_lifecycle:final', 'finance:fees', 'lms_lib:approve', 'request:read_all', 'request:read_unit', 'student:read', 'student:register', 'sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve', 'sa_advising:view', 'sa_advising:edit', 'sa_scholarships:view', 'sa_scholarships:write', 'sa_scholarships:approve'];

// نسخة الطالب من النظرة الشاملة: بياناته فقط، بلا متقدمين ولا أرقام وطنية ولا سجلات زملائه
function studentOverview(data, studentId) {
  const own = (rows, key = 'student_id') => rows.filter((x) => Number(x[key]) === Number(studentId));
  return {
    ...data,
    kpis: {},
    students: own(data.students, 'id'),
    targetStudent: Number(data.targetStudent?.id) === Number(studentId) ? data.targetStudent : null,
    admissions: { applicants: [], equivalences: own(data.admissions.equivalences), equivalenceSummary: data.admissions.equivalenceSummary },
    advising: { degreeTree: data.advising.degreeTree, warnings: own(data.advising.warnings), autoDetectedAtRisk: [], atRiskTotal: 0 },
    lifecycle: { ...data.lifecycle, movements: own(data.lifecycle.movements), disciplinaryRecords: own(data.lifecycle.disciplinaryRecords, 'studentId') },
    scholarships: { list: own(data.scholarships.list) },
    deskQueue: { appointments: own(data.deskQueue.appointments) },
  };
}

// كل قسم من النظرة الشاملة لا يصل إلا لمن يملك صلاحية قراءته، بالقوائم نفسها التي تُظهر تبويبه
const SECTION_READ = {
  admissions: ['sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve', 'student:register'],
  advising: ['sa_advising:view', 'sa_advising:edit', 'faculty:manage'],
  lifecycle: ['sa_lifecycle:view', 'student:update'],
  discipline: ['sa_discipline:view', 'holds:manage'],
  scholarships: ['sa_scholarships:view', 'sa_scholarships:write', 'sa_scholarships:approve', 'finance:fees'],
  desk: ['sa_desk:view', 'sa_scholarships:write', 'student:update', 'request:read_all', 'request:decide', 'sa_scholarships:approve'],
};
const canRead = (actor, perms) => !!actor && (adminBypass(actor, perms) || perms.some((p) => actor.can?.(p)));

function staffOverview({ db }, data, actor) {
  const see = Object.fromEntries(Object.entries(SECTION_READ).map(([k, perms]) => [k, canRead(actor, perms)]));
  const studentData = Object.values(see).some(Boolean) || canRead(actor, ['student:read']);
  const t = data.totals || {};
  return {
    ...data,
    access: see,
    kpis: { ...data.kpis, totalScholarshipAmount: see.scholarships ? data.kpis.totalScholarshipAmount : 0 },
    totals: { ...t, applicants: see.admissions ? t.applicants : 0, equivalences: see.admissions ? t.equivalences : 0, warnings: see.advising ? t.warnings : 0, movements: see.lifecycle ? t.movements : 0, disciplinary: see.discipline ? t.disciplinary : 0, scholarships: see.scholarships ? t.scholarships : 0, appointments: see.desk ? t.appointments : 0 },
    students: studentData ? data.students : [],
    targetStudent: studentData ? data.targetStudent : null,
    admissions: see.admissions
      ? { ...data.admissions, enrollOptions: { governorates: getSetting(db, 'students.governorates'), relations: getSetting(db, 'students.relations') } }
      : { ...data.admissions, applicants: [], equivalences: [] },
    advising: see.advising ? data.advising : { ...data.advising, degreeTree: buildCoursePrerequisiteTree(), warnings: [], autoDetectedAtRisk: [], atRiskTotal: 0 },
    lifecycle: { ...data.lifecycle, myQueue: movementQueue(db, actor), maxPostponementYears: Number(getSetting(db, 'students.max_postponement_years')), movements: see.lifecycle ? data.lifecycle.movements : [], disciplinaryRecords: see.discipline ? data.lifecycle.disciplinaryRecords : [] },
    scholarships: see.scholarships ? data.scholarships : { ...data.scholarships, list: [] },
    deskQueue: see.desk ? data.deskQueue : { ...data.deskQueue, appointments: [] },
  };
}

/* ---------- 1. عمليات القبول والمفاضلة والمعادلة ---------- */

function addAdmissionApplicant({ db }, actor, body, ip) {
  requireSuitePerm(actor, 'sa_admissions:write', 'sa_admissions:approve', 'student:register');
  const fullName = String(body?.fullName || '').trim();
  const nationalId = String(body?.nationalId || '').trim();
  const hsScore = Number(body?.hsScore);
  const pref1 = Number(body?.pref1ProgramId);
  if (!fullName || !nationalId || !Number.isFinite(hsScore) || hsScore <= 0 || !pref1) {
    throw new HttpError(400, 'يرجى إدخال اسم المتقدم، الرقم الوطني، مجموع الثانوية، والرغبة الأولى.', 'validation');
  }
  const nextId = nextNumber(db, 'sa_applicants', 'SELECT MAX(id) FROM sa_applicants');
  const appNo = `ADM-${new Date().getFullYear()}-${String(100 + nextId).padStart(4, '0')}`;
  const category = ['general', 'parallel', 'martyrs', 'transfer'].includes(body?.category) ? body.category : 'general';
  const hsType = String(body?.hsType || 'علمي').trim();
  const phone = String(body?.phone || '').trim() || null;
  const pref2 = body?.pref2ProgramId ? Number(body.pref2ProgramId) : null;
  const pref3 = body?.pref3ProgramId ? Number(body.pref3ProgramId) : null;

  const info = db
    .prepare(`
      INSERT INTO sa_applicants (application_no, full_name, national_id, phone, hs_type, hs_score, hs_year, category, pref1_program_id, pref2_program_id, pref3_program_id, sorting_status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `)
    .run(appNo, fullName, nationalId, phone, hsType, hsScore, new Date().getFullYear(), category, pref1, pref2, pref3, String(body?.notes || '').slice(0, 200), Date.now());

  audit(db, actor, 'تسجيل متقدم للمفاضلة الجامعية', `${appNo} — ${fullName}`, ip);
  return { id: Number(info.lastInsertRowid), applicationNo: appNo };
}

// خطة القبول لكل برنامج: الفراغ يعيد البرنامج إلى القيم الافتراضية في الإعدادات
export function saveProgramAdmissionPlan({ db }, actor, id, body, ip) {
  requireSuitePerm(actor, 'sa_admissions:approve');
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const minScore = num(body?.minScore), capacity = num(body?.capacity);
  if (minScore !== null && !(minScore > 0 && minScore <= 1000)) throw new HttpError(400, 'الحد الأدنى غير صالح.', 'validation');
  if (capacity !== null && !(Number.isInteger(capacity) && capacity >= 0 && capacity <= 100000)) throw new HttpError(400, 'عدد المقاعد غير صالح.', 'validation');
  const res = db.prepare('UPDATE programs SET admission_min_score = ?, admission_capacity = ? WHERE id = ?').run(minScore, capacity, Number(id));
  if (!res.changes) throw new HttpError(404, 'البرنامج غير موجود.', 'not_found');
  audit(db, actor, 'تعديل خطة قبول برنامج', `#${id}: حد أدنى ${minScore ?? 'افتراضي'} / مقاعد ${capacity ?? 'افتراضي'}`, ip);
  return { ok: true };
}

export function executeAdmissionsSorting(deps, actor, ip) {
  requireSuitePerm(actor, 'sa_admissions:approve');
  const { db } = deps;
  const overview = getStudentAffairsSuiteOverview(deps);
  const apps = db.prepare('SELECT * FROM sa_applicants').all();
  const sorted = runAutomatedAdmissionsSort(apps, overview.programs);

  const upd = db.prepare('UPDATE sa_applicants SET sorting_status = ?, accepted_program_id = ? WHERE id = ? AND sorting_status NOT IN (\'enrolled\', \'enrolling\')');
  for (const res of sorted) {
    if (res.status !== 'enrolled') {
      upd.run(res.status, res.acceptedProgramId, res.id);
    }
  }
  audit(db, actor, 'تشغيل محرك الفرز الآلي للمفاضلة الجامعية', `${sorted.length} متقدماً`, ip);
  return { sortedCount: sorted.length, results: sorted };
}

// البيانات الشخصية يدخلها الموظف من وثائق المتقدم؛ ما لا يصل منها يرفضه تحقق ملف الطالب بدل اختلاق قيمة
export async function enrollAcceptedApplicant(deps, actor, applicantId, body, ip) {
  requireSuitePerm(actor, 'sa_admissions:approve');
  const { db } = deps;
  const app = db.prepare('SELECT * FROM sa_applicants WHERE id = ?').get(Number(applicantId));
  if (!app) throw new HttpError(404, 'طلب المفاضلة غير موجود.', 'not_found');
  if (app.sorting_status === 'enrolled' && app.enrolled_student_id) {
    throw new HttpError(409, 'تم تثبيت تسجيل هذا المتقدم مسبقاً كطالب نظامي.', 'conflict');
  }
  if (app.sorting_status !== 'accepted' || !app.accepted_program_id) {
    throw new HttpError(409, 'لا يُثبَّت إلا متقدم مقبول بنتيجة الفرز.', 'conflict');
  }
  const programId = app.accepted_program_id;
  const input = (k) => String(body?.[k] ?? '').trim();
  const parts = String(app.full_name).trim().split(/\s+/);
  const firstName = input('first_name') || parts[0] || '';
  const fatherName = input('father_name') || (parts.length > 2 ? parts[1] : '');
  const lastName = input('last_name') || (parts.length > 1 ? parts[parts.length - 1] : '');

  // القوائم المعتمدة في الإعدادات يمكن للمدير تعديلها؛ لذا نطابق قيمة المتقدم معها بدل تمرير نص ثابت يرفضه التحقق («قيمة غير صالحة»)
  const norm = (x) => String(x ?? '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[()\-–—/،,]/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = (list, hints, fallback) => {
    const items = Array.isArray(list) ? list : [];
    const hs = hints.map(norm).filter(Boolean);
    for (const h of hs) { const e = items.find((i) => norm(i) === h); if (e) return e; }
    for (const h of hs) { const e = items.find((i) => norm(i).includes(h) || h.includes(norm(i))); if (e) return e; }
    return items.find((i) => norm(i) === norm(fallback)) ?? items.find((i) => norm(i) === 'اخرى') ?? items[0] ?? fallback;
  };
  const admissionHints = {
    general: ['القبول العام', 'مفاضلة'], parallel: ['موازي'], martyrs: ['القبول العام', 'مفاضلة'], transfer: ['نقل', 'انتقال'],
  };
  const hsList = getSetting(db, 'students.hs_types'), admList = getSetting(db, 'students.admissions');
  const hsRaw = String(app.hs_type || 'علمي');
  const hsHints = /ادب/.test(norm(hsRaw)) ? [hsRaw, 'الفرع الادبي'] : /(علم)/.test(norm(hsRaw)) ? [hsRaw, 'الفرع العلمي'] : [hsRaw];

  const regInput = {
    first_name: firstName,
    father_name: fatherName,
    last_name: lastName,
    mother_name: input('mother_name'),
    national_id: String(app.national_id),
    gender: input('gender'),
    birth_date: input('birth_date'),
    birth_place: input('birth_place'),
    nationality: input('nationality'),
    marital_status: input('marital_status'),
    phone: input('phone') || app.phone || '',
    governorate: input('governorate'),
    city: input('city'),
    address: input('address'),
    hs_type: pick(hsList, hsHints, 'أخرى'),
    hs_year: Number(app.hs_year || 2025),
    hs_score: Number(app.hs_score || 200),
    program_id: programId,
    admission_type: pick(admList, admissionHints[app.category] || ['القبول العام'], 'أخرى'),
    enroll_year: new Date().getFullYear(),
    enroll_term: 'الفصل الأول',
    study_level: 1,
    guardian_name: input('guardian_name'),
    guardian_relation: input('guardian_relation'),
    guardian_phone: input('guardian_phone'),
    notes: `ثُبِّت قبوله آلياً من بوابة المفاضلة رقم ${app.application_no}`,
  };

  // حجز ذري: ضغطتان متزامنتان لا تنشئان طالبين، والفشل يعيد المتقدم إلى حالته
  const claim = db.prepare("UPDATE sa_applicants SET sorting_status = 'enrolling' WHERE id = ? AND sorting_status = 'accepted'").run(app.id);
  if (!claim.changes) throw new HttpError(409, 'يجري تثبيت هذا المتقدم أو ثُبّت مسبقاً.', 'conflict');
  let created;
  try {
    created = await registerStudent(deps, actor, regInput, ip);
  } catch (e) {
    db.prepare("UPDATE sa_applicants SET sorting_status = 'accepted' WHERE id = ? AND sorting_status = 'enrolling'").run(app.id);
    throw e;
  }
  db.prepare("UPDATE sa_applicants SET sorting_status = 'enrolled', accepted_program_id = ?, enrolled_student_id = ? WHERE id = ?")
    .run(programId, created.student.id, app.id);

  audit(db, actor, 'تثبيت قبول متقدم وتسجيله كطالب نظامي', `${app.application_no} -> ${created.student.studentNo}`, ip);
  return { applicantId: app.id, student: created.student, credentials: created.credentials, followUp: admissionFollowUp(deps, actor, created.student, programId, ip) };
}

const unitStaff = (db, codes) => db.prepare(`SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE u.active = 1 AND o.code IN (${codes.map(() => '?').join(',')})`).all(...codes).map((u) => u.id);
const notifyStaff = (db, ids, kind, ref, text) => { const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"), now = Date.now(); for (const id of new Set(ids)) ins.run(id, kind, ref, text, now); };

// بعد تثبيت القبول: فاتورة من هيكل رسوم البرنامج، وتنبيه مكتب الوثائق لإصدار البطاقة المطبوعة (الرقمية متاحة فوراً).
// تعذّر الفاتورة لا يلغي القبول؛ تُبلَّغ المالية لتصدرها يدوياً
function admissionFollowUp(deps, actor, student, programId, ip) {
  const { db } = deps, out = { invoiceCount: 0, invoiceNote: '' }, who = `${student.name ?? ''} (${student.studentNo})`;
  notifyStaff(db, unitStaff(db, ['of_docs']), 'card_needed', Number(student.id), `طالب جديد بحاجة إلى إصدار بطاقة جامعية: ${who}.`);
  if (!getSetting(db, 'academic.auto_invoice_on_admission')) return out;
  const year = academicYear();
  const fee = db.prepare("SELECT total_fee FROM fin_fee_structures WHERE program_id = ? AND REPLACE(academic_year, '-', '/') = ? ORDER BY semester, id LIMIT 1").get(programId, year);
  if (!(Number(fee?.total_fee) > 0)) { out.invoiceNote = 'لا يوجد هيكل رسوم لهذا البرنامج في العام الحالي.'; }
  else {
    try {
      const due = new Date(Date.now() + Number(getSetting(db, 'academic.admission_invoice_days')) * 86400000).toISOString().slice(0, 10);
      out.invoiceCount = createStudentInvoice(deps, actor, { studentId: student.id, academicYear: year, totalAmount: Number(fee.total_fee), installmentsCount: 1, firstDueDay: due }, ip).count;
    } catch (e) { out.invoiceNote = e.message; }
  }
  if (out.invoiceNote) notifyStaff(db, unitStaff(db, ['finance']), 'invoice_needed', Number(student.id), `تعذّر إصدار فاتورة الطالب الجديد ${who}: ${out.invoiceNote}`);
  return out;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const isIsoDay = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
// قيمة من 0 إلى 100: الصفر قيمة صحيحة، والفارغ غير الصفر
const blank = (v) => v === undefined || v === null || v === '';
function optionalPercent(v, label) {
  if (blank(v)) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `${label}: قيمة من 0 إلى 100.`, 'validation');
  return n;
}
function requiredPercent(v, label) {
  if (blank(v)) throw new HttpError(400, `${label} مطلوبة.`, 'validation');
  return optionalPercent(v, label);
}

export function addTransferEquivalence({ db }, actor, body, ip) {
  if (!actor || (actor.role !== 'admin' && !actor.can?.('course:manage') && !actor.can?.('sa_admissions:approve'))) {
    throw new HttpError(403, 'لا تملك صلاحية اعتماد معادلة المقررات (يتطلب صلاحية course:manage أو sa_admissions:approve).', 'forbidden');
  }
  const studentId = Number(body?.studentId);
  const internalCourseId = Number(body?.internalCourseId);
  const sourceUniversity = String(body?.sourceUniversity || '').trim();
  const externalCourseCode = String(body?.externalCourseCode || '').trim();
  const externalCourseName = String(body?.externalCourseName || '').trim();
  const externalHours = Number(body?.externalHours);
  const externalMark = requiredPercent(body?.externalMark, 'علامة المقرر الخارجي');

  if (!studentId || !internalCourseId || !sourceUniversity || !externalCourseName) {
    throw new HttpError(400, 'يرجى تحديد الطالب، الجامعة المصدر، اسم المقرر الخارجي، والمقرر المقابل في الخطة.', 'validation');
  }
  if (!Number.isInteger(externalHours) || externalHours < 1 || externalHours > 12) throw new HttpError(400, 'ساعات المقرر الخارجي مطلوبة (من 1 إلى 12).', 'validation');
  if (!db.prepare('SELECT 1 AS x FROM student_profiles WHERE user_id = ?').get(studentId)) throw new HttpError(404, 'ملف الطالب غير موجود.', 'not_found');
  if (!db.prepare('SELECT 1 AS x FROM courses WHERE id = ?').get(internalCourseId)) throw new HttpError(400, 'المقرر المقابل غير موجود.', 'validation');

  return withLock(db, `equivalence:${studentId}:${internalCourseId}`, () => {
    if (db.prepare("SELECT 1 AS x FROM sa_credit_equivalences WHERE student_id = ? AND internal_course_id = ? AND equivalence_status = 'pending'").get(studentId, internalCourseId)) {
      throw new HttpError(409, 'توجد معادلة لهذا المقرر قيد الاعتماد.', 'conflict');
    }
    const info = db
      .prepare(`
        INSERT INTO sa_credit_equivalences (student_id, source_university, external_course_code, external_course_name, external_hours, external_mark, internal_course_id, equivalence_status, note, created_at, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `)
      .run(studentId, sourceUniversity, externalCourseCode || '—', externalCourseName, externalHours, externalMark, internalCourseId, String(body?.note || '').slice(0, 200) || null, Date.now(), actor.id ?? null);
    audit(db, actor, 'إدخال معادلة مقرر لطالب محول بانتظار الاعتماد', `${externalCourseName} -> #${internalCourseId}`, ip);
    return { id: Number(info.lastInsertRowid), status: 'pending' };
  });
}

// اعتماد المعادلة أو رفضها: من شخص غير مدخلها، والعلامة تُرصد عند الاعتماد فقط
export function decideTransferEquivalence({ db }, actor, id, body, ip) {
  if (!actor || (actor.role !== 'admin' && !actor.can?.('course:manage') && !actor.can?.('sa_admissions:approve'))) {
    throw new HttpError(403, 'لا تملك صلاحية اعتماد معادلة المقررات (يتطلب صلاحية course:manage أو sa_admissions:approve).', 'forbidden');
  }
  const decision = String(body?.decision || ''), note = String(body?.note ?? '').trim().slice(0, 200);
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'القرار غير معروف.', 'validation');
  if (decision === 'reject' && note.length < 3) throw new HttpError(400, 'سبب الرفض مطلوب (3 أحرف على الأقل).', 'validation');
  return withLock(db, `equivalence-decide:${Number(id)}`, () => {
    const e = db.prepare('SELECT * FROM sa_credit_equivalences WHERE id = ?').get(Number(id));
    if (!e) throw new HttpError(404, 'المعادلة غير موجودة.', 'not_found');
    if (e.equivalence_status !== 'pending') throw new HttpError(409, 'تم البت في هذه المعادلة مسبقاً.', 'conflict');
    if (e.created_by_id && Number(e.created_by_id) === Number(actor.id)) throw new HttpError(403, 'لا يعتمد المعادلة من أدخلها (فصل المهام).', 'forbidden');
    const now = Date.now(), status = decision === 'approve' ? 'approved' : 'rejected';
    db.prepare('UPDATE sa_credit_equivalences SET equivalence_status = ?, decided_by = ?, decided_by_id = ?, decided_at = ?, note = COALESCE(?, note) WHERE id = ?')
      .run(status, actorName(actor, 'لجنة المعادلة'), actor.id ?? null, now, note || null, e.id);
    if (decision === 'approve') {
      const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(e.internal_course_id);
      if (course && !db.prepare('SELECT id FROM grades WHERE student_id = ? AND course_id = ?').get(e.student_id, e.internal_course_id)) {
        db.prepare(`
          INSERT INTO grades (student_id, course_id, course, term, hours, mark, theory_mark, practical_mark, academic_year, semester, level, workflow_status, entered_by, entered_at, approved_by, approved_at)
          VALUES (?, ?, ?, 'الفصل الأول', ?, ?, ?, NULL, 'معادلة نقل', ?, ?, 'approved', ?, ?, ?, ?)
        `).run(e.student_id, course.id, course.name, course.hours || e.external_hours, e.external_mark, e.external_mark, course.semester || 1, course.level || 1, e.created_by_id ?? actor.id, e.created_at, actor.id, now);
      }
    }
    audit(db, actor, decision === 'approve' ? 'اعتماد معادلة مقرر لطالب محول' : 'رفض معادلة مقرر لطالب محول', `${e.external_course_name} -> #${e.internal_course_id}`, ip);
    return { id: e.id, status };
  });
}

/* ---------- 2. عمليات الإرشاد الأكاديمي والإنذار المبكر ---------- */

export function createAdvisingSession({ db }, actor, body, ip) {
  requireSuitePerm(actor, 'sa_advising:edit');
  const studentId = Number(body?.studentId);
  const warningType = ['gpa_low', 'repeated_fail', 'absence_high'].includes(body?.warningType) ? body.warningType : 'gpa_low';
  const severity = ['warning', 'critical', 'probation'].includes(body?.severity) ? body.severity : 'warning';
  const actionPlan = String(body?.actionPlan || '').trim();
  if (!studentId || !actionPlan) {
    throw new HttpError(400, 'يرجى اختيار الطالب وكتابة الخطة العلاجية والتوصية الإرشادية.', 'validation');
  }
  if (!db.prepare('SELECT 1 AS x FROM student_profiles WHERE user_id = ?').get(studentId)) throw new HttpError(404, 'ملف الطالب غير موجود.', 'not_found');
  // ما لم يُدخله المرشد يُحسب من علامات الطالب المعتمدة؛ وما لا مصدر له (الغياب) يبقى فارغاً
  const passMark = Number(passMarkFor(db, studentId));
  const real = db.prepare("SELECT SUM(mark * hours) AS w, SUM(hours) AS h, SUM(CASE WHEN mark < ? THEN 1 ELSE 0 END) AS failed FROM grades WHERE student_id = ? AND workflow_status = 'approved' AND mark IS NOT NULL").get(passMark, studentId);
  const gpaSnapshot = optionalPercent(body?.gpaSnapshot, 'المعدل') ?? (Number(real.h) > 0 ? Math.round((Number(real.w) / Number(real.h)) * 100) / 100 : null);
  const absenceRate = optionalPercent(body?.absenceRate, 'نسبة الغياب') ?? null;
  const failedGiven = body?.failedCoursesCount;
  const failedCount = failedGiven === undefined || failedGiven === null || failedGiven === '' ? Number(real.failed ?? 0) : Number(failedGiven);
  if (!Number.isInteger(failedCount) || failedCount < 0) throw new HttpError(400, 'عدد المقررات الراسبة غير صالح.', 'validation');
  const advisorName = String(body?.advisorName || actor.display_name || actor.name || 'المرشد الأكاديمي').trim();
  const sessionDate = String(body?.sessionDate || new Date().toISOString().slice(0, 10));

  const info = db
    .prepare(`
      INSERT INTO sa_advising_warnings (student_id, warning_type, severity, gpa_snapshot, absence_rate, failed_courses_count, advisor_name, action_plan, session_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `)
    .run(studentId, warningType, severity, gpaSnapshot, absenceRate, failedCount, advisorName, actionPlan, sessionDate, Date.now());

  audit(db, actor, 'توثيق جلسة إرشاد أكاديمي وإنذار مبكر', `طالب #${studentId} (${warningType})`, ip);
  return { id: Number(info.lastInsertRowid) };
}

function resolveAdvisingWarning({ db }, actor, id, ip) {
  requireSuitePerm(actor, 'sa_advising:edit');
  const res = db
    .prepare("UPDATE sa_advising_warnings SET status = 'resolved' WHERE id = ?")
    .run(Number(id));
  if (!res.changes) throw new HttpError(404, 'سجل الإنذار الإرشادي غير موجود.', 'not_found');
  audit(db, actor, 'إغلاق متابعة إنذار أكاديمي بعد تحسن الأداء', `#${id}`, ip);
  return { ok: true };
}

/* ---------- 3. أتمتة حركات الوضع الطلابي وسجل الانضباط ---------- */

export const LIFECYCLE_STATUS = {
  postponement: 'suspended',
  suspension: 'suspended',
  withdrawal: 'withdrawn',
  reinstatement: 'active',
  program_transfer: 'active',
  disciplinary_suspension: 'suspended',
  dismissal: 'withdrawn',
  graduation: 'graduated',
};
export const LIFECYCLE_IMPACT = {
  postponement: {
    fin: 'تجميد وتدوير رسوم الفصل المؤجل دون غرامة مالية',
    acad: 'إيقاف التسجيل للفصل الحالي وعدم احتسابه من المدة القصوى',
  },
  suspension: {
    fin: 'وقف المطالبات المالية للفصول الموقوفة',
    acad: 'تعليق القيد والبطاقة الجامعية لحين تقديم طلب إعادة قيد',
  },
  withdrawal: {
    fin: 'تسوية الذمة المالية وإغلاق حساب الرسوم',
    acad: 'طي قيد الطالب وإصدار وثيقة انسحاب رسمية',
  },
  reinstatement: {
    fin: 'إعادة تفعيل الرسوم الفصلية الاعتيادية',
    acad: 'تفعيل حالة القيد (مقيَّد) وفتح التسجيل الأكاديمي',
  },
  program_transfer: {
    fin: 'احتساب فرق الساعة المعتمدة للبرنامج الجديد',
    acad: 'نقل قيد الطالب للبرنامج الجديد مع معادلة المقررات المشتركة',
  },
  disciplinary_suspension: {
    fin: 'مراجعة رسوم فصل الحرمان بقرار لجنة الانضباط',
    acad: 'حرمان الطالب من الفصل وتعليق قيده بقرار لجنة الانضباط',
  },
  graduation: {
    fin: 'تسوية الذمة المالية قبل منح وثيقة التخرج',
    acad: 'إنهاء متطلبات الخطة ومنح وثيقة التخرج',
  },
  dismissal: {
    fin: 'تسوية الذمة المالية المترتبة على الفصل النهائي',
    acad: 'طي قيد الطالب بقرار الفصل النهائي من لجنة الانضباط',
  },
};

// الحالات التي تصح منها كل حركة: لا يُعاد قيد خريج ولا ينسحب منسحب مرة ثانية
export const LIFECYCLE_FROM = {
  postponement: ['active'],
  suspension: ['active'],
  withdrawal: ['active', 'suspended'],
  reinstatement: ['suspended', 'withdrawn'],
  program_transfer: ['active'],
  disciplinary_suspension: ['active'],
  dismissal: ['active', 'suspended'],
  graduation: ['active'],
};
// هاتان الحركتان تنشآن من قرار لجنة الانضباط فقط، لا من نموذج حركات القيد
const PENALTY_MOVEMENT = { term_suspension: 'disciplinary_suspension', dismissal: 'dismissal' };
const PENALTY_ONLY = Object.values(PENALTY_MOVEMENT);
const SEMESTERS_PER_YEAR = 2;
// المستهلك يشمل الحركات المعلقة، فلا يتجاوز الطلاب الحد بطلبات متتالية قبل صدور القرار
const usedPostponementSemesters = (db, studentId, excludeId = 0) => Number(db.prepare("SELECT COALESCE(SUM(duration_semesters), 0) AS c FROM sa_lifecycle_movements WHERE student_id = ? AND movement_type = 'postponement' AND status IN ('approved', 'pending') AND id <> ?").get(studentId, excludeId).c);

/* مراحل الاعتماد. ترقين القيد يبدأ ببراءات الذمة ثم العميد ثم القرار النهائي؛ وبقية الحركات عميد ثم قرار نهائي.
   sod: لا يعتمدها من قدّم الحركة. scoped: حامل الصلاحية المقيد بكلية لا يعتمد إلا طلابها. */
const STEPS = {
  clearance_finance: { label: 'براءة ذمة: الشؤون المالية', perms: ['finance:fees'] },
  clearance_library: { label: 'براءة ذمة: المكتبة', perms: ['lms_lib:approve'] },
  clearance_labs: { label: 'براءة ذمة: المخابر (إن وجدت)', perms: ['student:update'], allowNa: true },
  dean: { label: 'موافقة عميد الكلية أو مجلس الكلية', perms: ['sa_lifecycle:dean'], sod: true, scoped: true },
  president: { label: 'القرار النهائي: رئيس الجامعة أو نائبه لشؤون الطلاب', perms: ['sa_lifecycle:final'], sod: true },
};
const CLEARANCES = ['clearance_finance', 'clearance_library', 'clearance_labs'];
const chainFor = (movementType) => (['withdrawal', 'graduation'].includes(movementType) ? [...CLEARANCES, 'dean', 'president'] : ['dean', 'president']);
const actorName = (actor, fallback) => actor.display_name || actor.name || actor.label || fallback;
const lockStudent = (db, studentId) => db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`lifecycle:${studentId}`);

// يتحقق أن الحركة تصح الآن؛ يُستدعى عند التقديم وعند القرار النهائي لأن حال الطالب قد تتغير بينهما
function movementPlan(db, { studentId, movementType, toProgramId, durationSemesters }, excludeId = 0) {
  if (!LIFECYCLE_STATUS[movementType]) throw new HttpError(400, 'نوع حركة القيد غير معروف.', 'validation');
  const prof = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(studentId);
  if (!prof) throw new HttpError(404, 'ملف الطالب غير موجود.', 'not_found');
  if (!LIFECYCLE_FROM[movementType].includes(prof.status)) {
    throw new HttpError(409, `لا تصح هذه الحركة لطالب حالة قيده «${STATUS_LABEL[prof.status] ?? prof.status}».`, 'conflict');
  }
  // شروط التخرج تُفحص عند التقديم وعند القرار النهائي
  if (movementType === 'graduation') {
    const blockers = graduationBlockers(db, studentId);
    if (blockers.length) throw new HttpError(409, `لا تتحقق شروط التخرج: ${blockers.join(' ')}`, 'graduation_blocked');
  }
  const duration = movementType === 'postponement' ? Number(durationSemesters ?? 1) : 1;
  if (!Number.isInteger(duration) || duration < 1 || duration > 24) throw new HttpError(400, 'مدة التأجيل غير صالحة.', 'validation');
  if (movementType === 'postponement') {
    const years = Number(getSetting(db, 'students.max_postponement_years')), limit = years * SEMESTERS_PER_YEAR, used = usedPostponementSemesters(db, studentId, excludeId);
    if (used + duration > limit) {
      throw new HttpError(409, `يتجاوز هذا التأجيل الحد الأقصى المسموح (${years} سنوات = ${limit} فصلاً). المستهلك ${used} فصلاً والمتبقي ${Math.max(0, limit - used)}.`, 'postponement_limit');
    }
  }
  let targetProgram = prof.program_id;
  if (movementType === 'program_transfer') {
    targetProgram = Number(toProgramId);
    if (!db.prepare('SELECT 1 AS x FROM programs WHERE id = ? AND active = 1').get(targetProgram)) throw new HttpError(400, 'البرنامج المطلوب غير موجود أو غير مفعّل.', 'validation');
    if (targetProgram === Number(prof.program_id)) throw new HttpError(400, 'الطالب مسجَّل في هذا البرنامج أصلاً.', 'validation');
  }
  return { prof, toStatus: LIFECYCLE_STATUS[movementType], targetProgram, duration };
}

// تقديم الحركة إلى سلسلة الاعتماد: لا يمس قيد الطالب. يستدعيها المسار داخل قفله، واعتماد الطلب داخل معاملته
function submitMovement(db, actor, input, ip) {
  const { studentId, movementType, reason, decisionNo, requestId = null } = input;
  const { prof, toStatus, targetProgram, duration } = movementPlan(db, input);
  if (db.prepare("SELECT 1 AS x FROM sa_lifecycle_movements WHERE student_id = ? AND status = 'pending'").get(studentId)) {
    throw new HttpError(409, 'للطالب حركة قيد قيد الاعتماد؛ لا تُقدَّم أخرى قبل البت فيها.', 'conflict');
  }
  const nextId = nextNumber(db, 'sa_lifecycle_movements', 'SELECT MAX(id) FROM sa_lifecycle_movements');
  const movNo = `MOV-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`;
  const imp = LIFECYCLE_IMPACT[movementType], chain = chainFor(movementType);
  const id = Number(db.prepare(`
      INSERT INTO sa_lifecycle_movements (movement_no, student_id, movement_type, academic_year, semester, from_status, to_status, from_program_id, to_program_id, financial_impact, academic_impact, decision_no, reason, status, created_by, created_by_id, created_at, duration_semesters, request_id, current_step)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1) RETURNING id
    `).get(movNo, studentId, movementType, academicYear(), prof.status, toStatus, prof.program_id, targetProgram, imp.fin, imp.acad, decisionNo || null, reason, actorName(actor, 'شؤون الطلاب'), actor.id ?? null, Date.now(), duration, requestId).id);
  const ins = db.prepare('INSERT INTO sa_movement_steps (movement_id, step_no, step_key, label) VALUES (?, ?, ?, ?)');
  chain.forEach((key, i) => ins.run(id, i + 1, key, STEPS[key].label));
  audit(db, actor, `تقديم حركة قيد للاعتماد (${movementType})`, `${movNo} — طالب #${studentId}`, ip);
  return { id, movementNo: movNo, status: 'pending', nextStep: STEPS[chain[0]].label, totalSteps: chain.length };
}

export function executeLifecycleMovement({ db }, actor, body, ip) {
  if (!actor || (actor.role !== 'admin' && !actor.can?.('student:update'))) {
    throw new HttpError(403, 'لا تملك صلاحية تقديم حركة قيد (يتطلب صلاحية student:update).', 'forbidden');
  }
  const studentId = Number(body?.studentId);
  const movementType = String(body?.movementType || 'postponement');
  const reason = String(body?.reason || '').trim();
  if (!studentId || !reason) {
    throw new HttpError(400, 'يرجى اختيار الطالب وتحديد سبب حركة القيد.', 'validation');
  }
  if (PENALTY_ONLY.includes(movementType)) throw new HttpError(400, 'هذه الحركة تصدر عن قرار لجنة الانضباط فقط.', 'validation');
  return submitMovement(db, actor, { studentId, movementType, reason, decisionNo: String(body?.decisionNo || '').trim(), toProgramId: body?.toProgramId, durationSemesters: body?.durationSemesters }, ip);
}

// الخدمات التي يُدخل اعتمادها الطالب في حركة قيد
const REQUEST_MOVEMENTS = { postponement: 'postponement', leave_study_freeze: 'postponement', withdrawal: 'withdrawal', adm_withdrawal_confirm: 'withdrawal', program_transfer: 'program_transfer' };
const TERM_SEMESTERS = { 'فصل واحد': 1, 'فصلان': 2, 'سنة دراسية': 2 };

export const requestInChain = (db, requestId) => !!db.prepare("SELECT 1 AS x FROM sa_lifecycle_movements WHERE request_id = ? AND status = 'pending'").get(requestId);

// موافقة شعبة شؤون الطلاب على الطلب تُدخله سلسلة الاعتماد، ويبقى قيد المراجعة حتى القرار النهائي
export function submitRequestMovement({ db }, actor, request, ip) {
  const movementType = REQUEST_MOVEMENTS[request.service_code];
  if (!movementType) return null;
  lockStudent(db, request.student_id);
  if (!db.prepare('SELECT 1 AS x FROM student_profiles WHERE user_id = ?').get(request.student_id)) return null;
  const details = JSON.parse(request.details_json || '{}');
  const durationSemesters = Object.values(details).map((v) => TERM_SEMESTERS[v]).find(Boolean) ?? 1;
  const text = [details.reason, details.justification].filter(Boolean).join(' — ') || 'بناءً على طلب الطالب';
  return submitMovement(db, actor, { studentId: request.student_id, movementType, reason: String(text).slice(0, 300), decisionNo: request.no, toProgramId: details.target_program_id__id, durationSemesters, requestId: request.id }, ip);
}

export const financialDue = (db, studentId) => {
  const charged = Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN ft.kind = 'discount' THEN -c.amount ELSE c.amount END), 0) AS v FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id WHERE c.student_id = ? AND c.status = 'open'").get(studentId).v);
  const paid = Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM fin_payments WHERE student_id = ? AND status <> 'void'").get(studentId).v);
  return Math.max(0, charged - paid) / 100;
};
const openLoans = (db, studentNo) => Number(db.prepare('SELECT COUNT(*) AS c FROM library_loans WHERE borrower_no = ? AND return_date IS NULL').get(studentNo).c);

const scopedFaculty = (actor) => (actor?.data_scope === 'faculty' && actor.scope_faculty ? actor.scope_faculty : null);
const studentFaculty = (db, studentId) => db.prepare('SELECT g.faculty FROM student_profiles p JOIN programs g ON g.id = p.program_id WHERE p.user_id = ?').get(studentId)?.faculty;
const eligibleFor = (db, actor, def, movement) => canRead(actor, def.perms) && (!def.scoped || !scopedFaculty(actor) || scopedFaculty(actor) === studentFaculty(db, movement.student_id));

const notifyUsers = (db, ids, movement, text) => {
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'lifecycle', ?, ?, '', ?) ON CONFLICT DO NOTHING"), now = Date.now();
  for (const id of new Set(ids)) ins.run(id, movement.id, text, now);
};
// الجهات المعنية بالقرار: وحدات المالية والمكتبة والقبول وشؤون الطلاب
const concernedStaff = (db) => db.prepare("SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE u.active = 1 AND o.code IN ('finance', 'library', 'admission', 'affairs', 'exams', 'of_housing')").all().map((u) => u.id);

function finalizeMovement(deps, actor, movement, ip) {
  const { db, cfg } = deps, now = Date.now();
  lockStudent(db, movement.student_id);
  if (appealBlocksMovement(db, movement)) throw new HttpError(409, 'يوجد تظلم قائم على هذا القرار، ويوقف تنفيذه حتى البت فيه.', 'appeal_pending');
  const { toStatus, targetProgram, prof } = movementPlan(db, { studentId: movement.student_id, movementType: movement.movement_type, toProgramId: movement.to_program_id, durationSemesters: movement.duration_semesters }, movement.id);
  db.prepare('UPDATE student_profiles SET status = ?, program_id = ?, updated_at = ? WHERE user_id = ?').run(toStatus, targetProgram, now, movement.student_id);
  // المنسحب أو المفصول لا يدخل البوابة، ويعود حسابه بإعادة القيد
  if (toStatus === 'withdrawn') {
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(movement.student_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(movement.student_id);
  } else if (movement.movement_type === 'reinstatement' && prof.status === 'withdrawn') {
    db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(movement.student_id);
  }
  db.prepare("UPDATE sa_lifecycle_movements SET status = 'approved', to_status = ?, to_program_id = ?, current_step = NULL, decided_at = ?, decision_no = COALESCE(decision_no, movement_no) WHERE id = ?").run(toStatus, targetProgram, now, movement.id);
  const label = STATUS_LABEL[toStatus] ?? toStatus;
  if (movement.request_id) {
    const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(movement.request_id);
    if (r && r.status === 'review') {
      const svc = db.prepare('SELECT * FROM service_types WHERE code = ?').get(r.service_code);
      const code = svc?.issues_document ? issueDocument({ db, cfg }, r, actor, now).code : null;
      db.prepare("UPDATE requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?").run(now, actor.id ?? null, r.id);
      db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, ?, ?)').run(r.id, now, actorName(actor, 'النظام'), `القرار النهائي: اعتماد الطلب${code ? ` وإصدار وثيقة موقعة برمز ${code}` : ''}. حالة الطالب الآن «${label}»`);
    }
  }
  const student = db.prepare('SELECT display_name, student_no FROM users WHERE id = ?').get(movement.student_id);
  // من أُجِّل قيده أو انسحب لا يبقى مسجلاً في مقررات الفصل الجاري
  if (['suspended', 'withdrawn', 'transferred'].includes(toStatus) && student?.student_no) db.prepare("UPDATE student_self_enrollments SET dropped_at = ?, status = 'محذوف بحركة قيد' WHERE student_no = ? AND semester = ? AND dropped_at IS NULL").run(now, student.student_no, currentTerm(db));
  notifyUsers(db, [movement.student_id], movement, `صدر القرار النهائي بشأن حركة القيد ${movement.movement_no}: حالتك الآن «${label}».`);
  // الأثر المالي مهمة على المالية: لا يتغير أي مبلغ تلقائياً. الإشعار الأول للمستخدم هو المحفوظ، فتصل المالية مهمتها قبل الإشعار العام
  if (movement.financial_impact) {
    const finance = db.prepare("SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE u.active = 1 AND o.code = 'finance'").all().map((u) => u.id);
    if (finance.length) notifyUsers(db, finance, movement, `مطلوب إجراء مالي — القرار ${movement.movement_no} للطالب ${student?.display_name ?? ''} (${student?.student_no ?? ''}): ${movement.financial_impact}.`);
    audit(db, actor, 'إشعار المالية بالأثر المالي لحركة قيد', `${movement.movement_no}: ${movement.financial_impact}`.slice(0, 300), ip);
  }
  notifyUsers(db, concernedStaff(db), movement, `صدر القرار النهائي ${movement.movement_no} للطالب ${student?.display_name ?? ''} (${student?.student_no ?? ''}): الحالة «${label}».`);
  audit(db, actor, 'القرار النهائي لحركة قيد وتثبيتها في سجل الطالب', `${movement.movement_no} (${movement.from_status} -> ${toStatus})`, ip);
  return { status: 'approved', newStatus: toStatus, newStatusLabel: label };
}

// بت المرحلة الحالية. يعمل المسار داخل قفل الحركة ومعاملتها
export function decideMovementStep(deps, actor, id, body, ip) {
  const { db } = deps;
  // من لا يملك أي مرحلة يُرفض قبل البحث، فلا يكشف الرد وجود الحركة
  if (!canRead(actor, [...new Set(Object.values(STEPS).flatMap((x) => x.perms))])) throw new HttpError(403, 'لا تملك صلاحية اعتماد حركات القيد.', 'forbidden');
  const movement = db.prepare('SELECT * FROM sa_lifecycle_movements WHERE id = ?').get(Number(id));
  if (!movement) throw new HttpError(404, 'حركة القيد غير موجودة.', 'not_found');
  if (movement.status !== 'pending') throw new HttpError(409, 'تم البت في هذه الحركة مسبقاً.', 'conflict');
  // الضغطة تخص المرحلة التي رآها صاحبها، فلا تعبر ضغطة مزدوجة إلى المرحلة التالية
  if (body?.stepNo !== undefined && Number(body.stepNo) !== Number(movement.current_step)) throw new HttpError(409, 'تغيّرت مرحلة الحركة؛ حدّث الصفحة.', 'conflict');
  const step = db.prepare('SELECT * FROM sa_movement_steps WHERE movement_id = ? AND step_no = ?').get(movement.id, movement.current_step);
  const def = STEPS[step.step_key];
  if (!canRead(actor, def.perms)) throw new HttpError(403, `هذه المرحلة تخص: ${def.label}.`, 'forbidden');
  if (!eligibleFor(db, actor, def, movement)) throw new HttpError(404, 'حركة القيد غير موجودة.', 'not_found');
  if (def.sod && movement.created_by_id && Number(movement.created_by_id) === Number(actor.id)) throw new HttpError(403, 'لا يعتمد الحركة من قدّمها (فصل المهام).', 'forbidden');

  const decision = String(body?.decision || ''), note = String(body?.note ?? '').trim().slice(0, 300), now = Date.now();
  if (!['approve', 'reject', 'not_applicable'].includes(decision)) throw new HttpError(400, 'القرار غير معروف.', 'validation');
  if (decision === 'not_applicable' && !def.allowNa) throw new HttpError(400, 'لا يصح «لا ينطبق» في هذه المرحلة.', 'validation');
  if (decision === 'reject' && note.length < 3) throw new HttpError(400, 'سبب الرفض مطلوب (3 أحرف على الأقل).', 'validation');
  const student = db.prepare('SELECT student_no FROM users WHERE id = ?').get(movement.student_id);
  if (decision === 'approve' && step.step_key === 'clearance_finance') {
    const due = financialDue(db, movement.student_id);
    if (due > 0) throw new HttpError(409, `لا تُمنح براءة الذمة: على الطالب مستحقات قدرها ${due.toLocaleString('en-US')} ل.س.`, 'clearance_blocked');
  }
  if (decision === 'approve' && step.step_key === 'clearance_library') {
    const n = openLoans(db, student?.student_no);
    if (n > 0) throw new HttpError(409, `لا تُمنح براءة الذمة: على الطالب ${n} إعارة غير مُعادة.`, 'clearance_blocked');
  }

  const stepStatus = { approve: 'approved', reject: 'rejected', not_applicable: 'not_applicable' }[decision];
  db.prepare('UPDATE sa_movement_steps SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, note = ? WHERE id = ?').run(stepStatus, actor.id ?? null, actorName(actor, ''), now, note || null, step.id);
  audit(db, actor, `بت مرحلة حركة قيد: ${step.label} (${stepStatus})`, movement.movement_no, ip);

  if (decision === 'reject') {
    db.prepare("UPDATE sa_lifecycle_movements SET status = 'rejected', current_step = NULL, decided_at = ?, reject_reason = ? WHERE id = ?").run(now, note, movement.id);
    if (movement.request_id) {
      db.prepare("UPDATE requests SET status = 'rejected', rejected_by = 'staff', reject_reason = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'review'").run(note.slice(0, 300), now, actor.id ?? null, movement.request_id);
      db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, ?, ?)').run(movement.request_id, now, actorName(actor, 'النظام'), `رُفض الطلب في مرحلة «${step.label}»: ${note}`);
    }
    notifyUsers(db, [movement.student_id], movement, `رُفضت حركة القيد ${movement.movement_no} في مرحلة «${step.label}»: ${note}`);
    return { status: 'rejected', movementNo: movement.movement_no };
  }
  const next = db.prepare('SELECT * FROM sa_movement_steps WHERE movement_id = ? AND step_no = ?').get(movement.id, movement.current_step + 1);
  if (!next) return { movementNo: movement.movement_no, ...finalizeMovement(deps, actor, movement, ip) };
  db.prepare('UPDATE sa_lifecycle_movements SET current_step = ? WHERE id = ?').run(next.step_no, movement.id);
  if (movement.request_id) db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, ?, ?)').run(movement.request_id, now, actorName(actor, 'النظام'), `${step.label}: ${decision === 'approve' ? 'تمت الموافقة' : 'لا ينطبق'}. المرحلة التالية: ${next.label}`);
  return { status: 'pending', movementNo: movement.movement_no, nextStep: next.label };
}

// ما ينتظر قرار هذا الحساب تحديداً
function movementQueue(db, actor) {
  const rows = db.prepare(`SELECT m.id, m.movement_no, m.movement_type, m.student_id, m.reason, m.created_by, m.created_by_id, m.current_step, m.duration_semesters,
      s.step_key, s.label, u.display_name AS "studentName", u.student_no AS "studentNo", g.faculty,
      (SELECT COUNT(*) FROM sa_movement_steps x WHERE x.movement_id = m.id) AS total
    FROM sa_lifecycle_movements m
    JOIN sa_movement_steps s ON s.movement_id = m.id AND s.step_no = m.current_step
    LEFT JOIN users u ON u.id = m.student_id
    LEFT JOIN student_profiles p ON p.user_id = m.student_id
    LEFT JOIN programs g ON g.id = p.program_id
    WHERE m.status = 'pending' ORDER BY m.id LIMIT 300`).all();
  return rows.filter((m) => eligibleFor(db, actor, STEPS[m.step_key], m)).map((m) => {
    const def = STEPS[m.step_key];
    const blockedSelf = !!def.sod && Number(m.created_by_id) === Number(actor.id);
    return { ...m, allowNa: !!def.allowNa, blockedSelf, due: m.step_key === 'clearance_finance' ? financialDue(db, m.student_id) : undefined, openLoans: m.step_key === 'clearance_library' ? openLoans(db, m.studentNo) : undefined };
  });
}

export function createDisciplinaryRecord({ db }, actor, body, ip) {
  if (!actor || (actor.role !== 'admin' && !actor.can?.('holds:manage'))) {
    throw new HttpError(403, 'لا تملك صلاحية فرض عقوبة انضباطية أو حجب وثائق (يتطلب صلاحية holds:manage).', 'forbidden');
  }
  const studentId = Number(body?.studentId);
  const note = String(body?.note || '').trim();
  const decisionNo = String(body?.decisionNo || docNo(`DISC-${new Date().getFullYear()}`)).trim();
  const violationCategory = String(body?.violationCategory || 'exam_misconduct');
  const penaltyLevel = String(body?.penaltyLevel || 'warning');
  if (!['warning', 'exam_zero', 'term_suspension', 'dismissal'].includes(penaltyLevel)) throw new HttpError(400, 'نوع العقوبة غير معروف.', 'validation');
  // بلا تاريخ: الحجب قائم حتى يُرفع يدوياً
  const expiresAt = String(body?.expiresAt ?? '').trim() || null;
  if (expiresAt) {
    if (!isIsoDay(expiresAt)) throw new HttpError(400, 'تاريخ انتهاء العقوبة غير صالح.', 'validation');
    if (expiresAt < todayIso()) throw new HttpError(400, 'تاريخ انتهاء العقوبة لا يكون في الماضي.', 'validation');
  }

  if (!studentId || !note) {
    throw new HttpError(400, 'يرجى اختيار الطالب وكتابة سبب العقوبة الانضباطية.', 'validation');
  }
  if (!db.prepare('SELECT 1 AS x FROM student_profiles WHERE user_id = ?').get(studentId)) throw new HttpError(404, 'ملف الطالب غير موجود.', 'not_found');

  // القرار والحركة معاً أو لا شيء: تعذر الحركة (حالة غير مناسبة أو حركة قائمة) يلغي القرار
  return withLock(db, `lifecycle:${studentId}`, () => {
    // إدراج في جدول student_holds الرسمي ليتم تطبيق الحجب الآلي للوثائق في كامل النظام
    const holdRes = db
      .prepare("INSERT INTO student_holds (student_id, hold_type, note, active, created_by, created_at) VALUES (?, 'disciplinary', ?, 1, ?, ?)")
      .run(studentId, `[${decisionNo}] ${note}`.slice(0, 200), actor.id, Date.now());
    const holdId = Number(holdRes.lastInsertRowid);

    db.prepare(`
      INSERT INTO sa_disciplinary_details (hold_id, student_id, committee_decision_no, violation_category, penalty_level, blocks_documents, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(holdId, studentId, decisionNo, violationCategory, penaltyLevel, expiresAt, Date.now());

    audit(db, actor, 'تسجيل قرار لجنة انضباطية وحجب وثائق', `${decisionNo} — طالب #${studentId}`, ip);
    // حرمان الفصل والفصل النهائي يغيّران القيد عبر سلسلة الاعتماد نفسها
    const movementType = PENALTY_MOVEMENT[penaltyLevel];
    const movement = movementType ? submitMovement(db, actor, { studentId, movementType, reason: note.slice(0, 300), decisionNo }, ip) : null;
    return { holdId, decisionNo, movement };
  });
}

// عقوبة بلغت تاريخ انتهائها لا تعود تحجب شيئاً. تعمل عند الإقلاع وكل ساعة، وتُسجل كل حالة في التدقيق
export function expireDisciplinaryHolds(db, today = todayIso()) {
  const due = db.prepare(`SELECT h.id, h.student_id, d.committee_decision_no AS no FROM student_holds h
    JOIN sa_disciplinary_details d ON d.hold_id = h.id
    WHERE (h.active IS NULL OR h.active = 1) AND h.cleared_at IS NULL AND d.expires_at IS NOT NULL AND d.expires_at <> '' AND d.expires_at < ?`).all(today);
  let n = 0;
  for (const h of due) {
    tx(db, () => {
      if (!db.prepare('UPDATE student_holds SET active = 0, cleared_at = ? WHERE id = ? AND cleared_at IS NULL').run(Date.now(), h.id).changes) return;
      n++;
      audit(db, null, 'انتهاء عقوبة انضباطية ببلوغ تاريخها ورفع الحجب', `${h.no} — طالب #${h.student_id}`, null);
    });
  }
  return n;
}

/* ---------- 5. المنح والإعفاءات المدمجة مع المالية ---------- */

const SCHOLARSHIP_TYPES = ['merit_top', 'martyrs_kin', 'sibling_discount', 'social_aid'];
const canGrant = (actor) => !!actor && (adminBypass(actor, ['finance:fees', 'sa_scholarships:approve']) || actor.can?.('finance:fees') || actor.can?.('sa_scholarships:approve'));

export function grantStudentScholarship(deps, actor, body, ip) {
  if (!actor || (!adminBypass(actor, ['finance:fees', 'sa_scholarships:approve']) && !actor.can?.('finance:fees') && !actor.can?.('sa_scholarships:approve'))) {
    throw new HttpError(403, 'لا تملك صلاحية منح الإعفاءات والحسومات المالية للطلاب.', 'forbidden');
  }
  const { db } = deps;
  const studentId = Number(body?.studentId);
  const scholarshipType = String(body?.scholarshipType || 'merit_top');
  const baseTuition = Number(body?.baseTuition || 1500000);
  const gpa = body?.gpa ? Number(body.gpa) : null;
  const grantYear = String(body?.academicYear ?? '').trim() || academicYear();

  if (!studentId) throw new HttpError(400, 'يرجى اختيار الطالب المستفيد من المنحة أو الحسم.', 'validation');

  const calc = calculateScholarshipGrant({
    scholarshipType,
    baseTuition,
    gpa,
  });

  const discountPercent = body?.discountPercent ? Number(body.discountPercent) : calc.discountPercent;
  const amount = body?.amount ? Number(body.amount) : Math.round((baseTuition * discountPercent) / 100);
  if (!(discountPercent > 0 && discountPercent <= 100)) throw new HttpError(400, 'نسبة الحسم يجب أن تكون بين 1 و100.', 'validation');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'مبلغ المنحة يجب أن يكون أكبر من صفر.', 'validation');

  readyFinance(db);
  const discountFeeType = db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'discount' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!discountFeeType) throw new HttpError(409, 'لا يوجد نوع رسم خصم نشط في المالية؛ عرّفه أو فعّله أولاً ليُسجَّل قيد المنحة.', 'conflict');

  if (!SCHOLARSHIP_TYPES.includes(scholarshipType)) throw new HttpError(400, 'نوع المنحة غير معروف.', 'validation');
  if (!(Number(body?.baseTuition) > 0)) throw new HttpError(400, 'أدخل القسط الأساسي الفعلي للطالب.', 'validation');
  if (scholarshipType === 'merit_top' && !(gpa > 0 && gpa <= 100)) throw new HttpError(400, 'منحة التفوق تتطلب معدل الطالب الفعلي (من 1 إلى 100).', 'validation');
  if (amount > baseTuition) throw new HttpError(400, 'مبلغ المنحة لا يجوز أن يتجاوز القسط الأساسي.', 'validation');

  // الفحص والحجز تحت قفل الطالب، فلا تتجاوز طلبات متزامنة الحد
  const { grantNo, scholarshipId } = withLock(db, `scholarship:${studentId}`, () => {
    // منحة أُلغي قيد خصمها من المالية لا تُحتسب، وإلا تعذّر إصدار الحسم من جديد
    const active = db.prepare("SELECT s.scholarship_type, s.discount_percent FROM sa_scholarships s LEFT JOIN fin_charges c ON c.id = s.fin_charge_id WHERE s.student_id = ? AND s.academic_year = ? AND s.status = 'active' AND (c.id IS NULL OR c.status = 'open')").all(studentId, grantYear);
    if (active.some((x) => x.scholarship_type === scholarshipType)) throw new HttpError(409, 'لدى الطالب منحة فعالة من هذا النوع في السنة نفسها.', 'conflict');
    const sum = active.reduce((n, x) => n + Number(x.discount_percent), 0);
    if (sum + discountPercent > 100) throw new HttpError(409, `مجموع حسومات الطالب في هذه السنة سيتجاوز 100% (الحالي ${sum}%).`, 'conflict');
    const nextId = nextNumber(db, 'sa_scholarships', 'SELECT MAX(id) FROM sa_scholarships');
    const no = `SCH-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`;
    const info = db.prepare(`
      INSERT INTO sa_scholarships (grant_no, student_id, scholarship_type, discount_percent, amount, academic_year, gpa_at_grant, fin_charge_id, status, approved_by, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?)
    `).run(no, studentId, scholarshipType, discountPercent, amount, grantYear, gpa, actor.display_name || actor.name || 'لجنة المنح والرعاية الطلابية', String(body?.note || calc.label).slice(0, 200), Date.now());
    return { grantNo: no, scholarshipId: Number(info.lastInsertRowid) };
  });

  // createCharge يفتح معاملته الخاصة، لذا تُحذف المنحة إن فشل قيدها فلا تبقى منحة بلا خصم
  let finChargeId;
  try {
    finChargeId = createCharge(
      deps,
      actor,
      {
        studentId,
        feeTypeId: discountFeeType.id,
        amount,
        dueDay: new Date().toISOString().slice(0, 10),
        academicYear: grantYear,
        note: `${calc.label} (${discountPercent}%) — رقم المنحة ${grantNo}`,
      },
      ip
    ).id;
  } catch (err) {
    db.prepare('DELETE FROM sa_scholarships WHERE id = ?').run(scholarshipId);
    throw err;
  }
  db.prepare('UPDATE sa_scholarships SET fin_charge_id = ? WHERE id = ?').run(finChargeId, scholarshipId);

  audit(db, actor, 'منح إعفاء/حسم طلابي وربطه بالمالية', `${grantNo} — ${amount} ل.س`, ip);
  return { id: scholarshipId, grantNo, amount, discountPercent, finChargeId };
}

// إلغاء منحة: يعكس قيد الخصم في المالية، ويبقى سجلها للرجوع إليه
export function revokeScholarship(deps, actor, id, body, ip) {
  if (!canGrant(actor)) throw new HttpError(403, 'لا تملك صلاحية إلغاء المنح.', 'forbidden');
  const { db } = deps;
  const reason = String(body?.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 200) throw new HttpError(400, 'اكتب سبب إلغاء المنحة (3-200 حرف).', 'validation');
  const row = db.prepare('SELECT * FROM sa_scholarships WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, 'المنحة غير موجودة.', 'not_found');
  const claim = db.prepare("UPDATE sa_scholarships SET status = 'revoked' WHERE id = ? AND status = 'active'").run(row.id);
  if (!claim.changes) throw new HttpError(409, 'المنحة ملغاة مسبقاً.', 'conflict');
  try {
    if (row.fin_charge_id) voidCharge(deps, actor, row.fin_charge_id, { reason: `إلغاء المنحة ${row.grant_no}: ${reason}` }, ip);
  } catch (e) {
    db.prepare("UPDATE sa_scholarships SET status = 'active' WHERE id = ?").run(row.id);
    throw e;
  }
  db.prepare('UPDATE sa_scholarships SET note = ? WHERE id = ?').run(`${row.note || ''} | أُلغيت: ${reason}`.slice(0, 400), row.id);
  audit(db, actor, 'إلغاء منحة طلابية', `${row.grant_no}: ${reason}`, ip);
  return { ok: true, grantNo: row.grant_no };
}

/* ---------- 6. مكتب خدمة الطالب الموحد وحجز المواعيد والدور الذكي ---------- */

export function bookDeskAppointment({ db }, actor, body, ip) {
  if (actor?.role !== 'student') requireSuitePerm(actor, ...DESK_MANAGE);
  const studentId = actor.role === 'student' ? actor.id : Number(body?.studentId);
  // الموظف يحجز لطالب محدد، فلا تُسجَّل التذكرة باسمه هو
  if (actor.role !== 'student') {
    if (!studentId) throw new HttpError(400, 'يرجى اختيار الطالب صاحب الموعد.', 'validation');
    if (!db.prepare('SELECT 1 AS x FROM student_profiles WHERE user_id = ?').get(studentId)) throw new HttpError(404, 'ملف الطالب غير موجود.', 'not_found');
  }
  const requestId = body?.requestId ? Number(body.requestId) : null;
  // الطالب لا يربط تذكرته بطلب غيره، فالربط يكتب في سجل أحداث ذلك الطلب
  if (requestId && actor.role === 'student' && !db.prepare('SELECT id FROM requests WHERE id = ? AND student_id = ?').get(requestId, actor.id)) {
    throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
  }
  const servicePurpose = String(body?.servicePurpose || 'استلام وثيقة مصدقة / مراجعة شؤون الطلاب').trim();
  const appointmentDate = String(body?.appointmentDate || todayIso());
  if (!isIsoDay(appointmentDate)) throw new HttpError(400, 'تاريخ الموعد غير صالح.', 'validation');
  if (appointmentDate < todayIso()) throw new HttpError(400, 'لا يُحجز موعد بتاريخ ماضٍ.', 'validation');
  const timeSlot = String(body?.timeSlot || '10:00 - 10:30');
  const counterWindow = String(body?.counterWindow || 'النافذة 1 — الوثائق والشهادات');

  const nextId = nextNumber(db, 'sa_desk_appointments', 'SELECT MAX(id) FROM sa_desk_appointments');
  const ticketNo = `Q-${100 + nextId}`;

  const info = db
    .prepare(`
      INSERT INTO sa_desk_appointments (ticket_no, student_id, request_id, service_purpose, appointment_date, time_slot, counter_window, queue_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)
    `)
    .run(ticketNo, studentId, requestId, servicePurpose, appointmentDate, timeSlot, counterWindow, Date.now());

  if (requestId) {
    db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, ?, ?)').run(
      requestId,
      Date.now(),
      actor.display_name || actor.name || 'بوابة الطالب',
      `تم حجز موعد استلام ذكي برقم تذكرة (${ticketNo}) ليوم ${appointmentDate} الساعة ${timeSlot}`
    );
  }

  audit(db, actor, 'حجز دور ذكي في مكتب خدمة الطالب', `${ticketNo} — ${servicePurpose}`, ip);
  return { id: Number(info.lastInsertRowid), ticketNo };
}

function updateDeskQueueStatus({ db }, actor, ticketId, status, ip) {
  requireSuitePerm(actor, ...DESK_MANAGE);
  const allowed = ['waiting', 'serving', 'completed', 'no_show'];
  const nextStatus = allowed.includes(status) ? status : 'serving';
  const row = db.prepare('SELECT * FROM sa_desk_appointments WHERE id = ?').get(Number(ticketId));
  if (!row) throw new HttpError(404, 'تذكرة الدور غير موجودة.', 'not_found');

  const now = Date.now();
  const calledAt = nextStatus === 'serving' ? now : row.called_at;
  const completedAt = nextStatus === 'completed' ? now : row.completed_at;

  db.prepare('UPDATE sa_desk_appointments SET queue_status = ?, called_at = ?, completed_at = ? WHERE id = ?')
    .run(nextStatus, calledAt, completedAt, row.id);

  if (row.request_id && nextStatus === 'completed') {
    db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, ?, ?)').run(
      row.request_id,
      now,
      actor.display_name || actor.name || 'مكتب خدمة الطالب',
      `تم تسليم الوثيقة للطالب وإغلاق تذكرة الدور (${row.ticket_no}) بنجاح`
    );
  }

  audit(db, actor, `تحديث حالة تذكرة الدور (${row.ticket_no})`, nextStatus, ip);
  return { ok: true, ticketNo: row.ticket_no, status: nextStatus };
}

/* ============================================================================
   4. تسجيل مسارات API (Routes Registration)
   ============================================================================ */

export function suiteOverviewFor(deps, actor, query) {
  if (actor?.role === 'student') return studentOverview(getStudentAffairsSuiteOverview(deps, { ...query, studentId: actor.id, ownOnly: true }), actor.id);
  return staffOverview(deps, getStudentAffairsSuiteOverview(deps, query), actor);
}

export function registerStudentAffairsSuiteRoutes(r, deps) {
  // يقرأ كل الطلاب، فيعمل خارج الخيط الرئيسي حتى لا يعلّق بقية المستخدمين
  r.add('GET', '/api/student-affairs-suite/overview', async (c) => {
    if (c.user?.role !== 'student') requireSuitePerm(c.user, ...SUITE_READ);
    c.json(200, await deps.heavy.run('suiteOverview', c, [c.query]));
  });

  r.add('POST', '/api/student-affairs-suite/admissions/applicant', (c) => {
    c.json(201, addAdmissionApplicant(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/admissions/run-sort', async (c) => {
    c.json(200, await deps.heavy.run('admissionsSort', c, [c.ip], { writes: true }));
  });

  r.add('POST', '/api/student-affairs-suite/admissions/enroll/:id', async (c) => {
    c.json(201, await enrollAcceptedApplicant(deps, c.user, c.params.id, c.body, c.ip));
  });

  r.add('PUT', '/api/student-affairs-suite/admissions/programs/:id', (c) => { c.json(200, saveProgramAdmissionPlan(deps, c.user, c.params.id, c.body, c.ip)); });

  r.add('POST', '/api/student-affairs-suite/equivalence', (c) => {
    c.json(201, addTransferEquivalence(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/prerequisites', (c) => { c.json(201, addCoursePrerequisite(deps, c.user, c.body, c.ip)); });
  r.add('DELETE', '/api/student-affairs-suite/prerequisites/:id', (c) => { c.json(200, removeCoursePrerequisite(deps, c.user, c.params.id, c.ip)); });

  r.add('POST', '/api/student-affairs-suite/equivalence/:id/decide', (c) => {
    c.json(200, decideTransferEquivalence(deps, c.user, c.params.id, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/advising', (c) => {
    c.json(201, createAdvisingSession(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/advising/:id/resolve', (c) => {
    c.json(200, resolveAdvisingWarning(deps, c.user, c.params.id, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/lifecycle', (c) => {
    c.json(201, executeLifecycleMovement(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/lifecycle/:id/decide', (c) => {
    c.json(200, decideMovementStep(deps, c.user, c.params.id, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/disciplinary', (c) => {
    c.json(201, createDisciplinaryRecord(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/scholarships', (c) => {
    c.json(201, grantStudentScholarship(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/scholarships/:id/revoke', (c) => {
    c.json(200, revokeScholarship(deps, c.user, c.params.id, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/queue/book', (c) => {
    c.json(201, bookDeskAppointment(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/queue/:id/status', (c) => {
    c.json(200, updateDeskQueueStatus(deps, c.user, c.params.id, c.body?.status, c.ip));
  });
}
