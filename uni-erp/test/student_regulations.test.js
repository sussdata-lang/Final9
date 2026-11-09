import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from '../server/db.js';
import { saveSettings, listSettings } from '../server/services/settings.js';
import { updateStudent } from '../server/services/students.js';
import { executeLifecycleMovement, decideMovementStep, createDisciplinaryRecord } from '../server/services/student_affairs_suite.js';
import {
  graduationBlockers, promotionPreview, applyPromotions, renewEnrollment, renewalReport, exhaustionList, notifyExhaustion, submitAppeal, decideAppeal,
} from '../server/services/student_regulations.js';

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

const is = (code) => (e) => e.status === code;
const set = (t, values) => saveSettings(t.deps, admin, { values }, '::1');
const stu = (id) => ({ id, role: 'student', name: 'طالب', can: () => false });
const addCourses = (db, level, count, program = 1, from = 100) => { const ids = []; for (let i = 0; i < count; i++) { const id = from + level * 100 + i; db.prepare("INSERT INTO courses (id, code, name, hours, program_id, level, semester, active) VALUES (?, ?, ?, 3, ?, ?, 1, 1)").run(id, `C${id}`, `مقرر ${id}`, program, level); ids.push(id); } return ids; };
const pass = (db, sid, ids, mark = 80) => { for (const c of ids) db.prepare("INSERT INTO grades (student_id, course_id, course, term, hours, mark, academic_year, semester, level, workflow_status, entered_at) VALUES (?, ?, 'م', 'الفصل الأول', 3, ?, '2026', 1, 1, 'approved', ?)").run(sid, c, mark, Date.now()); };
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const level = (db, id) => Number(db.prepare('SELECT study_level FROM student_profiles WHERE user_id = ?').get(id).study_level);

test('الإعدادات: تبويب أنظمة الدراسة ظاهر وكل قاعدة فيه قابلة للتعديل', async () => {
  const t = await setup();
  try {
    const tab = listSettings(t.db).tabs.find((x) => x.key === 'regulations');
    assert.ok(tab.items.length >= 15);
    assert.equal(tab.items.some((i) => i.key.startsWith('reg.grad_')), false, 'إنهاء المقررات شرط لا إعداد');
    assert.equal(tab.items.find((i) => i.key === 'reg.promotion_max_carried').value, 4);
    set(t, { 'reg.promotion_max_carried': 8 });
    assert.equal(listSettings(t.db).tabs.find((x) => x.key === 'regulations').items.find((i) => i.key === 'reg.promotion_max_carried').value, 8);
  } finally { t.done(); }
});

test('التخرج: الشروط تُفحص من الخطة والإعدادات، ثم براءات الذمة والاعتماد', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    const ids = addCourses(t.db, 1, 3);
    assert.throws(() => executeLifecycleMovement(t.deps, admin, { studentId: 10, movementType: 'graduation', reason: 'تخرج' }, '::1'), (e) => e.status === 409 && /لم ينجح/.test(e.message));
    pass(t.db, 10, ids, 70);
    assert.deepEqual(graduationBlockers(t.db, 10), []);
    const mv = executeLifecycleMovement(t.deps, admin, { studentId: 10, movementType: 'graduation', reason: 'استوفى' }, '::1');
    assert.equal(mv.totalSteps, 5, 'ثلاث براءات ذمة ثم العميد ثم القرار النهائي');
    assert.equal(profileOf(t.db, 10).status, 'active');
    assert.equal(finishChain(t, mv.id).newStatus, 'graduated');
    assert.equal(Number(t.db.prepare('SELECT active FROM users WHERE id = 10').get().active), 1, 'الخريج يبقى حسابه فعالاً');
  } finally { t.done(); }
});

