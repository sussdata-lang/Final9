// الاختبارات والتكليفات، المرحلة (ب): الإنشاء والتعديل والنسخ والحذف، والمرفقات، والفيديو، وحدود الملكية.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { parseVideoLink } from '../server/services/lms_assignments.js';

const PW = 'Test#Pass12345', NOW = Date.now(), HOUR = 3600000;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20)]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(200)]);
const BASE = '/api/lms/assignments';
let app, base, dir, course, otherCourse, ownerId, teacher2Id, teacher, teacher2, unlinked, student, hr;

const form = (o = {}) => ({ kind: 'assignment', title: 'تكليف الشبكات', description: 'وصف', instructions: 'تعليمات', startsAt: NOW + HOUR, dueAt: NOW + 48 * HOUR, maxScore: 100, submissionMode: 'both', allowedTypes: ['pdf', 'word'], maxFileMb: 10, maxFiles: 3, maxAttempts: 2, allowEdit: true, allowLate: false, ...o });
async function call(method, url, { body, cookie, raw, range } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(range ? { Range: range } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* ثنائي */ }
  return { status: res.status, json, buf, headers: res.headers };
}
const create = async (o, cookie = teacher) => { const r = await call('POST', BASE, { cookie, body: form(o) }); assert.equal(r.status, 201, r.json?.message); return r.json.assignment; };
const attach = (id, name = 'ملف.pdf', raw = PDF, cookie = teacher) => call('POST', `${BASE}/${id}/attachments?name=${encodeURIComponent(name)}`, { cookie, raw });
const stored = () => { const d = path.join(app.cfg.uploadDir, 'lms_assignments'); return fs.existsSync(d) ? fs.readdirSync(d).length : 0; };
const incoming = () => { const d = path.join(app.cfg.uploadDir, '.incoming'); return fs.existsSync(d) ? fs.readdirSync(d).length : 0; };

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-assign-b-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, perms = null, no = null) => Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, student_no, created_at) VALUES (?,?,?,?,?,?,?,?)').run(u, u, hash, role, perms ? 'custom' : 'role', perms ? JSON.stringify(perms) : null, no, NOW).lastInsertRowid);
  const member = (uid, name) => Number(app.db.prepare("INSERT INTO faculty_members (name, rank, status, user_id, created_at) VALUES (?, 'أستاذ مساعد', 'active', ?, ?)").run(name, uid, NOW).lastInsertRowid);
  const addCourse = (m, name) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, member_id) VALUES ((SELECT MIN(id) FROM programs), 1, 1, ?, ?, ?)').run(name, name, m).lastInsertRowid);
  ownerId = add('teacher', 'staff', ['lms_lib:write']); teacher2Id = add('teacher2', 'staff', ['lms_lib:write']);
  course = addCourse(member(ownerId, 'أ. أول'), 'NET-1'); otherCourse = addCourse(member(teacher2Id, 'أ. ثان'), 'NET-2');
  add('unlinked', 'staff', ['lms_lib:write']); add('stu', 'student', null, 'S-1'); add('hr', 'staff', ['faculty:manage']);
  const login = async (username) => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) }); assert.equal(r.status, 200, username); return r.headers.get('set-cookie').split(';')[0]; };
  teacher = await login('teacher'); teacher2 = await login('teacher2'); unlinked = await login('unlinked'); student = await login('stu'); hr = await login('hr');
});
test.after(async () => { await app.close(); });

