# Dropbrain

Drop anything in, quiz it into memory.

Paste text or a web URL, generate active-recall multiple-choice quizzes, and review what you miss.

## Stack

- Hono API on Cloudflare Workers
- React SPA + Vite (`@cloudflare/vite-plugin`)
- D1, Firecrawl Scrape API, DeepSeek

## Setup

Requires [pnpm](https://pnpm.io) and a global [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) CLI (`brew install wrangler` or `npm i -g wrangler`).

```bash
pnpm install
cp .dev.vars.example .dev.vars
# Fill DEEPSEEK_API_KEY
# FIRECRAWL_API_KEY is optional for testing, recommended for production.
pnpm run db:migrate:local
pnpm run dev
```

## API

- `POST /api/sources` `{ type: "text"|"url", content|url }`
- `POST /api/quizzes` `{ sourceId, count? }`
- `GET /api/quizzes/:id`
- `POST /api/quizzes/:id/submit` `{ answers: [{ questionId, choice }] }`
