// الموازنة: مخصص لكل مركز كلفة وحساب مصروف في السنة المالية، يُقارن بما استُهلك فعلاً.
// المستهلك = أوامر التوريد المرتبطة بالبند (قيمتها أو ما فوتر منها إن زاد) + الصرف المباشر المرحّل على الحساب ومركز الكلفة.
// قيود فواتير أوامر التوريد تحمل المصدر po_invoice: فلا تُحسب مرتين.
import { audit } from '../../audit.js';
import { getSetting } from '../settings.js';
import { bad, ready, fromMinor, toMinor } from './core.js';

const LIVE_ORDERS = "('ordered', 'received')";

const SELECT = `SELECT b.*, y.name AS year_name, y.status AS year_status, c.code AS cc_code, c.name AS cc_name, a.code AS acc_code, a.name AS acc_name,
    COALESCE((SELECT SUM(t.amount) FROM fin_budget_transfers t WHERE t.to_budget_id = b.id), 0) AS t_in,
    COALESCE((SELECT SUM(t.amount) FROM fin_budget_transfers t WHERE t.from_budget_id = b.id), 0) AS t_out,
    COALESCE((SELECT SUM(l.debit - l.credit) FROM fin_lines l JOIN fin_entries e ON e.id = l.entry_id
      WHERE e.status = 'posted' AND e.year_id = b.year_id AND l.account_id = b.account_id AND l.cost_center_id = b.cost_center_id
        AND COALESCE(e.source, '') NOT LIKE 'po_invoice:%'), 0) AS direct_actual,
    COALESCE((SELECT SUM(o.total_amount) * 100 FROM proc_orders o WHERE o.budget_id = b.id AND o.status IN ${LIVE_ORDERS}), 0) AS po_total,
    COALESCE((SELECT SUM(GREATEST(inv.v - o.total_amount * 100, 0)) FROM proc_orders o
      JOIN (SELECT i.order_id, SUM(i.total) AS v FROM fin_invoices i WHERE i.status = 'issued' GROUP BY i.order_id) inv ON inv.order_id = o.id
      WHERE o.budget_id = b.id AND o.status IN ${LIVE_ORDERS}), 0) AS po_over,
    COALESCE((SELECT SUM(LEAST(inv.v, o.total_amount * 100)) FROM proc_orders o
      JOIN (SELECT i.order_id, SUM(i.total) AS v FROM fin_invoices i WHERE i.status = 'issued' GROUP BY i.order_id) inv ON inv.order_id = o.id
      WHERE o.budget_id = b.id AND o.status IN ${LIVE_ORDERS}), 0) AS po_invoiced
  FROM fin_budgets b JOIN fin_years y ON y.id = b.year_id JOIN fin_cost_centers c ON c.id = b.cost_center_id JOIN fin_accounts a ON a.id = b.account_id`;

function figures(r) {
  const allotted = Number(r.amount) + Number(r.t_in) - Number(r.t_out);
  const invoiced = Number(r.po_invoiced) + Number(r.po_over), reserved = Number(r.po_total) - Number(r.po_invoiced);
  const spent = Number(r.direct_actual) + invoiced, consumed = spent + reserved;
  return { allotted, reserved, spent, consumed, available: allotted - consumed };
}
const view = (r) => {
  const f = figures(r);
  return {
    id: Number(r.id), yearId: Number(r.year_id), yearName: r.year_name, costCenterId: Number(r.cost_center_id), costCenter: `${r.cc_code} — ${r.cc_name}`,
    accountId: Number(r.account_id), account: `${r.acc_code} — ${r.acc_name}`, status: r.status, note: r.note,
    amount: fromMinor(Number(r.amount)), transfersIn: fromMinor(Number(r.t_in)), transfersOut: fromMinor(Number(r.t_out)),
    allotted: fromMinor(f.allotted), reserved: fromMinor(f.reserved), spent: fromMinor(f.spent), available: fromMinor(f.available),
    usedPercent: f.allotted > 0 ? Math.round((f.consumed / f.allotted) * 1000) / 10 : 0, createdBy: r.created_by,
  };
};

