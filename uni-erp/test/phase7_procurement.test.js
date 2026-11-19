// المرحلة 7: بقية البنود العاجلة من تقرير المشتريات — طلب العروض (إلغاء، سحب، موعد الإغلاق)، إعادة الطلب للتعديل،
// فصل التسوية عن الاستلام، ومنع منشئ الأمر من استلامه، وتحقق الأصناف والموردين والأصول برسائل واضحة، وطلب النواقص
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
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
async function approvedRequest(title, lines) {
  const rq = (await call('req', 'POST', '/api/procurement/requests', { title, submit: true, lines })).j.request;
  assert.equal((await call('appr', 'POST', `/api/procurement/requests/${rq.id}/approve`, { note: 'موافق' })).s, 200);
  return rq;
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph7-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  readyFinance(app.db);
  const h = await hashPassword(PW, 1024);
  for (const u of ['req', 'appr', 'ord', 'keeper']) {
    app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, 'admin', ?, 0)").run(u, `مستخدم ${u}`, h, Date.now());
    app.limiter.hits.clear();
    ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  }
  // أمين مستودع: استلام وصرف فقط، بلا تسوية جرد
  const k = app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password, access_mode, custom_permissions_json) VALUES ('store', 'أمين المستودع', ?, 'staff', ?, 0, 'custom', ?) RETURNING id").get(h, Date.now(), JSON.stringify(['procurement:read', 'procurement:stock']));
  assert.ok(k);
  app.limiter.hits.clear();
  ck.store = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'store', password: PW }) })).headers.get('set-cookie').split(';')[0];
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P7', name: 'مستودع المرحلة 7' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P7', name: 'مورد المرحلة 7', taxNo: '700100' })).j.supplier.id);
  item = (await call('ord', 'POST', '/api/procurement/items', { code: 'P7-001', name: 'حبر طابعة', unit: 'علبة', warehouseId: wh, minStock: 2, maxStock: 20 })).j.item;
});
test.after(async () => { await app.close(); });

test('3.4 و3.5: طلب العروض يُلغى بسبب ويُفتح غيره، والعرض يُسحب، والعرض المتأخر يُرفض، والترسية قبل الموعد تحتاج تبريراً', async () => {
  const rq = await approvedRequest('حبر للطابعات', [{ itemId: item.id, description: 'حبر', qty: 4, estCost: 50000 }]);
  assert.equal((await call('ord', 'POST', '/api/procurement/rfqs', { requestId: rq.id, closesOn: day(-1) })).s, 400, 'موعد في الماضي');
  const f1 = (await call('ord', 'POST', '/api/procurement/rfqs', { requestId: rq.id, closesOn: day(5) })).j;
  assert.equal((await call('ord', 'POST', `/api/procurement/rfqs/${f1.id}/cancel`, {})).j.code, 'reason_required');
  assert.equal((await call('ord', 'POST', `/api/procurement/rfqs/${f1.id}/cancel`, { reason: 'أُنشئ بالخطأ بموعد خاطئ' })).s, 200);
  const f2 = (await call('ord', 'POST', '/api/procurement/rfqs', { requestId: rq.id, closesOn: day(5) })).j;
  assert.ok(f2.id, 'طلب عروض جديد للطلب نفسه بعد الإلغاء');
  const line = Number(app.db.prepare('SELECT id FROM proc_request_lines WHERE request_id = ?').get(rq.id).id);
  const q = await call('ord', 'POST', `/api/procurement/rfqs/${f2.id}/quotes`, { supplierId: sup, prices: { [line]: 48000 }, deliveryDays: 3 });
  assert.equal(q.s, 201, JSON.stringify(q.j));
  assert.equal((await call('ord', 'POST', `/api/procurement/rfqs/${f2.id}/quotes/${q.j.id}/withdraw`, { reason: 'سجّل بالخطأ بسعر غير صحيح' })).s, 200);
  const q2 = (await call('ord', 'POST', `/api/procurement/rfqs/${f2.id}/quotes`, { supplierId: sup, prices: { [line]: 47000 }, deliveryDays: 3 })).j;
  const early = await call('ord', 'POST', `/api/procurement/rfqs/${f2.id}/award`, { quoteId: q2.id });
  assert.equal(early.s, 409); assert.match(early.j.message, /قبل انتهاء موعد العروض/);
  // بعد الموعد: العرض المتأخر يُرفض
  app.db.prepare('UPDATE proc_rfqs SET closes_on = ? WHERE id = ?').run(day(-1), f2.id);
  const sup2 = Number(app.db.prepare("INSERT INTO proc_suppliers (code, name, created_at) VALUES ('SUP-P7B', 'مورد متأخر', ?) RETURNING id").get(Date.now()).id);
  assert.equal((await call('ord', 'POST', `/api/procurement/rfqs/${f2.id}/quotes`, { supplierId: sup2, prices: { [line]: 1000 }, deliveryDays: 1 })).j.code, 'rfq_closed');
  // ترسية (عرض واحد أقل من الحد: بتبرير)، ثم إلغاء الأمر يعيد طلب العروض مفتوحاً
  const aw = await call('ord', 'POST', `/api/procurement/rfqs/${f2.id}/award`, { quoteId: q2.id, note: 'مورد وحيد معتمد لهذا الحبر الأصلي' });
  assert.equal(aw.s, 200, JSON.stringify(aw.j));
  assert.equal((await call('ord', 'POST', `/api/procurement/orders/${aw.j.orderId}/cancel`)).s, 200);
  assert.equal(app.db.prepare('SELECT status FROM proc_rfqs WHERE id = ?').get(f2.id).status, 'open', 'عاد مفتوحاً لترسية أخرى');
});

