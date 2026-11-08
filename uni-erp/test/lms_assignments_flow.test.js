// الاختبارات والتكليفات، المراحل (ج–و): الجمهور والنشر، والتسليم، والحلول والتصدير، والإشعارات.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { readZip } from '../server/lib/zip.js';
import { runAssignmentTick } from '../server/services/lms_assignment_notify.js';

const PW = 'Test#Pass12345', HOUR = 3600000, BASE = '/api/lms/assignments';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(300)]);
let app, base, dir, P1, P2, F2, group, otherGroup, ids = {}, c = {}, nat = 10000000000;

async function call(method, url, { body, cookie, raw } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* ثنائي */ }
  return { status: res.status, json, buf, headers: res.headers };
}
const now = () => Date.now();
const form = (o = {}) => ({ kind: 'assignment', title: 'تكليف', description: '', instructions: '', startsAt: now() - HOUR, dueAt: now() + 48 * HOUR, maxScore: 100, submissionMode: 'both', allowedTypes: ['pdf', 'image'], maxFileMb: 1, maxFiles: 2, maxAttempts: 1, allowEdit: false, allowLate: false, ...o });
const draft = async (o, cookie = c.teacher) => { const r = await call('POST', BASE, { cookie, body: form(o) }); assert.equal(r.status, 201, r.json?.message); return r.json.assignment; };
const setTargets = (id, targets, cookie = c.teacher) => call('PUT', `${BASE}/${id}/targets`, { cookie, body: { targets } });
async function published(o, targets = [{ type: 'group', id: group }]) {
  const a = await draft(o); assert.equal((await setTargets(a.id, targets)).status, 200);
  const r = await call('POST', `${BASE}/${a.id}/publish`, { cookie: c.teacher }); assert.equal(r.status, 200, r.json?.message);
  return r.json.assignment;
}
const sees = async (cookie, id) => (await call('GET', `${BASE}/mine`, { cookie })).json.assignments.some((x) => x.id === id);
const submit = (id, text, cookie = c.inGroup) => call('POST', `${BASE}/${id}/submission/submit`, { cookie, body: { text } });
const upload = (id, raw = PDF, name = 'حل.pdf', cookie = c.inGroup) => call('POST', `${BASE}/${id}/submission/files?name=${encodeURIComponent(name)}`, { cookie, raw });
const dueIn = (id, ms, extra = '') => app.db.prepare(`UPDATE lms_assignments SET starts_at = ?, due_at = ? ${extra} WHERE id = ?`).run(now() - 72 * HOUR, now() + ms, id);
const inbox = (uid, kind, ref) => Number(app.db.prepare('SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ? AND kind = ? AND ref_id = ?').get(uid, kind, ref).c);
const incoming = () => { const d = path.join(app.cfg.uploadDir, '.incoming'); return fs.existsSync(d) ? fs.readdirSync(d).length : 0; };

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-assign-c-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const db = app.db, hash = await hashPassword(PW, 1024), t = now();
  const programs = db.prepare('SELECT id, faculty_id FROM programs WHERE faculty_id IS NOT NULL ORDER BY id LIMIT 2').all();
  P1 = programs[0].id; P2 = programs[1].id; F2 = programs[1].faculty_id;
  const add = (u, role, perms = null, no = null) => { ids[u] = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, student_no, created_at) VALUES (?,?,?,?,?,?,?,?)').run(u, `اسم ${u}`, hash, role, perms ? 'custom' : 'role', perms ? JSON.stringify(perms) : null, no, t).lastInsertRowid); return ids[u]; };
  const faculty = (uid, name, program) => { const m = Number(db.prepare("INSERT INTO faculty_members (name, rank, status, user_id, created_at) VALUES (?, 'أستاذ', 'active', ?, ?)").run(name, uid, t).lastInsertRowid); db.prepare('INSERT INTO courses (program_id, level, semester, name, code, member_id) VALUES (?, 1, 1, ?, ?, ?)').run(program, name, name, m); };
  const student = (u, no, program) => {
    const uid = add(u, 'student', null, no);
    db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, ?, 'أحمد', 'العلي', 'سعاد', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944000000', 'دمشق', 'دمشق', 'شارع', 'علمي', 2023, 200, ?, 'عام', 2023, 'الأول', 1, 'أب', 'الأب', '0933000000', ?, ?)`).run(uid, `طالب${no}`, String(nat++), program, t, t);
    return uid;
  };
  faculty(add('teacher', 'staff', ['lms_lib:write']), 'NET-A', P1); faculty(add('teacher2', 'staff', ['lms_lib:write']), 'NET-B', P2);
  add('approver', 'staff', ['lms_lib:approve']);
  student('in_group', 'S1', P1); student('out_group', 'S2', P1); student('other_prog', 'S3', P2); student('suspended', 'S4', P1);
  db.prepare("UPDATE student_profiles SET status = 'suspended' WHERE user_id = ?").run(ids.suspended);
  const newGroup = (name, program) => Number(db.prepare('INSERT INTO student_groups (name, program_id, created_at) VALUES (?,?,?)').run(name, program, t).lastInsertRowid);
  group = newGroup('شعبة 1', P1); otherGroup = newGroup('شعبة 2', P2);
  db.prepare('INSERT INTO student_group_members (group_id, student_id, added_at) VALUES (?,?,?)').run(group, ids.in_group, t);
  const login = async (u) => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); assert.equal(r.status, 200, u); return r.headers.get('set-cookie').split(';')[0]; };
  c = { teacher: await login('teacher'), teacher2: await login('teacher2'), approver: await login('approver'), inGroup: await login('in_group'), outGroup: await login('out_group'), otherProg: await login('other_prog') };
});
test.after(async () => { await app.close(); });

