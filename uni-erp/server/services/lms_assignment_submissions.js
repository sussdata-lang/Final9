// تسليم الطلاب واستقبال الحلول وتقييمها. كل قرار يخص الموعد أو الاستهداف أو الملكية يُتخذ هنا في الخادم.
import { bad, text } from '../validate.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError, SECURITY_HEADERS, sendRaw } from '../http.js';
import { log } from '../lib/logger.js';
import { pipeZip } from '../lib/zipstream.js';
import { storageOf, LMS_ASSIGNMENTS_AREA as AREA } from '../lib/storage.js';
import { withLock } from './numbering.js';
import { inspectUpload, cleanFilename, ASSIGNMENT_LIMITS as LIMITS, STUDENT_DEFAULT_KINDS } from './lms_assignment_files.js';
import { AUDIENCE_SQL, audienceCount, listForStudent, assignmentForStudent } from './lms_assignment_audience.js';
import { owned, view } from './lms_assignments.js';
import { notifyNewSubmission, notifyGraded, pushTo } from './lms_assignment_notify.js';

const GRACE_MS = 60_000, MAX_TEXT = 20000, MAX_FEEDBACK_FILES = 3, MAX_ZIP_RUNNING = 2, PAGE_MAX = 100;
const conflict = (m, code) => new HttpError(409, m, code);
const notFound = (m = 'الاختبار غير موجود.') => new HttpError(404, m, 'not_found');
const parseTypes = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const removeStored = async (cfg, keys) => { for (const k of keys) await storageOf(cfg).delete(k).catch((e) => log.warn(`lms_assignments: تعذّر حذف ${k}: ${e.message}`)); };

// نافذة التسليم: المهلة القصيرة تغطي انقطاعاً لحظة الإرسال، كما في الاختبارات الإلكترونية
export function windowOf(a, now = Date.now()) {
  if (a.status === 'closed') return 'closed';
  if (now < a.starts_at) return 'pending';
  if (now <= a.due_at + GRACE_MS) return 'open';
  if (a.allow_late && (a.late_until === null || now <= a.late_until + GRACE_MS)) return 'late';
  return 'ended';
}
const canDeliver = (win) => win === 'open' || win === 'late';

function studentAssignment(db, user, id) {
  if (user.role !== 'student') throw new HttpError(403, 'تسليم الحلول متاح للطلاب فقط.', 'forbidden');
  const a = assignmentForStudent(db, id, user.id);
  if (!a) throw notFound();
  return a;
}
const submissionsOf = (db, assignmentId, studentId) => db.prepare('SELECT * FROM lms_assignment_submissions WHERE assignment_id = ? AND student_id = ? ORDER BY attempt_no').all(assignmentId, studentId);

// ما يعمل عليه الطالب الآن: مسودته، أو حله المسلَّم إن كان التعديل مسموحاً قبل الموعد، أو محاولة جديدة
function workingCopy(a, rows, win) {
  if (!canDeliver(win)) return null;
  const draft = rows.find((s) => s.status === 'draft');
  if (draft) return { sub: draft, mode: 'draft' };
  const sent = rows.filter((s) => s.status !== 'draft'), last = sent.at(-1);
  if (last?.status === 'submitted' && a.allow_edit && win === 'open') return { sub: last, mode: 'edit' };
  if (sent.length < a.max_attempts) return { sub: null, mode: 'new', attemptNo: (rows.at(-1)?.attempt_no ?? 0) + 1 };
  return null;
}
function requireWorkingCopy(a, rows, win) {
  if (!canDeliver(win)) throw conflict(win === 'closed' ? 'هذا الاختبار مغلق.' : win === 'pending' ? 'لم يبدأ موعد هذا الاختبار بعد.' : 'انتهى موعد التسليم.', 'assignment_deadline');
  const w = workingCopy(a, rows, win);
  if (!w) throw conflict('استنفدت عدد مرات التسليم المسموحة.', 'no_attempts_left');
  return w;
}
function ensureSubmission(db, a, userId, w, now) {
  if (w.sub) return w.sub;
  return db.prepare('INSERT INTO lms_assignment_submissions (assignment_id, student_id, attempt_no, created_at, updated_at) VALUES (?,?,?,?,?) RETURNING *').get(a.id, userId, w.attemptNo, now, now);
}
const filesOfSubmission = (db, id, role = 'student') => db.prepare('SELECT * FROM lms_assignment_submission_files WHERE submission_id = ? AND role = ? ORDER BY id').all(id, role);
const fileRef = (f) => ({ id: f.id, filename: f.filename, kind: f.kind, size: f.size, url: `/api/lms/assignments/files/submission/${f.id}` });

