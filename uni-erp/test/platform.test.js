// طبقة المنصة: الموافقات العامة وفصل المهام، والنقاش والمتابعون، والأنشطة وتذكيرها، والأتمتة، والتقارير المحورية.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { platformTick } from '../server/services/platform/automation.js';

const PW = 'Str0ng-Test-Pass!';
let app, base, hash, adm;
const call = async (method, url, { cookie, body } = {}) => {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* ليس JSON */ }
  return { status: r.status, json, type: r.headers.get('content-type') };
};
const login = async (username) => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
  return r.headers.get('set-cookie').split(';')[0];
};
const staff = (username, perms = []) => Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, created_at) VALUES (?, ?, ?, 'staff', 'custom', ?, ?) RETURNING id").get(username, username, hash, JSON.stringify(perms), Date.now()).id);
const notes = (uid, kind) => app.db.prepare('SELECT * FROM user_notifications WHERE user_id = ? AND kind = ? ORDER BY id').all(uid, kind);
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
const day = (n) => new Date(Date.now() + n * 86_400_000).toLocaleString('sv-SE', { timeZone: 'Asia/Damascus' }).slice(0, 10);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-platform-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('padm', 'مدير', ?, 'admin', ?)").run(hash, Date.now());
  adm = await login('padm');
});
test.after(async () => { if (app) await app.close(); });

test('مركز العمل يظهر لكل موظف، وصلاحياته في الفهرس', async () => {
  staff('p_plain');
  const me = (await call('GET', '/api/me', { cookie: await login('p_plain') })).json.user;
  assert.ok(me.allowedViews.includes('hub'));
  const types = await call('GET', '/api/approval-types', { cookie: adm });
  assert.equal(types.status, 200);
  assert.ok(types.json.catalog.permissions.includes('approvals:manage'));
});

