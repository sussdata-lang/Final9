import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { academicYear } from '../server/lib/doc_no.js';

const PW = 'Test#Pass12345';
const DAY = 86400000;
let app, base, ck = {}, id = {}, course, prog;
const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const iso = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const notes = (kind, u) => app.db.prepare('SELECT * FROM user_notifications WHERE kind = ? AND user_id = ?').all(kind, id[u]);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-teach-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const user = (u, role, no) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, no ?? null, now).id); };
  user('adm', 'admin'); user('ins', 'staff'); user('out', 'staff');
  // المدرّس والموظف الآخر بلا صلاحيات خاصة: الدور الافتراضي للموظف يتضمن إدارة المقررات
  app.db.prepare("UPDATE users SET access_mode = 'custom', custom_permissions_json = '[]' WHERE id IN (?, ?)").run(id.ins, id.out);
  for (const s of ['s1', 's2', 's3', 's4']) {
    user(s, 'student', `TCH-${s}`);
    app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'أ', 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id[s], s, `6${String(id[s]).padStart(10, '0')}`, prog, now, now);
  }
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  const member = Number(app.db.prepare("INSERT INTO faculty_members (name, rank, user_id, created_at) VALUES ('د. المدرس', 'مدرس', ?, ?) RETURNING id").get(id.ins, now).id);
  course = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours, member_id) VALUES (?, 1, 1, 'أمن الشبكات', 'TCH-101', 3, ?) RETURNING id").get(prog, member).id);
  // عشر محاضرات في الأيام العشرين الماضية؛ s1 حضر الكل، s2 ثمانياً، s3 تسعاً، s4 لم يحضر
  const attend = { s1: 10, s2: 8, s3: 9, s4: 0 };
  const ins = app.db.prepare("INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, method) VALUES (?, 'course', ?, 'أمن الشبكات', 'ق1', ?, 'manual')");
  for (let k = 0; k < 10; k++) {
    const at = Date.parse(`${iso(-20 + k * 2)}T07:00:00Z`);
    for (const [s, n] of Object.entries(attend)) if (k < n) ins.run(id[s], course, at);
  }
  for (const u of Object.keys(id)) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('التقويم: يضيفه مدير المقررات، وبداية الفصل ونهايته مرة واحدة، ويراه الجميع', async () => {
  assert.equal((await api('POST', '/api/teaching/calendar', 's1', { kind: 'event', startDay: iso(1) })).s, 403);
  assert.equal((await api('POST', '/api/teaching/calendar', 'adm', { kind: 'term', startDay: iso(-30), endDay: iso(60) })).s, 201);
  assert.equal((await api('POST', '/api/teaching/calendar', 'adm', { kind: 'term', startDay: iso(-30), endDay: iso(60) })).s, 409);
  assert.equal((await api('POST', '/api/teaching/calendar', 'adm', { kind: 'exams', title: 'الامتحانات النهائية', startDay: iso(50), endDay: iso(40) })).s, 400);
  assert.equal((await api('POST', '/api/teaching/calendar', 'adm', { kind: 'exams', title: 'الامتحانات النهائية', startDay: iso(40), endDay: iso(55) })).s, 201);
  const cal = (await api('GET', '/api/teaching/calendar', 's1')).j;
  assert.ok(cal.events.some((e) => e.title === 'الامتحانات النهائية'));
});

test('إلغاء المحاضرة وتعويضها: لمدرّس المقرر، ويُبلَّغ طلابه فوراً', async () => {
  const body = { courseId: course, kind: 'cancel', lectureDay: iso(3), start: '10:00', end: '12:00', makeupDay: iso(5), makeupStart: '12:00', makeupEnd: '14:00', makeupHall: 'ق3', reason: 'مشاركة في مؤتمر' };
  assert.equal((await api('POST', '/api/teaching/lecture-changes', 'out', body)).s, 403);
  assert.equal((await api('POST', '/api/teaching/lecture-changes', 'ins', { ...body, makeupEnd: '11:00' })).s, 400);
  const r = await api('POST', '/api/teaching/lecture-changes', 'ins', body);
  assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.notified, 4);
  assert.match(notes('lecture_change', 's1')[0].text, /التعويض/);
  const mine = (await api('GET', '/api/teaching/me', 's2')).j;
  assert.equal(mine.changes.length, 1);
  assert.equal((await api('GET', '/api/teaching/lecture-changes', 'ins')).j.courses.length, 1, 'المدرّس يرى مقرراته فقط');
});

