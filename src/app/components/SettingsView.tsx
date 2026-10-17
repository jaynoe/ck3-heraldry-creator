import { useEffect, useState } from 'react';
import { ActionButton } from './ActionButton.tsx';
import { PROVIDERS, providerInfo, type ProviderId, type ProviderSettings } from '../../core/ai/providers/types.ts';
import type { Platform } from '../platform/types.ts';
import { Icon } from './Icon.tsx';
import { ReportTestLink, TestTag } from './TestTag.tsx';
import { UpdateSettings } from './Updates.tsx';
import { EffortPicker } from './EffortPicker.tsx';
import { isSafeModelName, type AiMode } from '../../core/ai/mode.ts';

export function SettingsView({
  platform,
  settings,
  onChange,
  mode,
  onMode,
}: {
  platform: Platform;
  settings: ProviderSettings;
  onChange: (s: ProviderSettings) => void;
  mode: AiMode;
  onMode: (m: AiMode) => void;
}) {
  const [keys, setKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [keyInput, setKeyInput] = useState('');
  const info = providerInfo(settings.id);

  const refreshKeys = () => platform.keys.status().then(setKeys).catch(() => setKeys({}));
  useEffect(() => {
    refreshKeys();
  }, [platform]);

  async function saveKey() {
    await platform.keys.set(settings.id, keyInput.trim());
    setKeyInput('');
    await refreshKeys();
  }

  async function removeKey() {
    await platform.keys.remove(settings.id);
    await refreshKeys();
  }

  const hasKey = !!keys[settings.id];
  const keyHost = info.keyUrl?.replace(/^https?:\/\/([^/]+).*$/, '$1');

  return (
    <div className="page narrow">
      <h1 className="title">Settings</h1>
      <div className="field" style={{ gap: 6 }}>
        <span className="label">AI provider</span>
        <p className="small muted">Which AI writes the names, words and designs. You can change it at any time.</p>
      </div>
      <div className="stack" style={{ gap: 4, marginTop: -8 }}>
        {PROVIDERS.map((p) => {
          const unavailable = p.id === 'claude-cli' && !platform.cliProvider;
          return (
            <label key={p.id} className="radio">
              <input type="radio" name="provider" checked={settings.id === p.id} disabled={unavailable} onChange={() => onChange({ id: p.id })} />
              <span>
                <span className="radio-title">{p.label}</span>
                <TestTag status={p.tested} />
                {p.needsKey && keys[p.id] && <span className="small accent"> · key saved</span>}
                {unavailable && <span className="small faint"> · not installed</span>}
                {p.note && <span className="desc">{p.note}</span>}
              </span>
            </label>
          );
        })}
      </div>

      {info.tested !== 'tested' && (
        <p className="small muted" style={{ marginTop: -8 }}>
          {info.label} has not been tried in real use yet. If you try it, a short report helps others:{' '}
          <ReportTestLink platform={platform} provider={info.id} />
        </p>
      )}

      {settings.id === 'claude-cli' && (
        <section className="panel provider-panel">
          <h2 className="name">
            {info.label} <TestTag status={info.tested} />
          </h2>
          <label className="field">
            <span className="label">Model</span>
            <input value={settings.model ?? ''} placeholder="Your Claude Code default" onChange={(e) => onChange({ ...settings, model: e.target.value })} />
            {settings.model?.trim() && !isSafeModelName(settings.model.trim()) ? (
              <span className="small error">Use letters, digits and . _ : - [ ] only, starting with a letter or digit.</span>
            ) : (
              <span className="small muted">
                Leave empty to use the model you chose in Claude Code. An alias such as <span className="mono">opus</span>,{' '}
                <span className="mono">sonnet</span> or <span className="mono">haiku</span>, or a full model id. Smaller models use less of your plan.
              </span>
            )}
          </label>
        </section>
      )}

      {settings.id !== 'claude-cli' && settings.id !== 'manual' && (
        <section className="panel provider-panel">
          <h2 className="name">
            {info.label} <TestTag status={info.tested} />
          </h2>
          <label className="field">
            <span className="label">Model</span>
            <input
              value={settings.model ?? ''}
              placeholder={info.defaultModel ?? info.modelHint}
              onChange={(e) => onChange({ ...settings, model: e.target.value })}
            />
            <span className="small muted">
              {info.defaultModel ? `Leave empty for the default (${info.defaultModel}). ` : `${info.modelHint}. `}
              The model needs image input for the visual review.
            </span>
          </label>
          {settings.id === 'ollama' && (
            <label className="field">
              <span className="label">Ollama server</span>
              <input value={settings.baseUrl ?? ''} placeholder="http://localhost:11434" onChange={(e) => onChange({ ...settings, baseUrl: e.target.value })} />
            </label>
          )}
          {info.needsKey && (
            <div className="field">
              <div className="row">
                <span className="label">API key</span>
                {hasKey ? (
                  <span className="small accent row" style={{ gap: 4 }}>
                    <Icon name="check" size={14} /> saved
                  </span>
                ) : (
                  <span className="small faint">not set</span>
                )}
                <span className="spacer" />
                {keyHost && <span className="small muted">get one at {keyHost}</span>}
              </div>
              <span className="input-icon">
                <Icon name="key" size={16} />
                <input
                  type="password"
                  value={keyInput}
                  placeholder={hasKey ? 'Paste a new key to replace the saved one' : 'Paste your API key'}
                  onChange={(e) => setKeyInput(e.target.value)}
                  autoComplete="off"
                />
              </span>
              <div className="row">
                <ActionButton className="primary small" disabled={!keyInput.trim()} action={saveKey} labels={{ idle: 'Save key', busy: 'Saving…', done: 'Key saved' }} />
                {hasKey && <ActionButton className="danger small" action={removeKey} labels={{ idle: 'Remove key', busy: 'Removing…', done: 'Removed' }} />}
              </div>
              <div className="info-box">
                <Icon name="key" size={16} />
                <span>
                  The key is stored by the {platform.name === 'tauri' ? 'system keychain' : 'dev server (~/.config/ck3-heraldry-creator)'} and only sent to{' '}
                  {info.label.replace(/ API$/, '')}. You pay the provider for usage.
                </span>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="stack" style={{ maxWidth: 420 }}>
        <EffortPicker mode={mode} onMode={onMode} />
        <p className="small muted">Applies to Generate and Improve with AI. You can also change it in Generate.</p>
      </section>

      <UpdateSettings platform={platform} />

      <p className="small faint">
        Heraldry Creator {__APP_VERSION__} ·{' '}
        <ReportTestLink platform={platform} provider={info.id} />
      </p>
    </div>
  );
}
