/**
 * Registers IDE actions as VS Code LanguageModelTools.
 *
 * This makes all IDE actions (git, editor, workspace) available to Copilot,
 * any chat participant, and agent mode — not just the Cebus webview.
 */

import * as vscode from 'vscode';
import { executeIdeAction } from '../engine/ide-actions.js';

interface ToolDef {
  name: string;
  action: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  confirmMessage?: string;
}

const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'cebus_getGitStatus',
    action: 'getGitStatus',
    displayName: 'Git Status',
    description: 'Returns current git branch, modified files, staged files, and untracked files in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cebus_getGitDiff',
    action: 'getGitDiff',
    displayName: 'Git Diff',
    description: 'Returns the unified diff of all unstaged changes in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cebus_getFileDiff',
    action: 'getFileDiff',
    displayName: 'File Diff',
    description: 'Returns the diff of a specific file compared to HEAD.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative path to the file. If omitted, uses the active editor.' },
      },
    },
  },
  {
    name: 'cebus_openDiffView',
    action: 'openDiffView',
    displayName: 'Open Diff View',
    description: 'Opens the VS Code diff editor for a file compared to HEAD.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative path to the file. If omitted, uses the active editor.' },
      },
    },
    confirmMessage: 'Open diff view for this file?',
  },
  {
    name: 'cebus_getGitLog',
    action: 'getGitLog',
    displayName: 'Git Log',
    description: 'Returns recent git commits with hash, message, author, and date.',
    inputSchema: {
      type: 'object',
      properties: {
        maxEntries: { type: 'number', description: 'Maximum number of log entries (default: 10)' },
      },
    },
  },
  {
    name: 'cebus_getOpenFiles',
    action: 'getOpenFiles',
    displayName: 'Open Files',
    description: 'Returns a list of all currently open editor tabs with their file paths.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cebus_openFile',
    action: 'openFile',
    displayName: 'Open File',
    description: 'Opens a file in the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative path to the file to open' },
      },
      required: ['filePath'],
    },
    confirmMessage: 'Open this file in the editor?',
  },
  {
    name: 'cebus_getDiagnostics',
    action: 'getDiagnostics',
    displayName: 'Get Diagnostics',
    description: 'Returns all errors, warnings, and hints from the current workspace grouped by file.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cebus_searchFiles',
    action: 'searchFiles',
    displayName: 'Search Files',
    description: 'Finds files matching a glob pattern in the workspace (respects .gitignore).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx")' },
        maxResults: { type: 'number', description: 'Maximum number of results (default: 50)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'cebus_getSymbols',
    action: 'getSymbols',
    displayName: 'Get Symbols',
    description: 'Returns functions, classes, methods, and other symbols defined in a file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative path to the file. If omitted, uses the active editor.' },
      },
    },
  },
  {
    name: 'cebus_getWorkspaceFiles',
    action: 'getWorkspaceFiles',
    displayName: 'Workspace Files',
    description: 'Returns a list of all files in the workspace (respects .gitignore, limited to 200).',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Maximum number of files (default: 200)' },
      },
    },
  },
  {
    name: 'cebus_readFile',
    action: 'readFile',
    displayName: 'Read File',
    description: 'Reads the content of a file in the workspace (100KB limit).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative path to the file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'cebus_getActiveFile',
    action: 'getActiveFile',
    displayName: 'Active File',
    description: 'Returns the currently active editor file path, language, selection, and full content.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function registerIdeTools(context: vscode.ExtensionContext): void {
  // Check if the LanguageModelTool registration API is available
  if (typeof vscode.lm?.registerTool !== 'function') {
    return;
  }

  for (const def of TOOL_DEFINITIONS) {
    const tool: vscode.LanguageModelTool<Record<string, unknown>> = {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const params = (options.input ?? {}) as Record<string, unknown>;
        const result = await executeIdeAction(def.action, params);

        const text = result.success
          ? JSON.stringify(result.data, null, 2)
          : `Error: ${result.error ?? 'Unknown error'}`;

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(text),
        ]);
      },
    };

    if (def.confirmMessage) {
      const message = def.confirmMessage;
    tool.prepareInvocation = async (
        _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, unknown>>,
        _token: vscode.CancellationToken
      ): Promise<vscode.PreparedToolInvocation> => {
        return {
          invocationMessage: message ?? 'Execute this action?',
        };
      };
    }

    context.subscriptions.push(vscode.lm.registerTool(def.name, tool));
  }
}

/** Returns tool definitions for package.json contribution point generation. */
export function getToolContributions(): Array<{
  name: string;
  displayName: string;
  modelDescription: string;
  canBeReferencedInPrompt: boolean;
  toolReferenceName: string;
  icon: string;
  inputSchema: Record<string, unknown>;
}> {
  const icons: Record<string, string> = {
    cebus_getGitStatus: '$(git-branch)',
    cebus_getGitDiff: '$(diff)',
    cebus_getFileDiff: '$(diff-single)',
    cebus_openDiffView: '$(diff-editor)',
    cebus_getGitLog: '$(git-commit)',
    cebus_getOpenFiles: '$(files)',
    cebus_openFile: '$(go-to-file)',
    cebus_getDiagnostics: '$(warning)',
    cebus_searchFiles: '$(search)',
    cebus_getSymbols: '$(symbol-method)',
    cebus_getWorkspaceFiles: '$(folder-opened)',
    cebus_readFile: '$(file-code)',
    cebus_getActiveFile: '$(file)',
  };

  return TOOL_DEFINITIONS.map(def => ({
    name: def.name,
    displayName: def.displayName,
    modelDescription: def.description,
    canBeReferencedInPrompt: true,
    toolReferenceName: def.name.replace('cebus_', ''),
    icon: icons[def.name] ?? '$(tools)',
    inputSchema: def.inputSchema,
  }));
}
