// قرارات الأقسام: الاعتماد بعد موافقة عضو الهيئة، وفصل السكن عن الامتحانات، وقسم الخريجين للخريج، وربط الفئات بالمحاضرات، وكشف الرسوم.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { callGeminiAI } from '../server/services/v12_modules.js';

const PW = 'Str0ng-Test-Pass!';
let app, base, hash, adm;
const call = async (method, url, { cookie, body } = {}) => {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const login = async (username) => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
  return r.headers.get('set-cookie').split(';')[0];
};
const staff = (username, perms) => Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, created_at) VALUES (?, ?, ?, 'staff', 'custom', ?, ?)").run(username, username, hash, JSON.stringify(perms), Date.now()).lastInsertRowid);
let n = 0;
function student(no, status = 'active') {
  const now = Date.now(), prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  const id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?, ?, ?, 'student', ?, ?)").run(no, no, hash, no, now).lastInsertRowid);
  n++;
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 'ج', 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', ?, 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, ?, 'هـ', 'أب', '0944111222', ?, ?)`).run(id, String(70000000000 + n), `09${60000000 + n}`, prog, status, now, now);
  return id;
}
const course = (name, memberId = null) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, member_id) SELECT id, 1, 1, ?, ?, ? FROM programs ORDER BY id LIMIT 1').run(name, name, memberId).lastInsertRowid);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-dec-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('adm', 'مدير', ?, 'admin', ?)").run(hash, Date.now());
  adm = await login('adm');
});
test.after(async () => { if (app) await app.close(); });

test('علامات المقرر المسند لا يعتمدها إلا عضو الهيئة، حتى حامل grade:approve والمدير', async () => {
  const fac = staff('fac_x', ['grade:approve_own']);
  staff('exam_x', ['grade:manage', 'grade:approve']);
  const member = Number(app.db.prepare("INSERT INTO faculty_members (name, rank, status, user_id, created_at) VALUES ('عضو', 'مدرس', 'active', ?, ?)").run(fac, Date.now()).lastInsertRowid);
  const owned = course('DEC-OWNED', member), free = course('DEC-FREE');
  const stu = student('DEC-1');
  const grade = (cid) => Number(app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, workflow_status) VALUES (?, 'ف', 'م', 3, 70, ?, 'reviewed')").run(stu, cid).lastInsertRowid);
  const flow = (cookie, ids) => call('POST', '/api/grades/workflow', { cookie, body: { gradeIds: ids, stage: 'approved' } });
  const exam = await login('exam_x'), facC = await login('fac_x');
  const a = grade(owned), b = grade(owned), c = grade(free);

  const single = await flow(exam, [a]);
  assert.equal(single.status, 403);
  assert.match(single.json.error?.message ?? single.json.message ?? JSON.stringify(single.json), /عضو الهيئة/);
  assert.equal((await flow(adm, [a])).status, 403, 'والمدير كذلك');

  const bulk = await flow(exam, [a, c]);
  assert.equal(bulk.json.updated, 1, 'الجماعي يعتمد غير المسند فقط');
  assert.match(bulk.json.skipped[0].reason, /عضو الهيئة/);
  assert.equal(app.db.prepare('SELECT workflow_status s FROM grades WHERE id = ?').get(a).s, 'reviewed');
  assert.equal(app.db.prepare('SELECT workflow_status s FROM grades WHERE id = ?').get(c).s, 'approved');

  assert.equal((await flow(facC, [a, b])).json.updated, 2, 'عضو الهيئة يعتمد مقرره');
  const row = (await call('GET', `/api/grades?course=${owned}`, { cookie: exam })).json.rows[0];
  assert.equal(row.approverId, fac, 'الواجهة تعرف من يعتمد');
});

test('السكن والساعات المكتبية في شؤون الطلاب، لا في الامتحانات', async () => {
  staff('exam_h', ['exams_housing:view', 'exams_housing:write', 'exams_housing:edit', 'exams_housing:approve']);
  staff('house_h', ['sa_housing:view', 'sa_housing:manage']);
  const exam = await login('exam_h'), house = await login('house_h');
  const room = Number(app.db.prepare("INSERT INTO dorm_rooms (building_name, room_no, capacity, occupied) VALUES ('مبنى', '1', 3, 0)").run().lastInsertRowid);
  student('DEC-H');
  const alloc = { student_no: 'DEC-H', room_id: room };
  const office = { slot_day: 'الإثنين', slot_time: '10:00', faculty_name: 'د', student_name: 'ط', student_no: 'DEC-H', topic: 'ت' };

  assert.equal((await call('POST', '/api/housing/allocations', { cookie: exam, body: alloc })).status, 403);
  assert.equal((await call('POST', '/api/expansions/office-bookings', { cookie: exam, body: office })).status, 403);
  assert.equal((await call('GET', '/api/student-life/overview', { cookie: exam })).status, 403);
  assert.equal((await call('POST', '/api/housing/allocations', { cookie: house, body: alloc })).status, 201);
  assert.equal((await call('POST', '/api/expansions/office-bookings', { cookie: house, body: office })).status, 201);

  const life = (await call('GET', '/api/student-life/overview', { cookie: house })).json;
  assert.equal(life.dormAllocations.length, 1);
  assert.equal(life.officeBookings.length, 1);
  assert.equal((await call('GET', '/api/expansions/overview', { cookie: exam })).json.dormAllocations, undefined);

  const me = async (c) => (await call('GET', '/api/me', { cookie: c })).json.user.allowedViews;
  assert.ok(!(await me(exam)).includes('student_life'));
  assert.ok((await me(house)).includes('student_life'));

  const stu = await login('DEC-H');
  const mine = (await call('GET', '/api/student-life/overview', { cookie: stu })).json;
  assert.equal(mine.dormAllocations.length, 1, 'الطالب يرى سكنه');
  student('DEC-H2');
  assert.equal((await call('GET', '/api/student-life/overview', { cookie: await login('DEC-H2') })).json.dormAllocations.length, 0, 'ولا يرى سكن غيره');
});

