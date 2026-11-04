// إبطال ما انكشف: كلمة مرور موحدة قديمة، ومفتاح التوقيع. يُشغَّلان من scripts/start-cloud.js عند ضبط متغيراتهما.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from '../security.js';
import { signingKeyFile } from '../config.js';
import { backupDirOf } from './backup.js';
import { CORE_ACCOUNTS } from './bootstrap.js';

// كل حساب ما زال يستعمل الكلمة: تُستبدل بكلمة عشوائية لا يعرفها أحد، ويُلزم بالتغيير، وتُنهى جلساته.
// يستعيد المدير الحسابات الأخرى بإعادة ضبطها من شاشة المستخدمين. النتيجة أسماء وأعداد فقط، دون أي كلمة مرور.
export async function revokePassword(db, password, scryptN) {
  const users = db.prepare('SELECT id, username, password_hash FROM users').all();
  const core = new Set(CORE_ACCOUNTS.map((a) => a.username));
  const out = { checked: users.length, revoked: 0, coreRevoked: 0 };
  for (const u of users) {
    if (!(await verifyPassword(password, u.password_hash).catch(() => false))) continue;
    const hash = await hashPassword(crypto.randomBytes(32).toString('base64url'), scryptN);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    out.revoked++;
    if (core.has(u.username)) out.coreRevoked++;
  }
  return out;
}

const ROTATION_SETTING = 'security.signing_rotation';

// مفتاح جديد وشهادة تُولَّد عند أول حاجة إليها، وحذف النسخ غير المشفرة التي تحوي القديم.
// label يمنع التكرار: بقاء المتغير مضبوطاً لا يبدل المفتاح عند كل تشغيل. الوثائق الموقعة بالمفتاح القديم تفشل في التحقق.
export function rotateSigningMaterial({ db, cfg }, label) {
  const done = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(ROTATION_SETTING);
  if (done && done.value === label) return { skipped: true };
  const keyFile = signingKeyFile(cfg);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.rmSync(path.join(path.dirname(keyFile), 'pki', 'signing.pem'), { force: true });
  if (cfg.dataDir) fs.rmSync(path.join(cfg.dataDir, 'pki', 'signing.pem'), { force: true });
  const dir = backupDirOf(cfg);
  let backupsRemoved = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (/^backup-.*\.zip$/.test(f)) { fs.rmSync(path.join(dir, f), { force: true }); backupsRemoved++; }
    }
  }
  db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(ROTATION_SETTING, label);
  return { skipped: false, backupsRemoved };
}
