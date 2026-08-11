import { checkChoice, gradeAnswers, type GradeQuestion } from "../shared/grade";
import type { AnswerKeyItem, QuizSessionRecord } from "./historyStore";
import type { CheckResponse, SubmitResponse } from "./api";

export function toGradeQuestion(
  question: {
    id: string;
    stem: string;
    options: string[];
    tags: string[];
  },
  key: AnswerKeyItem,
): GradeQuestion {
  return {
    id: question.id,
    stem: question.stem,
    options: question.options,
    correctIndex: key.correctIndex,
    explanation: key.explanation,
    tags: key.tags.length ? key.tags : question.tags,
  };
}

export function gradeQuestionsFromSession(
  session: QuizSessionRecord,
): GradeQuestion[] | null {
  const graded: GradeQuestion[] = [];
  for (const q of session.quiz.questions) {
    const key = session.answerKey[q.id];
    if (!key) return null;
    graded.push(toGradeQuestion(q, key));
  }
  return graded;
}

export function checkAnswerLocally(
  session: QuizSessionRecord,
  questionId: string,
  choice: number,
): CheckResponse | null {
  const question = session.quiz.questions.find((q) => q.id === questionId);
  const key = session.answerKey[questionId];
  if (!question || !key) return null;
  return checkChoice(toGradeQuestion(question, key), choice);
}

export function submitQuizLocally(
  session: QuizSessionRecord,
  answers: Array<{ questionId: string; choice: number }>,
  attemptId = crypto.randomUUID(),
): SubmitResponse | null {
  const questions = gradeQuestionsFromSession(session);
  if (!questions) return null;
  const { graded, correct, total, score, weakTags } = gradeAnswers(
    questions,
    answers,
  );
  return {
    attemptId,
    score,
    correct,
    total,
    weakTags,
    results: graded,
  };
}
