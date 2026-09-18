import { creReleaseRequestSchema, evaluateReleaseCondition } from '@entole/core/chainlink-cre';
import { NextResponse } from 'next/server';

/**
 * The callback target for a real Chainlink CRE workflow watching the FX
 * condition on a `'pending-release'` invoice — see
 * `packages/core/chainlink-cre.ts`'s header for the full design.
 *
 * What this route cannot do yet, honestly, same gap as
 * `apps/web/app/api/telegram/webhook/route.ts`: this demo's store is
 * client-side React state with no server-side persistence, so there is no
 * specific user's live invoice list to reach into and update from here. This
 * route proves the validate-and-evaluate half end to end — it re-checks the
 * condition itself rather than trusting the caller's claim — but the actual
 * release still has to happen from the signed-in user's own app via
 * `useStore().requestConditionalRelease`, exactly as the in-app "Check
 * condition" button already does today. Wiring a persisted backend so this
 * route can call that on someone's behalf is a deploy-config and
 * persistence change, not a rewrite of the condition logic itself.
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
  const conditionMet = evaluateReleaseCondition(
    { type: 'fx-rate-at-or-below', maxKoboPerDollar: payload.maxKoboPerDollar },
    { koboPerDollar: payload.observedKoboPerDollar, quotedAt: new Date().toISOString() },
  );

  return NextResponse.json({ ok: true, invoiceId: payload.invoiceId, conditionMet });
}
