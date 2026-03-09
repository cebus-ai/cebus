import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { discoverOrchestratorLLMOptions } from '@cebus/engine';
import type { OrchestratorLLMOption } from '@cebus/engine';
import {
  rebuildOrchestratorOptions as rebuildOptions,
  hasMoreOrchestratorModels,
} from './model-filters';
import { getProviderStyle } from '../../ui/constants';
import type { OnboardingAction, OnboardingState, OnboardingStep } from './types';

export interface AskOrchestratorStepProps {
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

export function AskOrchestratorStep({
  dispatch,
  isActive,
}: AskOrchestratorStepProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.escape) {
        dispatch({ type: 'goBack' });
        return;
      }
      if (input.toLowerCase() === 'y' || key.return) {
        dispatch({ type: 'setOrchestratorEnabled', value: true });
        // Load orchestrator LLM options
        void (async (): Promise<void> => {
          try {
            const options = await discoverOrchestratorLLMOptions();
            if (options.length === 0) {
              dispatch({
                type: 'setError',
                value: 'No orchestrator models available. Skipping orchestrator.',
              });
              dispatch({ type: 'setOrchestratorEnabled', value: false });
              dispatch({ type: 'goToStep', step: 'ask-roles' as OnboardingStep });
              return;
            }
            dispatch({ type: 'setAllOrchestratorOptions', value: options });
            dispatch({ type: 'setExpandedOrchestratorProviders', value: new Set() });
            const visible = rebuildOptions(options, new Set());
            dispatch({ type: 'setOrchestratorOptions', value: visible });
            dispatch({ type: 'setOrchestratorSpec', value: null });
            dispatch({ type: 'goToStep', step: 'select-orchestrator' as OnboardingStep });
          } catch {
            dispatch({ type: 'setError', value: 'Failed to load orchestrator models. Skipping.' });
            dispatch({ type: 'setOrchestratorEnabled', value: false });
            dispatch({ type: 'goToStep', step: 'ask-roles' as OnboardingStep });
          }
        })();
      } else if (input.toLowerCase() === 'n') {
        dispatch({ type: 'setOrchestratorEnabled', value: false });
        dispatch({ type: 'goToStep', step: 'ask-roles' });
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          AI Orchestrator
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Would you like to enable an AI Orchestrator?</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>The orchestrator analyzes each message, manages agent discussions,</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          and can orchestrate multi-round tasks. Pick any available model (free with
          Ollama/Copilot).
        </Text>
      </Box>

      <Box>
        <Text>
          Enable orchestrator? <Text color="green">[Y]es / Enter</Text> /{' '}
          <Text color="yellow">[N]o</Text>
        </Text>
      </Box>
    </Box>
  );
}

