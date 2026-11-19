// الأتمتة: قواعد يعرّفها المدير من الواجهة بلا برمجة. القاعدة تنطلق عند حدث في النظام أو في الفحص الدوري كل ساعة،
// فتنفّذ إجراءً من قائمة مغلقة: إشعار، أو إنشاء نشاط، أو ملاحظة على السجل. لا يُنفَّذ أي كود يكتبه المستخدم.
// الإجراءات لا تطلق أحداثاً جديدة، فلا تتسلسل القواعد بلا نهاية.
import { audit } from '../../audit.js';
import { ASSIGNABLE } from '../../permissions.js';
import { log } from '../../lib/logger.js';
import {
  bad, clean, staffOnly, activeStaff, usersWithPerm, onEvent, notifyUsers, followersOf, postMessage, createActivity,
  recordTitle, modelKeys, modelLabel, today, addDays, remindActivities, ACTIVITY_KINDS,
} from './records.js';

export const MANAGE = 'automation:manage';
export const EVENTS = {
  'approval.submitted': 'تقديم طلب موافقة',
  'approval.approved': 'اعتماد طلب موافقة نهائياً',
  'approval.rejected': 'رفض طلب موافقة',
  'activity.created': 'إنشاء نشاط',
  'activity.done': 'إنجاز نشاط',
  'message.posted': 'تعليق أو ملاحظة على سجل',
};
export const SCHEDULES = {
  activity_overdue: 'نشاط مفتوح تجاوز موعده بعدد أيام',
  approval_stale: 'خطوة موافقة معلّقة دون قرار منذ عدد أيام',
};
export const ACTIONS = { notify: 'إرسال إشعار', create_activity: 'إنشاء نشاط', post_note: 'ملاحظة على السجل' };
export const RECIPIENTS = {
  requester: 'مقدّم الطلب', assignee: 'المسند إليه', creator: 'منشئ النشاط', approvers: 'المعتمدون المنتظَرون',
  followers: 'متابعو السجل', user: 'موظف محدد', permission: 'حملة صلاحية',
};

function parseRule(db, b) {
  const name = clean(b?.name, 120);
  if (name.length < 3) throw bad('اسم القاعدة مطلوب.');
  const trigger = b?.trigger === 'schedule' ? 'schedule' : 'event';
  const event = String(b?.event ?? '');
  if (trigger === 'event' ? !EVENTS[event] : !SCHEDULES[event]) throw bad('الحدث أو الفحص الدوري غير معروف.');
  const c = b?.condition ?? {}, condition = {};
  if (c.typeCode) condition.typeCode = clean(c.typeCode, 40);
  if (c.model) { if (!modelKeys().includes(c.model)) throw bad('نوع السجل في الشرط غير معروف.'); condition.model = c.model; }
  if (c.minAmount !== undefined && c.minAmount !== '' && c.minAmount !== null) {
    const m = Number(c.minAmount); if (!Number.isInteger(m) || m < 0) throw bad('حد المبلغ عدد صحيح غير سالب.'); condition.minAmount = m;
  }
  if (trigger === 'schedule') {
    const d = Number(c.days ?? 0); if (!Number.isInteger(d) || d < 0 || d > 365) throw bad('عدد الأيام من 0 إلى 365.'); condition.days = d;
  }
  const action = String(b?.action ?? '');
  if (!ACTIONS[action]) throw bad('الإجراء غير معروف.');
  const a = b?.params ?? {}, params = {};
  if (action === 'notify' || action === 'create_activity') {
    const to = String(a.to ?? '');
    if (!RECIPIENTS[to]) throw bad('حدّد المستلم.');
    if (action === 'create_activity' && ['followers', 'approvers', 'permission'].includes(to)) throw bad('النشاط يُسند إلى شخص واحد.');
    params.to = to;
    if (to === 'user') params.userId = activeStaff(db, a.userId).id;
    if (to === 'permission') { if (!ASSIGNABLE.has(String(a.perm))) throw bad('الصلاحية غير معروفة.'); params.perm = String(a.perm); }
  }
  const text = clean(a.text, 300);
  if ((action === 'notify' || action === 'post_note') && text.length < 3) throw bad('اكتب نص الإشعار أو الملاحظة.');
  params.text = text;
  if (action === 'create_activity') {
    params.title = clean(a.title, 160);
    if (params.title.length < 3) throw bad('عنوان النشاط مطلوب.');
    params.kind = ACTIVITY_KINDS[a.kind] ? a.kind : 'todo';
    const d = Number(a.dueDays ?? 1); if (!Number.isInteger(d) || d < 0 || d > 365) throw bad('مهلة النشاط من 0 إلى 365 يوماً.'); params.dueDays = d;
  }
  return { name, trigger, event, condition, action, params, active: b?.active === false ? 0 : 1 };
}

