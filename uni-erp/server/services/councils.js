// المجالس واللجان: التشكيل، والاجتماع وجدول أعماله، والقرار بالنصاب والتصويت مع تنحي صاحب المصلحة،
// وتحويل القرار إلى مهام لها مسؤول وموعد. يدير الاجتماع من يملك council:manage أو رئيس المجلس وأمين سره.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { docNo } from '../lib/doc_no.js';
import { tx } from '../db.js';

export const COUNCIL_TYPES = {
  university: 'مجلس الجامعة', faculty: 'مجلس كلية', department: 'مجلس قسم', disciplinary: 'لجنة الانضباط', exams: 'لجنة الامتحانات',
  equivalence: 'لجنة المعادلات', appeals: 'لجنة التظلمات', medical: 'لجنة الأعذار الطبية', hiring: 'لجنة التعيين والترقيات',
  procurement: 'لجنة المشتريات والمناقصات', quality: 'لجنة الجودة', other: 'مجلس أو لجنة أخرى',
};
export const MEMBER_ROLES = { chair: 'رئيس', deputy: 'نائب الرئيس', rapporteur: 'مقرر', secretary: 'أمين سر (دون تصويت)', member: 'عضو' };
const COUNCIL_KINDS = new Set(['university', 'faculty', 'department']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const clean = (v, max) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const today = () => new Date().toISOString().slice(0, 10);
const nameOf = (db, id) => db.prepare('SELECT display_name FROM users WHERE id = ?').get(Number(id))?.display_name ?? '—';
const notify = (db, ids, kind, ref, text) => {
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"), now = Date.now();
  for (const id of new Set(ids)) ins.run(id, kind, ref, text, now);
};

const readsAll = (actor) => !!(actor.can?.('council:read_all') || actor.can?.('council:manage'));
const membership = (db, councilId, userId) => db.prepare('SELECT * FROM council_members WHERE council_id = ? AND user_id = ? AND active = 1').get(Number(councilId), Number(userId));
export const isManager = (db, actor, councilId) => !!(actor.can?.('council:manage') || ['chair', 'secretary'].includes(membership(db, councilId, actor.id)?.role));
const activeMembers = (db, councilId) => db.prepare('SELECT * FROM council_members WHERE council_id = ? AND active = 1').all(Number(councilId));

function loadCouncil(db, actor, id) {
  const c = db.prepare('SELECT * FROM councils WHERE id = ?').get(Number(id));
  // من ليس عضواً ولا مطلعاً لا يعرف بوجود المجلس
  if (!c || (!readsAll(actor) && !db.prepare('SELECT 1 FROM council_members WHERE council_id = ? AND user_id = ?').get(c.id, Number(actor.id)))) throw bad('المجلس غير موجود.', 404, 'not_found');
  return c;
}
function loadMeeting(db, actor, id) {
  const m = db.prepare('SELECT * FROM council_meetings WHERE id = ?').get(Number(id));
  if (!m) throw bad('الاجتماع غير موجود.', 404, 'not_found');
  return { meeting: m, council: loadCouncil(db, actor, m.council_id) };
}
function loadItem(db, actor, id) {
  const item = db.prepare('SELECT * FROM council_items WHERE id = ?').get(Number(id));
  if (!item) throw bad('بند جدول الأعمال غير موجود.', 404, 'not_found');
  return { item, ...loadMeeting(db, actor, item.meeting_id) };
}
const needManager = (db, actor, councilId) => { if (!isManager(db, actor, councilId)) throw bad('إدارة الاجتماع لرئيس المجلس وأمين سره أو لمن يملك صلاحية إدارة المجالس.', 403, 'forbidden'); };

const councilView = (db, c, actor) => ({
  id: Number(c.id), name: c.name, type: c.type, typeLabel: COUNCIL_TYPES[c.type] ?? c.type, kind: c.kind, quorumPercent: Number(c.quorum_percent), active: !!Number(c.active),
  unit: c.unit_id ? db.prepare('SELECT name FROM org_units WHERE id = ?').get(c.unit_id)?.name ?? null : null,
  members: Number(db.prepare('SELECT COUNT(*) AS n FROM council_members WHERE council_id = ? AND active = 1').get(c.id).n),
  myRole: membership(db, c.id, actor.id)?.role ?? null, canManage: isManager(db, actor, c.id),
});
const taskView = (db, t) => ({
  id: Number(t.id), itemId: Number(t.item_id), title: t.title, dueDay: t.due_day, status: t.status, overdue: t.status === 'open' && t.due_day < today(),
  assigneeId: Number(t.assignee_id), assignee: nameOf(db, t.assignee_id), doneNote: t.done_note, doneAt: t.done_at ? Number(t.done_at) : null,
});

export function councilsOverview({ db }, actor) {
  const rows = readsAll(actor)
    ? db.prepare('SELECT * FROM councils ORDER BY active DESC, name').all()
    : db.prepare('SELECT DISTINCT c.* FROM councils c JOIN council_members m ON m.council_id = c.id WHERE m.user_id = ? ORDER BY c.active DESC, c.name').all(Number(actor.id));
  const tasks = db.prepare(`SELECT t.*, i.title AS item_title, i.decision_no, c.name AS council_name FROM council_tasks t JOIN council_items i ON i.id = t.item_id
    JOIN council_meetings m ON m.id = i.meeting_id JOIN councils c ON c.id = m.council_id WHERE t.assignee_id = ? ORDER BY t.status DESC, t.due_day`).all(Number(actor.id))
    .map((t) => ({ ...taskView(db, t), decisionNo: t.decision_no, itemTitle: t.item_title, council: t.council_name }));
  const manage = !!actor.can?.('council:manage');
  return {
    councils: rows.map((c) => councilView(db, c, actor)), myTasks: tasks, canCreate: manage, types: COUNCIL_TYPES, roles: MEMBER_ROLES,
    staff: manage || rows.some((c) => isManager(db, actor, c.id)) ? db.prepare("SELECT id, display_name AS name FROM users WHERE role <> 'student' AND active = 1 ORDER BY display_name LIMIT 3000").all().map((u) => ({ id: Number(u.id), name: u.name })) : [],
    units: manage ? db.prepare('SELECT id, name FROM org_units WHERE active = 1 ORDER BY name').all().map((u) => ({ id: Number(u.id), name: u.name })) : [],
  };
}

export function createCouncil({ db }, actor, b, ip) {
  const name = clean(b?.name, 120), type = String(b?.type ?? '');
  if (name.length < 3) throw bad('اسم المجلس أو اللجنة مطلوب.');
  if (!COUNCIL_TYPES[type]) throw bad('نوع المجلس غير صالح.');
  const quorum = b?.quorumPercent === undefined ? 50 : Number(b.quorumPercent);
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > 100) throw bad('النصاب نسبة من 1 إلى 100.');
  const unitId = b?.unitId ? Number(b.unitId) : null;
  if (unitId && !db.prepare('SELECT 1 FROM org_units WHERE id = ?').get(unitId)) throw bad('الوحدة غير موجودة.');
  const id = Number(db.prepare('INSERT INTO councils (name, type, kind, unit_id, quorum_percent, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id')
    .get(name, type, COUNCIL_KINDS.has(type) ? 'council' : 'committee', unitId, quorum, actor.id ?? null, Date.now()).id);
  audit(db, actor, 'تشكيل مجلس أو لجنة', `${name} (${COUNCIL_TYPES[type]})`, ip);
  return { id };
}

