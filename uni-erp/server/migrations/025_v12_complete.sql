-- الترحيل 025: الإصدار 12 الشامل
-- 1) استكمال الوحدات (5.12 التعلم الإلكتروني والمكتبة، 5.13 البحث العلمي والدراسات العليا، 5.14 الخريجون والتوظيف، 5.15 الجودة والاعتماد)
-- 2) توسيع الوحدات الجزئية (5.5 جداول الامتحانات والتظلمات، 5.6 الساعات المكتبية والترقيات، 5.7 السكن الجامعي والمنح والأنشطة، 5.8 تقييم الأداء والتدريب والبصمة)
-- 3) البنية التحتية والتوسع (Scalability: PostgreSQL / Redis / SSO)
-- 4) الذكاء الاصطناعي الجامعي (AI Early Warning, Academic Advisor, Smart Correspondence Triage)

-- ==================== 5.12 التعلم الإلكتروني والمكتبة الرقمية ====================
CREATE TABLE IF NOT EXISTS lms_lectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pdf', -- video | pdf | slides | assignment
  week_no INTEGER NOT NULL DEFAULT 1,
  instructor_name TEXT NOT NULL,
  content_url TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  views_count INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lms_quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  total_marks INTEGER NOT NULL DEFAULT 20,
  questions_json TEXT NOT NULL DEFAULT '[]',
  attempts_count INTEGER NOT NULL DEFAULT 0,
  avg_score REAL NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isbn TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL,
  publish_year INTEGER NOT NULL DEFAULT 2024,
  copies_total INTEGER NOT NULL DEFAULT 5,
  copies_available INTEGER NOT NULL DEFAULT 5,
  shelf_code TEXT NOT NULL DEFAULT 'A-01',
  digital_available INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  borrower_name TEXT NOT NULL,
  borrower_no TEXT NOT NULL,
  loan_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  return_date TEXT,
  status TEXT NOT NULL DEFAULT 'borrowed', -- borrowed | returned | overdue
  created_at INTEGER NOT NULL
);

-- ==================== 5.13 البحث العلمي والدراسات العليا ====================
CREATE TABLE IF NOT EXISTS research_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  principal_investigator TEXT NOT NULL,
  faculty_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  budget REAL NOT NULL DEFAULT 0,
  journal_name TEXT NOT NULL DEFAULT '',
  impact_factor REAL NOT NULL DEFAULT 0,
  citations_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- proposed | active | published | completed
  published_at TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS postgrad_theses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  degree TEXT NOT NULL DEFAULT 'ماجستير', -- ماجستير | دكتوراه
  program_name TEXT NOT NULL,
  title TEXT NOT NULL,
  supervisor_name TEXT NOT NULL,
  co_supervisor TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'كتابة الأطروحة',
  defense_date TEXT NOT NULL DEFAULT '',
  grade_label TEXT NOT NULL DEFAULT 'قيد الإعداد',
  created_at INTEGER NOT NULL
);

-- ==================== 5.14 الخريجون والتوظيف ====================
CREATE TABLE IF NOT EXISTS alumni_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  faculty_name TEXT NOT NULL,
  program_name TEXT NOT NULL,
  grad_year INTEGER NOT NULL,
  gpa REAL NOT NULL,
  honor_rank TEXT NOT NULL DEFAULT 'جيد جداً',
  current_employer TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  verified_code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS career_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  sector TEXT NOT NULL,
  location TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'دوام كامل',
  salary_range TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  applicants_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS career_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES career_jobs(id) ON DELETE CASCADE,
  applicant_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  gpa REAL NOT NULL DEFAULT 0,
  cv_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'قيد المراجعة',
  applied_at INTEGER NOT NULL
);

-- ==================== 5.15 الجودة والاعتماد المؤسسي ====================
CREATE TABLE IF NOT EXISTS qa_kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  standard_domain TEXT NOT NULL,
  target_value REAL NOT NULL,
  actual_value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '%',
  status TEXT NOT NULL DEFAULT 'متحقق',
  academic_year TEXT NOT NULL DEFAULT '2026/2027',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  instructor_name TEXT NOT NULL,
  semester TEXT NOT NULL DEFAULT 'الفصل الأول 2026/2027',
  responses_count INTEGER NOT NULL DEFAULT 0,
  content_score REAL NOT NULL DEFAULT 4.5,
  teaching_score REAL NOT NULL DEFAULT 4.6,
  assessment_score REAL NOT NULL DEFAULT 4.4,
  overall_score REAL NOT NULL DEFAULT 4.5,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_accreditations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_name TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  standard_code TEXT NOT NULL,
  self_study_progress INTEGER NOT NULL DEFAULT 80,
  audit_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'قيد المراجعة',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- ==================== 5.5 توسعة الامتحانات والتظلمات ====================
