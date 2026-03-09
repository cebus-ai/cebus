/**
 * QuickPick-based model selection for VS Code.
 *
 * Presents available models from registered providers, grouped by provider.
 */

import * as vscode from 'vscode';
import type { EngineBridge } from './bridge.js';

export interface ModelSelection {
  providerId: string;
  modelId: string;
  displayName: string;
}

interface ModelQuickPickItem extends vscode.QuickPickItem {
  providerId: string;
  modelId: string;
}

export async function showModelPicker(bridge: EngineBridge): Promise<ModelSelection[] | undefined> {
  const models = await bridge.getAvailableModels();
  if (models.length === 0) {
    void vscode.window.showWarningMessage('No models available. Configure API keys first.');
    return undefined;
  }

  const items: ModelQuickPickItem[] = models.flatMap(provider =>
    provider.models.map(
      (model): ModelQuickPickItem => ({
        label: model.displayName,
        description: provider.providerId,
        detail: model.modelId,
        providerId: provider.providerId,
        modelId: model.modelId,
      })
    )
  );

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Select Models for Group Chat',
    placeHolder: 'Choose one or more models',
    canPickMany: true,
  });

  if (!selected || selected.length === 0) return undefined;

  return selected.map(
    (item): ModelSelection => ({
      providerId: item.providerId,
      modelId: item.modelId,
      displayName: item.label,
    })
  );
}

export async function showChatModePicker(): Promise<string | undefined> {
  const modes = [
    { label: 'Free Chat', description: 'All models respond simultaneously', value: 'free_chat' },
    { label: 'Sequential', description: 'Models take turns one by one', value: 'sequential' },
    { label: 'Tag Only', description: 'Models respond only when @mentioned', value: 'tag_only' },
    { label: 'Role Based', description: 'Models assigned specialized roles', value: 'role_based' },
  ];

  const selected = await vscode.window.showQuickPick(modes, {
    title: 'Select Chat Mode',
    placeHolder: 'How should models interact?',
  });

  return selected?.value;
}

export async function showContextLevelPicker(): Promise<string | undefined> {
  const levels = [
    { label: 'None', description: 'Chat-only mode, no file access', value: 'none' },
    { label: 'Minimal', description: 'Project name + git branch', value: 'minimal' },
    { label: 'Full', description: 'README, directory structure, git status', value: 'full' },
  ];

  const selected = await vscode.window.showQuickPick(levels, {
    title: 'Select Context Level',
    placeHolder: 'How much workspace context to include?',
  });

  return selected?.value;
}
