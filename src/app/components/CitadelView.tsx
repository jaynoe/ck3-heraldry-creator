import { useEffect, useMemo, useRef, useState } from 'react';
import { awoiafSource } from '../../core/ai/canon.ts';
import { inspireRuns, inspireSteps, promptRules, snapshotIdea } from '../../core/ai/inspire.ts';
import type { AiMode } from '../../core/ai/mode.ts';
import type { LlmProvider } from '../../core/ai/provider.ts';
import type { ProviderInfo } from '../../core/ai/providers/types.ts';
import { chatTitle, citadelAnswer, citadelBrief, newCitadelChat, scenariosMessage, type CitadelChat } from '../../core/citadel.ts';
import { jsonStore, newId } from '../../core/library.ts';
import { compactChat } from '../../core/maester/maester.ts';
import { useApp } from '../context.ts';
import { ActionButton } from './ActionButton.tsx';
import { ChatCompose, ChatMessage } from './ChatParts.tsx';
import { EffortPicker } from './EffortPicker.tsx';
import type { EditorDoc } from './editor/doc.ts';
import { ErrorLine, Icon, Spinner } from './Icon.tsx';
import { IdeaCard, type HouseSeed } from './IdeaCard.tsx';
import { MaesterAvatar } from './MaesterAvatar.tsx';
import { nextStep, StepList, type Step } from './StepList.tsx';
import { ReportTestLink, TestTag } from './TestTag.tsx';

const STARTERS = [
  'I want to rebuild a ruined castle. Which place and year would suit that best?',
  'I would like to play a bastard of a great house. When does that work best, and what could my goals be?',
  'Surprise me: something a little off the beaten path.',
];

