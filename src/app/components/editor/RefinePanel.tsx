import { useState } from 'react';
import type { LlmProvider } from '../../../core/ai/provider.ts';
import { refineDesign, type RefineResult } from '../../../core/ai/refine.ts';
import type { CoatOfArms } from '../../../core/coa/model.ts';
import { encodePngBrowser } from '../../browser.ts';
import { useApp } from '../../context.ts';
import { CoaPreview } from '../CoaPreview.tsx';
import { AI_MODES, type AiMode } from '../../../core/ai/mode.ts';
import { EffortPicker } from '../EffortPicker.tsx';
import { ErrorLine, Spinner } from '../Icon.tsx';

/** "Improve with AI": describe a change, compare before/after, apply as an undoable edit. */
export function RefinePanel({
  coa,
  name,
  words,
  provider,
  mode,
  onMode,
  onApply,
  frame,
}: {
  /** Shield shape of the edited design. */
  frame?: string;
  coa: CoatOfArms;
  name: string;
  words: string;
  provider: LlmProvider | string;
  mode: AiMode;
  onMode: (m: AiMode) => void;
  onApply: (coa: CoatOfArms) => void;
}) {
  const { session, ctx } = useApp();
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<RefineResult & { before: CoatOfArms }>();
  const [took, setTook] = useState<number>();

  async function run() {
    if (typeof provider === 'string') return;
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    setTook(undefined);
    const started = Date.now();
    try {
      const r = await refineDesign(provider, session.catalog, {
        coa,
        instruction,
        name,
        words,
        vision: AI_MODES[mode].vision ? { ctx, encodePng: encodePngBrowser } : undefined,
        repairRounds: AI_MODES[mode].repairRounds,
        onProgress: setProgress,
      });
      setResult({ ...r, before: coa });
      setTook(Date.now() - started);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(undefined);
    }
  }

  return (
    <>
      <textarea
        rows={3}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Describe the change, e.g. “yellow field, the lion in red, add a small crown above it”"
      />
      <div style={{ maxWidth: 380 }}>
        <EffortPicker mode={mode} onMode={onMode} disabled={running} compact />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <button
          className="primary small"
          disabled={running || !instruction.trim() || typeof provider === 'string'}
          data-state={running ? 'busy' : undefined}
          onClick={run}
        >
          {running ? (
            <>
              <Spinner size={12} /> Working…
            </>
          ) : (
            'Improve'
          )}
        </button>
        <span className="small muted">
          {running ? `${progress ?? 'Starting'}…` : took !== undefined && result ? `Done in ${Math.round(took / 1000)} s` : 'Takes 15–40 s'}
        </span>
      </div>
      {typeof provider === 'string' && <ErrorLine>{provider} (see Settings)</ErrorLine>}
      {error && <ErrorLine>Failed: {error}</ErrorLine>}
      {result && (
        <div className="refine-result">
          <figure className="compare">
            <CoaPreview coa={result.before} size={160} shape={frame} />
            <figcaption className="label faint">Before</figcaption>
          </figure>
          <figure className="compare">
            <CoaPreview coa={result.coa} size={160} shape={frame} />
            <figcaption className="label accent">Suggestion</figcaption>
          </figure>
          <div className="stack">
            <p>{result.note}</p>
            {result.errors.length > 0 && <ErrorLine>{result.errors.join('; ')}</ErrorLine>}
            <div className="row">
              <button
                className="primary small"
                onClick={() => {
                  onApply(result.coa);
                  setResult(undefined);
                  setInstruction('');
                }}
              >
                Apply
              </button>
              <button className="secondary small" onClick={() => setResult(undefined)}>
                Discard
              </button>
            </div>
            <span className="small faint">Applying is one editor step – Undo brings the old design back.</span>
          </div>
        </div>
      )}
    </>
  );
}
