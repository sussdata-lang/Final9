// أجهزة البصمة والحضور الحيوي: سجل الأجهزة بكامل تعريفها، ورقم كل موظف على الأجهزة (PIN)، واستقبال الحركات بثلاث طرق:
//   push_adms : أجهزة ZKTeco وما يوافقها ترسل تلقائياً إلى /iclock/cdata (بروتوكول ADMS) ويُعرف الجهاز برقمه التسلسلي
//   push_http : أي جهاز أو وسيط يرسل JSON إلى /api/hr/biometric/push برمز خاص بالجهاز
//   usb_import: ملف الحركات المصدَّر من الجهاز (ATTLOG) يُستورد من الشاشة
// كل حركة تُحفظ خاماً وتُطبَّق على دوام الموظف بوقتها الفعلي على الجهاز (أول حركة دخول وآخرها خروج في اليوم).
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError, sendRaw } from '../http.js';
import { dayKey } from './staffatt.js';

const bad = (m, s = 400, code = 'validation') => new HttpError(s, m, code);
export const BRANDS = ['ZKTeco', 'Suprema', 'Hikvision', 'Anviz', 'Virdi', 'Dahua', 'أخرى'];
export const COMM = { push_adms: 'إرسال تلقائي ZKTeco ADMS (iclock)', push_http: 'إرسال HTTP برمز الجهاز (JSON)', usb_import: 'تصدير ملف من الجهاز واستيراده (USB)' };
export const DIRS = { both: 'دخول وخروج', in: 'دخول فقط', out: 'خروج فقط' };
export const MODES = { fingerprint: 'بصمة الإصبع', face: 'الوجه', card: 'البطاقة', pin: 'الرقم السري', palm: 'كف اليد' };
const ONLINE_MS = 15 * 60000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const txt = (v, max, label, min = 0) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) throw bad(min ? `«${label}» من ${min} إلى ${max} حرفاً.` : `«${label}» حتى ${max} حرفاً.`);
  if (/[\x00-\x1f<>]/.test(s)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`);
  return s;
};
const optDay = (v, label) => { const s = String(v ?? '').trim(); if (!s) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`«${label}» بصيغة 2026-12-31.`); return s; };

/* ===== الأجهزة ===== */
function deviceView(r) {
  const now = Date.now(), seen = Number(r.last_sync_at) || null, online = !!seen && now - seen < ONLINE_MS, active = r.active == null ? true : !!Number(r.active);
  return {
    id: Number(r.id), code: r.device_code, name: r.name || r.location, brand: r.brand || '', model: r.model || '', serialNo: r.serial_no || '', mac: r.mac_address || '',
    ip: r.ip_address || '', port: r.port == null ? null : Number(r.port), commType: r.comm_type || 'push_adms', commLabel: COMM[r.comm_type] || COMM.push_adms,
    direction: r.direction || 'both', verifyModes: String(r.verify_modes || 'fingerprint').split(',').filter((m) => MODES[m]),
    unitId: r.unit_id == null ? null : Number(r.unit_id), unitName: r.unit_name || '', location: r.location || '', building: r.building || '', firmware: r.firmware || '',
    installedOn: r.installed_on || '', warrantyUntil: r.warranty_until || '', restrictIp: !!Number(r.restrict_ip || 0), active, notes: r.notes || '',
    hasToken: !!r.token_hash, tokenLast4: r.token_last4 || '', lastSeenAt: seen, logsSynced: Number(r.logs_synced || 0),
    online, state: !active ? 'معطّل' : online ? 'متصل' : seen ? 'غير متصل' : 'لم يتصل بعد',
  };
}
export const listDevices = (db) => db.prepare('SELECT d.*, o.name AS unit_name FROM hr_biometric_devices d LEFT JOIN org_units o ON o.id = d.unit_id ORDER BY d.device_code').all().map(deviceView);
const oneDevice = (db, id) => { const r = db.prepare('SELECT d.*, o.name AS unit_name FROM hr_biometric_devices d LEFT JOIN org_units o ON o.id = d.unit_id WHERE d.id = ?').get(Number(id)); if (!r) throw bad('الجهاز غير موجود.', 404, 'not_found'); return r; };

function deviceValues(db, b, cur = {}) {
  const pick = (k, col) => (b?.[k] !== undefined ? b[k] : cur[col]);
  const code = txt(pick('code', 'device_code'), 30, 'رمز الجهاز', 2);
  if (!/^[A-Za-z0-9._-]+$/.test(code)) throw bad('رمز الجهاز: حروف لاتينية وأرقام و . _ - فقط.');
  const commType = String(pick('commType', 'comm_type') || 'push_adms');
  if (!COMM[commType]) throw bad(`طريقة الاتصال: ${Object.values(COMM).join('، ')}.`);
  const serial = txt(pick('serialNo', 'serial_no'), 60, 'الرقم التسلسلي') || null;
  if (commType === 'push_adms' && !serial) throw bad('الرقم التسلسلي (SN) مطلوب للإرسال التلقائي ADMS: به يتعرّف النظام على الجهاز.');
  if (serial && !/^[A-Za-z0-9._-]+$/.test(serial)) throw bad('الرقم التسلسلي: حروف لاتينية وأرقام فقط كما يظهر في إعدادات الجهاز.');
  const ip = txt(pick('ip', 'ip_address'), 45, 'عنوان IP');
  if (ip && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip)) throw bad('عنوان IP بصيغة 192.168.1.201.');
  const portRaw = pick('port', 'port'), port = portRaw === '' || portRaw == null ? 4370 : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('المنفذ رقم من 1 إلى 65535 (أجهزة ZKTeco عادة 4370).');
  const mac = txt(pick('mac', 'mac_address'), 17, 'عنوان MAC') || null;
  if (mac && !/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) throw bad('عنوان MAC بصيغة 00:17:61:AB:CD:EF.');
  const direction = String(pick('direction', 'direction') || 'both');
  if (!DIRS[direction]) throw bad('اتجاه الجهاز: دخول وخروج، أو دخول فقط، أو خروج فقط.');
  const modesIn = b?.verifyModes !== undefined ? (Array.isArray(b.verifyModes) ? b.verifyModes : String(b.verifyModes).split(',')) : String(cur.verify_modes || 'fingerprint').split(',');
  const modes = [...new Set(modesIn.map((m) => String(m).trim()).filter(Boolean))];
  if (!modes.length || modes.some((m) => !MODES[m])) throw bad(`طرق التحقق: ${Object.values(MODES).join('، ')} (واحدة على الأقل).`);
  const unitRaw = pick('unitId', 'unit_id'), unitId = unitRaw ? Number(unitRaw) : null;
  if (unitId && !db.prepare('SELECT 1 FROM org_units WHERE id = ?').get(unitId)) throw bad('الوحدة غير موجودة.');
  const restrictIp = !!(b?.restrictIp !== undefined ? b.restrictIp : Number(cur.restrict_ip || 0));
  if (restrictIp && !ip) throw bad('تقييد الاستقبال بعنوان IP يحتاج عنوان الجهاز.');
  return {
    device_code: code, name: txt(pick('name', 'name'), 80, 'اسم الجهاز', 2), brand: txt(pick('brand', 'brand'), 40, 'الشركة المصنّعة') || null, model: txt(pick('model', 'model'), 60, 'الطراز') || null,
    serial_no: serial, mac_address: mac, ip_address: ip, port, comm_type: commType, direction, verify_modes: modes.join(','), unit_id: unitId,
    location: txt(pick('location', 'location'), 120, 'الموقع / البوابة', 2), building: txt(pick('building', 'building'), 80, 'المبنى والطابق') || null, firmware: txt(pick('firmware', 'firmware'), 60, 'إصدار البرنامج الثابت') || null,
    installed_on: optDay(pick('installedOn', 'installed_on'), 'تاريخ التركيب'), warranty_until: optDay(pick('warrantyUntil', 'warranty_until'), 'نهاية الضمان'),
    restrict_ip: restrictIp ? 1 : 0, notes: txt(pick('notes', 'notes'), 300, 'ملاحظات') || null,
  };
}
const unique = (db, v, id = -1) => {
  if (db.prepare('SELECT 1 FROM hr_biometric_devices WHERE device_code = ? AND id != ?').get(v.device_code, id)) throw bad('رمز الجهاز مستخدم.', 409, 'conflict');
  if (v.serial_no && db.prepare('SELECT 1 FROM hr_biometric_devices WHERE serial_no = ? AND id != ?').get(v.serial_no, id)) throw bad('الرقم التسلسلي مسجَّل لجهاز آخر.', 409, 'conflict');
};
export function createDevice({ db }, actor, b, ip) {
  const v = deviceValues(db, b); unique(db, v);
  const cols = Object.keys(v), now = Date.now();
  const id = Number(db.prepare(`INSERT INTO hr_biometric_devices (${cols.join(', ')}, protocol, last_sync_at, logs_synced, status, active, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, 0, 0, 'لم يتصل بعد', 1, ?, ?) RETURNING id`)
    .get(...cols.map((k) => v[k]), COMM[v.comm_type], now, now).id);
  audit(db, actor, 'إضافة جهاز بصمة', `${v.device_code} · ${v.name}`, ip);
  return { device: deviceView(oneDevice(db, id)) };
}
export function updateDevice({ db }, actor, id, b, ip) {
  const cur = oneDevice(db, id), v = deviceValues(db, b, cur); unique(db, v, cur.id);
  const cols = Object.keys(v);
  db.prepare(`UPDATE hr_biometric_devices SET ${cols.map((k) => `${k} = ?`).join(', ')}, protocol = ?, updated_at = ? WHERE id = ?`).run(...cols.map((k) => v[k]), COMM[v.comm_type], Date.now(), cur.id);
  audit(db, actor, 'تعديل جهاز بصمة', v.device_code, ip);
  return { device: deviceView(oneDevice(db, cur.id)) };
}
export function toggleDevice({ db }, actor, id, on, ip) {
  const cur = oneDevice(db, id);
  db.prepare('UPDATE hr_biometric_devices SET active = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, Date.now(), cur.id);
  audit(db, actor, on ? 'تفعيل جهاز بصمة' : 'تعطيل جهاز بصمة', cur.device_code, ip);
  return { device: deviceView(oneDevice(db, cur.id)) };
}
export function deleteDevice({ db }, actor, id, ip) {
  const cur = oneDevice(db, id);
  if (db.prepare('SELECT 1 FROM hr_biometric_punches WHERE device_id = ? LIMIT 1').get(cur.id)) throw bad('للجهاز حركات مسجَّلة فلا يُحذف؛ عطّله بدلاً من ذلك.', 409, 'conflict');
  db.prepare('DELETE FROM hr_biometric_devices WHERE id = ?').run(cur.id);
  audit(db, actor, 'حذف جهاز بصمة', cur.device_code, ip);
  return { ok: true };
}
// رمز ربط خاص بالجهاز (للإرسال HTTP): يُعرض مرة واحدة ويُحفظ مختصَره فقط
export function issueToken({ db }, actor, id, ip) {
  const cur = oneDevice(db, id), token = `bio_${crypto.randomBytes(24).toString('base64url')}`;
  db.prepare('UPDATE hr_biometric_devices SET token_hash = ?, token_last4 = ?, updated_at = ? WHERE id = ?').run(sha(token), token.slice(-4), Date.now(), cur.id);
  audit(db, actor, 'إصدار رمز ربط لجهاز بصمة', cur.device_code, ip);
  return { token, device: deviceView(oneDevice(db, cur.id)) };
}

/* ===== رقم الموظف على الأجهزة ===== */
export function listBioUsers({ db }) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, o.name AS unit, b.pin, b.card_no, b.methods,
      (SELECT MAX(p.punched_at) FROM hr_biometric_punches p WHERE p.user_id = u.id) AS last_punch
    FROM users u LEFT JOIN org_units o ON o.id = u.unit_id LEFT JOIN hr_biometric_users b ON b.user_id = u.id
    WHERE u.role != 'student' AND u.active = 1 ORDER BY o.name, u.display_name`).all()
    .map((r) => ({ userId: Number(r.id), username: r.username, name: r.display_name, unit: r.unit ?? '', pin: r.pin ?? '', cardNo: r.card_no ?? '', methods: r.methods ?? '', lastPunch: r.last_punch ? Number(r.last_punch) : null }));
}
export function setBioUser({ db }, actor, userId, b, ip) {
  const u = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role != 'student'").get(Number(userId));
  if (!u) throw bad('الموظف غير موجود.', 404, 'not_found');
  const pin = String(b?.pin ?? '').trim();
  return tx(db, () => {
    if (!pin) { db.prepare('DELETE FROM hr_biometric_users WHERE user_id = ?').run(u.id); audit(db, actor, 'إلغاء ربط موظف بأجهزة البصمة', u.display_name, ip); return { pin: '', applied: 0 }; }
    if (!/^[0-9A-Za-z]{1,20}$/.test(pin)) throw bad('رقم الموظف على الجهاز: أرقام أو حروف لاتينية حتى 20 محرفاً كما يُسجَّل على الجهاز.');
    const other = db.prepare('SELECT u.display_name FROM hr_biometric_users b JOIN users u ON u.id = b.user_id WHERE b.pin = ? AND b.user_id != ?').get(pin, u.id);
    if (other) throw bad(`الرقم ${pin} مستخدم للموظف «${other.display_name}».`, 409, 'conflict');
    const card = txt(b?.cardNo, 30, 'رقم البطاقة') || null;
    db.prepare(`INSERT INTO hr_biometric_users (user_id, pin, card_no, methods, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT (user_id) DO UPDATE SET pin = excluded.pin, card_no = excluded.card_no, methods = excluded.methods, updated_at = excluded.updated_at`).run(u.id, pin, card, txt(b?.methods, 60, 'طرق التسجيل') || null, Date.now());
    // الحركات التي وصلت بهذا الرقم قبل ربطه تُطبَّق الآن
    const pend = db.prepare("SELECT id, punched_at FROM hr_biometric_punches WHERE pin = ? AND status = 'unmapped' ORDER BY punched_at").all(pin);
    for (const p of pend) { applyPunch(db, u.id, Number(p.punched_at)); db.prepare("UPDATE hr_biometric_punches SET user_id = ?, status = 'applied' WHERE id = ?").run(u.id, p.id); }
    audit(db, actor, 'ربط موظف بأجهزة البصمة', `${u.display_name} ← ${pin}${pend.length ? ` (طُبّقت ${pend.length} حركة سابقة)` : ''}`, ip);
    return { pin, applied: pend.length };
  });
}