test('حساب المستهدفين وقت العرض: الفئة والبرنامج والجديد يظهر له تلقائياً', async () => {
  const a = await published({ title: 'للشعبة' });
  assert.equal(a.audienceCount, 1); assert.equal(await sees(c.inGroup, a.id), true); assert.equal(await sees(c.outGroup, a.id), false);
  app.db.prepare('INSERT INTO student_group_members (group_id, student_id, added_at) VALUES (?,?,?)').run(group, ids.out_group, now());
  assert.equal(await sees(c.outGroup, a.id), true, 'من يُضاف لاحقاً يراه دون نسخ قوائم');
  app.db.prepare('DELETE FROM student_group_members WHERE group_id = ? AND student_id = ?').run(group, ids.out_group);
  const b = await published({ title: 'للبرنامج' }, [{ type: 'program', id: P1 }]);
  assert.equal(b.audienceCount, 2, 'الموقوف قيده لا يُحسب');
  assert.equal(await sees(c.otherProg, b.id), false);
});

test('النطاق: خارج مقرراته مرفوض، والواسع معلّق حتى يُعتمد', async () => {
  const a = await draft();
  assert.equal((await setTargets(a.id, [{ type: 'program', id: P2 }])).status, 403);
  assert.equal((await setTargets(a.id, [{ type: 'group', id: otherGroup }])).status, 403);
  assert.equal((await setTargets(a.id, [{ type: 'group', id: 999999 }])).status, 400);
  assert.equal((await setTargets(a.id, [{ type: 'group', id: group }], c.teacher2)).status, 404);
  const wide = await setTargets(a.id, [{ type: 'faculty', id: F2 }]);
  assert.equal(wide.json.assignment.targets[0].approval, 'pending');
  assert.equal(wide.json.assignment.audienceCount, 0);
  assert.equal((await call('POST', `${BASE}/${a.id}/publish`, { cookie: c.teacher })).status, 200);
  assert.equal(await sees(c.otherProg, a.id), false, 'المعلّق لا يظهر');
  const pending = (await call('GET', BASE, { cookie: c.approver })).json;
  assert.equal(pending.canAuthor, false);
  const req = pending.approvals.find((t) => t.assignmentId === a.id);
  assert.equal((await call('POST', `${BASE}/targets/${req.id}/decide`, { cookie: c.teacher, body: { approve: true } })).status, 403);
  assert.equal((await call('POST', `${BASE}/targets/${req.id}/decide`, { cookie: c.approver, body: { approve: true } })).status, 200);
  assert.equal((await call('POST', `${BASE}/targets/${req.id}/decide`, { cookie: c.approver, body: { approve: true } })).status, 409);
  assert.equal(await sees(c.otherProg, a.id), true);
  assert.equal(inbox(ids.other_prog, 'assign_new', a.id), 1, 'يصله الإشعار عند الاعتماد');
});

