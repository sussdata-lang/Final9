// النسخ الاحتياطي على PostgreSQL: دورة كاملة (نسخ ← تغيير ← استعادة) مع التشفير والتحقق من التلاعب. يحتاج pg_dump/pg_restore وDATABASE_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createBackup, restoreBackup, decrypt, verifyBackup } from '../server/services/backup.js';
import { readZip, writeZip } from '../server/lib/zip.js';

let app, dir, file, before;
const count = () => app.db.prepare('SELECT COUNT(*) c FROM programs').get().c;
const marker = () => app.db.prepare("SELECT value v FROM site_settings WHERE key = 'rt_marker'").get()?.v;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-bk-'));
  app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0, backupAuto: false, backupPassphrase: 'pass-123' });
});
test.after(async () => { await app.close(); });

test('النسخة تُحفظ بجوار مسار القاعدة لا في مجلد مزيف مشتق من رابط، وتضم تفريغ PostgreSQL مشفّراً', async () => {
  assert.ok(app.cfg.backupDir.startsWith(dir));
  before = count(); assert.ok(before > 0);
  const r = await createBackup(app, { reason: 'manual' });
  assert.ok(r.encrypted && r.name.endsWith('.enc'));
  file = path.join(app.cfg.backupDir, r.name);
  const z = readZip(decrypt(fs.readFileSync(file), 'pass-123'), { maxTotal: 1 << 30, maxEntries: 1000 });
  assert.ok(z.get('database/database.dump').length > 1000, 'التفريغ الفعلي موجود (لا نص بديل)');
  assert.equal(JSON.parse(z.get('manifest.json').toString()).dbBytes, z.get('database/database.dump').length);
});

test('فحص البصمة: السليمة تنجح، وعبارة المرور الخاطئة والتفريغ المعدَّل والملف التالف تفشل، بلا كتابة', () => {
  const name = path.basename(file), good = verifyBackup(app, null, name);
  assert.equal(good.ok, true, good.message);
  assert.ok(good.dbBytes > 1000 && good.files > 1);
  assert.match(verifyBackup({ ...app, cfg: { ...app.cfg, backupPassphrase: 'wrong' } }, null, name).message, /عبارة المرور/);
  const z = readZip(decrypt(fs.readFileSync(file), 'pass-123'), { maxTotal: 1 << 30, maxEntries: 1000 });
  const put = (n, data) => { fs.writeFileSync(path.join(app.cfg.backupDir, n), data); return verifyBackup(app, null, n); };
  const tampered = put('backup-20000101-000000-bad.zip', writeZip([...z.keys()].map((k) => ({ name: k, data: k === 'database/database.dump' ? Buffer.concat([z.get(k), Buffer.from('x')]) : z.get(k) }))));
  assert.equal(tampered.ok, false); assert.match(tampered.message, /بصمة/);
  const broken = put('backup-20000101-000001-bad.zip', Buffer.from('not a zip'));
  assert.equal(broken.ok, false); assert.match(broken.message, /تالف/);
  assert.throws(() => verifyBackup(app, null, '../../t.db'), /غير موجودة/);
  for (const n of ['backup-20000101-000000-bad.zip', 'backup-20000101-000001-bad.zip']) fs.unlinkSync(path.join(app.cfg.backupDir, n));
});

test('الاستعادة تُرجع البيانات وتحفظ لقطة الوضع السابق', () => {
  app.db.prepare("INSERT INTO site_settings (key, value) VALUES ('rt_marker', 'after-backup') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  app.db.prepare('DELETE FROM programs WHERE id NOT IN (SELECT program_id FROM student_profiles) AND id NOT IN (SELECT program_id FROM courses)').run();
  assert.notEqual(count(), before); assert.equal(marker(), 'after-backup');
  const out = restoreBackup(app.cfg, file, {});
  assert.ok(fs.existsSync(path.join(out.safeCopy, 'database.dump')));
  assert.equal(count(), before); assert.equal(marker(), undefined);
});

test('عبارة مرور خاطئة أو تفريغ معدَّل: رفض قبل أي كتابة', () => {
  assert.throws(() => restoreBackup(app.cfg, file, { passphrase: 'wrong' }), /عبارة المرور/);
  const z = readZip(decrypt(fs.readFileSync(file), 'pass-123'), { maxTotal: 1 << 30, maxEntries: 1000 });
  const files = [...z.keys()].map((k) => ({ name: k, data: k === 'database/database.dump' ? Buffer.concat([z.get(k), Buffer.from('x')]) : z.get(k) }));
  const bad = path.join(dir, 'tampered.zip'); fs.writeFileSync(bad, writeZip(files));
  assert.throws(() => restoreBackup({ ...app.cfg, backupPassphrase: null }, bad, {}), /بصمة قاعدة البيانات/);
  assert.equal(count(), before);
});
