import { describe, expect, it } from "vitest";
import {
  extractWorkersAiSseDeltas,
  normalizeLanguage,
  sseEncode,
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

describe("validateQuestions", () => {
  const good = {
    stem: "What is 2+2?",
    options: ["3", "4", "5", "6"],
    correctIndex: 1,
    explanation: "Basic arithmetic.",
    tags: ["math"],
  };

  it("accepts a valid payload", () => {
    const out = validateQuestions({ questions: [good, good, good] }, 3);
    expect(out).toHaveLength(3);
    expect(out[0]?.correctIndex).toBe(1);
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
