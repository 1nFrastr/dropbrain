import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  House,
  MessageCircle,
} from "lucide-react";
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
  hasCompleteAnswerKey,
  putQuizSession,
  toAnswerKeyMap,
  type QuestionReveal,
  type QuizSessionRecord,
} from "./historyStore";
import { resolveInitialLanguage } from "./i18n";
import { checkAnswerLocally, submitQuizLocally } from "./localGrade";
import QuizChatSidebar from "./QuizChatSidebar";
import ResultsView from "./ResultsView";
import { useOnlineStatus } from "./useOnlineStatus";

const LETTERS = ["A", "B", "C", "D"] as const;

function needsSourceHydration(session: QuizSessionRecord): boolean {
  return session.quiz.markdown == null || session.quiz.sourceUrl === undefined;
}

export default function QuizPage() {
  const { quizId = "" } = useParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();
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
          let next = local;
          if (!hasCompleteAnswerKey(local) || needsSourceHydration(local)) {
            try {
              const remote = await getQuiz(quizId);
              next = await putQuizSession({
                ...local,
                quiz: {
                  ...local.quiz,
                  title: remote.title,
                  sourceUrl: remote.sourceUrl,
                  markdown: remote.markdown,
                  truncated: remote.truncated,
                },
                answerKey: {
                  ...local.answerKey,
                  ...toAnswerKeyMap(remote.answerKey),
                },
              });
            } catch {
              /* keep session; check/submit may fall back to API when online */
            }
          }
          if (cancelled) return;
          setSession(next);
          setView(
            next.status === "completed" && next.submitResult
              ? "results"
              : "quiz",
          );
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
      const local = checkAnswerLocally(session, current.id, choice);
      if (!local && !online) {
        throw new Error(
          "This quiz needs a network connection once to unlock offline grading.",
        );
      }

      let graded = local;
      if (!graded) {
        const remote = await checkAnswerApi(quiz.id, current.id, choice);
        patchSession((prev) => ({
          ...prev,
          answerKey: {
            ...prev.answerKey,
            [current.id]: {
              correctIndex: remote.correctIndex,
              explanation: remote.explanation,
              tags: remote.tags,
            },
          },
        }));
        graded = remote;
      }

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

      const localResult = submitQuizLocally(session, answers);
      if (!localResult && !online) {
        throw new Error(
          "This quiz needs a network connection once to unlock offline grading.",
        );
      }
      let result = localResult;
      if (!result) {
        result = await submitQuiz(quiz.id, answers);
      } else if (online) {
        void submitQuiz(quiz.id, answers)
          .then((remote) => {
            setSession((prev) =>
              prev?.submitResult
                ? {
                    ...prev,
                    submitResult: {
                      ...prev.submitResult,
                      attemptId: remote.attemptId,
                    },
                  }
                : prev,
            );
          })
          .catch(() => {
            /* local result is authoritative when offline-capable */
          });
      }

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
            <Link className="ghost btn-with-icon" to="/">
              <House size={16} strokeWidth={2} aria-hidden="true" />
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
          <Link className="quiz-home-link btn-with-icon" to="/">
            <House size={15} strokeWidth={2} aria-hidden="true" />
            Home
          </Link>
          <span className="quiz-progress">{progressLabel}</span>
        </div>
        <p className="quiz-source-title">{quiz.title}</p>
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
                <span className="option-key">{LETTERS[i]}</span>
                <span className="option-text">{opt}</span>
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
              className="ghost ask-btn btn-with-icon"
              disabled={!online}
              title={online ? undefined : "Needs a network connection"}
              onClick={() => setChatOpen(true)}
            >
              <MessageCircle size={16} strokeWidth={2} aria-hidden="true" />
              Ask about this
            </button>
            {!online && (
              <p className="offline-hint">Chat needs a network connection.</p>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="nav-row quiz-nav">
          <button
            type="button"
            className="ghost btn-with-icon"
            disabled={index <= 0 || busy}
            onClick={() => goTo(index - 1)}
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
            Previous
          </button>
          <div className="quiz-nav-right">
            {session.status === "completed" && session.submitResult && (
              <button
                type="button"
                className="ghost btn-with-icon"
                disabled={busy}
                onClick={() => setView("results")}
              >
                <ChartColumn size={16} strokeWidth={2} aria-hidden="true" />
                Results
              </button>
            )}
            {index < quiz.questions.length - 1 && (
              <button
                type="button"
                className="cta btn-with-icon"
                disabled={busy}
                onClick={() => goTo(index + 1)}
              >
                Next
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            {session.status !== "completed" &&
              (allAnswered || index >= quiz.questions.length - 1) && (
                <button
                  type="button"
                  className={`btn-with-icon ${
                    index < quiz.questions.length - 1 ? "ghost" : "cta"
                  }`}
                  disabled={busy || !allAnswered}
                  onClick={() => void onSeeResults()}
                >
                  <ChartColumn size={16} strokeWidth={2} aria-hidden="true" />
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
          online={online}
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
