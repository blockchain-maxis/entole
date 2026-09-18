import { z } from 'zod';

import type { Rate } from './fx';
import type { ReleaseCondition } from './schemas';

/**
 * Chainlink CRE bounty claim (docs/SCOPE.md: "Chainlink CRE | $3,000 |
 * Condition-gated payment workflow"; docs/ARCHITECTURE.md's #1-priority
 * optional integration: "gate a payment release on an off-chain condition
 * (FX threshold, compliance check) before it executes").
 *
 * The condition chosen: an FX-rate threshold on an invoice's release
 * (`releaseConditionSchema` in schemas.ts), not a payment webhook — this
 * repo has no payment processor to receive a real "invoice paid" webhook
 * from, so an FX threshold is the simplest condition that is genuinely
 * checkable rather than faked, while still matching docs/ARCHITECTURE.md's
 * own example verbatim.
 *
 * How this is genuinely wired, and what still needs a real account:
 *
 * `evaluateReleaseCondition` below is the exact off-chain check a live
 * Chainlink CRE workflow would run — subscribe to an FX data feed, evaluate
 * this same condition on every update, and once true, call back into the
 * app. `requestConditionalRelease` on `PaymentsGateway`
 * (`packages/core/gateway.ts`) is that callback target: it re-runs this
 * check itself rather than trusting a caller's "it's true" claim, then only
 * releases if it agrees — the same "never guess, never trust an
 * unvalidated assertion" posture as the rest of this codebase.
 *
 * Two pieces require the user's own Chainlink CRE account (self-serve at
 * https://cre.chain.link, not something this environment can create): (1)
 * registering a real workflow that watches an FX feed and POSTs to
 * `apps/web/app/api/chainlink-cre/release/route.ts` once the condition
 * looks true from its side, and (2) that route currently can only
 * re-validate the payload and report the result — it cannot yet mutate a
 * specific user's live invoice, because this demo's store is client-side
 * React state with no server-side persistence (the exact same gap
 * `apps/web/app/api/telegram/webhook/route.ts`'s header already discloses
 * for the Telegram intake). Until a real backend exists, the genuinely
 * live release path is the in-app "Check condition" action, which calls
 * `requestConditionalRelease` directly from a signed-in user's own store —
 * that one is real today, no account needed.
 */

/** The payload a real CRE workflow's callback would POST once it believes
 * the condition holds. Carries both the raw observed rate and the
 * threshold the workflow was registered against — the endpoint recomputes
 * `evaluateReleaseCondition` from these two numbers itself rather than
 * trusting the workflow's own verdict, so a compromised or misconfigured
 * caller can only lie about its inputs, not about the arithmetic. */
export const creReleaseRequestSchema = z.object({
  invoiceId: z.string().min(1),
  observedKoboPerDollar: z.number().int().positive(),
  maxKoboPerDollar: z.number().int().positive(),
});

export type CreReleaseRequest = z.infer<typeof creReleaseRequestSchema>;

/** Pure and testable on purpose — this is the actual gate, not a stand-in
 * for one. Both the in-app "Check condition" button and (once wired) a real
 * CRE workflow's callback run this exact function. */
export function evaluateReleaseCondition(condition: ReleaseCondition, observedRate: Rate): boolean {
  return observedRate.koboPerDollar <= condition.maxKoboPerDollar;
}
