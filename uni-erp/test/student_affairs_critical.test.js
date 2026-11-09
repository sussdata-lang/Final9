import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from '../server/db.js';
import { saveSettings } from '../server/services/settings.js';
import { decide } from '../server/services/requests.js';
import { ready as readyFinance } from '../server/services/finance/core.js';
import { createCharge, voidCharge } from '../server/services/finance/fees.js';
import {
  enrollAcceptedApplicant, executeAdmissionsSorting, executeLifecycleMovement, decideMovementStep,
  grantStudentScholarship, revokeScholarship, suiteOverviewFor, saveProgramAdmissionPlan,
} from '../server/services/student_affairs_suite.js';

const year = new Date().getFullYear();
const PROFILE = { first_name: 'سارة', father_name: 'خالد', last_name: 'النوري', mother_name: 'هدى', gender: 'أنثى', birth_date: '2006-03-01', birth_place: 'حمص', nationality: 'سورية', phone: '0944000111', governorate: 'حمص', city: 'حمص', address: 'الحي الغربي', guardian_name: 'خالد النوري', guardian_relation: 'الأب', guardian_phone: '0944000222' };
const admin = { id: 1, role: 'admin', name: 'مدير النظام', display_name: 'مدير النظام', can: () => true };
const staffWith = (...perms) => ({ id: 2, role: 'staff', name: 'موظف', can: (p) => perms.includes(p) });
// معتمد مختلف عن مقدّم الحركة
const chief = { id: 9, role: 'admin', name: 'رئيس الجامعة', display_name: 'رئيس الجامعة', label: 'رئيس الجامعة', can: () => true };
const finishChain = (t, id) => { for (;;) { const r = decideMovementStep(t.deps, chief, id, { decision: 'approve' }, '::1'); if (r.status !== 'pending') return r; } };

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-critical-'));
  const db = await openDb(path.join(dir, 'test.db'), path.resolve('uni-erp/server/migrations'));
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO faculties (id, name, name_en, code, kind, active) VALUES (1, 'كلية', 'Eng', 'ENG', 'college', 1)").run();
  for (const id of [1, 2]) db.prepare("INSERT OR IGNORE INTO programs (id, faculty_id, faculty, name, degree, years, active) VALUES (?, 1, 'كلية', ?, 'بكالوريوس', 4, 1)").run(id, `برنامج ${id}`);
  db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, active, created_at) VALUES (1, 'admin', 'x', 'admin', 'مدير النظام', 1, ?)").run(now);
  for (const [id, name] of [[2, 'موظف'], [9, 'رئيس الجامعة']]) db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, active, created_at) VALUES (?, ?, 'x', 'staff', ?, 1, ?)").run(id, `s${id}`, name, now);
  db.prepare("SELECT setval(pg_get_serial_sequence('users','id'), 5000)").get();
  const addStudent = (id, status = 'active', program = 1, enrollYear = 2024) => {
    db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, student_no, active, created_at) VALUES (?, ?, 'x', 'student', ?, ?, 1, ?)").run(id, `u${id}`, `طالب ${id}`, `ENG-2026-${id}`, now);
    db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, guardian_name, guardian_relation, guardian_phone, status, created_at, updated_at)
      VALUES (?, 'طالب','أب','كنية','أم', ?, 'ذكر','2005-01-01','دمشق','سورية','0944111222','دمشق','المزة','عنوان','الفرع العلمي',2024,220,?,'القبول العام',?,'الفصل الأول',1,'ولي','الأب','0944111222',?,?,?)`).run(id, String(10000000000 + id), program, enrollYear, status, now, now);
  };
  const addApplicant = (no, name, nid, score, status, program = 1) => Number(db.prepare("INSERT INTO sa_applicants (application_no, full_name, national_id, phone, hs_type, hs_score, hs_year, category, pref1_program_id, accepted_program_id, sorting_status, created_at) VALUES (?,?,?,?,'علمي',?,2026,'general',?,?,?,?) RETURNING id").get(no, name, nid, '0933000000', score, program, status === 'accepted' ? program : null, status, now).id);
  return { db, deps: { db, cfg: { scryptN: 1024 } }, addStudent, addApplicant, done: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const profileOf = (db, id) => db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(id);

test('النظرة الشاملة: لا يصل قسم إلا لمن يملك صلاحيته', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    t.addApplicant('A-1', 'متقدم أول ثالث', '91000000010', 220, 'pending');
    t.db.prepare("INSERT INTO student_holds (student_id, hold_type, note, active, created_by, created_at) VALUES (10, 'disciplinary', 'سرّي', 1, 1, ?)").run(Date.now());

    const library = suiteOverviewFor(t.deps, staffWith('request:read_unit'), {});
    assert.equal(library.admissions.applicants.length, 0, 'موظف بلا صلاحية قبول لا يرى المتقدمين');
    assert.equal(library.lifecycle.disciplinaryRecords.length, 0, 'ولا السجلات الانضباطية');
    assert.equal(library.access.admissions, false);

    const admissions = suiteOverviewFor(t.deps, staffWith('sa_admissions:view'), {});
    assert.equal(admissions.admissions.applicants.length, 1);
    assert.equal(admissions.lifecycle.disciplinaryRecords.length, 0, 'صلاحية القبول لا تكشف الانضباط');

    const discipline = suiteOverviewFor(t.deps, staffWith('sa_discipline:view'), {});
    assert.equal(discipline.lifecycle.disciplinaryRecords.length, 1);
    assert.equal(discipline.admissions.applicants.length, 0);

    assert.equal(suiteOverviewFor(t.deps, admin, {}).admissions.applicants.length, 1, 'المدير يرى الكل');
  } finally { t.done(); }
});

test('التثبيت: لا يُثبَّت إلا مقبول، وببيانات مدخلة لا مختلقة', async () => {
  const t = await setup();
  try {
    const rejected = t.addApplicant('A-2', 'سارة خالد النوري', '91000000020', 100, 'rejected');
    await assert.rejects(() => enrollAcceptedApplicant(t.deps, admin, rejected, PROFILE, '::1'), (e) => e.status === 409);

    const accepted = t.addApplicant('A-3', 'سارة خالد النوري', '91000000030', 230, 'accepted');
    await assert.rejects(() => enrollAcceptedApplicant(t.deps, admin, accepted, {}, '::1'), (e) => e.status === 400, 'بلا بيانات شخصية يُرفض');
    assert.equal(t.db.prepare('SELECT sorting_status s FROM sa_applicants WHERE id = ?').get(accepted).s, 'accepted', 'الفشل يعيد المتقدم إلى حالته');

    const r = await enrollAcceptedApplicant(t.deps, admin, accepted, PROFILE, '::1');
    const p = profileOf(t.db, r.student.id);
    assert.equal(p.gender, 'أنثى');
    assert.equal(p.mother_name, 'هدى');
    assert.equal(p.birth_date, '2006-03-01');
    await assert.rejects(() => enrollAcceptedApplicant(t.deps, admin, accepted, PROFILE, '::1'), (e) => e.status === 409, 'لا يُثبَّت مرتين');
  } finally { t.done(); }
});

test('الفرز: المقاعد لدفعة هذه السنة فقط، والحدود من خطة البرنامج', async () => {
  const t = await setup();
  try {
    for (let i = 100; i < 140; i++) t.addStudent(i, 'active', 2, 2024);   // طلاب سنوات سابقة لا يشغلون مقاعد الدفعة
    const top = t.addApplicant('A-4', 'أعلى متقدم', '91000000040', 239, 'pending', 2);
    executeAdmissionsSorting(t.deps, admin, '::1');
    assert.equal(t.db.prepare('SELECT sorting_status s FROM sa_applicants WHERE id = ?').get(top).s, 'accepted');
    const low = t.addApplicant('A-5', 'مجموع منخفض', '91000000050', 60, 'pending', 2);
    executeAdmissionsSorting(t.deps, admin, '::1');
    assert.equal(t.db.prepare('SELECT sorting_status s FROM sa_applicants WHERE id = ?').get(low).s, 'accepted', 'لا يوجد حد أدنى للقبول');
    t.db.prepare('DELETE FROM sa_applicants WHERE id = ?').run(low);

    saveProgramAdmissionPlan(t.deps, admin, 2, { minScore: 239.5, capacity: 5 }, '::1');
    executeAdmissionsSorting(t.deps, admin, '::1');
    assert.equal(t.db.prepare('SELECT sorting_status s FROM sa_applicants WHERE id = ?').get(top).s, 'rejected', 'الحد الأدنى للبرنامج يُطبَّق');

    saveProgramAdmissionPlan(t.deps, admin, 2, { minScore: 100, capacity: 1 }, '::1');
    t.addStudent(200, 'active', 2, year);   // المقعد الوحيد مشغول من دفعة هذه السنة
    executeAdmissionsSorting(t.deps, admin, '::1');
    assert.equal(t.db.prepare('SELECT sorting_status s FROM sa_applicants WHERE id = ?').get(top).s, 'waitlisted');

    assert.throws(() => saveProgramAdmissionPlan(t.deps, staffWith('sa_admissions:view'), 2, { capacity: 9 }, '::1'), (e) => e.status === 403);
  } finally { t.done(); }
});

test('المنح: لا تكرار ولا تجاوز 100% ولا مبلغ أكبر من القسط، ويمكن إلغاؤها', async () => {
  const t = await setup();
  try {
    t.addStudent(300);
    const grant = (b) => grantStudentScholarship(t.deps, admin, { studentId: 300, academicYear: '2026/2027', baseTuition: 1000000, ...b }, '::1');
    assert.throws(() => grant({ scholarshipType: 'merit_top' }), (e) => e.status === 400, 'التفوق يتطلب معدلاً');
    assert.throws(() => grant({ scholarshipType: 'bogus', gpa: 90 }), (e) => e.status === 400);
    assert.throws(() => grant({ scholarshipType: 'social_aid', amount: 2000000, discountPercent: 5 }), (e) => e.status === 400);
    assert.throws(() => grantStudentScholarship(t.deps, admin, { studentId: 300, scholarshipType: 'social_aid' }, '::1'), (e) => e.status === 400, 'القسط مطلوب');

    const first = grant({ scholarshipType: 'social_aid' });   // 40%
    assert.throws(() => grant({ scholarshipType: 'social_aid' }), (e) => e.status === 409, 'لا يتكرر النوع نفسه');
    assert.throws(() => grant({ scholarshipType: 'martyrs_kin' }), (e) => e.status === 409, 'لا يتجاوز المجموع 100%');

    assert.throws(() => revokeScholarship(t.deps, admin, first.id, {}, '::1'), (e) => e.status === 400, 'السبب مطلوب');
    assert.throws(() => revokeScholarship(t.deps, staffWith('student:update'), first.id, { reason: 'خطأ إدخال' }, '::1'), (e) => e.status === 403);
    revokeScholarship(t.deps, admin, first.id, { reason: 'خطأ إدخال' }, '::1');
    assert.equal(t.db.prepare('SELECT status FROM sa_scholarships WHERE id = ?').get(first.id).status, 'revoked');
    assert.equal(t.db.prepare('SELECT status FROM fin_charges WHERE id = ?').get(first.finChargeId).status, 'void', 'يُعكس القيد المالي');
    assert.throws(() => revokeScholarship(t.deps, admin, first.id, { reason: 'مرة ثانية' }, '::1'), (e) => e.status === 409);
    assert.equal(grant({ scholarshipType: 'martyrs_kin' }).discountPercent, 100, 'بعد الإلغاء يتحرر الحد');
  } finally { t.done(); }
});

test('حركات القيد: قواعد الانتقال وحد التأجيل القابل للتعديل (سنتان افتراضياً)', async () => {
  const t = await setup();
  try {
    t.addStudent(400, 'graduated'); t.addStudent(401, 'withdrawn'); t.addStudent(402); t.addStudent(403); t.addStudent(404);
    const move = (studentId, movementType, extra = {}) => executeLifecycleMovement(t.deps, admin, { studentId, movementType, reason: 'سبب موثق', ...extra }, '::1');
    const done = (studentId, type, extra) => finishChain(t, move(studentId, type, extra).id);
    assert.throws(() => move(400, 'reinstatement'), (e) => e.status === 409, 'لا يُعاد قيد خريج');
    assert.throws(() => move(401, 'withdrawal'), (e) => e.status === 409);
    assert.throws(() => move(402, 'bogus'), (e) => e.status === 400);
    assert.throws(() => move(402, 'program_transfer', { toProgramId: 99999 }), (e) => e.status === 400);

    // سنتان = 4 فصول
    for (let i = 0; i < 2; i++) { done(402, 'postponement', { durationSemesters: 2 }); done(402, 'reinstatement'); }
    assert.throws(() => move(402, 'postponement'), (e) => e.status === 409 && /2 سنوات/.test(e.message), 'الفصل الخامس يتجاوز الحد');
    assert.notEqual(t.db.prepare('SELECT academic_year FROM sa_lifecycle_movements ORDER BY id DESC LIMIT 1').get().academic_year, '2025-2026', 'السنة ليست ثابتة');

    saveSettings(t.deps, admin, { values: { 'students.max_postponement_years': 1 } }, '::1');
    done(403, 'postponement', { durationSemesters: 2 });
    done(403, 'reinstatement');
    assert.throws(() => move(403, 'postponement'), (e) => e.status === 409 && /1 سنوات/.test(e.message), 'تعديل الإعداد يسري فوراً');

    // التأجيل المعلق يُحتسب: لا يتجاوز الحد بطلبات قبل صدور القرار
    move(404, 'postponement', { durationSemesters: 2 });
    assert.throws(() => move(404, 'postponement'), (e) => e.status === 409, 'حركة معلقة واحدة لكل طالب');
  } finally { t.done(); }
});

test('سلسلة الاعتماد: لا يتغير القيد قبل القرار النهائي، وبالترتيب، ولكل مرحلة صاحبها', async () => {
  const t = await setup();
  try {
    t.addStudent(600); t.addStudent(601);
    readyFinance(t.db);
    const status = (id) => profileOf(t.db, id).status;
    const step = (id, actor, decision, note) => decideMovementStep(t.deps, actor, id, { decision, note }, '::1');
    const m = executeLifecycleMovement(t.deps, admin, { studentId: 600, movementType: 'withdrawal', reason: 'سفر' }, '::1');
    assert.equal(m.status, 'pending'); assert.equal(m.totalSteps, 5);
    assert.equal(status(600), 'active', 'التقديم لا يغيّر القيد');

    const finance = staffWith('finance:fees'), library = staffWith('lms_lib:approve'), affairs = staffWith('student:update');
    const dean = staffWith('sa_lifecycle:dean'), president = staffWith('sa_lifecycle:final');
    assert.throws(() => step(m.id, president, 'approve'), (e) => e.status === 403, 'لا قفز فوق المراحل');
    assert.throws(() => step(m.id, library, 'approve'), (e) => e.status === 403);

    // براءة الذمة المالية تُرفض ما دامت عليه مستحقات
    const feeType = t.db.prepare("SELECT id FROM fin_fee_types WHERE kind <> 'discount' AND active = 1 ORDER BY id LIMIT 1").get().id;
    const charge = createCharge(t.deps, admin, { studentId: 600, feeTypeId: feeType, amount: 5000, dueDay: '2026-11-01', academicYear: '2026/2027', note: 'رسم' }, '::1');
    assert.throws(() => step(m.id, finance, 'approve'), (e) => e.code === 'clearance_blocked' && /مستحقات/.test(e.message));
    voidCharge(t.deps, admin, charge.id, { reason: 'تسوية' }, '::1');
    assert.equal(step(m.id, finance, 'approve').status, 'pending');

    // براءة ذمة المكتبة تُرفض مع إعارة غير مُعادة
    const book = Number(t.db.prepare("INSERT INTO library_books (isbn, title, author, category, created_at) VALUES ('1','ك','م','ع',?) RETURNING id").get(Date.now()).id);
    const loan = Number(t.db.prepare("INSERT INTO library_loans (book_id, borrower_name, borrower_no, loan_date, due_date, created_at) VALUES (?,'ط','ENG-2026-600','2026-01-01','2026-02-01',?) RETURNING id").get(book, Date.now()).id);
    assert.throws(() => step(m.id, library, 'approve'), (e) => e.code === 'clearance_blocked' && /إعارة/.test(e.message));
    t.db.prepare("UPDATE library_loans SET return_date = '2026-02-01', status = 'returned' WHERE id = ?").run(loan);
    step(m.id, library, 'approve');

    assert.throws(() => step(m.id, dean, 'not_applicable'), (e) => e.status === 403);
    assert.equal(step(m.id, affairs, 'not_applicable').status, 'pending', 'المخابر: لا ينطبق');
    assert.throws(() => step(m.id, dean, 'not_applicable'), (e) => e.status === 400, 'لا ينطبق للمخابر فقط');

    // العميد المقيد بكلية أخرى لا يصل إلى الحركة
    const otherDean = { ...dean, data_scope: 'faculty', scope_faculty: 'كلية أخرى' };
    assert.throws(() => step(m.id, otherDean, 'approve'), (e) => e.status === 404);
    const ownFaculty = t.db.prepare('SELECT g.faculty FROM student_profiles p JOIN programs g ON g.id = p.program_id WHERE p.user_id = 600').get().faculty;
    const ownDean = { ...dean, data_scope: 'faculty', scope_faculty: ownFaculty };
    step(m.id, ownDean, 'approve');
    assert.equal(status(600), 'active', 'موافقة العميد لا تكفي');

    const r = step(m.id, president, 'approve');
    assert.equal(r.status, 'approved'); assert.equal(r.newStatus, 'withdrawn');
    assert.equal(status(600), 'withdrawn', 'القرار النهائي يثبّت القيد');
    assert.throws(() => step(m.id, president, 'approve'), (e) => e.status === 409, 'لا بت مرتين');
    assert.ok(t.db.prepare("SELECT 1 AS x FROM user_notifications WHERE user_id = 600 AND kind = 'lifecycle'").get(), 'يُبلَّغ الطالب');

    // فصل المهام: مقدّم الحركة لا يعتمدها
    const own = executeLifecycleMovement(t.deps, staffWith('student:update'), { studentId: 601, movementType: 'suspension', reason: 'قرار' }, '::1');
    assert.throws(() => step(own.id, { ...dean, id: 2 }, 'approve'), (e) => e.status === 403 && /فصل المهام/.test(e.message));
    assert.throws(() => step(own.id, dean, 'reject'), (e) => e.status === 400 || e.status === 403);
    const rej = decideMovementStep(t.deps, { ...dean, id: 77 }, own.id, { decision: 'reject', note: 'لا يستوفي الشروط' }, '::1');
    assert.equal(rej.status, 'rejected'); assert.equal(status(601), 'active', 'الرفض لا يغيّر القيد');
  } finally { t.done(); }
});

test('طلب الطالب: موافقة الشعبة تدخله السلسلة، ويبقى قيد المراجعة حتى القرار النهائي', async () => {
  const t = await setup();
  try {
    t.addStudent(500); t.addStudent(501); t.addStudent(502); t.addStudent(503, 'withdrawn');
    const now = Date.now();
    t.db.prepare("INSERT OR IGNORE INTO service_types (code, label, description, sla_hours, issues_document, fields_json) VALUES ('leave_study_freeze', 'طلب تجميد الدراسة', 'تجميد', 120, 0, '[]')").run();
    const req = (id, student, code, details) => { t.db.prepare("INSERT INTO requests (id, no, student_id, service_code, details_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'review', ?)").run(id, `REQ-${id}`, student, code, JSON.stringify(details), now); return id; };
    const reqStatus = (id) => t.db.prepare('SELECT status FROM requests WHERE id = ?').get(id).status;
    const clerk = { ...chief, id: 2, label: 'شعبة شؤون الطلاب' };
    const movementOf = (rid) => t.db.prepare('SELECT * FROM sa_lifecycle_movements WHERE request_id = ?').get(rid);

    const freeze = req(9001, 500, 'leave_study_freeze', { a: 'فصلان', reason: 'ظرف صحي' });
    decide(t.deps, clerk, freeze, 'approve', null, '::1');
    assert.equal(reqStatus(freeze), 'review', 'يبقى قيد المراجعة');
    assert.equal(profileOf(t.db, 500).status, 'active');
    assert.equal(Number(movementOf(freeze).duration_semesters), 2, 'المدة من الطلب');
    assert.throws(() => decide(t.deps, clerk, freeze, 'approve', null, '::1'), (e) => e.code === 'in_approval_chain', 'لا يُبت فيه خارج السلسلة');
    finishChain(t, movementOf(freeze).id);
    assert.equal(reqStatus(freeze), 'approved');
    assert.equal(profileOf(t.db, 500).status, 'suspended');

    const out = req(9002, 501, 'withdrawal', { reason: 'سفر' });
    decide(t.deps, clerk, out, 'approve', null, '::1');
    assert.equal(Number(t.db.prepare('SELECT COUNT(*) c FROM sa_movement_steps WHERE movement_id = ?').get(movementOf(out).id).c), 5, 'ترقين القيد بخمس مراحل');
    finishChain(t, movementOf(out).id);
    assert.equal(profileOf(t.db, 501).status, 'withdrawn');

    const move = req(9003, 502, 'program_transfer', { target_program_id__id: 2, justification: 'رغبة' });
    decide(t.deps, clerk, move, 'approve', null, '::1');
    assert.equal(Number(profileOf(t.db, 502).program_id), 1, 'لا تحويل قبل القرار');
    finishChain(t, movementOf(move).id);
    assert.equal(Number(profileOf(t.db, 502).program_id), 2);

    const bad = req(9004, 503, 'postponement', { term: 'فصل واحد' });
    assert.throws(() => decide(t.deps, clerk, bad, 'approve', null, '::1'), (e) => e.status === 409, 'حركة لا تصح تمنع الإحالة');

    // الرفض في أي مرحلة يرفض الطلب بسببه
    t.db.prepare("UPDATE student_profiles SET status = 'active' WHERE user_id = 503").run();
    t.db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").run(bad);
    const rej = req(9005, 503, 'postponement', { term: 'فصل واحد' });
    decide(t.deps, clerk, rej, 'approve', null, '::1');
    decideMovementStep(t.deps, chief, movementOf(rej).id, { decision: 'reject', note: 'غير مستوف' }, '::1');
    assert.equal(reqStatus(rej), 'rejected');
    assert.equal(t.db.prepare('SELECT reject_reason FROM requests WHERE id = ?').get(rej).reject_reason, 'غير مستوف');
  } finally { t.done(); }
});
