// فواتير المبيعات والمشتريات: المبيعات ذمم مدينة وإيراد، والمشتريات مصروف وذمم دائنة.
// المسدد لا يُخزَّن بل يُحسب من سندات القبض والصرف غير المعكوسة، فيبقى مطابقًا لدفتر الأستاذ.
import { audit } from '../../audit.js';
import { docNo } from '../../lib/doc_no.js';
import { bad, ready, sysAccount, createEntry, reverseEntry, fromMinor, toMinor, isDay, today } from './core.js';
import { getSetting, saveSettings } from '../settings.js';

const KINDS = {
  sale: { settle: 'debtors', counter: 'rev_services', settleTypes: ['asset'], counterTypes: ['revenue'], settleCode: '1203', counterCode: '4203', payType: 'RV', label: 'مبيعات' },
  purchase: { settle: 'suppliers', counter: 'general_exp', settleTypes: ['liability'], counterTypes: ['expense', 'asset'], settleCode: '2101', counterCode: '5401', payType: 'PV', label: 'مشتريات' },
};
const settingKey = (kind, role) => `finance.invoice_${kind}_${role}`;
const ROLE_NAME = { settle: 'الذمة', counter: 'الإيراد أو المصروف' };
const usable = (acc, types) => !!acc && !!acc.active && !!acc.postable && types.includes(acc.type);

// الحساب الافتراضي للفاتورة من الإعدادات. الرمز الافتراضي غير الموجود (دليل حسابات مخصص) يعود إلى الحساب الوظيفي
function defaultAccount(db, kind, role) {
  const def = KINDS[kind], code = String(getSetting(db, settingKey(kind, role))), types = def[`${role}Types`];
  const acc = db.prepare('SELECT * FROM fin_accounts WHERE code = ?').get(code);
  if (!acc && code === def[`${role}Code`]) return sysAccount(db, def[role]);
  if (!usable(acc, types)) throw bad(`حساب ${ROLE_NAME[role]} الافتراضي لفواتير ${def.label} (${code}) غير صالح؛ عدّله من إعدادات الفواتير.`, 409, 'conflict');
  return acc;
}

export function invoiceDefaults({ db }) {
  ready(db);
  const one = (kind, role) => {
    const code = String(getSetting(db, settingKey(kind, role)));
    const acc = db.prepare('SELECT code, name, active, postable, type FROM fin_accounts WHERE code = ?').get(code);
    return { code, name: acc?.name ?? null, valid: usable(acc, KINDS[kind][`${role}Types`]), types: KINDS[kind][`${role}Types`] };
  };
  return { sale: { settle: one('sale', 'settle'), counter: one('sale', 'counter') }, purchase: { settle: one('purchase', 'settle'), counter: one('purchase', 'counter') } };
}

export function saveInvoiceDefaults(deps, actor, b, ip) {
  const { db } = deps; ready(db);
  const values = {};
  for (const kind of Object.keys(KINDS)) {
    for (const role of ['settle', 'counter']) {
      const v = b?.[kind]?.[role];
      if (v === undefined) continue;
      const code = String(v).trim(), acc = db.prepare('SELECT * FROM fin_accounts WHERE code = ?').get(code);
      if (!usable(acc, KINDS[kind][`${role}Types`])) throw bad(`الحساب ${code || '(فارغ)'} لا يصلح حساب ${ROLE_NAME[role]} لفواتير ${KINDS[kind].label}.`);
      values[settingKey(kind, role)] = code;
    }
  }
  if (Object.keys(values).length) saveSettings(deps, actor, { values }, ip);
  return invoiceDefaults(deps);
}

const SELECT = `SELECT i.*, p.name AS party_name, e.reversed_by AS entry_reversed_by, po.no AS order_no,
    (SELECT COALESCE(SUM(l.debit), 0) FROM fin_lines l JOIN fin_entries pe ON pe.id = l.entry_id
      WHERE pe.reference = i.no AND pe.type IN ('RV', 'PV') AND pe.status = 'posted' AND pe.reversed_by IS NULL) AS paid_minor
  FROM fin_invoices i
  LEFT JOIN fin_parties p ON p.id = i.party_id
  LEFT JOIN fin_entries e ON e.id = i.entry_id
  LEFT JOIN proc_orders po ON po.id = i.order_id`;

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
    orderId: row.order_id ?? null, orderNo: row.order_no ?? null, supplierRef: row.supplier_ref || '', matchStatus: row.match_status ?? null, matchNote: row.match_note || '',
  };
}

