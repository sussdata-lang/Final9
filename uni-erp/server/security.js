import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// كلمات المرور: scrypt مع ملح عشوائي. الصيغة: scrypt$N$r$p$salt$hash
export async function hashPassword(password, N = 2 ** 15) {
  const r = 8, p = 1, salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), 32, { N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'base64'));
}

export function validatePasswordPolicy(pw, configuredMin = 10) {
  const minLen = Math.max(8, Number(configuredMin) || 10);
  if (typeof pw !== 'string' || pw.length < minLen) return `كلمة المرور يجب ألا تقل عن ${minLen} أحرف.`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'كلمة المرور يجب أن تحوي أحرفاً وأرقاماً.';
  return null;
}

// كلمة مرور مؤقتة يمكن إملاؤها: بلا أحرف ملتبسة، وتضمن حروفاً وأرقاماً (تحقق سياسة كلمات المرور)
export function tempPassword() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', ALL = L + D;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(L), pick(D), ...Array.from({ length: 10 }, () => pick(ALL))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');

// رمز التحقق من الوثيقة: أبجدية بلا حروف ملتبسة (0/O، 1/I)
export function newDocCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
  return `UV-${s.slice(0, 4)}-${s.slice(4)}`;
}

// محدِّد معدل بسيط في الذاكرة (نافذة ثابتة). في الإنتاج متعدد الخوادم يُنقل إلى مخزن مشترك.
export class RateLimiter {
  constructor() { this.hits = new Map(); }
  check(key, limit, windowMs) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; this.hits.set(key, e); }
    e.count++;
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    return e.count <= limit;
  }
}

// ============================================================
// قفل الحساب المتدرج (Progressive Account Lockout)
// ============================================================
const accountLockouts = new Map(); // username → {failures, lockedUntil, lockCount}
const LOCKOUT_DURATIONS = [15 * 60_000, 60 * 60_000, 24 * 60 * 60_000]; // 15min, 1h, 24h

export function recordLoginFailure(username) {
  const rec = accountLockouts.get(username) || { failures: 0, lockedUntil: 0, lockCount: 0 };
  rec.failures++;
  if (rec.failures >= 5) {
    const dur = LOCKOUT_DURATIONS[Math.min(rec.lockCount, LOCKOUT_DURATIONS.length - 1)];
    rec.lockedUntil = Date.now() + dur;
    rec.lockCount++;
    rec.failures = 0;
    accountLockouts.set(username, rec);
    return { locked: true, until: rec.lockedUntil, duration: dur, lockCount: rec.lockCount };
  }
  accountLockouts.set(username, rec);
  return { locked: false, remaining: 5 - rec.failures };
}

export function checkAccountLockout(username) {
  const rec = accountLockouts.get(username);
  if (!rec || rec.lockedUntil <= Date.now()) return { locked: false };
  return { locked: true, until: rec.lockedUntil, retryAfter: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
}

export function recordLoginSuccess(username) {
  const rec = accountLockouts.get(username);
  if (rec) { rec.failures = 0; rec.lockedUntil = 0; }
}

// ============================================================
// Session Fingerprinting
// ============================================================
export function createSessionFingerprint(req) {
  const ua = req.headers?.['user-agent'] || '';
  const lang = req.headers?.['accept-language'] || '';
  const ip = req.ip || req.socket?.remoteAddress || '';
  const ipPrefix = ip.split('.').slice(0, 3).join('.');
  return crypto.createHash('sha256').update(`${ua}|${lang}|${ipPrefix}`).digest('hex').slice(0, 16);
}

export function verifySessionFingerprint(req, storedFingerprint) {
  if (!storedFingerprint) return true; // جلسات قديمة بلا fingerprint — نسمح
  return createSessionFingerprint(req) === storedFingerprint;
}

// ============================================================
// Rate Limiter متعدد المستويات (Tiered)
// ============================================================
const TIERED_RULES = [
  { pattern: /^\/api\/auth\//,     max: 120, windowMs: 60_000, key: 'auth',    methods: null },
  { pattern: /^\/api\/import(-engine)?\//,  max: 300,  windowMs: 60_000, key: 'import',  methods: null },
  { pattern: /^\/api\/finance\//,  max: 200, windowMs: 60_000, key: 'finance', methods: ['POST','PUT','DELETE','PATCH'] },
  { pattern: /^\/api\//,           max: 600, windowMs: 60_000, key: 'api',     methods: null },
];
const TRUSTED_IPS = new Set(String(process.env.WAF_TRUSTED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean));
export const isTrustedIp = (ip) => TRUSTED_IPS.has(String(ip));
const tieredBuckets = new Map(); // `rule:ip` → [{time}]
export const resetTieredRateLimit = () => tieredBuckets.clear();

export function checkTieredRateLimit(req) {
  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  if (isTrustedIp(ip)) return { limited: false };
  const now = Date.now();
  for (const rule of TIERED_RULES) {
    if (!rule.pattern.test(req.url)) continue;
    if (rule.methods && !rule.methods.includes(req.method)) continue;
    const k = `${rule.key}:${ip}`;
    const times = (tieredBuckets.get(k) || []).filter((t) => now - t < rule.windowMs);
    times.push(now);
    tieredBuckets.set(k, times);
    if (times.length > rule.max) {
      return { limited: true, rule: rule.key, retryAfter: Math.ceil(rule.windowMs / 1000), count: times.length };
    }
    return { limited: false };
  }
  return { limited: false };
}

// ============================================================
// Idempotency Shield للعمليات المالية
// ============================================================
const idempotencyStore = new Map(); // key → {at, resultId}

export function checkIdempotency(key, windowMs = 300_000) {
  if (!key) return { duplicate: false };
  const rec = idempotencyStore.get(key);
  if (rec && Date.now() - rec.at < windowMs) return { duplicate: true, resultId: rec.resultId };
  return { duplicate: false };
}

export function markIdempotencyUsed(key, resultId) {
  if (key) idempotencyStore.set(key, { at: Date.now(), resultId });
}

// ============================================================
// تنظيف دوري
// ============================================================
setInterval(() => {
  const now = Date.now();
  for (const [k, times] of tieredBuckets) {
    const fresh = times.filter((t) => now - t < 180_000);
    if (!fresh.length) tieredBuckets.delete(k); else tieredBuckets.set(k, fresh);
  }
  for (const [u, rec] of accountLockouts) {
    if (rec.lockedUntil > 0 && rec.lockedUntil < now - 48 * 60 * 60_000) accountLockouts.delete(u);
  }
  const cutoff = now - 600_000;
  for (const [k, v] of idempotencyStore) if (v.at < cutoff) idempotencyStore.delete(k);
}, 5 * 60_000).unref();
