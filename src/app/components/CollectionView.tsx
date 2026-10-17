import { useEffect, useState } from 'react';
import { ActionButton } from './ActionButton.tsx';
import { parseCoaFile } from '../../core/coa/parse.ts';
import { isIdea, newId, type LibraryItem, type SavedCoa, type SavedIdea } from '../../core/library.ts';
import { copyText } from '../browser.ts';
import { useApp } from '../context.ts';
import { CoaPreview } from './CoaPreview.tsx';
import { frameFor } from '../../core/render/frame.ts';
import type { EditorDoc } from './editor/doc.ts';
import { ErrorLine, Icon, Spinner } from './Icon.tsx';
import { Section } from './Section.tsx';
import { houseLine, IdeaCard, IdeaMeta, useIdeaArms, type IdeaActions } from './IdeaCard.tsx';

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
  const [confirmDelete, setConfirmDelete] = useState<string>();
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
    setConfirmDelete(undefined);
    setOpenIdea(undefined);
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
                const confirming = confirmDelete === item.id;
                return (
                  <article key={item.id} className="card arms-card" data-confirm={confirming || undefined}>
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
                    {item.idea && <p className="desc-text">{item.idea}</p>}
                    <div className="actions stack" style={{ gap: 10 }}>
                      {confirming && (
                        <p className="small error">
                          <b>Delete “{item.name}” from your Collection? This cannot be undone.</b>
                        </p>
                      )}
                      <div className="row">
                        {confirming ? (
                          <>
                            <ActionButton key="confirm" className="confirm small" action={() => remove(item.id)} labels={{ idle: 'Really delete', busy: 'Deleting…', done: 'Deleted' }} />
                            <button key="cancel" className="secondary small" onClick={() => setConfirmDelete(undefined)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <ActionButton key="copy" className="small" labels={{ idle: 'Copy for game', busy: 'Copying…', done: 'Copied' }} action={() => copyText(item.script)} />
                            <button
                              className="secondary small"
                              disabled={!coa}
                              onClick={() =>
                                onEdit({ coa: coa!, name: item.name, words: item.words, idea: item.idea, region: item.region, parent: item.parent, libraryId: item.id, createdAt: item.createdAt })
                              }
                            >
                              Edit
                            </button>
                            <button className="danger small" onClick={() => setConfirmDelete(item.id)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
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
        <p>No saved run ideas yet. In Inspiration, press “Save idea” on an idea you like.</p>
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

/** A saved idea in full, with its actions and delete. */
function IdeaDialog({ item, actions, onDelete, onClose }: { item: SavedIdea; actions: IdeaActions; onDelete: () => Promise<void>; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog idea-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span className="label">Saved run idea · {new Date(item.createdAt).toLocaleDateString()}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <IdeaCard idea={item.idea} actions={actions}>
          <span className="spacer" />
          {confirm ? (
            <>
              <span className="small error">
                <b>Delete this idea? This cannot be undone.</b>
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
        </IdeaCard>
      </div>
    </div>
  );
}
