// الاختبارات والتكليفات: يعدّها عضو الهيئة بمرفقاتها وفيديو توضيحي. كل اختبار لا يراه ولا يديره إلا مالكه،
// ونقل الملكية عند مغادرة صاحبه لمن يدير أعضاء الهيئة. مختلفة عن lms_quizzes (أسئلة بمؤقت وتصحيح آلي).
import { bad, text, required, oneOf } from '../validate.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError, SECURITY_HEADERS } from '../http.js';
import { log } from '../lib/logger.js';
import { storageOf, sendStored, LMS_ASSIGNMENTS_AREA as AREA } from '../lib/storage.js';
import { classifyUrl } from './media.js';
import { inspectUpload, ASSIGNMENT_LIMITS as LIMITS, STUDENT_DEFAULT_KINDS } from './lms_assignment_files.js';
import { APPROVE, replaceTargets, listTargets, audienceCount, targetOptions, pendingApprovals, assignmentForStudent } from './lms_assignment_audience.js';
import { announceAssignment, pushTo } from './lms_assignment_notify.js';

const WRITE = 'lms_lib:write', TRANSFER = 'faculty:manage';
const MB = 1024 * 1024, MAX_ATTACHMENTS = 20, MAX_UPLOAD_BODY = 205 * MB;
const KINDS = ['exam', 'assignment'], MODES = ['text', 'files', 'both'], INLINE_KINDS = new Set(['pdf', 'image', 'video']);
const VIDEO_REJECTED = 'رابط الفيديو غير مدعوم: ضع رابط YouTube أو Google Drive.';

const forbidden = (m = 'لا تملك صلاحية هذا الإجراء.') => new HttpError(403, m, 'forbidden');
const notFound = (m = 'الاختبار غير موجود.') => new HttpError(404, m, 'not_found');
const isFaculty = (db, user) => !!db.prepare('SELECT 1 AS x FROM faculty_members WHERE user_id = ?').get(user.id);
function requireAuthor(db, user) {
  if (!user.can(WRITE) || (user.role !== 'admin' && !isFaculty(db, user))) throw forbidden('إدارة الاختبارات لأعضاء الهيئة التدريسية المرتبطة حساباتهم بسجلهم.');
}
// اختبار غيره يبدو غير موجود، فلا يكشف الرد وجوده
export function owned(db, user, id) {
  requireAuthor(db, user);
  const a = db.prepare('SELECT * FROM lms_assignments WHERE id = ?').get(Number(id));
  if (!a || a.owner_id !== user.id) throw notFound();
  return a;
}

