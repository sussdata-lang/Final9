import { verifyAuditChain } from '../server/audit.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword, resetTieredRateLimit } from '../server/security.js';
import { readXlsx, writeXlsx } from '../server/lib/xlsx.js';
import { IMPORT_DEFS } from '../server/services/import_defs.js';
import { ready } from '../server/services/finance/core.js';

const PW = 'Str0ng-Test-Pass!';
let app, call, adm, stu, plainStaff, procUser, otherProc, undoUser;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const csv = (rows) => b64(rows.map((r) => r.join(',')).join('\n'));
const count = (t) => Number(app.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
const check = (kind, data, cookie = adm, filename = 'f.csv') => call('POST', `/api/import-engine/${kind}/check`, { cookie, body: { filename, data } });
const commit = (kind, stagingToken, cookie = adm, extra = {}) => call('POST', `/api/import-engine/${kind}/commit`, { cookie, body: { stagingToken, ...extra } });
const SUP = [['الرمز', 'الاسم', 'الهاتف'], ['SUP-1', 'مورد أول', '0944111222'], ['SUP-2', 'مورد ثان', '0944111333']];

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-imp-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  call = async (method, url, { body, cookie } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const isJson = (res.headers.get('content-type') || '').includes('json');
    return { status: res.status, json: isJson ? await res.json() : null, buf: isJson ? null : Buffer.from(await res.arrayBuffer()), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const hash = await hashPassword(PW, 1024);
  const add = (u, role, perms = null) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, custom_permissions_json, created_at) VALUES (?,?,?,?,?,?,?)').run(u, u, hash, role, role === 'student' ? `NO-${u}` : null, perms ? JSON.stringify(perms) : null, Date.now());
  add('adm', 'admin'); add('stu', 'student'); add('plain', 'staff'); add('proc', 'staff', ['import:procurement']); add('proc2', 'staff', ['import:procurement']); add('undoer', 'staff', ['import:procurement', 'import:undo']);
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
  adm = await login('adm'); stu = await login('stu'); plainStaff = await login('plain'); procUser = await login('proc'); otherProc = await login('proc2'); undoUser = await login('undoer');
});
test.after(async () => { if (app) await app.close(); });
test.beforeEach(() => resetTieredRateLimit());   // عدد طلبات هذا الملف يتجاوز حد الدقيقة العام، وهو يُختبر في مساره

test('فحص الأنواع المالية لا يهيّئ المالية ولا يكتب شيئاً', async () => {
  const tables = ['fin_accounts', 'fin_years', 'fin_fee_types'], before = tables.map((t) => count(t));
  assert.equal(before[0], 0, 'قاعدة لم تُهيَّأ بعد');
  const r = await check('fin_payments', csv([['رقم الإيصال', 'الرقم الجامعي', 'المبلغ', 'الطريقة', 'تاريخ الدفع'], ['R-0', 'NO-stu', '10', 'نقداً', '2026-01-01']]));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.errors[0].message, /سنة مالية/);
  assert.deepEqual(tables.map((t) => count(t)), before);
});

test('الفحص لا يكتب، والحفظ يكتب مرة واحدة فقط', async () => {
  const before = count('proc_suppliers');
  const r = await check('proc_suppliers', csv(SUP));
  assert.equal(r.status, 200);
  assert.equal(r.json.valid, 2);
  assert.equal(r.json.impact.create, 2);
  assert.ok(r.json.stagingToken.length === 64);
  assert.equal(count('proc_suppliers'), before, 'الفحص لا يكتب');
  const c = await commit('proc_suppliers', r.json.stagingToken);
  assert.equal(c.status, 200);
  assert.equal(c.json.created, 2);
  assert.equal(count('proc_suppliers'), before + 2);
  assert.equal((await commit('proc_suppliers', r.json.stagingToken)).status, 410, 'الرمز لمرة واحدة');
  assert.equal(count('proc_suppliers'), before + 2);
  assert.equal(count('import_staging'), 0);
});

test('الإلغاء وانتهاء المهلة لا يكتبان ويحذفان الملف المؤقت', async () => {
  const data = csv([SUP[0], ['SUP-X', 'ملغى', '']]), before = count('proc_suppliers');
  const r = await check('proc_suppliers', data);
  assert.equal(count('import_staging'), 1);
  assert.equal((await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: r.json.stagingToken } })).status, 200);
  assert.equal(count('import_staging'), 0);
  assert.equal(count('import_staging_chunks'), 0);
  assert.equal((await commit('proc_suppliers', r.json.stagingToken)).status, 410);
  const r2 = await check('proc_suppliers', data);
  app.db.prepare('UPDATE import_staging SET expires_at = ?').run(Date.now() - 1000);
  assert.equal((await commit('proc_suppliers', r2.json.stagingToken)).status, 410, 'انتهت المهلة');
  assert.equal(count('proc_suppliers'), before);
  await check('proc_suppliers', data).then((x) => call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: x.json.stagingToken } }));
  assert.equal(count('import_staging'), 0, 'المنتهي يُنظَّف');
});

test('رفض الصفوف الفاسدة والمكررة، والحفظ الجزئي صريح', async () => {
  const before = count('proc_suppliers');
  const r = await check('proc_suppliers', csv([SUP[0], ['SUP-A', 'صالح', '0944000111'], ['SUP-A', 'مكرر', ''], ['', 'بلا رمز', ''], ['SUP-B', 'هاتف فاسد', 'abc']]));
  assert.equal(r.json.valid, 1);
  assert.equal(r.json.errorCount, 3);
  assert.deepEqual(r.json.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(r.json.errors[0].message, /مكرر/);
  assert.match(r.json.errors[1].message, /مطلوب/);
  assert.equal((await commit('proc_suppliers', r.json.stagingToken)).status, 409, 'لا حفظ مع أخطاء بلا موافقة');
  assert.equal(count('proc_suppliers'), before);
  const ok = await commit('proc_suppliers', r.json.stagingToken, adm, { acceptPartial: true });
  assert.equal(ok.status, 200, 'الرمز لم يُستهلك بالمحاولة المرفوضة');
  assert.equal(ok.json.created, 1);
  assert.equal(ok.json.skipped, 3);
  assert.equal(count('proc_suppliers'), before + 1);
});

test('التحديث بالمفتاح لا يكرر، والخلية الفارغة لا تمسح، وغير المتغير لا يُكتب', async () => {
  await commit('proc_suppliers', (await check('proc_suppliers', csv([SUP[0], ['UP-1', 'الأصلي', '0944555666']]))).json.stagingToken);
  const n = count('proc_suppliers');
  const r = await check('proc_suppliers', csv([SUP[0], ['up-1', 'معدّل', '']]));
  assert.equal(r.json.impact.update, 1);
  assert.equal((await commit('proc_suppliers', r.json.stagingToken)).json.updated, 1);
  assert.equal(count('proc_suppliers'), n);
  const row = app.db.prepare("SELECT name, phone FROM proc_suppliers WHERE code = 'UP-1'").get();
  assert.equal(row.name, 'معدّل');
  assert.equal(row.phone, '0944555666');
  const again = await check('proc_suppliers', csv([SUP[0], ['UP-1', 'معدّل', '']]));
  assert.equal(again.json.impact.unchanged, 1);
});

test('الصلاحيات: 403 بلا صلاحية، ورمز مستخدم آخر مرفوض، والقائمة حسب الصلاحية', async () => {
  for (const c of [stu, plainStaff]) {
    assert.equal((await check('proc_suppliers', csv(SUP), c)).status, 403);
    assert.equal((await call('GET', '/api/import-engine/proc_suppliers/template', { cookie: c })).status, 403);
  }
  assert.equal((await check('fin_accounts', csv(SUP), procUser)).status, 403, 'صلاحية وحدة أخرى');
  assert.equal((await check('nope', csv(SUP))).status, 404);
  const r = await check('proc_suppliers', csv([SUP[0], ['OWN-1', 'مورد', '']]), procUser);
  assert.equal(r.status, 200);
  assert.equal((await commit('proc_suppliers', r.json.stagingToken, otherProc)).status, 410, 'رمز مستخدم آخر');
  assert.equal((await commit('proc_suppliers', r.json.stagingToken, procUser)).status, 200);
  assert.equal(verifyAuditChain(app.db).ok, true, 'الاستيراد في خيط مستقل لا يكسر سلسلة التدقيق');
  const cat = (await call('GET', '/api/import-engine/catalog', { cookie: procUser })).json;
  assert.ok(cat.kinds.length > 0 && cat.kinds.every((k) => k.group === 'procurement'));
  assert.equal(cat.canUndo, false);
  assert.equal((await call('GET', '/api/import-engine/catalog', { cookie: stu })).json.kinds.length, 0);
});

test('الملف لا يكتب أعمدة خارج التعريف، وتُطهَّر الصيغ', async () => {
  const r = await check('proc_suppliers', csv([[...SUP[0], 'active_x'], ['=CMD()', '=1+1', '', 'x']]));
  assert.deepEqual(r.json.unusedColumns, ['active_x']);
  await commit('proc_suppliers', r.json.stagingToken);
  const row = app.db.prepare("SELECT code, name FROM proc_suppliers WHERE code = '''=CMD()'").get();
  assert.equal(row.name, "'=1+1");
  assert.equal((await check('proc_suppliers', b64('x'), adm, 'evil.exe')).status, 400);
  const sql = b64("DROP TABLE users; INSERT INTO proc_suppliers (code, name) VALUES ('SQL-1', 'من sql');");
  const s = await check('proc_suppliers', sql, adm, 'f.sql');
  assert.equal(s.json.valid, 1);
  assert.ok(count('users') > 0);
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: s.json.stagingToken } });
});

