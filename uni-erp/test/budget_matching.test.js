import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, adm, chief, cc, acc1, acc2, sup, item, item2, seq = 0;

const api = async (m, u, { body, cookie = adm } = {}) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const put = (values) => api('PUT', '/api/admin/general', { body: { values } });
const yearId = () => Number(app.db.prepare("SELECT id FROM fin_years WHERE status = 'open' ORDER BY start_day DESC LIMIT 1").get().id);
const budget = async (accountId, amount) => {
  const r = await api('POST', '/api/finance/budgets', { body: { yearId: yearId(), costCenterId: cc, accountId, amount } });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  assert.equal((await api('POST', `/api/finance/budgets/${r.j.budget.id}/approve`, { cookie: chief })).s, 200);
  return r.j.budget.id;
};
const budgetOf = async (id) => (await api('GET', '/api/finance/budgets')).j.budgets.find((b) => b.id === id);
async function order(lines, budgetId) {
  const r = await api('POST', '/api/procurement/orders', { body: { supplierId: sup, budgetId, lines: lines.map(([itemId, qty, unitCost]) => ({ itemId, description: `بند ${++seq}`, qty, unitCost })) } });
  assert.ok(r.s < 300, JSON.stringify(r.j));
  return r.j.order;
}
const send = (o) => api('POST', `/api/procurement/orders/${o.id}/order`);
const receive = (o, itemId, qty) => api('POST', '/api/procurement/receipts', { body: { orderId: o.id, lines: [{ itemId, qty }] } });
const lineIds = (o) => app.db.prepare('SELECT id FROM proc_order_lines WHERE order_id = ? ORDER BY id').all(o.id).map((x) => Number(x.id));
const invoice = (o, lines, cookie = adm) => api('POST', '/api/finance/invoices', { cookie, body: { kind: 'purchase', orderId: o.id, supplierRef: 'S-1', lines: lines.map(([orderLineId, qty, unitPrice]) => ({ orderLineId, qty, unitPrice })) } });
const row = (id) => app.db.prepare('SELECT * FROM fin_invoices WHERE id = ?').get(id);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-budget-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now();
  for (const u of ['adm', 'chief']) app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,'admin',?)").run(u, u, hash, now);
  readyFinance(app.db);
  cc = Number(app.db.prepare("INSERT INTO fin_cost_centers (code, name, active) VALUES ('CC-IT', 'تقنية المعلومات', 1) RETURNING id").get().id);
  acc1 = Number(app.db.prepare("SELECT id FROM fin_accounts WHERE code = '5401'").get().id);
  acc2 = Number(app.db.prepare("SELECT id FROM fin_accounts WHERE type = 'expense' AND postable = 1 AND active = 1 AND code <> '5401' ORDER BY code LIMIT 1").get().id);
  const wh = Number(app.db.prepare("INSERT INTO proc_warehouses (code, name, created_at) VALUES ('WH-T', 'مستودع', ?) RETURNING id").get(now).id);
  sup = Number(app.db.prepare("INSERT INTO proc_suppliers (code, name, created_at) VALUES ('SUP-T', 'مورّد الاختبار', ?) RETURNING id").get(now).id);
  item = Number(app.db.prepare("INSERT INTO proc_items (code, name, warehouse_id, created_at) VALUES ('IT-1', 'حاسوب', ?, ?) RETURNING id").get(wh, now).id);
  item2 = Number(app.db.prepare("INSERT INTO proc_items (code, name, warehouse_id, created_at) VALUES ('IT-2', 'شاشة', ?, ?) RETURNING id").get(wh, now).id);
  adm = await login('adm'); chief = await login('chief');
});
test.after(async () => { await app.close(); });

test('الموازنة: إعداد واعتماد من غير المعدّ، والتعديل بعد الاعتماد بالمناقلة فقط', async () => {
  const r = await api('POST', '/api/finance/budgets', { body: { yearId: yearId(), costCenterId: cc, accountId: acc1, amount: 1000 } });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  const id = r.j.budget.id;
  assert.equal((await api('POST', `/api/finance/budgets/${id}/approve`)).s, 403, 'فصل المهام');
  assert.equal((await api('POST', `/api/finance/budgets/${id}/approve`, { cookie: chief })).s, 200);
  assert.equal((await api('POST', '/api/finance/budgets', { body: { yearId: yearId(), costCenterId: cc, accountId: acc1, amount: 5000 } })).s, 409);
  const other = await budget(acc2, 0);
  assert.equal((await api('POST', '/api/finance/budgets/transfer', { body: { fromId: id, toId: other, amount: 2000, reason: 'تعزيز بند' } })).s, 409, 'أكثر من المتاح');
  assert.equal((await api('POST', '/api/finance/budgets/transfer', { body: { fromId: id, toId: other, amount: 300, reason: 'تعزيز بند الصيانة' } })).s, 201);
  assert.equal((await budgetOf(id)).allotted, 700);
  assert.equal((await budgetOf(other)).available, 300);
});

test('أمر التوريد يحجز من الموازنة، ويُمنع التجاوز أو يُحذَّر منه حسب الإعداد', async () => {
  const id = (await api('GET', '/api/finance/budgets')).j.budgets.find((b) => b.accountId === acc1).id;
  const a = await order([[item, 5, 100]], id);
  assert.equal((await send(a)).s, 200);
  let b = await budgetOf(id);
  assert.equal(b.reserved, 500); assert.equal(b.available, 200);
  const big = await order([[item2, 3, 100]], id);
  const blocked = await send(big);
  assert.equal(blocked.s, 409); assert.match(blocked.j.message, /تتجاوز المتاح/);
  await put({ 'finance.budget_control': 'warn' });
  try { assert.equal((await send(big)).s, 200, 'التحذير لا يمنع'); } finally { await put({ 'finance.budget_control': 'block' }); }
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action LIKE 'تجاوز موازنة%'").get());
  assert.equal((await api('POST', `/api/procurement/orders/${big.id}/cancel`)).s, 200);
  b = await budgetOf(id);
  assert.equal(b.available, 200, 'الإلغاء يحرر الحجز');
  await put({ 'finance.po_requires_budget': true });
  try { assert.equal((await send(await order([[item, 1, 10]]))).s, 409); } finally { await put({ 'finance.po_requires_budget': false }); }
});

