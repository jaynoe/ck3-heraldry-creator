import { useEffect, useMemo, useState } from 'react';
import { inspireRuns, inspireSteps, promptRules, snapshotIdea, START_KINDS, type IdeaSnapshot, type StartKind } from '../../core/ai/inspire.ts';
import { newId } from '../../core/library.ts';
import { IdeaCard, type HouseSeed } from './IdeaCard.tsx';
import { awoiafSource } from '../../core/ai/canon.ts';
import type { AiMode } from '../../core/ai/mode.ts';
import type { LlmProvider } from '../../core/ai/provider.ts';
import { useApp } from '../context.ts';
import { ActionButton } from './ActionButton.tsx';
import { ReportTestLink, TestTag } from './TestTag.tsx';
import type { ProviderInfo } from '../../core/ai/providers/types.ts';
import { EffortPicker } from './EffortPicker.tsx';
import type { EditorDoc } from './editor/doc.ts';
import { ErrorLine, Icon } from './Icon.tsx';
import { nextStep, StepList, type Step } from './StepList.tsx';

const PROFILE_KEY = 'heraldry.inspire';

interface Profile {
  playstyle: string;
  played: string;
}

function loadProfile(): Profile {
  try {
    return { playstyle: '', played: '', ...(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Partial<Profile>) };
  } catch {
    return { playstyle: '', played: '' };
  }
}

