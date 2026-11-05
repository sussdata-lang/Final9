// فواتير الطلاب: كل قسط استحقاق مستقل. الحسم يُوزَّع على رسوم العام نفسه، والدفعات على الأقدم استحقاقًا.
import { bad, ready, today, isDay, toMinor, fromMinor } from './core.js';
import { createCharge, createPayment, listCharges, listFeeTypes, listPayments, voidCharge } from './fees.js';

const minor = (v) => Math.round(Number(v) * 100);

export function listStudentInvoices(deps, q = {}) {
  const { db } = deps; ready(db);
  const filter = q.studentId ? { studentId: q.studentId } : q.studentIds ? { studentIds: q.studentIds } : {};
  const all = listCharges(deps, filter);
  const paidLeft = new Map(), discountLeft = new Map();
  for (const p of listPayments(deps, filter)) if (p.status === 'ok') paidLeft.set(Number(p.studentId), (paidLeft.get(Number(p.studentId)) || 0) + minor(p.amount));
  for (const d of all) {
    if (d.kind !== 'discount' || d.status !== 'open') continue;
    const k = `${d.studentId}|${d.academicYear}`;
    discountLeft.set(k, (discountLeft.get(k) || 0) + minor(d.amount));
  }
  const people = new Map(db.prepare("SELECT id, display_name, student_no FROM users WHERE role = 'student'").all().map((u) => [Number(u.id), u]));
  const take = (map, key, want) => { const use = Math.min(map.get(key) || 0, want); map.set(key, (map.get(key) || 0) - use); return use; };
  const oldestFirst = all.filter((c) => c.kind === 'fee').sort((a, b) => String(a.dueDay).localeCompare(String(b.dueDay)) || Number(a.id) - Number(b.id));
  const rows = oldestFirst.map((c) => {
    const total = minor(c.amount), who = people.get(Number(c.studentId));
    const open = c.status === 'open';
    const discount = open ? take(discountLeft, `${c.studentId}|${c.academicYear}`, total) : 0;
    const paid = open ? take(paidLeft, Number(c.studentId), total - discount) : 0;
    const net = total - discount;
    const status = !open ? 'cancelled' : paid >= net ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return {
      id: c.id, no: `CHG-${c.id}`, studentId: Number(c.studentId), studentName: who?.display_name ?? '', studentNo: who?.student_no ?? '',
      academicYear: c.academicYear, feeType: c.feeType, dueDay: c.dueDay, note: c.note,
      totalAmount: fromMinor(total), discountAmount: fromMinor(discount), netAmount: fromMinor(net), paidAmount: fromMinor(paid), status,
      installments: [{ seq: 1, dueDay: c.dueDay, amount: fromMinor(net), paidAmount: fromMinor(paid), status }],
    };
  });
  return rows.sort((a, b) => Number(b.id) - Number(a.id));
}

// صفحة من الفواتير: الحسم والدفعات تُحسب لطلابها فقط
export function pageStudentInvoices(deps, q = {}) {
  const { db } = deps; ready(db);
  const size = Math.min(200, Math.max(10, Number(q.size) || 100)), page = Math.max(1, Number(q.page) || 1);
  const term = String(q.q ?? '').trim().slice(0, 60).replace(/[%_\\]/g, '');
  const where = "ft.kind = 'fee'" + (term ? ' AND (u.student_no ILIKE ? OR u.display_name ILIKE ?)' : '');
  const args = term ? [`%${term}%`, `%${term}%`] : [];
  const from = 'FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id JOIN users u ON u.id = c.student_id';
  const total = Number(db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...args).n);
  const ids = db.prepare(`SELECT c.id, c.student_id ${from} WHERE ${where} ORDER BY c.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`).all(...args);
  const wanted = new Set(ids.map((r) => Number(r.id)));
  const invoices = !ids.length ? [] : listStudentInvoices(deps, { studentIds: [...new Set(ids.map((r) => r.student_id))] }).filter((i) => wanted.has(Number(i.id)));
  return { invoices, total, page, pages: Math.max(1, Math.ceil(total / size)), size };
}

export function getStudentInvoice(deps, id) {
  const ch = deps.db.prepare('SELECT student_id FROM fin_charges WHERE id = ?').get(Number(id));
  const inv = ch && listStudentInvoices(deps, { studentId: ch.student_id }).find((x) => Number(x.id) === Number(id));
  if (!inv) throw bad('الفاتورة غير موجودة.', 404, 'not_found');
  return inv;
}

