// صلاحيات كل قسم تناسب طبيعته، وطلب الشراء لا يكشف المخازن، ولا كلمة عبور خلفية في الدخول.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { computeAllowedViews } from '../server/permissions.js';
import { STRUCTURE } from '../server/services/structure.js';

const deptOf = (code) => STRUCTURE.find((n) => n.code === code);
const viewsOf = (code) => computeAllowedViews(deptOf(code).perms, [], 'staff');

test('كل قسم يرى ما يخصه ولا يرى شاشات غيره', () => {
  const rules = {
    procure: { has: ['procurement', 'corr', 'payroll'], not: ['finance', 'qa', 'alumni', 'ai', 'dashboard', 'academics'] },
    finance: { has: ['finance', 'procurement'], not: ['qa', 'alumni', 'ai', 'dashboard', 'academics', 'audit'] },
    hr: { has: ['payroll'], not: ['finance', 'qa', 'alumni', 'ai', 'academics'] },
    library: { has: ['lms'], not: ['finance', 'qa', 'alumni', 'ai', 'academics'] },
    exams: { has: ['academics', 'attendance', 'expansions', 'ai'], not: ['finance', 'alumni', 'qa'] },
    affairs: { has: ['affairs', 'academics', 'alumni', 'ai'], not: ['finance', 'qa'] },
    quality: { has: ['qa'], not: ['finance', 'alumni'] },
    alumni: { has: ['alumni'], not: ['finance', 'qa', 'ai'] },
  };
  for (const [code, { has, not }] of Object.entries(rules)) {
    const v = viewsOf(code);
    for (const k of has) assert.ok(v.includes(k), `${code} يحتاج ${k}`);
    for (const k of not) assert.ok(!v.includes(k), `${code} لا يخصه ${k}`);
  }
});

test('الاطلاع على المخازن للمشتريات والمالية فقط، وطلب الشراء لكل إدارة', () => {
  for (const n of STRUCTURE.filter((x) => x.kind === 'department')) {
    assert.equal(n.perms.includes('procurement:read'), ['procure', 'finance'].includes(n.code), n.code);
    if (n.code !== 'discipline') assert.ok(n.perms.includes('procurement:request'), n.code);
  }
  assert.ok(!deptOf('procure').perms.includes('finance:read'));
});

test('الاستيراد والتصدير لمن لديه بيانات يستوردها، وكل قسم يستورد بياناته', () => {
  assert.ok(!viewsOf('library').includes('exchange'), 'استيراد طلبات القسم يبقى في صفحة طلباته');
  assert.ok(viewsOf('procure').includes('exchange'));
  assert.ok(deptOf('affairs').perms.includes('import:groups'));
  assert.ok(deptOf('procure').perms.includes('import:procurement'));
  assert.ok(deptOf('finance').perms.includes('import:finance'));
  assert.ok(deptOf('hr').perms.includes('import:hr'));
});

