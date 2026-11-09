// اختبارات وحدة المالية والمحاسبة
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { ensureStructure } from '../server/services/structure.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
const PW_HASH = await hashPassword(PW, 1024);

let testApp = null;
let base = null;
let adminCookie = null;
let finCookie = null;

async function loginAs(username, _app) {
  const url = base || ('http://127.0.0.1:' + _app.server.address().port);
  const r = await fetch(url + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW })
  });
  if (r.status !== 200) return null;
  const sc = r.headers.get('set-cookie');
  return sc ? sc.split(';')[0] : null;
}

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-fin-'));
  const app = await createApp({ dbPath: path.join(dir, 'test.db'), jwtSecret: 'test-secret-fin' });
  await new Promise((res) => app.server.listen(0, '127.0.0.1', res));
  const db = app.db;
  await ensureStructure({ db, cfg: app.cfg });
  const now = Date.now();
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)").run('admin', 'مدير', PW_HASH, 'admin', now);
  // مستخدم بصلاحيات مالية
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)").run('finstaff', 'موظف مالي', PW_HASH, 'staff', now);
  const uid = db.prepare("SELECT id FROM users WHERE username='finstaff'").get().id;
  // إنشاء دور مالي
  db.prepare("INSERT INTO roles (key, label, permissions_json, active, created_at) VALUES ('finance_role','مالي','[\"finance:read\",\"finance:entry\",\"finance:post\",\"finance:setup\",\"finance:fees\"]',1,?)").run(now);
  db.prepare("UPDATE users SET role_key='finance_role' WHERE id=?").run(uid);
  return app;
}

test.beforeEach(async () => {
  testApp = await createTestApp();
  base = 'http://127.0.0.1:' + testApp.server.address().port;
  adminCookie = await loginAs('admin', testApp);
  finCookie = await loginAs('finstaff', testApp);
});

test.afterEach(async () => {
  if (testApp) { await testApp.close(); testApp = null; }
});

async function req(method, path, body, cookie) {
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

// ── الفواتير: لا مبلغ ولا جهة افتراضيين ──────────────────────────────────────
test('POST /api/finance/invoices rejects missing party or lines and posts nothing', async () => {
  const party = (await req('POST', '/api/finance/parties', { name: 'جهة فوترة', kind: 'customer' }, adminCookie)).body;
  const partyId = party.party?.id ?? party.id;
  assert.ok(partyId, 'يجب إنشاء الطرف');
  const line = { description: 'خدمة', qty: 2, unitPrice: 300 };
  const countInv = () => testApp.db.prepare("SELECT COUNT(*) AS c FROM fin_entries WHERE reference LIKE 'INV-%'").get().c;
  const before = Number(countInv());
  for (const bad of [
    { partyId, lines: [] },
    { partyId },
    { lines: [line] },
    { partyId: 999999, lines: [line] },
    { partyId, lines: [{ ...line, unitPrice: 0 }] },
    { partyId, lines: [{ ...line, qty: 0 }] },
    { partyId, lines: [{ ...line, unitPrice: 'abc' }] },
  ]) {
    assert.equal((await req('POST', '/api/finance/invoices', bad, adminCookie)).status, 400, JSON.stringify(bad));
  }
  assert.equal(Number(countInv()), before, 'الفاتورة المرفوضة لا تُرحَّل');

  const ok = await req('POST', '/api/finance/invoices', { partyId, lines: [line] }, adminCookie);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.invoice.total, 600);
  assert.equal(Number(countInv()), before + 1);
});

