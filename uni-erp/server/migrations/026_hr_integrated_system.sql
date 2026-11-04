-- الترحيل 026: منظومة شؤون الموظفين المتكاملة (HR Integrated System v12.5)
-- يدمج كافة جداول وحقول «سيستم الموارد البشرية المتكامل» مع الجداول الحالية (hr_employees, hr_salaries, hr_leaves, hr_contracts) دون أي تعارض

-- 1) توسيع جدول الموظفين الحالي (hr_employees) بالحقول التفصيلية للبدلات والعقود والرصيد السنوي
ALTER TABLE hr_employees ADD COLUMN housing_allowance REAL NOT NULL DEFAULT 0;
ALTER TABLE hr_employees ADD COLUMN transport_allowance REAL NOT NULL DEFAULT 0;
ALTER TABLE hr_employees ADD COLUMN contract_type_label TEXT NOT NULL DEFAULT 'عقد مفتوح';
ALTER TABLE hr_employees ADD COLUMN emp_status_label TEXT NOT NULL DEFAULT 'نشط';
ALTER TABLE hr_employees ADD COLUMN annual_leave_quota INTEGER NOT NULL DEFAULT 21;
ALTER TABLE hr_employees ADD COLUMN insurance_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE hr_employees ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE hr_employees ADD COLUMN department_name TEXT NOT NULL DEFAULT 'الموارد البشرية';

-- 2) توسيع جدول العقود الحالي (hr_contracts) بنوع العقد العربي وحالة العقد
ALTER TABLE hr_contracts ADD COLUMN contract_type_ar TEXT NOT NULL DEFAULT 'دوام كامل';
ALTER TABLE hr_contracts ADD COLUMN status_ar TEXT NOT NULL DEFAULT 'ساري';

-- 3) توسيع جدول الإجازات الحالي (hr_leaves) بنوع الإجازة العربي وخصم الإجازة بدون راتب
ALTER TABLE hr_leaves ADD COLUMN leave_type_ar TEXT NOT NULL DEFAULT 'سنوية';
ALTER TABLE hr_leaves ADD COLUMN unpaid_deduction REAL NOT NULL DEFAULT 0;

-- 4) جدول الحضور والانصراف الشهري ونسبة الالتزام (مطابق لشاشة «حضور وانصراف»)
CREATE TABLE IF NOT EXISTS hr_monthly_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL DEFAULT '2026-10',
  work_days_month INTEGER NOT NULL DEFAULT 26,
  actual_days INTEGER NOT NULL DEFAULT 26,
  late_days INTEGER NOT NULL DEFAULT 0,
  late_hours REAL NOT NULL DEFAULT 0,
  full_days INTEGER NOT NULL DEFAULT 26,
  commitment_rate INTEGER NOT NULL DEFAULT 100,
  evaluation_note TEXT NOT NULL DEFAULT 'ممتاز',
  updated_at INTEGER NOT NULL,
  UNIQUE(employee_id, month)
);
CREATE INDEX IF NOT EXISTS idx_hr_monthly_att_emp ON hr_monthly_attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_monthly_att_month ON hr_monthly_attendance(month);

-- 5) جدول الغياب والخصومات الشهرية (مطابق لشاشة «الغياب»)
CREATE TABLE IF NOT EXISTS hr_absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'تأخير متكرر',
  absence_days INTEGER NOT NULL DEFAULT 0,
  daily_rate REAL NOT NULL DEFAULT 0,
  total_deduction REAL NOT NULL DEFAULT 0,
  month TEXT NOT NULL DEFAULT 'يونيو',
  month_code TEXT NOT NULL DEFAULT '2026-06',
  status_note TEXT NOT NULL DEFAULT 'لا يوجد غياب',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hr_absences_emp ON hr_absences(employee_id);

-- 6) جدول إدارة السلف والأقساط الشهرية (مطابق لشاشة «إدارة السلف»)
CREATE TABLE IF NOT EXISTS hr_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advance_code TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  advance_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  installments_count INTEGER NOT NULL DEFAULT 1,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  monthly_installment REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'مستحقة', -- مجدولة | مستحقة | مدفوعة
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hr_advances_emp ON hr_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_advances_status ON hr_advances(status);

-- 7) جدول برمجة السيستم والقوائم المرجعية (مطابق لشاشة «برمجة السيستم»)
CREATE TABLE IF NOT EXISTS hr_system_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, -- departments | positions | emp_statuses | contract_types | leave_types | absence_reasons | advance_statuses | contract_statuses
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(category, label)
);

