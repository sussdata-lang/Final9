# CODEMAP — أين يتم كل طلب تعديل (SUSS / uni-erp v12.9)

فُحص في 2026-11-03 من الكود نفسه. التفاصيل الكاملة (391 مساراً، 123 جدولاً، الشاشات، الاختبارات) في [CODEMAP.index.md](CODEMAP.index.md).

> عند التعارض، الكود هو المرجع. `uni-erp/README.md` و`PROJECT_MAP.md` و`docs/ARCHITECTURE.md` قديمة في أجزاء منها: تذكر SQLite و«صفر اعتماديات» وآخر ترحيل 023، بينما النظام الحالي يعمل على PostgreSQL فقط (`pg`) وآخر ترحيل 042.

## 1) تطبيق واحد

| | `uni-erp/` |
|---|---|
| الواجهة | Vanilla JS: `uni-erp/public/*.js`، بلا بناء |
| الخادم | `node:http` مع `Router` خاص: `uni-erp/server/` |
| التشغيل | `Dockerfile.railway` ← `scripts/start-cloud.js` |

حُذف تطبيق الاستوديو (React) من الجذر؛ يبقى في تاريخ git. ملفات الجذر الباقية للنشر: `Dockerfile.railway` و`railway.json` و`docker-entrypoint.sh` و`scripts/`.

**العمليات الثقيلة:** الخيط الرئيسي ينتظر كل استعلام متزامناً، فأي عملية طويلة فيه توقف كل المستخدمين. الاستيراد والتقارير الكبيرة تعمل عبر `deps.heavy.run` (`server/heavy.js` و`heavy_worker.js`) في خيوط مستقلة. أضف كل عملية ثقيلة جديدة إلى `JOBS` في `heavy_worker.js`. سجل التدقيق يُكتب من الخيط الرئيسي فقط.

**تحميل الواجهة:** `LAZY` في `public/app.js` يحدد ملفات الأقسام التي تُحمَّل عند فتحها، و`i18n_lang.js` يحمّل قاموس الإنجليزية لمن يستخدمها فقط.

## 2) مسار الطلب

```
public/<module>.js ── api() ──► server/http.js (WAF، CSP، الجلسة، فحص الأصل)
                                   └► server/routes.js: need(c, 'perm')
                                        └► services/<module>.js ──► db.js (tx) ──► PostgreSQL
                                                              └► audit.js (سلسلة التدقيق)
```

`db.js` يقدّم واجهة متزامنة تشبه SQLite فوق PostgreSQL عبر `db_worker.js`، ويحوّل صيغة SQL. لذلك قد تكتب الاستعلامات بأسلوب SQLite.

## 3) خريطة الوحدات

المسارات أدناه نسبة إلى `uni-erp/`.

