import { useState } from "react";
import { ExternalLink, GitFork, Sparkles, X } from "lucide-react";
import ChatMarkdown from "./ChatMarkdown";
import {
  clampQuizCount,
  loadQuizCount,
  saveQuizCount,
} from "./homePrefs";
import QuizCountControl from "./QuizCountControl";
import {
  contentLanguageLabel,
  saveLanguage,
  type AppLanguage,
} from "./i18n";

export type QuizInfo = {
  title: string;
  sourceId: string;
  sourceUrl?: string | null;
  markdown?: string;
  truncated?: boolean;
  questionCount: number;
  language: AppLanguage;
  createdAt?: number;
};

type Props = {
  info: QuizInfo;
  busy?: boolean;
  onClose: () => void;
  onFork: (count: number, language: AppLanguage) => void;
};

function compactUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return raw;
  }
}

export default function QuizInfoCard({ info, busy = false, onClose, onFork }: Props) {
  const [forking, setForking] = useState(false);
  const [forkCount, setForkCount] = useState(() =>
    clampQuizCount(loadQuizCount()),
  );
  const [forkLang, setForkLang] = useState<AppLanguage>(info.language);

  function startFork() {
    setForking(true);
    setForkCount(clampQuizCount(loadQuizCount()));
    setForkLang(info.language);
  }

  function confirmFork() {
    saveQuizCount(forkCount);
    saveLanguage(forkLang);
    onFork(forkCount, forkLang);
  }

  const hasLink = Boolean(info.sourceUrl);

  return (
    <section className="quiz-info-dialog" role="dialog" aria-labelledby="quiz-info-title">
      <header className="quiz-info-dialog-head">
        <div>
          <p className="quiz-info-kicker">Quiz info</p>
          <h2 id="quiz-info-title">{info.title}</h2>
          {hasLink ? (
            <a
              className="quiz-info-host quiz-info-link"
              href={info.sourceUrl!}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{compactUrl(info.sourceUrl!)}</span>
              <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
            </a>
          ) : (
            <p className="quiz-info-host muted">No original URL</p>
          )}
        </div>
        <button
          type="button"
          className="ghost quiz-info-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <dl className="quiz-info-facts">
        <div className="quiz-info-fact-source">
          <dt>Source</dt>
          <dd>
            {hasLink ? (
              <a
                className="quiz-info-link"
                href={info.sourceUrl!}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{info.sourceUrl}</span>
                <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
              </a>
            ) : (
              <span className="muted">No original URL on this quiz</span>
            )}
          </dd>
        </div>
        <div className="quiz-info-fact-stat">
          <dt>Questions</dt>
          <dd>{info.questionCount}</dd>
        </div>
        <div className="quiz-info-fact-stat">
          <dt>Language</dt>
          <dd>{contentLanguageLabel(info.language)}</dd>
        </div>
        {info.createdAt != null && (
          <div className="quiz-info-fact-wide">
            <dt>Saved</dt>
            <dd>
              {new Date(info.createdAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </div>
        )}
        {info.truncated ? (
          <div className="quiz-info-fact-wide">
            <dt>Extract</dt>
            <dd>Truncated to the ingest limit</dd>
          </div>
        ) : null}
      </dl>

      {info.markdown ? (
        <div className="source-preview-body quiz-info-preview">
          <ChatMarkdown>{info.markdown}</ChatMarkdown>
        </div>
      ) : (
        <p className="muted quiz-info-preview-empty">
          Page preview is not available offline yet.
        </p>
      )}

      <div className="quiz-info-foot">
        {forking ? (
          <div className="quiz-info-fork">
            <p className="quiz-info-fork-kicker">New quiz from this page</p>
            <div className="tune-row">
              <div className="lang-switch" role="group" aria-label="Content language">
                <button
                  type="button"
                  aria-pressed={forkLang === "zh"}
                  disabled={busy}
                  onClick={() => setForkLang("zh")}
                >
                  中
                </button>
                <button
                  type="button"
                  aria-pressed={forkLang === "en"}
                  disabled={busy}
                  onClick={() => setForkLang("en")}
                >
                  EN
                </button>
              </div>
              <QuizCountControl
                id="fork-count"
                value={forkCount}
                disabled={busy}
                onChange={setForkCount}
              />
            </div>
            <div className="generating-actions">
              <button
                type="button"
                className="cta btn-with-icon"
                disabled={busy}
                onClick={confirmFork}
              >
                <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
                Gen
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setForking(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="ghost btn-with-icon quiz-info-fork-btn"
            disabled={busy}
            onClick={startFork}
          >
            <GitFork size={16} strokeWidth={2} aria-hidden="true" />
            Fork
          </button>
        )}
      </div>
    </section>
  );
}
