# 06. مخططات الكيانات والعلاقات

استُخرجت من بيانات تعريف قاعدة التطوير المحلية بعد تطبيق كل الترحيلات، وليست من قاعدة الإنتاج. تظهر العلاقات المعرّفة فعليًا بقيود `FOREIGN KEY`، والخطوط المتقطعة في آخر الملف علاقات نصية لا يحميها أي قيد.

لتسهيل القراءة يعرض كل كيان المفتاح الأساسي والمفاتيح الأجنبية وحتى خمسة أعمدة أخرى. الأعمدة كاملة في [05-database-analysis.md](05-database-analysis.md).

## الهوية والصلاحيات والنظام (21 جدولًا)

```mermaid
erDiagram
  users ||--o{ import_batches : "undone_by"
  users ||--o{ import_batches : "user_id"
  import_batches ||--o{ import_changes : "batch_id"
  users ||--o{ import_staging : "user_id"
  import_staging ||--o{ import_staging_chunks : "token_hash"
  org_units ||--o{ org_units : "parent_id"
  users ||--o{ push_subscriptions : "user_id"
  service_types ||--o{ rules : "service_code"
  users ||--o{ sessions : "user_id"
  org_units ||--o{ unit_links : "from_unit"
  org_units ||--o{ unit_links : "to_unit"
  roles ||--o{ users : "role_key"
  org_units ||--o{ users : "unit_id"
  audit_log {
    bigint id PK
    bigint at
    bigint actor_id
    text actor_label
    text role
    text action
  }
  devops_incident_reports {
    bigint id PK
    text report_code
    text source
    text event_type
    text severity
    text file_path
  }
  encrypted_snapshots {
    bigint id PK
    text snapshot_code
    text label
    text schedule_type
    text cipher_algo
    text sha256_hash
  }
  idempotency_keys {
    text key PK
    bigint entry_id
    bigint created_at
  }
  import_batches {
    bigint id PK
    bigint user_id FK
    bigint undone_by FK
    text kind
    text filename
    text file_sha256
    text status
    bigint created_at
  }
  import_changes {
    bigint id PK
    bigint batch_id FK
    text table_name
    text pk_json
    text op
    text before_json
    text after_hash
  }
  import_staging {
    text token_hash PK
    bigint user_id FK
    text kind
    text filename
    text file_sha256
    bigint total_rows
    bigint created_at
  }
  import_staging_chunks {
    text token_hash PK
    bigint seq PK
    text rows_json
  }
  infra_settings {
    text key PK
    text value_json
    bigint updated_at
  }
  multi_channel_notifications {
    bigint id PK
    text title
    text body
    text target_audience
    text channels
    text priority
  }
  offline_sync_batches {
    bigint id PK
    text batch_code
    text committee_name
    text hall_code
    text course_code
    bigint records_count
  }
  org_units {
    bigint id PK
    bigint parent_id FK
    text name
    text kind
    bigint active
    text code
    text description
  }
  push_subscriptions {
    bigint id PK
    bigint user_id FK
    text endpoint
    text p256dh
    text auth
    text ua
    bigint created_at
  }
  roles {
    text key PK
    text label
    text description
    text permissions_json
    bigint active
    bigint created_at
  }
  rules {
    bigint id PK
    text service_code FK
    text kind
    text params_json
    text message
    bigint enabled
  }
  schema_migrations {
    text name PK
    bigint applied_at
  }
  service_types {
    text code PK
    text label
    text description
    bigint sla_hours
    bigint requires_attachment
    bigint issues_document
  }
  sessions {
    text token_hash PK
    bigint user_id FK
    bigint created_at
    bigint expires_at
    text ip
    text user_agent
    text fingerprint
  }
  site_settings {
    text key PK
    text value
  }
  unit_links {
    bigint id PK
    bigint from_unit FK
    bigint to_unit FK
    bigint two_way
    bigint created_at
  }
  users {
    bigint id PK
    bigint unit_id FK
    text role_key FK
    text username
    text display_name
    text password_hash
    text role
    text student_no
  }
```

