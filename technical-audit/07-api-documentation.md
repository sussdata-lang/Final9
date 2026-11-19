# 07. توثيق الواجهة البرمجية

**المصدر:** استخراج آلي من استدعاءات `r.add(...)` في الكود، وليس من ملف OpenAPI إذ لا يوجد واحد.

**الإجمالي:** 431 مسارًا (GET 169، POST 187، PUT 41، DELETE 34).

## قواعد عامة تنطبق على كل مسار

المرجع: [http.js:259-319](../uni-erp/server/http.js).

| الطبقة | السلوك |
|---|---|
| الجدار الداخلي WAF | يفحص الرابط ومعاملاته وUser-Agent، ثم جسم JSON. |
| حد المعدل | لكل عنوان IP: 120 طلبًا في الدقيقة للهوية، و30 لـ`/api/imports/`، و200 للكتابة المالية، و600 لبقية `/api/`. |
| المصدر | طلبات الكتابة التي تحمل Origin مختلفًا تُرفض. |
| الجلسة | كوكي `sid` أو ترويسة `X-Session-Token`. كل مسار يتطلب جلسة ما لم يكن `auth: false`. |
| كلمة المرور المؤقتة | صاحبها لا يصل إلا إلى المسارات المعلّمة `allowMustChange`. |
| حجم الجسم | 64 كيلوبايت افتراضيًا، إلا ما يذكر في عمود الحد. |
| الأخطاء | `HttpError` تعاد برسالتها، وغيرها رسالة عامة بالحالة 500 مع تسجيلها. |

## دلالة الأعمدة

- **الصلاحية:** ما وُجد نصًا في معالج المسار. قد يكفي أحدها أو يلزم مع شروط أخرى.
- **ثقيل:** يعمل في خيط مستقل عبر `heavy.run`. وكل ما عداه يعمل في الخيط الرئيسي.
- **SQL مباشر:** المعالج نفسه يستدعي `db.prepare` دون المرور بطبقة الخدمة.
- **التحقق من المدخلات:** يتم يدويًا في طبقة الخدمة ولا يوجد مخطط تحقق موحد. فلم يُسجَّل لكل مسار، ويُعدّ **UNVERIFIED** على مستوى كل مسار منفرد.
- **الغرض:** موثق على مستوى الوحدة لأن استنتاجه لكل مسار من الاسم وحده قد يكون مضللًا.

## المسارات العامة دون جلسة

- `POST /api/auth/login` في [server/routes.js:64](../uni-erp/server/routes.js:64)
- `GET /api/health` في [server/routes.js:84](../uni-erp/server/routes.js:84)
- `GET /api/local-accounts` في [server/routes.js:73](../uni-erp/server/routes.js:73)
- `POST /api/local-switch` في [server/routes.js:74](../uni-erp/server/routes.js:74)
- `GET /api/me` في [server/routes.js:85](../uni-erp/server/routes.js:85)
- `GET /api/verify-hash/:sha` في [server/routes.js:430](../uni-erp/server/routes.js:430)
- `GET /api/verify/:code` في [server/routes.js:423](../uni-erp/server/routes.js:423)

## مسارات تعتمد على الفحص داخل الخدمة، وتمت مراجعتها يدويًا

| المسار | الفحص الفعلي |
|---|---|
| `/api/requests/:id`، `/api/attachments/:id` | `visibleTo` في requests.js:223 و299، ويرجع 404 لغير المخوّل |
| `/api/documents/:code*` | `document:read_all` أو صاحب الوثيقة، documents.js:81 |
| `/api/student-files/:fid` | `student:read` أو صاحب الملف، studentfiles.js:71 |
| `/api/import-engine/*` | `needKind` لكل نوع، و`import:undo` للتراجع، import_engine.js:47 و539 |
| `/api/student-affairs-suite/*` | `requireSuitePerm` أو فحص مكافئ في كل دالة خدمة، student_affairs_suite.js |
| `/api/requests/export.xlsx` | requestsxl.js:63 |
| `/api/lms/files/*` | `lmsViewer` في v12_modules.js:279 |
| `/api/enterprise/overview` | تصفية الحقول حسب الصلاحية، enterprise_suite.js:124-140 |

