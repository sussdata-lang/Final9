// الفصول الدراسية: السنة ثلاثة فصول بحسب دليل الطالب الرسمي (الأول، الثاني، الثالث).
// القيمة القديمة «الفصل الصيفي» (قبل التوحيد) تُقرأ على أنها «الفصل الثالث» فلا تنكسر البيانات المحفوظة.
export const SEMESTER_COUNT = 3;
export const SEMESTER_NAMES = Object.freeze({ 1: 'الفصل الأول', 2: 'الفصل الثاني', 3: 'الفصل الثالث' });
export const SEMESTER_LIST = Object.freeze([1, 2, 3].map((n) => SEMESTER_NAMES[n]));
export const LEGACY_SEMESTER_NAMES = Object.freeze({ 'الفصل الصيفي': 'الفصل الثالث' });
export const normSemesterName = (s) => LEGACY_SEMESTER_NAMES[s] ?? s;
export const isSemester = (n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= SEMESTER_COUNT;
