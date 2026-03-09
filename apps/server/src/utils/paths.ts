import { resolve, sep, parse } from 'path';

/** Check that a resolved path is within the given base directory (case-insensitive on Windows). */
export function isWithinDir(filePath: string, baseDir: string): boolean {
  const nPath = resolve(filePath);
  const nBase = resolve(baseDir);
  if (process.platform === 'win32') {
    return (
      nPath.toLowerCase().startsWith(nBase.toLowerCase() + sep) ||
      nPath.toLowerCase() === nBase.toLowerCase()
    );
  }
  return nPath.startsWith(nBase + sep) || nPath === nBase;
}

/** Check that two paths share the same drive root (always true on Unix). */
export function isSameDrive(pathA: string, pathB: string): boolean {
  if (process.platform !== 'win32') return true;
  const rootA = parse(resolve(pathA)).root.toLowerCase();
  const rootB = parse(resolve(pathB)).root.toLowerCase();
  return rootA === rootB;
}
