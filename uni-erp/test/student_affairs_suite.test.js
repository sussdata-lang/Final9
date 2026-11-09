import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from '../server/db.js';
import {
  runAutomatedAdmissionsSort,
  calculateTransferEquivalenceSummary,
  buildCoursePrerequisiteTree,
  calculateScholarshipGrant,
  buildFiveStageRequestTracker,
  getStudentAffairsSuiteOverview,
  executeAdmissionsSorting,
  executeLifecycleMovement,
  grantStudentScholarship,
  bookDeskAppointment,
} from '../server/services/student_affairs_suite.js';

// متقدمون من كل الفئات؛ النظام لم يعد يزرعهم
const addApplicants = (db) => {
  const [p1, p2 = p1, p3 = p1] = db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id').all().map((p) => p.id), now = Date.now();
  const ins = db.prepare(`INSERT INTO sa_applicants (application_no, full_name, national_id, phone, hs_type, hs_score, hs_year, category, pref1_program_id, pref2_program_id, pref3_program_id, sorting_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 2026, ?, ?, ?, ?, 'pending', ?)`);
  ins.run('ADM-T-1', 'متقدم أول', '91020034912', '0944112233', 'علمي', 228.5, 'general', p1, p2, p3, now);
  ins.run('ADM-T-2', 'متقدم ثان', '91040088219', '0933556677', 'علمي', 214, 'martyrs', p1, p2, p3, now);
  ins.run('ADM-T-3', 'متقدم ثالث', '92010099114', '0988776655', 'علمي', 196, 'parallel', p2, p3, p1, now);
  ins.run('ADM-T-4', 'متقدم رابع', '94010077321', '0955443322', 'أدبي', 184.5, 'general', p1, p2, p3, now);
  ins.run('ADM-T-5', 'متقدم خامس', '91090044510', '0991223344', 'علمي', 221, 'transfer', p1, p2, null, now);
};

test('1-A. Pure Logic: runAutomatedAdmissionsSort sorts applicants by score + priority and respects capacity', () => {
  const programs = [
    { id: 1, name: 'الأمن السيبراني', minScore: 210, capacity: 1, enrolledCount: 0 },
    { id: 2, name: 'العلوم القانونية', minScore: 180, capacity: 2, enrolledCount: 0 },
  ];
  const applicants = [
    { id: 10, application_no: 'ADM-1', hs_score: 205, category: 'martyrs', pref1_program_id: 1, pref2_program_id: 2 }, // effective 213 -> gets seat 1 in prog 1
    { id: 11, application_no: 'ADM-2', hs_score: 212, category: 'general', pref1_program_id: 1, pref2_program_id: 2 }, // prog 1 full -> gets prog 2
    { id: 12, application_no: 'ADM-3', hs_score: 165, category: 'general', pref1_program_id: 1, pref2_program_id: 2 }, // below cutoff -> rejected
  ];

  const sorted = runAutomatedAdmissionsSort(applicants, programs);
  const res10 = sorted.find((r) => r.id === 10);
  const res11 = sorted.find((r) => r.id === 11);
  const res12 = sorted.find((r) => r.id === 12);

  assert.equal(res10.status, 'accepted');
  assert.equal(res10.acceptedProgramId, 1);
  assert.equal(res11.status, 'accepted');
  assert.equal(res11.acceptedProgramId, 2);
  assert.equal(res12.status, 'rejected');
});

test('1-B. Pure Logic: calculateTransferEquivalenceSummary computes exempted and remaining credit hours', () => {
  const eqs = [
    { external_hours: 4, equivalence_status: 'approved' },
    { external_hours: 3, equivalence_status: 'approved' },
    { external_hours: 3, equivalence_status: 'pending' },
  ];
  const summary = calculateTransferEquivalenceSummary(eqs, 132);
  assert.equal(summary.approvedCoursesCount, 2);
  assert.equal(summary.pendingCoursesCount, 1);
  assert.equal(summary.earnedHours, 7);
  assert.equal(summary.remainingHours, 125);
});

