// قواعد دليل الطالب الرسمي: سلّم التقديرات، العلامة الأعلى عند إعادة المقرر، والفصول الثلاثة (دوال نقية بلا قاعدة بيانات)
import test from 'node:test';
import assert from 'node:assert/strict';
import { rateMark, scaleFrom, normScale, attemptOrder, DEFAULT_SCALE } from '../server/services/grade_scale.js';
import { SEMESTER_NAMES, SEMESTER_LIST, normSemesterName, isSemester } from '../server/services/semesters.js';
import { buildView, ratingOf } from '../server/services/transcriptmodel.js';
import { calculateSimulatedGpa } from '../server/services/enterprise_suite.js';

test('سلّم التقديرات الافتراضي يطابق الدليل عند كل حد', () => {
  const cases = [[100, 'شرف'], [95, 'شرف'], [94.9, 'امتياز'], [85, 'امتياز'], [84.9, 'جيد جداً'], [75, 'جيد جداً'], [74.9, 'جيد'],
    [65, 'جيد'], [64.9, 'مقبول'], [60, 'مقبول'], [59.9, 'راسب'], [0, 'راسب']];
  for (const [m, label] of cases) assert.equal(rateMark(m), label, `العلامة ${m}`);
  assert.equal(rateMark(null), null); assert.equal(rateMark(undefined), null); assert.equal(rateMark(''), null);
  assert.equal(ratingOf(95), 'شرف'); assert.equal(ratingOf(null), null);
});

test('سلّم التقديرات من الإعدادات: الحدود نسب من العلامة القصوى، و«مقبول» من علامة النجاح', () => {
  const cfg = { 'grades.total_max': 200, 'grades.pass_mark': 100, 'grades.rating_honor': 90, 'grades.rating_excellent': 80, 'grades.rating_very_good': 70, 'grades.rating_good': 60 };
  const s = scaleFrom((k) => cfg[k]);
  assert.equal(rateMark(180, s), 'شرف');            // 90٪
  assert.equal(rateMark(179, s), 'امتياز');
  assert.equal(rateMark(120, s), 'جيد');            // 60٪
  assert.equal(rateMark(119, s), 'مقبول');
  assert.equal(rateMark(99, s), 'راسب');
  // علامة نجاح خاصة بالطالب (الكليات غير التطبيقية) تتقدم على العامة
  assert.equal(rateMark(55, scaleFrom((k) => ({ ...cfg, 'grades.total_max': 100 })[k], 50)), 'مقبول');
  // سلّم ناقص أو قديم (وثيقة صدرت قبل التعديل) يعود إلى قيم الدليل
  assert.deepEqual(normScale(undefined).tiers, DEFAULT_SCALE.tiers);
  assert.equal(rateMark(96, normScale({ passMark: 60 })), 'شرف');
});

test('إعادة المقرر: المحاولة المحتسبة هي الأعلى علامة، وعند التساوي الأحدث', () => {
  const tries = [{ id: 1, mark: 30, academic_year: '2023/2024' }, { id: 2, mark: 72, academic_year: '2024/2025' }, { id: 3, mark: 55, academic_year: '2025/2026' }];
  assert.deepEqual([...tries].sort(attemptOrder).map((t) => t.id), [2, 3, 1]);
  const tie = [{ id: 4, mark: 70, academic_year: '2024/2025' }, { id: 5, mark: 70, academic_year: '2025/2026' }];
  assert.equal([...tie].sort(attemptOrder)[0].id, 5);
  const sameYear = [{ id: 6, mark: 70, academicYear: '2025/2026' }, { id: 7, mark: 70, academicYear: '2025/2026' }];
  assert.equal([...sameYear].sort(attemptOrder)[0].id, 7);
  assert.equal([{ id: 8, mark: null }, { id: 9, mark: 10 }].sort(attemptOrder)[0].id, 9);
  assert.equal([{ id: 10, total: 40 }, { id: 11, total: 80 }].sort(attemptOrder)[0].id, 11);   // صيغة gview (total)
});

test('الفصول: السنة ثلاثة فصول، و«الفصل الصيفي» القديم يُقرأ «الفصل الثالث»', () => {
  assert.deepEqual(SEMESTER_LIST, ['الفصل الأول', 'الفصل الثاني', 'الفصل الثالث']);
  assert.equal(SEMESTER_NAMES[3], 'الفصل الثالث');
  assert.equal(normSemesterName('الفصل الصيفي'), 'الفصل الثالث');
  assert.equal(normSemesterName('الفصل الثاني'), 'الفصل الثاني');
  assert.ok(isSemester(3) && isSemester('3') && !isSemester(4) && !isSemester(0) && !isSemester('') && !isSemester(null));
});

test('نموذج كشف العلامات: تقدير كل صف بالسلّم المحفوظ، والفصل الثالث، والمحاولة السابقة لا تدخل المعدل', () => {
  const payload = {
    student: { name: 'طالب', level: 1, years: 4 },
    transcript: {
      ratingScale: { totalMax: 100, passMark: 60, tiers: [{ label: 'شرف', min: 95 }, { label: 'امتياز', min: 85 }, { label: 'جيد جداً', min: 75 }, { label: 'جيد', min: 65 }] },
      average: 80,
      grades: [
        { course: 'أ', hours: 3, mark: 96, level: 1, semester: 1, previous: false },
        { course: 'ب', hours: 3, mark: 64, level: 1, semester: 3, previous: false },
        { course: 'ج', hours: 3, mark: 80, level: 1, semester: 2, previous: false },
        { course: 'ج', hours: 3, mark: 50, level: 1, semester: 2, academicYear: '2025/2026', previous: true },
      ],
    },
  };
  const v = buildView(payload), y1 = v.years[0];
  assert.deepEqual(y1.terms.map((t) => t.label), ['الفصل الأول', 'الفصل الثاني', 'الفصل الثالث']);
  const rows = y1.terms.flatMap((t) => t.rows), by = (c, prev = false) => rows.find((r) => r.course === c && r.prev === prev);
  assert.equal(by('أ').rating, 'شرف'); assert.equal(by('ب').rating, 'مقبول'); assert.equal(by('ج').rating, 'جيد جداً');
  assert.equal(by('ج', true).rating, 'راسب');
  assert.equal(y1.terms[1].avg, 80, 'المحاولة السابقة (50) لا تدخل معدل الفصل');
  assert.equal(v.summary.rating, 'جيد جداً');
  // وثيقة قديمة بلا سلّم محفوظ: تُقدَّر بسلّم الدليل الافتراضي
  const old = buildView({ student: {}, transcript: { average: 95, grades: [{ course: 'د', hours: 2, mark: 86, level: 1, semester: 1 }] } });
  assert.equal(old.summary.rating, 'شرف');
  assert.equal(old.years[0].terms[0].rows[0].rating, 'امتياز');
});

test('المعدل المتوقع يستعمل سلّم الدليل', () => {
  assert.equal(calculateSimulatedGpa(85, 60, [{ credits: 10, expectedScore: 95 }]).letter, 'امتياز');   // 86.43
  assert.equal(calculateSimulatedGpa(96, 30, []).letter, 'شرف');
  assert.equal(calculateSimulatedGpa(62, 30, []).letter, 'مقبول');
  assert.equal(calculateSimulatedGpa(50, 30, []).letter, 'إنذار أكاديمي');
  const strict = { totalMax: 100, passMark: 70, tiers: DEFAULT_SCALE.tiers };
  assert.equal(calculateSimulatedGpa(65, 30, [], strict).letter, 'إنذار أكاديمي', 'علامة نجاح الطالب من السلّم الممرَّر');
});
