// النسخ الاحتياطي: لقطة متّسقة لقاعدة PostgreSQL (pg_dump بصيغة custom؛ تُستعاد بـ pg_restore، ويلزم تثبيتهما على الخادم) + كل ملفات data (المرفقات، الشهادات، مفتاح التوقيع) + المفتاح الفعّال، في أرشيف واحد.
// يُنشأ تلقائياً مرة كل يوم، ويُحفظ آخر N نسخة محلياً (BACKUP_KEEP)، ويُنزَّل من لوحة المدير، ويمكن رفعه تلقائياً إلى مخزن خارجي بطلب PUT (BACKUP_PUT_URL)
// لأن النسخ على القرص نفسه لا تحمي من ضياع القرص. إن ضُبطت BACKUP_PASSPHRASE يُشفَّر الأرشيف (AES-256-GCM) لأنه يحوي بيانات الطلاب ومفتاح التوقيع.
import { log } from '../lib/logger.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
// import { DatabaseSync } from 'node:sqlite'; // ← تم إزالته (PostgreSQL)
import { Worker } from 'node:worker_threads';
import { readZip } from '../lib/zip.js';
import { LMS_ASSIGNMENTS_AREA } from '../lib/storage.js';
import { encrypt } from '../lib/backup_crypto.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

export const NAME_RE = /^backup-\d{8}-\d{6}(-[a-z]+)?\.zip(\.enc)?$/;
const MAGIC = Buffer.from('UEB1');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// مع PostgreSQL قد يكون cfg.dbPath رابطاً (postgres://user:pass@...) فلا يجوز أخذ dirname منه: يُنتج مساراً مزيفاً بكلمة المرور
const dataDirOf = (cfg) => cfg.dataDir || (/^postgres(ql)?:\/\//i.test(String(cfg.dbPath)) || cfg.dbPath === ':memory:' ? path.resolve('data') : path.dirname(cfg.dbPath));

/* ---------- PostgreSQL: pg_dump / pg_restore ---------- */
const isPgUri = (s) => /^postgres(ql)?:\/\//i.test(String(s || ''));
// كلمة المرور تُمرَّر بمتغيرات البيئة لا بوسائط سطر الأوامر (لا تظهر في قائمة العمليات)
function pgEnv(url) {
  const u = new URL(url);
  const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get('sslmode'); if (ssl) env.PGSSLMODE = ssl;
  return env;
}
// غياب أداة النسخ عن الخادم ليس عطلًا داخليًا: رسالة تشرح ما يلزم
const pgFail = (what, e) => /ENOENT/.test(String(e.message)) ? new HttpError(503, `${what}: أدوات PostgreSQL (pg_dump وpg_restore) غير مثبتة على هذا الخادم أو ليست في PATH.`, 'backup_unavailable') : new HttpError(500, `${what}: ${String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ')}`, 'backup_failed');
const pgDump = (url, file) => new Promise((resolve, reject) => {
  execFile('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${file}`], { env: pgEnv(url), timeout: 10 * 60_000, maxBuffer: 1 << 20 },
    (e, _o, stderr) => (e ? reject(pgFail('تعذّر نسخ قاعدة البيانات (pg_dump)', { stderr, message: e.message })) : resolve()));
});
const pgDumpSync = (url, file) => {
  try { execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${file}`], { env: pgEnv(url), timeout: 10 * 60_000, stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { throw pgFail('تعذّر حفظ نسخة الوضع الحالي (pg_dump)', e); }
};
const pgRestoreSync = (url, file) => {
  try { execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', `--dbname=${pgEnv(url).PGDATABASE}`, file], { env: pgEnv(url), timeout: 30 * 60_000, stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { throw pgFail('فشلت استعادة قاعدة البيانات (pg_restore)', e); }
};
export const backupDirOf = (cfg) => cfg.backupDir || path.join(dataDirOf(cfg), 'backups');

function walk(dir, base, skip, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name), rel = path.posix.join(base, e.name);
    if (skip(full, e)) continue;
    if (e.isDirectory()) walk(full, rel, skip, out); else if (e.isFile()) out.push({ name: rel, full });
  }
  return out;
}
const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
// النسخة تُجمَّع كلها في الذاكرة: حلول الطلاب ومرفقاتها تُنسخ مع القرص الدائم، والملفات قيد الرفع قد تختفي أثناء الجمع
const notInBackup = (cfg, full) => full === path.join(cfg.uploadDir, LMS_ASSIGNMENTS_AREA) || full === path.join(cfg.uploadDir, '.incoming');

/* ---------- التشفير الاختياري ---------- */
export { encrypt };
export function decrypt(buf, pass) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new HttpError(400, 'الملف ليس نسخة احتياطية مشفَّرة صالحة.', 'validation');
  if (!pass) throw new HttpError(400, 'النسخة مشفَّرة: أدخل عبارة المرور (BACKUP_PASSPHRASE).', 'validation');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48), key = crypto.scryptSync(pass, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(48)), d.final()]); } catch { throw new HttpError(400, 'عبارة المرور خاطئة أو الملف تالف.', 'validation'); }
}

/* ---------- الإنشاء ---------- */
const assembleInWorker = (data) => new Promise((resolve, reject) => {
  const w = new Worker(new URL('../backup_worker.js', import.meta.url), { workerData: data });
  w.once('message', resolve);
  w.once('error', reject);
  w.once('exit', (code) => { if (code !== 0) reject(new Error(`backup worker exited with code ${code}`)); });
});

export async function createBackup({ db, cfg }, { reason = 'auto', actor = null, ip = null } = {}) {
  const dir = backupDirOf(cfg), dataDir = dataDirOf(cfg), now = new Date();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), tmp = path.join(dir, `.tmp-${stamp}-${crypto.randomBytes(3).toString('hex')}.db`);
  try {
    // لقطة متّسقة لقاعدة PostgreSQL عبر pg_dump (صيغة custom مضغوطة تُستعاد بـ pg_restore)
    const pgUrl = db?.pgUrl ?? cfg.pgUrl ?? (isPgUri(cfg.dbPath) ? cfg.dbPath : process.env.DATABASE_URL);
    if (!pgUrl) throw new HttpError(500, 'رابط PostgreSQL غير معروف: لا يمكن نسخ قاعدة البيانات.', 'backup_failed');
    await pgDump(pgUrl, tmp);
    // النسخة غير المشفرة لا تحمل مفتاح التوقيع ولا الشهادة، فمن يصل إليها لا يستطيع توقيع وثائق صحيحة
    const noSecrets = !cfg.backupPassphrase;
    const skip = (full, e) => full === dir || inside(full, dir) || e.name.startsWith('.tmp-') || (noSecrets && (e.name === 'secret.key' || e.name === 'audit.key' || e.name === 'data.key' || e.name === 'pki')) || notInBackup(cfg, full);
    const extra = walk(dataDir, 'data', skip);
    if (!inside(cfg.uploadDir, dataDir) && cfg.uploadDir !== dataDir) extra.push(...walk(cfg.uploadDir, 'uploads', (full) => notInBackup(cfg, full)));
    const name = `backup-${stamp}${reason === 'auto' ? '' : '-' + reason.replace(/[^a-z]/g, '')}.zip${cfg.backupPassphrase ? '.enc' : ''}`;
    const file = path.join(dir, name);
    const manifest = { app: 'uni-erp', format: 1, createdAt: now.toISOString(), reason, signingMaterial: !noSecrets, note: 'استعد بـ: node scripts/restore.js <الملف> — والخادم متوقف.' };
    const built = await assembleInWorker({ dumpPath: tmp, extra, signingKey: noSecrets ? '' : cfg.signingKey ?? '', manifest, passphrase: cfg.backupPassphrase || null, outPath: file });
    const res = { name, size: built.size, createdAt: now.getTime(), encrypted: !!cfg.backupPassphrase, files: built.files, uploaded: null, error: null };
    if (cfg.backupPutUrl) res.uploaded = await upload(cfg, name, await fs.promises.readFile(file)).catch((e) => { res.error = `تعذّر الرفع الخارجي: ${e.message}`; return false; });
    prune(cfg);
    setStatus(db, res);
    if (actor) audit(db, actor, 'إنشاء نسخة احتياطية', name, ip);
    return res;
  } finally { try { fs.unlinkSync(tmp); } catch { /* غير موجود */ } }
}

async function upload(cfg, name, buf) {
  const u = new URL(cfg.backupPutUrl);
  if (u.protocol !== 'https:' && !cfg.backupAllowHttp) throw new Error('رابط الرفع يجب أن يكون https');
  const url = cfg.backupPutUrl.includes('{name}') ? cfg.backupPutUrl.replace('{name}', encodeURIComponent(name)) : cfg.backupPutUrl.replace(/\/?$/, '/') + encodeURIComponent(name);
  const res = await (cfg.backupFetch ?? fetch)(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(cfg.backupPutAuth ? { Authorization: cfg.backupPutAuth } : {}) }, body: buf, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`استجابة ${res.status}`);
  return true;
}

export function listBackups(cfg) {
  const dir = backupDirOf(cfg);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).map((n) => { const s = fs.statSync(path.join(dir, n)); return { name: n, size: s.size, createdAt: s.mtimeMs, encrypted: n.endsWith('.enc') }; }).sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
}
function prune(cfg) {
  const keep = Math.max(1, Number(cfg.backupKeep ?? 14)), all = listBackups(cfg);
  for (const b of all.slice(keep)) try { fs.unlinkSync(path.join(backupDirOf(cfg), b.name)); } catch { /* */ }
}
export function backupPath(cfg, name) {
  if (!NAME_RE.test(String(name))) throw new HttpError(404, 'النسخة غير موجودة.', 'not_found');
  const f = path.join(backupDirOf(cfg), name);
  if (!fs.existsSync(f)) throw new HttpError(404, 'النسخة غير موجودة.', 'not_found');
  return f;
}
export function deleteBackup({ db, cfg }, actor, name, ip) {
  fs.unlinkSync(backupPath(cfg, name)); audit(db, actor, 'حذف نسخة احتياطية', name, ip);
}
// فحص سلامة نسخة دون كتابة: فك التشفير ثم مقارنة بصمة التفريغ بالمسجلة في الملف
export function verifyBackup({ db, cfg }, actor, name, ip) {
  const file = backupPath(cfg, name), out = { name, ok: false, encrypted: name.endsWith('.enc') };
  try {
    let buf = fs.readFileSync(file);
    if (buf.subarray(0, 4).equals(MAGIC)) buf = decrypt(buf, cfg.backupPassphrase);
    const z = readZip(buf, { maxTotal: 4 * 1024 ** 3, maxEntries: 200000 }), man = z.get('manifest.json');
    if (!man) throw new HttpError(400, 'الملف ليس نسخة احتياطية لهذا النظام.', 'validation');
    const m = JSON.parse(man.toString('utf8')), dump = z.get('database/database.dump');
    if (m.app !== 'uni-erp') throw new HttpError(400, 'الملف ليس نسخة احتياطية لهذا النظام.', 'validation');
    if (!dump || !m.dbSha256) throw new HttpError(400, 'لا تتضمن النسخة تفريغاً لقاعدة البيانات أو بصمة له.', 'validation');
    if (sha(dump) !== m.dbSha256) throw new HttpError(400, 'بصمة قاعدة البيانات لا تطابق المسجّلة: النسخة تالفة أو معدَّلة.', 'validation');
    Object.assign(out, { ok: true, createdAt: m.createdAt, dbBytes: dump.length, files: z.size ?? m.files });
  } catch (e) {
    out.message = e instanceof HttpError ? e.message : 'الملف تالف أو غير مقروء.';
  }
  if (actor) audit(db, actor, 'فحص نسخة احتياطية', `${name}: ${out.ok ? 'سليمة' : 'فشل'}`, ip);
  return out;
}
const setStatus = (db, s) => db.prepare("INSERT INTO site_settings (key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s));
const lastStatus = (db) => { try { return JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key = 'last_backup'").get()?.value ?? 'null'); } catch { return null; } };
export function backupInfo({ db, cfg }) {
  return { backups: listBackups(cfg), last: lastStatus(db), keep: Number(cfg.backupKeep ?? 14), encrypted: !!cfg.backupPassphrase, remote: !!cfg.backupPutUrl, auto: cfg.backupAuto !== false, hourUtc: Number(cfg.backupHour ?? 1),
    persistentHint: 'النسخ المحفوظة على الخادم نفسه لا تحمي من ضياع القرص: نزّل نسخة دورياً أو فعّل الرفع الخارجي (BACKUP_PUT_URL).' };
}

/* ---------- الجدولة اليومية ---------- */
export function startBackupScheduler(deps) {
  const { cfg } = deps;
  if (cfg.backupAuto === false) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date(), latest = listBackups(cfg).find((b) => !/-[a-z]+\.zip/.test(b.name.replace(/\.enc$/, '')));
    const due = !latest || (now.getTime() - latest.createdAt > 24 * 3600e3) || (now.getUTCHours() >= Number(cfg.backupHour ?? 1) && new Date(latest.createdAt).toISOString().slice(0, 10) !== now.toISOString().slice(0, 10));
    if (!due) return;
    running = true;
    try { await createBackup(deps, { reason: 'auto' }); } catch (e) { log.warn('backup: ' + e.message); setStatus(deps.db, { createdAt: Date.now(), error: e.message }); } finally { running = false; }
  };
  const first = setTimeout(tick, Number(cfg.backupFirstDelayMs ?? 60_000)), t = setInterval(tick, 15 * 60_000);
  first.unref(); t.unref();
  return () => { clearTimeout(first); clearInterval(t); };
}

/* ---------- الاستعادة (والخادم متوقف): تتحقق قبل أي كتابة وتحتفظ بنسخة من الوضع الحالي ---------- */
export function restoreBackup(cfg, file, { passphrase = cfg.backupPassphrase, force = false, databaseUrl = null } = {}) {
  let buf = fs.readFileSync(file);
  if (buf.subarray(0, 4).equals(MAGIC)) buf = decrypt(buf, passphrase);
  const z = readZip(buf, { maxTotal: 4 * 1024 ** 3, maxEntries: 200000 });
  const man = z.get('manifest.json'); if (!man) throw new HttpError(400, 'الملف ليس نسخة احتياطية لهذا النظام.', 'validation');
  const m = JSON.parse(man.toString('utf8'));
  if (m.app !== 'uni-erp') throw new HttpError(400, 'الملف ليس نسخة احتياطية لهذا النظام.', 'validation');
  // قاعدة البيانات: نتحقق من بصمتها قبل أي كتابة، ثم نحفظ لقطة للوضع الحالي، ثم pg_restore
  const dump = z.get('database/database.dump');
  if (dump && m.dbSha256 && sha(dump) !== m.dbSha256) throw new HttpError(400, 'بصمة قاعدة البيانات في النسخة لا تطابق المسجّلة: النسخة تالفة أو معدَّلة.', 'validation');
  const pgUrl = databaseUrl ?? cfg.pgUrl ?? (isPgUri(cfg.dbPath) ? cfg.dbPath : process.env.DATABASE_URL);
  if (dump && !pgUrl) throw new HttpError(400, 'اضبط DATABASE_URL لاستعادة قاعدة البيانات.', 'validation');
  const dataDir = dataDirOf(cfg), stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), safe = path.join(dataDir, `pre-restore-${stamp}`);
  fs.mkdirSync(safe, { recursive: true });
  let restored = 1;
  if (dump) {
    pgDumpSync(pgUrl, path.join(safe, 'database.dump'));          // لقطة الوضع الحالي قبل الاستبدال
    const input = path.join(safe, 'restore-input.dump'); fs.writeFileSync(input, dump, { mode: 0o600 });
    pgRestoreSync(pgUrl, input); fs.unlinkSync(input); restored++;
  }
  const put = (key, rel, base) => {
    const target = path.resolve(base, rel);
    if (!inside(target, base)) throw new HttpError(400, 'مسار غير آمن في النسخة.', 'validation');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, z.get(key)); restored++;
  };
  for (const rel of z.keys()) {
    if (rel.startsWith('data/')) put(rel, rel.slice(5), dataDir);
    else if (rel.startsWith('uploads/')) put(rel, rel.slice(8), cfg.uploadDir);
  }
  return { restored, safeCopy: safe, createdAt: m.createdAt, signingKeyInBackup: (z.get('signing-key.txt') ?? Buffer.alloc(0)).toString('utf8').trim() };
}