/* ===== استقبال الحركات وتطبيقها ===== */
// أول حركة في اليوم دخول وآخرها خروج، بالوقت الفعلي على الجهاز (لا بوقت وصولها)
export function applyPunch(db, userId, at) {
  const day = dayKey(at), cur = db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND day = ?').get(userId, day);
  if (!cur) { db.prepare('INSERT INTO staff_attendance (user_id, day, check_in) VALUES (?,?,?)').run(userId, day, at); return; }
  const all = [Number(cur.check_in), cur.check_out == null ? null : Number(cur.check_out), at].filter((x) => x != null);
  const ci = Math.min(...all), co = Math.max(...all);
  db.prepare('UPDATE staff_attendance SET check_in = ?, check_out = ? WHERE user_id = ? AND day = ?').run(ci, co === ci ? null : co, userId, day);
}
// وقت الجهاز بتوقيت دمشق (UTC+3 ثابت منذ 2022) أو ISO بمنطقة زمنية أو رقم ملّي ثانية
export function parseTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  const t = m ? Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+03:00`) : Date.parse(s);
  return Number.isNaN(t) ? null : t;
}
const VERIFY = { 0: 'pin', 1: 'fingerprint', 2: 'card', 3: 'pin', 4: 'card', 15: 'face', 25: 'palm' };
export function ingest(db, device, records, source) {
  const now = Date.now(), out = { received: records.length, inserted: 0, applied: 0, unmapped: 0, duplicates: 0, rejected: 0 };
  tx(db, () => {
    const ins = db.prepare("INSERT INTO hr_biometric_punches (device_id, pin, punched_at, verify_mode, direction, user_id, status, source, received_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (device_id, pin, punched_at) DO NOTHING RETURNING id");
    for (const r of records) {
      const pin = String(r?.pin ?? '').trim(), at = parseTime(r?.time);
      if (!/^[0-9A-Za-z]{1,20}$/.test(pin) || at == null || at > now + 10 * 60000 || at < now - 400 * 86400000) { out.rejected++; continue; }
      const map = db.prepare('SELECT user_id FROM hr_biometric_users WHERE pin = ?').get(pin);
      const dir = r?.direction === 'in' || r?.direction === 'out' ? r.direction : device?.direction && device.direction !== 'both' ? device.direction : null;
      const row = ins.get(device?.id ?? null, pin, at, r?.verify ? String(r.verify).slice(0, 20) : null, dir, map ? Number(map.user_id) : null, map ? 'applied' : 'unmapped', source, now);
      if (!row) { out.duplicates++; continue; }
      out.inserted++;
      if (map) { applyPunch(db, Number(map.user_id), at); out.applied++; } else out.unmapped++;
    }
    if (device) db.prepare('UPDATE hr_biometric_devices SET last_sync_at = ?, logs_synced = COALESCE(logs_synced, 0) + ? WHERE id = ?').run(now, out.inserted, device.id);
  });
  return out;
}
// سطور ATTLOG كما يرسلها جهاز ZKTeco أو يصدّرها على USB: الرقم⇥الوقت⇥الحالة⇥طريقة التحقق… (وتُقبل الفاصلة أيضاً)
export function parseAttlog(text) {
  const recs = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const f = line.split(/\t|,/).map((x) => x.trim());
    if (f.length < 2 || !f[0] || !/\d{4}-\d{2}-\d{2}/.test(f[1])) continue;
    recs.push({ pin: f[0], time: f[1], direction: f[2] === '0' ? 'in' : f[2] === '1' ? 'out' : null, verify: VERIFY[Number(f[3])] ?? (f[3] || null) });
  }
  return recs;
}

/* ===== مداخل الأجهزة ===== */
const deviceBySerial = (db, sn, ip) => {
  const d = db.prepare('SELECT * FROM hr_biometric_devices WHERE serial_no = ?').get(String(sn ?? '').trim());
  if (!d || d.active === 0 || d.active === '0') return null;
  if (Number(d.restrict_ip || 0) && d.ip_address && String(ip).replace(/^::ffff:/, '') !== d.ip_address) return null;
  return d;
};
export function admsHandshake({ db }, sn, ip) {
  const d = deviceBySerial(db, sn, ip);
  if (!d) return null;
  db.prepare('UPDATE hr_biometric_devices SET last_sync_at = ? WHERE id = ?').run(Date.now(), d.id);
  return [`GET OPTION FROM: ${d.serial_no}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=30', 'Delay=10', 'TransTimes=00:00;14:05',
    'TransInterval=1', 'TransFlag=TransData AttLog', 'TimeZone=3', 'Realtime=1', 'Encrypt=None'].join('\n');
}
export function admsData({ db }, sn, table, body, ip) {
  const d = deviceBySerial(db, sn, ip);
  if (!d) return null;
  if (String(table).toUpperCase() !== 'ATTLOG') { db.prepare('UPDATE hr_biometric_devices SET last_sync_at = ? WHERE id = ?').run(Date.now(), d.id); return 'OK'; }
  const r = ingest(db, d, parseAttlog(Buffer.isBuffer(body) ? body.toString('utf8') : body), 'adms');
  return `OK: ${r.inserted}`;
}
export function admsPoll({ db }, sn, ip) {
  const d = deviceBySerial(db, sn, ip);
  if (!d) return null;
  db.prepare('UPDATE hr_biometric_devices SET last_sync_at = ? WHERE id = ?').run(Date.now(), d.id);
  return 'OK';
}
export function httpPush({ db }, token, b) {
  const d = token ? db.prepare('SELECT * FROM hr_biometric_devices WHERE token_hash = ?').get(sha(token)) : null;
  if (!d || d.active === 0 || d.active === '0') throw bad('رمز الجهاز غير صالح أو الجهاز معطّل.', 401, 'unauthorized');
  const recs = Array.isArray(b?.records) ? b.records : [];
  if (!recs.length || recs.length > 5000) throw bad('أرسل من 1 إلى 5000 حركة.');
  return ingest(db, d, recs, 'http');
}
export function importFile({ db }, actor, id, b, ip) {
  const d = oneDevice(db, id);
  const text = typeof b?.data === 'string' ? Buffer.from(b.data, 'base64').toString('utf8') : '';
  const recs = parseAttlog(text);
  if (!recs.length) throw bad('لم أجد في الملف حركات بصيغة الجهاز (الرقم ثم التاريخ والوقت في كل سطر).');
  const r = ingest(db, d, recs, 'usb');
  audit(db, actor, 'استيراد ملف حركات بصمة', `${d.device_code}: ${r.inserted} جديدة · ${r.duplicates} مكررة · ${r.unmapped} غير مربوطة`, ip);
  return r;
}
export function listPunches({ db }, q = {}) {
  const w = [], a = [];
  if (q.status === 'unmapped' || q.status === 'applied') { w.push('p.status = ?'); a.push(q.status); }
  if (Number(q.device) > 0) { w.push('p.device_id = ?'); a.push(Number(q.device)); }
  const lim = Math.min(500, Math.max(10, Number(q.limit) || 200));
  return db.prepare(`SELECT p.*, d.device_code, d.name AS device_name, u.display_name FROM hr_biometric_punches p LEFT JOIN hr_biometric_devices d ON d.id = p.device_id LEFT JOIN users u ON u.id = p.user_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.punched_at DESC LIMIT ?`).all(...a, lim)
    .map((p) => ({ id: Number(p.id), device: p.device_name || p.device_code || '', pin: p.pin, at: Number(p.punched_at), verify: p.verify_mode ?? '', direction: p.direction ?? '', employee: p.display_name ?? '', status: p.status, source: p.source }));
}
export const options = () => ({ brands: BRANDS, comm: COMM, directions: DIRS, modes: MODES });

