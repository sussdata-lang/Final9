// يولّد بيانات بحجم الجامعة لاختبار الضغط. يرفض العمل إلا على قاعدة اسمها suss_load، ولا يعمل في الإنتاج.
//   LOAD_URL=postgres://postgres@127.0.0.1:55440/suss_load node scripts/loadtest/seed.mjs
// كل كلمات المرور هنا قيمة عشوائية لا تُستعمل: الاختبار يدخل بجلسات يولّدها هذا السكربت (load-<id>).
import crypto from 'node:crypto';
import pg from 'pg';

const url = process.env.LOAD_URL;
if (!url || new URL(url).pathname !== '/suss_load') { console.error('LOAD_URL يجب أن يشير إلى قاعدة suss_load.'); process.exit(1); }
if (process.env.NODE_ENV === 'production') { console.error('لا يعمل في الإنتاج.'); process.exit(1); }

const STUDENTS = Number(process.env.LOAD_STUDENTS ?? 10000), STAFF = Number(process.env.LOAD_STAFF ?? 300), COURSES = 400;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args) => c.query(sql, args);
const now = Date.now(), hash = 'scrypt$1024$8$1$' + crypto.randomBytes(16).toString('base64') + '$' + crypto.randomBytes(32).toString('base64');
const step = async (label, sql, args) => { const t = Date.now(); const r = await q(sql, args); console.log(`${label}: ${r.rowCount ?? 0} صف، ${Date.now() - t} ms`); };

await q('ALTER TABLE audit_log DISABLE TRIGGER USER');
const programs = (await q('SELECT id FROM programs WHERE active = 1 ORDER BY id')).rows.map((r) => Number(r.id));
if (!programs.length) { console.error('شغّل الخادم مرة أولاً لتطبيق الترحيلات.'); process.exit(1); }
const prog = `(ARRAY[${programs.join(',')}])[1 + (g % ${programs.length})]`;
const service = (await q('SELECT code FROM service_types LIMIT 1')).rows[0]?.code ?? 'general';

await step('الطلاب', `INSERT INTO users (username, display_name, password_hash, role, student_no, active, must_change_password, created_at)
  SELECT 'LT-' || g, 'طالب اختبار ' || g, $1, 'student', 'LT-' || g, 1, 0, $2 FROM generate_series(1, $3::int) g`, [hash, now, STUDENTS]);
await step('ملفات الطلاب', `INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
  SELECT u.id, 'اسم' || g, 'أب', 'كنية', 'أم', 'LT' || lpad(g::text, 9, '0'), 'ذكر', '2005-01-01', 'دمشق', 'سورية', '09' || lpad(g::text, 8, '0'), 'دمشق', 'م', 'ع', 'علمي', 2025, 2000, ${prog}, 'عام', 2026, 'الفصل الأول', 1 + (g % 4), 'active', 'أب', 'أب', '0944000000', $1, $1
  FROM (SELECT id, row_number() OVER (ORDER BY id) g FROM users WHERE username COLLATE "C" LIKE 'LT-%') u`, [now]);
await step('الموظفون', `INSERT INTO users (username, display_name, password_hash, role, access_mode, custom_permissions_json, data_scope, active, must_change_password, created_at)
  SELECT 'LS-' || g, 'موظف اختبار ' || g, $1, 'staff', 'custom', $2, 'all', 1, 0, $3 FROM generate_series(1, $4::int) g`, [hash, JSON.stringify(['student:read', 'request:read_all', 'grade:manage', 'course:manage', 'academic:read', 'finance:read', 'stats:read', 'audit:read']), now, STAFF]);
await step('الجلسات', `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
  SELECT encode(sha256(('load-' || id)::bytea), 'hex'), id, $1, $2 FROM users WHERE username COLLATE "C" LIKE 'LT-%' OR username COLLATE "C" LIKE 'LS-%'`, [now, now + 30 * 86400_000]);
await step('المقررات', `INSERT INTO courses (program_id, level, semester, name, code, hours, instructor, active)
  SELECT ${prog}, 1 + (g % 4), 1 + (g % 2), 'مقرر اختبار ' || g, 'LC-' || g, 3, 'مدرّس ' || (g % 80), 1 FROM generate_series(1, ${COURSES}) g`);
