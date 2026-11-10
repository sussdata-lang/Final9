// الإعدادات العامة: كل قيمة كانت ثابتة في الكود صارت هنا قابلة للتعديل من لوحة الإدارة.
// المخطط (SCHEMA) هو المرجع الوحيد: يرسم الواجهة ويتحقق من القيم ويحدد الافتراضي. تُخزَّن في site_settings
// بمفتاح `cfg.<key>` (JSON)، أو بالمفتاح القديم (legacy) حين كانت القيمة محفوظة سابقاً بنص عادي.
import { bad } from '../validate.js';
import { universityDepartments } from './hr_integrated.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

const opt = (...p) => p.map(([value, label]) => ({ value, label }));

export const SCHEMA = [
  { key: 'institution', label: 'الهوية والمؤسسة', desc: 'الأسماء التي تظهر في البوابة والوثائق الموقّعة.', items: [
    { key: 'institution.university', legacy: 'university_name', label: 'اسم الجامعة', type: 'text', default: 'الجامعة السورية للعلوم الأمنية', min: 2, max: 120, arabic: true },
    { key: 'institution.portal', legacy: 'portal_title', label: 'اسم البوابة', type: 'text', default: 'بوابة خدمات الطلاب', min: 2, max: 60 },
    { key: 'institution.department', legacy: 'department_name', label: 'اسم القسم', type: 'text', default: 'قسم شؤون الطلاب', min: 2, max: 80 },
    { key: 'institution.ministry', label: 'الجهة الأعلى (ترويسة الوثائق)', type: 'text', default: 'وزارة الداخلية', min: 0, max: 80, hint: 'تظهر في ترويسة الوثائق والمراسلات المعتمدة؛ اتركها فارغة لإخفائها.' },
    { key: 'institution.country', label: 'اسم الدولة (ترويسة كشف العلامات)', type: 'text', default: 'الجمهورية العربية السورية', min: 0, max: 80 },
    { key: 'institution.country_en', label: 'اسم الدولة بالإنكليزية (ترويسة المطبوعات)', type: 'text', default: 'SYRIAN ARAB REPUBLIC', min: 0, max: 80, hint: 'يظهر في الجهة اليسرى من ترويسة السندات والنماذج المطبوعة.' },
    { key: 'institution.ministry_en', label: 'الجهة الأعلى بالإنكليزية', type: 'text', default: 'MINISTRY OF INTERIOR', min: 0, max: 80 },
    { key: 'institution.university_en', label: 'اسم الجامعة بالإنكليزية', type: 'text', default: 'Syrian University for Security Sciences', min: 0, max: 120 },
  ] },
  { key: 'grades', label: 'العلامات والنجاح', desc: 'سلّم العلامات وحدود الإدخال وعتبة النجاح.', items: [
    { key: 'grades.total_max', label: 'العلامة الكلية القصوى للمقرر', type: 'int', default: 100, min: 10, max: 1000, unit: 'علامة' },
    { key: 'grades.practical_max', label: 'الحد الأعلى للعلامة العملية', type: 'int', default: 30, min: 0, max: 1000, unit: 'علامة', hint: '0 = لا علامة عملية. تُرفض أي علامة عملية أعلى من هذا الحد.' },
    { key: 'grades.pass_mark', label: 'علامة النجاح (الكليات التطبيقية)', type: 'int', default: 60, min: 1, max: 1000, unit: 'علامة', hint: 'تُعتمد في العلامات والكشوف والإحصاءات والإنذار الأكاديمي والوثائق.' },
    { key: 'grades.pass_mark_other', label: 'علامة النجاح (الكليات غير التطبيقية)', type: 'int', default: 60, min: 1, max: 1000, unit: 'علامة', hint: 'تسري على الجهات المدرجة في القائمة التالية.' },
    { key: 'grades.non_applied_faculties', label: 'رموز الجهات غير التطبيقية', type: 'list', default: ['CSS', 'HISS', 'TISS', 'CSSR'], max: 100, itemMax: 20, hint: 'رمز كل جهة في سطر. الجهة غير المدرجة هنا تُعامل كتطبيقية.' },
  ] },
  { key: 'academic', label: 'الأكاديمي', desc: 'حدود المقررات وتسميات السنوات الدراسية.', items: [
    { key: 'academic.cap_hours_default', label: 'الحد الفصلي للساعات (المعدل المتوسط أو الطالب الجديد)', type: 'int', default: 18, min: 1, max: 40, unit: 'ساعة' },
    { key: 'academic.cap_gpa_low', label: 'المعدل الذي يُخفَّض دونه الحد الفصلي', type: 'int', default: 60, min: 0, max: 100, unit: '%' },
    { key: 'academic.cap_hours_low', label: 'الحد الفصلي لمن معدله دون ذلك', type: 'int', default: 12, min: 1, max: 40, unit: 'ساعة' },
    { key: 'academic.cap_gpa_high', label: 'المعدل الذي يُرفع عنده الحد الفصلي', type: 'int', default: 75, min: 0, max: 100, unit: '%' },
    { key: 'academic.cap_hours_high', label: 'الحد الفصلي لمن بلغ ذلك المعدل', type: 'int', default: 21, min: 1, max: 40, unit: 'ساعة' },
    { key: 'academic.max_absence_percent', label: 'الحد الأقصى للغياب قبل الحرمان من المقرر', type: 'int', default: 15, min: 1, max: 100, unit: '%' },
    { key: 'academic.min_sessions_for_absence', label: 'أقل عدد محاضرات منعقدة قبل احتساب الغياب', type: 'int', default: 3, min: 1, max: 60, unit: 'محاضرة' },
    { key: 'academic.registration_open', label: 'بداية التسجيل في المقررات', type: 'text', default: '', min: 0, max: 10, hint: 'بصيغة 2026-09-01. فارغ يعني بلا قيد.' },
    { key: 'academic.add_drop_close', label: 'نهاية فترة الحذف والإضافة', type: 'text', default: '', min: 0, max: 10, hint: 'بصيغة 2026-09-20. فارغ يعني بلا قيد.' },
    { key: 'academic.registration_requires_clearance', label: 'منع التسجيل عند وجود مستحقات حان موعدها', type: 'bool', default: true },
    { key: 'academic.registration_max_due', label: 'أقصى مبلغ مستحق يُسمح معه بالتسجيل', type: 'int', default: 0, min: 0, max: 1000000000, unit: 'ل.س' },
    { key: 'academic.auto_invoice_on_admission', label: 'إصدار فاتورة تلقائياً عند تثبيت القبول', type: 'bool', default: true },
    { key: 'academic.admission_invoice_days', label: 'مهلة سداد فاتورة القبول', type: 'int', default: 30, min: 0, max: 365, unit: 'يوم' },
    { key: 'academic.current_semester', label: 'الفصل الدراسي الحالي (يُغيَّر عند بدء كل فصل)', type: 'select', default: 'الفصل الأول', options: opt(['الفصل الأول', 'الفصل الأول'], ['الفصل الثاني', 'الفصل الثاني'], ['الفصل الصيفي', 'الفصل الصيفي']) },
    { key: 'academic.max_course_hours', label: 'أقصى ساعات للمقرر الواحد', type: 'int', default: 12, min: 1, max: 40, unit: 'ساعة' },
    { key: 'academic.default_course_hours', label: 'الساعات الافتراضية عند إضافة مقرر', type: 'int', default: 3, min: 0, max: 40, unit: 'ساعة' },
    { key: 'academic.levels', label: 'تسميات السنوات الدراسية (بالترتيب)', type: 'list', default: ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'], max: 12, itemMax: 30, hint: 'سطر لكل سنة؛ تظهر بصيغة «السنة …».' },
  ] },
  { key: 'student_portal', label: 'بوابة الطالب (الشاشات الظاهرة)', desc: 'تحكّم في الشاشات التي تظهر في حساب كل طالب. إيقاف شاشة يخفيها من قائمة الطالب بالكامل (تظهر التغييرات خلال دقيقة). اللوحة الرئيسية ثابتة دائماً.', items: [
    { key: 'student_portal.view_guide', label: 'دليل المواد والخطة الدراسية', type: 'bool', default: true },
    { key: 'student_portal.view_grades', label: 'علاماتي والسجل الأكاديمي', type: 'bool', default: true },
    { key: 'student_portal.view_lms', label: 'التعلم الإلكتروني والمكتبة', type: 'bool', default: true },
    { key: 'student_portal.view_fees', label: 'كشف الرسوم', type: 'bool', default: true },
    { key: 'student_portal.view_expansions', label: 'الامتحانات والتظلمات', type: 'bool', default: true },
    { key: 'student_portal.view_student_life', label: 'السكن والساعات المكتبية', type: 'bool', default: true },
    { key: 'student_portal.view_alumni', label: 'الخريجون والتوظيف', type: 'bool', default: true },
    { key: 'student_portal.view_ai', label: 'المرشد الذكي (AI)', type: 'bool', default: true },
    { key: 'student_portal.view_news', label: 'الأخبار والإعلانات', type: 'bool', default: true },
    { key: 'student_portal.view_tx', label: 'معاملاتي وبراءة الذمة', type: 'bool', default: true },
    { key: 'student_portal.perm_request_create', label: 'صلاحية: تقديم الطلبات والمعاملات', type: 'bool', default: true },
    { key: 'student_portal.perm_request_read_own', label: 'صلاحية: عرض طلباته ومتابعتها', type: 'bool', default: true },
    { key: 'student_portal.perm_document_read_own', label: 'صلاحية: عرض وثائقه الصادرة', type: 'bool', default: true },
    { key: 'student_portal.perm_profile_read_own', label: 'صلاحية: عرض ملفه الشخصي', type: 'bool', default: true },
    { key: 'student_portal.perm_profile_update_own', label: 'صلاحية: تعديل بياناته الشخصية المسموحة', type: 'bool', default: true },
    { key: 'student_portal.perm_course_read_own', label: 'صلاحية: عرض دليل مواده', type: 'bool', default: true },
    { key: 'student_portal.perm_grade_read_own', label: 'صلاحية: عرض علاماته المعتمدة', type: 'bool', default: true },
    { key: 'student_portal.perm_complaint_create', label: 'صلاحية: إرسال الشكاوى', type: 'bool', default: true },
  ] },
  { key: 'regulations', label: 'أنظمة الدراسة والتخرج', desc: 'القيم الافتراضية مأخوذة من المنشور عن لوائح الجامعات السورية؛ راجعها مع النص الرسمي واللائحة الداخلية لجامعتك.', items: [
    { key: 'reg.promotion_max_carried', label: 'أقصى عدد مقررات محمولة للترفيع', type: 'int', default: 4, min: 0, max: 30, unit: 'مقرر', hint: 'يرفَّع الطالب إلى السنة التالية إذا لم تتجاوز مقرراته غير المنجزة هذا العدد. وعند صدور مرسوم ترفع إداري يُعدَّل هذا الحد لذلك العام.' },
    { key: 'reg.max_stay_extra_percent', label: 'الزيادة المسموحة على مدة البرنامج', type: 'int', default: 50, min: 0, max: 300, unit: '%', hint: 'الحد الأقصى لسنوات الدراسة = مدة البرنامج + هذه النسبة. مثال: 4 سنوات + 50% = 6 سنوات.' },
    { key: 'reg.count_postponement', label: 'احتساب سنوات التأجيل من مدة الدراسة', type: 'bool', default: false },
    { key: 'reg.exhaustion_warn_years', label: 'تنبيه الطالب قبل الاستنفاد بـ', type: 'int', default: 1, min: 0, max: 10, unit: 'سنة' },
    { key: 'reg.renewal_open', label: 'بداية تجديد القيد السنوي', type: 'text', default: '', min: 0, max: 10, hint: 'بصيغة 2026-09-01. فارغ يعني بلا قيد.' },
    { key: 'reg.renewal_close', label: 'نهاية تجديد القيد السنوي', type: 'text', default: '', min: 0, max: 10, hint: 'بصيغة 2026-10-15. فارغ يعني بلا قيد.' },
    { key: 'reg.renewal_late_days', label: 'أيام التجديد المتأخر بعد المهلة', type: 'int', default: 0, min: 0, max: 365, unit: 'يوم' },
    { key: 'reg.renewal_block_dues', label: 'منع التجديد عند وجود مستحقات مالية', type: 'bool', default: true },
    { key: 'reg.renewal_block_holds', label: 'منع التجديد عند وجود عقوبة أو ذمة قائمة', type: 'bool', default: true },
    { key: 'reg.appeal_days', label: 'مهلة التظلم من القرار الانضباطي', type: 'int', default: 30, min: 1, max: 365, unit: 'يوم' },
    { key: 'reg.appeal_warning', label: 'الإنذار يقبل التظلم', type: 'bool', default: false },
    { key: 'reg.appeal_exam_zero', label: 'إلغاء علامة مقرر يقبل التظلم', type: 'bool', default: true },
    { key: 'reg.appeal_term_suspension', label: 'حرمان الفصل يقبل التظلم', type: 'bool', default: true },
    { key: 'reg.appeal_dismissal', label: 'الفصل النهائي يقبل التظلم', type: 'bool', default: true },
    { key: 'reg.appeal_suspends', label: 'التظلم يوقف تنفيذ القرار حتى البت فيه', type: 'bool', default: false },
  ] },
  { key: 'students', label: 'الطلاب والقبول', desc: 'قوائم الاختيار في نموذج تسجيل الطالب وحدود الاستيراد.', items: [
    { key: 'students.governorates', label: 'المحافظات', type: 'list', default: ['دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'الرقة', 'الحسكة', 'خارج سوريا'], max: 60, itemMax: 40 },
    { key: 'students.hs_types', label: 'أنواع الشهادة الثانوية', type: 'list', default: ['الثانوية العامة - الفرع العلمي', 'الثانوية العامة - الفرع الأدبي', 'الثانوية المهنية - صناعي', 'الثانوية المهنية - تجاري', 'الثانوية المهنية - نسوي', 'الثانوية المهنية - زراعي', 'معهد متوسط', 'شهادة ثانوية أجنبية / معادلة', 'أخرى'], max: 40, itemMax: 80 },
    { key: 'students.admissions', label: 'أنواع القبول', type: 'list', default: ['القبول العام (المفاضلة)', 'التعليم الموازي', 'التعليم المفتوح / الافتراضي', 'أبناء أعضاء الهيئة التدريسية', 'الطلاب الوافدون', 'نقل من جامعة أخرى', 'أخرى'], max: 40, itemMax: 80 },
    { key: 'students.relations', label: 'صلات القرابة (ولي الأمر)', type: 'list', default: ['الأب', 'الأم', 'الأخ', 'الأخت', 'الزوج/الزوجة', 'قريب آخر', 'وصي'], max: 30, itemMax: 30 },
    { key: 'students.import_max_rows', label: 'أقصى عدد طلاب في ملف الاستيراد', type: 'int', default: 1500, min: 10, max: 20000, unit: 'طالب' },
    { key: 'students.max_postponement_years', label: 'الحد الأقصى لمجموع تأجيلات الطالب', type: 'int', default: 2, min: 0, max: 12, unit: 'سنة', hint: 'مجموع مدد التأجيل وتجميد الدراسة خلال مدة الدراسة؛ كل سنة تعادل فصلين.' },
    { key: 'students.admission_default_min_score', label: 'الحد الأدنى للقبول', type: 'int', default: 0, min: 0, max: 1000, unit: 'درجة', hint: '0 يعني لا يوجد حد أدنى، وهو المعتمد في الجامعة.' },
    { key: 'students.admission_default_capacity', label: 'المقاعد الافتراضية لكل برنامج في السنة', type: 'int', default: 35, min: 0, max: 100000, unit: 'مقعد', hint: 'للبرامج التي لم يُحدَّد لها عدد في خطة القبول.' },
  ] },
  { key: 'import', label: 'الاستيراد', desc: 'مهلة التراجع عن دفعات الاستيراد.', items: [
    { key: 'import.undo_days', label: 'مهلة التراجع عن دفعة استيراد', type: 'int', default: 7, min: 1, max: 90, unit: 'يوم' },
  ] },
  { key: 'audit', label: 'سجل التدقيق', desc: 'مدة الاحتفاظ بسجل التدقيق. ما تجاوزها يُحذف تلقائياً مرة كل يوم.', items: [
    { key: 'audit.retention_years', label: 'مدة الاحتفاظ بسجل التدقيق', type: 'int', default: 3, min: 1, max: 50, unit: 'سنة' },
  ] },
  { key: 'housing', label: 'السكن الجامعي', desc: 'قوائم السكن المستخدمة في تسليم المواد للطلاب.', items: [
    { key: 'housing.supply_items', label: 'المواد والمعدات المسلمة للطلاب', type: 'list', default: ['سرير', 'فرشة', 'وسادة', 'شرشف', 'بطانية', 'خزانة ملابس', 'مكتب وكرسي', 'مفتاح الغرفة', 'بطاقة السكن', 'طقم لباس رسمي', 'لباس رياضي', 'حذاء', 'كمبيوتر محمول', 'شاحن', 'مواد نظافة شخصية', 'مناشف', 'أدوات مائدة', 'حقيبة'], max: 200 },
    { key: 'housing.room_types', label: 'أنواع الغرف', type: 'list', default: ['فردية', 'مزدوجة', 'ثلاثية', 'رباعية', 'جماعية'], max: 30 },
  ] },
  { key: 'requests', label: 'الطلبات والمرفقات', desc: 'حدود المرفقات والاستيراد ومدة الإنجاز الافتراضية.', items: [
    { key: 'requests.escalation_enabled', label: 'تصعيد الطلبات المتأخرة تلقائياً', type: 'bool', default: true },
    { key: 'requests.escalation_repeat_hours', label: 'المدة بين مستويات التصعيد', type: 'int', default: 24, min: 1, max: 720, unit: 'ساعة' },
    { key: 'requests.escalation_max_levels', label: 'عدد مستويات التصعيد', type: 'int', default: 2, min: 1, max: 5, unit: 'مستوى' },
    { key: 'requests.max_attachment_mb', label: 'أقصى حجم للمرفق الواحد', type: 'int', default: 2, min: 1, max: 10, unit: 'ميغابايت' },
    { key: 'requests.max_total_mb', label: 'أقصى مجموع مرفقات الطلب', type: 'int', default: 8, min: 1, max: 10, unit: 'ميغابايت', hint: 'لا يتجاوز 10 ميغابايت (حد الطلب الواحد على الخادم).' },
    { key: 'requests.import_max_rows', label: 'أقصى صفوف في استيراد الطلبات من Excel', type: 'int', default: 500, min: 10, max: 5000, unit: 'صف' },
    { key: 'requests.default_sla_hours', label: 'مدة الإنجاز الافتراضية لخدمة جديدة', type: 'int', default: 48, min: 1, max: 720, unit: 'ساعة' },
  ] },
  { key: 'security', label: 'الأمان والجلسات', desc: 'سياسة كلمات المرور والقفل ومدة الجلسة.', items: [
    { key: 'security.password_min', label: 'أقل طول لكلمة المرور', type: 'int', default: 10, min: 6, max: 64, unit: 'حرفاً' },
    { key: 'security.max_failed_logins', label: 'محاولات الدخول الفاشلة قبل القفل', type: 'int', default: 5, min: 3, max: 20 },
    { key: 'security.lock_minutes', label: 'مدة قفل الحساب', type: 'int', default: 15, min: 1, max: 1440, unit: 'دقيقة' },
    { key: 'security.mfa_required', label: 'إلزام الأدوار الحساسة بالتحقق بخطوتين', type: 'bool', default: true, hint: 'المدير والمدقق ورؤساء المالية والموارد البشرية وتقنية المعلومات والامتحانات. يسري في الإنتاج.' },
    { key: 'security.session_hours', label: 'مدة الجلسة', type: 'int', default: 8, min: 1, max: 168, unit: 'ساعة', hint: 'تسري على الجلسات الجديدة بعد الحفظ.' },
  ] },
  { key: 'hr', label: 'الحضور والإجازات', desc: 'استحقاق الإجازة والعطلة الأسبوعية.', items: [
    { key: 'hr.leave_default_days', legacy: 'leave_default_days', label: 'الاستحقاق السنوي الافتراضي للإجازة الاعتيادية', type: 'int', default: 30, min: 0, max: 366, unit: 'يوماً', hint: 'يمكن تخصيص رصيد لموظف بعينه من «الحضور والإجازات ← أرصدة الإجازات».' },
    { key: 'hr.weekend', legacy: 'weekend_days', label: 'العطلة الأسبوعية', type: 'select', default: 'fri,sat', options: opt(['fri,sat', 'الجمعة والسبت'], ['fri', 'الجمعة فقط'], ['sat,sun', 'السبت والأحد']), hint: 'تؤثر في حساب أيام الإجازات المعتمدة بعد الحفظ.' },
    { key: 'hr.auto_account', label: 'إنشاء حساب في المنظومة لكل موظف جديد', type: 'bool', default: true, hint: 'يُنشأ بصلاحيات دنيا: الحضور الشخصي والطلبات الداخلية والمراسلات، ثم يُمنح دوره من الحسابات والصلاحيات.' },
    { key: 'hr.currency', label: 'رمز العملة المعروض مع الرواتب', type: 'text', default: 'ل.س', min: 1, max: 10 },
    { key: 'hr.annual_leave_type', label: 'اسم نوع الإجازة المخصوم من الرصيد', type: 'text', default: 'اعتيادية', min: 2, max: 30, hint: 'يجب أن يطابق الخيار في نموذج «طلب إجازة».' },
  ] },
  { key: 'corr', label: 'المراسلات', desc: 'حدود المستندات الداخلية وترقيمها.', items: [
    { key: 'corr.max_approvers', label: 'أقصى عدد معتمدين للمستند', type: 'int', default: 12, min: 1, max: 30 },
    { key: 'corr.max_files', label: 'أقصى عدد مرفقات للمستند', type: 'int', default: 5, min: 0, max: 20 },
    { key: 'corr.no_prefix', label: 'بادئة رقم المستند', type: 'text', default: 'COR', min: 2, max: 8, ascii: true, hint: 'أحرف لاتينية كبيرة؛ تنطبق على المستندات الجديدة.' },
  ] },
  { key: 'faculty', label: 'الهيئة التدريسية', desc: 'قوائم السجل الأكاديمي للأعضاء.', items: [
    { key: 'faculty.ranks', label: 'الدرجات العلمية', type: 'list', default: ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد', 'محاضر', 'مساعد', 'معيد'], max: 20, itemMax: 40, hint: 'حذف درجة مستخدمة لا يغيّر الأعضاء الحاليين، لكن لا يمكن اختيارها لاحقاً.' },
  ] },
  { key: 'display', label: 'العرض', desc: 'أحجام القوائم في الواجهة.', items: [
    { key: 'display.news_limit', label: 'عدد الأخبار المعروضة', type: 'int', default: 30, min: 5, max: 200 },
  ] },
  { key: 'finance', label: 'المالية والمحاسبة', desc: 'إعدادات الإيصالات والقيود والعرض المحاسبي.', items: [
    { key: 'finance.receipt_prefix', label: 'بادئة رقم الإيصال', type: 'text', default: 'RCP', min: 2, max: 8, ascii: true, hint: 'أحرف لاتينية كبيرة؛ تطبَّق على الإيصالات الجديدة.' },
    { key: 'finance.receipt_title', label: 'عنوان الإيصال (رأس PDF)', type: 'text', default: 'إيصال استلام رسوم', min: 5, max: 80 },
    { key: 'finance.receipt_footer', label: 'تذييل الإيصال', type: 'text', default: 'شكراً لسدادكم في الوقت المحدد', min: 0, max: 120 },
    { key: 'finance.separate_poster', label: 'فصل المهام: لا يرحّل القيد من أنشأه', type: 'bool', default: false, hint: 'عند تفعيله يُلزم بأن يرحّل شخص مختلف عن منشئ القيد.' },
    { key: 'procurement.min_quotes', label: 'أقل عدد عروض أسعار قبل الترسية دون تبرير', type: 'int', default: 3, min: 1, max: 10, unit: 'عرض' },
    { key: 'procurement.approval_finance_above', label: 'طلب الشراء فوق هذا المبلغ يحتاج اعتماداً مالياً', type: 'int', default: 1000000, min: 0, max: 100000000000, unit: 'ل.س', hint: 'صفر يلغي هذه المرحلة.' },
    { key: 'procurement.approval_top_above', label: 'طلب الشراء فوق هذا المبلغ يحتاج اعتماد رئاسة الجامعة', type: 'int', default: 10000000, min: 0, max: 100000000000, unit: 'ل.س', hint: 'صفر يلغي هذه المرحلة.' },
    { key: 'finance.budget_control', label: 'الرقابة على الموازنة عند إرسال أمر التوريد', type: 'select', default: 'block', options: opt(['block', 'منع التجاوز'], ['warn', 'تحذير وتسجيل فقط'], ['off', 'بلا رقابة']) },
    { key: 'finance.po_requires_budget', label: 'إلزام كل أمر توريد ببند موازنة', type: 'bool', default: false },
    { key: 'finance.purchase_requires_po', label: 'لا تُسجَّل فاتورة مشتريات إلا على أمر توريد', type: 'bool', default: false },
    { key: 'finance.match_price_tolerance', label: 'الفرق المسموح بين سعر الفاتورة وسعر أمر التوريد', type: 'int', default: 0, min: 0, max: 50, unit: '%' },
    { key: 'finance.invoice_sale_settle', label: 'فواتير المبيعات: حساب الذمة (مدين)', type: 'text', default: '1203', min: 1, max: 20, hint: 'رمز حساب أصل نهائي من دليل الحسابات. يسري على الفواتير الجديدة فقط.' },
    { key: 'finance.invoice_sale_counter', label: 'فواتير المبيعات: حساب الإيراد (دائن)', type: 'text', default: '4203', min: 1, max: 20, hint: 'رمز حساب إيراد نهائي. ويمكن اختيار غيره عند إنشاء كل فاتورة.' },
    { key: 'finance.invoice_purchase_counter', label: 'فواتير المشتريات: حساب المصروف (مدين)', type: 'text', default: '5401', min: 1, max: 20, hint: 'رمز حساب مصروف أو أصل نهائي. ويمكن اختيار غيره عند إنشاء كل فاتورة.' },
    { key: 'finance.invoice_purchase_settle', label: 'فواتير المشتريات: حساب المورد (دائن)', type: 'text', default: '2101', min: 1, max: 20, hint: 'رمز حساب التزام نهائي من دليل الحسابات. يسري على الفواتير الجديدة فقط.' },
    { key: 'finance.default_due_days', label: 'أيام الاستحقاق الافتراضية للرسوم', type: 'int', default: 30, min: 0, max: 365, unit: 'يوماً' },
    { key: 'finance.decimals', label: 'منازل عشرية في العرض', type: 'int', default: 2, min: 0, max: 4, hint: 'لا يؤثر في التخزين (يُخزَّن بدقة 1/100).' },
  ] },
  { key: 'dropdowns', label: 'القوائم المنسدلة الموحدة', desc: 'تعديل وإضافة خيارات كافة القوائم المنسدلة المعتمدة في نماذج النظام.', items: [
    { key: 'dropdowns.positions', label: 'المسميات الوظيفية المعتمدة', type: 'list', default: ['رئيس قسم', 'مدير دائرة', 'موظف شؤون طلاب', 'محاسب مالي', 'مدقق داخلي', 'مهندس نظم ومعلوماتية', 'أمين مستودع', 'منسق أكاديمي', 'موظف ديوان وأرشفة', 'مشرف امتحانات', 'أخرى'], max: 60, itemMax: 60 },
    { key: 'dropdowns.contract_types', label: 'أنواع العقود الوظيفية', type: 'list', default: ['ملاك دائم', 'عقد سنوي مصدق', 'تكليف جزئي / ساعات', 'عقد خبراء واستشاريين', 'ندب / إعارة', 'أخرى'], max: 30, itemMax: 50 },
    { key: 'dropdowns.leave_types', label: 'أنواع الإجازات الوظيفية', type: 'list', default: ['اعتيادية', 'مرضية', 'اضطرارية / ساعية', 'أمومة / أبوة', 'حج / عمرة', 'إجازة دراسية / علمية', 'بلا أجر', 'أخرى'], max: 30, itemMax: 50 },
    { key: 'dropdowns.halls', label: 'القاعات والمدرجات والمخابر', type: 'list', default: [], max: 80, itemMax: 60 },
    { key: 'dropdowns.exam_types', label: 'أنواع الفحوص والامتحانات', type: 'list', default: ['امتحان فصلي نهائي (Final)', 'امتحان نصفي (Midterm)', 'فحص عملي / مخبري', 'امتحان تكميلي / بديل', 'سبر معلومات / مذاكرة', 'مناقشة مشروع تخرج', 'أخرى'], max: 30, itemMax: 60 },
    { key: 'dropdowns.hold_types', label: 'تصنيفات العقوبات والمخالفات الانضباطية', type: 'list', default: ['إنذار خطي أول', 'إنذار خطي مسجل', 'توبيخ أمام اللجنة الانضباطية', 'إلغاء علامة مقرر امتحاني', 'حرمان مؤقت من التقدم للامتحان (فصل واحد)', 'فصل تأديبي مؤقت', 'حاجز ذمة مالية', 'حاجز مكتبة وعهدة', 'أخرى'], max: 40, itemMax: 80 },
    { key: 'dropdowns.scholarship_types', label: 'أنواع المنح والإعفاءات المالية', type: 'list', default: ['منحة تفوق أكاديمي كاملة (100%)', 'منحة تفوق أكاديمي جزئية (50%)', 'إعفاء أبناء الشهداء والجرحى', 'إعفاء أبناء العاملين والهيئة التدريسية', 'دعم صندوق التكافل الاجتماعي', 'أخرى'], max: 30, itemMax: 70 },
    { key: 'dropdowns.corr_categories', label: 'تصنيفات المراسلات والكتب الرسمية', type: 'list', default: ['قرار إداري', 'تعميم جامعي', 'كتاب رسمي داخلي', 'مذكرة عرض', 'محضر اجتماع لجنة', 'تكليف مهمة', 'بلاغ امتحاني', 'أخرى'], max: 40, itemMax: 60 },
  ] },
];

export const ITEMS = Object.fromEntries(SCHEMA.flatMap((t) => t.items.map((i) => [i.key, { ...i, tab: t.key }])));
const skey = (it) => it.legacy ?? `cfg.${it.key}`;

function decode(it, raw) {
  if (raw === undefined || raw === null) return undefined;
  try {
    if (it.legacy) { if (it.type === 'int') { const n = Number(raw); return Number.isFinite(n ? n : NaN) ? n : undefined; } return String(raw); }
    return JSON.parse(raw);
  } catch { return undefined; }
}
const encode = (it, v) => (it.legacy ? String(v) : JSON.stringify(v));

import { cacheGetOrSet, getCachedSettingRaw } from '../cache.js';

// القيمة الفعلية: المحفوظة إن وُجدت وصالحة، وإلا fallback (إن مُرّر)، وإلا الافتراضي. تتحمّل قاعدة وهمية (لا تنكسر).
export function getSetting(db, key, fallback) {
  const it = ITEMS[key];
  if (!it) throw new Error(`إعداد غير معروف: ${key}`);
  let v;
  try {
    const raw = getCachedSettingRaw(db, skey(it));
    v = decode(it, raw);
  } catch {
    v = undefined;
  }
  if (v !== undefined) { try { return normalize(it, v); } catch { /* قيمة تالفة: نعود للافتراضي */ } }
  return fallback !== undefined ? fallback : it.default;
}

function normalize(it, v) {
  const label = `«${it.label}»`;
  switch (it.type) {
    case 'int': {
      const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
      if (!Number.isInteger(n) || n < it.min || n > it.max) throw bad(`${label}: عدد صحيح من ${it.min} إلى ${it.max}.`);
      return n;
    }
    case 'text': {
      const s = String(v ?? '').replace(/\s+/g, ' ').trim();
      if (s.length < (it.min ?? 0) || s.length > it.max) throw bad(`${label}: ${it.min ? `من ${it.min} إلى ` : 'حتى '}${it.max} حرفاً.`);
      if (/[\x00-\x1f<>]/.test(s)) throw bad(`${label} يحوي رموزاً غير مسموحة.`);
      if (it.arabic && !/[؀-ۿ]/.test(s)) throw bad(`${label} يجب أن يحوي حروفاً عربية.`);
      if (it.ascii && !/^[A-Z][A-Z0-9]*$/.test(s)) throw bad(`${label}: أحرف لاتينية كبيرة وأرقام فقط.`);
      return s;
    }
    case 'select': {
      if (!it.options.some((o) => o.value === v)) throw bad(`${label}: خيار غير صالح.`);
      return v;
    }
    case 'bool': return !!v;
    case 'list': {
      const arr = Array.isArray(v) ? v : String(v ?? '').split('\n');
      const out = [];
      for (const x of arr) {
        const s = String(x ?? '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (s.length > it.itemMax) throw bad(`${label}: العنصر «${s.slice(0, 20)}…» أطول من ${it.itemMax} حرفاً.`);
        if (/[\x00-\x1f<>]/.test(s)) throw bad(`${label}: رموز غير مسموحة.`);
        if (!out.includes(s)) out.push(s);
      }
      if (!out.length) throw bad(`${label}: أدخل عنصراً واحداً على الأقل.`);
      if (out.length > it.max) throw bad(`${label}: حتى ${it.max} عنصراً.`);
      return out;
    }
    default: throw new Error('نوع إعداد غير معروف');
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// كل الإعدادات للواجهة: القيمة الحالية + الافتراضي + هل عُدِّلت
export function listSettings(db) {
  return { tabs: SCHEMA.map((t) => ({ key: t.key, label: t.label, desc: t.desc, items: t.items.map((it) => {
    const value = getSetting(db, it.key);
    const { key, label, type, hint, min, max, unit, itemMax, options } = it;
    return { key, label, type, hint: hint ?? '', min, max, unit: unit ?? '', itemMax, options, default: it.default, value, changed: !same(value, it.default) };
  }) })) };
}

// حفظ دفعة قيم: تُتحقَّق كلها قبل أي كتابة (إما الكل أو لا شيء) مع تدقيق القديم والجديد
export function saveSettings({ db }, actor, input, ip) {
  const values = input?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw bad('لا توجد قيم للحفظ.');
  const next = {};
  for (const [k, v] of Object.entries(values)) {
    const it = ITEMS[k];
    if (!it) throw bad(`إعداد غير معروف: ${k}`);
    next[k] = normalize(it, v);
  }
  // اتساق: النجاح والعملي ضمن العلامة القصوى
  const val = (k) => (k in next ? next[k] : getSetting(db, k));
  if (val('grades.pass_mark') > val('grades.total_max') || val('grades.pass_mark_other') > val('grades.total_max')) throw bad('علامة النجاح لا تتجاوز العلامة الكلية القصوى.');
  if (val('grades.practical_max') > val('grades.total_max')) throw bad('الحد الأعلى للعلامة العملية لا يتجاوز العلامة الكلية القصوى.');
  const changes = [];
  tx(db, () => {
    const up = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(next)) {
      const it = ITEMS[k], old = getSetting(db, k);
      if (same(old, v)) continue;
      up.run(skey(it), encode(it, v));
      changes.push(`${k}: ${JSON.stringify(old).slice(0, 60)} ← ${JSON.stringify(v).slice(0, 60)}`);
    }
    if (changes.length) audit(db, actor, 'تعديل الإعدادات العامة', changes.join(' | ').slice(0, 900), ip);
  });
  return { changed: changes.length, ...listSettings(db) };
}

// إعادة قيم إلى الافتراضي (حذف المخزَّن)
export function resetSettings({ db }, actor, input, ip) {
  const keys = Array.isArray(input?.keys) ? input.keys : [];
  if (!keys.length) throw bad('حدّد الإعدادات المراد إعادتها.');
  for (const k of keys) if (!ITEMS[k]) throw bad(`إعداد غير معروف: ${k}`);
  tx(db, () => {
    for (const k of keys) db.prepare('DELETE FROM site_settings WHERE key = ?').run(skey(ITEMS[k]));
    audit(db, actor, 'إعادة إعدادات عامة إلى الافتراضي', keys.join(',').slice(0, 300), ip);
  });
  return listSettings(db);
}

// القيم التي يحتاجها المتصفح (حدود الإدخال والقوائم المنسدلة الموحدة) — بلا مفاتيح حساسة (تُخزَّن مؤقتاً في الذاكرة)
export function publicLimits(db) {
  return cacheGetOrSet(db, 'settings', 'public_limits', () => ({
    passMark: getSetting(db, 'grades.pass_mark'), totalMax: getSetting(db, 'grades.total_max'), practicalMax: getSetting(db, 'grades.practical_max'),
    maxCourseHours: getSetting(db, 'academic.max_course_hours'), defaultCourseHours: getSetting(db, 'academic.default_course_hours'),
    levels: getSetting(db, 'academic.levels'),
    passwordMin: getSetting(db, 'security.password_min'), defaultSla: getSetting(db, 'requests.default_sla_hours'),
    maxAttachmentMb: getSetting(db, 'requests.max_attachment_mb'), governorates: getSetting(db, 'students.governorates'),
    dropdowns: {
      governorates: getSetting(db, 'students.governorates'),
      hsTypes: getSetting(db, 'students.hs_types'),
      admissions: getSetting(db, 'students.admissions'),
      relations: getSetting(db, 'students.relations'),
      levels: getSetting(db, 'academic.levels'),
      facultyRanks: getSetting(db, 'faculty.ranks'),
      departments: universityDepartments(db),
      positions: getSetting(db, 'dropdowns.positions'),
      contractTypes: getSetting(db, 'dropdowns.contract_types'),
      leaveTypes: getSetting(db, 'dropdowns.leave_types'),
      halls: getSetting(db, 'dropdowns.halls'),
      examTypes: getSetting(db, 'dropdowns.exam_types'),
      holdTypes: getSetting(db, 'dropdowns.hold_types'),
      scholarshipTypes: getSetting(db, 'dropdowns.scholarship_types'),
      corrCategories: getSetting(db, 'dropdowns.corr_categories'),
    },
  }));
}

export const studentPermSetting = (perm) => `student_portal.perm_${perm.replace(':', '_')}`;
export const STUDENT_VIEW_KEYS = ['guide', 'grades', 'fees', 'lms', 'expansions', 'student_life', 'alumni', 'ai', 'news', 'tx'];
// صلاحيات حساب الطالب بعد إعدادات «بوابة الطالب»
export function studentPermsOf(db, all) { return all.filter((p) => getSetting(db, studentPermSetting(p), true) !== false); }
// الشاشات التي يراها حساب الطالب بحسب إعدادات «بوابة الطالب»؛ 'home' و'enterprise' ثابتتان
export function studentViewsOf(db, studentId = null) {
  const on = (k) => getSetting(db, `student_portal.view_${k}`, true) !== false;
  const views = ['home', 'enterprise', ...STUDENT_VIEW_KEYS.filter(on)];
  // قسم الخريجين للخريج فقط
  if (studentId && db.prepare('SELECT status FROM student_profiles WHERE user_id = ?').get(Number(studentId))?.status !== 'graduated') return views.filter((v) => v !== 'alumni');
  return views;
}
