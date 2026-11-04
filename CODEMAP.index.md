# CODEMAP.index — فهرس مولَّد آلياً

مولَّد من الكود مباشرة. استخرجته بتحليل نصي، فقد تفوته الاستدعاءات المبنية ديناميكياً. عمود «الواجهة» الفارغ لا يعني بالضرورة أن المسار غير مستخدم.

الإجمالي: 391 مساراً · 123 جدولاً · 28 شاشة مسجّلة بـ UA.views

## 1) الشاشات ← مكان التعريف

الملفات بترتيب التحميل في `index.html`. **آخر ملف في الصف هو الذي يُعرض فعلياً**.

| الشاشة | التعريفات | الفعّال |
|---|---|---|
| `academics` | staff.js:160 ← ux_restructure.js:1008 | **ux_restructure.js:1008** |
| `access` | access.js:839 | **access.js:839** |
| `ai` | v12_views.js:1618 | **v12_views.js:1618** |
| `alumni` | v12_views.js:454 | **v12_views.js:454** |
| `attendance` | attendance.js:160 | **attendance.js:160** |
| `audit` | ux_restructure.js:502 | **ux_restructure.js:502** |
| `comms` | staff.js:287 | **staff.js:287** |
| `corr` | corr.js:366 ← ux_restructure.js:1794 | **ux_restructure.js:1794** |
| `dashboard` | dashboard.js:162 | **dashboard.js:162** |
| `desk` | desk.js:70 | **desk.js:70** |
| `devops` | v12_views.js:1109 | **v12_views.js:1109** |
| `enterprise` | enterprise_suite.js:651 | **enterprise_suite.js:651** |
| `exchange` | exchange.js:20 | **exchange.js:20** |
| `expansions` | v12_views.js:752 | **v12_views.js:752** |
| `export` | export.js:60 | **export.js:60** |
| `finance` | finance.js:1106 | **finance.js:1106** |
| `guidelines` | ux_restructure.js:2363 | **ux_restructure.js:2363** |
| `hr` | staffatt.js:55 | **staffatt.js:55** |
| `import` | import.js:66 | **import.js:66** |
| `internal` | internal.js:207 ← ux_restructure.js:1795 | **ux_restructure.js:1795** |
| `lms` | v12_views.js:105 | **v12_views.js:105** |
| `overview` | shell.js:168 ← ux_restructure.js:170 | **ux_restructure.js:170** |
| `payroll` | payroll.js:1257 ← ux_restructure.js:347 | **ux_restructure.js:347** |
| `procurement` | procurement.js:1027 | **procurement.js:1027** |
| `qa` | v12_views.js:593 | **v12_views.js:593** |
| `reqx` | internal.js:260 | **internal.js:260** |
| `research` | v12_views.js:325 | **v12_views.js:325** |
| `units` | units.js:29 | **units.js:29** |

## 2) المسارات ← الصلاحية ← الواجهة

