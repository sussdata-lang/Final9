// اختبار ضغط لنسخة اختبار فقط: مستخدمون افتراضيون بوقت تفكير، كل مستخدم يعمل بجلسته. لا يُشغَّل على الإنتاج.
//   LOAD_BASE=http://127.0.0.1:3102 LOAD_STAGES=1000,5000,10000 node scripts/loadtest/run.mjs
import { monitorEventLoopDelay } from 'node:perf_hooks';

const base = process.env.LOAD_BASE ?? 'http://127.0.0.1:3102';
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)) { console.error('يعمل على عنوان محلي فقط.'); process.exit(1); }
const STAGES = String(process.env.LOAD_STAGES ?? '1000,5000,10000').split(',').map(Number);
const HOLD_MS = Number(process.env.LOAD_HOLD_MS ?? 70_000), RAMP_MS = 15_000, THINK_MS = Number(process.env.LOAD_THINK_MS ?? 10_000);
const FIRST_STUDENT = Number(process.env.LOAD_FIRST_STUDENT), FIRST_STAFF = Number(process.env.LOAD_FIRST_STAFF), STAFF = Number(process.env.LOAD_STAFF ?? 300), STUDENTS = Number(process.env.LOAD_STUDENTS ?? 10000);

// لا اختبار بجلسات غير صالحة: الأرقام حينها تقيس الرفض لا الخدمة
for (const id of [FIRST_STUDENT, FIRST_STAFF]) {
  const me = await fetch(base + '/api/me', { headers: { Cookie: `sid=load-${id}` } }).then((x) => x.json());
  if (!me.user) { console.error(`الجلسة load-${id} غير صالحة؛ أُوقف الاختبار.`); process.exit(1); }
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const STUDENT_READS = ['/api/me', '/api/me', '/api/news', '/api/me/profile', '/api/me/grades?level=1', '/api/me/fees', '/api/me/timetable', '/api/requests', '/api/lms/overview', '/api/expansions/overview', '/api/services'];
const STAFF_READS = ['/api/me', '/api/me/desk', () => `/api/students?limit=50&q=${encodeURIComponent('اسم' + Math.floor(Math.random() * 100))}`, '/api/students-table?limit=50', '/api/requests', '/api/courses', '/api/stats', '/api/finance/reports/trial-balance', '/api/enterprise/overview', '/api/audit?limit=100'];

async function hit(stats, cookie, method, path, body) {
  const t = performance.now(), label = `${method} ${path.split('?')[0]}`;
  const row = stats.by[label] ||= { n: 0, bad: 0, times: [], status: {} };
  try {
    const r = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    await r.arrayBuffer();
    const dt = performance.now() - t;
    row.n++; row.times.push(dt); stats.times.push(dt); row.status[r.status] = (row.status[r.status] || 0) + 1;
    if (r.status >= 400) { row.bad++; stats.bad++; }
  } catch (e) { row.n++; row.bad++; stats.bad++; stats.net++; row.status.net = (row.status.net || 0) + 1; }
}

function vu(i, stats, stop) {
  const staff = i % 12 === 0;
  const id = staff ? FIRST_STAFF + (i % STAFF) : FIRST_STUDENT + (i % STUDENTS);
  const cookie = `sid=load-${id}`;
  const loop = async () => {
    await new Promise((r) => setTimeout(r, Math.random() * RAMP_MS));
    while (!stop.now) {
      if (Math.random() < 0.03) await hit(stats, cookie, 'POST', '/api/expansions/office-bookings', { faculty_name: 'د', student_name: 'ط', student_no: `LT-${(i % STUDENTS) + 1}`, topic: 'اختبار' });
      else { const p = pick(staff ? STAFF_READS : STUDENT_READS); await hit(stats, cookie, 'GET', typeof p === 'function' ? p() : p); }
      await new Promise((r) => setTimeout(r, THINK_MS * (0.5 + Math.random())));
    }
  };
  return loop();
}

const pct = (arr, p) => (arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]) : 0);
const clientLag = monitorEventLoopDelay({ resolution: 20 }); clientLag.enable();
for (const users of STAGES) {
  const stats = { times: [], by: {}, bad: 0, net: 0 }, stop = { now: false };
  clientLag.reset();
  const tasks = Array.from({ length: users }, (_, i) => vu(i, stats, stop));
  await new Promise((r) => setTimeout(r, RAMP_MS + HOLD_MS));
  stop.now = true;
  const tele = await fetch(base + '/api/v12/high-concurrency/telemetry', { headers: { Cookie: `sid=load-${FIRST_STAFF}` } }).then((r) => r.json()).catch(() => ({}));
  await Promise.race([Promise.all(tasks), new Promise((r) => setTimeout(r, 30_000))]);
  stats.times.sort((a, b) => a - b);
  console.log(`\n=== ${users} مستخدم: ${Math.round(stats.times.length / ((RAMP_MS + HOLD_MS) / 1000))} طلب/ث، p50 ${pct(stats.times, 0.5)} ms، p95 ${pct(stats.times, 0.95)} ms، p99 ${pct(stats.times, 0.99)} ms، أخطاء ${stats.bad} (شبكة ${stats.net})، تأخر العميل max ${Math.round(clientLag.max / 1e6)} ms`);
  console.log('خادم:', JSON.stringify(tele.httpStats?.eventLoop ?? null), 'rss', tele.httpStats?.rssMb);
  const rows = Object.entries(stats.by).map(([k, v]) => { v.times.sort((a, b) => a - b); return { k, n: v.n, p50: pct(v.times, 0.5), p95: pct(v.times, 0.95), status: v.status }; }).sort((a, b) => b.p95 - a.p95);
  for (const r of rows) console.log(`  ${r.k.padEnd(44)} n=${String(r.n).padStart(6)} p50=${String(r.p50).padStart(6)} p95=${String(r.p95).padStart(6)} ${JSON.stringify(r.status)}`);
}
process.exit(0);
