// التوظيف: شاغر، ثم متقدمون تُفرز ملفاتهم، ثم مقابلة بلجنة وتقييم، ثم تعيين ينشئ ملف الموظف وحسابه.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getSetting } from './settings.js';
import { nextNumber } from './numbering.js';
import { createEmployeeAccount } from './employee_accounts.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const APPLICANT_STATUS = { applied: 'متقدم', shortlisted: 'مرشح', interview: 'للمقابلة', offered: 'عُرض عليه التعيين', hired: 'عُيّن', rejected: 'مستبعد' };
// الانتقالات المسموحة؛ التعيين له مساره الخاص
const NEXT = { applied: ['shortlisted', 'rejected'], shortlisted: ['interview', 'rejected'], interview: ['offered', 'rejected'], offered: ['rejected'] };

const vacancyView = (db, v) => ({
  id: Number(v.id), title: v.title, unitId: v.unit_id ? Number(v.unit_id) : null, unit: v.unit_id ? db.prepare('SELECT name FROM org_units WHERE id = ?').get(v.unit_id)?.name ?? null : null,
  positions: Number(v.positions), description: v.description, requirements: v.requirements, closesOn: v.closes_on, status: v.status,
  applicants: Number(db.prepare('SELECT COUNT(*) AS n FROM hr_applicants WHERE vacancy_id = ?').get(v.id).n),
  hired: Number(db.prepare("SELECT COUNT(*) AS n FROM hr_applicants WHERE vacancy_id = ? AND status = 'hired'").get(v.id).n),
});

export function recruitmentOverview({ db }) {
  return {
    vacancies: db.prepare("SELECT * FROM hr_vacancies ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC").all().map((v) => vacancyView(db, v)),
    units: db.prepare('SELECT id, name FROM org_units WHERE active = 1 ORDER BY name').all().map((u) => ({ id: Number(u.id), name: u.name })),
    statuses: APPLICANT_STATUS,
  };
}

