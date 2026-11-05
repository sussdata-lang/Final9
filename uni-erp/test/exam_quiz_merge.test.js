// دمج الاختبارات الإلكترونية في بنك LMS، وجدولة الامتحانات في سجل الامتحانات.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { audit, verifyAuditChain, purgeAuditLog } from '../server/audit.js';
import { getSetting } from '../server/services/settings.js';

const PW = 'Merge#Pass12345';
let app, base, adm, stud;
const call = (cookie, m, u, body) => fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (username) => (await call(null, 'POST', '/api/auth/login', { username, password: PW })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-merge-'));
  app = await createApp({ dbPath: ':memory:', uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), dataDir: dir, scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, app.cfg.scryptN);
  app.db.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(hash);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, active, must_change_password, created_at) VALUES ('merge_st', 'طالب', ?, 'student', 'MERGE-1', 1, 0, ?)").run(hash, Date.now());
  adm = await login('admin'); stud = await login('merge_st');
});
test.after(async () => { await app.close(); });

test('الاختبارات في جدول واحد، ولكل طالب محاولة واحدة', async () => {
  const qs = JSON.stringify([{ q: 'س1', options: ['أ', 'ب'], ans: 0 }, { q: 'س2', options: ['أ', 'ب'], ans: 1 }]);
  const ins = (title, published) => Number(app.db.prepare("INSERT INTO lms_quizzes (course_code, course_name, title, questions_json, published, created_at) VALUES ('M1', 'م', ?, ?, ?, ?)").run(title, qs, published, Date.now()).lastInsertRowid);
  const openId = ins('متاح', 1); ins('مغلق', 0);
  assert.equal(app.db.prepare("SELECT to_regclass('public.online_quizzes') AS t").get().t, null, 'الجدول القديم حُذف');

  const forAdmin = await (await call(adm, 'GET', '/api/lms/overview')).json();
  for (const t of ['متاح', 'مغلق']) assert.ok(forAdmin.quizzes.some((q) => q.title === t), t);
  assert.equal(forAdmin.stats.quizzesCount, forAdmin.quizzes.length);

  const forStudent = await (await call(stud, 'GET', '/api/lms/overview')).json();
  assert.ok(!forStudent.quizzes.some((q) => q.title === 'مغلق'), 'المغلق لا يظهر للطالب');
  assert.ok(forStudent.quizzes.every((q) => q.questions.every((x) => !('correct' in x)) && !q.questions_json), 'لا إجابات للطالب');

  // السؤال المتروك لا يُحسب صحيحاً حتى لو كان الجواب الصحيح هو الخيار الأول
  const r = await (await call(stud, 'POST', `/api/lms/quizzes/${openId}/submit`, { answers: [null, 1] })).json();
  assert.equal(r.correctCount, 1);
  assert.equal((await call(stud, 'POST', `/api/lms/quizzes/${openId}/submit`, { answers: [0, 1] })).status, 409, 'محاولة واحدة');
  const after = await (await call(adm, 'GET', '/api/lms/overview')).json();
  assert.equal(after.quizzes.find((q) => q.title === 'متاح').attempts_count, 1);
  assert.equal((await (await call(stud, 'GET', '/api/lms/overview')).json()).quizSubmissions.length, 1);
});

test('سداد القسط يمر بدفتر المالية: استحقاق ودفعة بقيدين، ورصيد واحد', async () => {
  const inst = Number(app.db.prepare("INSERT INTO student_fee_installments (installment_code, student_no, student_name, faculty_name, installment_no, amount, due_date) VALUES ('FEE-1', 'MERGE-1', 'x', 'y', 1, 1000.5, '2026-12-01')").run().lastInsertRowid);
  const r = await call(adm, 'POST', `/api/enterprise/installments/${inst}/pay`, { payment_method: 'مصرف' });
  assert.equal(r.status, 200, await r.clone().text());
  const row = app.db.prepare('SELECT * FROM student_fee_installments WHERE id = ?').get(inst);
  assert.ok(row.fin_charge_id && row.fin_payment_id);
  assert.equal(Number(row.paid_amount), 1000.5);
  const pay = app.db.prepare('SELECT * FROM fin_payments WHERE id = ?').get(row.fin_payment_id);
  assert.ok(pay.entry_id, 'للدفعة قيد');
  assert.equal(pay.method, 'bank');
  assert.equal((await call(adm, 'POST', `/api/enterprise/installments/${inst}/pay`, {})).status, 409, 'لا يُسدد مرتين');
  const fees = await (await call(stud, 'GET', '/api/me/fees')).json();
  assert.equal(Number(fees.balance ?? fees.summary?.balance ?? 0), 0, 'الاستحقاق والدفعة يتعادلان');
});

