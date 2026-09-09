# Security Policy

## Reporting a Vulnerability

If you discover a security issue, do not open a public issue.

Report privately to the maintainers with:
- Impact summary
- Reproduction steps
- Affected files and endpoints
- Suggested mitigation (if available)

## Response Targets

- Initial acknowledgment: within 3 business days
- Triage decision: within 7 business days
- Remediation timeline: based on severity and exploitability

## Secure Development Expectations

- Never commit secrets or API keys.
- Keep dependencies patched and review security advisories regularly.
- Validate and sanitize untrusted input at API boundaries.
- Log errors safely without leaking credentials or tokens.
