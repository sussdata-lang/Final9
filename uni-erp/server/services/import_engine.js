// محرك الاستيراد الجدولي: فحص بلا كتابة ← «حفظ» برمز لمرة واحدة أو «إلغاء» ← سجل دفعات وتراجع.
// كل كتابة تتم داخل معاملة واحدة مع سجل تغييراتها، وأسماء الجداول والأعمدة تأتي من التعريفات لا من الملف.
import { bad } from '../validate.js';
import crypto from 'node:crypto';
import { readXlsx, writeXlsx } from '../lib/xlsx.js';
import { parseSql, parseCsv } from '../lib/sqlparse.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { getSetting } from './settings.js';
import { deleteStudent } from './students.js';
import { logChange } from './workflow.js';
import { MAX_BYTES, norm, latinDigits, normDate, parseDateTime } from './importer.js';
import { IMPORT_DEFS, IMPORT_GROUPS, IMPORT_ORDER_HINT } from './import_defs.js';

const MAX_ROWS = 20000, STAGING_MS = 30 * 60 * 1000, CHUNK = 500, MAX_ERRORS = 300, DAY = 86400000;
const CHANGES_RETENTION_DAYS = 90;   // أقصى قيمة لإعداد import.undo_days؛ بعدها لا فائدة من الصور السابقة وفيها بيانات شخصية
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const q = (id) => `"${id}"`;
const toOf = (col) => col.to ?? col.name;
const sameId = (a, b) => String(a) === String(b);
// المفتاح الأساسي قد يكون مركّباً (user_id + year)، لذلك يُعامل دائماً كمصفوفة
const pkCols = (def) => [].concat(def.pk);
const pkOf = (def, row) => pkCols(def).map((c) => row[c]);
const whereCols = (cols) => cols.map((c) => `${q(c)} = ?`).join(' AND ');
// ما يكتبه الملف في خانة مرجع يقارَن بعد توحيد الأرقام وحذف كسر Excel
const fkKey = (v) => norm(latinDigits(String(v ?? '').trim().replace(/\.0+$/, '')));
const OTHER_DEPS = { courses: 'المقررات', students: 'سجل الطلاب' };

/* ---------- الوصول ---------- */
// الأنواع القديمة تُفحص وتُحفظ عبر importer.js، وهنا ما يحتاجه سجل الدفعات والتراجع
export const LEGACY_DEFS = {
  students: { kind: 'students', table: 'users', pk: 'id', title: 'سجل الطلاب', perm: 'student:register', risk: 'high', legacy: true, reverses: false,
    revertRow: ({ deps, actor, id, ip }) => {
      for (const [table, col] of [['grades', 'student_id'], ['requests', 'student_id'], ['student_holds', 'student_id'], ['hall_logs', 'student_id'], ['fin_charges', 'student_id'], ['fin_payments', 'student_id'], ['student_files', 'student_id']]) if (deps.db.prepare(`SELECT 1 AS x FROM ${table} WHERE ${col} = ? LIMIT 1`).get(id)) throw new UndoBlocked('صارت للطالب سجلات بعد الاستيراد.');
      deleteStudent(deps, actor, id, ip);
    } },
  grades: { kind: 'grades', table: 'grades', pk: 'id', title: 'علامات الطلاب', perm: 'grade:manage', risk: 'high', legacy: true,
    onRevert: (db, actor, row, before) => logChange(db, actor, row, 'تراجع عن استيراد علامات', before ? { mark: before.mark, theory: before.theory_mark, practical: before.practical_mark, status: before.workflow_status } : {}, null) },
  courses: { kind: 'courses', table: 'courses', pk: 'id', title: 'المقررات الدراسية', perm: 'course:manage', risk: 'low', legacy: true, undoable: false },
  attendance: { kind: 'attendance', table: 'hall_logs', pk: 'id', title: 'سجل القاعات', perm: 'attendance:manage', risk: 'low', legacy: true, undoable: false },
  reqx: { kind: 'reqx', table: 'requests', pk: 'id', title: 'طلبات الخدمات', perm: 'request:import', risk: 'low', legacy: true, undoable: false },
};
const defOf = (kind) => { const d = IMPORT_DEFS[kind] ?? LEGACY_DEFS[kind]; if (!d) throw new HttpError(404, 'نوع استيراد غير معروف.', 'not_found'); return d; };
const isHigh = (d) => d.risk === 'high' || d.risk === 'critical';
const canUse = (u, d) => u.can(d.perm) && (d.legacy || !isHigh(d) || u.can('import:high_risk'));
function needKind(u, d) { if (!canUse(u, d)) throw new HttpError(403, 'لا تملك صلاحية هذا النوع من الاستيراد.', 'forbidden'); }

export function importCatalog(user) {
  return {
    groups: IMPORT_GROUPS, orderHint: IMPORT_ORDER_HINT,
    canUndo: user.can('import:undo'),
    kinds: Object.values(IMPORT_DEFS).filter((d) => canUse(user, d)).map((d) => ({ kind: d.kind, title: d.title, desc: d.desc, group: d.group, risk: d.risk, deps: d.deps.map((x) => IMPORT_DEFS[x]?.title ?? OTHER_DEPS[x] ?? x), keyed: d.key.length > 0, document: !!d.lineColumns, confirmWord: isHigh(d) ? d.title : null })),
  };
}