## المالية (77)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/finance/accounts` | `finance:read` | [services/finance/routes.js:35](../uni-erp/server/services/finance/routes.js:35) | — | — | — |
| POST | `/api/finance/accounts` | `finance:setup` | [services/finance/routes.js:36](../uni-erp/server/services/finance/routes.js:36) | — | — | — |
| DELETE | `/api/finance/accounts/:id` | `finance:setup` | [services/finance/routes.js:39](../uni-erp/server/services/finance/routes.js:39) | — | — | — |
| PUT | `/api/finance/accounts/:id` | `finance:setup` | [services/finance/routes.js:37](../uni-erp/server/services/finance/routes.js:37) | — | — | — |
| POST | `/api/finance/accounts/:id/toggle` | `finance:setup` | [services/finance/routes.js:38](../uni-erp/server/services/finance/routes.js:38) | — | — | — |
| GET | `/api/finance/charges` | `finance:fees` | [services/finance/routes.js:265](../uni-erp/server/services/finance/routes.js:265) | — | — | — |
| POST | `/api/finance/charges` | `finance:fees` | [services/finance/routes.js:266](../uni-erp/server/services/finance/routes.js:266) | — | — | — |
| POST | `/api/finance/charges/:id/void` | `finance:fees` | [services/finance/routes.js:267](../uni-erp/server/services/finance/routes.js:267) | — | — | — |
| GET | `/api/finance/cost-centers` | `finance:read` | [services/finance/routes.js:168](../uni-erp/server/services/finance/routes.js:168) | — | نعم | — |
| POST | `/api/finance/cost-centers` | `finance:setup` | [services/finance/routes.js:171](../uni-erp/server/services/finance/routes.js:171) | — | نعم | — |
| PUT | `/api/finance/cost-centers/:id` | `finance:setup` | [services/finance/routes.js:178](../uni-erp/server/services/finance/routes.js:178) | — | نعم | — |
| POST | `/api/finance/cost-centers/:id/toggle` | `finance:setup` | [services/finance/routes.js:186](../uni-erp/server/services/finance/routes.js:186) | — | نعم | — |
| GET | `/api/finance/currencies` | `finance:read` | [services/finance/routes.js:191](../uni-erp/server/services/finance/routes.js:191) | — | نعم | — |
| PUT | `/api/finance/currencies/:code` | `finance:setup` | [services/finance/routes.js:194](../uni-erp/server/services/finance/routes.js:194) | — | نعم | — |
| GET | `/api/finance/discounts` | `finance:read` | [services/finance/routes.js:381](../uni-erp/server/services/finance/routes.js:381) | — | — | — |
| POST | `/api/finance/discounts` | `finance:fees` | [services/finance/routes.js:382](../uni-erp/server/services/finance/routes.js:382) | — | — | — |
| GET | `/api/finance/entries` | `finance:read` | [services/finance/routes.js:42](../uni-erp/server/services/finance/routes.js:42) | — | — | — |
| POST | `/api/finance/entries` | `finance:entry` | [services/finance/routes.js:44](../uni-erp/server/services/finance/routes.js:44) | — | — | — |
| DELETE | `/api/finance/entries/:id` | `finance:entry` | [services/finance/routes.js:46](../uni-erp/server/services/finance/routes.js:46) | — | — | — |
| GET | `/api/finance/entries/:id` | `finance:read` | [services/finance/routes.js:43](../uni-erp/server/services/finance/routes.js:43) | — | — | — |
| PUT | `/api/finance/entries/:id` | `finance:entry` | [services/finance/routes.js:45](../uni-erp/server/services/finance/routes.js:45) | — | — | — |
| POST | `/api/finance/entries/:id/post` | `finance:post` | [services/finance/routes.js:47](../uni-erp/server/services/finance/routes.js:47) | — | — | — |
| POST | `/api/finance/entries/:id/reverse` | `finance:post` | [services/finance/routes.js:48](../uni-erp/server/services/finance/routes.js:48) | — | — | — |
| GET | `/api/finance/fee-structures` | `finance:read` | [services/finance/routes.js:295](../uni-erp/server/services/finance/routes.js:295) | — | نعم | — |
| POST | `/api/finance/fee-structures` | `finance:setup` | [services/finance/routes.js:312](../uni-erp/server/services/finance/routes.js:312) | — | نعم | — |
| GET | `/api/finance/fee-types` | `finance:fees` | [services/finance/routes.js:262](../uni-erp/server/services/finance/routes.js:262) | — | — | — |
| POST | `/api/finance/fee-types` | `finance:fees` | [services/finance/routes.js:263](../uni-erp/server/services/finance/routes.js:263) | — | — | — |
| POST | `/api/finance/fee-types/:id/toggle` | `finance:fees` | [services/finance/routes.js:264](../uni-erp/server/services/finance/routes.js:264) | — | — | — |
| GET | `/api/finance/fees/overdue` | `finance:read` | [services/finance/routes.js:383](../uni-erp/server/services/finance/routes.js:383) | — | — | — |
| GET | `/api/finance/fees/overview` | `finance:read` | [services/finance/routes.js:278](../uni-erp/server/services/finance/routes.js:278) | — | — | — |
| GET | `/api/finance/fiscal-years` | `finance:read` | [services/finance/routes.js:29](../uni-erp/server/services/finance/routes.js:29) | — | — | — |
| POST | `/api/finance/fiscal-years` | `finance:setup` | [services/finance/routes.js:31](../uni-erp/server/services/finance/routes.js:31) | — | — | — |
| POST | `/api/finance/fiscal-years/:id/close` | `finance:setup` | [services/finance/routes.js:32](../uni-erp/server/services/finance/routes.js:32) | — | — | — |
| GET | `/api/finance/invoices` | `finance:read` | [services/finance/routes.js:98](../uni-erp/server/services/finance/routes.js:98) | — | نعم | — |
| POST | `/api/finance/invoices` | `finance:entry` | [services/finance/routes.js:118](../uni-erp/server/services/finance/routes.js:118) | — | نعم | — |
| POST | `/api/finance/invoices/:id/cancel` | `finance:entry` | [services/finance/routes.js:136](../uni-erp/server/services/finance/routes.js:136) | — | — | — |
| POST | `/api/finance/invoices/:id/issue` | `finance:entry` | [services/finance/routes.js:135](../uni-erp/server/services/finance/routes.js:135) | — | — | — |
| GET | `/api/finance/journal` | `finance:read` | [services/finance/routes.js:51](../uni-erp/server/services/finance/routes.js:51) | — | — | — |
| POST | `/api/finance/journal` | `finance:entry` | [services/finance/routes.js:53](../uni-erp/server/services/finance/routes.js:53) | — | — | — |
| DELETE | `/api/finance/journal/:id` | `finance:entry` | [services/finance/routes.js:55](../uni-erp/server/services/finance/routes.js:55) | — | — | — |
| GET | `/api/finance/journal/:id` | `finance:read` | [services/finance/routes.js:52](../uni-erp/server/services/finance/routes.js:52) | — | — | — |
| PUT | `/api/finance/journal/:id` | `finance:entry` | [services/finance/routes.js:54](../uni-erp/server/services/finance/routes.js:54) | — | — | — |
| POST | `/api/finance/journal/:id/post` | `finance:post` | [services/finance/routes.js:56](../uni-erp/server/services/finance/routes.js:56) | — | — | — |
| POST | `/api/finance/journal/:id/reverse` | `finance:post` | [services/finance/routes.js:57](../uni-erp/server/services/finance/routes.js:57) | — | — | — |
| GET | `/api/finance/overview` | `finance:read` | [services/finance/routes.js:24](../uni-erp/server/services/finance/routes.js:24) | — | — | — |
| GET | `/api/finance/parties` | `finance:read` | [services/finance/routes.js:139](../uni-erp/server/services/finance/routes.js:139) | — | نعم | — |
| POST | `/api/finance/parties` | `finance:setup` | [services/finance/routes.js:147](../uni-erp/server/services/finance/routes.js:147) | — | نعم | — |
| PUT | `/api/finance/parties/:id` | `finance:setup` | [services/finance/routes.js:155](../uni-erp/server/services/finance/routes.js:155) | — | نعم | — |
| POST | `/api/finance/parties/:id/toggle` | `finance:setup` | [services/finance/routes.js:162](../uni-erp/server/services/finance/routes.js:162) | — | نعم | — |
| GET | `/api/finance/payments` | `finance:fees` | [services/finance/routes.js:268](../uni-erp/server/services/finance/routes.js:268) | — | — | — |
| POST | `/api/finance/payments` | `finance:fees` | [services/finance/routes.js:269](../uni-erp/server/services/finance/routes.js:269) | — | — | — |
| POST | `/api/finance/payments/:id/void` | `finance:fees` | [services/finance/routes.js:270](../uni-erp/server/services/finance/routes.js:270) | — | — | — |
| POST | `/api/finance/payroll-entry` | `finance:post` | [services/finance/routes.js:274](../uni-erp/server/services/finance/routes.js:274) | — | — | — |
| GET | `/api/finance/payroll-months` | `finance:read` | [services/finance/routes.js:272](../uni-erp/server/services/finance/routes.js:272) | — | — | — |
| GET | `/api/finance/payroll-preview` | `finance:read` | [services/finance/routes.js:273](../uni-erp/server/services/finance/routes.js:273) | — | — | — |
| POST | `/api/finance/payroll/:id/post` | `finance:post` | [services/finance/routes.js:399](../uni-erp/server/services/finance/routes.js:399) | — | — | — |
| GET | `/api/finance/reports/balance-sheet` | `finance:read` | [services/finance/routes.js:217](../uni-erp/server/services/finance/routes.js:217) | — | — | — |
| GET | `/api/finance/reports/cash-book` | `finance:read` | [services/finance/routes.js:218](../uni-erp/server/services/finance/routes.js:218) | — | — | — |
| GET | `/api/finance/reports/cost-centers` | `finance:read` | [services/finance/routes.js:237](../uni-erp/server/services/finance/routes.js:237) | — | — | — |
| GET | `/api/finance/reports/income` | `finance:read` | [services/finance/routes.js:205](../uni-erp/server/services/finance/routes.js:205) | — | — | — |
| GET | `/api/finance/reports/income-statement` | `finance:read` | [services/finance/routes.js:206](../uni-erp/server/services/finance/routes.js:206) | — | — | — |
| GET | `/api/finance/reports/ledger` | `finance:read` | [services/finance/routes.js:204](../uni-erp/server/services/finance/routes.js:204) | — | — | — |
| GET | `/api/finance/reports/party` | `finance:read` | [services/finance/routes.js:238](../uni-erp/server/services/finance/routes.js:238) | — | — | — |
| GET | `/api/finance/reports/party-statement` | `finance:read` | [services/finance/routes.js:239](../uni-erp/server/services/finance/routes.js:239) | — | — | — |
| GET | `/api/finance/reports/trial-balance` | `finance:read` | [services/finance/routes.js:203](../uni-erp/server/services/finance/routes.js:203) | — | — | — |
| GET | `/api/finance/reports/trial-balance.xlsx` | `finance:read` | [services/finance/routes.js:250](../uni-erp/server/services/finance/routes.js:250) | — | — | — |
| GET | `/api/finance/student-invoices` | `finance:read` | [services/finance/routes.js:321](../uni-erp/server/services/finance/routes.js:321) | — | — | — |
| POST | `/api/finance/student-invoices` | `finance:fees` | [services/finance/routes.js:342](../uni-erp/server/services/finance/routes.js:342) | — | — | — |
| GET | `/api/finance/student-invoices/:id` | `finance:read` | [services/finance/routes.js:354](../uni-erp/server/services/finance/routes.js:354) | — | نعم | — |
| POST | `/api/finance/student-invoices/:id/pay` | `finance:fees` | [services/finance/routes.js:369](../uni-erp/server/services/finance/routes.js:369) | — | نعم | — |
| GET | `/api/finance/student-statement/:id` | `finance:fees` | [services/finance/routes.js:271](../uni-erp/server/services/finance/routes.js:271) | — | — | — |
| GET | `/api/finance/vouchers` | `finance:read` | [services/finance/routes.js:60](../uni-erp/server/services/finance/routes.js:60) | — | نعم | — |
| POST | `/api/finance/vouchers` | `finance:entry` | [services/finance/routes.js:81](../uni-erp/server/services/finance/routes.js:81) | — | — | — |
| GET | `/api/finance/years` | `finance:read` | [services/finance/routes.js:28](../uni-erp/server/services/finance/routes.js:28) | — | — | — |
| POST | `/api/finance/years` | `finance:setup` | [services/finance/routes.js:30](../uni-erp/server/services/finance/routes.js:30) | — | — | — |
| POST | `/api/finance/years/:id/close` | `finance:setup` | [services/finance/routes.js:275](../uni-erp/server/services/finance/routes.js:275) | — | — | — |
| GET | `/api/payroll/runs` | `finance:read` | [services/finance/routes.js:385](../uni-erp/server/services/finance/routes.js:385) | — | — | — |

