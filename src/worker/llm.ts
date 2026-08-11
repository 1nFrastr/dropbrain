import type { GeneratedQuestion } from "./types";
import {
  clampText,
  MAX_BODY_CHARS,
  MAX_CHAT_MATERIAL_CHARS,
  MAX_CHAT_MESSAGE_CHARS,
} from "../shared/limits";
import { assertUsableSourceBody, UnusableSourceError } from "./ingest";

export type AppLanguage = "en" | "zh";

/** Thrown when the quiz model rejects the material as unusable (same LLM round). */
export class UnusableMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableMaterialError";
  }
}

export function normalizeLanguage(value: unknown): AppLanguage {
  if (value === "zh" || value === "zh-CN" || value === "zh-Hans") return "zh";
  return "en";
}

function languageInstruction(lang: AppLanguage): string {
  return lang === "zh"
    ? "Write every stem, option, explanation, and tag in Simplified Chinese."
    : "Write every stem, option, explanation, and tag in English.";
}

function chatLanguageInstruction(lang: AppLanguage): string {
  return lang === "zh"
    ? "Always reply in Simplified Chinese, even if the source material is in another language."
    : "Always reply in English, even if the source material is in another language.";
}

function buildPrompt(
  material: string,
  count: number,
  lang: AppLanguage,
): string {
  return `You are a quiz writer for active recall.

Step 1 — Material check (do this first, still in this same response):
Decide whether MATERIAL is usable study content for quiz generation.
Mark it UNUSABLE if it is primarily any of:
- an error / 404 / empty / "page not found" page
- a login wall, paywall teaser, captcha, or bot-check page
- mostly navigation chrome, menus, cookie banners, or boilerplate with little article body
- too thin or fragmented to support meaningful active-recall questions

If UNUSABLE, return ONLY:
{
  "ok": false,
  "reason": "short explanation of what is wrong with the material"
}

Step 2 — Only if usable: create exactly ${count} multiple-choice questions from ONLY the material below.

Rules:
- Base every question and explanation strictly on the material. Do not invent facts.
- Each question: one stem, exactly 4 options, one correct answer.
- Distractors must sound like plausible misunderstandings of the material.
- Explanation: 1–2 sentences citing what in the material supports the correct answer.
- tags: 1–3 short knowledge-point labels per question.
- correctIndex is 0-based (0..3).
- ${languageInstruction(lang)}

If usable, return ONLY valid JSON with this shape:
{
  "ok": true,
  "questions": [
    {
      "stem": "string",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": "string",
      "tags": ["topic"]
    }
  ]
}

MATERIAL:
---
${material}
---`;
}

function isStringArray(value: unknown, length?: number): value is string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    return false;
  }
  if (length !== undefined && value.length !== length) return false;
  return true;
}

export function validateQuestions(
  payload: unknown,
  expectedCount: number,
): GeneratedQuestion[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("LLM response is not an object.");
  }
  const obj = payload as {
    ok?: unknown;
    reason?: unknown;
    questions?: unknown;
  };

  // Same LLM round may refuse unusable material instead of inventing a quiz.
  if (obj.ok === false) {
    const reason =
      typeof obj.reason === "string" && obj.reason.trim()
        ? obj.reason.trim()
        : "Material is not usable for quiz generation.";
    throw new UnusableMaterialError(reason);
  }

  const questions = obj.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("LLM response missing questions array.");
  }
  if (questions.length < Math.min(3, expectedCount)) {
    throw new Error(`Expected around ${expectedCount} questions, got ${questions.length}.`);
  }

  const validated: GeneratedQuestion[] = [];
  for (const q of questions.slice(0, expectedCount)) {
    if (!q || typeof q !== "object") {
      throw new Error("Invalid question object.");
    }
    const row = q as Record<string, unknown>;
    if (typeof row.stem !== "string" || !row.stem.trim()) {
      throw new Error("Question missing stem.");
    }
    if (!isStringArray(row.options, 4)) {
      throw new Error("Question must have exactly 4 string options.");
    }
    if (
      typeof row.correctIndex !== "number" ||
      !Number.isInteger(row.correctIndex) ||
      row.correctIndex < 0 ||
      row.correctIndex > 3
    ) {
      throw new Error("correctIndex must be an integer 0..3.");
    }
    if (typeof row.explanation !== "string" || !row.explanation.trim()) {
      throw new Error("Question missing explanation.");
    }
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];

    validated.push({
      stem: row.stem.trim(),
      options: row.options.map((o) => o.trim()) as [
        string,
        string,
        string,
        string,
      ],
      correctIndex: row.correctIndex,
      explanation: row.explanation.trim(),
      tags: tags.slice(0, 3),
    });
  }
  return validated;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Could not parse JSON from LLM response.");
  }
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function useOpenAi(env: Env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim() && env.CF_ACCOUNT_ID?.trim());
}

