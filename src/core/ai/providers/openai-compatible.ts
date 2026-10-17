// OpenAI-style Chat Completions: OpenAI, OpenRouter and Ollama's /v1 endpoint.
// Uses JSON mode plus the schema in the prompt, which these services all support; our own
// validation catches anything that does not match.

import { ProviderError, type JsonRequest, type LlmProvider } from '../provider.ts';
import { jsonInstruction, parseJsonAnswer, type HostFetch, type ProviderId } from './types.ts';

const ENDPOINTS: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly supportsImages = true;

  constructor(
    readonly id: 'openai' | 'openrouter' | 'ollama',
    private hostFetch: HostFetch,
    private model: string,
    private baseUrl = 'http://localhost:11434',
  ) {}

  async generateJson(req: JsonRequest): Promise<unknown> {
    const url = ENDPOINTS[this.id] ?? `${this.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const content = [
      ...(req.images ?? []).map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
      { type: 'text', text: req.prompt + jsonInstruction(req.schema) },
    ];
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
    };
    // Effort: OpenAI's reasoning models take reasoning_effort, OpenRouter normalises it as reasoning.effort.
    // Ollama has no such setting.
    const effort =
      req.effort && this.id === 'openai' ? { reasoning_effort: req.effort } : req.effort && this.id === 'openrouter' ? { reasoning: { effort: req.effort } } : {};
    const send = (extra: object) =>
      this.hostFetch(this.id, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) });
    let res = await send(effort);
    // Models without reasoning reject the parameter; ask once more without it.
    if (res.status === 400 && Object.keys(effort).length && /reasoning/i.test(res.body)) res = await send({});
    if (res.status === 401) throw new ProviderError(`${req.label}: the ${this.id} API key was rejected`);
    if (res.status === 429) throw new ProviderError(`${req.label}: rate limited by ${this.id}, try again later`);
    if (res.status >= 400) throw new ProviderError(`${req.label}: ${this.id} error ${res.status}: ${res.body.slice(0, 300)}`);
    let data: { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new ProviderError(`${req.label}: ${this.id} sent an unreadable response`);
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ProviderError(`${req.label}: the answer was cut off`);
    try {
      return parseJsonAnswer(choice?.message?.content ?? '');
    } catch {
      throw new ProviderError(`${req.label}: the answer is not valid JSON`);
    }
  }
}
