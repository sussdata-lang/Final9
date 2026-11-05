import { docNo, academicYear } from '../lib/doc_no.js';
import { SOD_SENSITIVE_PERMISSIONS } from '../permissions.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { registerStudent, STATUS_LABEL } from './students.js';
import { createCharge } from './finance/fees.js';
import { nextNumber } from './numbering.js';
import { ready as readyFinance } from './finance/core.js';
import { getSetting } from './settings.js';

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
    if (app.sorting_status === 'enrolled') {
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

  const programs = db
    .prepare(`
      SELECT p.id, p.name, p.faculty, p.degree, p.years,
             (SELECT COUNT(*) FROM student_profiles sp WHERE sp.program_id = p.id AND sp.status = 'active') AS activeStudents
      FROM programs p
      WHERE p.active = 1
      ORDER BY p.id
    `)
    .all()
    .map((p, idx) => ({
      ...p,
      minScore: idx === 0 ? 205 : idx === 1 ? 190 : 180,
      capacity: 35,
      enrolledCount: p.activeStudents,
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
        .prepare("SELECT course_id AS courseId, course, mark AS total, CASE WHEN mark >= 60 THEN 1 ELSE 0 END AS passed FROM grades WHERE student_id = ? AND workflow_status = 'approved'")
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
      FROM (SELECT student_id, SUM(COALESCE(hours, 3)) AS hrs, SUM(COALESCE(hours, 3) * mark) AS weighted, SUM(CASE WHEN mark < 60 THEN 1 ELSE 0 END) AS failed
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
export function addCoursePrerequisite({ db }, actor, body, ip) {
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
export function removeCoursePrerequisite({ db }, actor, id, ip) {
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
const SUITE_READ = ['request:read_all', 'request:read_unit', 'student:read', 'student:register', 'sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve', 'sa_advising:view', 'sa_advising:edit', 'sa_scholarships:view', 'sa_scholarships:write', 'sa_scholarships:approve'];

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

/* ---------- 1. عمليات القبول والمفاضلة والمعادلة ---------- */

export function addAdmissionApplicant({ db }, actor, body, ip) {
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
  const phone = String(body?.phone || '0944000000').trim();
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

export function executeAdmissionsSorting(deps, actor, ip) {
  requireSuitePerm(actor, 'sa_admissions:approve');
  const { db } = deps;
  const overview = getStudentAffairsSuiteOverview(deps);
  const apps = db.prepare('SELECT * FROM sa_applicants').all();
  const sorted = runAutomatedAdmissionsSort(apps, overview.programs);

  const upd = db.prepare('UPDATE sa_applicants SET sorting_status = ?, accepted_program_id = ? WHERE id = ? AND sorting_status != \'enrolled\'');
  for (const res of sorted) {
    if (res.status !== 'enrolled') {
      upd.run(res.status, res.acceptedProgramId, res.id);
    }
  }
  audit(db, actor, 'تشغيل محرك الفرز الآلي للمفاضلة الجامعية', `${sorted.length} متقدماً`, ip);
  return { sortedCount: sorted.length, results: sorted };
}

export async function enrollAcceptedApplicant(deps, actor, applicantId, ip) {
  requireSuitePerm(actor, 'sa_admissions:approve');
  const { db } = deps;
  const app = db.prepare('SELECT * FROM sa_applicants WHERE id = ?').get(Number(applicantId));
  if (!app) throw new HttpError(404, 'طلب المفاضلة غير موجود.', 'not_found');
  if (app.sorting_status === 'enrolled' && app.enrolled_student_id) {
    throw new HttpError(409, 'تم تثبيت تسجيل هذا المتقدم مسبقاً كطالب نظامي.', 'conflict');
  }
  const programId = app.accepted_program_id || app.pref1_program_id;
  const parts = String(app.full_name).trim().split(/\s+/);
  const firstName = parts[0] || 'طالب';
  const fatherName = parts.length > 2 ? parts[1] : 'محمد';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : 'المستجد';

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
  const hsList = getSetting(db, 'students.hs_types'), admList = getSetting(db, 'students.admissions'), relList = getSetting(db, 'students.relations');
  const hsRaw = String(app.hs_type || 'علمي');
  const hsHints = /ادب/.test(norm(hsRaw)) ? [hsRaw, 'الفرع الادبي'] : /(علم)/.test(norm(hsRaw)) ? [hsRaw, 'الفرع العلمي'] : [hsRaw];

  const regInput = {
    first_name: firstName,
    father_name: fatherName,
    last_name: lastName,
    mother_name: 'فاطمة الأحمد',
    national_id: String(app.national_id),
    gender: 'ذكر',
    birth_date: '2006-05-15',
    birth_place: 'دمشق',
    nationality: 'سورية',
    marital_status: 'عازب/عزباء',
    phone: app.phone || '0944112233',
    governorate: pick(getSetting(db, 'students.governorates'), ['دمشق'], 'دمشق'),
    city: 'المزة',
    address: 'دمشق — مساكن الجامعة',
    hs_type: pick(hsList, hsHints, 'أخرى'),
    hs_year: Number(app.hs_year || 2025),
    hs_score: Number(app.hs_score || 200),
    program_id: programId,
    admission_type: pick(admList, admissionHints[app.category] || ['القبول العام'], 'أخرى'),
    enroll_year: new Date().getFullYear(),
    enroll_term: 'الفصل الأول',
    study_level: 1,
    guardian_name: `${fatherName} ${lastName}`,
    guardian_relation: pick(relList, ['الأب'], 'قريب آخر'),
    guardian_phone: app.phone || '0944112233',
    notes: `ثُبِّت قبوله آلياً من بوابة المفاضلة رقم ${app.application_no}`,
  };

  const created = await registerStudent(deps, actor, regInput, ip);
  db.prepare("UPDATE sa_applicants SET sorting_status = 'enrolled', accepted_program_id = ?, enrolled_student_id = ? WHERE id = ?")
    .run(programId, created.student.id, app.id);

  audit(db, actor, 'تثبيت قبول متقدم وتسجيله كطالب نظامي', `${app.application_no} -> ${created.student.studentNo}`, ip);
  return { applicantId: app.id, student: created.student, credentials: created.credentials };
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
  const externalHours = Number(body?.externalHours || 3);
  const externalMark = Number(body?.externalMark || 75);

  if (!studentId || !internalCourseId || !sourceUniversity || !externalCourseName) {
    throw new HttpError(400, 'يرجى تحديد الطالب، الجامعة المصدر، اسم المقرر الخارجي، والمقرر المقابل في الخطة.', 'validation');
  }

  const info = db
    .prepare(`
      INSERT INTO sa_credit_equivalences (student_id, source_university, external_course_code, external_course_name, external_hours, external_mark, internal_course_id, equivalence_status, decided_by, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
    `)
    .run(
      studentId,
      sourceUniversity,
      externalCourseCode || 'EXT-101',
      externalCourseName,
      externalHours,
      externalMark,
      internalCourseId,
      actor.display_name || actor.name || 'لجنة المعادلة',
      String(body?.note || 'معادلة معتمدة وإعفاء من المقرر').slice(0, 200),
      Date.now()
    );

  // رصد علامة معادلة معتمدة في سجل علامات الطالب إذا لم تكن موجودة
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(internalCourseId);
  if (course) {
    const existingGrade = db
      .prepare('SELECT id FROM grades WHERE student_id = ? AND course_id = ?')
      .get(studentId, internalCourseId);
    if (!existingGrade) {
      db.prepare(`
        INSERT INTO grades (student_id, course_id, course, term, hours, mark, theory_mark, practical_mark, academic_year, semester, level, workflow_status, entered_by, entered_at, approved_by, approved_at)
        VALUES (?, ?, ?, 'الفصل الأول', ?, ?, ?, NULL, 'معادلة نقل', ?, ?, 'approved', ?, ?, ?, ?)
      `).run(
        studentId,
        course.id,
        course.name,
        course.hours || externalHours,
        externalMark,
        externalMark,
        course.semester || 1,
        course.level || 1,
        actor.id,
        Date.now(),
        actor.id,
        Date.now()
      );
    }
  }

  audit(db, actor, 'اعتماد معادلة مقرر لطالب محول', `${externalCourseName} -> #${internalCourseId}`, ip);
  return { id: Number(info.lastInsertRowid) };
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
  const gpaSnapshot = body?.gpaSnapshot ? Number(body.gpaSnapshot) : 59.0;
  const absenceRate = body?.absenceRate ? Number(body.absenceRate) : 14.0;
  const failedCount = body?.failedCoursesCount ? Number(body.failedCoursesCount) : 1;
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

export function resolveAdvisingWarning({ db }, actor, id, ip) {
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
};

export function executeLifecycleMovement({ db }, actor, body, ip) {
  if (!actor || (actor.role !== 'admin' && !actor.can?.('student:update'))) {
    throw new HttpError(403, 'لا تملك صلاحية تعديل حالة قيد الطالب (يتطلب صلاحية student:update).', 'forbidden');
  }
  const studentId = Number(body?.studentId);
  const movementType = String(body?.movementType || 'postponement');
  const reason = String(body?.reason || '').trim();
  if (!studentId || !reason) {
    throw new HttpError(400, 'يرجى اختيار الطالب وتحديد سبب حركة القيد.', 'validation');
  }

  const prof = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(studentId);
  if (!prof) throw new HttpError(404, 'ملف الطالب غير موجود.', 'not_found');

  const toStatus = LIFECYCLE_STATUS[movementType] || prof.status;
  const toProgramId = movementType === 'program_transfer' && body?.toProgramId ? Number(body.toProgramId) : prof.program_id;

  const nextId = nextNumber(db, 'sa_lifecycle_movements', 'SELECT MAX(id) FROM sa_lifecycle_movements');
  const movNo = `MOV-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`;
  const decisionNo = String(body?.decisionNo || `قرار شؤون الطلاب #${100 + nextId}`).trim();
  const imp = LIFECYCLE_IMPACT[movementType] || LIFECYCLE_IMPACT.postponement;

  // تحديث فعلي لحالة الطالب وبرنامجه في جدول student_profiles
  db.prepare('UPDATE student_profiles SET status = ?, program_id = ?, updated_at = ? WHERE user_id = ?')
    .run(toStatus, toProgramId, Date.now(), studentId);

  const info = db
    .prepare(`
      INSERT INTO sa_lifecycle_movements (movement_no, student_id, movement_type, academic_year, semester, from_status, to_status, from_program_id, to_program_id, financial_impact, academic_impact, decision_no, reason, status, created_by, created_at)
      VALUES (?, ?, ?, '2025-2026', 1, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
    `)
    .run(
      movNo,
      studentId,
      movementType,
      prof.status,
      toStatus,
      prof.program_id,
      toProgramId,
      imp.fin,
      imp.acad,
      decisionNo,
      reason,
      actor.display_name || actor.name || 'شؤون الطلاب',
      Date.now()
    );

  audit(db, actor, `تنفيذ حركة قيد طلابي (${movementType})`, `${movNo} — طالب #${studentId} (${prof.status} -> ${toStatus})`, ip);
  return { id: Number(info.lastInsertRowid), movementNo: movNo, newStatus: toStatus, newStatusLabel: STATUS_LABEL[toStatus] };
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
  const expiresAt = String(body?.expiresAt || '2026-12-31');

  if (!studentId || !note) {
    throw new HttpError(400, 'يرجى اختيار الطالب وكتابة سبب العقوبة الانضباطية.', 'validation');
  }

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
  return { holdId, decisionNo };
}

/* ---------- 5. المنح والإعفاءات المدمجة مع المالية ---------- */

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

  const nextId = nextNumber(db, 'sa_scholarships', 'SELECT MAX(id) FROM sa_scholarships');
  const grantNo = `SCH-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`;

  const info = db
    .prepare(`
      INSERT INTO sa_scholarships (grant_no, student_id, scholarship_type, discount_percent, amount, academic_year, gpa_at_grant, fin_charge_id, status, approved_by, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?)
    `)
    .run(
      grantNo,
      studentId,
      scholarshipType,
      discountPercent,
      amount,
      grantYear,
      gpa,
      actor.display_name || actor.name || 'لجنة المنح والرعاية الطلابية',
      String(body?.note || calc.label).slice(0, 200),
      Date.now()
    );
  const scholarshipId = Number(info.lastInsertRowid);

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

/* ---------- 6. مكتب خدمة الطالب الموحد وحجز المواعيد والدور الذكي ---------- */

export function bookDeskAppointment({ db }, actor, body, ip) {
  if (actor?.role !== 'student') requireSuitePerm(actor, ...DESK_MANAGE);
  const studentId = actor.role === 'student' ? actor.id : Number(body?.studentId || actor.id);
  const requestId = body?.requestId ? Number(body.requestId) : null;
  // الطالب لا يربط تذكرته بطلب غيره، فالربط يكتب في سجل أحداث ذلك الطلب
  if (requestId && actor.role === 'student' && !db.prepare('SELECT id FROM requests WHERE id = ? AND student_id = ?').get(requestId, actor.id)) {
    throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
  }
  const servicePurpose = String(body?.servicePurpose || 'استلام وثيقة مصدقة / مراجعة شؤون الطلاب').trim();
  const appointmentDate = String(body?.appointmentDate || new Date().toISOString().slice(0, 10));
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

export function updateDeskQueueStatus({ db }, actor, ticketId, status, ip) {
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
  return getStudentAffairsSuiteOverview(deps, query);
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
    c.json(201, await enrollAcceptedApplicant(deps, c.user, c.params.id, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/equivalence', (c) => {
    c.json(201, addTransferEquivalence(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/prerequisites', (c) => { c.json(201, addCoursePrerequisite(deps, c.user, c.body, c.ip)); });
  r.add('DELETE', '/api/student-affairs-suite/prerequisites/:id', (c) => { c.json(200, removeCoursePrerequisite(deps, c.user, c.params.id, c.ip)); });

  r.add('POST', '/api/student-affairs-suite/advising', (c) => {
    c.json(201, createAdvisingSession(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/advising/:id/resolve', (c) => {
    c.json(200, resolveAdvisingWarning(deps, c.user, c.params.id, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/lifecycle', (c) => {
    c.json(201, executeLifecycleMovement(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/disciplinary', (c) => {
    c.json(201, createDisciplinaryRecord(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/scholarships', (c) => {
    c.json(201, grantStudentScholarship(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/queue/book', (c) => {
    c.json(201, bookDeskAppointment(deps, c.user, c.body, c.ip));
  });

  r.add('POST', '/api/student-affairs-suite/queue/:id/status', (c) => {
    c.json(200, updateDeskQueueStatus(deps, c.user, c.params.id, c.body?.status, c.ip));
  });
}
