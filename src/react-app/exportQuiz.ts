import type { AppLanguage } from "./i18n";
import type { QuizSessionRecord } from "./historyStore";

export type QuizExportInfo = {
  id: string;
  title: string;
  sourceId: string;
  sourceUrl: string | null;
  markdown: string | null;
  truncated: boolean;
  questionCount: number;
  language: AppLanguage;
  createdAt: string;
};

export type QuizExportQuestion = {
  id: string;
  stem: string;
  options: string[];
  tags: string[];
  correctIndex: number | null;
  explanation: string | null;
};

export type QuizExportPayload = {
  info: QuizExportInfo;
  questions: QuizExportQuestion[];
};

function resolveAnswer(
  session: QuizSessionRecord,
  questionId: string,
): { correctIndex: number; explanation: string } | null {
  const key = session.answerKey[questionId];
  if (key) {
    return {
      correctIndex: key.correctIndex,
      explanation: key.explanation,
    };
  }
  const reveal = session.reveals[questionId];
  if (reveal) {
    return {
      correctIndex: reveal.correctIndex,
      explanation: reveal.explanation,
    };
  }
  const graded = session.submitResult?.results.find(
    (r) => r.questionId === questionId,
  );
  if (graded) {
    return {
      correctIndex: graded.correctIndex,
      explanation: graded.explanation,
    };
  }
  return null;
}

/** Build a structured export of quiz info and answer key (no user choices). */
export function buildQuizExport(session: QuizSessionRecord): QuizExportPayload {
  return {
    info: {
      id: session.id,
      title: session.title,
      sourceId: session.sourceId,
      sourceUrl: session.quiz.sourceUrl ?? null,
      markdown: session.quiz.markdown ?? null,
      truncated: session.quiz.truncated === true,
      questionCount: session.quiz.questions.length,
      language: session.language,
      createdAt: new Date(session.createdAt).toISOString(),
    },
    questions: session.quiz.questions.map((q) => {
      const answer = resolveAnswer(session, q.id);
      return {
        id: q.id,
        stem: q.stem,
        options: q.options,
        tags: q.tags,
        correctIndex: answer?.correctIndex ?? null,
        explanation: answer?.explanation ?? null,
      };
    }),
  };
}

export function stringifyQuizExport(payload: QuizExportPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function quizExportFilename(session: QuizSessionRecord, now = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 10);
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `dropbrain-${slug || "quiz"}-${stamp}.json`;
}

export function downloadTextFile(filename: string, content: string, mime = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportQuizSession(session: QuizSessionRecord): Promise<void> {
  const json = stringifyQuizExport(buildQuizExport(session));
  downloadTextFile(
    quizExportFilename(session),
    json,
    "application/json;charset=utf-8",
  );
}
