import { useState } from "react";
import { ExternalLink, GitFork, Sparkles, X } from "lucide-react";
import ChatMarkdown from "./ChatMarkdown";
import {
  clampQuizCount,
  loadQuizCount,
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
  saveQuizCount,
} from "./homePrefs";
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
          {hasLink && (
            <p className="quiz-info-host">{compactUrl(info.sourceUrl!)}</p>
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
        <div>
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
        <div>
          <dt>Questions</dt>
          <dd>{info.questionCount}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{contentLanguageLabel(info.language)}</dd>
        </div>
        {info.createdAt != null && (
          <div>
            <dt>Saved</dt>
            <dd>{new Date(info.createdAt).toLocaleString()}</dd>
          </div>
        )}
        {info.truncated ? (
          <div>
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
        <p className="muted">Page preview is not available offline yet.</p>
      )}

      {forking ? (
        <div className="quiz-info-fork">
          <p className="quiz-info-fork-kicker">New quiz from this page</p>
          <div className="tune-row">
            <label className="tune-slider">
              <span className="tune-count">{forkCount}</span>
              <input
                id="fork-count"
                className="tune-range"
                type="range"
                min={MIN_QUIZ_COUNT}
                max={MAX_QUIZ_COUNT}
                step={1}
                value={forkCount}
                disabled={busy}
                onChange={(e) =>
                  setForkCount(clampQuizCount(Number(e.target.value)))
                }
                aria-label="Number of questions"
              />
            </label>
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
          className="ghost btn-with-icon"
          disabled={busy}
          onClick={startFork}
        >
          <GitFork size={16} strokeWidth={2} aria-hidden="true" />
          Fork
        </button>
      )}
    </section>
  );
}
