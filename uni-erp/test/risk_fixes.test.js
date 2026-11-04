// إصلاحات نتائج التدقيق الفني: الصلاحيات، والخمول، والحدود، والسجلات التي كانت تعرض ما لم يحدث.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECURITY_HEADERS } from '../server/http.js';
import { validatePasswordPolicy } from '../server/security.js';
import { docNo, academicYear } from '../server/lib/doc_no.js';
import { grantStudentScholarship } from '../server/services/student_affairs_suite.js';
import { effective, SOD_SENSITIVE_PERMISSIONS } from '../server/permissions.js';
import { createBackup, listBackups, decrypt } from '../server/services/backup.js';
import { readZip } from '../server/lib/zip.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { deleteEmployee } from '../server/services/hr.js';
import { idleExpired } from '../server/services/auth.js';

const actorWith = (...perms) => ({ id: 1, role: 'staff', can: (p) => perms.includes(p) });

test('تعديل بيانات الطالب لا يكفي لمنح إعفاء مالي', () => {
  assert.throws(() => grantStudentScholarship({ db: null }, actorWith('student:update'), { studentId: 1 }, '::1'), (e) => e.status === 403);
});

test('حامل finance:fees يتجاوز فحص الصلاحية', () => {
  assert.throws(() => grantStudentScholarship({ db: { prepare: () => { throw new Error('reached-db'); } } }, actorWith('finance:fees'), { studentId: 1 }, '::1'), /reached-db/);
});

test('الحد الأدنى لكلمة المرور لا يقل عن 8 مهما ضُبط الإعداد', () => {
  assert.match(validatePasswordPolicy('abc12', 4), /8/);
  assert.equal(validatePasswordPolicy('abcd1234', 4), null);
});

test('لا يُسمح بتضمين النظام إلا من نطاقه', () => {
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'self';/);
  assert.doesNotMatch(SECURITY_HEADERS['Content-Security-Policy'], /run\.app|google\.com/);
});

test('أرقام المستندات لا تتكرر، والعام الدراسي يُحسب من التاريخ', () => {
  const seen = new Set(Array.from({ length: 2000 }, () => docNo('DISC-2026')));
  assert.equal(seen.size, 2000);
  assert.equal(academicYear(new Date(2026, 8, 1)), '2026/2027');
  assert.equal(academicYear(new Date(2027, 5, 1)), '2026/2027');
  assert.equal(academicYear(new Date(2027, 8, 1)), '2027/2028');
});

