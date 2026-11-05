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

// جمع عدادات حدود المعدل كل ثانية عبر اتصال منفصل، فلا تُعطِّل الخيط الرئيسي
export function startRateSync({ url, take, apply, purge }) {
  if (!isClustered()) return () => {};
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  pool.on('error', (e) => log.warn('rate sync: ' + e.message));
  let busy = false, ticks = 0;
  const timer = setInterval(async () => {
    if (busy) return;
    const deltas = take();
    if (!deltas.length && ticks % 60) { ticks++; return; }
    busy = true; ticks++;
    try {
      if (deltas.length) {
        const r = await pool.query('INSERT INTO rate_counters (key, count, updated_at) SELECT k, n, $3 FROM unnest($1::text[], $2::bigint[]) AS t(k, n) ON CONFLICT (key) DO UPDATE SET count = rate_counters.count + EXCLUDED.count, updated_at = EXCLUDED.updated_at RETURNING key, count', [deltas.map((d) => d[0]), deltas.map((d) => d[1]), Date.now()]);
        apply(r.rows);
      }
      if (purge && ticks % 60 === 0) await pool.query('DELETE FROM rate_counters WHERE updated_at < $1', [Date.now() - 600_000]);
    } catch (e) { log.warn('rate sync: ' + e.message); } finally { busy = false; }
  }, 1000);
  timer.unref();
  return () => { clearInterval(timer); pool.end().catch(() => {}); };
}
