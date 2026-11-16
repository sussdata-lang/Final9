import { setAuditKey } from './audit.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(os.tmpdir(), 'uni-erp-runtime-data');
try {
  fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DEFAULT_DATA_DIR, 0o700);
} catch { /* ignore on read-only fs */ }

// قارئ .env بسيط (بلا اعتماديات). المتغيرات الفعلية في البيئة لها الأولوية.
function loadDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function signingKeyFile(cfg) {
  const isPgUri = /^postgres(ql)?:\/\//i.test(String(cfg.dbPath || ''));
  const keyDir = (isPgUri || cfg.dbPath === ':memory:') ? DEFAULT_DATA_DIR : path.dirname(cfg.dbPath);
  return path.join(keyDir, 'secret.key');
}

export function loadConfig(overrides = {}) {
  const env = { ...loadDotEnv(path.join(ROOT, '.env')), ...process.env };
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
  const rawTsaUrl = env.TSA_URL ? String(env.TSA_URL).trim() : '';
  const safeTsaUrl = rawTsaUrl
    ? rawTsaUrl.replace(/^http:\/\/timestamp\.digicert\.com/i, 'https://timestamp.digicert.com')
    : null;
  const cfg = {
    root: ROOT,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    // PostgreSQL connection string (DATABASE_URL). المسار الافتراضي اسم منطقي فقط: openDb يشتق منه قاعدة معزولة (الاختبارات) ولا يُنشأ ملف
    dbPath: env.DATABASE_URL || (env.DB_PATH ? abs(env.DB_PATH) : path.join(DEFAULT_DATA_DIR, 'uni-erp.db')),
    uploadDir: env.UPLOAD_DIR ? abs(env.UPLOAD_DIR) : path.join(DEFAULT_DATA_DIR, 'uploads'),
    logDir: env.LOG_DIR ? abs(env.LOG_DIR) : path.join(DEFAULT_DATA_DIR, 'logs'),      // سجلات التشغيل (سطر JSON لكل حدث)
    logLevel: env.LOG_LEVEL ?? 'info',               // error | warn | info
    publicDir: path.join(ROOT, 'public'),
    sessionHours: Number(env.SESSION_HOURS ?? 8),
    cookieSecure: env.COOKIE_SECURE === '1',
    trustProxy: env.TRUST_PROXY === '1',
    universityName: /[\u0600-\u06FF]/.test(env.UNIVERSITY_NAME ?? env.Uni_name ?? '') ? (env.UNIVERSITY_NAME ?? env.Uni_name) : 'الجامعة السورية للعلوم الأمنية', // اسم بلا حروف عربية (مثل SUSSEDU) يُستبدل بالاسم العربي الرسمي
    publicUrl: env.PUBLIC_URL ?? null,
    tsaUrl: safeTsaUrl,                        // خادم ختم زمني RFC 3161 (اختياري عبر HTTPS)، مثل https://timestamp.digicert.com
    scryptN: Number(env.SCRYPT_N ?? 2 ** 15),
    maxAttachmentBytes: 2 * 1024 * 1024,
    signingKey: env.SIGNING_KEY || null,
    // النسخ الاحتياطي اليومي (انظر docs/PHASE2.md): BACKUP_DIR, BACKUP_KEEP, BACKUP_HOUR (ساعة UTC), BACKUP_AUTO=0 لإيقافه، BACKUP_PASSPHRASE لتشفيره، BACKUP_PUT_URL للرفع الخارجي
    backupDir: env.BACKUP_DIR ? abs(env.BACKUP_DIR) : path.join(DEFAULT_DATA_DIR, 'backups'),
    backupKeep: Number(env.BACKUP_KEEP ?? 14),
    backupHour: Number(env.BACKUP_HOUR ?? 1),
    backupAuto: env.BACKUP_AUTO !== '0',   // مفعّل افتراضياً (BACKUP_AUTO=0 لإيقافه) كما في .env.example
    backupPassphrase: env.BACKUP_PASSPHRASE || null,
    backupPutUrl: env.BACKUP_PUT_URL || null,
    backupPutAuth: env.BACKUP_PUT_AUTH || null,
    // تنبيهات الجوال: مفاتيح VAPID (تُولَّد تلقائياً إن لم تُضبط) وخدمات دفع إضافية مسموحة
    vapidPublic: env.VAPID_PUBLIC_KEY || null,
    vapidPrivate: env.VAPID_PRIVATE_KEY || null,
    pushAllowHosts: (env.PUSH_ALLOW_HOSTS || '').split(',').map((x) => x.trim()).filter(Boolean),
    ...overrides,
  };
  // مجلد البيانات: بجوار ملف القاعدة، أما مع PostgreSQL (رابط) أو :memory: فالمجلد الافتراضي (dirname لرابط يعطي مساراً مزيفاً)
  {
    const pgOrMem = /^postgres(ql)?:\/\//i.test(String(cfg.dbPath || '')) || cfg.dbPath === ':memory:';
    if (!cfg.dataDir) cfg.dataDir = pgOrMem ? DEFAULT_DATA_DIR : path.dirname(cfg.dbPath);
    if (!overrides.backupDir && !env.BACKUP_DIR) cfg.backupDir = path.join(cfg.dataDir, 'backups');
  }
  // مفتاح سلسلة التدقيق: AUDIT_KEY، وإلا يُولَّد مرة واحدة بجوار مفتاح التوقيع. مستقل عنه، فتبديل مفتاح التوقيع لا يكسر السلسلة
  {
    const auditKeyFile = path.join(path.dirname(signingKeyFile(cfg)), 'audit.key');
    if (env.AUDIT_KEY) cfg.auditKey = env.AUDIT_KEY;
    else {
      fs.mkdirSync(path.dirname(auditKeyFile), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(auditKeyFile)) fs.writeFileSync(auditKeyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      cfg.auditKey = fs.readFileSync(auditKeyFile, 'utf8').trim();
    }
    setAuditKey(cfg.auditKey);
  }
  // مفتاح تشفير الحقول الحساسة (ملفات الانضباط): DATA_KEY، وإلا يُولَّد مرة واحدة بجوار مفتاح التدقيق. مستقل عنهما
  {
    const dataKeyFile = path.join(path.dirname(signingKeyFile(cfg)), 'data.key');
    if (env.DATA_KEY) cfg.dataKey = env.DATA_KEY;
    else {
      fs.mkdirSync(path.dirname(dataKeyFile), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(dataKeyFile)) fs.writeFileSync(dataKeyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      cfg.dataKey = fs.readFileSync(dataKeyFile, 'utf8').trim();
    }
  }
  if (!cfg.signingKey) {
    // مفتاح التوقيع: يُولَّد مرة واحدة ويُحفظ بصلاحيات مقيّدة (0o700 للمجلد و0o600 للملف).
    // فحص استباقي لمنع تسريب سلسلة اتصال PostgreSQL (DATABASE_URL) إلى مسار الملفات المحلي.
    const keyFile = signingKeyFile(cfg);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(keyFile), 0o700); } catch { /* ignore */ }
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    try { fs.chmodSync(keyFile, 0o600); } catch { /* ignore */ }
    cfg.signingKey = fs.readFileSync(keyFile, 'utf8').trim();
  }
  return cfg;
}
