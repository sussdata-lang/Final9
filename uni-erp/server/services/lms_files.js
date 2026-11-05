// مرفقات المحاضرات: PDF تُقرأ في المتصفح، والفيديو يُبث مع التقديم والتأخير، وعروض PowerPoint تُحوَّل إلى شرائح تُعرض في الصفحة.
// نوع الملف من توقيعه لا من امتداده، وكل الملفات خارج المجلد العام ولا تُبث إلا لمن يملك الوصول.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { sniff, streamFile } from './media.js';
import { readPptx } from '../lib/pptx.js';

const MB = 1024 * 1024;
export const LECTURE_FILE_LIMITS = { pdf: 50 * MB, video: 200 * MB, slides: 50 * MB };
const LABEL = { pdf: 'ملف PDF', video: 'الفيديو', slides: 'العرض التقديمي' };
const MEDIA_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const bad = (m) => new HttpError(400, m, 'validation');
const dirOf = (cfg) => path.join(cfg.uploadDir, 'lms');
const mediaDir = (cfg, file) => path.join(dirOf(cfg), `${file}.media`);

function detect(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  const t = sniff(buf);
  if (t?.kind === 'video') return { kind: 'video', mime: t.mime, ext: t.ext };
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return { kind: 'slides', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' };
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw bad('صيغة ppt القديمة غير مدعومة؛ احفظ العرض بصيغة pptx من PowerPoint.');
  throw bad('نوع الملف غير مدعوم: PDF أو فيديو mp4/webm أو عرض pptx.');
}
const cleanName = (name) => {
  const s = String(name ?? '').replace(/[\\/\u0000-\u001f<>"]/g, '').trim().slice(0, 120);
  return s || 'ملف';
};
// الملف وصل إلى ملف مؤقت؛ يُنقل إلى مكانه دون قراءته في الذاكرة، والعرض التقديمي يُحلَّل في خيط منفصل
export async function addLectureFile({ db, cfg }, actor, lectureId, upload, name, ip, readDeck) {
  const lecture = db.prepare('SELECT id, title FROM lms_lectures WHERE id = ?').get(Number(lectureId));
  if (!lecture) throw new HttpError(404, 'المحاضرة غير موجودة.', 'not_found');
  if (!upload?.size) throw bad('الملف فارغ.');
  const t = detect(upload.head);
  if (upload.size > LECTURE_FILE_LIMITS[t.kind]) throw new HttpError(413, `حجم ${LABEL[t.kind]} يتجاوز ${LECTURE_FILE_LIMITS[t.kind] / MB} ميغابايت.`, 'too_large');
  let deck = null;
  if (t.kind === 'slides') { try { deck = await readDeck(upload.uploadPath); } catch (e) { if (e.status) throw e; throw bad(e.message); } }
  const file = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
  try {
    await fs.promises.mkdir(dirOf(cfg), { recursive: true });
    await fs.promises.rename(upload.uploadPath, path.join(dirOf(cfg), file));
    if (deck?.media.length) {
      await fs.promises.mkdir(mediaDir(cfg, file), { recursive: true });
      for (const m of deck.media) await fs.promises.writeFile(path.join(mediaDir(cfg, file), m.name), m.data);
    }
  } catch (e) {
    if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(e.code)) throw new HttpError(507, 'تعذّر حفظ الملف على الخادم: مجلد الرفع غير صالح للكتابة أو ممتلئ.', 'upload_failed');
    throw e;
  }
  const slidesJson = deck ? JSON.stringify({ width: deck.width, height: deck.height, slides: deck.slides }) : null;
  const id = Number(db.prepare('INSERT INTO lms_lecture_files (lecture_id, filename, kind, mime, size, file, slides_json, created_at) VALUES (?,?,?,?,?,?,?,?)').run(lecture.id, cleanName(name), t.kind, t.mime, upload.size, file, slidesJson, Date.now()).lastInsertRowid);
  audit(db, actor, 'إرفاق ملف بمحاضرة', lecture.title.slice(0, 80), ip);
  return { id, kind: t.kind };
}

export const readDeckFile = async (file) => readPptx(await fs.promises.readFile(file));

export function filesFor(db, lectureIds) {
  const map = new Map();
  if (!lectureIds.length) return map;
  for (const f of db.prepare(`SELECT id, lecture_id, filename, kind, size FROM lms_lecture_files WHERE lecture_id IN (${lectureIds.map(() => '?').join(',')}) ORDER BY id`).all(...lectureIds)) {
    if (!map.has(f.lecture_id)) map.set(f.lecture_id, []);
    map.get(f.lecture_id).push({ id: f.id, filename: f.filename, kind: f.kind, size: Number(f.size) });
  }
  return map;
}

const fileRow = (db, id) => {
  const f = db.prepare('SELECT f.*, l.published FROM lms_lecture_files f JOIN lms_lectures l ON l.id = f.lecture_id WHERE f.id = ?').get(Number(id));
  if (!f) throw new HttpError(404, 'الملف غير موجود.', 'not_found');
  return f;
};
// الطالب لا يصل إلى مرفقات محاضرة غير منشورة
const visibleTo = (f, student) => { if (student && !f.published) throw new HttpError(404, 'الملف غير موجود.', 'not_found'); return f; };
const countView = (db, f) => db.prepare('UPDATE lms_lectures SET views_count = views_count + 1 WHERE id = ?').run(f.lecture_id);

export function streamLectureFile({ db, cfg }, req, res, id, headers, { student }) {
  const f = visibleTo(fileRow(db, id), student), full = path.join(dirOf(cfg), f.file);
  if (!fs.existsSync(full)) throw new HttpError(404, 'الملف غير موجود.', 'not_found');
  if (!/^bytes=[1-9]/.test(req.headers.range ?? '')) countView(db, f);   // طلبات التقديم في الفيديو ليست مشاهدة جديدة
  const safeName = encodeURIComponent(f.filename);
  streamFile(req, res, full, f.mime, { ...headers, 'Content-Disposition': `inline; filename*=UTF-8''${safeName}` });
}
export function lectureSlides({ db }, id, { student }) {
  const f = visibleTo(fileRow(db, id), student);
  if (f.kind !== 'slides' || !f.slides_json) throw bad('هذا الملف ليس عرضاً تقديمياً.');
  countView(db, f);
  return JSON.parse(f.slides_json);
}
export function streamSlideMedia({ db, cfg }, req, res, id, name, headers, { student }) {
  const f = visibleTo(fileRow(db, id), student), ext = /^[\w.-]+\.(png|jpe?g|gif|webp)$/i.exec(String(name))?.[1]?.toLowerCase();
  if (!ext) throw new HttpError(404, 'غير موجود.', 'not_found');
  const full = path.join(mediaDir(cfg, f.file), path.basename(String(name)));
  if (!fs.existsSync(full)) throw new HttpError(404, 'غير موجود.', 'not_found');
  streamFile(req, res, full, MEDIA_MIME[ext], headers);
}

function removeFromDisk(cfg, file) {
  try { fs.unlinkSync(path.join(dirOf(cfg), file)); } catch { /* غير موجود */ }
  try { fs.rmSync(mediaDir(cfg, file), { recursive: true, force: true }); } catch { /* غير موجود */ }
}
export function deleteLectureFile({ db, cfg }, actor, id, ip) {
  const f = fileRow(db, id);
  db.prepare('DELETE FROM lms_lecture_files WHERE id = ?').run(f.id);
  removeFromDisk(cfg, f.file);
  audit(db, actor, 'حذف مرفق محاضرة', f.filename.slice(0, 80), ip);
}
export function removeLectureFiles({ db, cfg }, lectureId) {
  for (const f of db.prepare('SELECT file FROM lms_lecture_files WHERE lecture_id = ?').all(Number(lectureId))) removeFromDisk(cfg, f.file);
}
