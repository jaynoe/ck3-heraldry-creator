// "AI effort" setting: how much work (and how many tokens) a generation may use.
// Besides the model's own effort setting, the app saves the most by leaving out images
// (candidate sheets and the visual review), which cost far more tokens than text.

import type { Effort, JsonRequest, LlmProvider } from './provider.ts';

export type AiMode = 'economy' | 'normal' | 'thorough';

export interface ModeSettings {
  label: string;
  /** Passed to the model as its effort/reasoning setting where the provider supports one. */
  effort: Effort;
  /** Show candidate emblems as images and review the rendered drafts. */
  vision: boolean;
  /** Repair rounds for designs with problems. */
  repairRounds: number;
}

export const AI_MODES: Record<AiMode, ModeSettings> = {
  economy: { label: 'Economy', effort: 'low', vision: false, repairRounds: 1 },
  normal: { label: 'Normal', effort: 'medium', vision: true, repairRounds: 1 },
  thorough: { label: 'Thorough', effort: 'high', vision: true, repairRounds: 2 },
};

const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Wraps a provider so every request carries the given effort (and, for the Claude CLI, the model).
 * Values already set on a request win, so an inner call can ask for less effort (e.g. "More names").
 */
export function withRequestOptions(provider: LlmProvider, options: { effort?: Effort; model?: string }): LlmProvider {
  return {
    id: provider.id,
    supportsImages: provider.supportsImages,
    generateJson: (req: JsonRequest) => provider.generateJson({ ...req, ...defined(options), ...defined(req) }),
  };
}

/** Options from the host side are checked before they become CLI arguments. */
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];
export const isSafeModelName = (m: string) => /^[A-Za-z0-9][A-Za-z0-9._:\-\[\]]{0,99}$/.test(m);
