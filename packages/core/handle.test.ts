import { describe, expect, it } from 'vitest';

import { formatHandle, parseHandle, resolveHandle } from './handle';

describe('reading a username or a phone number', () => {
  it.each([
    ['@ada.eze', 'ada.eze'],
    ['ada.eze', 'ada.eze'],
    ['  @Ada.Eze ', 'ada.eze'],
    ['tunde_b', 'tunde_b'],
  ])('%s is the username %s', (typed, username) => {
    expect(parseHandle(typed)).toEqual({ kind: 'username', username });
  });

  it.each([
    'https://entole.pro/pay/@ada.eze',
    'entole.pro/pay/@Ada.Eze',
    '/pay/%40ada.eze',
    'https://entole.pro/pay/@ada.eze?a=5000&c=NGN',
  ])('%s is a pay link made from a username', (typed) => {
    expect(parseHandle(typed)).toEqual({ kind: 'username', username: 'ada.eze' });
  });

  it.each(['0803 123 4567', '08031234567', '+234 803 123 4567', '2348031234567', '8031234567', '0803-123-4567'])(
    '%s is one Nigerian number',
    (typed) => {
      expect(parseHandle(typed)).toEqual({ kind: 'phone', phone: { country: 'ng', number: '8031234567' } });
    },
  );

  it.each([
    '',
    'ab',
    '12345',
    'PAY-ZETP-HAWJ-MET0',
    'https://entole.pro/pay/PAY-ZETP',
    'entole.pro/pay/x',
    'ada eze',
    '0803123',
    'a'.repeat(21),
  ])('%s is neither', (typed) => {
    expect(parseHandle(typed)).toBeNull();
  });

  it('writes a handle back the way a person would', () => {
    expect(formatHandle({ kind: 'username', username: 'ada.eze' })).toBe('@ada.eze');
    expect(formatHandle({ kind: 'phone', phone: { country: 'ng', number: '8031234567' } })).toBe('0803 123 4567');
  });

  it('asks the directory the right question for each kind', async () => {
    const asked: string[] = [];
    const directory = {
      resolveByUsername: async (username: string) => (asked.push(`u:${username}`), null),
      resolveByPhone: async (phone: { country: string; number: string }) => (asked.push(`p:${phone.number}`), null),
    };
    await resolveHandle(directory, { kind: 'username', username: 'ada.eze' });
    await resolveHandle(directory, { kind: 'phone', phone: { country: 'ng', number: '8031234567' } });
    expect(asked).toEqual(['u:ada.eze', 'p:8031234567']);
  });
});