CREATE TABLE IF NOT EXISTS exam_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  program_name TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'نهائي',
  exam_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  hall_name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 60,
  enrolled_count INTEGER NOT NULL DEFAULT 45,
  proctor_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'مجدول',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS grade_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  old_mark REAL NOT NULL,
  new_mark REAL,
  reason TEXT NOT NULL,
  committee_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'قيد اللجنة', -- قيد اللجنة | مقبول وتعديل العلامة | مرفوض
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- ==================== 5.6 توسعة أعضاء هيئة التدريس ====================
CREATE TABLE IF NOT EXISTS office_hour_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_name TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  slot_day TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'مؤكد',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faculty_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  current_rank TEXT NOT NULL,
  target_rank TEXT NOT NULL,
  research_points REAL NOT NULL DEFAULT 0,
  required_points REAL NOT NULL DEFAULT 100,
  teaching_years INTEGER NOT NULL DEFAULT 4,
  committee_status TEXT NOT NULL DEFAULT 'قيد التحكيم العلمي',
  submitted_at INTEGER NOT NULL
);

-- ==================== 5.7 توسعة الخدمات الطلابية والسكن والمنح ====================
CREATE TABLE IF NOT EXISTS dorm_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_name TEXT NOT NULL,
  room_no TEXT NOT NULL,
  floor_no INTEGER NOT NULL DEFAULT 1,
  capacity INTEGER NOT NULL DEFAULT 2,
  occupied INTEGER NOT NULL DEFAULT 1,
  room_type TEXT NOT NULL DEFAULT 'مزدوجة',
  annual_fee REAL NOT NULL DEFAULT 1200000,
  status TEXT NOT NULL DEFAULT 'متاحة'
);

CREATE TABLE IF NOT EXISTS dorm_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES dorm_rooms(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  faculty_name TEXT NOT NULL,
  check_in_date TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '2026/2027',
  payment_status TEXT NOT NULL DEFAULT 'مسدد',
  status TEXT NOT NULL DEFAULT 'ساكن'
);

CREATE TABLE IF NOT EXISTS scholarships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  program_name TEXT NOT NULL,
  scholarship_type TEXT NOT NULL,
  discount_percent INTEGER NOT NULL DEFAULT 50,
  amount_covered REAL NOT NULL DEFAULT 0,
  academic_year TEXT NOT NULL DEFAULT '2026/2027',
  status TEXT NOT NULL DEFAULT 'مفعّلة',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS student_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_name TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'علمي',
  event_date TEXT NOT NULL,
  location TEXT NOT NULL,
  supervisor_name TEXT NOT NULL,
  participants_count INTEGER NOT NULL DEFAULT 25,
  budget REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'قادم'
);

-- ==================== 5.8 توسعة الموارد البشرية (التقييم والتدريب والبصمة) ====================
CREATE TABLE IF NOT EXISTS hr_appraisals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  period_label TEXT NOT NULL DEFAULT 'التقييم السنوي 2026',
  punctuality_score INTEGER NOT NULL DEFAULT 90,
  productivity_score INTEGER NOT NULL DEFAULT 88,
  teamwork_score INTEGER NOT NULL DEFAULT 92,
  overall_score REAL NOT NULL DEFAULT 90,
  recommendation TEXT NOT NULL DEFAULT 'علاوة دورية',
  evaluator_name TEXT NOT NULL DEFAULT 'مدير الموارد البشرية',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_trainings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  trainer_name TEXT NOT NULL,
  target_department TEXT NOT NULL,
  start_date TEXT NOT NULL,
  hours_count INTEGER NOT NULL DEFAULT 20,
  enrolled_count INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'مفتوح للتسجيل'
);

CREATE TABLE IF NOT EXISTS hr_biometric_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'ZKTeco Push SDK v3',
  last_sync_at INTEGER NOT NULL,
  logs_synced INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'متصل'
);

-- ==================== البنية التحتية والذكاء الاصطناعي ====================
CREATE TABLE IF NOT EXISTS infra_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_early_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  program_name TEXT NOT NULL,
  gpa REAL NOT NULL,
  attendance_rate INTEGER NOT NULL,
  failed_courses INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL, -- حرج | متوسط | آمن
  ai_diagnosis TEXT NOT NULL,
  ai_action_plan TEXT NOT NULL,
  advisor_status TEXT NOT NULL DEFAULT 'بانتظار المتابعة',
  analyzed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_triage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL DEFAULT 'شكوى طلابية',
  sender_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  ai_category TEXT NOT NULL,
  ai_priority TEXT NOT NULL,
  target_unit TEXT NOT NULL,
  ai_summary TEXT NOT NULL,
  ai_draft_reply TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_advisor_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_label TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  model_used TEXT NOT NULL DEFAULT 'rule-based',
  created_at INTEGER NOT NULL
);

