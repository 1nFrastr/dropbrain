import { describe, expect, it } from "vitest";
import {
  extractOpenAiSseDeltas,
  normalizeLanguage,
  sseEncode,
  UnusableMaterialError,
  validateQuestions,
} from "./llm";

function collectDeltas(text: string, carry = "") {
  const deltas: string[] = [];
  const iter = extractOpenAiSseDeltas(text, carry);
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

describe("extractOpenAiSseDeltas", () => {
  it("yields content deltas across chunk boundaries", () => {
    const first = collectDeltas(
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"cho',
    );
    expect(first.deltas).toEqual(["你"]);

    const second = collectDeltas(
      'ices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
      first.carry,
    );
    expect(second.deltas).toEqual(["好"]);
  });

  it("ignores reasoning_content so thinking tokens do not appear as chat text", () => {
    const { deltas } = collectDeltas(
      'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
    );
    expect(deltas).toEqual(["答案"]);
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
            { ...good, options: ["a", "b"] },
            { ...good, options: ["a", "b"] },
          ],
        },
        3,
      ),
    ).toThrow(/4 string options/i);
  });

  it("rejects missing questions", () => {
    expect(() => validateQuestions({}, 5)).toThrow(/missing questions/i);
  });

  it("rejects empty option strings from degenerate JSON", () => {
    const junk = {
      stem: "Kubernetes",
      options: ["", "", "", ""],
      correctIndex: 0,
      explanation: "Kubernetes",
      tags: ["Kubernetes"],
    };
    expect(() =>
      validateQuestions({ ok: true, questions: [junk, junk, junk] }, 3),
    ).toThrow(/usable questions|complete question|non-empty/i);
  });

  it("skips junk items when enough valid questions remain", () => {
    const junk = {
      stem: "Kubernetes",
      options: ["", "", "", ""],
      correctIndex: 0,
      explanation: "Kubernetes",
      tags: ["Kubernetes"],
    };
    const out = validateQuestions(
      { questions: [junk, good, junk, good, good] },
      3,
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.stem).toBe(good.stem);
  });

  it("rejects topic-title stems even when options are filled", () => {
    const title = {
      stem: "Kubernetes",
      options: ["Linux", "macOS", "Windows", "Solaris"],
      correctIndex: 0,
      explanation: "Minikube is available for Linux, macOS, and Windows.",
      tags: ["Minikube"],
    };
    expect(() =>
      validateQuestions({ questions: [title, title, title] }, 3),
    ).toThrow(/complete question/i);
  });

  it("rejects A/B/C/D placeholder option text", () => {
    expect(() =>
      validateQuestions(
        {
          questions: [
            { ...good, options: ["A", "B", "C", "D"] },
            { ...good, options: ["A", "B", "C", "D"] },
            { ...good, options: ["A", "B", "C", "D"] },
          ],
        },
        3,
      ),
    ).toThrow(/placeholder letters/i);
  });

  it("accepts short Chinese stems that are real questions", () => {
    const zh = {
      stem: "部署控制器的作用是什么",
      options: ["创建服务", "管理配置映射", "创建ReplicaSets", "调度Pod"],
      correctIndex: 2,
      explanation: "材料写明 Deployment 控制器通过创建 ReplicaSet 来管理 Pod。",
      tags: ["Deployment"],
    };
    const out = validateQuestions({ questions: [zh, zh, zh] }, 3);
    expect(out).toHaveLength(3);
  });
});