test('الموافقات: خطوات حسب المبلغ، وفصل المهام، والنقاش والتتبع', async () => {
  const boss = staff('p_boss'), req = staff('p_req'), out = staff('p_out');
  const def = await call('POST', '/api/approval-types', { cookie: adm, body: { code: 'mission', name: 'مهمة سفر', mode: 'sequential', amountRequired: true,
    steps: [{ label: 'المدير المباشر', kind: 'user', userId: boss }, { label: 'الإدارة', kind: 'permission', perm: 'approvals:manage', minAmount: 1000 }] } });
  assert.equal(def.status, 201, JSON.stringify(def.json));
  const typeId = def.json.id;
  const reqC = await login('p_req'), bossC = await login('p_boss'), outC = await login('p_out');

  assert.equal((await call('POST', '/api/approvals', { cookie: reqC, body: { typeId, title: 'مهمة بلا مبلغ' } })).status, 400, 'المبلغ إلزامي لهذا النوع');
  const small = await call('POST', '/api/approvals', { cookie: reqC, body: { typeId, title: 'مهمة قصيرة', amount: 500 } });
  assert.equal(small.status, 201);
  assert.match(small.json.no, /^APR-\d{4}-\d{5}$/);
  const d1 = (await call('GET', `/api/approvals/${small.json.id}`, { cookie: reqC })).json;
  assert.equal(d1.steps.length, 1, 'خطوة الإدارة لا تنطبق تحت 1000');
  assert.equal((await call('GET', `/api/approvals/${small.json.id}`, { cookie: outC })).status, 404, 'غير المعني لا يرى الطلب');
  assert.equal((await call('POST', `/api/approvals/${small.json.id}/decide`, { cookie: reqC, body: { decision: 'approve' } })).status, 403, 'لا يعتمد مقدّم الطلب طلبه');
  assert.equal(notes(boss, 'approval_step').length, 1, 'المعتمد أُشعر');
  assert.equal((await call('GET', '/api/approvals?box=todo', { cookie: bossC })).json.approvals.length, 1);

  // تعليق المعتمد يُشعر مقدّم الطلب (متابع تلقائياً)، والملاحظة الداخلية لا تُشعر
  assert.equal((await call('POST', `/api/records/approval/${small.json.id}/messages`, { cookie: bossC, body: { kind: 'comment', body: 'ما وجهة المهمة؟' } })).status, 201);
  assert.equal(notes(req, 'chatter').length, 1);
  await call('POST', `/api/records/approval/${small.json.id}/messages`, { cookie: bossC, body: { kind: 'note', body: 'داخلي' } });
  assert.equal(notes(req, 'chatter').length, 1);
  assert.equal((await call('GET', `/api/records/approval/${small.json.id}/thread`, { cookie: outC })).status, 404);

  assert.equal((await call('POST', `/api/approvals/${small.json.id}/decide`, { cookie: bossC, body: { decision: 'reject' } })).status, 400, 'الرفض يتطلب سبباً');
  const ok = await call('POST', `/api/approvals/${small.json.id}/decide`, { cookie: bossC, body: { decision: 'approve' } });
  assert.equal(ok.json.status, 'approved');
  const thread = (await call('GET', `/api/records/approval/${small.json.id}/thread`, { cookie: reqC })).json;
  assert.ok(thread.messages.some((m) => m.kind === 'tracking' && m.tracking[0].to === 'معتمد'), 'تغيّر الحالة متتبَّع');
  assert.equal(notes(req, 'approval_done').length, 1);

  // مبلغ كبير: خطوتان؛ المدير يحمل approvals:manage لكنه لا يبت في خطوتين
  const big = await call('POST', '/api/approvals', { cookie: reqC, body: { typeId, title: 'مهمة طويلة', amount: 5000 } });
  assert.equal((await call('POST', `/api/approvals/${big.json.id}/decide`, { cookie: adm, body: { decision: 'approve' } })).status, 403, 'الخطوة الثانية لم تُفتح بعد');
  assert.equal((await call('POST', `/api/approvals/${big.json.id}/decide`, { cookie: bossC, body: { decision: 'approve' } })).json.status, 'pending');
  assert.ok(notes(app.db.prepare("SELECT id FROM users WHERE username = 'padm'").get().id, 'approval_step').length >= 1, 'حامل الصلاحية أُشعر بالخطوة الثانية');
  assert.equal((await call('POST', `/api/approvals/${big.json.id}/decide`, { cookie: adm, body: { decision: 'reject', note: 'الميزانية لا تسمح' } })).json.status, 'rejected');
  assert.equal((await call('POST', `/api/approvals/${big.json.id}/cancel`, { cookie: reqC })).status, 409, 'المنتهي لا يُلغى');
  assert.equal((await call('POST', '/api/approval-types', { cookie: reqC, body: { code: 'x_y', name: 'ممنوع', steps: [{ kind: 'unit_head' }] } })).status, 403);
  void out;
});

test('الأنشطة: إسناد وإشعار وإنجاز، والتذكير الدوري مرة واحدة', async () => {
  const a = staff('p_actA'), b = staff('p_actB');
  const aC = await login('p_actA'), bC = await login('p_actB');
  assert.equal((await call('POST', '/api/activities', { cookie: aC, body: { title: 'إعداد التقرير', dueDate: day(-1), assigneeId: b } })).status, 400, 'لا موعد في الماضي');
  const r = await call('POST', '/api/activities', { cookie: aC, body: { title: 'إعداد التقرير', kind: 'review', dueDate: day(2), assigneeId: b } });
  assert.equal(r.status, 201);
  assert.equal(notes(b, 'activity').length, 1);
  assert.equal((await call('GET', '/api/activities?box=mine', { cookie: bC })).json.activities.length, 1);
  assert.equal((await call('GET', '/api/activities?box=created', { cookie: aC })).json.activities.length, 1);
  assert.equal((await call('POST', `/api/activities/${r.json.id}/cancel`, { cookie: bC })).status, 403, 'المسند إليه لا يلغي تكليف غيره');
  assert.equal((await call('POST', `/api/activities/${r.json.id}/done`, { cookie: bC, body: { note: 'أُرسل' } })).status, 200);
  assert.equal(notes(a, 'activity_done').length, 1);

  const late = Number(app.db.prepare("INSERT INTO activities (kind, title, assignee_id, creator_id, due_date, created_at) VALUES ('todo', 'متأخر', ?, ?, ?, ?) RETURNING id").get(b, a, day(-3), Date.now()).id);
  platformTick(app.db); platformTick(app.db);
  assert.equal(notes(b, 'activity_overdue').filter((n) => Number(n.ref_id) === late).length, 1, 'تذكير واحد رغم تكرار الفحص');
  assert.equal((await call('GET', '/api/hub/summary', { cookie: bC })).json.activities.overdue, 1);
});

