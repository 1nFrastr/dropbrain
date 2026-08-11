import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  checkAnswer as checkAnswerApi,
  getQuiz,
  submitQuiz,
  type ChatTurn,
} from "./api";
import {
  createSessionRecord,
  getQuizSession,
  putQuizSession,
  type QuestionReveal,
  type QuizSessionRecord,
} from "./historyStore";
import { resolveInitialLanguage } from "./i18n";
import QuizChatSidebar from "./QuizChatSidebar";
import ResultsView from "./ResultsView";

const LETTERS = ["A", "B", "C", "D"] as const;

export default function QuizPage() {
  const { quizId = "" } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<QuizSessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [view, setView] = useState<"quiz" | "results">("quiz");
  const persistTimer = useRef(0);
  const skipPersist = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setChatOpen(false);
      try {
        const local = await getQuizSession(quizId);
        if (local) {
          if (cancelled) return;
          setSession(local);
          setView(local.status === "completed" && local.submitResult ? "results" : "quiz");
          return;
        }

        const remote = await getQuiz(quizId);
        if (!remote.questions.length) {
          throw new Error("This quiz has no questions.");
        }
        const created = createSessionRecord(remote, resolveInitialLanguage());
        const saved = await putQuizSession(created);
        if (cancelled) return;
        setSession(saved);
        setView("quiz");
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Quiz not found");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          skipPersist.current = false;
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  useEffect(() => {
    if (!session || skipPersist.current) return;
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void putQuizSession(session).catch(() => {
        /* ignore background persist errors */
      });
    }, 200);
    return () => window.clearTimeout(persistTimer.current);
  }, [session]);

  const quiz = session?.quiz;
  const index = session?.index ?? 0;
  const current = quiz?.questions[index];
  const revealed = current ? Boolean(session?.reveals[current.id]) : false;
  const localReveal: QuestionReveal | null =
    current && session ? (session.reveals[current.id] ?? null) : null;
  const choices = session?.choices ?? {};
  const chatByQuestion = session?.chatByQuestion ?? {};

  const progressLabel = useMemo(() => {
    if (!quiz) return "";
    return `${index + 1} / ${quiz.questions.length}`;
  }, [quiz, index]);

  const allAnswered = useMemo(() => {
    if (!quiz) return false;
    return quiz.questions.every((q) => choices[q.id] !== undefined);
  }, [quiz, choices]);

  const chatMessages = current ? (chatByQuestion[current.id] ?? []) : [];

  function patchSession(updater: (prev: QuizSessionRecord) => QuizSessionRecord) {
    setSession((prev) => (prev ? updater(prev) : prev));
  }

  async function checkAnswer(choice: number) {
    if (!session || !quiz || !current || revealed || busy) return;
    patchSession((prev) => ({
      ...prev,
      choices: { ...prev.choices, [current.id]: choice },
    }));
    setBusy(true);
    setError(null);
    try {
      const graded = await checkAnswerApi(quiz.id, current.id, choice);
      patchSession((prev) => ({
        ...prev,
        choices: { ...prev.choices, [current.id]: choice },
        reveals: {
          ...prev.reveals,
          [current.id]: {
            correct: graded.correct,
            explanation: graded.explanation,
            correctIndex: graded.correctIndex,
          },
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grade answer");
      patchSession((prev) => {
        const nextChoices = { ...prev.choices };
        delete nextChoices[current.id];
        return { ...prev, choices: nextChoices };
      });
    } finally {
      setBusy(false);
    }
  }

  function goTo(nextIndex: number) {
    if (!quiz) return;
    if (nextIndex < 0 || nextIndex >= quiz.questions.length) return;
    setChatOpen(false);
    patchSession((prev) => ({ ...prev, index: nextIndex }));
  }

  async function onSeeResults() {
    if (!session || !quiz || busy) return;
    setBusy(true);
    setError(null);
    setChatOpen(false);
    try {
      const answers = quiz.questions.map((q) => ({
        questionId: q.id,
        choice: session.choices[q.id] ?? -1,
      }));
      const result = await submitQuiz(quiz.id, answers);
      const next: QuizSessionRecord = {
        ...session,
        status: "completed",
        submitResult: result,
      };
      setSession(next);
      await putQuizSession(next);
      setView("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="app">
        <section className="generating">
          <h1 className="brand">Dropbrain</h1>
          <p className="tagline">Loading quiz…</p>
        </section>
      </div>
    );
  }

  if (!session || !quiz || !current) {
    return (
      <div className="app">
        <section>
          <h1 className="brand">Dropbrain</h1>
          <p className="error">{error ?? "Quiz not found"}</p>
          <div className="nav-row">
            <Link className="ghost" to="/">
              Back home
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (view === "results" && session.submitResult) {
    return (
      <div className="app">
        <ResultsView
          title={quiz.title}
          result={session.submitResult}
          onAgain={() => navigate("/")}
          onReview={() => {
            setView("quiz");
            patchSession((prev) => ({ ...prev, index: 0 }));
          }}
        />
      </div>
    );
  }

  return (
    <div className={`app${chatOpen ? " chat-open" : ""}`}>
      <section>
        <div className="quiz-meta">
          <div className="quiz-meta-main">
            <Link className="quiz-home-link" to="/">
              Home
            </Link>
            <span>{quiz.title}</span>
          </div>
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
            <button
              type="button"
              className="ghost ask-btn"
              onClick={() => setChatOpen(true)}
            >
              Ask about this
            </button>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="nav-row quiz-nav">
          <button
            type="button"
            className="ghost"
            disabled={index <= 0 || busy}
            onClick={() => goTo(index - 1)}
          >
            Previous
          </button>
          <div className="quiz-nav-right">
            {session.status === "completed" && session.submitResult && (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setView("results")}
              >
                Results
              </button>
            )}
            {index < quiz.questions.length - 1 && (
              <button
                type="button"
                className="cta"
                disabled={busy}
                onClick={() => goTo(index + 1)}
              >
                Next
              </button>
            )}
            {session.status !== "completed" &&
              (allAnswered || index >= quiz.questions.length - 1) && (
                <button
                  type="button"
                  className={
                    index < quiz.questions.length - 1 ? "ghost" : "cta"
                  }
                  disabled={busy || !allAnswered}
                  onClick={() => void onSeeResults()}
                >
                  See results
                </button>
              )}
          </div>
        </div>

        <QuizChatSidebar
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          quizId={quiz.id}
          questionId={current.id}
          questionStem={current.stem}
          choice={choices[current.id]}
          language={session.language}
          messages={chatMessages}
          onMessagesChange={(messages: ChatTurn[]) =>
            patchSession((prev) => ({
              ...prev,
              chatByQuestion: {
                ...prev.chatByQuestion,
                [current.id]: messages,
              },
            }))
          }
        />
      </section>
    </div>
  );
}
