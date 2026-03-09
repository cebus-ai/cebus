import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

let _cachedRoot: string | undefined;

/**
 * Find the project root by walking up from `startDir` (default: `process.cwd()`)
 * looking for a `.cebus/prompts` directory — the definitive project marker.
 *
 * We check for `.cebus/prompts` (or `.cebus/agents`) rather than just `.cebus/`
 * because runtime code creates `.cebus/` in sub-packages for checkpoints and
 * config — those stale dirs must not be mistaken for the project root.
 *
 * Falls back to `process.cwd()` if no marker is found (e.g. first run).
 *
 * Result is cached for the lifetime of the process.
 */
export function findProjectRoot(startDir?: string | undefined): string {
  if (_cachedRoot !== undefined) return _cachedRoot;

  let dir = startDir ?? process.cwd();
  while (true) {
    if (
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir from path traversal up from cwd
      existsSync(resolve(dir, '.cebus', 'prompts')) ||
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir from path traversal up from cwd
      existsSync(resolve(dir, '.cebus', 'agents'))
    ) {
      _cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // marker not found — fall back to cwd
  _cachedRoot = process.cwd();
  return _cachedRoot;
}

/** Clear the cached project root (for testing). */
export function clearProjectRootCache(): void {
  _cachedRoot = undefined;
}
