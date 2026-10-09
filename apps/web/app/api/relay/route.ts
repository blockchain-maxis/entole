import { json, preflight, readJson } from '@/lib/server/http';
import { paymentRevertCode, paymentSchema, routerAbi } from '@/lib/server/payment-schema';
import {
  RELAY_LIMIT_PER_MINUTE,
  getRouterAddress,
  getSponsor,
  rateLimit,
  sendSerially,
  sponsorIsLow,
} from '@/lib/server/sponsor';

/**
 * Submits a payment the payer already signed. The payer's one ERC-3009
 * authorization is made on their device; this route only pays the network fee
 * for `EntoleRouter.pay` from the sponsor account, so it can move nothing the
 * signature does not cover (see contracts/src/EntoleRouter.sol). Answers as
 * soon as the send is accepted — the caller watches for the receipt itself.
 */
export const runtime = 'nodejs';

/** 1 AUSD, in minor units (6 decimals). */
const MIN_AMOUNT = 1_000_000n;
const DEFAULT_MAX_AMOUNT = 10_000_000_000n;
/** How far ahead a signed authorization may expire. */
const MAX_WINDOW_SECONDS = 3600n;

const bodySchema = paymentSchema;

function maxAmount(): bigint {
  const configured = process.env.RELAY_MAX_AMOUNT?.trim();
  return configured && /^\d{1,78}$/.test(configured) ? BigInt(configured) : DEFAULT_MAX_AMOUNT;
}

export async function POST(request: Request) {
  const sponsor = getSponsor();
  const router = getRouterAddress();
  if (!sponsor || !router) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'relay', RELAY_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { from, recipient, amount, validAfter, validBefore, salt, v, r, s } = parsed.data;

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validBefore <= now || validBefore > now + MAX_WINDOW_SECONDS) {
    return json({ error: 'bad_window' }, 422);
  }
  if (amount < MIN_AMOUNT || amount > maxAmount()) {
    return json({ error: 'amount_out_of_range' }, 422);
  }

  let simulated;
  try {
    simulated = await sponsor.publicClient.simulateContract({
      account: sponsor.account,
      address: router,
      abi: routerAbi,
      functionName: 'pay',
      args: [from, recipient, amount, validAfter, validBefore, salt, v, r, s],
    });
  } catch (error) {
    return json({ error: paymentRevertCode(error) }, 422);
  }

  try {
    if (await sponsorIsLow(sponsor)) return json({ error: 'sponsor_low' }, 503);
    const hash = await sendSerially(() => sponsor.walletClient.writeContract(simulated.request));
    return json({ hash });
  } catch {
    return json({ error: 'send_failed' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
