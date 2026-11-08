// الاختبارات والتكليفات، المرحلة (أ): الجداول وقيودها، وطبقة التخزين، وفحص الملفات، والفحص قبل الرفع، والنسخ الاحتياطي.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { HttpError, SECURITY_HEADERS } from '../server/http.js';
import { localStorage, sendStored, LMS_ASSIGNMENTS_AREA } from '../server/lib/storage.js';
import { inspectUpload, cleanFilename } from '../server/services/lms_assignment_files.js';
import { createBackup } from '../server/services/backup.js';
import { writeZip, readZip } from '../server/lib/zip.js';

const PW = 'Test#Pass12345', NOW = Date.now(), DAY = 86400000;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64)]);
const CFB = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const DOCX = writeZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'word/document.xml', data: '<w/>' }]);
const PPTX = writeZip([{ name: 'ppt/presentation.xml', data: '<p/>' }]);
const XLSX = writeZip([{ name: 'xl/workbook.xml', data: '<x/>' }]);
const DOCM = writeZip([{ name: 'word/document.xml', data: '<w/>' }, { name: 'word/vbaProject.bin', data: 'x' }]);
const ZIP = writeZip([{ name: 'حل/ملف.txt', data: 'نص' }]);

let app, base, dir, cookie, owner, student, n = 0;
const pgDumpAvailable = (() => { try { execFileSync('pg_dump', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const upload = (buf) => {
  const uploadPath = path.join(dir, `u${++n}`);
  fs.writeFileSync(uploadPath, buf);
  return { uploadPath, size: buf.length, head: buf.subarray(0, 64 * 1024) };
};
const newAssignment = (o = {}) => Number(app.db.prepare('INSERT INTO lms_assignments (title, owner_id, starts_at, due_at, max_score, status, created_at) VALUES (?,?,?,?,?,?,?)')
  .run(o.title ?? 'تكليف', owner, o.starts ?? NOW, o.due ?? NOW + DAY, o.score ?? 100, o.status ?? 'draft', NOW).lastInsertRowid);
const addTarget = (a, type, g = null, p = null, f = null) => app.db.prepare('INSERT INTO lms_assignment_targets (assignment_id, target_type, group_id, program_id, faculty_id, requested_by, created_at) VALUES (?,?,?,?,?,?,?)').run(a, type, g, p, f, owner, NOW);
const addDraft = (a, attempt) => Number(app.db.prepare('INSERT INTO lms_assignment_submissions (assignment_id, student_id, attempt_no, created_at) VALUES (?,?,?,?)').run(a, student, attempt, NOW).lastInsertRowid);
const rejects = (fn, re = /check|unique|duplicate/i) => assert.throws(fn, re);

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-assign-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, no = null) => Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, u, hash, role, no, NOW).lastInsertRowid);
  owner = add('owner', 'staff'); student = add('stu', 'student', 'S-1');
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: PW }) });
  assert.equal(res.status, 200);
  cookie = res.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { await app.close(); });

test('الجداول الجديدة موجودة وآخر الترحيلات مطبّق', () => {
  for (const t of ['lms_assignments', 'lms_assignment_files', 'lms_assignment_targets', 'lms_assignment_submissions', 'lms_assignment_submission_files', 'user_notifications'])
    assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c, 0, t);
  assert.ok(app.db.prepare("SELECT 1 AS x FROM schema_migrations WHERE name = '068_user_notifications.sql'").get());
});

test('قيود الاختبار: الحالة والمواعيد والدرجة والفيديو', () => {
  rejects(() => newAssignment({ status: 'archived' }));
  rejects(() => newAssignment({ due: NOW - DAY }));
  rejects(() => newAssignment({ score: 0 }));
  rejects(() => app.db.prepare("INSERT INTO lms_assignments (title, owner_id, starts_at, due_at, max_score, video_provider, created_at) VALUES ('x',?,?,?,1,'youtube',?)").run(owner, NOW, NOW + DAY, NOW));
  rejects(() => app.db.prepare('INSERT INTO lms_assignments (title, owner_id, starts_at, due_at, max_score, allow_late, late_until, created_at) VALUES (?,?,?,?,1,0,?,?)').run('x', owner, NOW, NOW + DAY, NOW + 2 * DAY, NOW));
  rejects(() => app.db.prepare("INSERT INTO lms_assignments (title, owner_id, starts_at, due_at, max_score, video_provider, video_ref, created_at) VALUES ('x',?,?,?,1,'vimeo','1',?)").run(owner, NOW, NOW + DAY, NOW));
  assert.ok(newAssignment() > 0);
});

