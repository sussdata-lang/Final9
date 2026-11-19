// المرحلة 12: التصنيفات الهرمية والترقيم التلقائي، ودليل الوحدات والتحويل، والكميات العشرية حسب الوحدة
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, wh, sup;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};
const qtyOf = (id) => Number(app.db.prepare('SELECT qty_on_hand FROM proc_items WHERE id = ?').get(id).qty_on_hand);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph12-'));
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
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P12', name: 'مستودع المرحلة 12' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P12', name: 'مورد المرحلة 12' })).j.supplier.id);
});
test.after(async () => { await app.close(); });

test('6.2 شجرة التصنيفات: فرع تحت أب، ولا حلقات، ورمز صالح', async () => {
  const net = (await call('ord', 'POST', '/api/procurement/categories', { code: 'cat-net', name: 'معدات الشبكات' })).j.categories.find((c) => c.code === 'CAT-NET');
  assert.ok(net, 'الرمز بأحرف كبيرة');
  const sw = (await call('ord', 'POST', '/api/procurement/categories', { code: 'CAT-NET-SW', name: 'مبدّلات', parentId: net.id })).j.categories.find((c) => c.code === 'CAT-NET-SW');
  assert.equal(sw.parentId, net.id);
  assert.equal((await call('ord', 'POST', '/api/procurement/categories', { id: net.id, code: 'CAT-NET', name: 'معدات الشبكات', parentId: sw.id })).s, 400, 'لا يكون الفرع أباً لأصله');
  assert.equal((await call('ord', 'POST', '/api/procurement/categories', { code: 'تصنيف', name: 'رمز عربي' })).s, 400);
});

test('6.1 الترقيم التلقائي من رمز التصنيف، وقفل رمز التصنيف بعد أن تُرقّم به أصناف', async () => {
  const cat = (await call('ord', 'GET', '/api/procurement/categories')).j.categories.find((c) => c.code === 'CAT-NET');
  const a = (await call('ord', 'POST', '/api/procurement/items', { name: 'مبدّل 24 منفذ', categoryId: cat.id, warehouseId: wh })).j.item;
  const b = (await call('ord', 'POST', '/api/procurement/items', { name: 'موجّه لاسلكي', categoryId: cat.id, warehouseId: wh })).j.item;
  assert.deepEqual([a.code, b.code], ['CAT-NET-0001', 'CAT-NET-0002']);
  assert.match((await call('ord', 'POST', '/api/procurement/items', { name: 'صنف بلا تصنيف', warehouseId: wh })).j.item.code, /^ITM-\d+$/);
  assert.equal((await call('ord', 'POST', '/api/procurement/categories', { id: cat.id, code: 'CAT-LAN', name: 'معدات الشبكات' })).j.code, 'code_locked');
});

test('6.3 الكسور حسب الوحدة: الكغ يقبل 2.5 والقطعة لا تقبل', async () => {
  const flour = (await call('ord', 'POST', '/api/procurement/items', { name: 'مسحوق تنظيف', unit: 'كغ', warehouseId: wh, minStock: 1.5 })).j.item;
  const pens = (await call('ord', 'POST', '/api/procurement/items', { name: 'أقلام رصاص', unit: 'قطعة', warehouseId: wh })).j.item;
  assert.equal((await call('ord', 'POST', '/api/procurement/items', { name: 'دفاتر', unit: 'قطعة', minStock: 1.5 })).s, 400, 'حد بكسر لوحدة صحيحة');
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'تموين عاجل للنظافة والقرطاسية', lines: [
    { itemId: flour.id, description: 'مسحوق', qty: 12.5, unitCost: 4000 },
    { itemId: pens.id, description: 'أقلام', qty: 10, unitCost: 500 },
  ] })).j.order;
  assert.equal(o.totalAmount, 55000);
  assert.equal((await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'أمر بكسر لوحدة صحيحة', lines: [{ itemId: pens.id, description: 'أقلام', qty: 2.5, unitCost: 500 }] })).j.code, 'fraction_not_allowed');
  await call('keeper', 'POST', `/api/procurement/orders/${o.id}/order`);
  assert.equal((await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: flour.id, qty: 12.5 }, { itemId: pens.id, qty: 10 }] })).s, 201);
  assert.equal(qtyOf(flour.id), 12.5);
  assert.equal((await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issuedTo: 'قسم الخدمات', lines: [{ itemId: flour.id, qty: 2.25 }] })).s, 201);
  assert.equal(qtyOf(flour.id), 10.25);
  assert.equal((await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issuedTo: 'قسم الخدمات', lines: [{ itemId: pens.id, qty: 1.5 }] })).j.code, 'fraction_not_allowed');
  assert.equal((await call('ord', 'GET', '/api/procurement/ledger-check')).j.ok, true);
});

test('التحويل: الشراء بالعلبة والتخزين بالقطعة (العلبة = 12) يُدخل 12 × الكمية بسعر القطعة', async () => {
  const it = (await call('ord', 'POST', '/api/procurement/items', { name: 'أقلام حبر جاف', unit: 'قطعة', warehouseId: wh })).j.item;
  assert.equal((await call('ord', 'PUT', `/api/procurement/items/${it.id}/units`, { units: [{ unitName: 'علبة', factor: 12 }] })).s, 200);
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'شراء أقلام بالعلب للامتحانات', lines: [{ itemId: it.id, description: 'أقلام', unit: 'علبة', qty: 3, unitCost: 6000 }] })).j.order;
  await call('keeper', 'POST', `/api/procurement/orders/${o.id}/order`);
  assert.equal((await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: it.id, qty: 3 }] })).s, 201);
  assert.equal(qtyOf(it.id), 36, '3 علب × 12');
  assert.equal(Number(app.db.prepare('SELECT avg_cost FROM proc_items WHERE id = ?').get(it.id).avg_cost), 500, '6000 ÷ 12');
  // التحويل العام في الدليل: غرام → كغ
  const salt = (await call('ord', 'POST', '/api/procurement/items', { name: 'ملح مخبري', unit: 'كغ', warehouseId: wh })).j.item;
  const o2 = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'مواد مخبرية بالغرام', lines: [{ itemId: salt.id, description: 'ملح', unit: 'غرام', qty: 500, unitCost: 10 }] })).j.order;
  await call('keeper', 'POST', `/api/procurement/orders/${o2.id}/order`);
  await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o2.id, lines: [{ itemId: salt.id, qty: 500 }] });
  assert.equal(qtyOf(salt.id), 0.5);
});

test('دليل الوحدات: إضافة وحدة بتحويل عام، ولا تكرار', async () => {
  const u = await call('ord', 'POST', '/api/procurement/units', { name: 'غالون', fractional: true, baseName: 'ليتر', factor: 3.785 });
  assert.equal(u.s, 200, JSON.stringify(u.j)); assert.ok(u.j.units.some((x) => x.name === 'غالون' && x.baseName === 'ليتر'));
  assert.equal((await call('ord', 'POST', '/api/procurement/units', { name: 'غالون' })).s, 409);
});
