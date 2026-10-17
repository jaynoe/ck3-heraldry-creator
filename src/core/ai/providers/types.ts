// Bring-your-own-key providers. The page never sees an API key: requests go through the host
// (Tauri or the dev server), which looks up the key for the provider, checks that the URL belongs
// to that provider and adds the auth header.

export type ProviderId = 'claude-cli' | 'anthropic' | 'openai' | 'openrouter' | 'gemini' | 'ollama' | 'manual';

export interface HostRequest {
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
}

export interface HostResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** HTTP via the host, with the provider's stored key added. */
export type HostFetch = (provider: ProviderId, url: string, init: HostRequest) => Promise<HostResponse>;

export interface ProviderSettings {
  id: ProviderId;
  /** Model id; providers have sensible defaults where one exists. */
  model?: string;
  /** Ollama server, default http://localhost:11434. */
  baseUrl?: string;
}

/**
 * How well a provider has been tried in real use. Shown in Settings and next to the active AI, and kept
 * in step with the onepager's test notice. Only Claude Code has been used for real so far.
 */
export type TestStatus = 'tested' | 'light' | 'untested';

export const TEST_LABELS: Record<TestStatus, string> = {
  tested: 'Tested',
  light: 'Lightly tested',
  untested: 'Not tested yet',
};

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  defaultModel?: string;
  modelHint: string;
  /** Where users get a key. */
  keyUrl?: string;
  note?: string;
  tested: TestStatus;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'claude-cli',
    tested: 'tested',
    label: 'Claude Code (local CLI)',
    needsKey: false,
    modelHint: 'Uses your Claude subscription through the installed `claude` command.',
    note: 'Only in the desktop app or dev server; counts against your plan’s usage limits.',
  },
  {
    id: 'anthropic',
    tested: 'untested',
    label: 'Anthropic API',
    needsKey: true,
    defaultModel: 'claude-opus-5-5',
    modelHint: 'e.g. claude-opus-5-5, claude-sonnet-5-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  {
    id: 'openai',
    tested: 'untested',
    label: 'OpenAI API',
    needsKey: true,
    modelHint: 'A vision-capable model id from your OpenAI account',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    tested: 'untested',
    label: 'OpenRouter',
    needsKey: true,
    modelHint: 'Model id from openrouter.ai/models (some are free)',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'gemini',
    tested: 'untested',
    label: 'Google Gemini API',
    needsKey: true,
    modelHint: 'A Gemini model id from Google AI Studio (has a free tier)',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    tested: 'untested',
    label: 'Ollama (local)',
    needsKey: false,
    modelHint: 'A model you pulled, ideally one with vision support',
    note: 'Free and offline; quality depends on the model and your GPU.',
  },
  {
    id: 'manual',
    tested: 'light',
    label: 'Copy & paste (no key)',
    needsKey: false,
    modelHint: 'Paste each prompt into any chat AI and paste its JSON answer back.',
    note: 'No images, so the visual review step is skipped.',
  },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

/** Remove schema keywords that structured-output APIs commonly reject; our validation checks them instead. */
export function relaxSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(relaxSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength'].includes(k)) continue;
    out[k] = relaxSchema(v);
  }
  return out;
}

/** Parse a JSON answer that may be wrapped in a markdown code fence or surrounded by text. */
export function parseJsonAnswer(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1]! : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('The answer is not valid JSON');
  }
}

/** Instruction appended to prompts for providers without native JSON-schema support. */
export const jsonInstruction = (schema: object) =>
  `\n\nRespond with a single JSON object only (no prose, no code fence) that matches this JSON Schema:\n${JSON.stringify(relaxSchema(schema))}`;
