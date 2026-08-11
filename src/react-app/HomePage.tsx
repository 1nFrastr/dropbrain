import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createQuiz,
  createTextSource,
  createUrlSource,
  getQuiz,
} from "./api";
import {
  contentLanguageLabel,
  resolveInitialLanguage,
  saveLanguage,
  type AppLanguage,
} from "./i18n";
import {
  createSessionRecord,
  deleteQuizSession,
  formatHistoryWhen,
  historyStatusLabel,
  listQuizHistory,
  putQuizSession,
  type QuizHistoryItem,
} from "./historyStore";

type Tab = "text" | "url";
type GenPhase = "idle" | "fetching" | "writing" | "done";

export default function HomePage() {
  const navigate = useNavigate();
  const [contentLang, setContentLang] = useState<AppLanguage>("en");
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState<GenPhase>("idle");
  const [history, setHistory] = useState<QuizHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    setContentLang(resolveInitialLanguage());
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, []);

  async function refreshHistory() {
    try {
      setHistory(await listQuizHistory());
      setHistoryError(null);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Could not load history",
      );
    }
  }

  function onContentLanguageChange(next: AppLanguage) {
    setContentLang(next);
    saveLanguage(next);
  }

  async function onGenerate() {
    setError(null);
    setBusy(true);
    setGenerating(true);
    setGenPhase(tab === "url" ? "fetching" : "writing");

    try {
      const source =
        tab === "text"
          ? await createTextSource(text)
          : await createUrlSource(url.trim());

      setGenPhase("writing");
      const created = await createQuiz(source.sourceId, count, contentLang);
      const full = await getQuiz(created.quizId);
      if (!full.questions.length) {
        throw new Error("No questions were generated.");
      }
      const session = createSessionRecord(full, contentLang);
      await putQuizSession(session);
      setGenPhase("done");
      navigate(`/quiz/${full.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setGenerating(false);
      setGenPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    await deleteQuizSession(id);
    await refreshHistory();
  }

  if (generating) {
    return (
      <div className="app">
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
      </div>
    );
  }

  return (
    <div className="app">
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
            <div className="control">
              <label htmlFor="content-lang">Content language</label>
              <select
                id="content-lang"
                value={contentLang}
                onChange={(e) =>
                  onContentLanguageChange(e.target.value as AppLanguage)
                }
              >
                <option value="zh">{contentLanguageLabel("zh")}</option>
                <option value="en">{contentLanguageLabel("en")}</option>
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

      <section className="history" aria-label="Quiz history">
        <div className="history-head">
          <h2>Recent quizzes</h2>
          <button
            type="button"
            className="ghost history-refresh"
            onClick={() => void refreshHistory()}
          >
            Refresh
          </button>
        </div>
        {historyError && <p className="error">{historyError}</p>}
        {history.length === 0 ? (
          <p className="muted">No saved quizzes yet — generate one above.</p>
        ) : (
          <ul className="history-list">
            {history.map((item) => (
              <li key={item.id} className="history-item">
                <Link className="history-link" to={`/quiz/${item.id}`}>
                  <span className="history-title">{item.title}</span>
                  <span className="history-meta">
                    {historyStatusLabel(item)} · {formatHistoryWhen(item.updatedAt)}
                  </span>
                </Link>
                <button
                  type="button"
                  className="ghost history-delete"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => void onDelete(item.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