export function updateCouncil({ db }, actor, id, b, ip) {
  const c = loadCouncil(db, actor, id);
  const quorum = b?.quorumPercent === undefined ? Number(c.quorum_percent) : Number(b.quorumPercent);
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > 100) throw bad('النصاب نسبة من 1 إلى 100.');
  const name = b?.name === undefined ? c.name : clean(b.name, 120);
  if (name.length < 3) throw bad('اسم المجلس أو اللجنة مطلوب.');
  db.prepare('UPDATE councils SET name = ?, quorum_percent = ?, active = ? WHERE id = ?').run(name, quorum, b?.active === undefined ? Number(c.active) : (b.active ? 1 : 0), c.id);
  audit(db, actor, 'تعديل مجلس أو لجنة', name, ip);
  return { ok: true };
}

export function addMember({ db }, actor, id, b, ip) {
  const c = loadCouncil(db, actor, id), role = String(b?.role ?? 'member');
  if (!MEMBER_ROLES[role]) throw bad('صفة العضو غير صالحة.');
  const user = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role <> 'student' AND active = 1").get(Number(b?.userId));
  if (!user) throw bad('الموظف غير موجود أو غير فعّال.');
  if (membership(db, c.id, user.id)) throw bad('الموظف عضو في هذا المجلس.', 409, 'conflict');
  if (['chair', 'secretary'].includes(role) && db.prepare('SELECT 1 FROM council_members WHERE council_id = ? AND role = ? AND active = 1').get(c.id, role)) throw bad(`للمجلس ${MEMBER_ROLES[role]} حالياً؛ أنهِ عضويته أولاً.`, 409, 'conflict');
  db.prepare('INSERT INTO council_members (council_id, user_id, role, voting, from_day, created_at) VALUES (?,?,?,?,?,?)').run(c.id, user.id, role, role === 'secretary' ? 0 : 1, today(), Date.now());
  notify(db, [user.id], 'council_member', c.id, `أُضفت إلى «${c.name}» بصفة ${MEMBER_ROLES[role]}.`);
  audit(db, actor, 'إضافة عضو إلى مجلس', `${c.name}: ${user.display_name} (${MEMBER_ROLES[role]})`, ip);
  return { ok: true };
}

