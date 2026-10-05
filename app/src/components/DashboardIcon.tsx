/**
 * Small line icons beside the Dashboard's counter labels and panel headings, so each box can be
 * recognised at a glance (owner request, 2026-10). They only accompany the text, never replace it:
 * every icon is `aria-hidden`, and the label next to it stays the accessible name.
 *
 * One concept, one icon: a counter and the panel it links to (Unread messages, Open requests) use
 * the same one. Drawn here as inline SVG in `currentColor` rather than emoji or an icon package, so
 * they look the same on every device, need no network or dependency, and follow the text colour.
 * The colour comes from the tone: the status colours already used by the status badges for line
 * states, the link blue for everything else.
 */
export type DashboardIconName =
  | 'activeLines'
  | 'closedLines'
  | 'cryopreserved'
  | 'unreadMessages'
  | 'openRequests'
  | 'upcomingBreeding'
  | 'currentlyBreeding'
  | 'recentActivity'
  | 'labChat';

type Tone = 'current' | 'breeding' | 'closed' | 'brand';

const ICONS: Record<DashboardIconName, { tone: Tone; shapes: readonly string[] }> = {
  // A fish, facing left.
  activeLines: {
    tone: 'current',
    shapes: ['M3 12c2.5-4 6.5-6 11-4l7-3v14l-7-3c-4.5 2-8.5 0-11-4z', 'M8 11.5h.01'],
  },
  // An archive box.
  closedLines: {
    tone: 'closed',
    shapes: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
  },
  // A snowflake.
  cryopreserved: {
    tone: 'brand',
    shapes: [
      'M12 2v20',
      'M3.3 7l17.4 10',
      'M3.3 17l17.4-10',
      'M9 3.5l3 2.5 3-2.5',
      'M9 20.5l3-2.5 3 2.5',
    ],
  },
  // An envelope.
  unreadMessages: {
    tone: 'brand',
    shapes: ['M3 5h18v14H3z', 'm3 7 9 6 9-6'],
  },
  // A flag: something someone asked for and is waiting on.
  openRequests: {
    tone: 'brand',
    shapes: ['M5 21V4', 'M5 4h12l-2.5 4.5L17 13H5'],
  },
  // A calendar with a mark on a coming day.
  upcomingBreeding: {
    tone: 'breeding',
    shapes: ['M3 5h18v16H3z', 'M3 10h18', 'M8 3v4', 'M16 3v4', 'M14 14h3v3h-3z'],
  },
  // A heart: a pair set up for breeding.
  currentlyBreeding: {
    tone: 'breeding',
    shapes: [
      'M12 20s-7.5-4.6-9-9.2C2 7.6 4.2 5 7 5c2 0 3.6 1.2 5 3 1.4-1.8 3-3 5-3 2.8 0 5 2.6 4 5.8-1.5 4.6-9 9.2-9 9.2z',
    ],
  },
  // A clock with a back arrow: what happened lately.
  recentActivity: {
    tone: 'brand',
    shapes: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  },
  // Two speech bubbles.
  labChat: {
    tone: 'brand',
    shapes: [
      'M14 9a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1v3l3-3h4a2 2 0 0 0 2-2z',
      'M10 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-3-3h-2',
    ],
  },
};

export function DashboardIcon({ name }: { name: DashboardIconName }) {
  const icon = ICONS[name];
  return (
    <svg
      className={`dashboard-icon dashboard-icon--${icon.tone}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {icon.shapes.map((shape) => (
        <path key={shape} d={shape} />
      ))}
    </svg>
  );
}