-- ==================== البيانات التأسيسية (Seed Data) ====================
INSERT OR IGNORE INTO lms_lectures (id, course_code, course_name, title, kind, week_no, instructor_name, content_url, summary, views_count, published, created_at) VALUES
  (1, 'CYB-101', 'مبادئ الأمن السيبراني والتشفير', 'المحاضرة 1: معمارية الدفاع المتعمق وتحليل التهديدات', 'video', 1, 'أ.د. مازن الحسن', '/lms/cyb101-w1.mp4', 'شرح طبقات الحماية السيبرانية، نموذج CIA، وتصنيف الهجمات الحديثة على البنى الحرجة.', 142, 1, 1761400000000),
  (2, 'CYB-101', 'مبادئ الأمن السيبراني والتشفير', 'المحاضرة 2: خوارزميات التشفير المتماثل وغير المتماثل (AES & RSA)', 'pdf', 2, 'أ.د. مازن الحسن', '/lms/cyb101-w2.pdf', 'التطبيقات الرياضية للتشفير، إدارة المفاتيح PKI، والتوقيع الرقمي PAdES.', 118, 1, 1761410000000),
  (3, 'LAW-201', 'القانون الجنائي والأدلة الرقمية', 'المحاضرة 1: حجية الدليل الرقمي في الإثبات الجنائي', 'slides', 1, 'د. سمر العبدالله', '/lms/law201-w1.pdf', 'سلسلة الحيازة الجنائية (Chain of Custody) وضوابط سلامة البصمة الرقمية SHA-256.', 95, 1, 1761420000000),
  (4, 'NET-302', 'أمن الشبكات وبروتوكولات الاتصال', 'تكليف عملي 1: إعداد جدار ناري وكشف التسلل IDS', 'assignment', 3, 'د. طارق منصور', '/lms/net302-hw1.pdf', 'تطبيق قواعد تصفية الحزم وتحليل سجلات حركة المرور المشبوهة.', 84, 1, 1761430000000);

INSERT OR IGNORE INTO lms_quizzes (id, course_code, course_name, title, duration_min, total_marks, questions_json, attempts_count, avg_score, published, created_at) VALUES
  (1, 'CYB-101', 'مبادئ الأمن السيبراني والتشفير', 'الاختبار القصير الأول: التشفير والبصمات الرقمية', 20, 20, '[{"q":"ما الخوارزمية المستخدمة في بصمة سجل التدقيق؟","options":["MD5","SHA-256","DES"],"ans":1},{"q":"أي مما يلي يحقق عدم الإنكار؟","options":["التوقيع الرقمي","الضغط","الترميز"],"ans":0}]', 68, 17.5, 1, 1761400000000),
  (2, 'LAW-201', 'القانون الجنائي والأدلة الرقمية', 'اختبار منتصف الفصل: مسرح الجريمة الإلكترونية', 30, 25, '[{"q":"أول إجراء عند ضبط جهاز رقمي في مسرح الحادث:","options":["توثيق الحالة وعزل الشبكة","إعادة التشغيل","تثبيت برامج فحص"],"ans":0}]', 52, 21.0, 1, 1761410000000);

INSERT OR IGNORE INTO library_books (id, isbn, title, author, category, publish_year, copies_total, copies_available, shelf_code, digital_available, created_at) VALUES
  (1, '978-9933-10-401-2', 'هندسة الأمن السيبراني والتحقيق الجنائي الرقمي', 'أ.د. مازن الحسن', 'الأمن السيبراني', 2025, 12, 9, 'CYB-A1', 1, 1761400000000),
  (2, '978-9933-10-402-9', 'أصول المحاكمات الجزائية والجرائم المعلوماتية', 'د. سمر العبدالله', 'العلوم القانونية', 2024, 15, 11, 'LAW-B3', 1, 1761400000000),
  (3, '978-9933-10-403-6', 'الذكاء الاصطناعي في الأنظمة الأمنية والحيوية', 'د. خالد الشامي', 'الذكاء الاصطناعي', 2026, 8, 6, 'AI-C2', 1, 1761400000000),
  (4, '978-9933-10-404-3', 'إدارة الأزمات والتخطيط الاستراتيجي المؤسسي', 'أ.د. غسان اليوسف', 'العلوم الإدارية', 2025, 10, 8, 'ADM-D1', 1, 1761400000000);

