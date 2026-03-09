import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

export interface RoleTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly instructions: string;
  readonly skills: string[];
  /** True when loaded from a .cebus/agents file */
  readonly isProjectAgent?: boolean | undefined;
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    id: 'developer',
    label: 'Developer',
    description: 'Writes code, designs architecture, debugs issues',
    instructions: [
      'You are the Developer on this team.',
      'Focus on writing clean, correct, well-structured code.',
      'Design architecture decisions and explain trade-offs.',
      'Debug issues by reasoning through root causes.',
      'Suggest improvements to code quality and maintainability.',
    ].join('\n'),
    skills: ['coding', 'architecture', 'debugging', 'refactoring'],
  },
  {
    id: 'qa-tester',
    label: 'QA / Tester',
    description: 'Reviews for bugs, suggests tests, validates edge cases',
    instructions: [
      'You are the QA / Tester on this team.',
      'Review code and proposals for bugs, edge cases, and regressions.',
      'Suggest specific test cases (unit, integration, e2e) with examples.',
      'Validate inputs, boundary conditions, and error handling.',
      'Challenge assumptions and ask "what if" questions.',
    ].join('\n'),
    skills: ['testing', 'code-review', 'edge-cases', 'validation'],
  },
  {
    id: 'designer',
    label: 'Designer',
    description: 'Focuses on UX, API design, and user-facing clarity',
    instructions: [
      'You are the Designer on this team.',
      'Focus on user experience, interface clarity, and usability.',
      'Evaluate API surfaces for developer ergonomics.',
      'Suggest naming conventions that are intuitive and consistent.',
      'Advocate for simplicity and discoverability in all interfaces.',
    ].join('\n'),
    skills: ['ux-design', 'api-design', 'naming', 'usability'],
  },
  {
    id: 'product-manager',
    label: 'Product Manager',
    description: 'Prioritizes features, validates requirements',
    instructions: [
      'You are the Product Manager on this team.',
      'Prioritize features based on user impact and effort.',
      'Validate that requirements are clear, complete, and testable.',
      'Ask clarifying questions about scope and acceptance criteria.',
      'Keep the team focused on delivering user value.',
    ].join('\n'),
    skills: ['requirements', 'prioritization', 'scope', 'user-stories'],
  },
  {
    id: 'security-auditor',
    label: 'Security Auditor',
    description: 'Reviews for vulnerabilities, access control, data safety',
    instructions: [
      'You are the Security Auditor on this team.',
      'Review code and designs for security vulnerabilities (OWASP Top 10).',
      'Check access control, authentication, and authorization logic.',
      'Identify data exposure risks and suggest mitigations.',
      'Recommend secure defaults and defense-in-depth strategies.',
    ].join('\n'),
    skills: ['security', 'access-control', 'vulnerability-review', 'data-safety'],
  },
  {
    id: 'technical-writer',
    label: 'Technical Writer',
    description: 'Writes docs, reviews readability',
    instructions: [
      'You are the Technical Writer on this team.',
      'Write clear, concise documentation and explanations.',
      'Review code comments and docs for readability and accuracy.',
      'Suggest improvements to naming, error messages, and log output.',
      'Ensure knowledge is captured and accessible to the team.',
    ].join('\n'),
    skills: ['documentation', 'readability', 'communication', 'knowledge-sharing'],
  },
] as const;

/**
 * Get a role template by ID (searches both built-in and cached project agents).
 */
export function getRoleTemplate(id: string): RoleTemplate | undefined {
  // Check cached project agents first, then built-in
  const cached = _cachedProjectAgents;
  if (cached) {
    const found = cached.find(t => t.id === id);
    if (found) return found;
  }
  return ROLE_TEMPLATES.find(t => t.id === id);
}

// Cache for project agents (loaded per working directory)
let _cachedProjectAgents: RoleTemplate[] | undefined;
let _cachedProjectDir: string | undefined;

/**
 * Parse YAML frontmatter from an agent.md file.
 * Returns { name, description } or undefined if parsing fails.
 */
function parseFrontmatter(content: string): { name: string; description: string } | undefined {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch === null || fmMatch[1] === undefined) return undefined;

  const frontmatter = fmMatch[1];
  const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
  const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);

  const name = nameMatch?.[1]?.trim();
  const description = descMatch?.[1]?.trim();

  if (name === undefined || name.length === 0) return undefined;
  return { name, description: description ?? name };
}

/**
 * Derive a stable ID from a filename.
 * e.g., "product-manager.agent.md" → "product-manager"
 */
function fileToId(filename: string): string {
  return basename(filename, '.agent.md')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Load project agent definitions from .cebus/agents/*.agent.md files.
 * Returns the templates if found, or an empty array if no agents directory exists.
 * Results are cached per workingDir.
 */
export function loadProjectAgents(workingDir: string): RoleTemplate[] {
  if (_cachedProjectDir === workingDir && _cachedProjectAgents !== undefined) {
    return _cachedProjectAgents;
  }

  const agentsDir = join(workingDir, '.cebus', 'agents');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- agentsDir from workingDir param
  if (!existsSync(agentsDir)) {
    _cachedProjectDir = workingDir;
    _cachedProjectAgents = [];
    return [];
  }

  const templates: RoleTemplate[] = [];

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- agentsDir from workingDir param
    const files = readdirSync(agentsDir)
      .filter(f => f.endsWith('.agent.md'))
      .sort();

    for (const file of files) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- file from readdirSync
        const content = readFileSync(join(agentsDir, file), 'utf-8');
        const meta = parseFrontmatter(content);
        if (!meta) continue;

        // The full markdown content (including frontmatter) serves as instructions
        // Strip the frontmatter for cleaner instructions
        const instructionBody = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();

        const MAX_DESCRIPTION_DISPLAY = 80;
        templates.push({
          id: fileToId(file),
          label: meta.name,
          description:
            meta.description.length > MAX_DESCRIPTION_DISPLAY
              ? meta.description.substring(0, MAX_DESCRIPTION_DISPLAY - 3) + '...'
              : meta.description,
          instructions: instructionBody,
          skills: [],
          isProjectAgent: true,
        });
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Directory read failed
  }

  _cachedProjectDir = workingDir;
  _cachedProjectAgents = templates;
  return templates;
}

/**
 * Get the role templates to use for role assignment.
 * If .cebus/agents/ exists in the working directory, uses those exclusively.
 * Otherwise falls back to built-in ROLE_TEMPLATES.
 */
export function getAvailableRoleTemplates(workingDir: string): readonly RoleTemplate[] {
  const projectAgents = loadProjectAgents(workingDir);
  if (projectAgents.length > 0) {
    return projectAgents;
  }
  return ROLE_TEMPLATES;
}
