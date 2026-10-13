import { getAddress, isAddress, parseEther, type Address } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { dailyBudget, getSponsor, onTestNetwork, rateLimit, sendSerially } from '@/lib/server/sponsor';

/**
 * Covers the network fee for the few things a person does *from their own
 * account* rather than through a signed payment — pausing the assistant,
 * creating or revoking an allowance, saving. Sends themselves never come here:
 * they are signed once and paid for by `/api/relay`.
 *
 * If the account is already comfortably funded this does nothing. Otherwise it
 * sends a small amount, once per request, rate-limited per caller.
 *
 * It asks for no proof of who is calling, so it is for the test network only
 * and answers 404 anywhere else: on a network where the fee money is worth
 * something, this has to become account abstraction, not an open tap. Even
 * here it is bounded, because an empty sponsor stops every payment: a few
 * top-ups a day for one account, and a fixed number a day for everyone.
 */
export const runtime = 'nodejs';

/** Enough for dozens of the account's own transactions. */
const TOP_UP = parseEther('0.1');
/** At or above this the account needs nothing. */
const ENOUGH = parseEther('0.05');
/** The sponsor keeps this much back so payments through the relay keep landing. */
const SPONSOR_RESERVE = parseEther('0.5');
const LIMIT_PER_MINUTE = 5;
/** Per receiving address, so rotating IPs cannot keep refilling one account. */
const ADDRESS_LIMIT_PER_MINUTE = 2;
/** One top-up covers dozens of the account's own actions. */
const TOP_UPS_PER_ADDRESS_PER_DAY = 3;
const DEFAULT_TOP_UPS_PER_DAY = 500;

/** Top-ups in a day, for everyone together. `SPONSOR_DAILY_TOP_UPS` overrides it. */
function topUpsPerDay(): number {
  const configured = process.env.SPONSOR_DAILY_TOP_UPS?.trim();
  return configured && /^\d{1,9}$/.test(configured) ? Number(configured) : DEFAULT_TOP_UPS_PER_DAY;
}

const bodySchema = z.object({
  address: z
    .string()
    .refine((value) => isAddress(value, { strict: false }))
    .transform((value): Address => getAddress(value)),
});

export async function POST(request: Request) {
  if (!onTestNetwork()) return json({ error: 'not_found' }, 404);
  const sponsor = getSponsor();
  if (!sponsor) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'gas', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const to = parsed.data.address;

  const addressLimit = await rateLimit(request, 'gas-address', ADDRESS_LIMIT_PER_MINUTE, to);
  if (!addressLimit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: addressLimit.retryAfterSeconds }, 429, {
      'Retry-After': String(addressLimit.retryAfterSeconds),
    });
  }

  try {
    const { publicClient, walletClient, account } = sponsor;
    const [balance, sponsorBalance] = await Promise.all([
      publicClient.getBalance({ address: to }),
      publicClient.getBalance({ address: account.address }),
    ]);
    if (balance >= ENOUGH) return json({ funded: true });
    if (sponsorBalance < SPONSOR_RESERVE + TOP_UP) return json({ error: 'sponsor_low' }, 503);

    // Counted only now, when a top-up is really about to be sent: this
    // account's own count first, so an account past its share does not use up
    // everyone's.
    let budget = await dailyBudget('gas-each', TOP_UPS_PER_ADDRESS_PER_DAY, to);
    if (budget.ok) budget = await dailyBudget('gas', topUpsPerDay());
    if (!budget.ok) {
      return json({ error: 'rate_limited', retryAfterSeconds: budget.retryAfterSeconds }, 429, {
        'Retry-After': String(budget.retryAfterSeconds),
      });
    }

    const hash = await sendSerially(() => walletClient.sendTransaction({ to, value: TOP_UP }));
    return json({ funded: false, hash });
  } catch {
    return json({ error: 'send_failed' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
