// المرحلة 11: طلب الصرف الإلكتروني من الأقسام (تقديم ← اعتماد رئيس الوحدة ← صرف ← تأكيد المستلم) والمرتجع بقيد عكسي
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ready as readyFinance } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, wh, item, unitLib, unitIt;
const ck = {};
const call = async (who, m, u, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } if (j && j.error && !j.code) j.code = j.error; return { s: r.status, j };
};
const lines = (entryId) => app.db.prepare('SELECT a.code, l.debit, l.credit FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.line_no').all(entryId).map((x) => [x.code, Number(x.debit), Number(x.credit)]);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ph11-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  readyFinance(app.db);
  unitLib = Number(app.db.prepare("INSERT INTO org_units (name, kind) VALUES ('مكتبة الاختبار', 'department') RETURNING id").get().id);
  unitIt = Number(app.db.prepare("INSERT INTO org_units (name, kind) VALUES ('قسم آخر', 'department') RETURNING id").get().id);
  const h = await hashPassword(PW, 1024);
  const add = (u, role, unit, perms) => { app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, unit_id, access_mode, custom_permissions_json, created_at, must_change_password) VALUES (?,?,?,?,?,?,?,?,0)').run(u, `مستخدم ${u}`, h, role, unit, perms ? 'custom' : 'role', JSON.stringify(perms ?? []), Date.now()); };
  add('emp', 'staff', unitLib, ['procurement:request']);
  add('head', 'staff', unitLib, ['procurement:request', 'procurement:issue_approve']);
  add('otherhead', 'staff', unitIt, ['procurement:request', 'procurement:issue_approve']);
  add('keeper', 'staff', null, ['procurement:read', 'procurement:stock']);
  add('adm', 'admin', null, null);
  for (const u of ['emp', 'head', 'otherhead', 'keeper', 'adm']) {
    app.limiter.hits.clear();
    ck[u] = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  }
  wh = Number((await call('adm', 'POST', '/api/procurement/warehouses', { code: 'WH-P11', name: 'مستودع المرحلة 11' })).j.warehouse.id);
  item = (await call('adm', 'POST', '/api/procurement/items', { code: 'P11-001', name: 'أقلام حبر', unit: 'علبة', warehouseId: wh })).j.item;
  // رصيد ابتدائي عبر تسوية جرد
  assert.equal((await call('adm', 'POST', `/api/procurement/items/${item.id}/adjust`, { qtyOnHand: 20, avgCost: 1000, reason: 'رصيد افتتاحي بمحضر جرد رقم 1' })).s, 200);
});
test.after(async () => { await app.close(); });

let reqId, issueNo;
test('الطلب يعتمده رئيس وحدة مقدّمه فقط، لا مقدّمه ولا رئيس وحدة أخرى', async () => {
  const r = await call('emp', 'POST', '/api/procurement/issue-requests', { warehouseId: wh, purpose: 'تجهيز قاعة المطالعة', lines: [{ itemId: item.id, qty: 6 }] });
  assert.equal(r.s, 201, JSON.stringify(r.j)); reqId = r.j.request.id;
  assert.equal(r.j.request.department, 'مكتبة الاختبار', 'القسم من وحدة مقدّمه'); assert.equal(r.j.request.status, 'pending');
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE kind = 'proc_issue_request' AND ref_id = ?").get(reqId), 'رئيس الوحدة أُبلغ');
  assert.equal((await call('otherhead', 'POST', `/api/procurement/issue-requests/${reqId}/approve`)).s, 403, 'رئيس وحدة أخرى');
  assert.equal((await call('otherhead', 'GET', '/api/procurement/issue-requests')).j.requests.length, 0, 'لا يرى طلبات غير وحدته');
  // الصرف قبل الاعتماد مرفوض
  assert.equal((await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issueRequestId: reqId, receiverName: 'سامر', lines: [{ itemId: item.id, qty: 6 }] })).s, 409);
  assert.equal((await call('head', 'POST', `/api/procurement/issue-requests/${reqId}/approve`, { note: 'موافق' })).j.request.status, 'approved');
});