async function callOpenAiCompatible(
  env: Env,
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number },
): Promise<string> {
  const accountId = env.CF_ACCOUNT_ID!.trim();
  const gatewayId = (env.AI_GATEWAY_ID || "default").trim();
  const apiKey = env.OPENAI_API_KEY!.trim();

  const base = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: options?.temperature ?? 0.4,
      ...(options?.json ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI Gateway error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty completion from AI Gateway.");
  }
  return content;
}

async function* streamOpenAiCompatible(
  env: Env,
  messages: ChatMessage[],
  options?: { temperature?: number },
): AsyncGenerator<string> {
  const accountId = env.CF_ACCOUNT_ID!.trim();
  const gatewayId = (env.AI_GATEWAY_ID || "default").trim();
  const apiKey = env.OPENAI_API_KEY!.trim();

  const base = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: options?.temperature ?? 0.5,
      stream: true,
      messages,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`AI Gateway error ${res.status}: ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* skip malformed chunk */
      }
    }
  }
}

async function callWorkersAi(
  env: Env,
  messages: ChatMessage[],
): Promise<string> {
  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages,
    max_tokens: 4096,
  });

  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "response" in result) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string") return response;
  }
  throw new Error("Unexpected Workers AI response.");
}

/** Parse Workers AI SSE chunks: `data: {"response":"..."}\n\n` / `data: [DONE]`. */
export function* extractWorkersAiSseDeltas(
  chunkText: string,
  carry = "",
): Generator<string, string> {
  const buffer = carry + chunkText;
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        response?: unknown;
        text?: unknown;
      };
      if (typeof parsed.response === "string" && parsed.response) {
        yield parsed.response;
      } else if (typeof parsed.text === "string" && parsed.text) {
        yield parsed.text;
      }
    } catch {
      /* skip malformed */
    }
  }

  return rest;
}

async function* streamReadableSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let carry = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const iter = extractWorkersAiSseDeltas(text, carry);
      let next = iter.next();
      while (!next.done) {
        yield next.value;
        next = iter.next();
      }
      carry = next.value;
    }
    if (carry.trim()) {
      const iter = extractWorkersAiSseDeltas("\n", carry);
      let next = iter.next();
      while (!next.done) {
        yield next.value;
        next = iter.next();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReadableStream<Uint8Array>).getReader === "function"
  );
}

async function* streamWorkersAi(
  env: Env,
  messages: ChatMessage[],
): AsyncGenerator<string> {
  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages,
    max_tokens: 4096,
    stream: true,
  });

  if (isReadableStream(result)) {
    let produced = false;
    for await (const delta of streamReadableSse(result)) {
      produced = true;
      yield delta;
    }
    if (produced) return;
  } else if (
    result &&
    typeof result === "object" &&
    Symbol.asyncIterator in result
  ) {
    let produced = false;
    for await (const chunk of result as AsyncIterable<unknown>) {
      if (typeof chunk === "string" && chunk) {
        produced = true;
        yield chunk;
        continue;
      }
      if (chunk && typeof chunk === "object") {
        const row = chunk as { response?: unknown; text?: unknown };
        if (typeof row.response === "string" && row.response) {
          produced = true;
          yield row.response;
        } else if (typeof row.text === "string" && row.text) {
          produced = true;
          yield row.text;
        }
      }
    }
    if (produced) return;
  }

  // Fallback: non-streamed response chunked for UI feel
  const full = await callWorkersAi(env, messages);
  if (!full) {
    throw new Error("Empty completion from Workers AI.");
  }
  const size = 24;
  for (let i = 0; i < full.length; i += size) {
    yield full.slice(i, i + size);
  }
}

async function completeChat(
  env: Env,
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number },
): Promise<string> {
  if (useOpenAi(env)) {
    return callOpenAiCompatible(env, messages, options);
  }
  return callWorkersAi(env, messages);
}

async function* streamChat(
  env: Env,
  messages: ChatMessage[],
  options?: { temperature?: number },
): AsyncGenerator<string> {
  if (useOpenAi(env)) {
    yield* streamOpenAiCompatible(env, messages, options);
    return;
  }
  yield* streamWorkersAi(env, messages);
}

async function generateOnce(
  env: Env,
  material: string,
  count: number,
  lang: AppLanguage,
): Promise<GeneratedQuestion[]> {
  const { text: limitedMaterial } = clampText(material, MAX_BODY_CHARS);
  const prompt = buildPrompt(limitedMaterial, count, lang);
  const text = await completeChat(
    env,
    [
      {
        role: "system",
        content:
          "You generate rigorous active-recall quizzes. First assess whether the material is usable study content; if not, return {\"ok\":false,\"reason\":\"...\"}. Otherwise return {\"ok\":true,\"questions\":[...]}. Reply with JSON only.",
      },
      { role: "user", content: prompt },
    ],
    { json: true, temperature: 0.4 },
  );
  const parsed = extractJson(text);
  return validateQuestions(parsed, count);
}

const LETTERS = ["A", "B", "C", "D"] as const;

export type QuestionChatContext = {
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  tags: string[];
  material: string;
  userChoice?: number;
  language: AppLanguage;
};

function buildQuestionChatSystem(ctx: QuestionChatContext): string {
  const optionsBlock = ctx.options
    .map((opt, i) => `${LETTERS[i] ?? i}. ${opt}`)
    .join("\n");
  const correctLetter = LETTERS[ctx.correctIndex] ?? String(ctx.correctIndex);
  const choiceLine =
    ctx.userChoice !== undefined && ctx.userChoice >= 0
      ? `Learner's answer: ${LETTERS[ctx.userChoice] ?? ctx.userChoice}. ${ctx.options[ctx.userChoice] ?? ""}`
      : "Learner's answer: unknown";

  const { text: material } = clampText(
    ctx.material,
    MAX_CHAT_MATERIAL_CHARS,
  );

  return `You are a patient study coach helping a learner dig deeper into one quiz question.

Rules:
- Ground every answer in the source material and the question context below.
- Do not invent facts that are not supported by the material.
- Be concise (usually 2–5 short paragraphs or bullet points). Prefer Markdown (bold, lists, short headings) when it helps clarity.
- If the learner was wrong, briefly clarify the misconception, then deepen understanding.
- You may suggest one follow-up reflection question when helpful.
- ${chatLanguageInstruction(ctx.language)}

QUESTION:
${ctx.stem}

OPTIONS:
${optionsBlock}

Correct answer: ${correctLetter}. ${ctx.options[ctx.correctIndex] ?? ""}
Explanation: ${ctx.explanation}
Tags: ${ctx.tags.join(", ") || "none"}
${choiceLine}

SOURCE MATERIAL:
---
${material}
---`;
}

function prepareChatHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const trimmed = history
    .filter((m) => m.content.trim().length > 0)
    .slice(-12)
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, MAX_CHAT_MESSAGE_CHARS),
    }));

  if (trimmed.length === 0) {
    throw new Error("At least one user message is required.");
  }
  if (trimmed[trimmed.length - 1]?.role !== "user") {
    throw new Error("Last message must be from the user.");
  }
  return trimmed;
}

export async function chatAboutQuestion(
  env: Env,
  ctx: QuestionChatContext,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const trimmed = prepareChatHistory(history);
  return completeChat(
    env,
    [{ role: "system", content: buildQuestionChatSystem(ctx) }, ...trimmed],
    { temperature: 0.5 },
  );
}

export async function* streamChatAboutQuestion(
  env: Env,
  ctx: QuestionChatContext,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): AsyncGenerator<string> {
  const trimmed = prepareChatHistory(history);
  yield* streamChat(
    env,
    [{ role: "system", content: buildQuestionChatSystem(ctx) }, ...trimmed],
    { temperature: 0.5 },
  );
}

function buildAskAnythingSystem(language: AppLanguage): string {
  return `You are a friendly, practical study coach in Dropbrain.

Rules:
- Help the learner explore any topic: explain concepts, compare ideas, quiz them lightly, or suggest how to remember things.
- Be concise (usually 2–5 short paragraphs or bullet points). Prefer Markdown (bold, lists, short headings, fenced code) when it helps clarity.
- If you are unsure, say so briefly instead of inventing facts.
- You may ask one short clarifying or follow-up question when it would help.
- ${chatLanguageInstruction(language)}`;
}

export async function* streamAskAnything(
  env: Env,
  language: AppLanguage,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): AsyncGenerator<string> {
  const trimmed = prepareChatHistory(history);
  yield* streamChat(
    env,
    [
      { role: "system", content: buildAskAnythingSystem(language) },
      ...trimmed,
    ],
    { temperature: 0.6 },
  );
}

function isNonRetryableMcqError(err: unknown): boolean {
  return (
    err instanceof UnusableMaterialError || err instanceof UnusableSourceError
  );
}

export async function generateMcq(
  env: Env,
  material: string,
  count: number,
  lang: AppLanguage = "en",
): Promise<GeneratedQuestion[]> {
  // Defense in depth for cached / pasted sources that skipped the fetch gate.
  assertUsableSourceBody(material);

  try {
    return await generateOnce(env, material, count, lang);
  } catch (firstErr) {
    if (isNonRetryableMcqError(firstErr)) throw firstErr;
    // One retry on schema / parse failure
    try {
      return await generateOnce(env, material, count, lang);
    } catch (secondErr) {
      if (isNonRetryableMcqError(secondErr)) throw secondErr;
      const a = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const b =
        secondErr instanceof Error ? secondErr.message : String(secondErr);
      throw new Error(`Quiz generation failed after retry: ${b} (first: ${a})`);
    }
  }
}

export function sseEncode(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
