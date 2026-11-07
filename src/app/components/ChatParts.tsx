import { useEffect, useState, type ClipboardEventHandler, type ReactNode } from 'react';
import type { MaesterMessage } from '../../core/maester/maester.ts';
import { useApp } from '../context.ts';
import { Icon } from './Icon.tsx';

/** A message of an advisor's chat: the advisor on the left, the player on the right. */
export function ChatMessage({ message: m, speaker, avatar, lord }: { message: MaesterMessage; speaker: string; avatar: ReactNode; lord: ReactNode }) {
  const { platform } = useApp();
  const [shown, setShown] = useState<number>();
  return (
    <article className="maester-message" data-role={m.role}>
      {m.role === 'lord' ? lord : avatar}
      <div className="maester-bubble">
        <span className="label">{m.role === 'lord' ? 'You' : speaker}</span>
        {m.images && m.images.length > 0 && (
          <div className="maester-shots">
            {m.images.map((src, i) => (
              <button key={i} className="shot-open" title="Show larger" onClick={() => setShown(i)}>
                <img src={src} alt={`Attached screenshot ${i + 1}`} />
              </button>
            ))}
          </div>
        )}
        {shown !== undefined && m.images && <Lightbox images={m.images} start={shown} onClose={() => setShown(undefined)} />}
        {m.text && <p className="maester-text">{m.text}</p>}
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

/** The box to write in, below an advisor's chat. Enter sends, Shift+Enter starts a new line. */
export function ChatCompose({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder,
  attached,
  onPaste,
  tools,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  /** Something is attached, so the message can go without text. */
  attached?: boolean;
  onPaste?: ClipboardEventHandler;
  /** Extra buttons beside the box. */
  tools?: ReactNode;
}) {
  return (
    <div className="maester-compose">
      <textarea
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!busy && !disabled && (value.trim() || attached)) onSend();
          }
        }}
      />
      <div className="maester-compose-tools">
        {tools}
        <button className="primary" disabled={busy || disabled || (!value.trim() && !attached)} onClick={onSend} title="Enter sends, Shift+Enter starts a new line">
          {busy ? 'One moment…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/** Screenshots shown large over the app; Escape or a click beside the image closes it, arrow keys step through. */
export function Lightbox({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const many = images.length > 1;
  const step = (by: number) => setI((n) => (n + by + images.length) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="overlay lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" onClick={onClose}>
      <img src={images[i]} alt={`Screenshot ${i + 1} of ${images.length}`} onClick={(e) => e.stopPropagation()} />
      <button className="icon-btn lightbox-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
        <Icon name="close" size={20} />
      </button>
      {many && (
        <div className="lightbox-nav" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn prev" onClick={() => step(-1)} aria-label="Previous screenshot" title="Previous (←)">
            <Icon name="chevron-down" size={20} />
          </button>
          <span className="small">
            {i + 1} / {images.length}
          </span>
          <button className="icon-btn next" onClick={() => step(1)} aria-label="Next screenshot" title="Next (→)">
            <Icon name="chevron-down" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
