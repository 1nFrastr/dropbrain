import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRecord,
  deleteQuizSession,
  formatHistoryWhen,
  getQuizSession,
  historyStatusLabel,
  listQuizHistory,
  putQuizSession,
  toHistoryItem,
} from "./historyStore";
import type { QuizPayload } from "./api";

const quiz: QuizPayload = {
  id: "quiz-1",
  sourceId: "src-1",
  title: "Sample notes",
  questions: [
    { id: "q1", stem: "One?", options: ["a", "b", "c", "d"], tags: [] },
    { id: "q2", stem: "Two?", options: ["a", "b", "c", "d"], tags: [] },
  ],
};

describe("historyStore", () => {
  beforeEach(async () => {
    // Reset DB between tests
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("dropbrain");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it("creates and lists sessions newest first", async () => {
    const a = createSessionRecord(quiz, "en", 1000);
    await putQuizSession(a);
    const b = createSessionRecord(
      { ...quiz, id: "quiz-2", title: "Later" },
      "zh",
      2000,
    );
    await putQuizSession({ ...b, updatedAt: 3000 });

    const list = await listQuizHistory();
    expect(list.map((x) => x.id)).toEqual(["quiz-2", "quiz-1"]);
    expect(list[0]?.title).toBe("Later");
  });

  it("round-trips progress fields", async () => {
    const base = createSessionRecord(
      {
        ...quiz,
        answerKey: [
          {
            questionId: "q1",
            correctIndex: 2,
            explanation: "Yes",
            tags: [],
          },
        ],
      },
      "zh",
    );
    const saved = await putQuizSession({
      ...base,
      index: 1,
      choices: { q1: 2 },
      reveals: {
        q1: { correct: true, explanation: "Yes", correctIndex: 2 },
      },
      chatByQuestion: {
        q1: [{ role: "user", content: "why?" }],
      },
    });

    const loaded = await getQuizSession(saved.id);
    expect(loaded?.index).toBe(1);
    expect(loaded?.choices.q1).toBe(2);
    expect(loaded?.reveals.q1?.correctIndex).toBe(2);
    expect(loaded?.chatByQuestion.q1?.[0]?.content).toBe("why?");
    expect(loaded?.language).toBe("zh");
    expect(loaded?.answerKey.q1?.correctIndex).toBe(2);
    expect(loaded?.quiz.answerKey).toBeUndefined();
  });

  it("keeps source url and preview markdown", async () => {
    const saved = await putQuizSession(
      createSessionRecord(
        {
          ...quiz,
          sourceUrl: "https://kubernetes.io/docs/cluster-intro/",
          markdown: "# Cluster intro\n\nMinikube creates a local cluster.",
          truncated: false,
        },
        "en",
      ),
    );
    const loaded = await getQuizSession(saved.id);
    expect(loaded?.quiz.sourceUrl).toBe(
      "https://kubernetes.io/docs/cluster-intro/",
    );
    expect(loaded?.quiz.markdown).toMatch(/Minikube/);
    expect(loaded?.quiz.truncated).toBe(false);
  });

  it("deletes sessions", async () => {
    await putQuizSession(createSessionRecord(quiz, "en"));
    await deleteQuizSession("quiz-1");
    expect(await getQuizSession("quiz-1")).toBeNull();
    expect(await listQuizHistory()).toEqual([]);
  });

  it("formats history labels", () => {
    const item = toHistoryItem({
      ...createSessionRecord(quiz, "en"),
      choices: { q1: 0 },
      status: "in_progress",
      submitResult: null,
    });
    expect(historyStatusLabel(item)).toBe("In progress · 1/2");
    expect(formatHistoryWhen(Date.now() - 90_000)).toMatch(/m ago/);
  });
});
