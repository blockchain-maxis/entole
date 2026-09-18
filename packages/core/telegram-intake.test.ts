import { describe, expect, it } from 'vitest';

import { naira } from './money';
import { contactSchema, type Contact } from './schemas';
import { parseTelegramMessage } from './telegram-intake';

const CONTACTS: Contact[] = [
  contactSchema.parse({ id: 'c-mom', name: 'Mom', initials: 'M', tone: 1 }),
  contactSchema.parse({ id: 'c-chidi', name: 'Chidi Okafor', initials: 'CO', tone: 2 }),
];

describe('parseTelegramMessage', () => {
  it('parses a plain pay command', () => {
    const result = parseTelegramMessage('Pay 5000 to Mom', CONTACTS);
    expect(result).toEqual({ ok: true, contactId: 'c-mom', amountMinor: naira(5_000), note: 'Sent from Telegram' });
  });

  it('parses "send" as well as "pay"', () => {
    const result = parseTelegramMessage('Send 12000 to Chidi', CONTACTS);
    expect(result.ok).toBe(true);
  });

  it('matches on first name against a full contact name', () => {
    const result = parseTelegramMessage('Pay 3000 to Chidi for lunch', CONTACTS);
    expect(result).toEqual({
      ok: true,
      contactId: 'c-chidi',
      amountMinor: naira(3_000),
      note: 'lunch',
    });
  });

  it('accepts a naira sign and thousands separators', () => {
    const result = parseTelegramMessage('Pay ₦45,500 to Mom', CONTACTS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amountMinor).toBe(naira(45_500));
  });

  it('rejects a message that is not a payment instruction', () => {
    const result = parseTelegramMessage('What is my balance?', CONTACTS);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing amount', () => {
    const result = parseTelegramMessage('Pay to Mom', CONTACTS);
    expect(result).toEqual({ ok: false, reason: 'Could not find an amount.' });
  });

  it('rejects zero', () => {
    const result = parseTelegramMessage('Pay 0 to Mom', CONTACTS);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown recipient rather than guessing', () => {
    const result = parseTelegramMessage('Pay 5000 to Someone Unknown', CONTACTS);
    expect(result).toEqual({ ok: false, reason: 'No contact matches "Someone Unknown".' });
  });
});
