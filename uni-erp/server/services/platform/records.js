// طبقة السجل المشتركة: النقاش والملاحظات وتتبع التغييرات والمتابعون والأنشطة على أي سجل في النظام.
// كل وحدة تسجّل نموذجها مرة واحدة (registerModel) بعنوانه وقاعدة رؤيته، فيصير لسجلاتها نقاش وأنشطة دون جداول جديدة.
// قاعدة الرؤية هي قاعدة الوحدة نفسها: من لا يرى السجل لا يرى نقاشه ولا أنشطته (404 لا 403، فلا يُكشف وجوده).
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
import { effective } from '../../permissions.js';
import { getCachedUnitTree } from '../../cache.js';
import { notify as pushNotify } from '../push.js';
import { log } from '../../lib/logger.js';
import { assertStudentInScope } from '../students.js';

export const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
export const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// اليوم بتوقيت دمشق، فلا يتقدّم «المتأخر» ثلاث ساعات بتوقيت الخادم
export const today = (now = Date.now()) => new Date(now).toLocaleString('sv-SE', { timeZone: 'Asia/Damascus' }).slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const nameOf = (db, id) => (id ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(Number(id))?.display_name ?? '—' : '—');

export function staffOnly(user) {
  if (!user || user.role === 'student') throw bad('هذه الخدمة للموظفين.', 403, 'forbidden');
  return user;
}

// مستخدم من قاعدة البيانات بصلاحياته الفعلية، لفحص ما يراه شخص غير صاحب الجلسة (المسند إليه، المعتمد)
export function userById(db, id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!row) return null;
  const perms = new Set(effective(db, row));
  return { ...row, id: Number(row.id), label: row.display_name, roleKey: row.role_key ?? row.role, can: (p) => perms.has(p), unitIds: row.unit_id ? getCachedUnitTree(db, row.unit_id) : [] };
}
export function activeStaff(db, id) {
  const u = userById(db, id);
  if (!u || !Number(u.active) || u.role === 'student') throw bad('الموظف غير موجود أو غير فعّال.', 404, 'not_found');
  return u;
}
// حاملو صلاحية بعينها من الموظفين الفعّالين (للإشعار بخطوة موافقة مفتوحة لكل من يملكها)
export function usersWithPerm(db, perm) {
  return db.prepare("SELECT * FROM users WHERE active = 1 AND role <> 'student' ORDER BY id LIMIT 5000").all()
    .filter((u) => effective(db, u).includes(perm)).map((u) => Number(u.id));
}

/* ===== سجل النماذج ===== */
const MODELS = new Map();
export function registerModel(key, def) { MODELS.set(key, def); }
export const modelKeys = () => [...MODELS.keys()];
export const modelLabel = (key) => MODELS.get(key)?.label ?? key;

export function recordTitle(db, model, id) {
  const def = MODELS.get(model);
  try { return def ? def.title(db, Number(id)) : null; } catch { return null; }
}

export function assertRecord(db, user, model, id) {
  staffOnly(user);
  const def = MODELS.get(String(model ?? ''));
  if (!def) throw bad('نوع السجل غير معروف.');
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) throw bad('رقم السجل غير صالح.');
  const title = def.title(db, rid);
  if (title == null || !def.canRead(db, user, rid)) throw bad('السجل غير موجود.', 404, 'not_found');
  return { model, id: rid, title, label: def.label };
}
export function canReadRecord(db, user, model, id) {
  try { assertRecord(db, user, model, id); return true; } catch { return false; }
}