### uni-erp/server/routes.js (196)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| POST | `/api/auth/login` | 56 | عام | app.js |
| POST | `/api/auth/logout` | 60 | — | app.js |
| POST | `/api/auth/change-password` | 61 | — | app.js desk.js student.js |
| GET | `/api/health` | 63 | عام |  |
| GET | `/api/me` | 64 | عام | app.js general.js |
| PUT | `/api/transcript-template` | 65 | `program:manage` `request:decide` | app.js |
| GET | `/api/admin/waf/stats` | 68 | `settings:manage` | adminconfig.js |
| POST | `/api/admin/waf/unban` | 69 | `settings:manage` | adminconfig.js |
| GET | `/api/admin/waf/test` | 70 | `settings:manage` |  |
| GET | `/api/admin/general` | 72 | `settings:manage` | general.js |
| PUT | `/api/admin/general` | 73 | `settings:manage` | general.js |
| POST | `/api/admin/general/reset` | 74 | `settings:manage` | general.js |
| GET | `/api/me/desk` | 75 | — | desk.js |
| GET | `/api/me/profile` | 76 | `profile:read_own` | student.js |
| PUT | `/api/me/profile` | 78 | `profile:update_own` | student.js |
| GET | `/api/courses` | 81 | `course:read_own` `course:manage` | faculty.js staff.js student.js ux_restructure.js |
| POST | `/api/courses` | 85 | `course:manage` | faculty.js staff.js student.js ux_restructure.js |
| PUT | `/api/courses/:id` | 86 | `course:manage` | faculty.js staff.js |
| DELETE | `/api/courses/:id` | 87 | `course:manage` | faculty.js staff.js |
| POST | `/api/courses/:id/toggle` | 88 | `course:manage` | staff.js |
| GET | `/api/grades` | 89 | `grade:manage` `student:read` | staff.js |
| GET | `/api/me/grades` | 93 | `grade:read_own` | student.js |
| GET | `/api/students/:id/grades` | 94 | `student:read` | staff.js |
| POST | `/api/students/:id/grades` | 95 | `grade:manage` | staff.js |
| DELETE | `/api/students/:id/grades/:gid` | 100 | `grade:manage` | staff.js |
| POST | `/api/grades/workflow` | 102 | `grade:manage` | staff.js |
| GET | `/api/grades/:id/history` | 107 | `grade:manage` |  |
| POST | `/api/grades/workflow-setting` | 108 | `grade:approve` | staff.js |
| GET | `/api/courses/:id/schedule` | 109 | `course:manage` | staff.js |
| PUT | `/api/courses/:id/schedule` | 110 | `course:manage` | staff.js |
| GET | `/api/students/:id/schedule-conflicts` | 111 | `student:read` | student.js |
| GET | `/api/students/:id/unified-record` | 115 | `student:read` | record360.js |
| GET | `/api/news` | 116 | — | staff.js student.js |
| POST | `/api/news` | 117 | `news:manage` | staff.js student.js |
| PUT | `/api/news/:id` | 118 | `news:manage` | staff.js |
| DELETE | `/api/news/:id` | 119 | `news:manage` | staff.js |
| POST | `/api/news/:id/media` | 121 | `news:manage` | staff.js |
| POST | `/api/news/:id/links` | 122 | `news:manage` | staff.js |
| DELETE | `/api/news/media/:id` | 123 | `news:manage` | staff.js |
| GET | `/api/media/:id` | 124 | — |  |
| POST | `/api/complaints` | 125 | `complaint:create` | staff.js student.js |
| GET | `/api/complaints` | 126 | `complaint:create` `complaint:manage` | staff.js student.js |
| DELETE | `/api/complaints/:id` | 130 | `complaint:manage` | staff.js |
| POST | `/api/complaints/:id/respond` | 131 | `complaint:manage` | staff.js |
| GET | `/api/registration/options` | 134 | `student:register` `program:manage` | app.js |
| POST | `/api/students` | 135 | `student:register` | app.js prefetch.js stable.js staff.js student_picker.js ux_restructure.js |
| GET | `/api/students` | 136 | `student:read` | app.js prefetch.js stable.js staff.js student_picker.js ux_restructure.js |
| POST | `/api/attendance/scan` | 137 | `attendance:manage` | attendance.js |
| GET | `/api/attendance` | 138 | `attendance:manage` | attendance.js |
| GET | `/api/attendance/open` | 139 | `attendance:manage` | attendance.js |
| POST | `/api/attendance` | 140 | `attendance:manage` | attendance.js |
| PUT | `/api/attendance/:id` | 141 | `attendance:manage` | attendance.js prefetch.js |
| DELETE | `/api/attendance/:id` | 142 | `attendance:manage` | attendance.js prefetch.js |
| GET | `/api/push/key` | 143 | — | push.js |
| POST | `/api/push/subscribe` | 144 | — | push.js |
| POST | `/api/push/unsubscribe` | 145 | — | push.js |
| POST | `/api/push/test` | 146 | — | push.js |
| GET | `/api/admin/backups` | 147 | `backup:manage` | app.js backup.js |
| POST | `/api/admin/backups` | 148 | `backup:manage` | app.js backup.js |
| GET | `/api/admin/backups/:name` | 149 | `backup:manage` | backup.js |
| DELETE | `/api/admin/backups/:name` | 156 | `backup:manage` | backup.js |
| GET | `/api/students-table` | 157 | `student:read` | stable.js |
| GET | `/api/students/:id/files` | 158 | `student:read` | app.js idcard.js stable.js |
| POST | `/api/students/:id/files` | 159 | `student:register` `student:update` | app.js idcard.js stable.js |
| GET | `/api/student-files/:fid` | 163 | — | app.js attendance.js stable.js |
| DELETE | `/api/student-files/:fid` | 164 | `student:register` `student:update` | app.js attendance.js stable.js |
| GET | `/api/students/:id` | 168 | `student:read` | app.js stable.js staff.js |
| PUT | `/api/students/:id` | 175 | `student:update` | app.js stable.js staff.js |
| DELETE | `/api/students/:id` | 176 | `student:delete` | app.js stable.js staff.js |
| POST | `/api/students/:id/reset-password` | 177 | `student:reset_password` | app.js |
| GET | `/api/programs` | 178 | `student:read` | app.js staff.js |
| GET | `/api/students/:id/card-activity` | 180 | `student:read` | ux_restructure.js |
| POST | `/api/students/:id/card-activity` | 191 | — | ux_restructure.js |
| POST | `/api/import/:kind` | 217 | — | import.js |
| GET | `/api/services/:code/template.xlsx` | 219 | — | internal.js |
| GET | `/api/requests/export.xlsx` | 220 | — | internal.js |
| POST | `/api/services/:code/import` | 221 | `request:import` | internal.js |
| POST | `/api/hr/attendance/punch` | 223 | `staffatt:self` | desk.js staffatt.js |
| GET | `/api/hr/settings` | 224 | `staffatt:manage` | staffatt.js |
| PUT | `/api/hr/settings` | 225 | `staffatt:manage` | staffatt.js |
| GET | `/api/hr/attendance/me` | 226 | `staffatt:self` | staffatt.js |
| GET | `/api/hr/attendance/export.xlsx` | 227 | `staffatt:manage` | staffatt.js |
| GET | `/api/hr/attendance` | 228 | `staffatt:manage` | staffatt.js |
| GET | `/api/hr/leaves` | 229 | `staffatt:manage` | staffatt.js |
| PUT | `/api/hr/leave/entitlement` | 230 | `staffatt:manage` `corr:use` `corr:read_all` | staffatt.js |
| GET | `/api/corr/people` | 233 | `corr:use` | corr.js |
| GET | `/api/corr/templates` | 234 | `corr:use` | corr.js |
| POST | `/api/corr/templates` | 235 | `corr:templates` | corr.js |
| PUT | `/api/corr/templates/:code` | 236 | `corr:templates` | corr.js |
| DELETE | `/api/corr/templates/:code` | 237 | `corr:templates` | corr.js |
| GET | `/api/corr/notifications` | 238 | — | corr.js |
| POST | `/api/corr/notifications/read` | 239 | — | corr.js |
| GET | `/api/corr/files/:id` | 240 | — | corr.js |
| GET | `/api/corr` | 241 | — | corr.js |
| POST | `/api/corr` | 242 | `corr:use` | corr.js |
| GET | `/api/corr/:id` | 243 | — | corr.js ux_enhancements.js |
| PUT | `/api/corr/:id` | 244 | `corr:use` | corr.js ux_enhancements.js |
| GET | `/api/corr/:id/pdf` | 245 | — | corr.js |
| POST | `/api/corr/:id/send` | 246 | `corr:use` |  |
| POST | `/api/corr/:id/approve` | 247 | `corr:use` |  |
| POST | `/api/corr/:id/reject` | 248 | `corr:use` |  |
| POST | `/api/corr/:id/comment` | 249 | `corr:use` |  |
| POST | `/api/corr/:id/cancel` | 250 | `corr:use` |  |
| GET | `/api/faculties` | 251 | `student:read` | app.js |
| POST | `/api/admin/faculties` | 252 | `program:manage` | app.js |
| PUT | `/api/admin/faculties/:id` | 253 | `program:manage` | app.js |
| DELETE | `/api/admin/faculties/:id` | 254 | `program:manage` | app.js |
| POST | `/api/admin/faculties/:id/toggle` | 255 | `program:manage` | app.js |
| POST | `/api/admin/programs` | 256 | `program:manage` | app.js |
| PUT | `/api/admin/programs/:id` | 257 | `program:manage` | app.js |
| DELETE | `/api/admin/programs/:id` | 258 | `program:manage` | app.js |
| POST | `/api/admin/programs/:id/toggle` | 259 | `program:manage` | app.js |
| GET | `/api/faculty` | 262 | `faculty:manage` `course:manage` | faculty.js prefetch.js |
| POST | `/api/faculty` | 266 | `faculty:manage` | faculty.js prefetch.js |
| PUT | `/api/faculty/:id` | 267 | `faculty:manage` | faculty.js |
| POST | `/api/faculty/:id/toggle` | 268 | `faculty:manage` | faculty.js |
| DELETE | `/api/faculty/:id` | 269 | `faculty:manage` | faculty.js |
| GET | `/api/admin/hr/employees` | 272 | `hr:manage` |  |
| POST | `/api/admin/hr/employees` | 273 | `hr:manage` |  |
| GET | `/api/admin/hr/employee/:id` | 274 | `hr:manage` |  |
| PUT | `/api/admin/hr/employee/:id` | 275 | `hr:manage` |  |
| POST | `/api/admin/hr/employee/:id/toggle` | 276 | `hr:manage` |  |
| DELETE | `/api/admin/hr/employee/:id` | 277 | `hr:manage` |  |
| GET | `/api/admin/hr/salaries` | 278 | `hr:manage` |  |
| POST | `/api/admin/hr/salaries` | 279 | `hr:manage` |  |
| GET | `/api/admin/hr/salary/:employeeId/latest` | 280 | `hr:manage` |  |
| GET | `/api/admin/hr/leaves` | 281 | `hr:manage` |  |
| POST | `/api/admin/hr/leaves` | 282 | `hr:manage` |  |
| GET | `/api/admin/hr/leave/:id` | 283 | `hr:manage` |  |
| POST | `/api/admin/hr/leave/:id/approve` | 284 | `hr:manage` |  |
| POST | `/api/admin/hr/leave/:id/reject` | 285 | `hr:manage` |  |
| POST | `/api/admin/hr/leave/:id/cancel` | 286 | `hr:manage` |  |
| GET | `/api/admin/hr/contracts` | 287 | `hr:manage` |  |
| POST | `/api/admin/hr/contracts` | 288 | `hr:manage` |  |
| GET | `/api/admin/hr/options` | 289 | `hr:manage` |  |
| GET | `/api/services` | 292 | `request:import` | app.js import.js internal.js |
| POST | `/api/requests` | 317 | — | app.js internal.js shell.js student.js |
| GET | `/api/requests` | 318 | `request:read_own` `request:read_all` `request:read_unit` `request:create_internal` | app.js internal.js shell.js student.js |
| GET | `/api/requests/:id` | 322 | — | internal.js |
| POST | `/api/requests/:id/approve` | 323 | `request:decide` | app.js |
| POST | `/api/requests/:id/reject` | 324 | `request:decide` | app.js |
| POST | `/api/requests/:id/forward` | 325 | `request:forward` | app.js |
| GET | `/api/units/targets` | 327 | `request:forward` | app.js |
| GET | `/api/attachments/:id` | 333 | — | app.js internal.js |
| GET | `/api/analytics` | 338 | `stats:read` | dashboard.js shell.js |
| GET | `/api/analytics/export.xlsx` | 340 | `stats:read` | dashboard.js |
| POST | `/api/analytics/export.docx` | 344 | `stats:read` | dashboard.js |
| GET | `/api/stats` | 348 | `stats:read` | app.js shell.js |
| GET | `/api/export/options` | 351 | `data:export` | export.js |
| GET | `/api/export/preview` | 352 | `data:export` | export.js |
| GET | `/api/export/file` | 353 | `data:export` | export.js |
| GET | `/api/documents/:code` | 361 | — | app.js |
| GET | `/api/documents/:code/pdf` | 362 | — |  |
| GET | `/api/documents/:code/qr.svg` | 367 | — | app.js transcript.js |
| GET | `/api/verify/:code` | 372 | عام | app.js |
| GET | `/api/verify-hash/:sha` | 379 | عام | app.js |
| GET | `/api/me/certificate` | 403 | `profile:read_own` |  |
| GET | `/api/me/certificate.pdf` | 404 | `profile:read_own` | student.js |
| GET | `/api/students/:id/certificate.pdf` | 405 | `student:read` | app.js |
| GET | `/api/audit` | 410 | `audit:read` | app.js prefetch.js |
| GET | `/api/admin/logs` | 415 | `audit:read` | app.js ux_restructure.js |
| GET | `/api/audit/verify` | 416 | `audit:read` | app.js |
| GET | `/api/admin/users` | 419 | `user:manage` | access.js |
| POST | `/api/admin/users` | 420 | `user:manage` | access.js |
| PUT | `/api/admin/users/:id` | 421 | `user:manage` | access.js |
| DELETE | `/api/admin/users/:id` | 422 | `user:manage` | access.js |
| POST | `/api/admin/users/:id/active` | 423 | `user:manage` | access.js |
| POST | `/api/admin/users/:id/reset-password` | 424 | `user:manage` | access.js |
| GET | `/api/admin/access` | 427 | `user:manage` `role:manage` | access.js |
| GET | `/api/admin/access/matrix.xlsx` | 431 | `user:manage` `role:manage` | access.js |
| POST | `/api/admin/roles` | 435 | `role:manage` | access.js |
| PUT | `/api/admin/roles/:key` | 436 | `role:manage` | access.js |
| DELETE | `/api/admin/roles/:key` | 437 | `role:manage` | access.js |
| POST | `/api/admin/units` | 438 | `role:manage` | access.js |
| PUT | `/api/admin/units/:id` | 439 | `role:manage` | access.js |
| DELETE | `/api/admin/units/:id` | 440 | `role:manage` | access.js |
| POST | `/api/admin/links` | 441 | `role:manage` | access.js |
| DELETE | `/api/admin/links/:id` | 442 | `role:manage` | access.js |
| GET | `/api/admin/holds` | 443 | `holds:manage` | app.js |
| POST | `/api/admin/holds` | 448 | `holds:manage` | app.js |
| PUT | `/api/admin/holds/:id` | 458 | `holds:manage` | app.js |
| DELETE | `/api/admin/holds/:id` | 459 | `holds:manage` | app.js |
| POST | `/api/admin/holds/:id/clear` | 460 | `holds:manage` | app.js student_affairs_suite.js |
| GET | `/api/admin/rules` | 467 | `rules:manage` | app.js |
| POST | `/api/admin/rules/:id/toggle` | 471 | `rules:manage` | app.js |
| GET | `/api/admin/services` | 479 | `rules:manage` | adminconfig.js |
| POST | `/api/admin/services` | 480 | `rules:manage` | adminconfig.js |
| PUT | `/api/admin/services/:code` | 481 | `rules:manage` | adminconfig.js |
| GET | `/api/admin/settings` | 482 | `rules:manage` | adminconfig.js |
| PUT | `/api/admin/settings` | 483 | `rules:manage` | adminconfig.js |
| PUT | `/api/admin/rules/:id` | 484 | `rules:manage` | app.js |
| DELETE | `/api/admin/rules/:id` | 485 | `rules:manage` | app.js |
| GET | `/api/v12/high-concurrency/telemetry` | 501 | عام | ux_restructure.js |
| POST | `/api/v12/high-concurrency/cache/flush` | 526 | عام |  |
| POST | `/api/v12/high-concurrency/benchmark` | 532 | عام | ux_restructure.js |
| POST | `/api/corr/batch` | 611 | `corr:use` |  |