test('عضو الهيئة ينشئ مسودة بالحقول كاملة ومقرره، والأوقات لحظات مطلقة', async () => {
  const a = await create({ courseId: course, videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(a.status, 'draft'); assert.equal(a.ownerId, ownerId); assert.equal(a.courseName, 'NET-1');
  assert.equal(a.startsAt, NOW + HOUR); assert.deepEqual(a.allowedTypes, ['pdf', 'word']); assert.equal(a.maxFileMb, 10);
  assert.equal(a.video.embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(typeof app.db.prepare('SELECT due_at FROM lms_assignments WHERE id = ?').get(a.id).due_at, 'number');
  assert.ok(app.db.prepare("SELECT 1 AS x FROM audit_log WHERE action = 'إنشاء اختبار أو تكليف'").get());
});

test('الإنشاء لعضو هيئة مرتبط فقط', async () => {
  assert.equal((await call('POST', BASE, { cookie: unlinked, body: form() })).status, 403);
  assert.equal((await call('POST', BASE, { cookie: student, body: form() })).status, 403);
  assert.equal((await call('POST', BASE, { cookie: hr, body: form() })).status, 403);
  assert.equal((await call('POST', BASE, { body: form() })).status, 401);
  assert.equal((await call('GET', BASE, { cookie: student })).status, 403);
});

test('رفض المدخلات غير الصالحة في الخادم', async () => {
  const bad = async (o) => { const r = await call('POST', BASE, { cookie: teacher, body: form(o) }); assert.equal(r.status, 400, JSON.stringify(o)); };
  for (const o of [{ title: '  ' }, { kind: 'quiz' }, { dueAt: NOW }, { startsAt: 'غير تاريخ' }, { maxScore: 0 }, { maxScore: 1001 }, { submissionMode: 'voice' }, { allowedTypes: [] }, { allowedTypes: ['exe'] }, { maxFileMb: 21 }, { maxFiles: 6 }, { maxAttempts: 0 }, { courseId: otherCourse }, { allowLate: true, lateUntil: NOW }]) await bad(o);
  assert.deepEqual((await create({ submissionMode: 'text', allowedTypes: [] })).allowedTypes, []);
  const late = await create({ allowLate: false, lateUntil: NOW + 72 * HOUR });
  assert.equal(late.lateUntil, null, 'موعد التأخر يُهمل حين يكون ممنوعاً');
});

test('الفيديو: YouTube وDrive فقط', () => {
  assert.deepEqual(parseVideoLink('https://youtu.be/dQw4w9WgXcQ'), { provider: 'youtube', ref: 'dQw4w9WgXcQ' });
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.deepEqual(parseVideoLink(`https://drive.google.com/file/d/${id}/view?usp=sharing`), { provider: 'drive', ref: id });
  assert.deepEqual(parseVideoLink(`https://drive.google.com/open?id=${id}`), { provider: 'drive', ref: id });
  assert.equal(parseVideoLink('  '), null);
  for (const u of ['http://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/123456789', 'https://evil.example/x.mp4', 'https://drive.google.com/drive/folders/abc', `http://drive.google.com/file/d/${id}/view`, `https://drive.google.com.evil.example/file/d/${id}/view`, 'javascript:alert(1)', 'نص'])
    assert.throws(() => parseVideoLink(u), /غير مدعوم/, u);
});

test('سياسة الأمان تسمح بإطار Drive دون نطاقات أخرى جديدة', async () => {
  const csp = (await call('GET', '/api/health')).headers.get('content-security-policy');
  assert.match(csp, /frame-src [^;]*https:\/\/drive\.google\.com/);
  assert.doesNotMatch(csp, /frame-src [^;]*\*/);
});

test('عضو هيئة آخر لا يرى اختبار غيره ولا يعدّله ولا يرفع إليه ولا يصل لملفه', async () => {
  const a = await create(), up = await attach(a.id);
  assert.equal(up.status, 201);
  const before = incoming(), count = stored(), url = `${BASE}/${a.id}`;
  assert.equal((await call('GET', url, { cookie: teacher2 })).status, 404);
  assert.equal((await call('PUT', url, { cookie: teacher2, body: form() })).status, 404);
  assert.equal((await call('DELETE', url, { cookie: teacher2 })).status, 404);
  assert.equal((await call('POST', `${url}/copy`, { cookie: teacher2 })).status, 404);
  assert.equal((await attach(a.id, 'x.pdf', PDF, teacher2)).status, 404);
  assert.equal((await attach(a.id, 'x.pdf', PDF, student)).status, 403);
  assert.equal(incoming(), before, 'المرفوض لم يكتب ملفاً مؤقتاً'); assert.equal(stored(), count);
  assert.equal((await call('DELETE', `${BASE}/attachments/${up.json.id}`, { cookie: teacher2 })).status, 404);
  for (const c of [teacher2, student, hr]) assert.equal((await call('GET', `${BASE}/files/attachment/${up.json.id}`, { cookie: c })).status, 404);
  assert.equal((await call('GET', `${BASE}/files/attachment/${up.json.id}`)).status, 401);
  assert.equal((await call('GET', BASE, { cookie: teacher2 })).json.assignments.some((x) => x.id === a.id), false);
});

test('القائمة تعرض اختباراته ومقرراته فقط', async () => {
  const d = (await call('GET', BASE, { cookie: teacher })).json;
  assert.ok(d.assignments.length > 0 && d.assignments.every((x) => x.ownerId === ownerId));
  assert.deepEqual(d.courses.map((c) => c.id), [course]);
});

test('المرفقات: رفع وبث مع Range وحذف، والمخالف مرفوض', async () => {
  const a = await create(), up = await attach(a.id, 'ورقة الأسئلة.pdf');
  assert.equal(up.status, 201); assert.equal(up.json.kind, 'pdf');
  const got = await call('GET', `${BASE}/files/attachment/${up.json.id}`, { cookie: teacher });
  assert.equal(got.status, 200); assert.ok(got.buf.equals(PDF));
  assert.equal(got.headers.get('cache-control'), 'no-store'); assert.match(got.headers.get('content-disposition'), /^inline/);
  const part = await call('GET', `${BASE}/files/attachment/${up.json.id}`, { cookie: teacher, range: 'bytes=0-3' });
  assert.equal(part.status, 206); assert.equal(part.buf.toString(), '%PDF');
  const count = stored();
  const refused = await attach(a.id, 'حل.pdf', EXE);
  assert.equal(refused.status, 400); assert.equal(stored(), count);
  const key = app.db.prepare('SELECT file FROM lms_assignment_files WHERE id = ?').get(up.json.id).file;
  assert.match(key, /^lms_assignments\/[a-f0-9]{32}\.pdf$/, 'الاسم على القرص عشوائي');
  assert.equal((await call('DELETE', `${BASE}/attachments/${up.json.id}`, { cookie: teacher })).status, 200);
  assert.equal(stored(), count - 1);
  assert.equal((await call('GET', `${BASE}/files/attachment/${up.json.id}`, { cookie: teacher })).status, 404);
});

test('حد عدد المرفقات يُطبَّق قبل استلام الملف', async () => {
  const a = await create(), ins = app.db.prepare('INSERT INTO lms_assignment_files (assignment_id, filename, kind, mime, size, file, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 20; i++) ins.run(a.id, 'x.pdf', 'pdf', 'application/pdf', 1, `limit-${a.id}-${i}`, ownerId, NOW);
  const before = incoming(), r = await attach(a.id);
  assert.equal(r.status, 400); assert.match(r.json.message, /20/); assert.equal(incoming(), before);
});

test('التعديل يحفظ كل الحقول، والمغلق لا يُعدَّل، والدرجة لا تقل عن أعلى مرصود', async () => {
  const a = await create(), url = `${BASE}/${a.id}`;
  const r = await call('PUT', url, { cookie: teacher, body: form({ title: 'عنوان جديد', kind: 'exam', maxScore: 50, allowLate: true, lateUntil: NOW + 72 * HOUR, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }) });
  assert.equal(r.status, 200);
  assert.equal(r.json.assignment.title, 'عنوان جديد'); assert.equal(r.json.assignment.kind, 'exam'); assert.equal(r.json.assignment.lateUntil, NOW + 72 * HOUR); assert.ok(r.json.assignment.video);
  assert.equal((await call('PUT', url, { cookie: teacher, body: form({ videoUrl: '' }) })).json.assignment.video, null);
  const stu = app.db.prepare("SELECT id FROM users WHERE username = 'stu'").get().id;
  app.db.prepare("INSERT INTO lms_assignment_submissions (assignment_id, student_id, status, submitted_at, score, graded_at, created_at) VALUES (?,?, 'graded', ?, 80, ?, ?)").run(a.id, stu, NOW, NOW, NOW);
  assert.equal((await call('PUT', url, { cookie: teacher, body: form({ maxScore: 70 }) })).status, 400);
  app.db.prepare("UPDATE lms_assignments SET status = 'closed' WHERE id = ?").run(a.id);
  assert.equal((await call('PUT', url, { cookie: teacher, body: form() })).status, 409);
  assert.equal((await attach(a.id)).status, 409);
});

test('النسخ مسودة مستقلة بملفاتها، وحذف الأصل لا يمسها', async () => {
  const a = await create({ title: 'أصل', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }); await attach(a.id, 'أ.pdf');
  app.db.prepare("UPDATE lms_assignments SET status = 'published', published_at = ? WHERE id = ?").run(NOW, a.id);
  app.db.prepare("INSERT INTO lms_assignment_targets (assignment_id, target_type, requested_by, created_at) VALUES (?, 'all', ?, ?)").run(a.id, ownerId, NOW);
  const before = stored(), r = await call('POST', `${BASE}/${a.id}/copy`, { cookie: teacher });
  assert.equal(r.status, 201);
  const c = r.json.assignment;
  assert.equal(c.title, 'نسخة من أصل'); assert.equal(c.status, 'draft'); assert.equal(c.publishedAt, null); assert.ok(c.video); assert.equal(c.files.length, 1);
  assert.equal(stored(), before + 1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM lms_assignment_targets WHERE assignment_id = ?').get(c.id).n, 0, 'الجمهور لا يُنسخ');
  assert.equal((await call('DELETE', `${BASE}/${a.id}`, { cookie: teacher })).status, 200);
  const got = await call('GET', c.files[0].url, { cookie: teacher });
  assert.equal(got.status, 200); assert.ok(got.buf.equals(PDF));
});

test('الحذف يزيل الملفات، ويُرفض بعد وصول حلول', async () => {
  const a = await create(); await attach(a.id);
  const count = stored();
  assert.equal((await call('DELETE', `${BASE}/${a.id}`, { cookie: teacher })).status, 200);
  assert.equal(stored(), count - 1);
  assert.equal((await call('GET', `${BASE}/${a.id}`, { cookie: teacher })).status, 404);
  const b = await create(), stu = app.db.prepare("SELECT id FROM users WHERE username = 'stu'").get().id;
  app.db.prepare("INSERT INTO lms_assignment_submissions (assignment_id, student_id, status, submitted_at, created_at) VALUES (?,?, 'submitted', ?, ?)").run(b.id, stu, NOW, NOW);
  const r = await call('DELETE', `${BASE}/${b.id}`, { cookie: teacher });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'assignment_has_submissions');
});

test('نقل الملكية لمن يدير أعضاء الهيئة فقط وإلى عضو مرتبط', async () => {
  const a = await create(), url = `${BASE}/${a.id}/transfer`;
  assert.equal((await call('POST', url, { cookie: teacher, body: { ownerId: teacher2Id } })).status, 403);
  assert.equal((await call('POST', url, { cookie: hr, body: { ownerId: 999999 } })).status, 400);
  assert.equal((await call('POST', url, { cookie: hr, body: { ownerId: teacher2Id } })).status, 200);
  assert.equal((await call('GET', `${BASE}/${a.id}`, { cookie: teacher })).status, 404);
  assert.equal((await call('GET', `${BASE}/${a.id}`, { cookie: teacher2 })).status, 200);
  assert.equal((await call('GET', `${BASE}/${a.id}`, { cookie: hr })).status, 403, 'نقل الملكية لا يعني رؤية الاختبار');
});