await step('الجدول', `INSERT INTO course_schedules (course_id, day, start_min, end_min, hall) SELECT id, id % 6, 480 + (id % 6) * 90, 570 + (id % 6) * 90, 'H-' || id FROM courses WHERE code LIKE 'LC-%'`);
await step('العلامات', `INSERT INTO grades (student_id, term, course, hours, mark, course_id, workflow_status)
  SELECT u.id, '2025/2026', c.name, 3, 50 + (u.id + c.id) % 50, c.id, 'approved'
  FROM (SELECT id FROM users WHERE username COLLATE "C" LIKE 'LT-%') u CROSS JOIN LATERAL (SELECT id, name FROM courses WHERE code LIKE 'LC-%' AND id % 50 = u.id % 50 LIMIT 8) c`);
await step('الطلبات', `INSERT INTO requests (no, student_id, service_code, details_json, status, created_at)
  SELECT 'LR-' || g, u.id, $1, '{}', 'review', $2::bigint - g * 60000 FROM (SELECT id, row_number() OVER (ORDER BY id) r FROM users WHERE username COLLATE "C" LIKE 'LT-%') u CROSS JOIN generate_series(1, 3) s CROSS JOIN LATERAL (SELECT u.r * 10 + s AS g) x`, [service, now]);
await step('أحداث الطلبات', `INSERT INTO request_events (request_id, at, actor_label, text) SELECT id, created_at, 'النظام', 'قُدّم الطلب' FROM requests WHERE no LIKE 'LR-%'`);
await step('سجل القاعات', `INSERT INTO hall_logs (student_id, kind, subject, hall, entered_at)
  SELECT id, 'course', 'مقرر', 'H-1', $1::bigint - s * 3600000 FROM (SELECT id FROM users WHERE username COLLATE "C" LIKE 'LT-%') u CROSS JOIN generate_series(1, 10) s`, [now]);
await step('الأخبار', `INSERT INTO news (title, body, published_at) SELECT 'خبر ' || g, 'نص الخبر', $1::bigint - g * 3600000 FROM generate_series(1, 200) g`, [now]);
await step('الامتحانات', `INSERT INTO exam_schedules (course_code, course_name, program_name, exam_type, exam_date, start_time, end_time, hall_name, capacity, enrolled_count, proctor_name, status, created_at)
  SELECT code, name, '', 'نهائي', '2027-01-15', '09:00', '11:00', 'H-' || id, 60, 40, 'لجنة', 'مجدول', $1 FROM courses WHERE code LIKE 'LC-%'`, [now]);
await step('المحاضرات', `INSERT INTO lms_lectures (course_code, course_name, title, instructor_name, created_at) SELECT code, name, 'محاضرة ' || s, instructor, $1 FROM courses CROSS JOIN generate_series(1, 5) s WHERE code LIKE 'LC-%'`, [now]);
await step('الكتب', `INSERT INTO library_books (isbn, title, author, category, created_at) SELECT 'LB-' || g, 'كتاب ' || g, 'مؤلف', 'عام', $1 FROM generate_series(1, 3000) g`, [now]);
const fee = (await q("SELECT id FROM fin_fee_types WHERE kind = 'fee' ORDER BY id LIMIT 1")).rows[0]?.id, acc = (await q("SELECT id FROM fin_accounts WHERE postable = 1 ORDER BY id LIMIT 1")).rows[0]?.id;
if (fee && acc) {
  await step('المستحقات', `INSERT INTO fin_charges (student_id, fee_type_id, amount, due_day, created_at) SELECT id, $1, 100000000, '2026-10-01', $2 FROM users u CROSS JOIN generate_series(1, 2) s WHERE u.username COLLATE "C" LIKE 'LT-%'`, [fee, now]);
  await step('الدفعات', `INSERT INTO fin_payments (receipt_no, student_id, amount, method, account_id, paid_day, created_at) SELECT 'LP-' || id, id, 50000000, 'cash', $1, '2026-10-02', $2 FROM users WHERE username COLLATE "C" LIKE 'LT-%'`, [acc, now]);
} else console.log('تخطي المالية: لا نوع رسم أو حساب بعد.');
await step('سجل التدقيق', `INSERT INTO audit_log (at, actor_label, role, action, ref, prev_hash, hash) SELECT $1::bigint - g * 1000, 'اختبار', 'staff', 'عملية', 'x', 'x', 'x' FROM generate_series(1, 300000) g`, [now]);
await q('ALTER TABLE audit_log ENABLE TRIGGER USER');
await q('ANALYZE');
console.log('الحجم:', (await q('SELECT pg_size_pretty(pg_database_size(current_database())) s')).rows[0].s);
await c.end();