## الإدارة والإعدادات (54)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/admin/backups` | `backup:manage` | [routes.js:171](../uni-erp/server/routes.js:171) | — | — | — |
| POST | `/api/admin/backups` | `backup:manage` | [routes.js:172](../uni-erp/server/routes.js:172) | — | — | — |
| DELETE | `/api/admin/backups/:name` | `backup:manage` | [routes.js:181](../uni-erp/server/routes.js:181) | — | — | — |
| GET | `/api/admin/backups/:name` | `backup:manage` | [routes.js:173](../uni-erp/server/routes.js:173) | — | — | — |
| POST | `/api/admin/backups/:name/verify` | `backup:manage` | [routes.js:180](../uni-erp/server/routes.js:180) | نعم | — | — |
| POST | `/api/admin/faculties` | `program:manage` | [routes.js:301](../uni-erp/server/routes.js:301) | — | — | — |
| DELETE | `/api/admin/faculties/:id` | `program:manage` | [routes.js:303](../uni-erp/server/routes.js:303) | — | — | — |
| PUT | `/api/admin/faculties/:id` | `program:manage` | [routes.js:302](../uni-erp/server/routes.js:302) | — | — | — |
| POST | `/api/admin/faculties/:id/toggle` | `program:manage` | [routes.js:304](../uni-erp/server/routes.js:304) | — | — | — |
| GET | `/api/admin/general` | `settings:manage` | [routes.js:93](../uni-erp/server/routes.js:93) | — | — | — |
| PUT | `/api/admin/general` | `settings:manage` | [routes.js:94](../uni-erp/server/routes.js:94) | — | — | — |
| POST | `/api/admin/general/reset` | `settings:manage` | [routes.js:95](../uni-erp/server/routes.js:95) | — | — | — |
| GET | `/api/admin/holds` | `holds:manage` | [routes.js:495](../uni-erp/server/routes.js:495) | — | نعم | — |
| POST | `/api/admin/holds` | `holds:manage` | [routes.js:500](../uni-erp/server/routes.js:500) | — | نعم | — |
| DELETE | `/api/admin/holds/:id` | `holds:manage` | [routes.js:511](../uni-erp/server/routes.js:511) | — | — | — |
| PUT | `/api/admin/holds/:id` | `holds:manage` | [routes.js:510](../uni-erp/server/routes.js:510) | — | — | — |
| POST | `/api/admin/holds/:id/clear` | `holds:manage` | [routes.js:512](../uni-erp/server/routes.js:512) | — | نعم | — |
| GET | `/api/admin/hr/contracts` | `hr:manage` | [routes.js:336](../uni-erp/server/routes.js:336) | — | — | — |
| POST | `/api/admin/hr/contracts` | `hr:manage` | [routes.js:337](../uni-erp/server/routes.js:337) | — | — | — |
| DELETE | `/api/admin/hr/employee/:id` | `hr:manage` | [routes.js:326](../uni-erp/server/routes.js:326) | — | — | — |
| GET | `/api/admin/hr/employee/:id` | `hr:manage` | [routes.js:323](../uni-erp/server/routes.js:323) | — | — | — |
| PUT | `/api/admin/hr/employee/:id` | `hr:manage` | [routes.js:324](../uni-erp/server/routes.js:324) | — | — | — |
| POST | `/api/admin/hr/employee/:id/toggle` | `hr:manage` | [routes.js:325](../uni-erp/server/routes.js:325) | — | — | — |
| GET | `/api/admin/hr/employees` | `hr:manage` | [routes.js:321](../uni-erp/server/routes.js:321) | — | — | — |
| POST | `/api/admin/hr/employees` | `hr:manage` | [routes.js:322](../uni-erp/server/routes.js:322) | — | — | — |
| GET | `/api/admin/hr/leave/:id` | `hr:manage` | [routes.js:332](../uni-erp/server/routes.js:332) | — | — | — |
| POST | `/api/admin/hr/leave/:id/approve` | `hr:manage` | [routes.js:333](../uni-erp/server/routes.js:333) | — | — | — |
| POST | `/api/admin/hr/leave/:id/cancel` | `hr:manage` | [routes.js:335](../uni-erp/server/routes.js:335) | — | — | — |
| POST | `/api/admin/hr/leave/:id/reject` | `hr:manage` | [routes.js:334](../uni-erp/server/routes.js:334) | — | — | — |
| GET | `/api/admin/hr/leaves` | `hr:manage` | [routes.js:330](../uni-erp/server/routes.js:330) | — | — | — |
| POST | `/api/admin/hr/leaves` | `hr:manage` | [routes.js:331](../uni-erp/server/routes.js:331) | — | — | — |
| GET | `/api/admin/hr/options` | `hr:manage` | [routes.js:338](../uni-erp/server/routes.js:338) | — | — | — |
| GET | `/api/admin/hr/salaries` | `hr:manage` | [routes.js:327](../uni-erp/server/routes.js:327) | — | — | — |
| POST | `/api/admin/hr/salaries` | `hr:manage` | [routes.js:328](../uni-erp/server/routes.js:328) | — | — | — |
| GET | `/api/admin/hr/salary/:employeeId/latest` | `hr:manage` | [routes.js:329](../uni-erp/server/routes.js:329) | — | — | — |
| GET | `/api/admin/logs` | `audit:read` | [routes.js:466](../uni-erp/server/routes.js:466) | — | — | — |
| POST | `/api/admin/programs` | `program:manage` | [routes.js:305](../uni-erp/server/routes.js:305) | — | — | — |
| DELETE | `/api/admin/programs/:id` | `program:manage` | [routes.js:307](../uni-erp/server/routes.js:307) | — | — | — |
| PUT | `/api/admin/programs/:id` | `program:manage` | [routes.js:306](../uni-erp/server/routes.js:306) | — | — | — |
| POST | `/api/admin/programs/:id/toggle` | `program:manage` | [routes.js:308](../uni-erp/server/routes.js:308) | — | — | — |
| GET | `/api/admin/rules` | `rules:manage` | [routes.js:521](../uni-erp/server/routes.js:521) | — | نعم | — |
| POST | `/api/admin/rules` | `rules:manage` | [routes.js:520](../uni-erp/server/routes.js:520) | — | — | — |
| DELETE | `/api/admin/rules/:id` | `rules:manage` | [routes.js:539](../uni-erp/server/routes.js:539) | — | — | — |
| PUT | `/api/admin/rules/:id` | `rules:manage` | [routes.js:538](../uni-erp/server/routes.js:538) | — | — | — |
| POST | `/api/admin/rules/:id/toggle` | `rules:manage` | [routes.js:525](../uni-erp/server/routes.js:525) | — | نعم | — |
| GET | `/api/admin/rules/kinds` | `rules:manage` | [routes.js:519](../uni-erp/server/routes.js:519) | — | — | — |
| GET | `/api/admin/services` | `rules:manage` | [routes.js:533](../uni-erp/server/routes.js:533) | — | نعم | — |
| POST | `/api/admin/services` | `rules:manage` | [routes.js:534](../uni-erp/server/routes.js:534) | — | — | — |
| PUT | `/api/admin/services/:code` | `rules:manage` | [routes.js:535](../uni-erp/server/routes.js:535) | — | — | — |
| GET | `/api/admin/settings` | `rules:manage` | [routes.js:536](../uni-erp/server/routes.js:536) | — | — | — |
| PUT | `/api/admin/settings` | `rules:manage` | [routes.js:537](../uni-erp/server/routes.js:537) | — | — | — |
| GET | `/api/admin/waf/stats` | `settings:manage` | [routes.js:89](../uni-erp/server/routes.js:89) | — | — | — |
| GET | `/api/admin/waf/test` | `settings:manage` | [routes.js:91](../uni-erp/server/routes.js:91) | — | — | — |
| POST | `/api/admin/waf/unban` | `settings:manage` | [routes.js:90](../uni-erp/server/routes.js:90) | — | — | — |

