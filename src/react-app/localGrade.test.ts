import { describe, expect, it } from "vitest";
import type { QuizPayload } from "./api";
import { createSessionRecord } from "./historyStore";
import { checkAnswerLocally, submitQuizLocally } from "./localGrade";

const quiz: QuizPayload = {
  id: "quiz-1",
  sourceId: "src-1",
  title: "Sample",
  questions: [
    {
      id: "q1",
      stem: "2+2?",
      options: ["3", "4", "5", "6"],
      tags: ["math"],
    },
    {
      id: "q2",
      stem: "Capital?",
      options: ["A", "B", "Paris", "D"],
      tags: ["geo"],
    },
  ],
  answerKey: [
    {
      questionId: "q1",
      correctIndex: 1,
      explanation: "Four.",
      tags: ["math"],
    },
    {
      questionId: "q2",
      correctIndex: 2,
      explanation: "Paris.",
      tags: ["geo"],
    },
  ],
};

describe("localGrade", () => {
  it("checks answers without the network", () => {
    const session = createSessionRecord(quiz, "en");
    expect(checkAnswerLocally(session, "q1", 1)).toMatchObject({
      correct: true,
      correctIndex: 1,
    });
    expect(checkAnswerLocally(session, "q1", 0)?.correct).toBe(false);
  });

  it("submits a full attempt locally", () => {
    const session = createSessionRecord(quiz, "en");
    const result = submitQuizLocally(session, [
      { questionId: "q1", choice: 1 },
      { questionId: "q2", choice: 0 },
    ], "attempt-local");
    expect(result).toMatchObject({
      attemptId: "attempt-local",
      correct: 1,
      total: 2,
      score: 0.5,
    });
    expect(result?.weakTags[0]?.tag).toBe("geo");
  });

  it("returns null when the answer key is incomplete", () => {
    const session = createSessionRecord(
      { ...quiz, answerKey: quiz.answerKey?.slice(0, 1) },
      "en",
    );
    expect(checkAnswerLocally(session, "q2", 2)).toBeNull();
    expect(
      submitQuizLocally(session, [{ questionId: "q1", choice: 1 }]),
    ).toBeNull();
  });
});