test('قسط لطالب بلا حساب يُمنع جديده بالقيد، والحساب الموجود يقبله', () => {
  const ins = (no) => app.db.prepare("INSERT INTO student_fee_installments (installment_code, student_no, student_name, faculty_name, installment_no, amount, due_date) VALUES (?, ?, 'x', 'y', 1, 10, '2026-12-01')").run(`K-${no}`, no);
  assert.throws(() => ins('NO-SUCH-STUDENT'), /foreign key|fk_installments_student/i);
  ins('MERGE-1');
});

test('أعمدة المبالغ بنوع دقيق، والقيم تعود أرقاماً', () => {
  const t = (table, col) => app.db.prepare('SELECT data_type d FROM information_schema.columns WHERE table_name = ? AND column_name = ?').get(table, col).d;
  for (const [a, b] of [['student_fee_installments', 'amount'], ['hr_advances', 'amount'], ['hr_signed_payslips', 'net_salary'], ['fin_fee_structures', 'total_fee'], ['sa_scholarships', 'amount']]) assert.equal(t(a, b), 'numeric', `${a}.${b}`);
  const id = Number(app.db.prepare("INSERT INTO hr_signed_payslips (payslip_code, employee_code, employee_name, department, month_label, basic_salary, overload_pay, allowances, deductions, net_salary, digital_signature, issued_at) VALUES ('N-1', 'e', 'n', 'd', 'm', 0.1, 0.2, 0, 0, 0.3, 's', 1)").run().lastInsertRowid);
  const v = app.db.prepare('SELECT basic_salary + overload_pay AS sum, net_salary FROM hr_signed_payslips WHERE id = ?').get(id);
  assert.strictEqual(v.sum, 0.3, 'لا خطأ تقريب في الجمع');
  assert.strictEqual(v.net_salary, 0.3);
});

test('الجدولة الجماعية تحفظ الدورة والنوع والسعة، وإعادة الحفظ لا تكرر', async () => {
  const body = (over = {}) => ({ exam_type: 'امتحان نصفي', academic_year: '2026/2027', semester: 'الفصل الأول', items: [{ course_code: 'BULK-1', course_name: 'م', program_name: 'ب', exam_date: '2030-01-10', start_time: '09:00', end_time: '11:00', hall_name: 'BULK-H', capacity: 40, proctor_name: 'ر', ...over }] });
  const count = () => Number(app.db.prepare("SELECT COUNT(*) c FROM exam_schedules WHERE course_code = 'BULK-1'").get().c);
  const first = await (await call(adm, 'POST', '/api/expansions/exams/bulk', body())).json();
  assert.deepEqual([first.created, first.updated], [1, 0]);
  const second = await (await call(adm, 'POST', '/api/expansions/exams/bulk', body({ exam_date: '2030-01-12' }))).json();
  assert.deepEqual([second.created, second.updated], [0, 1]);
  assert.equal(count(), 1);
  const row = app.db.prepare("SELECT * FROM exam_schedules WHERE course_code = 'BULK-1'").get();
  assert.equal(row.exam_date, '2030-01-12');
  assert.equal(row.exam_type, 'امتحان نصفي');
  assert.equal(row.academic_year, '2026/2027');
  assert.equal(row.semester, 'الفصل الأول');
  assert.equal(Number(row.capacity), 40);
  const other = await (await call(adm, 'POST', '/api/expansions/exams/bulk', { ...body(), semester: 'الفصل الثاني' })).json();
  assert.equal(other.created, 1, 'دورة أخرى امتحان آخر');
  assert.equal(count(), 2);
});

