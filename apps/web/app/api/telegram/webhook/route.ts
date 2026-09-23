import { parseTelegramMessageWithAssistant } from '@entole/core/telegram-intake';
import { NextResponse } from 'next/server';

import { getServerStore } from '@/lib/server/store';

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
 * A chat is matched to an account by a one-time code the user generates in-app
 * and sends here as `/link CODE`. Until a chat is linked, every message reads
 * as "link your account first", which is the correct, safe failure mode: an
 * unlinked chat can move nothing and cannot see anyone's contacts.
 */
export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { ok: false, reason: 'TELEGRAM_BOT_TOKEN is not configured. See this file’s header comment.' },
      { status: 501 },
    );
  }

  const update = (await request.json()) as { message?: { text?: string; chat?: { id?: number } } };
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  if (!text || typeof chatId !== 'number') return NextResponse.json({ ok: true });

  const store = getServerStore();

  const linkMatch = text.match(/^\/link\s+(\S+)/i);
  if (linkMatch?.[1]) {
    const accountId = await store.linkChat(linkMatch[1], chatId);
    return NextResponse.json(
      accountId
        ? { ok: true, linked: true }
        : { ok: true, linked: false, reason: 'That code is not valid or has already been used.' },
    );
  }

  const accountId = await store.accountForChat(chatId);
  if (!accountId) {
    return NextResponse.json({
      ok: true,
      reason: 'Link this chat to your account first — send /link followed by the code from the app.',
    });
  }

  const contacts = await store.contactsFor(accountId);
  const qwenApiKey = process.env.QWEN_API_KEY;
  const parsed = await parseTelegramMessageWithAssistant(
    text,
    contacts,
    qwenApiKey ? { apiKey: qwenApiKey } : undefined,
  );

  if (!parsed.ok) return NextResponse.json({ ok: true, parsed });

  const allowanceId = await store.assistantAllowanceFor(accountId);
  if (!allowanceId) {
    return NextResponse.json({
      ok: true,
      reason: 'No assistant allowance is set up for this account yet.',
    });
  }

  await store.putProposal(accountId, {
    id: `tg-${Date.now()}`,
    allowanceId,
    contactId: parsed.contactId,
    amountMinor: parsed.amountMinor,
    note: parsed.note,
    undoSeconds: 10,
  });

  return NextResponse.json({ ok: true, queued: true });
}
