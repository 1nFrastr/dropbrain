import { describe, expect, it } from "vitest";
import { stabilizeStreamingMarkdown } from "./streamMarkdown";

describe("stabilizeStreamingMarkdown", () => {
  it("closes an open fenced code block", () => {
    const src = "Intro\n```ts\nconst x = 1;";
    const out = stabilizeStreamingMarkdown(src);
    expect(out.endsWith("\n```")).toBe(true);
    expect(out.match(/```/g)?.length).toBe(2);
  });

  it("leaves complete fences alone", () => {
    const src = "```js\nok\n```\nmore";
    expect(stabilizeStreamingMarkdown(src)).toBe(src);
  });

  it("closes an open inline code span", () => {
    expect(stabilizeStreamingMarkdown("use `foo")).toBe("use `foo`");
  });

  it("closes an open bold marker", () => {
    expect(stabilizeStreamingMarkdown("this is **bold")).toBe(
      "this is **bold**",
    );
  });
});