test('الصرف من الطلب المعتمد: لا يتجاوز المعتمد، والجزئي يبقي الطلب مفتوحاً، والمستلم يؤكد إلكترونياً', async () => {
  assert.equal((await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issueRequestId: reqId, receiverName: 'سامر', lines: [{ itemId: item.id, qty: 7 }] })).j.code, 'qty_over_request');
  const p1 = await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issueRequestId: reqId, receiverName: 'سامر', lines: [{ itemId: item.id, qty: 4 }] });
  assert.equal(p1.s, 201, JSON.stringify(p1.j)); issueNo = p1.j.no;
  let r = (await call('emp', 'GET', `/api/procurement/issue-requests/${reqId}`)).j.request;
  assert.equal(r.status, 'partial'); assert.equal(r.lines[0].issuedQty, 4); assert.equal(r.issues[0].no, issueNo);
  assert.equal(app.db.prepare('SELECT department, request_ref FROM proc_issues WHERE no = ?').get(issueNo).request_ref, r.no, 'رقم الطلب على الإذن');
  await call('keeper', 'POST', '/api/procurement/issues', { warehouseId: wh, issueRequestId: reqId, receiverName: 'سامر', lines: [{ itemId: item.id, qty: 2 }] });
  assert.equal((await call('otherhead', 'POST', `/api/procurement/issue-requests/${reqId}/confirm`)).s, 403);
  r = (await call('emp', 'POST', `/api/procurement/issue-requests/${reqId}/confirm`)).j.request;
  assert.equal(r.status, 'received'); assert.ok(r.receivedAt);
});

test('المرتجع: يعود إلى رصيد المستودع بقيد عكسي، ولا يتجاوز ما صُرف بالإذن', async () => {
  const issueId = Number(app.db.prepare('SELECT id FROM proc_issues WHERE no = ?').get(issueNo).id);
  assert.equal((await call('keeper', 'POST', '/api/procurement/returns', { warehouseId: wh, issueId, reason: 'فائض عن الحاجة', lines: [{ itemId: item.id, qty: 5 }] })).j.code, 'qty_over_issue');
  const r = await call('keeper', 'POST', '/api/procurement/returns', { warehouseId: wh, issueId, returnedBy: 'سامر', reason: 'فائض عن الحاجة', lines: [{ itemId: item.id, qty: 3, itemCondition: 'جديدة' }] });
  assert.equal(r.s, 201, JSON.stringify(r.j));
  assert.deepEqual(lines(r.j.journalEntryId), [['1301', 300000, 0], ['5201', 0, 300000]]);
  assert.equal(Number(app.db.prepare('SELECT qty_on_hand FROM proc_items WHERE id = ?').get(item.id).qty_on_hand), 17, '20 − 6 + 3');
  assert.equal((await call('keeper', 'POST', '/api/procurement/returns', { warehouseId: wh, issueId, reason: 'فائض آخر', lines: [{ itemId: item.id, qty: 2 }] })).j.code, 'qty_over_issue', '3 من 4 أُرجعت');
  const card = (await call('adm', 'GET', `/api/procurement/items/${item.id}/card`)).j;
  assert.equal(card.moves.at(-1).kind, 'return'); assert.equal(card.consistent, true);
  assert.equal((await call('adm', 'GET', '/api/procurement/ledger-check')).j.ok, true);
});

test('الإلغاء قبل الصرف، والرفض بسبب', async () => {
  const a = (await call('emp', 'POST', '/api/procurement/issue-requests', { warehouseId: wh, purpose: 'طلب سيُلغى', lines: [{ itemId: item.id, qty: 1 }] })).j.request;
  assert.equal((await call('emp', 'POST', `/api/procurement/issue-requests/${a.id}/cancel`)).j.request.status, 'cancelled');
  const b = (await call('emp', 'POST', '/api/procurement/issue-requests', { warehouseId: wh, purpose: 'طلب سيُرفض', lines: [{ itemId: item.id, qty: 1 }] })).j.request;
  assert.equal((await call('head', 'POST', `/api/procurement/issue-requests/${b.id}/reject`, {})).j.code, 'reason_required');
  assert.equal((await call('head', 'POST', `/api/procurement/issue-requests/${b.id}/reject`, { note: 'متوفر في القسم' })).j.request.status, 'rejected');
  assert.equal((await call('head', 'POST', '/api/procurement/issue-requests', { warehouseId: wh, purpose: 'طلب رئيس القسم', lines: [{ itemId: item.id, qty: 1 }] })).s, 201);
  const own = (await call('head', 'GET', '/api/procurement/issue-requests')).j.requests.find((x) => x.purpose === 'طلب رئيس القسم');
  assert.equal((await call('head', 'POST', `/api/procurement/issue-requests/${own.id}/approve`)).j.code, 'sod_violation');
});
