// فئات الطلاب: إنشاء وتعديل ودمج الأعضاء، وتوزيع مجموعة طلاب على عدة فئات. الاستيراد من Excel في import_defs.js.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { groupSlots, saveGroupSlot, removeGroupSlot } from './schedule.js';

export const GROUP_KINDS = { lecture: 'محاضرات', lab: 'مختبرات', exam: 'امتحانات', other: 'أخرى' };
const READ = ['student:update', 'course:manage', 'attendance:manage', 'grade:manage', 'grade:approve', 'exams_housing:view', 'exams_housing:write', 'exams_housing:edit', 'exams_housing:approve', 'audit:read'];
const WRITE = ['student:update', 'course:manage'];
// مطابقة لصلاحيات شاشتي جدول المحاضرات وجدولة الامتحانات
const LAB = ['course:manage', 'attendance:manage'];
const EXAM_WRITE = ['exams_housing:write', 'exams_housing:edit', 'exams_housing:approve', 'course:manage', 'grade:manage'];
const EXAM_READ = [...EXAM_WRITE, 'exams_housing:view', 'academic:read'];
const MAX_IDS = 2000;
const bad = (message, field) => new HttpError(400, message, 'validation', field);
const needAny = (c, perms) => { if (!perms.some((p) => c.user.can(p))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };

const fullName = (r) => [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ') || r.display_name;
const view = (g) => ({ id: g.id, name: g.name, kind: g.kind, kindLabel: GROUP_KINDS[g.kind] ?? g.kind, programId: g.program_id, programName: g.program_name ?? null, notes: g.notes, count: Number(g.members ?? 0), createdAt: Number(g.created_at) });
const SELECT = `SELECT g.*, p.name AS program_name, (SELECT COUNT(*) FROM student_group_members m WHERE m.group_id = g.id) AS members
  FROM student_groups g LEFT JOIN programs p ON p.id = g.program_id`;
export const listGroups = (db) => db.prepare(`${SELECT} ORDER BY g.kind, g.name`).all().map(view);
function getGroup(db, id) {
  const g = db.prepare(`${SELECT} WHERE g.id = ?`).get(Number(id));
  if (!g) throw new HttpError(404, 'الفئة غير موجودة.', 'not_found');
  return g;
}
function membersOf(db, id) {
  return db.prepare(`SELECT u.id, u.student_no, u.display_name, sp.first_name, sp.father_name, sp.last_name, pr.name AS program_name
    FROM student_group_members m JOIN users u ON u.id = m.student_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs pr ON pr.id = sp.program_id
    WHERE m.group_id = ? ORDER BY u.student_no`).all(Number(id)).map((r) => ({ id: r.id, studentNo: r.student_no, name: fullName(r), program: r.program_name ?? '' }));
}
export const isGroupMember = (db, groupId, studentId) => !!db.prepare('SELECT 1 AS x FROM student_group_members WHERE group_id = ? AND student_id = ?').get(Number(groupId), Number(studentId));
export const groupSize = (db, groupId) => Number(db.prepare('SELECT COUNT(*) AS c FROM student_group_members WHERE group_id = ?').get(Number(groupId)).c);
export const groupsOfStudent = (db, studentId) => db.prepare('SELECT g.id, g.name, g.kind FROM student_group_members m JOIN student_groups g ON g.id = m.group_id WHERE m.student_id = ? ORDER BY g.kind, g.name').all(Number(studentId)).map((g) => ({ id: g.id, name: g.name, kind: g.kind, kindLabel: GROUP_KINDS[g.kind] ?? g.kind }));

function fields(db, b, cur) {
  const name = String(b.name ?? cur?.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) throw bad('اسم الفئة بين حرفين و80 حرفاً.', 'name');
  const kind = b.kind ?? cur?.kind ?? 'lecture';
  if (!GROUP_KINDS[kind]) throw bad('نوع الفئة غير معروف.', 'kind');
  const programId = b.programId === undefined ? (cur?.program_id ?? null) : (Number(b.programId) || null);
  if (programId && !db.prepare('SELECT 1 AS x FROM programs WHERE id = ?').get(programId)) throw bad('البرنامج غير موجود.', 'programId');
  const notes = String(b.notes ?? cur?.notes ?? '').trim().slice(0, 500);
  const clash = db.prepare('SELECT id FROM student_groups WHERE name = ?').get(name);
  if (clash && clash.id !== cur?.id) throw new HttpError(409, `توجد فئة باسم «${name}».`, 'conflict', 'name');
  return { name, kind, programId, notes };
}
// الطلاب فقط، وبلا تكرار؛ أي رقم لا يخص طالباً يرفض العملية كلها
function studentIds(db, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw bad('قائمة الطلاب غير صالحة.', 'studentIds');
  if (raw.length > MAX_IDS) throw bad(`حتى ${MAX_IDS} طالب في العملية الواحدة.`, 'studentIds');
  const ids = [...new Set(raw.map(Number))], one = db.prepare("SELECT 1 AS x FROM users WHERE id = ? AND role = 'student'");
  for (const id of ids) if (!Number.isInteger(id) || !one.get(id)) throw bad('القائمة تحوي طالباً غير موجود.', 'studentIds');
  return ids;
}
const addMembers = (db, groupId, ids, now) => {
  const ins = db.prepare('INSERT INTO student_group_members (group_id, student_id, added_at) VALUES (?, ?, ?) ON CONFLICT (group_id, student_id) DO NOTHING');
  for (const id of ids) ins.run(groupId, id, now);
};
const insertGroup = (db, f, now) => Number(db.prepare('INSERT INTO student_groups (name, kind, program_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(f.name, f.kind, f.programId, f.notes, now, now).lastInsertRowid);

function createGroup({ db }, actor, b, ip) {
  const input = b ?? {}, f = fields(db, input), ids = studentIds(db, input.studentIds), now = Date.now();
  const id = tx(db, () => { const gid = insertGroup(db, f, now); addMembers(db, gid, ids, now); audit(db, actor, 'إنشاء فئة طلاب', f.name, ip); return gid; });
  return view(getGroup(db, id));
}
function updateGroup({ db }, actor, id, b, ip) {
  const cur = getGroup(db, id), f = fields(db, b ?? {}, cur);
  db.prepare('UPDATE student_groups SET name = ?, kind = ?, program_id = ?, notes = ?, updated_at = ? WHERE id = ?').run(f.name, f.kind, f.programId, f.notes, Date.now(), cur.id);
  audit(db, actor, 'تعديل فئة طلاب', f.name === cur.name ? f.name : `${cur.name} ← ${f.name}`, ip);
  return view(getGroup(db, cur.id));
}
function deleteGroup({ db }, actor, id, ip) {
  const g = getGroup(db, id);
  tx(db, () => {
    db.prepare('UPDATE exam_schedules SET group_id = NULL WHERE group_id = ?').run(g.id);   // الامتحان يبقى، ويفقد ربطه فقط
    db.prepare('UPDATE course_schedules SET group_id = NULL WHERE group_id = ?').run(g.id);
    db.prepare('DELETE FROM student_groups WHERE id = ?').run(g.id);
    audit(db, actor, 'حذف فئة طلاب', g.name, ip);
  });
}
function changeMembers({ db }, actor, id, b, ip) {
  const g = getGroup(db, id), add = studentIds(db, b?.add), remove = studentIds(db, b?.remove), now = Date.now();
  tx(db, () => {
    addMembers(db, g.id, add, now);
    const del = db.prepare('DELETE FROM student_group_members WHERE group_id = ? AND student_id = ?');
    for (const sid of remove) del.run(g.id, sid);
    db.prepare('UPDATE student_groups SET updated_at = ? WHERE id = ?').run(now, g.id);
    audit(db, actor, 'تعديل أعضاء فئة طلاب', `${g.name}: +${add.length} / -${remove.length}`, ip);
  });
  return { group: view(getGroup(db, g.id)), members: membersOf(db, g.id) };
}
// توزيع الطلاب بالترتيب على فئات متساوية: «مختبر 1»، «مختبر 2»…
function splitIntoGroups({ db }, actor, b, ip) {
  const input = b ?? {}, ids = studentIds(db, input.studentIds), size = Number(input.size);
  if (!ids.length) throw bad('حدد الطلاب أولاً.', 'studentIds');
  if (!Number.isInteger(size) || size < 1 || size > 500) throw bad('حجم الفئة بين 1 و500.', 'size');
  const base = String(input.baseName ?? '').replace(/\s+/g, ' ').trim(), now = Date.now(), count = Math.ceil(ids.length / size);
  const plan = Array.from({ length: count }, (_, i) => fields(db, { ...input, name: `${base} ${i + 1}`, programId: input.programId ?? null }));
  const created = tx(db, () => {
    const out = plan.map((f, i) => { const gid = insertGroup(db, f, now); addMembers(db, gid, ids.slice(i * size, (i + 1) * size), now); return gid; });
    audit(db, actor, 'توزيع طلاب على فئات', `${base}: ${count} فئة · ${ids.length} طالب`, ip);
    return out;
  });
  return { groups: created.map((id) => view(getGroup(db, id))) };
}

function groupSchedule(db, user, id) {
  const g = getGroup(db, id), any = (perms) => perms.some((p) => user.can(p));
  const canLab = any(LAB), readExam = any(EXAM_READ), canExam = any(EXAM_WRITE);
  const exams = readExam ? db.prepare('SELECT id, course_code, course_name, exam_type, academic_year, semester, exam_date, start_time, end_time, hall_name, capacity, proctor_name FROM exam_schedules WHERE group_id = ? ORDER BY exam_date, start_time').all(g.id) : null;
  const courses = canLab || canExam ? db.prepare('SELECT id, code, name, program_id FROM courses WHERE active = 1 ORDER BY CASE WHEN program_id = ? THEN 0 ELSE 1 END, name LIMIT 3000').all(g.program_id ?? 0)
    .map((c) => ({ id: c.id, code: c.code ?? '', name: c.name })) : [];
  return { labs: canLab ? groupSlots(db, g.id) : null, exams, courses, canLab, canExam };
}

export function registerStudentGroupRoutes(r, deps) {
  const { db } = deps;
  r.add('GET', '/api/student-groups', (c) => { needAny(c, READ); c.json(200, { groups: listGroups(db), kinds: GROUP_KINDS }); });
  r.add('POST', '/api/student-groups', (c) => { needAny(c, WRITE); c.json(201, { group: createGroup(deps, c.user, c.body, c.ip) }); });
  r.add('POST', '/api/student-groups/split', (c) => { needAny(c, WRITE); c.json(201, splitIntoGroups(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/student-groups/:id', (c) => { needAny(c, READ); c.json(200, { group: view(getGroup(db, c.params.id)), members: membersOf(db, c.params.id) }); });
  r.add('PUT', '/api/student-groups/:id', (c) => { needAny(c, WRITE); c.json(200, { group: updateGroup(deps, c.user, c.params.id, c.body, c.ip) }); });
  r.add('DELETE', '/api/student-groups/:id', (c) => { needAny(c, WRITE); deleteGroup(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/student-groups/:id/schedule', (c) => { needAny(c, READ); c.json(200, groupSchedule(db, c.user, c.params.id)); });
  r.add('PUT', '/api/student-groups/:id/labs', (c) => { needAny(c, LAB); getGroup(db, c.params.id); c.json(200, saveGroupSlot(deps, c.user, c.params.id, c.body ?? {}, c.ip)); });
  r.add('DELETE', '/api/student-groups/:id/labs/:slotId', (c) => { needAny(c, LAB); c.json(200, removeGroupSlot(deps, c.user, c.params.id, c.params.slotId, c.ip)); });
  r.add('DELETE', '/api/student-groups/:id/exams/:examId', (c) => {
    needAny(c, EXAM_WRITE);
    const g = getGroup(db, c.params.id);
    const ex = db.prepare('SELECT id, course_name, course_code, exam_date FROM exam_schedules WHERE id = ? AND group_id = ?').get(Number(c.params.examId), g.id);
    if (!ex) throw new HttpError(404, 'الامتحان غير موجود في هذه الفئة.', 'not_found');
    db.prepare('DELETE FROM exam_schedules WHERE id = ?').run(ex.id);
    audit(db, c.user, 'حذف موعد امتحان فئة', `${g.name}: ${ex.course_name || ex.course_code} ${ex.exam_date}`, c.ip);
    c.json(200, groupSchedule(db, c.user, g.id));
  });
  r.add('PUT', '/api/student-groups/:id/members', (c) => { needAny(c, WRITE); c.json(200, changeMembers(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('GET', '/api/me/groups', (c) => { c.json(200, { groups: c.user.role === 'student' ? groupsOfStudent(db, c.user.id) : [] }); });
}
