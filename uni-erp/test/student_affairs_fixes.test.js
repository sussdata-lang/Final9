import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from '../server/db.js';
import { updateStudent, deleteStudent } from '../server/services/students.js';
import {
  addTransferEquivalence, decideTransferEquivalence, createAdvisingSession, bookDeskAppointment,
  executeLifecycleMovement, decideMovementStep, createDisciplinaryRecord, expireDisciplinaryHolds,
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

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const status = (e, code) => e.status === code;
const holdActive = (db, id) => Number(db.prepare('SELECT active FROM student_holds WHERE id = ?').get(id).active);
const addCourse = (db, id = 70) => db.prepare("INSERT INTO courses (id, code, name, hours, program_id, level, semester, active) VALUES (?, ?, ?, 3, 1, 1, 1, 1)").run(id, `C-${id}`, `مقرر معادل ${id}`);
const addGrade = (db, sid, cid, mark, hours = 3) => db.prepare("INSERT INTO grades (student_id, course_id, course, term, hours, mark, academic_year, semester, level, workflow_status, entered_at) VALUES (?, ?, 'م', 'الفصل الأول', ?, ?, '2026', 1, 1, 'approved', ?)").run(sid, cid, hours, mark, Date.now());

test('العقوبة: تنتهي عند تاريخها، ولا تاريخ افتراضي، ولا تاريخ ماضٍ', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    const open = createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'مخالفة بلا تاريخ' }, '::1');
    assert.equal(t.db.prepare('SELECT expires_at FROM sa_disciplinary_details WHERE hold_id = ?').get(open.holdId).expires_at, null, 'لا تاريخ مختلق');
    const later = createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'مخالفة', expiresAt: iso(5) }, '::1');
    assert.throws(() => createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'ماضية', expiresAt: '2020-01-01' }, '::1'), (e) => status(e, 400));
    assert.throws(() => createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'تاريخ خطأ', expiresAt: '2026-02-31' }, '::1'), (e) => status(e, 400));
    // عقوبة منتهية منذ زمن
    const old = createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'قديمة', expiresAt: iso(1) }, '::1');
    t.db.prepare("UPDATE sa_disciplinary_details SET expires_at = '2020-01-01' WHERE hold_id = ?").run(old.holdId);
    assert.equal(expireDisciplinaryHolds(t.db), 1);
    assert.equal(holdActive(t.db, old.holdId), 0, 'المنتهية لا تحجب');
    assert.equal(holdActive(t.db, later.holdId), 1, 'التي لم تنته تبقى');
    assert.equal(holdActive(t.db, open.holdId), 1, 'بلا تاريخ تبقى حتى الرفع اليدوي');
    assert.equal(expireDisciplinaryHolds(t.db), 0, 'لا تتكرر');
    // عند بلوغ التاريخ يبقى الحجب نهار ذلك اليوم وينتهي بعده
    assert.equal(expireDisciplinaryHolds(t.db, iso(5)), 0);
    assert.equal(expireDisciplinaryHolds(t.db, iso(6)), 1);
  } finally { t.done(); }
});

test('الفصل والحرمان: يغيّران القيد عبر سلسلة الاعتماد، والقرار والحركة معاً أو لا شيء', async () => {
  const t = await setup();
  try {
    t.addStudent(10); t.addStudent(11); t.addStudent(12);
    const dis = createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'مخالفة جسيمة', penaltyLevel: 'dismissal' }, '::1');
    assert.equal(profileOf(t.db, 10).status, 'active', 'لا يتغير القيد قبل القرار النهائي');
    assert.equal(dis.movement.status, 'pending');
    assert.equal(finishChain(t, dis.movement.id).newStatus, 'withdrawn');
    assert.equal(profileOf(t.db, 10).status, 'withdrawn');

    const sus = createDisciplinaryRecord(t.deps, admin, { studentId: 11, note: 'حرمان', penaltyLevel: 'term_suspension' }, '::1');
    assert.equal(finishChain(t, sus.movement.id).newStatus, 'suspended');

    assert.equal(createDisciplinaryRecord(t.deps, admin, { studentId: 12, note: 'إنذار', penaltyLevel: 'warning' }, '::1').movement, null);
    assert.throws(() => createDisciplinaryRecord(t.deps, admin, { studentId: 12, note: 'x', penaltyLevel: 'مجهولة' }, '::1'), (e) => status(e, 400));
    assert.throws(() => executeLifecycleMovement(t.deps, admin, { studentId: 12, movementType: 'dismissal', reason: 'مباشرة' }, '::1'), (e) => status(e, 400), 'لا تصدر من نموذج الحركات');

    // تعذر الحركة يلغي القرار كله
    executeLifecycleMovement(t.deps, admin, { studentId: 12, movementType: 'suspension', reason: 'قائمة' }, '::1');
    const before = Number(t.db.prepare('SELECT COUNT(*) c FROM student_holds WHERE student_id = 12').get().c);
    assert.throws(() => createDisciplinaryRecord(t.deps, admin, { studentId: 12, note: 'تتعارض', penaltyLevel: 'dismissal' }, '::1'), (e) => status(e, 409));
    assert.equal(Number(t.db.prepare('SELECT COUNT(*) c FROM student_holds WHERE student_id = 12').get().c), before);
  } finally { t.done(); }
});

