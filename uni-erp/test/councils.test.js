import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { computeAllowedViews } from '../server/permissions.js';
import { remindOverdueCouncilTasks } from '../server/services/councils.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {}, councilId, meetingId;

const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const notes = (kind, user) => app.db.prepare('SELECT * FROM user_notifications WHERE kind = ? AND user_id = ?').all(kind, id[user]);
const meeting = async (who = 'chair') => (await api('GET', `/api/council-meetings/${meetingId}`, who)).j;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-council-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024);
  for (const [u, role] of [['adm', 'admin'], ['chair', 'staff'], ['sec', 'staff'], ['m1', 'staff'], ['m2', 'staff'], ['m3', 'staff'], ['out', 'staff']]) {
    id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, Date.now()).id);
  }
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of Object.keys(id)) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('التشكيل: بصلاحية إدارة المجالس فقط، والعضو يرى مجلسه وغير العضو لا يعرف بوجوده', async () => {
  assert.ok(computeAllowedViews([], [], 'staff').includes('councils'), 'كل موظف يرى مجالسه');
  assert.equal((await api('POST', '/api/councils', 'out', { name: 'مجلس تجريبي', type: 'faculty' })).s, 403);
  const r = await api('POST', '/api/councils', 'adm', { name: 'مجلس كلية الأمن السيبراني', type: 'faculty', quorumPercent: 50 });
  assert.equal(r.s, 201, JSON.stringify(r.j)); councilId = r.j.id;
  for (const [u, role] of [['chair', 'chair'], ['sec', 'secretary'], ['m1', 'member'], ['m2', 'member'], ['m3', 'member']]) {
    assert.equal((await api('POST', `/api/councils/${councilId}/members`, 'adm', { userId: id[u], role })).s, 201, u);
  }
  assert.equal((await api('POST', `/api/councils/${councilId}/members`, 'adm', { userId: id.out, role: 'chair' })).s, 409, 'رئيس واحد');
  assert.equal((await api('POST', `/api/councils/${councilId}/members`, 'chair', { userId: id.out, role: 'member' })).s, 403, 'التشكيل لمن يملك الصلاحية');
  assert.equal((await api('GET', `/api/councils/${councilId}`, 'out')).s, 404);
  assert.equal((await api('GET', '/api/councils', 'out')).j.councils.length, 0);
  const mine = (await api('GET', '/api/councils', 'm1')).j.councils;
  assert.equal(mine.length, 1); assert.equal(mine[0].myRole, 'member'); assert.equal(mine[0].canManage, false);
  const detail = (await api('GET', `/api/councils/${councilId}`, 'm1')).j;
  assert.equal(detail.members.find((m) => m.userId === id.sec).voting, false, 'أمين السر لا يصوّت');
});

test('الاجتماع: يعدّه رئيس المجلس أو أمين سره، والدعوة تصل الأعضاء', async () => {
  assert.equal((await api('POST', `/api/councils/${councilId}/meetings`, 'm1', { title: 'اجتماع', meetingAt: '2026-12-01T10:00' })).s, 403);
  const r = await api('POST', `/api/councils/${councilId}/meetings`, 'sec', { title: 'الاجتماع الدوري الأول', meetingAt: '2026-12-01T10:00', location: 'قاعة المجلس', items: [{ title: 'معادلة مقررات طالب محوّل' }, { title: 'اعتماد الخطة الدراسية' }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); meetingId = r.j.id;
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/items`, 'sec', { title: 'ما يستجد من أعمال' })).s, 201);
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/schedule`, 'sec')).s, 200);
  for (const u of ['chair', 'm1', 'm2', 'm3', 'sec']) assert.equal(notes('council_meeting', u).length, 1, u);
  assert.equal(notes('council_meeting', 'out').length, 0);
  const item = (await meeting()).items[0];
  assert.equal((await api('POST', `/api/council-items/${item.id}/decide`, 'chair', { outcome: 'approved', votesFor: 1, text: 'موافقة على المعادلة' })).s, 409, 'قبل تسجيل الحضور');
});

