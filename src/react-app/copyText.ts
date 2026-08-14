/**
 * Copy text to the clipboard in a way that still works on mobile Safari.
 *
 * `navigator.clipboard.writeText` is async and is often rejected on iOS
 * (especially while a focused textarea is dismissing the keyboard).
 * `document.execCommand("copy")` must run synchronously inside the user
 * gesture, so try that first and only then fall back to the Clipboard API.
 */
export async function copyText(text: string): Promise<void> {
  if (copyTextWithExecCommand(text)) return;

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText && globalThis.isSecureContext) {
    await clipboard.writeText(text);
    return;
  }

  throw new Error("Copy failed");
}

/** True for touch/pen so copy can run before a focused composer swallows click. */
export function shouldCopyOnPointerDown(e: {
  button: number;
  pointerType: string;
}): boolean {
  return e.button === 0 && (e.pointerType === "touch" || e.pointerType === "pen");
}

export function copyTextWithExecCommand(text: string): boolean {
  const doc = globalThis.document;
  if (
    !doc?.body ||
    typeof doc.execCommand !== "function" ||
    typeof doc.createRange !== "function"
  ) {
    return false;
  }

  const mark = doc.createElement("span");
  mark.textContent = text;
  mark.setAttribute("aria-hidden", "true");
  mark.setAttribute("contenteditable", "true");
  mark.style.cssText =
    "all:unset;position:fixed;top:0;left:0;clip:rect(0,0,0,0);white-space:pre;-webkit-user-select:text;user-select:text;";

  const selection = doc.getSelection?.() ?? null;
  const previousRange =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null;

  doc.body.appendChild(mark);

  let ok = false;
  try {
    const range = doc.createRange();
    range.selectNodeContents(mark);
    selection?.removeAllRanges();
    selection?.addRange(range);
    ok = doc.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    mark.remove();
    if (selection) {
      selection.removeAllRanges();
      if (previousRange) selection.addRange(previousRange);
    }
  }

  return ok;
}