test('مع التطبيق: الاختبار والبصمة والإشعار والخرائط والفصل والنسخ', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-risk-'));
  const app = await createApp({ dbPath: ':memory:', uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), dataDir: dir, backupDir: path.join(dir, 'backups'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const { db, cfg } = app;
  const PW = 'Risk#Pass12345', hash = await hashPassword(PW, cfg.scryptN);
  const ins = (u, role, no = null) => db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?)').run(u, u, hash, role, no, Date.now());
  ins('risk_st', 'student', 'RISK-1');
  const login = async (username, password = PW) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username, password }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const call = (cookie, m, u, body) => fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    await t.test('الاختبار الإلكتروني: محاولة واحدة، ولا تقديم لاختبار مغلق', async () => {
      const qs = JSON.stringify([{ q: 'س', options: ['أ', 'ب'], answer: 0 }]);
      const open = Number(db.prepare("INSERT INTO online_quizzes (course_code, course_name, title, instructor_name, questions_json, status, created_at) VALUES ('R1', 'R', 'T', 'I', ?, 'نشط', ?)").run(qs, Date.now()).lastInsertRowid);
      const closed = Number(db.prepare("INSERT INTO online_quizzes (course_code, course_name, title, instructor_name, questions_json, status, created_at) VALUES ('R2', 'R', 'T', 'I', ?, 'مغلق', ?)").run(qs, Date.now()).lastInsertRowid);
      const st = await login('risk_st');
      assert.equal((await call(st, 'POST', `/api/enterprise/quizzes/${open}/submit`, { answers: [0] })).status, 200);
      assert.equal((await call(st, 'POST', `/api/enterprise/quizzes/${open}/submit`, { answers: [1] })).status, 409);
      assert.equal((await call(st, 'POST', `/api/enterprise/quizzes/${closed}/submit`, { answers: [0] })).status, 409);
    });

    const admin = await login('admin', process.env.SEED_PASSWORD || (await seedPw()));
    await t.test('مزامنة البصمة لا تسجل وقتاً لم يحدث', async () => {
      db.prepare("INSERT INTO hr_biometric_devices (device_code, location, ip_address, status, last_sync_at) VALUES ('RISK-B', 'L', '1.1.1.1', 'متصل', 111)").run();
      const j = await (await call(admin, 'POST', '/api/expansions/biometrics/sync', {})).json();
      assert.equal(j.synced, false);
      assert.equal(Number(db.prepare("SELECT last_sync_at v FROM hr_biometric_devices WHERE device_code = 'RISK-B'").get().v), 111);
    });
    await t.test('الإشعار يُسجَّل بعدد إرسال صفر، ولو أرسل العميل رقماً', async () => {
      assert.equal((await call(admin, 'POST', '/api/enterprise/notifications/broadcast', { title: 'RISK-N', body: 'x', delivery_count: 999 })).status, 201);
      assert.equal(Number(db.prepare("SELECT delivery_count v FROM multi_channel_notifications WHERE title = 'RISK-N'").get().v), 0);
    });
    await t.test('الخرائط المعمارية للموظفين فقط', async () => {
      const f = 'http://x/archify/architecture.html'.replace('http://x', base);
      assert.equal((await fetch(f)).status, 404);
      assert.equal((await fetch(f, { headers: { Cookie: await login('risk_st') } })).status, 404);
      assert.equal((await fetch(f, { headers: { Cookie: admin } })).status, 200);
    });
    await t.test('ملفات الواجهة ذات الإصدار تُخزَّن، وغيرها يُراجع', async () => {
      assert.match((await fetch(base + '/app.js?v=1')).headers.get('cache-control'), /max-age=86400/);
      assert.match((await fetch(base + '/app.js')).headers.get('cache-control'), /no-cache/);
    });
    await t.test('جملة عادية فيها select وfrom لا يرفضها جدار الحماية، والحقن يُرفض', async () => {
      const notif = (title) => call(admin, 'POST', '/api/enterprise/notifications/broadcast', { title, body: 'x' });
      assert.equal((await notif('Please select one course from the list')).status, 201);
      assert.equal((await notif("x' UNION SELECT password FROM users")).status, 403);
    });
    await t.test('فصل المهام يعمل من إعداد القاعدة', () => {
      const adminRow = { role: 'admin', role_key: null, access_mode: 'role', custom_permissions_json: '[]', revoked_permissions_json: '[]', module_access_json: '{}' };
      const before = effective(db, adminRow);
      const sens = [...SOD_SENSITIVE_PERMISSIONS][0];
      assert.ok(before.includes(sens));
      db.prepare("INSERT INTO site_settings (key, value) VALUES ('security.strict_admin_sod', '1') ON CONFLICT (key) DO UPDATE SET value = '1'").run();
      try { assert.ok(!effective(db, { ...adminRow, id: 987654 }).includes(sens)); }
      finally { db.prepare("DELETE FROM site_settings WHERE key = 'security.strict_admin_sod'").run(); }
    });
    await t.test('النسخة الاحتياطية تُجمع في خيط مستقل وتبقى صالحة ومشفرة', async () => {
      fs.writeFileSync(path.join(dir, 'marker.txt'), 'risk');
      const c = { ...cfg, backupPassphrase: 'risk-passphrase-1', backupDir: path.join(dir, 'backups') };
      const res = await createBackup({ db, cfg: c }, { reason: 'manual' });
      assert.equal(res.encrypted, true);
      assert.match(res.name, /\.enc$/);
      assert.ok(listBackups(c).some((b) => b.name === res.name));
      const zip = readZip(decrypt(fs.readFileSync(path.join(c.backupDir, res.name)), 'risk-passphrase-1'), { maxTotal: 1 << 30, maxEntries: 1000 });
      const manifest = JSON.parse(zip.get('manifest.json').toString());
      assert.equal(manifest.dbBytes, zip.get('database/database.dump').length);
      assert.equal(manifest.files, zip.size - 1);
      assert.ok(zip.has('signing-key.txt'));
    });
  } finally {
    await app.close();
  }

  async function seedPw() {
    // في قاعدة الذاكرة تُعاد كلمة مرور كل الحسابات إلى كلمة التشغيل، فنضبطها هنا لحساب المدير
    db.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(hash);
    return PW;
  }
});

test('مهلة الخمول تنهي الجلسة وتحذفها، والنشاط يجددها', () => {
  let deleted = 0;
  const db = { prepare: () => ({ run: () => { deleted++; } }) };
  const MIN = 60_000;
  assert.equal(idleExpired(db, 'idle-token', 1000), false);
  assert.equal(idleExpired(db, 'idle-token', 1000 + 100 * MIN), false, 'نشاط ضمن المهلة يجددها');
  assert.equal(idleExpired(db, 'idle-token', 1000 + 221 * MIN), true, 'تجاوز 120 دقيقة من آخر نشاط');
  assert.equal(deleted, 1);
});

test('موظف له سلفة لا يُحذف، فسجلاته أساس الرواتب', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-emp-'));
  const app = await createApp({ dbPath: ':memory:', uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), dataDir: dir, scryptN: 1024, port: 0, backupAuto: false });
  try {
    const cols = app.db.prepare("SELECT column_name c FROM information_schema.columns WHERE table_name = 'hr_employees' AND is_nullable = 'NO' AND column_default IS NULL AND column_name <> 'id'").all().map((r) => r.c);
    const id = Number(app.db.prepare(`INSERT INTO hr_employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => (/_at$|salary|amount/.test(c) ? 1 : `RISK-${c}`))).lastInsertRowid);
    const advCols = app.db.prepare("SELECT column_name c FROM information_schema.columns WHERE table_name = 'hr_advances' AND is_nullable = 'NO' AND column_default IS NULL AND column_name NOT IN ('id', 'employee_id')").all().map((r) => r.c);
    app.db.prepare(`INSERT INTO hr_advances (employee_id, ${advCols.join(', ')}) VALUES (?, ${advCols.map(() => '?').join(', ')})`).run(id, ...advCols.map((c) => (c === 'advance_code' ? 'RISK-A1' : /_at$|amount|installment|month/.test(c) ? 1 : 'x')));
    assert.throws(() => deleteEmployee(app.db, null, id, '::1'), (e) => e.status === 400);
    assert.ok(app.db.prepare('SELECT id FROM hr_employees WHERE id = ?').get(id));
  } finally { await app.close(); }
});
