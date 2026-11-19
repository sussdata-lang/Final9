import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { academicYear } from '../server/lib/doc_no.js';
import { creditCap } from '../server/services/sections.js';
import { applyAppealMark } from '../server/services/academics.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {}, prog, course, plain;
const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const year = academicYear();

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-grading-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const user = (u, role, perms, no) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, no ?? null, now, perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  user('adm', 'admin'); user('ex', 'staff', ['grade:manage', 'grade:approve', 'course:manage', 'academic:read']);
  for (const s of ['s1', 's2', 's3']) {
    user(s, 'student', null, `GRD-${s}`);
    app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'أ', 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id[s], s, `4${String(id[s]).padStart(10, '0')}`, prog, now, now);
  }
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  course = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'تشفير', 'GRD-101', 3) RETURNING id").get(prog).id);
  plain = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'برمجة', 'GRD-102', 3) RETURNING id").get(prog).id);
  for (const u of Object.keys(id)) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('الحد الفصلي حسب المعدل: منخفض ومتوسط ومرتفع، ومن الإعدادات', async () => {
  const add = (s, mark) => app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'م', 3, ?, ?, 1, 1, '2020/2021', ?, ?, 'approved')").run(id[s], mark, plain, mark, Date.now());
  assert.deepEqual(creditCap(app.db, id.s1), { cap: 18, gpa: null }, 'بلا علامات: الحد المتوسط');
  add('s1', 50); add('s2', 70); add('s3', 90);
  assert.equal(creditCap(app.db, id.s1).cap, 12);
  assert.equal(creditCap(app.db, id.s2).cap, 18);
  assert.equal(creditCap(app.db, id.s3).cap, 21);
  await api('PUT', '/api/admin/general', 'adm', { values: { 'academic.cap_hours_low': 9 } });
  try { assert.equal(creditCap(app.db, id.s1).cap, 9); } finally { await api('PUT', '/api/admin/general', 'adm', { values: { 'academic.cap_hours_low': 12 } }); }
  app.db.prepare('DELETE FROM grades WHERE course_id = ?').run(plain);
});

test('المكونات: أوزانها تساوي العلامة الكاملة، والعلامة تُرصد مكوناً مكوناً', async () => {
  const set = (components) => api('PUT', `/api/courses/${course}/components`, 'ex', { components });
  assert.equal((await set([{ name: 'مذاكرة', kind: 'theory', max: 20 }, { name: 'نهائي', kind: 'theory', max: 60 }])).s, 400, 'المجموع 80');
  const ok = await set([{ name: 'مذاكرة', kind: 'theory', max: 20 }, { name: 'عملي', kind: 'practical', max: 20 }, { name: 'نهائي', kind: 'theory', max: 60 }]);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  const [quiz, lab, fin] = ok.j.components;
  const enter = (s, body) => api('POST', `/api/students/${id[s]}/grades`, 'ex', { courseId: course, academicYear: year, ...body });
  assert.equal((await enter('s1', { theory: 70 })).s, 400, 'المقرر ذو المكونات لا يقبل النظري والعملي مباشرة');
  assert.equal((await enter('s1', { components: { [quiz.id]: 25, [lab.id]: 10, [fin.id]: 40 } })).s, 400, 'فوق وزن المكوّن');
  assert.ok((await enter('s1', { components: { [quiz.id]: 15, [lab.id]: 18, [fin.id]: 45 } })).s < 300);
  const g = app.db.prepare('SELECT * FROM grades WHERE student_id = ? AND course_id = ?').get(id.s1, course);
  assert.equal(Number(g.mark), 78); assert.equal(Number(g.theory_mark), 60); assert.equal(Number(g.practical_mark), 18);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS n FROM grade_component_marks WHERE grade_id = ?').get(g.id).n), 3);
  assert.equal((await set([{ name: 'نهائي', kind: 'theory', max: 100 }])).s, 409, 'لا تتغير الأوزان بعد الرصد');
  for (const s of ['s2', 's3']) assert.ok((await enter(s, { components: { [quiz.id]: 10, [lab.id]: 10, [fin.id]: 40 } })).s < 300);
});

