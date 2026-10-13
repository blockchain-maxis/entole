import { describe, expect, it } from 'vitest';

import { paymentReference, type KeptPayment } from './payments-feed';
import {
  isReceiptReference,
  paymentOfReceipt,
  receiptCheckLine,
  receiptFileName,
  receiptImageLink,
  receiptImagePath,
  receiptLink,
  receiptPath,
  receiptWords,
  reportForReceipt,
  slipFacts,
  slipSummary,
  UNNAMED_PARTY,
} from './receipt-slip';
import type { Receipt } from './schemas';

const HASH = `0x3f9a2b7c1d4e${'ab'.repeat(26)}`;
const SENDER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01';
const PAID = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80';

const kept: KeptPayment = {
  hash: HASH,
  from: SENDER,
  fromName: 'Ada Eze',
  fromUsername: 'ada.eze',
  to: PAID,
  toName: 'Tunde Bello',
  toUsername: 'tunde',
  amountToken: '3160000',
  amountMinor: 500_000,
  at: '2026-10-12T16:00:00.000Z',
  note: 'For rent',
};

describe('where a receipt lives', () => {
  it('is its reference, and nothing that is not a reference makes a link', () => {
    expect(paymentReference(HASH)).toBe('3F9A2B7C1D4E');
    expect(receiptPath('3f9a2b7c1d4e')).toBe('/receipt/3F9A2B7C1D4E');
    expect(receiptImagePath('3F9A2B7C1D4E')).toBe('/api/receipt/3F9A2B7C1D4E/image');
    expect(receiptLink('https://entole.pro/', '3F9A2B7C1D4E')).toBe('https://entole.pro/receipt/3F9A2B7C1D4E');
    expect(receiptImageLink('https://entole.pro', '3F9A2B7C1D4E')).toBe(
      'https://entole.pro/api/receipt/3F9A2B7C1D4E/image',
    );
    expect(receiptCheckLine('https://entole.pro', '3F9A2B7C1D4E')).toBe('entole.pro/receipt/3F9A2B7C1D4E');
    expect(receiptFileName('3f9a2b7c1d4e')).toBe('entole-receipt-3F9A2B7C1D4E.png');

    for (const wrong of ['', '3F9A2B7C1D4', '3F9A2B7C1D4E0', 'ZZZZZZZZZZZZ', '../../etc/pass', HASH]) {
      expect(isReceiptReference(wrong), wrong).toBe(false);
      expect(receiptPath(wrong), wrong).toBeNull();
      expect(receiptImagePath(wrong), wrong).toBeNull();
      expect(receiptLink('https://entole.pro', wrong), wrong).toBeNull();
    }
  });
});

describe('passing a receipt on when the picture cannot be', () => {
  const words = '₦5,000 to Tunde Bello\nDelivered in 1 second\nReference 3F9A2B7C1D4E';

  it('sends the words with the link under them once the server has the receipt', () => {
    expect(receiptWords({ words, base: 'https://entole.pro', reference: '3F9A2B7C1D4E', kept: true })).toBe(
      `${words}\nhttps://entole.pro/receipt/3F9A2B7C1D4E`,
    );
  });

  it('sends the words alone when it does not, never a link to nothing', () => {
    expect(receiptWords({ words, base: 'https://entole.pro', reference: '3F9A2B7C1D4E', kept: false })).toBe(words);
    expect(receiptWords({ words, base: 'https://entole.pro', reference: 'not-a-reference', kept: true })).toBe(words);
  });
});

