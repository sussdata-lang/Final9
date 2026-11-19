// المرحلة 10: قيود الصرف وفروقات الجرد، وعدم ابتلاع تعذّرها، ومطابقة المخزون مع حساب المخزون (تقرير المشتريات 5.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, wh, sup, item;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};
const lines = (entryId) => app.db.prepare('SELECT a.code, l.debit, l.credit, l.cost_center_id FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.line_no').all(entryId)
  .map((x) => [x.code, Number(x.debit), Number(x.credit), x.cost_center_id == null ? null : Number(x.cost_center_id)]);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph10-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  readyFinance(app.db);
  const h = await hashPassword(PW, 1024);
  for (const u of ['ord', 'keeper']) {
    app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, 'admin', ?, 0)").run(u, `مستخدم ${u}`, h, Date.now());
    app.limiter.hits.clear();
    ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  }
  app.db.prepare("INSERT INTO fin_cost_centers (code, name, active) VALUES ('CC-LIB', 'المكتبة', 1)").run();
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P10', name: 'مستودع المرحلة 10' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P10', name: 'مورد المرحلة 10' })).j.supplier.id);
  item = (await call('ord', 'POST', '/api/procurement/items', { code: 'P10-001', name: 'ورق تصوير', unit: 'رزمة', warehouseId: wh })).j.item;
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'تموين ورق التصوير للفصل', lines: [{ itemId: item.id, description: 'ورق', qty: 10, unitCost: 3000 }] })).j.order;
  await call('keeper', 'POST', `/api/procurement/orders/${o.id}/order`);
  assert.equal((await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: item.id, qty: 10 }] })).s, 201);
});
test.after(async () => { await app.close(); });

test('الصرف يرحّل قيداً: مصروف المواد مدين بمركز تكلفة القسم، والمخزون دائن بمتوسط التكلفة', async () => {
  const r = await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, department: 'المكتبة', receiverName: 'سامر', lines: [{ itemId: item.id, qty: 4 }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); assert.ok(r.j.journalEntryId); assert.equal(r.j.journalError, null);
  const cc = Number(app.db.prepare("SELECT id FROM fin_cost_centers WHERE code = 'CC-LIB'").get().id);
  assert.deepEqual(lines(r.j.journalEntryId), [['5201', 1200000, 0, cc], ['1301', 0, 1200000, null]], '4 × 3000 ل.س بالوحدات الصغرى');
});

test('فرق الجرد: العجز على حساب الفروقات والزيادة لحساب الإيراد', async () => {
  const loss = await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 5, expectedQty: 6, reason: 'محضر جرد رقم 10 — رزمة تالفة' });
  assert.equal(loss.s, 200, JSON.stringify(loss.j));
  assert.deepEqual(lines(loss.j.journalEntryId), [['5401', 300000, 0, null], ['1301', 0, 300000, null]]);
  const gain = await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 7, expectedQty: 5, reason: 'محضر جرد رقم 11 — رزمتان غير مسجلتين' });
  assert.deepEqual(lines(gain.j.journalEntryId), [['1301', 600000, 0, null], ['4203', 0, 600000, null]]);
});

test('المطابقة: قيمة المخزون تساوي رصيد حساب المخزون حين تُرحَّل كل الحركات', async () => {
  const r = (await call('ord', 'GET', '/api/procurement/gl-reconcile')).j;
  assert.equal(r.stockValue, 21000, '7 × 3000'); assert.equal(r.glBalance, 21000); assert.equal(r.difference, 0); assert.equal(r.unposted, 0);
});

test('تعذّر القيد (لا سنة مفتوحة) لا يُبتلع: يظهر في قائمة «بلا قيد» ويُرحَّل بعد المعالجة، والفرق يظهر في المطابقة', async () => {
  const open = app.db.prepare("SELECT id FROM fin_years WHERE status = 'open'").all().map((x) => x.id);
  app.db.prepare("UPDATE fin_years SET status = 'closed' WHERE status = 'open'").run();
  const r = await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issuedTo: 'قسم الحاسوب', lines: [{ itemId: item.id, qty: 2 }] });
  assert.equal(r.s, 201); assert.equal(r.j.journalEntryId, null); assert.match(r.j.journalError, /سنة مالية مفتوحة/);
  const un = (await call('ord', 'GET', '/api/procurement/unposted')).j;
  assert.equal(un.issues.length, 1);
  assert.equal((await call('ord', 'GET', '/api/procurement/gl-reconcile')).j.difference, -6000, 'المخزون نقص ولم ينقص الحساب');
  for (const id of open) app.db.prepare("UPDATE fin_years SET status = 'open' WHERE id = ?").run(id);
  const re = await call('ord', 'POST', `/api/procurement/unposted/issues/${un.issues[0].id}/post`);
  assert.equal(re.s, 200, JSON.stringify(re.j)); assert.ok(re.j.journalEntryId);
  assert.equal((await call('ord', 'GET', '/api/procurement/gl-reconcile')).j.difference, 0);
});

test('حساب الإعداد غير موجود: سبب واضح لا خطأ خادم', async () => {
  await call('ord', 'PUT', '/api/admin/general', { values: { 'procurement.issue_expense_account': '9999' } });
  const r = await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issuedTo: 'قسم الحاسوب', lines: [{ itemId: item.id, qty: 1 }] });
  assert.equal(r.s, 201); assert.match(r.j.journalError, /9999/);
});
