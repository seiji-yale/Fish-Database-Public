/**
 * "Change Activity ▾" (T-013, FR-ACT-01): the menu of everything that changes a line over time.
 * An item that does not apply stays visible but disabled, with the reason written under it (not
 * only in a tooltip, so it reads on a phone). Cryopreservation and ID method have their own forms
 * in T-015 / T-014; until then they stay disabled with a "coming soon" reason.
 */
import { useRef } from 'react';
import type { LineStatus } from '../lineDetailApi';
import { strings } from '../strings';

export type ActivityChoice =
  'start-breeding' | 'genotyping' | 'close' | 'reopen' | 'edit-details' | 'id-method' | 'cryo';

interface MenuItem {
  choice: ActivityChoice | null;
  label: string;
  /** Why the item is disabled, or null when it can be used. */
  reason: string | null;
}

export function menuItems(status: LineStatus, canEdit: boolean): MenuItem[] {
  const guest = canEdit ? null : strings.activityDisabledGuest;
  return [
    {
      choice: 'start-breeding',
      label: strings.activityStartBreeding,
      reason: guest ?? (status === 'Breeding' ? strings.activityDisabledBreedingActive : null),
    },
    { choice: 'genotyping', label: strings.activityGenotyping, reason: guest },
    {
      choice: 'close',
      label: strings.activityClose,
      reason: guest ?? (status === 'Closed' ? strings.activityDisabledAlreadyClosed : null),
    },
    {
      choice: 'reopen',
      label: strings.activityReopen,
      reason: guest ?? (status === 'Closed' ? null : strings.activityDisabledNotClosed),
    },
    { choice: 'cryo', label: strings.activityCryo, reason: guest },
    { choice: 'id-method', label: strings.activityIdMethod, reason: guest },
    { choice: 'edit-details', label: strings.activityEditDetails, reason: guest },
  ];
}

export function ChangeActivityMenu({
  status,
  canEdit,
  onChoose,
}: {
  status: LineStatus;
  canEdit: boolean;
  onChoose: (choice: ActivityChoice) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <details className="activity-menu" ref={details}>
      <summary className="button--primary">{`${strings.changeActivity} ${strings.dropdownIcon}`}</summary>
      <ul className="activity-menu__items">
        {menuItems(status, canEdit).map((item) => (
          <li key={item.label}>
            <button
              type="button"
              aria-disabled={item.reason === null ? undefined : true}
              title={item.reason ?? undefined}
              onClick={() => {
                if (item.reason !== null || item.choice === null) return;
                if (details.current !== null) details.current.open = false;
                onChoose(item.choice);
              }}
            >
              <span>{item.label}</span>
              {item.reason === null ? null : (
                <small className="activity-menu__reason">{item.reason}</small>
              )}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
