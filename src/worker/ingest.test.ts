import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearInflightFetchesForTests,
  isTruncatedBody,
  isUrlSourceCacheFresh,
  normalizePageUrl,
  normalizeTextSource,
  resolveUrlSource,
  type CachedSourceRow,
  type FetchedSource,
  type UrlSourceStore,
} from "./ingest";
import { MAX_BODY_CHARS, SOURCE_URL_CACHE_TTL_DAYS } from "./types";

describe("normalizePageUrl", () => {
  it("lowercases host and strips hash / trailing slash", () => {
    expect(normalizePageUrl("HTTPS://Example.COM/Path/#frag")).toBe(
      "https://example.com/Path",
    );
  });

  it("keeps query string", () => {
    expect(normalizePageUrl("https://example.com/a?x=1")).toBe(
      "https://example.com/a?x=1",
    );
  });

  it("rejects non-http protocols", () => {
    expect(() => normalizePageUrl("ftp://example.com")).toThrow(/http/i);
  });

  it("rejects empty / invalid input", () => {
    expect(() => normalizePageUrl("")).toThrow(/invalid/i);
    expect(() => normalizePageUrl("not a url")).toThrow(/invalid/i);
  });
});

describe("normalizeTextSource", () => {
  it("uses markdown heading as title", () => {
    const src = normalizeTextSource("# Hello\n\nBody text here that is long enough.");
    expect(src.title).toBe("Hello");
    expect(src.truncated).toBe(false);
  });

  it("rejects empty text", () => {
    expect(() => normalizeTextSource("   ")).toThrow(/empty/i);
  });

  it("truncates oversized bodies", () => {
    const huge = "x".repeat(MAX_BODY_CHARS + 50);
    const src = normalizeTextSource(huge);
    expect(src.truncated).toBe(true);
    expect(isTruncatedBody(src.markdown)).toBe(true);
    expect(src.markdown.length).toBeLessThan(huge.length);
  });
});

describe("isUrlSourceCacheFresh", () => {
  const now = Date.parse("2026-08-11T12:00:00Z");

  it("treats recent sqlite timestamps as fresh", () => {
    expect(isUrlSourceCacheFresh("2026-08-10 12:00:00", now)).toBe(true);
  });

  it("expires after the configured TTL", () => {
    const stale = new Date(
      now - (SOURCE_URL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000 + 1),
    )
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    expect(isUrlSourceCacheFresh(stale, now)).toBe(false);
  });
});

function memoryStore(
  seed: Array<CachedSourceRow & { url: string }> = [],
): UrlSourceStore & {
  rows: Map<string, CachedSourceRow & { url: string }>;
} {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  return {
    rows,
    async findByUrl(url) {
      let best: (CachedSourceRow & { url: string }) | null = null;
      for (const row of rows.values()) {
        if (row.url !== url) continue;
        if (!best || row.created_at > best.created_at) best = row;
      }
      return best
        ? {
            id: best.id,
            title: best.title,
            body_md: best.body_md,
            created_at: best.created_at,
          }
        : null;
    },
    async insert(row) {
      rows.set(row.id, {
        id: row.id,
        title: row.title,
        body_md: row.body_md,
        url: row.url,
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    },
  };
}

describe("resolveUrlSource cache", () => {
  beforeEach(() => {
    clearInflightFetchesForTests();
  });

  it("returns cached source without fetching", async () => {
    const store = memoryStore([
      {
        id: "cached-1",
        title: "Cached page",
        body_md: "# Cached page\n\nHello",
        url: "https://example.com/doc",
        created_at: "2026-08-10 12:00:00",
      },
    ]);

    const fetchPage = vi.fn(async (): Promise<FetchedSource> => {
      throw new Error("should not fetch");
    });

    const result = await resolveUrlSource(
      store,
      fetchPage,
      "https://EXAMPLE.com/doc/",
      () => crypto.randomUUID(),
      { nowMs: () => Date.parse("2026-08-11T12:00:00Z") },
    );

    expect(result).toEqual({
      sourceId: "cached-1",
      title: "Cached page",
      truncated: false,
      cached: true,
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("refetches when the cached row is older than TTL", async () => {
    const store = memoryStore([
      {
        id: "stale-1",
        title: "Stale page",
        body_md: "# Stale",
        url: "https://example.com/doc",
        created_at: "2026-07-01 12:00:00",
      },
    ]);
    const fetchPage = vi.fn(async (): Promise<FetchedSource> => ({
      title: "Fresh",
      markdown: "# Fresh",
      truncated: false,
    }));

    const result = await resolveUrlSource(
      store,
      fetchPage,
      "https://example.com/doc",
      () => "fresh-id",
      { nowMs: () => Date.parse("2026-08-11T12:00:00Z") },
    );

    expect(result).toMatchObject({
      sourceId: "fresh-id",
      cached: false,
      title: "Fresh",
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("skips cache when useCache is false", async () => {
    const store = memoryStore([
      {
        id: "cached-1",
        title: "Cached page",
        body_md: "# Cached",
        url: "https://example.com/doc",
        created_at: "2026-08-10 12:00:00",
      },
    ]);
    const fetchPage = vi.fn(async (): Promise<FetchedSource> => ({
      title: "Forced",
      markdown: "# Forced",
      truncated: false,
    }));

    const result = await resolveUrlSource(
      store,
      fetchPage,
      "https://example.com/doc",
      () => "forced-id",
      {
        useCache: false,
        nowMs: () => Date.parse("2026-08-11T12:00:00Z"),
      },
    );

    expect(result).toMatchObject({
      sourceId: "forced-id",
      cached: false,
      title: "Forced",
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fetches once and inserts when cache misses", async () => {
    const store = memoryStore();
    const fetchPage = vi.fn(async (): Promise<FetchedSource> => ({
      title: "Fresh",
      markdown: "# Fresh\n\nBody",
      truncated: false,
    }));

    const result = await resolveUrlSource(
      store,
      fetchPage,
      "https://example.com/new",
      () => "new-id",
    );

    expect(result.cached).toBe(false);
    expect(result.sourceId).toBe("new-id");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(store.rows.get("new-id")?.url).toBe("https://example.com/new");
  });

  it("reuses row inserted by a concurrent writer after fetch", async () => {
    const store = memoryStore();
    const fetchPage = vi.fn(async (url: string): Promise<FetchedSource> => {
      await store.insert({
        id: "racer",
        title: "Racer",
        body_md: "from racer",
        url,
      });
      return { title: "Mine", markdown: "mine", truncated: false };
    });

    const result = await resolveUrlSource(
      store,
      fetchPage,
      "https://example.com/race",
      () => "should-not-use",
    );

    expect(result).toMatchObject({
      sourceId: "racer",
      title: "Racer",
      cached: true,
    });
    expect(store.rows.has("should-not-use")).toBe(false);
  });
});
