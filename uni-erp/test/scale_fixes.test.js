// مشكلات لا تظهر إلا مع بيانات كبيرة: نتيجة تتجاوز الذاكرة المشتركة، ولوحة شؤون الطلاب، ومسار مفتاح التوقيع مع PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { loadIdentity } from '../server/services/pki.js';

let app, call;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-scale-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`, PW = 'Str0ng-Test-Pass!';
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('adm', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'adm', password: PW }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  call = async (url) => { const r = await fetch(base + url, { headers: { Cookie } }); return { status: r.status, json: await r.json() }; };
});
test.after(async () => { if (app) await app.close(); });

test('نتيجة استعلام أكبر من الذاكرة المشتركة تصل كاملة، والعربية لا تتقطع عند حدود الدفعات', () => {
  const rows = app.db.prepare("SELECT g AS n, repeat('طالب', 250000) AS t FROM generate_series(1, 6) g ORDER BY g").all();   // 12 ميغابايت تقريباً
  assert.equal(rows.length, 6);
  assert.equal(rows[5].n, 6);
  for (const r of rows) { assert.equal(r.t.length, 1000000); assert.ok(!r.t.includes('�')); }
  assert.equal(app.db.prepare('SELECT 1 AS one').get().one, 1, 'الاستعلام التالي سليم');
});

test('لوحة شؤون الطلاب: لا قائمة بكل الطلاب، والطلاب المتعثرون بعدّهم الكلي وأضعف 100', async () => {
  const now = Date.now(), prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const hash = 'x';
  for (let i = 0; i < 120; i++) {
    const id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?, ?, ?, 'student', ?, ?)").run(`sc-${i}`, `طالب ${i}`, hash, `SC-${i}`, now).lastInsertRowid);
    app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'أ', 'ب', 'ج', 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', ?, 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id, String(80000000000 + i), `09${50000000 + i}`, prog, now, now);
    app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, workflow_status) VALUES (?, 'ف', 'م', 3, ?, 'approved')").run(id, 30 + (i % 20));
  }
  const { status, json } = await call('/api/student-affairs-suite/overview');
  assert.equal(status, 200);
  assert.ok(json.students.length <= 1, 'لا تُرسل كل الأسماء');
  assert.equal(json.advising.atRiskTotal, 120);
  assert.equal(json.advising.autoDetectedAtRisk.length, 100);
  const list = json.advising.autoDetectedAtRisk;
  assert.ok(list[0].gpa <= list[99].gpa, 'الأضعف أولاً');
  assert.equal(list[0].gpa, 30);
  const picked = app.db.prepare("SELECT id FROM users WHERE student_no = 'SC-5'").get().id;
  assert.equal((await call(`/api/student-affairs-suite/overview?studentId=${picked}`)).json.targetStudent.studentNo, 'SC-5');
});

test('الطلاب لا يظهرون مسؤولين للوحدات، وقائمة البطاقات عينة بعدد صحيح، وقوائم شؤون الطلاب مقيّدة بعدّها الحقيقي', async () => {
  const uid = app.db.prepare('SELECT id FROM org_units ORDER BY id LIMIT 1').get().id;
  app.db.prepare("UPDATE users SET unit_id = ? WHERE role = 'student'").run(uid);
  app.db.prepare("UPDATE users SET unit_id = ? WHERE username = 'adm'").run(uid);
  const access = (await call('/api/admin/access')).json;
  const unit = access.units.find((u) => u.id === uid);
  assert.ok(unit.heads.some((h) => h.username === 'adm'));
  assert.ok(!unit.heads.some((h) => h.username.startsWith('sc-')), 'الطلاب ليسوا مسؤولي وحدة');
  assert.equal(access.platformModules, undefined);
  assert.equal(access.users[0].accessProfile.moduleState, undefined);
  assert.ok(access.users[0].accessProfile.capabilities);
  const sample = (await call('/api/cards/students?limit=5')).json;
  assert.equal(sample.students.length, 5);
  assert.ok(sample.total >= 120, 'العدد الكلي لا يتبع العينة');
  assert.equal((await call('/api/cards/students')).json.students.length, sample.total);
  const over = (await call('/api/student-affairs-suite/overview')).json;
  assert.equal(over.listMax, 500);
  assert.equal(typeof over.totals.warnings, 'number');
  assert.equal(over.kpis.totalApplicants, over.totals.applicants);
});

test('سجل الطلبات يعرض المرفقات والأحداث وصاحب الطلب كما كان، بعد جمع استعلاماته', async () => {
  const stu = app.db.prepare("SELECT id FROM users WHERE student_no = 'SC-1'").get().id, svc = app.db.prepare('SELECT code, label FROM service_types LIMIT 1').get();
  const rid = Number(app.db.prepare("INSERT INTO requests (no, student_id, service_code, details_json, status, created_at) VALUES ('R-SC-1', ?, ?, '{}', 'review', ?)").run(stu, svc.code, Date.now()).lastInsertRowid);
  app.db.prepare("INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?, ?, 'النظام', 'تقديم')").run(rid, Date.now());
  const row = (await call('/api/requests')).json.requests.find((r) => r.id === rid);
  assert.equal(row.student.studentNo, 'SC-1');
  assert.equal(row.events.length, 1);
  assert.deepEqual(Object.keys(row.events[0]).sort(), ['actor', 'at', 'text']);
  assert.deepEqual(row.attachments, []);
  assert.equal(row.document, null);
  assert.equal(row.service.code, svc.code);
});

test('مفتاح التوقيع مع PostgreSQL يُحفظ في مجلد البيانات، لا في مسار مشتق من رابط القاعدة', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-pki-'));
  const id = loadIdentity({ dbPath: 'postgres://user:secret@db.internal:5432/app', dataDir });
  assert.ok(id);
  assert.ok(fs.existsSync(path.join(dataDir, 'pki', 'signing.pem')));
  assert.ok(!fs.existsSync(path.resolve('postgres:')), 'لا مجلد بكلمة المرور');
});
