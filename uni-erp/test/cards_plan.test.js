import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { readXlsx } from '../server/lib/xlsx.js';

const PW = 'Str0ng-Test-Pass!';
let app, base, adm, staff, stu, auditor, prog, prog2, faculty, s1, s2, s3;

async function call(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* ثنائي */ }
  return { status: res.status, json, buf };
}
const addStudent = (hash, no, programId, level, year, first = 'طالب') => {
  const now = Date.now(), id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,'student',?,?)").run(no, `${first} ${no}`, hash, no, now).lastInsertRowid);
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, ?, 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', ?, 'الفصل الأول', ?, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id, first, no, `9${String(id).padStart(10, '0')}`, programId, year, level, now, now);
  return id;
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-cards-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), add = (u, role) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, hash, role, Date.now());
  add('adm', 'admin'); add('staff', 'staff'); add('aud', 'auditor');
  const programs = app.db.prepare('SELECT id, faculty_id FROM programs WHERE active = 1 ORDER BY faculty_id, id').all();
  prog = programs[0]; prog2 = programs.find((p) => p.faculty_id !== prog.faculty_id); faculty = prog.faculty_id;
  s1 = addStudent(hash, 'CARD-1', prog.id, 1, 2026); s2 = addStudent(hash, 'CARD-2', prog.id, 2, 2025); s3 = addStudent(hash, 'CARD-3', prog2.id, 1, 2026);
  const login = async (username) => (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) })).headers.get('set-cookie').split(';')[0];
  adm = await login('adm'); staff = await login('staff'); aud = await login('aud'); stu = await login('CARD-1');
});
let aud;
test.after(async () => { if (app) await app.close(); });

test('فلاتر البطاقات: الجهة والسنة وسنة القيد، والأسماء تظهر، وبحقول قالب البطاقة', async () => {
  const list = async (q) => (await call('GET', `/api/cards/students?${q}`, { cookie: staff })).json;
  assert.equal((await list('')).total, 3);
  assert.deepEqual((await list(`faculty=${faculty}`)).students.map((x) => x.studentNo).sort(), ['CARD-1', 'CARD-2']);
  assert.deepEqual((await list('level=2')).students.map((x) => x.studentNo), ['CARD-2']);
  assert.deepEqual((await list(`enrollYear=2026&faculty=${faculty}`)).students.map((x) => x.studentNo), ['CARD-1']);
  assert.equal((await list('status=graduated')).total, 0);
  const one = (await list('level=2')).students[0];
  assert.match(one.name, /طالب/);
  assert.ok(one.program.faculty && one.levelLabel && one.createdAt);
  const options = (await call('GET', '/api/cards/options', { cookie: staff })).json;
  assert.ok(options.faculties.length && options.programs.length);
  assert.deepEqual(options.years, [2026, 2025]);
  // البحث يضيّق الدفعة إلى طالب واحد بالرقم الجامعي، ويتحمل رموز LIKE
  const found = await list('q=CARD-1');
  assert.ok(found.students.length >= 1 && found.students.every((s) => s.studentNo.includes('CARD-1')));
  assert.equal((await list('q=' + encodeURIComponent('لا_يوجد%'))).total, 0);
  assert.equal((await call('GET', '/api/cards/students', { cookie: stu })).status, 403);
  assert.equal((await call('GET', '/api/cards/students')).status, 401);
});

