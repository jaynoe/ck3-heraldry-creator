import { useState } from 'react';
import type { ManualStep } from '../../core/ai/providers/manual.ts';
import { copyText } from '../browser.ts';
import { ActionButton } from './ActionButton.tsx';
import { Icon } from './Icon.tsx';

const STEP_NAMES: Record<string, string> = {
  concept: 'Step 1 of 2: names, words and ideas',
  compose: 'Step 2 of 2: the designs',
  'refine plan': 'Step 1 of 2: understanding the change',
  refine: 'Step 2 of 2: the revised design',
  directions: 'Step 1 of 2: new design ideas',
  'more names': 'More names',
  'more words': 'More house words',
};

/** "repair 2" → "Extra step: fixing design 2", "refine repair" → "Extra step: fixing the design". */
function stepTitle(label: string) {
  if (STEP_NAMES[label]) return STEP_NAMES[label];
  const repair = /repair\s*(\d*)$/.exec(label);
  if (repair) return `Extra step: fixing ${repair[1] ? `design ${repair[1]}` : 'the design'}`;
  return `Extra step: ${label}`;
}

const NEW_PROMPT = 'Step 1 is done. This is a NEW prompt: the old one will not work. Copy it again and start a new message in your AI chat.';
const STEP_INTRO: Record<string, string> = { compose: NEW_PROMPT, refine: NEW_PROMPT };

export function ManualDialog({ step, onSubmit, onCancel }: { step: ManualStep; onSubmit: (answer: string) => void; onCancel: () => void }) {
  const [answer, setAnswer] = useState('');
  const intro =
    STEP_INTRO[step.label] ??
    (step.label.includes('repair') ? 'A design had problems (unknown names or seams). This is a NEW prompt that asks the AI to fix it.' : undefined);

  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <h2 className="heading">{stepTitle(step.label)}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Cancel generation" title="Cancel generation">
            <Icon name="close" size={18} />
          </button>
        </div>
        {intro && (
          <div className="notice">
            <Icon name="refresh" size={18} />
            <p>
              <b>{intro}</b>
            </p>
          </div>
        )}
        <ol className="numbered">
          <li>Copy the prompt below and paste it into any AI chat (ChatGPT, Claude, Gemini …).</li>
          <li>Paste the AI's complete answer into the second box and press Continue.</li>
        </ol>
        <div className="row">
          <span className="label">Prompt</span>
          <span className="small muted">{Math.round(step.prompt.length / 1000)}k characters</span>
          <span className="spacer" />
          <ActionButton className="small" labels={{ idle: 'Copy prompt', busy: 'Copying…', done: 'Copied' }} action={() => copyText(step.prompt)} />
        </div>
        <textarea className="mono" readOnly rows={6} value={step.prompt} />
        <label className="field">
          <span className="label">Paste the AI's answer (JSON) here</span>
          <textarea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{ "designs": [ … ] }' />
        </label>
        <div className="row">
          <button className="ghost" onClick={onCancel}>
            Cancel generation
          </button>
          <span className="spacer" />
          {!answer.trim() && <span className="small faint">Paste an answer first</span>}
          <button className="primary" disabled={!answer.trim()} onClick={() => onSubmit(answer)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