## الطلاب والقبول والخدمات (35 جدولًا)

```mermaid
erDiagram
  requests ||--o{ academic_request_details : "request_id"
  courses ||--o{ academic_request_details : "target_course_id"
  programs ||--o{ academic_request_details : "target_program_id"
  requests ||--o{ attachments : "request_id"
  users ||--o{ card_batches : "created_by"
  card_batches ||--o{ card_handovers : "batch_id"
  users ||--o{ card_handovers : "handed_by"
  users ||--o{ card_handovers : "student_id"
  career_jobs ||--o{ career_applications : "job_id"
  users ||--o{ complaints : "responded_by"
  users ||--o{ complaints : "student_id"
  documents ||--o{ document_pdfs : "code"
  users ||--o{ documents : "issued_by"
  requests ||--o{ documents : "request_id"
  dorm_rooms ||--o{ dorm_allocations : "room_id"
  users ||--o{ news : "created_by"
  news ||--o{ news_media : "news_id"
  requests ||--o{ request_events : "request_id"
  org_units ||--o{ requests : "assigned_unit_id"
  users ||--o{ requests : "decided_by"
  service_types ||--o{ requests : "service_code"
  users ||--o{ requests : "student_id"
  users ||--o{ student_certs : "student_id"
  users ||--o{ student_file_meta : "audited_by"
  users ||--o{ student_file_meta : "student_id"
  users ||--o{ student_file_meta : "updated_by"
  users ||--o{ student_files : "created_by"
  users ||--o{ student_files : "student_id"
  student_groups ||--o{ student_group_members : "group_id"
  users ||--o{ student_group_members : "student_id"
  programs ||--o{ student_groups : "program_id"
  users ||--o{ student_holds : "created_by"
  users ||--o{ student_holds : "student_id"
  users ||--o{ student_profiles : "created_by"
  programs ||--o{ student_profiles : "program_id"
  users ||--o{ student_profiles : "user_id"
  academic_request_details {
    bigint request_id PK
    bigint target_program_id FK
    bigint target_course_id FK
    text request_category
    bigint target_grade_id
    bigint claimed_mark
    text violation_type
    text justification
  }
  alumni_records {
    bigint id PK
    text student_no
    text full_name
    text faculty_name
    text program_name
    bigint grad_year
  }
  attachments {
    bigint id PK
    bigint request_id FK
    text orig_name
    text stored_name
    text mime
    bigint size
    text sha256
  }
  card_batches {
    bigint id PK
    bigint created_by FK
    text label
    text filter_json
    bigint created_at
  }
  card_handovers {
    bigint id PK
    bigint batch_id FK
    bigint student_id FK
    bigint handed_by FK
    bigint received_at
    text receiver_name
    text note
  }
  career_applications {
    bigint id PK
    bigint job_id FK
    text applicant_name
    text student_no
    double gpa
    text cv_summary
    text status
  }
  career_jobs {
    bigint id PK
    text title
    text company_name
    text sector
    text location
    text job_type
  }
  complaints {
    bigint id PK
    bigint student_id FK
    bigint responded_by FK
    text no
    text subject
    text body
    text status
    text response
  }
  document_pdfs {
    text pdf_sha256 PK
    text code FK
    bigint created_at
  }
  documents {
    bigint id PK
    bigint request_id FK
    bigint issued_by FK
    text code
    bigint issued_at
    text payload_json
    text content_hash
    text signature
  }
  dorm_allocations {
    bigint id PK
    bigint room_id FK
    text student_name
    text student_no
    text faculty_name
    text check_in_date
    text academic_year
  }
  dorm_rooms {
    bigint id PK
    text building_name
    text room_no
    bigint floor_no
    bigint capacity
    bigint occupied
  }
  news {
    bigint id PK
    bigint created_by FK
    text title
    text body
    bigint pinned
    bigint published_at
  }
  news_media {
    bigint id PK
    bigint news_id FK
    text kind
    text source
    text file
    text mime
    bigint size
  }
  office_hour_bookings {
    bigint id PK
    text faculty_name
    text student_name
    text student_no
    text slot_day
    text slot_time
  }
  request_events {
    bigint id PK
    bigint request_id FK
    bigint at
    text actor_label
    text text
  }
  requests {
    bigint id PK
    bigint student_id FK
    text service_code FK
    bigint decided_by FK
    bigint assigned_unit_id FK
    text no
    text details_json
    text status
    text reject_reason
    text rejected_by
  }
  sa_advising_warnings {
    bigint id PK
    bigint student_id
    text warning_type
    text severity
    double gpa_snapshot
    double absence_rate
  }
  sa_applicants {
    bigint id PK
    text application_no
    text full_name
    text national_id
    text phone
    text hs_type
  }
  sa_card_activity_logs {
    bigint id PK
    bigint student_id
    text student_no
    text student_name
    text event_type
    text location_name
  }
  sa_course_prerequisites {
    bigint id PK
    bigint course_id
    bigint prereq_course_id
    double min_mark
  }
  sa_credit_equivalences {
    bigint id PK
    bigint student_id
    text source_university
    text external_course_code
    text external_course_name
    bigint external_hours
  }
  sa_desk_appointments {
    bigint id PK
    text ticket_no
    bigint student_id
    bigint request_id
    text service_purpose
    text appointment_date
  }
  sa_disciplinary_details {
    bigint id PK
    bigint hold_id
    bigint student_id
    text committee_decision_no
    text violation_category
    text penalty_level
  }
  sa_lifecycle_movements {
    bigint id PK
    text movement_no
    bigint student_id
    text movement_type
    text academic_year
    bigint semester
  }
  sa_scholarships {
    bigint id PK
    text grant_no
    bigint student_id
    text scholarship_type
    double discount_percent
    double amount
  }
  scholarships {
    bigint id PK
    text student_name
    text student_no
    text program_name
    text scholarship_type
    bigint discount_percent
  }
  student_activities {
    bigint id PK
    text club_name
    text title
    text category
    text event_date
    text location
  }
  student_certs {
    bigint id PK
    bigint student_id FK
    text code
    text payload_json
    text payload_sha256
    text pdf_sha256
    text file
  }
  student_file_meta {
    bigint student_id PK
    bigint audited_by FK
    bigint updated_by FK
    text general_notes
    text box_no
    text dossier_no
    text cert_notes
    text exception_note
  }
  student_files {
    bigint id PK
    bigint student_id FK
    bigint created_by FK
    text kind
    text file
    text orig_name
    text mime
    bigint size
  }
  student_group_members {
    bigint id PK
    bigint group_id FK
    bigint student_id FK
    bigint added_at
  }
  student_groups {
    bigint id PK
    bigint program_id FK
    text name
    text kind
    text notes
    bigint created_at
    bigint updated_at
  }
  student_holds {
    bigint id PK
    bigint student_id FK
    bigint created_by FK
    text hold_type
    text note
    bigint active
    bigint created_at
    bigint cleared_at
  }
  student_profiles {
    bigint user_id PK
    bigint program_id FK
    bigint created_by FK
    text first_name
    text father_name
    text last_name
    text mother_name
    text name_en
  }
```

