/**
 * IDE Actions — executes VS Code API operations requested by the webview.
 *
 * Central handler with a switch on action name. Each case uses VS Code APIs
 * and returns a structured result.
 */

import * as vscode from 'vscode';

export interface IdeActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface GitExtensionExports {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  state: {
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    untrackedResources: vscode.Uri[];
    HEAD: { name?: string; commit?: string } | undefined;
  };
  diff(cached?: boolean): Promise<string>;
  diffWithHEAD(path: string): Promise<string>;
  log(options?: { maxEntries?: number }): Promise<GitLogEntry[]>;
  rootUri: vscode.Uri;
}

interface GitChange {
  uri: vscode.Uri;
  status: number;
}

interface GitLogEntry {
  hash: string;
  message: string;
  authorName?: string;
  authorDate?: Date;
}

function getGitRepo(): GitRepository | null {
  const gitExt = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!gitExt?.isActive) return null;
  const api = gitExt.exports.getAPI(1);
  return api.repositories[0] ?? null;
}

function relativePath(repo: GitRepository, uri: vscode.Uri): string {
  const root = repo.rootUri.fsPath;
  const full = uri.fsPath;
  if (full.startsWith(root)) {
    return full.slice(root.length + 1).replace(/\\/g, '/');
  }
  return full;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Modified',
  1: 'Added',
  2: 'Deleted',
  3: 'Renamed',
  4: 'Copied',
  5: 'Unmerged',
  6: 'Ignored',
  7: 'Intent to Add',
};

async function getGitStatus(): Promise<IdeActionResult> {
  const repo = getGitRepo();
  if (!repo) return { success: false, error: 'No Git repository found' };

  const modified = repo.state.workingTreeChanges.map(c => ({
    path: relativePath(repo, c.uri),
    status: STATUS_LABELS[c.status] ?? 'Unknown',
  }));
  const staged = repo.state.indexChanges.map(c => ({
    path: relativePath(repo, c.uri),
    status: STATUS_LABELS[c.status] ?? 'Unknown',
  }));
  const untracked = (repo.state.untrackedResources ?? []).map(u => relativePath(repo, u));

  return {
    success: true,
    data: {
      branch: repo.state.HEAD?.name ?? 'detached',
      modified,
      staged,
      untracked,
    },
  };
}

async function getGitDiff(): Promise<IdeActionResult> {
  const repo = getGitRepo();
  if (!repo) return { success: false, error: 'No Git repository found' };

  const diff = await repo.diff();
  return { success: true, data: { diff: diff || '(no unstaged changes)' } };
}

async function getFileDiff(params: Record<string, unknown>): Promise<IdeActionResult> {
  const repo = getGitRepo();
  if (!repo) return { success: false, error: 'No Git repository found' };

  const filePath = typeof params['filePath'] === 'string' ? params['filePath'] : undefined;
  if (!filePath) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { success: false, error: 'No file specified and no active editor' };
    const rel = relativePath(repo, editor.document.uri);
    const diff = await repo.diffWithHEAD(rel);
    return { success: true, data: { file: rel, diff: diff || '(no changes)' } };
  }

  const diff = await repo.diffWithHEAD(filePath);
  return { success: true, data: { file: filePath, diff: diff || '(no changes)' } };
}

async function openDiffView(params: Record<string, unknown>): Promise<IdeActionResult> {
  const repo = getGitRepo();
  if (!repo) return { success: false, error: 'No Git repository found' };

  const filePath = typeof params['filePath'] === 'string' ? params['filePath'] : undefined;
  let targetUri: vscode.Uri;

  if (filePath) {
    targetUri = vscode.Uri.joinPath(repo.rootUri, filePath);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { success: false, error: 'No file specified and no active editor' };
    targetUri = editor.document.uri;
  }

  const gitUri = targetUri.with({ scheme: 'git', query: JSON.stringify({ path: targetUri.fsPath, ref: 'HEAD' }) });
  const fileName = targetUri.fsPath.split(/[\\/]/).pop() ?? 'file';
  await vscode.commands.executeCommand('vscode.diff', gitUri, targetUri, `${fileName} (HEAD vs Working)`);

  return { success: true };
}