## المشتريات والمخازن (41)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/procurement/assets` | `procurement:read` | [services/procurement/routes.js:46](../uni-erp/server/services/procurement/routes.js:46) | — | — | — |
| POST | `/api/procurement/assets` | `procurement:assets` | [services/procurement/routes.js:47](../uni-erp/server/services/procurement/routes.js:47) | — | — | — |
| DELETE | `/api/procurement/assets/:id` | `procurement:assets` | [services/procurement/routes.js:50](../uni-erp/server/services/procurement/routes.js:50) | — | — | — |
| PUT | `/api/procurement/assets/:id` | `procurement:assets` | [services/procurement/routes.js:48](../uni-erp/server/services/procurement/routes.js:48) | — | — | — |
| POST | `/api/procurement/assets/:id/move` | `procurement:assets` | [services/procurement/routes.js:49](../uni-erp/server/services/procurement/routes.js:49) | — | — | — |
| GET | `/api/procurement/categories` | `procurement:read` | [services/procurement/routes.js:22](../uni-erp/server/services/procurement/routes.js:22) | — | — | — |
| GET | `/api/procurement/issues` | `procurement:read` | [services/procurement/routes.js:44](../uni-erp/server/services/procurement/routes.js:44) | — | — | — |
| POST | `/api/procurement/issues` | `procurement:stock` | [services/procurement/routes.js:45](../uni-erp/server/services/procurement/routes.js:45) | — | — | — |
| GET | `/api/procurement/items` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/procurement/routes.js:23](../uni-erp/server/services/procurement/routes.js:23) | — | — | — |
| POST | `/api/procurement/items` | `procurement:manage` | [services/procurement/routes.js:24](../uni-erp/server/services/procurement/routes.js:24) | — | — | — |
| GET | `/api/procurement/items.xlsx` | `procurement:read` | [services/procurement/routes.js:52](../uni-erp/server/services/procurement/routes.js:52) | — | — | — |
| DELETE | `/api/procurement/items/:id` | `procurement:manage` | [services/procurement/routes.js:28](../uni-erp/server/services/procurement/routes.js:28) | — | — | — |
| PUT | `/api/procurement/items/:id` | `procurement:manage` | [services/procurement/routes.js:25](../uni-erp/server/services/procurement/routes.js:25) | — | — | — |
| POST | `/api/procurement/items/:id/adjust` | `procurement:stock` | [services/procurement/routes.js:26](../uni-erp/server/services/procurement/routes.js:26) | — | — | — |
| POST | `/api/procurement/items/:id/toggle` | `procurement:manage` | [services/procurement/routes.js:27](../uni-erp/server/services/procurement/routes.js:27) | — | — | — |
| GET | `/api/procurement/orders` | `procurement:read` | [services/procurement/routes.js:37](../uni-erp/server/services/procurement/routes.js:37) | — | — | — |
| POST | `/api/procurement/orders` | `procurement:manage` | [services/procurement/routes.js:39](../uni-erp/server/services/procurement/routes.js:39) | — | — | — |
| GET | `/api/procurement/orders/:id` | `procurement:read` | [services/procurement/routes.js:38](../uni-erp/server/services/procurement/routes.js:38) | — | — | — |
| POST | `/api/procurement/orders/:id/cancel` | `procurement:manage` | [services/procurement/routes.js:41](../uni-erp/server/services/procurement/routes.js:41) | — | — | — |
| POST | `/api/procurement/orders/:id/order` | `procurement:manage` | [services/procurement/routes.js:40](../uni-erp/server/services/procurement/routes.js:40) | — | — | — |
| GET | `/api/procurement/overview` | `procurement:read` | [services/procurement/routes.js:11](../uni-erp/server/services/procurement/routes.js:11) | — | — | — |
| GET | `/api/procurement/receipts` | `procurement:read` | [services/procurement/routes.js:42](../uni-erp/server/services/procurement/routes.js:42) | — | — | — |
| POST | `/api/procurement/receipts` | `procurement:stock` | [services/procurement/routes.js:43](../uni-erp/server/services/procurement/routes.js:43) | — | — | — |
| GET | `/api/procurement/requests` | فحص داخل المعالج | [services/procurement/routes.js:29](../uni-erp/server/services/procurement/routes.js:29) | — | — | — |
| POST | `/api/procurement/requests` | `procurement:request` | [services/procurement/routes.js:31](../uni-erp/server/services/procurement/routes.js:31) | — | — | — |
| GET | `/api/procurement/requests/:id` | فحص داخل المعالج | [services/procurement/routes.js:30](../uni-erp/server/services/procurement/routes.js:30) | — | — | — |
| PUT | `/api/procurement/requests/:id` | `procurement:request` | [services/procurement/routes.js:32](../uni-erp/server/services/procurement/routes.js:32) | — | — | — |
| POST | `/api/procurement/requests/:id/approve` | `procurement:manage` | [services/procurement/routes.js:34](../uni-erp/server/services/procurement/routes.js:34) | — | — | — |
| POST | `/api/procurement/requests/:id/cancel` | `procurement:request` | [services/procurement/routes.js:36](../uni-erp/server/services/procurement/routes.js:36) | — | — | — |
| POST | `/api/procurement/requests/:id/reject` | `procurement:manage` | [services/procurement/routes.js:35](../uni-erp/server/services/procurement/routes.js:35) | — | — | — |
| POST | `/api/procurement/requests/:id/submit` | `procurement:request` | [services/procurement/routes.js:33](../uni-erp/server/services/procurement/routes.js:33) | — | — | — |
| GET | `/api/procurement/suppliers` | `procurement:read` | [services/procurement/routes.js:17](../uni-erp/server/services/procurement/routes.js:17) | — | — | — |
| POST | `/api/procurement/suppliers` | `procurement:manage` | [services/procurement/routes.js:18](../uni-erp/server/services/procurement/routes.js:18) | — | — | — |
| DELETE | `/api/procurement/suppliers/:id` | `procurement:manage` | [services/procurement/routes.js:21](../uni-erp/server/services/procurement/routes.js:21) | — | — | — |
| PUT | `/api/procurement/suppliers/:id` | `procurement:manage` | [services/procurement/routes.js:19](../uni-erp/server/services/procurement/routes.js:19) | — | — | — |
| POST | `/api/procurement/suppliers/:id/toggle` | `procurement:manage` | [services/procurement/routes.js:20](../uni-erp/server/services/procurement/routes.js:20) | — | — | — |
| GET | `/api/procurement/warehouses` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/procurement/routes.js:12](../uni-erp/server/services/procurement/routes.js:12) | — | — | — |
| POST | `/api/procurement/warehouses` | `procurement:manage` | [services/procurement/routes.js:13](../uni-erp/server/services/procurement/routes.js:13) | — | — | — |
| DELETE | `/api/procurement/warehouses/:id` | `procurement:manage` | [services/procurement/routes.js:16](../uni-erp/server/services/procurement/routes.js:16) | — | — | — |
| PUT | `/api/procurement/warehouses/:id` | `procurement:manage` | [services/procurement/routes.js:14](../uni-erp/server/services/procurement/routes.js:14) | — | — | — |
| POST | `/api/procurement/warehouses/:id/toggle` | `procurement:manage` | [services/procurement/routes.js:15](../uni-erp/server/services/procurement/routes.js:15) | — | — | — |

## الطلاب (34)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/cards/batches` | `student:read` | [routes.js:262](../uni-erp/server/routes.js:262) | — | — | — |
| POST | `/api/cards/batches` | `student:update` | [routes.js:263](../uni-erp/server/routes.js:263) | نعم | — | — |
| GET | `/api/cards/batches/:id` | `student:read` | [routes.js:264](../uni-erp/server/routes.js:264) | — | — | — |
| GET | `/api/cards/batches/:id/export.xlsx` | `student:read` | [routes.js:265](../uni-erp/server/routes.js:265) | نعم | — | — |
| POST | `/api/cards/handovers/:id/receive` | `student:update` | [routes.js:266](../uni-erp/server/routes.js:266) | — | — | — |
| POST | `/api/cards/handovers/:id/undo` | `student:update` | [routes.js:267](../uni-erp/server/routes.js:267) | — | — | — |
| GET | `/api/cards/options` | `student:read` | [routes.js:260](../uni-erp/server/routes.js:260) | — | — | — |
| GET | `/api/cards/students` | `student:read` | [routes.js:261](../uni-erp/server/routes.js:261) | — | — | — |
| GET | `/api/faculties` | `student:read` / `faculties:list` | [routes.js:300](../uni-erp/server/routes.js:300) | — | — | — |
| GET | `/api/me/profile` | `profile:read_own` | [routes.js:97](../uni-erp/server/routes.js:97) | — | — | — |
| PUT | `/api/me/profile` | `profile:update_own` | [routes.js:99](../uni-erp/server/routes.js:99) | — | — | — |
| GET | `/api/programs` | `grade:approve_own` / `student:read` / `programs:list` | [routes.js:205](../uni-erp/server/routes.js:205) | — | — | — |
| GET | `/api/registration/options` | `student:register` / `program:manage` | [routes.js:158](../uni-erp/server/routes.js:158) | — | — | — |
| DELETE | `/api/student-files/:fid` | `student:register` / `student:update` | [routes.js:189](../uni-erp/server/routes.js:189) | — | — | — |
| GET | `/api/student-files/:fid` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:188](../uni-erp/server/routes.js:188) | — | — | — |
| GET | `/api/students` | `student:read` | [routes.js:160](../uni-erp/server/routes.js:160) | — | — | — |
| POST | `/api/students` | `student:register` | [routes.js:159](../uni-erp/server/routes.js:159) | — | — | — |
| GET | `/api/students-table` | `student:read` | [routes.js:182](../uni-erp/server/routes.js:182) | — | — | — |
| DELETE | `/api/students/:id` | `student:delete` | [routes.js:203](../uni-erp/server/routes.js:203) | — | — | — |
| GET | `/api/students/:id` | `student:read` | [routes.js:193](../uni-erp/server/routes.js:193) | — | — | — |
| PUT | `/api/students/:id` | `student:update` | [routes.js:202](../uni-erp/server/routes.js:202) | — | — | — |
| GET | `/api/students/:id/card-activity` | `student:read` | [routes.js:207](../uni-erp/server/routes.js:207) | — | نعم | — |
| POST | `/api/students/:id/card-activity` | `attendance:manage` / `student:update` | [routes.js:218](../uni-erp/server/routes.js:218) | — | نعم | — |
| GET | `/api/students/:id/certificate.pdf` | `student:read` | [routes.js:456](../uni-erp/server/routes.js:456) | — | — | — |
| GET | `/api/students/:id/files` | `student:read` | [routes.js:183](../uni-erp/server/routes.js:183) | — | — | — |
| POST | `/api/students/:id/files` | `student:register` / `student:update` | [routes.js:184](../uni-erp/server/routes.js:184) | — | — | `9 * 1024 * 1024` |
| GET | `/api/students/:id/grades` | `student:read` | [routes.js:115](../uni-erp/server/routes.js:115) | — | — | — |
| POST | `/api/students/:id/grades` | `grade:manage` | [routes.js:116](../uni-erp/server/routes.js:116) | — | نعم | — |
| DELETE | `/api/students/:id/grades/:gid` | `grade:manage` | [routes.js:121](../uni-erp/server/routes.js:121) | — | — | — |
| GET | `/api/students/:id/main-info` | `student:read` | [routes.js:200](../uni-erp/server/routes.js:200) | — | — | — |
| PUT | `/api/students/:id/main-info` | `student:update` | [routes.js:201](../uni-erp/server/routes.js:201) | — | — | — |
| POST | `/api/students/:id/reset-password` | `student:reset_password` | [routes.js:204](../uni-erp/server/routes.js:204) | — | — | — |
| GET | `/api/students/:id/schedule-conflicts` | `student:read` | [routes.js:135](../uni-erp/server/routes.js:135) | — | — | — |
| GET | `/api/students/:id/unified-record` | `student:read` | [routes.js:139](../uni-erp/server/routes.js:139) | — | — | — |