test('امتحان قديم بلا دورة وموعده لم يمض يُحدَّث، والماضي يبقى كما هو', async () => {
  const ins = (code, date) => app.db.prepare("INSERT INTO exam_schedules (course_code, course_name, program_name, exam_type, exam_date, start_time, end_time, hall_name, capacity, enrolled_count, proctor_name, status, created_at) VALUES (?, 'م', 'ب', 'نهائي', ?, '09:00', '11:00', 'OLD-H', 0, 0, 'ر', 'مجدول', ?)").run(code, date, Date.now());
  ins('OLD-F', '2031-01-01'); ins('OLD-P', '2020-01-01');
  const send = (code) => call(adm, 'POST', '/api/expansions/exams/bulk', { exam_type: 'نهائي', academic_year: '2026/2027', semester: 'الفصل الأول', items: [{ course_code: code, course_name: 'م', exam_date: '2031-02-01', start_time: '09:00', end_time: '11:00', hall_name: `H-${code}` }] });
  assert.equal((await (await send('OLD-F')).json()).updated, 1);
  assert.equal((await (await send('OLD-P')).json()).created, 1);
  assert.equal(app.db.prepare("SELECT exam_date v FROM exam_schedules WHERE course_code = 'OLD-P' AND academic_year IS NULL").get().v, '2020-01-01');
});

test('تعارض القاعة ينبَّه إليه دون منع الحفظ', async () => {
  const item = (code) => ({ course_code: code, course_name: code, exam_date: '2032-03-03', start_time: '09:00', end_time: '11:00', hall_name: 'CLASH-H' });
  const send = (code) => call(adm, 'POST', '/api/expansions/exams/bulk', { exam_type: 'نهائي', academic_year: '2031/2032', semester: 'الفصل الأول', items: [item(code)] });
  assert.equal((await (await send('CL-1')).json()).warnings.length, 0);
  const r = await (await send('CL-2')).json();
  assert.equal(r.created, 1);
  assert.match(r.warnings[0], /CLASH-H/);
});

test('المدخلان القديمان حُذفا من المواد والعلامات ومن منظومة الجامعة', () => {
  const pub = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public');
  const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
  for (const f of ['ux_exam.js', 'view_gate.js', 'ux_restructure.js', 'ux_state.js']) assert.doesNotMatch(read(f), /'exam_master'|'lms_quiz'|acadxtab|submitlmsquiz/, f);
  assert.doesNotMatch(read('enterprise_suite.js'), /es-quiz-form/);
  assert.match(read('v12_views.js'), /btn-bulk-exam/);
});

test('رقم جامعي غير موجود يعيد رسالة مفهومة لا خطأ داخلياً', async () => {
  const r = await call(adm, 'POST', '/api/expansions/office-bookings', { faculty_name: 'د', student_name: 'ط', student_no: 'NO-SUCH', topic: 'ت' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /الرقم الجامعي/);
});

test('المنح والجدول الدراسي في جدول واحد لكل منهما', async () => {
  for (const t of ['scholarships', 'smart_schedule_slots']) assert.equal(app.db.prepare('SELECT to_regclass(?) AS t').get(`public.${t}`).t, null, t);
  assert.equal((await call(adm, 'POST', '/api/expansions/scholarships', { student_no: 'MERGE-1' })).status, 404);
  assert.equal((await call(adm, 'POST', '/api/enterprise/schedule', {})).status, 404);
});

test('إضافة موعد تمنع تضارب القاعة والمدرّس، ويظهر في الجدول الموحد', async () => {
  const prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const course = (code, instructor) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, instructor) VALUES (?, 1, 1, ?, ?, ?)').run(prog, code, code, instructor).lastInsertRowid);
  const a = course('SL-A', 'د. أ'), b = course('SL-B', 'د. ب'), c = course('SL-C', 'د. أ');
  const add = (id, hall) => call(adm, 'POST', `/api/courses/${id}/schedule/slots`, { day: 2, start: '09:00', end: '11:00', hall });
  assert.equal((await add(a, 'SL-H1')).status, 201);
  const clash = await add(b, 'SL-H1');
  assert.equal(clash.status, 409);
  assert.match((await clash.json()).message, /قاعة/);
  const teacher = await add(c, 'SL-H2');
  assert.equal(teacher.status, 409);
  assert.match((await teacher.json()).message, /مدرّس/);
  assert.equal((await add(b, 'SL-H3')).status, 201);
  assert.equal((await call(stud, 'POST', `/api/courses/${a}/schedule/slots`, { day: 3, start: '09:00', end: '10:00' })).status, 403);
  const ov = await (await call(adm, 'GET', '/api/enterprise/overview')).json();
  const row = ov.scheduleSlots.find((s) => s.course_code === 'SL-A');
  assert.equal(row.hall_code, 'SL-H1');
  assert.equal(row.time_slot, '09:00 - 11:00');
  assert.equal(row.day_name, 'الاثنين');
  assert.ok(ov.scheduleCourses.some((x) => x.code === 'SL-C'));
});

