// تهيئة بيانات أولية (قاعدة فارغة فقط). الاستخدام:
//   npm run seed                       الحسابان الأساسيان admin وauditor1 بكلمة مرور عشوائية تُطبع مرة واحدة وتُغيَّر عند أول دخول
//   SEED_PASSWORD=... npm run seed     كلمة مرور محددة
// الطلاب لا يُنشؤون هنا: يسجِّلهم المدير أو موظف شؤون الطلاب من شاشة «تسجيل الطلاب».
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ensureCoreAccounts, seedPassword, hasConfiguredSeedPassword } from '../server/services/bootstrap.js';

const cfg = loadConfig();
const db = await openDb(cfg.dbPath);

if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) { console.log('قاعدة البيانات تحوي مستخدمين مسبقاً؛ لا شيء يُضاف. (لإعادة ضبط الحسابين الأساسيين: npm run accounts)'); process.exit(0); }

const password = seedPassword();
const generated = !hasConfiguredSeedPassword();
const res = await ensureCoreAccounts({ db, cfg }, password, { forceChange: generated });
console.log('\nالحسابات الأساسية المُنشأة:');
const maskedPass = '*'.repeat(Math.min(password.length, 12));
for (const r of res) console.log(`  ${r.username.padEnd(10)} ${r.role.padEnd(8)} كلمة المرور: [${maskedPass} مخفية أمنياً] (${password.length} أحرف)`);
if (generated) console.log(`\nSEED_PASSWORD غير مضبوط؛ كلمة مرور مؤقتة للحسابين (تظهر هذه المرة فقط وتُغيَّر عند أول دخول): ${password}`);
