// أرقام مستندات لا تتكرر عملياً، وعام دراسي يُحسب من التاريخ بدل كتابته في الكود
import crypto from 'node:crypto';

export const docNo = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

// يبدأ العام الدراسي في أيلول
export function academicYear(now = new Date()) {
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
