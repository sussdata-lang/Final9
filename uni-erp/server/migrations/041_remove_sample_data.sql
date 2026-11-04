-- إزالة السجلات النموذجية التي زرعتها الترحيلات والكود دون إدخال من مستخدم.
-- كل حذف يطابق بصمة الصف المزروع نفسه (الرمز مع الطابع الزمني الثابت أو النص الأصلي)؛ ما أدخله المستخدم أو عدّل مفتاحه يبقى.
-- الأب لا يُحذف إذا بقي له سجل فعلي يعتمد عليه.

-- الترحيل 025
DELETE FROM lms_lectures WHERE id IN (1, 2, 3, 4) AND created_at IN (1761400000000, 1761410000000, 1761420000000, 1761430000000) AND course_code IN ('CYB-101', 'LAW-201', 'NET-302');
DELETE FROM lms_quizzes WHERE id IN (1, 2) AND created_at IN (1761400000000, 1761410000000) AND course_code IN ('CYB-101', 'LAW-201');
DELETE FROM library_loans WHERE id IN (1, 2, 3) AND created_at = 1761400000000 AND borrower_no IN ('CYB-2026-0001', 'LAW-2026-0002', 'CYB-2026-0003');
DELETE FROM library_books WHERE id IN (1, 2, 3, 4) AND created_at = 1761400000000 AND isbn IN ('978-9933-10-401-2', '978-9933-10-402-9', '978-9933-10-403-6', '978-9933-10-404-3')
  AND NOT EXISTS (SELECT 1 FROM library_loans l WHERE l.book_id = library_books.id);
DELETE FROM research_projects WHERE created_at = 1761400000000 AND code IN ('RES-2026-01', 'RES-2026-02', 'RES-2026-03');
DELETE FROM postgrad_theses WHERE created_at = 1761400000000 AND student_no IN ('PG-2025-0012', 'PG-2024-0004', 'PG-2026-0019');
DELETE FROM alumni_records WHERE created_at = 1761400000000 AND student_no IN ('CYB-2022-0014', 'LAW-2022-0008', 'CYB-2021-0031');
DELETE FROM career_applications WHERE applied_at = 1761400000000 AND student_no IN ('CYB-2022-0014', 'LAW-2022-0008');
DELETE FROM career_jobs WHERE id IN (1, 2, 3) AND created_at = 1761400000000 AND company_name IN ('مركز أمن المعلومات الوطني', 'هيئة التطوير التشريعي والرقمي', 'مختبرات الابتكار التقني')
  AND NOT EXISTS (SELECT 1 FROM career_applications a WHERE a.job_id = career_jobs.id);
DELETE FROM qa_kpis WHERE updated_at = 1761400000000 AND code IN ('KPI-ACA-01', 'KPI-STU-02', 'KPI-RES-03', 'KPI-EMP-04');
DELETE FROM qa_surveys WHERE id IN (1, 2, 3) AND created_at = 1761400000000 AND course_code IN ('CYB-101', 'LAW-201', 'NET-302');
DELETE FROM qa_accreditations WHERE created_at = 1761400000000 AND standard_code IN ('STD-CYB-2026', 'STD-LAW-2026');
DELETE FROM exam_schedules WHERE id IN (1, 2, 3) AND created_at = 1761400000000 AND course_code IN ('CYB-101', 'LAW-201', 'NET-302');
DELETE FROM grade_appeals WHERE id IN (1, 2) AND created_at IN (1761400000000, 1761420000000) AND student_no IN ('CYB-2026-0001', 'LAW-2026-0002');
DELETE FROM office_hour_bookings WHERE id IN (1, 2) AND created_at IN (1761400000000, 1761410000000) AND student_no IN ('CYB-2026-0001', 'LAW-2026-0002');
DELETE FROM faculty_promotions WHERE id IN (1, 2) AND submitted_at IN (1761400000000, 1761410000000) AND faculty_name IN ('د. طارق منصور', 'د. سمر العبدالله');
DELETE FROM dorm_allocations WHERE id IN (1, 2) AND student_no IN ('CYB-2026-0001', 'LAW-2026-0002') AND check_in_date IN ('2026-09-15', '2026-09-16');
DELETE FROM dorm_rooms WHERE id IN (1, 2, 3, 4) AND room_no IN ('A-101', 'A-102', 'B-201', 'C-301')
  AND building_name IN ('السكن الجامعي - جناح الفارابي (طلاب)', 'السكن الجامعي - جناح زنوبيا (طالبات)', 'سكن الدراسات العليا والباحثين')
  AND NOT EXISTS (SELECT 1 FROM dorm_allocations a WHERE a.room_id = dorm_rooms.id);
