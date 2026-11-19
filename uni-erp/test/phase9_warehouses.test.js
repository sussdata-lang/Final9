// المرحلة 9: الرصيد لكل مستودع والتحويل بين المستودعات — الاستلام في مستودع، والصرف من رصيد المستودع لا الجامعة،
// والتحويل بخطوتين (قيد النقل ثم الاستلام بيد أخرى) والإلغاء، والجرد في مستودع، والمطابقة
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, whA, whB, sup, item;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};
const stocks = async () => (await call('ord', 'GET', '/api/procurement/items')).j.items.find((x) => x.id === item.id);
const inWh = (it, wh) => Number((it.stocks.find((s) => s.warehouseId === wh) || {}).qty || 0);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph9-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  readyFinance(app.db);
  const h = await hashPassword(PW, 1024);
  for (const u of ['ord', 'keepA', 'keepB']) {
    app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, 'admin', ?, 0)").run(u, `مستخدم ${u}`, h, Date.now());
    app.limiter.hits.clear();
    ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  }
  whA = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-A', name: 'المستودع المركزي' })).j.warehouse.id);
  whB = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-B', name: 'مستودع المخابر' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P9', name: 'مورد المرحلة 9' })).j.supplier.id);
  item = (await call('ord', 'POST', '/api/procurement/items', { code: 'P9-001', name: 'كابلات شبكة', unit: 'قطعة', warehouseId: whA })).j.item;
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'تجهيز مخابر الشبكات العاجل', lines: [{ itemId: item.id, description: 'كابلات', qty: 20, unitCost: 1500 }] })).j.order;
  await call('keepA', 'POST', `/api/procurement/orders/${o.id}/order`);
  // الاستلام في مستودع محدد غير مستودع الصنف الافتراضي
  assert.equal((await call('keepA', 'POST', '/api/procurement/receipts', { orderId: o.id, warehouseId: whA, lines: [{ itemId: item.id, qty: 12 }] })).s, 201);
  assert.equal((await call('keepA', 'POST', '/api/procurement/receipts', { orderId: o.id, warehouseId: whB, lines: [{ itemId: item.id, qty: 8 }] })).s, 201);
});
test.after(async () => { await app.close(); });

test('الاستلام يُدخل المستودع المحدد، ورصيد الصنف الكلي مجموع مستودعاته', async () => {
  const it = await stocks();
  assert.equal(it.qtyOnHand, 20); assert.equal(inWh(it, whA), 12); assert.equal(inWh(it, whB), 8);
  // تصفية المستودع تُظهر الصنف في مستودع ليس مستودعه الافتراضي
  assert.ok((await call('ord', 'GET', `/api/procurement/items?warehouse=${whB}`)).j.items.some((x) => x.id === item.id));
});

test('13.12 الصرف من رصيد المستودع المصدِّر لا من رصيد الجامعة', async () => {
  const over = await call('keepB', 'POST', '/api/procurement/issues', { warehouseId: whB, issuedTo: 'مخبر الشبكات', lines: [{ itemId: item.id, qty: 9 }] });
  assert.equal(over.s, 409); assert.equal(over.j.code, 'insufficient_stock', 'في مستودع المخابر 8 فقط');
  assert.equal((await call('keepB', 'POST', '/api/procurement/issues', { warehouseId: whB, issuedTo: 'مخبر الشبكات', lines: [{ itemId: item.id, qty: 8 }] })).s, 201);
  const it = await stocks();
  assert.equal(it.qtyOnHand, 12); assert.equal(inWh(it, whB), 0);
});

test('4.3 التحويل بخطوتين: قيد النقل ثم الاستلام بيد أخرى، والإلغاء يعيد المواد', async () => {
  assert.equal((await call('keepA', 'POST', '/api/procurement/transfers', { fromWarehouseId: whA, toWarehouseId: whA, lines: [{ itemId: item.id, qty: 1 }] })).s, 400);
  assert.equal((await call('keepA', 'POST', '/api/procurement/transfers', { fromWarehouseId: whA, toWarehouseId: whB, lines: [{ itemId: item.id, qty: 50 }] })).j.code, 'insufficient_stock');
  const t = (await call('keepA', 'POST', '/api/procurement/transfers', { fromWarehouseId: whA, toWarehouseId: whB, note: 'تجهيز المخبر', lines: [{ itemId: item.id, qty: 5 }] })).j.transfer;
  assert.equal(t.status, 'sent');
  let it = await stocks();
  assert.equal(inWh(it, whA), 7); assert.equal(inWh(it, whB), 0); assert.equal(it.qtyOnHand, 7, 'قيد النقل خارج المستودعين');
  assert.equal((await call('ord', 'GET', '/api/procurement/transfers')).j.inTransit.value, 7500);
  assert.equal((await call('keepA', 'POST', `/api/procurement/transfers/${t.id}/receive`)).j.code, 'sod_violation', 'المرسِل لا يستلم');
  assert.equal((await call('keepB', 'POST', `/api/procurement/transfers/${t.id}/receive`)).j.transfer.status, 'received');
  it = await stocks();
  assert.equal(inWh(it, whB), 5); assert.equal(it.qtyOnHand, 12);
  // الإلغاء قبل الاستلام يعيدها للمرسِل
  const t2 = (await call('keepA', 'POST', '/api/procurement/transfers', { fromWarehouseId: whA, toWarehouseId: whB, lines: [{ itemId: item.id, qty: 2 }] })).j.transfer;
  assert.equal((await call('keepA', 'POST', `/api/procurement/transfers/${t2.id}/cancel`, { reason: 'أُرسل بالخطأ' })).j.transfer.status, 'cancelled');
  it = await stocks();
  assert.equal(inWh(it, whA), 7); assert.equal(it.qtyOnHand, 12);
  const kinds = (await call('ord', 'GET', `/api/procurement/items/${item.id}/card`)).j.moves.map((m) => m.kind);
  assert.deepEqual(kinds.slice(-4), ['transfer_out', 'transfer_in', 'transfer_out', 'transfer_in']);
});

test('الجرد في مستودع محدد، والصنف في مستودعين يلزمه تحديد المستودع، والمطابقة تشمل أرصدة المستودعات', async () => {
  assert.equal((await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 6, reason: 'محضر جرد المستودع المركزي 9/2026' })).j.code, 'warehouse_required');
  const a = await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { warehouseId: whA, expectedQty: 7, qtyOnHand: 6, reason: 'محضر جرد المستودع المركزي 9/2026' });
  assert.equal(a.s, 200, JSON.stringify(a.j));
  const it = await stocks();
  assert.equal(inWh(it, whA), 6); assert.equal(inWh(it, whB), 5); assert.equal(it.qtyOnHand, 11);
  assert.equal((await call('ord', 'GET', '/api/procurement/ledger-check')).j.ok, true);
  app.db.prepare('UPDATE proc_item_stock SET qty = qty + 1 WHERE item_id = ? AND warehouse_id = ?').run(item.id, whB);
  const chk = (await call('ord', 'GET', '/api/procurement/ledger-check')).j;
  assert.equal(chk.ok, false); assert.equal(chk.diffs[0].warehouses, 12);
});
