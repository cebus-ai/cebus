import type {
  CostTier,
  TieredModel,
  AgentMode,
  ChatMode,
  OrchestratorConfig,
  RoleTemplate,
  OrchestratorLLMOption,
} from '@cebus/engine';

export type OnboardingStep =
  | 'permission'
  | 'cost-preference'
  | 'select-models'
  | 'select-mode'
  | 'ask-orchestrator'
  | 'select-orchestrator'
  | 'ask-roles'
  | 'assign-roles'
  | 'ask-agent-mode'
  | 'assign-agent-mode'
  | 'confirm';

export interface AvailableModel {
  spec: string;
  displayName: string;
  provider: string;
  providerName: string;
  nickname: string;
  tier: CostTier;
  /** Whether this model supports worker mode (file editing, shell commands) */
  workerCapable?: boolean | undefined;
}

export interface ChatModeItem {
  mode: ChatMode;
  label: string;
  description: string;
}

export const CHAT_MODES: readonly ChatModeItem[] = [
  { mode: 'free_chat', label: 'All at Once', description: 'All models respond simultaneously in parallel' },
  { mode: 'sequential', label: 'One by One', description: 'Models take turns responding one after another' },
  { mode: 'tag_only', label: 'Mention Only', description: 'Models respond only when you @mention them' },
  { mode: 'raw', label: 'Raw', description: 'Direct model access — no system prompts or context' },
] as const;

export interface OnboardingState {
  folderAccess: boolean;
  costPreference: CostTier;
  allModels: TieredModel[];
  availableModels: AvailableModel[];
  selectedSpecs: string[];
  expandedProviders: Map<string, number>;
  chatMode: ChatMode;
  roleAssignments: Map<string, string>;
  roleTemplates: readonly RoleTemplate[];
  orchestratorEnabled: boolean;
  allOrchestratorOptions: OrchestratorLLMOption[];
  orchestratorOptions: OrchestratorLLMOption[];
  expandedOrchestratorProviders: Set<string>;
  orchestratorSpec: string | null;
  providerErrors: Map<string, string>;
  error: string | null;
}

export type OnboardingAction =
  | { type: 'setFolderAccess'; value: boolean }
  | { type: 'goToStep'; step: OnboardingStep }
  | { type: 'setCostPreference'; value: CostTier }
  | { type: 'setAllModels'; value: TieredModel[] }
  | { type: 'setAvailableModels'; value: AvailableModel[] }
  | { type: 'setSelectedSpecs'; value: string[] }
  | { type: 'setExpandedProviders'; value: Map<string, number> }
  | { type: 'setChatMode'; value: ChatMode }
  | { type: 'setRoleAssignments'; value: Map<string, string> }
  | { type: 'setRoleTemplates'; value: readonly RoleTemplate[] }
  | { type: 'setOrchestratorEnabled'; value: boolean }
  | { type: 'setAllOrchestratorOptions'; value: OrchestratorLLMOption[] }
  | { type: 'setOrchestratorOptions'; value: OrchestratorLLMOption[] }
  | { type: 'setExpandedOrchestratorProviders'; value: Set<string> }
  | { type: 'setOrchestratorSpec'; value: string | null }
  | { type: 'setProviderErrors'; value: Map<string, string> }
  | { type: 'setError'; value: string | null }
  | { type: 'setAgentModeAssignments'; value: Map<string, AgentMode> }
  | { type: 'replaceStep'; step: OnboardingStep }
  | { type: 'goBack' }
  | { type: 'requestExit' }
  | { type: 'complete'; orchestratorConfig?: OrchestratorConfig | undefined };
