import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Str0ng-Test-Pass!';
let app, call, adm, staff, other, undoer, program, faculty;
const b64 = (lines) => Buffer.from(lines.join('\n'), 'utf8').toString('base64');
const count = (t) => Number(app.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
const post = (kind, body, cookie = adm) => call('POST', `/api/import/${kind}`, { cookie, body });
const STUDENT_HEAD = 'first_name,father_name,last_name,mother_name,birth_date,birth_place,gender,national_id,phone,governorate,city,address,hs_type,hs_year,hs_score,faculty,program,admission_type,enroll_year,enroll_term,study_level,guardian_name,guardian_relation,guardian_phone';
// تاريخ الميلاد يختلف بين الصفوف حتى لا يعدّها فحص التكرار الطالب نفسه
const studentRow = (nid, phone) => `أحمد,محمد,الشامي,فاطمة,2004-05-${nid.slice(-2)},دمشق,ذكر,${nid},${phone},دمشق,المزة,شارع 1,الثانوية العامة - الفرع العلمي,2024,2100,${faculty},${program},القبول العام (المفاضلة),2025,الفصل الأول,1,محمد الشامي,الأب,0933000111`;
const students = (...rows) => ({ filename: 's.csv', data: b64([STUDENT_HEAD, ...rows]) });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-staged-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  app.limiter.check = () => true;
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const hash = await hashPassword(PW, 1024), add = (u, role, perms = null) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, created_at) VALUES (?,?,?,?,?,?)').run(u, u, hash, role, perms ? JSON.stringify(perms) : null, Date.now());
  add('adm', 'admin'); add('staff', 'staff'); add('other', 'staff'); add('undoer', 'staff', ['grade:manage', 'import:undo']);
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
  adm = await login('adm'); staff = await login('staff'); other = await login('other'); undoer = await login('undoer');
  const fp = app.db.prepare('SELECT f.name AS faculty, p.name AS program FROM programs p JOIN faculties f ON f.id = p.faculty_id WHERE p.active = 1 ORDER BY p.id LIMIT 1').get();
  faculty = fp.faculty; program = fp.program;
});
test.after(async () => { if (app) await app.close(); });

test('الفحص لا يكتب، والحفظ لا يقبل إلا رمز الفحص، والرمز لمرة واحدة ولصاحبه فقط', async () => {
  const before = count('users');
  const r = await post('students', students(studentRow('01055440001', '0911110001')));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.committed, false);
  assert.ok(r.json.stagingToken);
  assert.equal(r.json.confirmWord, 'سجل الطلاب');
  assert.equal(count('users'), before, 'الفحص لا يكتب');

  assert.equal((await post('students', { commit: true, confirm: 'سجل الطلاب', ...students(studentRow('01055440001', '0911110001')) })).status, 400, 'الملف وحده لا يكفي');
  assert.equal((await post('students', { commit: true, stagingToken: r.json.stagingToken })).status, 400, 'التأكيد مطلوب');
  assert.equal(count('users'), before);
  assert.equal((await post('students', { commit: true, stagingToken: r.json.stagingToken, confirm: 'سجل الطلاب' }, other)).status, 410, 'رمز مستخدم آخر');
  assert.equal((await post('courses', { commit: true, stagingToken: r.json.stagingToken })).status, 410, 'رمز نوع آخر');

  const saved = await post('students', { commit: true, stagingToken: r.json.stagingToken, confirm: 'سجل الطلاب' });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.created, 1);
  assert.ok(saved.json.credentialsXlsx && saved.json.batchId);
  assert.ok(!('changes' in saved.json), 'سجل التغييرات لا يخرج في الرد');
  assert.equal(count('users'), before + 1);
  assert.equal((await post('students', { commit: true, stagingToken: r.json.stagingToken, confirm: 'سجل الطلاب' })).status, 410, 'لا يُحفظ مرتين');
  assert.equal(count('users'), before + 1);
});

test('الإلغاء لا يكتب شيئاً ويُبطل الرمز، والحفظ الجزئي صريح', async () => {
  const before = count('users');
  const r = await post('students', students(studentRow('01055440002', '0911110002')));
  assert.equal((await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: r.json.stagingToken } })).status, 200);
  assert.equal((await post('students', { commit: true, stagingToken: r.json.stagingToken, confirm: 'سجل الطلاب' })).status, 410);
  assert.equal(count('users'), before);

  const mix = await post('students', students(studentRow('01055440003', '0911110003'), studentRow('999', '0911110004')));
  assert.equal(mix.json.valid, 1);
  assert.equal(mix.json.errorCount, 1);
  const stopped = await post('students', { commit: true, stagingToken: mix.json.stagingToken, confirm: 'سجل الطلاب' });
  assert.equal(stopped.status, 409, 'لا حفظ جزئي إلا بطلب صريح');
  assert.equal(count('users'), before);
  const saved = await post('students', { commit: true, stagingToken: mix.json.stagingToken, confirm: 'سجل الطلاب', acceptPartial: true });
  assert.equal(saved.json.created, 1);
  assert.equal(saved.json.errorCount, 1);
});

