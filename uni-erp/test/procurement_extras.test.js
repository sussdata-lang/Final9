// المشتريات حسب الواقع: مورد يُكتب اسمه، إرسال الأمر إلى المورد، صنف جديد عند الاستلام، مرفقات الفاتورة، رمز QR للصنف
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, ck, ck2, wh;
// أوامر هذا الملف مباشرة (بلا طلب شراء): سبب مكتوب، ويرسلها للمورد شخص غير منشئها (فصل المهام)
const call = async (m, u, body, raw = false) => {
  if (m === 'POST' && u === '/api/procurement/orders' && body && !body.requestId) body = { directReason: 'أمر مباشر لاختبار المشتريات حسب الواقع', ...body };
  const cookie = /\/orders\/\d+\/(dispatch|order)$/.test(u) || u === '/api/procurement/receipts' ? ck2 : ck;
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const line = (o = {}) => ({ description: 'طابعة ليزرية ملونة', unit: 'جهاز', qty: 2, unitCost: 1500000, ...o });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-procx-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES ('boss', 'مدير المشتريات', ?, 'admin', ?, 0)").run(h, Date.now());
  app.limiter.hits.clear();
  ck = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: PW }) })).headers.get('set-cookie').split(';')[0];
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES ('boss2', 'معتمد المشتريات', ?, 'admin', ?, 0)").run(h, Date.now());
  app.limiter.hits.clear();
  ck2 = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss2', password: PW }) })).headers.get('set-cookie').split(';')[0];
  const w = await call('POST', '/api/procurement/warehouses', { code: 'WH-T1', name: 'مستودع الاختبار' });
  assert.equal(w.s, 201, JSON.stringify(w.j)); wh = Number(w.j.warehouse.id);
});
test.after(async () => { await app.close(); });

test('المورد: من القائمة أو اسم مكتوب يُسجَّل «غير معتمد»، والاسم نفسه لا يُكرَّر، وبلا مورد يُرفض', async () => {
  assert.equal((await call('POST', '/api/procurement/orders', { lines: [line()] })).s, 400, 'بلا مورد');
  const a = await call('POST', '/api/procurement/orders', { supplierName: 'مكتبة النور للقرطاسية', supplierMobile: '0944112233', lines: [line()] });
  assert.equal(a.s, 201, JSON.stringify(a.j));
  assert.equal(a.j.order.supplierName, 'مكتبة النور للقرطاسية'); assert.equal(a.j.order.supplierApproved, false); assert.match(a.j.order.supplierCode, /^ADH-\d{5}$/);
  const b = await call('POST', '/api/procurement/orders', { supplierName: 'مكتبة النور للقرطاسية', lines: [line({ qty: 1 })] });
  assert.equal(b.j.order.supplierId, a.j.order.supplierId, 'الاسم نفسه = المورد نفسه');
  // اعتماد المورد لاحقاً من قائمة الموردين
  assert.equal((await call('PUT', `/api/procurement/suppliers/${a.j.order.supplierId}`, { approved: true })).s, 200);
  assert.equal((await call('GET', '/api/procurement/suppliers')).j.suppliers.find((s) => s.id === a.j.order.supplierId).approved, true);
  // المورد المقترح في طلب الشراء: اسم مكتوب
  const rq = await call('POST', '/api/procurement/requests', { title: 'تأمين طابعات للمكتبة', supplierName: 'شركة الأفق التقنية', lines: [{ description: 'طابعة', qty: 1, estCost: 100 }] });
  assert.equal(rq.s, 201, JSON.stringify(rq.j)); assert.equal(rq.j.request.supplierName, 'شركة الأفق التقنية');
});

test('إرسال الأمر إلى المورد: يعتمد المسودة ويسجّل القناة والجهة ويعدّ رابط الإرسال من جهاز المستخدم', async () => {
  const o = (await call('POST', '/api/procurement/orders', { supplierName: 'مؤسسة البرق للأجهزة', lines: [line()] })).j.order;
  assert.equal(o.status, 'draft');
  assert.equal((await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'pigeon' })).s, 400);
  assert.equal((await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'whatsapp' })).s, 400, 'لا رقم للمورد');
  assert.equal((await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'email', recipient: 'ليس بريداً' })).s, 400);
  const d = await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'whatsapp', recipient: '0944 112 233', note: 'نسخة أولى' });
  assert.equal(d.s, 200, JSON.stringify(d.j));
  assert.equal(d.j.order.status, 'ordered', 'اعتُمد بالإرسال'); assert.equal(d.j.approvedNow, true);
  assert.match(d.j.link, /^https:\/\/wa\.me\/963944112233\?text=/);
  assert.match(d.j.text, new RegExp(`أمر شراء رقم ${o.no}`));
  const e = await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'email', recipient: 'sales@barq.example' });
  assert.match(e.j.link, /^mailto:sales@barq\.example\?subject=/);
  assert.deepEqual(e.j.order.dispatches.map((x) => x.channel), ['email', 'whatsapp']);
  await call('POST', `/api/procurement/orders/${o.id}/cancel`);
  assert.equal((await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'hand' })).s, 409, 'لا يُرسل الملغى');
});

