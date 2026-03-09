/**
 * Cross-panel event bus — syncs state between sidebar and editor tab panels.
 *
 * Uses vscode.EventEmitter for typed events. Both CebusWebviewProvider (sidebar)
 * and CebusWebviewPanel (editor tab) subscribe to the same bus instance.
 */

import * as vscode from 'vscode';

export type SessionEvent =
  | { kind: 'conversationCreated'; conversationId: string; title: string }
  | { kind: 'messageAdded'; conversationId: string }
  | { kind: 'conversationDeleted'; conversationId: string }
  | { kind: 'activeChanged'; conversationId: string | null };

export class SessionEventBus implements vscode.Disposable {
  private emitter = new vscode.EventEmitter<SessionEvent>();

  readonly onEvent = this.emitter.event;

  fire(event: SessionEvent): void {
    this.emitter.fire(event);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
