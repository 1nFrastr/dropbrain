# Dropbrain

Drop anything in, quiz it into memory.

Paste text or a web URL, generate active-recall multiple-choice quizzes, and review what you miss.

## Stack

- Hono API on Cloudflare Workers
- React SPA + Vite (`@cloudflare/vite-plugin`)
- D1, Browser Run (`quickAction("markdown")`), AI Gateway / Workers AI

## Setup

Requires [pnpm](https://pnpm.io) and a global [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) CLI (`brew install wrangler` or `npm i -g wrangler`).

```bash
pnpm install
cp .dev.vars.example .dev.vars
# Fill OPENAI_API_KEY + CF_ACCOUNT_ID (optional AI_GATEWAY_ID)
pnpm run db:migrate:local
pnpm run dev
```

For URL ingest via Browser Run Quick Actions, prefer:

```bash
wrangler dev --remote
```

(or use the Vite cloudflare plugin with remote bindings if configured).

## API

- `POST /api/sources` `{ type: "text"|"url", content|url }`
- `POST /api/quizzes` `{ sourceId, count? }`
- `GET /api/quizzes/:id`
- `POST /api/quizzes/:id/submit` `{ answers: [{ questionId, choice }] }`
