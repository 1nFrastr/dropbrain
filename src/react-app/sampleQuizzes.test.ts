import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRecord,
  hasCompleteAnswerKey,
  listQuizHistory,
  putQuizSession,
} from "./historyStore";
import {
  getSampleQuiz,
  isSampleQuizId,
  quizPayloadFromSample,
  SAMPLE_QUIZZES,
  seedSampleQuizzesForNewUser,
} from "./sampleQuizzes";
import type { QuizPayload } from "./api";

const memory = new Map<string, string>();

async function resetDb() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("dropbrain");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
    },
  });
  await resetDb();
});

afterEach(() => {
  memory.clear();
});

describe("sampleQuizzes", () => {
  it("catalogs three ready-to-play quizzes with complete answer keys", () => {
    expect(SAMPLE_QUIZZES).toHaveLength(3);
    expect(SAMPLE_QUIZZES.map((item) => item.id)).toEqual([
      "sample-k8s-minikube",
      "sample-k8s-expose-ip",
      "sample-frontend-interview",
    ]);

    for (const sample of SAMPLE_QUIZZES) {
      expect(isSampleQuizId(sample.id)).toBe(true);
      expect(sample.questionCount).toBeGreaterThanOrEqual(4);
      expect(sample.payload.info.markdown).toBeTruthy();
      const session = createSessionRecord(
        quizPayloadFromSample(sample),
        sample.language,
      );
      expect(hasCompleteAnswerKey(session)).toBe(true);
      expect(session.quiz.markdown).toMatch(/./);
      expect(session.quiz.answerKey).toBeUndefined();
    }
  });

  it("looks up a sample by id", () => {
    expect(getSampleQuiz("sample-k8s-minikube")?.title).toMatch(/Minikube/i);
    expect(getSampleQuiz("missing")).toBeUndefined();
  });

  it("injects samples into empty history once for a new user", async () => {
    expect(await seedSampleQuizzesForNewUser()).toBe(true);
    const list = await listQuizHistory();
    expect(list.map((item) => item.id)).toEqual([
      "sample-k8s-minikube",
      "sample-k8s-expose-ip",
      "sample-frontend-interview",
    ]);
    expect(await seedSampleQuizzesForNewUser()).toBe(false);
    expect(await listQuizHistory()).toHaveLength(3);
  });

  it("does not inject samples when the user already has history", async () => {
    const quiz: QuizPayload = {
      id: "quiz-1",
      sourceId: "src-1",
      title: "My notes",
      questions: [
        { id: "q1", stem: "One?", options: ["a", "b", "c", "d"], tags: [] },
      ],
    };
    await putQuizSession(createSessionRecord(quiz, "en"));
    expect(await seedSampleQuizzesForNewUser()).toBe(false);
    expect(await listQuizHistory()).toEqual([
      expect.objectContaining({ id: "quiz-1" }),
    ]);
  });
});