test('قسم الخريجين للخريج فقط، وكشف الرسوم متاح للطالب', async () => {
  student('DEC-ACT');
  student('DEC-GRAD', 'graduated');
  const views = async (u) => { const cookie = await login(u); return { cookie, list: (await call('GET', '/api/me', { cookie })).json.user.allowedViews }; };
  const act = await views('DEC-ACT'), grad = await views('DEC-GRAD');
  assert.ok(!act.list.includes('alumni'));
  assert.ok(grad.list.includes('alumni'));
  assert.ok(act.list.includes('fees') && act.list.includes('student_life'));
  const fees = await call('GET', '/api/me/fees', { cookie: act.cookie });
  assert.equal(fees.status, 200);
  assert.equal(fees.json.balance, 0);
});

test('الذكاء الاصطناعي: مع المفتاح يستدعي Gemini، وعند الفشل يعمل البديل الداخلي', async () => {
  const saved = { key: process.env.GEMINI_API_KEY, ctx: process.env.NODE_TEST_CONTEXT, fetch: globalThis.fetch };
  process.env.GEMINI_API_KEY = 'test-key'; delete process.env.NODE_TEST_CONTEXT;
  try {
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'جواب' }] } }] }) }; };
    const good = await callGeminiAI('نظام', 'سؤال', () => 'بديل');
    assert.equal(good.text, 'جواب');
    assert.match(seen.url, /generativelanguage\.googleapis\.com/);
    assert.equal(seen.init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!seen.url.includes('test-key'), 'المفتاح لا يوضع في الرابط');
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    assert.equal((await callGeminiAI('نظام', 'سؤال', () => 'بديل')).text, 'بديل');
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.key;
    if (saved.ctx !== undefined) process.env.NODE_TEST_CONTEXT = saved.ctx;
  }
});

test('موعد المحاضرة المربوط بفئة يخص أعضاءها فقط', async () => {
  const cid = course('DEC-LEC');
  const inGroup = student('DEC-G1'), outGroup = student('DEC-G2');
  const made = await call('POST', '/api/student-groups', { cookie: adm, body: { name: 'فئة المحاضرات', kind: 'lecture' } });
  assert.equal(made.status, 201);
  const gid = made.json.group.id;
  assert.equal((await call('PUT', `/api/student-groups/${gid}/members`, { cookie: adm, body: { add: [inGroup] } })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM student_group_members WHERE group_id = ? AND student_id = ?').get(gid, inGroup).n, 1);
  const put = (slots) => call('PUT', `/api/courses/${cid}/schedule`, { cookie: adm, body: { slots } });
  assert.equal((await put([{ day: 1, start: '08:00', end: '10:00', hall: 'أ', groupId: 999999 }])).status, 400, 'فئة غير موجودة');
  const saved = await put([{ day: 1, start: '08:00', end: '10:00', hall: 'أ', groupId: gid }, { day: 2, start: '10:00', end: '12:00', hall: 'ب' }]);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.slots[0].groupName, 'فئة المحاضرات');
  const slotsOf = async (u) => (await call('GET', '/api/me/timetable', { cookie: await login(u) })).json.slots.filter((s) => s.course === 'DEC-LEC');
  assert.equal((await slotsOf('DEC-G1')).length, 2);
  const others = await slotsOf('DEC-G2');
  assert.equal(others.length, 1, 'موعد الفئة لا يظهر لغير أعضائها');
  assert.equal(others[0].groupName, '');
  assert.ok(outGroup);
  assert.equal((await call('DELETE', `/api/student-groups/${gid}`, { cookie: adm })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM course_schedules WHERE course_id = ? AND group_id IS NOT NULL').get(cid).n, 0, 'حذف الفئة يبقي الموعد');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM course_schedules WHERE course_id = ?').get(cid).n, 2);
});
