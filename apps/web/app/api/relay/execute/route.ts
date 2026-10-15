import { getAddress, isAddress, parseAbi, type Address, type Hex } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { policyRevertCode } from '@/lib/server/policy-revert';
import {
  RELAY_LIMIT_PER_MINUTE,
  getPolicyAddress,
  getSponsor,
  rateLimit,
  sendSerially,
  sponsoredSendAllowed,
  sponsorIsLow,
} from '@/lib/server/sponsor';

/**
 * Submits a run the assistant's key already signed. The key signs an EIP-712
 * `Execute` that commits to the allowance, recipient, amount, a one-time nonce
 * and a deadline; this route only pays the network fee for
 * `EntolePolicy.executeFor` from the sponsor account, so it can change nothing
 * the signature covers and cannot replay it (see contracts/src/EntolePolicy.sol).
 * Every caveat is still checked by the contract, against the signer.
 *
 * What it will pay for is bounded per caller a minute, per allowance a minute
 * and a day, and for everyone together a day; the last two are counted only
 * for a run the contract would accept, just before it is sent.
 */
export const runtime = 'nodejs';

const policyAbi = parseAbi([
  'function executeFor(bytes32 id, address recipient, uint256 amount, uint256 deadline, bytes signature)',
]);

const UINT256_MAX = 2n ** 256n - 1n;
/** How far ahead a signed run may expire. */
const MAX_WINDOW_SECONDS = 900n;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));
const minorUnits = z
  .string()
  .regex(/^\d{1,78}$/)
  .transform((value) => BigInt(value))
  .refine((value) => value <= UINT256_MAX);

const bodySchema = z.object({
  id: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value as Hex),
  recipient: address,
  amount: minorUnits,
  deadline: minorUnits,
  // r ‖ s ‖ v: 65 bytes.
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((value) => value as Hex),
});

export async function POST(request: Request) {
  const sponsor = getSponsor();
  const policy = getPolicyAddress();
  if (!sponsor || !policy) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'relay-execute', RELAY_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { id, recipient, amount, deadline, signature } = parsed.data;

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now || deadline > now + MAX_WINDOW_SECONDS) {
    return json({ error: 'bad_window' }, 422);
  }

  let simulated;
  try {
    simulated = await sponsor.publicClient.simulateContract({
      account: sponsor.account,
      address: policy,
      abi: policyAbi,
      functionName: 'executeFor',
      args: [id, recipient, amount, deadline, signature],
    });
  } catch (error) {
    return json({ error: policyRevertCode(error) }, 422);
  }

  try {
    if (await sponsorIsLow(sponsor)) return json({ error: 'sponsor_low' }, 503);
    const allowed = await sponsoredSendAllowed(request, 'relay-execute', id);
    if (!allowed.ok) {
      return json({ error: 'rate_limited', retryAfterSeconds: allowed.retryAfterSeconds }, 429, {
        'Retry-After': String(allowed.retryAfterSeconds),
      });
    }
    const hash = await sendSerially(() => sponsor.walletClient.writeContract(simulated.request));
    return json({ hash });
  } catch {
    return json({ error: 'send_failed' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
