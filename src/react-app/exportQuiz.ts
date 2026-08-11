import type { QuizSessionRecord } from "./historyStore";

const LETTERS = ["A", "B", "C", "D"] as const;

function optionLine(index: number, text: string, marks: string[]): string {
  const mark = marks.length ? ` ${marks.join(" ")}` : "";
  return `- ${LETTERS[index] ?? String(index + 1)}. ${text}${mark}`;
}

/** Build a Markdown export of a saved quiz attempt. */
export function buildQuizExportMarkdown(session: QuizSessionRecord): string {
  const lines: string[] = [];
  const score =
    session.submitResult != null
      ? `${Math.round(session.submitResult.score * 100)}% (${session.submitResult.correct}/${session.submitResult.total})`
      : null;

  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push(`- Quiz ID: \`${session.id}\``);
  lines.push(`- Language: ${session.language}`);
  lines.push(`- Status: ${session.status === "completed" ? "Completed" : "In progress"}`);
  if (score) lines.push(`- Score: ${score}`);
  lines.push(`- Updated: ${new Date(session.updatedAt).toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  session.quiz.questions.forEach((q, i) => {
    const choice = session.choices[q.id];
    const reveal = session.reveals[q.id];
    const graded = session.submitResult?.results.find(
      (r) => r.questionId === q.id,
    );
    const correctIndex = reveal?.correctIndex ?? graded?.correctIndex;
    const explanation = reveal?.explanation ?? graded?.explanation;
    const isCorrect =
      reveal?.correct ??
      graded?.correct ??
      (choice !== undefined && correctIndex !== undefined
        ? choice === correctIndex
        : undefined);

    lines.push(`## ${i + 1}. ${q.stem}`);
    lines.push("");

    q.options.forEach((opt, optIndex) => {
      const marks: string[] = [];
      if (choice === optIndex) marks.push("← your answer");
      if (correctIndex === optIndex) marks.push("✓ correct");
      lines.push(optionLine(optIndex, opt, marks));
    });

    lines.push("");
    if (choice === undefined) {
      lines.push("Result: unanswered");
    } else if (isCorrect === true) {
      lines.push("Result: correct");
    } else if (isCorrect === false) {
      lines.push("Result: incorrect");
    } else {
      lines.push(`Your answer: ${LETTERS[choice] ?? choice}`);
    }

    if (explanation) {
      lines.push("");
      lines.push(`Explanation: ${explanation}`);
    }

    if (q.tags.length) {
      lines.push("");
      lines.push(`Tags: ${q.tags.join(", ")}`);
    }

    lines.push("");
  });

  return `${lines.join("\n").trim()}\n`;
}

export function quizExportFilename(session: QuizSessionRecord, now = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 10);
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `dropbrain-${slug || "quiz"}-${stamp}.md`;
}

export function downloadTextFile(filename: string, content: string, mime = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportQuizSession(session: QuizSessionRecord): Promise<void> {
  const markdown = buildQuizExportMarkdown(session);
  downloadTextFile(quizExportFilename(session), markdown);
}