INSERT OR IGNORE INTO library_loans (id, book_id, borrower_name, borrower_no, loan_date, due_date, return_date, status, created_at) VALUES
  (1, 1, 'أحمد محمد العلي', 'CYB-2026-0001', '2026-10-10', '2026-10-28', NULL, 'borrowed', 1761400000000),
  (2, 2, 'نور الهدى الخطيب', 'LAW-2026-0002', '2026-10-01', '2026-10-15', '2026-10-14', 'returned', 1761400000000),
  (3, 3, 'كريم سامر الدالاتي', 'CYB-2026-0003', '2026-10-02', '2026-10-16', NULL, 'overdue', 1761400000000);

INSERT OR IGNORE INTO research_projects (id, code, title, principal_investigator, faculty_name, domain, budget, journal_name, impact_factor, citations_count, status, published_at, created_at) VALUES
  (1, 'RES-2026-01', 'كشف هجمات يوم الصفر باستخدام الشبكات العصبية البيانية GNN', 'أ.د. مازن الحسن', 'كلية هندسة الأمن السيبراني', 'الأمن السيبراني والذكاء الاصطناعي', 45000000, 'IEEE Transactions on Information Forensics', 6.8, 34, 'published', '2026-08-15', 1761400000000),
  (2, 'RES-2026-02', 'حوكمة التوقيع الرقمي وسلاسل الكتل في الوثائق الحكومية والأكاديمية', 'د. طارق منصور', 'كلية هندسة الأمن السيبراني', 'التشفير التطبيقي', 32000000, 'Journal of Information Security and Applications', 4.9, 19, 'active', '2026-10-01', 1761400000000),
  (3, 'RES-2026-03', 'الإطار التشريعي لمكافحة جرائم التزييف العميق Deepfake', 'د. سمر العبدالله', 'كلية الحقوق والعلوم الشرطية', 'القانون الجنائي الرقمي', 18000000, 'المجلة العربية للدراسات القانونية والأمنية', 3.2, 12, 'published', '2026-06-20', 1761400000000);

INSERT OR IGNORE INTO postgrad_theses (id, student_no, student_name, degree, program_name, title, supervisor_name, co_supervisor, stage, defense_date, grade_label, created_at) VALUES
  (1, 'PG-2025-0012', 'المهندس رامي زيدان', 'ماجستير', 'الأمن السيبراني والتحقيق الرقمي', 'تصميم نموذج خفيف لكشف البرمجيات الخبيثة في أنظمة إنترنت الأشياء الصناعية', 'أ.د. مازن الحسن', 'د. طارق منصور', 'تشكيل لجنة الحكم', '2026-11-20', 'جاهز للمناقشة', 1761400000000),
  (2, 'PG-2024-0004', 'الباحثة لينا الصباغ', 'دكتوراه', 'القانون الجنائي والعلوم الجنائية', 'المسؤولية الجزائية عن قرارات الأنظمة الذكية المستقلة', 'د. سمر العبدالله', 'أ.د. غسان اليوسف', 'تمت المناقشة', '2026-09-10', 'ممتاز مع مرتبة الشرف', 1761400000000),
  (3, 'PG-2026-0019', 'المهندس باسل الحموي', 'ماجستير', 'هندسة النظم والشبكات الآمنة', 'بروتوكول مصادقة مقاوم للحوسبة الكمومية للبطاقات الذكية', 'د. خالد الشامي', '', 'كتابة الأطروحة', '2027-03-15', 'قيد الإعداد', 1761400000000);

INSERT OR IGNORE INTO alumni_records (id, student_no, full_name, faculty_name, program_name, grad_year, gpa, honor_rank, current_employer, job_title, email, phone, verified_code, created_at) VALUES
  (1, 'CYB-2022-0014', 'م. يزن عبد الرحمن القاسم', 'كلية هندسة الأمن السيبراني', 'الأمن السيبراني والشبكات', 2026, 94.6, 'مرتبة الشرف الأولى', 'المركز الوطني لأمن المعلومات', 'محلل استجابة للحوادث السيبرانية SOC', 'yazan.kassem@alumni.uni.edu.sy', '0944112233', 'GRAD-2026-CYB0014', 1761400000000),
  (2, 'LAW-2022-0008', 'أ. ريم محمود السعدي', 'كلية الحقوق والعلوم الشرطية', 'الحقوق والعلوم الجنائية', 2026, 91.2, 'ممتاز', 'إدارة التشريع والقضايا', 'باحثة قانونية', 'reem.saadi@alumni.uni.edu.sy', '0933221144', 'GRAD-2026-LAW0008', 1761400000000),
  (3, 'CYB-2021-0031', 'م. سامر فؤاد النجار', 'كلية هندسة الأمن السيبراني', 'هندسة البرمجيات الآمنة', 2025, 88.4, 'جيد جداً', 'شركة الحلول الرقمية المتقدمة', 'مهندس أمن تطبيقات DevSecOps', 'samer.najjar@alumni.uni.edu.sy', '0955667788', 'GRAD-2025-CYB0031', 1761400000000);

