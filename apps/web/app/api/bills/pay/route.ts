import { payBill } from '@entole/core/bill-payment';
import { toDollars } from '@entole/core/fx';
import { kobo } from '@entole/core/money';
import { z } from 'zod';

import { getBillsConfig, getServerRate } from '@/lib/server/bills';
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
 * Pays a bill from the person's own balance, in this order and no other:
 *
 *   1. the payment the person signed is checked: it must go to the bills
 *      account and cover this bill at the live rate (a small band either way,
 *      for the rate moving while they typed);
 *   2. it is relayed and must settle on the network;
 *   3. only then is the biller paid.
 *
 * So no bill is ever paid from the business's own balance, and nothing is paid
 * to the biller before the person's payment has settled. A payment signed once
 * can be relayed once (its nonce is single-use), so a replay pays nothing.
 *
 * If the biller refuses after the person's payment settled, the answer is
 * `bill_failed` with the payment's hash, and the line below is logged so the
 * payment can be returned. There is no automatic refund yet (docs/BACKLOG.md).
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

/** The payment may cover the bill within this band of the amount the live rate asks for. */
const LOW_NUM = 99n;
const HIGH_NUM = 105n;
const MAX_WINDOW_SECONDS = 3600n;
/** AUSD has 6 decimals; dollar cents have 2. */
const MINOR_PER_CENT = 10_000n;

const bodySchema = z.object({
  payment: paymentSchema,
  bill: z.object({
    category: z.enum(['electricity', 'airtime-data', 'cable-tv', 'internet']),
    customerIdentifier: z.string().trim().min(3).max(40),
    amountMinor: z.number().int().positive().max(500_000_000),
  }),
});

export async function POST(request: Request) {
  const sponsor = getSponsor();
  const router = getRouterAddress();
  const config = getBillsConfig();
  if (!sponsor || !router || !config) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'bills-pay', RELAY_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { payment, bill } = parsed.data;

  const itemCode = config.itemCodes[bill.category];
  if (!itemCode) return json({ error: 'not_configured' }, 501);

  if (payment.recipient.toLowerCase() !== config.recipient.toLowerCase()) {
    return json({ error: 'amount_mismatch' }, 422);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (payment.validBefore <= now || payment.validBefore > now + MAX_WINDOW_SECONDS) {
    return json({ error: 'bad_window' }, 422);
  }

  let expected: bigint;
  try {
    const rate = await getServerRate();
    expected = BigInt(toDollars(kobo(bill.amountMinor), rate)) * MINOR_PER_CENT;
  } catch {
    return json({ error: 'rate_unavailable' }, 503);
  }
  if (payment.amount * 100n < expected * LOW_NUM || payment.amount * 100n > expected * HIGH_NUM) {
    return json({ error: 'amount_mismatch' }, 422);
  }

  let simulated;
  try {
    simulated = await sponsor.publicClient.simulateContract({
      account: sponsor.account,
      address: router,
      abi: routerAbi,
      functionName: 'pay',
      args: [
        payment.from,
        payment.recipient,
        payment.amount,
        payment.validAfter,
        payment.validBefore,
        payment.salt,
        payment.v,
        payment.r,
        payment.s,
      ],
    });
  } catch (error) {
    return json({ error: paymentRevertCode(error) }, 422);
  }

  let hash: `0x${string}`;
  try {
    if (await sponsorIsLow(sponsor)) return json({ error: 'sponsor_low' }, 503);
    hash = await sendSerially(() => sponsor.walletClient.writeContract(simulated.request));
    const settled = await sponsor.publicClient.waitForTransactionReceipt({ hash });
    if (settled.status !== 'success') return json({ error: 'rejected' }, 422);
  } catch {
    return json({ error: 'send_failed' }, 502);
  }

  // The person's payment has settled. Now, and only now, the biller.
  try {
    const paid = await payBill(
      {
        category: bill.category,
        customerIdentifier: bill.customerIdentifier,
        itemCode,
        amountMinor: bill.amountMinor,
        reference: `bill-${hash.slice(2, 18)}`,
      },
      config.biller,
    );
    if (paid.status === 'failed') throw new Error('biller refused');
    return json({ status: paid.status, reference: paid.reference, hash });
  } catch {
    console.error(
      `[bills] paid-not-billed hash=${hash} category=${bill.category} amountMinor=${bill.amountMinor}: return this payment`,
    );
    return json({ error: 'bill_failed', hash }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
