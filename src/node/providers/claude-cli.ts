// Uses the locally installed Claude Code CLI (`claude -p`) with the user's own login,
// so generation runs on their Claude subscription without an API key. Local/native only.

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { EFFORTS, isSafeModelName } from '../../core/ai/mode.ts';
import { ProviderError, type JsonRequest, type LlmProvider } from '../../core/ai/provider.ts';

export interface ClaudeCliOptions {
  /** CLI executable, default "claude". */
  command?: string;
  /** Model alias or id; defaults to the CLI's configured model. */
  model?: string;
  timeoutMs?: number;
}

export class ClaudeCliProvider implements LlmProvider {
  readonly id = 'claude-cli';
  readonly supportsImages = true;
  constructor(private options: ClaudeCliOptions = {}) {}

  generateJson(req: JsonRequest): Promise<unknown> {
    // Images need the stream-json input format, which in turn requires stream-json output.
    const streaming = !!req.images?.length;
    const args = [
      '-p',
      ...(streaming ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
      '--json-schema', JSON.stringify(req.schema),
      '--system-prompt', req.system,
      '--tools', '',
      '--no-session-persistence',
    ];
    // Model and effort can come from the page, so only well-formed values become arguments.
    const model = req.model ?? this.options.model;
    if (model) {
      if (!isSafeModelName(model)) return Promise.reject(new ProviderError(`${req.label}: invalid model name "${model}"`));
      args.push('--model', model);
    }
    if (req.effort) {
      if (!EFFORTS.includes(req.effort)) return Promise.reject(new ProviderError(`${req.label}: invalid effort "${req.effort}"`));
      args.push('--effort', req.effort);
    }

    return new Promise((resolve, reject) => {
      // Run outside the repo so the CLI does not pick up this project's CLAUDE.md.
      const child = spawn(this.options.command ?? 'claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new ProviderError(`${req.label}: claude CLI timed out`));
      }, this.options.timeoutMs ?? 300_000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new ProviderError(`${req.label}: cannot start claude CLI (${e.message})`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          // stream-json prints one event per line; the last one is the result.
          const line = streaming ? out.trim().split('\n').at(-1)! : out;
          const result = JSON.parse(line) as { is_error?: boolean; result?: string; structured_output?: unknown };
          if (result.is_error || result.structured_output === undefined) {
            reject(new ProviderError(`${req.label}: ${result.result ?? 'no structured output'}`));
          } else resolve(result.structured_output);
        } catch {
          reject(new ProviderError(`${req.label}: claude CLI exited with ${code}: ${(err || out).slice(0, 500)}`));
        }
      });
      // The prompt goes over stdin; it can be long (candidate lists).
      if (streaming) {
        const content = [
          ...req.images!.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
          { type: 'text', text: req.prompt },
        ];
        child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
      } else child.stdin.end(req.prompt);
    });
  }
}