| الوحدة (الشاشة) | الواجهة | الخادم | الجداول (الترحيل) |
|---|---|---|---|
| الدخول والجلسات | `public/app.js` | `services/auth.js`، `security.js` | `users`، `sessions` (001) |
| الاستيراد الجدولي | `import.js` | `import_defs.js` (تعريف الأنواع: 72 نوعاً؛ المرجعي والموارد البشرية والطلاب ومالية الطلاب والمتفرقات ومستندات المشتريات والقيود؛ والمسار القديم عبر `import_staged.js`، وعينات لكل نوع في `import-samples/` يولّدها `generate.mjs`)، `import_engine.js` (فحص، حفظ، إلغاء، تراجع، قوالب)، ومسارات `/api/import-engine/*`. ما له قيد محاسبي (`fin_charges` و`fin_payments` و`sa_scholarships`) يمر عبر `createRow` و`revertRow` بدوال الوحدة نفسها، والتراجع قيد عكسي لا حذف. الأنواع القديمة ما زالت في `importer.js` | `import_staging`، `import_batches`، `import_changes` (038) |
| الإحصاءات والتقارير `dashboard` | `dashboard.js` (التبويبات والإحصاءات) + `analytics_panel.js` (الأقسام وDevOps) | `analytics.js`، `hr_integrated.js`، `v12_modules.js` | — |
| تبويب «أعمالي» داخل `overview` | `workspace.js` (الأقسام وتبويباتها في `SUBS`، والمثبتة والأخيرة في `localStorage`) | `services/desk.js` للأعداد | — |
| اللوحة الرئيسية `overview` | التركيب في `UA.views.overview` (`ux_restructure.js`)، والأجزاء من `UA.deskParts` (`desk.js`) و`UA.homeParts` (`shell.js`) | `services/desk.js`، `analytics.js` | — |
| شؤون الطلاب `affairs` | `app.js:243` (الإطار والتبويبات)، `student_affairs_suite.js`، `record360.js`، `idcard.js`، `student_picker.js` | `students.js`، `studentfiles.js`، `enrollcert.js`، `record360.js`، `student_affairs_suite.js` | `student_profiles` (002)، `sa_*` (029، 035) |
| نافذة الطالب «المعلومات الشخصية الرئيسية» | `student_file.js`، وفتحها من `stable.js` | `student_file.js`، `GET/PUT /api/students/:id/main-info` | `student_file_meta` (048) |
| حركة الواجهة والقوائم | `ux_flow.js` (التبويبات، الدرج، مهلة التراجع، نسخ التبويبات إلى الشريط الجانبي)، `ux_polish.js` (الأيقونات، الجداول، الأخطاء) | — | — |
| فئات الطلاب `sttab:groups` | `student_groups.js`، وتظهر في `v12_views.js` (الامتحانات) و`attendance.js` (جلسة القاعة) | `student_groups.js`، `import_defs.js` (نوعان) | `student_groups`، `student_group_members`، `exam_schedules.group_id` (049) |
| تبديل الحساب (محلي فقط) | `dev_switch.js` | `dev_accounts.js`، `/api/local-accounts` و`/api/local-switch`، لا يُسجَّلان إلا مع `DEMO_MODE=1` و`HOST` محلي | — |
| الطلبات والخدمات | `app.js`، `internal.js`، `adminconfig.js` | `requests.js`، `rules.js`، `documents.js`، `docpdf.js`، `catalog.js`، `requestsxl.js`، `forms/*` | `requests`، `service_types`، `documents` (001، 014) |
| بوابة الطالب | `student.js`، `transcript.js` | `students.js`، `academics.js`، `transcriptpdf.js`، `transcriptmodel.js` | `student_certs` (007) |
| المواد والعلامات `academics` | `ux_restructure.js:1008` ← يستدعي الأصل `staff.js:160`، `faculty.js` | `academics.js`، `workflow.js`، `schedule.js`، `faculty.js` | `courses`، `grades`، `grade_changes` (003، 011، 020) |
| سجل القاعات `attendance` | `attendance.js` | `services/attendance.js` | `hall_logs` (010) |
| الامتحانات والتظلمات `expansions` | `v12_views.js:752` + توسعات `ux_restructure.js:2832` و`3357` و`3913` | `v12_modules.js` | `exam_schedules`، `dorm_*` (025) |
| السكن والساعات المكتبية والمنح والأنشطة `student_life` (شؤون الطلاب، صلاحيتا `sa_housing:*`) | `v12_views.js` (`UA.views.student_life`) | `v12_modules.js` (`/api/student-life/overview`) | `office_hour_bookings`، `dorm_*`، `scholarships`، `student_activities` |
| كشف الرسوم للطالب `fees` | `student.js` (`feesD`) | `finance/routes.js` (`/api/me/fees`) | `fin_charges`، `fin_payments` |
| جدول محاضرات الطالب (يراعي الفئة) | `student.js` (`guideD`) | `schedule.js` (`studentTimetable`، `/api/me/timetable`) | `course_schedules.group_id` (051) |
| صفحة الحسابات: قائمة خفيفة، والتفاصيل عند الفتح | `access.js` (`xuedit`) | `useradmin.js` (`listStaffLight`، `staffDetail`، `/api/admin/users/:id/access`) | `users` |
| LMS / البحث / الخريجون / الجودة | `v12_views.js` (`lms:105`، `research:325`، `alumni:454`، `qa:593`) | `v12_modules.js` | (025) |
| الذكاء الاصطناعي `ai` | `v12_views.js:1618` | `v12_modules.js` | `ai_*` (025) |
| شؤون الموظفين `payroll` | `ux_restructure.js:347` ← `payroll.js`، `staffatt.js` | `hr_integrated.js`، `hr_calculations.js`، `hr.js`، `staffatt.js` | `hr_*` (021، 026)، (016) |
| الديوان والمراسلات `corr` | `ux_restructure.js:1794` ← `corr.js`، `internal.js` | `correspondence.js`، `corrpdf.js`، `corrTemplates.js` | `corr_*` (015، 017، 018) |
| المالية `finance` | `finance.js` | `finance/core.js`، `fees.js`، `reports.js`، `routes.js` | `fin_*` (022، 034) |
| المشتريات `procurement` | `procurement.js` | `procurement/core.js`، `routes.js` | `proc_*` (023) |
| الاستيراد والتصدير `exchange` | `exchange.js` ← `import.js`، `export.js` | `importer.js`، `dataexport.js` | — |
| الأخبار والشكاوى `comms` | `staff.js:287` | `academics.js`، `media.js`، `push.js` | `news`، `complaints` (003، 006) |
| الحسابات والصلاحيات `access` | `access.js` | `services/access.js`، `useradmin.js`، `server/permissions.js` | `roles`، `unit_links` (005، 030) |
| الإدارة `admin` | `app.js:307`، `adminconfig.js`، `general.js`، `units.js`، `backup.js` | `settings.js`، `site.js`، `backup.js`، `structure.js` | `site_settings` (004) |
| التدقيق والمراقبة `audit` | `ux_restructure.js:502` | `audit.js`، `lib/logger.js`، `waf.js`، `cache.js` | `audit_log` (001)، (027) |
| حزمة المؤسسة `enterprise` | `enterprise_suite.js` | `services/enterprise_suite.js` | (028) |

