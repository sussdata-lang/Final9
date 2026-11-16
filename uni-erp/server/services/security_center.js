// مركز الأمان (SIEM داخلي): يقرأ سجل التدقيق وأحداث جدار الحماية، ويطبّق قواعد كشف دورية،
// ويرفع تنبيهات مُجمَّعة (تنبيه واحد مفتوح لكل مفتاح) تُبلَّغ لمن يملك صلاحية security:monitor،
// ويُتابَع كل تنبيه بالاستلام ثم الإغلاق بملاحظة. ويُصدَّر بصيغة NDJSON لنظام SIEM خارجي إن وُجد.
import { audit } from '../audit.js';
import { HttpError, sendRaw } from '../http.js';
import { tx } from '../db.js';
import { getSetting } from './settings.js';
import { effective } from '../permissions.js';
import { notify } from './push.js';

const bad = (msg, status = 400, code = 'validation') => new HttpError(status, msg, code);
export const SEVERITY = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' };
const RANK = { low: 1, medium: 2, high: 3, critical: 4 };
export const STATUS = { open: 'مفتوح', ack: 'قيد المتابعة', closed: 'مغلق' };
export const RULES = {
  brute_force: 'تخمين كلمات المرور من عنوان واحد',
  password_spray: 'رش كلمات المرور على حسابات متعددة',
  targeted_account: 'محاولات على حساب واحد من عناوين متعددة',
  admin_new_ip: 'دخول حساب إداري من عنوان جديد',
  admin_off_hours: 'دخول حساب إداري خارج ساعات العمل',
  mfa_change: 'تعطيل التحقق بخطوتين أو إعادة ضبطه',
  admin_account: 'إنشاء حساب إداري أو حذفه',
  priv_burst: 'تغييرات صلاحيات كثيرة من مستخدم واحد',
  export_burst: 'تصدير بيانات كثير من مستخدم واحد',
  waf_ban: 'حجب عنوان من جدار الحماية',
  grade_after_lock: 'تعديل علامة بعد إعلان نتائج المقرر وقفلها',
  grade_burst: 'تعديل علامات أو حذفها بكثرة من مستخدم واحد',
  finance_void_burst: 'إلغاءات وعكوس مالية كثيرة من مستخدم واحد',
  finance_off_hours: 'عمليات مالية حساسة خارج ساعات العمل',
  record_view_burst: 'فتح ملفات طلاب كثيرة من مستخدم واحد',
};
// رابط شاشة مركز الأمان في الإشعارات
export const SIEM_URL = '/?view=audit&tab=siem';

const FAIL = "action LIKE 'دخول مرفوض%'";
const PRIV = "(action LIKE 'إنشاء دور%' OR action LIKE 'تعديل دور%' OR action LIKE 'حذف دور%' OR action LIKE 'إنشاء حساب إداري%' OR action = 'حذف حساب إداري' OR action = 'إعادة تعيين كلمة مرور مستخدم' OR action LIKE 'تعديل صلاحيات%')";
const EXPORT = "action LIKE 'تصدير%'";
// تعديل العلامات وحذفها (الإدخال الأول لا يُعد، فهو عمل المدرّس المعتاد)
const GRADE_EDIT = "(action LIKE 'تعديل علامة%' OR action = 'حذف علامة')";
// ما يُبطل أثراً مالياً قائماً
const FIN_VOID = "action IN ('إلغاء استحقاق', 'إلغاء دفعة', 'إلغاء فاتورة', 'إلغاء منحة طلابية', 'عكس قيد')";
// العمليات المالية الحساسة: الإبطال، والترحيل، ومنح الحسومات
const FIN_SENSITIVE = `(${FIN_VOID} OR action = 'ترحيل قيد' OR action LIKE 'منح إعفاء%')`;
const RECORD_VIEW = "action = 'عرض ملف طالب'";
const num = (v) => Number(v ?? 0);

