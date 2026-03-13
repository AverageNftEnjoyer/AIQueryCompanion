# Contributing

## Workflow

1. Create a feature branch from `main`.
2. Keep changes scoped to one objective.
3. Run quality checks locally before opening a PR.
4. Open a pull request with a clear summary and test notes.

## Local Validation

From `my-app/`:

```bash
npm ci
npm run lint:ci
npm run typecheck
npm run test
npm run build
```

## Pull Request Expectations

- Explain what changed and why.
- List risks and rollback notes for non-trivial changes.
- Include screenshots for UI updates.
- Ensure no secrets or credentials are included.