/** Starting ideas for a new campaign; "Create this house" hands an idea to Generate. */
export function InspireView({
  provider,
  providerLabel,
  providerInfo,
  mode,
  onMode,
  onSettings,
  onCreate,
  onEdit,
}: {
  provider: LlmProvider | string;
  providerLabel: string;
  /** The active provider; its test status is shown when it is not "tested". */
  providerInfo: ProviderInfo;
  mode: AiMode;
  onMode: (m: AiMode) => void;
  onSettings: () => void;
  /** Open Generate with this idea (and parent house for a cadet branch). */
  onCreate: (seed: HouseSeed) => void;
  onEdit: (doc: EditorDoc) => void;
}) {
  const { session, platform, playset } = useApp();
  const { catalog } = session;
  const [profile, setProfile] = useState(loadProfile);
  const [region, setRegion] = useState('');
  const [start, setStart] = useState<StartKind>('any');
  const [wish, setWish] = useState('');
  /** Shown ideas as snapshots: the same shape that gets saved to the Collection. */
  const [ideas, setIdeas] = useState<IdeaSnapshot[]>([]);
  /** Indexes of ideas saved in this session. */
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [ranking, setRanking] = useState('');
  const [running, setRunning] = useState(false);
  /** Steps of the current or last run; `more` when it adds to the ideas already shown. */
  const [run, setRun] = useState<{ steps: Step[]; more: boolean; quote: string }>();
  const [error, setError] = useState<string>();

  // The profile is kept for the next visit; it is the part people do not want to retype.
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // storage unavailable
    }
  }, [profile]);

  const regions = useMemo(() => [...new Set([...catalog.dynasties.values()].map((d) => d.group))].sort(), [catalog]);
  const noProvider = typeof provider === 'string';
  // AWOIAF links are free; the canon check costs a call, so Economy leaves it out.
  const wiki = useMemo(() => awoiafSource(platform.wikiQuery), [platform]);
  const canonOptions = { canon: wiki, checkCanon: mode !== 'economy' };

  async function saveIdea(i: number) {
    await platform.library.save({ kind: 'idea', id: newId(), idea: ideas[i]!, playset: playset.name, createdAt: new Date().toISOString() });
    setSaved((s) => new Set(s).add(i));
  }
  const progress = run && (
    <StepList
      title={`${running ? 'Finding ideas' : 'Stopped'}${run.more ? ' · more' : ''}`}
      quote={run.quote}
      steps={run.steps}
      pending={inspireSteps(canonOptions).slice(run.steps.length)}
      running={running}
      hint="Usually takes 20–60 s. You can switch tabs meanwhile."
    />
  );

  async function ask(more: boolean) {
    if (typeof provider === 'string') throw new Error(provider);
    setRunning(true);
    setError(undefined);
    setRun({ steps: [], more, quote: wish.trim() || profile.playstyle.trim() });
    const step = nextStep((update) => setRun((r) => r && { ...r, steps: update(r.steps) }));
    try {
      const r = await inspireRuns(provider, catalog, {
        ...profile,
        ...canonOptions,
        onProgress: step,
        region: region || undefined,
        start,
        wish,
        shown: more ? ideas.map((i) => i.title) : undefined,
      });
      const fresh = r.ideas.map(snapshotIdea);
      setIdeas((old) => (more ? [...old, ...fresh] : fresh));
      if (!more) setSaved(new Set());
      setRanking((old) => (more && old ? old : r.ranking));
      setRun(undefined);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="generate">
      <aside className="generate-input">
        <h1 className="title">Inspiration</h1>
        <label className="field">
          <span className="label">What you enjoy</span>
          <textarea
            rows={4}
            value={profile.playstyle}
            onChange={(e) => setProfile((p) => ({ ...p, playstyle: e.target.value }))}
            placeholder="e.g. building up small houses, starting from a fallen house, rebuilding ruins and special buildings"
          />
          <span className="small faint">Kept for next time.</span>
        </label>
        <label className="field">
          <span className="label">Already played (optional)</span>
          <textarea
            rows={2}
            value={profile.played}
            onChange={(e) => setProfile((p) => ({ ...p, played: e.target.value }))}
            placeholder="e.g. Reach, Essos, Crownlands, Westerlands; Farman in 276 AC"
          />
        </label>
        <div className="row nowrap" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Region</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Any</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Start as</span>
            <select value={start} onChange={(e) => setStart(e.target.value as StartKind)}>
              {(Object.keys(START_KINDS) as StartKind[]).map((k) => (
                <option key={k} value={k}>
                  {START_KINDS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label">Wish for this round (optional)</span>
          <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="e.g. something with ships, or a hard start" />
        </label>
        <EffortPicker mode={mode} onMode={onMode} disabled={running} />
        <ActionButton
          className="primary block"
          disabled={running || noProvider}
          action={() => ask(false)}
          labels={{ idle: 'Give me ideas', busy: 'Thinking up ideas…', done: 'Ideas ready' }}
        />
        {noProvider ? (
          <ErrorLine>
            {provider.replace(/\.$/, '')}.{' '}
            <button className="link" onClick={onSettings}>
              Open Settings
            </button>
          </ErrorLine>
        ) : (
          <p className="small muted" style={{ marginTop: -10 }}>
            AI: {providerLabel}
            {providerInfo.tested !== 'tested' && <TestTag status={providerInfo.tested} />}{' '}
            <button className="link small" style={{ marginLeft: 6 }} onClick={onSettings}>
              Change
            </button>
            {providerInfo.tested !== 'tested' && (
              <>
                {' · '}
                <ReportTestLink platform={platform} provider={providerInfo.id} />
              </>
            )}
          </p>
        )}
      </aside>

      <section className="generate-results">
        {!ideas.length && !run && !error && (
          <div className="empty">
            <Icon name="scroll" size={48} />
            <h2 className="heading">Looking for a new run?</h2>
            <p>
              Tell the AI what you enjoy and get a few starting ideas: a bookmark, a house or a place, game rules worth changing, and a sigil
              direction. Any idea can become a house in Generate.
            </p>
            <p className="small faint">
              Grounded in this playset: {catalog.bookmarks.filter((b) => b.characters.length).length} bookmarks, {promptRules(catalog).length} AGOT
              game rules, {regions.length} regions.
            </p>
          </div>
        )}

        {run && !run.more && progress}
        {error && !run?.more && <ErrorLine>{error}</ErrorLine>}

        {ideas.length > 0 && (
          <div className="stack" style={{ gap: 'var(--space-5)' }}>
            {ranking && (
              <div className="notice" style={{ alignItems: 'flex-start' }}>
                <Icon name="seal" size={20} />
                <p>{ranking}</p>
              </div>
            )}
            {ideas.map((idea, i) => (
              <IdeaCard key={i} idea={idea} n={i} actions={{ onCreate, onEdit }}>
                {saved.has(i) ? (
                  <button className="secondary small" data-state="done" disabled>
                    <Icon name="check" size={14} /> Saved to Collection
                  </button>
                ) : (
                  <ActionButton className="small" action={() => saveIdea(i)} labels={{ idle: 'Save idea', busy: 'Saving…', done: 'Saved' }} />
                )}
              </IdeaCard>
            ))}
            {run?.more && progress}
            {error && run?.more && <ErrorLine>{error}</ErrorLine>}
            <div>
              <ActionButton
                className="secondary"
                disabled={running || noProvider}
                action={() => ask(true)}
                labels={{ idle: 'More ideas', busy: 'Thinking up more ideas…', done: 'Added below' }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
