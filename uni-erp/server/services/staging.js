// المرفقات المرسلة بصيغة base64: تُكتب إلى ملف مؤقت قبل المعاملة دون تعطيل الخادم، ثم تُنقل إلى مكانها داخلها.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { incomingDir } from '../http.js';
import { sha256 } from '../security.js';

export async function stageFiles(cfg, list) {
  const items = Array.isArray(list) ? list : list ? [list] : [];
  const staged = [];
  if (!items.some((a) => typeof a?.data === 'string')) return staged;
  await fs.promises.mkdir(incomingDir(cfg), { recursive: true });
  for (const a of items) {
    if (typeof a?.data !== 'string') continue;
    const buf = Buffer.from(a.data, 'base64');
    const file = path.join(incomingDir(cfg), crypto.randomBytes(16).toString('hex'));
    await fs.promises.writeFile(file, buf, { mode: 0o600 });
    a.staged = { path: file, size: buf.length, head: buf.subarray(0, 64), sha: sha256(buf) };
    delete a.data;
    staged.push(file);
  }
  return staged;
}

export const removeStaged = (files) => Promise.all(files.map((f) => fs.promises.rm(f, { force: true }).catch(() => {})));

// يوحّد المرفق المُجهَّز والمرسل مباشرة (الاستيراد الجماعي يصل بلا تجهيز)
export function readUpload(a) {
  if (a?.staged) return { head: a.staged.head, size: a.staged.size, sha: a.staged.sha, stagedPath: a.staged.path };
  const buf = Buffer.from(a.data, 'base64');
  return { head: buf, size: buf.length, sha: sha256(buf), buf };
}

export function saveUpload(file, target) {
  if (file.stagedPath) fs.renameSync(file.stagedPath, target);
  else fs.writeFileSync(target, file.buf, { mode: 0o600 });
}
