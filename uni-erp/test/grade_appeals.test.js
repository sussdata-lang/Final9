import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Str0ng-Test-Pass!';
let app, call, adm, approver, examsOnly, stu, stuId, programId;

const appealOf = (id) => app.db.prepare('SELECT * FROM grade_appeals WHERE id = ?').get(id);
const gradeOf = (id) => app.db.prepare('SELECT * FROM grades WHERE id = ?').get(id);
const decide = (id, body, cookie = approver) => call('POST', `/api/expansions/appeals/${id}/decide`, { cookie, body });
const file = (code, cookie = stu, extra = {}) => call('POST', '/api/expansions/appeals', { cookie, body: { course_code: code, reason: 'مراجعة جمع الدرجات', ...extra } });
const myMark = async (code) => (await call('GET', '/api/me/grades?level=1', { cookie: stu })).json.grades.find((g) => g.code === code || g.course === code)?.total;

function addGrade(code, mark, practical = null, status = 'approved') {
  const courseId = Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, ?, ?, 3)').run(programId, code, code).lastInsertRowid);
  return Number(app.db.prepare(`INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, practical_mark, entered_by, entered_at, workflow_status, approved_by, approved_at)
    VALUES (?, 't', ?, 3, ?, ?, 1, 1, '2025/2026', ?, ?, 1, ?, ?, 1, ?)`).run(stuId, code, mark, courseId, mark - (practical ?? 0), practical, Date.now(), status, Date.now()).lastInsertRowid);
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-appeal-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const add = (u, role, no = null, custom = null) => Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, custom_permissions_json, created_at) VALUES (?,?,?,?,?,?,?)').run(u, u, hash, role, no, custom ? JSON.stringify(custom) : null, now).lastInsertRowid);
  add('adm', 'admin');
  add('approver', 'staff', null, ['grade:approve']);
  add('exams', 'staff', null, ['exams_housing:approve']);
  stuId = add('stu', 'student', 'STU-A');
  programId = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 'ج', 'د', '90000000002', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(stuId, programId, now, now);
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
  adm = await login('adm'); approver = await login('approver'); examsOnly = await login('exams'); stu = await login('stu');
});
test.after(async () => { if (app) await app.close(); });

test('قبول التظلم يعدّل العلامة الفعلية، ويُسجَّل التغيير، ويراها الطالب، ولا يُبت مرتين', async () => {
  const gid = addGrade('APL-1', 70, 20);
  const filed = await file('APL-1', stu, { old_mark: 5, student_no: 'OTHER', student_name: 'مزور', course_name: 'مزور' });
  assert.equal(filed.status, 201, JSON.stringify(filed.json));
  const before = appealOf(filed.json.id);
  assert.equal(Number(before.old_mark), 70, 'العلامة المعلنة من السجل لا مما يُرسل');
  assert.equal(before.student_no, 'STU-A');
  assert.equal(before.student_name, 'stu');
  assert.equal(before.course_name, 'APL-1');
  assert.equal(Number(before.grade_id), gid);

  const r = await decide(filed.json.id, { approve: true, new_mark: 78, committee_note: 'إعادة جمع الدرجات' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.pendingApproval, false);
  const g = gradeOf(gid);
  assert.deepEqual([Number(g.mark), Number(g.theory_mark), Number(g.practical_mark), g.workflow_status], [78, 58, 20, 'approved'], 'العملي يبقى والفرق في النظري');
  assert.ok(g.approved_by, 'الاعتماد باقٍ');
  const log = app.db.prepare('SELECT * FROM grade_changes WHERE grade_id = ? ORDER BY id DESC').get(gid);
  assert.deepEqual([Number(log.old_total), Number(log.new_total), log.action], [70, 78, 'تعديل علامة بقرار تظلم']);
  assert.match(log.justification, /إعادة جمع/);
  const after = appealOf(filed.json.id);
  assert.deepEqual([after.status, Number(after.old_mark), Number(after.new_mark)], ['مقبول وتعديل العلامة', 70, 78]);
  // يرى الطالب علامته بعد إعلان نتيجة المقرر (قرار التظلم على مقرر معلن له اختبار مستقل في grading.test.js)
  app.db.prepare("INSERT INTO grade_locks (course_id, academic_year, locked_by, locked_at) SELECT course_id, academic_year, NULL, ? FROM grades WHERE id = ? ON CONFLICT DO NOTHING").run(Date.now(), gid);
  assert.equal(await myMark('APL-1'), 78);
  assert.equal((await decide(filed.json.id, { approve: false, committee_note: 'x' }, adm)).status, 409);
  assert.equal(Number(gradeOf(gid).mark), 78);
});

test('العلامة الأقل من العملي: لا يتجاوز العملي المجموع', async () => {
  const gid = addGrade('APL-2', 70, 30);
  const { json } = await file('APL-2');
  assert.equal((await decide(json.id, { approve: true, new_mark: 25, committee_note: 'تصحيح خطأ في الجمع' })).status, 200);
  const g = gradeOf(gid);
  assert.deepEqual([Number(g.mark), Number(g.theory_mark), Number(g.practical_mark)], [25, 0, 25]);
});

test('من لا يملك اعتماد العلامات: تعود العلامة مسودة ولا يراها الطالب قبل الاعتماد', async () => {
  const gid = addGrade('APL-3', 60);
  const { json } = await file('APL-3');
  const r = await decide(json.id, { approve: true, new_mark: 72, committee_note: 'قرار اللجنة الامتحانية' }, examsOnly);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.pendingApproval, true);
  const g = gradeOf(gid);
  assert.deepEqual([Number(g.mark), g.workflow_status, g.approved_by], [72, 'draft', null]);
  assert.equal(await myMark('APL-3'), undefined, 'الطالب لا يرى إلا المعتمد');
});

