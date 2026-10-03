import { describe, expect, it } from 'vitest';
import {
  addEnumerationSchema,
  addUserSchema,
  adminMessages,
  nameTaken,
  inviteSchema,
  settingsSchema,
  updateEnumerationSchema,
  updateUserSchema,
  validateAdmin,
} from './admin';

const errors = <T>(result: ReturnType<typeof validateAdmin<T>>) => (result.ok ? {} : result.errors);

describe('users', () => {
  it('trims the name, defaults the role to Member, needs an initial password, refuses Guest', () => {
    expect(
      validateAdmin(addUserSchema, { name: ' Test User ', initialPassword: 'first-pass' }),
    ).toEqual({
      ok: true,
      value: { name: 'Test User', role: 'member', initialPassword: 'first-pass' },
    });
    expect(
      validateAdmin(addUserSchema, { name: 'Boss', role: 'admin', initialPassword: 'first-pass' })
        .ok,
    ).toBe(true);
    expect(
      errors(validateAdmin(addUserSchema, { name: '', role: 'guest', initialPassword: 'short' })),
    ).toEqual({
      name: adminMessages.nameRequired,
      role: adminMessages.roleInvalid,
      initialPassword: adminMessages.passwordTooShort,
    });
    expect(
      errors(validateAdmin(addUserSchema, { name: 'x'.repeat(41), initialPassword: 'first-pass' })),
    ).toEqual({
      name: adminMessages.nameTooLong,
    });
    expect(errors(validateAdmin(addUserSchema, 5))).toHaveProperty('form');
  });

  it('an update may change any of name, role and active state', () => {
    expect(validateAdmin(updateUserSchema, { isActive: false })).toEqual({
      ok: true,
      value: { isActive: false },
    });
    expect(validateAdmin(updateUserSchema, { role: 'admin' }).ok).toBe(true);
    expect(errors(validateAdmin(updateUserSchema, { role: 'guest' }))).toHaveProperty('role');
  });

  it('compares names without case, and lets a rename keep its own name', () => {
    expect(nameTaken(['Bob', 'Carol'], ' bob ')).toBe(true);
    expect(nameTaken(['Bob'], 'Alice')).toBe(false);
    expect(nameTaken(['Bob'], 'BOB', 'bob')).toBe(false);
    expect(adminMessages.nameTaken('Bob')).toContain('Bob');
  });
});

describe('lists', () => {
  it('needs a known kind and a value', () => {
    expect(
      validateAdmin(addEnumerationSchema, { kind: 'cryo_place', value: ' Freezer 9 ' }),
    ).toEqual({
      ok: true,
      value: { kind: 'cryo_place', value: 'Freezer 9' },
    });
    expect(
      Object.keys(errors(validateAdmin(addEnumerationSchema, { kind: 'nope', value: '' }))),
    ).toEqual(['kind', 'value']);
    expect(errors(validateAdmin(updateEnumerationSchema, { value: 'x'.repeat(81) }))).toEqual({
      value: adminMessages.valueTooLong,
    });
    expect(validateAdmin(updateEnumerationSchema, { isActive: false }).ok).toBe(true);
    expect(adminMessages.valueTaken('GFP')).toContain('GFP');
  });
});

describe('settings', () => {
  it('reads numbers typed as text and enforces the ranges', () => {
    expect(
      validateAdmin(settingsSchema, {
        databaseName: '  Lab Fish DB  ',
        upcomingBreedingMonths: '10',
        defaultAnnealingC: '58.5',
        defaultCycles: 30,
      }),
    ).toEqual({
      ok: true,
      value: {
        databaseName: 'Lab Fish DB',
        upcomingBreedingMonths: 10,
        defaultAnnealingC: 58.5,
        defaultCycles: 30,
      },
    });
    expect(
      errors(
        validateAdmin(settingsSchema, {
          upcomingBreedingMonths: 0,
          defaultAnnealingC: 99,
          defaultCycles: 1.5,
        }),
      ),
    ).toEqual({
      upcomingBreedingMonths: adminMessages.thresholdInvalid,
      defaultAnnealingC: adminMessages.annealingInvalid,
      defaultCycles: adminMessages.cyclesInvalid,
    });
    expect(
      errors(validateAdmin(settingsSchema, { upcomingBreedingMonths: 'soon' })),
    ).toHaveProperty('upcomingBreedingMonths');
    expect(errors(validateAdmin(settingsSchema, { defaultAnnealingC: 'hot' }))).toHaveProperty(
      'defaultAnnealingC',
    );
    expect(errors(validateAdmin(settingsSchema, { databaseName: '  ' }))).toEqual({
      databaseName: adminMessages.databaseNameRequired,
    });
    expect(errors(validateAdmin(settingsSchema, { databaseName: 'x'.repeat(81) }))).toEqual({
      databaseName: adminMessages.databaseNameTooLong,
    });
  });
});

describe('invites', () => {
  it('a new invite needs an initial password of 8+ characters', () => {
    expect(validateAdmin(inviteSchema, { initialPassword: 'longenough' }).ok).toBe(true);
    expect(errors(validateAdmin(inviteSchema, { initialPassword: 'short' }))).toEqual({
      initialPassword: adminMessages.passwordTooShort,
    });
    expect(errors(validateAdmin(inviteSchema, {}))).toHaveProperty('initialPassword');
  });
});
