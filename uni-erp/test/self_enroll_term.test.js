import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { academicYear } from '../server/lib/doc_no.js';

const PW = 'Str0ng-Test-Pass!';
const OLD_TERM = 'الفصل الأول 2020/2021';
let app, base, adm, hash, prog, seq = 0;

async function call(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, json };
}
const login = async (username) => (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) })).headers.get('set-cookie').split(';')[0];

async function student() {
  const no = `TERM-${++seq}`, now = Date.now();
  const id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,'student',?,?)").run(no, `طالب ${no}`, hash, no, now).lastInsertRowid);
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id, no, `8${String(id).padStart(10, '0')}`, prog, now, now);
  return { id, no, cookie: await login(no) };
}
const course = (code, hours = 3) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, ?, ?, ?)').run(prog, `مقرر ${code}`, code, hours).lastInsertRowid);
const enroll = (s, code) => call('POST', '/api/enterprise/self-enroll', { cookie: s.cookie, body: { course_code: code } });
const history = (s, code, credits, semester) => app.db.prepare("INSERT INTO student_self_enrollments (student_no, student_name, course_code, course_name, credits, semester, status, registered_at) VALUES (?, 'ط', ?, 'م', ?, ?, 'مسجل', ?)").run(s.no, code, credits, semester, Date.now());
const grade = (s, courseId, mark) => app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'م', 3, ?, ?, 1, 1, '2020/2021', ?, ?, 'approved')").run(s.id, mark, courseId, mark, Date.now());
const setTerm = async (value) => assert.equal((await call('PUT', '/api/admin/general', { cookie: adm, body: { values: { 'academic.current_semester': value } } })).status, 200);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-term-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('adm','adm',?,'admin',?)").run(hash, Date.now());
  prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  adm = await login('adm');
});
test.after(async () => { if (app) await app.close(); });

test('ساعات الفصول السابقة لا تُحسب من حد الفصل الحالي', async () => {
  const s = await student();
  course('T-NEW');
  for (let i = 0; i < 6; i++) history(s, `T-OLD${i}`, 3, OLD_TERM);
  assert.equal((await enroll(s, 'T-NEW')).status, 201);
});

test('الراسب يعيد المقرر في فصل لاحق', async () => {
  const s = await student(), id = course('T-RETAKE');
  history(s, 'T-RETAKE', 3, OLD_TERM);
  grade(s, id, 30);
  assert.equal((await enroll(s, 'T-RETAKE')).status, 201);
});

test('الناجح لا يعيد تسجيل المقرر', async () => {
  const s = await student(), id = course('T-PASS');
  history(s, 'T-PASS', 3, OLD_TERM);
  grade(s, id, 75);
  const r = await enroll(s, 'T-PASS');
  assert.equal(r.status, 409);
  assert.match(r.json.message, /نجحت/);
});

test('داخل الفصل نفسه يبقى منع التكرار وحد الساعات', async () => {
  const s = await student();
  course('T-DUP'); course('T-BIG');
  for (let i = 0; i < 5; i++) history(s, `T-CUR${i}`, 3, `الفصل الأول ${academicYear()}`);
  assert.equal((await enroll(s, 'T-DUP')).status, 201);
  assert.equal((await enroll(s, 'T-DUP')).status, 409);
  assert.equal((await enroll(s, 'T-BIG')).status, 400);
});

test('الفصل الحالي من الإعدادات ويُحفظ مع التسجيل', async () => {
  const s = await student();
  course('T-SEM');
  const label = () => app.db.prepare('SELECT semester FROM student_self_enrollments WHERE student_no = ? ORDER BY id DESC LIMIT 1').get(s.no).semester;
  assert.equal((await enroll(s, 'T-SEM')).status, 201);
  assert.equal(label(), `الفصل الأول ${academicYear()}`);
  await setTerm('الفصل الثاني');
  try {
    assert.equal((await enroll(s, 'T-SEM')).status, 201, 'فصل جديد في العام نفسه');
    assert.equal(label(), `الفصل الثاني ${academicYear()}`);
    assert.equal((await enroll(s, 'T-SEM')).status, 409);
  } finally { await setTerm('الفصل الأول'); }
});
