import { describe, expect, it } from 'vitest';

import type { DirectoryIdentity, PhoneHandle } from './directory';
import { encodePaymentCode } from './payment-code';
import { findRecipient, readRecipient } from './recipient';

const ADA = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const CODE = encodePaymentCode(ADA);
const ada: DirectoryIdentity = { address: ADA.toLowerCase(), name: 'Ada Eze', initials: 'AE', tone: 1, username: 'ada.eze' };

/** A directory that knows one person, by username and by number. */
const directory = {
  resolveByUsername: async (username: string) => (username === 'ada.eze' ? ada : null),
  resolveByPhone: async (phone: PhoneHandle) => (phone.country === 'ng' && phone.number === '9012365123' ? ada : null),
};

describe('reading who some text is asking to pay', () => {
  it.each([
    ['@ada.eze', { kind: 'username', username: 'ada.eze' }],
    ['ada.eze', { kind: 'username', username: 'ada.eze' }],
    ['https://entole.pro/pay/@ada.eze', { kind: 'username', username: 'ada.eze' }],
    ['entole://pay/@ada.eze', { kind: 'username', username: 'ada.eze' }],
    ['0901 236 5123', { kind: 'phone', phone: { country: 'ng', number: '9012365123' } }],
    ['+234 901 236 5123', { kind: 'phone', phone: { country: 'ng', number: '9012365123' } }],
    ['https://entole.pro/ng/9012365123', { kind: 'phone', phone: { country: 'ng', number: '9012365123' } }],
  ])('%s names a person by username or number', (text, handle) => {
    expect(readRecipient(text)).toMatchObject({ kind: 'handle', handle });
  });

  it('keeps what a pay link asked for', () => {
    expect(readRecipient('https://entole.pro/pay/@ada.eze?t=invoice&a=500000&c=NGN&r=INV-7')).toEqual({
      kind: 'handle',
      handle: { kind: 'username', username: 'ada.eze' },
      request: { kind: 'invoice', amountMinor: 500_000, currency: 'NGN', reference: 'INV-7' },
    });
  });

  it('still opens a link made before usernames, without asking anyone', async () => {
    const sought = readRecipient(`https://entole.pro/pay/${CODE}?n=Ada`);
    expect(sought).toMatchObject({ kind: 'known', checkout: { code: CODE, address: ADA, payee: 'Ada' } });
    const nobodyHome = { resolveByUsername: async () => null, resolveByPhone: async () => null };
    expect(await findRecipient(nobodyHome, sought!)).toMatchObject({ address: ADA });
  });

  it('names nobody for anything else', () => {
    for (const text of ['', '   ', 'hello there', 'https://example.com', '12345', 'PAY-NOPE']) {
      expect(readRecipient(text)).toBeNull();
    }
  });
});

describe('finding them in the directory', () => {
  it('finds a person by username, under the name the directory has', async () => {
    const found = await findRecipient(directory, readRecipient('@ada.eze')!);
    expect(found).toEqual({ code: CODE, address: ADA, kind: 'pay', payee: 'Ada Eze', username: 'ada.eze' });
  });

  it('finds the same person by number, however the number is written', async () => {
    for (const text of ['09012365123', '9012365123', '+2349012365123']) {
      expect(await findRecipient(directory, readRecipient(text)!)).toMatchObject({ address: ADA, username: 'ada.eze' });
    }
  });

  it('carries the amount a link asked for, and never a name from the link', async () => {
    const found = await findRecipient(directory, readRecipient('/pay/@ada.eze?a=250000&c=NGN&n=Someone%20Else')!);
    expect(found).toMatchObject({ amountMinor: 250_000, currency: 'NGN', payee: 'Ada Eze' });
  });

  it('is nobody when nobody holds it', async () => {
    expect(await findRecipient(directory, readRecipient('@tunde')!)).toBeNull();
    expect(await findRecipient(directory, readRecipient('0803 123 4567')!)).toBeNull();
  });

  it('refuses an identity whose account does not read', async () => {
    const broken = { ...directory, resolveByUsername: async () => ({ ...ada, address: 'nope' }) };
    expect(await findRecipient(broken, readRecipient('@ada.eze')!)).toBeNull();
  });
});
