import { creReleaseRequestSchema } from '@entole/core/chainlink-cre';
import { releaseConditionalInvoice } from '@entole/core/gateway';
import { NextResponse } from 'next/server';

import { getServerStore } from '@/lib/server/store';

/**
 * The callback target for a real Chainlink CRE workflow watching the FX
 * condition on a `'pending-release'` invoice — see
 * `packages/core/chainlink-cre.ts`'s header for the full design.
 *
 * Both halves now run. The route still re-checks the condition itself rather
 * than trusting the caller's claim — that check is in
 * `releaseConditionalInvoice`, shared with `demoGateway` so the webhook and the
 * in-app "Check condition" button apply one identical rule. When the condition
 * holds, it looks the invoice up in `lib/server/store.ts` and applies the same
 * released-invoice-plus-tax-reserve transition the gateway performs, then
 * persists it. The store is convenience, not authority: releasing an invoice
 * marks a record paid, it does not itself move money the allowance did not
 * already permit.
 */
export async function POST(request: Request) {
  const secret = process.env.CHAINLINK_CRE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, reason: 'CHAINLINK_CRE_WEBHOOK_SECRET is not configured. See this file’s header comment.' },
      { status: 501 },
    );
  }

  if (request.headers.get('x-cre-webhook-secret') !== secret) {
    return NextResponse.json({ ok: false, reason: 'Invalid webhook secret.' }, { status: 401 });
  }

  const payload = creReleaseRequestSchema.parse(await request.json());
  const store = getServerStore();

  const found = await store.findPendingReleaseInvoice(payload.invoiceId);
  if (!found) {
    return NextResponse.json(
      { ok: false, reason: 'No pending-release invoice with that id.' },
      { status: 404 },
    );
  }

  const released = releaseConditionalInvoice(found.invoice, {
    koboPerDollar: payload.observedKoboPerDollar,
    quotedAt: new Date().toISOString(),
  });
  if (!released) {
    return NextResponse.json({ ok: true, invoiceId: payload.invoiceId, conditionMet: false });
  }

  await store.replaceInvoice(found.accountId, released.invoice);
  return NextResponse.json({ ok: true, invoiceId: payload.invoiceId, conditionMet: true });
}

