import { getCopilotUnderlyingColor, PROVIDER_STYLES } from '../../lib/provider-styles';

interface AgentNameProps {
  displayName: string;
  provider?: string | undefined;
  modelId?: string | null | undefined;
}

export function AgentName({ displayName, provider, modelId }: AgentNameProps) {
  if (provider === 'copilot' && modelId && displayName.includes('(Copilot)')) {
    const underlyingColor = getCopilotUnderlyingColor(modelId);
    if (underlyingColor) {
      const idx = displayName.lastIndexOf(' (Copilot)');
      const modelName = displayName.substring(0, idx);
      return (
        <>
          <span style={{ color: underlyingColor }}>{modelName}</span>
          <span style={{ color: PROVIDER_STYLES.copilot!.color }}> (Copilot)</span>
        </>
      );
    }
  }
  return <>{displayName}</>;
}
