import { encodePaymentCode } from '@entole/core/payment-code';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { describe, expect, it } from 'vitest';

import {
  cleanNote,
  entryFromParam,
  handleIn,
  isPayPath,
  payLinkFromRoute,
  resolveSendTarget,
  sendParamsFor,
} from '../lib/recipient';

const CODE = encodePaymentCode('0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01');
const BASE = 'https://entole.example';

const ADA = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01';
const ada = { address: ADA, name: 'Ada Eze', initials: 'AE', tone: 1 as const, username: 'ada.eze' };
/** A backend whose directory knows one person and whose saved list is empty. */
const backend = {
  source: { resolveContactId: () => undefined },
  directory: {
    resolveByUsername: async (username: string) => (username === 'ada.eze' ? ada : null),
    resolveByPhone: async (phone: { number: string }) => (phone.number === '9012365123' ? ada : null),
  },
} as unknown as Parameters<typeof resolveSendTarget>[2];

describe('paying someone by username, number or the link they shared', () => {
  const id = `code:${CODE}#${encodeURIComponent('Ada Eze')}`;

  it.each(['@ada.eze', 'ada.eze', '0901 236 5123', '09012365123', `${BASE}/pay/@ada.eze`, 'entole://pay/@ada.eze'])(
    '%s finds the person, under the name the directory has',
    async (text) => {
      expect(await resolveSendTarget(text, undefined, backend)).toEqual({ contactId: id });
    },
  );

  it('carries the amount and note a pay link asked for', async () => {
    const link = `${BASE}/pay/@ada.eze?a=1250050&c=NGN&m=Rent`;
    expect(await resolveSendTarget(link, undefined, backend)).toEqual({ contactId: id, amount: '1250050', note: 'Rent' });
  });

  it('says nobody has it, apart from text that names nobody at all', async () => {
    expect(await resolveSendTarget('@tunde', undefined, backend)).toBe('unclaimed');
    expect(await resolveSendTarget('hello there', undefined, backend)).toBeNull();
  });

  it('uses the saved beneficiary when the person is already saved', async () => {
    const saved = { ...backend, source: { resolveContactId: () => 'beneficiary-1' } } as unknown as typeof backend;
    expect(await resolveSendTarget('@ada.eze', undefined, saved)).toEqual({ contactId: 'beneficiary-1' });
  });

  it('a username needs the directory, so nothing is decided without it', () => {
    expect(sendParamsFor('@ada.eze')).toBeNull();
    expect(handleIn('@ada.eze')).toEqual({ kind: 'username', username: 'ada.eze' });
    expect(handleIn(CODE)).toBeNull();
  });
});

describe('a pay link opened from outside the app', () => {
  it('is put back together from what the router made of it', () => {
    expect(payLinkFromRoute({ code: '@ada.eze' })).toBe('/pay/@ada.eze');
    expect(payLinkFromRoute({ code: '%40ada.eze', a: '500000', c: 'NGN', t: 'invoice' })).toBe(
      '/pay/@ada.eze?t=invoice&a=500000&c=NGN',
    );
    // Written without its "@", it is still a username.
    expect(payLinkFromRoute({ code: 'ada.eze' })).toBe('/pay/@ada.eze');
    // A link made before usernames still opens.
    expect(payLinkFromRoute({ code: CODE })).toBe(`/pay/${CODE}`);
  });

  it('leads to the same person as pasting it would', async () => {
    const link = payLinkFromRoute({ code: '@ada.eze', a: '250000', c: 'NGN' })!;
    expect(await resolveSendTarget(link, undefined, backend)).toMatchObject({ amount: '250000' });
  });

  it('names nobody when the route did not', () => {
    for (const params of [{}, { code: '' }, { code: ['a'] }, { code: 'x'.repeat(200) }]) {
      expect(payLinkFromRoute(params)).toBeNull();
    }
  });

  it('the lock screen only ever carries someone on to a pay link', () => {
    expect(isPayPath('/pay/@ada.eze?a=100')).toBe(true);
    for (const other of ['/(tabs)', '/pay/', '/send?contactId=x', 'https://evil.test/pay/@a', '/pay/@a/../../me', undefined, 5]) {
      expect(isPayPath(other)).toBe(false);
    }
  });
});

describe('sending to a link made before usernames', () => {
  it('still reads it, pasted, as a link and as a deep link', () => {
    const id = `code:${CODE}`;
    expect(sendParamsFor(CODE)).toEqual({ contactId: id });
    expect(sendParamsFor(CODE.toLowerCase().replace(/-/g, ' '))).toEqual({ contactId: id });
    expect(sendParamsFor(`${BASE}/pay/${CODE}`)).toEqual({ contactId: id });
    expect(sendParamsFor(`entole://pay/${CODE}`)).toEqual({ contactId: id });
  });

  it('refuses anything else', () => {
    expect(sendParamsFor('')).toBeNull();
    expect(sendParamsFor('https://example.com/pay/nothing')).toBeNull();
    expect(sendParamsFor(CODE.slice(0, -2))).toBeNull();
  });

  it('carries an amount in naira and a note from a link', () => {
    const link = buildCheckoutLink(BASE, {
      code: CODE,
      kind: 'pay',
      amountMinor: 1_250_050,
      currency: 'NGN',
      note: 'Rent',
    });
    expect(sendParamsFor(link ?? '')).toEqual({ contactId: `code:${CODE}`, amount: '1250050', note: 'Rent' });
  });

  it('does not guess at an amount in another currency', () => {
    const link = buildCheckoutLink(BASE, { code: CODE, kind: 'pay', amountMinor: 5_000, currency: 'USD' });
    expect(sendParamsFor(link ?? '')).toEqual({ contactId: `code:${CODE}` });
  });

  it('lets the caller’s note win over the link’s', () => {
    const link = buildCheckoutLink(BASE, { code: CODE, kind: 'pay', note: 'From the link' });
    expect(sendParamsFor(link ?? '', 'Supplier payment')?.note).toBe('Supplier payment');
    expect(sendParamsFor(link ?? '')?.note).toBe('From the link');
  });

  it('uses the saved beneficiary for that address instead of a one-off id', () => {
    const saved = sendParamsFor(CODE, undefined, () => 'beneficiary-1');
    expect(saved?.contactId).toBe('beneficiary-1');
  });

  it('falls back to the one-off id when the address is not saved', () => {
    const unsaved = sendParamsFor(CODE, undefined, () => undefined);
    expect(unsaved?.contactId).toBe(`code:${CODE}`);
  });
});

describe('a note from a route param', () => {
  it('is trimmed and kept to what the review sheet takes', () => {
    expect(cleanNote('  Supplier payment ')).toBe('Supplier payment');
    expect(cleanNote('x'.repeat(200))).toHaveLength(80);
    expect(cleanNote('   ')).toBeUndefined();
    expect(cleanNote(undefined)).toBeUndefined();
    expect(cleanNote(['a'])).toBeUndefined();
  });
});

describe('the amount a link asks for pre-fills the keypad', () => {
  it('turns kobo into what the keypad would have typed', () => {
    expect(entryFromParam('500000')).toEqual({ raw: '5000' });
    expect(entryFromParam('1250050')).toEqual({ raw: '12500.50' });
    expect(entryFromParam('5')).toEqual({ raw: '0.05' });
  });

  it('starts empty when the amount is missing, malformed, zero or too large to enter', () => {
    for (const value of [undefined, '', '0', '-5', '12.5', 'abc', ['1'], '9999999999999']) {
      expect(entryFromParam(value)).toEqual({ raw: '' });
    }
  });
});