test('قيود الجمهور: نوع واحد لكل صف ولا تكرار', () => {
  const a = newAssignment(), program = app.db.prepare('SELECT id FROM programs LIMIT 1').get().id, faculty = app.db.prepare('SELECT id FROM faculties LIMIT 1').get().id;
  const group = Number(app.db.prepare("INSERT INTO student_groups (name, created_at) VALUES ('شعبة أ', ?)").run(NOW).lastInsertRowid);
  addTarget(a, 'group', group); addTarget(a, 'program', null, program); addTarget(a, 'faculty', null, null, faculty); addTarget(a, 'all');
  rejects(() => addTarget(a, 'group', group));
  rejects(() => addTarget(a, 'all'));
  rejects(() => addTarget(newAssignment(), 'group'));
  rejects(() => addTarget(newAssignment(), 'group', group, program));
  rejects(() => addTarget(newAssignment(), 'all', group));
  rejects(() => app.db.prepare("INSERT INTO lms_assignment_targets (assignment_id, target_type, approval_status, requested_by, created_at) VALUES (?, 'all', 'maybe', ?, ?)").run(newAssignment(), owner, NOW));
  app.db.prepare('DELETE FROM student_groups WHERE id = ?').run(group);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM lms_assignment_targets WHERE assignment_id = ?').get(a).c, 3, 'حذف الفئة يحذف هدفها فقط');
});

test('قيود الحلول: مسودة واحدة، ورقم محاولة فريد، والدرجة شرط للتقييم', () => {
  const a = newAssignment(), s = addDraft(a, 1);
  rejects(() => addDraft(a, 2));
  rejects(() => app.db.prepare("UPDATE lms_assignment_submissions SET status = 'submitted' WHERE id = ?").run(s));
  app.db.prepare("UPDATE lms_assignment_submissions SET status = 'submitted', submitted_at = ? WHERE id = ?").run(NOW, s);
  rejects(() => addDraft(a, 1));
  assert.ok(addDraft(a, 2) > s, 'بعد التسليم تصبح مسودة جديدة ممكنة');
  rejects(() => app.db.prepare("UPDATE lms_assignment_submissions SET status = 'graded', graded_at = ? WHERE id = ?").run(NOW, s));
  rejects(() => app.db.prepare('UPDATE lms_assignment_submissions SET score = -1 WHERE id = ?').run(s));
  app.db.prepare("UPDATE lms_assignment_submissions SET status = 'graded', score = 90.5, graded_at = ?, graded_by = ? WHERE id = ?").run(NOW, owner, s);
  assert.equal(app.db.prepare('SELECT score FROM lms_assignment_submissions WHERE id = ?').get(s).score, 90.5);
});

test('الملفات: الدور والنوع محددان، والمفتاح لا يتكرر، وتُحذف مع صاحبها', () => {
  const a = newAssignment(), s = addDraft(a, 1);
  const ins = (file, role = 'student', kind = 'pdf') => app.db.prepare('INSERT INTO lms_assignment_submission_files (submission_id, role, filename, kind, mime, size, file, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(s, role, 'a.pdf', kind, 'application/pdf', 5, file, student, NOW);
  ins('k1'); rejects(() => ins('k1')); rejects(() => ins('k2', 'teacher')); rejects(() => ins('k3', 'student', 'exe'));
  app.db.prepare('DELETE FROM lms_assignments WHERE id = ?').run(a);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM lms_assignment_submission_files WHERE submission_id = ?').get(s).c, 0);
});

test('الإشعار نفسه لا يتكرر، والإشعارات بلا مرجع مسموحة', () => {
  const ins = (ref) => app.db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, at) VALUES (?, 'reminder', ?, 'تذكير', ?)").run(student, ref, NOW);
  ins(7); rejects(() => ins(7)); ins(8); ins(null); ins(null);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM user_notifications').get().c, 4);
});

