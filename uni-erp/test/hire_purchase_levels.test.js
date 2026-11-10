import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ck[who] ? { Cookie: ck[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u, pw = PW) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) }); return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-hire-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, perms) => { id[u] = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?) RETURNING id").get(u, `مستخدم ${u}`, hash, role, Date.now(), perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  add('adm', 'admin');
  add('req', 'staff', ['procurement:request']);
  add('mgr', 'staff', ['procurement:manage', 'procurement:read']);
  add('fin', 'staff', ['procurement:approve_finance']);
  add('top', 'staff', ['procurement:approve_top']);
  await ensureStructure(app, { activate: true, password: PW });
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of Object.keys(id)) ck[u] = (await login(u)).cookie;
});
test.after(async () => { await app.close(); });

test('التعيين ينشئ حساباً بصلاحيات دنيا ويطلب البطاقة، وانتهاء الخدمة يغلقه', async () => {
  const r = await api('POST', '/api/hr-pro/employees', 'adm', { name: 'سامر الخطيب', employeeNo: 'EMP-T1', baseSalary: 500000, position: 'محاسب' });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  assert.equal(r.j.account.username, 'EMP-T1'); assert.ok(r.j.account.tempPassword);
  const u = app.db.prepare("SELECT * FROM users WHERE username = 'EMP-T1'").get();
  assert.equal(u.role, 'staff'); assert.equal(u.access_mode, 'custom'); assert.equal(Number(u.must_change_password), 1);
  assert.deepEqual(JSON.parse(u.custom_permissions_json).sort(), ['corr:use', 'request:create_internal', 'staffatt:self']);
  assert.equal(Number(app.db.prepare('SELECT user_id FROM hr_employees WHERE id = ?').get(r.j.id).user_id), Number(u.id));
  const docs = app.db.prepare("SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE o.code = 'of_docs' ORDER BY u.id LIMIT 1").get().id;
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE kind = 'staff_card_needed' AND user_id = ?").get(docs));
  const first = await login('EMP-T1', r.j.account.tempPassword);
  assert.equal(first.status, 200, 'يدخل بكلمة المرور المؤقتة');

  const ar = await api('POST', '/api/hr-pro/employees', 'adm', { name: 'ليلى', employeeNo: 'موظف٧', baseSalary: 0 });
  assert.equal(ar.j.account.username, `emp${ar.j.id}`, 'رمز غير لاتيني يُستبدل');

  const end = await api('PUT', `/api/hr-pro/employees/${r.j.id}`, 'adm', { statusAr: 'استقالة' });
  assert.equal(end.s, 200); assert.equal(end.j.accountClosed, true);
  assert.equal(Number(app.db.prepare('SELECT active FROM users WHERE id = ?').get(u.id).active), 0);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(u.id).n), 0);
  assert.equal((await login('EMP-T1', r.j.account.tempPassword)).status === 200, false, 'لا يدخل بعد انتهاء الخدمة');

  await api('PUT', '/api/admin/general', 'adm', { values: { 'hr.auto_account': false } });
  try { assert.equal((await api('POST', '/api/hr-pro/employees', 'adm', { name: 'دون حساب', employeeNo: 'EMP-T3' })).j.account, null); }
  finally { await api('PUT', '/api/admin/general', 'adm', { values: { 'hr.auto_account': true } }); }
});

const request = async (cost) => {
  const r = await api('POST', '/api/procurement/requests', 'req', { title: 'تجهيزات مخبر', submit: true, lines: [{ description: 'خوادم', qty: 2, estCost: cost }] });
  assert.ok(r.s < 300, JSON.stringify(r.j)); return r.j.request.id;
};
const stage = async (rid) => (await api('GET', `/api/procurement/requests/${rid}`, 'adm')).j.request;
const approve = (rid, who) => api('POST', `/api/procurement/requests/${rid}/approve`, who, { note: 'معتمد' });

test('اعتماد الشراء: مرحلة واحدة للصغير، والمالية فوق حدها، ويد مختلفة لكل مرحلة', async () => {
  const small = await request(1000);
  assert.deepEqual((await stage(small)).approval.required, ['إدارة المشتريات']);
  assert.equal((await approve(small, 'mgr')).j.request.status, 'approved');

  const mid = await request(1000000);
  assert.deepEqual((await stage(mid)).approval.required, ['إدارة المشتريات', 'الاعتماد المالي']);
  const early = await approve(mid, 'fin');
  assert.equal(early.s, 403); assert.match(early.j.message, /إدارة المشتريات/);
  assert.equal((await approve(mid, 'req')).s, 403);
  const one = await approve(mid, 'mgr');
  assert.equal(one.j.request.status, 'pending'); assert.equal(one.j.request.approval.next.label, 'الاعتماد المالي');
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE kind = 'proc_request_2' AND user_id = ?").get(id.fin), 'إشعار المرحلة التالية');
  assert.equal((await approve(mid, 'mgr')).s, 403);
  assert.equal((await approve(mid, 'fin')).j.request.status, 'approved');
});

test('الطلب الكبير يمر بثلاث مراحل، ولا يعتمد الشخص نفسه مرحلتين، والرفض في أي مرحلة', async () => {
  const big = await request(6000000);
  assert.equal((await stage(big)).approval.required.length, 3);
  assert.equal((await approve(big, 'adm')).s, 200);
  const twice = await approve(big, 'adm');
  assert.equal(twice.s, 403); assert.match(twice.j.message, /يدٌ مختلفة/);
  assert.equal((await approve(big, 'fin')).j.request.approval.next.label, 'رئاسة الجامعة');
  assert.equal((await api('POST', `/api/procurement/requests/${big}/reject`, 'top', { note: '' })).s, 400);
  assert.equal((await api('POST', `/api/procurement/requests/${big}/reject`, 'top', { note: 'يُعاد بعد مراجعة البدائل' })).j.request.status, 'rejected');

  await api('PUT', '/api/admin/general', 'adm', { values: { 'procurement.approval_finance_above': 0, 'procurement.approval_top_above': 0 } });
  try {
    const any = await request(9000000);
    assert.equal((await approve(any, 'mgr')).j.request.status, 'approved', 'الصفر يلغي المراحل الإضافية');
  } finally { await api('PUT', '/api/admin/general', 'adm', { values: { 'procurement.approval_finance_above': 1000000, 'procurement.approval_top_above': 10000000 } }); }
});
