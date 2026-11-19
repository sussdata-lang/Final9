# 03. بنية المشروع

إجمالي الملفات دون `node_modules` و`.git` و`graphify-out`: 597 ملفًا.

## الجذر

| المسار | الغرض | ملاحظة |
|---|---|---|
| `uni-erp/` | التطبيق الفعلي | كل ما يعمل في الإنتاج |
| `import-samples/` | 74 نوعًا من عينات الاستيراد، ومولّدها | أدوات، ولا يُنشر مع الصورة |
| `prototype/` | نموذج واجهة قديم، نحو 141 كيلوبايت | غير مرتبط بالتشغيل |
| `scripts/start-cloud.js` | نسخة تشغيل مخصصة لبناء الجذر | تكرار لنسخة `uni-erp/scripts` |
| `Dockerfile.railway`، `railway.json`، `docker-entrypoint.sh` | بناء من جذر المستودع | تكرار قد يربك: الإعداد الحالي يستخدم نسخة `uni-erp/` |
| `CODEMAP.md`، `CODEMAP.index.md` | خريطة كود | مفيدة، وتُحدَّث يدويًا |
| `graphify-out/` | ناتج أداة تحليل | مستبعد من git |

## `uni-erp/`

| المسار | الغرض | الحجم |
|---|---|---|
| `server/` | الخادم | 15 ملفًا جذريًا، نحو 4,380 سطرًا |
| `server/services/` | منطق الأعمال | 67 ملفًا، نحو 14,440 سطرًا |
| `server/lib/` | PDF وXLSX وZIP وDER وPPTX وSQL parser وسجل | 9 ملفات |
| `server/migrations/` | ترحيلات SQL | 52 ملفًا |
| `server/assets/` | خطوط وصور للوثائق الموقعة | 691 كيلوبايت |
| `public/` | الواجهة وتخدم مباشرة **دون تسجيل دخول** | 69 ملفًا في المستوى الأول |
| `public/archify/` | خرائط معمارية HTML وJSON | 3.4 ميغابايت، **عامة** |
| `public/fonts/`، `icons/`، `brand/`، `templates/` | أصول ثابتة وقوالب Excel | |
| `test/` | 59 ملف اختبار | نحو 8,450 سطرًا |
| `scripts/` | seed وstructure وaccounts وrestore وprecompress وغيرها | 15 ملفًا |
| `tools/` | توليد قوالب | ملفان |
| `docs/` | توثيق | 8 ملفات. بعضها قديم، انظر أدناه |
| `node_modules/` | `pg` واعتمادياته فقط | 14 حزمة |

البيانات وقت التشغيل في `data/` المركّب كقرص: `uploads` و`logs` و`backups` و`pki`. وهي مستبعدة من git.

## أكبر ملفات الكود

| الملف | الأسطر | الملف | الأسطر |
|---|---|---|---|
| `public/v12_views.js` | 1,846 | `server/permissions.js` | 1,073 |
| `public/ux_restructure.js` | 1,771 | `public/procurement.js` | 1,040 |
| `public/payroll.js` | 1,532 | `server/services/hr_integrated.js` | 1,010 |
| `public/access.js` | 1,332 | `public/student_affairs_suite.js` | 998 |
| `server/services/v12_modules.js` | 1,137 | `public/enterprise_suite.js` | 915 |
| `server/services/student_affairs_suite.js` | 1,110 | `server/db.js` | 800 |
| `public/finance.js` | 1,107 | `server/routes.js` | 607 |

ملاحظة: `routes.js` قصير بعدد الأسطر، لكنه 58 كيلوبايت لأن كثيرًا من معالجاته في سطر واحد طويل.

## ملفات الإعداد المكتشفة

| النوع | الموجود |
|---|---|
| حزم | `uni-erp/package.json`، `uni-erp/package-lock.json` |
| Docker | `uni-erp/Dockerfile`، `uni-erp/Dockerfile.railway`، `Dockerfile.railway` |
| البيئة | `uni-erp/.env.example` فقط، ولا ملف `.env` في المستودع |
| النشر | `railway.json` في موقعين |
| ترحيلات | `uni-erp/server/migrations/*.sql` |
| غير موجود | `requirements.txt`، `pyproject.toml`، `composer.json`، `Cargo.toml`، `go.mod`، `docker-compose`، `tsconfig`، إعدادات CI، إعدادات ORM، `pnpm-lock`، `yarn.lock` |

## توثيق قديم يخالف الكود

| الملف | الادعاء | الواقع |
|---|---|---|
| `uni-erp/README.md:5-6,30` | SQLite و«بلا اعتماديات» و«لا npm install» | PostgreSQL حصرًا، ويعتمد على `pg` |
| `uni-erp/docs/ARCHITECTURE.md:10` | SQLite | PostgreSQL |
| `uni-erp/docs/ROADMAP.md:28` | `node:sqlite` | غير مستخدم |
| `uni-erp/.env.example:12` | `DB_PATH` | يُستخدم في الاختبارات لاشتقاق قاعدة مستقلة، لا للإنتاج |

## قائمة ما تمت مراجعته

### قراءة يدوية مباشرة

`server/http.js`، `security.js`، `app.js`، `heavy.js`، `db_worker.js`، `waf.js`، `audit.js`، وأجزاء من `db.js`، و`routes.js` بأجزائه الحساسة، و`services/auth.js`، وأجزاء من `permissions.js`، `workflow.js`، `requests.js`، `documents.js`، `enrollcert.js`، `studentfiles.js`، `media.js`، `backup.js`، `student_affairs_suite.js`، `enterprise_suite.js`، `v12_modules.js`، `schedule.js`، `Dockerfile*`، `docker-entrypoint.sh`، `.env.example`.

### استخراج آلي وفحص بالأنماط، دون قراءة كل سطر

كل مسارات `server/` البالغة 431 مسارًا، وبقية `server/services/` ومنها `hr_integrated.js` و`hr.js` و`finance/*` و`procurement/*` و`import_engine.js` و`correspondence.js`، وكل `public/*.js` عدا `i18n_en.js`.

### لم يُفحص

- الإنتاج: قاعدته وسجلاته وحجم بياناته وموارده وإعدادات الشبكة.
- قواعد الأعمال المالية والرواتب حسابيًا، فهذا يحتاج مراجعًا ماليًا.
- كل مواضع `innerHTML` البالغة 119 موضعًا لم تُتتبع سطرًا سطرًا لاكتشاف XSS.
- `public/archify/*.html`: فُحص وصولها فقط، ومحتواها بالبحث عن كلمات محددة.
- `i18n_en.js` و`prototype/` و`graphify-out/`.
