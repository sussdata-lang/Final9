import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';
import { ensureForms } from '../server/services/forms/index.js';
import { CONDUCT_FORMS, APPENDIX_FORMS, STUDENT_CONDUCT_TEXT, STAFF_CONDUCT_TEXT } from '../server/services/forms/conduct.js';

const PW = 'Test#Pass12345';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let app, base, hr, s1, adm;
const api = async (m, u, { body, cookie } = {}) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const value = (f) => (f.type === 'select' ? f.options[0] : f.type === 'number' ? String(f.min) : f.type === 'date' ? '2026-11-01' : 'نص تجريبي');
const row = (code) => app.db.prepare('SELECT * FROM service_types WHERE code = ?').get(code);
const details = (code) => Object.fromEntries(JSON.parse(row(code).fields_json).map((f) => [f.name, value(f)]));
const attachments = (code) => JSON.parse(row(code).attachments_json || '[]').filter((a) => a.required).map((a, i) => ({ name: `a${i}.png`, data: PNG }));
const submit = (code, cookie, d = details(code)) => api('POST', '/api/requests', { cookie, body: { service: code, details: d, attachments: attachments(code) } });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-conduct-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,?,?,?)').run(u, n, h, role, no ?? null, Date.now());
  ins('admin', 'مدير', 'admin'); ins('s1', 'طالب', 'student', '2024-1087');
  await ensureStructure(app, { activate: true, password: PW });
  ensureForms(app);
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  [adm, hr, s1] = await Promise.all(['admin', 'hr', 's1'].map(login));
});
test.after(async () => { await app.close(); });

test('النماذج الجديدة كلها في الكتالوج وتُقدَّم وتصل إلى وحدتها', async () => {
  for (const f of [...CONDUCT_FORMS, ...APPENDIX_FORMS]) {
    assert.ok(row(f.code), f.code);
    const r = await submit(f.code, f.audience === 'staff' ? hr : s1);
    assert.equal(r.s, 201, `${f.code}: ${JSON.stringify(r.j)}`);
    assert.equal(app.db.prepare('SELECT s.unit_code AS code FROM requests q JOIN service_types s ON s.code = q.service_code WHERE q.id = ?').get(r.j.request.id).code, f.unit);
  }
});

test('مدونة السلوك: النص كامل قبل التقديم، وجمهورها وإقرارها إلزامي', async () => {
  assert.ok(STUDENT_CONDUCT_TEXT.length <= 6000 && STAFF_CONDUCT_TEXT.length <= 6000);
  assert.equal(row('conduct_student').instructions, STUDENT_CONDUCT_TEXT);
  assert.equal(row('conduct_staff').instructions, STAFF_CONDUCT_TEXT);
  assert.match(STUDENT_CONDUCT_TEXT, /السكن الداخلي/);
  assert.match(STUDENT_CONDUCT_TEXT, /بيئة تدريب معزولة/);
  assert.match(STAFF_CONDUCT_TEXT, /تعارض المصالح/);
  assert.equal((await submit('conduct_staff', s1)).s, 400, 'نموذج الموظفين لا يُقدَّم من طالب');
  const d = details('conduct_student');
  delete d.f2;
  assert.equal((await submit('conduct_student', s1, d)).s, 400, 'كل محور إلزامي');
});

test('محرر الخدمات يقبل نص التعليمات حتى 6000 حرف فقط', async () => {
  const body = (instructions, code) => ({ code, label: 'خدمة طويلة', description: 'وصف الخدمة', slaHours: 48, audience: 'both', instructions, fields: [] });
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: body('ن'.repeat(6000), 'long_ok') })).s, 200);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: body('ن'.repeat(6001), 'long_no') })).s, 400);
});