export function recordSecurityEvent(db, { kind, severity = 'low', ip = null, userId = null, subject = '', detail = '' }, at = Date.now()) {
  db.prepare('INSERT INTO security_events (at, kind, severity, ip, user_id, subject, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(at, kind, severity, ip, userId, String(subject).slice(0, 200), String(detail).slice(0, 500));
}

// ساعة دمشق للتوقيت المعطى
const damascusHour = (at) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Damascus', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));
const damascusDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date(at));
const FIN_ACTIONS = new Set(['إلغاء استحقاق', 'إلغاء دفعة', 'إلغاء فاتورة', 'إلغاء منحة طلابية', 'عكس قيد', 'ترحيل قيد']);
const finSensitive = (action) => FIN_ACTIONS.has(action) || action.startsWith('منح إعفاء');

function monitors(db) {
  return db.prepare("SELECT * FROM users WHERE role <> 'student' AND active = 1").all()
    .filter((u) => u.role === 'admin' || effective(db, u).includes('security:monitor')).map((u) => Number(u.id));
}

// يرفع تنبيهاً أو يحدّث المفتوح بالمفتاح نفسه. يعيد true إن أُنشئ تنبيه جديد
function raise(db, now, a) {
  const cur = db.prepare("SELECT id, count FROM security_alerts WHERE dedupe_key = ? AND status IN ('open', 'ack')").get(a.key);
  if (cur) {
    const count = a.count ?? num(cur.count) + 1;
    db.prepare('UPDATE security_alerts SET last_at = ?, count = ?, detail = ? WHERE id = ?').run(a.at ?? now, Math.max(count, num(cur.count)), a.detail.slice(0, 1000), cur.id);
    return null;
  }
  const id = Number(db.prepare(`INSERT INTO security_alerts (rule, severity, title, detail, ip, subject, dedupe_key, first_at, last_at, count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(a.rule, a.severity, a.title.slice(0, 200), a.detail.slice(0, 1000), a.ip ?? null, String(a.subject ?? '').slice(0, 200), a.key, a.first ?? a.at ?? now, a.at ?? now, a.count ?? 1).id);
  return { id, ...a };
}

// آخر إغلاق لكل مفتاح: الأحداث التي سبقته رآها المسؤول فلا تُعاد
const closedAfter = (db, key) => num(db.prepare("SELECT MAX(closed_at) AS t FROM security_alerts WHERE dedupe_key = ? AND status = 'closed'").get(key)?.t);

// deps (db وcfg) لإرسال إشعارات الدفع بعد إتمام المعاملة؛ دونها تُحفظ الإشعارات داخل الموقع فقط
export function runDetection(db, now = Date.now(), deps = null) {
  if (!getSetting(db, 'siem.enabled')) return { created: 0, skipped: true };
  const W = num(getSetting(db, 'siem.window_minutes')) * 60_000, since = now - W;
  const created = [], pushes = [];
  let reminded = 0;
  tx(db, () => {
    const push = (x) => { const r = raise(db, now, x); if (r) created.push(r); };
    const thr = (key, rows) => { const c = closedAfter(db, key); return rows.filter((r) => num(r.at) > c); };

    // 1) تخمين ورش من عنوان واحد
    const byIp = db.prepare(`SELECT ip, at, ref FROM audit_log WHERE ${FAIL} AND at > ? AND ip IS NOT NULL ORDER BY at`).all(since);
    const groups = new Map();
    for (const r of byIp) { if (!groups.has(r.ip)) groups.set(r.ip, []); groups.get(r.ip).push(r); }
    const bf = num(getSetting(db, 'siem.bruteforce_count')), spray = num(getSetting(db, 'siem.spray_users'));
    for (const [ip, all] of groups) {
      const rows = thr(`brute_force:${ip}`, all);
      if (rows.length >= bf) push({ rule: 'brute_force', severity: rows.length >= bf * 3 ? 'critical' : 'high', key: `brute_force:${ip}`, ip, subject: ip, count: rows.length, first: num(rows[0].at), at: num(rows.at(-1).at),
        title: `${rows.length} محاولة دخول فاشلة من ${ip}`, detail: `خلال ${W / 60_000} دقيقة على: ${[...new Set(rows.map((r) => r.ref))].slice(0, 8).join('، ')}` });
      const sr = thr(`password_spray:${ip}`, all), users = new Set(sr.map((r) => String(r.ref || '').toLowerCase()).filter(Boolean));
      if (users.size >= spray) push({ rule: 'password_spray', severity: 'high', key: `password_spray:${ip}`, ip, subject: ip, count: users.size, first: num(sr[0].at), at: num(sr.at(-1).at),
        title: `عنوان ${ip} جرّب ${users.size} حسابات مختلفة`, detail: `الحسابات: ${[...users].slice(0, 12).join('، ')}` });
    }

    // 2) حساب واحد من عناوين متعددة
    const byUser = new Map();
    for (const r of byIp) { const u = String(r.ref || '').toLowerCase(); if (!u) continue; if (!byUser.has(u)) byUser.set(u, []); byUser.get(u).push(r); }
    for (const [u, all] of byUser) {
      const rows = thr(`targeted_account:${u}`, all), ips = new Set(rows.map((r) => r.ip));
      if (ips.size >= 3 && rows.length >= Math.max(3, Math.ceil(bf / 2))) push({ rule: 'targeted_account', severity: 'medium', key: `targeted_account:${u}`, subject: u, count: rows.length, first: num(rows[0].at), at: num(rows.at(-1).at),
        title: `الحساب «${u}» استُهدف من ${ips.size} عناوين`, detail: `${rows.length} محاولة فاشلة من: ${[...ips].slice(0, 8).join('، ')}` });
    }

    // 3) أفعال كثيرة من مستخدم واحد ضمن النافذة: الصلاحيات، والتصدير، وتعديل العلامات، والإبطال المالي، وفتح ملفات الطلاب
    const BURSTS = [
      ['priv_burst', PRIV, 'siem.priv_burst', 'تغيير صلاحيات وحسابات', 'high'],
      ['export_burst', EXPORT, 'siem.export_burst', 'عملية تصدير', 'medium'],
      ['grade_burst', GRADE_EDIT, 'siem.grade_burst', 'تعديل أو حذف علامة', 'high'],
      ['finance_void_burst', FIN_VOID, 'siem.finance_void_burst', 'إلغاء أو عكس مالي', 'high'],
      ['record_view_burst', RECORD_VIEW, 'siem.record_view_burst', 'فتح ملف طالب', 'medium'],
    ];
    for (const [rule, cond, key, label, severity] of BURSTS) {
      const limit = num(getSetting(db, key));
      const rows = db.prepare(`SELECT actor_id, actor_label, at, action FROM audit_log WHERE ${cond} AND at > ? AND actor_id IS NOT NULL ORDER BY at`).all(since);
      const per = new Map();
      for (const r of rows) { const k = Number(r.actor_id); if (!per.has(k)) per.set(k, []); per.get(k).push(r); }
      for (const [actor, all] of per) {
        const list = thr(`${rule}:${actor}`, all);
        if (list.length >= limit) push({ rule, severity, key: `${rule}:${actor}`, subject: list[0].actor_label, count: list.length, first: num(list[0].at), at: num(list.at(-1).at),
          title: `${list[0].actor_label}: ${list.length} ${label} خلال ${W / 60_000} دقيقة`, detail: [...new Set(list.map((r) => r.action))].slice(0, 6).join('، ') });
      }
    }

    // 4) الأحداث المفردة بعد آخر صف فُحص
    const cur = db.prepare("SELECT value FROM security_cursor WHERE name = 'audit'").get();
    const from = cur ? num(cur.value) : num(db.prepare('SELECT MAX(id) AS m FROM audit_log WHERE at <= ?').get(since)?.m);
    const evs = db.prepare(`SELECT id, at, actor_id, actor_label, role, action, ref, ip FROM audit_log WHERE id > ? AND (action = 'تسجيل دخول' OR action IN ('تعطيل التحقق بخطوتين', 'إعادة ضبط التحقق بخطوتين') OR action LIKE 'إنشاء حساب إداري%' OR action = 'حذف حساب إداري' OR ${FIN_SENSITIVE}) ORDER BY id LIMIT 5000`).all(from);
    const ws = num(getSetting(db, 'siem.work_start')), we = num(getSetting(db, 'siem.work_end'));
    const seenIp = db.prepare("SELECT 1 AS x FROM audit_log WHERE action = 'تسجيل دخول' AND actor_id = ? AND ip = ? AND id < ? AND at > ? LIMIT 1");
    const anyBefore = db.prepare("SELECT 1 AS x FROM audit_log WHERE action = 'تسجيل دخول' AND actor_id = ? AND id < ? AND at > ? LIMIT 1");
    for (const e of evs) {
      const at = num(e.at);
      if (e.action === 'تسجيل دخول' && e.role === 'admin' && e.actor_id) {
        const back = at - 90 * 86400_000;
        if (e.ip && anyBefore.get(e.actor_id, e.id, back) && !seenIp.get(e.actor_id, e.ip, e.id, back))
          push({ rule: 'admin_new_ip', severity: 'medium', key: `admin_new_ip:${e.actor_id}:${e.ip}`, ip: e.ip, subject: e.actor_label, at, title: `${e.actor_label} دخل من عنوان لم يُستخدم خلال 90 يوماً: ${e.ip}`, detail: 'تحقق من أن الدخول من صاحب الحساب.' });
        const h = damascusHour(at);
        if (h < ws || h >= we) push({ rule: 'admin_off_hours', severity: 'low', key: `admin_off_hours:${e.actor_id}:${new Date(at + 3 * 3600_000).toISOString().slice(0, 10)}`, ip: e.ip, subject: e.actor_label, at,
          title: `${e.actor_label} دخل خارج ساعات العمل (الساعة ${h})`, detail: `من ${e.ip || 'عنوان غير معروف'}` });
      } else if (e.action === 'تعطيل التحقق بخطوتين' || e.action === 'إعادة ضبط التحقق بخطوتين') {
        push({ rule: 'mfa_change', severity: e.action === 'تعطيل التحقق بخطوتين' ? 'high' : 'medium', key: `mfa_change:${e.id}`, ip: e.ip, subject: e.ref || e.actor_label, at, title: `${e.action}: ${e.ref || e.actor_label}`, detail: `بواسطة ${e.actor_label}` });
      } else if (e.action.startsWith('إنشاء حساب إداري') || e.action === 'حذف حساب إداري') {
        push({ rule: 'admin_account', severity: 'medium', key: `admin_account:${e.id}`, ip: e.ip, subject: e.ref, at, title: `${e.action}${e.ref ? `: ${e.ref}` : ''}`, detail: `بواسطة ${e.actor_label}` });
      } else if (e.actor_id && finSensitive(e.action)) {
        // عملية مالية حساسة خارج ساعات العمل: تنبيه واحد لكل مستخدم في اليوم يزيد عدده
        const h = damascusHour(at);
        if (h < ws || h >= we) push({ rule: 'finance_off_hours', severity: 'medium', key: `finance_off_hours:${e.actor_id}:${damascusDay(at)}`, ip: e.ip, subject: e.actor_label, at,
          title: `${e.actor_label}: عمليات مالية حساسة خارج ساعات العمل`, detail: `آخرها «${e.action}» ${e.ref ? `(${e.ref}) ` : ''}الساعة ${h}` });
      }
    }
    const last = evs.length ? num(evs.at(-1).id) : Math.max(from, num(db.prepare('SELECT MAX(id) AS m FROM audit_log').get()?.m));
    db.prepare("INSERT INTO security_cursor (name, value) VALUES ('audit', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(evs.length === 5000 ? last : Math.max(last, from));

    // 5) حجب جدار الحماية (من جدول الأحداث)
    const wcur = num(db.prepare("SELECT value FROM security_cursor WHERE name = 'events'").get()?.value);
    const bans = db.prepare("SELECT * FROM security_events WHERE id > ? AND kind = 'waf_ban' ORDER BY id LIMIT 1000").all(wcur);
    for (const b of bans) push({ rule: 'waf_ban', severity: b.severity, key: `waf_ban:${b.ip}`, ip: b.ip, subject: b.ip, at: num(b.at), title: `جدار الحماية حجب ${b.ip}`, detail: b.detail });
    const wl = bans.length ? num(bans.at(-1).id) : wcur;
    db.prepare("INSERT INTO security_cursor (name, value) VALUES ('events', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(wl);

    // 6) تعديل علامة بعد إعلان نتائج المقرر وقفلها: من سجل تغييرات العلامات، لا من نص سجل التدقيق
    const gcur = db.prepare("SELECT value FROM security_cursor WHERE name = 'grades'").get();
    const gfrom = gcur ? num(gcur.value) : num(db.prepare('SELECT MAX(id) AS m FROM grade_changes WHERE at <= ?').get(since)?.m);
    const changes = db.prepare(`SELECT gc.id, gc.at, gc.actor_id, gc.course, gc.old_total, gc.new_total, gc.justification, u.display_name AS actor, s.student_no
      FROM grade_changes gc JOIN grades g ON g.id = gc.grade_id
      JOIN grade_locks l ON l.course_id = g.course_id AND l.academic_year = g.academic_year AND gc.at > l.locked_at
      LEFT JOIN users u ON u.id = gc.actor_id LEFT JOIN users s ON s.id = gc.student_id
      WHERE gc.id > ? ORDER BY gc.id LIMIT 2000`).all(gfrom);
    const seenChange = new Set();
    for (const g of changes) {
      if (seenChange.has(g.id)) continue;
      seenChange.add(g.id);
      const at = num(g.at), who = g.actor || 'مستخدم غير معروف';
      push({ rule: 'grade_after_lock', severity: 'high', key: `grade_after_lock:${g.actor_id ?? 0}:${g.course}:${damascusDay(at)}`, subject: who, at,
        title: `${who}: تعديل علامات «${g.course}» بعد إعلان نتائجها`,
        detail: `آخرها للطالب ${g.student_no ?? ''}: ${g.old_total ?? '—'} ← ${g.new_total ?? '—'}${g.justification ? `. التبرير: ${g.justification}` : ''}` });
    }
    const glast = changes.length === 2000 ? num(changes.at(-1).id) : Math.max(gfrom, num(db.prepare('SELECT MAX(id) AS m FROM grade_changes').get()?.m));
    db.prepare("INSERT INTO security_cursor (name, value) VALUES ('grades', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(glast);

    // الإشعارات: داخل الموقع من أدنى خطورة مضبوطة، وإشعار دفع فوري للعالية والحرجة، وتذكير ما بقي دون استلام
    const min = RANK[getSetting(db, 'siem.notify_min')] ?? 2, pmin = RANK[getSetting(db, 'siem.push_min')] ?? 3;
    const remindMs = num(getSetting(db, 'siem.remind_minutes')) * 60_000;
    const urgent = Object.keys(RANK).filter((s) => RANK[s] >= pmin);
    const due = remindMs > 0 ? db.prepare(`SELECT * FROM security_alerts WHERE status = 'open' AND reminders < ? AND severity IN (${urgent.map(() => '?').join(',')})
      AND COALESCE(reminded_at, first_at) <= ? ORDER BY id LIMIT 200`).all(MAX_REMINDERS, ...urgent, now - remindMs).filter((a) => !created.some((c) => c.id === Number(a.id))) : [];
    const toNotify = created.filter((a) => RANK[a.severity] >= min);
    if (toNotify.length || due.length) {
      const ids = monitors(db);
      const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'security_alert', ?, ?, ?, ?) ON CONFLICT DO NOTHING");
      for (const a of toNotify) {
        const text = `تنبيه أمني (${SEVERITY[a.severity]}): ${a.title}`.slice(0, 300);
        for (const u of ids) ins.run(u, a.id, text, SIEM_URL, now);
        if (RANK[a.severity] >= pmin) {
          db.prepare('UPDATE security_alerts SET reminded_at = ? WHERE id = ?').run(now, a.id);
          pushes.push({ ids, payload: { title: `تنبيه أمني ${SEVERITY[a.severity]}`, body: a.title, url: SIEM_URL, tag: `siem-${a.id}` } });
        }
      }
      // التذكير يُحدّث إشعاراً واحداً لكل تنبيه ويعيده غير مقروء، فلا تمتلئ القائمة
      const remind = db.prepare(`INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, 'security_reminder', ?, ?, ?, ?)
        ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL DO UPDATE SET text = excluded.text, at = excluded.at, read = 0`);
      for (const a of due) {
        const mins = Math.round((now - num(a.first_at)) / 60_000), text = `تذكير: تنبيه أمني ${SEVERITY[a.severity]} لم يُستلم منذ ${mins} دقيقة: ${a.title}`.slice(0, 300);
        for (const u of ids) remind.run(u, a.id, text, SIEM_URL, now);
        db.prepare('UPDATE security_alerts SET reminded_at = ?, reminders = reminders + 1 WHERE id = ?').run(now, a.id);
        pushes.push({ ids, payload: { title: 'تذكير: تنبيه أمني دون استلام', body: a.title, url: SIEM_URL, tag: `siem-${a.id}` } });
        reminded++;
      }
    }
  });
  // الدفع بعد إتمام المعاملة، فلا يصل إشعار عن تنبيه لم يُحفظ
  if (deps?.cfg) for (const p of pushes) if (p.ids.length) notify(deps, p.ids, p.payload);
  return { created: created.length, reminded, pushed: pushes.length };
}
// أقصى عدد تذكيرات للتنبيه الواحد قبل التوقف (بالتذكير كل 30 دقيقة: 6 ساعات)
const MAX_REMINDERS = 12;

/* ---------- القراءة والمتابعة ---------- */
const alertOut = (a) => ({ id: Number(a.id), rule: a.rule, ruleLabel: RULES[a.rule] ?? a.rule, severity: a.severity, severityLabel: SEVERITY[a.severity], title: a.title, detail: a.detail, ip: a.ip, subject: a.subject,
  firstAt: num(a.first_at), lastAt: num(a.last_at), count: num(a.count), status: a.status, statusLabel: STATUS[a.status], ackBy: a.ack_name ?? null, ackAt: a.ack_at ? num(a.ack_at) : null, closedBy: a.closed_name ?? null, closedAt: a.closed_at ? num(a.closed_at) : null, note: a.note });

export function listAlerts({ db }, q = {}) {
  const where = [], args = [];
  if (q.status && STATUS[q.status]) { where.push('a.status = ?'); args.push(q.status); } else if (q.status !== 'all') where.push("a.status IN ('open', 'ack')");
  if (q.severity && SEVERITY[q.severity]) { where.push('a.severity = ?'); args.push(q.severity); }
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  return db.prepare(`SELECT a.*, u1.display_name AS ack_name, u2.display_name AS closed_name FROM security_alerts a LEFT JOIN users u1 ON u1.id = a.ack_by LEFT JOIN users u2 ON u2.id = a.closed_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'ack' THEN 1 ELSE 2 END, a.last_at DESC LIMIT ${limit}`).all(...args).map(alertOut);
}

export function overview({ db }, now = Date.now()) {
  const day = now - 86400_000;
  const open = Object.fromEntries(Object.keys(SEVERITY).map((s) => [s, 0]));
  for (const r of db.prepare("SELECT severity, COUNT(*) AS n FROM security_alerts WHERE status IN ('open', 'ack') GROUP BY severity").all()) open[r.severity] = num(r.n);
  const c = (sql, ...a) => num(db.prepare(sql).get(...a)?.n);
  return {
    open,
    openTotal: Object.values(open).reduce((s, n) => s + n, 0),
    failed24h: c(`SELECT COUNT(*) AS n FROM audit_log WHERE ${FAIL} AND at > ?`, day),
    logins24h: c("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'تسجيل دخول' AND at > ?", day),
    bans24h: c("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'waf_ban' AND at > ?", day),
    alerts24h: c('SELECT COUNT(*) AS n FROM security_alerts WHERE first_at > ?', day),
    topIps: db.prepare(`SELECT ip, COUNT(*) AS n, COUNT(DISTINCT ref) AS users, MAX(at) AS last FROM audit_log WHERE ${FAIL} AND at > ? AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 10`).all(day)
      .map((r) => ({ ip: r.ip, failures: num(r.n), users: num(r.users), lastAt: num(r.last) })),
    recent: db.prepare(`SELECT at, actor_label, action, ref, ip FROM audit_log WHERE (${FAIL} OR action = 'تسجيل دخول' OR ${PRIV} OR action IN ('تعطيل التحقق بخطوتين', 'إعادة ضبط التحقق بخطوتين', 'تفعيل التحقق بخطوتين')) ORDER BY id DESC LIMIT 40`).all()
      .map((r) => ({ at: num(r.at), actor: r.actor_label, action: r.action, ref: r.ref, ip: r.ip })),
    enabled: !!getSetting(db, 'siem.enabled'),
    rules: RULES, severities: SEVERITY,
  };
}

export function updateAlert({ db }, actor, id, b = {}, ip) {
  const a = db.prepare('SELECT * FROM security_alerts WHERE id = ?').get(Number(id));
  if (!a) throw bad('التنبيه غير موجود.', 404, 'not_found');
  const action = b.action, note = String(b.note ?? '').trim().slice(0, 500), now = Date.now();
  if (action === 'ack') {
    if (a.status !== 'open') throw bad('التنبيه ليس مفتوحاً.', 409, 'state');
    db.prepare("UPDATE security_alerts SET status = 'ack', ack_by = ?, ack_at = ?, note = CASE WHEN ? = '' THEN note ELSE ? END WHERE id = ?").run(actor.id, now, note, note, a.id);
    audit(db, actor, 'استلام تنبيه أمني', `#${a.id} ${a.title}`.slice(0, 300), ip);
  } else if (action === 'close') {
    if (a.status === 'closed') throw bad('التنبيه مغلق.', 409, 'state');
    if (note.length < 5) throw bad('اكتب ملاحظة الإغلاق: ما الذي وُجد وما الذي اتُّخذ (5 أحرف على الأقل).');
    db.prepare("UPDATE security_alerts SET status = 'closed', closed_by = ?, closed_at = ?, note = ?, ack_by = COALESCE(ack_by, ?), ack_at = COALESCE(ack_at, ?) WHERE id = ?").run(actor.id, now, note, actor.id, now, a.id);
    audit(db, actor, 'إغلاق تنبيه أمني', `#${a.id} ${a.title}: ${note}`.slice(0, 300), ip);
  } else throw bad('إجراء غير معروف.');
  return alertOut(db.prepare('SELECT a.*, u1.display_name AS ack_name, u2.display_name AS closed_name FROM security_alerts a LEFT JOIN users u1 ON u1.id = a.ack_by LEFT JOIN users u2 ON u2.id = a.closed_by WHERE a.id = ?').get(a.id));
}

