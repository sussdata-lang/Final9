import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from '../server/db.js';
import { saveSettings } from '../server/services/settings.js';
import {
  enrollAcceptedApplicant, executeAdmissionsSorting, executeLifecycleMovement, applyRequestMovement,
  grantStudentScholarship, revokeScholarship, suiteOverviewFor, saveProgramAdmissionPlan,
} from '../server/services/student_affairs_suite.js';

const year = new Date().getFullYear();
const PROFILE = { first_name: 'سارة', father_name: 'خالد', last_name: 'النوري', mother_name: 'هدى', gender: 'أنثى', birth_date: '2006-03-01', birth_place: 'حمص', nationality: 'سورية', phone: '0944000111', governorate: 'حمص', city: 'حمص', address: 'الحي الغربي', guardian_name: 'خالد النوري', guardian_relation: 'الأب', guardian_phone: '0944000222' };
const admin = { id: 1, role: 'admin', name: 'مدير النظام', display_name: 'مدير النظام', can: () => true };
const staffWith = (...perms) => ({ id: 2, role: 'staff', name: 'موظف', can: (p) => perms.includes(p) });

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-critical-'));
  const db = await openDb(path.join(dir, 'test.db'), path.resolve('uni-erp/server/migrations'));
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO faculties (id, name, name_en, code, kind, active) VALUES (1, 'كلية', 'Eng', 'ENG', 'college', 1)").run();
  for (const id of [1, 2]) db.prepare("INSERT OR IGNORE INTO programs (id, faculty_id, faculty, name, degree, years, active) VALUES (?, 1, 'كلية', ?, 'بكالوريوس', 4, 1)").run(id, `برنامج ${id}`);
  db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, active, created_at) VALUES (1, 'admin', 'x', 'admin', 'مدير النظام', 1, ?)").run(now);
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

test('حركات القيد: قواعد الانتقال وحد التأجيل القابل للتعديل (6 سنوات افتراضياً)', async () => {
  const t = await setup();
  try {
    t.addStudent(400, 'graduated'); t.addStudent(401, 'withdrawn'); t.addStudent(402); t.addStudent(403);
    const move = (studentId, movementType, extra = {}) => executeLifecycleMovement(t.deps, admin, { studentId, movementType, reason: 'سبب موثق', ...extra }, '::1');
    assert.throws(() => move(400, 'reinstatement'), (e) => e.status === 409, 'لا يُعاد قيد خريج');
    assert.throws(() => move(401, 'withdrawal'), (e) => e.status === 409);
    assert.throws(() => move(402, 'bogus'), (e) => e.status === 400);
    assert.throws(() => move(402, 'program_transfer', { toProgramId: 99999 }), (e) => e.status === 400);

    // 6 سنوات = 12 فصلاً
    for (let i = 0; i < 6; i++) { move(402, 'postponement', { durationSemesters: 2 }); if (i < 5) move(402, 'reinstatement'); }
    move(402, 'reinstatement');
    assert.throws(() => move(402, 'postponement'), (e) => e.status === 409 && /6 سنوات/.test(e.message), 'الفصل الثالث عشر يتجاوز الحد');

    const row = t.db.prepare('SELECT academic_year FROM sa_lifecycle_movements ORDER BY id DESC LIMIT 1').get();
    assert.notEqual(row.academic_year, '2025-2026', 'السنة ليست ثابتة');

    saveSettings(t.deps, admin, { values: { 'students.max_postponement_years': 1 } }, '::1');
    move(403, 'postponement', { durationSemesters: 2 });
    move(403, 'reinstatement');
    assert.throws(() => move(403, 'postponement'), (e) => e.status === 409 && /1 سنوات/.test(e.message), 'تعديل الإعداد يسري فوراً');
  } finally { t.done(); }
});

test('اعتماد طلب تأجيل أو انسحاب أو تحويل يغيّر قيد الطالب', async () => {
  const t = await setup();
  try {
    t.addStudent(500); t.addStudent(501); t.addStudent(502); t.addStudent(503, 'withdrawn');
    const req = (student_id, service_code, details) => ({ student_id, service_code, no: `REQ-${student_id}`, details_json: JSON.stringify(details) });
    const apply = (r) => { t.db.exec('BEGIN'); try { const m = applyRequestMovement(t.deps, admin, r, '::1'); t.db.exec('COMMIT'); return m; } catch (e) { t.db.exec('ROLLBACK'); throw e; } };

    assert.equal(apply(req(500, 'leave_study_freeze', { a: 'فصلان', reason: 'ظرف صحي' })).newStatus, 'suspended');
    assert.equal(Number(t.db.prepare('SELECT duration_semesters d FROM sa_lifecycle_movements WHERE student_id = 500').get().d), 2, 'المدة من الطلب');
    assert.equal(apply(req(501, 'withdrawal', { reason: 'سفر' })).newStatus, 'withdrawn');
    apply(req(502, 'program_transfer', { target_program_id__id: 2, justification: 'رغبة' }));
    assert.equal(Number(profileOf(t.db, 502).program_id), 2);
    assert.throws(() => apply(req(503, 'postponement', { term: 'فصل واحد' })), (e) => e.status === 409, 'حركة لا تصح تمنع الاعتماد');
    assert.equal(apply(req(500, 'student_complaint', {})), null, 'بقية الخدمات لا تمس القيد');
  } finally { t.done(); }
});
