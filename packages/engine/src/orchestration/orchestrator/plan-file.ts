import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { findProjectRoot } from '../../core/project-root.js';
import type { OrchestratorPlan, OrchestratorPlanFile } from '../types.js';

function getPlanDir(): string {
  return resolve(findProjectRoot(), '.cebus', '.plans');
}

function getPlanPath(sessionId: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(getPlanDir(), `${safeId}.md`);
}

function planToMarkdown(plan: OrchestratorPlan): string {
  const lines: string[] = [
    '# Orchestrator Plan',
    `> ${plan.description}`,
    `**Estimated rounds:** ${plan.estimatedRounds} | **Cost:** ${plan.estimatedCost}`,
    '',
    '## Steps',
  ];

  for (let idx = 0; idx < plan.steps.length; idx++) {
    const step = plan.steps[idx]!;
    const dep = step.dependsOn !== undefined ? ` (after step ${step.dependsOn + 1})` : '';
    lines.push(`- [ ] **Step ${idx + 1}** — \`${step.agentId}\`: ${step.action}${dep}`);
  }

  lines.push('---');
  lines.push(`*Generated at ${new Date().toISOString()}*`);
  return lines.join('\n');
}

export function writePlanFile(sessionId: string, plan: OrchestratorPlan): OrchestratorPlanFile {
  const planPath = getPlanPath(sessionId);
  const dir = dirname(planPath);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir derived from project root
  mkdirSync(dir, { recursive: true });

  const content = planToMarkdown(plan);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- planPath derived from project root
  writeFileSync(planPath, content, 'utf-8');

  return {
    path: planPath,
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

export function readPlanFile(sessionId: string): string | null {
  const planPath = getPlanPath(sessionId);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- planPath derived from project root
    return readFileSync(planPath, 'utf-8');
  } catch {
    return null;
  }
}

export function updatePlanStepStatus(
  sessionId: string,
  stepIndex: number,
  status: 'pending' | 'in_progress' | 'done' | 'skipped'
): void {
  const content = readPlanFile(sessionId);
  if (content === null) return;

  const checkboxMap: Record<string, string> = {
    pending: '[ ]',
    in_progress: '[>]',
    done: '[x]',
    skipped: '[~]',
  };

  const lines = content.split('\n');
  let stepCount = 0;
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop index
    const line = lines[i]!;
    const match = /^- \[[ x>~]\] \*\*Step \d+\*\*/.exec(line);
    if (match) {
      if (stepCount === stepIndex) {
        // eslint-disable-next-line security/detect-object-injection -- status from function param typed union
        const newCheckbox = checkboxMap[status] ?? '[ ]';
        // eslint-disable-next-line security/detect-object-injection -- i is a loop index
        lines[i] = line.replace(/\[[ x>~]\]/, newCheckbox);
        break;
      }
      stepCount++;
    }
  }

  const planPath = getPlanPath(sessionId);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- planPath derived from project root
  writeFileSync(planPath, lines.join('\n'), 'utf-8');
}

export function batchUpdatePlanStepStatuses(
  sessionId: string,
  updates: ReadonlyArray<{ stepIndex: number; status: 'pending' | 'in_progress' | 'done' | 'skipped' }>,
): void {
  if (updates.length === 0) return;

  const content = readPlanFile(sessionId);
  if (content === null) return;

  const checkboxMap: Record<string, string> = {
    pending: '[ ]',
    in_progress: '[>]',
    done: '[x]',
    skipped: '[~]',
  };

  const updatesByIndex = new Map(updates.map(u => [u.stepIndex, u.status]));

  const lines = content.split('\n');
  let stepCount = 0;
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop index
    const line = lines[i]!;
    const match = /^- \[[ x>~]\] \*\*Step \d+\*\*/.exec(line);
    if (match) {
      const status = updatesByIndex.get(stepCount);
      if (status !== undefined) {
        // eslint-disable-next-line security/detect-object-injection -- status from typed union
        const newCheckbox = checkboxMap[status] ?? '[ ]';
        // eslint-disable-next-line security/detect-object-injection -- i is a loop index
        lines[i] = line.replace(/\[[ x>~]\]/, newCheckbox);
      }
      stepCount++;
    }
  }

  const planPath = getPlanPath(sessionId);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- planPath derived from project root
  writeFileSync(planPath, lines.join('\n'), 'utf-8');
}

export function deletePlanFile(sessionId: string): void {
  const planPath = getPlanPath(sessionId);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- planPath derived from project root
    unlinkSync(planPath);
  } catch {
    // File may not exist — ignore
  }
}
