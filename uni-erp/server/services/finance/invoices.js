// فواتير المبيعات والمشتريات: المبيعات ذمم مدينة وإيراد، والمشتريات مصروف وذمم دائنة.
// المسدد لا يُخزَّن بل يُحسب من سندات القبض والصرف غير المعكوسة، فيبقى مطابقًا لدفتر الأستاذ.
import { audit } from '../../audit.js';
import { docNo } from '../../lib/doc_no.js';
import { bad, ready, sysAccount, createEntry, reverseEntry, fromMinor, toMinor, isDay, today } from './core.js';

const KINDS = {
  sale: { settle: 'debtors', counter: 'rev_services', counterTypes: ['revenue'], payType: 'RV', label: 'مبيعات' },
  purchase: { settle: 'suppliers', counter: 'general_exp', counterTypes: ['expense', 'asset'], payType: 'PV', label: 'مشتريات' },
};

const SELECT = `SELECT i.*, p.name AS party_name, e.reversed_by AS entry_reversed_by,
    (SELECT COALESCE(SUM(l.debit), 0) FROM fin_lines l JOIN fin_entries pe ON pe.id = l.entry_id
      WHERE pe.reference = i.no AND pe.type IN ('RV', 'PV') AND pe.status = 'posted' AND pe.reversed_by IS NULL) AS paid_minor
  FROM fin_invoices i
  LEFT JOIN fin_parties p ON p.id = i.party_id
  LEFT JOIN fin_entries e ON e.id = i.entry_id`;

function view(row) {
  const total = Number(row.total), paid = Number(row.paid_minor);
  let status = row.status;
  if (status === 'issued') {
    if (row.entry_reversed_by) status = 'cancelled'; // عُكس قيدها من دفتر اليومية مباشرة
    else if (paid >= total) status = 'paid';
    else if (paid > 0) status = 'partial';
  }
  return {
    id: row.id, no: row.no, kind: row.kind, partyName: row.party_name || 'غير محدد', issueDay: row.issue_day,
    description: row.description, total: fromMinor(total), paidAmount: fromMinor(paid), status, entryId: row.entry_id,
  };
}

const load = (db, id) => {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(Number(id));
  if (!row) throw bad('الفاتورة غير موجودة.', 404, 'not_found');
  return row;
};

function postInvoice(deps, actor, inv, ip) {
  const amount = fromMinor(Number(inv.total));
  const note = inv.description, partyId = inv.party_id;
  const lines = inv.kind === 'sale'
    ? [{ accountId: inv.settle_account_id, debit: amount, credit: 0, partyId, note }, { accountId: inv.counter_account_id, debit: 0, credit: amount, partyId, note }]
    : [{ accountId: inv.counter_account_id, debit: amount, credit: 0, partyId, note }, { accountId: inv.settle_account_id, debit: 0, credit: amount, partyId, note }];
  return createEntry(deps, actor, { day: inv.issue_day, reference: inv.no, description: inv.description, lines, post: true }, ip, { type: 'JV', post: true, system: true });
}

export function listInvoices({ db }) {
  ready(db);
  return db.prepare(`${SELECT} ORDER BY i.id DESC LIMIT 200`).all().map(view);
}

