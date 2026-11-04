import { useEffect, useMemo, useRef, useState } from 'react';
import { awoiafSource } from '../../core/ai/canon.ts';
import type { AiMode } from '../../core/ai/mode.ts';
import type { LlmProvider } from '../../core/ai/provider.ts';
import type { ProviderInfo } from '../../core/ai/providers/types.ts';
import { jsonStore, newId } from '../../core/library.ts';
import { compactChat, digestChanges, maesterAnswer, newChat, readingGreeting, type MaesterChat, type MaesterMessage } from '../../core/maester/maester.ts';
import { parseCoaFile } from '../../core/coa/parse.ts';
import { armsFromHead, formatDate } from '../../core/save/digest.ts';
import { parseSaveHead } from '../../core/save/save-file.ts';
import { useApp } from '../context.ts';
import { SaveArchive } from '../maester/archive.ts';
import type { SaveFileInfo } from '../platform/types.ts';
import { ActionButton } from './ActionButton.tsx';
import { CoaPreview } from './CoaPreview.tsx';
import { EffortPicker } from './EffortPicker.tsx';
import { ErrorLine, Icon, Spinner } from './Icon.tsx';
import { MaesterAvatar } from './MaesterAvatar.tsx';
import { ReportTestLink, TestTag } from './TestTag.tsx';

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
  const [draft, setDraft] = useState('');
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
        onStep: setStep,
      });
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
    const next = { ...chat, updatedAt: at, messages: [...chat.messages, { role: 'lord' as const, text, at }] };
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
            <p className="small faint">Only a summary of the save and the records he asks for go to your AI provider. Conversations stay on this computer.</p>
            <ActionButton className="primary" action={start} labels={{ idle: 'Start a conversation', busy: 'Starting…', done: 'Started' }} />
          </div>
        )}

        {chat && (
          <>
            <div className="row maester-head">
              <ChatArms arms={armsOf(chat)} size={40} />
              <h2 className="heading">{chat.title}</h2>
              <span className="spacer" />
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
            <div className="maester-compose">
              <textarea
                rows={3}
                value={draft}
                placeholder="Ask your Maester, or tell him what happened…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="primary" disabled={busy || noProvider || !draft.trim()} onClick={send} title="Ctrl+Enter">
                {busy ? 'One moment…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </section>

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
  const { platform } = useApp();
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
  return (
    <article className="maester-message" data-role={m.role}>
      {m.role === 'lord' ? <ChatArms arms={arms} size={48} /> : <MaesterAvatar />}
      <div className="maester-bubble">
      <span className="label">{m.role === 'lord' ? 'You' : 'Maester'}</span>
      <p className="maester-text">{m.text}</p>
      {(m.consulted || m.sources) && (
        <p className="small muted">
          {m.consulted && `Consulted the records of ${m.consulted.join(', ')}. `}
          {m.sources && 'From A Wiki of Ice and Fire: '}
          {m.sources?.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ', '}
              <a
                href={s.url}
                onClick={(e) => {
                  e.preventDefault();
                  platform.openUrl(s.url);
                }}
              >
                {s.title}
              </a>
            </span>
          ))}
        </p>
      )}
      </div>
    </article>
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
