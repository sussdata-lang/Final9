// الموافقة على معالجة البيانات الشخصية لأغراض محددة غير الأساسية (نشر الصور، المشاركة الخارجية، ...).
// كل مستخدم يدير موافقاته هو، وتُستثنى الأغراض الأساسية اللازمة لتقديم الخدمة نفسها فلا تُسحَب.
// كل تغيير حدث مستقل في consent_records، فيبقى تاريخ المنح والسحب كاملاً لأغراض التدقيق.
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);

export const CONSENT_PURPOSES = [
  { code: 'academic_processing', label: 'معالجة بياناتي الأكاديمية والإدارية لتقديم خدمات الجامعة', hint: 'أساس تعاقدي لازم لتسجيلك وخدماتك، فلا يُسحَب أثناء القيد.', required: true },
  { code: 'photo_publicity', label: 'نشر صوري في فعاليات الجامعة وموقعها الرسمي ووسائل التواصل', required: false },
  { code: 'external_sharing', label: 'مشاركة بياناتي مع جهات خارجية عند الحاجة (معادلة شهادات، تدريب، منح دراسية)', required: false },
  { code: 'marketing_comms', label: 'تلقي رسائل عن فعاليات الجامعة وبرامجها غير الإلزامية', required: false },
  { code: 'health_data', label: 'معالجة بياناتي الصحية لأغراض الدعم والتسهيلات (ذوو الاحتياجات أو الحالات الطبية)', required: false },
];
const BY_CODE = Object.fromEntries(CONSENT_PURPOSES.map((p) => [p.code, p]));

// آخر صف لكل غرض (المستخدم، الغرض) = الحالة الحالية
function latestOf(db, subjectId) {
  const rows = db.prepare(`SELECT c.purpose_code, c.granted, c.recorded_at, c.note, u.display_name AS recordedByName FROM consent_records c
    JOIN (SELECT purpose_code, MAX(id) AS mid FROM consent_records WHERE subject_id = ? GROUP BY purpose_code) m ON m.mid = c.id
    LEFT JOIN users u ON u.id = c.recorded_by`).all(subjectId);
  return Object.fromEntries(rows.map((r) => [r.purpose_code, r]));
}

export function myConsentStatus(db, subjectId) {
  const latest = latestOf(db, subjectId);
  return CONSENT_PURPOSES.map((p) => ({
    code: p.code, label: p.label, hint: p.hint || null, required: !!p.required,
    granted: p.required ? true : !!latest[p.code]?.granted,
    recordedAt: latest[p.code] ? Number(latest[p.code].recorded_at) : null,
  }));
}

export function setConsent({ db }, actor, body, ip, subjectId = null) {
  if (!actor) throw new HttpError(401, 'يلزم تسجيل الدخول.', 'unauthenticated');
  const onBehalf = subjectId !== null && Number(subjectId) !== Number(actor.id);
  const target = onBehalf ? Number(subjectId) : actor.id;
  if (onBehalf && !(actor.role === 'admin' || actor.can?.('student:update'))) {
    throw new HttpError(403, 'تسجيل موافقة نيابة عن مستخدم آخر يتطلب صلاحية تعديل ملفات الطلاب.', 'forbidden');
  }
  const purpose = BY_CODE[String(body?.code ?? '')];
  if (!purpose) throw bad('غرض الموافقة غير معروف.');
  if (purpose.required) throw bad('هذا الغرض أساس تعاقدي لتقديم الخدمة ولا يُسحَب.', 409, 'conflict');
  if (!db.prepare('SELECT 1 AS x FROM users WHERE id = ?').get(target)) throw new HttpError(404, 'المستخدم غير موجود.', 'not_found');
  const granted = !!body?.granted;
  const note = String(body?.note ?? '').trim().slice(0, 300);
  if (onBehalf && !note) throw bad('سجّل سبب تدوين الموافقة نيابة عن المستخدم.');
  db.prepare('INSERT INTO consent_records (subject_id, purpose_code, granted, note, recorded_by, recorded_at) VALUES (?,?,?,?,?,?)')
    .run(target, purpose.code, granted ? 1 : 0, note, actor.id, Date.now());
  audit(db, actor, `${granted ? 'منح' : 'سحب'} موافقة: ${purpose.label}`.slice(0, 300), onBehalf ? `نيابة عن مستخدم #${target}` : '', ip);
  return myConsentStatus(db, target).find((p) => p.code === purpose.code);
}

