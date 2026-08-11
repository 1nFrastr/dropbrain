import { BookOpenCheck, Plus } from "lucide-react";
import type { GradedResult, SubmitResponse } from "./api";

type Props = {
  title: string;
  result: SubmitResponse;
  onAgain: () => void;
  onReview?: () => void;
};

export default function ResultsView({
  title,
  result,
  onAgain,
  onReview,
}: Props) {
  const pct = Math.round(result.score * 100);
  const misses = result.results.filter((r) => !r.correct);

  return (
    <section>
      <h1 className="brand">Dropbrain</h1>
      <p className="tagline">{title}</p>
      <p className="results-score">
        {pct}%
        <span
          className="muted"
          style={{ fontSize: "1rem", marginLeft: "0.6rem" }}
        >
          ({result.correct}/{result.total})
        </span>
      </p>

      {result.weakTags.length > 0 && (
        <div className="weak">
          <h3>Focus areas</h3>
          <div className="tags">
            {result.weakTags.map((w) => (
              <span className="tag" key={w.tag}>
                {w.tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="review">
        <h3>Missed questions</h3>
        {misses.length === 0 ? (
          <p className="muted">Clean run — nothing to review.</p>
        ) : (
          misses.map((r: GradedResult) => (
            <div className="review-item" key={r.questionId}>
              <h4>{r.stem}</h4>
              <p className="muted">
                Your answer: {r.options[r.choice] ?? "—"}
                <br />
                Correct: {r.options[r.correctIndex]}
                <br />
                {r.explanation}
              </p>
              {r.tags.length > 0 && (
                <div className="tags" style={{ marginTop: "0.55rem" }}>
                  {r.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="nav-row">
        {onReview && (
          <button type="button" className="ghost btn-with-icon" onClick={onReview}>
            <BookOpenCheck size={16} strokeWidth={2} aria-hidden="true" />
            Review questions
          </button>
        )}
        <button type="button" className="ghost btn-with-icon" onClick={onAgain}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          Drop something else
        </button>
      </div>
    </section>
  );
}
