import type { Context } from "hono";

export const RATE_LIMITED_ERROR =
  "Too many requests. Please wait a minute and try again.";

export function clientRateLimitKey(c: Context): string {
  return c.req.header("cf-connecting-ip")?.trim() || "anonymous";
}