INSERT OR IGNORE INTO career_jobs (id, title, company_name, sector, location, job_type, salary_range, requirements, deadline, applicants_count, active, created_at) VALUES
  (1, 'مهندس أمن شبكات واختبار اختراق (Penetration Tester)', 'مركز أمن المعلومات الوطني', 'القطاع الحكومي والتقني', 'دمشق', 'دوام كامل', '3,500,000 - 5,000,000 ل.س', 'بكالوريوس أمن سيبراني، إلمام بـ Linux وأدوات الفحص وتحليل الثغرات.', '2026-12-01', 14, 1, 1761400000000),
  (2, 'باحث قانوني في الجرائم المعلوماتية والعقود الرقمية', 'هيئة التطوير التشريعي والرقمي', 'القطاع القانوني', 'دمشق', 'دوام كامل', '2,800,000 - 3,800,000 ل.س', 'إجازة في الحقوق، معرفة بقانون الجرائم المعلوماتية والتوقيع الإلكتروني.', '2026-11-25', 9, 1, 1761400000000),
  (3, 'برنامج التدريب التعاوني الصيفي لمطوري النظم الآمنة', 'مختبرات الابتكار التقني', 'التدريب والتأهيل', 'دمشق / هجين', 'تدريب تعاوني', 'مكافأة تدريب شهرية', 'طلاب السنة الثالثة والرابعة بمعدل لا يقل عن 80%.', '2026-12-15', 27, 1, 1761400000000);

INSERT OR IGNORE INTO career_applications (id, job_id, applicant_name, student_no, gpa, cv_summary, status, applied_at) VALUES
  (1, 1, 'م. يزن عبد الرحمن القاسم', 'CYB-2022-0014', 94.6, 'الأول على الدفعة، خبرة في إدارة جدران الحماية وتحليل البرمجيات الخبيثة.', 'مقبول', 1761400000000),
  (2, 2, 'أ. ريم محمود السعدي', 'LAW-2022-0008', 91.2, 'مشروع تخرج متميز في الإثبات الجنائي الرقمي.', 'مقابلة', 1761400000000);

INSERT OR IGNORE INTO qa_kpis (id, code, title, standard_domain, target_value, actual_value, unit, status, academic_year, updated_at) VALUES
  (1, 'KPI-ACA-01', 'نسبة التزام المقررات بالتوصيف الأكاديمي المعياري', 'الجودة التعليمية والمناهج', 95, 96.5, '%', 'متحقق', '2026/2027', 1761400000000),
  (2, 'KPI-STU-02', 'معدل رضا الطلاب عن الخدمات الرقمية وسرعة إنجاز المعاملات', 'الخدمات الطلابية والتحول الرقمي', 90, 94.2, '%', 'متحقق', '2026/2027', 1761400000000),
  (3, 'KPI-RES-03', 'معدل النشر العلمي السنوي لكل عضو هيئة تدريس', 'البحث العلمي والابتكار', 2.0, 1.8, 'بحث/عضو', 'قيد التحسين', '2026/2027', 1761400000000),
  (4, 'KPI-EMP-04', 'نسبة توظيف الخريجين خلال 6 أشهر من التخرج', 'مخرجات التعلم وسوق العمل', 85, 89.0, '%', 'متحقق', '2026/2027', 1761400000000);

INSERT OR IGNORE INTO qa_surveys (id, course_code, course_name, instructor_name, semester, responses_count, content_score, teaching_score, assessment_score, overall_score, notes, created_at) VALUES
  (1, 'CYB-101', 'مبادئ الأمن السيبراني والتشفير', 'أ.د. مازن الحسن', 'الفصل الأول 2026/2027', 112, 4.8, 4.9, 4.7, 4.8, 'إشادة واسعة بالتطبيقات العملية في المختبر.', 1761400000000),
  (2, 'LAW-201', 'القانون الجنائي والأدلة الرقمية', 'د. سمر العبدالله', 'الفصل الأول 2026/2027', 89, 4.6, 4.7, 4.5, 4.6, 'مطالبة بزيادة دراسات الحالة الواقعية.', 1761400000000),
  (3, 'NET-302', 'أمن الشبكات وبروتوكولات الاتصال', 'د. طارق منصور', 'الفصل الأول 2026/2027', 74, 4.4, 4.5, 4.2, 4.4, 'مستوى أسئلة الامتحان العملي متقدم ويحتاج وقتاً إضافياً.', 1761400000000);