### uni-erp/server/services/enterprise_suite.js (12)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| GET | `/api/enterprise/overview` | 245 | — | enterprise_suite.js |
| POST | `/api/enterprise/schedule` | 250 | — | enterprise_suite.js |
| POST | `/api/enterprise/quizzes/:id/submit` | 280 | — | enterprise_suite.js |
| POST | `/api/enterprise/gpa-simulate` | 303 | — | enterprise_suite.js |
| POST | `/api/enterprise/self-enroll` | 310 | — | enterprise_suite.js |
| POST | `/api/enterprise/faculty-overload` | 366 | — | enterprise_suite.js |
| POST | `/api/enterprise/payslips/issue` | 391 | — | enterprise_suite.js |
| POST | `/api/enterprise/installments/:id/pay` | 417 | — | enterprise_suite.js |
| POST | `/api/enterprise/notifications/broadcast` | 437 | — | enterprise_suite.js |
| POST | `/api/enterprise/snapshots/create` | 457 | — | enterprise_suite.js |
| POST | `/api/enterprise/offline-sync` | 476 | — | enterprise_suite.js |
| GET | `/api/enterprise/global-search` | 497 | — | enterprise_suite.js |

### uni-erp/server/services/finance/routes.js (78)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| GET | `/api/finance/overview` | 24 | — | finance.js |
| GET | `/api/finance/years` | 28 | — |  |
| GET | `/api/finance/fiscal-years` | 29 | — | finance.js |
| POST | `/api/finance/years` | 30 | — |  |
| POST | `/api/finance/fiscal-years` | 31 | — | finance.js |
| POST | `/api/finance/fiscal-years/:id/close` | 32 | — | finance.js |
| GET | `/api/finance/accounts` | 35 | — | finance.js |
| POST | `/api/finance/accounts` | 36 | — | finance.js |
| PUT | `/api/finance/accounts/:id` | 37 | — | finance.js |
| POST | `/api/finance/accounts/:id/toggle` | 38 | — |  |
| DELETE | `/api/finance/accounts/:id` | 39 | — | finance.js |
| GET | `/api/finance/entries` | 42 | — |  |
| GET | `/api/finance/entries/:id` | 43 | — |  |
| POST | `/api/finance/entries` | 44 | — |  |
| PUT | `/api/finance/entries/:id` | 45 | — |  |
| DELETE | `/api/finance/entries/:id` | 46 | — |  |
| POST | `/api/finance/entries/:id/post` | 47 | — |  |
| POST | `/api/finance/entries/:id/reverse` | 48 | — |  |
| GET | `/api/finance/journal` | 51 | — | finance.js |
| GET | `/api/finance/journal/:id` | 52 | — | finance.js |
| POST | `/api/finance/journal` | 53 | — | finance.js |
| PUT | `/api/finance/journal/:id` | 54 | — | finance.js |
| DELETE | `/api/finance/journal/:id` | 55 | — | finance.js |
| POST | `/api/finance/journal/:id/post` | 56 | — | finance.js |
| POST | `/api/finance/journal/:id/reverse` | 57 | — | finance.js |
| GET | `/api/finance/vouchers` | 60 | — | finance.js |
| POST | `/api/finance/vouchers` | 81 | — | finance.js |
| GET | `/api/finance/invoices` | 98 | — | finance.js |
| POST | `/api/finance/invoices` | 118 | — | finance.js |
| POST | `/api/finance/invoices/:id/issue` | 135 | — | finance.js |
| POST | `/api/finance/invoices/:id/cancel` | 136 | — | finance.js |
| GET | `/api/finance/parties` | 139 | — | finance.js |
| POST | `/api/finance/parties` | 147 | — | finance.js |
| PUT | `/api/finance/parties/:id` | 155 | — |  |
| POST | `/api/finance/parties/:id/toggle` | 162 | — |  |
| GET | `/api/finance/cost-centers` | 168 | — | finance.js |
| POST | `/api/finance/cost-centers` | 171 | — | finance.js |
| PUT | `/api/finance/cost-centers/:id` | 178 | — | finance.js |
| POST | `/api/finance/cost-centers/:id/toggle` | 186 | — |  |
| GET | `/api/finance/currencies` | 191 | — |  |
| PUT | `/api/finance/currencies/:code` | 194 | — |  |
| GET | `/api/finance/reports/trial-balance` | 203 | — | finance.js |
| GET | `/api/finance/reports/ledger` | 204 | — | finance.js |
| GET | `/api/finance/reports/income` | 205 | — |  |
| GET | `/api/finance/reports/income-statement` | 206 | — | finance.js |
| GET | `/api/finance/reports/balance-sheet` | 217 | — | finance.js |
| GET | `/api/finance/reports/cash-book` | 218 | — | finance.js |
| GET | `/api/finance/reports/cost-centers` | 237 | — | finance.js |
| GET | `/api/finance/reports/party` | 238 | — |  |
| GET | `/api/finance/reports/party-statement` | 239 | — | finance.js |
| GET | `/api/finance/reports/trial-balance.xlsx` | 250 | `finance:read` | finance.js |
| GET | `/api/finance/fee-types` | 262 | — |  |
| POST | `/api/finance/fee-types` | 263 | — |  |
| POST | `/api/finance/fee-types/:id/toggle` | 264 | — |  |
| GET | `/api/finance/charges` | 265 | — |  |
| POST | `/api/finance/charges` | 266 | — |  |
| POST | `/api/finance/charges/:id/void` | 267 | — |  |
| GET | `/api/finance/payments` | 268 | — |  |
| POST | `/api/finance/payments` | 269 | — |  |
| POST | `/api/finance/payments/:id/void` | 270 | — |  |
| GET | `/api/finance/student-statement/:id` | 271 | — |  |
| GET | `/api/finance/payroll-months` | 272 | — |  |
| GET | `/api/finance/payroll-preview` | 273 | — |  |
| POST | `/api/finance/payroll-entry` | 274 | — |  |
| POST | `/api/finance/years/:id/close` | 275 | — |  |
| GET | `/api/finance/fees/overview` | 278 | — | finance.js |
| GET | `/api/finance/fee-structures` | 295 | — | finance.js |
| POST | `/api/finance/fee-structures` | 324 | — | finance.js |
| GET | `/api/finance/student-invoices` | 333 | — | finance.js |
| POST | `/api/finance/student-invoices` | 354 | — | finance.js |
| GET | `/api/finance/student-invoices/:id` | 366 | — | finance.js |
| POST | `/api/finance/student-invoices/:id/pay` | 381 | — | finance.js |
| GET | `/api/finance/discounts` | 393 | — | finance.js |
| POST | `/api/finance/discounts` | 394 | — | finance.js |
| GET | `/api/finance/fees/overdue` | 395 | — | finance.js |
| GET | `/api/payroll/runs` | 397 | — | finance.js |
| POST | `/api/finance/payroll/:id/post` | 411 | — | finance.js |
| GET | `/api/me/fees` | 420 | `finance:fees` |  |

