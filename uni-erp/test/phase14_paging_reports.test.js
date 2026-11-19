// المرحلة 14: ترقيم الصفحات من الخادم (لا يختفي ما بعد الحد) وتقارير المخازن: الراكدة، والاستهلاك حسب القسم، والأوامر المتأخرة، وأداء الموردين
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

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph14-'));
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
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P14', name: 'مستودع المرحلة 14' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P14', name: 'مورد المرحلة 14' })).j.supplier.id);
});
test.after(async () => { await app.close(); });

test('8.1 ترقيم الصفحات: أكثر من 500 صنف يظهر كله صفحةً صفحة مع العدد الكلي', async () => {
  const ins = app.db.prepare('INSERT INTO proc_items (code, name, unit, warehouse_id, created_at) VALUES (?,?,?,?,?)');
  for (let i = 0; i < 520; i += 1) ins.run(`BULK-${String(i).padStart(4, '0')}`, `صنف ${i}`, 'قطعة', wh, Date.now());
  const p1 = (await call('ord', 'GET', '/api/procurement/items?page=1&size=200')).j;
  assert.equal(p1.total, 520); assert.equal(p1.items.length, 200); assert.equal(p1.page, 1);
  const p3 = (await call('ord', 'GET', '/api/procurement/items?page=3&size=200')).j;
  assert.equal(p3.items.length, 120); assert.equal(p3.items.at(-1).code, 'BULK-0519', 'آخر صنف ظاهر');
  assert.equal((await call('ord', 'GET', '/api/procurement/items?page=1&size=5000')).j.items.length, 200, 'حجم الصفحة لا يتجاوز 200');
  assert.equal((await call('ord', 'GET', '/api/procurement/items?q=BULK-051&page=1&size=50')).j.total, 10, 'العدد الكلي يحترم البحث');
  const s = (await call('ord', 'GET', '/api/procurement/suppliers?page=1&size=10')).j;
  assert.equal(s.total, 1); assert.equal(s.suppliers[0].code, 'SUP-P14');
  app.db.prepare("DELETE FROM proc_items WHERE code LIKE 'BULK-%'").run();
});

test('8.2 التقارير: الراكدة، والاستهلاك حسب القسم ناقص المرتجع، والمتأخرة، وأداء الموردين', async () => {
  const a = (await call('ord', 'POST', '/api/procurement/items', { name: 'حبر أسود', unit: 'علبة', warehouseId: wh })).j.item;
  const b = (await call('ord', 'POST', '/api/procurement/items', { name: 'دباسات', unit: 'قطعة', warehouseId: wh })).j.item;
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'تموين قرطاسية للفصل الدراسي', deliveryDay: '2026-01-10', lines: [
    { itemId: a.id, description: 'حبر', qty: 10, unitCost: 1000 }, { itemId: b.id, description: 'دباسات', qty: 5, unitCost: 2000 }] })).j.order;
  await call('keeper', 'POST', `/api/procurement/orders/${o.id}/order`);
  assert.equal((await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: a.id, qty: 10 }, { itemId: b.id, qty: 5 }] })).s, 201);
  const is = (await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, department: 'المكتبة', issuedTo: 'المكتبة', lines: [{ itemId: a.id, qty: 4 }] })).j;
  await call('keeper', 'POST', '/api/procurement/returns', { warehouseId: wh, issueId: is.issueId, reason: 'فائض عن الحاجة', lines: [{ itemId: a.id, qty: 1 }] });

  const st = (await call('ord', 'GET', '/api/procurement/reports/stagnant?days=30')).j;
  assert.deepEqual(st.items.map((x) => x.code), [b.code], 'الدباسات لم يُصرف منها شيء');
  assert.equal(st.totalValue, 10000);

  const cons = (await call('ord', 'GET', '/api/procurement/reports/consumption')).j;
  assert.deepEqual(cons.departments.map((d) => [d.department, d.value]), [['المكتبة', 3000]], '4 − 1 مرتجع × 1000');

  // أمر بتاريخ توصيل فائت لم يُستلم
  const late = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'أمر لاختبار التأخر في التوريد', deliveryDay: '2026-01-05', lines: [{ itemId: a.id, description: 'حبر', qty: 2, unitCost: 1000 }] })).j.order;
  await call('keeper', 'POST', `/api/procurement/orders/${late.id}/order`);
  const dl = (await call('ord', 'GET', '/api/procurement/reports/delayed')).j;
  assert.deepEqual(dl.orders.map((x) => x.no), [late.no]); assert.ok(dl.orders[0].lateDays > 0); assert.equal(dl.orders[0].receivedPct, 0);

  const sp = (await call('ord', 'GET', '/api/procurement/reports/suppliers')).j.suppliers[0];
  assert.equal(sp.orders, 2); assert.equal(sp.completed, 1); assert.equal(sp.onTimePct, 0, 'استُلم بعد تاريخ التوصيل المطلوب');
  assert.equal((await call('ord', 'GET', '/api/procurement/reports/nothing')).s, 404);
});
