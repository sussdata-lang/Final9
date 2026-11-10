// مكونات علامة المقرر، وإعلان النتائج وقفلها. بعد القفل لا تتغير علامات المقرر في ذلك العام
// إلا بمسار استثنائي: صلاحية grade:unlock وتبرير يُسجَّل في سجل تغييرات العلامات.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { tx } from '../db.js';
import { getSetting } from './settings.js';
import { needJustification } from './workflow.js';
import { academicYear } from '../lib/doc_no.js';
import { writeXlsx } from '../lib/xlsx.js';
import { sendRaw } from '../http.js';

export const COMPONENT_KINDS = { theory: 'نظري', practical: 'عملي' };
const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const YEAR_RE = /^(\d{4})\/(\d{4})$/;

export const courseComponents = (db, courseId) => db.prepare('SELECT * FROM course_grade_components WHERE course_id = ? ORDER BY seq, id').all(Number(courseId))
  .map((c) => ({ id: Number(c.id), name: c.name, kind: c.kind, kindLabel: COMPONENT_KINDS[c.kind], max: Number(c.max_mark) }));

export function saveComponents({ db }, actor, courseId, b, ip) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(courseId));
  if (!course) throw bad('المقرر غير موجود.', 404, 'not_found');
  const list = Array.isArray(b?.components) ? b.components : [];
  if (list.length > 10) throw bad('حتى 10 مكونات للمقرر.');
  const total = Number(getSetting(db, 'grades.total_max'));
  const clean = list.map((x, i) => {
    const name = String(x?.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 40) throw bad(`اسم المكوّن ${i + 1} من 2 إلى 40 حرفاً.`);
    if (!COMPONENT_KINDS[x?.kind]) throw bad(`نوع المكوّن «${name}»: نظري أو عملي.`);
    const max = Number(x?.max);
    if (!Number.isInteger(max) || max < 1 || max > total) throw bad(`وزن «${name}» من 1 إلى ${total}.`);
    return { name, kind: x.kind, max, seq: i };
  });
  if (new Set(clean.map((x) => x.name)).size !== clean.length) throw bad('أسماء المكونات مكررة.');
  const sum = clean.reduce((s, x) => s + x.max, 0);
  if (clean.length && sum !== total) throw bad(`مجموع أوزان المكونات ${sum}، ويجب أن يساوي العلامة الكاملة ${total}.`);
  // بعد رصد علامات بمكونات المقرر لا تتغير أوزانه، كي لا تختلف العلامات المرصودة عن أصلها
  if (db.prepare('SELECT 1 FROM grade_component_marks m JOIN course_grade_components c ON c.id = m.component_id WHERE c.course_id = ? LIMIT 1').get(course.id)) {
    throw bad('رُصدت علامات بمكونات هذا المقرر؛ لا تتغير أوزانه بعدها.', 409, 'components_in_use');
  }
  tx(db, () => {
    db.prepare('DELETE FROM course_grade_components WHERE course_id = ?').run(course.id);
    const ins = db.prepare('INSERT INTO course_grade_components (course_id, name, kind, max_mark, seq) VALUES (?,?,?,?,?)');
    for (const x of clean) ins.run(course.id, x.name, x.kind, x.max, x.seq);
  });
  audit(db, actor, 'تحديد مكونات علامة مقرر', `${course.code ?? course.name}: ${clean.map((x) => `${x.name} ${x.max}`).join('، ') || 'نظري وعملي'}`.slice(0, 300), ip);
  return { components: courseComponents(db, course.id) };
}

// علامات المكونات المرسلة: كل مكوّن ضمن وزنه، والمجموع والنظري والعملي محسوبة منها
export function componentMarks(db, courseId, input) {
  const comps = courseComponents(db, courseId);
  if (!comps.length) return null;
  if (input === undefined || input === null || typeof input !== 'object') throw bad(`علامة هذا المقرر من مكوناته، فأدخل علامة كل مكوّن: ${comps.map((c) => `${c.name} (من ${c.max})`).join('، ')}.`, 400, 'components_required');
  const marks = comps.map((c) => {
    const raw = input?.[c.id] ?? input?.[String(c.id)];
    const v = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isInteger(v) || v < 0 || v > c.max) throw bad(`علامة «${c.name}» عدد صحيح من 0 إلى ${c.max}.`);
    return { id: c.id, kind: c.kind, mark: v };
  });
  const sum = (k) => marks.filter((m) => !k || m.kind === k).reduce((s, m) => s + m.mark, 0);
  return { marks, total: sum(), theory: sum('theory'), practical: comps.some((c) => c.kind === 'practical') ? sum('practical') : null };
}

export function saveComponentMarks(db, gradeId, marks) {
  const up = db.prepare('INSERT INTO grade_component_marks (grade_id, component_id, mark) VALUES (?,?,?) ON CONFLICT (grade_id, component_id) DO UPDATE SET mark = excluded.mark');
  for (const m of marks) up.run(Number(gradeId), m.id, m.mark);
}

export const isLocked = (db, courseId, year) => !!db.prepare('SELECT 1 FROM grade_locks WHERE course_id = ? AND academic_year = ?').get(Number(courseId), String(year));

// يعيد التبرير إن كان المقرر مقفلاً ويملك المستخدم المسار الاستثنائي، ويرفض غير ذلك
export function assertEditable(db, actor, courseId, year, justification, decisionNo) {
  if (!courseId || !isLocked(db, courseId, year)) return null;
  if (!actor?.can?.('grade:unlock')) throw bad('أُعلنت نتائج هذا المقرر وقُفلت علاماته؛ يُعدَّل بعدها بمسار استثنائي لمن يملك صلاحية تعديل النتائج المقفلة، وبتبرير.', 409, 'grades_locked');
  return needJustification(justification, decisionNo);
}

