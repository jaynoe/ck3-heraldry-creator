import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoatOfArms } from '../../core/coa/model.ts';
import type { Catalog } from '../../core/catalog/catalog.ts';
import type { RgbaImage } from '../../core/dds/dds.ts';
import { applyFrame, applyMask, frameFor, frameOpening, placeOn } from '../../core/render/frame.ts';
import { renderCoa } from '../../core/render/render.ts';
import { encodePngBrowser } from '../browser.ts';
import { useApp } from '../context.ts';
import { Icon } from './Icon.tsx';

// Renders run one at a time so long lists don't freeze the page all at once.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Shows a rendered CoA as an <img> backed by a PNG blob. (A <canvas> would be simpler, but WebKitGTK,
 * Tauri's engine on Linux, drops the contents of canvases inside hidden tabs.)
 */
export function CoaPreview({
  coa,
  size = 192,
  fluid,
  className,
  shape,
  outside = 0,
}: {
  coa: CoatOfArms | undefined;
  /** Render size in px; also the display size unless `fluid`. */
  size?: number;
  /** Fill the parent's width (square) instead of showing at `size`. */
  fluid?: boolean;
  className?: string;
  /** House frame whose mask gives the shield shape (see useFrame); null keeps the square, e.g. for emblem tiles. */
  shape?: string | null;
  /** Opacity kept outside the shape (the editor shows cut-off parts faintly). */
  outside?: number;
}) {
  const { ctx, session } = useApp();
  const fallback = useFrame();
  const frame = shape === null ? undefined : (shape ?? fallback);
  const [url, setUrl] = useState<string>();
  const shown = useRef<string | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  /** Shaped but without frame art: a thin outline keeps dark arms visible. */
  const [outlined, setOutlined] = useState(false);
  // Re-render only when the content changes, not on every new object with equal content.
  const key = coa ? JSON.stringify(coa) : '';

  useEffect(() => {
    if (!coa) return;
    let cancelled = false;
    queue = queue
      .then(async () => {
        if (cancelled) return;
        const mask = frame ? await session.frameMask(frame) : undefined;
        // The game's frame goes on top, except in the editor, where it would hide the edge of the field
        // (and drag positions must map 1:1 to the preview).
        const art = frame && !outside ? await session.frameArt(frame) : undefined;
        let pic: RgbaImage;
        let warnings: string[];
        if (mask && art) {
          // Like in game: the arms are scaled into the frame's opening, the frame covers only the edge.
          const o = openingOf(mask, art);
          const inner = Math.max(1, Math.round(o.size * size));
          const r = await renderCoa(coa, ctx, inner);
          warnings = r.warnings;
          pic = applyFrame(applyMask(placeOn(r.image, size, Math.round(o.x * size), Math.round(o.y * size)), mask), art);
        } else {
          const r = await renderCoa(coa, ctx, size);
          warnings = r.warnings;
          pic = mask ? applyMask(r.image, mask, outside) : r.image;
        }
        if (cancelled) return;
        const png = await encodePngBrowser(pic);
        if (cancelled) return;
        // Free the previous image only once the new one replaces it.
        const next = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
        if (shown.current) URL.revokeObjectURL(shown.current);
        shown.current = next;
        setUrl(next);
        setWarnings(warnings);
        setOutlined(!!mask && !art && !outside);
      })
      // A failed render must not stall every later preview in the queue.
      .catch((e: unknown) => setWarnings([`Render failed: ${String(e)}`]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `coa`
  }, [key, ctx, size, frame, outside]);

  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );

  const warn = warnings.length > 0;
  // Until the first render is done the frame shows the woodcut hatching.
  return (
    <span
      className={['coa', fluid && 'fluid', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      title={warn ? warnings.join('\n') : undefined}
      data-warn={warn || undefined}
      data-loaded={url ? true : undefined}
      data-shaped={outlined || undefined}
    >
      {url && <img src={url} alt="" draggable={false} />}
      {warn && size >= 96 && (
        <span className="badge">
          <Icon name="warning" size={14} />
        </span>
      )}
    </span>
  );
}

const defaults = new WeakMap<Catalog, string | undefined>();
const openings = new WeakMap<RgbaImage, ReturnType<typeof frameOpening>>();
const openingOf = (mask: RgbaImage, art: RgbaImage) => {
  let o = openings.get(art);
  if (!o) openings.set(art, (o = frameOpening(mask, art)));
  return o;
};

/** The shield shape for a design: its own house, the parent of a cadet branch, or its region. */
export function useFrame(o: { house?: string; parent?: string; region?: string } = {}): string | undefined {
  const { session } = useApp();
  const { catalog } = session;
  return useMemo(() => {
    if (!o.house && !o.parent && !o.region) {
      if (!defaults.has(catalog)) defaults.set(catalog, frameFor(catalog));
      return defaults.get(catalog);
    }
    return frameFor(catalog, o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, o.house, o.parent, o.region]);
}
