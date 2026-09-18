import { parseTelegramMessageWithAssistant } from '@entole/core/telegram-intake';
import { NextResponse } from 'next/server';

/**
 * The thin intake adapter from docs/SCOPE.md's business layer: a Telegram
 * message becomes the same proposal shape the app's own assistant flow
 * produces, then the same undo window runs before anything settles. Nothing
 * here gets a shortcut past it.
 *
 * What this route cannot do yet, honestly: this demo's store is client-side
 * React state (`packages/core/store.tsx`) with no server-side persistence —
 * the same gap every other mocked-behind-an-interface piece in this
 * codebase has (see docs/ARCHITECTURE.md on Agora, Aurora Intents, Envio).
 * A real deployment needs somewhere server-side to write the resulting
 * proposal so the phone/web app can pick it up and run its own undo-window
 * UI, plus a way to map a Telegram chat id to an Entole account. Neither
 * exists here. This route proves the parsing half end to end; wiring the
 * other half is a deploy-config and persistence change, not a rewrite of
 * `parseTelegramMessage` itself.
 *
 * Parsing itself goes through `parseTelegramMessageWithAssistant` — the
 * deterministic grammar first, Qwen only for what it can't parse, and only
 * when `QWEN_API_KEY` is set (server-side only, same rule as
 * `TELEGRAM_BOT_TOKEN`). Unset, this route behaves exactly as it did before
 * the assistant layer existed.
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
  const text = update.message?.text;
  if (!text) return NextResponse.json({ ok: true });

  // A real deployment resolves the sender's own contact list from
  // update.message.chat.id here. Until chat linking exists, this proves the
  // grammar against an empty book — every message will read as "no contact
  // matches," which is the correct, safe failure mode for an unlinked chat.
  const qwenApiKey = process.env.QWEN_API_KEY;
  const parsed = await parseTelegramMessageWithAssistant(text, [], qwenApiKey ? { apiKey: qwenApiKey } : undefined);

  return NextResponse.json({ ok: true, parsed });
}