test('الغياب: يُحسب من سجل القاعات داخل الفصل، والتنبيه مرة، والحرمان لمن تجاوز الحد فقط', async () => {
  const r = (await api('GET', `/api/teaching/absence/${course}`, 'ins')).j;
  assert.equal(r.held, 10); assert.equal(r.window.fromCalendar, true);
  const row = (s) => r.rows.find((x) => x.studentId === id[s]);
  assert.equal(row('s1').percent, 0); assert.equal(row('s2').percent, 20); assert.equal(row('s2').overLimit, true);
  assert.equal(row('s3').warn, true); assert.equal(row('s3').overLimit, false); assert.equal(row('s4').percent, 100);
  assert.equal((await api('GET', `/api/teaching/absence/${course}`, 'out')).s, 403);
  assert.equal((await api('POST', `/api/teaching/absence/${course}/warn`, 'ins')).j.warned, 1);
  assert.equal((await api('POST', `/api/teaching/absence/${course}/warn`, 'ins')).j.warned, 0, 'تنبيه واحد في الفصل');
  assert.equal((await api('POST', `/api/teaching/absence/${course}/deprive`, 'ins', { studentIds: [id.s3] })).s, 409);
  assert.equal((await api('POST', `/api/teaching/absence/${course}/deprive`, 'ins', { studentIds: [id.s2, id.s4] })).j.deprived, 2);
  assert.equal(notes('course_deprivation', 's2').length, 1);
  assert.equal((await api('GET', '/api/teaching/me', 's2')).j.absence.find((a) => a.course === 'أمن الشبكات').deprived, true);
});

test('المحروم لا تُرصد له علامة في المقرر حتى يُرفع الحرمان', async () => {
  const grade = (s) => api('POST', `/api/students/${id[s]}/grades`, 'adm', { courseId: course, academicYear: academicYear(), theory: 50, practical: 10 });
  const blocked = await grade('s2');
  assert.equal(blocked.s, 409); assert.match(blocked.j.message, /محروم/);
  assert.ok((await grade('s1')).s < 300);
  const dep = (await api('GET', `/api/teaching/absence/${course}`, 'adm')).j.rows.find((x) => x.studentId === id.s2).deprivationId;
  assert.equal((await api('POST', `/api/teaching/deprivations/${dep}/lift`, 'ins', { reason: 'عذر طبي' })).s, 403, 'الرفع لمدير المقررات');
  assert.equal((await api('POST', `/api/teaching/deprivations/${dep}/lift`, 'adm', { reason: 'عذر طبي مقبول' })).s, 200);
  assert.ok((await grade('s2')).s < 300);
});

