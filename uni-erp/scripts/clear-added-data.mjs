// تفريغ البيانات المضافة والإبقاء على الأساسيات: حسابات الموظفين، والكليات والمعاهد وبرامجها، والأدوار، وقوائم النظام.
// يعرض ما سيُحذف فقط، ولا ينفذ إلا مع --confirm. قاعدة غير محلية تتطلب أيضًا --allow-remote.
//   DATABASE_URL=... node scripts/clear-added-data.mjs
//   DATABASE_URL=... node scripts/clear-added-data.mjs --confirm
import pg from 'pg';

const KEEP = new Set([
  'users', 'roles', 'org_units', 'unit_links', 'faculties', 'programs',
  'schema_migrations', 'sessions', 'site_settings', 'infra_settings', 'audit_log',
  'service_types', 'rules', 'corr_templates',
  'fin_accounts', 'fin_currencies', 'fin_fee_types', 'fin_years',
  'hr_system_lookups', 'hr_alert_settings', 'proc_categories',
  'dorm_buildings', 'dorm_rooms',
]);

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL غير مضبوط.'); process.exit(1); }
const confirm = process.argv.includes('--confirm');
const host = new URL(url).hostname;
if (confirm && !['127.0.0.1', 'localhost', '::1'].includes(host) && !process.argv.includes('--allow-remote')) {
  console.error(`القاعدة على ${host} ليست محلية؛ أضف --allow-remote إن كنت تقصدها.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const count = async (sql) => Number((await client.query(sql)).rows[0].c);
const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename).filter((t) => !KEEP.has(t));
const plan = [];
for (const t of tables) { const n = await count(`SELECT COUNT(*) AS c FROM "${t}"`); if (n) plan.push([t, n]); }
const students = await count("SELECT COUNT(*) AS c FROM users WHERE role = 'student'");
console.log(`القاعدة: ${host}/${new URL(url).pathname.slice(1)}`);
for (const [t, n] of plan) console.log(`  ${t}: ${n}`);
console.log(`  حسابات الطلاب: ${students}`);

if (!confirm) {
  console.log('معاينة فقط، لم يُحذف شيء. للتنفيذ أضف --confirm.');
  await client.end();
  process.exit(0);
}
await client.query('BEGIN');
try {
  if (tables.length) await client.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  await client.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'student')");
  await client.query("DELETE FROM users WHERE role = 'student'");
  await client.query('UPDATE dorm_rooms SET occupied = 0');
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('فشل التفريغ ولم يتغير شيء:', e.message);
  await client.end();
  process.exit(1);
}
console.log('تم التفريغ. أعد تشغيل الخادم.');
await client.end();
