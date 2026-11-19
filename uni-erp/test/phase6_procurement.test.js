// المرحلة 6: ضوابط دورة الشراء العاجلة من تقرير فحص المشتريات والمخازن
// السعر التقديري الصفري، الأمر المباشر وفصل المهام، تقييد الأمر بالطلب، إلغاء الأمر، الاستلام بالمتبقي، بنود الخدمات، تعذّر قيد الاستلام
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, wh, item;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};
// طلب معتمد: يقدّمه req ويعتمده appr، فيُصدر الأمر ord
async function approvedRequest(lines) {
  const rq = await call('req', 'POST', '/api/procurement/requests', { title: 'تأمين مستلزمات المخبر', warehouseId: wh, submit: true, lines });
  assert.equal(rq.s, 201, JSON.stringify(rq.j));
  const ap = await call('appr', 'POST', `/api/procurement/requests/${rq.j.request.id}/approve`, { note: 'موافق' });
  assert.equal(ap.s, 200, JSON.stringify(ap.j)); assert.equal(ap.j.request.status, 'approved');
  return rq.j.request;
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph6-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  readyFinance(app.db);
  const h = await hashPassword(PW, 1024);
  for (const u of ['req', 'appr', 'ord', 'ord2']) {
    app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, 'admin', ?, 0)").run(u, `مستخدم ${u}`, h, Date.now());
    app.limiter.hits.clear();
    ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  }
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P6', name: 'مستودع المرحلة 6' })).j.warehouse.id);
  const it = await call('ord', 'POST', '/api/procurement/items', { code: 'P6-001', name: 'ورق تصوير A4', unit: 'رزمة', warehouseId: wh });
  assert.equal(it.s, 201, JSON.stringify(it.j)); item = it.j.item;
});
test.after(async () => { await app.close(); });

test('13.2 السعر التقديري: الصفر يُرفض، والصنف ذو متوسط تكلفة يأخذه', async () => {
  const z = await call('req', 'POST', '/api/procurement/requests', { title: 'طلب بسعر صفري', lines: [{ description: 'حواسيب', qty: 40, estCost: 0 }] });
  assert.equal(z.s, 400); assert.equal(z.j.code || z.j.error, 'est_cost_required');
  app.db.prepare('UPDATE proc_items SET avg_cost = 9000 WHERE id = ?').run(item.id);
  const ok = await call('req', 'POST', '/api/procurement/requests', { title: 'ورق للمكاتب', lines: [{ itemId: item.id, description: 'ورق', qty: 3 }] });
  assert.equal(ok.s, 201, JSON.stringify(ok.j)); assert.equal(Number(ok.j.request.lines[0].estCost), 9000);
});

test('3.1 الأمر المباشر: يلزمه سبب، ولا يرسله منشئه بل شخص آخر', async () => {
  const L = [{ description: 'صيانة طابعة', qty: 1, unitCost: 50000 }];
  const noReason = await call('ord', 'POST', '/api/procurement/orders', { supplierName: 'ورشة الصيانة', lines: L });
  assert.equal(noReason.s, 400); assert.equal(noReason.j.code || noReason.j.error, 'direct_reason_required');
  const o = await call('ord', 'POST', '/api/procurement/orders', { supplierName: 'ورشة الصيانة', directReason: 'عطل مفاجئ في طابعة الامتحانات', lines: L });
  assert.equal(o.s, 201, JSON.stringify(o.j)); assert.equal(o.j.order.directReason, 'عطل مفاجئ في طابعة الامتحانات');
  const self = await call('ord', 'POST', `/api/procurement/orders/${o.j.order.id}/order`);
  assert.equal(self.s, 403); assert.equal(self.j.code || self.j.error, 'sod_violation');
  const other = await call('ord2', 'POST', `/api/procurement/orders/${o.j.order.id}/order`);
  assert.equal(other.s, 200, JSON.stringify(other.j)); assert.equal(other.j.order.status, 'ordered');
  // السعر الصفري في الأمر مرفوض
  assert.equal((await call('ord', 'POST', '/api/procurement/orders', { supplierName: 'ورشة الصيانة', directReason: 'سبب مكتوب كافٍ للاختبار', lines: [{ description: 'بند', qty: 1, unitCost: 0 }] })).s, 400);
});

test('3.2 و3.10: بنود الأمر مقيّدة بالطلب، ومن اعتمد الطلب لا يصدر أمره', async () => {
  const rq = await approvedRequest([{ itemId: item.id, description: 'ورق', qty: 10, estCost: 10000 }]);
  const base0 = { requestId: rq.id, supplierName: 'مكتبة الشام' };
  assert.equal((await call('appr', 'POST', '/api/procurement/orders', { ...base0, lines: [{ itemId: item.id, description: 'ورق', qty: 10, unitCost: 10000 }] })).j.code, 'sod_violation');
  assert.equal((await call('ord', 'POST', '/api/procurement/orders', { ...base0, lines: [{ itemId: item.id, description: 'ورق', qty: 11, unitCost: 10000 }] })).j.code, 'qty_over_request');
  assert.equal((await call('ord', 'POST', '/api/procurement/orders', { ...base0, lines: [{ itemId: item.id, description: 'ورق', qty: 10, unitCost: 12000 }] })).j.code, 'price_over_request', 'فوق هامش 10%');
  assert.equal((await call('ord', 'POST', '/api/procurement/orders', { ...base0, lines: [{ description: 'مادة خارج الطلب', qty: 30, unitCost: 10000 }] })).j.code, 'qty_over_request');
  const ok = await call('ord', 'POST', '/api/procurement/orders', { ...base0, lines: [{ itemId: item.id, description: 'ورق', qty: 10, unitCost: 10900 }] });
  assert.equal(ok.s, 201, JSON.stringify(ok.j));
});

