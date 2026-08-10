import type { GeneratedQuestion } from "./types";

function buildPrompt(material: string, count: number): string {
  return `You are a quiz writer for active recall. Create exactly ${count} multiple-choice questions from ONLY the material below.

Rules:
- Base every question and explanation strictly on the material. Do not invent facts.
- Each question: one stem, exactly 4 options, one correct answer.
- Distractors must sound like plausible misunderstandings of the material.
- Explanation: 1–2 sentences citing what in the material supports the correct answer.
- tags: 1–3 short knowledge-point labels per question.
- correctIndex is 0-based (0..3).

Return ONLY valid JSON with this shape:
{
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
  const questions = (payload as { questions?: unknown }).questions;
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

async function callOpenAiCompatible(
  env: Env,
  prompt: string,
): Promise<string> {
  const accountId = env.CF_ACCOUNT_ID?.trim();
  const gatewayId = (env.AI_GATEWAY_ID || "default").trim();
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing");
  }
  if (!accountId) {
    throw new Error("CF_ACCOUNT_ID missing");
  }

  const base = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate rigorous active-recall quizzes. Reply with JSON only.",
        },
        { role: "user", content: prompt },
      ],
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

async function callWorkersAi(env: Env, prompt: string): Promise<string> {
  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content:
          "You generate rigorous active-recall quizzes. Reply with JSON only.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 4096,
  });

  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "response" in result) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string") return response;
  }
  throw new Error("Unexpected Workers AI response.");
}

async function generateOnce(
  env: Env,
  material: string,
  count: number,
): Promise<GeneratedQuestion[]> {
  const prompt = buildPrompt(material, count);
  let text: string;
  if (env.OPENAI_API_KEY?.trim() && env.CF_ACCOUNT_ID?.trim()) {
    text = await callOpenAiCompatible(env, prompt);
  } else {
    text = await callWorkersAi(env, prompt);
  }
  const parsed = extractJson(text);
  return validateQuestions(parsed, count);
}

export async function generateMcq(
  env: Env,
  material: string,
  count: number,
): Promise<GeneratedQuestion[]> {
  try {
    return await generateOnce(env, material, count);
  } catch (firstErr) {
    // One retry on schema / parse failure
    try {
      return await generateOnce(env, material, count);
    } catch (secondErr) {
      const a = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const b =
        secondErr instanceof Error ? secondErr.message : String(secondErr);
      throw new Error(`Quiz generation failed after retry: ${b} (first: ${a})`);
    }
  }
}