// تصدير NDJSON (سطر JSON لكل تنبيه) ليستورده نظام SIEM خارجي
export function exportNdjson({ db }, q = {}) {
  const since = Number(q.since) || Date.now() - 30 * 86400_000;
  const rows = db.prepare('SELECT * FROM security_alerts WHERE last_at >= ? ORDER BY id LIMIT 10000').all(since);
  return rows.map((a) => JSON.stringify({ '@timestamp': new Date(num(a.last_at)).toISOString(), event: { kind: 'alert', category: 'authentication', module: 'uni-erp', dataset: 'uni-erp.security' },
    rule: { name: a.rule, description: RULES[a.rule] ?? a.rule }, severity: a.severity, message: a.title, detail: a.detail, source: { ip: a.ip || undefined }, subject: a.subject || undefined,
    first_seen: new Date(num(a.first_at)).toISOString(), count: num(a.count), status: a.status, id: Number(a.id) })).join('\n') + (rows.length ? '\n' : '');
}

export function registerSecurityCenterRoutes(r, deps) {
  const any = (c, ...perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  r.add('GET', '/api/security/overview', (c) => { any(c, 'security:monitor', 'audit:read'); c.json(200, { ...overview(deps), canManage: c.user.can('security:monitor') }); });
  r.add('GET', '/api/security/alerts', (c) => { any(c, 'security:monitor', 'audit:read'); c.json(200, { alerts: listAlerts(deps, c.query ?? {}) }); });
  r.add('POST', '/api/security/alerts/:id', (c) => c.json(200, updateAlert(deps, any(c, 'security:monitor'), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/security/scan', (c) => { any(c, 'security:monitor'); c.json(200, runDetection(deps.db, Date.now(), deps)); });
  r.add('GET', '/api/security/export.ndjson', (c) => {
    const u = any(c, 'security:monitor');
    const body = exportNdjson(deps, c.query ?? {});
    audit(deps.db, u, 'تصدير تنبيهات مركز الأمان', `${body ? body.split('\n').length - 1 : 0} تنبيهاً`, c.ip);
    sendRaw(c.res, 200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="security-alerts.ndjson"', 'Cache-Control': 'no-store' }, body);
  });
}
