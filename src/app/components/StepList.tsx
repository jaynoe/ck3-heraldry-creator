import { useEffect, useState } from 'react';
import { Icon, Spinner } from './Icon.tsx';

export interface Step {
  label: string;
  start: number;
  end?: number;
}

export const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Returns a function that ends the running step and starts the next one. */
export function nextStep(set: (update: (steps: Step[]) => Step[]) => void) {
  return (label: string) =>
    set((steps) => {
      const t = Date.now();
      return [...steps.map((s) => (s.end ? s : { ...s, end: t })), { label, start: t }];
    });
}

/**
 * Progress of an AI run as a list of steps with timers: done steps with their time, the current one with
 * a running clock, the expected ones greyed out. A step without an end after the run failed.
 */
export function StepList({
  title,
  quote,
  steps,
  pending,
  running,
  hint,
}: {
  title: string;
  quote?: string;
  steps: Step[];
  /** Steps still expected after the current one. */
  pending: string[];
  running: boolean;
  hint?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const short = quote && quote.length > 70 ? `${quote.slice(0, 70).trimEnd()}…` : quote;

  return (
    <div className="running-head">
      <p className="label">{title}</p>
      {short && <p className="words">“{short}”</p>}
      <ol className="progress">
        {steps.map((s, i) => {
          const current = running && i === steps.length - 1;
          return (
            <li key={i} data-state={current ? 'current' : s.end ? 'done' : 'failed'}>
              {current ? <Spinner size={16} /> : s.end ? <Icon name="check" size={16} /> : <Icon name="error" size={16} />}
              <span>{s.label}</span>
              <span className="num">{current ? clock(now - s.start) : s.end ? seconds(s.end - s.start) : ''}</span>
            </li>
          );
        })}
        {running &&
          pending.map((p) => (
            <li key={p} data-state="pending">
              <span className="lozenge" />
              <span>{p}</span>
            </li>
          ))}
      </ol>
      {running && hint && <p className="small muted">{hint}</p>}
    </div>
  );
}
