-- تنظيف بنية البيانات قبل إدخال البيانات الحقيقية

-- 1. جدول واحد للاختبارات: lms_quizzes، وتسليماتها في lms_quiz_submissions
ALTER TABLE lms_quizzes ADD COLUMN instructor_name TEXT NOT NULL DEFAULT '';
ALTER TABLE lms_quizzes ADD COLUMN legacy_online_id BIGINT;
INSERT INTO lms_quizzes (course_code, course_name, title, instructor_name, duration_min, total_marks, questions_json, attempts_count, avg_score, published, created_at, legacy_online_id)
  SELECT course_code, course_name, title, instructor_name, COALESCE(duration_min, 30), COALESCE(total_marks, 20), replace(questions_json, '"answer"', '"ans"'), 0, 0,
         CASE WHEN status = 'نشط' THEN 1 ELSE 0 END, created_at, id
  FROM online_quizzes;
UPDATE online_quiz_submissions s SET quiz_id = q.id FROM lms_quizzes q WHERE s.source = 'online' AND q.legacy_online_id = s.quiz_id;
DELETE FROM online_quiz_submissions a USING online_quiz_submissions b
  WHERE a.quiz_id = b.quiz_id AND a.student_no = b.student_no AND (a.submitted_at > b.submitted_at OR (a.submitted_at = b.submitted_at AND a.id > b.id));
DROP INDEX IF EXISTS idx_quiz_submissions_source;
ALTER TABLE online_quiz_submissions DROP COLUMN source;
ALTER TABLE online_quiz_submissions RENAME TO lms_quiz_submissions;
CREATE UNIQUE INDEX uq_lms_quiz_submission ON lms_quiz_submissions(quiz_id, student_no);
ALTER TABLE lms_quizzes DROP COLUMN legacy_online_id;
DROP TABLE online_quizzes;

-- 2. سداد القسط يمر بدفتر المالية
ALTER TABLE student_fee_installments ADD COLUMN fin_charge_id BIGINT REFERENCES fin_charges(id) ON DELETE SET NULL;
ALTER TABLE student_fee_installments ADD COLUMN fin_payment_id BIGINT REFERENCES fin_payments(id) ON DELETE SET NULL;

