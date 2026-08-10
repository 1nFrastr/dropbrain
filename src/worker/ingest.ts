import { MAX_BODY_CHARS } from "./types";

export interface FetchedSource {
  title: string;
  markdown: string;
  truncated: boolean;
}

export type CachedSourceRow = {
  id: string;
  title: string;
  body_md: string;
};

export type UrlSourceStore = {
  findByUrl: (url: string) => Promise<CachedSourceRow | null>;
  insert: (row: {
    id: string;
    title: string;
    body_md: string;
    url: string;
  }) => Promise<void>;
};

/** Canonical URL used as the cache key for page fetches. */
export function normalizePageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Invalid URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must be http or https.");
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  // Drop default ports
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }
  return parsed.toString();
}

export function isTruncatedBody(markdown: string): boolean {
  return markdown.includes("[Content truncated for quiz generation.]");
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
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data as Record<string, unknown>;
      if (typeof data.result === "string") return data.result;
      if (typeof data.markdown === "string") return data.markdown;
    }
  }
  throw new Error("Unexpected Browser Run markdown response shape.");
}

const inflightFetches = new Map<string, Promise<FetchedSource>>();

export async function fetchSource(
  browser: Env["BROWSER"],
  url: string,
): Promise<FetchedSource> {
  const normalized = normalizePageUrl(url);

  try {
    const result = await browser.quickAction("markdown", {
      url: normalized,
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
      title: titleFromMarkdown(body, new URL(normalized).hostname),
      markdown: body,
      truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /timeout|blocked|403|401|captcha|anti.?bot|navigation/i.test(message)
    ) {
      throw new Error(`Failed to fetch page (blocked or timed out): ${normalized}`);
    }
    throw new Error(`Failed to fetch page: ${message}`);
  }
}

/** Deduplicate concurrent fetches for the same canonical URL within an isolate. */
export function fetchSourceDeduped(
  browser: Env["BROWSER"],
  url: string,
): Promise<FetchedSource> {
  const normalized = normalizePageUrl(url);
  const existing = inflightFetches.get(normalized);
  if (existing) return existing;

  const pending = fetchSource(browser, normalized).finally(() => {
    inflightFetches.delete(normalized);
  });
  inflightFetches.set(normalized, pending);
  return pending;
}

/** Clear in-flight map (tests only). */
export function clearInflightFetchesForTests() {
  inflightFetches.clear();
}

export async function resolveUrlSource(
  store: UrlSourceStore,
  fetchPage: (url: string) => Promise<FetchedSource>,
  rawUrl: string,
  newId: () => string = () => crypto.randomUUID(),
): Promise<{
  sourceId: string;
  title: string;
  truncated: boolean;
  cached: boolean;
}> {
  const url = normalizePageUrl(rawUrl);
  const existing = await store.findByUrl(url);
  if (existing) {
    return {
      sourceId: existing.id,
      title: existing.title,
      truncated: isTruncatedBody(existing.body_md),
      cached: true,
    };
  }

  const fetched = await fetchPage(url);

  // Another request may have inserted while we were fetching.
  const raced = await store.findByUrl(url);
  if (raced) {
    return {
      sourceId: raced.id,
      title: raced.title,
      truncated: isTruncatedBody(raced.body_md),
      cached: true,
    };
  }

  const id = newId();
  await store.insert({
    id,
    title: fetched.title,
    body_md: fetched.markdown,
    url,
  });

  return {
    sourceId: id,
    title: fetched.title,
    truncated: fetched.truncated,
    cached: false,
  };
}

export function d1UrlSourceStore(db: D1Database): UrlSourceStore {
  return {
    async findByUrl(url) {
      return (
        (await db
          .prepare(
            `SELECT id, title, body_md FROM sources
             WHERE type = 'url' AND url = ?
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .bind(url)
          .first<CachedSourceRow>()) ?? null
      );
    },
    async insert(row) {
      await db
        .prepare(
          `INSERT INTO sources (id, type, title, body_md, url)
           VALUES (?, 'url', ?, ?, ?)`,
        )
        .bind(row.id, row.title, row.body_md, row.url)
        .run();
    },
  };
}
