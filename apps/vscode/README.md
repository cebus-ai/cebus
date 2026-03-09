# Cebus — Multi-Model Group Chat for VS Code

Orchestrate multiple AI models directly from VS Code. Chat with OpenAI, Anthropic, Google Gemini, Ollama, GitHub Copilot, and OpenRouter models — all in one conversation.

## Features

- **Group Chat Sidebar** — A dedicated panel in the activity bar for multi-model conversations
- **Chat Participant** — Use `@cebus` in VS Code's built-in chat to invoke group chat
- **Multiple Chat Modes** — Free chat (broadcast), sequential, @mention-only, or role-based
- **Workspace Context** — Optionally include project context (README, directory structure, git status) in prompts
- **Orchestrator Middleware** — Optional AI-powered routing that selects the best model for each query

## Getting Started

1. Open the **Cebus** panel from the activity bar (monkey icon)
2. Configure your API keys via **Ctrl+Shift+P** → `Cebus: Configure API Keys`
3. Select models via **Ctrl+Shift+P** → `Cebus: Select Models`
4. Start chatting!

## Commands

| Command                     | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `Cebus: Configure API Keys` | Set provider API keys                                      |
| `Cebus: Select Models`      | Choose which models to include                             |
| `Cebus: New Chat Session`   | Start a fresh session                                      |
| `Cebus: Set Chat Mode`      | Switch between free_chat, sequential, tag_only, role_based |
| `Cebus: Open Group Chat`    | Open the sidebar panel                                     |

## Chat Participant

In VS Code's chat panel, type `@cebus` to use group chat inline:

- `@cebus /models` — Select which models to include
- `@cebus /mode` — Set chat mode
- `@cebus /context` — Set workspace context level (none, minimal, full)

## Settings

| Setting                   | Default     | Description                                 |
| ------------------------- | ----------- | ------------------------------------------- |
| `cebus.defaultModels`     | `[]`        | Default models for new sessions             |
| `cebus.chatMode`          | `free_chat` | Default chat mode                           |
| `cebus.contextLevel`      | `minimal`   | Workspace context level                     |
| `cebus.modelBackend`      | `hybrid`    | `hybrid`, `vscode_lm`, or `copilot_cli_sdk` |
| `cebus.copilot.cliPath`   | `""`        | Path to Copilot CLI binary (auto-detected)  |
| `cebus.copilot.autoStart` | `true`      | Auto-start Copilot CLI server on activation |

### Backend modes

- `vscode_lm`: only models exposed by VS Code's `vscode.lm` API
- `copilot_cli_sdk`: only the Copilot provider (CLI SDK path, supports tool use including edits with approval flow)
- `hybrid`: both sources (and other configured providers)

## Supported Providers

- **OpenAI** — GPT-5.2, GPT-5.1, GPT-4.1, GPT-4o
- **Anthropic** — Claude Opus 4.6, Sonnet 4.5, Haiku 4.5
- **Google Gemini** — Gemini 3 Pro/Flash, 2.5 Pro/Flash
- **GitHub Copilot** — GPT-5.2 Codex, Claude Opus 4.6, Sonnet 4.5
- **Ollama** — Any locally installed model
- **OpenRouter** — Multi-provider gateway