test('إعلان النتائج يقفل العلامات، والتعديل بعده بمسار استثنائي وتبرير فقط', async () => {
  const lock = () => api('POST', '/api/grades/results/lock', 'ex', { courseId: course, academicYear: year });
  const r1 = await lock();
  assert.equal(r1.s, 409); assert.match(r1.j.message, /غير معتمدة/);
  app.db.prepare("UPDATE grades SET workflow_status = 'approved' WHERE course_id = ?").run(course);
  assert.equal((await lock()).j.locked, 3);
  assert.equal((await lock()).s, 409);
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE kind = 'results_published' AND user_id = ?").get(id.s1));
  const summary = (await api('GET', `/api/grades/results?year=${encodeURIComponent(year)}`, 'ex')).j.courses.find((c) => c.courseId === course);
  assert.ok(summary.lockedAt);

  const comps = (await api('GET', `/api/courses/${course}/components`, 'ex')).j.components;
  const body = { courseId: course, academicYear: year, components: Object.fromEntries(comps.map((c) => [c.id, Math.min(c.max, 15)])) };
  const blocked = await api('POST', `/api/students/${id.s2}/grades`, 'ex', { ...body, justification: 'خطأ في الجمع' });
  assert.equal(blocked.s, 409); assert.match(blocked.j.message, /قُفلت/);
  const gid = Number(app.db.prepare('SELECT id FROM grades WHERE student_id = ? AND course_id = ?').get(id.s2, course).id);
  assert.equal((await api('POST', '/api/grades/workflow', 'ex', { gradeIds: [gid], stage: 'reviewed', justification: 'مراجعة' })).s, 409, 'لا إعادة فتح بعد القفل');
  assert.equal((await api('DELETE', `/api/students/${id.s2}/grades/${gid}`, 'ex')).s, 409);
  assert.equal((await api('POST', `/api/students/${id.s2}/grades`, 'adm', body)).s, 400, 'المسار الاستثنائي يتطلب تبريراً');
  assert.ok((await api('POST', `/api/students/${id.s2}/grades`, 'adm', { ...body, justification: 'تصحيح خطأ جمع بقرار لجنة الامتحانات' })).s < 300);
  const g = app.db.prepare('SELECT * FROM grades WHERE id = ?').get(gid);
  assert.equal(g.workflow_status, 'approved', 'تبقى معتمدة');
  assert.ok(app.db.prepare("SELECT 1 FROM grade_changes WHERE grade_id = ? AND action = 'تعديل علامة بعد إعلان النتائج' AND justification LIKE '%لجنة%'").get(gid));
});

test('الإعلان عملية واحدة: نقرتان متزامنتان تعطيان نجاحاً وتعارضاً لا خطأ خادم', async () => {
  const yr = '2019/2020';
  for (const s of ['s1', 's2']) app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'برمجة', 3, 70, ?, 1, 1, ?, 70, ?, 'approved')").run(id[s], plain, yr, Date.now());
  const both = await Promise.all([1, 2].map(() => api('POST', '/api/grades/results/lock', 'ex', { courseId: plain, academicYear: yr })));
  assert.deepEqual(both.map((r) => r.s).sort(), [200, 409], JSON.stringify(both.map((r) => r.j)));
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS n FROM grade_locks WHERE course_id = ? AND academic_year = ?').get(plain, yr).n), 1);

  // علامة تُضاف بالمسار الاستثنائي بعد الإعلان تبقى معتمدة كبقية علامات المقرر، فيراها الطالب
  const add = await api('POST', `/api/students/${id.s3}/grades`, 'adm', { courseId: plain, academicYear: yr, theory: 66, justification: 'علامة طالب غاب عن الكشف بقرار لجنة الامتحانات' });
  assert.ok(add.s < 300, JSON.stringify(add.j));
  const g3 = app.db.prepare('SELECT * FROM grades WHERE student_id = ? AND course_id = ? AND academic_year = ?').get(id.s3, plain, yr);
  assert.equal(g3.workflow_status, 'approved');
  assert.ok(g3.approved_by && g3.approved_at);
});

