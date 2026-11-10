import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure } from '../server/services/structure.js';
import { ensureForms } from '../server/services/forms/index.js';
import { academicYear } from '../server/lib/doc_no.js';
import { ready as readyFinance } from '../server/services/finance/core.js';
import { createCharge, createPayment } from '../server/services/finance/fees.js';
import { enrollAcceptedApplicant, executeLifecycleMovement, decideMovementStep } from '../server/services/student_affairs_suite.js';
import { escalateOverdueRequests } from '../server/services/escalation.js';
import { scan } from '../server/services/attendance.js';

const PW = 'Test#Pass12345';
const HOUR = 3600_000;
const PROFILE = { first_name: 'سارة', father_name: 'خالد', last_name: 'النوري', mother_name: 'هدى', gender: 'أنثى', birth_date: '2006-03-01', birth_place: 'حمص', nationality: 'سورية', phone: '0944000111', governorate: 'حمص', city: 'حمص', address: 'الحي الغربي', guardian_name: 'خالد النوري', guardian_relation: 'الأب', guardian_phone: '0944000222' };
let app, base, adm, hash, prog, seq = 0, admin, chief;

const api = async (m, u, { body, cookie } = {}) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const put = (values) => api('PUT', '/api/admin/general', { cookie: adm, body: { values } });
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function student() {
  const no = `LNK-${++seq}`, now = Date.now();
  const id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,'student',?,?)").run(no, `طالب ${no}`, hash, no, now).lastInsertRowid);
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id, no, `7${String(id).padStart(10, '0')}`, prog, now, now);
  return { id, no, cookie: await login(no) };
}
const course = (code) => { app.db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours) VALUES (?, 1, 1, ?, ?, 3)').run(prog, `مقرر ${code}`, code); return code; };
const enroll = (s, code, section_id) => api('POST', '/api/enterprise/self-enroll', { cookie: s.cookie, body: { course_code: code, ...(section_id ? { section_id } : {}) } });
const section = async (code, name, capacity) => { const r = await api('POST', '/api/enterprise/sections', { cookie: adm, body: { courseCode: code, name, capacity } }); assert.equal(r.s, 201, JSON.stringify(r.j)); return r.j.id; };
const enrollment = (s, code) => app.db.prepare('SELECT * FROM student_self_enrollments WHERE student_no = ? AND course_code = ? ORDER BY id DESC LIMIT 1').get(s.no, code);
const feeType = () => { readyFinance(app.db); return app.db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'fee' AND active = 1 ORDER BY id LIMIT 1").get().id; };
const notes = (kind, userId) => app.db.prepare('SELECT * FROM user_notifications WHERE kind = ? AND user_id = ?').all(kind, userId);
const finishChain = (id) => { for (;;) { const r = decideMovementStep(app, chief, id, { decision: 'approve' }, '::1'); if (r.status !== 'pending') return r; } };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-links-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  hash = await hashPassword(PW, 1024);
  const add = (u) => Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,'admin',?)").run(u, u, hash, Date.now()).lastInsertRowid);
  const mk = (id, label) => ({ id, role: 'admin', name: label, display_name: label, label, can: () => true });
  admin = mk(add('adm'), 'مدير'); chief = mk(add('chief'), 'رئيس');
  await ensureStructure(app, { activate: true, password: PW });
  ensureForms(app);
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  prog = app.db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  adm = await login('adm');
});
test.after(async () => { await app.close(); });

test('الشعب: الاختيار إلزامي، والسعة تُطبَّق، والحذف يحرر المقعد ويبقي الأثر', async () => {
  const a = await student(), b = await student(), code = course('SEC-A');
  assert.equal((await api('POST', '/api/enterprise/sections', { cookie: a.cookie, body: { courseCode: code, name: 'أ', capacity: 1 } })).s, 403);
  const sec = await section(code, 'أ', 1);
  assert.equal((await api('POST', '/api/enterprise/sections', { cookie: adm, body: { courseCode: code, name: 'أ', capacity: 1 } })).s, 409);
  assert.equal((await enroll(a, code)).s, 400, 'الشعبة إلزامية');
  assert.equal((await enroll(a, code, sec)).s, 201);
  assert.equal(enrollment(a, code).section_id, sec);
  const full = await enroll(b, code, sec);
  assert.equal(full.s, 409); assert.match(full.j.message, /مكتملة/);
  assert.equal((await api('PUT', `/api/enterprise/sections/${sec}`, { cookie: adm, body: { capacity: 0 } })).s, 400);

  const rowId = enrollment(a, code).id;
  assert.equal((await api('POST', `/api/enterprise/self-enroll/${rowId}/drop`, { cookie: b.cookie })).s, 404, 'لا يحذف تسجيل غيره');
  assert.equal((await api('POST', `/api/enterprise/self-enroll/${rowId}/drop`, { cookie: a.cookie })).s, 200);
  assert.equal((await api('POST', `/api/enterprise/self-enroll/${rowId}/drop`, { cookie: a.cookie })).s, 409);
  assert.equal(enrollment(a, code).status, 'محذوف');
  assert.equal((await enroll(b, code, sec)).s, 201, 'تحرر المقعد');
  await api('PUT', `/api/enterprise/sections/${sec}`, { cookie: adm, body: { capacity: 2 } });
  assert.equal((await enroll(a, code, sec)).s, 201, 'يعود بعد الحذف');
});

