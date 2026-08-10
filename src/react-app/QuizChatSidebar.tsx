import { useEffect, useRef, useState } from "react";
import {
  streamChatAboutQuestion,
  type ChatTurn,
} from "./api";
import ChatMarkdown from "./ChatMarkdown";
import { isNearBottom, shouldSendOnEnter } from "./chatComposer";
import {
  chatSuggestions,
  type AppLanguage,
} from "./i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  quizId: string;
  questionId: string;
  questionStem: string;
  choice?: number;
  language: AppLanguage;
  messages: ChatTurn[];
  onMessagesChange: (messages: ChatTurn[]) => void;
};

export default function QuizChatSidebar({
  open,
  onClose,
  quizId,
  questionId,
  questionStem,
  choice,
  language,
  messages,
  onMessagesChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottomRef = useRef(true);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    stickToBottomRef.current = true;
    const id = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(id);
  }, [open, questionId]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, messages, sending, streamingText]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;

    const snapshot = messages;
    const next: ChatTurn[] = [...messages, { role: "user", content }];
    onMessagesChange(next);
    setDraft("");
    setSending(true);
    setStreamingText("");
    setError(null);
    stickToBottomRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let assembled = "";
    try {
      const full = await streamChatAboutQuestion(
        quizId,
        questionId,
        next,
        language,
        choice,
        (delta) => {
          assembled += delta;
          setStreamingText(assembled);
        },
        controller.signal,
      );
      const content = assembled || full;
      if (!content.trim()) {
        throw new Error("Empty reply from assistant");
      }
      onMessagesChange([...next, { role: "assistant", content }]);
      setStreamingText("");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Chat failed");
      if (assembled.trim()) {
        onMessagesChange([...next, { role: "assistant", content: assembled }]);
      } else {
        onMessagesChange(snapshot);
      }
      setStreamingText("");
    } finally {
      setSending(false);
    }
  }

  const suggestions = chatSuggestions(language);

  return (
    <>
      <button
        type="button"
        className={`chat-backdrop${open ? " open" : ""}`}
        aria-label="Close chat"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={`chat-sidebar${open ? " open" : ""}`}
        aria-hidden={!open}
        aria-label="Question chat"
      >
        <header className="chat-header">
          <div>
            <p className="chat-kicker">Dig deeper</p>
            <h2 className="chat-title">Ask about this question</h2>
          </div>
          <button
            type="button"
            className="chat-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <p className="chat-context" title={questionStem}>
          {questionStem}
        </p>

        <div
          className="chat-messages"
          ref={listRef}
          onScroll={() => {
            const el = listRef.current;
            if (!el) return;
            stickToBottomRef.current = isNearBottom(el);
          }}
        >
          {messages.length === 0 && !sending && (
            <div className="chat-empty">
              <p>Curious about a detail? Ask anything about this item.</p>
              <div className="chat-suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chat-suggestion"
                    disabled={sending}
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            if (!m.content.trim()) return null;
            return (
              <div
                key={`${m.role}-${i}`}
                className={`chat-bubble ${m.role}`}
              >
                {m.role === "assistant" ? (
                  <ChatMarkdown>{m.content}</ChatMarkdown>
                ) : (
                  m.content
                )}
              </div>
            );
          })}

          {sending && (
            <div
              className={`chat-bubble assistant${streamingText.trim() ? "" : " pending"}`}
              aria-live="polite"
            >
              {streamingText.trim() ? (
                <ChatMarkdown>{streamingText}</ChatMarkdown>
              ) : (
                <span className="chat-typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </div>
          )}
        </div>

        {error && <p className="chat-error">{error}</p>}

        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={2}
            value={draft}
            disabled={sending}
            placeholder="Ask a follow-up…"
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e) => {
              if (
                !shouldSendOnEnter(e.nativeEvent, composingRef.current)
              ) {
                return;
              }
              e.preventDefault();
              void send(draft);
            }}
          />
          <button
            type="submit"
            className="cta chat-send"
            disabled={sending || !draft.trim()}
          >
            Send
          </button>
        </form>
      </aside>
    </>
  );
}
