import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientRateLimitKey } from "./rateLimitKey";

describe("clientRateLimitKey", () => {
  it("uses CF-Connecting-IP when present", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientRateLimitKey(c)));
    const res = await app.request("/", {
      headers: { "cf-connecting-ip": " 203.0.113.8 " },
    });
    expect(await res.text()).toBe("203.0.113.8");
  });

  it("falls back when the IP header is missing", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientRateLimitKey(c)));
    const res = await app.request("/");
    expect(await res.text()).toBe("anonymous");
  });
});
