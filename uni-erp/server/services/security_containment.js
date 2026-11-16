// مركز الأمان: إجراءات الاحتواء اليدوية. حجب عنوان IP أو رفع حجبه، وإنهاء كل جلسات حساب مشبوه.
// الحجب اليدوي يُحفظ في security_ip_bans ويُعاد تطبيقه عند الإقلاع، لأن حالة جدار الحماية في الذاكرة فقط.
// كل إجراء لصاحب صلاحية security:monitor، ويُسجَّل في التدقيق وفي أحداث الأمان.
import net from 'node:net';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { banIp, unbanIp, applySharedBan, getWafStats } from '../waf.js';
import { isTrustedIp } from '../security.js';
import { recordSecurityEvent } from './security_center.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
const MIN_MINUTES = 5, MAX_MINUTES = 30 * 24 * 60;

const cleanIp = (v) => String(v ?? '').trim().replace(/^::ffff:/i, '');
// الخادم يرى عنوان IPv4 أحياناً بصيغة ::ffff:x.x.x.x (منفذ مزدوج)، فيُحجب بالصيغتين
const forms = (ip) => (net.isIPv4(ip) ? [ip, `::ffff:${ip}`] : [ip]);

// عند الإقلاع: إعادة تطبيق الحجب اليدوي الساري في هذه العملية
export function restoreManualBans(db, now = Date.now()) {
  const rows = db.prepare('SELECT ip, until FROM security_ip_bans WHERE until > ?').all(now);
  for (const r of rows) for (const f of forms(r.ip)) applySharedBan(f, Number(r.until));
  return rows.length;
}

export function manualBan({ db }, actor, b, requestIp) {
  const ip = cleanIp(b?.ip);
  if (!net.isIP(ip)) throw bad('عنوان IP غير صالح.');
  if (ip === cleanIp(requestIp)) throw bad('لا يمكن حجب العنوان الذي تعمل منه الآن.', 409, 'conflict');
  if (isTrustedIp(ip)) throw bad('هذا العنوان من عناوين الجامعة الموثوقة (WAF_TRUSTED_IPS)، والحجب لا يسري عليه.', 409, 'conflict');
  const minutes = Math.round(Number(b?.minutes ?? 1440));
  if (!(minutes >= MIN_MINUTES && minutes <= MAX_MINUTES)) throw bad(`مدة الحجب من ${MIN_MINUTES} دقائق إلى 30 يوماً.`);
  const reason = String(b?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (reason.length < 5) throw bad('اكتب سبب الحجب (5 أحرف على الأقل).');
  const now = Date.now(), until = now + minutes * 60_000;
  db.prepare(`INSERT INTO security_ip_bans (ip, until, reason, banned_by, banned_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (ip) DO UPDATE SET until = excluded.until, reason = excluded.reason, banned_by = excluded.banned_by, banned_at = excluded.banned_at`).run(ip, until, reason, actor.id ?? null, now);
  for (const f of forms(ip)) banIp(f, until);
  recordSecurityEvent(db, { kind: 'manual_ban', severity: 'medium', ip, userId: actor.id ?? null, subject: ip, detail: `${reason} (${minutes} دقيقة)` }, now);
  audit(db, actor, 'حجب عنوان IP يدوياً', `${ip} — ${minutes} دقيقة: ${reason}`.slice(0, 300), requestIp);
  return { ip, until };
}

export function manualUnban({ db }, actor, b, requestIp) {
  const ip = cleanIp(b?.ip);
  if (!net.isIP(ip)) throw bad('عنوان IP غير صالح.');
  const had = db.prepare('DELETE FROM security_ip_bans WHERE ip = ?').run(ip).changes > 0;
  const fs = forms(ip), live = getWafStats().bannedIps.some((x) => fs.includes(x.ip));
  for (const f of fs) unbanIp(f);
  if (!had && !live) throw bad('هذا العنوان غير محجوب.', 404, 'not_found');
  recordSecurityEvent(db, { kind: 'manual_unban', severity: 'low', ip, userId: actor.id ?? null, subject: ip, detail: 'رفع الحجب يدوياً' });
  audit(db, actor, 'رفع حجب عنوان IP', ip, requestIp);
  return { ip };
}

// المحجوب الآن: من الجدار (تلقائي أو يدوي) مع سبب الحجب اليدوي ومن قام به
export function listBans({ db }, now = Date.now()) {
  const manual = new Map(db.prepare(`SELECT b.ip, b.until, b.reason, b.banned_at, u.display_name AS by_name FROM security_ip_bans b
    LEFT JOIN users u ON u.id = b.banned_by WHERE b.until > ?`).all(now).map((r) => [r.ip, r]));
  const seen = new Set();
  const live = getWafStats().bannedIps.map((x) => ({ ...x, ip: cleanIp(x.ip) })).filter((x) => !seen.has(x.ip) && seen.add(x.ip));
  const out = live.map((x) => {
    const m = manual.get(x.ip);
    manual.delete(x.ip);
    return { ip: x.ip, manual: !!m, reason: m ? m.reason : x.reason, by: m?.by_name ?? null, bannedAt: m ? Number(m.banned_at) : x.bannedAt, until: m ? Number(m.until) : null, expiresIn: x.expiresIn };
  });
  // يدوي محفوظ لم يُطبَّق في هذه العملية بعد (نادر): يُعرض أيضاً
  for (const m of manual.values()) out.push({ ip: m.ip, manual: true, reason: m.reason, by: m.by_name, bannedAt: Number(m.banned_at), until: Number(m.until), expiresIn: null });
  return out;
}

export function endUserSessions({ db }, actor, b, requestIp) {
  const username = String(b?.username ?? '').trim();
  const reason = String(b?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!username) throw bad('أدخل اسم المستخدم.');
  if (reason.length < 5) throw bad('اكتب سبب إنهاء الجلسات (5 أحرف على الأقل).');
  const u = db.prepare('SELECT id, username, display_name FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (!u) throw bad('لا يوجد مستخدم بهذا الاسم.', 404, 'not_found');
  if (Number(u.id) === Number(actor.id)) throw bad('لإنهاء جلساتك أنت استخدم «تسجيل الخروج».', 409, 'conflict');
  const ended = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id).changes;
  recordSecurityEvent(db, { kind: 'sessions_ended', severity: 'medium', userId: Number(u.id), subject: u.username, detail: `${ended} جلسة: ${reason}` });
  audit(db, actor, 'إنهاء جلسات مستخدم', `${u.username} — ${ended} جلسة: ${reason}`.slice(0, 300), requestIp);
  return { username: u.username, name: u.display_name, ended };
}

export function registerContainmentRoutes(r, deps) {
  const { db } = deps;
  try { restoreManualBans(db); } catch (e) { console.warn('restore manual bans:', e.message); }
  const need = (c) => { if (!c.user || !c.user.can('security:monitor')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); return c.user; };
  const read = (c) => { if (!c.user || !(c.user.can('security:monitor') || c.user.can('audit:read'))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
  r.add('GET', '/api/security/bans', (c) => { read(c); c.json(200, { bans: listBans(deps) }); });
  r.add('POST', '/api/security/bans', (c) => c.json(200, manualBan(deps, need(c), c.body, c.ip)));
  r.add('POST', '/api/security/bans/unban', (c) => c.json(200, manualUnban(deps, need(c), c.body, c.ip)));
  r.add('POST', '/api/security/end-sessions', (c) => c.json(200, endUserSessions(deps, need(c), c.body, c.ip)));
}