test('3.7 إعادة الطلب للتعديل: يعود مسودة برقمه ويُعتمد من أوله', async () => {
  const rq = (await call('req', 'POST', '/api/procurement/requests', { title: 'أوراق امتحانية', submit: true, lines: [{ description: 'ورق', qty: 100, estCost: 5000 }] })).j.request;
  assert.equal((await call('appr', 'POST', `/api/procurement/requests/${rq.id}/return`, { note: '' })).j.code, 'reason_required');
  const r = await call('appr', 'POST', `/api/procurement/requests/${rq.id}/return`, { note: 'خفّض الكمية إلى 60' });
  assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.request.status, 'draft'); assert.equal(r.j.request.no, rq.no); assert.equal(r.j.request.returnReason, 'خفّض الكمية إلى 60');
  const u = await call('req', 'PUT', `/api/procurement/requests/${rq.id}`, { submit: true, lines: [{ description: 'ورق', qty: 60, estCost: 5000 }] });
  assert.equal(u.s, 200, JSON.stringify(u.j)); assert.equal(u.j.request.status, 'pending');
  assert.equal(u.j.request.approval.done.length, 0, 'الاعتماد من أوله');
});

test('5.3 و5.2: أمين المستودع لا يسوّي الجرد، والتسوية بسبب مفصّل ورصيد لم يتحرك، ومنشئ الأمر لا يستلمه', async () => {
  assert.equal((await call('store', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 5, reason: 'محضر جرد رقم 3 لعام 2026' })).s, 403);
  assert.equal((await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 5, reason: 'تسوية جرد مخزني' })).j.code, 'reason_required');
  assert.equal((await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 5, expectedQty: 99, reason: 'محضر جرد رقم 3 لعام 2026' })).j.code, 'stock_changed');
  assert.equal((await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 5, expectedQty: 0, reason: 'محضر جرد رقم 3 لعام 2026' })).s, 200);
  const rq = await approvedRequest('حبر إضافي', [{ itemId: item.id, description: 'حبر', qty: 2, estCost: 50000 }]);
  const o = (await call('ord', 'POST', '/api/procurement/orders', { requestId: rq.id, supplierId: sup, lines: [{ itemId: item.id, description: 'حبر', qty: 2, unitCost: 50000 }] })).j.order;
  await call('ord', 'POST', `/api/procurement/orders/${o.id}/order`);
  assert.equal((await call('ord', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: item.id, qty: 2 }] })).j.code, 'sod_violation');
  assert.equal((await call('store', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: item.id, qty: 2 }] })).s, 201);
});