export function createVacancy({ db }, actor, b, ip) {
  const title = clean(b?.title, 120);
  if (title.length < 3) throw bad('المسمى الوظيفي مطلوب.');
  const positions = Number(b?.positions ?? 1);
  if (!Number.isInteger(positions) || positions < 1 || positions > 100) throw bad('عدد الشواغر من 1 إلى 100.');
  const closes = b?.closesOn ? String(b.closesOn) : null;
  if (closes && !DAY_RE.test(closes)) throw bad('آخر موعد للتقديم بصيغة 2026-12-31.');
  const unitId = b?.unitId ? Number(b.unitId) : null;
  if (unitId && !db.prepare('SELECT 1 FROM org_units WHERE id = ?').get(unitId)) throw bad('الوحدة غير موجودة.');
  const id = Number(db.prepare('INSERT INTO hr_vacancies (title, unit_id, positions, description, requirements, closes_on, created_by, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
    .get(title, unitId, positions, clean(b?.description, 2000), clean(b?.requirements, 2000), closes, actor.id ?? null, Date.now()).id);
  audit(db, actor, 'إعلان شاغر وظيفي', `${title} (${positions})`, ip);
  return { id };
}

export function closeVacancy({ db }, actor, id, ip) {
  const v = db.prepare('SELECT * FROM hr_vacancies WHERE id = ?').get(Number(id));
  if (!v) throw bad('الشاغر غير موجود.', 404, 'not_found');
  if (v.status !== 'open') throw bad('الشاغر مغلق مسبقاً.', 409, 'conflict');
  db.prepare("UPDATE hr_vacancies SET status = 'closed' WHERE id = ?").run(v.id);
  audit(db, actor, 'إغلاق شاغر وظيفي', v.title, ip);
  return { ok: true };
}

export function vacancyDetail({ db }, id) {
  const v = db.prepare('SELECT * FROM hr_vacancies WHERE id = ?').get(Number(id));
  if (!v) throw bad('الشاغر غير موجود.', 404, 'not_found');
  return {
    vacancy: vacancyView(db, v),
    applicants: db.prepare('SELECT * FROM hr_applicants WHERE vacancy_id = ? ORDER BY id').all(v.id).map((a) => ({
      id: Number(a.id), name: a.full_name, nationalId: a.national_id, phone: a.phone, email: a.email, qualification: a.qualification, experience: Number(a.experience_years),
      status: a.status, statusLabel: APPLICANT_STATUS[a.status], note: a.note, next: NEXT[a.status] ?? [], employeeId: a.employee_id ? Number(a.employee_id) : null,
      interviews: db.prepare('SELECT * FROM hr_interviews WHERE applicant_id = ? ORDER BY scheduled_at').all(a.id).map((i) => ({
        id: Number(i.id), at: Number(i.scheduled_at), panel: i.panel, score: i.score === null ? null : Number(i.score), recommendation: i.recommendation, notes: i.notes,
      })),
    })),
  };
}

export function addApplicant({ db }, actor, vacancyId, b, ip) {
  const v = db.prepare('SELECT * FROM hr_vacancies WHERE id = ?').get(Number(vacancyId));
  if (!v) throw bad('الشاغر غير موجود.', 404, 'not_found');
  if (v.status !== 'open') throw bad('الشاغر مغلق.', 409, 'conflict');
  const name = clean(b?.name, 100), nid = clean(b?.nationalId, 20);
  if (name.length < 5) throw bad('اسم المتقدم الكامل مطلوب.');
  if (!/^\d{6,20}$/.test(nid)) throw bad('الرقم الوطني أرقام فقط.');
  if (db.prepare('SELECT 1 FROM hr_applicants WHERE vacancy_id = ? AND national_id = ?').get(v.id, nid)) throw bad('تقدّم صاحب هذا الرقم الوطني لهذا الشاغر مسبقاً.', 409, 'conflict');
  const exp = Number(b?.experience ?? 0);
  if (!Number.isInteger(exp) || exp < 0 || exp > 60) throw bad('سنوات الخبرة من 0 إلى 60.');
  const id = Number(db.prepare('INSERT INTO hr_applicants (vacancy_id, full_name, national_id, phone, email, qualification, experience_years, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
    .get(v.id, name, nid, clean(b?.phone, 30), clean(b?.email, 100), clean(b?.qualification, 200), exp, actor.id ?? null, Date.now()).id);
  audit(db, actor, 'تسجيل متقدم لشاغر', `${v.title}: ${name}`, ip);
  return { id };
}

const loadApplicant = (db, id) => {
  const a = db.prepare('SELECT a.*, v.title AS vacancy_title, v.unit_id, v.positions, v.status AS vacancy_status FROM hr_applicants a JOIN hr_vacancies v ON v.id = a.vacancy_id WHERE a.id = ?').get(Number(id));
  if (!a) throw bad('المتقدم غير موجود.', 404, 'not_found');
  return a;
};

export function moveApplicant({ db }, actor, id, b, ip) {
  const a = loadApplicant(db, id), to = String(b?.status ?? '');
  if (!(NEXT[a.status] ?? []).includes(to)) throw bad(`لا ينتقل المتقدم من «${APPLICANT_STATUS[a.status]}» إلى «${APPLICANT_STATUS[to] ?? to}».`, 409, 'conflict');
  const note = clean(b?.note, 300);
  if (to === 'rejected' && note.length < 3) throw bad('سبب الاستبعاد مطلوب.');
  if (to === 'offered' && !db.prepare("SELECT 1 FROM hr_interviews WHERE applicant_id = ? AND recommendation = 'hire'").get(a.id)) throw bad('يُعرض التعيين بعد مقابلة توصي بالتعيين.', 409, 'conflict');
  db.prepare('UPDATE hr_applicants SET status = ?, note = ? WHERE id = ?').run(to, note || a.note, a.id);
  audit(db, actor, `متقدم: ${APPLICANT_STATUS[to]}`, `${a.vacancy_title}: ${a.full_name}`, ip);
  return { ok: true };
}

export function scheduleInterview({ db }, actor, id, b, ip) {
  const a = loadApplicant(db, id);
  if (a.status !== 'interview') throw bad('تُحدد المقابلة للمتقدم المحال إليها.', 409, 'conflict');
  const at = new Date(String(b?.at ?? '')).getTime();
  if (!Number.isFinite(at)) throw bad('موعد المقابلة غير صالح.');
  const panel = clean(b?.panel, 300);
  if (panel.length < 3) throw bad('أعضاء لجنة المقابلة مطلوبون.');
  const iid = Number(db.prepare('INSERT INTO hr_interviews (applicant_id, scheduled_at, panel, created_by, created_at) VALUES (?,?,?,?,?) RETURNING id').get(a.id, at, panel, actor.id ?? null, Date.now()).id);
  audit(db, actor, 'تحديد مقابلة توظيف', `${a.full_name}: ${new Date(at).toISOString().slice(0, 16)}`, ip);
  return { id: iid };
}

export function recordInterview({ db }, actor, interviewId, b, ip) {
  const i = db.prepare('SELECT * FROM hr_interviews WHERE id = ?').get(Number(interviewId));
  if (!i) throw bad('المقابلة غير موجودة.', 404, 'not_found');
  if (i.recommendation) throw bad('سُجلت نتيجة هذه المقابلة مسبقاً.', 409, 'conflict');
  const score = Number(b?.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) throw bad('التقييم من 0 إلى 100.');
  const rec = String(b?.recommendation ?? '');
  if (!['hire', 'reserve', 'reject'].includes(rec)) throw bad('التوصية: تعيين أو احتياط أو استبعاد.');
  db.prepare('UPDATE hr_interviews SET score = ?, recommendation = ?, notes = ? WHERE id = ?').run(score, rec, clean(b?.notes, 1000), i.id);
  audit(db, actor, 'تسجيل نتيجة مقابلة توظيف', `#${i.applicant_id}: ${score} (${rec})`, ip);
  return { ok: true };
}

// التعيين: ملف موظف من بيانات المتقدم، وحساب بصلاحيات دنيا إن كان الإعداد مفعلاً؛ ويُغلق الشاغر باكتمال عدده
export async function hireApplicant({ db, cfg }, actor, id, b, ip) {
  const a = loadApplicant(db, id);
  if (a.status !== 'offered') throw bad('يُعيَّن المتقدم بعد قبوله عرض التعيين.', 409, 'conflict');
  if (db.prepare('SELECT 1 FROM hr_employees WHERE personalId = ?').get(a.national_id)) throw bad('يوجد موظف بهذا الرقم الوطني.', 409, 'conflict');
  const salary = Number(b?.baseSalary ?? 0);
  if (!Number.isFinite(salary) || salary < 0) throw bad('الراتب الأساسي غير صالح.');
  const day = new Date().toISOString().slice(0, 10), now = Date.now();
  const employeeNo = `EMP-${nextNumber(db, 'hr_employees', 'SELECT COUNT(*) FROM hr_employees')}`;
  const empId = Number(db.prepare(`INSERT INTO hr_employees (employeeNo, name, personalId, email, phone, hireDate, status, unit_id, position, salary_base, joinDate, emp_status_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'نشط', ?, ?) RETURNING id`).get(employeeNo, a.full_name, a.national_id, a.email, a.phone, day, a.unit_id, a.vacancy_title, salary, day, now, now).id);
  if (salary > 0) db.prepare('INSERT INTO hr_salaries (employee_id, amount, effective_at, created_by, created_at, ip) VALUES (?,?,?,?,?,?)').run(empId, salary, now, actor.id ?? null, now, ip ?? '');
  db.prepare("UPDATE hr_applicants SET status = 'hired', employee_id = ? WHERE id = ?").run(empId, a.id);
  const hired = Number(db.prepare("SELECT COUNT(*) AS n FROM hr_applicants WHERE vacancy_id = ? AND status = 'hired'").get(a.vacancy_id).n);
  if (hired >= Number(a.positions)) db.prepare("UPDATE hr_vacancies SET status = 'filled' WHERE id = ?").run(a.vacancy_id);
  audit(db, actor, 'تعيين متقدم من مسار التوظيف', `${a.vacancy_title}: ${a.full_name} -> ${employeeNo}`, ip);
  const account = getSetting(db, 'hr.auto_account') ? await createEmployeeAccount({ db, cfg }, actor, empId, ip) : null;
  return { employeeId: empId, employeeNo, account };
}

export function registerRecruitmentRoutes(r, deps) {
  const hr = (c) => { if (!c.user || (!c.user.can('hr:manage') && c.user.role !== 'admin')) throw bad('التوظيف يتطلب صلاحية إدارة الموارد البشرية.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/recruitment', (c) => { hr(c); c.json(200, recruitmentOverview(deps)); });
  r.add('POST', '/api/recruitment/vacancies', (c) => c.json(201, createVacancy(deps, hr(c), c.body, c.ip)));
  r.add('GET', '/api/recruitment/vacancies/:id', (c) => { hr(c); c.json(200, vacancyDetail(deps, c.params.id)); });
  r.add('POST', '/api/recruitment/vacancies/:id/close', (c) => c.json(200, closeVacancy(deps, hr(c), c.params.id, c.ip)));
  r.add('POST', '/api/recruitment/vacancies/:id/applicants', (c) => c.json(201, addApplicant(deps, hr(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/recruitment/applicants/:id/move', (c) => c.json(200, moveApplicant(deps, hr(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/recruitment/applicants/:id/interviews', (c) => c.json(201, scheduleInterview(deps, hr(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/recruitment/interviews/:id/result', (c) => c.json(200, recordInterview(deps, hr(c), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/recruitment/applicants/:id/hire', async (c) => c.json(201, await hireApplicant(deps, hr(c), c.params.id, c.body, c.ip)));
}
