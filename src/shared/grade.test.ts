import { describe, expect, it } from "vitest";
import { checkChoice, gradeAnswers, type GradeQuestion } from "./grade";

const questions: GradeQuestion[] = [
  {
    id: "q1",
    stem: "2+2?",
    options: ["3", "4", "5", "6"],
    correctIndex: 1,
    explanation: "Four.",
    tags: ["math"],
  },
  {
    id: "q2",
    stem: "Capital of France?",
    options: ["London", "Berlin", "Paris", "Rome"],
    correctIndex: 2,
    explanation: "Paris.",
    tags: ["geo", "europe"],
  },
];

describe("grade", () => {
  it("checks a single choice", () => {
    expect(checkChoice(questions[0]!, 1).correct).toBe(true);
    expect(checkChoice(questions[0]!, 0)).toMatchObject({
      correct: false,
      correctIndex: 1,
      explanation: "Four.",
    });
  });

  it("grades a full attempt and ranks weak tags", () => {
    const summary = gradeAnswers(questions, [
      { questionId: "q1", choice: 1 },
      { questionId: "q2", choice: 0 },
    ]);
    expect(summary.correct).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.score).toBe(0.5);
    expect(summary.weakTags).toEqual([
      { tag: "geo", misses: 1 },
      { tag: "europe", misses: 1 },
    ]);
    expect(summary.graded[1]?.correctIndex).toBe(2);
  });

  it("handles missing questions", () => {
    const summary = gradeAnswers(questions, [
      { questionId: "missing", choice: 0 },
    ]);
    expect(summary.graded[0]).toMatchObject({
      correct: false,
      correctIndex: -1,
      explanation: "Question not found",
    });
  });
});
