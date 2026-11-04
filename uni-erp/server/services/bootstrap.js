import { tx } from '../db.js';
import { audit } from '../audit.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../security.js';

// قراءة كلمة المرور من البيئة: تُنظَّف من المسافات وعلامات الاقتباس التي تُلصق أحياناً عند نسخ قيمة المتغير
function configuredSeed(env) {
  let v = String(env.SEED_PASSWORD ?? '').trim();
  if (/^(["'`]).*\1$/.test(v)) v = v.slice(1, -1).trim();
  return v;
}

export function hasConfiguredSeedPassword(env = process.env) {
  return Boolean(configuredSeed(env));
}

// لا توجد كلمة مرور ثابتة في الكود: بدون SEED_PASSWORD تُولَّد كلمة عشوائية ثابتة طوال عمر العملية
let generatedSeed = null;
export function seedPassword(env = process.env) {
  return configuredSeed(env) || (generatedSeed ??= randomBytes(18).toString('base64url'));
}

export const CORE_ACCOUNTS = [
  { username: 'admin',    name: 'مدير النظام',  role: 'admin' },
  { username: 'auditor1', name: 'مدقق الجودة',  role: 'auditor' },
];

// ينشئ الحسابين الأساسيين أو يُعيد ضبطهما (الدور، التفعيل، فك القفل، كلمة المرور) دون المساس ببقية الحسابات.
// يدعم إجبار تغيير كلمة المرور عند أول دخول عبر FORCE_SEED_PASSWORD_CHANGE=1 في بيئات الإنتاج.
export async function ensureCoreAccounts({ db, cfg }, password = seedPassword(), { forceChange = false } = {}) {
  const hash = await hashPassword(password, cfg.scryptN);
  const mustChange = forceChange || process.env.FORCE_SEED_PASSWORD_CHANGE === '1' ? 1 : 0;
  const out = [];
  for (const a of CORE_ACCOUNTS) {
    tx(db, () => {
      const u = db.prepare('SELECT id, role FROM users WHERE username = ?').get(a.username);
      if (u && u.role === 'student') throw new Error(`اسم المستخدم ${a.username} محجوز لحساب طالب.`);
      if (u) {
        db.prepare('UPDATE users SET display_name = ?, role = ?, role_key = NULL, unit_id = NULL, password_hash = ?, active = 1, must_change_password = ?, failed_logins = 0, locked_until = 0 WHERE id = ?')
          .run(a.name, a.role, hash, mustChange, u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        audit(db, null, 'إعادة ضبط حساب أساسي', a.username);
      } else {
        db.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_at) VALUES (?,?,?,?,?,?)')
          .run(a.username, a.name, hash, a.role, mustChange, Date.now());
        audit(db, null, 'إنشاء حساب أساسي', a.username);
      }
      out.push({ username: a.username, role: a.role, action: u ? 'أُعيد ضبطه' : 'أُنشئ', mustChange: Boolean(mustChange) });
    });
  }
  return out;
}
