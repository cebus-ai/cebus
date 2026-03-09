# Contributing to Cebus

Thank you for your interest in contributing to Cebus! This guide covers everything you need to get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Adding a New Provider](#adding-a-new-provider)
- [Project Structure](#project-structure)

## Development Setup

### Prerequisites

- **Node.js** >= 24.0.0 (or **Bun** >= 1.3.0)
- At least one AI provider API key (see [Configuration](readme.md#configuration))
- Git

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/cebus.git
cd cebus

# 2. Install dependencies
npm install

# 3. Set up environment variables
#    Copy your API keys into your shell profile or a local .env file
cp .env.example .env
# Edit .env and add at least one API key

# 4. Run in development mode
npm run dev -w apps/cli      # CLI dev mode
npm run dev                   # Web + Server dev mode

# 5. Verify everything works
npm run typecheck    # Type-check all packages
npm test             # Run all tests (328 across engine + cli)
npm run lint         # Lint all packages
```

### Windows Users

Run `.\install.cmd` to install dependencies, build, and link the CLI. The GitHub Copilot provider requires PowerShell v6+ (`pwsh`).

## Development Workflow

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages (via Turbo) |
| `npm run dev` | Dev mode for server + web |
| `npm run dev -w apps/cli` | Dev mode for CLI |
| `npm run typecheck` | Type-check all packages |
| `npm test` | Run all tests (328 across engine + cli) |
| `npm test -w packages/engine` | Engine tests only (322 tests) |
| `npm test -w apps/cli` | CLI tests only (6 tests) |
| `npm run lint` | Lint all packages |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Check formatting |

### Branch Naming

- `feat/<description>` -- New features
- `fix/<description>` -- Bug fixes
- `refactor/<description>` -- Code refactoring
- `docs/<description>` -- Documentation changes
- `test/<description>` -- Test additions or fixes

### Commit Messages

Use conventional commit style:

```
feat(provider): add Mistral provider adapter
fix(orchestration): handle empty agent response in sequential mode
docs: update README with new chat modes
test(orchestrator): add unit tests for dynamic routing
```

## Code Style

Cebus uses TypeScript strict mode with additional strictness flags. All code must pass the following checks before merging:

```bash
npm run typecheck   # Must pass with zero errors
npm run lint        # Must pass with zero warnings
npm run format:check # Must match Prettier formatting
```

### TypeScript Rules

- **No `any` types** -- Use `unknown` and narrow with type guards instead.
- **Explicit return types** -- All exported functions must declare return types.
- **No unused variables or parameters** -- `noUnusedLocals` and `noUnusedParameters` are enforced.
- **`exactOptionalPropertyTypes`** -- Optional properties must include `| undefined` in their type (e.g., `title?: string | undefined`).
- **No implicit returns** -- All code paths must return a value.
- **Promise safety** -- All Promises must be handled (no floating promises).

### Path Aliases

Each package uses TypeScript path aliases within its own scope. In `packages/engine`:

```typescript
import { ChatSession } from '@core/types.js';
import { ProviderAdapter } from '@providers/types.js';
```

In `apps/cli`, import from the engine package:

```typescript
import { getSession, getMessages } from '@cebus/engine';
import type { Message, Participant } from '@cebus/engine';
```

## Testing

### Test Structure

Tests live alongside each package:

```
packages/engine/tests/      # 322 tests (unit, integration, contract, mocks)
apps/cli/tests/             # 6 tests (CLI component tests)
```

### Running Tests

```bash
# Run all tests (via Turbo)
npm test

# Run engine tests only
npm test -w packages/engine

# Run a specific test file
npm test -w packages/engine -- tests/unit/orchestration/orchestrator/sequential.test.ts

# Watch mode (engine)
npm run test:watch -w packages/engine
```

### Writing Tests

- Place unit tests in `packages/engine/tests/unit/` mirroring the `src/` directory structure.
- Use Vitest's `describe`/`it`/`expect` API.
- Mock external dependencies (API calls, file system) -- never make real API calls in tests.
- Each test file should test one module.

## Pull Request Process

1. **Create a feature branch** from `main`.
2. **Make your changes** following the code style guidelines above.
3. **Run all checks** before pushing:
   ```bash
   npm run typecheck && npm run lint && npm run format:check
   ```
5. **Open a pull request** against `main` with a clear description of the changes.
6. **Address review feedback** promptly.
7. PRs require at least one approving review before merge.

### PR Checklist

- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Linter passes (`npm run lint`)
- [ ] Formatting is correct (`npm run format:check`)
- [ ] Public API changes include JSDoc documentation

## Adding a New Provider

To add support for a new AI provider:

### 1. Create the Adapter

Create a new file in `packages/engine/src/providers/` (e.g., `mistral.ts`). Your adapter must implement the `ProviderAdapter` interface from `packages/engine/src/providers/types.ts`:

```typescript
import type { ProviderAdapter, ModelInfo, ContextMessage, CompletionResult, CompletionOptions } from './types.js';

export class MistralAdapter implements ProviderAdapter {
  readonly id = 'mistral';
  readonly displayName = 'Mistral';

  async isAvailable(): Promise<boolean> { /* check API key exists */ }
  async initialize(): Promise<void> { /* initialize SDK client */ }
  async dispose(): Promise<void> { /* clean up resources */ }
  async listModels(): Promise<ModelInfo[]> { /* return available models */ }
  async isModelAvailable(modelId: string): Promise<boolean> { /* check specific model */ }
  async streamCompletion(
    modelId: string,
    messages: ContextMessage[],
    onToken: (token: string) => void,
    options?: CompletionOptions,
  ): Promise<CompletionResult> { /* streaming completion */ }
  async complete(
    modelId: string,
    messages: ContextMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> { /* non-streaming completion */ }
  cancelRequest(requestId: string): void { /* cancel in-flight request */ }
}
```

### 2. Register the Provider

Add your adapter to the registry in `packages/engine/src/providers/registry.ts`:

```typescript
import { MistralAdapter } from './mistral.js';

// In the registration section:
registry.register(new MistralAdapter());
```

### 3. Add Model Tier Classifications

Update `packages/engine/src/core/model-tiers.ts` to classify the provider's models into cost tiers (premium, middle, budget, local).

### 4. Create a LangChain Worker (if applicable)

If the provider has a LangChain integration, add support in `packages/engine/src/orchestration/worker/langchain-worker.ts`. Otherwise, create a dedicated worker similar to `copilot-worker.ts`.

### 5. Add Contract Tests

Add a contract test in `packages/engine/tests/contract/` to verify your adapter complies with the `ProviderAdapter` interface.

### 6. Update Documentation

- Add the provider to the supported providers table in `readme.md`.
- Add any required environment variables to the configuration section.

## Project Structure

See the [Architecture](#project-structure) section in [readme.md](readme.md#architecture) for a project structure overview.

## Questions?

If you have questions about contributing, open a GitHub issue with the `question` label.
