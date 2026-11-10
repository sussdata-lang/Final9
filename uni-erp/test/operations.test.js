import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';

const PW = 'Test#Pass12345';
const DAY = 86400000;
let app, base, ck = {}, id = {};
const api = async (m, u, who = 'adm', body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const iso = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ops-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, perms) => { id[u] = Number(app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, Date.now(), perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  add('adm', 'admin'); add('emp', 'staff', []); add('tech', 'staff', []); add('fac', 'staff', ['facilities:manage']);
  await ensureStructure(app, { activate: true, password: PW });
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of Object.keys(id)) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('التوظيف: شاغر ثم متقدم ثم مقابلة توصي بالتعيين ثم تعيين ينشئ الملف والحساب', async () => {
  assert.equal((await api('GET', '/api/recruitment', 'emp')).s, 403);
  const v = (await api('POST', '/api/recruitment/vacancies', 'adm', { title: 'مهندس شبكات', positions: 1, requirements: 'إجازة في هندسة الاتصالات' })).j.id;
  assert.equal((await api('POST', `/api/recruitment/vacancies/${v}/applicants`, 'adm', { name: 'عمر خليل الأحمد', nationalId: '01020304050', qualification: 'هندسة اتصالات', experience: 4 })).s, 201);
  assert.equal((await api('POST', `/api/recruitment/vacancies/${v}/applicants`, 'adm', { name: 'عمر خليل الأحمد', nationalId: '01020304050' })).s, 409, 'تقديم مكرر');
  const a = (await api('GET', `/api/recruitment/vacancies/${v}`)).j.applicants[0];
  assert.equal((await api('POST', `/api/recruitment/applicants/${a.id}/move`, 'adm', { status: 'offered' })).s, 409, 'لا قفز بين المراحل');
  await api('POST', `/api/recruitment/applicants/${a.id}/move`, 'adm', { status: 'shortlisted' });
  await api('POST', `/api/recruitment/applicants/${a.id}/move`, 'adm', { status: 'interview' });
  assert.equal((await api('POST', `/api/recruitment/applicants/${a.id}/move`, 'adm', { status: 'offered' })).s, 409, 'العرض بعد مقابلة توصي بالتعيين');
  const iv = (await api('POST', `/api/recruitment/applicants/${a.id}/interviews`, 'adm', { at: `${iso(2)}T10:00`, panel: 'مدير التقانة، رئيس قسم الشبكات' })).j.id;
  assert.equal((await api('POST', `/api/recruitment/interviews/${iv}/result`, 'adm', { score: 86, recommendation: 'hire', notes: 'متمكن' })).s, 200);
  assert.equal((await api('POST', `/api/recruitment/applicants/${a.id}/move`, 'adm', { status: 'offered' })).s, 200);
  const h = await api('POST', `/api/recruitment/applicants/${a.id}/hire`, 'adm', { baseSalary: 900000 });
  assert.equal(h.s, 201, JSON.stringify(h.j)); assert.ok(h.j.account.tempPassword);
  const emp = app.db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(h.j.employeeId);
  assert.equal(emp.name, 'عمر خليل الأحمد'); assert.ok(emp.user_id);
  assert.equal((await api('GET', `/api/recruitment/vacancies/${v}`)).j.vacancy.status, 'filled', 'اكتمل الشاغر');
});

test('حجز القاعات: لا تعارض مع حجز آخر ولا مع محاضرة مجدولة، ويعتمده المختص', async () => {
  const room = (await api('POST', '/api/facilities/rooms', 'fac', { name: 'قاعة المؤتمرات', building: 'أ', capacity: 40 })).j.id;
  assert.equal((await api('POST', '/api/facilities/rooms', 'emp', { name: 'قاعة أخرى' })).s, 403);
  const day = iso(3);
  const b1 = await api('POST', '/api/facilities/bookings', 'emp', { roomId: room, day, start: '10:00', end: '12:00', title: 'ورشة عمل' });
  assert.equal(b1.j.status, 'pending');
  const clash = await api('POST', '/api/facilities/bookings', 'emp', { roomId: room, day, start: '11:00', end: '13:00', title: 'اجتماع' });
  assert.equal(clash.s, 409); assert.match(clash.j.message, /محجوزة/);
  assert.equal((await api('POST', '/api/facilities/bookings', 'emp', { roomId: room, day, start: '12:00', end: '13:00', title: 'اجتماع', attendees: 60 })).s, 400, 'السعة');
  const prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const course = Number(app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, 'مقرر', 'OPS-1', 3) RETURNING id").get(prog).id);
  app.db.prepare('INSERT INTO course_schedules (course_id, day, start_min, end_min, hall) VALUES (?, ?, 840, 900, ?)').run(course, new Date(`${day}T12:00:00Z`).getUTCDay(), 'قاعة المؤتمرات');
  const lecture = await api('POST', '/api/facilities/bookings', 'emp', { roomId: room, day, start: '14:30', end: '15:30', title: 'لقاء' });
  assert.equal(lecture.s, 409); assert.match(lecture.j.message, /محاضرة/);
  assert.equal((await api('POST', `/api/facilities/bookings/${b1.j.id}/decide`, 'emp', { decision: 'approved' })).s, 403);
  assert.equal((await api('POST', `/api/facilities/bookings/${b1.j.id}/decide`, 'fac', { decision: 'approved' })).s, 200);
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE kind = 'room_booking' AND user_id = ?").get(id.emp));
});

test('الصيانة: بلاغ ثم إسناد ثم تنفيذ ثم تأكيد صاحب البلاغ أو إعادة فتحه', async () => {
  const r = await api('POST', '/api/facilities/maintenance', 'emp', { location: 'المبنى ب، المخبر 2', category: 'كهرباء', priority: 'urgent', description: 'انقطاع التيار عن نصف المقاعد' });
  assert.equal(r.s, 201); const oid = r.j.id;
  assert.equal((await api('POST', `/api/facilities/maintenance/${oid}/action`, 'emp', { action: 'assign', assigneeId: id.tech })).s, 403);
  assert.equal((await api('POST', `/api/facilities/maintenance/${oid}/action`, 'fac', { action: 'assign', assigneeId: id.tech })).s, 200);
  assert.ok(app.db.prepare("SELECT 1 FROM user_notifications WHERE kind = 'maintenance_assigned' AND user_id = ?").get(id.tech));
  assert.equal((await api('POST', `/api/facilities/maintenance/${oid}/action`, 'emp', { action: 'done', note: 'تم' })).s, 403);
  assert.equal((await api('POST', `/api/facilities/maintenance/${oid}/action`, 'tech', { action: 'done', note: 'استُبدل القاطع', cost: 15000 })).s, 200);
  assert.equal((await api('POST', `/api/facilities/maintenance/${oid}/action`, 'emp', { action: 'reopen' })).s, 200);
  assert.equal(app.db.prepare('SELECT status FROM maintenance_orders WHERE id = ?').get(oid).status, 'assigned');
  await api('POST', `/api/facilities/maintenance/${oid}/action`, 'tech', { action: 'done', note: 'أُصلحت الوصلة الرئيسية' });
  assert.equal((await api('POST', `/api/facilities/maintenance/${oid}/action`, 'emp', { action: 'close' })).s, 200);
  const mine = (await api('GET', '/api/facilities', 'tech')).j.orders;
  assert.equal(mine.length, 1, 'الفني يرى ما أُسند إليه');
});

test('عروض الأسعار: على طلب معتمد، والترسية على غير الأرخص تحتاج تبريراً، وتنشئ أمر التوريد بأسعار العرض', async () => {
  const now = Date.now();
  const sups = ['مورّد أ', 'مورّد ب'].map((n, i) => Number(app.db.prepare('INSERT INTO proc_suppliers (code, name, created_at) VALUES (?,?,?) RETURNING id').get(`S-${i}`, n, now).id));
  const req = (await api('POST', '/api/procurement/requests', 'adm', { title: 'حواسيب مخبر', submit: true, lines: [{ description: 'حاسوب', qty: 4, estCost: 100000 }] })).j.request.id;
  assert.equal((await api('POST', '/api/procurement/rfqs', 'adm', { requestId: req, closesOn: iso(7) })).s, 409, 'الطلب غير معتمد');
  app.db.prepare("UPDATE proc_requests SET status = 'approved' WHERE id = ?").run(req);
  const rfq = (await api('POST', '/api/procurement/rfqs', 'adm', { requestId: req, closesOn: iso(7) })).j.id;
  const line = Number(app.db.prepare('SELECT id FROM proc_request_lines WHERE request_id = ?').get(req).id);
  assert.equal((await api('POST', `/api/procurement/rfqs/${rfq}/quotes`, 'adm', { supplierId: sups[0], prices: { [line]: 90000 }, deliveryDays: 10 })).j.total, 360000);
  await api('POST', `/api/procurement/rfqs/${rfq}/quotes`, 'adm', { supplierId: sups[1], prices: { [line]: 95000 }, deliveryDays: 3 });
  const quotes = app.db.prepare('SELECT id, supplier_id FROM proc_rfq_quotes WHERE rfq_id = ?').all(rfq);
  const dear = quotes.find((q) => Number(q.supplier_id) === sups[1]).id;
  const refused = await api('POST', `/api/procurement/rfqs/${rfq}/award`, 'adm', { quoteId: dear });
  assert.equal(refused.s, 409); assert.match(refused.j.message, /الأرخص/); assert.match(refused.j.message, /أقل من 3/);
  const ok = await api('POST', `/api/procurement/rfqs/${rfq}/award`, 'adm', { quoteId: dear, note: 'مدة التوريد أقصر بأسبوع لحاجة المخبر العاجلة' });
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  const order = app.db.prepare('SELECT * FROM proc_orders WHERE id = ?').get(ok.j.orderId);
  assert.equal(Number(order.supplier_id), sups[1]); assert.equal(Number(order.total_amount), 380000);
  assert.equal(app.db.prepare('SELECT status FROM proc_requests WHERE id = ?').get(req).status, 'ordered');
  assert.equal((await api('POST', '/api/procurement/supplier-ratings', 'adm', { orderId: order.id, quality: 5, timeliness: 4, price: 3 })).s, 409, 'التقييم بعد الاستلام');
  app.db.prepare("UPDATE proc_orders SET status = 'received' WHERE id = ?").run(order.id);
  assert.equal((await api('POST', '/api/procurement/supplier-ratings', 'adm', { orderId: order.id, quality: 5, timeliness: 4, price: 3 })).s, 201);
  assert.equal((await api('GET', '/api/procurement/quotations')).j.suppliers.find((s) => s.id === sups[1]).score, 4);
});
