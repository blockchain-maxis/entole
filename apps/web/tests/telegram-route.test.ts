import type { Contact } from '@entole/core/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as telegram } from '@/app/api/telegram/webhook/route';
import { getServerStore, resetServerStore } from '@/lib/server/store';

/**
 * The Telegram intake route against the in-memory server store: no network, no
 * bot token calls. Proves the linked-account path end to end — a message from
 * a linked chat becomes a proposal in that account's inbox, and an unlinked or
 * unparseable message writes nothing.
 */

const ACCOUNT = 'acct-1';
const MOM: Contact = { id: 'c-mom', name: 'Mom', initials: 'MO', tone: 1 };

const SECRET = 'webhook-secret';

function post(body: unknown, secret: string | null = SECRET) {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Every reply the route sent to the chat, as plain text. */
const sent = vi.fn();

function message(text: string, chatId = 555) {
  return { message: { text, chat: { id: chatId } } };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetServerStore();
  sent.mockReset();
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  delete process.env.QWEN_API_KEY;
  // The route replies through Telegram's API; capture instead of calling it.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      sent(url, JSON.parse(init?.body ?? '{}'));
      return new Response('{}');
    }),
  );
});

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  vi.unstubAllGlobals();
});

describe('POST /api/telegram/webhook', () => {
  it('answers 501 when no bot token is configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const response = await telegram(post(message('Pay 5000 to Mom')));
    expect(response.status).toBe(501);
    expect((await body(response)).ok).toBe(false);
  });

  it('answers 501 when no webhook secret is configured', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await telegram(post(message('Pay 5000 to Mom')))).status).toBe(501);
  });

  it('refuses a request that does not carry the secret, and does nothing', async () => {
    for (const secret of [null, 'wrong-secret']) {
      const response = await telegram(post(message('/link CODE1'), secret));
      expect(response.status).toBe(401);
    }
    expect(sent).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON or not an update', async () => {
    expect((await telegram(post('not json'))).status).toBe(400);
    expect((await telegram(post({ message: { text: 5 } }))).status).toBe(400);
  });

  it('replies in the chat, in plain words, for each outcome', async () => {
    await telegram(post(message('Pay 5000 to Mom')));
    expect(sent).toHaveBeenLastCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({ chat_id: 555, text: expect.stringMatching(/link/i) }),
    );

    const store = getServerStore();
    await store.createLinkCode(ACCOUNT, 'CODE1');
    await telegram(post(message('/link CODE1')));
    expect(sent).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ text: expect.stringMatching(/^Linked/) }));

    await store.setContacts(ACCOUNT, [MOM]);
    await store.setAssistantAllowance(ACCOUNT, 'a-1');
    await telegram(post(message('Pay 5000 to Mom for rent')));
    expect(sent).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ text: expect.stringMatching(/10 seconds to stop it/) }),
    );
  });

  it('still answers when Telegram itself is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const response = await telegram(post(message('Pay 5000 to Mom')));
    expect(response.status).toBe(200);
  });

  it('acknowledges an empty update without touching the store', async () => {
    const response = await telegram(post({}));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true });
  });

  it('tells an unlinked chat to link first, and queues nothing', async () => {
    const response = await telegram(post(message('Pay 5000 to Mom')));
    expect((await body(response)).reason).toMatch(/link/i);
    expect(await getServerStore().getProposal(ACCOUNT)).toBeNull();
  });

  it('links a chat with a one-time code and refuses a spent or unknown code', async () => {
    await getServerStore().createLinkCode(ACCOUNT, 'ABC123');

    const linked = await telegram(post(message('/link ABC123')));
    expect(await body(linked)).toEqual({ ok: true, linked: true });

    const reused = await telegram(post(message('/link ABC123')));
    expect(await body(reused)).toMatchObject({ linked: false });

    const unknown = await telegram(post(message('/link NOPE', 999)));
    expect(await body(unknown)).toMatchObject({ linked: false });
  });

  it('queues a proposal for a linked chat, matched to that account’s contacts', async () => {
    const store = getServerStore();
    await store.createLinkCode(ACCOUNT, 'ABC123');
    await telegram(post(message('/link ABC123')));
    await store.setContacts(ACCOUNT, [MOM]);
    await store.setAssistantAllowance(ACCOUNT, 'allow-1');

    const response = await telegram(post(message('Pay 5000 to Mom for rent')));
    expect(await body(response)).toEqual({ ok: true, queued: true });

    const proposal = await store.getProposal(ACCOUNT);
    expect(proposal).toMatchObject({
      allowanceId: 'allow-1',
      contactId: MOM.id,
      amountMinor: 500_000,
      note: 'rent',
    });
    expect(proposal?.undoSeconds).toBeGreaterThan(0);
  });

  it('does not queue when no contact matches', async () => {
    const store = getServerStore();
    await store.createLinkCode(ACCOUNT, 'ABC123');
    await telegram(post(message('/link ABC123')));
    await store.setContacts(ACCOUNT, [MOM]);
    await store.setAssistantAllowance(ACCOUNT, 'allow-1');

    const response = await telegram(post(message('Pay 5000 to Chidi')));
    expect(await body(response)).toMatchObject({ parsed: { ok: false } });
    expect(await store.getProposal(ACCOUNT)).toBeNull();
  });

  it('does not queue when the account has no assistant allowance set up', async () => {
    const store = getServerStore();
    await store.createLinkCode(ACCOUNT, 'ABC123');
    await telegram(post(message('/link ABC123')));
    await store.setContacts(ACCOUNT, [MOM]);

    const response = await telegram(post(message('Pay 5000 to Mom')));
    expect((await body(response)).reason).toMatch(/allowance/i);
    expect(await store.getProposal(ACCOUNT)).toBeNull();
  });
});
