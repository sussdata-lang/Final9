// اختبار حي قصير من لوحة الأداء: طلبات حقيقية إلى الخادم نفسه بتزامن متصاعد، وكتابة فعلية تُلغى في نهايتها.
// يعمل في خيط العمليات الثقيلة حتى لا يقيس نفسه من داخل الخيط الرئيسي. لا يقدّر سعة الخادم الفعلية؛ ذلك يحتاج اختبار حمل من جهاز مستقل.
import { tx } from '../db.js';

const STAGES = [10, 25, 50];
const REQUESTS_PER_STAGE = 120;
const TOTAL_REQUESTS = STAGES.length * REQUESTS_PER_STAGE;
const PATHS = ['/api/me', '/api/requests', '/api/students-table?size=25', '/api/stats'];
const WRITES = 50;
const pct = (sorted, p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10 : null);

async function readStage(base, token, concurrency) {
  const times = [];
  let errors = 0, next = 0;
  const worker = async () => {
    while (next < REQUESTS_PER_STAGE) {
      const path = PATHS[next++ % PATHS.length], t = performance.now();
      try {
        const r = await fetch(base + path, { headers: { Cookie: `sid=${token}` }, signal: AbortSignal.timeout(30_000) });
        await r.arrayBuffer();
        if (r.ok) times.push(performance.now() - t); else errors++;
      } catch { errors++; }
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  return { concurrency, requests: REQUESTS_PER_STAGE, requestsPerSec: Math.round(REQUESTS_PER_STAGE / seconds), p50Ms: pct(times, 0.5), p95Ms: pct(times, 0.95), errors };
}

class Rollback extends Error {}

// الكتابة داخل معاملة تُلغى: تقيس قاعدة البيانات فعلياً ولا تترك أي سجل
function writeProbe(db, actor) {
  let inserted = 0, ms = 0;
  try {
    tx(db, () => {
      const now = Date.now(), started = performance.now();
      const ins = db.prepare("INSERT INTO corr_docs (no, title, subject, body, mode, status, creator_id, unit_id, created_at) VALUES (?, ?, ?, ?, 'parallel', 'pending', ?, ?, ?)");
      for (let i = 0; i < WRITES; i++) { ins.run(`PROBE-${now}-${i}`, 'اختبار حي', 'اختبار حي', 'اختبار حي', actor.id, actor.unit_id ?? null, now); inserted++; }
      ms = performance.now() - started;
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  return { inserted, durationMs: Math.round(ms), perSec: ms ? Math.round(inserted / (ms / 1000)) : null, rolledBack: true };
}

export async function runLiveBenchmark({ db }, actor, { port, token }) {
  const base = `http://127.0.0.1:${Number(port)}`, startedAt = Date.now(), stages = [];
  for (const c of STAGES) stages.push(await readStage(base, token, c));
  return { stages, writes: writeProbe(db, actor), totalRequests: TOTAL_REQUESTS, startedAt, durationMs: Date.now() - startedAt };
}
