/**
 * Gathers workspace context for injection into AI prompts.
 *
 * Extracts: active file path, selection text, file diagnostics, git branch.
 */

import * as vscode from 'vscode';

export interface WorkspaceContext {
  activeFilePath?: string | undefined;
  activeFileLanguage?: string | undefined;
  selectedText?: string | undefined;
  diagnostics?: string | undefined;
  gitBranch?: string | undefined;
}

export function gatherWorkspaceContext(): WorkspaceContext {
  const editor = vscode.window.activeTextEditor;
  const context: WorkspaceContext = {};

  if (editor !== undefined) {
    const doc = editor.document;
    context.activeFilePath = vscode.workspace.asRelativePath(doc.uri);
    context.activeFileLanguage = doc.languageId;

    const selection = editor.selection;
    if (!selection.isEmpty) {
      context.selectedText = doc.getText(selection);
    }

    const fileDiags = vscode.languages.getDiagnostics(doc.uri);
    if (fileDiags.length > 0) {
      context.diagnostics = fileDiags
        .slice(0, 10)
        .map(
          d => `[${vscode.DiagnosticSeverity[d.severity]}] L${d.range.start.line + 1}: ${d.message}`
        )
        .join('\n');
    }
  }

  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (gitExt?.isActive === true) {
    const api = (gitExt.exports as { getAPI: (version: number) => unknown }).getAPI(1) as {
      repositories: Array<{ state: { HEAD?: { name?: string } } }>;
    };
    const repo = api.repositories[0];
    if (repo?.state.HEAD?.name !== undefined) {
      context.gitBranch = repo.state.HEAD.name;
    }
  }

  return context;
}

export function formatWorkspaceContext(ctx: WorkspaceContext): string {
  const parts: string[] = [];

  if (ctx.activeFilePath !== undefined) {
    parts.push(`Active file: ${ctx.activeFilePath} (${ctx.activeFileLanguage ?? 'unknown'})`);
  }
  if (ctx.selectedText !== undefined && ctx.selectedText.length > 0) {
    const truncated =
      ctx.selectedText.length > 500 ? ctx.selectedText.slice(0, 500) + '...' : ctx.selectedText;
    parts.push(`Selected code:\n\`\`\`\n${truncated}\n\`\`\``);
  }
  if (ctx.diagnostics !== undefined && ctx.diagnostics.length > 0) {
    parts.push(`Diagnostics:\n${ctx.diagnostics}`);
  }
  if (ctx.gitBranch !== undefined && ctx.gitBranch.length > 0) {
    parts.push(`Git branch: ${ctx.gitBranch}`);
  }

  return parts.join('\n\n');
}
