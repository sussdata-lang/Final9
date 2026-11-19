# 05. تحليل قاعدة البيانات

**المصدر:** بيانات التعريف من قاعدة التطوير المحلية `suss_dev` بعد تطبيق كل الترحيلات، بجلسة للقراءة فقط. لم تُقرأ أي صفوف بيانات ولم تُلمس قاعدة الإنتاج.

**ملاحظة:** مخطط الإنتاج متوقع أن يطابق هذا بعد نجاح الترحيلات، لكنه **UNVERIFIED**. وهناك جداول قد تختلف في الإنتاج إن فشل ترحيل قديم.

## الملخص

| البند | القيمة |
|---|---|
| المحرك | PostgreSQL. محليًا 17.11، والإنتاج **UNKNOWN** |
| الجداول | 134 |
| الأعمدة | 1,306 |
| المفاتيح الأجنبية | 142 |
| الفهارس | 393 |
| الترحيلات | 52 |
| أنواع الأعمدة | `text` 662، `bigint` 588، `double precision` 56 |
| جداول بلا مفتاح أساسي | 0 |

## الاتصال

| الجانب | التنفيذ | المرجع |
|---|---|---|
| برنامج التشغيل | `pg` | `db_worker.js:5` |
| ORM | لا يوجد | |
| الواجهة | متزامنة تشبه SQLite: `db.prepare(sql).get/all/run` | `db.js:1-11` |
| الآلية | خيط عامل مع `SharedArrayBuffer` و`Atomics.wait` | `db.js:123-176` |
| حجم المجمع | 20 اتصالًا لكل خيط | `db.js:119` |
| مهلة الاتصال | 10 ثوانٍ | `db_worker.js:21` |
| مهلة الاستعلام | 30 ثانية من جانب العميل فقط، ولا يُلغى الاستعلام | `db.js:149` |
| الحد الأقصى للنتيجة | 512 ميغابايت | `db_worker.js:55` |
| TLS | يُفعّل بحسب نص الرابط، ودون التحقق من الشهادة | `db.js:524-526` |
| ترجمة SQL | تعابير نمطية من صياغة SQLite إلى PostgreSQL | `db.js:40-370` |

### دورة حياة الاتصال والمعاملات

- `tx(db, fn)` ينفذ BEGIN وCOMMIT أو ROLLBACK على اتصال مثبت في العامل، `db_worker.js:35-52`.
- المعاملات المتداخلة تُعدّ بعمق ولا تُنشئ SAVEPOINT. فإن فشل استدعاء داخلي واستمر الخارجي بعد التقاط الخطأ، فإن PostgreSQL يعتبر المعاملة كلها فاشلة.
- كل كاتب خارج المعاملات يُنفذ على أي اتصال من المجمع.
- خيوط العمليات الثقيلة لها مجمعها الخاص، فالحد الأقصى النظري 20 × 3 = 60 اتصالًا. وحد `max_connections` في الإنتاج **UNKNOWN**.

### الترحيلات

تُطبّق تلقائيًا عند كل تشغيل، `db.js:566-675`.

| الملاحظة | الأثر |
|---|---|
| لا معاملة تغلف ملف الترحيل | فشل جزئي قد يترك الملف مطبقًا نصفيًا، ويعاد من أوله |
| تجاهل أخطاء «الكائن موجود» | يسهل إعادة التنفيذ، لكنه قد يخفي اختلاف بنية |
| لا ترحيلات عكسية | لا تراجع آلي |
| `start-cloud.js` يفتح القاعدة ثلاث مرات | `seed` ثم `structure` ثم الخادم، والفشل في الأولى يوقف الإقلاع |
| تعديل بيانات عند الإقلاع | `app.js:47-51` يعيد كتابة صلاحيات الأدوار الأساسية ما لم يتغير اسمها، و`app.js:77` يضبط `unit_id` الفارغ لكل المستخدمين بمن فيهم الطلاب |

**حادثة موثقة:** الترحيل `029` أعيدت تسميته، وبقاء الملف القديم أدى إلى صفين باسمين وتوقف الإقلاع. أُصلح في `7747c3a`.

### النسخ الاحتياطي

`services/backup.js` يولّد `pg_dump` ويضيف ملفات `data`، ويحفظ آخر 14 نسخة. التفاصيل في [13-infrastructure-and-deployment.md](13-infrastructure-and-deployment.md).

## جودة التصميم

### الأنواع

| المشكلة | الدليل | الأثر |
|---|---|---|
| لا `timestamp` أو `date` إطلاقًا | كل الأوقات `bigint` ميلي ثانية، وكل التواريخ `text` | لا تحقق من التاريخ، ولا دوال زمنية مباشرة |
| لا `boolean` ولا `numeric` | أنواع الأعمدة الثلاثة أعلاه فقط | القيم المنطقية 0 و1 |
| مبالغ بنوع `double precision` | 16 عمودًا | أخطاء تقريب ممكنة |
| JSON داخل `text` | `custom_permissions_json` و`payload_json` وغيرها | لا فهرسة ولا تحقق |

**المبالغ بنوع double:** `dorm_rooms.annual_fee`، `faculty_overload_records.total_overload_pay`، `fin_fee_structures.tuition_fee` و`registration_fee` و`total_fee`، `hr_absences.total_deduction`، `hr_advances.amount` و`remaining_amount`، `hr_employees.insurance_amount` و`tax_amount`، `hr_signed_payslips.basic_salary` و`net_salary`، `sa_scholarships.amount`، `scholarships.amount_covered`، `student_fee_installments.amount` و`paid_amount`.

في المقابل، `fin_charges` و`fin_payments` و`fin_lines` تخزن المبالغ بوحدة صغرى صحيحة، وهذا صحيح.

### أعمدة تبدو مراجع بلا قيد

34 عمودًا تنتهي بـ`_id` بلا مفتاح أجنبي. الأهم: `grade_changes.student_id` و`grade_changes.grade_id`، `grade_appeals.grade_id`، `sa_scholarships.student_id` و`fin_charge_id`، `sa_disciplinary_details.student_id`، `sa_lifecycle_movements.student_id`، `sa_advising_warnings.student_id`، `sa_credit_equivalences.student_id`، `sa_applicants.enrolled_student_id`، `audit_log.actor_id`، `course_schedules.group_id`، `exam_schedules.group_id`، `online_quiz_submissions.quiz_id`.

بعضها مقصود: مثل `audit_log.actor_id` كي يبقى السجل بعد حذف المستخدم. والقائمة كاملة في [06-database-er-diagram.md](06-database-er-diagram.md).

### ربط نصي بالطالب

11 جدولًا تربط الطالب بـ`student_no` نصًا فقط: `ai_early_warnings`، `alumni_records`، `career_applications`، `dorm_allocations`، `grade_appeals`، `office_hour_bookings`، `online_quiz_submissions`، `postgrad_theses`، `scholarships`، `student_fee_installments`، `student_self_enrollments`.

وكثير منها يخزن اسم الطالب نسخة أيضًا، فيخرج عن الحقيقة عند تعديله.

### فهارس ناقصة على المفاتيح الأجنبية

65 مفتاحًا أجنبيًا بلا فهرس يبدأ به. تأثيرها الفعلي يحتاج إحصاءات إنتاج، لكن الأولى بالفحص: `fin_charges.fee_type_id`، `fin_payments.account_id`، `library_loans.book_id`، `dorm_allocations.room_id`، `career_applications.job_id`، `corr_notifs.doc_id`، `proc_order_lines.item_id`، `proc_issue_lines.issue_id`، `proc_receipt_lines.receipt_id`، `programs.faculty_id`، `student_groups.program_id`.

### مخاطر الحذف المتتالي

30 مفتاحًا بـ`ON DELETE CASCADE`. الأخطر: حذف موظف من `hr_employees` يحذف عقوده ورواتبه وسلفه وغيابه وإجازاته ودوامه الشهري. وحذف غرفة يحذف تسكينها، وحذف كتاب يحذف إعاراته، وحذف طالب من `users` يحذف استلام بطاقته وعضويته في الفئات. هذا يخالف عادة متطلبات الاحتفاظ بالسجلات المالية والوظيفية.

### التطبيع

- **تكرار جداول المجال نفسه:** انظر [04-system-architecture.md](04-system-architecture.md).
- `student_profiles` فيها 38 عمودًا، وتضم الأسرة والثانوية والعنوان والحالة معًا.
- `users.program` نص منسوخ من البرنامج، `students.js:431`.
- `student_profiles.national_id` عليه قيد فريد، ومعه فهرسان إضافيان زائدان على العمود نفسه: `idx_perf_profiles_national_id` و`idx_profiles_nid`. ووجود فهارس مكررة يستحق مراجعة عامة.

### أنماط الوصول

| النمط | الدليل | ملاحظة |
|---|---|---|
| SQL خام بمعاملات مربوطة | أغلب الكود | جيد ضد الحقن |
| SQL مبني بنص | 95 موضعًا مطابقًا للنمط | ما رُوجع منها يدرج أسماء ثابتة أو شروطًا داخلية، وليس مدخلات مباشرة. لم يُراجع الجميع |
| `.all()` بلا `LIMIT` | 187 موضعًا. منها 25 في `v12_modules.js` و16 في `enterprise_suite.js` و11 في `procurement/core.js` | كثير منها قوائم صغيرة، لكن بعضها ينمو مع الزمن |
| تصفية في JavaScript بعد جلب الكل | `v12_modules.js:213-223` و633، `requestsxl.js:65-69` | هدر |
| N+1 | بنيت سابقًا إصلاحات له، وبقيت حلقة `reports.js:41` على شجرة الحسابات | محدود |
| معاملات طويلة | الاستيراد في خيط مستقل، `tx` في الخيط الرئيسي | المعاملة في الرئيسي توقف الكل طوال مدتها |
| `INSERT ... RETURNING *` تلقائي | `db.js:221` | يعيد الصف كاملًا لكل إدراج |

### ما يلزم للتحقق من الإنتاج

وصول للقراءة فقط إلى `pg_stat_statements` و`pg_stat_user_tables` و`pg_stat_user_indexes`، مع حجم الجداول و`max_connections`، دون أي صفوف بيانات.

## ملحق: كل الجداول

### `academic_request_details`

- **الغرض:** تفاصيل الطلب الأكاديمي
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `request_id`
- **مفاتيح أجنبية:** `request_id` ← `requests.id` (حذف: NO ACTION)؛ `target_course_id` ← `courses.id` (حذف: NO ACTION)؛ `target_program_id` ← `programs.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE academic_request_details_pkey (request_id)`؛ `idx_hf_academic_req_details_req (request_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `request_id` | bigint | لا | — |
| `request_category` | text | لا | — |
| `target_program_id` | bigint | نعم | — |
| `target_course_id` | bigint | نعم | — |
| `target_grade_id` | bigint | نعم | — |
| `claimed_mark` | bigint | نعم | — |
| `violation_type` | text | نعم | — |
| `justification` | text | نعم | — |
| `updated_at` | bigint | لا | — |

### `ai_advisor_chats`

- **الغرض:** محادثات المرشد الذكي
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE ai_advisor_chats_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `user_label` | text | لا | — |
| `question` | text | لا | — |
| `answer` | text | لا | — |
| `model_used` | text | لا | `'gemini-3.8-flash'::text` |
| `created_at` | bigint | لا | — |

### `ai_early_warnings`

- **الغرض:** الإنذار المبكر
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE ai_early_warnings_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `program_name` | text | لا | — |
| `gpa` | double precision | لا | — |
| `attendance_rate` | bigint | لا | — |
| `failed_courses` | bigint | لا | `0` |
| `risk_level` | text | لا | — |
| `ai_diagnosis` | text | لا | — |
| `ai_action_plan` | text | لا | — |
| `advisor_status` | text | لا | `'بانتظار المتابعة'::text` |
| `analyzed_at` | bigint | لا | — |

### `ai_triage_logs`

- **الغرض:** الفرز الآلي للمراسلات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE ai_triage_logs_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `source_type` | text | لا | `'شكوى طلابية'::text` |
| `sender_name` | text | لا | — |
| `subject` | text | لا | — |
| `body_text` | text | لا | — |
| `ai_category` | text | لا | — |
| `ai_priority` | text | لا | — |
| `target_unit` | text | لا | — |
| `ai_summary` | text | لا | — |
| `ai_draft_reply` | text | لا | — |
| `created_at` | bigint | لا | — |

### `alumni_records`

- **الغرض:** سجل الخريجين
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `student_no`
- **الفهارس (2):** `UNIQUE alumni_records_pkey (id)`؛ `UNIQUE alumni_records_student_no_key (student_no)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `full_name` | text | لا | — |
| `faculty_name` | text | لا | — |
| `program_name` | text | لا | — |
| `grad_year` | bigint | لا | — |
| `gpa` | double precision | لا | — |
| `honor_rank` | text | لا | `'جيد جداً'::text` |
| `current_employer` | text | لا | `''::text` |
| `job_title` | text | لا | `''::text` |
| `email` | text | لا | `''::text` |
| `phone` | text | لا | `''::text` |
| `verified_code` | text | لا | — |
| `created_at` | bigint | لا | — |

