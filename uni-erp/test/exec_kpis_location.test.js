// لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة تظهر في «الامتحانات والتقييم» ولم تعد ضمن منظومة التطوير في التدقيق.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let pw = null;
for (const spec of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { pw = await import(spec); break; } catch { /* التالي */ }
}
let app, base, browser, page;
const errs = [];

test.before(async () => {
  if (!pw) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-kpi-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, publicDir: path.resolve('public') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  try { browser = await pw.chromium.launch(); } catch { pw = null; return; }
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base);
  await page.evaluate(async (p) => { await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: p }) }); }, PW);
  await page.reload(); await page.waitForSelector('.sx-nav');
});
test.after(async () => { if (browser) await browser.close(); if (app) await app.close(); });

test('مؤشرات الرئاسة: تبويب في الامتحانات والتقييم يعرض اللوحة', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => UA.go('expansions'));
  await page.waitForSelector('.v12-tab[data-t="kpis"]', { state: 'attached' });
  // التبويبات تظهر قوائم فرعية في الشريط الجانبي: البند موجود هناك
  const side = await page.evaluate(() => [...document.querySelectorAll('.sx-nav button, .sx-nav a')].some((b) => /مؤشرات الأداء الاستراتيجية/.test(b.textContent)));
  assert.ok(side, 'البند غير ظاهر في القائمة الجانبية');
  await page.evaluate(() => [...document.querySelectorAll('.sx-nav button, .sx-nav a')].find((b) => /مؤشرات الأداء الاستراتيجية/.test(b.textContent)).click());
  await page.waitForFunction(() => /لوحة مؤشرات الأداء الاستراتيجية لرئاسة الجامعة/.test(document.querySelector('#v12-exp-body')?.textContent || ''));
  const info = await page.evaluate(() => {
    const b = document.querySelector('#v12-exp-body');
    return { kpis: b.querySelectorAll('.es-kpi').length, table: !!b.querySelector('table thead'), active: document.querySelector('.v12-tab.active')?.dataset.t };
  });
  assert.equal(info.kpis, 3);
  assert.ok(info.table);
  assert.equal(info.active, 'kpis');
  if (process.env.KPI_SHOT) await page.screenshot({ path: process.env.KPI_SHOT, fullPage: false });
  assert.deepEqual(errs, []);
});

test('آليات المراقبة والتدقيق: لا تعرض منظومة التطوير المؤسسي، والتبويب القديم يعود إلى سجل التدقيق', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { UA.S.auditTab = 'exec_offline'; return UA.go('audit'); });
  await page.waitForSelector('[data-act="audtab2"]');
  const info = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('[data-act="audtab2"]')].map((b) => b.dataset.t), suite: !!document.querySelector('.es-tabs, #audit-enterprise-mount') }));
  assert.ok(!info.tabs.includes('exec_offline'));
  assert.equal(info.suite, false);
  assert.deepEqual(errs, []);
});
