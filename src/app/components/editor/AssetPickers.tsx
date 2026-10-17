import { useMemo, useState } from 'react';
import { buildEmblemIndex, searchEmblems, type EmblemDoc } from '../../../core/ai/search.ts';
import type { Catalog } from '../../../core/catalog/catalog.ts';
import type { CoatOfArms, ColorValue } from '../../../core/coa/model.ts';
import { useApp } from '../../context.ts';
import { CoaPreview } from '../CoaPreview.tsx';

const indexCache = new WeakMap<Catalog, EmblemDoc[]>();
function emblemIndex(catalog: Catalog) {
  let index = indexCache.get(catalog);
  if (!index) indexCache.set(catalog, (index = buildEmblemIndex(catalog)));
  return index;
}

const tile = (texture: string, colors: (ColorValue | undefined)[], field: ColorValue | undefined): CoatOfArms => ({
  pattern: 'pattern_solid.dds',
  colors: [field ?? { kind: 'rgb', value: [96, 104, 112] }],
  coloredEmblems: [{ texture, colors, instances: [{}] }],
  texturedEmblems: [],
  subs: [],
});

/** Hover tooltip for a tile: file name plus a meta line. Positioned next to the tile, outside any scroll clipping. */
function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; title: string; meta?: string }>();
  const bind = (title: string, meta?: string) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTip({ x: r.right + 8, y: r.top + 12, title, meta });
    },
    onPointerLeave: () => setTip(undefined),
  });
  const node = tip && (
    <div className="tooltip" style={{ left: Math.min(tip.x, window.innerWidth - 330), top: tip.y }}>
      <div className="mono">{tip.title}</div>
      {tip.meta && <div className="small muted">{tip.meta}</div>}
    </div>
  );
  return { bind, node, hide: () => setTip(undefined) };
}

/** Search emblems by keyword or browse a category; shows thumbnails in the layer's colours. */
export function EmblemPicker({
  colors,
  field,
  onPick,
}: {
  colors: (ColorValue | undefined)[];
  field: ColorValue | undefined;
  onPick: (texture: string) => void;
}) {
  const { session } = useApp();
  const index = emblemIndex(session.catalog);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const categories = useMemo(() => [...new Set(index.map((d) => d.category).filter((c): c is string => !!c))].sort(), [index]);
  const tooltip = useTooltip();

  const results = useMemo(() => {
    if (query.trim()) return searchEmblems(index, [query], 60).map((h) => h.doc);
    if (category) return index.filter((d) => d.category === category).slice(0, 120);
    return [];
  }, [index, query, category]);

  return (
    <div className="picker">
      <div className="picker-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emblems (wolf, tower, greyjoy …)" autoFocus />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">or pick a category…</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {(query.trim() || category) && (
        <p className="small muted">
          {results.length === 0
            ? 'No emblems found.'
            : `${results.length} ${results.length === 1 ? 'emblem matches' : 'emblems match'} ${query.trim() ? `“${query.trim()}”` : `the category “${category}”`}, rendered in this layer's colours`}
        </p>
      )}
      <div className="picker-grid" onScroll={tooltip.hide}>
        {results.map((d) => (
          <button
            key={d.name}
            className="picker-tile"
            {...tooltip.bind(d.name, [d.mod, d.usedBy.length ? `used by ${d.usedBy.slice(0, 5).join(', ')}` : ''].filter(Boolean).join(' · '))}
            onClick={() => {
              tooltip.hide();
              onPick(d.name);
            }}
          >
            <CoaPreview coa={tile(d.name, colors, field)} size={72} shape={null} />
          </button>
        ))}
      </div>
      {tooltip.node}
    </div>
  );
}

export function PatternPicker({ colors, onPick }: { colors: (ColorValue | undefined)[]; onPick: (pattern: string) => void }) {
  const { session } = useApp();
  const patterns = useMemo(() => [...session.catalog.assets.pattern.values()].filter((p) => p.visible), [session]);
  const tooltip = useTooltip();
  return (
    <div className="picker">
      <div className="picker-grid" onScroll={tooltip.hide}>
        {patterns.map((p) => (
          <button key={p.name} className="picker-tile" {...tooltip.bind(p.name)} onClick={() => (tooltip.hide(), onPick(p.name))}>
            <CoaPreview coa={{ pattern: p.name, colors, coloredEmblems: [], texturedEmblems: [], subs: [] }} size={56} shape={null} />
          </button>
        ))}
      </div>
      {tooltip.node}
    </div>
  );
}
