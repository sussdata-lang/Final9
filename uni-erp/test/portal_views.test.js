import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base;
async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function loginAs(u) { app.limiter.hits.clear(); const r = await api('POST', '/api/auth/login', { body: { username: u, password: PW } }); assert.equal(r.status, 200, r.text); return r.headers.get('set-cookie').split(';')[0]; }

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-pv-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff'], ['stud', 'student']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
});
test.after(async () => { await app.close?.(); });

test('بوابة الطالب: المدير يوقف شاشة فتختفي من allowedViews حساب الطالب', async () => {
  const adm = await loginAs('admin'), stud = await loginAs('stud');
  const views0 = (await api('GET', '/api/me', { cookie: stud })).json.user.allowedViews;
  assert.ok(views0.includes('lms') && views0.includes('grades'), JSON.stringify(views0));
  const r = await api('PUT', '/api/admin/general', { cookie: adm, body: { values: { 'student_portal.view_lms': false, 'student_portal.view_ai': false } } });
  assert.equal(r.status, 200, r.text);
  // ذاكرة الهوية المؤقتة 60 ثانية في الإنتاج؛ نمسحها هنا ليظهر الأثر فوراً
  app.db.cache?.clear?.();
  const stud2 = await loginAs('stud');
  const views1 = (await api('GET', '/api/me', { cookie: stud2 })).json.user.allowedViews;
  assert.ok(!views1.includes('lms') && !views1.includes('ai'), JSON.stringify(views1));
  assert.ok(views1.includes('grades') && views1.includes('home'), JSON.stringify(views1));
});

test('بوابة التبويبات (واجهة): المحاسب المحدود يرى تبويبات مالية معيّنة فقط، والمدير يرى الكل', () => {
  const src = fs.readFileSync(new URL('../public/view_gate.js', import.meta.url), 'utf8');
  const win = { UA: {}, addEventListener() {}, document: null };
  const ctx = vm.createContext({ window: win, document: { readyState: 'complete', addEventListener() {} } });
  vm.runInContext(src, ctx);
  const { allowed } = win.UA.gate;
  const clerk = { role: 'staff', permissions: ['finance:entry'] };
  assert.equal(allowed('fin-tab', 'journal', clerk), true);
  assert.equal(allowed('fin-tab', 'treasury', clerk), true);
  assert.equal(allowed('fin-tab', 'overview', clerk), false);
  assert.equal(allowed('fin-tab', 'coa', clerk), false);
  assert.equal(allowed('proc-tab', 'assets', clerk), false);
  const self = { role: 'staff', permissions: ['staffatt:self'] };
  assert.equal(allowed('hrtab', 'att', self), true);
  assert.equal(allowed('hrtab', 'sal', self), false);
  assert.equal(allowed('hrtab', 'config', self), false);
  assert.equal(allowed('hrtab', 'hub', self), true);                 // غير مسجَّل ← ظاهر
  assert.equal(allowed('fin-tab', 'coa', { role: 'admin', permissions: [] }), true);
});
