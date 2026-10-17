import { useMemo, useState } from 'react';
import { ActionButton } from './ActionButton.tsx';
import { serializeCoa } from '../../core/coa/serialize.ts';
import { copyText } from '../browser.ts';
import { useApp } from '../context.ts';
import { CoaPreview } from './CoaPreview.tsx';
import { frameFor } from '../../core/render/frame.ts';
import type { EditorDoc } from './editor/doc.ts';
import { Icon } from './Icon.tsx';

const MAX_SHOWN = 48;

export function HousesView({ onCadet, onEdit }: { onCadet: (key: string) => void; onEdit: (doc: EditorDoc) => void }) {
  const { session } = useApp();
  const { catalog } = session;
  const [query, setQuery] = useState('');

  const withArms = useMemo(() => [...catalog.dynasties.values()].filter((d) => catalog.coas.has(d.key)), [catalog]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [];
    return withArms.filter((d) => d.name.toLowerCase().includes(q) || d.group.includes(q) || d.mottos.some((m) => m.toLowerCase().includes(q)));
  }, [withArms, q]);

  return (
    <div className="page">
      <h1 className="title">AGOT houses</h1>
      <span className="input-icon search-large">
        <Icon name="search" size={20} />
        <input
          className="clearable"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search houses by name, region (north, reach, dorne …) or words"
          autoFocus
        />
        {query && (
          <button className="clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon name="close" size={18} />
          </button>
        )}
      </span>

      {q.length < 2 ? (
        <div className="empty">
          <Icon name="keep" size={32} />
          <p>Type at least 2 letters. {withArms.length.toLocaleString('en')} houses from this playset are searchable.</p>
        </div>
      ) : matches.length === 0 ? (
        <div className="empty">
          <Icon name="search" size={32} />
          <p>No houses found.</p>
        </div>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: -8 }}>
            Showing {Math.min(matches.length, MAX_SHOWN)} of {matches.length} houses matching “{query.trim()}”
          </p>
          <section className="cards3">
            {matches.slice(0, MAX_SHOWN).map((d) => {
              const coa = catalog.coas.get(d.key)!.coa;
              return (
                <article key={d.key} className="card house-card">
                  <CoaPreview coa={coa} size={128} shape={frameFor(catalog, { house: d.key })} />
                  <div className="meta">
                    <h3 className="name">{d.name}</h3>
                    <span className="small muted">{[d.group, d.culture].filter(Boolean).join(' · ')}</span>
                    {d.mottos[0] && <span className="words small">“{d.mottos[0]}”</span>}
                  </div>
                  <div className="row actions">
                    <ActionButton className="small" labels={{ idle: 'Copy', busy: 'Copying…', done: 'Copied' }} action={() => copyText(serializeCoa(coa, d.key))} />
                    <button className="secondary small" onClick={() => onCadet(d.key)}>
                      Cadet branch
                    </button>
                    <button className="ghost small" onClick={() => onEdit({ coa, name: `${d.name} (copy)`, words: d.mottos[0], region: d.group })}>
                      Edit copy
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
