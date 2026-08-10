/** Whether Enter should send (ignore Shift+Enter and IME composition). */
export function shouldSendOnEnter(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "keyCode" | "isComposing"> & {
    nativeEvent?: { isComposing?: boolean };
  },
  composing = false,
): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (composing) return false;
  if (e.isComposing || e.nativeEvent?.isComposing) return false;
  // Legacy IME: browsers may fire keyCode 229 during composition
  if (e.keyCode === 229) return false;
  return true;
}

/** True when the scroll container is near the bottom (sticky follow). */
export function isNearBottom(
  el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  thresholdPx = 80,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}
