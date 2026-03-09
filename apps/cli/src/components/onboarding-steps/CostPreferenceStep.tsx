/**
 * CostPreferenceStep — lets user pick a cost tier (local / budget / middle / premium).
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTierLabel, getTierEmoji } from '@cebus/engine';
import type { CostTier } from '@cebus/engine';
import { applyTierFilter } from './model-filters';
import type { OnboardingAction, OnboardingState } from './types';

const ALL_TIERS: CostTier[] = ['local', 'budget', 'middle', 'premium'];

export interface CostPreferenceStepProps {
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

export function CostPreferenceStep({
  state,
  dispatch,
  isActive,
}: CostPreferenceStepProps): React.ReactElement {
  const loading = state.allModels.length === 0 && state.error === null;
  const hasLocalModels = !loading && state.allModels.some(m => m.tier === 'local');
  const tiers = loading || hasLocalModels ? ALL_TIERS : ALL_TIERS.filter(t => t !== 'local');

  const [focusIndex, setFocusIndex] = useState(0);

  useInput(
    (input, key) => {
      if (!isActive || loading) return;

      if (key.escape) {
        dispatch({ type: 'goBack' });
        return;
      }
      if (key.upArrow) {
        setFocusIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setFocusIndex(prev => Math.min(tiers.length - 1, prev + 1));
      } else if (key.return || input === ' ') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const selectedTier = tiers[focusIndex]!;
        dispatch({ type: 'setCostPreference', value: selectedTier });

        const result = applyTierFilter(state.allModels, selectedTier);
        if (result.models.length === 0) {
          dispatch({
            type: 'setError',
            value: 'No models match your preference. Try a different tier.',
          });
          return;
        }

        dispatch({ type: 'setAvailableModels', value: result.models });
        dispatch({ type: 'setSelectedSpecs', value: [...result.defaultSelections] });
        dispatch({ type: 'goToStep', step: 'select-models' });
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Select Your Cost Preference
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {loading
            ? 'Discovering available providers...'
            : 'Choose a cost tier to see recommended models'}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {tiers.map((tier, index) => {
          const isFocused = !loading && index === focusIndex;

          return (
            <Box key={tier}>
              <Text {...(isFocused && { color: 'yellow' })}>{isFocused ? '> ' : '  '}</Text>
              <Text {...(isFocused && { color: 'cyan' })} dimColor={loading} bold={isFocused}>
                {getTierEmoji(tier)} {getTierLabel(tier)}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down navigate | Enter select | Esc back</Text>
      </Box>

      <Text
        {...(state.error !== null && state.error.length > 0 && { color: 'redBright' as const })}
        bold={state.error !== null && state.error.length > 0}
      >
        {state.error ?? ' '}
      </Text>
    </Box>
  );
}