test('xlsx وcsv وsql تعطي النتيجة نفسها، والقالب يعود سليماً', async () => {
  const t = await call('GET', '/api/import-engine/proc_suppliers/template', { cookie: adm });
  assert.equal(t.status, 200);
  const wb = readXlsx(t.buf);
  assert.deepEqual(wb.sheets.map((s) => s.name), ['البيانات', 'القوائم', 'تعليمات']);
  assert.ok(wb.sheets[0].rows[0].includes('الرمز *'));
  const fromX = await check('proc_suppliers', t.buf.toString('base64'), adm, 'import-proc_suppliers.xlsx');
  assert.equal(fromX.json.errorCount, 0);
  assert.equal(fromX.json.valid, 1);
  assert.ok(fromX.json.warnings.some((w) => /مثال القالب/.test(w)));
  const c = await call('GET', '/api/import-engine/proc_suppliers/template?format=csv', { cookie: adm });
  const fromC = await check('proc_suppliers', c.buf.toString('base64'), adm, 'x.csv');
  const fromS = await check('proc_suppliers', b64("INSERT INTO proc_suppliers (code, name, phone, email, address, active) VALUES ('SUP-SMPL', 'مورد تجريبي', '0944000000', 'supplier@example.com', 'دمشق', 'نعم');"), adm, 'x.sql');
  assert.deepEqual([fromC.json.valid, fromS.json.valid], [1, 1]);
  assert.deepEqual([fromX.json.preview, fromC.json.preview], [fromS.json.preview, fromS.json.preview]);
  assert.equal((await commit('proc_suppliers', fromS.json.stagingToken)).status, 200);
  assert.equal(app.db.prepare("SELECT email FROM proc_suppliers WHERE code = 'SUP-SMPL'").get().email, 'supplier@example.com');
  for (const x of [fromX, fromC]) await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: x.json.stagingToken } });
  app.db.prepare("DELETE FROM proc_suppliers WHERE code = 'SUP-SMPL'").run();
});

test('التراجع يعيد الحالة حرفياً، ويُمنع عند التعارض وبعد المهلة', async () => {
  await commit('proc_suppliers', (await check('proc_suppliers', csv([SUP[0], ['U-KEEP', 'قبل', '0944777888']]))).json.stagingToken);
  const snap = () => JSON.stringify(app.db.prepare('SELECT * FROM proc_suppliers ORDER BY id').all());
  const before = snap();
  const b = await commit('proc_suppliers', (await check('proc_suppliers', csv([SUP[0], ['U-KEEP', 'بعد', ''], ['U-NEW', 'جديد', '']]))).json.stagingToken);
  assert.notEqual(snap(), before);
  assert.equal((await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: procUser, body: {} })).status, 403, 'يلزم import:undo');
  const u = await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: undoUser, body: {} });
  assert.equal(u.status, 200);
  assert.equal(u.json.reverted, 2);
  assert.equal(snap(), before, 'حرفياً');
  assert.equal((await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: undoUser, body: {} })).status, 409, 'مرة واحدة');

  const b2 = await commit('proc_suppliers', (await check('proc_suppliers', csv([SUP[0], ['U-CONF', 'جديد', '']]))).json.stagingToken);
  app.db.prepare("UPDATE proc_suppliers SET name = 'عدّله المستخدم' WHERE code = 'U-CONF'").run();
  const blocked = await call('POST', `/api/import-engine/batches/${b2.json.batchId}/undo`, { cookie: adm, body: {} });
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.message, /عُدِّل/);
  assert.equal(app.db.prepare("SELECT name FROM proc_suppliers WHERE code = 'U-CONF'").get().name, 'عدّله المستخدم');
  assert.equal(app.db.prepare('SELECT status FROM import_batches WHERE id = ?').get(b2.json.batchId).status, 'undo_blocked');

  const b3 = await commit('proc_suppliers', (await check('proc_suppliers', csv([SUP[0], ['U-OLD', 'قديم', '']]))).json.stagingToken);
  app.db.prepare('UPDATE import_batches SET committed_at = ? WHERE id = ?').run(Date.now() - 8 * 86400000, b3.json.batchId);
  assert.equal((await call('POST', `/api/import-engine/batches/${b3.json.batchId}/undo`, { cookie: adm, body: {} })).status, 409, 'بعد المهلة');

  const list = (await call('GET', '/api/import-engine/batches', { cookie: adm })).json.batches;
  assert.equal(list.find((x) => x.id === b3.json.batchId).canUndo, false);
  assert.equal(list.find((x) => x.id === b2.json.batchId).blockedReason.length > 0, true);
  assert.ok(app.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'تراجع عن استيراد%'").get().c >= 1);
});

test('التراجع يُمنع إذا اعتمدت سجلات لاحقة على الدفعة', async () => {
  const b = await commit('proc_suppliers', (await check('proc_suppliers', csv([SUP[0], ['U-FK', 'مورد', '']]))).json.stagingToken);
  const sup = app.db.prepare("SELECT id FROM proc_suppliers WHERE code = 'U-FK'").get().id;
  app.db.prepare("INSERT INTO proc_assets (code, name, supplier_id, created_at) VALUES ('AST-FK', 'أصل', ?, ?)").run(sup, Date.now());
  const r = await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: adm, body: {} });
  assert.equal(r.status, 409);
  assert.match(r.json.message, /تعتمد/);
  assert.ok(app.db.prepare("SELECT id FROM proc_suppliers WHERE code = 'U-FK'").get());
});

test('الآباء في الملف نفسه يُرتَّبون، والدورات تُرفض', async () => {
  const head = ['الرمز', 'الاسم', 'النوع', 'الوحدة الأب'];
  const r = await check('org_units', csv([head, ['CH-1', 'ابن', 'مكتب', 'PA-1'], ['PA-1', 'أب', 'قسم', '']]));
  assert.equal(r.json.errorCount, 0);
  assert.equal((await commit('org_units', r.json.stagingToken)).status, 200);
  const child = app.db.prepare("SELECT parent_id FROM org_units WHERE code = 'CH-1'").get();
  assert.equal(Number(child.parent_id), Number(app.db.prepare("SELECT id FROM org_units WHERE code = 'PA-1'").get().id));
  const cyc = await check('org_units', csv([head, ['CY-1', 'أ', 'قسم', 'CY-2'], ['CY-2', 'ب', 'قسم', 'CY-1']]));
  assert.equal(cyc.json.errorCount, 2);
  assert.match(cyc.json.errors[0].message, /دورة/);
  assert.match((await check('org_units', csv([head, ['X-1', 'أ', 'قسم', 'NOPE']]))).json.errors[0].message, /لا يوجد سجل/);
});

test('كل نوع مرجعي: القالب يُنزَّل ويُستورد، والتحديث لا يكرر، والتراجع يعمل', async () => {
  app.limiter.check = () => true;   // الحلقة تتجاوز حد الطلبات عمداً؛ الحد مختبر في مساره
  // بيانات تعتمد عليها الأنواع الأخرى
  app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code) SELECT id, 1, 1, 'مقرر أ', 'COURSE-A' FROM programs ORDER BY id LIMIT 1").run();
  app.db.prepare("INSERT INTO courses (program_id, level, semester, name, code) SELECT id, 1, 2, 'مقرر ب', 'COURSE-B' FROM programs ORDER BY id LIMIT 1").run();
  ready(app.db);   // دليل الحسابات يُزرع مرة واحدة إذا كان فارغاً
  app.db.prepare("INSERT INTO fin_accounts (code, name, type, created_at) VALUES ('T-ACC', 'حساب اختبار', 'revenue', ?)").run(Date.now());
  const stuProfile = await hashPassword(PW, 1024);
  const profId = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('LOOP-1', 'طالب الحلقة', ?, 'student', 'LOOP-1', ?)").run(stuProfile, Date.now()).lastInsertRowid);
  const progId = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'أ', 'ب', 'ج', 'د', '90000000099', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(profId, progId, Date.now(), Date.now());
  app.db.prepare("INSERT INTO dorm_rooms (building_name, room_no, capacity, occupied) VALUES ('مبنى تجريبي', '101', 5, 0)").run();
  app.db.prepare("INSERT INTO career_jobs (title, company_name, sector, location, created_at) VALUES ('وظيفة الحلقة', 'شركة', 'قطاع', 'دمشق', ?)").run(Date.now());
  app.db.prepare("INSERT INTO library_books (isbn, title, author, category, copies_total, copies_available, created_at) VALUES ('ISBN-LOOP', 'كتاب', 'مؤلف', 'عام', 5, 5, ?)").run(Date.now());
  if (!app.db.prepare("SELECT 1 AS x FROM fin_fee_types WHERE kind = 'discount' AND active = 1").get()) app.db.prepare("INSERT INTO fin_fee_types (code, name, kind, account_id) VALUES ('LOOP-DISC', 'خصم', 'discount', (SELECT id FROM fin_accounts WHERE code = 'T-ACC'))").run();
  app.db.prepare("INSERT INTO hr_employees (employeeno, name, personalid, hiredate, created_at, updated_at) VALUES ('T-EMP', 'موظف اختبار', 'T-PID', '2024-01-01', ?, ?)").run(Date.now(), Date.now());
  app.db.prepare("INSERT INTO student_groups (name, created_at) VALUES ('فئة الحلقة', ?)").run(Date.now());
  const extra = {
    student_group_members: (rows) => { rows[1][0] = 'فئة الحلقة'; rows[1][rows[0].findIndex((h) => h.startsWith('الرقم الجامعي'))] = 'LOOP-1'; },
    unit_links: (rows) => { const u = app.db.prepare('SELECT code FROM org_units WHERE code IS NOT NULL ORDER BY id LIMIT 2').all(); rows[1][0] = u[0].code; rows[1][1] = u[1].code; },
    course_schedules: (rows) => { rows[1][0] = 'COURSE-A'; },
    course_prerequisites: (rows) => { rows[1][0] = 'COURSE-B'; rows[1][1] = 'COURSE-A'; },
    programs: (rows) => { rows[1][0] = app.db.prepare('SELECT code FROM faculties ORDER BY id LIMIT 1').get().code; },
    fin_fee_types: (rows) => { rows[1][rows[0].findIndex((h) => h.startsWith('الحساب'))] = 'T-ACC'; },
    sa_lifecycle_movements: (rows) => { rows[1][rows[0].findIndex((h) => h.startsWith('الرقم الجامعي'))] = 'LOOP-1'; },
    sa_credit_equivalences: (rows) => { rows[1][rows[0].findIndex((h) => h.startsWith('الرقم الجامعي'))] = 'LOOP-1'; rows[1][rows[0].findIndex((h) => h.startsWith('رمز المقرر المقابل'))] = 'COURSE-A'; },
  };
  app.db.prepare("INSERT INTO proc_warehouses (code, name, created_at) VALUES ('WH-LOOP', 'مستودع الحلقة', ?)").run(Date.now());
  app.db.prepare("INSERT INTO proc_assets (code, name, created_at) VALUES ('AST-LOOP', 'أصل الحلقة', ?)").run(Date.now());
  for (const def of Object.values(IMPORT_DEFS)) {
    if (def.lineColumns) continue;   // المستندات ورقتان، ولها اختباراتها
    const label = def.kind;
    const t = await call('GET', `/api/import-engine/${def.kind}/template?format=xlsx`, { cookie: adm });
    assert.equal(t.status, 200, label);
    const rows = readXlsx(t.buf).sheets.find((s) => s.name === 'البيانات').rows.map((r) => r.map(String));
    extra[def.kind]?.(rows);
    const data = b64(rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n'));
    const before = count(def.table);
    const r = await check(def.kind, data);
    assert.equal(r.status, 200, label);
    assert.deepEqual(r.json.errors, [], label);
    assert.equal(count(def.table), before, `${label}: الفحص لا يكتب`);
    const c = await commit(def.kind, r.json.stagingToken, adm, { confirm: r.json.confirmWord ?? undefined });
    assert.equal(c.status, 200, `${label}: ${JSON.stringify(c.json)}`);
    assert.equal(count(def.table), before + 1, label);
    if (def.key.length) {
      const again = await check(def.kind, data);
      assert.equal(again.json.impact.create, 0, `${label}: لا يكرر`);
      await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: again.json.stagingToken } });
    }
    const u = await call('POST', `/api/import-engine/batches/${c.json.batchId}/undo`, { cookie: adm, body: {} });
    assert.equal(u.status, 200, `${label}: ${JSON.stringify(u.json)}`);
    assert.equal(count(def.table), before + Number(def.undoKeepsRow ?? 0), `${label}: التراجع`);
  }
});