test('فترة التسجيل: تمنع الطالب خارجها، وتبقى متاحة للموظف المختص', async () => {
  const a = await student(), code = course('WIN-A');
  const staffEnroll = () => api('POST', '/api/enterprise/self-enroll', { cookie: adm, body: { course_code: code, student_no: a.no } });
  try {
    assert.equal((await put({ 'academic.registration_open': day(2) })).s, 200);
    let r = await enroll(a, code);
    assert.equal(r.s, 409); assert.match(r.j.message, /يبدأ/);
    await put({ 'academic.registration_open': day(-9), 'academic.add_drop_close': day(-1) });
    r = await enroll(a, code);
    assert.equal(r.s, 409); assert.match(r.j.message, /انتهت/);
    assert.equal((await staffEnroll()).s, 201);
    assert.equal((await api('POST', `/api/enterprise/self-enroll/${enrollment(a, code).id}/drop`, { cookie: a.cookie })).s, 409);
    await put({ 'academic.add_drop_close': day(5) });
    assert.equal((await api('POST', `/api/enterprise/self-enroll/${enrollment(a, code).id}/drop`, { cookie: a.cookie })).s, 200);
  } finally { await put({ 'academic.registration_open': '', 'academic.add_drop_close': '' }); }
});

test('الدفع يفتح التسجيل: المستحق الحال يمنع، والقسط الآجل لا يمنع، والسداد يبلّغ الطالب', async () => {
  const a = await student(), code = course('PAY-A'), ft = feeType();
  createCharge(app, admin, { studentId: a.id, feeTypeId: ft, amount: 1000, dueDay: day(20) }, '::1');
  const later = course('PAY-L');
  assert.equal((await enroll(a, later)).s, 201, 'القسط الآجل لا يمنع');
  createCharge(app, admin, { studentId: a.id, feeTypeId: ft, amount: 500, dueDay: day(-2) }, '::1');
  const r = await enroll(a, code);
  assert.equal(r.s, 409); assert.equal(r.j.code ?? r.j.error, 'financial_dues', JSON.stringify(r.j));
  await put({ 'academic.registration_max_due': 500 });
  try { assert.equal((await enroll(a, code)).s, 201, 'الحد قابل للتعديل'); } finally { await put({ 'academic.registration_max_due': 0 }); }
  const b = await student();
  createCharge(app, admin, { studentId: b.id, feeTypeId: ft, amount: 500, dueDay: day(-2) }, '::1');
  assert.equal((await enroll(b, code)).s, 409);
  createPayment(app, admin, { studentId: b.id, amount: 500 }, '::1');
  assert.equal(notes('registration_open', b.id).length, 1);
  assert.equal((await enroll(b, code)).s, 201);
});

