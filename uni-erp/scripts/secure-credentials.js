// إبطال ما انكشف قبل تشغيل الخادم. يقرأ من البيئة فقط ولا يطبع أي سر.
//   REVOKE_PASSWORD=...      يبطل هذه الكلمة في كل حساب ما زال يستعملها
//   ROTATE_SIGNING_KEY=اسم   يبدل مفتاح التوقيع مرة واحدة لكل اسم
// رمز الخروج 10: أُبطلت كلمة حساب أساسي، فيعيد start-cloud ضبطه كي لا يُغلق النظام على المدير.
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { revokePassword, rotateSigningMaterial } from '../server/services/credentials.js';

const cfg = loadConfig();
const db = await openDb(cfg.dbPath);
let code = 0;
const rotate = String(process.env.ROTATE_SIGNING_KEY ?? '').trim();
if (rotate) {
  if (process.env.SIGNING_KEY) console.warn('تنبيه: SIGNING_KEY مضبوط في البيئة ويتقدم على الملف؛ غيّر قيمته بنفسك ليسري المفتاح الجديد.');
  if (process.env.SIGNING_PEM) console.warn('تنبيه: SIGNING_PEM مضبوط في البيئة؛ بدّل الشهادة بنفسك.');
  const r = rotateSigningMaterial({ db, cfg }, rotate);
  console.log(r.skipped ? 'مفتاح التوقيع مبدَّل سابقاً بهذا الاسم؛ احذف ROTATE_SIGNING_KEY.' : `بُدّل مفتاح التوقيع، وحُذفت ${r.backupsRemoved} نسخة غير مشفرة. احذف ROTATE_SIGNING_KEY.`);
}
const old = String(process.env.REVOKE_PASSWORD ?? '');
if (old) {
  const r = await revokePassword(db, old, cfg.scryptN);
  console.log(`فُحص ${r.checked} حساباً، وأُبطلت الكلمة في ${r.revoked}. احذف REVOKE_PASSWORD الآن.`);
  if (r.coreRevoked) code = 10;
}
db.close();
process.exit(code);
