// بيانات تجريبية مكمّلة للوحدات الأحدث، تُشغَّل بعد seed-local-demo.mjs على القاعدة المحلية فقط:
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/suss_dev DEMO_MODE=1 node scripts/seed-local-extra.mjs --confirm
// كل قسم يمر بواجهات الموقع نفسها (الصلاحيات والتحقق والترقيم وسجل التدقيق)، ويُتخطى إن كان جدوله معبأً،
// فيمكن إعادة تشغيله دون تكرار. ويغطي كل حسابات التجربة: لكل حساب ما يراه في شاشاته وإشعاراته.
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
import { resetTieredRateLimit, sha256 } from '../server/security.js';
import { tx } from '../server/db.js';
import { audit } from '../server/audit.js';
import { runDetection } from '../server/services/security_center.js';
import { devAccounts, prepareDevAccount } from '../server/services/dev_accounts.js';

const url = process.env.DATABASE_URL ?? '';
const host = url ? new URL(url).hostname : '';
if (!process.argv.includes('--confirm') || !['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== '1') {
  console.error('يعمل محليًا فقط: قاعدة على هذا الجهاز، وDEMO_MODE=1، و--confirm.');
  process.exit(1);
}

let seedState = 20261113;
const rnd = () => { seedState = (seedState + 0x6d2b79f5) | 0; let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const DAY = 86400000, NOW = Date.now();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysAgo = (n) => dayOf(NOW - n * DAY);
const daysAhead = (n) => dayOf(NOW + n * DAY);
const shuffle = (a) => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };

const app = await createApp();
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
app.limiter.check = () => true;
const base = `http://127.0.0.1:${app.server.address().port}`;
const db = app.db;
const rows = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const count = (t) => Number(one(`SELECT COUNT(*) AS n FROM ${t}`).n);
if (Number(one("SELECT COUNT(*) AS c FROM users WHERE role = 'student'").c) < 50) {
  console.error('شغّل seed-local-demo.mjs أولاً: هذا السكربت يكمّل بياناته.');
  await app.close(); process.exit(1);
}

const problems = [];
// حسابات التجربة كلها موجودة ومهيأة (كما يفعل مبدّل الحسابات المحلي)
for (const a of devAccounts({ db })) { try { await prepareDevAccount({ db, cfg: app.cfg }, a.key); } catch (e) { problems.push(`حساب ${a.key}: ${e.message}`); } }
const section = async (name, table, fn) => {
  if (table && count(table) > 0 && !process.argv.includes('--force')) { console.log(`… ${name}: معبأ مسبقاً`); return; }
  const t = Date.now();
  try { const r = await fn(); console.log(`✓ ${name}${r !== undefined ? ` (${r})` : ''} ${Math.round((Date.now() - t) / 100) / 10}ث`); }
  catch (e) { problems.push(`${name}: ${e.message}`); console.log(`✘ ${name}: ${String(e.message).slice(0, 200)}`); }
};
const cookies = new Map();
const as = (username) => {
  if (cookies.has(username)) return cookies.get(username);
  const u = one('SELECT id FROM users WHERE username = ? AND active = 1', username);
  if (!u) return null;
  const token = `seedx-${u.id}-${crypto.randomBytes(6).toString('hex')}`;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(sha256(token), u.id, NOW + DAY, NOW);
  cookies.set(username, `sid=${token}`);
  return `sid=${token}`;
};
const call = async (who, method, path, body) => {
  resetTieredRateLimit();
  const r = await fetch(base + path, { method, headers: { Cookie: typeof who === 'string' && who.startsWith('sid=') ? who : as(who), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
};
const must = async (label, who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (!r.ok) { problems.push(`${label}: ${r.status} ${r.json?.message ?? r.json?.error ?? ''}`.slice(0, 160)); return null; }
  return r.json;
};
const uid = (username) => Number(one('SELECT id FROM users WHERE username = ?', username)?.id ?? 0);
const staffAccounts = rows("SELECT id, username, display_name, role FROM users WHERE role <> 'student' AND active = 1 ORDER BY id").map((u) => ({ ...u, id: Number(u.id) }));
const students = rows("SELECT u.id, u.student_no AS no, u.display_name AS name, p.status, p.program_id, p.study_level FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.role = 'student' AND u.active = 1 ORDER BY u.id").map((s) => ({ ...s, id: Number(s.id) }));
const active = students.filter((s) => s.status === 'active');
const put = (values) => call('admin', 'PUT', '/api/admin/general', { values });
db.prepare('UPDATE users SET must_change_password = 0').run();

/* ---------- حساب الهيئة التدريسية: يدرّس مقررات فعلية ---------- */
await section('ربط حساب الهيئة التدريسية بمقرراته', null, () => {
  const fd = uid('faculty_demo');
  if (!fd) return 'لا حساب';
  let m = one('SELECT id, name FROM faculty_members WHERE user_id = ?', fd);
  if (!m) {
    m = one('SELECT m.id, m.name FROM faculty_members m WHERE m.user_id IS NULL ORDER BY (SELECT COUNT(*) FROM courses c WHERE c.member_id = m.id) DESC, m.id LIMIT 1');
    db.prepare('UPDATE faculty_members SET user_id = ? WHERE id = ?').run(fd, m.id);
  }
  // خمسة مقررات على الأقل: من غير المسندة، وإلا من أكثر الأعضاء مقررات
  const have = () => Number(one('SELECT COUNT(*) AS n FROM courses WHERE member_id = ?', m.id).n);
  for (const c of rows('SELECT id FROM courses WHERE active = 1 AND member_id IS NULL ORDER BY id LIMIT ?', Math.max(0, 5 - have()))) db.prepare('UPDATE courses SET member_id = ? WHERE id = ?').run(m.id, c.id);
  if (have() < 5) {
    const top = one('SELECT member_id AS id FROM courses WHERE member_id IS NOT NULL AND member_id <> ? GROUP BY member_id ORDER BY COUNT(*) DESC LIMIT 1', m.id);
    for (const c of rows('SELECT id FROM courses WHERE member_id = ? ORDER BY id LIMIT ?', top.id, 5 - have())) db.prepare('UPDATE courses SET member_id = ? WHERE id = ?').run(m.id, c.id);
  }
  return `${m.name}: ${have()} مقررات`;
});
const myCourses = rows('SELECT c.id, c.code, c.name FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE m.user_id = ? ORDER BY c.id', uid('faculty_demo')).map((c) => ({ ...c, id: Number(c.id) }));

/* ---------- التقويم الأكاديمي ---------- */
await section('التقويم الأكاديمي', 'academic_calendar', async () => {
  const ev = [
    { kind: 'term', startDay: daysAgo(70), endDay: daysAhead(45) },
    { kind: 'registration', title: 'التسجيل على المقررات', startDay: daysAgo(80), endDay: daysAgo(66) },
    { kind: 'add_drop', title: 'فترة الحذف والإضافة', startDay: daysAgo(65), endDay: daysAgo(58) },
    { kind: 'exams', title: 'الامتحانات النصفية', startDay: daysAgo(20), endDay: daysAgo(13) },
    { kind: 'exams', title: 'الامتحانات النهائية', startDay: daysAhead(30), endDay: daysAhead(44) },
    { kind: 'holiday', title: 'عطلة رأس السنة', startDay: `${new Date(NOW).getUTCFullYear()}-12-31`, endDay: `${new Date(NOW).getUTCFullYear() + 1}-01-01` },
    { kind: 'event', title: 'يوم الأمن السيبراني المفتوح', startDay: daysAhead(9) },
    { kind: 'event', title: 'ملتقى التوظيف السنوي', startDay: daysAhead(21) },
  ];
  let n = 0;
  for (const e of ev) if (await must('حدث تقويم', 'admin', 'POST', '/api/teaching/calendar', e)) n++;
  return `${n} حدث`;
});

/* ---------- الشعب ---------- */
await section('شعب المقررات', 'course_sections', async () => {
  const taken = rows('SELECT c.code, COUNT(*) AS n FROM student_self_enrollments e JOIN courses c ON c.code = e.course_code GROUP BY c.code ORDER BY n DESC LIMIT 24');
  const halls = ['قاعة 101', 'قاعة 102', 'مدرج A', 'مختبر الشبكات', 'مختبر البرمجة', 'قاعة 205'];
  const members = rows('SELECT name FROM faculty_members ORDER BY id').map((m) => m.name);
  let n = 0;
  for (const c of taken) for (const [i, name] of ['أ', 'ب'].entries()) {
    if (await must('شعبة', 'admin', 'POST', '/api/enterprise/sections', { courseCode: c.code, name, capacity: int(25, 45), instructor: pick(members), hall: pick(halls), schedule: `${pick(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'])} ${['08:00', '10:00', '12:00'][i % 3]}` })) n++;
  }
  return `${n} شعبة`;
});

/* ---------- مكونات العلامات وإعلان النتائج ---------- */
await section('مكونات العلامات', 'course_grade_components', async () => {
  const free = rows('SELECT c.id FROM courses c WHERE c.active = 1 AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.course_id = c.id) ORDER BY c.id LIMIT 12');
  const sets = [
    [['أعمال الفصل', 'theory', 20], ['العملي', 'practical', 20], ['الامتحان النهائي', 'theory', 60]],
    [['المذاكرة', 'theory', 15], ['المشروع', 'practical', 25], ['الامتحان النهائي', 'theory', 60]],
    [['حلقات البحث', 'theory', 10], ['المختبر', 'practical', 30], ['الامتحان النهائي', 'theory', 60]],
  ];
  let n = 0;
  for (const [i, c] of free.entries()) if (await must('مكونات', 'admin', 'PUT', `/api/courses/${c.id}/components`, { components: sets[i % 3].map(([name, kind, max]) => ({ name, kind, max })) })) n++;
  // علامات بمكوناتها لطلاب مسجلين في مقرر من هذه المقررات
  let marks = 0;
  const year = (await call('admin', 'GET', '/api/grades/results')).json?.year;
  for (const c of free.slice(0, 4)) {
    const comps = rows('SELECT id, max_mark FROM course_grade_components WHERE course_id = ? ORDER BY seq, id', c.id);
    const course = one('SELECT program_id, level FROM courses WHERE id = ?', c.id);
    for (const s of shuffle(active.filter((x) => Number(x.program_id) === Number(course.program_id))).slice(0, 8)) {
      const components = Object.fromEntries(comps.map((k) => [k.id, int(Math.ceil(Number(k.max_mark) * 0.45), Number(k.max_mark))]));
      if ((await call('admin', 'POST', `/api/students/${s.id}/grades`, { courseId: c.id, academicYear: year, components })).ok) marks++;
    }
  }
  return `${n} مقرر، ${marks} علامة بمكوناتها`;
});
await section('إعلان النتائج وقفلها', 'grade_locks', async () => {
  const r = await must('ملخص النتائج', 'admin', 'GET', '/api/grades/results');
  // تُستكمل مراحل علامات أكثر المقررات اعتماداً (مسودة ← مراجعة ← اعتماد) ثم تُعلن نتيجتها
  // علامات المقرر المسند يعتمدها مدرّسه وحده، فتُعلن نتائج مقررات حساب الهيئة التدريسية
  const mine = new Set(myCourses.map((c) => c.id));
  const near = (r?.courses ?? []).filter((c) => c.total > 0 && !c.lockedAt && mine.has(Number(c.courseId))).slice(0, 4);
  for (const c of near) for (const [from, stage] of [['draft', 'reviewed'], ['reviewed', 'approved']]) {
    const ids = rows('SELECT id FROM grades WHERE course_id = ? AND academic_year = ? AND workflow_status = ?', c.courseId, r.year, from).map((x) => Number(x.id));
    // فصل المهام: من أدخل العلامة أو راجعها لا يعتمدها، فتُجرَّب حسابات مختلفة لكل مرحلة
    if (!ids.length) continue;
    let ok = false;
    for (const who of stage === 'reviewed' ? ['exams', 'of_studies', 'admin'] : ['faculty_demo', 'academic', 'of_studies', 'exams']) if ((await call(who, 'POST', '/api/grades/workflow', { stage, gradeIds: ids })).ok) { ok = true; break; }
    if (!ok) problems.push(`مراحل علامات ${c.name}: لم يقبل أي حساب مرحلة ${stage}`);
  }
  const after = (await call('admin', 'GET', `/api/grades/results?year=${encodeURIComponent(r.year)}`)).json;
  const ready = (after?.courses ?? []).filter((c) => c.total > 0 && c.approved === c.total && !c.lockedAt).slice(0, 6);
  let n = 0;
  for (const c of ready) if (await must('قفل نتيجة', 'exams', 'POST', '/api/grades/results/lock', { courseId: c.courseId, academicYear: r.year }) ?? await must('قفل نتيجة', 'admin', 'POST', '/api/grades/results/lock', { courseId: c.courseId, academicYear: r.year })) n++;
  return `${n} مقرر أُعلنت نتيجته`;
});

/* ---------- التدريس: تغيير المحاضرات والغياب ---------- */
await section('إلغاء المحاضرات وتعويضها', 'lecture_changes', async () => {
  let n = 0;
  for (const [i, c] of myCourses.slice(0, 5).entries()) {
    const kind = i % 2 ? 'makeup' : 'cancel', d = 2 + i * 2;
    const body = { courseId: c.id, kind, lectureDay: daysAhead(d), start: '10:00', end: '12:00', makeupDay: daysAhead(d + 2), makeupStart: '12:00', makeupEnd: '14:00', makeupHall: pick(['قاعة 101', 'مدرج A', 'قاعة 205']), reason: pick(['مشاركة في مؤتمر علمي', 'تكليف بلجنة امتحانية', 'عطل في تجهيزات القاعة']) };
    if (await must('تغيير محاضرة', 'faculty_demo', 'POST', '/api/teaching/lecture-changes', body)) n++;
  }
  return `${n} تغيير`;
});
await section('الغياب والحرمان', 'course_deprivations', async () => {
  const c = myCourses[0];
  if (!c) return 'لا مقررات للمدرّس';
  const course = one('SELECT * FROM courses WHERE id = ?', c.id);
  const roster = shuffle(active.filter((s) => Number(s.program_id) === Number(course.program_id))).slice(0, 14);
  // عشر محاضرات في الفصل: أغلب الطلاب حضروا، واثنان غابا كثيراً، وثلاثة غابوا نصف الحد
  const absentMost = new Set(roster.slice(0, 2).map((s) => s.id)), absentSome = new Set(roster.slice(2, 5).map((s) => s.id));
  tx(db, () => {
    const ins = db.prepare('INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, exited_at, method, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)');
    for (let k = 0; k < 10; k++) {
      const at = NOW - (k * 4 + 3) * DAY + 8 * 3600_000;
      for (const s of roster) {
        if (absentMost.has(s.id) && k % 4 !== 0) continue;
        if (absentSome.has(s.id) && k % 6 === 1) continue;
        ins.run(s.id, 'course', c.id, c.name, 'قاعة 101', at, at + 90 * 60000, 'barcode', uid('faculty_demo'));
      }
    }
    // الطلاب ضمن المقرر: مسجلون فيه هذا الفصل
    const term = one("SELECT value FROM site_settings WHERE key = 'academic.current_semester'")?.value ?? 'الفصل الأول';
    const insE = db.prepare("INSERT INTO student_self_enrollments (student_no, student_name, course_code, course_name, credits, semester, prerequisite_code, status, registered_at) SELECT ?, ?, ?, ?, ?, ?, '', 'مسجل ومعتمد آلياً', ? WHERE NOT EXISTS (SELECT 1 FROM student_self_enrollments WHERE student_no = ? AND course_code = ?)");
    const ay = one("SELECT value FROM site_settings WHERE key = 'academic.current_year'")?.value;
    for (const s of roster) insE.run(s.no, s.name, c.code, c.name, Number(course.hours) || 3, `${term} ${ay ?? ''}`.trim(), NOW, s.no, c.code);
  });
  const rep = await must('تقرير الغياب', 'faculty_demo', 'GET', `/api/teaching/absence/${c.id}`);
  const warned = (await call('faculty_demo', 'POST', `/api/teaching/absence/${c.id}/warn`)).json?.warned ?? 0;
  // الحرمان لمن غاب فعلاً فوق الحد، لا لمن لا سجل حضور له في هذه المعاينة
  const over = (rep?.rows ?? []).filter((r) => r.overLimit && absentMost.has(r.studentId)).map((r) => r.studentId);
  const dep = over.length ? (await call('faculty_demo', 'POST', `/api/teaching/absence/${c.id}/deprive`, { studentIds: over })).json?.deprived ?? 0 : 0;
  return `${rep?.held ?? 0} محاضرة، ${warned} إنذار، ${dep} حرمان`;
});

/* ---------- قوالب المراسلات (تُهيأ عند أول قراءة) ---------- */
await section('قوالب المراسلات', 'corr_templates', async () => { await must('القوالب', 'admin', 'GET', '/api/corr/templates'); return `${count('corr_templates')} قالب`; });

/* ---------- الموازنة ---------- */
await section('الموازنة', 'fin_budgets', async () => {
  const year = one("SELECT id FROM fin_years WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  const ccs = rows('SELECT id FROM fin_cost_centers WHERE active = 1 ORDER BY id LIMIT 6');
  const accs = rows("SELECT id FROM fin_accounts WHERE active = 1 AND postable = 1 AND type = 'expense' ORDER BY id LIMIT 5");
  if (!year || !ccs.length || !accs.length) return 'لا سنة مالية أو مراكز كلفة';
  const ids = [];
  for (const cc of ccs) for (const acc of accs.slice(0, 3)) {
    const r = await must('بند موازنة', 'admin', 'POST', '/api/finance/budgets', { yearId: year.id, costCenterId: cc.id, accountId: acc.id, amount: int(20, 120) * 1000000 });
    if (r?.budget?.id) ids.push(r.budget.id);
  }
  let approved = 0;
  for (const id of ids.slice(0, Math.ceil(ids.length * 0.8))) if ((await call('finance', 'POST', `/api/finance/budgets/${id}/approve`)).ok || (await call('of_finance', 'POST', `/api/finance/budgets/${id}/approve`)).ok) approved++;
  const ok = rows("SELECT id FROM fin_budgets WHERE status = 'approved' ORDER BY id").map((x) => Number(x.id));
  let transfers = 0;
  for (let i = 0; i + 1 < ok.length && transfers < 4; i += 2) if ((await call('admin', 'POST', '/api/finance/budgets/transfer', { fromId: ok[i], toId: ok[i + 1], amount: int(1, 5) * 1000000, reason: pick(['تعزيز بند الصيانة', 'تغطية تجهيزات المخابر', 'نقل وفر من بند القرطاسية']) })).ok) transfers++;
  return `${ids.length} بند، ${approved} معتمد، ${transfers} مناقلة`;
});

/* ---------- المشتريات: الاعتماد المرحلي وعروض الأسعار والتقييم وفواتير الشراء ---------- */
for (const [key, perm] of [['head_finance', 'procurement:approve_finance'], ['head_admin_aff', 'procurement:approve_top']]) {
  const u = one('SELECT id, custom_permissions_json FROM users WHERE role_key = ? AND active = 1 ORDER BY id LIMIT 1', key);
  if (!u) continue;
  let cur = []; try { cur = JSON.parse(u.custom_permissions_json || '[]'); } catch { /* */ }
  if (!cur.includes(perm)) db.prepare('UPDATE users SET custom_permissions_json = ? WHERE id = ?').run(JSON.stringify([...cur, perm]), u.id);
}
const P = '/api/procurement';
const approveStaged = async (id, requester) => {
  const used = new Set([uid(requester)]);
  const order = ['admin', 'procure', 'finance', 'admin_aff'];
  for (let k = 0; k < 3; k++) {
    const g = (await call('admin', 'GET', `${P}/requests/${id}`)).json?.request;
    if (!g || g.status !== 'pending') return g?.status === 'approved';
    let done = false;
    for (const who of order) {
      if (used.has(uid(who))) continue;
      const r = await call(who, 'POST', `${P}/requests/${id}/approve`, { note: 'معتمد' });
      if (r.ok) { used.add(uid(who)); done = true; break; }
    }
    if (!done) return false;
  }
  return (await call('admin', 'GET', `${P}/requests/${id}`)).json?.request?.status === 'approved';
};
await section('اعتماد طلبات الشراء القائمة', 'proc_request_approvals', async () => {
  let n = 0;
  for (const r of rows("SELECT id, requester_id FROM proc_requests WHERE status = 'pending' ORDER BY id")) {
    const req = one('SELECT username FROM users WHERE id = ?', r.requester_id)?.username ?? 'procure';
    if (chance(0.6) && await approveStaged(r.id, req)) n++;
  }
  return `${n} طلب اعتُمد بمراحله`;
});
await section('طلبات عروض الأسعار والترسية', 'proc_rfqs', async () => {
  const items = rows('SELECT id, name, unit FROM proc_items ORDER BY id LIMIT 20');
  const sups = rows('SELECT id FROM proc_suppliers WHERE active = 1 ORDER BY id').map((x) => Number(x.id));
  if (items.length < 3 || sups.length < 3) return 'لا أصناف أو موردون';
  let rfqs = 0, awarded = 0;
  for (let i = 0; i < 6; i++) {
    const its = shuffle(items).slice(0, 2);
    const req = await must('طلب لعرض أسعار', 'procure', 'POST', `${P}/requests`, { title: `توريد ${its[0].name} (مناقصة ${i + 1})`, description: 'طلب بعروض أسعار', submit: true, lines: its.map((it) => ({ itemId: it.id, description: it.name, qty: int(10, 40), estCost: int(5, 60) * 10000 })) });
    const id = req?.request?.id; if (!id) continue;
    if (!(await approveStaged(id, 'procure'))) continue;
    const rfq = await must('طلب عروض', 'procure', 'POST', `${P}/rfqs`, { requestId: id, closesOn: daysAhead(int(3, 14)) }) ?? await must('طلب عروض', 'admin', 'POST', `${P}/rfqs`, { requestId: id, closesOn: daysAhead(int(3, 14)) });
    const rfqId = rfq?.id; if (!rfqId) continue;
    rfqs++;
    const lines = rows('SELECT id, est_cost FROM proc_request_lines WHERE request_id = ? ORDER BY id', id);
    const quotes = [];
    for (const s of shuffle(sups).slice(0, 3)) {
      const q = await call('procure', 'POST', `${P}/rfqs/${rfqId}/quotes`, { supplierId: s, prices: Object.fromEntries(lines.map((l) => [l.id, Math.round(Number(l.est_cost) * (0.8 + rnd() * 0.4))])), deliveryDays: int(3, 30), note: pick(['يشمل التوصيل', 'كفالة سنة', '']) });
      const qq = q.ok ? q : await call('admin', 'POST', `${P}/rfqs/${rfqId}/quotes`, { supplierId: s, prices: Object.fromEntries(lines.map((l) => [l.id, Math.round(Number(l.est_cost) * (0.8 + rnd() * 0.4))])), deliveryDays: int(3, 30) });
      if (qq.ok) quotes.push(qq.json);
    }
    if (i % 3 === 2 || !quotes.length) continue;                // يبقى بعضها مفتوحاً
    const best = [...quotes].sort((a, b) => a.total - b.total)[0];
    const w = await call('procure', 'POST', `${P}/rfqs/${rfqId}/award`, { quoteId: best.id });
    if (w.ok || (await call('admin', 'POST', `${P}/rfqs/${rfqId}/award`, { quoteId: best.id })).ok) awarded++;
  }
  return `${rfqs} طلب عروض، ${awarded} ترسية`;
});
await section('تقييم الموردين', 'proc_supplier_ratings', async () => {
  let n = 0;
  for (const o of rows("SELECT DISTINCT o.id FROM proc_orders o JOIN proc_receipts r ON r.order_id = o.id ORDER BY o.id LIMIT 8")) if ((await call('procure', 'POST', `${P}/supplier-ratings`, { orderId: o.id, quality: int(3, 5), timeliness: int(2, 5), price: int(2, 5), note: pick(['التزام جيد', 'تأخر يومين في التسليم', 'جودة ممتازة']) })).ok || (await call('admin', 'POST', `${P}/supplier-ratings`, { orderId: o.id, quality: int(3, 5), timeliness: int(2, 5), price: int(2, 5) })).ok) n++;
  return `${n} تقييم`;
});
await section('فواتير الشراء والمطابقة الثلاثية', 'fin_invoice_lines', async () => {
  let n = 0, matched = 0;
  for (const o of rows("SELECT DISTINCT o.id FROM proc_orders o JOIN proc_receipts r ON r.order_id = o.id WHERE NOT EXISTS (SELECT 1 FROM fin_invoices i WHERE i.order_id = o.id) ORDER BY o.id LIMIT 6")) {
    const lines = rows('SELECT id, qty, unit_cost FROM proc_order_lines WHERE order_id = ? ORDER BY id', o.id);
    const r = await must('فاتورة شراء', 'finance', 'POST', '/api/finance/invoices', { kind: 'purchase', orderId: o.id, supplierRef: `INV-${int(1000, 9999)}`, lines: lines.map((l) => ({ orderLineId: l.id, qty: Number(l.qty), unitPrice: Number(l.unit_cost) })) })
      ?? await must('فاتورة شراء', 'admin', 'POST', '/api/finance/invoices', { kind: 'purchase', orderId: o.id, supplierRef: `INV-${int(1000, 9999)}`, lines: lines.map((l) => ({ orderLineId: l.id, qty: Number(l.qty), unitPrice: Number(l.unit_cost) })) });
    const inv = r?.invoice ?? r; if (!inv?.id) continue;
    n++;
    if (one('SELECT match_status FROM fin_invoices WHERE id = ?', inv.id)?.match_status === 'matched') matched++;
  }
  return `${n} فاتورة، ${matched} مطابقة`;
});

/* ---------- التوظيف ---------- */
await section('التوظيف والمقابلات', 'hr_vacancies', async () => {
  const hr = (await call('hr', 'GET', '/api/recruitment')).ok ? 'hr' : 'admin';
  const vac = [['مهندس شبكات', 'إجازة في هندسة الاتصالات وخبرة سنتين'], ['محاضر في الأمن السيبراني', 'دكتوراه في أمن المعلومات'], ['محاسب', 'إجازة في المحاسبة'], ['أمين مكتبة', 'إجازة في المكتبات والمعلومات'], ['فني مختبر', 'معهد تقاني حاسوب']];
  const first = ['محمد', 'سارة', 'علي', 'ريم', 'يوسف', 'نور', 'خالد', 'هبة', 'عمر', 'لمى', 'باسل', 'دانة'], last = ['الحسن', 'الخطيب', 'العلي', 'الشامي', 'المصري', 'الحلبي', 'النعيمي', 'السيد'];
  let apps = 0, hired = 0, ivs = 0;
  for (const [vi, [title, requirements]] of vac.entries()) {
    const v = await must('شاغر', hr, 'POST', '/api/recruitment/vacancies', { title, positions: int(1, 2), requirements, closesOn: daysAhead(int(10, 40)) });
    if (!v?.id) continue;
    const list = [];
    for (let k = 0; k < int(3, 5); k++) {
      const r = await call(hr, 'POST', `/api/recruitment/vacancies/${v.id}/applicants`, { name: `${pick(first)} ${pick(first)} ${pick(last)}`, nationalId: String(int(10000000000, 99999999999)), phone: `09${int(10000000, 99999999)}`, qualification: requirements.split(' ')[0] + ' ' + requirements.split(' ')[1], experience: int(0, 9) });
      if (r.ok) { apps++; list.push(r.json?.id); }
    }
    const appl = rows('SELECT id FROM hr_applicants WHERE vacancy_id = ? ORDER BY id', v.id).map((x) => Number(x.id));
    for (const [k, a] of appl.entries()) {
      if (k === appl.length - 1) { await call(hr, 'POST', `/api/recruitment/applicants/${a}/move`, { status: 'rejected', note: 'لا يستوفي الشروط' }); continue; }
      await call(hr, 'POST', `/api/recruitment/applicants/${a}/move`, { status: 'shortlisted' });
      if (k > 1) continue;
      await call(hr, 'POST', `/api/recruitment/applicants/${a}/move`, { status: 'interview' });
      const iv = await call(hr, 'POST', `/api/recruitment/applicants/${a}/interviews`, { at: `${daysAhead(k === 0 ? -3 : 4)}T10:00`, panel: 'رئيس القسم، مدير الموارد البشرية، ممثل الكلية' });
      if (!iv.ok) continue;
      ivs++;
      if (k === 0) {
        await call(hr, 'POST', `/api/recruitment/interviews/${iv.json.id}/result`, { score: int(75, 95), recommendation: 'hire', notes: 'أداء متميز في المقابلة' });
        await call(hr, 'POST', `/api/recruitment/applicants/${a}/move`, { status: 'offered' });
        if (vi < 2 && (await call(hr, 'POST', `/api/recruitment/applicants/${a}/hire`, { baseSalary: int(7, 14) * 100000 })).ok) hired++;
      }
    }
    if (vi === 4) await call(hr, 'POST', `/api/recruitment/vacancies/${v.id}/close`, { note: 'أُغلق لانتهاء الحاجة' });
  }
  return `${vac.length} شاغر، ${apps} متقدم، ${ivs} مقابلة، ${hired} تعيين`;
});

/* ---------- المرافق: القاعات والحجوزات والصيانة (لكل الحسابات) ---------- */
await section('المرافق والقاعات', 'facility_rooms', async () => {
  const rooms = [['قاعة المؤتمرات الكبرى', 'المبنى الإداري', 120], ['قاعة الاجتماعات 1', 'المبنى الإداري', 20], ['قاعة الاجتماعات 2', 'كلية الأمن السيبراني', 16], ['مدرج الندوات', 'المبنى B', 200], ['قاعة التدريب', 'مركز الحاسوب', 30], ['مختبر الابتكار', 'كلية الأمن السيبراني', 24]];
  let n = 0;
  for (const [name, building, capacity] of rooms) if (await must('قاعة', 'admin', 'POST', '/api/facilities/rooms', { name, building, capacity, equipment: pick(['جهاز عرض وسماعات', 'شاشة تفاعلية', 'نظام مؤتمرات مرئية']) })) n++;
  return `${n} قاعة`;
});
await section('حجوزات القاعات', 'room_bookings', async () => {
  const rooms = rows('SELECT id, capacity FROM facility_rooms WHERE active = 1 ORDER BY id').map((r) => ({ id: Number(r.id), cap: Number(r.capacity) }));
  const titles = ['اجتماع القسم الدوري', 'ورشة تدريبية', 'ندوة علمية', 'مقابلات التوظيف', 'اجتماع لجنة الجودة', 'محاضرة ضيف', 'تدريب على النظام', 'لقاء الطلاب المستجدين'];
  let n = 0, decided = 0, slot = 0;
  for (const u of staffAccounts) {
    const room = rooms[slot % rooms.length], d = daysAhead(1 + (slot % 12)), h = 8 + (Math.floor(slot / rooms.length) % 5) * 2;
    slot++;
    const r = await call(u.username, 'POST', '/api/facilities/bookings', { roomId: room.id, day: d, start: `${String(h).padStart(2, '0')}:00`, end: `${String(h + 1).padStart(2, '0')}:30`, title: pick(titles), attendees: Math.min(room.cap, int(5, 25)) });
    if (!r.ok) continue;
    n++;
    const id = r.json?.id ?? r.json?.booking?.id;
    if (id && chance(0.7)) if ((await call('admin', 'POST', `/api/facilities/bookings/${id}/decide`, { decision: chance(0.85) ? 'approved' : 'rejected', note: 'وفق جدول الإشغال' })).ok) decided++;
  }
  return `${n} حجز، ${decided} بُتّ فيه`;
});
await section('أوامر الصيانة', 'maintenance_orders', async () => {
  const cats = ['كهرباء', 'سباكة', 'تكييف وتدفئة', 'نجارة وأثاث', 'شبكات واتصالات', 'أجهزة حاسوب', 'نظافة'];
  const places = ['المبنى الإداري، الطابق الأول', 'كلية الأمن السيبراني، المخبر 3', 'المكتبة المركزية', 'المدرج A', 'مبنى السكن، الجناح ب', 'مركز الحاسوب', 'قاعة 205'];
  const techs = ['it_sec', 'safety', 'of_support'].map(uid).filter(Boolean);
  let n = 0, done = 0;
  for (const [i, u] of shuffle(staffAccounts).slice(0, 24).entries()) {
    const cat = pick(cats);
    const r = await call(u.username, 'POST', '/api/facilities/maintenance', { location: pick(places), category: cat, priority: pick(['normal', 'normal', 'urgent', 'emergency']), description: `${{ 'كهرباء': 'انقطاع التيار عن المقابس', 'سباكة': 'تسرب مياه في المغسلة', 'تكييف وتدفئة': 'المكيف لا يبرد', 'نجارة وأثاث': 'كراسٍ مكسورة', 'شبكات واتصالات': 'لا اتصال بالشبكة', 'أجهزة حاسوب': 'الحاسوب لا يقلع', 'نظافة': 'حاجة لتنظيف عاجل' }[cat]}` });
    if (!r.ok) continue;
    n++;
    const id = r.json?.id ?? r.json?.order?.id; if (!id || i % 4 === 3) continue;
    const tech = techs[i % techs.length];
    if (!(await call('admin', 'POST', `/api/facilities/maintenance/${id}/action`, { action: 'assign', assigneeId: tech })).ok) continue;
    if (i % 4 === 2) continue;
    const t = one('SELECT username FROM users WHERE id = ?', tech).username;
    if ((await call(t, 'POST', `/api/facilities/maintenance/${id}/action`, { action: 'done', note: 'تم الإصلاح والتجربة', cost: int(1, 30) * 5000 })).ok) {
      done++;
      if (i % 2 === 0) await call(u.username, 'POST', `/api/facilities/maintenance/${id}/action`, { action: 'close' });
    }
  }
  return `${n} أمر، ${done} منجز`;
});

/* ---------- المجالس: كل الحسابات أعضاء في مجلس أو لجنة ---------- */
await section('المجالس واللجان لكل الحسابات', 'council_recusals', async () => {
  const groups = [
    ['مجلس الجامعة', 'university', ['admin', 'academic', 'admin_aff', 'finance', 'hr', 'quality', 'research', 'legal']],
    ['لجنة شؤون الطلاب', 'other', ['affairs', 'sa_registry', 'sa_services', 'sa_care', 'of_admission', 'of_studies', 'of_docs', 'of_leaves', 'of_housing', 'staff1']],
    ['لجنة الامتحانات والتظلمات', 'exams', ['exams', 'of_studies', 'of_grievance', 'faculty_demo', 'discipline', 'auditor1']],
    ['لجنة الخدمات والدعم', 'other', ['it_sec', 'safety', 'of_support', 'library', 'media', 'alumni', 'of_alumni', 'of_counsel', 'of_activities', 'of_special', 'of_archive', 'of_finance', 'procure', 'admission']],
  ];
  let councils = 0, meetings = 0, decisions = 0, tasks = 0;
  for (const [name, type, members] of groups) {
    const ids = members.map((u) => ({ u, id: uid(u) })).filter((x) => x.id);
    if (ids.length < 4) continue;
    const c = await must('مجلس', 'admin', 'POST', '/api/councils', { name, type, quorumPercent: 50 });
    const cid = c?.id ?? c?.council?.id; if (!cid) continue;
    councils++;
    const [chair, sec, ...rest] = ids;
    await call('admin', 'POST', `/api/councils/${cid}/members`, { userId: chair.id, role: 'chair' });
    await call('admin', 'POST', `/api/councils/${cid}/members`, { userId: sec.id, role: 'secretary' });
    for (const [k, m] of rest.entries()) await call('admin', 'POST', `/api/councils/${cid}/members`, { userId: m.id, role: k === 0 ? 'rapporteur' : 'member' });
    // اجتماع منعقد مغلق بمحضره، واجتماع قادم مجدول
    const past = await call(sec.u, 'POST', `/api/councils/${cid}/meetings`, { title: `الاجتماع الدوري — ${name}`, meetingAt: `${daysAgo(6)}T10:00`, location: 'قاعة المجلس', items: [{ title: 'اعتماد محضر الاجتماع السابق' }, { title: 'دراسة المقترحات المحالة' }, { title: 'ما يستجد من أعمال' }] });
    const mid = past.json?.id ?? past.json?.meeting?.id;
    if (mid) {
      meetings++;
      await call(sec.u, 'POST', `/api/council-meetings/${mid}/schedule`);
      const present = ids.filter((_, k) => k === 0 || k === 1 || k % 5 !== 4).map((x) => x.id);
      await call(sec.u, 'POST', `/api/council-meetings/${mid}/attendance`, { present });
      const items = rows('SELECT id FROM council_items WHERE meeting_id = ? ORDER BY seq, id', mid).map((x) => Number(x.id));
      const voters = present.filter((p) => p !== sec.id);
      if (items[1] && rest[1]) await call(rest[1].u, 'POST', `/api/council-items/${items[1]}/recuse`, { reason: 'صلة بموضوع البند' });
      for (const [k, it] of items.entries()) {
        const n = voters.length - (k === 1 ? 1 : 0);
        const outcome = k === 2 ? 'deferred' : 'approved';
        const r = await call(chair.u, 'POST', `/api/council-items/${it}/decide`, outcome === 'approved' ? { outcome, votesFor: n, text: k === 0 ? 'المصادقة على المحضر' : 'الموافقة على المقترحات وإحالتها للتنفيذ' } : { outcome, text: 'يؤجل لاستكمال الدراسة' });
        if (!r.ok) continue;
        decisions++;
        if (outcome === 'approved' && k === 1) for (const m of rest.slice(1, 4)) {
          const t = await call(chair.u, 'POST', `/api/council-items/${it}/tasks`, { assigneeId: m.id, title: pick(['إعداد تقرير تنفيذي', 'تعميم القرار على الأقسام', 'متابعة التنفيذ مع الجهات المعنية']), dueDay: daysAhead(int(-3, 20)) });
          if (t.ok) { tasks++; if (chance(0.4)) await call(m.u, 'POST', `/api/council-tasks/${t.json.id}/done`, { note: 'نُفذ وأُرسل الكتاب' }); }
        }
      }
      await call(sec.u, 'POST', `/api/council-meetings/${mid}/close`, { minutes: `عُقد الاجتماع الدوري لـ${name} بحضور الأغلبية، ونوقشت البنود المدرجة واتُخذت القرارات المبينة في هذا المحضر.` });
    }
    const next = await call(sec.u, 'POST', `/api/councils/${cid}/meetings`, { title: `الاجتماع القادم — ${name}`, meetingAt: `${daysAhead(int(3, 12))}T11:00`, location: 'قاعة الاجتماعات 1', items: [{ title: 'متابعة تنفيذ القرارات السابقة' }, { title: 'الخطة الفصلية' }] });
    const nid = next.json?.id ?? next.json?.meeting?.id;
    if (nid) { meetings++; await call(sec.u, 'POST', `/api/council-meetings/${nid}/schedule`); }
  }
  return `${councils} مجلس، ${meetings} اجتماع، ${decisions} قرار، ${tasks} مهمة`;
});

/* ---------- شؤون الطلاب: إيقاف البطاقة والتجديد والترفيع والتظلمات وحركات القيد ---------- */
await section('إيقاف البطاقات الجامعية', 'card_blocks', async () => {
  let n = 0;
  for (const [i, s] of shuffle(active).slice(0, 8).entries()) if ((await call(i % 2 ? 'of_docs' : 'admin', 'POST', `/api/students/${s.id}/card/block`, { reason: ['lost', 'stolen', 'damaged', 'admin'][i % 4], note: ['أبلغ الطالب عن الفقدان', 'محضر سرقة من الشرطة', 'البطاقة مكسورة', 'قرار إداري مؤقت'][i % 4] })).ok || (await call('admin', 'POST', `/api/students/${s.id}/card/block`, { reason: 'lost' })).ok) n++;
  return `${n} بطاقة`;
});
await section('تجديد القيد السنوي', 'sa_enrollment_renewals', async () => {
  await put({ 'reg.renewal_open': daysAgo(30), 'reg.renewal_close': daysAhead(20) });
  let n = 0;
  for (const s of shuffle(active).slice(0, 180)) if ((await call('admin', 'POST', '/api/student-regulations/renew', { studentId: s.id })).ok) n++;
  // الطالب التجريبي يجدد بنفسه إن لم يُجدَّد له
  const demo = one("SELECT id FROM users WHERE username = 'CYB-2026-0001'");
  if (demo) { const c = as('CYB-2026-0001'); if ((await call(c, 'POST', '/api/student-regulations/renew', {})).ok) n++; }
  return `${n} طالب`;
});
await section('الترفيع السنوي', 'sa_promotions', async () => {
  const pv = await must('معاينة الترفيع', 'admin', 'GET', '/api/student-regulations/promotion');
  const ids = (pv?.rows ?? []).filter((r) => r.eligible).slice(0, 60).map((r) => r.id);
  if (!ids.length) return 'لا مؤهلين';
  const r = await must('ترفيع', 'admin', 'POST', '/api/student-regulations/promotion/apply', { studentIds: ids });
  return `${r?.promoted ?? 0} طالب`;
});
await section('التظلم من القرارات الانضباطية', 'sa_disciplinary_appeals', async () => {
  await put({ 'reg.appeal_warning': true });
  let n = 0, decided = 0;
  for (const d of rows("SELECT d.hold_id, u.username FROM sa_disciplinary_details d JOIN users u ON u.id = d.student_id ORDER BY d.hold_id")) {
    const r = await call(d.username, 'POST', '/api/student-regulations/appeals', { holdId: d.hold_id, reason: 'لم أكن طرفاً في المخالفة، وأرفق شهادة المراقب.' });
    if (!r.ok) { problems.push(`تظلم ${d.username}: ${r.json?.message}`.slice(0, 140)); continue; }
    n++;
    if (n % 2 === 1 && (await call('admin', 'POST', `/api/student-regulations/appeals/${r.json.id}/decide`, { outcome: 'reduced', note: 'خُففت العقوبة إلى إنذار لعدم كفاية الأدلة' })).ok) decided++;
  }
  return `${n} تظلم، ${decided} بُتّ فيه`;
});
await section('حركات القيد بسلسلة الاعتماد', 'sa_movement_steps', async () => {
  let n = 0;
  const free = active.filter((s) => !one("SELECT 1 AS x FROM sa_lifecycle_movements WHERE student_id = ? AND status = 'pending'", s.id));
  for (const [i, s] of shuffle(free).slice(0, 8).entries()) {
    const type = ['postponement', 'withdrawal', 'postponement', 'program_transfer'][i % 4];
    const other = rows('SELECT id FROM programs WHERE active = 1 AND id <> ? ORDER BY id LIMIT 1', s.program_id)[0];
    const r = await call('affairs', 'POST', '/api/student-affairs-suite/lifecycle', { studentId: s.id, movementType: type, reason: pick(['ظروف صحية موثقة', 'ظروف عائلية', 'رغبة الطالب بتغيير الاختصاص', 'السفر للعمل']), decisionNo: `ق/${int(100, 999)}`, durationSemesters: 2, toProgramId: type === 'program_transfer' ? other?.id : undefined });
    if (r.ok || (await call('admin', 'POST', '/api/student-affairs-suite/lifecycle', { studentId: s.id, movementType: type, reason: 'ظروف صحية موثقة', durationSemesters: 2, toProgramId: type === 'program_transfer' ? other?.id : undefined })).ok) n++;
  }
  return `${n} حركة بانتظار الاعتماد`;
});

/* ---------- مركز الأمان ---------- */
await section('مركز الأمان', 'security_alerts', () => {
  runDetection(db);
  const ips = ['185.220.101.4', '45.155.205.33', '91.240.118.17'];
  for (let i = 0; i < 16; i++) audit(db, null, 'دخول مرفوض', pick(['admin', 'finance', 'hr', 'affairs', 'exams', 'it_sec', 'procure']), ips[0]);
  for (const ip of ips.slice(1)) for (let i = 0; i < 3; i++) audit(db, null, 'دخول مرفوض', 'finance', ip);
  audit(db, { id: uid('admin'), label: 'مدير النظام', role: 'admin' }, 'تسجيل دخول', '', '10.20.30.40');
  audit(db, { id: uid('admin'), label: 'مدير النظام', role: 'admin' }, 'تعطيل التحقق بخطوتين', 'of_finance', '10.20.30.40');
  db.prepare("INSERT INTO security_events (at, kind, severity, ip, subject, detail) VALUES (?, 'waf_ban', 'medium', ?, ?, ?)").run(NOW - 3600_000, '203.0.113.50', '203.0.113.50', 'scanner_agent /wp-login.php');
  runDetection(db);
  return `${count('security_alerts')} تنبيه`;
});

/* ---------- لكل حساب ما يراه: إشعار ومراسلة على الأقل ---------- */
await section('تغطية كل الحسابات', null, async () => {
  let added = 0;
  const ins = db.prepare("INSERT INTO user_notifications (user_id, kind, ref_id, text, url, at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT DO NOTHING");
  const texts = ['تذكير: اجتماع لجنتكم القادم مدرج في المجالس واللجان.', 'صدر تعميم جديد بشأن الدوام في فترة الامتحانات.', 'تم تحديث دليل الإجراءات في شاشة الأدلة.', 'لديكم مهام مفتوحة في المجالس واللجان.'];
  for (const u of staffAccounts) {
    const have = Number(one('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ?', u.id).n);
    for (let k = have; k < 3; k++) { ins.run(u.id, 'demo_notice', 900000 + u.id * 10 + k, texts[(u.id + k) % texts.length], NOW - k * 3600_000); added++; }
  }
  for (const s of shuffle(active).slice(0, 120)) {
    if (Number(one('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ?', s.id).n) > 0) continue;
    ins.run(s.id, 'demo_notice', 800000 + s.id, pick(['نُشر التقويم الأكاديمي للفصل الحالي.', 'موعد الامتحانات النهائية في التقويم الأكاديمي.', 'جدّد قيدك السنوي قبل نهاية المهلة.']), NOW - int(1, 72) * 3600_000); added++;
  }
  // تقرير: ما يراه كل حساب
  const rep = staffAccounts.map((u) => {
    const n = (sql) => Number(one(sql, u.id).n);
    return `${u.username}: إشعارات ${n('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ?')}، مجالس ${n('SELECT COUNT(*) AS n FROM council_members WHERE user_id = ? AND active = 1')}، حجوزات ${n('SELECT COUNT(*) AS n FROM room_bookings WHERE requester_id = ?')}، صيانة ${n(`SELECT COUNT(*) AS n FROM maintenance_orders WHERE requester_id = ? OR assignee_id = ${u.id}`)}`;
  });
  console.log(rep.join('\n'));
  return `${added} إشعار مكمّل`;
});

const empty = rows("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1").map((x) => x.t).filter((t) => count(t) === 0);
console.log(`\nجداول فارغة: ${empty.length}\n${empty.join(' ')}`);
console.log(`\nمشكلات (${problems.length}):\n${problems.join('\n')}`);
await app.close();
process.exit(0);
