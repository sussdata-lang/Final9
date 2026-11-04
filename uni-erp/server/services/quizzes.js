// الاختبارات الإلكترونية موحدة: بنك LMS (lms_quizzes) والاختبارات المؤتمتة (online_quizzes) يُعرضان ويُقدَّمان من مكان واحد.
// المعرّفان قد يتطابقان بين الجدولين، فكل اختبار يُعرَّف بمصدره مع رقمه.
import { HttpError } from '../http.js';

const TABLE = { lms: 'lms_quizzes', online: 'online_quizzes' };
const isOpen = (source, q) => (source === 'lms' ? !!q.published : q.status === 'نشط');
const parseQuestions = (q) => { try { return JSON.parse(q.questions_json || '[]'); } catch { return []; } };

export function listQuizzes(db) {
  const stats = new Map(db.prepare('SELECT source, quiz_id, COUNT(*) AS n, AVG(score) AS avg FROM online_quiz_submissions GROUP BY source, quiz_id').all()
    .map((s) => [`${s.source}:${s.quiz_id}`, s]));
  const rows = Object.entries(TABLE).flatMap(([source, table]) => db.prepare(`SELECT * FROM ${table}`).all().map((q) => {
    const st = stats.get(`${source}:${q.id}`);
    return {
      ...q, source, open: isOpen(source, q), questions: parseQuestions(q),
      attempts_count: st ? Number(st.n) : Number(q.attempts_count ?? 0),
      avg_score: st ? Math.round(Number(st.avg) * 10) / 10 : Number(q.avg_score ?? 0),
    };
  }));
  return rows.sort((a, b) => Number(b.created_at) - Number(a.created_at) || b.id - a.id);
}

// نسخة من لا يرى الإجابات
export const withoutAnswers = ({ questions_json, ...q }) => ({ ...q, questions: q.questions.map(({ ans, answer, ...x }) => x) });

export function submitQuiz(db, user, source, id, answersIn) {
  const quizId = Number(id);
  const quiz = db.prepare(`SELECT * FROM ${TABLE[source]} WHERE id = ?`).get(quizId);
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.');
  if (!user.student_no) throw new HttpError(403, 'تقديم الاختبار متاح للطلاب فقط.', 'forbidden');
  if (!isOpen(source, quiz)) throw new HttpError(409, 'هذا الاختبار غير متاح حالياً.', 'quiz_closed');
  if (db.prepare('SELECT 1 AS x FROM online_quiz_submissions WHERE source = ? AND quiz_id = ? AND student_no = ? LIMIT 1').get(source, quizId, user.student_no)) {
    throw new HttpError(409, 'قدّمت هذا الاختبار من قبل، ويُسمح بمحاولة واحدة.', 'quiz_already_submitted');
  }
  const questions = parseQuestions(quiz);
  const answers = Array.isArray(answersIn) ? answersIn : [];
  // السؤال المتروك لا يُحسب صحيحاً، ولو كان الجواب الصحيح هو الخيار الأول
  const answered = (v) => v !== null && v !== undefined && v !== '';
  const correct = questions.filter((q, i) => answered(answers[i]) && Number(answers[i]) === Number(q.ans ?? q.answer)).length;
  const score = questions.length ? Math.round((correct / questions.length) * quiz.total_marks * 10) / 10 : 0;
  db.prepare('INSERT INTO online_quiz_submissions (quiz_id, source, student_no, student_name, score, total_marks, answers_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(quizId, source, user.student_no, user.display_name, score, quiz.total_marks, JSON.stringify(answers), Date.now());
  return { ok: true, score, totalMarks: quiz.total_marks, correctCount: correct, questionsCount: questions.length };
}
