/* طلب الصرف الإلكتروني من الأقسام والمرتجع إلى المستودع (تقرير المشتريات 5.4)
   طلب الصرف: يقدّمه موظف القسم ← يعتمده رئيس وحدته (غير مقدّمه) ← يصرفه أمين المستودع بإذن صرف مربوط به (كاملاً أو جزئياً)
   ← يؤكد المستلم استلامه إلكترونياً. المرتجع: مواد صُرفت ولم تُستهلك تعود إلى رصيد المستودع بقيد عكسي لقيد الصرف. */
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { checkQty, itemUnitOf, bad, clean, nextNo, whAdd, stockMove, writeStockEntry, acctFor, invAcct, ccOf, notifyFinance, holdersOf } from './core.js';
import { getSetting } from '../settings.js';

const unitsOf = (u) => (u.unitIds && u.unitIds.length ? u.unitIds : [u.unit_id]).filter((x) => x != null).map(Number);
const seesAll = (u) => u.can('procurement:read') || u.can('procurement:stock') || u.can('procurement:manage');
const ST_AR = { pending: 'بانتظار اعتماد رئيس القسم', approved: 'معتمد بانتظار الصرف', partial: 'صُرف جزئياً', issued: 'صُرف بانتظار تأكيد المستلم', received: 'استلمه القسم', rejected: 'مرفوض', cancelled: 'ملغى' };
const notify = (db, userIds, kind, refId, text) => { const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"); for (const u of new Set(userIds.filter(Boolean).map(Number))) ins.run(u, kind, refId, text, Date.now()); };

const SELECT = `SELECT r.*, w.name wh_name, u.display_name requester_name, d.display_name decided_name, rc.display_name received_name
  FROM proc_issue_requests r JOIN proc_warehouses w ON w.id = r.warehouse_id LEFT JOIN users u ON u.id = r.requester_id LEFT JOIN users d ON d.id = r.decided_by LEFT JOIN users rc ON rc.id = r.received_by`;
const view = (db, r) => ({
  id: Number(r.id), no: r.no, status: r.status, statusLabel: ST_AR[r.status] || r.status, requesterId: Number(r.requester_id), requesterName: r.requester_name ?? '', unitId: r.unit_id == null ? null : Number(r.unit_id),
  department: r.department, warehouseId: Number(r.warehouse_id), warehouseName: r.wh_name, purpose: r.purpose, decidedBy: r.decided_name ?? '', decidedAt: r.decided_at ? Number(r.decided_at) : null, decisionNote: r.decision_note,
  receivedBy: r.received_name ?? '', receivedAt: r.received_at ? Number(r.received_at) : null, createdAt: Number(r.created_at),
  issues: db.prepare('SELECT id, no, issued_at FROM proc_issues WHERE issue_request_id = ? ORDER BY id').all(r.id).map((x) => ({ id: Number(x.id), no: x.no, at: Number(x.issued_at) })),
  lines: db.prepare('SELECT l.*, i.code, i.name, i.unit FROM proc_issue_request_lines l JOIN proc_items i ON i.id = l.item_id WHERE l.request_id = ? ORDER BY l.id').all(r.id)
    .map((l) => ({ id: Number(l.id), itemId: Number(l.item_id), code: l.code, name: l.name, unit: l.unit, qty: Number(l.qty), issuedQty: Number(l.issued_qty), remaining: Math.max(0, Number(l.qty) - Number(l.issued_qty)), note: l.note })),
});
const load = (db, id) => { const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(Number(id)); if (!r) throw bad('طلب الصرف غير موجود.', 404, 'not_found'); return r; };
// من يرى الطلب: موظفو المخازن كلها، ورئيس الوحدة طلبات وحدته، ومقدّمه طلبه
const canSee = (u, r) => seesAll(u) || Number(r.requester_id) === Number(u.id) || (u.can('procurement:issue_approve') && unitsOf(u).includes(Number(r.unit_id)));

export function listIssueRequests({ db }, user, q = {}) {
  const rows = db.prepare(`${SELECT} ${q.status ? 'WHERE r.status = ?' : ''} ORDER BY r.id DESC LIMIT 300`).all(...(q.status ? [q.status] : []));
  return rows.filter((r) => canSee(user, r)).map((r) => view(db, r));
}
export function getIssueRequest({ db }, user, id) { const r = load(db, id); if (!canSee(user, r)) throw bad('طلب الصرف غير موجود.', 404, 'not_found'); return { request: view(db, r) }; }

export function createIssueRequest({ db }, actor, b, ip) {
  const wh = db.prepare('SELECT id FROM proc_warehouses WHERE id = ? AND active = 1').get(Number(b?.warehouseId));
  if (!wh) throw bad('اختر المستودع الذي تُطلب منه المواد.');
  const lines = b?.lines; if (!Array.isArray(lines) || !lines.length) throw bad('أضف مادة واحدة على الأقل.'); if (lines.length > 50) throw bad('حتى 50 مادة للطلب.');
  lines.forEach((l, i) => { if (!db.prepare('SELECT 1 FROM proc_items WHERE id = ?').get(Number(l.itemId))) throw bad(`البند ${i + 1}: المادة غير موجودة.`); l.qty = checkQty(db, itemUnitOf(db, l.itemId), l?.qty, `البند ${i + 1}`); });
  const unitId = actor.unit_id ?? null;
  const dept = clean(b?.department || (unitId ? db.prepare('SELECT name FROM org_units WHERE id = ?').get(unitId)?.name : '') || '', 80, 'القسم الطالب', 2);
  const purpose = clean(b?.purpose, 300, 'الغرض من الطلب', 3);
  return tx(db, () => {
    const no = nextNo(db, 'ISR', 'proc_issue_requests');
    const id = Number(db.prepare('INSERT INTO proc_issue_requests (no, requester_id, unit_id, department, warehouse_id, purpose, status, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id').get(no, actor.id, unitId, dept, wh.id, purpose, 'pending', Date.now()).id);
    const ins = db.prepare('INSERT INTO proc_issue_request_lines (request_id, item_id, qty, note) VALUES (?,?,?,?)');
    for (const l of lines) ins.run(id, Number(l.itemId), Number(l.qty), String(l.note ?? '').slice(0, 200));
    // رئيس الوحدة (من يملك اعتماد طلبات الصرف في الوحدة نفسها) يُبلَّغ
    const heads = holdersOf(db, 'procurement:issue_approve').filter((uid) => uid !== actor.id && unitId && Number(db.prepare('SELECT unit_id FROM users WHERE id = ?').get(uid)?.unit_id) === Number(unitId));
    notify(db, heads, 'proc_issue_request', id, `طلب صرف ${no} من ${dept} بانتظار اعتمادك.`);
    audit(db, actor, 'تقديم طلب صرف مواد', no, ip);
    return { request: view(db, load(db, id)) };
  });
}

export function decideIssueRequest({ db }, actor, id, decision, note, ip) {
  const r = load(db, id);
  if (r.status !== 'pending') throw bad('الطلب ليس بانتظار الاعتماد.', 409, 'conflict');
  if (!['approve', 'reject'].includes(decision)) throw bad('قرار غير صالح.');
  if (Number(r.requester_id) === Number(actor.id)) throw bad('فصل المهام: لا يعتمد مقدّم طلب الصرف طلبه.', 403, 'sod_violation');
  if (!(actor.can('procurement:manage') || (actor.can('procurement:issue_approve') && unitsOf(actor).includes(Number(r.unit_id))))) throw bad('يعتمد طلب الصرف رئيس وحدة مقدّمه.', 403, 'forbidden');
  const n = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (decision === 'reject' && n.length < 3) throw bad('سبب الرفض مطلوب.', 400, 'reason_required');
  return tx(db, () => {
    db.prepare('UPDATE proc_issue_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?').run(decision === 'approve' ? 'approved' : 'rejected', actor.id, Date.now(), n, r.id);
    notify(db, [r.requester_id], 'proc_issue_request_decided', r.id, `طلب الصرف ${r.no}: ${decision === 'approve' ? 'اعتُمد وأُحيل إلى المستودع' : `رُفض — ${n}`}.`);
    if (decision === 'approve') {
      const keeper = db.prepare('SELECT manager_id FROM proc_warehouses WHERE id = ?').get(r.warehouse_id)?.manager_id;
      notify(db, keeper ? [keeper] : holdersOf(db, 'procurement:stock'), 'proc_issue_request_approved', r.id, `طلب صرف معتمد ${r.no} من ${r.department} بانتظار الصرف من ${r.wh_name}.`);
    }
    audit(db, actor, decision === 'approve' ? 'اعتماد طلب صرف' : 'رفض طلب صرف', `${r.no}${n ? `: ${n}` : ''}`.slice(0, 300), ip);
    return { request: view(db, load(db, r.id)) };
  });
}

export function cancelIssueRequest({ db }, actor, id, ip) {
  const r = load(db, id);
  if (!['pending', 'approved'].includes(r.status)) throw bad('يُلغى الطلب قبل صرف أي مادة منه.', 409, 'conflict');
  if (Number(r.requester_id) !== Number(actor.id) && !actor.can('procurement:manage')) throw bad('يلغي الطلب مقدّمه.', 403, 'forbidden');
  db.prepare("UPDATE proc_issue_requests SET status = 'cancelled' WHERE id = ?").run(r.id);
  audit(db, actor, 'إلغاء طلب صرف', r.no, ip);
  return { request: view(db, load(db, r.id)) };
}

// التوقيع الإلكتروني للمستلم: مقدّم الطلب (أو زميل في وحدته) يؤكد استلام ما صُرف
export function confirmIssueRequest({ db }, actor, id, ip) {
  const r = load(db, id);
  if (!['issued', 'partial'].includes(r.status)) throw bad('لم يُصرف شيء من الطلب بعد.', 409, 'conflict');
  if (Number(r.requester_id) !== Number(actor.id) && !unitsOf(actor).includes(Number(r.unit_id))) throw bad('يؤكد الاستلام مقدّم الطلب أو موظف في قسمه.', 403, 'forbidden');
  db.prepare("UPDATE proc_issue_requests SET status = 'received', received_by = ?, received_at = ? WHERE id = ?").run(actor.id, Date.now(), r.id);
  audit(db, actor, 'تأكيد استلام مواد مصروفة', r.no, ip);
  return { request: view(db, load(db, r.id)) };
}

/* يُستدعى من إذن الصرف المربوط بطلب: يتحقق من المعتمد المتبقي ويحدّث الكميات والحالة (داخل معاملة الصرف) */
export function applyIssueToRequest(db, reqId, issue) {
  const r = load(db, reqId);
  if (!['approved', 'partial'].includes(r.status)) throw bad('طلب الصرف غير معتمد أو صُرف كاملاً.', 409, 'conflict');
  if (Number(r.warehouse_id) !== Number(issue.warehouseId)) throw bad(`طلب الصرف من ${r.wh_name}؛ اصرف من المستودع نفسه.`, 409, 'conflict');
  const rl = db.prepare('SELECT * FROM proc_issue_request_lines WHERE request_id = ?').all(r.id);
  for (const l of issue.lines) {
    const x = rl.find((y) => Number(y.item_id) === Number(l.itemId));
    if (!x) throw bad('مادة غير مدرجة في طلب الصرف المعتمد.', 409, 'line_not_in_request');
    const left = Number(x.qty) - Number(x.issued_qty);
    if (Number(l.qty) > left + 1e-9) throw bad(`الكمية المصروفة (${l.qty}) تتجاوز المتبقي المعتمد (${left}).`, 409, 'qty_over_request');
    x.issued_qty = Number(x.issued_qty) + Number(l.qty);
    db.prepare('UPDATE proc_issue_request_lines SET issued_qty = ? WHERE id = ?').run(x.issued_qty, x.id);
  }
  const done = rl.every((x) => Number(x.issued_qty) >= Number(x.qty) - 1e-9);
  db.prepare('UPDATE proc_issue_requests SET status = ? WHERE id = ?').run(done ? 'issued' : 'partial', r.id);
  db.prepare('UPDATE proc_issues SET issue_request_id = ? WHERE id = ?').run(r.id, issue.id);
  notify(db, [r.requester_id], 'proc_issue_request_issued', r.id, `صُرفت مواد طلبك ${r.no}${done ? '' : ' جزئياً'}؛ أكّد استلامها.`);
  return { department: r.department, requestNo: r.no };
}

/* ===== المرتجع إلى المستودع ===== */
export function createReturn({ db }, actor, b, ip) {
  const wh = db.prepare('SELECT id FROM proc_warehouses WHERE id = ? AND active = 1').get(Number(b?.warehouseId));
  if (!wh) throw bad('اختر المستودع الذي تعود إليه المواد.');
  const lines = b?.lines; if (!Array.isArray(lines) || !lines.length) throw bad('أضف مادة واحدة على الأقل.');
  const reason = clean(b?.reason, 300, 'سبب الإرجاع', 5);
  const issue = b?.issueId ? db.prepare('SELECT * FROM proc_issues WHERE id = ?').get(Number(b.issueId)) : null;
  if (b?.issueId && !issue) throw bad('إذن الصرف غير موجود.', 404, 'not_found');
  const dept = clean(b?.department || issue?.department || issue?.issued_to || '', 80, 'القسم المُرجِع', 2);
  return tx(db, () => {
    const no = nextNo(db, 'RET', 'proc_returns');
    const id = Number(db.prepare('INSERT INTO proc_returns (no, warehouse_id, issue_id, department, returned_by_name, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
      .get(no, wh.id, issue ? issue.id : null, dept, String(b?.returnedBy ?? '').slice(0, 80), reason, actor.id, Date.now()).id);
    let total = 0;
    for (const [i, l] of lines.entries()) {
      const it = db.prepare('SELECT * FROM proc_items WHERE id = ?').get(Number(l.itemId)); if (!it) throw bad(`البند ${i + 1}: المادة غير موجودة.`);
      const q = checkQty(db, it.unit, l?.qty, `البند ${i + 1}`);
      let cost = Number(it.avg_cost);
      if (issue) {
        // لا يُرجع من إذن صرف أكثر مما صُرف به ناقص ما أُرجع منه سابقاً، وبسعر الصرف نفسه
        const issued = db.prepare("SELECT COALESCE(SUM(-qty), 0) q, MAX(unit_cost) c FROM proc_stock_moves WHERE ref_type = 'issue' AND ref_id = ? AND item_id = ? AND kind = 'issue'").get(issue.id, it.id);
        const back = Number(db.prepare('SELECT COALESCE(SUM(l.qty), 0) q FROM proc_return_lines l JOIN proc_returns r ON r.id = l.return_id WHERE r.issue_id = ? AND l.item_id = ? AND r.id <> ?').get(issue.id, it.id, id).q);
        if (!(Number(issued.q) > 0)) throw bad(`المادة ${it.code} لم تُصرف بإذن ${issue.no}.`, 409, 'line_not_in_issue');
        if (q + back > Number(issued.q) + 1e-9) throw bad(`المُرجع من ${it.code} (${q + back}) يتجاوز المصروف بإذن ${issue.no} (${Number(issued.q)}).`, 409, 'qty_over_issue');
        cost = Number(issued.c);
      }
      db.prepare('INSERT INTO proc_return_lines (return_id, item_id, qty, unit_cost, item_condition) VALUES (?,?,?,?,?)').run(id, it.id, q, cost, String(l.itemCondition ?? '').slice(0, 30));
      whAdd(db, it.id, wh.id, q);
      const newQty = Math.round((Number(it.qty_on_hand) + q) * 1000) / 1000, newAvg = newQty > 0 ? Math.round((Number(it.avg_cost) * Number(it.qty_on_hand) + cost * q) / newQty) : cost;
      db.prepare('UPDATE proc_items SET qty_on_hand = ?, avg_cost = ? WHERE id = ?').run(newQty, newAvg, it.id);
      stockMove(db, actor, { itemId: it.id, kind: 'return', qty: q, unitCost: cost, warehouseId: wh.id, refType: 'return', refId: id, refNo: no, note: `مرتجع من ${dept}` });
      total += q * cost;
    }
    // قيد عكسي لقيد الصرف: المخزون مدين، ومصروف المواد دائن بمركز تكلفة القسم
    const exp = { ...acctFor(db, getSetting(db, 'procurement.issue_expense_account'), 'مصروف المواد المصروفة') };
    const j = writeStockEntry(db, actor, { source: `proc_return:${id}`, reference: no, desc: `قيد مرتجع مواد ${no} من ${dept}`, debit: invAcct(db), credit: exp, amount: total, cc: ccOf(db, dept) });
    db.prepare('UPDATE proc_returns SET journal_entry_id = ?, journal_error = ? WHERE id = ?').run(j.entryId ?? null, j.error, id);
    if (j.error) notifyFinance(db, 'proc_return_journal', id, `مرتجع المواد ${no} عاد إلى المخزون بلا قيد: ${j.error}`);
    audit(db, actor, 'مرتجع مواد إلى المستودع', `${no} من ${dept}`, ip);
    return { returnId: id, no, journalEntryId: j.entryId ?? null, journalError: j.error };
  });
}
export function listReturns({ db }) {
  return db.prepare('SELECT r.*, w.name wh_name, i.no issue_no, u.display_name by_name FROM proc_returns r JOIN proc_warehouses w ON w.id = r.warehouse_id LEFT JOIN proc_issues i ON i.id = r.issue_id LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id DESC LIMIT 200').all()
    .map((r) => ({ id: Number(r.id), no: r.no, warehouseName: r.wh_name, issueNo: r.issue_no ?? '', department: r.department, returnedBy: r.returned_by_name, reason: r.reason, by: r.by_name ?? '', at: Number(r.created_at), journalEntryId: r.journal_entry_id ?? null, journalError: r.journal_error ?? null,
      lines: db.prepare('SELECT l.*, i.code, i.name FROM proc_return_lines l JOIN proc_items i ON i.id = l.item_id WHERE l.return_id = ? ORDER BY l.id').all(r.id).map((l) => ({ itemId: Number(l.item_id), code: l.code, name: l.name, qty: Number(l.qty), unitCost: Number(l.unit_cost), condition: l.item_condition })) }));
}

export function registerIssueFlowRoutes(r, deps) {
  const need = (c, ...perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  const REQ = ['procurement:request', 'procurement:issue_approve', 'procurement:stock', 'procurement:read', 'procurement:manage'];
  r.add('GET', '/api/procurement/issue-requests', (c) => c.json(200, { requests: listIssueRequests(deps, need(c, ...REQ), c.query ?? {}) }));
  r.add('GET', '/api/procurement/issue-requests/:id', (c) => c.json(200, getIssueRequest(deps, need(c, ...REQ), c.params.id)));
  r.add('POST', '/api/procurement/issue-requests', (c) => c.json(201, createIssueRequest(deps, need(c, 'procurement:request'), c.body, c.ip)));
  r.add('POST', '/api/procurement/issue-requests/:id/approve', (c) => c.json(200, decideIssueRequest(deps, need(c, 'procurement:issue_approve', 'procurement:manage'), c.params.id, 'approve', c.body?.note, c.ip)));
  r.add('POST', '/api/procurement/issue-requests/:id/reject', (c) => c.json(200, decideIssueRequest(deps, need(c, 'procurement:issue_approve', 'procurement:manage'), c.params.id, 'reject', c.body?.note, c.ip)));
  r.add('POST', '/api/procurement/issue-requests/:id/cancel', (c) => c.json(200, cancelIssueRequest(deps, need(c, ...REQ), c.params.id, c.ip)));
  r.add('POST', '/api/procurement/issue-requests/:id/confirm', (c) => c.json(200, confirmIssueRequest(deps, need(c, ...REQ), c.params.id, c.ip)));
  r.add('GET', '/api/procurement/returns', (c) => { need(c, 'procurement:read', 'procurement:stock'); c.json(200, { returns: listReturns(deps) }); });
  r.add('POST', '/api/procurement/returns', (c) => c.json(201, createReturn(deps, need(c, 'procurement:stock'), c.body, c.ip)));
}
