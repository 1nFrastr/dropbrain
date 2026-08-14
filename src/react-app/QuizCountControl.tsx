import { useEffect, useState } from "react";
import {
  clampQuizCount,
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
} from "./homePrefs";

const COLLAPSE_MS = 3000;

type Props = {
  id: string;
  value: number;
  disabled?: boolean;
  onChange: (next: number) => void;
};

export default function QuizCountControl({
  id,
  value,
  disabled = false,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!open) {
      setHeld(false);
      return;
    }
    if (held) return;
    const timer = window.setTimeout(() => setOpen(false), COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, held, value]);

  useEffect(() => {
    if (!held) return;
    function release() {
      setHeld(false);
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [held]);

  return (
    <div className={`tune-slider${open ? " open" : ""}`}>
      <button
        type="button"
        className="tune-chip"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="tune-count">{value}</span>
        <span className="tune-label">Questions</span>
      </button>
      <div className="tune-range-wrap" aria-hidden={!open}>
        <div className="tune-range-inner">
          <input
            id={id}
            className="tune-range"
            type="range"
            min={MIN_QUIZ_COUNT}
            max={MAX_QUIZ_COUNT}
            step={1}
            value={value}
            disabled={disabled || !open}
            tabIndex={open ? 0 : -1}
            onChange={(e) => onChange(clampQuizCount(Number(e.target.value)))}
            onPointerDown={() => setHeld(true)}
            aria-label="Number of questions"
          />
        </div>
      </div>
    </div>
  );
}