const loadRow = (db, id) => {
  const r = db.prepare(`${SELECT} WHERE b.id = ?`).get(Number(id));
  if (!r) throw bad('بند الموازنة غير موجود.', 404, 'not_found');
  return r;
};
export const availableFor = (db, id) => figures(loadRow(db, id)).available;

export function listBudgets({ db }, q = {}) {
  ready(db);
  const years = db.prepare('SELECT id, name, status FROM fin_years ORDER BY start_day DESC').all();
  const yearId = Number(q.yearId) || years.find((y) => y.status === 'open')?.id || years[0]?.id || 0;
  const rows = db.prepare(`${SELECT} WHERE b.year_id = ? ORDER BY c.code, a.code`).all(yearId).map(view);
  const sum = (k) => rows.filter((r) => r.status === 'approved').reduce((s, r) => s + toMinor(r[k]), 0);
  return {
    yearId, years, budgets: rows,
    totals: { allotted: fromMinor(sum('allotted')), reserved: fromMinor(sum('reserved')), spent: fromMinor(sum('spent')), available: fromMinor(sum('available')) },
    transfers: db.prepare(`SELECT t.*, u.display_name AS by_name FROM fin_budget_transfers t LEFT JOIN users u ON u.id = t.created_by
      JOIN fin_budgets f ON f.id = t.from_budget_id WHERE f.year_id = ? ORDER BY t.id DESC LIMIT 100`).all(yearId)
      .map((t) => ({ id: Number(t.id), fromId: Number(t.from_budget_id), toId: Number(t.to_budget_id), amount: fromMinor(Number(t.amount)), reason: t.reason, by: t.by_name, at: Number(t.created_at) })),
  };
}

// بنود معتمدة في سنة مفتوحة، للاختيار عند إنشاء أمر توريد
export function approvedBudgets({ db }) {
  ready(db);
  return db.prepare(`${SELECT} WHERE b.status = 'approved' AND y.status = 'open' ORDER BY c.code, a.code`).all().map((r) => {
    const v = view(r);
    return { id: v.id, label: `${v.costCenter} / ${v.account} (${v.yearName})`, available: v.available };
  });
}

