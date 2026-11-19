// واجهة نماذج المشتريات بحقول نماذج الجامعة: الإدخال والعرض والطباعة في متصفح حقيقي.
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
let app, base, adm, browser, page, ids = {};
const errs = [];
const api = async (m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: adm }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
// يطلق إجراء الواجهة كما لو نُقر زرّه
const act = (name, data = {}) => page.evaluate(([n, d]) => { const b = document.createElement('button'); b.dataset.act = n; Object.assign(b.dataset, d); b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }, [name, data]);
const modalText = () => page.waitForFunction(() => (document.querySelector('.modal')?.textContent || '').length > 50).then(() => page.evaluate(() => document.querySelector('.modal').textContent));

test.before(async () => {
  if (!pw) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-procui-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, publicDir: path.resolve('public'), backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  adm = (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) })).headers.get('set-cookie').split(';')[0];
  const wh = (await api('POST', '/api/procurement/warehouses', { code: 'WH-U', name: 'المخزن الرئيسي', location: 'المبنى A' })).j.warehouse.id;
  const item = (await api('POST', '/api/procurement/items', { code: 'IT-U', name: 'طابعة ليزر', unit: 'قطعة', warehouseId: wh })).j.item.id;
  const sup = (await api('POST', '/api/procurement/suppliers', { code: 'SUP-U', name: 'شركة الأمل', contactPerson: 'سامر الأحمد', mobile: '0944123456' })).j.supplier.id;
  ids.req = (await api('POST', '/api/procurement/requests', { title: 'طابعات', description: 'حاجة المكتبة', department: 'المكتبة', jobTitle: 'سكرتير', directManager: 'رئيس القسم', purchaseThreshold: 'شراء مباشر', amountWords: 'مليونان', lines: [{ itemId: item, description: 'طابعة ليزر', qty: 2, estCost: 1000, budgetCode: 'B-1', specs: 'A4' }] })).j.request.id;
  const o = (await api('POST', '/api/procurement/orders', { supplierId: sup, directReason: 'أمر مباشر لاختبار واجهة النماذج', deliveryMethod: 'توصيل المورّد', paymentTerms: 'نقدًا', deliveryTax: 50, lines: [{ itemId: item, description: 'طابعة ليزر', qty: 2, unitCost: 1000 }] })).j.order;
  ids.order = o.id;
  // الأمر المباشر يرسله شخص غير منشئه
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin2', 'مدير ثانٍ', await hashPassword(PW, 1024), 'admin', Date.now());
  const adm2 = (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin2', password: PW }) })).headers.get('set-cookie').split(';')[0];
  await fetch(`${base}/api/procurement/orders/${o.id}/order`, { method: 'POST', headers: { Cookie: adm2 } });
  await fetch(`${base}/api/procurement/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adm2 }, body: JSON.stringify({ orderId: o.id, deliveryNoteNo: 'DN-9', location: 'المخزن', compliant: true, lines: [{ itemId: item, qty: 2, quality: 'مطابق' }] }) });
  await api('POST', '/api/procurement/issues', { warehouseId: wh, department: 'المكتبة', receiverName: 'زياد', requestRef: 'SR-1', lines: [{ itemId: item, qty: 1, requestedQty: 1, itemCondition: 'جديدة' }] });
  try { browser = await pw.chromium.launch(); } catch { pw = null; return; }
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base);
  await page.evaluate(async (p) => { await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: p }) }); }, PW);
  await page.reload(); await page.waitForSelector('.sx-nav');
  await page.evaluate(() => UA.go('procurement')); await page.waitForTimeout(800);
});
test.after(async () => { if (browser) await browser.close(); if (app) await app.close(); });

test('طلب الشراء: نموذج الإدخال يضم حقول الجامعة، والعرض يطبعها', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await act('proc-new-req');
  await page.waitForSelector('#pr-dept');
  for (const id of ['pr-dept', 'pr-job', 'pr-mgr', 'pr-thr', 'pr-need', 'pr-words']) assert.ok(await page.$(`#${id}`), id);
  assert.ok(await page.$('#pr-lines .pr-budget') && await page.$('#pr-lines .pr-specs') && await page.$('#pr-lines .pr-unit'));
  await act('proc-close-modal');
  await act('proc-view-req', { id: String(ids.req) });
  const tx = await modalText();
  for (const s of ['المسمى الوظيفي', 'سكرتير', 'المسؤول المباشر', 'عتبة الشراء', 'الرمز (الموازنة)', 'B-1', 'رصيد المستودع', 'المبلغ كتابةً', 'مليونان']) assert.ok(tx.includes(s), s);
  assert.match(await page.evaluate(() => document.querySelector('.modal [data-doc-signers]').dataset.docSigners), /أمين الجامعة/);
  await act('proc-close-modal');
});

test('أمر الشراء: العرض يضم بيانات المورّد والتوصيل والضرائب والمجموع الكامل', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await act('proc-view-ord', { id: String(ids.order) });
  const tx = await modalText();
  for (const s of ['أمر شراء', 'سامر الأحمد', 'طريقة التوصيل', 'توصيل المورّد', 'ضريبة التوصيل', 'المجموع الكامل', '2,050']) assert.ok(tx.includes(s), s);
  await act('proc-close-modal');
});

test('مذكرة الاستلام ومحضر الإخراج: عرض كامل بحقول الجامعة ونماذج إدخال متعددة البنود', async (t) => {
  if (!pw) return t.skip('Playwright غير متوفر');
  await page.evaluate(() => { UA.S.proc.tab = 'movements'; UA.S.proc.moveMode = 'receipts'; }); await act('proc-tab', { t: 'movements' }); await page.waitForTimeout(700);
  const rid = await page.evaluate(() => UA.S.proc.receipts[0]?.id);
  await act('proc-view-rcv', { id: String(rid) });
  let tx = await modalText();
  for (const s of ['مذكرة فحص واستلام مواد', 'DN-9', 'الكمية المتوقعة', 'مطابق', 'نعم']) assert.ok(tx.includes(s), s);
  await act('proc-close-modal');
  const iid = await page.evaluate(() => UA.S.proc.issues[0]?.id);
  await act('proc-view-iss', { id: String(iid) });
  tx = await modalText();
  for (const s of ['محضر إخراج', 'SR-1', 'الرصيد بعد الصرف', 'جديدة', 'إقرار الاستلام']) assert.ok(tx.includes(s), s);
  await act('proc-close-modal');
  await act('proc-new-issue'); await page.waitForSelector('#pis-lines .pis-line');
  await act('proc-add-issue-line');
  assert.equal(await page.locator('#pis-lines .pis-line').count(), 2, 'إضافة مادة ثانية');
  await act('proc-close-modal');
  assert.deepEqual(errs, []);
});