const ruleView = (r) => ({ id: Number(r.id), name: r.name, active: !!Number(r.active), trigger: r.trigger_kind, event: r.event, eventLabel: EVENTS[r.event] ?? SCHEDULES[r.event] ?? r.event,
  condition: JSON.parse(r.condition_json || '{}'), action: r.action, actionLabel: ACTIONS[r.action], params: JSON.parse(r.action_json || '{}'),
  lastRunAt: r.last_run_at ? Number(r.last_run_at) : null, runCount: Number(r.run_count) });

const manager = (actor) => { staffOnly(actor); if (!actor.can(MANAGE)) throw bad('يتطلب صلاحية إدارة قواعد الأتمتة.', 403, 'forbidden'); return actor; };

export function automationOverview(db, actor) {
  manager(actor);
  return {
    rules: db.prepare('SELECT * FROM automation_rules ORDER BY id').all().map(ruleView),
    log: db.prepare('SELECT l.*, r.name FROM automation_log l JOIN automation_rules r ON r.id = l.rule_id ORDER BY l.id DESC LIMIT 200').all()
      .map((l) => ({ id: Number(l.id), rule: l.name, ref: l.ref, outcome: l.outcome, at: Number(l.at) })),
    catalog: { events: EVENTS, schedules: SCHEDULES, actions: ACTIONS, recipients: RECIPIENTS, activityKinds: ACTIVITY_KINDS,
      models: Object.fromEntries(modelKeys().map((k) => [k, modelLabel(k)])), permissions: [...ASSIGNABLE].sort(),
      types: db.prepare('SELECT code, name FROM approval_types ORDER BY name').all() },
  };
}

export function saveRule(db, actor, id, b, ip) {
  manager(actor);
  const r = parseRule(db, b);
  const vals = [r.name, r.active, r.trigger, r.event, JSON.stringify(r.condition), r.action, JSON.stringify(r.params)];
  if (id) {
    if (!db.prepare('SELECT 1 AS x FROM automation_rules WHERE id = ?').get(Number(id))) throw bad('القاعدة غير موجودة.', 404, 'not_found');
    db.prepare('UPDATE automation_rules SET name = ?, active = ?, trigger_kind = ?, event = ?, condition_json = ?, action = ?, action_json = ? WHERE id = ?').run(...vals, Number(id));
  } else id = Number(db.prepare('INSERT INTO automation_rules (name, active, trigger_kind, event, condition_json, action, action_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').get(...vals, actor.id, Date.now()).id);
  audit(db, actor, 'حفظ قاعدة أتمتة', r.name, ip);
  return { id: Number(id) };
}

export function deleteRule(db, actor, id, ip) {
  manager(actor);
  const r = db.prepare('SELECT name FROM automation_rules WHERE id = ?').get(Number(id));
  if (!r) throw bad('القاعدة غير موجودة.', 404, 'not_found');
  db.prepare('DELETE FROM automation_rules WHERE id = ?').run(Number(id));
  audit(db, actor, 'حذف قاعدة أتمتة', r.name, ip);
  return { ok: true };
}

/* ===== التنفيذ ===== */
const fill = (text, p) => String(text ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k) => (p[k] ?? p.extra?.[k] ?? '')).slice(0, 300);

function matches(cond, p) {
  if (cond.typeCode && cond.typeCode !== p.typeCode) return false;
  if (cond.model && cond.model !== p.model && cond.model !== p.linkedModel) return false;
  if (cond.minAmount !== undefined && !(Number(p.amount ?? -1) >= cond.minAmount)) return false;
  return true;
}

function recipients(db, params, p) {
  switch (params.to) {
    case 'requester': return [p.requesterId];
    case 'assignee': return [p.assigneeId];
    case 'creator': return [p.creatorId];
    case 'approvers': return p.approverIds ?? [];
    case 'followers': return p.model && p.resId ? followersOf(db, p.model, p.resId) : [];
    case 'user': return [params.userId];
    case 'permission': return usersWithPerm(db, params.perm);
    default: return [];
  }
}

function execute(db, rule, p, ref) {
  const params = JSON.parse(rule.action_json || '{}');
  const vars = { ...p, title: p.title ?? recordTitle(db, p.model, p.resId) ?? '', no: p.no ?? '', record: p.model ? `${modelLabel(p.model)} ${recordTitle(db, p.model, p.resId) ?? ''}` : '' };
  let outcome;
  if (rule.action === 'notify') {
    const to = recipients(db, params, p).filter(Boolean);
    const url = p.model === 'approval' ? `?view=hub&tab=approvals&id=${p.resId}` : p.model ? `?view=hub&rec=${p.model}:${p.resId}` : '?view=hub';
    notifyUsers(db, to, `auto_${rule.id}`, null, fill(params.text, vars), url);
    outcome = `إشعار إلى ${to.length}`;
  } else if (rule.action === 'post_note') {
    if (!p.model || !p.resId) return 'لا سجل للملاحظة';
    postMessage(db, null, p.model, p.resId, { kind: 'note', body: `[${rule.name}] ${fill(params.text, vars)}` }, { silent: true });
    outcome = 'ملاحظة على السجل';
  } else {
    const assignee = recipients(db, params, p).filter(Boolean)[0];
    if (!assignee) return 'لا مسند إليه';
    const r = createActivity(db, null, { kind: params.kind, title: fill(params.title, vars), note: fill(params.text, vars), assigneeId: assignee, dueDate: addDays(today(), params.dueDays ?? 1),
      ...(p.model && p.resId ? { model: p.model, resId: p.resId } : {}) }, null, { system: true });
    outcome = `نشاط #${r.id}`;
  }
  db.prepare('UPDATE automation_rules SET last_run_at = ?, run_count = run_count + 1 WHERE id = ?').run(Date.now(), rule.id);
  if (ref) db.prepare('UPDATE automation_log SET outcome = ? WHERE rule_id = ? AND ref = ?').run(outcome, rule.id, ref);
  return outcome;
}