## الأكاديمي (25)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/attendance` | `attendance:manage` | [routes.js:162](../uni-erp/server/routes.js:162) | — | — | — |
| POST | `/api/attendance` | `attendance:manage` | [routes.js:164](../uni-erp/server/routes.js:164) | — | — | — |
| DELETE | `/api/attendance/:id` | `attendance:manage` | [routes.js:166](../uni-erp/server/routes.js:166) | — | — | — |
| PUT | `/api/attendance/:id` | `attendance:manage` | [routes.js:165](../uni-erp/server/routes.js:165) | — | — | — |
| GET | `/api/attendance/open` | `attendance:manage` | [routes.js:163](../uni-erp/server/routes.js:163) | — | — | — |
| POST | `/api/attendance/scan` | `attendance:manage` | [routes.js:161](../uni-erp/server/routes.js:161) | — | — | — |
| GET | `/api/courses` | `course:read_own` / `course:manage` / `grade:manage` / `grade:approve` / `grade:approve_own` | [routes.js:102](../uni-erp/server/routes.js:102) | — | — | — |
| POST | `/api/courses` | `course:manage` | [routes.js:106](../uni-erp/server/routes.js:106) | — | — | — |
| DELETE | `/api/courses/:id` | `course:manage` | [routes.js:108](../uni-erp/server/routes.js:108) | — | — | — |
| PUT | `/api/courses/:id` | `course:manage` | [routes.js:107](../uni-erp/server/routes.js:107) | — | — | — |
| GET | `/api/courses/:id/schedule` | `course:manage` | [routes.js:132](../uni-erp/server/routes.js:132) | — | — | — |
| PUT | `/api/courses/:id/schedule` | `course:manage` | [routes.js:133](../uni-erp/server/routes.js:133) | — | — | — |
| POST | `/api/courses/:id/toggle` | `course:manage` | [routes.js:109](../uni-erp/server/routes.js:109) | — | — | — |
| GET | `/api/faculty` | `faculty:manage` / `course:manage` | [routes.js:311](../uni-erp/server/routes.js:311) | — | — | — |
| POST | `/api/faculty` | `faculty:manage` | [routes.js:315](../uni-erp/server/routes.js:315) | — | — | — |
| DELETE | `/api/faculty/:id` | `faculty:manage` | [routes.js:318](../uni-erp/server/routes.js:318) | — | — | — |
| PUT | `/api/faculty/:id` | `faculty:manage` | [routes.js:316](../uni-erp/server/routes.js:316) | — | — | — |
| POST | `/api/faculty/:id/toggle` | `faculty:manage` | [routes.js:317](../uni-erp/server/routes.js:317) | — | — | — |
| GET | `/api/faculty/my-grades` | `grade:approve_own` | [routes.js:123](../uni-erp/server/routes.js:123) | — | — | — |
| GET | `/api/grades` | `grade:manage` / `student:read` | [routes.js:110](../uni-erp/server/routes.js:110) | — | — | — |
| GET | `/api/grades/:id/history` | `grade:manage` | [routes.js:130](../uni-erp/server/routes.js:130) | — | — | — |
| POST | `/api/grades/workflow` | `grade:approve_own` / `grade:manage` | [routes.js:124](../uni-erp/server/routes.js:124) | نعم | — | — |
| POST | `/api/grades/workflow-setting` | `grade:approve` | [routes.js:131](../uni-erp/server/routes.js:131) | — | — | — |
| GET | `/api/me/grades` | `grade:read_own` | [routes.js:114](../uni-erp/server/routes.js:114) | — | — | — |
| GET | `/api/me/timetable` | فحص داخل المعالج | [routes.js:134](../uni-erp/server/routes.js:134) | — | — | — |

## الموارد البشرية (22)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/hr-pro/absences` | `hr:manage` | [services/hr_integrated.js:822](../uni-erp/server/services/hr_integrated.js:822) | — | نعم | — |
| DELETE | `/api/hr-pro/absences/:id` | `hr:manage` | [services/hr_integrated.js:847](../uni-erp/server/services/hr_integrated.js:847) | — | نعم | — |
| POST | `/api/hr-pro/advances` | `hr:manage` | [services/hr_integrated.js:888](../uni-erp/server/services/hr_integrated.js:888) | — | نعم | — |
| POST | `/api/hr-pro/advances/:id/pay` | `hr:manage` | [services/hr_integrated.js:909](../uni-erp/server/services/hr_integrated.js:909) | — | نعم | — |
| POST | `/api/hr-pro/attendance` | `hr:manage` / `staffatt:manage` | [services/hr_integrated.js:785](../uni-erp/server/services/hr_integrated.js:785) | — | نعم | — |
| POST | `/api/hr-pro/contracts` | `hr:manage` | [services/hr_integrated.js:929](../uni-erp/server/services/hr_integrated.js:929) | — | نعم | — |
| POST | `/api/hr-pro/contracts/:id/renew` | `hr:manage` | [services/hr_integrated.js:953](../uni-erp/server/services/hr_integrated.js:953) | — | نعم | — |
| POST | `/api/hr-pro/employees` | `hr:manage` | [services/hr_integrated.js:656](../uni-erp/server/services/hr_integrated.js:656) | — | نعم | — |
| PUT | `/api/hr-pro/employees/:id` | `hr:manage` | [services/hr_integrated.js:744](../uni-erp/server/services/hr_integrated.js:744) | — | نعم | — |
| POST | `/api/hr-pro/leaves` | `hr:manage` | [services/hr_integrated.js:854](../uni-erp/server/services/hr_integrated.js:854) | — | نعم | — |
| POST | `/api/hr-pro/lookups` | `hr:manage` | [services/hr_integrated.js:990](../uni-erp/server/services/hr_integrated.js:990) | — | نعم | — |
| DELETE | `/api/hr-pro/lookups/:id` | `hr:manage` | [services/hr_integrated.js:1004](../uni-erp/server/services/hr_integrated.js:1004) | — | نعم | — |
| GET | `/api/hr-pro/overview` | `hr_emp:view` / `hr_emp:write` / `hr_emp:edit` / `hr_emp:delete` / `hr:manage` / `hr_payroll:approve` / `staffatt:manage` | [services/hr_integrated.js:642](../uni-erp/server/services/hr_integrated.js:642) | — | — | — |
| PUT | `/api/hr-pro/settings` | `hr:manage` | [services/hr_integrated.js:977](../uni-erp/server/services/hr_integrated.js:977) | — | نعم | — |
| GET | `/api/hr/attendance` | `staffatt:manage` | [routes.js:277](../uni-erp/server/routes.js:277) | — | — | — |
| GET | `/api/hr/attendance/export.xlsx` | `staffatt:manage` | [routes.js:276](../uni-erp/server/routes.js:276) | — | — | — |
| GET | `/api/hr/attendance/me` | `staffatt:self` | [routes.js:275](../uni-erp/server/routes.js:275) | — | — | — |
| POST | `/api/hr/attendance/punch` | `staffatt:self` | [routes.js:272](../uni-erp/server/routes.js:272) | — | — | — |
| PUT | `/api/hr/leave/entitlement` | `staffatt:manage` | [routes.js:279](../uni-erp/server/routes.js:279) | — | — | — |
| GET | `/api/hr/leaves` | `staffatt:manage` | [routes.js:278](../uni-erp/server/routes.js:278) | — | — | — |
| GET | `/api/hr/settings` | `staffatt:manage` | [routes.js:273](../uni-erp/server/routes.js:273) | — | — | — |
| PUT | `/api/hr/settings` | `staffatt:manage` | [routes.js:274](../uni-erp/server/routes.js:274) | — | — | — |

## المراسلات (19)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/corr` | فحص داخل المعالج | [routes.js:290](../uni-erp/server/routes.js:290) | — | — | — |
| POST | `/api/corr` | `corr:use` | [routes.js:291](../uni-erp/server/routes.js:291) | — | — | `11 * 1024 * 1024` |
| GET | `/api/corr/:id` | فحص داخل المعالج | [routes.js:292](../uni-erp/server/routes.js:292) | — | — | — |
| PUT | `/api/corr/:id` | `corr:use` | [routes.js:293](../uni-erp/server/routes.js:293) | — | — | `11 * 1024 * 1024` |
| POST | `/api/corr/:id/approve` | `corr:use` | [routes.js:296](../uni-erp/server/routes.js:296) | — | — | — |
| POST | `/api/corr/:id/cancel` | `corr:use` | [routes.js:299](../uni-erp/server/routes.js:299) | — | — | — |
| POST | `/api/corr/:id/comment` | `corr:use` | [routes.js:298](../uni-erp/server/routes.js:298) | — | — | — |
| GET | `/api/corr/:id/pdf` | فحص داخل المعالج | [routes.js:294](../uni-erp/server/routes.js:294) | — | — | — |
| POST | `/api/corr/:id/reject` | `corr:use` | [routes.js:297](../uni-erp/server/routes.js:297) | — | — | — |
| POST | `/api/corr/:id/send` | `corr:use` | [routes.js:295](../uni-erp/server/routes.js:295) | — | — | — |
| POST | `/api/corr/batch` | `corr:use` | [routes.js:595](../uni-erp/server/routes.js:595) | — | — | — |
| GET | `/api/corr/files/:id` | فحص داخل المعالج | [routes.js:289](../uni-erp/server/routes.js:289) | — | — | — |
| GET | `/api/corr/notifications` | فحص داخل المعالج | [routes.js:287](../uni-erp/server/routes.js:287) | — | — | — |
| POST | `/api/corr/notifications/read` | فحص داخل المعالج | [routes.js:288](../uni-erp/server/routes.js:288) | — | — | — |
| GET | `/api/corr/people` | `corr:use` | [routes.js:282](../uni-erp/server/routes.js:282) | — | — | — |
| GET | `/api/corr/templates` | `corr:use` | [routes.js:283](../uni-erp/server/routes.js:283) | — | — | — |
| POST | `/api/corr/templates` | `corr:templates` | [routes.js:284](../uni-erp/server/routes.js:284) | — | — | — |
| DELETE | `/api/corr/templates/:code` | `corr:templates` | [routes.js:286](../uni-erp/server/routes.js:286) | — | — | — |
| PUT | `/api/corr/templates/:code` | `corr:templates` | [routes.js:285](../uni-erp/server/routes.js:285) | — | — | — |

