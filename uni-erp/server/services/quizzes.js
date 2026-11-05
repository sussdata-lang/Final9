// الاختبارات الإلكترونية: إعداد من شؤون الطلاب، واعتماد من عضو الهيئة، ونشر في موعده، وتصحيح آلي مع تصحيح يدوي للأسئلة النظرية.
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';

const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const bad = (m) => new HttpError(400, m, 'validation');
const parseJson = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };

// الأسئلة المنظمة هي المرجع، والاختبارات القديمة أو المستوردة بصيغة JSON تُقرأ بالشكل نفسه
export function questionsOf(db, quiz) {
  const rows = db.prepare('SELECT * FROM lms_quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quiz.id);
  if (rows.length) return rows.map((r) => ({ id: r.id, type: r.type, q: r.text, options: parseJson(r.options_json, []), correct: parseJson(r.correct_json, []), marks: Number(r.marks) }));
  const legacy = parseJson(quiz.questions_json, []);
  const each = legacy.length ? Number(quiz.total_marks) / legacy.length : 0;
  return legacy.map((x, i) => ({ id: `j${i}`, type: 'single', q: x.q, options: x.options ?? [], correct: [Number(x.ans)], marks: each }));
}

export const isOpen = (q, now = Date.now()) => q.status === 'approved' && !!q.published && (!q.publish_at || Number(q.publish_at) <= now) && (!q.close_at || now < Number(q.close_at));

export function listQuizzes(db) {
  const stats = new Map(db.prepare('SELECT quiz_id, COUNT(*) AS n, AVG(score) AS avg, SUM(needs_grading) AS pending FROM lms_quiz_submissions GROUP BY quiz_id').all().map((s) => [s.quiz_id, s]));
  return db.prepare('SELECT * FROM lms_quizzes ORDER BY created_at DESC, id DESC').all().map((q) => {
    const st = stats.get(q.id), questions = questionsOf(db, q);
    return {
      ...q, open: isOpen(q), questions,
      attempts_count: st ? Number(st.n) : Number(q.attempts_count ?? 0),
      avg_score: st ? Math.round(Number(st.avg) * 10) / 10 : Number(q.avg_score ?? 0),
      pending_grading: st ? Number(st.pending) : 0,
    };
  });
}

// نسخة من لا يرى الإجابات
export const withoutAnswers = ({ questions_json, ...q }) => ({ ...q, questions: q.questions.map(({ correct, ...x }) => x) });

function normalizeQuestions(list) {
  if (!Array.isArray(list) || !list.length) throw bad('أضف سؤالاً واحداً على الأقل.');
  return list.map((x, i) => {
    const n = i + 1, type = x?.type, text = clean(x?.q ?? x?.text, 2000), marks = Number(x?.marks);
    if (!['single', 'multi', 'essay'].includes(type)) throw bad(`السؤال ${n}: نوعه غير صالح.`);
    if (!text) throw bad(`السؤال ${n}: اكتب نص السؤال.`);
    if (!(marks > 0)) throw bad(`السؤال ${n}: حدد علامته.`);
    if (type === 'essay') return { type, text, options: [], correct: [], marks };
    const options = (Array.isArray(x.options) ? x.options : []).map((o) => clean(o, 500)).filter(Boolean);
    if (options.length < 2) throw bad(`السؤال ${n}: أضف خيارين على الأقل.`);
    const correct = [...new Set((Array.isArray(x.correct) ? x.correct : []).map(Number))].filter((k) => k >= 0 && k < options.length);
    if (!correct.length) throw bad(`السؤال ${n}: حدد الإجابة الصحيحة.`);
    if (type === 'single' && correct.length !== 1) throw bad(`السؤال ${n}: اختيار واحد يعني إجابة صحيحة واحدة.`);
    return { type, text, options, correct, marks };
  });
}

const quizFields = (b) => {
  const publish = b.publish_at ? Number(new Date(b.publish_at)) : null, close = b.close_at ? Number(new Date(b.close_at)) : null;
  if (b.publish_at && !Number.isFinite(publish)) throw bad('موعد النشر غير صالح.');
  if (b.close_at && !Number.isFinite(close)) throw bad('موعد الإغلاق غير صالح.');
  if (publish && close && close <= publish) throw bad('موعد الإغلاق يجب أن يكون بعد موعد النشر.');
  const duration = Number(b.duration_min);
  if (!(duration >= 1 && duration <= 600)) throw bad('حدد مدة الامتحان بالدقائق.');
  const code = clean(b.course_code, 30), title = clean(b.title, 150);
  if (!code) throw bad('رمز المقرر مطلوب.');
  if (!title) throw bad('عنوان الاختبار مطلوب.');
  return { code, name: clean(b.course_name, 100), title, instructor: clean(b.instructor_name, 100), faculty: clean(b.faculty_name, 120), day: clean(b.exam_day, 10) || null, publish, close, duration, instructions: clean(b.instructions, 1000) };
};

function saveQuestions(db, quizId, questions) {
  db.prepare('DELETE FROM lms_quiz_questions WHERE quiz_id = ?').run(quizId);
  questions.forEach((q, i) => db.prepare('INSERT INTO lms_quiz_questions (quiz_id, position, type, text, options_json, correct_json, marks) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(quizId, i + 1, q.type, q.text, JSON.stringify(q.options), JSON.stringify(q.correct), q.marks));
}
const total = (questions) => Math.round(questions.reduce((s, q) => s + q.marks, 0) * 100) / 100;

export function createQuiz({ db }, user, b, ip) {
  const f = quizFields(b ?? {}), questions = normalizeQuestions(b?.questions);
  const id = tx(db, () => {
    const newId = Number(db.prepare(`INSERT INTO lms_quizzes (course_code, course_name, title, instructor_name, faculty_name, exam_day, publish_at, close_at, duration_min, total_marks, instructions, questions_json, published, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, 'draft', ?, ?)`).run(f.code, f.name, f.title, f.instructor, f.faculty, f.day, f.publish, f.close, f.duration, Math.ceil(total(questions)), f.instructions, user.id, Date.now()).lastInsertRowid);
    saveQuestions(db, newId, questions);
    return newId;
  });
  audit(db, user, 'إعداد اختبار إلكتروني', f.title, ip);
  return { id, status: 'draft' };
}

export function updateQuiz({ db }, user, id, b, ip) {
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(Number(id));
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.', 'not_found');
  if (db.prepare('SELECT 1 AS x FROM lms_quiz_submissions WHERE quiz_id = ? LIMIT 1').get(quiz.id)) throw new HttpError(409, 'قدّمه طلاب، فلا يُعدَّل.', 'quiz_has_submissions');
  const f = quizFields(b ?? {}), questions = normalizeQuestions(b?.questions);
  tx(db, () => {
    // أي تعديل بعد الاعتماد يعيده مسودة، فلا يُنشر ما لم يطلع عليه المدرس
    db.prepare(`UPDATE lms_quizzes SET course_code = ?, course_name = ?, title = ?, instructor_name = ?, faculty_name = ?, exam_day = ?, publish_at = ?, close_at = ?, duration_min = ?, total_marks = ?, instructions = ?, questions_json = '[]', status = 'draft', approved_by = NULL, approved_at = NULL, rejection_note = NULL WHERE id = ?`)
      .run(f.code, f.name, f.title, f.instructor, f.faculty, f.day, f.publish, f.close, f.duration, Math.ceil(total(questions)), f.instructions, quiz.id);
    saveQuestions(db, quiz.id, questions);
  });
  audit(db, user, 'تعديل اختبار إلكتروني', f.title, ip);
  return { id: quiz.id, status: 'draft' };
}

export function deleteQuiz({ db }, user, id, ip) {
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(Number(id));
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.', 'not_found');
  if (db.prepare('SELECT 1 AS x FROM lms_quiz_submissions WHERE quiz_id = ? LIMIT 1').get(quiz.id)) throw new HttpError(409, 'قدّمه طلاب، فلا يُحذف.', 'quiz_has_submissions');
  db.prepare('DELETE FROM lms_quizzes WHERE id = ?').run(quiz.id);
  audit(db, user, 'حذف اختبار إلكتروني', quiz.title, ip);
  return { ok: true };
}

export function requestQuizApproval({ db }, user, id, ip) {
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(Number(id));
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.', 'not_found');
  if (!questionsOf(db, quiz).length) throw bad('لا أسئلة في هذا الاختبار.');
  db.prepare("UPDATE lms_quizzes SET status = 'pending', rejection_note = NULL WHERE id = ?").run(quiz.id);
  audit(db, user, 'إرسال اختبار للاعتماد', quiz.title, ip);
  return { status: 'pending' };
}

// يعتمد عضو الهيئة اختبارات مقرراته المسندة إليه، ويعتمد المدير ما سواها
export function decideQuiz({ db }, user, id, b, ip) {
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(Number(id));
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.', 'not_found');
  if (quiz.status !== 'pending') throw new HttpError(409, 'هذا الاختبار ليس بانتظار الاعتماد.', 'quiz_not_pending');
  if (user.role !== 'admin') {
    const mine = db.prepare('SELECT 1 AS x FROM courses c JOIN faculty_members m ON m.id = c.member_id WHERE c.code = ? AND m.user_id = ? LIMIT 1').get(quiz.course_code, user.id);
    if (!mine) throw new HttpError(403, 'يعتمد الاختبار مدرس المقرر نفسه.', 'forbidden');
  }
  const approve = b?.approve === true;
  if (!approve && !clean(b?.note, 300)) throw bad('اكتب سبب الإعادة.');
  db.prepare('UPDATE lms_quizzes SET status = ?, approved_by = ?, approved_at = ?, rejection_note = ? WHERE id = ?')
    .run(approve ? 'approved' : 'draft', approve ? user.display_name : null, approve ? Date.now() : null, approve ? null : clean(b.note, 300), quiz.id);
  audit(db, user, approve ? 'اعتماد اختبار إلكتروني' : 'إعادة اختبار إلكتروني', quiz.title, ip);
  return { status: approve ? 'approved' : 'draft' };
}

const inFacultyOf = (db, user, quiz) => {
  if (!quiz.faculty_name) return true;
  return !!db.prepare('SELECT 1 AS x FROM student_profiles p JOIN programs g ON g.id = p.program_id WHERE p.user_id = ? AND g.faculty = ?').get(user.id, quiz.faculty_name);
};

// بدء المحاولة يثبّت الوقت في الخادم، فإغلاق الصفحة لا يوقف العدّ
export function startQuiz({ db }, user, id) {
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(Number(id));
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.', 'not_found');
  if (!user.student_no) throw new HttpError(403, 'تقديم الاختبار متاح للطلاب فقط.', 'forbidden');
  if (!isOpen(quiz) || !inFacultyOf(db, user, quiz)) throw new HttpError(409, 'هذا الاختبار غير متاح حالياً.', 'quiz_closed');
  if (db.prepare('SELECT 1 AS x FROM lms_quiz_submissions WHERE quiz_id = ? AND student_no = ? LIMIT 1').get(quiz.id, user.student_no)) throw new HttpError(409, 'قدّمت هذا الاختبار من قبل، ويُسمح بمحاولة واحدة.', 'quiz_already_submitted');
  db.prepare('INSERT INTO lms_quiz_attempts (quiz_id, student_no, started_at) VALUES (?, ?, ?) ON CONFLICT (quiz_id, student_no) DO NOTHING').run(quiz.id, user.student_no, Date.now());
  const started = Number(db.prepare('SELECT started_at FROM lms_quiz_attempts WHERE quiz_id = ? AND student_no = ?').get(quiz.id, user.student_no).started_at);
  return { quizId: quiz.id, title: quiz.title, durationMin: Number(quiz.duration_min), endsAt: started + Number(quiz.duration_min) * 60_000, questions: questionsOf(db, quiz).map(({ correct, ...q }) => q) };
}

const GRACE_MS = 60_000;   // انقطاع قصير عند التسليم
export function submitQuiz({ db }, user, id, answersIn) {
  const quizId = Number(id);
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(quizId);
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.');
  if (!user.student_no) throw new HttpError(403, 'تقديم الاختبار متاح للطلاب فقط.', 'forbidden');
  if (!isOpen(quiz) || !inFacultyOf(db, user, quiz)) throw new HttpError(409, 'هذا الاختبار غير متاح حالياً.', 'quiz_closed');
  if (db.prepare('SELECT 1 AS x FROM lms_quiz_submissions WHERE quiz_id = ? AND student_no = ? LIMIT 1').get(quizId, user.student_no)) {
    throw new HttpError(409, 'قدّمت هذا الاختبار من قبل، ويُسمح بمحاولة واحدة.', 'quiz_already_submitted');
  }
  const attempt = db.prepare('SELECT started_at FROM lms_quiz_attempts WHERE quiz_id = ? AND student_no = ?').get(quizId, user.student_no);
  if (attempt && Date.now() > Number(attempt.started_at) + Number(quiz.duration_min) * 60_000 + GRACE_MS) throw new HttpError(409, 'انتهى وقت الامتحان.', 'quiz_time_over');
  const questions = questionsOf(db, quiz);
  const answers = Array.isArray(answersIn) ? answersIn : [];
  let score = 0, correctCount = 0, essays = 0;
  const totalMarks = total(questions);
  questions.forEach((q, i) => {
    const a = answers[i];
    if (q.type === 'essay') { essays++; return; }
    // السؤال المتروك لا يُحسب صحيحاً، ولو كان الجواب الصحيح هو الخيار الأول
    const picked = a === null || a === undefined || a === '' ? [] : (Array.isArray(a) ? a : [a]).map(Number);
    const right = picked.length === q.correct.length && q.correct.every((k) => picked.includes(k));
    if (right) { score += q.marks; correctCount++; }
  });
  score = Math.round(score * 100) / 100;
  db.prepare('INSERT INTO lms_quiz_submissions (quiz_id, student_no, student_name, score, total_marks, answers_json, needs_grading, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(quizId, user.student_no, user.display_name, score, totalMarks, JSON.stringify(answers), essays ? 1 : 0, Date.now());
  return { ok: true, score, totalMarks, correctCount, questionsCount: questions.length, pendingEssays: essays };
}

export function listSubmissions({ db }, id) {
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(Number(id));
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.', 'not_found');
  return { questions: questionsOf(db, quiz), submissions: db.prepare('SELECT * FROM lms_quiz_submissions WHERE quiz_id = ? ORDER BY submitted_at DESC').all(quiz.id).map((s) => ({ ...s, answers: parseJson(s.answers_json, []), essayMarks: parseJson(s.essay_marks_json, {}) })) };
}

// تصحيح الأسئلة النظرية: العلامة الكلية = الآلي + النظري
export function gradeSubmission({ db }, user, sid, b, ip) {
  const s = db.prepare('SELECT * FROM lms_quiz_submissions WHERE id = ?').get(Number(sid));
  if (!s) throw new HttpError(404, 'التسليم غير موجود.', 'not_found');
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(s.quiz_id), questions = questionsOf(db, quiz);
  const essays = questions.filter((q) => q.type === 'essay'), marks = {};
  for (const q of essays) {
    const m = Number(b?.marks?.[q.id]);
    if (!(m >= 0) || m > q.marks) throw bad(`علامة السؤال غير صالحة (الحد الأعلى ${q.marks}).`);
    marks[q.id] = m;
  }
  const answers = parseJson(s.answers_json, []);
  let auto = 0;
  questions.forEach((q, i) => {
    if (q.type === 'essay') return;
    const a = answers[i], picked = a === null || a === undefined || a === '' ? [] : (Array.isArray(a) ? a : [a]).map(Number);
    if (picked.length === q.correct.length && q.correct.every((k) => picked.includes(k))) auto += q.marks;
  });
  const score = Math.round((auto + Object.values(marks).reduce((x, y) => x + y, 0)) * 100) / 100;
  db.prepare('UPDATE lms_quiz_submissions SET score = ?, essay_marks_json = ?, needs_grading = 0, graded_by = ? WHERE id = ?').run(score, JSON.stringify(marks), user.display_name, s.id);
  audit(db, user, 'تصحيح اختبار إلكتروني', `${quiz.title} / ${s.student_no}`, ip);
  return { score };
}
