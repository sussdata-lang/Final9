// نافذة «المعلومات الشخصية الرئيسية»: البيانات والمرفقات والبنود الاختيارية و«تم التدقيق» وسجل التعديلات والصلاحيات.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { devSwitchEnabled, isLocalRequest } from '../server/services/dev_accounts.js';

const PW = 'Str0ng-Test-Pass!';
let app, call, adm, editor, reader, sid;
const form = { first_name: 'سارة', father_name: 'أحمد', last_name: 'العلي', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14', birth_place: 'دمشق', nationality: 'سورية', phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء', hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)', enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد', guardian_relation: 'الأب', guardian_phone: '0933111222' };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sf-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, perms = null) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, created_at) VALUES (?,?,?,?,?,?)').run(u, `حساب ${u}`, hash, role, perms ? JSON.stringify(perms) : null, Date.now());
  add('adm', 'admin'); add('editor', 'staff', ['student:read', 'student:update']); add('reader', 'auditor');
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
  adm = await login('adm'); editor = await login('editor'); reader = await login('reader');
  const r = await call('POST', '/api/students', { cookie: adm, body: form });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  sid = r.json.student.id;
});
test.after(async () => { if (app) await app.close(); });

test('النافذة تعرض كل البيانات بعناوينها، والمرفقات حسب النوع، ولا بنود بعد', async () => {
  const { status, json } = await call('GET', `/api/students/${sid}/main-info`, { cookie: reader });
  assert.equal(status, 200);
  const flat = json.groups.flatMap((g) => g.fields);
  assert.equal(flat.find((f) => f.label === 'الاسم الأول').value, 'سارة');
  assert.ok(json.groups.length >= 3);
  assert.deepEqual(json.attachments, []);
  assert.equal(json.meta.audited, false);
  assert.equal(json.meta.box, '');
  assert.equal(json.last, null, 'التسجيل ليس تعديلاً');
  assert.equal(json.canEdit, false);
  assert.match(String(flat.find((f) => /البرنامج/.test(f.label))?.value), /\D/, 'البرنامج باسمه لا برقمه');
});

test('البنود كلها اختيارية، و«تم التدقيق» يسجل من دقّق ومتى، وإلغاؤه يمسحهما', async () => {
  const empty = await call('PUT', `/api/students/${sid}/main-info`, { cookie: editor, body: {} });
  assert.equal(empty.status, 200, 'لا شيء إلزامي');
  const saved = await call('PUT', `/api/students/${sid}/main-info`, { cookie: editor, body: { generalNotes: 'ملاحظة', box: 'صندوق 7', dossier: 'إضبارة 12', certNotes: 'الشهادة أصلية', exception: '', audited: true } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.meta.box, 'صندوق 7');
  assert.equal(saved.json.meta.audited, true);
  assert.equal(saved.json.meta.auditedBy, 'حساب editor');
  assert.ok(saved.json.meta.auditedAt > 0);
  const again = await call('PUT', `/api/students/${sid}/main-info`, { cookie: adm, body: { generalNotes: 'ملاحظة أخرى', audited: true } });
  assert.equal(again.json.meta.auditedBy, 'حساب editor', 'المدقق الأول يبقى ما دام مدقَّقاً');
  assert.equal(again.json.meta.box, 'صندوق 7', 'البند غير المرسل لا يُمسح');
  const off = await call('PUT', `/api/students/${sid}/main-info`, { cookie: adm, body: { audited: false } });
  assert.equal(off.json.meta.audited, false);
  assert.equal(off.json.meta.auditedBy, null);
  assert.equal((await call('PUT', `/api/students/${sid}/main-info`, { cookie: adm, body: { generalNotes: 'x'.repeat(2001) } })).status, 400);
});

test('الصلاحيات: القراءة لمن يملك عرض الطلاب، والحفظ لمن يملك التعديل، والمجهول مرفوض', async () => {
  assert.equal((await call('PUT', `/api/students/${sid}/main-info`, { cookie: reader, body: { box: 'x' } })).status, 403);
  assert.equal((await call('GET', `/api/students/${sid}/main-info`)).status, 401);
  assert.equal((await call('GET', '/api/students/999999/main-info', { cookie: adm })).status, 404);
});

test('التعديلات السابقة: آخر حساب عدّل، وأسماء الحقول لا قيمها، وعرض الملف لا يُحسب تعديلاً', async () => {
  await call('PUT', `/api/students/${sid}`, { cookie: editor, body: { ...form, city: 'كفرسوسة' } });
  const { json } = await call('GET', `/api/students/${sid}/main-info`, { cookie: adm });
  assert.equal(json.last.username, 'editor');
  assert.equal(json.last.actor, 'حساب editor');
  assert.match(json.last.action, /تعديل ملف طالب/);
  assert.ok(!json.last.action.includes('كفرسوسة'), 'القيمة لا تظهر في السجل');
  assert.ok(json.history.every((h) => h.action !== 'عرض ملف طالب'));
  assert.ok(json.history.some((h) => h.action === 'تسجيل طالب جديد'));
  const notes = json.history.find((h) => h.action.startsWith('تعديل البنود الإضافية'));
  assert.ok(notes && !notes.action.includes('صندوق 7'), 'محتوى البنود لا يدخل السجل');
});

test('شعار التدقيق يصل إلى جدول الطلاب', async () => {
  await call('PUT', `/api/students/${sid}/main-info`, { cookie: adm, body: { audited: true } });
  const { json } = await call('GET', '/api/students-table', { cookie: adm });
  assert.equal(json.rows.find((r) => r.id === sid).audited, true);
});

test('تبديل الحساب محلي فقط: لا مسار في غير وضع العرض على عنوان محلي', async () => {
  assert.equal((await call('GET', '/api/local-accounts')).status, 404);
  assert.equal((await call('POST', '/api/local-switch', { body: { key: 'admin' } })).status, 404);
  assert.equal(devSwitchEnabled('127.0.0.1', { DEMO_MODE: '1' }), true);
  assert.equal(devSwitchEnabled('0.0.0.0', { DEMO_MODE: '1' }), false, 'الخادم المفتوح للشبكة');
  assert.equal(devSwitchEnabled('127.0.0.1', {}), false, 'بلا وضع العرض');
  assert.equal(isLocalRequest('127.0.0.1', '127.0.0.1:3100'), true);
  assert.equal(isLocalRequest('10.0.0.5', '127.0.0.1:3100'), false);
  assert.equal(isLocalRequest('127.0.0.1', 'example.com'), false);
});

test('حذف الطالب يحذف بنوده', async () => {
  const r = await call('DELETE', `/api/students/${sid}`, { cookie: adm });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM student_file_meta WHERE student_id = ?').get(sid).c, 0);
});
