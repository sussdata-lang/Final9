// إدارة الموافقات على معالجة البيانات لأغراض غير أساسية، وتصنيف البيانات الشخصية (مرجع ثابت للقراءة).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const api = async (m, u, who, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-consent-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const user = (u, role, perms) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, role === 'student' ? u : null, now, perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  user('adm', 'admin'); user('aud', 'staff', ['audit:read']); user('reg', 'staff', ['student:update']); user('emp', 'staff', ['student:read']);
  user('STU-1', 'student');
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of ['adm', 'aud', 'reg', 'emp', 'STU-1']) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('موافقاتي: الأساسي ثابت لا يُسحَب، وغيره صريح بلا قيمة حتى يُسجَّل، ثم مرتبط بوقت التسجيل', async () => {
  const r = await api('GET', '/api/consent/me', 'STU-1');
  assert.equal(r.s, 200);
  const core = r.j.purposes.find((p) => p.code === 'academic_processing');
  assert.equal(core.required, true); assert.equal(core.granted, true); assert.equal(core.recordedAt, null);
  const photo = r.j.purposes.find((p) => p.code === 'photo_publicity');
  assert.equal(photo.required, false); assert.equal(photo.granted, false); assert.equal(photo.recordedAt, null);

  const noWithdraw = await api('POST', '/api/consent/me', 'STU-1', { code: 'academic_processing', granted: false });
  assert.equal(noWithdraw.s, 409);

  const bad = await api('POST', '/api/consent/me', 'STU-1', { code: 'بلا_معنى' });
  assert.equal(bad.s, 400);

  const grant = await api('POST', '/api/consent/me', 'STU-1', { code: 'photo_publicity', granted: true });
  assert.equal(grant.s, 200); assert.equal(grant.j.granted, true);
  const after = await api('GET', '/api/consent/me', 'STU-1');
  const p2 = after.j.purposes.find((p) => p.code === 'photo_publicity');
  assert.equal(p2.granted, true); assert.ok(p2.recordedAt > 0);

  const withdraw = await api('POST', '/api/consent/me', 'STU-1', { code: 'photo_publicity', granted: false });
  assert.equal(withdraw.s, 200); assert.equal(withdraw.j.granted, false);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE subject_id = ? AND purpose_code = 'photo_publicity'").get(id['STU-1']).n), 2, 'سجل حدثين لا تحديث صف واحد');
});

test('التسجيل نيابة عن طالب: يتطلب صلاحية تعديل الطلاب وملاحظة، ويُسجَّل في التدقيق', async () => {
  const forbidden = await api('GET', `/api/consent/users/${id['STU-1']}`, 'emp');
  assert.equal(forbidden.s, 403);
  const okView = await api('GET', `/api/consent/users/${id['STU-1']}`, 'reg');
  assert.equal(okView.s, 200);

  const setForbidden = await api('POST', `/api/consent/users/${id['STU-1']}`, 'emp', { code: 'external_sharing', granted: true, note: 'محاولة' });
  assert.equal(setForbidden.s, 403);

  const noNote = await api('POST', `/api/consent/users/${id['STU-1']}`, 'reg', { code: 'external_sharing', granted: true });
  assert.equal(noNote.s, 400, 'ملاحظة إلزامية عند التسجيل نيابة عن غيره');

  const ok = await api('POST', `/api/consent/users/${id['STU-1']}`, 'reg', { code: 'external_sharing', granted: true, note: 'وليّ أمر حضر شخصياً ووقّع إقراراً خطياً' });
  assert.equal(ok.s, 200); assert.equal(ok.j.granted, true);
  assert.ok(app.db.prepare("SELECT 1 AS x FROM audit_log WHERE action LIKE 'منح موافقة%' AND ref = ?").get(`نيابة عن مستخدم #${id['STU-1']}`), 'سُجِّل في التدقيق باسم من دوَّنه نيابة');
});

test('نظرة الموافقات: محصورة بصلاحية audit:read، وتعكس الموافَق عليه والمسحوب بدقة', async () => {
  assert.equal((await api('GET', '/api/privacy/consent-overview', 'emp')).s, 403);
  const ov = await api('GET', '/api/privacy/consent-overview', 'aud');
  assert.equal(ov.s, 200);
  assert.equal(ov.j.purposes.some((p) => p.code === 'academic_processing'), false, 'الغرض الأساسي لا يظهر في النظرة');
  const photo = ov.j.purposes.find((p) => p.code === 'photo_publicity');
  assert.equal(photo.withdrawn, 1); assert.equal(photo.granted, 0);
  const ext = ov.j.purposes.find((p) => p.code === 'external_sharing');
  assert.equal(ext.granted, 1);

  assert.equal((await api('GET', '/api/privacy/consent-log?purpose=بلا_معنى', 'aud')).s, 400);
  const log = await api('GET', '/api/privacy/consent-log?purpose=photo_publicity', 'aud');
  assert.equal(log.s, 200);
  assert.equal(log.j.entries.length, 2);
  assert.equal(log.j.entries[0].granted, false, 'الأحدث أولاً');
  assert.equal(log.j.entries[0].subjectName, 'مستخدم STU-1');
});

test('تصنيف البيانات: مرجع للقراءة محصور بصلاحية audit:read', async () => {
  assert.equal((await api('GET', '/api/privacy/classification', 'emp')).s, 403);
  const r = await api('GET', '/api/privacy/classification', 'aud');
  assert.equal(r.s, 200);
  assert.ok(r.j.items.length >= 5);
  const disc = r.j.items.find((x) => x.category.includes('الانضباط'));
  assert.equal(disc.sensitivity, 'secret');
  assert.equal(r.j.sensitivity.secret, 'سري للغاية');
});
