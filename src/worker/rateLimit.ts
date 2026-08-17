import { cloudflareRateLimiter } from "@hono-rate-limiter/cloudflare";
import type { Context, Env } from "hono";
import { RATE_LIMITED_ERROR, clientRateLimitKey } from "./rateLimitKey";

export function cloudflareAiRateLimit<E extends Env>(
  rateLimitBinding: (c: Context<E>) => RateLimit,
) {
  return cloudflareRateLimiter<E>({
    rateLimitBinding,
    keyGenerator: clientRateLimitKey,
    message: { error: RATE_LIMITED_ERROR },
  });
}

