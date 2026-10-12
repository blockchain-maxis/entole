import { describe, expect, it } from 'vitest';

import { oneOffAddress, oneOffContact } from './one-off';
import {
  activityFromReceived,
  buildFeedMessage,
  createPaymentsFeedClient,
  type ReceivedPayment,
} from './payments-feed';

const ME = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const SENDER = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80' as const;
const HASH = `0x${'ab'.repeat(32)}`;

const payment: ReceivedPayment = {
  hash: HASH,
  from: SENDER,
  fromName: 'Ada Eze',
  fromUsername: 'ada.eze',
  amountToken: '3160000',
  amountMinor: 500_000,
  at: '2026-10-12T16:00:00.000Z',
  note: 'For rent',
};

describe('what a request is signed over', () => {
  it('is the same on both ends, and ties the signature to one action and one payment', () => {
    const a = buildFeedMessage({ account: ME, action: 'record', hash: HASH, timestampSeconds: 100 });
    expect(a).toBe(buildFeedMessage({ account: ME, action: 'record', hash: HASH.toUpperCase().replace('0X', '0x'), timestampSeconds: 100 }));
    expect(a).not.toBe(buildFeedMessage({ account: ME, action: 'list', timestampSeconds: 100 }));
    expect(a).not.toBe(buildFeedMessage({ account: ME, action: 'record', hash: `0x${'cd'.repeat(32)}`, timestampSeconds: 100 }));
    expect(a).not.toBe(buildFeedMessage({ account: SENDER, action: 'record', hash: HASH, timestampSeconds: 100 }));
  });
});

describe('the feed client', () => {
  function client(respond: (body: Record<string, unknown>) => Response) {
    const sent: Record<string, unknown>[] = [];
    const signed: string[] = [];
    const feed = createPaymentsFeedClient({
      baseUrl: 'https://entole.test/',
      account: ME,
      sign: async (message) => {
        signed.push(message);
        return '0xabc';
      },
      fetch: (async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        sent.push(body);
        return respond(body);
      }) as unknown as typeof fetch,
    });
    return { feed, sent, signed };
  }

  it('reports a settled payment with the note and what was typed, signed for that payment', async () => {
    const { feed, sent, signed } = client(() => Response.json({ ok: true }));
    expect(await feed.record({ hash: HASH, note: '  For   rent ', amountMinor: 500_000, koboPerDollar: 158_000 })).toBe(true);
    expect(sent[0]).toMatchObject({ account: ME, action: 'record', hash: HASH, note: 'For rent', amountMinor: 500_000 });
    expect(signed[0]).toContain(`payment: ${HASH}`);
    expect(signed[0]).toContain('action: record');
  });

  it('collects what arrived, and drops a record that does not read rather than all of them', async () => {
    const { feed, signed } = client(() => Response.json({ payments: [payment, { hash: 'nope' }] }));
    expect(await feed.list()).toEqual([payment]);
    expect(signed[0]).toContain('payment: none');
  });

  it('a server that cannot be asked means nothing new, never an error', async () => {
    const down = client(() => new Response('no', { status: 501 }));
    expect(await down.feed.list()).toEqual([]);
    expect(await down.feed.record({ hash: HASH })).toBe(false);

    const unreachable = createPaymentsFeedClient({
      baseUrl: '',
      account: ME,
      sign: async () => '0xabc',
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(await unreachable.list()).toEqual([]);
  });
});

describe('a payment that arrived, as an activity entry', () => {
  it('names the sender as the directory named them, and keeps where to pay them back', () => {
    const entry = activityFromReceived(payment, { fallbackMinor: 1 })!;
    expect(entry).toMatchObject({ id: `rc-${HASH}`, direction: 'in', amountMinor: 500_000, note: 'For rent', at: payment.at });
    expect(oneOffContact(entry.contactId)?.name).toBe('Ada Eze');
    expect(oneOffAddress(entry.contactId)).toBe(SENDER);
  });

  it('uses the saved person when there is one, and says "Received" when there was no note', () => {
    const { note: _note, ...plain } = payment;
    const entry = activityFromReceived(plain, { savedContactId: 'b-mum', fallbackMinor: 1 })!;
    expect(entry.contactId).toBe('b-mum');
    expect(entry.note).toBe('Received');
  });

  it('falls back to the receiver’s own figure when the server had none', () => {
    const { amountMinor: _amount, ...bare } = payment;
    expect(activityFromReceived(bare, { fallbackMinor: 499_280 })!.amountMinor).toBe(499_280);
  });
});
