// Google Gemini generateContent with JSON response mode.

import { ProviderError, type JsonRequest, type LlmProvider } from '../provider.ts';
import { jsonInstruction, parseJsonAnswer, type HostFetch } from './types.ts';

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  readonly supportsImages = true;

  constructor(
    private hostFetch: HostFetch,
    private model: string,
  ) {}

  async generateJson(req: JsonRequest): Promise<unknown> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const parts = [
      ...(req.images ?? []).map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.base64 } })),
      { text: req.prompt + jsonInstruction(req.schema) },
    ];
    const res = await this.hostFetch('gemini', url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (res.status === 400 && res.body.includes('API_KEY')) throw new ProviderError(`${req.label}: the Gemini API key was rejected`);
    if (res.status === 429) throw new ProviderError(`${req.label}: rate limited by Gemini, try again later`);
    if (res.status >= 400) throw new ProviderError(`${req.label}: Gemini error ${res.status}: ${res.body.slice(0, 300)}`);
    let data: { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new ProviderError(`${req.label}: Gemini sent an unreadable response`);
    }
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new ProviderError(`${req.label}: the answer was cut off`);
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return parseJsonAnswer(text);
    } catch {
      throw new ProviderError(`${req.label}: the answer is not valid JSON (finish reason ${candidate?.finishReason ?? 'unknown'})`);
    }
  }
}
