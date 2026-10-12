import { describe, expect, it } from 'vitest';

import {
  initialsFor,
  normalizeUsername,
  profileSchema,
  suggestUsername,
  validateFullName,
  validateUsername,
} from './profile';

describe('initialsFor', () => {
  it('takes the first and last initial', () => {
    expect(initialsFor('Ada Eze')).toBe('AE');
    expect(initialsFor('Chidi Emeka Okafor')).toBe('CO');
    expect(initialsFor('  mom ')).toBe('M');
  });

  it('is a question mark for nothing', () => {
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('username', () => {
  it('normalises what a person types', () => {
    expect(normalizeUsername('  @Ada Eze ')).toBe('adaeze');
  });

  it('accepts lowercase letters, digits, dots and underscores', () => {
    expect(validateUsername('ada.eze_1')).toBeNull();
  });

  it('rejects too short, too long and disallowed characters', () => {
    expect(validateUsername('ab')).toMatch(/at least 3/);
    expect(validateUsername('a'.repeat(21))).toMatch(/at most 20/);
    expect(validateUsername('ada-eze')).toMatch(/lowercase letters/);
  });

  it('suggests one from a full name', () => {
    expect(suggestUsername('Ada Eze')).toBe('ada.eze');
    expect(suggestUsername('José Núñez')).toBe('jose.nunez');
    expect(suggestUsername('Li')).toBe('');
    expect(suggestUsername('A very long name that goes on and on')).toHaveLength(20);
  });

  it('every suggestion passes validation', () => {
    for (const name of ['Ada Eze', 'José Núñez', 'Chidi Emeka Okafor']) {
      expect(validateUsername(suggestUsername(name))).toBeNull();
    }
  });
});

describe('validateFullName', () => {
  it('needs at least two characters', () => {
    expect(validateFullName('A')).toMatch(/full name/);
    expect(validateFullName(' Ada Eze ')).toBeNull();
  });
});

describe('profileSchema', () => {
  it('parses a stored profile and rejects a malformed one', () => {
    expect(profileSchema.safeParse({ fullName: 'Ada Eze', username: 'ada.eze' }).success).toBe(true);
    expect(profileSchema.safeParse({ fullName: 'Ada Eze', username: 'Ada Eze' }).success).toBe(false);
    expect(profileSchema.safeParse({ fullName: 'A', username: 'ada' }).success).toBe(false);
  });
});