test('النشر يتطلب جمهوراً، والنقل يبقي للطالب حله', async () => {
  const a = await draft();
  assert.equal((await call('POST', `${BASE}/${a.id}/publish`, { cookie: c.teacher })).status, 400);
  const b = await published({ title: 'للنقل' });
  assert.equal((await submit(b.id, 'حلي')).status, 200);
  const newG = Number(app.db.prepare("INSERT INTO student_groups (name, program_id, created_at) VALUES ('شعبة منقولة', ?, ?)").run(P1, now()).lastInsertRowid);
  assert.equal((await setTargets(b.id, [{ type: 'group', id: newG }])).status, 200);
  assert.equal(await sees(c.inGroup, b.id), true, 'سلّم فيبقى له');
  const c2 = await published({ title: 'نقل دون تسليم' });
  await setTargets(c2.id, [{ type: 'group', id: newG }]);
  assert.equal((await call('GET', `${BASE}/${c2.id}/submission`, { cookie: c.inGroup })).status, 404);
});

test('الجدولة: لا يظهر قبل موعده، والمهمة تنشره مرة واحدة وتشعر الطلاب', async () => {
  const a = await published({ title: 'مجدول', startsAt: now() + 2 * HOUR, dueAt: now() + 80 * HOUR });
  assert.equal(a.status, 'scheduled'); assert.equal(await sees(c.inGroup, a.id), false);
  assert.equal(inbox(ids.in_group, 'assign_new', a.id), 0);
  runAssignmentTick(app, now() + 3 * HOUR);
  assert.equal(app.db.prepare('SELECT status FROM lms_assignments WHERE id = ?').get(a.id).status, 'published');
  assert.equal(inbox(ids.in_group, 'assign_new', a.id), 1);
  runAssignmentTick(app, now() + 3 * HOUR);
  assert.equal(inbox(ids.in_group, 'assign_new', a.id), 1, 'لا تكرار');
});

test('التذكير قبل 24 ساعة مرة واحدة ولمن لم يسلّم فقط', async () => {
  const a = await published({ title: 'قريب', dueAt: now() + 5 * HOUR });
  await setTargets(a.id, [{ type: 'program', id: P1 }]);
  assert.equal((await submit(a.id, 'سلّمت')).status, 200);
  runAssignmentTick(app); runAssignmentTick(app);
  assert.equal(inbox(ids.in_group, 'assign_reminder', a.id), 0);
  assert.equal(inbox(ids.out_group, 'assign_reminder', a.id), 1);
  const far = await published({ title: 'بعيد', dueAt: now() + 100 * HOUR });
  runAssignmentTick(app);
  assert.equal(inbox(ids.in_group, 'assign_reminder', far.id), 0);
});

test('طالب غير مستهدف لا يفتح الاختبار ولا مرفقه ولا يرفع إليه', async () => {
  const a = await draft({ title: 'سري' });
  const att = await call('POST', `${BASE}/${a.id}/attachments?name=${encodeURIComponent('أ.pdf')}`, { cookie: c.teacher, raw: PDF });
  await setTargets(a.id, [{ type: 'group', id: group }]);
  await call('POST', `${BASE}/${a.id}/publish`, { cookie: c.teacher });
  const url = `${BASE}/files/attachment/${att.json.id}`, before = incoming();
  assert.equal((await call('GET', url, { cookie: c.inGroup })).status, 200);
  assert.equal((await call('GET', url, { cookie: c.outGroup })).status, 404);
  assert.equal((await call('GET', `${BASE}/${a.id}/submission`, { cookie: c.outGroup })).status, 404);
  assert.equal((await upload(a.id, PDF, 'x.pdf', c.outGroup)).status, 404);
  assert.equal((await submit(a.id, 'x', c.outGroup)).status, 404);
  assert.equal(incoming(), before, 'لم يُكتب شيء');
  assert.equal((await call('GET', `${BASE}/${a.id}/submission`, { cookie: c.teacher })).status, 403);
});

