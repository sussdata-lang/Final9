// يولّد عينات الاستيراد لكل نوع بصيغ xlsx وcsv وsql ويتحقق منها باستيراد فعلي عبر الواجهة البرمجية على قاعدة مؤقتة،
// ثم يكتب README.md بالنتائج. التشغيل: node import-samples/generate.mjs (يلزم DATABASE_URL إلى PostgreSQL للاختبار).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../uni-erp/server/app.js';
import { hashPassword, resetTieredRateLimit } from '../uni-erp/server/security.js';
import { readXlsx, writeXlsx } from '../uni-erp/server/lib/xlsx.js';
import { IMPORT_DEFS, IMPORT_GROUPS } from '../uni-erp/server/services/import_defs.js';
import { ready } from '../uni-erp/server/services/finance/core.js';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const PW = 'Sample-Gen-Pass1!';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-samples-'));
const app = await createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
app.limiter.check = () => true;
const base = `http://127.0.0.1:${app.server.address().port}`;
const call = async (method, url, { body, cookie } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  return { status: res.status, json: isJson ? await res.json() : null, buf: isJson ? null : Buffer.from(await res.arrayBuffer()), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const db = app.db, now = Date.now(), hash = await hashPassword(PW, 1024);
db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('sampleadm', 'sampleadm', ?, 'admin', ?)").run(hash, now);
const adm = (await call('POST', '/api/auth/login', { body: { username: 'sampleadm', password: PW } })).cookie;

// السجلات التي تعتمد عليها الأمثلة ولا يُنشئها نوع في هذا الكتالوج
db.prepare("INSERT INTO courses (program_id, level, semester, name, code) SELECT id, 1, 1, 'مقرر أ', 'COURSE-A' FROM programs ORDER BY id LIMIT 1").run();
db.prepare("INSERT INTO courses (program_id, level, semester, name, code) SELECT id, 1, 2, 'مقرر ب', 'COURSE-B' FROM programs ORDER BY id LIMIT 1").run();
ready(db);
const stu = Number(db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, created_at) VALUES ('SAMPLE-1', 'طالب العينة', ?, 'student', 'SAMPLE-1', ?)").run(hash, now).lastInsertRowid);
const prog = db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get().id;
db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, status, guardian_name, guardian_relation, guardian_phone, created_at, updated_at)
  VALUES (?, 'أ', 'ب', 'ج', 'د', '90000000099', 'ذكر', '2005-01-01', 'دمشق', 'سورية', '0944111222', 'دمشق', 'المزة', 'دمشق', 'علمي', 2024, 220, ?, 'مفاضلة عامة', 2026, 'الفصل الأول', 2, 'active', 'هـ', 'أب', '0944111222', ?, ?)`).run(stu, prog, now, now);
db.prepare("INSERT INTO dorm_rooms (building_name, room_no, capacity, occupied) VALUES ('مبنى تجريبي', '101', 5, 0)").run();
db.prepare("INSERT INTO career_jobs (title, company_name, sector, location, created_at) VALUES ('وظيفة مرجعية', 'شركة', 'قطاع', 'دمشق', ?)").run(now);
db.prepare("INSERT INTO library_books (isbn, title, author, category, copies_total, copies_available, created_at) VALUES ('ISBN-SAMPLE', 'كتاب', 'مؤلف', 'عام', 5, 5, ?)").run(now);

const unitsCsv = ['الرمز,الاسم,النوع', 'UNIT-A,وحدة أ,قسم', 'UNIT-B,وحدة ب,قسم'].join('\n');
const units = await call('POST', '/api/import-engine/org_units/check', { cookie: adm, body: { filename: 'units.csv', data: Buffer.from(unitsCsv, 'utf8').toString('base64') } });
await call('POST', '/api/import-engine/org_units/commit', { cookie: adm, body: { stagingToken: units.json.stagingToken, confirm: units.json.confirmWord ?? undefined } });

// سلسلة المشتريات في العينات مترابطة: أمر مرسل بصنف محدد، يُستلم ذلك الصنف ثم يُصرف
const sampleItem = () => db.prepare('SELECT code FROM proc_items ORDER BY id LIMIT 1').get().code;
const DOC_FIX = {
  proc_orders: (head, lines, def) => { head[1][def.columns.findIndex((c) => c.name === 'status')] = def.columns.find((c) => c.name === 'status').options.ordered[0]; lines[1][1] = sampleItem(); },
  proc_receipts: (head, lines) => { lines[1][1] = sampleItem(); },
  proc_issues: (head, lines) => { lines[1][1] = sampleItem(); },
};
const col = (rows, start) => rows[0].findIndex((h) => String(h).startsWith(start));
const FIX = {
  career_applications: (rows) => { rows[1][col(rows, 'المسمى الوظيفي')] = 'وظيفة مرجعية'; },
  unit_links: (rows) => { const u = db.prepare('SELECT code FROM org_units WHERE code IS NOT NULL ORDER BY id LIMIT 2').all(); rows[1][0] = u[0].code; rows[1][1] = u[1].code; },
  student_group_members: (rows) => { rows[1][0] = db.prepare('SELECT name FROM student_groups ORDER BY id LIMIT 1').get()?.name ?? rows[1][0]; rows[1][col(rows, 'الرقم الجامعي')] = 'SAMPLE-1'; },
  course_schedules: (rows) => { rows[1][0] = 'COURSE-A'; },
  course_prerequisites: (rows) => { rows[1][0] = 'COURSE-B'; rows[1][1] = 'COURSE-A'; },
  programs: (rows) => { rows[1][0] = db.prepare('SELECT code FROM faculties ORDER BY id LIMIT 1').get().code; },
  sa_lifecycle_movements: (rows) => { rows[1][col(rows, 'الرقم الجامعي')] = 'SAMPLE-1'; },
  sa_credit_equivalences: (rows) => { rows[1][col(rows, 'الرقم الجامعي')] = 'SAMPLE-1'; rows[1][col(rows, 'رمز المقرر المقابل')] = 'COURSE-A'; },
};

const sqlValue = (v) => (v === '' || v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
// قارئ xlsx يُسقط الخلايا الفارغة في آخر الصف، وعدد القيم في SQL يجب أن يطابق عدد الأعمدة
const insert = (table, names, rows) => rows.map((r) => `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => sqlValue(r[i])).join(', ')});`).join('\n');
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const docKey = (def) => def.columns.find((c) => def.key.includes(c.to ?? c.name)) ?? def.columns[0];

async function build(def) {
  const t = await call('GET', `/api/import-engine/${def.kind}/template?format=xlsx`, { cookie: adm });
  if (t.status !== 200) throw new Error(`القالب: ${JSON.stringify(t.json)}`);
  const sheets = readXlsx(t.buf).sheets;
  if (def.lineColumns) {
    const key = docKey(def), lineCols = [key, ...def.lineColumns];
    const grid = (name, cols) => sheets.find((s) => s.name === name).rows.map((r) => cols.map((_, i) => String(r[i] ?? '')));
    const head = grid('الرأس', def.columns), lines = grid('البنود', lineCols);
    const fix = DOC_FIX[def.kind];
    if (fix) fix(head, lines, def);
    const c = await call('GET', `/api/import-engine/${def.kind}/template?format=csv`, { cookie: adm });
    const keyAt = def.columns.indexOf(key);
    const joined = [[...head[0], ...lines[0].slice(1)], ...lines.slice(1).map((l, i) => [...(i ? def.columns.map((_, j) => (j === keyAt ? l[0] : '')) : head[1]), ...l.slice(1)])];
    return {
      xlsx: fix ? writeXlsx([{ name: 'الرأس', rows: head, rtl: true }, { name: 'البنود', rows: lines, rtl: true }], { title: `نموذج ${def.title}` }) : t.buf,
      csv: fix ? Buffer.from(`\uFEFF${joined.map((r) => r.map(csvCell).join(',')).join('\n')}\n`, 'utf8') : c.buf,
      sql: `${insert(def.table, def.columns.map((x) => x.name), head.slice(1))}\n${insert(def.linesTable, [key.name, ...def.lineColumns.map((x) => x.name)], lines.slice(1))}\n`,
    };
  }
  const rows = sheets.find((s) => s.name === 'البيانات').rows.map((r) => def.columns.map((_, i) => String(r[i] ?? '')));
  const fix = FIX[def.kind];
  if (fix) fix(rows);
  return {
    xlsx: fix ? writeXlsx([{ name: 'البيانات', rows, rtl: true }], { title: `نموذج ${def.title}` }) : t.buf,
    csv: Buffer.from(`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`, 'utf8'),
    sql: `${insert(def.table, def.columns.map((x) => x.name), rows.slice(1))}\n`,
  };
}

const check = (kind, ext, buf) => call('POST', `/api/import-engine/${kind}/check`, { cookie: adm, body: { filename: `${kind}.${ext}`, data: buf.toString('base64') } });
const cancel = (token) => call('POST', '/api/import-engine/cancel', { cookie: adm, body: { stagingToken: token } });
async function attempt(def) {
  resetTieredRateLimit();
  const files = await build(def);
  const res = {};
  for (const ext of ['xlsx', 'csv', 'sql']) {
    const r = await check(def.kind, ext, Buffer.from(ext === 'sql' ? files.sql : files[ext]));
    res[ext] = r.json ?? {};
    if (r.status !== 200 || r.json.errorCount || !r.json.valid) {
      for (const x of Object.values(res)) if (x.stagingToken) await cancel(x.stagingToken);
      return { ok: false, why: `${ext}: ${JSON.stringify(r.json?.errors?.slice(0, 2) ?? r.json).slice(0, 300)}` };
    }
  }
  const same = JSON.stringify(res.xlsx.preview) === JSON.stringify(res.csv.preview) && JSON.stringify(res.csv.preview) === JSON.stringify(res.sql.preview);
  await cancel(res.csv.stagingToken); await cancel(res.sql.stagingToken);
  const c = await call('POST', `/api/import-engine/${def.kind}/commit`, { cookie: adm, body: { stagingToken: res.xlsx.stagingToken, confirm: res.xlsx.confirmWord ?? undefined } });
  if (c.status !== 200) return { ok: false, why: `الحفظ: ${JSON.stringify(c.json).slice(0, 300)}` };
  return { ok: true, files, same, created: c.json.created ?? 0, updated: c.json.updated ?? 0, batchId: c.json.batchId };
}

// الترتيب حسب الاعتماديات؛ وما يتعذر في جولة يُعاد بعد نجاح غيره
const defs = Object.values(IMPORT_DEFS), done = new Map(), failed = new Map(), order = [];
let pending = defs.slice();
for (let pass = 0; pass < 6 && pending.length; pass++) {
  const later = [];
  for (const def of pending) {
    if (def.deps.some((d) => IMPORT_DEFS[d] && !done.has(d)) && pass < 4) { later.push(def); continue; }
    let r; try { r = await attempt(def); } catch (e) { r = { ok: false, why: e.message }; }
    if (r.ok) { done.set(def.kind, r); order.push(def.kind); failed.delete(def.kind); } else { failed.set(def.kind, r.why); later.push(def); }
  }
  pending = later;
}
for (const def of pending) if (!failed.has(def.kind)) failed.set(def.kind, 'اعتمادياته لم تنجح');

for (const f of fs.readdirSync(OUT)) if (/^\d{2}-/.test(f)) fs.rmSync(path.join(OUT, f), { recursive: true });
const pad = (i) => String(i + 1).padStart(2, '0');
order.forEach((kind, i) => { const d = path.join(OUT, `${pad(i)}-${kind}`); fs.mkdirSync(d); const { files } = done.get(kind); for (const ext of ['xlsx', 'csv', 'sql']) fs.writeFileSync(path.join(d, `${kind}.${ext}`), files[ext]); });

const rows = order.map((kind, i) => { const d = IMPORT_DEFS[kind], r = done.get(kind); return `| ${pad(i)} | \`${kind}\` | ${d.title} | ${IMPORT_GROUPS[d.group] ?? d.group} | ${d.risk} | ${d.deps.join('، ') || '—'} | ${r.same ? 'متطابقة' : 'مختلفة'} | ${r.created} / ${r.updated} |`; });
const notDone = [...failed].map(([k, why]) => `- \`${k}\`: ${why}`);
fs.writeFileSync(path.join(OUT, 'README.md'), `# عينات الاستيراد

عينة لكل نوع بصيغ xlsx وcsv وsql. ولّدها \`generate.mjs\` من قوالب النظام نفسها، وتحقق منها باستيراد فعلي عبر واجهة الاستيراد على قاعدة PostgreSQL مؤقتة بالترتيب المرقَّم أدناه: فحص الصيغ الثلاث، ثم حفظ ملف xlsx.

- الأنواع التي نجحت: ${order.length} من ${defs.length}.
- عمود «المعاينة» يقارن معاينة الصيغ الثلاث لكل نوع.
- عمود «الحفظ» هو عدد السجلات المنشأة / المحدَّثة عند حفظ العينة.

## قبل الاستيراد

الأمثلة تشير إلى سجلات أنشأها المولّد مباشرة في قاعدته المؤقتة لأن هذا الكتالوج لا يستوردها، فأنشئها أولاً أو استبدل قيمها بقيم من نظامك:

- المقرران \`COURSE-A\` و\`COURSE-B\`، والطالب \`SAMPLE-1\`.
- غرفة السكن «مبنى تجريبي / 101»، والوظيفة «وظيفة مرجعية»، والكتاب \`ISBN-SAMPLE\`.
- الوحدتان \`UNIT-A\` و\`UNIT-B\`.

كما تشير أمثلة أخرى إلى الكليات والوحدات الأساسية الموجودة في النظام، فتختلف قيمها إذا اختلفت تلك السجلات. هذه بيانات اختبار: لا تستوردها في قاعدة الإنتاج.

## النتائج

| # | النوع | العنوان | المجموعة | الخطورة | يعتمد على | المعاينة | الحفظ |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## ما لم ينجح

${notDone.join('\n') || 'لا شيء.'}

## ما لا تغطيه هذه العينات

- استيراد الطلاب والعلامات والمقررات والحضور والطلبات له مساراته الخاصة (\`/api/import/:kind\`) ولا عينات له هنا.
- التراجع عن الدفعات غير مشمول هنا، وتغطيه اختبارات \`uni-erp/test/import_engine.test.js\`.
`);
console.log(JSON.stringify({ ok: order.length, total: defs.length, mismatch: order.filter((k) => !done.get(k).same), failed: [...failed] }));
await app.close();
process.exit(0);