test('الأتمتة: قاعدة حدث وقاعدة مجدولة، ولا تتكرر المجدولة', async () => {
  const req = staff('p_auto'), reqC = await login('p_auto');
  const noPerm = await call('POST', '/api/automation/rules', { cookie: reqC, body: {} });
  assert.equal(noPerm.status, 403);
  const ev = await call('POST', '/api/automation/rules', { cookie: adm, body: { name: 'تأكيد الاستلام', trigger: 'event', event: 'approval.submitted', condition: { typeCode: 'mission' }, action: 'notify', params: { to: 'requester', text: 'استلمنا طلبك {{no}}' } } });
  assert.equal(ev.status, 201, JSON.stringify(ev.json));
  const typeId = app.db.prepare("SELECT id FROM approval_types WHERE code = 'mission'").get().id;
  const sub = await call('POST', '/api/approvals', { cookie: reqC, body: { typeId, title: 'مهمة مؤتمتة', amount: 100 } });
  assert.ok(await until(() => notes(req, `auto_${ev.json.id}`).length === 1), 'نُفّذت قاعدة الحدث');
  assert.match(notes(req, `auto_${ev.json.id}`)[0].text, new RegExp(sub.json.no));

  const sch = await call('POST', '/api/automation/rules', { cookie: adm, body: { name: 'متابعة المتأخر', trigger: 'schedule', event: 'activity_overdue', condition: { days: 0 }, action: 'notify', params: { to: 'creator', text: 'تأخر {{title}}' } } });
  assert.equal(sch.status, 201, JSON.stringify(sch.json));
  platformTick(app.db);
  const fired = Number(app.db.prepare('SELECT COUNT(*) AS n FROM automation_log WHERE rule_id = ?').get(sch.json.id).n);
  assert.ok(fired >= 1);
  platformTick(app.db);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS n FROM automation_log WHERE rule_id = ?').get(sch.json.id).n), fired, 'لا تكرار على السجل نفسه');
  const ov = (await call('GET', '/api/automation', { cookie: adm })).json;
  assert.ok(ov.rules.find((r) => r.id === ev.json.id).runCount >= 1);
  assert.equal((await call('DELETE', `/api/automation/rules/${sch.json.id}`, { cookie: adm })).status, 200);
});

test('التقارير المحورية: صلاحية كل مجموعة، والتجميع والمجاميع، وتصدير Excel', async () => {
  staff('p_none'); const noneC = await login('p_none');
  assert.equal((await call('GET', '/api/reports/pivot?dataset=approvals&row=status', { cookie: noneC })).status, 403);
  assert.ok(!(await call('GET', '/api/reports/pivot/datasets', { cookie: noneC })).json.datasets.some((d) => d.key === 'approvals'));
  const p = await call('GET', '/api/reports/pivot?dataset=approvals&row=status&col=type&measure=count', { cookie: adm });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.grand, p.json.rows.reduce((s, r) => s + r.total, 0));
  assert.ok(p.json.rows.some((r) => r.label === 'معتمد'));
  const one = await call('GET', '/api/reports/pivot?dataset=activities&row=timing', { cookie: adm });
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.equal((await call('GET', '/api/reports/pivot?dataset=approvals&row=status&col=status', { cookie: adm })).status, 400);
  assert.equal((await call('GET', '/api/reports/pivot?dataset=students&row=faculty&from=2026-13-01', { cookie: adm })).status, 400);
  const xl = await call('GET', '/api/reports/pivot.xlsx?dataset=approvals&row=type&measure=amount', { cookie: adm });
  assert.equal(xl.status, 200);
  assert.match(xl.type, /spreadsheetml/);
});

