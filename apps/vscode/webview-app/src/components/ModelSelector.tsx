import React, { useState, useEffect } from 'react';
import type { ProviderModelsInfo } from '../hooks/useVSCodeMessages';
import { resolveProviderStyle, PROVIDER_STYLES } from '../lib/provider-styles';

interface ModelSelectorProps {
  availableModels: ProviderModelsInfo[];
  modelsLoaded: boolean;
  error: string | null;
  mascotUri: string | null;
  onCreateSession: (
    models: Array<{ providerId: string; modelId: string; displayName: string }>,
    chatMode: string
  ) => void;
  onRequestModels: () => void;
  onBack: () => void;
}

const CHAT_MODES = [
  { value: 'free_chat', label: 'Free Chat' },
  { value: 'sequential', label: 'Sequential' },
  { value: 'tag_only', label: '@Mention' },
  { value: 'role_based', label: 'Role Based' },
] as const;

export function ModelSelector({
  availableModels,
  modelsLoaded,
  error,
  mascotUri,
  onCreateSession,
  onRequestModels,
  onBack,
}: ModelSelectorProps): React.ReactElement {
  const [selectedModels, setSelectedModels] = useState<
    Array<{ providerId: string; modelId: string; displayName: string }>
  >([]);
  const [chatMode, setChatMode] = useState('free_chat');

  useEffect(() => {
    if (availableModels.length === 0 && !modelsLoaded) {
      onRequestModels();
    }
  }, [availableModels.length, modelsLoaded, onRequestModels]);

  const toggleModel = (providerId: string, modelId: string, displayName: string): void => {
    setSelectedModels(prev => {
      const exists = prev.some(m => m.providerId === providerId && m.modelId === modelId);
      if (exists) {
        return prev.filter(m => !(m.providerId === providerId && m.modelId === modelId));
      }
      return [...prev, { providerId, modelId, displayName }];
    });
  };

  const handleStart = (): void => {
    if (selectedModels.length === 0) return;
    onCreateSession(selectedModels, chatMode);
  };

  if (availableModels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-muted">
        <div className="text-center">
          {error ? (
            <>
              <div className="mb-2 text-2xl">&#x26A0;&#xFE0F;</div>
              <p className="text-error text-sm">{error}</p>
              <button
                onClick={onRequestModels}
                className="mt-3 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary-hover"
              >
                Retry
              </button>
            </>
          ) : modelsLoaded ? (
            <>
              <div className="mb-2 text-2xl">&#x1F50C;</div>
              <p className="text-sm font-medium text-foreground">No models available</p>
              <p className="mt-2 text-xs">
                Configure API keys to get started:
              </p>
              <p className="mt-1 text-xs">
                Open Command Palette and run <code className="rounded bg-badge px-1 py-0.5 text-[10px]">Cebus: Configure API Keys</code>
              </p>
              <button
                onClick={onRequestModels}
                className="mt-3 rounded-md bg-secondary px-4 py-1.5 text-sm text-secondary-foreground hover:opacity-80"
              >
                Refresh
              </button>
            </>
          ) : (
            <>
              {mascotUri ? (
                <img src={mascotUri} alt="Cebus" className="mx-auto mb-3 h-10 w-10 animate-pulse rounded-full" />
              ) : (
                <div className="mb-3 flex justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
              <p className="text-sm">Discovering models...</p>
              <p className="mt-1 text-[11px] text-muted">Checking configured providers</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3">
      {/* Header with back button and branding */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-badge/40 hover:text-foreground"
          title="Back to conversations"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3L5 7L9 11" />
          </svg>
        </button>
        {mascotUri && (
          <img src={mascotUri} alt="Cebus" className="h-5 w-5 rounded-full" />
        )}
        <h2 className="text-base font-semibold">New Group Chat</h2>
      </div>

      {/* Chat mode segmented pills */}
      <div className="mb-3">
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted">
          Mode
        </label>
        <div className="flex rounded-md bg-badge/50 p-0.5">
          {CHAT_MODES.map(mode => (
            <button
              key={mode.value}
              onClick={() => setChatMode(mode.value)}
              className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
                chatMode === mode.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model list */}
      <div className="mb-3 flex-1 overflow-y-auto">
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted">
          Models
        </label>
        {availableModels.map(provider => {
          const providerStyle =
            PROVIDER_STYLES[provider.providerId] ?? PROVIDER_STYLES['default']!;
          return (
            <div key={provider.providerId} className="mb-3">
              <div
                className="mb-1.5 flex items-center gap-1.5 border-l-2 pl-2 text-xs font-semibold"
                style={{ borderColor: providerStyle.color, color: providerStyle.color }}
              >
                <span className="text-sm leading-none">{providerStyle.icon}</span>
                {provider.providerName}
              </div>
              {provider.models.map(model => {
                const isSelected = selectedModels.some(
                  m => m.providerId === provider.providerId && m.modelId === model.modelId
                );
                const modelStyle = resolveProviderStyle(provider.providerId, model.modelId);
                return (
                  <button
                    key={model.modelId}
                    onClick={() => toggleModel(provider.providerId, model.modelId, model.displayName)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-primary/12 text-foreground'
                        : 'text-muted hover:bg-badge/30 hover:text-foreground'
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span
                      className="text-xs leading-none"
                      style={{ color: modelStyle.color }}
                    >
                      {modelStyle.icon}
                    </span>
                    <span className="truncate">{model.displayName}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Selected chips + Start */}
      {selectedModels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selectedModels.map(m => {
            const s = resolveProviderStyle(m.providerId, m.modelId);
            return (
              <span
                key={`${m.providerId}:${m.modelId}`}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: `${s.color}18`, color: s.color }}
              >
                {s.icon} {m.displayName}
                <button
                  onClick={() => toggleModel(m.providerId, m.modelId, m.displayName)}
                  className="ml-0.5 hover:opacity-70"
                >
                  &#x2715;
                </button>
              </span>
            );
          })}
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={selectedModels.length === 0}
        className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Chat ({selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''})
      </button>
    </div>
  );
}