test('طلب الشراء: مقدّمه يرى طلباته فقط ولا يرى الموردين، ولا كلمة عبور خلفية', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-fit-'));
  const app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  t.after(() => app.close());
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const PW = 'Str0ng-Test-Pass!', hash = await hashPassword(PW, 1024);
  const add = (u, perms) => app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, created_at) VALUES (?,?,?,'staff','custom',?,?)").run(u, u, hash, JSON.stringify(perms), Date.now());
  add('req_a', ['procurement:request']); add('req_b', ['procurement:request']); add('keeper', ['procurement:read', 'procurement:request']);
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
  const [a, b, keeper] = [await login('req_a'), await login('req_b'), await login('keeper')];
  const made = await call('POST', '/api/procurement/requests', { cookie: a, body: { title: 'طلب أقلام', lines: [{ description: 'أقلام', qty: 2 }] } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.id ?? made.json.request?.id;
  assert.equal((await call('GET', '/api/procurement/requests', { cookie: a })).json.requests.length, 1);
  assert.equal((await call('GET', '/api/procurement/requests', { cookie: b })).json.requests.length, 0, 'لا يرى طلب غيره');
  assert.equal((await call('GET', `/api/procurement/requests/${id}`, { cookie: b })).status, 404);
  assert.equal((await call('GET', '/api/procurement/requests', { cookie: keeper })).json.requests.length, 1);
  for (const u of ['/api/procurement/suppliers', '/api/procurement/orders', '/api/procurement/overview']) assert.equal((await call('GET', u, { cookie: a })).status, 403, u);
  assert.equal((await call('GET', '/api/procurement/items', { cookie: a })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'keeper', password: '__STUDIO_ROLE_SWITCH__' } })).status, 401);

  // عضو الهيئة يعتمد علامات مقرره فقط، بعد إرسالها من قسم الامتحانات
  const staffUser = (u, perms) => add(u, perms).lastInsertRowid;
  const fac1 = Number(staffUser('fac_one', ['grade:approve_own'])), fac2 = Number(staffUser('fac_two', ['grade:approve_own']));
  staffUser('exam_clerk', ['grade:manage']);
  const stuId = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('fit-stu', 'طالب', ?, 'student', 'FIT-1', ?)").run(hash, Date.now()).lastInsertRowid);
  const member = (name, uid) => Number(app.db.prepare("INSERT INTO faculty_members (name, rank, status, user_id, created_at) VALUES (?, 'مدرس', 'active', ?, ?)").run(name, uid, Date.now()).lastInsertRowid);
  const m1 = member('العضو الأول', fac1), m2 = member('العضو الثاني', fac2);
  const prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const courseOf = (name, mid) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, member_id) VALUES (?, 1, 1, ?, ?, ?)').run(prog, name, name, mid).lastInsertRowid);
  const c1 = courseOf('FIT-A', m1), c2 = courseOf('FIT-B', m2);
  const gradeIn = (cid, status) => Number(app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, workflow_status) VALUES (?, 'ف', 'مقرر', 3, 70, ?, ?)").run(stuId, cid, status).lastInsertRowid);
  const draft = gradeIn(c1, 'reviewed');
  const f1 = await login('fac_one'), f2 = await login('fac_two'), clerk = await login('exam_clerk');
  const flow = (cookie, ids, stage, justification) => call('POST', '/api/grades/workflow', { cookie, body: { gradeIds: ids, stage, justification } });
  assert.equal((await call('GET', '/api/faculty/my-grades', { cookie: f1 })).json.courses[0].rows.length, 1);
  assert.equal((await call('GET', '/api/faculty/my-grades', { cookie: f2 })).json.courses[0].rows.length, 0, 'لا يرى علامات غيره');
  assert.equal((await call('GET', '/api/faculty/my-grades', { cookie: clerk })).status, 403);
  assert.equal((await flow(f2, [draft], 'approved')).status, 403, 'مقرر غيره');
  assert.equal((await flow(f1, [draft], 'draft')).status, 400, 'الإعادة تحتاج سبباً');
  assert.equal((await flow(f1, [draft], 'draft', 'علامة العملي غير مطابقة')).json.updated, 1);
  assert.equal((await call('GET', '/api/faculty/my-grades', { cookie: f1 })).json.courses[0].rows.length, 0, 'المعادة لا تظهر له');
  assert.equal((await flow(f1, [draft], 'reviewed')).status, 403, 'لا يرسل بدل قسم الامتحانات');
  assert.equal((await flow(clerk, [draft], 'reviewed')).json.updated, 1);
  assert.equal((await flow(clerk, [draft], 'approved')).status, 403, 'قسم الامتحانات لا يعتمد بلا صلاحية');
  assert.equal((await flow(f1, [draft], 'approved')).json.updated, 1);
  assert.equal(app.db.prepare('SELECT workflow_status s FROM grades WHERE id = ?').get(draft).s, 'approved');
  assert.equal((await flow(f1, [draft], 'draft', 'إعادة فتح معتمدة')).status, 403, 'لا يعيد فتح المعتمدة');
});