test('المطابقة الثلاثية: الكمية تُقارن بالمستلم، والاستلام اللاحق يُصدر الفاتورة دون تكرار الذمة', async () => {
  const id = (await api('GET', '/api/finance/budgets')).j.budgets.find((b) => b.accountId === acc2).id;
  const o = await order([[item, 2, 100]], id);
  await send(o);
  assert.equal((await receive(o, item, 1)).s, 201);
  const [line] = lineIds(o);
  const r = await invoice(o, [[line, 2, 100]]);
  assert.equal(r.s, 201, JSON.stringify(r.j));
  const inv = r.j.invoice;
  assert.equal(inv.matchStatus, 'held'); assert.equal(inv.status, 'draft'); assert.match(inv.matchNote, /المستلم 1/);
  assert.equal((await api('POST', `/api/finance/invoices/${inv.id}/issue`)).s, 409, 'الموقوفة لا تُصدر');
  assert.equal((await api('POST', `/api/finance/invoices/${inv.id}/pay`, { body: { amount: 10 } })).s, 409);
  assert.ok(app.db.prepare("SELECT id FROM fin_parties WHERE kind = 'supplier' AND name = 'مورّد الاختبار'").get(), 'أُنشئ طرف المورّد');
  assert.equal((await receive(o, item, 1)).s, 201);
  const after = row(inv.id);
  assert.equal(after.status, 'issued'); assert.equal(after.match_status, 'matched');
  assert.equal(Number(after.post_amount), 0, 'الاستلام أثبت الذمة كاملة');
  assert.equal(after.entry_id, null);
  const b = await budgetOf(id);
  assert.equal(b.spent, 200); assert.equal(b.reserved, 0);
  const paid = await api('POST', `/api/finance/invoices/${inv.id}/pay`, { body: { amount: 200 } }); assert.equal(paid.j.error, 'insufficient_cash_balance', 'تصل الفاتورة المطابقة إلى الصرف، ويبقى فحص رصيد الصندوق');
});

test('فرق السعر: يوقف الفاتورة، والتسامح من الإعداد، والفرق وحده يُرحَّل إلى بند الموازنة', async () => {
  const id = (await api('GET', '/api/finance/budgets')).j.budgets.find((b) => b.accountId === acc2).id;
  const o = await order([[item2, 2, 50]], id);
  await send(o);
  await receive(o, item2, 2);
  const [line] = lineIds(o);
  const inv = (await invoice(o, [[line, 2, 54]])).j.invoice;
  assert.equal(inv.matchStatus, 'held'); assert.match(inv.matchNote, /أعلى من سعر الأمر/);
  await put({ 'finance.match_price_tolerance': 10 });
  try { assert.equal((await api('POST', `/api/finance/invoices/${inv.id}/match`)).s, 200); } finally { await put({ 'finance.match_price_tolerance': 0 }); }
  const r = row(inv.id);
  assert.equal(r.status, 'issued'); assert.equal(Number(r.post_amount), 800);
  const lines = app.db.prepare('SELECT l.* FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE e.id = ? ORDER BY l.line_no').all(r.entry_id);
  assert.equal(Number(lines[0].debit), 800); assert.equal(Number(lines[0].account_id), acc2); assert.equal(Number(lines[0].cost_center_id), cc);
  assert.equal(app.db.prepare('SELECT source FROM fin_entries WHERE id = ?').get(r.entry_id).source, `po_invoice:${inv.id}`);
  assert.equal((await budgetOf(id)).spent, 308, '200 + 108 دون احتساب قيد الفرق مرتين');
});

test('الاعتماد رغم الفرق: من غير المسجّل وبسبب، وإلزام أمر التوريد لفواتير المشتريات', async () => {
  const o = await order([[item, 2, 100]]);
  await send(o);
  await receive(o, item, 1);
  const [line] = lineIds(o);
  const inv = (await invoice(o, [[line, 2, 100]])).j.invoice;
  assert.equal((await api('POST', `/api/finance/invoices/${inv.id}/override`, { body: { reason: 'تسليم موثق بمحضر' } })).s, 403, 'فصل المهام');
  assert.equal((await api('POST', `/api/finance/invoices/${inv.id}/override`, { cookie: chief, body: { reason: 'لا' } })).s, 400);
  assert.equal((await api('POST', `/api/finance/invoices/${inv.id}/override`, { cookie: chief, body: { reason: 'تسليم موثق بمحضر لجنة' } })).s, 200);
  const r = row(inv.id);
  assert.equal(r.match_status, 'override'); assert.equal(r.status, 'issued'); assert.equal(Number(r.post_amount), 10000, 'غير المستلم يُثبت بالفاتورة');
  const party = Number(app.db.prepare('SELECT id FROM fin_parties ORDER BY id LIMIT 1').get().id);
  await put({ 'finance.purchase_requires_po': true });
  try {
    const plain = await api('POST', '/api/finance/invoices', { body: { kind: 'purchase', partyId: party, lines: [{ description: 'خدمة', qty: 1, unitPrice: 10 }] } });
    assert.equal(plain.s, 409);
  } finally { await put({ 'finance.purchase_requires_po': false }); }
});
