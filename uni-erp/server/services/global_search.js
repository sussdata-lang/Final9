// بحث شامل لكامل الموقع: نتائج مصنفة بنوعها، كل نوع بصلاحيته، ومعها ما يلزم الواجهة لفتح السجل نفسه لا الصفحة العامة.
import { listStudents } from './students.js';
import { getRequest } from './requests.js';

const LIMIT = 6;
const likeOf = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export async function globalSearch(deps, user, raw) {
  const { db } = deps;
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return { query: q, results: [] };
  const like = likeOf(q), can = (p) => !!user.can?.(p), any = (...ps) => ps.some(can);
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { if (process.env.SEARCH_DEBUG) console.error('[search]', e.message); return []; } };
  const results = [];
  const add = (type, id, title, sub, extra = {}) => results.push({ type, id, title: String(title ?? ''), sub: String(sub ?? ''), ...extra });

  if (can('student:read')) {
    try {
      const r = listStudents(deps, { q, limit: String(LIMIT) }, { user, lookupOnly: false });
      for (const s of r.students ?? []) add('student', s.id, s.name, `${s.studentNo} · ${s.program?.label || s.program?.name || ''}`);
    } catch { /* نوع واحد لا يعطّل البقية */ }
  }

  if (any('request:read_all', 'request:read_unit', 'request:create_internal')) {
    const rows = all(`SELECT r.id FROM requests r LEFT JOIN users u ON u.id = r.student_id
      WHERE r.no LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.student_no LIKE ? ESCAPE '\\' ORDER BY r.created_at DESC LIMIT 25`, like, like, like);
    let n = 0;
    for (const { id } of rows) {
      if (n >= LIMIT) break;
      try { const v = getRequest(deps, user, id); add('request', v.id, `${v.no ?? `#${v.id}`} · ${v.service?.label ?? ''}`, v.student?.name ?? '', { status: v.status }); n++; } catch { /* خارج نطاق المستخدم */ }
    }
  }

  if (any('hr_emp:view', 'hr:manage')) {
    for (const e of all(`SELECT id, name, employeeNo AS emp_no, position FROM hr_employees WHERE name LIKE ? ESCAPE '\\' OR employeeNo LIKE ? ESCAPE '\\' ORDER BY name LIMIT ${LIMIT}`, like, like)) add('employee', e.id, e.name, `${e.emp_no ?? ''} · ${e.position ?? ''}`);
  }
  if (any('hr:manage')) {
    for (const v of all(`SELECT id, title, status FROM hr_vacancies WHERE title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ${LIMIT}`, like)) add('vacancy', v.id, v.title, 'شاغر وظيفي');
    for (const a of all(`SELECT a.id, a.full_name, a.vacancy_id, v.title FROM hr_applicants a JOIN hr_vacancies v ON v.id = a.vacancy_id WHERE a.full_name LIKE ? ESCAPE '\\' OR a.national_id LIKE ? ESCAPE '\\' ORDER BY a.id DESC LIMIT ${LIMIT}`, like, like)) add('applicant', a.id, a.full_name, `متقدم: ${a.title}`, { vacancyId: a.vacancy_id });
  }

  if (any('faculty:manage', 'academic:read', 'course:manage')) {
    for (const m of all(`SELECT id, name, rank, specialty FROM faculty_members WHERE name LIKE ? ESCAPE '\\' OR specialty LIKE ? ESCAPE '\\' ORDER BY name LIMIT ${LIMIT}`, like, like)) add('faculty', m.id, m.name, `${m.rank ?? ''}${m.specialty ? ' · ' + m.specialty : ''}`);
    for (const c of all(`SELECT id, name, code FROM courses WHERE name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' ORDER BY name LIMIT ${LIMIT}`, like, like)) add('course', c.id, c.name, c.code ?? '');
  }

  if (can('procurement:read')) {
    for (const s of all(`SELECT id, name, code FROM proc_suppliers WHERE name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' ORDER BY name LIMIT ${LIMIT}`, like, like)) add('supplier', s.id, s.name, s.code ?? '');
    for (const o of all(`SELECT o.id, o.no, s.name AS supplier FROM proc_orders o LEFT JOIN proc_suppliers s ON s.id = o.supplier_id WHERE o.no LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' ORDER BY o.id DESC LIMIT ${LIMIT}`, like, like)) add('porder', o.id, `أمر توريد ${o.no}`, o.supplier ?? '');
    for (const r of all(`SELECT id, no, title FROM proc_requests WHERE no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ${LIMIT}`, like, like)) add('preq', r.id, `طلب شراء ${r.no}`, r.title ?? '');
    for (const r of all(`SELECT id, no, title FROM proc_rfqs WHERE no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ${LIMIT}`, like, like)) add('rfq', r.id, `طلب عروض ${r.no}`, r.title ?? '');
  }

  if (any('corr:use', 'corr:read_all')) {
    const mine = can('corr:read_all') ? '' : 'AND d.creator_id = ?', args = can('corr:read_all') ? [] : [user.id];
    for (const d of all(`SELECT d.id, d.no, d.title FROM corr_docs d WHERE (d.no LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\' OR d.subject LIKE ? ESCAPE '\\') ${mine} ORDER BY d.id DESC LIMIT ${LIMIT}`, like, like, like, ...args)) add('corr', d.id, d.title, d.no);
  }

  if (can('user:manage')) {
    for (const u of all(`SELECT id, username, display_name FROM users WHERE role <> 'student' AND (CAST(username AS TEXT) COLLATE "C" LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\') ORDER BY display_name LIMIT ${LIMIT}`, like, like)) add('account', u.id, u.display_name, u.username);
  }

  return { query: q, results };
}
