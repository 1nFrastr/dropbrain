import { describe, expect, it } from "vitest";
import {
  askAnythingSuggestions,
  chatSuggestions,
  chatTruncatedHint,
  detectOsLanguage,
} from "./i18n";
import { consumeSseFrames } from "./sse";

describe("detectOsLanguage", () => {
  it("returns zh when navigator language is Chinese", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "zh-CN", languages: ["zh-CN", "en"] },
    });
    expect(detectOsLanguage()).toBe("zh");
  });

  it("returns en otherwise", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US", languages: ["en-US"] },
    });
    expect(detectOsLanguage()).toBe("en");
  });
});

describe("chatSuggestions", () => {
  it("returns Chinese suggestions for zh", () => {
    expect(chatSuggestions("zh")[0]).toMatch(/为什么|正确/);
  });

  it("returns English suggestions for en", () => {
    expect(chatSuggestions("en")[0]).toMatch(/Why/i);
  });
});

describe("askAnythingSuggestions", () => {
  it("returns localized open prompts", () => {
    expect(askAnythingSuggestions("zh").length).toBeGreaterThan(0);
    expect(askAnythingSuggestions("en")[0]).toMatch(/Explain|Quiz|remember/i);
  });
});

describe("consumeSseFrames", () => {
  it("parses complete frames and keeps remainder", () => {
    const { rest, events } = consumeSseFrames(
      'data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\ndata: {"delta":"吗',
    );
    expect(events).toEqual([{ delta: "你" }, { delta: "好" }]);
    expect(rest).toBe('data: {"delta":"吗');
  });

  it("surfaces error events", () => {
    const { events } = consumeSseFrames('data: {"error":"boom"}\n\n');
    expect(events[0]).toEqual({ error: "boom" });
  });
});

describe("chatTruncatedHint", () => {
  it("matches the content language", () => {
    expect(chatTruncatedHint("zh")).toMatch(/截断/);
    expect(chatTruncatedHint("en")).toMatch(/cut off/i);
  });
});
