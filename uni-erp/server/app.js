import { configureLogger, closeLogger } from './lib/logger.js';
import { drainCertificates } from './services/enrollcert.js';
import { drainPush } from './services/push.js';
import { startBackupScheduler } from './services/backup.js';
import http from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { RateLimiter } from './security.js';
import { makeHandler } from './http.js';
import { buildRouter } from './routes.js';
import { sessionUser } from './services/auth.js';

import { ensureCoreAccounts, seedPassword, hasConfiguredSeedPassword } from './services/bootstrap.js';
import { ensureStructure, STRUCTURE, FACULTY_ROLE } from './services/structure.js';
import { ensureForms } from './services/forms/index.js';
import { ready as financeReady } from './services/finance/core.js';
import { hashPassword } from './security.js';
import { createHeavyPool } from './heavy.js';
import { startLoopWatch } from './http.js';
import { purgeAuditLog } from './audit.js';
import { purgeIdempotencyKeys } from './services/idempotency.js';
import { getSetting } from './services/settings.js';
import { demoModeBlocked } from './services/dev_accounts.js';

export async function createApp(overrides = {}) {
  if (overrides.dbPath !== ':memory:' && demoModeBlocked()) throw new Error('رُفض التشغيل: DEMO_MODE=1 لا يعمل مع NODE_ENV=production لأنه يعيد كلمة مرور كل الحسابات. أزل DEMO_MODE من متغيرات البيئة.');
  const cfg = loadConfig(overrides);
  configureLogger({ dir: cfg.dbPath === ':memory:' ? null : cfg.logDir, level: cfg.logLevel });
  const db = await openDb(cfg.dbPath);
  cfg.pgUrl = db.pgUrl;   // للنسخ الاحتياطي والاستعادة (pg_dump / pg_restore)
  // شرط التهيئة: إذا كانت قاعدة البيانات الافتراضية أو في الذاكرة
  if (!overrides.dbPath || overrides.dbPath === ':memory:') {
    const pw = seedPassword();
    // وضع العرض يعيد كلمة مرور كل الحسابات، ومنها الطلاب، عند كل تشغيل ويفعّل المعطل منها، فلا يعمل إلا بطلب صريح (DEMO_MODE=1) أو في قاعدة الذاكرة للاختبار، ويُرفض مع NODE_ENV=production
    const demo = overrides.dbPath === ':memory:' || process.env.DEMO_MODE === '1';
    if (demo) {
      if (overrides.dbPath !== ':memory:') {
        console.warn('تحذير أمني: DEMO_MODE=1 يعيد كلمة مرور كل الحسابات، ومنها الطلاب، عند كل تشغيل، ويفعّل الحسابات المعطلة ويفك أقفالها، ويتيح تبديل الحساب محلياً. لا تستخدمه مع بيانات حقيقية.');
        if (!hasConfiguredSeedPassword()) console.warn(`SEED_PASSWORD غير مضبوط؛ كلمة مرور هذا التشغيل: ${pw}`);
      }
      await ensureCoreAccounts({ db, cfg }, pw);
      await ensureStructure({ db, cfg }, { activate: true, password: pw });
    } else {
      if (!db.prepare('SELECT COUNT(*) AS c FROM users').get().c) {
        const generated = !hasConfiguredSeedPassword();
        await ensureCoreAccounts({ db, cfg }, pw, { forceChange: generated });
        if (generated) console.warn(`SEED_PASSWORD غير مضبوط؛ كلمة مرور مؤقتة للحسابين الأساسيين (تُغيَّر عند أول دخول): ${pw}`);
      }
      await ensureStructure({ db, cfg });
    }
    ensureForms({ db });
    // تحديث صلاحيات الأدوار الافتراضية التي لم يُعدّل اسمها يدوياً
    for (const n of STRUCTURE) {
      db.prepare('UPDATE roles SET permissions_json = ? WHERE key = ? AND label = ?')
        .run(JSON.stringify(n.perms), 'head_' + n.code, n.label);
    }
    db.prepare('UPDATE roles SET permissions_json = ? WHERE key = ? AND label = ?').run(JSON.stringify(FACULTY_ROLE.perms), FACULTY_ROLE.key, FACULTY_ROLE.label);
    if (demo) {
    const hash = await hashPassword(pw, cfg.scryptN);
    // ضمان وجود حساب موظف شؤون طلاب وحساب طالب تجريبي بدون إلزام تغيير كلمة المرور للتجربة السلسة
    if (!db.prepare("SELECT id FROM users WHERE username = 'staff1'").get()) {
      db.prepare("INSERT INTO users (username, display_name, password_hash, role, active, must_change_password, created_at) VALUES ('staff1', 'أحمد المنصور (شؤون الطلاب)', ?, 'staff', 1, 0, ?)")
        .run(hash, Date.now());
    }
    if (!db.prepare("SELECT id FROM users WHERE username = 'CYB-2026-0001'").get()) {
      const prog = db.prepare('SELECT id, faculty, name, degree FROM programs WHERE active = 1 ORDER BY id LIMIT 1').get();
      const uid = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, program, active, must_change_password, created_at) VALUES ('CYB-2026-0001', 'طارق محمود العلي', ?, 'student', 'CYB-2026-0001', ?, 1, 0, ?)")
        .run(hash, prog ? prog.name : 'هندسة الأمن السيبراني', Date.now()).lastInsertRowid);
      if (prog) {
        db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, email, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_by, created_at, updated_at)
          VALUES (?, 'طارق', 'محمود', 'العلي', 'سعاد الحسن', '01020304055', 'ذكر', '2005-04-15', 'دمشق', 'سورية', '0944112233', 'tarek@suss.edu.sy', 'دمشق', 'المزة', 'شارع الفيلات الغربية', 'علمي', 2025, 2320, ?, 'عام', 2026, 'الفصل الأول', 2, 'active', 'محمود العلي', 'أب', '0944001122', 1, ?, ?) ON CONFLICT (user_id) DO NOTHING`)
          .run(uid, prog.id, Date.now(), Date.now());
      }
    }
    db.prepare('UPDATE users SET active = 1, must_change_password = 0, failed_logins = 0, locked_until = 0, password_hash = ?').run(hash);
    }
    try { financeReady(db); } catch (_) {}
    try {
      // تدقيق وربط العلاقات المرجعية بين الوحدات التنظيمية والبرامج والموظفين والحسابات
      const rootUnit = db.prepare("SELECT id FROM org_units WHERE kind = 'university' ORDER BY id LIMIT 1").get()
        || db.prepare('SELECT id FROM org_units ORDER BY id LIMIT 1').get();
      const rootUnitId = rootUnit ? rootUnit.id : 1;
      db.prepare('UPDATE users SET unit_id = ? WHERE unit_id IS NULL').run(rootUnitId);
      const hrDepts = db.prepare('SELECT DISTINCT department_name FROM hr_employees WHERE department_name IS NOT NULL').all();
      for (const d of hrDepts) {
        const deptName = String(d.department_name).trim();
        if (!deptName) continue;
        const unit = db.prepare('SELECT id FROM org_units WHERE name = ? AND active = 1 LIMIT 1').get(deptName);
        if (unit) db.prepare('UPDATE hr_employees SET unit_id = ? WHERE department_name = ?').run(unit.id, deptName);
      }
    } catch (relErr) {
      console.error('Relational link audit note:', relErr);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    if (!cfg.backupPassphrase) console.warn('تحذير أمني: BACKUP_PASSPHRASE غير مضبوط، فالنسخ الاحتياطية تُحفظ بلا تشفير وفيها البيانات ومفتاح التوقيع.');
    if (!cfg.backupPutUrl) console.warn('تحذير: BACKUP_PUT_URL غير مضبوط، فالنسخ الاحتياطية على قرص الخادم نفسه فقط.');
  }
  const limiter = new RateLimiter();
  const heavy = createHeavyPool({ db, cfg });
  const router = await buildRouter({ db, cfg, limiter, heavy });
  const server = http.createServer(makeHandler({ cfg, router, getUser: (tok) => sessionUser(db, tok) }));
  server.headersTimeout = 15_000; server.requestTimeout = 600_000;
  // تنظيف الجلسات المنتهية كل ساعة
  const timer = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000);
  timer.unref();
  const stopBackups = startBackupScheduler({ db, cfg });
  const stopLoopWatch = startLoopWatch();
  // مدة الاحتفاظ بسجل التدقيق من الإعدادات العامة
  const auditPurge = () => { try { purgeIdempotencyKeys(db); } catch (e) { console.warn('idempotency purge:', e.message); } try { const r = purgeAuditLog(db, getSetting(db, 'audit.retention_years')); if (r.removed) console.log(`سجل التدقيق: حُذف ${r.removed} صفاً تجاوز مدة الاحتفاظ.`); } catch (e) { console.error('audit purge:', e.message); } };
  const purgeFirst = setTimeout(auditPurge, 120_000), purgeTimer = setInterval(auditPurge, 24 * 3600_000);
  purgeFirst.unref(); purgeTimer.unref();
  return { server, db, cfg, limiter, router, close: async () => { clearInterval(timer); clearTimeout(purgeFirst); clearInterval(purgeTimer); stopBackups(); stopLoopWatch(); await drainCertificates(db); await drainPush(); await heavy.close(); await new Promise((res) => server.close(() => { db.close(); res(); })); await closeLogger(); } };
}