test('المعادلة: العلامة إلزامية والصفر صفر، ولا تُرصد إلا باعتماد شخص آخر', async () => {
  const t = await setup();
  try {
    t.addStudent(10); addCourse(t.db);
    const base = { studentId: 10, internalCourseId: 70, sourceUniversity: 'جامعة', externalCourseName: 'مقرر', externalHours: 3 };
    assert.throws(() => addTransferEquivalence(t.deps, admin, base, '::1'), (e) => status(e, 400), 'بلا علامة');
    assert.throws(() => addTransferEquivalence(t.deps, admin, { ...base, externalMark: 101 }, '::1'), (e) => status(e, 400));
    assert.throws(() => addTransferEquivalence(t.deps, admin, { ...base, externalMark: 80, externalHours: 0 }, '::1'), (e) => status(e, 400));

    const eq = addTransferEquivalence(t.deps, admin, { ...base, externalMark: 0 }, '::1');
    const row = () => t.db.prepare('SELECT * FROM sa_credit_equivalences WHERE id = ?').get(eq.id);
    assert.equal(Number(row().external_mark), 0, 'الصفر لا يصير 75');
    assert.equal(row().equivalence_status, 'pending');
    const grades = () => t.db.prepare('SELECT mark FROM grades WHERE student_id = 10 AND course_id = 70').all();
    assert.equal(grades().length, 0, 'لا علامة قبل الاعتماد');
    assert.throws(() => addTransferEquivalence(t.deps, admin, { ...base, externalMark: 60 }, '::1'), (e) => status(e, 409), 'لا معادلتان قيد الاعتماد');

    assert.throws(() => decideTransferEquivalence(t.deps, admin, eq.id, { decision: 'approve' }, '::1'), (e) => status(e, 403), 'مدخلها لا يعتمدها');
    assert.throws(() => decideTransferEquivalence(t.deps, staffWith('student:read'), eq.id, { decision: 'approve' }, '::1'), (e) => status(e, 403));
    assert.throws(() => decideTransferEquivalence(t.deps, chief, eq.id, { decision: 'reject' }, '::1'), (e) => status(e, 400), 'الرفض يحتاج سبباً');
    decideTransferEquivalence(t.deps, chief, eq.id, { decision: 'approve' }, '::1');
    assert.equal(row().equivalence_status, 'approved');
    assert.equal(Number(grades()[0].mark), 0);
    assert.throws(() => decideTransferEquivalence(t.deps, chief, eq.id, { decision: 'approve' }, '::1'), (e) => status(e, 409));

    addCourse(t.db, 71);
    const rej = addTransferEquivalence(t.deps, admin, { ...base, internalCourseId: 71, externalMark: 70 }, '::1');
    decideTransferEquivalence(t.deps, chief, rej.id, { decision: 'reject', note: 'غير مطابق' }, '::1');
    assert.equal(t.db.prepare('SELECT COUNT(*) c FROM grades WHERE course_id = 71').get().c, 0, 'المرفوضة لا تُرصد');
  } finally { t.done(); }
});

test('جلسة الإرشاد: لا أرقام مختلقة، وتُحسب من العلامات المعتمدة', async () => {
  const t = await setup();
  try {
    t.addStudent(10); t.addStudent(11); addCourse(t.db); addCourse(t.db, 71);
    const row = (id) => t.db.prepare('SELECT * FROM sa_advising_warnings WHERE id = ?').get(id);
    const empty = row(createAdvisingSession(t.deps, admin, { studentId: 10, actionPlan: 'خطة' }, '::1').id);
    assert.equal(empty.gpa_snapshot, null); assert.equal(empty.absence_rate, null); assert.equal(Number(empty.failed_courses_count), 0);

    addGrade(t.db, 11, 70, 90, 3); addGrade(t.db, 11, 71, 30, 3);
    const real = row(createAdvisingSession(t.deps, admin, { studentId: 11, actionPlan: 'خطة' }, '::1').id);
    assert.equal(Number(real.gpa_snapshot), 60); assert.equal(Number(real.failed_courses_count), 1); assert.equal(real.absence_rate, null);

    const given = row(createAdvisingSession(t.deps, admin, { studentId: 10, actionPlan: 'خطة', gpaSnapshot: 0, absenceRate: 0, failedCoursesCount: 0 }, '::1').id);
    assert.equal(Number(given.gpa_snapshot), 0, 'الصفر المدخل يبقى صفراً');
    assert.throws(() => createAdvisingSession(t.deps, admin, { studentId: 10, actionPlan: 'خطة', absenceRate: 140 }, '::1'), (e) => status(e, 400));
    assert.throws(() => createAdvisingSession(t.deps, admin, { studentId: 99999, actionPlan: 'خطة' }, '::1'), (e) => status(e, 404));
  } finally { t.done(); }
});