test('التخزين: حفظ وقراءة جزئية وحذف، واسم عشوائي، ورفض المفاتيح الخطرة', async () => {
  const s = localStorage(path.join(dir, 'store')), t = upload(Buffer.from('0123456789'));
  const key = await s.save(LMS_ASSIGNMENTS_AREA, 'pdf', t.uploadPath);
  assert.match(key, /^lms_assignments\/[a-f0-9]{32}\.pdf$/);
  assert.equal(fs.existsSync(t.uploadPath), false, 'الملف المؤقت نُقل');
  assert.deepEqual(await s.stat(key), { size: 10 });
  const chunks = []; for await (const c of s.read(key, { start: 2, end: 4 })) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), '234');
  await s.delete(key);
  assert.equal(await s.stat(key), null);
  await s.delete(key);
  for (const bad of ['../secret.key', 'lms_assignments/../../x.pdf', 'lms_assignments/abc.pdf', 'a/b/c']) await assert.rejects(async () => s.stat(bad), /مفتاح/, bad);
  await assert.rejects(() => s.save('../up', 'pdf', upload(PDF).uploadPath), /مفتاح/);
  await assert.rejects(() => s.save(LMS_ASSIGNMENTS_AREA, 'p/df', upload(PDF).uploadPath), /مفتاح/);
});

test('فحص الملف: يقبل الأنواع المطلوبة من محتواها', async () => {
  const cases = [[PDF, 'حل.pdf', 'pdf', 'pdf'], [DOCX, 'تقرير.docx', 'word', 'docx'], [PPTX, 'عرض.PPTX', 'powerpoint', 'pptx'], [PNG, 'صورة.png', 'image', 'png'], [ZIP, 'حلول.zip', 'zip', 'zip']];
  for (const [buf, name, kind, ext] of cases) {
    const r = await inspectUpload(upload(buf), name);
    assert.equal(r.kind, kind, name); assert.equal(r.ext, ext, name); assert.equal(r.filename, name); assert.equal(r.size, buf.length);
  }
  assert.equal((await inspectUpload(upload(PDF), 'بدون امتداد')).filename, 'بدون امتداد.pdf');
});

test('فحص الملف: يرفض المخالف مهما كان امتداده', async () => {
  const no = (buf, name, opts, re) => assert.rejects(() => inspectUpload(upload(buf), name, opts), re, name);
  await no(EXE, 'حل.pdf', undefined, /غير مدعوم/);
  await no(SVG, 'شكل.svg', undefined, /غير مدعوم/);
  await no(Buffer.from('نص عادي طويل بما يكفي'), 'ملف.docx', undefined, /غير مدعوم/);
  await no(CFB, 'قديم.doc', undefined, /القديمة/);
  await no(DOCM, 'ماكرو.docx', undefined, /ماكرو/);
  await no(XLSX, 'جدول.xlsx', undefined, /Excel/);
  await no(PDF, 'مزور.docx', undefined, /لا يطابق/);
  await no(DOCX, 'مزور.pdf', undefined, /لا يطابق/);
  await no(Buffer.alloc(0), 'فارغ.pdf', undefined, /فارغ/);
  await no(PDF, 'حل.pdf', { allowed: ['image'] }, /غير مسموح/);
  await no(Buffer.concat([ZIP.subarray(0, 30), Buffer.alloc(40)]), 'مقطوع.zip', undefined, /تالف/);
  await assert.rejects(() => inspectUpload(upload(PDF), 'كبير.pdf', { maxBytes: 10 }), (e) => e.status === 413);
});

test('اسم الملف ينظَّف من مسارات ورموز خطرة', () => {
  assert.equal(cleanFilename('../../etc/passwd.pdf', 'pdf'), 'etcpasswd.pdf');
  assert.equal(cleanFilename('...', 'pdf'), 'ملف.pdf');
  assert.equal(cleanFilename('a<b>:"c.pdf', 'pdf'), 'abc.pdf');
});