// ── الفواتير: النوع والحالة والدفع والإلغاء ─────────────────────────────────
test('invoices post by kind, track payments from the ledger, and cancel by reversal', async () => {
  const partyId = (await req('POST', '/api/finance/parties', { name: 'مورد تجربة', kind: 'supplier' }, adminCookie)).body;
  const pid = partyId.party?.id ?? partyId.id;
  const db = testApp.db;
  const code = (entryId, side) => db.prepare(`SELECT a.system_key AS k FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND l.${side} > 0`).get(entryId).k;
  const list = async () => (await req('GET', '/api/finance/invoices', null, adminCookie)).body.invoices;
  const make = async (body) => (await req('POST', '/api/finance/invoices', { partyId: pid, lines: [{ description: 'بند', qty: 1, unitPrice: 1000 }], ...body }, adminCookie));

  // المشتريات مصروف وذمم موردين، والمبيعات ذمم مدينة وإيراد
  const buy = (await make({ kind: 'purchase' })).body.invoice;
  assert.equal(buy.status, 'issued');
  assert.equal(buy.paidAmount, 0);
  assert.equal(code(buy.entryId, 'debit'), 'general_exp');
  assert.equal(code(buy.entryId, 'credit'), 'suppliers');
  const sell = (await make({ kind: 'sale' })).body.invoice;
  assert.equal(code(sell.entryId, 'debit'), 'debtors');
  assert.equal(db.prepare('SELECT a.code FROM fin_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND l.credit > 0').get(sell.entryId).code, '4203', 'مبيعات الخارج إيرادات متنوعة، لا رسوم طلاب');

  // الحساب يجب أن يوافق النوع
  const rev = db.prepare("SELECT id FROM fin_accounts WHERE system_key = 'rev_services'").get().id;
  assert.equal((await make({ kind: 'purchase', counterAccountId: rev })).status, 400);
  assert.equal((await make({ kind: 'oops' })).status, 400);

  // دفع جزئي، ورفض تجاوز المتبقي، ثم تسديد كامل
  const pay = (id, amount) => req('POST', `/api/finance/invoices/${id}/pay`, { amount }, adminCookie);
  // قبض فاتورة مبيعات أولًا: الصرف مقيد برصيد الصندوق
  const funding = (await make({ kind: 'sale', lines: [{ description: 'تمويل', qty: 1, unitPrice: 5000 }] })).body.invoice;
  const received = (await pay(funding.id, 5000)).body.invoice;
  assert.equal(received.status, 'paid');
  assert.equal(db.prepare("SELECT type FROM fin_entries WHERE reference = ? AND type <> 'JV'").get(funding.no).type, 'RV');
  const overdraw = (await make({ kind: 'purchase', lines: [{ description: 'كبير', qty: 1, unitPrice: 9000 }] })).body.invoice;
  assert.equal((await pay(overdraw.id, 9000)).status, 409, 'الرصيد غير كافٍ');
  const firstPayRes = await pay(buy.id, 400);
  assert.equal(firstPayRes.status, 200, JSON.stringify(firstPayRes.body));
  assert.equal(firstPayRes.body.invoice.status, 'partial');
  assert.equal((await pay(buy.id, 601)).status, 400);
  assert.equal((await req('POST', `/api/finance/invoices/${buy.id}/cancel`, {}, adminCookie)).status, 409, 'لا إلغاء بعد الدفع');
  const paid = (await pay(buy.id, 600)).body.invoice;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paidAmount, 1000);
  assert.equal((await pay(buy.id, 1)).status, 409);
  const payEntry = db.prepare("SELECT type FROM fin_entries WHERE reference = ? AND type <> 'JV' LIMIT 1").get(paid.no);
  assert.equal(payEntry.type, 'PV');

  // عكس سند الدفع يعيد المتبقي
  const firstPay = db.prepare("SELECT id FROM fin_entries WHERE reference = ? AND type = 'PV' ORDER BY id LIMIT 1").get(paid.no).id;
  assert.equal((await req('POST', `/api/finance/journal/${firstPay}/reverse`, { reason: 'خطأ' }, adminCookie)).status, 201);
  const back = (await list()).find((i) => i.id === buy.id);
  assert.equal(back.status, 'partial');
  assert.equal(back.paidAmount, 600);

  // الإلغاء يعكس القيد، والمسودة لا قيد لها حتى تُصدر
  const cancelled = (await req('POST', `/api/finance/invoices/${sell.id}/cancel`, {}, adminCookie)).body.invoice;
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(db.prepare('SELECT reversed_by FROM fin_entries WHERE id = ?').get(sell.entryId).reversed_by);
  assert.equal((await req('POST', `/api/finance/invoices/${sell.id}/cancel`, {}, adminCookie)).status, 409);
  const draft = (await make({ kind: 'sale', issue: false })).body.invoice;
  assert.equal(draft.status, 'draft');
  assert.equal(draft.entryId, null);
  assert.equal((await pay(draft.id, 10)).status, 409);
  const issued = (await req('POST', `/api/finance/invoices/${draft.id}/issue`, {}, adminCookie)).body.invoice;
  assert.equal(issued.status, 'issued');
  assert.ok(issued.entryId);
  assert.equal((await req('POST', `/api/finance/invoices/${draft.id}/issue`, {}, adminCookie)).status, 409);
  const draft2 = (await make({ kind: 'sale', issue: false })).body.invoice;
  assert.equal((await req('POST', `/api/finance/invoices/${draft2.id}/cancel`, {}, adminCookie)).body.invoice.status, 'cancelled');

  // ميزان المراجعة يبقى متوازنًا
  const bal = db.prepare("SELECT SUM(l.debit) AS d, SUM(l.credit) AS c FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE e.status = 'posted'").get();
  assert.equal(Number(bal.d), Number(bal.c));
});

