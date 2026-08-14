import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clampQuizCount,
  loadConfirmBeforeGen,
  loadQuizCount,
  saveConfirmBeforeGen,
  saveQuizCount,
} from "./homePrefs";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
    },
  });
});

afterEach(() => {
  memory.clear();
});

describe("clampQuizCount", () => {
  it("keeps values in 5..10", () => {
    expect(clampQuizCount(5)).toBe(5);
    expect(clampQuizCount(10)).toBe(10);
    expect(clampQuizCount(3)).toBe(5);
    expect(clampQuizCount(12)).toBe(10);
    expect(clampQuizCount("8")).toBe(8);
    expect(clampQuizCount("nope")).toBe(8);
  });
});

describe("quiz count preference", () => {
  it("defaults to 8 and remembers the last value", () => {
    expect(loadQuizCount()).toBe(8);
    saveQuizCount(6);
    expect(loadQuizCount()).toBe(6);
  });
});

describe("confirm-before-gen preference", () => {
  it("defaults off and persists", () => {
    expect(loadConfirmBeforeGen()).toBe(false);
    saveConfirmBeforeGen(true);
    expect(loadConfirmBeforeGen()).toBe(true);
    saveConfirmBeforeGen(false);
    expect(loadConfirmBeforeGen()).toBe(false);
  });
});
