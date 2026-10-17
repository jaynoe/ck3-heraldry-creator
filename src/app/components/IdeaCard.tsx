import type { ReactNode } from 'react';
import { ideaToHouseIdea, ideaToText, type IdeaSnapshot } from '../../core/ai/inspire.ts';
import { frameFor } from '../../core/render/frame.ts';
import { copyText } from '../browser.ts';
import { useApp } from '../context.ts';
import { ActionButton } from './ActionButton.tsx';
import { CoaPreview } from './CoaPreview.tsx';
import type { EditorDoc } from './editor/doc.ts';
import { Icon } from './Icon.tsx';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** What "Create this house" hands to Generate. */
export interface HouseSeed {
  idea: string;
  /** Parent house of a cadet branch. */
  parent?: string;
  /** Name and words proposed by the idea; Generate offers them first. */
  name?: string;
  words?: string;
}

export function ideaSeed(idea: IdeaSnapshot): HouseSeed {
  return {
    idea: ideaToHouseIdea(idea),
    parent: idea.house.kind === 'cadet' ? idea.house.dynastyKey : undefined,
    name: idea.house.kind === 'existing' ? undefined : idea.house.name || undefined,
    words: idea.words || undefined,
  };
}

/** What an idea can lead to, shared by Inspiration and Collection. */
export interface IdeaActions {
  /** Open Generate with this idea. */
  onCreate: (seed: HouseSeed) => void;
  onEdit: (doc: EditorDoc) => void;
}

export function houseLine(idea: IdeaSnapshot): string {
  const h = idea.house;
  if (h.kind === 'existing') return `House ${h.dynastyName ?? h.name}`;
  if (h.kind === 'cadet') return `House ${h.name}, a cadet branch of ${h.dynastyName ?? h.parentName}`;
  return `House ${h.name} (new)`;
}

/** The house's arms, if the house exists in the loaded playset. */
export function useIdeaArms(idea: IdeaSnapshot) {
  const { session } = useApp();
  const key = idea.house.dynastyKey;
  const d = key ? session.catalog.dynasties.get(key) : undefined;
  const coa = d && session.catalog.coas.get(d.key)?.coa;
  return { dynasty: d, coa, frame: d ? frameFor(session.catalog, { house: d.key }) : undefined };
}

/** Full view of a run idea; `children` go into the action row. */
export function IdeaCard({ idea, n, actions, children }: { idea: IdeaSnapshot; n?: number; actions: IdeaActions; children?: ReactNode }) {
  const arms = useIdeaArms(idea);

  return (
    <article className="card idea-card">
      <div className="idea-head">
        {n !== undefined && <span className="numeral">{NUMERALS[n] ?? n + 1}</span>}
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <h2 className="heading">{idea.title}</h2>
          <IdeaMeta idea={idea} />
        </div>
      </div>

      <div className="idea-house">
        {arms.coa ? <CoaPreview coa={arms.coa} size={64} shape={arms.frame} /> : <div className="hatch" style={{ width: 64, height: 64 }} />}
        <div className="stack" style={{ gap: 2 }}>
          <b>{houseLine(idea)}</b>
          <span className="muted" style={{ fontSize: 13 }}>{idea.startNote}</span>
        </div>
      </div>

      <dl className="idea-text">
        <dt className="label">Canon</dt>
        <dd>
          {idea.canon}
          <CanonStatus idea={idea} />
        </dd>
        <dt className="label">The run</dt>
        <dd>{idea.concept}</dd>
        <dt className="label">Why it fits</dt>
        <dd>{idea.fit}</dd>
        {idea.rules.length > 0 && (
          <>
            <dt className="label">Game rules</dt>
            <dd>
              <ul className="idea-rules">
                {idea.rules.map((r) => (
                  <li key={r.name}>
                    <b>{r.name}</b>: {r.option}
                    <span className="muted"> – {r.why}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {(idea.sigil || idea.words) && (
          <>
            <dt className="label">Sigil &amp; words</dt>
            <dd>
              {idea.sigil}
              {idea.sigil && idea.words && ' · '}
              {idea.words && <span className="words small">“{idea.words}”</span>}
            </dd>
          </>
        )}
      </dl>

      {idea.catch && (
        <p className="idea-catch small">
          <Icon name="warning" size={14} />
          <span>{idea.catch}</span>
        </p>
      )}
      {idea.notes.map((note) => (
        <p key={note} className="idea-catch small faint">
          <Icon name="error" size={14} />
          <span>{note}</span>
        </p>
      ))}

      <div className="row">
        <IdeaMainAction idea={idea} actions={actions} />
        <ActionButton className="small" action={() => copyText(ideaToText(idea))} labels={{ idle: 'Copy', busy: 'Copying…', done: 'Copied' }} />
        {children}
      </div>
    </article>
  );
}

/** Whether the canon text was checked against A Wiki of Ice and Fire, with links to the articles. */
function CanonStatus({ idea }: { idea: IdeaSnapshot }) {
  const { platform } = useApp();
  const sources = idea.sources ?? [];
  const status =
    idea.canonCheck === 'checked'
      ? `Checked against A Wiki of Ice and Fire${idea.canonFix ? `: ${idea.canonFix}` : ', nothing to correct.'}`
      : idea.canonCheck === 'linked'
        ? 'From the AI’s own knowledge, not checked (Economy). Sources for reading up:'
        : idea.canonCheck === 'unreachable'
          ? 'Not checked: A Wiki of Ice and Fire could not be reached.'
          : idea.canonCheck === 'unchecked'
            ? 'From the AI’s own knowledge; no matching AWOIAF article was found.'
            : undefined;
  if (!status && !sources.length) return null;
  return (
    <span className="canon-status small">
      {status && (
        <span className={idea.canonCheck === 'checked' ? 'accent' : 'faint'}>
          {idea.canonCheck === 'checked' && <Icon name="check" size={12} />} {status}
        </span>
      )}
      {sources.length > 0 && (
        <span className="sources">
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              onClick={(e) => {
                e.preventDefault();
                platform.openUrl(s.url);
              }}
              title={s.url}
            >
              {s.title}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}

export function IdeaMeta({ idea }: { idea: IdeaSnapshot }) {
  return (
    <span className="small muted">
      {idea.bookmark ? (
        <>
          <b>{idea.bookmark.year}</b> · {idea.bookmark.name}
        </>
      ) : (
        'Free start date'
      )}
      {' · '}
      {idea.region} · <span className={`difficulty ${idea.difficulty}`}>{idea.difficulty}</span>
    </span>
  );
}

/** "Create this house" for new houses and cadet branches, "Open its arms" for existing houses. */
export function IdeaMainAction({ idea, actions }: { idea: IdeaSnapshot; actions: IdeaActions }) {
  const arms = useIdeaArms(idea);
  if (idea.house.kind === 'existing') {
    const d = arms.dynasty;
    return (
      <button
        className="primary small"
        disabled={!arms.coa}
        title={arms.coa ? undefined : 'This house is not in the loaded playset'}
        onClick={() => d && arms.coa && actions.onEdit({ coa: arms.coa, name: d.name, words: d.mottos[0], region: d.group })}
      >
        Open its arms in the editor
      </button>
    );
  }
  return (
    <button className="primary small" onClick={() => actions.onCreate(ideaSeed(idea))}>
      Create this house
    </button>
  );
}