## الطلبات والوثائق (18)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/attachments/:id` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:382](../uni-erp/server/routes.js:382) | — | — | — |
| GET | `/api/documents/:code` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:412](../uni-erp/server/routes.js:412) | — | — | — |
| GET | `/api/documents/:code/pdf` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:413](../uni-erp/server/routes.js:413) | — | — | — |
| GET | `/api/documents/:code/qr.svg` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:418](../uni-erp/server/routes.js:418) | — | — | — |
| GET | `/api/me/desk` | فحص داخل المعالج | [routes.js:96](../uni-erp/server/routes.js:96) | — | — | — |
| GET | `/api/requests` | `request:read_own` / `request:read_all` / `request:read_unit` / `request:create_internal` | [routes.js:367](../uni-erp/server/routes.js:367) | — | — | — |
| POST | `/api/requests` | `request:create` / `request:create_internal` | [routes.js:366](../uni-erp/server/routes.js:366) | — | — | `11 * 1024 * 1024` |
| GET | `/api/requests/:id` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:371](../uni-erp/server/routes.js:371) | — | — | — |
| POST | `/api/requests/:id/approve` | `request:decide` | [routes.js:372](../uni-erp/server/routes.js:372) | — | — | — |
| POST | `/api/requests/:id/forward` | `request:forward` | [routes.js:374](../uni-erp/server/routes.js:374) | — | — | — |
| POST | `/api/requests/:id/reject` | `request:decide` | [routes.js:373](../uni-erp/server/routes.js:373) | — | — | — |
| GET | `/api/requests/export.xlsx` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:269](../uni-erp/server/routes.js:269) | نعم | — | — |
| GET | `/api/services` | `request:import` | [routes.js:341](../uni-erp/server/routes.js:341) | — | — | — |
| POST | `/api/services/:code/import` | `request:import` | [routes.js:270](../uni-erp/server/routes.js:270) | نعم | — | `8 * 1024 * 1024` |
| GET | `/api/services/:code/template.xlsx` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:268](../uni-erp/server/routes.js:268) | — | — | — |
| GET | `/api/units/targets` | `request:forward` | [routes.js:376](../uni-erp/server/routes.js:376) | — | — | — |
| GET | `/api/verify-hash/:sha` | عام بلا جلسة | [routes.js:430](../uni-erp/server/routes.js:430) | — | نعم | — |
| GET | `/api/verify/:code` | عام بلا جلسة | [routes.js:423](../uni-erp/server/routes.js:423) | — | — | — |

## الحسابات والأدوار (17)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/admin/access` | `user:manage` / `role:manage` | [routes.js:479](../uni-erp/server/routes.js:479) | — | — | — |
| GET | `/api/admin/access/matrix.xlsx` | `user:manage` / `role:manage` | [routes.js:483](../uni-erp/server/routes.js:483) | — | — | — |
| POST | `/api/admin/links` | `role:manage` | [routes.js:493](../uni-erp/server/routes.js:493) | — | — | — |
| DELETE | `/api/admin/links/:id` | `role:manage` | [routes.js:494](../uni-erp/server/routes.js:494) | — | — | — |
| POST | `/api/admin/roles` | `role:manage` | [routes.js:487](../uni-erp/server/routes.js:487) | — | — | — |
| DELETE | `/api/admin/roles/:key` | `role:manage` | [routes.js:489](../uni-erp/server/routes.js:489) | — | — | — |
| PUT | `/api/admin/roles/:key` | `role:manage` | [routes.js:488](../uni-erp/server/routes.js:488) | — | — | — |
| POST | `/api/admin/units` | `role:manage` | [routes.js:490](../uni-erp/server/routes.js:490) | — | — | — |
| DELETE | `/api/admin/units/:id` | `role:manage` | [routes.js:492](../uni-erp/server/routes.js:492) | — | — | — |
| PUT | `/api/admin/units/:id` | `role:manage` | [routes.js:491](../uni-erp/server/routes.js:491) | — | — | — |
| GET | `/api/admin/users` | `user:manage` | [routes.js:470](../uni-erp/server/routes.js:470) | — | — | — |
| POST | `/api/admin/users` | `user:manage` | [routes.js:472](../uni-erp/server/routes.js:472) | — | — | — |
| DELETE | `/api/admin/users/:id` | `user:manage` | [routes.js:474](../uni-erp/server/routes.js:474) | — | — | — |
| PUT | `/api/admin/users/:id` | `user:manage` | [routes.js:473](../uni-erp/server/routes.js:473) | — | — | — |
| GET | `/api/admin/users/:id/access` | `user:manage` | [routes.js:471](../uni-erp/server/routes.js:471) | — | — | — |
| POST | `/api/admin/users/:id/active` | `user:manage` | [routes.js:475](../uni-erp/server/routes.js:475) | — | — | — |
| POST | `/api/admin/users/:id/reset-password` | `user:manage` | [routes.js:476](../uni-erp/server/routes.js:476) | — | — | — |

## الأخبار والتواصل (16)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/complaints` | `complaint:create` / `complaint:manage` | [routes.js:150](../uni-erp/server/routes.js:150) | — | — | — |
| POST | `/api/complaints` | `complaint:create` | [routes.js:149](../uni-erp/server/routes.js:149) | — | — | — |
| DELETE | `/api/complaints/:id` | `complaint:manage` | [routes.js:154](../uni-erp/server/routes.js:154) | — | — | — |
| POST | `/api/complaints/:id/respond` | `complaint:manage` | [routes.js:155](../uni-erp/server/routes.js:155) | — | — | — |
| GET | `/api/media/:id` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:148](../uni-erp/server/routes.js:148) | — | — | — |
| GET | `/api/news` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:140](../uni-erp/server/routes.js:140) | — | — | — |
| POST | `/api/news` | `news:manage` | [routes.js:141](../uni-erp/server/routes.js:141) | — | — | — |
| DELETE | `/api/news/:id` | `news:manage` | [routes.js:143](../uni-erp/server/routes.js:143) | — | — | — |
| PUT | `/api/news/:id` | `news:manage` | [routes.js:142](../uni-erp/server/routes.js:142) | — | — | — |
| POST | `/api/news/:id/links` | `news:manage` | [routes.js:146](../uni-erp/server/routes.js:146) | — | — | — |
| POST | `/api/news/:id/media` | `news:manage` | [routes.js:145](../uni-erp/server/routes.js:145) | — | — | `51 * 1024 * 1024` |
| DELETE | `/api/news/media/:id` | `news:manage` | [routes.js:147](../uni-erp/server/routes.js:147) | — | — | — |
| GET | `/api/push/key` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:167](../uni-erp/server/routes.js:167) | — | — | — |
| POST | `/api/push/subscribe` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:168](../uni-erp/server/routes.js:168) | — | — | — |
| POST | `/api/push/test` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:170](../uni-erp/server/routes.js:170) | — | — | — |
| POST | `/api/push/unsubscribe` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:169](../uni-erp/server/routes.js:169) | — | — | — |

