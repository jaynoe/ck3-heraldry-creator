import { useEffect, useRef, useState } from 'react';
import { resolveColor, type Rgb } from '../../../core/coa/colors.ts';
import type { ColorValue } from '../../../core/coa/model.ts';
import { useApp } from '../../context.ts';
import { Icon } from '../Icon.tsx';

const toHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): ColorValue => ({
  kind: 'rgb',
  value: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb,
});

/** Missing emblem colours render as red, missing field colours as grey (see core/render/render.ts). */
export type MissingColor = 'red' | 'grey';

export function colorLabel(c: ColorValue | undefined, missing: MissingColor = 'red'): string {
  if (!c) return `default (${missing})`;
  if (c.kind === 'named') return c.name;
  if (c.kind === 'ref') return `= field colour ${c.slot}`;
  return toHex(c.value);
}

/** Colour trigger that opens the designer palette, plus a free colour input. */
export function ColorPicker({
  value,
  onChange,
  label,
  missing = 'red',
}: {
  value: ColorValue | undefined;
  onChange: (c: ColorValue) => void;
  label: string;
  missing?: MissingColor;
}) {
  const { session } = useApp();
  const named = session.catalog.namedColors;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const rgb = (value ? resolveColor(value, { named }) : missing === 'red' ? resolveColor({ kind: 'named', name: 'red' }, { named }) : undefined) ?? [128, 128, 128];

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="color-picker" ref={root}>
      <button className="trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="swatch swatch-lg" style={{ background: toHex(rgb) }} />
        <span>
          {label}: {colorLabel(value, missing)}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="palette">
          <span className="label">{label}</span>
          <div className="palette-grid">
            {session.catalog.designerColors.map((name) => {
              const c = resolveColor({ kind: 'named', name }, { named });
              return (
                <button
                  key={name}
                  className="swatch"
                  title={name}
                  style={{ background: c ? toHex(c) : '#888' }}
                  data-active={value?.kind === 'named' && value.name === name ? true : undefined}
                  onClick={() => {
                    onChange({ kind: 'named', name });
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
          <div className="row">
            <span className="mono muted">{colorLabel(value, missing)}</span>
            <span className="spacer" />
            <label className="custom">
              Custom…
              <input type="color" value={toHex(rgb)} onChange={(e) => onChange(fromHex(e.target.value))} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