test('القرار: النصاب بعد استبعاد المتنحي، والأصوات لا تتجاوز الحاضرين، والتأجيل لا يحتاج نصاباً', async () => {
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/attendance`, 'sec', { present: [id.chair, id.sec, id.m1] })).s, 200);
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/attendance`, 'sec', { present: [id.out] })).s, 400);
  const [first, second, third] = (await meeting()).items;
  assert.equal((await api('POST', `/api/council-items/${first.id}/recuse`, 'm1', { reason: 'صلة قرابة بالطالب' })).s, 200);
  const noQuorum = await api('POST', `/api/council-items/${first.id}/decide`, 'chair', { outcome: 'approved', votesFor: 1, text: 'موافقة على المعادلة' });
  assert.equal(noQuorum.s, 409); assert.match(noQuorum.j.message, /النصاب/);
  assert.equal((await api('POST', `/api/council-items/${first.id}/decide`, 'chair', { outcome: 'deferred', text: 'يؤجل لعدم اكتمال النصاب' })).s, 200);

  assert.equal((await api('POST', `/api/council-items/${second.id}/decide`, 'chair', { outcome: 'approved', votesFor: 3, text: 'اعتماد الخطة' })).s, 400, 'أكثر من الحاضرين المصوتين');
  assert.equal((await api('POST', `/api/council-items/${second.id}/decide`, 'chair', { outcome: 'approved', votesFor: 1, votesAgainst: 1, text: 'اعتماد الخطة' })).s, 400, 'التعادل ليس موافقة');
  assert.equal((await api('POST', `/api/council-items/${second.id}/decide`, 'm1', { outcome: 'approved', votesFor: 2, text: 'اعتماد الخطة' })).s, 403, 'العضو لا يدير الاجتماع');
  const ok = await api('POST', `/api/council-items/${second.id}/decide`, 'chair', { outcome: 'approved', votesFor: 2, text: 'اعتماد الخطة الدراسية المعدلة' });
  assert.equal(ok.s, 200); assert.ok(ok.j.decisionNo);
  assert.equal((await api('POST', `/api/council-items/${second.id}/decide`, 'chair', { outcome: 'rejected', votesAgainst: 2, text: 'تكرار' })).s, 409);
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/attendance`, 'sec', { present: [id.chair] })).s, 409, 'الحضور ثابت بعد بدء القرارات');
  assert.equal((await api('POST', `/api/council-items/${third.id}/decide`, 'chair', { outcome: 'rejected', votesFor: 0, votesAgainst: 2, text: 'لا يوجد ما يستجد' })).s, 200);
});

test('مهام القرار: تُسند لقرار الموافقة، ويُذكَّر بالمتأخر، وينجزها المكلَّف', async () => {
  const items = (await meeting()).items, approved = items.find((i) => i.outcome === 'approved'), rejected = items.find((i) => i.outcome === 'rejected');
  assert.equal((await api('POST', `/api/council-items/${rejected.id}/tasks`, 'chair', { assigneeId: id.m2, title: 'تنفيذ', dueDay: '2026-01-01' })).s, 409);
  const t = await api('POST', `/api/council-items/${approved.id}/tasks`, 'chair', { assigneeId: id.m2, title: 'تعميم الخطة على الأقسام', dueDay: '2020-01-01' });
  assert.equal(t.s, 201);
  assert.equal(notes('council_task', 'm2').length, 1);
  remindOverdueCouncilTasks(app.db); remindOverdueCouncilTasks(app.db);
  assert.equal(notes('council_task_overdue', 'm2').length, 1, 'تذكير واحد');
  assert.equal(notes('council_task_overdue', 'chair').length, 1);
  const mine = (await api('GET', '/api/councils', 'm2')).j.myTasks;
  assert.equal(mine.length, 1); assert.equal(mine[0].overdue, true);
  assert.equal((await api('POST', `/api/council-tasks/${t.j.id}/done`, 'out', { note: 'تم' })).s, 404);
  assert.equal((await api('POST', `/api/council-tasks/${t.j.id}/done`, 'm2', { note: 'عُممت بكتاب رسمي' })).s, 200);
  assert.equal((await api('POST', `/api/council-tasks/${t.j.id}/done`, 'm2', { note: 'مرة أخرى' })).s, 409);
});

test('إغلاق الاجتماع: بعد البت في كل البنود وبمحضر، ثم لا يتغير', async () => {
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/close`, 'sec', { minutes: 'قصير' })).s, 400);
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/close`, 'sec', { minutes: 'عُقد الاجتماع بحضور الرئيس وأمين السر وعضو، واتُخذت القرارات المبينة.' })).s, 200);
  const m = await meeting('m3');
  assert.equal(m.meeting.status, 'closed'); assert.equal(m.canManage, false);
  assert.equal(notes('council_minutes', 'm3').length, 1);
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/items`, 'sec', { title: 'بند متأخر' })).s, 409);
  assert.equal((await api('POST', `/api/council-meetings/${meetingId}/cancel`, 'sec', { reason: 'إلغاء' })).s, 409);
  const ended = (await api('GET', `/api/councils/${councilId}`, 'adm')).j.members.find((x) => x.userId === id.m3);
  assert.equal((await api('POST', `/api/councils/${councilId}/members/${ended.id}/end`, 'adm')).s, 200);
  assert.equal((await api('GET', `/api/councils/${councilId}`, 'm3')).s, 200, 'العضو السابق يبقى مطلعاً على سجل مجلسه');
});