test('تثبيت القبول يصدر الفاتورة من هيكل الرسوم ويبلّغ مكتب الوثائق', async () => {
  feeType();
  const now = Date.now();
  app.db.prepare('INSERT INTO fin_fee_structures (program_id, academic_year, semester, tuition_fee, registration_fee, total_fee, created_at) VALUES (?, ?, 1, 400, 100, 500, ?)').run(prog, academicYear(), now);
  const addApp = (no, nid) => Number(app.db.prepare("INSERT INTO sa_applicants (application_no, full_name, national_id, phone, hs_type, hs_score, hs_year, category, pref1_program_id, accepted_program_id, sorting_status, created_at) VALUES (?, 'سارة خالد النوري', ?, '0933000000', 'علمي', 230, 2026, 'general', ?, ?, 'accepted', ?) RETURNING id").get(no, nid, prog, prog, now).id);
  const docs = app.db.prepare("SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE o.code = 'of_docs' AND u.active = 1 ORDER BY u.id LIMIT 1").get().id;
  const r = await enrollAcceptedApplicant(app, admin, addApp('APP-L1', '30000000001'), PROFILE, '::1');
  assert.equal(r.followUp.invoiceCount, 1, JSON.stringify(r.followUp));
  const charge = app.db.prepare('SELECT amount, academic_year FROM fin_charges WHERE student_id = ?').get(r.student.id);
  assert.equal(Number(charge.amount), 50000); assert.equal(charge.academic_year, academicYear());
  assert.ok(notes('card_needed', docs).some((n) => Number(n.ref_id) === Number(r.student.id)));
  await put({ 'academic.auto_invoice_on_admission': false });
  try {
    const r2 = await enrollAcceptedApplicant(app, admin, addApp('APP-L2', '30000000002'), { ...PROFILE, birth_date: '2006-04-02' }, '::1');
    assert.equal(r2.followUp.invoiceCount, 0);
  } finally { await put({ 'academic.auto_invoice_on_admission': true }); }
});

test('التأجيل: يلغي تسجيل الفصل، ويوقف المطالبات الجديدة، ويبلّغ الامتحانات والسكن', async () => {
  const a = await student(), code = course('POS-A'), ft = feeType();
  assert.equal((await enroll(a, code)).s, 201);
  const mv = executeLifecycleMovement(app, admin, { studentId: a.id, movementType: 'postponement', reason: 'ظرف صحي', durationSemesters: 1 }, '::1');
  finishChain(mv.id);
  assert.ok(enrollment(a, code).dropped_at, 'أُلغي تسجيل الفصل');
  assert.throws(() => createCharge(app, admin, { studentId: a.id, feeTypeId: ft, amount: 100, dueDay: day(1) }, '::1'), (e) => e.status === 409 && /لا تصدر/.test(e.message));
  const discount = app.db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'discount' AND active = 1 ORDER BY id LIMIT 1").get();
  if (discount) assert.ok(createCharge(app, admin, { studentId: a.id, feeTypeId: discount.id, amount: 50, dueDay: day(1) }, '::1').id, 'الخصم ممكن');
  const staffOf = (unit) => app.db.prepare('SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE o.code = ? AND u.active = 1 ORDER BY u.id LIMIT 1').get(unit).id;
  for (const u of ['exams', 'of_housing']) assert.ok(notes('lifecycle', staffOf(u)).some((n) => Number(n.ref_id) === Number(mv.id)), u);
  const r = await enroll(a, course('POS-B'));
  assert.equal(r.s, 403);
});

test('تصعيد المهل: مرة لكل مستوى، إلى الوحدة الأعلى، وضمن الحد والإعداد', async () => {
  const a = await student();
  const req = await api('POST', '/api/requests', { cookie: a.cookie, body: { service: 'housing_repair', details: { f1: '204', f2: 'كهرباء', f3: 'مستعجل', f4: 'انقطاع التيار' } } });
  assert.equal(req.s, 201, JSON.stringify(req.j));
  const id = req.j.request.id, row = () => app.db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  const events = () => app.db.prepare("SELECT text FROM request_events WHERE request_id = ? AND text LIKE 'تصعيد%'").all(id);
  const parentUser = app.db.prepare("SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE o.code = 'sa_services' AND u.active = 1 ORDER BY u.id LIMIT 1").get().id;
  const now = Date.now();
  assert.equal(Number(row().escalation_level), 0);
  escalateOverdueRequests(app.db, now);
  assert.equal(Number(row().escalation_level), 0, 'لم تنتهِ المهلة');
  app.db.prepare('UPDATE requests SET created_at = ? WHERE id = ?').run(now - 1000 * HOUR, id);
  await put({ 'requests.escalation_enabled': false });
  escalateOverdueRequests(app.db, now);
  assert.equal(Number(row().escalation_level), 0, 'الإعداد يعطله');
  await put({ 'requests.escalation_enabled': true });
  escalateOverdueRequests(app.db, now);
  assert.equal(Number(row().escalation_level), 1);
  assert.equal(events().length, 1);
  assert.ok(notes('sla_escalation_1', parentUser).some((n) => Number(n.ref_id) === Number(id)));
  escalateOverdueRequests(app.db, now + HOUR);
  assert.equal(Number(row().escalation_level), 1, 'لا يتكرر قبل مدة التكرار');
  escalateOverdueRequests(app.db, now + 25 * HOUR);
  assert.equal(Number(row().escalation_level), 2);
  escalateOverdueRequests(app.db, now + 80 * HOUR);
  assert.equal(Number(row().escalation_level), 2, 'الحد الأقصى للمستويات');
  assert.equal((await api('GET', `/api/requests/${id}`, { cookie: a.cookie })).j.request.escalationLevel, 2);
});

