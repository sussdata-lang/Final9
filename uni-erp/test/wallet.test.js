// محفظة الطالب الجامعية: الشحن، الرمز السري، نقاط البيع وحدودها، الإرجاع، سداد الرسوم، الرد النقدي، ومطابقة الدفتر.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { createCharge } from '../server/services/finance/fees.js';
import { ready } from '../server/services/finance/core.js';

const PW = 'Test#Pass12345';
let app, base, ck = {}, id = {};
const api = async (m, u, who, body) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
const bal = async () => (await api('GET', '/api/wallet/me', 'STU-W1')).j.balance;
// رصيد حساب المحافظ في الدفتر (دائن − مدين) يساوي مجموع أرصدة المحافظ دائماً
const ledgerWallet = () => Number(app.db.prepare("SELECT COALESCE(SUM(l.credit) - SUM(l.debit), 0) AS b FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id WHERE e.status = 'posted' AND a.system_key = 'wallet'").get().b) / 100;
const walletsSum = () => Number(app.db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM wallet_txns').get().b) / 100;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-wallet-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const hash = await hashPassword(PW, 1024), now = Date.now(), db = app.db;
  ready(db);
  const user = (u, role, perms) => { id[u] = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, created_at, access_mode, custom_permissions_json) VALUES (?,?,?,?,?,?,?,?) RETURNING id').get(u, `مستخدم ${u}`, hash, role, role === 'student' ? u : null, now, perms ? 'custom' : 'role', JSON.stringify(perms || [])).id); };
  user('fin', 'staff', ['finance:read', 'finance:entry']); user('poster', 'staff', ['finance:read', 'finance:post']); user('setup', 'staff', ['finance:read', 'finance:setup']);
  user('cashier', 'staff', ['student:read']); user('other', 'staff', ['student:read']);
  const prog = db.prepare('SELECT id FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  for (const s of ['STU-W1', 'STU-W2']) {
    user(s, 'student');
    db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
      VALUES (?, 'أ', 'ب', ?, 'د', ?, 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2024, 'الفصل الأول', 1, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(id[s], s, `9${String(id[s]).padStart(10, '0')}`, prog, now, now);
  }
  db.prepare('UPDATE users SET must_change_password = 0').run();
  for (const u of ['fin', 'poster', 'setup', 'cashier', 'other', 'STU-W1', 'STU-W2']) ck[u] = await login(u);
});
test.after(async () => { await app.close(); });

test('الشحن في المكتب المالي: بصلاحية الإدخال المالي فقط، وقيد قبض مرحَّل يطابق الرصيد', async () => {
  const me = await api('GET', '/api/wallet/me', 'STU-W1');
  assert.equal(me.s, 200); assert.equal(me.j.balance, 0); assert.equal(me.j.hasPin, false);
  assert.equal((await api('GET', '/api/wallet/me', 'fin')).s, 403, 'المحفظة للطلاب');

  assert.equal((await api('POST', '/api/wallet/admin/topup', 'STU-W1', { studentNo: 'STU-W1', amount: 50000 })).s, 403);
  assert.equal((await api('POST', '/api/wallet/admin/topup', 'cashier', { studentNo: 'STU-W1', amount: 50000 })).s, 403);
  assert.equal((await api('POST', '/api/wallet/admin/topup', 'fin', { studentNo: 'STU-W1', amount: 500 })).s, 400, 'أقل من حد الشحن');
  assert.equal((await api('POST', '/api/wallet/admin/topup', 'fin', { studentNo: 'غير-موجود', amount: 5000 })).s, 404);
  const t = await api('POST', '/api/wallet/admin/topup', 'fin', { studentNo: 'STU-W1', amount: 50000, note: 'نقداً' });
  assert.equal(t.s, 200, JSON.stringify(t.j)); assert.equal(t.j.balance, 50000); assert.match(t.j.no, /^WAL-\d{4}-\d{6}$/);
  assert.equal(await bal(), 50000);
  assert.equal(ledgerWallet(), 50000, 'الدفتر يطابق');
  assert.ok(app.db.prepare("SELECT 1 AS x FROM user_notifications WHERE user_id = ? AND kind = 'wallet_topup'").get(id['STU-W1']), 'أُبلغ الطالب');
  assert.equal((await api('POST', '/api/wallet/admin/topup', 'fin', { studentNo: 'STU-W1', amount: 5_000_000 })).s, 409, 'أعلى رصيد');
});