DELETE FROM scholarships WHERE id IN (1, 2) AND created_at = 1761400000000 AND student_no IN ('CYB-2026-0001', 'LAW-2026-0002');
DELETE FROM student_activities WHERE id IN (1, 2) AND title IN ('الهاكاثون الوطني للدفاع السيبراني CTF 2026', 'ورشة المحاكمة الصورية والتحقيق الرقمي');
DELETE FROM hr_appraisals WHERE id IN (1, 2) AND created_at = 1761400000000 AND employee_name IN ('سامر الكردي', 'رنا الحسيني');
DELETE FROM hr_trainings WHERE id IN (1, 2) AND title IN ('أمن المعلومات وحماية البيانات الشخصية للعاملين', 'الأرشفة الرقمية الموقعة ومعايير PDF/A-2b');
DELETE FROM hr_biometric_devices WHERE id IN (1, 2, 3) AND device_code IN ('BIO-GATE-01', 'BIO-FAC-02', 'BIO-ADM-03');
DELETE FROM infra_settings WHERE updated_at = 1761400000000 AND key IN ('db_engine', 'redis_cluster', 'sso_auth');
DELETE FROM ai_early_warnings WHERE id IN (1, 2, 3) AND analyzed_at = 1761400000000 AND student_no IN ('CYB-2026-0003', 'LAW-2026-0005', 'CYB-2026-0001');
DELETE FROM ai_triage_logs WHERE id IN (1, 2) AND created_at IN (1761400000000, 1761410000000) AND sender_name IN ('كريم سامر الدالاتي', 'رئيس قسم هندسة الأمن السيبراني');

-- الترحيلان 027 و035 وزرع لوحة DevOps
DELETE FROM devops_incident_reports WHERE report_code IN ('INC-2026-1001', 'INC-2026-1002', 'INC-2026-1003', 'INC-2026-1004', 'INC-2026-1005', 'INC-2026-1006', 'INC-2026-1007', 'INC-2026-1008')
  AND source IN ('DevOps Monitor', 'Storage Engine', 'Code Studio');
DELETE FROM sa_card_activity_logs WHERE student_no = 'CYB-2026-0001' AND pki_hash IN ('0x8f2a9c1e4d', '0x3c7b12aa9e', '0x99e120bc71', '0x55a6d38e02');

-- زرع الأنظمة الموسعة
DELETE FROM smart_schedule_slots WHERE status = 'معتمد' AND (course_code, instructor_name, hall_code, day_name) IN (
  ('CYB-301', 'أ.د. مازن الحسن', 'مدرج الفارابي A1', 'الأحد'),
  ('CYB-304', 'د. رامي الشامي', 'مخبر السيبراني L2', 'الأحد'),
  ('LAW-202', 'د. سمر العبدالله', 'مدرج ابن خلدون B1', 'الإثنين'),
  ('CYB-401', 'أ.د. مازن الحسن', 'قاعة الخوارزمي C3', 'الثلاثاء'),
  ('STR-105', 'د. لؤي المنصور', 'مدرج المتنبي D1', 'الأربعاء'));
DELETE FROM online_quiz_submissions WHERE student_no = 'CYB-2026-0001' AND answers_json = '[1,0,1]' AND score = 30;
DELETE FROM online_quizzes WHERE title IN ('الاختبار الفصلي المؤتمت الأول — التشفير والبنية PKI', 'اختبار الأدلة الجنائية الرقمية ومسرح الجريمة السيبراني')
  AND NOT EXISTS (SELECT 1 FROM online_quiz_submissions s WHERE s.quiz_id = online_quizzes.id);
DELETE FROM student_self_enrollments WHERE student_no = 'CYB-2026-0001' AND course_code IN ('CYB-301', 'CYB-304', 'CYB-308') AND prerequisite_code IN ('CYB-201', 'CYB-202', 'CYB-205');
DELETE FROM faculty_overload_records WHERE (instructor_name, total_overload_pay) IN (('أ.د. مازن الحسن', 1000000), ('د. سمر العبدالله', 600000), ('د. رامي الشامي', 510000), ('د. لؤي المنصور', 500000)) AND status = 'معتمد للرواتب';
DELETE FROM hr_signed_payslips WHERE payslip_code IN ('PAY-202610-001', 'PAY-202610-002', 'PAY-202610-003', 'PAY-202610-004') AND digital_signature IN ('SIG-PKI-9F8A7B6C5D4E3F2A1B', 'SIG-PKI-4C3B2A1908F7E6D5C4', 'SIG-PKI-7E6D5C4B3A291807F6', 'SIG-PKI-1A2B3C4D5E6F708192');
DELETE FROM student_fee_installments WHERE installment_code IN ('INST-2026-101', 'INST-2026-102', 'INST-2026-103', 'INST-2026-201', 'INST-2026-202') AND student_no IN ('CYB-2026-0001', 'LAW-2026-0002');
DELETE FROM multi_channel_notifications WHERE title IN ('بدء التسجيل الذاتي لمقررات الفصل الأول 2026/2027', 'إصدار قسائم رواتب شهر تشرين الأول الموقعة رقمياً') AND delivery_count IN (1420, 185);
DELETE FROM encrypted_snapshots WHERE snapshot_code IN ('SNAP-20261026-0000', 'SNAP-20261027-0600') AND size_kb IN (4820, 4965);
DELETE FROM offline_sync_batches WHERE batch_code = 'SYNC-OFF-101' AND committee_name = 'اللجنة الامتحانية الأولى - الأمن السيبراني';