## البحث والخريجون والجودة والذكاء الاصطناعي (15)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/ai/advisor/ask` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/v12_modules.js:1049](../uni-erp/server/services/v12_modules.js:1049) | — | نعم | — |
| POST | `/api/ai/early-warning/analyze` | `enterprise_ai:use` / `sa_advising:edit` | [services/v12_modules.js:1014](../uni-erp/server/services/v12_modules.js:1014) | — | نعم | — |
| GET | `/api/ai/overview` | `AI_READ` | [services/v12_modules.js:991](../uni-erp/server/services/v12_modules.js:991) | — | نعم | — |
| POST | `/api/ai/triage/analyze` | `enterprise_ai:use` / `corr:use` / `complaint:manage` | [services/v12_modules.js:1083](../uni-erp/server/services/v12_modules.js:1083) | — | نعم | — |
| POST | `/api/alumni/applications` | `ALUMNI_WRITE` | [services/v12_modules.js:536](../uni-erp/server/services/v12_modules.js:536) | — | نعم | — |
| POST | `/api/alumni/jobs` | `ALUMNI_WRITE` | [services/v12_modules.js:513](../uni-erp/server/services/v12_modules.js:513) | — | نعم | — |
| GET | `/api/alumni/overview` | `alumni_career:view` / `ALUMNI_WRITE` | [services/v12_modules.js:460](../uni-erp/server/services/v12_modules.js:460) | — | نعم | — |
| POST | `/api/alumni/records` | `ALUMNI_WRITE` | [services/v12_modules.js:484](../uni-erp/server/services/v12_modules.js:484) | — | نعم | — |
| POST | `/api/qa/kpis` | `QA_WRITE` | [services/v12_modules.js:582](../uni-erp/server/services/v12_modules.js:582) | — | نعم | — |
| GET | `/api/qa/overview` | `qa_inst:view` / `QA_WRITE` | [services/v12_modules.js:560](../uni-erp/server/services/v12_modules.js:560) | — | نعم | — |
| POST | `/api/qa/surveys` | `QA_WRITE` | [services/v12_modules.js:599](../uni-erp/server/services/v12_modules.js:599) | — | نعم | — |
| GET | `/api/research/overview` | `research_grad:view` / `faculty:manage` / `RESEARCH_WRITE` | [services/v12_modules.js:379](../uni-erp/server/services/v12_modules.js:379) | — | نعم | — |
| POST | `/api/research/projects` | `RESEARCH_WRITE` | [services/v12_modules.js:397](../uni-erp/server/services/v12_modules.js:397) | — | نعم | — |
| POST | `/api/research/theses` | `RESEARCH_WRITE` | [services/v12_modules.js:424](../uni-erp/server/services/v12_modules.js:424) | — | نعم | — |
| PUT | `/api/research/theses/:id/stage` | `research_grad:edit` / `research_grad:approve` | [services/v12_modules.js:449](../uni-erp/server/services/v12_modules.js:449) | — | نعم | — |

## منظومة شؤون الطلاب (14)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/student-affairs-suite/admissions/applicant` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1063](../uni-erp/server/services/student_affairs_suite.js:1063) | — | — | — |
| POST | `/api/student-affairs-suite/admissions/enroll/:id` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1071](../uni-erp/server/services/student_affairs_suite.js:1071) | — | — | — |
| POST | `/api/student-affairs-suite/admissions/run-sort` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1067](../uni-erp/server/services/student_affairs_suite.js:1067) | نعم | — | — |
| POST | `/api/student-affairs-suite/advising` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1082](../uni-erp/server/services/student_affairs_suite.js:1082) | — | — | — |
| POST | `/api/student-affairs-suite/advising/:id/resolve` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1086](../uni-erp/server/services/student_affairs_suite.js:1086) | — | — | — |
| POST | `/api/student-affairs-suite/disciplinary` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1094](../uni-erp/server/services/student_affairs_suite.js:1094) | — | — | — |
| POST | `/api/student-affairs-suite/equivalence` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1075](../uni-erp/server/services/student_affairs_suite.js:1075) | — | — | — |
| POST | `/api/student-affairs-suite/lifecycle` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1090](../uni-erp/server/services/student_affairs_suite.js:1090) | — | — | — |
| GET | `/api/student-affairs-suite/overview` | `SUITE_READ` | [services/student_affairs_suite.js:1058](../uni-erp/server/services/student_affairs_suite.js:1058) | نعم | — | — |
| POST | `/api/student-affairs-suite/prerequisites` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1079](../uni-erp/server/services/student_affairs_suite.js:1079) | — | — | — |
| DELETE | `/api/student-affairs-suite/prerequisites/:id` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1080](../uni-erp/server/services/student_affairs_suite.js:1080) | — | — | — |
| POST | `/api/student-affairs-suite/queue/:id/status` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1106](../uni-erp/server/services/student_affairs_suite.js:1106) | — | — | — |
| POST | `/api/student-affairs-suite/queue/book` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1102](../uni-erp/server/services/student_affairs_suite.js:1102) | — | — | — |
| POST | `/api/student-affairs-suite/scholarships` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/student_affairs_suite.js:1098](../uni-erp/server/services/student_affairs_suite.js:1098) | — | — | — |

## التحليلات والتدقيق (13)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/analytics` | `stats:read` | [routes.js:387](../uni-erp/server/routes.js:387) | نعم | — | — |
| POST | `/api/analytics/export.docx` | `stats:read` | [routes.js:394](../uni-erp/server/routes.js:394) | نعم | — | `14 * 1024 * 1024` |
| GET | `/api/analytics/export.xlsx` | `stats:read` | [routes.js:389](../uni-erp/server/routes.js:389) | نعم | — | — |
| GET | `/api/audit` | `audit:read` | [routes.js:461](../uni-erp/server/routes.js:461) | — | نعم | — |
| GET | `/api/audit/verify` | `audit:read` | [routes.js:467](../uni-erp/server/routes.js:467) | نعم | — | — |
| GET | `/api/devops/incidents` | `DEVOPS_ACCESS` | [services/v12_modules.js:890](../uni-erp/server/services/v12_modules.js:890) | — | — | — |
| POST | `/api/devops/incidents` | `DEVOPS_ACCESS` | [services/v12_modules.js:896](../uni-erp/server/services/v12_modules.js:896) | — | نعم | — |
| DELETE | `/api/devops/incidents/:id` | `devops:manage` / `settings:manage` / `backup:manage` | [services/v12_modules.js:951](../uni-erp/server/services/v12_modules.js:951) | — | نعم | — |
| POST | `/api/devops/incidents/:id/resolve` | `devops:manage` / `settings:manage` / `backup:manage` | [services/v12_modules.js:934](../uni-erp/server/services/v12_modules.js:934) | — | نعم | — |
| GET | `/api/devops/overview` | `DEVOPS_ACCESS` | [services/v12_modules.js:836](../uni-erp/server/services/v12_modules.js:836) | — | نعم | — |
| GET | `/api/devops/postgres-ddl` | `DEVOPS_ACCESS` | [services/v12_modules.js:968](../uni-erp/server/services/v12_modules.js:968) | — | نعم | — |
| PUT | `/api/devops/settings/:key` | `devops:manage` / `settings:manage` / `backup:manage` | [services/v12_modules.js:959](../uni-erp/server/services/v12_modules.js:959) | — | نعم | — |
| GET | `/api/stats` | `stats:read` | [routes.js:399](../uni-erp/server/routes.js:399) | — | — | — |

## التعلم الإلكتروني (12)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/lms/books` | `holds:manage` / `lms_lib:write` / `lms_lib:edit` / `course:manage` | [services/v12_modules.js:313](../uni-erp/server/services/v12_modules.js:313) | — | نعم | — |
| DELETE | `/api/lms/files/:id` | `course:manage` / `lms_lib:delete` / `lms_lib:edit` | [services/v12_modules.js:283](../uni-erp/server/services/v12_modules.js:283) | — | — | — |
| GET | `/api/lms/files/:id` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/v12_modules.js:280](../uni-erp/server/services/v12_modules.js:280) | — | — | — |
| GET | `/api/lms/files/:id/media/:name` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/v12_modules.js:282](../uni-erp/server/services/v12_modules.js:282) | — | — | — |
| GET | `/api/lms/files/:id/slides` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/v12_modules.js:281](../uni-erp/server/services/v12_modules.js:281) | — | — | — |
| POST | `/api/lms/lectures` | `course:manage` / `lms_lib:write` / `lms_lib:edit` | [services/v12_modules.js:243](../uni-erp/server/services/v12_modules.js:243) | — | نعم | — |
| DELETE | `/api/lms/lectures/:id` | `course:manage` / `lms_lib:delete` / `lms_lib:edit` | [services/v12_modules.js:266](../uni-erp/server/services/v12_modules.js:266) | — | نعم | — |
| POST | `/api/lms/lectures/:id/files` | `course:manage` / `lms_lib:write` / `lms_lib:edit` | [services/v12_modules.js:275](../uni-erp/server/services/v12_modules.js:275) | — | — | `205 * 1024 * 1024` |
| POST | `/api/lms/loans` | `holds:manage` / `lms_lib:write` / `lms_lib:edit` / `course:manage` | [services/v12_modules.js:337](../uni-erp/server/services/v12_modules.js:337) | — | نعم | — |
| POST | `/api/lms/loans/:id/return` | `holds:manage` / `lms_lib:write` / `lms_lib:edit` / `course:manage` | [services/v12_modules.js:362](../uni-erp/server/services/v12_modules.js:362) | — | نعم | — |
| GET | `/api/lms/overview` | `lms_lib:view` / `holds:manage` / `LMS_READ` | [services/v12_modules.js:209](../uni-erp/server/services/v12_modules.js:209) | — | نعم | — |
| POST | `/api/lms/quizzes` | `course:manage` / `lms_lib:write` / `lms_lib:edit` | [services/v12_modules.js:289](../uni-erp/server/services/v12_modules.js:289) | — | نعم | — |

