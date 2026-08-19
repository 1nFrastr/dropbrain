import type { AppLanguage } from "./i18n";
import type {
  AnswerKeyEntry,
  ChatTurn,
  QuizPayload,
  SubmitResponse,
} from "./api";

const DB_NAME = "dropbrain";
const DB_VERSION = 1;
const STORE = "quizSessions";

export type QuestionReveal = {
  correct: boolean;
  explanation: string;
  correctIndex: number;
};

export type AnswerKeyItem = {
  correctIndex: number;
  explanation: string;
  tags: string[];
};

export type QuizSessionRecord = {
  id: string;
  title: string;
  sourceId: string;
  language: AppLanguage;
  createdAt: number;
  updatedAt: number;
  quiz: QuizPayload;
  /** Local answer key for offline grading (stripped from quiz.questions). */
  answerKey: Record<string, AnswerKeyItem>;
  index: number;
  choices: Record<string, number>;
  reveals: Record<string, QuestionReveal>;
  chatByQuestion: Record<string, ChatTurn[]>;
  status: "in_progress" | "completed";
  submitResult: SubmitResponse | null;
};

export type QuizHistoryItem = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: "in_progress" | "completed";
  questionCount: number;
  answeredCount: number;
  score: number | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export function answeredCount(choices: Record<string, number>): number {
  return Object.keys(choices).length;
}

export function toAnswerKeyMap(
  entries: AnswerKeyEntry[] | undefined,
): Record<string, AnswerKeyItem> {
  const out: Record<string, AnswerKeyItem> = {};
  for (const entry of entries ?? []) {
    out[entry.questionId] = {
      correctIndex: entry.correctIndex,
      explanation: entry.explanation,
      tags: entry.tags,
    };
  }
  return out;
}

/** True when every question has a local answer key entry. */
export function hasCompleteAnswerKey(session: QuizSessionRecord): boolean {
  return session.quiz.questions.every((q) => session.answerKey[q.id] != null);
}

function normalizeSession(row: QuizSessionRecord): QuizSessionRecord {
  const { answerKey: _discard, ...quiz } = row.quiz;
  return {
    ...row,
    quiz,
    answerKey: row.answerKey ?? {},
  };
}

export function toHistoryItem(session: QuizSessionRecord): QuizHistoryItem {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    questionCount: session.quiz.questions.length,
    answeredCount: answeredCount(session.choices),
    score: session.submitResult?.score ?? null,
  };
}

export function createSessionRecord(
  quiz: QuizPayload,
  language: AppLanguage,
  now = Date.now(),
): QuizSessionRecord {
  const { answerKey: entries, ...publicQuiz } = quiz;
  return {
    id: quiz.id,
    title: quiz.title,
    sourceId: quiz.sourceId,
    language,
    createdAt: now,
    updatedAt: now,
    quiz: publicQuiz,
    answerKey: toAnswerKeyMap(entries),
    index: 0,
    choices: {},
    reveals: {},
    chatByQuestion: {},
    status: "in_progress",
    submitResult: null,
  };
}

export async function putQuizSession(
  session: QuizSessionRecord,
  now = Date.now(),
): Promise<QuizSessionRecord> {
  const next = normalizeSession({ ...session, updatedAt: now });
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await reqToPromise(tx.objectStore(STORE).put(next));
    return next;
  } finally {
    db.close();
  }
}

export async function getQuizSession(
  id: string,
): Promise<QuizSessionRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await reqToPromise(tx.objectStore(STORE).get(id));
    if (!row) return null;
    return normalizeSession(row as QuizSessionRecord);
  } finally {
    db.close();
  }
}

export async function listQuizHistory(): Promise<QuizHistoryItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const rows = await reqToPromise(tx.objectStore(STORE).getAll());
    const items = (rows as QuizSessionRecord[])
      .map((row) => normalizeSession(row))
      .map(toHistoryItem);
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items;
  } finally {
    db.close();
  }
}

export async function deleteQuizSession(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await reqToPromise(tx.objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

export function formatHistoryWhen(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function historyStatusLabel(item: QuizHistoryItem): string {
  if (item.status === "completed") {
    const pct =
      item.score == null ? null : `${Math.round(item.score * 100)}%`;
    return pct ? `Completed · ${pct}` : "Completed";
  }
  return `In progress · ${item.answeredCount}/${item.questionCount}`;
}
