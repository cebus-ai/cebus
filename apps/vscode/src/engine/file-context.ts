/**
 * File context utilities — reads workspace files for attachment to messages.
 *
 * Extension host reads files via vscode.workspace.fs. The webview only
 * receives metadata (name, language, size) — never raw file content.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';

export interface FileAttachment {
  uri: string;
  fileName: string;
  language: string;
  content: string;
  lineCount: number;
  lineRange?: { start: number; end: number } | undefined;
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.env': 'dotenv',
  '.dockerfile': 'dockerfile',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return LANGUAGE_MAP[ext] ?? 'text';
}

const MAX_FILE_SIZE = 100_000; // 100KB

export async function readFileForContext(uri: vscode.Uri): Promise<FileAttachment> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})`);
  }

  const raw = await vscode.workspace.fs.readFile(uri);
  const content = Buffer.from(raw).toString('utf-8');
  const lines = content.split('\n');
  const fileName = path.basename(uri.fsPath);
  const language = detectLanguage(uri.fsPath);

  return { uri: uri.toString(), fileName, language, content, lineCount: lines.length };
}

export function readActiveEditorContext(): FileAttachment | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const doc = editor.document;
  const selection = editor.selection;
  const hasSelection = !selection.isEmpty;

  const content = hasSelection
    ? doc.getText(selection)
    : doc.getText();

  const lineCount = hasSelection
    ? selection.end.line - selection.start.line + 1
    : doc.lineCount;

  const lineRange = hasSelection
    ? { start: selection.start.line + 1, end: selection.end.line + 1 }
    : undefined;

  const fileName = path.basename(doc.uri.fsPath);
  const language = doc.languageId || detectLanguage(doc.uri.fsPath);

  return { uri: doc.uri.toString(), fileName, language, content, lineCount, lineRange };
}

export function formatAttachmentsForEngine(attachments: FileAttachment[]): string {
  if (attachments.length === 0) return '';

  const blocks = attachments.map(a => {
    const rangeInfo = a.lineRange ? ` (lines ${a.lineRange.start}-${a.lineRange.end})` : '';
    return `**File: ${a.fileName}${rangeInfo}** (${a.lineCount} lines)\n\`\`\`${a.language}\n${a.content}\n\`\`\``;
  });

  return blocks.join('\n\n') + '\n\n';
}

export interface FileAttachmentMeta {
  uri: string;
  fileName: string;
  language: string;
  lineCount: number;
  lineRange?: { start: number; end: number } | undefined;
}

export function toMeta(attachment: FileAttachment): FileAttachmentMeta {
  return {
    uri: attachment.uri,
    fileName: attachment.fileName,
    language: attachment.language,
    lineCount: attachment.lineCount,
    lineRange: attachment.lineRange,
  };
}