/* ===== المسارات ===== */
export function registerBiometricRoutes(r, deps) {
  const { db } = deps;
  const M = ['hr:manage', 'staffatt:manage'], R = [...M, 'hr_emp:view', 'hr_emp:edit'];
  const need = (c, perms) => { if (!c.user || !perms.some((p) => c.user.can(p))) throw bad('لا تملك صلاحية هذا الإجراء.', 403, 'forbidden'); return c.user; };
  const text = (c, s) => sendRaw(c.res, s == null ? 404 : 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, s == null ? 'UNKNOWN DEVICE' : s);
  r.add('GET', '/api/hr/biometric', (c) => {
    need(c, R);
    const unmapped = Number(db.prepare("SELECT COUNT(*) AS n FROM hr_biometric_punches WHERE status = 'unmapped'").get().n);
    c.json(200, { devices: listDevices(db), users: listBioUsers(deps), punches: listPunches(deps, { limit: 100 }), unmapped, ...options(), host: String(c.req.headers.host ?? '') });
  });
  r.add('GET', '/api/hr/biometric/punches', (c) => { need(c, R); c.json(200, { punches: listPunches(deps, c.query ?? {}) }); });
  r.add('POST', '/api/hr/biometric/devices', (c) => c.json(201, createDevice(deps, need(c, M), c.body, c.ip)));
  r.add('PUT', '/api/hr/biometric/devices/:id', (c) => c.json(200, updateDevice(deps, need(c, M), c.params.id, c.body, c.ip)));
  r.add('POST', '/api/hr/biometric/devices/:id/toggle', (c) => c.json(200, toggleDevice(deps, need(c, M), c.params.id, c.body?.active !== false, c.ip)));
  r.add('DELETE', '/api/hr/biometric/devices/:id', (c) => c.json(200, deleteDevice(deps, need(c, M), c.params.id, c.ip)));
  r.add('POST', '/api/hr/biometric/devices/:id/token', (c) => c.json(200, issueToken(deps, need(c, M), c.params.id, c.ip)));
  r.add('POST', '/api/hr/biometric/devices/:id/import', (c) => c.json(200, importFile(deps, need(c, M), c.params.id, c.body, c.ip)), { maxBody: 12 * 1024 * 1024 });
  r.add('PUT', '/api/hr/biometric/users/:id', (c) => c.json(200, setBioUser(deps, need(c, M), c.params.id, c.body, c.ip)));
  // مداخل الأجهزة (بلا جلسة مستخدم): ZKTeco ADMS على /iclock/… (يُحوَّل إلى /api/iclock/…)، وHTTP برمز الجهاز
  r.add('GET', '/api/iclock/cdata', (c) => text(c, admsHandshake(deps, c.query?.SN, c.ip)), { auth: false });
  r.add('POST', '/api/iclock/cdata', (c) => text(c, admsData(deps, c.query?.SN, c.query?.table, c.body, c.ip)), { auth: false, raw: true, maxBody: 4 * 1024 * 1024 });
  r.add('GET', '/api/iclock/getrequest', (c) => text(c, admsPoll(deps, c.query?.SN, c.ip)), { auth: false });
  r.add('POST', '/api/iclock/devicecmd', (c) => text(c, admsPoll(deps, c.query?.SN, c.ip)), { auth: false, raw: true, maxBody: 256 * 1024 });
  r.add('POST', '/api/hr/biometric/push', (c) => c.json(200, httpPush(deps, String(c.req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''), c.body)), { auth: false, maxBody: 2 * 1024 * 1024 });
}
