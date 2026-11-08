// طبقة تخزين الملفات: واجهة واحدة (save/stat/read/delete) فلا تعرف الخدمات مكان الملف، ويمكن إضافة مزوّد آخر دون تغييرها.
// المزوّد الحالي قرص محلي تحت UPLOAD_DIR، وهو القرص الدائم في النشر. الملف يُسمّى بمعرّف عشوائي دائماً.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export const LMS_ASSIGNMENTS_AREA = 'lms_assignments';
const KEY = /^[a-z_]+\/[a-f0-9]{32}\.[a-z0-9]{1,5}$/;
const assertKey = (key) => { if (!KEY.test(String(key))) throw new Error('storage: مفتاح ملف غير صالح'); return String(key); };

async function move(from, to) {
  try { await fs.promises.rename(from, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fs.promises.rm(from, { force: true });
  }
}

export function localStorage(root) {
  const full = (key) => path.join(root, ...assertKey(key).split('/'));
  return {
    // ينقل ملفاً مؤقتاً مكتملاً إلى مكانه دون قراءته في الذاكرة، ويعيد مفتاحه
    async save(area, ext, tempPath) {
      const key = assertKey(`${area}/${crypto.randomBytes(16).toString('hex')}.${ext}`);
      await fs.promises.mkdir(path.dirname(full(key)), { recursive: true });
      await move(tempPath, full(key));
      return key;
    },
    // نسخة مستقلة بمفتاح جديد، فحذف الأصل لا يمس النسخة
    async copy(key) {
      const [area, name] = assertKey(key).split('/'), copied = assertKey(`${area}/${crypto.randomBytes(16).toString('hex')}${path.extname(name)}`);
      await fs.promises.copyFile(full(key), full(copied), fs.constants.COPYFILE_EXCL);
      return copied;
    },
    async stat(key) {
      try { const s = await fs.promises.stat(full(key)); return s.isFile() ? { size: s.size } : null; }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    read(key, range = null) {
      return fs.createReadStream(full(key), range ? { start: range.start, end: range.end } : undefined);
    },
    async delete(key) { await fs.promises.rm(full(key), { force: true }); },
  };
}

export const storageOf = (cfg) => (cfg.storage ??= localStorage(cfg.uploadDir));

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0);
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? 'invalid' : { start, end };
}

// يبث ملفاً محمياً مع دعم Range. no-store: لا يبقى في ذاكرة المتصفح بعد سحب الصلاحية
export async function sendStored(req, res, storage, { file, mime, filename, inline = false }, headers = {}) {
  const info = await storage.stat(file);
  if (!info) return false;
  const base = {
    'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`, ...headers,
  };
  const range = parseRange(req.headers.range, info.size);
  if (range === 'invalid') { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
  if (range) res.writeHead(206, { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`, 'Content-Length': range.end - range.start + 1 });
  else res.writeHead(200, { ...base, 'Content-Length': info.size });
  // إغلاق المشغّل للاتصال أثناء التقديم والتأخير أمر معتاد وليس خطأ
  await pipeline(storage.read(file, range), res).catch(() => {});
  return true;
}