// النماذج القائمة في النظام؛ الموافقات تسجّل نموذجها من approvals.js
registerModel('request', {
  label: 'طلب طالب',
  title: (db, id) => { const r = db.prepare('SELECT r.no, s.label FROM requests r LEFT JOIN service_types s ON s.code = r.service_code WHERE r.id = ?').get(id); return r ? `${r.no} — ${r.label ?? ''}` : null; },
  canRead: (db, u, id) => {
    if (u.can('request:read_all')) return true;
    if (!u.can('request:read_unit')) return false;
    const r = db.prepare('SELECT assigned_unit_id FROM requests WHERE id = ?').get(id);
    return !!r && (u.unitIds ?? []).map(Number).includes(Number(r.assigned_unit_id));
  },
});
registerModel('proc_request', {
  label: 'طلب شراء',
  title: (db, id) => { const r = db.prepare('SELECT no, title FROM proc_requests WHERE id = ?').get(id); return r ? `${r.no} — ${r.title}` : null; },
  canRead: (db, u, id) => ['procurement:read', 'procurement:manage'].some((p) => u.can(p)) || Number(db.prepare('SELECT requester_id FROM proc_requests WHERE id = ?').get(id)?.requester_id) === Number(u.id),
});
registerModel('maintenance', {
  label: 'أمر صيانة',
  title: (db, id) => { const r = db.prepare('SELECT no, category, location FROM maintenance_orders WHERE id = ?').get(id); return r ? `${r.no} — ${r.category} (${r.location})` : null; },
  canRead: (db, u, id) => {
    if (u.can('facilities:manage')) return true;
    const r = db.prepare('SELECT requester_id, assignee_id FROM maintenance_orders WHERE id = ?').get(id);
    return !!r && [r.requester_id, r.assignee_id].map(Number).includes(Number(u.id));
  },
});
registerModel('student', {
  label: 'ملف طالب',
  title: (db, id) => { const r = db.prepare('SELECT p.first_name, p.father_name, p.last_name, u.student_no FROM student_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?').get(id); return r ? `${[r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ')} (${r.student_no})` : null; },
  canRead: (db, u, id) => { if (!u.can('student:read')) return false; try { assertStudentInScope({ db }, u, id); return true; } catch { return false; } },
});
registerModel('employee', {
  label: 'ملف موظف',
  title: (db, id) => { const r = db.prepare('SELECT employeeNo AS no, name FROM hr_employees WHERE id = ?').get(id); return r ? `${r.name} (${r.no})` : null; },
  canRead: (_db, u) => ['hr_emp:view', 'hr:manage'].some((p) => u.can(p)),
});

/* ===== الأحداث (تستهلكها الأتمتة) ===== */
// تُعالَج بعد انتهاء الطلب الحالي ومعاملته: فشل قاعدة أتمتة لا يُفسد معاملة الإجراء الأصلي
const listeners = [];
export function onEvent(fn) { listeners.push(fn); }
export function emit(db, event, payload) {
  if (!listeners.length) return;
  setImmediate(() => { for (const fn of listeners) { try { fn(db, event, payload); } catch (e) { log.warn(`platform event ${event}: ${e.message}`); } } });
}

