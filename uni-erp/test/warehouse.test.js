// مستودع البيانات الخفيف: لقطة شهرية عابرة للوحدات (أكاديمية، مالية، موارد بشرية، مشتريات، خدمة، انضباط).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { captureSnapshot, periodOf, METRICS } from '../server/services/warehouse.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const api = async (m, u, who, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const now = Date.now(), period = periodOf(new Date(now));

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-warehouse-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024);
  const db = app.db;
  const user = (u, role, perms) => { id[u] = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, now, perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  user('adm', 'admin'); user('stat', 'staff', ['stats:read']); user('emp', 'staff', ['student:read']);
  db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of ['adm', 'stat', 'emp']) ck[u] = await login(u);

  // طالب فعّال مسجَّل هذا الشهر
  const prog = db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const stuId = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('WH-S1','طالب',?,'student','WH-S1',?) RETURNING id").get(hash, now).id);
  db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 'ج', 'د', '91234567890', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`)
    .run(stuId, prog, now, now);

  // علامة معتمدة هذا الشهر
  const course = Number(db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'مقرر', 'WH-101', 3) RETURNING id").get(prog).id);
  db.prepare("INSERT INTO grades (student_id, course_id, term, course, hours, academic_year, mark, workflow_status, entered_at) VALUES (?, ?, '2026/2027-الفصل الأول', 'مقرر', 3, '2026/2027', 72, 'approved', ?)").run(stuId, course, now);

  // رسوم: فاتورة مفتوحة ودفعة جزئية هذا الشهر
  const acc = Number(db.prepare("INSERT INTO fin_accounts (code, name, type, created_at) VALUES ('WH-ACC', 'الصندوق التجريبي', 'asset', ?) RETURNING id").get(now).id);
  const feeType = Number(db.prepare("INSERT INTO fin_fee_types (code, name, kind, account_id) VALUES ('WH-FEE', 'رسم تجريبي', 'fee', ?) RETURNING id").get(acc).id);
  db.prepare("INSERT INTO fin_charges (student_id, fee_type_id, amount, due_day, status, created_at) VALUES (?, ?, 100000, '2026-09-15', 'open', ?)").run(stuId, feeType, now);
  db.prepare("INSERT INTO fin_payments (receipt_no, student_id, amount, method, account_id, paid_day, status, created_at) VALUES ('WH-REC-1', ?, 40000, 'cash', ?, ?, 'ok', ?)").run(stuId, acc, new Date(now).toISOString().slice(0, 10), now);

  // موظف فعّال
  db.prepare("INSERT INTO hr_employees (employeeNo, name, personalId, hireDate, salary_base, housing_allowance, transport_allowance, created_at, updated_at) VALUES ('WH-E1', 'موظف تجريبي', 'P-WH-1', '2024-01-01', 900000, 50000, 20000, ?, ?)").run(now, now);

  // أمر شراء مُرسَل هذا الشهر
  const sup = Number(db.prepare("INSERT INTO proc_suppliers (code, name, created_at) VALUES ('WH-SUP', 'مورد تجريبي', ?) RETURNING id").get(now).id);
  db.prepare("INSERT INTO proc_orders (no, supplier_id, status, total_amount, ordered_at, created_at) VALUES ('WH-PO-1', ?, 'ordered', 250000, ?, ?)").run(sup, now, now);

  // خدمة وطلب مقدَّم هذا الشهر
  db.prepare("INSERT INTO service_types (code, label, description, sla_hours, fields_json) VALUES ('wh_svc', 'خدمة تجريبية', 'وصف', 48, '[]') ON CONFLICT DO NOTHING").run();
  db.prepare("INSERT INTO requests (no, student_id, service_code, details_json, status, created_at) VALUES ('WH-REQ-1', ?, 'wh_svc', '{}', 'review', ?)").run(stuId, now);

  // مانع انضباطي فُرض هذا الشهر (عدّ فقط، دون محتواه)
  db.prepare("INSERT INTO student_holds (student_id, hold_type, note, active, created_at) VALUES (?, 'disciplinary', 'enc1:x', 1, ?)").run(stuId, now);
});
test.after(async () => { await app.close(); });

test('captureSnapshot: يحسب كل مؤشر من بياناته الخام، ويُستبدَل لا يتضاعف عند إعادة التشغيل', () => {
  const r1 = captureSnapshot(app.db, period);
  assert.equal(r1.period, period); assert.equal(r1.metrics, Object.keys(METRICS).length);
  const row = (code) => Number(app.db.prepare('SELECT value FROM wh_metrics WHERE period = ? AND metric_code = ?').get(period, code)?.value);

  assert.equal(row('enrollment_active'), 1);
  assert.equal(row('enrollment_new'), 1);
  assert.equal(row('avg_mark'), 72);
  assert.equal(row('fee_collected'), 40000);
  assert.equal(row('fee_outstanding'), 60000);
  assert.equal(row('payroll_cost'), 970000);
  assert.equal(row('staff_headcount'), 1);
  assert.equal(row('procurement_spend'), 250000);
  assert.equal(row('requests_total'), 1);
  assert.equal(row('disciplinary_opened'), 1);

  captureSnapshot(app.db, period);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) n FROM wh_metrics WHERE period = ?').get(period).n), Object.keys(METRICS).length, 'صف واحد لكل مؤشر، لا تضاعف');
  assert.equal(row('enrollment_active'), 1, 'القيمة تُستبدل لا تُراكم');
});

test('الواجهة البرمجية: محصورة بصلاحية stats:read، والنظرة تعيد السلسلة الزمنية والتغيّر', async () => {
  assert.equal((await api('GET', '/api/warehouse/overview', 'emp')).s, 403);
  const ov = await api('GET', '/api/warehouse/overview', 'stat');
  assert.equal(ov.s, 200); assert.equal(ov.j.hasData, true); assert.equal(ov.j.latest, period);
  const enr = ov.j.kpis.find((k) => k.code === 'enrollment_active');
  assert.equal(enr.value, 1); assert.equal(enr.series.at(-1), 1);

  assert.equal((await api('POST', '/api/warehouse/capture', 'stat')).s, 403, 'الحساب اليدوي للمدير فقط');
  const cap = await api('POST', '/api/warehouse/capture', 'adm');
  assert.equal(cap.s, 200); assert.equal(cap.j.period, period);
});
