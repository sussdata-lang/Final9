// حساب الموظف في المنظومة: يُنشأ عند التعيين بصلاحيات دنيا، ويُغلق عند انتهاء الخدمة.
// الدور الفعلي يمنحه مدير الحسابات؛ فالدور الافتراضي للموظفين أوسع من أن يُمنح تلقائياً.
import { hashPassword, tempPassword } from '../security.js';
import { audit } from '../audit.js';
import { invalidateSessionCache } from './auth.js';

const MINIMAL = ['staffatt:self', 'request:create_internal', 'corr:use'];
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9._-]{2,39}$/;
const notifyUnits = (db, codes, kind, ref, text) => {
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING"), now = Date.now();
  const ids = db.prepare(`SELECT u.id FROM users u JOIN org_units o ON o.id = u.unit_id WHERE u.active = 1 AND o.code IN (${codes.map(() => '?').join(',')})`).all(...codes);
  for (const u of ids) ins.run(u.id, kind, ref, text, now);
};

export async function createEmployeeAccount({ db, cfg }, actor, employeeId, ip) {
  const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(Number(employeeId));
  if (!e || e.user_id) return null;
  const no = String(e.employeeNo ?? e.employeeno ?? '');
  // حساب قائم بالرمز الوظيفي نفسه يُربط ولا يُنشأ غيره
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(no);
  if (existing) {
    db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(existing.id, e.id);
    audit(db, actor, 'ربط ملف موظف بحسابه القائم', no, ip);
    return { username: no, linked: true };
  }
  let username = USERNAME_RE.test(no) ? no : `emp${e.id}`;
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = `emp${e.id}-${Date.now().toString(36)}`;
  const pw = tempPassword(), hash = await hashPassword(pw, cfg.scryptN);
  const unit = e.unit_id && db.prepare('SELECT id FROM org_units WHERE id = ?').get(e.unit_id) ? e.unit_id : null;
  const userId = Number(db.prepare(`INSERT INTO users (username, display_name, password_hash, role, unit_id, must_change_password, created_at, job_title, access_mode, data_scope,
      custom_permissions_json, revoked_permissions_json, allowed_views_json, module_access_json, hidden_tabs_json)
    VALUES (?, ?, ?, 'staff', ?, 1, ?, ?, 'custom', ?, ?, '[]', '[]', '{}', '[]') RETURNING id`)
    .get(username, e.name, hash, unit, Date.now(), String(e.position ?? '').slice(0, 80), unit ? 'unit' : 'all', JSON.stringify(MINIMAL)).id);
  db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(userId, e.id);
  notifyUnits(db, ['of_docs', 'safety'], 'staff_card_needed', e.id, `موظف جديد بحاجة إلى بطاقة وتصريح دخول: ${e.name} (${no}).`);
  audit(db, actor, 'إنشاء حساب لموظف جديد بصلاحيات دنيا', `${no} -> ${username}`, ip);
  return { username, tempPassword: pw };
}

// انتهاء الخدمة: يُعطَّل الحساب وتنتهي جلساته وعضوياته في المجالس، ويُطلب استرداد البطاقة. لا يُحذف شيء
export function endEmployeeAccount({ db }, actor, employee, ip) {
  if (!employee?.user_id) return false;
  const uid = Number(employee.user_id), no = employee.employeeNo ?? employee.employeeno ?? '';
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(uid);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  db.prepare("UPDATE council_members SET active = 0, to_day = ? WHERE user_id = ? AND active = 1").run(new Date().toISOString().slice(0, 10), uid);
  invalidateSessionCache();
  notifyUnits(db, ['of_docs', 'safety'], 'staff_card_return', Number(employee.id), `انتهت خدمة ${employee.name} (${no}): استرداد البطاقة وإلغاء تصاريح الدخول.`);
  audit(db, actor, 'إغلاق حساب موظف بانتهاء خدمته', String(no), ip);
  return true;
}
