import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { findProjectRoot } from './project-root';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ProviderRequestLog {
  requestId: string;
  model: string;
  messages: Array<{
    role: string;
    content: string;
    name?: string;
  }>;
  response: string;
  startTime: Date;
  endTime: Date;
  options?: Record<string, unknown>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cachedTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface DebugScope {
  type: 'channel' | 'dm';
  id: string;
  label?: string | undefined;
}

export interface DebugScopeInfo {
  type: 'channel' | 'dm';
  id: string;
  label: string;
  createdAt: string;
  files: string[];
}

const PROJECT_ROOT = findProjectRoot();
const LOG_DIR = join(PROJECT_ROOT, '.cebus');
const DEBUG_BASE = join(PROJECT_ROOT, '.cebus', 'debug');
const LOG_FILE = join(LOG_DIR, 'debug.log');
const CHAT_FILE = join(LOG_DIR, 'chat-transcript.md');

// ---------------------------------------------------------------------------
// Scoped debug logging — routes files to per-channel/dm directories
// ---------------------------------------------------------------------------

const scopeStorage = new AsyncLocalStorage<DebugScope>();

export function runWithDebugScope<T>(scope: DebugScope, fn: () => T): T {
  return scopeStorage.run(scope, fn);
}

function getCurrentScope(): DebugScope | undefined {
  return scopeStorage.getStore();
}

const ensuredScopeDirs = new Set<string>();

function getScopedLogDir(): string | undefined {
  const scope = getCurrentScope();
  if (!scope) return undefined;
  const scopeDir = join(DEBUG_BASE, scope.type === 'channel' ? 'channels' : 'dm', sanitizeForFilename(scope.id));
  if (!ensuredScopeDirs.has(scopeDir)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
    mkdirSync(scopeDir, { recursive: true });
    ensuredScopeDirs.add(scopeDir);
    // Write scope metadata
    const metaPath = join(scopeDir, '_meta.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
    if (!existsSync(metaPath)) {
      try {
        writeFileSync(metaPath, JSON.stringify({
          type: scope.type,
          id: scope.id,
          label: scope.label ?? scope.id,
          createdAt: new Date().toISOString(),
        }, null, 2));
      } catch {
        // logger must never crash
      }
    }
  }
  return scopeDir;
}

function getEffectiveLogDir(): string {
  return getScopedLogDir() ?? LOG_DIR;
}

function getEffectiveLogFile(): string {
  const scoped = getScopedLogDir();
  return scoped ? join(scoped, 'debug.log') : LOG_FILE;
}

function getEffectiveChatFile(): string {
  const scoped = getScopedLogDir();
  return scoped ? join(scoped, 'chat-transcript.md') : CHAT_FILE;
}

function getEffectiveTlFile(): string {
  const scoped = getScopedLogDir();
  return scoped ? join(scoped, 'team-leader.md') : join(LOG_DIR, 'team-leader.md');
}

function getScopeKey(): string {
  const scope = getCurrentScope();
  return scope ? `${scope.type}:${scope.id}` : '__global__';
}

let isEnabled = false;
let transcriptEnabled = false;
let sessionId = '';
let dirReady = false;
const initializedModelLogs = new Set<string>();
const modelRequestCounters = new Map<string, number>();

// ---------------------------------------------------------------------------
// Write buffer — batches appendFileSync calls to reduce disk I/O
// ---------------------------------------------------------------------------

const writeBuffers = new Map<string, string[]>();
const FLUSH_INTERVAL_MS = 100;
const FLUSH_SIZE_BYTES = 4096;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getBuffer(filePath: string): string[] {
  let buf = writeBuffers.get(filePath);
  if (!buf) {
    buf = [];
    writeBuffers.set(filePath, buf);
  }
  return buf;
}

function bufferSize(buf: string[]): number {
  let size = 0;
  for (const s of buf) size += s.length;
  return size;
}

function flushBuffer(filePath: string): void {
  const buf = writeBuffers.get(filePath);
  if (!buf || buf.length === 0) return;
  const content = buf.join('');
  buf.length = 0;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath from internal log config
    appendFileSync(filePath, content);
  } catch {
    // logger must never crash the app
  }
}

export function flushAllBuffers(): void {
  for (const filePath of writeBuffers.keys()) {
    flushBuffer(filePath);
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushAllBuffers, FLUSH_INTERVAL_MS);
  flushTimer.unref(); // Don't keep process alive for logging
}

function bufferedAppend(filePath: string, content: string): void {
  const buf = getBuffer(filePath);
  buf.push(content);
  ensureFlushTimer();
  if (bufferSize(buf) >= FLUSH_SIZE_BYTES) {
    flushBuffer(filePath);
  }
}

// Flush on process exit
process.on('exit', flushAllBuffers);

/**
 * Check if debug logging is enabled.
 * Unified check: CEBUS_DEBUG env or programmatic enablement.
 */
export function isDebugEnabled(): boolean {
  const env = process.env.CEBUS_DEBUG;
  return isEnabled || env === 'true' || env === '1';
}

function ensureLogDir(): void {
  if (dirReady) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- LOG_DIR from internal config
  mkdirSync(LOG_DIR, { recursive: true });
  dirReady = true;
}

function sanitizeForFilename(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'apiKey',
  'token',
  'secret',
  'password',
  'authorization',
  'credential',
  'openai_api_key',
  'anthropic_api_key',
  'google_api_key',
]);

