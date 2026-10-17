// Anthropic Messages API through the official SDK. The SDK's fetch is routed through the host,
// which adds the user's key; the placeholder key below never leaves the page.

import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type JsonRequest, type LlmProvider } from '../provider.ts';
import { relaxSchema, type HostFetch } from './types.ts';

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly supportsImages = true;
  private client: Anthropic;

  constructor(
    hostFetch: HostFetch,
    private model = 'claude-opus-5-5',
  ) {
    this.client = new Anthropic({
      apiKey: 'added-by-host',
      dangerouslyAllowBrowser: true,
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        delete headers['x-api-key'];
        const res = await hostFetch('anthropic', url, {
          method: (init?.method as 'POST' | 'GET') ?? 'GET',
          headers,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return new Response(res.body, { status: res.status, headers: res.headers });
      },
    });
  }

  async generateJson(req: JsonRequest): Promise<unknown> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
      })),
      { type: 'text' as const, text: req.prompt },
    ];
    const create = (effort: JsonRequest['effort']) =>
      this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: req.system,
        messages: [{ role: 'user', content }],
        output_config: {
          format: { type: 'json_schema', schema: relaxSchema(req.schema) as Record<string, unknown> },
          ...(effort ? { effort } : {}),
        },
        // On a policy decline, let the API retry on its default fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    let response: Anthropic.Beta.BetaMessage;
    try {
      try {
        response = await create(req.effort);
      } catch (e) {
        // Older models do not know the effort setting; ask once more without it.
        if (req.effort && e instanceof Anthropic.BadRequestError && /effort/i.test(e.message)) response = await create(undefined);
        else throw e;
      }
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderError(`${req.label}: the Anthropic API key was rejected`);
      if (e instanceof Anthropic.RateLimitError) throw new ProviderError(`${req.label}: rate limited by the Anthropic API, try again later`);
      if (e instanceof Anthropic.APIError) throw new ProviderError(`${req.label}: Anthropic API error ${e.status}: ${e.message}`);
      throw e;
    }
    if (response.stop_reason === 'refusal') throw new ProviderError(`${req.label}: the model declined this request`);
    if (response.stop_reason === 'max_tokens') throw new ProviderError(`${req.label}: the answer was cut off (max_tokens)`);
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError(`${req.label}: the answer is not valid JSON`);
    }
  }
}