test('منع التسليم بعد الموعد في الخادم، والتأخر حسب الإعدادات', async () => {
  const closed = await published({ title: 'فات' }); dueIn(closed.id, -10 * 60000);
  const r = await submit(closed.id, 'متأخر');
  assert.equal(r.status, 409); assert.equal(r.json.error, 'assignment_deadline');
  assert.equal((await upload(closed.id)).status, 409);
  const lateOk = await published({ title: 'يقبل التأخر', allowLate: true }); dueIn(lateOk.id, -10 * 60000);
  const l = await submit(lateOk.id, 'متأخر مقبول');
  assert.equal(l.status, 200); assert.equal(l.json.isLate, true);
  const lateEnded = await published({ title: 'انتهى التأخر', allowLate: true, lateUntil: now() + 72 * HOUR });
  app.db.prepare('UPDATE lms_assignments SET starts_at = ?, due_at = ?, late_until = ? WHERE id = ?').run(now() - 72 * HOUR, now() - 2 * HOUR, now() - HOUR, lateEnded.id);
  assert.equal((await submit(lateEnded.id, 'x')).status, 409);
  const grace = await published({ title: 'مهلة' }); dueIn(grace.id, -20000);
  const g = await submit(grace.id, 'في المهلة');
  assert.equal(g.status, 200); assert.equal(g.json.isLate, false);
  const shut = await published({ title: 'أُغلق' });
  await call('POST', `${BASE}/${shut.id}/close`, { cookie: c.teacher });
  assert.equal((await submit(shut.id, 'x')).status, 409);
  await call('POST', `${BASE}/${shut.id}/reopen`, { cookie: c.teacher });
  assert.equal((await submit(shut.id, 'x')).status, 200);
});

test('رفض الملفات المخالفة حسب إعدادات الاختبار', async () => {
  const a = await published({ title: 'ملفات', allowedTypes: ['pdf'], maxFiles: 1, maxFileMb: 1 });
  assert.equal((await upload(a.id, EXE)).status, 400);
  assert.match((await upload(a.id, PNG, 'صورة.png')).json.message, /غير مسموح/);
  assert.equal((await upload(a.id, PDF, 'مزور.docx')).status, 400);
  assert.equal((await upload(a.id, Buffer.concat([PDF, Buffer.alloc(1048576)]))).status, 413);
  assert.equal((await upload(a.id)).status, 201);
  assert.match((await upload(a.id)).json.message, /الحد الأقصى/);
  const t = await published({ title: 'نصي', submissionMode: 'text', allowedTypes: [] });
  assert.match((await upload(t.id)).json.message, /نصياً/);
});

test('نوع الحل، وعدد المحاولات، وتعديل الحل قبل الموعد', async () => {
  const f = await published({ title: 'ملفات إلزامية', submissionMode: 'files' });
  assert.equal((await submit(f.id, 'نص لا يكفي')).status, 400);
  const one = await published({ title: 'مرة' });
  assert.equal((await submit(one.id, 'أولى')).status, 200);
  const again = await submit(one.id, 'ثانية');
  assert.equal(again.status, 409); assert.equal(again.json.error, 'no_attempts_left');
  const two = await published({ title: 'مرتان', maxAttempts: 2 });
  await submit(two.id, 'أولى'); await submit(two.id, 'ثانية');
  assert.equal((await call('GET', `${BASE}/${two.id}/submission`, { cookie: c.inGroup })).json.attemptsUsed, 2);
  const e = await published({ title: 'تعديل', allowEdit: true, submissionMode: 'files' });
  const up = await upload(e.id);
  assert.equal((await submit(e.id, '')).status, 200);
  const d = (await call('GET', `${BASE}/${e.id}/submission`, { cookie: c.inGroup })).json;
  assert.equal(d.work.mode, 'edit'); assert.equal(d.attemptsUsed, 1);
  assert.equal((await call('DELETE', `${BASE}/${e.id}/submission/files/${up.json.id}`, { cookie: c.inGroup })).status, 400, 'لا يصبح الحل المسلَّم فارغاً');
  const ed = await published({ title: 'تعديل نص', allowEdit: true });
  await submit(ed.id, 'قبل');
  const edited = await submit(ed.id, 'بعد');
  assert.equal(edited.json.edited, true);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM lms_assignment_submissions WHERE assignment_id = ?').get(ed.id).c, 1);
  dueIn(ed.id, -10 * 60000);
  assert.equal((await submit(ed.id, 'بعد الموعد')).status, 409);
});

