// Suppress ExperimentalWarning (e.g. SQLite) that corrupts Ink terminal output.
// Must run before any module triggers the warning.

// Layer 1: Intercept stderr writes — catches warnings regardless of emission path.
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
  const str = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : '';
  if (str.includes('ExperimentalWarning')) return true;
  return (origStderrWrite as Function)(chunk, ...args);
}) as typeof process.stderr.write;

// Layer 2: Swallow the warning event so no listener can print it.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning') return;
  console.warn(warning);
});

// Layer 3: Intercept process.emitWarning before it even fires the event.
const origEmit = process.emitWarning;
process.emitWarning = ((...args: Parameters<typeof process.emitWarning>) => {
  const typeArg = args[1];
  if (typeof typeArg === 'string' && typeArg === 'ExperimentalWarning') return;
  if (typeof typeArg === 'object' && typeArg !== null && 'type' in typeArg && typeArg.type === 'ExperimentalWarning') return;
  origEmit.apply(process, args);
}) as typeof process.emitWarning;