function redactSensitive(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redactSensitive);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      // eslint-disable-next-line security/detect-object-injection -- key from Object.entries()
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      // eslint-disable-next-line security/detect-object-injection -- key from Object.entries()
      result[key] = redactSensitive(value);
    } else {
      // eslint-disable-next-line security/detect-object-injection -- key from Object.entries()
      result[key] = value;
    }
  }
  return result;
}

function getModelLogFile(provider: string, model: string): string {
  return join(getEffectiveLogDir(), `${sanitizeForFilename(provider)}--${sanitizeForFilename(model)}.md`);
}

export function enableDebugLogging(sid?: string): void {
  isEnabled = true;
  sessionId = sid ?? `session-${Date.now()}`;

  ensureLogDir();

  const logFile = getEffectiveLogFile();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- logFile from internal config
  writeFileSync(
    logFile,
    `\n${'='.repeat(80)}\n` +
      `Session: ${sessionId}\n` +
      `Started: ${new Date().toISOString()}\n` +
      `Node: ${process.version}\n` +
      `Platform: ${process.platform}\n` +
      `${'='.repeat(80)}\n\n`,
    { flag: 'a' }
  );

  log('info', 'logger', 'Debug logging enabled', { logFile });
}

export function log(level: LogLevel, category: string, message: string, data?: unknown): void {
  if (!isDebugEnabled()) return;

  const timestamp = new Date().toISOString();

  // eslint-disable-next-line security/detect-object-injection -- level is typed LogLevel
  const levelIcon: string = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
  }[level];

  let logLine = `[${timestamp}] ${levelIcon} [${category.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    try {
      const safeData = redactSensitive(data);
      logLine += `\n  Data: ${JSON.stringify(safeData, null, 2).replace(/\n/g, '\n  ')}`;
    } catch {
      // Expected: data may contain circular references or non-serializable values
      logLine += `\n  Data: [Unable to serialize]`;
    }
  }
  logLine += '\n';

  bufferedAppend(getEffectiveLogFile(), logLine);
}

export const debug = (category: string, message: string, data?: unknown): void =>
  log('debug', category, message, data);

export const info = (category: string, message: string, data?: unknown): void =>
  log('info', category, message, data);

export const warn = (category: string, message: string, data?: unknown): void =>
  log('warn', category, message, data);

export const error = (category: string, message: string, data?: unknown): void =>
  log('error', category, message, data);

export function logMessage(
  event: 'create' | 'update' | 'complete' | 'error' | 'stream',
  messageId: string,
  details?: unknown
): void {
  debug('message', `Message ${event}: ${messageId}`, details);
}

export function logRender(component: string, event: string, details?: unknown): void {
  debug('render', `${component}: ${event}`, details);
}

export function logStream(
  participantId: string,
  event: 'start' | 'token' | 'complete' | 'error' | 'waiting',
  details?: unknown
): void {
  debug('stream', `${participantId}: ${event}`, details);
}

export function logSession(event: string, details?: unknown): void {
  info('session', event, details);
}

export function logProvider(provider: string, event: string, details?: unknown): void {
  debug('provider', `${provider}: ${event}`, details);
}

export function logProviderRequest(provider: string, data: ProviderRequestLog): void {
  if (!isDebugEnabled()) return;

  const modelLogFile = getModelLogFile(provider, data.model);
  const scopePrefix = getScopeKey();
  const modelKey = `${scopePrefix}:${provider}:${data.model}`;

  if (!initializedModelLogs.has(modelKey)) {
    initModelLog(data.model, provider);
    initializedModelLogs.add(modelKey);
  }

  ensureLogDir();

  const duration = data.endTime.getTime() - data.startTime.getTime();
  const timestamp = data.endTime.toLocaleTimeString();
  const counterKey = modelKey;
  const requestNum = (modelRequestCounters.get(counterKey) ?? 0) + 1;
  modelRequestCounters.set(counterKey, requestNum);

  const messageCount = data.messages.length;
  let totalInputChars = 0;
  for (const msg of data.messages) totalInputChars += msg.content.length;

  let entry = '';
  entry += `\n${'═'.repeat(80)}\n`;
  entry += `## Request #${requestNum} — ${timestamp}\n`;
  entry += `_${messageCount} messages | ${totalInputChars} chars input_\n`;
  entry += `${'═'.repeat(80)}\n\n`;

  for (const msg of data.messages) {
    const charCount = msg.content.length;

    if (msg.role === 'system') {
      entry += `### ⚙️ System _(${charCount} chars)_\n\n`;
      entry += msg.content ? `${msg.content}\n\n` : '_(empty)_\n\n';
      entry += `---\n\n`;
    } else if (msg.role === 'user') {
      const bracketMatch = msg.content.match(/^\[(.+?)\]:\s*/);
      if (bracketMatch) {
        const name = bracketMatch[1]!;
        const text = msg.content.slice(bracketMatch[0].length);
        entry += `### 🤖 ${name} _(${timestamp} | ${charCount} chars)_\n\n${text}\n\n---\n\n`;
      } else {
        entry += `### 🧑 You _(${timestamp} | ${charCount} chars)_\n\n${msg.content}\n\n---\n\n`;
      }
    } else if (msg.role === 'assistant') {
      entry += `### 🤖 ${data.model} _(${timestamp} | ${charCount} chars)_\n\n${msg.content}\n\n---\n\n`;
    }
  }

  entry += `### 🤖 ${data.model} — Response\n\n`;
  entry += `${data.response}\n\n`;

  const tokens: string[] = [];
  if (data.usage?.promptTokens !== undefined && data.usage.promptTokens !== 0)
    tokens.push(`in: ${data.usage.promptTokens}`);
  if (data.usage?.completionTokens !== undefined && data.usage.completionTokens !== 0)
    tokens.push(`out: ${data.usage.completionTokens}`);
  if (data.usage?.cacheReadTokens !== undefined && data.usage.cacheReadTokens !== 0)
    tokens.push(`cache: ${data.usage.cacheReadTokens}`);
  const tokenStr = tokens.length > 0 ? ` | ${tokens.join(', ')}` : '';
  entry += `_${duration}ms${tokenStr}_\n\n`;

  bufferedAppend(modelLogFile, entry);

  debug('provider', `${provider}: request-complete`, {
    requestId: data.requestId,
    model: data.model,
    duration: `${duration}ms`,
    usage: data.usage,
  });
}

