/** Parse one or more SSE `data:` frames from a buffer chunk. */
export function consumeSseFrames(buffer: string): {
  rest: string;
  events: Array<Record<string, unknown>>;
} {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    const line = part
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!line) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as Record<string, unknown>);
    } catch {
      /* skip malformed */
    }
  }

  return { rest, events };
}