// إنهاء العضوية يبقي سجلها: من كان عضواً يبقى ظاهراً في محاضر اجتماعاته
export function endMember({ db }, actor, id, memberId, ip) {
  const c = loadCouncil(db, actor, id);
  const m = db.prepare('SELECT * FROM council_members WHERE id = ? AND council_id = ? AND active = 1').get(Number(memberId), c.id);
  if (!m) throw bad('العضوية غير موجودة أو منتهية.', 404, 'not_found');
  db.prepare('UPDATE council_members SET active = 0, to_day = ? WHERE id = ?').run(today(), m.id);
  audit(db, actor, 'إنهاء عضوية في مجلس', `${c.name}: ${nameOf(db, m.user_id)}`, ip);
  return { ok: true };
}

export function councilDetail({ db }, actor, id) {
  const c = loadCouncil(db, actor, id);
  return {
    council: councilView(db, c, actor),
    members: db.prepare('SELECT * FROM council_members WHERE council_id = ? ORDER BY active DESC, id').all(c.id).map((m) => ({
      id: Number(m.id), userId: Number(m.user_id), name: nameOf(db, m.user_id), role: m.role, roleLabel: MEMBER_ROLES[m.role], voting: !!Number(m.voting), fromDay: m.from_day, toDay: m.to_day, active: !!Number(m.active),
    })),
    meetings: db.prepare('SELECT m.*, (SELECT COUNT(*) FROM council_items i WHERE i.meeting_id = m.id) AS items FROM council_meetings m WHERE m.council_id = ? ORDER BY m.meeting_at DESC').all(c.id)
      .map((m) => ({ id: Number(m.id), no: m.no, title: m.title, meetingAt: Number(m.meeting_at), location: m.location, status: m.status, items: Number(m.items) })),
  };
}

const parseAt = (v) => { const t = new Date(String(v ?? '')).getTime(); if (!Number.isFinite(t)) throw bad('موعد الاجتماع غير صالح.'); return t; };
function insertItem(db, meetingId, it) {
  const title = clean(it?.title, 200);
  if (title.length < 3) throw bad('عنوان بند جدول الأعمال مطلوب.');
  const seq = Number(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM council_items WHERE meeting_id = ?').get(meetingId).n);
  db.prepare('INSERT INTO council_items (meeting_id, seq, title, details, source_ref, created_at) VALUES (?,?,?,?,?,?)').run(meetingId, seq, title, clean(it?.details, 2000), clean(it?.sourceRef, 60), Date.now());
}

export function createMeeting({ db }, actor, councilId, b, ip) {
  const c = loadCouncil(db, actor, councilId);
  needManager(db, actor, c.id);
  if (!Number(c.active)) throw bad('المجلس غير فعّال.', 409, 'conflict');
  const title = clean(b?.title, 160);
  if (title.length < 3) throw bad('عنوان الاجتماع مطلوب.');
  const at = parseAt(b?.meetingAt), items = Array.isArray(b?.items) ? b.items.filter((x) => clean(x?.title, 200)) : [];
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO council_meetings (council_id, no, title, meeting_at, location, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id')
      .get(c.id, docNo('MTG'), title, at, clean(b?.location, 120), actor.id ?? null, Date.now()).id);
    for (const it of items) insertItem(db, id, it);
    audit(db, actor, 'إعداد اجتماع مجلس', `${c.name}: ${title}`, ip);
    return { id };
  });
}

