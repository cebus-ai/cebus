import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const SAFE_GIT_ENV: Record<string, string> = {
  ...process.env as Record<string, string>,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

function safeGitExec(args: string[], cwd: string): string {
  return execFileSync('git', [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null',
    '-c', `safe.directory=${cwd}`,
    ...args,
  ], {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
    env: SAFE_GIT_ENV,
  }).trim();
}

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

export function buildProjectContext(workingDir: string): ProjectContext {
  const context: ProjectContext = {
    workingDir,
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

  try {
    const packageJsonPath = join(workingDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      context.projectName = packageJson.name ?? null;
      context.projectDescription = packageJson.description ?? null;

      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      context.techStack = Object.keys(deps).slice(0, 20);
    }
  } catch {
    // Expected: package.json may not exist or may be malformed
  }

  try {
    const readmeFiles = ['README.md', 'readme.md', 'README.txt', 'README'];
    for (const file of readmeFiles) {
      const readmePath = join(workingDir, file);
      if (existsSync(readmePath)) {
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

  try {
    const configFileNames = ['CLAUDE.md', '.claude/CLAUDE.md', 'COPILOT.md', '.github/copilot-instructions.md'];
    for (const file of configFileNames) {
      const filePath = join(workingDir, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        context.configFiles[file] = content.slice(0, 3000);
      }
    }
  } catch {
    // Expected: config files (CLAUDE.md, COPILOT.md) may not exist
  }

  try {
    context.gitBranch = safeGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], workingDir);
    context.gitStatus = safeGitExec(['status', '--short'], workingDir);
    context.recentCommits = safeGitExec(['log', '--oneline', '-5'], workingDir);
  } catch {
    // Expected: not a git repo or git not available on PATH
  }

  context.directoryStructure = buildDirectoryTree(workingDir, '', 0, 3);

  return context;
}

function buildDirectoryTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number
): string {
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
    const entries = readdirSync(dir);
    const filteredEntries = entries.filter((e) => !e.startsWith('.') || e === '.env.example');

    for (const entry of filteredEntries.slice(0, 30)) {
      const fullPath = join(dir, entry);

      try {
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

export function formatContextForPrompt(context: ProjectContext): string {
  const sections: string[] = [];

  sections.push('=== PROJECT CONTEXT ===');
  sections.push(`Working Directory: ${context.workingDir}`);

  if (context.projectName) {
    sections.push(`Project: ${context.projectName}`);
  }

  if (context.projectDescription) {
    sections.push(`Description: ${context.projectDescription}`);
  }

  if (context.techStack.length > 0) {
    sections.push(`Tech Stack: ${context.techStack.join(', ')}`);
  }

  if (context.gitBranch) {
    sections.push(`\nGit Branch: ${context.gitBranch}`);
  }

  if (context.gitStatus) {
    sections.push(`\nGit Status (changed files):\n${context.gitStatus}`);
  }

  if (context.recentCommits) {
    sections.push(`\nRecent Commits:\n${context.recentCommits}`);
  }

  if (context.directoryStructure) {
    sections.push(`\nProject Structure:\n${context.directoryStructure}`);
  }

  for (const [filename, content] of Object.entries(context.configFiles)) {
    sections.push(`\n=== ${filename} ===\n${content}`);
  }

  if (context.readmeContent) {
    sections.push(`\n=== README ===\n${context.readmeContent}`);
  }

  sections.push('\n=== END PROJECT CONTEXT ===');

  return sections.join('\n');
}

export function getProjectContextPrompt(workingDir: string): string {
  const context = buildProjectContext(workingDir);
  return formatContextForPrompt(context);
}

import type { ContextLevel } from './types.js';

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
      if (existsSync(filePath)) {
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
export function getContextByLevel(
  workingDir: string,
  level: ContextLevel
): ProjectContext {
  const context: ProjectContext = {
    workingDir,
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

  const claudeMd = readClaudeMd(workingDir);
  if (claudeMd) {
    context.configFiles['CLAUDE.md'] = claudeMd;
  }

  try {
    const packageJsonPath = join(workingDir, 'package.json');
    if (existsSync(packageJsonPath)) {
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

  try {
    context.gitBranch = safeGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], workingDir);
  } catch {
    // Expected: not a git repo or git not available on PATH
  }

  if (level === 'minimal') {
    return context;
  }

  try {
    const readmeFiles = ['README.md', 'readme.md', 'README.txt', 'README'];
    for (const file of readmeFiles) {
      const readmePath = join(workingDir, file);
      if (existsSync(readmePath)) {
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

  try {
    context.gitStatus = safeGitExec(['status', '--short'], workingDir);
    context.recentCommits = safeGitExec(['log', '--oneline', '-5'], workingDir);
  } catch {
    // Expected: not a git repo or git not available on PATH
  }

  context.directoryStructure = buildDirectoryTree(workingDir, '', 0, 3);

  return context;
}

export function formatContextByLevel(
  context: ProjectContext,
  level: ContextLevel
): string {
  const sections: string[] = [];

  if (level === 'none') {
    return '';
  }

  for (const [filename, content] of Object.entries(context.configFiles)) {
    sections.push(`=== ${filename} ===\n${content}`);
  }

  sections.push('\n=== PROJECT INFO ===');
  if (context.projectName) {
    sections.push(`Project: ${context.projectName}`);
  }
  if (context.gitBranch) {
    sections.push(`Branch: ${context.gitBranch}`);
  }

  if (level === 'minimal') {
    return sections.join('\n');
  }

  if (context.projectDescription) {
    sections.push(`Description: ${context.projectDescription}`);
  }

  if (context.techStack.length > 0) {
    sections.push(`Tech Stack: ${context.techStack.join(', ')}`);
  }

  if (context.gitStatus) {
    sections.push(`\nGit Status:\n${context.gitStatus}`);
  }

  if (context.recentCommits) {
    sections.push(`\nRecent Commits:\n${context.recentCommits}`);
  }

  if (context.directoryStructure) {
    sections.push(`\nProject Structure:\n${context.directoryStructure}`);
  }

  if (context.readmeContent) {
    sections.push(`\n=== README ===\n${context.readmeContent}`);
  }

  return sections.join('\n');
}

export function getContextPromptByLevel(
  workingDir: string,
  level: ContextLevel
): string {
  const context = getContextByLevel(workingDir, level);
  return formatContextByLevel(context, level);
}
