/**
 * Tool Approval Manager
 *
 * T036a: Classifies tool names against readOnly/write/dangerous patterns.
 * T036b: Integration with worker execution for dangerous tool interrupts.
 *
 * Single Responsibility: Classify tools by risk tier.
 * Open/Closed: New tiers add patterns, no code changes needed.
 */

import type { ToolApprovalConfig } from '../types.js';

export type ToolTier = 'readOnly' | 'write' | 'dangerous';

export class ToolApprovalManager {
  private readonly enabled: boolean;
  private readonly dangerousPatterns: string[];
  private readonly readOnlyPatterns: string[];
  private readonly writePatterns: string[];

  constructor(config?: ToolApprovalConfig) {
    this.enabled = config?.enabled ?? false;
    this.dangerousPatterns = config?.dangerous ?? [];
    this.readOnlyPatterns = config?.readOnly ?? [];
    this.writePatterns = config?.write ?? [];
  }

  /**
   * Classify a tool name into a permission tier.
   *
   * Resolution order (first match wins):
   * 1. dangerous → require approval
   * 2. readOnly → always allow
   * 3. write → allow + log
   * 4. No match → treat as write
   */
  classify(toolName: string): ToolTier {
    if (!this.enabled) return 'write';

    if (this.matchesAny(toolName, this.dangerousPatterns)) return 'dangerous';
    if (this.matchesAny(toolName, this.readOnlyPatterns)) return 'readOnly';
    if (this.matchesAny(toolName, this.writePatterns)) return 'write';

    return 'write';
  }

  /**
   * Check if a tool requires human approval.
   */
  requiresApproval(toolName: string): boolean {
    return this.classify(toolName) === 'dangerous';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private matchesAny(toolName: string, patterns: string[]): boolean {
    return patterns.some(pattern => this.matchGlob(toolName, pattern));
  }

  /**
   * Simple glob matching supporting * wildcard.
   * Supports patterns like: 'read_file', 'list_*', 'rm_*', '*_delete'
   */
  private matchGlob(name: string, pattern: string): boolean {
    // Exact match
    if (pattern === name) return true;

    // Convert glob to regex (collapse consecutive wildcards to prevent ReDoS)
    const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*');

    // eslint-disable-next-line security/detect-non-literal-regexp -- regexStr built from sanitized glob pattern above
    return new RegExp(`^${regexStr}$`).test(name);
  }
}