## 4) وصفات التعديل

| الطلب | ما يجب تعديله |
|---|---|
| **شاشة أو وحدة جديدة** | ترحيل `NNN_*.sql` ← خدمة في `services/` ← مسارات في `routes.js` ← صلاحيات في `permissions.js` (`PERMISSION_CATALOG`، `ALL_STAFF_VIEWS`، `computeAllowedViews`) ← ملف `public/x.js` يعرّف `UA.views.x` ← `<script>` في `index.html` ← `viewsFor` في `app.js` ← `NAV_ICON` و`NAV_GROUP` في `shell.js` |
| **حقل جديد في نموذج** | ترحيل ← الخدمة ← نموذج الواجهة، وكذلك `importer.js` و`dataexport.js` وقوالب `public/templates/` إن كان الحقل يُستورد أو يُصدَّر |
| **نموذج أو خدمة طلب جديدة** | `services/forms/*` (غالباً دون كود آخر) |
| **إعداد قابل للتغيير** | عنصر في `SCHEMA` في `settings.js`، ثم `getSetting` في مكان الثابت؛ يظهر تلقائياً في `general.js` |
| **صلاحية جديدة** | `permissions.js` + `need()` في المسار + `view_gate.js` إن أثّرت على تبويب فرعي. الأدوار الموجودة في الإنتاج لا تتحدث تلقائياً |
| **تبويب فرعي** | ملف الشاشة الفعّال (انظر §5) + `view_gate.js` |
| **تعديل مظهر** | `style.css` (112K)، `ux_enhancements.css`، `transcript.css`، `notify.css`، `theme.js` |
| **نص أو ترجمة** | `public/i18n_en.js` (القاموس)، و`public/i18n.js` (`tr`، وترجمة ما يُرسم لاحقاً)، والنص المصدر عربي داخل كل شاشة |
| **قالب نموذج الإدخال** | `public/form_kit.js` (`UA.formKit.render`)، وأنماط `.uf` في `style.css` |
| **القوائم المنسدلة** | `public/select_combo.js` (البحث والتعبئة)، والخيارات التجارية من `S.limits.dropdowns` (`settings.js`) |
| **البطاقات وخطة الطالب** | `server/services/cards.js` و`public/cards_bulk.js`، والمتطلبات في `student_affairs_suite.js` |
| **قواعد الفحص الآلي** | `server/services/rules.js` و`public/rules_admin.js` |
| **ملفات المحاضرات** | `server/services/lms_files.js` و`server/lib/pptx.js` |
| **PDF أو وثيقة** | `lib/pdf.js`، `lib/arabic.js`، `docpdf.js`، `corrpdf.js`، `transcriptpdf.js`، `enrollcert.js`، `pki.js` |
| **النشر** | `Dockerfile.railway`، `docker-entrypoint.sh`، `scripts/start-cloud.js`، `.env.example`، `docs/DEPLOY-RAILWAY.md` |

## 5) أفخاخ عند التعديل

