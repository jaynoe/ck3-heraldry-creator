import { describe, expect, it } from 'vitest';
import { shapeProblem, withShapeCheck, type JsonRequest } from '../src/core/ai/provider.ts';
import { AnthropicProvider } from '../src/core/ai/providers/anthropic.ts';
import { GeminiProvider } from '../src/core/ai/providers/gemini.ts';
import { ManualProvider } from '../src/core/ai/providers/manual.ts';
import { OpenAiCompatibleProvider } from '../src/core/ai/providers/openai-compatible.ts';
import { parseJsonAnswer, relaxSchema, type HostFetch, type HostRequest } from '../src/core/ai/providers/types.ts';

const REQ: JsonRequest = {
  label: 'concept',
  system: 'You are a herald.',
  prompt: 'Name a house.',
  schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' }, minItems: 2 } }, required: ['names'], additionalProperties: false },
  images: [{ mediaType: 'image/png', base64: 'AAAA' }],
};

/** Records the request and answers with a canned body. */
function fakeHost(status: number, body: unknown) {
  const calls: { provider: string; url: string; init: HostRequest }[] = [];
  const host: HostFetch = async (provider, url, init) => {
    calls.push({ provider, url, init });
    return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  };
  return { host, calls };
}

describe('provider helpers', () => {
  it('strips unsupported schema constraints recursively', () => {
    expect(JSON.stringify(relaxSchema(REQ.schema))).not.toContain('minItems');
  });

  it('parses JSON answers wrapped in fences or prose', () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonAnswer('Sure! {"a":2} Hope this helps')).toEqual({ a: 2 });
  });
});