test('2. Pure Logic: buildCoursePrerequisiteTree classifies completed, in_progress, available, and locked courses', () => {
  const courses = [
    { id: 1, code: 'CS101', name: 'برمجة 1', level: 1, semester: 1, hours: 3 },
    { id: 2, code: 'CS102', name: 'برمجة 2', level: 1, semester: 2, hours: 3 },
    { id: 3, code: 'CS201', name: 'تراكيب بيانات', level: 2, semester: 1, hours: 3 },
  ];
  const grades = [{ courseId: 1, total: 85, passed: true }];
  const prereqs = [
    { course_id: 2, prereq_course_id: 1, min_mark: 60 },
    { course_id: 3, prereq_course_id: 2, min_mark: 60 },
  ];

  const tree = buildCoursePrerequisiteTree(courses, grades, prereqs, 1);
  const c1 = tree.nodes.find((n) => n.id === 1);
  const c2 = tree.nodes.find((n) => n.id === 2);
  const c3 = tree.nodes.find((n) => n.id === 3);

  assert.equal(c1.state, 'completed');
  assert.equal(c2.state, 'in_progress'); // prereq 1 passed, level === 1
  assert.equal(c3.state, 'locked'); // prereq 2 not passed yet
  assert.deepEqual(c3.missingPrereqs, ['برمجة 2']);
});

test('5. Pure Logic: calculateScholarshipGrant calculates discount percent and monetary grant accurately', () => {
  const merit90 = calculateScholarshipGrant({ scholarshipType: 'merit_top', baseTuition: 1500000, gpa: 90 });
  assert.equal(merit90.discountPercent, 50);
  assert.equal(merit90.amount, 750000);
  assert.equal(merit90.netPayable, 750000);

  const martyrs = calculateScholarshipGrant({ scholarshipType: 'martyrs_kin', baseTuition: 1500000, gpa: 75 });
  assert.equal(martyrs.discountPercent, 100);
  assert.equal(martyrs.amount, 1500000);
  assert.equal(martyrs.netPayable, 0);
});

test('6. Pure Logic: buildFiveStageRequestTracker returns 5 workflow stages reflecting unit and queue appointment', () => {
  const stages = buildFiveStageRequestTracker(
    { id: 5, status: 'approved', unit: { name: 'كلية الأمن السيبراني' }, document: { code: 'UV-2026-0001' } },
    { ticket_no: 'Q-105', appointment_date: '2026-10-27', time_slot: '10:00 - 10:30', queue_status: 'serving' }
  );
  assert.equal(stages.length, 5);
  assert.equal(stages[0].state, 'done');
  assert.equal(stages[3].state, 'done');
  assert.equal(stages[4].state, 'cur');
  assert.ok(stages[4].subtitle.includes('Q-105'));
});

