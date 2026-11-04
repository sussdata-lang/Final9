// تبديل الحساب للتجربة المحلية فقط. لا يُسجَّل مساره إلا إذا اجتمع وضع العرض مع ربط الخادم بعنوان محلي، فلا وجود له في أي نشر.
import { HttpError } from '../http.js';
import { hashPassword } from '../security.js';
import { seedPassword } from './bootstrap.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const devSwitchEnabled = (host, env = process.env) => env.DEMO_MODE === '1' && LOOPBACK_HOSTS.has(String(host));
export const isLocalRequest = (ip, hostHeader) => LOOPBACK_IPS.has(String(ip)) && LOOPBACK_HOSTS.has(String(hostHeader ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));

const FACULTY_PERMS = ['academic:read', 'grade:manage', 'attendance:manage', 'student:read', 'lms_lib:view', 'lms_lib:write', 'research_grad:view', 'sa_advising:view', 'corr:use', 'staffatt:self', 'request:create_internal', 'procurement:request'];
const TYPES = [
  { key: 'admin', label: 'مدير النظام', username: 'admin' },
  { key: 'auditor', label: 'مدقق', username: 'auditor1' },
  { key: 'faculty', label: 'الهيئة التدريسية', username: 'faculty_demo', create: { name: 'عضو هيئة تدريسية (تجريبي)', roleKey: 'dev_faculty', kind: 'faculty', job: 'أستاذ مساعد' } },
  { key: 'student', label: 'طالب', student: true },
  { key: 'logistics', label: 'لوجستي', username: 'procure' },
  { key: 'affairs', label: 'شؤون الطلاب', username: 'affairs' },
  { key: 'exams', label: 'الامتحانات', username: 'exams' },
  { key: 'finance', label: 'المالية', username: 'finance' },
  { key: 'hr', label: 'الموارد البشرية', username: 'hr' },
  { key: 'library', label: 'المكتبة', username: 'library' },
];

const firstStudent = (db) => db.prepare("SELECT username FROM users WHERE role = 'student' AND active = 1 ORDER BY id LIMIT 1").get()?.username ?? null;
const usernameOf = (db, t) => (t.student ? firstStudent(db) : t.username);
function available(db, t) {
  const u = usernameOf(db, t);
  if (!u) return null;
  return t.create || db.prepare('SELECT 1 AS x FROM users WHERE username = ? AND active = 1').get(u) ? u : null;
}
export function devAccounts({ db }) {
  return TYPES.flatMap((t) => { const username = available(db, t); return username ? [{ key: t.key, label: t.label, username }] : []; });
}
// يهيئ الحساب ويعيد اسم المستخدم وكلمة مرور العرض للدخول بمسار الدخول المعتاد
export async function prepareDevAccount({ db, cfg }, key) {
  const t = TYPES.find((x) => x.key === key), username = t && available(db, t);
  if (!username) throw new HttpError(404, 'هذا الحساب غير متاح في قاعدة التطوير.', 'not_found');
  const password = seedPassword();
  const hash = await hashPassword(password, cfg.scryptN);
  if (t.create) {
    db.prepare("INSERT INTO roles (key, label, description, permissions_json, created_at) VALUES (?, 'عضو هيئة تدريسية', 'حساب التجربة المحلية', ?, ?) ON CONFLICT (key) DO UPDATE SET permissions_json = excluded.permissions_json").run(t.create.roleKey, JSON.stringify(FACULTY_PERMS), Date.now());
    db.prepare('UPDATE users SET role_key = ? WHERE username = ?').run(t.create.roleKey, username);
  }
  if (t.create && !db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(username)) {
    db.prepare("INSERT INTO users (username, display_name, password_hash, role, role_key, staff_kind, job_title, created_at) VALUES (?, ?, ?, 'staff', ?, ?, ?, ?)").run(username, t.create.name, hash, t.create.roleKey, t.create.kind, t.create.job, Date.now());
  } else {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = 0 WHERE username = ?').run(hash, username);
  }
  return { username, password };
}
