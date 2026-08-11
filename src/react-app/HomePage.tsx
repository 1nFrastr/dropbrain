import { useEffect, useState } from "react";
import {
  Download,
  FileText,
  Link2,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  createQuiz,
  createTextSource,
  createUrlSource,
  getQuiz,
  streamAskAnything,
  type ChatTurn,
} from "./api";
import ChatSidebar from "./ChatSidebar";
import {
  askAnythingSuggestions,
  contentLanguageLabel,
  resolveInitialLanguage,
  saveLanguage,
  type AppLanguage,
} from "./i18n";
import { exportQuizSession } from "./exportQuiz";
import {
  createSessionRecord,
  deleteQuizSession,
  formatHistoryWhen,
  getQuizSession,
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
  const [askOpen, setAskOpen] = useState(false);
  const [askMessages, setAskMessages] = useState<ChatTurn[]>([]);

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

  async function onExport(id: string) {
    try {
      const session = await getQuizSession(id);
      if (!session) {
        setHistoryError("Quiz not found in local history.");
        return;
      }
      await exportQuizSession(session);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Could not export quiz",
      );
    }
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
    <div className={`app${askOpen ? " chat-open" : ""}`}>
      {!askOpen && (
        <button
          type="button"
          className="ask-fab"
          aria-label="Ask anything"
          title="Ask anything"
          onClick={() => setAskOpen(true)}
        >
          <MessageCircle size={24} strokeWidth={2} aria-hidden="true" />
        </button>
      )}

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
              <FileText size={16} strokeWidth={2} aria-hidden="true" />
              Paste text
            </button>
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={tab === "url"}
              onClick={() => setTab("url")}
            >
              <Link2 size={16} strokeWidth={2} aria-hidden="true" />
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
              className="cta btn-with-icon"
              disabled={
                busy ||
                (tab === "text"
                  ? text.trim().length < 40
                  : url.trim().length < 8)
              }
              onClick={() => void onGenerate()}
            >
              <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
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
            className="ghost history-refresh btn-with-icon"
            onClick={() => void refreshHistory()}
          >
            <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
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
                <div className="history-actions">
                  <button
                    type="button"
                    className="ghost history-action btn-with-icon"
                    aria-label={`Export ${item.title}`}
                    onClick={() => void onExport(item.id)}
                  >
                    <Download size={15} strokeWidth={2} aria-hidden="true" />
                    Export
                  </button>
                  <button
                    type="button"
                    className="ghost history-action btn-with-icon"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => void onDelete(item.id)}
                  >
                    <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChatSidebar
        open={askOpen}
        onClose={() => setAskOpen(false)}
        kicker="Open chat"
        title="Ask anything"
        emptyPrompt="Ask about any topic — explanations, quick drills, or study tips."
        suggestions={askAnythingSuggestions(contentLang)}
        placeholder="Ask anything…"
        ariaLabel="Ask anything chat"
        threadKey="ask-anything"
        messages={askMessages}
        onMessagesChange={setAskMessages}
        stream={(next, onDelta, signal) =>
          streamAskAnything(next, contentLang, onDelta, signal)
        }
      />
    </div>
  );
}