function initModelLog(model: string, provider: string): void {
  if (!isDebugEnabled()) return;

  ensureLogDir();

  const header = `# ${model} (${provider})

**Date:** ${new Date().toLocaleString()}

---

`;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal sanitized config
    writeFileSync(getModelLogFile(provider, model), header);
  } catch {
    // logger must never crash the app
  }
}

export function logContext(
  sessionId: string,
  event: 'level-change' | 'refresh' | 'stale' | 'fresh' | 'included' | 'skipped',
  details?: unknown
): void {
  debug('context', `${sessionId}: ${event}`, details);
}

export function startChatTranscript(title?: string): void {
  transcriptEnabled = true;
  ensureLogDir();
  cleanOldLogFiles();

  const chatFile = getEffectiveChatFile();
  const header = `# Cebus Chat Transcript

**Session:** ${title ?? 'Untitled Session'}
**Date:** ${new Date().toLocaleString()}

---

`;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- chatFile from internal config
    writeFileSync(chatFile, header);
  } catch {
    // Expected: logger must never crash the app — disk full, permissions, etc.
  }
}

function cleanOldLogFiles(): void {
  const scopePrefix = getScopeKey();
  // Only clear counters for the current scope
  for (const key of initializedModelLogs) {
    if (key.startsWith(scopePrefix + ':')) initializedModelLogs.delete(key);
  }
  for (const key of modelRequestCounters.keys()) {
    if (key.startsWith(scopePrefix + ':')) modelRequestCounters.delete(key);
  }

  const effectiveDir = getEffectiveLogDir();
  const tlKey = `${scopePrefix}:tl`;
  if (scopeTlState.has(tlKey)) scopeTlState.delete(tlKey);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- effectiveDir from internal config
    const files = readdirSync(effectiveDir);
    for (const file of files) {
      if ((file.includes('--') || file === 'team-leader.md' || file === 'debug.log') && (file.endsWith('.md') || file.endsWith('.log'))) {
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
          unlinkSync(join(effectiveDir, file));
        } catch {
          // logger must never crash the app
        }
      }
    }
  } catch {
    // logger must never crash the app
  }
}

