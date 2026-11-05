// منع تكرار العمليات المالية: الضغطة المزدوجة أو إعادة الإرسال بعد انقطاع الشبكة لا تسجلان العملية مرتين.
// الواجهة ترسل ترويسة Idempotency-Key، والمفتاح يُحفظ في القاعدة فيصلح مع عدة عمليات خادم.
import crypto from 'node:crypto';
import { HttpError } from '../http.js';

export const IDEMPOTENT_ROUTES = new Set([
  'POST /api/finance/journal',
  'POST /api/finance/vouchers',
  'POST /api/finance/invoices',
  'POST /api/finance/invoices/:id/pay',
  'POST /api/finance/charges',
  'POST /api/finance/discounts',
  'POST /api/finance/payments',
  'POST /api/finance/payroll-entry',
  'POST /api/finance/student-invoices',
  'POST /api/finance/student-invoices/:id/pay',
  'POST /api/enterprise/installments/:id/pay',
  'POST /api/enterprise/payslips/issue',
  'POST /api/student-affairs-suite/scholarships',
]);

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const RETENTION_MS = 24 * 3600_000;

export function withIdempotency(db, handler) {
  return async (c) => {
    const raw = c.req.headers['idempotency-key'];
    if (raw === undefined || !c.user) return handler(c);
    if (!KEY.test(String(raw))) throw new HttpError(400, 'مفتاح منع التكرار غير صالح.', 'validation');
    const key = `${c.user.id}:${c.req.method}:${String(c.req.url).split('?')[0]}:${raw}`;
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(c.body ?? {})).digest('hex');

    const claimed = db.prepare('INSERT INTO idempotency_keys (key, body_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING').run(key, bodyHash, Date.now()).changes;
    if (!claimed) {
      const seen = db.prepare('SELECT body_hash, status_code, response_json FROM idempotency_keys WHERE key = ?').get(key);
      if (seen && seen.body_hash !== bodyHash) throw new HttpError(422, 'استُخدم مفتاح منع التكرار مع بيانات مختلفة.', 'idempotency_mismatch');
      // بلا رد محفوظ: العملية جارية أو انقطعت قبل حفظ ردها، فلا تُعاد خشية تسجيلها مرتين
      if (!seen || seen.status_code === null || seen.status_code === undefined) throw new HttpError(409, 'هذه العملية قيد التنفيذ أو سبق إرسالها؛ راجع السجل قبل إعادتها.', 'idempotency_in_progress');
      c.res.setHeader('Idempotency-Replayed', 'true');
      return c.json(Number(seen.status_code), JSON.parse(seen.response_json));
    }

    const send = c.json;
    let status = null, payload = null;
    c.json = (s, b) => { status = s; payload = b; return send.call(c, s, b); };
    const release = () => db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key);
    try {
      await handler(c);
    } catch (err) {
      release();   // فشلت العملية ولم تُسجَّل: يمكن إعادتها بالمفتاح نفسه
      throw err;
    }
    if (status === null || status >= 400) release();
    else db.prepare('UPDATE idempotency_keys SET status_code = ?, response_json = ? WHERE key = ?').run(status, JSON.stringify(payload ?? {}), key);
    return undefined;
  };
}

export function purgeIdempotencyKeys(db, now = Date.now()) {
  return db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(now - RETENTION_MS).changes;
}
