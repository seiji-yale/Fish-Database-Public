/**
 * Small line icons and the icon-only button (T-038 follow-up): an action that is the same everywhere
 * (upload, remove, edit, copy) is a recognisable symbol with an accessible name and a tooltip, not a
 * text button. Icons are decorative (`aria-hidden`); the button carries the name.
 */
import type { ReactNode } from 'react';

export type IconName = 'upload' | 'camera' | 'trash' | 'pencil' | 'copy';

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
}: {
  icon: IconName;
  /** The accessible name and the tooltip. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button${danger ? ' icon-button--danger' : ''}${primary ? ' icon-button--primary' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
