# GRAPHIFY_WORKFLOW — دليل العمل على المنصة (SUSS / uni-erp)

الرسم البياني للمشروع موجود في `graphify-out/` (2662 عقدة، 6956 ارتباطًا، 138 مجتمعًا).

## قبل أي تعديل (بهذا الترتيب)
1. `graphify explain "<الدالة أو الملف>"`  — ما هو هذا العنصر ومن يستدعيه وماذا يستدعي.
2. `graphify affected "<العنصر>" --depth 2` — ما الذي سيتأثر إن عدّلته.
3. `graphify path "A" "B"` — كيف يرتبط مكوّنان (مثلاً مسار → خدمة → جدول).
4. `graphify query "<سؤال>" --budget 2000` — بحث عام في البنية.

## بعد كل تعديل
- `graphify update .`  (لا يحتاج LLM) لتحديث الرسم، ثم راجع `GRAPH_REPORT.md`.
- بعد حذف كود كثير: `graphify update . --force`.

## نقاط حساسة (عقد مركزية، تعديلها يؤثر في كل شيء)
`buildRouter()` (server/routes.js) · `HttpError` · `audit()` · `tx()` ·
`createApp()` · `getSetting()` · `hashPassword()` · جدول `users`
→ لا تغيّر توقيعها قبل تشغيل `affected` عليها.

## مواضع العمل الشائعة
- المسارات (API): `uni-erp/server/routes.js`
- المالية: `finance/core.js` · المشتريات: `procurement/core.js` · الاستيراد: `importer.js`
- قاعدة البيانات وتحويل SQL→PostgreSQL: `db.js` + ملفات `*.sql` (migrations 001…035)
- الواجهة: `App.tsx` و`uni-erp/public/*.js`
- النشر: `Dockerfile.railway` · `docker-entrypoint.sh` · `docs/DEPLOY-RAILWAY.md`

## ملاحظة
ملفات الخطوط والإعدادات (`.ttf`, `.woff2`, `Dockerfile`, `.env.example`) غير ممثّلة في الرسم؛ افحصها يدويًا.
