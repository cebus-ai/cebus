import { spawnSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { ContextLevel } from './types.js';

export interface ProjectContext {
  workingDir: string;
  projectName: string | null;
  projectDescription: string | null;
  techStack: string[];
  gitBranch: string | null;
  gitStatus: string | null;
  recentCommits: string | null;
  readmeContent: string | null;
  directoryStructure: string;
  configFiles: Record<string, string>;
}

/**
 * Validate that workingDir is a real, existing directory.
 * Returns the resolved absolute path or throws.
 */
function validateWorkingDir(workingDir: string): string {
  const resolved = resolve(workingDir);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolved from caller workingDir
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Working directory does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Run a git command safely using spawnSync with argument arrays.
 */
function gitCommand(args: string[], cwd: string): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim();
}

function buildDirectoryTree(dir: string, prefix: string, depth: number, maxDepth: number): string {
  if (depth > maxDepth) return '';

  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '.cache',
    'coverage',
  ]);

  let result = '';

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir from recursive tree walk
    const entries = readdirSync(dir);
    const filteredEntries = entries.filter(e => !e.startsWith('.') || e === '.env.example');

    for (const entry of filteredEntries.slice(0, 30)) {
      const fullPath = join(dir, entry);

      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- fullPath from dir + entry
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          if (!ignoreDirs.has(entry)) {
            result += `${prefix}${entry}/\n`;
            result += buildDirectoryTree(fullPath, prefix + '  ', depth + 1, maxDepth);
          }
        } else {
          result += `${prefix}${entry}\n`;
        }
      } catch {
        // Expected: file may be inaccessible (permissions, broken symlinks)
      }
    }
  } catch {
    // Expected: directory may be inaccessible (permissions)
  }

  return result;
}

const CLAUDE_MD_PATHS = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'COPILOT.md',
  '.github/copilot-instructions.md',
];

export function readClaudeMd(workingDir: string): string | null {
  for (const file of CLAUDE_MD_PATHS) {
    const filePath = join(workingDir, file);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath from known CLAUDE_MD_PATHS
      if (existsSync(filePath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath from known CLAUDE_MD_PATHS
        const content = readFileSync(filePath, 'utf-8');
        return content.slice(0, 5000);
      }
    } catch {
      // Expected: file may not exist or be unreadable, try next path
    }
  }
  return null;
}

/**
 * Get project context based on the specified level.
 *
 * | Level   | CLAUDE.md | Project Name | Git Branch | README | Dir Structure | Git Status |
 * |---------|-----------|--------------|------------|--------|---------------|------------|
 * | none    | ✅         | ❌            | ❌          | ❌      | ❌             | ❌          |
 * | minimal | ✅         | ✅            | ✅          | ❌      | ❌             | ❌          |
 * | full    | ✅         | ✅            | ✅          | ✅      | ✅             | ✅          |
 */
export function getContextByLevel(workingDir: string, level: ContextLevel): ProjectContext {
  let validDir: string;
  try {
    validDir = validateWorkingDir(workingDir);
  } catch {
    validDir = workingDir; // Fall back to unvalidated path for non-existent dirs
  }

  const context: ProjectContext = {
    workingDir: validDir,
    projectName: null,
    projectDescription: null,
    techStack: [],
    gitBranch: null,
    gitStatus: null,
    recentCommits: null,
    readmeContent: null,
    directoryStructure: '',
    configFiles: {},
  };

  if (level === 'none') {
    return context;
  }

  const claudeMd = readClaudeMd(validDir);
  if (claudeMd !== null) {
    context.configFiles['CLAUDE.md'] = claudeMd;
  }

  try {
    const packageJsonPath = join(validDir, 'package.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- packageJsonPath from validated dir
    if (existsSync(packageJsonPath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- packageJsonPath from validated dir
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      context.projectName = packageJson.name ?? null;
      if (level === 'full') {
        context.projectDescription = packageJson.description ?? null;
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        context.techStack = Object.keys(deps).slice(0, 20);
      }
    }
  } catch {
    // Expected: package.json may not exist or may be malformed
  }

  context.gitBranch = gitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], validDir);

  if (level === 'minimal') {
    return context;
  }

  try {
    const readmeFiles = ['README.md', 'readme.md', 'README.txt', 'README'];
    for (const file of readmeFiles) {
      const readmePath = join(validDir, file);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- readmePath from known file list
      if (existsSync(readmePath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- readmePath from known file list
        const content = readFileSync(readmePath, 'utf-8');
        context.readmeContent = content.slice(0, 2000);
        if (content.length > 2000) {
          context.readmeContent += '\n... (truncated)';
        }
        break;
      }
    }
  } catch {
    // Expected: README file may not exist or may be unreadable
  }

  context.gitStatus = gitCommand(['status', '--short'], validDir);
  context.recentCommits = gitCommand(['log', '--oneline', '-5'], validDir);

  context.directoryStructure = buildDirectoryTree(validDir, '', 0, 3);

  return context;
}

export function formatContextByLevel(context: ProjectContext, level: ContextLevel): string {
  const sections: string[] = [];

  if (level === 'none') {
    return '';
  }

  for (const [filename, content] of Object.entries(context.configFiles)) {
    sections.push(`=== ${filename} ===\n${content}`);
  }

  sections.push('\n=== PROJECT INFO ===');
  if (context.projectName !== null) {
    sections.push(`Project: ${context.projectName}`);
  }
  if (context.gitBranch !== null) {
    sections.push(`Branch: ${context.gitBranch}`);
  }

  if (level === 'minimal') {
    return sections.join('\n');
  }

  if (context.projectDescription !== null) {
    sections.push(`Description: ${context.projectDescription}`);
  }

  if (context.techStack.length > 0) {
    sections.push(`Tech Stack: ${context.techStack.join(', ')}`);
  }

  if (context.gitStatus !== null) {
    sections.push(`\nGit Status:\n${context.gitStatus}`);
  }

  if (context.recentCommits !== null) {
    sections.push(`\nRecent Commits:\n${context.recentCommits}`);
  }

  if (context.directoryStructure.length > 0) {
    sections.push(`\nProject Structure:\n${context.directoryStructure}`);
  }

  if (context.readmeContent !== null) {
    sections.push(`\n=== README ===\n${context.readmeContent}`);
  }

  return sections.join('\n');
}

export function getContextPromptByLevel(workingDir: string, level: ContextLevel): string {
  const context = getContextByLevel(workingDir, level);
  return formatContextByLevel(context, level);
}