test('الطلاب المتزامنون: لا تتكرر محاولة ولا مسودة', async () => {
  const a = await published({ title: 'تزامن' });
  const all = await Promise.all(Array.from({ length: 6 }, () => submit(a.id, 'متزامن')));
  assert.equal(all.filter((r) => r.status === 200).length, 1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM lms_assignment_submissions WHERE assignment_id = ?').get(a.id).c, 1);
});

async function withSolution(o = {}) {
  const a = await published({ title: 'للتقييم', ...o });
  const up = await upload(a.id);
  assert.equal(up.status, 201, up.json?.message);
  const r = await submit(a.id, 'نص الحل');
  return { a, sid: r.json.submissionId, fid: up.json.id };
}

test('عضو هيئة آخر لا يرى حلول غيره ولا ملفاتها، والطالب الآخر كذلك', async () => {
  const { a, sid, fid } = await withSolution();
  const file = `${BASE}/files/submission/${fid}`;
  assert.equal((await call('GET', `${BASE}/${a.id}/submissions`, { cookie: c.teacher2 })).status, 404);
  assert.equal((await call('GET', `${BASE}/submissions/${sid}`, { cookie: c.teacher2 })).status, 404);
  assert.equal((await call('POST', `${BASE}/submissions/${sid}/grade`, { cookie: c.teacher2, body: { score: 1 } })).status, 404);
  assert.equal((await call('GET', `${BASE}/${a.id}/submissions.zip`, { cookie: c.teacher2 })).status, 404);
  assert.equal((await call('GET', `${BASE}/${a.id}/grades.csv`, { cookie: c.teacher2 })).status, 404);
  assert.equal((await call('GET', file, { cookie: c.teacher2 })).status, 404);
  assert.equal((await call('GET', file, { cookie: c.outGroup })).status, 404);
  assert.equal((await call('GET', `${BASE}/${a.id}/submissions`, { cookie: c.inGroup })).status, 403);
  assert.equal((await call('GET', file, { cookie: c.inGroup })).status, 200);
  assert.equal((await call('GET', file, { cookie: c.teacher })).status, 200);
});

test('الإحصاءات والبحث والفلترة وتقسيم الصفحات', async () => {
  const a = await published({ title: 'جدول' }, [{ type: 'program', id: P1 }]);
  await submit(a.id, 'حل');
  const list = (q = '') => call('GET', `${BASE}/${a.id}/submissions${q}`, { cookie: c.teacher });
  const d = (await list()).json;
  assert.deepEqual({ t: d.stats.targeted, s: d.stats.submitted, m: d.stats.missing }, { t: 2, s: 1, m: 1 });
  assert.equal(d.total, 2);
  assert.equal((await list('?status=missing')).json.rows[0].studentNo, 'S2');
  assert.equal((await list('?status=submitted')).json.rows[0].studentNo, 'S1');
  assert.equal((await list('?q=S2')).json.total, 1);
  assert.equal((await list(`?q=${encodeURIComponent('طالبS1')}`)).json.total, 1);
  assert.equal((await list(`?q=${encodeURIComponent('%')}`)).json.total, 0, 'رمز البدل يُعامل حرفياً');
  assert.equal((await list(`?q=${encodeURIComponent("%' OR 1=1 --")}`)).status, 403, 'جدار الحماية يرفض محاولة الحقن');
  const p = (await list('?size=1&page=2')).json;
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0].studentNo, 'S2');
});

test('التقييم: حدود الدرجة، والطالب يرى درجته وملف التصحيح بعد الرصد فقط، وإشعاراته', async () => {
  const { a, sid } = await withSolution({ maxScore: 50 });
  const before = (await call('GET', `${BASE}/${a.id}/submission`, { cookie: c.inGroup })).json.submissions[0];
  assert.equal(before.score, null);
  assert.equal(inbox(ids.teacher, 'assign_submission', sid), 1);
  const grade = (score) => call('POST', `${BASE}/submissions/${sid}/grade`, { cookie: c.teacher, body: { score, feedback: 'جيد' } });
  assert.equal((await grade(51)).status, 400); assert.equal((await grade(-1)).status, 400); assert.equal((await grade('')).status, 400);
  const fb = await call('POST', `${BASE}/submissions/${sid}/feedback-file?name=${encodeURIComponent('تصحيح.pdf')}`, { cookie: c.teacher, raw: PDF });
  assert.equal(fb.status, 201);
  const fileUrl = `${BASE}/files/submission/${fb.json.id}`;
  assert.equal((await call('GET', fileUrl, { cookie: c.inGroup })).status, 404, 'لا يصل لملف التصحيح قبل الرصد');
  assert.equal((await grade(45.5)).status, 200);
  const s = (await call('GET', `${BASE}/${a.id}/submission`, { cookie: c.inGroup })).json;
  assert.equal(s.state, 'graded'); assert.equal(s.submissions[0].score, 45.5); assert.equal(s.submissions[0].feedback, 'جيد'); assert.equal(s.submissions[0].feedbackFiles.length, 1);
  assert.equal((await call('GET', fileUrl, { cookie: c.inGroup })).status, 200);
  assert.equal(inbox(ids.in_group, 'assign_grade', sid), 1);
  await grade(46);
  assert.equal(inbox(ids.in_group, 'assign_grade', sid), 1, 'تعديل الدرجة لا يكرر الإشعار');
  assert.equal((await call('POST', `${BASE}/${a.id}/copy`, { cookie: c.teacher })).status, 201);
  const del = await call('DELETE', `${BASE}/${a.id}`, { cookie: c.teacher });
  assert.equal(del.status, 409);
});

