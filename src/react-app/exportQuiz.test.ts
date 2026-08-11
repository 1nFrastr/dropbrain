import { describe, expect, it } from "vitest";
import {
  buildQuizExportMarkdown,
  quizExportFilename,
} from "./exportQuiz";
import { createSessionRecord } from "./historyStore";
import type { QuizPayload } from "./api";

const quiz: QuizPayload = {
  id: "quiz-1",
  sourceId: "src-1",
  title: "HTTP Caching Notes",
  questions: [
    {
      id: "q1",
      stem: "What does ETag help with?",
      options: ["Auth", "Cache validation", "Routing", "TLS"],
      tags: ["http"],
    },
  ],
};

describe("exportQuiz", () => {
  it("builds markdown with answers and explanation", () => {
    const session = {
      ...createSessionRecord(quiz, "en", 1_700_000_000_000),
      choices: { q1: 1 },
      reveals: {
        q1: {
          correct: true,
          explanation: "Validators compare entity tags.",
          correctIndex: 1,
        },
      },
      status: "completed" as const,
      submitResult: {
        attemptId: "a1",
        score: 1,
        correct: 1,
        total: 1,
        weakTags: [],
        results: [
          {
            questionId: "q1",
            choice: 1,
            correct: true,
            correctIndex: 1,
            stem: quiz.questions[0]!.stem,
            options: quiz.questions[0]!.options,
            explanation: "Validators compare entity tags.",
            tags: ["http"],
          },
        ],
      },
    };

    const md = buildQuizExportMarkdown(session);
    expect(md).toContain("# HTTP Caching Notes");
    expect(md).toContain("Score: 100%");
    expect(md).toContain("← your answer");
    expect(md).toContain("✓ correct");
    expect(md).toContain("Result: correct");
    expect(md).toContain("Validators compare entity tags.");
  });

  it("names export files from title and date", () => {
    const session = createSessionRecord(quiz, "zh", 1_700_000_000_000);
    expect(quizExportFilename(session, 1_700_000_000_000)).toBe(
      "dropbrain-http-caching-notes-2023-11-14.md",
    );
  });
});
