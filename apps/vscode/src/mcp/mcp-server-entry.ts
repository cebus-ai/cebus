/**
 * Standalone MCP server entry point — runs as a stdio process.
 *
 * Implements the Model Context Protocol (MCP) over stdin/stdout,
 * exposing IDE-like workspace tools to any MCP client.
 *
 * This is a lightweight, filesystem-only server (no VS Code API).
 * For full VS Code API actions, use the LanguageModelTools registration instead.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

const workspaceRoot = process.cwd();

const TOOLS = [
  {
    name: 'readFile',
    description: 'Read the content of a file in the workspace (100KB limit)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Relative path to the file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'listFiles',
    description: 'List files in a directory',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Relative directory path (default: root)' },
        recursive: { type: 'boolean', description: 'List recursively (default: false)' },
      },
    },
  },
  {
    name: 'searchFiles',
    description: 'Search for files matching a name pattern',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'File name pattern to search for (substring match)' },
        maxResults: { type: 'number', description: 'Maximum results (default: 50)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'getGitStatus',
    description: 'Get git status of the workspace using git CLI',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'getGitLog',
    description: 'Get recent git commits',
    inputSchema: {
      type: 'object' as const,
      properties: {
        maxEntries: { type: 'number', description: 'Maximum entries (default: 10)' },
      },
    },
  },
  {
    name: 'getGitDiff',
    description: 'Get git diff of unstaged changes',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function respond(id: number | string, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function readFileContent(filePath: string): { content: string } | { error: string } {
  const fullPath = path.resolve(workspaceRoot, filePath);
  if (!fullPath.startsWith(workspaceRoot)) {
    return { error: 'Path traversal not allowed' };
  }
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 100_000) return { error: `File too large: ${stat.size} bytes` };
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { content };
  } catch {
    return { error: `File not found: ${filePath}` };
  }
}

function listFilesInDir(dirPath: string, recursive: boolean): string[] {
  const fullPath = path.resolve(workspaceRoot, dirPath);
  if (!fullPath.startsWith(workspaceRoot)) return [];

  const results: string[] = [];
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '__pycache__']);

  function walk(dir: string, prefix: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE.has(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (recursive) walk(path.join(dir, entry.name), rel);
          else results.push(`${rel}/`);
        } else {
          results.push(rel);
        }
        if (results.length >= 500) return;
      }
    } catch {
      // Directory not readable
    }
  }

  walk(fullPath, dirPath === '.' || dirPath === '' ? '' : dirPath);
  return results;
}

function searchFilesForPattern(pattern: string, maxResults: number): string[] {
  const results: string[] = [];
  const lowerPattern = pattern.toLowerCase();
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '__pycache__']);

  function walk(dir: string, prefix: string): void {
    if (results.length >= maxResults) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (IGNORE.has(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
        } else if (entry.name.toLowerCase().includes(lowerPattern)) {
          results.push(rel);
        }
      }
    } catch {
      // Skip
    }
  }

  walk(workspaceRoot, '');
  return results;
}

function execGit(args: string[]): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  try {
    return execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf-8', timeout: 10_000 });
  } catch {
    return '(git command failed)';
  }
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'readFile': {
      const filePath = String(args['filePath'] ?? '');
      return readFileContent(filePath);
    }
    case 'listFiles': {
      const dirPath = String(args['dirPath'] ?? '.');
      const recursive = Boolean(args['recursive'] ?? false);
      return { files: listFilesInDir(dirPath, recursive) };
    }
    case 'searchFiles': {
      const pattern = String(args['pattern'] ?? '');
      const maxResults = Number(args['maxResults'] ?? 50);
      return { files: searchFilesForPattern(pattern, maxResults) };
    }
    case 'getGitStatus':
      return { output: execGit(['status', '--porcelain']) };
    case 'getGitLog': {
      const max = Number(args['maxEntries'] ?? 10);
      return { output: execGit(['log', `--max-count=${max}`, '--oneline', '--no-decorate']) };
    }
    case 'getGitDiff':
      return { output: execGit(['diff']) };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function handleMessage(msg: JsonRpcRequest): void {
  switch (msg.method) {
    case 'initialize':
      respond(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'cebus-ide-tools', version: '0.1.0' },
      });
      break;

    case 'notifications/initialized':
      // Client acknowledged — no response needed
      break;

    case 'tools/list':
      respond(msg.id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const params = msg.params ?? {};
      const toolName = String(params['name'] ?? '');
      const toolArgs = (params['arguments'] ?? {}) as Record<string, unknown>;

      handleToolCall(toolName, toolArgs)
        .then(result => {
          respond(msg.id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          });
        })
        .catch(err => {
          respondError(msg.id, -32603, err instanceof Error ? err.message : String(err));
        });
      break;
    }

    case 'ping':
      respond(msg.id, {});
      break;

    default:
      if (msg.id !== undefined) {
        respondError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
      break;
  }
}

// Read MCP messages from stdin (Content-Length framing)
let buffer = '';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line: string) => {
  buffer += line + '\n';

  // Look for complete JSON-RPC messages after blank line
  const blankIdx = buffer.indexOf('\r\n\r\n');
  const blankIdx2 = buffer.indexOf('\n\n');
  const splitIdx = blankIdx >= 0 ? blankIdx : blankIdx2;

  if (splitIdx >= 0) {
    const header = buffer.slice(0, splitIdx);
    const body = buffer.slice(splitIdx + (blankIdx >= 0 ? 4 : 2));

    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (lengthMatch) {
      const expectedLength = parseInt(lengthMatch[1]!, 10);
      if (Buffer.byteLength(body) >= expectedLength) {
        const jsonStr = body.slice(0, expectedLength);
        buffer = body.slice(expectedLength);
        try {
          const msg = JSON.parse(jsonStr) as JsonRpcRequest;
          handleMessage(msg);
        } catch {
          // Invalid JSON — skip
        }
      }
    } else {
      // No Content-Length — try to parse as raw JSON
      try {
        const msg = JSON.parse(buffer.trim()) as JsonRpcRequest;
        buffer = '';
        handleMessage(msg);
      } catch {
        // Not complete yet
      }
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
