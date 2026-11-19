// سلّم التقديرات واختيار المحاولة المحتسبة عند إعادة المقرر — مرجع واحد لكل المواضع (كشف العلامات بنسختيه، المعدل المتوقع، شاشات العلامات).
// المصدر: دليل الطالب الرسمي للجامعة السورية للعلوم الأمنية:
//   شرف 95–100٪، امتياز 85 إلى أقل من 95٪، جيد جداً 75 إلى أقل من 85٪، جيد 65 إلى أقل من 75٪، مقبول من علامة النجاح إلى أقل من 65٪.
// الحدود نسبٌ مئوية من العلامة الكلية القصوى، وتُضبط من الإعدادات (تبويب «العلامات والنجاح»). هذا الملف نقي بلا قاعدة بيانات.

export const RATING_TIERS = [
  { key: 'honor', setting: 'grades.rating_honor', label: 'شرف', min: 95 },
  { key: 'excellent', setting: 'grades.rating_excellent', label: 'امتياز', min: 85 },
  { key: 'very_good', setting: 'grades.rating_very_good', label: 'جيد جداً', min: 75 },
  { key: 'good', setting: 'grades.rating_good', label: 'جيد', min: 65 },
];
export const PASS_LABEL = 'مقبول', FAIL_LABEL = 'راسب';

// السلّم الافتراضي (قيم الدليل)، بعلامة نجاح 60 من 100
export const DEFAULT_SCALE = Object.freeze({ totalMax: 100, passMark: 60, tiers: RATING_TIERS.map(({ label, min }) => ({ label, min })) });

// يبني السلّم من دالة قراءة إعدادات (k) => value؛ passMark علامة النجاح المطلقة للطالب/الجهة إن عُرفت
export function scaleFrom(get, passMark) {
  const totalMax = Number(get('grades.total_max')) || 100;
  return { totalMax, passMark: Number(passMark ?? get('grades.pass_mark')) || DEFAULT_SCALE.passMark,
    tiers: RATING_TIERS.map((t) => ({ label: t.label, min: Number(get(t.setting)) || t.min })) };
}

// يقبل سلّماً محفوظاً في وثيقة قديمة أو ناقصاً، ويعيد سلّماً صالحاً دائماً
export function normScale(s) {
  if (!s || !Array.isArray(s.tiers) || !s.tiers.length) return { ...DEFAULT_SCALE, passMark: Number(s?.passMark) || DEFAULT_SCALE.passMark, totalMax: Number(s?.totalMax) || DEFAULT_SCALE.totalMax };
  return { totalMax: Number(s.totalMax) || 100, passMark: Number(s.passMark) || DEFAULT_SCALE.passMark,
    tiers: s.tiers.map((t) => ({ label: String(t.label), min: Number(t.min) })).sort((a, b) => b.min - a.min) };
}

// تقدير علامة (أو معدل) مطلقة على السلّم؛ null حين لا علامة
export function rateMark(mark, scale = DEFAULT_SCALE) {
  if (mark === null || mark === undefined || mark === '' || !Number.isFinite(Number(mark))) return null;
  const s = scale === DEFAULT_SCALE ? scale : normScale(scale), m = Number(mark);
  if (m < s.passMark) return FAIL_LABEL;
  const pct = (m / s.totalMax) * 100;
  for (const t of s.tiers) if (pct >= t.min) return t.label;
  return PASS_LABEL;
}

// المحاولة المحتسبة عند إعادة المقرر: «تُحتسب العلامة الأعلى في حساب المعدل التراكمي».
// ترتيب المحاولات: الأعلى علامة أولاً، وعند التساوي الأحدث عاماً ثم الأحدث إدخالاً. المحاولة بلا علامة تأتي أخيراً.
export function attemptOrder(a, b) {
  const ma = a.mark ?? a.total, mb = b.mark ?? b.total;
  const na = ma === null || ma === undefined, nb = mb === null || mb === undefined;
  if (na !== nb) return na ? 1 : -1;
  if (!na && Number(mb) !== Number(ma)) return Number(mb) - Number(ma);
  const ya = String(a.academic_year ?? a.academicYear ?? ''), yb = String(b.academic_year ?? b.academicYear ?? '');
  if (ya !== yb) return yb.localeCompare(ya);
  return (Number(b.id) || 0) - (Number(a.id) || 0);
}
