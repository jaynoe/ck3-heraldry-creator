import { useEffect, useMemo, useRef, useState } from 'react';
import { awoiafSource } from '../../core/ai/canon.ts';
import type { IdeaSnapshot } from '../../core/ai/inspire.ts';
import type { AiMode } from '../../core/ai/mode.ts';
import type { LlmProvider } from '../../core/ai/provider.ts';
import type { ProviderInfo } from '../../core/ai/providers/types.ts';
import { isIdea, jsonStore, newId } from '../../core/library.ts';
import { compactChat, digestChanges, maesterAnswer, newChat, readingGreeting, type MaesterChat, type MaesterMessage } from '../../core/maester/maester.ts';
import { parseCoaFile } from '../../core/coa/parse.ts';
import { armsFromHead, formatDate } from '../../core/save/digest.ts';
import { parseSaveHead } from '../../core/save/save-file.ts';
import type { CitadelChat } from '../../core/citadel.ts';
import { useApp } from '../context.ts';
import { SaveArchive } from '../maester/archive.ts';
import { readScreenshot, type Screenshot } from '../maester/screenshot.ts';
import type { SaveFileInfo } from '../platform/types.ts';
import { ActionButton } from './ActionButton.tsx';
import { ChatCompose, ChatMessage, Lightbox } from './ChatParts.tsx';
import { houseLine, IdeaMeta } from './IdeaCard.tsx';
import { CoaPreview } from './CoaPreview.tsx';
import { EffortPicker } from './EffortPicker.tsx';
import { ErrorLine, Icon, Spinner } from './Icon.tsx';
import { MaesterAvatar } from './MaesterAvatar.tsx';
import { ReportTestLink, TestTag } from './TestTag.tsx';

const MAX_SHOTS = 3;

