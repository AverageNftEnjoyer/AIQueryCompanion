# Query Analyzer

Query Analyzer is a production-oriented Next.js application for SQL comparison, AI-assisted analysis, hardcode detection, and stakeholder/developer summaries.

## Why This Repo Exists

Engineering teams use this tool to:
- Compare old vs new SQL and inspect differences quickly.
- Generate AI explanations for query changes and likely impact.
- Run hardcode and environment-sensitivity checks.
- Create summaries for technical and non-technical audiences.

## Repository Structure

- `my-app/`: Next.js application (UI, API routes, core logic)
- `README.md`: Project-level guide
- `CONTRIBUTING.md`: Contribution workflow
- `SECURITY.md`: Vulnerability reporting and secure development expectations

## Quick Start

Prerequisites:
- Node.js 20+
- npm 10+

Setup:

```bash
git clone <your-repo-url>
cd QueryAnalyzer/my-app
npm ci
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:3000`.

## Quality Gates

From `my-app/`:

```bash
npm run lint:ci
npm run typecheck
npm run test
npm run build
```

CI runs these checks on every push and pull request.

## Environment Configuration

Copy `my-app/.env.example` to `my-app/.env.local` and set values for your OpenAI/Azure configuration.

## Security

- Never commit secrets (`.env.local` stays local).
- Use least-privilege API credentials.
- Follow `SECURITY.md` for reporting and remediation workflow.

## License

No license is currently declared. Add one before external distribution.
