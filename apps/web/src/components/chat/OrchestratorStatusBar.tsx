import type React from 'react';
import { Brain, ListTodo, Zap, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type {
  OrchestratorPhase,
  OrchestratorRequest,
  OrchestratorStepResult,
  OrchestratorError,
} from '@/hooks/useStream';

interface OrchestratorStatusBarProps {
  phase: OrchestratorPhase;
  request: OrchestratorRequest | null;
  stepResult: OrchestratorStepResult | null;
  error?: OrchestratorError | null | undefined;
}

const PHASE_ICONS: Record<OrchestratorPhase, { icon: typeof Brain; color: string }> = {
  idle: { icon: Brain, color: 'text-muted-foreground' },
  analyzing: { icon: Brain, color: 'text-blue-400' },
  planning: { icon: ListTodo, color: 'text-purple-400' },
  executing: { icon: Zap, color: 'text-yellow-400' },
  reviewing: { icon: Search, color: 'text-orange-400' },
  complete: { icon: CheckCircle2, color: 'text-green-400' },
};

const PHASE_LABEL_KEYS: Record<OrchestratorPhase, 'orchestrator.idle' | 'orchestrator.analyzing' | 'orchestrator.planning' | 'orchestrator.executing' | 'orchestrator.reviewing' | 'orchestrator.complete'> = {
  idle: 'orchestrator.idle',
  analyzing: 'orchestrator.analyzing',
  planning: 'orchestrator.planning',
  executing: 'orchestrator.executing',
  reviewing: 'orchestrator.reviewing',
  complete: 'orchestrator.complete',
};

export function OrchestratorStatusBar({ phase, request, stepResult, error }: OrchestratorStatusBarProps): React.ReactElement {
  const { t } = useI18n();
  // eslint-disable-next-line security/detect-object-injection -- phase is a typed union, not user input
  const config = PHASE_ICONS[phase];
  // eslint-disable-next-line security/detect-object-injection -- phase is a typed union, not user input
  const label = t(PHASE_LABEL_KEYS[phase]);
  const Icon = config.icon;
  const isActive = phase !== 'idle' && phase !== 'complete';
  const hasPlanContext = stepResult !== null || (request !== null && request.planStepIndex !== undefined);

  if (hasPlanContext) {
    return (
      <div className="flex flex-col gap-0.5 px-3 py-1.5 text-xs border-b border-border/50 bg-muted/30">
        {stepResult && (
          <div className="flex items-center gap-1.5 text-green-400">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{t('orchestrator.done')}: {stepResult.resultSummary}</span>
          </div>
        )}
        {request && (
          <div className={`flex items-center gap-1.5 ${config.color}`}>
            <Zap className="h-3 w-3 shrink-0" />
            {isActive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
            <span className="truncate">{t('orchestrator.now')}: {request.summary}</span>
          </div>
        )}
        {stepResult?.nextStepSummary !== undefined && stepResult.nextStepSummary.length > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="ml-0.5 mr-0.5">&rarr;</span>
            <span className="truncate">{stepResult.nextStepSummary}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-1.5 text-yellow-500">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error.message}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b border-border/50 bg-muted/30">
      <div className={`flex items-center gap-2 px-3 py-1.5 text-xs ${config.color}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {isActive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
        <span className="font-medium">{label}</span>
        {request && <span className="text-muted-foreground truncate">— {request.summary}</span>}
      </div>
      {error && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-yellow-500">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{error.message}</span>
        </div>
      )}
    </div>
  );
}
