// Builds the active LLM provider from the user's settings.

import { AI_MODES, isSafeModelName, withRequestOptions, type AiMode } from '../core/ai/mode.ts';
import type { LlmProvider } from '../core/ai/provider.ts';
import { AnthropicProvider } from '../core/ai/providers/anthropic.ts';
import { GeminiProvider } from '../core/ai/providers/gemini.ts';
import { ManualProvider, type AskUser } from '../core/ai/providers/manual.ts';
import { OpenAiCompatibleProvider } from '../core/ai/providers/openai-compatible.ts';
import { providerInfo, type ProviderSettings } from '../core/ai/providers/types.ts';
import type { Platform } from './platform/types.ts';

const SETTINGS_KEY = 'heraldry.provider';
const MODE_KEY = 'heraldry.aiMode';

export function loadProviderSettings(platform: Platform): ProviderSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as ProviderSettings | null;
    if (saved) return saved;
  } catch {
    // ignore unreadable settings
  }
  return { id: platform.cliProvider ? 'claude-cli' : 'manual' };
}

export function saveProviderSettings(settings: ProviderSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: settings last for this session only
  }
}

export function loadAiMode(): AiMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved && saved in AI_MODES) return saved as AiMode;
  } catch {
    // ignore
  }
  return 'normal';
}

export function saveAiMode(mode: AiMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage unavailable
  }
}

/** Returns the provider, or a reason why it cannot be used yet. */
export function createProvider(platform: Platform, s: ProviderSettings, ask: AskUser): LlmProvider | string {
  const model = s.model?.trim() || providerInfo(s.id).defaultModel;
  switch (s.id) {
    case 'claude-cli':
      if (!platform.cliProvider) return 'The Claude Code CLI (`claude`) was not found.';
      if (s.model?.trim() && !isSafeModelName(s.model.trim())) return 'The Claude Code model name in Settings is not valid.';
      return withRequestOptions(platform.cliProvider, { model: s.model?.trim() || undefined });
    case 'manual':
      return new ManualProvider(ask);
    case 'anthropic':
      return new AnthropicProvider(platform.hostFetch, model);
    case 'gemini':
      return model ? new GeminiProvider(platform.hostFetch, model) : 'Enter a Gemini model id in Settings.';
    case 'openai':
    case 'openrouter':
    case 'ollama':
      return model
        ? new OpenAiCompatibleProvider(s.id, platform.hostFetch, model, s.baseUrl || undefined)
        : `Enter a model id for ${providerInfo(s.id).label} in Settings.`;
  }
}
