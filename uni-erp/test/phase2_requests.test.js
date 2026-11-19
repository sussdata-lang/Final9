// المرحلة الثانية: تصدير الصفوف المحددة إلى Excel، والقيمة الافتراضية المخصصة للإعدادات، وإحالة الطلب إلى موظف بعينه
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { readXlsx } from '../server/lib/xlsx.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const call = async (m, u, who, body, raw = false) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: ck[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const unit = (name) => Number(app.db.prepare('SELECT id FROM org_units WHERE name = ?').get(name).id);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph2-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024), now = Date.now();
  const add = (u, role, unitId = null, perms = null, no = null) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, unit_id, student_no, access_mode, custom_permissions_json, created_at, must_change_password) VALUES (?,?,?,?,?,?,?,?,?,0) RETURNING id').get(u, `الموظف ${u}`, h, role, unitId, no, perms ? 'custom' : 'role', JSON.stringify(perms ?? []), now).id); };
  add('adm', 'admin');
  add('fwd', 'staff', unit('الشؤون الإدارية'), ['request:read_unit', 'request:forward']);
  add('emp', 'staff', unit('القسم اللوجستي'), ['request:read_unit', 'request:decide']);
  add('nop', 'staff', unit('القسم اللوجستي'), []);
  add('stu', 'student', null, null, 'PH2-0001');
  for (const u of Object.keys(id)) { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); ck[u] = r.headers.get('set-cookie').split(';')[0]; }
  // وحدة بلا روابط بوحدة المحيل
  const far = await call('POST', '/api/admin/units', 'adm', { name: 'وحدة بعيدة للاختبار', kind: 'department' });
  assert.equal(far.s, 201, JSON.stringify(far.j));
  add('far', 'staff', far.j.id, ['request:read_unit', 'request:decide']);
  app.limiter.hits.clear(); ck.far = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'far', password: PW }) })).headers.get('set-cookie').split(';')[0];
});
test.after(async () => { await app.close(); });

test('تصدير الصفوف المحددة: ملف Excel حقيقي بالعناوين والصفوف، والأرقام أرقام إلا ما يبدأ بصفر', async () => {
  assert.equal((await call('POST', '/api/export/selection.xlsx', null, { head: ['أ'], rows: [['1']] }, true)).s, 401);
  assert.equal((await call('POST', '/api/export/selection.xlsx', 'fwd', { head: ['أ'], rows: [] })).s, 400);
  const r = await call('POST', '/api/export/selection.xlsx', 'fwd', { title: 'سجل الطلاب (12)', head: ['الرقم الجامعي', 'الاسم', 'الهاتف', 'المعدل'], rows: [['CYB-2026-0001', 'طارق', '0944112233', '87.5'], ['CYB-2026-0002', 'ليلى', '0933000000', '70']] }, true);
  assert.equal(r.s, 200); assert.match(r.type, /spreadsheetml/);
  const sh = readXlsx(r.buf).sheets[0];
  assert.deepEqual(sh.rows[0], ['الرقم الجامعي', 'الاسم', 'الهاتف', 'المعدل']);
  assert.deepEqual(sh.rows[1], ['CYB-2026-0001', 'طارق', '0944112233', '87.5']);
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'تصدير صفوف محددة إلى Excel'").get());
});

