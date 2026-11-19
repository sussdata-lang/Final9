// محرك الموافقات العام: يعرّف المدير أنواع الموافقة وخطواتها (تسلسلية أو متوازية، وشرط مبلغ لكل خطوة)،
// ويقدّم أي موظف طلباً من نوع منها، مرتبطاً بسجل أو مستقلاً. خطوات النوع تُنسخ لحظة التقديم فلا يغيّر تعديله الطلبات القائمة.
// فصل المهام: مقدّم الطلب لا يعتمد طلبه، ولا يعتمد الشخص نفسه خطوتين في الطلب الواحد.
import { audit } from '../../audit.js';
import { tx } from '../../db.js';
import { ASSIGNABLE } from '../../permissions.js';
import { nextNumber, withLock } from '../numbering.js';
import { log } from '../../lib/logger.js';
import {
  bad, clean, staffOnly, activeStaff, usersWithPerm, nameOf, registerModel, assertRecord, recordTitle, modelLabel,
  follow, followersOf, postMessage, track, notifyUsers, emit, listMessages, listActivities,
} from './records.js';

export const MANAGE = 'approvals:manage', READ_ALL = 'approvals:read_all';
const STATUS = { pending: 'قيد الاعتماد', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' };
const STEP_STATUS = { waiting: 'بانتظار ما قبلها', pending: 'بانتظار القرار', approved: 'اعتُمدت', rejected: 'رُفضت', skipped: 'لم تُطلب' };
const KINDS = { user: 'موظف محدد', permission: 'حامل صلاحية', unit_head: 'رئيس وحدة مقدّم الطلب' };
const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;
// أنواع تملكها وحدة: خطواتها من هنا، وتنفيذها في الوحدة. المسموح فيها ما يُحل إلى موظف بعينه لحظة الإرسال
const OWNERS = { corr: { label: 'المراسلات', kinds: ['user', 'unit_head'] } };
const MAX_AMOUNT = 1e13;

// ما يحدث في الوحدة المالكة عند البت النهائي (مثلاً: تحويل طلب الشراء إلى «معتمد»)؛ تسجّله الوحدة باسم النوع
const outcomeHooks = new Map();
export function onApprovalDone(typeCode, fn) { outcomeHooks.set(typeCode, fn); }

const reqRow = (db, id) => db.prepare('SELECT r.*, t.code AS type_code, t.name AS type_name, t.mode FROM approval_requests r JOIN approval_types t ON t.id = r.type_id WHERE r.id = ?').get(Number(id));
const stepsOf = (db, id) => db.prepare('SELECT * FROM approval_request_steps WHERE request_id = ? ORDER BY seq').all(Number(id));
const eligible = (s, u) => (s.approver_kind === 'user' ? Number(s.approver_user_id) === Number(u.id) : !!u.can?.(s.approver_perm));
const decidedBy = (steps, u) => steps.some((s) => ['approved', 'rejected'].includes(s.status) && Number(s.decided_by) === Number(u.id));
// الخطوة التي ينتظر قرار المستخدم فيها الآن، إن وُجدت
function myStep(r, steps, u) {
  if (r.status !== 'pending' || Number(r.requester_id) === Number(u.id) || decidedBy(steps, u)) return null;
  return steps.find((s) => s.status === 'pending' && eligible(s, u)) ?? null;
}
function canSee(db, u, r, steps = stepsOf(db, r.id)) {
  if (u.can(MANAGE) || u.can(READ_ALL) || Number(r.requester_id) === Number(u.id)) return true;
  if (steps.some((s) => (s.status !== 'waiting' && Number(s.decided_by) === Number(u.id)) || (s.status === 'pending' && eligible(s, u)))) return true;
  return followersOf(db, 'approval', r.id).includes(Number(u.id));
}

registerModel('approval', {
  label: 'طلب موافقة',
  title: (db, id) => { const r = db.prepare('SELECT no, title FROM approval_requests WHERE id = ?').get(id); return r ? `${r.no} — ${r.title}` : null; },
  canRead: (db, u, id) => { const r = reqRow(db, id); return !!r && canSee(db, u, r); },
});

/* ===== أنواع الموافقة ===== */
function typeView(db, t) {
  const steps = db.prepare('SELECT * FROM approval_type_steps WHERE type_id = ? ORDER BY seq').all(Number(t.id)).map((s) => ({
    seq: Number(s.seq), label: s.label, kind: s.approver_kind, kindLabel: KINDS[s.approver_kind], userId: s.approver_user_id ? Number(s.approver_user_id) : null,
    user: s.approver_user_id ? nameOf(db, s.approver_user_id) : null, perm: s.approver_perm, minAmount: Number(s.min_amount),
  }));
  return { id: Number(t.id), code: t.code, name: t.name, description: t.description, mode: t.mode, amountRequired: !!Number(t.amount_required), active: !!Number(t.active), owner: t.owner ?? null, ownerLabel: t.owner ? OWNERS[t.owner]?.label ?? t.owner : null, steps };
}
export function listTypes(db, actor, { all = false } = {}) {
  staffOnly(actor);
  const withInactive = all && actor.can(MANAGE);
  return db.prepare(`SELECT * FROM approval_types ${withInactive ? '' : 'WHERE active = 1'} ORDER BY name`).all().map((t) => typeView(db, t));
}

function parseSteps(db, list, owner = null) {
  const rule = owner ? OWNERS[owner] : null;
  if (!Array.isArray(list) || (!rule && !list.length) || list.length > 10) throw bad(rule ? 'حتى عشر خطوات.' : 'حدّد من خطوة إلى عشر خطوات اعتماد.');
  return list.map((s, i) => {
    const label = clean(s?.label, 80) || `الخطوة ${i + 1}`;
    const kind = String(s?.kind ?? '');
    if (!KINDS[kind]) throw bad(`نوع المعتمد في الخطوة ${i + 1} غير صالح.`);
    if (rule && !rule.kinds.includes(kind)) throw bad(`خطوات ${rule.label}: ${rule.kinds.map((k) => KINDS[k]).join(' أو ')} فقط.`);
    const minAmount = Number(s?.minAmount ?? 0);
    if (!Number.isInteger(minAmount) || minAmount < 0 || minAmount > MAX_AMOUNT) throw bad(`حد المبلغ في الخطوة ${i + 1} عدد صحيح غير سالب.`);
    let userId = null, perm = null;
    if (kind === 'user') userId = activeStaff(db, s?.userId).id;
    if (kind === 'permission') { perm = String(s?.perm ?? ''); if (!ASSIGNABLE.has(perm)) throw bad(`الصلاحية في الخطوة ${i + 1} غير معروفة.`); }
    return { seq: i + 1, label, kind, userId, perm, minAmount };
  });
}

export function saveType(db, actor, id, b, ip) {
  staffOnly(actor);
  if (!actor.can(MANAGE)) throw bad('يتطلب صلاحية إدارة أنواع الموافقات.', 403, 'forbidden');
  const name = clean(b?.name, 120);
  if (name.length < 3) throw bad('اسم نوع الموافقة مطلوب.');
  const mode = b?.mode === 'parallel' ? 'parallel' : 'sequential';
  const owned = id ? db.prepare('SELECT owner FROM approval_types WHERE id = ?').get(Number(id))?.owner ?? null : null;
  const steps = parseSteps(db, b?.steps, owned);
  const fields = [name, clean(b?.description, 500), mode, b?.amountRequired ? 1 : 0, b?.active === false ? 0 : 1];
  return tx(db, () => {
    let typeId;
    if (id) {
      const t = db.prepare('SELECT * FROM approval_types WHERE id = ?').get(Number(id));
      if (!t) throw bad('نوع الموافقة غير موجود.', 404, 'not_found');
      typeId = Number(t.id);
      db.prepare('UPDATE approval_types SET name = ?, description = ?, mode = ?, amount_required = ?, active = ? WHERE id = ?').run(...fields, typeId);
      db.prepare('DELETE FROM approval_type_steps WHERE type_id = ?').run(typeId);
    } else {
      const code = String(b?.code ?? '').trim();
      if (!CODE_RE.test(code)) throw bad('الرمز بحروف لاتينية صغيرة وأرقام وشرطة سفلية، ويبدأ بحرف.');
      if (db.prepare('SELECT 1 AS x FROM approval_types WHERE code = ?').get(code)) throw bad('الرمز مستخدم.', 409, 'conflict');
      typeId = Number(db.prepare('INSERT INTO approval_types (code, name, description, mode, amount_required, active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').get(code, ...fields, actor.id, Date.now()).id);
    }
    const ins = db.prepare('INSERT INTO approval_type_steps (type_id, seq, label, approver_kind, approver_user_id, approver_perm, min_amount) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const s of steps) ins.run(typeId, s.seq, s.label, s.kind, s.userId, s.perm, s.minAmount);
    audit(db, actor, id ? 'تعديل نوع موافقة' : 'تعريف نوع موافقة', name, ip);
    return { id: typeId };
  });
}

/* ===== التقديم ===== */
// رئيس الوحدة: حساب دور head_<رمز الوحدة>، صعوداً في الهيكل حتى يوجد رئيس غير مقدّم الطلب نفسه
function unitHead(db, requester) {
  let unitId = requester.unit_id ? Number(requester.unit_id) : null;
  for (let hops = 0; unitId && hops < 12; hops++) {
    const u = db.prepare('SELECT id, code, parent_id FROM org_units WHERE id = ?').get(unitId);
    if (!u) break;
    if (u.code) {
      const head = db.prepare("SELECT id FROM users WHERE role_key = ? AND active = 1 AND id <> ? ORDER BY id LIMIT 1").get('head_' + u.code, requester.id);
      if (head) return Number(head.id);
    }
    unitId = u.parent_id ? Number(u.parent_id) : null;
  }
  return null;
}

// خطوات النوع المملوك محلولةً إلى موظفين لحظة الإرسال، دون مقدّم الطلب ودون تكرار
export function templateApprovers(db, code, requester) {
  const t = db.prepare('SELECT id FROM approval_types WHERE code = ? AND active = 1').get(code);
  if (!t) return [];
  const out = [];
  for (const s of db.prepare('SELECT * FROM approval_type_steps WHERE type_id = ? ORDER BY seq').all(Number(t.id))) {
    let uid = s.approver_kind === 'user' ? Number(s.approver_user_id) : s.approver_kind === 'unit_head' ? unitHead(db, requester) : null;
    if (uid && !Number(db.prepare('SELECT active FROM users WHERE id = ?').get(uid)?.active)) uid = null;
    if (uid && uid !== Number(requester.id) && !out.some((x) => x.userId === uid)) out.push({ userId: uid, label: s.label });
  }
  return out;
}

function pendingApprovers(db, steps) {
  const ids = [];
  for (const s of steps.filter((x) => x.status === 'pending')) {
    if (s.approver_kind === 'user') ids.push(Number(s.approver_user_id));
    else ids.push(...usersWithPerm(db, s.approver_perm));
  }
  return [...new Set(ids)];
}
function announcePending(db, r, steps, requesterId) {
  for (const s of steps.filter((x) => x.status === 'pending')) {
    const who = (s.approver_kind === 'user' ? [Number(s.approver_user_id)] : usersWithPerm(db, s.approver_perm)).filter((u) => u !== Number(requesterId));
    notifyUsers(db, who, 'approval_step', Number(s.id), `طلب موافقة بانتظار قرارك: ${r.no} — ${r.title} (${s.label})`, `?view=hub&tab=approvals&id=${r.id}`);
  }
}

export function submitApproval(db, actor, b, ip) {
  staffOnly(actor);
  const type = db.prepare('SELECT * FROM approval_types WHERE id = ? AND active = 1').get(Number(b?.typeId));
  if (!type) throw bad('نوع الموافقة غير موجود أو معطّل.', 404, 'not_found');
  if (type.owner) throw bad(`هذا النوع يُنفَّذ من وحدة ${OWNERS[type.owner]?.label ?? type.owner}، لا من «طلب جديد».`, 409, 'conflict');
  const title = clean(b?.title, 160);
  if (title.length < 3) throw bad('عنوان الطلب مطلوب.');
  let amount = b?.amount === '' || b?.amount === undefined || b?.amount === null ? null : Number(b.amount);
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT)) throw bad('المبلغ عدد صحيح غير سالب.');
  if (Number(type.amount_required) && amount === null) throw bad('هذا النوع يتطلب ذكر المبلغ.');
  let link = null;
  if (b?.model) link = assertRecord(db, actor, b.model, b.resId);
  const tpl = db.prepare('SELECT * FROM approval_type_steps WHERE type_id = ? AND min_amount <= ? ORDER BY seq').all(Number(type.id), amount ?? 0);
  if (!tpl.length) throw bad('لا خطوة اعتماد تنطبق على هذا الطلب؛ راجع تعريف النوع.', 409, 'conflict');
  const requester = { ...actor, unit_id: actor.unit_id };
  return tx(db, () => {
    const n = nextNumber(db, 'approval_requests', 'SELECT MAX(id) FROM approval_requests');
    const no = `APR-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`, now = Date.now();
    const id = Number(db.prepare('INSERT INTO approval_requests (no, type_id, title, details, amount, model, res_id, requester_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(no, type.id, title, clean(b?.details, 2000), amount, link?.model ?? null, link?.id ?? null, actor.id, now).id);
    const ins = db.prepare('INSERT INTO approval_request_steps (request_id, seq, label, approver_kind, approver_user_id, approver_perm, status, pending_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    tpl.forEach((s, i) => {
      let kind = s.approver_kind, userId = s.approver_user_id ? Number(s.approver_user_id) : null, perm = s.approver_perm;
      if (kind === 'unit_head') { userId = unitHead(db, requester); kind = userId ? 'user' : 'permission'; perm = userId ? null : MANAGE; }
      // المعتمد المحدد هو مقدّم الطلب نفسه: تنتقل الخطوة إلى مديري الموافقات
      if (kind === 'user' && userId === Number(actor.id)) { kind = 'permission'; userId = null; perm = MANAGE; }
      const active = type.mode === 'parallel' || i === 0;
      ins.run(id, i + 1, s.label, kind, userId, perm, active ? 'pending' : 'waiting', active ? now : null);
    });
    const r = reqRow(db, id), steps = stepsOf(db, id);
    follow(db, 'approval', id, [actor.id]);
    postMessage(db, actor, 'approval', id, { kind: 'system', body: `قُدّم الطلب (${type.name})${amount !== null ? ` بمبلغ ${amount.toLocaleString('en-US')}` : ''}` }, { silent: true });
    if (link) postMessage(db, actor, link.model, link.id, { kind: 'system', body: `قُدّم عليه طلب موافقة ${no}: ${title}` }, { silent: true });
    announcePending(db, r, steps, actor.id);
    audit(db, actor, 'تقديم طلب موافقة', `${no}: ${title}`, ip);
    emit(db, 'approval.submitted', payloadOf(db, r, steps, actor.id));
    return { id, no };
  });
}

function payloadOf(db, r, steps, actorId) {
  return { model: 'approval', resId: Number(r.id), no: r.no, title: r.title, typeCode: r.type_code, amount: r.amount === null ? null : Number(r.amount),
    requesterId: Number(r.requester_id), approverIds: pendingApprovers(db, steps), linkedModel: r.model, linkedId: r.res_id ? Number(r.res_id) : null, actorId };
}

/* ===== القرار ===== */
export function decideApproval(db, actor, id, b, ip) {
  staffOnly(actor);
  const decision = b?.decision === 'reject' ? 'reject' : b?.decision === 'approve' ? 'approve' : null;
  if (!decision) throw bad('القرار اعتماد أو رفض.');
  const note = clean(b?.note, 1000);
  if (decision === 'reject' && note.length < 3) throw bad('اكتب سبب الرفض.');
  let final = null;
  const out = withLock(db, `approval:${Number(id)}`, () => {
    const r = reqRow(db, id);
    if (!r || !canSee(db, actor, r)) throw bad('الطلب غير موجود.', 404, 'not_found');
    if (r.status !== 'pending') throw bad('الطلب منتهٍ.', 409, 'conflict');
    const steps = stepsOf(db, r.id);
    if (Number(r.requester_id) === Number(actor.id)) throw bad('لا يعتمد مقدّم الطلب طلبه.', 403, 'forbidden');
    if (decidedBy(steps, actor)) throw bad('بتَّ في خطوة من هذا الطلب؛ لا يعتمد الشخص نفسه خطوتين.', 403, 'forbidden');
    const step = myStep(r, steps, actor);
    if (!step) throw bad('لا خطوة بانتظار قرارك في هذا الطلب.', 403, 'forbidden');
    const now = Date.now();
    db.prepare('UPDATE approval_request_steps SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?').run(decision === 'approve' ? 'approved' : 'rejected', actor.id, now, note, step.id);
    postMessage(db, actor, 'approval', r.id, { kind: 'system', body: `${decision === 'approve' ? 'اعتمد' : 'رفض'} ${actor.label} خطوة «${step.label}»${note ? `: ${note}` : ''}` }, { silent: true });
    let status = 'pending';
    if (decision === 'reject') {
      status = 'rejected';
      db.prepare("UPDATE approval_request_steps SET status = 'skipped' WHERE request_id = ? AND status IN ('waiting', 'pending')").run(r.id);
    } else {
      const left = stepsOf(db, r.id);
      if (r.mode === 'sequential') {
        const next = left.find((s) => s.status === 'waiting');
        if (next) {
          db.prepare("UPDATE approval_request_steps SET status = 'pending', pending_since = ? WHERE id = ?").run(now, next.id);
          announcePending(db, r, stepsOf(db, r.id), r.requester_id);
        } else status = 'approved';
      } else if (!left.some((s) => s.status === 'pending')) status = 'approved';
    }
    if (status !== 'pending') {
      db.prepare('UPDATE approval_requests SET status = ?, decided_at = ? WHERE id = ?').run(status, now, r.id);
      track(db, actor, 'approval', r.id, [{ field: 'status', label: 'الحالة', from: STATUS.pending, to: STATUS[status] }]);
      const msg = `${status === 'approved' ? 'اعتُمد' : 'رُفض'} طلب الموافقة ${r.no} — ${r.title}${status === 'rejected' ? `: ${note}` : ''}`;
      notifyUsers(db, [r.requester_id, ...followersOf(db, 'approval', r.id)].filter((u) => Number(u) !== Number(actor.id)), 'approval_done', Number(r.id), msg, `?view=hub&tab=approvals&id=${r.id}`);
      if (r.model) postMessage(db, actor, r.model, r.res_id, { kind: 'system', body: msg }, { silent: true });
      final = { r: { ...r, status }, steps: stepsOf(db, r.id) };
      const hook = outcomeHooks.get(r.type_code);
      if (hook) hook(db, { ...r, status }, actor);
    }
    follow(db, 'approval', r.id, [actor.id]);
    audit(db, actor, decision === 'approve' ? 'اعتماد خطوة موافقة' : 'رفض طلب موافقة', `${r.no} (${step.label})`, ip);
    return { ok: true, status };
  });
  if (final) emit(db, final.r.status === 'approved' ? 'approval.approved' : 'approval.rejected', payloadOf(db, final.r, final.steps, actor.id));
  return out;
}

export function cancelApproval(db, actor, id, b, ip) {
  staffOnly(actor);
  return withLock(db, `approval:${Number(id)}`, () => {
    const r = reqRow(db, id);
    if (!r || !canSee(db, actor, r)) throw bad('الطلب غير موجود.', 404, 'not_found');
    if (Number(r.requester_id) !== Number(actor.id)) throw bad('يلغي الطلب مقدّمه.', 403, 'forbidden');
    if (r.status !== 'pending') throw bad('الطلب منتهٍ.', 409, 'conflict');
    db.prepare("UPDATE approval_requests SET status = 'cancelled', decided_at = ? WHERE id = ?").run(Date.now(), r.id);
    db.prepare("UPDATE approval_request_steps SET status = 'skipped' WHERE request_id = ? AND status IN ('waiting', 'pending')").run(r.id);
    track(db, actor, 'approval', r.id, [{ field: 'status', label: 'الحالة', from: STATUS.pending, to: STATUS.cancelled }], clean(b?.note, 500));
    audit(db, actor, 'إلغاء طلب موافقة', r.no, ip);
    return { ok: true };
  });
}

/* ===== العرض ===== */
function summary(db, r, actor, steps) {
  const step = myStep(r, steps, actor);
  return { id: Number(r.id), no: r.no, title: r.title, type: r.type_name, typeCode: r.type_code, mode: r.mode, amount: r.amount === null ? null : Number(r.amount),
    status: r.status, statusLabel: STATUS[r.status], requester: r.requester ?? nameOf(db, r.requester_id), requesterId: Number(r.requester_id), at: Number(r.created_at),
    decidedAt: r.decided_at ? Number(r.decided_at) : null, current: steps.filter((s) => s.status === 'pending').map((s) => s.label).join('، '),
    awaitingMe: !!step, linked: r.model ? { model: r.model, id: Number(r.res_id), label: modelLabel(r.model), title: recordTitle(db, r.model, r.res_id) } : null };
}

export function listApprovals(db, actor, { box = 'todo', status = '' } = {}) {
  staffOnly(actor);
  const base = 'SELECT r.*, t.code AS type_code, t.name AS type_name, t.mode, u.display_name AS requester FROM approval_requests r JOIN approval_types t ON t.id = r.type_id JOIN users u ON u.id = r.requester_id';
  let rows;
  if (box === 'mine') rows = db.prepare(`${base} WHERE r.requester_id = ? ORDER BY r.id DESC LIMIT 300`).all(actor.id);
  else if (box === 'all') {
    if (!actor.can(MANAGE) && !actor.can(READ_ALL)) throw bad('يتطلب صلاحية الاطلاع على كل طلبات الموافقة.', 403, 'forbidden');
    rows = STATUS[status] ? db.prepare(`${base} WHERE r.status = ? ORDER BY r.id DESC LIMIT 500`).all(status) : db.prepare(`${base} ORDER BY r.id DESC LIMIT 500`).all();
  } else {
    // الخطوات المفتوحة المسندة إليه باسمه أو لحملة صلاحية، ثم التصفية بصلاحياته الفعلية
    const ids = db.prepare("SELECT DISTINCT s.request_id FROM approval_request_steps s WHERE s.status = 'pending' AND (s.approver_user_id = ? OR s.approver_perm IS NOT NULL) ORDER BY s.request_id DESC LIMIT 1000").all(actor.id).map((x) => Number(x.request_id));
    rows = ids.length ? db.prepare(`${base} WHERE r.id IN (${ids.map(() => '?').join(',')}) AND r.status = 'pending' ORDER BY r.id`).all(...ids) : [];
  }
  const out = rows.map((r) => summary(db, r, actor, stepsOf(db, r.id)));
  return box === 'todo' ? out.filter((x) => x.awaitingMe) : out;
}

/* ===== الصندوق الموحّد: المحرك العام + سلاسل الوحدات ===== */
const SOURCES = new Map();
// source: { label, model, inbox(db, actor) → عناصر، decide(deps, actor, id, { decision, note, stepNo }, ip) → { status } }
export function registerApprovalSource(key, source) { SOURCES.set(key, source); }

export function unifiedInbox(db, actor) {
  staffOnly(actor);
  const items = listApprovals(db, actor, { box: 'todo' }).map((r) => ({
    source: 'approval', sourceLabel: 'الموافقات العامة', id: r.id, no: r.no, title: r.title, step: r.current, requester: r.requester, at: r.at, amount: r.amount, model: 'approval', resId: r.id,
    actions: [{ key: 'approve', label: 'اعتماد', needsNote: false }, { key: 'reject', label: 'رفض', needsNote: true }],
  }));
  for (const [key, s] of SOURCES) {
    // مصدر متعثر لا يحجب بقية الصندوق
    let list = [];
    try { list = s.inbox(db, actor); } catch (e) { log.warn(`approval source ${key}: ${e.message}`); }
    for (const x of list) items.push({ ...x, source: key, sourceLabel: s.label, model: s.model, resId: x.id });
  }
  return items;
}
export const countTodo = (db, actor) => unifiedInbox(db, actor).length;

export function decideFromInbox(deps, actor, source, id, b, ip) {
  staffOnly(actor);
  const decision = String(b?.decision ?? ''), note = clean(b?.note, 1000);
  if (source === 'approval') {
    if (!['approve', 'reject'].includes(decision)) throw bad('القرار اعتماد أو رفض.');
    return decideApproval(deps.db, actor, id, { decision, note }, ip);
  }
  const s = SOURCES.get(String(source));
  if (!s) throw bad('مصدر الموافقة غير معروف.', 404, 'not_found');
  if (!['approve', 'reject', 'return', 'not_applicable'].includes(decision)) throw bad('القرار غير معروف.');
  const before = s.inbox(deps.db, actor).find((x) => Number(x.id) === Number(id));
  const out = s.decide(deps, actor, id, { decision, note, stepNo: b?.stepNo ?? before?.stepNo }, ip);
  // القرار يُسجَّل في نقاش السجل نفسه، فيراه متابعوه مع بقية تاريخه
  const label = { approve: 'اعتماد', reject: 'رفض', return: 'إعادة للتعديل', not_applicable: 'لا ينطبق' }[decision];
  postMessage(deps.db, actor, s.model, Number(id), { kind: 'system', body: `${label} من ${actor.label}${before?.step ? ` في «${before.step}»` : ''}${note ? `: ${note}` : ''}` }, { silent: true });
  follow(deps.db, s.model, Number(id), [actor.id]);
  emit(deps.db, `approval.${decision === 'approve' ? 'step_approved' : 'step_' + decision}`, { model: s.model, resId: Number(id), title: before?.title, no: before?.no, actorId: actor.id, source });
  return { ok: true, ...out };
}

export function getApproval(db, actor, id) {
  staffOnly(actor);
  const r = reqRow(db, id);
  if (!r) throw bad('الطلب غير موجود.', 404, 'not_found');
  const steps = stepsOf(db, r.id);
  if (!canSee(db, actor, r, steps)) throw bad('الطلب غير موجود.', 404, 'not_found');
  return {
    ...summary(db, r, actor, steps), details: r.details, canCancel: r.status === 'pending' && Number(r.requester_id) === Number(actor.id),
    steps: steps.map((s) => ({ id: Number(s.id), seq: Number(s.seq), label: s.label, status: s.status, statusLabel: STEP_STATUS[s.status],
      approver: s.approver_kind === 'user' ? nameOf(db, s.approver_user_id) : `حامل صلاحية ${s.approver_perm}`, decidedBy: s.decided_by ? nameOf(db, s.decided_by) : null,
      decidedAt: s.decided_at ? Number(s.decided_at) : null, note: s.note })),
    messages: listMessages(db, 'approval', r.id), activities: listActivities(db, actor, { box: 'record', model: 'approval', resId: r.id }),
    following: followersOf(db, 'approval', r.id).includes(Number(actor.id)),
  };
}

export const approvalCatalog = () => ({ kinds: KINDS, statuses: STATUS, permissions: [...ASSIGNABLE].sort() });
