# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-10

### Architecture

- **Monorepo migration** — Restructured from flat `src/` to Turbo monorepo with `packages/` and `apps/`
- **Shared TypeScript configs** — `@cebus/tsconfig` package with base, node, and react presets
- **Engine package** — `@cebus/engine` extracted as standalone orchestration engine

### New Apps

- **Web UI** (`apps/web`) — Browser-based chat interface built with Vite, React 19, Tailwind v4, Radix UI, and tRPC. Includes components for chat, canvas, artifacts, rich blocks, roles, settings, auth, inbox, sidebar, layout, and debug panel
- **Server** (`apps/server`) — Fastify API with tRPC routers, WebSocket streaming, Better Auth, SQLite persistence, and services for channels, messages, orchestration, prompts, and stream hub
- **VS Code Extension** (`apps/vscode`) — Full IDE integration with embedded React webview, native `vscode.lm` API support (Copilot models), MCP tools, and chat commands

### Orchestration

- **Team Leader mode** — AI facilitator that manages group discussions through structured phases (clarify, plan, deliberate, execute, review, synthesize, ask_user) with strategy selection, user interrupts, budget guardrails, and task/session ledgers
- **Session ledger** — Magentic-One inspired working memory for persisting orchestration state (goals, facts, unknowns, steps, decisions, artifacts)
- **TL guardrails** — Budget limits enforcement (15 TL cycles, 5 worker rounds, 2 review rounds)
- **User interrupt detection** — Override commands (stop, skip, restart) from short messages
- **Prompt loader** — Composable system prompt from `team-leader.md` + active phase prompt
- **Planner node** — Multi-round plan generation with file-based plan persistence
- **Request summary** — Condensed context for orchestrator decisions
- **Parse utilities** — Shared XML/structured output parsing for orchestrator responses

### Providers

- **OpenRouter** — New multi-provider gateway adapter
- **VS Code LM** — Native `vscode.lm` API adapter for zero-config Copilot model access
- **Cloudflare AI Gateway** — Optional proxy layer for caching, rate limiting, analytics, and cost tracking across all providers

### Prompts

- **Team Leader prompts** — `team-leader.md`, `clarify.md`, `deliberate.md`, `planner.md`, `review.md`, `synthesize.md`, `ask-user.md`
- **Raw mode** — New `raw.md` prompt for unprocessed pass-through
- Updated `analyzer.md`, `evaluator.md`, `system.md`, and chat mode prompts

### Other

- **Model pricing** — `pricing.json` with per-model token costs and `update-pricing.ts` script
- **Debug logging** — Scoped per-channel/DM via `AsyncLocalStorage` with web UI debug panel
- **Three-tier compaction** — System prompt caching, frozen summary anchor, and recent message window
- **LangSmith tracing** — Optional observability integration for tracing orchestration flows
- Updated `readme.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.env.example`, and installation scripts

## [0.1.0] - 2026-02-14

### Initial Release

- **CLI app** — Terminal UI built with Ink 6.x and React 19, featuring interactive onboarding, streaming messages, markdown rendering, participant list, and command system
- **LangGraph orchestration** — Hub-and-spoke state machine with configurable chat modes (free chat, sequential, tag-only, role-based, dynamic routing)
- **Orchestrator middleware** — Optional AI analyzer and evaluator nodes with multi-round plan approval
- **Providers** — OpenAI, Anthropic, Gemini, Ollama, and GitHub Copilot adapters with shared error mapping, deprecation warnings, and request tracking
- **Workers** — LangChain worker (OpenAI/Anthropic/Gemini/Ollama), Copilot worker (GitHub SDK), MCP gateway, budget tracker, and tool approval system
- **Agent definitions** — 7 built-in agents: UX Designer, Code Alchemist, Product Manager, Security Reviewer, Software Engineer, System Architect, Task Planner
- **Prompts** — Externalized `.md` prompts for system instructions, chat modes, model tiers, and orchestrator decisions
- **Configuration** — Schema-validated config with model tiers, role templates, session persistence, and mention parsing
- **Session management** — Compaction, checkpointing, graph caching, and store sync
- **Observability** — Orchestration logger and tracer
- **Debug logging** — Scoped debug output to `.cebus/` directory
- **Project context** — Auto-detection of project structure for context-aware responses
- **LangGraph Studio** — Studio integration entry point
- **Installers** — `install.sh` (Linux/macOS), `install.ps1` (Windows), `install.cmd` (Windows shortcut)
