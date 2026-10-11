import { describe, expect, it } from 'vitest';

import { oneOffId } from './one-off';
import { encodePaymentCode } from './payment-code';
import type { Beneficiary } from './records';
import { beneficiaryFromOneOff, suggestedNameFor } from './save-recipient';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const OTHER = '0xEE9C2cE4FC3a58f88D3E2FCE9807cDcA3A97Ed3e' as const;
const NOW = new Date('2026-10-11T09:30:00.000Z');

const paid = oneOffId(encodePaymentCode(ADDRESS))!;
const paidByLink = oneOffId(encodePaymentCode(ADDRESS), 'Adaeze Okafor')!;

function saved(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    id: 'b-1',
    name: 'Tunde',
    address: OTHER,
    tone: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

describe('saving someone just paid by their code', () => {
  it('makes a record that pays the same place the code did', () => {
    const outcome = beneficiaryFromOneOff({ recipientId: paid, name: 'Ada', existing: [], id: 'new-1', now: NOW });
    expect(outcome).toEqual({
      ok: true,
      beneficiary: { id: 'new-1', name: 'Ada', address: ADDRESS, tone: 1, createdAt: NOW.toISOString() },
    });
  });

  it('tidies the name it is given', () => {
    const outcome = beneficiaryFromOneOff({
      recipientId: paid,
      name: '  Ada   Obi \n',
      existing: [],
      id: 'new-1',
      now: NOW,
    });
    expect(outcome.ok && outcome.beneficiary.name).toBe('Ada Obi');
  });

  it('will not save someone without a name', () => {
    const outcome = beneficiaryFromOneOff({ recipientId: paid, name: '   ', existing: [], id: 'new-1', now: NOW });
    expect(outcome).toEqual({ ok: false, kind: 'no-name' });
  });

  it('finds someone already saved under the same code, however the address is written', () => {
    const already = saved({ id: 'b-ada', name: 'Ada', address: ADDRESS.toLowerCase() as `0x${string}` });
    const outcome = beneficiaryFromOneOff({
      recipientId: paid,
      name: 'Ada again',
      existing: [saved(), already],
      id: 'new-1',
      now: NOW,
    });
    expect(outcome).toEqual({ ok: false, kind: 'already-saved', as: already });
  });

  it('refuses an id that is not a payment code', () => {
    for (const recipientId of ['b-1', 'code:PAY-0000-0000', '']) {
      expect(beneficiaryFromOneOff({ recipientId, name: 'Ada', existing: [], id: 'new-1', now: NOW })).toEqual({
        ok: false,
        kind: 'not-a-code',
      });
    }
  });

  it('gives each new person the next avatar tone', () => {
    const tones = [0, 1, 2, 3].map((count) => {
      const existing = Array.from({ length: count }, (_, index) => saved({ id: `b-${index}` }));
      const outcome = beneficiaryFromOneOff({ recipientId: paid, name: 'Ada', existing, id: 'new-1', now: NOW });
      return outcome.ok ? outcome.beneficiary.tone : null;
    });
    expect(tones).toEqual([1, 2, 3, 1]);
  });

  it('offers the name their payment link carried, and nothing when it carried none', () => {
    expect(suggestedNameFor(paidByLink)).toBe('Adaeze Okafor');
    expect(suggestedNameFor(paid)).toBe('');
    expect(suggestedNameFor('b-1')).toBe('');
  });
});
