// طلب عروض الأسعار على طلب شراء معتمد، والمفاضلة بين العروض، والترسية التي تنشئ أمر التوريد،
// وتقييم المورّد بعد الاستلام. الترسية على غير الأرخص أو بأقل من العدد المطلوب من العروض تحتاج تبريراً.
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
import { docNo } from '../../lib/doc_no.js';
import { getSetting } from '../settings.js';
import { createOrder } from './core.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());

const rfqView = (db, r) => {
  const lines = db.prepare('SELECT id, description, qty, est_cost, item_id FROM proc_request_lines WHERE request_id = ? ORDER BY id').all(r.request_id);
  const quotes = db.prepare('SELECT q.*, s.name AS supplier FROM proc_rfq_quotes q JOIN proc_suppliers s ON s.id = q.supplier_id WHERE q.rfq_id = ? ORDER BY q.total, q.id').all(r.id).map((q) => ({
    id: Number(q.id), supplierId: Number(q.supplier_id), supplier: q.supplier, total: Number(q.total), deliveryDays: Number(q.delivery_days), notes: q.notes,
    prices: Object.fromEntries(db.prepare('SELECT request_line_id, unit_price FROM proc_rfq_quote_lines WHERE quote_id = ?').all(q.id).map((x) => [Number(x.request_line_id), Number(x.unit_price)])),
  }));
  return {
    id: Number(r.id), no: r.no, title: r.title, requestId: Number(r.request_id), requestNo: r.request_no, closesOn: r.closes_on, status: r.status, awardNote: r.award_note,
    closed: today() > r.closes_on, cancelReason: r.cancel_reason ?? null,
    awardedQuoteId: r.awarded_quote_id ? Number(r.awarded_quote_id) : null, orderId: r.order_id ? Number(r.order_id) : null,
    lines: lines.map((l) => ({ id: Number(l.id), description: l.description, qty: Number(l.qty), estCost: Number(l.est_cost) })), quotes,
  };
};
const SELECT = 'SELECT f.*, q.no AS request_no FROM proc_rfqs f JOIN proc_requests q ON q.id = f.request_id';

export function quotationsOverview({ db }) {
  const ratings = db.prepare('SELECT supplier_id, COUNT(*) AS n, AVG(quality) AS q, AVG(timeliness) AS t, AVG(price) AS p FROM proc_supplier_ratings GROUP BY supplier_id').all();
  return {
    rfqs: db.prepare(`${SELECT} ORDER BY CASE f.status WHEN 'open' THEN 0 ELSE 1 END, f.id DESC LIMIT 200`).all().map((r) => rfqView(db, r)),
    requests: db.prepare("SELECT r.id, r.no, r.title FROM proc_requests r WHERE r.status = 'approved' AND NOT EXISTS (SELECT 1 FROM proc_rfqs f WHERE f.request_id = r.id AND f.status <> 'cancelled') ORDER BY r.id DESC").all()
      .map((r) => ({ id: Number(r.id), no: r.no, title: r.title })),
    suppliers: db.prepare('SELECT id, name FROM proc_suppliers WHERE active = 1 ORDER BY name').all().map((s) => {
      const r = ratings.find((x) => Number(x.supplier_id) === Number(s.id));
      return { id: Number(s.id), name: s.name, ratings: r ? Number(r.n) : 0, score: r ? Math.round(((Number(r.q) + Number(r.t) + Number(r.p)) / 3) * 10) / 10 : null };
    }),
    ratable: db.prepare("SELECT o.id, o.no, s.name AS supplier FROM proc_orders o JOIN proc_suppliers s ON s.id = o.supplier_id WHERE o.status = 'received' AND NOT EXISTS (SELECT 1 FROM proc_supplier_ratings x WHERE x.order_id = o.id) ORDER BY o.id DESC LIMIT 100").all()
      .map((o) => ({ id: Number(o.id), no: o.no, supplier: o.supplier })),
    minQuotes: Number(getSetting(db, 'procurement.min_quotes')),
  };
}

export function createRfq({ db }, actor, b, ip) {
  const req = db.prepare('SELECT * FROM proc_requests WHERE id = ?').get(Number(b?.requestId));
  if (!req) throw bad('طلب الشراء غير موجود.', 404, 'not_found');
  if (req.status !== 'approved') throw bad('يُطلب عرض أسعار لطلب شراء معتمد.', 409, 'conflict');
  if (db.prepare("SELECT 1 FROM proc_rfqs WHERE request_id = ? AND status <> 'cancelled'").get(req.id)) throw bad('يوجد طلب عروض قائم لهذا الطلب.', 409, 'conflict');
  const closes = String(b?.closesOn ?? '');
  if (!DAY_RE.test(closes)) throw bad('آخر موعد لتقديم العروض بصيغة 2026-12-31.');
  if (closes < today()) throw bad('آخر موعد لتقديم العروض لا يكون في الماضي.');
  const no = docNo('RFQ');
  const id = Number(db.prepare('INSERT INTO proc_rfqs (no, request_id, title, closes_on, created_by, created_at) VALUES (?,?,?,?,?,?) RETURNING id').get(no, req.id, clean(b?.title, 160) || req.title, closes, actor.id ?? null, Date.now()).id);
  audit(db, actor, 'طلب عروض أسعار', `${no} على ${req.no}`, ip);
  return { id, no };
}