-- زرع شؤون الطلاب
DELETE FROM sa_applicants WHERE application_no IN ('ADM-2026-0101', 'ADM-2026-0102', 'ADM-2026-0103', 'ADM-2026-0104', 'ADM-2026-0105') AND national_id IN ('01020034912', '01040088219', '02010099114', '04010077321', '01090044510');
DELETE FROM sa_credit_equivalences WHERE external_course_code IN ('CS101-DU', 'LAW102-DU', 'NET201-AU') AND decided_by IN ('اللجنة العلمية للمعادلة', 'رئيس القسم المختص');
DELETE FROM sa_advising_warnings WHERE (session_date, advisor_name) IN (('2026-10-20', 'د. سامر الرفاعي (المرشد الأكاديمي)'), ('2026-10-22', 'أ.د. محمود الزعبي'));
DELETE FROM sa_lifecycle_movements WHERE movement_no IN ('MOV-2026-001', 'MOV-2026-002') AND decision_no IN ('قرار مجلس كلية #412', 'قرار رئاسة الجامعة #108');
DELETE FROM sa_disciplinary_details WHERE committee_decision_no = 'DISC-2026-19' AND violation_category = 'attendance_breach';
DELETE FROM sa_scholarships WHERE grant_no IN ('SCH-2026-001', 'SCH-2026-002') AND fin_charge_id IS NULL AND approved_by IN ('رئاسة الجامعة — لجنة المنح', 'مديرية الشؤون المالية وشؤون الطلاب');
DELETE FROM sa_desk_appointments WHERE ticket_no IN ('Q-101', 'Q-102', 'Q-103') AND service_purpose IN ('استلام كشف علامات رسمي مصدق وموقع رقمياً', 'تسليم ثبوتيات معادلة المقررات ومطابقة الأصل', 'استلام البطاقة الجامعية الذكية وإفادة التأجيل الدراسي');

-- علامتان معتمدتان زُرعتا لأول طالب: طابع الإدخال والاعتماد متطابق بالمللي ثانية، وهذا لا يحدث في رصد فعلي
DELETE FROM grades WHERE academic_year = '2025-2026' AND term = 'الفصل الأول' AND workflow_status = 'approved' AND entered_by = 1 AND approved_by = 1 AND entered_at = approved_at
  AND ((mark = 88 AND theory_mark = 60 AND practical_mark = 28) OR (mark = 82 AND theory_mark = 56 AND practical_mark = 26));

-- المقررات المزروعة ومتطلباتها، ما لم يعتمد عليها سجل فعلي
DELETE FROM sa_course_prerequisites WHERE course_id IN (SELECT id FROM courses WHERE code IN ('CS101', 'LAW102', 'CS102', 'NET201', 'OS202', 'CRY301', 'DFIR302', 'CAP401'))
  AND prereq_course_id IN (SELECT id FROM courses WHERE code IN ('CS101', 'LAW102', 'CS102', 'NET201', 'OS202', 'CRY301', 'DFIR302', 'CAP401'));
DELETE FROM courses WHERE (code, name, instructor) IN (
    ('CS101', 'مدخل إلى الخوارزميات والبرمجة', 'د. رامي الشامي'),
    ('LAW102', 'المدخل إلى العلوم القانونية والأمنية', 'د. مازن العبدالله'),
    ('CS102', 'تراكيب البيانات والبرمجة المتقدمة', 'د. رامي الشامي'),
    ('NET201', 'أمن الشبكات وبروتوكولات الاتصال', 'د. سامر الرفاعي'),
    ('OS202', 'نظم التشغيل وأمن النواة', 'د. لؤي الخطيب'),
    ('CRY301', 'التشفير التطبيقي والبنية PKI', 'أ.د. محمود الزعبي'),
    ('DFIR302', 'التحقيق الجنائي الرقمي والاستجابة للحوادث', 'د. سامر الرفاعي'),
    ('CAP401', 'مشروع التخرج في الأمن السيبراني', 'لجنة الإشراف العلمي'))
  AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.course_id = courses.id)
  AND NOT EXISTS (SELECT 1 FROM course_schedules s WHERE s.course_id = courses.id)
  AND NOT EXISTS (SELECT 1 FROM hall_logs h WHERE h.course_id = courses.id)
  AND NOT EXISTS (SELECT 1 FROM academic_request_details d WHERE d.target_course_id = courses.id)
  AND NOT EXISTS (SELECT 1 FROM sa_credit_equivalences e WHERE e.internal_course_id = courses.id)
  AND NOT EXISTS (SELECT 1 FROM sa_course_prerequisites p WHERE p.course_id = courses.id OR p.prereq_course_id = courses.id);
