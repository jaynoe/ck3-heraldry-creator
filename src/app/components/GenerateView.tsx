import { useEffect, useMemo, useState } from 'react';
import { ActionButton } from './ActionButton.tsx';
import { ReportTestLink, TestTag } from './TestTag.tsx';
import type { ProviderInfo } from '../../core/ai/providers/types.ts';
import { generateHouse, markExisting, moreNames, moreWords, newDesigns, type GeneratedDesign, type GenerationResult } from '../../core/ai/generate.ts';
import type { LlmProvider } from '../../core/ai/provider.ts';
import { serializeCoa } from '../../core/coa/serialize.ts';
import { newId } from '../../core/library.ts';
import { copyText, encodePngBrowser } from '../browser.ts';
import { useApp } from '../context.ts';
import { CoaPreview, useFrame } from './CoaPreview.tsx';
import type { EditorDoc } from './editor/doc.ts';
import { ErrorLine, Icon, Spinner } from './Icon.tsx';
import { Section } from './Section.tsx';
import type { HouseSeed } from './IdeaCard.tsx';
import { seconds, StepList, type Step } from './StepList.tsx';
import { EffortPicker } from './EffortPicker.tsx';
import { AI_MODES, withRequestOptions, type AiMode } from '../../core/ai/mode.ts';


const CONCEPT = 'Thinking up names, words and design directions';
const SHEETS = 'Rendering candidate sheets';
const COMPOSE = 'Composing designs';
const REVIEW = 'Reviewing rendered drafts';