// ── 1. نقاط نهاية المالية متاحة ──────────────────────────────────────────────
test('GET /api/finance/overview returns KPIs for admin', async () => {
  const { status, body } = await req('GET', '/api/finance/overview', null, adminCookie);
  assert.equal(status, 200);
  assert.ok('cash' in body, 'يجب أن يحتوي على cash');
  assert.ok('bank' in body, 'يجب أن يحتوي على bank');
  assert.ok('surplus' in body, 'يجب أن يحتوي على surplus');
});

test('GET /api/finance/accounts returns seeded chart of accounts', async () => {
  const { status, body } = await req('GET', '/api/finance/accounts', null, adminCookie);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.accounts));
  assert.ok(body.accounts.length > 0, 'يجب أن يكون هناك حسابات مبذرة');
  const codes = body.accounts.map((a) => a.code);
  assert.ok(codes.some((c) => c.startsWith('1')), 'يجب وجود حسابات أصول');
  assert.ok(codes.some((c) => c.startsWith('4')), 'يجب وجود حسابات إيرادات');
});

test('GET /api/finance/fiscal-years returns at least one open year', async () => {
  const { status, body } = await req('GET', '/api/finance/fiscal-years', null, adminCookie);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.years));
  assert.ok(body.years.some((y) => y.status === 'open'), 'يجب وجود سنة مالية مفتوحة');
});

test('GET /api/finance/currencies returns seeded currencies', async () => {
  const { status, body } = await req('GET', '/api/finance/currencies', null, adminCookie);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.currencies));
  assert.ok(body.currencies.some((c) => c.is_base), 'يجب وجود عملة أساسية');
});

// ── 2. إنشاء قيد يومي ─────────────────────────────────────────────────────────
async function getPostableAccounts() {
  const { body } = await req('GET', '/api/finance/accounts', null, adminCookie);
  return body.accounts.filter((a) => a.postable && a.active);
}

test('POST /api/finance/journal creates draft journal entry', async () => {
  const accs = await getPostableAccounts();
  assert.ok(accs.length >= 2, 'يجب وجود حسابين قابلين للقيد على الأقل');
  const [a1, a2] = accs;
  const { status, body } = await req('POST', '/api/finance/journal', {
    day: '2026-06-01',
    type: 'JV',
    description: 'قيد اختباري',
    lines: [
      { accountId: a1.id, debit: 100, credit: 0, note: 'مدين' },
      { accountId: a2.id, debit: 0, credit: 100, note: 'دائن' }
    ]
  }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.id, 'يجب أن يعيد id القيد');
  assert.equal(body.status, 'draft');
});

test('POST /api/finance/journal rejects unbalanced entry', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { status, body } = await req('POST', '/api/finance/journal', {
    day: '2026-06-01',
    type: 'JV',
    description: 'قيد غير متوازن',
    lines: [
      { accountId: a1.id, debit: 100, credit: 0 },
      { accountId: a2.id, debit: 0, credit: 50 }
    ]
  }, adminCookie);
  assert.equal(status, 400, 'يجب رفض القيد غير المتوازن');
});

