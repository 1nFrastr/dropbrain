import { useEffect, useRef, useState } from "react";
import {
  Download,
  Info,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
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
  type CreateSourceResponse,
} from "./api";
import ChatMarkdown from "./ChatMarkdown";
import ChatSidebar from "./ChatSidebar";
import {
  clampQuizCount,
  loadConfirmBeforeGen,
  loadQuizCount,
  saveConfirmBeforeGen,
  saveQuizCount,
} from "./homePrefs";
import {
  askAnythingSuggestions,
  chatTruncatedHint,
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
  hasCompleteAnswerKey,
  historyStatusLabel,
  listQuizHistory,
  putQuizSession,
  toAnswerKeyMap,
  type QuizHistoryItem,
  type QuizSessionRecord,
} from "./historyStore";
import QuizCountControl from "./QuizCountControl";
import QuizInfoCard, { type QuizInfo } from "./QuizInfoCard";
import { isSampleQuizId, seedSampleQuizzesForNewUser } from "./sampleQuizzes";

type GenPhase = "idle" | "fetching" | "writing" | "done";
type UrlPreview = CreateSourceResponse & { markdown: string };

export default function HomePage() {
  const navigate = useNavigate();
  const [contentLang, setContentLang] = useState<AppLanguage>("en");
  const [url, setUrl] = useState("");
  const [useCache, setUseCache] = useState(true);
  const [confirmBeforeGen, setConfirmBeforeGen] = useState(loadConfirmBeforeGen);
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [count, setCount] = useState(loadQuizCount);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState<GenPhase>("idle");
  const [history, setHistory] = useState<QuizHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askMessages, setAskMessages] = useState<ChatTurn[]>([]);
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [historyMenuId, setHistoryMenuId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const pendingGen = useRef<
    | { kind: "url" }
    | { kind: "fork"; sourceId: string; count: number; language: AppLanguage }
    | null
  >(null);

  useEffect(() => {
    setContentLang(resolveInitialLanguage());
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, []);

  useEffect(() => {
    if (!info) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setInfo(null);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [info]);

  useEffect(() => {
    if (!historyMenuId) return;
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".history-actions")) return;
      setHistoryMenuId(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setHistoryMenuId(null);
    }
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [historyMenuId]);

  async function refreshHistory() {
    try {
      await seedSampleQuizzesForNewUser();
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

  function onCountChange(next: number) {
    const clamped = clampQuizCount(next);
    setCount(clamped);
    saveQuizCount(clamped);
  }

  function onConfirmBeforeGenChange(next: boolean) {
    setConfirmBeforeGen(next);
    saveConfirmBeforeGen(next);
  }

  async function fetchUrlSource(): Promise<UrlPreview> {
    const source = await createUrlSource(url.trim(), { useCache });
    if (!source.markdown) {
      throw new Error("The page was fetched, but no preview was returned.");
    }
    const preview = { ...source, markdown: source.markdown };
    setUrlPreview(preview);
    return preview;
  }

  async function generateFromSourceId(
    sourceId: string,
    quizCount: number,
    language: AppLanguage,
  ) {
    const created = await createQuiz(sourceId, quizCount, language);
    const full = await getQuiz(created.quizId);
    if (!full.questions.length) {
      throw new Error("No questions were generated.");
    }
    const session = createSessionRecord(full, language);
    await putQuizSession(session);
    setGenPhase("done");
    navigate(`/quiz/${full.id}`);
  }

  async function generateFromSource(source: CreateSourceResponse) {
    await generateFromSourceId(source.sourceId, count, contentLang);
  }

  async function onGenerate() {
    if (url.trim().length < 8) {
      setError("Enter a page URL.");
      return;
    }

    setError(null);
    pendingGen.current = { kind: "url" };

    if (confirmBeforeGen && !urlPreview) {
      setPreviewing(true);
      try {
        await fetchUrlSource();
      } catch (err) {
        setUrlPreview(null);
        setError(err instanceof Error ? err.message : "Could not fetch page");
      } finally {
        setPreviewing(false);
      }
      return;
    }

    setBusy(true);
    setGenerating(true);
    setGenPhase(urlPreview ? "writing" : "fetching");

    try {
      const source = urlPreview ?? (await fetchUrlSource());
      setGenPhase("writing");
      await generateFromSource(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setGenPhase("writing");
    } finally {
      setBusy(false);
    }
  }

  function onCancelGenerate() {
    setGenerating(false);
    setGenPhase("idle");
    pendingGen.current = null;
  }

  async function onRetryGenerate() {
    const pending = pendingGen.current;
    if (pending?.kind === "fork") {
      await runFork(pending.sourceId, pending.count, pending.language);
      return;
    }
    await onGenerate();
  }

  async function onOpenInfo(id: string) {
    setHistoryError(null);
    try {
      let session = await getQuizSession(id);
      if (!session) {
        setHistoryError("Quiz not found in local history.");
        return;
      }
      if (
        !isSampleQuizId(session.id) &&
        (session.quiz.markdown == null || session.quiz.sourceUrl === undefined)
      ) {
        try {
          const remote = await getQuiz(id);
          session = await putQuizSession({
            ...session,
            quiz: {
              ...session.quiz,
              sourceUrl: remote.sourceUrl,
              markdown: remote.markdown,
              truncated: remote.truncated,
            },
          });
        } catch {
          /* show whatever we already have locally */
        }
      }
      setInfo({
        title: session.title,
        sourceId: session.sourceId,
        sourceUrl: session.quiz.sourceUrl,
        markdown: session.quiz.markdown,
        truncated: session.quiz.truncated,
        questionCount: session.quiz.questions.length,
        language: session.language,
        createdAt: session.createdAt,
      });
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Could not open quiz info",
      );
    }
  }

  async function runFork(
    sourceId: string,
    quizCount: number,
    language: AppLanguage,
  ) {
    const sampleMarkdown = isSampleQuizId(sourceId) ? info?.markdown : undefined;
    pendingGen.current = { kind: "fork", sourceId, count: quizCount, language };
    setInfo(null);
    setError(null);
    setBusy(true);
    setGenerating(true);
    setGenPhase("writing");
    try {
      let resolvedSourceId = sourceId;
      if (sampleMarkdown) {
        const source = await createTextSource(sampleMarkdown);
        resolvedSourceId = source.sourceId;
      }
      await generateFromSourceId(resolvedSourceId, quizCount, language);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fork quiz");
      setGenPhase("writing");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    await deleteQuizSession(id);
    await refreshHistory();
  }

  async function hydrateSessionForExport(
    session: QuizSessionRecord,
  ): Promise<QuizSessionRecord> {
    const needsSource =
      session.quiz.markdown == null || session.quiz.sourceUrl === undefined;
    if (isSampleQuizId(session.id) || (!needsSource && hasCompleteAnswerKey(session))) {
      return session;
    }
    try {
      const remote = await getQuiz(session.id);
      return await putQuizSession({
        ...session,
        quiz: {
          ...session.quiz,
          title: remote.title,
          sourceUrl: remote.sourceUrl,
          markdown: remote.markdown,
          truncated: remote.truncated,
        },
        answerKey: {
          ...session.answerKey,
          ...toAnswerKeyMap(remote.answerKey),
        },
      });
    } catch {
      return session;
    }
  }

  async function onExport(id: string) {
    try {
      const local = await getQuizSession(id);
      if (!local) {
        setHistoryError("Quiz not found in local history.");
        return;
      }
      const session = await hydrateSessionForExport(local);
      await exportQuizSession(session);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Could not export quiz",
      );
    }
  }

  const canGenerate = url.trim().length >= 8 && !busy && !previewing;

  if (generating) {
    return (
      <div className="app">
        <section className="generating">
          <h1 className="brand">Dropbrain</h1>
          <p className="tagline">
            {error ? "Could not finish this quiz" : "Working on it…"}
          </p>
          {error ? (
            <>
              <p className="error generating-error">{error}</p>
              <p className="hint">
                Your page is still here. Try writing questions again — you do
                not need to fetch the URL over.
              </p>
              <div className="generating-actions">
                <button
                  type="button"
                  className="cta btn-with-icon"
                  disabled={busy}
                  onClick={() => void onRetryGenerate()}
                >
                  <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
                  Try again
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={onCancelGenerate}
                >
                  Back
                </button>
              </div>
            </>
          ) : (
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
          )}
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
        <div className="hero-lead">
          <p className="tagline">Drop a page in, quiz it into memory.</p>
          <a
            className="github-link"
            href="https://github.com/1nFrastr/dropbrain"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            title="GitHub"
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.28-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.23 0 1.61-.01 2.91-.01 3.31 0 .32.22.69.83.58A12.01 12.01 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void onGenerate();
          }}
        >
          <div className="composer">
            <input
              className="field url"
              type="url"
              value={url}
              disabled={previewing || busy}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlPreview(null);
              }}
              placeholder="https://example.com/article"
              aria-label="Page URL"
            />
            <button
              type="submit"
              className="cta composer-go"
              disabled={!canGenerate}
              aria-label={previewing ? "Fetching page" : "Generate quiz"}
            >
              {previewing ? (
                <RefreshCw
                  className="spin"
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              ) : (
                <Sparkles size={18} strokeWidth={2} aria-hidden="true" />
              )}
              {previewing ? (
                <span>…</span>
              ) : (
                <>
                  <span className="composer-go-short">Gen</span>
                  <span className="composer-go-full">Generate</span>
                </>
              )}
            </button>
          </div>

          <div className="tune-block">
            <div className="tune-row">
              <button
                type="button"
                className="icon-btn"
                aria-pressed={showOptions}
                aria-label="More options"
                title="Options"
                onClick={() => setShowOptions((open) => !open)}
              >
                <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <div className="lang-switch" role="group" aria-label="Content language">
                <button
                  type="button"
                  aria-pressed={contentLang === "zh"}
                  disabled={previewing || busy}
                  onClick={() => onContentLanguageChange("zh")}
                >
                  中
                </button>
                <button
                  type="button"
                  aria-pressed={contentLang === "en"}
                  disabled={previewing || busy}
                  onClick={() => onContentLanguageChange("en")}
                >
                  EN
                </button>
              </div>
              <QuizCountControl
                id="count"
                value={count}
                disabled={previewing || busy}
                onChange={onCountChange}
              />
            </div>
            {showOptions && (
              <div className="option-chips">
                <label
                  className="chip-toggle"
                  data-tip="Use a saved copy if this page was fetched recently."
                >
                  <input
                    type="checkbox"
                    checked={useCache}
                    disabled={previewing || busy}
                    onChange={(e) => {
                      setUseCache(e.target.checked);
                      setUrlPreview(null);
                    }}
                  />
                  Cache
                </label>
                <label
                  className="chip-toggle"
                  data-tip="Show the page first so you can check it before generating."
                >
                  <input
                    type="checkbox"
                    checked={confirmBeforeGen}
                    disabled={previewing || busy}
                    onChange={(e) => onConfirmBeforeGenChange(e.target.checked)}
                  />
                  Preview first
                </label>
              </div>
            )}
          </div>

          {confirmBeforeGen && urlPreview && (
            <section className="source-preview" aria-live="polite">
              <div className="source-preview-head">
                <div>
                  <p className="source-preview-kicker">Preview ready</p>
                  <h2>{urlPreview.title}</h2>
                </div>
                <span className="source-preview-badge">
                  {urlPreview.cached ? "Cached" : "Fresh fetch"}
                </span>
              </div>
              <p className="source-preview-meta">
                {urlPreview.markdown.length.toLocaleString()} characters
                {urlPreview.truncated ? " · truncated to the ingest limit" : ""}
              </p>
              <div className="source-preview-body">
                <ChatMarkdown>{urlPreview.markdown}</ChatMarkdown>
              </div>
            </section>
          )}

          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="history" aria-label="Quiz history">
        <div className="history-head">
          <h2>Recent</h2>
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="Refresh history"
            title="Refresh"
            onClick={() => void refreshHistory()}
          >
            <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {historyError && <p className="error">{historyError}</p>}
        {history.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="history-list">
            {history.map((item) => (
              <li
                key={item.id}
                className={
                  historyMenuId === item.id
                    ? "history-item actions-open"
                    : "history-item"
                }
              >
                <Link className="history-link" to={`/quiz/${item.id}`}>
                  <span className="history-title">{item.title}</span>
                  <span className="history-meta">
                    {historyStatusLabel(item)} · {formatHistoryWhen(item.updatedAt)}
                  </span>
                </Link>
                <div className="history-actions">
                  <button
                    type="button"
                    className="ghost icon-btn history-more"
                    aria-label={`More actions for ${item.title}`}
                    aria-haspopup="menu"
                    aria-expanded={historyMenuId === item.id}
                    aria-pressed={historyMenuId === item.id}
                    onClick={() =>
                      setHistoryMenuId((id) => (id === item.id ? null : item.id))
                    }
                  >
                    <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <div className="history-menu" role="menu">
                    <button
                      type="button"
                      className="ghost icon-btn"
                      role="menuitem"
                      aria-label={`Quiz info for ${item.title}`}
                      title="Info"
                      onClick={() => {
                        setHistoryMenuId(null);
                        void onOpenInfo(item.id);
                      }}
                    >
                      <Info size={16} strokeWidth={2} aria-hidden="true" />
                      <span className="history-menu-label">Info</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-btn"
                      role="menuitem"
                      aria-label={`Export ${item.title}`}
                      title="Export"
                      onClick={() => {
                        setHistoryMenuId(null);
                        void onExport(item.id);
                      }}
                    >
                      <Download size={16} strokeWidth={2} aria-hidden="true" />
                      <span className="history-menu-label">Export</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-btn history-menu-delete"
                      role="menuitem"
                      aria-label={`Delete ${item.title}`}
                      title="Delete"
                      onClick={() => {
                        setHistoryMenuId(null);
                        void onDelete(item.id);
                      }}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                      <span className="history-menu-label">Delete</span>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {info && (
        <>
          <button
            type="button"
            className="info-modal-backdrop open"
            aria-label="Close quiz info"
            onClick={() => setInfo(null)}
          />
          <div className="info-modal">
            <QuizInfoCard
              info={info}
              busy={busy}
              onClose={() => setInfo(null)}
              onFork={(quizCount, language) =>
                void runFork(info.sourceId, quizCount, language)
              }
            />
          </div>
        </>
      )}

      <ChatSidebar
        open={askOpen}
        onClose={() => setAskOpen(false)}
        kicker="Open chat"
        title="Ask anything"
        emptyPrompt="Ask about any topic — explanations, quick drills, or study tips."
        suggestions={askAnythingSuggestions(contentLang)}
        truncatedHint={chatTruncatedHint(contentLang)}
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
