// جمهور الاختبارات والتكليفات: يُحسب وقت العرض من جدول الأهداف، فلا تُنسخ قوائم الطلاب ويظهر الاختبار لمن يُضاف إلى الفئة لاحقاً.
import { bad } from '../validate.js';
import { HttpError } from '../http.js';

export const APPROVE = 'lms_lib:approve';
const MAX_TARGETS = 50;
const TYPES = ['group', 'program', 'faculty', 'all'];

const TARGET_MATCH = `t.approval_status = 'approved' AND (
  t.target_type = 'all'
  OR (t.target_type = 'program' AND t.program_id = sp.program_id)
  OR (t.target_type = 'faculty' AND t.faculty_id = p.faculty_id)
  OR (t.target_type = 'group' AND EXISTS (SELECT 1 FROM student_group_members gm WHERE gm.group_id = t.group_id AND gm.student_id = sp.user_id)))`;
const ACTIVE_STUDENTS = `student_profiles sp JOIN users u ON u.id = sp.user_id JOIN programs p ON p.id = sp.program_id`;
// الوسيط الوحيد: معرّف الاختبار
export const AUDIENCE_SQL = `SELECT sp.user_id AS id FROM ${ACTIVE_STUDENTS} WHERE sp.status = 'active' AND u.active = 1 AND EXISTS (SELECT 1 FROM lms_assignment_targets t WHERE t.assignment_id = ? AND ${TARGET_MATCH})`;

export const audienceCount = (db, id) => Number(db.prepare(`SELECT COUNT(*) AS c FROM (${AUDIENCE_SQL}) x`).get(id).c);
export const isTargeted = (db, assignmentId, studentId) => !!db.prepare(`${AUDIENCE_SQL} AND sp.user_id = ?`).get(assignmentId, studentId);

// ما يظهر للطالب: منشور بدأ موعده، وهو مستهدف به أو سبق أن سلّم عليه (فنقل الاختبار لا يحرمه حلّه ودرجته)
const LIVE = `(a.status IN ('published','closed') OR a.status = 'scheduled') AND a.starts_at <= ?`;
const REACHES = `(EXISTS (SELECT 1 FROM ${ACTIVE_STUDENTS} JOIN lms_assignment_targets t ON t.assignment_id = a.id WHERE sp.user_id = ? AND sp.status = 'active' AND u.active = 1 AND ${TARGET_MATCH})
  OR EXISTS (SELECT 1 FROM lms_assignment_submissions s WHERE s.assignment_id = a.id AND s.student_id = ? AND s.status <> 'draft'))`;
export const listForStudent = (db, studentId, now = Date.now()) => db.prepare(`SELECT a.*, c.name AS course_name FROM lms_assignments a LEFT JOIN courses c ON c.id = a.course_id WHERE ${LIVE} AND ${REACHES} ORDER BY a.due_at DESC, a.id DESC LIMIT 300`).all(now, studentId, studentId);
export const assignmentForStudent = (db, id, studentId, now = Date.now()) => db.prepare(`SELECT a.*, c.name AS course_name FROM lms_assignments a LEFT JOIN courses c ON c.id = a.course_id WHERE a.id = ? AND ${LIVE} AND ${REACHES}`).get(Number(id), now, studentId, studentId) ?? null;

const ownPrograms = (db, user) => new Set(db.prepare('SELECT DISTINCT c.program_id AS id FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE m.user_id = ?').all(user.id).map((r) => r.id));

function resolve(db, raw) {
  const type = String(raw?.type ?? '');
  if (!TYPES.includes(type)) throw bad('نوع الجمهور غير صالح.', 'targets');
  if (type === 'all') return { type, key: 'all', group: null, program: null, faculty: null };
  const id = Number(raw?.id), table = { group: 'student_groups', program: 'programs', faculty: 'faculties' }[type];
  const row = Number.isInteger(id) ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) : null;
  if (!row) throw bad('الجهة المستهدفة غير موجودة.', 'targets');
  return { type, key: `${type}:${id}`, row, group: type === 'group' ? id : null, program: type === 'program' ? id : null, faculty: type === 'faculty' ? id : null };
}

// حامل صلاحية الاعتماد ينشر مباشرة، والجمهور الواسع من غيره يبقى معلّقاً، وما خارج مقرراته مرفوض
function approvalFor(user, target, own) {
  if (user.can(APPROVE)) return 'approved';
  if (target.type === 'faculty' || target.type === 'all') return 'pending';
  const program = target.type === 'program' ? target.program : target.row.program_id;
  if (program === null || program === undefined) return 'pending';
  if (own.has(program)) return 'approved';
  throw new HttpError(403, `«${target.row.name}» خارج الفئات المسموح لك النشر لها.`, 'target_out_of_scope');
}

