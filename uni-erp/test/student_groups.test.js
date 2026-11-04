// فئات الطلاب: الإنشاء والتعديل والأعضاء والتوزيع، والصلاحيات، والربط بالامتحانات وجلسات القاعات، والاستيراد.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { IMPORT_DEFS } from '../server/services/import_defs.js';

const PW = 'Str0ng-Test-Pass!';
let app, call, adm, viewer, ids = [], cookies = {};
const form = (i) => ({ first_name: 'طالب' + 'ابجدهوزحطي'[i], father_name: 'أحمد', last_name: 'العلي', mother_name: 'سعاد الخطيب', national_id: String(20000000000 + i), gender: 'أنثى', birth_date: '2006-03-14', birth_place: 'دمشق', nationality: 'سورية', phone: `09${44000000 + i}`, governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء', hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)', enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد', guardian_relation: 'الأب', guardian_phone: '0933111222' });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-sg-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const hash = await hashPassword(PW, 1024);
  const add = (u, role) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, hash, role, Date.now());
  add('adm', 'admin'); add('viewer', 'auditor');
  const login = async (username, password = PW) => (await call('POST', '/api/auth/login', { body: { username, password } })).cookie;
  adm = await login('adm'); viewer = await login('viewer');
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/students', { cookie: adm, body: form(i) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    ids.push(r.json.student.id);
    app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, r.json.student.id);
    cookies[r.json.student.id] = await login(r.json.student.studentNo);
  }
});
test.after(async () => { if (app) await app.close(); });

test('إنشاء فئة من طلاب موجودين، وتعديل اسمها وأعضائها', async () => {
  const made = await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'مختبر الشبكات', kind: 'lab', studentIds: ids.slice(0, 2) } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.group.id;
  assert.equal(made.json.group.count, 2);
  assert.equal(made.json.group.kindLabel, 'مختبرات');
  assert.equal((await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'مختبر الشبكات' } })).status, 409, 'لا اسمان متطابقان');
  assert.equal((await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'x' } })).status, 400);
  assert.equal((await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'نوع خطأ', kind: 'zzz' } })).status, 400);
  const renamed = await call('PUT', `/api/student-groups/${id}`, { cookie: adm, body: { name: 'مختبر الشبكات أ' } });
  assert.equal(renamed.json.group.name, 'مختبر الشبكات أ');
  assert.equal(renamed.json.group.kind, 'lab', 'النوع لا يتغير دون طلب');
  const changed = await call('PUT', `/api/student-groups/${id}/members`, { cookie: adm, body: { add: [ids[2], ids[2]], remove: [ids[0]] } });
  assert.deepEqual(changed.json.members.map((m) => m.id).sort(), [ids[1], ids[2]].sort());
  assert.equal((await call('PUT', `/api/student-groups/${id}/members`, { cookie: adm, body: { add: [999999] } })).status, 400, 'طالب غير موجود');
  const stuName = changed.json.members[0].name;
  assert.match(stuName, /طالب/);
});

test('التوزيع على فئات متساوية بالترتيب، ويُرفض إن تعارض اسم', async () => {
  const r = await call('POST', '/api/student-groups/split', { cookie: adm, body: { baseName: 'محاضرة', kind: 'lecture', size: 2, studentIds: ids } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.groups.map((g) => [g.name, g.count]), [['محاضرة 1', 2], ['محاضرة 2', 2], ['محاضرة 3', 1]]);
  assert.equal((await call('POST', '/api/student-groups/split', { cookie: adm, body: { baseName: 'محاضرة', size: 2, studentIds: ids } })).status, 409);
  assert.equal((await call('POST', '/api/student-groups/split', { cookie: adm, body: { baseName: 'بلا طلاب', size: 2, studentIds: [] } })).status, 400);
});

test('الصلاحيات: الاطلاع لا يعني التعديل، والطالب يرى فئاته فقط', async () => {
  assert.equal((await call('GET', '/api/student-groups', { cookie: viewer })).status, 200);
  assert.equal((await call('POST', '/api/student-groups', { cookie: viewer, body: { name: 'ممنوعة' } })).status, 403);
  assert.equal((await call('GET', '/api/student-groups')).status, 401);
  const stu = cookies[ids[4]];
  assert.equal((await call('GET', '/api/student-groups', { cookie: stu })).status, 403);
  assert.deepEqual((await call('GET', '/api/me/groups', { cookie: stu })).json.groups.map((g) => g.name), ['محاضرة 3']);
});

test('الامتحان المربوط بفئة: العدد من أعضائها، والطالب يرى امتحان فئته فقط، وحذف الفئة لا يحذفه', async () => {
  const g = (await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'فئة امتحان', kind: 'exam', studentIds: ids.slice(0, 3) } })).json.group;
  const ex = await call('POST', '/api/expansions/exams', { cookie: adm, body: { course_code: 'NET-1', course_name: 'شبكات', program_name: 'س', exam_date: '2026-12-01', hall_name: 'A1', capacity: 2, group_id: g.id } });
  assert.equal(ex.status, 201, JSON.stringify(ex.json));
  assert.match(ex.json.capacityWarning, /يتجاوز/);
  assert.equal((await call('POST', '/api/expansions/exams', { cookie: adm, body: { course_code: 'NET-1', course_name: 'شبكات', program_name: 'س', group_id: 999999 } })).status, 400);
  const row = (await call('GET', '/api/expansions/overview', { cookie: adm })).json.exams.find((x) => x.id === ex.json.id);
  assert.equal(row.group_name, 'فئة امتحان');
  assert.equal(row.enrolled_count, 3);
  const sees = async (sid) => (await call('GET', '/api/expansions/overview', { cookie: cookies[sid] })).json.exams.some((x) => x.id === ex.json.id);
  assert.equal(await sees(ids[0]), true);
  assert.equal(await sees(ids[4]), false, 'طالب خارج الفئة');
  assert.equal((await call('DELETE', `/api/student-groups/${g.id}`, { cookie: adm })).status, 200);
  const after = (await call('GET', '/api/expansions/overview', { cookie: adm })).json.exams.find((x) => x.id === ex.json.id);
  assert.equal(after.group_id, null);
});

test('جلسة القاعة: تنبيه إذا دخل طالب من خارج الفئة', async () => {
  const g = (await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'فئة قاعة', studentIds: [ids[0]] } })).json.group;
  const no = (id) => app.db.prepare('SELECT student_no FROM users WHERE id = ?').get(id).student_no;
  const scan = async (id) => (await call('POST', '/api/attendance/scan', { cookie: adm, body: { code: no(id), kind: 'exam', subject: 'جلسة', hall: 'A1', groupId: g.id, action: 'in' } }));
  const inside = await scan(ids[0]);
  assert.equal(inside.status, 200, JSON.stringify(inside.json));
  assert.ok(!inside.json.warnings.some((w) => /الفئة/.test(w)));
  const outside = await scan(ids[1]);
  assert.ok(outside.json.warnings.some((w) => /الفئة/.test(w)));
});

test('الاستيراد: نوعان في محرك الاستيراد، الفئات ثم أعضاؤها', () => {
  const kinds = Object.keys(IMPORT_DEFS);
  assert.ok(kinds.includes('student_groups') && kinds.includes('student_group_members'));
  assert.ok(kinds.indexOf('student_groups') < kinds.indexOf('student_group_members'));
});

test('حذف الطالب يخرجه من فئاته', async () => {
  const sid = ids[4];
  assert.equal((await call('DELETE', `/api/students/${sid}`, { cookie: adm })).status, 200);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM student_group_members WHERE student_id = ?').get(sid).c), 0);
});
