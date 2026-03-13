# Query Analyzer Web App

Next.js application for SQL compare/analyze workflows, hardcode detection, and AI-assisted summaries.

## Engineering Commands

```bash
npm run dev
npm run lint
npm run lint:ci
npm run typecheck
npm run test
npm run build
npm run check
npm run start
```

`npm run check` is the local quality gate (`lint:ci + typecheck + test`).

## Runtime Configuration

Copy `.env.example` to `.env.local` and set environment values before local development:

- `OPENAI_API_KEY`
- `OPENAI_ASSISTANT_ID`
- `ANALYSIS_AGENT_ID`
- `HARDCODE_AGENT_ID`

## Architecture Boundaries

- `app/`: UI routes and API route handlers
- `app/api/*`: request validation + orchestration only
- `lib/query-differ.tsx`: SQL diff and alignment primitives
- `lib/server/http.ts`: shared API response/error/timeout helpers
- `lib/client/chatbot.ts`: typed assistant request client for UI surfaces
- `components/`: presentational and feature UI components
- `hooks/`: client state hooks (preferences, UI wiring)
- `tests/`: Node test-runner suites for shared utilities

## API Contract Notes

- API handlers return `Cache-Control: no-store`.
- Validation happens at route boundaries with `zod`.
- Error strings are sanitized before returning to clients.
- Existing response shapes remain backward compatible for current frontend consumers.