/* ---------- قراءة الملف ---------- */
const fileColumns = (def) => (def.lineColumns ? [...def.columns, ...def.lineColumns] : def.columns);
const docColumn = (def) => def.columns.find((c) => toOf(c) === def.key[0]);
function headerMap(def) {
  const rev = new Map();
  for (const col of fileColumns(def)) for (const n of [col.name, toOf(col), col.label, ...(col.aliases ?? [])]) if (!rev.has(norm(n))) rev.set(norm(n), col.name);
  return rev;
}
function toRows(def, grid) {
  const rev = headerMap(def);
  const need = Math.min(2, fileColumns(def).length);
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) if (grid[i].filter((c) => rev.has(norm(c))).length >= need) { h = i; break; }
  if (h < 0) throw bad('لم أجد صف العناوين: استخدم قالب هذا النوع وأبقِ صف العناوين كما هو.');
  const cols = grid[h].map((c) => rev.get(norm(c)) ?? null);
  const miss = fileColumns(def).filter((c) => c.required && !cols.includes(c.name)).map((c) => c.label);
  if (miss.length) throw bad(`أعمدة مطلوبة غير موجودة في الملف: ${miss.join('، ')}.`);
  const unused = grid[h].filter((c, i) => !cols[i] && String(c ?? '').trim()).map(String), rows = [];
  for (let i = h + 1; i < grid.length; i++) {
    const g = grid[i]; if (!g.some((c) => String(c ?? '').trim())) continue;
    const o = { __line: i + 1 };
    cols.forEach((k, ci) => { if (k && o[k] === undefined) o[k] = String(g[ci] ?? '').trim(); });
    rows.push(o);
  }
  return { rows, unused };
}
// رأس المستند وبنوده يُدمجان بحسب رقم المستند: كل بند صف، والرأس يتكرر معه
function joinDocument(def, headGrid, lineGrid) {
  const key = docColumn(def);
  const heads = toRows({ columns: def.columns }, headGrid), lines = toRows({ columns: [key, ...def.lineColumns] }, lineGrid);
  const byNo = new Map(heads.rows.map((r) => [fkKey(r[key.name]), r])), used = new Set(), rows = [];
  for (const l of lines.rows) {
    const k = fkKey(l[key.name]), h = byNo.get(k);
    if (h) used.add(k);
    rows.push({ ...h, ...l, __line: l.__line });
  }
  for (const [k, h] of byNo) if (!used.has(k)) rows.push({ ...h, __noLines: true });
  return { rows, unused: [...heads.unused, ...lines.unused] };
}
function readFile(def, filename, buf) {
  const name = String(filename ?? '').toLowerCase();
  if (buf.length > MAX_BYTES) throw bad('حجم الملف يتجاوز 10 ميغابايت.');
  if (/\.sql$/.test(name)) {
    let parsed; try { parsed = parseSql(buf.toString('utf8')); } catch (e) { throw bad(`تعذّر قراءة SQL: ${e.message}`); }
    const names = Object.keys(parsed.tables);
    if (!names.length) throw bad('لم أجد جمل INSERT في ملف SQL.');
    const pick = names.find((n) => n.toLowerCase() === def.table) ?? (names.length === 1 ? names[0] : null);
    if (!pick) throw bad(`الملف يحوي عدة جداول (${names.join('، ')}) وليس بينها ${def.table}.`);
    const grid = (t) => [t.columns, ...t.rows.map((r) => t.columns.map((c) => r[c] ?? ''))], t = parsed.tables[pick];
    const linesTable = def.linesTable && names.find((n) => n.toLowerCase() === def.linesTable);
    if (linesTable) return joinDocument(def, grid(t), grid(parsed.tables[linesTable]));
    return toRows(def, grid(t));
  }
  if (/\.csv$|\.txt$/.test(name)) { let g; try { g = parseCsv(buf.toString('utf8').replace(/^﻿/, '')); } catch (e) { throw bad(e.message); } if (!g.length) throw bad('الملف فارغ.'); return toRows(def, g); }
  if (/\.xlsx$|\.xlsm$/.test(name)) {
    let wb; try { wb = readXlsx(buf); } catch (e) { throw bad(e.message); }
    const headSheet = wb.sheets.find((s) => s.name === 'الرأس'), lineSheet = wb.sheets.find((s) => s.name === 'البنود');
    if (def.lineColumns && headSheet && lineSheet) return joinDocument(def, headSheet.rows, lineSheet.rows);
    const named = wb.sheets.find((s) => s.name === 'البيانات');
    if (named) return toRows(def, named.rows);
    for (const s of wb.sheets) { try { return toRows(def, s.rows); } catch (e) { if (!(e instanceof HttpError)) throw e; } }
    return toRows(def, wb.sheets[0]?.rows ?? []);
  }
  throw bad('الصيغ المدعومة: xlsx وcsv وsql.');
}

