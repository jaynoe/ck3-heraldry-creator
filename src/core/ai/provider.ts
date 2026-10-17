// Provider-neutral interface for structured LLM calls. Implementations: local CLIs (Claude Code),
// bring-your-own-key HTTP APIs, and a manual copy-paste mode.

export interface JsonRequest {
  /** Short label for logs and errors, e.g. "concept". */
  label: string;
  system: string;
  prompt: string;
  /** JSON Schema the response must satisfy. */
  schema: object;
  /** PNG images shown before the prompt text (only for providers with vision support). */
  images?: { mediaType: 'image/png'; base64: string }[];
  /** How hard the model should think. Providers map it to their own setting or ignore it. */
  effort?: Effort;
  /** Model override; only the Claude CLI provider uses it (API providers take the model from Settings). */
  model?: string;
}

export type Effort = 'low' | 'medium' | 'high';

export interface LlmProvider {
  readonly id: string;
  /** Whether `images` in a request are passed to the model. */
  readonly supportsImages: boolean;
  /** Returns the parsed JSON object. Callers still validate it against the catalog. */
  generateJson(req: JsonRequest): Promise<unknown>;
}

export class ProviderError extends Error {}

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
}

/**
 * Checks the types and required fields of an answer against its JSON Schema and returns the first
 * problem ("names: missing"). Providers in JSON mode and pasted answers are not held to the schema,
 * and a missing list would otherwise surface later as a confusing crash.
 */
export function shapeProblem(schema: object, value: unknown, path = ''): string | undefined {
  const s = schema as SchemaNode;
  const at = path || 'answer';
  const isType: Record<string, (v: unknown) => boolean> = {
    object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
    array: Array.isArray,
    string: (v) => typeof v === 'string',
    number: (v) => typeof v === 'number',
    integer: (v) => Number.isInteger(v),
    boolean: (v) => typeof v === 'boolean',
  };
  if (s.type && isType[s.type] && !isType[s.type]!(value)) return `${at}: expected ${s.type === 'array' ? 'a list' : s.type === 'object' ? 'an object' : `a ${s.type}`}`;
  if (s.type === 'object' && s.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) if (obj[key] === undefined) return `${path ? `${path}.` : ''}${key}: missing`;
    for (const [key, sub] of Object.entries(s.properties)) {
      if (obj[key] === undefined) continue;
      const problem = shapeProblem(sub, obj[key], path ? `${path}.${key}` : key);
      if (problem) return problem;
    }
  }
  if (s.type === 'array' && s.items) {
    for (const [i, item] of (value as unknown[]).entries()) {
      const problem = shapeProblem(s.items, item, `${at}[${i + 1}]`);
      if (problem) return problem;
    }
  }
  return undefined;
}

/** Rejects answers whose shape does not match the request's schema, with a readable message. */
export function withShapeCheck(provider: LlmProvider): LlmProvider {
  return {
    id: provider.id,
    supportsImages: provider.supportsImages,
    async generateJson(req) {
      const answer = await provider.generateJson(req);
      const problem = shapeProblem(req.schema, answer);
      if (problem) throw new ProviderError(`${req.label}: the AI's answer is not in the expected format (${problem})`);
      return answer;
    },
  };
}
