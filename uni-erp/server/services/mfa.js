// التحقق بخطوتين: رمز TOTP بحسب RFC 6238، يعمل مع أي تطبيق مصادقة ولا يحتاج خدمة خارجية.
import crypto from 'node:crypto';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { qrSvg } from '../qr.js';
import { sha256, verifyPassword } from '../security.js';
import { getSetting } from './settings.js';

const STEP_SEC = 30, WINDOW = 1, DIGITS = 6, RECOVERY_COUNT = 8;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// الأدوار الحساسة: يُفرض عليها عند تفعيل الإعداد في الإنتاج
export const MFA_ROLES = new Set(['admin', 'auditor', 'head_finance', 'head_hr', 'head_it_sec', 'head_exams']);

function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } value &= (1 << bits) - 1; }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function fromBase32(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of s) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; } }
  return Buffer.from(out);
}
export function totp(secretB32, step) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', fromBase32(secretB32)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, '0');
}
const stepNow = (now = Date.now()) => Math.floor(now / 1000 / STEP_SEC);

const keyOf = (cfg) => crypto.createHash('sha256').update(`mfa:${cfg.auditKey ?? ''}`).digest();
function seal(cfg, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(cfg), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}
function open(cfg, sealed) {
  const [iv, tag, body] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(cfg), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

// يعيد خطوة الرمز إن صح ولم يُستخدم من قبل، فلا يصلح الرمز الواحد مرتين
function matchStep(secret, code, lastStep) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = stepNow();
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (s > Number(lastStep) && crypto.timingSafeEqual(Buffer.from(totp(secret, s)), Buffer.from(clean))) return s;
  }
  return null;
}
const hashRecovery = (code) => sha256(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).toString('hex');

// يطابق الرمز عند الدخول أو تعطيل الميزة: رمز التطبيق أو رمز استرداد لمرة واحدة
export function verifyCode({ db, cfg }, user, code) {
  if (!user.mfa_secret) return false;
  const step = matchStep(open(cfg, user.mfa_secret), code, user.mfa_last_step);
  if (step !== null) {
    // يقبل تحديثًا واحدًا فقط عند تزامن طلبين بالرمز نفسه
    return Number(db.prepare('UPDATE users SET mfa_last_step = ? WHERE id = ? AND mfa_last_step < ?').run(step, user.id, step).changes) === 1;
  }
  const list = JSON.parse(user.mfa_recovery_json || '[]'), hashed = hashRecovery(String(code ?? ''));
  if (!list.includes(hashed)) return false;
  db.prepare('UPDATE users SET mfa_recovery_json = ? WHERE id = ?').run(JSON.stringify(list.filter((x) => x !== hashed)), user.id);
  audit(db, user, 'استخدام رمز استرداد للتحقق بخطوتين', user.username);
  return true;
}

const enforced = (db) => process.env.DISABLE_MFA !== '1' && process.env.DEMO_MODE !== '1' && (process.env.NODE_ENV === 'production' || process.env.MFA_ENFORCE === '1') && getSetting(db, 'security.mfa_required');
export const mfaSetupRequired = (db, user) => !user.mfa_enabled && enforced(db) && (MFA_ROLES.has(user.role) || MFA_ROLES.has(user.role_key));

export function startSetup({ db, cfg }, user) {
  if (user.mfa_enabled) throw new HttpError(409, 'التحقق بخطوتين مفعّل مسبقًا.', 'conflict');
  const secret = base32(crypto.randomBytes(20));
  db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(seal(cfg, secret), user.id);
  const label = encodeURIComponent(`SUSS:${user.username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=SUSS&period=${STEP_SEC}&digits=${DIGITS}`;
  return { secret, uri, qr: qrSvg(uri) };
}
export function confirmSetup({ db, cfg }, user, code, ip) {
  const row = db.prepare('SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?').get(user.id);
  if (!row?.mfa_secret) throw new HttpError(400, 'ابدأ الإعداد أولًا.', 'validation');
  if (row.mfa_enabled) throw new HttpError(409, 'التحقق بخطوتين مفعّل مسبقًا.', 'conflict');
  const step = matchStep(open(cfg, row.mfa_secret), code, 0);
  if (step === null) throw new HttpError(400, 'الرمز غير صحيح؛ تأكد من ضبط وقت الهاتف وأعد المحاولة.', 'validation', 'code');
  const codes = Array.from({ length: RECOVERY_COUNT }, () => { const s = base32(crypto.randomBytes(5)); return `${s.slice(0, 4)}-${s.slice(4)}`; });
  db.prepare('UPDATE users SET mfa_enabled = 1, mfa_last_step = ?, mfa_recovery_json = ? WHERE id = ?').run(step, JSON.stringify(codes.map(hashRecovery)), user.id);
  audit(db, user, 'تفعيل التحقق بخطوتين', user.username, ip);
  return { enabled: true, recoveryCodes: codes };
}
export async function disableMfa(deps, user, b, ip) {
  const { db } = deps;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!row.mfa_enabled) throw new HttpError(409, 'التحقق بخطوتين غير مفعّل.', 'conflict');
  if (!enforcedAllowsDisable(db, row)) throw new HttpError(403, 'التحقق بخطوتين إلزامي لهذا الدور.', 'forbidden');
  if (!(await verifyPassword(String(b?.password ?? ''), row.password_hash)) || !verifyCode(deps, row, b?.code)) throw new HttpError(400, 'كلمة المرور أو الرمز غير صحيح.', 'validation');
  clearMfa(db, user.id);
  audit(db, user, 'تعطيل التحقق بخطوتين', user.username, ip);
  return { enabled: false };
}
const enforcedAllowsDisable = (db, u) => !(enforced(db) && (MFA_ROLES.has(u.role) || MFA_ROLES.has(u.role_key)));
export const clearMfa = (db, id) => db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_recovery_json = NULL, mfa_last_step = 0 WHERE id = ?').run(id);

// مسؤول يعيد الضبط لمن فقد هاتفه ورموزه؛ وعند الدخول التالي يُطلب الإعداد من جديد إن كان إلزاميًا
export function resetUserMfa({ db }, actor, id, ip) {
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(id));
  if (!u) throw new HttpError(404, 'المستخدم غير موجود.', 'not_found');
  if (u.id === actor.id) throw new HttpError(403, 'لا يعيد المسؤول ضبط التحقق لحسابه بنفسه.', 'forbidden');
  clearMfa(db, u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(db, actor, 'إعادة ضبط التحقق بخطوتين', u.username, ip);
  return { ok: true };
}