test('الرمز السري: أرقام غير متكررة ولا متسلسلة، وتغييره يتطلب الحالي', async () => {
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '12' })).s, 400);
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '1111' })).s, 400);
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '1234' })).s, 400);
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '4826' })).s, 200);
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '7391', current: '0000' })).s, 403, 'الحالي خاطئ');
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '7391', current: '4826' })).s, 200);
  assert.equal((await api('GET', '/api/wallet/me', 'STU-W1')).j.hasPin, true);
  assert.equal(app.db.prepare('SELECT pin_hash FROM wallets WHERE student_id = ?').get(id['STU-W1']).pin_hash.includes('7391'), false, 'الرمز مجزَّأ لا صريح');
});

test('نقطة البيع: محصّل معيَّن فقط، برمز الطالب، وضمن الرصيد والحد اليومي، والإرجاع مرة واحدة', async () => {
  const m = await api('POST', '/api/wallet/admin/merchants', 'setup', { name: 'المقصف' });
  assert.equal(m.s, 200);
  assert.equal((await api('POST', '/api/wallet/admin/merchants', 'fin', { name: 'الطباعة' })).s, 403, 'الإعداد لمدير المالية');
  assert.equal((await api('POST', `/api/wallet/admin/merchants/${m.j.id}/operators`, 'setup', { username: 'cashier' })).s, 200);
  assert.deepEqual((await api('GET', '/api/wallet/pos', 'cashier')).j.merchants.map((x) => x.name), ['المقصف']);
  assert.equal((await api('GET', '/api/wallet/pos', 'other')).j.merchants.length, 0);

  const body = (o) => ({ merchantId: m.j.id, studentNo: 'STU-W1', amount: 12000, pin: '7391', description: 'وجبة غداء', ...o });
  assert.equal((await api('POST', '/api/wallet/pos/charge', 'other', body())).s, 403, 'غير معيَّن للنقطة');
  assert.equal((await api('POST', '/api/wallet/pos/charge', 'cashier', body({ pin: '0000' }))).s, 403, 'رمز خاطئ');
  assert.equal((await api('POST', '/api/wallet/pos/charge', 'cashier', body({ studentNo: 'STU-W2' }))).s, 409, 'لا رمز لمحفظته');
  const c = await api('POST', '/api/wallet/pos/charge', 'cashier', body());
  assert.equal(c.s, 200, JSON.stringify(c.j)); assert.equal(c.j.balance, 38000);
  assert.equal((await api('POST', '/api/wallet/pos/charge', 'cashier', body({ amount: 40000 }))).s, 409, 'الرصيد غير كافٍ');

  assert.equal((await api('PUT', '/api/wallet/admin/config', 'setup', { daily_spend: 20000 })).s, 200);
  const lim = await api('POST', '/api/wallet/pos/charge', 'cashier', body({ amount: 9000 }));
  assert.equal(lim.s, 409); assert.equal(lim.j.error, 'daily_limit');
  await api('PUT', '/api/wallet/admin/config', 'setup', { daily_spend: 200000 });

  assert.equal((await api('POST', `/api/wallet/pos/refund/${c.j.id}`, 'cashier', { reason: '' })).s, 400);
  const rf = await api('POST', `/api/wallet/pos/refund/${c.j.id}`, 'cashier', { reason: 'أُلغي الطلب' });
  assert.equal(rf.s, 200, JSON.stringify(rf.j)); assert.equal(rf.j.balance, 50000);
  assert.equal((await api('POST', `/api/wallet/pos/refund/${c.j.id}`, 'cashier', { reason: 'مرة ثانية' })).s, 409);
  assert.equal(ledgerWallet(), walletsSum(), 'الدفتر يطابق بعد الشراء والإرجاع');
  const pos = (await api('GET', '/api/wallet/pos', 'cashier')).j;
  assert.equal(pos.recent.length, 2); assert.equal(pos.recent.find((x) => x.id === c.j.id).refunded, true);
});

