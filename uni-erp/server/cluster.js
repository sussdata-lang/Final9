// تشغيل الخادم بعدة عمليات على المنفذ نفسه: WEB_CONCURRENCY=عدد العمليات (الافتراضي 1).
// العملية الأولى وحدها تنفذ الترحيلات والتهيئة ثم تبدأ البقية، وتبقى مسؤولة عن المهام الدورية.
import cluster from 'node:cluster';

const count = Number(process.env.WEB_CONCURRENCY || 1);

if (!(count > 1) || !cluster.isPrimary) {
  await import('./index.js');
} else {
  cluster.schedulingPolicy = cluster.SCHED_RR;
  let stopping = false, leader = null, started = 0;
  const spawn = (isLeader, boot) => {
    const w = cluster.fork({ UNI_SCHEDULER: isLeader ? '1' : '0', UNI_BOOT: boot ? '1' : '0' });
    w.uniLeader = isLeader;
    if (isLeader) leader = w;
    return w;
  };
  const first = spawn(true, true);
  // البقية بعد اكتمال تهيئة الأولى، فلا تتسابق العمليات على الترحيلات وملفات المفاتيح
  first.once('listening', () => {
    for (let i = 1; i < count; i++) spawn(false, false);
    started = Date.now();
  });
  cluster.on('exit', (w, code, signal) => {
    if (stopping) { if (!Object.keys(cluster.workers).length) process.exit(0); return; }
    if (!started) { console.error('[cluster] تعذرت تهيئة العملية الأولى.'); process.exit(1); }
    console.error(`[cluster] توقفت العملية ${w.process.pid} (${signal ?? code})؛ تُستبدل.`);
    setTimeout(() => { if (!stopping) spawn(w === leader, false); }, 1000);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      stopping = true;
      for (const w of Object.values(cluster.workers)) w.process.kill(sig);
      setTimeout(() => process.exit(0), 30_000).unref();
    });
  }
}