const load = (db, id) => {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(Number(id));
  if (!row) throw bad('الفاتورة غير موجودة.', 404, 'not_found');
  return row;
};

// فاتورة أمر التوريد: الاستلام أثبت الذمة بسعر الأمر، فتُرحَّل الفاتورة بفرق السعر وبنود الخدمات فقط (post_amount)
function postInvoice(deps, actor, inv, ip) {
  const net = inv.post_amount === null || inv.post_amount === undefined ? Number(inv.total) : Number(inv.post_amount);
  if (net === 0) return null;
  const amount = fromMinor(Math.abs(net)), up = net > 0;
  const note = inv.description, partyId = inv.party_id, costCenterId = inv.cost_center_id ?? null;
  const lines = inv.kind === 'sale'
    ? [{ accountId: inv.settle_account_id, debit: amount, credit: 0, partyId, note }, { accountId: inv.counter_account_id, debit: 0, credit: amount, partyId, note }]
    : [{ accountId: inv.counter_account_id, debit: up ? amount : 0, credit: up ? 0 : amount, partyId, note, costCenterId }, { accountId: inv.settle_account_id, debit: up ? 0 : amount, credit: up ? amount : 0, partyId, note }];
  return createEntry(deps, actor, { day: inv.issue_day, reference: inv.no, description: inv.description, lines, post: true }, ip, { type: 'JV', post: true, system: true, ...(inv.order_id ? { source: `po_invoice:${inv.id}` } : {}) });
}

export function listInvoices({ db }) {
  ready(db);
  return db.prepare(`${SELECT} ORDER BY i.id DESC LIMIT 200`).all().map(view);
}

