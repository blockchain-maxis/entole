import { describe, expect, it } from 'vitest';

import { NOT_SENT_LINE, RECEIPT_LEFT_LINE, STILL_THERE_LINE, notEnoughLine, reviewLine, sentLine } from './assistant-voice-lines';

const NEVER = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|signature|seed|transaction)\b/i;

describe('what it says about a payment', () => {
  it('reads the review back from the figures it was given, and asks', () => {
    expect(reviewLine({ name: 'Ada Eze', amountMinor: 500_000, feeMinor: 25_000, totalMinor: 525_000 })).toBe(
      'Sending ₦5,000 to Ada Eze. The fee is ₦250, so ₦5,250 leaves your account. Shall I send it?',
    );
  });

  it('says when there is not enough, and how much it would take', () => {
    expect(notEnoughLine({ name: 'Ada Eze', totalMinor: 525_000, balanceMinor: 100_000 })).toBe(
      "You don't have enough for that. With the fee, sending to Ada Eze takes ₦5,250, and you have ₦1,000.",
    );
  });

  it('says it has gone, and offers the receipt', () => {
    expect(sentLine({ name: 'Ada Eze', amountMinor: 500_000 })).toBe('Sent. ₦5,000 has gone to Ada Eze. Want to share the receipt?');
  });

  it('never says a word the product never says', () => {
    const lines = [
      reviewLine({ name: 'Ada', amountMinor: 1, feeMinor: 1, totalMinor: 2 }),
      notEnoughLine({ name: 'Ada', totalMinor: 2, balanceMinor: 1 }),
      sentLine({ name: 'Ada', amountMinor: 1 }),
      NOT_SENT_LINE,
      RECEIPT_LEFT_LINE,
      STILL_THERE_LINE,
    ];
    for (const line of lines) expect(line).not.toMatch(NEVER);
  });
});
