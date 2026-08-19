import { describe, expect, it } from "vitest";
import {
  buildQuizExport,
  quizExportFilename,
  stringifyQuizExport,
} from "./exportQuiz";
import { createSessionRecord } from "./historyStore";
import type { QuizPayload } from "./api";

const quiz: QuizPayload = {
  id: "quiz-1",
  sourceId: "src-1",
  title: "HTTP Caching Notes",
  sourceUrl: "https://web.dev/http-cache/",
  markdown: "# HTTP caching\n\nETag validates cached responses.",
  truncated: false,
  questions: [
    {
      id: "q1",
      stem: "What does ETag help with?",
      options: ["Auth", "Cache validation", "Routing", "TLS"],
      tags: ["http"],
    },
  ],
  answerKey: [
    {
      questionId: "q1",
      correctIndex: 1,
      explanation: "Validators compare entity tags.",
      tags: ["http"],
    },
  ],
};

describe("exportQuiz", () => {
  it("builds structured data with info, answers, and explanation", () => {
    const session = createSessionRecord(quiz, "en", 1_700_000_000_000);
    const payload = buildQuizExport(session);

    expect(payload.info).toEqual({
      id: "quiz-1",
      title: "HTTP Caching Notes",
      sourceId: "src-1",
      sourceUrl: "https://web.dev/http-cache/",
      markdown: "# HTTP caching\n\nETag validates cached responses.",
      truncated: false,
      questionCount: 1,
      language: "en",
      createdAt: "2023-11-14T22:13:20.000Z",
    });
    expect(payload.questions).toEqual([
      {
        id: "q1",
        stem: "What does ETag help with?",
        options: ["Auth", "Cache validation", "Routing", "TLS"],
        tags: ["http"],
        correctIndex: 1,
        explanation: "Validators compare entity tags.",
      },
    ]);
    expect(stringifyQuizExport(payload)).not.toMatch(/your answer|choices|score/i);
  });

  it("omits user selections even when an attempt exists", () => {
    const session = {
      ...createSessionRecord(quiz, "zh", 1_700_000_000_000),
      choices: { q1: 0 },
      reveals: {
        q1: {
          correct: false,
          explanation: "Validators compare entity tags.",
          correctIndex: 1,
        },
      },
      status: "completed" as const,
      submitResult: {
        attemptId: "a1",
        score: 0,
        correct: 0,
        total: 1,
        weakTags: [],
        results: [
          {
            questionId: "q1",
            choice: 0,
            correct: false,
            correctIndex: 1,
            stem: quiz.questions[0]!.stem,
            options: quiz.questions[0]!.options,
            explanation: "Validators compare entity tags.",
            tags: ["http"],
          },
        ],
      },
    };

    const json = stringifyQuizExport(buildQuizExport(session));
    const parsed = JSON.parse(json) as ReturnType<typeof buildQuizExport>;
    expect(parsed.questions[0]?.correctIndex).toBe(1);
    expect(json).not.toContain("attemptId");
    expect(json).not.toContain('"choice"');
    expect(json).not.toContain('"choices"');
  });

  it("falls back to reveals when the local answer key is missing", () => {
    const session = {
      ...createSessionRecord({ ...quiz, answerKey: undefined }, "en"),
      reveals: {
        q1: {
          correct: true,
          explanation: "From reveal.",
          correctIndex: 1,
        },
      },
    };
    expect(session.answerKey).toEqual({});
    expect(buildQuizExport(session).questions[0]).toMatchObject({
      correctIndex: 1,
      explanation: "From reveal.",
    });
  });

  it("names export files from title and date", () => {
    const session = createSessionRecord(quiz, "zh", 1_700_000_000_000);
    expect(quizExportFilename(session, 1_700_000_000_000)).toBe(
      "dropbrain-http-caching-notes-2023-11-14.json",
    );
  });
});
