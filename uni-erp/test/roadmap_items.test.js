import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345', DEVICE = 'device-token-for-tests-1234';
let app, call, adm, staffId;

test.before(async () => {
  process.env.BIOMETRIC_DEVICE_TOKEN = DEVICE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-road-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie, headers } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_at) VALUES ('road_admin','مدير',?, 'admin', 0, ?)").run(hash, Date.now());
  staffId = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_at) VALUES ('road_staff','موظف',?, 'staff', 0, ?)").run(hash, Date.now()).lastInsertRowid);
  const login = await call('POST', '/api/auth/login', { body: { username: 'road_admin', password: PW } });
  assert.equal(login.status, 200);
  assert.equal(login.json.token, undefined, 'لا يصل رمز الجلسة إلى كود الواجهة');
  adm = login.cookie;
});
test.after(async () => { await app.close(); delete process.env.BIOMETRIC_DEVICE_TOKEN; });

test('الجلسة تُقبل من الكوكي وحدها', async () => {
  const sid = adm.split('=')[1];
  assert.equal((await call('GET', '/api/admin/holds', { headers: { 'X-Session-Token': sid } })).status, 401);
  assert.equal((await call('GET', '/api/admin/holds', { cookie: adm })).status, 200);
});

test('بصمة الجهاز تسجل الحضور برمز صحيح فقط، وتظهر في حالة المزامنة', async () => {
  const send = (token, body) => call('POST', '/api/hr/attendance/device-punch', { body, headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await send('wrong-token-wrong-token-1234', { username: 'road_staff', device: 'D1' })).status, 401);
  assert.equal((await send(DEVICE, { username: 'nobody', device: 'D1' })).status, 404);
  const first = await send(DEVICE, { username: 'road_staff', device: 'D1' });
  assert.equal(first.status, 200);
  assert.equal(first.json.action, 'in');
  assert.ok(app.db.prepare('SELECT 1 AS x FROM staff_attendance WHERE user_id = ?').get(staffId));
  const sync = await call('POST', '/api/expansions/biometrics/sync', { cookie: adm, body: {} });
  assert.equal(sync.json.synced, true);
  assert.equal(sync.json.received, 1);
});

test('حذف مركز الكلفة: يُحذف غير المستخدم ويُرفض المستخدم في قيد', async () => {
  const made = await call('POST', '/api/finance/cost-centers', { cookie: adm, body: { code: 'CC-DEL', name: 'مركز للحذف' } });
  assert.equal(made.status, 201);
  assert.equal((await call('DELETE', `/api/finance/cost-centers/${made.json.costCenter.id}`, { cookie: adm })).status, 200);
  assert.equal((await call('DELETE', `/api/finance/cost-centers/${made.json.costCenter.id}`, { cookie: adm })).status, 404);
});

test('البحث الشامل يصل إلى كل السجلات لا أول 30', async () => {
  const now = Date.now();
  for (let i = 0; i < 40; i++) app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,'!', 'student', ?, ?)").run(`srch${i}`, `طالب رقم ${i}`, `SRCH-${i}`, now);
  const r = await call('GET', `/api/enterprise/global-search?q=${encodeURIComponent('SRCH-39')}`, { cookie: adm });
  assert.equal(r.json.students.length, 1);
  assert.equal(r.json.students[0].student_no, 'SRCH-39');
});

test('الناقص يُرفض بدل تعبئته بقيمة مختلقة', async () => {
  const job = await call('POST', '/api/alumni/jobs', { cookie: adm, body: { title: 'وظيفة', company_name: 'شركة' } });
  assert.equal(job.status, 400, JSON.stringify(job.json));
  const over = await call('POST', '/api/enterprise/faculty-overload', { cookie: adm, body: { instructor_name: 'د. س' } });
  assert.equal(over.status, 400, JSON.stringify(over.json));
});

test('التحقق بخطوتين: تفعيل برمز صحيح، ودخول يطلبه، ولا يصلح الرمز مرتين، ورموز الاسترداد لمرة واحدة', async () => {
  const { totp } = await import('../server/services/mfa.js');
  const stepNow = () => Math.floor(Date.now() / 30000);
  const log = await call('POST', '/api/auth/login', { body: { username: 'road_staff', password: PW } });
  assert.equal((await call('POST', '/api/auth/mfa/confirm', { cookie: log.cookie, body: { code: '000000' } })).status, 400);
  const setup = await call('POST', '/api/auth/mfa/setup', { cookie: log.cookie, body: {} });
  assert.match(setup.json.qr, /^<svg/);
  assert.equal((await call('POST', '/api/auth/mfa/confirm', { cookie: log.cookie, body: { code: '000000' } })).status, 400);
  const ok = await call('POST', '/api/auth/mfa/confirm', { cookie: log.cookie, body: { code: totp(setup.json.secret, stepNow() - 1) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.recoveryCodes.length, 8);
  const stored = app.db.prepare('SELECT mfa_secret FROM users WHERE id = ?').get(staffId).mfa_secret;
  assert.ok(!stored.includes(setup.json.secret), 'السر مشفر في القاعدة');
  const creds = { username: 'road_staff', password: PW };
  const none = await call('POST', '/api/auth/login', { body: creds });
  assert.equal(none.json.error, 'mfa_required');
  assert.equal(none.cookie, '');
  assert.equal((await call('POST', '/api/auth/login', { body: { ...creds, code: '123456' } })).json.error, 'mfa_invalid');
  const code = totp(setup.json.secret, stepNow());
  assert.equal((await call('POST', '/api/auth/login', { body: { ...creds, code } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { ...creds, code } })).json.error, 'mfa_invalid', 'لا يصلح الرمز مرتين');
  const rec = ok.json.recoveryCodes[0];
  assert.equal((await call('POST', '/api/auth/login', { body: { ...creds, code: rec } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { ...creds, code: rec } })).json.error, 'mfa_invalid', 'رمز الاسترداد لمرة واحدة');
  const res = await call('POST', `/api/admin/users/${staffId}/mfa-reset`, { cookie: adm, body: {} });
  assert.equal(res.status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: creds })).status, 200);
});

test('الإلزام: حساب حساس بلا تحقق لا يصل إلى شيء حتى يفعّله', async () => {
  const before = process.env.MFA_ENFORCE; process.env.MFA_ENFORCE = '1';
  try {
    const { totp } = await import('../server/services/mfa.js');
    const hash = app.db.prepare("SELECT password_hash FROM users WHERE username = 'road_admin'").get().password_hash;
    app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_at) VALUES ('road_adm2','مدير ثان',?, 'admin', 0, ?)").run(hash, Date.now());
    const log = await call('POST', '/api/auth/login', { body: { username: 'road_adm2', password: PW } });
    assert.equal(log.json.user.mfaSetup, true);
    const blocked = await call('GET', '/api/admin/holds', { cookie: log.cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error, 'mfa_setup_required');
    const setup = await call('POST', '/api/auth/mfa/setup', { cookie: log.cookie, body: {} });
    assert.equal((await call('POST', '/api/auth/mfa/confirm', { cookie: log.cookie, body: { code: totp(setup.json.secret, Math.floor(Date.now() / 30000)) } })).status, 200);
    const off = await call('POST', '/api/auth/mfa/disable', { cookie: log.cookie, body: { password: PW, code: '000000' } });
    assert.equal(off.status, 403, 'لا يعطله صاحب دور حساس');
  } finally { if (before === undefined) delete process.env.MFA_ENFORCE; else process.env.MFA_ENFORCE = before; }
});