/** A chat with the Maester about a running campaign; he knows it from a save. */
export function MaesterView({
  provider,
  providerLabel,
  providerInfo,
  mode,
  onMode,
  onSettings,
}: {
  provider: LlmProvider | string;
  providerLabel: string;
  providerInfo: ProviderInfo;
  mode: AiMode;
  onMode: (m: AiMode) => void;
  onSettings: () => void;
}) {
  const { platform, session } = useApp();
  const store = useMemo(() => jsonStore<MaesterChat>(platform.maester.load, platform.maester.save), [platform]);
  const archive = useMemo(() => new SaveArchive(platform, () => session.localization()), [platform, session]);
  const wiki = useMemo(() => awoiafSource(platform.wikiQuery), [platform]);
  useEffect(() => () => archive.close(), [archive]);

  const [chats, setChats] = useState<MaesterChat[]>();
  const [loadError, setLoadError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [picker, setPicker] = useState(false);
  const [scenarioPicker, setScenarioPicker] = useState(false);
  const [draft, setDraft] = useState('');
  const [shots, setShots] = useState<Screenshot[]>([]);
  /** Which attached screenshot is open in the lightbox. */
  const [shown, setShown] = useState<number>();
  const [shotError, setShotError] = useState<string>();
  /** The screenshots of the last message, kept in memory only, for "Try again". */
  const sentShots = useRef<Screenshot[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  /** The save that failed to read, so "Try again" reads it again instead of asking the AI. */
  const [failedSave, setFailedSave] = useState<SaveFileInfo>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    store.list().then(setChats, (e: Error) => setLoadError(e.message));
  }, [store]);

  // Chats read before arms were stored show those of their save file, if it is still there.
  const [fileArms, setFileArms] = useState<Map<string, MaesterChat['arms']>>(new Map());
  const armsMissing = chats?.some((c) => c.file && !c.arms);
  useEffect(() => {
    if (!armsMissing) return;
    platform.saves.list().then(
      (all) => setFileArms(new Map(all.map((s) => [s.name, armsFromHead(s.head)]))),
      () => undefined, // Only decoration: the plain shield stays.
    );
  }, [armsMissing, platform]);
  const armsOf = (c: MaesterChat) => c.arms ?? fileArms.get(c.file);

  const chat = chats?.find((c) => c.id === openId);
  const noProvider = typeof provider === 'string';
  const canSee = typeof provider !== 'string' && provider.supportsImages;
  const busy = step !== undefined;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [chat?.id, chat?.messages.length, step]);

  async function put(next: MaesterChat) {
    setChats((list) => [next, ...(list ?? []).filter((c) => c.id !== next.id)]);
    await store.save(next);
  }

  /** A new conversation; the Maester greets, and a save can be read at any time. */
  async function start() {
    const next = newChat(newId());
    await put(next);
    setOpenId(next.id);
    setError(undefined);
  }

  /** Reads a save into the open conversation. From the second reading on, the Maester also learns what changed. */
  async function read(save: SaveFileInfo, into: MaesterChat) {
    setPicker(false);
    setError(undefined);
    setFailedSave(undefined);
    setStep(`Fetching ${save.name}…`);
    try {
      const reading = await archive.open(save.name, setStep);
      const now = new Date().toISOString();
      const changes = into.notes ? digestChanges(into.notes, reading.notes) : undefined;
      const date = formatDate(reading.date);
      const message: MaesterMessage = { role: 'reading', text: date, at: now, file: save.name, saveDate: reading.date, changes };
      const head = parseSaveHead(save.head);
      const greeting = readingGreeting({ address: head.ruler ?? reading.title, nickname: reading.nickname, house: head.house, realm: head.title, date, known: !!into.notes && into.title === reading.title });
      await put({
        ...into,
        title: into.notes ? into.title : reading.title,
        file: save.name,
        notes: reading.notes,
        arms: reading.arms ?? into.arms,
        updatedAt: now,
        messages: [...into.messages, message, { role: 'maester', text: greeting, at: now }],
      });
    } catch (e) {
      setError(`Could not read ${save.name}: ${(e as Error).message}`);
      setFailedSave(save);
    } finally {
      setStep(undefined);
    }
  }

  /** Tells the Maester which scenario the lord set out to play. */
  async function chooseScenario(idea: IdeaSnapshot, into: MaesterChat) {
    const at = new Date().toISOString();
    const message: MaesterMessage = { role: 'scenario', text: idea.title, at };
    await put({ ...into, scenario: idea, title: into.notes || into.scenario ? into.title : idea.title, updatedAt: at, messages: [...into.messages, message] });
    setScenarioPicker(false);
  }

  /** Answers the last message of a chat. */
  async function answer(current: MaesterChat) {
    if (typeof provider === 'string') return;
    setError(undefined);
    setFailedSave(undefined);
    setStep('Your Maester considers the matter…');
    try {
      const compact = await compactChat(provider, current);
      const reply = await maesterAnswer(provider, compact, {
        records: (name) => archive.lookup(compact.file, name),
        wiki,
        images: sentShots.current.map((s) => s.image),
        onStep: setStep,
      });
      sentShots.current = [];
      await put({ ...compact, messages: [...compact.messages, reply], updatedAt: reply.at });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(undefined);
    }
  }

  async function attach(files: Iterable<Blob>) {
    setShotError(undefined);
    try {
      const read = await Promise.all([...files].map(readScreenshot));
      setShots((old) => {
        if (old.length + read.length > MAX_SHOTS) setShotError(`At most ${MAX_SHOTS} screenshots per message.`);
        return [...old, ...read].slice(0, MAX_SHOTS);
      });
    } catch (e) {
      setShotError((e as Error).message);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!chat || (!text && !shots.length) || busy) return;
    const at = new Date().toISOString();
    const images = shots.length ? shots.map((s) => s.url) : undefined;
    const next = { ...chat, updatedAt: at, messages: [...chat.messages, { role: 'lord' as const, text, at, images }] };
    sentShots.current = shots;
    setShots([]);
    setShotError(undefined);
    setDraft('');
    await put(next);
    await answer(next);
  }

  async function remove(id: string) {
    await store.remove(id);
    setChats((list) => list?.filter((c) => c.id !== id));
    setConfirmDelete(undefined);
    if (openId === id) setOpenId(undefined);
  }

  return (
    <div className="generate">
      <aside className="generate-input">
        <h1 className="title">Maester</h1>
        <ActionButton className="primary block" action={start} labels={{ idle: 'New conversation', busy: 'Starting…', done: 'Started' }} />
        {loadError && <ErrorLine>{loadError}</ErrorLine>}
        {chats && chats.length > 0 && (
          <div className="stack maester-chats" style={{ gap: 4 }}>
            <span className="label">Conversations</span>
            {chats.map((c) => (
              <div key={c.id} className="maester-chat" data-active={c.id === openId || undefined}>
                <button className="maester-chat-open" onClick={() => setOpenId(c.id)}>
                  <ChatArms arms={armsOf(c)} size={44} />
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="radio-title">{c.title}</span>
                    <span className="small muted">
                      {c.file || 'No save read'} · {new Date(c.updatedAt).toLocaleDateString()}
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
            <h2 className="heading">Your Maester awaits</h2>
            <p>
              Talk with him about your campaign: ask for advice, tell him what happened. Let him read a save, now or later, and he knows your house without
              you having to explain anything.
            </p>
            <p className="small faint">Only a summary of the save, the records he asks for and the screenshots you attach go to your AI provider. Conversations stay on this computer.</p>
            <ActionButton className="primary" action={start} labels={{ idle: 'Start a conversation', busy: 'Starting…', done: 'Started' }} />
          </div>
        )}

        {chat && (
          <>
            <div className="row maester-head">
              <ChatArms arms={armsOf(chat)} size={40} />
              <h2 className="heading">{chat.title}</h2>
              <span className="spacer" />
              <button className="small secondary" disabled={busy} onClick={() => setScenarioPicker(true)}>
                <Icon name="scroll" size={14} /> {chat.scenario ? 'Change scenario' : 'Add a scenario'}
              </button>
              <button className="small secondary" disabled={busy} onClick={() => setPicker(true)}>
                <Icon name="refresh" size={14} /> {chat.notes ? 'Read a newer save' : 'Read a save'}
              </button>
            </div>
            <div className="maester-log">
              {chat.messages.map((m, i) => (
                <Message key={i} message={m} arms={armsOf(chat)} />
              ))}
              {step && (
                <div className="maester-step" aria-live="polite">
                  <MaesterAvatar thinking />
                  <p className="muted">
                    <Spinner size={14} /> {step}
                  </p>
                </div>
              )}
              {error && (
                <div className="stack" style={{ gap: 6 }}>
                  <ErrorLine>{error}</ErrorLine>
                  <div>
                    <button className="small secondary" disabled={busy || (noProvider && !failedSave)} onClick={() => (failedSave ? read(failedSave, chat) : answer(chat))}>
                      Try again
                    </button>
                  </div>
                </div>
              )}
              <div ref={end} />
            </div>
            {(shots.length > 0 || shotError) && (
              <div className="maester-attached">
                {shots.map((s, i) => (
                  <span key={i} className="maester-attached-shot">
                    <button className="shot-open" title="Show larger" onClick={() => setShown(i)}>
                      <img src={s.url} alt={`Screenshot ${i + 1} to send`} />
                    </button>
                    <button className="icon-btn" title="Remove this screenshot" aria-label="Remove this screenshot" onClick={() => setShots((old) => old.filter((_, n) => n !== i))}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                ))}
                {shotError && <ErrorLine>{shotError}</ErrorLine>}
              </div>
            )}
            {shown !== undefined && shots.length > 0 && <Lightbox images={shots.map((s) => s.url)} start={Math.min(shown, shots.length - 1)} onClose={() => setShown(undefined)} />}
            <ChatCompose
              value={draft}
              onChange={setDraft}
              onSend={send}
              busy={busy}
              disabled={noProvider}
              attached={shots.length > 0}
              placeholder={canSee ? 'Ask your Maester, tell him what happened, or paste a screenshot…' : 'Ask your Maester, or tell him what happened…'}
              onPaste={(e) => {
                if (!canSee) return;
                const data = e.clipboardData;
                const isImage = (f: File | null): f is File => !!f?.type.startsWith('image/');
                let images = [...data.files].filter(isImage);
                if (!images.length) images = [...data.items].map((i) => (i.kind === 'file' ? i.getAsFile() : null)).filter(isImage);
                if (images.length) {
                  e.preventDefault();
                  attach(images);
                } else if (platform.clipboardImage && !data.getData('text/plain')) {
                  // The desktop app's web view may hand over no file for a pasted image: ask the host.
                  e.preventDefault();
                  platform.clipboardImage().then(
                    (blob) => (blob ? attach([blob]) : setShotError('There is no image on the clipboard.')),
                    (err: Error) => setShotError(`The clipboard could not be read: ${err.message}`),
                  );
                }
              }}
              tools={
                <>
                  <input
                    ref={filePicker}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) attach(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button className="small secondary" disabled={busy || !canSee || shots.length >= MAX_SHOTS} title={canSee ? 'Attach screenshots, or paste one into the box' : 'This AI provider cannot take images'} onClick={() => filePicker.current?.click()}>
                    <Icon name="plus" size={14} /> Screenshot
                  </button>
                </>
              }
            />
          </>
        )}
      </section>

      {scenarioPicker && chat && <ScenarioPicker onClose={() => setScenarioPicker(false)} onChoose={(idea) => chooseScenario(idea, chat)} />}
      {picker && chat && <SavePicker onClose={() => setPicker(false)} onRead={(save) => void read(save, chat)} />}
    </div>
  );
}

/** The arms of the lord's house as a small shield; a plain one until a save was read. */
function ChatArms({ arms, size }: { arms: MaesterChat['arms']; size: number }) {
  const coa = useMemo(() => (arms ? parseCoaFile(arms.script).values().next().value : undefined), [arms]);
  if (!coa) {
    return (
      <span className="maester-noarms" style={{ width: size, height: size }}>
        <Icon name="shield" size={Math.round(size * 0.6)} />
      </span>
    );
  }
  return <CoaPreview coa={coa} size={size} shape={arms?.frame} className="maester-arms" />;
}

function Message({ message: m, arms }: { message: MaesterMessage; arms: MaesterChat['arms'] }) {
  if (m.role === 'reading') {
    return (
      <div className="maester-reading">
        <p>
          <Icon name="check" size={16} /> Your Maester has read {m.file} · {m.text}
          {m.changes && ` · ${m.changes.length ? `${m.changes.length} ${m.changes.length === 1 ? 'change' : 'changes'}` : 'nothing new'}`}
        </p>
        {m.changes && m.changes.length > 0 && (
          <ul className="small muted">
            {m.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (m.role === 'scenario') {
    return (
      <div className="maester-reading">
        <p>
          <Icon name="scroll" size={16} /> Your Maester knows the plan: {m.text}
        </p>
      </div>
    );
  }
  return <ChatMessage message={m} speaker="Maester" avatar={<MaesterAvatar />} lord={<ChatArms arms={arms} size={48} />} />;
}

/** The scenarios to choose from: those saved in the Collection, then those of the Citadel's conversations. */
function ScenarioPicker({ onChoose, onClose }: { onChoose: (idea: IdeaSnapshot) => Promise<void>; onClose: () => void }) {
  const { platform } = useApp();
  const [ideas, setIdeas] = useState<IdeaSnapshot[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    Promise.all([platform.library.list(), platform.citadel.load()]).then(
      ([library, citadel]) => {
        const all = [...library.filter(isIdea).map((i) => i.idea), ...(JSON.parse(citadel) as CitadelChat[]).flatMap((c) => c.ideas)];
        setIdeas(all.filter((idea, i) => all.findIndex((o) => o.title === idea.title) === i));
      },
      (e: Error) => setError(e.message),
    );
  }, [platform]);
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" style={{ width: 'min(680px, 100%)' }}>
        <div className="dialog-head">
          <h2 className="heading">Which scenario do you set out on?</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="small muted">Your Maester keeps it in mind as your plan. What really happened still comes from your saves.</p>
        {error && <ErrorLine>{error}</ErrorLine>}
        {!ideas && !error && (
          <p className="small muted">
            <Spinner size={14} /> Looking for scenarios…
          </p>
        )}
        {ideas?.length === 0 && <p className="muted">No scenarios yet. Draw some up in the Citadel, then come back.</p>}
        <div className="stack maester-saves" style={{ gap: 6 }}>
          {ideas?.map((idea) => (
            <div key={idea.title} className="row nowrap maester-save">
              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span className="radio-title">{idea.title}</span>
                <IdeaMeta idea={idea} />
                <span className="small muted">{houseLine(idea)}</span>
              </span>
              <ActionButton className="small" action={() => onChoose(idea)} labels={{ idle: 'Choose', busy: 'Choosing…', done: 'Chosen' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The readable saves, newest first. Autosaves are binary and do not show. */
function SavePicker({ onRead, onClose }: { onRead: (save: SaveFileInfo) => void; onClose: () => void }) {
  const { platform } = useApp();
  const [saves, setSaves] = useState<SaveFileInfo[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    platform.saves.list().then(
      (all) => setSaves(all.filter((s) => parseSaveHead(s.head).readable)),
      (e: Error) => setError(e.message),
    );
  }, [platform]);
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" style={{ width: 'min(680px, 100%)' }}>
        <div className="dialog-head">
          <h2 className="heading">Which save shall he read?</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="small muted">Reading takes a few seconds. Autosaves cannot be read, so save the game by hand first.</p>
        {error && <ErrorLine>{error}</ErrorLine>}
        {!saves && !error && (
          <p className="small muted">
            <Spinner size={14} /> Looking for saves…
          </p>
        )}
        {saves?.length === 0 && <p className="muted">No readable saves found. Save your game by hand in Crusader Kings III, then come back.</p>}
        <div className="stack maester-saves" style={{ gap: 6 }}>
          {saves?.map((s) => {
            const head = parseSaveHead(s.head);
            return (
              <div key={s.name} className="row nowrap maester-save">
                <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <span className="radio-title">{head.ruler ?? s.name}</span>
                  <span className="small muted">
                    {[head.house && `House ${head.house}`, head.title, head.date && formatDate(head.date)].filter(Boolean).join(' · ')}
                  </span>
                  <span className="small faint mono">
                    {s.name} · saved {new Date(s.modified).toLocaleString()}
                  </span>
                </span>
                <button className="small" onClick={() => onRead(s)}>
                  Read
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
