// العمليات الثقيلة (الاستيراد والتقارير الكبيرة) تعمل في خيوط مستقلة باتصالها الخاص بقاعدة البيانات.
// الخيط الرئيسي ينتظر كل استعلام متزامناً، فلو نُفّذت فيه لتوقف كل المستخدمين حتى تنتهي.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { audit } from './audit.js';
import { flushAllCaches } from './cache.js';
import { HttpError } from './http.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'heavy_worker.js');
const POOL_SIZE = 2;
const IDLE_MS = 30_000;

export function createHeavyPool({ db, cfg }) {
  const slots = [];
  const queue = [];
  let nextId = 1, closed = false;

  function spawn() {
    const slot = { worker: null, job: null };
    slot.worker = new Worker(WORKER_PATH, { workerData: { pgUrl: db.pgUrl, cfg: JSON.parse(JSON.stringify(cfg)) } });
    slot.worker.unref();
    slot.worker.on('message', (m) => finish(slot, m));
    slot.idle = null;
    const lost = (message) => {
      const i = slots.indexOf(slot);
      if (i >= 0) slots.splice(i, 1);
      if (slot.job) { const { reject } = slot.job; slot.job = null; reject(new Error(message)); }
      if (!closed) pump();
    };
    slot.worker.on('error', (e) => lost(`[heavy] ${e.message}`));
    slot.worker.on('exit', () => lost('[heavy] توقف الخيط أثناء العملية'));
    slots.push(slot);
    return slot;
  }
  function finish(slot, m) {
    const job = slot.job; slot.job = null;
    slot.worker.unref();
    // الخيط الخامل يحجز نحو 50 ميغابايت واتصالات بقاعدة البيانات، فيُغلق حتى تأتي عملية ثقيلة أخرى
    slot.idle = setTimeout(() => slot.worker.terminate(), IDLE_MS);
    slot.idle.unref();
    if (job) {
      try {
        // سجل التدقيق سلسلة بصمات لها كاتب واحد هو الخيط الرئيسي، فتُكتب بنود الخيط هنا بعد نجاحه
        for (const a of m.audits ?? []) audit(db, a.actor, a.action, a.ref, a.ip);
        if (m.audits?.length || job.writes) flushAllCaches(db);
      } catch (e) { console.error('[heavy] audit replay', e.message); }
      if (m.error) job.reject(m.error.status ? new HttpError(m.error.status, m.error.message, m.error.code, m.error.field) : new Error(m.error.message));
      else job.resolve(m.result);
    }
    pump();
  }
  function pump() {
    while (queue.length) {
      const slot = slots.find((s) => !s.job) ?? (slots.length < POOL_SIZE ? spawn() : null);
      if (!slot) return;
      const job = queue.shift();
      clearTimeout(slot.idle);
      slot.job = job;
      slot.worker.ref();
      slot.worker.postMessage({ id: job.id, name: job.name, token: job.token, args: job.args });
    }
  }
  return {
    // token: رمز جلسة المستخدم، فالخيط يبني المستخدم وصلاحياته بنفسه ولا يثق بما يُمرَّر إليه
    run(name, c, args = [], { writes = false } = {}) {
      if (closed) return Promise.reject(new Error('[heavy] أُغلق'));
      return new Promise((resolve, reject) => {
        queue.push({ id: nextId++, name, token: c.cookies?.sid ?? null, args, writes, resolve, reject });
        pump();
      });
    },
    async close() {
      closed = true;
      await Promise.all(slots.splice(0).map((s) => { clearTimeout(s.idle); return s.worker.terminate(); }));
    },
  };
}
