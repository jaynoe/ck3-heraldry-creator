import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManualStep } from '../core/ai/providers/manual.ts';
import { providerInfo, type ProviderSettings } from '../core/ai/providers/types.ts';
import {
  cacheKey,
  deserializeCatalog,
  playsetFingerprint,
  serializeCatalog,
  type CachedCatalog,
} from '../core/catalog/cache.ts';
import type { Playset } from '../core/mods/playsets.ts';
import { createLayers, HeraldrySession } from '../core/session.ts';
import { AppContext, type AppState } from './context.ts';
import { blankDoc, type EditorDoc } from './components/editor/doc.ts';
import { EditorView } from './components/editor/EditorView.tsx';
import { ImportPanel } from './components/editor/ImportPanel.tsx';
import { GenerateView } from './components/GenerateView.tsx';
import { HousesView } from './components/HousesView.tsx';
import { InspireView } from './components/InspireView.tsx';
import type { HouseSeed } from './components/IdeaCard.tsx';
import { ReportTestLink, TestTag } from './components/TestTag.tsx';
import { UpdateNotice } from './components/Updates.tsx';
import { CollectionView, type CollectionTab } from './components/CollectionView.tsx';
import { ManualDialog } from './components/ManualDialog.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { createProvider, loadAiMode, loadProviderSettings, saveAiMode, saveProviderSettings } from './providers.ts';
import { AI_MODES, withRequestOptions, type AiMode } from '../core/ai/mode.ts';
import { withShapeCheck } from '../core/ai/provider.ts';
import { ErrorLine, Icon, Spinner, type IconName } from './components/Icon.tsx';
import logo from './assets/quartered-small-dark.svg';
import type { Platform } from './platform/types.ts';

type Tab = 'inspire' | 'generate' | 'editor' | 'houses' | 'library' | 'settings';
/** Game files are never read automatically; only the button triggers a (slow) scan. */
type DataStatus = 'checking' | 'missing' | 'scanning' | 'ready';