test('القبول المعيب لا يكتب شيئاً، والرفض يحتاج قراراً ولا يغيّر العلامة', async () => {
  const gid = addGrade('APL-4', 65);
  const { json } = await file('APL-4');
  for (const [body, why] of [[{ new_mark: 101, committee_note: 'قرار اللجنة' }, 'فوق الحد'], [{ new_mark: -1, committee_note: 'قرار اللجنة' }, 'تحت الصفر'], [{ new_mark: 70.5, committee_note: 'قرار اللجنة' }, 'كسر'], [{ committee_note: 'قرار اللجنة' }, 'بلا علامة'], [{ new_mark: 65, committee_note: 'قرار اللجنة' }, 'العلامة نفسها'], [{ new_mark: 70 }, 'بلا قرار'], [{ new_mark: 70, committee_note: '12345' }, 'قرار غير موضوعي']]) {
    assert.equal((await decide(json.id, { approve: true, ...body })).status, 400, why);
    assert.equal(Number(gradeOf(gid).mark), 65, why);
    assert.equal(appealOf(json.id).status, 'قيد اللجنة', why);
  }
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM grade_changes WHERE grade_id = ?').get(gid).c), 0);
  assert.equal((await decide(json.id, { approve: false })).status, 400, 'الرفض بلا قرار');
  assert.equal((await decide(json.id, { approve: false, committee_note: 'الجمع صحيح' })).status, 200);
  assert.equal(appealOf(json.id).status, 'مرفوض');
  assert.equal(Number(gradeOf(gid).mark), 65);
});

test('لا تظلم بلا علامة مرصودة، والمستورد بلا علامة لا يُقبل بصمت', async () => {
  assert.equal((await file('NO-GRADE')).status, 400);
  assert.equal((await file('NO-GRADE', approver, { student_no: 'STU-A' })).status, 400, 'ولا عن طريق الموظف');
  const orphan = Number(app.db.prepare("INSERT INTO grade_appeals (student_no, student_name, course_code, course_name, old_mark, reason, status, created_at) VALUES ('STU-A', 'stu', 'NO-GRADE', 'x', 50, 'y', 'قيد اللجنة', ?)").run(Date.now()).lastInsertRowid);
  const r = await decide(orphan, { approve: true, new_mark: 60, committee_note: 'قرار اللجنة' });
  assert.equal(r.status, 409);
  assert.match(r.json.message, /لا توجد علامة/);
  assert.equal(appealOf(orphan).status, 'قيد اللجنة');
  assert.equal((await decide(orphan, { approve: false, committee_note: 'لا علامة مرصودة' })).status, 200);
});