test('Database Integration: Student Affairs Suite (1, 2, 3, 5, 6) seeds and executes workflows on PostgreSQL', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-suite-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const migrationsDir = path.resolve('uni-erp/server/migrations');
  const db = await openDb(dbPath, migrationsDir);

  // Create minimal program and student for integration test
  db.prepare("INSERT OR IGNORE INTO faculties (id, name, name_en, code, kind, active) VALUES (1, 'كلية الهندسة', 'Engineering', 'ENG', 'college', 1)").run();
  db.prepare("INSERT OR IGNORE INTO programs (id, faculty_id, faculty, name, degree, years, active) VALUES (1, 1, 'كلية الهندسة', 'الأمن السيبراني', 'بكالوريوس', 4, 1)").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, student_no, active, created_at) VALUES (1, 'admin', 'x', 'admin', 'مدير النظام', NULL, 1, ?)").run(Date.now());
  db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, student_no, active, created_at) VALUES (3, 'ENG-2026-0001', 'x', 'student', 'طارق العلي', 'ENG-2026-0001', 1, ?)").run(Date.now());
  db.prepare(`
    INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (3, 'طارق', 'محمود', 'العلي', 'سعاد', '01010011223', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, 1, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'محمود العلي', 'أب', '0944111222', ?, ?)
  `).run(Date.now(), Date.now());

  const deps = { db, cfg: { scryptN: 1024 } };
  const actor = { id: 1, role: 'admin', name: 'مدير النظام', display_name: 'مدير النظام' };

  const empty = getStudentAffairsSuiteOverview(deps);
  assert.equal(empty.admissions.applicants.length, 0, 'لا متقدمين مزروعين');
  assert.equal(empty.scholarships.list.length, 0, 'لا منح مزروعة');
  assert.equal(empty.deskQueue.appointments.length, 0, 'لا مواعيد مزروعة');
  assert.equal(Number(db.prepare('SELECT COUNT(*) c FROM courses').get().c), 0, 'فتح الشاشة لا ينشئ مقررات');
  assert.equal(Number(db.prepare('SELECT COUNT(*) c FROM grades').get().c), 0, 'ولا علامات');
  addApplicants(db);
  const overview = getStudentAffairsSuiteOverview(deps);
  assert.equal(overview.admissions.applicants.length, 5);

  // Execute automated admissions sorting
  const sortRes = executeAdmissionsSorting(deps, actor, '127.0.0.1');
  assert.ok(sortRes.sortedCount >= 5);

  // Execute lifecycle movement (postponement -> changes student status to suspended)
  const movRes = executeLifecycleMovement(
    deps,
    actor,
    { studentId: 3, movementType: 'postponement', reason: 'ظروف صحية موثقة' },
    '127.0.0.1'
  );
  assert.equal(movRes.newStatus, 'suspended');
  const updatedStatus = db.prepare('SELECT status FROM student_profiles WHERE user_id = 3').get().status;
  assert.equal(updatedStatus, 'suspended');

  // Grant scholarship
  const schRes = grantStudentScholarship(
    deps,
    actor,
    { studentId: 3, scholarshipType: 'merit_top', baseTuition: 1500000, gpa: 93, note: 'المركز الأول' },
    '127.0.0.1'
  );
  assert.equal(schRes.discountPercent, 100);
  assert.equal(schRes.amount, 1500000);

  // المنحة مربوطة بقيد خصم فعلي على حساب الخصومات المعرَّف
  const charge = db.prepare('SELECT c.*, ft.code, c.entry_id FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id WHERE c.id = ?').get(schRes.finChargeId);
  assert.ok(charge?.entry_id, 'يجب ترحيل قيد الخصم');
  assert.equal(charge.code, 'scholarship');
  assert.equal(db.prepare('SELECT fin_charge_id FROM sa_scholarships WHERE id = ?').get(schRes.id).fin_charge_id, schRes.finChargeId);
  const countGrants = () => Number(db.prepare('SELECT COUNT(*) AS c FROM sa_scholarships').get().c);
  const grants = countGrants();

  // فشل القيد يصل إلى المستخدم ولا يترك منحة بلا خصم
  assert.throws(() => grantStudentScholarship(deps, actor, { studentId: 999999, scholarshipType: 'martyrs_kin', baseTuition: 1000 }, '127.0.0.1'), (e) => e.status === 400 || e.status === 404);
  assert.equal(countGrants(), grants);
  assert.throws(() => grantStudentScholarship(deps, actor, { studentId: 3, scholarshipType: 'martyrs_kin', baseTuition: 1000, amount: -5 }, '127.0.0.1'), (e) => e.status === 400);
  assert.equal(countGrants(), grants);

  // غياب نوع الخصم يوقف المنح ولا يُنشئ نوعًا على حساب عشوائي
  db.prepare("UPDATE fin_fee_types SET active = 0 WHERE kind = 'discount'").run();
  assert.throws(() => grantStudentScholarship(deps, actor, { studentId: 3, scholarshipType: 'martyrs_kin', baseTuition: 1000 }, '127.0.0.1'), (e) => e.status === 409);
  assert.equal(countGrants(), grants);
  assert.equal(db.prepare("SELECT 1 AS x FROM fin_fee_types WHERE code = 'SCH-DISC'").get(), undefined);
  db.prepare("UPDATE fin_fee_types SET active = 1 WHERE kind = 'discount'").run();

  // Book smart queue appointment
  const qRes = bookDeskAppointment(
    deps,
    actor,
    { studentId: 3, servicePurpose: 'استلام كشف علامات', timeSlot: '11:00 - 11:30' },
    '127.0.0.1'
  );
  assert.ok(qRes.ticketNo.startsWith('Q-'));

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('تثبيت القيد كطالب نظامي: كل فئات المتقدمين تُقبل (قيم الشهادة ونوع القبول وصلة القرابة تطابق قوائم الإعدادات)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-enroll-test-'));
  const db = await openDb(path.join(tmpDir, 'test.db'), path.resolve('uni-erp/server/migrations'));
  db.prepare("INSERT OR IGNORE INTO faculties (id, name, name_en, code, kind, active) VALUES (1, 'كلية الهندسة', 'Engineering', 'ENG', 'college', 1)").run();
  db.prepare("INSERT OR IGNORE INTO programs (id, faculty_id, faculty, name, degree, years, active) VALUES (1, 1, 'كلية الهندسة', 'الأمن السيبراني', 'بكالوريوس', 4, 1)").run();
  db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, display_name, student_no, active, created_at) VALUES (1, 'admin', 'x', 'admin', 'مدير النظام', NULL, 1, ?)").run(Date.now());
  db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, display_name, student_no, active, created_at) VALUES (3, 'ENG-2026-0001', 'x', 'student', 'طارق العلي', 'ENG-2026-0001', 1, ?)").run(Date.now());
  db.prepare(`
    INSERT OR IGNORE INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (3, 'طارق', 'محمود', 'العلي', 'سعاد', '01010011223', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, 1, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'محمود العلي', 'أب', '0944111222', ?, ?)
  `).run(Date.now(), Date.now());
  for (const tbl of ['users', 'student_profiles']) { try { db.exec(`SELECT setval(pg_get_serial_sequence('${tbl}','id'), (SELECT COALESCE(MAX(id),1) FROM ${tbl}))`); } catch {} }
  const deps = { db, cfg: { scryptN: 1024 } };
  const actor = { id: 1, role: 'admin', name: 'مدير النظام', display_name: 'مدير النظام' };
  addApplicants(db);
  const overview = getStudentAffairsSuiteOverview(deps);
  const { enrollAcceptedApplicant } = await import('../server/services/student_affairs_suite.js');
  const apps = db.prepare("SELECT id, category, hs_type FROM sa_applicants WHERE sorting_status <> 'enrolled'").all();
  assert.ok(apps.length >= 1);
  const cats = new Set();
  for (const [i, a] of apps.entries()) {
    db.prepare("UPDATE sa_applicants SET accepted_program_id = 1, sorting_status = 'accepted' WHERE id = ?").run(a.id);
    const r = await enrollAcceptedApplicant(deps, actor, a.id, { first_name: 'سامي', father_name: 'خالد', last_name: 'النوري', mother_name: 'هدى', gender: 'ذكر', birth_date: new Date(Date.UTC(2006, 2, 1 + i)).toISOString().slice(0, 10), birth_place: 'حمص', nationality: 'سورية', phone: '0944000111', governorate: 'حمص', city: 'حمص', address: 'الحي الغربي', guardian_name: 'خالد النوري', guardian_relation: 'الأب', guardian_phone: '0944000222' }, '127.0.0.1');
    assert.ok(r.student.studentNo, `تعذّر تثبيت المتقدم ${a.id} (${a.category} / ${a.hs_type})`);
    cats.add(a.category);
  }
  assert.ok(overview && cats.size >= 1);
});