INSERT OR IGNORE INTO qa_accreditations (id, program_name, agency_name, standard_code, self_study_progress, audit_date, status, notes, created_at) VALUES
  (1, 'بكالوريوس هندسة الأمن السيبراني', 'مجلس الاعتماد الأكاديمي وضمان الجودة (ABET-Aligned)', 'STD-CYB-2026', 95, '2026-12-10', 'معتمد', 'تم استيفاء جميع معايير المختبرات ومخرجات التعلم.', 1761400000000),
  (2, 'بكالوريوس الحقوق والعلوم الشرطية', 'الهيئة الوطنية للجودة والاعتماد المؤسسي', 'STD-LAW-2026', 88, '2027-01-20', 'قيد المراجعة', 'جارٍ استكمال أرشفة ملفات المقررات الإلكترونية.', 1761400000000);

INSERT OR IGNORE INTO exam_schedules (id, course_code, course_name, program_name, exam_type, exam_date, start_time, end_time, hall_name, capacity, enrolled_count, proctor_name, status, created_at) VALUES
  (1, 'CYB-101', 'مبادئ الأمن السيبراني والتشفير', 'هندسة الأمن السيبراني', 'نهائي', '2026-11-15', '09:00', '11:00', 'المدرج الرئيسي A1', 120, 95, 'د. طارق منصور + م. حسام العلي', 'مجدول', 1761400000000),
  (2, 'LAW-201', 'القانون الجنائي والأدلة الرقمية', 'الحقوق والعلوم الشرطية', 'نهائي', '2026-11-17', '11:30', '13:30', 'قاعة المؤتمرات B2', 80, 68, 'د. سمر العبدالله', 'مجدول', 1761400000000),
  (3, 'NET-302', 'أمن الشبكات وبروتوكولات الاتصال', 'هندسة الأمن السيبراني', 'عملي', '2026-11-19', '10:00', '12:00', 'مختبر الأمن السيبراني المتقدم L1', 40, 36, 'د. خالد الشامي', 'مجدول', 1761400000000);

INSERT OR IGNORE INTO grade_appeals (id, student_no, student_name, course_code, course_name, old_mark, new_mark, reason, committee_note, status, created_at, decided_at) VALUES
  (1, 'CYB-2026-0001', 'أحمد محمد العلي', 'NET-302', 'أمن الشبكات وبروتوكولات الاتصال', 78, 84, 'مراجعة جمع درجات السؤال العملي الثالث في ورقة الإجابة.', 'تمت إعادة جمع الجزئيات وتبين وجود 6 درجات غير مرحّلة في السؤال الثالث.', 'مقبول وتعديل العلامة', 1761400000000, 1761450000000),
  (2, 'LAW-2026-0002', 'نور الهدى الخطيب', 'LAW-201', 'القانون الجنائي والأدلة الرقمية', 71, NULL, 'الاعتراض على تقدير درجة السؤال المقالي الثاني.', 'أحيلت الورقة إلى لجنة التدقيق الثلاثية في القسم.', 'قيد اللجنة', 1761420000000, NULL);

INSERT OR IGNORE INTO office_hour_bookings (id, faculty_name, student_name, student_no, slot_day, slot_time, topic, status, created_at) VALUES
  (1, 'أ.د. مازن الحسن', 'أحمد محمد العلي', 'CYB-2026-0001', 'الأحد', '10:30 - 11:00', 'مناقشة خطة مشروع التخرج في كشف التسلل السيبراني', 'مؤكد', 1761400000000),
  (2, 'د. سمر العبدالله', 'نور الهدى الخطيب', 'LAW-2026-0002', 'الثلاثاء', '11:00 - 11:30', 'استشارة أكاديمية حول مراجع البحث القانوني', 'مؤكد', 1761410000000);

INSERT OR IGNORE INTO faculty_promotions (id, faculty_name, specialty, current_rank, target_rank, research_points, required_points, teaching_years, committee_status, submitted_at) VALUES
  (1, 'د. طارق منصور', 'أمن الشبكات والأنظمة الموزعة', 'أستاذ مساعد', 'أستاذ مشارك', 112.5, 100, 5, 'مستوفٍ للشروط', 1761400000000),
  (2, 'د. سمر العبدالله', 'القانون الجنائي الرقمي', 'مدرّس', 'أستاذ مساعد', 78.0, 80, 4, 'قيد التحكيم العلمي', 1761410000000);