export function listOverdue(deps) {
  const day = today();
  return listStudentInvoices(deps)
    .filter((i) => ['unpaid', 'partial'].includes(i.status) && i.dueDay < day)
    .map((i) => ({ invoiceNo: i.no, studentName: i.studentName, studentNo: i.studentNo, seq: 1, dueDay: i.dueDay, amount: i.netAmount, paidAmount: i.paidAmount }))
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay))
    .slice(0, 1000);
}

export function feesOverview(deps) {
  const rows = listStudentInvoices(deps).filter((i) => i.status !== 'cancelled');
  const sum = (pick) => rows.reduce((s, i) => s + minor(pick(i)), 0);
  const billed = sum((i) => i.netAmount), collected = sum((i) => i.paidAmount);
  return {
    invoicesCount: rows.length,
    totalBilled: fromMinor(billed),
    totalCollected: fromMinor(collected),
    totalRemaining: fromMinor(billed - collected),
    collectionRate: billed > 0 ? Math.round((collected / billed) * 100) : 100,
    overdueCount: listOverdue(deps).length,
  };
}

function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

export function createStudentInvoice(deps, actor, b, ip) {
  const { db } = deps; ready(db);
  const studentNo = String(b?.studentNo ?? '').trim();
  const student = studentNo
    ? db.prepare("SELECT id FROM users WHERE role = 'student' AND student_no = ?").get(studentNo)
    : db.prepare("SELECT id FROM users WHERE role = 'student' AND id = ?").get(Number(b?.studentId));
  if (!student) throw bad('الطالب غير موجود.', 404, 'not_found');
  const academicYear = String(b?.academicYear ?? '').trim();
  if (!academicYear) throw bad('العام الدراسي مطلوب.');
  const total = toMinor(b?.totalAmount);
  if (!Number.isSafeInteger(total) || total <= 0) throw bad('المبلغ الإجمالي يجب أن يكون أكبر من صفر.');
  const count = Number(b?.installmentsCount ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 12) throw bad('عدد الأقساط بين 1 و12.');
  const firstDue = String(b?.firstDueDay ?? '');
  if (!isDay(firstDue)) throw bad('تاريخ استحقاق القسط الأول مطلوب.');
  const types = listFeeTypes(deps).filter((f) => f.kind === 'fee' && f.active);
  const feeType = b?.feeTypeId ? types.find((f) => Number(f.id) === Number(b.feeTypeId)) : types[0];
  if (!feeType) throw bad('نوع الرسم غير موجود أو معطّل.', 404, 'not_found');

  const each = Math.floor(total / count), created = [];
  try {
    for (let i = 0; i < count; i++) {
      const amount = i === count - 1 ? total - each * (count - 1) : each;
      created.push(createCharge(deps, actor, { studentId: student.id, feeTypeId: feeType.id, amount: fromMinor(amount), dueDay: addMonths(firstDue, i), academicYear, note: count > 1 ? `قسط ${i + 1} من ${count}` : '' }, ip).id);
    }
  } catch (err) {
    // كل قسط يُرحَّل في معاملته، فتُلغى الأقساط السابقة حتى لا تبقى الفاتورة ناقصة
    for (const id of created) voidCharge(deps, actor, id, { reason: 'تعذر إكمال أقساط الفاتورة' }, ip);
    throw err;
  }
  return { ids: created, count };
}

export function payStudentInvoice(deps, actor, id, b, ip) {
  const inv = getStudentInvoice(deps, id);
  if (!['unpaid', 'partial'].includes(inv.status)) throw bad('لا يوجد مبلغ مستحق على هذه الفاتورة.', 409, 'conflict');
  const amount = toMinor(b?.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw bad('مبلغ الدفعة يجب أن يكون أكبر من صفر.');
  if (amount > minor(inv.netAmount) - minor(inv.paidAmount)) throw bad('مبلغ الدفعة يتجاوز المتبقي على الفاتورة.');
  return createPayment(deps, actor, { studentId: inv.studentId, amount: fromMinor(amount), method: b?.method, paidDay: today(), note: `سداد الفاتورة ${inv.no}` }, ip);
}

// استحقاق مسدد لا يُلغى قبل إلغاء دفعاته
export function voidStudentCharge(deps, actor, id, input, ip) {
  const ch = deps.db.prepare('SELECT c.student_id, ft.kind FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id WHERE c.id = ?').get(Number(id));
  if (ch?.kind === 'fee' && getStudentInvoice(deps, id).paidAmount > 0) throw bad('على هذا الاستحقاق دفعات؛ ألغِ الدفعات أولاً.', 409, 'conflict');
  return voidCharge(deps, actor, id, input, ip);
}
