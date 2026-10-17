import { useEffect, useState } from 'react';
import type { AvailableUpdate, Platform } from '../platform/types.ts';
import { ActionButton } from './ActionButton.tsx';
import { Icon } from './Icon.tsx';

const SETTING_KEY = 'heraldry.updateCheck';

/** Whether the app looks for a new release at start (on unless turned off in Settings). */
export function loadUpdateCheck(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveUpdateCheck(on: boolean) {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // storage unavailable: the choice holds for this session only
  }
}

/** "Install and restart" where the app can update itself, otherwise a link to the release page. */
export function UpdateActions({ platform, update }: { platform: Platform; update: AvailableUpdate }) {
  const [percent, setPercent] = useState<number>();
  if (!update.install) {
    return (
      <ActionButton
        className="primary small"
        action={() => platform.openUrl(update.url)}
        labels={{ idle: 'Open download page', busy: 'Opening…', done: 'Opened in your browser' }}
      />
    );
  }
  return (
    <ActionButton
      className="primary small"
      action={() => update.install!(setPercent)}
      labels={{ idle: 'Install and restart', busy: percent === undefined ? 'Downloading…' : `Downloading… ${percent} %`, done: 'Restarting…' }}
    />
  );
}

/** Notice under the header when a newer release exists; the check runs once at start. */
export function UpdateNotice({ platform }: { platform: Platform }) {
  const [update, setUpdate] = useState<AvailableUpdate>();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!platform.checkUpdate || !loadUpdateCheck()) return;
    // A failed check at start (offline, GitHub down) is not worth a message; "Check now" in Settings reports it.
    platform.checkUpdate().then(setUpdate, () => {});
  }, [platform]);
  if (!update || hidden) return null;
  return (
    <div className="notice">
      <Icon name="seal" size={20} />
      <p>
        Heraldry Creator {update.version} is available (you have {__APP_VERSION__}).
        {!update.install && ' This installation is managed by your package manager, so download the new package from GitHub.'}
      </p>
      <UpdateActions platform={platform} update={update} />
      <button className="ghost small" onClick={() => setHidden(true)}>
        Later
      </button>
    </div>
  );
}

/** Settings part: the start-up check and a manual "Check now". */
export function UpdateSettings({ platform }: { platform: Platform }) {
  const [on, setOn] = useState(loadUpdateCheck);
  const [result, setResult] = useState<AvailableUpdate | 'current'>();
  if (!platform.checkUpdate) return null;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <span className="label">Updates</span>
      <label className="row" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            saveUpdateCheck(e.target.checked);
          }}
        />
        <span>Check for a new version at start</span>
      </label>
      <p className="small muted" style={{ marginTop: -4 }}>
        Asks GitHub for the latest release; nothing is installed without your click. Updates are signed and checked before they are installed.
      </p>
      <div className="row" style={{ gap: 12 }}>
        <ActionButton
          className="small"
          action={async () => setResult((await platform.checkUpdate!()) ?? 'current')}
          labels={{ idle: 'Check now', busy: 'Checking…', done: 'Checked' }}
        />
        {result === 'current' && <span className="small muted">You have the latest version ({__APP_VERSION__}).</span>}
        {result && result !== 'current' && (
          <>
            <span className="small">Version {result.version} is available.</span>
            <UpdateActions platform={platform} update={result} />
          </>
        )}
      </div>
    </section>
  );
}
