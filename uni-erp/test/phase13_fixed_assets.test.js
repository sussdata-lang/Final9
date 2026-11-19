// المرحلة 13: الأصول الثابتة — من بند استلام «أصل ثابت»، والإهلاك الشهري وقيده، والإتلاف باعتماد وقيد، والعهدة والجرد
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, wh, sup, assetIds;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};
const lines = (entryId) => app.db.prepare('SELECT a.code, l.debit, l.credit FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.line_no').all(entryId).map((x) => [x.code, Number(x.debit), Number(x.credit)]);
const asset = (id) => app.db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(id);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph13-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  readyFinance(app.db);
  const h = await hashPassword(PW, 1024);
  for (const u of ['ord', 'keeper', 'mgr']) {
    app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, 'admin', ?, 0)").run(u, `مستخدم ${u}`, h, Date.now());
    app.limiter.hits.clear();
    ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  }
  await call('ord', 'PUT', '/api/admin/general', { values: { 'procurement.asset_default_life_months': 24 } });
  wh = Number((await call('ord', 'POST', '/api/procurement/warehouses', { code: 'WH-P13', name: 'مستودع المرحلة 13' })).j.warehouse.id);
  sup = Number((await call('ord', 'POST', '/api/procurement/suppliers', { code: 'SUP-P13', name: 'مورد المرحلة 13' })).j.supplier.id);
});
test.after(async () => { await app.close(); });

test('7.1 بند «أصل ثابت» في الأمر يُنشئ أصلاً لكل وحدة عند الاستلام، مرتبطاً بالشراء، بقيد اقتناء', async () => {
  assert.equal((await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'شراء حواسيب لمخبر البرمجة', lines: [{ kind: 'asset', description: 'حاسوب مكتبي', qty: 1.5, unitCost: 2400000 }] })).j.code, 'fraction_not_allowed');
  const o = (await call('ord', 'POST', '/api/procurement/orders', { supplierId: sup, directReason: 'شراء حواسيب لمخبر البرمجة', lines: [{ kind: 'asset', description: 'حاسوب مكتبي', qty: 2, unitCost: 2400000 }] })).j.order;
  assert.equal(o.lines[0].kind, 'asset');
  await call('keeper', 'POST', `/api/procurement/orders/${o.id}/order`);
  const r = await call('keeper', 'POST', '/api/procurement/receipts', { orderId: o.id, warehouseId: wh, lines: [{ orderLineId: o.lines[0].id, qty: 2 }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.status, 'received'); assert.equal(r.j.assetIds.length, 2);
  assetIds = r.j.assetIds;
  const a = asset(assetIds[0]);
  assert.match(a.code, /^AST-\d{4}-\d{5}$/); assert.equal(Number(a.cost), 2400000); assert.equal(Number(a.order_id), o.id); assert.equal(Number(a.supplier_id), sup);
  assert.equal(Number(a.useful_life_months), 24, 'العمر الافتراضي من الإعدادات');
  const je = app.db.prepare("SELECT id FROM fin_entries WHERE source = ?").get(`proc_receipt_asset:${r.j.receiptId}`);
  assert.deepEqual(lines(je.id), [['1403', 480000000, 0], ['2101', 0, 480000000]]);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) n FROM proc_items").get().n), 0, 'الأصل لا يدخل المخزون');
});

test('7.3 الإهلاك الشهري بالقسط الثابت: مرة واحدة لكل شهر، وقيده مصروف الإهلاك / مجمع الإهلاك', async () => {
  const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date()).slice(0, 7);
  assert.equal((await call('ord', 'POST', '/api/procurement/assets/depreciation', { period: '2099-01' })).s, 400, 'شهر لم يأتِ');
  const r = (await call('ord', 'POST', '/api/procurement/assets/depreciation', { period })).j;
  assert.equal(r.assets, 2); assert.equal(r.total, 100000 * 2, '2,400,000 ÷ 24');
  assert.deepEqual(lines(r.journalEntryId), [['5205', 20000000, 0], ['1404', 0, 20000000]]);
  assert.equal((await call('ord', 'POST', '/api/procurement/assets/depreciation', { period })).j.assets, 0, 'لا يتكرر للشهر نفسه');
  const h = (await call('ord', 'GET', `/api/procurement/assets/${assetIds[0]}/history`)).j;
  assert.equal(h.asset.bookValue, 2300000); assert.equal(h.depreciation[0].amount, 100000);
  assert.equal((await call('ord', 'PUT', `/api/procurement/assets/${assetIds[0]}`, { usefulLifeMonths: 36 })).j.code, 'depreciation_started');
});

test('7.2 الإتلاف بخطوتين: طلب بسبب ثم اعتماد شخص آخر، والقيد يقفل الإهلاك ويثبت الخسارة', async () => {
  const id = assetIds[0];
  assert.equal((await call('ord', 'POST', `/api/procurement/assets/${id}/dispose-request`, { reason: 'تالف' })).s, 400, 'سبب قصير');
  assert.equal((await call('ord', 'POST', `/api/procurement/assets/${id}/dispose-request`, { reason: 'محضر إتلاف رقم 3 — احتراق اللوحة الأم' })).s, 200);
  assert.equal(asset(id).status, 'available', 'لم يُتلف بعد');
  assert.equal((await call('ord', 'POST', `/api/procurement/assets/${id}/dispose-approve`)).j.code, 'sod_violation');
  const r = await call('mgr', 'POST', `/api/procurement/assets/${id}/dispose-approve`);
  assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.asset.status, 'disposed');
  const es = app.db.prepare('SELECT id FROM fin_entries WHERE source LIKE ? ORDER BY id').all(`proc_asset_dispose:${id}:%`).map((e) => lines(e.id));
  assert.deepEqual(es, [[['1404', 10000000, 0], ['1403', 0, 10000000]], [['5401', 230000000, 0], ['1403', 0, 230000000]]]);
  assert.equal((await call('ord', 'POST', `/api/procurement/assets/${id}/verify`, {})).s, 409, 'المتلف لا يُجرد');
});

test('13.14 العهدة بمستخدم، والجرد الدوري، والسجل', async () => {
  const id = assetIds[1];
  const mgrId = Number(app.db.prepare("SELECT id FROM users WHERE username = 'mgr'").get().id);
  assert.equal((await call('ord', 'PUT', `/api/procurement/assets/${id}`, { assignedUserId: mgrId, serialNo: 'SN-9X81' })).s, 200);
  assert.equal(asset(id).assigned_to, 'مستخدم mgr', 'اسم صاحب العهدة من حسابه');
  assert.ok((await call('ord', 'GET', '/api/procurement/assets/unchecked')).j.assets.some((a) => a.id === id), 'لم يُجرد بعد');
  assert.equal((await call('keeper', 'POST', `/api/procurement/assets/${id}/verify`, { found: false })).j.code, 'reason_required');
  assert.equal((await call('keeper', 'POST', `/api/procurement/assets/${id}/verify`, { found: true, locationOk: true })).s, 200);
  assert.ok(!(await call('ord', 'GET', '/api/procurement/assets/unchecked')).j.assets.some((a) => a.id === id));
  const h = (await call('ord', 'GET', `/api/procurement/assets/${id}/history`)).j;
  assert.equal(h.asset.serialNo, 'SN-9X81'); assert.equal(h.checks.length, 1);
  assert.equal((await call('ord', 'GET', `/api/procurement/assets/${id}/qr.svg`)).s, 200);
});