test('إيقاف البطاقة: يبلّغ عنها صاحبها، وتُرفض عند القارئ والبوابة، ويرفعها المختص', async () => {
  const a = await student(), b = await student();
  const block = (cookie, id, reason) => api('POST', `/api/students/${id}/card/block`, { cookie, body: { reason } });
  assert.equal((await block(b.cookie, a.id, 'lost')).s, 403);
  assert.equal((await block(a.cookie, a.id, 'admin')).s, 400, 'الطالب يبلّغ عن فقدان أو سرقة فقط');
  assert.equal((await block(a.cookie, a.id, 'lost')).s, 200);
  assert.equal((await block(a.cookie, a.id, 'stolen')).s, 409);
  assert.throws(() => scan(app, admin, { code: a.no, hall: 'ق1', subject: 'مادة', kind: 'lecture' }, '::1'), (e) => e.code === 'card_blocked');
  const gate = await api('POST', `/api/students/${a.id}/card-activity`, { cookie: adm, body: { eventType: 'check_in', locationName: 'البوابة', locationCode: 'G1', status: 'granted' } });
  assert.ok(gate.s < 300, JSON.stringify(gate.j));
  const log = await api('GET', `/api/students/${a.id}/card-activity`, { cookie: adm });
  assert.equal(log.j.logs[0].status, 'denied'); assert.equal(log.j.block.reason, 'lost');
  assert.equal((await api('POST', `/api/students/${a.id}/card/unblock`, { cookie: a.cookie })).s, 403);
  assert.equal((await api('POST', `/api/students/${a.id}/card/unblock`, { cookie: adm })).s, 200);
  assert.equal((await api('GET', `/api/students/${a.id}/card-activity`, { cookie: adm })).j.block, null);
  assert.equal((await block(a.cookie, a.id, 'stolen')).s, 200, 'يمكن إيقافها مجدداً');
});

test('الروابط: المعرّف يُملأ تلقائياً، وتغيير الأصل ينعكس على النص', async () => {
  const a = await student(), code = course('REL-A');
  assert.equal((await enroll(a, code)).s, 201);
  const cid = app.db.prepare('SELECT id FROM courses WHERE code = ?').get(code).id;
  assert.equal(Number(enrollment(a, code).course_id), Number(cid));
  app.db.prepare("UPDATE courses SET code = 'REL-B', name = 'اسم جديد' WHERE id = ?").run(cid);
  const moved = enrollment(a, 'REL-B');
  assert.equal(moved.course_name, 'اسم جديد'); assert.equal(Number(moved.course_id), Number(cid));

  const fac = app.db.prepare('SELECT id, name FROM faculties ORDER BY id LIMIT 1').get();
  app.db.prepare("INSERT INTO student_fee_installments (installment_code, student_no, student_name, faculty_name, installment_no, amount, due_date) VALUES ('I-LNK', ?, 'ط', ?, 1, 10, ?)").run(a.no, fac.name, day(30));
  const inst = () => app.db.prepare("SELECT * FROM student_fee_installments WHERE installment_code = 'I-LNK'").get();
  assert.equal(Number(inst().faculty_id), Number(fac.id));
  app.db.prepare('UPDATE faculties SET name = ? WHERE id = ?').run(`${fac.name} معدل`, fac.id);
  assert.equal(inst().faculty_name, `${fac.name} معدل`);
  app.db.prepare('UPDATE faculties SET name = ? WHERE id = ?').run(fac.name, fac.id);

  const map = app.db.prepare('SELECT tbl, id_col, text_col FROM text_link_map').all();
  assert.ok(new Set(map.map((m) => m.tbl)).size >= 21);
  for (const m of map) {
    for (const col of [m.id_col, m.text_col]) assert.ok(app.db.prepare('SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?').get(m.tbl, col), `${m.tbl}.${col}`);
  }
});
