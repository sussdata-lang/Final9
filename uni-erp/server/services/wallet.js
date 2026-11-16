// محفظة الطالب الجامعية (مغلقة): رصيد مسبق الدفع داخل الجامعة فقط.
// - الشحن نقداً في المكتب المالي (finance:entry): قيد قبض، مدين الصندوق ودائن «أرصدة محافظ الطلاب».
// - الصرف: سداد الرسوم من المحفظة (الطالب نفسه برمزه السري)، والشراء من نقاط البيع في الحرم (موظف النقطة
//   مع رمز الطالب السري). كلاهما قيد مدين حساب المحافظ.
// - الرد النقدي عند التخرج أو الانسحاب (finance:post): قيد صرف من الصندوق.
// - لا تحويل بين الطلاب (المحفظة المغلقة لا تنقل المال بين الأشخاص).
// المبالغ بالوحدة الصغرى (×100) كبقية المالية؛ الرصيد مجموع الحركات، وكل حركة تُسلسَل بقفل على الطالب.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { hashPassword, verifyPassword } from '../security.js';
import { withLock, nextNumber } from './numbering.js';
import { ready, toMinor, fromMinor, createEntry, reverseEntry, sysAccount, today } from './finance/core.js';
import { studentStatement } from './finance/fees.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const n = (v) => Number(v ?? 0);

export const KIND = { topup: 'شحن نقدي', fee_payment: 'سداد رسوم', purchase: 'شراء', purchase_refund: 'إرجاع مشتريات', cash_refund: 'رد نقدي' };
const DEFAULTS = { max_balance: 5_000_000, daily_spend: 200_000, min_topup: 1_000, pin_attempts: 5, pin_lock_minutes: 15, purchase_refund_hours: 24 };
const CONFIG_LABEL = {
  max_balance: 'أعلى رصيد للمحفظة (ل.س)', daily_spend: 'حد الصرف اليومي من نقاط البيع (ل.س)', min_topup: 'أقل مبلغ للشحن (ل.س)',
  pin_attempts: 'محاولات الرمز السري قبل القفل', pin_lock_minutes: 'مدة القفل بعد المحاولات الخاطئة (دقيقة)', purchase_refund_hours: 'مهلة إرجاع المشتريات عند نقطة البيع (ساعة)',
};

export function walletConfig(db) {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM wallet_config').all().map((r) => [r.key, Number(r.value)]));
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, Number.isFinite(rows[k]) ? rows[k] : DEFAULTS[k]]));
}
export function saveConfig({ db }, actor, b, ip) {
  const cur = walletConfig(db), out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (b?.[k] === undefined) continue;
    const v = Math.round(Number(b[k]));
    if (!Number.isFinite(v) || v < 1 || v > 1e12) throw bad(`قيمة غير صالحة: ${CONFIG_LABEL[k]}.`);
    out[k] = v;
  }
  for (const [k, v] of Object.entries(out)) db.prepare('INSERT INTO wallet_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, String(v));
  audit(db, actor, 'تعديل حدود المحفظة الجامعية', Object.entries(out).map(([k, v]) => `${k}=${v}`).join('، ').slice(0, 300), ip);
  return { config: { ...cur, ...out }, labels: CONFIG_LABEL };
}