-- 3. المبالغ بنوع دقيق بدل الفاصلة العائمة
ALTER TABLE dorm_rooms ALTER COLUMN annual_fee TYPE NUMERIC(16,2) USING ROUND(annual_fee::numeric, 2);
ALTER TABLE faculty_overload_records ALTER COLUMN hourly_rate TYPE NUMERIC(16,2) USING ROUND(hourly_rate::numeric, 2);
ALTER TABLE faculty_overload_records ALTER COLUMN total_overload_pay TYPE NUMERIC(16,2) USING ROUND(total_overload_pay::numeric, 2);
ALTER TABLE fin_fee_structures ALTER COLUMN tuition_fee TYPE NUMERIC(16,2) USING ROUND(tuition_fee::numeric, 2);
ALTER TABLE fin_fee_structures ALTER COLUMN registration_fee TYPE NUMERIC(16,2) USING ROUND(registration_fee::numeric, 2);
ALTER TABLE fin_fee_structures ALTER COLUMN total_fee TYPE NUMERIC(16,2) USING ROUND(total_fee::numeric, 2);
ALTER TABLE hr_absences ALTER COLUMN daily_rate TYPE NUMERIC(16,2) USING ROUND(daily_rate::numeric, 2);
ALTER TABLE hr_absences ALTER COLUMN total_deduction TYPE NUMERIC(16,2) USING ROUND(total_deduction::numeric, 2);
ALTER TABLE hr_advances ALTER COLUMN amount TYPE NUMERIC(16,2) USING ROUND(amount::numeric, 2);
ALTER TABLE hr_advances ALTER COLUMN monthly_installment TYPE NUMERIC(16,2) USING ROUND(monthly_installment::numeric, 2);
ALTER TABLE hr_advances ALTER COLUMN remaining_amount TYPE NUMERIC(16,2) USING ROUND(remaining_amount::numeric, 2);
ALTER TABLE hr_employees ALTER COLUMN housing_allowance TYPE NUMERIC(16,2) USING ROUND(housing_allowance::numeric, 2);
ALTER TABLE hr_employees ALTER COLUMN transport_allowance TYPE NUMERIC(16,2) USING ROUND(transport_allowance::numeric, 2);
ALTER TABLE hr_employees ALTER COLUMN insurance_amount TYPE NUMERIC(16,2) USING ROUND(insurance_amount::numeric, 2);
ALTER TABLE hr_employees ALTER COLUMN tax_amount TYPE NUMERIC(16,2) USING ROUND(tax_amount::numeric, 2);
ALTER TABLE hr_leaves ALTER COLUMN unpaid_deduction TYPE NUMERIC(16,2) USING ROUND(unpaid_deduction::numeric, 2);
ALTER TABLE hr_signed_payslips ALTER COLUMN basic_salary TYPE NUMERIC(16,2) USING ROUND(basic_salary::numeric, 2);
ALTER TABLE hr_signed_payslips ALTER COLUMN overload_pay TYPE NUMERIC(16,2) USING ROUND(overload_pay::numeric, 2);
ALTER TABLE hr_signed_payslips ALTER COLUMN allowances TYPE NUMERIC(16,2) USING ROUND(allowances::numeric, 2);
ALTER TABLE hr_signed_payslips ALTER COLUMN deductions TYPE NUMERIC(16,2) USING ROUND(deductions::numeric, 2);
ALTER TABLE hr_signed_payslips ALTER COLUMN net_salary TYPE NUMERIC(16,2) USING ROUND(net_salary::numeric, 2);
ALTER TABLE research_projects ALTER COLUMN budget TYPE NUMERIC(16,2) USING ROUND(budget::numeric, 2);
ALTER TABLE sa_scholarships ALTER COLUMN amount TYPE NUMERIC(16,2) USING ROUND(amount::numeric, 2);
ALTER TABLE scholarships ALTER COLUMN amount_covered TYPE NUMERIC(16,2) USING ROUND(amount_covered::numeric, 2);
ALTER TABLE student_activities ALTER COLUMN budget TYPE NUMERIC(16,2) USING ROUND(budget::numeric, 2);
ALTER TABLE student_fee_installments ALTER COLUMN amount TYPE NUMERIC(16,2) USING ROUND(amount::numeric, 2);
ALTER TABLE student_fee_installments ALTER COLUMN paid_amount TYPE NUMERIC(16,2) USING ROUND(paid_amount::numeric, 2);

-- 4. قيود الربط بالطالب. NOT VALID يفرضها على الجديد ولا يحذف قديماً لا يطابق.
-- لا تشمل alumni_records وcareer_applications وpostgrad_theses وlibrary_loans: قد تخص من لا حساب له في النظام
-- عند حذف الطالب: تُحذف سجلاته التشغيلية، ويُمنع الحذف إن كان له أثر مالي أو أكاديمي
ALTER TABLE ai_early_warnings ADD CONSTRAINT fk_warnings_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;
ALTER TABLE office_hour_bookings ADD CONSTRAINT fk_bookings_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;
ALTER TABLE lms_quiz_submissions ADD CONSTRAINT fk_submissions_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;
ALTER TABLE student_self_enrollments ADD CONSTRAINT fk_selfenroll_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;
ALTER TABLE dorm_allocations ADD CONSTRAINT fk_dorm_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE grade_appeals ADD CONSTRAINT fk_appeals_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE scholarships ADD CONSTRAINT fk_scholarships_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE student_fee_installments ADD CONSTRAINT fk_installments_student FOREIGN KEY (student_no) REFERENCES users(student_no) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
