import { getOrCreateSessionId } from "./session";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionId = getOrCreateSessionId();
  const headers = new Headers(init?.headers);
  headers.set("X-Session-Id", sessionId);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export interface CreateSourceResponse {
  sourceId: string;
  title: string;
  truncated: boolean;
}

export interface CreateQuizResponse {
  quizId: string;
  sourceId: string;
  title: string;
  count: number;
}

export interface QuizQuestion {
  id: string;
  stem: string;
  options: string[];
  tags: string[];
}

export interface QuizPayload {
  id: string;
  sourceId: string;
  title: string;
  questions: QuizQuestion[];
}

export interface GradedResult {
  questionId: string;
  choice: number;
  correct: boolean;
  correctIndex: number;
  stem: string;
  options: string[];
  explanation: string;
  tags: string[];
}

export interface SubmitResponse {
  attemptId: string;
  score: number;
  correct: number;
  total: number;
  weakTags: Array<{ tag: string; misses: number }>;
  results: GradedResult[];
}

export function createTextSource(content: string) {
  return api<CreateSourceResponse>("/api/sources", {
    method: "POST",
    body: JSON.stringify({ type: "text", content }),
  });
}

export function createUrlSource(url: string) {
  return api<CreateSourceResponse>("/api/sources", {
    method: "POST",
    body: JSON.stringify({ type: "url", url }),
  });
}

export function createQuiz(sourceId: string, count: number) {
  return api<CreateQuizResponse>("/api/quizzes", {
    method: "POST",
    body: JSON.stringify({ sourceId, count }),
  });
}

export function getQuiz(id: string) {
  return api<QuizPayload>(`/api/quizzes/${id}`);
}

export interface CheckResponse {
  questionId: string;
  choice: number;
  correct: boolean;
  correctIndex: number;
  explanation: string;
  tags: string[];
}

export function checkAnswer(
  id: string,
  questionId: string,
  choice: number,
) {
  return api<CheckResponse>(`/api/quizzes/${id}/check`, {
    method: "POST",
    body: JSON.stringify({ questionId, choice }),
  });
}

export function submitQuiz(
  id: string,
  answers: Array<{ questionId: string; choice: number }>,
) {
  return api<SubmitResponse>(`/api/quizzes/${id}/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}
