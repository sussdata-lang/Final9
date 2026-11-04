-- المرحلة 28: التوسعة الشاملة (Enterprise Suite v12.8) — تطبيق كافة المقترحات الـ 15

-- 1. الجداول الدراسية والامتحانية المؤتمتة (Auto-Scheduler)
CREATE TABLE IF NOT EXISTS smart_schedule_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  faculty_name TEXT NOT NULL,
  instructor_name TEXT NOT NULL,
  hall_code TEXT NOT NULL,
  day_name TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  section_code TEXT DEFAULT 'شعبة 1',
  enrolled_count INTEGER DEFAULT 35,
  capacity INTEGER DEFAULT 60,
  status TEXT DEFAULT 'معتمد',
  created_at INTEGER NOT NULL
);

-- 2. بنك الأسئلة والامتحانات الإلكترونية (Online Quizzes & Auto-Grading)
CREATE TABLE IF NOT EXISTS online_quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  title TEXT NOT NULL,
  instructor_name TEXT NOT NULL,
  duration_min INTEGER DEFAULT 30,
  total_marks INTEGER DEFAULT 20,
  questions_json TEXT NOT NULL,
  status TEXT DEFAULT 'نشط',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS online_quiz_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  score REAL NOT NULL,
  total_marks INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  submitted_at INTEGER NOT NULL
);

-- 3. التسجيل الذاتي للفصول الدراسية (Self-Enrollment)
CREATE TABLE IF NOT EXISTS student_self_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  credits INTEGER DEFAULT 3,
  semester TEXT DEFAULT 'الفصل الأول 2026/2027',
  prerequisite_code TEXT DEFAULT '',
  status TEXT DEFAULT 'مسجل',
  registered_at INTEGER NOT NULL
);

-- 4. قسائم الرواتب الموقعة رقمياً (Signed PDF Payslips)
CREATE TABLE IF NOT EXISTS hr_signed_payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payslip_code TEXT NOT NULL UNIQUE,
  employee_code TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  month_label TEXT NOT NULL,
  basic_salary REAL NOT NULL,
  overload_pay REAL DEFAULT 0,
  allowances REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  net_salary REAL NOT NULL,
  digital_signature TEXT NOT NULL,
  issued_at INTEGER NOT NULL
);

-- 5. العبء التدريسي الإضافي لأعضاء الهيئة التدريسية (Faculty Overload Payroll)
CREATE TABLE IF NOT EXISTS faculty_overload_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_name TEXT NOT NULL,
  academic_rank TEXT NOT NULL,
  faculty_name TEXT NOT NULL,
  quorum_hours INTEGER NOT NULL,
  actual_teaching_hours INTEGER NOT NULL,
  supervision_hours INTEGER DEFAULT 0,
  overload_hours INTEGER NOT NULL,
  hourly_rate REAL NOT NULL,
  total_overload_pay REAL NOT NULL,
  semester TEXT DEFAULT 'الفصل الأول 2026/2027',
  status TEXT DEFAULT 'معتمد للرواتب',
  updated_at INTEGER NOT NULL
);

-- 6. تقسيط الرسوم والدفع الإلكتروني (Student E-Payment & Installments)
CREATE TABLE IF NOT EXISTS student_fee_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installment_code TEXT NOT NULL UNIQUE,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  faculty_name TEXT NOT NULL,
  installment_no INTEGER NOT NULL,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  paid_amount REAL DEFAULT 0,
  payment_method TEXT DEFAULT '',
  receipt_no TEXT DEFAULT '',
  status TEXT DEFAULT 'غير مسدد',
  paid_at INTEGER DEFAULT 0
);

-- 7. مركز الإشعارات الفورية متعدد القنوات (Multi-Channel Notification Hub)
CREATE TABLE IF NOT EXISTS multi_channel_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  channels TEXT NOT NULL,
  priority TEXT DEFAULT 'عادي',
  delivery_count INTEGER DEFAULT 0,
  sender_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 8. النسخ الاحتياطي المجدول والمشفر (Automated Encrypted Snapshots)
CREATE TABLE IF NOT EXISTS encrypted_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  Schedule_type TEXT DEFAULT 'يومي مجدول',
  cipher_algo TEXT DEFAULT 'AES-256-GCM',
  sha256_hash TEXT NOT NULL,
  size_kb INTEGER NOT NULL,
  tables_count INTEGER DEFAULT 42,
  status TEXT DEFAULT 'مكتمل ومشفر',
  created_at INTEGER NOT NULL
);

-- 9. مزامنة اللجان الامتحانية دون اتصال (Offline Attendance & Grade Queue Log)
CREATE TABLE IF NOT EXISTS offline_sync_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_code TEXT NOT NULL UNIQUE,
  committee_name TEXT NOT NULL,
  hall_code TEXT NOT NULL,
  course_code TEXT NOT NULL,
  records_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  synced_by TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);
