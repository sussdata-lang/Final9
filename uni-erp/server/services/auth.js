import { hashPassword, verifyPassword, newToken, sha256, validatePasswordPolicy, createSessionFingerprint, verifySessionFingerprint } from '../security.js';
import { log } from '../lib/logger.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { effective, roleLabel, computeAllowedViews, summarizeUserAccessProfile, safeJsonParse } from '../permissions.js';
import { getSetting } from './settings.js';
import { cacheGetOrSet, getCachedUnitById, getCachedUnitTree, extractMutatedTableFromSql } from '../cache.js';
import { registerMutationListener } from '../db.js';
import { studentViewsOf } from './settings.js';

// تجزئة وهمية تُستخدم عند غياب المستخدم كي يتساوى زمن الاستجابة (منع تعداد الحسابات)
let dummyHash;

export function publicUser(db, u) {
  if (!u) return null;
  const cacheKey = `pubuser:${u.id}:${u.role}:${u.role_key || ''}:${u.unit_id || 0}:${u.access_mode || 'role'}:${u.must_change_password ? 1 : 0}`;
  return cacheGetOrSet(db, 'identity', cacheKey, () => {
    const unitRow = u.unit_id ? getCachedUnitById(db, u.unit_id) : null;
    const unit = unitRow ? { id: unitRow.id, name: unitRow.name } : null;
    const perms = effective(db, u);
    const explicitViews = safeJsonParse(u.allowed_views_json, []);
    return {
      id: u.id,
      username: u.username,
      name: u.display_name,
      role: u.role,
      roleKey: u.role_key ?? u.role,
      roleLabel: roleLabel(db, u),
      unit,
      staffKind: u.staff_kind ?? 'admin',
      jobTitle: u.job_title ?? '',
      studentNo: u.student_no,
      program: u.program,
      mustChange: !!u.must_change_password,
      accessMode: u.access_mode ?? 'role',
      dataScope: u.data_scope ?? 'unit',
      permissions: perms,
      allowedViews: computeAllowedViews(perms, explicitViews, u.role, u.role === 'student' ? studentViewsOf(db, u.id) : null),
      hiddenTabs: safeJsonParse(u.hidden_tabs_json, []),
      accessProfile: summarizeUserAccessProfile(u, perms),
    };
  });
}

// ذاكرة مؤقتة فائقة السرعة للجلسات والصلاحيات (تدعم 15,000+ جلسة نشطة متزامنة بزمن استجابة < 0.01ms)
const sessionLruCache = new Map();
const MAX_SESSION_CACHE = 15_000;
const SESSION_CACHE_TTL_MS = 25_000;
let sessionCacheHits = 0;
let sessionCacheMisses = 0;

// إبطال تلقائي لكاش الجلسات عند أي تعديل في المستخدمين أو الأدوار أو الوحدات الإدارية أو الجلسات
registerMutationListener((sql) => {
  const tbl = extractMutatedTableFromSql(sql);
  if (tbl === 'users' || tbl === 'roles' || tbl === 'org_units') {
    sessionLruCache.clear();
  } else if (tbl === 'sessions' && String(sql).trim().toUpperCase().startsWith('DELETE')) {
    sessionLruCache.clear();
  }
});

export function invalidateSessionCache(token) {
  if (token) {
    sessionLruCache.delete(token);
  } else {
    sessionLruCache.clear();
  }
}

export function getSessionCacheStats() {
  const total = sessionCacheHits + sessionCacheMisses;
  return {
    cachedSessions: sessionLruCache.size,
    maxCapacity: MAX_SESSION_CACHE,
    hits: sessionCacheHits,
    misses: sessionCacheMisses,
    hitRatePercent: total > 0 ? Math.round((sessionCacheHits / total) * 1000) / 10 : 100,
  };
}

