// مصادر الموافقة: سلاسل الاعتماد القائمة في الوحدات (المشتريات، المراسلات، حركات القيد) تظهر في صندوق «بانتظار قراري» الموحّد.
// لا تُعاد كتابة منطقها: كل مصدر يعرض ما ينتظر المستخدم كما تحسبه وحدته، ويمرّر القرار إلى دالة الوحدة نفسها بقواعدها
// (حدود المبالغ، براءة الذمة، رقم الصادر، فصل المهام)، ثم يُسجَّل القرار في نقاش السجل.
import { withLock } from '../numbering.js';
import { approvalStage, decideRequest, returnRequest } from '../procurement/core.js';
import { decideDoc, canSee as corrCanSee } from '../correspondence.js';
import { movementQueue, decideMovementStep } from '../student_affairs_suite.js';
import { assertStudentInScope } from '../students.js';
import { registerModel, nameOf, bad } from './records.js';
import { registerApprovalSource } from './approvals.js';

const NOTE_REQUIRED = { reject: true, return: true };
const act = (key, label) => ({ key, label, needsNote: !!NOTE_REQUIRED[key] });

/* ===== المراسلات ===== */
registerModel('corr', {
  label: 'مراسلة',
  title: (db, id) => { const d = db.prepare('SELECT no, title FROM corr_docs WHERE id = ?').get(id); return d ? `${d.no} — ${d.title}` : null; },
  canRead: (db, u, id) => { const d = db.prepare('SELECT * FROM corr_docs WHERE id = ?').get(id); return !!d && corrCanSee(u, db, d); },
});
registerApprovalSource('corr', {
  label: 'المراسلات', model: 'corr',
  inbox(db, actor) {
    if (!actor.can('corr:use')) return [];
    // دوره الآن: في التسلسلي أول من لم يبت، وفي المتوازي كل من لم يبت
    return db.prepare(`SELECT d.*, a.seq, u.display_name AS creator FROM corr_docs d JOIN corr_approvers a ON a.doc_id = d.id AND a.user_id = ? AND a.state = 'pending'
        JOIN users u ON u.id = d.creator_id WHERE d.status = 'pending' AND (d.mode = 'parallel' OR NOT EXISTS (SELECT 1 FROM corr_approvers b WHERE b.doc_id = d.id AND b.state = 'pending' AND b.seq < a.seq))
        ORDER BY d.id LIMIT 300`).all(actor.id)
      .map((d) => ({ id: Number(d.id), no: d.no, title: d.title, step: d.mode === 'parallel' ? 'اعتماد متوازٍ' : `المعتمد رقم ${d.seq}`, requester: d.creator, at: Number(d.sent_at ?? d.created_at), amount: null,
        actions: [act('approve', 'اعتماد'), act('reject', 'رفض')] }));
  },
  decide(deps, actor, id, b, ip) {
    if (!actor.can('corr:use')) throw bad('لا تملك صلاحية المراسلات.', 403, 'forbidden');
    const doc = withLock(deps.db, `corr:${Number(id)}`, () => decideDoc(deps, actor, id, b.decision === 'approve' ? 'approve' : 'reject', b.note, ip));
    return { status: doc.status };
  },
});

/* ===== طلبات الشراء ===== */
const PROC_PERMS = ['procurement:manage', 'procurement:approve_finance', 'procurement:approve_top'];
registerApprovalSource('procurement', {
  label: 'المشتريات', model: 'proc_request',
  inbox(db, actor) {
    if (!PROC_PERMS.some((p) => actor.can(p))) return [];
    return db.prepare("SELECT r.*, u.display_name AS requester FROM proc_requests r LEFT JOIN users u ON u.id = r.requester_id WHERE r.status = 'pending' ORDER BY r.id LIMIT 300").all()
      .map((r) => ({ r, st: approvalStage(db, r) }))
      .filter(({ r, st }) => st.next && actor.can(st.next.perm) && Number(r.requester_id) !== Number(actor.id) && !st.done.some((x) => x.userId === Number(actor.id)))
      .map(({ r, st }) => ({ id: Number(r.id), no: r.no, title: r.title, step: st.next.label, requester: r.requester ?? '—', at: Number(r.requested_at ?? r.created_at), amount: st.total,
        actions: [act('approve', 'اعتماد'), act('reject', 'رفض'), act('return', 'إعادة للتعديل')] }));
  },
  decide(deps, actor, id, b, ip) {
    if (b.decision === 'return') return { status: returnRequest(deps, actor, id, b.note, ip).request?.status ?? 'draft' };
    const out = decideRequest(deps, actor, id, b.decision === 'approve' ? 'approved' : 'rejected', b.note, ip);
    return { status: out.request?.status ?? null };
  },
});

/* ===== حركات القيد ===== */
const MOVEMENT_TYPE = { postponement: 'تأجيل', suspension: 'إيقاف قيد', withdrawal: 'انسحاب', reinstatement: 'إعادة قيد', program_transfer: 'تحويل برنامج', disciplinary_suspension: 'إيقاف تأديبي', dismissal: 'فصل', graduation: 'تخرج' };
registerModel('movement', {
  label: 'حركة قيد',
  title: (db, id) => { const m = db.prepare('SELECT movement_no, movement_type, student_id FROM sa_lifecycle_movements WHERE id = ?').get(id); return m ? `${m.movement_no} — ${MOVEMENT_TYPE[m.movement_type] ?? m.movement_type} (${nameOf(db, m.student_id)})` : null; },
  canRead: (db, u, id) => {
    const m = db.prepare('SELECT student_id FROM sa_lifecycle_movements WHERE id = ?').get(id);
    if (!m) return false;
    if (movementQueue(db, u).some((x) => Number(x.id) === Number(id))) return true;
    if (!u.can('student:read')) return false;
    try { assertStudentInScope({ db }, u, m.student_id); return true; } catch { return false; }
  },
});
registerApprovalSource('movement', {
  label: 'حركات القيد', model: 'movement',
  inbox(db, actor) {
    return movementQueue(db, actor).filter((m) => !m.blockedSelf).map((m) => ({
      id: Number(m.id), no: m.movement_no, title: `${MOVEMENT_TYPE[m.movement_type] ?? m.movement_type}: ${m.studentName ?? ''} (${m.studentNo ?? ''})`,
      // مستحقات الطالب وإعاراته تظهر مع مرحلة براءة الذمة، لا في عمود المبلغ
      step: `${m.label} (${m.current_step}/${m.total})${m.due ? ` — مستحقات ${Number(m.due).toLocaleString('en-US')}` : ''}${m.openLoans ? ` — إعارات ${m.openLoans}` : ''}`,
      requester: m.created_by ?? '—', at: null, amount: null, stepNo: Number(m.current_step),
      actions: [act('approve', 'موافقة'), act('reject', 'رفض'), ...(m.allowNa ? [act('not_applicable', 'لا ينطبق')] : [])],
    }));
  },
  decide(deps, actor, id, b, ip) {
    const out = withLock(deps.db, `movement:${Number(id)}`, () => decideMovementStep(deps, actor, id, { decision: b.decision, note: b.note, stepNo: b.stepNo }, ip));
    return { status: out.status ?? null };
  },
});
