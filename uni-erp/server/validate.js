// تحقق موحد من المدخلات: يرفض الناقص أو الفاسد برسالة واضحة، ولا يخترع قيمة بدلًا منه.
import { HttpError } from './http.js';

export const bad = (message, field) => new HttpError(400, message, 'validation', field);
export const text = (v, max = 300) => String(v ?? '').trim().slice(0, max);
export function required(v, label, max = 300) {
  const s = text(v, max);
  if (!s) throw bad(`«${label}» مطلوب.`);
  return s;
}
export function amount(v, label, { min = 0, optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw bad(`«${label}» يجب أن يكون رقمًا صالحًا لا يقل عن ${min}.`);
  return n;
}
export function isoDay(v, label, { optional = false } = {}) {
  const s = text(v, 10);
  if (!s && optional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`«${label}» يجب أن يكون تاريخًا بصيغة سنة-شهر-يوم.`);
  return s;
}
export function oneOf(v, allowed, label) {
  const s = text(v);
  if (!allowed.includes(s)) throw bad(`قيمة «${label}» غير معروفة.`);
  return s;
}
