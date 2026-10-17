import { useEffect, useState } from 'react';
import { AI_MODES, type AiMode } from '../../core/ai/mode.ts';
import { Icon } from './Icon.tsx';

const MODES = Object.keys(AI_MODES) as AiMode[];

/** "AI effort" segmented control with an info button; used in Settings and Generate. */
export function EffortPicker({
  mode,
  onMode,
  disabled,
  compact,
}: {
  mode: AiMode;
  onMode: (m: AiMode) => void;
  disabled?: boolean;
  /** Smaller buttons, e.g. inside the editor's "Improve with AI" section. */
  compact?: boolean;
}) {
  const [info, setInfo] = useState(false);
  return (
    <div className="field">
      <span className="row" style={{ gap: 6 }}>
        <span className="label">AI effort</span>
        <button className="info-btn" onClick={() => setInfo(true)} aria-label="What does AI effort change?" title="What does this change?">
          i
        </button>
      </span>
      <div className={compact ? 'segmented compact' : 'segmented'} role="radiogroup">
        {MODES.map((m) => (
          <button key={m} role="radio" aria-checked={m === mode} data-active={m === mode || undefined} disabled={disabled} onClick={() => onMode(m)}>
            {AI_MODES[m].label}
          </button>
        ))}
      </div>
      {info && <EffortInfo onClose={() => setInfo(false)} />}
    </div>
  );
}

function EffortInfo({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 100%)' }}>
        <div className="dialog-head">
          <h2 className="heading">AI effort</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="muted">
          How much work the AI may put into a generation. Less effort uses fewer tokens: less of your Claude plan's usage, or a smaller bill with an
          API key. It also finishes faster.
        </p>
        <table className="info-table">
          <thead>
            <tr>
              <th />
              <th>Economy</th>
              <th>Normal</th>
              <th>Thorough</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Thinking</th>
              <td>short</td>
              <td>medium</td>
              <td>long</td>
            </tr>
            <tr>
              <th>Sees emblem images</th>
              <td>no, picks by file name</td>
              <td>yes</td>
              <td>yes</td>
            </tr>
            <tr>
              <th>Checks the finished drafts</th>
              <td>no</td>
              <td>once, by image</td>
              <td>once, by image</td>
            </tr>
            <tr>
              <th>Checks canon (Inspiration)</th>
              <td>no, only links the AWOIAF articles</td>
              <td>against A Wiki of Ice and Fire</td>
              <td>against A Wiki of Ice and Fire</td>
            </tr>
            <tr>
              <th>Fixes broken designs</th>
              <td>1 round</td>
              <td>1 round</td>
              <td>up to 2 rounds</td>
            </tr>
            <tr>
              <th>Tokens (rough)</th>
              <td>⅓–½</td>
              <td>baseline</td>
              <td>more</td>
            </tr>
          </tbody>
        </table>
        <ul className="info-list small muted">
          <li>Images cost far more than text, so Economy saves the most by leaving them out. The catch: without seeing the emblems, the AI more often picks one that looks different from what its name suggests.</li>
          <li>“More names” and “More words” always run with short thinking; they need no images.</li>
          <li>The model has the biggest effect on usage: a smaller model (e.g. Sonnet or Haiku instead of Opus) is cheaper at every level. Set it under Settings → AI provider.</li>
          <li>
            Thinking time is set where the provider supports it (Claude Code, Anthropic API, OpenAI reasoning models, OpenRouter). With Gemini and Ollama only
            the image and check savings apply. Copy &amp; paste never uses images.
          </li>
        </ul>
        <div className="row">
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