## الأكاديمي والامتحانات والتعلم (29 جدولًا)

```mermaid
erDiagram
  courses ||--o{ course_schedules : "course_id"
  faculty_members ||--o{ courses : "member_id"
  programs ||--o{ courses : "program_id"
  org_units ||--o{ faculty_members : "unit_id"
  users ||--o{ faculty_members : "user_id"
  users ||--o{ grade_changes : "actor_id"
  users ||--o{ grades : "approved_by"
  courses ||--o{ grades : "course_id"
  users ||--o{ grades : "entered_by"
  users ||--o{ grades : "reviewed_by"
  users ||--o{ grades : "student_id"
  courses ||--o{ hall_logs : "course_id"
  users ||--o{ hall_logs : "recorded_by"
  users ||--o{ hall_logs : "student_id"
  library_books ||--o{ library_loans : "book_id"
  lms_lectures ||--o{ lms_lecture_files : "lecture_id"
  faculties ||--o{ programs : "faculty_id"
  ai_advisor_chats {
    bigint id PK
    text user_label
    text question
    text answer
    text model_used
    bigint created_at
  }
  ai_early_warnings {
    bigint id PK
    text student_no
    text student_name
    text program_name
    double gpa
    bigint attendance_rate
  }
  ai_triage_logs {
    bigint id PK
    text source_type
    text sender_name
    text subject
    text body_text
    text ai_category
  }
  course_schedules {
    bigint id PK
    bigint course_id FK
    bigint day
    bigint start_min
    bigint end_min
    text hall
    bigint group_id
  }
  courses {
    bigint id PK
    bigint program_id FK
    bigint member_id FK
    bigint level
    bigint semester
    text name
    text code
    bigint hours
  }
  exam_schedules {
    bigint id PK
    text course_code
    text course_name
    text program_name
    text exam_type
    text exam_date
  }
  faculties {
    bigint id PK
    text name
    text name_en
    text code
    text kind
    bigint active
  }
  faculty_members {
    bigint id PK
    bigint unit_id FK
    bigint user_id FK
    text name
    text rank
    text specialty
    text email
    text phone
  }
  faculty_overload_records {
    bigint id PK
    text instructor_name
    text academic_rank
    text faculty_name
    bigint quorum_hours
    bigint actual_teaching_hours
  }
  faculty_promotions {
    bigint id PK
    text faculty_name
    text specialty
    text current_rank
    text target_rank
    double research_points
  }
  grade_appeals {
    bigint id PK
    text student_no
    text student_name
    text course_code
    text course_name
    double old_mark
  }
  grade_changes {
    bigint id PK
    bigint actor_id FK
    bigint grade_id
    bigint student_id
    text course
    text action
    bigint old_total
  }
  grades {
    bigint id PK
    bigint student_id FK
    bigint course_id FK
    bigint entered_by FK
    bigint reviewed_by FK
    bigint approved_by FK
    text term
    text course
    bigint hours
    bigint mark
    bigint level
  }
  hall_logs {
    bigint id PK
    bigint student_id FK
    bigint course_id FK
    bigint recorded_by FK
    text kind
    text subject
    text hall
    bigint entered_at
    bigint exited_at
  }
  library_books {
    bigint id PK
    text isbn
    text title
    text author
    text category
    bigint publish_year
  }
  library_loans {
    bigint id PK
    bigint book_id FK
    text borrower_name
    text borrower_no
    text loan_date
    text due_date
    text return_date
  }
  lms_lecture_files {
    bigint id PK
    bigint lecture_id FK
    text filename
    text kind
    text mime
    bigint size
    text file
  }
  lms_lectures {
    bigint id PK
    text course_code
    text course_name
    text title
    text kind
    bigint week_no
  }
  lms_quizzes {
    bigint id PK
    text course_code
    text course_name
    text title
    bigint duration_min
    bigint total_marks
  }
  online_quiz_submissions {
    bigint id PK
    bigint quiz_id
    text student_no
    text student_name
    double score
    bigint total_marks
  }
  online_quizzes {
    bigint id PK
    text course_code
    text course_name
    text title
    text instructor_name
    bigint duration_min
  }
  postgrad_theses {
    bigint id PK
    text student_no
    text student_name
    text degree
    text program_name
    text title
  }
  programs {
    bigint id PK
    bigint faculty_id FK
    text faculty
    text name
    text degree
    bigint years
    bigint active
  }
  qa_accreditations {
    bigint id PK
    text program_name
    text agency_name
    text standard_code
    bigint self_study_progress
    text audit_date
  }
  qa_kpis {
    bigint id PK
    text code
    text title
    text standard_domain
    double target_value
    double actual_value
  }
  qa_surveys {
    bigint id PK
    text course_code
    text course_name
    text instructor_name
    text semester
    bigint responses_count
  }
  research_projects {
    bigint id PK
    text code
    text title
    text principal_investigator
    text faculty_name
    text domain
  }
  smart_schedule_slots {
    bigint id PK
    text course_code
    text course_name
    text faculty_name
    text instructor_name
    text hall_code
  }
  student_self_enrollments {
    bigint id PK
    text student_no
    text student_name
    text course_code
    text course_name
    bigint credits
  }
```

