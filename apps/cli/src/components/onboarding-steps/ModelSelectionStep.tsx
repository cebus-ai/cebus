/**
 * ModelSelectionStep — multi-select list of AI models grouped by provider.
 * Renders a fixed-height viewport as a single Text element to prevent flicker.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { getTierLabel, getTierEmoji } from '@cebus/engine';
import { rebuildAvailableModels, getTotalProviderModels } from './model-filters';
import { getProviderStyle } from '../../ui/constants';
import type { OnboardingAction, OnboardingState, AvailableModel } from './types';

const DEFAULT_VISIBLE = 3;
const EXPAND_STEP = 3;
// Fixed chrome: padding(2) + title(1) + margin(1) + counts(1) + margin(1) + help(1) + margin(1) +
//               above-indicator(1) + below-indicator(1) + selected(1) + error-slot(1)
const CHROME_LINES = 12;

// ANSI helpers
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const WHITE = '\x1b[97m';

const NAMED_COLORS: Record<string, string> = {
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[97m',
};

function colorToAnsi(color: string): string {
  // eslint-disable-next-line security/detect-object-injection -- key from known color values
  if (NAMED_COLORS[color] !== undefined) return NAMED_COLORS[color];
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `\x1b[38;2;${r};${g};${b}m`;
  }
  return '\x1b[36m';
}

type RenderItem =
  | { kind: 'header'; provider: string; providerName: string }
  | { kind: 'model'; model: AvailableModel; globalIndex: number }
  | { kind: 'hint'; text: string }
  | { kind: 'spacer' };

export interface ModelSelectionStepProps {
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

export function ModelSelectionStep({
  state,
  dispatch,
  isActive,
}: ModelSelectionStepProps): React.ReactElement {
  const [focusIndex, setFocusIndex] = useState(0);
  const { stdout } = useStdout();

  const { availableModels, selectedSpecs, costPreference, expandedProviders, allModels, error } =
    state;

  function toggleShowMore(providerId: string): void {
    const total = getTotalProviderModels(allModels, costPreference, providerId);
    const currentLimit = expandedProviders.get(providerId) ?? DEFAULT_VISIBLE;

    const newExpanded = new Map(expandedProviders);
    if (currentLimit >= total) {
      newExpanded.delete(providerId);
    } else {
      newExpanded.set(providerId, Math.min(currentLimit + EXPAND_STEP, total));
    }

    dispatch({ type: 'setExpandedProviders', value: newExpanded });

    // eslint-disable-next-line security/detect-object-injection -- index from bounded state
    const focusedSpec = availableModels[focusIndex]?.spec;
    const rebuilt = rebuildAvailableModels(allModels, costPreference, newExpanded);
    dispatch({ type: 'setAvailableModels', value: rebuilt });

    if (focusedSpec !== undefined && focusedSpec.length > 0) {
      const newIndex = rebuilt.findIndex(m => m.spec === focusedSpec);
      if (newIndex >= 0) {
        setFocusIndex(newIndex);
      }
    }
  }

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.escape) {
        dispatch({ type: 'goBack' });
        return;
      }
      if (key.upArrow) {
        setFocusIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setFocusIndex(prev => Math.min(availableModels.length - 1, prev + 1));
      } else if (input === ' ') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const currentModel = availableModels[focusIndex];
        if (currentModel) {
          const idx = selectedSpecs.indexOf(currentModel.spec);
          if (idx >= 0) {
            const next = selectedSpecs.filter((_, i) => i !== idx);
            dispatch({ type: 'setSelectedSpecs', value: next });
          } else {
            dispatch({ type: 'setSelectedSpecs', value: [...selectedSpecs, currentModel.spec] });
          }
        }
      } else if (input.toLowerCase() === 'd') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const currentModel = availableModels[focusIndex];
        if (currentModel && selectedSpecs.includes(currentModel.spec)) {
          dispatch({ type: 'setSelectedSpecs', value: [...selectedSpecs, currentModel.spec] });
        }
      } else if (input === 'm') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const currentModel = availableModels[focusIndex];
        if (currentModel) {
          toggleShowMore(currentModel.provider);
        }
      } else if (input.toLowerCase() === 'a') {
        if (selectedSpecs.length === availableModels.length) {
          dispatch({ type: 'setSelectedSpecs', value: [] });
        } else {
          dispatch({ type: 'setSelectedSpecs', value: availableModels.map(m => m.spec) });
        }
      } else if (key.return) {
        if (selectedSpecs.length === 0) {
          dispatch({ type: 'setError', value: 'Please select at least one model' });
          return;
        }
        dispatch({ type: 'goToStep', step: 'select-mode' });
      }
    },
    { isActive }
  );

  // Build flat render items from grouped models
  const renderItems = useMemo((): RenderItem[] => {
    const items: RenderItem[] = [];
    const byProvider = new Map<string, AvailableModel[]>();
    for (const model of availableModels) {
      if (!byProvider.has(model.provider)) {
        byProvider.set(model.provider, []);
      }
      byProvider.get(model.provider)!.push(model);
    }

    let gi = 0;
    let first = true;
    for (const [provider, models] of byProvider) {
      if (!first) items.push({ kind: 'spacer' });
      first = false;
      items.push({ kind: 'header', provider, providerName: models[0]?.providerName ?? provider });

      for (const model of models) {
        items.push({ kind: 'model', model, globalIndex: gi++ });
      }

      const total = getTotalProviderModels(allModels, costPreference, provider);
      const currentCount = models.length;
      if (total > currentCount) {
        items.push({ kind: 'hint', text: '    ... press M to show more' });
      } else if ((expandedProviders.get(provider) ?? DEFAULT_VISIBLE) > DEFAULT_VISIBLE) {
        items.push({ kind: 'hint', text: '    press M to collapse' });
      }
    }

    return items;
  }, [availableModels, allModels, costPreference, expandedProviders]);

  // Viewport: fixed-height, single-string render
  const termRows = stdout?.rows ?? 24;
  const maxVisible = Math.max(5, termRows - CHROME_LINES);
  const totalItems = renderItems.length;

  const focusedRenderIndex = renderItems.findIndex(
    item => item.kind === 'model' && item.globalIndex === focusIndex
  );

  let viewStart = 0;
  if (totalItems > maxVisible) {
    const half = Math.floor(maxVisible / 2);
    viewStart = Math.max(0, focusedRenderIndex - half);
    if (viewStart + maxVisible > totalItems) {
      viewStart = Math.max(0, totalItems - maxVisible);
    }
  }

  const viewEnd = Math.min(viewStart + maxVisible, totalItems);
  const aboveCount = viewStart;
  const belowCount = totalItems - viewEnd;

  // Build the entire viewport as a single string with ANSI codes
  const viewportStr = useMemo((): string => {
    const lines: string[] = [];

    for (let i = viewStart; i < viewEnd; i++) {
      // eslint-disable-next-line security/detect-object-injection -- index from for-loop
      const item = renderItems[i]!;

      if (item.kind === 'header') {
        const style = getProviderStyle(item.provider);
        const ansiColor = colorToAnsi(style.color);
        lines.push(`${ansiColor}${style.icon} ${BOLD}${item.providerName}${RESET}`);
      } else if (item.kind === 'model') {
        const isFocused = item.globalIndex === focusIndex;
        const isSelected = selectedSpecs.includes(item.model.spec);
        const instanceCount = selectedSpecs.filter(s => s === item.model.spec).length;
        const sourceTag = item.model.provider.startsWith('ollama') ? ` ${DIM}(local)${RESET}` : '';

        const cursor = isFocused ? `${YELLOW}> ${RESET}` : '  ';
        const check = isSelected ? `${GREEN}[x] ${RESET}` : `${WHITE}[ ] ${RESET}`;
        const name = isSelected
          ? `${BOLD}${item.model.displayName}${RESET}`
          : item.model.displayName;
        const nick = `${DIM} @${item.model.nickname}${RESET}`;
        const badge = instanceCount > 1 ? ` ${YELLOW}[x${instanceCount}]${RESET}` : '';

        lines.push(`${cursor}${check}${name}${sourceTag}${nick}${badge}`);
      } else if (item.kind === 'hint') {
        lines.push(`${DIM}${item.text}${RESET}`);
      } else {
        lines.push('');
      }
    }

    // Pad to fixed height
    const padCount = maxVisible - (viewEnd - viewStart);
    for (let i = 0; i < padCount; i++) {
      lines.push(' ');
    }

    return lines.join('\n');
  }, [renderItems, viewStart, viewEnd, maxVisible, focusIndex, selectedSpecs]);

  const tierCounts = useMemo(
    () => ({
      premium: availableModels.filter(m => m.tier === 'premium').length,
      middle: availableModels.filter(m => m.tier === 'middle').length,
      budget: availableModels.filter(m => m.tier === 'budget').length,
    }),
    [availableModels]
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        {'Select AI Models  '}
        {getTierEmoji(costPreference)}
        <Text dimColor bold={false}>
          {' '}
          ({getTierLabel(costPreference)})
        </Text>
      </Text>
      <Text> </Text>
      <Text dimColor>
        Showing: {getTierEmoji('premium')} {tierCounts.premium} {getTierEmoji('middle')}{' '}
        {tierCounts.middle} {getTierEmoji('budget')} {tierCounts.budget} models
      </Text>
      <Text> </Text>
      <Text dimColor>
        Up/Down navigate | Space select | D duplicate | A select all | M show more | Enter confirm |
        Esc back
      </Text>
      <Text> </Text>
      <Text dimColor>{aboveCount > 0 ? `  -- ${aboveCount} more above --` : ' '}</Text>
      <Text>{viewportStr}</Text>
      <Text dimColor>{belowCount > 0 ? `  -- ${belowCount} more below --` : ' '}</Text>
      <Text dimColor>
        Selected: {selectedSpecs.length} model{selectedSpecs.length !== 1 ? 's' : ''}
      </Text>
      <Text
        {...(error !== null && error.length > 0 && { color: 'redBright' as const })}
        bold={error !== null && error.length > 0}
      >
        {error ?? ' '}
      </Text>
    </Box>
  );
}
