import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { seedPassword } from '../server/services/bootstrap.js';

const PW = 'Str0ng-Test-Pass!';
const opts = (dir) => ({ uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });

async function client(app) {
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  return { call, login: async (username, password = PW) => (await call('POST', '/api/auth/login', { body: { username, password } })) };
}

test('إعادة التشغيل لا تعيد ضبط كلمات مرور الحسابات ولا تنشئ حسابات تجريبية', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sec-'));
  // قاعدة مستقلة: مسار التشغيل الافتراضي يستعمل DATABASE_URL مباشرة
  const adminUrl = process.env.DATABASE_URL, dbName = `sec_restart_${process.pid}_${Date.now()}`;
  const admin0 = new pg.Client({ connectionString: adminUrl }); await admin0.connect();
  await admin0.query(`CREATE DATABASE ${dbName}`);
  const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${dbName}`;
  const prev = { DATABASE_URL: adminUrl, DEMO_MODE: process.env.DEMO_MODE, SEED_PASSWORD: process.env.SEED_PASSWORD };
  process.env.DATABASE_URL = dbUrl.href;
  delete process.env.DEMO_MODE; delete process.env.SEED_PASSWORD;
  try {
    const first = await createApp(opts(dir));
    const admin = first.db.prepare("SELECT must_change_password mc FROM users WHERE username = 'admin'").get();
    assert.equal(admin.mc, 1, 'كلمة المرور الافتراضية تُلزم بالتغيير عند أول دخول');
    assert.equal(first.db.prepare("SELECT COUNT(*) c FROM users WHERE username IN ('staff1', 'CYB-2026-0001')").get().c, 0);
    const hash = await hashPassword(PW, 1024);
    first.db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = 'admin'").run(hash);
    first.db.prepare("INSERT INTO users (username, display_name, password_hash, role, active, created_at) VALUES ('st-real', 'طالب', ?, 'student', 0, ?)").run(hash, Date.now());
    await first.close();

    const second = await createApp(opts(dir));
    const c = await client(second);
    try {
      assert.equal((await c.login('admin')).status, 200, 'تبقى كلمة المرور التي عيّنها المستخدم');
      assert.notEqual((await c.login('admin', seedPassword())).status, 200, 'الكلمة المولَّدة لم تعد صالحة');
      assert.equal(second.db.prepare("SELECT active FROM users WHERE username = 'st-real'").get().active, 0, 'الحساب المعطّل يبقى معطلاً');
    } finally { await second.close(); }
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await admin0.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin0.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('مسارات حزمة المؤسسة والأداء تفرض الصلاحيات', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sec2-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), ...opts(dir) });
  const c = await client(app);
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const hash = await hashPassword(PW, 1024);
  const add = (u, role, no = null) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, u, hash, role, no, Date.now());
  add('adm', 'admin'); add('stu', 'student', 'STU-1'); add('other', 'student', 'STU-2');
  const adm = (await c.login('adm')).cookie, stu = (await c.login('stu')).cookie;

  // مسارات الأداء لا تعمل دون جلسة، ولا تعمل للطالب
  for (const [m, u] of [['GET', '/api/v12/high-concurrency/telemetry'], ['POST', '/api/v12/high-concurrency/benchmark']]) {
    const body = m === 'POST' ? {} : undefined;
    assert.equal((await c.call(m, u, { body })).status, 401, `${u} بلا جلسة`);
    assert.equal((await c.call(m, u, { body, cookie: stu })).status, 403, `${u} للطالب`);
  }
  assert.equal((await c.call('GET', '/api/v12/high-concurrency/telemetry', { cookie: adm })).status, 200);

  // الطالب لا يرى الرواتب ولا إجابات الاختبارات ولا بيانات غيره
  const inst = app.db.prepare("INSERT INTO student_fee_installments (installment_code, student_no, student_name, faculty_name, installment_no, amount, due_date) VALUES ('INST-T', 'STU-2', 'x', 'y', 1, 100, '2026-12-01')").run();
  const instId = Number(inst.lastInsertRowid);
  app.db.prepare("INSERT INTO hr_signed_payslips (payslip_code, employee_code, employee_name, department, month_label, basic_salary, overload_pay, allowances, deductions, net_salary, digital_signature, issued_at) VALUES ('PAY-T', 'E-1', 'x', 'y', 'شهر', 1, 0, 0, 0, 1, 'SIG', ?)").run(Date.now());
  app.db.prepare("INSERT INTO lms_quizzes (course_code, course_name, title, instructor_name, duration_min, total_marks, questions_json, published, created_at) VALUES ('C', 'C', 'ق', 'م', 10, 10, ?, 1, ?)").run(JSON.stringify([{ q: 'س', options: ['أ', 'ب'], ans: 1 }]), Date.now());
  const ov = (await c.call('GET', '/api/enterprise/overview', { cookie: stu })).json;
  assert.equal(ov.signedPayslips.length, 0);
  assert.equal(ov.facultyOverloads.length, 0);
  assert.equal(ov.encryptedSnapshots.length, 0);
  assert.ok(ov.feeInstallments.every((x) => x.student_no === 'STU-1'));
  assert.ok(ov.quizzes.length > 0 && ov.quizzes.every((q) => !q.questions_json && q.questions.every((x) => !('answer' in x))));
  assert.ok((await c.call('GET', '/api/enterprise/overview', { cookie: adm })).json.signedPayslips.length > 0, 'المدير يراها');

  // رمز GW- الذي يرسله المتصفح لا يسجّل دفعاً
  const forged = await c.call('POST', `/api/enterprise/installments/${instId}/pay`, { cookie: stu, body: { gateway_token: 'GW-forged' } });
  assert.equal(forged.status, 403);
  assert.ok(!app.db.prepare('SELECT paid_at FROM student_fee_installments WHERE id = ?').get(instId).paid_at);
  assert.equal((await c.call('POST', `/api/enterprise/installments/${instId}/pay`, { cookie: adm, body: {} })).status, 200);
  assert.equal((await c.call('POST', `/api/enterprise/installments/${instId}/pay`, { cookie: adm, body: {} })).status, 409, 'لا يُسدَّد مرتين');

  // العمليات الإدارية مرفوضة للطالب
  for (const [u, body] of [['/api/enterprise/notifications/broadcast', { title: 'x', body: 'y' }], ['/api/enterprise/offline-sync', {}]]) {
    assert.equal((await c.call('POST', u, { cookie: stu, body })).status, 403, u);
  }

  // البحث الشامل لا يكشف الطلاب أو الرواتب، والطالب يسجّل لنفسه فقط
  const found = (await c.call('GET', '/api/enterprise/global-search', { cookie: stu })).json;
  assert.equal(found.students.length, 0);
  assert.equal(found.payslips.length, 0);
  app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES ((SELECT id FROM programs ORDER BY id LIMIT 1), 1, 1, 'مقرر أمن', 'SEC-1', 3)").run();
  assert.equal((await c.call('POST', '/api/enterprise/self-enroll', { cookie: stu, body: { course_code: 'SEC-1', course_name: 'x', student_no: 'STU-2' } })).status, 201);
  assert.equal(app.db.prepare("SELECT student_no FROM student_self_enrollments WHERE course_code = 'SEC-1'").get().student_no, 'STU-1');
});

test('فتح «مكتبي» لا يحذف الصلاحيات من بيانات الحساب، فإعادة التحميل لا تُخرج المستخدم', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sec4-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), ...opts(dir) });
  const c = await client(app);
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('adm', 'adm', ?, 'admin', ?)").run(hash, Date.now());
  const adm = (await c.login('adm')).cookie;
  assert.equal((await c.call('GET', '/api/me/desk', { cookie: adm })).status, 200);
  const me = (await c.call('GET', '/api/me', { cookie: adm })).json.user;
  assert.ok(Array.isArray(me.permissions) && me.permissions.length > 0, 'الصلاحيات باقية بعد فتح مكتبي');
});

test('مسارات الوحدات الموسعة وشؤون الطلاب والموارد البشرية تفرض الصلاحيات', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sec3-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), ...opts(dir) });
  const c = await client(app);
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const hash = await hashPassword(PW, 1024);
  const add = (u, role, no = null, custom = null) => Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, custom_permissions_json, created_at) VALUES (?,?,?,?,?,?,?)').run(u, u, hash, role, no, custom ? JSON.stringify(custom) : null, Date.now()).lastInsertRowid);
  add('adm', 'admin');
  const stuId = add('stu', 'student', 'STU-1');
  const otherId = add('other', 'student', 'STU-2');
  add('plain', 'staff');
  add('auditor2', 'auditor');
  add('examiner', 'staff', null, ['grade:approve']);
  const cookie = async (u) => (await c.login(u)).cookie;
  const adm = await cookie('adm'), stu = await cookie('stu'), plain = await cookie('plain'), auditor = await cookie('auditor2'), examiner = await cookie('examiner');

  // 1) كل مسار كتابة في النظام يرفض الطالب، إلا ما يخصه هو
  const STUDENT_WRITES = new Set([
    'PUT /api/me/profile', 'POST /api/complaints', 'POST /api/requests', 'POST /api/push/subscribe', 'POST /api/push/unsubscribe', 'POST /api/push/test',
    'POST /api/alumni/applications', 'POST /api/expansions/appeals', 'POST /api/expansions/office-bookings', 'POST /api/ai/advisor/ask',
    // تجديد الطالب قيده وتظلمه من قراره هما خدمتان له
    'POST /api/student-regulations/renew', 'POST /api/student-regulations/appeals',
    'POST /api/lms/quizzes/1/submit', 'POST /api/lms/quizzes/1/start', 'POST /api/enterprise/gpa-simulate', 'POST /api/enterprise/self-enroll', 'POST /api/student-affairs-suite/queue/book',
    // الإلغاء يمس ملفات المستخدم نفسه فقط، والمعرّف هنا ليس نوع استيراد؛ رفض الأنواع الفعلية في import_engine.test.js
    'POST /api/import-engine/cancel', 'POST /api/import-engine/1/check', 'POST /api/import-engine/1/commit',
    // حلّ الطالب وإشعاراته هو
    'PUT /api/lms/assignments/1/submission', 'POST /api/lms/assignments/1/submission/submit', 'POST /api/lms/assignments/1/submission/files', 'DELETE /api/lms/assignments/1/submission/files/1', 'POST /api/notifications/read',
    // التصحيح محميّ بملكية التكليف (404 لغير المالك)؛ يُختبر على حل حقيقي في lms_assignments_flow.test.js
    'POST /api/lms/assignments/submissions/1/grade', 'POST /api/lms/assignments/submissions/1/feedback-file',
  ]);
  const open = [];
  for (const r of app.router.routes) {
    if (r.method === 'GET' || r.opts.auth === false) continue;
    const route = r.re.source.replace(/^\^/, '').replace(/\/\?\$$/, '').replace(/\\\//g, '/').replace(/\\$/, ''), withParam = (v) => route.replace(/\(\[\^\/\]\+\)/g, String(v));
    const url = withParam(otherId);
    if (/\/api\/auth\/|logout|password/.test(url)) continue;
    const allowedKey = `${r.method} ${withParam(1)}`;
    if (STUDENT_WRITES.has(allowedKey)) continue;
    const { status } = await c.call(r.method, url, { cookie: stu, body: {} });
    if (status !== 403) open.push(`${status} ${r.method} ${url}`);
  }
  assert.deepEqual(open, [], 'مسارات كتابة لا ترفض الطالب');

  // 2) مسارات القراءة ذات البيانات الحساسة
  for (const u of ['/api/hr-pro/overview', '/api/research/overview', '/api/qa/overview', '/api/devops/overview', '/api/devops/incidents', '/api/devops/postgres-ddl']) {
    assert.equal((await c.call('GET', u, { cookie: stu })).status, 403, `${u} للطالب`);
    assert.equal((await c.call('GET', u, { cookie: adm })).status, 200, `${u} للمدير`);
  }
  assert.equal((await c.call('GET', '/api/hr-pro/overview', { cookie: plain })).status, 403, 'staffatt:self لا يكشف الرواتب');
  assert.equal((await c.call('GET', '/api/hr-pro/overview', { cookie: auditor })).status, 403);
  assert.ok(!('departmentAnalytics' in (await c.call('GET', '/api/analytics', { cookie: plain })).json), 'الإحصاءات لا تحمل إجماليات الرواتب');

  // 3) الطالب يتظلم باسمه فقط، ولا يرى تظلمات غيره، ولا يبت فيها
  const progId = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const courseId = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code) VALUES (?, 1, 1, 'مقرر التظلم', 'APL-1')").run(progId).lastInsertRowid);
  app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'مقرر التظلم', 3, 70, ?, 1, 1, '2025/2026', 70, ?, 'approved')").run(stuId, courseId, Date.now());
  const appeal = await c.call('POST', '/api/expansions/appeals', { cookie: stu, body: { student_no: 'STU-2', student_name: 'مزور', course_code: 'APL-1', reason: 'y' } });
  assert.equal(appeal.status, 201);
  const row = app.db.prepare('SELECT student_no, student_name FROM grade_appeals WHERE id = ?').get(appeal.json.id);
  assert.equal(row.student_no, 'STU-1');
  assert.equal(row.student_name, 'stu');
  const exp = (await c.call('GET', '/api/expansions/overview', { cookie: stu })).json;
  assert.ok(exp.appeals.length >= 1 && exp.appeals.every((a) => a.student_no === 'STU-1'));
  assert.equal(exp.appraisals.length + exp.biometrics.length + exp.promotions.length, 0);
  const decide = `/api/expansions/appeals/${appeal.json.id}/decide`;
  assert.equal((await c.call('POST', decide, { cookie: stu, body: { approve: true, new_mark: 100 } })).status, 403);
  assert.equal((await c.call('POST', decide, { cookie: plain, body: { approve: true, new_mark: 100 } })).status, 403, 'grade:manage وحده لا يبت في التظلم');
  assert.equal((await c.call('POST', decide, { cookie: examiner, body: { approve: true, new_mark: 80, committee_note: 'إعادة جمع الدرجات' } })).status, 200, 'grade:approve يبت');
  assert.equal((await c.call('POST', decide, { cookie: adm, body: { approve: false, committee_note: 'x' } })).status, 409, 'لا يُبت مرتين');
  assert.equal((await c.call('POST', '/api/expansions/appeals/999999/decide', { cookie: adm, body: {} })).status, 404);

  // 4) إجابات الاختبارات وبيانات الخريجين
  app.db.prepare("INSERT INTO lms_quizzes (course_code, course_name, title, duration_min, total_marks, questions_json, published, created_at) VALUES ('C', 'C', 'ق', 10, 10, ?, 1, ?)").run(JSON.stringify([{ q: 'س', options: ['أ', 'ب'], ans: 1 }]), Date.now());
  app.db.prepare("INSERT INTO career_jobs (title, company_name, sector, location, active, created_at) VALUES ('و', 'ش', 'ق', 'د', 1, ?)").run(Date.now());
  const lms = (await c.call('GET', '/api/lms/overview', { cookie: stu })).json;
  assert.ok(lms.quizzes.length > 0 && lms.quizzes.every((q) => !q.questions_json && q.questions.every((x) => !('correct' in x))));
  assert.ok(lms.loans.every((l) => l.borrower_no === 'STU-1'));
  assert.ok((await c.call('GET', '/api/lms/overview', { cookie: adm })).json.quizzes.some((q) => q.questions.some((x) => 'correct' in x)), 'المدير يرى الإجابات');
  const alumni = (await c.call('GET', '/api/alumni/overview', { cookie: stu })).json;
  assert.ok(alumni.alumni.every((a) => a.student_no === 'STU-1'));
  assert.ok(alumni.jobs.length > 0);
  const job = alumni.jobs[0].id;
  const applied = await c.call('POST', '/api/alumni/applications', { cookie: stu, body: { job_id: job, student_no: 'STU-2', applicant_name: 'مزور' } });
  assert.equal(applied.status, 201);
  assert.equal(app.db.prepare('SELECT student_no FROM career_applications WHERE id = ?').get(applied.json.id).student_no, 'STU-1');
  assert.equal((await c.call('POST', '/api/alumni/applications', { cookie: stu, body: { job_id: 999999 } })).status, 404);

  // 5) شؤون الطلاب: الطالب يرى بياناته فقط، ولا يكشف الأرقام الوطنية، ولا يربط تذكرته بطلب غيره
  app.db.prepare("INSERT INTO sa_applicants (application_no, full_name, national_id, phone, hs_type, hs_score, hs_year, category, pref1_program_id, sorting_status, created_at) VALUES ('ADM-T', 'متقدم', '91000000001', '0944000000', 'علمي', 200, 2026, 'general', ?, 'pending', ?)").run(progId, Date.now());
  const suite = await c.call('GET', `/api/student-affairs-suite/overview?studentId=${otherId}`, { cookie: stu });
  assert.equal(suite.status, 200);
  assert.equal(suite.json.admissions.applicants.length, 0);
  assert.ok(suite.json.students.every((s) => s.id === stuId));
  assert.ok(suite.json.scholarships.list.every((s) => s.student_id === stuId));
  assert.ok(suite.json.lifecycle.disciplinaryRecords.every((d) => d.studentId === stuId));
  assert.ok(suite.json.deskQueue.appointments.every((a) => a.student_id === stuId));
  assert.ok((await c.call('GET', '/api/student-affairs-suite/overview', { cookie: adm })).json.admissions.applicants.length > 0);
  for (const [u, body] of [['/api/student-affairs-suite/admissions/run-sort', {}], ['/api/student-affairs-suite/advising/1/resolve', {}], ['/api/student-affairs-suite/queue/1/status', { status: 'completed' }]]) {
    assert.equal((await c.call('POST', u, { cookie: stu, body })).status, 403, u);
  }
  assert.equal((await c.call('POST', '/api/student-affairs-suite/admissions/run-sort', { cookie: plain, body: {} })).status, 403, 'الفرز يتطلب sa_admissions:approve');
  assert.equal((await c.call('POST', '/api/student-affairs-suite/admissions/run-sort', { cookie: adm, body: {} })).status, 200);
  const service = app.db.prepare('SELECT code FROM service_types LIMIT 1').get().code;
  const reqId = Number(app.db.prepare("INSERT INTO requests (no, student_id, service_code, details_json, status, created_at) VALUES ('R-SEC', ?, ?, '{}', 'review', ?)").run(otherId, service, Date.now()).lastInsertRowid);
  assert.equal((await c.call('POST', '/api/student-affairs-suite/queue/book', { cookie: stu, body: { requestId: reqId, studentId: otherId } })).status, 404);
  const ticket = await c.call('POST', '/api/student-affairs-suite/queue/book', { cookie: stu, body: { studentId: otherId } });
  assert.equal(ticket.status, 201);
  assert.equal(Number(app.db.prepare('SELECT student_id FROM sa_desk_appointments WHERE id = ?').get(ticket.json.id).student_id), stuId, 'التذكرة باسم الطالب نفسه');

  // 6) أصحاب الصلاحية يحتفظون بعملهم، وكشف رسوم الطالب لا يتعطل
  assert.equal((await c.call('GET', '/api/ai/overview', { cookie: plain })).status, 200);
  assert.equal((await c.call('GET', '/api/me/fees', { cookie: stu })).status, 200);
  const stuProfileless = await c.call('POST', `/api/students/${otherId}/card-activity`, { cookie: plain, body: {} });
  assert.notEqual(stuProfileless.status, 403, 'الموظف يسجّل نشاط البطاقة');
  const roomId = Number(app.db.prepare("INSERT INTO dorm_rooms (building_name, room_no, capacity, occupied) VALUES ('م', '1', 2, 0)").run().lastInsertRowid);
  assert.equal((await c.call('POST', '/api/housing/allocations', { cookie: adm, body: { student_no: 'STU-1', room_id: 999999 } })).status, 400, 'لا إسكان في غرفة غير موجودة');
  for (const [u, body, expected] of [
    ['/api/research/projects', { title: 'بحث' }, 201], ['/api/alumni/jobs', { title: 'وظيفة', deadline: '2030-01-01' }, 201], ['/api/qa/kpis', { title: 'مؤشر' }, 201],
    ['/api/expansions/exams', { course_code: 'X-1', course_name: 'x' }, 201],
    ['/api/expansions/appraisals', { employee_name: 'x', period_label: 'التقييم السنوي' }, 201],
    ['/api/expansions/biometrics/sync', {}, 200], ['/api/devops/incidents', { error_message: 'x' }, 201],
  ]) {
    assert.equal((await c.call('POST', u, { cookie: adm, body })).status, expected, `${u} للمدير`);
  }
});

test('البطاقة ورصد اللجان والتسجيل الذاتي تعتمد على سجلات الخادم الفعلية', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-rec-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), ...opts(dir) });
  const c = await client(app);
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, no = null) => Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, u, hash, role, no, Date.now()).lastInsertRowid);
  add('adm', 'admin');
  const stuId = add('stu', 'student', 'REC-1');
  const program = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  app.db.prepare("INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at) VALUES (?, 'طالب', 'أب', 'تجربة', 'أم', '01010011999', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 1, 'active', 'ولي', 'أب', '0944111222', ?, ?)").run(stuId, program, Date.now(), Date.now());
  app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'مقرر فعلي', 'REC-101', 4)").run(program);
  const adm = (await c.login('adm')).cookie, stu = (await c.login('stu')).cookie;

  // البطاقة: لا موقع افتراضي، وبصمة الخادم هي المحفوظة لا ما يرسله المتصفح
  const card = (body) => c.call('POST', `/api/students/${stuId}/card-activity`, { cookie: adm, body });
  assert.equal((await card({})).status, 400);
  assert.equal((await card({ eventType: 'other', locationName: 'م', locationCode: 'L' })).status, 400);
  assert.equal((await card({ eventType: 'check_in', locationName: 'البوابة', locationCode: 'G1', pkiHash: '0xfake' })).status, 201);
  const logs = (await c.call('GET', `/api/students/${stuId}/card-activity`, { cookie: adm })).json.logs;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].terminal_id, 'MANUAL');
  assert.match(logs[0].pki_hash, /^sha256:/);

  // رصد اللجنة: الحقول مطلوبة، والأرقام تُتحقق، والحضور يدخل سجل القاعات
  const att = (body) => c.call('POST', '/api/enterprise/offline-sync', { cookie: adm, body });
  assert.equal((await att({})).status, 400);
  assert.equal((await att({ committee_name: 'ل', hall_code: 'ق', course_code: 'NOPE', student_nos: ['REC-1'] })).status, 404);
  assert.equal((await att({ committee_name: 'ل', hall_code: 'ق', course_code: 'REC-101', student_nos: [] })).status, 400);
  assert.equal((await att({ committee_name: 'ل', hall_code: 'ق', course_code: 'REC-101', student_nos: ['REC-1', 'NOPE-9'] })).status, 400);
  const okAtt = await att({ committee_name: 'ل', hall_code: 'ق', course_code: 'REC-101', student_nos: ['REC-1', 'REC-1'] });
  assert.equal(okAtt.status, 201);
  assert.equal(okAtt.json.recorded_count, 1);
  const hallRow = app.db.prepare('SELECT kind, hall, subject FROM hall_logs WHERE student_id = ?').get(stuId);
  assert.deepEqual([hallRow.kind, hallRow.hall, hallRow.subject], ['exam', 'ق', 'مقرر فعلي']);

  // التسجيل الذاتي: المقرر من السجل، ولا عبرة بالاسم والساعات المرسلة
  const ov = (await c.call('GET', '/api/enterprise/overview', { cookie: stu })).json;
  assert.deepEqual(ov.enrollableCourses.map((x) => x.code), ['REC-101']);
  assert.equal((await c.call('POST', '/api/enterprise/self-enroll', { cookie: stu, body: { course_code: 'CYB-401', course_name: 'وهمي', credits: 4 } })).status, 404);
  assert.equal((await c.call('POST', '/api/enterprise/self-enroll', { cookie: stu, body: { course_code: 'REC-101', course_name: 'اسم مزور', credits: 1 } })).status, 201);
  const en = app.db.prepare("SELECT course_name, credits FROM student_self_enrollments WHERE course_code = 'REC-101'").get();
  assert.equal(en.course_name, 'مقرر فعلي');
  assert.equal(Number(en.credits), 4);

  // الذكاء الاصطناعي: الواجهة تعرف أن الرد بالقواعد عند غياب المفتاح
  const aiOv = (await c.call('GET', '/api/ai/overview', { cookie: adm })).json;
  assert.equal(aiOv.aiEnabled, Boolean(process.env.GEMINI_API_KEY));
  assert.equal((await c.call('GET', '/api/finance/entries', { cookie: adm })).status, 404);
  assert.equal((await c.call('GET', '/api/finance/years', { cookie: adm })).status, 404);
  assert.equal((await c.call('GET', '/api/finance/fiscal-years', { cookie: adm })).status, 200);
});

test('تسجيل الحضور ثابت لكل موظف ولو سُحب منه أو عُطل دوره', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-punch-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), ...opts(dir) });
  const c = await client(app);
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, extra = {}) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, access_mode, revoked_permissions_json, created_at) VALUES (?,?,?,?,?,?,?)').run(u, u, hash, role, extra.mode ?? 'role', extra.revoked ?? '[]', Date.now());
  add('aud', 'auditor');
  add('rev', 'staff', { revoked: '["staffatt:self"]' });
  add('cus', 'staff', { mode: 'custom' });
  for (const u of ['aud', 'rev', 'cus']) {
    const { cookie } = await c.login(u);
    assert.equal((await c.call('POST', '/api/hr/attendance/punch', { cookie, body: {} })).status, 200, u);
    assert.equal((await c.call('GET', '/api/hr/attendance/me', { cookie })).status, 200, u);
  }
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('st', 'st', ?, 'student', 'PUN-1', ?)").run(hash, Date.now());
  const st = (await c.login('st')).cookie;
  assert.equal((await c.call('POST', '/api/hr/attendance/punch', { cookie: st, body: {} })).status, 403, 'الطالب لا يسجل دوام موظف');
});
