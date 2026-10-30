import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  can,
  capabilitiesOf,
  hasFeedingHome,
  isRestricted,
  type Capability,
} from './permissions';
import type { UserRole } from './types';

// docs/08 §2.2, cell by cell: admin, member, feeder, guest.
const TABLE: Record<Capability, [boolean, boolean, boolean, boolean]> = {
  'lines.read_overview': [true, true, true, true],
  'lines.read_full': [true, true, false, false],
  'lines.write': [true, true, false, false],
  'lines.export': [true, true, false, false],
  'attachments.read_files': [true, true, false, false],
  'attachments.read_refs': [true, true, true, true],
  'activity.read': [true, true, false, false],
  'chat.read': [true, true, false, false],
  'chat.write': [true, true, false, false],
  'users.list': [true, true, true, false],
  'feeding.read': [true, true, true, false],
  'feeding.write': [true, true, true, false],
  'feeding.export': [true, true, true, false],
  'admin.*': [true, false, false, false],
};
const ROLES: UserRole[] = ['admin', 'member', 'feeder', 'guest'];

describe('capability table', () => {
  it('lists every capability exactly once', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...CAPABILITIES].sort());
  });

  for (const capability of CAPABILITIES) {
    it(`${capability} matches the spec for every role`, () => {
      ROLES.forEach((role, index) => {
        expect(can(role, capability), `${role} ${capability}`).toBe(TABLE[capability][index]);
      });
    });
  }

  it('capabilitiesOf keeps table order', () => {
    expect(capabilitiesOf('guest')).toEqual(['lines.read_overview', 'attachments.read_refs']);
    expect(capabilitiesOf('admin')).toEqual([...CAPABILITIES]);
  });

  it('isRestricted is true for Feeders and Guests only', () => {
    expect(ROLES.filter(isRestricted)).toEqual(['feeder', 'guest']);
  });

  it('hasFeedingHome is true for Feeders only', () => {
    expect(ROLES.filter(hasFeedingHome)).toEqual(['feeder']);
  });

  it('Guests are never assignable', () => {
    expect(ASSIGNABLE_ROLES).toEqual(['admin', 'member', 'feeder']);
  });
});