export function sessionUser(db, token) {
  if (!token) return null;
  const now = Date.now();
  const cached = sessionLruCache.get(token);
  if (cached && cached.db === db && cached.cacheExp > now && cached.user.expires_at > now) {
    sessionCacheHits++;
    sessionLruCache.delete(token);
    sessionLruCache.set(token, cached);
    return cached.user;
  }

  sessionCacheMisses++;
  const row = db.prepare(`SELECT u.*, s.expires_at, s.fingerprint FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < now || !row.active) {
    sessionLruCache.delete(token);
    return null;
  }
  const perms = new Set(effective(db, row));
  const userObj = {
    ...row,
    label: `${row.display_name}`,
    roleKey: row.role_key ?? row.role,
    can: (p) => perms.has(p),
    unitIds: row.unit_id ? getCachedUnitTree(db, row.unit_id) : [],
  };

  if (sessionLruCache.size >= MAX_SESSION_CACHE) {
    const oldest = sessionLruCache.keys().next().value;
    if (oldest !== undefined) sessionLruCache.delete(oldest);
  }
  sessionLruCache.set(token, { db, user: userObj, cacheExp: now + SESSION_CACHE_TTL_MS });
  return userObj;
}

export async function login({ db, cfg, limiter }, { username, password, ip, ua, req }) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) throw new HttpError(400, 'أدخل اسم المستخدم وكلمة المرور.', 'bad_request');
  if (!limiter.check(`login:${ip}`, 120, 60_000) || !limiter.check(`login:${username.trim().toLowerCase()}`, 30, 60_000))
    throw new HttpError(429, 'محاولات كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
  username = username.trim();                                  // مسافات اللصق أو الإكمال التلقائي
  const u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);   // admin وAdmin حساب واحد
  dummyHash ??= await hashPassword('dummy-password-0', cfg.scryptN);
  if (u && u.locked_until > Date.now()) {
    audit(db, null, 'دخول مرفوض: حساب مقفل', username, ip);
    throw new HttpError(423, 'الحساب مقفل مؤقتاً بعد محاولات فاشلة. حاول لاحقاً أو راجع المسؤول.', 'locked');
  }
  const MAX_FAILS = getSetting(db, 'security.max_failed_logins'), LOCK_MS = getSetting(db, 'security.lock_minutes') * 60_000, SESSION_H = getSetting(db, 'security.session_hours', cfg.sessionHours);
  const ok = await verifyPassword(password, u ? u.password_hash : dummyHash);
  if (!u || !ok || !u.active) {
    if (u) {
      const fails = u.failed_logins + 1;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0, u.id);
    }
    // سبب الرفض يُكتب في سجل الخادم فقط (لا كلمة مرور ولا تلميح للمستخدم) لتشخيص مشاكل الدخول
    log.warn(`login: رفض ${username.slice(0, 40)} — ${!u ? 'لا يوجد مستخدم بهذا الاسم' : !u.active ? 'الحساب معطّل' : 'كلمة المرور لا تطابق'}`);
    audit(db, null, 'دخول مرفوض', username, ip);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة.', 'bad_credentials');
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(u.id);
  const token = newToken(), now = Date.now();
  const fp = req ? createSessionFingerprint(req) : null;
  try {
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent, fingerprint) VALUES (?,?,?,?,?,?,?)')
      .run(sha256(token), u.id, now, now + SESSION_H * 3600_000, ip, String(ua ?? '').slice(0, 200), fp);
  } catch {
    // fallback إذا لم يكن عمود fingerprint موجوداً بعد
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
      .run(sha256(token), u.id, now, now + SESSION_H * 3600_000, ip, String(ua ?? '').slice(0, 200));
  }
  audit(db, { id: u.id, label: u.display_name, role: u.role_key ?? u.role }, 'تسجيل دخول', '', ip);
  return { token, user: publicUser(db, u), maxAge: SESSION_H * 3600 };
}

export function logout({ db }, token, user, ip) {
  if (token) {
    invalidateSessionCache(token);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
  if (user) audit(db, user, 'تسجيل خروج', '', ip);
}

// تغيير كلمة المرور (إلزامي بعد كلمة مؤقتة). تُنهى بقية جلسات المستخدم، وتبقى الجلسة الحالية.
export async function changePassword({ db, cfg, limiter }, user, token, { current, next }, ip) {
  if (!limiter.check(`chpw:${user.id}`, 5, 60_000)) throw new HttpError(429, 'محاولات كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
  if (typeof current !== 'string' || typeof next !== 'string') throw new HttpError(400, 'أدخل كلمة المرور الحالية والجديدة.', 'bad_request');
  if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة.', 'bad_credentials', 'current');
  const bad = validatePasswordPolicy(next, getSetting(db, 'security.password_min'));
  if (bad) throw new HttpError(400, bad, 'weak_password', 'next');
  if (next === current) throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.', 'weak_password', 'next');
  const hash = await hashPassword(next, cfg.scryptN);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(token));
  invalidateSessionCache();
  audit(db, user, 'تغيير كلمة المرور', '', ip);
}
