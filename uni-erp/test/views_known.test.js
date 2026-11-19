// قائمة الشاشات المخصصة تحجب ما كان موجوداً عند حفظها فقط، فالشاشات المضافة بعدها تظهر لمن يملك صلاحيتها.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { computeAllowedViews, staffViewKeys, editableViewList } from '../server/permissions.js';

const PW = 'Test#Pass12345';
// الشاشات الموجودة حتى 2026-11-05، وهي ختم القوائم المحفوظة قبل الترحيل 090
const BEFORE_NOV_10 = ['overview', 'guidelines', 'affairs', 'academics', 'attendance', 'expansions', 'student_life', 'labtools', 'lms', 'research', 'alumni', 'qa', 'payroll', 'corr', 'finance', 'procurement', 'dashboard', 'exchange', 'comms', 'ai', 'admin', 'access', 'audit'];
let app, base, adm;

async function call(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
const meViews = async (cookie) => (await call('GET', '/api/me', { cookie })).json.user.allowedViews;
const row = (username) => app.db.prepare('SELECT allowed_views_json, views_known_json FROM users WHERE username = ?').get(username);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-views-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('vadmin', 'مدير', ?, 'admin', ?)").run(await hashPassword(PW, 1024), Date.now());
  adm = await login('vadmin');
});
test.after(async () => { await app.close(); });

test('المنطق: الشاشة المضافة بعد الحفظ تظهر، والمحجوبة عمداً تبقى محجوبة، وبلا ختم يبقى السلوك القديم', () => {
  const perms = ['hr:manage', 'procurement:read', 'finance:read', 'stats:read'];
  const chosen = ['overview', 'finance'];
  const strict = computeAllowedViews(perms, chosen, 'staff');
  assert.ok(!strict.includes('recruitment') && !strict.includes('procurement'));
  const known = BEFORE_NOV_10;
  const views = computeAllowedViews(perms, chosen, 'staff', null, known);
  assert.ok(views.includes('recruitment') && views.includes('quotations'), 'الجديدة تظهر لصاحب الصلاحية');
  assert.ok(!views.includes('procurement') && !views.includes('dashboard'), 'ما كان موجوداً ولم يُختر يبقى محجوباً');
  assert.ok(views.includes('finance'));
  const noPerm = computeAllowedViews(['finance:read'], chosen, 'staff', null, known);
  assert.ok(!noPerm.includes('recruitment') && !noPerm.includes('quotations'), 'الختم لا يتجاوز الصلاحيات');
  assert.deepEqual(computeAllowedViews(perms, chosen, 'staff', null, staffViewKeys()), strict, 'قائمة حُفظت الآن تعمل كما كانت');
  assert.deepEqual(new Set(editableViewList(chosen, known)), new Set(['overview', 'finance', 'councils', 'facilities', 'hub', 'recruitment', 'quotations']));
  assert.deepEqual(editableViewList(chosen, null), chosen);
});

test('المدير بقائمة محفوظة قبل الشاشات الجديدة يراها بعد الترحيل', async () => {
  app.db.prepare("UPDATE users SET allowed_views_json = ?, views_known_json = ? WHERE username = 'vadmin'").run(JSON.stringify(BEFORE_NOV_10), JSON.stringify(BEFORE_NOV_10));
  const views = await meViews(adm);
  for (const v of ['recruitment', 'councils', 'facilities']) assert.ok(views.includes(v), v);
  app.db.prepare("UPDATE users SET views_known_json = NULL WHERE username = 'vadmin'").run();
  assert.equal((await meViews(adm)).includes('recruitment'), false, 'بلا ختم: السلوك القديم');
  app.db.prepare("UPDATE users SET allowed_views_json = '[]' WHERE username = 'vadmin'").run();
});

test('الحفظ من إدارة الحسابات يختم القائمة، وإعادة الحفظ لا تحجب ما أُضيف بعدها', async () => {
  const created = await call('POST', '/api/admin/users', { cookie: adm, body: { username: 'vstaff', name: 'موظف تجريبي', role: 'staff', password: 'Str0ng-Pass#2026', accessMode: 'custom', customPermissions: ['hr:manage', 'procurement:read', 'stats:read'], allowedViews: ['overview', 'payroll'] } });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.json));
  assert.deepEqual(JSON.parse(row('vstaff').views_known_json), staffViewKeys());
  const id = app.db.prepare("SELECT id FROM users WHERE username = 'vstaff'").get().id;
  // كأن القائمة حُفظت قبل إضافة التوظيف وعروض الأسعار
  app.db.prepare('UPDATE users SET views_known_json = ? WHERE id = ?').run(JSON.stringify(BEFORE_NOV_10), id);
  const before = (await call('GET', `/api/admin/users/${id}/access`, { cookie: adm })).json;
  const detail = before.user ?? before;
  assert.ok(detail.explicitAllowedViews.includes('recruitment'), 'المحرّر يعرض الجديدة مختارة');
  assert.ok(detail.allowedViews.includes('recruitment') && detail.allowedViews.includes('quotations'));
  assert.ok(!detail.allowedViews.includes('dashboard'), 'المحجوب عمداً يبقى محجوباً');
  // المحرّر يعيد إرسال ما عرضه، فتبقى الجديدة ظاهرة بعد الختم الجديد
  const saved = await call('PUT', `/api/admin/users/${id}`, { cookie: adm, body: { name: 'موظف معدّل', allowedViews: detail.explicitAllowedViews } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const after = (await call('GET', `/api/admin/users/${id}/access`, { cookie: adm })).json;
  assert.ok((after.user ?? after).allowedViews.includes('recruitment'));
  assert.deepEqual(JSON.parse(row('vstaff').views_known_json), staffViewKeys());
  const nameOnly = await call('PUT', `/api/admin/users/${id}`, { cookie: adm, body: { name: 'اسم فقط' } });
  assert.equal(nameOnly.status, 200);
  assert.deepEqual(JSON.parse(row('vstaff').views_known_json), staffViewKeys(), 'تعديل لا يمس القائمة يبقي ختمها');
});