1. **الشاشة المعروضة قد لا تكون في الملف المتوقع.** ملفات `ux_*.js` تُحمَّل لاحقاً وتستبدل شاشات: `ux_restructure.js` (`overview` و`payroll`)، و`ux_exam.js` (`academics`)، و`ux_corr.js` (`corr` و`internal`)، و`ux_audit.js` (`audit`)، و`guidelines.js` (الدليل)، وتتشارك حالتها عبر `UA.uxState` من `ux_state.js`. عدّل الملف الفعّال أولاً؛ جدول «الشاشات» في الفهرس يبيّنه. وبعض هذه الشاشات يستدعي النسخة الأصلية داخلياً، فافحص قبل الحذف.
2. **ترتيب `<script>` في `index.html` مؤثر**، لأن الملفات تتشارك `window.UA`.
3. **بعد تعديل الواجهة:** ارفع `?v=` في `index.html` (حالياً `12.9.36`) و`VERSION` في `sw.js` (حالياً `v71`)، وإلا فقد يرى المستخدمون نسخة قديمة.
4. **القوائم معرّفة في ثلاثة أماكن:** `viewsFor` (الواجهة)، و`computeAllowedViews` و`ALL_STAFF_VIEWS` (الخادم). يجب أن تبقى متوافقة، والحماية الفعلية في `need()` داخل الخادم فقط.
5. **ترقيم الترحيلات:** استخدم الرقم التالي `051`. مشغّل الترحيلات يقسم على `;` ولا يفهم تعليقات `/* */`، فاستخدم `--` فقط.
6. **`ux_restructure.js` و`app.js`** ضخمان ويعالجان `data-act` أيضاً عبر `UA.actions` وسلسلة if. ابحث عن اسم الفعل قبل إضافة معالج جديد.
8. **الاختصار `Ctrl+\``** يُقرأ بـ `e.code === 'Backquote'` لا `e.key`، كي يعمل مع حرف ذ في اللوحة العربية.
9. **اقتراحات البحث** مأخوذة من الجدول المرافق لكل حقل (`ensureGlobalAutocompleteDatalist`)، أما البحث العلوي فيفتح نافذة البحث الشامل.
10. **الشاشات غير المتزامنة** مثل `lms` و`expansions`: يميّزها `render` بعدد معاملات الدالة (`v.length >= 1`)، فأي تغليف لها يبقي معاملاً صريحاً. `(...args)` طولها صفر فتعرض الشاشة `[object Promise]`.
11. **لا بيانات نموذجية:** لا يُزرع شيء في الترحيلات ولا عند القراءة ولا في الواجهة (أزالها `041`). الكليات والمعاهد والبرامج والوحدات والخدمات بيانات أساسية تبقى. حسابا `staff1` والطالب التجريبي يُنشآن في `DEMO_MODE=1` فقط.

- لا تضع مساراً تحت `/api/dev/`: قاعدة `/(proc|sys|dev)\//` في `waf.js` ترفضه وتزيد نقاط التهديد، فيُحظر العنوان 15 دقيقة بعد طلبين.

## 6) مشكلات مؤكدة من قراءة الكود

**أُصلح في 2026-11-03** (الاختبارات في `uni-erp/test/security_fixes.test.js`): إعادة ضبط كلمات المرور عند التشغيل (صارت خلف `DEMO_MODE=1`)، وتزوير دفع الأقساط، وتسرب الرواتب من `enterprise/overview` والبحث الشامل، ومسارات `enterprise/*` الإدارية، ومسارات `high-concurrency` المفتوحة. وأُضيفت فحوص الصلاحيات وحصر البيانات إلى `v12_modules.js` و`hr-pro/overview` و`student-affairs-suite` و`students/:id/card-activity`. ويجرّب الاختبار كل مسارات الكتابة بحساب طالب، فيفشل إذا أضيف مسار لا يرفضه وليس في قائمة `STUDENT_WRITES`.

**ما زال مفتوحاً:**

| الخطورة | الموضع | المشكلة |
|---|---|---|
| متوسطة | `sa_course_prerequisites` | الزرع القديم ولّد متطلبات على مقررات فعلية، ولا يميّزها عن المدخل يدوياً أي عمود، فلم يحذف `041` إلا المرتبط بالمقررات المزروعة. تحتاج مراجعة في قاعدة الإنتاج. |
| منخفضة | `ux_restructure.js` نشاط البطاقة | السجل المعروض يُقرأ من `localStorage` مع أن الخادم يحفظه في `sa_card_activity_logs`. |
| منخفضة | `ux_enhancements.js` | يطلب مسارات `*/pending-count` غير موجودة، فتظهر أخطاء 404 في كل تحميل. |
| تشغيلية | قاعدة الإنتاج | كل الحسابات الحالية ما زالت على كلمة المرور الموحدة من الوضع القديم حتى تُغيَّر. |

## 7) التحقق

- **الاختبارات:** `cd uni-erp && npm test` (`node:test`)، وتتطلب PostgreSQL عبر `DATABASE_URL` و`pg_dump` في `PATH`.
- **الرسم البياني:** `graphify-out/` يعمل. استخدم `E:\PATH\graphify.exe affected "<عنصر>" --depth 2` قبل تعديل العقد المركزية: `buildRouter`، `HttpError`، `audit`، `tx`، `createApp`، `getSetting`، `hashPassword`، جدول `users`.
- **قياس المسارات:** المسارات التي تبدو بلا صلاحية في الفهرس قد تكون محمية بغلاف مثل `fin('finance:read', …)` أو بفحص داخل الخدمة؛ لذلك يلزم فتحها قبل الحكم عليها.