// يُسجَّل السطر أولاً بمفتاح فريد، فلا تتكرر القاعدة على السجل نفسه ولو من عمليتين
function claim(db, ruleId, ref) {
  return !!db.prepare('INSERT INTO automation_log (rule_id, ref, outcome, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id').get(ruleId, ref, '…', Date.now());
}

function runRule(db, rule, p, ref) {
  if (!claim(db, rule.id, ref)) return;
  try { execute(db, rule, p, ref); }
  catch (e) {
    log.warn(`automation rule ${rule.id}: ${e.message}`);
    db.prepare('UPDATE automation_log SET outcome = ? WHERE rule_id = ? AND ref = ?').run(`خطأ: ${String(e.message).slice(0, 200)}`, rule.id, ref);
  }
}

let eventSeq = 0;
onEvent((db, event, p) => {
  const rules = db.prepare("SELECT * FROM automation_rules WHERE active = 1 AND trigger_kind = 'event' AND event = ?").all(event);
  const stamp = `${event}:${p.model ?? '-'}:${p.resId ?? '-'}:${p.activityId ?? ''}:${Date.now()}:${process.pid}:${++eventSeq}`;
  for (const rule of rules) if (matches(JSON.parse(rule.condition_json || '{}'), p)) runRule(db, rule, p, stamp);
});

export function runScheduled(db, now = Date.now()) {
  let fired = 0;
  const rules = db.prepare("SELECT * FROM automation_rules WHERE active = 1 AND trigger_kind = 'schedule'").all();
  for (const rule of rules) {
    const cond = JSON.parse(rule.condition_json || '{}'), days = Number(cond.days ?? 0);
    if (rule.event === 'activity_overdue') {
      const cutoff = addDays(today(now), -days);
      const rows = db.prepare("SELECT * FROM activities WHERE status = 'open' AND due_date < ? ORDER BY id LIMIT 1000").all(cutoff);
      for (const a of rows) {
        const p = { model: a.model, resId: a.res_id ? Number(a.res_id) : null, title: a.title, activityId: Number(a.id), assigneeId: Number(a.assignee_id), creatorId: Number(a.creator_id), extra: { due: a.due_date } };
        if (!matches(cond, p)) continue;
        runRule(db, rule, p, `activity:${a.id}`); fired++;
      }
    } else if (rule.event === 'approval_stale') {
      const rows = db.prepare(`SELECT s.id AS step_id, s.label, s.approver_kind, s.approver_user_id, s.approver_perm, r.* , t.code AS type_code FROM approval_request_steps s
        JOIN approval_requests r ON r.id = s.request_id JOIN approval_types t ON t.id = r.type_id
        WHERE s.status = 'pending' AND r.status = 'pending' AND s.pending_since < ? ORDER BY s.id LIMIT 1000`).all(now - days * 86_400_000);
      for (const s of rows) {
        const approverIds = s.approver_kind === 'user' ? [Number(s.approver_user_id)] : usersWithPerm(db, s.approver_perm);
        const p = { model: 'approval', resId: Number(s.id), no: s.no, title: s.title, typeCode: s.type_code, amount: s.amount === null ? null : Number(s.amount),
          requesterId: Number(s.requester_id), approverIds, linkedModel: s.model, extra: { step: s.label } };
        if (!matches(cond, p)) continue;
        runRule(db, rule, p, `step:${s.step_id}`); fired++;
      }
    }
  }
  return { fired };
}

// المهمة الدورية للمنصة (كل ساعة): تذكير الأنشطة ثم القواعد المجدولة
export function platformTick(db, now = Date.now()) {
  const reminded = remindActivities(db, now);
  const scheduled = runScheduled(db, now);
  return { ...reminded, ...scheduled };
}

export function runNow(db, actor, ip) {
  manager(actor);
  const out = platformTick(db);
  audit(db, actor, 'تشغيل الفحص الدوري للأتمتة يدوياً', JSON.stringify(out), ip);
  return out;
}