export function resultsSummary({ db }, q = {}) {
  const year = YEAR_RE.test(String(q.year ?? '')) ? String(q.year) : academicYear();
  const rows = db.prepare(`SELECT g.course_id, c.name, c.code, COUNT(*) AS total, SUM(CASE WHEN g.workflow_status = 'approved' THEN 1 ELSE 0 END) AS approved,
      l.locked_at, u.display_name AS locked_by
    FROM grades g JOIN courses c ON c.id = g.course_id LEFT JOIN grade_locks l ON l.course_id = g.course_id AND l.academic_year = g.academic_year LEFT JOIN users u ON u.id = l.locked_by
    WHERE g.academic_year = ? GROUP BY g.course_id, c.name, c.code, l.locked_at, u.display_name ORDER BY c.name`).all(year);
  return { year, courses: rows.map((r) => ({ courseId: Number(r.course_id), name: r.name, code: r.code, total: Number(r.total), approved: Number(r.approved), lockedAt: r.locked_at ? Number(r.locked_at) : null, lockedBy: r.locked_by })) };
}

export function lockResults({ db }, actor, b, ip) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(b?.courseId));
  if (!course) throw bad('المقرر غير موجود.', 404, 'not_found');
  const year = String(b?.academicYear ?? '');
  const m = YEAR_RE.exec(year);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw bad('العام الدراسي بصيغة 2025/2026.');
  if (isLocked(db, course.id, year)) throw bad('أُعلنت نتائج هذا المقرر مسبقاً.', 409, 'conflict');
  const s = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN workflow_status = 'approved' THEN 0 ELSE 1 END) AS open FROM grades WHERE course_id = ? AND academic_year = ?").get(course.id, year);
  if (!Number(s.total)) throw bad('لا علامات مرصودة لهذا المقرر في هذا العام.', 409, 'conflict');
  if (Number(s.open)) throw bad(`بقيت ${s.open} علامة غير معتمدة؛ تُعلن النتائج بعد اعتمادها كلها.`, 409, 'not_approved');
  db.prepare('INSERT INTO grade_locks (course_id, academic_year, locked_by, locked_at) VALUES (?,?,?,?)').run(course.id, year, actor.id ?? null, Date.now());
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'results_published', ?, ?, '', ?) ON CONFLICT DO NOTHING");
  for (const st of db.prepare('SELECT DISTINCT student_id FROM grades WHERE course_id = ? AND academic_year = ?').all(course.id, year)) ins.run(st.student_id, course.id, `أُعلنت نتيجة مقرر ${course.name} للعام ${year}.`, Date.now());
  audit(db, actor, 'إعلان نتائج مقرر وقفل علاماته', `${course.code ?? course.name} ${year}: ${s.total} علامة`, ip);
  return { locked: Number(s.total) };
}

// قالب Excel لمقرر: عمود لكل مكوّن باسمه، ليُملأ ويُستورد دون ضبط يدوي للأعمدة
export function gradesTemplate({ db }, courseId) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(courseId));
  if (!c) throw bad('المقرر غير موجود.', 404, 'not_found');
  const comps = courseComponents(db, c.id);
  const head = ['الرقم الجامعي', 'رمز المقرر', 'العام الدراسي', ...(comps.length ? comps.map((x) => x.name) : ['العلامة النظرية', 'العلامة العملية'])];
  const info = [['تعليمات'], [`مقرر: ${c.name}${c.code ? ` (${c.code})` : ''}`], [comps.length ? `العلامة من المكونات: ${comps.map((x) => `${x.name} من ${x.max}`).join('، ')}. اترك صف العناوين كما هو.` : 'لا مكونات محددة لهذا المقرر: تُرصد العلامة النظرية والعملية.'], ['العام الدراسي بصيغة 2026/2027.']];
  return writeXlsx([{ name: 'تعليمات', rows: info, widths: [70], rtl: true }, { name: 'العلامات', rows: [head, ['', c.code ?? '', academicYear(), ...head.slice(3).map(() => '')]], widths: head.map((_, i) => (i < 3 ? 18 : 22)), rtl: true, freeze: true }], { title: 'علامات' });
}

export function registerGradingRoutes(r, deps) {
  const any = (c, ...perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/courses/:id/components', (c) => {
    any(c, 'grade:manage', 'course:manage', 'academic:read', 'grade:approve');
    const q = c.query ?? {}, marks = q.studentId && q.year ? Object.fromEntries(deps.db.prepare('SELECT m.component_id, m.mark FROM grade_component_marks m JOIN grades g ON g.id = m.grade_id WHERE g.course_id = ? AND g.student_id = ? AND g.academic_year = ?').all(Number(c.params.id), Number(q.studentId), String(q.year)).map((x) => [Number(x.component_id), Number(x.mark)])) : null;
    c.json(200, { components: courseComponents(deps.db, c.params.id), kinds: COMPONENT_KINDS, totalMax: Number(getSetting(deps.db, 'grades.total_max')), marks });
  });
  r.add('GET', '/api/courses/:id/grades-template.xlsx', (c) => { any(c, 'grade:manage', 'course:manage'); sendRaw(c.res, 200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="grades-course-${Number(c.params.id)}.xlsx"` }, gradesTemplate(deps, c.params.id)); });
  r.add('PUT', '/api/courses/:id/components', (c) => c.json(200, saveComponents(deps, any(c, 'course:manage'), c.params.id, c.body, c.ip)));
  r.add('GET', '/api/grades/results', (c) => { any(c, 'grade:approve', 'grade:manage'); c.json(200, resultsSummary(deps, c.query ?? {})); });
  r.add('POST', '/api/grades/results/lock', (c) => c.json(200, lockResults(deps, any(c, 'grade:approve'), c.body, c.ip)));
}
