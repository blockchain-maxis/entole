import { RateUnavailableError, createRateProvider } from '@entole/core/fx';
import { ONRAMP_CHAIN_ID, ONRAMP_MONEY_PUBLIC_APP_ID, OnrampError, startBankTransfer } from '@entole/core/onramp';
import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Adding real money by bank transfer. Prices the transfer and answers with a
 * link to the payment partner's page; nothing moves until the person pays
 * there, and the balance only changes once the money has arrived.
 *
 * The partner pays out to a holding address that converts into the account's
 * own money (see `packages/core/onramp.ts`). That address is inside `url` and
 * nowhere else in the answer: no screen has anything to print.
 *
 * Off (501) unless the app runs on the main network and both
 * `ONRAMP_REFUND_ADDRESS` and our own `ONRAMP_MONEY_APP_ID` are set. The
 * partner's public app id will not do: seen in a browser on 10 October 2026,
 * its page ignores the address passed in and asks the person to type one,
 * which is exactly what this flow exists to avoid.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 5;
/** ₦5,000,000. The partner's own limits are lower; this only bounds the input. */
const MAX_PAY_KOBO = 500_000_000;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const bodySchema = z.object({
  address,
  amountMinor: z.number().int().positive().max(MAX_PAY_KOBO),
});

/** One rate cache for the route, the same feed the apps price a balance with. */
const getRate = createRateProvider();

type Config = { settlementToken: Address; refundTo: Address; appId: string; apiKey?: string };

/** Read per call, so nothing is captured at build time. */
function readConfig(): Config | null {
  if (Number(process.env.NEXT_PUBLIC_CHAIN_ID) !== ONRAMP_CHAIN_ID) return null;
  const refundTo = address.safeParse(process.env.ONRAMP_REFUND_ADDRESS?.trim());
  const settlementToken = address.safeParse(process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS?.trim());
  if (!refundTo.success || !settlementToken.success) return null;
  const appId = process.env.ONRAMP_MONEY_APP_ID?.trim();
  if (!appId || appId === ONRAMP_MONEY_PUBLIC_APP_ID) return null;
  const apiKey = process.env.RELAY_API_KEY?.trim();
  return {
    settlementToken: settlementToken.data,
    refundTo: refundTo.data,
    appId,
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Where the partner sends the person afterwards. Always this deployment. */
function returnUrl(request: Request): string {
  const origin = process.env.ONRAMP_RETURN_ORIGIN?.trim() || new URL(request.url).origin;
  return `${origin.replace(/\/$/, '')}/add-money/return`;
}

export async function POST(request: Request) {
  const config = readConfig();
  if (!config) return json({ error: 'not_configured' }, 501);

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { address: recipient, amountMinor } = parsed.data;

  const limit = await rateLimit(request, 'onramp', LIMIT_PER_MINUTE, recipient);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  try {
    const rate = await getRate();
    const offer = await startBankTransfer(
      {
        recipient,
        payKobo: amountMinor,
        koboPerDollar: rate.koboPerDollar,
        reference: `add-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
        returnUrl: returnUrl(request),
      },
      config,
    );
    return json(offer);
  } catch (error) {
    if (error instanceof OnrampError) {
      return json({ error: error.code }, error.code === 'amount_too_small' ? 422 : 502);
    }
    if (error instanceof RateUnavailableError) return json({ error: 'rate_unavailable' }, 503);
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