// ── 3. ترحيل القيد ─────────────────────────────────────────────────────────────
test('POST /api/finance/journal/:id/post changes status to posted', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { body: created } = await req('POST', '/api/finance/journal', {
    day: '2026-06-01', type: 'JV', description: 'قيد للترحيل',
    lines: [{ accountId: a1.id, debit: 200, credit: 0 }, { accountId: a2.id, debit: 0, credit: 200 }]
  }, adminCookie);
  assert.ok(created.id);
  const { status, body } = await req('POST', `/api/finance/journal/${created.id}/post`, {}, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, 'posted');
  assert.ok(body.no, 'يجب أن يُعيَّن رقم للقيد عند الترحيل');
});

test('Cannot post already posted entry', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { body: created } = await req('POST', '/api/finance/journal', {
    day: '2026-06-01', type: 'JV', description: 'قيد مرحَّل',
    lines: [{ accountId: a1.id, debit: 50, credit: 0 }, { accountId: a2.id, debit: 0, credit: 50 }]
  }, adminCookie);
  await req('POST', `/api/finance/journal/${created.id}/post`, {}, adminCookie);
  const { status } = await req('POST', `/api/finance/journal/${created.id}/post`, {}, adminCookie);
  assert.ok([400, 409].includes(status), `لا يجوز ترحيل قيد مرحَّل مسبقاً (status: ${status})`);
});

// ── 4. عكس القيد ───────────────────────────────────────────────────────────────
test('POST /api/finance/journal/:id/reverse creates a reversal', async () => {
  const accs = await getPostableAccounts();
  const [a1, a2] = accs;
  const { body: created } = await req('POST', '/api/finance/journal', {
    day: '2026-06-01', type: 'JV', description: 'قيد للعكس',
    lines: [{ accountId: a1.id, debit: 300, credit: 0 }, { accountId: a2.id, debit: 0, credit: 300 }]
  }, adminCookie);
  await req('POST', `/api/finance/journal/${created.id}/post`, {}, adminCookie);
  const { status, body } = await req('POST', `/api/finance/journal/${created.id}/reverse`, { reason: 'اختبار عكس' }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.id);
  assert.equal(body.status, 'posted');
});