## الحزمة المؤسسية (11)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/enterprise/faculty-overload` | `hr:manage` / `hr_payroll:approve` / `faculty:manage` | [services/enterprise_suite.js:286](../uni-erp/server/services/enterprise_suite.js:286) | — | نعم | — |
| GET | `/api/enterprise/global-search` | `student:read` / `SEES_PAYROLL` | [services/enterprise_suite.js:401](../uni-erp/server/services/enterprise_suite.js:401) | — | نعم | — |
| POST | `/api/enterprise/gpa-simulate` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/enterprise_suite.js:207](../uni-erp/server/services/enterprise_suite.js:207) | — | — | — |
| POST | `/api/enterprise/installments/:id/pay` | `finance:post` / `finance:fees` | [services/enterprise_suite.js:337](../uni-erp/server/services/enterprise_suite.js:337) | — | نعم | — |
| POST | `/api/enterprise/notifications/broadcast` | `news:manage` | [services/enterprise_suite.js:358](../uni-erp/server/services/enterprise_suite.js:358) | — | نعم | — |
| POST | `/api/enterprise/offline-sync` | `grade:manage` / `attendance:manage` | [services/enterprise_suite.js:379](../uni-erp/server/services/enterprise_suite.js:379) | — | نعم | — |
| GET | `/api/enterprise/overview` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/enterprise_suite.js:147](../uni-erp/server/services/enterprise_suite.js:147) | — | — | — |
| POST | `/api/enterprise/payslips/issue` | `hr:manage` / `hr_payroll:approve` | [services/enterprise_suite.js:311](../uni-erp/server/services/enterprise_suite.js:311) | — | نعم | — |
| POST | `/api/enterprise/quizzes/:id/submit` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [services/enterprise_suite.js:183](../uni-erp/server/services/enterprise_suite.js:183) | — | نعم | — |
| POST | `/api/enterprise/schedule` | `course:manage` / `attendance:manage` | [services/enterprise_suite.js:152](../uni-erp/server/services/enterprise_suite.js:152) | — | نعم | — |
| POST | `/api/enterprise/self-enroll` | `course:manage` / `student:register` | [services/enterprise_suite.js:214](../uni-erp/server/services/enterprise_suite.js:214) | — | نعم | — |

## الاستيراد والتصدير (11)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/export/file` | `data:export` | [routes.js:404](../uni-erp/server/routes.js:404) | نعم | — | — |
| GET | `/api/export/options` | `data:export` | [routes.js:402](../uni-erp/server/routes.js:402) | — | — | — |
| GET | `/api/export/preview` | `data:export` | [routes.js:403](../uni-erp/server/routes.js:403) | نعم | — | — |
| POST | `/api/import-engine/:kind/check` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:250](../uni-erp/server/routes.js:250) | نعم | — | `15 * 1024 * 1024` |
| POST | `/api/import-engine/:kind/commit` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:251](../uni-erp/server/routes.js:251) | نعم | — | — |
| GET | `/api/import-engine/:kind/template` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:252](../uni-erp/server/routes.js:252) | — | — | — |
| GET | `/api/import-engine/batches` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:247](../uni-erp/server/routes.js:247) | — | — | — |
| POST | `/api/import-engine/batches/:id/undo` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:248](../uni-erp/server/routes.js:248) | نعم | — | — |
| POST | `/api/import-engine/cancel` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:249](../uni-erp/server/routes.js:249) | — | — | — |
| GET | `/api/import-engine/catalog` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:246](../uni-erp/server/routes.js:246) | — | — | — |
| POST | `/api/import/:kind` | `role:manage` | [routes.js:257](../uni-erp/server/routes.js:257) | نعم | — | `15 * 1024 * 1024` |

## الامتحانات والتوسعات (9)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/expansions/appeals` | `grade:manage` / `grade:approve` / `EXAMS_MANAGE` | [services/v12_modules.js:702](../uni-erp/server/services/v12_modules.js:702) | — | نعم | — |
| POST | `/api/expansions/appeals/:id/decide` | `grade:approve` / `exams_housing:approve` | [services/v12_modules.js:718](../uni-erp/server/services/v12_modules.js:718) | — | نعم | — |
| POST | `/api/expansions/appraisals` | `hr_emp:edit` / `hr:manage` | [services/v12_modules.js:802](../uni-erp/server/services/v12_modules.js:802) | — | نعم | — |
| POST | `/api/expansions/biometrics/sync` | `hr:manage` / `staffatt:manage` | [services/v12_modules.js:828](../uni-erp/server/services/v12_modules.js:828) | — | نعم | — |
| POST | `/api/expansions/dorm-allocations` | `sa_housing:manage` | [services/v12_modules.js:760](../uni-erp/server/services/v12_modules.js:760) | — | نعم | — |
| POST | `/api/expansions/exams` | `course:manage` / `EXAMS_MANAGE` | [services/v12_modules.js:673](../uni-erp/server/services/v12_modules.js:673) | — | نعم | — |
| POST | `/api/expansions/office-bookings` | `sa_housing:manage` / `faculty:manage` | [services/v12_modules.js:742](../uni-erp/server/services/v12_modules.js:742) | — | نعم | — |
| GET | `/api/expansions/overview` | `grade:manage` / `grade:approve` / `faculty:manage` / `EXAMS_READ` / `HR_READ` | [services/v12_modules.js:628](../uni-erp/server/services/v12_modules.js:628) | — | نعم | — |
| POST | `/api/expansions/scholarships` | `sa_scholarships:approve` / `finance:fees` | [services/v12_modules.js:783](../uni-erp/server/services/v12_modules.js:783) | — | نعم | — |

## الفئات والسكن (9)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/me/groups` | فحص داخل المعالج | [services/student_groups.js:115](../uni-erp/server/services/student_groups.js:115) | — | — | — |
| GET | `/api/student-groups` | فحص داخل المعالج | [services/student_groups.js:108](../uni-erp/server/services/student_groups.js:108) | — | — | — |
| POST | `/api/student-groups` | فحص داخل المعالج | [services/student_groups.js:109](../uni-erp/server/services/student_groups.js:109) | — | — | — |
| DELETE | `/api/student-groups/:id` | فحص داخل المعالج | [services/student_groups.js:113](../uni-erp/server/services/student_groups.js:113) | — | — | — |
| GET | `/api/student-groups/:id` | فحص داخل المعالج | [services/student_groups.js:111](../uni-erp/server/services/student_groups.js:111) | — | — | — |
| PUT | `/api/student-groups/:id` | فحص داخل المعالج | [services/student_groups.js:112](../uni-erp/server/services/student_groups.js:112) | — | — | — |
| PUT | `/api/student-groups/:id/members` | فحص داخل المعالج | [services/student_groups.js:114](../uni-erp/server/services/student_groups.js:114) | — | — | — |
| POST | `/api/student-groups/split` | فحص داخل المعالج | [services/student_groups.js:110](../uni-erp/server/services/student_groups.js:110) | — | — | — |
| GET | `/api/student-life/overview` | `faculty:manage` / `student:read` / `sa_scholarships:view` / `sa_scholarships:write` / `sa_scholarships:approve` / `finance:read` / `finance:fees` / `HOUSING_READ` | [services/v12_modules.js:656](../uni-erp/server/services/v12_modules.js:656) | — | نعم | — |

## الهوية والجلسات (7)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| POST | `/api/auth/change-password` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:82](../uni-erp/server/routes.js:82) | — | — | — |
| POST | `/api/auth/login` | عام بلا جلسة | [routes.js:64](../uni-erp/server/routes.js:64) | — | — | — |
| POST | `/api/auth/logout` | جلسة، والفحص داخل الخدمة أو خاص بالمستخدم نفسه | [routes.js:81](../uni-erp/server/routes.js:81) | — | — | — |
| GET | `/api/health` | عام بلا جلسة | [routes.js:84](../uni-erp/server/routes.js:84) | — | نعم | — |
| GET | `/api/local-accounts` | عام، ومحصور بـDEMO_MODE وعنوان محلي | [routes.js:73](../uni-erp/server/routes.js:73) | — | — | — |
| POST | `/api/local-switch` | عام، ومحصور بـDEMO_MODE وعنوان محلي | [routes.js:74](../uni-erp/server/routes.js:74) | — | — | — |
| GET | `/api/me` | عام بلا جلسة | [routes.js:85](../uni-erp/server/routes.js:85) | — | — | — |

## أخرى (7)

| الطريقة | المسار | الصلاحية | الموقع | ثقيل | SQL مباشر | الحد |
|---|---|---|---|---|---|---|
| GET | `/api/me/certificate` | `profile:read_own` | [routes.js:454](../uni-erp/server/routes.js:454) | — | — | — |
| GET | `/api/me/certificate.pdf` | `profile:read_own` | [routes.js:455](../uni-erp/server/routes.js:455) | — | — | — |
| GET | `/api/me/fees` | `finance:fees` | [services/finance/routes.js:408](../uni-erp/server/services/finance/routes.js:408) | — | — | — |
| PUT | `/api/transcript-template` | `program:manage` / `request:decide` | [routes.js:86](../uni-erp/server/routes.js:86) | — | — | — |
| POST | `/api/v12/high-concurrency/benchmark` | `devops:manage` / `settings:manage` | [routes.js:585](../uni-erp/server/routes.js:585) | نعم | — | — |
| POST | `/api/v12/high-concurrency/cache/flush` | `devops:manage` / `settings:manage` | [routes.js:576](../uni-erp/server/routes.js:576) | — | — | — |
| GET | `/api/v12/high-concurrency/telemetry` | `audit:read` / `devops:manage` / `settings:manage` / `backup:manage` | [routes.js:555](../uni-erp/server/routes.js:555) | — | نعم | — |

