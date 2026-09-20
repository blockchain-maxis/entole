import { describe, expect, it } from 'vitest';

import {
  entoleCode,
  initialsFor,
  normalizeUsername,
  profileSchema,
  suggestUsername,
  validateFullName,
  validateUsername,
} from './profile';

const ADDRESS = '0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7';

describe('entoleCode', () => {
  it('has the ENT-XXXX-XXXX shape in Crockford base32', () => {
    expect(entoleCode(ADDRESS)).toMatch(/^ENT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('is deterministic and ignores the address casing', () => {
    expect(entoleCode(ADDRESS)).toBe(entoleCode(ADDRESS));
    expect(entoleCode(ADDRESS)).toBe(entoleCode(ADDRESS.toLowerCase()));
  });

  it('differs for different accounts, and changes when one digit changes', () => {
    const other = `${ADDRESS.slice(0, -1)}8`;
    expect(entoleCode(other)).not.toBe(entoleCode(ADDRESS));
  });

  it('never contains the address or a slice of it', () => {
    const code = entoleCode(ADDRESS).replace(/-/g, '');
    const hex = ADDRESS.slice(2).toUpperCase();
    expect(hex.includes(code)).toBe(false);
    expect(code.includes(hex.slice(0, 4))).toBe(false);
    expect(code.includes(hex.slice(-4))).toBe(false);
  });
});

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
