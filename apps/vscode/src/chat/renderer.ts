/**
 * Maps OrchestrationStreamEvent → VS Code ChatResponseStream.
 *
 * Since ChatResponseStream is append-only, we buffer per-agent responses
 * and flush as labeled markdown sections. Uses stream.reference() for file
 * references, stream.button() for tool approval, and stream.progress() for
 * orchestrator routing.
 */

import * as vscode from 'vscode';
import type { OrchestrationStreamEvent } from '@cebus/engine';

interface AgentBuffer {
  displayName: string;
  tokens: string[];
  complete: boolean;
}

// Pattern to detect file paths in agent responses (workspace-relative)
const FILE_PATH_PATTERN = /(?:^|\s)([a-zA-Z][\w./-]*\.(?:ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|cs|rb|sql|json|yaml|yml|md|html|css|toml|vue|svelte))\b/g;

export class StreamRenderer {
  private agentBuffers = new Map<string, AgentBuffer>();
  private stream: vscode.ChatResponseStream;
  private agentNames: Map<string, string>;
  private flushedAgents = new Set<string>();
  private referencedFiles = new Set<string>();

  constructor(stream: vscode.ChatResponseStream, agentNames: Map<string, string>) {
    this.stream = stream;
    this.agentNames = agentNames;
  }

  handleEvent(event: OrchestrationStreamEvent): void {
    switch (event.type) {
      case 'start': {
        const displayName = this.agentNames.get(event.agentId) ?? event.agentId;
        this.agentBuffers.set(event.agentId, {
          displayName,
          tokens: [],
          complete: false,
        });
        break;
      }

      case 'token': {
        const buf = this.agentBuffers.get(event.agentId);
        if (buf) {
          buf.tokens.push(event.token);
          // Flush header on first token
          if (!this.flushedAgents.has(event.agentId)) {
            this.flushedAgents.add(event.agentId);
            if (this.flushedAgents.size > 1) {
              this.stream.markdown('\n\n---\n\n');
            }
            this.stream.markdown(`**${buf.displayName}:**\n\n`);
          }
          this.stream.markdown(event.token);
        }
        break;
      }

      case 'complete': {
        const buf = this.agentBuffers.get(event.agentId);
        if (buf) {
          buf.complete = true;
          // If this agent never got tokens but has content, flush now
          if (!this.flushedAgents.has(event.agentId) && event.content) {
            this.flushedAgents.add(event.agentId);
            if (this.flushedAgents.size > 1) {
              this.stream.markdown('\n\n---\n\n');
            }
            this.stream.markdown(`**${buf.displayName}:**\n\n`);
            this.stream.markdown(event.content);
          }

          // Extract and add file references from the response
          const content = event.content ?? buf.tokens.join('');
          this.addFileReferences(content);
        }
        break;
      }

      case 'error': {
        const displayName = this.agentNames.get(event.agentId) ?? event.agentId;
        this.stream.markdown(`\n\n**${displayName}** failed: ${event.error.message}\n`);
        break;
      }

      case 'orchestrator_analysis': {
        const selectedNames = event.analysis.selectedAgents
          .map(id => this.agentNames.get(id) ?? id)
          .join(', ');
        this.stream.progress(`Routing to ${selectedNames}`);
        break;
      }

      case 'orchestrator_direct': {
        this.stream.markdown(`*Orchestrator:* ${event.content}\n\n`);
        break;
      }

      case 'approval_required': {
        const agentName = this.agentNames.get(event.agentId) ?? event.agentId;
        this.stream.markdown(
          `\n\n> **Tool approval needed** (${agentName}): \`${event.toolName}\`\n`
        );
        // Add approve/deny buttons
        this.stream.button({
          title: '$(check) Approve',
          command: 'cebus.approveToolUse',
          arguments: [event.approvalId, true],
        });
        this.stream.button({
          title: '$(close) Deny',
          command: 'cebus.approveToolUse',
          arguments: [event.approvalId, false],
        });
        break;
      }

      case 'compaction_status': {
        const pct = Math.round((event as Record<string, unknown>)['contextUtilization'] as number * 100);
        const windowMsgs = (event as Record<string, unknown>)['windowMessages'] as number;
        const totalMsgs = (event as Record<string, unknown>)['totalMessages'] as number;
        if (!isNaN(pct)) {
          this.stream.progress(`Context: ${pct}% (${windowMsgs}/${totalMsgs} messages)`);
        }
        break;
      }

      case 'tl_message': {
        this.stream.markdown(`\n\n*Team Leader [${event.phase}]:* ${event.content}\n\n`);
        break;
      }

      case 'tl_phase_change': {
        this.stream.progress(`Phase: ${String(event.from ?? 'start')} → ${event.to}`);
        break;
      }

      case 'tl_summary': {
        this.stream.progress(event.recommendation);
        break;
      }

      case 'tl_synthesis': {
        this.stream.markdown(`\n\n---\n\n**Synthesis** [${event.contributors.join(', ')}]:\n\n${event.unified_output}\n\n`);
        break;
      }

      case 'tl_warning': {
        if (event.severity === 'error') {
          this.stream.markdown(`\n\n> **Warning:** ${event.message}\n\n`);
        } else {
          this.stream.progress(event.message);
        }
        break;
      }

      case 'tl_interrupt': {
        this.stream.progress(`User interrupt: ${event.interruptType}`);
        break;
      }

      default:
        break;
    }
  }

  private addFileReferences(content: string): void {
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!wsFolder) return;

    FILE_PATH_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FILE_PATH_PATTERN.exec(content)) !== null) {
      const filePath = match[1]!;
      if (this.referencedFiles.has(filePath)) continue;
      this.referencedFiles.add(filePath);

      const fileUri = vscode.Uri.joinPath(wsFolder, filePath);
      try {
        this.stream.reference(fileUri);
      } catch {
        // File may not exist — skip
      }
    }
  }
}
