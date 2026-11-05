-- ربط ما بقي من سجلات الطلاب بحساباتهم. NOT VALID يفرضه على الجديد ولا يحذف قديمًا.
-- لا تشمل alumni_records وcareer_applications وpostgrad_theses وlibrary_loans: قد تخص من لا حساب له.
ALTER TABLE lms_quiz_attempts ADD CONSTRAINT fk_attempts_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;
ALTER TABLE sa_card_activity_logs ADD CONSTRAINT fk_cardlogs_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;

-- فهارس مطابقة تمامًا لفهرس آخر على الجدول نفسه: تبطئ الكتابة ولا تفيد القراءة
DROP INDEX IF EXISTS idx_hc_corr_events_doc_id;
DROP INDEX IF EXISTS idx_hc_fin_lines_acc_entry;
DROP INDEX IF EXISTS idx_hf_requests_unit_status_created;
DROP INDEX IF EXISTS idx_profiles_program;
DROP INDEX IF EXISTS idx_perf_corr_notifs_user_unread;
DROP INDEX IF EXISTS idx_hf_corr_notifs_user_read_at;
DROP INDEX IF EXISTS idx_hc_requests_status_created;
DROP INDEX IF EXISTS idx_courses_program_level;
DROP INDEX IF EXISTS idx_hc_requests_service_status;
DROP INDEX IF EXISTS idx_requests_student;
DROP INDEX IF EXISTS idx_perf_profiles_national_id;
DROP INDEX IF EXISTS idx_holds_student;
