/**
 * Small line icons and the icon-only button (T-038 follow-up): an action that is the same everywhere
 * (upload, remove, edit, copy) is a recognisable symbol with an accessible name and a tooltip, not a
 * text button. Icons are decorative (`aria-hidden`); the button carries the name.
 */
import type { ReactNode } from 'react';

export type IconName =
  'upload' | 'camera' | 'trash' | 'pencil' | 'copy' | 'download' | 'open' | 'changes' | 'restore';

const PATHS: Record<IconName, ReactNode> = {
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 20h16" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6m4-6v6" />,
  pencil: <path d="m4 20 1-4L16 5l3 3L8 19zM14 7l3 3" />,
  changes: <path d="M5 7h14M5 12h14M5 17h9" />,
  restore: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5M12 8v5l3 2" />,
  download: <path d="M12 4v12m-5-5 5 5 5-5M4 20h16" />,
  open: <path d="M14 4h6v6m0-6-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
  primary = false,
  expanded,
}: {
  icon: IconName;
  /** The accessible name and the tooltip. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  /** For a button that shows or hides something (sets `aria-expanded`). */
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button${danger ? ' icon-button--danger' : ''}${primary ? ' icon-button--primary' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A link shown as an icon (open a web link, download a file); `label` is its name and tooltip. */
export function IconLink({
  icon,
  label,
  href,
  newTab = false,
}: {
  icon: IconName;
  label: string;
  href: string;
  newTab?: boolean;
}) {
  return (
    <a
      className="icon-button"
      href={href}
      aria-label={label}
      title={label}
      {...(newTab ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      <Icon name={icon} />
    </a>
  );
}
