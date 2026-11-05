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
// مع تعدد العمليات تُجمع العدادات كل ثانية في القاعدة، فيصير الحد على الموقع كله لا على كل عملية
const clustered = () => Number(process.env.WEB_CONCURRENCY || 1) > 1;
const rateOthers = new Map(), ratePending = new Map(), rateOwn = new Map();
function sharedCount(key, windowMs, now) {
  if (!clustered()) return 0;
  const k = `${key}|${Math.floor(now / windowMs)}`;
  ratePending.set(k, (ratePending.get(k) || 0) + 1);
  return rateOthers.get(k) || 0;
}
export function takeRateDeltas() {
  const out = [...ratePending.entries()];
  ratePending.clear();
  for (const [k, n] of out) rateOwn.set(k, (rateOwn.get(k) || 0) + n);
  return out;
}
export function applyRateTotals(rows) {
  for (const r of rows) rateOthers.set(r.key, Math.max(0, Number(r.count) - (rateOwn.get(r.key) || 0)));
  if (rateOwn.size > 20000) { rateOwn.clear(); rateOthers.clear(); }
}

export class RateLimiter {
  constructor() { this.hits = new Map(); }
  check(key, limit, windowMs) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) { const aligned = clustered() ? (Math.floor(now / windowMs) + 1) * windowMs : now + windowMs; e = { count: 0, resetAt: aligned }; this.hits.set(key, e); }
    e.count++;
    const others = sharedCount(key, windowMs, now);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    return e.count + others <= limit;
  }
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
// الحد لكل مستخدم بعد الدخول، ولكل عنوان قبله: الجامعة قد تخرج كلها من عنوان واحد فلا يوقف مستخدم واحد الجميع.
// RATE_IP_MAX سقف للعنوان كله في الدقيقة، يحمي من الإغراق وفيه متسع لحرم كامل.
const IP_CEILING = Number(process.env.RATE_IP_MAX ?? 120_000);
const tieredBuckets = new Map(); // المفتاح ← { start, count }: عدّاد نافذة ثابتة، لا سجل لكل طلب
export const resetTieredRateLimit = () => tieredBuckets.clear();
function bump(key, windowMs, now) {
  let b = tieredBuckets.get(key);
  const start = clustered() ? Math.floor(now / windowMs) * windowMs : now;
  if (!b || now - b.start >= windowMs) { b = { start, count: 0 }; tieredBuckets.set(key, b); }
  return ++b.count + sharedCount(key, windowMs, now);
}

// سقف العنوان: يُفحص قبل قراءة الجلسة، فرمز مزور لا يصل إلى القاعدة بلا حد
export function checkIpCeiling(req, ceiling = IP_CEILING) {
  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  if (isTrustedIp(ip)) return { limited: false };
  return bump(`ceiling:${ip}`, 60_000, Date.now()) > ceiling ? { limited: true, rule: 'ip', retryAfter: 60 } : { limited: false };
}

export function checkTieredRateLimit(req, userId = null) {
  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  if (userId == null && isTrustedIp(ip)) return { limited: false };
  const who = userId != null ? `u${userId}` : ip, now = Date.now();
  for (const rule of TIERED_RULES) {
    if (!rule.pattern.test(req.url)) continue;
    if (rule.methods && !rule.methods.includes(req.method)) continue;
    const count = bump(`${rule.key}:${who}`, rule.windowMs, now);
    if (count > rule.max) return { limited: true, rule: rule.key, retryAfter: Math.ceil(rule.windowMs / 1000), count };
    return { limited: false };
  }
  return { limited: false };
}

// ============================================================
// تنظيف دوري
// ============================================================
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of tieredBuckets) if (now - b.start > 180_000) tieredBuckets.delete(k);
}, 5 * 60_000).unref();
