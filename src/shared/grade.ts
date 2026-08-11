/** Pure quiz grading — usable in the Worker and offline in the browser. */

export type GradeQuestion = {
  id: string;
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  tags: string[];
};

export type GradeAnswer = {
  questionId: string;
  choice: number;
};

export type GradedItem = {
  questionId: string;
  choice: number;
  correct: boolean;
  correctIndex: number;
  stem: string;
  options: string[];
  explanation: string;
  tags: string[];
};

export type GradeSummary = {
  graded: GradedItem[];
  correct: number;
  total: number;
  score: number;
  weakTags: Array<{ tag: string; misses: number }>;
};

export function checkChoice(
  question: GradeQuestion,
  choice: number,
): Omit<GradedItem, "stem" | "options"> & { tags: string[] } {
  return {
    questionId: question.id,
    choice,
    correct: choice === question.correctIndex,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    tags: question.tags,
  };
}

export function gradeAnswers(
  questions: GradeQuestion[],
  answers: GradeAnswer[],
): GradeSummary {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let correct = 0;
  const graded = answers.map((a) => {
    const q = byId.get(a.questionId);
    if (!q) {
      return {
        questionId: a.questionId,
        choice: a.choice,
        correct: false,
        correctIndex: -1,
        stem: "",
        options: [] as string[],
        explanation: "Question not found",
        tags: [] as string[],
      };
    }
    const isCorrect = a.choice === q.correctIndex;
    if (isCorrect) correct += 1;
    return {
      questionId: q.id,
      choice: a.choice,
      correct: isCorrect,
      correctIndex: q.correctIndex,
      stem: q.stem,
      options: q.options,
      explanation: q.explanation,
      tags: q.tags,
    };
  });

  const total = graded.length;
  const score = total === 0 ? 0 : correct / total;
  const weakTagCounts = new Map<string, number>();
  for (const g of graded) {
    if (!g.correct) {
      for (const tag of g.tags) {
        weakTagCounts.set(tag, (weakTagCounts.get(tag) ?? 0) + 1);
      }
    }
  }
  const weakTags = [...weakTagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, misses]) => ({ tag, misses }));

  return { graded, correct, total, score, weakTags };
}
