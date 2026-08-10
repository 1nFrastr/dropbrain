interface Env {
  DB: D1Database;
  BROWSER: {
    quickAction(
      action:
        | "markdown"
        | "screenshot"
        | "content"
        | "pdf"
        | "json"
        | "scrape"
        | "links"
        | "snapshot",
      options: Record<string, unknown>,
    ): Promise<unknown>;
  };
  AI: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<{ response?: string } | string>;
  };
  OPENAI_API_KEY?: string;
  CF_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  OPENAI_MODEL: string;
}
