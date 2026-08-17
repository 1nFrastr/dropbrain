import { describe, expect, it } from "vitest";
import { consumeSseFrames } from "./sse";

/**
 * Mirrors the frontend stream accumulator used by streamChatAboutQuestion.
 * Ensures multi-frame SSE payloads reassemble into the full assistant reply.
 */
function accumulateChatSse(chunks: string[]): {
  text: string;
  truncated: boolean;
} {
  let buffer = "";
  let full = "";
  let truncated = false;
  for (const chunk of chunks) {
    buffer += chunk;
    const { rest, events } = consumeSseFrames(buffer);
    buffer = rest;
    for (const event of events) {
      if (typeof event.error === "string" && event.error) {
        throw new Error(event.error);
      }
      if (event.truncated === true) truncated = true;
      if (typeof event.delta === "string" && event.delta) {
        full += event.delta;
      }
    }
  }
  return { text: full, truncated };
}

describe("chat SSE client accumulation", () => {
  it("rebuilds a streamed reply from split frames", () => {
    const frames = [
      'data: {"delta":"控制"}\n\n',
      'data: {"delta":"器会"}\n\ndata: {"delta":"调',
      '用 Reconcile"}\n\ndata: {"done":true}\n\n',
    ];
    expect(accumulateChatSse(frames).text).toBe("控制器会调用 Reconcile");
  });

  it("throws when the server sends an error frame", () => {
    expect(() =>
      accumulateChatSse(['data: {"error":"Chat failed"}\n\n']),
    ).toThrow(/Chat failed/);
  });

  it("records a truncated frame without dropping the reply", () => {
    expect(
      accumulateChatSse([
        'data: {"delta":"答案"}\n\n',
        'data: {"truncated":true}\n\n',
        'data: {"done":true}\n\n',
      ]),
    ).toEqual({ text: "答案", truncated: true });
  });
});
