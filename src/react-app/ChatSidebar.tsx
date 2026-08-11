import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, SendHorizontal, X } from "lucide-react";
import type { ChatTurn } from "./api";
import ChatMarkdown from "./ChatMarkdown";
import { isNearBottom, pinToBottom, shouldSendOnEnter } from "./chatComposer";
import { stabilizeStreamingMarkdown } from "./streamMarkdown";

export type ChatStreamFn = (
  messages: ChatTurn[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) => Promise<string>;

type Props = {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  context?: string;
  emptyPrompt: string;
  suggestions: string[];
  placeholder?: string;
  ariaLabel?: string;
  messages: ChatTurn[];
  onMessagesChange: (messages: ChatTurn[]) => void;
  stream: ChatStreamFn;
  /** Reset focus/scroll when this identity changes (e.g. question id). */
  threadKey?: string;
};

export default function ChatSidebar({
  open,
  onClose,
  kicker,
  title,
  context,
  emptyPrompt,
  suggestions,
  placeholder = "Ask a follow-up…",
  ariaLabel = "Chat",
  messages,
  onMessagesChange,
  stream,
  threadKey,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottomRef = useRef(true);
  const composingRef = useRef(false);
  const ignoringScrollRef = useRef(false);
  const streamRafRef = useRef(0);
  const streamPendingRef = useRef("");
  const streamLastPaintRef = useRef(0);

  function markProgrammaticScroll() {
    ignoringScrollRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ignoringScrollRef.current = false;
      });
    });
  }

  useEffect(() => {
    if (!open) return;
    stickToBottomRef.current = true;
    const id = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(id);
  }, [open, threadKey]);

  useLayoutEffect(() => {
    if (!open || !stickToBottomRef.current) return;
    const el = listRef.current;
    if (!el) return;
    markProgrammaticScroll();
    pinToBottom(el);
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
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function copyAssistantMessage(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setError("Copy failed");
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;

    const snapshot = messages;
    const next: ChatTurn[] = [...messages, { role: "user", content }];
    onMessagesChange(next);
    setDraft("");
    setSending(true);
    setStreamingText("");
    streamPendingRef.current = "";
    streamLastPaintRef.current = 0;
    setError(null);
    stickToBottomRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let assembled = "";
    try {
      const full = await stream(
        next,
        (delta) => {
          assembled += delta;
          streamPendingRef.current = assembled;
          const now = performance.now();
          if (now - streamLastPaintRef.current < 32) {
            if (streamRafRef.current) return;
            streamRafRef.current = requestAnimationFrame(() => {
              streamRafRef.current = 0;
              streamLastPaintRef.current = performance.now();
              setStreamingText(streamPendingRef.current);
            });
            return;
          }
          if (streamRafRef.current) {
            cancelAnimationFrame(streamRafRef.current);
            streamRafRef.current = 0;
          }
          streamLastPaintRef.current = now;
          setStreamingText(assembled);
        },
        controller.signal,
      );
      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = 0;
      }
      const finalContent = assembled || full;
      if (!finalContent.trim()) {
        throw new Error("Empty reply from assistant");
      }
      setStreamingText("");
      streamPendingRef.current = "";
      setSending(false);
      stickToBottomRef.current = true;
      onMessagesChange([...next, { role: "assistant", content: finalContent }]);
    } catch (err) {
      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = 0;
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        setStreamingText("");
        streamPendingRef.current = "";
        setSending(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Chat failed");
      setStreamingText("");
      streamPendingRef.current = "";
      setSending(false);
      if (assembled.trim()) {
        onMessagesChange([...next, { role: "assistant", content: assembled }]);
      } else {
        onMessagesChange(snapshot);
      }
    }
  }

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
        aria-label={ariaLabel}
      >
        <header className="chat-header">
          <div>
            <p className="chat-kicker">{kicker}</p>
            <h2 className="chat-title">{title}</h2>
          </div>
          <button
            type="button"
            className="chat-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        {context ? (
          <p className="chat-context" title={context}>
            {context}
          </p>
        ) : null}

        <div
          className="chat-messages"
          ref={listRef}
          onScroll={() => {
            if (ignoringScrollRef.current) return;
            const el = listRef.current;
            if (!el) return;
            const distance =
              el.scrollHeight - el.scrollTop - el.clientHeight;
            if (stickToBottomRef.current) {
              if (distance > 24) stickToBottomRef.current = false;
            } else if (distance <= 16) {
              stickToBottomRef.current = true;
            }
          }}
          onWheel={(e) => {
            if (e.deltaY < 0) {
              stickToBottomRef.current = false;
              return;
            }
            requestAnimationFrame(() => {
              const el = listRef.current;
              if (!el || ignoringScrollRef.current) return;
              if (isNearBottom(el, 16)) stickToBottomRef.current = true;
            });
          }}
        >
          {messages.length === 0 && !sending && (
            <div className="chat-empty">
              <p>{emptyPrompt}</p>
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
            const copied = copiedIndex === i;
            return (
              <div
                key={`${m.role}-${i}`}
                className={`chat-bubble ${m.role}`}
              >
                {m.role === "assistant" ? (
                  <>
                    <ChatMarkdown>{m.content}</ChatMarkdown>
                    <div className="chat-bubble-actions">
                      <button
                        type="button"
                        className="chat-copy"
                        aria-label={copied ? "Copied" : "Copy reply"}
                        onClick={() => void copyAssistantMessage(i, m.content)}
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </>
                ) : (
                  m.content
                )}
              </div>
            );
          })}

          {sending && (
            <div
              className={`chat-bubble assistant streaming${streamingText.trim() ? "" : " pending"}`}
              aria-live="off"
            >
              {streamingText.trim() ? (
                <ChatMarkdown streaming>
                  {stabilizeStreamingMarkdown(streamingText)}
                </ChatMarkdown>
              ) : (
                <span className="chat-typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </div>
          )}
          <div className="chat-scroll-anchor" aria-hidden="true" />
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
            placeholder={placeholder}
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
            className="cta chat-send btn-with-icon"
            disabled={sending || !draft.trim()}
          >
            <SendHorizontal size={16} strokeWidth={2} aria-hidden="true" />
            Send
          </button>
        </form>
      </aside>
    </>
  );
}