async function getGitLog(params: Record<string, unknown>): Promise<IdeActionResult> {
  const repo = getGitRepo();
  if (!repo) return { success: false, error: 'No Git repository found' };

  const maxEntries = typeof params['maxEntries'] === 'number' ? params['maxEntries'] : 10;
  const entries = await repo.log({ maxEntries });

  return {
    success: true,
    data: {
      commits: entries.map(e => ({
        hash: e.hash.slice(0, 7),
        message: e.message,
        author: e.authorName ?? 'unknown',
        date: e.authorDate?.toISOString() ?? null,
      })),
    },
  };
}

function getOpenFiles(): IdeActionResult {
  const tabs: Array<{ path: string; isActive: boolean }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input && typeof input === 'object' && 'uri' in input) {
        const uri = (input as { uri: vscode.Uri }).uri;
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let filePath = uri.fsPath;
        if (wsFolder && filePath.startsWith(wsFolder)) {
          filePath = filePath.slice(wsFolder.length + 1).replace(/\\/g, '/');
        }
        tabs.push({ path: filePath, isActive: tab.isActive });
      }
    }
  }
  return { success: true, data: { files: tabs } };
}

async function openFile(params: Record<string, unknown>): Promise<IdeActionResult> {
  const filePath = typeof params['filePath'] === 'string' ? params['filePath'] : undefined;
  if (!filePath) return { success: false, error: 'filePath is required' };

  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri = wsFolder ? vscode.Uri.joinPath(wsFolder, filePath) : vscode.Uri.file(filePath);
  await vscode.window.showTextDocument(uri);
  return { success: true };
}

function getDiagnostics(): IdeActionResult {
  const all = vscode.languages.getDiagnostics();
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const grouped: Array<{
    file: string;
    diagnostics: Array<{ severity: string; message: string; line: number; column: number; source?: string }>;
  }> = [];

  const severityLabels = ['Error', 'Warning', 'Info', 'Hint'];

  for (const [uri, diagnostics] of all) {
    if (diagnostics.length === 0) continue;
    let filePath = uri.fsPath;
    if (wsFolder && filePath.startsWith(wsFolder)) {
      filePath = filePath.slice(wsFolder.length + 1).replace(/\\/g, '/');
    }
    grouped.push({
      file: filePath,
      diagnostics: diagnostics.map(d => ({
        severity: severityLabels[d.severity] ?? 'Unknown',
        message: d.message,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        ...(d.source ? { source: d.source } : {}),
      })),
    });
  }

  const errorCount = grouped.reduce((sum, g) => sum + g.diagnostics.filter(d => d.severity === 'Error').length, 0);
  const warningCount = grouped.reduce((sum, g) => sum + g.diagnostics.filter(d => d.severity === 'Warning').length, 0);

  return { success: true, data: { errorCount, warningCount, files: grouped } };
}

async function searchFiles(params: Record<string, unknown>): Promise<IdeActionResult> {
  const pattern = typeof params['pattern'] === 'string' ? params['pattern'] : '**/*';
  const maxResults = typeof params['maxResults'] === 'number' ? params['maxResults'] : 50;
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
  const files = uris.map(u => {
    let p = u.fsPath;
    if (wsFolder && p.startsWith(wsFolder)) {
      p = p.slice(wsFolder.length + 1).replace(/\\/g, '/');
    }
    return p;
  });

  return { success: true, data: { pattern, files } };
}

