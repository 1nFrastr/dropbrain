import type { QuizPayload } from "./api";
import type { QuizExportPayload } from "./exportQuiz";
import {
  createSessionRecord,
  listQuizHistory,
  putQuizSession,
} from "./historyStore";
import type { AppLanguage } from "./i18n";
import exposeJson from "./samples/k8s-expose-external-ip.json";
import minikubeJson from "./samples/k8s-minikube.json";
import interviewJson from "./samples/frontend-interview.json";

export const SAMPLE_QUIZ_PREFIX = "sample-";
const SEEDED_KEY = "dropbrain_samples_seeded";

export function isSampleQuizId(id: string): boolean {
  return id.startsWith(SAMPLE_QUIZ_PREFIX);
}

export type SampleQuiz = {
  id: string;
  title: string;
  language: AppLanguage;
  questionCount: number;
  payload: QuizExportPayload;
};

function asExport(raw: unknown): QuizExportPayload {
  const data = raw as QuizExportPayload;
  if (!data?.info?.title || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error("Invalid sample quiz payload");
  }
  return data;
}

function catalogEntry(id: string, payload: QuizExportPayload): SampleQuiz {
  return {
    id,
    title: payload.info.title.replace(/\s*\|\s*Kubernetes\s*$/, ""),
    language: payload.info.language,
    questionCount: payload.questions.length,
    payload,
  };
}

export const SAMPLE_QUIZZES: SampleQuiz[] = [
  catalogEntry("sample-k8s-minikube", asExport(minikubeJson)),
  catalogEntry("sample-k8s-expose-ip", asExport(exposeJson)),
  catalogEntry("sample-frontend-interview", asExport(interviewJson)),
];

export function getSampleQuiz(id: string): SampleQuiz | undefined {
  return SAMPLE_QUIZZES.find((item) => item.id === id);
}

export function quizPayloadFromSample(sample: SampleQuiz): QuizPayload {
  const { payload, id } = sample;
  return {
    id,
    sourceId: `${SAMPLE_QUIZ_PREFIX}source-${id.slice(SAMPLE_QUIZ_PREFIX.length)}`,
    title: payload.info.title,
    sourceUrl: payload.info.sourceUrl,
    markdown: payload.info.markdown ?? undefined,
    truncated: payload.info.truncated,
    createdAt: payload.info.createdAt,
    questions: payload.questions.map((q) => ({
      id: q.id,
      stem: q.stem,
      options: q.options,
      tags: q.tags,
    })),
    answerKey: payload.questions.flatMap((q) => {
      if (q.correctIndex == null || q.explanation == null) return [];
      return [
        {
          questionId: q.id,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          tags: q.tags,
        },
      ];
    }),
  };
}

function loadSamplesSeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSamplesSeeded() {
  try {
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * First visit with an empty history gets the bundled sample quizzes.
 * Existing users, and users who already received samples, are left alone.
 */
export async function seedSampleQuizzesForNewUser(): Promise<boolean> {
  if (loadSamplesSeeded()) return false;
  const existing = await listQuizHistory();
  if (existing.length > 0) {
    saveSamplesSeeded();
    return false;
  }
  const base = Date.now();
  for (let i = 0; i < SAMPLE_QUIZZES.length; i++) {
    const sample = SAMPLE_QUIZZES[i]!;
    const at = base - i;
    await putQuizSession(
      createSessionRecord(quizPayloadFromSample(sample), sample.language, at),
      at,
    );
  }
  saveSamplesSeeded();
  return true;
}
