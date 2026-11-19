// منح الصلاحيات من محرّر «الحسابات والصلاحيات» كما يرسلها فعلاً: كل المربعات المؤشَّرة (permissionsAreChecked)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, ck;
const api = async (m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
// ما يفعله المحرّر: يفتح الحساب ويؤشّر صلاحياته الفعّالة، ثم يرسلها كلها مع التعديل
const editLikeUi = async (id, change = {}, edit = (set) => set) => {
  const u = (await api('GET', `/api/admin/users/${id}/access`)).j.user;
  const checked = edit(new Set(u.effectivePermissions));
  return api('PUT', `/api/admin/users/${id}`, { displayName: u.displayName ?? u.name, accessMode: u.accessMode === 'role' ? 'hybrid' : u.accessMode, customPermissions: [...checked], revokedPermissions: u.revokedPermissions || [], allowedViews: u.explicitAllowedViews?.length ? u.explicitAllowedViews : u.allowedViews, permissionsAreChecked: true, ...change });
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-grants-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES ('boss', 'مدير النظام', ?, 'admin', ?, 0)").run(h, Date.now());
  app.limiter.hits.clear();
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: PW }) });
  ck = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('POST', '/api/admin/roles', { key: 'fin_clerk', label: 'موظف مالية', permissions: ['finance:read', 'finance:entry'] })).s, 201);
  assert.equal((await api('POST', '/api/admin/roles', { key: 'hr_clerk', label: 'موظف موارد', permissions: ['hr_emp:view'] })).s, 201);
});
test.after(async () => { await app.close(); });

const create = async (username, role, extra = {}) => {
  const r = await api('POST', '/api/admin/users', { username, displayName: `حساب ${username}`, role, password: PW, ...extra });
  assert.equal(r.s, 201, JSON.stringify(r.j)); return r.j.id;
};
const perms = async (id) => (await api('GET', `/api/admin/users/${id}/access`)).j.user;

test('نقل موظف إلى دور آخر من المحرّر لا يُبقي صلاحيات دوره السابق، والإضافة اليدوية تبقى', async () => {
  const id = await create('mover', 'fin_clerk');
  // إضافة يدوية فوق الدور، كما يؤشّرها المدير
  assert.equal((await editLikeUi(id, {}, (s) => s.add('procurement:read') && s)).s, 200);
  const row = app.db.prepare('SELECT custom_permissions_json c FROM users WHERE id = ?').get(id);
  assert.deepEqual(JSON.parse(row.c), ['procurement:read'], 'تُحفظ الإضافة فقط لا صلاحيات الدور');
  // تغيير الدور من المحرّر نفسه (المربعات ما زالت على الدور القديم)
  assert.equal((await editLikeUi(id, { role: 'hr_clerk' })).s, 200);
  const u = await perms(id);
  assert.ok(u.effectivePermissions.includes('hr_emp:view'), 'صلاحية الدور الجديد');
  assert.ok(!u.effectivePermissions.includes('finance:entry'), 'لا تبقى صلاحية الدور السابق');
  assert.ok(u.effectivePermissions.includes('procurement:read'), 'الإضافة اليدوية باقية');
});

test('سحب صلاحية من الدور يُحفظ سحباً، وإعادة تأشيرها تعيدها', async () => {
  const id = await create('revoker', 'fin_clerk');
  assert.equal((await editLikeUi(id, {}, (s) => { s.delete('finance:entry'); return s; })).s, 200);
  assert.ok(!(await perms(id)).effectivePermissions.includes('finance:entry'));
  assert.deepEqual(JSON.parse(app.db.prepare('SELECT revoked_permissions_json r FROM users WHERE id = ?').get(id).r), ['finance:entry']);
  assert.equal((await editLikeUi(id, {}, (s) => s.add('finance:entry') && s)).s, 200);
  assert.ok((await perms(id)).effectivePermissions.includes('finance:entry'));
});

test('منح صلاحية لشاشة جديدة يُظهر الشاشة رغم قائمة الشاشات المحفوظة', async () => {
  const id = await create('viewer', 'fin_clerk');
  assert.equal((await editLikeUi(id, { allowedViews: ['overview', 'finance'] })).s, 200);
  assert.ok(!(await perms(id)).allowedViews.includes('procurement'));
  assert.equal((await editLikeUi(id, {}, (s) => s.add('procurement:read') && s)).s, 200);
  assert.ok((await perms(id)).allowedViews.includes('procurement'), 'ظهرت شاشة المشتريات مع صلاحيتها');
});

test('حفظ حساب مدير نظام من المحرّر لا يجمّده على قائمة ثابتة', async () => {
  const id = await create('admin2', 'admin');
  assert.equal((await editLikeUi(id, { accessMode: 'role' })).s, 200);
  const row = app.db.prepare('SELECT custom_permissions_json c, revoked_permissions_json r FROM users WHERE id = ?').get(id);
  assert.deepEqual([JSON.parse(row.c), JSON.parse(row.r)], [[], []]);
});
