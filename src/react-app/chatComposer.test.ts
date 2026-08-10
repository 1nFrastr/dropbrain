import { describe, expect, it } from "vitest";
import { isNearBottom, shouldSendOnEnter } from "./chatComposer";

describe("shouldSendOnEnter", () => {
  it("sends on plain Enter", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false, keyCode: 13 })).toBe(
      true,
    );
  });

  it("does not send on Shift+Enter", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: true, keyCode: 13 })).toBe(
      false,
    );
  });

  it("does not send while IME is composing", () => {
    expect(
      shouldSendOnEnter(
        { key: "Enter", shiftKey: false, keyCode: 13, isComposing: true },
        false,
      ),
    ).toBe(false);
    expect(
      shouldSendOnEnter(
        { key: "Enter", shiftKey: false, keyCode: 13 },
        true,
      ),
    ).toBe(false);
    expect(
      shouldSendOnEnter({
        key: "Enter",
        shiftKey: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSendOnEnter({ key: "a", shiftKey: false, keyCode: 65 })).toBe(
      false,
    );
  });
});

describe("isNearBottom", () => {
  it("detects sticky bottom", () => {
    expect(
      isNearBottom({ scrollHeight: 1000, scrollTop: 920, clientHeight: 80 }),
    ).toBe(true);
    expect(
      isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 80 }),
    ).toBe(false);
  });
});