-- تزويد القوائم المرجعية من شاشة «برمجة السيستم»
INSERT OR IGNORE INTO hr_system_lookups (category, label, sort_order) VALUES
  -- الأقسام
  ('departments', 'الموارد البشرية', 1),
  ('departments', 'الحسابات', 2),
  ('departments', 'المبيعات', 3),
  ('departments', 'التسويق', 4),
  ('departments', 'تقنية المعلومات', 5),
  ('departments', 'خدمة العملاء', 6),
  ('departments', 'المشتريات', 7),
  ('departments', 'الإدارة', 8),
  ('departments', 'المخازن', 9),
  ('departments', 'التشغيل والإنتاج', 10),
  ('departments', 'الشؤون الأكاديمية والامتحانات', 11),
  -- الوظائف
  ('positions', 'اداري', 1),
  ('positions', 'محاسب', 2),
  ('positions', 'مشرف انتاج', 3),
  ('positions', 'مسؤول تسويق', 4),
  ('positions', 'مراقب امن', 5),
  ('positions', 'مراقب جودة', 6),
  ('positions', 'مندوب تسويق', 7),
  ('positions', 'مدير إداري', 8),
  ('positions', 'مدير الانتاج', 9),
  ('positions', 'فني انتاج', 10),
  ('positions', 'أخصائي موارد بشرية', 11),
  ('positions', 'مهندس نظم ومعلومات', 12),
  -- حالات الموظف
  ('emp_statuses', 'نشط', 1),
  ('emp_statuses', 'تحت الاختبار', 2),
  ('emp_statuses', 'استقالة', 3),
  ('emp_statuses', 'انتهاء عقد', 4),
  ('emp_statuses', 'في إجازة', 5),
  -- أنواع العقود
  ('contract_types', 'عقد مفتوح', 1),
  ('contract_types', 'عقد مؤقت', 2),
  ('contract_types', 'تحت الاختبار 3 شهور', 3),
  ('contract_types', 'عدم صلاحية', 4),
  ('contract_types', 'دوام كامل', 5),
  ('contract_types', 'دوام جزئي', 6),
  ('contract_types', 'تدريب', 7),
  -- أنواع الإجازات
  ('leave_types', 'سنوية', 1),
  ('leave_types', 'اعتيادي', 2),
  ('leave_types', 'مرضية', 3),
  ('leave_types', 'عارضة', 4),
  ('leave_types', 'بدون راتب', 5),
  ('leave_types', 'أمومة', 6),
  ('leave_types', 'منحة', 7),
  ('leave_types', 'حج وعمرة', 8),
  -- أسباب الغياب
  ('absence_reasons', 'غياب بدون إذن', 1),
  ('absence_reasons', 'تأخير متكرر', 2),
  ('absence_reasons', 'مأمورية سفر', 3),
  ('absence_reasons', 'ظروف طارئة', 4),
  -- حالة السلفة
  ('advance_statuses', 'مستحقة', 1),
  ('advance_statuses', 'مدفوعة', 2),
  ('advance_statuses', 'مجدولة', 3),
  -- حالة العقد
  ('contract_statuses', 'ساري', 1),
  ('contract_statuses', 'ينتهي قريبا', 2),
  ('contract_statuses', 'منتهي', 3),
  ('contract_statuses', 'معلق', 4);

-- 8) جدول إعدادات التنبيهات والسياسات المالية لشؤون الموظفين
CREATE TABLE IF NOT EXISTS hr_alert_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL, -- alerts | attendance | payroll | leaves
  unit TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO hr_alert_settings (key, value, label, category, unit, updated_at) VALUES
  ('contract_expiry_warning_days', '60', 'فترة التنبيه المبكر قبل انتهاء عقد الموظف (يحتاج تجديد)', 'alerts', 'يوم', 1761400000000),
  ('contract_expiry_critical_days', '15', 'فترة التنبيه الحرج قبل انتهاء العقد (أولوية قصوى)', 'alerts', 'يوم', 1761400000000),
  ('probation_expiry_alert_days', '14', 'فترة التنبيه قبل انتهاء فترة الاختبار (3 شهور)', 'alerts', 'يوم', 1761400000000),
  ('attendance_excellent_pct', '95', 'الحد الأدنى لتقييم الالتزام «ممتاز»', 'attendance', '%', 1761400000000),
  ('attendance_good_pct', '85', 'الحد الأدنى لتقييم الالتزام «جيد» (أقل منه يطلق تنبيه يحتاج متابعة)', 'attendance', '%', 1761400000000),
  ('absence_review_threshold_days', '3', 'عدد أيام الغياب الشهري الذي يحوّل الموظف إلى «مراجعة إدارية»', 'attendance', 'أيام', 1761400000000),
  ('standard_month_work_days', '26', 'أيام العمل المعيارية في الشهر لحساب نسبة الالتزام', 'attendance', 'يوم', 1761400000000),
  ('default_annual_leave_days', '21', 'الرصيد السنوي الافتراضي للإجازات الاعتيادية', 'leaves', 'يوم', 1761400000000),
  ('low_leave_balance_alert_days', '3', 'التنبيه عند انخفاض الرصيد المتبقي من الإجازة السنوية إلى أقل من', 'leaves', 'أيام', 1761400000000),
  ('salary_day_divisor', '30', 'مقسوم الشهر لحساب أجر اليوم الواحد في خصم الغياب والإجازة بدون راتب', 'payroll', 'يوم', 1761400000000),
  ('default_housing_pct', '18', 'نسبة بدل السكن الافتراضية من الراتب الأساسي', 'payroll', '%', 1761400000000),
  ('default_transport_amount', '575', 'قيمة بدل الانتقال الشهري الافتراضية', 'payroll', 'وحدة نقدية', 1761400000000),
  ('default_insurance_pct', '11', 'نسبة خصم التأمينات الاجتماعية من الراتب الأساسي', 'payroll', '%', 1761400000000),
  ('default_tax_pct', '8', 'نسبة خصم الضرائب من الراتب الأساسي', 'payroll', '%', 1761400000000),
  ('max_advance_installment_pct', '35', 'الحد الأقصى لنسبة قسط السلفة الشهري من الراتب الأساسي', 'payroll', '%', 1761400000000),
  ('enable_contract_alerts', '1', 'تفعيل تنبيهات انتهاء العقود وتجديدها تلقائياً', 'alerts', 'تبديل', 1761400000000),
  ('enable_attendance_alerts', '1', 'تفعيل تنبيهات تدني الالتزام والغياب المتكرر', 'alerts', 'تبديل', 1761400000000),
  ('enable_advance_alerts', '1', 'تفعيل تنبيهات الأقساط والسلف المستحقة', 'alerts', 'تبديل', 1761400000000),
  ('enable_leave_alerts', '1', 'تفعيل تنبيهات استنفاد رصيد الإجازات السنوية', 'alerts', 'تبديل', 1761400000000);