test('الترفيع: حسب عدد المقررات المحمولة والإعداد، ولا يتكرر في العام نفسه', async () => {
  const t = await setup();
  try {
    t.addStudent(10); t.addStudent(11);
    const ids = addCourses(t.db, 1, 8);
    pass(t.db, 10, ids.slice(0, 4));   // يحمل 4
    pass(t.db, 11, ids.slice(0, 3));   // يحمل 5
    const p = promotionPreview(t.deps, admin).rows;
    assert.equal(p.find((r) => r.id === 10).eligible, true);
    assert.equal(p.find((r) => r.id === 11).eligible, false);
    assert.throws(() => applyPromotions(t.deps, staffWith('student:read'), {}, '::1'), is(403));
    assert.equal(applyPromotions(t.deps, admin, {}, '::1').promoted, 1);
    assert.equal(level(t.db, 10), 2); assert.equal(level(t.db, 11), 1);
    assert.equal(applyPromotions(t.deps, admin, {}, '::1').promoted, 0, 'لا يتكرر');
    set(t, { 'reg.promotion_max_carried': 5 });
    assert.equal(applyPromotions(t.deps, admin, {}, '::1').promoted, 1, 'رفع الحد في الإعدادات يسري فوراً');
    assert.equal(level(t.db, 11), 2);
  } finally { t.done(); }
});

test('تجديد القيد: المهلة والموانع من الإعدادات، ومرة واحدة في العام', async () => {
  const t = await setup();
  try {
    t.addStudent(10);
    set(t, { 'reg.renewal_open': iso(2), 'reg.renewal_close': iso(10) });
    assert.throws(() => renewEnrollment(t.deps, stu(10), {}, '::1'), (e) => e.status === 409 && /يبدأ/.test(e.message));
    set(t, { 'reg.renewal_open': iso(-10), 'reg.renewal_close': iso(-2) });
    assert.throws(() => renewEnrollment(t.deps, stu(10), {}, '::1'), (e) => e.status === 409 && /انتهت/.test(e.message));
    set(t, { 'reg.renewal_late_days': 5 });
    const hold = createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'مخالفة' }, '::1');
    assert.throws(() => renewEnrollment(t.deps, stu(10), {}, '::1'), (e) => e.status === 409 && /عقوبة/.test(e.message));
    t.db.prepare('UPDATE student_holds SET active = 0, cleared_at = ? WHERE id = ?').run(Date.now(), hold.holdId);
    assert.equal(renewEnrollment(t.deps, stu(10), {}, '::1').late, true);
    assert.throws(() => renewEnrollment(t.deps, stu(10), {}, '::1'), is(409));
    assert.equal(renewalReport(t.deps, admin).renewed, 1);
    assert.throws(() => renewEnrollment(t.deps, staffWith('student:read'), { studentId: 10 }, '::1'), is(403));
  } finally { t.done(); }
});

test('الاستنفاد: الحد الأقصى من مدة البرنامج والإعداد، ويُستثنى التأجيل', async () => {
  const t = await setup();
  try {
    const cy = Number((new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1));
    t.addStudent(10, 'active', 1, cy - 3); t.addStudent(11, 'active', 1, cy);
    const y = (id) => exhaustionList(t.deps, admin).rows.find((r) => r.id === id);
    const years = Number(t.db.prepare('SELECT years FROM programs WHERE id = 1').get().years);
    assert.equal(y(10).maxYears, years * 1.5);
    assert.equal(y(10).exhausted, true);
    assert.equal(y(11), undefined, 'البعيد عن الحد لا يظهر');
    set(t, { 'reg.max_stay_extra_percent': 200 });
    assert.equal(y(10), undefined);
    set(t, { 'reg.max_stay_extra_percent': 50 });
    assert.equal(notifyExhaustion(t.deps, admin, '::1').notified, 1);
    notifyExhaustion(t.deps, admin, '::1');
    assert.equal(Number(t.db.prepare("SELECT COUNT(*) c FROM user_notifications WHERE user_id = 10 AND kind = 'study_limit'").get().c), 1, 'تنبيه واحد في العام');
  } finally { t.done(); }
});

