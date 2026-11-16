// معالج الحرمان الشامل والرصد السريع للعلامات (كشف المقرر وحفظه دفعة واحدة)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345', DAY = 86400000;
let app, base, ck = {}, id = {}, course, prog;
const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const iso = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-quick-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const user = (u, role, no) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?) RETURNING id').get(u, `user ${u}`, hash, role, no ?? null, now).id); };
  user('adm', 'admin');
  for (const s of ['s1', 's2', 's3', 's4']) {
    user(s, 'student', `QX-${s}`);
    app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'A', 'B', ?, 'D', ?, 'm', '2005-01-01', 'X', 'Y', '0944111222', 'G', 'C', 'A', 'S', 2024, 220, ?, 'general', 2024, 'T1', 1, 'active', 'H', 'F', '0944111222', ?, ?)`).run(id[s], s, `6${String(id[s]).padStart(10, '0')}`, prog, now, now);
  }
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  course = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'Net Security', 'QX-101', 3) RETURNING id").get(prog).id);
  // عشر محاضرات: s1 حضر الكل، s2 ثمانياً (غياب 20%)، s3 تسعاً (10%)، s4 لم يحضر (100%)
  const ins = app.db.prepare("INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, method) VALUES (?, 'course', ?, 'Net Security', 'H1', ?, 'manual')");
  for (let k = 0; k < 10; k++) {
    const at = Date.parse(`${iso(-20 + k * 2)}T07:00:00Z`);
    for (const [s, n] of Object.entries({ s1: 10, s2: 8, s3: 9, s4: 0 })) if (k < n) ins.run(id[s], course, at);
  }
  for (const u of Object.keys(id)) ck[u] = await login(u);
  assert.equal((await api('POST', '/api/teaching/calendar', 'adm', { kind: 'term', startDay: iso(-30), endDay: iso(60) })).s, 201);
});
test.after(async () => { await app.close(); });

test('معالج الحرمان الشامل: يجمع المتجاوزين عبر المقررات ويحرمهم دفعة واحدة', async () => {
  assert.equal((await api('GET', '/api/teaching/absence-overview', 's1')).s, 403, 'الطالب لا يرى المعالج');
  const ov = (await api('GET', '/api/teaching/absence-overview')).j;
  const names = ov.students.map((s) => s.studentNo).sort();
  assert.deepEqual(names, ['QX-s2', 'QX-s4']);
  assert.ok(ov.warnCount >= 1, 's3 بلغ نصف الحد');
  const d = (await api('POST', '/api/teaching/absence-overview/deprive', 'adm', { studentIds: [id.s4] })).j;
  assert.equal(d.deprived, 1);
  assert.equal((await api('GET', '/api/teaching/absence-overview')).j.students.map((s) => s.studentNo).join(), 'QX-s2');
  assert.equal((await api('POST', '/api/teaching/absence-overview/deprive', 'adm', { studentIds: [id.s1] })).s, 400, 's1 غير متجاوز');
});

test('البحث الشامل: نتائج مصنفة بنوعها بحسب الصلاحية، وللموظفين فقط', async () => {
  assert.equal((await api('GET', '/api/search?q=QX-s1', 's1')).s, 403, 'الطالب لا يستعمله');
  assert.deepEqual((await api('GET', '/api/search?q=a')).j.results, [], 'أقل من حرفين لا يُبحث');
  const types = async (q) => (await api('GET', `/api/search?q=${encodeURIComponent(q)}`)).j.results.map((r) => `${r.type}:${r.title}`);
  assert.ok((await types('QX-s1')).some((x) => x.startsWith('student:')), 'طالب بالرقم الجامعي');
  assert.ok((await types('Net Sec')).includes('course:Net Security'), 'مادة');
  const acc = await types('adm');
  assert.ok(acc.some((x) => x.startsWith('account:')), `حساب موظف: ${JSON.stringify(acc)}`);
  const none = (await api('GET', '/api/search?q=zzzz-nothing')).j.results;
  assert.equal(none.length, 0);
});

test('الرصد السريع: كشف المقرر وحفظ دفعة، ويرفض المحروم والقيمة الشاذة دون إيقاف البقية', async () => {
  assert.equal((await api('GET', `/api/courses/${course}/grade-sheet`, 's1')).s, 403);
  const sheet = (await api('GET', `/api/courses/${course}/grade-sheet`)).j;
  assert.equal(sheet.rows.length, 4);
  assert.equal(sheet.rows.find((r) => r.studentId === id.s4).deprived, true);
  assert.ok(sheet.totalMax >= 100 && sheet.passMark > 0);
  const rows = [{ studentId: id.s1, theory: '70' }, { studentId: id.s2, theory: '950' }, { studentId: id.s3, theory: '' }, { studentId: id.s4, theory: '50' }];
  const out = (await api('POST', `/api/courses/${course}/grade-sheet`, 'adm', { year: sheet.year, rows })).j;
  assert.equal(out.saved, 1);
  assert.deepEqual(out.errors.map((e) => e.studentId).sort(), [id.s2, id.s4].sort(), 'الشاذة والمحروم مرفوضان، والفارغ يُتخطى');
  const again = (await api('GET', `/api/courses/${course}/grade-sheet?year=${sheet.year}`)).j;
  assert.equal(again.rows.find((r) => r.studentId === id.s1).theory, 70);
});
