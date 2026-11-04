-- 029_student_affairs_suite.sql
-- تطوير منظومة شؤون الطلاب المتكاملة (1: القبول والمفاضلة والمعادلة، 2: الخطة الدراسية والإرشاد والإنذار المبكر، 3: حركات القيد والانضباط، 5: المنح والإعفاءات المدمجة مالياً، 6: مكتب خدمة الطالب والدور الذكي وتتبع الطلبات)

-- 1. جدول المتقدمين للمفاضلة والقبول الجامعي
CREATE TABLE IF NOT EXISTS sa_applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  national_id TEXT NOT NULL,
  phone TEXT,
  hs_type TEXT NOT NULL DEFAULT 'علمي',
  hs_score REAL NOT NULL,
  hs_year INTEGER NOT NULL DEFAULT 2026,
  category TEXT NOT NULL DEFAULT 'general', -- general (عام) | parallel (موازي) | martyrs (أبناء شهداء) | transfer (انتقال/تحويل)
  pref1_program_id INTEGER NOT NULL,
  pref2_program_id INTEGER,
  pref3_program_id INTEGER,
  accepted_program_id INTEGER,
  sorting_status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | waitlisted | rejected | enrolled
  enrolled_student_id INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL
);

-- 1-ب. جدول معادلة المقررات للطلاب المحولين
CREATE TABLE IF NOT EXISTS sa_credit_equivalences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  source_university TEXT NOT NULL,
  external_course_code TEXT NOT NULL,
  external_course_name TEXT NOT NULL,
  external_hours INTEGER NOT NULL DEFAULT 3,
  external_mark REAL NOT NULL,
  internal_course_id INTEGER NOT NULL,
  equivalence_status TEXT NOT NULL DEFAULT 'approved', -- pending | approved | rejected
  decided_by TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

-- 2. جدول المتطلبات السابقة للمقررات (Prerequisite Tree) + جلسات الإرشاد والإنذار الأكاديمي المبكر
CREATE TABLE IF NOT EXISTS sa_course_prerequisites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  prereq_course_id INTEGER NOT NULL,
  min_mark REAL NOT NULL DEFAULT 60,
  UNIQUE(course_id, prereq_course_id)
);

CREATE TABLE IF NOT EXISTS sa_advising_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  warning_type TEXT NOT NULL, -- gpa_low | repeated_fail | absence_high
  severity TEXT NOT NULL DEFAULT 'warning', -- warning | critical | probation
  gpa_snapshot REAL,
  absence_rate REAL,
  failed_courses_count INTEGER DEFAULT 0,
  advisor_name TEXT NOT NULL,
  action_plan TEXT NOT NULL,
  session_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | monitoring | resolved
  created_at INTEGER NOT NULL
);

-- 3. جدول أتمتة حركات الوضع الطلابي (تأجيل، إيقاف قيد، انسحاب، إعادة قيد، تحويل تخصص)
CREATE TABLE IF NOT EXISTS sa_lifecycle_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL, -- postponement (تأجيل فصل) | suspension (إيقاف قيد) | withdrawal (انسحاب) | reinstatement (إعادة قيد) | program_transfer (تغيير تخصص)
  academic_year TEXT NOT NULL,
  semester INTEGER NOT NULL DEFAULT 1,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  from_program_id INTEGER,
  to_program_id INTEGER,
  financial_impact TEXT,
  academic_impact TEXT,
  decision_no TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- 3-ب. تفاصيل القرارات الانضباطية المرتبطة بجدول student_holds
CREATE TABLE IF NOT EXISTS sa_disciplinary_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hold_id INTEGER NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,
  committee_decision_no TEXT NOT NULL,
  violation_category TEXT NOT NULL, -- exam_misconduct | attendance_breach | campus_conduct | document_forgery
  penalty_level TEXT NOT NULL, -- warning | exam_zero | term_suspension | dismissal
  blocks_documents INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at INTEGER NOT NULL
);

-- 5. جدول المنح والإعفاءات والرعاية الطلابية المرتبط مع المالية (fin_charges)
CREATE TABLE IF NOT EXISTS sa_scholarships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,
  scholarship_type TEXT NOT NULL, -- merit_top (تفوق أكاديمي) | martyrs_kin (أبناء شهداء) | sibling_discount (حسم إخوة) | social_aid (تكافل اجتماعي)
  discount_percent REAL NOT NULL,
  amount REAL NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '2025-2026',
  gpa_at_grant REAL,
  fin_charge_id INTEGER, -- رقم قيد الخصم في جدول fin_charges المالي
  status TEXT NOT NULL DEFAULT 'active', -- active | revoked
  approved_by TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

-- 6. جدول حجز المواعيد والدور الذكي في مكتب خدمة الطالب الموحد (مرتبط بجدول requests)
CREATE TABLE IF NOT EXISTS sa_desk_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,
  request_id INTEGER, -- اختياري: مرتبط بمعاملة محددة في جدول requests
  service_purpose TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  counter_window TEXT NOT NULL DEFAULT 'النافذة 1 — تسليم الوثائق المصدقة',
  queue_status TEXT NOT NULL DEFAULT 'waiting', -- waiting (قيد الانتظار) | serving (يُخدَم الآن) | completed (تم التسليم) | no_show (لم يحضر)
  called_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);
