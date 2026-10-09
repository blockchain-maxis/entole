import { parseTelegramMessageWithAssistant } from '@entole/core/telegram-intake';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { tryGetServerStore } from '@/lib/server/store';
import { hasTelegramSecret, sendTelegramMessage } from '@/lib/server/telegram';

const updateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number() }).optional(),
    })
    .optional(),
});

/**
 * The thin intake adapter from docs/SCOPE.md's business layer: a Telegram
 * message becomes the same proposal shape the app's own assistant flow
 * produces, then the same undo window runs before anything settles. Nothing
 * here gets a shortcut past it.
 *
 * Both halves now run. Parsing goes through `parseTelegramMessageWithAssistant`
 * — the deterministic grammar first, Qwen only for what it can't parse, and
 * only when `QWEN_API_KEY` is set (server-side only, same rule as
 * `TELEGRAM_BOT_TOKEN`). The result is written to the sender's account inbox in
 * `lib/server/store.ts`, ready for that account's app to pick up and run its
 * own undo-window UI. The store is convenience, not authority: a proposal
 * written here is not a payment. It still runs the undo window and the signed
 * on-chain call the allowance already permits.
 *
 * Telegram is only believed when it proves itself: the request must carry the
 * `secret_token` registered with `setWebhook` (`TELEGRAM_WEBHOOK_SECRET`, set
 * by `scripts/set-telegram-webhook.mjs`). Every outcome is also said back to
 * the chat with `sendMessage`, in plain words.
 *
 * A chat is matched to an account by a one-time code the user generates in-app
 * and sends here as `/link CODE`. Until a chat is linked, every message reads
 * as "link your account first", which is the correct, safe failure mode: an
 * unlinked chat can move nothing and cannot see anyone's contacts.
 */
export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are not configured. See this file’s header comment.',
      },
      { status: 501 },
    );
  }

  if (!hasTelegramSecret(request, secret)) {
    return NextResponse.json({ ok: false, reason: 'Not from Telegram.' }, { status: 401 });
  }

  const store = tryGetServerStore();
  if (!store) {
    return NextResponse.json({ ok: false, reason: 'The server store is not configured.' }, { status: 501 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'Bad request.' }, { status: 400 });
  }
  const update = updateSchema.safeParse(raw);
  if (!update.success) return NextResponse.json({ ok: false, reason: 'Bad request.' }, { status: 400 });

  const text = update.data.message?.text?.trim();
  const chatId = update.data.message?.chat?.id;
  if (!text || typeof chatId !== 'number') return NextResponse.json({ ok: true });

  const reply = (message: string) => sendTelegramMessage(token, chatId, message);

  const linkMatch = text.match(/^\/link\s+(\S+)/i);
  if (linkMatch?.[1]) {
    const accountId = await store.linkChat(linkMatch[1], chatId);
    if (accountId) {
      await reply('Linked. Message me a payment like "Pay 5000 to Mom for rent".');
      return NextResponse.json({ ok: true, linked: true });
    }
    const reason = 'That code is not valid or has already been used.';
    await reply(reason);
    return NextResponse.json({ ok: true, linked: false, reason });
  }

  const accountId = await store.accountForChat(chatId);
  if (!accountId) {
    const reason = 'Link this chat to your account first. Send /link followed by the code from the app.';
    await reply(reason);
    return NextResponse.json({ ok: true, reason });
  }

  const contacts = await store.contactsFor(accountId);
  const qwenApiKey = process.env.QWEN_API_KEY;
  const parsed = await parseTelegramMessageWithAssistant(
    text,
    contacts,
    qwenApiKey ? { apiKey: qwenApiKey } : undefined,
  );

  if (!parsed.ok) {
    await reply(parsed.reason);
    return NextResponse.json({ ok: true, parsed });
  }

  const allowanceId = await store.assistantAllowanceFor(accountId);
  if (!allowanceId) {
    const reason = 'No assistant allowance is set up for this account yet.';
    await reply(`${reason} Create one in the app first.`);
    return NextResponse.json({ ok: true, reason });
  }

  await store.putProposal(accountId, {
    id: `tg-${Date.now()}`,
    allowanceId,
    contactId: parsed.contactId,
    amountMinor: parsed.amountMinor,
    note: parsed.note,
    undoSeconds: 10,
  });

  await reply('Got it. Open Entole to review it. You will have 10 seconds to stop it.');
  return NextResponse.json({ ok: true, queued: true });
}