export function createInvoice(deps, actor, b, ip) {
  const { db } = deps; ready(db);
  const kind = b?.kind ?? 'sale', def = KINDS[kind];
  if (!def) throw bad('نوع الفاتورة غير صالح.');
  const day = String(b?.issueDay || today());
  if (!isDay(day)) throw bad('تاريخ الفاتورة غير صالح.');
  const party = db.prepare('SELECT id, name FROM fin_parties WHERE id = ?').get(Number(b?.partyId));
  if (!party) throw bad('يرجى اختيار طرف مالي صحيح للفاتورة.');
  const items = Array.isArray(b?.lines) ? b.lines : [];
  if (!items.length) throw bad('يجب أن تحتوي الفاتورة على بند واحد على الأقل.');
  for (const l of items) {
    if (!(Number(l?.qty) > 0) || !(Number(l?.unitPrice) > 0)) throw bad('كمية وسعر كل بند يجب أن يكونا أكبر من صفر.');
  }
  const total = toMinor(items.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0));
  if (!Number.isSafeInteger(total) || total <= 0) throw bad('مجموع الفاتورة غير صالح.');

  let counterId = sysAccount(db, def.counter).id;
  if (b?.counterAccountId) {
    const acc = db.prepare('SELECT id, type FROM fin_accounts WHERE id = ? AND active = 1 AND postable = 1').get(Number(b.counterAccountId));
    if (!acc) throw bad('حساب الفاتورة غير صالح أو غير نهائي.');
    if (!def.counterTypes.includes(acc.type)) throw bad(kind === 'sale' ? 'فاتورة المبيعات تُرحَّل إلى حساب إيراد.' : 'فاتورة المشتريات تُرحَّل إلى حساب مصروف أو أصل.');
    counterId = acc.id;
  }
  const description = `فاتورة ${def.label}: ${party.name} — ${String(items[0].description || 'خدمات').trim()}`.slice(0, 300);
  const id = Number(db.prepare(`INSERT INTO fin_invoices (no, kind, party_id, issue_day, description, total, status, settle_account_id, counter_account_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
    .run(docNo('INV'), kind, party.id, day, description, total, sysAccount(db, def.settle).id, counterId, actor?.id ?? null, Date.now()).lastInsertRowid);
  audit(db, actor, 'إنشاء فاتورة', `${kind} #${id} ${fromMinor(total)}`, ip);
  if (b?.issue === false) return view(load(db, id));
  // createEntry يفتح معاملته الخاصة، لذا تُحذف الفاتورة إن فشل ترحيلها
  try { return issueInvoice(deps, actor, id, ip); }
  catch (err) { db.prepare('DELETE FROM fin_invoices WHERE id = ?').run(id); throw err; }
}

export function issueInvoice(deps, actor, id, ip) {
  const { db } = deps; ready(db);
  const inv = load(db, id);
  if (inv.status !== 'draft') throw bad('تُصدر الفاتورة المسودة فقط.', 409, 'conflict');
  const entry = postInvoice(deps, actor, inv, ip);
  db.prepare("UPDATE fin_invoices SET status = 'issued', entry_id = ? WHERE id = ?").run(entry.id, inv.id);
  audit(db, actor, 'إصدار فاتورة', `${inv.no} ← القيد ${entry.no}`, ip);
  return view(load(db, inv.id));
}

export function cancelInvoice(deps, actor, id, ip) {
  const { db } = deps; ready(db);
  const inv = load(db, id), cur = view(inv);
  if (cur.status === 'cancelled') throw bad('الفاتورة ملغاة مسبقاً.', 409, 'conflict');
  if (cur.paidAmount > 0) throw bad('لا تُلغى فاتورة عليها دفعات؛ اعكس سندات الدفع أولاً.', 409, 'conflict');
  if (inv.entry_id) reverseEntry(deps, actor, inv.entry_id, { reason: `إلغاء الفاتورة ${inv.no}` }, ip);
  db.prepare("UPDATE fin_invoices SET status = 'cancelled' WHERE id = ?").run(inv.id);
  audit(db, actor, 'إلغاء فاتورة', inv.no, ip);
  return view(load(db, inv.id));
}

export function payInvoice(deps, actor, id, b, ip) {
  const { db } = deps; ready(db);
  const inv = load(db, id), cur = view(inv), def = KINDS[inv.kind];
  if (!['issued', 'partial'].includes(cur.status)) throw bad('تُسدَّد الفاتورة الصادرة غير المسددة فقط.', 409, 'conflict');
  const amount = toMinor(b?.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw bad('مبلغ الدفعة يجب أن يكون أكبر من صفر.');
  if (amount > Number(inv.total) - Number(inv.paid_minor)) throw bad('مبلغ الدفعة يتجاوز المتبقي على الفاتورة.');
  const day = String(b?.day || today());
  if (!isDay(day)) throw bad('تاريخ الدفعة غير صالح.');
  const cash = b?.cashAccountId
    ? db.prepare("SELECT id FROM fin_accounts WHERE id = ? AND active = 1 AND postable = 1 AND type = 'asset'").get(Number(b.cashAccountId))
    : sysAccount(db, 'cash');
  if (!cash) throw bad('حساب الصندوق أو المصرف غير صالح.');
  const value = fromMinor(amount), note = `تسديد ${inv.no}`, partyId = inv.party_id;
  const lines = inv.kind === 'sale'
    ? [{ accountId: cash.id, debit: value, credit: 0, partyId, note }, { accountId: inv.settle_account_id, debit: 0, credit: value, partyId, note }]
    : [{ accountId: inv.settle_account_id, debit: value, credit: 0, partyId, note }, { accountId: cash.id, debit: 0, credit: value, partyId, note }];
  createEntry(deps, actor, { day, reference: inv.no, description: `${note} — ${inv.party_name || 'غير محدد'}`, lines, post: true }, ip, { type: def.payType, post: true, system: true });
  audit(db, actor, 'تسديد فاتورة', `${inv.no} — ${value}`, ip);
  return view(load(db, inv.id));
}
