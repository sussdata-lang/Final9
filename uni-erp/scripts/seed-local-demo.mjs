// بيانات تجريبية متكاملة للمعاينة على القاعدة المحلية فقط. لا تعمل مع قاعدة بعيدة ولا في الإنتاج.
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/suss_dev DEMO_MODE=1 node scripts/seed-local-demo.mjs --confirm
// تُمسح بـ scripts/clear-added-data.mjs. القيود والفواتير والطلبات تمر بخدمات الموقع نفسها فتبقى مترابطة.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createApp } from '../server/app.js';
import { hashPassword, resetTieredRateLimit, sha256 } from '../server/security.js';
import { tx } from '../server/db.js';
import { effective } from '../server/permissions.js';

const url = process.env.DATABASE_URL ?? '';
const host = url ? new URL(url).hostname : '';
if (!process.argv.includes('--confirm') || !['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== '1') {
  console.error('يعمل محليًا فقط: قاعدة على هذا الجهاز، وDEMO_MODE=1، و--confirm.');
  process.exit(1);
}

// عشوائية ثابتة: كل تشغيل يعطي البيانات نفسها
let seedState = 20261105;
const rnd = () => { seedState = (seedState + 0x6d2b79f5) | 0; let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const DAY = 86400000, NOW = Date.now();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysAgo = (n) => dayOf(NOW - n * DAY);
const daysAhead = (n) => dayOf(NOW + n * DAY);
const YEAR = 2026, AY = '2026/2027';

const app = await createApp();
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
app.limiter.check = () => true;
const base = `http://127.0.0.1:${app.server.address().port}`;
const db = app.db;
if (Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'student'").get().c) > 50 && !process.argv.includes('--force')) {
  console.error('يوجد طلاب مسبقًا؛ فرّغ البيانات أولًا بأداة التفريغ.');
  await app.close(); process.exit(1);
}

const rows = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
const problems = [];
const section = async (name, fn) => {
  const t = Date.now();
  try { const r = await fn(); console.log(`✓ ${name}${r !== undefined ? ` (${r})` : ''} ${Math.round((Date.now() - t) / 100) / 10}ث`); }
  catch (e) { problems.push(`${name}: ${e.message}`); console.log(`✘ ${name}: ${e.message.slice(0, 200)}`); }
};
const session = (userId) => {
  const token = `seed-${userId}-${crypto.randomBytes(6).toString('hex')}`;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(sha256(token), userId, NOW + DAY, NOW);
  return `sid=${token}`;
};
const call = async (cookie, method, path, body) => {
  resetTieredRateLimit();
  const r = await fetch(base + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
};
const adminId = one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").id;
db.prepare('UPDATE users SET must_change_password = 0').run();
const admin = session(adminId);
const must = async (label, ...a) => { const r = await call(...a); if (!r.ok) problems.push(`${label}: ${r.status} ${r.json?.message ?? ''}`.slice(0, 160)); return r.ok ? r.json : null; };

const DEMO_PDF = Buffer.concat([Buffer.from('%PDF-1.4 demo '), Buffer.alloc(2000)]);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
// صورة شخصية بسيطة 96×96: خلفية ملونة ورأس وكتفان
function avatarPng(hue) {
  const size = 96, raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const head = (x - 48) ** 2 + (y - 36) ** 2 < 289, body = (x - 48) ** 2 + ((y - 104) * 0.8) ** 2 < 1296;
      const c = head || body ? [245, 240, 232] : [hue, 90, 140 - hue / 4];
      raw.set(c, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ---------- أسماء ومحتوى ---------- */
const MALE = ['أحمد', 'محمد', 'خالد', 'عمر', 'يوسف', 'حسن', 'علي', 'سامر', 'رامي', 'طارق', 'باسل', 'وائل', 'فادي', 'نور الدين', 'إبراهيم', 'ماهر', 'زياد', 'حسام', 'مازن', 'كريم', 'عبد الله', 'جهاد', 'أيمن', 'بشار', 'لؤي', 'مروان', 'قصي', 'هادي', 'غيث', 'ليث'];
const FEMALE = ['فاطمة', 'مريم', 'سارة', 'رنا', 'لينا', 'هبة', 'نور', 'ريم', 'دانا', 'سلمى', 'آية', 'لمى', 'رغد', 'ياسمين', 'هالة', 'ديما', 'رشا', 'سوسن', 'منى', 'جودي', 'تالا', 'بتول', 'روان', 'شذى', 'علا'];
const FATHER = ['محمود', 'عبد الرحمن', 'ياسر', 'نبيل', 'سليم', 'جمال', 'عدنان', 'فؤاد', 'رياض', 'بسام', 'غسان', 'منير', 'نزار', 'وليد', 'صلاح', 'توفيق', 'هشام', 'أكرم'];
const LAST = ['الخطيب', 'الحلبي', 'الشامي', 'العلي', 'الأحمد', 'النجار', 'الحمصي', 'السيد', 'المصري', 'الحسن', 'الصالح', 'القادري', 'الدمشقي', 'الجندي', 'العمر', 'الخليل', 'البكري', 'الزعبي', 'العبد الله', 'الحموي', 'الطرابلسي', 'الشهابي', 'الرفاعي', 'الكردي', 'المحمد'];
const MOTHER = ['سعاد', 'خديجة', 'نجوى', 'سميرة', 'أمل', 'وفاء', 'هدى', 'فريال', 'ليلى', 'عائشة', 'رجاء', 'ناديا'];
const GOV = [['دمشق', 'المزة'], ['ريف دمشق', 'جرمانا'], ['حلب', 'الفرقان'], ['حمص', 'الوعر'], ['حماة', 'الشريعة'], ['اللاذقية', 'الزراعة'], ['طرطوس', 'المشروع'], ['درعا', 'المحطة'], ['السويداء', 'المدينة'], ['دير الزور', 'الجورة']];
const person = (female) => ({ first: pick(female ? FEMALE : MALE), father: pick(FATHER), last: pick(LAST) });
const TOPICS = {
  cyber: ['مدخل إلى أمن المعلومات', 'أساسيات البرمجة', 'شبكات الحاسوب', 'نظم التشغيل', 'قواعد البيانات', 'التشفير التطبيقي', 'أمن الشبكات', 'اختبار الاختراق', 'التحليل الجنائي الرقمي', 'أمن تطبيقات الويب', 'هندسة البرمجيات الآمنة', 'الذكاء الاصطناعي في الأمن', 'أمن الحوسبة السحابية', 'إدارة الحوادث الأمنية', 'تحليل البرمجيات الخبيثة', 'الرياضيات المتقطعة', 'بنى المعطيات والخوارزميات', 'إدارة المخاطر السيبرانية', 'أمن إنترنت الأشياء', 'التشريعات السيبرانية', 'مراكز العمليات الأمنية', 'أمن الأنظمة المدمجة', 'الهندسة الاجتماعية', 'مشروع التخرج'],
  security: ['مدخل إلى العلوم الأمنية', 'القانون الجنائي العام', 'حقوق الإنسان', 'الأدلة الجنائية', 'علم الإجرام', 'التحقيق الجنائي', 'الأمن الوطني', 'إدارة الأزمات', 'القانون الدولي العام', 'علم النفس الجنائي', 'أمن المنشآت', 'الإحصاء التطبيقي', 'مكافحة الإرهاب', 'إدارة العمليات الأمنية', 'الاستخبارات والتحليل', 'مهارات الاتصال', 'أخلاقيات المهنة', 'منهجية البحث العلمي', 'الجريمة المنظمة', 'مشروع التخرج', 'اللغة الإنكليزية الأمنية', 'القانون الإداري', 'الأمن المجتمعي', 'الدفاع المدني'],
};
const RANKS = ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد', 'مدرس', 'مدرس مساعد'];
const PREFIX = { 1: 'HIS', 2: 'SEC', 3: 'CYB', 4: 'RES', 5: 'TIS', 6: 'TIC' };

const facs = rows('SELECT id, name, kind, code FROM faculties ORDER BY id').map((f) => ({ ...f, id: Number(f.id) }));
const programs = rows('SELECT id, name, faculty, faculty_id, years, degree FROM programs WHERE active = 1 ORDER BY id').map((p) => ({ ...p, id: Number(p.id), faculty_id: Number(p.faculty_id), years: Number(p.years) || 2 }));
const COUNT_BY_KIND = { college: 100, institute: 50, center: 20 };
const H = { students: [], courses: [], members: [] };
const HALLS = ['المدرج الكبير A1', 'المدرج الثاني A2', 'قاعة الامتحانات B1', 'قاعة المحاضرات B2', 'مخبر الحاسوب C1', 'مخبر الشبكات C2', 'قاعة الندوات D1', 'مدرج الفارابي'];

await section('إعدادات المعاينة', async () => {
  await must('القاعات', admin, 'PUT', '/api/admin/general', { values: { 'dropdowns.halls': HALLS } });
});

/* ---------- الكادر ---------- */
await section('أعضاء الهيئة التدريسية', () => {
  const units = rows("SELECT id, name FROM org_units WHERE kind <> 'university' ORDER BY id");
  tx(db, () => {
    for (let i = 0; i < 40; i++) {
      const female = chance(0.3), p = person(female), name = `د. ${p.first} ${p.last}`, rank = pick(RANKS);
      const id = ins('INSERT INTO faculty_members (name, rank, unit_id, specialty, email, phone, office_hours, office_location, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        name, rank, pick(units).id, pick([...TOPICS.cyber, ...TOPICS.security]), `member${i + 1}@suss.example`, `0944${String(100000 + i)}`, pick(['الأحد 10–12', 'الاثنين 11–13', 'الثلاثاء 9–11', 'الأربعاء 12–14']), `مبنى ${pick('ABCD'.split(''))} مكتب ${int(100, 320)}`, 'active', NOW);
      H.members.push({ id, name, rank });
    }
  });
  return H.members.length;
});

await section('المقررات', () => {
  tx(db, () => {
    for (const p of programs) {
      const pool = /سيبراني/.test(p.name) ? TOPICS.cyber : TOPICS.security;
      const levels = Math.min(p.years, 4); let n = 0;
      for (let level = 1; level <= levels; level++) for (const semester of [1, 2]) for (let k = 0; k < 4; k++) {
        const topic = pool[n % pool.length], suffix = n >= pool.length ? ` ${Math.floor(n / pool.length) + 1}` : '';
        n++;
        const m = pick(H.members), code = `${PREFIX[p.faculty_id] ?? 'GEN'}-${level}${semester}${k + 1}`;
        const id = ins('INSERT INTO courses (program_id, level, semester, name, code, hours, instructor, active, member_id) VALUES (?,?,?,?,?,?,?,1,?)', p.id, level, semester, topic + suffix, code, pick([2, 3, 3, 3, 4]), m.name, m.id);
        H.courses.push({ id, program_id: p.id, level, semester, name: topic + suffix, code, hours: 3, instructor: m.name });
      }
    }
    const prereq = db.prepare('INSERT INTO sa_course_prerequisites (course_id, prereq_course_id, min_mark) VALUES (?,?,?) ON CONFLICT DO NOTHING');
    for (const c of H.courses) if (c.level > 1 && chance(0.25)) { const before = H.courses.find((x) => x.program_id === c.program_id && x.level === c.level - 1 && x.semester === c.semester); if (before) prereq.run(c.id, before.id, pick([50, 60])); }
  });
  return H.courses.length;
});

/* ---------- الطلاب ---------- */
await section('الطلاب', async () => {
  const hash = await hashPassword('Demo-Student-Pass1!', app.cfg.scryptN);
  const insUser = db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, program, active, must_change_password, created_at) VALUES (?,?,?,'student',?,?,1,0,?)");
  const insProfile = db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, name_en, national_id, gender, birth_date, birth_place, nationality, marital_status, phone, email, governorate, city, address, hs_type, hs_year, hs_school, hs_governorate, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let serial = 0;
  tx(db, () => {
    for (const p of programs) {
      const fac = facs.find((f) => f.id === p.faculty_id), total = COUNT_BY_KIND[fac?.kind] ?? 50;
      const code = fac?.code ?? 'GEN', perYear = new Map();
      for (let i = 0; i < total; i++) {
        serial++;
        const female = chance(0.35), n = person(female), level = 1 + (i % Math.min(p.years, 4)), enrollYear = YEAR - level + 1;
        const seq = (perYear.get(enrollYear) || 0) + 1; perYear.set(enrollYear, seq);
        const no = `${code}-${enrollYear}-${String(seq + 1).padStart(4, '0')}`;
        const gov = pick(GOV), name = `${n.first} ${n.father} ${n.last}`;
        const status = i % 37 === 0 ? 'suspended' : i % 53 === 0 ? 'withdrawn' : 'active';
        const uid = Number(insUser.run(no, name, hash, no, p.name, NOW - level * 300 * DAY).lastInsertRowid);
        insProfile.run(uid, n.first, n.father, n.last, pick(MOTHER), null, `0${String(1000000000 + serial * 137)}`, female ? 'أنثى' : 'ذكر', `${enrollYear - 18}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, gov[0], 'سورية', 'أعزب', `09${int(30, 99)}${String(100000 + serial).slice(-6)}`, `student${serial}@suss.example`, gov[0], gov[1], `${gov[0]} — ${gov[1]}`, pick(['علمي', 'علمي', 'أدبي']), enrollYear - 1, 'ثانوية الشهيد', gov[0], int(170, 280), p.id, pick(['مفاضلة عامة', 'مفاضلة عامة', 'موازي']), enrollYear, 'الفصل الأول', level, status, `${n.father} ${n.last}`, 'أب', `09${int(30, 99)}${String(200000 + serial).slice(-6)}`, NOW, NOW);
        H.students.push({ id: uid, no, name, female, level, program: p, faculty: p.faculty, status });
      }
    }
  });
  const demo = one("SELECT u.id, u.student_no, u.display_name, p.program_id, p.gender, p.status FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.role = 'student' AND u.active = 1 ORDER BY u.id LIMIT 1");
  if (demo && !H.students.some((x) => x.id === Number(demo.id))) {
    const program = programs.find((p) => p.id === Number(demo.program_id)) ?? programs[0];
    H.students.unshift({ id: Number(demo.id), no: demo.student_no, name: demo.display_name, female: demo.gender === 'female', level: 2, program, faculty: program.faculty, status: 'active' });
  }
  return H.students.length;
});
const S = H.students, active = S.filter((s) => s.status === 'active');
const some = (n, list = S) => { const c = [...list]; const out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };

await section('العلامات', () => {
  let n = 0;
  const st = db.prepare('INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, practical_mark, entered_by, entered_at, workflow_status, reviewed_by, reviewed_at, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  tx(db, () => {
    for (const s of S) {
      const strength = 50 + rnd() * 40;
      for (const c of H.courses.filter((x) => x.program_id === s.program.id && x.level <= s.level)) {
        const current = c.level === s.level;
        if (current && c.semester === 2) continue;
        const mark = Math.max(20, Math.min(100, Math.round(strength + (rnd() - 0.5) * 30)));
        const practical = Math.min(30, Math.round(mark * 0.3)), wf = !current ? 'approved' : pick(['approved', 'approved', 'reviewed', 'draft']);
        const year = YEAR - (s.level - c.level);
        st.run(s.id, c.semester === 1 ? 'الفصل الأول' : 'الفصل الثاني', c.name, c.hours, mark, c.id, c.level, c.semester, `${year}/${year + 1}`, mark - practical, practical, adminId, NOW - (s.level - c.level) * 300 * DAY, wf, wf === 'draft' ? null : adminId, wf === 'draft' ? null : NOW, wf === 'approved' ? adminId : null, wf === 'approved' ? NOW : null);
        n++;
      }
    }
  });
  return n;
});

await section('الجدول والامتحانات والفئات', () => {
  let slots = 0, exams = 0;
  tx(db, () => {
    const dayUsed = new Map();
    for (const c of H.courses.filter((x) => x.semester === 1)) {
      const d = int(0, 4), start = pick([480, 570, 660, 750, 840]), hall = pick(HALLS), key = `${d}|${start}|${hall}`;
      if (dayUsed.has(key)) continue;
      dayUsed.set(key, 1);
      ins('INSERT INTO course_schedules (course_id, day, start_min, end_min, hall) VALUES (?,?,?,?,?)', c.id, d, start, start + 90, hall); slots++;
    }
    for (const c of H.courses.filter((x) => x.semester === 1 && x.level <= 2)) {
      const p = programs.find((x) => x.id === c.program_id);
      ins('INSERT INTO exam_schedules (course_code, course_name, program_name, exam_type, exam_date, start_time, end_time, hall_name, capacity, enrolled_count, proctor_name, status, created_at, academic_year, semester) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        c.code, c.name, p.name, pick(['نهائي', 'نهائي', 'نصفي']), daysAhead(int(5, 45)), '09:00', '11:00', pick(HALLS), 120, int(30, 100), pick(H.members).name, 'مجدول', NOW, AY, '1'); exams++;
    }
    for (const p of programs) for (const g of ['الفئة الأولى', 'الفئة الثانية']) {
      const gid = ins('INSERT INTO student_groups (name, kind, program_id, notes, created_at) VALUES (?,?,?,?,?)', `${g} — ${p.name}`, 'practical', p.id, 'فئة تجريبية', NOW);
      for (const s of some(18, S.filter((x) => x.program.id === p.id))) db.prepare('INSERT INTO student_group_members (group_id, student_id, added_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(gid, s.id, NOW);
    }
  });
  return `${slots} حصة، ${exams} امتحان`;
});

/* ---------- الطلبات والشكاوى ---------- */
await section('طلبات الطلاب', async () => {
  const services = (await call(session(S[0].id), 'GET', '/api/services')).json.services;
  const usable = services.filter((s) => !(s.attachments || s.slots || []).some?.((x) => x.required));
  const fill = (f) => { if (f.type === 'number') return f.min ?? 1; if (f.type === 'date') return daysAhead(20); const o = (f.options || [])[0]; return o !== undefined ? (o.value ?? o) : 'بيانات تجريبية للمعاينة'; };
  let made = 0, approved = 0, rejected = 0;
  for (const s of some(220, active)) {
    const svc = pick(usable), details = Object.fromEntries((svc.fields || []).filter((f) => f.required).map((f) => [f.name, fill(f)]));
    const r = await call(session(s.id), 'POST', '/api/requests', { service: svc.code, details });
    if (r.status !== 201) continue;
    made++;
    if (r.json.request.status !== 'review') continue;
    const u = rnd();
    if (u < 0.45) { if ((await call(admin, 'POST', `/api/requests/${r.json.request.id}/approve`, {})).ok) approved++; }
    else if (u < 0.65) { if ((await call(admin, 'POST', `/api/requests/${r.json.request.id}/reject`, { reason: pick(['البيانات غير مكتملة.', 'يرجى إرفاق الوثائق المطلوبة.', 'لا تنطبق شروط الخدمة.']) })).ok) rejected++; }
  }
  for (const s of some(35, active)) await call(session(s.id), 'POST', '/api/complaints', { subject: pick(['تأخر إصدار وثيقة', 'خطأ في الجدول', 'ملاحظة على خدمات القاعة', 'تأخر رصد علامة']), body: 'شكوى تجريبية للمعاينة، يرجى المتابعة.' });
  return `${made} طلب: ${approved} معتمد، ${rejected} مرفوض`;
});

/* ---------- طلبات الكادر الداخلية: تظهر في «طلباتي» ---------- */
await section('طلبات الكادر', async () => {
  const services = rows("SELECT code, fields_json FROM service_types WHERE enabled = 1 AND audience IN ('staff','both') AND NOT requires_attachment = 1 ORDER BY code");
  const staffUsers = rows("SELECT id FROM users WHERE role <> 'student' AND active = 1 ORDER BY id").map((u) => Number(u.id));
  const fill = (f) => { if (f.type === 'number') return f.min ?? 1; if (f.type === 'date') return daysAhead(20); const o = (f.options || [])[0]; return o !== undefined ? (o.value ?? o) : 'بيانات تجريبية للمعاينة'; };
  let n = 0;
  for (const id of staffUsers) for (let k = 0; k < 2; k++) {
    const svc = pick(services); if (!svc) break;
    const details = Object.fromEntries(JSON.parse(svc.fields_json || '[]').filter((f) => f.required).map((f) => [f.name, fill(f)]));
    if ((await call(session(id), 'POST', '/api/requests', { service: svc.code, details })).status === 201) n++;
  }
  return n;
});

/* ---------- المراسلات ---------- */
await section('المراسلات', async () => {
  const staff = rows("SELECT id FROM users WHERE role IN ('staff','admin') AND active = 1 ORDER BY id").map((u) => Number(u.id));
  const titles = ['طلب تجهيزات لمخبر الشبكات', 'إشعار بموعد مجلس الكلية', 'طلب موافقة على بند مالي', 'مذكرة صيانة القاعات', 'طلب إجازة إدارية', 'تعميم الدوام الفصلي', 'طلب استقدام محاضر', 'تقرير نشاط شهري'];
  let n = 0;
  for (let i = 0; i < 40 && staff.length > 3; i++) {
    const [creator, a1, a2] = some(3, staff);
    const r = await call(session(creator), 'POST', '/api/corr', { files: i % 2 === 0 ? [{ name: `مرفق المستند ${i + 1}.pdf`, data: DEMO_PDF.toString('base64') }] : [], title: `${pick(titles)} ${i + 1}`, subject: 'موضوع تجريبي للمعاينة', body: 'نص مستند تجريبي يوضح مسار الاعتماد والتوقيع في الديوان.', mode: pick(['parallel', 'sequential']), approvers: [a1, a2], cc: i % 3 === 0 ? [some(1, staff.filter((x) => x !== creator && x !== a1 && x !== a2))[0]] : [], send: i % 6 !== 0 });
    if (!r.ok) continue;
    n++;
    const id = r.json.doc.id;
    if (i % 6 === 0) continue;
    const u = rnd();
    if (u < 0.5) { await call(session(a1), 'POST', `/api/corr/${id}/approve`, { note: 'موافق' }); await call(session(a2), 'POST', `/api/corr/${id}/approve`, { note: 'موافق' }); }
    else if (u < 0.65) await call(session(a1), 'POST', `/api/corr/${id}/reject`, { note: 'يحتاج إلى استكمال' });
  }
  return n;
});

/* ---------- المالية ---------- */
await section('المالية: الأطراف ومراكز التكلفة وهياكل الرسوم', async () => {
  for (const [name, kind, phone] of [['شركة الشام للقرطاسية', 'supplier', '0112000001'], ['مؤسسة النور للتجهيزات', 'supplier', '0112000002'], ['دار الفجر للطباعة', 'supplier', '0112000003'], ['الشركة السورية للاتصالات', 'supplier', '0112000004'], ['مؤسسة الكهرباء', 'supplier', '0112000005'], ['وزارة التعليم العالي', 'customer', '0112000006'], ['نقابة المهندسين', 'customer', '0112000007'], ['مركز التدريب الوطني', 'customer', '0112000008'], ['شركة الأمان للاستشارات', 'customer', '0112000009'], ['جامعة دمشق', 'other', '0112000010']]) await must('طرف', admin, 'POST', '/api/finance/parties', { name, kind, phone });
  tx(db, () => { for (const [code, name] of [['CC-ADM', 'الإدارة العامة'], ['CC-SEC', 'كلية العلوم الأمنية'], ['CC-CYB', 'كلية الأمن السيبراني'], ['CC-INS', 'المعاهد'], ['CC-RES', 'البحث العلمي'], ['CC-LIB', 'المكتبة']]) db.prepare('INSERT INTO fin_cost_centers (code, name, active) VALUES (?,?,1) ON CONFLICT DO NOTHING').run(code, name); });
  for (const p of programs) for (const semester of [1, 2]) await must('هيكل', admin, 'POST', '/api/finance/fee-structures', { programId: p.id, academicYear: AY, semester, tuitionFee: /معهد/.test(p.name) ? 900000 : 1500000, registrationFee: 150000 });
});

const feeTuition = () => { const t = one("SELECT id FROM fin_fee_types WHERE kind = 'fee' AND active = 1 ORDER BY id LIMIT 1"); return Number(t.id); };
await section('المالية: فواتير الطلاب والدفعات', async () => {
  const fee = feeTuition();
  let invoices = 0, paid = 0;
  // المؤجل والموقوف والمنسحب لا تصدر عليه رسوم جديدة
  const billable = new Set(rows("SELECT user_id FROM student_profiles WHERE status = 'active'").map((x) => Number(x.user_id)));
  for (const s of S.filter((x) => billable.has(Number(x.id)))) {
    const amount = /معهد/.test(s.program.name) ? 900000 : 1500000;
    const r = await call(admin, 'POST', '/api/finance/student-invoices', { studentNo: s.no, academicYear: AY, feeTypeId: fee, totalAmount: amount, installmentsCount: 2, firstDueDay: `${YEAR}-09-15` });
    if (!r.ok) { problems.push(`فاتورة ${s.no}: ${r.json?.message}`.slice(0, 120)); continue; }
    invoices++;
    const u = rnd();
    const pay = u < 0.45 ? amount : u < 0.75 ? amount / 2 : u < 0.88 ? int(10, 40) * 10000 : 0;
    if (pay) { const ok = await call(admin, 'POST', '/api/finance/payments', { studentId: s.id, amount: pay, method: pick(['cash', 'cash', 'bank']), paidDay: daysAgo(int(1, 50)), note: 'دفعة رسوم' }); if (ok.ok) paid++; }
  }
  return `${invoices} طالب، ${paid} دفعة`;
});

await section('المالية: المنح والحسومات', async () => {
  let n = 0;
  for (const s of some(25, active)) { const r = await call(admin, 'POST', '/api/finance/discounts', { studentNo: s.no, academicYear: AY, kind: pick(['scholarship', 'sibling', 'social']), percent: pick([10, 15, 20, 25]), reason: `قرار لجنة المنح ${int(100, 400)}` }); if (r.ok) n++; }
  for (const s of some(10, active)) { const r = await call(admin, 'POST', '/api/student-affairs-suite/scholarships', { studentId: s.id, scholarshipType: pick(['merit_top', 'martyrs_kin', 'social_aid']), baseTuition: 750000, gpa: int(80, 98), note: 'منحة فصلية', academicYear: AY }); if (r.ok) n++; }
  return n;
});

await section('المالية: السندات والفواتير والقيود', async () => {
  const acc = (key) => Number(one('SELECT id FROM fin_accounts WHERE system_key = ?', key)?.id);
  const parties = rows('SELECT id, kind FROM fin_parties');
  let v = 0, inv = 0, je = 0;
  for (let i = 0; i < 30; i++) {
    const receipt = i % 2 === 0, amount = int(5, 40) * 50000;
    const r = await call(admin, 'POST', '/api/finance/vouchers', { kind: receipt ? 'receipt' : 'payment', voucherDay: daysAgo(int(1, 200)), amount, partyId: pick(parties).id, description: receipt ? `قبض إيراد خدمات ${i + 1}` : `صرف مصاريف تشغيلية ${i + 1}` });
    if (r.ok) v++;
  }
  for (let i = 0; i < 24; i++) {
    const sale = i % 2 === 0, party = pick(parties.filter((p) => (sale ? p.kind !== 'supplier' : p.kind === 'supplier')));
    const r = await call(admin, 'POST', '/api/finance/invoices', { kind: sale ? 'sale' : 'purchase', partyId: party.id, issueDay: daysAgo(int(1, 150)), issue: i % 6 !== 5, lines: [{ description: sale ? 'خدمات تدريب واستشارات' : 'توريد مستلزمات', qty: int(1, 5), unitPrice: int(2, 20) * 50000 }] });
    if (!r.ok) continue;
    inv++;
    const invoice = r.json.invoice;
    if (invoice.status === 'issued' && chance(0.6)) await call(admin, 'POST', `/api/finance/invoices/${invoice.id}/pay`, { amount: chance(0.5) ? invoice.total : Math.round(invoice.total / 2), day: daysAgo(int(0, 5)) });
  }
  for (let i = 0; i < 12; i++) {
    const amount = int(2, 20) * 50000;
    const r = await call(admin, 'POST', '/api/finance/journal', { day: daysAgo(int(1, 120)), description: `قيد تسوية ${i + 1}`, lines: [{ accountId: acc('general_exp'), debit: amount }, { accountId: acc('cash'), credit: amount }], post: i % 3 !== 0 });
    if (r.ok) je++;
  }
  return `${v} سند، ${inv} فاتورة، ${je} قيد`;
});

/* ---------- الموارد البشرية ---------- */
await section('الموظفون', async () => {
  const units = rows("SELECT id, name FROM org_units WHERE kind <> 'university' ORDER BY id");
  const positions = ['محاسب', 'أمين مستودع', 'موظف شؤون طلاب', 'مبرمج', 'مسؤول شبكات', 'أمين مكتبة', 'سكرتير', 'فني مخبر', 'مراقب دوام', 'موظف ديوان'];
  let n = 0;
  for (let i = 0; i < 50; i++) {
    const female = chance(0.4), p = person(female), unit = pick(units);
    const r = await call(admin, 'POST', '/api/hr-pro/employees', { employeeNo: `EMP-${String(1001 + i)}`, name: `${p.first} ${p.father} ${p.last}`, personalId: `EP${10000 + i}`, email: `emp${i + 1}@suss.example`, phone: `0933${String(100000 + i)}`, hireDate: daysAgo(int(120, 3000)), unitId: unit.id, department: unit.name, position: pick(positions), baseSalary: int(10, 40) * 100000, contractTypeAr: pick(['عقد مفتوح', 'دوام كامل', 'محدد المدة']), statusAr: 'نشط' });
    if (r.ok) n++; else problems.push(`موظف: ${r.json?.message}`.slice(0, 120));
  }
  db.prepare('UPDATE hr_salaries SET effective_at = ?').run(NOW - 400 * DAY);
  return n;
});
await section('الرواتب والإجازات والسلف والحضور', async () => {
  const emps = rows('SELECT id, name, employeeNo, salary_base FROM hr_employees ORDER BY id');
  let lv = 0, adv = 0, ct = 0;
  for (const e of some(30, emps)) {
    const start = daysAhead(int(-90, 60)), days = int(1, 10);
    const r = await call(admin, 'POST', '/api/hr-pro/leaves', { employeeId: e.id, leaveTypeAr: pick(['سنوية', 'مرضية', 'بدون راتب', 'عارضة']), days, startDate: start, endDate: dayOf(Date.parse(start) + days * DAY), reason: 'إجازة تجريبية' });
    if (!r.ok) continue;
    lv++;
    const u = rnd();
    if (u < 0.5) await call(admin, 'POST', `/api/hr-pro/leaves/${r.json.id}/approve`, {});
    else if (u < 0.65) await call(admin, 'POST', `/api/hr-pro/leaves/${r.json.id}/reject`, { reason: 'ضغط عمل' });
  }
  for (const e of some(15, emps)) { const r = await call(admin, 'POST', '/api/hr-pro/advances', { employeeId: e.id, amount: int(2, 10) * 100000, installmentsCount: pick([3, 6, 10]), advanceDate: daysAgo(int(5, 120)), notes: 'سلفة شخصية' }); if (r.ok) adv++; }
  for (const e of some(25, emps)) { const r = await call(admin, 'POST', '/api/hr-pro/contracts', { employeeId: e.id, contractTypeAr: pick(['دوام كامل', 'محدد المدة']), startDate: daysAgo(int(100, 700)), endDate: daysAhead(int(-30, 300)), salary: Number(e.salary_base) || 2000000 }); if (r.ok) ct++; }
  const months = ['2026-08', '2026-09', '2026-10'];
  tx(db, () => {
    for (const e of emps) for (const month of months) {
      const actual = int(20, 26), late = int(0, 5);
      db.prepare('INSERT INTO hr_monthly_attendance (employee_id, month, work_days_month, actual_days, late_days, late_hours, full_days, commitment_rate, evaluation_note, updated_at) VALUES (?,?,26,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(e.id, month, actual, late, late * 0.5, actual - late, Math.round((actual / 26) * 100), actual >= 24 ? 'ملتزم' : 'يحتاج متابعة', NOW);
    }
    for (const e of some(12, emps)) ins('INSERT INTO hr_absences (employee_id, reason, absence_days, daily_rate, total_deduction, month, month_code, status_note, created_at) VALUES (?,?,?,?,?,?,?,?,?)', e.id, 'غياب بلا عذر', int(1, 3), 70000, 140000, 'أكتوبر', '2026-10', 'تجريبي', NOW);
    for (const e of some(30, emps)) ins('INSERT INTO hr_appraisals (employee_name, department, period_label, punctuality_score, productivity_score, teamwork_score, overall_score, recommendation, evaluator_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', e.name, 'شؤون الموظفين', 'التقييم السنوي 2026', int(60, 100), int(60, 100), int(60, 100), int(60, 100), pick(['علاوة دورية', 'تدريب إضافي', 'ترقية']), 'مدير الموارد البشرية', NOW);
    for (const t of ['الأمن السيبراني للموظفين', 'مهارات الاتصال', 'إدارة الوقت', 'نظام الأرشفة', 'الإسعافات الأولية', 'Excel المتقدم', 'إعداد التقارير', 'خدمة المراجعين']) ins('INSERT INTO hr_trainings (title, trainer_name, target_department, start_date, hours_count, enrolled_count, status) VALUES (?,?,?,?,?,?,?)', t, pick(H.members).name, 'كافة الأقسام', daysAhead(int(-60, 60)), int(6, 30), int(8, 40), pick(['مخطط', 'جارٍ', 'مكتمل']));
    for (const [i, l] of ['البوابة الرئيسية', 'مبنى الإدارة', 'كلية الأمن السيبراني', 'كلية العلوم الأمنية', 'المكتبة'].entries()) ins('INSERT INTO hr_biometric_devices (device_code, location, ip_address, protocol, last_sync_at, logs_synced, status) VALUES (?,?,?,?,?,?,?)', `BIO-${i + 1}`, l, `10.0.0.${20 + i}`, 'ZKTeco', NOW - i * 3600000, int(300, 3000), 'متصل');
    for (let i = 0; i < 15; i++) { const m = pick(H.members), actual = int(12, 20); ins('INSERT INTO faculty_overload_records (instructor_name, academic_rank, faculty_name, quorum_hours, actual_teaching_hours, supervision_hours, overload_hours, hourly_rate, total_overload_pay, semester, status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', m.name, m.rank, pick(facs).name, 10, actual, 2, actual - 8, 25000, (actual - 8) * 25000, `الفصل الأول ${AY}`, 'معتمد للرواتب', NOW); }
    for (let i = 0; i < 8; i++) { const m = pick(H.members); ins('INSERT INTO faculty_promotions (faculty_name, specialty, current_rank, target_rank, research_points, required_points, teaching_years, committee_status, submitted_at) VALUES (?,?,?,?,?,?,?,?,?)', m.name, 'الأمن السيبراني', 'أستاذ مساعد', 'أستاذ مشارك', int(30, 90), 80, int(4, 15), pick(['قيد الدراسة', 'مقبول', 'مؤجل']), NOW); }
    const staff = rows("SELECT id FROM users WHERE role <> 'student' ORDER BY id LIMIT 37");
    for (const u of staff) for (let d = 1; d <= 20; d++) {
      const when = NOW - d * DAY; if ([5, 6].includes(new Date(when).getUTCDay())) continue;
      if (chance(0.9)) { const inAt = when - when % DAY + (5 + rnd()) * 3600000; db.prepare('INSERT INTO staff_attendance (user_id, day, check_in, check_out) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(u.id, dayOf(when), Math.round(inAt), Math.round(inAt + 7.5 * 3600000)); }
    }
    for (const u of staff) db.prepare('INSERT INTO leave_entitlements (user_id, year, days) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(u.id, YEAR, 21);
  });
  let posted = 0;
  for (const month of ['2026-08', '2026-09']) if ((await call(admin, 'POST', '/api/finance/payroll-entry', { month })).ok) posted++;
  return `${lv} إجازة، ${adv} سلفة، ${ct} عقد، ${posted} قيد رواتب`;
});

/* ---------- المشتريات والمخزون ---------- */
await section('المشتريات والمخزون', async () => {
  const P = '/api/procurement';
  const wh = [];
  for (const [code, name, location] of [['WH-MAIN', 'المخزن الرئيسي', 'المبنى الإداري'], ['WH-LAB', 'مخزن المختبرات', 'كلية الأمن السيبراني'], ['WH-GEN', 'مخزن اللوازم العامة', 'المبنى B']]) { const r = await must('مخزن', admin, 'POST', `${P}/warehouses`, { code, name, location }); wh.push(r?.warehouse ?? r); }
  const sups = [];
  for (let i = 0; i < 8; i++) { const r = await must('مورد', admin, 'POST', `${P}/suppliers`, { code: `SUP-${String(i + 1).padStart(2, '0')}`, name: ['شركة الشام للقرطاسية', 'مؤسسة النور للتجهيزات التقنية', 'دار الأثاث الحديث', 'شركة الأمان للشبكات', 'مكتبة الجامعة', 'مؤسسة النظافة الشاملة', 'شركة الطباعة الرقمية', 'مركز الصيانة الفني'][i], phone: `011200${1000 + i}` }); sups.push(r?.supplier ?? r); }
  const cats = (await call(admin, 'GET', `${P}/categories`)).json?.categories ?? [];
  const defs = [['ورق طباعة A4', 'رزمة', 30000], ['أقلام حبر', 'علبة', 12000], ['حبر طابعة ليزر', 'عبوة', 180000], ['حاسوب مكتبي', 'قطعة', 4500000], ['شاشة عرض', 'قطعة', 1500000], ['كرسي مكتبي', 'قطعة', 450000], ['طاولة اجتماعات', 'قطعة', 900000], ['كابل شبكة Cat6', 'لفة', 350000], ['محوّل شبكة', 'قطعة', 1100000], ['سبورة بيضاء', 'قطعة', 300000], ['ملفات أرشيف', 'علبة', 40000], ['مواد تنظيف', 'عبوة', 25000], ['بطاقات جامعية فارغة', 'علبة', 200000], ['جهاز قارئ باركود', 'قطعة', 650000], ['بطارية UPS', 'قطعة', 800000], ['دفاتر امتحانية', 'رزمة', 90000], ['ظروف رسمية', 'علبة', 30000], ['أجهزة عرض', 'قطعة', 2800000], ['لوحات مفاتيح', 'قطعة', 80000], ['فأرات حاسوب', 'قطعة', 45000]];
  const items = [];
  for (const [i, [name, unit]] of defs.entries()) { const r = await must('صنف', admin, 'POST', `${P}/items`, { code: `ITM-${String(i + 1).padStart(3, '0')}`, name, categoryId: pick(cats)?.id, unit, warehouseId: wh[i % 3]?.id, minStock: int(5, 40), maxStock: int(100, 500) }); items.push(r?.item ?? r); }
  let reqs = 0, orders = 0, receipts = 0;
  const requesterRow = one("SELECT id FROM users WHERE role = 'staff' AND role_key = 'head_procure'") ?? one("SELECT id FROM users WHERE role = 'staff' ORDER BY id LIMIT 1");
  const requester = session(Number(requesterRow.id));
  const line = (i, qty) => ({ itemId: items[i]?.id, description: defs[i][0], qty });
  // اعتماد طلب الشراء على مراحله (المشتريات ثم المالي ثم الرئاسة بحسب القيمة)، وكل مرحلة يعتمدها مستخدم مختلف يملك صلاحيتها
  // لا يحمل دور مدمج صلاحيتي الاعتماد المالي والرئاسة (يمنحهما المدير)، فتُمنحان هنا لحسابين تجريبيين
  for (const [key, perm] of [['head_finance', 'procurement:approve_finance'], ['head_admin_aff', 'procurement:approve_top']]) {
    const u = one('SELECT id, custom_permissions_json FROM users WHERE role_key = ? AND active = 1 ORDER BY id LIMIT 1', key);
    if (!u) { problems.push(`لا حساب بدور ${key} لمنحه ${perm}`); continue; }
    let cur = []; try { cur = JSON.parse(u.custom_permissions_json || '[]'); } catch { /* */ }
    if (!cur.includes(perm)) db.prepare('UPDATE users SET custom_permissions_json = ? WHERE id = ?').run(JSON.stringify([...cur, perm]), u.id);
  }
  const staffRows = rows("SELECT * FROM users WHERE role <> 'student' AND active = 1 ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id");
  const holders = (perm) => staffRows.filter((u) => effective(db, u).includes(perm)).map((u) => Number(u.id));
  const sessions = new Map();
  const approveStaged = async (id, requesterId) => {
    const used = new Set([requesterId]);
    for (let k = 0; k < 3; k++) {
      const g = (await call(admin, 'GET', `${P}/requests/${id}`)).json?.request;
      if (!g || g.status !== 'pending') return g?.status === 'approved';
      const next = g.approval?.next; if (!next) return false;
      const who = holders(next.perm).find((u) => !used.has(u));
      if (!who) { problems.push(`طلب شراء ${g.no}: لا مستخدم آخر يملك صلاحية ${next.label}`); return false; }
      used.add(who);
      if (!sessions.has(who)) sessions.set(who, session(who));
      const r = await call(sessions.get(who), 'POST', `${P}/requests/${id}/approve`, { note: 'معتمد' });
      if (!r.ok) { problems.push(`طلب شراء ${g.no}: ${r.json?.message}`.slice(0, 120)); return false; }
    }
    return (await call(admin, 'GET', `${P}/requests/${id}`)).json?.request?.status === 'approved';
  };
  for (let i = 0; i < 18; i++) {
    const idx = [int(0, 19), int(0, 19)].filter((v, k, a) => a.indexOf(v) === k);
    const r = await call(requester, 'POST', `${P}/requests`, { title: `طلب توريد ${i + 1}: ${defs[idx[0]][0]}`, description: 'طلب شراء تجريبي', warehouseId: wh[i % 3]?.id, lines: idx.map((k) => ({ ...line(k, int(5, 40)), estCost: defs[k][2] })) });
    const id = r.json?.request?.id ?? r.json?.id;
    if (!id) continue;
    reqs++;
    if (i % 6 === 5) continue;                                     // مسودة
    await call(requester, 'POST', `${P}/requests/${id}/submit`, {});
    if (i % 6 === 4) continue;                                     // قيد المراجعة
    if (i % 6 === 3) { await call(admin, 'POST', `${P}/requests/${id}/reject`, { note: 'خارج الميزانية الحالية' }); continue; }
    if (!(await approveStaged(id, Number(requesterRow.id)))) continue;
    const orderLines = idx.map((k) => ({ ...line(k, int(10, 60)), unitCost: defs[k][2] }));
    const o = await call(admin, 'POST', `${P}/orders`, { supplierId: pick(sups)?.id, requestId: id, lines: orderLines });
    const oid = o.json?.order?.id ?? o.json?.id;
    if (!oid) continue;
    orders++;
    await call(admin, 'POST', `${P}/orders/${oid}/order`, {});
    if (i % 6 !== 2 && (await call(admin, 'POST', `${P}/receipts`, { orderId: oid, note: 'استلام كامل', lines: orderLines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost })) })).ok) receipts++;
  }
  let issues = 0;
  const stocked = rows('SELECT id, warehouse_id, qty_on_hand FROM proc_items WHERE qty_on_hand > 5');
  for (const it of stocked.slice(0, 12)) if ((await call(admin, 'POST', `${P}/issues`, { warehouseId: it.warehouse_id, issuedTo: pick(['قسم شؤون الطلاب', 'كلية الأمن السيبراني', 'الديوان', 'المكتبة']), purpose: 'احتياج شهري', lines: [{ itemId: it.id, qty: 3 }] })).ok) issues++;
  const assets = [];
  for (let i = 0; i < 20; i++) { const r = await call(admin, 'POST', `${P}/assets`, { code: `AST-${String(i + 1).padStart(3, '0')}`, name: pick(['حاسوب محمول', 'جهاز عرض', 'خادم مختبر', 'طابعة ليزر', 'مكيف هواء', 'كاميرا مراقبة']), category: 'أجهزة', warehouseId: wh[i % 3]?.id, cost: int(5, 60) * 100000, purchaseDay: daysAgo(int(30, 800)) }); const a = r.json?.asset ?? r.json; if (a?.id) assets.push(a); }
  for (const a of assets.slice(0, 8)) await call(admin, 'POST', `${P}/assets/${a.id}/move`, { kind: pick(['transfer', 'maintenance']), toWarehouseId: wh[0]?.id, toUser: pick(H.members).name, reason: 'حركة تجريبية' });
  return `${reqs} طلب، ${orders} أمر، ${receipts} استلام، ${issues} صرف، ${assets.length} أصل`;
});

/* ---------- السكن ---------- */
await section('السكن', async () => {
  const rooms = rows('SELECT r.id, b.gender FROM dorm_rooms r JOIN dorm_buildings b ON b.name = r.building_name ORDER BY r.id');
  let n = 0;
  for (const s of some(90, active)) {
    const fit = rooms.filter((r) => r.gender === (s.female ? 'إناث' : 'ذكور'));
    if ((await call(admin, 'POST', '/api/housing/allocations', { student_no: s.no, room_id: pick(fit).id })).ok) n++;
  }
  const res = rows('SELECT a.student_no, a.student_name, a.faculty_name, r.building_name, r.room_no FROM dorm_allocations a JOIN dorm_rooms r ON r.id = a.room_id LIMIT 60');
  tx(db, () => { res.forEach((a, i) => ins('INSERT INTO housing_handouts (handout_no, student_no, student_name, faculty_name, room_label, items_json, note, handed_day, handed_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', `HND-${String(i + 1).padStart(4, '0')}`, a.student_no, a.student_name, a.faculty_name, `${a.building_name} — ${a.room_no}`, JSON.stringify([{ name: 'سرير', qty: 1 }, { name: 'خزانة', qty: 1 }, { name: pick(['طاولة', 'كرسي', 'كمبيوتر محمول']), qty: 1 }]), '', daysAgo(int(1, 60)), 'مشرف السكن', NOW)); });
  return `${n} ساكن`;
});

/* ---------- شؤون الطلاب ---------- */
await section('شؤون الطلاب', () => {
  tx(db, () => {
    const pIds = programs.map((p) => p.id);
    for (let i = 0; i < 60; i++) { const f = chance(0.35), n = person(f), st = pick(['pending', 'pending', 'accepted', 'rejected']); ins('INSERT INTO sa_applicants (application_no, full_name, national_id, phone, hs_type, hs_score, hs_year, category, pref1_program_id, pref2_program_id, pref3_program_id, accepted_program_id, sorting_status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', `ADM-${YEAR}-${String(101 + i)}`, `${n.first} ${n.father} ${n.last}`, `A${String(900000000 + i * 7)}`, `0955${String(100000 + i)}`, 'علمي', int(170, 280), YEAR, pick(['general', 'general', 'parallel', 'martyrs', 'transfer']), pick(pIds), pick(pIds), pick(pIds), st === 'accepted' ? pick(pIds) : null, st, '', NOW - i * DAY); }
    for (const [i, s] of some(30, active).entries()) ins('INSERT INTO sa_advising_warnings (student_id, warning_type, severity, gpa_snapshot, absence_rate, failed_courses_count, advisor_name, action_plan, session_date, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', s.id, pick(['academic', 'attendance']), pick(['low', 'medium', 'high']), int(45, 65), int(5, 35), int(0, 4), pick(H.members).name, 'جلسة إرشاد وخطة تحسين', daysAgo(i), pick(['open', 'closed']), NOW);
    const movBase = Number(one("SELECT COUNT(*) AS n FROM sa_lifecycle_movements WHERE movement_no LIKE ?", `MOV-${YEAR}-%`).n);
    for (const [i, s] of some(15).entries()) ins('INSERT INTO sa_lifecycle_movements (movement_no, student_id, movement_type, academic_year, semester, from_status, to_status, from_program_id, to_program_id, financial_impact, academic_impact, decision_no, reason, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', `MOV-${YEAR}-${String(movBase + i + 1).padStart(3, '0')}`, s.id, pick(['postponement', 'withdrawal', 'program_transfer']), AY, 1, 'active', pick(['suspended', 'withdrawn', 'active']), s.program.id, s.program.id, 'لا أثر مالي', 'يحفظ الفصل', `قرار ${100 + i}`, 'ظروف موثقة', 'approved', 'شؤون الطلاب', NOW - i * DAY);
    for (const [i, s] of some(14, active).entries()) {
      const type = pick(['financial', 'disciplinary', 'library']);
      const hold = ins('INSERT INTO student_holds (student_id, hold_type, note, active, created_by, created_at) VALUES (?,?,?,1,?,?)', s.id, type, 'مانع تجريبي', adminId, NOW);
      if (type === 'disciplinary') ins('INSERT INTO sa_disciplinary_details (hold_id, student_id, committee_decision_no, violation_category, penalty_level, blocks_documents, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)', hold, s.id, `DISC-${YEAR}-${i + 1}`, 'exam_misconduct', pick(['warning', 'final_warning', 'suspension']), 1, daysAhead(90), NOW);
    }
    for (const s of some(15, active)) { const c = pick(H.courses.filter((x) => x.program_id === s.program.id)); ins('INSERT INTO sa_credit_equivalences (student_id, source_university, external_course_code, external_course_name, external_hours, external_mark, internal_course_id, equivalence_status, decided_by, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', s.id, pick(['جامعة دمشق', 'جامعة حلب', 'جامعة تشرين']), `EXT-${int(100, 400)}`, c.name, 3, int(60, 95), c.id, pick(['approved', 'pending']), 'لجنة المعادلات', '', NOW); }
    for (const [i, s] of some(30, active).entries()) ins('INSERT INTO sa_desk_appointments (ticket_no, student_id, service_purpose, appointment_date, time_slot, counter_window, queue_status, created_at) VALUES (?,?,?,?,?,?,?,?)', `Q-${101 + i}`, s.id, pick(['استلام وثيقة مصدقة', 'مراجعة شؤون الطلاب', 'تصحيح بيانات']), daysAhead(int(0, 10)), pick(['09:00 - 09:30', '10:00 - 10:30', '11:00 - 11:30']), 'النافذة 1', pick(['waiting', 'serving', 'completed']), NOW);
    for (const s of some(60, active)) for (let k = 0; k < int(1, 3); k++) { const ok = chance(0.9), code = pick(['GATE-MAIN-01', 'LIB-ENTRANCE', 'HALL-EXAM-102']); ins('INSERT INTO sa_card_activity_logs (student_id, student_no, student_name, event_type, location_name, location_code, method, terminal_id, status, reason, pki_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', s.id, s.no, s.name, ok ? pick(['check_in', 'check_out']) : 'denied', { 'GATE-MAIN-01': 'البوابة الرئيسية', 'LIB-ENTRANCE': 'المكتبة المركزية', 'HALL-EXAM-102': 'مجمع القاعات الامتحانية' }[code], code, pick(['nfc', 'barcode']), 'MANUAL', ok ? 'granted' : 'denied', 'تسجيل تجريبي', `sha256:${crypto.randomBytes(16).toString('hex')}`, NOW - int(1, 30) * DAY); }
    for (const s of some(60, active)) { const c = pick(H.courses.filter((x) => x.program_id === s.program.id)); db.prepare("INSERT INTO student_self_enrollments (student_no, student_name, course_code, course_name, credits, semester, prerequisite_code, status, registered_at) VALUES (?,?,?,?,?,?,'',?,?)").run(s.no, s.name, c.code, c.name, c.hours, `الفصل الأول ${AY}`, 'مسجل ومعتمد آلياً', NOW); }
    for (const s of some(40, active)) for (let k = 1; k <= 2; k++) { const paid = k === 1 && chance(0.6); db.prepare('INSERT INTO student_fee_installments (installment_code, student_no, student_name, faculty_name, installment_no, amount, due_date, paid_amount, payment_method, status) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`FEE-${s.no}-${k}`, s.no, s.name, s.faculty, k, 750000, k === 1 ? daysAgo(30) : daysAhead(60), paid ? 750000 : 0, paid ? 'cash' : null, paid ? 'مسدد' : 'مستحق'); }
    for (const s of some(40, active)) ins('INSERT INTO office_hour_bookings (faculty_name, student_name, student_no, slot_day, slot_time, topic, status, created_at) VALUES (?,?,?,?,?,?,?,?)', pick(H.members).name, s.name, s.no, pick(['الأحد', 'الاثنين', 'الثلاثاء']), pick(['10:00 - 10:30', '11:00 - 11:30']), pick(['مراجعة مشروع', 'استفسار عن الامتحان', 'إرشاد أكاديمي']), pick(['مؤكد', 'قيد الانتظار', 'منتهي']), NOW);
    for (const [i, t] of ['نادي البرمجة', 'نادي الأمن السيبراني', 'الفريق الرياضي', 'النادي الثقافي', 'فريق المسرح', 'نادي اللغات', 'التطوع المجتمعي', 'نادي الروبوت'].entries()) for (let k = 0; k < 3; k++) ins('INSERT INTO student_activities (club_name, title, category, event_date, location, supervisor_name, participants_count, budget, status) VALUES (?,?,?,?,?,?,?,?,?)', t, `فعالية ${t} ${k + 1}`, pick(['ثقافي', 'رياضي', 'علمي']), daysAhead(i * 5 - 20 + k), pick(HALLS), pick(H.members).name, int(15, 120), int(1, 10) * 50000, pick(['مخطط', 'منفذ']));
    for (const s of some(25)) db.prepare('INSERT INTO student_file_meta (student_id, general_notes, box_no, dossier_no, cert_notes, audited, audited_by, audited_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(s.id, 'ملف مكتمل', `BX-${int(1, 40)}`, `DS-${int(100, 900)}`, '', 1, adminId, NOW, adminId, NOW);
  });
});

await section('التظلمات وسجل القاعات', () => {
  tx(db, () => {
    const graded = rows("SELECT g.id, g.student_id, g.course, g.mark, g.course_id FROM grades g WHERE g.workflow_status = 'approved' ORDER BY g.id LIMIT 400");
    const byId = new Map(S.map((s) => [s.id, s]));
    for (const g of graded.filter(() => chance(0.08))) { const s = byId.get(Number(g.student_id)); if (!s) continue; const st = pick(['pending', 'approved', 'rejected']); ins('INSERT INTO grade_appeals (student_no, student_name, course_code, course_name, old_mark, new_mark, reason, committee_note, status, created_at, grade_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', s.no, s.name, H.courses.find((c) => c.id === Number(g.course_id))?.code ?? 'GEN', g.course, g.mark, st === 'approved' ? Math.min(100, Number(g.mark) + 5) : null, 'طلب إعادة تصحيح', st === 'pending' ? '' : 'قرار اللجنة', st, NOW, Number(g.id)); }
    for (const s of some(180, active)) for (let k = 0; k < int(1, 3); k++) {
      const c = pick(H.courses.filter((x) => x.program_id === s.program.id)), at = NOW - int(1, 40) * DAY - int(0, 8) * 3600000;
      ins('INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, exited_at, method, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)', s.id, pick(['course', 'course', 'exam']), c.id, c.name, pick(HALLS), at, at + 90 * 60000, pick(['barcode', 'manual']), adminId);
    }
    for (let i = 0; i < 6; i++) ins('INSERT INTO offline_sync_batches (batch_code, committee_name, hall_code, course_code, records_count, payload_json, synced_by, synced_at) VALUES (?,?,?,?,?,?,?,?)', `EXAM-ATT-${1000 + i}`, `اللجنة الامتحانية ${i + 1}`, pick(HALLS), pick(H.courses).code, int(20, 80), '[]', 'رئيس القاعة', NOW - i * DAY);
  });
});

/* ---------- التعلم والمكتبة ---------- */
await section('التعلم الإلكتروني والمكتبة', async () => {
  const cats = ['القانون', 'الأمن السيبراني', 'العلوم الأمنية', 'الحاسوب', 'الإدارة'];
  const lectures = [];
  tx(db, () => {
    for (const c of H.courses.filter((x) => x.semester === 1).slice(0, 80)) for (let w = 1; w <= 3; w++) lectures.push(ins('INSERT INTO lms_lectures (course_code, course_name, title, kind, week_no, instructor_name, content_url, summary, views_count, published, created_at, target_faculty) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)', c.code, c.name, `${c.name}: الأسبوع ${w}`, pick(['pdf', 'video', 'slides']), w, c.instructor, '', 'محتوى تجريبي للمحاضرة.', int(5, 300), NOW - w * DAY, ''));
    const books = [];
    for (let i = 0; i < 120; i++) { const total = int(2, 12); books.push(ins('INSERT INTO library_books (isbn, title, author, category, publish_year, copies_total, copies_available, shelf_code, digital_available, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', `978-${1000000000 + i}`, `${pick([...TOPICS.cyber, ...TOPICS.security])} — المرجع ${i + 1}`, `${pick(MALE)} ${pick(LAST)}`, pick(cats), int(2005, 2025), total, Math.max(0, total - int(0, 3)), `${pick('ABCDE'.split(''))}-${int(1, 30)}`, chance(0.4) ? 1 : 0, NOW)); }
    for (const s of some(70, active)) { const overdue = chance(0.2), returned = !overdue && chance(0.4); ins('INSERT INTO library_loans (book_id, borrower_name, borrower_no, loan_date, due_date, return_date, status, created_at) VALUES (?,?,?,?,?,?,?,?)', pick(books), s.name, s.no, daysAgo(overdue ? 40 : int(1, 20)), overdue ? daysAgo(10) : daysAhead(int(1, 14)), returned ? daysAgo(1) : null, returned ? 'returned' : 'active', NOW); }
    db.prepare('UPDATE library_books b SET copies_total = GREATEST(b.copies_total, x.n), copies_available = GREATEST(b.copies_total, x.n) - x.n FROM (SELECT b2.id, (SELECT COUNT(*) FROM library_loans l WHERE l.book_id = b2.id AND l.return_date IS NULL) AS n FROM library_books b2) x WHERE x.id = b.id').run();
    for (const c of H.courses.filter((x) => x.semester === 1).slice(0, 12)) {
      const q = ins('INSERT INTO lms_quizzes (course_code, course_name, title, duration_min, total_marks, published, created_at, instructor_name, status, faculty_name, exam_day, instructions, approved_by, approved_at, created_by) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)', c.code, c.name, `اختبار ${c.name}`, 30, 10, NOW, c.instructor, 'approved', '', daysAgo(2), 'اقرأ الأسئلة جيدًا', 'عميد الكلية', NOW, adminId);
      ins('INSERT INTO lms_quiz_questions (quiz_id, position, type, text, options_json, correct_json, marks) VALUES (?,1,?,?,?,?,?)', q, 'single', 'أي مما يلي صحيح؟', JSON.stringify(['الخيار الأول', 'الخيار الثاني', 'الخيار الثالث']), JSON.stringify([1]), 5);
      ins('INSERT INTO lms_quiz_questions (quiz_id, position, type, text, options_json, correct_json, marks) VALUES (?,2,?,?,?,?,?)', q, 'multi', 'اختر كل الإجابات الصحيحة.', JSON.stringify(['أ', 'ب', 'ج', 'د']), JSON.stringify([0, 2]), 3);
      ins('INSERT INTO lms_quiz_questions (quiz_id, position, type, text, options_json, correct_json, marks) VALUES (?,3,?,?,?,?,?)', q, 'essay', 'اشرح المفهوم الأساسي باختصار.', '[]', '[]', 2);
      for (const s of some(12, active.filter((x) => x.program.id === c.program_id))) ins('INSERT INTO lms_quiz_submissions (quiz_id, student_no, student_name, score, total_marks, answers_json, submitted_at, needs_grading) VALUES (?,?,?,?,?,?,?,?)', q, s.no, s.name, int(3, 10), 10, '{}', NOW - int(1, 5) * DAY, chance(0.3) ? 1 : 0);
    }
    db.prepare('INSERT INTO lms_quiz_attempts (quiz_id, student_no, started_at) SELECT quiz_id, student_no, submitted_at - 1200000 FROM lms_quiz_submissions ON CONFLICT DO NOTHING').run();
    const d = ins('INSERT INTO lms_quizzes (course_code, course_name, title, duration_min, total_marks, published, created_at, instructor_name, status, created_by) VALUES (?,?,?,?,?,0,?,?,?,?)', H.courses[0].code, H.courses[0].name, 'اختبار قيد الإعداد', 20, 10, NOW, H.courses[0].instructor, 'draft', adminId);
    ins('INSERT INTO lms_quiz_questions (quiz_id, position, type, text, options_json, correct_json, marks) VALUES (?,1,?,?,?,?,?)', d, 'essay', 'سؤال مسودة', '[]', '[]', 10);
  });
  return `${lectures.length} محاضرة`;
});

await section('البحث والخريجون والجودة والذكاء والأخبار', () => {
  tx(db, () => {
    for (let i = 0; i < 30; i++) ins('INSERT INTO research_projects (code, title, principal_investigator, faculty_name, domain, budget, journal_name, impact_factor, citations_count, status, published_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', `RES-${YEAR}-${i + 1}`, `دراسة في ${pick([...TOPICS.cyber, ...TOPICS.security])}`, pick(H.members).name, pick(facs).name, pick(['الأمن السيبراني', 'العلوم الأمنية', 'القانون']), int(5, 80) * 100000, 'مجلة الجامعة للبحوث العلمية', rnd() * 5, int(0, 60), pick(['active', 'published', 'planned']), daysAgo(int(10, 500)), NOW);
    for (const s of some(25, active)) ins('INSERT INTO postgrad_theses (student_no, student_name, degree, program_name, title, supervisor_name, co_supervisor, stage, defense_date, grade_label, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', s.no, s.name, pick(['ماجستير', 'دكتوراه']), s.program.name, `رسالة في ${pick(TOPICS.security)}`, pick(H.members).name, '', pick(['تسجيل الموضوع', 'إعداد', 'مناقشة', 'منجزة']), daysAhead(int(-100, 200)), 'قيد الإعداد', NOW);
    for (let i = 0; i < 80; i++) { const f = chance(0.35), n = person(f), p = pick(programs), year = int(2018, 2025); ins('INSERT INTO alumni_records (student_no, full_name, faculty_name, program_name, grad_year, gpa, honor_rank, current_employer, job_title, email, phone, verified_code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', `GRD-${year}-${1000 + i}`, `${n.first} ${n.father} ${n.last}`, p.faculty, p.name, year, int(60, 96), pick(['جيد', 'جيد جداً', 'امتياز']), pick(['وزارة الداخلية', 'شركة اتصالات', 'مصرف سورية', 'شركة برمجيات']), pick(['محلل أمني', 'مهندس شبكات', 'ضابط تحقيق', 'مبرمج']), `alumni${i}@suss.example`, `0966${100000 + i}`, `GRAD-${year}-${i}`, NOW); }
    const jobs = [];
    for (let i = 0; i < 15; i++) jobs.push(ins('INSERT INTO career_jobs (title, company_name, sector, location, job_type, salary_range, requirements, deadline, applicants_count, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)', pick(['محلل أمن معلومات', 'مهندس شبكات', 'باحث قانوني', 'مسؤول أمن منشآت', 'مبرمج']), pick(['شركة الشام للتقنية', 'مصرف سورية الدولي', 'مؤسسة الاتصالات']), pick(['التقنية', 'المصارف', 'الأمن']), pick(['دمشق', 'حلب', 'حمص']), pick(['دوام كامل', 'جزئي']), 'حسب الكفاءة', 'خبرة سنة على الأقل', daysAhead(int(5, 90)), 0, NOW));
    for (const s of some(45, active)) ins('INSERT INTO career_applications (job_id, applicant_name, student_no, gpa, cv_summary, status, applied_at) VALUES (?,?,?,?,?,?,?)', pick(jobs), s.name, s.no, int(60, 95), 'ملخص سيرة تجريبي', pick(['قيد المراجعة', 'مقبول', 'مرفوض']), NOW);
    db.prepare('UPDATE career_jobs SET applicants_count = (SELECT COUNT(*) FROM career_applications a WHERE a.job_id = career_jobs.id)').run();
    for (const [i, t] of ['نسبة النجاح', 'رضا الطلاب', 'نسبة الأساتذة إلى الطلاب', 'معدل الحضور', 'نسبة التوظيف', 'الأبحاث المنشورة', 'استكمال الملفات', 'جاهزية المخابر', 'زمن إنجاز الطلبات', 'نسبة التسرب'].entries()) ins('INSERT INTO qa_kpis (code, title, standard_domain, target_value, actual_value, unit, status, academic_year, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', `KPI-${i + 1}`, t, 'الجودة الأكاديمية', int(70, 95), int(50, 98), '%', pick(['مستوفى', 'قيد التحسين']), AY, NOW);
    for (const p of programs) for (const a of ['الهيئة الوطنية للاعتماد', 'ABET']) ins('INSERT INTO qa_accreditations (program_name, agency_name, standard_code, self_study_progress, audit_date, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?)', p.name, a, `STD-${int(1, 9)}`, int(20, 100), daysAhead(int(10, 300)), pick(['قيد الإعداد', 'معتمد']), '', NOW);
    for (const c of H.courses.slice(0, 40)) ins('INSERT INTO qa_surveys (course_code, course_name, instructor_name, semester, responses_count, content_score, teaching_score, assessment_score, overall_score, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', c.code, c.name, c.instructor, 'الفصل الأول', int(10, 80), 3 + rnd() * 2, 3 + rnd() * 2, 3 + rnd() * 2, 3 + rnd() * 2, '', NOW);
    for (const s of some(40, active)) { const risk = pick(['critical', 'medium', 'safe']); ins('INSERT INTO ai_early_warnings (student_no, student_name, program_name, gpa, attendance_rate, failed_courses, risk_level, ai_diagnosis, ai_action_plan, advisor_status, analyzed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', s.no, s.name, s.program.name, int(45, 90), int(50, 100), int(0, 4), risk, 'تشخيص بقواعد ثابتة للمعاينة', 'جلسة إرشاد ومتابعة أسبوعية', pick(['pending', 'contacted']), NOW); }
    for (let i = 0; i < 15; i++) ins('INSERT INTO ai_triage_logs (source_type, sender_name, subject, body_text, ai_category, ai_priority, target_unit, ai_summary, ai_draft_reply, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', 'مراسلة / شكوى', pick(active).name, pick(['تأخر وثيقة', 'خطأ في الرسوم', 'استفسار قبول']), 'نص تجريبي', pick(['مالي', 'أكاديمي', 'خدمات']), pick(['high', 'medium', 'low']), 'شؤون الطلاب', 'ملخص تجريبي', 'رد مقترح تجريبي', NOW);
    for (let i = 0; i < 15; i++) ins('INSERT INTO ai_advisor_chats (user_label, question, answer, model_used, created_at) VALUES (?,?,?,?,?)', pick(active).name, pick(['ما المقررات التي أسجلها؟', 'كيف أرفع معدلي؟', 'ما شروط الانتقال؟']), 'رد مولّد بقواعد ثابتة للمعاينة.', 'rule-based', NOW);
    for (let i = 0; i < 14; i++) ins('INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, status, resolution_note, created_at) VALUES (?,?,?,?,?,?,?,?,?)', `INC-${1000 + i}`, 'الواجهة', pick(['FILE_SAVE_FAILURE', 'API_TIMEOUT']), pick(['critical', 'high', 'medium', 'low']), 'public/app.js', 'خطأ تجريبي للمعاينة', pick(['open', 'resolved']), '', NOW - i * DAY);
    for (let i = 0; i < 25; i++) ins('INSERT INTO news (title, body, pinned, published_at, created_by) VALUES (?,?,?,?,?)', pick(['بدء التسجيل للفصل الثاني', 'موعد الامتحانات النهائية', 'ندوة الأمن السيبراني', 'إعلان نتائج المفاضلة', 'ورشة كتابة البحث العلمي', 'تعطيل الدوام الرسمي']) + ` ${i + 1}`, 'خبر تجريبي للمعاينة يوضح شكل الأخبار في بوابة الجامعة.', i < 2 ? 1 : 0, NOW - i * 3 * DAY, adminId);
    for (let i = 0; i < 12; i++) ins('INSERT INTO multi_channel_notifications (title, body, target_audience, channels, priority, delivery_count, sender_name, created_at) VALUES (?,?,?,?,?,?,?,?)', pick(['تذكير بموعد القسط', 'تعديل قاعة امتحان', 'تعميم إداري']), 'إشعار تجريبي', pick(['كافة الطلاب', 'الهيئة التدريسية والإدارية']), 'البوابة', pick(['high', 'normal']), int(50, 400), 'الإدارة', NOW - i * DAY);
    for (let i = 0; i < 6; i++) ins('INSERT INTO hr_signed_payslips (payslip_code, employee_code, employee_name, department, month_label, basic_salary, overload_pay, allowances, deductions, net_salary, digital_signature, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', `PS-DEMO-${i + 1}`, `EMP-${1001 + i}`, pick(H.members).name, 'الموارد البشرية', 'أيلول 2026', 3000000, 200000, 300000, 250000, 3250000, 'بيانات تجريبية بلا توقيع', NOW);
    for (let i = 0; i < 5; i++) ins('INSERT INTO encrypted_snapshots (snapshot_code, label, schedule_type, cipher_algo, sha256_hash, size_kb, tables_count, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)', `SNAP-${i + 1}`, 'نسخة تجريبية', 'يومي', 'AES-256-GCM', crypto.randomBytes(32).toString('hex'), int(2000, 90000), 130, 'مكتمل', NOW - i * DAY);
    const batch = ins('INSERT INTO card_batches (label, filter_json, created_by, created_at) VALUES (?,?,?,?)', 'دفعة بطاقات تجريبية', '{}', adminId, NOW);
    for (const s of some(40, active)) db.prepare('INSERT INTO card_handovers (batch_id, student_id, received_at, receiver_name, handed_by, note) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(batch, s.id, chance(0.6) ? NOW : null, s.name, adminId, '');
  });
});

await section('الملفات', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4 demo '), Buffer.alloc(2000)]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
  const send = (path, buf) => fetch(base + path, { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/octet-stream' }, body: buf });
  let n = 0;
  for (const l of rows('SELECT id FROM lms_lectures ORDER BY id LIMIT 12')) if ((await send(`/api/lms/lectures/${l.id}/files?name=${encodeURIComponent('ملف المحاضرة.pdf')}`, pdf)).ok) n++;
  for (const a of rows('SELECT id FROM news ORDER BY id LIMIT 6')) if ((await send(`/api/news/${a.id}/media?caption=${encodeURIComponent('صورة الخبر')}`, Buffer.concat([png, Buffer.alloc(20)]))).ok) n++;
  return n;
});

/* ---------- ما تنتجه عمليات الرفع والاستيراد والتعديل ---------- */
await section('طلبات بمرفقات', async () => {
  const services = (await call(session(S[0].id), 'GET', '/api/services')).json.services;
  const withFiles = rows('SELECT code, max_attachments, attachments_json FROM service_types WHERE max_attachments > 0 ORDER BY code');
  const fill = (f) => { if (f.type === 'number') return f.min ?? 1; if (f.type === 'date') return daysAhead(20); const o = (f.options || [])[0]; return o !== undefined ? (o.value ?? o) : 'بيانات تجريبية للمعاينة'; };
  let n = 0;
  for (const row of withFiles) {
    const svc = services.find((x) => x.code === row.code);
    if (!svc) continue;
    const slots = JSON.parse(row.attachments_json || '[]');
    const count = Math.max(1, Math.min(row.max_attachments, slots.length || 1));
    const attachments = Array.from({ length: count }, (_, i) => ({ name: `${slots[i]?.label ?? 'وثيقة'}.pdf`, slot: slots[i]?.label, data: DEMO_PDF.toString('base64') }));
    for (const st of some(3, active)) {
      const details = Object.fromEntries((svc.fields || []).filter((x) => x.required).map((x) => [x.name, fill(x)]));
      const r = await call(session(st.id), 'POST', '/api/requests', { service: svc.code, details, attachments });
      if (r.status === 201) n++;
    }
  }
  if (!n) throw new Error('لم يُنشأ أي طلب بمرفق');
  return n;
});

await section('ملفات الطلاب والشهادات والوثائق', async () => {
  const send = (path, buf) => fetch(base + path, { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/octet-stream' }, body: buf });
  let files = 0, certs = 0, pdfs = 0;
  for (const [i, st] of some(90, active).entries()) {
    if ((await send(`/api/students/${st.id}/files?kind=photo&name=${encodeURIComponent('صورة شخصية.png')}`, avatarPng(40 + (i * 37) % 180))).ok) files++;
    if (i % 2 === 0 && (await send(`/api/students/${st.id}/files?kind=identity&name=${encodeURIComponent('الهوية.pdf')}`, DEMO_PDF)).ok) files++;
  }
  for (const st of some(30, active)) { resetTieredRateLimit(); if ((await fetch(`${base}/api/students/${st.id}/certificate.pdf`, { headers: { Cookie: admin } })).ok) certs++; }
  for (const d of rows('SELECT code FROM documents ORDER BY id LIMIT 30')) { resetTieredRateLimit(); if ((await fetch(`${base}/api/documents/${d.code}/pdf`, { headers: { Cookie: admin } })).ok) pdfs++; }
  if (!files || !certs || !pdfs) throw new Error(`ناقص: ملفات ${files}، شهادات ${certs}، وثائق ${pdfs}`);
  return `${files} ملف، ${certs} شهادة، ${pdfs} وثيقة`;
});

await section('تعديلات العلامات', async () => {
  const ids = rows("SELECT id FROM grades WHERE workflow_status = 'approved' ORDER BY id LIMIT 40").map((g) => Number(g.id));
  const justification = 'تصحيح خطأ في إدخال العلامة بناء على مراجعة الورقة الامتحانية';
  const r = await must('إعادة فتح العلامات', admin, 'POST', '/api/grades/workflow', { stage: 'reviewed', gradeIds: ids, justification });
  // تعود نصفها إلى مسودة ويراجعها قسم الامتحانات، فتظهر العلامات بانتظار الاعتماد
  const again = ids.slice(0, 20), examsId = one("SELECT id FROM users WHERE username = 'exams'")?.id;
  await must('إعادة العلامات إلى مسودة', admin, 'POST', '/api/grades/workflow', { stage: 'draft', gradeIds: again, justification });
  if (examsId) {
    await must('مراجعة العلامات', session(examsId), 'POST', '/api/grades/workflow', { stage: 'reviewed', gradeIds: again });
  }
  return r?.updated?.length ?? r?.updated;
});

await section('دفعات الاستيراد', async () => {
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const run = async (lines) => {
    const c = await must('فحص الاستيراد', admin, 'POST', '/api/import-engine/proc_suppliers/check', { filename: 'موردون.csv', data: b64(lines.join('\n')) });
    if (c?.stagingToken) await must('تنفيذ الاستيراد', admin, 'POST', '/api/import-engine/proc_suppliers/commit', { stagingToken: c.stagingToken });
  };
  const head = 'الرمز,الاسم,الهاتف';
  await run([head, ...Array.from({ length: 12 }, (_, i) => `IMP-${i + 1},مورد مستورد ${i + 1},09445${String(10000 + i)}`)]);
  await run([head, ...Array.from({ length: 6 }, (_, i) => `IMP-${i + 1},مورد مستورد معدل ${i + 1},09446${String(10000 + i)}`)]);
  await run([head, 'IMP-90,دفعة ستلغى,0944700000']);
  const last = one('SELECT MAX(id) AS id FROM import_batches').id;
  await must('تراجع الاستيراد', admin, 'POST', `/api/import-engine/batches/${last}/undo`, {});
  return one('SELECT COUNT(*) AS c FROM import_batches').c;
});

await section('رصيد إجازات الكادر', () => {
  const staff = rows("SELECT id FROM users WHERE role = 'staff' AND active = 1 ORDER BY id LIMIT 12");
  const type = String(one("SELECT value FROM site_settings WHERE key = 'hr.annual_leave_type'")?.value ?? '"سنوية"').replace(/^"|"$/g, '');
  tx(db, () => {
    for (const u of staff) {
      const start = NOW - int(10, 120) * DAY, days = int(1, 6);
      ins('INSERT INTO leave_records (user_id, year, type, from_day, to_day, days, created_at) VALUES (?,?,?,?,?,?,?)', u.id, YEAR, chance(0.7) ? type : 'مرضية', dayOf(start), dayOf(start + (days - 1) * DAY), days, NOW);
    }
  });
  return staff.length;
});

await section('إعدادات البنية', () => {
  const u = new URL(url);
  const set = db.prepare('INSERT INTO infra_settings (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at');
  set.run('db_engine', JSON.stringify({ active: 'postgresql', pgHost: u.hostname, pgPort: Number(u.port || 5432), pgDatabase: u.pathname.slice(1), poolMax: Number(process.env.DB_POOL_MAX || 10), readReplicas: 0 }), NOW);
  set.run('redis_cluster', JSON.stringify({ enabled: false, mode: 'memory' }), NOW);
  set.run('sso_auth', JSON.stringify({ ldapEnabled: false, microsoftEntraEnabled: false, googleWorkspaceEnabled: false }), NOW);
});

/* ---------- تقرير التغطية ---------- */
const skip = new Set(['schema_migrations', 'import_staging', 'import_staging_chunks', 'idempotency_keys', 'push_subscriptions', 'rate_counters']);
const empties = [];
for (const r of rows("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")) {
  if (skip.has(r.tablename)) continue;
  if (!Number(one(`SELECT COUNT(*) AS c FROM "${r.tablename}"`).c)) empties.push(r.tablename);
}
console.log(`\nالطلاب: ${S.length} | جداول فارغة: ${empties.length}\n${empties.join(' ')}`);
const dedup = [...new Set(problems)];
console.log(`\nمشكلات (${dedup.length}):\n${dedup.slice(0, 30).join('\n')}`);
db.prepare('DELETE FROM sessions WHERE token_hash IS NOT NULL AND user_id IS NOT NULL AND expires_at = ?').run(NOW + DAY);
await app.close();
process.exit(0);