export function saveBudget({ db }, actor, b, ip) {
  ready(db);
  const year = db.prepare('SELECT * FROM fin_years WHERE id = ?').get(Number(b?.yearId));
  if (!year || year.status !== 'open') throw bad('السنة المالية غير موجودة أو مغلقة.');
  const cc = db.prepare('SELECT * FROM fin_cost_centers WHERE id = ? AND active = 1').get(Number(b?.costCenterId));
  if (!cc) throw bad('مركز الكلفة غير موجود أو معطّل.');
  const acc = db.prepare("SELECT * FROM fin_accounts WHERE id = ? AND active = 1 AND postable = 1 AND type = 'expense'").get(Number(b?.accountId));
  if (!acc) throw bad('بند الموازنة يكون على حساب مصروف نهائي ومفعّل.');
  const amount = toMinor(b?.amount);
  if (!Number.isSafeInteger(amount) || amount < 0) throw bad('مبلغ الموازنة غير صالح.');
  const note = String(b?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const cur = db.prepare('SELECT * FROM fin_budgets WHERE year_id = ? AND cost_center_id = ? AND account_id = ?').get(year.id, cc.id, acc.id);
  if (cur && cur.status === 'approved') throw bad('البند معتمد؛ يُعدَّل مبلغه بالمناقلة فقط.', 409, 'conflict');
  let id;
  if (cur) { db.prepare('UPDATE fin_budgets SET amount = ?, note = ? WHERE id = ?').run(amount, note, cur.id); id = cur.id; }
  else id = Number(db.prepare('INSERT INTO fin_budgets (year_id, cost_center_id, account_id, amount, note, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id').get(year.id, cc.id, acc.id, amount, note, actor.id ?? null, Date.now()).id);
  audit(db, actor, cur ? 'تعديل بند موازنة' : 'إضافة بند موازنة', `${year.name} ${cc.code}/${acc.code}: ${fromMinor(amount)}`, ip);
  return view(loadRow(db, id));
}

// الاعتماد من غير معدّ البند
export function approveBudget({ db }, actor, id, ip) {
  const r = loadRow(db, id);
  if (r.status !== 'draft') throw bad('البند معتمد مسبقاً.', 409, 'conflict');
  if (r.created_by && Number(r.created_by) === Number(actor.id)) throw bad('لا يعتمد البند من أعدّه (فصل المهام).', 403, 'forbidden');
  db.prepare("UPDATE fin_budgets SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(actor.id ?? null, Date.now(), r.id);
  audit(db, actor, 'اعتماد بند موازنة', `${r.year_name} ${r.cc_code}/${r.acc_code}`, ip);
  return view(loadRow(db, r.id));
}

export function transferBudget({ db }, actor, b, ip) {
  const from = loadRow(db, b?.fromId), to = loadRow(db, b?.toId);
  if (from.id === to.id) throw bad('اختر بندين مختلفين.');
  if (from.status !== 'approved' || to.status !== 'approved') throw bad('المناقلة بين بنود معتمدة فقط.', 409, 'conflict');
  if (from.year_id !== to.year_id || from.year_status !== 'open') throw bad('المناقلة داخل سنة مالية مفتوحة واحدة.', 409, 'conflict');
  const amount = toMinor(b?.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw bad('مبلغ المناقلة غير صالح.');
  const avail = figures(from).available;
  if (amount > avail) throw bad(`المتاح في البند المنقول منه ${fromMinor(avail)} فقط.`, 409, 'budget_exceeded');
  const reason = String(b?.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 3) throw bad('سبب المناقلة مطلوب.');
  db.prepare('INSERT INTO fin_budget_transfers (from_budget_id, to_budget_id, amount, reason, created_by, created_at) VALUES (?,?,?,?,?,?)').run(from.id, to.id, amount, reason.slice(0, 300), actor.id ?? null, Date.now());
  audit(db, actor, 'مناقلة بين بنود الموازنة', `${from.cc_code}/${from.acc_code} -> ${to.cc_code}/${to.acc_code}: ${fromMinor(amount)}`, ip);
  return { from: view(loadRow(db, from.id)), to: view(loadRow(db, to.id)) };
}

// فحص أمر التوريد قبل إرساله: المنع أو التحذير أو الإيقاف حسب الإعداد
export function checkOrderBudget(db, order) {
  if (!order.budget_id) {
    if (getSetting(db, 'finance.po_requires_budget')) throw bad('اختر بند الموازنة لأمر التوريد قبل إرساله.', 409, 'budget_required');
    return null;
  }
  const r = loadRow(db, order.budget_id);
  if (r.status !== 'approved' || r.year_status !== 'open') throw bad('بند الموازنة غير معتمد أو سنته مغلقة.', 409, 'conflict');
  const mode = getSetting(db, 'finance.budget_control'), need = Number(order.total_amount) * 100, avail = figures(r).available;
  if (mode === 'off' || need <= avail) return null;
  const msg = `قيمة الأمر ${fromMinor(need)} تتجاوز المتاح في بند الموازنة (${fromMinor(avail)}).`;
  if (mode === 'block') throw bad(msg, 409, 'budget_exceeded');
  return msg;
}

export function validBudgetForOrder(db, id) {
  if (!id) return null;
  const r = loadRow(db, id);
  if (r.status !== 'approved' || r.year_status !== 'open') throw bad('بند الموازنة غير معتمد أو سنته مغلقة.', 409, 'conflict');
  return Number(r.id);
}
