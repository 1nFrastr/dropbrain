import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearInflightFetchesForTests,
  isTruncatedBody,
  normalizePageUrl,
  normalizeTextSource,
  resolveUrlSource,
  type CachedSourceRow,
  type FetchedSource,
  type UrlSourceStore,
} from "./ingest";
import { MAX_BODY_CHARS } from "./types";

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

function memoryStore(seed: CachedSourceRow[] = []): UrlSourceStore & {
  rows: Map<string, CachedSourceRow & { url: string }>;
} {
  const rows = new Map(
    seed.map((r) => [r.id, { ...r, url: "https://example.com" }]),
  );
  return {
    rows,
    async findByUrl(url) {
      for (const row of rows.values()) {
        if (row.url === url) {
          return { id: row.id, title: row.title, body_md: row.body_md };
        }
      }
      return null;
    },
    async insert(row) {
      rows.set(row.id, {
        id: row.id,
        title: row.title,
        body_md: row.body_md,
        url: row.url,
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
      },
    ]);
    // seed url key used by findByUrl
    store.rows.set("cached-1", {
      id: "cached-1",
      title: "Cached page",
      body_md: "# Cached page\n\nHello",
      url: "https://example.com/doc",
    });

    const fetchPage = vi.fn(async (): Promise<FetchedSource> => {
      throw new Error("should not fetch");
    });

    const result = await resolveUrlSource(
      store,
      fetchPage,
      "https://EXAMPLE.com/doc/",
    );

    expect(result).toEqual({
      sourceId: "cached-1",
      title: "Cached page",
      truncated: false,
      cached: true,
    });
    expect(fetchPage).not.toHaveBeenCalled();
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
