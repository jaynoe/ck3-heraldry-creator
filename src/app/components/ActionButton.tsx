import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, Spinner } from './Icon.tsx';

export interface ActionLabels {
  idle: ReactNode;
  /** Shown while the action runs, e.g. "Saving…". */
  busy?: ReactNode;
  /** Shown briefly after success, e.g. "Saved" (the check icon is added). */
  done?: ReactNode;
}

/**
 * A button that always tells the user what happened: busy while the action runs, a short
 * confirmation afterwards, and the error message if it failed. Use it for every action that
 * saves, copies, deletes or loads something.
 */
export function ActionButton({
  action,
  labels,
  className,
  disabled,
  title,
}: {
  action: () => unknown | Promise<unknown>;
  labels: ActionLabels;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);
  // Set on every mount: React's StrictMode runs mount → cleanup → mount in dev.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  async function run() {
    clearTimeout(timer.current);
    setState('busy');
    setError(undefined);
    try {
      await action();
      if (!mounted.current) return;
      setState('done');
      timer.current = setTimeout(() => mounted.current && setState('idle'), 2000);
    } catch (e) {
      if (!mounted.current) return;
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const label =
    state === 'busy' ? (
      <>
        <Spinner size={12} />
        {labels.busy ?? labels.idle}
      </>
    ) : state === 'done' ? (
      <>
        <Icon name="check" size={14} />
        {labels.done ?? 'Done'}
      </>
    ) : (
      labels.idle
    );
  return (
    <span className="action">
      <button className={className} disabled={disabled || state === 'busy'} onClick={run} title={title} data-state={state}>
        {label}
      </button>
      {state === 'error' && (
        <span className="action-error" role="alert">
          <Icon name="error" size={12} />
          Failed: {error}
        </span>
      )}
    </span>
  );
}