## المالية (12 جدولًا)

```mermaid
erDiagram
  fin_accounts ||--o{ fin_accounts : "parent_id"
  users ||--o{ fin_charges : "created_by"
  fin_entries ||--o{ fin_charges : "entry_id"
  fin_fee_types ||--o{ fin_charges : "fee_type_id"
  users ||--o{ fin_charges : "student_id"
  org_units ||--o{ fin_cost_centers : "unit_id"
  users ||--o{ fin_entries : "created_by"
  users ||--o{ fin_entries : "posted_by"
  fin_entries ||--o{ fin_entries : "reversal_of"
  fin_entries ||--o{ fin_entries : "reversed_by"
  fin_years ||--o{ fin_entries : "year_id"
  fin_accounts ||--o{ fin_fee_types : "account_id"
  fin_accounts ||--o{ fin_lines : "account_id"
  fin_cost_centers ||--o{ fin_lines : "cost_center_id"
  fin_currencies ||--o{ fin_lines : "currency"
  fin_entries ||--o{ fin_lines : "entry_id"
  fin_parties ||--o{ fin_lines : "party_id"
  users ||--o{ fin_lines : "student_id"
  fin_accounts ||--o{ fin_parties : "account_id"
  fin_accounts ||--o{ fin_payments : "account_id"
  users ||--o{ fin_payments : "created_by"
  fin_entries ||--o{ fin_payments : "entry_id"
  users ||--o{ fin_payments : "student_id"
  users ||--o{ fin_years : "closed_by"
  fin_accounts {
    bigint id PK
    bigint parent_id FK
    text code
    text name
    text type
    bigint postable
    bigint active
  }
  fin_charges {
    bigint id PK
    bigint student_id FK
    bigint fee_type_id FK
    bigint entry_id FK
    bigint created_by FK
    bigint amount
    text due_day
    text academic_year
    text note
    text status
  }
  fin_cost_centers {
    bigint id PK
    bigint unit_id FK
    text code
    text name
    bigint active
  }
  fin_currencies {
    text code PK
    text name
    text symbol
    double rate
    bigint is_base
    bigint active
  }
  fin_entries {
    bigint id PK
    bigint year_id FK
    bigint reversal_of FK
    bigint reversed_by FK
    bigint created_by FK
    bigint posted_by FK
    text type
    bigint seq
    text no
    text entry_day
    text description
  }
  fin_fee_structures {
    bigint id PK
    bigint program_id
    text academic_year
    bigint semester
    double tuition_fee
    double registration_fee
  }
  fin_fee_types {
    bigint id PK
    bigint account_id FK
    text code
    text name
    text kind
    bigint default_amount
    bigint active
  }
  fin_lines {
    bigint id PK
    bigint entry_id FK
    bigint account_id FK
    text currency FK
    bigint cost_center_id FK
    bigint party_id FK
    bigint student_id FK
    bigint line_no
    bigint debit
    bigint credit
    double rate
    bigint fc_amount
  }
  fin_parties {
    bigint id PK
    bigint account_id FK
    text kind
    text name
    text phone
    text email
    text notes
  }
  fin_payments {
    bigint id PK
    bigint student_id FK
    bigint account_id FK
    bigint entry_id FK
    bigint created_by FK
    text receipt_no
    bigint amount
    text method
    text paid_day
    text note
  }
  fin_years {
    bigint id PK
    bigint closed_by FK
    text name
    text start_day
    text end_day
    text status
    bigint closed_at
  }
  student_fee_installments {
    bigint id PK
    text installment_code
    text student_no
    text student_name
    text faculty_name
    bigint installment_no
  }
```

