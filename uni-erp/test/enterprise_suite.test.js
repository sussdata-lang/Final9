import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import {
  calculateSimulatedGpa,
  detectTimetableConflict,
  computeFacultyOverloadPay,
  buildEnterpriseSuiteOverview,
  enterpriseOverviewFor,
} from '../server/services/enterprise_suite.js';
import { ready } from '../server/services/finance/core.js';
import { createCharge, createPayment } from '../server/services/finance/fees.js';

test('Pure Logic: GPA Simulator calculates weighted GPA and academic standing accurately', () => {
  const res = calculateSimulatedGpa(85.0, 60, [
    { code: 'CYB-301', credits: 4, expectedScore: 95 },
    { code: 'CYB-304', credits: 6, expectedScore: 95 },
  ]);
  assert.equal(res.totalHours, 70);
  // (85*60 + 95*10) / 70 = (5100 + 950) / 70 = 6050 / 70 = 86.43
  assert.equal(res.projectedGpa, 86.43);
  assert.equal(res.letter, 'جيد جداً (B+)');
  assert.equal(res.delta, 1.43);
});

test('Pure Logic: Timetable conflict detector catches hall and instructor collisions', () => {
  const existing = [
    { course_name: 'التشفير المتقدم', instructor_name: 'أ.د. مازن الحسن', hall_code: 'مدرج الفارابي A1', day_name: 'الأحد', time_slot: '08:30 - 10:30' },
  ];
  const hallClash = detectTimetableConflict(existing, {
    course_name: 'أمن الشبكات',
    instructor_name: 'د. رامي الشامي',
    hall_code: 'مدرج الفارابي A1',
    day_name: 'الأحد',
    time_slot: '08:30 - 10:30',
  });
  assert.equal(hallClash.conflict, true);

  const instClash = detectTimetableConflict(existing, {
    course_name: 'أمن الشبكات',
    instructor_name: 'أ.د. مازن الحسن',
    hall_code: 'مخبر السيبراني L2',
    day_name: 'الأحد',
    time_slot: '08:30 - 10:30',
  });
  assert.equal(instClash.conflict, true);

  const validSlot = detectTimetableConflict(existing, {
    course_name: 'أمن الشبكات',
    instructor_name: 'د. رامي الشامي',
    hall_code: 'مخبر السيبراني L2',
    day_name: 'الأحد',
    time_slot: '08:30 - 10:30',
  });
  assert.equal(validSlot.conflict, false);
});

test('Pure Logic: Faculty Overload Payroll calculator computes extra hours and compensation', () => {
  const res = computeFacultyOverloadPay(8, 12, 4, 125000);
  assert.equal(res.overloadHours, 8);
  assert.equal(res.totalOverloadPay, 1000000);
});

test('Database Integration: overview starts empty, and executive KPIs and the advising plan come from real records', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-es-'));
  const db = await openDb(path.join(tmpDir, 'test.db'));
  try {
    const ov = buildEnterpriseSuiteOverview(db);
    for (const k of ['scheduleSlots', 'quizzes', 'quizSubmissions', 'selfEnrollments', 'facultyOverloads', 'signedPayslips', 'feeInstallments', 'notifications', 'encryptedSnapshots', 'offlineBatches']) assert.equal(ov[k].length, 0, k);
    assert.deepEqual(ov.executiveKpis, { overallSuccessRate: 0, financialCollectionRate: 0, researchPublicationsCount: 0, facultiesComparison: [] }, 'لا أرقام مكتوبة في الكود');

    ready(db);
    const now = Date.now(), day = new Date().toISOString().slice(0, 10);
    const adminId = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('adm', 'adm', 'x', 'admin', ?)").run(now).lastInsertRowid);
    const stuId = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('s1', 'طالب', 'x', 'student', 'S-1', ?)").run(now).lastInsertRowid);
    const prog = db.prepare('SELECT id, faculty_id FROM programs ORDER BY id LIMIT 1').get();
    const faculty = db.prepare('SELECT name FROM faculties WHERE id = ?').get(prog.faculty_id).name;
    db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'أ', 'ب', 'ج', 'د', '90000000001', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(stuId, prog.id, now, now);
    const addCourse = (code, level) => Number(db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, ?, 1, ?, ?, 3)').run(prog.id, level, code, code).lastInsertRowid);
    const c1 = addCourse('K-1', 1), c2 = addCourse('K-2', 1), c3 = addCourse('K-3', 2), c4 = addCourse('K-4', 2);
    db.prepare('INSERT INTO sa_course_prerequisites (course_id, prereq_course_id, min_mark) VALUES (?, ?, 60)').run(c3, c1);
    const addGrade = (courseId, mark, status) => db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'c', 3, ?, ?, 1, 1, '2025/2026', ?, ?, ?)").run(stuId, mark, courseId, mark, now, status);
    addGrade(c1, 80, 'approved'); addGrade(c2, 40, 'approved'); addGrade(c4, 95, 'draft');
    db.prepare("INSERT INTO research_projects (code, title, principal_investigator, faculty_name, domain, status, created_at) VALUES ('R-1', 'بحث', 'د', ?, 'م', 'published', ?)").run(faculty, now);
    const actor = { id: adminId, role: 'admin', display_name: 'adm' };
    const feeType = db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'fee' AND active = 1 ORDER BY id LIMIT 1").get().id;
    createCharge({ db }, actor, { studentId: stuId, feeTypeId: feeType, amount: 1000, dueDay: day }, '127.0.0.1');
    createPayment({ db }, actor, { studentId: stuId, amount: 250, method: 'cash', paidDay: day }, '127.0.0.1');

    const kpis = buildEnterpriseSuiteOverview(db).executiveKpis;
    assert.equal(kpis.overallSuccessRate, 50, 'علامة ناجحة وأخرى راسبة، والمسودة لا تُحسب');
    assert.equal(kpis.financialCollectionRate, 25);
    assert.equal(kpis.researchPublicationsCount, 1);
    assert.deepEqual(kpis.facultiesComparison, [{ faculty, students: 1, successRate: 50, collectionRate: 25, researchPapers: 1 }]);

    const plan = enterpriseOverviewFor(db, { id: stuId, role: 'student', student_no: 'S-1', can: () => false }).advisingPlan;
    assert.deepEqual(plan.map((p) => [p.code, p.status, p.grade, p.prereq]), [['K-1', 'منجز', 80, '—'], ['K-2', 'راسب', 40, '—'], ['K-3', 'متبقي', null, 'K-1'], ['K-4', 'متبقي', null, '—']], 'المسودة لا تظهر في الخطة');
    assert.deepEqual(enterpriseOverviewFor(db, { id: adminId, role: 'admin', can: () => true }).advisingPlan, [], 'الخطة للطالب');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
