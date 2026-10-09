import { timingSafeEqual } from 'node:crypto';

/**
 * What the Telegram webhook needs besides parsing: proving a request really
 * came from Telegram, and talking back. Server-only, same rule as `sponsor.ts`.
 */

/** Constant-time string compare, so a secret is not guessable from timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True when the request carries the secret registered with Telegram's
 * `setWebhook`. Without this anyone could POST a fake update and bind a chat. */
export function hasTelegramSecret(request: Request, secret: string): boolean {
  const sent = request.headers.get('x-telegram-bot-api-secret-token');
  return Boolean(sent) && safeEqual(sent!, secret);
}

/** Sends a plain text reply into the chat. Best-effort: the webhook has
 * already done its work, so a failed reply is dropped rather than retried by
 * Telegram redelivering the whole update. */
export async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Dropped on purpose.
  }
}