test('جعل القيمة افتراضية: تعود إليها «إعادة إلى الافتراضي»، وتُستعاد قيمة المصنع، وللأرقام والنصوص فقط', async () => {
  const K = 'academic.max_absence_percent', item = async () => (await call('GET', '/api/admin/general', 'adm')).j.tabs.flatMap((t) => t.items).find((i) => i.key === K);
  assert.equal((await call('POST', '/api/admin/general/make-default', 'fwd', { values: { [K]: 20 } })).s, 403);
  assert.equal((await call('POST', '/api/admin/general/make-default', 'adm', { values: { [K]: 500 } })).s, 400, 'ضمن حدود الإعداد');
  assert.equal((await call('POST', '/api/admin/general/make-default', 'adm', { values: { 'academic.course_roster': 'program' } })).s, 400, 'ليس للقوائم');
  assert.equal((await call('POST', '/api/admin/general/make-default', 'adm', { values: { [K]: 20 } })).s, 200);
  let it = await item();
  assert.deepEqual([it.value, it.default, it.factoryDefault, it.customDefault, it.changed], [20, 20, 15, true, false]);
  await call('PUT', '/api/admin/general', 'adm', { values: { [K]: 25 } });
  assert.equal((await item()).changed, true);
  await call('POST', '/api/admin/general/reset', 'adm', { keys: [K] });
  assert.equal((await item()).value, 20, 'الإعادة إلى الافتراضي المخصص لا إلى المصنع');
  assert.equal((await call('POST', '/api/admin/general/factory-default', 'adm', { keys: [K] })).s, 200);
  it = await item();
  assert.deepEqual([it.value, it.default, it.customDefault], [20, 15, false], 'القيمة الحالية لا تتغير بصمت');
  await call('POST', '/api/admin/general/reset', 'adm', { keys: [K] });
  assert.equal((await item()).value, 15);
});

test('إحالة الطلب إلى موظف بالاسم: من وحدة مرتبطة ويملك صلاحية الطلبات، فيراه ويُبلَّغ، والإحالة لوحدة تلغيها', async () => {
  const req = (await call('POST', '/api/requests', 'stu', { service: 'transcript', details: { lang: 'العربية', copies: 1 } })).j.request;
  assert.equal((await call('POST', `/api/requests/${req.id}/forward`, 'adm', { unitId: unit('الشؤون الإدارية') })).s, 200);
  const people = (await call('GET', '/api/requests/forward-people', 'fwd')).j.people;
  assert.ok(people.some((p) => p.id === id.emp), 'موظف وحدة مرتبطة يملك صلاحية الطلبات');
  assert.ok(!people.some((p) => p.id === id.nop), 'بلا صلاحية الطلبات');
  assert.ok(!people.some((p) => p.id === id.far), 'وحدة غير مرتبطة');
  assert.equal((await call('POST', `/api/requests/${req.id}/forward`, 'fwd', { userId: id.far })).s, 403);
  assert.equal((await call('POST', `/api/requests/${req.id}/forward`, 'fwd', { userId: 99999 })).s, 400);
  assert.equal((await call('GET', '/api/requests', 'emp')).j.requests.length, 0, 'قبل الإحالة لا يراه');
  const fw = await call('POST', `/api/requests/${req.id}/forward`, 'fwd', { userId: id.emp, note: 'للمعالجة' });
  assert.equal(fw.s, 200, JSON.stringify(fw.j));
  assert.equal(fw.j.request.assignee.id, id.emp); assert.equal(fw.j.request.unit.name, 'القسم اللوجستي');
  assert.match(fw.j.request.events.at(-1).text, /إحالة الطلب إلى الموظف «الموظف emp» \(القسم اللوجستي\): للمعالجة/);
  assert.equal((await call('GET', '/api/requests', 'emp')).j.requests.length, 1, 'يراه بعد الإحالة');
  assert.equal((await call('GET', `/api/requests/${req.id}`, 'emp')).s, 200);
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE user_id = ? AND kind = 'request_assigned' AND ref_id = ?").get(id.emp, req.id));
  assert.equal((await call('POST', `/api/requests/${req.id}/forward`, 'adm', { userId: id.emp })).s, 409, 'محال إليه أصلاً');
  const back = await call('POST', `/api/requests/${req.id}/forward`, 'adm', { unitId: unit('الشؤون الإدارية') });
  assert.equal(back.s, 200); assert.equal(back.j.request.assignee, null, 'الإحالة لوحدة تلغي التكليف الشخصي');
});