### uni-erp/server/services/hr_integrated.js (14)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| GET | `/api/hr-pro/overview` | 790 | — | analytics_panel.js payroll.js |
| POST | `/api/hr-pro/employees` | 799 | `hr:manage` | payroll.js |
| PUT | `/api/hr-pro/employees/:id` | 887 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/attendance` | 928 | `hr:manage` `staffatt:manage` | payroll.js |
| POST | `/api/hr-pro/absences` | 965 | `hr:manage` | payroll.js |
| DELETE | `/api/hr-pro/absences/:id` | 990 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/leaves` | 997 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/advances` | 1031 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/advances/:id/pay` | 1052 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/contracts` | 1072 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/contracts/:id/renew` | 1096 | `hr:manage` | payroll.js |
| PUT | `/api/hr-pro/settings` | 1120 | `hr:manage` | payroll.js |
| POST | `/api/hr-pro/lookups` | 1133 | `hr:manage` | payroll.js |
| DELETE | `/api/hr-pro/lookups/:id` | 1146 | `hr:manage` | payroll.js |

### uni-erp/server/services/procurement/routes.js (41)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| GET | `/api/procurement/overview` | 8 | — | procurement.js |
| GET | `/api/procurement/warehouses` | 9 | — | procurement.js |
| POST | `/api/procurement/warehouses` | 10 | — | procurement.js |
| PUT | `/api/procurement/warehouses/:id` | 11 | — | procurement.js |
| POST | `/api/procurement/warehouses/:id/toggle` | 12 | — | procurement.js |
| DELETE | `/api/procurement/warehouses/:id` | 13 | — | procurement.js |
| GET | `/api/procurement/suppliers` | 14 | — | procurement.js |
| POST | `/api/procurement/suppliers` | 15 | — | procurement.js |
| PUT | `/api/procurement/suppliers/:id` | 16 | — | procurement.js |
| POST | `/api/procurement/suppliers/:id/toggle` | 17 | — | procurement.js |
| DELETE | `/api/procurement/suppliers/:id` | 18 | — | procurement.js |
| GET | `/api/procurement/categories` | 19 | — | procurement.js |
| GET | `/api/procurement/items` | 20 | — | procurement.js |
| POST | `/api/procurement/items` | 21 | — | procurement.js |
| PUT | `/api/procurement/items/:id` | 22 | — | procurement.js |
| POST | `/api/procurement/items/:id/adjust` | 23 | — | procurement.js |
| POST | `/api/procurement/items/:id/toggle` | 24 | — |  |
| DELETE | `/api/procurement/items/:id` | 25 | — | procurement.js |
| GET | `/api/procurement/requests` | 26 | — | procurement.js |
| GET | `/api/procurement/requests/:id` | 27 | — | procurement.js |
| POST | `/api/procurement/requests` | 28 | — | procurement.js |
| PUT | `/api/procurement/requests/:id` | 29 | — | procurement.js |
| POST | `/api/procurement/requests/:id/submit` | 30 | — | procurement.js |
| POST | `/api/procurement/requests/:id/approve` | 31 | — | procurement.js |
| POST | `/api/procurement/requests/:id/reject` | 32 | — | procurement.js |
| POST | `/api/procurement/requests/:id/cancel` | 33 | — |  |
| GET | `/api/procurement/orders` | 34 | — | procurement.js |
| GET | `/api/procurement/orders/:id` | 35 | — | procurement.js |
| POST | `/api/procurement/orders` | 36 | — | procurement.js |
| POST | `/api/procurement/orders/:id/order` | 37 | — | procurement.js |
| POST | `/api/procurement/orders/:id/cancel` | 38 | — | procurement.js |
| GET | `/api/procurement/receipts` | 39 | — | procurement.js |
| POST | `/api/procurement/receipts` | 40 | — | procurement.js |
| GET | `/api/procurement/issues` | 41 | — | procurement.js |
| POST | `/api/procurement/issues` | 42 | — | procurement.js |
| GET | `/api/procurement/assets` | 43 | — | procurement.js |
| POST | `/api/procurement/assets` | 44 | — | procurement.js |
| PUT | `/api/procurement/assets/:id` | 45 | — | procurement.js |
| POST | `/api/procurement/assets/:id/move` | 46 | — | procurement.js |
| DELETE | `/api/procurement/assets/:id` | 47 | — | procurement.js |
| GET | `/api/procurement/items.xlsx` | 49 | `procurement:read` | procurement.js |