## الموارد البشرية (16 جدولًا)

```mermaid
erDiagram
  hr_employees ||--o{ hr_absences : "employee_id"
  hr_employees ||--o{ hr_advances : "employee_id"
  users ||--o{ hr_contracts : "created_by"
  hr_employees ||--o{ hr_contracts : "employee_id"
  org_units ||--o{ hr_employees : "unit_id"
  users ||--o{ hr_leaves : "created_by"
  hr_employees ||--o{ hr_leaves : "employee_id"
  users ||--o{ hr_leaves : "reviewed_by"
  hr_employees ||--o{ hr_monthly_attendance : "employee_id"
  users ||--o{ hr_salaries : "created_by"
  hr_employees ||--o{ hr_salaries : "employee_id"
  users ||--o{ leave_entitlements : "user_id"
  requests ||--o{ leave_records : "request_id"
  users ||--o{ leave_records : "user_id"
  users ||--o{ staff_attendance : "user_id"
  hr_absences {
    bigint id PK
    bigint employee_id FK
    text reason
    bigint absence_days
    double daily_rate
    double total_deduction
    text month
  }
  hr_advances {
    bigint id PK
    bigint employee_id FK
    text advance_code
    text advance_date
    double amount
    bigint installments_count
    bigint paid_installments
  }
  hr_alert_settings {
    text key PK
    text value
    text label
    text category
    text unit
    bigint updated_at
  }
  hr_appraisals {
    bigint id PK
    text employee_name
    text department
    text period_label
    bigint punctuality_score
    bigint productivity_score
  }
  hr_biometric_devices {
    bigint id PK
    text device_code
    text location
    text ip_address
    text protocol
    bigint last_sync_at
  }
  hr_contracts {
    bigint id PK
    bigint employee_id FK
    bigint created_by FK
    text contract_type
    text title
    text start_date
    text end_date
    bigint salary
  }
  hr_employees {
    bigint id PK
    bigint unit_id FK
    text employeeno
    text name
    text personalid
    text email
    text phone
  }
  hr_leaves {
    bigint id PK
    bigint employee_id FK
    bigint created_by FK
    bigint reviewed_by FK
    text leave_type
    text status
    text start_date
    text end_date
    bigint days
  }
  hr_monthly_attendance {
    bigint id PK
    bigint employee_id FK
    text month
    bigint work_days_month
    bigint actual_days
    bigint late_days
    double late_hours
  }
  hr_salaries {
    bigint id PK
    bigint employee_id FK
    bigint created_by FK
    bigint amount
    bigint effective_at
    bigint created_at
    text ip
  }
  hr_signed_payslips {
    bigint id PK
    text payslip_code
    text employee_code
    text employee_name
    text department
    text month_label
  }
  hr_system_lookups {
    bigint id PK
    text category
    text label
    bigint sort_order
    bigint active
  }
  hr_trainings {
    bigint id PK
    text title
    text trainer_name
    text target_department
    text start_date
    bigint hours_count
  }
  leave_entitlements {
    bigint user_id PK
    bigint year PK
    double days
  }
  leave_records {
    bigint id PK
    bigint user_id FK
    bigint request_id FK
    bigint year
    text type
    text from_day
    text to_day
    bigint days
  }
  staff_attendance {
    bigint user_id PK
    text day PK
    bigint check_in
    bigint check_out
  }
```