test('ZIP بالبث يحوي آخر حل لكل طالب بأسماء آمنة', async () => {
  const { a } = await withSolution({ title: 'أرشيف' });
  const r = await call('GET', `${BASE}/${a.id}/submissions.zip`, { cookie: c.teacher });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/zip'); assert.equal(r.headers.get('content-length'), null, 'يُبث دون حجم مسبق');
  const z = readZip(r.buf, { maxTotal: 1 << 26, maxEntries: 100 }), names = [...z.keys()];
  const pdf = names.find((n) => n.endsWith('حل.pdf'));
  assert.ok(pdf && pdf.startsWith('S1 - ')); assert.ok(z.get(pdf).equals(PDF));
  assert.equal(z.get(names.find((n) => n.endsWith('.txt'))).toString(), 'نص الحل');
  assert.ok(names.every((n) => !n.includes('..') && !n.startsWith('/')));
});

test('CSV: ‏BOM وترميز عربي، وتحييد الخلايا التي تبدأ برمز صيغة', async () => {
  const { a, sid } = await withSolution({ title: 'درجات' });
  await call('POST', `${BASE}/submissions/${sid}/grade`, { cookie: c.teacher, body: { score: 90, feedback: '=HYPERLINK("http://evil","x")' } });
  const r = await call('GET', `${BASE}/${a.id}/grades.csv?tzo=-180`, { cookie: c.teacher });
  assert.equal(r.status, 200);
  assert.deepEqual([...r.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = r.buf.toString('utf8');
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(text, /الرقم الجامعي/); assert.match(text, /طالبS1 أحمد العلي/); assert.match(text, /تم التقييم/);
  assert.match(text, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/);
});

test('الإشعارات: عند النشر والتوسيع دون تكرار، وكل مستخدم يقرأ إشعاراته فقط', async () => {
  const a = await published({ title: 'إشعار' });
  assert.equal(inbox(ids.in_group, 'assign_new', a.id), 1); assert.equal(inbox(ids.out_group, 'assign_new', a.id), 0);
  await setTargets(a.id, [{ type: 'group', id: group }, { type: 'program', id: P1 }]);
  assert.equal(inbox(ids.in_group, 'assign_new', a.id), 1, 'لا يتكرر'); assert.equal(inbox(ids.out_group, 'assign_new', a.id), 1, 'الجديد يصله');
  const list = (await call('GET', '/api/notifications', { cookie: c.outGroup })).json, n = list.items.find((x) => x.kind === 'assign_new' && x.url.endsWith(`id=${a.id}`));
  assert.ok(n && !n.read); assert.ok(list.unread >= 1);
  await call('POST', '/api/notifications/read', { cookie: c.inGroup, body: { ids: [n.id] } });
  assert.equal((await call('GET', '/api/notifications', { cookie: c.outGroup })).json.items.find((x) => x.id === n.id).read, false, 'لا يقرأ إشعار غيره');
  await call('POST', '/api/notifications/read', { cookie: c.outGroup, body: { ids: [n.id] } });
  assert.equal((await call('GET', '/api/notifications', { cookie: c.outGroup })).json.items.find((x) => x.id === n.id).read, true);
  await call('POST', '/api/notifications/read', { cookie: c.outGroup, body: { all: true } });
  assert.equal((await call('GET', '/api/notifications', { cookie: c.outGroup })).json.unread, 0);
  assert.equal((await call('GET', '/api/notifications')).status, 401);
});

test('عامل الخدمة لا يخزّن ردود API، ورقم الإصدار مُحدَّث', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)[^\n]*return;/);
  assert.match(sw, /req\.method !== 'GET'[^\n]*return;/);
  assert.notEqual(/VERSION = '(v\d+)'/.exec(sw)[1], 'v93');
});
