import { describe, expect, it } from 'vitest';
import { menuItems } from './ChangeActivityMenu';

const reasons = (status: 'Current' | 'Breeding' | 'Closed', canEdit = true) =>
  Object.fromEntries(menuItems(status, canEdit).map((item) => [item.label, item.reason !== null]));

describe('menuItems', () => {
  it('enables the right actions per status (BR-1)', () => {
    expect(reasons('Current')).toMatchObject({
      'Start Breeding': false,
      'Update Genotyping Record': false,
      'Close This Line': false,
      'Reopen This Line': true,
      'Edit Details': false,
    });
    expect(reasons('Breeding')['Start Breeding']).toBe(true);
    expect(reasons('Breeding')['Close This Line']).toBe(false);
    expect(reasons('Closed')).toMatchObject({
      'Start Breeding': false,
      'Close This Line': true,
      'Reopen This Line': false,
    });
  });

  it('disables every data action for a Guest, with a reason', () => {
    for (const item of menuItems('Current', false)) expect(item.reason).not.toBeNull();
  });
});