test('موعد الدور: لا تاريخ ماضٍ، ولا يُسجَّل باسم الموظف', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    assert.throws(() => bookDeskAppointment(t.deps, admin, { studentId: 10, appointmentDate: '2020-01-01' }, '::1'), (e) => status(e, 400));
    assert.throws(() => bookDeskAppointment(t.deps, admin, { studentId: 10, appointmentDate: 'غد' }, '::1'), (e) => status(e, 400));
    assert.throws(() => bookDeskAppointment(t.deps, admin, { appointmentDate: iso(1) }, '::1'), (e) => status(e, 400), 'بلا طالب');
    assert.throws(() => bookDeskAppointment(t.deps, admin, { studentId: 2, appointmentDate: iso(1) }, '::1'), (e) => status(e, 404), 'الموظف ليس طالباً');
    const ok = bookDeskAppointment(t.deps, admin, { studentId: 10, appointmentDate: iso(0) }, '::1');
    assert.equal(Number(t.db.prepare('SELECT student_id FROM sa_desk_appointments WHERE id = ?').get(ok.id).student_id), 10);
    const stu = { id: 10, role: 'student', name: 'طالب', can: () => false };
    assert.ok(bookDeskAppointment(t.deps, stu, { appointmentDate: iso(1) }, '::1').ticketNo);
  } finally { t.done(); }
});

test('الانسحاب: يوقف الحساب وجلساته ويعيده إعادة القيد، والمالية تتلقى المهمة دون تغيير أي مبلغ', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    const unit = Number(t.db.prepare("INSERT INTO org_units (code, name, kind, active) VALUES ('finance', 'المالية', 'department', 1) RETURNING id").get().id);
    t.db.prepare("INSERT INTO users (id, username, password_hash, role, display_name, active, unit_id, created_at) VALUES (30, 'fin', 'x', 'staff', 'مالية', 1, ?, ?)").run(unit, Date.now());
    const active = () => Number(t.db.prepare('SELECT active FROM users WHERE id = 10').get().active);
    const mv = executeLifecycleMovement(t.deps, admin, { studentId: 10, movementType: 'withdrawal', reason: 'رغبة' }, '::1');
    assert.equal(active(), 1, 'يبقى فعالاً قبل القرار النهائي');
    assert.equal(finishChain(t, mv.id).newStatus, 'withdrawn');
    assert.equal(active(), 0);
    const note = t.db.prepare("SELECT text FROM user_notifications WHERE user_id = 30 AND kind = 'lifecycle' AND ref_id = ?").get(mv.id);
    assert.match(note.text, /مطلوب إجراء مالي/);
    assert.equal(Number(t.db.prepare('SELECT COUNT(*) c FROM fin_charges WHERE student_id = 10').get().c), 0, 'لا عملية مالية تلقائية');

    const back = executeLifecycleMovement(t.deps, admin, { studentId: 10, movementType: 'reinstatement', reason: 'عودة' }, '::1');
    assert.equal(finishChain(t, back.id).newStatus, 'active');
    assert.equal(active(), 1, 'إعادة القيد تعيد الحساب');
  } finally { t.done(); }
});

test('حذف الطالب: لا يمحو علاماته', async () => {
  const t = await setup();
  try {
    t.addStudent(10); t.addStudent(11); addCourse(t.db); addGrade(t.db, 10, 70, 85);
    assert.throws(() => deleteStudent(t.deps, admin, 10, '::1'), (e) => status(e, 409) && /علامة/.test(e.message));
    assert.equal(Number(t.db.prepare('SELECT COUNT(*) c FROM grades WHERE student_id = 10').get().c), 1);
    deleteStudent(t.deps, admin, 11, '::1');
    assert.equal(t.db.prepare('SELECT 1 AS x FROM student_profiles WHERE user_id = 11').get(), undefined, 'بلا علامات يُحذف');
  } finally { t.done(); }
});

test('تغيير الحالة من ملف الطالب يدخل سجل حركات القيد', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    t.db.prepare("UPDATE student_profiles SET hs_type = 'الثانوية العامة - الفرع العلمي', admission_type = 'القبول العام (المفاضلة)', enroll_term = 'الفصل الأول' WHERE user_id = 10").run();
    const p = profileOf(t.db, 10);
    updateStudent(t.deps, admin, 10, { ...p, status: 'transferred' }, '::1');
    assert.equal(profileOf(t.db, 10).status, 'transferred');
    const m = t.db.prepare("SELECT * FROM sa_lifecycle_movements WHERE student_id = 10 AND movement_type = 'file_status_change'").get();
    assert.equal(m.from_status, 'active'); assert.equal(m.to_status, 'transferred'); assert.equal(m.status, 'approved');
    updateStudent(t.deps, admin, 10, { ...profileOf(t.db, 10), phone: '0944000111' }, '::1');
    assert.equal(Number(t.db.prepare('SELECT COUNT(*) c FROM sa_lifecycle_movements WHERE student_id = 10').get().c), 1, 'تعديل غير الحالة لا ينشئ حركة');
  } finally { t.done(); }
});