test('حامل البحث وحده يجد الاسم والرقم فقط، ولا يفتح الملف', async () => {
  const hash = await hashPassword(PW, app.cfg.scryptN);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, access_mode, active, must_change_password, created_at) VALUES ('lk_user', 'بحث', ?, 'staff', ?, 'custom', 1, 0, ?)").run(hash, JSON.stringify(['student:lookup']), Date.now());
  const prog = app.db.prepare('SELECT id, faculty FROM programs ORDER BY id LIMIT 1').get();
  const sid = Number(app.db.prepare("SELECT id FROM users WHERE student_no = 'MERGE-1'").get().id);
  app.db.prepare("INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, email, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_by, created_at, updated_at) VALUES (?, 'مرج', 'أب', 'طالب', 'أم', '09988776655', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944556677', 'm@x.y', 'دمشق', 'م', 'ع', 'علمي', 2025, 2000, ?, 'عام', 2026, 'الفصل الأول', 1, 'active', 'أب', 'أب', '0944000000', 1, ?, ?)").run(sid, prog.id, Date.now(), Date.now());
  const lk = await login('lk_user');
  const r = await (await call(lk, 'GET', '/api/students?q=MERGE-1')).json();
  assert.equal(r.students.length, 1);
  assert.equal(r.students[0].studentNo, 'MERGE-1');
  assert.ok(!('nationalId' in r.students[0]) && !('phone' in r.students[0]) && !('national_id' in r.students[0]), JSON.stringify(r.students[0]));
  assert.equal((await (await call(lk, 'GET', '/api/students?q=0944556677')).json()).students.length, 0, 'لا بحث بالهاتف');
  assert.equal((await call(lk, 'GET', `/api/students/${sid}`)).status, 403);

  // حساب نطاقه كلية يرى طلابها فقط
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, access_mode, data_scope, scope_faculty, active, must_change_password, created_at) VALUES ('fac_same', 'ك', ?, 'staff', ?, 'custom', 'faculty', ?, 1, 0, ?)").run(hash, JSON.stringify(['student:read']), prog.faculty, Date.now());
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, access_mode, data_scope, scope_faculty, active, must_change_password, created_at) VALUES ('fac_other', 'ك', ?, 'staff', ?, 'custom', 'faculty', 'كلية أخرى', 1, 0, ?)").run(hash, JSON.stringify(['student:read']), Date.now());
  const same = await login('fac_same'), other = await login('fac_other');
  assert.equal((await call(same, 'GET', `/api/students/${sid}`)).status, 200);
  assert.equal((await call(other, 'GET', `/api/students/${sid}`)).status, 404);
  assert.equal((await call(other, 'GET', `/api/students/${sid}/grades`)).status, 404);
  assert.ok((await (await call(same, 'GET', '/api/students')).json()).students.some((s) => s.studentNo === 'MERGE-1'));
  assert.equal((await (await call(other, 'GET', '/api/students')).json()).students.length, 0);
  assert.equal((await (await call(other, 'GET', '/api/students-table')).json()).rows?.length ?? 0, 0);
});

