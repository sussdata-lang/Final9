// حقول نماذج الجامعة الرسمية في المشتريات: طلب الشراء، وأمر الشراء، ومذكرة فحص واستلام المواد، ومحضر إخراج المواد، وبيانات تواصل المورّد.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, adm, adm2, wh, item, sup;
const api = async (m, u, body, cookie) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie || adm }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-procforms-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
  adm = r.headers.get('set-cookie').split(';')[0];
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin2', 'مدير ثانٍ', await hashPassword(PW, 1024), 'admin', Date.now());
  adm2 = (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin2', password: PW }) })).headers.get('set-cookie').split(';')[0];
  wh = (await api('POST', '/api/procurement/warehouses', { code: 'WH-T', name: 'المخزن الرئيسي', location: 'المبنى A' })).j.warehouse.id;
  item = (await api('POST', '/api/procurement/items', { code: 'IT-PRN', name: 'طابعة ليزر', unit: 'قطعة', warehouseId: wh })).j.item.id;
  sup = (await api('POST', '/api/procurement/suppliers', { code: 'SUP-T', name: 'شركة الأمل للتوريدات', phone: '0112123456', email: 's@example.com', address: 'دمشق', contactPerson: 'سامر الأحمد', fax: '0112123457', mobile: '0944123456', specialty: 'أجهزة مكتبية' })).j.supplier.id;
});
test.after(async () => { if (app) await app.close(); });

test('المورّد: بيانات التواصل الإضافية تُحفظ وتُعرض', async () => {
  const s = (await api('GET', '/api/procurement/suppliers')).j.suppliers.find((x) => x.id === sup);
  assert.equal(s.contactPerson, 'سامر الأحمد'); assert.equal(s.fax, '0112123457'); assert.equal(s.mobile, '0944123456'); assert.equal(s.specialty, 'أجهزة مكتبية');
  const u = await api('PUT', `/api/procurement/suppliers/${sup}`, { mobile: '0955123456' });
  assert.equal(u.s, 200);
  const s2 = (await api('GET', '/api/procurement/suppliers')).j.suppliers.find((x) => x.id === sup);
  assert.equal(s2.mobile, '0955123456'); assert.equal(s2.contactPerson, 'سامر الأحمد');
});

let reqId;
test('طلب الشراء: رأس النموذج وبيانات البنود (الموازنة والمواصفات والواحدة ورصيد المستودع)', async () => {
  app.db.prepare('UPDATE proc_items SET qty_on_hand = 3 WHERE id = ?').run(item);
  const r = await api('POST', '/api/procurement/requests', {
    title: 'طابعات للمكتبة', description: 'استبدال أجهزة متعطلة', warehouseId: wh,
    department: 'المكتبة', jobTitle: 'سكرتير', directManager: 'رئيس قسم المكتبة', purchaseThreshold: 'شراء مباشر', needDay: '2026-11-20', amountWords: 'مليونان وأربعمئة ألف ليرة سورية',
    lines: [{ itemId: item, description: 'طابعة ليزر', qty: 2, estCost: 1200000, budgetCode: 'B-5401-01', specs: 'طابعة مكتبية مقاس A4' }, { description: 'ورق طباعة', qty: 20, estCost: 15000, unit: 'رزمة', stockBalance: 12 }],
  });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  const q = r.j.request; reqId = q.id;
  assert.equal(q.department, 'المكتبة'); assert.equal(q.jobTitle, 'سكرتير'); assert.equal(q.directManager, 'رئيس قسم المكتبة');
  assert.equal(q.purchaseThreshold, 'شراء مباشر'); assert.equal(q.needDay, '2026-11-20'); assert.match(q.amountWords, /مليونان/);
  assert.equal(q.lines[0].budgetCode, 'B-5401-01'); assert.equal(q.lines[0].specs, 'طابعة مكتبية مقاس A4');
  assert.equal(q.lines[0].unit, 'قطعة', 'الواحدة من بطاقة الصنف'); assert.equal(q.lines[0].stockBalance, 3, 'رصيد المستودع لحظة الطلب');
  assert.equal(q.lines[1].unit, 'رزمة'); assert.equal(q.lines[1].stockBalance, 12);
  const listed = (await api('GET', '/api/procurement/requests')).j.requests.find((x) => x.id === reqId);
  assert.equal(listed.jobTitle, 'سكرتير');
});

test('طلب الشراء: تاريخ حاجة غير صالح يُرفض، والتعديل يحفظ الرأس', async () => {
  const bad = await api('POST', '/api/procurement/requests', { title: 'طلب خاطئ', needDay: '2026-13-40', lines: [{ description: 'بند', qty: 1 }] });
  assert.equal(bad.s, 400);
  const u = await api('PUT', `/api/procurement/requests/${reqId}`, { directManager: 'عميد الكلية' });
  assert.equal(u.s, 200, JSON.stringify(u.j));
  assert.equal(u.j.request.directManager, 'عميد الكلية'); assert.equal(u.j.request.jobTitle, 'سكرتير');
});