/* ---------- الموارد البشرية ---------- */
const EMP = ['رقم الموظف', 'الاسم', 'الرقم الشخصي', 'تاريخ التعيين'];
const importHr = async (kind, rows, cookie = adm, extra = {}) => {
  const r = await check(kind, csv(rows), cookie);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.errors, []);
  return commit(kind, r.json.stagingToken, cookie, { confirm: r.json.confirmWord ?? undefined, ...extra });
};
const empRow = (no) => app.db.prepare('SELECT * FROM hr_employees WHERE employeeno = ?').get(no);

test('الموظفون: التحديث بالرقم، ولا حسابات دخول، ولا رواتب من هذا النوع، والرقم الشخصي لا يظهر في الأخطاء', async () => {
  const users = count('users');
  const c1 = await importHr('hr_employees', [EMP, ['H-1', 'موظف أول', '11111111111', '2024-05-01']]);
  assert.equal(c1.json.created, 1);
  assert.equal(count('users'), users, 'لا ينشئ حساب دخول');
  const row = empRow('H-1');
  assert.equal(row.status, 'active');
  assert.equal(row.joindate, '2024-05-01');
  assert.equal(Number(row.salary_base), 0);
  assert.equal((await importHr('hr_employees', [EMP, ['h-1', 'اسم معدّل', '11111111111', '2024-05-01']])).json.updated, 1);
  assert.equal(empRow('H-1').name, 'اسم معدّل');
  assert.ok(Number(empRow('H-1').updated_at) >= Number(row.updated_at));

  const dup = await check('hr_employees', csv([EMP, ['H-2', 'موظف ثان', '11111111111', '2024-05-01']]));
  assert.equal(dup.json.errorCount, 1);
  assert.match(dup.json.errors[0].message, /الرقم الشخصي/);
  assert.ok(!JSON.stringify(dup.json).includes('11111111111'), 'الرقم الشخصي لا يعود في الرد');
  const salary = await check('hr_employees', csv([[...EMP, 'الراتب الأساسي'], ['H-3', 'موظف', '333', '2024-05-01', '999999']]));
  assert.deepEqual(salary.json.unusedColumns, ['الراتب الأساسي'], 'الراتب لا يُستورد من هذا النوع');
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: salary.json.stagingToken } });
});

test('قسم الموظف من أقسام الجامعة المعتمدة فقط، والقالب يعرضها، ولا تُضاف الأقسام من القوائم', async () => {
  const head = [...EMP, 'القسم'];
  const bad = await check('hr_employees', csv([head, ['H-D1', 'موظف', '66666666666', '2024-05-01', 'التسويق']]));
  assert.match(bad.json.errors[0].message, /أقسام الجامعة المعتمدة/);
  await importHr('hr_employees', [head, ['H-D2', 'موظف', '77777777777', '2024-05-01', 'شؤون الطلاب']]);
  const row = empRow('H-D2');
  assert.equal(row.department_name, 'شؤون الطلاب');
  assert.equal(Number(row.unit_id), Number(app.db.prepare("SELECT id FROM org_units WHERE name = 'شؤون الطلاب'").get().id), 'يرتبط بوحدته');
  const lists = readXlsx((await call('GET', '/api/import-engine/hr_employees/template', { cookie: adm })).buf).sheets.find((s) => s.name === 'القوائم').rows;
  const col = lists[0].indexOf('القسم');
  const names = lists.slice(1).map((r) => r[col]);
  assert.ok(names.includes('شؤون الطلاب') && !names.includes('التسويق'));
  assert.equal((await call('POST', '/api/hr-pro/lookups', { cookie: adm, body: { category: 'departments', label: 'التسويق' } })).status, 400);
  assert.equal((await check('hr_lookups', csv([['الفئة', 'القيمة'], ['الأقسام', 'التسويق']]))).json.errorCount, 1);
});

test('الرواتب نوع خطر: صلاحية إضافية وتأكيد مكتوب، وتزامن الراتب الأساسي، والتراجع يعيده حرفياً', async () => {
  await importHr('hr_employees', [EMP, ['H-SAL', 'موظف راتب', '22222222222', '2024-05-01']]);
  const head = ['رقم الموظف', 'الراتب الأساسي', 'تاريخ السريان', 'بدل السكن'];
  const data = csv([head, ['H-SAL', '700000', '2026-01-01', '50000']]);

  // صلاحية الوحدة وحدها لا تكفي
  const hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, created_at) VALUES ('hrbasic', 'hrbasic', ?, 'staff', ?, ?)").run(hash, JSON.stringify(['import:hr']), Date.now());
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, created_at) VALUES ('hrhigh', 'hrhigh', ?, 'staff', ?, ?)").run(hash, JSON.stringify(['import:hr', 'import:high_risk']), Date.now());
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).cookie;
  const hrBasic = await login('hrbasic'), hrHigh = await login('hrhigh');
  assert.equal((await check('hr_salaries', data, hrBasic)).status, 403);
  const kinds = (await call('GET', '/api/import-engine/catalog', { cookie: hrBasic })).json.kinds.map((k) => k.kind);
  assert.ok(kinds.includes('hr_employees') && !kinds.includes('hr_salaries') && !kinds.includes('hr_advances'));

  const before = JSON.stringify(empRow('H-SAL'));
  const r = await check('hr_salaries', data, hrHigh);
  assert.equal(r.json.risk, 'high');
  assert.equal(r.json.confirmWord, 'سجلات الرواتب');
  assert.match(r.json.impactNote, /الراتب الأساسي/, 'الأثر على الموظف يظهر قبل الحفظ');
  assert.equal(JSON.stringify(empRow('H-SAL')), before, 'الفحص لا يكتب');
  assert.equal((await commit('hr_salaries', r.json.stagingToken, hrHigh)).status, 400, 'بلا تأكيد');
  assert.equal((await commit('hr_salaries', r.json.stagingToken, hrHigh, { confirm: 'خطأ' })).status, 400, 'تأكيد خاطئ');
  const saved = await commit('hr_salaries', r.json.stagingToken, hrHigh, { confirm: 'سجلات الرواتب' });
  assert.equal(saved.status, 200, 'الرمز لم يُستهلك بالمحاولتين المرفوضتين');
  const after = empRow('H-SAL');
  assert.equal(Number(after.salary_base), 700000, 'الراتب الأساسي يتزامن');
  assert.equal(Number(after.housing_allowance), 50000);
  assert.equal(count('hr_salaries') > 0, true);

  // راتب أقدم لا يغيّر الأساسي ولا البدلات، وراتب مستقبلي لا يُطبَّق قبل موعده
  await importHr('hr_salaries', [head, ['H-SAL', '100', '2020-01-01', '1']]);
  await importHr('hr_salaries', [head, ['H-SAL', '900000', '2090-01-01', '2']]);
  assert.equal(Number(empRow('H-SAL').salary_base), 700000);
  assert.equal(Number(empRow('H-SAL').housing_allowance), 50000);
  const again = await check('hr_salaries', data);
  assert.equal(again.json.impact.unchanged, 1, 'إعادة الملف لا تغيّر شيئاً');
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: again.json.stagingToken } });

  // الراتب يظهر في شاشة الموارد البشرية بالقيمة نفسها
  const ov = (await call('GET', '/api/hr-pro/overview', { cookie: adm })).json;
  assert.equal(ov.employees.find((e) => e.employeeNo === 'H-SAL').baseSalary, 700000);

  const salaries = () => JSON.stringify(app.db.prepare('SELECT * FROM hr_salaries WHERE employee_id = ? ORDER BY id').all(after.id));
  const snap = salaries(), empSnap = JSON.stringify(empRow('H-SAL'));
  const b = await importHr('hr_salaries', [head, ['H-SAL', '800000', '2026-06-01', '60000']]);
  assert.equal(Number(empRow('H-SAL').salary_base), 800000);
  assert.equal(b.json.sideUpdated, 1);
  assert.equal((await call('GET', '/api/import-engine/batches', { cookie: adm })).json.batches.find((x) => x.id === b.json.batchId).summary.sideUpdated, 1, 'نافذة التراجع تعرف أن الموظف سيعود');
  const u = await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: adm, body: {} });
  assert.equal(u.status, 200);
  assert.equal(salaries(), snap);
  assert.equal(JSON.stringify(empRow('H-SAL')), empSnap, 'التراجع يعيد الموظف حرفياً');

  // تعديل الموظف بعد الدفعة يمنع التراجع
  const b2 = await importHr('hr_salaries', [head, ['H-SAL', '810000', '2026-07-01', '']]);
  app.db.prepare("UPDATE hr_employees SET phone = '0944999999' WHERE employeeno = 'H-SAL'").run();
  const blocked = await call('POST', `/api/import-engine/batches/${b2.json.batchId}/undo`, { cookie: adm, body: {} });
  assert.equal(blocked.status, 409);
  assert.equal(Number(empRow('H-SAL').salary_base), 810000, 'لم يتغير شيء');
});

