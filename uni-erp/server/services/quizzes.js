// الاختبارات الإلكترونية: جدول واحد lms_quizzes وتسليماتها lms_quiz_submissions.
import { HttpError } from '../http.js';

const parseQuestions = (q) => { try { return JSON.parse(q.questions_json || '[]'); } catch { return []; } };

export function listQuizzes(db) {
  const stats = new Map(db.prepare('SELECT quiz_id, COUNT(*) AS n, AVG(score) AS avg FROM lms_quiz_submissions GROUP BY quiz_id').all().map((s) => [s.quiz_id, s]));
  return db.prepare('SELECT * FROM lms_quizzes ORDER BY created_at DESC, id DESC').all().map((q) => {
    const st = stats.get(q.id);
    return {
      ...q, open: !!q.published, questions: parseQuestions(q),
      attempts_count: st ? Number(st.n) : Number(q.attempts_count ?? 0),
      avg_score: st ? Math.round(Number(st.avg) * 10) / 10 : Number(q.avg_score ?? 0),
    };
  });
}

// نسخة من لا يرى الإجابات
export const withoutAnswers = ({ questions_json, ...q }) => ({ ...q, questions: q.questions.map(({ ans, ...x }) => x) });

export function submitQuiz(db, user, id, answersIn) {
  const quizId = Number(id);
  const quiz = db.prepare('SELECT * FROM lms_quizzes WHERE id = ?').get(quizId);
  if (!quiz) throw new HttpError(404, 'الاختبار غير موجود.');
  if (!user.student_no) throw new HttpError(403, 'تقديم الاختبار متاح للطلاب فقط.', 'forbidden');
  if (!quiz.published) throw new HttpError(409, 'هذا الاختبار غير متاح حالياً.', 'quiz_closed');
  if (db.prepare('SELECT 1 AS x FROM lms_quiz_submissions WHERE quiz_id = ? AND student_no = ? LIMIT 1').get(quizId, user.student_no)) {
    throw new HttpError(409, 'قدّمت هذا الاختبار من قبل، ويُسمح بمحاولة واحدة.', 'quiz_already_submitted');
  }
  const questions = parseQuestions(quiz);
  const answers = Array.isArray(answersIn) ? answersIn : [];
  // السؤال المتروك لا يُحسب صحيحاً، ولو كان الجواب الصحيح هو الخيار الأول
  const answered = (v) => v !== null && v !== undefined && v !== '';
  const correct = questions.filter((q, i) => answered(answers[i]) && Number(answers[i]) === Number(q.ans)).length;
  const score = questions.length ? Math.round((correct / questions.length) * quiz.total_marks * 10) / 10 : 0;
  db.prepare('INSERT INTO lms_quiz_submissions (quiz_id, student_no, student_name, score, total_marks, answers_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(quizId, user.student_no, user.display_name, score, quiz.total_marks, JSON.stringify(answers), Date.now());
  return { ok: true, score, totalMarks: quiz.total_marks, correctCount: correct, questionsCount: questions.length };
}