function submissionView(db, s) {
  const graded = s.status === 'graded';
  return { id: s.id, attemptNo: s.attempt_no, status: s.status, isLate: !!s.is_late, submittedAt: s.submitted_at, text: s.body_text, files: filesOfSubmission(db, s.id).map(fileRef), score: graded ? s.score : null, feedback: graded ? s.feedback : '', feedbackFiles: graded ? filesOfSubmission(db, s.id, 'feedback').map(fileRef) : [], gradedAt: graded ? s.graded_at : null };
}
function stateOf(win, last) {
  if (last?.status === 'graded') return 'graded';
  if (last) return 'submitted';
  if (win === 'closed' || win === 'ended') return 'closed';
  return win === 'late' ? 'late' : 'new';
}
function publicAssignment(a, files) {
  const { ownerId, ...rest } = view(a, files);
  return rest;
}

function myAssignments({ db }, user) {
  if (user.role !== 'student') throw new HttpError(403, 'هذه القائمة للطلاب فقط.', 'forbidden');
  const now = Date.now();
  const latest = new Map(db.prepare("SELECT DISTINCT ON (assignment_id) assignment_id, status, score, is_late FROM lms_assignment_submissions WHERE student_id = ? AND status <> 'draft' ORDER BY assignment_id, attempt_no DESC").all(user.id).map((s) => [s.assignment_id, s]));
  return {
    serverNow: now,
    assignments: listForStudent(db, user.id, now).map((a) => {
      const last = latest.get(a.id), win = windowOf(a, now);
      return { ...publicAssignment(a, []), state: stateOf(win, last), score: last?.status === 'graded' ? last.score : null };
    }),
  };
}

function myAssignment({ db }, user, id) {
  const a = studentAssignment(db, user, id), now = Date.now(), win = windowOf(a, now), rows = submissionsOf(db, a.id, user.id), sent = rows.filter((s) => s.status !== 'draft');
  const w = workingCopy(a, rows, win);
  return {
    serverNow: now, window: win, state: stateOf(win, sent.at(-1)),
    assignment: publicAssignment(a, db.prepare('SELECT * FROM lms_assignment_files WHERE assignment_id = ? ORDER BY id').all(a.id)),
    attemptsUsed: sent.length, work: w ? { mode: w.mode, text: w.sub?.body_text ?? '', files: w.sub ? filesOfSubmission(db, w.sub.id).map(fileRef) : [] } : null,
    submissions: sent.map((s) => submissionView(db, s)).reverse(),
  };
}

const lockKey = (a, user) => `assignment:${a.id}:${user.id}`;
function saveDraft({ db }, user, id, b) {
  const a = studentAssignment(db, user, id);
  return withLock(db, lockKey(a, user), () => {
    const now = Date.now(), w = requireWorkingCopy(a, submissionsOf(db, a.id, user.id), windowOf(a, now));
    if (w.mode === 'edit') throw conflict('الحل مسلَّم؛ استخدم «حفظ التعديل».', 'already_submitted');
    const sub = ensureSubmission(db, a, user.id, w, now);
    db.prepare('UPDATE lms_assignment_submissions SET body_text = ?, updated_at = ? WHERE id = ?').run(text(b?.text, MAX_TEXT), now, sub.id);
    return { ok: true };
  });
}

function guardStudentUpload(db, c) {
  const a = studentAssignment(db, c.user, c.params.id), rows = submissionsOf(db, a.id, c.user.id);
  const w = requireWorkingCopy(a, rows, windowOf(a));
  if (a.submission_mode === 'text') throw bad('هذا الاختبار يقبل حلاً نصياً فقط.');
  if (w.sub && filesOfSubmission(db, w.sub.id).length >= a.max_files) throw bad(`الحد الأقصى ${a.max_files} ملفات.`);
  if (Number(c.req.headers['content-length']) > a.max_file_bytes) throw new HttpError(413, `حجم الملف يتجاوز ${Math.floor(a.max_file_bytes / 1048576)} ميغابايت.`, 'too_large');
}