export interface SelectOrchestratorStepProps {
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

// ANSI helpers
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const WHITE = '\x1b[97m';
const GREEN = '\x1b[32m';

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

type OrcRenderItem =
  | { kind: 'header'; provider: string; providerName: string }
  | { kind: 'model'; option: OrchestratorLLMOption; globalIndex: number }
  | { kind: 'hint'; text: string }
  | { kind: 'spacer' };

const CHROME_LINES = 14;

export function SelectOrchestratorStep({
  state,
  dispatch,
  isActive,
}: SelectOrchestratorStepProps): React.ReactElement {
  const [focusIndex, setFocusIndex] = useState(0);
  const { stdout } = useStdout();

  const {
    allOrchestratorOptions,
    orchestratorOptions,
    expandedOrchestratorProviders,
    orchestratorSpec,
    error,
  } = state;

  function toggleShowMore(providerId: string): void {
    const isExpanded = expandedOrchestratorProviders.has(providerId);
    let newExpanded: Set<string>;
    if (isExpanded) {
      newExpanded = new Set(expandedOrchestratorProviders);
      newExpanded.delete(providerId);
    } else {
      newExpanded = new Set(expandedOrchestratorProviders);
      newExpanded.add(providerId);
    }

    dispatch({ type: 'setExpandedOrchestratorProviders', value: newExpanded });

    // eslint-disable-next-line security/detect-object-injection -- index from bounded state
    const focusedSpec = orchestratorOptions[focusIndex]?.spec;
    const rebuilt = rebuildOptions(allOrchestratorOptions, newExpanded);
    dispatch({ type: 'setOrchestratorOptions', value: rebuilt });

    if (focusedSpec !== undefined && focusedSpec.length > 0) {
      const newIndex = rebuilt.findIndex(o => o.spec === focusedSpec);
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
        setFocusIndex(prev => Math.min(orchestratorOptions.length - 1, prev + 1));
      } else if (input === 'm') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const currentOption = orchestratorOptions[focusIndex];

        if (currentOption) {
          toggleShowMore(currentOption.provider);
        }
      } else if (input === ' ') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const current = orchestratorOptions[focusIndex];

        if (current) {
          dispatch({
            type: 'setOrchestratorSpec',
            value: orchestratorSpec === current.spec ? null : current.spec,
          });
        }
      } else if (key.return) {
        if (orchestratorSpec === null || orchestratorSpec.length === 0) {
          dispatch({ type: 'setError', value: 'Please select an orchestrator model' });
          return;
        }
        dispatch({ type: 'goToStep', step: 'ask-roles' });
      }
    },
    { isActive }
  );

  const renderItems = useMemo((): OrcRenderItem[] => {
    const items: OrcRenderItem[] = [];
    const byProvider = new Map<string, OrchestratorLLMOption[]>();
    for (const option of orchestratorOptions) {
      if (!byProvider.has(option.provider)) {
        byProvider.set(option.provider, []);
      }
      byProvider.get(option.provider)!.push(option);
    }

    let gi = 0;
    let first = true;
    for (const [provider, options] of byProvider) {
      if (!first) items.push({ kind: 'spacer' });
      first = false;
      items.push({ kind: 'header', provider, providerName: options[0]?.providerName ?? provider });

      for (const option of options) {
        items.push({ kind: 'model', option, globalIndex: gi++ });
      }

      if (hasMoreOrchestratorModels(allOrchestratorOptions, orchestratorOptions, provider)) {
        items.push({ kind: 'hint', text: '    ... press M to show more' });
      } else if (expandedOrchestratorProviders.has(provider)) {
        items.push({ kind: 'hint', text: '    press M to collapse' });
      }
    }

    return items;
  }, [orchestratorOptions, allOrchestratorOptions, expandedOrchestratorProviders]);

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
        const isSelected = orchestratorSpec === item.option.spec;
        const sourceTag = item.option.provider === 'ollama' ? ` ${DIM}(local)${RESET}` : '';

        const cursor = isFocused ? `${YELLOW}> ${RESET}` : '  ';
        const check = isSelected ? `${GREEN}[x] ${RESET}` : `${WHITE}[ ] ${RESET}`;
        const name = isSelected
          ? `${BOLD}${item.option.displayName}${RESET}`
          : item.option.displayName;
        const nick = `${DIM} @${item.option.nickname}${RESET}`;

        lines.push(`${cursor}${check}${name}${sourceTag}${nick}`);
      } else if (item.kind === 'hint') {
        lines.push(`${DIM}${item.text}${RESET}`);
      } else {
        lines.push('');
      }
    }

    const padCount = maxVisible - (viewEnd - viewStart);
    for (let i = 0; i < padCount; i++) {
      lines.push(' ');
    }

    return lines.join('\n');
  }, [renderItems, viewStart, viewEnd, maxVisible, focusIndex, orchestratorSpec]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Select Orchestrator Model
      </Text>
      <Text> </Text>
      <Text dimColor>
        Tip: For best results, choose a model with a large context window (premium/middle tier)
      </Text>
      <Text> </Text>
      <Text dimColor>Up/Down navigate | Space select | M show more | Enter confirm | Esc back</Text>
      <Text> </Text>
      <Text dimColor>{aboveCount > 0 ? `  -- ${aboveCount} more above --` : ' '}</Text>
      <Text>{viewportStr}</Text>
      <Text dimColor>{belowCount > 0 ? `  -- ${belowCount} more below --` : ' '}</Text>
      <Text dimColor>
        Selected: {orchestratorSpec !== null && orchestratorSpec.length > 0 ? '1 model' : 'none'}
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
