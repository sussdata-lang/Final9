-- ============================================================================
-- 032_perf_boost.sql — تحسينات أداء متقدمة للتعامل مع 10,000+ مستخدم متزامن
-- ============================================================================

-- ===== 1. تحسين PRAGMA لـ WAL وزيادة الصفحات =====
PRAGMA wal_autocheckpoint = 4000;
PRAGMA cache_size = -131072;

-- ===== 2. Indexes إضافية لشؤون الطلاب (الأكثر بطئاً) =====

-- البحث بالاسم الثلاثي (الأكثر استخداماً)
CREATE INDEX IF NOT EXISTS idx_perf_profiles_fullname
  ON student_profiles(first_name, father_name, last_name);

-- البحث برقم الهوية
CREATE INDEX IF NOT EXISTS idx_perf_profiles_national_id
  ON student_profiles(national_id);

-- الطلاب النشطون مرتبون بالإنشاء (قائمة الطلاب الافتراضية)
CREATE INDEX IF NOT EXISTS idx_perf_profiles_status_created
  ON student_profiles(status, created_at DESC, user_id DESC);

-- فلترة متعددة (الكلية + السنة + الحالة)
CREATE INDEX IF NOT EXISTS idx_perf_profiles_program_level_status
  ON student_profiles(program_id, study_level, status);

-- ===== 3. Indexes للعلامات والدرجات =====

-- البحث عن علامات طالب بسنة دراسية
CREATE INDEX IF NOT EXISTS idx_perf_grades_student_year_status
  ON grades(student_id, academic_year, workflow_status);

-- ===== 4. Indexes للطلبات والمعاملات =====

-- الطلبات النشطة مرتبة بالتاريخ (الصفحة الرئيسية للمستخدم)
CREATE INDEX IF NOT EXISTS idx_perf_requests_student_status_date
  ON requests(student_id, status, created_at DESC);

-- طلبات الوحدة الإدارية
CREATE INDEX IF NOT EXISTS idx_perf_requests_unit_status_date
  ON requests(assigned_unit_id, status, created_at DESC);

-- ===== 5. Indexes للمراسلات =====

-- إشعارات المستخدم غير المقروءة
CREATE INDEX IF NOT EXISTS idx_perf_corr_notifs_user_unread
  ON corr_notifs(user_id, read, at DESC);

-- ===== 6. Indexes للجلسات (تسريع التحقق من الجلسة في كل طلب) =====

-- البحث برمز الجلسة + صلاحيتها (يُستدعى في كل طلب API)
CREATE INDEX IF NOT EXISTS idx_perf_sessions_token_valid
  ON sessions(token_hash, expires_at, user_id);

-- ===== 7. Indexes للعمليات المالية عالية التردد =====

-- الرسوم المستحقة لطالب محدد
CREATE INDEX IF NOT EXISTS idx_perf_fin_charges_student_status_due
  ON fin_charges(student_id, status, due_day);

-- المدفوعات حسب الطالب
CREATE INDEX IF NOT EXISTS idx_perf_fin_payments_student_day
  ON fin_payments(student_id, paid_day DESC);

-- ===== 8. تحسين الإحصاءات للمخطط =====
ANALYZE student_profiles;
ANALYZE users;
ANALYZE grades;
ANALYZE requests;
ANALYZE sessions;
ANALYZE fin_charges;
ANALYZE fin_payments;
ANALYZE corr_docs;
ANALYZE corr_notifs;