test('جدول الاستلام: الدفعة تضم المفلترين فقط، ويُسجَّل الاستلام مرة، ويُلغى، ويُصدَّر', async () => {
  const post = (body, cookie = staff) => call('POST', '/api/cards/batches', { cookie, body });
  assert.equal((await post({ label: 'x', filters: {} })).status, 400, 'الاسم قصير');
  assert.equal((await post({ label: 'فارغة', filters: { level: 9 } })).status, 400, 'لا طلاب');
  assert.equal((await post({ label: 'مدقق', filters: {} }, aud)).status, 403, 'القراءة لا تكفي');
  const made = await post({ label: 'السنة الأولى', filters: { level: 1 } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.total, 2);
  const detail = async () => (await call('GET', `/api/cards/batches/${made.json.id}`, { cookie: staff })).json;
  const rows = (await detail()).rows;
  assert.deepEqual(rows.map((r) => r.studentNo).sort(), ['CARD-1', 'CARD-3']);
  assert.ok(rows.every((r) => r.receivedAt === null));
  const h = rows.find((r) => r.studentNo === 'CARD-1').id;
  const give = (body) => call('POST', `/api/cards/handovers/${h}/receive`, { cookie: staff, body });
  assert.equal((await give({ receiver: '' })).status, 400, 'اسم المستلم مطلوب');
  assert.equal((await give({ receiver: 'ولي الأمر' })).status, 200);
  assert.equal((await give({ receiver: 'آخر' })).status, 409, 'لا يُسلَّم مرتين');
  const after = (await detail()).rows.find((r) => r.id === h);
  assert.equal(after.receiver, 'ولي الأمر');
  assert.equal(after.handedBy, 'staff');
  assert.ok(after.receivedAt);
  const batches = (await call('GET', '/api/cards/batches', { cookie: staff })).json.batches.find((b) => b.id === made.json.id);
  assert.deepEqual([batches.total, batches.received], [2, 1]);
  assert.ok((await call('GET', '/api/cards/students?level=1', { cookie: staff })).json.students.find((s) => s.studentNo === 'CARD-1').receivedAt);
  const xlsx = await call('GET', `/api/cards/batches/${made.json.id}/export.xlsx`, { cookie: staff });
  const sheet = readXlsx(xlsx.buf).sheets[0].rows;
  assert.equal(sheet.length, 3);
  assert.ok(sheet.some((r) => r.includes('ولي الأمر') && r.includes('مستلَمة')));
  assert.equal((await call('POST', `/api/cards/handovers/${h}/undo`, { cookie: staff, body: {} })).status, 200);
  assert.equal((await call('POST', `/api/cards/handovers/${h}/undo`, { cookie: staff, body: {} })).status, 409);
  assert.equal((await detail()).rows.find((r) => r.id === h).receivedAt, null);
});

test('ربط المقررات: يظهر في الخطة بما يتطلبه وما يفتحه، وتُرفض الحلقة، والتسجيل يطبّقه', async () => {
  const course = (code, level) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, ?, 1, ?, ?, 3)').run(prog.id, level, `مقرر ${code}`, code).lastInsertRowid);
  const a = course('LNK-A', 1), b = course('LNK-B', 2), c = course('LNK-C', 3);
  const other = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'خارجي', 'LNK-X', 3)").run(prog2.id).lastInsertRowid);
  const link = (courseId, prereqCourseId, cookie = adm, minMark) => call('POST', '/api/student-affairs-suite/prerequisites', { cookie, body: { courseId, prereqCourseId, minMark } });
  assert.equal((await link(b, a, stu)).status, 403);
  assert.equal((await link(a, a)).status, 400, 'لا يتطلب نفسه');
  assert.equal((await link(b, other)).status, 400, 'برنامج آخر');
  assert.equal((await link(b, 999999)).status, 400);
  const ab = await link(b, a, staff, 70);
  assert.equal(ab.status, 201, JSON.stringify(ab.json));
  assert.equal((await link(b, a)).status, 409, 'مكرر');
  assert.equal((await link(c, b)).status, 201);
  const cycle = await link(a, c);
  assert.equal(cycle.status, 409);
  assert.match(cycle.json.message, /حلقة/);

  const tree = (await call('GET', `/api/student-affairs-suite/overview?studentId=${s1}`, { cookie: adm })).json.advising.degreeTree.nodes;
  const node = (id) => tree.find((n) => n.id === id);
  assert.deepEqual(node(b).prerequisites.map((p) => [p.id, p.minMark]), [[a, 70]]);
  assert.deepEqual(node(a).unlocks.map((u) => u.id), [b]);
  assert.equal(node(b).state, 'locked');
  assert.ok(node(b).prerequisites[0].linkId);

  // التسجيل يطبق الربط ولو لم يرسله المتصفح
  const enroll = (cookie) => call('POST', '/api/enterprise/self-enroll', { cookie, body: { course_code: 'LNK-B', course_name: 'مقرر', credits: 3 } });
  const blocked = await enroll(stu);
  assert.equal(blocked.status, 400);
  assert.match(blocked.json.message, /مقرر LNK-A/);
  app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'مقرر LNK-A', 3, 65, ?, 1, 1, '2025/2026', 65, 1, 'approved')").run(s1, a);
  assert.equal((await enroll(stu)).status, 400, 'اجتاز المقرر لكن دون علامة الربط');
  app.db.prepare('UPDATE grades SET mark = 75, theory_mark = 75 WHERE student_id = ? AND course_id = ?').run(s1, a);
  assert.equal((await enroll(stu)).status, 201);

  assert.equal((await call('DELETE', `/api/student-affairs-suite/prerequisites/${ab.json.id}`, { cookie: stu })).status, 403);
  assert.equal((await call('DELETE', `/api/student-affairs-suite/prerequisites/${ab.json.id}`, { cookie: adm })).status, 200);
  assert.equal((await call('DELETE', `/api/student-affairs-suite/prerequisites/${ab.json.id}`, { cookie: adm })).status, 404);
});