const loadRfq = (db, id) => {
  const r = db.prepare(`${SELECT} WHERE f.id = ?`).get(Number(id));
  if (!r) throw bad('طلب العروض غير موجود.', 404, 'not_found');
  return r;
};

export function addQuote({ db }, actor, rfqId, b, ip) {
  const r = loadRfq(db, rfqId);
  if (r.status !== 'open') throw bad('طلب العروض مغلق.', 409, 'conflict');
  if (today() > r.closes_on) throw bad(`انتهى موعد تقديم العروض (${r.closes_on})؛ العرض المتأخر لا يُقبل.`, 409, 'rfq_closed');
  const sup = db.prepare('SELECT * FROM proc_suppliers WHERE id = ? AND active = 1').get(Number(b?.supplierId));
  if (!sup) throw bad('المورّد غير موجود أو معطل.');
  if (db.prepare('SELECT 1 FROM proc_rfq_quotes WHERE rfq_id = ? AND supplier_id = ?').get(r.id, sup.id)) throw bad('سُجل عرض هذا المورّد مسبقاً.', 409, 'conflict');
  const lines = db.prepare('SELECT * FROM proc_request_lines WHERE request_id = ?').all(r.request_id);
  const prices = b?.prices ?? {};
  let total = 0;
  for (const l of lines) {
    const p = Number(prices[l.id]);
    if (!Number.isFinite(p) || p < 0) throw bad(`سعر البند «${l.description}» مطلوب.`);
    total += Math.round(p) * Number(l.qty);
  }
  const days = Number(b?.deliveryDays ?? 0);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw bad('مدة التوريد بالأيام.');
  const qid = Number(db.prepare('INSERT INTO proc_rfq_quotes (rfq_id, supplier_id, delivery_days, total, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id').get(r.id, sup.id, days, total, clean(b?.notes, 300), actor.id ?? null, Date.now()).id);
  const ins = db.prepare('INSERT INTO proc_rfq_quote_lines (quote_id, request_line_id, unit_price) VALUES (?,?,?)');
  for (const l of lines) ins.run(qid, l.id, Math.round(Number(prices[l.id])));
  audit(db, actor, 'تسجيل عرض سعر', `${r.no}: ${sup.name} = ${total}`, ip);
  return { id: qid, total };
}

export function awardRfq(deps, actor, rfqId, b, ip) {
  const { db } = deps, r = loadRfq(db, rfqId);
  if (r.status !== 'open') throw bad('طلب العروض مغلق.', 409, 'conflict');
  const v = rfqView(db, r), quote = v.quotes.find((q) => q.id === Number(b?.quoteId));
  if (!quote) throw bad('اختر عرضاً من العروض المسجلة.');
  const min = Number(getSetting(db, 'procurement.min_quotes')), cheapest = v.quotes[0];
  const note = clean(b?.note, 500), reasons = [];
  if (v.quotes.length < min) reasons.push(`العروض ${v.quotes.length} وأقل من ${min}`);
  if (quote.total > cheapest.total) reasons.push('العرض المختار ليس الأرخص');
  if (today() <= r.closes_on) reasons.push(`الترسية قبل انتهاء موعد العروض (${r.closes_on})`);
  if (reasons.length && note.length < 10) throw bad(`الترسية تحتاج تبريراً مكتوباً: ${reasons.join('، ')}.`, 409, 'justification_required');
  const order = createOrder(deps, actor, { supplierId: quote.supplierId, requestId: r.request_id, note: `ترسية ${r.no}${note ? ` — ${note}` : ''}`.slice(0, 300),
    lines: db.prepare('SELECT * FROM proc_request_lines WHERE request_id = ? ORDER BY id').all(r.request_id).map((l) => ({ itemId: l.item_id, description: l.description, qty: Number(l.qty), unitCost: quote.prices[Number(l.id)] ?? 0 })) }, ip, { awarded: true }).order;
  db.prepare("UPDATE proc_rfqs SET status = 'awarded', awarded_quote_id = ?, award_note = ?, order_id = ? WHERE id = ?").run(quote.id, note || reasons.join('، '), order.id, r.id);
  audit(db, actor, 'ترسية طلب عروض أسعار', `${r.no} على ${quote.supplier} (${quote.total})${reasons.length ? ` — ${reasons.join('، ')}` : ''}`.slice(0, 300), ip);
  return { orderId: order.id, orderNo: order.no };
}

