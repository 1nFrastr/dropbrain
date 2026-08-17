interface Env {
  DB: D1Database;
  FIRECRAWL_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL: string;
  RATE_LIMITER_QUIZ: RateLimit;
  RATE_LIMITER_CHAT: RateLimit;
}
