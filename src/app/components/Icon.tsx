// The UI icons from the design (24 × 24, one path in currentColor, no ids), inlined so they take the text colour.
const svgs = import.meta.glob<string>('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true });
const icons = new Map(Object.entries(svgs).map(([path, svg]) => [path.replace(/^.*\/(.*)\.svg$/, '$1'), svg]));

export type IconName =
  | 'arrow-down' | 'arrow-up' | 'bin' | 'check' | 'chevron-down' | 'close' | 'dividers' | 'duplicate'
  | 'error' | 'import' | 'keep' | 'key' | 'layers' | 'palette' | 'plus' | 'quill' | 'redo' | 'refresh'
  | 'scroll' | 'seal' | 'search' | 'shield' | 'undo' | 'warning';

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icons.get(name) ?? '' }}
    />
  );
}

/** A 270° ring in the current text colour. */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

/** Error line: icon plus text in the error colour. */
export function ErrorLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={className ? `error-line ${className}` : 'error-line'} role="alert">
      <Icon name="error" size={14} />
      <span>{children}</span>
    </p>
  );
}