describe('AnthropicProvider', () => {
  it('sends a structured-output request through the host without the placeholder key', async () => {
    const { host, calls } = fakeHost(200, {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"names":["Moatstark","Greywater"]}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await new AnthropicProvider(host).generateJson(REQ);
    expect(result).toEqual({ names: ['Moatstark', 'Greywater'] });
    const call = calls[0]!;
    expect(call.provider).toBe('anthropic');
    expect(call.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(call.init.headers['x-api-key']).toBeUndefined();
    const body = JSON.parse(call.init.body!);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(JSON.stringify(body.output_config.format.schema)).not.toContain('minItems');
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.fallbacks).toBe('default');
  });

  it('reports refusals', async () => {
    const { host } = fakeHost(200, {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(new AnthropicProvider(host).generateJson(REQ)).rejects.toThrow('declined');
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('uses JSON mode, data-URL images and the provider endpoint', async () => {
    const { host, calls } = fakeHost(200, { choices: [{ message: { content: '{"names":["A","B"]}' }, finish_reason: 'stop' }] });
    expect(await new OpenAiCompatibleProvider('openrouter', host, 'some/model').generateJson(REQ)).toEqual({ names: ['A', 'B'] });
    const body = JSON.parse(calls[0]!.init.body!);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content[0].image_url.url).toBe('data:image/png;base64,AAAA');
  });

  it('targets the configured Ollama server', async () => {
    const { host, calls } = fakeHost(200, { choices: [{ message: { content: '{"names":[]}' } }] });
    await new OpenAiCompatibleProvider('ollama', host, 'llava', 'http://localhost:11434/').generateJson(REQ);
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('turns HTTP errors into readable messages', async () => {
    const { host } = fakeHost(401, { error: 'bad key' });
    await expect(new OpenAiCompatibleProvider('openai', host, 'm').generateJson(REQ)).rejects.toThrow('key was rejected');
  });
});

describe('GeminiProvider', () => {
  it('sends inline images and JSON response mode', async () => {
    const { host, calls } = fakeHost(200, { candidates: [{ content: { parts: [{ text: '{"names":["X"]}' }] }, finishReason: 'STOP' }] });
    expect(await new GeminiProvider(host, 'gemini-model').generateJson(REQ)).toEqual({ names: ['X'] });
    const body = JSON.parse(calls[0]!.init.body!);
    expect(calls[0]!.url).toContain('/models/gemini-model:generateContent');
    expect(body.contents[0].parts[0].inline_data.data).toBe('AAAA');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});

describe('ManualProvider', () => {
  it('shows the full prompt with the schema and parses the pasted answer', async () => {
    let shown = '';
    const provider = new ManualProvider(async (step) => {
      shown = step.prompt;
      return 'Here you go:\n```json\n{"names":["Pasted"]}\n```';
    });
    expect(await provider.generateJson(REQ)).toEqual({ names: ['Pasted'] });
    expect(shown).toContain('You are a herald.');
    expect(shown).toContain('JSON Schema');
  });
});

describe('effort', () => {
  const OK = { choices: [{ message: { content: '{"names":[]}' } }] };
  /** Answers with the given responses in order. */
  function sequenceHost(responses: { status: number; body: unknown }[]) {
    const bodies: Record<string, unknown>[] = [];
    const host: HostFetch = async (_p, _u, init) => {
      bodies.push(JSON.parse(init.body!));
      const r = responses[Math.min(bodies.length - 1, responses.length - 1)]!;
      return { status: r.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) };
    };
    return { host, bodies };
  }

  it('maps effort to reasoning_effort (OpenAI), reasoning.effort (OpenRouter) and nothing for Ollama', async () => {
    for (const [id, check] of [
      ['openai', (b: Record<string, unknown>) => expect(b.reasoning_effort).toBe('low')],
      ['openrouter', (b: Record<string, unknown>) => expect(b.reasoning).toEqual({ effort: 'low' })],
      ['ollama', (b: Record<string, unknown>) => expect(b.reasoning ?? b.reasoning_effort).toBeUndefined()],
    ] as const) {
      const { host, bodies } = sequenceHost([{ status: 200, body: OK }]);
      await new OpenAiCompatibleProvider(id, host, 'm').generateJson({ ...REQ, effort: 'low' });
      check(bodies[0]!);
    }
  });

  it('asks once more without effort when a model rejects it', async () => {
    const { host, bodies } = sequenceHost([
      { status: 400, body: { error: { message: "Unsupported parameter: 'reasoning_effort'" } } },
      { status: 200, body: OK },
    ]);
    expect(await new OpenAiCompatibleProvider('openai', host, 'gpt-x').generateJson({ ...REQ, effort: 'high' })).toEqual({ names: [] });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.reasoning_effort).toBeUndefined();
  });

  it('sends output_config.effort to Anthropic and retries without it if rejected', async () => {
    const message = { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: '{"names":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    const { host, bodies } = sequenceHost([
      { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'effort is not supported for this model' } } },
      { status: 200, body: message },
    ]);
    expect(await new AnthropicProvider(host, 'claude-old').generateJson({ ...REQ, effort: 'low' })).toEqual({ names: [] });
    expect((bodies[0]!.output_config as { effort?: string }).effort).toBe('low');
    expect((bodies[1]!.output_config as { effort?: string }).effort).toBeUndefined();
  });
});

describe('shape check', () => {
  const schema = {
    type: 'object',
    properties: { names: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
    required: ['names'],
  };

  it('accepts a matching answer and names the first problem otherwise', () => {
    expect(shapeProblem(schema, { names: [{ name: 'Rook' }] })).toBeUndefined();
    expect(shapeProblem(schema, {})).toBe('names: missing');
    expect(shapeProblem(schema, { names: 'Rook' })).toBe('names: expected a list');
    expect(shapeProblem(schema, { names: [{ name: 3 }] })).toBe('names[1].name: expected a string');
  });

  it('turns a malformed answer into a readable provider error', async () => {
    const provider = withShapeCheck({ id: 'x', supportsImages: false, generateJson: async () => ({ names: null }) });
    await expect(provider.generateJson({ label: 'concept', system: '', prompt: '', schema })).rejects.toThrow("concept: the AI's answer is not in the expected format (names: expected a list)");
  });
});