test('التراجع عن الموظفين يُمنع إن صارت لهم سجلات، فالحذف كان سيمسحها بصمت', async () => {
  const b = await importHr('hr_employees', [EMP, ['H-CAS', 'موظف', '44444444444', '2024-05-01']]);
  await importHr('hr_contracts', [['رقم الموظف', 'تاريخ البداية', 'تاريخ النهاية'], ['H-CAS', '2026-01-01', '2026-12-31']]);
  const r = await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: adm, body: {} });
  assert.equal(r.status, 409);
  assert.match(r.json.message, /تعتمد/);
  assert.ok(empRow('H-CAS'));
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM hr_contracts WHERE employee_id = ?').get(empRow('H-CAS').id).c), 1, 'العقد باق');
});

test('الأعمدة المشتقة تطابق معادلات الشاشات، ورفض الموظف غير الموجود بسبب واضح', async () => {
  await importHr('hr_employees', [EMP, ['H-CALC', 'موظف', '55555555555', '2024-05-01']]);
  await importHr('hr_salaries', [['رقم الموظف', 'الراتب الأساسي', 'تاريخ السريان'], ['H-CALC', '30000', '2026-01-01']]);
  const id = empRow('H-CALC').id;

  await importHr('hr_advances', [['رمز السلفة', 'رقم الموظف', 'تاريخ السلفة', 'قيمة السلفة', 'عدد الأقساط', 'الأقساط المدفوعة'], ['A-1', 'H-CALC', '2026-01-15', '1200', '4', '1']]);
  const adv = app.db.prepare("SELECT * FROM hr_advances WHERE advance_code = 'A-1'").get();
  assert.deepEqual([Number(adv.monthly_installment), Number(adv.remaining_amount), adv.status], [300, 900, 'مستحقة']);
  assert.match((await check('hr_advances', csv([['رمز السلفة', 'رقم الموظف', 'تاريخ السلفة', 'قيمة السلفة', 'عدد الأقساط', 'الأقساط المدفوعة'], ['A-2', 'H-CALC', '2026-01-15', '1200', '2', '5']]))).json.errors[0].message, /أكثر من عدد الأقساط/);

  await importHr('hr_absences', [['رقم الموظف', 'الشهر', 'أيام الغياب', 'السبب'], ['H-CALC', '2026-10', '3', 'غياب']]);
  const ab = app.db.prepare('SELECT * FROM hr_absences WHERE employee_id = ?').get(id);
  assert.deepEqual([Number(ab.daily_rate), Number(ab.total_deduction), ab.month, ab.status_note], [1000, 3000, 'أكتوبر', 'مراجعة إدارية']);

  await importHr('hr_leaves', [['رقم الموظف', 'نوع الإجازة', 'تاريخ البداية', 'تاريخ النهاية', 'عدد الأيام'], ['H-CALC', 'بدون راتب', '2026-02-01', '2026-02-02', '2']]);
  const lv = app.db.prepare('SELECT * FROM hr_leaves WHERE employee_id = ?').get(id);
  assert.deepEqual([lv.leave_type, lv.status, Number(lv.unpaid_deduction)], ['unpaid', 'approved', 2000]);
  const leaves = count('hr_leaves');
  assert.equal((await importHr('hr_leaves', [['رقم الموظف', 'نوع الإجازة', 'تاريخ البداية', 'تاريخ النهاية', 'عدد الأيام'], ['H-CALC', 'بدون راتب', '2026-02-01', '2026-02-02', '2']])).json.unchanged, 1);
  assert.equal(count('hr_leaves'), leaves, 'إعادة الملف لا تحسب الإجازة مرتين');

  await importHr('hr_monthly_attendance', [['رقم الموظف', 'الشهر', 'أيام الحضور', 'أيام التأخير'], ['H-CALC', '2026-10', '13', '3']]);
  const at = app.db.prepare('SELECT * FROM hr_monthly_attendance WHERE employee_id = ?').get(id);
  assert.deepEqual([Number(at.commitment_rate), Number(at.full_days), at.evaluation_note], [50, 10, 'يحتاج متابعة']);
  assert.match((await check('hr_monthly_attendance', csv([['رقم الموظف', 'الشهر', 'أيام الحضور'], ['H-CALC', '2026-11', '30']]))).json.errors[0].message, /أكثر من أيام عمل/);

  await importHr('faculty_overload', [['اسم العضو', 'الرتبة', 'الكلية', 'ساعات النصاب', 'ساعات التدريس الفعلية', 'ساعات الإشراف', 'أجر الساعة'], ['د. أ', 'مدرس', 'كلية', '10', '14', '2', '100']]);
  const ol = app.db.prepare("SELECT * FROM faculty_overload_records WHERE instructor_name = 'د. أ'").get();
  assert.deepEqual([Number(ol.overload_hours), Number(ol.total_overload_pay)], [6, 600]);

  const ct = await check('hr_contracts', csv([['رقم الموظف', 'تاريخ البداية', 'تاريخ النهاية'], ['H-CALC', '2026-12-01', '2026-01-01'], ['NOPE', '2026-01-01', '2026-12-31']]));
  assert.match(ct.json.errors[0].message, /يسبق/);
  assert.match(ct.json.errors[1].message, /لا يوجد سجل/);
  assert.match(ct.json.errors[1].message, /الموظفون/);
});

test('المفتاح المركّب: رصيد الإجازة والبصمة يتحدثان ويتراجعان بلا تكرار', async () => {
  const head = ['اسم المستخدم', 'السنة', 'الأيام'];
  const b = await importHr('leave_entitlements', [head, ['adm', '2030', '25']]);
  const get = () => app.db.prepare("SELECT days FROM leave_entitlements WHERE year = 2030").all();
  assert.equal(Number(get()[0].days), 25);
  const b2 = await importHr('leave_entitlements', [head, ['adm', '2030', '28']]);
  assert.equal(b2.json.updated, 1);
  assert.equal(get().length, 1);
  assert.equal((await call('POST', `/api/import-engine/batches/${b2.json.batchId}/undo`, { cookie: adm, body: {} })).status, 200);
  assert.equal(Number(get()[0].days), 25);
  assert.equal((await call('POST', `/api/import-engine/batches/${b.json.batchId}/undo`, { cookie: adm, body: {} })).status, 200);
  assert.equal(get().length, 0);

  const att = ['اسم المستخدم', 'اليوم', 'وقت الدخول', 'وقت الخروج'];
  assert.match((await check('staff_attendance', csv([att, ['adm', '2026-03-02', '2026-03-05 08:00', '']]))).json.errors[0].message, /لا يقع/);
  assert.match((await check('staff_attendance', csv([att, ['adm', '2026-03-02', '2026-03-02 08:00', '2026-03-02 07:00']]))).json.errors[0].message, /بعد وقت الدخول/);
  assert.equal((await importHr('staff_attendance', [att, ['adm', '2026-03-02', '2026-03-02 08:00', '2026-03-02 16:00']])).json.created, 1);
  assert.equal((await importHr('staff_attendance', [att, ['adm', '2026-03-02', '2026-03-02 08:30', '']])).json.updated, 1);
  const row = app.db.prepare("SELECT check_in, check_out FROM staff_attendance WHERE day = '2026-03-02'").get();
  assert.ok(Number(row.check_out) > Number(row.check_in), 'الخلية الفارغة لا تمسح وقت الخروج');
  assert.match((await check('staff_attendance', csv([att, ['adm', '2026-03-02', '2026-03-02 17:00', '']]))).json.errors[0].message, /بعد وقت الدخول/, 'يقارَن بالخروج المحفوظ');
});

