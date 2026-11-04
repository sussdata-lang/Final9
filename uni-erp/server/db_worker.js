/**
 * db_worker.js — PostgreSQL worker thread
 * يستقبل استعلامات من الـ main thread ويردّ بالنتائج عبر SharedArrayBuffer
 */
import pg from 'pg';
import { parentPort, workerData } from 'node:worker_threads';

const { Pool } = pg;

// SQLite يُرجع INTEGER/REAL أرقاماً؛ pg يُرجع BIGINT/NUMERIC نصوصاً بشكل افتراضي (فيصير !!"0" صحيحاً).
// نوحّد السلوك هنا: كل القيم المستعملة (معرّفات، أختام زمنية بالمللي ثانية، عدّادات) أصغر بكثير من 2^53.
pg.types.setTypeParser(20, (v) => Number(v));      // INT8 / BIGINT
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC

// SyncExecutor يمرّر الإعداد الكامل باسم poolConfig ({ connectionString, ssl } أو host/user/...)
const poolConfig = workerData.poolConfig || {};
const pool = new Pool({
  ...poolConfig,
  max: workerData.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB Worker Pool Error]', err.message);
});

// الـ SAB: أول 4 bytes = حالة، ثم 4 bytes = طول البيانات، ثم البيانات
// الحالة: 0 = انتظار، 1 = نجاح (آخر دفعة)، 2 = بقيت دفعات، -1 = خطأ
const HEADER_SIZE = 8; // 2 × int32

// المعاملات: pool.query يوزّع كل استعلام على اتصال مختلف فلا يعمل BEGIN/COMMIT/ROLLBACK كوحدة واحدة.
// نثبّت اتصالاً واحداً من BEGIN حتى COMMIT/ROLLBACK. الرئيس متزامن (Atomics.wait) والمعاملة تُنفَّذ كلها دون تداخل
// مع طلبات أخرى، لذا يكفي اتصال مثبَّت واحد. BEGIN المتداخل يُعدّ بعمق ولا يُرسل (SQLite كان يرفضه، هنا نتساهل).
let txClient = null;
let txDepth = 0;

async function runQuery(sql, values) {
  const verb = String(sql).trim().replace(/;+\s*$/, '').toUpperCase();
  if (verb === 'BEGIN' || verb === 'BEGIN TRANSACTION') {
    if (txClient) { txDepth++; return { rows: [], rowCount: 0 }; }
    txClient = await pool.connect();
    try { await txClient.query('BEGIN'); } catch (e) { txClient.release(); txClient = null; throw e; }
    return { rows: [], rowCount: 0 };
  }
  if (txClient && (verb === 'COMMIT' || verb === 'END' || verb === 'ROLLBACK')) {
    if (verb !== 'ROLLBACK' && txDepth > 0) { txDepth--; return { rows: [], rowCount: 0 }; }
    const c = txClient; txClient = null; txDepth = 0;
    try { return await c.query(verb === 'END' ? 'COMMIT' : verb); } finally { c.release(); }
  }
  return (txClient || pool).query(sql, values);
}

// النتيجة الأكبر من الذاكرة المشتركة تُسلَّم دفعات: الرئيس يطلب التالية بعد نسخ كل دفعة
const MAX_RESULT_BYTES = 512 * 1024 * 1024;
let pending = null;
function sendChunk(sa, dataBuf) {
  const part = pending.buf.subarray(pending.at, pending.at + dataBuf.length);
  part.copy(dataBuf);
  pending.at += part.length;
  const done = pending.at >= pending.buf.length;
  if (done) pending = null;
  Atomics.store(sa, 1, part.length);
  Atomics.store(sa, 0, done ? 1 : 2);
  Atomics.notify(sa, 0);
}

parentPort.on('message', async ({ sab, sql, values, next }) => {
  const sa = new Int32Array(sab, 0, 2);
  const dataBuf = Buffer.from(sab, HEADER_SIZE);
  if (next) { sendChunk(sa, dataBuf); return; }

  try {
    const result = await runQuery(sql, values);
    const json = JSON.stringify({ rows: result.rows, rowCount: result.rowCount });
    const encoded = Buffer.from(json, 'utf8');

    if (encoded.length > MAX_RESULT_BYTES) throw new Error(`Result too large: ${encoded.length} bytes`);
    pending = { buf: encoded, at: 0 };
    sendChunk(sa, dataBuf);
    return;
  } catch (e) {
    const errJson = Buffer.from(JSON.stringify({ error: e.message }), 'utf8');
    errJson.copy(dataBuf);
    Atomics.store(sa, 1, errJson.length);
    Atomics.store(sa, 0, -1);
  }

  Atomics.notify(sa, 0);
});