test('6.1 و6.4 و6.5: حدود الصنف ورمزه وتكراره، والرقم الضريبي، والأصول برسائل واضحة', async () => {
  assert.equal((await call('ord', 'POST', '/api/procurement/items', { code: 'P7-002', name: 'دبابيس', minStock: 10, maxStock: 5 })).s, 400, 'الأعلى أصغر من الأدنى');
  assert.equal((await call('ord', 'POST', '/api/procurement/items', { code: 'P7-003', name: 'دبابيس', minStock: -1 })).s, 400);
  assert.equal((await call('ord', 'POST', '/api/procurement/items', { code: 'P7-004', name: 'حبر  طابعة' })).j.code, 'duplicate_name');
  assert.equal((await call('ord', 'POST', '/api/procurement/items', { code: 'P7-004', name: 'حبر  طابعة', allowDuplicate: true })).s, 201);
  assert.equal((await call('ord', 'PUT', `/api/procurement/items/${item.id}`, { code: 'P7-999' })).j.code, 'code_locked', 'للصنف حركات');
  assert.equal((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P7C', name: 'مورد آخر', taxNo: '700100' })).j.code, 'duplicate_tax_no');
  assert.equal((await call('ord', 'POST', '/api/procurement/assets', { code: 'AS-P7', name: 'جهاز عرض', status: 'disposed' })).s, 400);
  assert.equal((await call('ord', 'POST', '/api/procurement/assets', { code: 'AS-P7', name: 'جهاز عرض', cost: 'abc' })).s, 400);
  const a = (await call('ord', 'POST', '/api/procurement/assets', { code: 'AS-P7', name: 'جهاز عرض', cost: 900000, assignedTo: 'د. سامر' })).j.asset;
  assert.equal((await call('ord', 'PUT', `/api/procurement/assets/${a.id}`, { status: 'disposed' })).j.code, 'dispose_by_move');
  assert.equal((await call('ord', 'POST', `/api/procurement/assets/${a.id}/move`, { kind: 'return' })).j.asset.assigned_to, '', 'الإرجاع ينهي العهدة');
  assert.equal((await call('ord', 'POST', `/api/procurement/assets/${a.id}/move`, { kind: 'dispose', reason: 'قصير' })).j.code, 'reason_required');
  // الإتلاف بخطوتين (المرحلة 13): حركة «إتلاف» تصير طلباً، ويعتمده شخص آخر
  const req = (await call('ord', 'POST', `/api/procurement/assets/${a.id}/move`, { kind: 'dispose', reason: 'محضر إتلاف رقم 7 — عطل غير قابل للإصلاح' })).j;
  assert.equal(req.disposalPending, true); assert.equal(req.asset.status, 'available');
  assert.equal((await call('appr', 'POST', `/api/procurement/assets/${a.id}/dispose-approve`)).j.asset.status, 'disposed');
});

test('13.5 طلب النواقص: كل الأصناف دون الحد، مسودة لا تُرسل، ولا يتكرر لصنف له طلب مفتوح', async () => {
  const ids = [];
  for (let i = 0; i < 14; i += 1) ids.push((await call('ord', 'POST', '/api/procurement/items', { code: `P7-L${i}`, name: `مادة ناقصة ${i}`, minStock: 3, maxStock: 9 })).j.item.id);
  for (const id of ids) app.db.prepare('UPDATE proc_items SET avg_cost = 1000 WHERE id = ?').run(id);
  const r = await call('ord', 'POST', '/api/procurement/requests/replenish', {});
  assert.equal(r.s, 201, JSON.stringify(r.j));
  assert.equal(r.j.request.status, 'draft', 'مسودة للمراجعة');
  const got = r.j.request.lines.filter((l) => ids.includes(l.itemId));
  assert.equal(got.length, 14, 'أكثر من 12 صنفاً');
  assert.equal(got[0].qty, 9, 'حتى الحد الأعلى');
  const again = await call('ord', 'POST', '/api/procurement/requests/replenish', {});
  assert.ok(!again.j.request || !again.j.request.lines.some((l) => ids.includes(l.itemId)), 'لا تكرار لصنف له طلب مفتوح');
});

test('6.7 لا يُوقف مورد له أمر مفتوح', async () => {
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'شراء عاجل لاختبار إيقاف المورد', lines: [{ description: 'بند', qty: 1, unitCost: 100 }] })).j.order;
  assert.equal((await call('ord', 'POST', `/api/procurement/suppliers/${sup}/toggle`, { active: false })).j.code, 'open_orders');
  await call('ord', 'POST', `/api/procurement/orders/${o.id}/cancel`);
  assert.equal((await call('ord', 'POST', `/api/procurement/suppliers/${sup}/toggle`, { active: false })).s, 200);
});
