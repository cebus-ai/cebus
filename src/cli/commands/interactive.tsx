import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { Onboarding } from '../components/Onboarding';
import { ChatApp } from '../app';
import {
  createSession,
  addUserParticipant,
  addModelParticipant,
  addOrchestratorParticipant,
  updateOrchestratorConfig,
} from '../../core/session';
import {
  initializeProviders,
  getProviderRegistry,
  registerBuiltInProviders,
} from '../../providers';
import { saveLastConfig, loadLastConfig, type SavedConfig } from '../../core/config-persistence';
import { CHAT_MODE_LABELS } from '../ui/constants';
import type { ChatMode, OrchestratorConfig } from '../../core/types';

interface InteractiveAppProps {
  workingDir: string;
}

type AppState = 'restore-prompt' | 'onboarding' | 'restoring' | 'chat' | 'cancelled';

interface RestorePromptProps {
  config: SavedConfig;
  onRestore: () => void;
  onNewSetup: () => void;
}

function RestorePrompt({ config, onRestore, onNewSetup }: RestorePromptProps): React.ReactElement {
  useInput((input, key) => {
    if (input.toLowerCase() === 'y' || key.return) {
      onRestore();
    } else if (input.toLowerCase() === 'n' || key.escape) {
      onNewSetup();
    }
  });

  const modelNames = config.selectedModels.map(spec => {
    const colonIndex = spec.indexOf(':');
    return colonIndex === -1 ? spec : spec.substring(colonIndex + 1);
  });

  const modeLabel = CHAT_MODE_LABELS[config.chatMode] ?? config.chatMode;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Restore Last Configuration?
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        {modelNames.map((name, i) => (
          <Text key={i} color="green">
            {'• '}
            {name}
          </Text>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text>Chat mode: </Text>
        <Text bold color="yellow">
          {modeLabel}
        </Text>
      </Box>

      {config.orchestratorConfig?.enabled && (
        <Box marginBottom={1}>
          <Text>Orchestrator: </Text>
          <Text bold color="magenta">
            {config.orchestratorConfig.modelId}
          </Text>
        </Box>
      )}

      <Box>
        <Text>
          Restore? <Text color="green">[Y]es / Enter</Text> / <Text color="yellow">[N]o / Esc</Text>
        </Text>
      </Box>
    </Box>
  );
}

function InteractiveApp({ workingDir }: InteractiveAppProps): React.ReactElement {
  const [savedConfig] = useState<SavedConfig | null>(() => loadLastConfig());
  const [state, setState] = useState<AppState>(savedConfig ? 'restore-prompt' : 'onboarding');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOnboardingComplete(
    selectedModels: string[],
    folderAccess: boolean,
    chatMode: ChatMode,
    roleAssignments: Map<string, string>,
    orchestratorConfig?: OrchestratorConfig | undefined
  ): Promise<void> {
    try {
      await initializeProviders();

      // Save config for next startup
      saveLastConfig(selectedModels, folderAccess, chatMode, roleAssignments, orchestratorConfig);

      // Create session — disable project context when user declined folder access
      const session = createSession({
        title: 'Cebus Chat',
        contextConfig: { level: folderAccess ? 'minimal' : 'none' },
        chatMode,
        orchestratorConfig,
      });

      addUserParticipant(session.id, {
        displayName: 'You',
        nickname: 'User',
      });

      const registry = getProviderRegistry();
      for (const spec of selectedModels) {
        // Split only on the first colon to preserve model tags (e.g., ollama:deepseek-r1:1.5b)
        const colonIndex = spec.indexOf(':');
        if (colonIndex === -1) continue;

        const providerId = spec.substring(0, colonIndex);
        const modelId = spec.substring(colonIndex + 1);
        if (!providerId || !modelId) continue;

        const provider = registry.get(providerId);
        if (!provider) continue;

        const models = await provider.listModels();
        const modelInfo = models.find(m => m.id === modelId);

        const role = chatMode === 'role_based' ? roleAssignments.get(spec) : undefined;

        addModelParticipant(session.id, providerId, modelId, {
          nickname: modelInfo?.defaultNickname,
          role,
        });
      }

      if (orchestratorConfig?.enabled) {
        const svParticipant = addOrchestratorParticipant(
          session.id,
          orchestratorConfig.providerId,
          orchestratorConfig.modelId
        );
        updateOrchestratorConfig(session.id, { participantId: svParticipant.id });
      }

      setSessionId(session.id);
      setState('chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat');
    }
  }

  function handleRestore(): void {
    if (!savedConfig) return;
    setState('restoring');
    const roleAssignments = new Map(Object.entries(savedConfig.roleAssignments));
    void handleOnboardingComplete(
      savedConfig.selectedModels,
      savedConfig.folderAccess,
      savedConfig.chatMode,
      roleAssignments,
      savedConfig.orchestratorConfig
    );
  }

  function handleCancel(): void {
    setState('cancelled');
  }

  if (state === 'cancelled') {
    return (
      <Box padding={1}>
        <Text dimColor>Cancelled. Goodbye!</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding={1}>
        <Text color="redBright" bold>
          Error: {error}
        </Text>
      </Box>
    );
  }

  if (state === 'restore-prompt' && savedConfig) {
    return (
      <RestorePrompt
        config={savedConfig}
        onRestore={handleRestore}
        onNewSetup={(): void => setState('onboarding')}
      />
    );
  }

  if (state === 'restoring') {
    return (
      <Box padding={1}>
        <Text color="cyan">Restoring last configuration...</Text>
      </Box>
    );
  }

  if (state === 'onboarding') {
    return (
      <Onboarding
        workingDir={workingDir}
        onComplete={(models, folderAccess, chatMode, roleAssignments, orchestratorConfig): void => {
          void handleOnboardingComplete(
            models,
            folderAccess,
            chatMode,
            roleAssignments,
            orchestratorConfig
          );
        }}
        onCancel={handleCancel}
      />
    );
  }

  if (state === 'chat' && sessionId) {
    return <ChatApp sessionId={sessionId} />;
  }

  return <Text>Loading...</Text>;
}

export async function interactiveCommand(): Promise<void> {
  // Register built-in providers first
  registerBuiltInProviders();

  // Check if any providers are available before starting interactive mode
  const registry = getProviderRegistry();
  const providers = await registry.getAvailable();

  if (providers.length === 0) {
    // No providers available - show config and exit
    console.error('\n\x1b[31m⚠️  Cannot start: No AI providers are available!\x1b[0m');
    console.error('\x1b[31mShowing configuration status...\x1b[0m\n');

    // Import and call handleConfig
    const { handleConfig } = await import('../index');
    await handleConfig(false);
    process.exit(1);
  }

  const workingDir = process.cwd();

  const { waitUntilExit } = render(React.createElement(InteractiveApp, { workingDir }));

  await waitUntilExit();
}
