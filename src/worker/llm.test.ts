import { describe, expect, it } from "vitest";
import {
  coalesceSseDeltas,
  extractOpenAiSseDeltas,
  normalizeLanguage,
  parseClientQuestionChatContext,
  pullOpenAiChatSse,
  randomizeAnswerPositions,
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

  it("skips role-only frames without treating them as text", () => {
    const { deltas } = collectDeltas(
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
    );
    expect(deltas).toEqual(["Hi"]);
  });
});

describe("pullOpenAiChatSse", () => {
  it("reads finish_reason=length from a content-less chunk", () => {
    const pulled = pullOpenAiChatSse(
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      "",
    );
    expect(pulled.text).toBe("答案");
    expect(pulled.finishReason).toBe("length");
  });
});

describe("coalesceSseDeltas", () => {
  const hang = () => new Promise<void>(() => {});

  async function* chunks(...parts: string[]) {
    for (const part of parts) yield part;
  }

  it("flushes the first delta immediately, then coalesces up to maxChars", async () => {
    const out: string[] = [];
    await coalesceSseDeltas(chunks("A", "bb", "cc", "d"), (delta) => out.push(delta), {
      maxChars: 4,
      wait: hang,
    });
    expect(out).toEqual(["A", "bbcc", "d"]);
  });

  it("flushes leftover text when the wait elapses", async () => {
    const out: string[] = [];
    await coalesceSseDeltas(chunks("Hi", "a", "b"), (delta) => out.push(delta), {
      maxChars: 100,
      wait: async () => undefined,
    });
    expect(out[0]).toBe("Hi");
    expect(out.join("")).toBe("Hiab");
    expect(out.length).toBeGreaterThan(1);
  });

  it("flushes buffered text before propagating a stream error", async () => {
    const out: string[] = [];
    async function* failing() {
      yield "A";
      yield "xyz";
      throw new Error("boom");
    }
    await expect(
      coalesceSseDeltas(failing(), (delta) => out.push(delta), {
        maxChars: 100,
        wait: hang,
      }),
    ).rejects.toThrow(/boom/);
    expect(out).toEqual(["A", "xyz"]);
  });

  it("propagates truncated from the stream return value", async () => {
    async function* cutOff() {
      yield "Hi";
      return { truncated: true };
    }
    const result = await coalesceSseDeltas(cutOff(), () => {}, {
      maxChars: 100,
      wait: hang,
    });
    expect(result).toEqual({ truncated: true });
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

describe("randomizeAnswerPositions", () => {
  const question = {
    stem: "What is 2+2?",
    options: ["right", "w1", "w2", "w3"] as [string, string, string, string],
    correctIndex: 0,
    explanation: "Basic arithmetic.",
    tags: ["math"],
  };

  it("keeps the correct option text while breaking consecutive identical slots", () => {
    const out = randomizeAnswerPositions(
      [question, question, question, question, question],
      () => 0,
    );
    for (const item of out) {
      expect(item.options[item.correctIndex]).toBe("right");
    }
    for (let i = 1; i < out.length; i++) {
      expect(out[i]?.correctIndex).not.toBe(out[i - 1]?.correctIndex);
    }
  });
});

describe("parseClientQuestionChatContext", () => {
  const valid = {
    stem: "What is Minikube?",
    options: ["A cluster", "A node", "A CLI", "A pod"],
    correctIndex: 0,
    explanation: "It creates a local cluster.",
    tags: ["k8s"],
    material: "# Minikube\n\nLocal Kubernetes.",
  };

  it("accepts a complete local quiz context", () => {
    const ctx = parseClientQuestionChatContext(valid, "zh", 1);
    expect(ctx).toMatchObject({
      stem: valid.stem,
      correctIndex: 0,
      language: "zh",
      userChoice: 1,
    });
  });

  it("rejects incomplete context", () => {
    expect(parseClientQuestionChatContext({ ...valid, stem: "" }, "en")).toBeNull();
    expect(
      parseClientQuestionChatContext({ ...valid, correctIndex: 9 }, "en"),
    ).toBeNull();
    expect(parseClientQuestionChatContext(null, "en")).toBeNull();
  });
});