test('كشف حضور المحاضرة: المدرّس يؤشّر الحاضرين، فتُحتسب المحاضرة منعقدة ويُحتسب غياب الباقين', async () => {
  const day = iso(-1), roll = (who, d = day) => api('GET', `/api/teaching/rollcall/${course}?day=${d}`, who);
  const save = (present, d = day) => api('POST', `/api/teaching/rollcall/${course}`, 'ins', { day: d, hall: 'ق2', present: present.map((s) => id[s]) });
  const held = async () => (await api('GET', `/api/teaching/absence/${course}`, 'ins')).j;
  const before = (await held()).held;
  assert.equal((await roll('out')).s, 403, 'لمدرّس المقرر أو من يملك صلاحيته');
  assert.equal((await roll('ins', iso(2))).s, 400, 'لا كشف لمحاضرة لم تنعقد');
  const open = (await roll('ins')).j;
  assert.equal(open.saved, false); assert.equal(open.students.length, 4); assert.ok(open.students.every((x) => x.present), 'الكل حاضر افتراضياً');

  const r = await save(['s1']);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.session.present, r.j.session.absent], [1, 3]);
  const h = await held();
  assert.equal(h.held, before + 1, 'المحاضرة منعقدة رغم أن أحداً لم يمسح بطاقته');
  assert.ok(h.rows.find((x) => x.studentId === id.s3).absent > (await held()).rows.find((x) => x.studentId === id.s1).absent);
  // تعديل الكشف: يُضاف حاضر ويبقى عدد السجلات صحيحاً
  assert.deepEqual([(await save(['s1', 's3'])).j.session.present], [2]);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS n FROM hall_logs WHERE course_id = ? AND note = 'كشف حضور المحاضرة'").get(course).n), 2);
  assert.equal((await save(['s1'])).j.session.absent, 3, 'إزالة التأشير تحذف حضوره اليدوي');

  // يوم فيه مسح بطاقات: الماسح حاضر دائماً ولا يُحذف سجله
  const cardDay = iso(-2), c = (await roll('ins', cardDay)).j.students.find((x) => x.studentId === id.s1);
  assert.equal(c.byCard, true);
  const k = await save([], cardDay);
  assert.equal(k.j.session.present, 1, 'من مسح بطاقته يبقى حاضراً');

  // محاضرة سُجّلت بالخطأ
  const del = await api('DELETE', `/api/teaching/rollcall/${course}?day=${day}`, 'ins');
  assert.equal(del.s, 200); assert.equal(del.j.saved, false);
  assert.equal((await held()).held, before, 'لم تعد منعقدة');
  assert.ok(app.db.prepare("SELECT 1 FROM hall_logs WHERE course_id = ? AND method = 'manual' AND note IS NULL").get(course), 'سجلات القاعة الأصلية باقية');
});

test('طلاب المقرر حسب الإعداد: الجمع افتراضياً، أو المسجلون ذاتياً فقط، أو البرنامج والسنة فقط', async () => {
  const { currentTerm } = await import('../server/services/sections.js');
  const now = Date.now(), hash = app.db.prepare('SELECT password_hash h FROM users WHERE id = ?').get(id.s1).h;
  // طالب من سنة أخرى سجّل المقرر ذاتياً: ليس من دفعة المقرر
  id.s5 = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('s5', 'مستخدم s5', ?, 'student', 'TCH-s5', ?) RETURNING id").get(hash, now).id);
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 's5', 'د', '69999999999', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2023, 'الفصل الأول', 2, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id.s5, prog, now, now);
  app.db.prepare("INSERT INTO student_self_enrollments (student_no, student_name, course_code, course_name, semester, registered_at, course_id) VALUES ('TCH-s5', 's5', 'TCH-101', 'أمن الشبكات', ?, ?, ?)").run(currentTerm(app.db), now, course);
  const roster = async () => (await api('GET', `/api/teaching/rollcall/${course}?day=${iso(-3)}`, 'ins')).j.students.map((x) => x.studentId).sort((a, b) => a - b);
  const set = (v) => api('PUT', '/api/admin/general', 'adm', { values: { 'academic.course_roster': v } });
  const cohort = ['s1', 's2', 's3', 's4'].map((s) => id[s]).sort((a, b) => a - b);
  try {
    assert.deepEqual(await roster(), [...cohort, id.s5].sort((a, b) => a - b), 'الافتراضي: المسجل ذاتياً مع الدفعة');
    assert.equal((await set('enrolled')).s, 200);
    assert.deepEqual(await roster(), [id.s5], 'المسجلون ذاتياً فقط');
    assert.equal((await set('program')).s, 200);
    assert.deepEqual(await roster(), cohort, 'البرنامج والسنة فقط');
    assert.equal((await set('غير ذلك')).s, 400, 'قيمة من القائمة فقط');
  } finally { await set('both'); }
});
