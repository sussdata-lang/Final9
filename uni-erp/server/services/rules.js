// محرك القواعد: يقرأ القواعد من جدول rules (قابلة للتعديل دون برمجة) ويعيد أول مخالفة.
// RULE_KINDS يصف كل نوع وحقوله؛ منه تُبنى شاشة الإدارة ويُتحقق من المعاملات.
const DAY = 86400000;
const passMarkOf = (db) => { try { return Number(db.prepare("SELECT value FROM site_settings WHERE key = 'grades.pass_mark'").get()?.value) || 60; } catch { return 60; } };

export const RULE_KINDS = [
  { kind: 'no_active_hold', label: 'لا توجد ذمة فعّالة', desc: 'يُرفض الطلب إذا كان على الطالب ذمة فعّالة من النوع المحدد.', fields: [{ name: 'hold_type', label: 'نوع الذمة', type: 'select', options: { financial: 'مالية', disciplinary: 'انضباطية', library: 'مكتبة' } }] },
  { kind: 'no_financial_dues', label: 'لا مستحقات مالية', desc: 'يُحسب الرصيد من المستحقات المفتوحة والإيصالات الفعلية، لا من الذمم اليدوية.', fields: [{ name: 'max_due', label: 'أقصى مبلغ مستحق مسموح', type: 'number', min: 0, max: 100000000000 }] },
  { kind: 'student_status', label: 'حالة القيد', desc: 'يُقبل الطلب فقط إذا كانت حالة قيد الطالب من الحالات المحددة.', fields: [{ name: 'allowed', label: 'الحالات المسموحة', type: 'multi', options: { active: 'مقيَّد', suspended: 'موقوف', withdrawn: 'منسحب', graduated: 'خريج' } }] },
  { kind: 'attachment_required', label: 'مرفق إلزامي', desc: 'يُرفض الطلب إذا لم يُرفق معه ملف.', fields: [] },
  { kind: 'max_open_per_service', label: 'حد الطلبات المفتوحة', desc: 'أقصى عدد من الطلبات قيد المراجعة للخدمة نفسها.', fields: [{ name: 'max', label: 'الحد الأقصى', type: 'int', min: 1, max: 20 }] },
  { kind: 'max_per_year', label: 'حد الطلبات في السنة', desc: 'أقصى عدد من الطلبات غير المرفوضة للخدمة نفسها خلال 365 يوماً.', fields: [{ name: 'max', label: 'الحد الأقصى', type: 'int', min: 1, max: 100 }] },
  { kind: 'request_cooldown', label: 'فترة انتظار بين الطلبات', desc: 'لا يُقبل طلب جديد للخدمة نفسها قبل مرور هذه المدة على آخر طلب.', fields: [{ name: 'days', label: 'عدد الأيام', type: 'int', min: 1, max: 365 }] },
  { kind: 'min_average', label: 'حد أدنى للمعدل', desc: 'المعدل الموزون بالساعات من العلامات المعتمدة فقط.', fields: [{ name: 'min', label: 'أدنى معدل', type: 'number', min: 0, max: 100 }] },
  { kind: 'min_passed_hours', label: 'حد أدنى للساعات المنجزة', desc: 'مجموع ساعات المقررات الناجحة بعلامة معتمدة.', fields: [{ name: 'min', label: 'أدنى عدد ساعات', type: 'int', min: 1, max: 500 }] },
  { kind: 'min_study_level', label: 'حد أدنى للسنة الدراسية', desc: 'السنة الدراسية في ملف الطالب.', fields: [{ name: 'min', label: 'أدنى سنة', type: 'int', min: 1, max: 12 }] },
];
const BY_KIND = new Map(RULE_KINDS.map((k) => [k.kind, k]));

