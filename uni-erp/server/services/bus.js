// قناة بين عمليات الخادم عبر PostgreSQL (LISTEN/NOTIFY): إبطال ما في ذاكرة كل عملية عند تغيره في غيرها.
// لا تعمل إلا مع أكثر من عملية. تعمل على خادم واحد أو عدة خوادم، ولا تحتاج خدمة إضافية.
import pg from 'pg';
import { log } from '../lib/logger.js';

const CHANNEL = 'uni_bus';
export const isClustered = () => Number(process.env.WEB_CONCURRENCY || 1) > 1;

export function publish(db, type, data = {}) {
  if (!isClustered()) return;
  db.prepare(`SELECT pg_notify('${CHANNEL}', ?::text)`).get(JSON.stringify({ p: process.pid, t: type, d: data }));
}

export function startBus({ url, onMessage }) {
  if (!isClustered()) return () => {};
  let client = null, stopped = false, retry = null;
  const connect = async () => {
    const c = new pg.Client({ connectionString: url, keepAlive: true });
    const again = (err) => {
      if (stopped || client !== c) return;
      client = null;
      if (err) log.warn('bus: ' + err.message);
      // انقطعت القناة: قد تكون فاتت رسائل، فيُفرَّغ المؤقت قبل إعادة الاتصال
      onMessage('flush', {});
      retry = setTimeout(connect, 2000);
      retry.unref();
    };
    client = c;
    c.on('error', again);
    c.on('end', () => again());
    c.on('notification', (n) => {
      try {
        const m = JSON.parse(n.payload);
        if (m.p !== process.pid) onMessage(m.t, m.d ?? {});
      } catch (e) { log.warn('bus message: ' + e.message); }
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${CHANNEL}`);
    } catch (e) { again(e); }
  };
  connect();
  return () => { stopped = true; clearTimeout(retry); client?.end().catch(() => {}); };
}
