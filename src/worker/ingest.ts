import { MAX_BODY_CHARS } from "./types";

export interface FetchedSource {
  title: string;
  markdown: string;
  truncated: boolean;
}

function truncateBody(markdown: string): { body: string; truncated: boolean } {
  if (markdown.length <= MAX_BODY_CHARS) {
    return { body: markdown, truncated: false };
  }
  return {
    body:
      markdown.slice(0, MAX_BODY_CHARS) +
      "\n\n…\n[Content truncated for quiz generation.]",
    truncated: true,
  };
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading?.[1]) {
    return heading[1].trim().slice(0, 200);
  }
  const firstLine = markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (firstLine ?? fallback).replace(/^#+\s*/, "").slice(0, 200);
}

export function normalizeTextSource(content: string): FetchedSource {
  const cleaned = content.trim();
  if (!cleaned) {
    throw new Error("Text content is empty.");
  }
  const { body, truncated } = truncateBody(cleaned);
  return {
    title: titleFromMarkdown(body, "Pasted text"),
    markdown: body,
    truncated,
  };
}

async function extractMarkdownResult(result: unknown): Promise<string> {
  if (result instanceof Response) {
    const text = await result.text();
    if (!result.ok) {
      throw new Error(
        `Browser Run request failed (${result.status}): ${text.slice(0, 200)}`,
      );
    }
    try {
      result = JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.result === "string") {
      return obj.result;
    }
    if (typeof obj.markdown === "string") {
      return obj.markdown;
    }
    if (typeof obj.content === "string") {
      return obj.content;
    }
    // Some bindings return Response-like or nested shapes
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data as Record<string, unknown>;
      if (typeof data.result === "string") return data.result;
      if (typeof data.markdown === "string") return data.markdown;
    }
  }
  throw new Error("Unexpected Browser Run markdown response shape.");
}

export async function fetchSource(
  browser: Env["BROWSER"],
  url: string,
): Promise<FetchedSource> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must be http or https.");
  }

  try {
    const result = await browser.quickAction("markdown", {
      url: parsed.toString(),
      gotoOptions: { waitUntil: "networkidle2" },
    });
    const markdown = (await extractMarkdownResult(result)).trim();
    if (!markdown) {
      throw new Error(
        "Could not extract readable content from this page (empty result).",
      );
    }
    const { body, truncated } = truncateBody(markdown);
    return {
      title: titleFromMarkdown(body, parsed.hostname),
      markdown: body,
      truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /timeout|blocked|403|401|captcha|anti.?bot|navigation/i.test(message)
    ) {
      throw new Error(
        `Failed to fetch page (blocked or timed out): ${parsed.toString()}`,
      );
    }
    throw new Error(`Failed to fetch page: ${message}`);
  }
}