// يعيد المعاملات منظَّفة أو نص الخطأ؛ rules.js يقرأها عند كل طلب بلا تحقق، فلا تُخزَّن معاملات فاسدة
export function cleanRuleParams(kind, input) {
  const def = BY_KIND.get(kind);
  if (!def) return { error: 'نوع قاعدة غير معروف.' };
  const out = {};
  for (const f of def.fields) {
    const v = input?.[f.name];
    if (f.type === 'select') { if (!f.options[v]) return { error: `«${f.label}» غير صالح.` }; out[f.name] = v; }
    else if (f.type === 'multi') {
      const list = Array.isArray(v) ? [...new Set(v.map(String))] : [];
      if (!list.length || list.some((x) => !f.options[x])) return { error: `«${f.label}» غير صالحة.` };
      out[f.name] = list;
    } else {
      const n = Number(v);
      if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < f.min || n > f.max || (f.type === 'int' && !Number.isInteger(n))) return { error: `«${f.label}» يجب أن يكون ${f.type === 'int' ? 'عدداً صحيحاً' : 'رقماً'} بين ${f.min} و${f.max}.` };
      out[f.name] = n;
    }
  }
  return { params: out };
}

const CHECKS = {
  no_active_hold: ({ db, studentId }, p) => !db.prepare('SELECT 1 FROM student_holds WHERE student_id = ? AND hold_type = ? AND active = 1').get(studentId, p.hold_type),
  // حالة القيد من ملف الطالب؛ الحسابات القديمة بلا ملف لا تُقيَّد
  student_status: ({ db, studentId }, p) => { const pr = db.prepare('SELECT status FROM student_profiles WHERE user_id = ?').get(studentId); return !pr || (p.allowed ?? ['active']).includes(pr.status); },
  attachment_required: ({ hasAttachment }) => !!hasAttachment,
  max_open_per_service: ({ db, studentId, serviceCode }, p) => Number(db.prepare("SELECT COUNT(*) c FROM requests WHERE student_id = ? AND service_code = ? AND status = 'review'").get(studentId, serviceCode).c) < p.max,
  max_per_year: ({ db, studentId, serviceCode }, p) => Number(db.prepare("SELECT COUNT(*) c FROM requests WHERE student_id = ? AND service_code = ? AND status <> 'rejected' AND created_at > ?").get(studentId, serviceCode, Date.now() - 365 * DAY).c) < p.max,
  request_cooldown: ({ db, studentId, serviceCode }, p) => { const last = db.prepare("SELECT MAX(created_at) AS t FROM requests WHERE student_id = ? AND service_code = ? AND status <> 'rejected'").get(studentId, serviceCode)?.t; return !last || Date.now() - Number(last) >= p.days * DAY; },
  no_financial_dues: ({ db, studentId }, p) => {
    const charged = Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM fin_charges WHERE student_id = ? AND status = 'open'").get(studentId).v);
    const paid = Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM fin_payments WHERE student_id = ? AND status <> 'void'").get(studentId).v);
    return charged - paid <= Math.round(Number(p.max_due ?? 0) * 100);
  },
  min_average: ({ db, studentId }, p) => { const r = db.prepare("SELECT SUM(mark * hours) AS pts, SUM(hours) AS hrs FROM grades WHERE student_id = ? AND workflow_status = 'approved'").get(studentId); return Number(r?.hrs) > 0 && Number(r.pts) / Number(r.hrs) >= p.min; },
  min_passed_hours: ({ db, studentId }, p) => Number(db.prepare("SELECT COALESCE(SUM(hours), 0) AS v FROM grades WHERE student_id = ? AND workflow_status = 'approved' AND mark >= ?").get(studentId, passMarkOf(db)).v) >= p.min,
  min_study_level: ({ db, studentId }, p) => { const pr = db.prepare('SELECT study_level FROM student_profiles WHERE user_id = ?').get(studentId); return !pr || Number(pr.study_level) >= p.min; },
};

export function runRules(db, { studentId, serviceCode, hasAttachment }) {
  const rules = db.prepare('SELECT * FROM rules WHERE enabled = 1 AND (service_code IS NULL OR service_code = ?) ORDER BY id').all(serviceCode);
  const passed = [];
  for (const r of rules) {
    const check = CHECKS[r.kind];
    if (check && !check({ db, studentId, serviceCode, hasAttachment }, JSON.parse(r.params_json))) return { ok: false, failed: r, message: r.message, passed };
    passed.push(r);
  }
  return { ok: true, passed };
}