let orderId;
test('أمر الشراء: التوصيل والفوترة والضرائب والمجموع الكامل وبيانات المورّد', async () => {
  const r = await api('POST', '/api/procurement/orders', {
    supplierId: sup, directReason: 'أمر مباشر لاختبار نموذج الجامعة', deliveryMethod: 'توصيل المورّد', deliveryDay: '2026-11-25', paymentTerms: 'نقدًا', currency: 'ليرة سورية',
    deliveryContact: 'أمين المستودع', deliveryEmail: 'stores@example.com', deliveryAddress: 'المخزن الرئيسي', billingContact: 'المحاسب', billingEmail: 'fin@example.com',
    salesTax: 10000, deliveryTax: 50000, otherTax: 0,
    lines: [{ itemId: item, description: 'طابعة ليزر', qty: 2, unitCost: 1150000 }],
  });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  const o = r.j.order; orderId = o.id;
  assert.equal(o.totalAmount, 2300000); assert.equal(o.grandTotal, 2360000);
  assert.equal(o.deliveryMethod, 'توصيل المورّد'); assert.equal(o.deliveryDay, '2026-11-25'); assert.equal(o.billingContact, 'المحاسب');
  assert.equal(o.supplier.contactPerson, 'سامر الأحمد'); assert.equal(o.lines[0].unit, 'قطعة');
  assert.equal((await api('POST', '/api/procurement/orders', { supplierId: sup, directReason: 'أمر مباشر لاختبار الضريبة السالبة', salesTax: -5, lines: [{ description: 'بند', qty: 1, unitCost: 1 }] })).s, 400, 'ضريبة سالبة مرفوضة');
});

test('مذكرة فحص واستلام: بيان الشحنة والموقع والتوافق والكمية المتوقعة وفحص الجودة', async () => {
  assert.equal((await api('POST', `/api/procurement/orders/${orderId}/order`, undefined, adm2)).s, 200, 'يرسله شخص غير منشئه');
  const r = await api('POST', '/api/procurement/receipts', { orderId, deliveryNoteNo: 'DN-4471', location: 'المخزن الرئيسي', compliant: true, note: 'سليمة', lines: [{ itemId: item, qty: 2, quality: 'مطابق', comment: 'بلا ملاحظات' }] }, adm2);
  assert.equal(r.s, 201, JSON.stringify(r.j));
  const rc = (await api('GET', `/api/procurement/receipts?orderId=${orderId}`)).j.receipts[0];
  assert.equal(rc.deliveryNoteNo, 'DN-4471'); assert.equal(rc.location, 'المخزن الرئيسي'); assert.equal(rc.compliant, true);
  assert.equal(rc.receivedFrom, 'شركة الأمل للتوريدات', 'المستلم منه افتراضياً اسم المورّد');
  assert.equal(rc.lines[0].expectedQty, 2, 'الكمية المتوقعة من أمر الشراء'); assert.equal(rc.lines[0].quality, 'مطابق'); assert.equal(rc.lines[0].unit, 'قطعة');
  assert.match(rc.no, /^RCV-\d{4}$/);
});

test('محضر إخراج المواد: الكمية المطلوبة والمصروفة والرصيد بعد الصرف وحالة المادة', async () => {
  const before = Number(app.db.prepare('SELECT qty_on_hand FROM proc_items WHERE id = ?').get(item).qty_on_hand);
  const r = await api('POST', '/api/procurement/issues', { warehouseId: wh, department: 'المكتبة', receiverName: 'زياد الجندي', requestRef: 'SR-2026-0031', purpose: 'احتياج شهري', lines: [{ itemId: item, qty: 1, requestedQty: 2, itemCondition: 'جديدة', note: 'الباقي لاحقاً' }] });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  const is = (await api('GET', '/api/procurement/issues')).j.issues.find((x) => x.no === r.j.no);
  assert.equal(is.issuedTo, 'المكتبة — زياد الجندي', 'الجهة المستلمة من القسم واسم المستلم');
  assert.equal(is.requestRef, 'SR-2026-0031'); assert.equal(is.department, 'المكتبة'); assert.equal(is.receiverName, 'زياد الجندي'); assert.equal(is.warehouseLocation, 'المبنى A');
  assert.deepEqual([is.lines[0].requestedQty, is.lines[0].qty, is.lines[0].balanceAfter, is.lines[0].itemCondition, is.lines[0].unit], [2, 1, before - 1, 'جديدة', 'قطعة']);
  const over = await api('POST', '/api/procurement/issues', { warehouseId: wh, issuedTo: 'المكتبة', lines: [{ itemId: item, qty: 2, requestedQty: 1 }] });
  assert.equal(over.s, 400, 'المصروف لا يزيد على المطلوب');
});

test('التوافق: الطلب والأمر القديمان بلا الحقول الجديدة ما زالا يعملان', async () => {
  const r = await api('POST', '/api/procurement/requests', { title: 'طلب بسيط', lines: [{ description: 'بند عادي', qty: 1, estCost: 10 }] });
  assert.equal(r.s, 201); assert.equal(r.j.request.department, ''); assert.equal(r.j.request.lines[0].stockBalance, null);
  const o = await api('POST', '/api/procurement/orders', { supplierId: sup, directReason: 'أمر مباشر لاختبار التوافق', lines: [{ description: 'بند', qty: 1, unitCost: 5 }] });
  assert.equal(o.s, 201); assert.equal(o.j.order.currency, 'ليرة سورية'); assert.equal(o.j.order.grandTotal, 5);
});
