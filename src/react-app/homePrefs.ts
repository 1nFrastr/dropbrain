import {
  DEFAULT_QUIZ_COUNT,
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
} from "../worker/types";

export { DEFAULT_QUIZ_COUNT, MAX_QUIZ_COUNT, MIN_QUIZ_COUNT };

const COUNT_KEY = "dropbrain_quiz_count";
const CONFIRM_KEY = "dropbrain_confirm_before_gen";

export function clampQuizCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return DEFAULT_QUIZ_COUNT;
  return Math.min(MAX_QUIZ_COUNT, Math.max(MIN_QUIZ_COUNT, n));
}

export function loadQuizCount(): number {
  try {
    const raw = localStorage.getItem(COUNT_KEY);
    if (raw == null) return DEFAULT_QUIZ_COUNT;
    return clampQuizCount(Number(raw));
  } catch {
    return DEFAULT_QUIZ_COUNT;
  }
}

export function saveQuizCount(count: number) {
  try {
    localStorage.setItem(COUNT_KEY, String(clampQuizCount(count)));
  } catch {
    /* ignore */
  }
}

export function loadConfirmBeforeGen(): boolean {
  try {
    return localStorage.getItem(CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveConfirmBeforeGen(on: boolean) {
  try {
    localStorage.setItem(CONFIRM_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