export function replaceTargets(db, user, assignmentId, list, now = Date.now()) {
  if (!Array.isArray(list) || list.length > MAX_TARGETS) throw bad(`قائمة الجمهور غير صالحة (حتى ${MAX_TARGETS} جهة).`, 'targets');
  const wanted = new Map(list.map((raw) => resolve(db, raw)).map((t) => [t.key, t]));
  const own = user.can(APPROVE) ? new Set() : ownPrograms(db, user);
  const current = db.prepare('SELECT * FROM lms_assignment_targets WHERE assignment_id = ?').all(assignmentId);
  const keyOf = (r) => (r.target_type === 'all' ? 'all' : `${r.target_type}:${r.group_id ?? r.program_id ?? r.faculty_id}`);
  for (const r of current) if (!wanted.has(keyOf(r))) db.prepare('DELETE FROM lms_assignment_targets WHERE id = ?').run(r.id);
  const kept = new Map(current.map((r) => [keyOf(r), r]));
  let added = 0;
  for (const t of wanted.values()) {
    const old = kept.get(t.key);
    if (old && old.approval_status !== 'rejected') continue;
    const approval = approvalFor(user, t, own), decided = approval === 'approved' ? [user.id, now] : [null, null];
    if (old) db.prepare('UPDATE lms_assignment_targets SET approval_status = ?, requested_by = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(approval, user.id, ...decided, old.id);
    else db.prepare('INSERT INTO lms_assignment_targets (assignment_id, target_type, group_id, program_id, faculty_id, approval_status, requested_by, decided_by, decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(assignmentId, t.type, t.group, t.program, t.faculty, approval, user.id, ...decided, now);
    added++;
  }
  return { added, removed: current.filter((r) => !wanted.has(keyOf(r))).length };
}

const TARGET_LABEL = (t) => (t.target_type === 'all' ? 'الجامعة كلها' : t.group_name ?? t.program_name ?? t.faculty_name ?? '');
const JOINS = `LEFT JOIN student_groups g ON g.id = t.group_id LEFT JOIN programs pr ON pr.id = t.program_id LEFT JOIN faculties f ON f.id = t.faculty_id`;
const NAMES = `g.name AS group_name, pr.name AS program_name, f.name AS faculty_name`;
export const listTargets = (db, assignmentId) => db.prepare(`SELECT t.*, ${NAMES} FROM lms_assignment_targets t ${JOINS} WHERE t.assignment_id = ? ORDER BY t.id`).all(assignmentId)
  .map((t) => ({ id: t.id, type: t.target_type, refId: t.group_id ?? t.program_id ?? t.faculty_id ?? null, label: TARGET_LABEL(t), approval: t.approval_status }));
export const pendingApprovals = (db) => db.prepare(`SELECT t.*, ${NAMES}, a.title, a.kind, u.display_name AS requested_name FROM lms_assignment_targets t JOIN lms_assignments a ON a.id = t.assignment_id JOIN users u ON u.id = t.requested_by ${JOINS} WHERE t.approval_status = 'pending' ORDER BY t.id LIMIT 200`).all()
  .map((t) => ({ id: t.id, assignmentId: t.assignment_id, title: t.title, kind: t.kind, label: TARGET_LABEL(t), requestedBy: t.requested_name }));

export function targetOptions(db, user) {
  const wide = user.can(APPROVE), own = wide ? null : ownPrograms(db, user);
  const inScope = (programId) => wide || programId === null || own.has(programId);
  return {
    canApprove: wide,
    groups: db.prepare('SELECT g.id, g.name, g.program_id, (SELECT COUNT(*) FROM student_group_members m WHERE m.group_id = g.id) AS members FROM student_groups g ORDER BY g.name').all().filter((g) => inScope(g.program_id)).map((g) => ({ id: g.id, name: g.name, members: Number(g.members), needsApproval: !wide && g.program_id === null })),
    programs: db.prepare('SELECT id, name FROM programs WHERE active = 1 ORDER BY name').all().filter((p) => wide || own.has(p.id)),
    faculties: db.prepare('SELECT id, name FROM faculties WHERE active = 1 ORDER BY name').all(),
  };
}
