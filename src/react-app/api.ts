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
  const raw = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(raw) as T & { error?: string };
  } catch {
    const snippet = raw.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      res.ok
        ? `Server returned non-JSON for ${path}${snippet ? `: ${snippet}` : ""}`
        : `Request failed (${res.status}) with non-JSON body${snippet ? `: ${snippet}` : ""}`,
    );
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export interface CreateSourceResponse {
  sourceId: string;
  title: string;
  /** Present for fetched URLs so the user can inspect extraction before generation. */
  markdown?: string;
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

export interface AnswerKeyEntry {
  questionId: string;
  correctIndex: number;
  explanation: string;
  tags: string[];
}

export interface QuizPayload {
  id: string;
  sourceId: string;
  title: string;
  sourceUrl?: string | null;
  markdown?: string;
  truncated?: boolean;
  createdAt?: string;
  questions: QuizQuestion[];
  /** Present after download so the client can grade without the network. */
  answerKey?: AnswerKeyEntry[];
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

export function createUrlSource(url: string, options: { useCache?: boolean } = {}) {
  return api<CreateSourceResponse>("/api/sources", {
    method: "POST",
    body: JSON.stringify({
      type: "url",
      url,
      useCache: options.useCache !== false,
    }),
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

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  truncated?: boolean;
};

async function consumeChatSse(
  res: Response,
  onDelta: (delta: string) => void,
): Promise<{ text: string; truncated: boolean }> {
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
  let truncated = false;

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
      if (event.truncated === true) truncated = true;
      if (typeof event.delta === "string" && event.delta) {
        full += event.delta;
        onDelta(event.delta);
      }
    }
  }

  return { text: full, truncated };
}

function chatHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Session-Id": getOrCreateSessionId(),
  };
}

export type QuestionChatContextPayload = {
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  tags: string[];
  material: string;
};

export async function streamChatAboutQuestion(
  quizId: string,
  questionId: string,
  messages: ChatTurn[],
  language: AppLanguage,
  choice: number | undefined,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  context?: QuestionChatContextPayload,
): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(`/api/quizzes/${quizId}/chat`, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: chatHeaders(),
    body: JSON.stringify({ questionId, messages, choice, language, context }),
  });
  return consumeChatSse(res, onDelta);
}

export async function streamAskAnything(
  messages: ChatTurn[],
  language: AppLanguage,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: chatHeaders(),
    body: JSON.stringify({ messages, language }),
  });
  return consumeChatSse(res, onDelta);
}