test('إلغاء الإعلان: لمن يملك تعديل النتائج المقفلة وبتبرير، ثم يُعاد الإعلان بالفحوص نفسها', async () => {
  const yr = '2019/2020', unlock = (who, extra = {}) => api('POST', '/api/grades/results/unlock', who, { courseId: plain, academicYear: yr, ...extra });
  assert.equal((await unlock('ex', { justification: 'إعلان قبل الدورة التكميلية' })).s, 403, 'الاعتماد وحده لا يكفي');
  assert.equal((await unlock('adm')).s, 400, 'التبرير مطلوب');
  const ok = await unlock('adm', { justification: 'أُعلن قبل استكمال الدورة التكميلية', decisionNo: '12/ل' });
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.ok(!app.db.prepare('SELECT 1 FROM grade_locks WHERE course_id = ? AND academic_year = ?').get(plain, yr));
  assert.equal((await unlock('adm', { justification: 'مرة ثانية للتجربة' })).s, 409, 'غير معلن');
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'إلغاء إعلان نتائج مقرر وفك قفل علاماته'").get());
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS n FROM grades WHERE course_id = ? AND academic_year = ? AND workflow_status = 'approved'").get(plain, yr).n), 3, 'تبقى معتمدة');
  assert.equal((await api('POST', '/api/grades/results/lock', 'ex', { courseId: plain, academicYear: yr })).s, 200, 'إعادة الإعلان');
});

test('قرار التظلم على مقرر معلن: يتطلب صلاحية تعديل النتائج المقفلة، وتبقى العلامة معتمدة', () => {
  const g = app.db.prepare('SELECT * FROM grades WHERE student_id = ? AND course_id = ? AND academic_year = ?').get(id.s1, plain, '2019/2020');
  const actor = (perms) => ({ id: id.ex, can: (p) => perms.includes(p) });
  assert.throws(() => applyAppealMark(app.db, actor(['grade:approve']), g, 75, 'قبول التظلم بقرار اللجنة'), (e) => e.status === 409 && e.code === 'grades_locked');
  assert.equal(Number(app.db.prepare('SELECT mark FROM grades WHERE id = ?').get(g.id).mark), 70, 'لم تتغير');
  // من لا يملك الاعتماد كان يعيدها مسودة فتختفي من ملف الطالب داخل مقرر مقفل
  const r = applyAppealMark(app.db, actor(['grade:unlock']), g, 75, 'قبول التظلم بقرار اللجنة');
  assert.equal(r.status, 'approved');
  const after = app.db.prepare('SELECT * FROM grades WHERE id = ?').get(g.id);
  assert.equal(Number(after.mark), 75); assert.equal(after.workflow_status, 'approved');
  assert.ok(app.db.prepare("SELECT 1 FROM grade_changes WHERE grade_id = ? AND action = 'تعديل علامة بقرار تظلم بعد إعلان النتائج'").get(g.id));
});

test('الطالب يرى العلامة المعتمدة بعد إعلان نتيجة مقررها فقط، وعلامة المعادلة عند اعتمادها', async () => {
  const yr = '2018/2019', mine = async () => (await api('GET', '/api/me/grades?level=1', 's2')).j.grades;
  const has = (list, y) => list.some((g) => g.academicYear === y || (g.previous || []).some((p) => p.academicYear === y));
  app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 't', 'برمجة', 3, 81, ?, 1, 1, ?, 81, ?, 'approved')").run(id.s2, plain, yr, Date.now());
  assert.ok(!has(await mine(), yr), 'معتمدة غير معلنة: مخفية');
  assert.equal((await api('POST', '/api/grades/results/lock', 'ex', { courseId: plain, academicYear: yr })).s, 200);
  assert.ok(has(await mine(), yr), 'بعد الإعلان تظهر');
  // معادلة نقل: لا عام دراسي اعتيادي ولا إعلان لها
  app.db.prepare("INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, entered_at, workflow_status) VALUES (?, 'الفصل الأول', 'تشفير', 3, 77, ?, 1, 1, 'معادلة نقل', 77, ?, 'approved')").run(id.s3, course, Date.now());
  assert.ok((await api('GET', '/api/me/grades?level=1', 's3')).j.grades.some((g) => Number(g.total) === 77));
});
