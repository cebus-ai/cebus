# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Cebus, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@cebus.ai** (or open a private security advisory via GitHub's [Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) feature on this repository).

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix or mitigation**: Depending on severity, typically within 30 days

## Security Practices

### API Keys and Secrets

- API keys are loaded from environment variables at runtime and **never** logged, stored on disk, or transmitted to third parties.
- The `.env` file is listed in `.gitignore` and is never committed to the repository.
- Debug logging (`CEBUS_DEBUG=1`) writes to `.cebus/debug.log` and **excludes** API keys, tokens, and message content.
- The `.cebus/` directory is listed in `.gitignore`.

### Dependencies

- Dependencies are pinned to specific major versions in `package.json`.
- Run `npm audit` regularly to check for known vulnerabilities.
- CI runs `npm audit --audit-level=high` on every pull request.

### Data Handling

- Cebus runs as a CLI tool locally on your machine, or as a web application with a local server.
- Messages are sent directly to the configured AI provider APIs (OpenAI, Anthropic, Google, GitHub, Ollama).
- No telemetry, analytics, or usage data is collected by Cebus itself.
- Session persistence files are stored locally in `.cebus/` and are not transmitted anywhere.
- The web UI communicates with the local server via tRPC and WebSocket (no external data transmission).
- Ollama runs entirely on your local machine with no external network calls.

### MCP Tool Execution

- MCP (Model Context Protocol) tools require explicit user approval before execution.
- A circuit breaker pattern prevents runaway tool invocations.
- Tool approval can be configured per-session.

## Security Rules (Enforced When Writing Code)

These rules are **mandatory** for all code changes. Violations must be fixed before commit.

### CRITICAL — Never Do This

1. **Never hardcode secrets**: No API keys, tokens, passwords, or credentials in source code. Always use `process.env['KEY_NAME']`.
2. **Never use `eval()` or `new Function()`**: Code injection risk. No exceptions.
3. **Never use `child_process.exec()` with dynamic input**: Use `execFile()` or `spawn()` with argument arrays.
4. **Never use `dangerouslySetInnerHTML` without DOMPurify**: XSS risk from LLM-generated content.
5. **Never interpolate user input into system prompts**: Use structured message roles to separate user content from instructions.
6. **Never expose stack traces in API responses**: Use generic error messages with correlation IDs.
7. **Never commit `.env` files**: Verify `.gitignore` coverage.

### HIGH — Always Do This

1. **Validate all inputs at API boundaries**: Every tRPC procedure, WebSocket handler, and HTTP endpoint must validate input with Zod schemas. No `z.any()` or `z.unknown()` at boundaries.
2. **Use parameterized SQL**: Always use `?` placeholders with `better-sqlite3` prepared statements. Never concatenate user input into queries.
3. **Authenticate all endpoints**: Every data-access endpoint must use `protectedProcedure`. Raw Fastify routes must validate sessions.
4. **Authorize resource access**: Check that the authenticated user owns the channel/message/resource they're accessing.
5. **Sanitize LLM output before rendering**: Treat all model responses as untrusted. Sanitize for the target context (HTML, terminal, markdown).
6. **Set timeouts on all external calls**: Use `timeout-guard.ts` pattern for provider API calls. Never allow unbounded waits.
7. **Enable MCP tool approval**: Tool approval should be enabled for any new MCP integration. Classify tools as read/write and require approval for write operations.

### MEDIUM — Best Practices

1. **SSRF protection on user-provided URLs**: Use `web-fetch.ts` utilities. Block private IPs, cloud metadata endpoints, non-HTTP schemes.
2. **Rate limit sensitive endpoints**: Auth, message sending, and streaming endpoints need rate limiting.
3. **Bind to `127.0.0.1` by default**: Local-first tool should not expose services on `0.0.0.0`.
4. **Use `crypto.timingSafeEqual()`** for comparing tokens, secrets, or signatures.
5. **Path traversal prevention**: Validate that resolved file paths stay within expected directories before reading/writing.
6. **Security headers**: Ensure CSP, HSTS, X-Frame-Options, X-Content-Type-Options are set on web responses.

### Dependency Management

- Review all new dependencies for supply chain risk before adding
- Prefer well-maintained packages with high download counts
- Run `npm audit --audit-level=high` after adding dependencies
- Use exact versions in `package.json` for security-critical packages
- Check for `postinstall` scripts in new dependencies

### Security Tooling

| Tool                        | Purpose                    | When                          |
| --------------------------- | -------------------------- | ----------------------------- |
| `eslint-plugin-security`    | SAST in ESLint             | Every `npm run lint`          |
| Gitleaks (`.gitleaks.toml`) | Secret detection           | Pre-commit hook + CI          |
| Semgrep (`.semgrep.yml`)    | SAST pattern matching      | CI (security workflow)        |
| CodeQL                      | Deep semantic analysis     | CI (weekly + PRs)             |
| `npm audit`                 | Dependency CVEs            | CI (every build)              |
| Security audit skill        | Comprehensive manual audit | On demand (`/security-audit`) |

### Pre-Commit Security

The `.husky/pre-commit` hook runs:

1. `lint-staged` — ESLint with security rules on changed files
2. `gitleaks protect --staged` — Blocks commits with secrets

Install: `npm install --save-dev husky lint-staged eslint-plugin-security && npx husky init`
Secret scanner: `brew install gitleaks` (or download from GitHub releases)
