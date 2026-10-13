import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  counterpartyOf,
  fetchIndexedPayments,
  mapPaymentToActivity,
  type IndexedPayment,
} from './indexed-activity';
import { oneOffAddress, oneOffContact } from './one-off';

const ME = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as Address;
const ADA = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80' as Address;
const STRANGER = '0x1111111111111111111111111111111111111111' as Address;
const HASH = `0x${'ab'.repeat(32)}`;

function payment(overrides: Partial<IndexedPayment> = {}): IndexedPayment {
  return {
    id: `${HASH}-3`,
    from: ME.toLowerCase(),
    to: ADA.toLowerCase(),
    amount: '3160000', // 3.16 dollars, six decimals
    timestamp: '1760300000',
    txHash: HASH,
    byAssistant: false,
    ...overrides,
  };
}

const OPTIONS = {
  account: ME,
  tokenDecimals: 6,
  rate: { koboPerDollar: 158_000, quotedAt: '2026-10-12T00:00:00.000Z' },
};

describe('asking the index for one account’s payments', () => {
  function index(body: unknown, status = 200) {
    const sent: { url: string; query: string; variables: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      const parsed = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      sent.push({ url, ...parsed });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fetchImpl, sent };
  }

  it('asks for payments from the account or to it, by its lower-case spelling, newest first', async () => {
    const { fetchImpl, sent } = index({ data: { Payment: [payment()] } });
    const rows = await fetchIndexedPayments({ indexerUrl: 'https://index.test/v1/graphql', account: ME, fetch: fetchImpl });
    expect(rows).toEqual([payment()]);
    expect(sent[0]!.url).toBe('https://index.test/v1/graphql');
    expect(sent[0]!.variables).toEqual({ me: ME.toLowerCase(), limit: 100 });
    expect(sent[0]!.query).toMatch(/_or: \[\{ from: \{ _eq: \$me \} \}, \{ to: \{ _eq: \$me \} \}\]/);
    expect(sent[0]!.query).toMatch(/order_by: \{ timestamp: desc \}/);
  });

  it('leaves out a row that does not read, and keeps the rest', async () => {
    const { fetchImpl } = index({ data: { Payment: [payment(), { id: 'x', from: 'nope' }, payment({ amount: '-5' })] } });
    expect(await fetchIndexedPayments({ indexerUrl: 'u', account: ME, fetch: fetchImpl })).toEqual([payment()]);
  });

  it('an index that fails is an error, never "there are none"', async () => {
    await expect(fetchIndexedPayments({ indexerUrl: 'u', account: ME, fetch: index({}, 500).fetchImpl })).rejects.toThrow();
    await expect(
      fetchIndexedPayments({ indexerUrl: 'u', account: ME, fetch: index({ errors: [{ message: 'no' }] }).fetchImpl }),
    ).rejects.toThrow();
    await expect(fetchIndexedPayments({ indexerUrl: 'u', account: ME, fetch: index({ data: {} }).fetchImpl })).rejects.toThrow();
  });
});

describe('who is on the other end', () => {
  it('is the person paid when the account paid, and the payer when it was paid', () => {
    expect(counterpartyOf(payment(), ME)).toEqual({ address: ADA.toLowerCase(), direction: 'out' });
    expect(counterpartyOf(payment({ from: ADA.toLowerCase(), to: ME.toLowerCase() }), ME)).toEqual({
      address: ADA.toLowerCase(),
      direction: 'in',
    });
  });

  it('is nobody for a payment to oneself, or one that is not this account’s', () => {
    expect(counterpartyOf(payment({ to: ME.toLowerCase() }), ME)).toBeNull();
    expect(counterpartyOf(payment({ from: STRANGER, to: ADA.toLowerCase() }), ME)).toBeNull();
  });
});

describe('a payment from the index, as an activity entry', () => {
  it('a send: the same id the device gives it, the amount in naira, to the person saved', () => {
    const entry = mapPaymentToActivity(payment(), {
      ...OPTIONS,
      resolveContactId: (address) => (address.toLowerCase() === ADA.toLowerCase() ? 'b-ada' : undefined),
    });
    expect(entry).toEqual({
      id: `rc-${HASH}`,
      contactId: 'b-ada',
      note: 'Sent',
      at: new Date(1_760_300_000 * 1000).toISOString(),
      amountMinor: 499_280, // 3.16 dollars at 1,580 naira
      direction: 'out',
      initiatedBy: 'you',
      state: 'settled',
    });
  });

  it('a payment that arrived, from someone not saved: named as the directory names them', () => {
    const entry = mapPaymentToActivity(payment({ from: STRANGER, to: ME.toLowerCase() }), {
      ...OPTIONS,
      nameOf: () => 'Tunde Bello',
    })!;
    expect(entry).toMatchObject({ direction: 'in', note: 'Received', initiatedBy: 'you' });
    expect(oneOffContact(entry.contactId)?.name).toBe('Tunde Bello');
    // Where to pay them back is kept; none of it is a name on a screen.
    expect(oneOffAddress(entry.contactId)?.toLowerCase()).toBe(STRANGER);
    expect(oneOffContact(entry.contactId)?.name).not.toMatch(/0x/);
  });

  it('with no name to give, they are an Entole account, never an address', () => {
    const entry = mapPaymentToActivity(payment({ from: STRANGER, to: ME.toLowerCase() }), OPTIONS)!;
    expect(oneOffContact(entry.contactId)?.name).toBe('Entole account');
  });

  it('a payment the assistant made is the assistant’s for the one who made it, not for the one paid', () => {
    expect(mapPaymentToActivity(payment({ byAssistant: true }), OPTIONS)!.initiatedBy).toBe('assistant');
    const arrived = mapPaymentToActivity(payment({ byAssistant: true, from: ADA.toLowerCase(), to: ME.toLowerCase() }), OPTIONS)!;
    expect(arrived.initiatedBy).toBe('you');
  });

  it('is nothing for a payment that is not this account’s', () => {
    expect(mapPaymentToActivity(payment({ from: STRANGER, to: ADA.toLowerCase() }), OPTIONS)).toBeNull();
    expect(mapPaymentToActivity(payment({ to: ME.toLowerCase() }), OPTIONS)).toBeNull();
  });

  it('calls a payment by one id however its hash is spelt', () => {
    const upper = `0x${'AB'.repeat(32)}`;
    expect(mapPaymentToActivity(payment({ txHash: upper }), OPTIONS)!.id).toBe(`rc-${HASH}`);
  });
});