async function getSymbols(params: Record<string, unknown>): Promise<IdeActionResult> {
  const filePath = typeof params['filePath'] === 'string' ? params['filePath'] : undefined;

  let uri: vscode.Uri;
  if (filePath) {
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    uri = wsFolder ? vscode.Uri.joinPath(wsFolder, filePath) : vscode.Uri.file(filePath);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { success: false, error: 'No file specified and no active editor' };
    uri = editor.document.uri;
  }

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    uri
  );

  if (!symbols) return { success: true, data: { symbols: [] } };

  const kindNames = [
    'File', 'Module', 'Namespace', 'Package', 'Class', 'Method',
    'Property', 'Field', 'Constructor', 'Enum', 'Interface',
    'Function', 'Variable', 'Constant', 'String', 'Number',
    'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember',
    'Struct', 'Event', 'Operator', 'TypeParameter',
  ];

  function flattenSymbols(
    syms: vscode.DocumentSymbol[],
    prefix = ''
  ): Array<{ name: string; kind: string; line: number }> {
    const result: Array<{ name: string; kind: string; line: number }> = [];
    for (const s of syms) {
      const fullName = prefix ? `${prefix}.${s.name}` : s.name;
      result.push({
        name: fullName,
        kind: kindNames[s.kind] ?? 'Unknown',
        line: s.range.start.line + 1,
      });
      if (s.children.length > 0) {
        result.push(...flattenSymbols(s.children, fullName));
      }
    }
    return result;
  }

  return { success: true, data: { symbols: flattenSymbols(symbols) } };
}

async function getWorkspaceFiles(params: Record<string, unknown>): Promise<IdeActionResult> {
  const maxResults = typeof params['maxResults'] === 'number' ? params['maxResults'] : 200;
  return searchFiles({ pattern: '**/*', maxResults });
}

async function readFile(params: Record<string, unknown>): Promise<IdeActionResult> {
  const filePath = typeof params['filePath'] === 'string' ? params['filePath'] : undefined;
  if (!filePath) return { success: false, error: 'filePath is required' };

  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri = wsFolder ? vscode.Uri.joinPath(wsFolder, filePath) : vscode.Uri.file(filePath);

  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > 100_000) {
    return { success: false, error: `File too large: ${stat.size} bytes (max 100KB)` };
  }

  const raw = await vscode.workspace.fs.readFile(uri);
  const content = Buffer.from(raw).toString('utf-8');

  return { success: true, data: { filePath, content, size: stat.size } };
}

function getActiveFile(): IdeActionResult {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return { success: false, error: 'No active editor' };

  const doc = editor.document;
  const selection = editor.selection;
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let filePath = doc.uri.fsPath;
  if (wsFolder && filePath.startsWith(wsFolder)) {
    filePath = filePath.slice(wsFolder.length + 1).replace(/\\/g, '/');
  }

  return {
    success: true,
    data: {
      filePath,
      language: doc.languageId,
      lineCount: doc.lineCount,
      selection: selection.isEmpty
        ? null
        : {
            startLine: selection.start.line + 1,
            endLine: selection.end.line + 1,
            text: doc.getText(selection),
          },
      content: doc.getText(),
    },
  };
}

export async function executeIdeAction(
  action: string,
  params: Record<string, unknown> = {}
): Promise<IdeActionResult> {
  try {
    switch (action) {
      case 'getGitStatus':
        return await getGitStatus();
      case 'getGitDiff':
        return await getGitDiff();
      case 'getFileDiff':
        return await getFileDiff(params);
      case 'openDiffView':
        return await openDiffView(params);
      case 'getGitLog':
        return await getGitLog(params);
      case 'getOpenFiles':
        return getOpenFiles();
      case 'openFile':
        return await openFile(params);
      case 'getDiagnostics':
        return getDiagnostics();
      case 'searchFiles':
        return await searchFiles(params);
      case 'getSymbols':
        return await getSymbols(params);
      case 'getWorkspaceFiles':
        return await getWorkspaceFiles(params);
      case 'readFile':
        return await readFile(params);
      case 'getActiveFile':
        return getActiveFile();
      default:
        return { success: false, error: `Unknown IDE action: ${action}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