// نظرة إدارية: عدد الممنوح والمسحوب لكل غرض غير أساسي، على كل المستخدمين الحاليين
export function consentOverview({ db }) {
  const subjects = db.prepare("SELECT id FROM users WHERE active = 1").all().map((u) => Number(u.id));
  const purposes = CONSENT_PURPOSES.filter((p) => !p.required);
  const rows = db.prepare(`SELECT c.subject_id, c.purpose_code, c.granted FROM consent_records c
    JOIN (SELECT subject_id, purpose_code, MAX(id) AS mid FROM consent_records GROUP BY subject_id, purpose_code) m ON m.mid = c.id`).all();
  const bySubject = new Map();
  for (const r of rows) { const k = Number(r.subject_id); if (!bySubject.has(k)) bySubject.set(k, {}); bySubject.get(k)[r.purpose_code] = !!r.granted; }
  return {
    totalUsers: subjects.length,
    purposes: purposes.map((p) => {
      let granted = 0, withdrawn = 0;
      for (const sid of subjects) { const v = bySubject.get(sid)?.[p.code]; if (v === true) granted++; else if (v === false) withdrawn++; }
      return { code: p.code, label: p.label, granted, withdrawn, notRecorded: subjects.length - granted - withdrawn };
    }),
  };
}

// آخر من سحب أو منح موافقة لغرض معيّن، لمن يحتاج متابعة بشرية (مثل من سحب مشاركة بياناته خارجياً)
export function consentLog({ db }, q = {}) {
  const purpose = BY_CODE[String(q.purpose ?? '')];
  if (!purpose) throw bad('غرض الموافقة غير معروف.');
  const limit = Math.min(300, Math.max(1, Number(q.limit) || 100));
  return db.prepare(`SELECT c.id, c.subject_id AS subjectId, u.display_name AS subjectName, u.student_no AS studentNo, c.granted, c.note, c.recorded_at AS recordedAt, r.display_name AS recordedByName
    FROM consent_records c JOIN users u ON u.id = c.subject_id LEFT JOIN users r ON r.id = c.recorded_by
    WHERE c.purpose_code = ? ORDER BY c.id DESC LIMIT ${limit}`).all(purpose.code)
    .map((e) => ({ ...e, granted: !!e.granted, recordedAt: Number(e.recordedAt) }));
}

export function registerConsentRoutes(r, deps) {
  const { db } = deps;
  const canOverview = (c) => c.user && (c.user.role === 'admin' || c.user.can?.('audit:read'));
  r.add('GET', '/api/consent/me', (c) => c.json(200, { purposes: myConsentStatus(db, c.user.id) }));
  r.add('POST', '/api/consent/me', (c) => c.json(200, setConsent(deps, c.user, c.body, c.ip)));
  r.add('GET', '/api/consent/users/:id', (c) => {
    if (!(c.user.role === 'admin' || c.user.can?.('student:update') || canOverview(c))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { purposes: myConsentStatus(db, c.params.id) });
  });
  r.add('POST', '/api/consent/users/:id', (c) => c.json(200, setConsent(deps, c.user, c.body, c.ip, c.params.id)));
  r.add('GET', '/api/privacy/consent-overview', (c) => {
    if (!canOverview(c)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, consentOverview(deps));
  });
  r.add('GET', '/api/privacy/consent-log', (c) => {
    if (!canOverview(c)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { entries: consentLog(deps, c.query ?? {}) });
  });
}