/* ---------- الفيديو: روابط YouTube وGoogle Drive فقط ---------- */
export function parseVideoLink(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let u; try { u = new URL(s); } catch { throw bad(VIDEO_REJECTED, 'videoUrl'); }
  if (u.hostname.toLowerCase() === 'drive.google.com') {
    const id = /^\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? (/^\/(open|uc)$/.test(u.pathname) ? u.searchParams.get('id') : null);
    if (u.protocol !== 'https:' || u.username || u.password || !/^[\w-]{20,100}$/.test(id ?? '')) throw bad(VIDEO_REJECTED, 'videoUrl');
    return { provider: 'drive', ref: id };
  }
  let c; try { c = classifyUrl(s); } catch { throw bad(VIDEO_REJECTED, 'videoUrl'); }
  if (c.provider !== 'youtube') throw bad(VIDEO_REJECTED, 'videoUrl');
  return { provider: 'youtube', ref: c.ref };
}
const videoOf = (a) => {
  if (!a.video_provider) return null;
  return a.video_provider === 'drive'
    ? { provider: 'drive', embed: `https://drive.google.com/file/d/${a.video_ref}/preview`, url: `https://drive.google.com/file/d/${a.video_ref}/view` }
    : { provider: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${a.video_ref}`, url: `https://youtu.be/${a.video_ref}` };
};

/* ---------- قراءة المدخلات ---------- */
function moment(v, label, field, { optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  const t = typeof v === 'number' ? v : new Date(String(v ?? '')).getTime();
  if (!Number.isFinite(t) || t < 946684800000 || t > 4102444800000) throw bad(`«${label}» غير صالح.`, field);
  return Math.trunc(t);
}
function whole(v, label, field, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`«${label}» يجب أن يكون عدداً صحيحاً بين ${min} و${max}.`, field);
  return n;
}
const ownCourses = (db, user) => (user.role === 'admin'
  ? db.prepare('SELECT id, name, code FROM courses WHERE active = 1 ORDER BY name LIMIT 500').all()
  : db.prepare('SELECT c.id, c.name, c.code FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE m.user_id = ? AND c.active = 1 ORDER BY c.name').all(user.id));

function readFields(db, user, b, cur = null) {
  const input = b ?? {};
  const startsAt = moment(input.startsAt, 'تاريخ البدء', 'startsAt'), dueAt = moment(input.dueAt, 'آخر موعد للتسليم', 'dueAt');
  if (dueAt <= startsAt) throw bad('آخر موعد للتسليم يجب أن يكون بعد تاريخ البدء.', 'dueAt');
  const allowLate = input.allowLate === true ? 1 : 0, lateUntil = allowLate ? moment(input.lateUntil, 'نهاية التسليم المتأخر', 'lateUntil', { optional: true }) : null;
  if (lateUntil !== null && lateUntil < dueAt) throw bad('نهاية التسليم المتأخر يجب ألا تسبق آخر موعد.', 'lateUntil');
  const maxScore = Math.round(Number(input.maxScore) * 100) / 100;
  if (!(maxScore > 0 && maxScore <= 1000)) throw bad('الدرجة الكاملة بين 0.01 و1000.', 'maxScore');
  const submissionMode = oneOf(input.submissionMode, MODES, 'نوع الحل');
  const allowedTypes = [...new Set(Array.isArray(input.allowedTypes) ? input.allowedTypes : [])];
  if (allowedTypes.some((k) => !STUDENT_DEFAULT_KINDS.includes(k))) throw bad('أنواع الملفات المسموحة غير صالحة.', 'allowedTypes');
  if (submissionMode !== 'text' && !allowedTypes.length) throw bad('حدد نوعاً واحداً على الأقل من الملفات المسموحة.', 'allowedTypes');
  let courseId = null;
  if (input.courseId !== undefined && input.courseId !== null && input.courseId !== '') {
    courseId = Number(input.courseId);
    if (!ownCourses(db, user).some((c) => c.id === courseId) && courseId !== cur?.course_id) throw bad('اختر مقرراً من المقررات المسندة إليك.', 'courseId');
  }
  const video = parseVideoLink(input.videoUrl);
  return {
    kind: oneOf(input.kind, KINDS, 'النوع'), title: required(input.title, 'العنوان', 150), description: text(input.description, 8000), instructions: text(input.instructions, 8000),
    courseId, startsAt, dueAt, lateUntil, allowLate, maxScore, submissionMode, allowedTypes: JSON.stringify(allowedTypes),
    maxFileBytes: whole(input.maxFileMb, 'حجم الملف', 'maxFileMb', 1, LIMITS.studentFile / MB) * MB,
    maxFiles: whole(input.maxFiles, 'عدد الملفات', 'maxFiles', 1, LIMITS.studentFiles),
    maxAttempts: whole(input.maxAttempts, 'عدد مرات التسليم', 'maxAttempts', 1, 20),
    allowEdit: input.allowEdit === true ? 1 : 0, videoProvider: video?.provider ?? null, videoRef: video?.ref ?? null,
  };
}

/* ---------- العرض ---------- */
const fileView = (f) => ({ id: f.id, filename: f.filename, kind: f.kind, size: f.size, url: `/api/lms/assignments/files/attachment/${f.id}` });
const parseTypes = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
export const view = (a, files = []) => ({
  id: a.id, kind: a.kind, title: a.title, description: a.description, instructions: a.instructions, courseId: a.course_id, courseName: a.course_name ?? null,
  ownerId: a.owner_id, startsAt: a.starts_at, dueAt: a.due_at, lateUntil: a.late_until, maxScore: a.max_score, submissionMode: a.submission_mode, allowedTypes: parseTypes(a.allowed_types_json),
  maxFileMb: Math.round(a.max_file_bytes / MB), maxFiles: a.max_files, maxAttempts: a.max_attempts, allowEdit: !!a.allow_edit, allowLate: !!a.allow_late,
  video: videoOf(a), status: a.status, publishedAt: a.published_at, createdAt: a.created_at, updatedAt: a.updated_at, files: files.map(fileView), fileCount: Number(a.file_count ?? files.length),
});
const filesOf = (db, id) => db.prepare('SELECT * FROM lms_assignment_files WHERE assignment_id = ? ORDER BY id').all(id);
const SELECT = `SELECT a.*, c.name AS course_name, (SELECT COUNT(*) FROM lms_assignment_files f WHERE f.assignment_id = a.id) AS file_count FROM lms_assignments a LEFT JOIN courses c ON c.id = a.course_id`;
const detail = (db, id) => ({ ...view(db.prepare(`${SELECT} WHERE a.id = ?`).get(id), filesOf(db, id)), targets: listTargets(db, id), audienceCount: audienceCount(db, id) });

export function overview({ db }, user) {
  const canAuthor = user.can(WRITE) && (user.role === 'admin' || isFaculty(db, user)), canApprove = user.can(APPROVE);
  if (!canAuthor && !canApprove) requireAuthor(db, user);
  return {
    canAuthor, canApprove, approvals: canApprove ? pendingApprovals(db) : [],
    assignments: canAuthor ? db.prepare(`${SELECT} WHERE a.owner_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 300`).all(user.id).map((a) => view(a)) : [],
    courses: canAuthor ? ownCourses(db, user) : [],
    limits: { studentFileMb: LIMITS.studentFile / MB, studentFiles: LIMITS.studentFiles, teacherFileMb: LIMITS.teacherFile / MB, teacherVideoMb: LIMITS.teacherVideo / MB, attachments: MAX_ATTACHMENTS },
  };
}

/* ---------- الإنشاء والتعديل والنسخ والحذف ---------- */
function createAssignment({ db }, user, b, ip) {
  requireAuthor(db, user);
  const f = readFields(db, user, b), now = Date.now();
  const id = tx(db, () => {
    const newId = Number(db.prepare(`INSERT INTO lms_assignments (kind, title, description, instructions, course_id, owner_id, starts_at, due_at, late_until, max_score, submission_mode, allowed_types_json, max_file_bytes, max_files, max_attempts, allow_edit, allow_late, video_provider, video_ref, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.kind, f.title, f.description, f.instructions, f.courseId, user.id, f.startsAt, f.dueAt, f.lateUntil, f.maxScore, f.submissionMode, f.allowedTypes, f.maxFileBytes, f.maxFiles, f.maxAttempts, f.allowEdit, f.allowLate, f.videoProvider, f.videoRef, now, now).lastInsertRowid);
    audit(db, user, 'إنشاء اختبار أو تكليف', f.title, ip);
    return newId;
  });
  return detail(db, id);
}

function updateAssignment({ db }, user, id, b, ip) {
  const a = owned(db, user, id);
  if (a.status === 'closed') throw new HttpError(409, 'هذا الاختبار مغلق فلا يُعدَّل.', 'assignment_closed');
  const f = readFields(db, user, b, a);
  const top = db.prepare('SELECT MAX(score) AS m FROM lms_assignment_submissions WHERE assignment_id = ?').get(a.id)?.m;
  if (top !== null && top !== undefined && f.maxScore < top) throw bad(`لا يمكن أن تقل الدرجة الكاملة عن أعلى درجة مرصودة (${top}).`, 'maxScore');
  tx(db, () => {
    db.prepare(`UPDATE lms_assignments SET kind = ?, title = ?, description = ?, instructions = ?, course_id = ?, starts_at = ?, due_at = ?, late_until = ?, max_score = ?, submission_mode = ?, allowed_types_json = ?, max_file_bytes = ?, max_files = ?, max_attempts = ?, allow_edit = ?, allow_late = ?, video_provider = ?, video_ref = ?, updated_at = ? WHERE id = ?`)
      .run(f.kind, f.title, f.description, f.instructions, f.courseId, f.startsAt, f.dueAt, f.lateUntil, f.maxScore, f.submissionMode, f.allowedTypes, f.maxFileBytes, f.maxFiles, f.maxAttempts, f.allowEdit, f.allowLate, f.videoProvider, f.videoRef, Date.now(), a.id);
    audit(db, user, 'تعديل اختبار أو تكليف', f.title, ip);
  });
  return detail(db, a.id);
}

const removeStored = async (cfg, keys) => {
  for (const k of keys) await storageOf(cfg).delete(k).catch((e) => log.warn(`lms_assignments: تعذّر حذف ${k}: ${e.message}`));
};

// النسخة مسودة مستقلة بملفاتها، وبلا جمهور ولا حلول
async function copyAssignment({ db, cfg }, user, id, ip) {
  const a = owned(db, user, id), files = filesOf(db, a.id), storage = storageOf(cfg), made = [], now = Date.now(), title = `نسخة من ${a.title}`.slice(0, 150);
  try {
    for (const f of files) made.push(await storage.copy(f.file));
    const newId = tx(db, () => {
      const nid = Number(db.prepare(`INSERT INTO lms_assignments (kind, title, description, instructions, course_id, owner_id, starts_at, due_at, late_until, max_score, submission_mode, allowed_types_json, max_file_bytes, max_files, max_attempts, allow_edit, allow_late, video_provider, video_ref, created_at, updated_at)
        SELECT kind, ?, description, instructions, course_id, ?::bigint, starts_at, due_at, late_until, max_score, submission_mode, allowed_types_json, max_file_bytes, max_files, max_attempts, allow_edit, allow_late, video_provider, video_ref, ?::bigint, ?::bigint FROM lms_assignments WHERE id = ?`).run(title, user.id, now, now, a.id).lastInsertRowid);
      files.forEach((f, i) => db.prepare('INSERT INTO lms_assignment_files (assignment_id, filename, kind, mime, size, file, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(nid, f.filename, f.kind, f.mime, f.size, made[i], user.id, now));
      audit(db, user, 'نسخ اختبار أو تكليف', title, ip);
      return nid;
    });
    return detail(db, newId);
  } catch (e) { await removeStored(cfg, made); throw e; }
}

async function deleteAssignment({ db, cfg }, user, id, ip) {
  const a = owned(db, user, id);
  if (db.prepare("SELECT 1 AS x FROM lms_assignment_submissions WHERE assignment_id = ? AND status <> 'draft' LIMIT 1").get(a.id)) throw new HttpError(409, 'وصلت حلول على هذا الاختبار فلا يُحذف؛ يمكنك إغلاقه.', 'assignment_has_submissions');
  const keys = [
    ...filesOf(db, a.id).map((f) => f.file),
    ...db.prepare('SELECT f.file FROM lms_assignment_submission_files f JOIN lms_assignment_submissions s ON s.id = f.submission_id WHERE s.assignment_id = ?').all(a.id).map((f) => f.file),
  ];
  tx(db, () => {
    db.prepare('DELETE FROM lms_assignments WHERE id = ?').run(a.id);
    audit(db, user, 'حذف اختبار أو تكليف', a.title, ip);
  });
  await removeStored(cfg, keys);
}

function transferAssignment({ db }, user, id, b, ip) {
  if (!user.can(TRANSFER)) throw forbidden();
  const a = db.prepare('SELECT * FROM lms_assignments WHERE id = ?').get(Number(id));
  if (!a) throw notFound();
  const target = db.prepare('SELECT m.user_id, m.name FROM faculty_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND u.active = 1').get(Number(b?.ownerId));
  if (!target) throw bad('اختر عضو هيئة له حساب فعّال.', 'ownerId');
  tx(db, () => {
    db.prepare('UPDATE lms_assignments SET owner_id = ?, updated_at = ? WHERE id = ?').run(target.user_id, Date.now(), a.id);
    audit(db, user, 'نقل ملكية اختبار أو تكليف', `${a.title} ← ${target.name}`, ip);
  });
  return { ok: true };
}

/* ---------- النشر والجمهور ---------- */
function publishAssignment(deps, user, id, ip) {
  const { db } = deps, a = owned(db, user, id), now = Date.now();
  if (a.status !== 'draft') throw new HttpError(409, 'نُشر هذا الاختبار من قبل.', 'assignment_not_draft');
  if (a.due_at <= now) throw bad('آخر موعد للتسليم قد مضى؛ عدّله قبل النشر.', 'dueAt');
  if (!db.prepare('SELECT 1 AS x FROM lms_assignment_targets WHERE assignment_id = ? LIMIT 1').get(a.id)) throw bad('حدد الجمهور المستهدف قبل النشر.', 'targets');
  const status = a.starts_at > now ? 'scheduled' : 'published';
  const delivery = tx(db, () => {
    db.prepare('UPDATE lms_assignments SET status = ?, published_at = ?, updated_at = ? WHERE id = ?').run(status, now, now, a.id);
    audit(db, user, status === 'scheduled' ? 'جدولة اختبار أو تكليف' : 'نشر اختبار أو تكليف', a.title, ip);
    return status === 'published' ? announceAssignment(db, a, now) : null;
  });
  pushTo(deps, delivery);
  return detail(db, a.id);
}

function setClosed({ db }, user, id, closed, ip) {
  const a = owned(db, user, id), now = Date.now();
  if (closed && !['published', 'scheduled'].includes(a.status)) throw new HttpError(409, 'يُغلق الاختبار المنشور فقط.', 'assignment_not_published');
  if (!closed && a.status !== 'closed') throw new HttpError(409, 'هذا الاختبار غير مغلق.', 'assignment_not_closed');
  const status = closed ? 'closed' : a.starts_at > now ? 'scheduled' : 'published';
  tx(db, () => {
    db.prepare('UPDATE lms_assignments SET status = ?, updated_at = ? WHERE id = ?').run(status, now, a.id);
    audit(db, user, closed ? 'إغلاق اختبار أو تكليف' : 'إعادة فتح اختبار أو تكليف', a.title, ip);
  });
  return detail(db, a.id);
}

// النقل والتوسيع دون إعادة إنشاء: من يدخل الجمهور يصله إشعار، ومن سبق إشعاره لا يتكرر له
function saveTargets(deps, user, id, b, ip) {
  const { db } = deps, a = owned(db, user, id);
  if (a.status === 'closed') throw new HttpError(409, 'هذا الاختبار مغلق فلا يتغير جمهوره.', 'assignment_closed');
  const delivery = tx(db, () => {
    const r = replaceTargets(db, user, a.id, b?.targets);
    audit(db, user, 'تعديل جمهور اختبار', `${a.title.slice(0, 80)}: +${r.added} / -${r.removed}`, ip);
    return a.status === 'published' ? announceAssignment(db, a) : null;
  });
  pushTo(deps, delivery);
  return detail(db, a.id);
}

function decideTarget(deps, user, targetId, b, ip) {
  const { db } = deps;
  if (!user.can(APPROVE)) throw forbidden();
  const t = db.prepare('SELECT t.*, a.title, a.status AS assignment_status, a.kind FROM lms_assignment_targets t JOIN lms_assignments a ON a.id = t.assignment_id WHERE t.id = ?').get(Number(targetId));
  if (!t) throw notFound('الطلب غير موجود.');
  if (t.approval_status !== 'pending') throw new HttpError(409, 'تم البت في هذا الطلب من قبل.', 'target_not_pending');
  const approve = b?.approve === true, now = Date.now();
  const delivery = tx(db, () => {
    db.prepare('UPDATE lms_assignment_targets SET approval_status = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(approve ? 'approved' : 'rejected', user.id, now, t.id);
    audit(db, user, approve ? 'اعتماد نشر واسع' : 'رفض نشر واسع', t.title.slice(0, 80), ip);
    return approve && t.assignment_status === 'published' ? announceAssignment(db, { id: t.assignment_id, title: t.title, kind: t.kind }, now) : null;
  });
  pushTo(deps, delivery);
  return { ok: true };
}

/* ---------- المرفقات ---------- */
function guardAttachment(db, user, id) {
  const a = owned(db, user, id);
  if (a.status === 'closed') throw new HttpError(409, 'هذا الاختبار مغلق فلا تُضاف إليه مرفقات.', 'assignment_closed');
  if (db.prepare('SELECT COUNT(*) AS c FROM lms_assignment_files WHERE assignment_id = ?').get(a.id).c >= MAX_ATTACHMENTS) throw bad(`الحد الأقصى ${MAX_ATTACHMENTS} مرفقاً للاختبار الواحد.`);
  return a;
}

async function addAttachment({ db, cfg }, user, id, upload, name, ip) {
  const a = guardAttachment(db, user, id);
  const f = await inspectUpload(upload, name, { maxBytes: LIMITS.teacherVideo });
  if (f.kind !== 'video' && f.size > LIMITS.teacherFile) throw new HttpError(413, `حجم الملف يتجاوز ${LIMITS.teacherFile / MB} ميغابايت.`, 'too_large');
  const storage = storageOf(cfg);
  let file;
  try { file = await storage.save(AREA, f.ext, upload.uploadPath); }
  catch (e) {
    if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(e.code)) throw new HttpError(507, 'تعذّر حفظ الملف على الخادم: مجلد الرفع غير صالح للكتابة أو ممتلئ.', 'upload_failed');
    throw e;
  }
  try {
    const fileId = tx(db, () => {
      const nid = Number(db.prepare('INSERT INTO lms_assignment_files (assignment_id, filename, kind, mime, size, file, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(a.id, f.filename, f.kind, f.mime, f.size, file, user.id, Date.now()).lastInsertRowid);
      audit(db, user, 'إرفاق ملف باختبار', a.title.slice(0, 80), ip);
      return nid;
    });
    return { id: fileId, kind: f.kind, filename: f.filename, size: f.size };
  } catch (e) { await removeStored(cfg, [file]); throw e; }
}

async function deleteAttachment({ db, cfg }, user, fileId, ip) {
  requireAuthor(db, user);
  const f = db.prepare('SELECT f.*, a.owner_id, a.title, a.status FROM lms_assignment_files f JOIN lms_assignments a ON a.id = f.assignment_id WHERE f.id = ?').get(Number(fileId));
  if (!f || f.owner_id !== user.id) throw notFound('المرفق غير موجود.');
  if (f.status === 'closed') throw new HttpError(409, 'هذا الاختبار مغلق فلا تُحذف مرفقاته.', 'assignment_closed');
  tx(db, () => {
    db.prepare('DELETE FROM lms_assignment_files WHERE id = ?').run(f.id);
    audit(db, user, 'حذف مرفق اختبار', f.title.slice(0, 80), ip);
  });
  await removeStored(cfg, [f.file]);
}

// الملفات لا تُخدَّم إلا من هنا، والصلاحية تُفحص في كل طلب
function readableFile(db, user, kind, id) {
  const isStudent = user.role === 'student';
  if (kind === 'attachment') {
    const f = db.prepare('SELECT f.*, a.owner_id FROM lms_assignment_files f JOIN lms_assignments a ON a.id = f.assignment_id WHERE f.id = ?').get(Number(id));
    return f && (isStudent ? assignmentForStudent(db, f.assignment_id, user.id) : f.owner_id === user.id) ? f : null;
  }
  if (kind !== 'submission') return null;
  const f = db.prepare('SELECT f.*, s.student_id, s.status AS submission_status, a.owner_id FROM lms_assignment_submission_files f JOIN lms_assignment_submissions s ON s.id = f.submission_id JOIN lms_assignments a ON a.id = s.assignment_id WHERE f.id = ?').get(Number(id));
  if (!f) return null;
  if (isStudent) return f.student_id === user.id && (f.role === 'student' || f.submission_status === 'graded') ? f : null;
  return f.owner_id === user.id && f.submission_status !== 'draft' ? f : null;
}

async function streamAssignmentFile({ db, cfg }, c) {
  const f = readableFile(db, c.user, c.params.kind, c.params.id);
  if (!f) throw notFound('الملف غير موجود.');
  const sent = await sendStored(c.req, c.res, storageOf(cfg), { file: f.file, mime: f.mime, filename: f.filename, inline: INLINE_KINDS.has(f.kind) }, SECURITY_HEADERS);
  if (!sent) throw notFound('الملف غير موجود.');
}

export function registerLmsAssignmentRoutes(r, deps) {
  const { db } = deps, BASE = '/api/lms/assignments';
  r.add('GET', BASE, (c) => c.json(200, overview(deps, c.user)));
  r.add('POST', BASE, (c) => c.json(201, { assignment: createAssignment(deps, c.user, c.body, c.ip) }), { maxBody: 128 * 1024 });
  r.add('GET', `${BASE}/files/:kind/:id`, (c) => streamAssignmentFile(deps, c));
  r.add('DELETE', `${BASE}/attachments/:id`, async (c) => { await deleteAttachment(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('GET', `${BASE}/:id`, (c) => { const a = owned(db, c.user, c.params.id); c.json(200, { assignment: detail(db, a.id) }); });
  r.add('PUT', `${BASE}/:id`, (c) => c.json(200, { assignment: updateAssignment(deps, c.user, c.params.id, c.body, c.ip) }), { maxBody: 128 * 1024 });
  r.add('DELETE', `${BASE}/:id`, async (c) => { await deleteAssignment(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', `${BASE}/:id/copy`, async (c) => c.json(201, { assignment: await copyAssignment(deps, c.user, c.params.id, c.ip) }));
  r.add('POST', `${BASE}/:id/transfer`, (c) => c.json(200, transferAssignment(deps, c.user, c.params.id, c.body, c.ip)));
  r.add('POST', `${BASE}/:id/publish`, (c) => c.json(200, { assignment: publishAssignment(deps, c.user, c.params.id, c.ip) }));
  r.add('POST', `${BASE}/:id/close`, (c) => c.json(200, { assignment: setClosed(deps, c.user, c.params.id, true, c.ip) }));
  r.add('POST', `${BASE}/:id/reopen`, (c) => c.json(200, { assignment: setClosed(deps, c.user, c.params.id, false, c.ip) }));
  r.add('GET', `${BASE}/:id/target-options`, (c) => { owned(db, c.user, c.params.id); c.json(200, targetOptions(db, c.user)); });
  r.add('PUT', `${BASE}/:id/targets`, (c) => c.json(200, { assignment: saveTargets(deps, c.user, c.params.id, c.body, c.ip) }), { maxBody: 32 * 1024 });
  r.add('POST', `${BASE}/targets/:id/decide`, (c) => c.json(200, decideTarget(deps, c.user, c.params.id, c.body, c.ip)));
  r.add('POST', `${BASE}/:id/attachments`, async (c) => c.json(201, await addAttachment(deps, c.user, c.params.id, c.body, c.query.name, c.ip)), {
    upload: true, maxBody: MAX_UPLOAD_BODY, preUpload: (c) => { guardAttachment(db, c.user, c.params.id); },
  });
}
