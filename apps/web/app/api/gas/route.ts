import { getAddress, isAddress, parseEther, type Address } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { getSponsor, rateLimit, sendSerially } from '@/lib/server/sponsor';

/**
 * Covers the network fee for the few things a person does *from their own
 * account* rather than through a signed payment — pausing the assistant,
 * creating or revoking an allowance, saving. Sends themselves never come here:
 * they are signed once and paid for by `/api/relay`.
 *
 * If the account is already comfortably funded this does nothing. Otherwise it
 * sends a small amount, once per request, rate-limited per caller. It is a test
 * network faucet: a production build would use account abstraction instead.
 */
export const runtime = 'nodejs';

/** Enough for dozens of the account's own transactions. */
const TOP_UP = parseEther('0.1');
/** At or above this the account needs nothing. */
const ENOUGH = parseEther('0.05');
/** The sponsor keeps this much back so payments through the relay keep landing. */
const SPONSOR_RESERVE = parseEther('0.5');
const LIMIT_PER_MINUTE = 5;

const bodySchema = z.object({
  address: z
    .string()
    .refine((value) => isAddress(value, { strict: false }))
    .transform((value): Address => getAddress(value)),
});

export async function POST(request: Request) {
  const sponsor = getSponsor();
  if (!sponsor) return json({ error: 'not_configured' }, 501);

  const limit = rateLimit(request, 'gas', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const to = parsed.data.address;

  try {
    const { publicClient, walletClient, account } = sponsor;
    const [balance, sponsorBalance] = await Promise.all([
      publicClient.getBalance({ address: to }),
      publicClient.getBalance({ address: account.address }),
    ]);
    if (balance >= ENOUGH) return json({ funded: true });
    if (sponsorBalance < SPONSOR_RESERVE + TOP_UP) return json({ error: 'sponsor_low' }, 503);

    const hash = await sendSerially(() => walletClient.sendTransaction({ to, value: TOP_UP }));
    return json({ funded: false, hash });
  } catch {
    return json({ error: 'send_failed' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