export function meetingDetail({ db }, actor, id) {
  const { meeting: m, council: c } = loadMeeting(db, actor, id);
  const present = new Set(db.prepare('SELECT user_id FROM council_attendance WHERE meeting_id = ? AND present = 1').all(m.id).map((x) => Number(x.user_id)));
  const members = activeMembers(db, c.id).map((x) => ({ userId: Number(x.user_id), name: nameOf(db, x.user_id), role: x.role, roleLabel: MEMBER_ROLES[x.role], voting: !!Number(x.voting), present: present.has(Number(x.user_id)) }));
  return {
    council: councilView(db, c, actor),
    meeting: { id: Number(m.id), no: m.no, title: m.title, meetingAt: Number(m.meeting_at), location: m.location, status: m.status, minutes: m.minutes, cancelReason: m.cancel_reason, closedAt: m.closed_at ? Number(m.closed_at) : null },
    members,
    items: db.prepare('SELECT * FROM council_items WHERE meeting_id = ? ORDER BY seq').all(m.id).map((i) => ({
      id: Number(i.id), seq: Number(i.seq), title: i.title, details: i.details, sourceRef: i.source_ref, status: i.status, outcome: i.outcome, decisionNo: i.decision_no, decisionText: i.decision_text,
      votes: { for: Number(i.votes_for), against: Number(i.votes_against), abstain: Number(i.votes_abstain) },
      recusals: db.prepare('SELECT * FROM council_recusals WHERE item_id = ?').all(i.id).map((r) => ({ userId: Number(r.user_id), name: nameOf(db, r.user_id), reason: r.reason })),
      tasks: db.prepare('SELECT * FROM council_tasks WHERE item_id = ? ORDER BY id').all(i.id).map((t) => taskView(db, t)),
    })),
    canManage: isManager(db, actor, c.id),
  };
}

export function addItem({ db }, actor, meetingId, b, ip) {
  const { meeting: m, council: c } = loadMeeting(db, actor, meetingId);
  needManager(db, actor, c.id);
  if (!['draft', 'scheduled'].includes(m.status)) throw bad('يُعدَّل جدول الأعمال قبل انعقاد الاجتماع فقط.', 409, 'conflict');
  insertItem(db, m.id, b);
  audit(db, actor, 'إضافة بند إلى جدول أعمال', `${m.no}: ${clean(b?.title, 80)}`, ip);
  return { ok: true };
}

export function scheduleMeeting({ db }, actor, meetingId, ip) {
  const { meeting: m, council: c } = loadMeeting(db, actor, meetingId);
  needManager(db, actor, c.id);
  if (m.status !== 'draft') throw bad('يُدعى إلى الاجتماع المسودة فقط.', 409, 'conflict');
  if (!db.prepare('SELECT 1 FROM council_items WHERE meeting_id = ?').get(m.id)) throw bad('أضف بنداً واحداً على الأقل إلى جدول الأعمال.', 409, 'conflict');
  db.prepare("UPDATE council_meetings SET status = 'scheduled' WHERE id = ?").run(m.id);
  const when = new Date(Number(m.meeting_at)).toISOString().slice(0, 16).replace('T', ' ');
  notify(db, activeMembers(db, c.id).map((x) => x.user_id), 'council_meeting', m.id, `دعوة إلى اجتماع «${c.name}»: ${m.title} — ${when}${m.location ? ` في ${m.location}` : ''}.`);
  audit(db, actor, 'الدعوة إلى اجتماع مجلس', `${c.name}: ${m.no}`, ip);
  return { ok: true };
}

export function recordAttendance({ db }, actor, meetingId, b, ip) {
  const { meeting: m, council: c } = loadMeeting(db, actor, meetingId);
  needManager(db, actor, c.id);
  if (!['scheduled', 'held'].includes(m.status)) throw bad('يُسجَّل الحضور لاجتماع مدعو إليه.', 409, 'conflict');
  const members = new Set(activeMembers(db, c.id).map((x) => Number(x.user_id)));
  const present = [...new Set((Array.isArray(b?.present) ? b.present : []).map(Number))];
  if (present.some((u) => !members.has(u))) throw bad('الحضور يكون من أعضاء المجلس الحاليين.');
  if (db.prepare("SELECT 1 FROM council_items WHERE meeting_id = ? AND status <> 'pending'").get(m.id)) throw bad('بدأ اتخاذ القرارات؛ لا يتغير الحضور بعدها.', 409, 'conflict');
  tx(db, () => {
    db.prepare('DELETE FROM council_attendance WHERE meeting_id = ?').run(m.id);
    const ins = db.prepare('INSERT INTO council_attendance (meeting_id, user_id, present) VALUES (?, ?, 1)');
    for (const u of present) ins.run(m.id, u);
    db.prepare("UPDATE council_meetings SET status = 'held' WHERE id = ?").run(m.id);
  });
  audit(db, actor, 'تسجيل حضور اجتماع', `${m.no}: ${present.length} حاضر`, ip);
  return { ok: true };
}

