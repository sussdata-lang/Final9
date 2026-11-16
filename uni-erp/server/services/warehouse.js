// مستودع بيانات خفيف: لقطة شهرية لمؤشرات مؤسسية عابرة للوحدات، تُعاد حسابها يومياً للشهر الحالي
// فتثبت الأشهر المنتهية، ويتكوّن تاريخ طويل للمقارنة لا تقدر الإحصاءات الحية (lib/analytics.js) عليه
// لأنها تُعيد حسابه من البيانات الخام في كل مرة ولا تحتفظ بما تجاوز نافذتها.
import { HttpError } from '../http.js';
import { passSql } from './academics.js';

const nf = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const METRICS = {
  enrollment_active: { label: 'الطلاب الفعّالون', unit: '', kind: 'stock' },
  enrollment_new: { label: 'قيود جديدة هذا الشهر', unit: '', kind: 'flow' },
  pass_rate: { label: 'نسبة النجاح (علامات هذا الشهر)', unit: '%', kind: 'flow' },
  avg_mark: { label: 'متوسط العلامات (هذا الشهر)', unit: '', kind: 'flow' },
  fee_collected: { label: 'الرسوم المحصَّلة هذا الشهر', unit: 'ل.س', kind: 'flow' },
  fee_outstanding: { label: 'الرسوم المستحقة غير المحصَّلة', unit: 'ل.س', kind: 'stock' },
  payroll_cost: { label: 'كلفة الرواتب الشهرية (الأساسي والبدلات)', unit: 'ل.س', kind: 'stock' },
  staff_headcount: { label: 'عدد الموظفين الفعّالين', unit: '', kind: 'stock' },
  procurement_spend: { label: 'قيمة أوامر الشراء هذا الشهر', unit: 'ل.س', kind: 'flow' },
  requests_total: { label: 'الطلبات المقدَّمة هذا الشهر', unit: '', kind: 'flow' },
  requests_late: { label: 'طلبات متأخرة عن مدتها (الآن)', unit: '', kind: 'stock' },
  disciplinary_opened: { label: 'عقوبات انضباطية فُرضت هذا الشهر', unit: '', kind: 'flow' },
};
const CODES = Object.keys(METRICS);

const pad2 = (n) => String(n).padStart(2, '0');
export const periodOf = (d = new Date()) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
const monthRange = (period) => {
  const [y, m] = period.split('-').map(Number);
  return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) };
};
const monthsBack = (n, now = new Date()) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)); return periodOf(d); });

// يحسب كل المؤشرات لشهر معيّن (الحالي افتراضياً) ويحفظها؛ آمن التكرار (كل إعادة حساب تستبدل قيمة الشهر نفسه)
export function captureSnapshot(db, period = periodOf()) {
  const { from, to } = monthRange(period), now = Date.now();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const put = db.prepare(`INSERT INTO wh_metrics (period, metric_code, value, captured_at) VALUES (?,?,?,?)
    ON CONFLICT (period, metric_code) DO UPDATE SET value = excluded.value, captured_at = excluded.captured_at`);
  const set = (code, value) => put.run(period, code, nf(value), now);

  set('enrollment_active', one("SELECT COUNT(*) c FROM student_profiles WHERE status = 'active'").c);
  set('enrollment_new', one('SELECT COUNT(*) c FROM student_profiles WHERE created_at >= ? AND created_at < ?', from, to).c);

  const gs = one(`SELECT COUNT(*) c, AVG(mark) a, SUM(CASE WHEN mark >= ${passSql(db, 'student_id')} THEN 1 ELSE 0 END) p
    FROM grades WHERE workflow_status = 'approved' AND entered_at >= ? AND entered_at < ?`, from, to);
  set('pass_rate', gs.c ? (Number(gs.p) / Number(gs.c)) * 100 : 0);
  set('avg_mark', gs.c ? gs.a : 0);

  set('fee_collected', one("SELECT COALESCE(SUM(amount), 0) v FROM fin_payments WHERE status <> 'void' AND paid_day >= ? AND paid_day < ?",
    new Date(from).toISOString().slice(0, 10), new Date(to).toISOString().slice(0, 10)).v);
  const charged = one(`SELECT COALESCE(SUM(CASE WHEN ft.kind = 'discount' THEN -c.amount ELSE c.amount END), 0) v
    FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id WHERE c.status = 'open'`).v;
  const paidAll = one("SELECT COALESCE(SUM(amount), 0) v FROM fin_payments WHERE status <> 'void'").v;
  set('fee_outstanding', Math.max(0, Number(charged) - Number(paidAll)));

  set('payroll_cost', one("SELECT COALESCE(SUM(salary_base + COALESCE(housing_allowance, 0) + COALESCE(transport_allowance, 0)), 0) v FROM hr_employees WHERE status = 'active'").v);
  set('staff_headcount', one("SELECT COUNT(*) c FROM hr_employees WHERE status = 'active'").c);

  set('procurement_spend', one("SELECT COALESCE(SUM(total_amount), 0) v FROM proc_orders WHERE status IN ('ordered', 'received') AND COALESCE(ordered_at, created_at) >= ? AND COALESCE(ordered_at, created_at) < ?", from, to).v);

  set('requests_total', one('SELECT COUNT(*) c FROM requests WHERE created_at >= ? AND created_at < ?', from, to).c);
  set('requests_late', one("SELECT COUNT(*) c FROM requests r JOIN service_types st ON st.code = r.service_code WHERE r.status = 'review' AND st.sla_hours > 0 AND ? - r.created_at > st.sla_hours * 3600000", now).c);

  set('disciplinary_opened', one("SELECT COUNT(*) c FROM student_holds WHERE hold_type = 'disciplinary' AND created_at >= ? AND created_at < ?", from, to).c);

  return { period, metrics: CODES.length };
}

// آخر 24 شهراً (أو ما طُلب) لكل مؤشر، للمخطط الزمني
export function warehouseOverview(db, q = {}) {
  const n = Math.min(60, Math.max(3, Number(q.months) || 24));
  const periods = monthsBack(n);
  const rows = db.prepare(`SELECT period, metric_code, value FROM wh_metrics WHERE period >= ? ORDER BY period`).all(periods[0]);
  const byMetric = new Map();
  for (const r of rows) { if (!byMetric.has(r.metric_code)) byMetric.set(r.metric_code, new Map()); byMetric.get(r.metric_code).set(r.period, Number(r.value)); }
  const latest = periods.at(-1);
  const kpis = CODES.map((code) => {
    const series = periods.map((p) => byMetric.get(code)?.get(p) ?? null);
    const cur = byMetric.get(code)?.get(latest) ?? null;
    const prevPeriod = periods.at(-2);
    const prev = prevPeriod ? byMetric.get(code)?.get(prevPeriod) ?? null : null;
    return { code, label: METRICS[code].label, unit: METRICS[code].unit, kind: METRICS[code].kind, value: cur, change: cur !== null && prev !== null && prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null, series };
  });
  return { periods, latest, hasData: rows.length > 0, kpis };
}

export function registerWarehouseRoutes(r, deps) {
  const { db } = deps;
  const can = (c) => c.user && (c.user.role === 'admin' || c.user.can?.('stats:read'));
  r.add('GET', '/api/warehouse/overview', (c) => {
    if (!can(c)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, warehouseOverview(db, c.query ?? {}));
  });
  r.add('POST', '/api/warehouse/capture', (c) => {
    if (!(c.user.role === 'admin' || c.user.can?.('settings:manage'))) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, captureSnapshot(db));
  });
}
