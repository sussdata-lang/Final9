// ضغط مسبق للملفات الثابتة وقت بناء الصورة: ينتج file.br وfile.gz بجانب كل ملف نصي/خط قابل للضغط،
// فيُقدَّم مباشرة من القرص بلا كلفة معالج عند أول طلب (server/http.js يفضّل هذه النسخ إن كانت أحدث من الأصل).
// الاستعمال: node scripts/precompress.js [مجلد=public]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { COMPRESSIBLE_EXT } from '../server/http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.argv[2] ?? 'public');
let files = 0, before = 0, brTotal = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!COMPRESSIBLE_EXT.has(path.extname(p))) continue;
    const raw = fs.readFileSync(p);
    if (raw.length <= 512) continue;
    const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    fs.writeFileSync(p + '.br', br); fs.writeFileSync(p + '.gz', zlib.gzipSync(raw, { level: 9 }));
    files++; before += raw.length; brTotal += br.length;
  }
})(root);
console.log(`precompress: ${files} ملفاً، ${(before / 1024).toFixed(0)}KB ← brotli ${(brTotal / 1024).toFixed(0)}KB (${before ? Math.round(100 - brTotal * 100 / before) : 0}% توفير)`);
