import {
  clampSourceBody,
  isTruncatedSourceBody,
} from "../shared/limits";
import { SOURCE_URL_CACHE_TTL_DAYS } from "./types";

export interface FetchedSource {
  title: string;
  markdown: string;
  truncated: boolean;
}

export type CachedSourceRow = {
  id: string;
  title: string;
  body_md: string;
  created_at: string;
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

export type ResolveUrlSourceOptions = {
  /** When false, always re-fetch and insert a new source row. Default true. */
  useCache?: boolean;
  /** Injectable clock for tests (unix ms). */
  nowMs?: () => number;
};

/** Whether a cached URL source is still within the configured TTL. */
export function isUrlSourceCacheFresh(
  createdAt: string,
  nowMs: number = Date.now(),
  ttlDays: number = SOURCE_URL_CACHE_TTL_DAYS,
): boolean {
  const createdMs = Date.parse(
    /Z$|[+-]\d{2}:?\d{2}$/.test(createdAt) ? createdAt : `${createdAt}Z`,
  );
  if (Number.isNaN(createdMs)) return false;
  return nowMs - createdMs < ttlDays * 24 * 60 * 60 * 1000;
}

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
  return isTruncatedSourceBody(markdown);
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
  const { text: body, truncated } = clampSourceBody(cleaned);
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
    const { text: body, truncated } = clampSourceBody(markdown);
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
  options: ResolveUrlSourceOptions = {},
): Promise<{
  sourceId: string;
  title: string;
  truncated: boolean;
  cached: boolean;
}> {
  const useCache = options.useCache !== false;
  const nowMs = options.nowMs ?? Date.now;
  const url = normalizePageUrl(rawUrl);

  if (useCache) {
    const existing = await store.findByUrl(url);
    if (existing && isUrlSourceCacheFresh(existing.created_at, nowMs())) {
      return {
        sourceId: existing.id,
        title: existing.title,
        truncated: isTruncatedBody(existing.body_md),
        cached: true,
      };
    }
  }

  const fetched = await fetchPage(url);

  // Another request may have inserted a fresh row while we were fetching.
  if (useCache) {
    const raced = await store.findByUrl(url);
    if (raced && isUrlSourceCacheFresh(raced.created_at, nowMs())) {
      return {
        sourceId: raced.id,
        title: raced.title,
        truncated: isTruncatedBody(raced.body_md),
        cached: true,
      };
    }
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
            `SELECT id, title, body_md, created_at FROM sources
             WHERE type = 'url' AND url = ?
               AND created_at >= datetime('now', ?)
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .bind(url, `-${SOURCE_URL_CACHE_TTL_DAYS} days`)
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
