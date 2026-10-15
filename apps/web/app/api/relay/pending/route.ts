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
 * The assistant's runs that wait out their undo window on the network
 * (`EntolePolicy` version 2). This route only pays the network fee:
 *
 *   propose  submits a run the assistant's key signed (`proposeFor`). The
 *            contract checks every caveat and holds the amount back.
 *   cancel   submits a cancellation the owner's or the assistant's key signed
 *            (`cancelFor`). Only those two keys can stop a live run.
 *   run      carries out a run whose window has passed (`executePending`).
 *            Anyone may ask; the contract decides whether it is ready, still
 *            fresh and still allowed.
 *
 * Every call is simulated first, so the sponsor pays only for what the
 * contract will accept. What it will pay for is bounded the same way as a
 * sponsored send: per caller a minute, per allowance or run a minute and a
 * day, and for everyone together a day.
 */
export const runtime = 'nodejs';

const policyAbi = parseAbi([
  'function proposeFor(bytes32 id, address recipient, uint256 amount, uint256 deadline, bytes signature) returns (bytes32)',
  'function cancelFor(bytes32 runId, uint256 deadline, bytes signature)',
  'function executePending(bytes32 runId)',
]);

const UINT256_MAX = 2n ** 256n - 1n;
/** How far ahead a signed proposal or cancellation may expire. */
const MAX_WINDOW_SECONDS = 900n;

const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as Hex);
const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));
const minorUnits = z
  .string()
  .regex(/^\d{1,78}$/)
  .transform((value) => BigInt(value))
  .refine((value) => value <= UINT256_MAX);
// r ‖ s ‖ v: 65 bytes.
const signature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/)
  .transform((value) => value as Hex);

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('propose'), id: bytes32, recipient: address, amount: minorUnits, deadline: minorUnits, signature }),
  z.object({ action: z.literal('cancel'), runId: bytes32, deadline: minorUnits, signature }),
  z.object({ action: z.literal('run'), runId: bytes32 }),
]);

export async function POST(request: Request) {
  const sponsor = getSponsor();
  const policy = getPolicyAddress();
  if (!sponsor || !policy) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'relay-pending', RELAY_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;

  if (body.action !== 'run') {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (body.deadline <= now || body.deadline > now + MAX_WINDOW_SECONDS) return json({ error: 'bad_window' }, 422);
  }

  // Simulated first, so the sponsor only ever pays for what the contract accepts.
  let send: () => Promise<Hex>;
  try {
    if (body.action === 'propose') {
      const { request: call } = await sponsor.publicClient.simulateContract({
        account: sponsor.account,
        address: policy,
        abi: policyAbi,
        functionName: 'proposeFor',
        args: [body.id, body.recipient, body.amount, body.deadline, body.signature],
      });
      send = () => sponsor.walletClient.writeContract(call);
    } else if (body.action === 'cancel') {
      const { request: call } = await sponsor.publicClient.simulateContract({
        account: sponsor.account,
        address: policy,
        abi: policyAbi,
        functionName: 'cancelFor',
        args: [body.runId, body.deadline, body.signature],
      });
      send = () => sponsor.walletClient.writeContract(call);
    } else {
      const { request: call } = await sponsor.publicClient.simulateContract({
        account: sponsor.account,
        address: policy,
        abi: policyAbi,
        functionName: 'executePending',
        args: [body.runId],
      });
      send = () => sponsor.walletClient.writeContract(call);
    }
  } catch (error) {
    return json({ error: policyRevertCode(error) }, 422);
  }

  try {
    if (await sponsorIsLow(sponsor)) return json({ error: 'sponsor_low' }, 503);
    // Proposing and running move money, and are counted like a send. A
    // cancellation never moves anything and is never held back by a count.
    if (body.action !== 'cancel') {
      const allowed = await sponsoredSendAllowed(request, 'relay-pending', body.action === 'propose' ? body.id : body.runId);
      if (!allowed.ok) {
        return json({ error: 'rate_limited', retryAfterSeconds: allowed.retryAfterSeconds }, 429, {
          'Retry-After': String(allowed.retryAfterSeconds),
        });
      }
    }
    const hash = await sendSerially(send);
    return json({ hash });
  } catch {
    return json({ error: 'send_failed' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
