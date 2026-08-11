import { getOrCreateSessionId } from "./session";
import type { AppLanguage } from "./i18n";
import { consumeSseFrames } from "./sse";

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
  cached?: boolean;
}

export interface CreateQuizResponse {
  quizId: string;
  sourceId: string;
  title: string;
  count: number;
  language?: AppLanguage;
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

export function createQuiz(
  sourceId: string,
  count: number,
  language: AppLanguage,
) {
  return api<CreateQuizResponse>("/api/quizzes", {
    method: "POST",
    body: JSON.stringify({ sourceId, count, language }),
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

export type ChatTurn = { role: "user" | "assistant"; content: string };

async function consumeChatSse(
  res: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  if (!res.body) {
    throw new Error("Empty chat stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { rest, events } = consumeSseFrames(buffer);
    buffer = rest;

    for (const event of events) {
      if (typeof event.error === "string" && event.error) {
        throw new Error(event.error);
      }
      if (typeof event.delta === "string" && event.delta) {
        full += event.delta;
        onDelta(event.delta);
      }
    }
  }

  return full;
}

function chatHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Session-Id": getOrCreateSessionId(),
  };
}

export async function streamChatAboutQuestion(
  quizId: string,
  questionId: string,
  messages: ChatTurn[],
  language: AppLanguage,
  choice: number | undefined,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`/api/quizzes/${quizId}/chat`, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: chatHeaders(),
    body: JSON.stringify({ questionId, messages, choice, language }),
  });
  return consumeChatSse(res, onDelta);
}

export async function streamAskAnything(
  messages: ChatTurn[],
  language: AppLanguage,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: chatHeaders(),
    body: JSON.stringify({ messages, language }),
  });
  return consumeChatSse(res, onDelta);
}
