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
- Each question: one complete interrogative stem (not a topic title like "Kubernetes"), exactly 4 options, one correct answer.
- Options must be four distinct, non-empty answer texts. Never use empty strings, never use "A"/"B"/"C"/"D" as the option text (those are labels only).
- Distractors must sound like plausible misunderstandings of the material.
- Explanation: 1–2 sentences citing what in the material supports the correct answer. Do not repeat the stem or a single keyword.
- tags: 1–3 short knowledge-point labels per question.
- correctIndex is 0-based (0..3).
- ${languageInstruction(lang)}

If usable, return ONLY valid JSON with this shape:
{
  "ok": true,
  "questions": [
    {
      "stem": "What component schedules application containers onto nodes?",
      "options": [
        "The Control Plane",
        "A container runtime such as containerd",
        "The Minikube CLI",
        "The Kubernetes dashboard"
      ],
      "correctIndex": 0,
      "explanation": "The material states the Control Plane coordinates scheduling of application containers on cluster nodes.",
      "tags": ["control-plane"]
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

const MIN_EXPLANATION_CHARS = 16;

function looksLikeQuestionStem(stem: string): boolean {
  const s = stem.trim();
  if (/[?？]/.test(s)) return true;
  if (
    /(什么|为何|为什么|哪|如何|怎样|是否|吗|Who|What|When|Where|Why|How|Which)/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/\s/.test(s) && s.length >= 12) return true;
  return s.length >= 24;
}

function isLetterPlaceholderOptions(options: string[]): boolean {
  return options.every((o) => /^[A-D][.)]?\s*$/i.test(o.trim()));
}

function parseQuestion(raw: unknown): GeneratedQuestion {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid question object.");
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.stem !== "string" || !row.stem.trim()) {
    throw new Error("Question missing stem.");
  }
  const stem = row.stem.trim();
  if (!looksLikeQuestionStem(stem)) {
    throw new Error(
      "Question stem must be a complete question, not a topic title.",
    );
  }
  if (!isStringArray(row.options, 4)) {
    throw new Error("Question must have exactly 4 string options.");
  }
  const options = row.options.map((o) => o.trim());
  if (options.some((o) => o.length === 0)) {
    throw new Error("Question options must be non-empty.");
  }
  if (new Set(options).size < 4) {
    throw new Error("Question options must be four distinct answers.");
  }
  if (isLetterPlaceholderOptions(options)) {
    throw new Error("Question options cannot be placeholder letters A–D.");
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
  const explanation = row.explanation.trim();
  if (explanation.length < MIN_EXPLANATION_CHARS) {
    throw new Error("Question explanation is too short.");
  }
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  return {
    stem,
    options: options as [string, string, string, string],
    correctIndex: row.correctIndex,
    explanation,
    tags: tags.slice(0, 3),
  };
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

  const minAcceptable = Math.min(3, expectedCount);
  const validated: GeneratedQuestion[] = [];
  let lastProblem = "";
  for (const q of questions) {
    if (validated.length >= expectedCount) break;
    try {
      validated.push(parseQuestion(q));
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err);
    }
  }
  if (validated.length < minAcceptable) {
    throw new Error(
      `Expected around ${expectedCount} usable questions, got ${validated.length}.${
        lastProblem ? ` ${lastProblem}` : ""
      }`,
    );
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

/**
 * Normalize Workers AI sync outputs.
 * Newer Llama responses use OpenAI chat.completion shape; when the model
 * emits JSON, `response` may already be a parsed object while
 * `choices[0].message.content` remains the string form.
 */
export function extractWorkersAiText(result: unknown): string {
  if (typeof result === "string") {
    if (!result) throw new Error("Empty completion from Workers AI.");
    return result;
  }

  // AI binding may return a fetch Response in some runtimes.
  if (isResponseLike(result)) {
    throw new Error(
      "Unexpected Workers AI response. got Response (use stream or await body)",
    );
  }

  if (!result || typeof result !== "object") {
    throw new Error(
      `Unexpected Workers AI response. type=${typeof result}`,
    );
  }

  // REST-style wrapper: { success, result: {...} }
  let row = result as Record<string, unknown>;
  if (
    row.result &&
    typeof row.result === "object" &&
    ("response" in (row.result as object) ||
      "choices" in (row.result as object))
  ) {
    row = row.result as Record<string, unknown>;
  }

  const choices = row.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const message = (first as { message?: { content?: unknown } }).message;
      const content = message?.content;
      if (typeof content === "string" && content) return content;
      // Some gateways put structured JSON directly in content
      if (content && typeof content === "object") {
        return JSON.stringify(content);
      }
    }
  }

  if ("response" in row) {
    const response = row.response;
    if (typeof response === "string") {
      if (!response) throw new Error("Empty completion from Workers AI.");
      return response;
    }
    // Auto-parsed JSON / structured output
    if (response && typeof response === "object") {
      return JSON.stringify(response);
    }
  }

  if (typeof row.text === "string" && row.text) {
    return row.text;
  }

  // ReadableStream / async iterable mistakenly returned for non-stream calls
  if (isReadableStream(result) || Symbol.asyncIterator in Object(result)) {
    throw new Error(
      "Unexpected Workers AI response. got stream for non-stream call",
    );
  }

  const keys = Object.keys(row).slice(0, 12).join(",");
  throw new Error(
    `Unexpected Workers AI response. type=object keys=${keys || "(none)"}`,
  );
}

function isResponseLike(value: unknown): value is Response {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Response).arrayBuffer === "function" &&
    typeof (value as Response).text === "function" &&
    typeof (value as Response).status === "number"
  );
}

async function callWorkersAi(
  env: Env,
  messages: ChatMessage[],
): Promise<string> {
  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages,
    max_tokens: 4096,
  });
  return extractWorkersAiText(result);
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

const MCQ_REPAIR_HINT =
  "The previous JSON was invalid. Each stem must be a full question sentence. Each question needs four distinct non-empty option texts (not empty strings, not the letters A/B/C/D). Explanations must be 1–2 real sentences. Skip any malformed item and still return enough complete questions.";

const MCQ_ATTEMPTS = 3;

async function generateOnce(
  env: Env,
  material: string,
  count: number,
  lang: AppLanguage,
  attempt: number,
): Promise<GeneratedQuestion[]> {
  const { text: limitedMaterial } = clampText(material, MAX_BODY_CHARS);
  const prompt = buildPrompt(limitedMaterial, count, lang);
  const userContent =
    attempt > 0 ? `${prompt}\n\nIMPORTANT: ${MCQ_REPAIR_HINT}` : prompt;
  const text = await completeChat(
    env,
    [
      {
        role: "system",
        content:
          "You generate rigorous active-recall quizzes. First assess whether the material is usable study content; if not, return {\"ok\":false,\"reason\":\"...\"}. Otherwise return {\"ok\":true,\"questions\":[...]}. Reply with JSON only.",
      },
      { role: "user", content: userContent },
    ],
    { json: true, temperature: attempt === 0 ? 0.4 : 0.6 },
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

  const problems: string[] = [];
  for (let attempt = 0; attempt < MCQ_ATTEMPTS; attempt += 1) {
    try {
      return await generateOnce(env, material, count, lang, attempt);
    } catch (err) {
      if (isNonRetryableMcqError(err)) throw err;
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(
    `Quiz generation failed after ${MCQ_ATTEMPTS} attempts: ${problems[problems.length - 1] ?? "unknown error"}`,
  );
}

export function sseEncode(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
