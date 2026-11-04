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
});