test('الصندوق الموحّد: المراسلات والمشتريات تظهر لمن ينتظر قراره، والقرار يمر بقواعد الوحدة ويُسجَّل في النقاش', async () => {
  const author = staff('p_corrA', ['corr:use']), first = staff('p_corr1', ['corr:use']), second = staff('p_corr2', ['corr:use']);
  const now = Date.now();
  const doc = Number(app.db.prepare("INSERT INTO corr_docs (no, title, mode, status, creator_id, created_at, sent_at) VALUES ('COR-T-0001', 'مذكرة تجريبية', 'sequential', 'pending', ?, ?, ?) RETURNING id").get(author, now, now).id);
  app.db.prepare('INSERT INTO corr_approvers (doc_id, user_id, seq) VALUES (?, ?, 1), (?, ?, 2)').run(doc, first, doc, second);
  const c1 = await login('p_corr1'), c2 = await login('p_corr2');
  const inbox = async (c) => (await call('GET', '/api/approvals/inbox', { cookie: c })).json.items;
  assert.ok((await inbox(c1)).some((x) => x.source === 'corr' && x.id === doc), 'المعتمد الأول يراها');
  assert.ok(!(await inbox(c2)).some((x) => x.source === 'corr' && x.id === doc), 'الثاني لا يراها قبل دوره');
  assert.equal((await call('POST', `/api/approvals/inbox/corr/${doc}/decide`, { cookie: c2, body: { decision: 'approve' } })).status, 409, 'قاعدة التسلسل من وحدة المراسلات');
  assert.equal((await call('POST', `/api/approvals/inbox/corr/${doc}/decide`, { cookie: c1, body: { decision: 'approve' } })).status, 200);
  assert.ok((await inbox(c2)).some((x) => x.source === 'corr' && x.id === doc), 'حان دور الثاني');
  const fin = await call('POST', `/api/approvals/inbox/corr/${doc}/decide`, { cookie: c2, body: { decision: 'approve' } });
  assert.equal(fin.json.status, 'approved');
  assert.ok(app.db.prepare('SELECT out_no FROM corr_docs WHERE id = ?').get(doc).out_no, 'رقم الصادر مُنح كما في الوحدة');
  const th = (await call('GET', `/api/records/corr/${doc}/thread`, { cookie: c2 })).json;
  assert.equal(th.messages.filter((m) => m.kind === 'system').length, 2, 'القراران في نقاش المستند');

  const buyer = staff('p_buyer', ['procurement:request']), mgr = staff('p_mgr', ['procurement:manage']);
  const pr = Number(app.db.prepare("INSERT INTO proc_requests (no, title, requester_id, status, requested_at, created_at) VALUES ('PRQ-T-0001', 'أوراق طباعة', ?, 'pending', ?, ?) RETURNING id").get(buyer, now, now).id);
  app.db.prepare("INSERT INTO proc_request_lines (request_id, description, qty, est_cost) VALUES (?, 'ورق A4', 10, 100)").run(pr);
  const mC = await login('p_mgr'), bC = await login('p_buyer');
  const item = (await inbox(mC)).find((x) => x.source === 'procurement' && x.id === pr);
  assert.ok(item && item.amount === 1000, 'يظهر بمبلغه المحسوب في الوحدة');
  assert.ok(!(await inbox(bC)).some((x) => x.source === 'procurement'), 'مقدّم الطلب لا يراه');
  assert.equal((await call('POST', `/api/approvals/inbox/procurement/${pr}/decide`, { cookie: mC, body: { decision: 'return' } })).status, 400, 'الإعادة تتطلب سبباً');
  const ok = await call('POST', `/api/approvals/inbox/procurement/${pr}/decide`, { cookie: mC, body: { decision: 'approve', note: 'موافق' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(app.db.prepare('SELECT status FROM proc_requests WHERE id = ?').get(pr).status, 'approved');
  assert.equal((await call('GET', '/api/hub/summary', { cookie: mC })).json.approvalsTodo, 0);
  assert.equal((await call('POST', '/api/approvals/inbox/nothing/1/decide', { cookie: mC, body: { decision: 'approve' } })).status, 404);
});

test('المراسلات: خطوات المدير الثابتة من محرك الموافقات تسبق معتمدي الكاتب', async () => {
  const head = staff('p_tplHead', ['corr:use']), writer = staff('p_tplW', ['corr:use']), other = staff('p_tplO', ['corr:use']), ccU = staff('p_tplC', ['corr:use']);
  const t = (await call('GET', '/api/approval-types?all=1', { cookie: adm })).json.types.find((x) => x.code === 'corr_doc');
  assert.ok(t && t.owner === 'corr', 'النوع المملوك موجود بالترحيل');
  const base = { name: t.name, description: t.description, mode: t.mode, active: true };
  assert.equal((await call('PUT', `/api/approval-types/${t.id}`, { cookie: adm, body: { ...base, steps: [{ label: 'الإدارة', kind: 'permission', perm: 'corr:use' }] } })).status, 400, 'حامل الصلاحية لا يُحل إلى موظف بعينه');
  assert.equal((await call('PUT', `/api/approval-types/${t.id}`, { cookie: adm, body: { ...base, steps: [{ label: 'المدقق الإداري', kind: 'user', userId: head }] } })).status, 200);
  assert.equal((await call('POST', '/api/approvals', { cookie: adm, body: { typeId: t.id, title: 'من الطلب الجديد' } })).status, 409, 'لا يُقدَّم من «طلب جديد»');

  const wC = await login('p_tplW');
  const order = (id) => app.db.prepare('SELECT user_id FROM corr_approvers WHERE doc_id = ? ORDER BY seq').all(id).map((r) => Number(r.user_id));
  const d1 = await call('POST', '/api/corr', { cookie: wC, body: { title: 'مذكرة أولى', mode: 'sequential', approvers: [other], cc: [ccU], send: true } });
  assert.equal(d1.status, 201, JSON.stringify(d1.json));
  assert.deepEqual(order(d1.json.doc.id), [head, other], 'الخطوة الثابتة أولاً');
  const hC = await login('p_tplHead');
  assert.ok((await call('GET', '/api/approvals/inbox', { cookie: hC })).json.items.some((x) => x.source === 'corr' && x.id === d1.json.doc.id));

  const d2 = await call('POST', '/api/corr', { cookie: wC, body: { title: 'مذكرة ثانية', mode: 'sequential', approvers: [other, head], send: true } });
  assert.deepEqual(order(d2.json.doc.id), [head, other], 'لا تكرار: يُنقل إلى موضع الخطوة الثابتة');

  // الكاتب نفسه هو المعتمد الثابت: لا يعتمد مستنده
  const hDoc = await call('POST', '/api/corr', { cookie: hC, body: { title: 'مذكرة الرئيس', mode: 'parallel', approvers: [other], send: true } });
  assert.deepEqual(order(hDoc.json.doc.id), [other]);
  await call('PUT', `/api/approval-types/${t.id}`, { cookie: adm, body: { ...base, steps: [] } });
  const d3 = await call('POST', '/api/corr', { cookie: wC, body: { title: 'مذكرة ثالثة', mode: 'parallel', approvers: [other], send: true } });
  assert.deepEqual(order(d3.json.doc.id), [other], 'بلا خطوات ثابتة يبقى السلوك القديم');
  void writer;
});
