import { afterEach, describe, expect, it, vi } from 'vitest';

import { naira } from './money';
import { contactSchema, type Contact } from './schemas';
import { parseTelegramMessage, parseTelegramMessageWithAssistant } from './telegram-intake';

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

describe('parseTelegramMessageWithAssistant', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never calls out when the heuristic already understood the message', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await parseTelegramMessageWithAssistant('Pay 5000 to Mom', CONTACTS, {
      apiKey: 'test-key',
    });

    expect(result).toEqual({ ok: true, contactId: 'c-mom', amountMinor: naira(5_000), note: 'Sent from Telegram' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the heuristic reason when no config is given', async () => {
    const result = await parseTelegramMessageWithAssistant('send mom five thousand', CONTACTS);
    expect(result.ok).toBe(false);
  });

  it('uses the model result for a message the grammar cannot parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  understood: true,
                  amountWholeNaira: 5000,
                  recipientName: 'Mom',
                  note: 'light bill',
                }),
              },
            },
          ],
        }),
      })),
    );

    const result = await parseTelegramMessageWithAssistant('send mom five thousand for the light bill', CONTACTS, {
      apiKey: 'test-key',
    });

    expect(result).toEqual({ ok: true, contactId: 'c-mom', amountMinor: naira(5_000), note: 'light bill' });
  });

  it('falls back cleanly when the model response fails Zod validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ understood: true, amountWholeNaira: 'a lot' }) } }],
        }),
      })),
    );

    const result = await parseTelegramMessageWithAssistant('send mom money', CONTACTS, { apiKey: 'test-key' });
    expect(result.ok).toBe(false);
  });

  it('falls back cleanly when the request fails outright', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await parseTelegramMessageWithAssistant('send mom five thousand', CONTACTS, {
      apiKey: 'test-key',
    });
    expect(result.ok).toBe(false);
  });

  it('falls back cleanly when the model does not recognise a contact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ understood: true, amountWholeNaira: 5000, recipientName: 'Nobody' }),
              },
            },
          ],
        }),
      })),
    );

    const result = await parseTelegramMessageWithAssistant('send nobody five thousand', CONTACTS, {
      apiKey: 'test-key',
    });
    expect(result.ok).toBe(false);
  });
});