/* ---------- المستندات: رأس وبنود ---------- */
const itemRow = (code) => app.db.prepare('SELECT * FROM proc_items WHERE code = ?').get(code);
const docFixture = (suffix, qty = 10, cost = 100) => {
  const now = Date.now();
  const wh = Number(app.db.prepare('INSERT INTO proc_warehouses (code, name, created_at) VALUES (?, ?, ?)').run(`WH-${suffix}`, `مستودع ${suffix}`, now).lastInsertRowid);
  app.db.prepare('INSERT INTO proc_suppliers (code, name, created_at) VALUES (?, ?, ?)').run(`SUP-${suffix}`, `مورد ${suffix}`, now);
  app.db.prepare('INSERT INTO proc_items (code, name, warehouse_id, qty_on_hand, avg_cost, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(`ITM-${suffix}`, `صنف ${suffix}`, wh, qty, cost, now);
};
const REQ_HEAD = ['رقم الطلب', 'العنوان', 'مقدم الطلب', 'الحالة', 'رمز الصنف', 'وصف البند', 'الكمية'];
const PO_HEAD = ['رقم الأمر', 'المورد', 'الحالة', 'رمز الصنف', 'وصف البند', 'الكمية', 'سعر الوحدة'];
const GRN_HEAD = ['رقم السند', 'أمر الشراء', 'تاريخ الاستلام', 'رمز الصنف', 'الكمية'];
const addOrder = async (no, suffix, qty, unit) => {
  const r = await importHr('proc_orders', [PO_HEAD, [no, `SUP-${suffix}`, 'مرسل', `ITM-${suffix}`, 'بند', String(qty), String(unit)]]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r;
};

test('طلبات الشراء: بنود كثيرة في مستند واحد بكل الصيغ، والمستند يُقبل أو يُرفض كاملاً، ولا يتكرر', async () => {
  docFixture('RQ');
  const rows = [REQ_HEAD, ['PRQ-T-1', 'طلب', 'adm', 'معتمد', 'ITM-RQ', 'بند 1', '2'], ['PRQ-T-1', '', '', '', '', 'بند 2', '3'], ['PRQ-T-2', 'آخر', 'adm', '', '', 'بند', '1']];
  const before = count('proc_requests'), r = await check('proc_requests', csv(rows));
  assert.equal(r.json.impact.create, 2, JSON.stringify(r.json));
  assert.match(r.json.warnings[0], /2 مستنداً صالحاً بمجموع 3 بنداً/);
  assert.equal(count('proc_requests'), before, 'الفحص لا يكتب');
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: r.json.stagingToken } });

  // ورقتان، ثم sql بجدولين
  const xlsx = writeXlsx([{ name: 'الرأس', rows: [['رقم الطلب', 'العنوان', 'مقدم الطلب', 'الحالة'], ['PRQ-T-1', 'طلب', 'adm', 'معتمد'], ['PRQ-T-2', 'آخر', 'adm', ''], ['PRQ-T-3', 'بلا بنود', 'adm', '']] }, { name: 'البنود', rows: [['رقم الطلب', 'رمز الصنف', 'وصف البند', 'الكمية'], ['PRQ-T-1', 'ITM-RQ', 'بند 1', '2'], ['PRQ-T-1', '', 'بند 2', '3'], ['PRQ-T-2', '', 'بند', '1']] }]);
  const xr = await check('proc_requests', xlsx.toString('base64'), adm, 'f.xlsx');
  assert.equal(xr.json.impact.create, 2);
  assert.match(xr.json.errors[0].message, /PRQ-T-3: لا توجد له بنود/);
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: xr.json.stagingToken } });
  const sql = "INSERT INTO proc_requests (no, title, requester) VALUES ('PRQ-T-1', 'طلب', 'adm');\nINSERT INTO proc_request_lines (no, line_description, qty) VALUES ('PRQ-T-1', 'بند 1', 2), ('PRQ-T-1', 'بند 2', 3);";
  const sr = await check('proc_requests', b64(sql), adm, 'f.sql');
  assert.equal(sr.json.impact.create, 1, JSON.stringify(sr.json));
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: sr.json.stagingToken } });

  // بند فاسد يرفض المستند كله، واختلاف الرأس يرفضه
  const badLine = await check('proc_requests', csv([REQ_HEAD, ['PRQ-T-4', 'طلب', 'adm', '', '', 'بند', '2'], ['PRQ-T-4', '', '', '', '', 'بند', 'كثير']]));
  assert.equal(badLine.json.valid, 0);
  assert.match(badLine.json.errors[0].message, /PRQ-T-4/);
  assert.match((await check('proc_requests', csv([REQ_HEAD, ['PRQ-T-5', 'طلب', 'adm', '', '', 'بند', '2'], ['PRQ-T-5', 'عنوان آخر', '', '', '', 'بند', '1']]))).json.errors[0].message, /يختلف/);

  const saved = await importHr('proc_requests', rows);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const req = app.db.prepare("SELECT * FROM proc_requests WHERE no = 'PRQ-T-1'").get();
  assert.equal(req.status, 'approved');
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM proc_request_lines WHERE request_id = ?').get(req.id).c), 2);
  assert.match((await check('proc_requests', csv(rows))).json.errors[0].message, /لا تُحدَّث/);
  assert.equal((await undo(saved.json.batchId)).status, 200);
  assert.equal(count('proc_requests'), before);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM proc_request_lines WHERE request_id = ?').get(req.id).c), 0);
});

test('أوامر الشراء: المرتبط بطلب يغيّر حالته، والتراجع يعيدها، ولا يُربط طلب غير معتمد أو مستخدم', async () => {
  docFixture('PO');
  const head = ['رقم الأمر', 'المورد', 'طلب الشراء', 'رمز الصنف', 'وصف البند', 'الكمية', 'سعر الوحدة'];
  const line = (no, rq) => [head, [no, 'SUP-PO', rq, 'ITM-PO', 'بند', '4', '250']];
  await importHr('proc_requests', [REQ_HEAD, ['PRQ-PO-1', 'طلب', 'adm', 'معتمد', '', 'بند', '4'], ['PRQ-PO-2', 'طلب', 'adm', 'مسودة', '', 'بند', '4']]);
  const status = (no) => app.db.prepare('SELECT status FROM proc_requests WHERE no = ?').get(no).status;
  assert.match((await check('proc_orders', csv(line('PO-X', 'PRQ-PO-2')))).json.errors[0].message, /ليس معتمداً/);
  const saved = await importHr('proc_orders', line('PO-T-1', 'PRQ-PO-1'));
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const po = app.db.prepare("SELECT * FROM proc_orders WHERE no = 'PO-T-1'").get();
  assert.equal(Number(po.total_amount), 1000, 'المجموع من البنود');
  assert.equal(status('PRQ-PO-1'), 'ordered');
  assert.match((await check('proc_orders', csv(line('PO-T-2', 'PRQ-PO-1')))).json.errors[0].message, /ليس معتمداً/);
  assert.equal((await undo(saved.json.batchId)).status, 200);
  assert.equal(status('PRQ-PO-1'), 'approved');
  assert.ok(!app.db.prepare("SELECT 1 AS x FROM proc_orders WHERE no = 'PO-T-1'").get());
});

test('الاستلام: يزيد الرصيد ويرحّل قيداً، والتراجع يعيد الأرصدة حرفياً ويعكس القيد ويبقي السند معكوساً', async () => {
  ready(app.db);
  docFixture('GR', 10, 100);
  await addOrder('PO-GR-1', 'GR', 5, 200);
  const itemBefore = itemRow('ITM-GR'), orderBefore = app.db.prepare("SELECT * FROM proc_orders WHERE no = 'PO-GR-1'").get();
  const row = (no, q) => [no, 'PO-GR-1', '2026-10-01', 'ITM-GR', q];
  assert.match((await check('proc_receipts', csv([GRN_HEAD, row('GRN-X', '9')]))).json.errors[0].message, /تتجاوز المتبقي/);
  const inFile = await check('proc_receipts', csv([GRN_HEAD, row('GRN-A', '3'), row('GRN-B', '3')]));
  assert.equal(inFile.json.valid, 1, 'المتبقي يُحسب داخل الملف');
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: inFile.json.stagingToken } });
  const r = await check('proc_receipts', csv([GRN_HEAD, row('GRN-T-1', '5')]));
  assert.equal(r.json.risk, 'high');
  assert.equal(Number(itemRow('ITM-GR').qty_on_hand), 10, 'الفحص لا يكتب');
  const saved = await commit('proc_receipts', r.json.stagingToken, adm, { confirm: r.json.confirmWord });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const item = itemRow('ITM-GR');
  assert.deepEqual([Number(item.qty_on_hand), Number(item.avg_cost)], [15, 133], 'متوسط التكلفة بمعادلة الشاشة');
  const grn = app.db.prepare("SELECT * FROM proc_receipts WHERE import_ref = 'GRN-T-1'").get();
  assert.equal(new Date(Number(grn.received_at)).toISOString().slice(0, 10), '2026-10-01');
  assert.equal(app.db.prepare("SELECT status FROM proc_orders WHERE no = 'PO-GR-1'").get().status, 'received');
  const je = app.db.prepare('SELECT * FROM fin_entries WHERE source = ?').get(`proc_receipt:${grn.id}`);
  assert.equal(je.status, 'posted');
  assert.match((await check('proc_receipts', csv([GRN_HEAD, row('GRN-T-1', '1')]))).json.errors[0].message, /استُورد من قبل/);

  const u = await undo(saved.json.batchId);
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.deepEqual(itemRow('ITM-GR'), itemBefore, 'الصنف يعود حرفياً');
  assert.deepEqual(app.db.prepare("SELECT * FROM proc_orders WHERE no = 'PO-GR-1'").get(), orderBefore, 'والأمر كذلك');
  assert.ok(app.db.prepare('SELECT reversed_at FROM proc_receipts WHERE id = ?').get(grn.id).reversed_at, 'السند باقٍ معكوساً');
  assert.ok(app.db.prepare('SELECT reversed_by FROM fin_entries WHERE id = ?').get(je.id).reversed_by, 'والقيد معكوس لا محذوف');
  const again = await check('proc_receipts', csv([GRN_HEAD, row('GRN-T-2', '5')]));
  assert.equal(again.json.valid, 1, 'السند المعكوس لا يُحتسب من المستلم');

  // صنف تغيّر بعد الاستيراد يمنع التراجع ولا يغيّر شيئاً
  const s2 = await commit('proc_receipts', again.json.stagingToken, adm, { confirm: again.json.confirmWord });
  app.db.prepare("UPDATE proc_items SET qty_on_hand = qty_on_hand - 1 WHERE code = 'ITM-GR'").run();
  const blocked = await undo(s2.json.batchId);
  assert.equal(blocked.status, 409);
  assert.equal(app.db.prepare('SELECT status FROM import_batches WHERE id = ?').get(s2.json.batchId).status, 'undo_blocked');
  assert.ok(!app.db.prepare("SELECT reversed_at FROM proc_receipts WHERE import_ref = 'GRN-T-2'").get().reversed_at);
});

