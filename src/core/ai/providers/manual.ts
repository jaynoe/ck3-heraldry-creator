// "Copy & paste" provider: the user carries each prompt to any chat AI and pastes the JSON back.

import { ProviderError, type JsonRequest, type LlmProvider } from '../provider.ts';
import { jsonInstruction, parseJsonAnswer } from './types.ts';

export interface ManualStep {
  label: string;
  /** Full text to paste into the chat (system instructions, task and expected JSON format). */
  prompt: string;
}

/** Shows the step to the user and resolves with their pasted answer (reject to cancel). */
export type AskUser = (step: ManualStep) => Promise<string>;

export class ManualProvider implements LlmProvider {
  readonly id = 'manual';
  readonly supportsImages = false;

  constructor(private ask: AskUser) {}

  async generateJson(req: JsonRequest): Promise<unknown> {
    const prompt = `${req.system}\n\n---\n\n${req.prompt}${jsonInstruction(req.schema)}`;
    const answer = await this.ask({ label: req.label, prompt });
    try {
      return parseJsonAnswer(answer);
    } catch {
      throw new ProviderError(`${req.label}: the pasted answer is not valid JSON`);
    }
  }
}
