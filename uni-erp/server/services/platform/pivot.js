// التقارير المحورية: يختار المستخدم مجموعة بيانات وبُعداً للصفوف وآخر للأعمدة ومقياساً، فيحصل على جدول تجميع بمجاميعه.
// لا SQL من المستخدم: الأبعاد والمقاييس قائمة مغلقة لكل مجموعة، وكل مجموعة لها صلاحية الوحدة المالكة ونطاقها.
import { writeXlsx } from '../../lib/xlsx.js';
import { STATUS_LABEL as STUDENT_STATUS } from '../students.js';
import { bad, staffOnly, today, DAY_RE } from './records.js';

const MONTH = (col) => `to_char(to_timestamp(${col} / 1000.0) AT TIME ZONE 'Asia/Damascus', 'YYYY-MM')`;
const COUNT = ['العدد', 'COUNT(*)', 'sum'];
const MAX_KEYS = 200;

// الأبعاد: [التسمية، التعبير، تسميات القيم اختيارياً]. المقاييس: [التسمية، التعبير، طريقة جمع المجاميع]
const DATASETS = {
  students: {
    label: 'الطلاب', perms: ['student:read'],
    from: 'student_profiles p JOIN users u ON u.id = p.user_id LEFT JOIN programs g ON g.id = p.program_id LEFT JOIN faculties f ON f.id = g.faculty_id',
    date: 'p.created_at',
    scope: (u) => (u.data_scope === 'faculty' && u.scope_faculty ? ['p.program_id IN (SELECT id FROM programs WHERE faculty = ?)', [u.scope_faculty]] : null),
    dims: {
      faculty: ['الكلية', "COALESCE(f.name, g.faculty, '—')"], program: ['البرنامج', "COALESCE(g.name, '—')"], status: ['حالة القيد', 'p.status', STUDENT_STATUS],
      gender: ['الجنس', "COALESCE(p.gender, '—')"], governorate: ['المحافظة', "COALESCE(p.governorate, '—')"], enroll_year: ['سنة القيد', 'CAST(p.enroll_year AS TEXT)'],
      study_level: ['السنة الدراسية', 'CAST(p.study_level AS TEXT)'], admission_type: ['نوع القبول', "COALESCE(p.admission_type, '—')"], hs_type: ['فرع الشهادة الثانوية', "COALESCE(p.hs_type, '—')"],
    },
    measures: { count: COUNT, avg_hs: ['متوسط علامة الثانوية', 'ROUND(AVG(p.hs_score)::numeric, 1)', 'avg'] },
  },
  requests: {
    label: 'طلبات الطلاب', perms: ['request:read_all', 'request:read_unit'],
    from: 'requests r LEFT JOIN service_types s ON s.code = r.service_code LEFT JOIN org_units o ON o.id = r.assigned_unit_id',
    date: 'r.created_at',
    scope: (u) => (u.can('request:read_all') ? null : [`r.assigned_unit_id IN (${(u.unitIds?.length ? u.unitIds : [0]).map(() => '?').join(',')})`, (u.unitIds?.length ? u.unitIds : [0]).map(Number)]),
    dims: {
      service: ['الخدمة', "COALESCE(s.label, r.service_code)"], status: ['الحالة', 'r.status', { review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض' }],
      unit: ['الجهة المسؤولة', "COALESCE(o.name, '—')"], month: ['الشهر', MONTH('r.created_at')],
    },
    measures: { count: COUNT, avg_hours: ['متوسط ساعات الإنجاز', 'ROUND(AVG(CASE WHEN r.decided_at IS NOT NULL THEN (r.decided_at - r.created_at) / 3600000.0 END)::numeric, 1)', 'avg'] },
  },
  complaints: {
    label: 'الشكاوى', perms: ['comms:read', 'complaint:manage'],
    from: 'complaints c', date: 'c.created_at',
    dims: { status: ['الحالة', 'c.status', { open: 'مفتوحة', answered: 'مُجابة', closed: 'مغلقة' }], month: ['الشهر', MONTH('c.created_at')] },
    measures: { count: COUNT },
  },
  maintenance: {
    label: 'أوامر الصيانة', perms: ['facilities:manage'],
    from: 'maintenance_orders m', date: 'm.created_at',
    dims: {
      category: ['الفئة', 'm.category'], priority: ['الأولوية', 'm.priority', { normal: 'عادي', urgent: 'مستعجل', emergency: 'طارئ' }],
      status: ['الحالة', 'm.status', { open: 'جديد', assigned: 'قيد التنفيذ', done: 'نُفّذ', closed: 'مغلق', cancelled: 'ملغى' }], month: ['الشهر', MONTH('m.created_at')],
    },
    measures: { count: COUNT, cost: ['مجموع الكلفة', 'SUM(m.cost)', 'sum'] },
  },
  proc_requests: {
    label: 'طلبات الشراء', perms: ['procurement:read', 'procurement:manage'],
    from: 'proc_requests q JOIN users u ON u.id = q.requester_id LEFT JOIN org_units o ON o.id = u.unit_id', date: 'q.created_at',
    dims: {
      status: ['الحالة', 'q.status', { draft: 'مسودة', pending: 'قيد الاعتماد', approved: 'معتمد', rejected: 'مرفوض', ordered: 'صدر أمر توريد', cancelled: 'ملغى' }],
      unit: ['وحدة الطالب', "COALESCE(o.name, '—')"], month: ['الشهر', MONTH('q.created_at')],
    },
    measures: { count: COUNT },
  },
  approvals: {
    label: 'طلبات الموافقة', perms: ['approvals:manage', 'approvals:read_all'],
    from: 'approval_requests a JOIN approval_types t ON t.id = a.type_id JOIN users u ON u.id = a.requester_id LEFT JOIN org_units o ON o.id = u.unit_id', date: 'a.created_at',
    dims: {
      type: ['نوع الموافقة', 't.name'], status: ['الحالة', 'a.status', { pending: 'قيد الاعتماد', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' }],
      unit: ['وحدة مقدّم الطلب', "COALESCE(o.name, '—')"], month: ['الشهر', MONTH('a.created_at')],
    },
    measures: { count: COUNT, amount: ['مجموع المبالغ', 'SUM(a.amount)', 'sum'], avg_amount: ['متوسط المبلغ', 'ROUND(AVG(a.amount)::numeric, 0)', 'avg'] },
  },
  activities: {
    label: 'الأنشطة والمهام', perms: ['stats:read', 'approvals:manage'],
    from: 'activities x JOIN users u ON u.id = x.assignee_id LEFT JOIN org_units o ON o.id = u.unit_id', date: 'x.created_at',
    dims: {
      kind: ['النوع', 'x.kind', { todo: 'مهمة', call: 'اتصال', meeting: 'اجتماع', review: 'مراجعة', deadline: 'موعد نهائي' }],
      status: ['الحالة', 'x.status', { open: 'مفتوح', done: 'منجز', cancelled: 'ملغى' }], assignee: ['المسند إليه', 'u.display_name'], unit: ['وحدة المسند إليه', "COALESCE(o.name, '—')"],
      timing: ['الالتزام بالموعد', "CASE WHEN x.status = 'open' AND x.due_date < '{TODAY}' THEN 'متأخر' WHEN x.status = 'open' THEN 'في الموعد' ELSE 'منتهٍ' END"],
    },
    measures: { count: COUNT },
  },
  employees: {
    label: 'الموظفون', perms: ['hr_emp:view', 'hr:manage'],
    from: 'hr_employees e LEFT JOIN org_units o ON o.id = e.unit_id', date: 'e.created_at',
    dims: { unit: ['الوحدة', "COALESCE(o.name, '—')"], status: ['الحالة', 'e.status', { active: 'على رأس العمل', on_leave: 'في إجازة', terminated: 'منتهية خدمته' }], position: ['المسمى الوظيفي', "COALESCE(NULLIF(e.position, ''), '—')"] },
    measures: { count: COUNT },
  },
};

const allowed = (u, ds) => ds.perms.some((p) => u.can(p));

export function pivotCatalog(actor) {
  staffOnly(actor);
  return Object.entries(DATASETS).filter(([, ds]) => allowed(actor, ds)).map(([key, ds]) => ({
    key, label: ds.label, hasDate: !!ds.date,
    dims: Object.entries(ds.dims).map(([k, d]) => ({ key: k, label: d[0] })), measures: Object.entries(ds.measures).map(([k, m]) => ({ key: k, label: m[0] })),
  }));
}

const expr = (d) => d[1].replace('{TODAY}', today());
const num = (v) => (v === null || v === undefined ? null : Number(v));

export function runPivot(db, actor, q) {
  staffOnly(actor);
  const ds = DATASETS[q?.dataset];
  if (!ds || !allowed(actor, ds)) throw bad('مجموعة البيانات غير متاحة لك.', 403, 'forbidden');
  const rowDim = ds.dims[q.row], colDim = q.col ? ds.dims[q.col] : null, measure = ds.measures[q.measure || 'count'];
  if (!rowDim) throw bad('اختر بُعد الصفوف.');
  if (q.col && !colDim) throw bad('بُعد الأعمدة غير معروف.');
  if (q.col && q.col === q.row) throw bad('بُعد الأعمدة غير بُعد الصفوف.');
  if (!measure) throw bad('المقياس غير معروف.');
  const where = [], args = [];
  const scope = ds.scope?.(actor);
  if (scope) { where.push(scope[0]); args.push(...scope[1]); }
  for (const [k, bound, op] of [['from', q.from, '>='], ['to', q.to, '<']]) {
    if (!bound) continue;
    if (!ds.date || !DAY_RE.test(String(bound))) throw bad('نطاق التاريخ غير صالح.');
    const t = Date.parse(`${bound}T00:00:00+03:00`) + (k === 'to' ? 86_400_000 : 0);
    if (!Number.isFinite(t)) throw bad('نطاق التاريخ غير صالح.');
    where.push(`${ds.date} ${op} ?`); args.push(t);
  }
  if (q.filterDim) {
    const fd = ds.dims[q.filterDim];
    if (!fd) throw bad('بُعد التصفية غير معروف.');
    where.push(`${expr(fd)} = ?`); args.push(String(q.filterValue ?? ''));
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const R = expr(rowDim), C = colDim ? expr(colDim) : "''";
  const run = (sel, group) => db.prepare(`SELECT ${sel} ${measure[1]} AS v FROM ${ds.from} ${W}${group ? ` GROUP BY ${group}` : ''}`).all(...args);
  // ثابت في GROUP BY مرفوض في PostgreSQL، فبلا بُعد أعمدة يُجمَّع بالصفوف وحدها
  const cells = run(`${R} AS r, ${C} AS c,`, colDim ? `${R}, ${C}` : R);
  const rowKeys = [...new Set(cells.map((x) => String(x.r ?? '—')))].sort((a, b) => a.localeCompare(b, 'ar'));
  const colKeys = colDim ? [...new Set(cells.map((x) => String(x.c ?? '—')))].sort((a, b) => a.localeCompare(b, 'ar')) : [''];
  if (rowKeys.length > MAX_KEYS || colKeys.length > MAX_KEYS) throw bad(`القيم كثيرة (أكثر من ${MAX_KEYS})؛ اختر بُعداً أضيق أو ضيّق التاريخ.`, 409, 'too_many');
  const lab = (d, k) => (d?.[2]?.[k] ?? k);
  const matrix = Object.fromEntries(rowKeys.map((r) => [r, Object.fromEntries(colKeys.map((c) => [c, null]))]));
  for (const x of cells) matrix[String(x.r ?? '—')][colDim ? String(x.c ?? '—') : ''] = num(x.v);
  const rowTotals = Object.fromEntries(run(`${R} AS r,`, R).map((x) => [String(x.r ?? '—'), num(x.v)]));
  const colTotals = colDim ? Object.fromEntries(run(`${C} AS c,`, C).map((x) => [String(x.c ?? '—'), num(x.v)])) : { '': null };
  const grand = num(run('', '')[0]?.v);
  return {
    dataset: { key: q.dataset, label: ds.label }, row: { key: q.row, label: rowDim[0] }, col: colDim ? { key: q.col, label: colDim[0] } : null, measure: { key: q.measure || 'count', label: measure[0] },
    rows: rowKeys.map((k) => ({ key: k, label: lab(rowDim, k), cells: colKeys.map((c) => matrix[k][c]), total: rowTotals[k] ?? null })),
    cols: colKeys.map((k) => ({ key: k, label: colDim ? lab(colDim, k) : measure[0], total: colTotals[k] ?? null })),
    grand,
  };
}

export function pivotXlsx(db, actor, q) {
  const p = runPivot(db, actor, q);
  const head = [`${p.row.label}${p.col ? ` \\ ${p.col.label}` : ''}`, ...(p.col ? p.cols.map((c) => c.label) : []), `الإجمالي (${p.measure.label})`];
  const body = p.rows.map((r) => [r.label, ...(p.col ? r.cells.map((v) => v ?? '') : []), r.total ?? '']);
  const foot = ['الإجمالي', ...(p.col ? p.cols.map((c) => c.total ?? '') : []), p.grand ?? ''];
  const name = `${p.dataset.label} حسب ${p.row.label}${p.col ? ` و${p.col.label}` : ''}`;
  return { file: writeXlsx([{ name: p.dataset.label.slice(0, 30), rows: [head, ...body, foot], widths: [28, ...head.slice(1).map(() => 14)] }], { title: name }), name };
}
