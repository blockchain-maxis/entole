import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import { createRateProvider, type Rate } from '@entole/core/fx';
import { buildFeedMessage, FEED_MAX_AGE_SECONDS, PAYMENT_NOTE_MAX } from '@entole/core/payments-feed';

import { getByAddress } from '@/lib/server/directory';
import { json, preflight, readJson } from '@/lib/server/http';
import {
  listReceived,
  paymentsConfigured,
  readSettledPayment,
  recordReceived,
  settledNaira,
} from '@/lib/server/payments';
import { getChainReader, getRouterAddress, rateLimit, TOKEN_ADDRESS, TOKEN_DECIMALS } from '@/lib/server/sponsor';

/**
 * Money that arrived, kept for the person it was sent to.
 *
 *   record  the sender's app says a payment of theirs has settled. The payment
 *           is read back from the network, and what the network says is what
 *           is kept: that it settled, who it went to, how much arrived, when.
 *           The request only adds the sender's note and the naira figure they
 *           typed.
 *   list    what has arrived for this account, for its own app to show.
 *
 * Both carry a signature proving control of the account. A list is private:
 * it has names, amounts and notes in it. A record is signed so that only the
 * person who paid can put words on their own payment.
 */
export const runtime = 'nodejs';

const FEED_LIMIT_PER_MINUTE = 60;

/** One rate provider for the route, so reports arriving together share a lookup. */
const getRate = createRateProvider();

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const requestSchema = z.object({
  account: address,
  action: z.enum(['record', 'list']),
  timestampSeconds: z.number().int().positive(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((value) => value as `0x${string}`),
  /** Only for `record`: which payment. */
  hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
  /** Only for `record`: the sender's own words. */
  note: z.string().trim().min(1).max(PAYMENT_NOTE_MAX).optional(),
  /** Only for `record`: the naira the sender typed, in kobo, and the rate it was shown at. */
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  koboPerDollar: z.number().int().positive().optional(),
});

/** Control characters and direction overrides have no place in a note someone else will read. */
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export async function POST(request: Request) {
  if (!paymentsConfigured()) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'payments', FEED_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { account, action, timestampSeconds, signature, hash, note, amountMinor, koboPerDollar } = parsed.data;
  if (action === 'record' && !hash) return json({ error: 'bad_request' }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > FEED_MAX_AGE_SECONDS) return json({ error: 'stale' }, 422);

  const message = buildFeedMessage({
    account,
    action,
    ...(action === 'record' && hash ? { hash } : {}),
    timestampSeconds,
  });
  const valid = await verifyMessage({ address: account, message, signature }).catch(() => false);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  if (action === 'list') return json({ payments: await listReceived(account) });

  // What happened is read from the network, not taken from the request.
  const chain = getChainReader();
  const receipt = await chain.getTransactionReceipt({ hash: hash! }).catch(() => null);
  if (!receipt) return json({ error: 'not_found' }, 404);
  if (receipt.status !== 'success') return json({ error: 'not_settled' }, 422);

  const paid = readSettledPayment(receipt.logs, {
    payer: account,
    router: getRouterAddress(),
    token: TOKEN_ADDRESS,
  });
  if (!paid) return json({ error: 'not_a_payment' }, 422);

  const [block, sender, recipient, rate] = await Promise.all([
    chain.getBlock({ blockNumber: receipt.blockNumber }),
    getByAddress(account).catch(() => null),
    getByAddress(paid.recipient).catch(() => null),
    getRate().catch((): Rate | null => null),
  ]);

  const naira = settledNaira({
    amountToken: paid.amountToken,
    tokenDecimals: TOKEN_DECIMALS,
    rate,
    stated: amountMinor !== undefined && koboPerDollar !== undefined ? { amountMinor, koboPerDollar } : undefined,
  });
  const words = note?.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();

  await recordReceived({
    hash: hash!,
    from: account,
    ...(sender?.name ? { fromName: sender.name.slice(0, 60) } : {}),
    ...(sender?.username ? { fromUsername: sender.username } : {}),
    to: paid.recipient,
    ...(recipient?.name ? { toName: recipient.name.slice(0, 60) } : {}),
    ...(recipient?.username ? { toUsername: recipient.username } : {}),
    amountToken: paid.amountToken.toString(),
    ...(naira !== undefined ? { amountMinor: naira } : {}),
    at: new Date(Number(block.timestamp) * 1000).toISOString(),
    ...(words ? { note: words } : {}),
  });

  return json({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
