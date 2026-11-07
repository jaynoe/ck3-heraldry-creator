import { useEffect, useState, type ReactNode } from 'react';
import { ActionButton } from './ActionButton.tsx';
import { parseCoaFile } from '../../core/coa/parse.ts';
import { houseStory, isIdea, newId, type LibraryItem, type SavedCoa, type SavedIdea } from '../../core/library.ts';
import { copyText } from '../browser.ts';
import { useApp } from '../context.ts';
import { CoaPreview } from './CoaPreview.tsx';
import { frameFor } from '../../core/render/frame.ts';
import type { EditorDoc } from './editor/doc.ts';
import { ErrorLine, Icon, Spinner } from './Icon.tsx';
import { Section } from './Section.tsx';
import { houseLine, IdeaCard, IdeaMeta, IdeaMore, IdeaPart, useIdeaArms, type IdeaActions } from './IdeaCard.tsx';

export type CollectionTab = 'arms' | 'ideas';

function firstCoa(script: string) {
  try {
    return [...parseCoaFile(script).values()][0];
  } catch {
    return undefined;
  }
}

/** The Collection: saved arms and saved run ideas. */
export function CollectionView({
  onEdit,
  onCreate,
  view,
  onView,
}: {
  onEdit: (doc: EditorDoc) => void;
  onCreate: IdeaActions['onCreate'];
  view: CollectionTab;
  onView: (v: CollectionTab) => void;
}) {
  const { platform, playset, session } = useApp();
  const { catalog } = session;
  const [all, setAll] = useState<LibraryItem[]>();
  const items = all?.filter((i): i is SavedCoa => !isIdea(i));
  const ideas = all?.filter(isIdea);
  const [openIdea, setOpenIdea] = useState<SavedIdea>();
  const [openArms, setOpenArms] = useState<SavedCoa>();
  const [paste, setPaste] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const [loadError, setLoadError] = useState<string>();
  const reload = () =>
    platform.library
      .list()
      .then((i) => {
        setAll(i);
        setLoadError(undefined);
      })
      .catch((e: Error) => setLoadError(e.message));
  useEffect(() => {
    reload();
  }, [platform]);

  async function remove(id: string) {
    await platform.library.remove(id);
    setOpenIdea(undefined);
    setOpenArms(undefined);
    await reload();
  }

  async function importPaste() {
    await platform.library.save({
      id: newId(),
      name: pasteName.trim() || 'Imported',
      script: paste,
      playset: playset.name,
      createdAt: new Date().toISOString(),
    });
    setPaste('');
    setPasteName('');
    await reload();
  }

  const pasted = paste.trim() ? firstCoa(paste) : undefined;
  // With nothing saved yet, the add panel is the main thing on the page.
  const open = addOpen || items?.length === 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="title">Collection</h1>
        <span className="spacer" />
        <div className="segmented collection-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'arms'} data-active={view === 'arms' || undefined} onClick={() => onView('arms')}>
            Arms{items ? ` (${items.length})` : ''}
          </button>
          <button role="tab" aria-selected={view === 'ideas'} data-active={view === 'ideas' || undefined} onClick={() => onView('ideas')}>
            Run ideas{ideas ? ` (${ideas.length})` : ''}
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="banner">
          <Icon name="error" size={20} />
          <p>Could not load your Collection: {loadError}</p>
          <ActionButton className="small" action={reload} labels={{ idle: 'Retry', busy: 'Loading…', done: 'Loaded' }} />
        </div>
      ) : !items ? (
        <>
          <p className="row muted">
            <span className="accent row">
              <Spinner size={16} />
            </span>
            Loading…
          </p>
          <div className="row" style={{ gap: 16 }}>
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        </>
      ) : view === 'ideas' ? (
        <IdeaList ideas={ideas!} onOpen={setOpenIdea} />
      ) : (
        <>
          <Section icon="import" title="Add a design from the game (paste from the CoA designer)" open={open} onToggle={setAddOpen}>
            <p className="small muted">In the game's coat of arms designer, use the copy button, then paste here.</p>
            <div className="import-row" style={{ gridTemplateColumns: '1fr 128px' }}>
              <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="coa_rd_dynasty_…={ … }" />
              {pasted ? <CoaPreview coa={pasted} size={128} /> : <div className="hatch" style={{ width: 128, height: 128 }} />}
            </div>
            {paste.trim() && !pasted && <ErrorLine>This is not a valid coat of arms script.</ErrorLine>}
            <label className="field">
              <span className="label">Name (optional)</span>
              <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="e.g. Moatstark" />
            </label>
            <div>
              <ActionButton className="primary small" disabled={!pasted} action={importPaste} labels={{ idle: 'Save to Collection', busy: 'Saving…', done: 'Saved' }} />
            </div>
          </Section>

          {items.length === 0 ? (
            <div className="empty">
              <Icon name="shield" size={32} />
              <p>No saved arms yet. Generate some and press “Save”.</p>
            </div>
          ) : (
            <section className="cards3">
              {items.map((item) => {
                const coa = firstCoa(item.script);
                return (
                  <article
                    key={item.id}
                    className="card arms-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenArms(item)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && setOpenArms(item)}
                  >
                    <div className="well">
                      <CoaPreview coa={coa} size={192} shape={frameFor(catalog, { parent: item.parent, region: item.region })} />
                    </div>
                    <h3 className="name" style={{ marginTop: 8 }}>
                      {item.name}
                    </h3>
                    {item.words && <span className="words small">“{item.words}”</span>}
                    <span className="small faint">
                      {[item.region, item.playset, new Date(item.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                    </span>
                    <div className="row actions" onClick={(e) => e.stopPropagation()}>
                      <button className="primary small" onClick={() => setOpenArms(item)}>
                        Open
                      </button>
                      <ActionButton className="small" labels={{ idle: 'Copy for game', busy: 'Copying…', done: 'Copied' }} action={() => copyText(item.script)} />
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}

      {openArms && (
        <ArmsDialog
          item={openArms}
          onEdit={(doc) => (setOpenArms(undefined), onEdit(doc))}
          onDelete={() => remove(openArms.id)}
          onClose={() => setOpenArms(undefined)}
        />
      )}

      {openIdea && (
        <IdeaDialog
          item={openIdea}
          actions={{
            onCreate: (seed) => (setOpenIdea(undefined), onCreate(seed)),
            onEdit: (doc) => (setOpenIdea(undefined), onEdit(doc)),
          }}
          onDelete={() => remove(openIdea.id)}
          onClose={() => setOpenIdea(undefined)}
        />
      )}
    </div>
  );
}

function IdeaList({ ideas, onOpen }: { ideas: SavedIdea[]; onOpen: (i: SavedIdea) => void }) {
  if (!ideas.length)
    return (
      <div className="empty">
        <Icon name="scroll" size={32} />
        <p>No saved run ideas yet. In the Citadel, press “Save idea” on an idea you like.</p>
      </div>
    );
  return (
    <section className="cards3">
      {ideas.map((item) => (
        <IdeaTile key={item.id} item={item} onOpen={() => onOpen(item)} />
      ))}
    </section>
  );
}

function IdeaTile({ item, onOpen }: { item: SavedIdea; onOpen: () => void }) {
  const { idea } = item;
  const arms = useIdeaArms(idea);
  return (
    <article className="card idea-tile" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <h3 className="name">{idea.title}</h3>
      <IdeaMeta idea={idea} />
      <div className="idea-house">
        {arms.coa ? <CoaPreview coa={arms.coa} size={56} shape={arms.frame} /> : <div className="hatch" style={{ width: 56, height: 56 }} />}
        <span className="small">{houseLine(idea)}</span>
      </div>
      <p className="desc-text idea-tile-text">{idea.concept}</p>
      <div className="row" style={{ marginTop: 'auto' }}>
        <button className="primary small" onClick={(e) => (e.stopPropagation(), onOpen())}>
          Open
        </button>
        <span className="small faint">{[item.playset, new Date(item.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
      </div>
    </article>
  );
}

/** The popup for one thing in the Collection. */
function ItemDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog idea-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span className="label">{label}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Delete with a confirmation step, at the end of a popup's action row. */
function DeleteAction({ what, onDelete }: { what: string; onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <span className="spacer" />
      {confirm ? (
        <>
          <span className="small error">
            <b>Delete {what}? This cannot be undone.</b>
          </span>
          <ActionButton key="confirm" className="confirm small" action={onDelete} labels={{ idle: 'Really delete', busy: 'Deleting…', done: 'Deleted' }} />
          <button key="cancel" className="secondary small" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button key="delete" className="danger small" onClick={() => setConfirm(true)}>
          Delete
        </button>
      )}
    </>
  );
}

/** Saved arms in full: the shield first, the text behind them in the same parts as a run idea. */
function ArmsDialog({ item, onEdit, onDelete, onClose }: { item: SavedCoa; onEdit: (doc: EditorDoc) => void; onDelete: () => Promise<void>; onClose: () => void }) {
  const { session } = useApp();
  const coa = firstCoa(item.script);
  const story = item.idea ? houseStory(item.idea) : undefined;
  return (
    <ItemDialog label={`Saved arms · ${new Date(item.createdAt).toLocaleDateString()}`} onClose={onClose}>
      <article className="card idea-card">
        <div className="idea-house">
          <CoaPreview coa={coa} size={128} shape={frameFor(session.catalog, { parent: item.parent, region: item.region })} />
          <div className="stack" style={{ gap: 4 }}>
            <h2 className="heading">{item.name}</h2>
            {item.words && <span className="words small">“{item.words}”</span>}
            <span className="small muted">{[item.region, item.playset].filter(Boolean).join(' · ')}</span>
          </div>
        </div>

        {story && <IdeaPart label={story.title ?? 'The idea'}>{story.lead}</IdeaPart>}
        {story?.start && <IdeaPart label="Your start">{story.start}</IdeaPart>}
        {story?.catch && (
          <p className="idea-catch small">
            <Icon name="warning" size={14} />
            <span>{story.catch}</span>
          </p>
        )}
        {story && story.details.length > 0 && (
          <div className="idea-more">
            {story.details.map((d) => (
              <IdeaMore key={d.label} label={d.label}>
                <span className="idea-more-text">{d.text}</span>
              </IdeaMore>
            ))}
          </div>
        )}

        <div className="row idea-actions">
          <button
            className="primary small"
            disabled={!coa}
            onClick={() => onEdit({ coa: coa!, name: item.name, words: item.words, idea: item.idea, region: item.region, parent: item.parent, libraryId: item.id, createdAt: item.createdAt })}
          >
            Edit
          </button>
          <ActionButton className="small" labels={{ idle: 'Copy for game', busy: 'Copying…', done: 'Copied' }} action={() => copyText(item.script)} />
          <DeleteAction what={`“${item.name}”`} onDelete={onDelete} />
        </div>
      </article>
    </ItemDialog>
  );
}

/** A saved idea in full, with its actions and delete. */
function IdeaDialog({ item, actions, onDelete, onClose }: { item: SavedIdea; actions: IdeaActions; onDelete: () => Promise<void>; onClose: () => void }) {
  return (
    <ItemDialog label={`Saved run idea · ${new Date(item.createdAt).toLocaleDateString()}`} onClose={onClose}>
      <IdeaCard idea={item.idea} actions={actions}>
        <DeleteAction what="this idea" onDelete={onDelete} />
      </IdeaCard>
    </ItemDialog>
  );
}
