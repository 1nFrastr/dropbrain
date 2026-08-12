interface Env {
  DB: D1Database;
  AI: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<{ response?: string } | string>;
  };
  FIRECRAWL_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CF_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  OPENAI_MODEL: string;
}
