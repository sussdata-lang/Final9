// تشفير النسخة الاحتياطية، منفصل كي يستعمله خيط النسخ دون تحميل بقية الخدمات
import crypto from 'node:crypto';

const MAGIC = Buffer.from('UEB1');

export function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(pass, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