test('البث المحمي: Range وno-store والتنزيل كمرفق', async () => {
  const s = localStorage(path.join(dir, 'store2')), body = Buffer.from('abcdefghij');
  const file = await s.save(LMS_ASSIGNMENTS_AREA, 'mp4', upload(body).uploadPath);
  app.router.add('GET', '/api/__t/file', (c) => sendStored(c.req, c.res, s, { file, mime: 'video/mp4', filename: 'فيديو.mp4', inline: c.query.inline === '1' }, SECURITY_HEADERS));
  const get = (range, q = '') => fetch(`${base}/api/__t/file${q}`, { headers: { Cookie: cookie, ...(range ? { Range: range } : {}) } });
  const full = await get();
  assert.equal(full.status, 200); assert.equal(await full.text(), 'abcdefghij');
  assert.equal(full.headers.get('cache-control'), 'no-store');
  assert.match(full.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/);
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  const part = await get('bytes=2-5');
  assert.equal(part.status, 206); assert.equal(await part.text(), 'cdef'); assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  const open = await get('bytes=7-');
  assert.equal(open.status, 206); assert.equal(await open.text(), 'hij');
  const last = await get('bytes=-2');
  assert.equal(last.status, 206); assert.equal(await last.text(), 'ij');
  const beyond = await get('bytes=50-60');
  assert.equal(beyond.status, 416); assert.equal(beyond.headers.get('content-range'), 'bytes */10');
  assert.match((await get(null, '?inline=1')).headers.get('content-disposition'), /^inline;/);
});

test('الفحص قبل الرفع: المرفوض لا يكتب شيئاً على القرص، والمقبول يصل للمعالج', async () => {
  const incoming = path.join(app.cfg.uploadDir, '.incoming'), listing = () => (fs.existsSync(incoming) ? fs.readdirSync(incoming) : []);
  let reached = 0, checks = 0;
  app.router.add('POST', '/api/__t/up/:id', (c) => { reached++; c.json(201, { size: c.body.size, exists: fs.existsSync(c.body.uploadPath) }); }, {
    upload: true, maxBody: 1024 * 1024,
    preUpload: (c) => { checks++; assert.equal(c.user.username, 'owner'); if (c.params.id === 'no') throw new HttpError(403, 'غير مستهدف.', 'forbidden'); },
  });
  const send = (id, headers = { Cookie: cookie }) => fetch(`${base}/api/__t/up/${id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(256 * 1024) });
  const before = listing().length;
  const denied = await send('no');
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'forbidden');
  assert.equal(reached, 0); assert.equal(listing().length, before);
  checks = 0;
  const anon = await send('yes', {});
  assert.equal(anon.status, 401); assert.equal(checks, 0, 'لا فحص قبل التحقق من الجلسة');
  const ok = await send('yes');
  assert.equal(ok.status, 201);
  assert.deepEqual(await ok.json(), { size: 256 * 1024, exists: true });
  assert.equal(reached, 1);
  // التنظيف يأتي بعد إرسال الرد
  for (let i = 0; i < 100 && listing().length > before; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(listing().length, before, 'الملف المؤقت يُنظَّف بعد الطلب');
});

test('النسخة اليومية تستثني ملفات الاختبارات والملفات قيد الرفع وتبقي غيرها', { skip: !pgDumpAvailable && 'pg_dump غير متوفر' }, async () => {
  const up = app.cfg.uploadDir, put = (rel) => { const f = path.join(up, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); };
  put(`${LMS_ASSIGNMENTS_AREA}/a.pdf`); put('.incoming/temp'); put('news/keep.png');
  const r = await createBackup(app, { reason: 'manual' });
  const names = [...readZip(fs.readFileSync(path.join(app.cfg.backupDir, r.name)), { maxTotal: 1 << 30, maxEntries: 5000 }).keys()];
  assert.ok(names.some((x) => x.endsWith('news/keep.png')));
  assert.ok(!names.some((x) => x.includes(`up/${LMS_ASSIGNMENTS_AREA}/`)));
  assert.ok(!names.some((x) => x.includes('up/.incoming/')));
});
