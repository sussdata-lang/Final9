// تقييم الأداء الوظيفي الشامل: محاور بأوزان ومعايير (1–5)، ومسؤوليات الوظيفة الخاصة بالموظف، ونسبة الدوام آلياً من سجل الحضور،
// ونقاط القوة والتحسين والاحتياجات التدريبية وأهداف الفترة القادمة. المسار: مسودة ← مُرسل للاعتماد ← معتمد (بيد غير المقيّم)
// ← اطلاع الموظف وتعليقه. تُحفظ أيضاً الدرجات المختصرة القديمة (الالتزام/الجودة/التعاون/المعدل) لتبقى التقارير السابقة تعمل.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getSetting } from './settings.js';
import { dayKey } from './staffatt.js';

const bad = (m, s = 400, code = 'validation') => new HttpError(s, m, code);
export const SCALE = { 1: 'ضعيف', 2: 'مقبول', 3: 'جيد', 4: 'جيد جداً', 5: 'ممتاز' };
export const AXES = [
  { key: 'discipline', label: 'الانضباط والالتزام', weight: 15, criteria: [['attendance', 'الالتزام بمواعيد الدوام والانصراف (يُقترح من سجل الحضور)'], ['rules', 'التقيد بالأنظمة والتعليمات النافذة'], ['confidentiality', 'المحافظة على سرية العمل وممتلكات الجامعة']] },
  { key: 'tasks', label: 'أداء المهام والمسؤوليات', weight: 30, criteria: [['timeliness', 'إنجاز المهام في مواعيدها'], ['quality', 'جودة العمل ودقته'], ['volume', 'حجم الإنجاز مقارنة بالمطلوب'], ['job_knowledge', 'المعرفة بمتطلبات الوظيفة وإجراءاتها']] },
  { key: 'skills', label: 'المهارات والكفايات', weight: 20, criteria: [['problem_solving', 'حل المشكلات واتخاذ القرار ضمن الصلاحيات'], ['initiative', 'المبادرة وتقديم المقترحات'], ['technology', 'استخدام الأنظمة والتقنيات'], ['learning', 'التعلم والتطوير الذاتي']] },
  { key: 'relations', label: 'العلاقات والتواصل', weight: 15, criteria: [['teamwork', 'العمل بروح الفريق'], ['service', 'التعامل مع الطلاب والمراجعين'], ['communication', 'التواصل مع الرؤساء والزملاء']] },
  { key: 'leadership', label: 'القيادة والإشراف (للمشرفين فقط)', weight: 10, supervisorOnly: true, criteria: [['planning', 'التخطيط وتنظيم العمل'], ['guidance', 'توجيه المرؤوسين وتطويرهم'], ['delegation', 'التفويض والمتابعة والمساءلة']] },
];
export const RESP_WEIGHT = 20;       // مسؤوليات الوظيفة الخاصة: تدخل الحساب إن ذُكرت
export const RECOMMENDATIONS = ['علاوة دورية', 'علاوة دورية ومكافأة تميز', 'ترشيح للترقية', 'تثبيت في الوظيفة', 'برنامج تدريبي', 'خطة تحسين أداء', 'إنذار ومتابعة', 'دون توصية'];
const gradeOf = (pct) => (pct >= 90 ? 'ممتاز' : pct >= 80 ? 'جيد جداً' : pct >= 70 ? 'جيد' : pct >= 60 ? 'مقبول' : 'ضعيف');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max, label, min = 0) => {
  const s = String(v ?? '').replace(/[ \t]+/g, ' ').trim();
  if (s.length < min || s.length > max) throw bad(min ? `«${label}» من ${min} إلى ${max} حرفاً.` : `«${label}» حتى ${max} حرفاً.`);
  if (/[\x00-\x08\x0b-\x1f<>]/.test(s)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`);
  return s;
};
const applicable = (sup) => AXES.filter((a) => !a.supervisorOnly || sup);

// نسبة الدوام في الفترة: أيام الحضور ÷ أيام العمل (بلا العطلة الأسبوعية والإجازات المعتمدة) حتى اليوم
export function attendanceFor(db, userId, from, to) {
  if (!DAY.test(String(from)) || !DAY.test(String(to)) || from > to) throw bad('فترة التقييم: من وإلى بصيغة 2026-01-01، والبداية قبل النهاية.');
  const weekend = String(getSetting(db, 'hr.weekend') || 'fri,sat').split(','), names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const end = to < dayKey(Date.now()) ? to : dayKey(Date.now());
  const leaves = db.prepare('SELECT from_day, to_day FROM leave_records WHERE user_id = ? AND to_day >= ? AND from_day <= ?').all(Number(userId), from, end);
  const present = new Set(db.prepare('SELECT day FROM staff_attendance WHERE user_id = ? AND day >= ? AND day <= ?').all(Number(userId), from, end).map((r) => r.day));
  let work = 0, here = 0, leave = 0;
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (weekend.includes(names[new Date(t).getUTCDay()])) continue;
    if (leaves.some((l) => l.from_day <= d && d <= l.to_day)) { leave++; continue; }
    work++; if (present.has(d)) here++;
  }
  const pct = work ? Math.round((here / work) * 1000) / 10 : null;
  const suggested = pct == null ? null : pct >= 97 ? 5 : pct >= 93 ? 4 : pct >= 88 ? 3 : pct >= 80 ? 2 : 1;
  return { workDays: work, presentDays: here, leaveDays: leave, pct, suggested };
}

function compute(sup, scores, resp) {
  const axes = applicable(sup).map((a) => {
    const vals = a.criteria.map(([k]) => Number(scores[k])).filter((v) => v >= 1 && v <= 5);
    return { key: a.key, label: a.label, weight: a.weight, pct: vals.length === a.criteria.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 200) / 10 : null };
  });
  if (resp.length) axes.push({ key: 'responsibilities', label: 'مسؤوليات الوظيفة الخاصة', weight: RESP_WEIGHT, pct: Math.round((resp.reduce((s, r) => s + r.rating, 0) / resp.length) * 200) / 10 });
  const done = axes.filter((a) => a.pct != null), wsum = done.reduce((s, a) => s + a.weight, 0);
  const overall = done.length === axes.length && wsum ? Math.round((done.reduce((s, a) => s + a.weight * a.pct, 0) / wsum) * 10) / 10 : null;
  return { axes, overall, grade: overall == null ? null : gradeOf(overall) };
}

function values(db, b, cur = {}, final) {
  const pick = (k, col) => (b?.[k] !== undefined ? b[k] : cur[col]);
  const uid = Number(pick('userId', 'user_id'));
  const u = uid ? db.prepare("SELECT u.id, u.display_name, u.job_title, o.name AS unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.id = ? AND u.role != 'student'").get(uid) : null;
  if (!u) throw bad('اختر الموظف من سجل الموظفين.');
  const from = String(pick('periodFrom', 'period_from') ?? ''), to = String(pick('periodTo', 'period_to') ?? '');
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw bad('فترة التقييم: من وإلى بصيغة 2026-01-01، والبداية قبل النهاية.');
  const sup = !!(b?.isSupervisor !== undefined ? b.isSupervisor : Number(cur.is_supervisor || 0));
  const raw = b?.scores !== undefined ? b.scores : JSON.parse(cur.scores_json || '{}');
  const keys = applicable(sup).flatMap((a) => a.criteria.map(([k]) => k)), scores = {};
  for (const k of keys) {
    const v = raw?.[k];
    if (v === undefined || v === null || v === '') { if (final) throw bad('قيّم كل المعايير قبل الإرسال للاعتماد.'); continue; }
    if (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 5) throw bad('كل معيار تقدير من 1 (ضعيف) إلى 5 (ممتاز).');
    scores[k] = Number(v);
  }
  const respIn = b?.responsibilities !== undefined ? b.responsibilities : JSON.parse(cur.responsibilities_json || '[]');
  if (!Array.isArray(respIn) || respIn.length > 15) throw bad('مسؤوليات الوظيفة: حتى 15 مسؤولية.');
  const resp = respIn.filter((r) => String(r?.title ?? '').trim()).map((r, i) => {
    const rating = Number(r.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad(`المسؤولية ${i + 1}: التقدير من 1 إلى 5.`);
    return { title: txt(r.title, 120, `المسؤولية ${i + 1}`, 2), rating, comment: txt(r.comment, 200, `تعليق المسؤولية ${i + 1}`) };
  });
  const att = attendanceFor(db, u.id, from, to);
  const calc = compute(sup, scores, resp);
  const rec = txt(pick('recommendation', 'recommendation'), 80, 'التوصية');
  return {
    u, sup, scores, resp, att, calc, from, to,
    jobTitle: txt(pick('jobTitle', 'job_title') ?? u.job_title, 80, 'المسمى الوظيفي'),
    periodLabel: txt(pick('periodLabel', 'period_label'), 60, 'دورة التقييم', 3),
    recommendation: rec || 'دون توصية',
    strengths: txt(pick('strengths', 'strengths'), 1000, 'نقاط القوة'), improvements: txt(pick('improvements', 'improvements'), 1000, 'مجالات التحسين'),
    training: txt(pick('trainingNeeds', 'training_needs'), 1000, 'الاحتياجات التدريبية'), goals: txt(pick('goalsNext', 'goals_next'), 1000, 'أهداف الفترة القادمة'),
  };
}
// الدرجات المختصرة القديمة من المحاور (لتقارير ما قبل التقييم الشامل)
const legacy = (calc) => { const g = (k) => Math.round(calc.axes.find((a) => a.key === k)?.pct ?? 0); return [g('discipline'), g('tasks'), g('relations'), calc.overall ?? 0]; };

function view(db, r) {
  const sup = !!Number(r.is_supervisor || 0), scores = JSON.parse(r.scores_json || '{}'), resp = JSON.parse(r.responsibilities_json || '[]');
  const by = (id) => (id ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name ?? '' : '');
  return {
    id: Number(r.id), userId: r.user_id ? Number(r.user_id) : null, employeeName: r.employee_name, department: r.department, jobTitle: r.job_title ?? '', periodLabel: r.period_label,
    periodFrom: r.period_from ?? '', periodTo: r.period_to ?? '', isSupervisor: sup, scores, responsibilities: resp, attendancePct: r.attendance_pct == null ? null : Number(r.attendance_pct),
    breakdown: r.scores_json ? compute(sup, scores, resp).axes : null, overall: Number(r.overall_score), grade: r.grade || gradeOf(Number(r.overall_score)),
    legacy: !r.scores_json, punctuality: Number(r.punctuality_score), productivity: Number(r.productivity_score), teamwork: Number(r.teamwork_score),
    recommendation: r.recommendation, strengths: r.strengths ?? '', improvements: r.improvements ?? '', trainingNeeds: r.training_needs ?? '', goalsNext: r.goals_next ?? '',
    status: r.status || 'approved', evaluatorId: r.evaluator_id ? Number(r.evaluator_id) : null, evaluatorName: r.evaluator_name, approvedBy: by(r.approved_by), approvedAt: r.approved_at ? Number(r.approved_at) : null,
    employeeComment: r.employee_comment ?? '', acknowledgedAt: r.acknowledged_at ? Number(r.acknowledged_at) : null, createdAt: Number(r.created_at),
  };
}
const one = (db, id) => { const r = db.prepare('SELECT * FROM hr_appraisals WHERE id = ?').get(Number(id)); if (!r) throw bad('التقييم غير موجود.', 404, 'not_found'); return r; };

export function template({ db }) {
  const employees = db.prepare("SELECT u.id, u.display_name, u.job_title, o.name AS unit FROM users u LEFT JOIN org_units o ON o.id = u.unit_id WHERE u.role != 'student' AND u.active = 1 ORDER BY o.name, u.display_name").all()
    .map((u) => ({ id: Number(u.id), name: u.display_name, jobTitle: u.job_title ?? '', unit: u.unit ?? '' }));
  return { axes: AXES.map((a) => ({ key: a.key, label: a.label, weight: a.weight, supervisorOnly: !!a.supervisorOnly, criteria: a.criteria.map(([key, label]) => ({ key, label })) })), respWeight: RESP_WEIGHT, scale: SCALE, recommendations: RECOMMENDATIONS, employees };
}
export const listAppraisals = ({ db }) => ({ appraisals: db.prepare('SELECT * FROM hr_appraisals ORDER BY id DESC LIMIT 500').all().map((r) => view(db, r)) });
export const getAppraisal = ({ db }, id) => ({ appraisal: view(db, one(db, id)) });

export function saveAppraisal({ db }, actor, id, b, ip) {
  const cur = id ? one(db, id) : {};
  if (id && cur.status === 'approved') throw bad('اعتُمد هذا التقييم؛ لا يُعدَّل.', 409, 'conflict');
  if (id && Number(cur.evaluator_id) !== Number(actor.id) && !actor.can('hr:manage')) throw bad('يعدّل التقييمَ مُعدُّه أو مدير شؤون الموظفين.', 403, 'forbidden');
  const submit = b?.submit === true, v = values(db, b, cur, submit);
  if (Number(v.u.id) === Number(actor.id)) throw bad('لا يقيّم الموظف نفسه.', 403, 'forbidden');
  const [p1, p2, p3, overall] = legacy(v.calc), status = submit ? 'submitted' : 'draft', now = Date.now();
  const row = [v.u.display_name, v.u.unit || '—', v.periodLabel, p1, p2, p3, overall, v.recommendation, actor.display_name ?? actor.label ?? '', v.u.id, v.jobTitle || null, v.from, v.to, v.sup ? 1 : 0,
    JSON.stringify(v.scores), JSON.stringify(v.resp), v.att.pct, v.strengths || null, v.improvements || null, v.training || null, v.goals || null, v.calc.grade, status, now];
  const COLS = 'employee_name, department, period_label, punctuality_score, productivity_score, teamwork_score, overall_score, recommendation, evaluator_name, user_id, job_title, period_from, period_to, is_supervisor, scores_json, responsibilities_json, attendance_pct, strengths, improvements, training_needs, goals_next, grade, status, updated_at';
  const out = tx(db, () => {
    let rid = id ? Number(cur.id) : null;
    if (rid) db.prepare(`UPDATE hr_appraisals SET ${COLS.split(', ').map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...row, rid);
    else rid = Number(db.prepare(`INSERT INTO hr_appraisals (${COLS}, evaluator_id, created_at) VALUES (${row.map(() => '?').join(', ')}, ?, ?) RETURNING id`).get(...row, actor.id ?? null, now).id);
    audit(db, actor, submit ? 'إرسال تقييم أداء للاعتماد' : 'حفظ مسودة تقييم أداء', `${v.u.display_name} · ${v.periodLabel}`.slice(0, 200), ip);
    return rid;
  });
  return getAppraisal({ db }, out);
}
export function approveAppraisal({ db }, actor, id, ip) {
  const r = one(db, id);
  if (r.status !== 'submitted') throw bad('لا يُعتمد إلا تقييم مُرسل للاعتماد.', 409, 'conflict');
  if (Number(r.evaluator_id) === Number(actor.id)) throw bad('يعتمد التقييمَ غيرُ من أعدّه (فصل المهام).', 403, 'sod_violation');
  tx(db, () => {
    db.prepare("UPDATE hr_appraisals SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?").run(actor.id ?? null, Date.now(), Date.now(), r.id);
    if (r.user_id) db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'appraisal_approved', ?, ?, '', ?) ON CONFLICT DO NOTHING")
      .run(r.user_id, r.id, `اعتُمد تقييم أدائك (${r.period_label}): ${r.grade || ''} ${Number(r.overall_score)}%. اطّلع عليه وأضف تعليقك.`, Date.now());
    audit(db, actor, 'اعتماد تقييم أداء', `${r.employee_name} · ${r.period_label}`.slice(0, 200), ip);
  });
  return getAppraisal({ db }, r.id);
}
export function returnAppraisal({ db }, actor, id, b, ip) {
  const r = one(db, id);
  if (r.status !== 'submitted') throw bad('لا يُعاد إلا تقييم مُرسل للاعتماد.', 409, 'conflict');
  const note = txt(b?.note, 300, 'سبب الإعادة', 3);
  db.prepare("UPDATE hr_appraisals SET status = 'draft', updated_at = ? WHERE id = ?").run(Date.now(), r.id);
  audit(db, actor, 'إعادة تقييم أداء للمقيّم', `${r.employee_name}: ${note}`.slice(0, 200), ip);
  return getAppraisal({ db }, r.id);
}
export const myAppraisals = ({ db }, user) => ({ appraisals: db.prepare("SELECT * FROM hr_appraisals WHERE user_id = ? AND status = 'approved' ORDER BY id DESC").all(user.id).map((r) => view(db, r)) });
export function acknowledge({ db }, user, id, b, ip) {
  const r = one(db, id);
  if (Number(r.user_id) !== Number(user.id) || r.status !== 'approved') throw bad('التقييم غير موجود.', 404, 'not_found');
  if (r.acknowledged_at) throw bad('سجّلت اطلاعك على هذا التقييم مسبقاً.', 409, 'conflict');
  db.prepare('UPDATE hr_appraisals SET acknowledged_at = ?, employee_comment = ? WHERE id = ?').run(Date.now(), txt(b?.comment, 1000, 'تعليق الموظف') || null, r.id);
  audit(db, user, 'اطلاع الموظف على تقييم أدائه', r.period_label, ip);
  return getAppraisal({ db }, r.id);
}

