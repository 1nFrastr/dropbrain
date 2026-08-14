import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyText,
  copyTextWithExecCommand,
  shouldCopyOnPointerDown,
} from "./copyText";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeMark() {
  const mark = {
    textContent: "",
    style: { cssText: "" },
    setAttribute: vi.fn(),
    remove: vi.fn(),
  };
  return mark;
}

function stubCopyDom(options: {
  execCommandResult?: boolean;
  execCommandThrows?: boolean;
  hasExecCommand?: boolean;
  hasCreateRange?: boolean;
  hasBody?: boolean;
}) {
  const mark = fakeMark();
  const selection = {
    rangeCount: 0,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
    getRangeAt: vi.fn(),
  };
  const range = {
    selectNodeContents: vi.fn(),
    cloneRange: vi.fn(),
  };
  const execCommand = vi.fn(() => {
    if (options.execCommandThrows) throw new Error("denied");
    return options.execCommandResult ?? true;
  });
  const body = options.hasBody === false ? undefined : {
    appendChild: vi.fn(),
  };
  const doc: Record<string, unknown> = {
    body,
    createElement: vi.fn(() => mark),
    getSelection: vi.fn(() => selection),
  };
  if (options.hasExecCommand !== false) doc.execCommand = execCommand;
  if (options.hasCreateRange !== false) {
    doc.createRange = vi.fn(() => range);
  }
  vi.stubGlobal("document", doc);
  return { mark, selection, range, execCommand, body };
}

describe("shouldCopyOnPointerDown", () => {
  it("copies on primary touch and pen, not mouse", () => {
    expect(
      shouldCopyOnPointerDown({ button: 0, pointerType: "touch" }),
    ).toBe(true);
    expect(
      shouldCopyOnPointerDown({ button: 0, pointerType: "pen" }),
    ).toBe(true);
    expect(
      shouldCopyOnPointerDown({ button: 0, pointerType: "mouse" }),
    ).toBe(false);
    expect(
      shouldCopyOnPointerDown({ button: 2, pointerType: "touch" }),
    ).toBe(false);
  });
});

describe("copyTextWithExecCommand", () => {
  it("returns false when document APIs are missing", () => {
    vi.stubGlobal("document", undefined);
    expect(copyTextWithExecCommand("hi")).toBe(false);
  });

  it("selects a hidden node and runs execCommand('copy')", () => {
    const { mark, range, execCommand } = stubCopyDom({
      execCommandResult: true,
    });
    expect(copyTextWithExecCommand("hello")).toBe(true);
    expect(mark.textContent).toBe("hello");
    expect(range.selectNodeContents).toHaveBeenCalledWith(mark);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(mark.remove).toHaveBeenCalled();
  });

  it("returns false when execCommand throws", () => {
    stubCopyDom({ execCommandThrows: true });
    expect(copyTextWithExecCommand("hello")).toBe(false);
  });
});

describe("copyText", () => {
  it("does not call the Clipboard API when execCommand succeeds", async () => {
    stubCopyDom({ execCommandResult: true });
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("isSecureContext", true);

    await copyText("copied");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to clipboard.writeText when execCommand fails", async () => {
    stubCopyDom({ execCommandResult: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("isSecureContext", true);

    await copyText("fallback");
    expect(writeText).toHaveBeenCalledWith("fallback");
  });

  it("throws when no copy method works", async () => {
    stubCopyDom({ hasBody: false });
    vi.stubGlobal("navigator", { clipboard: undefined });
    vi.stubGlobal("isSecureContext", true);

    await expect(copyText("nope")).rejects.toThrow(/Copy failed/);
  });
});
