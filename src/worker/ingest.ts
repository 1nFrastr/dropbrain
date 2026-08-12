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

/** Thrown when fetched/pasted material is empty, thin, or looks like an error page. */
export class UnusableSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableSourceError";
  }
}

/** Minimum plain-text characters required before quiz generation is worth attempting. */
export const MIN_USABLE_PLAIN_CHARS = 180;

const ERROR_PAGE_SIGNAL_RE =
  /\b(404|page not found|not found|access denied|forbidden|unauthorized|just a moment|attention required|enable javascript|please enable cookies|captcha|bot detection|sign in to continue|log in to continue|login required)\b/i;

/** Rough plain-text length after stripping common Markdown chrome. */
export function plainTextLength(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_\-|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Cheap post-fetch gate: reject empty/thin bodies and obvious error/login pages
 * before spending an LLM call.
 */
export function assertUsableSourceBody(markdown: string): void {
  const trimmed = markdown.trim();
  if (!trimmed) {
    throw new UnusableSourceError(
      "Could not extract readable content from this page (empty result).",
    );
  }

  const plainLen = plainTextLength(trimmed);
  if (plainLen < MIN_USABLE_PLAIN_CHARS) {
    throw new UnusableSourceError(
      "Page content is too short or thin to generate a quiz. Try another URL or paste the article text.",
    );
  }

  // Error/login walls are usually short; long articles that merely mention "404" pass.
  if (plainLen < 800 && ERROR_PAGE_SIGNAL_RE.test(trimmed)) {
    const head = trimmed.slice(0, 500);
    const looksLikeErrorPage =
      /^(#\s*)?(404|not found|page not found|access denied|forbidden|unauthorized)\b/im.test(
        head,
      ) ||
      (ERROR_PAGE_SIGNAL_RE.test(head) && plainLen < 400);
    if (looksLikeErrorPage) {
      throw new UnusableSourceError(
        "This page looks like an error, login, or blocked page rather than readable article content.",
      );
    }
  }
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

/** Strip YAML frontmatter and common page-chrome that pollutes quiz prompts. */
export function cleanPageMarkdown(markdown: string): string {
  let text = markdown.replace(/^\uFEFF/, "").trim();

  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      text = text.slice(end + 4).trim();
    }
  }

  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i += 1;
      continue;
    }
    const isSkip =
      /^\[Skip to (main )?content\]/i.test(line) ||
      /^\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)$/.test(line) ||
      /^!\[[^\]]*\]\([^)]+\)$/.test(line);
    if (isSkip) {
      i += 1;
      continue;
    }
    break;
  }

  text = lines.slice(i).join("\n").trim();

  // Prefer content from the first real H1 when chrome still precedes it.
  const h1 = text.match(/^#\s+.+$/m);
  if (h1?.index != null && h1.index > 0) {
    const before = text.slice(0, h1.index);
    const linkHeavy =
      (before.match(/\[[^\]]+\]\([^)]+\)/g)?.length ?? 0) >= 3 &&
      before.length < 4_000;
    if (linkHeavy) {
      text = text.slice(h1.index).trim();
    }
  }

  return text;
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

type FirecrawlResponse = {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
    };
  };
};

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

const inflightFetches = new Map<string, Promise<FetchedSource>>();

export async function fetchSource(
  apiKey: string | undefined,
  url: string,
): Promise<FetchedSource> {
  const normalized = normalizePageUrl(url);

  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (apiKey?.trim()) {
      headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    }

    const response = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: normalized,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    const raw = await response.text();
    let result: FirecrawlResponse;
    try {
      result = JSON.parse(raw) as FirecrawlResponse;
    } catch {
      throw new Error(
        `Firecrawl returned an invalid response (${response.status}).`,
      );
    }
    if (!response.ok || result.success === false) {
      throw new Error(
        result.error ||
          `Firecrawl request failed (${response.status}): ${raw.slice(0, 200)}`,
      );
    }

    const extracted = result.data?.markdown;
    if (typeof extracted !== "string") {
      throw new Error("Firecrawl returned no Markdown content.");
    }

    const markdown = cleanPageMarkdown(extracted);
    assertUsableSourceBody(markdown);
    const { text: body, truncated } = clampSourceBody(markdown);
    const metadataTitle = result.data?.metadata?.title?.trim();
    return {
      title: metadataTitle
        ? metadataTitle.slice(0, 200)
        : titleFromMarkdown(body, new URL(normalized).hostname),
      markdown: body,
      truncated,
    };
  } catch (err) {
    if (err instanceof UnusableSourceError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/rate.?limit|quota|429/i.test(message)) {
      throw new Error(
        "Firecrawl rate limit reached. Configure FIRECRAWL_API_KEY or try again later.",
      );
    }
    if (/unauthorized|authentication|401/i.test(message)) {
      throw new Error(
        "Firecrawl authentication failed. Check FIRECRAWL_API_KEY.",
      );
    }
    if (
      /timeout|blocked|403|captcha|anti.?bot/i.test(message)
    ) {
      throw new Error(`Failed to fetch page (blocked or timed out): ${normalized}`);
    }
    throw new Error(`Failed to fetch page: ${message}`);
  }
}

/** Deduplicate concurrent fetches for the same canonical URL within an isolate. */
export function fetchSourceDeduped(
  apiKey: string | undefined,
  url: string,
): Promise<FetchedSource> {
  const normalized = normalizePageUrl(url);
  const existing = inflightFetches.get(normalized);
  if (existing) return existing;

  const pending = fetchSource(apiKey, normalized).finally(() => {
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
  markdown: string;
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
        markdown: existing.body_md,
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
        markdown: raced.body_md,
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
    markdown: fetched.markdown,
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