export function registerAppraisalRoutes(r, deps) {
  const { db } = deps;
  const EDIT = ['hr_emp:edit', 'hr:manage'], READ = [...EDIT, 'hr_emp:view'];
  const need = (c, perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  const staff = (c) => { if (!c.user || c.user.role === 'student') throw bad('هذه الخدمة للموظفين.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/hr/appraisals/template', (c) => { need(c, EDIT); c.json(200, template(deps)); });
  r.add('GET', '/api/hr/appraisals/attendance', (c) => { need(c, EDIT); c.json(200, attendanceFor(db, c.query?.userId, c.query?.from, c.query?.to)); });
  r.add('GET', '/api/hr/appraisals', (c) => { need(c, READ); c.json(200, listAppraisals(deps)); });
  r.add('GET', '/api/hr/appraisals/:id', (c) => { need(c, READ); c.json(200, getAppraisal(deps, c.params.id)); });
  r.add('POST', '/api/hr/appraisals', (c) => c.json(201, saveAppraisal(deps, need(c, EDIT), null, c.body, c.ip)));
  r.add('PUT', '/api/hr/appraisals/:id', (c) => c.json(200, saveAppraisal(deps, need(c, EDIT), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/hr/appraisals/:id/approve', (c) => c.json(200, approveAppraisal(deps, need(c, ['hr:manage']), c.params.id, c.ip)));
  r.add('POST', '/api/hr/appraisals/:id/return', (c) => c.json(200, returnAppraisal(deps, need(c, ['hr:manage']), c.params.id, c.body, c.ip)));
  r.add('GET', '/api/hr/my-appraisals', (c) => c.json(200, myAppraisals(deps, staff(c))));
  r.add('POST', '/api/hr/my-appraisals/:id/acknowledge', (c) => c.json(200, acknowledge(deps, staff(c), c.params.id, c.body, c.ip)));
}
