/** Shared size limits for stored source bodies and LLM prompts. */

/** Max characters stored in D1 `sources.body_md` and sent to quiz generation. */
export const MAX_BODY_CHARS = 60_000;

/** Max source-material chars embedded in per-question chat prompts. */
export const MAX_CHAT_MATERIAL_CHARS = 12_000;

/** Max characters per chat turn (user or assistant) sent to the LLM. */
export const MAX_CHAT_MESSAGE_CHARS = 4_000;

/** Max completion tokens for study chat (home + per-question). */
export const MAX_CHAT_COMPLETION_TOKENS = 2_048;

/** Max completion tokens for quiz JSON generation (up to 20 MCQs). */
export const MAX_QUIZ_COMPLETION_TOKENS = 8_192;

export const SOURCE_BODY_TRUNCATION_MARKER =
  "[Content truncated for quiz generation.]";

const SOURCE_BODY_TRUNCATION_SUFFIX = `\n\n…\n${SOURCE_BODY_TRUNCATION_MARKER}`;

/**
 * Clamp text to `maxChars` including the suffix when truncated.
 * Guarantees `result.text.length <= maxChars`.
 */
export function clampText(
  input: string,
  maxChars: number,
  suffix = "\n…[truncated]",
): { text: string; truncated: boolean } {
  if (input.length <= maxChars) {
    return { text: input, truncated: false };
  }
  const budget = Math.max(0, maxChars - suffix.length);
  return { text: input.slice(0, budget) + suffix, truncated: true };
}

export function clampSourceBody(markdown: string): {
  text: string;
  truncated: boolean;
} {
  return clampText(markdown, MAX_BODY_CHARS, SOURCE_BODY_TRUNCATION_SUFFIX);
}

export function isTruncatedSourceBody(markdown: string): boolean {
  return markdown.includes(SOURCE_BODY_TRUNCATION_MARKER);
}