## المشتريات والمخازن (14 جدولًا)

```mermaid
erDiagram
  proc_assets ||--o{ proc_asset_moves : "asset_id"
  proc_warehouses ||--o{ proc_asset_moves : "from_wh"
  users ||--o{ proc_asset_moves : "moved_by"
  proc_warehouses ||--o{ proc_asset_moves : "to_wh"
  proc_suppliers ||--o{ proc_assets : "supplier_id"
  proc_warehouses ||--o{ proc_assets : "warehouse_id"
  proc_issues ||--o{ proc_issue_lines : "issue_id"
  proc_items ||--o{ proc_issue_lines : "item_id"
  users ||--o{ proc_issues : "created_by"
  proc_warehouses ||--o{ proc_issues : "warehouse_id"
  proc_categories ||--o{ proc_items : "category_id"
  proc_warehouses ||--o{ proc_items : "warehouse_id"
  proc_items ||--o{ proc_order_lines : "item_id"
  proc_orders ||--o{ proc_order_lines : "order_id"
  users ||--o{ proc_orders : "created_by"
  proc_requests ||--o{ proc_orders : "request_id"
  proc_suppliers ||--o{ proc_orders : "supplier_id"
  proc_items ||--o{ proc_receipt_lines : "item_id"
  proc_receipts ||--o{ proc_receipt_lines : "receipt_id"
  users ||--o{ proc_receipts : "created_by"
  proc_orders ||--o{ proc_receipts : "order_id"
  proc_items ||--o{ proc_request_lines : "item_id"
  proc_requests ||--o{ proc_request_lines : "request_id"
  users ||--o{ proc_requests : "decided_by"
  users ||--o{ proc_requests : "requester_id"
  proc_warehouses ||--o{ proc_requests : "warehouse_id"
  users ||--o{ proc_warehouses : "manager_id"
  proc_asset_moves {
    bigint id PK
    bigint asset_id FK
    bigint from_wh FK
    bigint to_wh FK
    bigint moved_by FK
    text kind
    text to_user
    text reason
    bigint moved_at
  }
  proc_assets {
    bigint id PK
    bigint warehouse_id FK
    bigint supplier_id FK
    text code
    text name
    text category
    text status
    text purchase_day
  }
  proc_categories {
    bigint id PK
    text code
    text name
    bigint active
  }
  proc_issue_lines {
    bigint id PK
    bigint issue_id FK
    bigint item_id FK
    bigint qty
  }
  proc_issues {
    bigint id PK
    bigint warehouse_id FK
    bigint created_by FK
    text no
    text issued_to
    text purpose
    bigint issued_at
    bigint created_at
  }
  proc_items {
    bigint id PK
    bigint category_id FK
    bigint warehouse_id FK
    text code
    text name
    text unit
    bigint qty_on_hand
    bigint avg_cost
  }
  proc_order_lines {
    bigint id PK
    bigint order_id FK
    bigint item_id FK
    text description
    bigint qty
    bigint unit_cost
    bigint line_total
  }
  proc_orders {
    bigint id PK
    bigint request_id FK
    bigint supplier_id FK
    bigint created_by FK
    text no
    text status
    bigint total_amount
    bigint ordered_at
    bigint received_at
  }
  proc_receipt_lines {
    bigint id PK
    bigint receipt_id FK
    bigint item_id FK
    bigint qty
    bigint unit_cost
  }
  proc_receipts {
    bigint id PK
    bigint order_id FK
    bigint created_by FK
    bigint received_at
    text note
    bigint created_at
    text import_ref
    bigint reversed_at
  }
  proc_request_lines {
    bigint id PK
    bigint request_id FK
    bigint item_id FK
    text description
    bigint qty
    bigint est_cost
    text note
  }
  proc_requests {
    bigint id PK
    bigint requester_id FK
    bigint warehouse_id FK
    bigint decided_by FK
    text no
    text title
    text description
    text status
    bigint requested_at
  }
  proc_suppliers {
    bigint id PK
    text code
    text name
    text phone
    text email
    text address
  }
  proc_warehouses {
    bigint id PK
    bigint manager_id FK
    text code
    text name
    text location
    bigint active
    bigint created_at
  }
```

