// تخصص عضو الهيئة التدريسية: مواد من النظام بنوع تدريس لكل ربط، بدل نص حر
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, ck, c1, c2;
const api = async (m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-fsp-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('adm', 'admin', await hashPassword(PW, 1024), 'admin', Date.now());
  const prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const mk = (name, code) => Number(app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, ?, ?, 3) RETURNING id').get(prog, name, code).id);
  c1 = mk('Network Security', 'FSP-1'); c2 = mk('Criminal Evidence', 'FSP-2');
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'adm', password: PW }) });
  ck = r.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { await app.close(); });

test('التخصص مواد من النظام بنوع تدريس، ويُشتق نص التخصص منها، ويبقى ثابتاً بين الفصول', async () => {
  const rank = (await api('GET', '/api/faculty')).j.options.ranks[0];
  assert.equal(Object.keys((await api('GET', '/api/faculty')).j.options.teachingKinds).length, 5);
  const bad = await api('POST', '/api/faculty', { name: 'Dr Bad', rank, specialties: [{ courseId: c1, kind: 'nonsense' }] });
  assert.equal(bad.s, 400);
  assert.equal((await api('POST', '/api/faculty', { name: 'Dr Bad', rank, specialties: [{ courseId: 999999, kind: 'theory' }] })).s, 400, 'مادة غير موجودة');
  const made = (await api('POST', '/api/faculty', { name: 'Dr Sami', rank, specialties: [{ courseId: c1, kind: 'theory' }, { courseId: c1, kind: 'lab' }, { courseId: c1, kind: 'lab' }, { courseId: c2, kind: 'military' }] })).j.member;
  assert.equal(made.specialties.length, 3, 'التكرار نفسه يُهمل، ويجوز لمادة واحدة نوعا تدريس');
  assert.equal(made.specialty, 'Network Security، Criminal Evidence', 'النص مشتق من أسماء المواد بترتيب إدخالها');
  const found = (await api('GET', '/api/faculty?q=Criminal')).j.members;
  assert.deepEqual(found.map((m) => m.name), ['Dr Sami'], 'البحث باسم المادة يجد العضو');
  // التعديل بلا specialties لا يمسّ الربط، ومعها يستبدله
  await api('PUT', `/api/faculty/${made.id}`, { phone: '0944111222' });
  assert.equal((await api('GET', '/api/faculty')).j.members[0].specialties.length, 3);
  const upd = (await api('PUT', `/api/faculty/${made.id}`, { specialties: [{ courseId: c2, kind: 'field' }] })).j.member;
  assert.deepEqual(upd.specialties.map((s) => s.kindLabel), ['التدريب الميداني والشرطي']);
  assert.equal(upd.specialty, 'Criminal Evidence');
  // حذف المادة من النظام لا يترك ربطاً يتيماً
  app.db.prepare('DELETE FROM faculty_specialties WHERE course_id = ?').run(c1);
  assert.equal((await api('DELETE', `/api/faculty/${made.id}`)).s, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM faculty_specialties').get().n, 0);
});