export function createInvoice(deps, actor, b, ip) {
  const { db } = deps; ready(db);
  const kind = b?.kind ?? 'sale', def = KINDS[kind];
  if (!def) throw bad('نوع الفاتورة غير صالح.');
  if (kind === 'purchase' && b?.orderId) return createOrderInvoice(deps, actor, b, ip);
  if (kind === 'purchase' && getSetting(db, 'finance.purchase_requires_po')) throw bad('فواتير المشتريات تُسجَّل على أمر توريد فقط.', 409, 'po_required');
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

  let counterId = b?.counterAccountId ? null : defaultAccount(db, kind, 'counter').id;
  if (b?.counterAccountId) {
    const acc = db.prepare('SELECT id, type FROM fin_accounts WHERE id = ? AND active = 1 AND postable = 1').get(Number(b.counterAccountId));
    if (!acc) throw bad('حساب الفاتورة غير صالح أو غير نهائي.');
    if (!def.counterTypes.includes(acc.type)) throw bad(kind === 'sale' ? 'فاتورة المبيعات تُرحَّل إلى حساب إيراد.' : 'فاتورة المشتريات تُرحَّل إلى حساب مصروف أو أصل.');
    counterId = acc.id;
  }
  const description = `فاتورة ${def.label}: ${party.name} — ${String(items[0].description || 'خدمات').trim()}`.slice(0, 300);
  const id = Number(db.prepare(`INSERT INTO fin_invoices (no, kind, party_id, issue_day, description, total, status, settle_account_id, counter_account_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
    .run(docNo('INV'), kind, party.id, day, description, total, defaultAccount(db, kind, 'settle').id, counterId, actor?.id ?? null, Date.now()).lastInsertRowid);
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
  if (inv.match_status === 'held') throw bad(`الفاتورة موقوفة لعدم مطابقتها أمر التوريد والاستلام: ${inv.match_note}`, 409, 'match_held');
  const entry = postInvoice(deps, actor, inv, ip);
  db.prepare("UPDATE fin_invoices SET status = 'issued', entry_id = ? WHERE id = ?").run(entry?.id ?? null, inv.id);
  audit(db, actor, 'إصدار فاتورة', entry ? `${inv.no} ← القيد ${entry.no}` : `${inv.no} (الذمة مثبتة بالاستلام)`, ip);
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

/* ===== فواتير المورّدين على أوامر التوريد: المطابقة الثلاثية ===== */
const LIVE_ORDER = ['ordered', 'received'];

// طرف مالي للمورّد بالاسم نفسه، يُنشأ عند أول فاتورة له
function supplierParty(db, order) {
  const p = db.prepare("SELECT id FROM fin_parties WHERE kind = 'supplier' AND name = ? ORDER BY id LIMIT 1").get(order.supplier_name);
  if (p) return Number(p.id);
  return Number(db.prepare("INSERT INTO fin_parties (kind, name, active, created_at) VALUES ('supplier', ?, 1, ?) RETURNING id").get(order.supplier_name, Date.now()).id);
}

const receivedQty = (db, orderId, itemId) => Number(db.prepare('SELECT COALESCE(SUM(rl.qty), 0) AS q FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id = rl.receipt_id WHERE r.order_id = ? AND rl.item_id = ?').get(orderId, itemId).q);
const invoicedQty = (db, orderId, line, exceptId) => Number(db.prepare(`SELECT COALESCE(SUM(il.qty), 0) AS q FROM fin_invoice_lines il JOIN fin_invoices i ON i.id = il.invoice_id
  WHERE i.order_id = ? AND i.status <> 'cancelled' AND i.id <> ? AND ${line.item_id ? 'il.item_id = ?' : 'il.order_line_id = ?'}`).get(orderId, exceptId, line.item_id ?? line.id).q);

// أمر التوريد مع ما استُلم وما فوتر من كل بند، لشاشة تسجيل الفاتورة
export function matchableOrders({ db }) {
  ready(db);
  return db.prepare(`SELECT o.*, s.name AS supplier_name FROM proc_orders o JOIN proc_suppliers s ON s.id = o.supplier_id WHERE o.status IN ('ordered', 'received') ORDER BY o.id DESC LIMIT 200`).all().map((o) => ({
    id: Number(o.id), no: o.no, supplier: o.supplier_name, status: o.status, total: Number(o.total_amount),
    lines: db.prepare('SELECT * FROM proc_order_lines WHERE order_id = ? ORDER BY id').all(o.id).map((l) => ({
      id: Number(l.id), description: l.description, itemId: l.item_id, qty: Number(l.qty), unitCost: Number(l.unit_cost),
      received: l.item_id ? receivedQty(db, o.id, l.item_id) : null, invoiced: invoicedQty(db, o.id, l, 0),
    })),
  }));
}

// أسباب عدم المطابقة: كمية تتجاوز المستلم (أو المطلوب للخدمات)، أو سعر يتجاوز سعر الأمر بأكثر من المسموح
function matchReasons(db, orderId, lines, exceptId = 0) {
  const tol = Number(getSetting(db, 'finance.match_price_tolerance')) / 100, out = [];
  for (const l of lines) {
    const ol = l.orderLine, limit = ol.item_id ? receivedQty(db, orderId, ol.item_id) : Number(ol.qty);
    const before = invoicedQty(db, orderId, ol, exceptId);
    if (before + l.qty > limit) out.push(`«${ol.description}»: المفوتر ${before + l.qty} و${ol.item_id ? 'المستلم' : 'المطلوب'} ${limit}`);
    const max = Math.round(Number(ol.unit_cost) * 100 * (1 + tol));
    if (l.unitPrice > max) out.push(`«${ol.description}»: السعر ${fromMinor(l.unitPrice)} أعلى من سعر الأمر ${Number(ol.unit_cost)}`);
  }
  return out;
}

// ما أثبته الاستلام من ذمة هذه الفاتورة: لا يتجاوز قيود الاستلام المرحّلة غير المستهلكة بفواتير سابقة
function receivedBase(db, orderId, lines, exceptId = 0) {
  let atCost = 0;
  for (const l of lines) {
    if (!l.orderLine.item_id) continue;
    const free = Math.max(0, receivedQty(db, orderId, l.orderLine.item_id) - invoicedQty(db, orderId, l.orderLine, exceptId));
    atCost += Math.min(l.qty, free) * Number(l.orderLine.unit_cost) * 100;
  }
  const posted = Number(db.prepare(`SELECT COALESCE(SUM(fl.credit), 0) AS v FROM fin_lines fl JOIN fin_entries e ON e.id = fl.entry_id
    JOIN proc_receipts r ON e.source = 'proc_receipt:' || r.id WHERE r.order_id = ? AND e.status = 'posted'`).get(orderId).v);
  const used = Number(db.prepare("SELECT COALESCE(SUM(received_base), 0) AS v FROM fin_invoices WHERE order_id = ? AND status <> 'cancelled' AND id <> ?").get(orderId, exceptId).v);
  return Math.min(atCost, Math.max(0, posted - used));
}

function invoiceLines(db, inv) {
  return db.prepare('SELECT il.*, ol.description AS ol_description, ol.item_id AS ol_item_id, ol.qty AS ol_qty, ol.unit_cost AS ol_unit_cost, ol.id AS ol_id FROM fin_invoice_lines il JOIN proc_order_lines ol ON ol.id = il.order_line_id WHERE il.invoice_id = ? ORDER BY il.id').all(inv.id)
    .map((r) => ({ qty: Number(r.qty), unitPrice: Number(r.unit_price), orderLine: { id: r.ol_id, description: r.ol_description, item_id: r.ol_item_id, qty: r.ol_qty, unit_cost: r.ol_unit_cost } }));
}

function createOrderInvoice(deps, actor, b, ip) {
  const { db } = deps;
  const order = db.prepare('SELECT o.*, s.name AS supplier_name FROM proc_orders o JOIN proc_suppliers s ON s.id = o.supplier_id WHERE o.id = ?').get(Number(b.orderId));
  if (!order) throw bad('أمر التوريد غير موجود.', 404, 'not_found');
  if (!LIVE_ORDER.includes(order.status)) throw bad('تُسجَّل فاتورة المورّد على أمر توريد مُرسل فقط.', 409, 'conflict');
  const day = String(b?.issueDay || today());
  if (!isDay(day)) throw bad('تاريخ الفاتورة غير صالح.');
  const raw = Array.isArray(b?.lines) ? b.lines : [];
  const lines = raw.map((l, i) => {
    const orderLine = db.prepare('SELECT * FROM proc_order_lines WHERE id = ? AND order_id = ?').get(Number(l?.orderLineId), order.id);
    if (!orderLine) throw bad(`البند ${i + 1} ليس من بنود أمر التوريد.`);
    const qty = Number(l?.qty), unitPrice = toMinor(l?.unitPrice);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isSafeInteger(unitPrice) || unitPrice <= 0) throw bad(`البند ${i + 1}: الكمية والسعر يجب أن يكونا أكبر من صفر.`);
    return { orderLine, qty, unitPrice };
  }).filter((l) => l.qty > 0);
  if (!lines.length) throw bad('أدخل كمية بند واحد على الأقل.');
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const reasons = matchReasons(db, order.id, lines), base = receivedBase(db, order.id, lines);
  const budget = order.budget_id ? db.prepare('SELECT account_id, cost_center_id FROM fin_budgets WHERE id = ?').get(order.budget_id) : null;
  const ref = String(b?.supplierRef ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const description = `فاتورة مورّد ${order.supplier_name} على أمر التوريد ${order.no}${ref ? ` (رقمها ${ref})` : ''}`.slice(0, 300);
  const id = Number(db.prepare(`INSERT INTO fin_invoices (no, kind, party_id, issue_day, description, total, status, settle_account_id, counter_account_id, created_by, created_at,
      order_id, supplier_ref, cost_center_id, match_status, match_note, post_amount, received_base) VALUES (?, 'purchase', ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(docNo('INV'), supplierParty(db, order), day, description, total, defaultAccount(db, 'purchase', 'settle').id, budget?.account_id ?? defaultAccount(db, 'purchase', 'counter').id,
      actor?.id ?? null, Date.now(), order.id, ref, budget?.cost_center_id ?? null, reasons.length ? 'held' : 'matched', reasons.join('؛ '), total - base, base).id);
  const ins = db.prepare('INSERT INTO fin_invoice_lines (invoice_id, order_line_id, item_id, description, qty, unit_price) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of lines) ins.run(id, l.orderLine.id, l.orderLine.item_id ?? null, l.orderLine.description, l.qty, l.unitPrice);
  audit(db, actor, reasons.length ? 'تسجيل فاتورة مورّد موقوفة للمطابقة' : 'تسجيل فاتورة مورّد مطابقة', `${order.no}: ${fromMinor(total)}${reasons.length ? ` — ${reasons.join('؛ ')}` : ''}`.slice(0, 300), ip);
  if (reasons.length || b?.issue === false) return view(load(db, id));
  try { return issueInvoice(deps, actor, id, ip); }
  catch (err) { db.prepare('DELETE FROM fin_invoices WHERE id = ?').run(id); throw err; }
}

// إعادة المطابقة بعد استلام لاحق أو تعديل الإعداد؛ المطابقة تُصدر الفاتورة
export function recheckInvoice(deps, actor, id, ip) {
  const { db } = deps; ready(db);
  const inv = load(db, id);
  if (!inv.order_id) throw bad('الفاتورة ليست على أمر توريد.', 409, 'conflict');
  if (inv.status !== 'draft' || inv.match_status !== 'held') throw bad('تُعاد مطابقة الفاتورة الموقوفة فقط.', 409, 'conflict');
  const lines = invoiceLines(db, inv), reasons = matchReasons(db, inv.order_id, lines, inv.id), base = receivedBase(db, inv.order_id, lines, inv.id);
  db.prepare('UPDATE fin_invoices SET match_status = ?, match_note = ?, post_amount = ?, received_base = ? WHERE id = ?').run(reasons.length ? 'held' : 'matched', reasons.join('؛ '), Number(inv.total) - base, base, inv.id);
  if (reasons.length) return view(load(db, inv.id));
  audit(db, actor, 'مطابقة فاتورة مورّد بعد الاستلام', inv.no, ip);
  return issueInvoice(deps, actor, inv.id, ip);
}

export function recheckOrderInvoices(deps, actor, orderId, ip) {
  const { db } = deps;
  for (const r of db.prepare("SELECT id FROM fin_invoices WHERE order_id = ? AND status = 'draft' AND match_status = 'held'").all(Number(orderId))) {
    try { recheckInvoice(deps, actor, r.id, ip); } catch { /* تبقى موقوفة */ }
  }
}

// اعتماد الفاتورة رغم الفرق: من غير مسجّلها، وبسبب مكتوب
export function overrideMatch(deps, actor, id, b, ip) {
  const { db } = deps; ready(db);
  const inv = load(db, id);
  if (inv.status !== 'draft' || inv.match_status !== 'held') throw bad('يُعتمد رغم الفرق ما كان موقوفاً فقط.', 409, 'conflict');
  if (inv.created_by && Number(inv.created_by) === Number(actor.id)) throw bad('لا يعتمد الفرق من سجّل الفاتورة (فصل المهام).', 403, 'forbidden');
  const reason = String(b?.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 5) throw bad('اكتب سبب اعتماد الفاتورة رغم الفرق.');
  db.prepare("UPDATE fin_invoices SET match_status = 'override', match_note = ?, match_by = ? WHERE id = ?").run(`${inv.match_note} — اعتُمدت رغم الفرق: ${reason}`.slice(0, 600), actor.id ?? null, inv.id);
  audit(db, actor, 'اعتماد فاتورة مورّد رغم عدم المطابقة', `${inv.no}: ${reason}`.slice(0, 300), ip);
  return issueInvoice(deps, actor, inv.id, ip);
}