## المراسلات (7 جدولًا)

```mermaid
erDiagram
  corr_docs ||--o{ corr_approvers : "doc_id"
  users ||--o{ corr_approvers : "user_id"
  corr_docs ||--o{ corr_cc : "doc_id"
  users ||--o{ corr_cc : "user_id"
  users ||--o{ corr_docs : "creator_id"
  org_units ||--o{ corr_docs : "unit_id"
  corr_docs ||--o{ corr_events : "doc_id"
  corr_docs ||--o{ corr_files : "doc_id"
  corr_docs ||--o{ corr_notifs : "doc_id"
  users ||--o{ corr_notifs : "user_id"
  corr_approvers {
    bigint id PK
    bigint doc_id FK
    bigint user_id FK
    bigint seq
    text state
    bigint at
    text note
  }
  corr_cc {
    bigint doc_id PK
    bigint user_id PK
  }
  corr_docs {
    bigint id PK
    bigint creator_id FK
    bigint unit_id FK
    text no
    text title
    text subject
    text body
    text mode
  }
  corr_events {
    bigint id PK
    bigint doc_id FK
    bigint at
    text kind
    bigint actor_id
    text actor_label
    text text
  }
  corr_files {
    bigint id PK
    bigint doc_id FK
    text orig_name
    text stored_name
    text mime
    bigint size
    text sha256
  }
  corr_notifs {
    bigint id PK
    bigint user_id FK
    bigint doc_id FK
    text text
    bigint at
    bigint read
  }
  corr_templates {
    text code PK
    text name
    text category
    text title
    text subject
    text body
  }
```

