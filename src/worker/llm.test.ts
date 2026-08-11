import { describe, expect, it } from "vitest";
import {
  extractWorkersAiSseDeltas,
  extractWorkersAiText,
  normalizeLanguage,
  sseEncode,
  UnusableMaterialError,
  validateQuestions,
} from "./llm";

function collectDeltas(text: string, carry = "") {
  const deltas: string[] = [];
  const iter = extractWorkersAiSseDeltas(text, carry);
  let next = iter.next();
  while (!next.done) {
    deltas.push(next.value);
    next = iter.next();
  }
  return { deltas, carry: next.value };
}

describe("normalizeLanguage", () => {
  it("maps chinese variants to zh", () => {
    expect(normalizeLanguage("zh")).toBe("zh");
    expect(normalizeLanguage("zh-CN")).toBe("zh");
    expect(normalizeLanguage("zh-Hans")).toBe("zh");
  });

  it("defaults to en", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
  });
});

describe("sseEncode", () => {
  it("wraps JSON as an SSE data frame", () => {
    expect(sseEncode({ delta: "hi" })).toBe('data: {"delta":"hi"}\n\n');
  });
});

describe("extractWorkersAiSseDeltas", () => {
  it("yields response deltas across chunk boundaries", () => {
    const first = collectDeltas('data: {"response":"你"}\n\ndata: {"res');
    expect(first.deltas).toEqual(["你"]);

    const second = collectDeltas('ponse":"好"}\n\ndata: [DONE]\n\n', first.carry);
    expect(second.deltas).toEqual(["好"]);
  });
});

describe("extractWorkersAiText", () => {
  it("accepts legacy string / response string shapes", () => {
    expect(extractWorkersAiText("hello")).toBe("hello");
    expect(extractWorkersAiText({ response: "hello" })).toBe("hello");
  });

  it("reads OpenAI-compatible choices[].message.content", () => {
    expect(
      extractWorkersAiText({
        choices: [{ message: { content: '{"ok":true}' } }],
        response: { ok: true },
      }),
    ).toBe('{"ok":true}');
  });

  it("stringifies auto-parsed JSON response objects", () => {
    expect(extractWorkersAiText({ response: { ok: true, n: 1 } })).toBe(
      '{"ok":true,"n":1}',
    );
  });

  it("unwraps REST { result } envelopes", () => {
    expect(
      extractWorkersAiText({
        success: true,
        result: { response: { ok: true } },
      }),
    ).toBe('{"ok":true}');
  });
});

describe("validateQuestions", () => {
  const good = {
    stem: "What is 2+2?",
    options: ["3", "4", "5", "6"],
    correctIndex: 1,
    explanation: "Basic arithmetic.",
    tags: ["math"],
  };

  it("accepts a valid payload", () => {
    const out = validateQuestions(
      { ok: true, questions: [good, good, good] },
      3,
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.correctIndex).toBe(1);
  });

  it("accepts legacy payloads without ok", () => {
    const out = validateQuestions({ questions: [good, good, good] }, 3);
    expect(out).toHaveLength(3);
  });

  it("rejects unusable material from the same LLM round", () => {
    expect(() =>
      validateQuestions(
        { ok: false, reason: "Looks like a 404 page with no article body." },
        5,
      ),
    ).toThrow(UnusableMaterialError);
    expect(() =>
      validateQuestions(
        { ok: false, reason: "Looks like a 404 page with no article body." },
        5,
      ),
    ).toThrow(/404/i);
  });

  it("rejects wrong option counts", () => {
    expect(() =>
      validateQuestions(
        {
          questions: [
            { ...good, options: ["a", "b"] },
            good,
            good,
          ],
        },
        3,
      ),
    ).toThrow(/4 string options/i);
  });

  it("rejects missing questions", () => {
    expect(() => validateQuestions({}, 5)).toThrow(/missing questions/i);
  });
});