async function addStudentFile({ db, cfg }, user, id, upload, name) {
  const a = studentAssignment(db, user, id);
  const f = await inspectUpload(upload, name, { allowed: parseTypes(a.allowed_types_json), maxBytes: a.max_file_bytes });
  const file = await storageOf(cfg).save(AREA, f.ext, upload.uploadPath);
  try {
    return withLock(db, lockKey(a, user), () => {
      const now = Date.now(), w = requireWorkingCopy(a, submissionsOf(db, a.id, user.id), windowOf(a, now)), sub = ensureSubmission(db, a, user.id, w, now);
      if (filesOfSubmission(db, sub.id).length >= a.max_files) throw bad(`الحد الأقصى ${a.max_files} ملفات.`);
      const fid = Number(db.prepare('INSERT INTO lms_assignment_submission_files (submission_id, role, filename, kind, mime, size, file, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(sub.id, 'student', f.filename, f.kind, f.mime, f.size, file, user.id, now).lastInsertRowid);
      db.prepare('UPDATE lms_assignment_submissions SET updated_at = ? WHERE id = ?').run(now, sub.id);
      return { id: fid, filename: f.filename, kind: f.kind, size: f.size };
    });
  } catch (e) { await removeStored(cfg, [file]); throw e; }
}

const validSolution = (a, body, fileCount) => (a.submission_mode === 'text' ? !!body : a.submission_mode === 'files' ? fileCount > 0 : !!body || fileCount > 0);

async function deleteStudentFile({ db, cfg }, user, id, fileId) {
  const a = studentAssignment(db, user, id);
  const key = withLock(db, lockKey(a, user), () => {
    const w = requireWorkingCopy(a, submissionsOf(db, a.id, user.id), windowOf(a));
    const f = w.sub && db.prepare("SELECT * FROM lms_assignment_submission_files WHERE id = ? AND submission_id = ? AND role = 'student'").get(Number(fileId), w.sub.id);
    if (!f) throw notFound('الملف غير موجود.');
    if (w.mode === 'edit' && !validSolution(a, w.sub.body_text, filesOfSubmission(db, w.sub.id).length - 1)) throw bad('لا يمكن حذف آخر ملف من حل مسلَّم؛ أضف ملفاً آخر أولاً.');
    db.prepare('DELETE FROM lms_assignment_submission_files WHERE id = ?').run(f.id);
    return f.file;
  });
  await removeStored(cfg, [key]);
}

function submitSolution(deps, user, id, b, ip) {
  const { db } = deps, a = studentAssignment(db, user, id);
  const out = withLock(db, lockKey(a, user), () => {
    const now = Date.now(), win = windowOf(a, now), w = requireWorkingCopy(a, submissionsOf(db, a.id, user.id), win), sub = ensureSubmission(db, a, user.id, w, now);
    const body = a.submission_mode === 'files' ? '' : text(b?.text, MAX_TEXT), count = filesOfSubmission(db, sub.id).length;
    if (!validSolution(a, body, count)) throw bad(a.submission_mode === 'files' ? 'أرفق ملفاً واحداً على الأقل.' : a.submission_mode === 'text' ? 'اكتب نص الحل.' : 'اكتب نص الحل أو أرفق ملفاً.');
    db.prepare("UPDATE lms_assignment_submissions SET status = 'submitted', body_text = ?, is_late = ?, submitted_at = ?, updated_at = ? WHERE id = ?").run(body, win === 'late' ? 1 : 0, now, now, sub.id);
    audit(db, user, w.mode === 'edit' ? 'تعديل حل اختبار' : 'تسليم حل اختبار', a.title.slice(0, 80), ip);
    return { submissionId: sub.id, isLate: win === 'late', edited: w.mode === 'edit', delivery: notifyNewSubmission(db, a, sub, user.display_name ?? user.label ?? user.username, now) };
  });
  pushTo(deps, out.delivery);
  return { submissionId: out.submissionId, isLate: out.isLate, edited: out.edited, submittedAt: Date.now() };
}

/* ---------- استقبال الحلول (لمالك الاختبار فقط) ---------- */
const ROSTER = `WITH aud AS (${AUDIENCE_SQL} UNION SELECT student_id FROM lms_assignment_submissions WHERE assignment_id = ? AND status <> 'draft'),
  latest AS (SELECT DISTINCT ON (student_id) * FROM lms_assignment_submissions WHERE assignment_id = ? AND status <> 'draft' ORDER BY student_id, attempt_no DESC)`;
const ROSTER_FROM = `FROM aud JOIN users u ON u.id = aud.id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN latest l ON l.student_id = u.id`;
const STATUS_FILTER = { submitted: "l.status = 'submitted'", graded: "l.status = 'graded'", late: 'l.is_late = 1', missing: 'l.id IS NULL' };
const fullName = (r) => [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ') || r.display_name;
const likeEsc = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

function rosterWhere(q) {
  const where = [], args = [], term = text(q.q, 60);
  if (term) { const l = likeEsc(term); where.push(`(u.student_no LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR sp.first_name LIKE ? ESCAPE '\\' OR sp.last_name LIKE ? ESCAPE '\\')`); args.push(l, l, l, l); }
  if (STATUS_FILTER[q.status]) where.push(STATUS_FILTER[q.status]);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function listSubmissions({ db }, user, id, q = {}) {
  const a = owned(db, user, id), base = [a.id, a.id, a.id], w = rosterWhere(q);
  const size = Math.min(Math.max(Number(q.size) || 25, 1), PAGE_MAX), page = Math.max(Number(q.page) || 1, 1);
  const total = Number(db.prepare(`${ROSTER} SELECT COUNT(*) AS c ${ROSTER_FROM} ${w.sql}`).get(...base, ...w.args).c);
  const s = db.prepare(`${ROSTER} SELECT COUNT(l.id) AS submitted, COUNT(CASE WHEN l.is_late = 1 THEN 1 END) AS late, COUNT(CASE WHEN l.status = 'graded' THEN 1 END) AS graded ${ROSTER_FROM}`).get(...base);
  const targeted = audienceCount(db, a.id), missing = Number(db.prepare(`SELECT COUNT(*) AS c FROM (${AUDIENCE_SQL}) x WHERE NOT EXISTS (SELECT 1 FROM lms_assignment_submissions s WHERE s.assignment_id = ? AND s.student_id = x.id AND s.status <> 'draft')`).get(a.id, a.id).c);
  const rows = db.prepare(`${ROSTER} SELECT u.id AS student_id, u.student_no, u.display_name, sp.first_name, sp.father_name, sp.last_name, l.id AS submission_id, l.status, l.is_late, l.submitted_at, l.attempt_no, l.score, (SELECT COUNT(*) FROM lms_assignment_submission_files f WHERE f.submission_id = l.id AND f.role = 'student') AS file_count ${ROSTER_FROM} ${w.sql} ORDER BY u.student_no NULLS LAST, u.id LIMIT ? OFFSET ?`).all(...base, ...w.args, size, (page - 1) * size);
  return {
    stats: { targeted, submitted: Number(s.submitted), late: Number(s.late), graded: Number(s.graded), missing },
    page, size, total, maxScore: a.max_score,
    rows: rows.map((r) => ({ studentId: r.student_id, studentNo: r.student_no ?? '', name: fullName(r), submissionId: r.submission_id, status: r.status ?? 'missing', isLate: !!r.is_late, submittedAt: r.submitted_at, attemptNo: r.attempt_no, score: r.score, fileCount: Number(r.file_count ?? 0) })),
  };
}

function ownedSubmission(db, user, id) {
  const s = db.prepare("SELECT s.*, a.owner_id, a.title, a.max_score, a.kind FROM lms_assignment_submissions s JOIN lms_assignments a ON a.id = s.assignment_id WHERE s.id = ? AND s.status <> 'draft'").get(Number(id));
  if (!s) throw notFound('الحل غير موجود.');
  owned(db, user, s.assignment_id);
  return s;
}

function submissionDetail({ db }, user, id) {
  const s = ownedSubmission(db, user, id), st = db.prepare('SELECT u.student_no, u.display_name, sp.first_name, sp.father_name, sp.last_name FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = ?').get(s.student_id);
  return { id: s.id, assignmentId: s.assignment_id, maxScore: s.max_score, studentNo: st.student_no ?? '', name: fullName(st), attemptNo: s.attempt_no, status: s.status, isLate: !!s.is_late, submittedAt: s.submitted_at, text: s.body_text, files: filesOfSubmission(db, s.id).map(fileRef), score: s.score, feedback: s.feedback, feedbackFiles: filesOfSubmission(db, s.id, 'feedback').map(fileRef) };
}

function gradeSubmission(deps, user, id, b, ip) {
  const { db } = deps, s = ownedSubmission(db, user, id), score = Math.round(Number(b?.score) * 100) / 100;
  if (b?.score === '' || b?.score === null || !Number.isFinite(score) || score < 0 || score > s.max_score) throw bad(`الدرجة بين 0 و${s.max_score}.`, 'score');
  const delivery = tx(db, () => {
    const now = Date.now();
    db.prepare("UPDATE lms_assignment_submissions SET status = 'graded', score = ?, feedback = ?, graded_by = ?, graded_at = ?, updated_at = ? WHERE id = ?").run(score, text(b?.feedback, 4000), user.id, now, now, s.id);
    audit(db, user, 'رصد درجة اختبار', `${s.title.slice(0, 60)}: ${score}`, ip);
    return notifyGraded(db, { id: s.assignment_id, title: s.title }, s, now);
  });
  pushTo(deps, delivery);
  return { ok: true, score };
}

function guardFeedbackUpload(db, c) {
  const s = ownedSubmission(db, c.user, c.params.id);
  if (filesOfSubmission(db, s.id, 'feedback').length >= MAX_FEEDBACK_FILES) throw bad(`الحد الأقصى ${MAX_FEEDBACK_FILES} ملفات تصحيح.`);
}
async function addFeedbackFile({ db, cfg }, user, id, upload, name, ip) {
  const s = ownedSubmission(db, user, id);
  const f = await inspectUpload(upload, name, { allowed: STUDENT_DEFAULT_KINDS, maxBytes: LIMITS.teacherFile });
  const file = await storageOf(cfg).save(AREA, f.ext, upload.uploadPath);
  try {
    return tx(db, () => {
      const fid = Number(db.prepare('INSERT INTO lms_assignment_submission_files (submission_id, role, filename, kind, mime, size, file, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(s.id, 'feedback', f.filename, f.kind, f.mime, f.size, file, user.id, Date.now()).lastInsertRowid);
      audit(db, user, 'إرفاق ملف تصحيح', s.title.slice(0, 80), ip);
      return { id: fid, filename: f.filename };
    });
  } catch (e) { await removeStored(cfg, [file]); throw e; }
}

/* ---------- التصدير ---------- */
let zipsRunning = 0;
const zipSegment = (s) => String(s ?? '').replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim().slice(0, 100) || 'طالب';

async function streamSubmissionsZip({ db, cfg }, c) {
  const a = owned(db, c.user, c.params.id), storage = storageOf(cfg);
  if (zipsRunning >= MAX_ZIP_RUNNING) throw new HttpError(429, 'يجري تجهيز أرشيفات أخرى؛ حاول بعد قليل.', 'rate_limited');
  // القائمة تُجلب مرة واحدة قبل البث، فلا توقف استعلامات القاعدة بقية الطلبات أثناءه
  const subs = db.prepare(`SELECT DISTINCT ON (s.student_id) s.id, s.student_id, s.body_text, s.attempt_no, u.student_no, u.display_name, sp.first_name, sp.father_name, sp.last_name FROM lms_assignment_submissions s JOIN users u ON u.id = s.student_id LEFT JOIN student_profiles sp ON sp.user_id = u.id WHERE s.assignment_id = ? AND s.status <> 'draft' ORDER BY s.student_id, s.attempt_no DESC`).all(a.id);
  const filesBySub = new Map();
  if (subs.length) for (const f of db.prepare("SELECT f.submission_id, f.filename, f.file FROM lms_assignment_submission_files f JOIN lms_assignment_submissions s ON s.id = f.submission_id WHERE s.assignment_id = ? AND f.role = 'student' ORDER BY f.id").all(a.id)) (filesBySub.get(f.submission_id) ?? filesBySub.set(f.submission_id, []).get(f.submission_id)).push(f);
  async function* entries() {
    for (const s of subs) {
      const folder = `${zipSegment(s.student_no || s.student_id)} - ${zipSegment(fullName(s))}`, used = new Set();
      if (s.body_text) yield { name: `${folder}/الحل النصي.txt`, open: () => [Buffer.from(s.body_text, 'utf8')] };
      for (const f of filesBySub.get(s.id) ?? []) {
        if (!(await storage.stat(f.file))) { log.warn(`lms_assignments: ملف مفقود ${f.file}`); continue; }
        let name = cleanFilename(f.filename, 'bin');
        for (let i = 2; used.has(name); i++) name = `${i}-${cleanFilename(f.filename, 'bin')}`;
        used.add(name);
        yield { name: `${folder}/${name}`, open: () => storage.read(f.file) };
      }
    }
  }
  zipsRunning++;
  c.res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`حلول ${zipSegment(a.title)}.zip`)}` });
  try {
    await pipeZip(c.res, entries());
    audit(db, c.user, 'تنزيل كل حلول اختبار', a.title.slice(0, 80), c.ip);
  } catch (e) {
    log.warn('lms_assignments zip: ' + e.message);
    c.res.destroy();
  } finally { zipsRunning--; }
}

// BOM ليقرأ Excel العربية صحيحة، والخلايا التي تبدأ برمز صيغة تُحيَّد حتى لا تُنفَّذ عند فتح الملف
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const STATUS_LABEL = { submitted: 'تم التسليم', graded: 'تم التقييم', missing: 'لم يسلّم' };

function gradesCsv({ db }, c) {
  const a = owned(db, c.user, c.params.id), tzo = Math.max(-840, Math.min(840, Number(c.query.tzo) || 0));
  const stamp = (t) => (t ? new Date(t - tzo * 60000).toISOString().slice(0, 16).replace('T', ' ') : '');
  const rows = db.prepare(`${ROSTER} SELECT u.student_no, u.display_name, sp.first_name, sp.father_name, sp.last_name, l.status, l.is_late, l.submitted_at, l.score, l.feedback ${ROSTER_FROM} ORDER BY u.student_no NULLS LAST, u.id`).all(a.id, a.id, a.id);
  const head = ['الرقم الجامعي', 'الاسم', 'الحالة', 'متأخر', 'وقت التسليم', 'الدرجة', 'الدرجة الكاملة', 'الملاحظات'];
  const lines = rows.map((r) => [r.student_no, fullName(r), STATUS_LABEL[r.status ?? 'missing'], r.is_late ? 'نعم' : '', stamp(r.submitted_at), r.score, a.max_score, r.feedback].map(csvCell).join(','));
  audit(db, c.user, 'تصدير درجات اختبار', a.title.slice(0, 80), c.ip);
  sendRaw(c.res, 200, { ...SECURITY_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`درجات ${zipSegment(a.title)}.csv`)}` }, `﻿${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`);
}

export function registerLmsSubmissionRoutes(r, deps) {
  const { db } = deps, BASE = '/api/lms/assignments';
  r.add('GET', `${BASE}/mine`, (c) => c.json(200, myAssignments(deps, c.user)));
  r.add('GET', `${BASE}/:id/submission`, (c) => c.json(200, myAssignment(deps, c.user, c.params.id)));
  r.add('PUT', `${BASE}/:id/submission`, (c) => c.json(200, saveDraft(deps, c.user, c.params.id, c.body)), { maxBody: 128 * 1024 });
  r.add('POST', `${BASE}/:id/submission/submit`, (c) => c.json(200, submitSolution(deps, c.user, c.params.id, c.body, c.ip)), { maxBody: 128 * 1024 });
  r.add('POST', `${BASE}/:id/submission/files`, async (c) => c.json(201, await addStudentFile(deps, c.user, c.params.id, c.body, c.query.name)), {
    upload: true, maxBody: LIMITS.studentFile + 1024, preUpload: (c) => guardStudentUpload(db, c),
  });
  r.add('DELETE', `${BASE}/:id/submission/files/:fid`, async (c) => { await deleteStudentFile(deps, c.user, c.params.id, c.params.fid); c.json(200, { ok: true }); });
  r.add('GET', `${BASE}/:id/submissions`, (c) => c.json(200, listSubmissions(deps, c.user, c.params.id, c.query)));
  r.add('GET', `${BASE}/:id/submissions.zip`, (c) => streamSubmissionsZip(deps, c));
  r.add('GET', `${BASE}/:id/grades.csv`, (c) => gradesCsv(deps, c));
  r.add('GET', `${BASE}/submissions/:id`, (c) => c.json(200, submissionDetail(deps, c.user, c.params.id)));
  r.add('POST', `${BASE}/submissions/:id/grade`, (c) => c.json(200, gradeSubmission(deps, c.user, c.params.id, c.body, c.ip)), { maxBody: 32 * 1024 });
  r.add('POST', `${BASE}/submissions/:id/feedback-file`, async (c) => c.json(201, await addFeedbackFile(deps, c.user, c.params.id, c.body, c.query.name, c.ip)), {
    upload: true, maxBody: LIMITS.teacherFile + 1024, preUpload: (c) => guardFeedbackUpload(db, c),
  });
}
