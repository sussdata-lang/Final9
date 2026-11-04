import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Str0ng-Test-Pass!';
const SAMPLE_TABLES = ['lms_lectures', 'lms_quizzes', 'library_books', 'library_loans', 'research_projects', 'postgrad_theses', 'alumni_records', 'career_jobs', 'career_applications',
  'qa_kpis', 'qa_surveys', 'qa_accreditations', 'exam_schedules', 'grade_appeals', 'office_hour_bookings', 'faculty_promotions', 'dorm_rooms', 'dorm_allocations', 'scholarships', 'student_activities',
  'hr_appraisals', 'hr_trainings', 'hr_biometric_devices', 'infra_settings', 'ai_early_warnings', 'ai_triage_logs', 'devops_incident_reports', 'sa_card_activity_logs', 'smart_schedule_slots',
  'online_quizzes', 'online_quiz_submissions', 'student_self_enrollments', 'faculty_overload_records', 'hr_signed_payslips', 'student_fee_installments', 'multi_channel_notifications', 'encrypted_snapshots',
  'offline_sync_batches', 'sa_applicants', 'sa_credit_equivalences', 'sa_advising_warnings', 'sa_lifecycle_movements', 'sa_disciplinary_details', 'sa_scholarships', 'sa_desk_appointments', 'sa_course_prerequisites', 'courses', 'grades'];
const READ_SCREENS = ['/api/enterprise/overview', '/api/student-affairs-suite/overview', '/api/devops/overview', '/api/hr-pro/overview', '/api/lms/overview', '/api/expansions/overview', '/api/student-life/overview', '/api/ai/overview', '/api/research/overview', '/api/alumni/overview', '/api/qa/overview', '/api/analytics', '/api/stats'];

let app, call, adm;
const count = (t) => Number(app.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sample-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('adm', 'adm', ?, 'admin', ?)").run(await hashPassword(PW, 1024), Date.now());
  adm = (await call('POST', '/api/auth/login', { body: { username: 'adm', password: PW } })).cookie;
});
test.after(async () => { if (app) await app.close(); });

test('قاعدة جديدة بلا سجلات نموذجية، وفتح الشاشات لا يعيدها، والكليات والهيكل باقيان', async () => {
  for (const t of SAMPLE_TABLES) assert.equal(count(t), 0, t);
  for (const url of READ_SCREENS) assert.equal((await call('GET', url, { cookie: adm })).status, 200, url);
  for (const t of SAMPLE_TABLES) assert.equal(count(t), 0, `${t} بعد فتح الشاشات`);

  // البيانات الأساسية للجامعة ليست نموذجية
  for (const t of ['faculties', 'programs', 'org_units', 'unit_links', 'service_types', 'rules', 'hr_system_lookups', 'hr_alert_settings', 'proc_categories']) assert.ok(count(t) > 0, t);
  assert.ok(Number(app.db.prepare("SELECT COUNT(*) c FROM faculties WHERE active = 1 AND name <> ''").get().c) > 0, 'الكليات والمعاهد بأسمائها');
});

