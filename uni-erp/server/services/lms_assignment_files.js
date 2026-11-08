// التحقق من ملفات الاختبارات والتكليفات: النوع من محتوى الملف لا من امتداده، والامتداد يجب أن يطابق المحتوى.
// صيغ Office القديمة والملفات ذات الماكرو مرفوضة، كما ترفض المحاضرات صيغة ppt القديمة.
import fs from 'node:fs';
import path from 'node:path';
import { bad } from '../validate.js';
import { HttpError } from '../http.js';
import { sniff } from './media.js';

const MB = 1024 * 1024;
export const ASSIGNMENT_FILE_KINDS = ['pdf', 'word', 'powerpoint', 'image', 'zip', 'video'];
export const STUDENT_DEFAULT_KINDS = ['pdf', 'word', 'powerpoint', 'image', 'zip'];
export const ASSIGNMENT_LIMITS = { teacherFile: 50 * MB, teacherVideo: 200 * MB, studentFile: 20 * MB, studentFiles: 5 };

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EXTENSIONS = { pdf: ['pdf'], docx: ['docx'], pptx: ['pptx'], zip: ['zip'], jpg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'], gif: ['gif'], mp4: ['mp4', 'm4v'], webm: ['webm'] };
const EOCD = 0x06054b50, CENTRAL = 0x02014b50, EOCD_TAIL = 65557, MAX_CENTRAL_DIR = 8 * MB;

// أسماء العناصر من الفهرس المركزي في آخر الملف، فلا يُقرأ الملف كاملاً ولا يُفك ضغطه
async function zipEntryNames(file, size) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const tailSize = Math.min(size, EOCD_TAIL), tail = Buffer.alloc(tailSize);
    await fh.read(tail, 0, tailSize, size - tailSize);
    let at = -1;
    for (let i = tailSize - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { at = i; break; }
    if (at < 0) throw bad('ملف ZIP تالف أو غير مكتمل.');
    const dirSize = tail.readUInt32LE(at + 12), dirOffset = tail.readUInt32LE(at + 16);
    if (dirSize === 0xffffffff || dirOffset === 0xffffffff) return [];   // ZIP64: أرشيف ضخم عادي، وليس مستند Office
    if (dirSize > MAX_CENTRAL_DIR || dirOffset + dirSize > size) throw bad('ملف ZIP تالف أو غير مكتمل.');
    const dir = Buffer.alloc(dirSize);
    await fh.read(dir, 0, dirSize, dirOffset);
    const names = [];
    for (let p = 0; p + 46 <= dirSize && dir.readUInt32LE(p) === CENTRAL;) {
      const n = dir.readUInt16LE(p + 28), extra = dir.readUInt16LE(p + 30), comment = dir.readUInt16LE(p + 32);
      names.push(dir.toString('utf8', p + 46, p + 46 + n));
      p += 46 + n + extra + comment;
    }
    return names;
  } finally { await fh.close(); }
}

async function detect(upload) {
  const head = upload.head;
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  const media = sniff(head);
  if (media) return media;
  if (head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw bad('صيغ Office القديمة غير مدعومة؛ احفظ الملف بصيغة docx أو pptx.');
  if (!head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw bad('نوع الملف غير مدعوم: PDF أو Word أو PowerPoint أو صورة أو ZIP أو فيديو mp4/webm.');
  const names = await zipEntryNames(upload.uploadPath, upload.size);
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) throw bad('الملفات التي تحوي وحدات ماكرو غير مقبولة.');
  if (names.includes('word/document.xml')) return { kind: 'word', mime: WORD_MIME, ext: 'docx' };
  if (names.includes('ppt/presentation.xml')) return { kind: 'powerpoint', mime: PPTX_MIME, ext: 'pptx' };
  if (names.includes('xl/workbook.xml')) throw bad('ملفات Excel غير مدعومة هنا.');
  return { kind: 'zip', mime: 'application/zip', ext: 'zip' };
}

export function cleanFilename(name, ext) {
  const s = String(name ?? '').replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim().slice(0, 150) || 'ملف';
  return path.extname(s) ? s : `${s}.${ext}`;
}

// يعيد وصف الملف الجاهز للحفظ، أو يرفضه برسالة واضحة. maxBytes وallowed من إعدادات الاختبار
export async function inspectUpload(upload, name, { allowed = ASSIGNMENT_FILE_KINDS, maxBytes } = {}) {
  if (!upload?.size) throw bad('الملف فارغ.');
  const t = await detect(upload);
  if (!allowed.includes(t.kind)) throw bad('هذا النوع من الملفات غير مسموح في هذا الاختبار.');
  if (maxBytes && upload.size > maxBytes) throw new HttpError(413, `حجم الملف يتجاوز ${Math.floor(maxBytes / MB)} ميغابايت.`, 'too_large');
  const filename = cleanFilename(name, t.ext), given = path.extname(filename).slice(1).toLowerCase();
  if (!EXTENSIONS[t.ext].includes(given)) throw bad('امتداد الملف لا يطابق محتواه الفعلي.');
  return { kind: t.kind, mime: t.mime, ext: t.ext, filename, size: upload.size };
}