test('التراجع عن الطلاب يحذف من أُنشئ، ويُمنع إذا صارت له سجلات', async () => {
  const before = count('users');
  const r = await post('students', students(studentRow('01055440005', '0911110005'), studentRow('01055440006', '0911110006')));
  const saved = await post('students', { commit: true, stagingToken: r.json.stagingToken, confirm: 'سجل الطلاب' });
  const undo = (id) => call('POST', `/api/import-engine/batches/${id}/undo`, { cookie: adm, body: {} });
  assert.equal(count('users'), before + 2);
  const nid = '01055440005', sid = app.db.prepare('SELECT user_id FROM student_profiles WHERE national_id = ?').get(nid).user_id;
  app.db.prepare("INSERT INTO student_holds (student_id, hold_type, note, created_at) VALUES (?, 'financial', 'x', ?)").run(sid, Date.now());
  const blocked = await undo(saved.json.batchId);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.message, /سجلات/);
  assert.equal(count('users'), before + 2, 'لم يتغير شيء');
  app.db.prepare('DELETE FROM student_holds WHERE student_id = ?').run(sid);
  const ok = await undo(saved.json.batchId);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(count('users'), before);
  assert.ok(!app.db.prepare('SELECT 1 AS x FROM student_profiles WHERE national_id = ?').get(nid));
  const log = (await call('GET', '/api/import-engine/batches', { cookie: adm })).json.batches.find((b) => b.id === saved.json.batchId);
  assert.equal(log.status, 'undone');
  assert.equal(log.title, 'سجل الطلاب');
  assert.equal(log.reverses, false);
});

test('العلامات: التراجع يعيد المعدَّل حرفياً ويحذف الجديد ويسجل ذلك، ولمن يملك صلاحيته فقط', async () => {
  const r0 = await post('students', students(studentRow('01055440007', '0911110007')));
  await post('students', { commit: true, stagingToken: r0.json.stagingToken, confirm: 'سجل الطلاب' });
  const stu = app.db.prepare('SELECT u.id, u.student_no, p.program_id FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE p.national_id = ?').get('01055440007');
  const addCourse = (code) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, ?, ?, 3)').run(stu.program_id, code, code).lastInsertRowid);
  const c1 = addCourse('GRD-1'); addCourse('GRD-2');
  app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'GRD-1', 3, 50, ?, 1, 1, '2025/2026', 50, 1, 'draft')").run(stu.id, c1);
  const grade = (code) => app.db.prepare('SELECT g.* FROM grades g JOIN courses c ON c.id = g.course_id WHERE g.student_id = ? AND c.code = ?').get(stu.id, code);
  const before = grade('GRD-1');
  const file = { filename: 'g.csv', data: b64(['الرقم الجامعي,رمز المقرر,العام الدراسي,العلامة النظرية', `${stu.student_no},GRD-1,2025/2026,77`, `${stu.student_no},GRD-2,2025/2026,66`]) };
  const r = await post('grades', file);
  assert.equal(r.json.confirmWord, 'علامات الطلاب');
  assert.equal(Number(grade('GRD-1').mark), 50, 'الفحص لا يكتب');
  assert.equal(grade('GRD-2'), undefined);
  const saved = await post('grades', { commit: true, stagingToken: r.json.stagingToken, confirm: 'علامات الطلاب' });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(Number(grade('GRD-1').mark), 77);
  assert.equal(Number(grade('GRD-2').mark), 66);
  assert.equal((await call('POST', `/api/import-engine/batches/${saved.json.batchId}/undo`, { cookie: staff, body: {} })).status, 403, 'بلا صلاحية تراجع');
  const u = await call('POST', `/api/import-engine/batches/${saved.json.batchId}/undo`, { cookie: undoer, body: {} });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.deepEqual(grade('GRD-1'), before, 'يعود حرفياً');
  assert.equal(grade('GRD-2'), undefined, 'والجديد يُحذف');
  assert.ok(Number(app.db.prepare("SELECT COUNT(*) c FROM grade_changes WHERE action = 'تراجع عن استيراد علامات'").get().c) >= 2);
});

test('المقررات والقاعات تمر بالفحص والحفظ وتظهر في السجل بلا تراجع', async () => {
  const file = { filename: 'c.csv', data: b64(['الكلية,البرنامج,السنة الدراسية,الفصل,اسم المقرر', `${faculty},${program},1,1,مقرر مرحلي`]) };
  const before = count('courses'), r = await post('courses', file);
  assert.equal(r.json.confirmWord, null);
  assert.equal(count('courses'), before);
  const saved = await post('courses', { commit: true, stagingToken: r.json.stagingToken });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(count('courses'), before + 1);
  const batch = (await call('GET', '/api/import-engine/batches', { cookie: adm })).json.batches.find((b) => b.id === saved.json.batchId);
  assert.equal(batch.canUndo, false);
  assert.equal((await call('POST', `/api/import-engine/batches/${saved.json.batchId}/undo`, { cookie: adm, body: {} })).status, 409);
});
