// ملحق البيانات التجريبية: يكمل ما لا يغطيه seed-local-demo.mjs (المجالس واللجان، التوظيف، عروض الأسعار، الميزانيات،
// الواجبات، الصيانة والقاعات، التقويم الأكاديمي، الحرمان، مكونات العلامات…) ويُنشئ حسابات الهيئة التدريسية.
// يُشغَّل بعد seed-local-demo.mjs وعلى القاعدة نفسها، محليًا فقط:
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/suss_dev DEMO_MODE=1 SEED_PASSWORD='كلمة-المرور' node scripts/seed-demo-extra.mjs --confirm
// آمن للتكرار: كل قسم يتخطى نفسه إن وُجدت بياناته، ويُغلَّف بمعاملة مستقلة فلا يُسقط فشل قسم بقية الأقسام.
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { seedPassword } from '../server/services/bootstrap.js';
import { tx } from '../server/db.js';

const url = process.env.DATABASE_URL ?? '';
const host = url ? new URL(url).hostname : '';
if (!process.argv.includes('--confirm') || !['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== '1') {
  console.error('يعمل محليًا فقط: قاعدة على هذا الجهاز، وDEMO_MODE=1، و--confirm.');
  process.exit(1);
}

let seedState = 20261111;
const rnd = () => { seedState = (seedState + 0x6d2b79f5) | 0; let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const DAY = 86400000, NOW = Date.now(), HOUR = 3600000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysAgo = (n) => dayOf(NOW - n * DAY), daysAhead = (n) => dayOf(NOW + n * DAY);
const YEAR = 2026, AY = '2026/2027', TERM = '2026/2027 - الفصل الأول';

const app = await createApp();
const db = app.db;
const rows = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
const count = (t) => Number(one(`SELECT COUNT(*) AS c FROM "${t}"`).c);
const problems = [];
const section = async (name, fn) => {
  const t = Date.now();
  try { const r = await fn(); console.log(`✓ ${name}${r !== undefined ? ` (${r})` : ''} ${Math.round((Date.now() - t) / 100) / 10}ث`); }
  catch (e) { problems.push(`${name}: ${e.message}`); console.log(`✘ ${name}: ${String(e.message).slice(0, 220)}`); }
};
const uid = (username) => { const r = one('SELECT id FROM users WHERE username = ?', username); return r ? Number(r.id) : null; };
const adminId = uid('admin');
if (!adminId) { console.error('لا يوجد حساب admin: شغّل seed-local-demo.mjs أولًا.'); await app.close(); process.exit(1); }
const students = rows("SELECT u.id, u.student_no, u.display_name, p.program_id, p.status FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.role = 'student' ORDER BY u.id");
const activeStudents = students.filter((s) => s.status === 'active');
if (!students.length) { console.error('لا يوجد طلاب: شغّل seed-local-demo.mjs أولًا.'); await app.close(); process.exit(1); }
const some = (n, list = activeStudents) => { const c = [...list]; const out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
const courses = rows('SELECT id, program_id, name, code, level, semester, instructor, member_id FROM courses WHERE active = 1 ORDER BY id');
const staffIds = rows("SELECT id FROM users WHERE role <> 'student' AND active = 1 ORDER BY id").map((u) => Number(u.id));
const skipIfFilled = (t, fn) => () => (count(t) ? `موجود مسبقًا: ${count(t)}` : fn());

/* ================= الحسابات ================= */
await section('حسابات الهيئة التدريسية', async () => {
  const hash = await hashPassword(seedPassword(), app.cfg.scryptN);
  const withCourses = rows('SELECT m.id, m.name, m.unit_id FROM faculty_members m WHERE m.user_id IS NULL AND EXISTS (SELECT 1 FROM courses c WHERE c.member_id = m.id) ORDER BY m.id LIMIT 6');
  let n = 0;
  tx(db, () => {
    for (const [i, m] of withCourses.entries()) {
      const username = `faculty${i + 1}`;
      if (one('SELECT 1 FROM users WHERE username = ?', username)) continue;
      const id = ins("INSERT INTO users (username, display_name, password_hash, role, role_key, unit_id, active, must_change_password, job_title, created_at) VALUES (?,?,?,'staff','faculty_member',NULL,1,0,?,?)", username, m.name, hash, 'عضو هيئة تدريسية', NOW);   // عضو الهيئة بلا وحدة إدارية
      run('UPDATE faculty_members SET user_id = ? WHERE id = ?', id, m.id);
      n++;
    }
  });
  // حساب رئاسة الجامعة (مرحلة الاعتماد الأعلى لطلبات الشراء) إن لم يُنشأ بعد
  if (!uid('president')) {
    run("INSERT INTO users (username, display_name, password_hash, role, active, must_change_password, access_mode, data_scope, custom_permissions_json, job_title, created_at) VALUES ('president', 'رئيس الجامعة', ?, 'staff', 1, 0, 'custom', 'all', ?, 'رئيس الجامعة', ?)",
      hash, JSON.stringify(['procurement:approve_top', 'procurement:read', 'stats:read', 'request:read_all', 'document:read_all', 'finance:read', 'corr:use', 'staffatt:self', 'request:create_internal']), NOW);
    n++;
  }
  db.prepare('UPDATE users SET must_change_password = 0 WHERE active = 1').run();
  return `${n} حساب جديد`;
});

/* ================= التقويم والقاعات والصيانة ================= */
await section('التقويم الأكاديمي', skipIfFilled('academic_calendar', () => {
  const items = [
    ['term', 'بدء الفصل الأول', -60, 100], ['registration', 'فترة التسجيل في المقررات', -75, -61], ['add_drop', 'الحذف والإضافة', -58, -50],
    ['exams', 'الامتحانات النصفية', -10, 4], ['holiday', 'عطلة عيد الأضحى', 150, 154], ['exams', 'الامتحانات النهائية للفصل الأول', 70, 95],
    ['event', 'يوم الجامعة المفتوح', 20, 20], ['event', 'حفل تخريج الدفعة', 120, 120], ['registration', 'تسجيل الفصل الثاني', 110, 125], ['term', 'بدء الفصل الثاني', 130, 250],
  ];
  tx(db, () => { for (const [kind, title, a, b] of items) ins('INSERT INTO academic_calendar (term, kind, title, start_day, end_day, active, created_by, created_at) VALUES (?,?,?,?,?,1,?,?)', TERM, kind, title, a < 0 ? daysAgo(-a) : daysAhead(a), b < 0 ? daysAgo(-b) : daysAhead(b), adminId, NOW); });
  return items.length;
}));

await section('القاعات والحجوزات والصيانة', skipIfFilled('facility_rooms', () => {
  const defs = [['المدرج الكبير A1', 'المبنى A', 300, 'hall'], ['المدرج الثاني A2', 'المبنى A', 200, 'hall'], ['قاعة المحاضرات B2', 'المبنى B', 80, 'hall'], ['مخبر الحاسوب C1', 'المبنى C', 40, 'lab'], ['مخبر الشبكات C2', 'المبنى C', 30, 'lab'], ['قاعة الاجتماعات الكبرى', 'المبنى الإداري', 40, 'meeting'], ['قاعة الندوات D1', 'المبنى D', 120, 'hall'], ['قاعة المناقشات', 'المبنى الإداري', 25, 'meeting']];
  const ids = [];
  tx(db, () => {
    for (const [name, building, capacity, kind] of defs) ids.push(ins('INSERT INTO facility_rooms (name, building, capacity, kind, active, created_at) VALUES (?,?,?,?,1,?)', name, building, capacity, kind, NOW));
    const titles = ['اجتماع مجلس القسم', 'ندوة الأمن السيبراني', 'ورشة تدريبية', 'مناقشة مشروع تخرج', 'محاضرة تعويضية', 'لقاء الطلاب الجدد'];
    for (let i = 0; i < 18; i++) {
      const hour = int(8, 15), st = pick(['approved', 'approved', 'pending', 'rejected']);
      ins('INSERT INTO room_bookings (room_id, title, day, start_time, end_time, attendees, requester_id, status, decided_by, decision_note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        pick(ids), pick(titles), daysAhead(int(-5, 20)), `${String(hour).padStart(2, '0')}:00`, `${String(hour + int(1, 2)).padStart(2, '0')}:00`, int(10, 80), pick(staffIds), st, st === 'pending' ? null : adminId, st === 'rejected' ? 'القاعة محجوزة لنشاط آخر' : st === 'approved' ? 'تمت الموافقة' : '', NOW - int(0, 10) * DAY);
    }
    const cats = ['كهرباء', 'سباكة', 'تكييف', 'أثاث', 'شبكات', 'نظافة'], locs = ['المبنى A - قاعة 101', 'المبنى B - الممر', 'مخبر الحاسوب C1', 'المبنى الإداري - الطابق 2', 'المكتبة المركزية', 'السكن الجامعي'];
    for (let i = 0; i < 14; i++) {
      const st = pick(['open', 'assigned', 'done', 'closed']), created = NOW - int(1, 40) * DAY;
      ins('INSERT INTO maintenance_orders (no, location, category, description, priority, requester_id, assignee_id, status, done_note, cost, created_at, assigned_at, done_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        `MNT-${YEAR}-${String(i + 1).padStart(4, '0')}`, pick(locs), pick(cats), pick(['عطل متكرر يحتاج فحصًا', 'استبدال قطعة تالفة', 'صيانة دورية', 'تسرب يحتاج معالجة عاجلة']), pick(['normal', 'normal', 'urgent', 'emergency']), pick(staffIds),
        st === 'open' ? null : pick(staffIds), st, st === 'done' || st === 'closed' ? 'تم الإصلاح' : '', st === 'done' || st === 'closed' ? int(1, 20) * 25000 : 0, created, st === 'open' ? null : created + HOUR * 5, st === 'done' || st === 'closed' ? created + DAY : null, st === 'closed' ? created + 2 * DAY : null);
    }
  });
  return `${defs.length} قاعة، 18 حجز، 14 أمر صيانة`;
}));

/* ================= المجالس واللجان ================= */
await section('المجالس واللجان والاجتماعات', skipIfFilled('councils', () => {
  const pool = staffIds.slice(0, 25);
  const defs = [['مجلس الجامعة', 'university', 'council'], ['مجلس كلية العلوم الأمنية', 'faculty', 'council'], ['مجلس كلية الأمن السيبراني', 'faculty', 'council'], ['لجنة الامتحانات العليا', 'exams', 'committee'], ['اللجنة التأديبية', 'discipline', 'committee'], ['لجنة الجودة والاعتماد', 'quality', 'committee']];
  let meetings = 0, items = 0;
  tx(db, () => {
    for (const [ci, [name, type, kind]] of defs.entries()) {
      const cid = ins('INSERT INTO councils (name, type, kind, quorum_percent, active, created_by, created_at) VALUES (?,?,?,?,1,?,?)', name, type, kind, pick([50, 60, 67]), adminId, NOW);
      const members = [];
      for (const [k, role] of ['chair', 'deputy', 'rapporteur', 'secretary', 'member', 'member', 'member'].entries()) {
        const user = pool[(ci * 5 + k) % pool.length];
        if (members.some((m) => m.user === user)) continue;
        ins('INSERT INTO council_members (council_id, user_id, role, voting, from_day, active, created_at) VALUES (?,?,?,?,?,1,?)', cid, user, role, role === 'secretary' ? 0 : 1, daysAgo(200), NOW);
        members.push({ user, role });
      }
      for (let mi = 0; mi < 3; mi++) {
        const st = ['closed', 'held', 'scheduled'][mi], at = NOW + (mi === 2 ? 7 : -(mi + 1) * 21) * DAY + 10 * HOUR;
        const mid = ins('INSERT INTO council_meetings (council_id, no, title, meeting_at, location, status, minutes, created_by, created_at, closed_by, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          cid, `MT-${YEAR}-${String(++meetings).padStart(3, '0')}`, `الاجتماع ${['الأول', 'الثاني', 'الثالث'][mi]} لـ${name}`, at, 'قاعة الاجتماعات الكبرى', st, st === 'closed' ? 'تمت مناقشة جدول الأعمال واتخاذ القرارات.' : '', adminId, NOW - 30 * DAY, st === 'closed' ? adminId : null, st === 'closed' ? at + 2 * HOUR : null);
        for (const m of members) ins('INSERT INTO council_attendance (meeting_id, user_id, present) VALUES (?,?,?) ON CONFLICT DO NOTHING', mid, m.user, st === 'scheduled' ? 0 : chance(0.85) ? 1 : 0);
        for (let k = 0; k < (st === 'scheduled' ? 2 : 3); k++) {
          items++;
          const decided = st !== 'scheduled' && k < 2, outcome = decided ? pick(['approved', 'approved', 'rejected']) : null;
          const iid = ins('INSERT INTO council_items (meeting_id, seq, title, details, status, outcome, decision_no, decision_text, votes_for, votes_against, votes_abstain, decided_by, decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            mid, k + 1, pick(['إقرار الخطة الدراسية', 'طلب تعديل لائحة', 'النظر في طلبات المعادلة', 'اعتماد نتائج الفصل', 'تشكيل لجنة فرعية', 'الموازنة التقديرية']), 'تفاصيل البند المعروض على المجلس.',
            decided ? 'decided' : st === 'scheduled' ? 'pending' : 'deferred', decided ? outcome : st === 'scheduled' ? null : 'deferred', decided ? `DEC-${YEAR}-${String(items).padStart(4, '0')}` : null, decided ? (outcome === 'approved' ? 'تقرر الموافقة' : 'تقرر الرفض') : '',
            decided ? int(4, 7) : 0, decided ? int(0, 2) : 0, decided ? int(0, 1) : 0, decided ? adminId : null, decided ? at + HOUR : null, NOW - 30 * DAY);
          if (decided && k === 0) {
            const assignee = pick(members).user;
            ins('INSERT INTO council_tasks (item_id, assignee_id, title, due_day, status, done_note, done_at, done_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', iid, assignee, 'متابعة تنفيذ القرار', daysAhead(int(5, 30)), mi === 0 ? 'done' : 'open', mi === 0 ? 'نُفّذ القرار' : '', mi === 0 ? NOW : null, mi === 0 ? assignee : null, adminId, NOW);
            if (chance(0.5)) ins('INSERT INTO council_recusals (item_id, user_id, reason, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', iid, members[members.length - 1].user, 'تعارض مصالح: صلة قرابة بمقدّم الطلب', NOW);
          }
        }
      }
    }
  });
  return `${defs.length} مجلس/لجنة، ${meetings} اجتماع، ${items} بند`;
}));

/* ================= شؤون الطلاب والأكاديمي ================= */
await section('بطاقات محظورة وتظلمات تأديبية وتجديد القيد والترفيع', async () => {
  let n = 0;
  tx(db, () => {
    if (!count('card_blocks')) for (const [i, s] of some(12).entries()) { const cleared = i % 3 === 0; ins('INSERT INTO card_blocks (student_id, reason, note, blocked_at, blocked_by, cleared_at, cleared_by, clear_note) VALUES (?,?,?,?,?,?,?,?)', s.id, pick(['lost', 'stolen', 'damaged', 'admin']), 'بلاغ من الطالب', NOW - int(1, 30) * DAY, adminId, cleared ? NOW - DAY : null, cleared ? adminId : null, cleared ? 'أُصدرت بطاقة بديلة' : ''); n++; }
    if (!count('sa_disciplinary_appeals')) for (const [i, h] of rows("SELECT h.id, h.student_id FROM student_holds h JOIN sa_disciplinary_details d ON d.hold_id = h.id ORDER BY h.id LIMIT 6").entries()) { const st = pick(['pending', 'upheld', 'reduced', 'cancelled']); ins('INSERT INTO sa_disciplinary_appeals (appeal_no, hold_id, student_id, reason, status, decision_note, decided_by, decided_by_id, decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', `APL-${YEAR}-${String(i + 1).padStart(3, '0')}`, h.id, h.student_id, 'طلب إعادة النظر في العقوبة لظروف خاصة', st, st === 'pending' ? null : 'قرار اللجنة التأديبية', st === 'pending' ? null : 'اللجنة التأديبية', st === 'pending' ? null : adminId, st === 'pending' ? null : NOW, NOW - 5 * DAY); n++; }
    if (!count('sa_enrollment_renewals')) for (const s of some(80)) { ins('INSERT INTO sa_enrollment_renewals (student_id, academic_year, level, late, created_by_id, created_at) VALUES (?,?,?,?,?,?)', s.id, AY, int(1, 4), chance(0.1) ? 1 : 0, adminId, NOW - int(1, 40) * DAY); n++; }
    if (!count('sa_promotions')) for (const s of some(60)) { const from = int(1, 3); ins('INSERT INTO sa_promotions (student_id, academic_year, from_level, to_level, carried, decided_by, decided_by_id, created_at) VALUES (?,?,?,?,?,?,?,?)', s.id, '2025/2026', from, from + 1, chance(0.15) ? int(1, 2) : 0, 'قسم التسجيل', adminId, NOW - 120 * DAY); n++; }
  });
  return `${n} سجل`;
});

await section('الحرمان والشعب وتغييرات المحاضرات', async () => {
  let n = 0;
  tx(db, () => {
    if (!count('course_deprivations')) for (const [i, s] of some(18).entries()) { const c = pick(courses.filter((x) => x.program_id === Number(s.program_id)) || courses) ?? pick(courses); const lifted = i % 4 === 0; ins('INSERT INTO course_deprivations (student_id, course_id, term, absence_percent, status, decided_by, decided_at, lifted_by, lifted_at, lift_reason) VALUES (?,?,?,?,?,?,?,?,?,?)', s.id, c.id, TERM, int(26, 45), lifted ? 'lifted' : 'active', adminId, NOW - int(5, 30) * DAY, lifted ? adminId : null, lifted ? NOW - DAY : null, lifted ? 'قُبل العذر الطبي' : ''); n++; }
    if (!count('course_sections')) for (const c of courses.slice(0, 24)) for (const [k, name] of ['شعبة 1', 'شعبة 2'].entries()) { ins('INSERT INTO course_sections (course_id, term, name, capacity, instructor, hall, schedule, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)', c.id, TERM, name, pick([30, 40, 60]), c.instructor, pick(['المدرج الكبير A1', 'قاعة المحاضرات B2', 'مخبر الحاسوب C1']), pick(['الأحد 8-10', 'الاثنين 10-12', 'الثلاثاء 12-14', 'الأربعاء 8-10']), adminId, NOW); n++; }
    if (!count('lecture_changes')) for (const c of courses.slice(0, 12)) { const cancel = chance(0.5); ins('INSERT INTO lecture_changes (course_id, kind, lecture_day, start_time, end_time, hall, makeup_day, makeup_start, makeup_end, makeup_hall, reason, notified, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', c.id, cancel ? 'cancel' : 'makeup', daysAhead(int(-3, 10)), '10:00', '12:00', 'قاعة المحاضرات B2', cancel ? null : daysAhead(int(11, 17)), cancel ? '' : '12:00', cancel ? '' : '14:00', cancel ? '' : 'المدرج الثاني A2', cancel ? 'ظرف طارئ للمحاضر' : 'تعويض عن محاضرة فائتة', 1, adminId, NOW - int(0, 5) * DAY); n++; }
  });
  return `${n} سجل`;
});

await section('مكونات العلامات وأقفالها', skipIfFilled('course_grade_components', () => {
  let comps = 0, marks = 0, locks = 0;
  const withGrades = rows("SELECT course_id, COUNT(*) AS c FROM grades WHERE course_id IS NOT NULL AND workflow_status = 'approved' GROUP BY course_id ORDER BY c DESC LIMIT 8");
  tx(db, () => {
    for (const [i, { course_id }] of withGrades.entries()) {
      const theory = ins("INSERT INTO course_grade_components (course_id, name, kind, max_mark, seq) VALUES (?,?,?,?,?)", course_id, 'الامتحان النظري', 'theory', 60, 1);
      const prac = ins("INSERT INTO course_grade_components (course_id, name, kind, max_mark, seq) VALUES (?,?,?,?,?)", course_id, 'العملي والأعمال', 'practical', 40, 2);
      comps += 2;
      for (const g of rows("SELECT id, mark FROM grades WHERE course_id = ? AND workflow_status = 'approved'", course_id)) {
        const t = Math.min(60, Math.round(Number(g.mark) * 0.6)), p = Math.min(40, Number(g.mark) - t);
        run('INSERT INTO grade_component_marks (grade_id, component_id, mark) VALUES (?,?,?) ON CONFLICT DO NOTHING', g.id, theory, t);
        run('INSERT INTO grade_component_marks (grade_id, component_id, mark) VALUES (?,?,?) ON CONFLICT DO NOTHING', g.id, prac, Math.max(0, p));
        marks += 2;
      }
      if (i < 4) { run('INSERT INTO grade_locks (course_id, academic_year, locked_by, locked_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', course_id, AY, adminId, NOW); locks++; }
    }
  });
  return `${comps} مكوّن، ${marks} علامة، ${locks} قفل`;
}));

/* ================= التعلم الإلكتروني: الواجبات ================= */
await section('الواجبات والتسليمات', skipIfFilled('lms_assignments', () => {
  const owners = rows("SELECT id FROM users WHERE role_key = 'faculty_member' ORDER BY id").map((u) => Number(u.id));
  const owner = (i) => owners.length ? owners[i % owners.length] : adminId;
  let a = 0, subs = 0;
  tx(db, () => {
    for (const [i, c] of courses.slice(0, 14).entries()) {
      const starts = NOW - int(10, 25) * DAY, due = starts + 14 * DAY, status = i % 5 === 4 ? 'draft' : i % 5 === 3 ? 'closed' : 'published';
      const id = ins('INSERT INTO lms_assignments (kind, title, description, instructions, course_id, owner_id, starts_at, due_at, late_until, max_score, submission_mode, allowed_types_json, max_file_bytes, max_files, max_attempts, allow_edit, allow_late, status, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        i % 7 === 6 ? 'exam' : 'assignment', `${i % 7 === 6 ? 'اختبار قصير' : 'واجب'}: ${c.name}`, 'حل المسائل المرفقة وتسليمها قبل الموعد.', 'اكتب الحل بوضوح وراجع المراجع المعتمدة.', c.id, owner(i), starts, due, due + 3 * DAY, 100, 'text',
        JSON.stringify(['pdf', 'word']), 10485760, 3, 2, 1, 1, status, status === 'draft' ? null : starts, starts, starts);
      a++;
      ins("INSERT INTO lms_assignment_targets (assignment_id, target_type, program_id, approval_status, requested_by, decided_by, decided_at, created_at) VALUES (?,'program',?,'approved',?,?,?,?)", id, c.program_id, owner(i), adminId, starts, starts);
      if (status === 'draft') continue;
      for (const s of activeStudents.filter((x) => Number(x.program_id) === Number(c.program_id)).slice(0, 12)) {
        const st = chance(0.8) ? (chance(0.6) ? 'graded' : 'submitted') : 'draft';
        if (status === 'closed' && st === 'draft') continue;
        const at = starts + int(1, 13) * DAY, late = at > due ? 1 : 0;
        ins('INSERT INTO lms_assignment_submissions (assignment_id, student_id, attempt_no, status, body_text, is_late, submitted_at, score, feedback, graded_by, graded_at, created_at, updated_at) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?)',
          id, s.id, st, 'حل الواجب كما هو مطلوب مع شرح الخطوات.', late, st === 'draft' ? null : at, st === 'graded' ? int(55, 100) : null, st === 'graded' ? pick(['عمل جيد', 'أحسنت', 'يحتاج مزيدًا من التفصيل']) : '', st === 'graded' ? owner(i) : null, st === 'graded' ? at + DAY : null, at, at);
        subs++;
      }
    }
  });
  return `${a} واجب، ${subs} تسليم (دون مرفقات ملفية)`;
}));

/* ================= المالية ================= */
await section('الميزانيات والتحويلات وبنود الفواتير', async () => {
  let b = 0, tr = 0, lines = 0;
  tx(db, () => {
    if (!count('fin_budgets')) {
      const year = one("SELECT id FROM fin_years ORDER BY id DESC LIMIT 1"), ccs = rows('SELECT id FROM fin_cost_centers ORDER BY id'), accs = rows("SELECT id FROM fin_accounts WHERE type = 'expense' AND postable = 1 ORDER BY id LIMIT 6");
      const ids = [];
      for (const cc of ccs) for (const acc of accs.slice(0, 3)) { ids.push(ins('INSERT INTO fin_budgets (year_id, cost_center_id, account_id, amount, status, note, created_by, created_at, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?)', year.id, cc.id, acc.id, int(10, 80) * 1000000, 'approved', 'موازنة تقديرية', adminId, NOW - 60 * DAY, adminId, NOW - 55 * DAY)); b++; }
      for (let i = 0; i + 1 < ids.length && tr < 5; i += 4) { ins('INSERT INTO fin_budget_transfers (from_budget_id, to_budget_id, amount, reason, created_by, created_at) VALUES (?,?,?,?,?,?)', ids[i], ids[i + 1], int(1, 5) * 500000, 'إعادة توزيع بين البنود', adminId, NOW - 20 * DAY); tr++; }
    }
    if (!count('fin_invoice_lines')) for (const inv of rows('SELECT id, description, total FROM fin_invoices ORDER BY id')) { ins('INSERT INTO fin_invoice_lines (invoice_id, description, qty, unit_price) VALUES (?,?,?,?)', inv.id, inv.description || 'بند الفاتورة', 1, inv.total); lines++; }
  });
  return `${b} ميزانية، ${tr} تحويل، ${lines} بند فاتورة`;
});

/* ================= الموارد البشرية: التوظيف ================= */
await section('الشواغر والمتقدمون والمقابلات', skipIfFilled('hr_vacancies', () => {
  const units = rows("SELECT id FROM org_units WHERE kind <> 'university' ORDER BY id");
  const titles = ['محاسب', 'مبرمج أنظمة', 'أمين مستودع', 'مساعد باحث', 'أخصائي أمن معلومات', 'سكرتير إداري'];
  let vac = 0, app_ = 0, iv = 0;
  tx(db, () => {
    for (const [i, t] of titles.entries()) {
      const st = i === 5 ? 'closed' : 'open';
      const vid = ins('INSERT INTO hr_vacancies (title, unit_id, positions, description, requirements, closes_on, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', t, pick(units).id, int(1, 3), `شاغر وظيفي: ${t}`, 'إجازة جامعية وخبرة مناسبة', st === 'open' ? daysAhead(int(5, 30)) : daysAgo(10), st, adminId, NOW - 20 * DAY);
      vac++;
      for (let k = 0; k < int(3, 5); k++) {
        const status = pick(['applied', 'shortlisted', 'interview', 'offered', 'rejected']);
        const aid = ins('INSERT INTO hr_applicants (vacancy_id, full_name, national_id, phone, email, qualification, experience_years, status, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          vid, `${pick(['محمد', 'أحمد', 'ليلى', 'سارة', 'خالد', 'نور'])} ${pick(['العلي', 'الحسن', 'ديب', 'سلامة', 'عيسى'])}`, `B${String(800000000 + vac * 100 + k)}`, `0966${String(100000 + vac * 10 + k)}`, `applicant${vac}${k}@example.com`, pick(['إجازة جامعية', 'ماجستير', 'معهد متوسط']), int(0, 10), status, '', adminId, NOW - int(1, 15) * DAY);
        app_++;
        if (['interview', 'offered'].includes(status)) { ins('INSERT INTO hr_interviews (applicant_id, scheduled_at, panel, score, recommendation, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', aid, NOW + int(-5, 7) * DAY, 'لجنة التوظيف', int(55, 95), pick(['hire', 'reserve', 'reject']), 'مقابلة جيدة', adminId, NOW - 3 * DAY); iv++; }
      }
    }
  });
  return `${vac} شاغر، ${app_} متقدم، ${iv} مقابلة`;
}));

/* ================= المشتريات: عروض الأسعار وتقييم الموردين ================= */
await section('طلبات عروض الأسعار وتقييم الموردين', async () => {
  let rfq = 0, q = 0, rate = 0;
  tx(db, () => {
    if (!count('proc_rfqs')) {
      const sups = rows('SELECT id FROM proc_suppliers ORDER BY id'), reqs = rows("SELECT id, no, title FROM proc_requests WHERE status = 'approved' ORDER BY id LIMIT 4");
      for (const [i, r] of reqs.entries()) {
        const lines = rows('SELECT id, est_cost FROM proc_request_lines WHERE request_id = ?', r.id);
        if (!lines.length) continue;
        const rid = ins("INSERT INTO proc_rfqs (no, request_id, title, closes_on, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)", `RFQ-${YEAR}-${String(i + 1).padStart(4, '0')}`, r.id, `عرض أسعار: ${r.title}`, daysAhead(10 - i * 6), i < 2 ? 'open' : 'open', adminId, NOW - 6 * DAY);
        rfq++;
        const quotes = [];
        for (const sup of sups.slice(i, i + 3)) {
          let total = 0; const priced = lines.map((l) => { const p = Math.round(Number(l.est_cost ?? 100000) * (0.85 + rnd() * 0.3)); return { l, p }; });
          const qid = ins('INSERT INTO proc_rfq_quotes (rfq_id, supplier_id, delivery_days, total, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?)', rid, sup.id, int(3, 21), 0, 'عرض سعر ساري 30 يومًا', adminId, NOW - 4 * DAY);
          for (const { l, p } of priced) { ins('INSERT INTO proc_rfq_quote_lines (quote_id, request_line_id, unit_price) VALUES (?,?,?)', qid, l.id, p); total += p; }
          run('UPDATE proc_rfq_quotes SET total = ? WHERE id = ?', total, qid); quotes.push(qid); q++;
        }
      }
    }
    if (!count('proc_supplier_ratings')) for (const o of rows("SELECT id, supplier_id FROM proc_orders WHERE status IN ('received', 'ordered') ORDER BY id LIMIT 8")) { ins('INSERT INTO proc_supplier_ratings (supplier_id, order_id, quality, timeliness, price, note, rated_by, created_at) VALUES (?,?,?,?,?,?,?,?)', o.supplier_id, o.id, int(3, 5), int(2, 5), int(3, 5), 'تقييم بعد الاستلام', adminId, NOW - DAY); rate++; }
  });
  return `${rfq} طلب عرض، ${q} عرض، ${rate} تقييم`;
});

/* ================= المراسلات ================= */
await section('قوالب المراسلات', skipIfFilled('corr_templates', () => {
  const defs = [
    ['TPL-LEAVE', 'إجازة إدارية', 'موارد بشرية', 'طلب إجازة', 'طلب الموافقة على إجازة', 'السيد مدير {{unit}} المحترم،\nأرجو الموافقة على منحي إجازة بتاريخ {{date}}.\nمقدّم الطلب: {{name}}', 'sequential'],
    ['TPL-PURCHASE', 'طلب توريد', 'مشتريات', 'طلب توريد مستلزمات', 'توريد مستلزمات للوحدة', 'يرجى توريد المواد الموضحة أدناه لصالح {{unit}} بتاريخ {{date}}.', 'sequential'],
    ['TPL-CIRCULAR', 'تعميم داخلي', 'عام', 'تعميم', 'تعميم إلى جميع الوحدات', 'نعمّم على جميع الوحدات ما يلي بتاريخ {{date}}:', 'parallel'],
    ['TPL-INVITE', 'دعوة اجتماع', 'عام', 'دعوة لحضور اجتماع', 'دعوة لحضور اجتماع', 'تتشرف {{unit}} بدعوتكم لحضور الاجتماع المقرر بتاريخ {{date}}.', 'parallel'],
    ['TPL-THANKS', 'كتاب شكر', 'عام', 'كتاب شكر وتقدير', 'شكر وتقدير', 'نتقدم بالشكر الجزيل إلى {{name}} على جهوده المتميزة.', 'parallel'],
  ];
  for (const [code, name, category, title, subject, body, mode] of defs) run('INSERT INTO corr_templates (code, name, category, title, subject, body, mode, active, builtin, created_at) VALUES (?,?,?,?,?,?,?,1,0,?) ON CONFLICT DO NOTHING', code, name, category, title, subject, body, mode, NOW);
  return defs.length;
}));

/* ================= تقرير التغطية ================= */
const skip = new Set(['schema_migrations', 'import_staging', 'import_staging_chunks', 'idempotency_keys', 'push_subscriptions', 'rate_counters']);
const empties = [];
for (const r of rows("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")) if (!skip.has(r.tablename) && !count(r.tablename)) empties.push(r.tablename);
const total = rows("SELECT tablename FROM pg_tables WHERE schemaname = 'public'").filter((r) => !skip.has(r.tablename)).length;
console.log(`\nجداول مملوءة: ${total - empties.length} من ${total} | ما زال فارغًا (${empties.length}): ${empties.join(' ') || '—'}`);
const dedup = [...new Set(problems)];
console.log(`\nمشكلات (${dedup.length}):\n${dedup.join('\n')}`);
await app.close();
process.exit(0);
