import { useState } from 'react';
import type React from 'react';
import { CheckCircle2, Circle, ListTodo, XCircle } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

interface PlanStep {
  agentId: string;
  action: string;
  dependsOn?: number;
}

interface PlanCardProps {
  description: string;
  steps: PlanStep[];
  estimatedRounds: number;
  estimatedCost: string;
  awaitingApproval: boolean;
  onApprove?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
}

export function PlanCard({
  description,
  steps,
  estimatedRounds,
  estimatedCost,
  awaitingApproval,
  onApprove,
  onReject,
}: PlanCardProps): React.ReactElement {
  const [responded, setResponded] = useState<'approved' | 'rejected' | null>(null);
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ListTodo className="h-4 w-4 text-purple-400" />
        {t('plan.title')}
      </div>

      <p className="text-sm text-muted-foreground">{description}</p>

      <ol className="space-y-1.5 text-sm">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <Circle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">{step.agentId}</span>
              <span className="text-muted-foreground">: {step.action}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t border-border/50">
        <span>{estimatedRounds} {t('plan.rounds')}</span>
        <span>{estimatedCost} {t('plan.cost')}</span>
      </div>

      {awaitingApproval && responded === null && onApprove && onReject && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { setResponded('approved'); onApprove(); }}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
          >
            <CheckCircle2 className="h-3 w-3" />
            {t('plan.approve')}
          </button>
          <button
            onClick={() => { setResponded('rejected'); onReject(); }}
            className="inline-flex items-center rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80"
          >
            {t('plan.reject')}
          </button>
        </div>
      )}

      {responded === 'approved' && (
        <div className="flex items-center gap-1.5 text-xs text-green-400 pt-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('plan.approved')}
        </div>
      )}

      {responded === 'rejected' && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
          <XCircle className="h-3 w-3" />
          {t('plan.rejected')}
        </div>
      )}
    </div>
  );
}