test('الصرف: ينقص الرصيد ويُرفض ما يتجاوزه داخل الملف، والتراجع يعيده ويبقي السند', async () => {
  docFixture('IS', 5, 100);
  const head = ['رقم السند', 'المستودع', 'الجهة المستلمة', 'تاريخ الصرف', 'رمز الصنف', 'الكمية'];
  const row = (no, q) => [no, 'WH-IS', 'جهة', '2026-10-02', 'ITM-IS', q];
  const before = itemRow('ITM-IS');
  const mix = await check('proc_issues', csv([head, row('IS-A', '4'), row('IS-B', '4')]));
  assert.equal(mix.json.valid, 1);
  assert.match(mix.json.errors[0].message, /لا يكفي/);
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: mix.json.stagingToken } });
  const saved = await importHr('proc_issues', [head, row('IS-T-1', '2'), ['IS-T-2', 'WH-IS', 'جهة أخرى', '2026-10-03', 'ITM-IS', '3']]);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(Number(itemRow('ITM-IS').qty_on_hand), 0);
  assert.equal(new Date(Number(app.db.prepare("SELECT issued_at FROM proc_issues WHERE no = 'IS-T-1'").get().issued_at)).toISOString().slice(0, 10), '2026-10-02', 'رقم الملف وتاريخه');
  assert.equal((await undo(saved.json.batchId)).status, 200);
  assert.deepEqual(itemRow('ITM-IS'), before);
  assert.ok(app.db.prepare("SELECT reversed_at FROM proc_issues WHERE no = 'IS-T-1'").get().reversed_at);
});

test('حركات الأصول: تتسلسل بترتيب الملف، والتراجع يعيد الأصل ويسجل حركة معاكسة', async () => {
  docFixture('AS');
  const now = Date.now(), wh = app.db.prepare("SELECT id FROM proc_warehouses WHERE code = 'WH-AS'").get().id;
  app.db.prepare("INSERT INTO proc_warehouses (code, name, created_at) VALUES ('WH-AS2', 'ثان', ?)").run(now);
  const assetId = Number(app.db.prepare("INSERT INTO proc_assets (code, name, warehouse_id, created_at) VALUES ('AST-T', 'أصل', ?, ?)").run(wh, now).lastInsertRowid);
  const asset = () => app.db.prepare('SELECT * FROM proc_assets WHERE id = ?').get(assetId), before = asset();
  const head = ['رمز الأصل', 'نوع الحركة', 'المستودع الهدف', 'إلى المستخدم', 'تاريخ الحركة'];
  assert.match((await check('proc_asset_moves', csv([head, ['AST-T', 'نقل', '', '', '2026-10-01']]))).json.errors[0].message, /المستودع الهدف/);
  const saved = await importHr('proc_asset_moves', [head, ['AST-T', 'نقل', 'WH-AS2', 'سامر', '2026-10-01'], ['AST-T', 'صيانة', '', '', '2026-10-02']]);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual([asset().status, asset().assigned_to], ['maintenance', 'سامر']);
  assert.notEqual(asset().warehouse_id, wh);
  assert.equal((await undo(saved.json.batchId)).status, 200);
  assert.deepEqual(asset(), before);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM proc_asset_moves WHERE asset_id = ?').get(assetId).c), 4, 'حركتان ومعاكستاهما');
});

test('القيود: المدين يساوي الدائن، والمسودة تُحذف عند التراجع، والمرحَّل يُعكس، ولا عكس في سنة مقفلة', async () => {
  ready(app.db);
  const day = new Date().toISOString().slice(0, 10), [a, b] = app.db.prepare('SELECT code FROM fin_accounts WHERE postable = 1 AND active = 1 AND require_cc = 0 ORDER BY code LIMIT 2').all().map((r) => r.code);
  const group = app.db.prepare('SELECT code FROM fin_accounts WHERE postable = 0 ORDER BY code LIMIT 1').get().code;
  const head = ['رقم القيد', 'التاريخ', 'البيان', 'ترحيل', 'رمز الحساب', 'مدين', 'دائن'];
  const pair = (no, post, x = '100', y = '100', acc = a) => [[no, day, 'قيد', post, acc, x, ''], [no, '', '', '', b, '', y]];
  assert.match((await check('fin_entries', csv([head, ...pair('JE-X', 'لا', '100', '90')]))).json.errors[0].message, /غير متوازن/);
  assert.match((await check('fin_entries', csv([head, ...pair('JE-X', 'لا', '100', '100', group)]))).json.errors[0].message, /تجميعي/);
  assert.match((await check('fin_entries', csv([head, [ 'JE-X', day, 'قيد', 'لا', a, '100', '' ]]))).json.errors[0].message, /سطرين/);
  assert.match((await check('fin_entries', csv([head, ['JE-X', '1990-01-01', 'قيد', 'لا', a, '100', ''], ['JE-X', '', '', '', b, '', '100']]))).json.errors[0].message, /سنة مالية/);

  const entries = () => Number(app.db.prepare('SELECT COUNT(*) c FROM fin_entries').get().c), n = entries();
  const draft = await importHr('fin_entries', [head, ...pair('JE-T-1', 'لا')]);
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  assert.equal(app.db.prepare("SELECT status FROM fin_entries WHERE reference = 'JE-T-1'").get().status, 'draft');
  assert.match((await check('fin_entries', csv([head, ...pair('JE-T-1', 'لا')]))).json.errors[0].message, /استُورد من قبل/);
  assert.equal((await undo(draft.json.batchId)).status, 200);
  assert.equal(entries(), n, 'المسودة لا أثر لها');

  const posted = await importHr('fin_entries', [head, ...pair('JE-T-2', 'نعم')]);
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  const e = app.db.prepare("SELECT * FROM fin_entries WHERE reference = 'JE-T-2'").get();
  assert.equal(e.status, 'posted');
  const y = e.year_id;
  app.db.prepare("UPDATE fin_years SET status = 'closed' WHERE id = ?").run(y);
  const closed = await undo(posted.json.batchId);
  app.db.prepare("UPDATE fin_years SET status = 'open' WHERE id = ?").run(y);
  assert.equal(closed.status, 409);
  assert.match(closed.json.message, /مقفلة/);
  assert.ok(!app.db.prepare('SELECT reversed_by FROM fin_entries WHERE id = ?').get(e.id).reversed_by);
  const u = await undo(posted.json.batchId);
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.ok(app.db.prepare('SELECT reversed_by FROM fin_entries WHERE id = ?').get(e.id).reversed_by, 'قيد عكسي');
  assert.equal(entries(), n + 2);
  assert.equal((await check('fin_entries', csv([head, ...pair('JE-T-2', 'لا')]))).json.errorCount, 0, 'المعكوس يُستورد من جديد');
});

test('قوالب المستندات: ورقة للرأس وأخرى للبنود وتعود سليمة', async () => {
  ready(app.db);
  const t = await call('GET', '/api/import-engine/fin_entries/template', { cookie: adm });
  const wb = readXlsx(t.buf), names = wb.sheets.map((s) => s.name);
  assert.ok(names.includes('الرأس') && names.includes('البنود') && names.includes('تعليمات'), names.join());
  assert.equal(wb.sheets.find((s) => s.name === 'البنود').rows.length, 3, 'بندان متوازنان');
  const back = await check('fin_entries', t.buf.toString('base64'), adm, 'f.xlsx');
  assert.deepEqual(back.json.errors, []);
  assert.equal(back.json.impact.create, 1);
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: back.json.stagingToken } });
  const c = await call('GET', '/api/import-engine/fin_entries/template?format=csv', { cookie: adm });
  const fromCsv = await check('fin_entries', c.buf.toString('base64'));
  assert.deepEqual(fromCsv.json.errors, []);
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: fromCsv.json.stagingToken } });
});

