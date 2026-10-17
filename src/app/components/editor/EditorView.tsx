import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '../ActionButton.tsx';
import { LAYOUTS } from '../../../core/ai/layouts.ts';
import { moveItem, toEditable, withDepths } from '../../../core/coa/edit.ts';
import type { CoatOfArms, ColoredEmblem, ColorValue, EmblemInstance } from '../../../core/coa/model.ts';
import { serializeCoa } from '../../../core/coa/serialize.ts';
import { resolveInheritance } from '../../../core/render/render.ts';
import { newId } from '../../../core/library.ts';
import { copyText } from '../../browser.ts';
import { useApp } from '../../context.ts';
import { CoaPreview, useFrame } from '../CoaPreview.tsx';
import { EmblemPicker, PatternPicker } from './AssetPickers.tsx';
import { ColorPicker } from './ColorPicker.tsx';
import type { LlmProvider } from '../../../core/ai/provider.ts';
import type { EditorDoc } from './doc.ts';
import type { AiMode } from '../../../core/ai/mode.ts';
import { ImportPanel } from './ImportPanel.tsx';
import { RefinePanel } from './RefinePanel.tsx';
import { Icon } from '../Icon.tsx';
import { Section } from '../Section.tsx';

const PREVIEW = 384;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Undo history for the CoA; slider drags within 400 ms collapse into one step. */
function useHistory(initial: CoatOfArms) {
  const [state, setState] = useState({ past: [] as CoatOfArms[], present: initial, future: [] as CoatOfArms[] });
  const lastPush = useRef(0);
  const set = useCallback((update: (c: CoatOfArms) => CoatOfArms) => {
    setState((s) => {
      const next = update(s.present);
      const now = Date.now();
      const merge = now - lastPush.current < 400;
      lastPush.current = now;
      return { past: merge ? s.past : [...s.past.slice(-99), s.present], present: next, future: [] };
    });
  }, []);
  const undo = () => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past.at(-1)!, future: [s.present, ...s.future] } : s));
  const redo = () => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) } : s));
  const reset = (c: CoatOfArms) => setState({ past: [], present: c, future: [] });
  /** Replaces the CoA as one step of its own (never merged with a slider drag), so Undo brings it back. */
  const commit = (c: CoatOfArms) => {
    lastPush.current = 0;
    set(() => c);
  };
  return { coa: state.present, set, commit, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

export function EditorView({
  doc,
  provider,
  mode,
  onMode,
  onOpen,
  onClose,
}: {
  doc: EditorDoc;
  provider: LlmProvider | string;
  mode: AiMode;
  onMode: (m: AiMode) => void;
  onOpen: (doc: EditorDoc) => void;
  /** Closes the design; the editor goes back to its empty start. */
  onClose: () => void;
}) {
  const { platform, session, playset } = useApp();
  // Inherited parts (`parent = …`) are copied in, so the editor shows and exports the full design.
  const editable = (c: CoatOfArms) => toEditable(resolveInheritance(c, (k) => session.catalog.coas.get(k)?.coa));
  const history = useHistory(editable(doc.coa));
  const frame = useFrame({ parent: doc.parent, region: doc.region });
  // The design as it was opened, for "Reset".
  const original = useMemo(() => editable(doc.coa), [doc]);
  const { coa, set } = history;
  const [layerIdx, setLayerIdx] = useState(0);
  const [instIdx, setInstIdx] = useState(0);
  const [picker, setPicker] = useState<'pattern' | 'emblem' | 'new-emblem'>();
  const [showImport, setShowImport] = useState(false);
  const [open, setOpen] = useState({ refine: false, field: true, layers: true, layer: true });
  const section = (k: keyof typeof open) => ({ open: open[k], onToggle: (v: boolean) => setOpen((o) => ({ ...o, [k]: v })) });
  const [name, setName] = useState(doc.name);
  const [words, setWords] = useState(doc.words ?? '');
  const [libraryId, setLibraryId] = useState(doc.libraryId);
  const dragging = useRef(false);
  // Unsaved changes: anything that differs from the design as opened or last saved.
  const current = JSON.stringify({ coa, name, words });
  const [savedState, setSavedState] = useState(current);
  const dirty = current !== savedState;
  const [confirmClose, setConfirmClose] = useState(false);

  // Opening another design replaces the editor contents.
  useEffect(() => {
    history.reset(editable(doc.coa));
    setName(doc.name);
    setWords(doc.words ?? '');
    setLibraryId(doc.libraryId);
    setLayerIdx(0);
    setInstIdx(0);
    setPicker(undefined);
    setSavedState(JSON.stringify({ coa: editable(doc.coa), name: doc.name, words: doc.words ?? '' }));
    setConfirmClose(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'z' && !e.shiftKey) (e.preventDefault(), history.undo());
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) (e.preventDefault(), history.redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const layer: ColoredEmblem | undefined = coa.coloredEmblems[layerIdx];
  const inst: EmblemInstance | undefined = layer?.instances[instIdx];
  const colorCount = layer ? (session.catalog.assets.colored_emblem.get(layer.texture)?.colors ?? 3) : 0;

  const setLayer = (update: (l: ColoredEmblem) => ColoredEmblem) =>
    set((c) => ({ ...c, coloredEmblems: c.coloredEmblems.map((l, i) => (i === layerIdx ? update(l) : l)) }));
  const setInst = (update: (i: EmblemInstance) => EmblemInstance) =>
    setLayer((l) => ({ ...l, instances: l.instances.map((x, i) => (i === instIdx ? update(x) : x)) }));
  const setFieldColor = (i: number, c: ColorValue) =>
    set((x) => {
      const colors = [...x.colors];
      colors[i] = c;
      return { ...x, colors };
    });

  // --- Drag on the preview moves the selected instance; a click selects the emblem under the cursor.
  function pointToCoa(e: React.PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)] as const;
  }
  function onPointerDown(e: React.PointerEvent) {
    const [x, y] = pointToCoa(e);
    // Hit test front to back on the instances' boxes.
    for (let li = coa.coloredEmblems.length - 1; li >= 0; li--) {
      const ins = coa.coloredEmblems[li]!.instances;
      for (let ii = ins.length - 1; ii >= 0; ii--) {
        const [px, py] = ins[ii]!.position ?? [0.5, 0.5];
        const [sx, sy] = ins[ii]!.scale ?? [1, 1];
        if (Math.abs(x - px) <= Math.abs(sx) / 2 && Math.abs(y - py) <= Math.abs(sy) / 2 && Math.abs(sx) < 0.95) {
          setLayerIdx(li);
          setInstIdx(ii);
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
      }
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const [x, y] = pointToCoa(e);
    setInst((i) => ({ ...i, position: [round(x), round(y)] }));
  }

  // --- Layers
  function addLayer(texture: string) {
    set((c) => ({ ...c, coloredEmblems: [...c.coloredEmblems, { texture, colors: [{ kind: 'named', name: 'agot_white' }], instances: [{ position: [0.5, 0.5], scale: [0.7, 0.7] }] }] }));
    setLayerIdx(coa.coloredEmblems.length);
    setInstIdx(0);
    setPicker(undefined);
  }
  const moveLayer = (to: number) => {
    set((c) => ({ ...c, coloredEmblems: moveItem(c.coloredEmblems, layerIdx, to) }));
    setLayerIdx(clamp(to, 0, coa.coloredEmblems.length - 1));
  };
  const deleteLayer = () => {
    set((c) => ({ ...c, coloredEmblems: c.coloredEmblems.filter((_, i) => i !== layerIdx) }));
    setLayerIdx(Math.max(0, layerIdx - 1));
    setInstIdx(0);
  };

  // --- Output
  const exportScript = () => serializeCoa(withDepths(coa), `coa_${name.toLowerCase().replace(/\W+/g, '_') || 'custom'}`);
  async function save(asNew: boolean) {
    const id = asNew || !libraryId ? newId() : libraryId;
    await platform.library.save({
      id,
      name: name.trim() || 'Unnamed',
      words: words.trim() || undefined,
      idea: doc.idea,
      region: doc.region,
      parent: doc.parent,
      script: exportScript(),
      playset: playset.name,
      createdAt: asNew || !doc.createdAt ? new Date().toISOString() : doc.createdAt,
    });
    setLibraryId(id);
    setSavedState(current);
  }

  const scale = inst?.scale ?? [1, 1];
  const extras = [
    coa.texturedEmblems.length && `${coa.texturedEmblems.length} textured ${coa.texturedEmblems.length === 1 ? 'emblem' : 'emblems'}`,
    coa.subs.length && `${coa.subs.length} ${coa.subs.length === 1 ? 'sub-shield' : 'sub-shields'}`,
  ].filter(Boolean);
  const pos = inst?.position ?? [0.5, 0.5];
  const thumb = (l: ColoredEmblem): CoatOfArms => ({
    pattern: 'pattern_solid.dds',
    colors: [coa.colors[0] ?? { kind: 'rgb', value: [96, 104, 112] }],
    coloredEmblems: [{ texture: l.texture, colors: l.colors, instances: [{}] }],
    texturedEmblems: [],
    subs: [],
  });

  return (
    <div className="editor">
      <section className="editor-preview">
        <div
          className="preview-drag"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (dragging.current = false)}
        >
          <CoaPreview coa={coa} size={PREVIEW} fluid shape={frame} outside={0.25} />
          {inst && (
            <div
              className="selection"
              style={{
                left: `${(pos[0] - Math.abs(scale[0]) / 2) * 100}%`,
                top: `${(pos[1] - Math.abs(scale[1]) / 2) * 100}%`,
                width: `${Math.abs(scale[0]) * 100}%`,
                height: `${Math.abs(scale[1]) * 100}%`,
                transform: inst.rotation ? `rotate(${inst.rotation}deg)` : undefined,
              }}
            >
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <div className="row nowrap" style={{ gap: 4 }}>
          <button className="icon-btn" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Icon name="undo" size={20} />
          </button>
          <button className="icon-btn" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
            <Icon name="redo" size={20} />
          </button>
          <span className="small muted" style={{ marginLeft: 8 }}>
            Click an emblem to select it, drag to move it
          </span>
          <span className="spacer" />
          <button
            className="ghost small"
            disabled={JSON.stringify(coa) === JSON.stringify(original)}
            onClick={() => {
              history.commit(structuredClone(original));
              setLayerIdx(0);
              setInstIdx(0);
              setPicker(undefined);
            }}
            title="Back to the design as it was opened. Undo brings your changes back."
          >
            Reset
          </button>
        </div>
        <label className="field" style={{ marginTop: 8 }}>
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Words (optional)</span>
          <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="e.g. We Hold the Neck" />
        </label>
        <div className="stack" style={{ gap: 8, marginTop: 6 }}>
          <ActionButton
            className="primary block"
            action={() => save(false)}
            labels={{ idle: libraryId ? 'Save' : 'Save to Collection', busy: 'Saving…', done: 'Saved' }}
          />
          <ActionButton
            className="secondary block"
            labels={{ idle: 'Copy for game', busy: 'Copying…', done: 'Copied – paste it in the game' }}
            action={() => copyText(exportScript())}
          />
          <div className="row" style={{ gap: 8 }}>
            {libraryId && (
              <ActionButton className="ghost small" action={() => save(true)} labels={{ idle: 'Save as new', busy: 'Saving…', done: 'Saved as new' }} />
            )}
            <span className="spacer" />
            <ActionButton
              key="save-close"
              className="small"
              action={async () => {
                await save(false);
                onClose();
              }}
              labels={{ idle: 'Save and close', busy: 'Saving…', done: 'Saved' }}
            />
            {confirmClose ? (
              <>
                <button key="really-close" className="confirm small" onClick={onClose}>
                  Discard changes
                </button>
                <button key="keep" className="ghost small" onClick={() => setConfirmClose(false)}>
                  Keep editing
                </button>
              </>
            ) : (
              <button
                key="close"
                className="ghost small"
                onClick={() => (dirty ? setConfirmClose(true) : onClose())}
                title={dirty ? 'You have unsaved changes' : 'Close this design'}
              >
                Close
              </button>
            )}
          </div>
        </div>
        {extras.length > 0 && (
          <p className="small faint">This design also has {extras.join(' and ')}; {extras.length > 1 || /s$/.test(String(extras[0])) ? 'they are' : 'it is'} kept but cannot be edited here.</p>
        )}
      </section>

      <section className="editor-controls">
        <Section icon="import" title="Import from game…" open={showImport} onToggle={setShowImport}>
          <ImportPanel
            onOpen={(d) => {
              setShowImport(false);
              onOpen(d);
            }}
          />
        </Section>

        <Section icon="quill" title="Improve with AI" {...section('refine')}>
          <RefinePanel
            coa={withDepths(coa)}
            frame={frame}
            name={name}
            words={words}
            provider={provider}
            mode={mode}
            onMode={onMode}
            onApply={(c) => {
              set(() => toEditable(c));
              setLayerIdx(0);
              setInstIdx(0);
            }}
          />
        </Section>

        <Section icon="palette" title="Field" {...section('field')}>
          <div className="row" style={{ gap: 10 }}>
            <button className="trigger mono-label" onClick={() => setPicker(picker === 'pattern' ? undefined : 'pattern')} aria-expanded={picker === 'pattern'}>
              <CoaPreview coa={{ pattern: coa.pattern ?? 'pattern_solid.dds', colors: coa.colors, coloredEmblems: [], texturedEmblems: [], subs: [] }} size={28} shape={null} />
              <span>{coa.pattern ?? 'pattern_solid.dds'}</span>
              <Icon name="chevron-down" size={14} />
            </button>
            {[0, 1, 2].map((i) => (
              <ColorPicker key={i} label={`Colour ${i + 1}`} value={coa.colors[i]} missing="grey" onChange={(c) => setFieldColor(i, c)} />
            ))}
          </div>
          {picker === 'pattern' && (
            <PatternPicker
              colors={coa.colors}
              onPick={(p) => {
                set((c) => ({ ...c, pattern: p }));
                setPicker(undefined);
              }}
            />
          )}
        </Section>

        <Section
          icon="layers"
          title="Layers · back → front"
          {...section('layers')}
          actions={
            <button
              className="secondary small"
              onClick={() => {
                setOpen((o) => ({ ...o, layers: true }));
                setPicker(picker === 'new-emblem' ? undefined : 'new-emblem');
              }}
              style={picker === 'new-emblem' ? { borderColor: 'var(--text)' } : undefined}
            >
              + Add emblem
            </button>
          }
        >
          {coa.coloredEmblems.length > 0 ? (
            <ol className="layers">
              {coa.coloredEmblems.map((l, i) => (
                <li key={i}>
                  <button data-active={i === layerIdx || undefined} onClick={() => (setLayerIdx(i), setInstIdx(0))}>
                    <span className="n">{i + 1}.</span>
                    <CoaPreview coa={thumb(l)} size={30} shape={null} />
                    <span className="mono">
                      {l.texture.replace(/\.dds$/, '')}
                      {l.instances.length > 1 ? ` ×${l.instances.length}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="small muted">No emblems yet. Add one with “+ Add emblem”.</p>
          )}
          {picker === 'new-emblem' && <EmblemPicker colors={[{ kind: 'named', name: 'agot_white' }]} field={coa.colors[0]} onPick={addLayer} />}
        </Section>

        {layer && (
          <Section icon="shield" title={`Layer ${layerIdx + 1} · ${layer.texture.replace(/\.dds$/, '')}`} {...section('layer')}>
            <div className="row">
              <button className="secondary small" onClick={() => moveLayer(layerIdx - 1)} disabled={layerIdx === 0} title="Move back">
                <Icon name="arrow-up" size={14} /> Back
              </button>
              <button className="secondary small" onClick={() => moveLayer(layerIdx + 1)} disabled={layerIdx === coa.coloredEmblems.length - 1} title="Move to front">
                <Icon name="arrow-down" size={14} /> Front
              </button>
              <button
                className="secondary small"
                onClick={() => {
                  set((c) => ({ ...c, coloredEmblems: [...c.coloredEmblems.slice(0, layerIdx + 1), structuredClone(layer), ...c.coloredEmblems.slice(layerIdx + 1)] }));
                  setLayerIdx(layerIdx + 1);
                }}
              >
                Duplicate
              </button>
              <span className="spacer" />
              <button className="danger small" onClick={deleteLayer} title="Undo brings it back">
                Delete
              </button>
            </div>
            <div className="kv">
              <span className="label">Emblem</span>
              <span className="mono">{layer.texture}</span>
              <button className="link small" style={{ marginLeft: -12 }} onClick={() => setPicker(picker === 'emblem' ? undefined : 'emblem')}>
                {picker === 'emblem' ? 'Close' : 'Change'}
              </button>
            </div>
            {picker === 'emblem' && (
              <EmblemPicker
                colors={layer.colors}
                field={coa.colors[0]}
                onPick={(t) => {
                  setLayer((l) => ({ ...l, texture: t }));
                  setPicker(undefined);
                }}
              />
            )}
            <div className="row" style={{ gap: 10 }}>
              {Array.from({ length: Math.max(1, colorCount) }, (_, i) => (
                <ColorPicker
                  key={i}
                  label={i === 0 ? 'Main' : `Detail ${i}`}
                  value={layer.colors[i]}
                  onChange={(c) =>
                    setLayer((l) => {
                      const colors = [...l.colors];
                      colors[i] = c;
                      return { ...l, colors };
                    })
                  }
                />
              ))}
            </div>

            <span className="label" style={{ marginTop: 4 }}>
              Placement
            </span>
            <div className="row" style={{ gap: 10, marginTop: -6 }}>
              <select
                style={{ width: 220 }}
                value=""
                onChange={(e) => {
                  const preset = LAYOUTS[e.target.value];
                  if (!preset) return;
                  setLayer((l) => ({ ...l, instances: structuredClone(preset.instances) }));
                  setInstIdx(0);
                }}
              >
                <option value="">Apply a layout…</option>
                {Object.entries(LAYOUTS).map(([k, l]) => (
                  <option key={k} value={k} title={l.description}>
                    {k.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              {layer.instances.map((_, i) => (
                <button key={i} className="chip" data-active={i === instIdx || undefined} onClick={() => setInstIdx(i)}>
                  #{i + 1}
                </button>
              ))}
              <button
                className="ghost small"
                onClick={() => {
                  setLayer((l) => ({ ...l, instances: [...l.instances, { ...structuredClone(inst ?? {}), position: [0.5, 0.5] }] }));
                  setInstIdx(layer.instances.length);
                }}
              >
                + Copy
              </button>
              {layer.instances.length > 1 && (
                <button
                  className="ghost small"
                  onClick={() => {
                    setLayer((l) => ({ ...l, instances: l.instances.filter((_, i) => i !== instIdx) }));
                    setInstIdx(Math.max(0, instIdx - 1));
                  }}
                >
                  − Remove #{instIdx + 1}
                </button>
              )}
            </div>

            {inst && (
              <div className="sliders">
                <Slider label="X" min={0} max={1} step={0.005} value={inst.position?.[0] ?? 0.5} onChange={(v) => setInst((i) => ({ ...i, position: [v, i.position?.[1] ?? 0.5] }))} />
                <Slider label="Y" min={0} max={1} step={0.005} value={inst.position?.[1] ?? 0.5} onChange={(v) => setInst((i) => ({ ...i, position: [i.position?.[0] ?? 0.5, v] }))} />
                <Slider
                  label="Size"
                  min={0.05}
                  max={1.5}
                  step={0.01}
                  value={Math.abs(scale[1])}
                  onChange={(v) => setInst((i) => ({ ...i, scale: [Math.sign(scale[0]) * v * (Math.abs(scale[0]) / Math.abs(scale[1]) || 1), Math.sign(scale[1]) * v] }))}
                />
                <Slider
                  label="Width"
                  min={0.05}
                  max={1.5}
                  step={0.01}
                  value={Math.abs(scale[0])}
                  onChange={(v) => setInst((i) => ({ ...i, scale: [Math.sign(scale[0]) * v, scale[1]] }))}
                />
                <Slider label="Rotation" min={-180} max={180} step={1} value={inst.rotation ?? 0} onChange={(v) => setInst((i) => ({ ...i, rotation: v || undefined }))} />
                <div className="row" style={{ gap: 28, marginTop: 8 }}>
                  <label className="check">
                    <input type="checkbox" checked={scale[0] < 0} onChange={() => setInst((i) => ({ ...i, scale: [-scale[0], scale[1]] }))} />
                    Mirror (face the other way)
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={scale[1] < 0} onChange={() => setInst((i) => ({ ...i, scale: [scale[0], -scale[1]] }))} />
                    Upside down
                  </label>
                </div>
              </div>
            )}
          </Section>
        )}
      </section>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(round(Number(e.target.value)))}
      />
      <NumberField value={value} min={min} max={max} digits={step >= 1 ? 0 : 2} unit={step >= 1 ? '°' : ''} onChange={onChange} />
    </label>
  );
}

/** Text field with fixed formatting ("0.50", "-3°"); accepts a comma as decimal separator while typing. */
function NumberField({ value, min, max, digits, unit, onChange }: { value: number; min: number; max: number; digits: number; unit: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string>();
  return (
    <input
      inputMode="decimal"
      value={draft ?? `${value.toFixed(digits)}${unit}`}
      onFocus={(e) => (setDraft(value.toFixed(digits)), requestAnimationFrame(() => e.target.select()))}
      onBlur={() => setDraft(undefined)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value.replace(',', '.').replace(unit, ''));
        if (e.target.value.trim() && Number.isFinite(v)) onChange(round(clamp(v, min, max)));
      }}
    />
  );
}