test('قسيمة الراتب موقعة فعلياً، وأي تعديل يبطل توقيعها', async () => {
  const r = await (await call(adm, 'POST', '/api/enterprise/payslips/issue', { employee_name: 'موظف', basic_salary: 1000.5, overload_pay: 10 })).json();
  assert.match(r.digital_signature, /^RSA-SHA256:/);
  const v = await (await call(adm, 'GET', `/api/enterprise/payslips/${r.payslip_code}/verify`)).json();
  assert.equal(v.valid, true);
  app.db.prepare('UPDATE hr_signed_payslips SET net_salary = 999999 WHERE payslip_code = ?').run(r.payslip_code);
  assert.equal((await (await call(adm, 'GET', `/api/enterprise/payslips/${r.payslip_code}/verify`)).json()).valid, false);
  assert.equal((await call(adm, 'GET', '/api/enterprise/payslips/NO-SUCH/verify')).status, 404);
  assert.equal((await call(stud, 'GET', `/api/enterprise/payslips/${r.payslip_code}/verify`)).status, 403);
});

test('الإشعار يُحصى بعدد الأجهزة المشتركة فعلاً', async () => {
  const j = await (await call(adm, 'POST', '/api/enterprise/notifications/broadcast', { title: 'NOTE-S', body: 'x', audience: 'students' })).json();
  assert.equal(j.devices, 0);
  const row = app.db.prepare("SELECT channels, target_audience FROM multi_channel_notifications WHERE title = 'NOTE-S'").get();
  assert.doesNotMatch(row.channels, /Telegram|WhatsApp|Email/);
  assert.equal(row.target_audience, 'كافة الطلاب');
});

test('سجل التدقيق بمفتاح: يُكشف العبث، ومدة الاحتفاظ تحذف القديم وتبقي السلسلة صحيحة', () => {
  const { db } = app;
  assert.equal(verifyAuditChain(db).ok, true);
  const old = Date.now() - 5 * 365.25 * 24 * 3600_000;
  assert.equal(getSetting(db, 'audit.retention_years'), 3);
  const r0 = purgeAuditLog(db, 3, Date.now() + 10 * 365.25 * 24 * 3600_000 + old - old);
  assert.ok(r0.removed > 0, 'يحذف ما تجاوز المدة');
  audit(db, null, 'بعد الحذف', 'x');
  const v = verifyAuditChain(db);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only|audit/i, 'منع الحذف عاد');
});

test('منشئ الاختبار: إعداد ثم اعتماد ثم نشر، وأسئلة نظرية ومتعددة، وتصحيح يدوي', async () => {
  const body = { course_code: 'QB-1', course_name: 'م', title: 'اختبار المنشئ', instructor_name: 'د', duration_min: 30, questions: [
    { type: 'single', q: 'س1', options: ['أ', 'ب'], correct: [1], marks: 2 },
    { type: 'multi', q: 'س2', options: ['أ', 'ب', 'ج'], correct: [0, 2], marks: 3 },
    { type: 'essay', q: 'س3', marks: 5 },
  ] };
  assert.equal((await call(stud, 'POST', '/api/lms/quizzes', body)).status, 403);
  assert.equal((await call(adm, 'POST', '/api/lms/quizzes', { ...body, questions: [] })).status, 400);
  const { id } = await (await call(adm, 'POST', '/api/lms/quizzes', body)).json();
  const seen = async () => (await (await call(stud, 'GET', '/api/lms/overview')).json()).quizzes.some((q) => q.id === id);
  assert.equal(await seen(), false, 'المسودة لا تظهر للطالب');
  assert.equal((await call(adm, 'POST', `/api/lms/quizzes/${id}/request-approval`, {})).status, 200);
  assert.equal(await seen(), false, 'قبل الاعتماد');
  assert.equal((await call(adm, 'POST', `/api/lms/quizzes/${id}/decide`, { approve: true })).status, 200);
  assert.equal(await seen(), true);
  const start = await (await call(stud, 'POST', `/api/lms/quizzes/${id}/start`, {})).json();
  assert.equal(start.questions.length, 3);
  assert.ok(start.questions.every((q) => !('correct' in q)), 'لا إجابات للطالب');
  const r = await (await call(stud, 'POST', `/api/lms/quizzes/${id}/submit`, { answers: [1, [0, 2], 'جواب'] })).json();
  assert.equal(r.score, 5);
  assert.equal(r.pendingEssays, 1);
  const subs = await (await call(adm, 'GET', `/api/lms/quizzes/${id}/submissions`)).json();
  const essay = subs.questions.find((q) => q.type === 'essay');
  assert.equal((await call(adm, 'POST', `/api/lms/quiz-submissions/${subs.submissions[0].id}/grade`, { marks: { [essay.id]: 99 } })).status, 400);
  assert.equal((await (await call(adm, 'POST', `/api/lms/quiz-submissions/${subs.submissions[0].id}/grade`, { marks: { [essay.id]: 4 } })).json()).score, 9);
  assert.equal((await call(adm, 'DELETE', `/api/lms/quizzes/${id}`)).status, 409, 'لا يُحذف بعد التقديم');
  // موعد نشر مستقبلي
  const later = await (await call(adm, 'POST', '/api/lms/quizzes', { ...body, title: 'لاحق', publish_at: new Date(Date.now() + 3600e3).toISOString() })).json();
  await call(adm, 'POST', `/api/lms/quizzes/${later.id}/request-approval`, {});
  await call(adm, 'POST', `/api/lms/quizzes/${later.id}/decide`, { approve: true });
  assert.equal((await call(stud, 'POST', `/api/lms/quizzes/${later.id}/start`, {})).status, 409);
});

