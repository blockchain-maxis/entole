import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import { buildInboxMessage, INBOX_MAX_AGE_SECONDS } from '@entole/core/assistant-inbox';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';
import { getServerStore } from '@/lib/server/store';

/**
 * The assistant's proposal inbox — the account side of the Telegram intake
 * flow. A proposal parsed by `api/telegram/webhook` is written to the sender's
 * inbox in `lib/server/store.ts`; this reads it back into that account's app,
 * where the existing undo window runs before anything settles. The store is
 * convenience, not authority: a proposal read here is not a payment.
 *
 * Every action carries a signature proving control of the account, because a
 * pending proposal is private — it names a recipient, an amount and a note.
 * That is the difference from `api/directory`, whose reads are deliberately
 * open. The account id is the owner address, lowercased.
 *
 *   read   returns the pending proposal (or null)
 *   clear  drops it, once the app has run or cancelled it
 *   link   registers a one-time code the user sends the bot as `/link CODE`
 */
export const runtime = 'nodejs';

const INBOX_LIMIT_PER_MINUTE = 60;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const requestSchema = z.object({
  account: address,
  action: z.enum(['read', 'clear', 'link']),
  timestampSeconds: z.number().int().positive(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((value) => value as `0x${string}`),
  /** Only for `link`: the one-time code the user will send the bot. */
  code: z.string().trim().min(4).max(64).optional(),
});

export async function POST(request: Request) {
  const limit = rateLimit(request, 'assistant-inbox', INBOX_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { account, action, timestampSeconds, signature, code } = parsed.data;

  if (action === 'link' && !code) return json({ error: 'bad_request' }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > INBOX_MAX_AGE_SECONDS) return json({ error: 'stale' }, 422);

  const message = buildInboxMessage({ account, action, timestampSeconds });
  const valid = await verifyMessage({ address: account, message, signature }).catch(() => false);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  const store = getServerStore();
  const accountId = account.toLowerCase();

  if (action === 'clear') {
    await store.clearProposal(accountId);
    return json({ ok: true });
  }

  if (action === 'link') {
    await store.createLinkCode(accountId, code!);
    return json({ ok: true });
  }

  const proposal = await store.getProposal(accountId);
  return json({ proposal: proposal ?? null });
}

export function OPTIONS() {
  return preflight();
}