// التنحي: العضو صاحب المصلحة يُستبعد من النصاب والتصويت في هذا البند وحده
export function recuse({ db }, actor, itemId, b, ip) {
  const { item, meeting: m, council: c } = loadItem(db, actor, itemId);
  const userId = Number(b?.userId ?? actor.id);
  if (userId !== Number(actor.id)) needManager(db, actor, c.id);
  if (!membership(db, c.id, userId)) throw bad('المتنحي يكون من أعضاء المجلس.');
  if (item.status !== 'pending' || !['scheduled', 'held'].includes(m.status)) throw bad('التنحي قبل البت في البند.', 409, 'conflict');
  const reason = clean(b?.reason, 300);
  if (reason.length < 3) throw bad('سبب التنحي مطلوب.');
  const r = db.prepare('INSERT INTO council_recusals (item_id, user_id, reason, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(item.id, userId, reason, Date.now());
  if (!r.changes) throw bad('سُجّل تنحي هذا العضو مسبقاً.', 409, 'conflict');
  audit(db, actor, 'تنحي عضو عن بند', `${m.no} / ${item.title}: ${nameOf(db, userId)}`, ip);
  return { ok: true };
}

const OUTCOMES = { approved: 'الموافقة', rejected: 'الرفض', deferred: 'التأجيل' };

export function decideItem({ db }, actor, itemId, b, ip) {
  const { item, meeting: m, council: c } = loadItem(db, actor, itemId);
  needManager(db, actor, c.id);
  if (m.status !== 'held') throw bad('يُبت في البنود بعد تسجيل حضور الاجتماع.', 409, 'conflict');
  if (item.status !== 'pending') throw bad('بُت في هذا البند مسبقاً.', 409, 'conflict');
  const outcome = String(b?.outcome ?? '');
  if (!OUTCOMES[outcome]) throw bad('نتيجة القرار غير صالحة.');
  const text = clean(b?.text, 2000);
  if (text.length < 5) throw bad('نص القرار مطلوب.');
  const recused = new Set(db.prepare('SELECT user_id FROM council_recusals WHERE item_id = ?').all(item.id).map((x) => Number(x.user_id)));
  const voters = activeMembers(db, c.id).filter((x) => Number(x.voting) && !recused.has(Number(x.user_id))).map((x) => Number(x.user_id));
  const present = new Set(db.prepare('SELECT user_id FROM council_attendance WHERE meeting_id = ? AND present = 1').all(m.id).map((x) => Number(x.user_id)));
  const presentVoters = voters.filter((u) => present.has(u)).length, needed = Math.ceil((voters.length * Number(c.quorum_percent)) / 100);
  // التأجيل لا يحتاج نصاباً: كثيراً ما يكون عدم اكتماله سببه
  if (outcome !== 'deferred' && (!voters.length || presentVoters < needed)) throw bad(`لم يكتمل النصاب: حضر ${presentVoters} من ${voters.length} عضواً يحق لهم التصويت، والمطلوب ${needed}.`, 409, 'no_quorum');
  const v = (k) => { const n = Number(b?.[k] ?? 0); if (!Number.isInteger(n) || n < 0) throw bad('أعداد الأصوات أعداد صحيحة.'); return n; };
  // التأجيل لا تصويت فيه
  const votes = outcome === 'deferred' ? { for: 0, against: 0, abstain: 0 } : { for: v('votesFor'), against: v('votesAgainst'), abstain: v('votesAbstain') };
  if (votes.for + votes.against + votes.abstain > presentVoters) throw bad(`مجموع الأصوات أكبر من الحاضرين الذين يحق لهم التصويت (${presentVoters}).`);
  if (outcome === 'approved' && !(votes.for > votes.against)) throw bad('الموافقة تتطلب أن تزيد أصوات الموافقين على المعارضين.');
  if (outcome === 'rejected' && !(votes.against >= votes.for && votes.against > 0)) throw bad('الرفض يتطلب ألا تقل أصوات المعارضين عن الموافقين.');
  const no = outcome === 'deferred' ? null : docNo('DEC');
  db.prepare('UPDATE council_items SET status = ?, outcome = ?, decision_no = ?, decision_text = ?, votes_for = ?, votes_against = ?, votes_abstain = ?, decided_by = ?, decided_at = ? WHERE id = ?')
    .run(outcome === 'deferred' ? 'deferred' : 'decided', outcome, no, text, votes.for, votes.against, votes.abstain, actor.id ?? null, Date.now(), item.id);
  audit(db, actor, `قرار مجلس: ${OUTCOMES[outcome]}`, `${c.name} ${no ?? m.no}: ${item.title}`.slice(0, 300), ip);
  return { decisionNo: no };
}

export function addTask({ db }, actor, itemId, b, ip) {
  const { item, council: c } = loadItem(db, actor, itemId);
  needManager(db, actor, c.id);
  if (item.outcome !== 'approved') throw bad('تُسند المهام لتنفيذ قرار بالموافقة.', 409, 'conflict');
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role <> 'student' AND active = 1").get(Number(b?.assigneeId));
  if (!user) throw bad('المكلَّف غير موجود أو غير فعّال.');
  const title = clean(b?.title, 200), due = String(b?.dueDay ?? '');
  if (title.length < 3) throw bad('وصف المهمة مطلوب.');
  if (!DAY_RE.test(due)) throw bad('موعد الإنجاز بصيغة 2026-12-31.');
  const id = Number(db.prepare('INSERT INTO council_tasks (item_id, assignee_id, title, due_day, created_by, created_at) VALUES (?,?,?,?,?,?) RETURNING id').get(item.id, user.id, title, due, actor.id ?? null, Date.now()).id);
  notify(db, [user.id], 'council_task', id, `كُلّفت بتنفيذ القرار ${item.decision_no} (${c.name}): ${title} — قبل ${due}.`);
  audit(db, actor, 'إسناد مهمة لتنفيذ قرار', `${item.decision_no}: ${title} — ${nameOf(db, user.id)}`, ip);
  return { id };
}

export function completeTask({ db }, actor, taskId, b, ip) {
  const t = db.prepare('SELECT * FROM council_tasks WHERE id = ?').get(Number(taskId));
  if (!t) throw bad('المهمة غير موجودة.', 404, 'not_found');
  const { council: c, item } = Number(t.assignee_id) === Number(actor.id) ? { ...loadItemRaw(db, t.item_id) } : loadItem(db, actor, t.item_id);
  if (Number(t.assignee_id) !== Number(actor.id)) needManager(db, actor, c.id);
  if (t.status !== 'open') throw bad('أُنجزت المهمة مسبقاً.', 409, 'conflict');
  const note = clean(b?.note, 500);
  if (note.length < 3) throw bad('اكتب ما أُنجز.');
  db.prepare("UPDATE council_tasks SET status = 'done', done_note = ?, done_at = ?, done_by = ? WHERE id = ?").run(note, Date.now(), actor.id ?? null, t.id);
  audit(db, actor, 'إنجاز مهمة قرار', `${item.decision_no}: ${t.title}`, ip);
  return { ok: true };
}
const loadItemRaw = (db, itemId) => {
  const item = db.prepare('SELECT * FROM council_items WHERE id = ?').get(Number(itemId));
  const meeting = db.prepare('SELECT * FROM council_meetings WHERE id = ?').get(item.meeting_id);
  return { item, meeting, council: db.prepare('SELECT * FROM councils WHERE id = ?').get(meeting.council_id) };
};

export function closeMeeting({ db }, actor, meetingId, b, ip) {
  const { meeting: m, council: c } = loadMeeting(db, actor, meetingId);
  needManager(db, actor, c.id);
  if (m.status !== 'held') throw bad('يُغلق الاجتماع المنعقد فقط.', 409, 'conflict');
  if (db.prepare("SELECT 1 FROM council_items WHERE meeting_id = ? AND status = 'pending'").get(m.id)) throw bad('بقيت بنود لم يُبت فيها؛ قرّر فيها أو أجّلها.', 409, 'conflict');
  const minutes = String(b?.minutes ?? '').trim().slice(0, 8000);
  if (minutes.length < 10) throw bad('اكتب محضر الاجتماع.');
  db.prepare("UPDATE council_meetings SET status = 'closed', minutes = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(minutes, actor.id ?? null, Date.now(), m.id);
  notify(db, activeMembers(db, c.id).map((x) => x.user_id), 'council_minutes', m.id, `اعتُمد محضر اجتماع «${c.name}»: ${m.title}.`);
  audit(db, actor, 'إغلاق اجتماع واعتماد محضره', `${c.name}: ${m.no}`, ip);
  return { ok: true };
}

export function cancelMeeting({ db }, actor, meetingId, b, ip) {
  const { meeting: m, council: c } = loadMeeting(db, actor, meetingId);
  needManager(db, actor, c.id);
  if (!['draft', 'scheduled'].includes(m.status)) throw bad('يُلغى الاجتماع قبل انعقاده فقط.', 409, 'conflict');
  const reason = clean(b?.reason, 300);
  if (reason.length < 3) throw bad('سبب الإلغاء مطلوب.');
  db.prepare("UPDATE council_meetings SET status = 'cancelled', cancel_reason = ? WHERE id = ?").run(reason, m.id);
  if (m.status === 'scheduled') notify(db, activeMembers(db, c.id).map((x) => x.user_id), 'council_cancel', m.id, `أُلغي اجتماع «${c.name}»: ${m.title} — ${reason}.`);
  audit(db, actor, 'إلغاء اجتماع مجلس', `${m.no}: ${reason}`, ip);
  return { ok: true };
}

// تذكير واحد لكل مهمة تجاوزت موعدها، للمكلَّف ولمن يدير المجلس
export function remindOverdueCouncilTasks(db) {
  const rows = db.prepare(`SELECT t.*, i.decision_no, m.council_id FROM council_tasks t JOIN council_items i ON i.id = t.item_id JOIN council_meetings m ON m.id = i.meeting_id
    WHERE t.status = 'open' AND t.due_day < ?`).all(today());
  for (const t of rows) {
    const managers = db.prepare("SELECT user_id FROM council_members WHERE council_id = ? AND active = 1 AND role IN ('chair', 'secretary')").all(t.council_id).map((x) => x.user_id);
    notify(db, [t.assignee_id, ...managers], 'council_task_overdue', t.id, `تأخر تنفيذ مهمة القرار ${t.decision_no}: ${t.title} (الموعد ${t.due_day}).`);
  }
  return { reminded: rows.length };
}

export function registerCouncilRoutes(r, deps) {
  const staff = (c) => { if (!c.user || c.user.role === 'student') throw bad('هذه الخدمة للموظفين.', 403, 'forbidden'); return c.user; };
  const manage = (c) => { if (!staff(c).can('council:manage')) throw bad('تشكيل المجالس وتعديلها يتطلب صلاحية إدارة المجالس.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/councils', (c) => c.json(200, councilsOverview(deps, staff(c))));
  r.add('POST', '/api/councils', (c) => c.json(201, createCouncil(deps, manage(c), c.body, c.ip)));
  r.add('GET', '/api/councils/:id', (c) => c.json(200, councilDetail(deps, staff(c), c.params.id)));
  r.add('PUT', '/api/councils/:id', (c) => c.json(200, updateCouncil(deps, manage(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/councils/:id/members', (c) => c.json(201, addMember(deps, manage(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/councils/:id/members/:mid/end', (c) => c.json(200, endMember(deps, manage(c), c.params.id, c.params.mid, c.ip)));
  r.add('POST', '/api/councils/:id/meetings', (c) => c.json(201, createMeeting(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('GET', '/api/council-meetings/:id', (c) => c.json(200, meetingDetail(deps, staff(c), c.params.id)));
  r.add('POST', '/api/council-meetings/:id/items', (c) => c.json(201, addItem(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-meetings/:id/schedule', (c) => c.json(200, scheduleMeeting(deps, staff(c), c.params.id, c.ip)));
  r.add('POST', '/api/council-meetings/:id/attendance', (c) => c.json(200, recordAttendance(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-meetings/:id/close', (c) => c.json(200, closeMeeting(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-meetings/:id/cancel', (c) => c.json(200, cancelMeeting(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-items/:id/recuse', (c) => c.json(200, recuse(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-items/:id/decide', (c) => c.json(200, decideItem(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-items/:id/tasks', (c) => c.json(201, addTask(deps, staff(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/council-tasks/:id/done', (c) => c.json(200, completeTask(deps, staff(c), c.params.id, c.body, c.ip)));
}
