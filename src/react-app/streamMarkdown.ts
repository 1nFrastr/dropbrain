/**
 * Close incomplete Markdown constructs so partial streams render stably.
 * Without this, an open ``` fence makes the rest of the bubble jump every token.
 */
export function stabilizeStreamingMarkdown(text: string): string {
  let out = text;

  // Unclosed fenced code block (``` …)
  const fenceCount = out.match(/```/g)?.length ?? 0;
  if (fenceCount % 2 === 1) {
    out += "\n```";
  }

  // Outside fences: odd lone backticks turn the remainder into inline code.
  const withoutFences = out.replace(/```[\s\S]*?```/g, "");
  const inlineTicks = withoutFences.match(/`/g)?.length ?? 0;
  if (inlineTicks % 2 === 1) {
    out += "`";
  }

  // Unclosed bold/italic markers that commonly appear mid-stream.
  const boldCount = (out.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 1) {
    out += "**";
  }

  return out;
}
