import { useMemo, useState } from "react";
import "./App.css";
import {
  checkAnswer as checkAnswerApi,
  createQuiz,
  createTextSource,
  createUrlSource,
  getQuiz,
  submitQuiz,
  type GradedResult,
  type QuizPayload,
  type SubmitResponse,
} from "./api";

type Tab = "text" | "url";
type Step = "home" | "generating" | "quiz" | "results";
type GenPhase = "idle" | "fetching" | "writing" | "done";

const LETTERS = ["A", "B", "C", "D"] as const;

export default function App() {
  const [step, setStep] = useState<Step>("home");
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [genPhase, setGenPhase] = useState<GenPhase>("idle");
  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState(false);
  const [localReveal, setLocalReveal] = useState<{
    correct: boolean;
    explanation: string;
    correctIndex: number;
  } | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const current = quiz?.questions[index];
  const progressLabel = useMemo(() => {
    if (!quiz) return "";
    return `${index + 1} / ${quiz.questions.length}`;
  }, [quiz, index]);

  async function onGenerate() {
    setError(null);
    setBusy(true);
    setStep("generating");
    setGenPhase(tab === "url" ? "fetching" : "writing");
    setLocalReveal(null);
    setRevealed(false);
    setChoices({});
    setSubmitResult(null);
    setIndex(0);

    try {
      const source =
        tab === "text"
          ? await createTextSource(text)
          : await createUrlSource(url.trim());

      setGenPhase("writing");
      const created = await createQuiz(source.sourceId, count);
      const full = await getQuiz(created.quizId);
      if (!full.questions.length) {
        throw new Error("No questions were generated.");
      }
      setQuiz(full);
      setGenPhase("done");
      setStep("quiz");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("home");
      setGenPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  async function checkAnswer(choice: number) {
    if (!quiz || !current || revealed || busy) return;
    setChoices((prev) => ({ ...prev, [current.id]: choice }));
    setBusy(true);
    setError(null);
    try {
      const graded = await checkAnswerApi(quiz.id, current.id, choice);
      setLocalReveal({
        correct: graded.correct,
        explanation: graded.explanation,
        correctIndex: graded.correctIndex,
      });
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grade answer");
      setChoices((prev) => {
        const copy = { ...prev };
        delete copy[current.id];
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  async function onNext() {
    if (!quiz) return;
    if (index < quiz.questions.length - 1) {
      setIndex((i) => i + 1);
      setRevealed(false);
      setLocalReveal(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const answers = quiz.questions.map((q) => ({
        questionId: q.id,
        choice: choices[q.id] ?? -1,
      }));
      const result = await submitQuiz(quiz.id, answers);
      setSubmitResult(result);
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("home");
    setQuiz(null);
    setSubmitResult(null);
    setError(null);
    setIndex(0);
    setChoices({});
    setRevealed(false);
    setLocalReveal(null);
    setGenPhase("idle");
  }

  return (
    <div className="app">
      {step === "home" && (
        <section className="hero">
          <h1 className="brand">Dropbrain</h1>
          <p className="tagline">Drop anything in, quiz it into memory.</p>
          <p className="hint">
            Paste a note or drop a web page into your brain, then lock it in with
            active-recall multiple choice.
          </p>

          <div className="panel">
            <div className="tabs" role="tablist" aria-label="Source type">
              <button
                type="button"
                className="tab"
                role="tab"
                aria-selected={tab === "text"}
                onClick={() => setTab("text")}
              >
                Paste text
              </button>
              <button
                type="button"
                className="tab"
                role="tab"
                aria-selected={tab === "url"}
                onClick={() => setTab("url")}
              >
                Web URL
              </button>
            </div>

            {tab === "text" ? (
              <textarea
                className="field"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste an article, docs, or study notes…"
                aria-label="Text to learn"
              />
            ) : (
              <input
                className="field url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                aria-label="Page URL"
              />
            )}

            <div className="controls">
              <div className="control">
                <label htmlFor="count">Questions</label>
                <select
                  id="count"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="cta"
                disabled={
                  busy ||
                  (tab === "text"
                    ? text.trim().length < 40
                    : url.trim().length < 8)
                }
                onClick={() => void onGenerate()}
              >
                Generate quiz
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      )}

      {step === "generating" && (
        <section className="generating">
          <h1 className="brand">Dropbrain</h1>
          <p className="tagline">Working on it…</p>
          <ul className="steps">
            <li
              className={
                genPhase === "fetching"
                  ? "active"
                  : genPhase === "writing" || genPhase === "done"
                    ? "done"
                    : ""
              }
            >
              <span className="dot" />
              Fetching page
            </li>
            <li
              className={
                genPhase === "writing"
                  ? "active"
                  : genPhase === "done"
                    ? "done"
                    : ""
              }
            >
              <span className="dot" />
              Writing questions
            </li>
          </ul>
        </section>
      )}

      {step === "quiz" && quiz && current && (
        <section>
          <div className="quiz-meta">
            <span>{quiz.title}</span>
            <span>{progressLabel}</span>
          </div>
          <h2 className="stem">{current.stem}</h2>
          <div className="options" role="listbox" aria-label="Answer choices">
            {current.options.map((opt, i) => {
              let cls = "option";
              if (revealed && localReveal) {
                if (i === localReveal.correctIndex) cls += " correct";
                else if (choices[current.id] === i && !localReveal.correct) {
                  cls += " wrong";
                }
              } else if (choices[current.id] === i) {
                cls += " selected";
              }
              return (
                <button
                  key={i}
                  type="button"
                  className={cls}
                  disabled={revealed || busy}
                  onClick={() => void checkAnswer(i)}
                >
                  <strong>{LETTERS[i]}.</strong> {opt}
                </button>
              );
            })}
          </div>

          {revealed && localReveal && (
            <div className="feedback">
              <p className={`verdict ${localReveal.correct ? "ok" : "bad"}`}>
                {localReveal.correct ? "Correct" : "Not quite"}
              </p>
              <p>{localReveal.explanation}</p>
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <div className="nav-row">
            <button
              type="button"
              className="cta"
              disabled={!revealed || busy}
              onClick={() => void onNext()}
            >
              {index >= quiz.questions.length - 1 ? "See results" : "Next"}
            </button>
          </div>
        </section>
      )}

      {step === "results" && submitResult && (
        <ResultsView
          title={quiz?.title ?? "Quiz"}
          result={submitResult}
          onAgain={reset}
        />
      )}
    </div>
  );
}

function ResultsView({
  title,
  result,
  onAgain,
}: {
  title: string;
  result: SubmitResponse;
  onAgain: () => void;
}) {
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
                  {r.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="nav-row">
        <button type="button" className="ghost" onClick={onAgain}>
          Drop something else
        </button>
      </div>
    </section>
  );
}
