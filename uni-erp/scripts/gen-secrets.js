// يولّد قيماً عشوائية لمتغيرات البيئة ويطبعها على شاشتك فقط، ولا يكتب شيئاً على القرص.
// التشغيل: node scripts/gen-secrets.js ثم انسخ القيم إلى إعدادات الخادم.
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');

console.log(`SEED_PASSWORD=${crypto.randomBytes(18).toString('base64url')}`);
console.log(`BACKUP_PASSPHRASE=${crypto.randomBytes(32).toString('base64url')}`);
console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')}`);