INSERT OR IGNORE INTO dorm_rooms (id, building_name, room_no, floor_no, capacity, occupied, room_type, annual_fee, status) VALUES
  (1, 'السكن الجامعي - جناح الفارابي (طلاب)', 'A-101', 1, 2, 2, 'مزدوجة', 1200000, 'ممتلئة'),
  (2, 'السكن الجامعي - جناح الفارابي (طلاب)', 'A-102', 1, 2, 1, 'مزدوجة', 1200000, 'متاحة'),
  (3, 'السكن الجامعي - جناح زنوبيا (طالبات)', 'B-201', 2, 2, 1, 'مزدوجة', 1200000, 'متاحة'),
  (4, 'سكن الدراسات العليا والباحثين', 'C-301', 3, 1, 0, 'فردية', 2000000, 'متاحة');

INSERT OR IGNORE INTO dorm_allocations (id, room_id, student_name, student_no, faculty_name, check_in_date, academic_year, payment_status, status) VALUES
  (1, 1, 'أحمد محمد العلي', 'CYB-2026-0001', 'كلية هندسة الأمن السيبراني', '2026-09-15', '2026/2027', 'مسدد', 'ساكن'),
  (2, 3, 'نور الهدى الخطيب', 'LAW-2026-0002', 'كلية الحقوق والعلوم الشرطية', '2026-09-16', '2026/2027', 'إعفاء', 'ساكن');

INSERT OR IGNORE INTO scholarships (id, student_name, student_no, program_name, scholarship_type, discount_percent, amount_covered, academic_year, status, created_at) VALUES
  (1, 'أحمد محمد العلي', 'CYB-2026-0001', 'هندسة الأمن السيبراني', 'تفوق أكاديمي (المركز الأول)', 100, 3500000, '2026/2027', 'مفعّلة', 1761400000000),
  (2, 'نور الهدى الخطيب', 'LAW-2026-0002', 'الحقوق والعلوم الشرطية', 'منحة تفوق علمي', 50, 1500000, '2026/2027', 'مفعّلة', 1761400000000);

INSERT OR IGNORE INTO student_activities (id, club_name, title, category, event_date, location, supervisor_name, participants_count, budget, status) VALUES
  (1, 'نادي الأمن السيبراني والمسابقات البرمجية', 'الهاكاثون الوطني للدفاع السيبراني CTF 2026', 'علمي', '2026-11-10', 'القاعة المتعددة الأغراض', 'أ.د. مازن الحسن', 85, 12000000, 'قادم'),
  (2, 'العيادة القانونية الطلابية', 'ورشة المحاكمة الصورية والتحقيق الرقمي', 'ثقافي', '2026-11-05', 'مدرج كلية الحقوق', 'د. سمر العبدالله', 48, 4500000, 'قادم');

INSERT OR IGNORE INTO hr_appraisals (id, employee_name, department, period_label, punctuality_score, productivity_score, teamwork_score, overall_score, recommendation, evaluator_name, created_at) VALUES
  (1, 'سامر الكردي', 'مديرية شؤون الطلاب', 'التقييم السنوي 2026', 95, 94, 93, 94.0, 'علاوة دورية + مكافأة تميز', 'مدير الموارد البشرية', 1761400000000),
  (2, 'رنا الحسيني', 'مديرية الشؤون المالية', 'التقييم السنوي 2026', 92, 90, 91, 91.0, 'علاوة دورية', 'مدير الموارد البشرية', 1761400000000);

INSERT OR IGNORE INTO hr_trainings (id, title, trainer_name, target_department, start_date, hours_count, enrolled_count, status) VALUES
  (1, 'أمن المعلومات وحماية البيانات الشخصية للعاملين', 'أ.د. مازن الحسن', 'جميع الإدارات', '2026-11-02', 16, 42, 'مفتوح للتسجيل'),
  (2, 'الأرشفة الرقمية الموقعة ومعايير PDF/A-2b', 'م. وائل درويش', 'شؤون الطلاب والامتحانات', '2026-11-12', 12, 18, 'قيد التنفيذ');

INSERT OR IGNORE INTO hr_biometric_devices (id, device_code, location, ip_address, protocol, last_sync_at, logs_synced, status) VALUES
  (1, 'BIO-GATE-01', 'البوابة الرئيسية - مبنى رئاسة الجامعة', '10.10.4.21', 'ZKTeco ADMS Push v3.2', 1761460000000, 1480, 'متصل'),
  (2, 'BIO-FAC-02', 'بهو كلية هندسة الأمن السيبراني', '10.10.4.22', 'ZKTeco ADMS Push v3.2', 1761460000000, 920, 'متصل'),
  (3, 'BIO-ADM-03', 'مبنى الشؤون الإدارية والمالية', '10.10.4.23', 'ZKTeco ADMS Push v3.2', 1761460000000, 645, 'متصل');

