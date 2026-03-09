/**
 * ConfirmStep — final confirmation screen before starting the chat.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { OrchestratorConfig } from '@cebus/engine';
import {
  CHAT_MODES,
  type OnboardingAction,
  type OnboardingState,
  type AvailableModel,
} from './types';

export interface ConfirmStepProps {
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

interface SelectedModelItem extends AvailableModel {
  instanceKey: string;
  instanceLabel: string;
}

function getSelectedModelsList(state: OnboardingState): SelectedModelItem[] {
  const countBySpec = new Map<string, number>();
  return state.selectedSpecs
    .map((spec, index) => {
      const model = state.availableModels.find(m => m.spec === spec);
      if (!model) return null;
      const count = (countBySpec.get(spec) ?? 0) + 1;
      countBySpec.set(spec, count);
      return {
        ...model,
        instanceKey: `${spec}#${index}`,
        instanceLabel: count > 1 ? `${model.displayName} (${count})` : model.displayName,
      };
    })
    .filter((item): item is SelectedModelItem => item !== null);
}

export function ConfirmStep({ state, dispatch, isActive }: ConfirmStepProps): React.ReactElement {
  const {
    chatMode,
    roleAssignments,
    roleTemplates,
    orchestratorEnabled,
    orchestratorSpec,
    orchestratorOptions,
  } = state;

  const selectedModels = getSelectedModelsList(state);
  const modeLabel = CHAT_MODES.find(m => m.mode === chatMode)?.label ?? chatMode;

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.escape) {
        dispatch({ type: 'goBack' });
        return;
      }
      if (input.toLowerCase() === 'y' || key.return) {
        // Guard: if role_based but no roles assigned, downgrade to sequential
        if (chatMode === 'role_based' && roleAssignments.size === 0) {
          dispatch({ type: 'setChatMode', value: 'sequential' });
        }

        // Build orchestrator config if enabled
        let svConfig: OrchestratorConfig | undefined;
        if (orchestratorEnabled && orchestratorSpec !== null && orchestratorSpec.length > 0) {
          const colonIndex = orchestratorSpec.indexOf(':');
          if (colonIndex !== -1) {
            svConfig = {
              enabled: true,
              providerId: orchestratorSpec.substring(0, colonIndex),
              modelId: orchestratorSpec.substring(colonIndex + 1),
              maxRounds: 5,
            };
          }
        }
        dispatch({
          type: 'complete',
          orchestratorConfig: svConfig,
        });
      } else if (input.toLowerCase() === 'n') {
        dispatch({ type: 'goToStep', step: 'ask-roles' });
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Ready to Start
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>You selected:</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        {selectedModels.map(model => (
          <Text key={model.instanceKey} color="green">
            {'• '}
            {model.instanceLabel} (@{model.nickname})
          </Text>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text>Chat mode: </Text>
        <Text bold color="yellow">
          {modeLabel}
        </Text>
      </Box>

      {chatMode === 'role_based' && roleAssignments.size > 0 && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          {selectedModels.map(model => {
            const roleId = roleAssignments.get(model.instanceKey);
            const template = roleTemplates.find(t => t.id === roleId);
            return (
              <Text key={model.instanceKey}>
                <Text dimColor>{model.instanceLabel}</Text>
                <Text dimColor>{' → '}</Text>
                <Text color="yellow">{template?.label ?? 'None'}</Text>
              </Text>
            );
          })}
        </Box>
      )}

      {orchestratorEnabled && orchestratorSpec !== null && orchestratorSpec.length > 0 && (
        <Box marginBottom={1}>
          <Text>Orchestrator: </Text>
          <Text bold color="magenta">
            {orchestratorOptions.find(o => o.spec === orchestratorSpec)?.displayName ??
              orchestratorSpec}
          </Text>
          <Text dimColor> (max 5 rounds)</Text>
        </Box>
      )}

      <Box>
        <Text>
          Start chat? <Text color="green">[Y]es</Text> / <Text color="yellow">[N]o (back)</Text>
        </Text>
      </Box>
    </Box>
  );
}