test('3.3 و4.2: إلغاء الأمر يعيد الطلب «معتمداً»، ولا يُلغى أمر استُلم منه شيء', async () => {
  const rq = await approvedRequest([{ itemId: item.id, description: 'ورق', qty: 6, estCost: 10000 }]);
  const o1 = (await call('ord', 'POST', '/api/procurement/orders', { requestId: rq.id, supplierName: 'مكتبة الشام', lines: [{ itemId: item.id, description: 'ورق', qty: 6, unitCost: 10000 }] })).j.order;
  assert.equal((await call('ord', 'GET', `/api/procurement/requests/${rq.id}`)).j.request.status, 'ordered');
  assert.equal((await call('ord', 'POST', `/api/procurement/orders/${o1.id}/cancel`)).s, 200);
  assert.equal((await call('ord', 'GET', `/api/procurement/requests/${rq.id}`)).j.request.status, 'approved', 'عاد معتمداً');
  const o2 = (await call('ord', 'POST', '/api/procurement/orders', { requestId: rq.id, supplierName: 'مكتبة الشام', lines: [{ itemId: item.id, description: 'ورق', qty: 6, unitCost: 10000 }] })).j.order;
  assert.ok(o2, 'أمر جديد للطلب نفسه دون إعادة الاعتماد');
  assert.equal((await call('ord', 'POST', `/api/procurement/orders/${o2.id}/order`)).s, 200);
  const r1 = await call('ord2', 'POST', '/api/procurement/receipts', { orderId: o2.id, lines: [{ itemId: item.id, qty: 2 }] });
  assert.equal(r1.s, 201, JSON.stringify(r1.j)); assert.equal(r1.j.status, 'ordered', 'استلام جزئي');
  // 13.10: الأمر يعرض المستلم والمتبقي
  const ln = (await call('ord', 'GET', `/api/procurement/orders/${o2.id}`)).j.order.lines[0];
  assert.equal(ln.receivedQty, 2); assert.equal(ln.remainingQty, 4);
  const c = await call('ord', 'POST', `/api/procurement/orders/${o2.id}/cancel`);
  assert.equal(c.s, 409); assert.equal(c.j.code || c.j.error, 'has_receipts');
  assert.equal((await call('ord2', 'POST', '/api/procurement/receipts', { orderId: o2.id, lines: [{ itemId: item.id, qty: 4 }] })).j.status, 'received');
});

test('4.1 بند الخدمة يُستلم بلا حركة مخزن، والأمر لا يكتمل قبل كل بنوده', async () => {
  const before = Number(app.db.prepare('SELECT qty_on_hand q FROM proc_items WHERE id = ?').get(item.id).q);
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierName: 'شركة التنظيف', directReason: 'عقد تنظيف شهري للمباني', lines: [
    { kind: 'service', description: 'تنظيف المبنى A', qty: 4, unitCost: 200000 },
    { itemId: item.id, description: 'ورق', qty: 1, unitCost: 10000 },
  ] })).j.order;
  assert.equal(o.lines[0].kind, 'service');
  assert.equal((await call('ord2', 'POST', `/api/procurement/orders/${o.id}/order`)).s, 200);
  const svcId = o.lines[0].id;
  const r = await call('ord2', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ orderLineId: svcId, qty: 4 }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.status, 'ordered', 'بند الورق لم يُستلم');
  assert.equal(Number(app.db.prepare('SELECT qty_on_hand q FROM proc_items WHERE id = ?').get(item.id).q), before, 'الخدمة لا تحرّك المخزون');
  assert.equal((await call('ord2', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ orderLineId: svcId, qty: 1 }] })).j.code, 'over_receipt_qty');
  assert.equal((await call('ord2', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: item.id, qty: 1 }] })).j.status, 'received');
  const rl = (await call('ord', 'GET', `/api/procurement/receipts?orderId=${o.id}`)).j.receipts.flatMap((x) => x.lines);
  assert.ok(rl.some((l) => l.itemName === 'تنظيف المبنى A'), 'بند الخدمة ظاهر في سجل الاستلام');
});

test('4.4 تعذّر قيد الاستلام لا يُبتلع: يُسجَّل سببه ويُعاد ترحيله بعد المعالجة', async () => {
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierName: 'مكتبة الشام', directReason: 'تجربة تعذر القيد المحاسبي', lines: [{ itemId: item.id, description: 'ورق', qty: 2, unitCost: 10000 }] })).j.order;
  await call('ord2', 'POST', `/api/procurement/orders/${o.id}/order`);
  const open = app.db.prepare("SELECT id FROM fin_years WHERE status = 'open'").all().map((x) => x.id);
  app.db.prepare("UPDATE fin_years SET status = 'closed' WHERE status = 'open'").run();
  const r = await call('ord2', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: item.id, qty: 2 }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.journalEntryId, null); assert.match(r.j.journalError, /سنة مالية مفتوحة/);
  const listed = (await call('ord', 'GET', `/api/procurement/receipts?orderId=${o.id}`)).j.receipts[0];
  assert.match(listed.journalError, /سنة مالية/);
  for (const id of open) app.db.prepare("UPDATE fin_years SET status = 'open' WHERE id = ?").run(id);
  if (open.length) {
    const re = await call('ord', 'POST', `/api/procurement/receipts/${r.j.receiptId}/post-journal`);
    assert.equal(re.s, 200, JSON.stringify(re.j)); assert.ok(re.j.journalEntryId, 'رُحّل القيد بعد فتح السنة');
    assert.equal((await call('ord', 'GET', `/api/procurement/receipts?orderId=${o.id}`)).j.receipts[0].journalError, null);
  }
});