test('الترحيل يحذف الصفوف المزروعة بعينها فقط: المعدَّل وما عليه سجل فعلي والكليات تبقى', () => {
  const { db } = app, now = Date.now(), SEEDED = 1761400000000;
  const before = ['faculties', 'programs', 'org_units'].map(count);
  // مزروع كما هو
  db.prepare("INSERT INTO qa_kpis (code, title, standard_domain, target_value, actual_value, unit, status, academic_year, updated_at) VALUES ('KPI-ACA-01', 'م', 'م', 95, 96, '%', 'متحقق', '2026/2027', ?)").run(SEEDED);
  // مزروع عدّله المستخدم
  db.prepare("INSERT INTO qa_kpis (code, title, standard_domain, target_value, actual_value, unit, status, academic_year, updated_at) VALUES ('KPI-STU-02', 'م', 'م', 90, 70, '%', 'حرِج', '2026/2027', ?)").run(now);
  // كتابان مزروعان: أحدهما أعاره موظف فعلاً
  const book = db.prepare("INSERT INTO library_books (id, isbn, title, author, category, copies_total, copies_available, created_at) VALUES (?, ?, 'ك', 'م', 'ع', 5, 5, ?)");
  book.run(1, '978-9933-10-401-2', SEEDED); book.run(2, '978-9933-10-402-9', SEEDED);
  db.prepare("INSERT INTO library_loans (id, book_id, borrower_name, borrower_no, loan_date, due_date, status, created_at) VALUES (500, 1, 'حقيقي', 'R-1', '2026-11-01', '2026-11-15', 'borrowed', ?)").run(now);
  // حركة قيد فعلية تصادف رقمها رقماً مزروعاً
  const studentId = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('real1', 'طالب', 'x', 'student', 'R-2', ?)").run(now).lastInsertRowid);
  const mov = db.prepare("INSERT INTO sa_lifecycle_movements (movement_no, student_id, movement_type, academic_year, semester, from_status, to_status, financial_impact, academic_impact, decision_no, reason, status, created_by, created_at) VALUES (?, ?, 'postponement', '2026', 1, 'active', 'suspended', 'x', 'y', ?, 'z', 'approved', 'م', ?)");
  mov.run('MOV-2026-001', studentId, 'قرار مجلس كلية #412', now); mov.run('MOV-2026-002', studentId, 'قرار فعلي 7', now);
  // مقرران مزروعان: أحدهما له علامة فعلية. وعلامة مزروعة وأخرى فعلية بالقيم نفسها
  const programId = db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const course = db.prepare('INSERT INTO courses (program_id, name, code, hours, level, semester, instructor, active) VALUES (?, ?, ?, 3, 1, 1, ?, 1)');
  const usedCourse = Number(course.run(programId, 'مدخل إلى الخوارزميات والبرمجة', 'CS101', 'د. رامي الشامي').lastInsertRowid);
  const seedCourse = Number(course.run(programId, 'تراكيب البيانات والبرمجة المتقدمة', 'CS102', 'د. رامي الشامي').lastInsertRowid);
  const seedPrereq = db.prepare('INSERT INTO sa_course_prerequisites (course_id, prereq_course_id, min_mark) VALUES (?, ?, 60)').run(seedCourse, usedCourse).lastInsertRowid;
  const grade = db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, theory_mark, practical_mark, course_id, level, semester, academic_year, entered_by, entered_at, workflow_status, approved_by, approved_at) VALUES (?, 'الفصل الأول', 'c', 3, 88, 60, 28, ?, 1, 1, '2025-2026', 1, ?, 'approved', 1, ?)");
  const otherCourse = Number(course.run(programId, 'مقرر فعلي', 'REAL-1', 'د. فعلي').lastInsertRowid);
  const seededGrade = Number(grade.run(studentId, otherCourse, now, now).lastInsertRowid);
  const realGrade = Number(grade.run(studentId, usedCourse, now, now + 5000).lastInsertRowid);

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(dir, '../server/migrations/041_remove_sample_data.sql'), 'utf8');
  for (const statement of sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) db.prepare(statement).run();

  const has = (table, where, ...args) => !!db.prepare(`SELECT 1 AS x FROM ${table} WHERE ${where}`).get(...args);
  assert.ok(!has('qa_kpis', "code = 'KPI-ACA-01'"), 'المزروع حُذف');
  assert.ok(has('qa_kpis', "code = 'KPI-STU-02'"), 'ما عدّله المستخدم باقٍ');
  assert.ok(has('library_books', 'id = 1'), 'الكتاب المعار باقٍ');
  assert.ok(has('library_loans', 'id = 500'), 'والإعارة الفعلية باقية');
  assert.ok(!has('library_books', 'id = 2'), 'والكتاب غير المعار حُذف');
  assert.ok(!has('sa_lifecycle_movements', "movement_no = 'MOV-2026-001'"));
  assert.ok(has('sa_lifecycle_movements', "movement_no = 'MOV-2026-002'"), 'الرقم وحده لا يكفي للحذف');
  assert.ok(!has('grades', 'id = ?', seededGrade), 'العلامة المزروعة حُذفت');
  assert.ok(has('grades', 'id = ?', realGrade), 'والفعلية بالقيم نفسها باقية');
  assert.ok(has('courses', 'id = ?', usedCourse), 'المقرر الذي عليه علامة باقٍ');
  assert.ok(!has('courses', 'id = ?', seedCourse), 'والمقرر المزروع بلا سجلات حُذف');
  assert.ok(!has('sa_course_prerequisites', 'id = ?', seedPrereq), 'ومتطلبه معه');
  assert.deepEqual(['faculties', 'programs', 'org_units'].map(count), before, 'الكليات والبرامج والوحدات لا تُمس');
});