/* ---------- تحويل القيم ---------- */
// قيمة نصية تبدأ بهذه الرموز تنفَّذ كصيغة إذا فُتحت في Excel لاحقاً
const safeText = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
function parseCell(col, raw) {
  const label = col.label; let s = String(raw).trim();
  switch (col.type) {
    case 'text': case 'latin':
      s = s.replace(/\s+/g, ' ');
      if (col.max && s.length > col.max) throw bad(`«${label}» أطول من ${col.max} حرفاً.`);
      if (col.pattern && !col.pattern.test(s)) throw bad(`«${label}»: ${col.patternMsg}.`);
      return safeText(s);
    case 'monthCode': { const m = /^(\d{4})[-/](\d{1,2})$/.exec(latinDigits(s)); if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw bad(`«${label}» يكتب بصيغة 2026-10.`); return `${m[1]}-${m[2].padStart(2, '0')}`; }
    case 'code': {
      s = latinDigits(s).replace(/\.0+$/, ''); if (col.upper) s = s.toUpperCase();
      if (s.length > (col.max ?? 40)) throw bad(`«${label}» أطول من ${col.max ?? 40} حرفاً.`);
      if (col.pattern && !col.pattern.test(s)) throw bad(`«${label}»: ${col.patternMsg}.`);
      return safeText(s);
    }
    case 'int': { const v = latinDigits(s).replace(/,/g, '').replace(/\.0+$/, ''); if (!/^-?\d+$/.test(v) || Number(v) < (col.min ?? -Infinity) || Number(v) > (col.max ?? Infinity)) throw bad(`«${label}» يجب أن يكون عدداً صحيحاً${col.min !== undefined ? ` بين ${col.min} و${col.max}` : ''}.`); return Number(v); }
    case 'num': { const v = latinDigits(s).replace(/,/g, ''); const n = Number(v); if (v === '' || !Number.isFinite(n) || n < (col.min ?? -Infinity) || n > (col.max ?? Infinity)) throw bad(`«${label}» يجب أن يكون رقماً${col.min !== undefined ? ` بين ${col.min} و${col.max}` : ''}.`); return n; }
    case 'bool': { const n = norm(s); if (['1', 'نعم', 'true', 'yes', 'فعال', 'صح'].includes(n)) return 1; if (['0', 'لا', 'false', 'no', 'معطل', 'خطا'].includes(n)) return 0; throw bad(`«${label}» يجب أن يكون نعم أو لا.`); }
    case 'date': { const d = normDate(s); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad(`«${label}» تاريخ غير مفهوم (مثال: 2026-10-15).`); return d; }
    case 'dateEpoch': { const d = normDate(s); const t = Date.parse(d); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(t)) throw bad(`«${label}» تاريخ غير مفهوم (مثال: 2026-10-15).`); return t; }
    case 'datetimeEpoch': { const t = parseDateTime(s); if (t === null) throw bad(`«${label}» غير مفهوم (مثال: 2026-10-15 09:30).`); return t; }
    case 'time': case 'minutes': {
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(latinDigits(s));
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw bad(`«${label}» يكتب بصيغة 09:30.`);
      return col.type === 'minutes' ? Number(m[1]) * 60 + Number(m[2]) : `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    case 'enum': {
      const n = norm(s);
      for (const [v, labels] of Object.entries(col.options)) if (norm(v) === n || labels.some((l) => norm(l) === n)) return col.numeric ? Number(v) : v;
      throw bad(`«${label}» يجب أن يكون أحد: ${Object.values(col.options).map((l) => l[0]).join('، ')}.`);
    }
    case 'questions': {
      let list;
      try { list = JSON.parse(s); } catch { throw bad(`«${label}» ليس JSON صالحاً.`); }
      if (!Array.isArray(list) || !list.length) throw bad(`«${label}» يجب أن يكون قائمة أسئلة.`);
      const key = col.answerKey;
      return JSON.stringify(list.map((item, i) => {
        const options = item?.options, answer = Number(item?.[key] ?? item?.answer ?? item?.ans);
        if (!item?.q || !Array.isArray(options) || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) throw bad(`«${label}»: السؤال ${i + 1} يحتاج إلى q وoptions وإجابة صحيحة.`);
        return { id: item.id ?? i + 1, q: String(item.q), options: options.map(String), [key]: answer };
      }));
    }
    case 'tel': { const v = latinDigits(s).replace(/\.0+$/, ''); if (/^\d{9}$/.test(v)) return `0${v}`; if (!/^\+?[0-9][0-9 \-]{6,19}$/.test(v)) throw bad(`«${label}» رقم هاتف غير صالح.`); return v; }
    case 'email': if (s.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(`«${label}» بريد غير صالح.`); return s;
    default: throw new Error(`نوع عمود غير معروف: ${col.type}`);
  }
}

/* ---------- الفحص: لا يكتب شيئاً ---------- */
function fkLookup(db, cache, col) {
  const { table, by, copy = {}, pk = 'id' } = col.fk, id = `${table}:${by.join()}:${pk}:${Object.keys(copy).join()}`;
  if (cache.has(id)) return cache.get(id);
  const fields = [...new Set([pk, ...by, ...Object.values(copy)])].map(q).join(', ');
  const map = new Map();
  for (const row of db.prepare(`SELECT ${fields} FROM ${q(table)}`).all()) {
    for (const b of by) {
      if (row[b] === null || row[b] === undefined || row[b] === '') continue;
      const k = fkKey(row[b]), hit = map.get(k);
      if (!hit) map.set(k, row);
      else if (!sameId(hit[pk], row[pk])) map.set(k, { ambiguous: true });
    }
  }
  cache.set(id, map);
  return map;
}
const keyOf = (def, v) => def.key.map((k) => String(v[k] ?? '').toLowerCase()).join('\u0001');

// قيم مجموعة أعمدة من صف واحد؛ غياب مرجع مطلوب يرفض الصف بسبب واضح
function readValues(db, cache, columns, r) {
  const v = {}, side = {};
  for (const col of columns) {
    const raw = r[col.name];
    if (raw === undefined || raw === '') { if (col.required) throw bad(`«${col.label}» مطلوب.`); if (col.default !== undefined) (col.sideOnly ? side : v)[toOf(col)] = col.default; continue; }
    if (col.sideOnly) { side[toOf(col)] = parseCell(col, raw); continue; }
    if (col.type !== 'fk') { v[toOf(col)] = parseCell(col, raw); continue; }
    const hit = fkLookup(db, cache, col).get(fkKey(raw));
    if (hit?.ambiguous) throw bad(`«${col.label}»: القيمة «${raw}» تطابق أكثر من سجل؛ استخدم قيمة فريدة.`);
    if (!hit) { const dep = Object.values(IMPORT_DEFS).find((d) => d.table === col.fk.table)?.title; throw bad(`«${col.label}»: لا يوجد سجل «${raw}» (${col.fk.hint}).${dep ? ` استورد «${dep}» أولاً.` : ''}`); }
    v[toOf(col)] = hit[col.fk.pk ?? 'id'];
    for (const [to, from] of Object.entries(col.fk.copy ?? {})) v[to] = hit[from];
  }
  return { v, side };
}

// المستند يُقبل كاملاً أو يُرفض كاملاً، ورقمه يمنع تكراره عند إعادة الاستيراد
function evaluateDocuments(db, def, rows, actor) {
  const errors = [], ok = [], cache = new Map(), memo = new Map(), key = docColumn(def);
  const ctx = { db, actor, memo: (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); } };
  const existing = new Set(db.prepare(`SELECT ${q(def.key[0])} AS k FROM ${q(def.table)}${def.keyScope ? ` WHERE ${def.keyScope}` : ''}`).all().map((r) => String(r.k ?? '').toLowerCase()));
  const docs = new Map();
  for (const r of rows) {
    const no = String(r[key.name] ?? '').trim();
    if (!no) { errors.push({ row: r.__line, message: `«${key.label}» مطلوب.` }); continue; }
    if (!docs.has(fkKey(no))) docs.set(fkKey(no), { no, rows: [] });
    docs.get(fkKey(no)).rows.push(r);
  }
  for (const doc of docs.values()) {
    let at = doc.rows[0].__line;
    try {
      if (doc.rows.some((r) => r.__noLines)) throw bad('لا توجد له بنود.');
      const merged = {};
      for (const col of def.columns) for (const r of doc.rows) {
        const raw = r[col.name];
        if (raw === undefined || raw === '') continue;
        if (merged[col.name] === undefined) merged[col.name] = raw;
        else if (norm(merged[col.name]) !== norm(raw)) { at = r.__line; throw bad(`«${col.label}» يختلف بين صفوف المستند.`); }
      }
      const { v, side } = readValues(db, cache, def.columns, merged);
      if (existing.has(String(v[def.key[0]]).toLowerCase())) throw new HttpError(409, def.duplicateMsg ?? 'موجود مسبقاً، والمستندات لا تُحدَّث من الاستيراد.', 'duplicate');
      for (const [to, how] of Object.entries(def.stamp)) if (v[to] === undefined) v[to] = how === 'now' ? Date.now() : how === 'actor' ? actor.id : actor.display_name;
      const lines = doc.rows.map((r) => { at = r.__line; return readValues(db, cache, def.lineColumns, r).v; });
      at = doc.rows[0].__line;
      const invalid = def.validateDoc?.(v, lines, ctx, side); if (invalid) throw bad(invalid);
      ok.push({ line: at, values: v, lines, pending: {}, side, target: null, op: 'insert', unchanged: false, label: doc.no });
    } catch (e) { if (!(e instanceof HttpError)) throw e; errors.push({ row: at, message: `المستند ${doc.no}: ${e.message}` }); }
  }
  return { ok, errors };
}

export function evaluate(db, def, rows, actor) {
  if (def.lineColumns) return evaluateDocuments(db, def, rows, actor);
  const errors = [], ok = [], cache = new Map(), seen = new Map(), selfCols = def.columns.filter((c) => c.fk?.table === def.table), pks = pkCols(def);
  const memo = new Map(), ctx = { db, actor, memo: (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); } };
  const existing = new Map();
  if (def.key.length) for (const r of db.prepare(`SELECT ${[...new Set([...pks, ...def.key])].map(q).join(', ')} FROM ${q(def.table)}${def.keyScope ? ` WHERE ${def.keyScope}` : ''}`).all()) existing.set(keyOf(def, r), pkOf(def, r));
  const uniques = def.unique.map((u) => ({ col: u, label: def.columns.find((c) => toOf(c) === u)?.label ?? u, map: new Map(db.prepare(`SELECT ${[...new Set([...pks, u])].map(q).join(', ')} FROM ${q(def.table)}`).all().map((r) => [String(r[u] ?? '').toLowerCase(), pkOf(def, r)])), file: new Map() }));
  const selectRow = db.prepare(`SELECT * FROM ${q(def.table)} WHERE ${whereCols(pks)}`);
  // مفاتيح الملف أولاً حتى يشير صف إلى أب يرد بعده
  const fileKeys = new Map();
  if (selfCols.length) for (const r of rows) { const kc = def.columns.find((c) => toOf(c) === def.key[0]); if (kc && r[kc.name]) fileKeys.set(fkKey(r[kc.name]), r.__line); }

  for (const r of rows) {
    try {
      const v = {}, pending = {}, side = {};
      for (const col of def.columns) {
        const raw = r[col.name];
        if (raw === undefined || raw === '') { if (col.required) throw bad(`«${col.label}» مطلوب.`); continue; }
        if (col.sideOnly) { side[toOf(col)] = parseCell(col, raw); continue; }
        if (col.type !== 'fk') { v[toOf(col)] = parseCell(col, raw); continue; }
        const hit = fkLookup(db, cache, col).get(fkKey(raw));
        if (hit?.ambiguous) throw bad(`«${col.label}»: القيمة «${raw}» تطابق أكثر من سجل؛ استخدم قيمة فريدة.`);
        if (hit) { v[toOf(col)] = hit[col.fk.pk ?? 'id']; for (const [to, from] of Object.entries(col.fk.copy ?? {})) v[to] = hit[from]; continue; }
        if (col.fk.table === def.table && fileKeys.has(fkKey(raw))) { pending[toOf(col)] = fkKey(raw); continue; }
        const dep = Object.values(IMPORT_DEFS).find((d) => d.table === col.fk.table)?.title;
        throw bad(`«${col.label}»: لا يوجد سجل «${raw}» (${col.fk.hint}).${dep ? ` استورد «${dep}» أولاً.` : ''}`);
      }
      const defaultsFor = (cols) => { for (const col of cols) if (!col.sideOnly && col.default !== undefined && v[toOf(col)] === undefined) v[toOf(col)] = col.default; };
      defaultsFor(def.columns.filter((c) => def.key.includes(toOf(c))));
      let target = null;
      if (def.key.length) {
        const k = keyOf(def, v);
        if (seen.has(k)) throw new HttpError(409, `مكرر في الملف نفسه (الصف ${seen.get(k)}).`, 'duplicate');
        seen.set(k, r.__line);
        if (existing.has(k)) target = existing.get(k);
      }
      for (const u of uniques) {
        const val = String(v[u.col] ?? '').toLowerCase(); if (!val) continue;
        const other = u.map.get(val);
        if (other !== undefined && (target === null || !sameId(other, target))) throw new HttpError(409, `«${u.label}» مستخدم في سجل آخر.`, 'duplicate');
        if (u.file.has(val)) throw new HttpError(409, `«${u.label}» مكرر في الملف (الصف ${u.file.get(val)}).`, 'duplicate');
        u.file.set(val, r.__line);
      }
      const row = target !== null ? selectRow.get(...target) : null;
      if (row) { const blocked = def.protect?.(row); if (blocked) throw bad(blocked); }
      else {
        defaultsFor(def.columns);
        for (const [to, how] of Object.entries(def.stamp)) if (v[to] === undefined) v[to] = how === 'now' ? Date.now() : how === 'actor' ? actor.id : actor.display_name;
      }
      const invalid = def.validate?.(v, row, ctx); if (invalid) throw bad(invalid);
      def.derive?.(v, row, ctx, side);
      const unchanged = !!row && Object.keys(pending).length === 0
        && Object.keys(v).every((k) => def.key.includes(k) || String(row[k] ?? '') === String(v[k] ?? ''))
        && (!def.sideUnchanged || def.sideUnchanged(side, v, ctx));
      // الصف الأول في الملف رمز أو اسم أو رقم موظف، ولا يكون قيمة حساسة
      ok.push({ line: r.__line, values: v, pending, side, target, op: row ? 'update' : 'insert', unchanged, label: String(r[def.columns[0].name] ?? r.__line) });
    } catch (e) { if (!(e instanceof HttpError)) throw e; errors.push({ row: r.__line, message: e.message }); }
  }
  // ترتيب الآباء قبل الأبناء، وكشف الدورات داخل الملف
  let sorted = ok;
  if (selfCols.length) {
    const kc = def.key[0], placed = new Set(), remaining = [...ok]; sorted = [];
    while (remaining.length) {
      const next = remaining.filter((x) => Object.values(x.pending).every((p) => placed.has(p)));
      if (!next.length) { for (const x of remaining) errors.push({ row: x.line, message: 'دورة في علاقة الأب داخل الملف.' }); break; }
      for (const x of next) { sorted.push(x); placed.add(fkKey(x.values[kc])); remaining.splice(remaining.indexOf(x), 1); }
    }
  }
  // الدورات المغلقة في العلاقات مثل المتطلبات السابقة
  if (def.closure) sorted = rejectCycles(db, def, sorted, errors);
  return { ok: sorted, errors };
}
function rejectCycles(db, def, rows, errors) {
  const { from, to, message } = def.closure, edges = new Map();
  const add = (a, b) => { const k = String(a); if (!edges.has(k)) edges.set(k, new Set()); edges.get(k).add(String(b)); };
  for (const e of db.prepare(`SELECT ${q(from)}, ${q(to)} FROM ${q(def.table)}`).all()) add(e[from], e[to]);
  const reaches = (a, b) => { const stack = [String(a)], seen = new Set(); while (stack.length) { const n = stack.pop(); if (n === String(b)) return true; if (seen.has(n)) continue; seen.add(n); for (const m of edges.get(n) ?? []) stack.push(m); } return false; };
  return rows.filter((x) => {
    if (reaches(x.values[to], x.values[from])) { errors.push({ row: x.line, message }); return false; }
    add(x.values[from], x.values[to]); return true;
  });
}
const summarize = (rows, res) => ({
  total: rows.length, valid: res.ok.length, errorCount: res.errors.length,
  impact: { create: res.ok.filter((x) => x.op === 'insert').length, update: res.ok.filter((x) => x.op === 'update' && !x.unchanged).length, unchanged: res.ok.filter((x) => x.unchanged).length },
  errors: res.errors.sort((a, b) => a.row - b.row).slice(0, MAX_ERRORS),
  preview: res.ok.slice(0, 8).map((x) => x.label),
});

function purgeStaging(db) {
  db.prepare('DELETE FROM import_staging WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM import_changes WHERE batch_id IN (SELECT id FROM import_batches WHERE committed_at < ?)').run(Date.now() - CHANGES_RETENTION_DAYS * DAY);
}

export function checkImport(deps, actor, kind, { filename, data } = {}, ip) {
  const { db, limiter } = deps, def = defOf(kind);
  needKind(actor, def);
  if (limiter && !limiter.check(`import:${actor.id}`, 60, 60_000)) throw new HttpError(429, 'محاولات استيراد كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
  if (typeof data !== 'string' || !data) throw bad('لم يصل ملف.');
  const buf = Buffer.from(data, 'base64'), { rows, unused } = readFile(def, filename, buf);
  if (!rows.length) throw bad('الملف لا يحوي صفوف بيانات تحت العناوين.');
  if (rows.length > MAX_ROWS) throw bad(`عدد الصفوف يتجاوز ${MAX_ROWS}.`);
  const res = evaluate(db, def, rows, actor), out = summarize(rows, res);
  const warnings = [];
  if (!def.key.length) warnings.push('هذا النوع بلا مفتاح فريد: إعادة استيراد الملف نفسه تكرر السجلات.');
  if (def.lineColumns) warnings.push(`الملف يحوي ${res.ok.length} مستنداً صالحاً بمجموع ${res.ok.reduce((n, x) => n + x.lines.length, 0)} بنداً. المستند يُقبل كاملاً أو يُرفض كاملاً.`);
  const example = def.columns.filter((c) => c.example !== undefined);
  const exampleRows = rows.filter((r) => example.every((c) => r[c.name] === undefined || r[c.name] === '' || norm(r[c.name]) === norm(c.example))).map((r) => r.__line);
  if (example.length && exampleRows.length) warnings.push(`الصف ${exampleRows.join('، ')} يطابق مثال القالب؛ احذفه إن لم يكن من بياناتك.`);
  let stagingToken = null, expiresAt = null;
  if (res.ok.length) {
    purgeStaging(db);
    stagingToken = crypto.randomBytes(32).toString('hex'); expiresAt = Date.now() + STAGING_MS;
    const hash = sha(stagingToken);
    tx(db, () => {
      db.prepare('INSERT INTO import_staging (token_hash, user_id, kind, filename, file_sha256, total_rows, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)').run(hash, actor.id, kind, String(filename ?? '').slice(0, 200), sha(buf), rows.length, Date.now(), expiresAt);
      const ins = db.prepare('INSERT INTO import_staging_chunks (token_hash, seq, rows_json) VALUES (?,?,?)');
      for (let i = 0; i * CHUNK < rows.length; i++) ins.run(hash, i, JSON.stringify(rows.slice(i * CHUNK, (i + 1) * CHUNK)));
    });
  }
  return { kind, title: def.title, risk: def.risk, committed: false, filename, unusedColumns: unused, warnings, impactNote: def.impactNote ?? null, ...out, stagingToken, expiresAt, confirmWord: isHigh(def) ? def.title : null };
}

export function cancelImport({ db }, actor, token) {
  if (typeof token !== 'string' || !token) throw bad('رمز الفحص مفقود.');
  db.prepare('DELETE FROM import_staging WHERE token_hash = ? AND user_id = ?').run(sha(token), actor.id);
  return { ok: true };
}

/* ---------- الحفظ ---------- */
const rowHash = (row) => sha(JSON.stringify(row));
function readChunks(db, hash) {
  const one = db.prepare('SELECT rows_json FROM import_staging_chunks WHERE token_hash = ? AND seq = ?'), out = [];
  for (let seq = 0; ; seq++) { const c = one.get(hash, seq); if (!c) return out; out.push(c.rows_json); }
}

/* ---------- ملف الأنواع القديمة بين الفحص والحفظ ---------- */
const FILE_CHUNK = 2 * 1024 * 1024;
export function stageFile({ db }, actor, stageKind, filename, data, totalRows) {
  purgeStaging(db);
  const token = crypto.randomBytes(32).toString('hex'), hash = sha(token), expiresAt = Date.now() + STAGING_MS;
  tx(db, () => {
    db.prepare('INSERT INTO import_staging (token_hash, user_id, kind, filename, file_sha256, total_rows, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)').run(hash, actor.id, stageKind, String(filename ?? '').slice(0, 200), sha(data), totalRows, Date.now(), expiresAt);
    const ins = db.prepare('INSERT INTO import_staging_chunks (token_hash, seq, rows_json) VALUES (?,?,?)');
    for (let i = 0; i * FILE_CHUNK < data.length; i++) ins.run(hash, i, data.slice(i * FILE_CHUNK, (i + 1) * FILE_CHUNK));
  });
  return { stagingToken: token, expiresAt };
}
export function readStagedFile({ db }, actor, stageKind, token) {
  if (typeof token !== 'string' || !token) throw bad('افحص الملف أولاً: رمز الفحص مفقود.');
  const hash = sha(token), st = db.prepare('SELECT * FROM import_staging WHERE token_hash = ? AND user_id = ? AND kind = ? AND expires_at >= ?').get(hash, actor.id, stageKind, Date.now());
  if (!st) throw new HttpError(410, 'انتهت صلاحية الفحص أو استُخدم من قبل؛ افحص الملف من جديد.', 'staging_gone');
  return { st, data: readChunks(db, hash).join('') };
}
// الحذف يحجز الرمز: طلبان متزامنان لا ينجحان معاً
export function claimStaged({ db }, actor, stageKind, token) {
  const st = db.prepare('DELETE FROM import_staging WHERE token_hash = ? AND user_id = ? AND kind = ? AND expires_at >= ? RETURNING *').get(sha(token), actor.id, stageKind, Date.now());
  if (!st) throw new HttpError(410, 'انتهت صلاحية الفحص أو استُخدم من قبل؛ افحص الملف من جديد.', 'staging_gone');
  return st;
}
export function recordLegacyBatch({ db }, actor, kind, st, summary, changes, ip) {
  const now = Date.now();
  const batchId = Number(db.prepare("INSERT INTO import_batches (kind, user_id, filename, file_sha256, status, created_at, committed_at, summary_json) VALUES (?,?,?,?,'committed',?,?,?)").run(kind, actor.id, st.filename, st.file_sha256, st.created_at, now, JSON.stringify(summary)).lastInsertRowid);
  const buffer = [];
  for (const c of changes) { buffer.push({ table: c.table, pk: JSON.stringify(c.pk), op: c.op, before: c.before ? JSON.stringify(c.before) : null, after: rowHash(c.after) }); if (buffer.length >= 200) flushChanges(db, batchId, buffer); }
  flushChanges(db, batchId, buffer);
  return batchId;
}
function flushChanges(db, batchId, buffer) {
  if (!buffer.length) return;
  const sql = `INSERT INTO import_changes (batch_id, table_name, pk_json, op, before_json, after_hash) VALUES ${buffer.map(() => '(?,?,?,?,?,?)').join(',')}`;
  db.prepare(sql).run(...buffer.flatMap((c) => [batchId, c.table, c.pk, c.op, c.before, c.after]));
  buffer.length = 0;
}

export function commitImport(deps, actor, kind, { stagingToken, acceptPartial, confirm } = {}, ip) {
  const { db } = deps, def = defOf(kind);
  needKind(actor, def);
  if (typeof stagingToken !== 'string' || !stagingToken) throw bad('افحص الملف أولاً: رمز الفحص مفقود.');
  if (isHigh(def) && String(confirm ?? '').trim() !== def.title) throw bad(`اكتب «${def.title}» لتأكيد هذا الاستيراد الحساس.`);
  const hash = sha(stagingToken);
  try {
    return tx(db, () => {
      const rows = readChunks(db, hash).flatMap((c) => JSON.parse(c));
      // الحذف يحجز الرمز: طلبان متزامنان لا ينجحان معاً، وأي فشل لاحق يعيده بإلغاء المعاملة
      const st = db.prepare('DELETE FROM import_staging WHERE token_hash = ? AND user_id = ? AND kind = ? AND expires_at >= ? RETURNING *').get(hash, actor.id, kind, Date.now());
      if (!st) throw new HttpError(410, 'انتهت صلاحية الفحص أو استُخدم من قبل؛ افحص الملف من جديد.', 'staging_gone');
      return writeBatch(deps, actor, def, st, rows, acceptPartial, ip);
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error(`[import] ${kind}: ${String(e.message).split('\n')[0].slice(0, 200)}`);
    throw new HttpError(409, 'تعذّر الحفظ بسبب تعارض مع البيانات الحالية، ولم يُكتب أي سجل. افحص الملف من جديد.', 'import_conflict');
  }
}

function writeBatch(deps, actor, def, st, rows, acceptPartial, ip) {
  const { db } = deps, res = evaluate(db, def, rows, actor);   // إعادة الفحص: قد تكون البيانات تغيّرت بعد الفحص الأول
  if (res.errors.length && !acceptPartial) throw new HttpError(409, `في الملف ${res.errors.length} صف مرفوض؛ صحّحه أو اختر «حفظ الصالح فقط».`, 'has_errors');
  if (!res.ok.length) throw bad('لا توجد صفوف صالحة للحفظ.');
  const now = Date.now(), table = q(def.table), pks = pkCols(def);
  const batchId = Number(db.prepare("INSERT INTO import_batches (kind, user_id, filename, file_sha256, status, created_at, committed_at) VALUES (?,?,?,?,'committed',?,?)").run(def.kind, actor.id, st.filename, st.file_sha256, st.created_at, now).lastInsertRowid);
  const selectRow = db.prepare(`SELECT * FROM ${table} WHERE ${whereCols(pks)}`), written = new Map(), buffer = [];
  // تعديل جدول آخر ضمن الدفعة (مثل مزامنة الراتب الأساسي للموظف) يُسجَّل ليشمله التراجع
  const updateSide = (sideTable, pkVals, cols, touch = {}) => {
    const sidePks = [].concat(def.side[sideTable]), where = whereCols(sidePks), select = db.prepare(`SELECT * FROM ${q(sideTable)} WHERE ${where}`);
    const before = select.get(...pkVals);
    if (!before || !Object.keys(cols).some((k) => String(before[k] ?? '') !== String(cols[k] ?? ''))) return;
    const all = { ...cols, ...touch }, names = Object.keys(all);
    db.prepare(`UPDATE ${q(sideTable)} SET ${names.map((k) => `${q(k)} = ?`).join(', ')} WHERE ${where}`).run(...names.map((k) => all[k]), ...pkVals);
    buffer.push({ table: sideTable, pk: JSON.stringify(pkVals), op: 'update', before: JSON.stringify(before), after: rowHash(select.get(...pkVals)) });
    sideUpdated++;
  };
  // سجل جديد في جدول آخر ضمن الدفعة (مثل علامة المعادلة) يحذفه التراجع
  const insertSide = (sideTable, cols) => {
    const names = Object.keys(cols), where = whereCols([].concat(def.side[sideTable]));
    const info = db.prepare(`INSERT INTO ${q(sideTable)} (${names.map(q).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k]));
    const pk = [info.lastInsertRowid];
    buffer.push({ table: sideTable, pk: JSON.stringify(pk), op: 'insert', before: null, after: rowHash(db.prepare(`SELECT * FROM ${q(sideTable)} WHERE ${where}`).get(...pk)) });
    sideUpdated++;
  };
  let created = 0, updated = 0, unchanged = 0, sideUpdated = 0;
  for (const x of res.ok) {
    const values = { ...x.values };
    for (const [to, parent] of Object.entries(x.pending)) values[to] = written.get(parent);
    let pk = x.target;
    if (x.unchanged) unchanged++;
    else if (x.op === 'insert') {
      // ما يغيّره المستند خارج جدوله يُلتقط قبله وبعده ليعيده التراجع حرفياً
      const snapshots = def.touches ? [...new Map(def.touches(values, x.lines).filter(([, id]) => id).map(([t, id]) => [`${t}:${id}`, [t, id]])).values()].map(([t, id]) => { const select = db.prepare(`SELECT * FROM ${q(t)} WHERE ${whereCols([].concat(def.side[t]))}`); return { t, id, select, before: select.get(id) }; }) : [];
      if (def.createDoc) pk = [def.createDoc({ deps, actor, head: values, lines: x.lines, side: x.side, ip })];
      else if (def.createRow) pk = [def.createRow({ deps, actor, values, ip })];   // ما له قيد محاسبي يمر بدالة الوحدة نفسها
      else {
        const cols = Object.keys(values);
        const info = db.prepare(`INSERT INTO ${table} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((k) => values[k]));
        pk = def.pk === 'id' ? [info.lastInsertRowid] : pks.map((c) => values[c]);
      }
      buffer.push({ table: def.table, pk: JSON.stringify(pk), op: 'insert', before: null, after: rowHash(selectRow.get(...pk)) });
      for (const s of snapshots) { const after = s.select.get(s.id); if (rowHash(after) !== rowHash(s.before)) { buffer.push({ table: s.t, pk: JSON.stringify([s.id]), op: 'update', before: JSON.stringify(s.before), after: rowHash(after) }); sideUpdated++; } }
      created++;
    } else {
      for (const to of Object.keys(def.touch ?? {})) values[to] = now;
      // المفتاح يطابق بلا حساسية لحالة الأحرف، فلا يُعاد كتابته بحالة الملف
      const before = selectRow.get(...pk), cols = Object.keys(values).filter((k) => !pks.includes(k) && !def.key.includes(k));
      if (cols.length) db.prepare(`UPDATE ${table} SET ${cols.map((k) => `${q(k)} = ?`).join(', ')} WHERE ${whereCols(pks)}`).run(...cols.map((k) => values[k]), ...pk);
      buffer.push({ table: def.table, pk: JSON.stringify(pk), op: 'update', before: JSON.stringify(before), after: rowHash(selectRow.get(...pk)) });
      updated++;
    }
    if (!x.unchanged) def.after?.({ db, actor, values, side: x.side, op: x.op, updateSide, insertSide, now });
    if (def.key.length) written.set(fkKey(values[def.key[0]]), pk[0]);
    if (buffer.length >= 200) flushChanges(db, batchId, buffer);
  }
  flushChanges(db, batchId, buffer);
  const summary = { total: rows.length, created, updated, unchanged, skipped: res.errors.length, sideUpdated };
  db.prepare('UPDATE import_batches SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), batchId);
  audit(db, actor, `استيراد ${def.title}: ${created} جديد / ${updated} محدَّث / ${res.errors.length} مرفوض`, `دفعة ${batchId}`, ip);
  return { kind: def.kind, committed: true, batchId, ...summary, errorCount: res.errors.length, errors: res.errors.sort((a, b) => a.row - b.row).slice(0, MAX_ERRORS) };
}

/* ---------- سجل الدفعات والتراجع ---------- */
const undoDays = (db) => getSetting(db, 'import.undo_days');

export function listBatches({ db }, user) {
  const kinds = [...Object.values(IMPORT_DEFS), ...Object.values(LEGACY_DEFS)].filter((d) => canUse(user, d)).map((d) => d.kind);
  if (!kinds.length) return { batches: [], undoDays: undoDays(db) };
  const rows = db.prepare(`SELECT b.id, b.kind, b.filename, b.status, b.committed_at, b.undone_at, b.summary_json, u.display_name AS user_name
    FROM import_batches b JOIN users u ON u.id = b.user_id WHERE b.kind IN (${kinds.map(() => '?').join(',')}) ORDER BY b.id DESC LIMIT 200`).all(...kinds);
  const days = undoDays(db), canUndo = user.can('import:undo');
  return {
    undoDays: days,
    batches: rows.map((b) => {
      const s = JSON.parse(b.summary_json || '{}');
      const expired = Date.now() > Number(b.committed_at) + days * DAY;
      return { id: b.id, kind: b.kind, title: defOf(b.kind).title, filename: b.filename, status: b.status, user: b.user_name, committedAt: Number(b.committed_at), undoneAt: b.undone_at ? Number(b.undone_at) : null, summary: { created: s.created ?? 0, updated: s.updated ?? 0, unchanged: s.unchanged ?? 0, skipped: s.skipped ?? 0, sideUpdated: s.sideUpdated ?? 0 }, blockedReason: s.blockedReason ?? null, reverses: defOf(b.kind).reverses ?? !!defOf(b.kind).revertRow, canUndo: canUndo && !expired && b.status !== 'undone' && defOf(b.kind).undoable !== false };
    }),
  };
}

class UndoBlocked extends Error {}

// الحذف بقيد ON DELETE CASCADE لا يفشل بل يمسح السجلات التابعة بصمت، فيُفحص قبله صراحة
function cascadeRefs(db, table) {
  return db.prepare(`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confdeltype = 'c' AND c.confrelid = to_regclass(?)`).all(table);
}
const changeTable = (def, table) => {
  if (table === def.table) return pkCols(def);
  if (def.side?.[table]) return [].concat(def.side[table]);
  throw new UndoBlocked('الدفعة تحوي تغييراً في جدول غير متوقع.');
};

export function undoBatch(deps, actor, id, ip) {
  const { db } = deps;
  if (!actor.can('import:undo')) throw new HttpError(403, 'لا تملك صلاحية التراجع عن الاستيراد.', 'forbidden');
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(Number(id));
  if (!batch) throw new HttpError(404, 'الدفعة غير موجودة.', 'not_found');
  const def = defOf(batch.kind);
  needKind(actor, def);
  if (def.undoable === false) throw new HttpError(409, 'هذا النوع من الاستيراد لا يدعم التراجع.', 'undo_unsupported');
  if (batch.status === 'undone') throw new HttpError(409, 'تم التراجع عن هذه الدفعة من قبل.', 'already_undone');
  if (Date.now() > Number(batch.committed_at) + undoDays(db) * DAY) throw new HttpError(409, `انتهت مهلة التراجع (${undoDays(db)} أيام).`, 'undo_expired');
  let reverted = 0;
  try {
    tx(db, () => {
      const page = db.prepare('SELECT id, table_name, pk_json, op, before_json, after_hash FROM import_changes WHERE batch_id = ? ORDER BY id DESC LIMIT ? OFFSET ?');
      const refs = new Map();
      for (let off = 0; ; off += CHUNK) {
        const changes = page.all(batch.id, CHUNK, off);
        if (!changes.length) break;
        for (const ch of changes) {
          const pks = changeTable(def, ch.table_name), table = q(ch.table_name), where = whereCols(pks), pk = [].concat(JSON.parse(ch.pk_json));
          const cur = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...pk);
          if (!cur) throw new UndoBlocked('سجل من هذه الدفعة حُذف بعد الاستيراد.');
          if (rowHash(cur) !== ch.after_hash) throw new UndoBlocked('سجل من هذه الدفعة عُدِّل بعد الاستيراد، فالتراجع قد يفقد ذلك التعديل.');
          if (ch.op === 'insert' && def.revertRow && ch.table_name === def.table) def.revertRow({ deps, actor, id: pk[0], ip });   // القيود لا تُحذف: قيد عكسي
          else if (ch.op === 'insert') {
            if (!refs.has(ch.table_name)) refs.set(ch.table_name, cascadeRefs(db, ch.table_name));
            for (const ref of refs.get(ch.table_name)) if (db.prepare(`SELECT 1 AS x FROM ${ref.tbl} WHERE ${q(ref.col)} = ? LIMIT 1`).get(pk[0])) throw new UndoBlocked('سجلات لاحقة تعتمد على بيانات هذه الدفعة.');
            def.onRevert?.(db, actor, cur, null);
            db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...pk);
          } else {
            const before = JSON.parse(ch.before_json), cols = Object.keys(before).filter((k) => !pks.includes(k));
            def.onRevert?.(db, actor, cur, before);
            db.prepare(`UPDATE ${table} SET ${cols.map((k) => `${q(k)} = ?`).join(', ')} WHERE ${where}`).run(...cols.map((k) => before[k]), ...pk);
          }
          reverted++;
        }
      }
      db.prepare("UPDATE import_batches SET status = 'undone', undone_at = ?, undone_by = ? WHERE id = ?").run(Date.now(), actor.id, batch.id);
      audit(db, actor, `تراجع عن استيراد ${def.title}: ${reverted} سجل`, `دفعة ${batch.id}`, ip);
    });
  } catch (e) {
    const fk = /foreign key|violates/i.test(String(e.message));
    if (!(e instanceof UndoBlocked) && !(e instanceof HttpError) && !fk) throw e;
    const reason = e instanceof UndoBlocked || e instanceof HttpError ? e.message : 'سجلات لاحقة تعتمد على بيانات هذه الدفعة.';
    const s = JSON.parse(batch.summary_json || '{}');
    db.prepare("UPDATE import_batches SET status = 'undo_blocked', summary_json = ? WHERE id = ?").run(JSON.stringify({ ...s, blockedReason: reason }), batch.id);
    throw new HttpError(409, `تعذّر التراجع ولم يتغير شيء: ${reason}`, 'undo_blocked');
  }
  return { ok: true, batchId: batch.id, reverted };
}

/* ---------- القوالب ---------- */
function exampleValue(db, col, cache, actor) {
  if (col.example !== undefined) return col.example;
  if (col.list) return col.list(db)[0] ?? '';
  if (col.type !== 'fk' || !col.required) return '';
  if (col.fk.table === 'users' && col.fk.by[0] === 'username') return actor.username;
  const map = fkLookup(db, cache, col);
  for (const [, row] of map) if (!row.ambiguous) return row[col.fk.by[0]] ?? '';
  return '';
}
const typeHint = (col) => ({ text: 'نص', latin: 'نص بالإنجليزية', code: 'رمز', int: `عدد صحيح${col.min !== undefined ? ` من ${col.min} إلى ${col.max}` : ''}`, num: `رقم${col.min !== undefined ? ` من ${col.min} إلى ${col.max}` : ''}`, bool: 'نعم أو لا', date: 'تاريخ مثل 2026-10-15', dateEpoch: 'تاريخ مثل 2026-10-15', datetimeEpoch: 'تاريخ ووقت مثل 2026-10-15 09:30', monthCode: 'شهر مثل 2026-10', questions: 'قائمة JSON فيها q وoptions والإجابة', time: 'وقت مثل 09:30', minutes: 'وقت مثل 09:30', tel: 'هاتف', email: 'بريد إلكتروني', enum: 'قائمة', fk: col.fk?.hint ?? 'مرجع' }[col.type] ?? col.type);

export function importTemplate({ db }, actor, kind, format = 'xlsx') {
  const def = defOf(kind);
  needKind(actor, def);
  const cache = new Map(), N = MAX_ROWS + 1;
  const heading = (c) => (c.required ? `${c.label} *` : c.label), exampleOf = (c) => exampleValue(db, c, cache, actor);
  // البند الثاني في المثال حيث يلزم بندان كالمدين والدائن
  const secondLine = (col) => (col.example2 !== undefined ? col.example2 : exampleOf(col)), hasSecond = def.lineColumns?.some((c) => c.example2 !== undefined);
  if (format === 'csv') {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const columns = fileColumns(def), rows = [columns.map(heading), columns.map(exampleOf)];
    if (hasSecond) rows.push([...def.columns.map((c) => (c === docColumn(def) ? exampleOf(c) : '')), ...def.lineColumns.map(secondLine)]);
    return { filename: `import-${kind}.csv`, type: 'text/csv; charset=utf-8', body: Buffer.from(`﻿${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`, 'utf8') };
  }
  const lists = [], letter = (i) => String.fromCharCode(65 + (i % 26)).padStart(i >= 26 ? 2 : 1, 'A');
  const validationsFor = (columns) => { const validations = []; columns.forEach((col, i) => {
    let values = null;
    if (col.type === 'enum') values = Object.values(col.options).map((l) => l[0]);
    else if (col.type === 'bool') values = ['نعم', 'لا'];
    else if (col.list) values = col.list(db);
    else if (col.type === 'fk' && !col.fk.noList) values = [...new Set(db.prepare(`SELECT ${q(col.fk.by[0])} AS v FROM ${q(col.fk.table)} WHERE ${q(col.fk.by[0])} IS NOT NULL ORDER BY 1 LIMIT 500`).all().map((r) => String(r.v)))];
    const c = letter(i), rg = `${c}2:${c}${N}`;
    if (values?.length) { lists.push({ label: col.label, values }); const lc = letter(lists.length - 1); validations.push({ sqref: rg, type: 'list', f1: `'القوائم'!$${lc}$2:$${lc}$${values.length + 1}`, title: col.label, msg: 'اختر قيمة من القائمة.' }); }
    else if (col.type === 'int' && col.min !== undefined) validations.push({ sqref: rg, type: 'whole', f1: String(col.min), f2: String(col.max), title: col.label, msg: `عدد صحيح بين ${col.min} و${col.max}.` });
    else if (col.type === 'num' && col.min !== undefined) validations.push({ sqref: rg, type: 'decimal', f1: String(col.min), f2: String(col.max), title: col.label, msg: `رقم بين ${col.min} و${col.max}.` });
    else if (col.max && ['text', 'latin', 'code'].includes(col.type)) validations.push({ sqref: rg, type: 'textLength', f1: '1', f2: String(col.max), title: col.label, msg: `بحد أقصى ${col.max} حرفاً.` });
  }); return validations; };
  const keyLabels = def.key.map((k) => def.columns.find((c) => toOf(c) === k || c.fk?.copy?.[k])?.label ?? k);
  const info = [
    ['البند', 'التفاصيل'], ['نوع الاستيراد', def.title], ['الوصف', def.desc],
    ['مفتاح التحديث', keyLabels.length ? `${keyLabels.join(' + ')}: السجل الموجود بهذا المفتاح يُحدَّث ولا يتكرر، والخلية الفارغة لا تغيّر القيمة الحالية.` : 'لا يوجد: كل صف يُنشئ سجلاً جديداً.'],
    ['يعتمد على', def.deps.length ? def.deps.map((d) => IMPORT_DEFS[d]?.title ?? d).join('، ') : 'لا شيء'], ['ترتيب الاستيراد', IMPORT_ORDER_HINT],
    ['الحدود', `${MAX_ROWS} صف و10 ميغابايت للملف. الصيغ: xlsx وcsv وsql.`], ['الصف الأول', 'صف مثال؛ احذفه قبل الرفع.'],
    ...(def.lineColumns ? [['المستند', `ورقتان تُربطان بعمود «${docColumn(def).label}». في csv يكون كل بند صفاً يتكرر فيه رقم المستند. المستند يُقبل كاملاً أو يُرفض كاملاً، ولا يُحدَّث مستند موجود.`]] : []), [],
    ['العمود', 'النوع', 'إلزامي'], ...fileColumns(def).map((c) => [c.label, typeHint(c), c.required ? 'نعم' : 'لا']),
  ];
  const sheetFor = (name, columns, rows) => ({ name, rows: [columns.map(heading), ...rows], widths: columns.map((c) => Math.max(16, Math.min(34, c.label.length + 8))), validations: validationsFor(columns), rtl: true, textCols: columns.map((c, i) => (['code', 'tel'].includes(c.type) || c.type === 'fk' ? i : -1)).filter((i) => i >= 0) });
  const data = def.lineColumns
    ? [sheetFor('الرأس', def.columns, [def.columns.map(exampleOf)]), (() => { const cols = [docColumn(def), ...def.lineColumns]; return sheetFor('البنود', cols, [cols.map(exampleOf), ...(hasSecond ? [[exampleOf(docColumn(def)), ...def.lineColumns.map(secondLine)]] : [])]); })()]
    : [sheetFor('البيانات', def.columns, [def.columns.map(exampleOf)])];
  const sheets = [...data, { name: 'تعليمات', rows: info, widths: [26, 60, 12], rtl: true }];
  if (lists.length) {
    const mx = Math.max(...lists.map((l) => l.values.length));
    sheets.splice(data.length, 0, { name: 'القوائم', rows: [lists.map((l) => l.label), ...Array.from({ length: mx }, (_, i) => lists.map((l) => l.values[i] ?? ''))], widths: lists.map(() => 26), rtl: true });
  }
  return { filename: `import-${kind}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: writeXlsx(sheets, { title: `نموذج ${def.title}` }) };
}