/** A conversation about what to play next; "Generate scenarios" turns it into ideas. */
export function CitadelView({
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
  providerInfo: ProviderInfo;
  mode: AiMode;
  onMode: (m: AiMode) => void;
  onSettings: () => void;
  /** Open Generate with this idea (and parent house for a cadet branch). */
  onCreate: (seed: HouseSeed) => void;
  onEdit: (doc: EditorDoc) => void;
}) {
  const { platform, playset, session } = useApp();
  const { catalog } = session;
  const store = useMemo(() => jsonStore<CitadelChat>(platform.citadel.load, platform.citadel.save), [platform]);
  const wiki = useMemo(() => awoiafSource(platform.wikiQuery), [platform]);
  // AWOIAF links are free; the canon check costs a call, so Economy leaves it out.
  const canonOptions = { canon: wiki, checkCanon: mode !== 'economy' };

  const [chats, setChats] = useState<CitadelChat[]>();
  const [loadError, setLoadError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [view, setView] = useState<'talk' | 'scenarios'>('talk');
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState<string>();
  /** Steps of the scenarios being drawn up. */
  const [steps, setSteps] = useState<Step[]>();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    store.list().then(setChats, (e: Error) => setLoadError(e.message));
  }, [store]);

  const chat = chats?.find((c) => c.id === openId);
  const noProvider = typeof provider === 'string';
  const drawing = steps !== undefined;
  const busy = step !== undefined || drawing;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [chat?.id, chat?.messages.length, step, view]);

  async function put(next: CitadelChat) {
    setChats((list) => [next, ...(list ?? []).filter((c) => c.id !== next.id)]);
    await store.save(next);
  }

  async function start() {
    const next = newCitadelChat(newId());
    await put(next);
    open(next.id);
  }

  function open(id: string) {
    setOpenId(id);
    setView('talk');
    setError(undefined);
  }

  /** Answers the last message of a chat. */
  async function answer(current: CitadelChat) {
    if (typeof provider === 'string') return;
    setError(undefined);
    setStep('The Archmaester considers the matter…');
    try {
      const compact = await compactChat(provider, current);
      const reply = await citadelAnswer(provider, compact, catalog, { wiki, onStep: setStep });
      await put({ ...compact, messages: [...compact.messages, reply], updatedAt: reply.at });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(undefined);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!chat || !text || busy) return;
    const at = new Date().toISOString();
    const first = !chat.messages.some((m) => m.role === 'lord');
    const next: CitadelChat = { ...chat, title: first ? chatTitle(text) : chat.title, updatedAt: at, messages: [...chat.messages, { role: 'lord', text, at }] };
    setDraft('');
    setView('talk');
    await put(next);
    await answer(next);
  }

  /** Draws up scenarios from the conversation; the newest come first and the older ones stay. */
  async function draw(current: CitadelChat) {
    if (typeof provider === 'string') throw new Error(provider);
    setError(undefined);
    setView('scenarios');
    setSteps([]);
    try {
      const compact = await compactChat(provider, current);
      const r = await inspireRuns(provider, catalog, {
        ...canonOptions,
        conversation: citadelBrief(compact),
        shown: current.ideas.map((i) => i.title),
        onProgress: nextStep((update) => setSteps((s) => s && update(s))),
      });
      const fresh = r.ideas.map(snapshotIdea);
      await put({ ...compact, ideas: [...fresh, ...current.ideas], ranking: r.ranking, messages: [...compact.messages, scenariosMessage(fresh)], updatedAt: new Date().toISOString() });
      setSteps(undefined);
    } catch (e) {
      setError((e as Error).message);
      setSteps(undefined);
      throw e;
    }
  }

  async function saveIdea(current: CitadelChat, i: number) {
    const idea = current.ideas[i]!;
    await platform.library.save({ kind: 'idea', id: newId(), idea, playset: playset.name, createdAt: new Date().toISOString() });
    await put({ ...current, savedIdeas: [...(current.savedIdeas ?? []), idea.title] });
  }

  async function remove(id: string) {
    await store.remove(id);
    setChats((list) => list?.filter((c) => c.id !== id));
    setConfirmDelete(undefined);
    if (openId === id) setOpenId(undefined);
  }

  const regions = useMemo(() => new Set([...catalog.dynasties.values()].map((d) => d.group)).size, [catalog]);
  const untouched = chat && !chat.messages.some((m) => m.role === 'lord');

  return (
    <div className="generate">
      <aside className="generate-input">
        <h1 className="title">Citadel</h1>
        <ActionButton className="primary block" action={start} labels={{ idle: 'New conversation', busy: 'Starting…', done: 'Started' }} />
        {loadError && <ErrorLine>{loadError}</ErrorLine>}
        {chats && chats.length > 0 && (
          <div className="stack maester-chats" style={{ gap: 4 }}>
            <span className="label">Conversations</span>
            {chats.map((c) => (
              <div key={c.id} className="maester-chat" data-active={c.id === openId || undefined}>
                <button className="maester-chat-open" onClick={() => open(c.id)}>
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="radio-title">{c.title}</span>
                    <span className="small muted">
                      {c.ideas.length > 0 && `${c.ideas.length} ${c.ideas.length === 1 ? 'scenario' : 'scenarios'} · `}
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
                {confirmDelete === c.id ? (
                  <span className="row nowrap" style={{ gap: 6 }}>
                    <ActionButton key="really" className="confirm small" action={() => remove(c.id)} labels={{ idle: 'Really delete', busy: 'Deleting…', done: 'Deleted' }} />
                    <button key="keep" className="ghost small" onClick={() => setConfirmDelete(undefined)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button className="icon-btn" title="Delete this conversation" aria-label="Delete this conversation" onClick={() => setConfirmDelete(c.id)}>
                    <Icon name="bin" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <EffortPicker mode={mode} onMode={onMode} disabled={busy} />
        {noProvider ? (
          <ErrorLine>
            {(provider as string).replace(/\.$/, '')}.{' '}
            <button className="link" onClick={onSettings}>
              Open Settings
            </button>
          </ErrorLine>
        ) : (
          <p className="small muted">
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

      <section className="generate-results maester">
        {!chat && (
          <div className="empty">
            <Icon name="scroll" size={48} />
            <h2 className="heading">What will you play next?</h2>
            <p>Talk it over with the Archmaester: a house, a place, an age, a kind of tale. When you know what you want, he draws up full scenarios, and any of them can become a house in Generate.</p>
            <p className="small faint">
              He knows this playset: {catalog.bookmarks.filter((b) => b.characters.length).length} bookmarks, {promptRules(catalog).length} AGOT game rules, {regions} regions. Conversations stay on this computer.
            </p>
            <ActionButton className="primary" action={start} labels={{ idle: 'Start a conversation', busy: 'Starting…', done: 'Started' }} />
          </div>
        )}

        {chat && (
          <>
            <div className="row maester-head">
              <h2 className="heading citadel-title">{chat.title}</h2>
              <span className="spacer" />
              {(chat.ideas.length > 0 || drawing) && (
                <div className="segmented compact citadel-views" role="tablist">
                  <button role="tab" aria-selected={view === 'talk'} data-active={view === 'talk' || undefined} onClick={() => setView('talk')}>
                    Conversation
                  </button>
                  <button role="tab" aria-selected={view === 'scenarios'} data-active={view === 'scenarios' || undefined} onClick={() => setView('scenarios')}>
                    Scenarios ({chat.ideas.length})
                  </button>
                </div>
              )}
              <ActionButton className="primary small" disabled={busy || noProvider} action={() => draw(chat)} labels={{ idle: 'Generate scenarios', busy: 'Drawing up…', done: 'Drawn up' }} />
            </div>

            {view === 'talk' ? (
              <>
                <div className="maester-log">
                  {chat.messages.map((m, i) =>
                    m.role === 'scenarios' ? (
                      <div key={i} className="maester-reading">
                        <p>
                          <Icon name="scroll" size={16} /> Scenarios drawn up: {m.titles?.join(', ')} ·{' '}
                          <button className="link" onClick={() => setView('scenarios')}>
                            Show them
                          </button>
                        </p>
                      </div>
                    ) : (
                      <ChatMessage key={i} message={m} speaker="Archmaester" avatar={<MaesterAvatar arch />} lord={<span className="maester-noarms" style={{ width: 48, height: 48 }}><Icon name="shield" size={28} /></span>} />
                    ),
                  )}
                  {untouched && (
                    <div className="citadel-starters">
                      {STARTERS.map((s) => (
                        <button key={s} className="secondary small" onClick={() => setDraft(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {step && (
                    <div className="maester-step" aria-live="polite">
                      <MaesterAvatar arch thinking />
                      <p className="muted">
                        <Spinner size={14} /> {step}
                      </p>
                    </div>
                  )}
                  {error && (
                    <div className="stack" style={{ gap: 6 }}>
                      <ErrorLine>{error}</ErrorLine>
                      <div>
                        <button className="small secondary" disabled={busy || noProvider} onClick={() => answer(chat)}>
                          Try again
                        </button>
                      </div>
                    </div>
                  )}
                  <div ref={end} />
                </div>
                <ChatCompose value={draft} onChange={setDraft} onSend={send} busy={busy} disabled={noProvider} placeholder="Tell the Archmaester what you have a mind to play…" />
              </>
            ) : (
              <div className="maester-log">
                {steps && (
                  <StepList
                    title="Drawing up scenarios"
                    quote={chat.title}
                    steps={steps}
                    pending={inspireSteps(canonOptions).slice(steps.length)}
                    running
                    hint="Usually takes 20–60 s. You can switch tabs meanwhile."
                  />
                )}
                {error && <ErrorLine>{error}</ErrorLine>}
                {chat.ranking && !steps && (
                  <div className="notice" style={{ alignItems: 'flex-start' }}>
                    <Icon name="seal" size={20} />
                    <p>{chat.ranking}</p>
                  </div>
                )}
                {chat.ideas.map((idea, i) => (
                  <IdeaCard key={`${idea.title}-${i}`} idea={idea} n={i} actions={{ onCreate, onEdit }}>
                    {chat.savedIdeas?.includes(idea.title) ? (
                      <button className="secondary small" data-state="done" disabled>
                        <Icon name="check" size={14} /> Saved to Collection
                      </button>
                    ) : (
                      <ActionButton className="small" action={() => saveIdea(chat, i)} labels={{ idle: 'Save idea', busy: 'Saving…', done: 'Saved' }} />
                    )}
                  </IdeaCard>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