test('سداد الرسوم من المحفظة: ضمن المستحق والرصيد، ويُسجَّل دفعة تُنقص المستحقات', async () => {
  const ft = app.db.prepare("SELECT id FROM fin_fee_types WHERE kind = 'fee' ORDER BY id LIMIT 1").get().id;
  createCharge(app, { id: id.fin, role: 'staff', can: () => true }, { studentId: id['STU-W1'], feeTypeId: ft, amount: 30000 }, '::1');
  assert.equal((await api('GET', '/api/wallet/me', 'STU-W1')).j.dues, 30000);
  assert.equal((await api('POST', '/api/wallet/me/pay-fees', 'STU-W1', { amount: 35000, pin: '7391' })).s, 400, 'أكثر من المستحق');
  assert.equal((await api('POST', '/api/wallet/me/pay-fees', 'STU-W1', { amount: 20000, pin: '1357' })).s, 403);
  const p = await api('POST', '/api/wallet/me/pay-fees', 'STU-W1', { amount: 20000, pin: '7391' });
  assert.equal(p.s, 200, JSON.stringify(p.j)); assert.equal(p.j.balance, 30000); assert.match(p.j.receiptNo, /^WLP-/);
  const me = (await api('GET', '/api/wallet/me', 'STU-W1')).j;
  assert.equal(me.dues, 10000, 'نقص المستحق');
  assert.equal(app.db.prepare("SELECT method FROM fin_payments WHERE receipt_no = ?").get(p.j.receiptNo).method, 'wallet');
  assert.equal(ledgerWallet(), walletsSum());
});

test('قفل الرمز بعد محاولات خاطئة، وإلغاؤه وإيقاف المحفظة من المالية', async () => {
  for (let i = 0; i < 5; i++) await api('POST', '/api/wallet/me/pay-fees', 'STU-W1', { amount: 1000, pin: '1357' });
  const locked = await api('POST', '/api/wallet/me/pay-fees', 'STU-W1', { amount: 1000, pin: '7391' });
  assert.equal(locked.s, 423, 'مقفلة حتى بالرمز الصحيح');
  assert.equal((await api('POST', '/api/wallet/admin/students/STU-W1/reset-pin', 'cashier')).s, 403);
  assert.equal((await api('POST', '/api/wallet/admin/students/STU-W1/reset-pin', 'fin')).s, 200);
  assert.equal((await api('GET', '/api/wallet/me', 'STU-W1')).j.hasPin, false);
  assert.equal((await api('POST', '/api/wallet/me/pin', 'STU-W1', { pin: '5829' })).s, 200, 'يعيّن رمزاً جديداً دون الحالي');

  assert.equal((await api('POST', '/api/wallet/admin/students/STU-W1/freeze', 'fin', { frozen: true, reason: 'بطاقة مفقودة' })).s, 200);
  const merchant = app.db.prepare('SELECT id FROM wallet_merchants LIMIT 1').get().id;
  assert.equal((await api('POST', '/api/wallet/pos/charge', 'cashier', { merchantId: merchant, studentNo: 'STU-W1', amount: 1000, pin: '5829' })).s, 423, 'الموقوفة لا تصرف');
  await api('POST', '/api/wallet/admin/students/STU-W1/freeze', 'fin', { frozen: false });
});

test('الرد النقدي: بصلاحية الترحيل، بسبب، ويصفّر الرصيد، والدفتر يطابق، ونظرة المالية', async () => {
  assert.equal((await api('POST', '/api/wallet/admin/refund', 'fin', { studentNo: 'STU-W1', reason: 'تخرج الطالب' })).s, 403, 'الإدخال لا يكفي');
  assert.equal((await api('POST', '/api/wallet/admin/refund', 'poster', { studentNo: 'STU-W1', reason: 'لا' })).s, 400);
  assert.equal((await api('POST', '/api/wallet/admin/refund', 'poster', { studentNo: 'STU-W1', amount: 999999, reason: 'تخرج الطالب' })).s, 409);
  const r = await api('POST', '/api/wallet/admin/refund', 'poster', { studentNo: 'STU-W1', reason: 'تخرج الطالب' });
  assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.balance, 0);
  assert.equal(ledgerWallet(), 0); assert.equal(walletsSum(), 0);

  const ov = await api('GET', '/api/wallet/admin', 'fin');
  assert.equal(ov.s, 200); assert.equal(ov.j.totalBalance, 0); assert.equal(ov.j.merchants[0].operators, 'cashier');
  assert.equal(ov.j.can.post, false); assert.equal(ov.j.can.entry, true);
  assert.equal((await api('GET', '/api/wallet/admin', 'cashier')).s, 403);
  const st = await api('GET', '/api/wallet/admin/students/STU-W1', 'fin');
  assert.deepEqual(st.j.txns.map((t) => t.kind), ['cash_refund', 'fee_payment', 'purchase_refund', 'purchase', 'topup']);
});
