import type { Contact } from '@entole/core/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

function post(body: unknown) {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function message(text: string, chatId = 555) {
  return { message: { text, chat: { id: chatId } } };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetServerStore();
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  delete process.env.QWEN_API_KEY;
});

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('POST /api/telegram/webhook', () => {
  it('answers 501 when no bot token is configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const response = await telegram(post(message('Pay 5000 to Mom')));
    expect(response.status).toBe(501);
    expect((await body(response)).ok).toBe(false);
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
