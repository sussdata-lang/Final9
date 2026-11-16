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

test('مواعيد الفئة: موعد المختبر يضاف ويعدّل ويحذف دون المساس بفئة أخرى، وموعد الامتحان يظهر في الفئة', async () => {
  const mk = async (name) => (await call('POST', '/api/student-groups', { cookie: adm, body: { name, kind: 'lab', studentIds: [ids[0]] } })).json.group;
  const a = await mk('مختبر مواعيد 1'), b = await mk('مختبر مواعيد 2');
  const cid = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) SELECT id, 1, 1, 'شبكات عملي', 'NET-LAB', 2 FROM programs ORDER BY id LIMIT 1").run().lastInsertRowid);
  const put = (g, body) => call('PUT', `/api/student-groups/${g.id}/labs`, { cookie: adm, body: { courseId: cid, ...body } });
  assert.equal((await put(a, { day: 1, start: '10:00', end: '11:30', hall: 'مختبر 2' })).status, 200);
  assert.equal((await put(b, { day: 2, start: '10:00', end: '11:30', hall: 'مختبر 2' })).status, 200);
  let sa = (await call('GET', `/api/student-groups/${a.id}/schedule`, { cookie: adm })).json;
  assert.equal(sa.labs.length, 1); assert.equal(sa.labs[0].courseName, 'شبكات عملي'); assert.ok(sa.canLab && sa.canExam);
  assert.ok(sa.courses.some((c) => c.id === cid));
  const ed = await put(a, { slotId: sa.labs[0].id, day: 3, start: '12:00', end: '13:00', hall: 'مختبر 3' });
  assert.equal(ed.status, 200, JSON.stringify(ed.json));
  assert.equal(ed.json.slots[0].dayLabel, 'الثلاثاء');
  const sb = (await call('GET', `/api/student-groups/${b.id}/schedule`, { cookie: adm })).json;
  assert.equal(sb.labs.length, 1); assert.equal(sb.labs[0].day, 2);
  assert.equal((await put(b, { slotId: ed.json.slots[0].id, day: 1, start: '09:00', end: '10:00' })).status, 404);
  assert.equal((await call('DELETE', `/api/student-groups/${a.id}/labs/${ed.json.slots[0].id}`, { cookie: adm })).json.slots.length, 0);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM course_schedules WHERE course_id = ?').get(cid).c), 1);

  const ex = await call('POST', '/api/expansions/exams/bulk', { cookie: adm, body: { exam_type: 'نهائي', academic_year: '2026/2027', semester: 'الفصل الأول', items: [{ course_code: 'NET-LAB', course_name: 'شبكات عملي', exam_date: '2026-12-15', start_time: '09:00', end_time: '11:00', hall_name: 'قاعة 1', group_id: a.id }] } });
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  sa = (await call('GET', `/api/student-groups/${a.id}/schedule`, { cookie: adm })).json;
  assert.equal(sa.exams.length, 1); assert.equal(sa.exams[0].hall_name, 'قاعة 1');
  assert.equal((await call('DELETE', `/api/student-groups/${b.id}/exams/${sa.exams[0].id}`, { cookie: adm })).status, 404);
  assert.equal((await call('DELETE', `/api/student-groups/${a.id}/exams/${sa.exams[0].id}`, { cookie: viewer })).status, 403);
  const del = await call('DELETE', `/api/student-groups/${a.id}/exams/${sa.exams[0].id}`, { cookie: adm });
  assert.equal(del.status, 200); assert.equal(del.json.exams.length, 0);

  const v = (await call('GET', `/api/student-groups/${a.id}/schedule`, { cookie: viewer })).json;
  assert.equal(v.labs, null); assert.equal(v.canLab, false);
  assert.equal((await call('PUT', `/api/student-groups/${a.id}/labs`, { cookie: viewer, body: { courseId: cid, day: 1, start: '10:00', end: '11:00' } })).status, 403);
});