### `attachments`

- **الغرض:** مرفقات الطلبات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `request_id` ← `requests.id` (حذف: NO ACTION)
- **قيود فريدة:** `stored_name`
- **الفهارس (3):** `UNIQUE attachments_pkey (id)`؛ `UNIQUE attachments_stored_name_key (stored_name)`؛ `idx_hf_attachments_req_id (request_id, id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `request_id` | bigint | لا | — |
| `orig_name` | text | لا | — |
| `stored_name` | text | لا | — |
| `mime` | text | لا | — |
| `size` | bigint | لا | — |
| `sha256` | text | لا | — |
| `slot_label` | text | نعم | — |

### `audit_log`

- **الغرض:** سجل التدقيق بسلسلة بصمات
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (5):** `UNIQUE audit_log_pkey (id)`؛ `idx_audit_action_at (action, at DESC)`؛ `idx_audit_actor_at (actor_label, at DESC)`؛ `idx_audit_ref_at (ref, at DESC)`؛ `idx_hc_audit_log_at (at DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `at` | bigint | لا | — |
| `actor_id` | bigint | نعم | — |
| `actor_label` | text | لا | — |
| `role` | text | لا | — |
| `action` | text | لا | — |
| `ref` | text | لا | `''::text` |
| `ip` | text | نعم | — |
| `prev_hash` | text | لا | — |
| `hash` | text | لا | — |

### `card_batches`

- **الغرض:** دفعات طباعة البطاقات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE card_batches_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `label` | text | لا | — |
| `filter_json` | text | لا | `'{}'::text` |
| `created_by` | bigint | لا | — |
| `created_at` | bigint | لا | — |

### `card_handovers`

- **الغرض:** استلام البطاقات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `batch_id` ← `card_batches.id` (حذف: CASCADE)؛ `handed_by` ← `users.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: CASCADE)
- **قيود فريدة:** `batch_id,student_id`
- **الفهارس (3):** `UNIQUE card_handovers_batch_id_student_id_key (batch_id, student_id)`؛ `UNIQUE card_handovers_pkey (id)`؛ `idx_card_handovers_student (student_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `batch_id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `received_at` | bigint | نعم | — |
| `receiver_name` | text | لا | `''::text` |
| `handed_by` | bigint | نعم | — |
| `note` | text | لا | `''::text` |

### `career_applications`

- **الغرض:** طلبات التوظيف
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `job_id` ← `career_jobs.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE career_applications_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `job_id` | bigint | لا | — |
| `applicant_name` | text | لا | — |
| `student_no` | text | لا | — |
| `gpa` | double precision | لا | `0` |
| `cv_summary` | text | لا | `''::text` |
| `status` | text | لا | `'قيد المراجعة'::text` |
| `applied_at` | bigint | لا | — |

### `career_jobs`

- **الغرض:** الوظائف
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE career_jobs_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `title` | text | لا | — |
| `company_name` | text | لا | — |
| `sector` | text | لا | — |
| `location` | text | لا | — |
| `job_type` | text | لا | `'دوام كامل'::text` |
| `salary_range` | text | لا | `''::text` |
| `requirements` | text | لا | `''::text` |
| `deadline` | text | لا | `''::text` |
| `applicants_count` | bigint | لا | `0` |
| `active` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `complaints`

- **الغرض:** الشكاوى
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `responded_by` ← `users.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (4):** `UNIQUE complaints_no_key (no)`؛ `UNIQUE complaints_pkey (id)`؛ `idx_complaints_status (status, created_at)`؛ `idx_complaints_student (student_id, created_at)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `no` | text | لا | — |
| `student_id` | bigint | لا | — |
| `subject` | text | لا | — |
| `body` | text | لا | — |
| `status` | text | لا | `'open'::text` |
| `response` | text | نعم | — |
| `responded_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `responded_at` | bigint | نعم | — |

### `corr_approvers`

- **الغرض:** معتمدو الكتاب
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `doc_id` ← `corr_docs.id` (حذف: CASCADE)؛ `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `doc_id,user_id`
- **الفهارس (5):** `corr_appr_user (user_id, state)`؛ `UNIQUE corr_approvers_doc_id_user_id_key (doc_id, user_id)`؛ `UNIQUE corr_approvers_pkey (id)`؛ `idx_hc_corr_approvers_doc_seq (doc_id, state, seq)`؛ `idx_hc_corr_approvers_user_state (user_id, state, doc_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `doc_id` | bigint | لا | — |
| `user_id` | bigint | لا | — |
| `seq` | bigint | لا | — |
| `state` | text | لا | `'pending'::text` |
| `at` | bigint | نعم | — |
| `note` | text | نعم | — |

### `corr_cc`

- **الغرض:** نسخ الكتاب
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `doc_id`، `user_id`
- **مفاتيح أجنبية:** `doc_id` ← `corr_docs.id` (حذف: CASCADE)؛ `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `UNIQUE corr_cc_pkey (doc_id, user_id)`؛ `corr_cc_user (user_id)`؛ `idx_hc_corr_cc_user_doc (user_id, doc_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `doc_id` | bigint | لا | — |
| `user_id` | bigint | لا | — |

### `corr_docs`

- **الغرض:** الكتب الرسمية
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `creator_id` ← `users.id` (حذف: NO ACTION)؛ `unit_id` ← `org_units.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (8):** `corr_creator (creator_id, created_at)`؛ `UNIQUE corr_docs_no_key (no)`؛ `UNIQUE corr_docs_pkey (id)`؛ `UNIQUE corr_out_unique (out_year, out_no) WHERE (out_no IS NOT NULL)`؛ `idx_hc_corr_docs_creator_status (creator_id, status, created_at DESC)`؛ `idx_hc_corr_docs_status_created (status, created_at DESC)`؛ `idx_hf_corr_docs_out_year_no (out_year, out_no)`؛ `idx_hf_corr_docs_unit_status (unit_id, status, created_at DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `no` | text | لا | — |
| `title` | text | لا | — |
| `subject` | text | لا | `''::text` |
| `body` | text | لا | `''::text` |
| `mode` | text | لا | — |
| `status` | text | لا | — |
| `creator_id` | bigint | لا | — |
| `unit_id` | bigint | نعم | — |
| `out_no` | bigint | نعم | — |
| `out_year` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `sent_at` | bigint | نعم | — |
| `decided_at` | bigint | نعم | — |

### `corr_events`

- **الغرض:** أحداث الكتاب
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `doc_id` ← `corr_docs.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `corr_ev_doc (doc_id, id)`؛ `UNIQUE corr_events_pkey (id)`؛ `idx_hc_corr_events_doc_id (doc_id, id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `doc_id` | bigint | لا | — |
| `at` | bigint | لا | — |
| `kind` | text | لا | — |
| `actor_id` | bigint | نعم | — |
| `actor_label` | text | لا | — |
| `text` | text | لا | — |

### `corr_files`

- **الغرض:** مرفقات الكتاب
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `doc_id` ← `corr_docs.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE corr_files_pkey (id)`؛ `idx_hf_corr_files_doc_id (doc_id, id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `doc_id` | bigint | لا | — |
| `orig_name` | text | لا | — |
| `stored_name` | text | لا | — |
| `mime` | text | لا | — |
| `size` | bigint | لا | — |
| `sha256` | text | لا | — |

### `corr_notifs`

- **الغرض:** تنبيهات المراسلات
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `doc_id` ← `corr_docs.id` (حذف: CASCADE)؛ `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (5):** `corr_notif_user (user_id, read, at)`؛ `UNIQUE corr_notifs_pkey (id)`؛ `idx_hc_corr_notifs_user_at (user_id, at DESC)`؛ `idx_hf_corr_notifs_user_read_at (user_id, read, at DESC)`؛ `idx_perf_corr_notifs_user_unread (user_id, read, at DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `user_id` | bigint | لا | — |
| `doc_id` | bigint | نعم | — |
| `text` | text | لا | — |
| `at` | bigint | لا | — |
| `read` | bigint | لا | `0` |

### `corr_templates`

- **الغرض:** قوالب المراسلات
- **المجموعة:** المراسلات
- **المفتاح الأساسي:** `code`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE corr_templates_pkey (code)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `code` | text | لا | — |
| `name` | text | لا | — |
| `category` | text | لا | `'عام'::text` |
| `title` | text | لا | — |
| `subject` | text | لا | `''::text` |
| `body` | text | لا | `''::text` |
| `mode` | text | لا | `'parallel'::text` |
| `active` | bigint | لا | `1` |
| `builtin` | bigint | لا | `0` |
| `created_at` | bigint | لا | — |

### `course_schedules`

- **الغرض:** مواعيد المحاضرات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `course_id` ← `courses.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE course_schedules_pkey (id)`؛ `idx_course_schedules_course (course_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_id` | bigint | لا | — |
| `day` | bigint | لا | — |
| `start_min` | bigint | لا | — |
| `end_min` | bigint | لا | — |
| `hall` | text | نعم | — |
| `group_id` | bigint | نعم | — |

### `courses`

- **الغرض:** المقررات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `member_id` ← `faculty_members.id` (حذف: NO ACTION)؛ `program_id` ← `programs.id` (حذف: NO ACTION)
- **قيود فريدة:** `level,name,program_id,semester`
- **الفهارس (6):** `UNIQUE courses_pkey (id)`؛ `UNIQUE courses_program_id_level_semester_name_key (program_id, level, semester, name)`؛ `idx_courses_active (active)`؛ `idx_courses_member (member_id) WHERE (member_id IS NOT NULL)`؛ `idx_courses_program (program_id, level, semester)`؛ `idx_courses_program_level (program_id, level, semester)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `program_id` | bigint | لا | — |
| `level` | bigint | لا | — |
| `semester` | bigint | لا | — |
| `name` | text | لا | — |
| `code` | text | نعم | — |
| `hours` | bigint | لا | `3` |
| `instructor` | text | نعم | — |
| `active` | bigint | لا | `1` |
| `member_id` | bigint | نعم | — |

### `devops_incident_reports`

- **الغرض:** بلاغات الأعطال
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `report_code`
- **الفهارس (5):** `UNIQUE devops_incident_reports_pkey (id)`؛ `UNIQUE devops_incident_reports_report_code_key (report_code)`؛ `idx_devops_incidents_severity (severity, created_at)`؛ `idx_devops_incidents_status (status, created_at)`؛ `idx_hf_devops_incidents_status_created (status, severity, created_at DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `report_code` | text | لا | — |
| `source` | text | لا | — |
| `event_type` | text | لا | — |
| `severity` | text | لا | — |
| `file_path` | text | نعم | — |
| `error_message` | text | لا | — |
| `error_details` | text | نعم | — |
| `client_context` | text | نعم | — |
| `status` | text | لا | `'open'::text` |
| `resolution_note` | text | نعم | — |
| `resolved_at` | bigint | نعم | — |
| `resolved_by` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `document_pdfs`

- **الغرض:** نسخ PDF للوثائق
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `pdf_sha256`
- **مفاتيح أجنبية:** `code` ← `documents.code` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE document_pdfs_pkey (pdf_sha256)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `pdf_sha256` | text | لا | — |
| `code` | text | لا | — |
| `created_at` | bigint | لا | — |

### `documents`

- **الغرض:** الوثائق الصادرة
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `issued_by` ← `users.id` (حذف: NO ACTION)؛ `request_id` ← `requests.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`، `request_id`
- **الفهارس (4):** `UNIQUE documents_code_key (code)`؛ `UNIQUE documents_pkey (id)`؛ `UNIQUE documents_request_id_key (request_id)`؛ `idx_documents_request (request_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `request_id` | bigint | لا | — |
| `code` | text | لا | — |
| `issued_at` | bigint | لا | — |
| `issued_by` | bigint | نعم | — |
| `payload_json` | text | لا | — |
| `content_hash` | text | لا | — |
| `signature` | text | لا | — |

### `dorm_allocations`

- **الغرض:** تسكين الطلاب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `room_id` ← `dorm_rooms.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE dorm_allocations_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `room_id` | bigint | لا | — |
| `student_name` | text | لا | — |
| `student_no` | text | لا | — |
| `faculty_name` | text | لا | — |
| `check_in_date` | text | لا | — |
| `academic_year` | text | لا | `'2026/2027'::text` |
| `payment_status` | text | لا | `'مسدد'::text` |
| `status` | text | لا | `'ساكن'::text` |

### `dorm_rooms`

- **الغرض:** غرف السكن
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE dorm_rooms_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `building_name` | text | لا | — |
| `room_no` | text | لا | — |
| `floor_no` | bigint | لا | `1` |
| `capacity` | bigint | لا | `2` |
| `occupied` | bigint | لا | `1` |
| `room_type` | text | لا | `'مزدوجة'::text` |
| `annual_fee` | double precision | لا | `1200000` |
| `status` | text | لا | `'متاحة'::text` |

### `encrypted_snapshots`

- **الغرض:** سجل لقطات مشفرة
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `snapshot_code`
- **الفهارس (2):** `UNIQUE encrypted_snapshots_pkey (id)`؛ `UNIQUE encrypted_snapshots_snapshot_code_key (snapshot_code)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `snapshot_code` | text | لا | — |
| `label` | text | لا | — |
| `schedule_type` | text | نعم | `'يومي مجدول'::text` |
| `cipher_algo` | text | نعم | `'AES-256-GCM'::text` |
| `sha256_hash` | text | لا | — |
| `size_kb` | bigint | لا | — |
| `tables_count` | bigint | نعم | `42` |
| `status` | text | نعم | `'مكتمل ومشفر'::text` |
| `created_at` | bigint | لا | — |

### `exam_schedules`

- **الغرض:** جداول الامتحانات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE exam_schedules_pkey (id)`؛ `idx_hf_exam_schedules_date_hall (exam_date, hall_name)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `program_name` | text | لا | — |
| `exam_type` | text | لا | `'نهائي'::text` |
| `exam_date` | text | لا | — |
| `start_time` | text | لا | — |
| `end_time` | text | لا | — |
| `hall_name` | text | لا | — |
| `capacity` | bigint | لا | `60` |
| `enrolled_count` | bigint | لا | `45` |
| `proctor_name` | text | لا | — |
| `status` | text | لا | `'مجدول'::text` |
| `created_at` | bigint | لا | — |
| `group_id` | bigint | نعم | — |

### `faculties`

- **الغرض:** الكليات والمعاهد
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `code`، `name`
- **الفهارس (3):** `UNIQUE faculties_code_key (code)`؛ `UNIQUE faculties_name_key (name)`؛ `UNIQUE faculties_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `name` | text | لا | — |
| `name_en` | text | لا | — |
| `code` | text | لا | — |
| `kind` | text | لا | — |
| `active` | bigint | لا | `1` |

### `faculty_members`

- **الغرض:** أعضاء الهيئة التدريسية
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `unit_id` ← `org_units.id` (حذف: NO ACTION)؛ `user_id` ← `users.id` (حذف: SET NULL)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `UNIQUE faculty_members_pkey (id)`؛ `UNIQUE idx_faculty_members_user (user_id) WHERE (user_id IS NOT NULL)`؛ `idx_faculty_status (status)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `name` | text | لا | — |
| `rank` | text | لا | — |
| `unit_id` | bigint | نعم | — |
| `specialty` | text | نعم | — |
| `email` | text | نعم | — |
| `phone` | text | نعم | — |
| `office_hours` | text | نعم | — |
| `office_location` | text | نعم | — |
| `status` | text | لا | `'active'::text` |
| `hire_date` | bigint | نعم | — |
| `notes` | text | نعم | — |
| `created_at` | bigint | لا | — |
| `user_id` | bigint | نعم | — |

### `faculty_overload_records`

- **الغرض:** العبء الزائد
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE faculty_overload_records_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `instructor_name` | text | لا | — |
| `academic_rank` | text | لا | — |
| `faculty_name` | text | لا | — |
| `quorum_hours` | bigint | لا | — |
| `actual_teaching_hours` | bigint | لا | — |
| `supervision_hours` | bigint | نعم | `0` |
| `overload_hours` | bigint | لا | — |
| `hourly_rate` | double precision | لا | — |
| `total_overload_pay` | double precision | لا | — |
| `semester` | text | نعم | `'الفصل الأول 2026/2027'::text` |
| `status` | text | نعم | `'معتمد للرواتب'::text` |
| `updated_at` | bigint | لا | — |

### `faculty_promotions`

- **الغرض:** الترقيات العلمية
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE faculty_promotions_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `faculty_name` | text | لا | — |
| `specialty` | text | لا | — |
| `current_rank` | text | لا | — |
| `target_rank` | text | لا | — |
| `research_points` | double precision | لا | `0` |
| `required_points` | double precision | لا | `100` |
| `teaching_years` | bigint | لا | `4` |
| `committee_status` | text | لا | `'قيد التحكيم العلمي'::text` |
| `submitted_at` | bigint | لا | — |

### `fin_accounts`

- **الغرض:** شجرة الحسابات
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `parent_id` ← `fin_accounts.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`، `system_key`
- **الفهارس (7):** `UNIQUE fin_accounts_code_key (code)`؛ `UNIQUE fin_accounts_pkey (id)`؛ `UNIQUE fin_accounts_system_key_key (system_key)`؛ `idx_fin_accounts_code (code)`؛ `idx_fin_accounts_parent (parent_id)`؛ `idx_fin_accounts_postable_active (postable, active, type)`؛ `idx_hf_fin_accounts_type_postable (type, postable, active)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `parent_id` | bigint | نعم | — |
| `type` | text | لا | — |
| `postable` | bigint | لا | `1` |
| `active` | bigint | لا | `1` |
| `system_key` | text | نعم | — |
| `require_cc` | bigint | لا | `0` |
| `created_at` | bigint | لا | — |

### `fin_charges`

- **الغرض:** رسوم الطلاب
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `entry_id` ← `fin_entries.id` (حذف: NO ACTION)؛ `fee_type_id` ← `fin_fee_types.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (5):** `UNIQUE fin_charges_pkey (id)`؛ `idx_fin_charges_student (student_id, status)`؛ `idx_hf_fin_charges_due_status (status, due_day)`؛ `idx_hf_fin_charges_entry (entry_id) WHERE (entry_id IS NOT NULL)`؛ `idx_perf_fin_charges_student_status_due (student_id, status, due_day)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `fee_type_id` | bigint | لا | — |
| `amount` | bigint | لا | — |
| `due_day` | text | لا | — |
| `academic_year` | text | لا | `''::text` |
| `note` | text | لا | `''::text` |
| `status` | text | لا | `'open'::text` |
| `entry_id` | bigint | نعم | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `fin_cost_centers`

- **الغرض:** مراكز الكلفة
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `unit_id` ← `org_units.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`
- **الفهارس (4):** `UNIQUE fin_cost_centers_code_key (code)`؛ `UNIQUE fin_cost_centers_pkey (id)`؛ `idx_fin_cc_code (code)`؛ `idx_fin_cc_unit (unit_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `unit_id` | bigint | نعم | — |
| `active` | bigint | لا | `1` |

### `fin_currencies`

- **الغرض:** العملات
- **المجموعة:** المالية
- **المفتاح الأساسي:** `code`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE fin_currencies_pkey (code)`؛ `idx_fin_currencies_base (is_base)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `code` | text | لا | — |
| `name` | text | لا | — |
| `symbol` | text | لا | — |
| `rate` | double precision | لا | `1` |
| `is_base` | bigint | لا | `0` |
| `active` | bigint | لا | `1` |

### `fin_entries`

- **الغرض:** قيود اليومية
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `posted_by` ← `users.id` (حذف: NO ACTION)؛ `reversal_of` ← `fin_entries.id` (حذف: NO ACTION)؛ `reversed_by` ← `fin_entries.id` (حذف: NO ACTION)؛ `year_id` ← `fin_years.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (10):** `UNIQUE fin_entries_no_key (no)`؛ `UNIQUE fin_entries_pkey (id)`؛ `idx_fin_entries_day (entry_day, status)`؛ `UNIQUE idx_fin_entries_source (source) WHERE ((source IS NOT NULL) AND (reversal_of IS NULL))`؛ `idx_fin_entries_status_day (status, entry_day)`؛ `idx_fin_entries_type (type, status)`؛ `idx_fin_entries_year (year_id, type)`؛ `idx_hc_fin_entries_status_day (status, entry_day DESC, id DESC)`؛ `idx_hc_fin_entries_type_status (type, status, id DESC)`؛ `idx_hf_fin_entries_year_type_seq (year_id, type, seq DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `year_id` | bigint | لا | — |
| `type` | text | لا | — |
| `seq` | bigint | نعم | — |
| `no` | text | نعم | — |
| `entry_day` | text | لا | — |
| `description` | text | لا | — |
| `reference` | text | لا | `''::text` |
| `status` | text | لا | `'draft'::text` |
| `source` | text | نعم | — |
| `reversal_of` | bigint | نعم | — |
| `reversed_by` | bigint | نعم | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `posted_by` | bigint | نعم | — |
| `posted_at` | bigint | نعم | — |

### `fin_fee_structures`

- **الغرض:** هياكل الرسوم
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE fin_fee_structures_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `program_id` | bigint | نعم | — |
| `academic_year` | text | نعم | — |
| `semester` | bigint | نعم | — |
| `tuition_fee` | double precision | نعم | — |
| `registration_fee` | double precision | نعم | — |
| `total_fee` | double precision | نعم | — |
| `created_at` | bigint | نعم | — |

### `fin_fee_types`

- **الغرض:** أنواع الرسوم
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `account_id` ← `fin_accounts.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`
- **الفهارس (3):** `UNIQUE fin_fee_types_code_key (code)`؛ `UNIQUE fin_fee_types_pkey (id)`؛ `idx_fin_fee_types_active (active)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `kind` | text | لا | `'fee'::text` |
| `account_id` | bigint | لا | — |
| `default_amount` | bigint | لا | `0` |
| `active` | bigint | لا | `1` |

### `fin_lines`

- **الغرض:** بنود القيود
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `account_id` ← `fin_accounts.id` (حذف: NO ACTION)؛ `cost_center_id` ← `fin_cost_centers.id` (حذف: NO ACTION)؛ `currency` ← `fin_currencies.code` (حذف: NO ACTION)؛ `entry_id` ← `fin_entries.id` (حذف: CASCADE)؛ `party_id` ← `fin_parties.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (11):** `UNIQUE fin_lines_pkey (id)`؛ `idx_fin_lines_account (account_id)`؛ `idx_fin_lines_account_day (account_id, entry_id)`؛ `idx_fin_lines_entry (entry_id)`؛ `idx_fin_lines_party (party_id) WHERE (party_id IS NOT NULL)`؛ `idx_fin_lines_student (student_id) WHERE (student_id IS NOT NULL)`؛ `idx_hc_fin_lines_acc_entry (account_id, entry_id)`؛ `idx_hc_fin_lines_entry_acc (entry_id, account_id)`؛ `idx_hc_fin_lines_party (party_id, entry_id)`؛ `idx_hc_fin_lines_student (student_id, entry_id)`؛ `idx_hf_fin_lines_cc_entry (cost_center_id, entry_id) WHERE (cost_center_id IS NOT NULL)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `entry_id` | bigint | لا | — |
| `line_no` | bigint | لا | — |
| `account_id` | bigint | لا | — |
| `debit` | bigint | لا | `0` |
| `credit` | bigint | لا | `0` |
| `currency` | text | نعم | — |
| `rate` | double precision | نعم | — |
| `fc_amount` | bigint | نعم | — |
| `cost_center_id` | bigint | نعم | — |
| `party_id` | bigint | نعم | — |
| `student_id` | bigint | نعم | — |
| `note` | text | لا | `''::text` |

### `fin_parties`

- **الغرض:** الأطراف
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `account_id` ← `fin_accounts.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `UNIQUE fin_parties_pkey (id)`؛ `idx_fin_parties_kind_active (kind, active)`؛ `idx_fin_parties_name (name)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `kind` | text | لا | — |
| `name` | text | لا | — |
| `phone` | text | نعم | — |
| `email` | text | نعم | — |
| `notes` | text | نعم | — |
| `account_id` | bigint | نعم | — |
| `active` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `fin_payments`

- **الغرض:** دفعات الطلاب
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `account_id` ← `fin_accounts.id` (حذف: NO ACTION)؛ `created_by` ← `users.id` (حذف: NO ACTION)؛ `entry_id` ← `fin_entries.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `receipt_no`
- **الفهارس (6):** `UNIQUE fin_payments_pkey (id)`؛ `UNIQUE fin_payments_receipt_no_key (receipt_no)`؛ `idx_fin_payments_student (student_id, status)`؛ `idx_hf_fin_payments_day_status (status, paid_day DESC)`؛ `idx_hf_fin_payments_entry (entry_id) WHERE (entry_id IS NOT NULL)`؛ `idx_perf_fin_payments_student_day (student_id, paid_day DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `receipt_no` | text | لا | — |
| `student_id` | bigint | لا | — |
| `amount` | bigint | لا | — |
| `method` | text | لا | — |
| `account_id` | bigint | لا | — |
| `paid_day` | text | لا | — |
| `note` | text | لا | `''::text` |
| `status` | text | لا | `'ok'::text` |
| `entry_id` | bigint | نعم | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `fin_years`

- **الغرض:** السنوات المالية
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `closed_by` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `name`
- **الفهارس (3):** `UNIQUE fin_years_name_key (name)`؛ `UNIQUE fin_years_pkey (id)`؛ `idx_hf_fin_years_status_days (status, start_day, end_day)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `name` | text | لا | — |
| `start_day` | text | لا | — |
| `end_day` | text | لا | — |
| `status` | text | لا | `'open'::text` |
| `closed_at` | bigint | نعم | — |
| `closed_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `grade_appeals`

- **الغرض:** تظلمات العلامات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE grade_appeals_pkey (id)`؛ `idx_hf_grade_appeals_status_created (status, created_at DESC)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `old_mark` | double precision | لا | — |
| `new_mark` | double precision | نعم | — |
| `reason` | text | لا | — |
| `committee_note` | text | لا | `''::text` |
| `status` | text | لا | `'قيد اللجنة'::text` |
| `created_at` | bigint | لا | — |
| `decided_at` | bigint | نعم | — |
| `grade_id` | bigint | نعم | — |

### `grade_changes`

- **الغرض:** سجل تغييرات العلامات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `actor_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `UNIQUE grade_changes_pkey (id)`؛ `idx_grade_changes_grade (grade_id)`؛ `idx_grade_changes_student (student_id, at)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `grade_id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `course` | text | لا | — |
| `action` | text | لا | — |
| `old_total` | bigint | نعم | — |
| `new_total` | bigint | نعم | — |
| `old_theory` | bigint | نعم | — |
| `new_theory` | bigint | نعم | — |
| `old_practical` | bigint | نعم | — |
| `new_practical` | bigint | نعم | — |
| `old_status` | text | نعم | — |
| `new_status` | text | نعم | — |
| `justification` | text | نعم | — |
| `actor_id` | bigint | نعم | — |
| `at` | bigint | لا | — |

### `grades`

- **الغرض:** العلامات ومراحل اعتمادها
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `approved_by` ← `users.id` (حذف: NO ACTION)؛ `course_id` ← `courses.id` (حذف: NO ACTION)؛ `entered_by` ← `users.id` (حذف: NO ACTION)؛ `reviewed_by` ← `users.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (9):** `UNIQUE grades_pkey (id)`؛ `UNIQUE idx_grades_attempt (student_id, course_id, academic_year) WHERE (course_id IS NOT NULL)`؛ `idx_grades_course (course_id)`؛ `idx_grades_level (level, semester)`؛ `idx_grades_student (student_id)`؛ `idx_grades_workflow (workflow_status)`؛ `idx_grades_workflow2 (workflow_status, student_id)`؛ `idx_grades_year (academic_year)`؛ `idx_perf_grades_student_year_status (student_id, academic_year, workflow_status)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `term` | text | لا | — |
| `course` | text | لا | — |
| `hours` | bigint | لا | — |
| `mark` | bigint | لا | — |
| `course_id` | bigint | نعم | — |
| `level` | bigint | نعم | — |
| `semester` | bigint | نعم | — |
| `academic_year` | text | نعم | — |
| `theory_mark` | bigint | نعم | — |
| `practical_mark` | bigint | نعم | — |
| `entered_by` | bigint | نعم | — |
| `entered_at` | bigint | نعم | — |
| `workflow_status` | text | لا | `'approved'::text` |
| `reviewed_by` | bigint | نعم | — |
| `reviewed_at` | bigint | نعم | — |
| `approved_by` | bigint | نعم | — |
| `approved_at` | bigint | نعم | — |

### `hall_logs`

- **الغرض:** سجل دخول القاعات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `course_id` ← `courses.id` (حذف: NO ACTION)؛ `recorded_by` ← `users.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (6):** `UNIQUE hall_logs_pkey (id)`؛ `idx_hall_logs_course (course_id) WHERE (course_id IS NOT NULL)`؛ `idx_hall_logs_hall (hall)`؛ `idx_hall_logs_open (student_id) WHERE (exited_at IS NULL)`؛ `idx_hall_logs_student (student_id, entered_at)`؛ `idx_hall_logs_time (entered_at)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `kind` | text | لا | — |
| `course_id` | bigint | نعم | — |
| `subject` | text | لا | — |
| `hall` | text | لا | — |
| `entered_at` | bigint | لا | — |
| `exited_at` | bigint | نعم | — |
| `method` | text | لا | `'barcode'::text` |
| `recorded_by` | bigint | نعم | — |
| `note` | text | نعم | — |

### `hr_absences`

- **الغرض:** الغياب
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `employee_id` ← `hr_employees.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `UNIQUE hr_absences_pkey (id)`؛ `idx_hf_hr_absences_emp_month (employee_id, month_code)`؛ `idx_hr_absences_emp (employee_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employee_id` | bigint | لا | — |
| `reason` | text | لا | `'تأخير متكرر'::text` |
| `absence_days` | bigint | لا | `0` |
| `daily_rate` | double precision | لا | `0` |
| `total_deduction` | double precision | لا | `0` |
| `month` | text | لا | `'يونيو'::text` |
| `month_code` | text | لا | `'2026-06'::text` |
| `status_note` | text | لا | `'لا يوجد غياب'::text` |
| `created_at` | bigint | لا | — |

### `hr_advances`

- **الغرض:** السلف
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `employee_id` ← `hr_employees.id` (حذف: CASCADE)
- **قيود فريدة:** `advance_code`
- **الفهارس (4):** `UNIQUE hr_advances_advance_code_key (advance_code)`؛ `UNIQUE hr_advances_pkey (id)`؛ `idx_hr_advances_emp (employee_id)`؛ `idx_hr_advances_status (status)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `advance_code` | text | لا | — |
| `employee_id` | bigint | لا | — |
| `advance_date` | text | لا | — |
| `amount` | double precision | لا | `0` |
| `installments_count` | bigint | لا | `1` |
| `paid_installments` | bigint | لا | `0` |
| `monthly_installment` | double precision | لا | `0` |
| `remaining_amount` | double precision | لا | `0` |
| `status` | text | لا | `'مستحقة'::text` |
| `notes` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `hr_alert_settings`

- **الغرض:** تنبيهات الموارد البشرية
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `key`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE hr_alert_settings_pkey (key)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `key` | text | لا | — |
| `value` | text | لا | — |
| `label` | text | لا | — |
| `category` | text | لا | — |
| `unit` | text | لا | `''::text` |
| `updated_at` | bigint | لا | — |

### `hr_appraisals`

- **الغرض:** تقييم الأداء
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE hr_appraisals_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employee_name` | text | لا | — |
| `department` | text | لا | — |
| `period_label` | text | لا | `'التقييم السنوي 2026'::text` |
| `punctuality_score` | bigint | لا | `90` |
| `productivity_score` | bigint | لا | `88` |
| `teamwork_score` | bigint | لا | `92` |
| `overall_score` | double precision | لا | `90` |
| `recommendation` | text | لا | `'علاوة دورية'::text` |
| `evaluator_name` | text | لا | `'مدير الموارد البشرية'::text` |
| `created_at` | bigint | لا | — |

### `hr_biometric_devices`

- **الغرض:** أجهزة البصمة
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `device_code`
- **الفهارس (2):** `UNIQUE hr_biometric_devices_device_code_key (device_code)`؛ `UNIQUE hr_biometric_devices_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `device_code` | text | لا | — |
| `location` | text | لا | — |
| `ip_address` | text | لا | — |
| `protocol` | text | لا | `'ZKTeco Push SDK v3'::text` |
| `last_sync_at` | bigint | لا | — |
| `logs_synced` | bigint | لا | `0` |
| `status` | text | لا | `'متصل'::text` |

### `hr_contracts`

- **الغرض:** العقود
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `employee_id` ← `hr_employees.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (4):** `UNIQUE hr_contracts_pkey (id)`؛ `idx_hf_hr_contracts_emp_end (employee_id, end_date DESC)`؛ `idx_hr_contracts_dates (start_date, end_date)`؛ `idx_hr_contracts_employee (employee_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employee_id` | bigint | لا | — |
| `contract_type` | text | لا | — |
| `title` | text | نعم | — |
| `start_date` | text | لا | — |
| `end_date` | text | لا | — |
| `salary` | bigint | لا | `0` |
| `notes` | text | نعم | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `ip` | text | نعم | — |
| `contract_type_ar` | text | لا | `'دوام كامل'::text` |
| `status_ar` | text | لا | `'ساري'::text` |

### `hr_employees`

- **الغرض:** ملفات الموظفين
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `unit_id` ← `org_units.id` (حذف: NO ACTION)
- **قيود فريدة:** `employeeno`، `personalid`
- **الفهارس (6):** `UNIQUE hr_employees_employeeno_key (employeeno)`؛ `UNIQUE hr_employees_personalid_key (personalid)`؛ `UNIQUE hr_employees_pkey (id)`؛ `idx_hf_hr_emp_dept_status (department_name, status)`؛ `idx_hr_employees_status (status)`؛ `idx_hr_employees_unit (unit_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employeeno` | text | لا | — |
| `name` | text | لا | — |
| `personalid` | text | لا | — |
| `email` | text | نعم | — |
| `phone` | text | نعم | — |
| `hiredate` | text | لا | — |
| `status` | text | لا | `'active'::text` |
| `unit_id` | bigint | نعم | — |
| `position` | text | نعم | — |
| `salary_base` | bigint | لا | `0` |
| `joindate` | text | نعم | — |
| `created_at` | bigint | لا | — |
| `updated_at` | bigint | لا | — |
| `housing_allowance` | double precision | لا | `0` |
| `transport_allowance` | double precision | لا | `0` |
| `contract_type_label` | text | لا | `'عقد مفتوح'::text` |
| `emp_status_label` | text | لا | `'نشط'::text` |
| `annual_leave_quota` | bigint | لا | `21` |
| `insurance_amount` | double precision | لا | `0` |
| `tax_amount` | double precision | لا | `0` |
| `department_name` | text | لا | `'الموارد البشرية'::text` |

### `hr_leaves`

- **الغرض:** الإجازات
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `employee_id` ← `hr_employees.id` (حذف: CASCADE)؛ `reviewed_by` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (5):** `UNIQUE hr_leaves_pkey (id)`؛ `idx_hf_hr_leaves_emp_status (employee_id, status, start_date DESC)`؛ `idx_hr_leaves_dates (start_date, end_date)`؛ `idx_hr_leaves_employee (employee_id)`؛ `idx_hr_leaves_status (status)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employee_id` | bigint | لا | — |
| `leave_type` | text | لا | — |
| `status` | text | لا | `'pending'::text` |
| `start_date` | text | لا | — |
| `end_date` | text | لا | — |
| `days` | bigint | لا | — |
| `reason` | text | نعم | — |
| `notes` | text | نعم | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `reviewed_by` | bigint | نعم | — |
| `reviewed_at` | bigint | نعم | — |
| `ip` | text | نعم | — |
| `leave_type_ar` | text | لا | `'سنوية'::text` |
| `unpaid_deduction` | double precision | لا | `0` |

### `hr_monthly_attendance`

- **الغرض:** الدوام الشهري
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `employee_id` ← `hr_employees.id` (حذف: CASCADE)
- **قيود فريدة:** `employee_id,month`
- **الفهارس (4):** `UNIQUE hr_monthly_attendance_employee_id_month_key (employee_id, month)`؛ `UNIQUE hr_monthly_attendance_pkey (id)`؛ `idx_hr_monthly_att_emp (employee_id)`؛ `idx_hr_monthly_att_month (month)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employee_id` | bigint | لا | — |
| `month` | text | لا | `'2026-10'::text` |
| `work_days_month` | bigint | لا | `26` |
| `actual_days` | bigint | لا | `26` |
| `late_days` | bigint | لا | `0` |
| `late_hours` | double precision | لا | `0` |
| `full_days` | bigint | لا | `26` |
| `commitment_rate` | bigint | لا | `100` |
| `evaluation_note` | text | لا | `'ممتاز'::text` |
| `updated_at` | bigint | لا | — |

### `hr_salaries`

- **الغرض:** الرواتب الشهرية
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `employee_id` ← `hr_employees.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (4):** `UNIQUE hr_salaries_pkey (id)`؛ `idx_hf_hr_salaries_emp_eff (employee_id, effective_at DESC)`؛ `idx_hr_salaries_effective (effective_at)`؛ `idx_hr_salaries_employee (employee_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `employee_id` | bigint | لا | — |
| `amount` | bigint | لا | — |
| `effective_at` | bigint | لا | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `ip` | text | نعم | — |

### `hr_signed_payslips`

- **الغرض:** قسائم الراتب
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `payslip_code`
- **الفهارس (2):** `UNIQUE hr_signed_payslips_payslip_code_key (payslip_code)`؛ `UNIQUE hr_signed_payslips_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `payslip_code` | text | لا | — |
| `employee_code` | text | لا | — |
| `employee_name` | text | لا | — |
| `department` | text | لا | — |
| `month_label` | text | لا | — |
| `basic_salary` | double precision | لا | — |
| `overload_pay` | double precision | نعم | `0` |
| `allowances` | double precision | نعم | `0` |
| `deductions` | double precision | نعم | `0` |
| `net_salary` | double precision | لا | — |
| `digital_signature` | text | لا | — |
| `issued_at` | bigint | لا | — |

### `hr_system_lookups`

- **الغرض:** قوائم الموارد البشرية
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `category,label`
- **الفهارس (3):** `UNIQUE hr_system_lookups_category_label_key (category, label)`؛ `UNIQUE hr_system_lookups_pkey (id)`؛ `idx_hf_hr_lookups_cat_active (category, active, sort_order)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `category` | text | لا | — |
| `label` | text | لا | — |
| `sort_order` | bigint | لا | `1` |
| `active` | bigint | لا | `1` |

### `hr_trainings`

- **الغرض:** التدريب
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE hr_trainings_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `title` | text | لا | — |
| `trainer_name` | text | لا | — |
| `target_department` | text | لا | — |
| `start_date` | text | لا | — |
| `hours_count` | bigint | لا | `20` |
| `enrolled_count` | bigint | لا | `15` |
| `status` | text | لا | `'مفتوح للتسجيل'::text` |

### `idempotency_keys`

- **الغرض:** مفاتيح منع التكرار
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `key`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE idempotency_keys_pkey (key)`؛ `idx_idempotency_created (created_at)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `key` | text | لا | — |
| `entry_id` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `import_batches`

- **الغرض:** دفعات الاستيراد
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `undone_by` ← `users.id` (حذف: NO ACTION)؛ `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_import_batches_time (committed_at)`؛ `UNIQUE import_batches_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `kind` | text | لا | — |
| `user_id` | bigint | لا | — |
| `filename` | text | لا | `''::text` |
| `file_sha256` | text | لا | — |
| `status` | text | لا | — |
| `created_at` | bigint | لا | — |
| `committed_at` | bigint | نعم | — |
| `undone_at` | bigint | نعم | — |
| `undone_by` | bigint | نعم | — |
| `summary_json` | text | لا | `'{}'::text` |

### `import_changes`

- **الغرض:** تغييرات الدفعة للتراجع
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `batch_id` ← `import_batches.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_import_changes_batch (batch_id, id)`؛ `UNIQUE import_changes_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `batch_id` | bigint | لا | — |
| `table_name` | text | لا | — |
| `pk_json` | text | لا | — |
| `op` | text | لا | — |
| `before_json` | text | نعم | — |
| `after_hash` | text | نعم | — |

### `import_staging`

- **الغرض:** تجهيز الاستيراد
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `token_hash`
- **مفاتيح أجنبية:** `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_import_staging_exp (expires_at)`؛ `UNIQUE import_staging_pkey (token_hash)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `token_hash` | text | لا | — |
| `user_id` | bigint | لا | — |
| `kind` | text | لا | — |
| `filename` | text | لا | `''::text` |
| `file_sha256` | text | لا | — |
| `total_rows` | bigint | لا | — |
| `created_at` | bigint | لا | — |
| `expires_at` | bigint | لا | — |

### `import_staging_chunks`

- **الغرض:** أجزاء ملفات الاستيراد
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `seq`، `token_hash`
- **مفاتيح أجنبية:** `token_hash` ← `import_staging.token_hash` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE import_staging_chunks_pkey (token_hash, seq)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `token_hash` | text | لا | — |
| `seq` | bigint | لا | — |
| `rows_json` | text | لا | — |

### `infra_settings`

- **الغرض:** إعدادات البنية المعروضة في الواجهة
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `key`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE infra_settings_pkey (key)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `key` | text | لا | — |
| `value_json` | text | لا | — |
| `updated_at` | bigint | لا | — |

### `leave_entitlements`

- **الغرض:** أرصدة الإجازات
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `user_id`، `year`
- **مفاتيح أجنبية:** `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE leave_entitlements_pkey (user_id, year)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `user_id` | bigint | لا | — |
| `year` | bigint | لا | — |
| `days` | double precision | لا | — |

### `leave_records`

- **الغرض:** سجل إجازات ثانٍ (يتداخل مع hr_leaves)
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `request_id` ← `requests.id` (حذف: NO ACTION)؛ `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `request_id`
- **الفهارس (3):** `UNIQUE leave_records_pkey (id)`؛ `UNIQUE leave_records_request_id_key (request_id)`؛ `leave_user_year (user_id, year)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `user_id` | bigint | لا | — |
| `year` | bigint | لا | — |
| `type` | text | لا | — |
| `from_day` | text | لا | — |
| `to_day` | text | لا | — |
| `days` | bigint | لا | — |
| `request_id` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `library_books`

- **الغرض:** كتب المكتبة
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE library_books_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `isbn` | text | لا | — |
| `title` | text | لا | — |
| `author` | text | لا | — |
| `category` | text | لا | — |
| `publish_year` | bigint | لا | `2024` |
| `copies_total` | bigint | لا | `5` |
| `copies_available` | bigint | لا | `5` |
| `shelf_code` | text | لا | `'A-01'::text` |
| `digital_available` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `library_loans`

- **الغرض:** الإعارة
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `book_id` ← `library_books.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_library_loans_status_book (status, book_id)`؛ `UNIQUE library_loans_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `book_id` | bigint | لا | — |
| `borrower_name` | text | لا | — |
| `borrower_no` | text | لا | — |
| `loan_date` | text | لا | — |
| `due_date` | text | لا | — |
| `return_date` | text | نعم | — |
| `status` | text | لا | `'borrowed'::text` |
| `created_at` | bigint | لا | — |

### `lms_lecture_files`

- **الغرض:** ملفات المحاضرات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `lecture_id` ← `lms_lectures.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_lms_lecture_files_lecture (lecture_id)`؛ `UNIQUE lms_lecture_files_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `lecture_id` | bigint | لا | — |
| `filename` | text | لا | — |
| `kind` | text | لا | — |
| `mime` | text | لا | — |
| `size` | bigint | لا | — |
| `file` | text | لا | — |
| `slides_json` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `lms_lectures`

- **الغرض:** المحاضرات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_lms_lectures_course_week (course_code, week_no)`؛ `UNIQUE lms_lectures_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `title` | text | لا | — |
| `kind` | text | لا | `'pdf'::text` |
| `week_no` | bigint | لا | `1` |
| `instructor_name` | text | لا | — |
| `content_url` | text | لا | `''::text` |
| `summary` | text | لا | `''::text` |
| `views_count` | bigint | لا | `0` |
| `published` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `lms_quizzes`

- **الغرض:** بنك الاختبارات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE lms_quizzes_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `title` | text | لا | — |
| `duration_min` | bigint | لا | `30` |
| `total_marks` | bigint | لا | `20` |
| `questions_json` | text | لا | `'[]'::text` |
| `attempts_count` | bigint | لا | `0` |
| `avg_score` | double precision | لا | `0` |
| `published` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `multi_channel_notifications`

- **الغرض:** سجل إشعارات متعددة القنوات
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE multi_channel_notifications_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `title` | text | لا | — |
| `body` | text | لا | — |
| `target_audience` | text | لا | — |
| `channels` | text | لا | — |
| `priority` | text | نعم | `'عادي'::text` |
| `delivery_count` | bigint | نعم | `0` |
| `sender_name` | text | لا | — |
| `created_at` | bigint | لا | — |

### `news`

- **الغرض:** الأخبار
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_news_date (pinned DESC, published_at DESC)`؛ `UNIQUE news_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `title` | text | لا | — |
| `body` | text | لا | — |
| `pinned` | bigint | لا | `0` |
| `published_at` | bigint | لا | — |
| `created_by` | bigint | نعم | — |

### `news_media`

- **الغرض:** وسائط الأخبار
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `news_id` ← `news.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_news_media (news_id, id)`؛ `UNIQUE news_media_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `news_id` | bigint | لا | — |
| `kind` | text | لا | — |
| `source` | text | لا | — |
| `file` | text | نعم | — |
| `mime` | text | نعم | — |
| `size` | bigint | نعم | — |
| `url` | text | نعم | — |
| `provider` | text | نعم | — |
| `ref` | text | نعم | — |
| `caption` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `office_hour_bookings`

- **الغرض:** حجوزات الساعات المكتبية
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE office_hour_bookings_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `faculty_name` | text | لا | — |
| `student_name` | text | لا | — |
| `student_no` | text | لا | — |
| `slot_day` | text | لا | — |
| `slot_time` | text | لا | — |
| `topic` | text | لا | — |
| `status` | text | لا | `'مؤكد'::text` |
| `created_at` | bigint | لا | — |

### `offline_sync_batches`

- **الغرض:** دفعات مزامنة دون اتصال
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `batch_code`
- **الفهارس (2):** `UNIQUE offline_sync_batches_batch_code_key (batch_code)`؛ `UNIQUE offline_sync_batches_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `batch_code` | text | لا | — |
| `committee_name` | text | لا | — |
| `hall_code` | text | لا | — |
| `course_code` | text | لا | — |
| `records_count` | bigint | لا | — |
| `payload_json` | text | لا | — |
| `synced_by` | text | لا | — |
| `synced_at` | bigint | لا | — |

### `online_quiz_submissions`

- **الغرض:** إجابات الاختبارات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_quiz_submissions_quiz_stu (quiz_id, student_no)`؛ `UNIQUE online_quiz_submissions_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `quiz_id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `score` | double precision | لا | — |
| `total_marks` | bigint | لا | — |
| `answers_json` | text | لا | — |
| `submitted_at` | bigint | لا | — |

### `online_quizzes`

- **الغرض:** اختبارات إلكترونية (منظومة ثانية)
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE online_quizzes_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `title` | text | لا | — |
| `instructor_name` | text | لا | — |
| `duration_min` | bigint | نعم | `30` |
| `total_marks` | bigint | نعم | `20` |
| `questions_json` | text | لا | — |
| `status` | text | نعم | `'نشط'::text` |
| `created_at` | bigint | لا | — |

### `org_units`

- **الغرض:** الوحدات التنظيمية وشجرتها
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `parent_id` ← `org_units.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (4):** `idx_hf_org_units_kind_active (kind, active)`؛ `idx_hf_org_units_parent_active (parent_id, active)`؛ `UNIQUE idx_org_units_code (code) WHERE (code IS NOT NULL)`؛ `UNIQUE org_units_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `name` | text | لا | — |
| `kind` | text | لا | — |
| `parent_id` | bigint | نعم | — |
| `active` | bigint | لا | `1` |
| `code` | text | نعم | — |
| `description` | text | لا | `''::text` |
| `module` | text | نعم | — |
| `default_permissions_json` | text | نعم | `'[]'::text` |
| `default_module_access_json` | text | نعم | `'{}'::text` |
| `allowed_views_json` | text | نعم | `'[]'::text` |

### `postgrad_theses`

- **الغرض:** رسائل الدراسات العليا
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE postgrad_theses_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `degree` | text | لا | `'ماجستير'::text` |
| `program_name` | text | لا | — |
| `title` | text | لا | — |
| `supervisor_name` | text | لا | — |
| `co_supervisor` | text | لا | `''::text` |
| `stage` | text | لا | `'كتابة الأطروحة'::text` |
| `defense_date` | text | لا | `''::text` |
| `grade_label` | text | لا | `'قيد الإعداد'::text` |
| `created_at` | bigint | لا | — |

### `proc_asset_moves`

- **الغرض:** حركات الأصول
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `asset_id` ← `proc_assets.id` (حذف: CASCADE)؛ `from_wh` ← `proc_warehouses.id` (حذف: NO ACTION)؛ `moved_by` ← `users.id` (حذف: NO ACTION)؛ `to_wh` ← `proc_warehouses.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE proc_asset_moves_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `asset_id` | bigint | لا | — |
| `kind` | text | لا | — |
| `from_wh` | bigint | نعم | — |
| `to_wh` | bigint | نعم | — |
| `to_user` | text | لا | `''::text` |
| `reason` | text | لا | `''::text` |
| `moved_at` | bigint | لا | — |
| `moved_by` | bigint | نعم | — |

### `proc_assets`

- **الغرض:** الأصول
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `supplier_id` ← `proc_suppliers.id` (حذف: NO ACTION)؛ `warehouse_id` ← `proc_warehouses.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`
- **الفهارس (5):** `idx_proc_assets_code (code)`؛ `idx_proc_assets_status (status)`؛ `idx_proc_assets_wh (warehouse_id)`؛ `UNIQUE proc_assets_code_key (code)`؛ `UNIQUE proc_assets_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `category` | text | لا | `'عام'::text` |
| `warehouse_id` | bigint | نعم | — |
| `status` | text | لا | `'available'::text` |
| `purchase_day` | text | نعم | — |
| `cost` | bigint | لا | `0` |
| `supplier_id` | bigint | نعم | — |
| `assigned_to` | text | لا | `''::text` |
| `notes` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `proc_categories`

- **الغرض:** تصنيفات الأصناف
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `code`
- **الفهارس (2):** `UNIQUE proc_categories_code_key (code)`؛ `UNIQUE proc_categories_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `active` | bigint | لا | `1` |

### `proc_issue_lines`

- **الغرض:** بنود الصرف
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `issue_id` ← `proc_issues.id` (حذف: CASCADE)؛ `item_id` ← `proc_items.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE proc_issue_lines_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `issue_id` | bigint | لا | — |
| `item_id` | bigint | لا | — |
| `qty` | bigint | لا | — |

### `proc_issues`

- **الغرض:** الصرف
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `warehouse_id` ← `proc_warehouses.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (3):** `idx_proc_issues_warehouse (warehouse_id, issued_at)`؛ `UNIQUE proc_issues_no_key (no)`؛ `UNIQUE proc_issues_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `no` | text | لا | — |
| `warehouse_id` | bigint | لا | — |
| `issued_to` | text | لا | — |
| `purpose` | text | لا | `''::text` |
| `issued_at` | bigint | لا | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `reversed_at` | bigint | نعم | — |
| `reversed_by` | bigint | نعم | — |

### `proc_items`

- **الغرض:** الأصناف
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `category_id` ← `proc_categories.id` (حذف: NO ACTION)؛ `warehouse_id` ← `proc_warehouses.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`
- **الفهارس (6):** `idx_proc_items_active (active, qty_on_hand)`؛ `idx_proc_items_cat (category_id)`؛ `idx_proc_items_code (code)`؛ `idx_proc_items_wh (warehouse_id)`؛ `UNIQUE proc_items_code_key (code)`؛ `UNIQUE proc_items_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `category_id` | bigint | نعم | — |
| `unit` | text | لا | `'قطعة'::text` |
| `warehouse_id` | bigint | نعم | — |
| `qty_on_hand` | bigint | لا | `0` |
| `avg_cost` | bigint | لا | `0` |
| `min_stock` | bigint | لا | `0` |
| `max_stock` | bigint | لا | `0` |
| `active` | bigint | لا | `1` |
| `notes` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `proc_order_lines`

- **الغرض:** بنود الأوامر
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `item_id` ← `proc_items.id` (حذف: NO ACTION)؛ `order_id` ← `proc_orders.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_proc_order_lines_order (order_id)`؛ `UNIQUE proc_order_lines_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `order_id` | bigint | لا | — |
| `item_id` | bigint | نعم | — |
| `description` | text | لا | — |
| `qty` | bigint | لا | — |
| `unit_cost` | bigint | لا | `0` |
| `line_total` | bigint | لا | `0` |

### `proc_orders`

- **الغرض:** أوامر التوريد
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `request_id` ← `proc_requests.id` (حذف: NO ACTION)؛ `supplier_id` ← `proc_suppliers.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (5):** `idx_proc_orders_created (created_at DESC)`؛ `idx_proc_orders_status (status)`؛ `idx_proc_orders_supplier (supplier_id)`؛ `UNIQUE proc_orders_no_key (no)`؛ `UNIQUE proc_orders_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `no` | text | لا | — |
| `request_id` | bigint | نعم | — |
| `supplier_id` | bigint | لا | — |
| `status` | text | لا | `'draft'::text` |
| `total_amount` | bigint | لا | `0` |
| `ordered_at` | bigint | نعم | — |
| `received_at` | bigint | نعم | — |
| `note` | text | لا | `''::text` |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `proc_receipt_lines`

- **الغرض:** بنود الاستلام
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `item_id` ← `proc_items.id` (حذف: NO ACTION)؛ `receipt_id` ← `proc_receipts.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE proc_receipt_lines_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `receipt_id` | bigint | لا | — |
| `item_id` | bigint | لا | — |
| `qty` | bigint | لا | — |
| `unit_cost` | bigint | لا | `0` |

### `proc_receipts`

- **الغرض:** الاستلام
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `order_id` ← `proc_orders.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `UNIQUE idx_proc_receipts_import_ref (import_ref)`؛ `UNIQUE proc_receipts_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `order_id` | bigint | لا | — |
| `received_at` | bigint | لا | — |
| `note` | text | لا | `''::text` |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `import_ref` | text | نعم | — |
| `reversed_at` | bigint | نعم | — |
| `reversed_by` | bigint | نعم | — |

### `proc_request_lines`

- **الغرض:** بنود الطلبات
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `item_id` ← `proc_items.id` (حذف: NO ACTION)؛ `request_id` ← `proc_requests.id` (حذف: CASCADE)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_proc_req_lines_req (request_id)`؛ `UNIQUE proc_request_lines_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `request_id` | bigint | لا | — |
| `item_id` | bigint | نعم | — |
| `description` | text | لا | — |
| `qty` | bigint | لا | — |
| `est_cost` | bigint | لا | `0` |
| `note` | text | لا | `''::text` |

### `proc_requests`

- **الغرض:** طلبات الشراء
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `decided_by` ← `users.id` (حذف: NO ACTION)؛ `requester_id` ← `users.id` (حذف: NO ACTION)؛ `warehouse_id` ← `proc_warehouses.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (5):** `idx_proc_requests_created (created_at DESC)`؛ `idx_proc_requests_requester (requester_id)`؛ `idx_proc_requests_status (status)`؛ `UNIQUE proc_requests_no_key (no)`؛ `UNIQUE proc_requests_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `no` | text | لا | — |
| `title` | text | لا | — |
| `description` | text | لا | `''::text` |
| `requester_id` | bigint | لا | — |
| `warehouse_id` | bigint | نعم | — |
| `status` | text | لا | `'draft'::text` |
| `requested_at` | bigint | نعم | — |
| `decided_by` | bigint | نعم | — |
| `decided_at` | bigint | نعم | — |
| `decision_note` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `proc_suppliers`

- **الغرض:** الموردون
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `code`
- **الفهارس (2):** `UNIQUE proc_suppliers_code_key (code)`؛ `UNIQUE proc_suppliers_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `phone` | text | نعم | — |
| `email` | text | نعم | — |
| `address` | text | نعم | — |
| `tax_no` | text | نعم | — |
| `active` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `proc_warehouses`

- **الغرض:** المستودعات
- **المجموعة:** المشتريات والمخازن
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `manager_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`
- **الفهارس (2):** `UNIQUE proc_warehouses_code_key (code)`؛ `UNIQUE proc_warehouses_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `name` | text | لا | — |
| `location` | text | لا | `''::text` |
| `manager_id` | bigint | نعم | — |
| `active` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `programs`

- **الغرض:** البرامج الدراسية
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `faculty_id` ← `faculties.id` (حذف: NO ACTION)
- **قيود فريدة:** `degree,faculty,name`
- **الفهارس (2):** `UNIQUE programs_faculty_name_degree_key (faculty, name, degree)`؛ `UNIQUE programs_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `faculty` | text | لا | — |
| `name` | text | لا | — |
| `degree` | text | لا | `'بكالوريوس'::text` |
| `years` | bigint | لا | `4` |
| `active` | bigint | لا | `1` |
| `faculty_id` | bigint | نعم | — |

### `push_subscriptions`

- **الغرض:** اشتراكات تنبيهات الجوال
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `endpoint`
- **الفهارس (3):** `idx_push_user (user_id)`؛ `UNIQUE push_subscriptions_endpoint_key (endpoint)`؛ `UNIQUE push_subscriptions_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `user_id` | bigint | لا | — |
| `endpoint` | text | لا | — |
| `p256dh` | text | لا | — |
| `auth` | text | لا | — |
| `ua` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `qa_accreditations`

- **الغرض:** ملفات الاعتماد
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE qa_accreditations_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `program_name` | text | لا | — |
| `agency_name` | text | لا | — |
| `standard_code` | text | لا | — |
| `self_study_progress` | bigint | لا | `80` |
| `audit_date` | text | لا | — |
| `status` | text | لا | `'قيد المراجعة'::text` |
| `notes` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `qa_kpis`

- **الغرض:** مؤشرات الجودة
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `code`
- **الفهارس (2):** `UNIQUE qa_kpis_code_key (code)`؛ `UNIQUE qa_kpis_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `title` | text | لا | — |
| `standard_domain` | text | لا | — |
| `target_value` | double precision | لا | — |
| `actual_value` | double precision | لا | — |
| `unit` | text | لا | `'%'::text` |
| `status` | text | لا | `'متحقق'::text` |
| `academic_year` | text | لا | `'2026/2027'::text` |
| `updated_at` | bigint | لا | — |

### `qa_surveys`

- **الغرض:** استبيانات الجودة
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE qa_surveys_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `instructor_name` | text | لا | — |
| `semester` | text | لا | `'الفصل الأول 2026/2027'::text` |
| `responses_count` | bigint | لا | `0` |
| `content_score` | double precision | لا | `4.5` |
| `teaching_score` | double precision | لا | `4.6` |
| `assessment_score` | double precision | لا | `4.4` |
| `overall_score` | double precision | لا | `4.5` |
| `notes` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `request_events`

- **الغرض:** أحداث الطلب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `request_id` ← `requests.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `idx_events_request (request_id)`؛ `idx_hf_request_events_req_id (request_id, id)`؛ `UNIQUE request_events_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `request_id` | bigint | لا | — |
| `at` | bigint | لا | — |
| `actor_label` | text | لا | — |
| `text` | text | لا | — |

### `requests`

- **الغرض:** طلبات الطلاب والمعاملات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `assigned_unit_id` ← `org_units.id` (حذف: NO ACTION)؛ `decided_by` ← `users.id` (حذف: NO ACTION)؛ `service_code` ← `service_types.code` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `no`
- **الفهارس (15):** `idx_hc_requests_service_status (service_code, status)`؛ `idx_hc_requests_status_created (status, created_at DESC)`؛ `idx_hc_requests_student_created (student_id, created_at DESC)`؛ `idx_hf_requests_student_status_service (student_id, status, service_code)`؛ `idx_hf_requests_unit_status_created (assigned_unit_id, status, created_at DESC)`؛ `idx_perf_requests_student_status_date (student_id, status, created_at DESC)`؛ `idx_perf_requests_unit_status_date (assigned_unit_id, status, created_at DESC)`؛ `idx_requests_created (created_at DESC)`؛ `idx_requests_service (service_code, status)`؛ `idx_requests_status (status, created_at)`؛ `idx_requests_student (student_id, created_at)`؛ `idx_requests_student_service (student_id, service_code)`؛ `idx_requests_unit (assigned_unit_id, status)`؛ `UNIQUE requests_no_key (no)`؛ `UNIQUE requests_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `no` | text | لا | — |
| `student_id` | bigint | لا | — |
| `service_code` | text | لا | — |
| `details_json` | text | لا | — |
| `status` | text | لا | — |
| `reject_reason` | text | نعم | — |
| `rejected_by` | text | نعم | — |
| `created_at` | bigint | لا | — |
| `decided_at` | bigint | نعم | — |
| `decided_by` | bigint | نعم | — |
| `assigned_unit_id` | bigint | نعم | — |

### `research_projects`

- **الغرض:** المشاريع البحثية
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `code`
- **الفهارس (2):** `UNIQUE research_projects_code_key (code)`؛ `UNIQUE research_projects_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `code` | text | لا | — |
| `title` | text | لا | — |
| `principal_investigator` | text | لا | — |
| `faculty_name` | text | لا | — |
| `domain` | text | لا | — |
| `budget` | double precision | لا | `0` |
| `journal_name` | text | لا | `''::text` |
| `impact_factor` | double precision | لا | `0` |
| `citations_count` | bigint | لا | `0` |
| `status` | text | لا | `'active'::text` |
| `published_at` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |

### `roles`

- **الغرض:** الأدوار وصلاحياتها
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `key`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_roles_active_created (active, created_at)`؛ `UNIQUE roles_pkey (key)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `key` | text | لا | — |
| `label` | text | لا | — |
| `description` | text | لا | `''::text` |
| `permissions_json` | text | لا | — |
| `active` | bigint | لا | `1` |
| `created_at` | bigint | لا | — |

### `rules`

- **الغرض:** قواعد الفحص الآلي للطلبات
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `service_code` ← `service_types.code` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE rules_new_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `service_code` | text | نعم | — |
| `kind` | text | لا | — |
| `params_json` | text | لا | `'{}'::text` |
| `message` | text | لا | — |
| `enabled` | bigint | لا | `1` |

### `sa_advising_warnings`

- **الغرض:** الإرشاد والإنذارات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_sa_warnings_student_status (student_id, status, created_at DESC)`؛ `UNIQUE sa_advising_warnings_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `warning_type` | text | لا | — |
| `severity` | text | لا | `'warning'::text` |
| `gpa_snapshot` | double precision | نعم | — |
| `absence_rate` | double precision | نعم | — |
| `failed_courses_count` | bigint | نعم | `0` |
| `advisor_name` | text | لا | — |
| `action_plan` | text | لا | — |
| `session_date` | text | لا | — |
| `status` | text | لا | `'open'::text` |
| `created_at` | bigint | لا | — |

### `sa_applicants`

- **الغرض:** المتقدمون والمفاضلة
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `application_no`
- **الفهارس (4):** `idx_hf_sa_applicants_nid (national_id)`؛ `idx_hf_sa_applicants_status_score (sorting_status, hs_score DESC)`؛ `UNIQUE sa_applicants_application_no_key (application_no)`؛ `UNIQUE sa_applicants_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `application_no` | text | لا | — |
| `full_name` | text | لا | — |
| `national_id` | text | لا | — |
| `phone` | text | نعم | — |
| `hs_type` | text | لا | `'علمي'::text` |
| `hs_score` | double precision | لا | — |
| `hs_year` | bigint | لا | `2026` |
| `category` | text | لا | `'general'::text` |
| `pref1_program_id` | bigint | لا | — |
| `pref2_program_id` | bigint | نعم | — |
| `pref3_program_id` | bigint | نعم | — |
| `accepted_program_id` | bigint | نعم | — |
| `sorting_status` | text | لا | `'pending'::text` |
| `enrolled_student_id` | bigint | نعم | — |
| `notes` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `sa_card_activity_logs`

- **الغرض:** سجل نشاط البطاقة
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (3):** `idx_sa_card_logs_student (student_id)`؛ `idx_sa_card_logs_time (created_at DESC)`؛ `UNIQUE sa_card_activity_logs_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `event_type` | text | لا | `'check_in'::text` |
| `location_name` | text | لا | — |
| `location_code` | text | لا | — |
| `method` | text | لا | `'nfc'::text` |
| `terminal_id` | text | لا | — |
| `status` | text | لا | `'granted'::text` |
| `reason` | text | نعم | — |
| `pki_hash` | text | لا | — |
| `created_at` | bigint | لا | — |

### `sa_course_prerequisites`

- **الغرض:** المتطلبات السابقة
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `course_id,prereq_course_id`
- **الفهارس (3):** `idx_hf_sa_prereq_course (course_id, prereq_course_id)`؛ `UNIQUE sa_course_prerequisites_course_id_prereq_course_id_key (course_id, prereq_course_id)`؛ `UNIQUE sa_course_prerequisites_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_id` | bigint | لا | — |
| `prereq_course_id` | bigint | لا | — |
| `min_mark` | double precision | لا | `60` |

### `sa_credit_equivalences`

- **الغرض:** معادلة المقررات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_sa_equiv_student_status (student_id, equivalence_status)`؛ `UNIQUE sa_credit_equivalences_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `source_university` | text | لا | — |
| `external_course_code` | text | لا | — |
| `external_course_name` | text | لا | — |
| `external_hours` | bigint | لا | `3` |
| `external_mark` | double precision | لا | — |
| `internal_course_id` | bigint | لا | — |
| `equivalence_status` | text | لا | `'approved'::text` |
| `decided_by` | text | نعم | — |
| `note` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `sa_desk_appointments`

- **الغرض:** طابور مكتب الخدمة
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `ticket_no`
- **الفهارس (4):** `idx_hf_sa_appointments_status_date (queue_status, appointment_date, created_at DESC)`؛ `idx_hf_sa_appointments_student (student_id, created_at DESC)`؛ `UNIQUE sa_desk_appointments_pkey (id)`؛ `UNIQUE sa_desk_appointments_ticket_no_key (ticket_no)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `ticket_no` | text | لا | — |
| `student_id` | bigint | لا | — |
| `request_id` | bigint | نعم | — |
| `service_purpose` | text | لا | — |
| `appointment_date` | text | لا | — |
| `time_slot` | text | لا | — |
| `counter_window` | text | لا | `'النافذة 1 — تسليم الوثائق المصدقة'::text` |
| `queue_status` | text | لا | `'waiting'::text` |
| `called_at` | bigint | نعم | — |
| `completed_at` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `sa_disciplinary_details`

- **الغرض:** تفاصيل القرارات الانضباطية
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `hold_id`
- **الفهارس (2):** `UNIQUE sa_disciplinary_details_hold_id_key (hold_id)`؛ `UNIQUE sa_disciplinary_details_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `hold_id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `committee_decision_no` | text | لا | — |
| `violation_category` | text | لا | — |
| `penalty_level` | text | لا | — |
| `blocks_documents` | bigint | لا | `1` |
| `expires_at` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `sa_lifecycle_movements`

- **الغرض:** حركات القيد
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `movement_no`
- **الفهارس (3):** `idx_hf_sa_movements_student_created (student_id, created_at DESC)`؛ `UNIQUE sa_lifecycle_movements_movement_no_key (movement_no)`؛ `UNIQUE sa_lifecycle_movements_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `movement_no` | text | لا | — |
| `student_id` | bigint | لا | — |
| `movement_type` | text | لا | — |
| `academic_year` | text | لا | — |
| `semester` | bigint | لا | `1` |
| `from_status` | text | لا | — |
| `to_status` | text | لا | — |
| `from_program_id` | bigint | نعم | — |
| `to_program_id` | bigint | نعم | — |
| `financial_impact` | text | نعم | — |
| `academic_impact` | text | نعم | — |
| `decision_no` | text | نعم | — |
| `reason` | text | نعم | — |
| `status` | text | لا | `'approved'::text` |
| `created_by` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `sa_scholarships`

- **الغرض:** المنح في منظومة شؤون الطلاب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `grant_no`
- **الفهارس (3):** `idx_hf_sa_scholarships_student_status (student_id, status)`؛ `UNIQUE sa_scholarships_grant_no_key (grant_no)`؛ `UNIQUE sa_scholarships_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `grant_no` | text | لا | — |
| `student_id` | bigint | لا | — |
| `scholarship_type` | text | لا | — |
| `discount_percent` | double precision | لا | — |
| `amount` | double precision | لا | — |
| `academic_year` | text | لا | `'2025-2026'::text` |
| `gpa_at_grant` | double precision | نعم | — |
| `fin_charge_id` | bigint | نعم | — |
| `status` | text | لا | `'active'::text` |
| `approved_by` | text | نعم | — |
| `note` | text | نعم | — |
| `created_at` | bigint | لا | — |

### `schema_migrations`

- **الغرض:** الترحيلات المطبقة
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `name`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE schema_migrations_pkey (name)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `name` | text | لا | — |
| `applied_at` | bigint | لا | — |

### `scholarships`

- **الغرض:** سجل منح إداري ثانٍ (يتداخل مع sa_scholarships)
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE scholarships_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_name` | text | لا | — |
| `student_no` | text | لا | — |
| `program_name` | text | لا | — |
| `scholarship_type` | text | لا | — |
| `discount_percent` | bigint | لا | `50` |
| `amount_covered` | double precision | لا | `0` |
| `academic_year` | text | لا | `'2026/2027'::text` |
| `status` | text | لا | `'مفعّلة'::text` |
| `created_at` | bigint | لا | — |

### `service_types`

- **الغرض:** أنواع الخدمات ونماذجها
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `code`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE service_types_pkey (code)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `code` | text | لا | — |
| `label` | text | لا | — |
| `description` | text | لا | — |
| `sla_hours` | bigint | لا | — |
| `requires_attachment` | bigint | لا | `0` |
| `issues_document` | bigint | لا | `1` |
| `fields_json` | text | لا | — |
| `enabled` | bigint | لا | `1` |
| `unit_code` | text | نعم | — |
| `audience` | text | لا | `'student'::text` |
| `category` | text | نعم | — |
| `instructions` | text | لا | `''::text` |
| `attachments_json` | text | لا | `'[]'::text` |
| `max_attachments` | bigint | لا | `1` |
| `rowid` | bigint | لا | — |

### `sessions`

- **الغرض:** جلسات الدخول (بصمة الرمز)
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `token_hash`
- **مفاتيح أجنبية:** `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (5):** `idx_hc_sessions_token_exp (token_hash, expires_at)`؛ `idx_hc_sessions_user_exp (user_id, expires_at)`؛ `idx_perf_sessions_token_valid (token_hash, expires_at, user_id)`؛ `idx_sessions_user (user_id)`؛ `UNIQUE sessions_pkey (token_hash)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `token_hash` | text | لا | — |
| `user_id` | bigint | لا | — |
| `created_at` | bigint | لا | — |
| `expires_at` | bigint | لا | — |
| `ip` | text | نعم | — |
| `user_agent` | text | نعم | — |
| `fingerprint` | text | نعم | — |

### `site_settings`

- **الغرض:** الإعدادات العامة
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `key`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_site_settings_key (key)`؛ `UNIQUE site_settings_pkey (key)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `key` | text | لا | — |
| `value` | text | لا | — |

### `smart_schedule_slots`

- **الغرض:** جدول ذكي ثانٍ (يتداخل مع course_schedules)
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE smart_schedule_slots_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `faculty_name` | text | لا | — |
| `instructor_name` | text | لا | — |
| `hall_code` | text | لا | — |
| `day_name` | text | لا | — |
| `time_slot` | text | لا | — |
| `section_code` | text | نعم | `'شعبة 1'::text` |
| `enrolled_count` | bigint | نعم | `35` |
| `capacity` | bigint | نعم | `60` |
| `status` | text | نعم | `'معتمد'::text` |
| `created_at` | bigint | لا | — |

### `staff_attendance`

- **الغرض:** حضور الموظفين الذاتي
- **المجموعة:** الموارد البشرية
- **المفتاح الأساسي:** `day`، `user_id`
- **مفاتيح أجنبية:** `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `staff_att_day (day)`؛ `UNIQUE staff_attendance_pkey (user_id, day)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `user_id` | bigint | لا | — |
| `day` | text | لا | — |
| `check_in` | bigint | لا | — |
| `check_out` | bigint | نعم | — |

### `student_activities`

- **الغرض:** الأنشطة الطلابية
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE student_activities_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `club_name` | text | لا | — |
| `title` | text | لا | — |
| `category` | text | لا | `'علمي'::text` |
| `event_date` | text | لا | — |
| `location` | text | لا | — |
| `supervisor_name` | text | لا | — |
| `participants_count` | bigint | لا | `25` |
| `budget` | double precision | لا | `0` |
| `status` | text | لا | `'قادم'::text` |

### `student_certs`

- **الغرض:** شهادات التسجيل الموقعة
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `code`، `pdf_sha256`، `student_id`
- **الفهارس (4):** `UNIQUE student_certs_code_key (code)`؛ `UNIQUE student_certs_pdf_sha256_key (pdf_sha256)`؛ `UNIQUE student_certs_pkey (id)`؛ `UNIQUE student_certs_student_id_key (student_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `code` | text | لا | — |
| `payload_json` | text | لا | — |
| `payload_sha256` | text | لا | — |
| `pdf_sha256` | text | لا | — |
| `file` | text | لا | — |
| `created_at` | bigint | لا | — |
| `signed_at` | bigint | لا | — |
| `tsa_status` | text | لا | — |
| `tsa_url` | text | نعم | — |
| `tsa_time` | bigint | نعم | — |
| `cert_subject` | text | لا | — |
| `cert_fingerprint` | text | لا | — |
| `cert_self_signed` | bigint | لا | — |
| `pdf_b64` | text | نعم | — |

### `student_fee_installments`

- **الغرض:** أقساط الرسوم (مسار موازٍ لدفتر المالية)
- **المجموعة:** المالية
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** `installment_code`
- **الفهارس (3):** `idx_hf_student_installments_stu_status (student_no, status)`؛ `UNIQUE student_fee_installments_installment_code_key (installment_code)`؛ `UNIQUE student_fee_installments_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `installment_code` | text | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `faculty_name` | text | لا | — |
| `installment_no` | bigint | لا | — |
| `amount` | double precision | لا | — |
| `due_date` | text | لا | — |
| `paid_amount` | double precision | نعم | `0` |
| `payment_method` | text | نعم | `''::text` |
| `receipt_no` | text | نعم | `''::text` |
| `status` | text | نعم | `'غير مسدد'::text` |
| `paid_at` | bigint | نعم | `0` |

### `student_file_meta`

- **الغرض:** بيانات تدقيق ملف الطالب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `student_id`
- **مفاتيح أجنبية:** `audited_by` ← `users.id` (حذف: SET NULL)؛ `student_id` ← `users.id` (حذف: CASCADE)؛ `updated_by` ← `users.id` (حذف: SET NULL)
- **قيود فريدة:** لا يوجد
- **الفهارس (1):** `UNIQUE student_file_meta_pkey (student_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `student_id` | bigint | لا | — |
| `general_notes` | text | لا | `''::text` |
| `box_no` | text | لا | `''::text` |
| `dossier_no` | text | لا | `''::text` |
| `cert_notes` | text | لا | `''::text` |
| `exception_note` | text | لا | `''::text` |
| `audited` | bigint | لا | `0` |
| `audited_by` | bigint | نعم | — |
| `audited_at` | bigint | نعم | — |
| `updated_by` | bigint | نعم | — |
| `updated_at` | bigint | نعم | — |

### `student_files`

- **الغرض:** مرفقات ملف الطالب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_student_files_student (student_id, kind)`؛ `UNIQUE student_files_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `kind` | text | لا | — |
| `file` | text | لا | — |
| `orig_name` | text | لا | — |
| `mime` | text | لا | — |
| `size` | bigint | لا | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |

### `student_group_members`

- **الغرض:** أعضاء الفئات
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `group_id` ← `student_groups.id` (حذف: CASCADE)؛ `student_id` ← `users.id` (حذف: CASCADE)
- **قيود فريدة:** `group_id,student_id`
- **الفهارس (3):** `idx_student_group_members_student (student_id)`؛ `UNIQUE student_group_members_group_id_student_id_key (group_id, student_id)`؛ `UNIQUE student_group_members_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `group_id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `added_at` | bigint | لا | — |

### `student_groups`

- **الغرض:** فئات الطلاب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `program_id` ← `programs.id` (حذف: SET NULL)
- **قيود فريدة:** `name`
- **الفهارس (2):** `UNIQUE student_groups_name_key (name)`؛ `UNIQUE student_groups_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `name` | text | لا | — |
| `kind` | text | لا | `'lecture'::text` |
| `program_id` | bigint | نعم | — |
| `notes` | text | لا | `''::text` |
| `created_at` | bigint | لا | — |
| `updated_at` | bigint | نعم | — |

### `student_holds`

- **الغرض:** موانع الطالب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `student_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** لا يوجد
- **الفهارس (4):** `idx_hf_student_holds_active_id (active, id DESC)`؛ `idx_hf_student_holds_student_active (student_id, active)`؛ `idx_holds_student (student_id, active)`؛ `UNIQUE student_holds_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_id` | bigint | لا | — |
| `hold_type` | text | لا | — |
| `note` | text | نعم | — |
| `active` | bigint | لا | `1` |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `cleared_at` | bigint | نعم | — |

### `student_profiles`

- **الغرض:** الملف الشخصي والأكاديمي للطالب
- **المجموعة:** الطلاب والقبول والخدمات
- **المفتاح الأساسي:** `user_id`
- **مفاتيح أجنبية:** `created_by` ← `users.id` (حذف: NO ACTION)؛ `program_id` ← `programs.id` (حذف: NO ACTION)؛ `user_id` ← `users.id` (حذف: NO ACTION)
- **قيود فريدة:** `national_id`
- **الفهارس (11):** `idx_perf_profiles_fullname (first_name, father_name, last_name)`؛ `idx_perf_profiles_national_id (national_id)`؛ `idx_perf_profiles_program_level_status (program_id, study_level, status)`؛ `idx_perf_profiles_status_created (status, created_at DESC, user_id DESC)`؛ `idx_profiles_nid (national_id)`؛ `idx_profiles_program (program_id, enroll_year)`؛ `idx_profiles_program_year (program_id, enroll_year)`؛ `idx_profiles_status (status)`؛ `idx_profiles_status_year (status, enroll_year)`؛ `UNIQUE student_profiles_national_id_key (national_id)`؛ `UNIQUE student_profiles_pkey (user_id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `user_id` | bigint | لا | — |
| `first_name` | text | لا | — |
| `father_name` | text | لا | — |
| `last_name` | text | لا | — |
| `mother_name` | text | لا | — |
| `name_en` | text | نعم | — |
| `national_id` | text | لا | — |
| `gender` | text | لا | — |
| `birth_date` | text | لا | — |
| `birth_place` | text | لا | — |
| `nationality` | text | لا | — |
| `marital_status` | text | نعم | — |
| `phone` | text | لا | — |
| `email` | text | نعم | — |
| `governorate` | text | لا | — |
| `city` | text | لا | — |
| `address` | text | لا | — |
| `hs_type` | text | لا | — |
| `hs_year` | bigint | لا | — |
| `hs_school` | text | نعم | — |
| `hs_governorate` | text | نعم | — |
| `hs_score` | double precision | لا | — |
| `program_id` | bigint | لا | — |
| `admission_type` | text | لا | — |
| `enroll_year` | bigint | لا | — |
| `enroll_term` | text | لا | — |
| `study_level` | bigint | لا | — |
| `status` | text | لا | `'active'::text` |
| `guardian_name` | text | لا | — |
| `guardian_relation` | text | لا | — |
| `guardian_phone` | text | لا | — |
| `emergency_phone` | text | نعم | — |
| `notes` | text | نعم | — |
| `created_by` | bigint | نعم | — |
| `created_at` | bigint | لا | — |
| `updated_at` | bigint | لا | — |
| `ministerial_no` | text | نعم | — |
| `extra_json` | text | نعم | — |

### `student_self_enrollments`

- **الغرض:** التسجيل الذاتي للمقررات
- **المجموعة:** الأكاديمي والامتحانات والتعلم
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** لا يوجد
- **قيود فريدة:** لا يوجد
- **الفهارس (2):** `idx_hf_self_enrollments_stu_sem (student_no, semester)`؛ `UNIQUE student_self_enrollments_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `student_no` | text | لا | — |
| `student_name` | text | لا | — |
| `course_code` | text | لا | — |
| `course_name` | text | لا | — |
| `credits` | bigint | نعم | `3` |
| `semester` | text | نعم | `'الفصل الأول 2026/2027'::text` |
| `prerequisite_code` | text | نعم | `''::text` |
| `status` | text | نعم | `'مسجل'::text` |
| `registered_at` | bigint | لا | — |

### `unit_links`

- **الغرض:** مسارات الإحالة بين الوحدات
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `from_unit` ← `org_units.id` (حذف: NO ACTION)؛ `to_unit` ← `org_units.id` (حذف: NO ACTION)
- **قيود فريدة:** `from_unit,to_unit`
- **الفهارس (4):** `idx_hf_unit_links_from_two (from_unit, to_unit, two_way)`؛ `idx_hf_unit_links_to_two (to_unit, two_way, from_unit)`؛ `UNIQUE unit_links_from_unit_to_unit_key (from_unit, to_unit)`؛ `UNIQUE unit_links_pkey (id)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `from_unit` | bigint | لا | — |
| `to_unit` | bigint | لا | — |
| `two_way` | bigint | لا | `0` |
| `created_at` | bigint | لا | — |

### `users`

- **الغرض:** حسابات الدخول لكل الموظفين والطلاب
- **المجموعة:** الهوية والصلاحيات والنظام
- **المفتاح الأساسي:** `id`
- **مفاتيح أجنبية:** `role_key` ← `roles.key` (حذف: NO ACTION)؛ `unit_id` ← `org_units.id` (حذف: NO ACTION)
- **قيود فريدة:** `student_no`، `username`
- **الفهارس (9):** `idx_hc_users_active_role (active, role, unit_id)`؛ `idx_hf_users_role_key_active (role_key, active)`؛ `idx_hf_users_unit_active (unit_id, active, role)`؛ `idx_hf_users_username_nocase (username)`؛ `idx_users_active (active)`؛ `idx_users_student_no2 (student_no) WHERE (student_no IS NOT NULL)`؛ `UNIQUE users_pkey (id)`؛ `UNIQUE users_student_no_key (student_no)`؛ `UNIQUE users_username_key (username)`

| العمود | النوع | يقبل NULL | الافتراضي |
|---|---|---|---|
| `id` | bigint | لا | — |
| `username` | text | لا | — |
| `display_name` | text | لا | — |
| `password_hash` | text | لا | — |
| `role` | text | لا | — |
| `student_no` | text | نعم | — |
| `program` | text | نعم | — |
| `unit_id` | bigint | نعم | — |
| `active` | bigint | لا | `1` |
| `failed_logins` | bigint | لا | `0` |
| `locked_until` | bigint | لا | `0` |
| `created_at` | bigint | لا | — |
| `must_change_password` | bigint | لا | `0` |
| `role_key` | text | نعم | — |
| `staff_kind` | text | لا | `'admin'::text` |
| `job_title` | text | لا | `''::text` |
| `access_mode` | text | لا | `'role'::text` |
| `data_scope` | text | لا | `'unit'::text` |
| `module_access_json` | text | نعم | `'{}'::text` |
| `custom_permissions_json` | text | نعم | `'[]'::text` |
| `revoked_permissions_json` | text | نعم | `'[]'::text` |
| `allowed_views_json` | text | نعم | `'[]'::text` |
| `hidden_tabs_json` | text | لا | `'[]'::text` |