export function resetChatTranscript(): void {
  if (!transcriptEnabled) return;
  ensureLogDir();

  const chatFile = getEffectiveChatFile();
  const header = `# Cebus Chat Transcript (cleared)

**Date:** ${new Date().toLocaleString()}

---

`;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- chatFile from internal config
    writeFileSync(chatFile, header);
  } catch {
    // Expected: logger must never crash the app
  }
}

// Per-scope TL state: { initialized, counter }
const scopeTlState = new Map<string, { initialized: boolean; counter: number }>();

function getTlState(): { initialized: boolean; counter: number } {
  const key = `${getScopeKey()}:tl`;
  let state = scopeTlState.get(key);
  if (!state) {
    state = { initialized: false, counter: 0 };
    scopeTlState.set(key, state);
  }
  return state;
}

export function logTlDecision(data: {
  cycle: number;
  phase: string;
  systemPrompt: string;
  userMessage: string;
  rawResponse: string;
  parsedActions?: unknown;
  fallback?: string;
  latencyMs: number;
}): void {
  if (!isDebugEnabled()) return;
  ensureLogDir();

  const tlLogFile = getEffectiveTlFile();
  const tlState = getTlState();

  if (!tlState.initialized) {
    const header = `# Team Leader Decision Log\n\n**Session started:** ${new Date().toLocaleString()}\n\n---\n\n`;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
      writeFileSync(tlLogFile, header);
    } catch {
      // logger must never crash
    }
    tlState.initialized = true;
  }

  tlState.counter++;
  const timestamp = new Date().toLocaleTimeString();

  let entry = `\n${'═'.repeat(80)}\n`;
  entry += `## TL Decision #${tlState.counter} — ${timestamp} (${data.latencyMs}ms)\n`;
  entry += `**Cycle:** ${data.cycle} | **Phase:** ${data.phase}\n`;
  entry += `${'═'.repeat(80)}\n\n`;

  entry += `### ⚙️ System Prompt _(${data.systemPrompt.length} chars)_\n\n`;
  entry += `${data.systemPrompt}\n\n---\n\n`;

  entry += `### 🧑 User Message\n\n${data.userMessage}\n\n---\n\n`;

  entry += `### 🤖 TL Response _(${data.rawResponse.length} chars)_\n\n`;
  entry += `\`\`\`json\n${data.rawResponse}\n\`\`\`\n\n`;

  if (data.parsedActions) {
    entry += `### ✅ Parsed Actions\n\n\`\`\`json\n${JSON.stringify(data.parsedActions, null, 2)}\n\`\`\`\n\n`;
  }

  if (data.fallback) {
    entry += `### ⚠️ Fallback: ${data.fallback}\n\n`;
  }

  entry += `---\n\n`;

  bufferedAppend(tlLogFile, entry);
}