export function App({ platform }: { platform: Platform }) {
  const [playsets, setPlaysets] = useState<Playset[]>();
  const [selected, setSelected] = useState<string>();
  const [state, setState] = useState<AppState>();
  const [status, setStatus] = useState<DataStatus>('checking');
  const [dataInfo, setDataInfo] = useState<{ createdAt: string; stale: boolean }>();
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>('generate');
  const [parent, setParent] = useState('');
  /** An idea handed over from Inspiration; the counter makes the same text count as a new hand-over. */
  const [ideaSeed, setIdeaSeed] = useState<HouseSeed & { n: number }>();
  const [collectionTab, setCollectionTab] = useState<CollectionTab>('arms');
  // The Windows build is not tested yet; say so once, until the user hides the notice.
  const onWindows = /Windows/.test(navigator.userAgent);
  const [windowsNoticeHidden, setWindowsNoticeHidden] = useState(() => {
    try {
      return localStorage.getItem('heraldry.windowsNotice') === 'hidden';
    } catch {
      return false;
    }
  });
  /** "Create this house" on a run idea: Generate with the idea (and the parent of a cadet branch). */
  const createFromIdea = (seed: HouseSeed) => {
    setIdeaSeed((s) => ({ ...seed, n: (s?.n ?? 0) + 1 }));
    setParent(seed.parent ?? '');
    setTab('generate');
  };
  const [editorDoc, setEditorDoc] = useState<EditorDoc>();
  const openEditor = (doc: EditorDoc) => {
    setEditorDoc(doc);
    setTab('editor');
  };
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings(platform));
  const [manual, setManual] = useState<{ step: ManualStep; resolve: (a: string) => void; reject: (e: Error) => void }>();

  const [aiMode, setAiModeState] = useState<AiMode>(loadAiMode);
  const setAiMode = (m: AiMode) => {
    setAiModeState(m);
    saveAiMode(m);
  };
  const provider = useMemo(() => {
    const p = createProvider(platform, providerSettings, (step) => new Promise((resolve, reject) => setManual({ step, resolve, reject })));
    return typeof p === 'string' ? p : withRequestOptions(withShapeCheck(p), { effort: AI_MODES[aiMode].effort });
  }, [platform, providerSettings, aiMode]);

  function changeProvider(s: ProviderSettings) {
    setProviderSettings(s);
    saveProviderSettings(s);
  }

  useEffect(() => {
    platform
      .loadPlaysets()
      .then((p) => {
        setPlaysets(p);
        setSelected(p.find((x) => x.isActive)?.id ?? p[0]?.id);
      })
      .catch((e: Error) => setError(e.message));
  }, [platform]);

  const playset = playsets?.find((p) => p.id === selected);
  // Ignore results of a load that was superseded by a newer one (e.g. quick playset switching).
  const loadId = useRef(0);

  async function open(scan: boolean) {
    if (!playset) return;
    const id = ++loadId.current;
    const current = () => id === loadId.current;
    setError(undefined);
    setState(undefined);
    setStatus(scan ? 'scanning' : 'checking');
    try {
      const { game, mods } = await platform.playsetSources(playset);
      const layers = await createLayers(game, mods);
      // A mod folder that lists as empty could not be read; say so instead of silently using vanilla data.
      const empty = await Promise.all(layers.map(async (l) => ((await l.source.list('')).length ? undefined : l.name)));
      if (!current()) return;
      setUnreadable(empty.filter((n): n is string => !!n));
      const fingerprint = playsetFingerprint(playset, await platform.gameVersion());
      let session: HeraldrySession | undefined;
      if (scan) {
        session = await HeraldrySession.open(layers);
        const cached = serializeCatalog(session.catalog, fingerprint, playset.name);
        await platform.cache.set(cacheKey(playset), JSON.stringify(cached));
        if (!current()) return;
        setDataInfo({ createdAt: cached.createdAt, stale: false });
      } else {
        const raw = await platform.cache.get(cacheKey(playset));
        const cached = raw ? (JSON.parse(raw) as CachedCatalog) : undefined;
        const catalog = cached && deserializeCatalog(cached, layers);
        if (!current()) return;
        if (!cached || !catalog) {
          setStatus('missing');
          return;
        }
        session = HeraldrySession.fromCatalog(layers, catalog);
        setDataInfo({ createdAt: cached.createdAt, stale: cached.fingerprint !== fingerprint });
      }
      const ctx = await session.renderContext();
      if (!current()) return;
      setState({ platform, playset, session, ctx });
      setStatus('ready');
    } catch (e) {
      if (!current()) return;
      setError((e as Error).message);
      setStatus('missing');
    }
  }

  // Switching playsets only looks for saved data; it never starts a scan by itself.
  useEffect(() => {
    open(false);
  }, [playset]);

  const info = providerInfo(providerSettings.id);
  const providerLabel = [info.label, providerSettings.model?.trim() || info.defaultModel, AI_MODES[aiMode].label].filter(Boolean).join(' · ');
  const scanning = status === 'scanning';

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src={logo} alt="" />
          <span className="name">Heraldry Creator</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(([t, label, icon, short]) => (
            <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              <Icon name={icon} size={16} />
              <span className={short ? 'long' : undefined}>{label}</span>
              {short && <span className="short">{short}</span>}
            </button>
          ))}
        </nav>
        <label className="playset">
          <span className="label">Playset</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!playsets || scanning}>
            {playsets?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.mods.length} mods){p.isActive ? ' – active' : ''}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="notices">
        {status === 'missing' && playset && (
          <div className="notice">
            <Icon name="import" size={20} />
            <p>
              The game and mod files for “{playset.name}” have not been read yet. Reading them takes a few seconds; afterwards the
              data is saved and loads instantly.
            </p>
            <button className="primary small" onClick={() => open(true)}>
              Read game files
            </button>
          </div>
        )}
        {scanning && (
          <div className="notice neutral">
            <Spinner size={18} />
            <p>Reading game and mod files for “{playset?.name}”… This takes a few seconds and only happens when you ask for it.</p>
          </div>
        )}
        {status === 'ready' && dataInfo?.stale && (
          <div className="notice">
            <Icon name="refresh" size={20} />
            <p>
              The game or the mods of this playset changed since the data was read. Emblems from updated mods may be missing until
              you re-read the game files.
            </p>
            <button className="secondary small" onClick={() => open(true)}>
              Re-read game files
            </button>
          </div>
        )}
        <UpdateNotice platform={platform} />
        {onWindows && !windowsNoticeHidden && (
          <div className="notice neutral">
            <Icon name="warning" size={20} />
            <p>
              The Windows version is new and has not been tested much yet. Whether it works for you or not, a short report helps:{' '}
              <ReportTestLink platform={platform} provider={providerSettings.id} label="report a test" />
            </p>
            <button
              className="secondary small"
              onClick={() => {
                setWindowsNoticeHidden(true);
                try {
                  localStorage.setItem('heraldry.windowsNotice', 'hidden');
                } catch {
                  // storage unavailable: hidden for this session only
                }
              }}
            >
              Got it
            </button>
          </div>
        )}
        {unreadable.length > 0 && (
          <div className="notice danger">
            <Icon name="error" size={20} />
            <p>
              {unreadable.length === 1 ? '1 folder' : `${unreadable.length} folders`} of this playset could not be read, so their
              emblems and houses are missing: {unreadable.map((n) => `“${n}”`).join(', ')}.
            </p>
          </div>
        )}
        {error && <ErrorLine className="app-error">{error}</ErrorLine>}
      </div>

      <main>
        {tab === 'settings' && <SettingsView platform={platform} settings={providerSettings} onChange={changeProvider} mode={aiMode} onMode={setAiMode} />}
        {state && (
          <AppContext.Provider value={state}>
            {/* Kept mounted so the ideas survive switching tabs. */}
            <div hidden={tab !== 'inspire'} className="fill">
              <InspireView
                provider={provider}
                providerLabel={providerLabel}
                providerInfo={info}
                mode={aiMode}
                onMode={setAiMode}
                onSettings={() => setTab('settings')}
                onCreate={createFromIdea}
                onEdit={openEditor}
              />
            </div>
            {/* Keep the generate view mounted so results survive switching tabs. */}
            <div hidden={tab !== 'generate'} className="fill">
              <GenerateView
                parent={parent}
                setParent={setParent}
                provider={provider}
                providerLabel={providerLabel}
                providerInfo={info}
                onSettings={() => setTab('settings')}
                onSaved={() => {
                  setCollectionTab('arms');
                  setTab('library');
                }}
                mode={aiMode}
                onMode={setAiMode}
                seed={ideaSeed}
                onEdit={openEditor}
              />
            </div>
            {/* Kept mounted so unsaved edits survive switching tabs. */}
            <div hidden={tab !== 'editor'}>
              {editorDoc ? (
                <EditorView doc={editorDoc} provider={provider} mode={aiMode} onMode={setAiMode} onOpen={openEditor} />
              ) : (
                <div className="editor-empty">
                  <div className="empty">
                    <Icon name="dividers" size={48} />
                    <h2 className="heading">Nothing open yet</h2>
                    <p>Open a design with “Edit” in Generate, AGOT houses or Collection – or start from scratch.</p>
                    <button className="primary" onClick={() => setEditorDoc(blankDoc())}>
                      New blank design
                    </button>
                  </div>
                  <div className="divider-label label faint">Or import from the game</div>
                  <div className="panel import-panel">
                    <ImportPanel onOpen={openEditor} />
                  </div>
                </div>
              )}
            </div>
            {tab === 'houses' && (
              <HousesView
                onCadet={(key) => {
                  setParent(key);
                  setTab('generate');
                }}
                onEdit={openEditor}
              />
            )}
            {tab === 'library' && (
              <CollectionView
                onEdit={openEditor}
                onCreate={createFromIdea}
                view={collectionTab}
                onView={setCollectionTab}
              />
            )}
          </AppContext.Provider>
        )}
      </main>

      <footer className="statusbar">
        {status === 'ready' && state && dataInfo ? (
          <span>
            {state.session.catalog.assets.colored_emblem.size.toLocaleString('en')} emblems ·{' '}
            {state.session.catalog.dynasties.size.toLocaleString('en')} houses · read {formatDate(dataInfo.createdAt)}
          </span>
        ) : (
          <span>{scanning ? 'Reading game files…' : status === 'checking' ? 'Loading…' : 'No game data read yet'}</span>
        )}
        {playset && (status === 'ready' || scanning) && (
          <button onClick={() => open(true)} disabled={scanning}>
            {scanning ? 'Reading…' : 'Re-read game files'}
          </button>
        )}
        <span className="ai">
          {typeof provider === 'string' ? (
            <span className="error">AI: {provider}</span>
          ) : (
            <>
              AI: {providerLabel}
              {info.tested !== 'tested' && <TestTag status={info.tested} />}
            </>
          )}
        </span>
      </footer>

      {manual && (
        <ManualDialog
          step={manual.step}
          onSubmit={(answer) => {
            manual.resolve(answer);
            setManual(undefined);
          }}
          onCancel={() => {
            manual.reject(new Error('Generation cancelled'));
            setManual(undefined);
          }}
        />
      )}
    </div>
  );
}

const TABS: [Tab, string, IconName, string?][] = [
  ['generate', 'Generate', 'quill'],
  ['editor', 'Editor', 'dividers'],
  ['inspire', 'Inspiration', 'scroll', 'Ideas'],
  ['houses', 'AGOT houses', 'keep', 'Houses'],
  ['library', 'Collection', 'shield'],
  ['settings', 'Settings', 'key'],
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