## علاقات نصية بلا قيد

هذه الجداول تربط الطالب برقمه الجامعي `student_no` نصًا، ولا تحوي `student_id`، فلا يمنع شيء من وجود سجل يتيم أو خطأ عند تغيّر الرقم.

```mermaid
erDiagram
  users ||..o{ ai_early_warnings : "student_no نصي"
  users ||..o{ alumni_records : "student_no نصي"
  users ||..o{ career_applications : "student_no نصي"
  users ||..o{ dorm_allocations : "student_no نصي"
  users ||..o{ grade_appeals : "student_no نصي"
  users ||..o{ office_hour_bookings : "student_no نصي"
  users ||..o{ online_quiz_submissions : "student_no نصي"
  users ||..o{ postgrad_theses : "student_no نصي"
  users ||..o{ scholarships : "student_no نصي"
  users ||..o{ student_fee_installments : "student_no نصي"
  users ||..o{ student_self_enrollments : "student_no نصي"
```

وهذه أعمدة تنتهي بـ`_id` وتبدو مراجع، لكن لا يحميها قيد مفتاح أجنبي: `academic_request_details.target_grade_id`، `audit_log.actor_id`، `corr_events.actor_id`، `course_schedules.group_id`، `exam_schedules.group_id`، `fin_fee_structures.program_id`، `grade_appeals.grade_id`، `grade_changes.grade_id`، `grade_changes.student_id`، `idempotency_keys.entry_id`، `online_quiz_submissions.quiz_id`، `sa_advising_warnings.student_id`، `sa_applicants.national_id`، `sa_applicants.pref1_program_id`، `sa_applicants.pref2_program_id`، `sa_applicants.pref3_program_id`، `sa_applicants.accepted_program_id`، `sa_applicants.enrolled_student_id`، `sa_card_activity_logs.student_id`، `sa_card_activity_logs.terminal_id`، `sa_course_prerequisites.course_id`، `sa_course_prerequisites.prereq_course_id`، `sa_credit_equivalences.student_id`، `sa_credit_equivalences.internal_course_id`، `sa_desk_appointments.student_id`، `sa_desk_appointments.request_id`، `sa_disciplinary_details.hold_id`، `sa_disciplinary_details.student_id`، `sa_lifecycle_movements.student_id`، `sa_lifecycle_movements.from_program_id`، `sa_lifecycle_movements.to_program_id`، `sa_scholarships.student_id`، `sa_scholarships.fin_charge_id`، `student_profiles.national_id`.