/* ===== الإشعارات ===== */
let pushDeps = null;
export const setPushDeps = (deps) => { pushDeps = deps; };
export function notifyUsers(db, ids, kind, ref, text, url = '?view=hub') {
  const list = [...new Set((ids ?? []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!list.length) return;
  const ins = db.prepare('INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'), now = Date.now();
  for (const id of list) ins.run(id, kind, ref ?? null, clean(text, 300), url, now);
  if (pushDeps?.cfg) pushNotify(pushDeps, list, { title: 'مركز العمل', body: clean(text, 160), url: '/' + url, tag: `${kind}-${ref ?? ''}` });
}

/* ===== المتابعون ===== */
export function follow(db, model, id, userIds) {
  const ins = db.prepare('INSERT INTO record_followers (model, res_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'), now = Date.now();
  for (const u of new Set((userIds ?? []).map(Number).filter(Boolean))) ins.run(model, Number(id), u, now);
}
export const unfollow = (db, model, id, userId) => db.prepare('DELETE FROM record_followers WHERE model = ? AND res_id = ? AND user_id = ?').run(model, Number(id), Number(userId));
export const followersOf = (db, model, id) => db.prepare('SELECT user_id FROM record_followers WHERE model = ? AND res_id = ?').all(model, Number(id)).map((r) => Number(r.user_id));

/* ===== الرسائل وتتبع التغييرات ===== */
const MSG_KINDS = ['comment', 'note', 'tracking', 'system'];
export function postMessage(db, actor, model, id, { kind = 'comment', body = '', tracking = [] }, { silent = false } = {}) {
  if (!MSG_KINDS.includes(kind)) throw bad('نوع الرسالة غير صالح.');
  const text = clean(body, 4000);
  if ((kind === 'comment' || kind === 'note') && text.length < 1) throw bad('اكتب نص التعليق.');
  const authorId = actor?.id ? Number(actor.id) : null;
  const msgId = Number(db.prepare('INSERT INTO record_messages (model, res_id, kind, body, tracking_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(model, Number(id), kind, text, JSON.stringify(tracking ?? []), authorId, Date.now()).id);
  if (authorId && (kind === 'comment' || kind === 'note')) follow(db, model, id, [authorId]);
  // الملاحظة الداخلية لا تُشعر أحداً؛ التعليق يُشعر المتابعين عدا كاتبه
  if (kind === 'comment' && !silent) {
    const title = recordTitle(db, model, id) ?? '';
    notifyUsers(db, followersOf(db, model, id).filter((u) => u !== authorId), 'chatter', msgId, `${actor?.label ?? 'النظام'} علّق على ${modelLabel(model)} ${title}: ${text.slice(0, 120)}`, `?view=hub&rec=${model}:${id}`);
  }
  // ما يكتبه النظام أو الأتمتة (بلا كاتب) لا يطلق حدثاً، فلا تتسلسل القواعد
  if (authorId && (kind === 'comment' || kind === 'note')) emit(db, 'message.posted', { model, resId: Number(id), title: recordTitle(db, model, id), actorId: authorId, kind, body: text });
  return { id: msgId };
}
// ما تغيّر بين نسختين من السجل، بأسماء الحقول المعروضة: fields = { column: 'التسمية' }
export function diff(before, after, fields) {
  const out = [];
  for (const [k, label] of Object.entries(fields)) {
    const a = before?.[k] ?? null, b = after?.[k] ?? null;
    if (String(a ?? '') !== String(b ?? '')) out.push({ field: k, label, from: a, to: b });
  }
  return out;
}
export function track(db, actor, model, id, changes, body = '') {
  if (!changes?.length) return null;
  return postMessage(db, actor, model, id, { kind: 'tracking', body, tracking: changes }, { silent: true });
}
export function listMessages(db, model, id) {
  return db.prepare('SELECT m.*, u.display_name AS author FROM record_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.model = ? AND m.res_id = ? ORDER BY m.id DESC LIMIT 300').all(model, Number(id))
    .map((m) => ({ id: Number(m.id), kind: m.kind, body: m.body, tracking: JSON.parse(m.tracking_json || '[]'), author: m.author ?? 'النظام', authorId: m.author_id ? Number(m.author_id) : null, at: Number(m.created_at) }));
}

export function recordThread(db, actor, model, id) {
  const rec = assertRecord(db, actor, model, id);
  const followers = db.prepare('SELECT f.user_id, u.display_name FROM record_followers f JOIN users u ON u.id = f.user_id WHERE f.model = ? AND f.res_id = ? ORDER BY u.display_name').all(model, rec.id)
    .map((f) => ({ id: Number(f.user_id), name: f.display_name }));
  return { record: rec, messages: listMessages(db, model, rec.id), followers, following: followers.some((f) => f.id === Number(actor.id)), activities: listActivities(db, actor, { box: 'record', model, resId: rec.id }) };
}
export function postToRecord(db, actor, model, id, b, ip) {
  const rec = assertRecord(db, actor, model, id);
  const kind = b?.kind === 'note' ? 'note' : 'comment';
  const out = postMessage(db, actor, model, rec.id, { kind, body: b?.body });
  audit(db, actor, kind === 'note' ? 'ملاحظة داخلية على سجل' : 'تعليق على سجل', `${model}:${rec.id}`, ip);
  return out;
}
export function setFollow(db, actor, model, id, on) {
  const rec = assertRecord(db, actor, model, id);
  if (on) follow(db, model, rec.id, [actor.id]); else unfollow(db, model, rec.id, actor.id);
  return { following: !!on };
}

/* ===== الأنشطة والمهام ===== */
export const ACTIVITY_KINDS = { todo: 'مهمة', call: 'اتصال', meeting: 'اجتماع', review: 'مراجعة', deadline: 'موعد نهائي' };

function activityView(db, a, actor) {
  const due = a.due_date, t = today();
  return {
    id: Number(a.id), kind: a.kind, kindLabel: ACTIVITY_KINDS[a.kind], title: a.title, note: a.note, due, status: a.status,
    overdue: a.status === 'open' && due < t, dueToday: a.status === 'open' && due === t,
    assigneeId: Number(a.assignee_id), assignee: a.assignee ?? nameOf(db, a.assignee_id), creatorId: Number(a.creator_id), creator: a.creator ?? nameOf(db, a.creator_id),
    model: a.model ?? null, resId: a.res_id ? Number(a.res_id) : null, record: a.model ? recordTitle(db, a.model, a.res_id) : null, modelLabel: a.model ? modelLabel(a.model) : null,
    doneNote: a.done_note, doneAt: a.done_at ? Number(a.done_at) : null, at: Number(a.created_at),
    canEdit: a.status === 'open' && actor && [Number(a.assignee_id), Number(a.creator_id)].includes(Number(actor.id)),
  };
}

export function createActivity(db, actor, b, ip, { system = false } = {}) {
  if (!system) staffOnly(actor);
  const kind = ACTIVITY_KINDS[b?.kind] ? b.kind : 'todo';
  const title = clean(b?.title, 160);
  if (title.length < 3) throw bad('عنوان النشاط مطلوب (3 أحرف على الأقل).');
  const due = String(b?.dueDate ?? '');
  if (!DAY_RE.test(due)) throw bad('تاريخ الاستحقاق غير صالح.');
  if (!system && due < today()) throw bad('لا يُحدَّد موعد في الماضي.');
  const assignee = activeStaff(db, b?.assigneeId ? Number(b.assigneeId) : actor?.id);
  let model = null, resId = null;
  if (b?.model) {
    const rec = system ? { model: b.model, id: Number(b.resId) } : assertRecord(db, actor, b.model, b.resId);
    model = rec.model; resId = rec.id;
    if (!canReadRecord(db, assignee, model, resId)) throw bad('المسند إليه لا يملك صلاحية رؤية هذا السجل.', 409, 'conflict');
  }
  const creatorId = actor?.id ? Number(actor.id) : assignee.id;
  const id = Number(db.prepare('INSERT INTO activities (model, res_id, kind, title, note, assignee_id, creator_id, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(model, resId, kind, title, clean(b?.note, 1000), assignee.id, creatorId, due, Date.now()).id);
  if (model) {
    follow(db, model, resId, [assignee.id]);
    postMessage(db, actor, model, resId, { kind: 'system', body: `نشاط جديد (${ACTIVITY_KINDS[kind]}): ${title} — مسند إلى ${assignee.display_name}، الاستحقاق ${due}` }, { silent: true });
  }
  if (assignee.id !== creatorId) notifyUsers(db, [assignee.id], 'activity', id, `أُسند إليك ${ACTIVITY_KINDS[kind]}: ${title} (الاستحقاق ${due})`);
  if (!system) audit(db, actor, 'إنشاء نشاط', `${title}${model ? ` على ${model}:${resId}` : ''}`, ip);
  if (!system) emit(db, 'activity.created', { model, resId, title, activityId: id, assigneeId: assignee.id, creatorId, actorId: actor?.id ?? null });
  return { id };
}

function loadActivity(db, actor, id) {
  const a = db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id));
  if (!a || ![Number(a.assignee_id), Number(a.creator_id)].includes(Number(actor.id))) throw bad('النشاط غير موجود.', 404, 'not_found');
  if (a.status !== 'open') throw bad('النشاط منتهٍ.', 409, 'conflict');
  return a;
}

export function completeActivity(db, actor, id, b, ip) {
  staffOnly(actor);
  const a = loadActivity(db, actor, id), note = clean(b?.note, 1000);
  db.prepare("UPDATE activities SET status = 'done', done_note = ?, done_at = ? WHERE id = ?").run(note, Date.now(), a.id);
  if (a.model) postMessage(db, actor, a.model, a.res_id, { kind: 'system', body: `أُنجز النشاط «${a.title}»${note ? `: ${note}` : ''}` }, { silent: true });
  if (Number(a.creator_id) !== Number(actor.id)) notifyUsers(db, [a.creator_id], 'activity_done', Number(a.id), `أنجز ${actor.label} النشاط «${a.title}»${note ? `: ${note}` : ''}`);
  audit(db, actor, 'إنجاز نشاط', a.title, ip);
  emit(db, 'activity.done', { model: a.model, resId: a.res_id ? Number(a.res_id) : null, title: a.title, activityId: Number(a.id), assigneeId: Number(a.assignee_id), creatorId: Number(a.creator_id), actorId: actor.id });
  return { ok: true };
}

export function cancelActivity(db, actor, id, b, ip) {
  staffOnly(actor);
  const a = loadActivity(db, actor, id);
  // المسند إليه لا يلغي مهمة كلّفه بها غيره؛ يلغيها من أنشأها
  if (Number(a.creator_id) !== Number(actor.id)) throw bad('يلغي النشاط من أنشأه.', 403, 'forbidden');
  db.prepare("UPDATE activities SET status = 'cancelled', done_note = ?, done_at = ? WHERE id = ?").run(clean(b?.note, 500), Date.now(), a.id);
  if (a.model) postMessage(db, actor, a.model, a.res_id, { kind: 'system', body: `أُلغي النشاط «${a.title}»` }, { silent: true });
  if (Number(a.assignee_id) !== Number(actor.id)) notifyUsers(db, [a.assignee_id], 'activity_cancel', Number(a.id), `ألغى ${actor.label} النشاط «${a.title}»`);
  audit(db, actor, 'إلغاء نشاط', a.title, ip);
  return { ok: true };
}

export function updateActivity(db, actor, id, b, ip) {
  staffOnly(actor);
  const a = loadActivity(db, actor, id), changes = [];
  if (b?.dueDate !== undefined && b.dueDate !== a.due_date) {
    if (!DAY_RE.test(String(b.dueDate)) || b.dueDate < today()) throw bad('تاريخ الاستحقاق غير صالح أو في الماضي.');
    db.prepare('UPDATE activities SET due_date = ? WHERE id = ?').run(b.dueDate, a.id);
    changes.push({ field: 'due_date', label: 'الاستحقاق', from: a.due_date, to: b.dueDate });
  }
  if (b?.assigneeId !== undefined && Number(b.assigneeId) !== Number(a.assignee_id)) {
    if (Number(a.creator_id) !== Number(actor.id)) throw bad('يعيد الإسناد من أنشأ النشاط.', 403, 'forbidden');
    const to = activeStaff(db, b.assigneeId);
    if (a.model && !canReadRecord(db, to, a.model, a.res_id)) throw bad('المسند إليه لا يملك صلاحية رؤية هذا السجل.', 409, 'conflict');
    db.prepare('UPDATE activities SET assignee_id = ? WHERE id = ?').run(to.id, a.id);
    changes.push({ field: 'assignee', label: 'المسند إليه', from: nameOf(db, a.assignee_id), to: to.display_name });
    if (a.model) follow(db, a.model, a.res_id, [to.id]);
    // الإشعار بمفتاح النشاط نفسه قد يكون استُهلك عند الإسناد الأول، فيُستعمل نوع مستقل
    notifyUsers(db, [to.id], 'activity_reassign', Number(a.id), `أُسند إليك ${ACTIVITY_KINDS[a.kind]}: ${a.title} (الاستحقاق ${b.dueDate ?? a.due_date})`);
  }
  if (a.model && changes.length) track(db, actor, a.model, a.res_id, changes, `تعديل النشاط «${a.title}»`);
  if (changes.length) audit(db, actor, 'تعديل نشاط', `${a.title}: ${changes.map((c) => c.label).join('، ')}`, ip);
  return { ok: true, changed: changes.length };
}

export function listActivities(db, actor, { box = 'mine', model = null, resId = null, status = 'open' } = {}) {
  staffOnly(actor);
  const where = [], args = [];
  if (box === 'record') { where.push('a.model = ? AND a.res_id = ?'); args.push(model, Number(resId)); }
  else if (box === 'created') { where.push('a.creator_id = ? AND a.assignee_id <> ?'); args.push(actor.id, actor.id); }
  else { where.push('a.assignee_id = ?'); args.push(actor.id); }
  if (status !== 'all' && box !== 'record') { where.push('a.status = ?'); args.push(status === 'done' ? 'done' : 'open'); }
  return db.prepare(`SELECT a.*, ua.display_name AS assignee, uc.display_name AS creator FROM activities a JOIN users ua ON ua.id = a.assignee_id JOIN users uc ON uc.id = a.creator_id
    WHERE ${where.join(' AND ')} ORDER BY CASE a.status WHEN 'open' THEN 0 ELSE 1 END, a.due_date, a.id LIMIT 300`).all(...args).map((a) => activityView(db, a, actor));
}

// تذكير يومي مرة واحدة لكل نشاط: يوم الاستحقاق، ثم عند التأخر (الفهرس الفريد للإشعارات يمنع التكرار)
export function remindActivities(db, now = Date.now()) {
  const t = today(now);
  const rows = db.prepare("SELECT id, assignee_id, title, due_date FROM activities WHERE status = 'open' AND due_date <= ? ORDER BY due_date LIMIT 2000").all(t);
  for (const a of rows) {
    if (a.due_date === t) notifyUsers(db, [a.assignee_id], 'activity_due', Number(a.id), `يستحق اليوم: ${a.title}`);
    else notifyUsers(db, [a.assignee_id], 'activity_overdue', Number(a.id), `نشاط متأخر منذ ${a.due_date}: ${a.title}`);
  }
  return { reminded: rows.length };
}

export function hubSummary(db, actor) {
  staffOnly(actor);
  const t = today();
  const r = db.prepare("SELECT COUNT(*) AS open, SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue, SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS today FROM activities WHERE assignee_id = ? AND status = 'open'").get(t, t, actor.id);
  return { activities: { open: Number(r?.open ?? 0), overdue: Number(r?.overdue ?? 0), today: Number(r?.today ?? 0) } };
}

export function searchPeople(db, actor, q) {
  staffOnly(actor);
  const s = clean(q, 60).replace(/[\\%_]/g, '');
  return db.prepare(`SELECT u.id, u.display_name, o.name AS unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.active = 1 AND u.role <> 'student'${s ? ' AND (u.display_name ILIKE ? OR u.username ILIKE ?)' : ''} ORDER BY u.display_name LIMIT 30`)
    .all(...(s ? [`%${s}%`, `%${s}%`] : [])).map((u) => ({ id: Number(u.id), name: u.display_name, unit: u.unit ?? '' }));
}
