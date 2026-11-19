/* تقارير المشتريات والمخازن الناقصة (تقرير المشتريات 8.2)
   الأصناف الراكدة، والاستهلاك حسب القسم، والأوامر المتأخرة، وأداء الموردين.
   (بطاقة الصنف والرصيد بتاريخ ومطابقة المخزون مع الحسابات في المراحل 8 و10.) */
import { bad, isDay, today } from './core.js';

const dayStart = (d) => new Date(`${d}T00:00:00+03:00`).getTime();
const dayEnd = (d) => new Date(`${d}T23:59:59.999+03:00`).getTime();
const range = (q) => {
  const to = q.to && isDay(q.to) ? q.to : today();
  const from = q.from && isDay(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
  if (from > to) throw bad('بداية الفترة بعد نهايتها.');
  return { from, to, a: dayStart(from), b: dayEnd(to) };
};

// أصناف لها رصيد ولم يخرج منها شيء (صرف أو تحويل صادر) منذ عدد أيام
export function stagnantItems(db, q = {}) {
  const days = Math.max(30, Math.min(1095, Number(q.days) || 180)), since = Date.now() - days * 86400000;
  const rows = db.prepare(`SELECT i.id, i.code, i.name, i.unit, i.qty_on_hand, i.avg_cost,
      (SELECT MAX(m.created_at) FROM proc_stock_moves m WHERE m.item_id = i.id AND m.kind IN ('issue', 'transfer_out')) last_out,
      (SELECT MAX(m.created_at) FROM proc_stock_moves m WHERE m.item_id = i.id AND m.kind = 'receipt') last_in
    FROM proc_items i WHERE i.qty_on_hand > 0 ORDER BY i.code`).all();
  const items = rows.filter((r) => !r.last_out || Number(r.last_out) < since).map((r) => ({ id: Number(r.id), code: r.code, name: r.name, unit: r.unit, qty: Number(r.qty_on_hand), value: Math.round(Number(r.qty_on_hand) * Number(r.avg_cost)),
    lastOut: r.last_out ? Number(r.last_out) : null, lastIn: r.last_in ? Number(r.last_in) : null, idleDays: r.last_out ? Math.floor((Date.now() - Number(r.last_out)) / 86400000) : null }));
  return { days, items, totalValue: items.reduce((s, x) => s + x.value, 0) };
}

// الاستهلاك حسب القسم: المصروف بمتوسط تكلفته ناقص المرتجع، في الفترة
export function consumption(db, q = {}) {
  const r = range(q);
  const out = db.prepare(`SELECT COALESCE(NULLIF(TRIM(i.department), ''), i.issued_to) dept, m.item_id, it.code, it.name, it.unit, SUM(-m.qty) qty, SUM(-m.qty * m.unit_cost) value
    FROM proc_stock_moves m JOIN proc_issues i ON i.id = m.ref_id AND m.ref_type = 'issue' JOIN proc_items it ON it.id = m.item_id
    WHERE m.kind = 'issue' AND i.reversed_at IS NULL AND m.created_at BETWEEN ? AND ? GROUP BY 1, m.item_id, it.code, it.name, it.unit`).all(r.a, r.b);
  const back = db.prepare(`SELECT r.department dept, l.item_id, SUM(l.qty) qty, SUM(l.qty * l.unit_cost) value FROM proc_return_lines l JOIN proc_returns r ON r.id = l.return_id
    WHERE r.created_at BETWEEN ? AND ? GROUP BY r.department, l.item_id`).all(r.a, r.b);
  const map = new Map();
  for (const x of out) { const k = `${x.dept}|${x.item_id}`; map.set(k, { department: x.dept || '—', itemId: Number(x.item_id), code: x.code, name: x.name, unit: x.unit, qty: Number(x.qty), value: Number(x.value) }); }
  for (const x of back) { const k = `${x.dept}|${x.item_id}`; const e = map.get(k); if (e) { e.qty -= Number(x.qty); e.value -= Number(x.value); } }
  const lines = [...map.values()].filter((x) => x.qty > 1e-9).map((x) => ({ ...x, qty: Math.round(x.qty * 1000) / 1000, value: Math.round(x.value) }));
  const byDept = new Map();
  for (const x of lines) { const d = byDept.get(x.department) || { department: x.department, value: 0, items: 0 }; d.value += x.value; d.items += 1; byDept.set(x.department, d); }
  return { from: r.from, to: r.to, departments: [...byDept.values()].sort((a, b) => b.value - a.value), lines: lines.sort((a, b) => a.department.localeCompare(b.department, 'ar') || b.value - a.value), totalValue: lines.reduce((s, x) => s + x.value, 0) };
}

// أوامر مرسلة تجاوزت تاريخ التوصيل المطلوب، أو مضى على إرسالها أكثر من عدد أيام بلا اكتمال
export function delayedOrders(db, q = {}) {
  const days = Math.max(1, Math.min(365, Number(q.days) || 30)), d0 = today(), old = Date.now() - days * 86400000;
  const rows = db.prepare(`SELECT o.id, o.no, o.delivery_day, o.ordered_at, o.total_amount, s.name supplier,
      (SELECT COALESCE(SUM(qty), 0) FROM proc_order_lines WHERE order_id = o.id) ordered_qty,
      (SELECT COALESCE(SUM(rl.qty), 0) FROM proc_receipt_lines rl JOIN proc_receipts r ON r.id = rl.receipt_id WHERE r.order_id = o.id AND r.reversed_at IS NULL) got_qty
    FROM proc_orders o JOIN proc_suppliers s ON s.id = o.supplier_id WHERE o.status = 'ordered' ORDER BY o.ordered_at`).all();
  const orders = rows.filter((o) => (o.delivery_day && o.delivery_day < d0) || (o.ordered_at && Number(o.ordered_at) < old)).map((o) => ({
    id: Number(o.id), no: o.no, supplier: o.supplier, deliveryDay: o.delivery_day || null, orderedAt: o.ordered_at ? Number(o.ordered_at) : null, total: Number(o.total_amount),
    receivedPct: Number(o.ordered_qty) ? Math.round((Number(o.got_qty) / Number(o.ordered_qty)) * 100) : 0,
    lateDays: o.delivery_day && o.delivery_day < d0 ? Math.floor((dayStart(d0) - dayStart(o.delivery_day)) / 86400000) : null,
    ageDays: o.ordered_at ? Math.floor((Date.now() - Number(o.ordered_at)) / 86400000) : null }));
  return { days, orders };
}

// أداء الموردين: الحجم، ومدة التوريد، والالتزام بالموعد، والاستلامات غير المطابقة، والتقييم
export function supplierPerformance(db, q = {}) {
  const r = range({ ...q, from: q.from || '2000-01-01' });
  const sups = db.prepare(`SELECT s.id, s.code, s.name, COUNT(o.id) orders, COALESCE(SUM(o.total_amount), 0) volume,
      SUM(CASE WHEN o.status = 'received' THEN 1 ELSE 0 END) done,
      AVG(CASE WHEN o.status = 'received' AND o.ordered_at IS NOT NULL THEN (o.received_at - o.ordered_at) / 86400000.0 END) lead_days,
      SUM(CASE WHEN o.status = 'received' AND o.delivery_day <> '' AND o.delivery_day IS NOT NULL THEN 1 ELSE 0 END) with_due
    FROM proc_suppliers s LEFT JOIN proc_orders o ON o.supplier_id = s.id AND o.status <> 'cancelled' AND o.created_at BETWEEN ? AND ?
    GROUP BY s.id, s.code, s.name HAVING COUNT(o.id) > 0 ORDER BY volume DESC`).all(r.a, r.b);
  const onTime = new Map(db.prepare(`SELECT o.supplier_id, COUNT(*) n FROM proc_orders o WHERE o.status = 'received' AND o.delivery_day IS NOT NULL AND o.delivery_day <> '' AND o.created_at BETWEEN ? AND ?
      AND o.received_at <= (EXTRACT(EPOCH FROM (o.delivery_day || ' 23:59:59+03')::timestamptz) * 1000) GROUP BY o.supplier_id`).all(r.a, r.b).map((x) => [Number(x.supplier_id), Number(x.n)]));
  const bad = new Map(db.prepare(`SELECT o.supplier_id, COUNT(*) n FROM proc_receipts rc JOIN proc_orders o ON o.id = rc.order_id WHERE rc.compliant = 0 AND rc.reversed_at IS NULL AND o.created_at BETWEEN ? AND ? GROUP BY o.supplier_id`).all(r.a, r.b).map((x) => [Number(x.supplier_id), Number(x.n)]));
  const rate = new Map(db.prepare('SELECT supplier_id, COUNT(*) n, AVG((quality + timeliness + price) / 3.0) s FROM proc_supplier_ratings GROUP BY supplier_id').all().map((x) => [Number(x.supplier_id), { n: Number(x.n), s: Math.round(Number(x.s) * 10) / 10 }]));
  return { from: r.from, to: r.to, suppliers: sups.map((s) => ({
    id: Number(s.id), code: s.code, name: s.name, orders: Number(s.orders), volume: Number(s.volume), completed: Number(s.done),
    avgLeadDays: s.lead_days == null ? null : Math.round(Number(s.lead_days) * 10) / 10,
    onTimePct: Number(s.with_due) ? Math.round(((onTime.get(Number(s.id)) || 0) / Number(s.with_due)) * 100) : null,
    nonCompliant: bad.get(Number(s.id)) || 0, rating: rate.get(Number(s.id))?.s ?? null, ratings: rate.get(Number(s.id))?.n ?? 0 })) };
}

export function registerProcReportRoutes(r, deps) {
  const need = (c) => { if (!c.user || !c.user.can('procurement:read')) throw bad('لا تملك صلاحية تقارير المخازن.', 403, 'forbidden'); };
  const K = { stagnant: stagnantItems, consumption, delayed: delayedOrders, suppliers: supplierPerformance };
  r.add('GET', '/api/procurement/reports/:kind', (c) => { need(c); const f = K[c.params.kind]; if (!f) throw bad('تقرير غير معروف.', 404, 'not_found'); c.json(200, f(deps.db, c.query ?? {})); });
}
