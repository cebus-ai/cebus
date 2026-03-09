/**
 * MCP Server registration for the Cebus engine.
 *
 * Registers a programmatic MCP server definition provider so VS Code
 * discovers Cebus IDE tools via the Model Context Protocol. This makes
 * the IDE actions available to Copilot agent mode and any MCP client.
 *
 * Uses the vscode.lm.registerMcpServerDefinitionProvider API (GA in VS Code 1.102+).
 * Falls back gracefully if the API is not available.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { debugLog } from '../extension.js';

export function registerMcpServer(context: vscode.ExtensionContext): void {
  // Feature detection — MCP server API may not be available in older VS Code versions
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') {
    debugLog('MCP server definition provider API not available — skipping registration');
    return;
  }

  const emitter = new vscode.EventEmitter<void>();

  const provider: vscode.McpServerDefinitionProvider = {
    onDidChangeMcpServerDefinitions: emitter.event,

    provideMcpServerDefinitions: async (): Promise<vscode.McpServerDefinition[]> => {
      const mcpServerPath = path.join(context.extensionPath, 'dist', 'mcp-server.js');

      // Only provide if the MCP server script exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(mcpServerPath));
      } catch {
        debugLog('MCP server script not found — skipping');
        return [];
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;

      const server = new vscode.McpStdioServerDefinition(
        'Cebus IDE Tools',
        'node',
        [mcpServerPath],
      );
      if (workspaceFolder) {
        server.cwd = workspaceFolder;
      }
      return [server];
    },

    resolveMcpServerDefinition: async (
      server: vscode.McpServerDefinition,
      _token: vscode.CancellationToken
    ): Promise<vscode.McpServerDefinition> => {
      return server;
    },
  };

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('cebus', provider)
  );
  context.subscriptions.push(emitter);

  debugLog('MCP server definition provider registered');
}