// ── 5. التقارير ────────────────────────────────────────────────────────────────
test('GET /api/finance/reports/trial-balance returns balanced result', async () => {
  const { status, body } = await req('GET', '/api/finance/reports/trial-balance', null, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('balanced' in body);
  assert.ok(Array.isArray(body.rows));
});

test('GET /api/finance/reports/income returns revenue and expense', async () => {
  const { status, body } = await req('GET', '/api/finance/reports/income', null, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('revenue' in body && 'expense' in body && 'surplus' in body);
});

test('GET /api/finance/reports/balance-sheet returns assets and liabilities', async () => {
  const { status, body } = await req('GET', '/api/finance/reports/balance-sheet', null, adminCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('assets' in body && 'liabilities' in body && 'equity' in body);
  // الواجهة تقرأ هذا الشكل تحديداً (finance.js)
  for (const s of [body.assets, body.liabilities, body.equity]) { assert.ok(Array.isArray(s.rows)); assert.equal(typeof s.total, 'number'); }
  assert.equal(typeof body.equity.surplus, 'number');
});

// ── 6. رسوم الطلاب ─────────────────────────────────────────────────────────────
test('POST /api/finance/charges creates a fee charge entry', async () => {
  // نحتاج طالباً — نتحقق أولاً من وجود الجدول
  const db = testApp.db;
  const hasStudents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (!hasStudents) { console.log('جدول students غير موجود في بيئة الاختبار — تخطي'); return; }
  db.prepare("INSERT INTO students (name, student_no, faculty_id, program_id) SELECT 'طالب اختبار', 'S-TEST-001', f.id, p.id FROM faculties f JOIN programs p ON p.faculty_id = f.id LIMIT 1").run();
  const student = db.prepare("SELECT id FROM students WHERE student_no='S-TEST-001'").get();
  if (!student) { console.log('تعذر إنشاء الطالب — تخطي'); return; }
  const fts = (await req('GET', '/api/finance/fee-types', null, adminCookie)).body;
  const ft = Array.isArray(fts) ? fts.find((f) => f.kind === 'fee' && f.active) : null;
  if (!ft) { console.log('لا أنواع رسوم — تخطي'); return; }
  const { status, body } = await req('POST', '/api/finance/charges', {
    studentId: student.id, feeTypeId: ft.id, amount: 500, dueDay: '2026-09-01', academicYear: '2026'
  }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.id);
});

// ── 7. أطراف ───────────────────────────────────────────────────────────────────
test('CRUD /api/finance/parties', async () => {
  const { status: s1, body: b1 } = await req('POST', '/api/finance/parties', { name: 'شركة الاختبار', kind: 'supplier' }, adminCookie);
  assert.equal(s1, 201, JSON.stringify(b1));
  // الـ route يعيد { party: { id, name, ... } }
  const id = (b1.party ?? b1).id;
  assert.ok(id, 'يجب أن يعيد id الطرف بعد الإنشاء');
  const { status: s2 } = await req('PUT', `/api/finance/parties/${id}`, { name: 'شركة الاختبار المعدّلة', kind: 'supplier' }, adminCookie);
  assert.equal(s2, 200);
  const { body: list } = await req('GET', '/api/finance/parties', null, adminCookie);
  assert.ok(list.parties.some((p) => p.id === id));
});

// ── 8. مراكز الكلفة ────────────────────────────────────────────────────────────
test('POST /api/finance/cost-centers creates a cost center', async () => {
  const { status, body } = await req('POST', '/api/finance/cost-centers', { code: 'IT-TEST', name: 'مركز تقنية اختبار' }, adminCookie);
  assert.equal(status, 201, JSON.stringify(body));
  // الـ route يعيد { costCenter: { id, code, name, ... } }
  const id = (body.costCenter ?? body).id;
  assert.ok(id, 'يجب أن يعيد id مركز الكلفة');
});

// ── 9. صلاحيات ─────────────────────────────────────────────────────────────────
test('Unauthenticated cannot access finance endpoints', async () => {
  const { status } = await req('GET', '/api/finance/overview', null, null);
  assert.equal(status, 401);
});

test('Finance staff with finance:read can access overview', async () => {
  const { status } = await req('GET', '/api/finance/overview', null, finCookie);
  assert.equal(status, 200);
});

test('Finance staff can create entries', async () => {
  const accs = (await req('GET', '/api/finance/accounts', null, finCookie)).body.accounts.filter((a) => a.postable && a.active);
  if (accs.length < 2) return;
  const [a1, a2] = accs;
  const { status } = await req('POST', '/api/finance/journal', {
    day: '2026-06-01', type: 'JV', description: 'قيد من موظف مالي',
    lines: [{ accountId: a1.id, debit: 100, credit: 0 }, { accountId: a2.id, debit: 0, credit: 100 }]
  }, finCookie);
  assert.equal(status, 201);
});

test('تبويب الرسوم والأقساط: كل ما يطلبه يعمل، وهيكل الرسوم يُحفظ', async () => {
  for (const url of ['/api/finance/fees/overview', '/api/finance/fee-structures', '/api/finance/student-invoices', '/api/finance/discounts', '/api/finance/fees/overdue']) {
    assert.equal((await req('GET', url, null, adminCookie)).status, 200, url);
  }
  const before = (await req('GET', '/api/finance/fee-structures', null, adminCookie)).body;
  assert.ok(Array.isArray(before.programs));
  assert.equal((await req('POST', '/api/finance/fee-structures', { programId: 1, academicYear: '2026/2027', semester: 1, tuitionFee: 100, registrationFee: 20 }, adminCookie)).status, 201);
  const after = (await req('GET', '/api/finance/fee-structures', null, adminCookie)).body;
  assert.equal(after.structures.length, before.structures.length + 1);
  assert.equal(after.structures[0].totalFee, 120);
});

// ── 10. واجهة الطالب /api/me/fees ─────────────────────────────────────────────
test('Student can access /api/me/fees', async () => {
  const db = testApp.db;
  // إنشاء مستخدم طالب
  const hasStudents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (!hasStudents) { console.log('جدول students غير موجود — تخطي'); return; }
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('stu_fin','طالب مالية',?,'student',?)").run(PW_HASH, Date.now());
  const stuUser = db.prepare("SELECT id FROM users WHERE username='stu_fin'").get();
  // إنشاء سجل طالب مرتبط
  const fac = db.prepare("SELECT id FROM faculties LIMIT 1").get();
  const prog = fac ? db.prepare("SELECT id FROM programs WHERE faculty_id=? LIMIT 1").get(fac.id) : null;
  if (!fac || !prog) { console.log('لا جهات/برامج — تخطي'); return; }
  db.prepare("INSERT INTO students (name, student_no, faculty_id, program_id, user_id) VALUES ('طالب مالية', 'S-FIN-001', ?, ?, ?)").run(fac.id, prog.id, stuUser.id);
  const stuCookie = await loginAs('stu_fin', testApp);
  if (!stuCookie) { console.log('تعذر تسجيل الدخول كطالب — تخطي'); return; }
  const { status, body } = await req('GET', '/api/me/fees', null, stuCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok('charges' in body && 'payments' in body);
});

// ── منع تكرار العمليات المالية ───────────────────────────────────────────────
test('Idempotency-Key replays a financial operation instead of posting it twice', async () => {
  const send = async (url, body, key) => {
    const r = await fetch(base + url, { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, replayed: r.headers.get('idempotency-replayed'), body: await r.json().catch(() => ({})) };
  };
  const db = testApp.db;
  const count = () => Number(db.prepare("SELECT COUNT(*) AS c FROM fin_entries WHERE type = 'RV'").get().c);
  const body = { kind: 'receipt', amount: 500, description: 'قبض تجربة' };

  const first = await send('/api/finance/vouchers', body, 'key-aaaaaaaa');
  assert.equal(first.status, 201);
  assert.equal(count(), 1);
  const again = await send('/api/finance/vouchers', body, 'key-aaaaaaaa');
  assert.equal(again.status, 201);
  assert.equal(again.replayed, 'true');
  assert.equal(again.body.voucher.id, first.body.voucher.id);
  assert.equal(count(), 1, 'لا قيد ثانٍ');

  // ضغطتان متزامنتان: قيد واحد فقط
  const both = await Promise.all([send('/api/finance/vouchers', body, 'key-bbbbbbbb'), send('/api/finance/vouchers', body, 'key-bbbbbbbb')]);
  assert.ok(both.every((x) => [201, 409].includes(x.status)), JSON.stringify(both.map((x) => x.status)));
  assert.equal(count(), 2);

  // مفتاح آخر عملية مقصودة أخرى، وبلا مفتاح يعمل كالمعتاد
  assert.equal((await send('/api/finance/vouchers', body, 'key-cccccccc')).status, 201);
  assert.equal((await send('/api/finance/vouchers', body)).status, 201);
  assert.equal(count(), 4);

  // البيانات المختلفة بالمفتاح نفسه مرفوضة، والمفتاح غير الصالح مرفوض
  assert.equal((await send('/api/finance/vouchers', { ...body, amount: 9 }, 'key-aaaaaaaa')).status, 422);
  assert.equal((await send('/api/finance/vouchers', body, 'x')).status, 400);

  // العملية المرفوضة تُحرر مفتاحها فتمكن إعادتها بعد التصحيح
  const invalid = { kind: 'receipt', amount: 0 };
  assert.equal((await send('/api/finance/vouchers', invalid, 'key-dddddddd')).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM idempotency_keys WHERE key LIKE '%key-dddddddd'").get().c, 0);

  // المفتاح خاص بالمستخدم والمسار
  const other = await fetch(base + '/api/finance/vouchers', { method: 'POST', headers: { Cookie: finCookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'key-aaaaaaaa' }, body: JSON.stringify(body) });
  assert.equal(other.headers.get('idempotency-replayed'), null);
});

// ── حسومات الرسوم ────────────────────────────────────────────────────────────
test('POST /api/finance/discounts posts a real discount and lowers the balance', async () => {
  const db = testApp.db;
  const stuId = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('disc1', 'طالب حسم', 'x', 'student', 'DSC-1', ?)").run(Date.now()).lastInsertRowid);
  const post = (b) => req('POST', '/api/finance/discounts', { studentNo: 'DSC-1', academicYear: '2026/2027', kind: 'sibling', percent: 25, reason: 'قرار 12', ...b }, adminCookie);
  const statement = async () => (await req('GET', `/api/finance/student-statement/${stuId}`, null, adminCookie)).body;

  assert.equal((await post({ studentNo: 'NOPE' })).status, 404);
  assert.equal((await post({ percent: 0 })).status, 400);
  assert.equal((await post({ percent: 101 })).status, 400);
  assert.equal((await post({ kind: 'oops' })).status, 400);
  assert.equal((await post({ reason: ' ' })).status, 400);
  assert.equal((await post({})).status, 409, 'لا رسوم في هذا العام');
  assert.equal((await req('GET', '/api/finance/discounts', null, adminCookie)).body.discounts.length, 0);

  const types = (await req('GET', '/api/finance/fee-types', null, adminCookie)).body;
  const fee = (types.feeTypes ?? types.types ?? types).find((f) => f.kind === 'fee' && f.active);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await req('POST', '/api/finance/charges', { studentId: stuId, feeTypeId: fee.id, amount: 1000, dueDay: today, academicYear: '2026/2027' }, adminCookie)).status, 201);
  assert.equal((await statement()).balance, 1000);

  const ok = await post({});
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.amount, 250);
  const after = await statement();
  assert.equal(after.totalCharged, 1000);
  assert.equal(after.totalDiscounts, 250);
  assert.equal(after.balance, 750, 'الحسم يخفض الرصيد');

  const row = (await req('GET', '/api/finance/discounts', null, adminCookie)).body.discounts[0];
  assert.equal(row.studentNo, 'DSC-1');
  assert.equal(row.academicYear, '2026/2027');
  assert.equal(row.percent, 25);
  assert.equal(row.reason, 'قرار 12');
  const inv = (await req('GET', '/api/finance/student-invoices', null, adminCookie)).body.invoices.filter((i) => i.studentNo === 'DSC-1');
  assert.equal(inv.length, 1, 'قيد الخصم ليس فاتورة');
  assert.equal(inv[0].discountAmount, 250);
  assert.equal(inv[0].netAmount, 750);

  assert.equal((await post({ percent: 80 })).status, 409, 'لا يتجاوز مجموع الحسومات الرسوم');
  assert.equal((await post({ percent: 75 })).status, 409, 'لا منحتان فعالتان من النوع نفسه في السنة');
  assert.equal((await post({ percent: 75, kind: 'social' })).status, 201);
  assert.equal((await statement()).balance, 0);

  // إلغاء قيد الخصم يخرجه من السجل ويعيد الرصيد
  assert.equal((await req('POST', `/api/finance/charges/${ok.body.finChargeId}/void`, { reason: 'خطأ' }, adminCookie)).status, 200);
  assert.equal((await statement()).balance, 250);
  assert.equal((await req('GET', '/api/finance/discounts', null, adminCookie)).body.discounts.length, 1);
  assert.equal((await post({})).status, 201, 'الحسم الملغى لا يمنع إصدار النوع نفسه من جديد');
  assert.equal((await statement()).balance, 0);
});

// ── فواتير الطلاب: الأقساط والمسدد الفعلي والمتأخرات ─────────────────────────
test('student invoices split into installments and track real payments', async () => {
  const db = testApp.db;
  const stuId = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('bill1', 'طالب فواتير', 'x', 'student', 'BIL-1', ?)").run(Date.now()).lastInsertRowid);
  const post = (url, body) => req('POST', url, body, adminCookie);
  const list = async () => (await req('GET', '/api/finance/student-invoices?q=BIL-1', null, adminCookie)).body.invoices.sort((a, b) => a.dueDay.localeCompare(b.dueDay));
  const good = { studentNo: 'BIL-1', academicYear: '2026/2027', totalAmount: 1000, installmentsCount: 3, firstDueDay: '2026-01-31' };

  assert.equal((await post('/api/finance/student-invoices', { ...good, studentNo: 'NOPE' })).status, 404);
  assert.equal((await post('/api/finance/student-invoices', { ...good, academicYear: '' })).status, 400);
  assert.equal((await post('/api/finance/student-invoices', { ...good, totalAmount: 0 })).status, 400);
  assert.equal((await post('/api/finance/student-invoices', { ...good, installmentsCount: 13 })).status, 400);
  assert.equal((await post('/api/finance/student-invoices', { ...good, firstDueDay: '' })).status, 400);
  assert.equal((await post('/api/finance/student-invoices', good)).status, 201);

  let rows = await list();
  assert.deepEqual(rows.map((r) => r.dueDay), ['2026-01-31', '2026-02-28', '2026-03-31'], 'شهريًا مع مراعاة نهاية الشهر');
  assert.equal(rows.reduce((s, r) => s + r.totalAmount, 0), 1000, 'لا يضيع كسر من القسمة');
  assert.equal(rows[2].totalAmount, 333.34);
  assert.match(rows[0].note, /قسط 1 من 3/);

  // الدفعة تذهب إلى الأقدم، ولا تتجاوز المتبقي
  assert.equal((await post(`/api/finance/student-invoices/${rows[0].id}/pay`, { amount: 9999 })).status, 400);
  assert.equal((await post(`/api/finance/student-invoices/${rows[0].id}/pay`, {})).status, 400, 'المبلغ مطلوب');
  assert.equal((await post(`/api/finance/student-invoices/${rows[0].id}/pay`, { amount: 100 })).status, 201);
  rows = await list();
  assert.deepEqual(rows.map((r) => [r.paidAmount, r.status]), [[100, 'partial'], [0, 'unpaid'], [0, 'unpaid']]);

  const overdue = (await req('GET', '/api/finance/fees/overdue', null, adminCookie)).body.installments.filter((x) => x.studentNo === 'BIL-1');
  assert.equal(overdue.length, 3);
  assert.equal(overdue[0].paidAmount, 100);
  const ov = (await req('GET', '/api/finance/fees/overview', null, adminCookie)).body;
  assert.equal(ov.totalBilled, 1000);
  assert.equal(ov.totalCollected, 100);
  assert.equal(ov.totalRemaining, 900);
  assert.equal(ov.overdueCount, 3);

  // ما عليه دفعة لا يُلغى، وإلغاء الدفعة يعيده
  assert.equal((await post(`/api/finance/charges/${rows[0].id}/void`, { reason: 'خطأ' })).status, 409);
  const payment = (await req('GET', '/api/finance/payments', null, adminCookie)).body.payments.find((p) => Number(p.studentId) === stuId);
  assert.equal((await post(`/api/finance/payments/${payment.id}/void`, { reason: 'خطأ' })).status, 200);
  assert.equal((await post(`/api/finance/charges/${rows[0].id}/void`, { reason: 'خطأ' })).status, 200);
  rows = await list();
  assert.deepEqual(rows.map((r) => [r.paidAmount, r.status]), [[0, 'cancelled'], [0, 'unpaid'], [0, 'unpaid']]);

  const one = (await req('GET', `/api/finance/student-invoices/${rows[1].id}`, null, adminCookie)).body.invoice;
  assert.equal(one.studentName, 'طالب فواتير');
  assert.equal((await req('GET', '/api/finance/student-invoices/999999', null, adminCookie)).status, 404);
});

test('student invoices are paged and searchable with correct totals for each page', async () => {
  const db = testApp.db;
  const uid = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('pg1', 'طالب صفحات', 'x', 'student', 'PGE-1', ?)").run(Date.now()).lastInsertRowid);
  const fee = (await req('GET', '/api/finance/fee-types', null, adminCookie)).body.find((f) => f.kind === 'fee' && f.active);
  for (let i = 0; i < 12; i++) await req('POST', '/api/finance/charges', { studentId: uid, feeTypeId: fee.id, amount: 100, dueDay: '2026-01-01', academicYear: 'Y' }, adminCookie);
  const first = (await req('GET', '/api/finance/student-invoices?q=PGE-1&size=10', null, adminCookie)).body;
  assert.equal(first.total, 12);
  assert.equal(first.pages, 2);
  assert.equal(first.invoices.length, 10);
  const second = (await req('GET', '/api/finance/student-invoices?q=PGE-1&size=10&page=2', null, adminCookie)).body;
  assert.equal(second.invoices.length, 2);
  assert.equal(new Set([...first.invoices, ...second.invoices].map((i) => i.id)).size, 12);
  assert.equal((await req('GET', '/api/finance/student-invoices?q=NOBODY', null, adminCookie)).body.total, 0);
  assert.equal((await req('GET', '/api/finance/charges?limit=5', null, adminCookie)).body.charges.length, 5);
});