test('الاستلام: مادة لم تُعرَّف من قبل تُعرَّف صنفاً عند استلامها ويُربط بها بند الأمر', async () => {
  const o = (await call('POST', '/api/procurement/orders', { supplierName: 'مؤسسة البرق للأجهزة', lines: [line({ description: 'ماسح ضوئي A3', unit: 'جهاز', qty: 3, unitCost: 900000 })] })).j.order;
  await call('POST', `/api/procurement/orders/${o.id}/dispatch`, { channel: 'hand' });
  const lineId = o.lines[0].id;
  const r = await call('POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ orderLineId: lineId, qty: 3, newItem: { name: 'ماسح ضوئي A3', unit: 'جهاز', warehouseId: wh } }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.status, 'received');
  const it = (await call('GET', '/api/procurement/items?q=' + encodeURIComponent('ماسح ضوئي'))).j.items[0];
  assert.match(it.code, /^ITM-\d{5}$/); assert.equal(Number(it.qtyOnHand), 3); assert.equal(Number(it.warehouseId), wh);
  assert.equal((await call('GET', `/api/procurement/orders/${o.id}`)).j.order.lines[0].itemId, it.id, 'البند صار مربوطاً بالصنف');
});

test('مرفقات الأمر: فاتورة PDF أو صورة ممسوحة، تُنزَّل كما رُفعت، ويُرفض غير ذلك', async () => {
  const o = (await call('POST', '/api/procurement/orders', { supplierName: 'مكتبة النور للقرطاسية', lines: [line()] })).j.order;
  const pdf = Buffer.from('%PDF-1.4\n% فاتورة تجريبية\n');
  assert.equal((await call('POST', `/api/procurement/orders/${o.id}/files`, { kind: 'invoice', files: [{ name: 'a.txt', data: Buffer.from('نص').toString('base64') }] })).s, 415);
  const up = await call('POST', `/api/procurement/orders/${o.id}/files`, { kind: 'invoice', files: [{ name: 'فاتورة 125.pdf', data: pdf.toString('base64') }] });
  assert.equal(up.s, 201, JSON.stringify(up.j));
  const f = up.j.order.files[0];
  assert.deepEqual([f.kind, f.name, f.mime], ['invoice', 'فاتورة 125.pdf', 'application/pdf']);
  const dl = await call('GET', `/api/procurement/order-files/${f.id}`, null, true);
  assert.equal(dl.s, 200); assert.ok(dl.buf.equals(pdf));
  assert.equal((await call('DELETE', `/api/procurement/order-files/${f.id}`)).j.order.files.length, 0);
});

test('رمز QR للصنف: يُولَّد أو يُحفظ من ملصق مقروء، فريد، وتُعرض صورته ويُبحث به', async () => {
  const a = (await call('POST', '/api/procurement/items', { code: 'QR-A', name: 'كرسي مكتب', unit: 'قطعة', warehouseId: wh })).j.item;
  const b = (await call('POST', '/api/procurement/items', { code: 'QR-B', name: 'طاولة اجتماعات', unit: 'قطعة', warehouseId: wh, qrCode: 'LABEL-0001' })).j.item;
  assert.equal(b.qr_code, 'LABEL-0001', 'رمز مقروء عند التعريف');
  const g = await call('POST', `/api/procurement/items/${a.id}/qr`, { generate: true });
  assert.equal(g.s, 200, JSON.stringify(g.j)); assert.match(g.j.item.qrCode, /^SUSS-ITM-QR-A-[0-9A-F]{6}$/);
  assert.equal((await call('POST', `/api/procurement/items/${a.id}/qr`, { code: 'LABEL-0001' })).s, 409, 'فريد');
  const svg = await call('GET', `/api/procurement/items/${a.id}/qr.svg`, null, true);
  assert.equal(svg.s, 200); assert.match(svg.type, /svg/); assert.match(svg.buf.toString(), /<svg/);
  assert.equal((await call('GET', '/api/procurement/item-by-qr?code=LABEL-0001')).j.item.id, b.id);
  assert.equal((await call('GET', '/api/procurement/item-by-qr?code=NOPE')).s, 404);
});