/* إلغاء طلب العروض المفتوح (منشأ بالخطأ أو لم يعد مطلوباً) بسبب مكتوب، فيُفتح طلب عروض جديد للطلب نفسه */
export function cancelRfq({ db }, actor, rfqId, b, ip) {
  const r = loadRfq(db, rfqId);
  if (r.status !== 'open') throw bad('يُلغى طلب العروض المفتوح فقط.', 409, 'conflict');
  const why = clean(b?.reason, 300);
  if (why.length < 5) throw bad('اكتب سبب إلغاء طلب العروض.', 400, 'reason_required');
  db.prepare("UPDATE proc_rfqs SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ?").run(why, actor.id ?? null, Date.now(), r.id);
  audit(db, actor, 'إلغاء طلب عروض أسعار', `${r.no}: ${why}`.slice(0, 300), ip);
  return { ok: true };
}

/* سحب عرض مسجّل بالخطأ (أو سحبه المورّد) قبل الترسية، بسبب مكتوب يبقى في السجل */
export function withdrawQuote({ db }, actor, rfqId, quoteId, b, ip) {
  const r = loadRfq(db, rfqId);
  if (r.status !== 'open') throw bad('لا يُسحب عرض بعد الترسية أو الإلغاء.', 409, 'conflict');
  const q = db.prepare('SELECT q.*, s.name AS supplier FROM proc_rfq_quotes q JOIN proc_suppliers s ON s.id = q.supplier_id WHERE q.id = ? AND q.rfq_id = ?').get(Number(quoteId), r.id);
  if (!q) throw bad('العرض غير موجود.', 404, 'not_found');
  const why = clean(b?.reason, 300);
  if (why.length < 5) throw bad('اكتب سبب سحب العرض.', 400, 'reason_required');
  db.prepare('DELETE FROM proc_rfq_quote_lines WHERE quote_id = ?').run(q.id);
  db.prepare('DELETE FROM proc_rfq_quotes WHERE id = ?').run(q.id);
  audit(db, actor, 'سحب عرض سعر', `${r.no}: ${q.supplier} (${q.total}) — ${why}`.slice(0, 300), ip);
  return { ok: true };
}

export function rateSupplier({ db }, actor, b, ip) {
  const o = db.prepare("SELECT * FROM proc_orders WHERE id = ? AND status = 'received'").get(Number(b?.orderId));
  if (!o) throw bad('يُقيَّم المورّد بعد استلام أمر التوريد كاملاً.', 409, 'conflict');
  const score = (k) => { const n = Number(b?.[k]); if (!Number.isInteger(n) || n < 1 || n > 5) throw bad('كل تقييم من 1 إلى 5.'); return n; };
  const res = db.prepare('INSERT INTO proc_supplier_ratings (supplier_id, order_id, quality, timeliness, price, note, rated_by, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .run(o.supplier_id, o.id, score('quality'), score('timeliness'), score('price'), clean(b?.note, 300), actor.id ?? null, Date.now());
  if (!res.changes) throw bad('قُيّم هذا الأمر مسبقاً.', 409, 'conflict');
  audit(db, actor, 'تقييم مورّد', o.no, ip);
  return { ok: true };
}

export function registerQuotationRoutes(r, deps) {
  const need = (c, perm) => { if (!c.user || !c.user.can(perm)) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/procurement/quotations', (c) => { need(c, 'procurement:read'); c.json(200, quotationsOverview(deps)); });
  r.add('POST', '/api/procurement/rfqs', (c) => c.json(201, createRfq(deps, need(c, 'procurement:manage'), c.body, c.ip)));
  r.add('POST', '/api/procurement/rfqs/:id/quotes', (c) => c.json(201, addQuote(deps, need(c, 'procurement:manage'), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/procurement/rfqs/:id/cancel', (c) => c.json(200, cancelRfq(deps, need(c, 'procurement:manage'), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/procurement/rfqs/:id/quotes/:qid/withdraw', (c) => c.json(200, withdrawQuote(deps, need(c, 'procurement:manage'), c.params.id, c.params.qid, c.body, c.ip)));
  r.add('POST', '/api/procurement/rfqs/:id/award', (c) => c.json(200, awardRfq(deps, need(c, 'procurement:manage'), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/procurement/supplier-ratings', (c) => c.json(201, rateSupplier(deps, need(c, 'procurement:manage'), c.body, c.ip)));
}
