import { describe, expect, it } from "vitest";
import {
  clampSourceBody,
  clampText,
  isTruncatedSourceBody,
  MAX_BODY_CHARS,
  SOURCE_BODY_TRUNCATION_MARKER,
} from "./limits";

describe("clampText", () => {
  it("leaves short text unchanged", () => {
    expect(clampText("hello", 10)).toEqual({
      text: "hello",
      truncated: false,
    });
  });

  it("keeps total length within maxChars", () => {
    const { text, truncated } = clampText("abcdefghij", 8, "…");
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(8);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("clampSourceBody", () => {
  it("marks and bounds oversized bodies", () => {
    const huge = "x".repeat(MAX_BODY_CHARS + 200);
    const { text, truncated } = clampSourceBody(huge);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(isTruncatedSourceBody(text)).toBe(true);
    expect(text.includes(SOURCE_BODY_TRUNCATION_MARKER)).toBe(true);
  });
});