/* ---------- الحسابات المحاسبية ---------- */
// حساب الالتزام (أرصدة المحافظ) وحساب إيراد نقاط البيع؛ يُنشآن مرة واحدة في دليل الحسابات
function ensureAccounts(db) {
  ready(db);
  const make = (key, name, type, parentCode, codes) => {
    if (db.prepare('SELECT 1 AS x FROM fin_accounts WHERE system_key = ?').get(key)) return;
    const parent = db.prepare('SELECT id FROM fin_accounts WHERE code = ?').get(parentCode);
    const code = codes.find((c) => !db.prepare('SELECT 1 AS x FROM fin_accounts WHERE code = ?').get(c));
    db.prepare('INSERT INTO fin_accounts (code, name, parent_id, type, postable, system_key, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(code, name, parent?.id ?? null, type, key, Date.now());
  };
  make('wallet', 'أرصدة محافظ الطلاب', 'liability', '2', ['2301', '2302', '2391', '2399']);
  make('rev_campus', 'إيرادات نقاط البيع في الحرم', 'revenue', '42', ['4204', '4205', '4291', '4299']);
}

/* ---------- العرض ---------- */
const studentOf = (db, key) => {
  const s = typeof key === 'number' || /^\d+$/.test(String(key))
    ? db.prepare("SELECT id, username, display_name, student_no FROM users WHERE id = ? AND role = 'student'").get(Number(key))
    : null;
  return s || db.prepare("SELECT id, username, display_name, student_no FROM users WHERE role = 'student' AND (LOWER(student_no) = LOWER(?) OR LOWER(username) = LOWER(?))").get(String(key ?? '').trim(), String(key ?? '').trim());
};
const needStudent = (db, key) => { const s = studentOf(db, key); if (!s) throw bad('لا يوجد طالب بهذا الرقم.', 404, 'not_found'); return s; };
const walletRow = (db, sid) => db.prepare('SELECT * FROM wallets WHERE student_id = ?').get(sid);
const ensureWallet = (db, sid) => { if (!walletRow(db, sid)) db.prepare('INSERT INTO wallets (student_id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(sid, Date.now()); return walletRow(db, sid); };
const balanceOf = (db, sid) => n(db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM wallet_txns WHERE student_id = ?').get(sid).b);
const txnView = (t) => ({ id: Number(t.id), no: t.no, kind: t.kind, kindLabel: KIND[t.kind], amount: fromMinor(n(t.amount)), balanceAfter: fromMinor(n(t.balance_after)),
  merchant: t.merchant_name ?? null, description: t.description, at: n(t.created_at), refunded: !!t.refunded });
const txnsOf = (db, sid, limit = 100) => db.prepare(`SELECT t.*, m.name AS merchant_name, (SELECT 1 FROM wallet_txns r WHERE r.refund_of = t.id LIMIT 1) AS refunded
  FROM wallet_txns t LEFT JOIN wallet_merchants m ON m.id = t.merchant_id WHERE t.student_id = ? ORDER BY t.id DESC LIMIT ${limit}`).all(sid).map(txnView);

export function myWallet({ db }, sid) {
  const w = walletRow(db, sid), cfg = walletConfig(db);
  let dues = 0;
  try { dues = Math.max(0, studentStatement({ db }, sid).balance); } catch { /* لا ملف مالي */ }
  return { balance: fromMinor(balanceOf(db, sid)), hasPin: !!w?.pin_hash, status: w?.status ?? 'active', frozenReason: w?.frozen_reason || '',
    locked: n(w?.locked_until) > Date.now(), dues, limits: { maxBalance: cfg.max_balance, dailySpend: cfg.daily_spend }, txns: txnsOf(db, sid) };
}

/* ---------- الرمز السري ---------- */
const PIN_RE = /^\d{4,6}$/;
export async function setPin({ db, cfg }, actor, b, ip) {
  const sid = actor.id, w = ensureWallet(db, sid), pin = String(b?.pin ?? '');
  if (!PIN_RE.test(pin)) throw bad('الرمز السري من 4 إلى 6 أرقام.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw bad('اختر رمزاً غير متكرر وغير متسلسل.');
  if (w.pin_hash) {
    if (n(w.locked_until) > Date.now()) throw bad('المحفظة مقفلة مؤقتاً بعد محاولات خاطئة؛ حاول لاحقاً أو راجع المكتب المالي.', 423, 'locked');
    if (!(await verifyPassword(String(b?.current ?? ''), w.pin_hash))) { pinFailed(db, sid); throw bad('الرمز الحالي غير صحيح.', 403, 'bad_pin'); }
  }
  const hash = await hashPassword(pin, cfg?.scryptN);
  db.prepare('UPDATE wallets SET pin_hash = ?, pin_set_at = ?, failed_pins = 0, locked_until = 0 WHERE student_id = ?').run(hash, Date.now(), sid);
  audit(db, actor, w.pin_hash ? 'تغيير الرمز السري للمحفظة' : 'تعيين الرمز السري للمحفظة', '', ip);
  return { ok: true };
}
function pinFailed(db, sid) {
  const c = walletConfig(db), w = walletRow(db, sid), f = n(w?.failed_pins) + 1;
  const lock = f >= c.pin_attempts ? Date.now() + c.pin_lock_minutes * 60_000 : 0;
  db.prepare('UPDATE wallets SET failed_pins = ?, locked_until = ? WHERE student_id = ?').run(lock ? 0 : f, lock || n(w?.locked_until), sid);
}
// يتحقق من الرمز قبل أي صرف (خارج المعاملة لأن التجزئة غير متزامنة)
async function checkPin(db, sid, pin) {
  const w = walletRow(db, sid);
  if (!w?.pin_hash) throw bad('لم يُعيَّن رمز سري لهذه المحفظة بعد؛ يعيّنه الطالب من قائمة حسابه.', 409, 'no_pin');
  if (w.status === 'frozen') throw bad(`المحفظة موقوفة${w.frozen_reason ? `: ${w.frozen_reason}` : ''}.`, 423, 'frozen');
  if (n(w.locked_until) > Date.now()) throw bad('المحفظة مقفلة مؤقتاً بعد محاولات رمز خاطئة.', 423, 'locked');
  if (!(await verifyPassword(String(pin ?? ''), w.pin_hash))) { pinFailed(db, sid); throw bad('الرمز السري غير صحيح.', 403, 'bad_pin'); }
  db.prepare('UPDATE wallets SET failed_pins = 0 WHERE student_id = ?').run(sid);
}
export function resetPin({ db }, actor, studentKey, ip) {
  const s = needStudent(db, studentKey); ensureWallet(db, s.id);
  db.prepare('UPDATE wallets SET pin_hash = NULL, pin_set_at = NULL, failed_pins = 0, locked_until = 0 WHERE student_id = ?').run(s.id);
  audit(db, actor, 'إلغاء الرمز السري لمحفظة طالب', s.student_no || s.username, ip);
  db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'wallet_pin_reset', ?, 'أُلغي الرمز السري لمحفظتك بطلب منك في المكتب المالي؛ عيّن رمزاً جديداً من قائمة حسابك.', '', ?)").run(s.id, Date.now() % 1e9, Date.now());
  return { ok: true };
}
export function setFrozen({ db }, actor, studentKey, b, ip) {
  const s = needStudent(db, studentKey); ensureWallet(db, s.id);
  const frozen = !!b?.frozen, reason = String(b?.reason ?? '').trim().slice(0, 200);
  if (frozen && reason.length < 3) throw bad('اكتب سبب إيقاف المحفظة.');
  db.prepare('UPDATE wallets SET status = ?, frozen_reason = ? WHERE student_id = ?').run(frozen ? 'frozen' : 'active', frozen ? reason : '', s.id);
  audit(db, actor, frozen ? 'إيقاف محفظة طالب' : 'تفعيل محفظة طالب', `${s.student_no || s.username}${reason ? ` — ${reason}` : ''}`, ip);
  return { ok: true };
}

/* ---------- الحركات ---------- */
// حركة واحدة: قيد محاسبي مرحَّل + سطر في سجل المحفظة، داخل قفل على الطالب
function record(deps, actor, { sid, kind, amount, merchantId = null, description, lines, entryType, paymentId = null, refundOf = null }, ip) {
  const { db } = deps;
  const y = new Date().getFullYear();
  const seq = nextNumber(db, `wallet:${y}`, "SELECT MAX(CAST(substr(no, 10) AS INTEGER)) FROM wallet_txns WHERE no LIKE ?", [`WAL-${y}-%`]);
  const no = `WAL-${y}-${String(seq).padStart(6, '0')}`;
  const entry = createEntry(deps, actor, { day: today(), description: `${KIND[kind]} — ${description}`.slice(0, 300), reference: no, lines, post: true }, ip, { type: entryType, system: true, source: `wallet:${no}` });
  const bal = balanceOf(db, sid) + amount;
  const id = Number(db.prepare(`INSERT INTO wallet_txns (no, student_id, kind, amount, balance_after, merchant_id, description, entry_id, payment_id, refund_of, actor_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(no, sid, kind, amount, bal, merchantId, description.slice(0, 300), entry.id, paymentId, refundOf, actor?.id ?? null, Date.now()).id);
  return { id, no, balance: fromMinor(bal) };
}

export function topUp(deps, actor, b, ip) {
  const { db } = deps; ensureAccounts(db);
  const s = needStudent(db, b?.studentNo ?? b?.studentId), amt = toMinor(b?.amount), c = walletConfig(db);
  if (!Number.isFinite(amt) || amt <= 0) throw bad('مبلغ الشحن غير صالح.');
  if (amt < c.min_topup * 100) throw bad(`أقل مبلغ للشحن ${c.min_topup.toLocaleString('en-US')} ل.س.`);
  const method = b?.method === 'bank' ? 'bank' : 'cash';
  return withLock(db, `wallet:${s.id}`, () => {
    const w = ensureWallet(db, s.id);
    if (w.status === 'frozen') throw bad('المحفظة موقوفة؛ فعّلها أولاً.', 423, 'frozen');
    if (balanceOf(db, s.id) + amt > c.max_balance * 100) throw bad(`يتجاوز الشحن أعلى رصيد مسموح للمحفظة (${c.max_balance.toLocaleString('en-US')} ل.س).`, 409, 'max_balance');
    const cash = sysAccount(db, method), wal = sysAccount(db, 'wallet');
    const r = record(deps, actor, { sid: s.id, kind: 'topup', amount: amt, description: `${s.display_name}${b?.note ? ` — ${String(b.note).slice(0, 100)}` : ''}`, entryType: 'RV',
      lines: [{ accountId: cash.id, debit: fromMinor(amt) }, { accountId: wal.id, credit: fromMinor(amt), studentId: s.id }] }, ip);
    audit(db, actor, 'شحن محفظة طالب', `${r.no} ${s.student_no || s.username} ${fromMinor(amt)}`, ip);
    db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'wallet_topup', ?, ?, '', ?) ON CONFLICT DO NOTHING").run(s.id, r.id, `شُحنت محفظتك بمبلغ ${fromMinor(amt).toLocaleString('en-US')} ل.س. الرصيد: ${r.balance.toLocaleString('en-US')} ل.س.`, Date.now());
    return { ...r, student: s.display_name };
  });
}

export async function payFees(deps, actor, b, ip) {
  const { db } = deps; ensureAccounts(db);
  const sid = actor.id, amt = toMinor(b?.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw bad('المبلغ غير صالح.');
  await checkPin(db, sid, b?.pin);
  return withLock(db, `wallet:${sid}`, () => {
    const dues = toMinor(Math.max(0, studentStatement({ db }, sid).balance));
    if (!dues) throw bad('لا رسوم مستحقة عليك.', 409, 'no_dues');
    if (amt > dues) throw bad(`المستحق عليك ${fromMinor(dues).toLocaleString('en-US')} ل.س فقط.`);
    if (amt > balanceOf(db, sid)) throw bad('رصيد المحفظة غير كافٍ.', 409, 'insufficient_balance');
    const wal = sysAccount(db, 'wallet'), stud = sysAccount(db, 'students');
    const y = new Date().getFullYear(), rseq = nextNumber(db, `walletpay:${y}`, "SELECT MAX(CAST(substr(receipt_no, 10) AS INTEGER)) FROM fin_payments WHERE receipt_no LIKE ?", [`WLP-${y}-%`]);
    const rno = `WLP-${y}-${String(rseq).padStart(6, '0')}`;
    const pid = Number(db.prepare("INSERT INTO fin_payments (receipt_no, student_id, amount, method, account_id, paid_day, note, created_by, created_at) VALUES (?, ?, ?, 'wallet', ?, ?, 'سداد من المحفظة الجامعية', ?, ?) RETURNING id")
      .get(rno, sid, amt, wal.id, today(), actor.id, Date.now()).id);
    const r = record(deps, actor, { sid, kind: 'fee_payment', amount: -amt, description: `إيصال ${rno}`, entryType: 'JV', paymentId: pid,
      lines: [{ accountId: wal.id, debit: fromMinor(amt), studentId: sid }, { accountId: stud.id, credit: fromMinor(amt), studentId: sid }] }, ip);
    db.prepare("UPDATE fin_payments SET entry_id = (SELECT entry_id FROM wallet_txns WHERE id = ?), status = 'ok' WHERE id = ?").run(r.id, pid);
    audit(db, actor, 'سداد رسوم من المحفظة', `${rno} ${fromMinor(amt)}`, ip);
    return { ...r, receiptNo: rno };
  });
}

/* ---------- نقاط البيع ---------- */
const operatorMerchants = (db, uid) => db.prepare('SELECT m.id, m.name FROM wallet_merchants m JOIN wallet_merchant_operators o ON o.merchant_id = m.id WHERE o.user_id = ? AND m.active = 1 ORDER BY m.name').all(uid).map((m) => ({ id: Number(m.id), name: m.name }));
const spentToday = (db, sid) => -n(db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM wallet_txns WHERE student_id = ? AND kind IN ('purchase', 'purchase_refund') AND created_at >= ?").get(sid, Date.parse(`${today()}T00:00:00+03:00`)).s);

export function posInfo({ db }, actor) {
  const merchants = operatorMerchants(db, actor.id);
  const since = Date.parse(`${today()}T00:00:00+03:00`);
  const recent = merchants.length ? db.prepare(`SELECT t.*, m.name AS merchant_name, u.display_name AS student_name, u.student_no, (SELECT 1 FROM wallet_txns r WHERE r.refund_of = t.id LIMIT 1) AS refunded
    FROM wallet_txns t JOIN wallet_merchants m ON m.id = t.merchant_id JOIN users u ON u.id = t.student_id WHERE t.merchant_id IN (${merchants.map((m) => m.id).join(',')}) AND t.created_at >= ? ORDER BY t.id DESC LIMIT 100`).all(since)
    .map((t) => ({ ...txnView(t), student: t.student_name, studentNo: t.student_no })) : [];
  const total = -recent.reduce((s, t) => s + Math.round(t.amount * 100), 0);
  return { merchants, today: { count: recent.filter((t) => t.kind === 'purchase').length, total: fromMinor(total) }, recent };
}

export async function charge(deps, actor, b, ip) {
  const { db } = deps; ensureAccounts(db);
  const merchant = operatorMerchants(db, actor.id).find((m) => m.id === Number(b?.merchantId));
  if (!merchant) throw bad('لست مخوَّلاً بالتحصيل في نقطة البيع هذه.', 403, 'forbidden');
  const s = needStudent(db, b?.studentNo), amt = toMinor(b?.amount), c = walletConfig(db);
  if (!Number.isFinite(amt) || amt <= 0) throw bad('المبلغ غير صالح.');
  if (Number(s.id) === Number(actor.id)) throw bad('لا يحصّل الموظف من محفظته.', 403, 'forbidden');
  await checkPin(db, s.id, b?.pin);
  const desc = String(b?.description ?? '').trim().slice(0, 120);
  return withLock(db, `wallet:${s.id}`, () => {
    if (amt > balanceOf(db, s.id)) throw bad('رصيد المحفظة غير كافٍ.', 409, 'insufficient_balance');
    if (spentToday(db, s.id) + amt > c.daily_spend * 100) throw bad(`يتجاوز حد الصرف اليومي (${c.daily_spend.toLocaleString('en-US')} ل.س).`, 409, 'daily_limit');
    const wal = sysAccount(db, 'wallet'), rev = sysAccount(db, 'rev_campus');
    const r = record(deps, actor, { sid: s.id, kind: 'purchase', amount: -amt, merchantId: merchant.id, description: `${merchant.name}${desc ? ` — ${desc}` : ''}`, entryType: 'JV',
      lines: [{ accountId: wal.id, debit: fromMinor(amt), studentId: s.id }, { accountId: rev.id, credit: fromMinor(amt) }] }, ip);
    audit(db, actor, 'تحصيل من محفظة طالب', `${r.no} ${merchant.name} ${s.student_no || s.username} ${fromMinor(amt)}`, ip);
    return { ...r, student: s.display_name, merchant: merchant.name };
  });
}

// إرجاع مشتريات عند النقطة نفسها خلال المهلة: حركة معاكسة وعكس القيد
export function refundPurchase(deps, actor, txnId, b, ip) {
  const { db } = deps;
  // من ليس محصّلاً في أي نقطة يُرفض قبل البحث، فلا يُكشف وجود العمليات
  if (!actor || !operatorMerchants(db, actor.id).length) throw bad('الإرجاع لمحصّلي نقاط البيع فقط.', 403, 'forbidden');
  const t = db.prepare("SELECT * FROM wallet_txns WHERE id = ? AND kind = 'purchase'").get(Number(txnId));
  if (!t) throw bad('عملية الشراء غير موجودة.', 404, 'not_found');
  if (!operatorMerchants(db, actor.id).some((m) => m.id === Number(t.merchant_id))) throw bad('الإرجاع من نقطة البيع نفسها فقط.', 403, 'forbidden');
  const c = walletConfig(db);
  if (Date.now() - n(t.created_at) > c.purchase_refund_hours * 3600_000) throw bad(`انتهت مهلة الإرجاع (${c.purchase_refund_hours} ساعة)؛ يُعالج من المكتب المالي.`, 409, 'conflict');
  const reason = String(b?.reason ?? '').trim().slice(0, 200);
  if (reason.length < 3) throw bad('اكتب سبب الإرجاع.');
  return withLock(db, `wallet:${t.student_id}`, () => {
    if (db.prepare('SELECT 1 AS x FROM wallet_txns WHERE refund_of = ?').get(t.id)) throw bad('أُرجعت هذه العملية مسبقاً.', 409, 'conflict');
    const rev = reverseEntry(deps, actor, t.entry_id, { day: today(), reason: `إرجاع ${t.no}: ${reason}` }, ip).id;
    const y = new Date().getFullYear();
    const seq = nextNumber(db, `wallet:${y}`, "SELECT MAX(CAST(substr(no, 10) AS INTEGER)) FROM wallet_txns WHERE no LIKE ?", [`WAL-${y}-%`]);
    const no = `WAL-${y}-${String(seq).padStart(6, '0')}`, amt = -n(t.amount), bal = balanceOf(db, t.student_id) + amt;
    const id = Number(db.prepare(`INSERT INTO wallet_txns (no, student_id, kind, amount, balance_after, merchant_id, description, entry_id, refund_of, actor_id, created_at)
      VALUES (?, ?, 'purchase_refund', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(no, t.student_id, amt, bal, t.merchant_id, `إرجاع ${t.no}: ${reason}`, rev, t.id, actor.id, Date.now()).id);
    audit(db, actor, 'إرجاع مشتريات إلى محفظة طالب', `${no} عن ${t.no}: ${reason}`, ip);
    return { id, no, balance: fromMinor(bal) };
  });
}

// الرد النقدي للرصيد (تخرج، انسحاب، أو طلب الطالب)
export function cashRefund(deps, actor, b, ip) {
  const { db } = deps; ensureAccounts(db);
  const s = needStudent(db, b?.studentNo ?? b?.studentId);
  const reason = String(b?.reason ?? '').trim().slice(0, 200);
  if (reason.length < 5) throw bad('اكتب سبب الرد (5 أحرف على الأقل).');
  return withLock(db, `wallet:${s.id}`, () => {
    const bal = balanceOf(db, s.id), amt = b?.amount === undefined || b?.amount === '' ? bal : toMinor(b.amount);
    if (!(amt > 0)) throw bad('لا رصيد للرد.', 409, 'conflict');
    if (amt > bal) throw bad('المبلغ أكبر من رصيد المحفظة.', 409, 'insufficient_balance');
    const wal = sysAccount(db, 'wallet'), cash = sysAccount(db, 'cash');
    const r = record(deps, actor, { sid: s.id, kind: 'cash_refund', amount: -amt, description: `${s.display_name} — ${reason}`, entryType: 'PV',
      lines: [{ accountId: wal.id, debit: fromMinor(amt), studentId: s.id }, { accountId: cash.id, credit: fromMinor(amt) }] }, ip);
    audit(db, actor, 'رد نقدي من محفظة طالب', `${r.no} ${s.student_no || s.username} ${fromMinor(amt)}: ${reason}`, ip);
    return { ...r, student: s.display_name };
  });
}

/* ---------- إدارة المالية ---------- */
export function financeOverview({ db }, q = {}) {
  ensureAccounts(db);
  const term = String(q.q ?? '').trim();
  const rows = db.prepare(`SELECT u.id, u.display_name, u.student_no, COALESCE(SUM(t.amount), 0) AS bal, MAX(t.created_at) AS last, w.status, w.pin_hash IS NOT NULL AS has_pin
    FROM users u LEFT JOIN wallet_txns t ON t.student_id = u.id LEFT JOIN wallets w ON w.student_id = u.id
    WHERE u.role = 'student' AND (? = '' OR u.student_no ILIKE ? OR u.display_name ILIKE ?) AND (? <> '' OR t.id IS NOT NULL OR w.student_id IS NOT NULL)
    GROUP BY u.id, u.display_name, u.student_no, w.status, w.pin_hash ORDER BY last DESC NULLS LAST, u.id LIMIT 100`).all(term, `%${term}%`, `%${term}%`, term);
  const total = n(db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM wallet_txns').get().b);
  const day = Date.parse(`${today()}T00:00:00+03:00`);
  const todayBy = Object.fromEntries(db.prepare('SELECT kind, COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM wallet_txns WHERE created_at >= ? GROUP BY kind').all(day).map((r) => [r.kind, { sum: fromMinor(n(r.s)), count: n(r.c) }]));
  const merchants = db.prepare(`SELECT m.*, (SELECT string_agg(u.username, '، ') FROM wallet_merchant_operators o JOIN users u ON u.id = o.user_id WHERE o.merchant_id = m.id) AS ops FROM wallet_merchants m ORDER BY m.name`).all()
    .map((m) => ({ id: Number(m.id), name: m.name, active: !!n(m.active), operators: m.ops || '' }));
  return { totalBalance: fromMinor(total), today: todayBy, wallets: rows.map((r) => ({ id: Number(r.id), name: r.display_name, studentNo: r.student_no, balance: fromMinor(n(r.bal)), lastAt: r.last ? n(r.last) : null, status: r.status || 'active', hasPin: !!r.has_pin })),
    merchants, config: walletConfig(db), configLabels: CONFIG_LABEL };
}
export function studentWallet({ db }, key) { const s = needStudent(db, key); return { student: { id: s.id, name: s.display_name, studentNo: s.student_no }, ...myWallet({ db }, s.id) }; }

export function saveMerchant({ db }, actor, b, ip) {
  const name = String(b?.name ?? '').trim().slice(0, 80);
  if (b?.id) {
    const m = db.prepare('SELECT * FROM wallet_merchants WHERE id = ?').get(Number(b.id)); if (!m) throw bad('نقطة البيع غير موجودة.', 404, 'not_found');
    db.prepare('UPDATE wallet_merchants SET name = ?, active = ? WHERE id = ?').run(name || m.name, b.active === undefined ? m.active : (b.active ? 1 : 0), m.id);
    audit(db, actor, 'تعديل نقطة بيع للمحفظة', name || m.name, ip);
    return { id: Number(m.id) };
  }
  if (name.length < 2) throw bad('اسم نقطة البيع مطلوب.');
  if (db.prepare('SELECT 1 AS x FROM wallet_merchants WHERE name = ?').get(name)) throw bad('يوجد نقطة بيع بهذا الاسم.', 409, 'conflict');
  const id = Number(db.prepare('INSERT INTO wallet_merchants (name, created_at) VALUES (?, ?) RETURNING id').get(name, Date.now()).id);
  audit(db, actor, 'إضافة نقطة بيع للمحفظة', name, ip);
  return { id };
}
export function setOperator({ db }, actor, merchantId, b, ip) {
  const m = db.prepare('SELECT * FROM wallet_merchants WHERE id = ?').get(Number(merchantId)); if (!m) throw bad('نقطة البيع غير موجودة.', 404, 'not_found');
  const u = db.prepare("SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) AND role <> 'student' AND active = 1").get(String(b?.username ?? '').trim());
  if (!u) throw bad('لا يوجد موظف فعّال بهذا الاسم.', 404, 'not_found');
  if (b?.remove) db.prepare('DELETE FROM wallet_merchant_operators WHERE merchant_id = ? AND user_id = ?').run(m.id, u.id);
  else db.prepare('INSERT INTO wallet_merchant_operators (merchant_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(m.id, u.id);
  audit(db, actor, b?.remove ? 'إزالة محصّل من نقطة بيع' : 'تعيين محصّل لنقطة بيع', `${m.name}: ${u.username}`, ip);
  return { ok: true };
}

export function registerWalletRoutes(r, deps) {
  const { db } = deps;
  const student = (c) => { if (c.user?.role !== 'student') throw new HttpError(403, 'المحفظة للطلاب.', 'forbidden'); return c.user; };
  const fin = (c, ...perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); return c.user; };
  // الطالب
  r.add('GET', '/api/wallet/me', (c) => c.json(200, myWallet(deps, student(c).id)));
  r.add('POST', '/api/wallet/me/pin', async (c) => c.json(200, await setPin(deps, student(c), c.body, c.ip)));
  r.add('POST', '/api/wallet/me/pay-fees', async (c) => c.json(200, await payFees(deps, student(c), c.body, c.ip)));
  // نقطة البيع: من عُيِّن محصّلاً لها
  r.add('GET', '/api/wallet/pos', (c) => c.json(200, posInfo(deps, c.user)));
  r.add('POST', '/api/wallet/pos/charge', async (c) => c.json(200, await charge(deps, c.user, c.body, c.ip)));
  r.add('POST', '/api/wallet/pos/refund/:id', (c) => c.json(200, refundPurchase(deps, c.user, c.params.id, c.body, c.ip)));
  // المالية
  r.add('GET', '/api/wallet/admin', (c) => { fin(c, 'finance:read', 'finance:entry', 'finance:fees'); c.json(200, { ...financeOverview(deps, c.query ?? {}), can: { entry: c.user.can('finance:entry'), post: c.user.can('finance:post'), setup: c.user.can('finance:setup') } }); });
  r.add('GET', '/api/wallet/admin/students/:key', (c) => { fin(c, 'finance:read', 'finance:entry', 'finance:fees'); c.json(200, studentWallet(deps, c.params.key)); });
  r.add('POST', '/api/wallet/admin/topup', (c) => c.json(200, topUp(deps, fin(c, 'finance:entry'), c.body, c.ip)));
  r.add('POST', '/api/wallet/admin/refund', (c) => c.json(200, cashRefund(deps, fin(c, 'finance:post'), c.body, c.ip)));
  r.add('POST', '/api/wallet/admin/students/:key/reset-pin', (c) => c.json(200, resetPin(deps, fin(c, 'finance:entry'), c.params.key, c.ip)));
  r.add('POST', '/api/wallet/admin/students/:key/freeze', (c) => c.json(200, setFrozen(deps, fin(c, 'finance:entry'), c.params.key, c.body, c.ip)));
  r.add('PUT', '/api/wallet/admin/config', (c) => c.json(200, saveConfig(deps, fin(c, 'finance:setup'), c.body, c.ip)));
  r.add('POST', '/api/wallet/admin/merchants', (c) => c.json(200, saveMerchant(deps, fin(c, 'finance:setup'), c.body, c.ip)));
  r.add('POST', '/api/wallet/admin/merchants/:id/operators', (c) => c.json(200, setOperator(deps, fin(c, 'finance:setup'), c.params.id, c.body, c.ip)));
  void db;
}