test('التظلم: في المهلة وللقرارات القابلة فقط، وقبوله يسقط الحركة المعلقة', async () => {
  const t = await setup();
  try {
    t.addStudent(10); t.addStudent(11); t.addStudent(12);
    const warn = createDisciplinaryRecord(t.deps, admin, { studentId: 10, note: 'إنذار' }, '::1');
    assert.throws(() => submitAppeal(t.deps, stu(10), { holdId: warn.holdId, reason: 'أسباب كافية' }, '::1'), is(409), 'الإنذار نهائي');
    const dis = createDisciplinaryRecord(t.deps, admin, { studentId: 11, note: 'جسيمة', penaltyLevel: 'dismissal', decisionNo: 'D-1' }, '::1');
    assert.throws(() => submitAppeal(t.deps, stu(10), { holdId: dis.holdId, reason: 'ليس قراري' }, '::1'), is(404));
    assert.throws(() => submitAppeal(t.deps, admin, { holdId: dis.holdId, reason: 'موظف يتظلم' }, '::1'), is(403));
    const ap = submitAppeal(t.deps, stu(11), { holdId: dis.holdId, reason: 'لم أرتكب المخالفة' }, '::1');
    assert.throws(() => submitAppeal(t.deps, stu(11), { holdId: dis.holdId, reason: 'مرة ثانية' }, '::1'), is(409));

    set(t, { 'reg.appeal_suspends': true });
    assert.throws(() => finishChain(t, dis.movement.id), (e) => e.status === 409 && /تظلم/.test(e.message), 'التظلم يوقف التنفيذ عند تفعيله');
    assert.equal(profileOf(t.db, 11).status, 'active');
    set(t, { 'reg.appeal_suspends': false });

    assert.throws(() => decideAppeal(t.deps, staffWith('student:read'), ap.id, { outcome: 'cancelled', note: 'ثبت خطأ' }, '::1'), is(403));
    assert.throws(() => decideAppeal(t.deps, chief, ap.id, { outcome: 'cancelled' }, '::1'), is(400));
    decideAppeal(t.deps, chief, ap.id, { outcome: 'cancelled', note: 'ثبت الخطأ' }, '::1');
    assert.equal(Number(t.db.prepare('SELECT active FROM student_holds WHERE id = ?').get(dis.holdId).active), 0);
    assert.equal(t.db.prepare('SELECT status FROM sa_lifecycle_movements WHERE id = ?').get(dis.movement.id).status, 'rejected');
    assert.throws(() => decideAppeal(t.deps, chief, ap.id, { outcome: 'upheld', note: 'تكرار' }, '::1'), is(409));

    const late = createDisciplinaryRecord(t.deps, admin, { studentId: 12, note: 'قديم', penaltyLevel: 'exam_zero' }, '::1');
    t.db.prepare('UPDATE sa_disciplinary_details SET created_at = ? WHERE hold_id = ?').run(Date.now() - 31 * 86400000, late.holdId);
    assert.throws(() => submitAppeal(t.deps, stu(12), { holdId: late.holdId, reason: 'تأخرت في التظلم' }, '::1'), (e) => e.status === 409 && /مهلة/.test(e.message));
    set(t, { 'reg.appeal_days': 60 });
    assert.ok(submitAppeal(t.deps, stu(12), { holdId: late.holdId, reason: 'ضمن المهلة الجديدة' }, '::1').id);
  } finally { t.done(); }
});

test('علامة النجاح: 60 للتطبيقية و50 لغيرها، والتخرج لا يكون إلا بإنهاء كل المقررات', async () => {
  const t = await setup();
  try {
    const code = t.db.prepare('SELECT code FROM faculties WHERE id = 1').get().code;
    set(t, { 'grades.non_applied_faculties': [code], 'grades.pass_mark_other': 50 });
    t.addStudent(10); t.addStudent(11);
    const ids = addCourses(t.db, 1, 2);
    pass(t.db, 10, ids, 55);
    assert.deepEqual(graduationBlockers(t.db, 10), [], '55 ناجحة في جهة غير تطبيقية');
    set(t, { 'grades.non_applied_faculties': ['NONE'] });
    assert.match(graduationBlockers(t.db, 10)[0], /لم ينجح/, 'خرجت الجهة من القائمة فصارت علامتها 60');
    t.db.prepare("UPDATE student_profiles SET hs_type = 'الثانوية العامة - الفرع العلمي', admission_type = 'القبول العام (المفاضلة)', enroll_term = 'الفصل الأول' WHERE user_id = 10").run();
    assert.throws(() => updateStudent(t.deps, admin, 10, { ...profileOf(t.db, 10), status: 'graduated' }, '::1'), is(409), 'لا تخرج من ملف الطالب');
    assert.equal(profileOf(t.db, 10).status, 'active');
  } finally { t.done(); }
});