INSERT OR IGNORE INTO infra_settings (key, value_json, updated_at) VALUES
  ('db_engine', '{"active":"sqlite_wal","pgHost":"pg-cluster.uni.internal","pgPort":5432,"pgDatabase":"uni_erp_prod","poolMax":25,"readReplicas":2,"autoFailover":true}', 1761400000000),
  ('redis_cluster', '{"enabled":true,"mode":"hybrid_memory_redis","url":"redis://redis-cache.uni.internal:6379","sessionTtlSec":28800,"rateLimitWindowMs":60000,"hitRatio":98.4}', 1761400000000),
  ('sso_auth', '{"ldapEnabled":true,"ldapUrl":"ldaps://dc01.uni.edu.sy:636","microsoftEntraEnabled":true,"googleWorkspaceEnabled":true,"enforceMfaForAdmins":true}', 1761400000000);

INSERT OR IGNORE INTO ai_early_warnings (id, student_no, student_name, program_name, gpa, attendance_rate, failed_courses, risk_level, ai_diagnosis, ai_action_plan, advisor_status, analyzed_at) VALUES
  (1, 'CYB-2026-0003', 'كريم سامر الدالاتي', 'هندسة الأمن السيبراني', 61.5, 68, 2, 'حرج', 'انخفاض حاد في نسبة الحضور (68%) مع تعثر في مقرري الشبكات والتشفير وتأخر في إرجاع استعارات المكتبة.', '1) جلسة إرشاد أكاديمي عاجلة خلال 48 ساعة. 2) تخفيف العبء الدراسي إلى 14 ساعة. 3) إلحاق الطالب بمجموعات التقوية العملية.', 'تم إشعار المرشد الأكاديمي', 1761400000000),
  (2, 'LAW-2026-0005', 'وسيم فادي المالح', 'الحقوق والعلوم الشرطية', 69.0, 77, 1, 'متوسط', 'تراجع طفيف في علامات أعمال السنة (69%) مع غياب متقطع في المحاضرات الصباحية.', '1) متابعة نصف شهرية من المرشد الأكاديمي. 2) جدولة ساعات مكتبية مع مدرس المقرر.', 'بانتظار المتابعة', 1761400000000),
  (3, 'CYB-2026-0001', 'أحمد محمد العلي', 'هندسة الأمن السيبراني', 93.8, 97, 0, 'آمن', 'أداء أكاديمي ممتاز والتزام كامل بالحضور والمشاريع العملية.', 'ترشيح الطالب لمنحة التفوق البحثي ومسابقة الأمن السيبراني الوطنية.', 'مكتمل', 1761400000000);

INSERT OR IGNORE INTO ai_triage_logs (id, source_type, sender_name, subject, body_text, ai_category, ai_priority, target_unit, ai_summary, ai_draft_reply, created_at) VALUES
  (1, 'شكوى طلابية', 'كريم سامر الدالاتي', 'تعارض في موعد امتحان مقرر الشبكات مع الامتحان العملي', 'يرجى معالجة تداخل موعد الامتحان العملي لمقرر أمن الشبكات مع الفترة الثانية لامتحان التشفير في نفس اليوم.', 'امتحانات وجداول دراسية', 'عاجل جداً', 'مكتب الامتحانات وشؤون الطلاب', 'تداخل زمني بين امتحانين لطالب في المستوى الثالث يتطلب تعديل الفترة أو القاعة.', 'نشكر تواصلكم. تمت مراجعة جدول الامتحانات من قبل لجنة الجداول وتعديل موعد الجلسة العملية إلى اليوم التالي الساعة 10:00 صباحاً لمنع أي تعارض.', 1761400000000),
  (2, 'مراسلة إدارية', 'رئيس قسم هندسة الأمن السيبراني', 'طلب تأمين تجهيزات خوادم لمختبر التحقيق الجنائي الرقمي', 'نرجو الموافقة على توريد 10 محطات عمل عالية الأداء لتشغيل برمجيات تحليل الذاكرة الجنائية للفصل القادم.', 'مشتريات وتجهيزات مخبرية', 'مرتفع', 'مديرية المشتريات والمخازن', 'طلب توريد 10 محطات عمل لمختبر التحقيق الجنائي قبل بداية الفصل.', 'تم استلام المذكرة وإحالتها إلى دائرة المشتريات لإدراجها ضمن خطة التوريد العاجلة وفحص الاعتماد المالي.', 1761410000000);