export function logChatMessage(
  sender: string,
  content: string,
  isUser: boolean = false,
  directedTo?: readonly string[] | undefined,
): void {
  if (!transcriptEnabled) return;
  ensureLogDir();

  const timestamp = new Date().toLocaleTimeString();
  const icon = isUser ? '🧑' : '🤖';
  const routing =
    isUser && directedTo !== undefined && directedTo.length > 0
      ? ` → ${directedTo.join(', ')}`
      : '';

  const entry = `### ${icon} ${sender}${routing} _(${timestamp})_

${content}

---

`;

  bufferedAppend(getEffectiveChatFile(), entry);
}

// ---------------------------------------------------------------------------
// Debug file browsing — used by server to expose debug files to web UI
// ---------------------------------------------------------------------------

export function listDebugScopes(): DebugScopeInfo[] {
  const results: DebugScopeInfo[] = [];

  for (const subdir of ['channels', 'dm']) {
    const baseDir = join(DEBUG_BASE, subdir);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
    if (!existsSync(baseDir)) continue;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const scopeDir = join(baseDir, entry.name);
        const metaPath = join(scopeDir, '_meta.json');
        let meta: { type: string; id: string; label: string; createdAt: string } | undefined;
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
          meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        } catch {
          // no meta file
        }

        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
        const files = readdirSync(scopeDir)
          .filter(f => (f.endsWith('.md') || f.endsWith('.log')) && f !== '_meta.json');

        if (files.length === 0) continue;

        results.push({
          type: (meta?.type as 'channel' | 'dm') ?? (subdir === 'channels' ? 'channel' : 'dm'),
          id: meta?.id ?? entry.name,
          label: meta?.label ?? entry.name,
          createdAt: meta?.createdAt ?? '',
          files,
        });
      }
    } catch {
      // dir not readable
    }
  }

  return results;
}

export function listDebugFiles(type: 'channel' | 'dm', id: string): string[] {
  const subdir = type === 'channel' ? 'channels' : 'dm';
  const scopeDir = join(DEBUG_BASE, subdir, sanitizeForFilename(id));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
  if (!existsSync(scopeDir)) return [];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
    return readdirSync(scopeDir).filter(f => (f.endsWith('.md') || f.endsWith('.log')) && f !== '_meta.json');
  } catch {
    return [];
  }
}

export function readDebugFile(type: 'channel' | 'dm', id: string, filename: string): string | null {
  // Validate filename to prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null;
  if (!filename.endsWith('.md') && !filename.endsWith('.log')) return null;

  const subdir = type === 'channel' ? 'channels' : 'dm';
  const filePath = join(DEBUG_BASE, subdir, sanitizeForFilename(id), filename);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated above
  if (!existsSync(filePath)) return null;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated above
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