### uni-erp/server/services/student_affairs_suite.js (12)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| GET | `/api/student-affairs-suite/overview` | 1168 | — |  |
| POST | `/api/student-affairs-suite/admissions/applicant` | 1174 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/admissions/run-sort` | 1178 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/admissions/enroll/:id` | 1182 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/equivalence` | 1186 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/advising` | 1190 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/advising/:id/resolve` | 1194 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/lifecycle` | 1198 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/disciplinary` | 1202 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/scholarships` | 1206 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/queue/book` | 1210 | — | student_affairs_suite.js |
| POST | `/api/student-affairs-suite/queue/:id/status` | 1214 | — | student_affairs_suite.js |

### uni-erp/server/services/v12_modules.js (38)

| الطريقة | المسار | السطر | الصلاحية | الواجهة |
|---|---|---|---|---|
| GET | `/api/lms/overview` | 209 | — | v12_views.js |
| POST | `/api/lms/lectures` | 240 | — | v12_views.js |
| DELETE | `/api/lms/lectures/:id` | 263 | — | v12_views.js |
| POST | `/api/lms/quizzes` | 270 | — | v12_views.js |
| POST | `/api/lms/books` | 294 | — | v12_views.js |
| POST | `/api/lms/loans` | 318 | — | v12_views.js |
| POST | `/api/lms/loans/:id/return` | 343 | — | v12_views.js |
| GET | `/api/research/overview` | 360 | — | v12_views.js |
| POST | `/api/research/projects` | 377 | — | v12_views.js |
| POST | `/api/research/theses` | 403 | — | v12_views.js |
| PUT | `/api/research/theses/:id/stage` | 427 | — |  |
| GET | `/api/alumni/overview` | 437 | — | v12_views.js |
| POST | `/api/alumni/records` | 459 | — | v12_views.js |
| POST | `/api/alumni/jobs` | 487 | — | v12_views.js |
| POST | `/api/alumni/applications` | 509 | — | v12_views.js |
| GET | `/api/qa/overview` | 530 | — | v12_views.js |
| POST | `/api/qa/kpis` | 551 | — | v12_views.js |
| POST | `/api/qa/surveys` | 567 | — | v12_views.js |
| GET | `/api/expansions/overview` | 595 | — | v12_views.js |
| POST | `/api/expansions/exams` | 628 | — | v12_views.js |
| POST | `/api/expansions/appeals` | 651 | — | v12_views.js |
| POST | `/api/expansions/appeals/:id/decide` | 669 | — | v12_views.js |
| POST | `/api/expansions/office-bookings` | 682 | — | v12_views.js |
| POST | `/api/expansions/dorm-allocations` | 699 | — | v12_views.js |
| POST | `/api/expansions/scholarships` | 720 | — | v12_views.js |
| POST | `/api/expansions/appraisals` | 738 | — | v12_views.js |
| POST | `/api/expansions/biometrics/sync` | 763 | — | v12_views.js |
| GET | `/api/devops/overview` | 770 | — | v12_views.js |
| GET | `/api/devops/incidents` | 822 | — | analytics_panel.js v12_views.js |
| POST | `/api/devops/incidents` | 827 | — | analytics_panel.js v12_views.js |
| POST | `/api/devops/incidents/:id/resolve` | 864 | — | v12_views.js |
| DELETE | `/api/devops/incidents/:id` | 881 | — | v12_views.js |
| PUT | `/api/devops/settings/:key` | 889 | — |  |
| GET | `/api/devops/postgres-ddl` | 898 | — | v12_views.js |
| GET | `/api/ai/overview` | 920 | — | v12_views.js |
| POST | `/api/ai/early-warning/analyze` | 939 | — | v12_views.js |
| POST | `/api/ai/advisor/ask` | 973 | — | v12_views.js |
| POST | `/api/ai/triage/analyze` | 1007 | — | v12_views.js |

## 3) الجداول ← الترحيل ← الكود

| الجدول | الترحيل | يُستخدم في |
|---|---|---|
| `org_units` | 001_init.sql | app.js cache.js routes.js services/access.js services/analytics.js services/catalog.js services/correspondence.js services/dataexport.js services/faculty.js services/finance/fees.js services/finance/routes.js services/hr.js services/hr_integrated.js services/requests.js services/requestsxl.js services/staffatt.js services/structure.js |
| `users` | 001_init.sql | app.js cache.js routes.js services/academics.js services/access.js services/admindata.js services/analytics.js services/attendance.js services/auth.js services/bootstrap.js services/correspondence.js services/dataexport.js services/documents.js services/enrollcert.js services/enterprise_suite.js services/finance/core.js services/finance/fees.js services/hr.js services/importer.js services/procurement/core.js services/procurement_fin_seed.js services/push.js services/requests.js services/requestsxl.js services/staffatt.js services/structure.js services/studentfiles.js services/students.js services/student_affairs_suite.js services/useradmin.js services/workflow.js |
| `sessions` | 001_init.sql | app.js services/auth.js services/bootstrap.js services/students.js services/useradmin.js services/v12_modules.js |
| `student_holds` | 001_init.sql | routes.js services/admindata.js services/attendance.js services/dataexport.js services/enrollcert.js services/enterprise_suite.js services/record360.js services/requests.js services/rules.js services/students.js services/student_affairs_suite.js |
| `grades` | 001_init.sql | services/academics.js services/analytics.js services/dataexport.js services/documents.js services/enterprise_suite.js services/importer.js services/requests.js services/schedule.js services/student_affairs_suite.js services/workflow.js |
| `service_types` | 001_init.sql | cache.js services/analytics.js services/catalog.js services/dataexport.js services/documents.js services/forms/index.js services/procurement_fin_seed.js services/push.js services/record360.js services/requests.js services/requestsxl.js services/student_affairs_suite.js |
| `rules` | 001_init.sql | routes.js services/admindata.js services/rules.js |
| `requests` | 001_init.sql | services/access.js services/analytics.js services/catalog.js services/dataexport.js services/desk.js services/documents.js services/hr_integrated.js services/procurement_fin_seed.js services/push.js services/record360.js services/requests.js services/rules.js services/students.js services/student_affairs_suite.js |
| `request_events` | 001_init.sql | services/requests.js services/student_affairs_suite.js |
| `attachments` | 001_init.sql | services/requests.js |
| `documents` | 001_init.sql | services/analytics.js services/documents.js services/hr_integrated.js services/requests.js |
| `audit_log` | 001_init.sql | audit.js routes.js services/hr_integrated.js services/v12_modules.js |
| `programs` | 002_student_registration.sql | app.js services/academics.js services/analytics.js services/attendance.js services/dataexport.js services/documents.js services/enrollcert.js services/finance/routes.js services/hr_integrated.js services/importer.js services/procurement_fin_seed.js services/requests.js services/students.js services/student_affairs_suite.js services/v12_modules.js |
| `student_profiles` | 002_student_registration.sql | app.js routes.js services/academics.js services/analytics.js services/attendance.js services/dataexport.js services/documents.js services/enrollcert.js services/enterprise_suite.js services/hr_integrated.js services/importer.js services/procurement_fin_seed.js services/push.js services/record360.js services/requests.js services/rules.js services/schedule.js services/students.js services/student_affairs_suite.js |
| `rules_new` | 002_student_registration.sql | — |
| `courses` | 003_student_app.sql | routes.js services/academics.js services/analytics.js services/attendance.js services/dataexport.js services/documents.js services/enterprise_suite.js services/faculty.js services/hr_integrated.js services/importer.js services/record360.js services/requests.js services/schedule.js services/students.js services/student_affairs_suite.js services/v12_modules.js |
| `news` | 003_student_app.sql | services/academics.js services/analytics.js services/hr_integrated.js services/media.js |
| `complaints` | 003_student_app.sql | services/academics.js services/analytics.js services/dataexport.js services/push.js |
| `site_settings` | 004_site_settings.sql | cache.js services/backup.js services/forms/index.js services/push.js services/settings.js services/site.js services/staffatt.js services/workflow.js |
| `faculties` | 005_org_access.sql | services/academics.js services/analytics.js services/attendance.js services/dataexport.js services/documents.js services/enrollcert.js services/hr_integrated.js services/importer.js services/students.js |
| `roles` | 005_org_access.sql | app.js cache.js services/access.js services/forms/index.js services/structure.js |
| `unit_links` | 005_org_access.sql | cache.js services/access.js services/structure.js |
| `news_media` | 006_services_media.sql | services/media.js |
| `student_certs` | 007_student_certs.sql | services/enrollcert.js services/students.js |
| `document_pdfs` | 009_document_pdfs.sql | routes.js services/docpdf.js |
| `student_files` | 010_attachments_attendance_push.sql | services/attendance.js services/studentfiles.js services/students.js |
| `hall_logs` | 010_attachments_attendance_push.sql | services/attendance.js services/dataexport.js services/record360.js |
| `push_subscriptions` | 010_attachments_attendance_push.sql | services/push.js |
| `grade_changes` | 011_workflow_schedule_requests.sql | services/workflow.js |
| `course_schedules` | 011_workflow_schedule_requests.sql | services/schedule.js |
| `academic_request_details` | 011_workflow_schedule_requests.sql | services/requests.js |
| `corr_docs` | 015_correspondence.sql | routes.js services/correspondence.js services/corrpdf.js services/desk.js |
| `corr_approvers` | 015_correspondence.sql | services/correspondence.js services/desk.js |
| `corr_events` | 015_correspondence.sql | services/correspondence.js |
| `corr_files` | 015_correspondence.sql | services/correspondence.js |
| `corr_notifs` | 015_correspondence.sql | services/correspondence.js services/desk.js |
| `staff_attendance` | 016_staff_attendance.sql | services/staffatt.js |
| `leave_entitlements` | 016_staff_attendance.sql | services/staffatt.js |
| `leave_records` | 016_staff_attendance.sql | services/hr.js services/staffatt.js |
| `corr_templates` | 017_corr_templates.sql | services/corrTemplates.js |
| `corr_cc` | 018_corr_cc.sql | services/correspondence.js services/desk.js |
| `faculty_members` | 020_faculty.sql | services/academics.js services/faculty.js |
| `hr_employees` | 021_hr_tables.sql | app.js services/enterprise_suite.js services/finance/fees.js services/hr.js services/hr_integrated.js services/staffatt.js |
| `hr_salaries` | 021_hr_tables.sql | services/finance/fees.js services/hr.js services/hr_integrated.js |
| `hr_leaves` | 021_hr_tables.sql | services/hr.js services/hr_integrated.js services/staffatt.js |
| `hr_contracts` | 021_hr_tables.sql | services/hr.js services/hr_integrated.js |
| `fin_years` | 022_finance.sql | routes.js services/finance/core.js services/finance/fees.js services/finance/reports.js services/procurement/core.js |
| `fin_currencies` | 022_finance.sql | services/finance/core.js services/finance/routes.js |
| `fin_accounts` | 022_finance.sql | services/finance/core.js services/finance/fees.js services/finance/reports.js services/finance/routes.js services/hr_integrated.js services/procurement/core.js services/procurement_fin_seed.js services/student_affairs_suite.js |
| `fin_cost_centers` | 022_finance.sql | services/finance/core.js services/finance/reports.js services/finance/routes.js |
| `fin_parties` | 022_finance.sql | services/finance/core.js services/finance/reports.js services/finance/routes.js services/procurement_fin_seed.js |
| `fin_entries` | 022_finance.sql | routes.js services/finance/core.js services/finance/fees.js services/finance/reports.js services/finance/routes.js services/procurement/core.js services/procurement_fin_seed.js |
| `fin_lines` | 022_finance.sql | services/finance/core.js services/finance/fees.js services/finance/reports.js services/finance/routes.js services/procurement/core.js |
| `fin_fee_types` | 022_finance.sql | services/finance/core.js services/finance/fees.js services/student_affairs_suite.js |
| `fin_charges` | 022_finance.sql | services/finance/fees.js services/finance/routes.js services/student_affairs_suite.js |
| `fin_payments` | 022_finance.sql | services/finance/fees.js |
| `proc_warehouses` | 023_procurement.sql | services/hr_integrated.js services/procurement/core.js services/procurement_fin_seed.js |
| `proc_suppliers` | 023_procurement.sql | services/procurement/core.js services/procurement_fin_seed.js |
| `proc_categories` | 023_procurement.sql | services/procurement/core.js services/procurement_fin_seed.js |
| `proc_items` | 023_procurement.sql | services/hr_integrated.js services/procurement/core.js services/procurement_fin_seed.js |
| `proc_requests` | 023_procurement.sql | services/procurement/core.js services/procurement_fin_seed.js |
| `proc_request_lines` | 023_procurement.sql | services/procurement/core.js services/procurement_fin_seed.js |
| `proc_orders` | 023_procurement.sql | services/procurement/core.js services/procurement_fin_seed.js |
| `proc_order_lines` | 023_procurement.sql | services/procurement/core.js services/procurement_fin_seed.js |
| `proc_receipts` | 023_procurement.sql | services/procurement/core.js |
| `proc_receipt_lines` | 023_procurement.sql | services/procurement/core.js |
| `proc_issues` | 023_procurement.sql | services/procurement/core.js |
| `proc_issue_lines` | 023_procurement.sql | services/procurement/core.js |
| `proc_assets` | 023_procurement.sql | services/hr_integrated.js services/procurement/core.js services/procurement_fin_seed.js |
| `proc_asset_moves` | 023_procurement.sql | services/procurement/core.js |
| `lms_lectures` | 025_v12_complete.sql | services/v12_modules.js |
| `lms_quizzes` | 025_v12_complete.sql | services/v12_modules.js |
| `library_books` | 025_v12_complete.sql | services/v12_modules.js |
| `library_loans` | 025_v12_complete.sql | services/v12_modules.js |
| `research_projects` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `postgrad_theses` | 025_v12_complete.sql | services/v12_modules.js |
| `alumni_records` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `career_jobs` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `career_applications` | 025_v12_complete.sql | services/v12_modules.js |
| `qa_kpis` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `qa_surveys` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `qa_accreditations` | 025_v12_complete.sql | services/v12_modules.js |
| `exam_schedules` | 025_v12_complete.sql | services/v12_modules.js |
| `grade_appeals` | 025_v12_complete.sql | services/v12_modules.js |
| `office_hour_bookings` | 025_v12_complete.sql | services/v12_modules.js |
| `faculty_promotions` | 025_v12_complete.sql | services/v12_modules.js |
| `dorm_rooms` | 025_v12_complete.sql | services/v12_modules.js |
| `dorm_allocations` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `scholarships` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `student_activities` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `hr_appraisals` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `hr_trainings` | 025_v12_complete.sql | services/v12_modules.js |
| `hr_biometric_devices` | 025_v12_complete.sql | services/hr_integrated.js services/v12_modules.js |
| `infra_settings` | 025_v12_complete.sql | services/v12_modules.js |
| `ai_early_warnings` | 025_v12_complete.sql | services/v12_modules.js |
| `ai_triage_logs` | 025_v12_complete.sql | services/v12_modules.js |
| `ai_advisor_chats` | 025_v12_complete.sql | services/v12_modules.js |
| `hr_monthly_attendance` | 026_hr_integrated_system.sql | services/hr_integrated.js |
| `hr_absences` | 026_hr_integrated_system.sql | services/hr_integrated.js |
| `hr_advances` | 026_hr_integrated_system.sql | services/hr_integrated.js |
| `hr_system_lookups` | 026_hr_integrated_system.sql | services/analytics.js services/hr_integrated.js |
| `hr_alert_settings` | 026_hr_integrated_system.sql | services/hr_integrated.js |
| `devops_incident_reports` | 027_devops_incidents.sql | services/hr_integrated.js services/v12_modules.js |
| `smart_schedule_slots` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `online_quizzes` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `online_quiz_submissions` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `student_self_enrollments` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `hr_signed_payslips` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `faculty_overload_records` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `student_fee_installments` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `multi_channel_notifications` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `encrypted_snapshots` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `offline_sync_batches` | 028_enterprise_suite.sql | services/enterprise_suite.js |
| `sa_applicants` | 029_student_affairs_suite.sql | services/student_affairs_suite.js |
| `sa_credit_equivalences` | 029_student_affairs_suite.sql | services/record360.js services/student_affairs_suite.js |
| `sa_course_prerequisites` | 029_student_affairs_suite.sql | services/student_affairs_suite.js |
| `sa_advising_warnings` | 029_student_affairs_suite.sql | services/student_affairs_suite.js |
| `sa_lifecycle_movements` | 029_student_affairs_suite.sql | services/record360.js services/student_affairs_suite.js |
| `sa_disciplinary_details` | 029_student_affairs_suite.sql | services/student_affairs_suite.js |
| `sa_scholarships` | 029_student_affairs_suite.sql | services/record360.js services/student_affairs_suite.js |
| `sa_desk_appointments` | 029_student_affairs_suite.sql | services/student_affairs_suite.js |
| `idempotency_keys` | 033_security_hardening.sql | — |
| `sa_card_activity_logs` | 035_card_activity_logs.sql | routes.js |

## 4) الاختبارات ← مقاطع API التي تلمسها

| الاختبار | المقاطع |
|---|---|
| academics.test.js | auth students courses me requests news complaints services |
| access.test.js | auth me admin students audit stats requests units |
| adminconfig.test.js | auth admin services audit me students |
| analytics.test.js | auth import students requests analytics |
| api.test.js | auth me requests documents transcript-template verify admin stats audit attachments health news |
| audit_scenarios.test.js | auth students courses requests grades me admin attendance import procurement |
| backup_pg.test.js | — |
| cert.test.js | auth import students me verify verify-hash |
| corr.test.js | auth corr |
| desk.test.js | auth me admin |
| devops_analytics_dept.test.js | — |
| devops_logging.test.js | — |
| docpdf.test.js | auth requests documents verify-hash |
| enterprise_suite.test.js | — |
| export.test.js | auth students courses export |
| extra360.test.js | auth students courses |
| faculty.test.js | auth admin me faculty courses |
| finance.test.js | auth finance me |
| forms.test.js | auth admin services requests attachments |
| granular_rbac.test.js | auth admin |
| hr.test.js | auth admin |
| hr_integrated.test.js | hr-pro admin auth |
| import.test.js | auth import |
| logging.test.js | admin auth students attendance |
| manage.test.js | auth students courses news complaints admin faculties programs analytics |
| media.test.js | auth news media |
| payroll_entry.test.js | auth admin finance |
| permpage.test.js | auth admin |
| phase9.test.js | auth students student-files students-table attendance export push admin |
| portal_views.test.js | auth me admin |
| readiness.test.js | — |
| report_v12_9_fixes.test.js | — |
| requestsxl.test.js | auth admin services requests |
| settings.test.js | auth students admin courses me registration faculty hr |
| staffatt.test.js | auth services requests hr |
| structure.test.js | auth admin me |
| students.test.js | auth students services me registration requests admin faculties programs |
| student_affairs_suite.test.js | — |
| tables.test.js | auth grades import students courses |
| ui.test.js | auth courses students admin |
| ui_ux_pillars.test.js | — |
| v12.test.js | auth lms research alumni qa expansions devops ai |
| workflow.test.js | auth students courses grades me requests services |