/* ---------- الطلاب والمالية ---------- */
const makeStudent = async (no, nid, opts = {}) => {
  const hash = await hashPassword(PW, 1024), now = Date.now();
  const id = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES (?,?,?,'student',?,?)").run(no, opts.name || `طالب ${no}`, hash, no, now).lastInsertRowid);
  const prog = app.db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?, 'طارق', 'محمود', 'العلي', 'سعاد', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'محمود العلي', 'أب', '0944111222', ?, ?)`).run(id, nid, prog, now, now);
  return id;
};
const ledger = (id) => app.db.prepare('SELECT status, entry_id FROM fin_charges WHERE id = ?').get(id);
const undo = (batchId) => call('POST', `/api/import-engine/batches/${batchId}/undo`, { cookie: adm, body: {} });
const yearNow = () => new Date().toISOString().slice(0, 10);

test('المستحقات والإيصالات: قيد مرحَّل متوازن، والتراجع بقيد عكسي لا بالحذف، ويعود الكشف كما كان', async () => {
  const sid = await makeStudent('FIN-1', '90000000001');
  const fee = app.db.prepare("SELECT code FROM fin_fee_types WHERE kind = 'fee' AND active = 1 ORDER BY id LIMIT 1").get().code;
  const head = ['الرقم الجامعي', 'نوع الرسم', 'المبلغ', 'تاريخ الاستحقاق'];

  const r = await check('fin_charges', csv([head, ['FIN-1', fee, '1500', yearNow()]]));
  assert.equal(r.json.risk, 'high');
  assert.match(r.json.impactNote, /قيداً محاسبياً/);
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM fin_charges WHERE student_id = ?').get(sid).c), 0, 'الفحص لا يكتب');
  const saved = await commit('fin_charges', r.json.stagingToken, adm, { confirm: r.json.confirmWord });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const charge = app.db.prepare('SELECT * FROM fin_charges WHERE student_id = ?').get(sid);
  assert.ok(charge.entry_id, 'له قيد');
  const lines = app.db.prepare('SELECT debit, credit FROM fin_lines WHERE entry_id = ?').all(charge.entry_id);
  assert.equal(lines.reduce((s, l) => s + Number(l.debit), 0), lines.reduce((s, l) => s + Number(l.credit), 0), 'متوازن');
  assert.equal(app.db.prepare('SELECT status FROM fin_entries WHERE id = ?').get(charge.entry_id).status, 'posted');

  const again = await check('fin_charges', csv([head, ['FIN-1', fee, '1500', yearNow()]]));
  assert.match(again.json.errors[0].message, /استحقاق مفتوح مطابق/, 'لا يُرحَّل مرتين');

  const u = await undo(saved.json.batchId);
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal(ledger(charge.id).status, 'void', 'لا يُحذف');
  const entry = app.db.prepare('SELECT reversed_by FROM fin_entries WHERE id = ?').get(charge.entry_id);
  assert.ok(entry.reversed_by, 'قيد عكسي');
  assert.equal(app.db.prepare('SELECT reversal_of FROM fin_entries WHERE id = ?').get(entry.reversed_by).reversal_of, Number(charge.entry_id));
  const redo = await check('fin_charges', csv([head, ['FIN-1', fee, '1500', yearNow()]]));
  assert.equal(redo.json.impact.create, 1, 'يمكن استيراده من جديد بعد الإلغاء');
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: redo.json.stagingToken } });

  const payHead = ['رقم الإيصال', 'الرقم الجامعي', 'المبلغ', 'الطريقة', 'تاريخ الدفع'];
  const p = await importHr('fin_payments', [payHead, ['RCP-OLD-77', 'FIN-1', '500', 'نقداً', yearNow()]]);
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const pay = app.db.prepare("SELECT * FROM fin_payments WHERE receipt_no = 'RCP-OLD-77'").get();
  assert.ok(pay.entry_id, 'يحتفظ برقم الإيصال وله قيد');
  assert.match((await check('fin_payments', csv([payHead, ['RCP-OLD-77', 'FIN-1', '500', 'نقداً', yearNow()]]))).json.errors[0].message, /موجود مسبقاً/);
  assert.equal((await undo(p.json.batchId)).status, 200);
  assert.equal(app.db.prepare("SELECT status FROM fin_payments WHERE receipt_no = 'RCP-OLD-77'").get().status, 'void');
});

test('السنة المقفلة: يُرفض الصف، ولا يُعكس القيد، ويبقى كل شيء كما هو', async () => {
  await makeStudent('FIN-2', '90000000002');
  const fee = app.db.prepare("SELECT code FROM fin_fee_types WHERE kind = 'fee' AND active = 1 ORDER BY id LIMIT 1").get().code;
  const head = ['الرقم الجامعي', 'نوع الرسم', 'المبلغ', 'تاريخ الاستحقاق'];
  assert.match((await check('fin_charges', csv([head, ['FIN-2', fee, '100', '1990-01-01']]))).json.errors[0].message, /سنة مالية/);
  const c = await importHr('fin_charges', [head, ['FIN-2', fee, '100', yearNow()]]);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const row = app.db.prepare('SELECT * FROM fin_charges WHERE note = ? AND amount > 0 ORDER BY id DESC LIMIT 1').get('');
  const year = app.db.prepare('SELECT y.id FROM fin_entries e JOIN fin_years y ON y.id = e.year_id WHERE e.id = ?').get(row.entry_id).id;
  app.db.prepare("UPDATE fin_years SET status = 'closed' WHERE id = ?").run(year);
  const blocked = await undo(c.json.batchId);
  app.db.prepare("UPDATE fin_years SET status = 'open' WHERE id = ?").run(year);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.message, /مقفلة/);
  assert.equal(ledger(row.id).status, 'open', 'لم يتغير شيء');
  assert.equal(app.db.prepare('SELECT status FROM import_batches WHERE id = ?').get(c.json.batchId).status, 'undo_blocked');
});

test('المنح وحركات القيد والمعادلة: الأثر يقع، والتراجع يعيده', async () => {
  const sid = await makeStudent('STD-1', '90000000003');
  if (!app.db.prepare("SELECT 1 AS x FROM fin_fee_types WHERE kind = 'discount' AND active = 1").get()) app.db.prepare("INSERT INTO fin_fee_types (code, name, kind, account_id) SELECT 'T-DISC', 'خصم', 'discount', id FROM fin_accounts WHERE postable = 1 ORDER BY id LIMIT 1").run();

  const sch = await importHr('sa_scholarships', [['رقم المنحة', 'الرقم الجامعي', 'نوع المنحة', 'نسبة الحسم', 'قيمة المنحة'], ['SCH-T-1', 'STD-1', 'تفوق', '50', '750']]);
  assert.equal(sch.status, 200, JSON.stringify(sch.json));
  const grant = app.db.prepare("SELECT * FROM sa_scholarships WHERE grant_no = 'SCH-T-1'").get();
  assert.ok(grant.fin_charge_id, 'مرتبطة بخصم مالي');
  assert.equal((await undo(sch.json.batchId)).status, 200);
  assert.ok(!app.db.prepare("SELECT 1 AS x FROM sa_scholarships WHERE grant_no = 'SCH-T-1'").get());
  assert.equal(ledger(grant.fin_charge_id).status, 'void', 'والخصم عُكس');

  const movHead = ['رقم الحركة', 'الرقم الجامعي', 'نوع الحركة', 'العام الدراسي', 'السبب'];
  const status = () => app.db.prepare('SELECT status FROM student_profiles WHERE user_id = ?').get(sid).status;
  const mov = await importHr('sa_lifecycle_movements', [movHead, ['MOV-T-1', 'STD-1', 'تأجيل', '2026', 'ظروف'], ['MOV-T-2', 'STD-1', 'إعادة قيد', '2026', 'عودة'], ['MOV-T-3', 'STD-1', 'انسحاب', '2026', 'رغبة']]);
  assert.equal(mov.status, 200, JSON.stringify(mov.json));
  assert.equal(status(), 'withdrawn');
  const rows = app.db.prepare("SELECT from_status, to_status FROM sa_lifecycle_movements WHERE movement_no LIKE 'MOV-T-%' ORDER BY movement_no").all();
  assert.deepEqual(rows.map((x) => [x.from_status, x.to_status]), [['active', 'suspended'], ['suspended', 'active'], ['active', 'withdrawn']], 'تتسلسل بترتيب الملف');
  assert.match((await check('sa_lifecycle_movements', csv([movHead, ['MOV-T-1', 'STD-1', 'تأجيل', '2026', 'ظروف']]))).json.errors[0].message, /لا تُعدَّل/);
  assert.match((await check('sa_lifecycle_movements', csv([movHead, ['MOV-T-9', 'STD-1', 'نقل برنامج', '2026', 'نقل']]))).json.errors[0].message, /البرنامج الجديد/);
  assert.equal((await undo(mov.json.batchId)).status, 200);
  assert.equal(status(), 'active', 'يعود كما كان');

  const eqHead = ['الرقم الجامعي', 'الجامعة المصدر', 'رمز المقرر الخارجي', 'اسم المقرر الخارجي', 'العلامة', 'رمز المقرر المقابل'];
  const grades = () => Number(app.db.prepare('SELECT COUNT(*) c FROM grades WHERE student_id = ?').get(sid).c);
  const eq = await importHr('sa_credit_equivalences', [eqHead, ['STD-1', 'جامعة أ', 'EXT-1', 'مقرر', '75.4', 'COURSE-A']]);
  assert.equal(eq.status, 200, JSON.stringify(eq.json));
  assert.equal(grades(), 1, 'ترصد العلامة');
  assert.equal(Number(app.db.prepare('SELECT mark FROM grades WHERE student_id = ?').get(sid).mark), 75);
  assert.equal((await undo(eq.json.batchId)).status, 200);
  assert.equal(grades(), 0, 'والتراجع يحذفها');
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM sa_credit_equivalences WHERE student_id = ?').get(sid).c), 0);

  assert.match((await check('student_holds', csv([['الرقم الجامعي', 'نوع الذمة'], ['NOPE-9', 'مالية']]))).json.errors[0].message, /لا يوجد سجل/);
  const adm1 = await check('sa_applicants', csv([['رقم الطلب', 'الاسم الكامل', 'الرقم الوطني', 'مجموع الثانوية', 'الرغبة الأولى'], ['APP-1', 'متقدم', '12345678901', '999', 'لا يوجد']]));
  assert.ok(!JSON.stringify(adm1.json).includes('12345678901'), 'الرقم الوطني لا يعود في الرد');
});

test('السكن والمكتبة والتوظيف: العدادات تتبع الاستيراد ويُرفض ما يتجاوز المتاح', async () => {
  await makeStudent('DRM-1', '90000000004'); await makeStudent('DRM-2', '90000000005');
  const dept = app.db.prepare("SELECT name FROM org_units WHERE kind = 'department' AND active = 1 ORDER BY id LIMIT 1").get().name;
  await importHr('dorm_rooms', [['المبنى', 'رقم الغرفة', 'السعة'], ['مبنى ت', '1', '1']]);
  const room = () => app.db.prepare("SELECT occupied FROM dorm_rooms WHERE building_name = 'مبنى ت'").get();
  assert.equal(Number(room().occupied), 0, 'الغرفة الجديدة فارغة');
  const head = ['المبنى', 'رقم الغرفة', 'الرقم الجامعي', 'الجهة', 'تاريخ السكن'];
  const full = await check('dorm_allocations', csv([head, ['مبنى ت', '1', 'DRM-1', dept, '2026-09-01'], ['مبنى ت', '1', 'DRM-2', dept, '2026-09-01']]));
  assert.equal(full.json.valid, 1);
  assert.match(full.json.errors[0].message, /ممتلئة/, 'السعة تُحسب داخل الملف');
  const b = await commit('dorm_allocations', full.json.stagingToken, adm, { acceptPartial: true });
  assert.equal(Number(room().occupied), 1);
  assert.equal(app.db.prepare("SELECT student_name FROM dorm_allocations WHERE student_no = 'DRM-1'").get().student_name, 'طالب DRM-1', 'الاسم من الحساب');
  assert.match((await check('dorm_allocations', csv([head, ['مبنى ن', '9', 'DRM-1', dept, '2026-09-01']]))).json.errors[0].message, /مسكَّن/);
  assert.equal((await undo(b.json.batchId)).status, 200);
  assert.equal(Number(room().occupied), 0, 'التراجع يعيد العدد');

  await importHr('library_books', [['ISBN', 'العنوان', 'المؤلف', 'التصنيف', 'إجمالي النسخ'], ['ISBN-T', 'كتاب', 'مؤلف', 'عام', '1']]);
  const copies = () => Number(app.db.prepare("SELECT copies_available FROM library_books WHERE isbn = 'ISBN-T'").get().copies_available);
  assert.equal(copies(), 1);
  const lHead = ['ISBN', 'اسم المستعير', 'رقم المستعير', 'تاريخ الإعارة', 'تاريخ الإرجاع المتوقع'];
  const loan = await importHr('library_loans', [lHead, ['ISBN-T', 'أ', 'L-1', '2026-10-01', '2026-10-15']]);
  assert.equal(copies(), 0);
  assert.match((await check('library_loans', csv([lHead, ['ISBN-T', 'ب', 'L-2', '2026-10-02', '2026-10-15']]))).json.errors[0].message, /لا توجد نسخ/);
  assert.match((await check('library_books', csv([['ISBN', 'العنوان', 'المؤلف', 'التصنيف', 'إجمالي النسخ'], ['ISBN-T', 'كتاب', 'مؤلف', 'عام', '0']]))).json.errors[0].message, /المعارة/);
  assert.equal((await undo(loan.json.batchId)).status, 200);
  assert.equal(copies(), 1);

  await importHr('career_jobs', [['المسمى الوظيفي', 'الشركة', 'القطاع', 'الموقع'], ['وظيفة ت', 'شركة', 'قطاع', 'دمشق']]);
  const count2 = () => Number(app.db.prepare("SELECT applicants_count FROM career_jobs WHERE title = 'وظيفة ت'").get().applicants_count);
  const ap = await importHr('career_applications', [['المسمى الوظيفي', 'اسم المتقدم', 'الرقم الجامعي'], ['وظيفة ت', 'أ', 'A-1']]);
  assert.equal(count2(), 1);
  assert.equal((await undo(ap.json.batchId)).status, 200);
  assert.equal(count2(), 0);
});

test('الأقساط والأسئلة والروابط: الحالة تُحسب، والمدخلات الخطرة تُرفض', async () => {
  await makeStudent('INS-1', '90000000006', { name: 'طالب الأقساط' });
  const dept = app.db.prepare("SELECT name FROM org_units WHERE kind = 'department' AND active = 1 ORDER BY id LIMIT 1").get().name;
  const head = ['رمز القسط', 'الرقم الجامعي', 'الجهة', 'رقم القسط', 'قيمة القسط', 'تاريخ الاستحقاق', 'المبلغ المسدد'];
  await importHr('student_fee_installments', [head, ['I-1', 'INS-1', dept, '1', '100', '2026-12-01', '40'], ['I-2', 'INS-1', dept, '2', '100', '2026-12-01', '100']]);
  const st = (code) => app.db.prepare('SELECT status, student_name, paid_at FROM student_fee_installments WHERE installment_code = ?').get(code);
  assert.equal(st('I-1').status, 'مسدد جزئياً');
  assert.equal(st('I-1').student_name, 'طالب الأقساط');
  assert.equal(st('I-2').status, 'مسدد بالكامل');
  assert.match((await check('student_fee_installments', csv([head, ['I-2', 'INS-1', dept, '2', '50', '2026-12-01', '']]))).json.errors[0].message, /مسدد/);
  assert.match((await check('student_fee_installments', csv([head, ['I-3', 'INS-1', dept, '3', '50', '2026-12-01', '90']]))).json.errors[0].message, /أكبر من/);

  const qHead = ['رمز المقرر', 'اسم المقرر', 'العنوان', 'الأسئلة'];
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const qCsv = (q) => b64(`${qHead.join(',')}\nC-1,مقرر,اختبار,${quote(q)}`);
  assert.match((await check('lms_quizzes', qCsv('ليس json'))).json.errors[0].message, /JSON/);
  assert.match((await check('lms_quizzes', qCsv('[{"q":"س","options":["أ"],"ans":0}]'))).json.errors[0].message, /السؤال 1/);
  assert.match((await check('lms_quizzes', qCsv('[{"q":"س","options":["أ","ب"],"ans":5}]'))).json.errors[0].message, /السؤال 1/);
  const quiz = await check('lms_quizzes', qCsv('[{"q":"س","options":["أ","ب"],"ans":1}]'));
  assert.equal(quiz.json.valid, 1);
  await commit('lms_quizzes', quiz.json.stagingToken);
  const saved = (await call('GET', '/api/lms/overview', { cookie: adm })).json.quizzes.find((q) => q.title === 'اختبار');
  assert.equal(saved.questions[0].ans, 1, 'تعمل في الشاشة');

  const lec = ['رمز المقرر', 'اسم المقرر', 'العنوان', 'المدرّس', 'الرابط'];
  assert.match((await check('lms_lectures', csv([lec, ['C-1', 'مقرر', 'م', 'د', 'javascript:alert(1)']]))).json.errors[0].message, /رابط/);
  assert.equal((await check('lms_lectures', csv([lec, ['C-1', 'مقرر', 'م', 'د', 'https://example.com/a.pdf']]))).json.errorCount, 0);

  const kpi = ['الرمز', 'المؤشر', 'المجال', 'المستهدف', 'الفعلي'];
  await importHr('qa_kpis', [kpi, ['K-1', 'م', 'مج', '100', '100'], ['K-2', 'م', 'مج', '100', '90'], ['K-3', 'م', 'مج', '100', '10']]);
  const k = (code) => app.db.prepare('SELECT status FROM qa_kpis WHERE code = ?').get(code).status;
  assert.deepEqual([k('K-1'), k('K-2'), k('K-3')], ['متحقق', 'قيد التحسين', 'حرِج']);
});

test('صلاحية مالية الطلاب منفصلة، وصلاحية الوحدة وحدها لا تكفي للخطر', async () => {
  const hash = await hashPassword(PW, 1024);
  app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, custom_permissions_json, created_at) VALUES ('sfbasic', 'sf', ?, 'staff', ?, ?)").run(hash, JSON.stringify(['import:student_fin']), Date.now());
  const c = (await call('POST', '/api/auth/login', { body: { username: 'sfbasic', password: PW } })).cookie;
  const kinds = (await call('GET', '/api/import-engine/catalog', { cookie: c })).json.kinds.map((k) => k.kind);
  assert.ok(kinds.includes('scholarships'));
  assert.ok(!kinds.includes('fin_charges') && !kinds.includes('sa_lifecycle_movements'));
  assert.equal((await check('fin_payments', csv([['رقم الإيصال'], ['x']]), c)).status, 403);
});

test('الصور السابقة تُحذف بعد مدة الاحتفاظ لأنها تحوي بيانات شخصية', async () => {
  const b = await importHr('proc_categories', [['الرمز', 'الاسم'], ['CAT-OLD', 'قديم']]);
  assert.ok(Number(app.db.prepare('SELECT COUNT(*) c FROM import_changes WHERE batch_id = ?').get(b.json.batchId).c) > 0);
  app.db.prepare('UPDATE import_batches SET committed_at = ? WHERE id = ?').run(Date.now() - 91 * 86400000, b.json.batchId);
  const r = await check('proc_categories', csv([['الرمز', 'الاسم'], ['CAT-OLD2', 'قديم']]));
  await call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: r.json.stagingToken } });
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) c FROM import_changes WHERE batch_id = ?').get(b.json.batchId).c), 0);
});

test('الدورات المغلقة في المتطلبات السابقة تُرفض', async () => {
  const head = ['رمز المقرر', 'رمز المتطلب السابق'];
  const first = await check('course_prerequisites', csv([head, ['COURSE-B', 'COURSE-A']]));
  await commit('course_prerequisites', first.json.stagingToken);
  const r = await check('course_prerequisites', csv([head, ['COURSE-A', 'COURSE-B']]));
  assert.match(r.json.errors[0].message, /دورة/);
});

test('الأداء: 5000 صف', async () => {
  const rows = [SUP[0]]; for (let i = 0; i < 5000; i++) rows.push([`PERF-${i}`, `مورد ${i}`, '']);
  const t0 = Date.now(); const r = await check('proc_suppliers', csv(rows)); const t1 = Date.now();
  assert.equal(r.json.valid, 5000);
  const c = await commit('proc_suppliers', r.json.stagingToken); const t2 = Date.now();
  assert.equal(c.json.created, 5000);
  const u = await call('POST', `/api/import-engine/batches/${c.json.batchId}/undo`, { cookie: adm, body: {} }); const t3 = Date.now();
  assert.equal(u.json.reverted, 5000);
  console.log(`# أداء 5000 صف: فحص ${t1 - t0}ms، حفظ ${t2 - t1}ms، تراجع ${t3 - t2}ms`);
  assert.ok(t2 - t1 < 120000);
});
