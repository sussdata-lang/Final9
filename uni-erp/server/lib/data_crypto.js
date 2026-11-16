// تشفير حقول حساسة داخل قاعدة البيانات (AES-256-GCM)، مثل أسباب التظلمات ومسوغات قراراتها.
// المفتاح من cfg.dataKey (انظر server/config.js: يُولَّد تلقائياً ويُحفظ بجوار مفتاح سجل التدقيق).
// النص المشفَّر يبدأ بـ"enc1:"؛ decryptField يعيد أي نص آخر كما هو، فلا يكسر بيانات قديمة لم تُشفَّر بعد.
import crypto from 'node:crypto';

const PREFIX = 'enc1:';
const keyOf = (cfg) => crypto.createHash('sha256').update(`data:${cfg?.dataKey ?? ''}`).digest();

export function encryptField(cfg, plain) {
  const s = plain === null || plain === undefined ? '' : String(plain);
  if (!s) return s;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(cfg), iv);
  const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function decryptField(cfg, value) {
  if (value === null || value === undefined || !String(value).startsWith(PREFIX)) return value;
  try {
    const buf = Buffer.from(String(value).slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), body = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(cfg), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch {
    return '⚠ تعذّر فك التشفير (مفتاح مفقود أو بيانات تالفة)';
  }
}

// يفكّ كل حقل مُسمّى من صف واحد، دون تغيير الحقول الأخرى
export function decryptRow(cfg, row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) if (out[f] !== undefined) out[f] = decryptField(cfg, out[f]);
  return out;
}
