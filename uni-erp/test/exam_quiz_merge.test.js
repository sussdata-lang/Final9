// دمج الاختبارات الإلكترونية في بنك LMS، وجدولة الامتحانات في سجل الامتحانات.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

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
  assert.ok(forStudent.quizzes.every((q) => q.questions.every((x) => !('ans' in x)) && !q.questions_json), 'لا إجابات للطالب');

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
