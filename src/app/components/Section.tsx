import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

/** A collapsible panel: icon, uppercase title, optional actions on the right and a chevron. */
export function Section({
  icon,
  title,
  actions,
  open: controlled,
  onToggle,
  defaultOpen = false,
  children,
  className,
}: {
  icon: IconName;
  title: ReactNode;
  actions?: ReactNode;
  /** Controlled open state; leave out to let the section manage it. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const toggle = () => {
    setOwn(!open);
    onToggle?.(!open);
  };
  return (
    <section className={className ? `section ${className}` : 'section'} data-open={open || undefined}>
      <div className="section-head">
        <button className="toggle" onClick={toggle} aria-expanded={open}>
          <Icon name={icon} size={16} />
          <span>{title}</span>
        </button>
        {actions}
        <button className="icon-btn chev-btn" onClick={toggle} aria-label={open ? 'Collapse' : 'Expand'} tabIndex={-1}>
          <Icon name="chevron-down" size={16} className="chev" />
        </button>
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