describe('what a slip says', () => {
  const facts = slipFacts(kept, { tokenDecimals: 6 });

  it('is the amount in naira, what arrived in dollars, both people, and when on a Lagos clock', () => {
    expect(facts.reference).toBe('3F9A2B7C1D4E');
    expect(facts.figure).toEqual({ symbol: '₦', digits: '5,000', words: '₦5,000' });
    expect(facts.arrived).toBe('$3.16');
    expect(facts.from).toEqual({ name: 'Ada Eze', username: '@ada.eze' });
    expect(facts.to).toEqual({ name: 'Tunde Bello', username: '@tunde' });
    // 16:00 UTC is five in the afternoon in Lagos, whatever clock the server keeps.
    expect(facts.delivered).toEqual({ date: '12 Oct 2026', time: '5:00 PM' });
    expect(facts.note).toBe('For rent');
    expect(slipSummary(facts)).toBe('₦5,000 from Ada Eze to Tunde Bello, delivered 12 Oct 2026');
  });

  it('a payment late in the day in Lagos is dated by Lagos, not by the server', () => {
    const late = slipFacts({ ...kept, at: '2026-10-12T23:30:00.000Z' }, { tokenDecimals: 6 });
    expect(late.delivered).toEqual({ date: '13 Oct 2026', time: '12:30 AM' });
  });

  it('never carries an account or the payment itself', () => {
    const everything = JSON.stringify(facts).toLowerCase();
    expect(everything).not.toContain(SENDER.toLowerCase());
    expect(everything).not.toContain(PAID.toLowerCase());
    expect(everything).not.toContain(HASH.toLowerCase());
    expect(everything).not.toMatch(/0x[0-9a-f]{8}/);
  });

  it('someone the directory has no name for is an Entole account, never an address', () => {
    const { fromName: _n, fromUsername: _u, toName: _tn, toUsername: _tu, ...bare } = kept;
    const unnamed = slipFacts(bare, { tokenDecimals: 6 });
    expect(unnamed.from).toEqual({ name: UNNAMED_PARTY });
    expect(unnamed.to).toEqual({ name: UNNAMED_PARTY });
    expect(UNNAMED_PARTY).toBe('Entole account');
  });

  it('with no naira figure the dollars are the figure, said once', () => {
    const { amountMinor: _a, note: _note, ...dollarsOnly } = kept;
    const plain = slipFacts(dollarsOnly, { tokenDecimals: 6 });
    expect(plain.figure).toEqual({ symbol: '$', digits: '3.16', words: '$3.16' });
    expect(plain.arrived).toBeNull();
    expect(plain.note).toBeUndefined();
  });

  it('works dollars out to the cent, and groups thousands', () => {
    expect(slipFacts({ ...kept, amountToken: '1234565000' }, { tokenDecimals: 6 }).arrived).toBe('$1,234.57');
    expect(slipFacts({ ...kept, amountToken: '4999' }, { tokenDecimals: 6 }).arrived).toBe('$0.00');
    expect(slipFacts({ ...kept, amountToken: '5000' }, { tokenDecimals: 6 }).arrived).toBe('$0.01');
    expect(slipFacts({ ...kept, amountMinor: 123_456_789 }, { tokenDecimals: 6 }).figure.words).toBe('₦1,234,567.89');
  });
});

describe('telling the server again before a receipt is shared', () => {
  const receipt: Receipt = {
    id: `rc-${HASH}`,
    reference: '3F9A2B7C1D4E',
    contactId: 'c1',
    amountMinor: 500_000,
    feeMinor: 2_500,
    receivedMinor: 316,
    koboPerDollar: 158_000,
    sentAt: '2026-10-12T15:59:59.000Z',
    settledAt: '2026-10-12T16:00:00.000Z',
    deliveredInSeconds: 1,
  };

  it('names the payment by what the receipt is for', () => {
    expect(paymentOfReceipt(receipt.id)).toBe(HASH);
    expect(paymentOfReceipt('rc-demo')).toBeNull();
    expect(paymentOfReceipt(HASH)).toBeNull();
  });

  it('says the same thing the first telling said', () => {
    expect(reportForReceipt(receipt, ' For rent ')).toEqual({
      hash: HASH,
      note: 'For rent',
      amountMinor: 500_000,
      koboPerDollar: 158_000,
    });
  });

  it('leaves out a note the sender never wrote', () => {
    expect(reportForReceipt(receipt, 'Sent')).toEqual({ hash: HASH, amountMinor: 500_000, koboPerDollar: 158_000 });
    expect(reportForReceipt(receipt)).toEqual({ hash: HASH, amountMinor: 500_000, koboPerDollar: 158_000 });
  });

  it('has nothing to say for a receipt that is not a payment on the network', () => {
    expect(reportForReceipt({ ...receipt, id: 'rc-demo' })).toBeNull();
  });
});
