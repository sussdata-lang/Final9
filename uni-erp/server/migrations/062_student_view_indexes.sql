-- شاشات الطالب تقرأ سجلاته فقط بدل كامل الجدول
CREATE INDEX IF NOT EXISTS idx_grade_appeals_student_no ON grade_appeals(student_no);
CREATE INDEX IF NOT EXISTS idx_office_bookings_student_no ON office_hour_bookings(student_no);
CREATE INDEX IF NOT EXISTS idx_dorm_allocations_student_no ON dorm_allocations(student_no);
CREATE INDEX IF NOT EXISTS idx_library_loans_borrower ON library_loans(borrower_no);
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_student_no ON lms_quiz_submissions(student_no);
CREATE INDEX IF NOT EXISTS idx_lms_lectures_published_week ON lms_lectures(published, week_no);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_date ON exam_schedules(exam_date);
CREATE INDEX IF NOT EXISTS idx_fin_charges_fee_type ON fin_charges(fee_type_id, status);
