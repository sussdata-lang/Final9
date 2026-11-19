// المرحلة 8: دفتر الحركات المخزنية — كل استلام وصرف وتسوية يُكتب بالرصيد بعده، وبطاقة الصنف، والرصيد بتاريخ سابق، والمطابقة
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';
import { reverseStockMoves } from '../server/services/procurement/core.js';

const PW = 'Test#Pass12345';
let app, base, wh, sup, item;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph8-'));
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
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P8', name: 'مستودع المرحلة 8' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P8', name: 'مورد المرحلة 8' })).j.supplier.id);
  item = (await call('ord', 'POST', '/api/procurement/items', { code: 'P8-001', name: 'أقلام سبورة', unit: 'علبة', warehouseId: wh })).j.item;
});
test.after(async () => { await app.close(); });

test('كل حركة تُكتب في الدفتر بالرصيد بعدها، وبطاقة الصنف تعرضها بالترتيب، والدفتر يطابق الرصيد', async () => {
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'تموين عاجل لأقلام السبورة', lines: [{ itemId: item.id, description: 'أقلام', qty: 10, unitCost: 2000 }] })).j.order;
  await call('keeper', 'POST', `/api/procurement/orders/${o.id}/order`);
  assert.equal((await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o.id, lines: [{ itemId: item.id, qty: 10 }] })).s, 201);
  assert.equal((await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issuedTo: 'قسم الحاسوب', lines: [{ itemId: item.id, qty: 3 }] })).s, 201);
  assert.equal((await call('ord', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 6, expectedQty: 7, reason: 'محضر جرد رقم 8 — علبة تالفة' })).s, 200);
  const c = (await call('ord', 'GET', `/api/procurement/items/${item.id}/card`)).j;
  assert.deepEqual(c.moves.map((m) => [m.kind, m.qty, m.balance]), [['receipt', 10, 10], ['issue', -3, 7], ['adjust', -1, 6]]);
  assert.match(c.moves[0].refNo, new RegExp(o.no));
  assert.equal(c.moves[1].note, 'قسم الحاسوب');
  assert.deepEqual(c.totals, { in: 10, out: 4 });
  assert.equal(c.consistent, true);
  assert.equal((await call('ord', 'GET', '/api/procurement/ledger-check')).j.ok, true);
});

test('الرصيد بتاريخ سابق من الدفتر، ورصيد أول المدة في البطاقة', async () => {
  // نرجّع أول حركتين إلى أمس، فيكون رصيد أمس 7 ورصيد اليوم 6
  const yest = Date.now() - 86400000;
  const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date(t));
  app.db.prepare("UPDATE proc_stock_moves SET created_at = ? WHERE item_id = ? AND kind IN ('receipt', 'issue')").run(yest, item.id);
  const at = (await call('ord', 'GET', `/api/procurement/stock-at?day=${day(yest)}`)).j;
  assert.equal(at.items.find((x) => x.id === item.id).qty, 7);
  const now = (await call('ord', 'GET', '/api/procurement/stock-at')).j;
  assert.equal(now.items.find((x) => x.id === item.id).qty, 6);
  const c = (await call('ord', 'GET', `/api/procurement/items/${item.id}/card?from=${day(Date.now())}`)).j;
  assert.equal(c.opening, 7, 'رصيد أول المدة'); assert.equal(c.moves.length, 1);
});

test('عكس المستند يكتب حركات معاكسة، والفرق بين البطاقة والدفتر يظهر في المطابقة', async () => {
  const is = app.db.prepare("SELECT ref_id FROM proc_stock_moves WHERE item_id = ? AND kind = 'issue'").get(item.id).ref_id;
  assert.equal(reverseStockMoves(app.db, { id: null }, 'issue', is, 'اختبار'), 1);
  const last = app.db.prepare('SELECT kind, qty, balance_after FROM proc_stock_moves WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(item.id);
  assert.deepEqual([last.kind, Number(last.qty), Number(last.balance_after)], ['reversal', 3, 9]);
  const chk = (await call('ord', 'GET', '/api/procurement/ledger-check')).j;
  assert.equal(chk.ok, false); assert.equal(chk.diffs[0].code, 'P8-001');
});