export function GenerateView({
  parent,
  setParent,
  provider,
  providerLabel,
  providerInfo,
  onSettings,
  onEdit,
  onSaved,
  mode,
  onMode,
  seed,
}: {
  parent: string;
  onEdit: (doc: EditorDoc) => void;
  setParent: (key: string) => void;
  /** The configured provider, or why none is usable. */
  provider: LlmProvider | string;
  providerLabel: string;
  /** The active provider; its test status is shown when it is not "tested". */
  providerInfo: ProviderInfo;
  onSettings: () => void;
  /** Called after the chosen house was saved, to show it in the Collection. */
  onSaved: () => void;
  mode: AiMode;
  onMode: (m: AiMode) => void;
  /** An idea handed over from Inspiration, put into the idea field. */
  seed?: HouseSeed & { n: number };
}) {
  const { platform, session, ctx, playset } = useApp();
  const [idea, setIdea] = useState('');
  const [variants, setVariants] = useState(3);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<{ idea: string; parent?: string; variants: number; vision: boolean; steps: Step[]; ms?: number }>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<GenerationResult>();
  const [nameIdx, setNameIdx] = useState(0);
  const [wordsIdx, setWordsIdx] = useState(0);
  /** The design chosen for saving, like the chosen name and words. */
  const [selected, setSelected] = useState<GeneratedDesign>();
  /** Designs replaced by "New designs"; kept so nothing the user liked is lost. */
  const [earlier, setEarlier] = useState<GeneratedDesign[]>([]);
  const [designWish, setDesignWish] = useState('');
  const [designProgress, setDesignProgress] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  /** A follow-up AI call (more names, more words, new designs) is running; only one at a time. */
  const [followUp, setFollowUp] = useState(false);

  /** Name and words handed over from a run idea; offered first when generating. */
  const [chosen, setChosen] = useState<{ name?: string; words?: string }>({});
  useEffect(() => {
    if (!seed) return;
    setIdea(seed.idea);
    setChosen({ name: seed.name, words: seed.words });
  }, [seed]);

  const houses = useMemo(
    () => [...session.catalog.dynasties.values()].filter((d) => session.catalog.coas.has(d.key)).sort((a, b) => a.name.localeCompare(b.name)),
    [session],
  );
  const parentHouse = parent ? session.catalog.dynasties.get(parent) : undefined;
  const settings = AI_MODES[mode];
  // Economy leaves out all images: candidate sheets and the visual review.
  const vision = settings.vision ? { ctx, encodePng: encodePngBrowser } : undefined;

  async function generate() {
    if (typeof provider === 'string') return;
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    setSelected(undefined);
    setEarlier([]);
    setDesignWish('');
    const started = Date.now();
    setRun({ idea, parent: parent || undefined, variants, vision: provider.supportsImages && settings.vision, steps: [] });
    const addStep = (label: string) =>
      setRun((r) => {
        if (!r) return r;
        const t = Date.now();
        const steps = r.steps.map((s) => (s.end ? s : { ...s, end: t }));
        return { ...r, steps: [...steps, { label, start: t }] };
      });
    try {
      const r = await generateHouse(provider, session.catalog, {
        idea,
        parent: parent || undefined,
        variants,
        vision,
        repairRounds: settings.repairRounds,
        name: chosen.name,
        words: chosen.words,
        onProgress: addStep,
      });
      setResult(r);
      // The name from a run idea is the player's choice; otherwise the first one not taken in AGOT.
      setNameIdx(chosen.name ? 0 : Math.max(0, r.names.findIndex((n) => !n.existing)));
      setWordsIdx(0);
      setSelected(r.designs[0]);
      setRun((x) => x && { ...x, ms: Date.now() - started });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const houseName = result?.names[nameIdx]?.name ?? 'Unnamed';
  const houseWords = result?.words[wordsIdx];
  const script = (d: GeneratedDesign) => serializeCoa(d.coa, `coa_${houseName.toLowerCase().replace(/\W+/g, '_')}`);
  const context = () => ({ idea: run!.idea, parent: run!.parent, region: result!.region, name: houseName, words: houseWords });

  async function followUpCall<T>(call: (p: LlmProvider) => Promise<T>): Promise<T> {
    if (typeof provider === 'string') throw new Error(provider);
    setFollowUp(true);
    try {
      return await call(provider);
    } finally {
      setFollowUp(false);
    }
  }

  async function addNames() {
    // Names and words need no deep thinking, whatever the effort setting.
    const names = await followUpCall((p) => moreNames(withRequestOptions(p, { effort: 'low' }), session.catalog, { ...context(), shown: result!.names.map((n) => n.name) }));
    if (!names.length) throw new Error('no new names came back');
    setResult((r) => r && { ...r, names: [...r.names, ...names] });
  }

  async function addWords() {
    const words = await followUpCall((p) => moreWords(withRequestOptions(p, { effort: 'low' }), session.catalog, { ...context(), shown: result!.words }));
    if (!words.length) throw new Error('no new words came back');
    setResult((r) => r && { ...r, words: [...r.words, ...words] });
  }

  async function replaceDesigns() {
    const previous = [...result!.designs, ...earlier];
    setDesignProgress('');
    const designs = await followUpCall((p) =>
      newDesigns(p, session.catalog, {
        ...context(),
        feedback: designWish,
        previous,
        variants: run!.variants,
        vision,
        repairRounds: settings.repairRounds,
        onProgress: setDesignProgress,
      }),
    ).finally(() => setDesignProgress(undefined));
    setEarlier((e) => [...result!.designs, ...e]);
    setResult((r) => r && { ...r, designs });
    setSelected(designs[0]);
    setDesignWish('');
  }

  /** The user's own name or words: added as an option and selected, no AI involved. */
  function addOwnName(name: string) {
    const [option] = markExisting(session.catalog, [{ name, meaning: 'Your own name.' }]);
    setResult((r) => r && { ...r, names: [...r.names, option!] });
    setNameIdx(result!.names.length);
  }
  function addOwnWords(words: string) {
    setResult((r) => r && { ...r, words: [...r.words, words] });
    setWordsIdx(result!.words.length);
  }

  async function save() {
    const d = selected;
    if (!result || !run || !d) throw new Error('choose a design first');
    await platform.library.save({
      id: newId(),
      name: houseName,
      words: houseWords,
      idea: run.idea,
      region: result.region,
      parent: run.parent,
      script: script(d),
      playset: playset.name,
      createdAt: new Date().toISOString(),
    });
    // Let the "Saved" state show for a moment, then open the Collection with the new entry.
    setTimeout(onSaved, 700);
  }

  const noProvider = typeof provider === 'string';
  const frame = useFrame({ parent: run?.parent, region: result?.region });
  const card = (d: GeneratedDesign, i: number) => (
    <DesignCard
      key={i}
      design={d}
      frame={frame}
      selected={d === selected}
      onSelect={() => setSelected(d)}
      onCopy={() => copyText(script(d))}
      onEdit={() => onEdit({ coa: d.coa, name: houseName, words: houseWords, idea: run!.idea, region: result!.region, parent: run!.parent })}
    />
  );

  return (
    <div className="generate">
      <aside className="generate-input">
        <h1 className="title">Generate</h1>
        <label className="field">
          <span className="label">Idea for your house or cadet branch</span>
          <textarea
            rows={4}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. A minor Riverlands house of ferrymen on the Red Fork who grew rich on tolls…"
          />
        </label>
        {(chosen.name || chosen.words) && (
          <p className="chosen small">
            <Icon name="scroll" size={14} />
            <span className="chosen-text">
              From your run idea:{chosen.name && <b> House {chosen.name}</b>}
              {chosen.words && <span className="words small"> “{chosen.words}”</span>}. Offered first.
            </span>
            <button className="icon-btn" onClick={() => setChosen({})} aria-label="Don't use the name and words from the idea" title="Don't use them">
              <Icon name="close" size={14} />
            </button>
          </p>
        )}
        <label className="field">
          <span className="label">Cadet branch of (optional)</span>
          <span className="input-icon">
            <Icon name="search" size={16} />
            <input
              list="houses"
              className="clearable"
              value={parentHouse ? `${parentHouse.name} (${parentHouse.key})` : parent}
              onChange={(e) => setParent(/\(([^)]+)\)$/.exec(e.target.value)?.[1] ?? e.target.value)}
              placeholder={`Search ${houses.length.toLocaleString('en')} houses…`}
            />
            {parent && (
              <button className="clear" onClick={() => setParent('')} aria-label="Clear">
                <Icon name="close" size={16} />
              </button>
            )}
          </span>
          <datalist id="houses">
            {houses.map((d) => (
              <option key={d.key} value={`${d.name} (${d.key})`} />
            ))}
          </datalist>
        </label>
        <div className="field">
          <span className="label">Designs</span>
          <div className="segmented" role="radiogroup">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} role="radio" aria-checked={n === variants} data-active={n === variants || undefined} onClick={() => setVariants(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <EffortPicker mode={mode} onMode={onMode} disabled={running} />
        <button
          className="primary block"
          style={{ marginTop: 'var(--space-3)' }}
          disabled={running || followUp || !idea.trim() || noProvider}
          data-state={running ? 'busy' : undefined}
          onClick={generate}
        >
          {running ? (
            <>
              <Spinner size={12} /> Generating…
            </>
          ) : (
            'Generate'
          )}
        </button>
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
        {!run && (
          <div className="empty">
            <Icon name="shield" size={48} />
            <h2 className="heading">No designs yet</h2>
            <p>Describe a house in a sentence or two. The AI suggests names, house words and three coats of arms, and you can refine any of them in the editor.</p>
            <div className="steps-numerals">
              {[
                ['I', 'Describe', 'your idea'],
                ['II', 'Choose', 'a name, words, a design'],
                ['III', 'Copy', 'into the game'],
              ].map(([n, a, b]) => (
                <div key={n}>
                  <span className="numeral">{n}</span>
                  <b>{a}</b>
                  <span className="small">{b}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {run && !result && <Progress run={run} running={running} />}
        {error && <ErrorLine>{error}</ErrorLine>}

        {result && run && (
          <>
            <div className="result-head">
              <div className="stack" style={{ gap: 6 }}>
                <h1 className="title">House {houseName}</h1>
                {houseWords && <span className="words head-words">“{houseWords}”</span>}
              </div>
              {run.ms !== undefined && <span className="small muted done-in">Done in {seconds(run.ms)}</span>}
            </div>

            <div className="choices">
              <div className="field">
                <span className="label">Name</span>
                {result.names.map((n, i) => (
                  <label key={i} className="radio">
                    <input type="radio" name="gen-name" checked={i === nameIdx} onChange={() => setNameIdx(i)} />
                    <span>
                      <span className="name-line">
                        <span className="radio-title">{n.name}</span>
                        {n.existing && (
                          <span className="exists">
                            <Icon name="warning" size={12} /> already exists in AGOT
                          </span>
                        )}
                      </span>
                      <span className="desc">{n.meaning}</span>
                    </span>
                  </label>
                ))}
                <div className="more-row">
                  <ActionButton
                    className="secondary small"
                    disabled={followUp || noProvider}
                    action={addNames}
                    labels={{ idle: 'More names', busy: 'Thinking up names…', done: 'Added below' }}
                  />
                  <OwnEntry placeholder="Your own name…" onAdd={addOwnName} />
                </div>
              </div>
              <div className="field">
                <span className="label">Words</span>
                {result.words.map((w, i) => (
                  <label key={i} className="radio">
                    <input type="radio" name="gen-words" checked={i === wordsIdx} onChange={() => setWordsIdx(i)} />
                    <span className="words choice-words">“{w}”</span>
                  </label>
                ))}
                <div className="more-row">
                  <ActionButton
                    className="secondary small"
                    disabled={followUp || noProvider}
                    action={addWords}
                    labels={{ idle: 'More words', busy: 'Thinking up words…', done: 'Added below' }}
                  />
                  <OwnEntry placeholder="Your own words…" onAdd={addOwnWords} />
                </div>
              </div>
            </div>

            <div className="designs-label">
              <span className="label">Designs</span>
              <span className="small faint">Choose one to save it with the name and words. Edit opens it in the editor; Copy for game puts the script on your clipboard.</span>
              <span className="spacer" />
              <button className="secondary small" disabled={followUp || noProvider} onClick={() => setMoreOpen(true)}>
                {designProgress !== undefined ? (
                  <>
                    <Spinner size={12} /> {designProgress || 'Starting'}…
                  </>
                ) : (
                  'Generate more designs'
                )}
              </button>
            </div>
            <div className="design-cards">{result.designs.map(card)}</div>

            {earlier.length > 0 && (
              <Section icon="layers" title={`Earlier designs (${earlier.length})`} className="earlier">
                <p className="small faint">From previous rounds. You can still choose, copy or edit them.</p>
                <div className="design-cards">{earlier.map(card)}</div>
              </Section>
            )}

            {moreOpen && (
              <MoreDesignsDialog
                count={run.variants}
                wish={designWish}
                setWish={setDesignWish}
                progress={designProgress}
                onRun={async () => {
                  await replaceDesigns();
                  setMoreOpen(false);
                }}
                onClose={() => setMoreOpen(false)}
              />
            )}

            <div className="save-bar">
              <ActionButton
                className="primary"
                disabled={!selected}
                action={save}
                labels={{ idle: 'Save to Collection', busy: 'Saving…', done: 'Saved – opening Collection' }}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** One generated design with its actions. */
function DesignCard({
  design: d,
  frame,
  selected,
  onSelect,
  onCopy,
  onEdit,
}: {
  design: GeneratedDesign;
  frame?: string;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => Promise<void>;
  onEdit: () => void;
}) {
  return (
    <article className="card design-card" data-selected={selected || undefined} onClick={onSelect}>
      <CoaPreview coa={d.coa} size={256} fluid shape={frame} />
      <label className="design-title" onClick={(e) => e.stopPropagation()}>
        <input type="radio" name="gen-design" checked={selected} onChange={onSelect} />
        <h3 className="name">{d.title}</h3>
      </label>
      <p className="blazon">{d.blazon}</p>
      {d.review && (
        <div className="review">
          <span className="label">Review</span>
          <span className="desc-text">{d.review}</span>
        </div>
      )}
      {d.errors.length > 0 && <ErrorLine>{d.errors.join('; ')}</ErrorLine>}
      <div className="actions" onClick={(e) => e.stopPropagation()}>
        <ActionButton className="small" labels={{ idle: 'Copy for game', busy: 'Copying…', done: 'Copied' }} action={onCopy} />
        <button className="secondary small" onClick={onEdit}>
          Edit
        </button>
      </div>
    </article>
  );
}

/** Free text entry that adds the user's own option to a list ("Your own name…"). */
/** "Generate more designs": an optional wish, then a new round that keeps the name and words. */
function MoreDesignsDialog({
  count,
  wish,
  setWish,
  progress,
  onRun,
  onClose,
}: {
  count: number;
  wish: string;
  setWish: (v: string) => void;
  progress?: string;
  onRun: () => Promise<void>;
  onClose: () => void;
}) {
  const busy = progress !== undefined;
  return (
    <div className="overlay more-designs" onClick={() => !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 100%)' }}>
        <div className="dialog-head">
          <h2 className="heading">More designs</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="muted">
          Makes {count === 1 ? 'a new design' : `${count} new designs`} for the chosen name and words. The current ones move to “Earlier designs”, so
          nothing is lost.
        </p>
        <label className="field">
          <span className="label">What should be different? (optional)</span>
          <textarea
            rows={3}
            value={wish}
            onChange={(e) => setWish(e.target.value)}
            placeholder="e.g. “less wolf, more water, a darker field”"
            disabled={busy}
            autoFocus
          />
        </label>
        <div className="row">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <span className="spacer" />
          {busy && <span className="small muted">Takes about as long as the first run.</span>}
          <ActionButton className="primary" action={onRun} labels={{ idle: 'Generate designs', busy: `${progress || 'Starting'}…`, done: 'Done' }} />
        </div>
      </div>
    </div>
  );
}

function OwnEntry({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('');
  const add = () => {
    const v = value.trim().replace(/^["“”]+|["“”]+$/g, '');
    if (!v) return;
    onAdd(v);
    setValue('');
  };
  return (
    <span className="own-entry">
      <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={placeholder} />
      <button className="secondary small" disabled={!value.trim()} onClick={add}>
        Add
      </button>
    </span>
  );
}

function Progress({ run, running }: { run: { idea: string; variants: number; vision: boolean; steps: Step[] }; running: boolean }) {
  const expected = [CONCEPT, run.vision && SHEETS, COMPOSE, run.vision && REVIEW].filter((s): s is string => !!s);
  const last = run.steps.at(-1)?.label;
  // Repair steps belong between composing and reviewing.
  const pos = last ? (last.startsWith('Repairing') ? expected.indexOf(COMPOSE) : expected.indexOf(last)) : -1;
  return (
    <StepList
      title={`${running ? 'Generating' : 'Stopped'} · ${run.variants} ${run.variants === 1 ? 'design' : 'designs'}`}
      quote={run.idea}
      steps={run.steps}
      pending={expected.slice(pos + 1)}
      running={running}
      hint="Runs usually take 30–90 s. You can switch tabs, the run continues in the background."
    />
  );
}
