/**
 * Stream flush utilities for code-block-aware line flushing.
 *
 * Completed lines are flushed to Ink's Static scroll buffer
 * while maintaining code block state across chunks.
 */

import type React from 'react';
import type { StaticEntry, StreamFlushBuffer } from '../../chat-types';

/** Flush completed lines from the buffer to Static (code-block-aware). */
export function flushCompletedLines(
  buf: StreamFlushBuffer,
  placeholderId: string,
  setStaticEntries: React.Dispatch<React.SetStateAction<StaticEntry[]>>
): void {
  const lines = buf.unflushed.split('\n');
  if (lines.length <= 1) return;

  const completeLines = lines.slice(0, -1);
  buf.unflushed = lines[lines.length - 1]!;

  let textAccum = '';
  const flushChunk = (content: string): void => {
    const chunkId = `${placeholderId}-c${buf.chunkCounter++}`;
    setStaticEntries(prev => [...prev, { id: chunkId, kind: 'stream-text' as const, content }]);
  };

  for (const line of completeLines) {
    const isFenceLine = /^\s*`{3,}\S*\s*$/.test(line);

    if (!buf.inCodeBlock && isFenceLine) {
      if (textAccum) {
        flushChunk(textAccum);
        textAccum = '';
      }
      buf.inCodeBlock = true;
      buf.codeBlockAccum = line + '\n';
    } else if (buf.inCodeBlock && isFenceLine) {
      buf.codeBlockAccum += line;
      flushChunk(buf.codeBlockAccum);
      buf.codeBlockAccum = '';
      buf.inCodeBlock = false;
    } else if (buf.inCodeBlock) {
      buf.codeBlockAccum += line + '\n';
    } else {
      textAccum += (textAccum ? '\n' : '') + line;
    }
  }

  if (textAccum) {
    flushChunk(textAccum);
  }
}

/** Flush remaining buffer content (closing code block + partial line) on stream complete. */
export function flushRemaining(
  buf: StreamFlushBuffer,
  placeholderId: string,
  setStaticEntries: React.Dispatch<React.SetStateAction<StaticEntry[]>>
): void {
  const remaining = buf.codeBlockAccum + buf.unflushed;
  if (remaining.length > 0) {
    const chunkId = `${placeholderId}-c${buf.chunkCounter++}`;
    setStaticEntries(prev => [
      ...prev,
      { id: chunkId, kind: 'stream-text' as const, content: remaining },
    ]);
  }
}
