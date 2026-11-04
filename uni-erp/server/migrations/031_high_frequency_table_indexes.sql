-- =====================================================================
-- 031_high_frequency_table_indexes.sql
-- فهارس شاملة للجداول عالية التردد (الهوية، الوحدات التنظيمية، الطلبات، المراسلات، المالية، الموارد البشرية، وشؤون الطلاب)
-- مصممة لتقليل زمن الاستجابة تحت الضغط العالي (10,000+ مستخدم متزامن)
-- =====================================================================

-- 1. الهوية، المستخدمون، الأدوار، والوحدات التنظيمية (Identity & Org Hierarchy)
CREATE INDEX IF NOT EXISTS idx_hf_users_username_nocase ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_hf_users_unit_active ON users(unit_id, active, role);
CREATE INDEX IF NOT EXISTS idx_hf_users_role_key_active ON users(role_key, active);
CREATE INDEX IF NOT EXISTS idx_hf_org_units_parent_active ON org_units(parent_id, active);
CREATE INDEX IF NOT EXISTS idx_hf_org_units_kind_active ON org_units(kind, active);
CREATE INDEX IF NOT EXISTS idx_hf_unit_links_from_two ON unit_links(from_unit, to_unit, two_way);
CREATE INDEX IF NOT EXISTS idx_hf_unit_links_to_two ON unit_links(to_unit, two_way, from_unit);
CREATE INDEX IF NOT EXISTS idx_hf_roles_active_created ON roles(active, created_at);

-- 2. الطلبات، أحداث الطلبات، المرفقات، والذمم الطلابية (Requests & Workflows)
CREATE INDEX IF NOT EXISTS idx_hf_requests_unit_status_created ON requests(assigned_unit_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_requests_student_status_service ON requests(student_id, status, service_code);
CREATE INDEX IF NOT EXISTS idx_hf_request_events_req_id ON request_events(request_id, id);
CREATE INDEX IF NOT EXISTS idx_hf_attachments_req_id ON attachments(request_id, id);
CREATE INDEX IF NOT EXISTS idx_hf_student_holds_student_active ON student_holds(student_id, active);
CREATE INDEX IF NOT EXISTS idx_hf_student_holds_active_id ON student_holds(active, id DESC);
CREATE INDEX IF NOT EXISTS idx_hf_academic_req_details_req ON academic_request_details(request_id);

-- 3. الديوان والمراسلات الداخلية والمرفقات والإشعارات (Correspondence)
CREATE INDEX IF NOT EXISTS idx_hf_corr_docs_unit_status ON corr_docs(unit_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_corr_docs_out_year_no ON corr_docs(out_year, out_no);
CREATE INDEX IF NOT EXISTS idx_hf_corr_files_doc_id ON corr_files(doc_id, id);
CREATE INDEX IF NOT EXISTS idx_hf_corr_notifs_user_read_at ON corr_notifs(user_id, read, at DESC);

-- 4. المالية والمحاسبة والقيود والرسوم والإيصالات (Finance & Accounting)
CREATE INDEX IF NOT EXISTS idx_hf_fin_entries_year_type_seq ON fin_entries(year_id, type, seq DESC);
CREATE INDEX IF NOT EXISTS idx_hf_fin_lines_cc_entry ON fin_lines(cost_center_id, entry_id) WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hf_fin_charges_due_status ON fin_charges(status, due_day);
CREATE INDEX IF NOT EXISTS idx_hf_fin_charges_entry ON fin_charges(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hf_fin_payments_day_status ON fin_payments(status, paid_day DESC);
CREATE INDEX IF NOT EXISTS idx_hf_fin_payments_entry ON fin_payments(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hf_fin_years_status_days ON fin_years(status, start_day, end_day);
CREATE INDEX IF NOT EXISTS idx_hf_fin_accounts_type_postable ON fin_accounts(type, postable, active);

-- 5. شؤون الموظفين والموارد البشرية والرواتب (HR & Payroll)
CREATE INDEX IF NOT EXISTS idx_hf_hr_emp_dept_status ON hr_employees(department_name, status);
CREATE INDEX IF NOT EXISTS idx_hf_hr_salaries_emp_eff ON hr_salaries(employee_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_hr_leaves_emp_status ON hr_leaves(employee_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_hf_hr_contracts_emp_end ON hr_contracts(employee_id, end_date DESC);
CREATE INDEX IF NOT EXISTS idx_hf_hr_absences_emp_month ON hr_absences(employee_id, month_code);
CREATE INDEX IF NOT EXISTS idx_hf_hr_lookups_cat_active ON hr_system_lookups(category, active, sort_order);

-- 6. منظومة شؤون الطلاب المتكاملة والقبول والإرشاد والمنح (Student Affairs Suite)
CREATE INDEX IF NOT EXISTS idx_hf_sa_applicants_status_score ON sa_applicants(sorting_status, hs_score DESC);
CREATE INDEX IF NOT EXISTS idx_hf_sa_applicants_nid ON sa_applicants(national_id);
CREATE INDEX IF NOT EXISTS idx_hf_sa_equiv_student_status ON sa_credit_equivalences(student_id, equivalence_status);
CREATE INDEX IF NOT EXISTS idx_hf_sa_prereq_course ON sa_course_prerequisites(course_id, prereq_course_id);
CREATE INDEX IF NOT EXISTS idx_hf_sa_warnings_student_status ON sa_advising_warnings(student_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_sa_movements_student_created ON sa_lifecycle_movements(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_sa_scholarships_student_status ON sa_scholarships(student_id, status);
CREATE INDEX IF NOT EXISTS idx_hf_sa_appointments_status_date ON sa_desk_appointments(queue_status, appointment_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_sa_appointments_student ON sa_desk_appointments(student_id, created_at DESC);

-- 7. الامتحانات، التعلم الإلكتروني، المكتبة، الخريجون، والتطوير المؤسسي (V12 & Enterprise)
CREATE INDEX IF NOT EXISTS idx_hf_exam_schedules_date_hall ON exam_schedules(exam_date, hall_name);
CREATE INDEX IF NOT EXISTS idx_hf_grade_appeals_status_created ON grade_appeals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hf_library_loans_status_book ON library_loans(status, book_id);
CREATE INDEX IF NOT EXISTS idx_hf_lms_lectures_course_week ON lms_lectures(course_code, week_no);
CREATE INDEX IF NOT EXISTS idx_hf_student_installments_stu_status ON student_fee_installments(student_no, status);
CREATE INDEX IF NOT EXISTS idx_hf_self_enrollments_stu_sem ON student_self_enrollments(student_no, semester);
CREATE INDEX IF NOT EXISTS idx_hf_quiz_submissions_quiz_stu ON online_quiz_submissions(quiz_id, student_no);
CREATE INDEX IF NOT EXISTS idx_hf_devops_incidents_status_created ON devops_incident_reports(status, severity, created_at DESC);