test('المحاضرة تظهر لجمهورها فقط', async () => {
  const prog = app.db.prepare('SELECT g.faculty AS f FROM users u JOIN student_profiles p ON p.user_id = u.id JOIN programs g ON g.id = p.program_id WHERE u.student_no = ?').get('MERGE-1').f;
  const add = (title, target_faculty) => call(adm, 'POST', '/api/lms/lectures', { course_code: 'L1', course_name: 'م', title, target_faculty });
  assert.equal((await add('لكليتي', prog)).status, 201);
  await add('لغيري', 'جهة أخرى');
  const titles = (await (await call(stud, 'GET', '/api/lms/overview')).json()).lectures.map((l) => l.title);
  assert.ok(titles.includes('لكليتي'));
  assert.ok(!titles.includes('لغيري'));
});

test('السكن: هيكلية جاهزة، وتسكين بقيود القسم والسعة، ومواد مسلمة من القائمة', async () => {
  const o = await (await call(adm, 'GET', '/api/housing/overview')).json();
  for (const n of ['المبنى A', 'المبنى B', 'المبنى C']) assert.equal(o.rooms.filter((r) => r.building_name === n).length, 50, n);
  const male = o.rooms.find((r) => r.gender === 'ذكور'), female = o.rooms.find((r) => r.gender === 'إناث');
  assert.equal((await call(adm, 'POST', '/api/housing/allocations', { student_no: 'MERGE-1', room_id: female.id })).status, 400, 'قسم الإناث');
  const a = await (await call(adm, 'POST', '/api/housing/allocations', { student_no: 'MERGE-1', room_id: male.id })).json();
  assert.ok(a.id);
  assert.equal((await call(adm, 'POST', '/api/housing/allocations', { student_no: 'MERGE-1', room_id: male.id })).status, 400, 'لا تسكين مرتين');
  assert.equal((await call(adm, 'PUT', `/api/housing/rooms/${male.id}`, { room_no: male.room_no, capacity: 0 })).status, 400);
  const h = await call(adm, 'POST', '/api/housing/handouts', { student_no: 'MERGE-1', items: [{ name: 'سرير' }, { name: 'كمبيوتر محمول', qty: 1, serial: 'SN-1' }] });
  assert.equal(h.status, 201);
  assert.equal((await call(adm, 'POST', '/api/housing/handouts', { student_no: 'MERGE-1', items: [{ name: 'ليست في القائمة' }] })).status, 400);
  const mine = await (await call(stud, 'GET', '/api/housing/overview')).json();
  assert.equal(mine.allocations.length, 1);
  assert.equal(mine.handouts[0].room_label.includes(male.room_no), true);
  assert.equal((await call(stud, 'POST', '/api/housing/handouts', { student_no: 'MERGE-1', items: [{ name: 'سرير' }] })).status, 403);
  assert.equal((await call(adm, 'DELETE', `/api/housing/allocations/${a.id}`)).status, 200);
});
